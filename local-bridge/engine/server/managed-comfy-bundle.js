import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  lstat,
  open,
  readdir,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INVENTORY_REPORT_VERSION = 'inventory-report/v1';
export const LOCAL_BUNDLE_MANIFEST_VERSION = 'local-bundle-manifest/v1';
export const INSTALLATION_RECEIPT_VERSION = 'installation-receipt/v1';

const SOURCE_KINDS = new Set(['comfy', 'models', 'workflows']);
const PAYLOAD_CATEGORIES = new Set(['runtime', 'python_runtime', 'custom_node', 'workflow', 'model']);
const HASH_STATES = new Set(['not_computed', 'computed']);
const TOP_LEVEL_EXCLUDED_DIRECTORIES = new Set([
  '.git', 'user', 'input', 'output', 'temp', 'tmp', 'cache', 'caches', 'log', 'logs',
]);
const ALWAYS_EXCLUDED_DIRECTORIES = new Set([
  '.cache', 'cache', 'caches', '.huggingface', '.hf-xet-stage', '.tmp', 'tmp', 'temp',
  '__pycache__', '.git', '.venv', 'venv',
]);
const SECRET_FILE_PATTERNS = [
  /^\.env(?:\..+)?$/i,
  /^credentials\.json$/i,
  /^secrets\.json$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /api[-_]?key/i,
  /access[-_]?token/i,
  /refresh[-_]?token/i,
  /credential/i,
  /secret/i,
];
const INCOMPLETE_FILE_PATTERNS = [
  /\.part$/i,
  /\.partial$/i,
  /\.download$/i,
  /\.crdownload$/i,
  /\.incomplete$/i,
  /\.aria2$/i,
  /\.tmp$/i,
];
const GENERATED_MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff',
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.wav', '.mp3', '.flac', '.ogg',
]);
const NATIVE_BINARY_EXTENSIONS = new Set(['.pyd', '.dll', '.so', '.dylib', '.exe']);
const MODEL_EXTENSIONS = new Set([
  '.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf', '.onnx', '.engine',
]);
const LICENSE_NAMES = /^(license|copying|notice)(\..+)?$/i;
const WORKFLOW_MEDIA_KEYS = /(?:image|video|audio|file|filename|path|directory|folder|upload|output)/i;
const WORKFLOW_SECRET_KEYS = /(?:api.?key|token|credential|secret|password|authorization)/i;
const WORKFLOW_PROMPT_KEYS = /(?:prompt|text|caption|description|positive|negative)/i;
const WORKFLOW_HISTORY_KEYS = /(?:history|recent|last.?value)/i;
const URL_VALUE = /^[a-z][a-z0-9+.-]*:\/\//i;
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;
const UNC_ABSOLUTE = /^(?:\\\\|\/\/)/;
const SAFE_NODE_TYPE = /^[\p{L}\p{N}_][\p{L}\p{N}_.:+\-()[\] ]{0,127}$/u;
const NODE_TYPE_CREDENTIAL_VALUE = /(?:^bearer\s+\S+|^sk-[a-z0-9_-]{4,}|(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|password|credential|secret|authorization)[ _:.=-]+\S{4,})/i;
const RESERVED_NODE_TYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const REDACTED_NODE_TYPE = '__redacted_node_type__';
const UNSAFE_NODE_TYPE_FINDING = 'unsafe_node_type_redacted';
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const TARGET_PREFIX = {
  runtime: 'runtime/comfyui/',
  python_runtime: 'runtime/python/',
  custom_node: 'extensions/custom-nodes/',
  workflow: 'workflows/',
  model: 'models/',
};

function fail(message) {
  const error = new Error(message);
  error.name = 'ManagedComfyBundleValidationError';
  throw error;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertClosedObject(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`);
  for (const key of keys) assert(Object.hasOwn(value, key), `${label} is missing ${key}`);
}

function assertString(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
}

function assertInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer`);
}

function isAbsoluteLike(value) {
  return typeof value === 'string' && (path.isAbsolute(value) || WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value));
}

export function normalizeLogicalPath(value) {
  assertString(value, 'logical path');
  const normalized = value.replaceAll('\\', '/');
  assert(!isAbsoluteLike(normalized), `logical path must be relative: ${value}`);
  assert(normalized !== '.' && !normalized.startsWith('/') && !normalized.endsWith('/'), `logical path is not normalized: ${value}`);
  assert(!normalized.split('/').some((part) => part === '' || part === '.' || part === '..'), `logical path is not normalized: ${value}`);
  return normalized;
}

