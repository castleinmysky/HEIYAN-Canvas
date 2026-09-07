import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createGateway, siteOrigin } from './gateway.mjs';

const bundle = path.resolve(process.argv[2]);
const { createApp } = await import(pathToFileURL(path.join(bundle, 'SiteBridge/engine/server/app.js')));
const { resolveRuntimePaths } = await import(pathToFileURL(path.join(bundle, 'SiteBridge/engine/server/paths.js')));
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heiyan-addon-check-'));
const paths = resolveRuntimePaths({ ECHO_HOME: stateDir });
let gpuSubmissions = 0;
const fetchImpl = async url => {
  if (String(url).endsWith('/object_info')) return Response.json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['Illustrious-XL-v2.0.safetensors']] } } }, LoraLoader: { input: { required: { lora_name: [['fixture-style.safetensors']] } } } });
  gpuSubmissions++; throw new Error('A generation call is prohibited during this check.');
};
const app = createApp({ dataDir: paths.data, privateDir: paths.private, runtimePaths: paths, env: { ECHO_HOME: stateDir }, fetchImpl });
const internal = app.listen(0, '127.0.0.1');
await new Promise(resolve => internal.once('listening', resolve));
const token = 'f'.repeat(43);
const gateway = createGateway({ token, stateDir: paths.private, upstream: 'http://127.0.0.1:' + internal.address().port, port: 0 });
try {
  const address = await gateway.listen();
  const response = await fetch('http://127.0.0.1:' + address.port + '/connect', { method: 'POST', headers: { Authorization: 'Bearer ' + token, Origin: siteOrigin } });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.ok(payload.models.length > 0, 'Discovery must actually enable available local models.');
  assert.ok(payload.models.every(model => model.adapter.startsWith('comfyui-')));
  assert.equal(gpuSubmissions, 0);
  console.log(JSON.stringify({ packagedEngineImport: true, isolatedConnection: true, availableModels: payload.models.length, gpuSubmissions }));
} finally {
  gateway.server.closeAllConnections(); internal.closeAllConnections();
  await Promise.all([new Promise(resolve => gateway.server.close(resolve)), new Promise(resolve => internal.close(resolve))]);
  await fs.rm(stateDir, { recursive: true });
}
