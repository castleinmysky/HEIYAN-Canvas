import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  stat,
  statfs,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson,
  createInstallationReceiptV1,
  validateInstallationReceiptV1,
  validateLocalBundleManifestV1,
  validateLogicalTargetPath,
} from './managed-comfy-bundle.js';
import { MANAGED_COMFY_BRIDGE_ID, MANAGED_COMFY_COMPILED_SOURCE_ID } from './managed-comfy-manifest.js';

const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;
const UNC_ABSOLUTE = /^(?:\\\\|\/\/)/;
const RECEIPT_PATH = 'state/private/installation-receipt-v1.json';
const VERSION_MANIFEST = 'bundle-manifest.json';
const STATE_DIRECTORIES = ['input', 'output', 'temp', 'cache', 'logs', 'private', 'user', 'custom_nodes'];
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const LOOPBACK_ENDPOINT = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(?:[1-9]\d{0,4})$/i;
const TRANSACTION_RESERVE_BYTES = 1024 * 1024;
const PARALLEL_COPY_MAX_BYTES = 32 * 1024 * 1024;

function fail(message, code = 'deployment_invalid') {
  const error = new Error(message);
  error.name = 'ManagedComfyDeploymentError';
  error.code = code;
  throw error;
}

function assert(condition, message, code) {
  if (!condition) fail(message, code);
}

function normalizeCopyConcurrency(value) {
  const concurrency = value ?? 1;
  assert(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8, 'copyConcurrency must be an integer from 1 through 8', 'copy_concurrency_invalid');
  return concurrency;
}