export function validateLogicalTargetPath(value, category) {
  const normalized = normalizeLogicalPath(value);
  for (const segment of normalized.split('/')) {
    assert(!WINDOWS_RESERVED_SEGMENT.test(segment), `logical target contains reserved Windows name: ${segment}`);
    assert(!/[<>:"|?*\u0000-\u001f]/.test(segment), `logical target contains an invalid Windows character: ${segment}`);
    assert(!/[ .]$/.test(segment), `logical target contains a trailing dot or space: ${segment}`);
  }
  const prefix = TARGET_PREFIX[category];
  assert(prefix && normalized.startsWith(prefix), `logical target does not match ${category} layout: ${normalized}`);
  assert(!normalized.startsWith('state/'), 'mutable or private state cannot be an immutable payload target');
  return normalized;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortByLogicalPath(values) {
  return values.sort((left, right) => compareText(left.sourceId ?? '', right.sourceId ?? '') || compareText(left.logicalPath ?? left.id ?? '', right.logicalPath ?? right.id ?? ''));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareText).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function canonicalSha256(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function managedComfyManifestDigest(manifest) {
  const preimage = structuredClone(manifest);
  validateLocalBundleManifestV1(preimage, { skipDigestMatch: true });
  delete preimage.bundle.digest;
  return canonicalSha256(preimage);
}

function notComputedHash() {
  return { algorithm: 'sha256', state: 'not_computed', value: null };
}

async function sha256File(filePath) {
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return { algorithm: 'sha256', state: 'computed', value: digest.digest('hex') };
}

function createInventoryIo(observer, fsImpl) {
  const implementation = fsImpl ?? { access, lstat, open, readdir, readFile, realpath, stat };
  const observe = async (operation, target) => {
    if (observer) await observer(operation, String(target));
  };
  return {
    async access(target, ...args) { await observe('access', target); return implementation.access(target, ...args); },
    async hash(target) { await observe('hash', target); return implementation.hash ? implementation.hash(target) : sha256File(target); },
    async lstat(target, ...args) { await observe('lstat', target); return implementation.lstat(target, ...args); },
    async open(target, ...args) { await observe('open', target); return implementation.open(target, ...args); },
    async readdir(target, ...args) { await observe('readdir', target); return implementation.readdir(target, ...args); },
    async readFile(target, ...args) { await observe('readFile', target); return implementation.readFile(target, ...args); },
    async realpath(target, ...args) { await observe('realpath', target); return implementation.realpath(target, ...args); },
    async stat(target, ...args) { await observe('stat', target); return implementation.stat(target, ...args); },
  };
}

function validateHash(hash, label, requireComputed = false) {
  assertClosedObject(hash, ['algorithm', 'state', 'value'], label);
  assert(hash.algorithm === 'sha256', `${label}.algorithm must be sha256`);
  assert(HASH_STATES.has(hash.state), `${label}.state is invalid`);
  if (hash.state === 'computed') assert(typeof hash.value === 'string' && /^[a-f0-9]{64}$/.test(hash.value), `${label}.value must be lowercase SHA-256`);
  if (hash.state === 'not_computed') assert(hash.value === null, `${label}.value must be null when not computed`);
  if (requireComputed) assert(hash.state === 'computed', `${label} must be computed for a build-ready manifest`);
}

function validateCounter(counter, label, keys) {
  assertClosedObject(counter, keys, label);
  for (const key of keys) assertInteger(counter[key], `${label}.${key}`);
}

function scanForPrivateStrings(value, label, allowAbsolute = false) {
  if (typeof value === 'string') {
    if (!allowAbsolute) assert(!isAbsoluteLike(value), `${label} contains an absolute path`);
    assert(!URL_VALUE.test(value), `${label} contains a URL`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForPrivateStrings(item, `${label}[${index}]`, allowAbsolute));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assert(!WORKFLOW_SECRET_KEYS.test(key), `${label} contains a credential-like field`);
      assert(!isAbsoluteLike(key), `${label} contains an absolute path in an object key`);
      assert(!URL_VALUE.test(key), `${label} contains a URL in an object key`);
      assert(!/[\u0000-\u001f\u007f]/.test(key), `${label} contains a control character in an object key`);
      scanForPrivateStrings(child, `${label}.${key}`, allowAbsolute);
    }
  }
}

function validateFinding(value, label) {
  assertClosedObject(value, ['code', 'count'], label);
  assertString(value.code, `${label}.code`);
  assertInteger(value.count, `${label}.count`);
  assert(value.count > 0, `${label}.count must be greater than zero`);
}

function validatePayloadFile(value, label, requireComputed = false) {
  assertClosedObject(value, ['sourceId', 'category', 'logicalPath', 'targetPath', 'bytes', 'hash'], label);
  assertString(value.sourceId, `${label}.sourceId`);
  assert(PAYLOAD_CATEGORIES.has(value.category), `${label}.category is invalid`);
  assert(normalizeLogicalPath(value.logicalPath) === value.logicalPath, `${label}.logicalPath must use forward slashes`);
  assert(validateLogicalTargetPath(value.targetPath, value.category) === value.targetPath, `${label}.targetPath must use the canonical layout`);
  assert(logicalTargetPath(value.category, value.sourceId, value.logicalPath) === value.targetPath, `${label}.targetPath does not match its source mapping`);
  assertInteger(value.bytes, `${label}.bytes`);
  validateHash(value.hash, `${label}.hash`, requireComputed);
}

function assertUnique(values, selector, label) {
  const seen = new Set();
  for (const value of values) {
    const key = selector(value);
    assert(!seen.has(key), `${label} contains duplicate ${key}`);
    seen.add(key);
  }
}

function assertSorted(values, selector, label) {
  for (let index = 1; index < values.length; index += 1) {
    assert(compareText(selector(values[index - 1]), selector(values[index])) <= 0, `${label} must be deterministically sorted`);
  }
}

function assertPayloadFilesSorted(values, label) {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    const sourceOrder = compareText(previous.sourceId, current.sourceId);
    assert(sourceOrder < 0 || (sourceOrder === 0 && compareText(previous.logicalPath, current.logicalPath) <= 0), `${label} must be deterministically sorted`);
  }
}

export function validateInventoryReportV1(report) {
  assertClosedObject(report, [
    'schemaVersion', 'hashMode', 'sources', 'payloadFiles', 'runtime', 'customNodes',
    'workflows', 'models', 'exclusions', 'portability', 'summary',
  ], 'InventoryReportV1');
  assert(report.schemaVersion === INVENTORY_REPORT_VERSION, 'InventoryReportV1.schemaVersion is invalid');
  assert(report.hashMode === 'none' || report.hashMode === 'all', 'InventoryReportV1.hashMode is invalid');
  assert(Array.isArray(report.sources) && report.sources.length >= 2, 'InventoryReportV1.sources must contain explicit roots');
  report.sources.forEach((source, index) => {
    assertClosedObject(source, ['id', 'kind'], `sources[${index}]`);
    assertString(source.id, `sources[${index}].id`);
    assert(SOURCE_KINDS.has(source.kind), `sources[${index}].kind is invalid`);
  });
  assertUnique(report.sources, (source) => source.id, 'sources');
  assertSorted(report.sources, (source) => source.id, 'sources');
  assert(Array.isArray(report.payloadFiles) && report.payloadFiles.length > 0, 'InventoryReportV1.payloadFiles must not be empty');
  report.payloadFiles.forEach((file, index) => validatePayloadFile(file, `payloadFiles[${index}]`, report.hashMode === 'all'));
  assertUnique(report.payloadFiles, (file) => `${file.sourceId}/${file.logicalPath}`, 'payloadFiles');
  assertUnique(report.payloadFiles, (file) => file.targetPath.toLowerCase(), 'payload target paths');
  assertPayloadFilesSorted(report.payloadFiles, 'payloadFiles');

  assertClosedObject(report.runtime, ['fileCount', 'bytes', 'nativeBinaryCount', 'python'], 'runtime');
  assertInteger(report.runtime.fileCount, 'runtime.fileCount');
  assertInteger(report.runtime.bytes, 'runtime.bytes');
  assertInteger(report.runtime.nativeBinaryCount, 'runtime.nativeBinaryCount');
  assertClosedObject(report.runtime.python, ['state', 'configPresent', 'findings'], 'runtime.python');
  assert(['portable', 'machine_bound', 'missing'].includes(report.runtime.python.state), 'runtime.python.state is invalid');
  assert(typeof report.runtime.python.configPresent === 'boolean', 'runtime.python.configPresent must be boolean');
  assert(Array.isArray(report.runtime.python.findings), 'runtime.python.findings must be an array');
  report.runtime.python.findings.forEach((finding) => assertString(finding, 'runtime.python.finding'));
  assertSorted(report.runtime.python.findings, (finding) => finding, 'runtime.python.findings');

  assertClosedObject(report.customNodes, ['records', 'fileCount', 'bytes'], 'customNodes');
  assert(Array.isArray(report.customNodes.records), 'customNodes.records must be an array');
  report.customNodes.records.forEach((record, index) => {
    const label = `customNodes.records[${index}]`;
    assertClosedObject(record, ['id', 'logicalPath', 'fileCount', 'bytes', 'versionState', 'nativeBinaryCount', 'findings'], label);
    assertString(record.id, `${label}.id`);
    assert(normalizeLogicalPath(record.logicalPath) === record.logicalPath, `${label}.logicalPath is invalid`);
    assertInteger(record.fileCount, `${label}.fileCount`);
    assertInteger(record.bytes, `${label}.bytes`);
    assert(['versioned_unverified', 'unversioned'].includes(record.versionState), `${label}.versionState is invalid`);
    assertInteger(record.nativeBinaryCount, `${label}.nativeBinaryCount`);
    assert(Array.isArray(record.findings), `${label}.findings must be an array`);
    record.findings.forEach((finding) => assertString(finding, `${label}.finding`));
    assertSorted(record.findings, (finding) => finding, `${label}.findings`);
  });
  assertSorted(report.customNodes.records, (record) => record.logicalPath, 'customNodes.records');
  assertInteger(report.customNodes.fileCount, 'customNodes.fileCount');
  assertInteger(report.customNodes.bytes, 'customNodes.bytes');

  assertClosedObject(report.workflows, ['records', 'fileCount', 'bytes', 'parsed', 'blocked'], 'workflows');
  assert(Array.isArray(report.workflows.records), 'workflows.records must be an array');
  report.workflows.records.forEach((record, index) => {
    const label = `workflows.records[${index}]`;
    assertClosedObject(record, ['logicalPath', 'bytes', 'parseStatus', 'nodeTypeMultiset', 'nodeCount', 'linkCount', 'sanitizerFindings'], label);
    assert(normalizeLogicalPath(record.logicalPath) === record.logicalPath, `${label}.logicalPath is invalid`);
    assertInteger(record.bytes, `${label}.bytes`);
    assert(['parsed', 'invalid_json', 'unsupported_shape'].includes(record.parseStatus), `${label}.parseStatus is invalid`);
    assert(record.nodeTypeMultiset && typeof record.nodeTypeMultiset === 'object' && !Array.isArray(record.nodeTypeMultiset), `${label}.nodeTypeMultiset must be an object`);
    for (const [nodeType, count] of Object.entries(record.nodeTypeMultiset)) {
      assertString(nodeType, `${label}.nodeType`);
      assert(nodeType === REDACTED_NODE_TYPE || SAFE_NODE_TYPE.test(nodeType), `${label}.nodeType is not a safe identifier`);
      assertInteger(count, `${label}.nodeTypeMultiset.${nodeType}`);
    }
    assertInteger(record.nodeCount, `${label}.nodeCount`);
    assertInteger(record.linkCount, `${label}.linkCount`);
    assert(Array.isArray(record.sanitizerFindings), `${label}.sanitizerFindings must be an array`);
    record.sanitizerFindings.forEach((finding) => assertString(finding, `${label}.sanitizerFinding`));
    assertSorted(record.sanitizerFindings, (finding) => finding, `${label}.sanitizerFindings`);
  });
  assertSorted(report.workflows.records, (record) => record.logicalPath, 'workflows.records');
  ['fileCount', 'bytes', 'parsed', 'blocked'].forEach((key) => assertInteger(report.workflows[key], `workflows.${key}`));

  assertClosedObject(report.models, ['records', 'categories', 'fileCount', 'bytes', 'incompleteBlocked'], 'models');
  assert(Array.isArray(report.models.records), 'models.records must be an array');
  report.models.records.forEach((record, index) => {
    const label = `models.records[${index}]`;
    assertClosedObject(record, ['sourceId', 'logicalPath', 'category', 'bytes', 'hash'], label);
    assertString(record.sourceId, `${label}.sourceId`);
    assert(normalizeLogicalPath(record.logicalPath) === record.logicalPath, `${label}.logicalPath is invalid`);
    assertString(record.category, `${label}.category`);
    assertInteger(record.bytes, `${label}.bytes`);
    validateHash(record.hash, `${label}.hash`, report.hashMode === 'all');
  });
  assertSorted(report.models.records, (record) => `${record.sourceId}/${record.logicalPath}`, 'models.records');
  assert(Array.isArray(report.models.categories), 'models.categories must be an array');
  report.models.categories.forEach((category, index) => {
    const label = `models.categories[${index}]`;
    assertClosedObject(category, ['category', 'fileCount', 'bytes'], label);
    assertString(category.category, `${label}.category`);
    assertInteger(category.fileCount, `${label}.fileCount`);
    assertInteger(category.bytes, `${label}.bytes`);
  });
  assertSorted(report.models.categories, (category) => category.category, 'models.categories');
  ['fileCount', 'bytes', 'incompleteBlocked'].forEach((key) => assertInteger(report.models[key], `models.${key}`));
  const expectedModelCategories = new Map();
  for (const record of report.models.records) {
    const current = expectedModelCategories.get(record.category) ?? { fileCount: 0, bytes: 0 };
    current.fileCount += 1;
    current.bytes += record.bytes;
    expectedModelCategories.set(record.category, current);
  }
  assert(report.models.categories.length === expectedModelCategories.size, 'models.categories does not match model records');
  for (const category of report.models.categories) {
    const expected = expectedModelCategories.get(category.category);
    assert(expected && expected.fileCount === category.fileCount && expected.bytes === category.bytes, `models category counter does not match ${category.category}`);
  }

  assert(Array.isArray(report.exclusions), 'exclusions must be an array');
  report.exclusions.forEach((entry, index) => {
    const label = `exclusions[${index}]`;
    assertClosedObject(entry, ['reason', 'fileCount', 'bytes'], label);
    assertString(entry.reason, `${label}.reason`);
    assertInteger(entry.fileCount, `${label}.fileCount`);
    assertInteger(entry.bytes, `${label}.bytes`);
  });
  assertSorted(report.exclusions, (entry) => entry.reason, 'exclusions');
  assertClosedObject(report.portability, ['status', 'blockers', 'warnings'], 'portability');
  assert(['ready', 'blocked'].includes(report.portability.status), 'portability.status is invalid');
  assert(Array.isArray(report.portability.blockers), 'portability.blockers must be an array');
  assert(Array.isArray(report.portability.warnings), 'portability.warnings must be an array');
  report.portability.blockers.forEach((finding, index) => validateFinding(finding, `portability.blockers[${index}]`));
  report.portability.warnings.forEach((finding, index) => validateFinding(finding, `portability.warnings[${index}]`));
  assertSorted(report.portability.blockers, (finding) => finding.code, 'portability.blockers');
  assertSorted(report.portability.warnings, (finding) => finding.code, 'portability.warnings');
  assertClosedObject(report.summary, ['discovered', 'excluded'], 'summary');
  validateCounter(report.summary.discovered, 'summary.discovered', ['records', 'files', 'bytes']);
  validateCounter(report.summary.excluded, 'summary.excluded', ['files', 'bytes']);

  const payloadTotals = report.payloadFiles.reduce((totals, file) => ({ files: totals.files + 1, bytes: totals.bytes + file.bytes }), { files: 0, bytes: 0 });
  const excludedTotals = report.exclusions.reduce((totals, entry) => ({ files: totals.files + entry.fileCount, bytes: totals.bytes + entry.bytes }), { files: 0, bytes: 0 });
  assert(report.summary.discovered.files === payloadTotals.files, 'summary.discovered.files does not match payloadFiles');
  assert(report.summary.discovered.bytes === payloadTotals.bytes, 'summary.discovered.bytes does not match payloadFiles');
  assert(report.summary.excluded.files === excludedTotals.files, 'summary.excluded.files does not match exclusions');
  assert(report.summary.excluded.bytes === excludedTotals.bytes, 'summary.excluded.bytes does not match exclusions');
  scanForPrivateStrings(report, 'InventoryReportV1');
  return report;
}

export function validateLocalBundleManifestV1(manifest, options = {}) {
  assertClosedObject(manifest, ['schemaVersion', 'bundle', 'buildState', 'runtime', 'payloadFiles', 'customNodes', 'workflows', 'models', 'capabilities', 'exclusions', 'localOnly'], 'LocalBundleManifestV1');
  assert(manifest.schemaVersion === LOCAL_BUNDLE_MANIFEST_VERSION, 'LocalBundleManifestV1.schemaVersion is invalid');
  assertClosedObject(manifest.bundle, ['id', 'version', 'digest'], 'bundle');
  assertString(manifest.bundle.id, 'bundle.id');
  assertString(manifest.bundle.version, 'bundle.version');
  assert(/^[a-f0-9]{64}$/.test(manifest.bundle.digest), 'bundle.digest must be lowercase SHA-256');
  assert(['draft', 'build_ready'].includes(manifest.buildState), 'buildState is invalid');
  assertClosedObject(manifest.runtime, ['entrypoint', 'pythonPortability'], 'runtime');
  assert(validateLogicalTargetPath(manifest.runtime.entrypoint, 'runtime') === manifest.runtime.entrypoint, 'runtime.entrypoint is invalid');
  assert(['portable', 'rebuild_required'].includes(manifest.runtime.pythonPortability), 'runtime.pythonPortability is invalid');
  assert(Array.isArray(manifest.payloadFiles) && manifest.payloadFiles.length > 0, 'payloadFiles must not be empty');
  manifest.payloadFiles.forEach((file, index) => validatePayloadFile(file, `payloadFiles[${index}]`, manifest.buildState === 'build_ready'));
  assertUnique(manifest.payloadFiles, (file) => `${file.sourceId}/${file.logicalPath}`, 'payloadFiles');
  assertUnique(manifest.payloadFiles, (file) => file.targetPath.toLowerCase(), 'payload target paths');
  assertPayloadFilesSorted(manifest.payloadFiles, 'payloadFiles');
  assert(Array.isArray(manifest.customNodes), 'customNodes must be an array');
  manifest.customNodes.forEach((item, index) => {
    assertClosedObject(item, ['id', 'versionState'], `customNodes[${index}]`);
    assertString(item.id, `customNodes[${index}].id`);
    assert(['pinned', 'unverified'].includes(item.versionState), `customNodes[${index}].versionState is invalid`);
  });
  assertUnique(manifest.customNodes, (item) => item.id, 'customNodes');
  assertSorted(manifest.customNodes, (item) => item.id, 'customNodes');
  assert(Array.isArray(manifest.workflows), 'workflows must be an array');
  manifest.workflows.forEach((item, index) => {
    assertClosedObject(item, ['id', 'logicalPath'], `workflows[${index}]`);
    assertString(item.id, `workflows[${index}].id`);
    assert(validateLogicalTargetPath(item.logicalPath, 'workflow') === item.logicalPath, `workflows[${index}].logicalPath is invalid`);
  });
  assertUnique(manifest.workflows, (item) => item.id, 'workflows');
  assertSorted(manifest.workflows, (item) => item.id, 'workflows');
  assert(Array.isArray(manifest.models), 'models must be an array');
  manifest.models.forEach((item, index) => {
    assertClosedObject(item, ['id', 'category', 'logicalPath', 'bytes', 'hash'], `models[${index}]`);
    assertString(item.id, `models[${index}].id`);
    assertString(item.category, `models[${index}].category`);
    assert(validateLogicalTargetPath(item.logicalPath, 'model') === item.logicalPath, `models[${index}].logicalPath is invalid`);
    assertInteger(item.bytes, `models[${index}].bytes`);
    validateHash(item.hash, `models[${index}].hash`, manifest.buildState === 'build_ready');
  });
  assertUnique(manifest.models, (item) => item.id, 'models');
  assertSorted(manifest.models, (item) => item.id, 'models');
  assert(Array.isArray(manifest.capabilities), 'capabilities must be an array');
  manifest.capabilities.forEach((item, index) => {
    assertClosedObject(item, ['id', 'workflowId', 'requiredModels', 'requiredCustomNodes'], `capabilities[${index}]`);
    assertString(item.id, `capabilities[${index}].id`);
    assertString(item.workflowId, `capabilities[${index}].workflowId`);
    assert(Array.isArray(item.requiredModels), `capabilities[${index}].requiredModels must be an array`);
    assert(Array.isArray(item.requiredCustomNodes), `capabilities[${index}].requiredCustomNodes must be an array`);
    item.requiredModels.forEach((value) => assertString(value, 'required model'));
    item.requiredCustomNodes.forEach((value) => assertString(value, 'required custom node'));
    assertUnique(item.requiredModels, (value) => value, `capabilities[${index}].requiredModels`);
    assertSorted(item.requiredModels, (value) => value, `capabilities[${index}].requiredModels`);
    assertUnique(item.requiredCustomNodes, (value) => value, `capabilities[${index}].requiredCustomNodes`);
    assertSorted(item.requiredCustomNodes, (value) => value, `capabilities[${index}].requiredCustomNodes`);
  });
  assertUnique(manifest.capabilities, (item) => item.id, 'capabilities');
  assertSorted(manifest.capabilities, (item) => item.id, 'capabilities');
  assert(Array.isArray(manifest.exclusions), 'exclusions must be an array');
  manifest.exclusions.forEach((value) => assertString(value, 'exclusion'));
  assertUnique(manifest.exclusions, (value) => value, 'exclusions');
  assertSorted(manifest.exclusions, (value) => value, 'exclusions');
  assertClosedObject(manifest.localOnly, ['uploadForbidden', 'repositoryPayloadForbidden'], 'localOnly');
  assert(manifest.localOnly.uploadForbidden === true, 'localOnly.uploadForbidden must be true');
  assert(manifest.localOnly.repositoryPayloadForbidden === true, 'localOnly.repositoryPayloadForbidden must be true');
  scanForPrivateStrings(manifest, 'LocalBundleManifestV1');
  if (!options.skipDigestMatch) assert(manifest.bundle.digest === managedComfyManifestDigest(manifest), 'bundle.digest does not match manifest content');
  return manifest;
}

function isLocalAbsolutePath(value) {
  return typeof value === 'string' && (path.isAbsolute(value) || WINDOWS_ABSOLUTE.test(value)) && !UNC_ABSOLUTE.test(value);
}

export function validateInstallationReceiptV1(receipt) {
  assertClosedObject(receipt, ['schemaVersion', 'storage', 'bundle', 'installation', 'capabilities'], 'InstallationReceiptV1');
  assert(receipt.schemaVersion === INSTALLATION_RECEIPT_VERSION, 'InstallationReceiptV1.schemaVersion is invalid');
  assertClosedObject(receipt.storage, ['logicalPath', 'private'], 'storage');
  assert(receipt.storage.logicalPath === 'state/private/installation-receipt-v1.json', 'storage.logicalPath is invalid');
  assert(receipt.storage.private === true, 'storage.private must be true');
  assertClosedObject(receipt.bundle, ['id', 'version', 'digest'], 'bundle');
  assertString(receipt.bundle.id, 'bundle.id');
  assertString(receipt.bundle.version, 'bundle.version');
  assert(/^[a-f0-9]{64}$/.test(receipt.bundle.digest), 'bundle.digest must be lowercase SHA-256');
  assertClosedObject(receipt.installation, ['id', 'installRoot', 'modelRoots', 'endpoint', 'state', 'verifiedAt'], 'installation');
  assertString(receipt.installation.id, 'installation.id');
  assert(isLocalAbsolutePath(receipt.installation.installRoot), 'installation.installRoot must be an absolute local path');
  assert(Array.isArray(receipt.installation.modelRoots) && receipt.installation.modelRoots.length > 0, 'installation.modelRoots must not be empty');
  receipt.installation.modelRoots.forEach((root) => assert(isLocalAbsolutePath(root), 'model root must be an absolute local path'));
  assert(/^http:\/\/(?:127\.0\.0\.1|localhost):(?:[1-9]\d{0,4})$/.test(receipt.installation.endpoint), 'installation.endpoint must be loopback-only');
  const port = Number(receipt.installation.endpoint.slice(receipt.installation.endpoint.lastIndexOf(':') + 1));
  assert(port <= 65535, 'installation.endpoint port is invalid');
  assert(['installed', 'repair_required', 'rolled_back'].includes(receipt.installation.state), 'installation.state is invalid');
  assert(!Number.isNaN(Date.parse(receipt.installation.verifiedAt)), 'installation.verifiedAt must be an ISO timestamp');
  assert(Array.isArray(receipt.capabilities), 'capabilities must be an array');
  receipt.capabilities.forEach((capability, index) => {
    assertClosedObject(capability, ['id', 'state', 'findings'], `capabilities[${index}]`);
    assertString(capability.id, `capabilities[${index}].id`);
    assert(['ready', 'blocked'].includes(capability.state), `capabilities[${index}].state is invalid`);
    assert(Array.isArray(capability.findings), `capabilities[${index}].findings must be an array`);
    capability.findings.forEach((finding) => assertString(finding, 'capability finding'));
    assertSorted(capability.findings, (finding) => finding, `capabilities[${index}].findings`);
  });
  assertUnique(receipt.capabilities, (capability) => capability.id, 'capabilities');
  assertSorted(receipt.capabilities, (capability) => capability.id, 'capabilities');
  return receipt;
}

export function createInstallationReceiptV1(input, options = {}) {
  const clock = options.clock ?? (() => new Date());
  const now = clock();
  const verifiedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const receipt = {
    schemaVersion: INSTALLATION_RECEIPT_VERSION,
    storage: { logicalPath: 'state/private/installation-receipt-v1.json', private: true },
    bundle: { ...input.bundle },
    installation: {
      id: input.installation.id,
      installRoot: input.installation.installRoot,
      modelRoots: [...input.installation.modelRoots],
      endpoint: input.installation.endpoint,
      state: input.installation.state,
      verifiedAt,
    },
    capabilities: [...input.capabilities]
      .map((capability) => ({ id: capability.id, state: capability.state, findings: [...capability.findings].sort(compareText) }))
      .sort((left, right) => compareText(left.id, right.id)),
  };
  return validateInstallationReceiptV1(receipt);
}

function exclusionReason(name, relativeParts, kind) {
  const lower = name.toLowerCase();
  if (relativeParts.length === 1 && TOP_LEVEL_EXCLUDED_DIRECTORIES.has(lower)) return 'excluded_mutable_root';
  if (ALWAYS_EXCLUDED_DIRECTORIES.has(lower)) return 'excluded_internal_metadata';
  if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(name))) return 'excluded_secret_filename';
  if (INCOMPLETE_FILE_PATTERNS.some((pattern) => pattern.test(name))) return 'excluded_incomplete_download';
  if (kind !== 'workflows' && relativeParts.length >= 1 && GENERATED_MEDIA_EXTENSIONS.has(path.extname(lower)) && ['input', 'output', 'preview', 'history'].some((part) => relativeParts.map((value) => value.toLowerCase()).includes(part))) return 'excluded_generated_media';
  return null;
}

