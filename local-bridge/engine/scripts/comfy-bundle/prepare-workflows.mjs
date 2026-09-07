const API_NODE_ID = /^\d+$/;

function fail(message) {
  const error = new Error(message);
  error.name = 'ManagedComfyWorkflowPreparationError';
  error.code = 'workflow_prepare_invalid';
  throw error;
}

function assert(value, message) {
  if (!value) fail(message);
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isApiGraph(value) {
  const entries = plainObject(value) ? Object.entries(value) : [];
  return entries.length > 0 && entries.every(([id, node]) => API_NODE_ID.test(id)
    && plainObject(node)
    && typeof node.class_type === 'string'
    && plainObject(node.inputs));
}

function nodesOf(graph) {
  assert(plainObject(graph) && Array.isArray(graph.nodes) && Array.isArray(graph.links), 'workflow must be a ComfyUI UI graph');
  return graph.nodes;
}

function oneNode(nodes, type) {
  const matches = nodes.filter((node) => plainObject(node) && node.type === type);
  assert(matches.length === 1, `workflow must contain exactly one ${type} node`);
  return matches[0];
}

function widget(node, index, predicate, label) {
  const value = Array.isArray(node.widgets_values) ? node.widgets_values[index] : undefined;
  assert(predicate(value), `${label} widget is invalid`);
  return value;
}

function finiteInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function planModelNames(plan) {
  assert(plainObject(plan) && Array.isArray(plan.models), 'managed plan is invalid');
  return new Set(plan.models.map((model) => {
    assert(plainObject(model) && typeof model.logicalPath === 'string', 'managed plan model is invalid');
    const parts = model.logicalPath.split('/');
    assert(parts.length > 1 && parts.every(Boolean), 'managed plan model path is invalid');
    return parts.slice(1).join('/');
  }));
}

function declaredModel(node, index, allowed, label) {
  const value = widget(node, index, (item) => typeof item === 'string' && allowed.has(item), label);
  return value;
}

function hasUiLink(graph, originId, originSlot, targetId, targetSlot, type) {
  return graph.links.some((link) => Array.isArray(link)
    && link.length === 6
    && link[1] === originId
    && link[2] === originSlot
    && link[3] === targetId
    && link[4] === targetSlot
    && link[5] === type);
}

function hasSubgraphLink(graph, originId, originSlot, targetId, targetSlot, type) {
  return graph.links.some((link) => plainObject(link)
    && link.origin_id === originId
    && link.origin_slot === originSlot
    && link.target_id === targetId
    && link.target_slot === targetSlot
    && link.type === type);
}

function meta(aiCanvasRole) {
  return { aiCanvasRole };
}

function prepareIllustrious(workflow, plan) {
  const nodes = nodesOf(workflow);
  const allowedModels = planModelNames(plan);
  const loader = oneNode(nodes, 'CheckpointLoaderSimple');
  const textNodes = nodes.filter((node) => node?.type === 'CLIPTextEncode');
  assert(textNodes.length === 2, 'Illustrious workflow must contain two CLIPTextEncode nodes');
  const latent = oneNode(nodes, 'EmptyLatentImage');
  const sampler = oneNode(nodes, 'KSampler');
  const decode = oneNode(nodes, 'VAEDecode');
  const save = oneNode(nodes, 'SaveImage');
  const positive = textNodes.find((node) => hasUiLink(workflow, node.id, 0, sampler.id, 1, 'CONDITIONING'));
  const negative = textNodes.find((node) => hasUiLink(workflow, node.id, 0, sampler.id, 2, 'CONDITIONING'));
  assert(positive && negative && positive !== negative, 'Illustrious prompt links are invalid');
  assert(hasUiLink(workflow, loader.id, 0, sampler.id, 0, 'MODEL')
    && hasUiLink(workflow, latent.id, 0, sampler.id, 3, 'LATENT')
    && hasUiLink(workflow, sampler.id, 0, decode.id, 0, 'LATENT')
    && hasUiLink(workflow, loader.id, 2, decode.id, 1, 'VAE')
    && hasUiLink(workflow, decode.id, 0, save.id, 0, 'IMAGE'), 'Illustrious generation links are invalid');

  const samplerWidgets = Array.isArray(sampler.widgets_values) ? sampler.widgets_values : [];
  const ckptName = declaredModel(loader, 0, allowedModels, 'Illustrious checkpoint');
  const width = widget(latent, 0, (value) => finiteInteger(value, 64, 16384), 'Illustrious width');
  const height = widget(latent, 1, (value) => finiteInteger(value, 64, 16384), 'Illustrious height');
  const batchSize = widget(latent, 2, (value) => finiteInteger(value, 1, 64), 'Illustrious batch size');
  assert(finiteInteger(samplerWidgets[0], 0, Number.MAX_SAFE_INTEGER), 'Illustrious seed is invalid');
  assert(finiteInteger(samplerWidgets[2], 1, 10_000), 'Illustrious steps are invalid');
  assert(typeof samplerWidgets[3] === 'number' && Number.isFinite(samplerWidgets[3]), 'Illustrious cfg is invalid');
  assert(typeof samplerWidgets[4] === 'string' && typeof samplerWidgets[5] === 'string', 'Illustrious sampler enums are invalid');
  assert(typeof samplerWidgets[6] === 'number' && Number.isFinite(samplerWidgets[6]), 'Illustrious denoise is invalid');

  return {
    workflow: {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckptName }, _meta: meta('modelLoader') },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] }, _meta: meta('positivePrompt') },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] }, _meta: meta('negativePrompt') },
      '4': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: batchSize }, _meta: meta('outputCanvas') },
      '5': {
        class_type: 'KSampler',
        inputs: {
          seed: samplerWidgets[0], steps: samplerWidgets[2], cfg: samplerWidgets[3],
          sampler_name: samplerWidgets[4], scheduler: samplerWidgets[5], denoise: samplerWidgets[6],
          model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
        },
        _meta: meta('primarySampler'),
      },
      '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
      '7': { class_type: 'SaveImage', inputs: { filename_prefix: '', images: ['6', 0] }, _meta: meta('output') },
    },
    changes: ['private_values_redacted', 'ui_graph_normalized', 'ui_only_nodes_removed'],
  };
}

