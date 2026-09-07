import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createGateway, siteOrigin } from '../local-bridge/gateway.mjs';

test('loopback gateway rejects unpaired origins and host spoofing; submits exactly once and scopes returned media', async t => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heiyan-gateway-test-'));
  const token = 't'.repeat(43); let submissions = 0; const jobs = new Map();
  const fetchImpl = async (url, options = {}) => {
    const route = new URL(url).pathname;
    if (route === '/api/v1/models') return Response.json({ models: [{ id: 'comfy', adapter: 'comfyui-native-image', enabled: true }, { id: 'cloud', adapter: 'openai-image' }] });
    if (route === '/api/v1/admin/models') return Response.json({ models: [{ id: 'comfy', adapter: 'comfyui-native-image', enabled: false }] });
    if (route === '/api/v1/comfyui/connect') { assert.equal(JSON.parse(options.body).baseUrl, 'http://127.0.0.1:8288'); return Response.json({ connected: true }); }
    if (route === '/api/v1/jobs' && options.method === 'POST') {
      submissions++; const body = JSON.parse(options.body); const job = { ...body, id: 'remote-1', status: 'succeeded', outputs: [{ mediaType: 'image', mediaUrl: '/media/outputs/generated.png', fileName: 'result.png' }] }; jobs.set(job.id, job); return Response.json({ job });
    }
    if (route === '/api/v1/jobs/remote-1') return Response.json({ job: jobs.get('remote-1') });
    if (route === '/media/outputs/generated.png') return new Response('fixture-image', { headers: { 'Content-Type': 'image/png' } });
    throw new Error('Unexpected upstream route: ' + route);
  };
  const gateway = createGateway({ token, stateDir, upstream: 'http://127.0.0.1:9991', fetchImpl, port: 0 });
  const address = await gateway.listen();
  t.after(async () => { await new Promise(resolve => gateway.server.close(resolve)); await fs.rm(stateDir, { recursive: true }); });
  const base = 'http://127.0.0.1:' + address.port;
  const request = (route, options = {}) => fetch(base + route, { ...options, headers: { Authorization: 'Bearer ' + token, Origin: siteOrigin, ...options.headers } });
  assert.equal((await fetch(base + '/status')).status, 401);
  assert.equal((await request('/status', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const spoofedStatus = await new Promise((resolve, reject) => { const req = http.request(base + '/status', { headers: { Host: 'evil.example:' + address.port, Authorization: 'Bearer ' + token } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', error => error.code === 'ECONNRESET' ? resolve('connection-denied') : reject(error)); req.end(); });
  assert.ok([403, 'connection-denied'].includes(spoofedStatus));
  assert.equal((await request('/api/v1/admin/data/generated-results', { method: 'DELETE' })).status, 404);
  assert.equal((await request('/', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 404);
  const preflight = await request('/connect', { method: 'OPTIONS' });
  assert.equal(preflight.headers.get('access-control-allow-origin'), siteOrigin);
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
  const connected = await (await request('/connect', { method: 'POST' })).json();
  assert.deepEqual(connected.models.map(model => model.id), ['comfy']);
  assert.ok(!JSON.stringify(connected).includes(token));
  const id = 'local_11111111-1111-4111-a111-111111111111';
  const payload = { modelId: 'comfy', nodeId: 'node', prompt: 'test', inputs: [], capability: 'image' };
  const submit = value => request('/jobs/' + id, { method: 'POST', body: JSON.stringify(value) });
  assert.equal((await submit(payload)).status, 202);
  assert.equal((await submit(payload)).status, 202);
  assert.equal(submissions, 1);
  assert.equal((await submit({ ...payload, prompt: 'changed' })).status, 409);
  const loaded = await (await request('/jobs/' + id)).json();
  assert.equal(loaded.job.status, 'succeeded');
  assert.equal(loaded.job.outputs[0].mediaUrl, '/jobs/' + id + '/outputs/0');
  assert.equal(await (await request(loaded.job.outputs[0].mediaUrl)).text(), 'fixture-image');
  assert.equal((await request('/jobs/' + id + '/outputs/99')).status, 404);
  assert.equal(submissions, 1);
});
