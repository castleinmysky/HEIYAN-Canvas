import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CHECKPOINT = 'Illustrious-XL-v2.0.safetensors';
const DEFAULT_ILLUSTRIOUS_UPSCALE_MODEL = 'RealESRGAN_x4plus_anime_6B.pth';
const DEFAULT_SDXL_UPSCALE_MODEL = 'RealESRGAN_x4plus.pth';
const DEFAULT_NEGATIVE_PROMPT = 'worst quality, low quality, lowres, blurry, jpeg artifacts, bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra arms, extra legs, multiple characters, cropped, out of frame, text, logo, watermark, signature, busy background, photorealistic, 3d render';
export const SDPOSE_CHECKPOINT = 'sdpose_wholebody_fp16.safetensors';
export const ILLUSTRIOUS_CHARACTER_FINAL_WORKFLOW_ID = 'illustrious-character-final-v1';
export const SDXL_CHARACTER_CONSISTENCY_WORKFLOW_ID = 'sdxl-character-consistency-v1';
export const SDXL_POSE_WORKFLOW_ID = 'sdxl-pose-v1';
export const SDXL_HIGHRES_REFINE_WORKFLOW_ID = 'sdxl-highres-refine-v1';
export const ILLUSTRIOUS_HIGHRES_REFINE_WORKFLOW_ID = 'illustrious-highres-refine-v1';
export const SDXL_INSTANTID_WORKFLOW_ID = 'sdxl-instantid-v1';
export const SDXL_PULID_WORKFLOW_ID = 'sdxl-pulid-v1';
export const SDXL_INSTANTID_FACE_DETAIL_WORKFLOW_ID = 'sdxl-instantid-face-detail-v1';
export const ILLUSTRIOUS_INSTANTID_WORKFLOW_ID = 'illustrious-instantid-v1';
export const ILLUSTRIOUS_PULID_WORKFLOW_ID = 'illustrious-pulid-v1';
export const ILLUSTRIOUS_INSTANTID_FACE_DETAIL_WORKFLOW_ID = 'illustrious-instantid-face-detail-v1';
export const COMFYUI_IDENTITY_MODELS = Object.freeze({
  instantId: 'ip-adapter.bin',
  instantIdControlNet: 'instantid-controlnet.safetensors',
  pulid: 'ip-adapter_pulid_sdxl_fp16.safetensors',
  faceDetector: 'bbox/face_yolov8m.pt',
});
const PRECISE_IDENTITY_WORKFLOWS = Object.freeze({
  [SDXL_INSTANTID_WORKFLOW_ID]: Object.freeze({ method: 'instantid', faceDetailer: false }),
  [SDXL_PULID_WORKFLOW_ID]: Object.freeze({ method: 'pulid', faceDetailer: false }),
  [SDXL_INSTANTID_FACE_DETAIL_WORKFLOW_ID]: Object.freeze({ method: 'instantid', faceDetailer: true }),
  [ILLUSTRIOUS_INSTANTID_WORKFLOW_ID]: Object.freeze({ method: 'instantid', faceDetailer: false }),
  [ILLUSTRIOUS_PULID_WORKFLOW_ID]: Object.freeze({ method: 'pulid', faceDetailer: false }),
  [ILLUSTRIOUS_INSTANTID_FACE_DETAIL_WORKFLOW_ID]: Object.freeze({ method: 'instantid', faceDetailer: true }),
});

