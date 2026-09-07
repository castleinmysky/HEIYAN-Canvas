import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  comfyUiIllustriousBaseUrl,
  comfyUiIllustriousHistoryImage,
  ensureComfyUiPoseMap,
  illustriousDimensions,
  illustriousOutputDimensions,
  readComfyUiOutputFile,
} from './comfyui-illustrious.js';

export const Z_IMAGE_POSE_CONTROL_MODEL = 'Z-Image-Turbo-Fun-Controlnet-Union-2.1-2601-8steps.safetensors';

const FAMILY_DEFAULTS = Object.freeze({
  'flux2-klein': Object.freeze({ steps: 20, cfg: 3.5, sampler: 'euler', scheduler: 'simple' }),
  'qwen-image': Object.freeze({ steps: 8, cfg: 1, sampler: 'euler', scheduler: 'simple' }),
  'qwen-image-edit-2511': Object.freeze({ steps: 4, cfg: 1, sampler: 'euler', scheduler: 'simple' }),
  'hidream-i1-full': Object.freeze({ steps: 50, cfg: 5, sampler: 'uni_pc', scheduler: 'simple' }),
  'newbie-image-exp01': Object.freeze({ steps: 20, cfg: 5.5, sampler: 'res_multistep', scheduler: 'simple' }),
  'krea2-turbo': Object.freeze({ steps: 8, cfg: 1, sampler: 'euler', scheduler: 'simple' }),
  'z-image-turbo': Object.freeze({ steps: 8, cfg: 1, sampler: 'res_multistep', scheduler: 'simple' }),
  'anima-base-v1': Object.freeze({ steps: 30, cfg: 4, sampler: 'er_sde', scheduler: 'simple' }),
});

const FAMILY_REQUIRED_NODES = Object.freeze({
  'flux2-klein': Object.freeze(['UNETLoader', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'EmptyFlux2LatentImage', 'RandomNoise', 'CFGGuider', 'KSamplerSelect', 'Flux2Scheduler', 'SamplerCustomAdvanced', 'VAEDecode', 'SaveImage']),
  'qwen-image': Object.freeze(['UNETLoader', 'LoraLoaderModelOnly', 'CLIPLoader', 'VAELoader', 'ModelSamplingAuraFlow', 'CLIPTextEncode', 'EmptySD3LatentImage', 'KSampler', 'VAEDecode', 'SaveImage']),
  'qwen-image-edit-2511': Object.freeze(['UNETLoader', 'LoraLoaderModelOnly', 'CLIPLoader', 'VAELoader', 'LoadImage', 'FluxKontextImageScale', 'ResizeAndPadImage', 'TextEncodeQwenImageEditPlus', 'VAEEncode', 'ModelSamplingAuraFlow', 'CFGNorm', 'KSampler', 'VAEDecode', 'SaveImage']),
  'hidream-i1-full': Object.freeze(['UNETLoader', 'QuadrupleCLIPLoader', 'VAELoader', 'ModelSamplingSD3', 'CLIPTextEncode', 'EmptySD3LatentImage', 'KSampler', 'VAEDecode', 'SaveImage']),
  'newbie-image-exp01': Object.freeze(['UNETLoader', 'DualCLIPLoader', 'VAELoader', 'ModelSamplingAuraFlow', 'CLIPTextEncode', 'EmptySD3LatentImage', 'KSampler', 'VAEDecode', 'SaveImage']),
  'krea2-turbo': Object.freeze(['UNETLoader', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'ConditioningZeroOut', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage']),
  'z-image-turbo': Object.freeze(['UNETLoader', 'CLIPLoader', 'VAELoader', 'ModelSamplingAuraFlow', 'CLIPTextEncode', 'ConditioningZeroOut', 'EmptySD3LatentImage', 'KSampler', 'VAEDecode', 'SaveImage']),
  'anima-base-v1': Object.freeze(['UNETLoader', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage']),
});

const ANIMA_INPAINT_REQUIRED_NODES = Object.freeze(['ModelPatchLoader', 'LoadImage', 'ImageToMask', 'AnimaLLLiteApply', 'VAEEncode', 'SetLatentNoiseMask']);

const FAMILY_LABELS = Object.freeze({
  'flux2-klein': 'FLUX.2 Klein',
  'qwen-image': 'Qwen Image',
  'qwen-image-edit-2511': 'Qwen Image Edit 2511',
  'hidream-i1-full': 'HiDream-I1 Full',
  'newbie-image-exp01': 'NewBie Image',
  'krea2-turbo': 'Krea 2 Turbo',
  'z-image-turbo': 'Z-Image Turbo',
  'anima-base-v1': 'Anima Base v1',
});

function abortError() {
  const error = new Error('任务已取消');
  error.name = 'AbortError';
  return error;
}

function sleep(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function responseJson(response, label) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label}：HTTP ${response.status}${payload?.error ? ` · ${payload.error}` : ''}`);
  return payload;
}

function familyFor(config) {
  const family = String(config?.family || '').trim();
  if (!FAMILY_DEFAULTS[family]) throw new Error(`不支持的本地 ComfyUI 基础模型架构：${family || '未配置'}`);
  return family;
}

function safeResourceName(value, label) {
  const name = String(value || '').trim();
  if (!name || name.length > 220 || /[<>:"|?*\r\n]/.test(name) || name.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label}文件名无效`);
  }
  return name;
}

function resourceConfig(config) {
  const value = config?.resources && typeof config.resources === 'object' && !Array.isArray(config.resources) ? config.resources : {};
  return Object.fromEntries(Object.entries(value).map(([key, name]) => [key, safeResourceName(name, key)]));
}

function normalizedResolution(value) {
  const resolution = String(value || '1K').trim().toUpperCase();
  return ['1K', '2K', '4K'].includes(resolution) ? resolution : '1K';
}

function nextNodeId(graph) {
  let id = Math.max(0, ...Object.keys(graph).map(Number).filter(Number.isSafeInteger)) + 1;
  while (Object.hasOwn(graph, String(id))) id += 1;
  return String(id);
}

function applyOutputResolution(graph, ratio, resolution, upscaleModelValue) {
  const target = normalizedResolution(resolution);
  if (target === '1K') return graph;
  const upscaleModel = safeResourceName(upscaleModelValue, '超分模型');
  const outputs = Object.values(graph).filter((node) => ['SaveImage', 'PreviewImage'].includes(String(node?.class_type || '')) && Array.isArray(node?.inputs?.images));
  if (!outputs.length) throw new Error(`${target} 输出需要工作流包含 SaveImage 或 PreviewImage 节点`);
  const { width, height } = illustriousOutputDimensions(ratio, target);
  const loaderId = nextNodeId(graph);
  graph[loaderId] = { class_type: 'UpscaleModelLoader', inputs: { model_name: upscaleModel }, _meta: { title: `AI Canvas · ${target} 超分模型` } };
  outputs.forEach((output) => {
    const upscaleId = nextNodeId(graph);
    graph[upscaleId] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: [loaderId, 0], image: [...output.inputs.images] }, _meta: { title: 'AI Canvas · 模型放大' } };
    const scaleId = nextNodeId(graph);
    graph[scaleId] = { class_type: 'ImageScale', inputs: { image: [upscaleId, 0], upscale_method: 'lanczos', width, height, crop: 'disabled' }, _meta: { title: `AI Canvas · 精确输出 ${width}×${height}` } };
    output.inputs.images = [scaleId, 0];
  });
  return graph;
}

function addNode(graph, classType, inputs, title = '', role = '') {
  const id = nextNodeId(graph);
  graph[id] = { class_type: classType, inputs, ...((title || role) ? { _meta: { ...(title ? { title } : {}), ...(role ? { aiCanvasRole: role } : {}) } } : {}) };
  return id;
}

