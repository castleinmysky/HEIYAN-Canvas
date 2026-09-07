import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const defaultModels = Object.freeze({
  diffusion: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  referenceDiffusion: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  textEncoder: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae: 'minimax_h3_video_vae_fp16.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  turboDiffusionLora: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
  turboReferenceLora: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
  communityReferenceLora: 'minimax_h3_turbo_v4_step600_ema.safetensors',
});

const managedModelRoles = Object.freeze(Object.keys(defaultModels));

function modelsForConfig(config) {
  if (config?.managed !== true) return defaultModels;
  const models = config.models;
  const keys = models && typeof models === 'object' && !Array.isArray(models) ? Object.keys(models).sort() : [];
  const expected = [...managedModelRoles].sort();
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) {
    throw new Error('Managed H3 model roles do not match the server capability catalog');
  }
  for (const role of managedModelRoles) {
    const value = models[role];
    if (typeof value !== 'string' || !value || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`Managed H3 model role is invalid: ${role}`);
    }
  }
  return Object.freeze({ ...models });
}

function abortError() {
  const error = new Error('Task cancelled');
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

export function comfyUiLocalBaseUrl(value) {
  let url;
  try { url = new URL(String(value || 'http://127.0.0.1:8188')); }
  catch { throw new Error('ComfyUI local address is invalid'); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)) {
    throw new Error('ComfyUI H3 only accepts a local loopback HTTP address');
  }
  if (url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('ComfyUI local address must contain only host and port');
  }
  return url.toString().replace(/\/$/, '');
}

export function minimaxH3LocalDimensions(ratio) {
  return ({
    // Keep the cinema canvas at an exact 21:9 ratio. The previous 1536x672
    // canvas is 16:7 and caused wide references to be subtly stretched.
    '21:9': { width: 1568, height: 672 },
    '16:9': { width: 1344, height: 768 },
    '4:3': { width: 1152, height: 864 },
    '1:1': { width: 992, height: 992 },
    '3:4': { width: 864, height: 1152 },
    '9:16': { width: 768, height: 1344 },
  })[ratio] || { width: 1344, height: 768 };
}

export function minimaxH3LocalFrameCount(duration) {
  let frames = Math.max(5, Math.round(Math.max(1, Number(duration) || 5) * 24));
  while (frames % 17 !== 5) frames += 1;
  return frames;
}

export function comfyUiMiniMaxH3Encoding(preset = 'balanced') {
  const normalizedPreset = ['quality', 'balanced', 'compact', 'quality10'].includes(String(preset)) ? String(preset) : 'balanced';
  const crf = ['quality', 'quality10'].includes(normalizedPreset) ? 18 : normalizedPreset === 'compact' ? 28 : 23;
  return {
    preset: normalizedPreset,
    codec: 'h264',
    bitDepth: normalizedPreset === 'quality10' ? 10 : 8,
    crf,
    saveVideoInputs: { format: 'mp4', codec: 'h264', 'codec.encoding': 're-encode', 'codec.encoding.crf': crf },
  };
}

export function videoContainerHasAudioTrack(buffer, extension = '') {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const kind = String(extension || '').toLowerCase();
  if (kind === '.mp4' || kind === '.mov' || kind === '.m4v') return bytes.indexOf(Buffer.from('soun')) >= 0;
  if (kind === '.webm' || kind === '.mkv') {
    for (let index = 0; index + 2 < bytes.length; index += 1) {
      if (bytes[index] === 0x83 && bytes[index + 1] === 0x81 && bytes[index + 2] === 0x02) return true;
    }
  }
  return false;
}

export function validateComfyUiMiniMaxH3Inputs(inputs) {
  const media = inputs.filter((input) => input.type !== 'text');
  const frames = media.filter((input) => ['first_frame', 'last_frame'].includes(input.port));
  if (frames.length) {
    if (media.some((input) => !['first_frame', 'last_frame'].includes(input.port))) throw new Error('Local H3 cannot mix omni-reference mode with first-last-frame mode');
    if (media.some((input) => input.type !== 'image')) throw new Error('Local H3 first-last-frame mode accepts images only');
    if (frames.length > 2 || frames.length !== new Set(frames.map((input) => input.port)).size) throw new Error('Local H3 first and last frame ports cannot be duplicated');
    if (frames.some((input) => input.port === 'last_frame') && !frames.some((input) => input.port === 'first_frame')) throw new Error('Local H3 last frame requires a first frame');
    return inputs;
  }
  if (media.some((input) => !['reference', 'material'].includes(input.port))) throw new Error('Local H3 omni-reference input port is invalid');
  const images = media.filter((input) => input.type === 'image');
  const videos = media.filter((input) => input.type === 'video');
  const audios = media.filter((input) => input.type === 'audio');
  if (media.some((input) => !['image', 'video', 'audio'].includes(input.type))) throw new Error('Local H3 omni-reference supports image, video, and audio inputs only');
  if (images.length > 9) throw new Error('Local H3 omni-reference supports at most 9 images');
  if (videos.length > 3) throw new Error('Local H3 omni-reference supports at most 3 videos');
  if (audios.length > 3) throw new Error('Local H3 omni-reference supports at most 3 standalone audio clips');
  if (videos.some((input) => Number(input.duration) > 15 || (Number(input.duration) > 0 && Number(input.duration) < 2))) throw new Error('Local H3 reference videos must be 2 to 15 seconds long');
  return inputs;
}

function isReferenceMode(inputs) {
  return inputs.some((input) => input.type !== 'text' && !['first_frame', 'last_frame'].includes(input.port));
}

