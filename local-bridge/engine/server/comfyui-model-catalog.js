const GENERATED_CHECKPOINT_ID = /^checkpoint-[a-f0-9]{12}$/i;
const GENERATED_CONFIG_KEYS = new Set([
  'baseUrl', 'model', 'defaultRatio', 'defaultResolution', 'steps', 'cfg',
  'sampler', 'scheduler', 'referenceDenoise',
]);
const MEIXUAN_CHECKPOINT = '美宣风格SDXL大模型_1.0_recovered.safetensors';
const MEIXUAN_CHARACTER_LORA = '游戏美宣人物刻画V-1.0_recovered.safetensors';

function fail(message, code = 'model_catalog_invalid') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function clone(value) {
  return structuredClone(value);
}

function leaf(value) {
  return String(value || '').split(/[\\/]/).at(-1) || '';
}

function stem(value) {
  return leaf(value).replace(/\.[^.]+$/, '');
}

function normalizedIdentity(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
}

function checkpointIdentity(model) {
  return normalizedIdentity(model?.config?.model || model?.config?.checkpoint);
}

function isExternalComfyRecord(model) {
  return String(model?.adapter || '').startsWith('comfyui-') && model?.config?.managed !== true;
}

function comfyDropdown(objectInfo, nodeName, inputName) {
  const value = objectInfo?.[nodeName]?.input?.required?.[inputName]?.[0]
    || objectInfo?.[nodeName]?.input?.optional?.[inputName]?.[0];
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

function ordinalUnion(existing, detected) {
  const output = [];
  const seen = new Set();
  for (const item of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(detected) ? detected : [])]) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const identity = normalizedIdentity(item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    output.push(item);
  }
  return output;
}

function isPoseHelper(value) {
  return stem(value).toLowerCase() === 'sdpose_wholebody_fp16';
}

function genericCheckpointName(model) {
  const checkpoint = model?.config?.model || model?.config?.checkpoint;
  return checkpoint ? `ComfyUI · ${stem(checkpoint)}` : '';
}

function isUnconfiguredGeneratedCheckpoint(model) {
  if (!GENERATED_CHECKPOINT_ID.test(String(model?.id || ''))
    || model?.capability !== 'image'
    || model?.adapter !== 'comfyui-sdxl'
    || model?.enabled !== false
    || model?.name !== genericCheckpointName(model)) return false;
  const config = model?.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  if (Object.keys(config).some((key) => !GENERATED_CONFIG_KEYS.has(key))) return false;
  return config.defaultRatio === '3:4'
    && config.defaultResolution === '1K'
    && config.steps === 28
    && config.cfg === 6
    && config.sampler === 'dpmpp_2m_sde'
    && config.scheduler === 'karras'
    && config.referenceDenoise === 0.72;
}

function checkpointPreset(checkpoint, loras, baseUrl, { observed = true } = {}) {
  const identity = normalizedIdentity(checkpoint);
  const detectedCharacter = loras.filter((name) => normalizedIdentity(leaf(name)) === normalizedIdentity(MEIXUAN_CHARACTER_LORA));
  const shared = {
    capability: 'image',
    enabled: false,
    config: {
      baseUrl,
      model: checkpoint,
      defaultRatio: '3:4',
      defaultResolution: '1K',
      steps: 28,
      sampler: 'dpmpp_2m_sde',
      scheduler: 'karras',
      referenceDenoise: 0.72,
      ...(observed ? { discoveryReady: true, missingDependencies: [] } : {}),
    },
  };
  if (identity === normalizedIdentity(MEIXUAN_CHECKPOINT)) {
    return {
      ...shared,
      id: 'meixuan-sdxl-local',
      name: '美宣风格 SDXL 1.0（本地）',
      adapter: 'comfyui-sdxl',
      config: { ...shared.config, cfg: 6, ...(detectedCharacter.length ? { characterLoras: detectedCharacter } : {}) },
    };
  }
  if (normalizedIdentity(leaf(checkpoint)) === normalizedIdentity('Illustrious-XL-v2.0.safetensors')) {
    return {
      ...shared,
      id: 'illustrious-xl-local',
      name: 'Illustrious XL 游戏立绘（本地）',
      adapter: 'comfyui-illustrious',
      config: { ...shared.config, cfg: 5.5 },
    };
  }
  return null;
}

