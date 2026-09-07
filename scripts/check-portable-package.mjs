// Offline acceptance: no login, no model turns, no user canvas mutations.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Pass an extracted portable package directory');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'heiyan-portable-qa-'));
const env = { ...process.env, LOCALAPPDATA: scratch, CODEX_HOME: path.join(scratch, 'empty-codex'), PATH: process.env.SystemRoot + '\\System32' };
const node = path.join(root, 'runtime/node/node.exe'), entry = path.join(root, 'scripts/portable-launcher.mjs');
const id = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 20);
const stateFile = path.join(scratch, 'HEIYAN/AgentConnector', id, 'instance.json');
const run = args => { const result = spawnSync(node, [entry, ...args], { cwd: root, env, encoding: 'utf8', timeout: 30000, windowsHide: true }); assert.equal(result.status, 0, result.stderr || result.error?.message); return result; };
let stopped = false;
try {
  run(['check']);
  run(['start', '--no-open']);
  const first = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  run(['start', '--no-open']);
  assert.equal(JSON.parse(await fs.readFile(stateFile, 'utf8')).pid, first.pid, 'second start must reuse process');
  const base = `http://127.0.0.1:${first.port}`;
  const call = async (route, origin = base, secret = first.secret) => {
    const response = await fetch(base + route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret }, body: '{}' });
    return { status: response.status, body: await response.json() };
  };
  const state = await call('/local/status'); assert.equal(state.status, 200); assert.equal(state.body.loggedIn, false); assert.equal(state.body.paired, false);
  assert.equal((await call('/local/connect')).status, 400);
  assert.equal((await call('/local/stop', 'https://evil.test')).status, 403);
  assert.equal((await call('/local/login', base, 'wrong')).status, 403);
  const page = await fetch(base + '/setup'); assert.equal(page.status, 200); assert.ok((await page.text()).includes('连接你的创作助手'));
  const badHost = await new Promise(resolve => { const req = http.get(base + '/setup', { headers: { Host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode); }); req.on('error', () => resolve(0)); }); assert.equal(badHost, 403);
  run(['stop']); stopped = true;
  await new Promise(resolve => setTimeout(resolve, 350));
  await assert.rejects(fs.readFile(stateFile));
  console.log('Portable QA passed: bundled runtime, no system Node/Codex PATH, clean login state, idempotent start, local authorization, owned stop. Model turns: 0.');
} finally {
  if (!stopped) { try { run(['stop']); } catch { /* never kill an unknown PID */ } }
}