function addCanvasFitNode(graph, image, width, height, { title = 'AI Canvas · 画幅适配', role = 'outputCanvas', paddingColor = 'white' } = {}) {
  return addNode(graph, 'ResizeAndPadImage', {
    image,
    target_width: width,
    target_height: height,
    padding_color: paddingColor,
    interpolation: 'lanczos',
  }, title, role);
}

function baseSettings(config, options = {}) {
  const family = familyFor(config);
  const defaults = FAMILY_DEFAULTS[family];
  const { width, height } = illustriousDimensions(options.ratio || config.defaultRatio || '3:4');
  const resources = resourceConfig(config);
  if (family === 'z-image-turbo' && !resources.poseControl) resources.poseControl = Z_IMAGE_POSE_CONTROL_MODEL;
  return {
    family,
    resources,
    prompt: String(options.prompt || '').trim(),
    negativePrompt: String(options.negativePrompt || '').trim(),
    width,
    height,
    seed: Number.isInteger(Number(options.seed)) ? Number(options.seed) : 1,
    steps: Math.max(1, Math.min(100, Math.round(Number(options.steps ?? config.steps) || defaults.steps))),
    cfg: Math.max(0, Math.min(30, Number(options.cfg ?? config.cfg) || defaults.cfg)),
    sampler: String(options.sampler || config.sampler || defaults.sampler).trim(),
    scheduler: String(options.scheduler || config.scheduler || defaults.scheduler).trim(),
    denoise: Math.max(0.05, Math.min(1, Number(options.denoise) || 1)),
    referenceImage: String(options.referenceImage || '').trim(),
    maskImage: String(options.maskImage || '').trim(),
    poseImage: String(options.poseImage || '').trim(),
    styleLora: String(options.styleLora || '').trim() ? safeResourceName(options.styleLora, '画风 LoRA') : '',
    workflowId: String(options.workflowId || '').trim(),
    poseStrength: Math.max(0, Math.min(2, Number(options.poseStrength) || 0.85)),
    filenamePrefix: String(options.filenamePrefix || 'AI_Canvas_Native').trim(),
  };
}

export function nativePoseModeForFamily(family) {
  const normalized = String(family || '');
  if (normalized === 'z-image-turbo') return 'exact';
  return ['flux2-klein', 'qwen-image-edit-2511', 'hidream-i1-full', 'newbie-image-exp01', 'krea2-turbo'].includes(normalized) ? 'guided' : 'unsupported';
}

export function nativePoseGuidedDenoise(strength = 0.85) {
  const bounded = Math.max(0.55, Math.min(1, Number(strength) || 0.85));
  return Math.round((0.92 - ((bounded - 0.55) / 0.45) * 0.18) * 100) / 100;
}

function poseGuidancePrompt(prompt, strength, poseImageIndex = 1) {
  const instruction = Number(strength) >= 0.95
    ? `Strictly follow the complete human body pose and limb placement shown in reference image ${poseImageIndex}; keep both arms, both legs, hands and feet visible.`
    : Number(strength) >= 0.8
      ? `Follow the complete human body pose shown in reference image ${poseImageIndex}, including torso direction and limb placement.`
      : `Use the human body pose in reference image ${poseImageIndex} as a composition guide.`;
  return `${instruction}\n${String(prompt || '').trim()}`.trim();
}

export function nativeImageJobDenoise(options = {}, hasReference = false) {
  return hasReference
    ? options.referenceDenoise ?? options.comfyDenoise ?? 1
    : options.comfyDenoise ?? 1;
}

export function nativeImageFilenamePrefix(family, jobId, outputIndex = 0) {
  const normalizedFamily = familyFor({ family });
  const safeJobId = String(jobId || 'node').replace(/[^a-zA-Z0-9_-]/g, '_');
  const sequence = Math.max(1, Math.floor(Number(outputIndex) || 0) + 1);
  // The shared ComfyUI output is mounted through a Windows junction. In the
  // current Desktop runtime SaveImage can write into an existing directory,
  // but creating a new family subdirectory can fail with WinError 183.
  // Keep newly added families in the already-existing AI_Canvas_Native directory while
  // retaining the family, job and output index in its unique filename.
  if (['anima-base-v1', 'qwen-image'].includes(normalizedFamily)) return `AI_Canvas_Native/${normalizedFamily}-${safeJobId}-${sequence}`;
  return `AI_Canvas_Native/${normalizedFamily}/${safeJobId}-${sequence}`;
}

