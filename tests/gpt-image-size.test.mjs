import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { GPT_IMAGE_SIZES, gptImageSize } from '../src/cloud/gpt-image-size.js';
import { publicGenerationProfile, normalizeGenerationOptions } from '../src/cloud/generation-options.js';
import { createCloudProviders } from '../src/cloud/providers.js';

test('every exposed GPT Image 2 size is exact and within the documented pixel constraints', () => {
  for (const [ratio, sizes] of Object.entries(GPT_IMAGE_SIZES)) {
    const [rw, rh] = ratio.split(':').map(Number);
    for (const size of sizes) {
      const [w, h] = size.split('x').map(Number);
      assert.equal(w * rh, h * rw, size);
      assert.equal(w % 16, 0); assert.equal(h % 16, 0);
      assert.ok(Math.max(w, h) <= 3840 && Math.max(w, h) / Math.min(w, h) <= 3);
      assert.ok(w * h >= 655360 && w * h <= 8294400);
    }
  }
  assert.equal(gptImageSize('Auto', '4K'), 'auto');
  assert.throws(() => gptImageSize('100:1'));
});

test('GPT Image 2 and its snapshot expose 21:9; legacy and fixed relay models do not', () => {
  for (const name of ['gpt-image-2', 'gpt-image-2-2026-04-21', 'gpt-image-2.5']) {
    const model = { id: 'custom-name', capability: 'image', adapter: 'openai-image', config: { model: name } };
    assert.ok(publicGenerationProfile(model).ratios.includes('21:9'));
    assert.equal(normalizeGenerationOptions(model, { ratio: '21:9', resolution: '2K' }).ratio, '21:9');
  }
  for (const name of ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2-4k']) {
    const model = { capability: 'image', adapter: 'openai-image', config: { model: name } };
    assert.ok(!publicGenerationProfile(model).ratios.includes('21:9'));
    assert.throws(() => normalizeGenerationOptions(model, { ratio: '21:9' }));
  }
});

test('text generation and reference edits send exact 21:9 sizes to official and custom APIs without postprocessing', async () => {
  for (const baseUrl of ['https://api.openai.com', 'https://relay.example.com']) {
    for (const [tier, size] of [['1K', '1568x672'], ['2K', '2016x864'], ['4K', '3696x1584']]) {
      for (const edit of [false, true]) {
        let calls = 0;
        const bytes = Buffer.from('unchanged fixture bytes');
        const adapter = createCloudProviders(async (url, init) => {
          calls++;
          assert.equal(url, baseUrl + (edit ? '/v1/images/edits' : '/v1/images/generations'));
          const body = edit ? Object.fromEntries(init.body) : JSON.parse(init.body);
          assert.equal(body.model, 'gpt-image-2'); assert.equal(body.size, size);
          assert.equal(body.response_format, undefined); assert.equal(body.input_fidelity, undefined);
          if (edit) assert.ok(body.image instanceof Blob);
          return Response.json({ data: [{ b64_json: bytes.toString('base64') }] });
        }).get({ adapter: 'openai-image', config: { model: 'gpt-image-2', baseUrl, apiKey: 'fixture' } });
        const outputs = await adapter.run({ prompt: 'fixture', ratio: '21:9', resolution: tier, count: 1, referenceImages: edit ? [{ buffer: Buffer.from('ref'), mimeType: 'image/png' }] : [] });
        assert.equal(calls, 1); assert.deepEqual(outputs[0].buffer, bytes);
      }
    }
  }
});

test('unsupported relay alias still rejects 21:9 without a paid request', async () => {
  let calls = 0;
  const adapter = createCloudProviders(async () => { calls++; throw new Error('must not submit'); }).get({ adapter: 'openai-image', config: { model: 'gpt-image-2-4k' } });
  await assert.rejects(adapter.run({ ratio: '21:9', prompt: 'fixture' }), /does not support/);
  assert.equal(calls, 0);
});

test('2.5 preserves the requested model and exact 1K cinema size for generation and edits', async () => {
  for (const edit of [false, true]) {
    const bytes = Buffer.from('fixture');
    const adapter = createCloudProviders(async (_url, init) => {
      const body = edit ? Object.fromEntries(init.body) : JSON.parse(init.body);
      assert.equal(body.model, 'gpt-image-2.5');
      assert.equal(body.size, '1568x672');
      return Response.json({ data: [{ b64_json: bytes.toString('base64') }] });
    }).get({ adapter: 'openai-image', config: { model: 'gpt-image-2.5', baseUrl: 'https://relay.example.com', apiKey: 'fixture' } });
    const output = await adapter.run({ prompt: 'fixture', ratio: '21:9', resolution: '1K', count: 1, referenceImages: edit ? [{ buffer: bytes, mimeType: 'image/png' }] : [] });
    assert.deepEqual(output[0].buffer, bytes);
  }
});

test('removed three-view generator tool does not remove existing multiview splitting or saved guide compatibility', async () => {
  const nodes = await fs.readFile(new URL('../src/components/CanvasNodes.tsx', import.meta.url), 'utf8');
  const app = await fs.readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(nodes, /打开角色三视图工具|QuickPromptToolDrawer|setShowPromptTools/);
  assert.doesNotMatch(app, /applyCharacterTurnaroundTemplate|GPT Image 2 当前不支持原生 21:9/);
  assert.ok(nodes.includes('turnaroundSplitter: withNodeErrorBoundary(TurnaroundSplitterNode)'));
  assert.match(app, /characterProportionGuideUrl/);
});
