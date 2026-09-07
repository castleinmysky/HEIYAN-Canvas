import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson,
  canonicalSha256,
  logicalTargetPath,
  managedComfyManifestDigest,
  normalizeLogicalPath,
  validateLocalBundleManifestV1,
} from './managed-comfy-bundle.js';
import { managedComfyCapabilityCatalog } from './managed-comfy-capability-catalog.js';
import { prepareManagedWorkflow } from '../scripts/comfy-bundle/prepare-workflows.mjs';

export const MANAGED_COMFY_CAPABILITY_PLAN_VERSION = 'managed-comfy-capability-plan/v1';
export const MANAGED_COMFY_COMPILED_SOURCE_ID = 'echo-canvas-compiled';
export const MANAGED_COMFY_BRIDGE_ID = 'echo_canvas_managed_bridge';
const COMPILER_STATE = '.managed-comfy-compiler-state-v1.json';
const FINAL_MANIFEST = 'bundle-manifest.json';
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;
const UNC = /^(?:\\\\|\/\/)/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_ROLE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_DIRECTORY = new Set(['.cache', 'cache', 'caches', '.huggingface', '.hf-xet-stage', '.tmp', 'tmp', 'temp', '__pycache__', '.git', '.venv', 'venv', 'user', 'input', 'output', 'logs']);
const PYTHON_HARD_FORBIDDEN_DIRECTORY = new Set(['.git', '__pycache__', '.venv', 'venv', '.huggingface', '.hf-xet-stage']);
const RECURSIVE_HARD_FORBIDDEN_DIRECTORY = new Set(['.git', '__pycache__', '.venv', 'venv', '.huggingface', '.hf-xet-stage', '.cache', '.tmp']);
const FORBIDDEN_FILE = /^(?:\.env(?:\..+)?|direct_url\.json|activate(?:\..+)?|activate_this\.py|credentials?\.json|secrets?\.json)$/i;
const FORBIDDEN_SOURCE_FILE = /\.(?:pyc|pyo|pdb|part|tmp|pth|egg-link|key|p12|pfx)$/i;
const FORBIDDEN_VALUE_KEY = /(?:api.?key|token|credential|secret|password|authorization)/i;
const REDACT_VALUE_KEY = /(?:prompt|positive|negative|caption|description|text|image|video|audio|file(?:name)?|path|directory|folder|history|recent|viewport|download|source.?url|url)/i;
const REMOVE_UI_KEY = new Set(['title', 'label', 'metadata']);
const LOADER_KEYS = new Set(['ckpt_name', 'model_name', 'unet_name', 'clip_name', 'vae_name', 'lora_name']);
const SAMPLERS = new Set(['euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpm_2_ancestral', 'lms', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde', 'ddpm', 'lcm', 'ipndm', 'deis']);
const SCHEDULERS = new Set(['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta', 'linear_quadratic', 'kl_optimal']);
const WORKFLOW_KEYS = new Set([
  'class_type', 'inputs', 'id', 'type', 'nodes', 'links', 'last_node_id', 'last_link_id', '_meta',
  'groups', 'config', 'extra', 'version', 'flags', 'order', 'mode', 'pos', 'size',
  'outputs', 'properties', 'widgets_values', 'color', 'bgcolor', 'title', 'label', 'metadata',
  'aiCanvasRole', 'ckpt_name', 'model_name', 'unet_name', 'clip_name', 'vae_name', 'lora_name',
  'sampler_name', 'scheduler', 'seed', 'noise_seed', 'steps', 'cfg', 'denoise', 'width',
  'height', 'batch_size', 'positive', 'negative', 'prompt', 'text', 'caption', 'description',
  'image', 'images', 'video', 'audio', 'filename', 'filename_prefix', 'latent_image', 'samples',
  'model', 'clip', 'vae', 'upscale_model', 'pixels', 'conditioning', 'guider', 'sampler',
  'sigmas', 'noise', 'latent', 'source', 'seconds', 'fps', 'frame_rate', 'frame_count',
  'reference', 'ref_image', 'start_image', 'end_image', 'slot_index', 'name', 'shape',
  'link', 'collapsed',
]);
const API_EXTRA_INPUTS = Object.freeze({
  CLIPLoader: new Set(['device']),
  CreateVideo: new Set(['bit_depth']),
  ImageScale: new Set(['crop', 'upscale_method']),
  MiniMaxH3ImageToVideo: new Set(['first_frame', 'length']),
  UNETLoader: new Set(['weight_dtype']),
});
const API_STRING_ENUMS = Object.freeze({
  CLIPLoader: Object.freeze({ device: new Set(['default']), type: new Set(['minimax']) }),
  ImageScale: Object.freeze({ crop: new Set(['center']), upscale_method: new Set(['lanczos']) }),
  UNETLoader: Object.freeze({ weight_dtype: new Set(['default']) }),
});
const WORKFLOW_READ_LIMIT = 4 * 1024 * 1024;
const ROLE_CATEGORY = Object.freeze({
  checkpoint: 'checkpoints', upscaleModel: 'upscale_models', diffusion: 'diffusion_models',
  referenceDiffusion: 'diffusion_models', textEncoder: 'text_encoders', videoVae: 'vae',
  audioVae: 'vae', turboDiffusionLora: 'loras', turboReferenceLora: 'loras',
  communityReferenceLora: 'loras',
});

function fail(code, message) {
  const error = new Error(message);
  error.name = 'ManagedComfyManifestError';
  error.code = code;
  throw error;
}
function assert(value, code, message) { if (!value) fail(code, message); }
function ordinal(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function assertClosed(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'plan_schema_invalid', `${label} must be an object`);
  const actual = Object.keys(value).sort(ordinal);
  const expected = [...keys].sort(ordinal);
  assert(actual.length === expected.length && actual.every((key, index) => key === expected[index]), 'plan_schema_invalid', `${label} has invalid fields`);
}
function assertId(value, label) { assert(typeof value === 'string' && SAFE_ID.test(value), 'plan_id_invalid', `${label} is invalid`); return value; }
function uniqueOrdinal(values, selector, label) {
  const keys = values.map(selector);
  assert(new Set(keys).size === keys.length, 'plan_duplicate', `${label} contains duplicates`);
  assert(new Set(keys.map((item) => item.toLowerCase())).size === keys.length, 'plan_case_collision', `${label} contains a case-insensitive collision`);
}
function safeLogical(value, label) {
  try { return normalizeLogicalPath(value); } catch (error) { fail('plan_path_invalid', `${label} is invalid: ${error.message}`); }
}
function selectionPathForbidden(segment, index, category) {
  if (FORBIDDEN_FILE.test(segment)) return true;
  if ((category === 'runtime' || category === 'python_runtime' || category === 'custom_node') && FORBIDDEN_SOURCE_FILE.test(segment)) return true;
  const folded = segment.toLowerCase();
  if (category === 'python_runtime') {
    if (PYTHON_HARD_FORBIDDEN_DIRECTORY.has(folded)) return true;
    return index === 0 && FORBIDDEN_DIRECTORY.has(folded);
  }
  if (category === 'runtime' || category === 'custom_node') {
    if (RECURSIVE_HARD_FORBIDDEN_DIRECTORY.has(folded)) return true;
    const privateRootDepth = category === 'runtime' ? 0 : 1;
    return index <= privateRootDepth && FORBIDDEN_DIRECTORY.has(folded);
  }
  return FORBIDDEN_DIRECTORY.has(folded);
}
function assertInclude(value, label, category) {
  assertClosed(value, ['kind', 'logicalPath'], label);
  assert(value.kind === 'file' || value.kind === 'tree', 'plan_schema_invalid', `${label}.kind is invalid`);
  assert(safeLogical(value.logicalPath, label) === value.logicalPath, 'plan_path_invalid', `${label}.logicalPath is not normalized`);
  value.logicalPath.split('/').forEach((segment, index) => assert(!selectionPathForbidden(segment, index, category), 'plan_forbidden_path', `${label} selects a forbidden path`));
}

export function validateManagedComfyCapabilityPlanV1(plan) {
  assertClosed(plan, ['schemaVersion', 'bundle', 'runtime', 'python', 'capabilities', 'workflows', 'models', 'customNodes'], 'plan');
  assert(plan.schemaVersion === MANAGED_COMFY_CAPABILITY_PLAN_VERSION, 'plan_schema_invalid', 'plan schemaVersion is invalid');
  assertClosed(plan.bundle, ['id', 'version'], 'plan.bundle'); assertId(plan.bundle.id, 'bundle id'); assertId(plan.bundle.version, 'bundle version');
  for (const [name, value] of [['runtime', plan.runtime], ['python', plan.python]]) {
    assertClosed(value, ['sourceId', 'executableOrEntrypoint', 'includes'], `plan.${name}`);
    assertId(value.sourceId, `${name} sourceId`);
    assert(safeLogical(value.executableOrEntrypoint, `${name} executable`) === value.executableOrEntrypoint, 'plan_path_invalid', `${name} executable is invalid`);
    assert(Array.isArray(value.includes) && value.includes.length > 0, 'plan_schema_invalid', `${name} includes must not be empty`);
    value.includes.forEach((item, index) => assertInclude(item, `${name}.includes[${index}]`, name === 'python' ? 'python_runtime' : 'runtime'));
    uniqueOrdinal(value.includes, (item) => `${item.kind}/${item.logicalPath}`, `${name} includes`);
    assert(value.includes.some((item) => item.kind === 'file' && item.logicalPath === value.executableOrEntrypoint), 'plan_executable_missing', `${name} executable must be an explicit file include`);
  }
  assert(plan.runtime.sourceId !== plan.python.sourceId, 'plan_python_source_invalid', 'runtime and Python require distinct source IDs');

  for (const key of ['capabilities', 'workflows', 'models', 'customNodes']) assert(Array.isArray(plan[key]), 'plan_schema_invalid', `${key} must be an array`);
  uniqueOrdinal(plan.capabilities, (item) => item.id, 'capabilities');
  const expectedCapabilities = Object.keys(managedComfyCapabilityCatalog).sort(ordinal);
  assert(plan.capabilities.length === expectedCapabilities.length && [...plan.capabilities].map((item) => item.id).sort(ordinal).every((id, index) => id === expectedCapabilities[index]), 'plan_capability_set', 'plan must contain exactly the two managed capabilities');
  for (const [index, capability] of plan.capabilities.entries()) {
    assertClosed(capability, ['id', 'workflowId', 'modelRoles', 'requiredCustomNodes'], `capabilities[${index}]`);
    assertId(capability.id, 'capability id'); assertId(capability.workflowId, 'workflow id');
    const catalog = managedComfyCapabilityCatalog[capability.id];
    assert(capability.workflowId === catalog.workflowId, 'plan_workflow_mismatch', `capability ${capability.id} workflow is invalid`);
    assertClosed(capability.modelRoles, Object.keys(catalog.requiredModelRoles), `capability ${capability.id} modelRoles`);
    for (const [role, modelId] of Object.entries(catalog.requiredModelRoles)) assert(capability.modelRoles[role] === modelId, 'plan_role_mismatch', `capability ${capability.id} role ${role} is invalid`);
    assert(Array.isArray(capability.requiredCustomNodes), 'plan_schema_invalid', 'requiredCustomNodes must be an array');
    capability.requiredCustomNodes.forEach((item) => assertId(item, 'required custom node'));
    uniqueOrdinal(capability.requiredCustomNodes, (item) => item, 'requiredCustomNodes');
  }
  uniqueOrdinal(plan.workflows, (item) => item.id, 'workflows');
  for (const item of plan.workflows) { assertClosed(item, ['id', 'sourceId', 'logicalPath'], 'workflow'); assertId(item.id, 'workflow id'); assertId(item.sourceId, 'workflow sourceId'); safeLogical(item.logicalPath, 'workflow logicalPath'); }
  uniqueOrdinal(plan.models, (item) => item.id, 'models');
  for (const item of plan.models) { assertClosed(item, ['id', 'sourceId', 'logicalPath', 'category'], 'model'); assertId(item.id, 'model id'); assertId(item.sourceId, 'model sourceId'); safeLogical(item.logicalPath, 'model logicalPath'); assert(typeof item.category === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(item.category), 'plan_model_category', 'model category is invalid'); }
  uniqueOrdinal(plan.customNodes, (item) => item.id, 'customNodes');
  for (const item of plan.customNodes) { assertClosed(item, ['id', 'sourceId', 'logicalPath', 'versionState'], 'custom node'); assertId(item.id, 'custom node id'); assert(item.id.toLowerCase() !== MANAGED_COMFY_BRIDGE_ID, 'plan_bridge_reserved', 'managed bridge ID is reserved'); assertId(item.sourceId, 'custom node sourceId'); safeLogical(item.logicalPath, 'custom node logicalPath'); assert(item.versionState === 'pinned' || item.versionState === 'unverified', 'plan_schema_invalid', 'custom node versionState is invalid'); }

  const workflows = new Map(plan.workflows.map((item) => [item.id, item]));
  const models = new Map(plan.models.map((item) => [item.id, item]));
  const customNodes = new Map(plan.customNodes.map((item) => [item.id, item]));
  for (const capability of plan.capabilities) {
    assert(workflows.has(capability.workflowId), 'plan_workflow_missing', `workflow ${capability.workflowId} is missing`);
    for (const [role, modelId] of Object.entries(capability.modelRoles)) {
      const model = models.get(modelId); assert(model, 'plan_model_missing', `model ${modelId} is missing`);
      assert(ROLE_CATEGORY[role] && model.category === ROLE_CATEGORY[role], 'plan_model_category', `model ${modelId} has the wrong category for ${role}`);
      assert(model.logicalPath.startsWith(`${model.category}/`), 'plan_model_category', `model ${modelId} path does not match category`);
    }
    for (const id of capability.requiredCustomNodes) assert(customNodes.has(id), 'plan_custom_node_missing', `custom node ${id} is missing`);
  }
  const referencedModels = new Set(plan.capabilities.flatMap((item) => Object.values(item.modelRoles)));
  assert(referencedModels.size === plan.models.length && plan.models.every((item) => referencedModels.has(item.id)), 'plan_unselected_model', 'plan contains an unselected model');
  assert(new Set(plan.capabilities.map((item) => item.workflowId)).size === plan.workflows.length, 'plan_unselected_workflow', 'plan contains an unselected workflow');
  const referencedNodes = new Set(plan.capabilities.flatMap((item) => item.requiredCustomNodes));
  assert(referencedNodes.size === plan.customNodes.length && plan.customNodes.every((item) => referencedNodes.has(item.id)), 'plan_unselected_custom_node', 'plan contains an unselected custom node');
  assert(!canonicalJson(plan).match(/(?:[A-Za-z]:[\\/]|\\\\|https?:\/\/|sk-[A-Za-z0-9]|bearer\s)/i), 'plan_private_value', 'plan contains a private or absolute value');
  return plan;
}

function canonicalLocal(value) { const resolved = path.resolve(value); return process.platform === 'win32' || WINDOWS_ABSOLUTE.test(resolved) ? resolved.toLowerCase() : resolved; }
function contains(parent, child) { const one = canonicalLocal(parent); const two = canonicalLocal(child); return one === two || two.startsWith(`${one}${path.sep}`); }
async function safeRoot(value, label, io = fs) {
  assert(typeof value === 'string' && (path.isAbsolute(value) || WINDOWS_ABSOLUTE.test(value)) && !UNC.test(value), 'plan_source_invalid', `${label} must be an absolute local path`);
  const lexical = path.resolve(value); assert(lexical !== path.parse(lexical).root, 'plan_source_invalid', `${label} must not be a volume root`);
  const info = await io.lstat(lexical); assert(info.isDirectory() && !info.isSymbolicLink(), 'plan_source_reparse', `${label} must be a non-reparse directory`);
  const real = await io.realpath(lexical); assert(canonicalLocal(real) === canonicalLocal(lexical), 'plan_source_reparse', `${label} redirects through a reparse point`);
  // Windows file IDs routinely exceed Number.MAX_SAFE_INTEGER.  Request bigint
  // metadata so two adjacent directories cannot collapse to the same rounded
  // identity and be mistaken for aliases.
  const realInfo = await io.stat(real, { bigint: true });
  return { path: real, identity: `${String(realInfo.dev ?? '')}:${String(realInfo.ino ?? '')}` };
}
function normalizeBindings(value) { return value instanceof Map ? new Map(value) : new Map(Object.entries(value || {})); }
async function assertSafeOutputLocation(outputDir, io) {
  let existing = outputDir;
  while (true) {
    try { await io.lstat(existing); break; }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      assert(parent !== existing, 'compiler_output_reparse', 'output directory has no safe existing parent');
      existing = parent;
    }
  }
  const info = await io.lstat(existing);
  assert(info.isDirectory() && !info.isSymbolicLink(), 'compiler_output_reparse', 'output directory parent is unsafe');
  const real = await io.realpath(existing);
  assert(canonicalLocal(real) === canonicalLocal(existing), 'compiler_output_reparse', 'output directory parent redirects through a reparse point');
}
async function resolveRoots(plan, sourceRoots, outputDir, io) {
  const bindings = normalizeBindings(sourceRoots);
  assert(!bindings.has(MANAGED_COMFY_COMPILED_SOURCE_ID), 'plan_reserved_binding', 'reserved compiled source binding cannot be supplied');
  const required = new Set([plan.runtime.sourceId, plan.python.sourceId, ...plan.workflows.map((item) => item.sourceId), ...plan.models.map((item) => item.sourceId), ...plan.customNodes.map((item) => item.sourceId)]);
  assert(bindings.size === required.size && [...bindings.keys()].every((key) => required.has(key) && SAFE_ID.test(key)), 'plan_source_binding', 'source bindings must exactly match plan source IDs');
  const resolved = new Map();
  for (const id of [...required].sort(ordinal)) resolved.set(id, await safeRoot(bindings.get(id), `source ${id}`, io));
  const items = [...resolved.entries()];
  for (let left = 0; left < items.length; left += 1) for (let right = left + 1; right < items.length; right += 1) {
    assert(items[left][1].identity !== items[right][1].identity && !contains(items[left][1].path, items[right][1].path) && !contains(items[right][1].path, items[left][1].path), 'plan_source_overlap', 'source roots must not overlap or alias');
  }
  for (const item of items) assert(!contains(item[1].path, outputDir) && !contains(outputDir, item[1].path), 'plan_output_overlap', 'output directory must not overlap source roots');
  return new Map(items.map(([id, item]) => [id, item.path]));
}

async function defaultHash(target) {
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => { const stream = createReadStream(target); stream.on('data', (chunk) => digest.update(chunk)); stream.on('error', reject); stream.on('end', resolve); });
  return digest.digest('hex');
}
function sameStat(left, right) {
  const leftTime = left.mtimeNs ?? left.mtimeMs;
  const rightTime = right.mtimeNs ?? right.mtimeMs;
  return left.size === right.size && leftTime === rightTime && left.dev === right.dev && left.ino === right.ino;
}
async function exactSelectedFile(root, logicalPath, io, category) {
  let current = root;
  for (const [index, segment] of logicalPath.split('/').entries()) {
    assert(!selectionPathForbidden(segment, index, category), 'plan_forbidden_path', `forbidden selected path ${logicalPath}`);
    const entries = await io.readdir(current, { withFileTypes: true });
    const matches = entries.filter((item) => item.name.toLowerCase() === segment.toLowerCase());
    assert(matches.length === 1 && matches[0].name === segment, 'plan_path_ambiguous', `selected path is missing or case-ambiguous: ${logicalPath}`);
    assert(!matches[0].isSymbolicLink(), 'plan_source_reparse', `selected path contains a reparse point: ${logicalPath}`);
    current = path.join(current, segment);
  }
  const info = await io.lstat(current); assert(info.isFile() && !info.isSymbolicLink(), 'plan_file_invalid', `selected path is not a regular file: ${logicalPath}`);
  return current;
}
async function exactSelectedDirectory(root, logicalPath, io, category) {
  let current = root;
  for (const [index, segment] of logicalPath.split('/').entries()) {
    assert(!selectionPathForbidden(segment, index, category), 'plan_forbidden_path', `forbidden selected path ${logicalPath}`);
    const entries = await io.readdir(current, { withFileTypes: true });
    const matches = entries.filter((item) => item.name.toLowerCase() === segment.toLowerCase());
    assert(matches.length === 1 && matches[0].name === segment, 'plan_path_ambiguous', `selected path is missing or case-ambiguous: ${logicalPath}`);
    assert(matches[0].isDirectory() && !matches[0].isSymbolicLink(), 'plan_source_reparse', `selected directory is unsafe: ${logicalPath}`);
    current = path.join(current, segment);
    const info = await io.lstat(current); assert(info.isDirectory() && !info.isSymbolicLink(), 'plan_source_reparse', `selected directory is unsafe: ${logicalPath}`);
  }
  return current;
}
async function expandInclude(root, include, io, category) {
  if (include.kind === 'file') return [include.logicalPath];
  const directory = await exactSelectedDirectory(root, include.logicalPath, io, category);
  const result = [];
  async function walk(current, relative) {
    const entries = await io.readdir(current, { withFileTypes: true }); entries.sort((a, b) => ordinal(a.name, b.name));
    for (const entry of entries) {
      const target = path.join(current, entry.name); const logical = `${relative}/${entry.name}`;
      const depth = logical.split('/').length - 1;
      if (selectionPathForbidden(entry.name, depth, category)) continue;
      const info = await io.lstat(target); assert(!info.isSymbolicLink(), 'plan_source_reparse', `tree contains a reparse point: ${logical}`);
      if (info.isDirectory()) await walk(target, logical); else if (info.isFile()) result.push(logical); else fail('plan_file_invalid', `tree contains unsupported entry: ${logical}`);
    }
  }
  await walk(directory, include.logicalPath); return result;
}