export function buildComfyUiNativePrompt(config = {}, options = {}) {
  const value = baseSettings(config, options);
  if (!value.prompt) throw new Error('本地 ComfyUI 基础模型需要提示词');
  const r = value.resources;
  const graph = {};
  const unet = addNode(graph, 'UNETLoader', { unet_name: r.unet, weight_dtype: 'default' }, 'AI Canvas · 基础模型', 'model');
  let model = [unet, 0];
  if (value.styleLora) {
    const styleLora = addNode(graph, 'LoraLoaderModelOnly', { model, lora_name: value.styleLora, strength_model: 0.8 }, 'AI Canvas · 画风 LoRA', 'selectedStyleLora');
    model = [styleLora, 0];
  }
  let clip;
  let vae;
  let positive;
  let negative;
  let latent;
  let samples;

  if (value.family === 'flux2-klein') {
    clip = addNode(graph, 'CLIPLoader', { clip_name: r.clip, type: 'flux2', device: 'default' }, 'AI Canvas · FLUX.2 文本编码器', 'clip');
    vae = addNode(graph, 'VAELoader', { vae_name: r.vae }, 'AI Canvas · FLUX.2 VAE', 'vae');
    positive = addNode(graph, 'CLIPTextEncode', { text: value.poseImage ? poseGuidancePrompt(value.prompt, value.poseStrength, value.referenceImage ? 2 : 1) : value.prompt, clip: [clip, 0] }, '正向提示词', 'positivePrompt');
    negative = addNode(graph, 'CLIPTextEncode', { text: value.negativePrompt, clip: [clip, 0] }, '负向提示词', 'negativePrompt');
    if (value.referenceImage) {
      const reference = addNode(graph, 'LoadImage', { image: value.referenceImage }, 'AI Canvas · 画面参考图', 'referenceImage');
      const referenceCanvas = addCanvasFitNode(graph, [reference, 0], value.width, value.height, { title: 'AI Canvas · 画面参考适配', role: 'referenceCanvas' });
      const referenceLatent = addNode(graph, 'VAEEncode', { pixels: [referenceCanvas, 0], vae: [vae, 0] }, 'AI Canvas · FLUX.2 画面参考编码');
      positive = addNode(graph, 'ReferenceLatent', { conditioning: [positive, 0], latent: [referenceLatent, 0] }, 'AI Canvas · FLUX.2 正向画面参考');
      negative = addNode(graph, 'ReferenceLatent', { conditioning: [negative, 0], latent: [referenceLatent, 0] }, 'AI Canvas · FLUX.2 负向画面参考');
    }
    if (value.poseImage) {
      const pose = addNode(graph, 'LoadImage', { image: value.poseImage }, 'AI Canvas · 已缓存骨架图', 'poseImage');
      const poseLatent = addNode(graph, 'VAEEncode', { pixels: [pose, 0], vae: [vae, 0] }, 'AI Canvas · FLUX.2 骨架参考编码');
      positive = addNode(graph, 'ReferenceLatent', { conditioning: [positive, 0], latent: [poseLatent, 0] }, 'AI Canvas · FLUX.2 正向骨架引导');
      negative = addNode(graph, 'ReferenceLatent', { conditioning: [negative, 0], latent: [poseLatent, 0] }, 'AI Canvas · FLUX.2 负向骨架引导');
    }
    latent = addNode(graph, 'EmptyFlux2LatentImage', { width: value.width, height: value.height, batch_size: 1 }, 'AI Canvas · 画幅', 'latent');
    const noise = addNode(graph, 'RandomNoise', { noise_seed: value.seed }, 'AI Canvas · 随机种子', 'seed');
    const guider = addNode(graph, 'CFGGuider', { model, positive: [positive, 0], negative: [negative, 0], cfg: value.cfg }, 'AI Canvas · 引导', 'cfg');
    const sampler = addNode(graph, 'KSamplerSelect', { sampler_name: value.sampler }, 'AI Canvas · 采样器', 'sampler');
    const sigmas = addNode(graph, 'Flux2Scheduler', { steps: value.steps, width: value.width, height: value.height }, 'AI Canvas · FLUX.2 调度', 'scheduler');
    samples = addNode(graph, 'SamplerCustomAdvanced', { noise: [noise, 0], guider: [guider, 0], sampler: [sampler, 0], sigmas: [sigmas, 0], latent_image: [latent, 0] }, 'AI Canvas · FLUX.2 采样');
  } else if (value.family === 'qwen-image') {
    const lightning = addNode(graph, 'LoraLoaderModelOnly', { model, lora_name: r.lora, strength_model: 1 }, 'AI Canvas · Qwen 8步加速', 'modelLora');
    model = [addNode(graph, 'ModelSamplingAuraFlow', { model: [lightning, 0], shift: 3.1 }, 'AI Canvas · Qwen 采样修正'), 0];
    clip = addNode(graph, 'CLIPLoader', { clip_name: r.clip, type: 'qwen_image', device: 'default' }, 'AI Canvas · Qwen 文本编码器', 'clip');
    vae = addNode(graph, 'VAELoader', { vae_name: r.vae }, 'AI Canvas · Qwen VAE', 'vae');
    positive = addNode(graph, 'CLIPTextEncode', { text: value.prompt, clip: [clip, 0] }, '正向提示词', 'positivePrompt');
    negative = addNode(graph, 'CLIPTextEncode', { text: value.negativePrompt, clip: [clip, 0] }, '负向提示词', 'negativePrompt');
    latent = addNode(graph, 'EmptySD3LatentImage', { width: value.width, height: value.height, batch_size: 1 }, 'AI Canvas · 画幅', 'latent');
    samples = addNode(graph, 'KSampler', { model, seed: value.seed, steps: value.steps, cfg: value.cfg, sampler_name: value.sampler, scheduler: value.scheduler, positive: [positive, 0], negative: [negative, 0], latent_image: [latent, 0], denoise: 1 }, 'AI Canvas · Qwen 生图', 'samplerNode');
  } else if (value.family === 'qwen-image-edit-2511') {
    if (!value.referenceImage) throw new Error('Qwen Image Edit 2511 需要连接 1 张角色外观图');
    const lora = addNode(graph, 'LoraLoaderModelOnly', { model, lora_name: r.lora, strength_model: 1 }, 'AI Canvas · Qwen Lightning 4步', 'modelLora');
    const sampled = addNode(graph, 'ModelSamplingAuraFlow', { model: [lora, 0], shift: 3.1 }, 'AI Canvas · Qwen 采样修正');
    const normalized = addNode(graph, 'CFGNorm', { model: [sampled, 0], strength: 1, pre_cfg: false }, 'AI Canvas · Qwen CFG 修正');
    model = [normalized, 0];
    clip = addNode(graph, 'CLIPLoader', { clip_name: r.clip, type: 'qwen_image', device: 'default' }, 'AI Canvas · Qwen 文本编码器', 'clip');
    vae = addNode(graph, 'VAELoader', { vae_name: r.vae }, 'AI Canvas · Qwen VAE', 'vae');
    const load = addNode(graph, 'LoadImage', { image: value.referenceImage }, 'AI Canvas · 角色外观图', 'referenceImage');
    const scaled = addNode(graph, 'FluxKontextImageScale', { image: [load, 0] }, 'AI Canvas · 角色外观图适配');
    let poseScaled;
    if (value.poseImage) {
      const pose = addNode(graph, 'LoadImage', { image: value.poseImage }, 'AI Canvas · 已缓存骨架图', 'poseImage');
      poseScaled = addNode(graph, 'FluxKontextImageScale', { image: [pose, 0] }, 'AI Canvas · 骨架参考图适配');
    }
    const qwenImages = { image1: [scaled, 0], ...(poseScaled ? { image2: [poseScaled, 0] } : {}) };
    positive = addNode(graph, 'TextEncodeQwenImageEditPlus', { clip: [clip, 0], prompt: value.poseImage ? poseGuidancePrompt(value.prompt, value.poseStrength, 2) : value.prompt, vae: [vae, 0], ...qwenImages }, '正向编辑指令', 'positivePrompt');
    negative = addNode(graph, 'TextEncodeQwenImageEditPlus', { clip: [clip, 0], prompt: value.negativePrompt, vae: [vae, 0], ...qwenImages }, '负向编辑约束', 'negativePrompt');
    const outputCanvas = addCanvasFitNode(graph, [scaled, 0], value.width, value.height, { title: 'AI Canvas · 角色外观图画幅适配' });
    latent = addNode(graph, 'VAEEncode', { pixels: [outputCanvas, 0], vae: [vae, 0] }, 'AI Canvas · 角色外观图编码');
    samples = addNode(graph, 'KSampler', { model, seed: value.seed, steps: value.steps, cfg: value.cfg, sampler_name: value.sampler, scheduler: value.scheduler, positive: [positive, 0], negative: [negative, 0], latent_image: [latent, 0], denoise: value.denoise }, 'AI Canvas · Qwen 编辑采样', 'samplerNode');
  } else if (value.family === 'anima-base-v1') {
    const inpaint = value.workflowId === 'anima-base-v1-inpaint-v1';
    clip = addNode(graph, 'CLIPLoader', { clip_name: r.clip, type: 'stable_diffusion', device: 'default' }, 'AI Canvas · Anima 文本编码器', 'clip');
    vae = addNode(graph, 'VAELoader', { vae_name: r.vae }, 'AI Canvas · Anima VAE', 'vae');
    positive = addNode(graph, 'CLIPTextEncode', { text: value.prompt, clip: [clip, 0] }, '正向提示词', 'positivePrompt');
    negative = addNode(graph, 'CLIPTextEncode', { text: value.negativePrompt, clip: [clip, 0] }, '负向提示词', 'negativePrompt');
    if (inpaint) {
      if (!value.referenceImage) throw new Error('Anima 局部重绘需要连接 1 张原图');
      if (!value.maskImage) throw new Error('Anima 局部重绘需要连接 1 张重绘蒙版');
      const patch = addNode(graph, 'ModelPatchLoader', { name: r.inpaint }, 'AI Canvas · Anima LLLite 局部重绘权重', 'inpaintModel');
      const source = addNode(graph, 'LoadImage', { image: value.referenceImage }, 'AI Canvas · 局部重绘原图', 'referenceImage');
      const maskSource = addNode(graph, 'LoadImage', { image: value.maskImage }, 'AI Canvas · 重绘蒙版（白色重绘）', 'maskImage');
      const mask = addNode(graph, 'ImageToMask', { image: [maskSource, 0], channel: 'red' }, 'AI Canvas · 提取重绘蒙版');
      model = [addNode(graph, 'AnimaLLLiteApply', { model, model_patch: [patch, 0], image: [source, 0], strength: 1, start_percent: 0, end_percent: 1, mask: [mask, 0] }, 'AI Canvas · 应用 Anima LLLite'), 0];
      const encoded = addNode(graph, 'VAEEncode', { pixels: [source, 0], vae: [vae, 0] }, 'AI Canvas · 原图编码');
      latent = addNode(graph, 'SetLatentNoiseMask', { samples: [encoded, 0], mask: [mask, 0] }, 'AI Canvas · 仅在白色区域重绘', 'latent');
    } else {
      latent = addNode(graph, 'EmptyLatentImage', { width: value.width, height: value.height, batch_size: 1 }, 'AI Canvas · 画幅', 'latent');
    }
    samples = addNode(graph, 'KSampler', { model, seed: value.seed, steps: value.steps, cfg: value.cfg, sampler_name: value.sampler, scheduler: value.scheduler, positive: [positive, 0], negative: [negative, 0], latent_image: [latent, 0], denoise: inpaint ? value.denoise : 1 }, inpaint ? 'AI Canvas · Anima 局部重绘采样' : 'AI Canvas · Anima 基础采样', 'samplerNode');
  } else {
    if (value.family === 'hidream-i1-full') {
      clip = addNode(graph, 'QuadrupleCLIPLoader', { clip_name1: r.clip1, clip_name2: r.clip2, clip_name3: r.clip3, clip_name4: r.clip4 }, 'AI Canvas · HiDream 四路编码器', 'clip');
      model = [addNode(graph, 'ModelSamplingSD3', { model, shift: 3 }, 'AI Canvas · HiDream 采样修正'), 0];
    } else if (value.family === 'newbie-image-exp01') {
      clip = addNode(graph, 'DualCLIPLoader', { clip_name1: r.clip1, clip_name2: r.clip2, type: 'newbie', device: 'default' }, 'AI Canvas · NewBie 双编码器', 'clip');
      model = [addNode(graph, 'ModelSamplingAuraFlow', { model, shift: 6 }, 'AI Canvas · NewBie 采样修正'), 0];
    } else if (value.family === 'z-image-turbo') {
      clip = addNode(graph, 'CLIPLoader', { clip_name: r.clip, type: 'lumina2', device: 'default' }, 'AI Canvas · Z-Image 文本编码器', 'clip');
    } else {
      clip = addNode(graph, 'CLIPLoader', { clip_name: r.clip, type: 'krea2', device: 'default' }, 'AI Canvas · Krea 2 编码器', 'clip');
    }
    vae = addNode(graph, 'VAELoader', { vae_name: r.vae }, 'AI Canvas · VAE', 'vae');
    if (value.family === 'z-image-turbo') {
      if (value.poseImage) {
        const patch = addNode(graph, 'ModelPatchLoader', { name: r.poseControl }, 'AI Canvas · Z-Image 姿势控制器', 'poseControlModel');
        const pose = addNode(graph, 'LoadImage', { image: value.poseImage }, 'AI Canvas · 已缓存骨架图', 'poseImage');
        model = [addNode(graph, 'ZImageFunControlnet', { model, model_patch: [patch, 0], vae: [vae, 0], strength: value.poseStrength, image: [pose, 0] }, 'AI Canvas · Z-Image 严格姿势控制'), 0];
      }
      model = [addNode(graph, 'ModelSamplingAuraFlow', { model, shift: 3 }, 'AI Canvas · Z-Image Turbo 采样修正'), 0];
    }
    positive = addNode(graph, 'CLIPTextEncode', { text: value.poseImage && value.family !== 'z-image-turbo' ? poseGuidancePrompt(value.prompt, value.poseStrength) : value.prompt, clip: [clip, 0] }, '正向提示词', 'positivePrompt');
    negative = value.family === 'krea2-turbo' || value.family === 'z-image-turbo'
      ? addNode(graph, 'ConditioningZeroOut', { conditioning: [positive, 0] }, `${value.family === 'z-image-turbo' ? 'Z-Image' : 'Krea 2'} Turbo · 零负向条件`, 'negativePrompt')
      : addNode(graph, 'CLIPTextEncode', { text: value.negativePrompt, clip: [clip, 0] }, '负向提示词', 'negativePrompt');
    if (value.referenceImage) {
      const reference = addNode(graph, 'LoadImage', { image: value.referenceImage }, 'AI Canvas · 画面参考图', 'referenceImage');
      const referenceCanvas = addCanvasFitNode(graph, [reference, 0], value.width, value.height, { title: 'AI Canvas · 画面参考适配', role: 'referenceCanvas' });
      latent = addNode(graph, 'VAEEncode', { pixels: [referenceCanvas, 0], vae: [vae, 0] }, 'AI Canvas · 画面参考编码', 'latent');
    } else if (value.poseImage && value.family !== 'z-image-turbo') {
      const pose = addNode(graph, 'LoadImage', { image: value.poseImage }, 'AI Canvas · 已缓存骨架图', 'poseImage');
      const poseCanvas = addCanvasFitNode(graph, [pose, 0], value.width, value.height, { title: 'AI Canvas · 骨架图画幅适配', role: 'poseCanvas', paddingColor: 'black' });
      latent = addNode(graph, 'VAEEncode', { pixels: [poseCanvas, 0], vae: [vae, 0] }, 'AI Canvas · 骨架重绘初始结构', 'latent');
    } else {
      latent = addNode(graph, ['hidream-i1-full', 'newbie-image-exp01', 'z-image-turbo'].includes(value.family) ? 'EmptySD3LatentImage' : 'EmptyLatentImage', { width: value.width, height: value.height, batch_size: 1 }, 'AI Canvas · 画幅', 'latent');
    }
    const denoise = value.referenceImage
      ? value.denoise
      : value.poseImage && value.family !== 'z-image-turbo' ? nativePoseGuidedDenoise(value.poseStrength) : value.denoise;
    samples = addNode(graph, 'KSampler', { model, seed: value.seed, steps: value.steps, cfg: value.cfg, sampler_name: value.sampler, scheduler: value.scheduler, positive: [positive, 0], negative: [negative, 0], latent_image: [latent, 0], denoise }, 'AI Canvas · 采样', 'samplerNode');
  }

  const decoded = addNode(graph, 'VAEDecode', { samples: [samples, 0], vae: [vae, 0] }, 'AI Canvas · 解码');
  addNode(graph, 'SaveImage', { filename_prefix: value.filenamePrefix, images: [decoded, 0] }, 'AI Canvas · 保存');
  return applyOutputResolution(graph, options.ratio || config.defaultRatio || '3:4', options.resolution, config.upscaleModel);
}