async function mapWithBoundedConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let failed = false;
  let firstFailure;

  async function worker() {
    while (!failed) {
      const index = nextIndex;
      if (index >= items.length) return;
      nextIndex += 1;
      try {
        results[index] = await operation(items[index], index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstFailure = error;
        }
        return;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.allSettled(workers);
  if (failed) throw firstFailure;
  return results;
}

async function copyPayloadPlan(items, concurrency, operation) {
  const results = new Array(items.length);
  let smallBatch = [];

  async function drainSmallBatch() {
    if (smallBatch.length === 0) return;
    const batch = smallBatch;
    smallBatch = [];
    const batchResults = await mapWithBoundedConcurrency(batch, concurrency, ({ item, index }) => operation(item, index));
    for (let offset = 0; offset < batch.length; offset += 1) results[batch[offset].index] = batchResults[offset];
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.entry.bytes > PARALLEL_COPY_MAX_BYTES) {
      await drainSmallBatch();
      results[index] = await operation(item, index);
    } else {
      smallBatch.push({ item, index });
    }
  }
  await drainSmallBatch();
  return results;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalLocalPath(value) {
  const resolved = path.resolve(value);
  const parsed = path.parse(resolved);
  const trimmed = resolved.length > parsed.root.length ? resolved.replace(/[\\/]+$/, '') : resolved;
  return WINDOWS_ABSOLUTE.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function isInside(parent, child) {
  const canonicalParent = canonicalLocalPath(parent);
  const canonicalChild = canonicalLocalPath(child);
  if (canonicalParent === canonicalChild) return true;
  const separator = canonicalParent.includes('\\') ? '\\' : '/';
  return canonicalChild.startsWith(`${canonicalParent}${separator}`);
}

function assertAbsoluteLocal(value, label) {
  assert(typeof value === 'string' && (path.isAbsolute(value) || WINDOWS_ABSOLUTE.test(value)), `${label} must be absolute`, 'path_not_absolute');
  assert(!UNC_ABSOLUTE.test(value), `${label} must not be UNC`, 'path_unc');
  const resolved = path.resolve(value);
  assert(resolved !== path.parse(resolved).root, `${label} must not be a volume root`, 'path_volume_root');
  return resolved;
}

function assertSafeSegment(value, label) {
  assert(typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..', `${label} must be a non-empty path segment`, 'path_segment_invalid');
  assert(!/[\\/<>:"|?*\u0000-\u001f]/.test(value), `${label} contains an invalid Windows character`, 'path_segment_invalid');
  assert(!/[ .]$/.test(value), `${label} contains a trailing dot or space`, 'path_segment_invalid');
  assert(!WINDOWS_RESERVED_SEGMENT.test(value), `${label} is a reserved Windows name`, 'path_segment_invalid');
  return value;
}

function assertInstallInputs(manifest, options) {
  assertSafeSegment(manifest.bundle.id, 'bundle ID');
  assertSafeSegment(manifest.bundle.version, 'bundle version');
  assertSafeSegment(options.installationId, 'installation ID');
  assert(typeof options.endpoint === 'string' && LOOPBACK_ENDPOINT.test(options.endpoint), 'endpoint must be loopback-only with an explicit port', 'endpoint_invalid');
  const port = Number(new URL(options.endpoint).port);
  assert(Number.isSafeInteger(port) && port >= 1 && port <= 65535, 'endpoint port is invalid', 'endpoint_invalid');
  assert(!manifest.capabilities.some((capability) => capability.id === 'runtime'), 'manifest capability ID runtime is reserved', 'runtime_capability_reserved');
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function nearestExistingAncestor(target) {
  let candidate = path.resolve(target);
  while (!await exists(candidate)) {
    const parent = path.dirname(candidate);
    assert(parent !== candidate, `no existing ancestor for ${target}`, 'path_parent_missing');
    candidate = parent;
  }
  return candidate;
}

async function assertNoReparseRedirect(target, label, allowMissingTail = true) {
  const absolute = assertAbsoluteLocal(target, label);
  const nearest = await nearestExistingAncestor(absolute);
  const nearestInfo = await lstat(nearest);
  assert(!nearestInfo.isSymbolicLink(), `${label} contains a reparse-point component`, 'path_reparse');
  const resolvedNearest = await realpath(nearest);
  assert(canonicalLocalPath(nearest) === canonicalLocalPath(resolvedNearest), `${label} resolves through a junction or symbolic link`, 'path_reparse');
  if (!allowMissingTail) {
    assert(await exists(absolute), `${label} does not exist`, 'path_missing');
    const info = await lstat(absolute);
    assert(!info.isSymbolicLink(), `${label} is a reparse point`, 'path_reparse');
  }
  return absolute;
}

async function assertRegularFile(target, label, ioStat = stat) {
  const info = await lstat(target);
  assert(!info.isSymbolicLink(), `${label} must not be a reparse point`, 'path_reparse');
  const details = await ioStat(target);
  assert(details.isFile(), `${label} must be a regular file`, 'path_not_regular');
  return details;
}

async function sha256File(target) {
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(target);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return digest.digest('hex');
}

function expectedHash(entry) {
  assert(entry.hash?.algorithm === 'sha256' && entry.hash.state === 'computed' && /^[a-f0-9]{64}$/.test(entry.hash.value), `payload ${entry.targetPath} is missing a complete SHA-256`, 'manifest_hash_missing');
  return entry.hash.value;
}

async function verifyRegularFile(target, entry, ioStat = stat) {
  if (!await exists(target)) return false;
  const details = await assertRegularFile(target, target, ioStat);
  if (details.size !== entry.bytes) return false;
  return await sha256File(target) === expectedHash(entry);
}

function sameSourceSnapshot(before, after) {
  return before.size === after.size
    && Number(before.mtimeMs) === Number(after.mtimeMs)
    && (before.ino === undefined || after.ino === undefined || before.ino === after.ino);
}

function createIo(hooks = {}) {
  return {
    copy: hooks.copy ?? ((source, target) => copyFile(source, target)),
    stat: hooks.stat ?? stat,
    diskSpace: hooks.diskSpace ?? (async (target) => {
      const disk = await statfs(target);
      return Number(disk.bavail) * Number(disk.bsize);
    }),
    failurePoint: hooks.failurePoint ?? (async () => {}),
    offlineImportPreflight: hooks.offlineImportPreflight ?? (async () => false),
  };
}

function canonicalBytes(value) {
  return Buffer.byteLength(canonicalJson(value), 'utf8');
}

function deploymentBudget(parts) {
  const payloadBytes = Number(parts.payloadBytes ?? 0);
  const supportBytes = Number(parts.supportBytes ?? 0);
  const manifestBytes = Number(parts.manifestBytes ?? 0);
  const receiptBytes = Number(parts.receiptBytes ?? 0);
  const temporaryOverlapBytes = payloadBytes + supportBytes + manifestBytes + receiptBytes;
  const requiredBytes = payloadBytes + supportBytes + manifestBytes + receiptBytes + temporaryOverlapBytes + TRANSACTION_RESERVE_BYTES;
  return Object.freeze({
    payloadBytes,
    supportBytes,
    manifestBytes,
    receiptBytes,
    temporaryOverlapBytes,
    transactionReserveBytes: TRANSACTION_RESERVE_BYTES,
    requiredBytes,
  });
}

async function ensureDirectory(target) {
  await assertNoReparseRedirect(target, target, true);
  await mkdir(target, { recursive: true });
  await assertNoReparseRedirect(target, target, false);
}

async function ensureEmptyStateCustomNodes(installRoot) {
  const directory = path.join(installRoot, 'state', 'custom_nodes');
  await ensureDirectory(directory);
  assert((await readdir(directory)).length === 0, 'state/custom_nodes must be an empty regular directory', 'managed_root_unrelated');
}

async function removeRegularFile(target) {
  if (!await exists(target)) return;
  await assertNoReparseRedirect(path.dirname(target), 'replacement parent', false);
  await assertRegularFile(target, 'replacement target');
  await unlink(target);
}

async function atomicVerifiedCopy(source, target, entry, io, context = {}) {
  expectedHash(entry);
  await ensureDirectory(path.dirname(target));
  await assertNoReparseRedirect(path.dirname(target), 'copy target parent', false);
  if (await verifyRegularFile(target, entry, io.stat)) return { state: 'reused', bytes: 0 };
  if (await exists(target)) {
    assert(context.replaceCorrupt === true, `completed target does not match manifest: ${entry.targetPath}`, 'completed_target_mismatch');
    await assertRegularFile(target, 'corrupt completed target', io.stat);
  }

  const part = `${target}.part`;
  if (await exists(part)) {
    await assertNoReparseRedirect(path.dirname(part), 'part parent', false);
    await assertRegularFile(part, 'part file', io.stat);
    if (!await verifyRegularFile(part, entry, io.stat)) await removeRegularFile(part);
  }

  if (!await exists(part)) {
    await io.failurePoint('before_copy', { ...context, entry, source, target, part });
    const before = await assertRegularFile(source, 'payload source', io.stat);
    assert(before.size === entry.bytes, `source size does not match manifest: ${entry.logicalPath}`, 'source_size_mismatch');
    await io.copy(source, part, { ...context, entry });
    const after = await assertRegularFile(source, 'payload source after copy', io.stat);
    assert(sameSourceSnapshot(before, after), `source changed while copying: ${entry.logicalPath}`, 'source_mutated');
    await io.failurePoint('after_copy', { ...context, entry, source, target, part });
  }

  assert(await verifyRegularFile(part, entry, io.stat), `staged copy failed verification: ${entry.targetPath}`, 'copy_verification_failed');
  await io.failurePoint('after_verify_part', { ...context, entry, source, target, part });
  if (await exists(target)) await removeRegularFile(target);
  await assertNoReparseRedirect(path.dirname(target), 'promotion parent', false);
  await rename(part, target);
  await io.failurePoint('after_promote', { ...context, entry, source, target });
  return { state: 'copied', bytes: entry.bytes };
}

function manifestDigestPrefix(manifest) {
  return manifest.bundle.digest.slice(0, 12);
}

function normalizeBindings(bindings) {
  if (bindings instanceof Map) return new Map(bindings);
  assert(bindings && typeof bindings === 'object' && !Array.isArray(bindings), 'sourceRoots must be an object or Map', 'source_binding_invalid');
  return new Map(Object.entries(bindings));
}

async function resolveSourceBindings(manifest, bindings, compiledRoot) {
  const input = normalizeBindings(bindings);
  assert(!input.has(MANAGED_COMFY_COMPILED_SOURCE_ID), 'reserved compiled source root cannot be caller-bound', 'source_binding_reserved');
  const required = [...new Set(manifest.payloadFiles.map((entry) => entry.sourceId).filter((id) => id !== MANAGED_COMFY_COMPILED_SOURCE_ID))].sort(compareText);
  assert(input.size === required.length, 'source root bindings must exactly match manifest source IDs', 'source_binding_mismatch');
  const resolved = new Map();
  for (const sourceId of required) {
    assert(input.has(sourceId), `missing source root binding: ${sourceId}`, 'source_binding_missing');
    const supplied = assertAbsoluteLocal(input.get(sourceId), `source root ${sourceId}`);
    const info = await lstat(supplied);
    assert(info.isDirectory() || info.isSymbolicLink(), `source root ${sourceId} must be a directory`, 'source_root_invalid');
    const real = await realpath(supplied);
    const realInfo = await stat(real);
    assert(realInfo.isDirectory(), `source root ${sourceId} must resolve to a directory`, 'source_root_invalid');
    resolved.set(sourceId, real);
  }
  if (manifest.payloadFiles.some((entry) => entry.sourceId === MANAGED_COMFY_COMPILED_SOURCE_ID)) {
    assert(compiledRoot, 'compiled manifest payload root is required', 'compiled_source_missing');
    const real = await realpath(await assertNoReparseRedirect(compiledRoot, 'compiled payload root', false));
    resolved.set(MANAGED_COMFY_COMPILED_SOURCE_ID, real);
  }
  return resolved;
}

async function resolveSourceFile(root, logicalPath, ioStat = stat) {
  const target = path.join(root, ...logicalPath.split('/'));
  assert(isInside(root, target), `source path escapes root: ${logicalPath}`, 'source_escape');
  let cursor = root;
  for (const segment of logicalPath.split('/')) {
    cursor = path.join(cursor, segment);
    const info = await lstat(cursor);
    assert(!info.isSymbolicLink(), `source contains nested reparse point: ${logicalPath}`, 'source_reparse');
  }
  await assertRegularFile(target, 'payload source', ioStat);
  return target;
}

async function availableSpaceFor(target, io, context) {
  const ancestor = await nearestExistingAncestor(target);
  return Number(await io.diskSpace(ancestor, context));
}

async function writeCanonicalPart(target, value) {
  await ensureDirectory(path.dirname(target));
  const part = `${target}.part`;
  if (await exists(part)) await removeRegularFile(part);
  const handle = await open(part, 'wx', 0o600);
  try {
    await handle.writeFile(canonicalJson(value), 'utf8');
  } finally {
    await handle.close();
  }
  if (await exists(target)) await assertRegularFile(target, 'atomic replacement target');
  await rename(part, target);
}

async function installerSupportPlan(source, target) {
  const details = await assertRegularFile(source, 'installer support source');
  const hash = await sha256File(source);
  const entry = { logicalPath: path.basename(source), targetPath: path.basename(target), bytes: details.size, hash: { algorithm: 'sha256', state: 'computed', value: hash } };
  return { source, target, entry };
}

async function copySupportFile(item, io) {
  return atomicVerifiedCopy(item.source, item.target, item.entry, io, { replaceCorrupt: true, phase: 'support' });
}

export async function buildPrivateBundle(options) {
  const copyConcurrency = normalizeCopyConcurrency(options.copyConcurrency);
  const manifest = validateLocalBundleManifestV1(structuredClone(options.manifest));
  assert(manifest.buildState === 'build_ready', 'bundle manifest must be build_ready', 'manifest_not_ready');
  assertSafeSegment(manifest.bundle.id, 'bundle ID');
  assertSafeSegment(manifest.bundle.version, 'bundle version');
  const io = createIo(options.hooks);
  const productRoot = await realpath(assertAbsoluteLocal(options.productRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'product root'));
  const bundleDir = assertAbsoluteLocal(options.bundleDir, 'bundle directory');
  const bundleParent = path.dirname(bundleDir);
  await assertNoReparseRedirect(bundleParent, 'bundle parent', false);
  const compiledRoot = options.manifestPath ? path.join(path.dirname(assertAbsoluteLocal(options.manifestPath, 'manifest path')), 'payload') : null;
  const sources = await resolveSourceBindings(manifest, options.sourceRoots, compiledRoot);
  for (const root of sources.values()) assert(!isInside(root, bundleDir) && !isInside(bundleDir, root), 'bundle destination must be outside source roots', 'destination_source_overlap');
  assert(!isInside(productRoot, bundleDir), 'bundle destination must be outside the product repository', 'destination_product_overlap');
  assert(!await exists(bundleDir), 'final bundle directory already exists', 'bundle_exists');

  const staging = path.join(bundleParent, `${path.basename(bundleDir)}.staging-${manifestDigestPrefix(manifest)}`);
  await assertNoReparseRedirect(staging, 'bundle staging directory', true);
  if (await exists(staging)) {
    const info = await lstat(staging);
    assert(info.isDirectory() && !info.isSymbolicLink(), 'bundle staging path must be a regular directory', 'path_reparse');
  }

  const plan = [];
  for (const entry of manifest.payloadFiles) {
    validateLogicalTargetPath(entry.targetPath, entry.category);
    expectedHash(entry);
    const root = sources.get(entry.sourceId);
    const sourceLogicalPath = entry.sourceId === MANAGED_COMFY_COMPILED_SOURCE_ID ? entry.targetPath : entry.logicalPath;
    const source = await resolveSourceFile(root, sourceLogicalPath, io.stat);
    const details = await io.stat(source);
    assert(details.size === entry.bytes, `source size does not match manifest: ${entry.logicalPath}`, 'source_size_mismatch');
    plan.push({ entry, source, target: path.join(staging, 'payload', ...entry.targetPath.split('/')) });
  }
  const bridgeEntry = manifest.payloadFiles.find((entry) => entry.sourceId === MANAGED_COMFY_COMPILED_SOURCE_ID && entry.category === 'custom_node' && entry.targetPath === `extensions/custom-nodes/${MANAGED_COMFY_BRIDGE_ID}/__init__.py`);
  if (manifest.payloadFiles.some((entry) => entry.sourceId === MANAGED_COMFY_COMPILED_SOURCE_ID)) {
    assert(bridgeEntry, 'compiled manifest is missing the repository-owned bridge', 'compiled_bridge_missing');
    const repositoryBridge = path.join(productRoot, 'scripts', 'comfy-bundle', 'bridge', MANAGED_COMFY_BRIDGE_ID, '__init__.py');
    const repositoryBridgeDetails = await assertRegularFile(repositoryBridge, 'repository bridge source');
    assert(repositoryBridgeDetails.size === bridgeEntry.bytes && await sha256File(repositoryBridge) === expectedHash(bridgeEntry), 'compiled bridge does not match the repository-owned source', 'compiled_bridge_mismatch');
    assert(await verifyRegularFile(plan.find((item) => item.entry === bridgeEntry).source, bridgeEntry, io.stat), 'compiled bridge staging bytes do not match the repository-owned source', 'compiled_bridge_mismatch');
  }
  const supportRoot = options.installerSourceRoot ?? path.join(productRoot, 'scripts', 'comfy-bundle');
  const supportPlan = [
    await installerSupportPlan(path.join(supportRoot, 'install-private.ps1'), path.join(staging, 'installer', 'install-private.ps1')),
    await installerSupportPlan(path.join(supportRoot, 'install-private.cmd'), path.join(staging, 'install-private.cmd')),
  ];
  let remainingPayloadBytes = 0;
  for (const item of plan) if (!await verifyRegularFile(item.target, item.entry, io.stat)) remainingPayloadBytes += item.entry.bytes;
  let remainingSupportBytes = 0;
  for (const item of supportPlan) if (!await verifyRegularFile(item.target, item.entry, io.stat)) remainingSupportBytes += item.entry.bytes;
  const budget = deploymentBudget({
    payloadBytes: remainingPayloadBytes,
    supportBytes: remainingSupportBytes,
    manifestBytes: canonicalBytes(manifest),
  });
  assert(await availableSpaceFor(bundleParent, io, { phase: 'bundle', budget }) >= budget.requiredBytes, `insufficient disk space: need ${budget.requiredBytes} bytes`, 'disk_space');

  await ensureDirectory(path.join(staging, 'payload'));
  const payloadResults = await copyPayloadPlan(plan, copyConcurrency, (item) => (
    atomicVerifiedCopy(item.source, item.target, item.entry, io, { phase: 'bundle', replaceCorrupt: true })
  ));
  const copiedFiles = payloadResults.filter((result) => result.state === 'copied').length;
  const reusedFiles = payloadResults.length - copiedFiles;

  for (const item of supportPlan) await copySupportFile(item, io);
  await io.failurePoint('before_bundle_manifest', { staging, manifest });
  await writeCanonicalPart(path.join(staging, VERSION_MANIFEST), manifest);
  await io.failurePoint('before_bundle_publish', { staging, bundleDir, manifest });
  await assertNoReparseRedirect(staging, 'bundle staging directory', false);
  await rename(staging, bundleDir);
  await io.failurePoint('after_bundle_publish', { bundleDir, manifest });
  return { state: 'built', bundleDir, copiedFiles, reusedFiles, bytes: manifest.payloadFiles.reduce((sum, entry) => sum + entry.bytes, 0), requiredBytes: budget.requiredBytes, budget };
}

async function readManifestFromBundle(bundleRoot) {
  const manifestPath = path.join(bundleRoot, VERSION_MANIFEST);
  await assertRegularFile(manifestPath, 'bundle manifest');
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

async function readReceipt(receiptPath) {
  if (!await exists(receiptPath)) return null;
  await assertRegularFile(receiptPath, 'installation receipt');
  return validateInstallationReceiptV1(JSON.parse(await readFile(receiptPath, 'utf8')));
}

function identityMatches(left, right) {
  return left.id === right.id && left.version === right.version && left.digest === right.digest;
}

async function assertManagedRootIdentity(installRoot, manifest, receipt) {
  if (receipt) {
    assert(receipt.bundle.id === manifest.bundle.id, 'managed root is owned by a different bundle ID', 'bundle_identity_conflict');
    if (receipt.bundle.version === manifest.bundle.version) assert(receipt.bundle.digest === manifest.bundle.digest, 'same bundle ID/version has a different digest', 'bundle_digest_conflict');
    assert(canonicalLocalPath(receipt.installation.installRoot) === canonicalLocalPath(installRoot), 'managed receipt belongs to a different installation root', 'bundle_identity_conflict');
  }
  const versionsRoot = path.join(installRoot, 'versions');
  if (!await exists(versionsRoot)) return;
  await assertNoReparseRedirect(versionsRoot, 'versions root', false);
  const entries = await readdir(versionsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail('versions root contains an unsafe entry', 'path_reparse');
    assert(entry.name.toLowerCase() === manifest.bundle.id.toLowerCase(), 'managed root contains a different bundle ID', 'bundle_identity_conflict');
  }
}

function normalizedRelative(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

function addAllowedFile(files, directories, relative) {
  const normalized = relative.replaceAll('\\', '/');
  files.add(normalized.toLowerCase());
  let parent = path.posix.dirname(normalized);
  while (parent !== '.') {
    directories.add(parent.toLowerCase());
    parent = path.posix.dirname(parent);
  }
}

function addAllowedDirectory(directories, relative) {
  let current = relative.replaceAll('\\', '/');
  while (current && current !== '.') {
    directories.add(current.toLowerCase());
    current = path.posix.dirname(current);
  }
}

async function enumerateManagedRoot(installRoot) {
  if (!await exists(installRoot)) return [];
  const rootInfo = await lstat(installRoot);
  assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'installation root must be a regular directory', 'path_reparse');
  const result = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const info = await lstat(target);
      assert(!info.isSymbolicLink(), `managed root contains a reparse point: ${normalizedRelative(installRoot, target)}`, 'path_reparse');
      const relative = normalizedRelative(installRoot, target);
      if (info.isDirectory()) {
        result.push({ relative, kind: 'directory' });
        await visit(target);
      } else if (info.isFile()) {
        result.push({ relative, kind: 'file' });
      } else {
        fail(`managed root contains an unsupported entry: ${relative}`, 'managed_root_unrelated');
      }
    }
  }
  await visit(installRoot);
  return result;
}

async function collectInstalledManifests(installRoot, requestedManifest, receipt) {
  const manifests = [];
  const bundleIdRoot = path.join(installRoot, 'versions', requestedManifest.bundle.id);
  if (!await exists(bundleIdRoot)) return manifests;
  const currentStage = `${requestedManifest.bundle.version}.staging-${manifestDigestPrefix(requestedManifest)}`;
  for (const entry of await readdir(bundleIdRoot, { withFileTypes: true })) {
    assert(entry.isDirectory() && !entry.isSymbolicLink(), 'bundle version root contains an unsafe entry', 'path_reparse');
    const versionRoot = path.join(bundleIdRoot, entry.name);
    if (entry.name === currentStage) {
      const stageManifestPath = path.join(versionRoot, VERSION_MANIFEST);
      if (await exists(stageManifestPath)) {
        const stageManifest = validateLocalBundleManifestV1(JSON.parse(await readFile(stageManifestPath, 'utf8')));
        assert(identityMatches(stageManifest.bundle, requestedManifest.bundle), 'staged version identity conflicts with requested bundle', 'bundle_digest_conflict');
      }
      manifests.push({ manifest: requestedManifest, relativeRoot: `versions/${requestedManifest.bundle.id}/${currentStage}`, staged: true });
      continue;
    }
    assert(!entry.name.toLowerCase().includes('.staging-'), 'managed root contains ambiguous orphaned version staging', 'managed_root_unrelated');
    assert(receipt || entry.name === requestedManifest.bundle.version, 'unmanaged root contains an unrelated completed version', 'managed_root_unrelated');
    const installed = await inspectVersionIdentity(versionRoot);
    assert(installed.bundle.id === requestedManifest.bundle.id && installed.bundle.version === entry.name, 'installed version identity does not match its directory', 'bundle_identity_conflict');
    if (entry.name === requestedManifest.bundle.version) assert(identityMatches(installed.bundle, requestedManifest.bundle), 'existing version identity conflicts with requested bundle', 'bundle_digest_conflict');
    manifests.push({ manifest: installed, relativeRoot: `versions/${requestedManifest.bundle.id}/${entry.name}`, staged: false });
  }
  return manifests;
}

async function assertManagedRootContents(installRoot, manifest, receipt, installationId) {
  const entries = await enumerateManagedRoot(installRoot);
  if (entries.length === 0) return;
  if (receipt) assert(receipt.installation.id === installationId, 'managed receipt belongs to a different installation ID', 'bundle_identity_conflict');

  const allowedFiles = new Set();
  const allowedDirectories = new Set();
  const emptyRuntimeDirectories = new Set(['state/custom_nodes']);
  const installedManifests = await collectInstalledManifests(installRoot, manifest, receipt);
  addAllowedDirectory(allowedDirectories, `versions/${manifest.bundle.id}`);
  for (const item of installedManifests) {
    addAllowedDirectory(allowedDirectories, item.relativeRoot);
    // folder_paths creates this directory during import, before state paths are applied.
    const runtimeInput = `${item.relativeRoot}/runtime/comfyui/input`;
    emptyRuntimeDirectories.add(runtimeInput.toLowerCase());
    addAllowedDirectory(allowedDirectories, runtimeInput);
    addAllowedFile(allowedFiles, allowedDirectories, `${item.relativeRoot}/${VERSION_MANIFEST}`);
    addAllowedFile(allowedFiles, allowedDirectories, `${item.relativeRoot}/${VERSION_MANIFEST}.part`);
    for (const payload of item.manifest.payloadFiles.filter((entry) => entry.category !== 'model')) {
      addAllowedFile(allowedFiles, allowedDirectories, `${item.relativeRoot}/${payload.targetPath}`);
      addAllowedFile(allowedFiles, allowedDirectories, `${item.relativeRoot}/${payload.targetPath}.part`);
    }
  }

  const modelManifests = [...installedManifests.map((item) => item.manifest), manifest];
  for (const sourceManifest of modelManifests) {
    for (const payload of sourceManifest.payloadFiles.filter((entry) => entry.category === 'model')) {
      addAllowedFile(allowedFiles, allowedDirectories, payload.targetPath);
      addAllowedFile(allowedFiles, allowedDirectories, `${payload.targetPath}.part`);
    }
  }
  for (const payload of manifest.payloadFiles.filter((entry) => entry.category === 'model')) {
    const parts = payload.targetPath.split('/');
    const staged = `models/${parts[1]}/.staging-${installationId}/${parts.slice(2).join('/')}`;
    addAllowedFile(allowedFiles, allowedDirectories, staged);
    addAllowedFile(allowedFiles, allowedDirectories, `${staged}.part`);
  }

  for (const directory of STATE_DIRECTORIES) addAllowedDirectory(allowedDirectories, `state/${directory}`);
  addAllowedFile(allowedFiles, allowedDirectories, RECEIPT_PATH);
  addAllowedFile(allowedFiles, allowedDirectories, `${RECEIPT_PATH}.part`);
  const receiptPartPath = path.join(installRoot, ...`${RECEIPT_PATH}.part`.split('/'));
  const pendingReceiptExists = await exists(receiptPartPath);
  if (pendingReceiptExists) {
    const pendingReceipt = validateInstallationReceiptV1(JSON.parse(await readFile(receiptPartPath, 'utf8')));
    assert(identityMatches(pendingReceipt.bundle, manifest.bundle), 'pending receipt identity conflicts with requested bundle', 'bundle_identity_conflict');
    assert(pendingReceipt.installation.id === installationId && canonicalLocalPath(pendingReceipt.installation.installRoot) === canonicalLocalPath(installRoot), 'pending receipt belongs to another installation', 'bundle_identity_conflict');
  }
  const mutablePrefixes = STATE_DIRECTORIES.filter((name) => name !== 'private' && name !== 'custom_nodes').map((name) => `state/${name}`);

  if (!receipt) {
    const modelIdentityPaths = new Set();
    for (const payload of manifest.payloadFiles.filter((entry) => entry.category === 'model')) {
      modelIdentityPaths.add(payload.targetPath.toLowerCase());
      modelIdentityPaths.add(`${payload.targetPath}.part`.toLowerCase());
      const parts = payload.targetPath.split('/');
      modelIdentityPaths.add(`models/${parts[1]}/.staging-${installationId}`.toLowerCase());
    }
    const hasInterruptedIdentity = installedManifests.length > 0 || pendingReceiptExists || entries.some((entry) => {
      const relative = entry.relative.replaceAll('\\', '/').toLowerCase();
      for (const identityPath of modelIdentityPaths) {
        if (relative === identityPath || relative.startsWith(`${identityPath}/`)) return true;
      }
      return false;
    });
    assert(hasInterruptedIdentity, 'non-empty installation root has no exact managed interruption identity', 'managed_root_unrelated');
  }

  for (const entry of entries) {
    const relative = entry.relative.replaceAll('\\', '/').toLowerCase();
    if (emptyRuntimeDirectories.has(relative)) {
      assert(entry.kind === 'directory' && (await readdir(path.join(installRoot, entry.relative))).length === 0,
        `managed runtime path must be an empty regular directory: ${entry.relative}`, 'managed_root_unrelated');
    }
    const mutableOwned = Boolean(receipt) && mutablePrefixes.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
    const allowed = entry.kind === 'directory'
      ? allowedDirectories.has(relative) || mutableOwned
      : allowedFiles.has(relative) || mutableOwned;
    assert(allowed, `installation root contains unrelated or ambiguous content: ${entry.relative}`, 'managed_root_unrelated');
  }
}

async function inspectVersionIdentity(versionRoot) {
  if (!await exists(versionRoot)) return null;
  await assertNoReparseRedirect(versionRoot, 'version directory', false);
  const manifestPath = path.join(versionRoot, VERSION_MANIFEST);
  assert(await exists(manifestPath), 'existing version has no identity manifest', 'version_identity_missing');
  return validateLocalBundleManifestV1(JSON.parse(await readFile(manifestPath, 'utf8')));
}

function installedTargetFor(installRoot, versionRoot, entry) {
  if (entry.category === 'model') return path.join(installRoot, ...entry.targetPath.split('/'));
  return path.join(versionRoot, ...entry.targetPath.split('/'));
}

async function evaluateRuntime(manifest, metadata, io, context) {
  if (!metadata || !['portable', 'rebuilt'].includes(metadata.strategy) || metadata.manifestDigest !== manifest.bundle.digest) {
    return { id: 'runtime', state: 'blocked', findings: ['portable_runtime_metadata_required'] };
  }
  if (manifest.runtime.pythonPortability === 'rebuild_required' && metadata.strategy !== 'rebuilt') {
    return { id: 'runtime', state: 'blocked', findings: ['offline_python_rebuild_required'] };
  }
  try {
    if (await io.offlineImportPreflight({ ...context, metadata, manifest })) return { id: 'runtime', state: 'ready', findings: [] };
  } catch {
    return { id: 'runtime', state: 'blocked', findings: ['offline_import_preflight_failed'] };
  }
  return { id: 'runtime', state: 'blocked', findings: ['offline_import_preflight_failed'] };
}

async function verifyInstalledPayload(manifest, installRoot, versionRoot, io) {
  for (const entry of manifest.payloadFiles) {
    const target = installedTargetFor(installRoot, versionRoot, entry);
    if (!await verifyRegularFile(target, entry, io.stat)) return false;
  }
  return true;
}

function receiptBudgetValue(manifest, options, installRoot) {
  const capabilities = [{ id: 'runtime', state: 'blocked', findings: ['portable_runtime_metadata_required'] }, ...manifest.capabilities.map((capability) => ({
    id: capability.id,
    state: 'blocked',
    findings: ['runtime_not_ready'],
  }))];
  return createInstallationReceiptV1({
    bundle: manifest.bundle,
    installation: {
      id: options.installationId,
      installRoot,
      modelRoots: [path.join(installRoot, 'models')],
      endpoint: options.endpoint,
      state: 'installed',
    },
    capabilities,
  }, { clock: options.clock });
}

async function removeVerifiedEmptyDirectoryTree(root, io) {
  if (!await exists(root)) return;
  await assertNoReparseRedirect(root, 'model staging cleanup root', false);
  const directories = [];
  async function inspect(directory) {
    const info = await lstat(directory);
    assert(info.isDirectory() && !info.isSymbolicLink(), 'model staging cleanup encountered a reparse point', 'path_reparse');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      const childInfo = await lstat(child);
      assert(childInfo.isDirectory() && !childInfo.isSymbolicLink(), 'model staging cleanup requires a verified-empty non-reparse tree', 'model_staging_not_empty');
      await inspect(child);
    }
    directories.push(directory);
  }
  await inspect(root);
  await io.failurePoint('before_model_staging_cleanup', { root, directories: [...directories] });
  for (const directory of directories) {
    await io.failurePoint('before_model_staging_directory_remove', { root, directory });
    await assertNoReparseRedirect(directory, 'model staging cleanup directory', false);
    const info = await lstat(directory);
    assert(info.isDirectory() && !info.isSymbolicLink(), 'model staging cleanup encountered a reparse point', 'path_reparse');
    assert((await readdir(directory)).length === 0, 'model staging cleanup directory is not empty', 'model_staging_not_empty');
    await rmdir(directory);
  }
  await io.failurePoint('after_model_staging_cleanup', { root });
}

export async function verifyInstallationReceipt(receipt, manifest, options = {}) {
  validateInstallationReceiptV1(receipt);
  validateLocalBundleManifestV1(manifest);
  assert(identityMatches(receipt.bundle, manifest.bundle), 'receipt bundle identity does not match manifest', 'receipt_identity_mismatch');
  assert(receipt.storage.logicalPath === RECEIPT_PATH, 'receipt storage path is invalid', 'receipt_path');
  const installRoot = assertAbsoluteLocal(receipt.installation.installRoot, 'receipt install root');
  const versionRoot = path.join(installRoot, 'versions', manifest.bundle.id, manifest.bundle.version);
  return verifyInstalledPayload(manifest, installRoot, versionRoot, createIo(options.hooks));
}

export async function installPrivateBundle(options) {
  const io = createIo(options.hooks);
  const bundleRoot = await realpath(await assertNoReparseRedirect(options.bundleRoot, 'bundle root', false));
  const manifest = validateLocalBundleManifestV1(structuredClone(options.manifest ?? await readManifestFromBundle(bundleRoot)));
  assert(manifest.buildState === 'build_ready', 'bundle manifest must be build_ready', 'manifest_not_ready');
  assertInstallInputs(manifest, options);
  const installRoot = assertAbsoluteLocal(options.installRoot, 'installation root');
  await assertNoReparseRedirect(installRoot, 'installation root', true);
  assert(!isInside(bundleRoot, installRoot) && !isInside(installRoot, bundleRoot), 'installation and bundle roots must not overlap', 'destination_source_overlap');
  const receiptPath = path.join(installRoot, ...RECEIPT_PATH.split('/'));
  const receipt = await readReceipt(receiptPath);
  await assertManagedRootIdentity(installRoot, manifest, receipt);
  await assertManagedRootContents(installRoot, manifest, receipt, options.installationId);

  const bundleIdRoot = path.join(installRoot, 'versions', manifest.bundle.id);
  const versionFinal = path.join(bundleIdRoot, manifest.bundle.version);
  const versionStaging = path.join(bundleIdRoot, `${manifest.bundle.version}.staging-${manifestDigestPrefix(manifest)}`);
  const modelStagingRoots = [...new Set(manifest.payloadFiles
    .filter((entry) => entry.category === 'model')
    .map((entry) => path.join(installRoot, 'models', entry.targetPath.split('/')[1], `.staging-${options.installationId}`)))];
  if (await exists(bundleIdRoot)) {
    await assertNoReparseRedirect(bundleIdRoot, 'bundle version root', false);
    const entries = await readdir(bundleIdRoot, { withFileTypes: true });
    const prefix = `${manifest.bundle.version}.staging-`.toLowerCase();
    for (const entry of entries) {
      if (entry.name.toLowerCase().startsWith(prefix) && canonicalLocalPath(path.join(bundleIdRoot, entry.name)) !== canonicalLocalPath(versionStaging)) {
        fail('same bundle ID/version has a different staging digest', 'bundle_digest_conflict');
      }
    }
  }
  const existingVersionManifest = await inspectVersionIdentity(versionFinal);
  if (existingVersionManifest) assert(identityMatches(existingVersionManifest.bundle, manifest.bundle), 'existing version identity conflicts with requested bundle', 'bundle_digest_conflict');

  if (receipt && identityMatches(receipt.bundle, manifest.bundle) && await verifyInstalledPayload(manifest, installRoot, versionFinal, io)) {
    for (const stagingRoot of modelStagingRoots) await removeVerifiedEmptyDirectoryTree(stagingRoot, io);
    await ensureEmptyStateCustomNodes(installRoot);
    return { state: 'already_verified', receipt, copiedFiles: 0, reusedFiles: manifest.payloadFiles.length, requiredBytes: 0, budget: null };
  }

  await assertNoReparseRedirect(versionStaging, 'version staging directory', true);
  const sourcePlan = [];
  const payloadRoot = path.join(bundleRoot, 'payload');
  await assertNoReparseRedirect(payloadRoot, 'bundle payload root', false);
  for (const entry of manifest.payloadFiles) {
    expectedHash(entry);
    const source = await resolveSourceFile(payloadRoot, entry.targetPath, io.stat);
    const details = await io.stat(source);
    assert(details.size === entry.bytes, `bundle payload size mismatch: ${entry.targetPath}`, 'source_size_mismatch');
    sourcePlan.push({ entry, source });
  }

  for (const { entry } of sourcePlan.filter((item) => item.entry.category === 'model')) {
    const sharedTarget = installedTargetFor(installRoot, versionFinal, entry);
    if (await exists(sharedTarget)) assert(await verifyRegularFile(sharedTarget, entry, io.stat), `shared model conflict: ${entry.targetPath}`, 'shared_model_conflict');
  }

  const ownedCompletedVersion = receipt && identityMatches(receipt.bundle, manifest.bundle);
  if (existingVersionManifest && !ownedCompletedVersion) {
    assert(await verifyInstalledPayload(manifest, installRoot, versionFinal, io), 'existing unowned version is incomplete or corrupt', 'completed_target_mismatch');
  }

  let remainingPayloadBytes = 0;
  for (const { entry } of sourcePlan) {
    if (entry.category === 'model') {
      const shared = installedTargetFor(installRoot, versionFinal, entry);
      if (!await exists(shared)) {
        const staged = path.join(installRoot, 'models', entry.targetPath.split('/')[1], `.staging-${options.installationId}`, ...entry.targetPath.split('/').slice(2));
        if (!await verifyRegularFile(staged, entry, io.stat)) remainingPayloadBytes += entry.bytes;
      }
    } else {
      const base = existingVersionManifest ? versionFinal : versionStaging;
      const target = installedTargetFor(installRoot, base, entry);
      if (!await verifyRegularFile(target, entry, io.stat)) remainingPayloadBytes += entry.bytes;
    }
  }
  const receiptBudget = receiptBudgetValue(manifest, options, installRoot);
  const budget = deploymentBudget({
    payloadBytes: remainingPayloadBytes,
    manifestBytes: existingVersionManifest ? 0 : canonicalBytes(manifest),
    receiptBytes: canonicalBytes(receiptBudget),
  });
  assert(await availableSpaceFor(installRoot, io, { phase: 'install', budget }) >= budget.requiredBytes, `insufficient disk space: need ${budget.requiredBytes} bytes`, 'disk_space');

  await ensureDirectory(bundleIdRoot);
  if (!existingVersionManifest) await ensureDirectory(versionStaging);
  let copiedFiles = 0;
  let reusedFiles = 0;
  for (const { entry, source } of sourcePlan.filter((item) => item.entry.category !== 'model')) {
    const base = existingVersionManifest ? versionFinal : versionStaging;
    const target = installedTargetFor(installRoot, base, entry);
    const result = await atomicVerifiedCopy(source, target, entry, io, { phase: 'install-version', replaceCorrupt: Boolean(ownedCompletedVersion) || !existingVersionManifest });
    if (result.state === 'copied') copiedFiles += 1;
    else reusedFiles += 1;
  }

  for (const { entry, source } of sourcePlan.filter((item) => item.entry.category === 'model')) {
    const sharedTarget = installedTargetFor(installRoot, versionFinal, entry);
    if (await verifyRegularFile(sharedTarget, entry, io.stat)) {
      reusedFiles += 1;
      continue;
    }
    const parts = entry.targetPath.split('/');
    const stagedTarget = path.join(installRoot, 'models', parts[1], `.staging-${options.installationId}`, ...parts.slice(2));
    const result = await atomicVerifiedCopy(source, stagedTarget, entry, io, { phase: 'install-model', replaceCorrupt: true });
    if (result.state === 'copied') copiedFiles += 1;
    else reusedFiles += 1;
    await ensureDirectory(path.dirname(sharedTarget));
    if (await exists(sharedTarget)) assert(await verifyRegularFile(sharedTarget, entry, io.stat), `shared model conflict: ${entry.targetPath}`, 'shared_model_conflict');
    else {
      await assertNoReparseRedirect(path.dirname(sharedTarget), 'shared model parent', false);
      await rename(stagedTarget, sharedTarget);
    }
  }
  for (const stagingRoot of modelStagingRoots) await removeVerifiedEmptyDirectoryTree(stagingRoot, io);

  if (!existingVersionManifest) {
    await writeCanonicalPart(path.join(versionStaging, VERSION_MANIFEST), manifest);
    await io.failurePoint('before_version_publish', { versionStaging, versionFinal, manifest });
    await rename(versionStaging, versionFinal);
    await io.failurePoint('after_version_publish', { versionFinal, manifest });
  }

  for (const directory of STATE_DIRECTORIES) await ensureDirectory(path.join(installRoot, 'state', directory));
  await ensureEmptyStateCustomNodes(installRoot);
  const runtime = await evaluateRuntime(manifest, options.runtimeMetadata, io, { bundleRoot, installRoot, versionRoot: versionFinal });
  const capabilities = [runtime, ...manifest.capabilities.map((capability) => ({
    id: capability.id,
    state: runtime.state === 'ready' ? 'ready' : 'blocked',
    findings: runtime.state === 'ready' ? [] : ['runtime_not_ready'],
  }))].sort((left, right) => compareText(left.id, right.id));
  const nextReceipt = createInstallationReceiptV1({
    bundle: manifest.bundle,
    installation: {
      id: options.installationId,
      installRoot,
      modelRoots: [path.join(installRoot, 'models')],
      endpoint: options.endpoint,
      state: 'installed',
    },
    capabilities,
  }, { clock: options.clock });
  assert(canonicalBytes(nextReceipt) <= budget.receiptBytes, 'installation receipt exceeded the conservative disk budget', 'disk_budget_internal');
  await io.failurePoint('before_receipt_commit', { receiptPath, receipt: nextReceipt });
  await writeCanonicalPart(receiptPath, nextReceipt);
  await io.failurePoint('after_receipt_commit', { receiptPath, receipt: nextReceipt });
  return { state: receipt ? 'upgraded' : 'installed', receipt: nextReceipt, copiedFiles, reusedFiles, requiredBytes: budget.requiredBytes, budget };
}

export const managedComfyDeploymentPaths = Object.freeze({
  receipt: RECEIPT_PATH,
  stateDirectories: [...STATE_DIRECTORIES],
});

export const managedComfyDeploymentPolicy = Object.freeze({
  transactionReserveBytes: TRANSACTION_RESERVE_BYTES,
});
