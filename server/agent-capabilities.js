// One shared, explicit allow-list. Discover schemas on demand instead of adding
// every operation to every model request. Never accept URLs, code or credentials.
const str = (maxLength = 160) => ({ type: 'string', minLength: 1, maxLength });
const num = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const choice = (...values) => ({ type: 'string', enum: values });
const bool = { type: 'boolean' };
const list = (items, minItems = 1, maxItems = 99) => ({ type: 'array', items, minItems, maxItems });
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const node = { nodeId: str() };
const rect = obj({ x: num(0, 1), y: num(0, 1), width: num(.0001, 1), height: num(.0001, 1) });
export const agentNodeSettings = {
  ratio: str(40), resolution: str(40), count: integer(1, 99), duration: integer(1, 86400),
  negativePrompt: { type: 'string', maxLength: 8000 }, creationMode: choice('textToImage', 'imageToImage', 'imageEdit'), imageQuality: choice('auto', 'low', 'medium', 'high'),
  seed: integer(-1, 4294967295), comfySeedMode: choice('random', 'fixed'), comfySteps: integer(1, 150), comfyCfg: num(0, 30),
  comfySampler: str(80), comfyScheduler: str(80), comfyDenoise: num(0, 1), referenceDenoise: num(0, 1),
  identityStrength: num(0, 2), proportionStrength: num(0, 2), poseStrength: num(0, 2), lineartStrength: num(0, 2), poseEstimator: choice('sdpose', 'dwpose'),
  characterLora: str(160), characterLoraStrength: num(-2, 2), styleLora: str(160), objectLora: str(160),
  audioEnabled: bool, audioLanguage: choice('zh', 'ja', 'en', 'ko', 'yue'), audioSpeed: num(.25, 4), audioReferenceText: { type: 'string', maxLength: 8000 },
  cameraFixed: bool, returnLastFrame: bool, priority: integer(-10, 10), serviceTier: choice('default', 'flex'),
  videoInputMode: choice('first', 'first_last', 'reference'), refImageSize: choice('match', 'max'), referenceVideoAudio: bool,
  h3EncodingPreset: choice('quality', 'balanced', 'compact', 'quality10'), h3SamplingSteps: { type: 'integer', enum: [20, 24, 28] },
  h3AccelerationMode: choice('standard', 'turbo', 'reference8', 'community8'), h3BlockCache: bool, h3FaceRefine: bool,
  outputFormat: choice('mp4', 'mov'), executionExpiresAfter: integer(60, 172800), webSearch: bool,
  texture: bool, pbr: bool, autoSize: bool, enableImageAutofix: bool, modelInputMode: choice('text', 'image', 'imageToMultiview', 'imageToMultiviewToModel', 'multiview'), modelPreset: str(80),
  textureQuality: choice('standard', 'detailed', 'extreme'), geometryQuality: choice('standard', 'detailed'),
  imageSeed: integer(0, 4294967295), textureSeed: integer(0, 4294967295), modelSeed: integer(0, 4294967295), faceLimit: integer(50, 2000000),
  quad: bool, smartLowPoly: bool, generateParts: bool, exportUv: bool, textureAlignment: choice('original_image', 'geometry'), orientation: choice('default', 'align_image'),
  topazModel: choice('星光 2.6', 'Astra', 'Astra HQ', 'Astra Fast', 'Astra Sharp'), topazVram: num(2, 96), topazScale: { type: 'integer', enum: [1, 2, 3, 4] },
  topazResolution: choice('2K', '4K'),
  topazStrength: { type: 'number', enum: [.7, 1, 1.3] }, topazInputQuality: integer(0, 100), topazSharpness: choice('自然', '平衡', '锐利（默认）'),
  generatorPanelDock: choice('bottom', 'top', 'left', 'right'),
};
const descriptors = [];
const add = (action, category, label, risk, properties = {}, required, note = '') => descriptors.push({ action, category, label, risk, note, parameters: obj(properties, required) });
add('node.inspect', 'inspect', '读取节点完整创作设置、版本、分组与参考信息', 'read', { ...node, offset: integer(0, 10000), outputOffset: integer(0, 100) }, ['nodeId']);
add('models.inspect', 'inspect', '读取已启用模型及真实规格、工作流、可选参数', 'read', { modelId: str() }, []);
add('node.settings', 'settings', '修改节点真实支持的创作参数（不提交生成）', 'edit', { ...node, settings: obj(agentNodeSettings, []) }, undefined, '先读 models.inspect 和 node.inspect；只可使用当前所选模型及 ComfyUI 工作流实际支持的参数和值。');
add('node.resize', 'structure', '调整节点显示尺寸', 'edit', { ...node, width: num(120, 3000), height: num(80, 3000) });
add('node.layer', 'structure', '调整节点前后层级', 'edit', { ...node, direction: choice('front', 'back') });
add('reference.order', 'references', '调整参考图顺序，保留 @ 标记对应关系', 'edit', { ...node, edgeIds: list(str(), 1, 100) });
add('reference.role', 'references', '设置已连接素材的实际参考用途', 'edit', { ...node, edgeId: str(), role: choice('unassigned', 'character', 'prop', 'story', 'storyboard', 'first_frame', 'last_frame', 'scene', 'style', 'picture', 'video', 'audio') });
add('result.select', 'results', '选择结果版本及该版本内图片或媒体', 'edit', { ...node, version: integer(0, 10000), output: integer(0, 99) }, ['nodeId', 'output']);
add('result.mark', 'results', '标记结果为候选、最终或已提交', 'edit', { ...node, state: choice('output', 'candidate', 'final', 'submitted') });
add('video.upscale_prepare', 'video', '创建视频增强节点，不立即运行', 'edit', node);
add('video.upscale_run', 'video', '按已设置参数提交视频增强任务', 'generate', node);
add('comfy.select', 'comfy', '选择已启用的 ComfyUI 模型及工作流', 'edit', { ...node, modelId: str(), workflowId: str() });
add('comfy.pose_preview', 'comfy', '检测姿势参考并生成控制图预览', 'edit', node);
add('comfy.editor', 'comfy', '打开当前节点专属的 ComfyUI 编辑器', 'user', node, undefined, '打开编辑界面供用户操作，不代表已编辑或生成。');
add('job.cancel', 'jobs', '取消当前节点正在执行的任务', 'edit', { ...node, jobId: str() });
add('job.resume', 'jobs', '恢复指定已存在任务的查询，不重新付费', 'edit', { ...node, jobId: str() });
add('job.retry', 'jobs', '明确重新提交失败任务，可能再次计费', 'generate', { ...node, jobId: str() });
add('canvas.save', 'canvas', '立即保存当前画布', 'edit');
add('canvas.focus', 'canvas', '定位指定节点', 'view', { nodeIds: list(str(), 1, 100) });
add('canvas.fit', 'canvas', '把当前画布内容适配到视口', 'view');