export function comfyUiPreciseIdentityWorkflow(workflowId) {
  const workflow = PRECISE_IDENTITY_WORKFLOWS[String(workflowId || '')];
  return workflow ? { ...workflow } : null;
}
export const ILLUSTRIOUS_CONTROL_MODELS = Object.freeze({
  ipAdapter: 'ip-adapter-plus_sdxl_vit-h.safetensors',
  clipVision: 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors',
  openPose: 'thibaud_xl_openpose_256lora.safetensors',
  lineart: 'mistoLine_rank256.safetensors',
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

export function comfyUiIllustriousBaseUrl(value) {
  let url;
  try { url = new URL(String(value || 'http://127.0.0.1:8188')); }
  catch { throw new Error('ComfyUI 本地地址无效'); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)) {
    throw new Error('Illustrious 仅接受本机回环 ComfyUI 地址');
  }
  if (url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('ComfyUI 本地地址只能包含主机和端口');
  }
  return url.toString().replace(/\/$/, '');
}

export function illustriousDimensions(ratio) {
  return ({
    '16:9': { width: 1280, height: 720 },
    '21:9': { width: 1568, height: 672 },
    '4:3': { width: 1152, height: 864 },
    '1:1': { width: 1024, height: 1024 },
    '3:4': { width: 864, height: 1152 },
    '9:16': { width: 720, height: 1280 },
  })[ratio] || { width: 864, height: 1152 };
}

function compactReferenceCacheToken(value) {
  const encoded = Buffer.from(String(value || ''), 'utf8').toString('base64url');
  return encoded.length <= 96 ? encoded : `${encoded.slice(0, 48)}-${encoded.slice(-47)}`;
}

export function comfyUiPoseCacheKey(referenceBuffer, poseEstimator = 'sdpose', ratio = '3:4', referenceCacheKey = '') {
  const estimator = poseEstimator === 'dwpose' ? 'dwpose' : 'sdpose';
  const dimensions = illustriousDimensions(ratio);
  if (referenceCacheKey) return compactReferenceCacheToken(`${referenceCacheKey}|${estimator}|${dimensions.width}x${dimensions.height}`);
  return crypto.createHash('sha256')
    .update('ai-canvas-pose-map-v1\0')
    .update(estimator)
    .update('\0')
    .update(`${dimensions.width}x${dimensions.height}`)
    .update('\0')
    .update(Buffer.from(referenceBuffer || []))
    .digest('hex');
}

export function comfyUiIdentityCacheName(referenceBuffer, fileName = '', mimeType = '', referenceCacheKey = '') {
  const extension = /\.[a-z0-9]{1,8}$/i.exec(String(fileName || ''))?.[0]
    || ({ 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png' })[String(mimeType || '')]
    || '.png';
  const key = referenceCacheKey
    ? compactReferenceCacheToken(referenceCacheKey)
    : crypto.createHash('sha256')
      .update('ai-canvas-character-appearance-v1\0')
      .update(Buffer.from(referenceBuffer || []))
      .digest('hex');
  return `ai-canvas-identity-${key}${extension}`;
}

export function buildComfyUiPosePreviewPrompt({
  referenceImage,
  poseEstimator = 'sdpose',
  ratio = '3:4',
  filenamePrefix = 'AI_Canvas_Pose/preview',
} = {}) {
  if (!referenceImage) throw new Error('骨架预览需要姿势参考图');
  const { width, height } = illustriousDimensions(ratio);
  const graph = {};
  let nextId = 1;
  const add = (classType, inputs, title = '') => {
    const id = String(nextId++);
    graph[id] = { class_type: classType, inputs, ...(title ? { _meta: { title } } : {}) };
    return id;
  };
  const imageId = add('LoadImage', { image: referenceImage }, 'AI Canvas · 姿势参考图');
  let poseId;
  if (poseEstimator === 'dwpose') {
    poseId = add('DWPreprocessor', {
      image: [imageId, 0], detect_hand: 'enable', detect_body: 'enable', detect_face: 'enable', resolution: 1024,
      bbox_detector: 'yolox_l.onnx', pose_estimator: 'dw-ll_ucoco_384_bs5.torchscript.pt', scale_stick_for_xinsr_cn: 'disable',
    }, 'AI Canvas · DWPose 快速姿势提取');
  } else {
    const detectionImageId = add('ImageScaleToMaxDimension', {
      image: [imageId, 0], upscale_method: 'area', largest_size: 1024,
    }, 'AI Canvas · SDPose 等比检测输入');
    const sdPoseCheckpointId = add('CheckpointLoaderSimple', {
      ckpt_name: SDPOSE_CHECKPOINT,
    }, 'AI Canvas · SDPose OOD 高精度识别模型');
    const keypointId = add('SDPoseKeypointExtractor', {
      model: [sdPoseCheckpointId, 0], vae: [sdPoseCheckpointId, 2], image: [detectionImageId, 0], batch_size: 1,
    }, 'AI Canvas · SDPose 全身关键点提取');
    poseId = add('SDPoseDrawKeypoints', {
      keypoints: [keypointId, 0], draw_body: true, draw_hands: true, draw_face: true, draw_feet: true,
      stick_width: 4, face_point_size: 2, score_threshold: 0.3, draw_head: true,
    }, 'AI Canvas · SDPose 骨架绘制');
  }
  const fittedPoseId = add('ResizeAndPadImage', {
    image: [poseId, 0], target_width: width, target_height: height, padding_color: 'black', interpolation: 'nearest-exact',
  }, `AI Canvas · 骨架等比补边 ${width}×${height}`);
  add('SaveImage', { filename_prefix: filenamePrefix, images: [fittedPoseId, 0] }, 'AI Canvas · 保存骨架预览');
  return graph;
}

export function illustriousOutputDimensions(ratio, resolution = '1K') {
  const size = String(resolution || '1K').trim().toUpperCase();
  if (size === '2K') {
    return ({
      '16:9': { width: 2048, height: 1152 },
      '21:9': { width: 2016, height: 864 },
      '4:3': { width: 2048, height: 1536 },
      '1:1': { width: 2048, height: 2048 },
      '3:4': { width: 1536, height: 2048 },
      '9:16': { width: 1152, height: 2048 },
    })[ratio] || { width: 1536, height: 2048 };
  }
  if (size === '4K') {
    return ({
      '16:9': { width: 3840, height: 2160 },
      '21:9': { width: 4032, height: 1728 },
      '4:3': { width: 4096, height: 3072 },
      '1:1': { width: 4096, height: 4096 },
      '3:4': { width: 3072, height: 4096 },
      '9:16': { width: 2160, height: 3840 },
    })[ratio] || { width: 3072, height: 4096 };
  }
  return illustriousDimensions(ratio);
}

export function highResRefinementIntermediateDimensions(ratio, resolution = '2K') {
  const target = normalizedLocalResolution(resolution);
  return target === '1K' ? illustriousDimensions(ratio) : illustriousOutputDimensions(ratio, '2K');
}

function safeUpscaleModelName(value) {
  const name = String(value || '').trim();
  return name && name.length <= 180 && /^[^<>:"|?*\r\n]+\.(?:pth|pt|safetensors)$/i.test(name)
    && !name.split(/[\\/]/).some((part) => !part || part === '.' || part === '..') ? name : '';
}

function normalizedLocalResolution(value) {
  const resolution = String(value || '1K').trim().toUpperCase();
  return ['1K', '2K', '4K'].includes(resolution) ? resolution : '1K';
}

function applySamplingDimensions(graph, ratio) {
  const { width, height } = illustriousDimensions(ratio);
  Object.values(graph).forEach((node) => {
    if (node?.class_type !== 'EmptyLatentImage' || !node.inputs || typeof node.inputs !== 'object') return;
    node.inputs.width = width;
    node.inputs.height = height;
  });
}

function boundedRefineDenoise(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0.15, Math.min(0.35, number)) : 0.25;
}

function applyOutputResolution(graph, ratio, resolution, upscaleModelValue, { highResRefine = false, refineDenoise = 0.25 } = {}) {
  const targetResolution = normalizedLocalResolution(resolution);
  if (targetResolution === '1K') return graph;
  const upscaleModel = safeUpscaleModelName(upscaleModelValue);
  if (!upscaleModel) throw new Error(`${targetResolution} 输出需要有效的本地超分模型`);
  const outputEntries = Object.entries(graph).filter(([, node]) => ['SaveImage', 'PreviewImage'].includes(String(node?.class_type || '')) && Array.isArray(node?.inputs?.images));
  if (!outputEntries.length) throw new Error(`${targetResolution} 输出需要工作流包含 SaveImage 或 PreviewImage 节点`);
  const { width, height } = illustriousOutputDimensions(ratio, targetResolution);
  const intermediate = highResRefinementIntermediateDimensions(ratio, targetResolution);
  const samplerEntry = highResRefine ? primarySamplerEntry(graph) : null;
  const vae = highResRefine ? vaeSourceLink(graph) : null;
  if (highResRefine && (!samplerEntry || !vae)) throw new Error(`${targetResolution} 高清二次精修需要标准 KSampler 与 VAE 路径`);
  const loaderId = nextPromptNodeId(graph);
  graph[loaderId] = {
    class_type: 'UpscaleModelLoader',
    inputs: { model_name: upscaleModel },
    _meta: { title: `AI Canvas · ${targetResolution} 超分模型` },
  };
  outputEntries.forEach(([, outputNode]) => {
    let sourceImage = [...outputNode.inputs.images];
    if (highResRefine) {
      const fitId = nextPromptNodeId(graph);
      graph[fitId] = {
        class_type: 'ResizeAndPadImage',
        inputs: {
          image: sourceImage,
          target_width: intermediate.width,
          target_height: intermediate.height,
          padding_color: 'black',
          interpolation: 'lanczos',
        },
        _meta: { title: `AI Canvas · 等比精修画布 ${intermediate.width}×${intermediate.height}` },
      };
      const encodeId = nextPromptNodeId(graph);
      graph[encodeId] = {
        class_type: 'VAEEncode',
        inputs: { pixels: [fitId, 0], vae: [...vae] },
        _meta: { title: 'AI Canvas · 高清精修重编码' },
      };
      const refineSamplerId = nextPromptNodeId(graph);
      graph[refineSamplerId] = {
        class_type: 'KSampler',
        inputs: {
          ...samplerEntry[1].inputs,
          latent_image: [encodeId, 0],
          denoise: boundedRefineDenoise(refineDenoise),
        },
        _meta: { title: 'AI Canvas · 低重绘二次精修' },
      };
      const refineDecodeId = nextPromptNodeId(graph);
      graph[refineDecodeId] = {
        class_type: 'VAEDecode',
        inputs: { samples: [refineSamplerId, 0], vae: [...vae] },
        _meta: { title: 'AI Canvas · 高清精修解码' },
      };
      sourceImage = [refineDecodeId, 0];
    }
    const upscaleId = nextPromptNodeId(graph);
    graph[upscaleId] = {
      class_type: 'ImageUpscaleWithModel',
      inputs: { upscale_model: [loaderId, 0], image: sourceImage },
      _meta: { title: 'AI Canvas · Real-ESRGAN 细节放大' },
    };
    const scaleId = nextPromptNodeId(graph);
    graph[scaleId] = {
      class_type: 'ImageScale',
      inputs: { image: [upscaleId, 0], upscale_method: 'lanczos', width, height, crop: 'disabled' },
      _meta: { title: `AI Canvas · 精确输出 ${width}×${height}` },
    };
    outputNode.inputs.images = [scaleId, 0];
  });
  return graph;
}

function promptWithReference(prompt, hasReference) {
  const value = String(prompt || '').trim();
  if (!hasReference) return value;
  return value.replace(/@(?:图片|图像|image)1/gi, 'the supplied reference image');
}

function mergePromptParts(...values) {
  const seen = new Set();
  return values.flatMap((value) => String(value || '').split(',')).map((part) => part.trim()).filter((part) => {
    const key = part.toLowerCase().replace(/[\s_]+/g, ' ');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(', ');
}

export function buildComfyUiIllustriousPrompt({
  prompt,
  negativePrompt = DEFAULT_NEGATIVE_PROMPT,
  positivePrefix = 'masterpiece, best quality, amazing quality',
  checkpoint = DEFAULT_CHECKPOINT,
  ratio = '3:4',
  resolution = '1K',
  upscaleModel = DEFAULT_ILLUSTRIOUS_UPSCALE_MODEL,
  seed = 1,
  steps = 28,
  cfg = 5.5,
  sampler = 'dpmpp_2m_sde',
  scheduler = 'karras',
  referenceImage = '',
  denoise,
  characterLora = '',
  characterLoraStrength = 0.8,
  highResRefine = false,
  refineDenoise = 0.25,
  filenamePrefix = 'AI_Canvas_ILXL/game_character',
} = {}) {
  const text = promptWithReference(prompt, Boolean(referenceImage));
  if (!text) throw new Error('Illustrious 需要提示词');
  const { width, height } = illustriousDimensions(ratio);
  const samplingDenoise = Number.isFinite(Number(denoise))
    ? Math.max(0.05, Math.min(1, Number(denoise)))
    : referenceImage ? 0.72 : 1;
  const positive = mergePromptParts(positivePrefix, text);
  const preserveReferenceAspect = highResRefine && normalizedLocalResolution(resolution) !== '1K';
  const graph = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: String(negativePrompt || '').trim(), clip: ['1', 1] } },
  };
  const loraName = safeLoraName(characterLora);
  const modelLink = loraName ? ['10', 0] : ['1', 0];
  if (loraName) {
    graph['10'] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model: ['1', 0], lora_name: loraName, strength_model: boundedStrength(characterLoraStrength, 0.8) },
      _meta: { title: 'AI Canvas · 人物刻画 LoRA' },
    };
  }
  if (referenceImage) {
    graph['4'] = { class_type: 'LoadImage', inputs: { image: referenceImage } };
    graph['5'] = preserveReferenceAspect
      ? { class_type: 'ResizeAndPadImage', inputs: { image: ['4', 0], target_width: width, target_height: height, padding_color: 'black', interpolation: 'lanczos' } }
      : { class_type: 'ImageScale', inputs: { image: ['4', 0], upscale_method: 'lanczos', width, height, crop: 'center' } };
    graph['6'] = { class_type: 'VAEEncode', inputs: { pixels: ['5', 0], vae: ['1', 2] } };
    graph['7'] = { class_type: 'KSampler', inputs: { seed, steps, cfg, sampler_name: sampler, scheduler, denoise: samplingDenoise, model: modelLink, positive: ['2', 0], negative: ['3', 0], latent_image: ['6', 0] } };
    graph['8'] = { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['1', 2] } };
    graph['9'] = { class_type: 'SaveImage', inputs: { filename_prefix: filenamePrefix, images: ['8', 0] } };
  } else {
    graph['4'] = { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } };
    graph['5'] = { class_type: 'KSampler', inputs: { seed, steps, cfg, sampler_name: sampler, scheduler, denoise: samplingDenoise, model: modelLink, positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0] } };
    graph['6'] = { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } };
    graph['7'] = { class_type: 'SaveImage', inputs: { filename_prefix: filenamePrefix, images: ['6', 0] } };
  }
  return applyOutputResolution(graph, ratio, resolution, upscaleModel, { highResRefine, refineDenoise });
}

function boundedStrength(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(2, number)) : fallback;
}

