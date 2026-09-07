import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../local-bridge/gateway.mjs';

test('an explicit machine-local target persists across repeated remote reconnects', async () => {
  const targets = [];
  const gateway = createGateway({ token: 'fixture', stateDir: '.', upstream: 'http://127.0.0.1:9991', port: 0, comfyPort: 8188,
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith('/comfyui/connect')) targets.push(JSON.parse(options.body).baseUrl);
      return Response.json({ models: [{ id: 'full', adapter: 'comfyui-native-image' }] });
    },
  });
  try {
    const address = await gateway.listen();
    for (let i = 0; i < 2; i++) {
      const result = await fetch('http://127.0.0.1:' + address.port + '/connect', { method: 'POST', headers: { Authorization: 'Bearer fixture' }, body: JSON.stringify({ baseUrl: 'https://untrusted.example', comfyPort: 8288 }) });
      assert.equal(result.status, 200);
    }
    assert.deepEqual(targets, ['http://127.0.0.1:8188', 'http://127.0.0.1:8188']);
  } finally { gateway.server.closeAllConnections(); await new Promise(resolve => gateway.server.close(resolve)); }
});

test('local target rejects malformed and recursive gateway ports', () => {
  for (const comfyPort of ['8188', 0, -1, 80, 65536, 8289, 8291, NaN]) {
    assert.throws(() => createGateway({ token: 'fixture', comfyPort }), /Invalid local ComfyUI port/);
  }
});
