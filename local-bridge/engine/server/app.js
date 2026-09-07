import { connectionBinding, connectionError, sanitizeConnectionConfig } from '../shared/model-connection-settings.js';
import { withAdditionalImageModels, imageModelEntry } from '../shared/image-model-catalog.js';
import { createGeneratedHistory } from './generated-history.js';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStorage, makeId } from './storage.js';
import { applyWorkflowValues, parseWorkflow, preflightWorkflow, probeComfyUi, submitComfyPrompt, validateApiEndpoint, validateModelServiceUrl, waitForComfyResult } from './comfyui.js';
import { inspectComfyInstallation, loadComfyInstallation, saveComfyInstallation, startComfyInstallation } from './comfy-runtime.js';
import { publicRuntimePaths, resolveRuntimePaths } from './paths.js';
import { comfyUiWorkflowForModel, comfyUiWorkflowsForModel, comfyUiWorkflowTemplateForModel } from './comfyui-workflows.js';
import { assertGenerationContract, publicGenerationProfile } from './generation-options.js';
import { getAdapter } from './adapters/index.js';
import { inspectComfyUiMiniMaxH3Queue, videoContainerHasAudioTrack } from './adapters/comfyui-minimax-h3.js';
import { createTripo3dPostprocessRunner, normalizeTripo3dPostprocessOperation, tripo3dPostprocessRequest } from './adapters/tripo3d-postprocess.js';
import { TRIPO_CLEAN_ALBEDO_TEXTURE_INTENT, tripoCleanAlbedoTexturePrompt } from './tripo3d-texture-intent.js';
import { WINDOWS_CLIPBOARD_MAX_IMAGE_BYTES, writePngToWindowsClipboard } from './windows-clipboard.js';
import { applyComfyUiCanvasStateToPrompt, applyComfyUiCanvasStateToWorkflow, extractComfyUiCanvasStateFromWorkflow, stripComfyUiPromptPrefix } from './comfyui-workflow-prompts.js';
import { ensureComfyUiPoseMap, illustriousDimensions } from './adapters/comfyui-illustrious.js';
import { uploadComfyUiNativeReference } from './adapters/comfyui-native-image.js';
import { connectModelCandidate, modelConnectionRequired } from './model-connection.js';
import { createManagedComfyConnectionManager } from './managed-comfy-connection.js';
import { reconcileSavedComfyModels } from './comfyui-model-catalog.js';

const CAPABILITIES = new Set(['image', 'video', 'audio', 'model', 'comfyui']);
const CANVAS_PORTS = new Set(['text', 'image', 'character', 'pose', 'lineart', 'audio']);
const LOOPBACK_REQUESTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const STUDIO_CONTRACT_VERSION = 2026081603;
const STUDIO_CAPABILITIES = new Set(['image', 'video', 'audio', 'model']);
const TOPAZ_UPSCALE_MODEL_ID = 'local-topaz-starlight-upscale';

function text(value, max = 160) { return String(value || '').trim().slice(0, max); }
function boolean(value) { return value === true; }
function failure(res, status, message) { return res.status(status).json({ error: message }); }
function allowlist(env) { return String(env.ECHO_MODEL_HOST_ALLOWLIST || '').split(',').map((item) => item.trim()).filter(Boolean); }

async function localPathStats(target) {
  let entry;
  try { entry = await fs.lstat(target); }
  catch (error) { if (error?.code === 'ENOENT') return { files: 0, bytes: 0 }; throw error; }
  if (entry.isSymbolicLink()) return { files: 0, bytes: 0 };
  if (entry.isFile()) return { files: 1, bytes: entry.size };
  if (!entry.isDirectory()) return { files: 0, bytes: 0 };
  const result = { files: 0, bytes: 0 };
  const children = await fs.readdir(target, { withFileTypes: true });
  for (const child of children) {
    if (child.isSymbolicLink()) continue;
    const current = await localPathStats(path.join(target, child.name));
    result.files += current.files;
    result.bytes += current.bytes;
  }
  return result;
}

async function combinedPathStats(targets) {
  const parts = await Promise.all(targets.map((target) => localPathStats(target)));
  return parts.reduce((total, current) => ({ files: total.files + current.files, bytes: total.bytes + current.bytes }), { files: 0, bytes: 0 });
}

async function workflowCatalog() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'workflows');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.templates)) throw new Error('工作流目录版本不受支持');
  const ids = new Set();
  const templates = await Promise.all(manifest.templates.map(async (entry) => {
    if (!entry?.id || ids.has(entry.id) || !entry.file || !Array.isArray(entry.requiredNodes) || !Array.isArray(entry.modelSlots) || !entry.ports?.text || !entry.ports?.output) throw new Error('工作流目录存在无效条目');
    ids.add(entry.id);
    const workflow = parseWorkflow(JSON.parse(await fs.readFile(path.join(root, entry.file), 'utf8')));
    for (const slot of entry.modelSlots) if (!workflow[String(slot.nodeId)]?.inputs || !slot.input || !slot.kind) throw new Error(`工作流 ${entry.id} 的模型槽无效`);
    return { ...entry, workflow };
  }));
  return { schemaVersion: manifest.schemaVersion, templates };
}

function matchedPlans(catalog, discovery) {
  const nodes = new Set(discovery.nodes || []);
  return catalog.templates.map((template) => {
    const missingNodes = (template.requiredNodes || []).filter((name) => !nodes.has(name));
    const missingResources = [];
    let selectedModel = '';
    for (const slot of template.modelSlots || []) {
      const group = slot.kind === 'lora' ? 'loras' : slot.kind === 'vae' ? 'vaes' : slot.kind === 'controlnet' ? 'controlnets' : 'models';
      const candidates = discovery.resources?.[group] || [];
      if (!candidates.length) missingResources.push(slot.label || slot.kind);
      else if (!selectedModel && group === 'models') selectedModel = candidates[0];
    }
    return {
      id: template.id, name: template.name, description: template.description,
      runnable: missingNodes.length === 0 && missingResources.length === 0,
      missingNodes, missingResources, modelSourceUrl: template.modelSourceUrl,
      modelFamily: template.modelFamily, selectedModel,
      ports: template.ports, sourceLinks: template.sourceLinks || []
    };
  });
}

function publicModel(model, secretConfigured = false, settings = false) {
  const common = {
    id: model.id, name: model.name, capability: model.capability, provider: model.provider,
    enabled: Boolean(model.enabled), referenceCapabilities: model.referenceCapabilities || {},
    secretConfigured: Boolean(secretConfigured), inputPorts: model.inputPorts || { text: true }, outputType: model.outputType || model.capability
  };
  if (!settings) return common;
  return {
    ...common, modelIdentifier: model.modelIdentifier || '', workflowConfigured: Boolean(model.workflow),
    serviceConfigured: Boolean(model.baseUrl), endpointConfigured: Boolean(model.endpoint),
    verifiedAt: model.verifiedAt || null
  };
}

function modelComplete(model, secretConfigured) {
  if (!model.name || !CAPABILITIES.has(model.capability)) return false;
  if (model.capability === 'comfyui') return Boolean(model.baseUrl && model.modelIdentifier && model.workflow && model.verifiedAt);
  return Boolean(model.endpoint && (model.secretOptional || secretConfigured));
}

function dimensions(ratio = '1:1', resolution = '1K') {
  const longSide = resolution === '2K' ? 2048 : resolution === '4K' ? 4096 : 1024;
  const pairs = { '1:1': [1, 1], '16:9': [16, 9], '9:16': [9, 16], '4:3': [4, 3], '3:4': [3, 4], '21:9': [21, 9] };
  const [wide, high] = pairs[ratio] || pairs['1:1'];
  const scale = longSide / Math.max(wide, high);
  const snap = (value) => Math.max(64, Math.round(value / 64) * 64);
  return { width: snap(wide * scale), height: snap(high * scale) };
}

function studioDefaultModels() {
  return [
    { id: 'gpt-image-2', name: 'GPT Image 2', capability: 'image', adapter: 'openai-image', enabled: false, config: { baseUrl: 'https://api.openai.com', endpoint: '/v1/images/generations', model: 'gpt-image-2', apiKeyEnv: 'OPENAI_API_KEY', defaultRatio: 'Auto', defaultResolution: '1K' } },
    { id: 'gemini-image', name: 'Gemini Image', capability: 'image', adapter: 'gemini-image', enabled: false, config: { baseUrl: 'https://generativelanguage.googleapis.com', endpoint: '/v1beta/models/gemini-2.5-flash-image:generateContent', model: 'gemini-2.5-flash-image', apiKeyEnv: 'GEMINI_API_KEY', defaultRatio: 'Auto', defaultResolution: '1K' } },
    { id: 'seedance-video', name: 'Seedance Video', capability: 'video', adapter: 'seedance-video', enabled: false, config: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', endpoint: '/contents/generations/tasks', model: '', apiKeyEnv: 'ARK_API_KEY', defaultRatio: 'Auto', defaultResolution: '720P' } },
    { id: 'gpt-sovits-audio', name: 'GPT-SoVITS 本地语音', capability: 'audio', adapter: 'gpt-sovits-audio', enabled: false, config: { baseUrl: 'http://127.0.0.1:9880', endpoint: '/tts', model: 'GPT-SoVITS V2', apiKeyEnv: '', defaultRatio: 'Auto', defaultResolution: 'WAV' } },
    { id: 'tripo3d-model', name: 'Tripo3D', capability: 'model', adapter: 'tripo3d-model', enabled: false, config: { baseUrl: 'https://openapi.tripo3d.com/v3', endpoint: '/generation/text-to-model', model: '', apiKeyEnv: 'TRIPO_API_KEY', defaultRatio: 'Auto', defaultResolution: 'STANDARD' } },
  ];
}

function studioProfile(model) {
  const capability = model.capability === 'comfyui' ? 'image' : model.capability;
  const image = capability === 'image';
  const video = capability === 'video';
  const audio = capability === 'audio';
  return {
    ratios: image ? ['Auto', '1:1', '16:9', '9:16', '4:3', '3:4', '21:9'] : video ? ['Auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] : ['Auto'],
    resolutions: image ? ['1K', '2K', '4K'] : video ? ['480P', '720P', '768P', '1080P', '2K', '4K'] : audio ? ['WAV'] : ['STANDARD', 'DETAILED'],
    defaultRatio: model.config?.defaultRatio || model.defaults?.ratio || (video ? '16:9' : image ? '1:1' : 'Auto'),
    defaultResolution: model.config?.defaultResolution || model.defaults?.resolution || (video ? '720P' : image ? '1K' : audio ? 'WAV' : 'STANDARD'),
    count: { min: 1, max: image ? 4 : 1, default: 1 },
    duration: { min: 1, max: video ? 15 : 1, default: video ? 5 : 1 },
    audio: video, audioInput: video,
    referenceLimits: { images: 12, videos: 2, audios: 2, total: 16 },
  };
}

function studioPublicModel(model) {
  const capability = model.capability === 'comfyui' ? 'image' : model.capability;
  const config = model.config || {};
  const style = Array.isArray(config.styleLoras) ? config.styleLoras : [];
  const character = Array.isArray(config.characterLoras) ? config.characterLoras : [];
  const object = Array.isArray(config.objectLoras) ? config.objectLoras : [];
  const workflows = comfyUiWorkflowsForModel(model);
  return {
    id: model.id, name: imageModelEntry(model.adapter, config.model)?.name || model.name, capability,
    ...(config.managed === true ? { managed: true } : {}),
    adapter: model.adapter || (model.provider === 'comfyui' ? 'comfyui-native-image' : 'http'),
    ...(config.family ? { localImageFamily: config.family } : {}),
    profile: publicGenerationProfile(model),
    defaults: { ratio: config.defaultRatio || model.defaults?.ratio || studioProfile(model).defaultRatio, resolution: config.defaultResolution || model.defaults?.resolution || studioProfile(model).defaultResolution },
    ...(style.length || character.length || object.length ? { loraCatalog: { style, character, object, ...(config.loraPresentation ? { presentation: config.loraPresentation } : {}) } } : {}),
    ...(/^comfyui-(illustrious|sdxl|native-image)$/.test(String(model.adapter || '')) ? { comfyDefaults: { steps: Number(config.steps) || 28, cfg: Number(config.cfg) || 5.5, sampler: config.sampler || 'dpmpp_2m_sde', scheduler: config.scheduler || 'karras', denoise: 1 } } : {}),
    ...(workflows.length ? { workflow: workflows[0], workflows } : model.workflow ? { workflow: model.workflow, workflows: model.workflows || [model.workflow] } : {}),
  };
}

function studioAdminModel(model, secrets) {
  const configured = Boolean(secrets?.[model.id]);
  return {
    id: model.id, name: model.name, capability: model.capability === 'comfyui' ? 'image' : model.capability,
    adapter: model.adapter || (model.provider === 'comfyui' ? 'comfyui-native-image' : 'http'), enabled: Boolean(model.enabled),
    config: sanitizeConnectionConfig({ ...(model.config || {}), ...(!model.config && model.baseUrl ? { baseUrl: model.baseUrl, endpoint: model.endpoint || '', model: model.modelIdentifier || '' } : {}) }, Object.values(secrets || {}).filter((value) => typeof value === 'string')),
    secret: { configured, masked: configured ? '••••••••' : '' },
  };
}

function comfyDropdown(objectInfo, nodeName, inputName) {
  const value = objectInfo?.[nodeName]?.input?.required?.[inputName]?.[0] || objectInfo?.[nodeName]?.input?.optional?.[inputName]?.[0];
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}


function withInternalToolModels(models) {
  const visible = models.filter((model) => model?.id !== TOPAZ_UPSCALE_MODEL_ID);
  const localComfy = visible.find((model) => String(model?.adapter || '').startsWith('comfyui-') && model?.config?.managed !== true);
  return [...visible, {
    id: TOPAZ_UPSCALE_MODEL_ID,
    name: 'Topaz 星光 2.6 高清放大',
    capability: 'video',
    adapter: 'comfyui-topaz-starlight',
    enabled: true,
    internalTool: true,
    config: { baseUrl: localComfy?.config?.baseUrl || 'http://127.0.0.1:8188', model: 'Topaz Starlight Precise 2.6', defaultRatio: '16:9', defaultResolution: '4K', pollIntervalMs: 3000, estimatedRunSeconds: 1800 },
  }];
}

function genericOutputs(payload, mediaType = 'image') {
  const candidates = [
    ...(Array.isArray(payload?.data) ? payload.data : []),
    ...(Array.isArray(payload?.output) ? payload.output : []),
    ...(Array.isArray(payload?.images) ? payload.images : []),
    payload
  ];
  return candidates.flatMap((item) => {
    const url = typeof item === 'string' ? item : item?.url || item?.image_url || item?.video_url || item?.audio_url || item?.model_url;
    const base64 = item?.b64_json || item?.base64;
    if (url) return [{ mediaType, url }];
    if (base64) return [{ mediaType, url: `data:${mediaType === 'audio' ? 'audio/wav' : mediaType === 'video' ? 'video/mp4' : 'image/png'};base64,${base64}` }];
    return [];
  });
}

const OUTPUT_EXTENSIONS = new Set(['.png','.jpg','.jpeg','.webp','.gif','.mp4','.webm','.mov','.mp3','.wav','.flac','.ogg','.glb','.gltf','.fbx','.obj']);
async function archiveComfyOutputs(baseUrl, files, outputRoot, fetchImpl) {
  await fs.mkdir(outputRoot, { recursive: true });
  const archived=[];
  for (const file of files) {
    const query=new URLSearchParams({filename:file.filename,subfolder:file.subfolder||'',type:file.type||'output'});
    const response=await fetchImpl(`${baseUrl}/view?${query}`,{signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw new Error('ComfyUI 已生成，但读取结果文件失败');
    const declared=Number(response.headers.get('content-length')||0);if(declared>268_435_456)throw new Error('生成结果超过 256MB，未写入作品目录');
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>268_435_456)throw new Error('生成结果超过 256MB，未写入作品目录');
    const candidate=path.extname(file.filename||'').toLowerCase();const extension=OUTPUT_EXTENSIONS.has(candidate)?candidate:'.bin';
    const storedName=`${crypto.randomUUID()}${extension}`;await fs.writeFile(path.join(outputRoot,storedName),bytes,{mode:0o600});
    archived.push({...file,url:`/media/outputs/${storedName}`});
  }
  return archived;
}

async function localReferenceInput(storage, input) {
  const value = String(input?.value || '').trim();
  let buffer;
  let extension = '.png';
  const data = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (data) {
    buffer = Buffer.from(data[2], 'base64');
    extension = data[1] === 'image/jpeg' ? '.jpg' : data[1] === 'image/webp' ? '.webp' : '.png';
  } else {
    const guide = value.match(/^\/character-guides\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,180})(?:\?[^#]*)?$/);
    if (guide) {
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'character-guides');
      const target = path.resolve(root, path.basename(guide[1]));
      if (path.dirname(target) !== root) throw new Error('内置角色比例图路径无效');
      buffer = await fs.readFile(target);
      extension = path.extname(target).toLowerCase() || '.png';
    }
    const match = value.match(/^\/media\/(assets|outputs)\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,180})$/);
    if (!buffer) {
      if (!match) throw new Error('本地 ComfyUI 参考图必须来自当前画布素材');
      const root = path.join(storage.dataDir, match[1]);
      const fileName = path.basename(match[2]);
      const target = path.resolve(root, fileName);
      if (path.dirname(target) !== path.resolve(root)) throw new Error('参考图路径无效');
      buffer = await fs.readFile(target);
      extension = path.extname(fileName).toLowerCase() || '.png';
    }
  }
  if (!buffer?.length || buffer.length > 64 * 1024 * 1024) throw new Error('参考图为空或超过 64MB');
  const mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
  return { port: String(input?.port || 'reference'), buffer, mimeType, fileName: `reference${extension}`, strength: Number.isFinite(Number(input?.strength)) ? Number(input.strength) : undefined, cacheKey: value };
}

const MEDIA_MIME_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'],
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'], ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.flac', 'audio/flac'], ['.ogg', 'audio/ogg'],
]);

