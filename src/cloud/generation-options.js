import { isFlexibleGptImage } from './gpt-image-size.js';
import { normalizeImageQuality } from '../../shared/image-model-catalog.js';
export const H3_GENERATION_CONTRACT_VERSION = 2026081603;

export function assertGenerationContract(model, version) {
  if (model?.adapter === 'comfyui-minimax-h3' && Number(version) !== H3_GENERATION_CONTRACT_VERSION) {
    throw new Error('当前创作服务需要更新。任务未提交，请重启 AI 创作台后重试');
  }
}

export const IMAGE_PROFILE = Object.freeze({
  ratios: ['Auto', '1:1', '16:9', '21:9', '9:16', '4:3', '3:4'],
  resolutions: ['1K', '2K', '4K'],
  defaultRatio: 'Auto',
  defaultResolution: '1K',
  count: { min: 1, max: 4, default: 1 },
  duration: { min: 5, max: 5, default: 5 },
  audio: false,
  audioInput: false,
});

export const OPENAI_IMAGE_PROFILE = Object.freeze({
  ...IMAGE_PROFILE,
});

export const LEGACY_OPENAI_IMAGE_PROFILE = Object.freeze({
  ...IMAGE_PROFILE,
  ratios: IMAGE_PROFILE.ratios.filter((ratio) => ratio !== '21:9'),
  resolutions: ['1K'],
});