function nodeRole(node) {
  const explicit = String(node?._meta?.aiCanvasRole || '').trim();
  if (explicit) return explicit;
  const title = String(node?._meta?.title || '').trim().toLowerCase();
  if (/正向|positive/.test(title)) return 'positivePrompt';
  if (/负向|negative/.test(title)) return 'negativePrompt';
  if (/随机种子|\bseed\b/.test(title)) return 'seed';
  if (/提示词引导|\bcfg\b/.test(title)) return 'cfg';
  if (/采样器|sampler select/.test(title)) return 'sampler';
  if (/调度|scheduler/.test(title)) return 'scheduler';
  if (/画幅|latent/.test(title)) return 'latent';
  if (/蒙版|mask/.test(title)) return 'maskImage';
  if (/参考图|reference image/.test(title)) return 'referenceImage';
  if (/lightning|模型 lora/.test(title)) return 'modelLora';
  return '';
}

function applySelectedStyleLora(graph, value) {
  const existingEntry = Object.entries(graph).find(([, node]) => node?.class_type === 'LoraLoaderModelOnly' && nodeRole(node) === 'selectedStyleLora');
  if (!value.styleLora) {
    if (!existingEntry) return graph;
    const [existingId, existingNode] = existingEntry;
    const previousModel = existingNode?.inputs?.model;
    Object.values(graph).forEach((node) => {
      if (!node?.inputs || typeof node.inputs !== 'object') return;
      if (Array.isArray(node.inputs.model) && String(node.inputs.model[0]) === existingId && Number(node.inputs.model[1]) === 0) node.inputs.model = previousModel;
    });
    delete graph[existingId];
    return graph;
  }
  const existing = existingEntry?.[1];
  if (existing) {
    existing.inputs.lora_name = value.styleLora;
    existing.inputs.strength_model = 0.8;
    return graph;
  }
  const unetId = Object.entries(graph).find(([, node]) => node?.class_type === 'UNETLoader')?.[0];
  if (!unetId) throw new Error('当前工作流没有可连接画风 LoRA 的基础模型节点');
  const loraId = addNode(graph, 'LoraLoaderModelOnly', { model: [unetId, 0], lora_name: value.styleLora, strength_model: 0.8 }, 'AI Canvas · 画风 LoRA', 'selectedStyleLora');
  Object.entries(graph).forEach(([nodeId, node]) => {
    if (nodeId === loraId || !node?.inputs || typeof node.inputs !== 'object') return;
    if (Array.isArray(node.inputs.model) && String(node.inputs.model[0]) === unetId && Number(node.inputs.model[1]) === 0) node.inputs.model = [loraId, 0];
  });
  return graph;
}