function safeLoraName(value) {
  const name = String(value || '').trim();
  return name && /^[^<>:"|?*\r\n]+\.safetensors$/i.test(name) && !name.split(/[\\/]/).some((part) => !part || part === '.' || part === '..') ? name : '';
}

export function buildComfyUiCharacterFinalPrompt({
  prompt,
  negativePrompt = DEFAULT_NEGATIVE_PROMPT,
  positivePrefix = 'masterpiece, best quality, amazing quality',
  checkpoint = DEFAULT_CHECKPOINT,
  ratio = '3:4',
  resolution = '1K',
  upscaleModel = DEFAULT_ILLUSTRIOUS_UPSCALE_MODEL,
  seed = 1,
  steps = 28,
  cfg = 5.5,
  sampler = 'dpmpp_2m_sde',
  scheduler = 'karras',
  denoise = 1,
  references = {},
  identityStrength = 0.75,
  identityMethod = 'ipadapter',
  faceDetailer = false,
  proportionStrength = 0.45,
  poseStrength = 0.85,
  poseEstimator = 'sdpose',
  preprocessedPose = false,
  lineartStrength = 0.7,
  characterLora = '',
  characterLoraStrength = 0.8,
  characterLoraMode = 'model-clip',
  styleLora = '',
  objectLora = '',
  highResRefine = false,
  refineDenoise = 0.25,
  filenamePrefix = 'AI_Canvas_ILXL/character_final',
} = {}) {
  const text = promptWithReference(prompt, Object.values(references).some(Boolean));
  if (!text) throw new Error('姿势控制工作流需要提示词');
  const { width, height } = illustriousDimensions(ratio);
  const graph = {};
  let nextId = 1;
  const add = (classType, inputs, title = '') => {
    const id = String(nextId++);
    graph[id] = { class_type: classType, inputs, ...(title ? { _meta: { title } } : {}) };
    return id;
  };
  const checkpointId = add('CheckpointLoaderSimple', { ckpt_name: checkpoint }, 'AI Canvas · SDXL 基础模型');
  let modelLink = [checkpointId, 0];
  let clipLink = [checkpointId, 1];
  const vaeLink = [checkpointId, 2];
  const characterLoraName = safeLoraName(characterLora);
  if (characterLoraName && characterLoraMode === 'model-only') {
    const id = add('LoraLoaderModelOnly', {
      model: modelLink,
      lora_name: characterLoraName,
      strength_model: boundedStrength(characterLoraStrength, 0.8),
    }, 'AI Canvas · 人物刻画 LoRA');
    modelLink = [id, 0];
  }
  [
    [characterLoraMode === 'model-only' ? '' : characterLoraName, '角色 LoRA', 0.85],
    [safeLoraName(styleLora), '画风 LoRA', 0.7],
    [safeLoraName(objectLora), '物件 LoRA', 0.75],
  ].forEach(([loraName, label, strength]) => {
    if (!loraName) return;
    const id = add('LoraLoader', { model: modelLink, clip: clipLink, lora_name: loraName, strength_model: strength, strength_clip: strength }, `AI Canvas · ${label}`);
    modelLink = [id, 0];
    clipLink = [id, 1];
  });
  const positiveId = add('CLIPTextEncode', { text: mergePromptParts(positivePrefix, text), clip: clipLink }, 'AI Canvas · 正向提示词');
  const negativeId = add('CLIPTextEncode', { text: String(negativePrompt || '').trim(), clip: clipLink }, 'AI Canvas · 负向提示词');
  let positiveLink = [positiveId, 0];
  let negativeLink = [negativeId, 0];

  if (references.identity) {
    const imageId = add('LoadImage', { image: references.identity }, 'AI Canvas · 角色外观');
    if (identityMethod === 'instantid') {
      const instantId = add('InstantIDModelLoader', { instantid_file: COMFYUI_IDENTITY_MODELS.instantId }, 'AI Canvas · InstantID 模型');
      const faceAnalysis = add('InstantIDFaceAnalysis', { provider: 'CPU' }, 'AI Canvas · InstantID 人脸分析');
      const controlNet = add('ControlNetLoader', { control_net_name: COMFYUI_IDENTITY_MODELS.instantIdControlNet }, 'AI Canvas · InstantID ControlNet');
      const appliedId = add('ApplyInstantIDAdvanced', {
        instantid: [instantId, 0], insightface: [faceAnalysis, 0], control_net: [controlNet, 0], image: [imageId, 0],
        model: modelLink, positive: positiveLink, negative: negativeLink,
        ip_weight: boundedStrength(identityStrength, 0.8), cn_strength: 0.8,
        start_at: 0, end_at: 1, noise: 0, combine_embeds: 'average',
      }, 'AI Canvas · InstantID 精准身份锁定');
      modelLink = [appliedId, 0];
      positiveLink = [appliedId, 1];
      negativeLink = [appliedId, 2];
    } else if (identityMethod === 'pulid') {
      const pulid = add('PulidModelLoader', { pulid_file: COMFYUI_IDENTITY_MODELS.pulid }, 'AI Canvas · PuLID 模型');
      const evaClip = add('PulidEvaClipLoader', {}, 'AI Canvas · PuLID EVA-CLIP');
      const faceAnalysis = add('PulidInsightFaceLoader', { provider: 'CPU' }, 'AI Canvas · PuLID 人脸分析');
      const appliedId = add('ApplyPulidAdvanced', {
        model: modelLink, pulid: [pulid, 0], eva_clip: [evaClip, 0], face_analysis: [faceAnalysis, 0], image: [imageId, 0],
        weight: boundedStrength(identityStrength, 0.9), projection: 'ortho_v2', fidelity: 8, noise: 0, start_at: 0, end_at: 1,
      }, 'AI Canvas · PuLID 精准身份锁定');
      modelLink = [appliedId, 0];
    } else {
      const adapterId = add('IPAdapterModelLoader', { ipadapter_file: ILLUSTRIOUS_CONTROL_MODELS.ipAdapter }, 'AI Canvas · 身份 IPAdapter');
      const visionId = add('CLIPVisionLoader', { clip_name: ILLUSTRIOUS_CONTROL_MODELS.clipVision }, 'AI Canvas · 身份视觉编码器');
      const appliedId = add('IPAdapterAdvanced', {
        model: modelLink,
        ipadapter: [adapterId, 0],
        image: [imageId, 0],
        weight: boundedStrength(identityStrength, 0.75),
        weight_type: 'linear',
        combine_embeds: 'concat',
        start_at: 0,
        end_at: 0.85,
        embeds_scaling: 'V only',
        clip_vision: [visionId, 0],
      }, 'AI Canvas · 近似身份保持');
      modelLink = [appliedId, 0];
    }
  }

  let openPoseLoaderId = '';
  const openPoseControl = () => {
    if (!openPoseLoaderId) openPoseLoaderId = add('ControlNetLoader', { control_net_name: ILLUSTRIOUS_CONTROL_MODELS.openPose }, 'AI Canvas · OpenPose ControlNet');
    return [openPoseLoaderId, 0];
  };
  const applyControl = (imageLink, controlLink, strength, endPercent, title) => {
    const id = add('ControlNetApplyAdvanced', {
      positive: positiveLink,
      negative: negativeLink,
      control_net: controlLink,
      image: imageLink,
      strength,
      start_percent: 0,
      end_percent: endPercent,
      vae: vaeLink,
    }, title);
    positiveLink = [id, 0];
    negativeLink = [id, 1];
  };
  if (references.proportion) {
    const imageId = add('LoadImage', { image: references.proportion }, 'AI Canvas · 头身比例');
    applyControl([imageId, 0], openPoseControl(), boundedStrength(proportionStrength, 0.45), 0.55, 'AI Canvas · 头身比例控制');
  }
  if (references.pose) {
    const imageId = add('LoadImage', { image: references.pose }, 'AI Canvas · 动作姿势');
    let poseId = imageId;
    if (!preprocessedPose && poseEstimator === 'dwpose') {
      poseId = add('DWPreprocessor', {
        image: [imageId, 0], detect_hand: 'enable', detect_body: 'enable', detect_face: 'enable', resolution: 1024,
        bbox_detector: 'yolox_l.onnx', pose_estimator: 'dw-ll_ucoco_384_bs5.torchscript.pt', scale_stick_for_xinsr_cn: 'disable',
      }, 'AI Canvas · DWPose 快速姿势提取');
    } else if (!preprocessedPose) {
      const detectionImageId = add('ImageScaleToMaxDimension', {
        image: [imageId, 0], upscale_method: 'area', largest_size: 1024,
      }, 'AI Canvas · SDPose 等比检测输入');
      const sdPoseCheckpointId = add('CheckpointLoaderSimple', {
        ckpt_name: SDPOSE_CHECKPOINT,
      }, 'AI Canvas · SDPose OOD 高精度识别模型');
      const keypointId = add('SDPoseKeypointExtractor', {
        model: [sdPoseCheckpointId, 0], vae: [sdPoseCheckpointId, 2], image: [detectionImageId, 0], batch_size: 1,
      }, 'AI Canvas · SDPose 全身关键点提取');
      poseId = add('SDPoseDrawKeypoints', {
        keypoints: [keypointId, 0], draw_body: true, draw_hands: true, draw_face: true, draw_feet: true,
        stick_width: 4, face_point_size: 2, score_threshold: 0.3, draw_head: true,
      }, 'AI Canvas · SDPose 骨架绘制');
    }
    // ControlNet's default hint preparation center-crops mismatched aspect ratios.
    // Fit the extracted skeleton proportionally and pad the remainder with black;
    // this keeps every joint without distorting limb angles or body proportions.
    const controlPoseId = preprocessedPose ? poseId : add('ResizeAndPadImage', {
      image: [poseId, 0], target_width: width, target_height: height, padding_color: 'black', interpolation: 'nearest-exact',
    }, `AI Canvas · 骨架等比补边 ${width}×${height}`);
    applyControl([controlPoseId, 0], openPoseControl(), boundedStrength(poseStrength, 0.85), 1, 'AI Canvas · 动作姿势控制');
  }
  if (references.lineart) {
    const imageId = add('LoadImage', { image: references.lineart }, 'AI Canvas · 线稿上色');
    const controlId = add('ControlNetLoader', { control_net_name: ILLUSTRIOUS_CONTROL_MODELS.lineart }, 'AI Canvas · MistoLine ControlNet');
    applyControl([imageId, 0], [controlId, 0], boundedStrength(lineartStrength, 0.7), 0.9, 'AI Canvas · 线稿结构控制');
  }

  const latentId = add('EmptyLatentImage', { width, height, batch_size: 1 }, 'AI Canvas · 输出画幅');
  const samplerId = add('KSampler', {
    seed, steps, cfg, sampler_name: sampler, scheduler, denoise,
    model: modelLink, positive: positiveLink, negative: negativeLink, latent_image: [latentId, 0],
  }, 'AI Canvas · 姿势控制采样');
  const decodeId = add('VAEDecode', { samples: [samplerId, 0], vae: vaeLink }, 'AI Canvas · 解码');
  let outputImage = [decodeId, 0];
  if (faceDetailer) {
    const detectorId = add('UltralyticsDetectorProvider', { model_name: COMFYUI_IDENTITY_MODELS.faceDetector }, 'AI Canvas · 面部检测器');
    const detailerId = add('FaceDetailer', {
      image: outputImage, model: modelLink, clip: clipLink, vae: vaeLink,
      guide_size: 512, guide_size_for: true, max_size: 1024,
      seed, steps: Math.max(12, Math.min(28, Number(steps) || 20)), cfg,
      sampler_name: sampler, scheduler, positive: positiveLink, negative: negativeLink, denoise: 0.3,
      feather: 5, noise_mask: true, force_inpaint: true,
      bbox_threshold: 0.5, bbox_dilation: 10, bbox_crop_factor: 3,
      sam_detection_hint: 'center-1', sam_dilation: 0, sam_threshold: 0.93,
      sam_bbox_expansion: 0, sam_mask_hint_threshold: 0.7, sam_mask_hint_use_negative: 'False',
      drop_size: 10, bbox_detector: [detectorId, 0], wildcard: '', cycle: 1,
    }, 'AI Canvas · FaceDetailer 面部精修');
    outputImage = [detailerId, 0];
  }
  add('SaveImage', { filename_prefix: filenamePrefix, images: outputImage }, 'AI Canvas · 保存图片');
  return applyOutputResolution(graph, ratio, resolution, upscaleModel, { highResRefine, refineDenoise });
}

function linkedNodeId(value) {
  return Array.isArray(value) && value.length >= 2 ? String(value[0]) : '';
}

function nextPromptNodeId(graph) {
  let next = Math.max(0, ...Object.keys(graph).map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id >= 0)) + 1;
  while (Object.hasOwn(graph, String(next))) next += 1;
  return String(next);
}