function h3FrameCount(duration) {
  let frames = Math.max(5, Math.round(duration * 24));
  while (frames % 17 !== 5) frames += 1;
  return frames;
}

function prepareH3(workflow, plan) {
  const nodes = nodesOf(workflow);
  const allowedModels = planModelNames(plan);
  const definitions = workflow.definitions;
  assert(plainObject(definitions) && Array.isArray(definitions.subgraphs) && definitions.subgraphs.length === 1, 'H3 workflow subgraph declaration is invalid');
  const subgraph = definitions.subgraphs[0];
  const subgraphNodes = nodesOf(subgraph);
  assert(typeof subgraph.id === 'string', 'H3 subgraph id is invalid');
  const instance = oneNode(nodes, subgraph.id);
  const loadImage = oneNode(nodes, 'LoadImage');
  const parts = oneNode(nodes, 'GetVideoComponents');
  const topaz = oneNode(nodes, 'TopazStarlight');
  const rebuild = oneNode(nodes, 'CreateVideo');
  const save = oneNode(nodes, 'SaveVideo');
  assert(hasUiLink(workflow, loadImage.id, 0, instance.id, 0, 'IMAGE'), 'H3 image input link is invalid');
  assert(hasUiLink(workflow, instance.id, 0, parts.id, 0, 'VIDEO')
    && hasUiLink(workflow, parts.id, 0, topaz.id, 0, 'IMAGE')
    && hasUiLink(workflow, topaz.id, 0, rebuild.id, 0, 'IMAGE')
    && hasUiLink(workflow, parts.id, 2, rebuild.id, 1, 'FLOAT')
    && hasUiLink(workflow, parts.id, 1, rebuild.id, 2, 'AUDIO')
    && hasUiLink(workflow, parts.id, 3, rebuild.id, 3, 'INT')
    && hasUiLink(workflow, rebuild.id, 0, save.id, 0, 'VIDEO'), 'H3 Topaz post-process chain is invalid');

  const innerVideo = oneNode(subgraphNodes, 'VAEDecode');
  const innerAudio = oneNode(subgraphNodes, 'VAEDecodeAudio');
  const innerCreate = oneNode(subgraphNodes, 'CreateVideo');
  assert(hasSubgraphLink(subgraph, innerVideo.id, 0, innerCreate.id, 0, 'IMAGE')
    && hasSubgraphLink(subgraph, innerAudio.id, 0, innerCreate.id, 1, 'AUDIO'), 'H3 native audio/video links are invalid');

  const promptWidgets = Array.isArray(instance.widgets_values) ? instance.widgets_values : [];
  assert(typeof promptWidgets[0] === 'string', 'H3 prompt widget is invalid');
  const width = widget(instance, 1, (value) => finiteInteger(value, 64, 16384), 'H3 width');
  const height = widget(instance, 2, (value) => finiteInteger(value, 64, 16384), 'H3 height');
  const duration = widget(instance, 3, (value) => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 300, 'H3 duration');
  const seed = widget(instance, 4, (value) => finiteInteger(value, 0, Number.MAX_SAFE_INTEGER), 'H3 seed');
  const diffusion = declaredModel(instance, 5, allowedModels, 'H3 diffusion model');
  const textEncoder = declaredModel(instance, 6, allowedModels, 'H3 text encoder');
  const videoVae = declaredModel(instance, 7, allowedModels, 'H3 video VAE');
  const audioVae = declaredModel(instance, 8, allowedModels, 'H3 audio VAE');
  const innerSampler = oneNode(subgraphNodes, 'KSamplerSelect');
  const innerScheduler = oneNode(subgraphNodes, 'BasicScheduler');
  const samplerName = widget(innerSampler, 0, (value) => value === 'res_multistep', 'H3 sampler');
  const schedulerName = widget(innerScheduler, 0, (value) => value === 'simple', 'H3 scheduler');
  const steps = widget(innerScheduler, 1, (value) => finiteInteger(value, 1, 10_000), 'H3 steps');
  const denoise = widget(innerScheduler, 2, (value) => typeof value === 'number' && Number.isFinite(value), 'H3 denoise');

  return {
    workflow: {
      '1': { class_type: 'UNETLoader', inputs: { unet_name: diffusion, weight_dtype: 'default' }, _meta: meta('modelLoader') },
      '2': { class_type: 'CLIPLoader', inputs: { clip_name: textEncoder, type: 'minimax', device: 'default' }, _meta: meta('textEncoder') },
      '3': { class_type: 'VAELoader', inputs: { vae_name: videoVae }, _meta: meta('videoVae') },
      '4': { class_type: 'VAELoader', inputs: { vae_name: audioVae }, _meta: meta('audioVae') },
      '5': {
        class_type: 'MiniMaxH3ImageToVideo',
        inputs: { clip: ['2', 0], vae: ['3', 0], prompt: '', width, height, length: h3FrameCount(duration), first_frame: ['22', 0] },
        _meta: meta('positivePrompt'),
      },
      '6': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
      '7': { class_type: 'KSamplerSelect', inputs: { sampler_name: samplerName } },
      '8': { class_type: 'BasicScheduler', inputs: { model: ['1', 0], scheduler: schedulerName, steps, denoise } },
      '9': { class_type: 'BasicGuider', inputs: { model: ['1', 0], conditioning: ['5', 0] } },
      '10': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['6', 0], guider: ['9', 0], sampler: ['7', 0], sigmas: ['8', 0], latent_image: ['5', 1] } },
      '11': { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['3', 0] } },
      '12': { class_type: 'VAEDecodeAudio', inputs: { samples: ['10', 0], vae: ['4', 0] } },
      '13': { class_type: 'CreateVideo', inputs: { images: ['11', 0], fps: 24, bit_depth: 8, audio: ['12', 0] } },
      '14': { class_type: 'SaveVideo', inputs: { video: ['13', 0], filename_prefix: '' }, _meta: meta('output') },
      '20': { class_type: 'LoadImage', inputs: { image: '' }, _meta: meta('firstFrame') },
      '22': { class_type: 'ImageScale', inputs: { image: ['20', 0], upscale_method: 'lanczos', width, height, crop: 'center' } },
    },
    changes: ['private_values_redacted', 'topaz_optional_bypassed', 'ui_graph_normalized', 'ui_only_nodes_removed'],
  };
}

export function prepareManagedWorkflow(workflow, { capabilityId, plan } = {}) {
  assert(typeof capabilityId === 'string', 'capabilityId is required');
  if (isApiGraph(workflow)) return { workflow: structuredClone(workflow), changes: [] };
  if (plainObject(workflow) && Array.isArray(workflow.nodes) && workflow.id === undefined && workflow.revision === undefined && workflow.definitions === undefined) {
    return { workflow: structuredClone(workflow), changes: [] };
  }
  if (capabilityId === 'illustrious-character-v1') return prepareIllustrious(workflow, plan);
  if (capabilityId === 'minimax-h3-video-v1') return prepareH3(workflow, plan);
  fail(`unsupported managed capability: ${capabilityId}`);
}
