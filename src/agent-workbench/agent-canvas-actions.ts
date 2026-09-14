import type { Edge } from '@xyflow/react';
import type { CanvasNode, CanvasNodeData, ModelInfo } from '../components/CanvasNodes';
import { agentNodeSettings, canvasCapabilities, validateCanvasAction } from '../../server/agent-capabilities.js';
import type { AgentProposal } from '../../server/agent-contract.js';

export type CanvasActionHost = {
  nodes: () => CanvasNode[]; edges: () => Edge[]; models: () => ModelInfo[];
  check: (revision?: string) => void;
  commit: (nodes: CanvasNode[], edges: Edge[]) => void;
  save: () => Promise<void>;
  perform: Record<string, (args: Record<string, any>) => unknown | Promise<unknown>>;
};
export type CanvasJobActionOutcome = {
  ok: boolean;
  action: 'cancel' | 'resume' | 'retry';
  previousJobId: string;
  jobId?: string;
  previousState?: string;
  state?: string;
  changed: boolean;
  reason?: 'missing' | 'declined' | 'failed' | 'unchanged';
  message?: string;
};

export function requireCanvasJobActionOutcome(outcome: CanvasJobActionOutcome, action: CanvasJobActionOutcome['action']) {
  if (outcome.action !== action) throw Error('任务操作回执与请求不匹配');
  if (!outcome.ok) throw Error(outcome.message || (outcome.reason === 'declined' ? '用户已取消任务操作' : '任务操作没有完成'));
  if (!outcome.jobId || !outcome.state || !outcome.changed) throw Error('任务状态没有变化，不能记录为已完成');
  if (action === 'retry' && outcome.jobId === outcome.previousJobId) throw Error('重试没有取得新的任务编号，不能记录为已提交');
  if (action !== 'retry' && outcome.jobId !== outcome.previousJobId) throw Error('任务编号发生意外变化，请重新读取任务');
  return { action, jobId: outcome.jobId, state: outcome.state, previousState: outcome.previousState, changed: true };
}
const active = (n: CanvasNode) => ['queued', 'running', 'cancelling'].includes(String(n.data.jobState)) || ['running', 'cancelling'].includes(String(n.data.workflowState));
const comfySamplingKey = { steps: 'comfySteps', cfg: 'comfyCfg', sampler: 'comfySampler', scheduler: 'comfyScheduler' } as const;
const tripoInputModes = ['text', 'image', 'imageToMultiview', 'imageToMultiviewToModel', 'multiview'] as const;
const generatorCapability = (node: CanvasNode) => node.data.kind === 'imageGenerator' ? 'image'
  : node.data.kind === 'videoGenerator' ? 'video'
    : node.data.kind === 'audioGenerator' ? 'audio'
      : node.data.kind === 'modelGenerator' ? 'model'
        : node.data.kind === 'comfyUiWorkflow' ? 'image' : '';
