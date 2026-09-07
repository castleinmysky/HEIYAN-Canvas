import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { createCloudJobStore } from '../src/cloud/job-store.js';
import { localRecords, handleLocalRequest } from '../src/trial-storage.js';
import { createTrialRequestBridge } from '../src/trial-request-bridge.js';

const origin = 'https://trial.example';
const model = { id: 'test-image', adapter: 'openai-image', capability: 'image', config: { apiKey: 'fixture-secret', baseUrl: 'https://relay.vendor.com', endpoint: '/v1/images/generations', model: 'image-model' } };
const models = { runtimeModel: async () => model };
const call = (runtime, path, method = 'GET', body) => runtime.handle(new Request(origin + path, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }));
const input = () => ({ modelId: model.id, taskId: 'task-' + crypto.randomUUID(), canvasId: 'main', nodeId: 'node-a', prompt: 'fixture prompt', capability: 'image', inputs: [], options: { ratio: '1:1', resolution: '1K', count: 1 } });

test('generation persists real adapter bytes, results and history after a new runtime', async () => {
  let requests = 0;
  const runtime = createCloudJobStore({ models, origin, fetchImpl: async () => { requests += 1; return Response.json({ data: [{ b64_json: Buffer.from('real-fixture-result').toString('base64') }] }); } });
  const body = input();
  const created = await (await call(runtime, '/api/v1/jobs', 'POST', body)).json();
  await runtime.waitForIdle();
  const result = await (await call(runtime, `/api/v1/jobs/${created.job.id}`)).json();
  assert.equal(result.job.status, 'succeeded', result.job.error);
  assert.equal(result.job.outputs.length, 1); assert.equal(requests, 1);
  assert.match(result.job.outputs[0].mediaUrl, /^\/media\/assets\//);
  assert.equal(await (await handleLocalRequest(new Request(origin + result.job.outputs[0].mediaUrl))).text(), 'real-fixture-result');
  const reloaded = createCloudJobStore({ models, origin, fetchImpl: async () => { throw new Error('Must not resubmit'); } });
  const jobs = await (await call(reloaded, '/api/v1/jobs?taskId=' + body.taskId)).json();
  assert.equal(jobs.jobs[0].status, 'succeeded');
  assert.doesNotMatch(JSON.stringify(jobs), /fixture-secret/);
});

test('network failure is not retried or turned into a fake result', async () => {
  let calls = 0;
  const runtime = createCloudJobStore({ models, origin, fetchImpl: async () => { calls += 1; throw new Error('fixture-secret rejected'); } });
  const created = await (await call(runtime, '/api/v1/jobs', 'POST', input())).json();
  await runtime.waitForIdle();
  const result = await (await call(runtime, `/api/v1/jobs/${created.job.id}`)).json();
  assert.equal(result.job.status, 'paused'); assert.equal(result.job.submissionUnknown, true);
  assert.deepEqual(result.job.outputs, []); assert.equal(calls, 1);
  assert.doesNotMatch(result.job.error, /fixture-secret/);
  assert.equal((await call(runtime, `/api/v1/jobs/${created.job.id}/resume`, 'POST', {})).status, 409);
  assert.equal((await call(runtime, `/api/v1/jobs/${created.job.id}/retry`, 'POST', {})).status, 409);
  assert.equal(calls, 1);
});

test('concurrent create requests cannot duplicate a node task', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const runtime = createCloudJobStore({ models, origin, fetchImpl: async () => { await gate; return Response.json({ data: [{ b64_json: Buffer.from('done').toString('base64') }] }); } });
  const body = input();
  const responses = await Promise.all([call(runtime, '/api/v1/jobs', 'POST', body), call(runtime, '/api/v1/jobs', 'POST', body)]);
  assert.deepEqual(responses.map(item => item.status).sort(), [202, 409]);
  release(); await runtime.waitForIdle();
});

test('download retrieval can resume from persisted output URLs without regeneration', async () => {
  const body = input(); const id = 'job_' + crypto.randomUUID();
  await localRecords.write('cloud:job:' + id, { ...body, id, modelBinding: JSON.stringify([model.adapter, model.config.baseUrl, model.config.endpoint, model.config.model]), status: 'paused', outputs: [], pendingOutputs: [{ mediaType: 'image', mediaUrl: 'https://cdn.vendor.com/finished.png', fileName: 'finished.png' }] });
  let gets = 0;
  const runtime = createCloudJobStore({ models, origin, fetchImpl: async () => { gets += 1; return new Response('downloaded', { headers: { 'content-type': 'image/png' } }); }, providers: { get() { throw new Error('Must not generate'); } } });
  assert.equal((await call(runtime, `/api/v1/jobs/${id}/resume`, 'POST', {})).status, 202);
  await runtime.waitForIdle();
  assert.equal((await (await call(runtime, `/api/v1/jobs/${id}`)).json()).job.status, 'succeeded');
  assert.equal(gets, 1);
});