function applyNativeState(graph, config, options) {
  const value = baseSettings(config, options);
  const r = value.resources;
  const graphNodes = Object.values(graph);
  const textNodes = graphNodes.filter((node) => ['CLIPTextEncode', 'TextEncodeQwenImageEditPlus'].includes(String(node?.class_type || '')));
  graphNodes.forEach((node) => {
    if (!node?.inputs || typeof node.inputs !== 'object') return;
    const role = nodeRole(node) || (node === textNodes[0] ? 'positivePrompt' : node === textNodes[1] ? 'negativePrompt' : '');
    if (node.class_type === 'UNETLoader' && r.unet) node.inputs.unet_name = r.unet;
    if (node.class_type === 'VAELoader' && r.vae) node.inputs.vae_name = r.vae;
    if (node.class_type === 'CLIPLoader' && r.clip) node.inputs.clip_name = r.clip;
    if (node.class_type === 'DualCLIPLoader') {
      if (r.clip1) node.inputs.clip_name1 = r.clip1;
      if (r.clip2) node.inputs.clip_name2 = r.clip2;
    }
    if (node.class_type === 'QuadrupleCLIPLoader') ['clip1', 'clip2', 'clip3', 'clip4'].forEach((key, index) => { if (r[key]) node.inputs[`clip_name${index + 1}`] = r[key]; });
    if (node.class_type === 'LoraLoaderModelOnly' && role === 'modelLora' && r.lora) node.inputs.lora_name = r.lora;
    if (node.class_type === 'ModelPatchLoader' && role === 'inpaintModel' && r.inpaint) node.inputs.name = r.inpaint;
    if (['EmptyLatentImage', 'EmptySD3LatentImage', 'EmptyFlux2LatentImage'].includes(node.class_type)) {
      node.inputs.width = value.width; node.inputs.height = value.height; node.inputs.batch_size = 1;
    }
    if (node.class_type === 'ResizeAndPadImage' && ['outputCanvas', 'poseCanvas'].includes(role)) {
      node.inputs.target_width = value.width; node.inputs.target_height = value.height;
    }
    if (node.class_type === 'Flux2Scheduler') { node.inputs.steps = value.steps; node.inputs.width = value.width; node.inputs.height = value.height; }
    if (node.class_type === 'RandomNoise' && Object.hasOwn(node.inputs, 'noise_seed')) node.inputs.noise_seed = value.seed;
    if (node.class_type === 'CFGGuider' && Object.hasOwn(node.inputs, 'cfg')) node.inputs.cfg = value.cfg;
    if (node.class_type === 'KSamplerSelect' && Object.hasOwn(node.inputs, 'sampler_name')) node.inputs.sampler_name = value.sampler;
    if (node.class_type === 'KSampler') {
      Object.assign(node.inputs, { seed: value.seed, steps: value.steps, cfg: value.cfg, sampler_name: value.sampler, scheduler: value.scheduler, denoise: value.denoise });
    }
    if (node.class_type === 'CLIPTextEncode' && role === 'positivePrompt') node.inputs.text = value.prompt;
    if (node.class_type === 'CLIPTextEncode' && role === 'negativePrompt') node.inputs.text = value.negativePrompt;
    if (node.class_type === 'TextEncodeQwenImageEditPlus' && role === 'positivePrompt') node.inputs.prompt = value.prompt;
    if (node.class_type === 'TextEncodeQwenImageEditPlus' && role === 'negativePrompt') node.inputs.prompt = value.negativePrompt;
    if (node.class_type === 'LoadImage') {
      if (role === 'maskImage' && value.maskImage) node.inputs.image = value.maskImage;
      else if (role === 'poseImage' && value.poseImage) node.inputs.image = value.poseImage;
      else if (value.referenceImage) node.inputs.image = value.referenceImage;
    }
    if (node.class_type === 'SaveImage') node.inputs.filename_prefix = value.filenamePrefix;
  });
  applySelectedStyleLora(graph, value);
  return applyOutputResolution(graph, options.ratio || config.defaultRatio || '3:4', options.resolution, config.upscaleModel);
}

export function prepareComfyUiNativePrompt(prompt, config = {}, options = {}) {
  if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return null;
  return applyNativeState(JSON.parse(JSON.stringify(prompt)), config, options);
}

function optionNames(payload, nodeName, fieldName) {
  const input = payload?.[nodeName]?.input?.required?.[fieldName];
  if (Array.isArray(input?.[0])) return input[0].map(String);
  if (Array.isArray(input?.[1]?.options)) return input[1].options.map(String);
  return [];
}

function nativePoseRequiredNodes(family, poseEstimator, previewOnly = false) {
  const preprocessor = poseEstimator === 'dwpose'
    ? ['LoadImage', 'DWPreprocessor', 'ResizeAndPadImage', 'SaveImage']
    : ['LoadImage', 'CheckpointLoaderSimple', 'ImageScaleToMaxDimension', 'SDPoseKeypointExtractor', 'SDPoseDrawKeypoints', 'ResizeAndPadImage', 'SaveImage'];
  if (previewOnly) return preprocessor;
  const compiler = family === 'z-image-turbo'
    ? ['ModelPatchLoader', 'ZImageFunControlnet']
    : family === 'flux2-klein'
      ? ['VAEEncode', 'ReferenceLatent']
      : family === 'qwen-image-edit-2511'
        ? ['FluxKontextImageScale', 'TextEncodeQwenImageEditPlus']
        : ['VAEEncode'];
  return [...preprocessor, ...compiler];
}