export function mapComfyUiMiniMaxH3ReferencePrompt(prompt, references) {
  let mapped = String(prompt || '').trim();
  const tags = [];
  const counters = { image: 0, video: 0, audio: 0 };
  const explicitTokens = new Set(references.map((reference) => String(reference.referenceToken || '')).filter(Boolean));
  let soundtrackOrdinal = 0;
  const soundtrackCount = references.filter((reference) => reference.type === 'video' && reference.hasAudioTrack !== false).length;
  for (const reference of references) {
    const type = reference.type;
    counters[type] += 1;
    const ordinal = counters[type];
    const index = type === 'audio' ? soundtrackCount + ordinal : ordinal;
    const label = type === 'image' ? 'Picture' : type === 'video' ? 'Video' : 'Audio';
    const tag = `<${label} ${index}>`;
    if (type === 'video' && reference.hasAudioTrack !== false) {
      soundtrackOrdinal += 1;
      tags.push(`<Audio ${soundtrackOrdinal}>`);
    }
    tags.push(tag);
    const aliases = type === 'image'
      ? [reference.referenceToken, `图片${ordinal}`, `图${ordinal}`]
      : type === 'video' ? [reference.referenceToken, `视频${ordinal}`] : [reference.referenceToken, `音频${ordinal}`, `声音${ordinal}`];
    for (const alias of aliases.filter(Boolean)) {
      if (alias !== reference.referenceToken && explicitTokens.has(String(alias))) continue;
      mapped = mapped.replaceAll(`@${alias}`, tag);
    }
  }
  const missing = tags.filter((tag) => !mapped.includes(tag));
  return missing.length ? `${mapped}\n参考素材：${missing.join('、')}`.trim() : mapped;
}

export function buildComfyUiMiniMaxH3Prompt({ prompt, ratio = '16:9', duration = 5, seed = 1, firstFrame, lastFrame, audioEnabled = true, encodingPreset = 'balanced', samplingSteps = 20, accelerationMode = 'standard', filenamePrefix = 'video/AI_Canvas_MiniMax_H3', models = defaultModels }) {
  if (['reference8', 'community8'].includes(accelerationMode)) throw new Error('H3 omni-reference 8-step mode requires omni-reference inputs');
  const { width, height } = minimaxH3LocalDimensions(ratio);
  const encoding = comfyUiMiniMaxH3Encoding(encodingPreset);
  const graph = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: models.diffusion, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: models.textEncoder, type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: models.videoVae } },
    '5': { class_type: 'MiniMaxH3ImageToVideo', inputs: { clip: ['2', 0], vae: ['3', 0], prompt, width, height, length: minimaxH3LocalFrameCount(duration) } },
    '6': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '7': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    '8': { class_type: 'BasicScheduler', inputs: { model: ['1', 0], scheduler: 'simple', steps: samplingSteps, denoise: 1 } },
    '9': { class_type: 'BasicGuider', inputs: { model: ['1', 0], conditioning: ['5', 0] } },
    '10': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['6', 0], guider: ['9', 0], sampler: ['7', 0], sigmas: ['8', 0], latent_image: ['5', 1] } },
    '11': { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['3', 0] } },
    '13': { class_type: 'CreateVideo', inputs: { images: ['11', 0], fps: 24, bit_depth: encoding.bitDepth } },
    '14': { class_type: 'SaveVideo', inputs: { video: ['13', 0], filename_prefix: filenamePrefix, ...encoding.saveVideoInputs } },
  };
  if (accelerationMode === 'turbo') {
    graph['15'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: models.turboDiffusionLora, strength_model: 1 } };
    graph['16'] = { class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['15', 0], shift_video: 12, shift_audio: 3 } };
    graph['7'].inputs.sampler_name = 'euler';
    graph['8'].inputs.steps = 8;
    graph['8'].inputs.model = ['16', 0];
    graph['9'].inputs.model = ['16', 0];
  }
  if (audioEnabled) {
    graph['4'] = { class_type: 'VAELoader', inputs: { vae_name: models.audioVae } };
    graph['12'] = { class_type: 'VAEDecodeAudio', inputs: { samples: ['10', 0], vae: ['4', 0] } };
    graph['13'].inputs.audio = ['12', 0];
  }
  if (firstFrame) {
    graph['20'] = { class_type: 'LoadImage', inputs: { image: firstFrame } };
    // MiniMaxH3ImageToVideo stretches its first-frame input to the latent
    // canvas. Normalize it with an aspect-preserving center crop first so the
    // model never receives distorted geometry.
    graph['22'] = { class_type: 'ImageScale', inputs: { image: ['20', 0], upscale_method: 'lanczos', width, height, crop: 'center' } };
    graph['5'].inputs.first_frame = ['22', 0];
  }
  if (lastFrame) {
    graph['21'] = { class_type: 'LoadImage', inputs: { image: lastFrame } };
    graph['5'].inputs.last_frame = ['21', 0];
  }
  return graph;
}

