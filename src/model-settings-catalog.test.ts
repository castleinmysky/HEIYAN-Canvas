import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { groupModelsByGeneration, modelPresentation } from './model-settings-catalog';
import { ModelSettingsGroups, type AdminModel } from './components/ModelSettings';

const models: AdminModel[] = [
  { id: 'tripo', name: 'Tripo3D', capability: 'model', adapter: 'tripo3d-model', enabled: false },
  { id: 'seed', name: 'Seedance', capability: 'video', adapter: 'seedance-video', enabled: false },
  { id: 'openai', name: 'Old image name', capability: 'image', adapter: 'openai-image', enabled: true },
  { id: 'minimax', name: 'MiniMax', capability: 'video', adapter: 'minimax-h3-video', enabled: false },
  { id: 'gemini', name: 'Gemini Image', capability: 'image', adapter: 'gemini-image', enabled: false },
];

describe('API model catalog presentation', () => {
  it('groups by generation output in stable order without empty sections or duplicates', () => {
    const groups = groupModelsByGeneration(models);
    expect(groups.map((group) => group.id)).toEqual(['image', 'video', 'model']);
    expect(groups.map((group) => group.models.map((model) => model.id))).toEqual([['openai', 'gemini'], ['seed', 'minimax'], ['tripo']]);
    expect(groups.flatMap((group) => group.models)).toHaveLength(models.length);
    expect(groupModelsByGeneration([])).toEqual([]);
  });
  it('keeps disabled/disconnected models available to configure and does not mutate saved data', () => {
    const before = JSON.stringify(models);
    const groups = groupModelsByGeneration(models);
    for (const model of models) {
      modelPresentation(model);
      expect(groups.flatMap((group) => group.models).find((item) => item.id === model.id)).toBe(model);
    }
    expect(JSON.stringify(models)).toBe(before);
  });
  it('uses verified official display names for the actual default versions', () => {
    expect(models.map((model) => modelPresentation(model).name)).toEqual(['Tripo v3.1', 'Seedance 2.0', 'GPT Image 2', 'MiniMax H3', 'Gemini 2.5 Flash Image']);
    expect(modelPresentation(models[4]).modelId).toBe('gemini-2.5-flash-image');
  });
  it('never replaces a relay model alias or unknown model version with another official model', () => {
    const custom = { ...models[2], config: { model: '  relay-custom-image-v8  ', baseUrl: 'https://example.com', connectionMode: 'relay' as const } };
    expect(modelPresentation(custom)).toMatchObject({ name: 'relay-custom-image-v8', modelId: 'relay-custom-image-v8', provider: '', icon: '' });
    expect(custom.config.model).toBe('  relay-custom-image-v8  ');
    const generic = { ...models[2], adapter: 'http' as const, name: 'My model' };
    expect(modelPresentation(generic).name).toBe('My model');
  });
  it('serves five original provider icons locally, without third-party requests', () => {
    const icons = models.map((model) => modelPresentation(model).icon);
    expect(new Set(icons).size).toBe(5);
    for (const icon of icons) {
      expect(icon).toMatch(/^\/provider-icons\/[a-z-]+\.(png|ico)$/);
      const bytes = readFileSync('public' + icon);
      expect(bytes.length).toBeGreaterThan(100);
      expect(bytes.length).toBeLessThan(100_000);
      expect(bytes.subarray(0, icon.endsWith('.png') ? 8 : 4).toString('hex')).toBe(icon.endsWith('.png') ? '89504e470d0a1a0a' : '00000100');
    }
  });
  it('renders accessible, bilingual group headings and one row per model', () => {
    for (const language of ['zh', 'en'] as const) {
      const html = renderToStaticMarkup(createElement(ModelSettingsGroups, { models, language, renderModel: (model) => createElement('div', { key: model.id, 'data-model-id': model.id }, modelPresentation(model).name) }));
      const labels = language === 'en' ? ['Image generation', 'Video generation', '3D generation'] : ['图片生成', '视频生成', '3D 生成'];
      for (const label of labels) expect(html).toContain(label);
      expect((html.match(/<section /g) || [])).toHaveLength(3);
      expect((html.match(/data-model-id=/g) || [])).toHaveLength(5);
      expect((html.match(/aria-labelledby=/g) || [])).toHaveLength(3);
      if (language === 'en') expect(html).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });
  it('supports an audio category only when a cloud audio model is supplied', () => {
    expect(groupModelsByGeneration([{ ...models[2], adapter: 'http', capability: 'audio' as const }])[0].en).toBe('Audio generation');
  });
});
