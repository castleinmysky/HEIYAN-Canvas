import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteGateway } from '../local-bridge/remote-gateway.mjs';
import { quickTunnelArgs } from '../local-bridge/quick-tunnel.mjs';
import { siteOrigin } from '../local-bridge/gateway.mjs';

test('remote boundary rejects public pairing/admin access and only forwards authenticated scoped operations', async t => {
  const token = 'r'.repeat(43), localToken = 'l'.repeat(43), calls = [];
  const gateway = createRemoteGateway({ token, localToken, upstream: 'http://127.0.0.1:8289', port: 0, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.Authorization, 'Bearer ' + localToken);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Cookie, undefined);
    if (url.endsWith('/outputs/0')) return new Response('image', { status: 206, headers: { 'Content-Type': 'image/png', 'Content-Range': 'bytes 0-4/5' } });
    return Response.json({ version: 2, serverId: 'machine-11111111111111', models: [] });
  } });
  const address = await gateway.listen();
  t.after(() => new Promise(resolve => { gateway.server.closeAllConnections(); gateway.server.close(resolve); }));
  const base = 'http://127.0.0.1:' + address.port;
  const request = (route, options = {}) => fetch(base + route, { ...options, headers: { Origin: siteOrigin, Authorization: 'Bearer ' + token, ...options.headers } });
  for (const route of ['/', '/api/v1/admin/models', '/prompt', '/system_stats', '/jobs', '/assets?token=' + token, '/connect?x=1']) {
    const response = await request(route); assert.equal(response.status, 404); assert.ok(!(await response.text()).includes(token));
  }
  assert.equal((await fetch(base + '/status')).status, 401);
  assert.equal((await request('/status', { headers: { Authorization: 'Bearer ' + localToken } })).status, 401);
  assert.equal((await request('/status', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal(calls.length, 0);
  const preflight = await request('/connect', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), siteOrigin);
  const connected = await request('/connect', { method: 'POST', body: '{}' }); assert.equal(connected.status, 200);
  assert.equal(calls[0].url, 'http://127.0.0.1:8289/connect'); assert.equal(calls[0].options.body.toString(), '{}');
  const form = new FormData(); form.append('file', new Blob(['fixture']), 'reference.png');
  assert.equal((await request('/assets', { method: 'POST', body: form })).status, 200);
  assert.ok(calls[1].options.body.toString().includes('reference.png'));
  const result = await request('/jobs/local_11111111-1111-4111-a111-111111111111/outputs/0', { headers: { Range: 'bytes=0-4' } });
  assert.equal(result.status, 206); assert.equal(result.headers.get('content-range'), 'bytes 0-4/5'); assert.equal(await result.text(), 'image');
  assert.equal(calls[2].options.headers.Range, 'bytes=0-4');
  assert.equal(gateway.server.address().address, '127.0.0.1');
});

test('remote boundary cannot use the local pairing code or an external upstream', () => {
  assert.throws(() => createRemoteGateway({ token: 'x'.repeat(43), localToken: 'x'.repeat(43), upstream: 'http://127.0.0.1:8289' }));
  assert.throws(() => createRemoteGateway({ token: 'r'.repeat(43), localToken: 'l'.repeat(43), upstream: 'https://example.com' }));
});

test('tunnel targets the isolated remote listener, uses its explicit host, and carries no secrets', () => {
  const args = quickTunnelArgs(8291);
  assert.ok(args.includes('http://127.0.0.1:8291')); assert.ok(args.includes('127.0.0.1:8291'));
  assert.ok(!args.join(' ').includes('8289')); assert.ok(!args.join(' ').includes('8288'));
  assert.ok(!args.includes('--no-tls-verify')); assert.throws(() => quickTunnelArgs(0));
});