function primarySamplerEntry(graph) {
  return Object.entries(graph).find(([, node]) => node?.class_type === 'KSampler' && node.inputs && typeof node.inputs === 'object');
}

function applyModelOnlyLora(graph, sampler, loraNameValue, strengthValue) {
  const loraName = safeLoraName(loraNameValue);
  const modelLink = Array.isArray(sampler?.inputs?.model) ? [...sampler.inputs.model] : null;
  if (!modelLink) {
    if (loraName) throw new Error('已选择 LoRA，但当前专家工作流的 KSampler 没有标准 MODEL 输入');
    return;
  }
  const upstreamId = linkedNodeId(modelLink);
  const upstream = upstreamId ? graph[upstreamId] : null;
  const directLora = upstream?.class_type === 'LoraLoaderModelOnly' && upstream.inputs && typeof upstream.inputs === 'object' ? upstream : null;
  if (!loraName) {
    if (directLora && Array.isArray(directLora.inputs.model)) {
      sampler.inputs.model = [...directLora.inputs.model];
      delete graph[upstreamId];
    }
    return;
  }
  if (directLora) {
    directLora.inputs.lora_name = loraName;
    directLora.inputs.strength_model = boundedStrength(strengthValue, 0.8);
    return;
  }
  const loraId = nextPromptNodeId(graph);
  graph[loraId] = {
    class_type: 'LoraLoaderModelOnly',
    inputs: { model: modelLink, lora_name: loraName, strength_model: boundedStrength(strengthValue, 0.8) },
    _meta: { title: 'AI Canvas · 人物刻画 LoRA' },
  };
  sampler.inputs.model = [loraId, 0];
}

function vaeSourceLink(graph) {
  for (const [, node] of Object.entries(graph)) {
    if (Array.isArray(node?.inputs?.vae)) return [...node.inputs.vae];
  }
  const vaeLoader = Object.entries(graph).find(([, node]) => node?.class_type === 'VAELoader');
  if (vaeLoader) return [vaeLoader[0], 0];
  const checkpoint = Object.entries(graph).find(([, node]) => ['CheckpointLoaderSimple', 'CheckpointLoader'].includes(String(node?.class_type || '')));
  return checkpoint ? [checkpoint[0], 2] : null;
}

function applyCanvasPrompt(graph, sampler, prompt, positivePrefix, hasReference, negativePrompt = '') {
  const text = promptWithReference(prompt, hasReference);
  const positiveId = linkedNodeId(sampler?.inputs?.positive);
  const positiveNode = positiveId ? graph[positiveId] : null;
  if (text && positiveNode?.class_type === 'CLIPTextEncode' && positiveNode.inputs && Object.hasOwn(positiveNode.inputs, 'text')) {
    positiveNode.inputs.text = mergePromptParts(positivePrefix, text);
  }
  const negativeId = linkedNodeId(sampler?.inputs?.negative);
  const negativeNode = negativeId ? graph[negativeId] : null;
  if (negativePrompt && negativeNode?.class_type === 'CLIPTextEncode' && negativeNode.inputs && Object.hasOwn(negativeNode.inputs, 'text')) {
    negativeNode.inputs.text = String(negativePrompt).trim();
  }
}

function applyReferenceImage(graph, sampler, referenceImage, ratio, referenceDenoise, preserveAspectRatio = false) {
  const denoise = Number.isFinite(Number(referenceDenoise))
    ? Math.min(1, Math.max(0.05, Number(referenceDenoise)))
    : 0.72;
  const loadEntries = Object.entries(graph).filter(([, node]) => node?.class_type === 'LoadImage' && node.inputs && typeof node.inputs === 'object');
  loadEntries.forEach(([, node]) => { node.inputs.image = referenceImage; });
  const latentSourceId = linkedNodeId(sampler.inputs.latent_image);
  const latentSource = latentSourceId ? graph[latentSourceId] : null;
  if (!latentSource || latentSource.class_type === 'EmptyLatentImage') {
    const vae = vaeSourceLink(graph);
    if (!vae) throw new Error('已连接参考图，但当前专家工作流缺少可用的 VAE 路径');
    let loadId = loadEntries[0]?.[0];
    if (!loadId) {
      loadId = nextPromptNodeId(graph);
      graph[loadId] = { class_type: 'LoadImage', inputs: { image: referenceImage } };
    }
    const { width, height } = illustriousDimensions(ratio);
    const scaleId = nextPromptNodeId(graph);
    graph[scaleId] = preserveAspectRatio
      ? { class_type: 'ResizeAndPadImage', inputs: { image: [loadId, 0], target_width: width, target_height: height, padding_color: 'black', interpolation: 'lanczos' } }
      : { class_type: 'ImageScale', inputs: { image: [loadId, 0], upscale_method: 'lanczos', width, height, crop: 'center' } };
    const encodeId = nextPromptNodeId(graph);
    graph[encodeId] = { class_type: 'VAEEncode', inputs: { pixels: [scaleId, 0], vae } };
    sampler.inputs.latent_image = [encodeId, 0];
  } else if (!loadEntries.length) {
    throw new Error('已连接参考图，但当前专家工作流没有可替换的 LoadImage 输入');
  }
  if (preserveAspectRatio && latentSource?.class_type === 'VAEEncode' && Array.isArray(latentSource.inputs?.pixels)) {
    const pixelsId = linkedNodeId(latentSource.inputs.pixels);
    const pixelsNode = pixelsId ? graph[pixelsId] : null;
    const { width, height } = illustriousDimensions(ratio);
    if (pixelsNode?.class_type === 'ImageScale') {
      pixelsNode.class_type = 'ResizeAndPadImage';
      pixelsNode.inputs = {
        image: Array.isArray(pixelsNode.inputs?.image) ? [...pixelsNode.inputs.image] : [...latentSource.inputs.pixels],
        target_width: width,
        target_height: height,
        padding_color: 'black',
        interpolation: 'lanczos',
      };
    } else if (pixelsNode?.class_type === 'LoadImage') {
      const fitId = nextPromptNodeId(graph);
      graph[fitId] = {
        class_type: 'ResizeAndPadImage',
        inputs: { image: [pixelsId, 0], target_width: width, target_height: height, padding_color: 'black', interpolation: 'lanczos' },
      };
      latentSource.inputs.pixels = [fitId, 0];
    }
  }
  if (Object.hasOwn(sampler.inputs, 'denoise')) sampler.inputs.denoise = denoise;
}

export function prepareComfyUiCustomPrompt(value, {
  seed,
  prompt = '',
  negativePrompt = '',
  positivePrefix = 'masterpiece, best quality, amazing quality',
  checkpoint = '',
  referenceImage = '',
  referenceDenoise = 0.72,
  ratio = '3:4',
  resolution = '1K',
  upscaleModel = DEFAULT_ILLUSTRIOUS_UPSCALE_MODEL,
  steps,
  cfg,
  sampler: samplerName,
  scheduler,
  denoise,
  characterLora = '',
  characterLoraStrength = 0.8,
  highResRefine = false,
  refineDenoise = 0.25,
  filenamePrefix = 'AI_Canvas_ILXL',
} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const graph = JSON.parse(JSON.stringify(value));
  Object.values(graph).forEach((node) => {
    if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') return;
    if (checkpoint && ['CheckpointLoaderSimple', 'CheckpointLoader'].includes(String(node.class_type || '')) && Object.hasOwn(node.inputs, 'ckpt_name')) {
      node.inputs.ckpt_name = checkpoint;
    }
    if (Number.isInteger(Number(seed))) {
      if (Object.hasOwn(node.inputs, 'seed')) node.inputs.seed = Number(seed);
      if (Object.hasOwn(node.inputs, 'noise_seed')) node.inputs.noise_seed = Number(seed);
    }
    if (referenceImage && node.class_type === 'LoadImage' && Object.hasOwn(node.inputs, 'image')) node.inputs.image = referenceImage;
    if (node.class_type === 'SaveImage' && Object.hasOwn(node.inputs, 'filename_prefix')) node.inputs.filename_prefix = filenamePrefix;
  });
  applySamplingDimensions(graph, ratio);
  const samplerEntry = primarySamplerEntry(graph);
  if (referenceImage && !samplerEntry) throw new Error('已连接参考图，但当前专家工作流缺少标准 KSampler 节点');
  if (samplerEntry) {
    const samplerNode = samplerEntry[1];
    if (Number.isFinite(Number(steps)) && Object.hasOwn(samplerNode.inputs, 'steps')) samplerNode.inputs.steps = Math.max(1, Math.min(100, Math.round(Number(steps))));
    if (Number.isFinite(Number(cfg)) && Object.hasOwn(samplerNode.inputs, 'cfg')) samplerNode.inputs.cfg = Math.max(1, Math.min(30, Number(cfg)));
    if (String(samplerName || '').trim() && Object.hasOwn(samplerNode.inputs, 'sampler_name')) samplerNode.inputs.sampler_name = String(samplerName).trim();
    if (String(scheduler || '').trim() && Object.hasOwn(samplerNode.inputs, 'scheduler')) samplerNode.inputs.scheduler = String(scheduler).trim();
    if (!referenceImage && Number.isFinite(Number(denoise)) && Object.hasOwn(samplerNode.inputs, 'denoise')) samplerNode.inputs.denoise = Math.max(0.05, Math.min(1, Number(denoise)));
    applyCanvasPrompt(graph, samplerNode, prompt, positivePrefix, Boolean(referenceImage), negativePrompt);
    if (referenceImage) applyReferenceImage(graph, samplerNode, referenceImage, ratio, referenceDenoise, highResRefine && normalizedLocalResolution(resolution) !== '1K');
    applyModelOnlyLora(graph, samplerNode, characterLora, characterLoraStrength);
  }
  return applyOutputResolution(graph, ratio, resolution, upscaleModel, { highResRefine, refineDenoise });
}