const NATIVE_DEFINITIONS = Object.freeze([
  { id: 'flux2-klein-4b-local', name: 'FLUX.2 Klein 4B（本地）', family: 'flux2-klein', unet: /flux[-_ ]?2[-_ ]?klein.*4b/i, resources: { clip: /qwen[_-]?3[_-]?4b/i, vae: /flux2[-_]?vae/i }, steps: 20, cfg: 3.5, sampler: 'euler' },
  { id: 'qwen-image-edit-2511-local', name: 'Qwen Image Edit 2511（本地）', family: 'qwen-image-edit-2511', unet: /qwen[_-]?image[_-]?edit[_-]?2511/i, resources: { clip: /qwen[_-]?2\.5[_-]?vl[_-]?7b/i, vae: /qwen[_-]?image[_-]?vae/i }, optionalLora: /Qwen-Image-Edit-2511-Lightning/i, steps: 4, cfg: 1, sampler: 'euler' },
  { id: 'qwen-image-local', name: 'Qwen Image（本地）', family: 'qwen-image', unet: /qwen[_-]?image(?![_-]?edit)/i, resources: { clip: /qwen[_-]?2\.5[_-]?vl[_-]?7b/i, vae: /qwen[_-]?image[_-]?vae/i }, optionalLora: /Qwen-Image-Lightning/i, styleLora: /3Doc/i, steps: 8, cfg: 1, sampler: 'euler' },
  { id: 'krea2-turbo-local', name: 'Krea 2 Turbo FP8（本地）', family: 'krea2-turbo', unet: /krea2[_-]?turbo/i, resources: { clip: /qwen3vl[_-]?4b/i, vae: /qwen[_-]?image[_-]?vae/i }, styleLora: /K2-2\.5Dhoutu|XB_KREA_2_TURBO_CG/i, steps: 8, cfg: 1, sampler: 'euler' },
  { id: 'z-image-turbo-local', name: 'Z-Image Turbo INT8（本地）', family: 'z-image-turbo', unet: /z[_-]?image[_-]?turbo/i, resources: { clip: /qwen[_-]?3[_-]?4b/i, vae: /(^|[\\/])ae\.safetensors$/i }, steps: 8, cfg: 1, sampler: 'res_multistep' },
  { id: 'hidream-i1-full-local', name: 'HiDream-I1 Full FP8（本地）', family: 'hidream-i1-full', unet: /hidream[_-]?i1[_-]?full/i, resources: { clip1: /clip[_-]?l[_-]?hidream/i, clip2: /clip[_-]?g[_-]?hidream/i, clip3: /t5xxl.*(?:fp8|scaled)/i, clip4: /llama[_-]?3\.1[_-]?8b.*(?:fp8|scaled)/i, vae: /(^|[\\/])ae\.safetensors$/i }, steps: 50, cfg: 5, sampler: 'uni_pc' },
  { id: 'newbie-image-exp01-local', name: 'NewBie Image Exp0.1（本地）', family: 'newbie-image-exp01', unet: /NewBie-Image-Exp0\.1/i, resources: { clip1: /gemma[_-]?3[_-]?4b/i, clip2: /jina[_-]?clip[_-]?v2/i, vae: /(^|[\\/])ae\.safetensors$/i }, steps: 20, cfg: 5.5, sampler: 'res_multistep' },
  { id: 'anima-base-v1-local', name: 'Anima Base v1（本地）', family: 'anima-base-v1', unet: /anima[\\/].*anima-base-v1/i, resources: { clip: /anima[\\/].*qwen[_-]?3[_-]?06b/i, vae: /qwen[_-]?image[_-]?vae/i, inpaint: /anima[\\/].*anima[-_]?lllite[-_]?inpainting[-_]?v2/i }, steps: 30, cfg: 4, sampler: 'er_sde' },
]);

function presentationFor(name) {
  if (/Dhoutu/i.test(name)) return { label: '厚涂画风', previewUrl: '/assets/lora-previews/k2-2-5d-thick-paint.png' };
  if (/KREA_2_TURBO_CG/i.test(name)) return { label: 'Krea-2-Turbo CG画风', previewUrl: '/assets/lora-previews/krea-2-turbo-cg.png' };
  if (/3Doc/i.test(name)) return { label: '3D美宣CG', previewUrl: '/assets/lora-previews/3doc-cg.png' };
  return {};
}

function findFirst(items, pattern) {
  return items.find((item) => pattern.test(item)) || '';
}