function addExclusion(exclusions, reason, stats = { size: 0 }) {
  const current = exclusions.get(reason) ?? { reason, fileCount: 0, bytes: 0 };
  current.fileCount += Number(stats.files ?? 1);
  current.bytes += Number(stats.size ?? 0);
  exclusions.set(reason, current);
}

async function inspectExplicitRoot(inputPath, kind, id, io) {
  assertString(inputPath, `${kind} root`);
  assert(path.isAbsolute(inputPath) || WINDOWS_ABSOLUTE.test(inputPath), `${kind} root must be absolute`);
  assert(!UNC_ABSOLUTE.test(inputPath), `${kind} root must not be UNC`);
  const parsed = path.parse(path.resolve(inputPath));
  assert(path.resolve(inputPath) !== parsed.root, `${kind} root must not be a volume root`);
  const suppliedStat = await io.lstat(inputPath);
  assert(suppliedStat.isDirectory() || suppliedStat.isSymbolicLink(), `${kind} root must be a directory`);
  const resolvedPath = await io.realpath(inputPath);
  const resolvedStat = await io.stat(resolvedPath);
  assert(resolvedStat.isDirectory(), `${kind} root must resolve to a directory`);
  return { id, kind, suppliedPath: path.resolve(inputPath), resolvedPath };
}