function historyError(entry) {
  const messages = Array.isArray(entry?.status?.messages) ? entry.status.messages : [];
  const failure = messages.find((message) => Array.isArray(message) && ['execution_error', 'execution_interrupted'].includes(message[0]));
  if (!failure) return '';
  const detail = failure[1] || {};
  return String(detail.exception_message || detail.message || failure[0]);
}

export function comfyUiIllustriousHistoryImage(entry) {
  for (const output of Object.values(entry?.outputs || {})) {
    const file = Array.isArray(output?.images) ? output.images[0] : null;
    if (file?.filename) return { filename: String(file.filename), subfolder: String(file.subfolder || ''), type: String(file.type || 'output') };
  }
  return null;
}

function viewUrl(baseUrl, file) {
  const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
  return `${baseUrl}/view?${query}`;
}

export async function readComfyUiOutputFile(outputDirectory, file, maximumBytes = 64 * 1024 * 1024) {
  if (!outputDirectory || !path.isAbsolute(String(outputDirectory)) || file?.type !== 'output') return null;
  const root = path.resolve(String(outputDirectory));
  const filename = String(file?.filename || '');
  const subfolder = String(file?.subfolder || '').replace(/[\\/]+/g, path.sep);
  if (!filename || path.basename(filename) !== filename || path.isAbsolute(subfolder)) throw new Error('ComfyUI 输出文件路径无效');
  const target = path.resolve(root, subfolder, filename);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('ComfyUI 输出文件越过配置目录');
  const stat = await fs.promises.stat(target);
  if (!stat.isFile() || stat.size <= 0) throw new Error('ComfyUI 返回了空图片');
  if (stat.size > maximumBytes) throw new Error('ComfyUI 输出图片超过 64MB 安全限制');
  return fs.promises.readFile(target);
}

