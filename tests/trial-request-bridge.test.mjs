import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTrialRequestBridge, isInteractionTrial } from '../src/trial-request-bridge.js';
import { handleLocalRequest } from '../src/trial-storage.js';

const origin = 'https://trial.example';
const createBridge = () => createTrialRequestBridge({ origin, nativeFetch: fetch });
const task = () => `/api/v1/canvas/t-${crypto.randomUUID()}`;
const put = (bridge, path, body) => bridge.fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('startup and local APIs do not depend on a ServiceWorker or authenticated API fetch', async () => {
  const bridge = createTrialRequestBridge({ origin, nativeFetch: () => { throw new Error('Network access must not be used for storage'); } });
  assert.equal((await (await bridge.fetch('/api/v1/health')).json()).browserLocal, true);
  assert.equal((await bridge.fetch('/api/v1/jobs', { method: 'POST' })).status, 503);
  assert.equal(isInteractionTrial(), false);
  const bootstrap = await readFile(new URL('../src/trial-bootstrap.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(bootstrap, /serviceWorker/);
  assert.doesNotMatch(bootstrap, /history\.(replaceState|pushState)|location\.(replace|assign)/, 'opening the site must preserve the homepage URL');
  // Agent mode initializes the very same durable store and generation bridge.
  assert.doesNotMatch(bootstrap, /=== '\/agent-preview'/);
  assert.ok(bootstrap.indexOf('window.fetch = bridge.fetch') < bootstrap.lastIndexOf("await import('./main')"));
});

test('homepage keeps local settings and enters the existing browser workspace', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const home = app.slice(app.indexOf('function CanvasHome()'), app.indexOf('function CanvasHome()') + 8000);
  assert.match(home, /onClick=\{\(\) => setShowSettingsCenter\(true\)\}/);
  assert.match(home, /href=\{localStudioHref\(\)\}/);
  assert.match(app, /task_id: 'local-canvas'/);
});

for (const [name, type] of [['image.png', 'image/png'], ['video.mp4', 'video/mp4'], ['audio.wav', 'audio/wav'], ['model.glb', 'model/gltf-binary']]) {
  test(`${type} survives reload and is directly readable by media elements`, async () => {
    const bridge = createBridge(), path = task();
    const form = new FormData(); form.set('file', new File([`test-${name}`], name, { type }));
    const media = await (await bridge.fetch(`${path}/assets`, { method: 'POST', body: form })).json();
    assert.match(media.url, /^blob:/);
    assert.equal(await (await fetch(media.url)).text(), `test-${name}`);
    const initial = await (await bridge.fetch(path)).json();
    const saved = await (await put(bridge, path, { ...initial, nodes: [{ id: 'asset', data: { assetUrl: media.url, inputUrls: [media.url] } }] })).json();
    assert.equal(saved.nodes[0].data.assetUrl, media.url, 'reuse one object URL within the session');
    const raw = await (await handleLocalRequest(new Request(`${origin}${path}`))).json();
    assert.match(raw.nodes[0].data.assetUrl, /^\/media\/assets\//, 'never persist ephemeral blob URLs');
    assert.equal(raw.nodes[0].data.assetUrl, raw.nodes[0].data.inputUrls[0]);
    bridge.dispose();
    const reloaded = createBridge();
    const restored = await (await reloaded.fetch(path)).json();
    assert.notEqual(restored.nodes[0].data.assetUrl, media.url);
    assert.equal(await (await fetch(restored.nodes[0].data.assetUrl)).text(), `test-${name}`);
    assert.equal((await put(reloaded, path, restored)).status, 200);
    reloaded.dispose();
  });
}

test('clipboard stores durable media identities and restores them for a new page', async () => {
  const bridge = createBridge();
  const form = new FormData(); form.set('file', new File(['clipboard'], 'test.png', { type: 'image/png' }));
  const media = await (await bridge.fetch(`${task()}/assets`, { method: 'POST', body: form })).json();
  await put(bridge, '/api/v1/clipboard', { nodes: [{ id: 'a', data: { assetUrl: media.url } }], edges: [] });
  bridge.dispose();
  const restoredBridge = createBridge();
  const result = await (await restoredBridge.fetch('/api/v1/clipboard')).json();
  assert.equal(await (await fetch(result.clipboard.nodes[0].data.assetUrl)).text(), 'clipboard');
  restoredBridge.dispose();
});

test('normal assets and external URLs retain native fetch behavior', async () => {
  const calls = [];
  const bridge = createTrialRequestBridge({ origin, nativeFetch: async (...args) => { calls.push(args); return new Response('native'); } });
  assert.equal(await (await bridge.fetch('/assets/main.js')).text(), 'native');
  assert.equal(await (await bridge.fetch('https://elsewhere.example/api/example')).text(), 'native');
  assert.equal(calls.length, 2);
});

test('aborted writes do not change saved data', async () => {
  const bridge = createBridge(), path = task();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(bridge.fetch(path, { method: 'PUT', signal: controller.signal }), { name: 'AbortError' });
  assert.equal((await (await bridge.fetch(path)).json()).revision, 0);
});