function canonicalLocalPath(value) {
  const resolved = path.resolve(value);
  const parsed = path.parse(resolved);
  const withoutTrailingSeparator = resolved.length > parsed.root.length ? resolved.replace(/[\\/]+$/, '') : resolved;
  return process.platform === 'win32' || WINDOWS_ABSOLUTE.test(withoutTrailingSeparator)
    ? withoutTrailingSeparator.toLowerCase()
    : withoutTrailingSeparator;
}

function isInside(parent, child) {
  const canonicalParent = canonicalLocalPath(parent);
  const canonicalChild = canonicalLocalPath(child);
  if (canonicalChild === canonicalParent) return true;
  const separator = canonicalParent.includes('\\') ? '\\' : '/';
  return canonicalChild.startsWith(`${canonicalParent}${separator}`);
}

async function ensureReportSafety(reportPath, roots, hashMode, productRoot, io) {
  assertString(reportPath, 'report path');
  assert(path.isAbsolute(reportPath) || !UNC_ABSOLUTE.test(reportPath), 'report path is invalid');
  const absoluteReport = path.resolve(reportPath);
  assert(!UNC_ABSOLUTE.test(absoluteReport), 'report path must not be UNC');
  const parsed = path.parse(absoluteReport);
  assert(absoluteReport !== parsed.root, 'report path must not be a volume root');
  const lexicalParent = path.dirname(absoluteReport);
  const parentStat = await io.lstat(lexicalParent);
  assert(parentStat.isDirectory() || parentStat.isSymbolicLink(), 'report parent must be an existing directory');
  const resolvedParent = await io.realpath(lexicalParent);
  const resolvedParentStat = await io.stat(resolvedParent);
  assert(resolvedParentStat.isDirectory(), 'report parent must resolve to a directory');
  assert(canonicalLocalPath(lexicalParent) === canonicalLocalPath(resolvedParent), 'report parent must not be a junction or symbolic-link redirect');
  const canonicalDestination = path.join(resolvedParent, path.basename(absoluteReport));
  for (const root of roots) {
    assert(!isInside(root.resolvedPath, canonicalDestination), 'report path must be outside every real scanned root');
  }
  if (hashMode === 'all' && productRoot) {
    const realProductRoot = await io.realpath(productRoot);
    assert(!isInside(realProductRoot, canonicalDestination), 'hash-all report must be outside the real product repository');
  }
  try {
    await io.access(canonicalDestination);
    fail('report path already exists; reports are create-new only');
  } catch (error) {
    if (error?.name === 'ManagedComfyBundleValidationError') throw error;
  }
  return canonicalDestination;
}

