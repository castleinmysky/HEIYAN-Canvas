import 'fake-indexeddb/auto';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalComfyApi, localConnectorUrl } from '../src/local-comfy-api.js';
import { localRecords, handleLocalRequest } from '../src/trial-storage.js';
import { createCloudJobStore } from '../src/cloud/job-store.js';
import { connectorAddress } from '../src/connector-address.js';

const origin = 'https://heiyan.f2vfhjcckr.chatgpt.site';
const code = 'p'.repeat(43);
const localModel = { id: 'local-qwen', adapter: 'comfyui-native-image', capability: 'image', workflows: [{ id: 'qwen', editor: 'native' }] };
beforeEach(async () => { for (const [key] of await localRecords.entries()) await localRecords.remove(key); });
function fixture({ loseResponse = false, baseUrl = localConnectorUrl, serverId = '', accessCode = code } = {}) {
  const remoteJobs = new Map(); const calls = []; let dispatches = 0;
  const baseApi = async request => {
    const path = new URL(request.url).pathname;
    if (path === '/api/v1/models') return Response.json({ models: [{ id: 'cloud', adapter: 'openai-image' }] });
    if (path === '/api/v1/jobs') return Response.json({ jobs: (await localRecords.entries()).filter(([key]) => key.startsWith('cloud:job:')).map(([, value]) => value) });
    return Response.json({ error: 'Not found' }, { status: 404 });
  };
  const nativeFetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(new URL(url).origin, baseUrl);
    assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, 'Bearer ' + accessCode);
    const path = new URL(url).pathname;
    if (path === '/connect') return Response.json({ connected: true, version: serverId ? 2 : 1, serverId, models: [localModel] });
    if (path === '/assets') { assert.ok(options.body instanceof FormData); return Response.json({ url: '/media/assets/uploaded.png' }); }
    if (path.endsWith('/outputs/0')) return new Response('local-image-fixture', { headers: { 'Content-Type': 'image/png' } });
    const id = path.split('/')[2];
    if (path.endsWith('/cancel')) {
      if (!remoteJobs.has(id)) return Response.json({ error: 'missing' }, { status: 404 });
      const job = remoteJobs.get(id);
      if (!['succeeded', 'failed', 'cancelled'].includes(job.status)) job.status = 'cancelled';
      return Response.json({ job });
    }
    if (options.method === 'POST') {
      if (!remoteJobs.has(id)) { dispatches++; remoteJobs.set(id, { id, status: 'running', stage: 'Generating locally', outputs: [], progress: 30 }); }
      if (loseResponse) { loseResponse = false; throw new Error('page closed after acceptance'); }
    }
    if (!remoteJobs.has(id)) return Response.json({ error: 'missing' }, { status: 404 });
    return Response.json({ job: remoteJobs.get(id) });
  };
  const reload = () => createLocalComfyApi({ nativeFetch, origin, baseApi });
  const request = (api, path, method = 'GET', body) => api(new Request(origin + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }));
  const input = { modelId: localModel.id, taskId: 'test-local', canvasId: 'main', nodeId: 'node-1', capability: 'image', prompt: 'fixture', inputs: [], options: {} };
  return { api: reload(), reload, request, input, remoteJobs, calls, nativeFetch, baseApi, changeDestination: (url, id) => { baseUrl = url; serverId = id; }, get dispatches() { return dispatches; } };
}
test('no local calls until pairing; combines real local catalog without altering cloud models', async () => {
  const f = fixture();
  assert.equal((await (await f.request(f.api, '/api/v1/models')).json()).models.length, 1);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request(f.api, '/api/v1/local-connector', 'POST', { code })).status, 200);
  assert.deepEqual((await (await f.request(f.api, '/api/v1/models')).json()).models.map(model => model.id), ['cloud', 'local-qwen']);
  const state = await (await f.request(f.api, '/api/v1/local-connector')).json(); assert.ok(!JSON.stringify(state).includes(code));
  await f.request(f.api, '/api/v1/local-connector', 'DELETE');
  assert.equal((await (await f.request(f.api, '/api/v1/models')).json()).models.length, 1);
});
test('refresh reconnects to the same local task and stores completed bytes in browser history', async () => {
  const f = fixture(); await f.request(f.api, '/api/v1/local-connector', 'POST', { code });
  const created = await (await f.request(f.api, '/api/v1/jobs', 'POST', f.input)).json();
  const route = '/api/v1/jobs/' + created.job.id;
  assert.equal((await (await f.request(f.api, route)).json()).job.status, 'running');
  assert.equal(f.dispatches, 1);
  const refreshed = f.reload();
  assert.equal((await (await f.request(refreshed, route)).json()).job.status, 'running');
  const remote = f.remoteJobs.get(created.job.id);
  remote.status = 'succeeded'; remote.outputs = [{ mediaType: 'image', fileName: 'result.png', mediaUrl: '/jobs/' + created.job.id + '/outputs/0' }];
  const result = (await (await f.request(refreshed, route)).json()).job;
  assert.equal(result.status, 'succeeded'); assert.equal(result.taskId, f.input.taskId); assert.equal(result.canvasId, 'main');
  assert.equal(await (await handleLocalRequest(new Request(origin + result.outputs[0].mediaUrl))).text(), 'local-image-fixture');
  assert.equal(f.dispatches, 1);
  const cloud = createCloudJobStore({ origin, models: {}, fetchImpl: () => { throw new Error('No cloud request expected'); } });
  assert.equal((await (await cloud.handle(new Request(origin + route))).json()).job.status, 'succeeded');
});
test('lost submission response is retried only with the saved idempotency ID and exact payload', async () => {
  const f = fixture({ loseResponse: true }); await f.request(f.api, '/api/v1/local-connector', 'POST', { code });
  const created = await (await f.request(f.api, '/api/v1/jobs', 'POST', f.input)).json();
  const route = '/api/v1/jobs/' + created.job.id;
  await f.request(f.api, route);
  const response = (await (await f.request(f.reload(), route)).json()).job;
  assert.equal(response.status, 'running'); assert.equal(f.dispatches, 1);
  const posts = f.calls.filter(call => call.options.method === 'POST' && call.url.includes('/jobs/'));
  assert.equal(posts.length, 2); assert.equal(posts[0].url, posts[1].url); assert.equal(posts[0].options.body, posts[1].options.body);
});
test('reference uploads go only to this computer, with no cloud API keys', async () => {
  const f = fixture(); await f.request(f.api, '/api/v1/local-connector', 'POST', { code });
  await localRecords.write('asset:fixture.png', { blob: new Blob(['image'], { type: 'image/png' }), name: 'fixture.png' });
  const body = { ...f.input, inputs: [{ type: 'image', port: 'reference', value: '/media/assets/fixture.png' }] };
  const { job } = await (await f.request(f.api, '/api/v1/jobs', 'POST', body)).json();
  await f.request(f.api, '/api/v1/jobs/' + job.id);
  const submitted = JSON.parse(f.calls.find(call => call.url.includes('/jobs/') && call.options.method === 'POST').options.body);
  assert.equal(submitted.inputs[0].value, '/media/assets/uploaded.png');
  assert.equal(f.calls.filter(call => call.url.endsWith('/assets')).length, 1);
  assert.ok(!JSON.stringify(submitted).includes(code));
});
test('cloud interruption recovery never pauses an independently executing local task', async () => {
  const job = { id: 'local_fixture', localBridge: true, status: 'running', updatedAt: '2000-01-01T00:00:00Z', outputs: [] };
  await localRecords.write('cloud:job:' + job.id, job);
  const cloud = createCloudJobStore({ origin, models: {}, fetchImpl: () => { throw new Error('No cloud request expected'); } });
  const response = await cloud.handle(new Request(origin + '/api/v1/jobs'));
  assert.equal((await response.json()).jobs[0].status, 'running');
});

