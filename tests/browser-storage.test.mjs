import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleLocalRequest as api, mediaResponse } from '../src/trial-storage.js';
const call = (path, method = 'GET', body) => api(new Request(`https://trial.example${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) }));
const task = () => `/api/v1/canvas/t-${crypto.randomUUID()}`;

test('empty canvas initializes and graph persists across page reload', async () => {
  const path = task(); const initial = await (await call(path)).json(); assert.equal(initial.revision, 0);
  const graph = { ...initial, nodes: [{ id: 'a', type: 'text', position: { x: 2, y: 3 }, data: { kind: 'text', text: 'My text' } }], edges: [], viewport: { x: 24, y: 38, zoom: .5 } };
  assert.equal((await call(path, 'PUT', graph)).status, 200);
  const fresh = await import(`../src/trial-storage.js?reload=${crypto.randomUUID()}`);
  const restored = await (await fresh.handleLocalRequest(new Request(`https://trial.example${path}`))).json();
  assert.equal(restored.nodes[0].data.text, 'My text'); assert.equal(restored.viewport.zoom, .5); assert.equal(restored.revision, 1);
});
test('concurrent tabs cannot overwrite a newer revision', async () => {
  const path = task(); const data = await (await call(path)).json();
  const results = await Promise.all([call(path, 'PUT', data), call(path, 'PUT', data)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});
test('boards are task-isolated and deleting a secondary board preserves main', async () => {
  const path = task(), other = task();
  const created = await (await call(`${path}/boards`, 'POST', { title: 'Study' })).json();
  assert.equal((await (await call(`${path}/boards`)).json()).boards.length, 2);
  assert.equal((await (await call(`${other}/boards`)).json()).boards.length, 1);
  assert.equal((await call(`${path}/boards/main`, 'DELETE')).status, 409);
  assert.equal((await call(`${path}/boards/${created.board.id}`, 'DELETE')).status, 204);
  assert.equal((await (await call(`${path}/boards`)).json()).boards.length, 1);
});
test('imported media persists and serves exact bytes including video ranges', async () => {
  const form = new FormData(); form.set('file', new File(['0123456789'], 'demo.mp4', { type: 'video/mp4' }));
  const result = await api(new Request(`https://trial.example${task()}/assets`, { method: 'POST', body: form }));
  assert.equal(result.status, 201); const media = await result.json();
  const fresh = await import(`../src/trial-storage.js?media=${crypto.randomUUID()}`);
  const request = new Request(`https://trial.example${media.url}`, { headers: { Range: 'bytes=2-5' } });
  const partial = await fresh.handleLocalRequest(request);
  assert.equal(partial.status, 206); assert.equal(await partial.text(), '2345'); assert.equal(partial.headers.get('Content-Range'), 'bytes 2-5/10');
  const full = await api(new Request(`https://trial.example${media.url}`)); assert.equal(await full.text(), '0123456789');
});
test('invalid, suffix and HEAD ranges are handled deliberately', async () => {
  const blob = new Blob(['0123456789'], { type: 'video/mp4' });
  assert.equal(mediaResponse(new Request('https://x.test', { headers: { Range: 'bytes=90-99' } }), blob).status, 416);
  assert.equal(await mediaResponse(new Request('https://x.test', { headers: { Range: 'bytes=-3' } }), blob).text(), '789');
  const head = mediaResponse(new Request('https://x.test', { method: 'HEAD' }), blob);
  assert.equal(await head.text(), ''); assert.equal(head.headers.get('Content-Length'), '10');
});
test('model connections and job submissions never claim generation success', async () => {
  assert.equal((await call('/api/v1/jobs', 'POST', { prompt: 'test' })).status, 503);
  assert.equal((await call('/api/v1/comfyui/connect', 'POST', { baseUrl: 'http://127.0.0.1:8188' })).status, 503);
  assert.deepEqual((await (await call('/api/v1/models')).json()).models, []);
  assert.equal((await call('/api/v1/admin/models', 'PUT', { secrets: { secret: 'fixture-only' } })).status, 503);
});
test('invalid canvas does not change the prior save', async () => {
  const path = task(); assert.equal((await call(path, 'PUT', { revision: 0, nodes: null, edges: [] })).status, 400);
  assert.equal((await (await call(path)).json()).revision, 0);
});
test('clipboard paste remaps node and edge identities without losing current nodes', async () => {
  const path = task();
  const result = await (await call(`${path}/paste`, 'POST', { clipboard: { nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: {} }, { id: 'b', position: { x: 30, y: 10 }, data: {} }], edges: [{ id: 'ab', source: 'a', target: 'b' }] }, position: { x: 100, y: 80 } })).json();
  assert.equal(result.nodes.length, 2); assert.notEqual(result.nodes[0].id, 'a'); assert.equal(result.edges[0].source, result.nodes[0].id); assert.equal(result.nodes[0].position.x, 100);
});
