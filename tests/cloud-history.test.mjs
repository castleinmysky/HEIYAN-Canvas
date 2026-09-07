import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localRecords } from '../src/trial-storage.js';
import { createCloudHistoryStore } from '../src/cloud/history-store.js';
const history = createCloudHistoryStore({});
const remove = (path, body) => history.handle(new Request('https://trial.example' + path, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
async function fixture() {
  const id = crypto.randomUUID(), taskId = 'task-' + id, url = `/media/assets/${id}.png`;
  const job = { id, taskId, status: 'succeeded', outputs: [{ mediaType: 'image', mediaUrl: url }] };
  await localRecords.write('asset:' + id + '.png', { blob: new Blob(['result']), source: 'generated' });
  await localRecords.write('cloud:job:' + id, job);
  return { id, job, taskId, url };
}
test('deleting a selected history entry preserves its file and output index', async () => {
  const f = await fixture();
  const response = await remove('/api/v1/generation-history', { taskId: f.taskId, entries: [{ jobId: f.id, outputIndex: 0, mediaUrl: f.url }] });
  assert.equal(response.status, 200); assert.equal((await response.json()).removed, 1);
  assert.ok((await localRecords.read('cloud:job:' + f.id)).outputs[0].historyHiddenAt);
  assert.ok(await localRecords.read('asset:' + f.id + '.png'));
});
test('stale output identity cannot remove a newer retry result', async () => {
  const f = await fixture();
  const response = await remove('/api/v1/generation-history', { taskId: f.taskId, entries: [{ jobId: f.id, outputIndex: 0, mediaUrl: '/media/assets/old.png' }] });
  assert.equal(response.status, 409); assert.equal((await localRecords.read('cloud:job:' + f.id)).outputs[0].historyHiddenAt, undefined);
});
test('clear history affects only its task and does not remove media bytes', async () => {
  const f = await fixture(), other = await fixture();
  assert.equal((await remove('/api/v1/generation-history', { taskId: f.taskId, clearAll: true })).status, 200);
  assert.ok((await localRecords.read('cloud:job:' + f.id)).outputs[0].historyHiddenAt);
  assert.equal((await localRecords.read('cloud:job:' + other.id)).outputs[0].historyHiddenAt, undefined);
});
test('physical cleanup requires confirmation and preserves imports/unreferenced outputs', async () => {
  const f = await fixture();
  await localRecords.write('asset:import.png', { blob: new Blob(['original']) });
  await localRecords.write('asset:unreferenced.png', { blob: new Blob(['unreferenced']), source: 'generated' });
  assert.equal((await remove('/api/v1/admin/data/generated-results', {})).status, 400);
  const response = await remove('/api/v1/admin/data/generated-results', { confirmation: 'delete-generated-results' });
  assert.equal(response.status, 200);
  assert.equal(await localRecords.read('asset:' + f.id + '.png'), undefined);
  assert.ok(await localRecords.read('asset:import.png')); assert.ok(await localRecords.read('asset:unreferenced.png'));
});
test('cleanup refuses paused recoverable jobs', async () => {
  const f = await fixture();
  await localRecords.write('cloud:job:' + f.id, { ...f.job, status: 'paused' });
  assert.equal((await remove('/api/v1/admin/data/generated-results', { confirmation: 'delete-generated-results' })).status, 409);
  assert.ok(await localRecords.read('asset:' + f.id + '.png'));
});
