import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUpdateManifest } from '../scripts/portable-launcher.mjs';
import { connectorVersion, connectorDistribution } from '../server/agent-version.js';
import { readFile } from 'node:fs/promises';

const file = { path: 'portable-main.mjs', url: '/downloads/heiyan-connector-update/1.3.0/portable-main.mjs', bytes: 42, sha256: 'a'.repeat(64) };
const manifest = { schema: 1, channel: 'stable', distribution: connectorDistribution, version: '1.3.0', minBootstrapVersion: '1.0.0', runtime: { node: '22.23.2', codex: '0.153.4' }, files: [file] };

test('accepts a bounded same-site connector update manifest', () => {
  assert.equal(validateUpdateManifest(manifest, 'https://heiyan.example').version, '1.3.0');
});

test('never replaces the standalone connector with platform or unmarked update bundles', () => {
  for (const distribution of [undefined, 'heiyan-platform', 'other']) {
    assert.throws(() => validateUpdateManifest({ ...manifest, distribution }, 'https://heiyan.example'), /开源独立版/);
  }
});

test('source package version agrees with the runtime and generated download version', async () => {
  const pkg = JSON.parse(await readFile(new URL('../server/agent-package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, connectorVersion);
  for (const filename of ['build-connector-update.mjs', 'split-portable-download.mjs']) {
    const source = await readFile(new URL('../scripts/' + filename, import.meta.url), 'utf8');
    assert.match(source, /connectorVersion/); assert.doesNotMatch(source, /'1\.6\.0'/);
  }
});

test('rejects unsafe update paths, hashes and incompatible runtimes', () => {
  for (const patch of [
    { path: '../connector.json' },
    { url: 'https://evil.example/payload.js' },
    { bytes: 2 * 1024 * 1024 },
    { sha256: 'bad' },
  ]) assert.throws(() => validateUpdateManifest({ ...manifest, files: [{ ...file, ...patch }] }, 'https://heiyan.example'));
  assert.throws(() => validateUpdateManifest({ ...manifest, runtime: { ...manifest.runtime, codex: '9.9.9' } }, 'https://heiyan.example'));
});