export function buildComfyUiMiniMaxH3ReferencePrompt({ prompt, ratio = '16:9', duration = 5, seed = 1, images = [], videos = [], audios = [], guides = [], refImageSize = 'match', audioEnabled = true, encodingPreset = 'balanced', samplingSteps = 20, accelerationMode = 'standard', blockCache = false, filenamePrefix = 'video/AI_Canvas_MiniMax_H3', models = defaultModels }) {
  if (accelerationMode === 'community8' && Number(duration) > 15) throw new Error('H3 community 8-step mode currently supports at most 15 seconds');
  const { width, height } = minimaxH3LocalDimensions(ratio);
  const encoding = comfyUiMiniMaxH3Encoding(encodingPreset);
  const graph = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: models.referenceDiffusion, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: models.textEncoder, type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: models.videoVae } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: models.audioVae } },
    '5': { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { clip: ['2', 0], vae: ['3', 0], audio_vae: ['4', 0], prompt, width, height, length: minimaxH3LocalFrameCount(duration), ref_image_size: refImageSize === 'max' ? 'max' : 'match' } },
    '6': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '7': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    '8': { class_type: 'BasicScheduler', inputs: { model: ['1', 0], scheduler: 'simple', steps: samplingSteps, denoise: 1 } },
    '9': { class_type: 'BasicGuider', inputs: { model: ['1', 0], conditioning: ['5', 0] } },
    '10': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['6', 0], guider: ['9', 0], sampler: ['7', 0], sigmas: ['8', 0], latent_image: ['5', 1] } },
    '11': { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['3', 0] } },
    '12': { class_type: 'VAEDecodeAudio', inputs: { samples: ['10', 0], vae: ['4', 0] } },
    '13': { class_type: 'CreateVideo', inputs: { images: ['11', 0], fps: 24, bit_depth: encoding.bitDepth, ...(audioEnabled ? { audio: ['12', 0] } : {}) } },
    '14': { class_type: 'SaveVideo', inputs: { video: ['13', 0], filename_prefix: filenamePrefix, ...encoding.saveVideoInputs } },
  };
  if (accelerationMode === 'turbo') {
    graph['15'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: models.turboReferenceLora, strength_model: 1 } };
    graph['16'] = { class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['15', 0], shift_video: 12, shift_audio: 3 } };
    graph['7'].inputs.sampler_name = 'euler';
    graph['8'].inputs.steps = 4;
    graph['8'].inputs.model = ['16', 0];
    graph['9'].inputs.model = ['16', 0];
  }
  if (accelerationMode === 'reference8') {
    graph['16'] = { class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['1', 0], shift_video: 8, shift_audio: 3 } };
    graph['7'].inputs.sampler_name = 'dpmpp_2m';
    graph['8'].inputs.scheduler = 'sgm_uniform';
    graph['8'].inputs.steps = 8;
    graph['8'].inputs.model = ['16', 0];
    graph['9'].inputs.model = ['16', 0];
  }
  if (accelerationMode === 'community8') {
    graph['15'] = { class_type: 'MiniMaxH3TurboLoRA', inputs: { model: ['1', 0], lora_name: models.communityReferenceLora, strength: 1, low_vram: false } };
    graph['17'] = { class_type: 'MiniMaxH3TurboSampler', inputs: {} };
    graph['8'].inputs.steps = 8;
    graph['8'].inputs.model = ['15', 0];
    graph['9'].inputs.model = ['15', 0];
    graph['10'].inputs.sampler = ['17', 0];
  }
  if (blockCache) {
    if (accelerationMode !== 'standard') throw new Error('H3 block cache is only available in standard Ref2VA mode');
    graph['18'] = { class_type: 'ApplyH3Ref2VAUltraSafeBlockCache', inputs: { model: ['1', 0], mode: 'Ref2VA Balanced', cache_storage: 'CPU (VRAM-safe)', debug: false, tail_rescale: false, cpu_tail_compute: 'Safe CPU (v0.3 behavior)' } };
    graph['8'].inputs.model = ['18', 0];
    graph['9'].inputs.model = ['18', 0];
  }
  images.forEach((file, index) => {
    const id = String(20 + index);
    graph[id] = { class_type: 'LoadImage', inputs: { image: file } };
    graph['5'].inputs[`ref_images.ref_image_${index}`] = [id, 0];
  });
  videos.forEach((entry, index) => {
    const file = typeof entry === 'string' ? entry : entry.file;
    const hasAudioTrack = typeof entry === 'string' || entry.hasAudioTrack !== false;
    const loadId = String(40 + index * 3);
    const partsId = String(41 + index * 3);
    const normalizeId = String(42 + index * 3);
    graph[loadId] = { class_type: 'LoadVideo', inputs: { file } };
    graph[partsId] = { class_type: 'GetVideoComponents', inputs: { video: [loadId, 0] } };
    graph[normalizeId] = { class_type: 'AICanvasVideoFrames24FPS', inputs: { images: [partsId, 0], source_fps: [partsId, 2] } };
    graph['5'].inputs[`ref_videos.ref_video_${index}`] = [normalizeId, 0];
    if (hasAudioTrack) graph['5'].inputs[`ref_video_audios.ref_video_audio_${index}`] = [partsId, 1];
  });
  audios.forEach((file, index) => {
    const id = String(60 + index);
    graph[id] = { class_type: 'LoadAudio', inputs: { audio: file } };
    graph['5'].inputs[`ref_audios.ref_audio_${index}`] = [id, 0];
  });
  let guideConditioning = ['5', 0];
  const totalFrames = minimaxH3LocalFrameCount(duration);
  guides.forEach((guide, index) => {
    const frameIndex = Number(guide.frameIndex);
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= totalFrames) throw new Error(`H3 guide frame must be within 0-${totalFrames - 1}`);
    const base = 100 + index * 5;
    const guideId = String(base + 4);
    const inputs = { positive: guideConditioning, latent: ['5', 1], frame_idx: frameIndex };
    if (guide.type === 'image') {
      graph[String(base)] = { class_type: 'LoadImage', inputs: { image: guide.file } };
      Object.assign(inputs, { vae: ['3', 0], image: [String(base), 0] });
    } else if (guide.type === 'video') {
      graph[String(base)] = { class_type: 'LoadVideo', inputs: { file: guide.file } };
      graph[String(base + 1)] = { class_type: 'GetVideoComponents', inputs: { video: [String(base), 0] } };
      graph[String(base + 2)] = { class_type: 'AICanvasVideoFrames24FPS', inputs: { images: [String(base + 1), 0], source_fps: [String(base + 1), 2] } };
      Object.assign(inputs, { vae: ['3', 0], image: [String(base + 2), 0], ...(guide.hasAudioTrack ? { audio_vae: ['4', 0], audio: [String(base + 1), 1] } : {}) });
    } else if (guide.type === 'audio') {
      graph[String(base)] = { class_type: 'LoadAudio', inputs: { audio: guide.file } };
      Object.assign(inputs, { audio_vae: ['4', 0], audio: [String(base), 0] });
    } else throw new Error(`Unsupported H3 guide type: ${guide.type}`);
    graph[guideId] = { class_type: 'MiniMaxH3AddGuide', inputs };
    guideConditioning = [guideId, 0];
  });
  graph['9'].inputs.conditioning = guideConditioning;
  return graph;
}

