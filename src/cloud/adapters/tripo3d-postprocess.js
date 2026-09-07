import { createTripo3dClient, Tripo3dApiError, Tripo3dSubmissionUnknownError } from './tripo3d-client.js';

const OPERATIONS = Object.freeze({
  texture: Object.freeze({ endpoint: '/models/texture' }),
  segment: Object.freeze({ endpoint: '/mesh/segment' }),
  'smart-segment': Object.freeze({ endpoint: '/mesh/smartsegment' }),
  complete: Object.freeze({ endpoint: '/mesh/complete' }),
  retopology: Object.freeze({ endpoint: '/mesh/decimate' }),
  convert: Object.freeze({ endpoint: '/models/convert' }),
  'rig-check': Object.freeze({ endpoint: '/animations/rig-check' }),
  rig: Object.freeze({ endpoint: '/animations/rig' }),
  retarget: Object.freeze({ endpoint: '/animations/retarget' }),
});

const OPERATION_ALIASES = Object.freeze({
  texture: 'texture',
  segment: 'segment',
  segmentation: 'segment',
  'mesh-segment': 'segment',
  'smart-segment': 'smart-segment',
  smartsegment: 'smart-segment',
  'mesh-smartsegment': 'smart-segment',
  complete: 'complete',
  completion: 'complete',
  'mesh-complete': 'complete',
  retopology: 'retopology',
  decimate: 'retopology',
  convert: 'convert',
  conversion: 'convert',
  'rig-check': 'rig-check',
  rig_check: 'rig-check',
  rigcheck: 'rig-check',
  rig: 'rig',
  retarget: 'retarget',
  animation: 'retarget',
});

const RIG_TYPES = Object.freeze(['biped', 'quadruped', 'hexapod', 'octopod', 'avian', 'serpentine', 'aquatic']);
const OUTPUT_FORMATS = Object.freeze(['glb', 'fbx']);
const CONVERT_FORMATS = Object.freeze(['GLTF', 'FBX', 'USDZ', 'OBJ', 'STL', '3MF']);
const TEXTURE_FORMATS = Object.freeze(['JPEG', 'PNG', 'WEBP', 'BMP', 'DPX', 'HDR', 'OPEN_EXR', 'TARGA', 'TIFF']);
const SOURCE_ALIASES = Object.freeze({
  taskId: ['taskId', 'task_id', 'sourceTaskId', 'source_task_id'],
  fileToken: ['fileToken', 'file_token'],
  url: ['url', 'sourceUrl', 'source_url'],
});

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function option(value, camel, snake = camel) {
  if (own(value, camel)) return value[camel];
  if (snake !== camel && own(value, snake)) return value[snake];
  return undefined;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function nonEmptyString(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function optionalBoolean(value, label) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}

function optionalInteger(value, label, minimum, maximum) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function optionalNumber(value, label, { minimum = -Infinity, exclusiveMinimum = false } = {}) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)
      || (exclusiveMinimum ? value <= minimum : value < minimum)) {
    const comparison = exclusiveMinimum ? 'greater than' : 'at least';
    throw new Error(`${label} must be a finite number ${comparison} ${minimum}`);
  }
  return value;
}

function optionalEnum(value, allowed, label, { uppercase = false, lowercase = false } = {}) {
  if (value === undefined) return undefined;
  let normalized = nonEmptyString(value, label);
  if (uppercase) normalized = normalized.toUpperCase();
  if (lowercase) normalized = normalized.toLowerCase();
  if (!allowed.includes(normalized)) throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  return normalized;
}

function optionalStringArray(value, label, { minimum = 1, maximum = Infinity } = {}) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    const upper = Number.isFinite(maximum) ? ` to ${maximum}` : ' or more';
    throw new Error(`${label} must contain ${minimum}${upper} strings`);
  }
  return value.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
}

function sourceValue(options, aliases) {
  for (const alias of aliases) {
    if (own(options, alias) && String(options[alias] ?? '').trim()) return String(options[alias]).trim();
  }
  return '';
}