type SettingRule = { type?: string; enum?: unknown[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; note?: string };
export type NodeSettingsSupport = { adapter: string; workflowId?: string; keys: string[]; values: Record<string, SettingRule> };
const tripoP1 = (model: ModelInfo) => /(?:^|[^a-z0-9])p1(?:[^a-z0-9]|$)|p1-2026/i.test(`${model.id} ${model.name}`);
const schemaRule = (key: string): SettingRule => {
  const schema = agentNodeSettings[key] as SettingRule | undefined;
  return schema ? { ...schema, ...(schema.enum ? { enum: [...schema.enum] } : {}) } : {};
};
const addProfileRules = (values: Record<string, SettingRule>, model: ModelInfo, fields: Array<'ratio' | 'resolution' | 'count' | 'duration'>) => {
  const profile = model.profile;
  if (!profile) return;
  if (fields.includes('ratio')) values.ratio = { type: 'string', enum: [...profile.ratios] };
  if (fields.includes('resolution')) values.resolution = { type: 'string', enum: [...profile.resolutions] };
  if (fields.includes('count')) values.count = { type: 'integer', minimum: profile.count.min, maximum: profile.count.max };
  if (fields.includes('duration')) values.duration = { type: 'integer', minimum: profile.duration.min, maximum: profile.duration.max };
};
const addRules = (values: Record<string, SettingRule>, keys: string[]) => keys.forEach(key => { values[key] = schemaRule(key); });
const tightenComfyRules = (values: Record<string, SettingRule>, model: ModelInfo) => {
  if (values.comfySteps) Object.assign(values.comfySteps, { minimum: 1, maximum: 100 });
  if (values.comfyCfg) Object.assign(values.comfyCfg, { minimum: 1, maximum: 30 });
  for (const key of ['comfyDenoise', 'referenceDenoise']) if (values[key]) Object.assign(values[key], { minimum: .05, maximum: 1 });
  if (values.comfySampler) values.comfySampler.enum = [...new Set([model.comfyDefaults?.sampler, 'dpmpp_2m_sde', 'dpmpp_2m', 'euler_ancestral', 'euler'].filter(Boolean))];
  if (values.comfyScheduler) values.comfyScheduler.enum = [...new Set([model.comfyDefaults?.scheduler, 'karras', 'normal', 'simple', 'sgm_uniform'].filter(Boolean))];
};
const comfyVariation = (model: ModelInfo, workflow?: NonNullable<ModelInfo['workflow']>) => {
  if (workflow?.samplingControls?.variation) return workflow.samplingControls.variation;
  const imagePort = workflow?.inputPorts?.find(port => port.accepts.includes('image') && ['image-to-image', 'native-multimodal', 'inpaint-source'].includes(String(port.bindingMethod || '')))?.id
    || (model.localImageFamily === 'qwen-image-edit-2511' || model.localImageFamily === 'anima-base-v1' && workflow?.id === 'anima-base-v1-inpaint-v1' ? 'reference' : '');
  return imagePort ? { field: 'referenceDenoise' as const, requiresImagePort: imagePort, defaultValue: .72 } : undefined;
};

export function settingsSupportForModel(model: ModelInfo, nodeKind: CanvasNodeData['kind'], workflow?: NonNullable<ModelInfo['workflow']>, current: Partial<CanvasNodeData> = {}): NodeSettingsSupport {
  const values: Record<string, SettingRule> = {};
  addRules(values, ['generatorPanelDock']);
  const adapter = String(model.adapter || '');
  if (nodeKind === 'comfyUiWorkflow') {
    addProfileRules(values, model, ['ratio', 'resolution', 'count']);
    addRules(values, ['negativePrompt', 'comfySeedMode', 'seed']);
    const advanced = workflow?.samplingControls?.advanced || (model.localImageFamily === 'flux2-klein' ? ['steps', 'cfg', 'sampler'] : ['steps', 'cfg', 'sampler', 'scheduler']);
    for (const field of advanced) values[comfySamplingKey[field]] = schemaRule(comfySamplingKey[field]);
    const variation = comfyVariation(model, workflow); if (variation) values[variation.field] = schemaRule(variation.field);
    const ports = new Set((workflow?.inputPorts || []).map(port => port.id));
    for (const [key, port] of [['identityStrength', 'identity'], ['proportionStrength', 'proportion'], ['poseStrength', 'pose'], ['lineartStrength', 'lineart']] as const) if (ports.has(port) || Object.hasOwn(workflow?.controlDefaults || {}, key)) values[key] = schemaRule(key);
    if (ports.has('pose')) values.poseEstimator = schemaRule('poseEstimator');
    for (const [field, category] of [['styleLora', 'style'], ['characterLora', 'character'], ['objectLora', 'object']] as const) {
      const entries = model.loraCatalog?.[category] || [];
      if (entries.length) { values[field] = { type: 'string', enum: [...entries] }; if (field === 'characterLora') values.characterLoraStrength = schemaRule('characterLoraStrength'); }
    }
    tightenComfyRules(values, model);
  } else if (nodeKind === 'imageGenerator') {
    addProfileRules(values, model, ['ratio', 'resolution', 'count']);
    if (adapter === 'openai-image') addRules(values, ['imageQuality']);
    if (['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(adapter)) {
      addRules(values, ['negativePrompt', 'comfySeedMode', 'seed', 'comfySteps', 'comfyCfg', 'comfySampler', 'comfyScheduler', 'comfyDenoise', 'referenceDenoise', 'poseStrength', 'poseEstimator']);
      const lora = adapter === 'comfyui-illustrious' ? [['styleLora', 'style'], ['characterLora', 'character'], ['objectLora', 'object']] : adapter === 'comfyui-sdxl' ? [['characterLora', 'character']] : [['styleLora', 'style']];
      for (const [field, category] of lora as Array<[string, 'style' | 'character' | 'object']>) {
        const entries = model.loraCatalog?.[category] || [];
        if (entries.length) { values[field] = { type: 'string', enum: [...entries] }; if (field === 'characterLora') values.characterLoraStrength = schemaRule('characterLoraStrength'); }
      }
      if (adapter === 'comfyui-illustrious') addRules(values, ['identityStrength', 'proportionStrength', 'lineartStrength']);
      tightenComfyRules(values, model);
    }
  } else if (nodeKind === 'videoGenerator') {
    addProfileRules(values, model, ['ratio', 'resolution', 'duration']);
    addRules(values, ['videoInputMode']);
    if (model.profile?.audio) addRules(values, ['audioEnabled']);
    if (model.profile?.outputFormats?.length) values.outputFormat = { type: 'string', enum: [...model.profile.outputFormats] };
    if (adapter === 'seedance-video' && model.profile?.legacyArkOptions !== false) addRules(values, ['cameraFixed']);
    if (adapter === 'comfyui-minimax-h3') {
      addRules(values, ['refImageSize', 'referenceVideoAudio', 'seed', 'h3EncodingPreset', 'h3SamplingSteps', 'h3AccelerationMode', 'h3BlockCache']);
      if (model.managed !== true) addRules(values, ['h3FaceRefine']);
      const mode = current.videoInputMode === 'first' || current.videoInputMode === 'first_last' ? current.videoInputMode : 'reference';
      values.h3AccelerationMode.enum = mode === 'reference' && !current.publicMode ? ['standard', 'turbo', 'reference8', 'community8'] : ['standard', 'turbo'];
      values.h3BlockCache.note = '仅全能参考、正式质量模式可开启';
    }
    if (current.videoUpscale) addRules(values, ['topazModel', 'topazVram', 'topazScale', 'topazResolution', 'topazStrength', 'topazInputQuality', 'topazSharpness']);
  } else if (nodeKind === 'audioGenerator' && adapter === 'gpt-sovits-audio') {
    values.audioLanguage = { type: 'string', enum: (model.audioOptions?.languages || [{ id: 'zh' }, { id: 'ja' }, { id: 'en' }]).map(option => option.id) };
    values.audioSpeed = { type: 'number', minimum: model.audioOptions?.speed?.min ?? .5, maximum: model.audioOptions?.speed?.max ?? 2 };
    addRules(values, ['audioReferenceText']);
  } else if (nodeKind === 'modelGenerator' && adapter === 'tripo3d-model') {
    addRules(values, ['texture', 'pbr', 'autoSize', 'modelInputMode', 'modelPreset', 'textureQuality', 'geometryQuality', 'textureSeed', 'modelSeed', 'faceLimit', 'exportUv']);
    const mode = String(current.modelInputMode || 'text');
    if (mode === 'text') { addRules(values, ['negativePrompt', 'imageSeed']); values.negativePrompt.maxLength = 255; }
    else addRules(values, ['enableImageAutofix', 'textureAlignment', 'orientation']);
    values.modelPreset = { type: 'string', enum: ['preview', 'game', 'detail', 'custom'] };
    if (tripoP1(model)) { values.geometryQuality = { type: 'string', enum: ['standard'] }; values.faceLimit = { type: 'integer', minimum: 50, maximum: 20000 }; }
    else {
      addRules(values, ['quad', 'smartLowPoly', 'generateParts']);
      const geometry = current.geometryQuality === 'detailed' ? 'detailed' : 'standard', quad = current.quad === true, lowPoly = current.smartLowPoly === true;
      values.faceLimit = { type: 'integer', minimum: 500, maximum: quad ? lowPoly ? 10000 : 150000 : lowPoly ? 20000 : geometry === 'detailed' ? 2000000 : 1500000 };
    }
  }
  return { adapter, ...(workflow ? { workflowId: workflow.id } : {}), keys: Object.keys(values), values };
}

export function validateNodeSettingsForModel(node: CanvasNode, models: ModelInfo[], requested: Record<string, unknown>) {
  const modelId = String(node.data.modelId || '').trim();
  const model = models.find(candidate => candidate.id === modelId);
  if (!modelId || !model) throw Error('当前节点没有选中可用模型，请先选择模型并重新读取');
  if (node.data.kind !== 'comfyUiWorkflow' && model.capability !== generatorCapability(node)) throw Error('所选模型与节点类型不匹配');
  let workflow: NonNullable<ModelInfo['workflow']> | undefined;
  if (node.data.kind === 'comfyUiWorkflow') {
    workflow = (model.workflows || (model.workflow ? [model.workflow] : [])).find(candidate => candidate.id === node.data.workflowId);
    if (!workflow) throw Error('当前节点没有选中可用的 ComfyUI 工作流，请先选择工作流并重新读取');
  }
  const support = settingsSupportForModel(model, node.data.kind, workflow, { ...node.data, ...requested });
  for (const key of Object.keys(requested)) if (!support.keys.includes(key)) throw Error(`当前模型或工作流不支持设置 ${key}`);
  const normalizedResolution = requested.resolution === undefined ? undefined : String(requested.resolution).toUpperCase();
  const normalized = { ...requested, ...(normalizedResolution === undefined ? {} : { resolution: normalizedResolution }) };
  for (const [key, value] of Object.entries(normalized)) {
    const rule = support.values[key];
    if (rule.enum && !rule.enum.includes(value)) throw Error(`当前模型或工作流不支持 ${key}=${String(value)}`);
    if (rule.minimum !== undefined && Number(value) < rule.minimum || rule.maximum !== undefined && Number(value) > rule.maximum) throw Error(`当前模型或工作流不支持 ${key}=${String(value)}`);
    if (typeof value === 'string' && (rule.minLength !== undefined && value.length < rule.minLength || rule.maxLength !== undefined && value.length > rule.maxLength)) throw Error(`当前模型或工作流不支持 ${key} 的当前长度`);
  }
  if (workflow || ['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(String(model.adapter || ''))) {
    if (requested.seed !== undefined && (requested.comfySeedMode ?? node.data.comfySeedMode) !== 'fixed') throw Error('固定种子只在“重复同一结果”模式下可用');
  }
  if (model.adapter === 'comfyui-minimax-h3') {
    const mode = String(requested.videoInputMode ?? node.data.videoInputMode ?? 'reference');
    const acceleration = String(requested.h3AccelerationMode ?? node.data.h3AccelerationMode ?? 'standard');
    const blockCache = requested.h3BlockCache ?? node.data.h3BlockCache ?? false;
    if ((mode !== 'reference' || node.data.publicMode === true) && ['reference8', 'community8'].includes(acceleration)) throw Error('8 步加速只支持本机全能参考模式');
    if (blockCache === true && (mode !== 'reference' || acceleration !== 'standard')) throw Error('Balanced 加速只支持全能参考的正式质量模式');
  }
  if (model.adapter === 'tripo3d-model') {
    const mode = String(requested.modelInputMode ?? node.data.modelInputMode ?? 'text');
    const texture = requested.texture ?? node.data.texture ?? true;
    const pbr = requested.pbr ?? node.data.pbr ?? true;
    const parts = requested.generateParts ?? node.data.generateParts ?? false;
    const quad = requested.quad ?? node.data.quad ?? false;
    const orientation = mode === 'text' ? 'default' : requested.orientation ?? node.data.orientation ?? 'default';
    if (requested.enableImageAutofix === true && mode === 'text') throw Error('自动修复参考图只支持图片输入');
    if ((requested.textureAlignment !== undefined || requested.orientation !== undefined) && mode === 'text') throw Error('颜色对齐与方向只支持图片输入');
    if (texture === false && pbr === true) throw Error('关闭材质时必须同时关闭 PBR');
    if (texture === false && orientation === 'align_image') throw Error('跟随参考图方向要求开启材质');
    if (parts === true && (texture !== false || quad === true)) throw Error('分离部件要求关闭材质和四边面');
    if (requested.modelInputMode !== undefined) {
      if (mode === 'text') Object.assign(normalized, { enableImageAutofix: false, textureAlignment: 'original_image', orientation: 'default' });
      else Object.assign(normalized, { negativePrompt: '', imageSeed: undefined });
    }
  }
  return normalized as Partial<CanvasNodeData>;
}
export function inspectCanvasNode(node: CanvasNode, edges: Edge[], offset = 0, outputOffset = 0) {
  const d = node.data;
  const versions = d.modelVersions || d.generationVersions || d.resultVersions || [];
  return { id: node.id, kind: d.kind, title: d.title, position: node.position, width: node.width, height: node.height,
    settings: Object.fromEntries(['modelId', 'workflowId', 'ratio', 'resolution', 'count', 'duration', ...Object.keys(agentNodeSettings)].filter(k => d[k] !== undefined).map(k => [k, d[k]])),
    media: { type: d.mediaType || d.latestMediaType || d.outputType, width: d.mediaWidth, height: d.mediaHeight, duration: d.mediaDuration, available: !!d.mediaUrl },
    versionCount: versions.length, nextOffset: offset + 5 < versions.length ? offset + 5 : null,
    versions: versions.slice(offset, offset + 5).map((v, i) => ({ index: offset + i, jobId: v.jobId, operation: 'operation' in v ? v.operation : undefined, outputCount: v.outputs.length, nextOutputOffset: outputOffset + 12 < v.outputs.length ? outputOffset + 12 : null, outputs: v.outputs.slice(outputOffset, outputOffset + 12).map((o, output) => ({ output: outputOffset + output, available: !!o.mediaUrl, width: o.width, height: o.height, fileName: String(o.fileName || '').slice(0, 100) })) })),
    selectedVersion: d.selectedModelVersion ?? d.selectedVersion, selectedOutput: d.selectedOutput,
    job: { id: d.jobId, state: d.jobState, status: d.status, progress: d.progress },
    collection: { memberIds: d.memberIds, collapsed: d.collapsed, state: d.workflowState, status: d.workflowStatus },
    turnaround: { sourceNodeId: d.turnaroundSourceNodeId, crops: d.turnaroundCrops, sideRole: d.turnaroundSideRole, confirmed: d.turnaroundConfirmed },
    references: edges.filter(e => e.target === node.id).slice(0, 100).map(e => ({ edgeId: e.id, sourceId: e.source, port: e.targetHandle, token: e.data?.referenceToken, order: e.data?.referenceOrder, role: d.inputReferenceRoles?.[String(e.data?.referenceToken || '')], locked: e.data?.pinSourceMedia === true })) };
}
export function currentCanvasOutput(node: CanvasNode, outputIndex?: number) {
  const outputs = node.data.kind === 'result' ? node.data.outputs : node.data.latestOutputs || node.data.outputs;
  const output = outputs?.[outputIndex ?? node.data.selectedOutput ?? 0];
  const url = output?.mediaUrl || (outputIndex === undefined || outputIndex === 0 ? node.data.mediaUrl : undefined);
  if (!url || node.data.simulated || output?.simulated) throw Error('当前节点没有此序号的真实媒体结果');
  return { ...output, mediaUrl: url, fileName: output?.fileName || node.data.fileName, mediaType: node.data.latestMediaType || node.data.mediaType || node.data.outputType };
}

export async function executeCanvasAction(host: CanvasActionHost, proposal: AgentProposal, revision: string) {
  const { capability, args } = validateCanvasAction(proposal);
  const action = capability.action;
  host.check(['read', 'view'].includes(capability.risk) ? undefined : revision);
  let nodes = host.nodes(), edges = host.edges();
  const node = args.nodeId ? nodes.find(n => n.id === args.nodeId) : undefined;
  if (args.nodeId && !node) throw Error('节点不在当前画布');
  for (const id of [...(args.nodeIds || []), ...[args.sourceId, args.maskNodeId].filter(Boolean)]) if (!nodes.some(n => n.id === id)) throw Error('引用的节点不在当前画布');
  if (args.edgeId && !edges.some(e => e.id === args.edgeId && e.target === node?.id)) throw Error('连线不属于目标节点');
  if (node && active(node) && !['read', 'view'].includes(capability.risk) && !['job.cancel', 'job.resume', 'canvas.focus', 'collection.collapse'].includes(action)) throw Error('目标任务仍在执行，请先读取状态或取消任务');
  if (args.jobId && args.jobId !== node?.data.jobId) throw Error('任务编号与当前节点不匹配，请重新读取');
  const kind = (...kinds: string[]) => { if (!node || !kinds.includes(node.data.kind)) throw Error('此操作不适用于当前节点类型'); };
  let result: unknown;
  let graphChanged = false;
  let durableSaved = false;
  const patch = (data: Partial<CanvasNodeData>) => { nodes = nodes.map(n => n.id === node!.id ? { ...n, data: { ...n.data, ...data } } : n); graphChanged = true; };
  const beforeIds = new Set(nodes.map(n => n.id));
  if (action === 'node.inspect') result = inspectCanvasNode(node!, edges, args.offset || 0, args.outputOffset || 0);
  else if (action === 'models.inspect') {
    const models = host.models().filter(m => !args.modelId || m.id === args.modelId);
    if (args.modelId && !models.length) throw Error('此模型未在当前画布启用');
    result = models.slice(0, 100).map(m => {
      const workflows = m.workflows || (m.workflow ? [m.workflow] : []);
      const kind = workflows.length ? 'comfyUiWorkflow' : m.capability === 'image' ? 'imageGenerator' : m.capability === 'video' ? 'videoGenerator' : m.capability === 'audio' ? 'audioGenerator' : 'modelGenerator';
      return { id: m.id, name: m.name, capability: m.capability, adapter: m.adapter, profile: args.modelId ? m.profile : { ratios: m.profile?.ratios, resolutions: m.profile?.resolutions }, defaults: args.modelId ? Object.fromEntries(Object.entries(m.defaults || {}).filter(([k]) => Object.hasOwn(agentNodeSettings, k) || ['ratio', 'resolution', 'count', 'duration'].includes(k))) : undefined,
        settings: settingsSupportForModel(m, kind, workflows[0]),
        ...(m.adapter === 'tripo3d-model' ? { settingsByMode: Object.fromEntries(tripoInputModes.map(modelInputMode => [modelInputMode, settingsSupportForModel(m, 'modelGenerator', undefined, { modelInputMode })])) } : {}),
        workflows: workflows.map(w => ({ id: w.id, name: w.name, capability: w.capability, inputPorts: w.inputPorts, readiness: w.readiness, samplingControls: w.samplingControls, settings: settingsSupportForModel(m, 'comfyUiWorkflow', w) })) };
    });
  } else if (action === 'node.settings') {
    kind('imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow');
    // Only presentation/creative settings are accepted. Runtime, media, job IDs,
    // callback functions, endpoints and credentials cannot be patched.
    patch(validateNodeSettingsForModel(node!, host.models(), args.settings));
    const affected = new Set([node!.id]);
    for (let size = -1; size !== affected.size;) { size = affected.size; for (const e of edges) if (affected.has(e.source)) affected.add(e.target); }
    nodes = nodes.map(n => affected.has(n.id) && (n.data.jobState === 'succeeded' || n.data.kind === 'result') ? { ...n, data: { ...n.data, stale: true } } : n);
  } else if (action === 'node.resize') {
    if (node!.data.kind === 'collection' && node!.data.collapsed) throw Error('请先展开收纳组再调整尺寸');
    nodes = nodes.map(n => n.id === node!.id ? { ...n, width: args.width, height: args.height, measured: { width: args.width, height: args.height }, style: { ...n.style, width: args.width, height: args.height } } : n); graphChanged = true;
  } else if (action === 'node.layer') {
    const members = new Set([node!.id, ...(node!.data.memberIds || [])]);
    const layers = nodes.map(n => Number(n.zIndex) || 0), z = args.direction === 'front' ? Math.max(2, ...layers) + 2 : Math.min(0, ...layers) - 2;
    nodes = nodes.map(n => members.has(n.id) ? { ...n, zIndex: z + (n.id === node!.id ? 0 : 1) } : n); graphChanged = true;
  } else if (action === 'reference.order') {
    const incoming = edges.filter(e => e.target === node!.id && !e.data?.collectionProxy);
    if (incoming.length !== args.edgeIds.length || incoming.some(e => !args.edgeIds.includes(e.id))) throw Error('请提供目标节点完整的参考连线列表');
    edges = edges.map(e => args.edgeIds.includes(e.id) ? { ...e, data: { ...e.data, referenceOrder: args.edgeIds.indexOf(e.id) + 1 } } : e); graphChanged = true;
  } else if (action === 'reference.role') {
    kind('imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow');
    const edge = edges.find(e => e.id === args.edgeId)!, token = String(edge.data?.referenceToken || '');
    if (!token) throw Error('此连线没有稳定的 @ 引用标记，请重新连接后设置用途');
    patch({ inputReferenceRoles: { ...node!.data.inputReferenceRoles, [token]: args.role } });
  } else if (action === 'result.mark') {
    kind('result'); patch({ resultState: args.state });
  } else if (action === 'result.select') {
    kind('result', 'imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow');
    const versions = node!.data.modelVersions || node!.data.generationVersions || node!.data.resultVersions;
    const version = args.version === undefined ? undefined : versions?.[args.version];
    if (args.version !== undefined && !version) throw Error('此结果版本不存在');
    const outputs = version?.outputs || (node!.data.kind === 'result' ? node!.data.outputs : node!.data.latestOutputs) || node!.data.outputs;
    const output = outputs?.[args.output];
    if (!output?.mediaUrl) throw Error('所选版本没有此媒体结果');
    patch({ ...(node!.data.kind === 'result' ? { outputs } : { latestOutputs: outputs }),
      ...(version ? { jobId: version.jobId, ...(node!.data.modelVersions ? { selectedModelVersion: args.version } : { selectedVersion: args.version }) } : {}),
      selectedOutput: args.output, mediaUrl: output.mediaUrl, previewUrl: output.previewUrl, fileName: output.fileName, mediaWidth: output.width, mediaHeight: output.height });
  } else {
    if (action.startsWith('collection.') && action !== 'collection.create') kind('collection');
    if (action.startsWith('turnaround.') && action !== 'turnaround.prepare') kind('turnaroundSplitter');
    if (action.startsWith('comfy.')) kind('comfyUiWorkflow');
    if (action === 'image.restore' && !node!.data.imageInpaintPreviousUrl) throw Error('没有保留的重绘前版本');
    if (['image.inpaint', 'image.restore'].includes(action)) kind('image');
    if (action.startsWith('model.') && action !== 'model.character') kind('modelGenerator', 'characterAnimator', 'result');
    const perform = host.perform[action];
    if (!perform) throw Error('此画布操作尚未安装到当前客户端，请更新后重试');
    result = await perform(args);
    durableSaved = action === 'canvas.save';
  }
  if (graphChanged) { host.check(revision); host.commit(nodes, edges); }
  if (!durableSaved && !['read', 'view', 'user'].includes(capability.risk)) {
    // Let existing React callbacks settle before saving their actual changes.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    host.check(); await host.save();
  }
  const after = host.nodes(), created = after.filter(n => !beforeIds.has(n.id));
  const response = { action, summary: proposal.summary || capability.label, status: capability.risk === 'user' ? 'needs_user' : capability.risk === 'generate' ? 'submitted' : 'completed',
    ...(result === undefined ? {} : { result }), created: Object.fromEntries(created.map(n => [n.id, n.id])),
    affected: created.length ? created.map(n => n.id) : args.nodeIds || (node ? [node.id] : []), titles: Object.fromEntries(created.map(n => [n.id, n.data.title])),
    ...(capability.risk === 'generate' ? { generated: false, submitted: after.filter(n => n.data.jobId && (!beforeIds.has(n.id) || n.id === node?.id)).map(n => ({ id: n.id, jobId: n.data.jobId, state: n.data.jobState })) } : {}) };
  if (JSON.stringify(response).length <= 23000) return JSON.stringify(response);
  if (capability.risk === 'read') throw Error('本次读取内容过多，请按模型 ID 或版本分页读取');
  return JSON.stringify({ ...response, result: undefined, created: Object.fromEntries(Object.entries(response.created).slice(0, 40)), titles: Object.fromEntries(Object.entries(response.titles).slice(0, 40)), affected: response.affected.slice(0, 40), affectedCount: response.affected.length, truncated: true, note: '完整节点仍在画布，请分页读取。' });
}
export function missingCanvasActionHandlers(handlers: CanvasActionHost['perform']) {
  const internal = new Set(['node.inspect', 'models.inspect', 'node.settings', 'node.resize', 'node.layer', 'reference.order', 'reference.role', 'result.select', 'result.mark']);
  return canvasCapabilities.filter(c => !internal.has(c.action) && !handlers[c.action]).map(c => c.action);
}
