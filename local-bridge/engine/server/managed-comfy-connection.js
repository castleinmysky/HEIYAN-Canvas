import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalJson,
  validateInstallationReceiptV1,
  validateLocalBundleManifestV1,
} from './managed-comfy-bundle.js';
import { verifyInstallationReceipt } from './managed-comfy-deployment.js';
import {
  assertManagedComfyId,
  managedComfyRequiredNodeTypes,
  resolveManagedComfyCapabilities,
} from './managed-comfy-capability-catalog.js';

export const MANAGED_COMFY_ENDPOINT = 'http://127.0.0.1:8288';
export const MANAGED_COMFY_REGISTRATION = 'managed-comfy-registration-v1.json';
export const MANAGED_COMFY_REGISTRATION_VERSION = 'managed-comfy-registration/v1';
export const MANAGED_COMFY_HEALTH_VERSION = 'echo-canvas-managed-health/v1';
export const MANAGED_COMFY_RUNTIME_HEALTH = 'state/private/runtime-health-v1.json';

const REGISTRATION_LIMIT = 64 * 1024;
const RECEIPT_LIMIT = 4 * 1024 * 1024;
const MANIFEST_LIMIT = 64 * 1024 * 1024;
export const HEALTH_LIMIT = 1024 * 1024;
const WORKFLOW_LIMIT = 16 * 1024 * 1024;
export const OBJECT_LIMIT = 512 * 1024;
export const OBJECT_TOTAL_LIMIT = 8 * 1024 * 1024;
export const OBJECT_COUNT_LIMIT = 64;
export const MANAGED_RESPONSE_DEADLINE_MS = 3000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_NODE = /^[A-Za-z0-9_][A-Za-z0-9_.:+\-()[\] ]{0,127}$/;

function managedError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = 'ManagedComfyConnectionError';
  error.code = code;
  return error;
}

function stableReason(error, fallback) {
  return typeof error?.code === 'string' && /^managed_[a-z0-9_]+$/.test(error.code) ? error.code : fallback;
}

function fail(code, message, cause) { throw managedError(code, message, cause); }
function assert(value, code, message) { if (!value) fail(code, message); }
function canonicalPath(value) { return path.resolve(value).replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase(); }
function samePath(left, right) { return canonicalPath(left) === canonicalPath(right); }
function isUnc(value) { return /^(?:\\\\|\/\/)/.test(String(value || '')); }

function assertLocalAbsolute(value, label) {
  assert(typeof value === 'string' && path.isAbsolute(value) && !isUnc(value), 'managed_path_invalid', `${label} must be an absolute local path`);
  const resolved = path.resolve(value);
  assert(!samePath(resolved, path.parse(resolved).root), 'managed_path_invalid', `${label} must not be a volume root`);
  return resolved;
}