function classifyModel(relativePath) {
  const parts = relativePath.split('/');
  return parts.length > 1 ? parts[0].toLowerCase() : 'uncategorized';
}

function isPythonRuntimePath(logicalPath) {
  const first = logicalPath.split('/')[0].toLowerCase();
  return ['.venv', 'venv', 'python', 'python_embeded', 'python_embedded'].includes(first);
}

export function logicalTargetPath(category, sourceId, logicalPath) {
  const normalized = normalizeLogicalPath(logicalPath);
  if (category === 'runtime') return validateLogicalTargetPath(`runtime/comfyui/${normalized}`, category);
  if (category === 'python_runtime') {
    const parts = normalized.split('/');
    const remainder = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
    return validateLogicalTargetPath(`runtime/python/${remainder}`, category);
  }
  if (category === 'custom_node') {
    const parts = normalized.split('/');
    const remainder = parts[0].toLowerCase() === 'custom_nodes' ? parts.slice(1).join('/') : normalized;
    return validateLogicalTargetPath(`extensions/custom-nodes/${remainder}`, category);
  }
  if (category === 'workflow') return validateLogicalTargetPath(`workflows/${sourceId}/${normalized}`, category);
  if (category === 'model') {
    const modelCategory = classifyModel(normalized);
    const parts = normalized.split('/');
    const remainder = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
    return validateLogicalTargetPath(`models/${modelCategory}/${remainder}`, category);
  }
  fail(`unsupported payload category ${category}`);
}

