import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageModelCatalog, additionalImageModels } from '../shared/image-model-catalog.js';
import { generationProfileFor, normalizeGenerationOptions } from '../src/cloud/generation-options.js';
import { createCloudProviders } from '../src/cloud/providers.js';

test('official model inventory separates active, legacy and deprecated identifiers', () => {
  assert.equal(new Set(imageModelCatalog.map(model => model.id)).size, imageModelCatalog.length);
  assert.equal(imageModelCatalog.filter(model => model.adapter === 'gemini-image').length, 4);
  assert.ok(additionalImageModels.every(model => !model.enabled && !model.config.apiKey));
  assert.equal(imageModelCatalog.find(model => model.id === 'gpt-image-1-mini').state, 'deprecated');
  assert.ok(!imageModelCatalog.some(model => model.id === 'gpt-image-2-4k'));
});
test('Gemini resolutions follow the real selected variant, not one generic profile', () => {
  for (const id of ['gemini-2.5-flash-image', 'gemini-3.1-flash-lite-image']) assert.deepEqual(generationProfileFor({ adapter: 'gemini-image', config: { model: id } }).resolutions, ['1K']);
  assert.deepEqual(generationProfileFor({ adapter: 'gemini-image', config: { model: 'gemini-3-pro-image' } }).resolutions, ['1K', '2K', '4K']);
  const flash = generationProfileFor({ adapter: 'gemini-image', config: { model: 'gemini-3.1-flash-image' } });
  assert.deepEqual(flash.resolutions, ['0.5K', '1K', '2K', '4K']); assert.ok(flash.ratios.includes('8:1'));
  assert.deepEqual(generationProfileFor({ adapter: 'openai-image', config: { model: 'gpt-image-1.5' } }).resolutions, ['1K']);
});
test('every Gemini variant submits its own model and legal image settings', async () => {
  for (const model of imageModelCatalog.filter(model => model.adapter === 'gemini-image')) {
    let body;
    const provider = createCloudProviders(async (url, init) => {
      assert.ok(url.includes(model.id + ':generateContent')); body = JSON.parse(init.body);
      assert.equal(init.headers['x-goog-api-key'], 'own-gemini-key');
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'eA==' } }] } }] });
    }).get({ adapter: model.adapter, config: { model: model.id, apiKey: 'own-gemini-key' } });
    for (const resolution of generationProfileFor({ adapter: model.adapter, config: { model: model.id } }).resolutions) {
      await provider.run({ prompt: 'fixture', count: 1, resolution, ratio: '16:9' });
      assert.equal(body.generationConfig.imageConfig.aspectRatio, '16:9');
      assert.equal(body.generationConfig.imageConfig.imageSize, model.id === 'gemini-2.5-flash-image' ? undefined : resolution === '0.5K' ? '512' : resolution);
    }
  }
});
test('GPT quality is independent from size for generation and edits', async () => {
  const model = { adapter: 'openai-image', capability: 'image', config: { model: 'gpt-image-2', apiKey: 'own-openai-key' } };
  assert.throws(() => normalizeGenerationOptions(model, { imageQuality: 'ultra' }), /图像质量/);
  assert.equal(normalizeGenerationOptions(model, { imageQuality: 'low' }).imageQuality, 'low');
  const bodies = [];
  const adapter = createCloudProviders(async (_url, init) => { bodies.push(init.body); return Response.json({ data: [{ b64_json: 'eA==' }] }); }).get(model);
  for (const imageQuality of ['auto', 'low', 'medium', 'high']) {
    await adapter.run({ prompt: 'fixture', resolution: '2K', ratio: '16:9', options: { imageQuality } });
    await adapter.run({ prompt: 'fixture', resolution: '2K', ratio: '16:9', options: { imageQuality }, referenceImages: [{ mimeType: 'image/png', buffer: Buffer.from('x') }] });
    assert.equal(JSON.parse(bodies.at(-2)).quality, imageQuality);
    assert.equal(bodies.at(-1).get('quality'), imageQuality);
    assert.equal(JSON.parse(bodies.at(-2)).size, bodies.at(-1).get('size'));
  }
});