export async function inspectComfyUiNativeImage(config = {}, fetchImpl = fetch, { resolution = '1K', referenceEnabled = false, poseEnabled = false, poseEstimator = 'sdpose', previewOnly = false, workflowId = '', styleLora = '' } = {}) {
  const baseUrl = comfyUiIllustriousBaseUrl(config.baseUrl);
  try {
    const family = familyFor(config);
    const value = baseSettings(config, { styleLora });
    const resources = value.resources;
    const response = await fetchImpl(`${baseUrl}/object_info`);
    const info = await response.json().catch(() => ({}));
    if (!response.ok) return { available: false, baseUrl, error: `ComfyUI 节点目录读取失败：HTTP ${response.status}` };
    const requiredNodes = [
      ...(previewOnly ? [] : FAMILY_REQUIRED_NODES[family]),
      ...(!previewOnly && value.styleLora ? ['LoraLoaderModelOnly'] : []),
      ...(!previewOnly && family === 'anima-base-v1' && workflowId === 'anima-base-v1-inpaint-v1' ? ANIMA_INPAINT_REQUIRED_NODES : []),
      ...(!previewOnly && referenceEnabled && family !== 'qwen-image-edit-2511' ? ['LoadImage', 'ResizeAndPadImage', 'VAEEncode'] : []),
      ...(poseEnabled ? nativePoseRequiredNodes(family, poseEstimator, previewOnly) : []),
    ];
    const missingNodes = requiredNodes.filter((name) => !info?.[name]);
    if (!previewOnly && normalizedResolution(resolution) !== '1K') missingNodes.push(...['UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScale'].filter((name) => !info?.[name]));
    if (missingNodes.length) return { available: false, baseUrl, error: `当前 ComfyUI 缺少节点：${[...new Set(missingNodes)].join('、')}` };
    const missingResources = [];
    if (!previewOnly) {
      if (!optionNames(info, 'UNETLoader', 'unet_name').includes(resources.unet)) missingResources.push(resources.unet);
      const clipChecks = family === 'hidream-i1-full'
        ? [['QuadrupleCLIPLoader', 'clip_name1', resources.clip1], ['QuadrupleCLIPLoader', 'clip_name2', resources.clip2], ['QuadrupleCLIPLoader', 'clip_name3', resources.clip3], ['QuadrupleCLIPLoader', 'clip_name4', resources.clip4]]
        : family === 'newbie-image-exp01'
          ? [['DualCLIPLoader', 'clip_name1', resources.clip1], ['DualCLIPLoader', 'clip_name2', resources.clip2]]
          : [['CLIPLoader', 'clip_name', resources.clip]];
      clipChecks.forEach(([node, field, name]) => { if (!optionNames(info, node, field).includes(name)) missingResources.push(name); });
      if (!optionNames(info, 'VAELoader', 'vae_name').includes(resources.vae)) missingResources.push(resources.vae);
      if (resources.lora && !optionNames(info, 'LoraLoaderModelOnly', 'lora_name').includes(resources.lora)) missingResources.push(resources.lora);
      if (value.styleLora && !optionNames(info, 'LoraLoaderModelOnly', 'lora_name').includes(value.styleLora)) missingResources.push(value.styleLora);
      if (poseEnabled && family === 'z-image-turbo' && !optionNames(info, 'ModelPatchLoader', 'name').includes(resources.poseControl)) missingResources.push(resources.poseControl);
      if (family === 'anima-base-v1' && workflowId === 'anima-base-v1-inpaint-v1' && !optionNames(info, 'ModelPatchLoader', 'name').includes(resources.inpaint)) missingResources.push(resources.inpaint);
      if (normalizedResolution(resolution) !== '1K' && !optionNames(info, 'UpscaleModelLoader', 'model_name').includes(String(config.upscaleModel || ''))) missingResources.push(config.upscaleModel);
    }
    if (poseEnabled && poseEstimator !== 'dwpose' && !optionNames(info, 'CheckpointLoaderSimple', 'ckpt_name').includes('sdpose_wholebody_fp16.safetensors')) missingResources.push('sdpose_wholebody_fp16.safetensors');
    if (missingResources.filter(Boolean).length) return { available: false, baseUrl, error: `ComfyUI 尚未识别模型文件：${missingResources.filter(Boolean).join('、')}` };
    return { available: true, baseUrl, family, resources, poseMode: poseEnabled ? nativePoseModeForFamily(family) : undefined, error: '' };
  } catch {
    return { available: false, baseUrl, error: 'ComfyUI 未启动或本地端口不可访问' };
  }
}

export async function uploadComfyUiNativeReference(fetchImpl, baseUrl, reference, signal, { persistent = false, namespace = 'editor', inputDirectory = '' } = {}) {
  const extension = /\.[a-z0-9]{1,8}$/i.exec(reference.fileName || '')?.[0] || ({ 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png' })[reference.mimeType] || '.png';
  const persistentNamespace = namespace === 'cache' ? 'cache' : 'editor';
  const encodedCacheKey = reference.cacheKey ? Buffer.from(String(reference.cacheKey), 'utf8').toString('base64url') : '';
  const compactCacheKey = encodedCacheKey.length <= 112 ? encodedCacheKey : `${encodedCacheKey.slice(0, 56)}-${encodedCacheKey.slice(-55)}`;
  const fileName = persistent
    ? `ai-canvas-native-${persistentNamespace}-${compactCacheKey || crypto.randomUUID()}${extension}`
    : `ai-canvas-native-${crypto.randomUUID()}${extension}`;
  if (persistent && inputDirectory && path.isAbsolute(String(inputDirectory))) {
    const root = path.resolve(String(inputDirectory));
    const target = path.resolve(root, fileName);
    if (path.dirname(target) === root) {
      const stat = await fs.promises.stat(target).catch(() => null);
      if (stat?.isFile() && stat.size === reference.buffer.length) return fileName;
    }
  }
  const form = new FormData();
  form.append('image', new Blob([reference.buffer], { type: reference.mimeType || 'image/png' }), fileName);
  form.append('type', 'input'); form.append('overwrite', persistent ? 'true' : 'false');
  const response = await fetchImpl(`${baseUrl}/upload/image`, { method: 'POST', body: form, signal });
  const payload = await responseJson(response, 'ComfyUI 参考图上传失败');
  return String(payload.name || fileName);
}

async function prunePersistentReferenceCache(inputDirectory, keepName, limit = 5) {
  if (!inputDirectory || !path.isAbsolute(String(inputDirectory))) return;
  const root = path.resolve(String(inputDirectory));
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  const cached = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.startsWith('ai-canvas-native-cache-')).map(async (entry) => ({
    name: entry.name,
    mtimeMs: await fs.promises.stat(path.join(root, entry.name)).then((stat) => stat.mtimeMs).catch(() => 0),
  })));
  cached.sort((left, right) => (right.name === keepName ? 1 : 0) - (left.name === keepName ? 1 : 0) || right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
  await Promise.all(cached.slice(Math.max(1, Math.min(20, Number(limit) || 5))).map(async (entry) => {
    const target = path.resolve(root, entry.name);
    if (path.dirname(target) !== root) return;
    try { await fs.promises.unlink(target); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }));
}

async function cleanupReference(inputDirectory, name) {
  if (!name || !inputDirectory || !path.isAbsolute(String(inputDirectory))) return;
  const root = path.resolve(String(inputDirectory));
  const safeName = path.basename(String(name));
  if (!safeName.startsWith('ai-canvas-native-')) return;
  const target = path.resolve(root, safeName);
  if (path.dirname(target) !== root) return;
  try { await fs.promises.unlink(target); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

function historyError(entry) {
  const failure = (Array.isArray(entry?.status?.messages) ? entry.status.messages : []).find((message) => Array.isArray(message) && ['execution_error', 'execution_interrupted'].includes(message[0]));
  return failure ? String(failure[1]?.exception_message || failure[1]?.message || failure[0]) : '';
}

function webSocketUrl(baseUrl, clientId) {
  const url = new URL(baseUrl); url.protocol = 'ws:'; url.pathname = '/ws'; url.search = new URLSearchParams({ clientId }).toString(); return url.toString();
}

async function openPreviewSocket(baseUrl, clientId, onProgress, onPreview, onExecuting, WebSocketImpl) {
  if (typeof WebSocketImpl !== 'function') return null;
  let socket; try { socket = new WebSocketImpl(webSocketUrl(baseUrl, clientId)); } catch { return null; }
  socket.binaryType = 'arraybuffer';
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data);
        if (message?.type === 'progress') void onProgress?.(message.data || {});
        if (message?.type === 'executing') void onExecuting?.(message.data || {});
      } catch { /* ignore */ }
      return;
    }
    const publish = (buffer) => {
      const bytes = Buffer.from(buffer);
      if (bytes.length < 8 || bytes.readUInt32BE(0) !== 1) return;
      const imageType = bytes.readUInt32BE(4); const image = bytes.subarray(8);
      if (image.length) void onPreview?.({ buffer: image, contentType: imageType === 2 ? 'image/png' : 'image/jpeg' });
    };
    if (typeof Blob !== 'undefined' && event.data instanceof Blob) void event.data.arrayBuffer().then(publish).catch(() => undefined);
    else publish(event.data);
  });
  const opened = await new Promise((resolve) => {
    let done = false; const finish = (value) => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => finish(false), 3000);
    socket.addEventListener('open', () => finish(true), { once: true }); socket.addEventListener('error', () => finish(false), { once: true });
  });
  if (!opened) { try { socket.close(); } catch { /* ignore */ } return null; }
  return { close: () => { try { socket.close(); } catch { /* ignore */ } } };
}