export function buildComfyUiMiniMaxH3FaceRefinePrompt({ video, duration = 5, seed = 1, audioEnabled = true, encodingPreset = 'balanced', filenamePrefix = 'video/AI_Canvas_MiniMax_H3_FaceRefined', models = defaultModels }) {
  if (!video) throw new Error('H3 face refine requires a generated video');
  const length = minimaxH3LocalFrameCount(duration);
  const encoding = comfyUiMiniMaxH3Encoding(encodingPreset);
  return {
    '1': { class_type: 'LoadVideo', inputs: { file: video } },
    '2': { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
    '3': { class_type: 'AICanvasVideoFrames24FPS', inputs: { images: ['2', 0], source_fps: ['2', 2] } },
    '4': { class_type: 'ImageFromBatch', inputs: { image: ['3', 0], batch_index: 0, length } },
    '5': { class_type: 'H3FaceTrackCrop', inputs: { images: ['4', 0], detector: 'face_yolov8m.pt', confidence: 0.25, crop_factor: 3, canvas_width: 512, canvas_height: 512, canvas_mode: 'manual', smooth_window: 21, size_smooth_window: 51, smooth_method: 'gaussian', size_mode: 'per_frame', identity_track: false, identity_threshold: 0.28, select: 'largest', fallback_detector: 'none', fallback_head_frac: 0.5 } },
    '6': { class_type: 'CLIPLoader', inputs: { clip_name: models.textEncoder, type: 'minimax', device: 'default' } },
    '7': { class_type: 'VAELoader', inputs: { vae_name: models.videoVae } },
    '8': { class_type: 'VAELoader', inputs: { vae_name: models.audioVae } },
    '9': { class_type: 'ImageFromBatch', inputs: { image: ['5', 0], batch_index: 0, length: 1 } },
    '10': { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { clip: ['6', 0], vae: ['7', 0], audio_vae: ['8', 0], prompt: '<Picture 1> 的人物面部，保持原身份、表情、发型和光照，只补足清晰稳定的五官细节。', width: ['5', 4], height: ['5', 5], length, ref_image_size: 'match', 'ref_images.ref_image_0': ['9', 0] } },
    '11': { class_type: 'H3InjectVideoLatent', inputs: { av_latent: ['10', 1], images: ['5', 0], vae: ['7', 0] } },
    '12': { class_type: 'UNETLoader', inputs: { unet_name: models.referenceDiffusion, weight_dtype: 'default' } },
    '13': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['12', 0], lora_name: models.turboReferenceLora, strength_model: 0.75 } },
    '14': { class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['13', 0], shift_video: 12, shift_audio: 3 } },
    '15': { class_type: 'BasicGuider', inputs: { model: ['14', 0], conditioning: ['10', 0] } },
    '16': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '17': { class_type: 'BasicScheduler', inputs: { model: ['14', 0], scheduler: 'simple', steps: 4, denoise: 0.45 } },
    '18': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '19': { class_type: 'H3PerFrameDenoise', inputs: { av_latent: ['11', 0], transform: ['5', 1], strength_small_face: 0.8, strength_large_face: 0.35, scale_mode: 'absolute_px', face_px_small: 30, face_px_large: 120, gamma: 1, smooth_frames: 9 } },
    '20': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['18', 0], guider: ['15', 0], sampler: ['16', 0], sigmas: ['17', 0], latent_image: ['19', 0] } },
    '21': { class_type: 'VAEDecode', inputs: { samples: ['20', 0], vae: ['7', 0] } },
    '22': { class_type: 'H3FaceStitch', inputs: { base_images: ['4', 0], refined_crops: ['21', 0], transform: ['5', 1], paste_region: 'face_only', mask_dilation: 16, feather: 24, colour_match: 1, blend: 1, undetected_frames: 'fade_out', feather_scales_with_crop: false } },
    '23': { class_type: 'CreateVideo', inputs: { images: ['22', 0], fps: 24, bit_depth: encoding.bitDepth, ...(audioEnabled ? { audio: ['2', 1] } : {}) } },
    '24': { class_type: 'SaveVideo', inputs: { video: ['23', 0], filename_prefix: filenamePrefix, ...encoding.saveVideoInputs } },
  };
}

function queuePromptId(item) {
  return Array.isArray(item) ? String(item[1] || '') : '';
}

