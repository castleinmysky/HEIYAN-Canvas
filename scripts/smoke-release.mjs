// Starts only this checkout on a free loopback port. No provider or Codex calls.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probe = net.createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, HEIYAN_HOST: '127.0.0.1', HEIYAN_PORT: String(port), HEIYAN_ORIGIN: '', HEIYAN_ACCESS_PASSWORD: '', HEIYAN_MODEL_HOSTS: '' },
});
const stopped = once(child, 'exit');
let ready = false;
child.stdout.on('data', data => { if (data.toString().includes('HEIYAN')) ready = true; });
child.stderr.on('data', () => {});
const base = `http://127.0.0.1:${port}`;
try {
  for (let count = 0; count < 100 && !ready; count++) {
    if (child.exitCode !== null) throw Error('The release server exited before startup');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'server startup timed out');
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /黑岩 HEIYAN 画布/);
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)) assert.equal((await fetch(base + match[1])).status, 200);
  assert.equal((await fetch(base + '/studio?task_id=release-smoke')).status, 200);
  assert.deepEqual(await (await fetch(base + '/api/cloud/status')).json(), { cloudApi: true, storage: 'browser-local', localCapabilities: false });
  assert.equal((await fetch(base + '/.env')).status, 404);
  assert.equal((await fetch(base + '/.git/config')).status, 404);
  console.log('Clean release smoke passed: actual server, built assets, SPA route, cloud status and private-file boundary. Generation calls: 0.');
  if (process.argv.includes('--inspect')) {
    console.log(`Inspection server: ${base}`);
    await new Promise(resolve => process.once('SIGINT', resolve));
  }
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await stopped;
}