async function localReferenceMedia(storage, input) {
  const value = String(input?.value || '').trim();
  let buffer;
  let mimeType = '';
  let extension = '';
  const data = value.match(/^data:((?:image|audio|video)\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (data) {
    mimeType = data[1].toLowerCase();
    buffer = Buffer.from(data[2], 'base64');
    extension = [...MEDIA_MIME_TYPES.entries()].find(([, candidate]) => candidate === mimeType)?.[0] || '';
  } else {
    const match = value.match(/^\/media\/(assets|outputs)\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,180})$/);
    if (!match) return null;
    const root = path.resolve(storage.dataDir, match[1]);
    const fileName = path.basename(match[2]);
    const target = path.resolve(root, fileName);
    if (path.dirname(target) !== root) throw new Error('参考素材路径无效');
    buffer = await fs.readFile(target);
    extension = path.extname(fileName).toLowerCase();
    mimeType = MEDIA_MIME_TYPES.get(extension) || '';
  }
  if (!buffer?.length || buffer.length > 256 * 1024 * 1024) throw new Error('参考素材为空或超过 256MB');
  const type = mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('image/') ? 'image' : String(input?.type || '');
  if (!type || !mimeType) throw new Error('参考素材格式不受支持');
  return {
    type,
    port: String(input?.port || 'reference'),
    buffer,
    mimeType,
    fileName: `reference${extension || (type === 'audio' ? '.wav' : type === 'video' ? '.mp4' : '.png')}`,
    strength: Number.isFinite(Number(input?.strength)) ? Number(input.strength) : undefined,
    ...(typeof input?.referenceToken === 'string' && input.referenceToken.trim() ? { referenceToken: input.referenceToken.trim().slice(0, 64) } : {}),
    ...(Number.isInteger(Number(input?.guideFrame)) ? { guideFrame: Number(input.guideFrame) } : {}),
    ...(['latest', 'locked'].includes(String(input?.versionPolicy || '')) ? { versionPolicy: String(input.versionPolicy) } : {}),
    ...(typeof input?.sourceVersion === 'string' && input.sourceVersion.trim() ? { sourceVersion: input.sourceVersion.trim().slice(0, 20000) } : {}),
    ...(Number.isFinite(Number(input?.duration)) ? { duration: Math.max(0, Number(input.duration)) } : {}),
    ...(type === 'video' ? { hasAudioTrack: videoContainerHasAudioTrack(buffer, extension) } : {}),
    cacheKey: value,
  };
}

async function localModelAsset(storage, value, preferredName = '') {
  const match = String(value || '').trim().match(/^\/media\/(assets|outputs)\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,180})$/);
  if (!match) throw new Error('待处理模型必须来自当前画布作品目录');
  const root = path.resolve(storage.dataDir, match[1]);
  const storedName = path.basename(match[2]);
  const target = path.resolve(root, storedName);
  if (path.dirname(target) !== root) throw new Error('模型文件路径无效');
  const extension = path.extname(preferredName || storedName).toLowerCase();
  if (!new Set(['.glb', '.gltf', '.fbx', '.obj', '.stl', '.3mf', '.usdz']).has(extension)) throw new Error('待处理模型格式不受支持');
  const buffer = await fs.readFile(target);
  if (!buffer.length || buffer.length > 150 * 1024 * 1024) throw new Error('待处理模型为空或超过 Tripo3D 150MB 限制');
  return { buffer, fileName: preferredName || storedName, format: extension.slice(1) };
}

async function archiveAdapterOutputs(outputs, outputRoot, fetchImpl = fetch) {
  await fs.mkdir(outputRoot, { recursive: true });
  const archiveUrl = async (value, preferredName = '') => {
    const sourceUrl = String(value || '').trim();
    if (!sourceUrl) return { url: '', archived: false, error: '' };
    try {
      let bytes;
      let candidate = path.extname(preferredName).toLowerCase();
      const data = sourceUrl.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
      if (data) {
        bytes = Buffer.from(data[2], 'base64');
        const byMime = [...MEDIA_MIME_TYPES.entries()].find(([, mime]) => mime === data[1].toLowerCase());
        candidate = candidate || byMime?.[0] || '';
      } else {
        const remoteUrl = new URL(sourceUrl);
        if (!['http:', 'https:'].includes(remoteUrl.protocol)) throw new Error('结果地址协议不受支持');
        const response = await fetchImpl(remoteUrl, { signal: AbortSignal.timeout(300000), redirect: 'follow' });
        if (!response.ok) throw new Error(`下载返回 HTTP ${response.status}`);
        const declared = Number(response.headers.get('content-length') || 0);
        if (declared > 536_870_912) throw new Error('结果超过 512MB');
        bytes = Buffer.from(await response.arrayBuffer());
        candidate = candidate || path.extname(remoteUrl.pathname).toLowerCase();
      }
      if (!bytes?.length || bytes.length > 536_870_912) throw new Error('结果为空或超过 512MB');
      const extension = OUTPUT_EXTENSIONS.has(candidate) ? candidate : '.bin';
      const storedName = `${crypto.randomUUID()}${extension}`;
      await fs.writeFile(path.join(outputRoot, storedName), bytes, { mode: 0o600 });
      return { url: `/media/outputs/${storedName}`, archived: true, sourceUrl, error: '' };
    } catch (error) {
      return { url: sourceUrl, archived: false, sourceUrl, error: text(error?.message, 240) || '结果未能保存到本地' };
    }
  };
  const archived = [];
  for (const output of outputs || []) {
    if (output?.buffer) {
      const extension = OUTPUT_EXTENSIONS.has(String(output.extension || '').toLowerCase()) ? String(output.extension).toLowerCase() : '.bin';
      const storedName = `${crypto.randomUUID()}${extension}`;
      await fs.writeFile(path.join(outputRoot, storedName), output.buffer, { mode: 0o600 });
      const preview = await archiveUrl(output.previewUrl, `preview${path.extname(output.previewUrl || '') || '.png'}`);
      archived.push({
        mediaType: output.mediaType || 'image', mediaUrl: `/media/outputs/${storedName}`, fileName: output.fileName || storedName,
        metadata: { ...(output.metadata || {}), archived: true, ...(preview.url ? { previewUrl: preview.url } : {}), ...(preview.error ? { previewArchiveError: preview.error } : {}) },
      });
    } else if (output?.mediaUrl) {
      const stored = await archiveUrl(output.mediaUrl, output.fileName || '');
      const preview = await archiveUrl(output.previewUrl, `preview${path.extname(output.previewUrl || '') || '.png'}`);
      archived.push({
        mediaType: output.mediaType || 'image', mediaUrl: stored.url, fileName: output.fileName || null,
        metadata: {
          ...(output.metadata || {}), archived: stored.archived, sourceUrl: stored.sourceUrl,
          ...(stored.error ? { archiveError: stored.error } : {}),
          ...(preview.url ? { previewUrl: preview.url } : {}),
          ...(preview.error ? { previewArchiveError: preview.error } : {}),
        },
      });
    }
  }
  return archived;
}

function adminGuard(env) {
  return (req, res, next) => {
    if (LOOPBACK_REQUESTS.has(req.ip) || LOOPBACK_REQUESTS.has(req.socket.remoteAddress)) return next();
    const enabled = String(env.ECHO_ALLOW_REMOTE_MODEL_ADMIN || '').toLowerCase() === 'true';
    const expected = String(env.ECHO_MODEL_ADMIN_TOKEN || '');
    const supplied = String(req.get('x-model-admin-token') || '');
    if (!enabled || !expected || supplied.length !== expected.length) return failure(res, 403, '模型设置仅允许在本机打开');
    let equal = 0; for (let index = 0; index < expected.length; index += 1) equal |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
    if (equal !== 0) return failure(res, 403, '模型管理保护验证失败');
    next();
  };
}

