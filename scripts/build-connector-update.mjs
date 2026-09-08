import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const project = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..'));
const version = process.argv[3] || '1.6.0';
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Expected a semantic connector version');
const destination = path.join(project, 'public', 'downloads', 'heiyan-connector-update');
const release = path.join(destination, version);
const sources = [
  ['scripts/portable-main.mjs', 'portable-main.mjs'],
  ['server/agent-connector.js', 'server/agent-connector.js'],
  ['server/agent-contract.js', 'server/agent-contract.js'],
  ['server/codex-runtime.js', 'server/codex-runtime.js'],
  ['scripts/portable/control.js', 'portable/control.js'],
  ['scripts/portable/setup.html', 'portable/setup.html'],
  ['scripts/portable/setup.js', 'portable/setup.js'],
  ['scripts/portable/setup.css', 'portable/setup.css'],
];
await fs.mkdir(release, { recursive: true });
const files = [];
for (const [sourceName, targetName] of sources) {
  const data = await fs.readFile(path.join(project, sourceName));
  const target = path.join(release, targetName);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  files.push({ path: targetName, url: `/downloads/heiyan-connector-update/${version}/${targetName}`, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
}
const manifest = { schema: 1, channel: 'stable', version, minBootstrapVersion: '1.0.0', runtime: { node: '22.23.2', codex: '0.153.4' }, files };
await fs.writeFile(path.join(release, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ version, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }));
