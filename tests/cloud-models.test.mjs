import 'fake-indexeddb/auto';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../shared/model-connection-settings.js';
import { createCloudModelStore } from '../src/cloud/model-store.js';
import { localRecords } from '../src/trial-storage.js';
const request = (store, path, body, method = body ? 'POST' : 'GET') => store.handle(new Request('https://trial.example' + path, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }));
const connectPath = '/api/v1/admin/models/gpt-image-2/connect';
beforeEach(async () => { for (const [key] of await localRecords.entries()) if (key.startsWith('cloud:model:')) await localRecords.remove(key); });

test('catalog upgrades preserve existing connections and never share their keys automatically', async () => {
  const store = createCloudModelStore({ rules, fetchImpl: async () => Response.json({}) });
  await request(store, connectPath, { apiKey: 'existing-owner-key' });
  const before = await localRecords.read('cloud:model:gpt-image-2');
  for (const id of ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image']) await localRecords.remove('cloud:model:' + id);
  const upgraded = createCloudModelStore({ rules, fetchImpl: () => { throw Error('Upgrade must not make requests'); } });
  const models = await (await request(upgraded, '/api/v1/admin/models')).json();
  assert.equal(models.models.length, 8);
  assert.deepEqual(await localRecords.read('cloud:model:gpt-image-2'), before);
  assert.ok(models.models.filter(model => model.adapter === 'gemini-image').every(model => !model.enabled && !model.secret.configured));
});

test('Seedance official and relay connections each use only their own supplied key', async () => {
  const seen = [];
  const store = createCloudModelStore({ rules, fetchImpl: async (url, init) => { seen.push([url, init.headers.authorization]); return Response.json({}); } });
  await request(store, '/api/v1/admin/models', { models: [{ id: 'seedance-other', name: 'Other Seedance', adapter: 'seedance-video', capability: 'video', config: { ...rules.connectionDefaults('seedance-video'), connectionMode: 'relay', baseUrl: 'https://relay.vendor.com' } }] }, 'PUT');
  await request(store, '/api/v1/admin/models/seedance-video/connect', { apiKey: 'my-ark-key' });
  await request(store, '/api/v1/admin/models/seedance-other/connect', { apiKey: 'my-relay-key' });
  assert.equal((await store.runtimeModel('seedance-video')).config.apiKey, 'my-ark-key');
  assert.equal((await store.runtimeModel('seedance-other')).config.apiKey, 'my-relay-key');
  assert.deepEqual(seen.map(item => item[1]), ['Bearer my-ark-key', 'Bearer my-relay-key']);
  assert.ok(seen[0][0].startsWith('https://ark.cn-beijing.volces.com/'));
  assert.ok(seen[1][0].startsWith('https://relay.vendor.com/'));
});

test('only cloud model rows exist and keys are sealed in browser storage', async () => {
  const store = createCloudModelStore({ rules, fetchImpl: async () => Response.json({ data: [] }) });
  const list = await (await request(store, '/api/v1/admin/models')).json();
  assert.equal(list.models.length, 8);
  assert.equal(list.models.filter(model => model.adapter === 'gemini-image').length, 4);
  assert.ok(list.models.every(model => !model.enabled && !model.secret.configured));
  assert.equal(list.models.some(model => model.adapter.startsWith('comfyui-') || model.adapter === 'gpt-sovits-audio'), false);
  const connected = await request(store, connectPath, { apiKey: 'private-fixture-key' });
  assert.equal(connected.status, 200); assert.doesNotMatch(await connected.text(), /private-fixture-key/);
  const record = await localRecords.read('cloud:model:gpt-image-2');
  assert.ok(record.secretBox.ciphertext instanceof ArrayBuffer);
  assert.doesNotMatch(JSON.stringify(record), /private-fixture-key/);
  assert.equal((await store.runtimeModel('gpt-image-2')).config.apiKey, 'private-fixture-key');
  assert.equal((await (await request(store, '/api/v1/models')).json()).models.length, 1);
});
test('changed relay origin cannot receive an existing saved key', async () => {
  const destinations = [];
  const store = createCloudModelStore({ rules, fetchImpl: async url => { destinations.push(String(url)); return Response.json({ data: [] }); } });
  await request(store, connectPath, { apiKey: 'old-fixture-key' });
  const before = await localRecords.read('cloud:model:gpt-image-2');
  const connection = { ...rules.connectionDefaults('openai-image'), mode: 'relay', baseUrl: 'https://relay.vendor.com' };
  const refused = await request(store, connectPath, { connection });
  assert.equal(refused.status, 400); assert.equal((await refused.json()).code, 'new_key_required');
  assert.equal(destinations.length, 1);
  assert.deepEqual(await localRecords.read('cloud:model:gpt-image-2'), before);
  assert.equal((await request(store, connectPath, { connection, apiKey: 'new-fixture-key' })).status, 200);
  assert.equal(destinations[1], 'https://relay.vendor.com/v1/models');
});
test('failed candidate verification does not overwrite a valid connection', async () => {
  let valid = true;
  const store = createCloudModelStore({ rules, fetchImpl: async () => Response.json({}, { status: valid ? 200 : 401 }) });
  await request(store, connectPath, { apiKey: 'working-fixture' });
  const before = await localRecords.read('cloud:model:gpt-image-2'); valid = false;
  assert.equal((await request(store, connectPath, { apiKey: 'invalid-fixture' })).status, 401);
  assert.deepEqual(await localRecords.read('cloud:model:gpt-image-2'), before);
});
test('concurrent candidate saves cannot clobber a newer model record', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const store = createCloudModelStore({ rules, fetchImpl: async () => { await gate; return Response.json({}); } });
  await request(store, '/api/v1/admin/models');
  const first = request(store, connectPath, { apiKey: 'fixture-one' });
  const second = request(store, connectPath, { apiKey: 'fixture-two' });
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
});
test('disconnect removes its key without altering sibling model configuration', async () => {
  const store = createCloudModelStore({ rules, fetchImpl: async () => Response.json({}) });
  await request(store, connectPath, { apiKey: 'fixture' });
  const sibling = await localRecords.read('cloud:model:gemini-image');
  assert.equal((await request(store, '/api/v1/admin/models/gpt-image-2/connection', undefined, 'DELETE')).status, 200);
  assert.equal((await localRecords.read('cloud:model:gpt-image-2')).secretBox, undefined);
  assert.deepEqual(await localRecords.read('cloud:model:gemini-image'), sibling);
});

test('configuration backup import never carries keys to a changed destination or enables local models', async () => {
  let calls = 0;
  const store = createCloudModelStore({ rules, fetchImpl: async () => { calls++; return Response.json({}); } });
  await request(store, connectPath, { apiKey: 'original-fixture-key' });
  const exported = await (await request(store, '/api/v1/admin/models')).json();
  exported.models.find(model => model.id === 'gpt-image-2').config = { ...rules.connectionDefaults('openai-image'), mode: 'relay', baseUrl: 'https://relay.vendor.com', nested: { apiKey: 'injected' } };
  exported.models.push({ id: 'local', adapter: 'gpt-sovits-audio', capability: 'audio', enabled: true });
  assert.equal((await request(store, '/api/v1/admin/models', exported, 'PUT')).status, 200);
  const model = await localRecords.read('cloud:model:gpt-image-2');
  assert.equal(model.secretBox, undefined); assert.equal(model.model.enabled, false);
  assert.doesNotMatch(JSON.stringify(model), /injected|original-fixture-key/);
  assert.equal(await localRecords.read('cloud:model:local'), undefined);
  assert.equal(calls, 1);
});