async function readComfyUiImage(fetchImpl, baseUrl, outputDirectory, file, signal, timeoutMs = 15000) {
  if (outputDirectory) {
    try {
      const local = await readComfyUiOutputFile(outputDirectory, file);
      if (local) return local;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('ComfyUI 图片读取超时')), Math.max(1000, Number(timeoutMs) || 15000));
  try {
    const response = await fetchImpl(viewUrl(baseUrl, file), { signal: controller.signal });
    if (!response.ok) throw new Error(`ComfyUI 图片读取失败：HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('ComfyUI 返回了空图片');
    return buffer;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error('ComfyUI 图片读取超时；本地文件兜底也不可用');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function inspectComfyUiIllustrious(config = {}, fetchImpl = fetch, { workflowId = '', loras = [], resolution = '1K', poseEstimator = 'sdpose' } = {}) {
  const baseUrl = comfyUiIllustriousBaseUrl(config.baseUrl);
  try {
    const status = await fetchImpl(`${baseUrl}/system_stats`);
    if (!status.ok) return { available: false, baseUrl, error: `ComfyUI 状态检查失败：HTTP ${status.status}` };
    const response = await fetchImpl(`${baseUrl}/object_info/CheckpointLoaderSimple`);
    const payload = await response.json().catch(() => ({}));
    const checkpoints = payload?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
    const checkpoint = String(config.model || DEFAULT_CHECKPOINT).trim();
    if (!response.ok || !Array.isArray(checkpoints)) return { available: false, baseUrl, error: '当前 ComfyUI 缺少标准 CheckpointLoaderSimple 节点' };
    if (!checkpoints.includes(checkpoint)) return { available: false, baseUrl, error: `ComfyUI 未找到模型：${checkpoint}` };
    const targetResolution = normalizedLocalResolution(resolution);
    const upscaleModel = safeUpscaleModelName(config.upscaleModel);
    if (targetResolution !== '1K') {
      if (!upscaleModel) return { available: false, baseUrl, error: `${targetResolution} 输出尚未配置本地超分模型` };
      const [loaderResponse, upscaleResponse, scaleResponse] = await Promise.all([
        fetchImpl(`${baseUrl}/object_info/UpscaleModelLoader`),
        fetchImpl(`${baseUrl}/object_info/ImageUpscaleWithModel`),
        fetchImpl(`${baseUrl}/object_info/ImageScale`),
      ]);
      const loaderInfo = await loaderResponse.json().catch(() => ({}));
      const upscaleInfo = await upscaleResponse.json().catch(() => ({}));
      const scaleInfo = await scaleResponse.json().catch(() => ({}));
      const modelInput = loaderInfo?.UpscaleModelLoader?.input?.required?.model_name;
      const upscaleModels = Array.isArray(modelInput?.[0]) ? modelInput[0] : Array.isArray(modelInput?.[1]?.options) ? modelInput[1].options : [];
      if (!loaderResponse.ok || !loaderInfo?.UpscaleModelLoader || !upscaleResponse.ok || !upscaleInfo?.ImageUpscaleWithModel || !scaleResponse.ok || !scaleInfo?.ImageScale) {
        return { available: false, baseUrl, error: '当前 ComfyUI 缺少 2K/4K 所需的标准超分节点' };
      }
      if (!upscaleModels.includes(upscaleModel)) return { available: false, baseUrl, error: `ComfyUI 未找到超分模型：${upscaleModel}` };
    }
    const preciseIdentity = comfyUiPreciseIdentityWorkflow(workflowId);
    if (preciseIdentity) {
      const infoResponse = await fetchImpl(`${baseUrl}/object_info`);
      const info = await infoResponse.json().catch(() => ({}));
      const requiredNodes = preciseIdentity.method === 'instantid'
        ? ['InstantIDModelLoader', 'InstantIDFaceAnalysis', 'ControlNetLoader', 'ApplyInstantIDAdvanced']
        : ['PulidModelLoader', 'PulidEvaClipLoader', 'PulidInsightFaceLoader', 'ApplyPulidAdvanced'];
      if (preciseIdentity.faceDetailer) requiredNodes.push('UltralyticsDetectorProvider', 'FaceDetailer');
      const missingNodes = requiredNodes.filter((node) => !info?.[node]);
      if (!infoResponse.ok || missingNodes.length) return { available: false, baseUrl, error: `精准身份工作流缺少 ComfyUI 节点：${missingNodes.join('、') || '节点目录读取失败'}` };
      const optionValues = (node, input) => info?.[node]?.input?.required?.[input]?.[0] || [];
      const missingModels = preciseIdentity.method === 'instantid' ? [
        !optionValues('InstantIDModelLoader', 'instantid_file').includes(COMFYUI_IDENTITY_MODELS.instantId) ? COMFYUI_IDENTITY_MODELS.instantId : '',
        !optionValues('ControlNetLoader', 'control_net_name').includes(COMFYUI_IDENTITY_MODELS.instantIdControlNet) ? COMFYUI_IDENTITY_MODELS.instantIdControlNet : '',
      ] : [
        !optionValues('PulidModelLoader', 'pulid_file').includes(COMFYUI_IDENTITY_MODELS.pulid) ? COMFYUI_IDENTITY_MODELS.pulid : '',
      ];
      if (preciseIdentity.faceDetailer && !optionValues('UltralyticsDetectorProvider', 'model_name').includes(COMFYUI_IDENTITY_MODELS.faceDetector)) {
        missingModels.push(COMFYUI_IDENTITY_MODELS.faceDetector);
      }
      const filteredMissing = missingModels.filter(Boolean);
      if (filteredMissing.length) return { available: false, baseUrl, error: `精准身份工作流缺少加载器识别的本地权重：${filteredMissing.join('、')}` };
    }
    const isIllustriousCharacterFinal = workflowId === ILLUSTRIOUS_CHARACTER_FINAL_WORKFLOW_ID;
    const isIdentityControl = isIllustriousCharacterFinal || workflowId === SDXL_CHARACTER_CONSISTENCY_WORKFLOW_ID;
    const isSdxlPose = workflowId === SDXL_POSE_WORKFLOW_ID;
    if (isIdentityControl || isSdxlPose) {
      const infoResponse = await fetchImpl(`${baseUrl}/object_info`);
      const info = await infoResponse.json().catch(() => ({}));
      const poseNodes = poseEstimator === 'dwpose'
        ? ['DWPreprocessor']
        : ['ImageScaleToMaxDimension', 'SDPoseKeypointExtractor', 'SDPoseDrawKeypoints'];
      const genericSdxl = config.genericSdxl === true || workflowId === SDXL_CHARACTER_CONSISTENCY_WORKFLOW_ID;
      const requiredNodes = isIdentityControl
        ? ['ControlNetLoader', 'ControlNetApplyAdvanced', 'IPAdapterModelLoader', 'CLIPVisionLoader', 'IPAdapterAdvanced', ...poseNodes, 'ResizeAndPadImage', ...(loras.length ? [genericSdxl ? 'LoraLoaderModelOnly' : 'LoraLoader'] : [])]
        : ['ControlNetLoader', 'ControlNetApplyAdvanced', ...poseNodes, 'ResizeAndPadImage', ...(loras.length ? ['LoraLoaderModelOnly'] : [])];
      const missingNodes = requiredNodes.filter((node) => !info?.[node]);
      const workflowLabel = isIdentityControl ? '角色一致性' : 'SDXL 姿势控制';
      if (!infoResponse.ok || missingNodes.length) return { available: false, baseUrl, error: `${workflowLabel}缺少 ComfyUI 节点：${missingNodes.join('、') || '节点目录读取失败'}` };
      const availableControlNets = info.ControlNetLoader?.input?.required?.control_net_name?.[0] || [];
      const availableIpAdapters = info.IPAdapterModelLoader?.input?.required?.ipadapter_file?.[0] || [];
      const availableClipVision = info.CLIPVisionLoader?.input?.required?.clip_name?.[0] || [];
      const availableLoras = (isIdentityControl && !genericSdxl ? info.LoraLoader : info.LoraLoaderModelOnly)?.input?.required?.lora_name?.[0] || [];
      const missingModels = [
        !availableControlNets.includes(ILLUSTRIOUS_CONTROL_MODELS.openPose) ? ILLUSTRIOUS_CONTROL_MODELS.openPose : '',
        isIllustriousCharacterFinal && !availableControlNets.includes(ILLUSTRIOUS_CONTROL_MODELS.lineart) ? ILLUSTRIOUS_CONTROL_MODELS.lineart : '',
        isIdentityControl && !availableIpAdapters.includes(ILLUSTRIOUS_CONTROL_MODELS.ipAdapter) ? ILLUSTRIOUS_CONTROL_MODELS.ipAdapter : '',
        isIdentityControl && !availableClipVision.includes(ILLUSTRIOUS_CONTROL_MODELS.clipVision) ? ILLUSTRIOUS_CONTROL_MODELS.clipVision : '',
        poseEstimator === 'dwpose' || checkpoints.includes(SDPOSE_CHECKPOINT) ? '' : SDPOSE_CHECKPOINT,
        ...loras.map(safeLoraName).filter((name) => name && !availableLoras.includes(name)),
      ].filter(Boolean);
      if (missingModels.length) return { available: false, baseUrl, error: `${workflowLabel}缺少本地模型：${missingModels.join('、')}` };
    } else if (loras.length) {
      const loraResponse = await fetchImpl(`${baseUrl}/object_info/LoraLoaderModelOnly`);
      const loraInfo = await loraResponse.json().catch(() => ({}));
      const availableLoras = loraInfo?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0];
      if (!loraResponse.ok || !Array.isArray(availableLoras)) return { available: false, baseUrl, error: '当前 ComfyUI 缺少 LoraLoaderModelOnly 节点' };
      const missingLoras = loras.map(safeLoraName).filter((name) => name && !availableLoras.includes(name));
      if (missingLoras.length) return { available: false, baseUrl, error: `ComfyUI 未找到 LoRA：${missingLoras.join('、')}` };
    }
    return { available: true, baseUrl, checkpoint, ...(targetResolution === '1K' ? {} : { upscaleModel }), error: '' };
  } catch {
    return { available: false, baseUrl, error: 'ComfyUI 未启动或本地端口不可访问' };
  }
}

async function uploadReference(fetchImpl, baseUrl, reference, signal, { fileName: requestedFileName = '', overwrite = false } = {}) {
  const extension = /\.[a-z0-9]{1,8}$/i.exec(reference.fileName || '')?.[0]
    || ({ 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png' })[reference.mimeType]
    || '.png';
  const fileName = requestedFileName && path.basename(requestedFileName) === requestedFileName
    ? requestedFileName
    : `ai-canvas-ilxl-${crypto.randomUUID()}${extension}`;
  const form = new FormData();
  form.append('image', new Blob([reference.buffer], { type: reference.mimeType || 'image/png' }), fileName);
  form.append('type', 'input');
  form.append('overwrite', overwrite ? 'true' : 'false');
  const response = await fetchImpl(`${baseUrl}/upload/image`, { method: 'POST', body: form, signal });
  const payload = await responseJson(response, 'ComfyUI 参考图上传失败');
  return String(payload.name || fileName);
}

async function cachedInputReference(inputDirectory, fileName, byteLength) {
  if (!inputDirectory || !path.isAbsolute(String(inputDirectory))) return false;
  const root = path.resolve(String(inputDirectory));
  const target = path.resolve(root, fileName);
  if (path.dirname(target) !== root) return false;
  const stat = await fs.promises.stat(target).catch(() => null);
  return Boolean(stat?.isFile() && stat.size === byteLength);
}

async function pruneIdentityReferenceCache(inputDirectory, keepName, limit = 16) {
  if (!inputDirectory || !path.isAbsolute(String(inputDirectory))) return;
  const root = path.resolve(String(inputDirectory));
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  const cached = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.startsWith('ai-canvas-identity-')).map(async (entry) => ({
    name: entry.name,
    mtimeMs: await fs.promises.stat(path.join(root, entry.name)).then((stat) => stat.mtimeMs).catch(() => 0),
  })));
  cached.sort((left, right) => Number(right.name === keepName) - Number(left.name === keepName) || right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
  await Promise.all(cached.slice(Math.max(1, Math.min(64, Number(limit) || 16))).map(async (entry) => {
    const target = path.resolve(root, entry.name);
    if (path.dirname(target) !== root) return;
    try { await fs.promises.unlink(target); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }));
}

const poseMapMemoryCache = new Map();

function poseMapCacheFile(inputDirectory, key) {
  if (!inputDirectory || !path.isAbsolute(String(inputDirectory))) return '';
  const root = path.resolve(String(inputDirectory));
  return path.join(root, `ai-canvas-pose-map-${key}.png`);
}

function rememberPoseMap(key, buffer) {
  poseMapMemoryCache.delete(key);
  poseMapMemoryCache.set(key, buffer);
  while (poseMapMemoryCache.size > 16) poseMapMemoryCache.delete(poseMapMemoryCache.keys().next().value);
}

async function waitForPosePreview(fetchImpl, baseUrl, promptId, outputDirectory, signal, timeoutMs) {
  const deadline = Date.now() + Math.max(30000, Math.min(5 * 60 * 1000, Number(timeoutMs) || 3 * 60 * 1000));
  while (Date.now() < deadline) {
    if (signal?.aborted) throw abortError();
    const response = await fetchImpl(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { signal });
    const payload = await responseJson(response, 'ComfyUI 骨架预览查询失败');
    const entry = payload?.[promptId];
    if (entry) {
      const failure = historyError(entry);
      if (failure) throw new Error(`ComfyUI 骨架预览失败：${failure}`);
      const file = comfyUiIllustriousHistoryImage(entry);
      if (file) return readComfyUiImage(fetchImpl, baseUrl, outputDirectory, file, signal);
    }
    await sleep(500, signal);
  }
  throw new Error('ComfyUI 骨架预览生成超时');
}

export async function ensureComfyUiPoseMap({ config = {}, fetchImpl = fetch, reference, poseEstimator = 'sdpose', ratio = '3:4', signal } = {}) {
  if (!reference?.buffer?.length) throw new Error('骨架预览缺少姿势参考图');
  const estimator = poseEstimator === 'dwpose' ? 'dwpose' : 'sdpose';
  const key = comfyUiPoseCacheKey(reference.buffer, estimator, ratio, reference.cacheKey);
  const cacheFile = poseMapCacheFile(config.inputDirectory, key);
  if (cacheFile) {
    try {
      const buffer = await fs.promises.readFile(cacheFile);
      if (buffer.length) { rememberPoseMap(key, buffer); return { key, buffer, cached: true, fileName: path.basename(cacheFile) }; }
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  const memory = poseMapMemoryCache.get(key);
  if (memory?.length) return { key, buffer: memory, cached: true, fileName: `ai-canvas-pose-map-${key}.png` };

  const baseUrl = comfyUiIllustriousBaseUrl(config.baseUrl);
  const extension = /\.[a-z0-9]{1,8}$/i.exec(reference.fileName || '')?.[0]
    || ({ 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png' })[reference.mimeType]
    || '.png';
  const sourceKey = reference.cacheKey
    ? compactReferenceCacheToken(`${reference.cacheKey}|pose-source`)
    : crypto.createHash('sha256').update(reference.buffer).digest('hex');
  const sourceName = `ai-canvas-pose-source-${sourceKey}${extension}`;
  const uploadedName = await uploadReference(fetchImpl, baseUrl, reference, signal, { fileName: sourceName, overwrite: true });
  const graph = buildComfyUiPosePreviewPrompt({
    referenceImage: uploadedName,
    poseEstimator: estimator,
    ratio,
    filenamePrefix: `AI_Canvas_Pose/cache-${key}`,
  });
  const submitted = await fetchImpl(`${baseUrl}/prompt`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: `ai-canvas-pose-${crypto.randomUUID()}` }),
  });
  const submission = await responseJson(submitted, 'ComfyUI 骨架预览提交失败');
  const promptId = String(submission.prompt_id || '').trim();
  if (!promptId) throw new Error('ComfyUI 未返回骨架预览任务 ID');
  const buffer = await waitForPosePreview(fetchImpl, baseUrl, promptId, config.outputDirectory, signal, config.posePreviewTimeoutMs);
  if (cacheFile) {
    await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
    try { await fs.promises.writeFile(cacheFile, buffer, { flag: 'wx' }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  rememberPoseMap(key, buffer);
  return { key, buffer, cached: false, fileName: `ai-canvas-pose-map-${key}.png`, promptId };
}

async function cleanupReference(inputDirectory, name) {
  if (!name || !inputDirectory || !path.isAbsolute(String(inputDirectory))) return;
  const root = path.resolve(String(inputDirectory));
  const safeName = path.basename(String(name));
  if (!safeName.startsWith('ai-canvas-ilxl-')) return;
  const target = path.resolve(root, safeName);
  if (path.dirname(target) !== root) return;
  try { await fs.promises.unlink(target); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function cancelPrompt(fetchImpl, baseUrl, promptId) {
  try {
    const queue = await fetchImpl(`${baseUrl}/queue`).then((response) => response.json());
    const running = Array.isArray(queue?.queue_running) && queue.queue_running.some((item) => Array.isArray(item) && item[1] === promptId);
    await fetchImpl(`${baseUrl}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) });
    if (running) await fetchImpl(`${baseUrl}/interrupt`, { method: 'POST' });
  } catch { /* Local cancellation is best-effort. */ }
}