function nativePreset(definition, inventory, baseUrl) {
  const unet = findFirst(inventory.unets, definition.unet);
  if (!unet) return null;
  const resources = { unet };
  const missingDependencies = [];
  for (const [role, pattern] of Object.entries(definition.resources)) {
    const pool = role === 'inpaint' ? inventory.patches : role.startsWith('clip') ? inventory.clips : inventory.vaes;
    const selected = findFirst(pool, pattern);
    if (selected) resources[role] = selected;
    else missingDependencies.push(role);
  }
  const optionalLora = definition.optionalLora ? findFirst(inventory.loras, definition.optionalLora) : '';
  if (optionalLora) resources.lora = optionalLora;
  const styleLoras = definition.styleLora ? inventory.loras.filter((name) => definition.styleLora.test(name)) : [];
  const loraPresentation = Object.fromEntries(styleLoras.map((name) => [name, presentationFor(name)]));
  return {
    id: definition.id,
    name: definition.name,
    capability: 'image',
    adapter: 'comfyui-native-image',
    enabled: false,
    config: {
      baseUrl,
      family: definition.family,
      resources,
      ...(styleLoras.length ? { styleLoras, loraPresentation } : {}),
      defaultRatio: ['anima-base-v1', 'qwen-image'].includes(definition.family) ? '3:4' : '1:1',
      defaultResolution: '1K',
      steps: definition.steps,
      cfg: definition.cfg,
      sampler: definition.sampler,
      scheduler: 'simple',
      referenceDenoise: 0.72,
      discoveryReady: missingDependencies.length === 0,
      missingDependencies,
    },
  };
}

function inventoryFrom(discovery = {}) {
  const objectInfo = discovery?.objectInfo || {};
  return {
    checkpoints: comfyDropdown(objectInfo, 'CheckpointLoaderSimple', 'ckpt_name'),
    unets: comfyDropdown(objectInfo, 'UNETLoader', 'unet_name'),
    clips: comfyDropdown(objectInfo, 'CLIPLoader', 'clip_name'),
    vaes: comfyDropdown(objectInfo, 'VAELoader', 'vae_name'),
    loras: ordinalUnion(
      comfyDropdown(objectInfo, 'LoraLoader', 'lora_name'),
      comfyDropdown(objectInfo, 'LoraLoaderModelOnly', 'lora_name'),
    ),
    patches: comfyDropdown(objectInfo, 'ModelPatchLoader', 'name'),
  };
}

export function discoverComfyModels(baseUrl, discovery = {}) {
  const inventory = inventoryFrom(discovery);
  const models = [];
  const seenIds = new Set();
  const add = (model) => {
    if (!model) return;
    const key = model.id.toLowerCase();
    if (seenIds.has(key)) return;
    seenIds.add(key);
    models.push(model);
  };
  for (const checkpoint of inventory.checkpoints) {
    if (!isPoseHelper(checkpoint)) add(checkpointPreset(checkpoint, inventory.loras, baseUrl));
  }
  for (const definition of NATIVE_DEFINITIONS) add(nativePreset(definition, inventory, baseUrl));
  if (discovery?.objectInfo?.MiniMaxH3ImageToVideo) {
    add({
      id: 'minimax-h3-local',
      name: 'MiniMax-H3 本地（ComfyUI）',
      capability: 'video',
      adapter: 'comfyui-minimax-h3',
      enabled: false,
      config: {
        baseUrl,
        model: 'MiniMax-H3 Local',
        defaultRatio: '16:9',
        defaultResolution: '768P',
        pollIntervalMs: 3000,
        estimatedRunSeconds: 360,
        discoveryReady: true,
        missingDependencies: [],
      },
    });
  }
  return { models, inventory };
}

function assertUniqueIds(records) {
  const seen = new Set();
  for (const model of records) {
    const id = String(model?.id || '');
    const key = id.toLowerCase();
    if (!id || seen.has(key)) fail(`case-insensitive model ID collision: ${id}`, 'model_id_collision');
    seen.add(key);
  }
}

function mergeCatalogModel(previous, discovered) {
  const previousConfig = previous?.config && typeof previous.config === 'object' && !Array.isArray(previous.config) ? previous.config : {};
  const discoveredConfig = discovered.config || {};
  const config = { ...discoveredConfig, ...previousConfig };
  for (const key of ['baseUrl', 'family', 'discoveryReady', 'missingDependencies']) {
    if (Object.hasOwn(discoveredConfig, key)) config[key] = clone(discoveredConfig[key]);
  }
  if (discoveredConfig.resources) config.resources = { ...(previousConfig.resources || {}), ...discoveredConfig.resources };
  for (const key of ['styleLoras', 'characterLoras', 'objectLoras']) {
    const merged = ordinalUnion(previousConfig[key], discoveredConfig[key]);
    if (merged.length) config[key] = merged;
  }
  if (discoveredConfig.loraPresentation || previousConfig.loraPresentation) {
    config.loraPresentation = { ...(discoveredConfig.loraPresentation || {}), ...(previousConfig.loraPresentation || {}) };
  }
  const previousName = String(previous.name || '');
  const curatedName = previousName === genericCheckpointName(previous) ? discovered.name : previousName;
  return {
    ...discovered,
    ...previous,
    id: previous.id,
    name: curatedName || discovered.name,
    enabled: Boolean(previous.enabled),
    config,
  };
}