async function cancelPrompt(fetchImpl, baseUrl, promptId) {
  try {
    const queue = await fetchImpl(`${baseUrl}/queue`).then((response) => response.json());
    const running = Array.isArray(queue?.queue_running) && queue.queue_running.some((item) => Array.isArray(item) && item[1] === promptId);
    await fetchImpl(`${baseUrl}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) });
    if (running) await fetchImpl(`${baseUrl}/interrupt`, { method: 'POST' });
  } catch { /* best effort */ }
}

async function readNativeOutput(fetchImpl, baseUrl, outputDirectory, file, signal) {
  const local = await readComfyUiOutputFile(outputDirectory, file);
  if (local) return local;
  const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' });
  const response = await fetchImpl(`${baseUrl}/view?${query}`, { signal });
  if (!response.ok) throw new Error(`ComfyUI 图片读取失败：HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 64 * 1024 * 1024) throw new Error('ComfyUI 输出图片超过 64MB 安全限制');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('ComfyUI 返回了空图片');
  if (buffer.length > 64 * 1024 * 1024) throw new Error('ComfyUI 输出图片超过 64MB 安全限制');
  return buffer;
}

export function createComfyUiNativeImageAdapter(model, fetchImpl = fetch, runtime = {}) {
  const config = model.config || {};
  const family = familyFor(config);
  const defaults = FAMILY_DEFAULTS[family];
  const baseUrl = comfyUiIllustriousBaseUrl(config.baseUrl);
  const WebSocketImpl = Object.hasOwn(runtime, 'WebSocketImpl') ? runtime.WebSocketImpl : globalThis.WebSocket;
  const pollIntervalMs = Math.max(250, Number(config.pollIntervalMs) || 1000);
  const timeoutMs = Math.max(60000, Number(config.pollingTimeoutMs) || 15 * 60 * 1000);
  return {
    kind: 'image', configured: true,
    async run(job) {
      if (job.signal?.aborted) throw abortError();
      const recoveryPromptId = job.recoveryReason === 'comfyui_history' ? String(job.remoteTaskId || job.comfyPromptId || '').trim() : '';
      if (recoveryPromptId) {
        const payload = await responseJson(await fetchImpl(`${baseUrl}/history/${encodeURIComponent(recoveryPromptId)}`, { signal: job.signal }), 'ComfyUI 历史恢复失败');
        const entry = payload?.[recoveryPromptId]; const failure = historyError(entry); if (failure) throw new Error(`ComfyUI 历史任务失败：${failure}`);
        const file = comfyUiIllustriousHistoryImage(entry); if (!file) throw new Error('ComfyUI 历史任务没有可恢复的图片');
        const buffer = await readNativeOutput(fetchImpl, baseUrl, config.outputDirectory, file, job.signal);
        return [{ mediaType: 'image', buffer, extension: '.png', fileName: file.filename, metadata: { provider: 'comfyui', local: true, recovered: true, promptId: recoveryPromptId, family } }];
      }
      const references = Array.isArray(job.referenceImages) ? job.referenceImages : [];
      const referenceByPort = new Map(references.map((reference) => [String(reference.port || ''), reference]));
      if (referenceByPort.size !== references.length) throw new Error('每个参考端口只能连接 1 张图');
      const workflowId = String(job.workflowId || job.comfyUiWorkflow?.workflowId || '').trim();
      const animaInpaint = family === 'anima-base-v1' && workflowId === 'anima-base-v1-inpaint-v1';
      const poseReference = referenceByPort.get('pose');
      const subjectReference = referenceByPort.get('reference');
      const maskReference = referenceByPort.get('mask');
      if (family === 'qwen-image-edit-2511') {
        if (!subjectReference || references.some((reference) => !['reference', 'pose'].includes(String(reference.port || '')))) throw new Error('Qwen Image Edit 2511 必须连接 1 张角色外观图，动作姿势图可选');
      } else if (animaInpaint) {
        if (!subjectReference || !maskReference || references.length !== 2 || references.some((reference) => !['reference', 'mask'].includes(String(reference.port || '')))) throw new Error('Anima 局部重绘必须分别连接 1 张原图和 1 张重绘蒙版');
      } else if (family === 'anima-base-v1') {
        if (references.length) throw new Error('Anima 基础生图不接图片；需要局部编辑时请切换到“局部重绘”');
      } else if (references.some((reference) => !['reference', 'pose'].includes(String(reference.port || ''))) || references.length > 2) {
        throw new Error(`${model.name} 仅接受 1 张画面参考图和 1 张动作姿势图`);
      } else if (subjectReference && poseReference && !['flux2-klein', 'z-image-turbo'].includes(family)) {
        throw new Error(`${model.name} 的画面参考和动作迁移共用重绘通道，请只连接其中一种`);
      }
      const resolution = normalizedResolution(job.resolution);
      const poseEstimator = job.options?.poseEstimator === 'dwpose' ? 'dwpose' : 'sdpose';
      const readiness = await inspectComfyUiNativeImage(config, fetchImpl, { resolution, referenceEnabled: Boolean(subjectReference), poseEnabled: Boolean(poseReference), poseEstimator, workflowId, styleLora: job.options?.styleLora });
      if (!readiness.available) throw new Error(readiness.error);
      let uploadedReferenceName = '';
      let uploadedMaskName = '';
      let uploadedPoseName = '';
      let poseMap = null;
      if (subjectReference) {
        uploadedReferenceName = await uploadComfyUiNativeReference(fetchImpl, baseUrl, subjectReference, job.signal, { persistent: true, namespace: 'cache', inputDirectory: config.inputDirectory });
      }
      if (maskReference) {
        uploadedMaskName = await uploadComfyUiNativeReference(fetchImpl, baseUrl, maskReference, job.signal, { persistent: true, namespace: 'cache', inputDirectory: config.inputDirectory });
      }
      if (poseReference) {
        poseMap = await ensureComfyUiPoseMap({ config, fetchImpl, reference: poseReference, poseEstimator, ratio: job.ratio, signal: job.signal });
        uploadedPoseName = await uploadComfyUiNativeReference(fetchImpl, baseUrl, {
          buffer: poseMap.buffer,
          mimeType: 'image/png',
          fileName: `ai-canvas-pose-map-${poseMap.key}.png`,
          cacheKey: `${poseReference.cacheKey || poseMap.key}|pose-map`,
        }, job.signal, { persistent: true, namespace: 'cache', inputDirectory: config.inputDirectory });
      }
      if (uploadedPoseName || uploadedReferenceName || uploadedMaskName) {
        await prunePersistentReferenceCache(config.inputDirectory, uploadedPoseName || uploadedMaskName || uploadedReferenceName, 8);
      }
      const count = Math.max(1, Math.min(4, Number(job.count) || 1));
      const outputs = [];
      try {
        for (let index = 0; index < count; index += 1) {
          const seed = Number.isInteger(Number(job.options?.seed)) ? Number(job.options.seed) + index : crypto.randomInt(0, 4294967296);
          const options = {
            prompt: job.prompt,
            negativePrompt: job.options?.negativePrompt || config.negativePrompt || '',
            ratio: job.ratio,
            resolution,
            seed,
            steps: job.options?.comfySteps ?? config.steps ?? defaults.steps,
            cfg: job.options?.comfyCfg ?? config.cfg ?? defaults.cfg,
            sampler: job.options?.comfySampler || config.sampler || defaults.sampler,
            scheduler: job.options?.comfyScheduler || config.scheduler || defaults.scheduler,
            denoise: nativeImageJobDenoise(job.options, Boolean(uploadedReferenceName)),
            workflowId,
            referenceImage: uploadedReferenceName,
            maskImage: uploadedMaskName,
            poseImage: uploadedPoseName,
            poseStrength: poseReference?.strength ?? job.options?.poseStrength,
            styleLora: job.options?.styleLora,
            filenamePrefix: nativeImageFilenamePrefix(family, job.id, index),
          };
          const graph = poseMap || uploadedReferenceName || uploadedMaskName
            ? buildComfyUiNativePrompt(config, options)
            : prepareComfyUiNativePrompt(job.comfyUiWorkflow?.prompt, config, options) || buildComfyUiNativePrompt(config, options);
          const clientId = `ai-canvas-native-${crypto.randomUUID()}`;
          let promptId = '';
          const familyLabel = FAMILY_LABELS[family] || model.name || '本地模型';
          const stageForNode = (nodeId) => {
            const classType = String(graph?.[String(nodeId)]?.class_type || '');
            if (['UNETLoader', 'LoraLoaderModelOnly', 'CLIPLoader', 'DualCLIPLoader', 'QuadrupleCLIPLoader', 'VAELoader', 'ModelPatchLoader'].includes(classType)) return { label: `正在装载 ${familyLabel} 模型组件`, progress: 7 };
            if (['LoadImage', 'FluxKontextImageScale', 'ReferenceLatent', 'ZImageFunControlnet', 'ImageToMask', 'AnimaLLLiteApply', 'SetLatentNoiseMask'].includes(classType)) return { label: animaInpaint ? '正在应用原图与局部重绘蒙版' : poseMap ? '正在应用已缓存的姿势骨架' : '正在读取并适配参考图', progress: 9 };
            if (classType === 'TextEncodeQwenImageEditPlus') return { label: '正在编码提示词与参考图', progress: 11 };
            if (classType === 'CLIPTextEncode') return { label: `正在编码 ${familyLabel} 提示词`, progress: 11 };
            if (classType === 'VAEEncode') return { label: '正在编码参考图', progress: 13 };
            if (['KSampler', 'SamplerCustomAdvanced'].includes(classType)) return { label: `正在进行 ${familyLabel} 采样`, progress: 15 };
            if (classType === 'VAEDecode') return { label: '正在解码图片', progress: 91 };
            if (classType === 'SaveImage') return { label: '正在保存结果', progress: 94 };
            return null;
          };
          const socket = await openPreviewSocket(baseUrl, clientId, async (data) => {
            if (promptId && data.prompt_id && data.prompt_id !== promptId) return;
            const step = Math.max(0, Number(data.value) || 0); const steps = Math.max(1, Number(data.max) || Number(options.steps));
            await job.onSamplingPreview?.({ promptId, outputIndex: index, step, steps, nodeId: String(data.node || ''), progress: 15 + Math.round(((index + Math.min(1, step / steps)) / count) * 75), seed });
          }, async (preview) => job.onSamplingPreview?.({ promptId, outputIndex: index, buffer: preview.buffer, contentType: preview.contentType, seed }), async (data) => {
            if (promptId && data.prompt_id && data.prompt_id !== promptId) return;
            const stage = stageForNode(data.node);
            if (stage) await job.onStage?.(stage.label, stage.progress);
          }, WebSocketImpl);
          try {
            const submission = await responseJson(await fetchImpl(`${baseUrl}/prompt`, { method: 'POST', signal: job.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: clientId, extra_data: { preview_method: String(config.previewMethod || 'auto') } }) }), 'ComfyUI 基础模型提交失败');
            promptId = String(submission.prompt_id || '').trim(); if (!promptId) throw new Error('ComfyUI 未返回任务 ID');
            await job.onRemoteTask?.(promptId, { provider: 'comfyui', family, clientId });
            const deadline = Date.now() + timeoutMs;
            let missingFromQueuePolls = 0;
            while (Date.now() < deadline) {
              if (job.signal?.aborted) throw abortError();
              const payload = await responseJson(await fetchImpl(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { signal: job.signal }), 'ComfyUI 历史查询失败');
              const entry = payload?.[promptId];
              if (entry) {
                const failure = historyError(entry); if (failure) throw new Error(`ComfyUI 生成失败：${failure}`);
                const file = comfyUiIllustriousHistoryImage(entry);
                if (file) {
                  const buffer = await readNativeOutput(fetchImpl, baseUrl, config.outputDirectory, file, job.signal);
                  const dimensions = illustriousOutputDimensions(job.ratio, resolution);
                  outputs.push({ mediaType: 'image', buffer, extension: '.png', fileName: `${family}-${index + 1}.png`, metadata: { provider: 'comfyui', local: true, promptId, family, seed, ...dimensions, resolution, steps: Number(options.steps), cfg: Number(options.cfg), sampler: options.sampler, scheduler: options.scheduler, workflowId, ...(animaInpaint ? { inpaint: true, maskConvention: 'white-redraw-black-preserve' } : {}), ...(poseMap ? { poseControlMode: nativePoseModeForFamily(family), poseMapKey: poseMap.key, poseEstimator, poseMapCached: poseMap.cached, poseStrength: Number(options.poseStrength) || 0.85 } : {}), ...(job.comfyUiWorkflow?.revision ? { workflowRevision: job.comfyUiWorkflow.revision } : {}) } });
                  await job.onProgress?.(15 + Math.round(((index + 1) / count) * 75));
                  break;
                }
              }
              const queuePayload = await responseJson(await fetchImpl(`${baseUrl}/queue`, { signal: job.signal }), 'ComfyUI 队列查询失败');
              const inQueue = ['queue_running', 'queue_pending'].some((key) => Array.isArray(queuePayload?.[key]) && queuePayload[key].some((item) => Array.isArray(item) && item[1] === promptId));
              missingFromQueuePolls = inQueue ? 0 : missingFromQueuePolls + 1;
              if (missingFromQueuePolls >= 3) throw new Error('ComfyUI 任务已从队列消失且没有生成结果，请直接重试');
              await sleep(pollIntervalMs, job.signal);
            }
          } catch (error) {
            if (job.signal?.aborted) await cancelPrompt(fetchImpl, baseUrl, promptId);
            throw error;
          } finally { socket?.close(); }
          if (outputs.length !== index + 1) throw new Error('ComfyUI 基础模型生成超时');
        }
        return outputs;
      } finally {
        if (uploadedReferenceName && !subjectReference) await cleanupReference(config.inputDirectory, uploadedReferenceName);
        if (uploadedPoseName && !poseReference) await cleanupReference(config.inputDirectory, uploadedPoseName);
      }
    },
  };
}