test('remote address requires HTTPS and never puts credentials in URLs', () => {
  assert.equal(connectorAddress('https://remote.example.com/'), 'https://remote.example.com');
  assert.equal(connectorAddress(localConnectorUrl + '/'), localConnectorUrl);
  for (const url of ['http://remote.example.com', 'https://u:p@remote.example.com', 'https://127.0.0.1', 'https://machine.local', 'https://x.example.com/path', 'https://x.example.com?code=secret', 'https://x.example.com/#secret']) assert.throws(() => connectorAddress(url));
});

test('remote generation survives reload and HTTPS address rotation on the same machine without another submission', async () => {
  const baseUrl = 'https://first.trycloudflare.com', serverId = 'machine-11111111111111';
  const f = fixture({ baseUrl, serverId });
  assert.equal((await f.request(f.api, '/api/v1/local-connector', 'POST', { baseUrl, code })).status, 200);
  const { job } = await (await f.request(f.api, '/api/v1/jobs', 'POST', f.input)).json();
  const route = '/api/v1/jobs/' + job.id;
  await f.request(f.api, route); assert.equal(f.dispatches, 1);
  const next = 'https://second.trycloudflare.com'; f.changeDestination(next, serverId);
  const calls = f.calls.length;
  assert.equal((await f.request(f.api, '/api/v1/local-connector', 'POST', { baseUrl: next })).status, 400);
  assert.equal(f.calls.length, calls, 'Never send the saved code to a changed origin implicitly.');
  assert.equal((await f.request(f.api, '/api/v1/local-connector', 'POST', { baseUrl: next, code })).status, 200);
  assert.equal((await (await f.request(f.reload(), route)).json()).job.status, 'running');
  const remote = f.remoteJobs.get(job.id); remote.status = 'succeeded'; remote.outputs = [{ mediaType: 'image', fileName: 'remote.png' }];
  const result = (await (await f.request(f.api, route)).json()).job;
  assert.equal(result.status, 'succeeded'); assert.equal(f.dispatches, 1);
  assert.equal(await (await handleLocalRequest(new Request(origin + result.outputs[0].mediaUrl))).text(), 'local-image-fixture');
  assert.ok(!JSON.stringify(await (await f.request(f.api, '/api/v1/local-connector')).json()).includes(code));
});

