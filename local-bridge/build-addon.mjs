import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const product = path.join(here, 'engine');
const projectRoot = path.resolve(here, '..');
const output = path.resolve(process.argv[2] || path.join(here, '../.runtime/site-connector-addon'));
const root = path.join(output, 'HEIYAN');
const bridge = path.join(root, 'SiteBridge');
// Build into a new directory. Never overwrite an installed helper or copy user state.
await fs.mkdir(output, { recursive: true });
await fs.mkdir(root);
await fs.mkdir(bridge);
for (const file of ['gateway.mjs', 'entry.mjs', 'deployment-target.mjs', 'package-models.mjs', 'remote-gateway.mjs', 'quick-tunnel.mjs', 'cloudflared-release.json']) await fs.copyFile(path.join(here, file), path.join(bridge, file));
await fs.copyFile(path.join(here, 'portable/start.py'), path.join(root, 'start.py'));
for (const file of ['Start-Site-Connector.cmd', 'Start-Remote-Connector.cmd', 'Reset-Remote-Access.cmd']) await fs.copyFile(path.join(here, file), path.join(root, file));
const cloudflared = path.resolve(process.argv[3] || path.join(here, '../.runtime/cloudflared.exe'));
const release = JSON.parse(await fs.readFile(path.join(here, 'cloudflared-release.json'), 'utf8'));
const binary = await fs.readFile(cloudflared);
if (binary.length !== release.size || createHash('sha256').update(binary).digest('hex') !== release.sha256) throw new Error('Unverified cloudflared program; add-on was not packaged.');
await fs.copyFile(cloudflared, path.join(bridge, 'cloudflared.exe'));
const cloudflareLicense = await fetch(release.license, { signal: AbortSignal.timeout(20000) });
if (!cloudflareLicense.ok) throw new Error('Cloudflare license could not be included.');
await fs.writeFile(path.join(bridge, 'CLOUDFLARED-LICENSE.txt'), await cloudflareLicense.text());
await fs.copyFile(path.join(here, 'README.md'), path.join(root, 'Site-Connector-README.md'));
await fs.copyFile(path.join(here, 'Remote-Connector-README.md'), path.join(root, 'Remote-Connector-README.md'));
await fs.copyFile(process.execPath, path.join(bridge, 'node.exe'));
const nodeLicense = await fetch('https://raw.githubusercontent.com/nodejs/node/' + process.version + '/LICENSE', { signal: AbortSignal.timeout(20_000) });
if (!nodeLicense.ok) throw new Error('Could not retrieve the bundled Node runtime license.');
await fs.writeFile(path.join(bridge, 'NODE-LICENSE.txt'), await nodeLicense.text());
await fs.writeFile(path.join(bridge, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
for (const directory of ['server', 'shared', 'workflows', 'comfyui/workflows', 'public/character-guides']) {
  await fs.cp(path.join(product, directory), path.join(bridge, 'engine', directory), { recursive: true, filter: file => !/\.(?:test|spec)\./.test(file) && !file.endsWith('.log') });
}
await fs.copyFile(path.join(product, 'LICENSE'), path.join(bridge, 'engine', 'LICENSE'));
await fs.mkdir(path.join(bridge, 'engine/scripts/comfy-bundle'), { recursive: true });
await fs.copyFile(path.join(product, 'scripts/comfy-bundle/prepare-workflows.mjs'), path.join(bridge, 'engine/scripts/comfy-bundle/prepare-workflows.mjs'));
const copied = new Map();
async function copyDependency(name, parentPackage) {
  const require = createRequire(parentPackage);
  let entry;
  try { entry = require.resolve(name + '/package.json'); }
  catch { entry = require.resolve(name); }
  let folder = path.dirname(entry), metadata;
  for (;;) {
    try { const candidate = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8')); if (candidate.name === name) { metadata = candidate; break; } } catch {}
    const next = path.dirname(folder); if (next === folder) throw new Error('Dependency not found: ' + name); folder = next;
  }
  if (copied.has(folder)) return;
  copied.set(folder, { name, version: metadata.version });
  const relative = path.relative(path.join(projectRoot, 'node_modules'), folder);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Dependency is outside the local package tree: ' + name);
  await fs.cp(folder, path.join(bridge, 'node_modules', relative), { recursive: true, filter: file => !path.relative(folder, file).split(path.sep).includes('node_modules') });
  for (const dependency of Object.keys(metadata.dependencies || {})) await copyDependency(dependency, path.join(folder, 'package.json'));
}
for (const dependency of ['express', 'multer']) await copyDependency(dependency, path.join(projectRoot, 'package.json'));
await fs.writeFile(path.join(bridge, 'BUILD.json'), JSON.stringify({ builtAt: new Date().toISOString(), nodeVersion: process.version, dependencies: [...copied.values()], originalDataIncluded: false, modelsIncluded: false }, null, 2));
console.log(JSON.stringify({ output: root, dependencies: copied.size, node: process.version, source: 'Existing local HEIYAN engine; no user state or model weights copied' }));