function queueState(payload, promptId, estimatedRunSeconds) {
  const running = Array.isArray(payload?.queue_running) ? payload.queue_running : [];
  const pending = Array.isArray(payload?.queue_pending) ? payload.queue_pending : [];
  const runningIndex = running.findIndex((item) => Array.isArray(item) && item[1] === promptId);
  const pendingIndex = pending.findIndex((item) => Array.isArray(item) && item[1] === promptId);
  const ahead = runningIndex >= 0 ? 0 : pendingIndex >= 0 ? running.length + pendingIndex : 0;
  return {
    state: runningIndex >= 0 ? 'running' : pendingIndex >= 0 ? 'queued' : 'submitting',
    running: running.length,
    queued: pending.length,
    ahead,
    position: pendingIndex >= 0 ? pendingIndex + 1 : 0,
    estimatedWaitSeconds: ahead * estimatedRunSeconds,
    estimatedRunSeconds,
  };
}

export function decodeComfyUiPreviewFrame(value) {
  let bytes;
  if (Buffer.isBuffer(value)) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = Buffer.from(value);
  else if (ArrayBuffer.isView(value)) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  else return null;
  if (bytes.length < 8) return null;
  const eventType = bytes.readUInt32BE(0);
  if (eventType === 1) {
    const imageType = bytes.readUInt32BE(4);
    const buffer = bytes.subarray(8);
    if (!buffer.length) return null;
    return { buffer, contentType: imageType === 2 ? 'image/png' : 'image/jpeg', metadata: {} };
  }
  if (eventType === 4) {
    const metadataLength = bytes.readUInt32BE(4);
    const metadataEnd = 8 + metadataLength;
    if (metadataLength < 0 || metadataEnd > bytes.length) return null;
    let metadata = {};
    try { metadata = JSON.parse(bytes.subarray(8, metadataEnd).toString('utf8')); }
    catch { metadata = {}; }
    const buffer = bytes.subarray(metadataEnd);
    if (!buffer.length) return null;
    return { buffer, contentType: metadata.image_type === 'image/png' ? 'image/png' : 'image/jpeg', metadata };
  }
  return null;
}

function comfyUiWebSocketUrl(baseUrl, clientId) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = new URLSearchParams({ clientId }).toString();
  return url.toString();
}

async function openComfyUiPreviewSocket(baseUrl, clientId, callbacks, WebSocketImpl) {
  if (typeof WebSocketImpl !== 'function') return null;
  let socket;
  try { socket = new WebSocketImpl(comfyUiWebSocketUrl(baseUrl, clientId)); }
  catch { return null; }
  socket.binaryType = 'arraybuffer';
  const emit = (handler, payload) => {
    if (typeof handler !== 'function') return;
    void Promise.resolve(handler(payload)).catch(() => undefined);
  };
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data);
        if (message?.type === 'progress') emit(callbacks.onProgress, message.data || {});
      } catch { /* Ignore unrelated ComfyUI socket messages. */ }
      return;
    }
    if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
      void event.data.arrayBuffer().then((buffer) => {
        const preview = decodeComfyUiPreviewFrame(buffer);
        if (preview) emit(callbacks.onPreview, preview);
      }).catch(() => undefined);
      return;
    }
    const preview = decodeComfyUiPreviewFrame(event.data);
    if (preview) emit(callbacks.onPreview, preview);
  });
  const opened = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), 3000);
    socket.addEventListener('open', () => finish(true), { once: true });
    socket.addEventListener('error', () => finish(false), { once: true });
  });
  if (!opened) {
    try { socket.close(); } catch { /* best effort */ }
    return null;
  }
  return { close: () => { try { socket.close(); } catch { /* best effort */ } } };
}