function inspectWorkflowValue(value, key, findings, seen = new Set()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return;
    seen.add(value);
  }
  if (WORKFLOW_SECRET_KEYS.test(key)) findings.add('credential_value_redacted');
  if (WORKFLOW_PROMPT_KEYS.test(key)) findings.add('prompt_text_redacted');
  if (WORKFLOW_HISTORY_KEYS.test(key)) findings.add('history_value_redacted');
  if (key === 'class_type' || key === 'type') return;
  if (typeof value === 'string') {
    if (URL_VALUE.test(value)) findings.add('url_redacted');
    if (isAbsoluteLike(value)) findings.add('absolute_path_redacted');
    if (WORKFLOW_MEDIA_KEYS.test(key) && /\.[a-z0-9]{2,5}(?:$|[?#])/i.test(value)) findings.add('media_filename_redacted');
  } else if (Array.isArray(value)) {
    value.forEach((child) => inspectWorkflowValue(child, key, findings, seen));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([childKey, child]) => inspectWorkflowValue(child, childKey, findings, seen));
  }
}

function projectNodeType(value, findings) {
  if (typeof value === 'string'
    && value.length <= 128
    && SAFE_NODE_TYPE.test(value)
    && !isAbsoluteLike(value)
    && !URL_VALUE.test(value)
    && !NODE_TYPE_CREDENTIAL_VALUE.test(value)
    && !RESERVED_NODE_TYPE_KEYS.has(value.toLowerCase())
    && !/[\u0000-\u001f\u007f]/.test(value)) return value;
  findings.add(UNSAFE_NODE_TYPE_FINDING);
  return REDACTED_NODE_TYPE;
}

function projectWorkflow(parsed, logicalPath, bytes) {
  const findings = new Set();
  inspectWorkflowValue(parsed, '', findings);
  let nodes = [];
  let linkCount = 0;
  if (Array.isArray(parsed?.nodes)) {
    nodes = parsed.nodes;
    linkCount = Array.isArray(parsed.links) ? parsed.links.length : 0;
  } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const entries = Object.values(parsed);
    if (entries.length > 0 && entries.every((node) => node && typeof node === 'object' && typeof node.class_type === 'string')) nodes = entries;
    else return { logicalPath, bytes, parseStatus: 'unsupported_shape', nodeTypeMultiset: {}, nodeCount: 0, linkCount: 0, sanitizerFindings: [...findings].sort(compareText) };
  } else {
    return { logicalPath, bytes, parseStatus: 'unsupported_shape', nodeTypeMultiset: {}, nodeCount: 0, linkCount: 0, sanitizerFindings: [...findings].sort(compareText) };
  }
  const nodeTypeMultiset = Object.create(null);
  for (const node of nodes) {
    const rawNodeType = typeof node?.class_type === 'string' ? node.class_type : typeof node?.type === 'string' ? node.type : 'unknown';
    const nodeType = projectNodeType(rawNodeType, findings);
    nodeTypeMultiset[nodeType] = (nodeTypeMultiset[nodeType] ?? 0) + 1;
  }
  return {
    logicalPath,
    bytes,
    parseStatus: 'parsed',
    nodeTypeMultiset: Object.fromEntries(Object.entries(nodeTypeMultiset).sort(([left], [right]) => compareText(left, right))),
    nodeCount: nodes.length,
    linkCount,
    sanitizerFindings: [...findings].sort(compareText),
  };
}

function isOpaqueVirtualEnvironmentName(name) {
  const folded = name.replace(/[A-Z]/g, (character) => character.toLowerCase());
  return folded === '.venv' || folded === 'venv';
}