export function comfyUiMiniMaxH3QueueStatus(payload, { promptId = '', estimatedRunSeconds = 360 } = {}) {
  const running = Array.isArray(payload?.queue_running) ? payload.queue_running : [];
  const pending = Array.isArray(payload?.queue_pending) ? payload.queue_pending : [];
  const estimate = Math.max(60, Math.min(1800, Number(estimatedRunSeconds) || 360));
  const pendingIndex = promptId ? pending.findIndex((item) => queuePromptId(item) === promptId) : -1;
  const isRunning = Boolean(promptId) && running.some((item) => queuePromptId(item) === promptId);
  const ahead = isRunning ? 0 : pendingIndex >= 0 ? running.length + pendingIndex : running.length + pending.length;
  return {
    available: true,
    state: isRunning ? 'running' : pendingIndex >= 0 ? 'queued' : running.length || pending.length ? 'busy' : 'idle',
    concurrency: 1,
    running: running.length,
    queued: pending.length,
    ahead,
    position: pendingIndex >= 0 ? pendingIndex + 1 : 0,
    estimatedWaitSeconds: Math.max(0, ahead * estimate),
    estimatedRunSeconds: estimate,
  };
}

export async function inspectComfyUiMiniMaxH3Queue(config = {}, fetchImpl = fetch, promptId = '') {
  const baseUrl = comfyUiLocalBaseUrl(config.baseUrl);
  const readiness = await inspectComfyUiMiniMaxH3(config, fetchImpl);
  if (!readiness.available) return { ...readiness, state: 'offline', concurrency: 1, running: 0, queued: 0, ahead: 0, position: 0, estimatedWaitSeconds: 0, estimatedRunSeconds: Math.max(60, Number(config.estimatedRunSeconds) || 360) };
  try {
    const response = await fetchImpl(`${baseUrl}/queue`);
    const payload = await responseJson(response, 'ComfyUI queue check failed');
    return { ...comfyUiMiniMaxH3QueueStatus(payload, { promptId, estimatedRunSeconds: config.estimatedRunSeconds }), baseUrl, error: '' };
  } catch (error) {
    return { available: false, state: 'offline', concurrency: 1, running: 0, queued: 0, ahead: 0, position: 0, estimatedWaitSeconds: 0, estimatedRunSeconds: Math.max(60, Number(config.estimatedRunSeconds) || 360), baseUrl, error: String(error?.message || 'ComfyUI queue check failed') };
  }
}

function historyError(entry) {
  const messages = Array.isArray(entry?.status?.messages) ? entry.status.messages : [];
  const failure = messages.find((message) => Array.isArray(message) && ['execution_error', 'execution_interrupted'].includes(message[0]));
  if (!failure) return '';
  const detail = failure[1] || {};
  return String(detail.exception_message || detail.message || failure[0]);
}

export function comfyUiHistoryOutput(entry) {
  for (const output of Object.values(entry?.outputs || {})) {
    for (const key of ['videos', 'gifs', 'images']) {
      const file = Array.isArray(output?.[key]) ? output[key][0] : null;
      if (file?.filename) return { filename: String(file.filename), subfolder: String(file.subfolder || ''), type: String(file.type || 'output') };
    }
  }
  return null;
}

export function comfyUiViewUrl(baseUrl, file) {
  const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
  return `${comfyUiLocalBaseUrl(baseUrl)}/view?${query}`;
}

async function responseJson(response, label) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}${payload?.error ? ` · ${payload.error}` : ''}`);
  return payload;
}

export async function inspectComfyUiMiniMaxH3(config = {}, fetchImpl = fetch) {
  const baseUrl = comfyUiLocalBaseUrl(config.baseUrl);
  let response;
  try { response = await fetchImpl(`${baseUrl}/system_stats`); }
  catch { return { available: false, baseUrl, error: 'ComfyUI 未启动或本地端口不可访问' }; }
  if (!response.ok) return { available: false, baseUrl, error: `ComfyUI 状态检查失败：HTTP ${response.status}` };
  try {
    const nodeResponse = await fetchImpl(`${baseUrl}/object_info/MiniMaxH3ImageToVideo`);
    const nodes = await nodeResponse.json().catch(() => ({}));
    if (!nodeResponse.ok || !nodes?.MiniMaxH3ImageToVideo) return { available: false, baseUrl, error: '当前 ComfyUI 未加载 MiniMax H3 节点，请更新并重启 ComfyUI' };
  } catch { return { available: false, baseUrl, error: '无法核对 ComfyUI MiniMax H3 节点' }; }
  return { available: true, baseUrl, error: '' };
}

async function uploadMedia(fetchImpl, baseUrl, reference, signal) {
  const extension = reference.fileName && /\.[a-z0-9]{1,8}$/i.exec(reference.fileName)?.[0]
    || ({ 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mp4': '.m4a' })[reference.mimeType]
    || '.bin';
  const fileName = `ai-canvas-h3-${crypto.randomUUID()}${extension}`;
  const form = new FormData();
  form.append('image', new Blob([reference.buffer], { type: reference.mimeType }), fileName);
  form.append('type', 'input');
  form.append('overwrite', 'false');
  const response = await fetchImpl(`${baseUrl}/upload/image`, { method: 'POST', body: form, signal });
  const payload = await responseJson(response, 'ComfyUI media upload failed');
  return String(payload.name || fileName);
}

async function cleanupUploadedMedia(inputDirectory, names) {
  if (!inputDirectory || !path.isAbsolute(String(inputDirectory))) return;
  const root = path.resolve(String(inputDirectory));
  await Promise.all(names.map(async (name) => {
    const safeName = path.basename(String(name || ''));
    if (!safeName.startsWith('ai-canvas-h3-')) return;
    const target = path.resolve(root, safeName);
    if (path.dirname(target) !== root) return;
    try { await fs.promises.unlink(target); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }));
}

async function cancelPrompt(fetchImpl, baseUrl, promptId) {
  try {
    const queue = await fetchImpl(`${baseUrl}/queue`).then((response) => response.json());
    const running = Array.isArray(queue?.queue_running) && queue.queue_running.some((item) => Array.isArray(item) && item[1] === promptId);
    await fetchImpl(`${baseUrl}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) });
    if (running) await fetchImpl(`${baseUrl}/interrupt`, { method: 'POST' });
  } catch { /* Local cancellation is best-effort. */ }
}

