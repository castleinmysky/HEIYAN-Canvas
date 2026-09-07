import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { createCloudProviders } from '../src/cloud/providers.js';

test('OpenAI text generation and edits use configured relay, model and binary output', async () => {
  const seen = [];
  const providers = createCloudProviders(async (url, init) => {
    seen.push(String(url));
    assert.equal(init.headers.Authorization, 'Bearer fixture');
    const model = init.body instanceof FormData ? init.body.get('model') : JSON.parse(init.body).model;
    assert.equal(model, 'chosen-image-model');
    return Response.json({ data: [{ b64_json: Buffer.from('result-pixels').toString('base64') }] });
  });
  const adapter = providers.get({ adapter: 'openai-image', config: { baseUrl: 'https://relay.vendor.com', endpoint: '/v1/images/generations', model: 'chosen-image-model', apiKey: 'fixture' } });
  assert.equal((await adapter.run({ prompt: 'test', count: 1 }))[0].buffer.toString(), 'result-pixels');
  await adapter.run({ prompt: 'edit', referenceImages: [{ buffer: Buffer.from('ref'), mimeType: 'image/png' }] });
  assert.deepEqual(seen, ['https://relay.vendor.com/v1/images/generations', 'https://relay.vendor.com/v1/images/edits']);
});
test('Gemini preserves referenced image content and custom model path', async () => {
  const providers = createCloudProviders(async (url, init) => {
    assert.equal(url, 'https://relay.vendor.com/v1beta/models/my-gemini:generateContent');
    assert.equal(init.headers['x-goog-api-key'], 'fixture');
    const body = JSON.parse(init.body);
    assert.equal(body.contents[0].parts[1].inlineData.data, Buffer.from('ref').toString('base64'));
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('result').toString('base64'), mimeType: 'image/png' } }] } }] });
  });
  const adapter = providers.get({ adapter: 'gemini-image', config: { baseUrl: 'https://relay.vendor.com', model: 'my-gemini', apiKey: 'fixture' } });
  assert.equal((await adapter.run({ prompt: 'test', referenceImages: [{ buffer: Buffer.from('ref'), mimeType: 'image/png' }] }))[0].buffer.toString(), 'result');
});
test('Seedance resume queries existing remote task without a new paid POST', async () => {
  const requests = [];
  const providers = createCloudProviders(async (url, init) => {
    requests.push([url, init.method || 'GET']);
    return Response.json({ status: 'succeeded', content: { video_url: 'https://cdn.vendor.com/result.mp4' } });
  });
  const adapter = providers.get({ adapter: 'seedance-video', config: { baseUrl: 'https://relay.vendor.com', model: 'seedance', apiKey: 'fixture' } });
  const result = await adapter.run({ remoteTaskId: 'existing-id', prompt: 'test', inputs: [], options: {}, waitForCallback: async () => {} });
  assert.equal(result.outputs[0].mediaType, 'video');
  assert.deepEqual(requests, [['https://relay.vendor.com/contents/generations/tasks/existing-id', 'GET']]);
});
test('local-only models have no online adapter', () => {
  const providers = createCloudProviders(() => { throw new Error('Must not fetch'); });
  for (const adapter of ['comfyui-native-image', 'gpt-sovits-audio']) assert.throws(() => providers.get({ adapter, config: {} }), /local/);
});

test('MiniMax resume queries the saved task without posting another generation', async () => {
  const calls = [];
  const providers = createCloudProviders(async (url, init) => {
    calls.push([url, init.method || 'GET']);
    return Response.json({ status: 'succeeded', content: { url: 'https://cdn.vendor.com/video.mp4' } });
  });
  const adapter = providers.get({ adapter: 'minimax-h3-video', config: { apiKey: 'fixture', baseUrl: 'https://relay.vendor.com', model: 'MiniMax-H3', pollIntervalMs: 1 } });
  const result = await adapter.run({ remoteTaskId: 'existing', prompt: 'test', inputs: [], options: {} });
  assert.equal(result.outputs[0].mediaType, 'video');
  assert.deepEqual(calls, [['https://relay.vendor.com/v2/query/video_generation/existing', 'GET']]);
});

test('Tripo uses the browser-injected client, persists task ID before polling, and resumes query-only', async () => {
  const calls = []; let persisted = false;
  const providers = createCloudProviders(async (url, init) => {
    calls.push([url, init.method]);
    if (init.method === 'POST') return Response.json({ code: 0, data: { task_id: 'tripo-task' } });
    assert.equal(persisted, true);
    return Response.json({ code: 0, data: { status: 'success', task_id: 'tripo-task', output: { model_url: 'https://cdn.vendor.com/model.glb' } } });
  });
  const adapter = providers.get({ adapter: 'tripo3d-model', config: { apiKey: 'fixture', baseUrl: 'https://relay.vendor.com/v3', model: 'v3.1-20260211', pollIntervalMs: 1 } });
  const job = { prompt: 'test', inputs: [], options: {}, onRemoteTask: async () => { persisted = true; } };
  const result = await adapter.run(job);
  assert.equal(result.outputs[0].mediaType, 'model');
  assert.equal(result.remoteTaskId, 'tripo-task');
  calls.length = 0;
  await adapter.run({ ...job, remoteTaskId: 'tripo-task' });
  assert.deepEqual(calls, [['https://relay.vendor.com/v3/tasks/tripo-task', 'GET']]);
});