function assertClosed(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'managed_schema_invalid', `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(actual.length === expected.length && actual.every((key, index) => key === expected[index]), 'managed_schema_invalid', `${label} has invalid fields`);
}

function assertId(value, label) {
  assert(typeof value === 'string' && ID_PATTERN.test(value), 'managed_id_invalid', `${label} is invalid`);
  return value;
}

async function exists(target, io = fs) {
  try { await io.lstat(target); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function assertNoReparse(target, label, allowMissingLeaf = false, io = fs) {
  const resolved = assertLocalAbsolute(target, label);
  const root = path.parse(resolved).root;
  const parts = resolved.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let info;
    try { info = await io.lstat(current); }
    catch (error) {
      if (error?.code === 'ENOENT' && allowMissingLeaf) return resolved;
      throw error;
    }
    assert(!info.isSymbolicLink(), 'managed_path_reparse', `${label} contains a symbolic link or junction`);
  }
  return resolved;
}

async function exactChild(parent, name, label, io = fs) {
  assert(!name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..', 'managed_path_invalid', `${label} contains traversal`);
  const matches = (await io.readdir(parent, { withFileTypes: true })).filter((item) => item.name.toLowerCase() === name.toLowerCase());
  assert(matches.length === 1 && matches[0].name === name, 'managed_path_ambiguous', `${label} is missing, case-conflicting, or ambiguous`);
  assert(!matches[0].isSymbolicLink(), 'managed_path_reparse', `${label} is a reparse point`);
  return path.join(parent, matches[0].name);
}

async function resolveExact(root, logicalPath, label, kind = 'file', io = fs) {
  const parts = String(logicalPath || '').replaceAll('\\', '/').split('/');
  assert(parts.length > 0 && parts.every((part) => part && part !== '.' && part !== '..'), 'managed_path_invalid', `${label} is invalid`);
  let current = await assertNoReparse(root, `${label} root`, false, io);
  for (const part of parts) current = await exactChild(current, part, label, io);
  const info = await io.lstat(current);
  assert(!info.isSymbolicLink() && (kind === 'directory' ? info.isDirectory() : info.isFile()), 'managed_path_invalid', `${label} has the wrong file type`);
  return { path: current, stat: info };
}

async function readBoundedJson(target, maximum, label, io = fs) {
  const info = await io.lstat(target);
  assert(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= maximum, 'managed_json_size', `${label} is not a bounded regular file`);
  const bytes = await io.readFile(target);
  assert(bytes.length <= maximum, 'managed_json_size', `${label} exceeds its byte limit`);
  try { return { value: JSON.parse(bytes.toString('utf8')), bytes }; }
  catch (error) { fail('managed_json_invalid', `${label} is not valid JSON`, error); }
}

function validateRegistration(value) {
  assertClosed(value, ['schemaVersion', 'installRoot', 'connectIntent'], 'managed registration');
  assert(value.schemaVersion === MANAGED_COMFY_REGISTRATION_VERSION, 'managed_registration_invalid', 'managed registration version is invalid');
  assertLocalAbsolute(value.installRoot, 'managed registration install root');
  assert(typeof value.connectIntent === 'boolean', 'managed_registration_invalid', 'managed registration intent is invalid');
  return value;
}

async function hashFileDefault(target) {
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(target);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return digest.digest('hex');
}

async function verifyDeclaredFile(root, entry, options = {}) {
  const resolved = await resolveExact(root, entry.targetPath, entry.targetPath, 'file', options.io);
  assert(resolved.stat.size === entry.bytes, 'managed_file_size_mismatch', `size mismatch for ${entry.targetPath}`);
  if (options.hash) {
    assert(entry.hash?.algorithm === 'sha256' && entry.hash?.state === 'computed' && SHA256.test(entry.hash?.value || ''), 'managed_hash_missing', `hash is missing for ${entry.targetPath}`);
    assert(await options.hashFile(resolved.path) === entry.hash.value, 'managed_hash_mismatch', `hash mismatch for ${entry.targetPath}`);
  }
  return resolved.path;
}

function workflowNodeTypes(workflow) {
  const values = [];
  if (workflow && typeof workflow === 'object' && !Array.isArray(workflow)) {
    if (Array.isArray(workflow.nodes)) {
      for (const node of workflow.nodes) if (node && typeof node.type === 'string') values.push(node.type);
    } else {
      for (const node of Object.values(workflow)) if (node && typeof node.class_type === 'string') values.push(node.class_type);
    }
  }
  for (const value of values) assert(SAFE_NODE.test(value), 'managed_workflow_node_invalid', 'workflow contains an unsafe node type');
  return [...new Set(values)].sort();
}

function uniqueCaseInsensitive(values, label) {
  const lowered = values.map((value) => value.toLowerCase());
  assert(new Set(lowered).size === values.length, 'managed_id_ambiguous', `${label} contains a case-insensitive collision`);
}

async function atomicJson(target, value, options = {}) {
  const io = options.io ?? fs;
  const parent = await assertNoReparse(path.dirname(target), 'registration directory', false, io);
  assert(samePath(path.dirname(target), parent), 'managed_path_reparse', 'registration directory redirected');
  if (await exists(target, io)) {
    const current = await io.lstat(target);
    assert(current.isFile() && !current.isSymbolicLink(), 'managed_path_reparse', 'registration destination is not a regular file');
  }
  const temporary = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await io.open(temporary, 'wx', 0o600);
    await handle.writeFile(canonicalJson(value), 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await options.failurePoint?.(options.failureName ?? 'before_registration_replace', { target });
    await io.rename(temporary, target);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await io.rm(temporary, { force: true }).catch(() => {});
  }
}

async function atomicText(target, value, io = fs) {
  const parent = path.dirname(target);
  await assertNoReparse(parent, 'managed cache directory', false, io);
  const temporary = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await io.open(temporary, 'wx', 0o600);
    await handle.writeFile(value, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await io.rename(temporary, target);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await io.rm(temporary, { force: true }).catch(() => {});
  }
}

function responseStatus(state, context, reasonCode = null) {
  return {
    state,
    ...(context?.manifest ? { bundle: { ...context.manifest.bundle } } : {}),
    capabilityCount: state === 'connected' ? context?.projections?.length || 0 : 0,
    reasonCode,
  };
}

function isConnectionRefused(error) {
  return error?.code === 'ECONNREFUSED' || error?.cause?.code === 'ECONNREFUSED';
}

async function cancelReader(reader, reason) {
  try { await reader?.cancel(reason); } catch { /* cancellation is best-effort */ }
}

async function boundedResponseJson(response, maximum, label, options = {}) {
  assert(response && response.status >= 200 && response.status < 300, 'managed_http_status', `${label} returned a non-success status`);
  assert(!response.redirected && response.status !== 301 && response.status !== 302 && response.status !== 307 && response.status !== 308, 'managed_http_redirect', `${label} redirected`);
  const remaining = Math.min(maximum, Number.isSafeInteger(options.remaining) && options.remaining >= 0 ? options.remaining : maximum);
  const lengthHeader = response.headers?.get?.('content-length');
  let declared = 0;
  if (lengthHeader !== null && lengthHeader !== undefined && lengthHeader !== '') {
    assert(/^\d+$/.test(String(lengthHeader)), 'managed_http_size', `${label} has an invalid content length`);
    declared = Number(lengthHeader);
    assert(Number.isSafeInteger(declared) && declared >= 0, 'managed_http_size', `${label} has an invalid content length`);
  }
  if (declared > maximum || declared > remaining) {
    try { await response.body?.cancel?.('managed response declared size exceeded'); } catch { /* cancellation is best-effort */ }
    fail('managed_http_size', `${label} exceeds its byte limit`);
  }
  assert(response.body && typeof response.body.getReader === 'function', 'managed_http_body', `${label} has no readable body`);
  const reader = response.body.getReader();
  options.onReader?.(reader);
  const chunks = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    assert(result.value instanceof Uint8Array, 'managed_http_body', `${label} returned an invalid body chunk`);
    const next = total + result.value.byteLength;
    if (next > maximum || next > remaining) {
      await cancelReader(reader, 'managed response byte limit exceeded');
      fail('managed_http_size', `${label} exceeds its byte limit`);
    }
    total = next;
    chunks.push(Buffer.from(result.value.buffer, result.value.byteOffset, result.value.byteLength));
  }
  const bytes = Buffer.concat(chunks, total);
  let body;
  try { body = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (error) { fail('managed_http_utf8', `${label} is not valid UTF-8`, error); }
  try { return { value: JSON.parse(body), bytes: total }; }
  catch (error) { fail('managed_http_json', `${label} is malformed`, error); }
}

async function requestBoundedJson(fetchImpl, url, init, maximum, label, options = {}) {
  const controller = new AbortController();
  let reader = null;
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const timeout = setTimeout(() => {
    const error = managedError('managed_http_timeout', `${label} exceeded its response deadline`);
    rejectDeadline(error);
    controller.abort(error);
    void cancelReader(reader, error);
  }, MANAGED_RESPONSE_DEADLINE_MS);
  try {
    const response = await Promise.race([
      Promise.resolve(fetchImpl(url, { ...init, signal: controller.signal })),
      deadline,
    ]);
    return await Promise.race([
      boundedResponseJson(response, maximum, label, { remaining: options.remaining, onReader: (value) => { reader = value; } }),
      deadline,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function healthExpected(context) {
  return {
    schemaVersion: MANAGED_COMFY_HEALTH_VERSION,
    bundle: { ...context.manifest.bundle },
    installationId: context.receipt.installation.id,
    capabilityIds: context.manifest.capabilities.map((item) => item.id).sort(),
  };
}

function exactJsonEqual(left, right) { return canonicalJson(left) === canonicalJson(right); }

function loaderChoices(nodeInfo, input) {
  const definition = nodeInfo?.input?.required?.[input] ?? nodeInfo?.input?.optional?.[input];
  return Array.isArray(definition) && Array.isArray(definition[0]) ? definition[0].filter((item) => typeof item === 'string') : [];
}

export function createManagedComfyConnectionManager(options = {}) {
  const privateDir = assertLocalAbsolute(options.privateDir, 'Canvas private directory');
  const io = options.fsImpl ?? fs;
  const hashFile = options.hashFile ?? hashFileDefault;
  const fetchImpl = options.fetchImpl ?? fetch;
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const sleepImpl = options.sleepImpl ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const registrationPath = path.join(privateDir, MANAGED_COMFY_REGISTRATION);
  const pollAttempts = Math.max(1, Math.min(40, Number(options.pollAttempts) || 40));
  const pollIntervalMs = Math.max(0, Math.min(5000, Number(options.pollIntervalMs) || 3000));
  let current = { state: 'not-installed', context: null, reasonCode: null };
  let ownedChild = null;
  let attached = false;
  let generation = 0;
  let connectOperation = null;
  let attachedValidationOperation = null;

  async function registration() {
    await assertNoReparse(privateDir, 'Canvas private directory', true, io);
    if (!await exists(registrationPath, io)) return null;
    return validateRegistration((await readBoundedJson(registrationPath, REGISTRATION_LIMIT, 'managed registration', io)).value);
  }

  async function writeIntent(reg, connectIntent) {
    const next = { schemaVersion: MANAGED_COMFY_REGISTRATION_VERSION, installRoot: reg.installRoot, connectIntent };
    await atomicJson(registrationPath, next, { io, failurePoint: options.registrationFailurePoint });
    return next;
  }

  async function quickVerify() {
    const reg = await registration();
    if (!reg) return null;
    const installRoot = await assertNoReparse(reg.installRoot, 'managed install root', false, io);
    const receiptFile = await resolveExact(installRoot, 'state/private/installation-receipt-v1.json', 'managed receipt', 'file', io);
    const receipt = validateInstallationReceiptV1((await readBoundedJson(receiptFile.path, RECEIPT_LIMIT, 'managed receipt', io)).value);
    assertId(receipt.bundle.id, 'bundle id'); assertId(receipt.bundle.version, 'bundle version'); assertId(receipt.installation.id, 'installation id');
    assert(samePath(receipt.installation.installRoot, installRoot), 'managed_identity_mismatch', 'receipt install root does not match registration');
    assert(receipt.installation.endpoint === MANAGED_COMFY_ENDPOINT, 'managed_endpoint_invalid', 'managed endpoint must be 127.0.0.1:8288');
    assert(receipt.installation.state === 'installed', 'managed_installation_blocked', 'managed installation is not installed');
    assert(receipt.installation.modelRoots.length === 1 && samePath(receipt.installation.modelRoots[0], path.join(installRoot, 'models')), 'managed_model_root_invalid', 'managed model root is invalid');
    const versionLogical = `versions/${receipt.bundle.id}/${receipt.bundle.version}`;
    const versionRoot = (await resolveExact(installRoot, versionLogical, 'managed version root', 'directory', io)).path;
    const manifestFile = await resolveExact(versionRoot, 'bundle-manifest.json', 'managed bundle manifest', 'file', io);
    const manifest = validateLocalBundleManifestV1((await readBoundedJson(manifestFile.path, MANIFEST_LIMIT, 'managed bundle manifest', io)).value);
    assert(manifest.buildState === 'build_ready' && exactJsonEqual(manifest.bundle, receipt.bundle), 'managed_identity_mismatch', 'manifest identity does not match receipt');
    assertId(manifest.bundle.id, 'bundle id');
    assertId(manifest.bundle.version, 'bundle version');
    assertId(receipt.installation.id, 'installation id');
    uniqueCaseInsensitive(manifest.models.map((item) => item.id), 'managed model IDs');
    uniqueCaseInsensitive(manifest.workflows.map((item) => item.id), 'managed workflow IDs');
    uniqueCaseInsensitive(manifest.capabilities.map((item) => item.id), 'managed capability IDs');
    const customNodeIds = manifest.customNodes.map((item) => assertManagedComfyId(item.id, 'custom node id'));
    uniqueCaseInsensitive(customNodeIds, 'managed custom node IDs');
    manifest.models.forEach((item) => assertManagedComfyId(item.id, 'model id'));
    manifest.workflows.forEach((item) => assertManagedComfyId(item.id, 'workflow id'));
    for (const capability of manifest.capabilities) {
      assert(new Set(capability.requiredCustomNodes).size === capability.requiredCustomNodes.length, 'managed_custom_node_duplicate', `capability ${capability.id} repeats a custom node`);
      for (const customNodeId of capability.requiredCustomNodes) {
        assertManagedComfyId(customNodeId, 'required custom node id');
        assert(manifest.customNodes.filter((item) => item.id === customNodeId).length === 1, 'managed_custom_node_declaration', `custom node ${customNodeId} is not declared exactly once`);
      }
    }
    const projections = resolveManagedComfyCapabilities(manifest, receipt);
    const payloadByTarget = new Map();
    for (const entry of manifest.payloadFiles) {
      const key = entry.targetPath.toLowerCase();
      assert(!payloadByTarget.has(key), 'managed_path_ambiguous', 'manifest target paths collide');
      payloadByTarget.set(key, entry);
    }
    const customNodePayloads = new Map(customNodeIds.map((id) => [id, []]));
    for (const entry of manifest.payloadFiles.filter((item) => item.category === 'custom_node')) {
      const parts = entry.targetPath.split('/');
      assert(parts.length >= 4 && parts[0] === 'extensions' && parts[1] === 'custom-nodes', 'managed_custom_node_path', 'custom node payload has an invalid target prefix');
      const customNodeId = parts[2];
      assert(customNodePayloads.has(customNodeId), 'managed_custom_node_orphan', `custom node payload ${entry.targetPath} has no exact declaration`);
      assert(entry.hash?.algorithm === 'sha256' && entry.hash?.state === 'computed' && SHA256.test(entry.hash?.value || ''), 'managed_custom_node_hash', `custom node payload ${entry.targetPath} has no computed SHA-256`);
      customNodePayloads.get(customNodeId).push(entry);
    }
    for (const [customNodeId, entries] of customNodePayloads) {
      assert(entries.length > 0, 'managed_custom_node_missing', `custom node ${customNodeId} has no payload`);
      for (const entry of entries) await verifyDeclaredFile(versionRoot, entry, { io, hash: false, hashFile });
    }
    const pythonEntries = manifest.payloadFiles.filter((entry) => entry.category === 'python_runtime' && ['runtime/python/python.exe', 'runtime/python/Scripts/python.exe'].includes(entry.targetPath));
    assert(pythonEntries.length === 1, 'managed_python_invalid', 'exactly one declared Python executable is required');
    assert(manifest.payloadFiles.filter((entry) => entry.category === 'python_runtime' && /(?:^|\/)python\.exe$/i.test(entry.targetPath)).length === 1, 'managed_python_invalid', 'Python executable declaration is ambiguous');
    const entrypointEntries = manifest.payloadFiles.filter((entry) => entry.category === 'runtime' && entry.targetPath === manifest.runtime.entrypoint);
    assert(entrypointEntries.length === 1, 'managed_entrypoint_invalid', 'exactly one declared entrypoint is required');
    const python = await verifyDeclaredFile(versionRoot, pythonEntries[0], { io, hash: true, hashFile });
    const entrypoint = await verifyDeclaredFile(versionRoot, entrypointEntries[0], { io, hash: true, hashFile });
    const workflowNodes = [];
    for (const projection of projections) {
      const entry = payloadByTarget.get(projection.workflow.logicalPath.toLowerCase());
      assert(entry?.category === 'workflow', 'managed_workflow_missing', `workflow ${projection.workflowId} is not a declared payload`);
      const target = await verifyDeclaredFile(versionRoot, entry, { io, hash: true, hashFile });
      const parsed = (await readBoundedJson(target, WORKFLOW_LIMIT, `managed workflow ${projection.workflowId}`, io)).value;
      workflowNodes.push(...workflowNodeTypes(parsed));
    }
    for (const projection of projections) {
      for (const modelId of Object.values(projection.catalog.requiredModelRoles)) {
        const model = manifest.models.find((item) => item.id === modelId);
        const payloadMatches = manifest.payloadFiles.filter((entry) => entry.category === 'model' && entry.targetPath === model.logicalPath && entry.bytes === model.bytes && entry.hash?.value === model.hash?.value);
        assert(payloadMatches.length === 1, 'managed_model_manifest_mismatch', `model ${modelId} has no exact payload entry`);
        await verifyDeclaredFile(installRoot, payloadMatches[0], { io, hash: false, hashFile });
      }
    }
    return { registration: reg, installRoot, versionRoot, receipt, manifest, projections, python, entrypoint, workflowNodeTypes: [...new Set(workflowNodes)].sort() };
  }

  async function health(context) {
    let result;
    try {
      result = await requestBoundedJson(fetchImpl, `${MANAGED_COMFY_ENDPOINT}/echo-canvas/managed/v1/health`, {
        method: 'GET', redirect: 'manual',
      }, HEALTH_LIMIT, 'managed health');
    } catch (error) {
      if (isConnectionRefused(error)) return { refused: true };
      if (typeof error?.code === 'string' && error.code.startsWith('managed_')) throw error;
      fail('managed_health_unreachable', 'managed health request failed', error);
    }
    const payload = result.value;
    assertClosed(payload, ['schemaVersion', 'bundle', 'installationId', 'capabilityIds'], 'managed health');
    assertClosed(payload.bundle, ['id', 'version', 'digest'], 'managed health bundle');
    assert(Array.isArray(payload.capabilityIds) && payload.capabilityIds.every((item) => typeof item === 'string'), 'managed_health_identity', 'managed health capability IDs are invalid');
    assert(payload.capabilityIds.every((item, index) => index === 0 || payload.capabilityIds[index - 1] < item), 'managed_health_identity', 'managed health capability IDs must be sorted and unique');
    assert(exactJsonEqual(payload, healthExpected(context)), 'managed_health_identity', 'managed runtime identity does not match installation');
    return { refused: false };
  }

  async function objectInfo(context) {
    const nodeTypes = managedComfyRequiredNodeTypes(context.projections, context.workflowNodeTypes);
    assert(nodeTypes.length <= OBJECT_COUNT_LIMIT, 'managed_object_info_count', 'managed object-info request count exceeds limit');
    let total = 0;
    const definitions = new Map();
    for (const nodeType of nodeTypes) {
      let result;
      try {
        result = await requestBoundedJson(fetchImpl, `${MANAGED_COMFY_ENDPOINT}/object_info/${encodeURIComponent(nodeType)}`, {
          method: 'GET', redirect: 'manual',
        }, OBJECT_LIMIT, `object-info ${nodeType}`, { remaining: OBJECT_TOTAL_LIMIT - total });
      } catch (error) {
        if (typeof error?.code === 'string' && error.code.startsWith('managed_')) throw error;
        fail('managed_object_info_unreachable', `object-info failed for ${nodeType}`, error);
      }
      const payload = result.value;
      total += result.bytes;
      assert(payload && typeof payload === 'object' && payload[nodeType] && typeof payload[nodeType] === 'object', 'managed_object_info_invalid', `object-info is missing ${nodeType}`);
      definitions.set(nodeType, payload[nodeType]);
    }
    for (const projection of context.projections) {
      for (const loader of projection.catalog.loaderInputs) {
        const choices = loaderChoices(definitions.get(loader.nodeType), loader.input);
        for (const role of loader.roles) assert(choices.includes(projection.runtimeModels[role]), 'managed_loader_model_missing', `${loader.nodeType}.${loader.input} does not expose ${role}`);
      }
    }
  }

  async function writeExtraPaths(context) {
    for (const directory of ['state', 'state/cache', 'state/input', 'state/output', 'state/temp', 'state/user', 'state/logs', 'state/private']) {
      const target = path.join(context.installRoot, ...directory.split('/'));
      await io.mkdir(target, { recursive: true });
      await assertNoReparse(target, directory, false, io);
    }
    const categories = [...new Set(context.manifest.models.map((item) => item.category))].sort();
    for (const category of categories) assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(category), 'managed_model_category_invalid', 'model category is invalid');
    const lines = ['echo_ai_canvas:', `  base_path: ${JSON.stringify(context.installRoot)}`, '  custom_nodes: versions/' + context.manifest.bundle.id + '/' + context.manifest.bundle.version + '/extensions/custom-nodes'];
    for (const category of categories) lines.push(`  ${category}: models/${category}`);
    const target = path.join(context.installRoot, 'state', 'cache', 'managed-extra-paths-v1.yaml');
    await atomicText(target, `${lines.join('\n')}\n`, io);
    return target;
  }

  async function writeRuntimeHealth(context) {
    const target = path.join(context.installRoot, ...MANAGED_COMFY_RUNTIME_HEALTH.split('/'));
    const value = healthExpected(context);
    await atomicJson(target, value, {
      io,
      failurePoint: options.runtimeHealthFailurePoint,
      failureName: 'before_runtime_health_replace',
    });
    return target;
  }

  async function publishIfReady(context, token, ownership) {
    await objectInfo(context);
    if (generation !== token || current.state !== 'starting') return false;
    context.projections = resolveManagedComfyCapabilities(context.manifest, context.receipt);
    current = { state: 'connected', context, reasonCode: null };
    attached = ownership === 'attached';
    return true;
  }

  async function pollOwned(context, token, child) {
    try {
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        if (generation !== token || ownedChild !== child) return;
        if (attempt) await sleepImpl(pollIntervalMs);
        const result = await health(context);
        if (!result.refused) { await publishIfReady(context, token, 'owned'); return; }
      }
      fail('managed_start_timeout', 'managed runtime did not become ready in time');
    } catch (error) {
      if (generation !== token || ownedChild !== child) return;
      current = { state: 'repair-required', context, reasonCode: stableReason(error, 'managed_start_failed') };
      ownedChild = null;
      if (!child.killed) child.kill();
    }
  }

  async function validateAttachedConnection() {
    if (current.state !== 'connected' || !current.context || !attached) return current.state === 'connected';
    if (attachedValidationOperation) return attachedValidationOperation;
    const token = generation;
    const previousContext = current.context;
    let operation;
    operation = (async () => {
      let context = previousContext;
      try {
        context = await quickVerify();
        assert(context, 'managed_not_installed', 'managed runtime is not installed');
        const result = await health(context);
        assert(!result.refused, 'managed_health_unreachable', 'attached managed runtime refused the health request');
        await objectInfo(context);
        if (generation !== token || current.state !== 'connected' || !attached) return false;
        current = { state: 'connected', context, reasonCode: null };
        return true;
      } catch (error) {
        if (generation === token && current.state === 'connected' && attached) {
          generation += 1;
          attached = false;
          current = { state: 'repair-required', context, reasonCode: stableReason(error, 'managed_attached_validation_failed') };
        }
        return false;
      }
    })();
    attachedValidationOperation = operation;
    try { return await operation; }
    finally { if (attachedValidationOperation === operation) attachedValidationOperation = null; }
  }

  async function connect() {
    if (connectOperation) return connectOperation;
    connectOperation = (async () => {
      if (current.state === 'starting') return responseStatus(current.state, current.context, current.reasonCode);
      if (current.state === 'connected') {
        if (attached) await validateAttachedConnection();
        return responseStatus(current.state, current.context, current.reasonCode);
      }
      let context;
      try { context = await quickVerify(); }
      catch (error) { current = { state: 'repair-required', context: null, reasonCode: stableReason(error, 'managed_validation_failed') }; return responseStatus(current.state, null, current.reasonCode); }
      if (!context) { current = { state: 'not-installed', context: null, reasonCode: null }; return responseStatus('not-installed', null, null); }
      try { context.registration = await writeIntent(context.registration, true); }
      catch (error) { return responseStatus('installed', context, stableReason(error, 'managed_registration_write_failed')); }
      const token = ++generation;
      current = { state: 'starting', context, reasonCode: null };
      try { await writeRuntimeHealth(context); }
      catch (error) {
        if (generation !== token || current.state !== 'starting') return responseStatus(current.state, current.context, current.reasonCode);
        current = { state: 'repair-required', context, reasonCode: 'managed_runtime_health_write_failed' };
        return responseStatus(current.state, context, current.reasonCode);
      }
      if (generation !== token || current.state !== 'starting') return responseStatus(current.state, current.context, current.reasonCode);
      let initial;
      try { initial = await health(context); }
      catch (error) { current = { state: 'repair-required', context, reasonCode: stableReason(error, 'managed_health_failed') }; return responseStatus(current.state, context, current.reasonCode); }
      if (!initial.refused) {
        try { await publishIfReady(context, token, 'attached'); }
        catch (error) { current = { state: 'repair-required', context, reasonCode: stableReason(error, 'managed_preflight_failed') }; }
        return responseStatus(current.state, current.context, current.reasonCode);
      }
      let config;
      try { config = await writeExtraPaths(context); }
      catch (error) { current = { state: 'repair-required', context, reasonCode: stableReason(error, 'managed_config_failed') }; return responseStatus(current.state, context, current.reasonCode); }
      let child;
      try {
        const runtimeEnv = {
          ...process.env,
          PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1', DIFFUSERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1',
          HF_HOME: path.join(context.installRoot, 'state', 'cache', 'huggingface'),
          HUGGINGFACE_HUB_CACHE: path.join(context.installRoot, 'state', 'cache', 'huggingface'),
          TORCH_HOME: path.join(context.installRoot, 'state', 'cache', 'torch'),
          MPLCONFIGDIR: path.join(context.installRoot, 'state', 'cache', 'matplotlib'),
          NUMBA_CACHE_DIR: path.join(context.installRoot, 'state', 'cache', 'numba'),
        };
        delete runtimeEnv.PYTHONHOME;
        delete runtimeEnv.PYTHONPATH;
        child = spawnImpl(context.python, [
          '-B', '-s', context.entrypoint, '--listen', '127.0.0.1', '--port', '8288', '--disable-auto-launch',
          '--base-directory', path.join(context.installRoot, 'state'),
          '--models-directory', path.join(context.installRoot, 'models'),
          '--user-directory', path.join(context.installRoot, 'state', 'user'),
          '--extra-model-paths-config', config,
          '--input-directory', path.join(context.installRoot, 'state', 'input'),
          '--output-directory', path.join(context.installRoot, 'state', 'output'),
          '--temp-directory', path.join(context.installRoot, 'state', 'temp'),
          '--disable-all-custom-nodes', '--whitelist-custom-nodes',
          ...context.manifest.customNodes.map((item) => item.id).sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
        ], { cwd: path.join(context.versionRoot, 'runtime', 'comfyui'), env: runtimeEnv, shell: false, windowsHide: true, detached: false });
        assert(child && typeof child.once === 'function' && typeof child.kill === 'function', 'managed_spawn_handle_invalid', 'managed runtime did not return a ChildProcess handle');
        // Keep verbose Python startup from blocking on full pipe buffers.
        child.stdout?.resume?.();
        child.stderr?.resume?.();
      } catch (error) {
        current = { state: 'repair-required', context, reasonCode: stableReason(error, 'managed_spawn_error') };
        return responseStatus(current.state, context, current.reasonCode);
      }
      ownedChild = child;
      attached = false;
      child.once?.('error', (error) => {
        if (generation === token && ownedChild === child) {
          ownedChild = null;
          current = { state: 'repair-required', context, reasonCode: stableReason(error, 'managed_spawn_error') };
        }
      });
      child.once?.('exit', () => {
        if (generation === token && ownedChild === child) {
          ownedChild = null;
          current = { state: 'repair-required', context, reasonCode: 'managed_owned_process_exit' };
        }
      });
      void pollOwned(context, token, child);
      return responseStatus('starting', context, null);
    })();
    try { return await connectOperation; }
    finally { connectOperation = null; }
  }

  async function status() {
    if (current.state === 'starting') return responseStatus(current.state, current.context, current.reasonCode);
    if (current.state === 'connected' && attached) {
      await validateAttachedConnection();
      return responseStatus(current.state, current.context, current.reasonCode);
    }
    try {
      const context = await quickVerify();
      if (!context) { current = { state: 'not-installed', context: null, reasonCode: null }; }
      else if (current.state === 'connected') { current = { state: 'connected', context, reasonCode: null }; }
      else if (current.state === 'repair-required') { current = { ...current, context }; }
      else { current = { state: 'installed', context, reasonCode: null }; }
    } catch (error) { current = { state: 'repair-required', context: null, reasonCode: stableReason(error, 'managed_validation_failed') }; }
    return responseStatus(current.state, current.context, current.reasonCode);
  }

  async function verify(body) {
    assertClosed(body, ['scope'], 'managed verify request');
    assert(body.scope === 'quick' || body.scope === 'full', 'managed_verify_scope', 'managed verify scope is invalid');
    let context;
    try {
      context = await quickVerify();
      assert(context, 'managed_not_installed', 'managed runtime is not installed');
      if (body.scope === 'full') {
        const verified = await verifyInstallationReceipt(context.receipt, context.manifest, { hooks: options.deploymentHooks });
        assert(verified === true, 'managed_full_verification_failed', 'managed payload failed full verification');
      }
      if (current.state !== 'connected' && current.state !== 'starting') current = { state: 'installed', context, reasonCode: null };
      return responseStatus(current.state, current.context || context, current.reasonCode);
    } catch (error) {
      const preservedContext = current.context || context || null;
      current = { state: 'repair-required', context: preservedContext, reasonCode: stableReason(error, 'managed_verify_failed') };
      return responseStatus(current.state, preservedContext, current.reasonCode);
    }
  }

  async function disconnect() {
    let reg;
    try { reg = await registration(); }
    catch (error) { return responseStatus(current.state, current.context, stableReason(error, 'managed_registration_invalid')); }
    if (!reg) { current = { state: 'not-installed', context: null, reasonCode: null }; return responseStatus('not-installed', null, null); }
    try { await writeIntent(reg, false); }
    catch (error) { return responseStatus(current.state, current.context, stableReason(error, 'managed_registration_write_failed')); }
    generation += 1;
    const child = ownedChild;
    ownedChild = null;
    attached = false;
    current = { state: 'installed', context: current.context, reasonCode: null };
    if (child && !child.killed) child.kill();
    return responseStatus('installed', current.context, null);
  }

  async function models(storedModels = []) {
    if (current.state === 'connected' && attached) await validateAttachedConnection();
    if (current.state !== 'connected' || !current.context) return [];
    const projected = current.context.projections.map((item) => structuredClone(item.model));
    const ids = [...storedModels.map((item) => String(item?.id || '')), ...projected.map((item) => item.id)];
    if (new Set(ids.map((item) => item.toLowerCase())).size !== ids.length) {
      current = { state: 'repair-required', context: current.context, reasonCode: 'managed_model_id_collision' };
      return [];
    }
    return projected;
  }

  function catalogResources() {
    if (current.state !== 'connected' || !current.context) return [];
    return current.context.projections.map((projection) => ({
      modelId: projection.model.id,
      adapter: projection.catalog.adapter,
      workflowIds: [projection.workflowId],
      models: { ...projection.runtimeModels },
      ready: true,
    }));
  }

  return { status, connect, verify, disconnect, models, catalogResources, quickVerify, registrationPath };
}