export function createApp({ dataDir, privateDir, runtimePaths, env = process.env, fetchImpl = fetch, platform = process.platform, spawnImpl, managedComfyOptions = {} } = {}) {
  const app = express();
  const defaults=resolveRuntimePaths(env,platform);const resolvedPaths = runtimePaths || { ...defaults, data:dataDir||defaults.data,private:privateDir||defaults.private,...(dataDir?{config:path.join(path.dirname(dataDir),'config'),cache:path.join(path.dirname(dataDir),'cache'),logs:path.join(path.dirname(dataDir),'logs')}:{}) };
  const storage = createStorage({ dataDir: dataDir || resolvedPaths.data, privateDir: privateDir || resolvedPaths.private, configDir: resolvedPaths.config });
  const activeJobs = new Map();
  const generatedHistory = createGeneratedHistory({ storage, activeJobs });
  const recoveryReady = storage.updateJobs((jobs) => jobs.map((job) => ['queued', 'running', 'cancelling'].includes(job.status)
    ? { ...job, status: 'paused', stage: '应用重启后已暂停', error: '上次运行被应用重启中断；本地任务可重试，已有远端任务可恢复', updatedAt: new Date().toISOString() }
    : job));
  // Observe startup failure immediately, but retain the rejected promise for job routes.
  recoveryReady.catch((error) => { console.error('任务恢复失败:', error?.message || error); });
  const guard = adminGuard(env);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 256 * 1024 * 1024, files: 1 },
  });
  const clipboardImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: WINDOWS_CLIPBOARD_MAX_IMAGE_BYTES, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, String(file.mimetype || '').toLowerCase() === 'image/png'),
  });
  const loadStudioModels = async () => {
    const saved = await storage.studioModels();
    // Mutation handlers need every record, including inventory-only entries.
    return reconcileSavedComfyModels(withAdditionalImageModels(Array.isArray(saved) ? saved : studioDefaultModels())).records;
  };
  const managedComfy = createManagedComfyConnectionManager({
    privateDir: storage.privateDir,
    fetchImpl,
    ...(spawnImpl ? { spawnImpl } : {}),
    ...managedComfyOptions,
  });
  const loadRunnableStudioModels = async () => {
    const stored = await loadStudioModels();
    return [...reconcileSavedComfyModels(stored).models, ...await managedComfy.models(stored)];
  };
  const loadVisibleStoredStudioModels = async () => reconcileSavedComfyModels(await loadStudioModels()).models;
  const comfyEditorSessions = new Map();
  const workflowScopeId = (scope) => crypto.createHash('sha256').update(JSON.stringify([
    'echo-ai-canvas-open-source-workflow-v1', scope.taskId, scope.canvasId, scope.nodeId, scope.modelId, scope.workflowId,
  ])).digest('hex');
  const workflowRecordFile = (scope) => path.join(storage.dataDir, 'comfy-workflows', `${workflowScopeId(scope)}.json`);
  const requireEditorSession = (id) => {
    const session = comfyEditorSessions.get(String(id || ''));
    if (!session || session.expiresAtMs <= Date.now()) {
      comfyEditorSessions.delete(String(id || ''));
      const error = new Error('ComfyUI 编辑会话不存在或已过期');
      error.status = 404;
      throw error;
    }
    session.expiresAtMs = Date.now() + 30 * 60 * 1000;
    session.expiresAt = new Date(session.expiresAtMs).toISOString();
    return session;
  };
  const requireComfyCanvasNode = async (scope) => {
    const canvas = await storage.canvas(scope.taskId, scope.canvasId);
    const node = (canvas.nodes || []).find((item) => item?.id === scope.nodeId);
    if (!node || node.data?.kind !== 'comfyUiWorkflow') throw Object.assign(new Error('当前节点不是 ComfyUI 工作流节点'), { status: 409 });
    if (node.data?.modelId && node.data.modelId !== scope.modelId) throw Object.assign(new Error('节点模型已变化，请刷新画布后重试'), { status: 409 });
    if (node.data?.workflowId && node.data.workflowId !== scope.workflowId) throw Object.assign(new Error('节点生成方式已变化，请刷新画布后重试'), { status: 409 });
    return node;
  };
  const comfyCanvasState = (node, model, session = {}) => {
    const data = node?.data || {};
    const config = model?.config || {};
    const profile = studioProfile(model);
    const requestedResolution = String(data.resolution || '').trim().toUpperCase();
    const fixedSeed = data.comfySeedMode === 'fixed' || (data.comfySeedMode !== 'random' && Number.isInteger(Number(data.seed)) && Number(data.seed) >= 0);
    return {
      positivePrompt: String(session.positivePrompt ?? data.prompt ?? '').trim().slice(0, 12000),
      negativePrompt: String(session.negativePrompt ?? data.negativePrompt ?? config.negativePrompt ?? '').trim().slice(0, 4000),
      positivePrefix: String(session.positivePrefix ?? config.positivePrefix ?? 'masterpiece, best quality, amazing quality').trim().slice(0, 1000),
      checkpoint: String(config.model || '').trim().slice(0, 180),
      ratio: profile.ratios.includes(data.ratio) ? data.ratio : config.defaultRatio || profile.defaultRatio || '3:4',
      resolution: profile.resolutions.includes(requestedResolution) ? requestedResolution : config.defaultResolution || profile.defaultResolution || '1K',
      comfySeedMode: fixedSeed ? 'fixed' : 'random', ...(fixedSeed ? { seed: Number(data.seed) } : {}),
      comfySteps: Math.max(1, Math.min(100, Number(data.comfySteps ?? config.steps) || 28)),
      comfyCfg: Math.max(1, Math.min(30, Number(data.comfyCfg ?? config.cfg) || 5.5)),
      comfySampler: String(data.comfySampler || config.sampler || 'dpmpp_2m_sde').trim().slice(0, 80),
      comfyScheduler: String(data.comfyScheduler || config.scheduler || 'karras').trim().slice(0, 80),
      comfyDenoise: Math.max(0.05, Math.min(1, Number(data.comfyDenoise) || 1)),
      referenceDenoise: Math.max(0.05, Math.min(1, Number(data.referenceDenoise ?? config.referenceDenoise) || 0.72)),
      characterLora: String(data.characterLora || '').trim().slice(0, 180),
      characterLoraStrength: Math.max(0, Math.min(1.5, Number(data.characterLoraStrength ?? 0.8))),
      ...(session.referenceImage ? { referenceImage: session.referenceImage } : {}),
      ...(session.maskImage ? { maskImage: session.maskImage } : {}),
    };
  };
  const readWorkflowRecord = async (scope) => {
    try { return JSON.parse(await fs.readFile(workflowRecordFile(scope), 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  };
  const editorUrl = (baseUrl, browserHostname, sessionId) => {
    const internal = new URL(String(baseUrl || 'http://127.0.0.1:8188'));
    const hostname = String(browserHostname || internal.hostname).trim().replace(/^\[|\]$/g, '');
    if (internal.protocol !== 'http:' || !/^[a-z0-9.:-]+$/i.test(hostname)) throw new Error('ComfyUI 编辑器地址无效');
    const authority = hostname.includes(':') ? `[${hostname}]` : hostname;
    const url = new URL(`http://${authority}:${internal.port || '80'}/`);
    url.searchParams.set('ai_canvas_embed', '1');
    url.searchParams.set('ai_canvas_session', sessionId);
    return url.toString();
  };
  app.set('trust proxy', false);
  app.use(express.json({ limit: '8mb' }));
  app.use(['/api/v1/jobs', '/api/v1/tripo3d/postprocess', '/api/v1/comfyui/pose-preview', '/api/v1/comfyui/editor-session', '/api/generate'], generatedHistory.generationGuard);

  app.get('/api/health', (_req, res) => res.json({ ok: true, edition: 'open-source' }));
  app.get('/api/system/storage', guard, (_req, res) => res.json(publicRuntimePaths(resolvedPaths)));
  app.get('/api/settings', async (_req,res,next)=>{try{res.json(await storage.settings());}catch(error){next(error);}});
  app.patch('/api/settings', async (req,res,next)=>{try{const current=await storage.settings();const next={...current,...(req.body?.theme==='light'||req.body?.theme==='dark'?{theme:req.body.theme}:{}),...(Number.isFinite(Number(req.body?.previewCacheLimitMb))?{previewCacheLimitMb:Math.min(16384,Math.max(256,Number(req.body.previewCacheLimitMb)))}:{})};await storage.saveSettings(next);res.json(next);}catch(error){next(error);}});

  app.get('/api/v1/admin/data/summary', guard, async (_req, res, next) => { try {
    const categories = [
      { id: 'canvases', label: '画布数据', targets: [path.join(storage.dataDir, 'canvases')] },
      { id: 'assets', label: '导入素材', targets: [path.join(storage.dataDir, 'assets')] },
      { id: 'outputs', label: '生成结果', targets: [path.join(storage.dataDir, 'outputs')] },
      { id: 'previews', label: '预览缓存', targets: [path.join(storage.dataDir, 'previews')] },
      { id: 'workflows', label: '工作流记录', targets: [path.join(storage.dataDir, 'comfy-workflows'), path.join(storage.dataDir, 'workflows')] },
      { id: 'configuration', label: '配置与密钥', targets: [path.join(storage.dataDir, 'studio-models.json'), path.join(storage.dataDir, 'jobs.json'), path.join(resolvedPaths.config, 'settings.json'), path.join(storage.privateDir, 'model-secrets.json')] },
    ];
    const measured = await Promise.all(categories.map(async ({ targets, ...category }) => ({ ...category, ...(await combinedPathStats(targets)) })));
    const total = measured.reduce((value, category) => ({ files: value.files + category.files, bytes: value.bytes + category.bytes }), { files: 0, bytes: 0 });
    res.json({ updatedAt: new Date().toISOString(), total, categories: measured });
  } catch (error) { next(error); } });


  app.delete('/api/v1/generation-history', guard, async (req, res) => {
    try { await recoveryReady; res.json(await generatedHistory.removeHistory(req.body)); }
    catch (error) { failure(res, Number(error.status) || 500, error.message || '历史记录移除失败'); }
  });
  app.delete('/api/v1/admin/data/generated-results', guard, async (req, res) => {
    try {
      await recoveryReady;
      const result = await generatedHistory.clearGeneratedResults(req.body);
      res.status(result.partial ? 207 : 200).json(result);
    } catch (error) { failure(res, Number(error.status) || 500, error.message || '生成结果清理失败'); }
  });

  app.delete('/api/v1/admin/data/previews', guard, async (_req, res, next) => { try {
    const dataRoot = path.resolve(storage.dataDir);
    const target = path.resolve(dataRoot, 'previews');
    if (!target.startsWith(`${dataRoot}${path.sep}`)) return failure(res, 400, '预览缓存路径无效');
    const removed = await localPathStats(target);
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(target, { recursive: true });
    res.json({ ok: true, removed });
  } catch (error) { next(error); } });

  // Compatibility surface for the full AI Canvas client. Everything here is
  // local-first: no account, tenant, credit or billing state is required.
  app.get('/api/v1/context', (_req, res) => res.json({
    mode: 'local', purpose: 'open-source', generationContractVersion: STUDIO_CONTRACT_VERSION,
    member: { id: 'local-owner', name: '本机', platformAdmin: true },
  }));

  app.get('/api/v1/models', async (_req, res, next) => { try {
    const models = await loadRunnableStudioModels();
    res.json({ models: models.filter((model) => model.enabled && !model.internalTool && STUDIO_CAPABILITIES.has(model.capability === 'comfyui' ? 'image' : model.capability)).map(studioPublicModel) });
  } catch (error) { next(error); } });

  app.get('/api/v1/admin/comfyui/managed/status', guard, async (_req, res, next) => { try {
    res.json(await managedComfy.status());
  } catch (error) { next(error); } });

  app.post('/api/v1/admin/comfyui/managed/connect', guard, async (req, res) => { try {
    if (req.body && Object.keys(req.body).length) return failure(res, 400, '托管 ComfyUI 连接请求不接受地址或安装路径');
    const state = await managedComfy.connect();
    res.status(state.state === 'starting' ? 202 : state.state === 'connected' ? 200 : 409).json(state);
  } catch (error) { failure(res, 400, text(error?.message, 300) || '托管 ComfyUI 连接失败'); } });

  app.post('/api/v1/admin/comfyui/managed/verify', guard, async (req, res) => { try {
    if (!req.body || Object.keys(req.body).length !== 1 || !['quick', 'full'].includes(req.body.scope)) return failure(res, 400, '托管 ComfyUI 验证范围无效');
    const state = await managedComfy.verify({ scope: req.body.scope });
    res.status(state.state === 'repair-required' ? 409 : 200).json(state);
  } catch (error) { failure(res, 400, text(error?.message, 300) || '托管 ComfyUI 验证失败'); } });

  app.delete('/api/v1/admin/comfyui/managed/connection', guard, async (req, res) => { try {
    if (req.body && Object.keys(req.body).length) return failure(res, 400, '托管 ComfyUI 断开请求不接受参数');
    const state = await managedComfy.disconnect();
    res.status(state.reasonCode ? 409 : 200).json(state);
  } catch (error) { failure(res, 400, text(error?.message, 300) || '托管 ComfyUI 断开失败'); } });

  app.get('/api/v1/admin/models', guard, async (_req, res, next) => { try {
    const [models, secrets] = await Promise.all([loadStudioModels(), storage.secrets()]);
    res.json({ models: reconcileSavedComfyModels(models).models.map((model) => studioAdminModel(model, secrets)) });
  } catch (error) { next(error); } });

  app.post('/api/v1/admin/models/:modelId/connect', guard, async (req, res) => {
    try {
      const result = await connectModelCandidate(storage, req.params.modelId, req.body, { fetchImpl, defaultModels: studioDefaultModels() });
      res.json({ connected: true, connection: result.connection, model: studioAdminModel(result.model, result.secrets) });
    } catch (error) {
      res.status(Number(error?.status) || 503).json({ error: error?.connection?.message || '模型连接未保存，请检查设置后重试', code: error?.code || 'connection_failed', ...(error?.connection ? { connection: error.connection } : {}) });
    }
  });

  app.delete('/api/v1/admin/models/:modelId/connection', guard, async (req, res) => { try {
    const result = await storage.transactModelConnection(async ({ models, secrets }) => {
      const model = models.find((item) => item.id === req.params.modelId);
      if (!model || !modelConnectionRequired(model)) throw Object.assign(new Error('Unavailable model'), { status: 404 });
      delete secrets[model.id];
      model.enabled = false;
      model.config = { ...(model.config || {}), connection: { status: 'missing', message: '尚未配置 API 密钥', checkedAt: new Date().toISOString(), httpStatus: 0 } };
      return { models, secrets, model };
    }, studioDefaultModels());
    res.json({ connected: false, model: studioAdminModel(result.model, result.secrets) });
  } catch (error) { failure(res, Number(error?.status) || 503, '模型连接移除失败'); } });

  app.put('/api/v1/admin/models', guard, async (req, res) => { try {
    if (!Array.isArray(req.body?.models)) return failure(res, 400, '模型配置必须是列表');
    const models = req.body.models.slice(0, 100).map((source) => {
      const capability = source?.capability === 'comfyui' ? 'image' : text(source?.capability, 16);
      if (!STUDIO_CAPABILITIES.has(capability)) throw new Error('模型生成类型不支持');
      const id = text(source?.id, 120);
      const name = text(source?.name, 120);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(id) || !name) throw new Error('模型 ID 或名称无效');
      const rawConfig = source?.config && typeof source.config === 'object' && !Array.isArray(source.config) ? source.config : {};
      const { pricing: _pricing, inputDirectory: _inputDirectory, outputDirectory: _outputDirectory, tempDirectory: _tempDirectory, pythonPath: _pythonPath, mainPath: _mainPath, ...config } = rawConfig;
      return { id, name, capability, adapter: text(source?.adapter, 80) || 'http', enabled: Boolean(source?.enabled), config };
    });
    if (new Set(models.map((model) => model.id)).size !== models.length) return failure(res, 400, '模型 ID 不能重复');
    const submittedSecrets = req.body.secrets ?? {};
    if (!submittedSecrets || typeof submittedSecrets !== 'object' || Array.isArray(submittedSecrets)) throw connectionError('request_invalid');
    for (const supplied of Object.values(submittedSecrets)) {
      if (supplied !== null && (typeof supplied !== 'string' || supplied.length > 8000 || /[\r\n\0]/.test(supplied))) throw connectionError('request_invalid');
    }
    const result = await storage.transactModelConnection(async ({ models: previousModels, secrets }) => {
      const redactions = [...Object.values(secrets), ...Object.values(submittedSecrets)]
        .filter((value) => typeof value === 'string' && value.length)
        .flatMap((value) => [value, value.trim()]).filter(Boolean);
      const candidates = models.map((model) => ({ ...model, config: sanitizeConnectionConfig(model.config, redactions) }));
      for (const candidate of candidates) {
        const previous = previousModels.find((model) => model.id === candidate.id);
        const supplied = typeof submittedSecrets[candidate.id] === 'string' ? submittedSecrets[candidate.id].trim() : '';
        const changedBinding = previous ? connectionBinding(previous) !== connectionBinding(candidate) : Boolean(secrets[candidate.id]);
        // Bulk configuration imports must not bypass the connect route's key binding.
        if (modelConnectionRequired(candidate) && changedBinding && !supplied) throw connectionError('new_key_required', 409);
      }
      for (const [id, supplied] of Object.entries(submittedSecrets)) {
        if (!candidates.some((model) => model.id === id)) continue;
        if (supplied === null || !supplied.trim()) delete secrets[id];
        else secrets[id] = supplied.trim();
      }
      return { models: candidates, secrets };
    }, studioDefaultModels());
    res.json({ models: result.models.map((model) => studioAdminModel(model, result.secrets)) });
  } catch (error) {
    res.status(Number(error?.status) || 400).json({ error: '模型配置保存失败，请检查设置后重试', code: error?.code || 'model_settings_invalid' });
  } });

  app.get('/api/v1/canvas/:taskId/boards', async (req, res, next) => { try {
    res.json({ boards: await storage.canvasBoards(req.params.taskId) });
  } catch (error) { next(error); } });

  app.post('/api/v1/canvas/:taskId/boards', async (req, res, next) => { try {
    const id = `canvas-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const value = { title: text(req.body?.title, 48) || '新画布', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, revision: 0, createdAt: now, updatedAt: now };
    await storage.saveCanvas(req.params.taskId, id, value);
    res.status(201).json({ board: { id, title: value.title, createdAt: now, updatedAt: now, nodeCount: 0 } });
  } catch (error) { next(error); } });

  app.delete('/api/v1/canvas/:taskId/boards/:canvasId', async (req, res, next) => { try {
    const canvasId = String(req.params.canvasId || '').trim();
    if (canvasId === 'main') return failure(res, 409, '主画布需要保留，不能删除');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(canvasId)) return failure(res, 400, '画布 ID 无效');
    if (!await storage.deleteCanvas(req.params.taskId, canvasId)) return failure(res, 404, '画布不存在或已被删除');
    res.status(204).end();
  } catch (error) { next(error); } });

  app.get('/api/v1/canvas/:taskId', async (req, res, next) => { try {
    res.json(await storage.canvas(req.params.taskId, req.query.canvasId));
  } catch (error) { next(error); } });

  app.put('/api/v1/canvas/:taskId', async (req, res, next) => { try {
    const canvasId = req.query.canvasId || 'main';
    let conflict = false;
    const value = await storage.updateCanvas(req.params.taskId, canvasId, (current) => {
      const expected = Number(req.body?.revision) || 0;
      const revision = Number(current?.revision) || 0;
      if (expected !== revision) { conflict = true; return current; }
      const now = new Date().toISOString();
      return {
        ...current,
        nodes: Array.isArray(req.body?.nodes) ? req.body.nodes : [],
        edges: Array.isArray(req.body?.edges) ? req.body.edges : [],
        viewport: req.body?.viewport && typeof req.body.viewport === 'object' ? req.body.viewport : { x: 0, y: 0, zoom: 1 },
        task: req.body?.task && typeof req.body.task === 'object' ? req.body.task : current.task,
        revision: revision + 1, createdAt: current.createdAt || now, updatedAt: now,
      };
    });
    if (conflict) return failure(res, 409, '画布已在另一窗口更新，请先刷新或选择覆盖');
    res.json(value);
  } catch (error) { next(error); } });

  app.post('/api/v1/canvas/:taskId/assets', upload.single('file'), async (req, res) => { try {
    if (!req.file?.buffer?.length) return failure(res, 400, '请选择素材文件');
    const allowed = new Map([
      ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp'], ['image/gif', '.gif'],
      ['video/mp4', '.mp4'], ['video/webm', '.webm'], ['video/quicktime', '.mov'],
      ['audio/mpeg', '.mp3'], ['audio/wav', '.wav'], ['audio/flac', '.flac'], ['audio/ogg', '.ogg'],
    ]);
    const extension = allowed.get(req.file.mimetype);
    if (!extension) return failure(res, 400, '素材格式不支持');
    const storedName = `${crypto.randomUUID()}${extension}`;
    const root = path.join(storage.dataDir, 'assets');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, storedName), req.file.buffer, { mode: 0o600 });
    res.status(201).json({ id: storedName, url: `/media/assets/${storedName}`, originalName: text(req.file.originalname, 240), mimeType: req.file.mimetype });
  } catch (error) { failure(res, 500, '素材保存失败'); } });

  const patchJob = async (jobId, patch) => {
    let updated;
    await storage.updateJobs((jobs) => jobs.map((item) => {
      if (item.id !== jobId) return item;
      const changes = typeof patch === 'function' ? patch(item) : patch;
      updated = { ...item, ...(changes || {}), updatedAt: new Date().toISOString() };
      return updated;
    }));
    return updated;
  };

  const mergedTripoWorkflow = (current, incoming) => {
    const left = current && typeof current === 'object' ? current : {};
    const right = incoming && typeof incoming === 'object' ? incoming : {};
    const stages = { ...(left.stages || {}) };
    for (const [name, value] of Object.entries(right.stages || {})) stages[name] = { ...(stages[name] || {}), ...(value || {}) };
    return { ...left, ...right, ...(Object.keys(stages).length ? { stages } : {}) };
  };

  const runStoredJob = (job, model, apiKey = '') => {
    const controller = new AbortController();
    activeJobs.set(job.id, controller);
    void (async () => {
      const updateJob = (patch) => patchJob(job.id, patch);
      let previewRevision = Number(job.comfyPreview?.revision) || 0;
      let lastPreviewWriteAt = 0;
      const onSamplingPreview = async (preview = {}) => {
        const now = Date.now();
        const hasFrame = Buffer.isBuffer(preview.buffer) && preview.buffer.length > 0;
        if (!hasFrame && now - lastPreviewWriteAt < 250) return;
        lastPreviewWriteAt = now;
        let url = '';
        if (hasFrame) {
          const extension = String(preview.contentType || '').includes('png') ? '.png' : '.jpg';
          const previewRoot = path.join(storage.dataDir, 'previews');
          const fileName = `${String(job.id).replace(/[^a-zA-Z0-9_-]/g, '_')}-${Math.max(0, Number(preview.outputIndex) || 0)}${extension}`;
          await fs.mkdir(previewRoot, { recursive: true });
          await fs.writeFile(path.join(previewRoot, fileName), preview.buffer, { mode: 0o600 });
          previewRevision += 1;
          url = `/media/previews/${fileName}?v=${previewRevision}`;
        }
        await updateJob((current) => ({
          ...(Number.isFinite(Number(preview.progress)) ? { progress: Math.max(8, Math.min(95, Number(preview.progress))) } : {}),
          comfyPreview: {
            ...(current.comfyPreview || {}), promptId: String(preview.promptId || current.comfyPreview?.promptId || ''),
            outputIndex: Math.max(0, Number(preview.outputIndex) || 0), step: Math.max(0, Number(preview.step) || 0),
            steps: Math.max(1, Number(preview.steps) || Number(current.comfyPreview?.steps) || 1),
            nodeId: String(preview.nodeId || current.comfyPreview?.nodeId || ''),
            ...(Number.isFinite(Number(preview.seed)) ? { seed: Number(preview.seed) } : {}),
            ...(url ? { url, revision: previewRevision } : {}),
          },
        }));
      };
      try {
        await updateJob({ status: 'running', progress: 8, stage: '正在生成', error: '' });
        const config = model.config || {};
        const inputs = Array.isArray(job.inputs) ? job.inputs : [];
        const options = job.options && typeof job.options === 'object' ? job.options : {};
        const ratio = text(options.ratio, 12) || config.defaultRatio || '1:1';
        const resolution = text(options.resolution, 12) || config.defaultResolution || '1K';
        const size = dimensions(ratio, resolution);
        const adapterName = String(model.adapter || '');
        let outputs = [];
        let completion = {};

        if (job.tripoPostprocessOperation) {
          if (adapterName !== 'tripo3d-model') throw new Error('所选模型不是 Tripo3D 模型');
          if (!apiKey) throw new Error('请先在模型设置中填写 Tripo3D API Key');
          const runner = createTripo3dPostprocessRunner({ ...config, apiKey, fetchImpl });
          let postprocessOptions = { ...(job.postprocessOptions || {}) };
          const knownRemoteTask = String(job.remoteTaskId || job.tripoWorkflow?.currentTaskId || '').trim();
          if (!knownRemoteTask && job.postprocessSourceAsset?.url) {
            await updateJob((current) => ({ progress: 7, stage: '正在上传模型', tripoWorkflow: mergedTripoWorkflow(current.tripoWorkflow, { phase: 'uploading_source' }) }));
            const source = await localModelAsset(storage, job.postprocessSourceAsset.url, job.postprocessSourceAsset.fileName);
            const fileToken = await runner.client.uploadFile(source, { signal: controller.signal });
            ['taskId', 'task_id', 'url', 'sourceUrl', 'source_url'].forEach((name) => delete postprocessOptions[name]);
            postprocessOptions.fileToken = fileToken;
            await updateJob((current) => ({ postprocessOptions, tripoWorkflow: mergedTripoWorkflow(current.tripoWorkflow, { phase: 'submitting', sourceUploaded: true }) }));
          }
          const cleanAlbedo = job.tripoPostprocessOperation === 'texture' && postprocessOptions.textureIntent === TRIPO_CLEAN_ALBEDO_TEXTURE_INTENT;
          const needsTextureReferences = job.tripoPostprocessOperation === 'texture'
            && !knownRemoteTask
            && postprocessOptions.textureAlignment === 'original_image'
            && !postprocessOptions.texturePrompt;
          if (needsTextureReferences && inputs.length) {
            const references = await Promise.all(inputs.filter((input) => input?.type === 'image').slice(0, 4).map((input) => localReferenceInput(storage, input)));
            const viewOrder = new Map([['front', 0], ['left', 1], ['back', 2], ['right', 3]]);
            const ordered = references.sort((left, right) => (viewOrder.get(left.port) ?? 99) - (viewOrder.get(right.port) ?? 99));
            const hasFourViews = ordered.length === 4 && ['front', 'left', 'back', 'right'].every((port) => ordered.some((image) => image.port === port));
            const selected = cleanAlbedo ? [ordered.find((image) => image.port === 'front') || ordered[0]] : hasFourViews ? ordered : [ordered.find((image) => image.port === 'front') || ordered[0]];
            const uploaded = [];
            await updateJob((current) => ({ progress: 9, stage: '正在上传外观参考', tripoWorkflow: mergedTripoWorkflow(current.tripoWorkflow, { phase: 'uploading_reference' }) }));
            for (const reference of selected.filter(Boolean)) uploaded.push({ fileToken: await runner.client.uploadFile(reference, { signal: controller.signal }) });
            if (uploaded.length) postprocessOptions.texturePrompt = cleanAlbedo
              ? tripoCleanAlbedoTexturePrompt(uploaded[0].fileToken)
              : hasFourViews ? { images: uploaded } : { image: uploaded[0] };
            await updateJob((current) => ({ postprocessOptions, tripoWorkflow: mergedTripoWorkflow(current.tripoWorkflow, { phase: 'submitting', referenceImagesUploaded: uploaded.length }) }));
          }
          if (cleanAlbedo && !knownRemoteTask && !postprocessOptions.texturePrompt) postprocessOptions.texturePrompt = tripoCleanAlbedoTexturePrompt();
          const generated = await runner.run({
            operation: job.tripoPostprocessOperation,
            options: postprocessOptions,
            remoteTaskId: knownRemoteTask,
            signal: controller.signal,
            onProgress: (progress) => updateJob({ progress: Math.max(8, Math.min(95, Number(progress) || 8)), stage: 'Tripo3D 后处理中' }),
            onRemoteTask: (remoteTaskId, workflow) => updateJob((current) => ({ remoteTaskId: String(remoteTaskId || ''), tripoWorkflow: mergedTripoWorkflow(current.tripoWorkflow, workflow) })),
            onWorkflowState: (workflow) => updateJob((current) => ({ tripoWorkflow: mergedTripoWorkflow(current.tripoWorkflow, workflow) })),
            onSubmissionUnknown: (workflow) => updateJob((current) => ({ tripoWorkflow: mergedTripoWorkflow(current.tripoWorkflow, workflow), stage: '远端提交状态未知' })),
          });
          outputs = await archiveAdapterOutputs(generated.outputs || [], path.join(storage.dataDir, 'outputs'), fetchImpl);
          completion = {
            ...(generated.usage ? { usage: generated.usage } : {}),
            ...(generated.remoteTaskId ? { remoteTaskId: generated.remoteTaskId } : {}),
            postprocessResult: {
              operation: generated.operation,
              taskId: generated.taskId,
              modelUrl: generated.modelUrl,
              modelUrls: generated.modelUrls,
              renderedImageUrl: generated.renderedImageUrl,
              riggable: generated.riggable,
              rigType: generated.rigType,
            },
          };
        } else {
          const directAdapters = new Set(['openai-image', 'gemini-image', 'seedance-video', 'minimax-h3-video', 'gpt-sovits-audio', 'tripo3d-model', 'comfyui-native-image', 'comfyui-illustrious', 'comfyui-sdxl', 'comfyui-minimax-h3', 'comfyui-topaz-starlight']);
          if (directAdapters.has(adapterName)) {
            const referenceMedia = (await Promise.all(inputs.map((input) => localReferenceMedia(storage, input)))).filter(Boolean);
            const referenceImages = adapterName.startsWith('comfyui-') && ['comfyui-native-image', 'comfyui-illustrious', 'comfyui-sdxl'].includes(adapterName)
              ? await Promise.all(inputs.filter((input) => input?.type === 'image').map((input) => localReferenceInput(storage, input)))
              : referenceMedia.filter((input) => input.type === 'image');
            if (adapterName === 'seedance-video' && referenceMedia.some((input) => ['video', 'audio'].includes(input.type))) {
              throw new Error('Seedance 的视频或音频参考需要可公开访问的 HTTPS 地址；开源版不会擅自上传本机素材，请配置自己的素材托管后再试');
            }
            const adapterInputs = adapterName === 'minimax-h3-video'
              ? inputs.map((input) => {
                const local = referenceMedia.find((reference) => reference.cacheKey === input?.value && reference.type === input?.type);
                return local && ['video', 'audio'].includes(local.type)
                  ? { ...input, value: `data:${local.mimeType};base64,${local.buffer.toString('base64')}` }
                  : input;
              })
              : inputs;
            const workflows = comfyUiWorkflowsForModel(model);
            const workflowId = job.workflowId || workflows[0]?.id || '';
            const comfyUiWorkflow = workflows.find((workflow) => workflow.id === workflowId) || workflows[0];
            if (!apiKey && !adapterName.startsWith('comfyui-') && adapterName !== 'gpt-sovits-audio') throw new Error('请先在模型设置中填写这个模型的 API Key');
            const runtimeModel = { ...model, config: { ...config, ...(apiKey ? { apiKey } : {}) } };
            const adapter = getAdapter(runtimeModel, fetchImpl);
            const generated = await adapter.run({
              ...job,
              inputs: adapterInputs,
              referenceImages,
              referenceMedia,
              comfyUiWorkflow: job.comfyUiWorkflow || comfyUiWorkflow,
              ratio,
              resolution,
              count: Math.max(1, Math.min(4, Number(options.count) || 1)),
              duration: Math.max(1, Number(options.duration) || 5),
              audioEnabled: options.audioEnabled !== false,
              signal: controller.signal,
              onProgress: (progress) => updateJob({ progress: Math.max(8, Math.min(95, Number(progress) || 8)), stage: adapterName.startsWith('comfyui-') ? 'ComfyUI 正在生成' : '模型正在生成' }),
              onStage: (stage, progress) => updateJob({ stage, ...(Number.isFinite(Number(progress)) ? { progress: Number(progress) } : {}) }),
              onSamplingPreview,
              onRemoteTask: (remoteTaskId, workflow) => updateJob((current) => ({ remoteTaskId: String(remoteTaskId || ''), tripoWorkflow: mergedTripoWorkflow(current.tripoWorkflow, workflow) })),
              onQueueState: (localQueue) => updateJob({ localQueue }),
              onWorkflowState: (workflow) => updateJob((current) => ({ tripoWorkflow: mergedTripoWorkflow(current.tripoWorkflow, workflow) })),
              onSubmissionUnknown: (workflow) => updateJob((current) => ({ tripoWorkflow: mergedTripoWorkflow(current.tripoWorkflow, workflow), stage: '远端提交状态未知' })),
            });
            const generatedOutputs = Array.isArray(generated) ? generated : generated?.outputs || [];
            outputs = await archiveAdapterOutputs(generatedOutputs, path.join(storage.dataDir, 'outputs'), fetchImpl);
            if (!Array.isArray(generated) && generated) completion = {
              ...(generated.usage ? { usage: generated.usage } : {}),
              ...(generated.remoteTaskId ? { remoteTaskId: generated.remoteTaskId } : {}),
              ...(generated.workflow ? { workflow: generated.workflow } : {}),
              ...(generated.rawTask ? { rawTask: generated.rawTask } : {}),
              ...(Number.isFinite(Number(generated.actualVideoInputCount)) ? { actualVideoInputCount: Number(generated.actualVideoInputCount) } : {}),
              ...(Number.isFinite(Number(generated.inputVideoDuration)) ? { inputVideoDuration: Number(generated.inputVideoDuration) } : {}),
            };
          } else if (adapterName.startsWith('comfyui-') || model.capability === 'comfyui') {
            const workflow = model.workflow || config.workflow;
            if (!workflow) throw new Error('这个本地模型还没有绑定 ComfyUI 工作流');
            const values = {
              text: job.prompt, negativeText: text(options.negativePrompt, 12000), width: size.width, height: size.height,
              seed: Number.isFinite(Number(options.seed)) ? Number(options.seed) : Math.floor(Math.random() * 2_147_483_647),
            };
            const prepared = applyWorkflowValues(parseWorkflow(workflow), model.templatePorts || config.templatePorts || {}, values);
            const baseUrl = validateModelServiceUrl(config.baseUrl || model.baseUrl, { allowRemote: Boolean(config.allowRemote), allowlist: allowlist(env) });
            const promptId = await submitComfyPrompt(baseUrl, prepared, { fetchImpl });
            await updateJob({ progress: 24, stage: 'ComfyUI 正在生成', comfyPromptId: promptId });
            const files = await waitForComfyResult(baseUrl, promptId, { fetchImpl, timeoutMs: Number(env.ECHO_GENERATION_TIMEOUT_MS || 300000) });
            const archived = await archiveComfyOutputs(baseUrl, files, path.join(storage.dataDir, 'outputs'), fetchImpl);
            outputs = archived.map((item) => ({ mediaType: job.capability, mediaUrl: item.url, fileName: item.filename || null, metadata: { width: size.width, height: size.height, seed: values.seed } }));
          } else {
            const baseUrl = text(config.baseUrl, 1000);
            const endpointPath = text(config.endpoint, 1000);
            const endpoint = validateApiEndpoint(endpointPath.startsWith('http') ? endpointPath : `${baseUrl.replace(/\/$/, '')}/${endpointPath.replace(/^\//, '')}`, { allowPrivate: Boolean(config.allowPrivateEndpoint) });
            const requestBody = {
              model: config.model || undefined, prompt: job.prompt, negative_prompt: text(options.negativePrompt, 12000),
              width: size.width, height: size.height, size: `${size.width}x${size.height}`,
              n: Math.max(1, Math.min(4, Number(options.count) || 1)), ratio, resolution,
              inputs: inputs.map((input) => ({ port: input?.port, type: input?.type, value: input?.value, referenceToken: input?.referenceToken })),
              references: inputs.filter((input) => ['image', 'video', 'audio'].includes(input?.type)).map((input) => input.value),
            };
            const response = await fetchImpl(endpoint, {
              method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
              body: JSON.stringify(requestBody), signal: controller.signal,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload?.error?.message || payload?.error || `模型接口返回 ${response.status}`);
            outputs = await archiveAdapterOutputs(
              genericOutputs(payload, job.capability).map((item) => ({ mediaType: job.capability, mediaUrl: item.url, fileName: null })),
              path.join(storage.dataDir, 'outputs'), fetchImpl,
            );
          }
        }
        if (!outputs.length && job.tripoPostprocessOperation === 'rig-check' && completion.postprocessResult) {
          await updateJob({ status: 'succeeded', progress: 100, stage: '检查完成', outputs: [], ...completion });
        } else {
          if (!outputs.length) throw new Error('生成已结束，但没有收到可用结果');
          await updateJob({ status: 'succeeded', progress: 100, stage: '生成完成', outputs, ...completion });
        }
      } catch (error) {
        const cancelled = controller.signal.aborted || error?.name === 'AbortError';
        const submissionUnknown = error?.submissionUnknown === true || error?.name === 'Tripo3dSubmissionUnknownError';
        await updateJob(cancelled
          ? { status: 'cancelled', stage: '已取消', error: '', outputs: [] }
          : submissionUnknown
            ? { status: 'paused', progress: 0, stage: '远端提交状态未知', error: text(error?.message, 600), outputs: [] }
            : { status: 'failed', progress: 0, stage: '生成失败', error: text(error?.message, 600) || '生成失败', outputs: [] });
      } finally { activeJobs.delete(job.id); }
    })();
  };

  app.get('/api/v1/jobs', async (req, res, next) => { try {
    await recoveryReady;
    const jobs = await storage.jobs();
    const requestedLimit = Number.parseInt(String(req.query.limit || '200'), 10);
    const limit = Math.max(1, Math.min(1000, Number.isFinite(requestedLimit) ? requestedLimit : 200));
    res.json({ jobs: await generatedHistory.jobsWithHistory(jobs.filter((job) => (!req.query.taskId || job.taskId === req.query.taskId) && (!req.query.canvasId || job.canvasId === req.query.canvasId)).slice(-limit)) });
  } catch (error) { next(error); } });

  app.post('/api/v1/jobs', async (req, res) => { try {
    await recoveryReady;
    const [savedModels, secrets] = await Promise.all([loadRunnableStudioModels(), storage.secrets()]);
    const models = withInternalToolModels(savedModels);
    const model = models.find((item) => item.id === req.body?.modelId && item.enabled);
    const capability = text(req.body?.capability, 16);
    if (!model || (model.capability === 'comfyui' ? 'image' : model.capability) !== capability) return failure(res, 404, '模型不可用或生成类型不匹配');
    try { assertGenerationContract(model, req.body?.generationContractVersion); }
    catch (error) { return failure(res, 409, text(error?.message, 300)); }
    const prompt = text(req.body?.prompt, 12000);
    const inputs = Array.isArray(req.body?.inputs) ? req.body.inputs.slice(0, 32) : [];
    if (!prompt && !inputs.length) return failure(res, 400, '请连接文本、图片或填写提示词');
    const taskId = text(req.body?.taskId, 128) || 'local-canvas';
    const canvasId = text(req.body?.canvasId, 128) || 'main';
    const nodeId = text(req.body?.nodeId, 160);
    const workflowId = text(req.body?.workflowId, 160);
    const duplicate = (await storage.jobs()).find((item) => item.taskId === taskId && item.canvasId === canvasId && item.nodeId === nodeId && ['queued', 'running', 'cancelling'].includes(item.status));
    if (duplicate) return res.status(409).json({ error: '该节点已有运行中的任务', job: duplicate });
    const selectedComfyWorkflow = workflowId ? comfyUiWorkflowForModel(model, workflowId) : null;
    const savedComfyWorkflow = selectedComfyWorkflow ? await readWorkflowRecord({ taskId, canvasId, nodeId, modelId: model.id, workflowId }) : null;
    const executableComfyWorkflow = savedComfyWorkflow?.prompt && typeof savedComfyWorkflow.prompt === 'object'
      ? {
        workflowId, revision: Math.max(0, Number(savedComfyWorkflow.revision) || 0),
        prompt: applyComfyUiCanvasStateToPrompt(savedComfyWorkflow.prompt, {
          positivePrompt: prompt,
          negativePrompt: req.body?.options?.negativePrompt || model.config?.negativePrompt || '',
          positivePrefix: model.config?.positivePrefix || 'masterpiece, best quality, amazing quality',
          checkpoint: model.config?.model || '', ratio: req.body?.options?.ratio,
          comfySeedMode: req.body?.options?.comfySeedMode, seed: req.body?.options?.seed,
          comfySteps: req.body?.options?.comfySteps, comfyCfg: req.body?.options?.comfyCfg,
          comfySampler: req.body?.options?.comfySampler, comfyScheduler: req.body?.options?.comfyScheduler,
          comfyDenoise: req.body?.options?.comfyDenoise,
        }) || savedComfyWorkflow.prompt,
      }
      : null;
    const now = new Date().toISOString();
    const job = {
      id: makeId('job'), taskId, canvasId, nodeId, modelId: model.id, capability, status: 'queued', progress: 0,
      modelAdapter: String(model.adapter || ''), nodeTitle: text(req.body?.nodeTitle, 160), operation: text(req.body?.operation, 80), workflowId,
      prompt, inputs, stage: '等待本机处理', outputs: [], attempt: 1, options: req.body?.options || {}, createdAt: now, updatedAt: now,
      ...(executableComfyWorkflow ? { comfyUiWorkflow: executableComfyWorkflow } : {}),
    };
    await storage.updateJobs((jobs) => [...jobs.slice(-999), job]);
    res.status(202).json({ job });
    runStoredJob(job, model, String(secrets[model.id] || ''));
  } catch (error) { failure(res, 500, text(error?.message, 300) || '任务提交失败'); } });

  app.get('/api/v1/jobs/:jobId', async (req, res, next) => { try {
    await recoveryReady;
    const job = (await storage.jobs()).find((item) => item.id === req.params.jobId);
    if (!job) return failure(res, 404, '任务不存在');
    res.json({ job: (await generatedHistory.jobsWithHistory([job]))[0] });
  } catch (error) { next(error); } });

  app.post('/api/v1/jobs/:jobId/resume', async (req, res, next) => { try {
    await recoveryReady;
    const jobs = await storage.jobs();
    const current = jobs.find((item) => item.id === req.params.jobId);
    if (!current) return failure(res, 404, '任务不存在');
    const tripo = current.modelAdapter === 'tripo3d-model' || current.provider === 'tripo3d' || current.tripoWorkflow || current.remoteTaskId;
    if (!tripo) return failure(res, 409, '该任务不支持远端恢复');
    if (!['paused', 'failed'].includes(current.status)) return failure(res, 409, '当前任务不可恢复');
    const remoteTaskId = String(current.remoteTaskId || current.tripoWorkflow?.currentTaskId || '').trim();
    if (!remoteTaskId) return failure(res, 409, '远端任务 ID 未知；恢复可能重复提交，请使用明确确认后的重新生成');
    if (jobs.some((item) => item.id !== current.id && item.nodeId === current.nodeId && item.taskId === current.taskId && ['queued', 'running', 'cancelling'].includes(item.status))) return failure(res, 409, '该节点已有运行中的任务');
    const [models, secrets] = await Promise.all([loadStudioModels(), storage.secrets()]);
    const model = models.find((item) => item.id === current.modelId && item.enabled);
    if (!model) return failure(res, 409, '任务使用的模型已停用或不存在');
    const job = await patchJob(current.id, { status: 'queued', progress: 0, stage: '正在恢复远端任务', error: '', outputs: [] });
    runStoredJob(job, model, String(secrets[model.id] || ''));
    res.status(202).json({ job });
  } catch (error) { next(error); } });

  app.post('/api/v1/jobs/:jobId/retry', async (req, res, next) => { try {
    await recoveryReady;
    const jobs = await storage.jobs();
    const current = jobs.find((item) => item.id === req.params.jobId);
    if (!current) return failure(res, 404, '任务不存在');
    const tripo = current.modelAdapter === 'tripo3d-model' || current.provider === 'tripo3d' || current.tripoWorkflow || current.remoteTaskId;
    if (!['failed', 'cancelled', 'succeeded', 'paused'].includes(current.status)) return failure(res, 409, '当前任务不可重试');
    if (jobs.some((item) => item.id !== current.id && item.nodeId === current.nodeId && item.taskId === current.taskId && ['queued', 'running', 'cancelling'].includes(item.status))) return failure(res, 409, '该节点已有运行中的任务');
    if (tripo && req.body?.confirmNewPaidSubmission !== true) return failure(res, 409, 'Tripo3D 重试会创建新的外部任务；请明确确认后再提交');
    const [models, secrets] = await Promise.all([loadRunnableStudioModels(), storage.secrets()]);
    const model = models.find((item) => item.id === current.modelId && item.enabled);
    if (!model) return failure(res, 409, '任务使用的模型已停用或不存在');
    const job = await patchJob(current.id, {
      status: 'queued', progress: 0, stage: '等待重新生成', error: '', outputs: [], attempt: Number(current.attempt || 1) + 1,
      ...(tripo ? { remoteTaskId: undefined, tripoWorkflow: undefined, postprocessOptions: current.originalPostprocessOptions || current.postprocessOptions } : {}),
      localQueue: undefined, comfyPromptId: undefined,
    });
    runStoredJob(job, model, String(secrets[model.id] || ''));
    res.status(202).json({ job });
  } catch (error) { next(error); } });

  app.post('/api/v1/jobs/:jobId/cancel', async (req, res, next) => { try {
    await recoveryReady;
    const current = (await storage.jobs()).find((item) => item.id === req.params.jobId);
    if (!current) return failure(res, 404, '任务不存在');
    if (['succeeded', 'failed', 'cancelled'].includes(current.status)) return res.json({ job: current });
    const controller = activeJobs.get(req.params.jobId);
    const job = await patchJob(current.id, controller
      ? { status: 'cancelling', stage: '正在取消任务', error: '' }
      : { status: 'cancelled', stage: '已取消', error: '' });
    controller?.abort();
    res.status(controller ? 202 : 200).json({ job });
  } catch (error) { next(error); } });

  app.post('/api/v1/tripo3d/postprocess', async (req, res) => { try {
    await recoveryReady;
    const [models, secrets] = await Promise.all([loadStudioModels(), storage.secrets()]);
    const model = models.find((item) => item.id === req.body?.modelId && item.enabled && item.adapter === 'tripo3d-model');
    if (!model) return failure(res, 409, 'Tripo3D 模型不可用');
    const operation = normalizeTripo3dPostprocessOperation(req.body?.operation);
    const rawOptions = req.body?.options && typeof req.body.options === 'object' && !Array.isArray(req.body.options) ? { ...req.body.options } : {};
    const sourceTaskId = text(req.body?.sourceTaskId || rawOptions.taskId || rawOptions.task_id, 240);
    const sourceAssetUrl = String(req.body?.sourceAssetUrl || '').trim();
    const sourceFileName = text(req.body?.sourceFileName, 240);
    const localSourceOptions = { ...rawOptions };
    if (sourceAssetUrl) ['taskId', 'task_id', 'fileToken', 'file_token', 'url', 'sourceUrl', 'source_url'].forEach((name) => delete localSourceOptions[name]);
    const postprocessOptions = sourceAssetUrl
      ? { ...localSourceOptions, fileToken: 'file_pending_local_upload' }
      : { ...rawOptions, ...(sourceTaskId ? { taskId: sourceTaskId } : {}) };
    try { tripo3dPostprocessRequest(operation, postprocessOptions); }
    catch (error) { return failure(res, 400, text(error?.message, 500)); }
    const taskId = text(req.body?.taskId, 128) || 'local-canvas';
    const canvasId = text(req.body?.canvasId, 128) || 'main';
    const nodeId = text(req.body?.nodeId, 160);
    const existing = (await storage.jobs()).find((item) => item.taskId === taskId && item.canvasId === canvasId && item.nodeId === nodeId && ['queued', 'running', 'cancelling'].includes(item.status));
    if (existing) return res.status(409).json({ error: '该节点已有运行中的后处理任务', job: existing });
    if (!secrets[model.id]) return failure(res, 409, '请先在模型设置中填写 Tripo3D API Key');
    const inputs = Array.isArray(req.body?.referenceImages) ? req.body.referenceImages.slice(0, 4).map((input) => ({
      port: text(input?.port, 32) || 'front', type: 'image', value: String(input?.value || '').slice(0, 20000),
    })) : [];
    const now = new Date().toISOString();
    const job = {
      id: makeId('job'), taskId, canvasId, nodeId, modelId: model.id, modelAdapter: model.adapter, capability: 'model', provider: 'tripo3d',
      prompt: '', inputs, options: { ratio: 'Auto', resolution: 'STANDARD', count: 1, duration: 1, audioEnabled: false },
      tripoPostprocessOperation: operation, postprocessOptions, originalPostprocessOptions: postprocessOptions,
      ...(sourceAssetUrl ? { postprocessSourceAsset: { url: sourceAssetUrl, fileName: sourceFileName } } : {}),
      tripoWorkflow: { phase: 'queued', operation: `postprocess:${operation}` },
      status: 'queued', progress: 0, stage: '等待 Tripo3D 后处理', outputs: [], attempt: 1, createdAt: now, updatedAt: now,
    };
    await storage.updateJobs((items) => [...items.slice(-999), job]);
    runStoredJob(job, model, String(secrets[model.id] || ''));
    res.status(202).json({ job });
  } catch (error) { failure(res, 400, text(error?.message, 500) || 'Tripo3D 后处理提交失败'); } });

  app.post('/api/v1/comfyui/pose-preview', async (req, res) => { try {
    const taskId = text(req.body?.taskId, 128) || 'local-canvas';
    const canvasId = text(req.body?.canvasId, 128) || 'main';
    const nodeId = text(req.body?.nodeId, 160);
    const modelId = text(req.body?.modelId, 120);
    const workflowId = text(req.body?.workflowId, 160);
    const model = (await loadRunnableStudioModels()).find((item) => item.enabled && item.id === modelId);
    if (!model || !['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(model.adapter)) return failure(res, 409, '当前模型不支持骨架预览');
    const workflow = comfyUiWorkflowForModel(model, workflowId);
    if (!workflow?.inputPorts?.some((port) => port.id === 'pose' && port.accepts?.includes('image')) || workflow.poseControl?.mode === 'unsupported') return failure(res, 409, '当前生成方式没有姿势控制');
    await requireComfyCanvasNode({ taskId, canvasId, nodeId, modelId, workflowId });
    const referenceValue = String(req.body?.referenceImage?.value || '').slice(0, 20000);
    if (!referenceValue) return failure(res, 400, '请先连接动作姿势参考图');
    const reference = await localReferenceInput(storage, { port: 'pose', type: 'image', value: referenceValue });
    const poseEstimator = req.body?.poseEstimator === 'dwpose' ? 'dwpose' : 'sdpose';
    const profile = studioProfile(model);
    const ratio = profile.ratios.includes(String(req.body?.ratio || '')) ? String(req.body.ratio) : profile.defaultRatio;
    const preview = await ensureComfyUiPoseMap({ config: model.config || {}, fetchImpl, reference, poseEstimator, ratio });
    const fileName = `${preview.key}.png`;
    const root = path.join(storage.dataDir, 'assets');
    await fs.mkdir(root, { recursive: true });
    try { await fs.writeFile(path.join(root, fileName), preview.buffer, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
    const size = illustriousDimensions(ratio);
    res.json({ preview: { key: preview.key, url: `/media/assets/${fileName}`, sourceUrl: referenceValue, estimator: poseEstimator, ratio, width: size.width, height: size.height, cached: preview.cached } });
  } catch (error) { failure(res, Number(error?.status) || 500, text(error?.message, 500) || '骨架预览生成失败'); } });

  app.post('/api/v1/comfyui/editor-session', async (req, res) => { try {
    const taskId = text(req.body?.taskId, 128) || 'local-canvas';
    const canvasId = text(req.body?.canvasId, 128) || 'main';
    const nodeId = text(req.body?.nodeId, 160);
    const modelId = text(req.body?.modelId, 120);
    const workflowId = text(req.body?.workflowId, 160);
    const model = (await loadVisibleStoredStudioModels()).find((item) => item.enabled && item.id === modelId);
    const workflow = model ? comfyUiWorkflowForModel(model, workflowId) : null;
    const templateFile = model ? comfyUiWorkflowTemplateForModel(model, workflowId) : null;
    if (!model || !workflow || workflow.id !== workflowId || !templateFile) return failure(res, 409, '所选模型没有可编辑的 ComfyUI 工作流');
    if (workflow.editor !== 'native') return failure(res, 409, '该生成方式由画布直接管理，不需要打开完整工作流');
    const node = await requireComfyCanvasNode({ taskId, canvasId, nodeId, modelId, workflowId });
    const baseUrl = validateModelServiceUrl(model.config?.baseUrl || 'http://127.0.0.1:8188', { allowRemote: Boolean(model.config?.allowRemote), allowlist: allowlist(env) });
    const bridgeResponse = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/extensions/ai_canvas_h3_video/ai-canvas-bridge.js`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    const bridgeSource = bridgeResponse?.ok ? await bridgeResponse.text() : '';
    if (!bridgeSource.includes('AI.Canvas.NodeScopedWorkflowBridge')) return failure(res, 503, 'ComfyUI 缺少画布桥接组件；请把开源包 comfyui/custom_nodes/ai_canvas_h3_video 放入 ComfyUI/custom_nodes 后重启 ComfyUI');
    const referenceInputs = Array.isArray(req.body?.referenceImages) ? req.body.referenceImages.filter((input) => input?.type === 'image').slice(0, 4) : [];
    const family = String(model.config?.family || '');
    if (family === 'qwen-image-edit-2511' && referenceInputs.length !== 1) return failure(res, 409, 'Qwen Image Edit 2511 完整工作流需要且仅接受 1 张参考图');
    const uploaded = [];
    if (['qwen-image-edit-2511', 'anima-base-v1'].includes(family)) {
      for (const input of referenceInputs) {
        const reference = await localReferenceInput(storage, input);
        uploaded.push({ port: reference.port, name: await uploadComfyUiNativeReference(fetchImpl, baseUrl, reference, undefined, { persistent: true }) });
      }
    }
    if (family === 'anima-base-v1' && workflowId.includes('inpaint')) {
      const ports = new Set(uploaded.map((item) => item.port));
      if (!ports.has('reference') || !ports.has('mask')) return failure(res, 409, 'Anima 局部重绘需要原图和蒙版两个输入');
    }
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const session = {
      id, taskId, canvasId, nodeId, modelId, workflowId, templateFile,
      positivePrompt: String(req.body?.positivePrompt || '').trim().slice(0, 12000),
      negativePrompt: String(req.body?.negativePrompt || model.config?.negativePrompt || '').trim().slice(0, 4000),
      positivePrefix: String(model.config?.positivePrefix || 'masterpiece, best quality, amazing quality').trim().slice(0, 1000),
      referenceImage: uploaded.find((item) => item.port === 'reference' || item.port === 'input')?.name || '',
      maskImage: uploaded.find((item) => item.port === 'mask')?.name || '',
      title: `${text(req.body?.taskTitle, 80) || taskId} · ${text(node.data?.title, 80) || workflow.name}`,
      expiresAtMs: createdAt + 30 * 60 * 1000, expiresAt: new Date(createdAt + 30 * 60 * 1000).toISOString(),
    };
    comfyEditorSessions.set(id, session);
    res.json({ editor: { ...workflow, url: editorUrl(baseUrl, req.body?.browserHostname || req.hostname, id), sessionId: id, scopeTitle: session.title, modelName: model.name, expiresAt: session.expiresAt, started: false } });
  } catch (error) { failure(res, Number(error?.status) || 500, text(error?.message, 500) || 'ComfyUI 编辑器连接失败'); } });

  app.get('/api/v1/comfyui/editor-sessions/:id/workflow', async (req, res) => { try {
    const session = requireEditorSession(req.params.id);
    const node = await requireComfyCanvasNode(session);
    const model = (await loadVisibleStoredStudioModels()).find((item) => item.enabled && item.id === session.modelId);
    if (!model) return failure(res, 409, '当前节点的本地模型不可用');
    const stored = await readWorkflowRecord(session);
    const templatePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'comfyui', 'workflows', path.basename(session.templateFile));
    const source = stored?.workflow || JSON.parse(await fs.readFile(templatePath, 'utf8'));
    const workflow = applyComfyUiCanvasStateToWorkflow(source, comfyCanvasState(node, model, session));
    workflow.extra = { ...(workflow.extra || {}), aiCanvasScope: { version: 1, id: workflowScopeId(session) } };
    res.json({ workflow, revision: Math.max(0, Number(stored?.revision) || 0), source: stored ? 'node' : 'template', scopeId: workflowScopeId(session), title: session.title, taskId: session.taskId, canvasId: session.canvasId, nodeId: session.nodeId });
  } catch (error) { failure(res, Number(error?.status) || 500, text(error?.message, 500) || '节点工作流加载失败'); } });

  app.put('/api/v1/comfyui/editor-sessions/:id/workflow', async (req, res) => { try {
    const session = requireEditorSession(req.params.id);
    await requireComfyCanvasNode(session);
    if (!req.body?.workflow || !Array.isArray(req.body.workflow.nodes)) return failure(res, 400, 'ComfyUI 工作流缺少可编辑节点图');
    if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > 2 * 1024 * 1024) return failure(res, 413, 'ComfyUI 工作流超过 2MB 限制');
    if (req.body.workflow?.extra?.aiCanvasScope?.id !== workflowScopeId(session)) return failure(res, 409, '已阻止保存：这不是当前画布节点的工作流');
    const current = await readWorkflowRecord(session);
    const revision = Math.max(0, Number(current?.revision) || 0);
    if (Math.max(0, Number(req.body?.revision) || 0) !== revision) return failure(res, 409, '工作流已在另一处更新，请重新打开后再保存');
    const savedAt = new Date().toISOString();
    const record = { taskId: session.taskId, canvasId: session.canvasId, nodeId: session.nodeId, modelId: session.modelId, workflowId: session.workflowId, workflow: req.body.workflow, ...(req.body.prompt && typeof req.body.prompt === 'object' ? { prompt: req.body.prompt } : {}), revision: revision + 1, savedAt };
    await fs.mkdir(path.dirname(workflowRecordFile(session)), { recursive: true });
    await fs.writeFile(workflowRecordFile(session), `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const extracted = extractComfyUiCanvasStateFromWorkflow(record.workflow);
    const canvasSync = { ...extracted, positivePrompt: stripComfyUiPromptPrefix(extracted.positivePrompt, session.positivePrefix) };
    session.positivePrompt = canvasSync.positivePrompt;
    session.negativePrompt = canvasSync.negativePrompt;
    session.positivePrefix = '';
    res.json({ ok: true, revision: record.revision, savedAt, canvasSync });
  } catch (error) { failure(res, Number(error?.status) || 500, text(error?.message, 500) || '节点工作流保存失败'); } });

  app.delete('/api/v1/comfyui/editor-sessions/:id', (req, res) => {
    comfyEditorSessions.delete(String(req.params.id || ''));
    res.json({ ok: true });
  });

  app.get('/api/v1/local-h3/queue', async (req, res, next) => { try {
    const requestedId = String(req.query.modelId || '').trim();
    const model = (await loadRunnableStudioModels()).find((item) => item.enabled && item.adapter === 'comfyui-minimax-h3' && (!requestedId || item.id === requestedId));
    if (!model) return res.json({ queue: { available: false, state: 'disabled', concurrency: 1, running: 0, queued: 0, ahead: 0, position: 0, estimatedWaitSeconds: 0, estimatedRunSeconds: 360, error: '本地 H3 模型未启用' } });
    res.json({ queue: { ...(await inspectComfyUiMiniMaxH3Queue(model.config || {}, fetchImpl)), mode: 'direct', autoStart: false } });
  } catch (error) { next(error); } });

  app.get('/api/v1/asset-library', async (req, res, next) => { try {
    const items = [];
    for (const group of ['assets', 'outputs']) {
      const root = path.join(storage.dataDir, group);
      let entries = [];
      try { entries = await fs.readdir(root, { withFileTypes: true }); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      for (const entry of entries) {
        if (!entry.isFile() || !['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(entry.name).toLowerCase())) continue;
        const stat = await fs.stat(path.join(root, entry.name));
        items.push({
          id: `${group}/${entry.name}`, project: text(req.query.project, 160) || '本地项目', name: path.basename(entry.name, path.extname(entry.name)),
          type: 'image', imageUrl: `/media/${group}/${entry.name}`, imageName: entry.name, contentCategory: 'image',
          createdAt: stat.birthtime.toISOString(), updatedAt: stat.mtime.toISOString(),
        });
      }
    }
    items.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    res.json({ items: items.slice(0, 500), total: items.length });
  } catch (error) { next(error); } });
  app.post('/api/v1/canvas/:taskId/assets/from-library', async (req, res) => { try {
    const match = String(req.body?.assetId || '').match(/^(assets|outputs)\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,180})$/);
    if (!match) return failure(res, 400, '本地资产信息无效');
    const target = path.join(storage.dataDir, match[1], path.basename(match[2]));
    const stat = await fs.stat(target);
    if (!stat.isFile()) return failure(res, 404, '本地资产不存在');
    res.json({ url: `/media/${match[1]}/${match[2]}`, originalName: match[2], displayName: path.basename(match[2], path.extname(match[2])), mediaType: 'image' });
  } catch (error) { failure(res, error?.code === 'ENOENT' ? 404 : 500, error?.code === 'ENOENT' ? '本地资产不存在' : '导入本地资产失败'); } });

  app.post('/api/v1/system-clipboard/image', clipboardImageUpload.single('file'), async (req, res) => { try {
    if (!req.file) return failure(res, 415, '请选择有效的 PNG 图片');
    await writePngToWindowsClipboard(req.file.buffer, { platform });
    res.json({ ok: true });
  } catch (error) { failure(res, Number(error?.status) || 500, text(error?.message, 500) || '本机剪贴板写入失败'); } });
  app.post('/api/v1/comfyui/connect', guard, async (req, res) => { try {
    const baseUrl = validateModelServiceUrl(req.body?.baseUrl || 'http://127.0.0.1:8188', { allowRemote: Boolean(req.body?.allowRemote), allowlist: allowlist(env) });
    const discovery = await probeComfyUi(baseUrl, { fetchImpl, timeoutMs: 5000 });
    const saved = await storage.studioModels();
    const catalog = reconcileSavedComfyModels(Array.isArray(saved) ? saved : studioDefaultModels(), { baseUrl, discovery });
    const local = catalog.models.filter((model) => String(model.adapter || '').startsWith('comfyui-') && model.config?.managed !== true);
    await storage.saveStudioModels(catalog.records);
    const settings = await storage.settings();
    await storage.saveSettings({ ...settings, comfyUiBaseUrl: baseUrl });
    res.json({ connected: true, baseUrl, discoveredModels: local.length, models: local.map(studioPublicModel) });
  } catch (error) { failure(res, 400, text(error?.message, 400) || 'ComfyUI 连接失败'); } });
  app.get('/api/v1/comfyui/resources', async (_req, res) => {
    const runnableModels = await loadRunnableStudioModels();
    const models = runnableModels.filter((model) => String(model.adapter || '').startsWith('comfyui-') && model.config?.managed !== true);
    const managedResources = managedComfy.catalogResources();
    const settings = await storage.settings();
    const baseUrl = models.map((model) => model.config?.baseUrl).find(Boolean) || settings.comfyUiBaseUrl || 'http://127.0.0.1:8188';
    let discovery = null;
    if (models.length) {
      try { discovery = await probeComfyUi(baseUrl, { fetchImpl, timeoutMs: 1800 }); } catch { /* offline is represented in the payload */ }
    }
    const checkpoints = discovery?.resources?.models || discovery?.models || [];
    const unets = discovery ? comfyDropdown(discovery.objectInfo, 'UNETLoader', 'unet_name') : [];
    const clips = discovery ? comfyDropdown(discovery.objectInfo, 'CLIPLoader', 'clip_name') : [];
    const vaes = discovery ? comfyDropdown(discovery.objectInfo, 'VAELoader', 'vae_name') : [];
    const loras = discovery ? [...new Set([...comfyDropdown(discovery.objectInfo, 'LoraLoader', 'lora_name'), ...comfyDropdown(discovery.objectInfo, 'LoraLoaderModelOnly', 'lora_name')])] : [];
    const controlnets = discovery ? comfyDropdown(discovery.objectInfo, 'ControlNetLoader', 'control_net_name') : [];
    const upscalers = discovery ? comfyDropdown(discovery.objectInfo, 'UpscaleModelLoader', 'model_name') : [];
    const patches = discovery ? comfyDropdown(discovery.objectInfo, 'ModelPatchLoader', 'name') : [];
    const resources = models.map((model) => {
      const checkpoint = model.config?.model || model.config?.resources?.unet || '';
      const configured = model.config?.resources || {};
      const requirements = [
        model.config?.model && model.adapter !== 'comfyui-minimax-h3' ? checkpoints.includes(model.config.model) : true,
        configured.unet ? unets.includes(configured.unet) : true,
        configured.clip ? clips.includes(configured.clip) : true,
        ...['clip1', 'clip2', 'clip3', 'clip4'].map((role) => configured[role] ? clips.includes(configured[role]) : true),
        configured.vae ? vaes.includes(configured.vae) : true,
        configured.lora ? loras.includes(configured.lora) : true,
        configured.inpaint ? patches.includes(configured.inpaint) : true,
        model.config?.discoveryReady !== false,
      ];
      const installed = requirements.every(Boolean);
      const online = Boolean(discovery);
      const readiness = { ready: online && installed, missingDependencies: online && !installed ? ['模型文件'] : [], missingPorts: [], blockingReasons: online ? (installed ? [] : ['所需模型文件未被 ComfyUI 识别']) : ['ComfyUI 当前离线'] };
      return {
        id: model.id, name: model.name, capability: model.capability, adapter: model.adapter, enabled: Boolean(model.enabled), baseUrl,
        checkpoint, filePresent: installed, installed, state: online ? (installed ? 'ready' : 'missing') : 'offline',
        message: online ? (installed ? 'ComfyUI 已识别' : '未在当前 ComfyUI 中找到所需文件') : 'ComfyUI 当前离线',
        workflows: comfyUiWorkflowsForModel(model).map((workflow) => ({
          id: workflow.id, name: workflow.name, editor: workflow.editor || 'managed', readiness,
          ...(workflow.appearanceControl ? { appearanceControl: workflow.appearanceControl } : {}),
          ...(workflow.detailEnhancement ? { detailEnhancement: workflow.detailEnhancement } : {}),
        })),
      };
    });
    for (const entry of managedResources) {
      const model = runnableModels.find((item) => item.id === entry.modelId);
      if (!model) continue;
      const readiness = { ready: true, missingDependencies: [], missingPorts: [], blockingReasons: [] };
      resources.push({
        id: model.id, name: model.name, capability: model.capability, adapter: model.adapter, enabled: true,
        filePresent: true, installed: true, state: 'ready', message: '托管 ComfyUI 已验证', managed: true,
        models: entry.models,
        workflows: comfyUiWorkflowsForModel(model).map((workflow) => ({ id: workflow.id, name: workflow.name, editor: workflow.editor || 'managed', readiness })),
      });
    }
    res.json({
      available: Boolean(discovery) || managedResources.length > 0, baseUrl, checkpoints, loras,
      categories: [
        { id: 'checkpoint', label: 'Checkpoint', items: checkpoints.map((name) => ({ name, state: 'ready' })) },
        { id: 'unet', label: 'UNet', items: unets.map((name) => ({ name, state: 'ready' })) },
        { id: 'clip', label: 'CLIP / Text Encoder', items: clips.map((name) => ({ name, state: 'ready' })) },
        { id: 'vae', label: 'VAE', items: vaes.map((name) => ({ name, state: 'ready' })) },
        { id: 'lora', label: 'LoRA', items: loras.map((name) => ({ name, state: 'ready' })) },
        { id: 'controlnet', label: 'ControlNet', items: controlnets.map((name) => ({ name, state: 'ready' })) },
        { id: 'upscaler', label: '放大模型', items: upscalers.map((name) => ({ name, state: 'ready' })) },
      ],
      nodeClasses: Object.fromEntries((discovery?.nodes || []).map((name) => [name, true])), purposeRecommendations: [], models: resources, scannedAt: new Date().toISOString(),
    });
  });
  app.get('/api/v1/comfyui/recipes', async (_req, res, next) => { try {
    const models = (await loadRunnableStudioModels()).filter((model) => String(model.adapter || '').startsWith('comfyui-'));
    const createdAt = '2026-01-01T00:00:00.000Z';
    const recipes = models.flatMap((model) => comfyUiWorkflowsForModel(model).map((workflow) => ({
      id: `${model.id}:${workflow.id}`, modelId: model.id, modelName: model.name, workflowId: workflow.id,
      name: workflow.name, description: workflow.modePresentation?.description || '画布内置生成方式',
      status: 'published', activeVersion: 1, draftVersion: null, readOnly: true,
      versions: [{ version: 1, status: 'published', createdAt, publishedAt: createdAt }],
      readiness: { ready: Boolean(model.enabled), missingDependencies: [], missingPorts: [], blockingReasons: model.enabled ? [] : ['模型当前未发布'] },
    })));
    res.json({ revision: 1, recipes });
  } catch (error) { next(error); } });
  app.patch('/api/v1/admin/comfyui/models/:modelId/publication', guard, async (req, res) => {
    const models = await loadStudioModels();
    if (!reconcileSavedComfyModels(models).models.some((item) => item.id === req.params.modelId)) return failure(res, 404, '本地模型不存在');
    const model = models.find((item) => item.id === req.params.modelId && String(item.adapter || '').startsWith('comfyui-'));
    if (!model) return failure(res, 404, '本地模型不存在');
    model.enabled = Boolean(req.body?.enabled);
    await storage.saveStudioModels(models);
    res.json({ model: studioAdminModel(model, await storage.secrets()) });
  });
  app.get('/api/v1/clipboard', async (_req, res, next) => { try { res.json(await storage.clipboard()); } catch (error) { next(error); } });
  app.post('/api/v1/clipboard', async (req, res, next) => { try {
    const clipboard = req.body?.clipboard && typeof req.body.clipboard === 'object' ? req.body.clipboard : req.body;
    if (!Array.isArray(clipboard?.nodes)) return failure(res, 400, '剪贴板内容无效');
    const value = { clipboard, updatedAt: new Date().toISOString() };
    await storage.saveClipboard(value); res.json(value);
  } catch (error) { next(error); } });

  app.post('/api/assets', async(req,res)=>{
    try{
      const match=String(req.body?.dataUrl||'').match(/^data:(image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm)|audio\/(?:mpeg|wav|flac));base64,([A-Za-z0-9+/=]+)$/);
      if(!match)return failure(res,400,'仅支持常见图片、视频和音频文件');
      const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>7_500_000)return failure(res,413,'单个本地素材暂时不能超过 7MB');
      const extensions={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','video/mp4':'.mp4','video/webm':'.webm','audio/mpeg':'.mp3','audio/wav':'.wav','audio/flac':'.flac'};
      const storedName=`${crypto.randomUUID()}${extensions[match[1]]}`;const root=path.join(storage.dataDir,'assets');await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,storedName),bytes,{mode:0o600});res.status(201).json({url:`/media/assets/${storedName}`,name:text(req.body?.name,180)});
    }catch(error){failure(res,500,'保存素材失败');}
  });
  app.get('/api/bootstrap', async (_req, res, next) => { try {
    const [projects, models, secrets] = await Promise.all([storage.projects(), storage.models(), storage.secrets()]);
    res.json({ projects, models: models.filter((model) => model.enabled && modelComplete(model, Boolean(secrets[model.id]))).map((model) => publicModel(model, Boolean(secrets[model.id]))) });
  } catch (error) { next(error); } });

  app.get('/api/projects', async (_req, res, next) => { try { res.json(await storage.projects()); } catch (error) { next(error); } });
  app.post('/api/projects', async (req, res, next) => { try {
    const name = text(req.body?.name, 80) || '未命名项目';
    const project = { id: makeId('project'), name, createdAt: new Date().toISOString(), canvases: [] };
    await storage.updateProjects((projects)=>[...projects,project]); res.status(201).json(project);
  } catch (error) { next(error); } });
  app.patch('/api/projects/:projectId', async (req, res, next) => { try {
    let project;
    await storage.updateProjects((projects)=>{project=projects.find((item)=>item.id===req.params.projectId);if(project)project.name=text(req.body?.name,80)||project.name;return projects;});
    if (!project) return failure(res, 404, '项目不存在'); res.json(project);
  } catch (error) { next(error); } });
  app.delete('/api/projects/:projectId', async (req, res, next) => { try {
    let removed=false;await storage.updateProjects((projects)=>{const nextProjects=projects.filter((item)=>item.id!==req.params.projectId);removed=nextProjects.length!==projects.length;return nextProjects;});
    if (!removed) return failure(res, 404, '项目不存在'); res.status(204).end();
  } catch (error) { next(error); } });

  app.post('/api/projects/:projectId/canvases', async (req, res, next) => { try {
    const canvas = { id: makeId('canvas'), name: text(req.body?.name, 80) || '新画布', state: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    let found=false;await storage.updateProjects((projects)=>{const project=projects.find((item)=>item.id===req.params.projectId);if(project){project.canvases.push(canvas);found=true;}return projects;});
    if (!found) return failure(res, 404, '项目不存在'); res.status(201).json(canvas);
  } catch (error) { next(error); } });
  app.get('/api/projects/:projectId/canvases/:canvasId', async (req, res, next) => { try {
    const projects = await storage.projects(); const canvas = projects.find((item) => item.id === req.params.projectId)?.canvases.find((item) => item.id === req.params.canvasId);
    if (!canvas) return failure(res, 404, '画布不存在'); res.json(canvas);
  } catch (error) { next(error); } });
  const saveCanvas = async (req, res, next) => { try {
    let canvas;await storage.updateProjects((projects)=>{canvas=projects.find((item)=>item.id===req.params.projectId)?.canvases.find((item)=>item.id===req.params.canvasId);if(canvas){if(req.body?.name!==undefined)canvas.name=text(req.body.name,80)||canvas.name;if(req.body?.state&&typeof req.body.state==='object')canvas.state=req.body.state;canvas.updatedAt=new Date().toISOString();}return projects;});
    if (!canvas) return failure(res, 404, '画布不存在'); res.json(canvas);
  } catch (error) { next(error); } };
  app.patch('/api/projects/:projectId/canvases/:canvasId',saveCanvas);
  app.post('/api/projects/:projectId/canvases/:canvasId/save',saveCanvas);
  app.delete('/api/projects/:projectId/canvases/:canvasId', async (req, res, next) => { try {
    let projectFound=false;let removed=false;await storage.updateProjects((projects)=>{const project=projects.find((item)=>item.id===req.params.projectId);if(project){projectFound=true;const previous=project.canvases.length;project.canvases=project.canvases.filter((item)=>item.id!==req.params.canvasId);removed=previous!==project.canvases.length;}return projects;});
    if (!projectFound) return failure(res, 404, '项目不存在');if(!removed)return failure(res,404,'画布不存在');res.status(204).end();
  } catch (error) { next(error); } });

  app.get('/api/models', async (_req, res, next) => { try {
    const [models, secrets] = await Promise.all([storage.models(), storage.secrets()]);
    res.json(models.filter((model) => model.enabled && modelComplete(model, Boolean(secrets[model.id]))).map((model) => publicModel(model, Boolean(secrets[model.id]))));
  } catch (error) { next(error); } });
  app.get('/api/workflow-templates', async (_req, res, next) => { try { res.json(await workflowCatalog()); } catch (error) { next(error); } });
  app.get('/api/model-settings', guard, async (_req, res, next) => { try {
    const [models, secrets] = await Promise.all([storage.models(), storage.secrets()]);
    res.json(models.map((model) => publicModel(model, Boolean(secrets[model.id]), true)));
  } catch (error) { next(error); } });

  app.post('/api/model-settings/comfyui/auto-connect', guard, async (_req, res) => {
    const saved = (await storage.models()).filter((item) => item.capability === 'comfyui' && item.verifiedAt).map((item) => item.baseUrl);
    const candidates = [...new Set(['http://127.0.0.1:8188', ...(env.DOCKER_CONTAINER ? ['http://host.docker.internal:8188'] : []), ...saved])];
    for (const candidate of candidates) {
      try {
        const safe = validateModelServiceUrl(candidate, { allowRemote: candidate !== 'http://127.0.0.1:8188', allowlist: [...allowlist(env), 'host.docker.internal'] });
        const result = await probeComfyUi(safe, { fetchImpl, timeoutMs: 900 });
        const catalog = await workflowCatalog();
        return res.json({ found: true, baseUrl: safe, nodes: result.nodes, models: result.models, resources: result.resources, plans: matchedPlans(catalog, result) });
      } catch { /* A bounded list of known candidates is intentionally tried one by one. */ }
    }
    const installation = await loadComfyInstallation(storage.privateDir, platform);
    if (installation) {
      try {
        startComfyInstallation(installation, { spawnImpl, platform });
        const baseUrl = 'http://127.0.0.1:8188';
        for (let attempt = 0; attempt < 24; attempt += 1) {
          try {
            const result = await probeComfyUi(baseUrl, { fetchImpl, timeoutMs: 900 });
            const catalog = await workflowCatalog();
            return res.json({ found: true, started: true, baseUrl, nodes: result.nodes, models: result.models, resources: result.resources, plans: matchedPlans(catalog, result) });
          } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
        }
      } catch { /* The saved installation may have moved; let the user choose it again. */ }
    }
    return res.json({ found: false, message: '没有找到 ComfyUI。选择一次软件位置，画布以后会自动连接。' });
  });

  app.post('/api/model-settings/comfyui/inspect-installation', guard, async (req, res) => {
    try { res.json(await inspectComfyInstallation(req.body?.rootPath, platform)); }
    catch (error) { failure(res, 400, error.message); }
  });

  app.post('/api/model-settings/comfyui/connect-installation', guard, async (req, res) => {
    try {
      const installation = await inspectComfyInstallation(req.body?.rootPath, platform);
      await saveComfyInstallation(storage.privateDir, installation);
      startComfyInstallation(installation, { spawnImpl, platform });
      const baseUrl = 'http://127.0.0.1:8188';
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          const result = await probeComfyUi(baseUrl, { fetchImpl, timeoutMs: 900 });
          const catalog = await workflowCatalog();
          return res.json({ found: true, started: true, baseUrl, nodes: result.nodes, models: result.models, resources: result.resources, plans: matchedPlans(catalog, result) });
        } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
      }
      return failure(res, 504, '已启动 ComfyUI，但暂时没有连接成功。首次启动可能较慢，请稍后点一次自动连接。');
    } catch (error) { return failure(res, 400, error.message); }
  });

  app.post('/api/model-settings/comfyui/probe', guard, async (req, res) => {
    try {
      const baseUrl = validateModelServiceUrl(req.body?.baseUrl, { allowRemote: boolean(req.body?.allowRemote), allowlist: allowlist(env) });
      const result = await probeComfyUi(baseUrl, { fetchImpl, timeoutMs: 2500 });
      const catalog = await workflowCatalog();
      res.json({ found: true, baseUrl, nodes: result.nodes, models: result.models, resources: result.resources, plans: matchedPlans(catalog, result) });
    } catch (error) { failure(res, 400, error.message); }
  });

  app.post('/api/model-settings/comfyui/preflight', guard, async (req, res) => {
    try {
      const baseUrl = validateModelServiceUrl(req.body?.baseUrl, { allowRemote: boolean(req.body?.allowRemote), allowlist: allowlist(env) });
      const result = await probeComfyUi(baseUrl, { fetchImpl, timeoutMs: 2500 });
      res.json(preflightWorkflow(req.body?.workflow, result.objectInfo));
    } catch (error) { failure(res, 400, error.message); }
  });

  app.post('/api/model-settings', guard, async (req, res, next) => { try {
    const capability = text(req.body?.capability, 20);
    if (!CAPABILITIES.has(capability)) return failure(res, 400, '生成类型不支持');
    const model = {
      id: makeId('model'), name: text(req.body?.name, 80), capability,
      provider: capability === 'comfyui' ? 'comfyui' : 'http', enabled: false,
      endpoint: text(req.body?.endpoint, 500), modelIdentifier: text(req.body?.modelIdentifier, 300),
      referenceCapabilities: {
        image: boolean(req.body?.referenceCapabilities?.image), pose: boolean(req.body?.referenceCapabilities?.pose),
        lineart: boolean(req.body?.referenceCapabilities?.lineart), audio: boolean(req.body?.referenceCapabilities?.audio)
      },
      secretOptional: boolean(req.body?.secretOptional), createdAt: new Date().toISOString()
    };
    model.inputPorts = { text: true, ...model.referenceCapabilities };
    model.outputType = capability === 'comfyui' ? 'image' : capability;
    if (!model.name) return failure(res, 400, '请给模型起个名字');
    if (capability === 'comfyui') {
      model.baseUrl = validateModelServiceUrl(req.body?.baseUrl, { allowRemote: boolean(req.body?.allowRemote), allowlist: allowlist(env) });
      let workflowValue = req.body?.workflow;
      if (req.body?.templateId) {
        const catalog = await workflowCatalog();
        const template = catalog.templates.find((item) => item.id === req.body.templateId);
        if (!template) return failure(res, 400, '工作流模板不存在');
        workflowValue = structuredClone(template.workflow);
        for (const slot of template.modelSlots || []) workflowValue[slot.nodeId].inputs[slot.input] = model.modelIdentifier;
        model.templateId = template.id;
        model.templateName = template.name;
        model.templatePorts = template.ports;
        model.inputPorts = Object.fromEntries(Object.keys(template.ports || {}).filter((key) => CANVAS_PORTS.has(key)).map((key) => [key, true]));
        model.outputType = template.capability || 'image';
      }
      model.workflow = parseWorkflow(workflowValue);
      if(!model.templateId){const workflowRoot=path.join(storage.dataDir,'workflows');await fs.mkdir(workflowRoot,{recursive:true});model.workflowFile=`${model.id}.json`;await fs.writeFile(path.join(workflowRoot,model.workflowFile),`${JSON.stringify(model.workflow,null,2)}\n`,{encoding:'utf8',mode:0o600});}
      const result = await probeComfyUi(model.baseUrl, { fetchImpl, timeoutMs: 2500 });
      if (!model.modelIdentifier) model.modelIdentifier = result.resources?.models?.[0] || result.models[0] || '';
      if (model.templateId) {
        const catalog = await workflowCatalog(); const template = catalog.templates.find((item) => item.id === model.templateId);
        for (const slot of template?.modelSlots || []) model.workflow[slot.nodeId].inputs[slot.input] = model.modelIdentifier;
      }
      if (!model.inputPorts) {
        model.inputPorts = { text: true, ...model.referenceCapabilities };
        model.outputType = 'image';
      }
      const preflight = preflightWorkflow(model.workflow, result.objectInfo);
      if (!preflight.ok) return failure(res, 400, `工作流不可用：缺少 ${[...preflight.missingNodes, ...preflight.missingModels].join('、')}`);
      if (!result.models.includes(model.modelIdentifier)) return failure(res, 400, '请选择 ComfyUI 已识别的模型');
      model.verifiedAt = new Date().toISOString();
    } else {
      model.allowPrivateEndpoint=boolean(req.body?.allowPrivateEndpoint);
      model.endpoint=validateApiEndpoint(model.endpoint,{allowPrivate:model.allowPrivateEndpoint});
    }
    const models = await storage.models(); models.push(model); await storage.saveModels(models);
    const secrets = await storage.secrets(); const suppliedSecret = String(req.body?.secret || '');
    if (suppliedSecret) { secrets[model.id] = suppliedSecret; await storage.saveSecrets(secrets); }
    res.status(201).json(publicModel(model, Boolean(suppliedSecret), true));
  } catch (error) { failure(res, 400, error.message); } });

  app.patch('/api/model-settings/:modelId', guard, async (req, res, next) => { try {
    const models = await storage.models(); const model = models.find((item) => item.id === req.params.modelId);
    if (!model) return failure(res, 404, '模型不存在'); const secrets = await storage.secrets();
    if (req.body?.secret !== undefined) {
      const suppliedSecret = String(req.body.secret || ''); if (suppliedSecret) secrets[model.id] = suppliedSecret; else delete secrets[model.id];
      await storage.saveSecrets(secrets);
    }
    if (req.body?.enabled !== undefined) {
      const wanted = boolean(req.body.enabled);
      if (wanted && !modelComplete(model, Boolean(secrets[model.id]))) return failure(res, 400, '请先完成连接配置，再启用模型');
      model.enabled = wanted;
    }
    if (req.body?.name !== undefined) model.name = text(req.body.name, 80) || model.name;
    await storage.saveModels(models); res.json(publicModel(model, Boolean(secrets[model.id]), true));
  } catch (error) { next(error); } });
  app.delete('/api/model-settings/:modelId', guard, async (req, res, next) => { try {
    const models = await storage.models(); const removed=models.find((item)=>item.id===req.params.modelId);const nextModels = models.filter((item) => item.id !== req.params.modelId);
    if (nextModels.length === models.length) return failure(res, 404, '模型不存在'); await storage.saveModels(nextModels);
    if(removed?.workflowFile)await fs.unlink(path.join(storage.dataDir,'workflows',path.basename(removed.workflowFile))).catch(()=>undefined);
    const secrets = await storage.secrets(); delete secrets[req.params.modelId]; await storage.saveSecrets(secrets); res.status(204).end();
  } catch (error) { next(error); } });

  app.post('/api/generate', async (req, res) => {
    try {
      const [models, secrets] = await Promise.all([storage.models(), storage.secrets()]);
      const model = models.find((item) => item.id === req.body?.modelId && item.enabled);
      if (!model || !modelComplete(model, Boolean(secrets[model?.id]))) return failure(res, 404, '模型不可用，请重新选择');
      const prompt = text(req.body?.prompt, 12000);
      if (!prompt) return failure(res, 400, '请连接文本或填写提示词');
      const size = dimensions(text(req.body?.ratio, 12) || '1:1', text(req.body?.resolution, 8) || '1K');
      if (model.capability === 'comfyui') {
        const values = { text: prompt, negativeText: text(req.body?.negativePrompt, 12000), width: size.width, height: size.height, seed: Number.isFinite(Number(req.body?.seed)) ? Number(req.body.seed) : Math.floor(Math.random() * 2_147_483_647) };
        const workflow = applyWorkflowValues(model.workflow, model.templatePorts || {}, values);
        const promptId = await submitComfyPrompt(model.baseUrl, workflow, { fetchImpl });
        const files = await waitForComfyResult(model.baseUrl, promptId, { fetchImpl, timeoutMs: Number(env.ECHO_GENERATION_TIMEOUT_MS || 300000) });
        const outputs = await archiveComfyOutputs(model.baseUrl, files, path.join(storage.dataDir,'outputs'), fetchImpl);
        return res.json({ id: promptId, modelId: model.id, outputs });
      }
      const endpoint=validateApiEndpoint(model.endpoint,{allowPrivate:Boolean(model.allowPrivateEndpoint)});
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(secrets[model.id] ? { authorization: `Bearer ${secrets[model.id]}` } : {}) },
        body: JSON.stringify({ model: model.modelIdentifier || undefined, prompt, negative_prompt: text(req.body?.negativePrompt, 12000), width: size.width, height: size.height, ratio: text(req.body?.ratio, 12), references: Array.isArray(req.body?.references) ? req.body.references.slice(0, 12) : [] })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return failure(res, 502, payload?.error?.message || payload?.error || `模型接口返回 ${response.status}`);
      const outputs = genericOutputs(payload, model.outputType || model.capability || 'image');
      if (!outputs.length) return failure(res, 502, '模型接口已完成，但没有返回可识别的结果地址');
      return res.json({ id: makeId('generation'), modelId: model.id, outputs });
    } catch (error) { return failure(res, 500, error instanceof TypeError ? '模型接口暂时无法连接' : text(error.message,300) || '生成失败'); }
  });

  const root = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(root, '..', 'dist');
  app.use('/media/assets',express.static(path.join(storage.dataDir,'assets'),{immutable:true,maxAge:'1y',fallthrough:false}));
  app.use('/media/outputs',express.static(path.join(storage.dataDir,'outputs'),{immutable:true,maxAge:'1y',fallthrough:false}));
  app.use('/media/previews',express.static(path.join(storage.dataDir,'previews'),{immutable:false,maxAge:0,fallthrough:false}));
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.use((error, _req, res, _next) => { console.error(error?.message || error); failure(res, 500, '服务暂时不可用'); });
  return app;
}