async function releaseComfyModels(fetchImpl, baseUrl) {
  try {
    const response = await fetchImpl(`${baseUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
    return response.ok;
  } catch {
    // Best effort: older ComfyUI builds may not expose /free.
    return false;
  }
}

function retryableFaceRefineFailure(message) {
  return /HostBuffer\.read_file_slice|read_tensor_file_slice|out of memory/i.test(String(message || ''));
}

export function createComfyUiMiniMaxH3Adapter(model, fetchImpl = fetch) {
  const config = model.config || {};
  const models = modelsForConfig(config);
  const baseUrl = comfyUiLocalBaseUrl(config.baseUrl);
  const pollInterval = Math.max(500, Number(config.pollIntervalMs) || 3000);
  return { kind: 'video', configured: true, async run(job) {
    if (config.managed === true && job.options?.h3FaceRefine === true) throw new Error('Face refinement is unavailable in this dedicated bundle: its optional local resources are not installed.');
    const generationStartedAt = Date.now();
    if (!String(job.prompt || '').trim()) throw new Error('Local H3 requires a prompt');
    validateComfyUiMiniMaxH3Inputs(job.inputs || []);
    const readiness = await inspectComfyUiMiniMaxH3(config, fetchImpl);
    if (!readiness.available) throw new Error(readiness.error);
    const uploadedNames = [];
    try {
    let references = [...(job.referenceImages || [])];
    const reference = references.find((item) => item.port === 'reference');
    if (reference && !references.some((item) => item.port === 'first_frame')) references = [{ ...reference, port: 'first_frame' }, ...references.filter((item) => item !== reference)];
    const referenceMode = isReferenceMode(job.inputs || []);
    const accelerationMode = job.options?.h3AccelerationMode === 'turbo'
      ? 'turbo'
      : job.options?.h3AccelerationMode === 'community8'
        ? 'community8'
      : job.options?.h3AccelerationMode === 'reference8'
        ? 'reference8'
        : 'standard';
    if (['reference8', 'community8'].includes(accelerationMode) && !referenceMode) throw new Error('H3 omni-reference 8-step mode requires omni-reference inputs');
    if (job.options?.h3BlockCache === true && (!referenceMode || accelerationMode !== 'standard')) throw new Error('H3 block cache requires standard omni-reference mode');
    if (accelerationMode === 'community8' && Number(job.options?.duration) > 15) throw new Error('H3 community 8-step mode currently supports at most 15 seconds');
    if (referenceMode) {
      const nodeResponse = await fetchImpl(`${baseUrl}/object_info/MiniMaxH3ReferenceToVideo`);
      const nodeInfo = await nodeResponse.json().catch(() => ({}));
      if (!nodeResponse.ok || !nodeInfo?.MiniMaxH3ReferenceToVideo) throw new Error('Current ComfyUI does not provide MiniMaxH3ReferenceToVideo; update and restart ComfyUI');
      if ((job.inputs || []).some((input) => input.type === 'video')) {
        const normalizeResponse = await fetchImpl(`${baseUrl}/object_info/AICanvasVideoFrames24FPS`);
        const normalizeInfo = await normalizeResponse.json().catch(() => ({}));
        if (!normalizeResponse.ok || !normalizeInfo?.AICanvasVideoFrames24FPS) throw new Error('AI Canvas H3 24fps video node is not installed; install the bundled ComfyUI custom node and restart ComfyUI');
      }
      const loaderResponse = await fetchImpl(`${baseUrl}/object_info/UNETLoader`);
      const loaderInfo = await loaderResponse.json().catch(() => ({}));
      const availableModels = loaderInfo?.UNETLoader?.input?.required?.unet_name?.[0];
      if (!loaderResponse.ok || !Array.isArray(availableModels) || !availableModels.includes(models.referenceDiffusion)) {
        throw new Error(`Local H3 omni-reference model is not installed: ${models.referenceDiffusion}`);
      }
    }
    if (['turbo', 'reference8', 'community8'].includes(accelerationMode)) {
      const requiredNodes = accelerationMode === 'turbo'
        ? ['LoraLoaderModelOnly', 'MiniMaxH3SigmaShift']
        : accelerationMode === 'community8'
          ? ['MiniMaxH3TurboLoRA', 'MiniMaxH3TurboSampler']
          : ['MiniMaxH3SigmaShift'];
      const nodeInfo = {};
      for (const nodeName of requiredNodes) {
        const response = await fetchImpl(`${baseUrl}/object_info/${nodeName}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.[nodeName]) throw new Error(`H3 Turbo component is not installed: ${nodeName}`);
        nodeInfo[nodeName] = payload[nodeName];
      }
      if (accelerationMode === 'turbo') {
        const loaderName = 'LoraLoaderModelOnly';
        const loraName = referenceMode ? models.turboReferenceLora : models.turboDiffusionLora;
        const availableLoras = nodeInfo[loaderName]?.input?.required?.lora_name?.[0];
        if (!Array.isArray(availableLoras) || !availableLoras.includes(loraName)) throw new Error(`H3 Turbo weight is not installed: ${loraName}`);
      }
      if (accelerationMode === 'community8') {
        const availableLoras = nodeInfo.MiniMaxH3TurboLoRA?.input?.required?.lora_name?.[0];
        if (!Array.isArray(availableLoras) || !availableLoras.includes(models.communityReferenceLora)) {
          throw new Error(`H3 community 8-step weight is not installed: ${models.communityReferenceLora}`);
        }
      }
    }
    const hasGuides = (job.inputs || []).some((input) => Number.isInteger(input.guideFrame));
    if (hasGuides || job.options?.h3BlockCache === true) {
      const requiredNodes = [...(hasGuides ? ['MiniMaxH3AddGuide'] : []), ...(job.options?.h3BlockCache === true ? ['ApplyH3Ref2VAUltraSafeBlockCache'] : [])];
      for (const nodeName of requiredNodes) {
        const response = await fetchImpl(`${baseUrl}/object_info/${nodeName}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.[nodeName]) throw new Error(`H3 local component is not installed: ${nodeName}`);
      }
    }
    if (job.options?.h3FaceRefine === true) {
      const requiredNodes = ['H3FaceTrackCrop', 'H3InjectVideoLatent', 'H3PerFrameDenoise', 'H3FaceStitch', 'ImageFromBatch', 'AICanvasVideoFrames24FPS', 'MiniMaxH3ReferenceToVideo', 'LoraLoaderModelOnly', 'MiniMaxH3SigmaShift'];
      for (const nodeName of requiredNodes) {
        const response = await fetchImpl(`${baseUrl}/object_info/${nodeName}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.[nodeName]) throw new Error(`H3 face refine component is not installed: ${nodeName}`);
      }
      const loraResponse = await fetchImpl(`${baseUrl}/object_info/LoraLoaderModelOnly`);
      const loraInfo = await loraResponse.json().catch(() => ({}));
      const availableLoras = loraInfo?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0];
      if (!loraResponse.ok || !Array.isArray(availableLoras) || !availableLoras.includes(models.turboReferenceLora)) {
        throw new Error(`H3 face refine weight is not installed: ${models.turboReferenceLora}`);
      }
    }
    const uploaded = {};
    const allReferenceMedia = referenceMode
      ? [...references.map((item) => ({ ...item, type: 'image' })), ...(job.referenceMedia || [])]
      : references.filter((entry) => ['first_frame', 'last_frame'].includes(entry.port)).map((item) => ({ ...item, type: 'image' }));
    for (const item of allReferenceMedia) {
      const name = await uploadMedia(fetchImpl, baseUrl, item, job.signal);
      uploadedNames.push(name);
      if (referenceMode && Number.isInteger(item.guideFrame)) (uploaded.guides ||= []).push({ type: item.type, file: name, frameIndex: item.guideFrame, ...(item.type === 'video' ? { hasAudioTrack: item.hasAudioTrack === true } : {}) });
      else if (referenceMode) (uploaded[item.type] ||= []).push(item.type === 'video' ? { file: name, hasAudioTrack: item.hasAudioTrack === true } : name);
      else uploaded[item.port] = name;
    }
    await job.onProgress?.(8);
    const seed = Number.isInteger(Number(job.options?.seed)) && Number(job.options.seed) >= 0
      ? Number(job.options.seed)
      : crypto.randomBytes(4).readUInt32LE(0);
    const encoding = comfyUiMiniMaxH3Encoding(job.options?.h3EncodingPreset);
    const mappedPrompt = referenceMode ? mapComfyUiMiniMaxH3ReferencePrompt(job.prompt, allReferenceMedia) : String(job.prompt).trim();
    const samplingSteps = ['reference8', 'community8'].includes(accelerationMode)
      ? 8
      : accelerationMode === 'turbo'
      ? (referenceMode ? 4 : 8)
      : ([20, 24, 28].includes(Number(job.options?.h3SamplingSteps)) ? Number(job.options.h3SamplingSteps) : 20);
    const graph = referenceMode ? buildComfyUiMiniMaxH3ReferencePrompt({
      prompt: mappedPrompt,
      ratio: job.options?.ratio,
      duration: job.options?.duration,
      seed,
      images: uploaded.image || [],
      videos: uploaded.video || [],
      audios: uploaded.audio || [],
      guides: uploaded.guides || [],
      refImageSize: job.options?.refImageSize,
      audioEnabled: job.options?.audioEnabled !== false,
      encodingPreset: encoding.preset,
      samplingSteps,
      accelerationMode,
      blockCache: job.options?.h3BlockCache === true,
      models,
    }) : buildComfyUiMiniMaxH3Prompt({
      prompt: mappedPrompt,
      ratio: job.options?.ratio,
      duration: job.options?.duration,
      seed,
      firstFrame: uploaded.first_frame,
      lastFrame: uploaded.last_frame,
      audioEnabled: job.options?.audioEnabled !== false,
      encodingPreset: encoding.preset,
      samplingSteps,
      accelerationMode,
      models,
    });
    const clientId = `ai-canvas-${crypto.randomUUID()}`;
    const response = await fetchImpl(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
      signal: job.signal,
    });
    const submitted = await responseJson(response, 'ComfyUI H3 submission failed');
    const promptId = String(submitted.prompt_id || '');
    if (!promptId) throw new Error('ComfyUI H3 did not return a prompt id');
    await job.onRemoteTask?.(promptId);
    const reportQueueState = async () => {
      const queueState = await inspectComfyUiMiniMaxH3Queue(config, fetchImpl, promptId);
      if (queueState.available) await job.onQueueState?.(queueState);
    };
    await reportQueueState();
    await job.onProgress?.(12);
    let attempts = 0;
    let refinePromptId = '';
    let faceRefined = false;
    let faceRefineWarning = '';
    try {
      while (true) {
        await sleep(pollInterval, job.signal);
        await reportQueueState();
        const history = await fetchImpl(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { signal: job.signal });
        const payload = await responseJson(history, 'ComfyUI H3 history failed');
        const entry = payload[promptId] || (payload.prompt_id === promptId ? payload : null);
        const failure = historyError(entry);
        if (failure) throw new Error(`ComfyUI H3 failed: ${failure}`);
        const file = comfyUiHistoryOutput(entry);
        if (file) {
          let finalFile = file;
          if (job.options?.h3FaceRefine === true) {
            await job.onProgress?.(74);
            const baseVideoResponse = await fetchImpl(comfyUiViewUrl(baseUrl, file), { signal: job.signal });
            if (!baseVideoResponse.ok) throw new Error(`H3 face refine could not read the generated video: HTTP ${baseVideoResponse.status}`);
            const baseVideoBuffer = Buffer.from(await baseVideoResponse.arrayBuffer());
            const refineInput = await uploadMedia(fetchImpl, baseUrl, { buffer: baseVideoBuffer, mimeType: 'video/mp4', fileName: file.filename }, job.signal);
            uploadedNames.push(refineInput);
            if (await releaseComfyModels(fetchImpl, baseUrl)) await sleep(750, job.signal);
            try {
              for (let refineRun = 0; refineRun < 2 && !faceRefined; refineRun += 1) {
                const refineGraph = buildComfyUiMiniMaxH3FaceRefinePrompt({ video: refineInput, duration: job.options?.duration, seed, audioEnabled: job.options?.audioEnabled !== false, encodingPreset: encoding.preset, models });
                const refineResponse = await fetchImpl(`${baseUrl}/prompt`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ prompt: refineGraph, client_id: `ai-canvas-face-${crypto.randomUUID()}` }), signal: job.signal,
                });
                const refineSubmitted = await responseJson(refineResponse, 'ComfyUI H3 face refine submission failed');
                refinePromptId = String(refineSubmitted.prompt_id || '');
                if (!refinePromptId) throw new Error('ComfyUI H3 face refine did not return a prompt id');
                await job.onRemoteTask?.(refinePromptId);
                let refineAttempts = 0;
                let retryFailure = '';
                while (true) {
                  await sleep(pollInterval, job.signal);
                  const refineHistory = await fetchImpl(`${baseUrl}/history/${encodeURIComponent(refinePromptId)}`, { signal: job.signal });
                  const refinePayload = await responseJson(refineHistory, 'ComfyUI H3 face refine history failed');
                  const refineEntry = refinePayload[refinePromptId] || (refinePayload.prompt_id === refinePromptId ? refinePayload : null);
                  const refineFailure = historyError(refineEntry);
                  if (refineFailure) {
                    if (refineRun === 0 && retryableFaceRefineFailure(refineFailure)) { retryFailure = refineFailure; break; }
                    throw new Error(`ComfyUI H3 face refine failed: ${refineFailure}`);
                  }
                  const refinedFile = comfyUiHistoryOutput(refineEntry);
                  if (refinedFile) { finalFile = refinedFile; faceRefined = true; break; }
                  refineAttempts += 1;
                  await job.onProgress?.(Math.min(96, 76 + Math.floor(Math.log2(refineAttempts + 1) * 7)));
                }
                if (retryFailure && await releaseComfyModels(fetchImpl, baseUrl)) await sleep(1500, job.signal);
              }
            } catch (refineError) {
              if (job.signal?.aborted || refineError?.name === 'AbortError') throw refineError;
              faceRefineWarning = String(refineError?.message || refineError || '小脸修复失败');
            }
          }
          const generationFinishedAt = Date.now();
          return {
            outputs: [{ mediaType: 'video', mediaUrl: comfyUiViewUrl(baseUrl, finalFile), fileName: finalFile.filename, metadata: { remote: false, local: true, provider: 'comfyui', promptId, ...(refinePromptId ? { faceRefinePromptId: refinePromptId } : {}), faceRefineRequested: job.options?.h3FaceRefine === true, faceRefined, ...(faceRefineWarning ? { faceRefineWarning } : {}), duration: job.options?.duration, ratio: job.options?.ratio, resolution: '768P', nativeAudio: job.options?.audioEnabled !== false, seed, codec: encoding.codec, bitDepth: encoding.bitDepth, crf: encoding.crf, encodingPreset: encoding.preset, referenceVideoAudio: job.options?.referenceVideoAudio !== false, accelerationMode, samplingSteps, generationDurationMs: generationFinishedAt - generationStartedAt } }],
            usage: { local: true, gpuSeconds: null },
          };
        }
        attempts += 1;
        await job.onProgress?.(Math.min(job.options?.h3FaceRefine === true ? 70 : 92, 14 + Math.floor(Math.log2(attempts + 1) * 10)));
      }
    } catch (error) {
      if (job.signal?.aborted || error?.name === 'AbortError') {
        await cancelPrompt(fetchImpl, baseUrl, promptId);
        if (refinePromptId) await cancelPrompt(fetchImpl, baseUrl, refinePromptId);
        throw abortError();
      }
      throw error;
    }
    } finally {
      await cleanupUploadedMedia(config.inputDirectory, uploadedNames);
    }
  } };
}