export function geminiImageProfile(modelName = '') {
  const name = String(modelName).replace(/-preview(?:-.*)?$/, '');
  const ratios = ['Auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
  if (name === 'gemini-3.1-flash-image') return { ...IMAGE_PROFILE, ratios: [...ratios, '1:4', '4:1', '1:8', '8:1'], resolutions: ['0.5K', '1K', '2K', '4K'] };
  if (name === 'gemini-3-pro-image') return { ...IMAGE_PROFILE, ratios };
  // The original Flash and Flash Lite do not offer native 2K/4K output.
  if (['gemini-2.5-flash-image', 'gemini-3.1-flash-lite-image'].includes(name)) return { ...IMAGE_PROFILE, ratios, resolutions: ['1K'] };
  return IMAGE_PROFILE; // Keep explicitly configured relay aliases compatible.
}

export const GPT_IMAGE_4K_PROFILE = Object.freeze({
  ...OPENAI_IMAGE_PROFILE,
  ratios: ['Auto', '16:9'],
  resolutions: ['4K'],
  defaultRatio: '16:9',
  defaultResolution: '4K',
});

export const VIDEO_PROFILE = Object.freeze({
  ratios: ['Auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
  resolutions: ['480P', '720P', '1080P', '4K'],
  defaultRatio: 'Auto',
  defaultResolution: '720P',
  count: { min: 1, max: 1, default: 1 },
  duration: { min: 5, max: 15, default: 5 },
  audio: false,
  audioInput: false,
});

// This profile is the public contract for the standard Ark Seedance adapter.
export const SEEDANCE_VIDEO_PROFILE = Object.freeze({
  ratios: ['Auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
  resolutions: ['480P', '720P', '1080P', '4K'],
  defaultRatio: 'Auto',
  defaultResolution: '720P',
  count: { min: 1, max: 1, default: 1 },
  duration: { min: 4, max: 15, default: 5 },
  audio: true,
  audioInput: true,
});

export const MINIMAX_H3_VIDEO_PROFILE = Object.freeze({
  ratios: ['Auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
  resolutions: ['768P', '2K'],
  defaultRatio: '9:16',
  defaultResolution: '2K',
  count: { min: 1, max: 1, default: 1 },
  duration: { min: 4, max: 15, default: 5 },
  audio: false,
  audioInput: true,
});

export const COMFYUI_ILLUSTRIOUS_PROFILE = Object.freeze({
  ratios: ['1:1', '16:9', '21:9', '9:16', '4:3', '3:4'],
  resolutions: ['1K', '2K', '4K'],
  defaultRatio: '3:4',
  defaultResolution: '1K',
  count: { min: 1, max: 4, default: 1 },
  duration: { min: 5, max: 5, default: 5 },
  audio: false,
  audioInput: false,
  referenceLimits: { images: 4, videos: 0, audios: 0, total: 32 },
});

export const COMFYUI_MINIMAX_H3_PROFILE = Object.freeze({
  ratios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
  resolutions: ['768P'],
  defaultRatio: '16:9',
  defaultResolution: '768P',
  count: { min: 1, max: 1, default: 1 },
  duration: { min: 5, max: 30, default: 5 },
  audio: true,
  audioInput: true,
  legacyArkOptions: true,
});

// Seedance 2.5's launch contract lets Ark choose the output resolution and
// does not accept the legacy Seedance 2.0 tuning fields.
export const SEEDANCE_2_5_VIDEO_PROFILE = Object.freeze({
  ratios: ['Auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
  resolutions: ['480P', '720P'],
  defaultRatio: 'Auto',
  defaultResolution: '720P',
  count: { min: 1, max: 1, default: 1 },
  duration: { min: 4, max: 30, default: 5 },
  audio: true,
  audioInput: true,
  legacyArkOptions: false,
  outputFormats: ['mp4', 'mov'],
  referenceLimits: { images: 30, videos: 10, audios: 10, total: 50 },
});

export function supportsReferenceAudioInput(model, profile = generationProfileFor(model)) {
  return ['seedance-video', 'comfyui-minimax-h3'].includes(String(model?.adapter || '')) && profile?.audioInput === true;
}

export const TRIPO3D_MODEL_PROFILE = Object.freeze({
  ratios: ['Auto'],
  resolutions: ['STANDARD', 'DETAILED'],
  defaultRatio: 'Auto',
  defaultResolution: 'STANDARD',
  count: { min: 1, max: 1, default: 1 },
  duration: { min: 1, max: 1, default: 1 },
  audio: false,
  audioInput: false,
});

export const AUDIO_PROFILE = Object.freeze({
  ratios: ['Auto'],
  resolutions: ['WAV'],
  defaultRatio: 'Auto',
  defaultResolution: 'WAV',
  count: { min: 1, max: 1, default: 1 },
  duration: { min: 1, max: 600, default: 30 },
  audio: true,
  audioInput: true,
  referenceLimits: { images: 0, videos: 0, audios: 1, total: 8 },
});

export const TRIPO3D_H_MODEL = 'v3.1-20260211';
export const TRIPO3D_P_MODEL = 'P1-20260311';

const TRIPO3D_TEXTURE_QUALITIES = new Set(['standard', 'detailed', 'extreme']);
const TRIPO3D_GEOMETRY_QUALITIES = new Set(['standard', 'detailed']);
const TRIPO3D_TEXTURE_ALIGNMENTS = new Set(['original_image', 'geometry']);
const TRIPO3D_ORIENTATIONS = new Set(['default', 'align_image']);

function optionalUnsignedInteger(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 4294967295) {
    throw new Error(`${label} must be an integer from 0 to 4294967295`);
  }
  return normalized;
}

function normalizedTripoModel(modelOrConfig, value) {
  const configured = typeof modelOrConfig === 'object'
    ? modelOrConfig?.config?.model || modelOrConfig?.model
    : '';
  const model = String(value.modelVersion || value.model || configured || TRIPO3D_H_MODEL).trim();
  if (model !== TRIPO3D_H_MODEL && model !== TRIPO3D_P_MODEL) {
    throw new Error(`Unsupported Tripo3D generation model: ${model}`);
  }
  return model;
}

function tripoEnum(value, fallback, allowed, label) {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (!allowed.has(normalized)) throw new Error(`${label} is invalid: ${normalized}`);
  return normalized;
}

export function normalizeTripo3dGenerationOptions(modelOrConfig, value = {}) {
  const modelVersion = normalizedTripoModel(modelOrConfig, value);
  const family = modelVersion.startsWith('P') ? 'p' : 'h';
  const legacyQuality = String(value.resolution || '').toUpperCase() === 'DETAILED' ? 'detailed' : 'standard';
  const textureQuality = tripoEnum(value.textureQuality, legacyQuality, TRIPO3D_TEXTURE_QUALITIES, 'Tripo3D texture quality');
  const geometryQuality = tripoEnum(value.geometryQuality, legacyQuality, TRIPO3D_GEOMETRY_QUALITIES, 'Tripo3D geometry quality');
  const texture = value.texture !== false;
  if (!texture && value.pbr === true) throw new Error('Tripo3D PBR requires texture generation');
  const pbr = texture && value.pbr !== false;
  const quad = Boolean(value.quad);
  const smartLowPoly = Boolean(value.smartLowPoly);
  const generateParts = Boolean(value.generateParts);
  const autoSize = Boolean(value.autoSize);
  const exportUv = value.exportUv !== false;
  const enableImageAutofix = Boolean(value.enableImageAutofix);
  const textureAlignment = tripoEnum(value.textureAlignment, 'original_image', TRIPO3D_TEXTURE_ALIGNMENTS, 'Tripo3D texture alignment');
  const orientation = tripoEnum(value.orientation, 'default', TRIPO3D_ORIENTATIONS, 'Tripo3D orientation');
  const negativePrompt = String(value.negativePrompt || '').trim();
  if (negativePrompt.length > 255) throw new Error('Tripo3D negative prompt cannot exceed 255 characters');

  const modelSeed = optionalUnsignedInteger(value.modelSeed, 'Tripo3D model seed');
  const imageSeed = optionalUnsignedInteger(value.imageSeed, 'Tripo3D image seed');
  const textureSeed = optionalUnsignedInteger(value.textureSeed, 'Tripo3D texture seed');
  const faceLimit = value.faceLimit === undefined || value.faceLimit === null || value.faceLimit === ''
    ? undefined
    : Number(value.faceLimit);
  const compress = value.compress === undefined || value.compress === null || value.compress === '' || value.compress === false
    ? undefined
    : String(value.compress).trim().toLowerCase();
  if (compress !== undefined && compress !== 'geometry') throw new Error('Tripo3D compress must be geometry');

  if (!texture && textureQuality === 'extreme') throw new Error('Tripo3D extreme texture quality requires texture generation');
  if (orientation === 'align_image' && !texture) throw new Error('Tripo3D align_image orientation requires texture generation');
  if (generateParts && (texture || pbr || quad)) {
    throw new Error('Tripo3D generate_parts requires texture=false, pbr=false, and quad=false');
  }

  if (family === 'p') {
    if (geometryQuality !== 'standard') throw new Error('Tripo3D P1 does not support detailed geometry quality');
    if (quad) throw new Error('Tripo3D P1 does not support quad output');
    if (smartLowPoly) throw new Error('Tripo3D P1 does not support smart low poly');
    if (generateParts) throw new Error('Tripo3D P1 does not support generate_parts');
    if (faceLimit !== undefined && (!Number.isInteger(faceLimit) || faceLimit < 50 || faceLimit > 20000)) {
      throw new Error('Tripo3D P1 face limit must be an integer from 50 to 20000');
    }
  } else if (faceLimit !== undefined) {
    let maximumFaceLimit = geometryQuality === 'detailed' ? 2000000 : 1500000;
    if (quad) maximumFaceLimit = smartLowPoly ? 10000 : 150000;
    else if (smartLowPoly) maximumFaceLimit = 20000;
    if (!Number.isInteger(faceLimit) || faceLimit < 500 || faceLimit > maximumFaceLimit) {
      throw new Error(`Tripo3D H v3.1 face limit must be an integer from 500 to ${maximumFaceLimit}`);
    }
  }

  const workflow = String(value.workflow || '').trim().toLowerCase();
  const isTextWorkflow = !workflow || workflow === 'text-to-model' || workflow === 'text_to_model';
  if (!isTextWorkflow && negativePrompt) throw new Error('Tripo3D negative_prompt is only supported for text-to-model');
  if (!isTextWorkflow && imageSeed !== undefined) throw new Error('Tripo3D image_seed is only supported for text-to-model');
  if (isTextWorkflow && (enableImageAutofix || value.textureAlignment !== undefined || value.orientation !== undefined)) {
    throw new Error('Tripo3D image autofix, alignment, and orientation require an image workflow');
  }

  return {
    modelVersion,
    modelFamily: family,
    texture,
    pbr,
    textureQuality,
    geometryQuality,
    autoSize,
    quad,
    smartLowPoly,
    generateParts,
    exportUv,
    enableImageAutofix,
    textureAlignment,
    orientation,
    ...(negativePrompt ? { negativePrompt } : {}),
    ...(modelSeed === undefined ? {} : { modelSeed }),
    ...(imageSeed === undefined ? {} : { imageSeed }),
    ...(textureSeed === undefined ? {} : { textureSeed }),
    ...(faceLimit === undefined ? {} : { faceLimit }),
    ...(compress === undefined ? {} : { compress }),
  };
}

export const IMAGE_RATIOS = IMAGE_PROFILE.ratios;
export const VIDEO_RATIOS = VIDEO_PROFILE.ratios;
export const IMAGE_RESOLUTIONS = IMAGE_PROFILE.resolutions;
export const VIDEO_RESOLUTIONS = VIDEO_PROFILE.resolutions;

export function generationProfileFor(modelOrCapability) {
  if (modelOrCapability && typeof modelOrCapability === 'object') {
    if (modelOrCapability.adapter === 'gemini-image') return geminiImageProfile(modelOrCapability.config?.model || modelOrCapability.id);
    if (modelOrCapability.adapter === 'openai-image') {
      const modelName = String(modelOrCapability.config?.model || modelOrCapability.id || '').toLowerCase();
      return modelName === 'gpt-image-2-4k' ? GPT_IMAGE_4K_PROFILE : isFlexibleGptImage(modelName) ? OPENAI_IMAGE_PROFILE : LEGACY_OPENAI_IMAGE_PROFILE;
    }
    if (['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(modelOrCapability.adapter)) return COMFYUI_ILLUSTRIOUS_PROFILE;
    if (modelOrCapability.adapter === 'seedance-video') {
      const modelName = String(modelOrCapability.config?.model || modelOrCapability.model || modelOrCapability.id || '').toLowerCase();
      return /^doubao-seedance-2-5(?:-|$)/.test(modelName) ? SEEDANCE_2_5_VIDEO_PROFILE : SEEDANCE_VIDEO_PROFILE;
    }
    if (modelOrCapability.adapter === 'minimax-h3-video') return MINIMAX_H3_VIDEO_PROFILE;
    if (modelOrCapability.adapter === 'comfyui-minimax-h3') return COMFYUI_MINIMAX_H3_PROFILE;
    if (modelOrCapability.adapter === 'tripo3d-model' || modelOrCapability.capability === 'model') return TRIPO3D_MODEL_PROFILE;
    if (modelOrCapability.adapter === 'gpt-sovits-audio' || modelOrCapability.capability === 'audio') return AUDIO_PROFILE;
    return modelOrCapability.capability === 'image' ? IMAGE_PROFILE : VIDEO_PROFILE;
  }
  return modelOrCapability === 'image' ? IMAGE_PROFILE : modelOrCapability === 'model' ? TRIPO3D_MODEL_PROFILE : modelOrCapability === 'audio' ? AUDIO_PROFILE : VIDEO_PROFILE;
}

export function publicGenerationProfile(modelOrCapability) {
  const profile = generationProfileFor(modelOrCapability);
  return {
    ratios: [...profile.ratios],
    resolutions: [...profile.resolutions],
    defaultRatio: profile.defaultRatio,
    defaultResolution: profile.defaultResolution,
    count: { ...profile.count },
    duration: { ...profile.duration },
    audio: profile.audio,
    audioInput: profile.audioInput,
    ...(typeof profile.legacyArkOptions === 'boolean' ? { legacyArkOptions: profile.legacyArkOptions } : {}),
    ...(Array.isArray(profile.outputFormats) ? { outputFormats: [...profile.outputFormats] } : {}),
    ...(profile.referenceLimits ? { referenceLimits: { ...profile.referenceLimits } } : {}),
  };
}

function normalizeSeedanceOptions(value) {
  const seed = value.seed === undefined || value.seed === '' ? -1 : Number(value.seed);
  const priority = value.priority === undefined || value.priority === '' ? 0 : Number(value.priority);
  const executionExpiresAfter = value.executionExpiresAfter === undefined || value.executionExpiresAfter === ''
    ? 172800
    : Number(value.executionExpiresAfter);
  const serviceTier = value.serviceTier === 'flex' ? 'flex' : 'default';

  if (!Number.isInteger(seed) || seed < -1 || seed > 4294967295) {
    throw new Error('Seedance 随机种子必须为 -1 或 0-4294967295 的整数');
  }
  if (!Number.isInteger(priority) || priority < 0 || priority > 9) {
    throw new Error('Seedance 优先级必须为 0-9 的整数');
  }
  if (!Number.isInteger(executionExpiresAfter) || executionExpiresAfter < 3600 || executionExpiresAfter > 259200) {
    throw new Error('Seedance 任务有效期必须为 3600-259200 秒');
  }

  return {
    seed,
    cameraFixed: Boolean(value.cameraFixed),
    returnLastFrame: Boolean(value.returnLastFrame),
    priority,
    serviceTier,
    executionExpiresAfter,
    webSearch: Boolean(value.webSearch),
  };
}

function normalizeComfyUiMiniMaxH3Options(value) {
  const seed = value.seed === undefined || value.seed === null || value.seed === '' ? undefined : Number(value.seed);
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)) {
    throw new Error('本地 H3 Seed 必须为 0-4294967295 的整数，留空则随机');
  }
  const h3EncodingPreset = ['quality', 'balanced', 'compact', 'quality10'].includes(String(value.h3EncodingPreset))
    ? String(value.h3EncodingPreset)
    : 'balanced';
  const h3SamplingSteps = [20, 24, 28].includes(Number(value.h3SamplingSteps)) ? Number(value.h3SamplingSteps) : 20;
  const h3AccelerationMode = value.h3AccelerationMode === 'turbo'
    ? 'turbo'
    : value.h3AccelerationMode === 'community8'
      ? 'community8'
    : value.h3AccelerationMode === 'reference8'
      ? 'reference8'
      : 'standard';
  return {
    refImageSize: value.refImageSize === 'max' ? 'max' : 'match',
    referenceVideoAudio: value.referenceVideoAudio !== false,
    h3EncodingPreset,
    h3SamplingSteps,
    h3AccelerationMode,
    h3BlockCache: value.h3BlockCache === true,
    h3FaceRefine: value.h3FaceRefine === true,
    ...(seed === undefined ? {} : { seed }),
  };
}

const topazModels = Object.freeze(['星光 2.6', 'Astra', 'Astra HQ', 'Astra Fast', 'Astra Sharp']);
const topazStrengths = Object.freeze([0.7, 1, 1.3]);
const topazSharpnessPresets = Object.freeze(['自然', '平衡', '锐利（默认）']);

function normalizeTopazStarlightOptions(value = {}) {
  const topazModel = String(value.topazModel || '星光 2.6');
  if (!topazModels.includes(topazModel)) throw new Error('Topaz 模型参数无效');
  const topazVram = Number(value.topazVram ?? 22);
  if (!Number.isFinite(topazVram) || topazVram < 8 || topazVram > 24) throw new Error('Topaz 显存上限必须为 8-24 GiB');
  const topazScale = Number(value.topazScale ?? 2);
  if (!Number.isInteger(topazScale) || topazScale < 1 || topazScale > 4) throw new Error('Topaz 放大倍数必须为 1-4 的整数');
  const topazStrength = Number(value.topazStrength ?? 1);
  if (!topazStrengths.includes(topazStrength)) throw new Error('Topaz 增强强度必须为 0.7、1.0 或 1.3');
  const topazInputQuality = Number(value.topazInputQuality ?? 14);
  if (!Number.isInteger(topazInputQuality) || topazInputQuality < 0 || topazInputQuality > 40) throw new Error('Topaz 输入质量必须为 0-40 的整数');
  const topazSharpness = String(value.topazSharpness || '锐利（默认）');
  if (!topazSharpnessPresets.includes(topazSharpness)) throw new Error('Topaz 锐度档位无效');
  return { topazModel, topazVram: Math.round(topazVram * 10) / 10, topazScale, topazStrength, topazInputQuality, topazSharpness };
}

export function normalizeGenerationOptions(modelOrCapability, value = {}) {
  const profile = generationProfileFor(modelOrCapability);
  if (modelOrCapability?.adapter === 'openai-image' && String(value.ratio || '').trim() === '21:9' && !profile.ratios.includes('21:9')) {
    throw new Error('This model connection does not support 21:9. Select GPT Image 2 or another compatible model. No request was submitted.');
  }
  const ratio = profile.ratios.includes(value.ratio) ? value.ratio : profile.defaultRatio;
  const resolution = profile.resolutions.includes(String(value.resolution || '').toUpperCase())
    ? String(value.resolution).toUpperCase()
    : profile.defaultResolution;
  const isImage = modelOrCapability === 'image' || modelOrCapability?.capability === 'image';
  const isVideo = modelOrCapability === 'video' || modelOrCapability?.capability === 'video';
  const isAudio = modelOrCapability === 'audio' || modelOrCapability?.capability === 'audio';
  const count = isImage ? Number(value.count ?? profile.count.default) : 1;
  const duration = isVideo ? Number(value.duration ?? profile.duration.default) : profile.duration.default;
  const audioEnabled = isVideo && profile.audio && Boolean(value.audioEnabled ?? true);
  const audioLanguage = isAudio && ['zh', 'ja', 'en', 'ko', 'yue'].includes(String(value.audioLanguage || '')) ? String(value.audioLanguage) : 'zh';
  const audioSpeed = isAudio ? Number(value.audioSpeed ?? 1) : 1;
  const audioReferenceText = isAudio ? String(value.audioReferenceText || '').trim().slice(0, 2000) : '';
  const usesReferenceDenoise = ['comfyui-illustrious', 'comfyui-sdxl'].includes(modelOrCapability?.adapter)
    || (modelOrCapability?.adapter === 'comfyui-native-image' && modelOrCapability?.config?.family === 'qwen-image-edit-2511');
  const referenceDenoise = usesReferenceDenoise
    ? Number(value.referenceDenoise ?? 0.72)
    : undefined;
  const isLocalSdxl = ['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(modelOrCapability?.adapter);
  const comfyNegativePrompt = isLocalSdxl ? String(value.negativePrompt || '').trim() : '';
  const comfySeedMode = isLocalSdxl && (value.comfySeedMode === 'fixed' || (value.comfySeedMode !== 'random' && value.seed !== undefined && value.seed !== null && value.seed !== ''))
    ? 'fixed'
    : 'random';
  const comfySeed = comfySeedMode === 'fixed' ? Number(value.seed) : undefined;
  const comfySteps = isLocalSdxl ? Number(value.comfySteps ?? modelOrCapability?.config?.steps ?? 28) : undefined;
  const comfyCfg = isLocalSdxl ? Number(value.comfyCfg ?? modelOrCapability?.config?.cfg ?? 5.5) : undefined;
  const comfyDenoise = isLocalSdxl ? Number(value.comfyDenoise ?? 1) : undefined;
  const comfySampler = isLocalSdxl ? String(value.comfySampler || modelOrCapability?.config?.sampler || 'dpmpp_2m_sde').trim() : '';
  const comfyScheduler = isLocalSdxl ? String(value.comfyScheduler || modelOrCapability?.config?.scheduler || 'karras').trim() : '';
  const comfyControlStrength = (field, fallback, label) => {
    const strength = Number(value[field] ?? fallback);
    if (!Number.isFinite(strength) || strength < 0 || strength > 2) throw new Error(`${label}必须为 0-2`);
    return Math.round(strength * 100) / 100;
  };
  const comfyLoraName = (field) => {
    const name = String(value[field] || '').trim();
    if (!name) return '';
    if (name.length > 180 || !/^[^<>:"|?*\r\n]+\.safetensors$/i.test(name) || name.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')) {
      throw new Error('LoRA 文件名无效');
    }
    return name;
  };

  if (!Number.isInteger(count) || count < profile.count.min || count > profile.count.max) {
    throw new Error(`图片数量必须为 ${profile.count.min}-${profile.count.max}`);
  }
  if (isVideo && (!Number.isInteger(duration) || duration < profile.duration.min || duration > profile.duration.max)) {
    throw new Error(`视频时长必须为 ${profile.duration.min}-${profile.duration.max} 秒`);
  }
  if (isAudio && (!Number.isFinite(audioSpeed) || audioSpeed < 0.5 || audioSpeed > 2)) throw new Error('语速必须为 0.5-2 倍');
  if (modelOrCapability?.adapter === 'comfyui-minimax-h3' && value.h3AccelerationMode === 'community8' && duration > 15) {
    throw new Error('H3 社区增强 8步当前只支持 5-15 秒');
  }
  if (referenceDenoise !== undefined && (!Number.isFinite(referenceDenoise) || referenceDenoise < 0.05 || referenceDenoise > 1)) {
    throw new Error('本地模型参考图重绘强度必须为 0.05-1');
  }
  if (comfyNegativePrompt.length > 4000) throw new Error('本地 SDXL 负向提示词不能超过 4000 个字符');
  if (comfySeed !== undefined && (!Number.isInteger(comfySeed) || comfySeed < 0 || comfySeed > 4294967295)) throw new Error('本地 SDXL 固定种子必须为 0-4294967295 的整数');
  if (comfySteps !== undefined && (!Number.isInteger(comfySteps) || comfySteps < 1 || comfySteps > 100)) throw new Error('本地 SDXL 采样步数必须为 1-100 的整数');
  if (comfyCfg !== undefined && (!Number.isFinite(comfyCfg) || comfyCfg < 1 || comfyCfg > 30)) throw new Error('本地 SDXL CFG 必须为 1-30');
  if (comfyDenoise !== undefined && (!Number.isFinite(comfyDenoise) || comfyDenoise < 0.05 || comfyDenoise > 1)) throw new Error('本地 SDXL 降噪强度必须为 0.05-1');
  if (isLocalSdxl && (!comfySampler || comfySampler.length > 80 || /[\u0000-\u001f]/.test(comfySampler))) throw new Error('本地 SDXL 采样器无效');
  if (isLocalSdxl && (!comfyScheduler || comfyScheduler.length > 80 || /[\u0000-\u001f]/.test(comfyScheduler))) throw new Error('本地 SDXL 调度器无效');

  return {
    ratio,
    resolution,
    count,
    duration,
    audioEnabled,
    ...(modelOrCapability?.adapter === 'openai-image' ? { imageQuality: normalizeImageQuality(value.imageQuality) } : {}),
    ...(isAudio ? { audioLanguage, audioSpeed: Math.round(audioSpeed * 100) / 100, audioReferenceText } : {}),
    ...(referenceDenoise === undefined ? {} : { referenceDenoise: Math.round(referenceDenoise * 100) / 100 }),
    ...(comfyNegativePrompt ? { negativePrompt: comfyNegativePrompt } : {}),
    ...(isLocalSdxl ? {
      comfySeedMode,
      ...(comfySeed === undefined ? {} : { seed: comfySeed }),
      comfySteps,
      comfyCfg: Math.round(comfyCfg * 10) / 10,
      comfySampler,
      comfyScheduler,
      comfyDenoise: Math.round(comfyDenoise * 100) / 100,
      characterLora: comfyLoraName('characterLora'),
      characterLoraStrength: comfyControlStrength('characterLoraStrength', 0.8, '角色 LoRA 强度'),
    } : {}),
    ...(['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(modelOrCapability?.adapter) ? {
      poseStrength: comfyControlStrength('poseStrength', 0.85, '动作强度'),
      poseEstimator: value.poseEstimator === 'dwpose' ? 'dwpose' : 'sdpose',
    } : {}),
    ...(['comfyui-illustrious', 'comfyui-native-image'].includes(modelOrCapability?.adapter) ? {
      styleLora: comfyLoraName('styleLora'),
    } : {}),
    ...(modelOrCapability?.adapter === 'comfyui-illustrious' ? {
      identityStrength: comfyControlStrength('identityStrength', 0.75, '身份保持强度'),
      proportionStrength: comfyControlStrength('proportionStrength', 0.45, '头身比例强度'),
      lineartStrength: comfyControlStrength('lineartStrength', 0.7, '线稿强度'),
      objectLora: comfyLoraName('objectLora'),
    } : {}),
    ...(isVideo && Array.isArray(profile.outputFormats) ? { outputFormat: value.outputFormat === 'mov' ? 'mov' : 'mp4' } : {}),
    ...(modelOrCapability?.adapter === 'comfyui-minimax-h3' ? normalizeComfyUiMiniMaxH3Options(value) : {}),
    ...(modelOrCapability?.adapter === 'comfyui-topaz-starlight' ? normalizeTopazStarlightOptions(value) : {}),
    ...(modelOrCapability?.adapter === 'seedance-video' && profile.legacyArkOptions !== false ? normalizeSeedanceOptions(value) : {}),
    ...(modelOrCapability?.adapter === 'tripo3d-model'
      ? normalizeTripo3dGenerationOptions(modelOrCapability, { ...value, resolution })
      : {}),
  };
}