function workflowAllowedNames(plan) { return new Set(plan.models.map((item) => item.logicalPath.split('/').slice(1).join('/'))); }
function isSafeApiNodeId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
  return typeof value === 'string' && SAFE_ID.test(value);
}
function isApiLinkTuple(value) {
  return Array.isArray(value)
    && value.length === 2
    && isSafeApiNodeId(value[0])
    && Number.isSafeInteger(value[1])
    && value[1] >= 0;
}
function classifyWorkflowRoot(workflow, context) {
  assert(workflow && typeof workflow === 'object' && !Array.isArray(workflow), 'workflow_root_rejected', 'workflow root must be an object');
  const entries = Object.entries(workflow);
  const ui = Array.isArray(workflow.nodes) && (workflow.links === undefined || Array.isArray(workflow.links));
  const api = entries.length > 0 && entries.every(([nodeId, node]) => {
    if (!/^\d+$/.test(nodeId) || !Number.isSafeInteger(Number(nodeId))) return false;
    return node
      && typeof node === 'object'
      && !Array.isArray(node)
      && typeof node.class_type === 'string'
      && context.allowedNodeTypes.has(node.class_type)
      && SAFE_ROLE.test(node.class_type)
      && node.inputs
      && typeof node.inputs === 'object'
      && !Array.isArray(node.inputs);
  });
  assert(ui !== api, 'workflow_root_rejected', 'workflow root is mixed, ambiguous, or unsupported');
  if (ui) assert(!entries.some(([key]) => /^\d+$/.test(key)), 'workflow_root_rejected', 'workflow root mixes API and UI nodes');
  return api ? 'api' : 'ui';
}
function sanitizeString(value, key, context) {
  if (context.graphDescriptor && (key === 'name' || key === 'type' || key === 'shape')) return '';
  const exactEnums = (context.apiInputs || context.allowApiTuple) && context.nodeType ? API_STRING_ENUMS[context.nodeType]?.[key] : null;
  if (exactEnums) { assert(exactEnums.has(value), 'workflow_enum_rejected', `unsafe ${context.nodeType}.${key} enum`); return value; }
  if (key === 'class_type' || (key === 'type' && !context.graphDescriptor)) { assert(context.allowedNodeTypes.has(value) && SAFE_ROLE.test(value), 'workflow_string_rejected', `unsafe workflow ${key}`); return value; }
  if (key === 'aiCanvasRole') { assert(SAFE_ROLE.test(value), 'workflow_string_rejected', 'unsafe aiCanvasRole'); return value; }
  if (LOADER_KEYS.has(key)) { assert(context.allowedModels.has(value), 'workflow_loader_rejected', `undeclared loader value for ${key}`); return value; }
  if (key === 'sampler_name') { assert(SAMPLERS.has(value) || ((context.apiInputs || context.allowApiTuple) && context.nodeType === 'KSamplerSelect' && value === 'res_multistep'), 'workflow_enum_rejected', 'sampler is not allowlisted'); return value; }
  if (key === 'scheduler') { assert(SCHEDULERS.has(value), 'workflow_enum_rejected', 'scheduler is not allowlisted'); return value; }
  if (key === 'links' || key === 'inputs' || key === 'outputs') { assert(SAFE_ROLE.test(value), 'workflow_string_rejected', 'unsafe graph socket type'); return value; }
  if (context.widgets) {
    if (context.widgetAllowsModels && context.allowedModels.has(value)) return value;
    return '';
  }
  if (REDACT_VALUE_KEY.test(key)) return '';
  fail('workflow_string_rejected', `unknown string-bearing workflow location: ${key}`);
}
function sanitizeWorkflowValue(value, key, context) {
  if (typeof value === 'string') return sanitizeString(value, key, context);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  assert(value && typeof value === 'object', 'workflow_value_rejected', 'unsupported workflow value');
  if (Array.isArray(value)) {
    if (context.allowApiTuple) {
      assert(!LOADER_KEYS.has(key), 'workflow_loader_rejected', `loader input ${key} must be an allowlisted filename`);
      assert(isApiLinkTuple(value), 'workflow_link_rejected', 'invalid direct API input link tuple');
      return [...value];
    }
    return value.map((item) => sanitizeWorkflowValue(item, key, {
      ...context,
      apiRoot: false,
      apiNode: false,
      apiInputs: false,
      allowApiTuple: false,
      widgets: context.widgets || key === 'widgets_values',
    }));
  }
  const result = {};
  const containingNodeType = context.apiInputs ? null : typeof value.type === 'string' ? value.type : typeof value.class_type === 'string' ? value.class_type : null;
  for (const [childKey, child] of Object.entries(value)) {
    const nodeType = containingNodeType || context.nodeType;
    const exactApiInput = context.apiInputs && API_EXTRA_INPUTS[nodeType]?.has(childKey);
    assert(/^\d+$/.test(childKey) || WORKFLOW_KEYS.has(childKey) || exactApiInput, 'workflow_key_rejected', `unknown workflow key: ${childKey}`);
    assert(!FORBIDDEN_VALUE_KEY.test(childKey), 'workflow_credential_rejected', 'credential-like workflow key rejected');
    if (REMOVE_UI_KEY.has(childKey)) continue;
    if (childKey === '_meta') {
      assert(child && typeof child === 'object' && !Array.isArray(child) && Object.keys(child).every((item) => item === 'title' || item === 'aiCanvasRole'), 'workflow_key_rejected', 'unsafe workflow _meta');
      const role = child.aiCanvasRole;
      result._meta = role === undefined ? {} : { aiCanvasRole: sanitizeString(role, 'aiCanvasRole', context) };
      continue;
    }
    if (childKey === 'groups') { result.groups = []; continue; }
    if (childKey === 'config' || childKey === 'extra') { result[childKey] = {}; continue; }
    if (childKey === 'properties') {
      const role = child && typeof child === 'object' && !Array.isArray(child) ? child.aiCanvasRole : undefined;
      result.properties = role === undefined ? {} : { aiCanvasRole: sanitizeString(role, 'aiCanvasRole', context) };
      continue;
    }
    const apiNode = context.apiRoot && /^\d+$/.test(childKey);
    const apiInputs = context.apiNode && childKey === 'inputs' && child && typeof child === 'object' && !Array.isArray(child);
    result[childKey] = sanitizeWorkflowValue(child, childKey, {
      ...context,
      apiRoot: false,
      apiNode,
      apiInputs,
      allowApiTuple: context.apiInputs,
      widgets: context.widgets || childKey === 'widgets_values',
      widgetAllowsModels: childKey === 'widgets_values' && context.loaderNodeTypes.has(containingNodeType),
      graphDescriptor: context.graphDescriptor || ((childKey === 'inputs' || childKey === 'outputs') && Array.isArray(child)),
      nodeType,
    });
  }
  return result;
}
export function sanitizeManagedComfyWorkflow(workflow, plan) {
  validateManagedComfyCapabilityPlanV1(plan);
  const context = {
    allowedModels: workflowAllowedNames(plan),
    allowedNodeTypes: new Set(Object.values(managedComfyCapabilityCatalog).flatMap((item) => item.requiredNodeTypes)),
    loaderNodeTypes: new Set(Object.values(managedComfyCapabilityCatalog).flatMap((item) => item.loaderInputs.map((loader) => loader.nodeType))),
    widgets: false,
    widgetAllowsModels: false,
    graphDescriptor: false,
    apiRoot: false,
    apiNode: false,
    apiInputs: false,
    allowApiTuple: false,
    nodeType: null,
  };
  const rootKind = classifyWorkflowRoot(workflow, context);
  const sanitized = sanitizeWorkflowValue(structuredClone(workflow), '', { ...context, apiRoot: rootKind === 'api' });
  const serialized = canonicalJson(sanitized);
  assert(!/(?:[A-Za-z]:[\\/]|\\\\|https?:\/\/|data:|bearer\s|sk-[A-Za-z0-9]|credential|password|authorization)/i.test(serialized), 'workflow_privacy_rejected', 'sanitized workflow contains private data');
  return sanitized;
}

