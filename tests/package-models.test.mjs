import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { completePackageModels } from '../local-bridge/package-models.mjs';

test('discovers compatible package checkpoints without advertising pose helpers or duplicating known models', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'heiyan-package-model-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'models/checkpoints'), { recursive: true });
  for (const [name, header] of [['art.safetensors', { 'model.diffusion_model.label_emb.0.0.weight': { shape: [1280,2816] }, 'conditioner.embedders.1.model.token_embedding.weight': { shape: [49408,1280] } }], ['pose.safetensors', { 'pose.weight': { shape: [1] } }]]) {
    const bytes=Buffer.from(JSON.stringify(header)); const size=Buffer.alloc(8); size.writeBigUInt64LE(BigInt(bytes.length));
    await fs.writeFile(path.join(root,'models/checkpoints',name), Buffer.concat([size,bytes]));
  }
  const options = { comfyRoot: root, comfyPort: 8290, fetchImpl: async () => Response.json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['art.safetensors','pose.safetensors','../missing.safetensors']] } } } }) };
  const first = await completePackageModels([], options);
  assert.equal(first.length, 1); assert.equal(first[0].config.model, 'art.safetensors');
  assert.equal((await completePackageModels(first, options)).length, 1);
  const missing = await completePackageModels(first, { ...options, fetchImpl: async () => Response.json({}) });
  assert.equal(missing[0].config.discoveryReady, false);
});
