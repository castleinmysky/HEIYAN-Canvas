function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const SDXL_DIMENSIONS = Object.freeze({
  '16:9': { width: 1280, height: 720 },
  '21:9': { width: 1568, height: 672 },
  '4:3': { width: 1152, height: 864 },
  '1:1': { width: 1024, height: 1024 },
  '3:4': { width: 864, height: 1152 },
  '9:16': { width: 720, height: 1280 },
});

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function sdxlDimensions(ratio) {
  return SDXL_DIMENSIONS[String(ratio || '')] || SDXL_DIMENSIONS['3:4'];
}

function sdxlRatio(widthValue, heightValue) {
  const width = Number(widthValue);
  const height = Number(heightValue);
  if (!(width > 0 && height > 0)) return '';
  return Object.entries(SDXL_DIMENSIONS).reduce((best, [ratio, dimensions]) => {
    const distance = Math.abs((dimensions.width / dimensions.height) - (width / height));
    return !best || distance < best.distance ? { ratio, distance } : best;
  }, null)?.ratio || '';
}

function normalizedPromptPart(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, ' ');
}

export function mergeComfyUiPromptParts(...values) {
  const seen = new Set();
  return values.flatMap((value) => String(value || '').split(',')).map((part) => part.trim()).filter((part) => {
    const key = normalizedPromptPart(part);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(', ');
}

function linkedNodeId(workflow, sampler, inputName) {
  const input = Array.isArray(sampler?.inputs)
    ? sampler.inputs.find((entry) => entry?.name === inputName)
    : null;
  const linkId = input?.link;
  if (linkId === undefined || linkId === null) return null;
  const link = Array.isArray(workflow?.links)
    ? workflow.links.find((entry) => Array.isArray(entry) && entry[0] === linkId)
    : null;
  return link?.[1] ?? null;
}

function primaryPromptNodes(workflow) {
  if (!plainObject(workflow) || !Array.isArray(workflow.nodes)) return { positive: null, negative: null };
  const positiveRole = workflow.nodes.find((node) => node?.properties?.aiCanvasRole === 'positivePrompt') || null;
  const negativeRole = workflow.nodes.find((node) => node?.properties?.aiCanvasRole === 'negativePrompt') || null;
  if (positiveRole || negativeRole) return { positive: positiveRole, negative: negativeRole };
  const sampler = workflow.nodes.find((node) => ['KSampler', 'KSamplerAdvanced'].includes(String(node?.type || '')));
  if (!sampler) return { positive: null, negative: null };
  const positiveId = linkedNodeId(workflow, sampler, 'positive');
  const negativeId = linkedNodeId(workflow, sampler, 'negative');
  const nodeForId = (id) => workflow.nodes.find((node) => node?.id === id && node?.type === 'CLIPTextEncode') || null;
  return { positive: nodeForId(positiveId), negative: nodeForId(negativeId) };
}

function frontendNodeByRole(workflow, role) {
  return Array.isArray(workflow?.nodes)
    ? workflow.nodes.find((node) => node?.properties?.aiCanvasRole === role) || null
    : null;
}

function promptNodeByRole(graph, role) {
  return plainObject(graph)
    ? Object.values(graph).find((node) => node?._meta?.aiCanvasRole === role) || null
    : null;
}

function primaryFrontendSampler(workflow) {
  return plainObject(workflow) && Array.isArray(workflow.nodes)
    ? workflow.nodes.find((node) => ['KSampler', 'KSamplerAdvanced'].includes(String(node?.type || ''))) || null
    : null;
}

function frontendNodeForInput(workflow, node, inputName) {
  const id = linkedNodeId(workflow, node, inputName);
  return id === null || !Array.isArray(workflow?.nodes)
    ? null
    : workflow.nodes.find((candidate) => String(candidate?.id) === String(id)) || null;
}

function frontendOutputForLink(workflow, linkId) {
  const link = Array.isArray(workflow?.links) ? workflow.links.find((entry) => Array.isArray(entry) && entry[0] === linkId) : null;
  if (!link || !Array.isArray(workflow?.nodes)) return null;
  const node = workflow.nodes.find((candidate) => String(candidate?.id) === String(link[1]));
  const output = Array.isArray(node?.outputs) ? node.outputs[Number(link[2])] : null;
  return node && output ? { node, output, link } : null;
}

function isManagedCharacterLora(node) {
  return node?.type === 'LoraLoaderModelOnly';
}

function syncFrontendCharacterLora(workflow, sampler, loraNameValue, strengthValue) {
  if (!sampler || !Array.isArray(sampler.inputs) || !Array.isArray(workflow?.nodes) || !Array.isArray(workflow?.links)) return;
  const modelInput = sampler.inputs.find((entry) => entry?.name === 'model');
  const upstream = modelInput?.link === undefined || modelInput.link === null ? null : frontendOutputForLink(workflow, modelInput.link);
  const managed = upstream?.node && isManagedCharacterLora(upstream.node) ? upstream.node : null;
  const loraName = String(loraNameValue || '').trim();
  const strength = Math.round(boundedNumber(strengthValue, 0, 1.5, 0.8) * 100) / 100;
  if (!loraName) {
    if (!managed) return;
    const managedModelInput = managed.inputs?.find((entry) => entry?.name === 'model');
    const incomingLink = managedModelInput?.link;
    const outgoingLink = modelInput.link;
    const incoming = workflow.links.find((entry) => Array.isArray(entry) && entry[0] === incomingLink);
    if (incoming) {
      incoming[3] = sampler.id;
      incoming[4] = sampler.inputs.indexOf(modelInput);
      modelInput.link = incomingLink;
    }
    workflow.links = workflow.links.filter((entry) => !Array.isArray(entry) || entry[0] !== outgoingLink);
    workflow.nodes = workflow.nodes.filter((node) => node !== managed);
    return;
  }
  if (managed) {
    const widgets = Array.isArray(managed.widgets_values) ? [...managed.widgets_values] : [];
    widgets[0] = loraName;
    widgets[1] = strength;
    managed.widgets_values = widgets;
    return;
  }
  if (!upstream || modelInput?.link === undefined || modelInput.link === null) return;
  const nextNodeId = Math.max(0, ...workflow.nodes.map((node) => Number(node?.id)).filter(Number.isFinite)) + 1;
  const nextLinkId = Math.max(0, ...workflow.links.map((link) => Number(Array.isArray(link) ? link[0] : 0)).filter(Number.isFinite)) + 1;
  const sourceLink = upstream.link;
  sourceLink[3] = nextNodeId;
  sourceLink[4] = 0;
  const samplerInputIndex = sampler.inputs.indexOf(modelInput);
  workflow.links.push([nextLinkId, nextNodeId, 0, sampler.id, samplerInputIndex, 'MODEL']);
  modelInput.link = nextLinkId;
  const sourcePosition = Array.isArray(upstream.node.pos) ? upstream.node.pos : [0, 0];
  const samplerPosition = Array.isArray(sampler.pos) ? sampler.pos : [360, 0];
  workflow.nodes.push({
    id: nextNodeId,
    type: 'LoraLoaderModelOnly',
    pos: [Math.round((Number(sourcePosition[0]) + Number(samplerPosition[0])) / 2), Math.round((Number(sourcePosition[1]) + Number(samplerPosition[1])) / 2)],
    size: [320, 110], flags: {}, order: Math.max(0, Number(sampler.order) || 0), mode: 0,
    inputs: [{ name: 'model', type: 'MODEL', link: sourceLink[0] }],
    outputs: [{ name: 'MODEL', type: 'MODEL', links: [nextLinkId] }],
    title: 'AI Canvas · 人物刻画 LoRA',
    properties: { 'Node name for S&R': 'LoraLoaderModelOnly', aiCanvasRole: 'characterLora' },
    widgets_values: [loraName, strength],
  });
  workflow.last_node_id = Math.max(Number(workflow.last_node_id) || 0, nextNodeId);
  workflow.last_link_id = Math.max(Number(workflow.last_link_id) || 0, nextLinkId);
}

function primaryPromptSampler(graph) {
  return plainObject(graph)
    ? Object.entries(graph).find(([, node]) => node?.class_type === 'KSampler' && plainObject(node.inputs)) || null
    : null;
}

function promptNodeForInput(graph, sampler, inputName) {
  const link = sampler?.inputs?.[inputName];
  const id = Array.isArray(link) && link.length >= 2 ? String(link[0]) : '';
  return id && plainObject(graph?.[id]) ? graph[id] : null;
}

function promptText(node) {
  return Array.isArray(node?.widgets_values) ? String(node.widgets_values[0] || '').trim() : '';
}

function setPromptText(node, value) {
  if (!node) return;
  const widgets = Array.isArray(node.widgets_values) ? [...node.widgets_values] : [];
  widgets[0] = String(value || '').trim();
  node.widgets_values = widgets;
}

export function applyComfyUiCanvasPromptsToWorkflow(workflow, {
  positivePrompt = '',
  negativePrompt = '',
  positivePrefix = '',
} = {}) {
  const next = cloneJson(workflow);
  const nodes = primaryPromptNodes(next);
  setPromptText(nodes.positive, mergeComfyUiPromptParts(positivePrefix, positivePrompt));
  setPromptText(nodes.negative, negativePrompt);
  return next;
}

export function extractComfyUiCanvasPromptsFromWorkflow(workflow) {
  const nodes = primaryPromptNodes(workflow);
  return {
    positivePrompt: promptText(nodes.positive),
    negativePrompt: promptText(nodes.negative),
  };
}

export function stripComfyUiPromptPrefix(prompt, prefix) {
  const value = String(prompt || '').trim();
  const leading = String(prefix || '').trim().replace(/[\s,，]+$/g, '');
  if (!leading) return value;
  if (value.toLocaleLowerCase().startsWith(leading.toLocaleLowerCase())) {
    const remainder = value.slice(leading.length);
    if (!remainder || /^[\s,，]/.test(remainder)) return remainder.replace(/^[\s,，]+/g, '').trim();
  }
  return value;
}

export function applyComfyUiCanvasStateToWorkflow(workflow, state = {}) {
  const next = applyComfyUiCanvasPromptsToWorkflow(workflow, state);
  const referenceImage = frontendNodeByRole(next, 'referenceImage');
  if (referenceImage?.type === 'LoadImage' && String(state.referenceImage || '').trim()) {
    const widgets = Array.isArray(referenceImage.widgets_values) ? [...referenceImage.widgets_values] : [];
    widgets[0] = String(state.referenceImage).trim().slice(0, 260);
    referenceImage.widgets_values = widgets;
  }
  const maskImage = frontendNodeByRole(next, 'maskImage');
  if (maskImage?.type === 'LoadImage' && String(state.maskImage || '').trim()) {
    const widgets = Array.isArray(maskImage.widgets_values) ? [...maskImage.widgets_values] : [];
    widgets[0] = String(state.maskImage).trim().slice(0, 260);
    maskImage.widgets_values = widgets;
  }
  const sampler = primaryFrontendSampler(next);
  if (sampler?.type === 'KSampler') {
    const widgets = Array.isArray(sampler.widgets_values) ? [...sampler.widgets_values] : [];
    const fixedSeed = state.comfySeedMode === 'fixed' && Number.isInteger(Number(state.seed)) && Number(state.seed) >= 0;
    if (fixedSeed) widgets[0] = Number(state.seed);
    widgets[1] = fixedSeed ? 'fixed' : 'randomize';
    widgets[2] = Math.round(boundedNumber(state.comfySteps, 1, 100, Number(widgets[2]) || 28));
    widgets[3] = Math.round(boundedNumber(state.comfyCfg, 1, 30, Number(widgets[3]) || 5.5) * 10) / 10;
    if (String(state.comfySampler || '').trim()) widgets[4] = String(state.comfySampler).trim();
    if (String(state.comfyScheduler || '').trim()) widgets[5] = String(state.comfyScheduler).trim();
    if (Number.isFinite(Number(state.comfyDenoise))) widgets[6] = Math.round(boundedNumber(state.comfyDenoise, 0.05, 1, 1) * 100) / 100;
    sampler.widgets_values = widgets;
  }
  const seedNode = frontendNodeByRole(next, 'seed');
  const cfgNode = frontendNodeByRole(next, 'cfg');
  const samplerNode = frontendNodeByRole(next, 'sampler');
  const schedulerNode = frontendNodeByRole(next, 'scheduler');
  const fixedSeed = state.comfySeedMode === 'fixed' && Number.isInteger(Number(state.seed)) && Number(state.seed) >= 0;
  if (seedNode?.type === 'RandomNoise') {
    const widgets = Array.isArray(seedNode.widgets_values) ? [...seedNode.widgets_values] : [];
    if (fixedSeed) widgets[0] = Number(state.seed);
    widgets[1] = fixedSeed ? 'fixed' : 'randomize';
    seedNode.widgets_values = widgets;
  }
  if (cfgNode?.type === 'CFGGuider') {
    const widgets = Array.isArray(cfgNode.widgets_values) ? [...cfgNode.widgets_values] : [];
    widgets[0] = Math.round(boundedNumber(state.comfyCfg, 0, 30, Number(widgets[0]) || 3.5) * 10) / 10;
    cfgNode.widgets_values = widgets;
  }
  if (samplerNode?.type === 'KSamplerSelect' && String(state.comfySampler || '').trim()) samplerNode.widgets_values = [String(state.comfySampler).trim()];
  if (schedulerNode?.type === 'Flux2Scheduler') {
    const dimensions = sdxlDimensions(state.ratio);
    const widgets = Array.isArray(schedulerNode.widgets_values) ? [...schedulerNode.widgets_values] : [];
    widgets[0] = Math.round(boundedNumber(state.comfySteps, 1, 100, Number(widgets[0]) || 20));
    widgets[1] = dimensions.width;
    widgets[2] = dimensions.height;
    schedulerNode.widgets_values = widgets;
  }
  const latent = (sampler ? frontendNodeForInput(next, sampler, 'latent_image') : null) || frontendNodeByRole(next, 'latent');
  if (['EmptyLatentImage', 'EmptySD3LatentImage', 'EmptyFlux2LatentImage'].includes(String(latent?.type || ''))) {
    const dimensions = sdxlDimensions(state.ratio);
    const widgets = Array.isArray(latent.widgets_values) ? [...latent.widgets_values] : [];
    widgets[0] = dimensions.width;
    widgets[1] = dimensions.height;
    // AI Canvas emits count as separate queued outputs. Keep the ComfyUI batch at one
    // so changing the outer count never multiplies the result count twice.
    widgets[2] = 1;
    latent.widgets_values = widgets;
  }
  if (String(state.checkpoint || '').trim() && Array.isArray(next.nodes)) {
    const loader = next.nodes.find((node) => ['CheckpointLoaderSimple', 'CheckpointLoader'].includes(String(node?.type || '')));
    if (loader) {
      const widgets = Array.isArray(loader.widgets_values) ? [...loader.widgets_values] : [];
      widgets[0] = String(state.checkpoint).trim();
      loader.widgets_values = widgets;
    }
  }
  syncFrontendCharacterLora(next, sampler, state.characterLora, state.characterLoraStrength);
  return next;
}

export function extractComfyUiCanvasStateFromWorkflow(workflow) {
  const prompts = extractComfyUiCanvasPromptsFromWorkflow(workflow);
  const sampler = primaryFrontendSampler(workflow);
  const widgets = sampler?.type === 'KSampler' && Array.isArray(sampler.widgets_values) ? sampler.widgets_values : [];
  const latent = (sampler ? frontendNodeForInput(workflow, sampler, 'latent_image') : null) || frontendNodeByRole(workflow, 'latent');
  const latentWidgets = ['EmptyLatentImage', 'EmptySD3LatentImage', 'EmptyFlux2LatentImage'].includes(String(latent?.type || '')) && Array.isArray(latent.widgets_values) ? latent.widgets_values : [];
  const modelInput = Array.isArray(sampler?.inputs) ? sampler.inputs.find((entry) => entry?.name === 'model') : null;
  const modelSource = modelInput?.link === undefined || modelInput.link === null ? null : frontendOutputForLink(workflow, modelInput.link)?.node;
  const loraWidgets = modelSource?.type === 'LoraLoaderModelOnly' && Array.isArray(modelSource.widgets_values) ? modelSource.widgets_values : [];
  const customSeedWidgets = frontendNodeByRole(workflow, 'seed')?.widgets_values || [];
  const customCfgWidgets = frontendNodeByRole(workflow, 'cfg')?.widgets_values || [];
  const customSamplerWidgets = frontendNodeByRole(workflow, 'sampler')?.widgets_values || [];
  const customSchedulerWidgets = frontendNodeByRole(workflow, 'scheduler')?.widgets_values || [];
  const seedWidgets = widgets.length ? widgets : customSeedWidgets;
  const seedMode = seedWidgets[1] === 'fixed' ? 'fixed' : 'random';
  return {
    ...prompts,
    // The latent size identifies aspect ratio, not the final 1K/2K/4K output.
    // Output upscaling is injected at execution time, so editor saves must not
    // silently downgrade the outer node's selected resolution to 1K.
    ...(sdxlRatio(latentWidgets[0], latentWidgets[1]) ? { ratio: sdxlRatio(latentWidgets[0], latentWidgets[1]) } : {}),
    comfySeedMode: seedMode,
    ...(seedMode === 'fixed' && Number.isInteger(Number(seedWidgets[0])) ? { seed: Number(seedWidgets[0]) } : {}),
    ...(Number.isFinite(Number(widgets[2] ?? customSchedulerWidgets[0])) ? { comfySteps: Math.round(boundedNumber(widgets[2] ?? customSchedulerWidgets[0], 1, 100, 28)) } : {}),
    ...(Number.isFinite(Number(widgets[3] ?? customCfgWidgets[0])) ? { comfyCfg: Math.round(boundedNumber(widgets[3] ?? customCfgWidgets[0], 0, 30, 5.5) * 10) / 10 } : {}),
    ...(String(widgets[4] ?? customSamplerWidgets[0] ?? '').trim() ? { comfySampler: String(widgets[4] ?? customSamplerWidgets[0]).trim().slice(0, 80) } : {}),
    ...(String(widgets[5] || '').trim() ? { comfyScheduler: String(widgets[5]).trim().slice(0, 80) } : {}),
    ...(Number.isFinite(Number(widgets[6])) ? { comfyDenoise: Math.round(boundedNumber(widgets[6], 0.05, 1, 1) * 100) / 100 } : {}),
    characterLora: String(loraWidgets[0] || '').trim().slice(0, 180),
    characterLoraStrength: Math.round(boundedNumber(loraWidgets[1], 0, 1.5, 0.8) * 100) / 100,
  };
}

export function applyComfyUiCanvasStateToPrompt(prompt, state = {}) {
  if (!plainObject(prompt)) return null;
  const next = cloneJson(prompt);
  const samplerEntry = primaryPromptSampler(next);
  const sampler = samplerEntry?.[1] || null;
  if (sampler) {
    const fixedSeed = state.comfySeedMode === 'fixed' && Number.isInteger(Number(state.seed)) && Number(state.seed) >= 0;
    if (fixedSeed && Object.hasOwn(sampler.inputs, 'seed')) sampler.inputs.seed = Number(state.seed);
    if (Object.hasOwn(sampler.inputs, 'steps')) sampler.inputs.steps = Math.round(boundedNumber(state.comfySteps, 1, 100, Number(sampler.inputs.steps) || 28));
    if (Object.hasOwn(sampler.inputs, 'cfg')) sampler.inputs.cfg = Math.round(boundedNumber(state.comfyCfg, 1, 30, Number(sampler.inputs.cfg) || 5.5) * 10) / 10;
    if (String(state.comfySampler || '').trim() && Object.hasOwn(sampler.inputs, 'sampler_name')) sampler.inputs.sampler_name = String(state.comfySampler).trim();
    if (String(state.comfyScheduler || '').trim() && Object.hasOwn(sampler.inputs, 'scheduler')) sampler.inputs.scheduler = String(state.comfyScheduler).trim();
    if (Number.isFinite(Number(state.comfyDenoise)) && Object.hasOwn(sampler.inputs, 'denoise')) sampler.inputs.denoise = Math.round(boundedNumber(state.comfyDenoise, 0.05, 1, 1) * 100) / 100;
    const positive = promptNodeForInput(next, sampler, 'positive');
    const negative = promptNodeForInput(next, sampler, 'negative');
    if (positive?.class_type === 'CLIPTextEncode' && plainObject(positive.inputs)) positive.inputs.text = mergeComfyUiPromptParts(state.positivePrefix, state.positivePrompt);
    if (negative?.class_type === 'CLIPTextEncode' && plainObject(negative.inputs)) negative.inputs.text = String(state.negativePrompt || '').trim();
    const latent = promptNodeForInput(next, sampler, 'latent_image');
    if (latent?.class_type === 'EmptyLatentImage' && plainObject(latent.inputs)) {
      const dimensions = sdxlDimensions(state.ratio);
      latent.inputs.width = dimensions.width;
      latent.inputs.height = dimensions.height;
      latent.inputs.batch_size = 1;
    }
  }
  const fixedSeed = state.comfySeedMode === 'fixed' && Number.isInteger(Number(state.seed)) && Number(state.seed) >= 0;
  const positiveRole = promptNodeByRole(next, 'positivePrompt');
  const negativeRole = promptNodeByRole(next, 'negativePrompt');
  const referenceImageRole = promptNodeByRole(next, 'referenceImage');
  const maskImageRole = promptNodeByRole(next, 'maskImage');
  if (positiveRole?.class_type === 'CLIPTextEncode' && plainObject(positiveRole.inputs)) positiveRole.inputs.text = mergeComfyUiPromptParts(state.positivePrefix, state.positivePrompt);
  if (negativeRole?.class_type === 'CLIPTextEncode' && plainObject(negativeRole.inputs)) negativeRole.inputs.text = String(state.negativePrompt || '').trim();
  if (positiveRole?.class_type === 'TextEncodeQwenImageEditPlus' && plainObject(positiveRole.inputs)) positiveRole.inputs.prompt = mergeComfyUiPromptParts(state.positivePrefix, state.positivePrompt);
  if (negativeRole?.class_type === 'TextEncodeQwenImageEditPlus' && plainObject(negativeRole.inputs)) negativeRole.inputs.prompt = String(state.negativePrompt || '').trim();
  if (referenceImageRole?.class_type === 'LoadImage' && plainObject(referenceImageRole.inputs) && String(state.referenceImage || '').trim()) {
    referenceImageRole.inputs.image = String(state.referenceImage).trim().slice(0, 260);
  }
  if (maskImageRole?.class_type === 'LoadImage' && plainObject(maskImageRole.inputs) && String(state.maskImage || '').trim()) {
    maskImageRole.inputs.image = String(state.maskImage).trim().slice(0, 260);
  }
  const seedNode = promptNodeByRole(next, 'seed');
  if (fixedSeed && seedNode?.class_type === 'RandomNoise' && plainObject(seedNode.inputs)) seedNode.inputs.noise_seed = Number(state.seed);
  const cfgNode = promptNodeByRole(next, 'cfg');
  if (cfgNode?.class_type === 'CFGGuider' && plainObject(cfgNode.inputs)) cfgNode.inputs.cfg = Math.round(boundedNumber(state.comfyCfg, 0, 30, Number(cfgNode.inputs.cfg) || 3.5) * 10) / 10;
  const samplerNode = promptNodeByRole(next, 'sampler');
  if (samplerNode?.class_type === 'KSamplerSelect' && String(state.comfySampler || '').trim()) samplerNode.inputs.sampler_name = String(state.comfySampler).trim();
  const schedulerNode = promptNodeByRole(next, 'scheduler');
  if (schedulerNode?.class_type === 'Flux2Scheduler' && plainObject(schedulerNode.inputs)) {
    const dimensions = sdxlDimensions(state.ratio);
    schedulerNode.inputs.steps = Math.round(boundedNumber(state.comfySteps, 1, 100, Number(schedulerNode.inputs.steps) || 20));
    schedulerNode.inputs.width = dimensions.width;
    schedulerNode.inputs.height = dimensions.height;
  }
  const latentRole = promptNodeByRole(next, 'latent');
  if (['EmptyLatentImage', 'EmptySD3LatentImage', 'EmptyFlux2LatentImage'].includes(String(latentRole?.class_type || '')) && plainObject(latentRole.inputs)) {
    const dimensions = sdxlDimensions(state.ratio);
    latentRole.inputs.width = dimensions.width; latentRole.inputs.height = dimensions.height; latentRole.inputs.batch_size = 1;
  }
  if (String(state.checkpoint || '').trim()) {
    Object.values(next).forEach((node) => {
      if (['CheckpointLoaderSimple', 'CheckpointLoader'].includes(String(node?.class_type || '')) && plainObject(node.inputs) && Object.hasOwn(node.inputs, 'ckpt_name')) {
        node.inputs.ckpt_name = String(state.checkpoint).trim();
      }
    });
  }
  return next;
}