test('an active task cannot be rebound to a different machine and pairing failure preserves prior credentials', async () => {
  const baseUrl = 'https://first.trycloudflare.com', serverId = 'machine-11111111111111';
  const f = fixture({ baseUrl, serverId });
  await f.request(f.api, '/api/v1/local-connector', 'POST', { baseUrl, code });
  const { job } = await (await f.request(f.api, '/api/v1/jobs', 'POST', f.input)).json();
  await f.request(f.api, '/api/v1/jobs/' + job.id);
  f.changeDestination('https://wrong.trycloudflare.com', 'machine-22222222222222');
  assert.equal((await f.request(f.api, '/api/v1/local-connector', 'POST', { baseUrl: 'https://wrong.trycloudflare.com', code })).status, 409);
  const saved = await localRecords.read('local-comfy:connection'); assert.equal(saved.baseUrl, baseUrl); assert.equal(saved.serverId, serverId);
  f.changeDestination(baseUrl, serverId);
  assert.equal((await (await f.request(f.reload(), '/api/v1/jobs/' + job.id)).json()).job.status, 'running');
  assert.equal(f.dispatches, 1);
});

test('explicit switch cancels originals without resubmission and frees the same node', async () => {
  const aUrl = 'https://old.trycloudflare.com', bUrl = 'https://new.trycloudflare.com';
  const a = fixture({ baseUrl: aUrl, serverId: 'machine-11111111111111' });
  const bCode = 'q'.repeat(43);
  const b = fixture({ baseUrl: bUrl, serverId: 'machine-22222222222222', accessCode: bCode });
  const reload = () => createLocalComfyApi({ origin, baseApi: a.baseApi, nativeFetch: (url, options) => new URL(url).origin === aUrl ? a.nativeFetch(url, options) : b.nativeFetch(url, options) });
  const api = reload();
  await a.request(api, '/api/v1/local-connector', 'POST', { baseUrl: aUrl, code });
  const { job } = await (await a.request(api, '/api/v1/jobs', 'POST', a.input)).json();
  const route = '/api/v1/jobs/' + job.id;
  await a.request(api, route);
  const body = { baseUrl: bUrl, code: bCode };
  const rejected = await a.request(api, '/api/v1/local-connector', 'POST', body);
  assert.equal((await rejected.json()).code, 'tasks_bound_to_original');
  assert.equal((await a.request(api, '/api/v1/local-connector', 'POST', { ...body, keepOriginalTasks: true })).status, 409, 'Obsolete confirmation cannot bypass cancellation.');
  const result = await a.request(api, '/api/v1/local-connector', 'POST', { ...body, cancelOriginalTasks: true });
  assert.equal(result.status, 200); assert.equal((await result.json()).cancelledTaskCount, 1);
  assert.equal((await (await a.request(reload(), route)).json()).job.status, 'cancelled');
  const created = await a.request(api, '/api/v1/jobs', 'POST', a.input);
  assert.equal(created.status, 202);
  await a.request(api, '/api/v1/jobs/' + (await created.json()).job.id);
  assert.equal(a.dispatches, 1); assert.equal(b.dispatches, 1);
  assert.ok(!b.calls.some(call => call.url.includes(job.id)));
});