function staticKnownModels(records) {
  const candidates = [];
  const seen = new Set();
  for (const record of records) {
    if (!isExternalComfyRecord(record)) continue;
    const checkpoint = record?.config?.model || record?.config?.checkpoint;
    const candidate = checkpointPreset(checkpoint, [MEIXUAN_CHARACTER_LORA], record?.config?.baseUrl || '', { observed: false });
    if (!candidate || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    candidates.push(candidate);
  }
  return candidates;
}

export function reconcileSavedComfyModels(existing = [], options = {}) {
  if (!Array.isArray(existing)) fail('existing model catalog must be an array');
  assertUniqueIds(existing);
  const records = clone(existing);
  const generatedInventoryIds = new Set(existing.filter(isUnconfiguredGeneratedCheckpoint).map((model) => String(model.id).toLowerCase()));
  const discovered = options.discovery
    ? discoverComfyModels(options.baseUrl || '', options.discovery)
    : { models: staticKnownModels(records), inventory: inventoryFrom() };

  for (const candidate of discovered.models) {
    const identity = checkpointIdentity(candidate);
    const identityIndexes = identity
      ? records.map((record, index) => (isExternalComfyRecord(record) && checkpointIdentity(record) === identity ? index : -1)).filter((index) => index >= 0)
      : [];
    if (identityIndexes.length) {
      for (const index of identityIndexes) records[index] = mergeCatalogModel(records[index], candidate);
      continue;
    }
    const idIndex = records.findIndex((record) => String(record.id).toLowerCase() === candidate.id.toLowerCase());
    let index = -1;
    if (idIndex >= 0) {
      if (!isExternalComfyRecord(records[idIndex])) fail(`model ID ${candidate.id} is owned by a non-external catalog record`, 'model_id_collision');
      const occupiedIdentity = checkpointIdentity(records[idIndex]);
      if (identity && occupiedIdentity && identity !== occupiedIdentity) {
        fail(`model ID ${candidate.id} is already bound to another checkpoint`, 'model_id_collision');
      }
      index = idIndex;
    }
    if (index >= 0) {
      records[index] = mergeCatalogModel(records[index], candidate);
      continue;
    }
    if (records.some((record) => String(record.id).toLowerCase() === candidate.id.toLowerCase())) {
      fail(`case-insensitive model ID collision: ${candidate.id}`, 'model_id_collision');
    }
    records.push(clone(candidate));
  }
  assertUniqueIds(records);

  const visible = records.filter((model) => {
    if (!String(model?.adapter || '').startsWith('comfyui-')) return true;
    const checkpoint = model?.config?.model || model?.config?.checkpoint;
    if (isPoseHelper(checkpoint)) return false;
    return !isUnconfiguredGeneratedCheckpoint(model);
  });
  const canonicalByIdentity = new Map(discovered.models.map((model) => [checkpointIdentity(model), String(model.id).toLowerCase()]).filter(([identity]) => identity));
  const winnerByIdentity = new Map();
  const priority = (model, identity) => {
    if (String(model.id).toLowerCase() === canonicalByIdentity.get(identity)) return 3;
    if (model.enabled || !generatedInventoryIds.has(String(model.id).toLowerCase())) return 2;
    return 1;
  };
  for (let index = 0; index < visible.length; index += 1) {
    const model = visible[index];
    if (!isExternalComfyRecord(model)) continue;
    const identity = checkpointIdentity(model);
    if (!identity) continue;
    const winner = winnerByIdentity.get(identity);
    if (!winner || priority(model, identity) > priority(visible[winner.index], identity)) winnerByIdentity.set(identity, { index });
  }
  const selectedIndexes = new Set([...winnerByIdentity.values()].map((winner) => winner.index));
  const models = visible.filter((model, index) => !isExternalComfyRecord(model) || !checkpointIdentity(model) || selectedIndexes.has(index));
  return { models, records, inventory: clone(discovered.inventory) };
}