async function inspectPython(comfyRoot, io) {
  const rootEntries = await io.readdir(comfyRoot, { withFileTypes: true });
  const opaqueEntries = rootEntries
    .filter((entry) => isOpaqueVirtualEnvironmentName(entry.name))
    .sort((left, right) => compareText(left.name, right.name));
  if (opaqueEntries.length > 0) {
    for (const entry of opaqueEntries) await io.lstat(path.join(comfyRoot, entry.name));
    return { state: 'machine_bound', configPresent: false, findings: ['opaque_virtual_environment_present'] };
  }
  const portableCandidates = [
    path.join(comfyRoot, 'python_embeded', 'python.exe'),
    path.join(comfyRoot, 'python_embedded', 'python.exe'),
    path.join(comfyRoot, 'python', 'python.exe'),
  ];
  for (const candidate of portableCandidates) {
    try {
      const candidateStat = await io.lstat(candidate);
      if (candidateStat.isFile() && !candidateStat.isSymbolicLink()) return { state: 'portable', configPresent: false, findings: [] };
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      // Absence is expected while testing known portable locations.
    }
  }
  return { state: 'missing', configPresent: false, findings: ['python_runtime_missing'] };
}

async function walkRoot(root, options, visit) {
  const exclusions = options.exclusions;
  async function walk(currentPath, relativeParts) {
    const entries = await options.io.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const childParts = [...relativeParts, entry.name];
      const childPath = path.join(currentPath, entry.name);
      const reason = exclusionReason(entry.name, childParts, root.kind);
      if (reason) {
        // Excluded directories are deliberately opaque: even counting their contents would
        // traverse and expose the very trees this boundary promises never to inspect.
        const opaque = isOpaqueVirtualEnvironmentName(entry.name);
        addExclusion(exclusions, reason, (entry.isDirectory() || opaque) ? { files: 0, size: 0 } : await options.io.lstat(childPath));
        continue;
      }
      const childStat = await options.io.lstat(childPath);
      if (childStat.isSymbolicLink()) {
        addExclusion(exclusions, 'excluded_nested_reparse_point', { files: 1, size: 0 });
        options.nestedReparseCount += 1;
        continue;
      }
      if (childStat.isDirectory()) await walk(childPath, childParts);
      else if (childStat.isFile()) await visit(childPath, childParts.join('/'), childStat);
    }
  }
  await walk(root.resolvedPath, []);
}

function incrementFinding(map, code, count = 1) {
  map.set(code, (map.get(code) ?? 0) + count);
}

function findingsFromMap(map) {
  return [...map.entries()].sort(([left], [right]) => compareText(left, right)).map(([code, count]) => ({ code, count }));
}