test('confirming a switch never skips the concurrent-tab revision check', async () => {
  const f = fixture({ serverId: 'machine-11111111111111' });
  await f.request(f.api, '/api/v1/local-connector', 'POST', { code });
  const api = createLocalComfyApi({ origin, baseApi: f.baseApi, nativeFetch: async (url, options) => {
    const response = await f.nativeFetch(url, options);
    const saved = await localRecords.read('local-comfy:connection');
    await localRecords.write('local-comfy:connection', { ...saved, revision: 'other-tab', enabled: false });
    return response;
  } });
  const response = await f.request(api, '/api/v1/local-connector', 'POST', { code, cancelOriginalTasks: true });
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'connection_changed');
  assert.equal((await localRecords.read('local-comfy:connection')).enabled, false);
});

test('invalid connector and upstream rejection have distinct actionable error codes', async () => {
  const f = fixture();
  for (const [response, expected] of [
    [Response.json({ version: 3, models: [] }), 'connector_update_required'],
    [Response.json({ error: 'This port belongs to another ComfyUI installation.' }, { status: 409 }), 'connector_rejected'],
  ]) {
    const api = createLocalComfyApi({ origin, baseApi: f.baseApi, nativeFetch: async () => response });
    const result = await f.request(api, '/api/v1/local-connector', 'POST', { code });
    assert.equal(result.status, 409); assert.equal((await result.json()).code, expected);
    assert.equal(await localRecords.read('local-comfy:connection'), undefined);
  }
});

test('unreachable legacy tasks require explicit local-stop confirmation and never rebind', async () => {
  const f = fixture({ serverId: 'machine-22222222222222' });
  await localRecords.write('local-comfy:connection', { token: 'z'.repeat(43), baseUrl: localConnectorUrl, enabled: true });
  const id = 'local_' + crypto.randomUUID();
  const job = { id, localBridge: true, status: 'running', bridgeAcknowledged: true };
  await localRecords.write('cloud:job:' + id, job);
  const blocked = await f.request(f.api, '/api/v1/local-connector', 'POST', { code });
  assert.equal((await blocked.json()).code, 'tasks_bound_to_original');
  const uncertain = await f.request(f.api, '/api/v1/local-connector', 'POST', { code, cancelOriginalTasks: true });
  assert.equal(uncertain.status, 409); assert.equal((await uncertain.json()).code, 'cancellation_unconfirmed');
  assert.equal((await f.request(f.api, '/api/v1/local-connector', 'POST', { code, cancelOriginalTasks: true, stopWaitingIfUnavailable: true })).status, 200);
  const ended = await localRecords.read('cloud:job:' + id);
  assert.equal(ended.status, 'cancelled'); assert.equal(ended.bridgeCancellationUnconfirmed, true);
  assert.equal(ended.bridgeServerId, undefined);
  await f.request(f.reload(), '/api/v1/jobs/' + id);
  assert.ok(f.calls.filter(call => call.url.includes('/jobs/')).every(call => call.url.endsWith('/cancel') && call.options.headers.Authorization !== 'Bearer ' + code));
});

test('cancelling a never-submitted orphan only calls cancel and never starts generation', async () => {
  const f = fixture(); await f.request(f.api, '/api/v1/local-connector', 'POST', { code });
  const job = { id: 'local_8404c331-9751-4fdb-b3e9-c1880e81e34a', localBridge: true, status: 'queued', bridgeServerId: 'local-loopback-v1', ...f.input };
  await localRecords.write('cloud:job:' + job.id, job);
  const route = '/api/v1/jobs/' + job.id;
  const cancelled = (await (await f.request(f.api, route + '/cancel', 'POST')).json()).job;
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.bridgeCancellationUnconfirmed, false);
  await f.request(f.reload(), route);
  assert.equal(f.dispatches, 0);
  assert.deepEqual(f.calls.filter(call => call.url.includes('/jobs/')).map(call => new URL(call.url).pathname), ['/jobs/' + job.id + '/cancel']);
});

test('cancellation keeps a result which completed before the cancel request', async () => {
  const f = fixture(); await f.request(f.api, '/api/v1/local-connector', 'POST', { code });
  const { job } = await (await f.request(f.api, '/api/v1/jobs', 'POST', f.input)).json();
  const route = '/api/v1/jobs/' + job.id; await f.request(f.api, route);
  Object.assign(f.remoteJobs.get(job.id), { status: 'succeeded', outputs: [{ mediaType: 'image', fileName: 'done.png' }] });
  const result = (await (await f.request(f.api, route + '/cancel', 'POST')).json()).job;
  assert.equal(result.status, 'succeeded'); assert.equal(result.outputs.length, 1);
  assert.equal(await (await handleLocalRequest(new Request(origin + result.outputs[0].mediaUrl))).text(), 'local-image-fixture');
  assert.equal(f.dispatches, 1);
});