export const canvasCapabilities = Object.freeze(descriptors);
export const canvasCapability = action => canvasCapabilities.find(item => item.action === action);
function validate(schema, value, path) {
  if (schema.enum && !schema.enum.includes(value)) throw Error(`${path} 选项无效`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !Object.hasOwn(schema.properties, k))) throw Error(`${path} 包含不允许的字段`);
    if (schema.required.some(k => !Object.hasOwn(value, k))) throw Error(`${path} 缺少必要参数`);
    for (const [key, item] of Object.entries(value)) validate(schema.properties[key], item, `${path}.${key}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) throw Error(`${path} 数量无效`);
    value.forEach((item, index) => validate(schema.items, item, `${path}[${index}]`));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength || 0) || value.length > (schema.maxLength || 1000)) throw Error(`${path} 文字长度无效`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw Error(`${path} 必须为布尔值`);
  } else if (!Number.isFinite(value) || schema.type === 'integer' && !Number.isInteger(value) || value < schema.minimum || value > schema.maximum) throw Error(`${path} 数值无效`);
}
export function validateCanvasAction(input) {
  const capability = canvasCapability(input?.action);
  if (!capability || typeof input.arguments !== 'string' || input.arguments.length > 16000) throw Error('请先查询画布能力目录并使用规定参数');
  let args; try { args = JSON.parse(input.arguments); } catch { throw Error('arguments 必须是 JSON 对象字符串'); }
  validate(capability.parameters, args, capability.action);
  for (const key of ['nodeIds', 'edgeIds']) if (args[key] && new Set(args[key]).size !== args[key].length) throw Error('节点或连线不能重复');
  if (args.settings && !Object.keys(args.settings).length) throw Error('没有需要修改的参数');
  for (const crop of args.crops || []) if (crop.x + crop.width > 1.0000001 || crop.y + crop.height > 1.0000001) throw Error('裁剪区域不能超出原图');
  return { capability, args };
}
export function discoverCanvasCapabilities(input = {}) {
  if (input.action) { const item = canvasCapability(input.action); if (!item) throw Error('没有此画布操作'); return item; }
  const selected = input.category ? canvasCapabilities.filter(item => item.category === input.category) : canvasCapabilities;
  return { categories: [...new Set(canvasCapabilities.map(item => item.category))], actions: selected.map(({ parameters, ...item }) => item),
    existingTools: ['heiyan_read_canvas', 'heiyan_edit_canvas', 'heiyan_crop_images', 'heiyan_read_images', 'heiyan_request_generation', 'heiyan_read_generation', 'heiyan_review_result', 'heiyan_project_checkpoint', 'heiyan_search_history'],
    boundary: '仅限当前授权画布和可访问项目素材。账户、密钥、站点配置、任意脚本、其他任务以及本机文件读取不属于画布创作权限。risk=user 表示需要用户完成浏览器操作；不是自动完成。先按 action 查询参数。' };
}