function normalizeSource(options, { taskOnly = false, taskOnlyLabel = 'operation', rigCheck = false } = {}) {
  const source = {
    taskId: sourceValue(options, SOURCE_ALIASES.taskId),
    fileToken: sourceValue(options, SOURCE_ALIASES.fileToken),
    url: sourceValue(options, SOURCE_ALIASES.url),
  };
  const selected = Object.entries(source).filter(([, value]) => value);
  if (selected.length !== 1) {
    throw new Error('Tripo3D source must provide exactly one of task_id, file_token, or url');
  }
  const [kind, value] = selected[0];
  if (taskOnly && kind !== 'taskId') {
    const taskDescription = taskOnlyLabel === 'animation retarget' ? 'a rigged task_id' : 'a task_id';
    throw new Error(`Tripo3D ${taskOnlyLabel} requires ${taskDescription} source`);
  }
  if (kind === 'taskId' && (value.length > 240 || /[\u0000-\u001f]/.test(value))) throw new Error(`Tripo3D ${taskOnlyLabel} task_id is invalid`);
  if (kind === 'url' && !/^https:\/\//i.test(value)) throw new Error('Tripo3D source url must use HTTPS');
  if (rigCheck && kind !== 'taskId') {
    const declaredFormat = String(option(options, 'sourceFormat', 'source_format') || '').trim().toLowerCase();
    if (declaredFormat && declaredFormat !== 'glb') throw new Error('Tripo3D rig-check only supports GLB input');
    if (kind === 'url') {
      const pathname = new URL(value).pathname.toLowerCase();
      if (!pathname.endsWith('.glb')) throw new Error('Tripo3D rig-check only supports GLB input');
    }
    if (kind === 'fileToken' && declaredFormat !== 'glb') throw new Error('Tripo3D rig-check requires source_format=glb for file_token input');
  }
  return Object.freeze({ kind, input: value });
}

function textureImageReference(value, label) {
  if (typeof value === 'string') return nonEmptyString(value, label);
  const object = requireObject(value, label);
  const fileToken = String(option(object, 'fileToken', 'file_token') || '').trim();
  const url = String(object.url || '').trim();
  if (Number(Boolean(fileToken)) + Number(Boolean(url)) !== 1) {
    throw new Error(`${label} must provide exactly one of file_token or url`);
  }
  if (url && !/^https:\/\//i.test(url)) throw new Error(`${label} url must use HTTPS`);
  return fileToken ? { file_token: fileToken } : { url };
}

function normalizeTexturePrompt(value) {
  if (value === undefined) return undefined;
  const prompt = requireObject(value, 'Tripo3D texture_prompt');
  const text = String(prompt.text ?? '').trim();
  const hasImage = own(prompt, 'image') && prompt.image !== undefined;
  const hasImages = own(prompt, 'images') && prompt.images !== undefined;
  const modes = Number(Boolean(text)) + Number(hasImage) + Number(hasImages);
  if (modes !== 1) throw new Error('Tripo3D texture_prompt must use exactly one of text, image, or images');
  const styleImage = option(prompt, 'styleImage', 'style_image');
  if (styleImage !== undefined && !text) throw new Error('Tripo3D texture_prompt style_image is only valid with text');
  if (text) {
    return {
      text,
      ...(styleImage === undefined ? {} : { style_image: textureImageReference(styleImage, 'Tripo3D style_image') }),
    };
  }
  if (hasImage) return { image: textureImageReference(prompt.image, 'Tripo3D texture_prompt image') };
  if (!Array.isArray(prompt.images) || prompt.images.length !== 4) {
    throw new Error('Tripo3D texture_prompt images must contain exactly 4 images in front-left-back-right order');
  }
  return { images: prompt.images.map((entry, index) => textureImageReference(entry, `Tripo3D texture_prompt images[${index}]`)) };
}

function buildTexture(options, input) {
  const model = optionalEnum(option(options, 'model'), ['v3.0-20250812', 'v2.5-20250123'], 'Tripo3D texture model') || 'v3.0-20250812';
  const texturePrompt = normalizeTexturePrompt(option(options, 'texturePrompt', 'texture_prompt'));
  const pbr = optionalBoolean(option(options, 'pbr'), 'Tripo3D texture pbr');
  const textureSeed = optionalInteger(option(options, 'textureSeed', 'texture_seed'), 'Tripo3D texture seed', 0, 4294967295);
  const textureAlignment = optionalEnum(option(options, 'textureAlignment', 'texture_alignment'), ['original_image', 'geometry'], 'Tripo3D texture alignment');
  const textureQuality = optionalEnum(option(options, 'textureQuality', 'texture_quality'), ['standard', 'detailed', 'extreme'], 'Tripo3D texture quality');
  const partNames = optionalStringArray(option(options, 'partNames', 'part_names'), 'Tripo3D texture part_names');
  const compress = optionalEnum(option(options, 'compress'), ['geometry'], 'Tripo3D texture compression');
  const bake = optionalBoolean(option(options, 'bake'), 'Tripo3D texture bake');
  if (model === 'v2.5-20250123' && compress !== undefined) {
    throw new Error('Tripo3D texture compress requires texture model v3.0-20250812');
  }
  return {
    input, model,
    ...(texturePrompt === undefined ? {} : { texture_prompt: texturePrompt }),
    ...(pbr === undefined ? {} : { pbr }),
    ...(textureSeed === undefined ? {} : { texture_seed: textureSeed }),
    ...(textureAlignment === undefined ? {} : { texture_alignment: textureAlignment }),
    ...(textureQuality === undefined ? {} : { texture_quality: textureQuality }),
    ...(partNames === undefined ? {} : { part_names: partNames }),
    ...(compress === undefined ? {} : { compress }),
    ...(bake === undefined ? {} : { bake }),
  };
}

function buildSegment(options, input) {
  const model = optionalEnum(option(options, 'model'), ['v1.0-20250506', 'v2.0-20260430'], 'Tripo3D segmentation model') || 'v1.0-20250506';
  const granularity = optionalEnum(option(options, 'segmentationGranularity', 'segmentation_granularity'), ['simple', 'balanced', 'detailed'], 'Tripo3D segmentation granularity');
  const split = optionalBoolean(option(options, 'splitByConnectivity', 'split_by_connectivity'), 'Tripo3D split_by_connectivity');
  const refImageValue = option(options, 'refImage', 'ref_image');
  const refImage = refImageValue === undefined ? undefined : nonEmptyString(refImageValue, 'Tripo3D segmentation ref_image');
  if (refImage && !(/^(?:https:\/\/|file_)/i.test(refImage))) {
    throw new Error('Tripo3D segmentation ref_image must be an HTTPS URL or file_token');
  }
  if (model === 'v1.0-20250506' && (granularity !== undefined || split !== undefined || refImage !== undefined)) {
    throw new Error('Tripo3D segmentation granularity, connectivity, and ref_image require model v2.0-20260430');
  }
  return {
    input, model,
    ...(refImage !== undefined ? { ref_image: refImage } : {
      ...(granularity === undefined ? {} : { segmentation_granularity: granularity }),
      ...(split === undefined ? {} : { split_by_connectivity: split }),
    }),
  };
}

function buildSmartSegment(options, source) {
  if (source.kind === 'taskId') throw new Error('Tripo3D smart segmentation requires a file_token or HTTPS URL source');
  const segType = optionalEnum(option(options, 'segType', 'seg_type'), ['image', 'model'], 'Tripo3D smart segmentation seg_type');
  if (!segType) throw new Error('Tripo3D smart segmentation seg_type is required');
  const granularity = optionalEnum(option(options, 'granularity'), ['coarse', 'medium', 'fine'], 'Tripo3D smart segmentation granularity') || 'medium';
  const hintValue = option(options, 'hint');
  const hint = hintValue === undefined ? undefined : nonEmptyString(hintValue, 'Tripo3D smart segmentation hint');
  const transformValue = option(options, 'transform');
  let transform;
  if (transformValue !== undefined) {
    if (!Array.isArray(transformValue) || transformValue.length !== 16 || transformValue.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error('Tripo3D smart segmentation transform must contain exactly 16 finite numbers');
    }
    transform = [...transformValue];
  }
  if (segType === 'model') {
    if (!transform) throw new Error('Tripo3D smart segmentation model input requires transform');
    const declaredFormat = String(option(options, 'sourceFormat', 'source_format') || '').trim().toLowerCase();
    if (source.kind === 'url') {
      if (!new URL(source.input).pathname.toLowerCase().endsWith('.glb')) throw new Error('Tripo3D smart segmentation model input only supports GLB');
    } else if (declaredFormat !== 'glb') {
      throw new Error('Tripo3D smart segmentation model file_token requires source_format=glb');
    }
  } else if (transform) {
    throw new Error('Tripo3D smart segmentation transform is only valid for model input');
  }
  return {
    seg_type: segType,
    input: source.input,
    granularity,
    ...(hint === undefined ? {} : { hint }),
    ...(transform === undefined ? {} : { transform }),
  };
}

function buildComplete(options, input) {
  const model = optionalEnum(option(options, 'model'), ['v1.0-20250506'], 'Tripo3D completion model') || 'v1.0-20250506';
  const partNames = optionalStringArray(option(options, 'partNames', 'part_names'), 'Tripo3D completion part_names');
  const completionMode = optionalEnum(option(options, 'completionMode', 'completion_mode'), ['ai_completion', 'quick_cap'], 'Tripo3D completion mode') || 'ai_completion';
  return {
    input,
    model,
    ...(partNames === undefined ? {} : { part_names: partNames }),
    completion_mode: completionMode,
  };
}

function buildRetopology(options, input) {
  const model = optionalEnum(option(options, 'model'), ['v2.0', 'v1.0'], 'Tripo3D retopology model') || 'v2.0';
  const quad = optionalBoolean(option(options, 'quad'), 'Tripo3D retopology quad') ?? false;
  const faceLimitValue = option(options, 'faceLimit', 'face_limit');
  let faceLimit;
  if (model === 'v2.0') {
    faceLimit = optionalInteger(faceLimitValue, 'Tripo3D retopology face_limit', 500, quad ? 10000 : 20000);
  } else {
    if (faceLimitValue === undefined) throw new Error('Tripo3D retopology v1.0 requires face_limit');
    faceLimit = optionalInteger(faceLimitValue, 'Tripo3D retopology face_limit', 1, quad ? 150000 : 2000000);
  }
  const bake = optionalBoolean(option(options, 'bake'), 'Tripo3D retopology bake');
  const partNames = optionalStringArray(option(options, 'partNames', 'part_names'), 'Tripo3D retopology part_names');
  if (model === 'v1.0' && (bake !== undefined || partNames !== undefined)) {
    throw new Error('Tripo3D retopology v1.0 does not support bake or part_names');
  }
  return {
    input, model,
    ...(faceLimit === undefined ? {} : { face_limit: faceLimit }),
    ...(own(options, 'quad') ? { quad } : {}),
    ...(bake === undefined ? {} : { bake }),
    ...(partNames === undefined ? {} : { part_names: partNames }),
  };
}

function buildConvert(options, input) {
  const requestedFormat = optionalEnum(option(options, 'format'), CONVERT_FORMATS, 'Tripo3D convert format', { uppercase: true });
  if (!requestedFormat) throw new Error('Tripo3D convert format is required');
  const quad = optionalBoolean(option(options, 'quad'), 'Tripo3D convert quad') ?? false;
  const format = quad ? 'FBX' : requestedFormat;
  const forceSymmetry = optionalBoolean(option(options, 'forceSymmetry', 'force_symmetry'), 'Tripo3D convert force_symmetry');
  if (forceSymmetry === true && !quad) throw new Error('Tripo3D convert force_symmetry requires quad=true');
  const faceLimit = optionalInteger(option(options, 'faceLimit', 'face_limit'), 'Tripo3D convert face_limit', 1, quad ? 150000 : 2000000);
  const flattenBottom = optionalBoolean(option(options, 'flattenBottom', 'flatten_bottom'), 'Tripo3D convert flatten_bottom');
  const flattenBottomThreshold = optionalNumber(option(options, 'flattenBottomThreshold', 'flatten_bottom_threshold'), 'Tripo3D convert flatten_bottom_threshold', { minimum: 0 });
  const textureSize = optionalInteger(option(options, 'textureSize', 'texture_size'), 'Tripo3D convert texture_size', 1, Number.MAX_SAFE_INTEGER);
  const textureFormat = optionalEnum(option(options, 'textureFormat', 'texture_format'), TEXTURE_FORMATS, 'Tripo3D convert texture_format', { uppercase: true });
  const bake = optionalBoolean(option(options, 'bake'), 'Tripo3D convert bake');
  const packUv = optionalBoolean(option(options, 'packUv', 'pack_uv'), 'Tripo3D convert pack_uv');
  const exportVertexColors = optionalBoolean(option(options, 'exportVertexColors', 'export_vertex_colors'), 'Tripo3D convert export_vertex_colors');
  if (exportVertexColors === true && !['OBJ', 'GLTF'].includes(format)) {
    throw new Error('Tripo3D convert export_vertex_colors is only valid for OBJ and GLTF');
  }
  const pivotToCenterBottom = optionalBoolean(option(options, 'pivotToCenterBottom', 'pivot_to_center_bottom'), 'Tripo3D convert pivot_to_center_bottom');
  const scaleFactor = optionalNumber(option(options, 'scaleFactor', 'scale_factor'), 'Tripo3D convert scale_factor', { minimum: 0, exclusiveMinimum: true });
  const withAnimation = optionalBoolean(option(options, 'withAnimation', 'with_animation'), 'Tripo3D convert with_animation');
  const animateInPlace = optionalBoolean(option(options, 'animateInPlace', 'animate_in_place'), 'Tripo3D convert animate_in_place');
  if (animateInPlace === true && withAnimation !== true) throw new Error('Tripo3D convert animate_in_place requires with_animation=true');
  const partNames = optionalStringArray(option(options, 'partNames', 'part_names'), 'Tripo3D convert part_names');
  const orientation = optionalEnum(option(options, 'exportOrientation', 'export_orientation'), ['+x', '-x', '-y', '+y'], 'Tripo3D convert export_orientation');
  const fbxPreset = optionalEnum(option(options, 'fbxPreset', 'fbx_preset'), ['blender', '3dsmax', 'mixamo'], 'Tripo3D convert fbx_preset');
  if (fbxPreset !== undefined && format !== 'FBX') throw new Error('Tripo3D convert fbx_preset requires FBX output');
  return {
    input, format,
    ...(own(options, 'quad') ? { quad } : {}),
    ...(forceSymmetry === undefined ? {} : { force_symmetry: forceSymmetry }),
    ...(faceLimit === undefined ? {} : { face_limit: faceLimit }),
    ...(flattenBottom === undefined ? {} : { flatten_bottom: flattenBottom }),
    ...(flattenBottomThreshold === undefined ? {} : { flatten_bottom_threshold: flattenBottomThreshold }),
    ...(textureSize === undefined ? {} : { texture_size: textureSize }),
    ...(textureFormat === undefined ? {} : { texture_format: textureFormat }),
    ...(bake === undefined ? {} : { bake }),
    ...(packUv === undefined ? {} : { pack_uv: packUv }),
    ...(exportVertexColors === undefined ? {} : { export_vertex_colors: exportVertexColors }),
    ...(pivotToCenterBottom === undefined ? {} : { pivot_to_center_bottom: pivotToCenterBottom }),
    ...(scaleFactor === undefined ? {} : { scale_factor: scaleFactor }),
    ...(withAnimation === undefined ? {} : { with_animation: withAnimation }),
    ...(animateInPlace === undefined ? {} : { animate_in_place: animateInPlace }),
    ...(partNames === undefined ? {} : { part_names: partNames }),
    ...(orientation === undefined ? {} : { export_orientation: orientation }),
    ...(fbxPreset === undefined ? {} : { fbx_preset: fbxPreset }),
  };
}

function buildRig(options, input) {
  const model = optionalEnum(option(options, 'model'), ['v1.0-20240301', 'v2.5-20260210'], 'Tripo3D rig model') || 'v1.0-20240301';
  const rigType = optionalEnum(option(options, 'rigType', 'rig_type'), RIG_TYPES, 'Tripo3D rig_type') || 'biped';
  if (model === 'v1.0-20240301' && rigType !== 'biped') {
    throw new Error('Tripo3D rig model v1.0-20240301 only supports biped');
  }
  const spec = optionalEnum(option(options, 'spec'), ['tripo', 'mixamo'], 'Tripo3D rig spec') || 'tripo';
  const outFormat = optionalEnum(option(options, 'outFormat', 'out_format'), OUTPUT_FORMATS, 'Tripo3D rig out_format', { lowercase: true }) || 'glb';
  return { input, model, rig_type: rigType, spec, out_format: outFormat };
}

function animationIdentifier(value, label) {
  const normalized = nonEmptyString(value, label);
  if (!/^preset:[a-z0-9_:-]+$/i.test(normalized)) throw new Error(`${label} must be a preset animation identifier`);
  return normalized;
}

function buildRetarget(options, input) {
  const animationValue = option(options, 'animation');
  const animationsValue = option(options, 'animations');
  if (Number(animationValue !== undefined) + Number(animationsValue !== undefined) !== 1) {
    throw new Error('Tripo3D retarget requires exactly one of animation or animations');
  }
  const animation = animationValue === undefined ? undefined : animationIdentifier(animationValue, 'Tripo3D retarget animation');
  let animations;
  if (animationsValue !== undefined) {
    if (!Array.isArray(animationsValue) || animationsValue.length < 1 || animationsValue.length > 5) {
      throw new Error('Tripo3D retarget animations must contain 1 to 5 presets');
    }
    animations = animationsValue.map((entry, index) => animationIdentifier(entry, `Tripo3D retarget animations[${index}]`));
  }
  const outFormat = optionalEnum(option(options, 'outFormat', 'out_format'), OUTPUT_FORMATS, 'Tripo3D retarget out_format', { lowercase: true }) || 'glb';
  const bakeAnimation = optionalBoolean(option(options, 'bakeAnimation', 'bake_animation'), 'Tripo3D retarget bake_animation');
  if (bakeAnimation !== undefined && outFormat !== 'glb') throw new Error('Tripo3D retarget bake_animation is only valid for GLB output');
  const exportWithGeometry = optionalBoolean(option(options, 'exportWithGeometry', 'export_with_geometry'), 'Tripo3D retarget export_with_geometry');
  const animateInPlace = optionalBoolean(option(options, 'animateInPlace', 'animate_in_place'), 'Tripo3D retarget animate_in_place');
  return {
    input,
    ...(animation === undefined ? {} : { animation }),
    ...(animations === undefined ? {} : { animations }),
    out_format: outFormat,
    ...(bakeAnimation === undefined ? {} : { bake_animation: bakeAnimation }),
    ...(exportWithGeometry === undefined ? {} : { export_with_geometry: exportWithGeometry }),
    ...(animateInPlace === undefined ? {} : { animate_in_place: animateInPlace }),
  };
}

export function normalizeTripo3dPostprocessOperation(operation) {
  const requested = String(operation || '').trim().toLowerCase();
  const normalized = OPERATION_ALIASES[requested];
  if (!normalized) throw new Error(`Unsupported Tripo3D post-process operation: ${requested || '(empty)'}`);
  return normalized;
}

export function tripo3dPostprocessRequest(operation, rawOptions = {}) {
  const normalizedOperation = normalizeTripo3dPostprocessOperation(operation);
  const options = requireObject(rawOptions, 'Tripo3D post-process options');
  const source = normalizeSource(options, {
    taskOnly: normalizedOperation === 'retarget' || normalizedOperation === 'complete',
    taskOnlyLabel: normalizedOperation === 'complete' ? 'mesh completion' : 'animation retarget',
    rigCheck: normalizedOperation === 'rig-check',
  });
  let body;
  if (normalizedOperation === 'texture') body = buildTexture(options, source.input);
  else if (normalizedOperation === 'segment') body = buildSegment(options, source.input);
  else if (normalizedOperation === 'smart-segment') body = buildSmartSegment(options, source);
  else if (normalizedOperation === 'complete') body = buildComplete(options, source.input);
  else if (normalizedOperation === 'retopology') body = buildRetopology(options, source.input);
  else if (normalizedOperation === 'convert') body = buildConvert(options, source.input);
  else if (normalizedOperation === 'rig-check') body = { input: source.input };
  else if (normalizedOperation === 'rig') body = buildRig(options, source.input);
  else body = buildRetarget(options, source.input);
  return Object.freeze({
    operation: normalizedOperation,
    endpoint: OPERATIONS[normalizedOperation].endpoint,
    source,
    body: Object.freeze(body),
  });
}

function extensionFromUrl(url, fallback) {
  try {
    const match = new URL(url).pathname.match(/\.[a-z0-9]+$/i);
    if (match) return match[0].toLowerCase();
  } catch {
    // The remote URL is returned unchanged; archiving code can reject it later.
  }
  return fallback;
}

function expectedExtension(operation, request) {
  if (operation === 'convert') {
    const format = String(request?.body?.format || '').toLowerCase();
    return format === 'gltf' ? '.gltf' : format ? `.${format}` : '.glb';
  }
  if (operation === 'rig' || operation === 'retarget') return `.${String(request?.body?.out_format || 'glb').toLowerCase()}`;
  return '.glb';
}

function normalizedSuccess(task, taskId, operation, request) {
  const rawOutput = task?.output && typeof task.output === 'object' && !Array.isArray(task.output) ? task.output : {};
  const singular = String(rawOutput.model_url || rawOutput.seg_model_url || '').trim();
  const plural = Array.isArray(rawOutput.model_urls)
    ? rawOutput.model_urls.map((url) => String(url || '').trim()).filter(Boolean)
    : [];
  const modelUrls = plural.length ? plural : (singular ? [singular] : []);
  const renderedImageUrl = String(rawOutput.rendered_image_url || rawOutput.mask_url || '').trim() || null;
  const fallbackExtension = expectedExtension(operation, request);
  const authoritativeOutputFormat = ['convert', 'rig', 'retarget'].includes(operation);
  const resultSourceTaskId = operation === 'smart-segment'
    ? String(rawOutput.seg_task_id || taskId).trim()
    : taskId;
  const outputs = modelUrls.map((mediaUrl, index) => ({
    mediaType: 'model',
    mediaUrl,
    previewUrl: index === 0 ? renderedImageUrl : null,
    extension: authoritativeOutputFormat ? fallbackExtension : extensionFromUrl(mediaUrl, fallbackExtension),
    fileName: `${taskId}${modelUrls.length > 1 ? `-${index + 1}` : ''}${authoritativeOutputFormat ? fallbackExtension : extensionFromUrl(mediaUrl, fallbackExtension)}`,
    metadata: {
      provider: 'tripo3d',
      tripoTaskId: resultSourceTaskId,
      ...(resultSourceTaskId === taskId ? {} : { parentTripoTaskId: taskId }),
      ...(rawOutput.model_task_id ? { modelTaskId: String(rawOutput.model_task_id) } : {}),
      operation,
      creditsConsumed: Number(task?.credits_consumed) || 0,
      rawOutput,
    },
  }));
  const hasRiggable = typeof rawOutput.riggable === 'boolean';
  if (operation === 'rig-check' && !hasRiggable) throw new Error('Tripo3D rig-check succeeded without riggable output');
  if (operation !== 'rig-check' && modelUrls.length === 0) throw new Error(`Tripo3D ${operation} task succeeded without model_url or model_urls`);
  return {
    operation,
    remoteTaskId: taskId,
    taskId,
    modelUrl: singular || modelUrls[0] || null,
    modelUrls,
    renderedImageUrl,
    riggable: hasRiggable ? rawOutput.riggable : undefined,
    rigType: String(rawOutput.rig_type || '').trim() || null,
    outputs,
    usage: { creditsConsumed: Number(task?.credits_consumed) || 0 },
    rawOutput,
    rawTask: task,
  };
}

function findRigCheckOutput(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 6 || seen.has(value)) return null;
  seen.add(value);
  const rigType = String(value.rig_type ?? value.rigType ?? '').trim();
  const riggable = value.riggable ?? value.is_riggable ?? value.isRiggable;
  if (typeof riggable === 'boolean' || rigType) return value;
  for (const nested of Object.values(value)) {
    const found = findRigCheckOutput(nested, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function normalizedRigCheckSuccess(rawOutput, taskId = null) {
  const source = rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput) ? rawOutput : {};
  const output = findRigCheckOutput(source) || source;
  const rigType = String(output.rig_type ?? output.rigType ?? '').trim() || null;
  const rawRiggable = output.riggable ?? output.is_riggable ?? output.isRiggable;
  const riggable = typeof rawRiggable === 'boolean' ? rawRiggable : rigType ? true : undefined;
  if (typeof riggable !== 'boolean') {
    throw new Error('Tripo3D rig-check succeeded without riggable output');
  }
  return {
    operation: 'rig-check',
    remoteTaskId: taskId,
    taskId,
    modelUrl: null,
    modelUrls: [],
    renderedImageUrl: null,
    riggable,
    rigType,
    outputs: [],
    usage: { creditsConsumed: Number(output.credits_consumed ?? source.credits_consumed ?? source.data?.credits_consumed) || 0 },
    rawOutput: output,
    rawTask: source,
  };
}

function rigCheckTaskId(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return String(value.task_id ?? value.taskId ?? value.data?.task_id ?? value.data?.taskId ?? '').trim();
}

function createSynchronousPost({ baseUrl, apiKey, fetchImpl }) {
  const normalizedBaseUrl = String(baseUrl || 'https://openapi.tripo3d.com/v3').replace(/\/$/, '');
  const request = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
  return async (endpoint, body, { signal } = {}) => {
    let response;
    try {
      response = await request(`${normalizedBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        const aborted = new Error('Tripo3D request aborted');
        aborted.name = 'AbortError';
        throw aborted;
      }
      throw new Tripo3dSubmissionUnknownError('Tripo3D rig-check submission outcome is unknown; do not retry automatically');
    }
    if ([429, 500, 502, 503, 504].includes(response.status)) {
      throw new Tripo3dSubmissionUnknownError(`Tripo3D rig-check submission returned HTTP ${response.status}; do not retry automatically`);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload?.code !== undefined && Number(payload.code) !== 0)) {
      const message = String(payload?.error_message || payload?.message || payload?.error?.message || payload?.error
        || `Tripo3D rig-check failed: HTTP ${response.status}`).trim();
      throw new Tripo3dApiError(message, {
        status: response.status,
        code: String(payload?.code ?? ''),
        retryable: [429, 500, 502, 503, 504].includes(response.status),
      });
    }
    // Keep the complete successful envelope. Rig Check has appeared both as
    // data.rig_type (the documented shape) and in additional nested/root
    // wrappers. The normalizer safely extracts only rigging fields.
    return payload || {};
  };
}

export async function runTripo3dPostprocess({
  client,
  operation,
  options = {},
  remoteTaskId,
  signal,
  timeoutMs = 900000,
  pollIntervalMs = 2000,
  onRemoteTask,
  onProgress,
  onWorkflowState,
  onSubmissionUnknown,
} = {}) {
  const normalizedOperation = normalizeTripo3dPostprocessOperation(operation);
  if (normalizedOperation === 'rig-check') {
    if (!client || typeof client.synchronousPost !== 'function' || typeof client.pollTask !== 'function') {
      throw new Error('A Tripo3D client with synchronousPost and pollTask is required for rig-check');
    }
    const request = tripo3dPostprocessRequest(normalizedOperation, options);
    let taskId = String(remoteTaskId || '').trim();
    if (!taskId) {
      await onWorkflowState?.({ operation: normalizedOperation, phase: 'submitting' });
      let output;
      try {
        output = await client.synchronousPost(request.endpoint, request.body, { signal });
      } catch (error) {
        if (error instanceof Tripo3dSubmissionUnknownError || error?.submissionUnknown) {
          await onSubmissionUnknown?.({ operation: normalizedOperation, phase: 'submission_unknown', state: 'submission_unknown' });
        }
        throw error;
      }
      if (findRigCheckOutput(output)) return normalizedRigCheckSuccess(output);
      taskId = rigCheckTaskId(output);
      if (!taskId) return normalizedRigCheckSuccess(output);
      await onRemoteTask?.(taskId, { operation: normalizedOperation, phase: 'polling' });
    }
    await onWorkflowState?.({ operation: normalizedOperation, phase: 'polling', remoteTaskId: taskId, resumed: Boolean(remoteTaskId) });
    const task = await client.pollTask(taskId, {
      signal,
      timeoutMs: Math.max(1, Number(timeoutMs) || 900000),
      pollIntervalMs: Math.max(1, Number(pollIntervalMs) || 2000),
      onProgress: async (progress, remoteTask) => onProgress?.(progress, remoteTask),
    });
    return normalizedRigCheckSuccess(task, taskId);
  }
  if (!client || typeof client.createTask !== 'function' || typeof client.pollTask !== 'function') {
    throw new Error('A Tripo3D client is required');
  }
  let taskId = String(remoteTaskId || '').trim();
  let request;
  if (!taskId) {
    request = tripo3dPostprocessRequest(normalizedOperation, options);
    await onWorkflowState?.({ operation: normalizedOperation, phase: 'submitting' });
    let created;
    try {
      created = await client.createTask(request.endpoint, request.body, { signal });
    } catch (error) {
      if (error instanceof Tripo3dSubmissionUnknownError || error?.submissionUnknown) {
        await onSubmissionUnknown?.({ operation: normalizedOperation, phase: 'submission_unknown', state: 'submission_unknown' });
      }
      throw error;
    }
    taskId = created.task_id;
    await onRemoteTask?.(taskId, { operation: normalizedOperation, phase: 'polling' });
  } else {
    // Recovery only needs the remote task ID. Rebuild the request contract when
    // the persisted source is available so output extensions stay exact, but do
    // not turn missing pre-submission inputs into a duplicate paid POST.
    try { request = tripo3dPostprocessRequest(normalizedOperation, options); }
    catch {}
    await onWorkflowState?.({ operation: normalizedOperation, phase: 'polling', remoteTaskId: taskId, resumed: true });
  }
  const task = await client.pollTask(taskId, {
    signal,
    timeoutMs: Math.max(1, Number(timeoutMs) || 900000),
    pollIntervalMs: Math.max(1, Number(pollIntervalMs) || 2000),
    onProgress: async (progress, remoteTask) => onProgress?.(progress, remoteTask),
  });
  return normalizedSuccess(task, taskId, normalizedOperation, request);
}

export function createTripo3dPostprocessRunner(config = {}) {
  const apiKeyEnvironment = String(config.apiKeyEnv || 'TRIPO_API_KEY').trim();
  const apiKey = String(config.apiKey || '' || '').trim();
  if (!apiKey) throw new Error('Tripo3D API Key is not configured');
  const baseUrl = config.baseUrl || 'https://openapi.tripo3d.com/v3';
  const baseClient = createTripo3dClient({
    baseUrl,
    apiKey,
    fetchImpl: config.fetchImpl,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaximumDelayMs: config.retryMaximumDelayMs,
    maximumRetries: config.maximumRetries,
    sleepImpl: config.sleepImpl,
  });
  const client = Object.freeze({
    ...baseClient,
    synchronousPost: createSynchronousPost({ baseUrl, apiKey, fetchImpl: config.fetchImpl }),
  });
  return Object.freeze({
    client,
    request: tripo3dPostprocessRequest,
    run: (job) => runTripo3dPostprocess({
      client,
      timeoutMs: config.pollTimeoutMs,
      pollIntervalMs: config.pollIntervalMs,
      ...job,
    }),
  });
}

export const TRIPO3D_POSTPROCESS_OPERATIONS = Object.freeze(Object.fromEntries(
  Object.entries(OPERATIONS).map(([name, spec]) => [name, spec.endpoint]),
));