export async function inventoryManagedComfyBundle(options) {
  const hashMode = options.hashMode ?? 'none';
  assert(hashMode === 'none' || hashMode === 'all', 'hashMode must be none or all');
  assertString(options.comfyRoot, '--comfy-root is required');
  assert(Array.isArray(options.modelRoots) && options.modelRoots.length > 0, 'at least one --model-root is required');
  assert(Array.isArray(options.workflowRoots), 'workflowRoots must be an array');

  const io = options.io ?? createInventoryIo(options.observer, options.fsImpl);
  const roots = [await inspectExplicitRoot(options.comfyRoot, 'comfy', 'comfy', io)];
  for (let index = 0; index < options.modelRoots.length; index += 1) roots.push(await inspectExplicitRoot(options.modelRoots[index], 'models', `models-${String(index + 1).padStart(2, '0')}`, io));
  for (let index = 0; index < options.workflowRoots.length; index += 1) roots.push(await inspectExplicitRoot(options.workflowRoots[index], 'workflows', `workflows-${String(index + 1).padStart(2, '0')}`, io));
  const rootKeys = new Set();
  for (const root of roots) {
    const key = root.resolvedPath.toLowerCase();
    assert(!rootKeys.has(key), 'explicit roots must not resolve to the same directory');
    rootKeys.add(key);
  }

  const exclusions = new Map();
  const blockers = new Map();
  const warnings = new Map();
  const payloadFiles = [];
  const customNodeMap = new Map();
  const workflowRecords = [];
  const modelRecords = [];
  const python = await inspectPython(roots[0].resolvedPath, io);
  if (python.state === 'machine_bound') incrementFinding(blockers, 'python_runtime_machine_bound');
  if (python.state === 'missing') incrementFinding(blockers, 'python_runtime_missing');

  async function addPayload(root, category, logicalPath, filePath, fileStat) {
    const hash = hashMode === 'all' ? await io.hash(filePath) : notComputedHash();
    const normalized = normalizeLogicalPath(logicalPath);
    const record = { sourceId: root.id, category, logicalPath: normalized, targetPath: logicalTargetPath(category, root.id, normalized), bytes: fileStat.size, hash };
    payloadFiles.push(record);
    return record;
  }

  const traversalOptions = { exclusions, nestedReparseCount: 0, io };
  const comfyRoot = roots[0];
  await walkRoot(comfyRoot, traversalOptions, async (filePath, logicalPath, fileStat) => {
    const parts = logicalPath.split('/');
    const isCustomNode = parts[0].toLowerCase() === 'custom_nodes' && parts.length >= 2;
    const category = isCustomNode ? 'custom_node' : isPythonRuntimePath(logicalPath) ? 'python_runtime' : 'runtime';
    if (parts[0].toLowerCase() === 'models') {
      addExclusion(exclusions, 'excluded_non_explicit_model_root', fileStat);
      return;
    }
    const payload = await addPayload(comfyRoot, category, logicalPath, filePath, fileStat);
    if (isCustomNode) {
      const id = parts.length === 2 ? path.parse(parts[1]).name : parts[1];
      const item = customNodeMap.get(id) ?? {
        id,
        logicalPath: `custom_nodes/${id}`,
        fileCount: 0,
        bytes: 0,
        versionState: 'unversioned',
        nativeBinaryCount: 0,
        findings: new Set(['custom_node_unversioned']),
      };
      item.fileCount += 1;
      item.bytes += payload.bytes;
      if (parts[2] === '.git') {
        item.versionState = 'versioned_unverified';
        item.findings.delete('custom_node_unversioned');
        item.findings.add('custom_node_dirty_state_unverified');
      }
      if (NATIVE_BINARY_EXTENSIONS.has(path.extname(logicalPath).toLowerCase())) {
        item.nativeBinaryCount += 1;
        item.findings.add('native_binary_requires_machine_validation');
      }
      customNodeMap.set(id, item);
    }
  });

  for (const root of roots.filter((entry) => entry.kind === 'models')) {
    let hasLicenseMetadata = false;
    await walkRoot(root, traversalOptions, async (filePath, logicalPath, fileStat) => {
      if (LICENSE_NAMES.test(path.basename(logicalPath))) hasLicenseMetadata = true;
      if (!MODEL_EXTENSIONS.has(path.extname(logicalPath).toLowerCase())) {
        addExclusion(exclusions, 'excluded_non_model_resource', fileStat);
        return;
      }
      const payload = await addPayload(root, 'model', logicalPath, filePath, fileStat);
      modelRecords.push({ sourceId: root.id, logicalPath: payload.logicalPath, category: classifyModel(payload.logicalPath), bytes: payload.bytes, hash: payload.hash });
    });
    if (!hasLicenseMetadata && modelRecords.some((record) => record.sourceId === root.id)) incrementFinding(warnings, 'model_license_metadata_missing');
  }

  for (const root of roots.filter((entry) => entry.kind === 'workflows')) {
    await walkRoot(root, traversalOptions, async (filePath, logicalPath, fileStat) => {
      if (path.extname(logicalPath).toLowerCase() !== '.json') {
        addExclusion(exclusions, 'excluded_non_json_workflow', fileStat);
        return;
      }
      await addPayload(root, 'workflow', logicalPath, filePath, fileStat);
      try {
        const parsed = JSON.parse(await io.readFile(filePath, 'utf8'));
        workflowRecords.push(projectWorkflow(parsed, logicalPath, fileStat.size));
      } catch {
        workflowRecords.push({ logicalPath, bytes: fileStat.size, parseStatus: 'invalid_json', nodeTypeMultiset: {}, nodeCount: 0, linkCount: 0, sanitizerFindings: ['raw_content_omitted'] });
        incrementFinding(blockers, 'workflow_invalid_json');
      }
    });
  }

  const incomplete = exclusions.get('excluded_incomplete_download')?.fileCount ?? 0;
  if (incomplete > 0) incrementFinding(blockers, 'incomplete_download_present', incomplete);
  if (traversalOptions.nestedReparseCount > 0) incrementFinding(warnings, 'nested_reparse_point_not_traversed', traversalOptions.nestedReparseCount);
  for (const node of customNodeMap.values()) {
    for (const finding of node.findings) incrementFinding(warnings, finding);
  }

  sortByLogicalPath(payloadFiles);
  sortByLogicalPath(modelRecords);
  workflowRecords.sort((left, right) => compareText(left.logicalPath, right.logicalPath));
  const customNodeRecords = [...customNodeMap.values()]
    .map((item) => ({ ...item, findings: [...item.findings].sort(compareText) }))
    .sort((left, right) => compareText(left.logicalPath, right.logicalPath));
  const exclusionRecords = [...exclusions.values()].sort((left, right) => compareText(left.reason, right.reason));
  const totalFor = (category) => payloadFiles.filter((file) => file.category === category).reduce((result, file) => ({ fileCount: result.fileCount + 1, bytes: result.bytes + file.bytes }), { fileCount: 0, bytes: 0 });
  const plainRuntimeTotals = totalFor('runtime');
  const pythonRuntimeTotals = totalFor('python_runtime');
  const runtimeTotals = { fileCount: plainRuntimeTotals.fileCount + pythonRuntimeTotals.fileCount, bytes: plainRuntimeTotals.bytes + pythonRuntimeTotals.bytes };
  const customNodeTotals = totalFor('custom_node');
  const workflowTotals = totalFor('workflow');
  const modelTotals = totalFor('model');
  const modelCategoryMap = new Map();
  for (const record of modelRecords) {
    const current = modelCategoryMap.get(record.category) ?? { category: record.category, fileCount: 0, bytes: 0 };
    current.fileCount += 1;
    current.bytes += record.bytes;
    modelCategoryMap.set(record.category, current);
  }
  const modelCategories = [...modelCategoryMap.values()].sort((left, right) => compareText(left.category, right.category));
  const payloadBytes = payloadFiles.reduce((sum, file) => sum + file.bytes, 0);
  const excludedTotals = exclusionRecords.reduce((result, entry) => ({ files: result.files + entry.fileCount, bytes: result.bytes + entry.bytes }), { files: 0, bytes: 0 });
  const report = {
    schemaVersion: INVENTORY_REPORT_VERSION,
    hashMode,
    sources: roots.map(({ id, kind }) => ({ id, kind })),
    payloadFiles,
    runtime: {
      fileCount: runtimeTotals.fileCount,
      bytes: runtimeTotals.bytes,
      nativeBinaryCount: payloadFiles.filter((file) => (file.category === 'runtime' || file.category === 'python_runtime') && NATIVE_BINARY_EXTENSIONS.has(path.extname(file.logicalPath).toLowerCase())).length,
      python,
    },
    customNodes: { records: customNodeRecords, fileCount: customNodeTotals.fileCount, bytes: customNodeTotals.bytes },
    workflows: {
      records: workflowRecords,
      fileCount: workflowTotals.fileCount,
      bytes: workflowTotals.bytes,
      parsed: workflowRecords.filter((record) => record.parseStatus === 'parsed').length,
      blocked: workflowRecords.filter((record) => record.parseStatus !== 'parsed').length,
    },
    models: { records: modelRecords, categories: modelCategories, fileCount: modelTotals.fileCount, bytes: modelTotals.bytes, incompleteBlocked: incomplete },
    exclusions: exclusionRecords,
    portability: { status: blockers.size > 0 ? 'blocked' : 'ready', blockers: findingsFromMap(blockers), warnings: findingsFromMap(warnings) },
    summary: {
      discovered: { records: 1 + customNodeRecords.length + workflowRecords.length + modelRecords.length, files: payloadFiles.length, bytes: payloadBytes },
      excluded: { files: excludedTotals.files, bytes: excludedTotals.bytes },
    },
  };
  return validateInventoryReportV1(report);
}

export async function writeInventoryReportCreateNew(reportPath, report, options = {}) {
  validateInventoryReportV1(report);
  const io = options.io ?? createInventoryIo(options.observer, options.fsImpl);
  const handle = await io.open(reportPath, 'wx', 0o600);
  try {
    await handle.writeFile(canonicalJson(report), 'utf8');
  } finally {
    await handle.close();
  }
}

export async function runInventoryToNewReport(options) {
  const productRoot = options.productRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const io = createInventoryIo(options.observer, options.fsImpl);
  const roots = [await inspectExplicitRoot(options.comfyRoot, 'comfy', 'comfy', io)];
  for (let index = 0; index < options.modelRoots.length; index += 1) roots.push(await inspectExplicitRoot(options.modelRoots[index], 'models', `models-${String(index + 1).padStart(2, '0')}`, io));
  for (let index = 0; index < options.workflowRoots.length; index += 1) roots.push(await inspectExplicitRoot(options.workflowRoots[index], 'workflows', `workflows-${String(index + 1).padStart(2, '0')}`, io));
  const reportPath = await ensureReportSafety(options.reportPath, roots, options.hashMode, productRoot, io);
  const report = await inventoryManagedComfyBundle({ ...options, io });
  await writeInventoryReportCreateNew(reportPath, report, { io });
  return report;
}
