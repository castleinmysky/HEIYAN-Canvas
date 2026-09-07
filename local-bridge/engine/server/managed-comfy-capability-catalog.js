const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const ILLUSTRIOUS_NODES = Object.freeze([
  'CLIPTextEncode', 'CheckpointLoaderSimple', 'EmptyLatentImage', 'ImageScale',
  'ImageUpscaleWithModel', 'KSampler', 'LoadImage', 'LoraLoaderModelOnly',
  'ResizeAndPadImage', 'SaveImage', 'UpscaleModelLoader', 'VAEDecode', 'VAEEncode',
]);

const H3_NODES = Object.freeze([
  'AICanvasVideoFrames24FPS', 'ApplyH3Ref2VAUltraSafeBlockCache', 'BasicGuider',
  'BasicScheduler', 'CLIPLoader', 'CreateVideo', 'GetVideoComponents',
  'H3FaceStitch', 'H3FaceTrackCrop', 'H3InjectVideoLatent', 'H3PerFrameDenoise',
  'ImageFromBatch', 'ImageScale', 'KSamplerSelect', 'LoadAudio', 'LoadImage',
  'LoadVideo', 'LoraLoaderModelOnly', 'MiniMaxH3AddGuide', 'MiniMaxH3ImageToVideo',
  'MiniMaxH3ReferenceToVideo', 'MiniMaxH3SigmaShift', 'MiniMaxH3TurboLoRA',
  'MiniMaxH3TurboSampler', 'RandomNoise', 'SamplerCustomAdvanced', 'SaveVideo',
  'UNETLoader', 'VAEDecode', 'VAEDecodeAudio', 'VAELoader',
]);

export const managedComfyCapabilityCatalog = Object.freeze({
  'illustrious-character-v1': Object.freeze({
    workflowId: 'illustrious-character-v1',
    adapter: 'comfyui-illustrious',
    capability: 'image',
    name: 'Illustrious XL Character (Managed)',
    requiredModelRoles: Object.freeze({
      checkpoint: 'illustrious-checkpoint',
      upscaleModel: 'illustrious-upscale-model',
    }),
    requiredNodeTypes: ILLUSTRIOUS_NODES,
    loaderInputs: Object.freeze([
      Object.freeze({ nodeType: 'CheckpointLoaderSimple', input: 'ckpt_name', roles: Object.freeze(['checkpoint']) }),
      Object.freeze({ nodeType: 'UpscaleModelLoader', input: 'model_name', roles: Object.freeze(['upscaleModel']) }),
    ]),
  }),
  'minimax-h3-video-v1': Object.freeze({
    workflowId: 'minimax-h3-video-v1',
    adapter: 'comfyui-minimax-h3',
    capability: 'video',
    name: 'MiniMax H3 Video (Managed)',
    requiredModelRoles: Object.freeze({
      diffusion: 'minimax-h3-diffusion',
      referenceDiffusion: 'minimax-h3-reference-diffusion',
      textEncoder: 'minimax-h3-text-encoder',
      videoVae: 'minimax-h3-video-vae',
      audioVae: 'minimax-h3-audio-vae',
      turboDiffusionLora: 'minimax-h3-turbo-diffusion-lora',
      turboReferenceLora: 'minimax-h3-turbo-reference-lora',
      communityReferenceLora: 'minimax-h3-community-reference-lora',
    }),
    requiredNodeTypes: H3_NODES,
    loaderInputs: Object.freeze([
      Object.freeze({ nodeType: 'UNETLoader', input: 'unet_name', roles: Object.freeze(['diffusion', 'referenceDiffusion']) }),
      Object.freeze({ nodeType: 'CLIPLoader', input: 'clip_name', roles: Object.freeze(['textEncoder']) }),
      Object.freeze({ nodeType: 'VAELoader', input: 'vae_name', roles: Object.freeze(['videoVae', 'audioVae']) }),
      Object.freeze({ nodeType: 'LoraLoaderModelOnly', input: 'lora_name', roles: Object.freeze(['turboDiffusionLora', 'turboReferenceLora']) }),
      Object.freeze({ nodeType: 'MiniMaxH3TurboLoRA', input: 'lora_name', roles: Object.freeze(['communityReferenceLora']) }),
    ]),
  }),
});