export function createComfyUiIllustriousAdapter(model, fetchImpl = fetch, runtime = {}) {
  const config = model.config || {};
  const baseUrl = comfyUiIllustriousBaseUrl(config.baseUrl);
  const checkpoint = String(config.model || DEFAULT_CHECKPOINT).trim();
  const genericSdxl = model.adapter === 'comfyui-sdxl';
  const upscaleModel = safeUpscaleModelName(config.upscaleModel)
    || (genericSdxl ? DEFAULT_SDXL_UPSCALE_MODEL : DEFAULT_ILLUSTRIOUS_UPSCALE_MODEL);
  const configuredPreviewMethod = String(config.previewMethod || 'auto').trim().toLowerCase();
  const previewMethod = ['auto', 'latent2rgb', 'taesd'].includes(configuredPreviewMethod) ? configuredPreviewMethod : 'auto';
  const pollIntervalMs = Math.max(250, Number(config.pollIntervalMs) || 1000);
  const timeoutMs = Math.max(60000, Number(config.pollingTimeoutMs) || 10 * 60 * 1000);
  const WebSocketImpl = Object.prototype.hasOwnProperty.call(runtime, 'WebSocketImpl') ? runtime.WebSocketImpl : globalThis.WebSocket;
  const defaultWorkflowId = genericSdxl ? 'sdxl-image-v1' : 'illustrious-character-v1';
  const outputPrefix = genericSdxl ? 'AI_Canvas_SDXL' : 'AI_Canvas_ILXL';
  return {
    kind: 'image', configured: true,
    async run(job) {
      if (job.signal?.aborted) throw abortError();
      const recoveryPromptId = job.recoveryReason === 'comfyui_history'
        ? String(job.remoteTaskId || job.comfyPromptId || '').trim()
        : '';
      if (recoveryPromptId) {
        const history = await fetchImpl(`${baseUrl}/history/${encodeURIComponent(recoveryPromptId)}`, { signal: job.signal });
        const payload = await responseJson(history, 'ComfyUI 历史恢复失败');
        const entry = payload?.[recoveryPromptId];
        const failure = historyError(entry);
        if (failure) throw new Error(`ComfyUI 已完成任务恢复失败：${failure}`);
        const file = comfyUiIllustriousHistoryImage(entry);
        if (!file) throw new Error('ComfyUI 已完成任务没有可恢复的图片');
        const buffer = await readComfyUiImage(fetchImpl, baseUrl, config.outputDirectory, file, job.signal, config.fileReadTimeoutMs);
        const resolution = normalizedLocalResolution(job.resolution);
        const { width, height } = illustriousOutputDimensions(job.ratio, resolution);
        return [{
          mediaType: 'image', buffer, extension: '.png', fileName: file.filename,
          metadata: { provider: 'comfyui', local: true, recovered: true, promptId: recoveryPromptId, checkpoint, width, height, resolution, ...(resolution === '1K' ? {} : { upscaleModel }), workflowId: String(job.workflowId || defaultWorkflowId) },
        }];
      }
      const references = Array.isArray(job.referenceImages) ? job.referenceImages : [];
      const workflowId = String(job.workflowId || job.comfyUiWorkflow?.workflowId || '');
      const preciseIdentity = comfyUiPreciseIdentityWorkflow(workflowId);
      const highResRefine = workflowId === SDXL_HIGHRES_REFINE_WORKFLOW_ID || workflowId === ILLUSTRIOUS_HIGHRES_REFINE_WORKFLOW_ID;
      const refineDenoise = boundedRefineDenoise(job.options?.highResRefineDenoise ?? job.comfyUiWorkflow?.qualityProfile?.refineDenoise);
      const isIdentityControl = workflowId === ILLUSTRIOUS_CHARACTER_FINAL_WORKFLOW_ID || workflowId === SDXL_CHARACTER_CONSISTENCY_WORKFLOW_ID || Boolean(preciseIdentity);
      const isSdxlPose = workflowId === SDXL_POSE_WORKFLOW_ID;
      const isManagedControl = isIdentityControl || isSdxlPose;
      if (!isManagedControl && references.length > 1) throw new Error('本地 SDXL 基础工作流当前一次只支持 1 张参考图；请保留主参考图后重试');
      if (isSdxlPose && references.some((reference) => String(reference.port || '') !== 'pose')) throw new Error('SDXL 姿势控制图片必须连接到动作姿势端口');
      const loras = (genericSdxl
        ? [job.options?.characterLora]
        : [job.options?.characterLora, job.options?.styleLora, job.options?.objectLora]).filter(Boolean);
      const resolution = normalizedLocalResolution(job.resolution);
      const poseEstimator = job.options?.poseEstimator === 'dwpose' ? 'dwpose' : 'sdpose';
      const readiness = await inspectComfyUiIllustrious({ ...config, upscaleModel, genericSdxl }, fetchImpl, { workflowId, loras, resolution, poseEstimator });
      if (!readiness.available) throw new Error(readiness.error);
      const count = Math.max(1, Math.min(4, Number(job.count) || 1));
      const uploadedReferences = {};
      const persistentUploadedNames = new Set();
      let identityReferenceKey = '';
      let identityReferenceCached = false;
      const poseReference = isManagedControl ? references.find((reference) => String(reference.port || '') === 'pose') : null;
      const poseMap = poseReference ? await ensureComfyUiPoseMap({ config, fetchImpl, reference: poseReference, poseEstimator, ratio: job.ratio, signal: job.signal }) : null;
      for (const reference of references) {
        const port = isManagedControl ? String(reference.port || '') : 'input';
        if (uploadedReferences[port]) throw new Error(`控制端口 ${port} 只能连接 1 张图`);
        if (port === 'pose' && poseMap) {
          const stableName = `ai-canvas-pose-map-${poseMap.key}.png`;
          uploadedReferences[port] = await uploadReference(fetchImpl, baseUrl, { buffer: poseMap.buffer, mimeType: 'image/png', fileName: stableName }, job.signal, { fileName: stableName, overwrite: true });
          persistentUploadedNames.add(uploadedReferences[port]);
        } else if (port === 'identity') {
          const stableName = comfyUiIdentityCacheName(reference.buffer, reference.fileName, reference.mimeType, reference.cacheKey);
          identityReferenceCached = await cachedInputReference(config.inputDirectory, stableName, reference.buffer.length);
          uploadedReferences[port] = identityReferenceCached
            ? stableName
            : await uploadReference(fetchImpl, baseUrl, reference, job.signal, { fileName: stableName, overwrite: true });
          persistentUploadedNames.add(uploadedReferences[port]);
          identityReferenceKey = stableName.replace(/^ai-canvas-identity-/, '').replace(/\.[a-z0-9]{1,8}$/i, '');
          await pruneIdentityReferenceCache(config.inputDirectory, stableName);
        } else {
          uploadedReferences[port] = await uploadReference(fetchImpl, baseUrl, reference, job.signal);
        }
      }
      const uploadedName = uploadedReferences.input || '';
      const outputs = [];
      const negativePrompt = String(job.options?.negativePrompt || config.negativePrompt || DEFAULT_NEGATIVE_PROMPT).trim();
      const samplingSteps = Math.max(1, Math.min(100, Number(job.options?.comfySteps ?? config.steps) || 28));
      const samplingCfg = Math.max(1, Math.min(30, Number(job.options?.comfyCfg ?? config.cfg) || 5.5));
      const samplingSampler = String(job.options?.comfySampler || config.sampler || 'dpmpp_2m_sde').trim();
      const samplingScheduler = String(job.options?.comfyScheduler || config.scheduler || 'karras').trim();
      try {
        for (let index = 0; index < count; index += 1) {
          if (job.signal?.aborted) throw abortError();
          const seed = Number.isInteger(Number(job.options?.seed))
            ? Number(job.options.seed) + index
            : crypto.randomInt(0, 4294967296);
          const graph = isManagedControl ? buildComfyUiCharacterFinalPrompt({
            prompt: job.prompt,
            negativePrompt,
            positivePrefix: config.positivePrefix,
            checkpoint,
            ratio: job.ratio,
            resolution,
            upscaleModel,
            seed,
            steps: samplingSteps,
            cfg: samplingCfg,
            sampler: samplingSampler,
            scheduler: samplingScheduler,
            denoise: Math.max(0.05, Math.min(1, Number(job.options?.comfyDenoise) || 1)),
            references: uploadedReferences,
            identityStrength: references.find((reference) => reference.port === 'identity')?.strength ?? job.options?.identityStrength,
            identityMethod: preciseIdentity?.method || 'ipadapter',
            faceDetailer: Boolean(preciseIdentity?.faceDetailer),
            proportionStrength: references.find((reference) => reference.port === 'proportion')?.strength ?? job.options?.proportionStrength,
            poseStrength: poseReference?.strength ?? job.options?.poseStrength,
            poseEstimator,
            preprocessedPose: Boolean(poseMap),
            lineartStrength: references.find((reference) => reference.port === 'lineart')?.strength ?? job.options?.lineartStrength,
            characterLora: job.options?.characterLora,
            characterLoraStrength: job.options?.characterLoraStrength,
            characterLoraMode: genericSdxl ? 'model-only' : 'model-clip',
            styleLora: genericSdxl ? '' : job.options?.styleLora,
            objectLora: genericSdxl ? '' : job.options?.objectLora,
            highResRefine,
            refineDenoise,
            filenamePrefix: `${outputPrefix}/${String(job.id || 'node').replace(/[^a-zA-Z0-9_-]/g, '_')}-${index + 1}`,
          }) : prepareComfyUiCustomPrompt(job.comfyUiWorkflow?.prompt, {
            seed,
            prompt: job.prompt,
            negativePrompt,
            positivePrefix: config.positivePrefix,
            checkpoint,
            referenceImage: uploadedName,
            referenceDenoise: job.options?.referenceDenoise ?? config.referenceDenoise,
            ratio: job.ratio,
            resolution,
            upscaleModel,
            steps: samplingSteps,
            cfg: samplingCfg,
            sampler: samplingSampler,
            scheduler: samplingScheduler,
            denoise: Math.max(0.05, Math.min(1, Number(job.options?.comfyDenoise) || 1)),
            characterLora: job.options?.characterLora,
            characterLoraStrength: job.options?.characterLoraStrength,
            highResRefine,
            refineDenoise,
            filenamePrefix: `${outputPrefix}/${String(job.id || 'node').replace(/[^a-zA-Z0-9_-]/g, '_')}-${index + 1}`,
          }) || buildComfyUiIllustriousPrompt({
            prompt: job.prompt,
            negativePrompt,
            positivePrefix: config.positivePrefix,
            checkpoint,
            ratio: job.ratio,
            resolution,
            upscaleModel,
            seed,
            steps: samplingSteps,
            cfg: samplingCfg,
            sampler: samplingSampler,
            scheduler: samplingScheduler,
            referenceImage: uploadedName,
            denoise: uploadedName
              ? Math.min(1, Math.max(0.05, Number(job.options?.referenceDenoise ?? config.referenceDenoise) || 0.72))
              : Math.max(0.05, Math.min(1, Number(job.options?.comfyDenoise) || 1)),
            characterLora: job.options?.characterLora,
            characterLoraStrength: job.options?.characterLoraStrength,
            highResRefine,
            refineDenoise,
            filenamePrefix: `${outputPrefix}/${String(job.id || 'node').replace(/[^a-zA-Z0-9_-]/g, '_')}-${index + 1}`,
          });
          const clientId = `ai-canvas-ilxl-${crypto.randomUUID()}`;
          let promptId = '';
          const sampling = { step: 0, steps: samplingSteps, nodeId: '' };
          const publishSamplingState = (patch = {}) => {
            Object.assign(sampling, patch);
            const step = Math.max(0, Number(sampling.step) || 0);
            const steps = Math.max(1, Number(sampling.steps) || 1);
            const taskProgress = 15 + Math.round(((index + Math.min(1, step / steps)) / count) * 75);
            return job.onSamplingPreview?.({
              promptId,
              outputIndex: index,
              step,
              steps,
              nodeId: String(sampling.nodeId || ''),
              progress: taskProgress,
              ...patch,
            });
          };
          await publishSamplingState({ seed });
          const previewSocket = await openComfyUiPreviewSocket(baseUrl, clientId, {
            onProgress: (data) => {
              if (promptId && data.prompt_id && data.prompt_id !== promptId) return;
              return publishSamplingState({ step: data.value, steps: data.max, nodeId: data.node || sampling.nodeId });
            },
            onPreview: (preview) => publishSamplingState({ buffer: preview.buffer, contentType: preview.contentType }),
          }, WebSocketImpl);
          try {
          const submitted = await fetchImpl(`${baseUrl}/prompt`, {
            method: 'POST', signal: job.signal,
            headers: { 'Content-Type': 'application/json' },
            // ComfyUI defaults to preview_method=none. Set it per prompt so the
            // canvas receives real latent preview frames even when an already
            // running Desktop instance was launched without preview CLI flags.
            body: JSON.stringify({ prompt: graph, client_id: clientId, extra_data: { preview_method: previewMethod } }),
          });
            const submission = await responseJson(submitted, 'ComfyUI Illustrious 提交失败');
            promptId = String(submission.prompt_id || '').trim();
            if (!promptId) throw new Error('ComfyUI 未返回任务 ID');
            await job.onRemoteTask?.(promptId, { provider: 'comfyui', model: checkpoint, clientId });
            const deadline = Date.now() + timeoutMs;
            let missingFromQueuePolls = 0;
            while (Date.now() < deadline) {
              if (job.signal?.aborted) throw abortError();
              const history = await fetchImpl(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { signal: job.signal });
              const payload = await responseJson(history, 'ComfyUI Illustrious 历史查询失败');
              const entry = payload?.[promptId];
              if (entry) {
                const failure = historyError(entry);
                if (failure) throw new Error(`ComfyUI Illustrious 生成失败：${failure}`);
                const file = comfyUiIllustriousHistoryImage(entry);
                if (file) {
                  const buffer = await readComfyUiImage(fetchImpl, baseUrl, config.outputDirectory, file, job.signal, config.fileReadTimeoutMs);
                  const { width, height } = illustriousOutputDimensions(job.ratio, resolution);
                  outputs.push({
                    mediaType: 'image', buffer, extension: '.png', fileName: `${genericSdxl ? 'sdxl' : 'illustrious'}-${index + 1}.png`,
                     metadata: { provider: 'comfyui', local: true, promptId, checkpoint, seed, width, height, resolution, ...(resolution === '1K' ? {} : { upscaleModel }), steps: samplingSteps, cfg: samplingCfg, sampler: samplingSampler, scheduler: samplingScheduler, workflowId: workflowId || defaultWorkflowId, referenceImage: references.length > 0, referencePorts: references.map((item) => item.port), ...(identityReferenceKey ? { identityReferenceKey, identityReferenceCached } : {}), ...(poseMap ? { poseMapKey: poseMap.key, poseEstimator, poseMapCached: poseMap.cached } : {}), ...(job.comfyUiWorkflow?.revision ? { workflowRevision: job.comfyUiWorkflow.revision } : {}) },
                  });
                  await job.onProgress?.(15 + Math.round(((index + 1) / count) * 75));
                  break;
                }
              }
              const queueResponse = await fetchImpl(`${baseUrl}/queue`, { signal: job.signal });
              if (queueResponse.ok) {
                const queuePayload = await queueResponse.json();
                const state = queueState(queuePayload, promptId, Math.max(5, Number(config.estimatedRunSeconds) || 15));
                await job.onQueueState?.(state);
                const inQueue = ['queue_running', 'queue_pending'].some((key) => Array.isArray(queuePayload?.[key]) && queuePayload[key].some((item) => Array.isArray(item) && item[1] === promptId));
                missingFromQueuePolls = inQueue ? 0 : missingFromQueuePolls + 1;
                if (missingFromQueuePolls >= 3) throw new Error('ComfyUI 任务已从队列消失且没有生成结果，请直接重试');
              }
              await sleep(pollIntervalMs, job.signal);
            }
          } catch (error) {
            if (job.signal?.aborted) await cancelPrompt(fetchImpl, baseUrl, promptId);
            throw error;
          } finally {
            previewSocket?.close();
          }
          if (outputs.length !== index + 1) throw new Error('ComfyUI Illustrious 生成超时');
        }
        return outputs;
      } finally {
        await Promise.all(Object.values(uploadedReferences).filter((name) => !persistentUploadedNames.has(name)).map((name) => cleanupReference(config.inputDirectory, name)));
      }
    },
  };
}