async function atomicOwned(target, bytes, owner, io) {
  await io.mkdir(path.dirname(target), { recursive: true });
  if (await io.lstat(target).then(() => true, () => false)) {
    const current = await io.readFile(target); assert(createHash('sha256').update(current).digest('hex') === createHash('sha256').update(bytes).digest('hex'), 'compiler_owned_conflict', `owned target mismatch: ${target}`); return false;
  }
  const part = `${target}.part`;
  if (await io.lstat(part).then(() => true, () => false)) { const current = await io.readFile(part); assert(createHash('sha256').update(current).digest('hex') === createHash('sha256').update(bytes).digest('hex'), 'compiler_owned_conflict', `owned staging mismatch: ${target}`); }
  else await io.writeFile(part, bytes, { flag: 'wx', mode: 0o600 });
  await io.rename(part, target); owner.push(target); return true;
}

export async function compileManagedComfyCapabilityPlan(options) {
  const plan = validateManagedComfyCapabilityPlanV1(structuredClone(options.plan));
  for (const node of plan.customNodes) assert(node.logicalPath === node.id, 'plan_custom_node_target_mismatch', `custom node ${node.id} source must be pre-normalized under its declared ID`);
  const io = options.fsImpl ?? fs; const reader = options.reader ?? ((target) => io.readFile(target)); const hasher = options.hasher ?? defaultHash; const failurePoint = options.failurePoint ?? (async () => {});
  const outputDir = path.resolve(options.outputDir); assert(path.isAbsolute(outputDir) && !UNC.test(outputDir) && outputDir !== path.parse(outputDir).root, 'plan_output_invalid', 'outputDir must be an absolute local non-root path');
  await assertSafeOutputLocation(outputDir, io);
  const roots = await resolveRoots(plan, options.sourceRoots, outputDir, io);
  const preflightTargets = [];
  for (const [section, category] of [[plan.runtime, 'runtime'], [plan.python, 'python_runtime']]) for (const include of section.includes) for (const logical of await expandInclude(roots.get(section.sourceId), include, io, category)) { await exactSelectedFile(roots.get(section.sourceId), logical, io, category); preflightTargets.push(`${section.sourceId}/${logical}/${category}`); }
  for (const node of plan.customNodes) { const selected = await expandInclude(roots.get(node.sourceId), { kind: 'tree', logicalPath: node.logicalPath }, io, 'custom_node'); assert(selected.length > 0, 'plan_custom_node_empty', `custom node ${node.id} contains no selected files`); for (const logical of selected) { await exactSelectedFile(roots.get(node.sourceId), logical, io, 'custom_node'); preflightTargets.push(`${node.sourceId}/${logical}/custom_node`); } }
  for (const model of plan.models) { await exactSelectedFile(roots.get(model.sourceId), model.logicalPath, io, 'model'); preflightTargets.push(`${model.sourceId}/${model.logicalPath}/model`); }
  for (const workflow of plan.workflows) await exactSelectedFile(roots.get(workflow.sourceId), workflow.logicalPath, io, 'workflow');
  assert(new Set(preflightTargets).size === preflightTargets.length, 'plan_duplicate_selection', 'selected source file appears more than once');
  const planDigest = canonicalSha256(plan);
  const existed = await io.lstat(outputDir).then(() => true, () => false);
  if (existed) { const info = await io.lstat(outputDir); assert(info.isDirectory() && !info.isSymbolicLink(), 'compiler_output_reparse', 'output directory is unsafe'); const real = await io.realpath(outputDir); assert(canonicalLocal(real) === canonicalLocal(outputDir), 'compiler_output_reparse', 'output directory redirects'); }
  const manifestPath = path.join(outputDir, FINAL_MANIFEST); const statePath = path.join(outputDir, COMPILER_STATE);
  if (await io.lstat(manifestPath).then(() => true, () => false)) {
    const existing = validateLocalBundleManifestV1(JSON.parse((await io.readFile(manifestPath)).toString('utf8')));
    const state = JSON.parse((await io.readFile(statePath)).toString('utf8'));
    assertClosed(state, ['schemaVersion', 'planDigest'], 'compiler state');
    assert(state.schemaVersion === 'managed-comfy-compiler-state/v1' && state.planDigest === planDigest && existing.bundle.id === plan.bundle.id && existing.bundle.version === plan.bundle.version, 'compiler_output_identity', 'existing final manifest belongs to another plan');
    const top = await io.readdir(outputDir, { withFileTypes: true });
    assert(top.every((entry) => !entry.isSymbolicLink() && [FINAL_MANIFEST, COMPILER_STATE, 'payload'].includes(entry.name)), 'compiler_output_foreign', 'compiled output contains foreign content');
    const compiledEntries = existing.payloadFiles.filter((entry) => entry.sourceId === MANAGED_COMFY_COMPILED_SOURCE_ID);
    const allowed = new Set(compiledEntries.map((entry) => entry.targetPath)); const seen = new Set();
    async function inspectPayload(directory, relative = '') {
      for (const entry of await io.readdir(directory, { withFileTypes: true })) {
        assert(!entry.isSymbolicLink(), 'compiler_output_reparse', 'compiled payload contains a reparse point');
        const next = relative ? `${relative}/${entry.name}` : entry.name; const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await inspectPayload(target, next);
        else { assert(entry.isFile() && allowed.has(next), 'compiler_output_foreign', `compiled payload contains foreign content: ${next}`); const manifestEntry = compiledEntries.find((item) => item.targetPath === next); const bytes = await io.readFile(target); assert(bytes.length === manifestEntry.bytes && createHash('sha256').update(bytes).digest('hex') === manifestEntry.hash.value, 'compiler_owned_conflict', `compiled payload mismatch: ${next}`); seen.add(next); }
      }
    }
    await inspectPayload(path.join(outputDir, 'payload'));
    assert(seen.size === allowed.size, 'compiler_owned_conflict', 'compiled payload is incomplete');
    const bridgeEntry = compiledEntries.find((entry) => entry.targetPath === `extensions/custom-nodes/${MANAGED_COMFY_BRIDGE_ID}/__init__.py`);
    assert(bridgeEntry, 'compiler_bridge_missing', 'compiled manifest is missing bridge payload');
    const repositoryBridge = await io.readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'comfy-bundle', 'bridge', MANAGED_COMFY_BRIDGE_ID, '__init__.py'));
    assert(repositoryBridge.length === bridgeEntry.bytes && createHash('sha256').update(repositoryBridge).digest('hex') === bridgeEntry.hash.value, 'compiler_bridge_mismatch', 'compiled bridge differs from repository source');
    return { state: 'already_compiled', manifest: existing, manifestPath, mutations: 0 };
  }
  if (!existed) await io.mkdir(outputDir, { recursive: false });
  const currentEntries = await io.readdir(outputDir, { withFileTypes: true });
  if (currentEntries.length) {
    assert(currentEntries.every((entry) => !entry.isSymbolicLink() && ['payload', COMPILER_STATE].includes(entry.name)), 'compiler_output_foreign', 'output directory contains foreign content');
    const state = JSON.parse((await io.readFile(statePath)).toString('utf8'));
    assertClosed(state, ['schemaVersion', 'planDigest'], 'compiler state'); assert(state.schemaVersion === 'managed-comfy-compiler-state/v1' && state.planDigest === planDigest, 'compiler_output_identity', 'compiler staging belongs to another plan');
    if (currentEntries.some((entry) => entry.name === 'payload')) {
      const allowedFiles = new Set([
        ...plan.workflows.map((item) => `${logicalTargetPath('workflow', MANAGED_COMFY_COMPILED_SOURCE_ID, `${item.id}.json`)}`),
        `extensions/custom-nodes/${MANAGED_COMFY_BRIDGE_ID}/__init__.py`,
      ]);
      const allowedDirectories = new Set();
      for (const file of allowedFiles) { let parent = path.posix.dirname(file); while (parent !== '.') { allowedDirectories.add(parent); parent = path.posix.dirname(parent); } }
      async function inspectOwned(directory, relative = '') {
        for (const entry of await io.readdir(directory, { withFileTypes: true })) {
          assert(!entry.isSymbolicLink(), 'compiler_output_reparse', 'compiler staging contains a reparse point');
          const next = relative ? `${relative}/${entry.name}` : entry.name; const target = path.join(directory, entry.name);
          if (entry.isDirectory()) { assert(allowedDirectories.has(next), 'compiler_output_foreign', `foreign staging directory: ${next}`); await inspectOwned(target, next); }
          else assert(entry.isFile() && (allowedFiles.has(next) || (next.endsWith('.part') && allowedFiles.has(next.slice(0, -5)))), 'compiler_output_foreign', `foreign staging file: ${next}`);
        }
      }
      await inspectOwned(path.join(outputDir, 'payload'));
    }
  } else await atomicOwned(statePath, Buffer.from(canonicalJson({ schemaVersion: 'managed-comfy-compiler-state/v1', planDigest })), [], io);
  const emitted = []; const mutations = [];
  async function stableReadWorkflow(source, logicalPath) {
    const beforeRead = await io.lstat(source, { bigint: true }); assert(beforeRead.isFile() && !beforeRead.isSymbolicLink(), 'compiler_file_invalid', `selected source is unsafe: ${logicalPath}`);
    assert(beforeRead.size <= BigInt(WORKFLOW_READ_LIMIT), 'compiler_workflow_too_large', `workflow exceeds the bounded read limit: ${logicalPath}`);
    const bytes = await reader(source); const afterRead = await io.lstat(source, { bigint: true });
    assert(afterRead.isFile() && !afterRead.isSymbolicLink() && sameStat(beforeRead, afterRead), 'compiler_source_mutated', `source changed while reading: ${logicalPath}`);
    const size = Number(beforeRead.size);
    assert(Number.isSafeInteger(size) && size >= 0 && Buffer.byteLength(bytes) === size, 'compiler_source_mutated', `source size changed while reading: ${logicalPath}`);
    return { bytes, stat: { size } };
  }
  async function stableHash(source, logicalPath) {
    const beforeHash = await io.lstat(source, { bigint: true }); assert(beforeHash.isFile() && !beforeHash.isSymbolicLink(), 'compiler_file_invalid', `selected source is unsafe: ${logicalPath}`);
    const hash = await hasher(source); const afterHash = await io.lstat(source, { bigint: true });
    assert(afterHash.isFile() && !afterHash.isSymbolicLink() && sameStat(beforeHash, afterHash), 'compiler_source_mutated', `source changed while hashing: ${logicalPath}`);
    assert(SHA256.test(hash), 'compiler_hash_invalid', `source hash is invalid: ${logicalPath}`);
    const size = Number(beforeHash.size);
    assert(Number.isSafeInteger(size) && size >= 0, 'compiler_file_invalid', `source size is invalid: ${logicalPath}`);
    return { hash, stat: { size } };
  }
  async function select(sourceId, logicalPath, category, targetLogical = logicalPath) {
    const source = await exactSelectedFile(roots.get(sourceId), logicalPath, io, category); const selected = await stableHash(source, logicalPath);
    emitted.push({ sourceId, category, logicalPath, targetPath: logicalTargetPath(category, sourceId, targetLogical), bytes: selected.stat.size, hash: { algorithm: 'sha256', state: 'computed', value: selected.hash } });
  }
  for (const [section, category] of [[plan.runtime, 'runtime'], [plan.python, 'python_runtime']]) for (const include of section.includes) for (const logical of await expandInclude(roots.get(section.sourceId), include, io, category)) await select(section.sourceId, logical, category);
  for (const node of plan.customNodes) for (const logical of await expandInclude(roots.get(node.sourceId), { kind: 'tree', logicalPath: node.logicalPath }, io, 'custom_node')) await select(node.sourceId, logical, 'custom_node');
  for (const model of plan.models) await select(model.sourceId, model.logicalPath, 'model');
  assert(new Set(emitted.map((entry) => `${entry.sourceId}/${entry.logicalPath}`)).size === emitted.length, 'plan_duplicate_selection', 'selected source file appears more than once');
  assert(new Set(emitted.map((entry) => entry.targetPath.toLowerCase())).size === emitted.length, 'plan_target_collision', 'selected target paths collide');
  for (const workflow of plan.workflows) {
    const source = await exactSelectedFile(roots.get(workflow.sourceId), workflow.logicalPath, io, 'workflow'); const selected = await stableReadWorkflow(source, workflow.logicalPath); const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(selected.bytes)); const prepared = prepareManagedWorkflow(parsed, { capabilityId: workflow.id, plan }); const sanitized = Buffer.from(canonicalJson(sanitizeManagedComfyWorkflow(prepared.workflow, plan)));
    const logical = `${workflow.id}.json`; const target = logicalTargetPath('workflow', MANAGED_COMFY_COMPILED_SOURCE_ID, logical); await atomicOwned(path.join(outputDir, 'payload', ...target.split('/')), sanitized, mutations, io);
    emitted.push({ sourceId: MANAGED_COMFY_COMPILED_SOURCE_ID, category: 'workflow', logicalPath: logical, targetPath: target, bytes: sanitized.length, hash: { algorithm: 'sha256', state: 'computed', value: createHash('sha256').update(sanitized).digest('hex') } });
  }
  const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const bridgeSource = path.join(productRoot, 'scripts', 'comfy-bundle', 'bridge', MANAGED_COMFY_BRIDGE_ID, '__init__.py'); const bridgeBytes = await io.readFile(bridgeSource); const bridgeLogical = `${MANAGED_COMFY_BRIDGE_ID}/__init__.py`; const bridgeTarget = logicalTargetPath('custom_node', MANAGED_COMFY_COMPILED_SOURCE_ID, bridgeLogical); await atomicOwned(path.join(outputDir, 'payload', ...bridgeTarget.split('/')), bridgeBytes, mutations, io);
  emitted.push({ sourceId: MANAGED_COMFY_COMPILED_SOURCE_ID, category: 'custom_node', logicalPath: bridgeLogical, targetPath: bridgeTarget, bytes: bridgeBytes.length, hash: { algorithm: 'sha256', state: 'computed', value: createHash('sha256').update(bridgeBytes).digest('hex') } });
  emitted.sort((a, b) => ordinal(a.sourceId, b.sourceId) || ordinal(a.logicalPath, b.logicalPath));
  const models = plan.models.map((model) => { const file = emitted.find((item) => item.sourceId === model.sourceId && item.logicalPath === model.logicalPath); return { id: model.id, category: model.category, logicalPath: file.targetPath, bytes: file.bytes, hash: file.hash }; }).sort((a, b) => ordinal(a.id, b.id));
  const workflows = plan.workflows.map((item) => ({ id: item.id, logicalPath: emitted.find((file) => file.category === 'workflow' && file.logicalPath === `${item.id}.json`).targetPath })).sort((a, b) => ordinal(a.id, b.id));
  const manifest = { schemaVersion: 'local-bundle-manifest/v1', bundle: { id: plan.bundle.id, version: plan.bundle.version, digest: '0'.repeat(64) }, buildState: 'build_ready', runtime: { entrypoint: logicalTargetPath('runtime', plan.runtime.sourceId, plan.runtime.executableOrEntrypoint), pythonPortability: 'portable' }, payloadFiles: emitted, customNodes: [...plan.customNodes.map((item) => ({ id: item.id, versionState: item.versionState })), { id: MANAGED_COMFY_BRIDGE_ID, versionState: 'pinned' }].sort((a, b) => ordinal(a.id, b.id)), workflows, models, capabilities: plan.capabilities.map((item) => ({ id: item.id, workflowId: item.workflowId, requiredModels: Object.values(item.modelRoles).sort(ordinal), requiredCustomNodes: [...item.requiredCustomNodes, MANAGED_COMFY_BRIDGE_ID].sort(ordinal) })).sort((a, b) => ordinal(a.id, b.id)), exclusions: [...FORBIDDEN_DIRECTORY].sort(ordinal), localOnly: { uploadForbidden: true, repositoryPayloadForbidden: true } };
  manifest.bundle.digest = managedComfyManifestDigest(manifest); validateLocalBundleManifestV1(manifest);
  await failurePoint('before_manifest_commit', { outputDir, manifest }); await atomicOwned(manifestPath, Buffer.from(canonicalJson(manifest)), mutations, io); await failurePoint('after_manifest_commit', { outputDir, manifest });
  return { state: 'compiled', manifest, manifestPath, mutations: mutations.length };
}
