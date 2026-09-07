import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { verifyDeployment } from '../local-bridge/deployment-target.mjs';

test('requires ComfyUI and models from the selected extracted package across relocated roots', async () => {
  for (const location of ['portable-machine-one', 'portable-machine-two']) {
    const comfyRoot = path.resolve(location, 'HEIYAN/ComfyUI');
    const options = { comfyRoot, comfyPort: 8290 };
    const payload = argv => async url => { assert.equal(url, 'http://127.0.0.1:8290/system_stats'); return Response.json({ system: { argv } }); };
    await verifyDeployment({ ...options, fetchImpl: payload([path.join(comfyRoot, 'main.py'), '--models-directory', path.join(comfyRoot, 'models')]) });
    await assert.rejects(verifyDeployment({ ...options, fetchImpl: payload([path.resolve('old/main.py'), '--models-directory', path.join(comfyRoot, 'models')]) }), /another ComfyUI/);
    await assert.rejects(verifyDeployment({ ...options, fetchImpl: payload([path.join(comfyRoot, 'main.py'), '--models-directory', path.resolve('old/models')]) }), /another ComfyUI/);
    await assert.rejects(verifyDeployment({ ...options, fetchImpl: payload([]) }), /another ComfyUI/);
  }
});