function fail(message, code = 'managed_capability_invalid') {
  const error = new Error(message);
  error.name = 'ManagedComfyCapabilityError';
  error.code = code;
  throw error;
}

export function assertManagedComfyId(value, label = 'identifier') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(`${label} is invalid`, 'managed_id_invalid');
  return value;
}

function sameSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item));
}

function runtimeModelName(model) {
  const prefix = `models/${model.category}/`;
  if (!model.logicalPath.startsWith(prefix) || model.logicalPath.length === prefix.length) fail(`model ${model.id} has an invalid category path`, 'managed_model_path_invalid');
  return model.logicalPath.slice(prefix.length);
}

export function resolveManagedComfyCapabilities(manifest, receipt) {
  const ready = new Map(receipt.capabilities.map((item) => [item.id, item]));
  if (ready.get('runtime')?.state !== 'ready') fail('managed runtime is blocked', 'managed_runtime_blocked');
  const expectedReceiptIds = ['runtime', ...manifest.capabilities.map((item) => item.id)].sort();
  if (!sameSet([...ready.keys()], expectedReceiptIds)) fail('receipt capability set does not match manifest', 'managed_receipt_capabilities_mismatch');
  const workflows = new Map(manifest.workflows.map((item) => [item.id, item]));
  const models = new Map(manifest.models.map((item) => [item.id, item]));
  const projections = [];
  for (const capability of manifest.capabilities) {
    assertManagedComfyId(capability.id, 'capability id');
    const entry = managedComfyCapabilityCatalog[capability.id];
    if (!entry) fail(`capability ${capability.id} is not allowlisted`, 'managed_capability_unknown');
    if (ready.get(capability.id)?.state !== 'ready') fail(`capability ${capability.id} is blocked`, 'managed_capability_blocked');
    if (capability.workflowId !== entry.workflowId || !workflows.has(entry.workflowId)) fail(`capability ${capability.id} workflow is invalid`, 'managed_workflow_mismatch');
    const roles = Object.entries(entry.requiredModelRoles);
    const expectedModels = roles.map(([, modelId]) => modelId);
    if (!sameSet(capability.requiredModels, expectedModels)) fail(`capability ${capability.id} model roles do not match`, 'managed_model_roles_mismatch');
    const runtimeModels = {};
    for (const [role, modelId] of roles) {
      assertManagedComfyId(modelId, 'model id');
      const model = models.get(modelId);
      if (!model) fail(`required model ${modelId} is missing`, 'managed_model_missing');
      runtimeModels[role] = runtimeModelName(model);
    }
    const modelId = `managed-${manifest.bundle.id}-${capability.id}`;
    assertManagedComfyId(modelId, 'managed model id');
    projections.push({
      capabilityId: capability.id,
      workflowId: capability.workflowId,
      catalog: entry,
      workflow: workflows.get(capability.workflowId),
      runtimeModels,
      model: {
        id: modelId,
        name: entry.name,
        capability: entry.capability,
        adapter: entry.adapter,
        enabled: true,
        config: {
          managed: true,
          managedBundle: { ...manifest.bundle },
          baseUrl: 'http://127.0.0.1:8288',
          allowedWorkflowIds: [capability.workflowId],
          models: { ...runtimeModels },
          ...(entry.adapter === 'comfyui-illustrious' ? { model: runtimeModels.checkpoint, upscaleModel: runtimeModels.upscaleModel } : {}),
        },
      },
    });
  }
  return projections;
}

export function managedComfyRequiredNodeTypes(projections, workflowNodeTypes = []) {
  const result = new Set(workflowNodeTypes);
  for (const projection of projections) for (const name of projection.catalog.requiredNodeTypes) result.add(name);
  return [...result].sort();
}
