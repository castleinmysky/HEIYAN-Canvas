import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentConnector } from '../server/agent-connector.js';
import { createLocalControl, canvasSite, pairingLink } from '../scripts/portable/control.js';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';

const site = 'https://heiyan.example';
test('portable control requires local Origin and secret; website cannot sign in or stop it', async t => {
  let loggedIn = false, loginCalls = 0, stopCalls = 0;
  class Runtime extends EventEmitter { constructor() { super(); this.ready = Promise.resolve({ type: 'chatgpt' }); } models() { return Promise.resolve([]); } close() {} }
  const connector = createAgentConnector({ origin: site, runtimeFactory: () => new Runtime(), localHandler: createLocalControl({ secret: 'local-secret', packageId: 'package-a', siteUrl: site,
    probe: async () => ({ loggedIn }), login: async () => { loginCalls++; loggedIn = true; }, stop: () => { stopCalls++; } }),
  });
  await new Promise(resolve => connector.server.listen(0, '127.0.0.1', resolve)); t.after(() => connector.close());
  const base = 'http://127.0.0.1:' + connector.server.address().port;
  const call = async (route, headers = {}, body = '{}') => { const response = await fetch(base + route, { method: 'POST', headers: { Origin: base, Authorization: 'Bearer local-secret', 'Content-Type': 'application/json', ...headers }, body }); return { status: response.status, body: await response.json() }; };
  for (const route of ['/local/status','/local/login','/local/connect','/local/stop']) {
    assert.equal((await call(route, { Origin: site })).status, 403);
    assert.equal((await call(route, { Authorization: 'Bearer wrong' })).status, 403);
    assert.equal((await call(route, { Origin: 'http://evil.example' })).status, 403);
  }
  assert.equal(loginCalls, 0); assert.equal(stopCalls, 0);
  assert.equal((await call('/local/connect')).status, 400);
  const html = await (await fetch(base + '/setup')).text(); assert.ok(!html.includes('local-secret'));
  assert.equal((await call('/local/status')).body.loggedIn, false);
  assert.equal((await call('/local/login')).status, 200); assert.equal(loginCalls, 1);
  const first = (await call('/local/connect')).body.url; const second = (await call('/local/connect')).body.url;
  assert.notEqual(first, second);
  const code = link => new URLSearchParams(new URL(link).hash.slice('#heiyan-pair='.length)).get('code');
  assert.equal((await call('/pair', { Origin: site }, JSON.stringify({ code: code(first) }))).status, 401);
  assert.equal((await call('/pair', { Origin: site }, JSON.stringify({ code: code(second) }))).status, 200);
  assert.equal((await call('/local/connect')).status, 409, 'cannot replace an already paired canvas');
  assert.equal((await call('/local/login')).status, 400);
  assert.equal(loginCalls, 1);
  assert.equal((await call('/local/stop')).status, 200);
  await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(stopCalls, 1);
});
test('portable links use fragments, local connector only; site configuration excludes unsafe schemes', () => {
  const url = new URL(pairingLink(site, 'http://127.0.0.1:17372', 'a'.repeat(32)));
  assert.equal(url.search, '?view=agent'); assert.ok(!url.search.includes('code')); assert.ok(url.hash.includes('code='));
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'http://example.com', 'https://name:pass@example.com', 'https://example.com/#secret']) assert.throws(() => canvasSite(value));
  assert.equal(canvasSite('http://localhost:8792').origin, 'http://localhost:8792');
});
test('launcher uses packaged binaries, owned authenticated stop and no process-wide termination or autostart', async () => {
  const launcher = await readFile(new URL('../scripts/portable-launcher.mjs', import.meta.url), 'utf8');
  assert.match(launcher, /runtime', 'codex', 'bin', 'codex.exe/);
  assert.match(launcher, /windowsHide: true/); const application = await readFile(new URL('../scripts/portable-main.mjs', import.meta.url), 'utf8');
  assert.match(launcher, /application.runPortable/); assert.match(application, /management\(instance, 'stop'\)/);
  assert.doesNotMatch(launcher, /taskkill|Stop-Process|setx|schtasks|auth\.json|account\/logout|turn\/start|CODEX_HOME\s*=/);
  const cmd = await readFile(new URL('../scripts/portable/start.cmd', import.meta.url), 'utf8');
  assert.match(cmd, /runtime\\node\\node.exe/); assert.doesNotMatch(cmd, /npm|winget|setx|ExecutionPolicy/);
});