test('an ambiguous submission requires explicit local-stop and stays stopped after reload', async () => {
  const f = fixture(); await f.request(f.api, '/api/v1/local-connector', 'POST', { code });
  const job = { id: 'local_' + crypto.randomUUID(), localBridge: true, status: 'queued', bridgeServerId: 'local-loopback-v1', bridgePayload: f.input, ...f.input };
  await localRecords.write('cloud:job:' + job.id, job);
  const route = '/api/v1/jobs/' + job.id;
  const unknown = (await (await f.request(f.api, route + '/cancel', 'POST')).json()).job;
  assert.equal(unknown.status, 'cancelling'); assert.equal(unknown.bridgeCancellationUnconfirmed, true);
  const ended = (await (await f.request(f.api, route + '/cancel', 'POST', { stopWaitingIfUnavailable: true })).json()).job;
  assert.equal(ended.status, 'cancelled'); assert.equal(ended.bridgeCancellationUnconfirmed, true);
  await f.request(f.reload(), route); assert.equal(f.dispatches, 0);
});

test('a late submission response cannot resurrect a task after cancellation begins', async () => {
  const f = fixture(); await f.request(f.api, '/api/v1/local-connector', 'POST', { code });
  let release, started;
  const submissionStarted = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const api = createLocalComfyApi({ origin, baseApi: f.baseApi, nativeFetch: async (url, options) => {
    const response = await f.nativeFetch(url, options);
    if (options.method === 'POST' && /\/jobs\/local_[^/]+$/.test(url)) { started(); await held; }
    return response;
  } });
  const { job } = await (await f.request(api, '/api/v1/jobs', 'POST', f.input)).json();
  const route = '/api/v1/jobs/' + job.id;
  await submissionStarted;
  const cancelling = f.request(api, route + '/cancel', 'POST');
  while (!(await localRecords.read('cloud:job:' + job.id)).bridgeCancelRequested) await new Promise(resolve => setImmediate(resolve));
  release();
  assert.equal((await (await cancelling).json()).job.status, 'cancelled');
  assert.equal((await (await f.request(f.reload(), route)).json()).job.status, 'cancelled');
  assert.equal(f.dispatches, 1);
});

test('a failed candidate connection cannot cancel existing work', async () => {
  const f = fixture({ serverId: 'machine-11111111111111' });
  await f.request(f.api, '/api/v1/local-connector', 'POST', { code });
  const { job } = await (await f.request(f.api, '/api/v1/jobs', 'POST', f.input)).json();
  await f.request(f.api, '/api/v1/jobs/' + job.id);
  const api = createLocalComfyApi({ origin, baseApi: f.baseApi, nativeFetch: async () => Response.json({ error: 'Invalid access code' }, { status: 401 }) });
  assert.equal((await f.request(api, '/api/v1/local-connector', 'POST', { baseUrl: 'https://bad.trycloudflare.com', code, cancelOriginalTasks: true })).status, 401);
  assert.equal((await localRecords.read('cloud:job:' + job.id)).status, 'running');
  assert.equal(f.calls.some(call => call.url.endsWith('/cancel')), false);
});

test('cross-tab cancellation waits for the shared submission lock and prevents resurrection', async () => {
  const f = fixture();
  const tails = new Map();
  const locks = { request(name, work) { const tail = (tails.get(name) || Promise.resolve()).then(work); tails.set(name, tail.catch(() => {})); return tail; } };
  let started, release;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const nativeFetch = async (url, options) => {
    const response = await f.nativeFetch(url, options);
    if (options.method === 'POST' && /\/jobs\/local_[^/]+$/.test(url)) { started(); await held; }
    return response;
  };
  const makeTab = () => createLocalComfyApi({ origin, baseApi: f.baseApi, nativeFetch, locks });
  const tabA = makeTab(), tabB = makeTab();
  await f.request(tabA, '/api/v1/local-connector', 'POST', { code });
  const { job } = await (await f.request(tabA, '/api/v1/jobs', 'POST', f.input)).json();
  const route = '/api/v1/jobs/' + job.id;
  await startedPromise;
  const cancellation = f.request(tabB, route + '/cancel', 'POST');
  while (!(await localRecords.read('cloud:job:' + job.id)).bridgeCancelRequested) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.some(call => call.url.endsWith('/cancel')), false);
  release();
  assert.equal((await (await cancellation).json()).job.status, 'cancelled');
  assert.equal((await (await f.request(makeTab(), route)).json()).job.status, 'cancelled');
  assert.equal(f.dispatches, 1);
});
