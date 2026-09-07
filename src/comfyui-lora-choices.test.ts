import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { comfyUiLoraSelectionPatch, comfyUiModelLoraChoices, comfyUiStyleChoices } from './components/CanvasNodes';
import { buildComfyUiIllustriousPrompt } from '../local-bridge/engine/server/adapters/comfyui-illustrious.js';

const character = '游戏美宣人物刻画V-1.0_recovered.safetensors';
const catalog = {
  character: [character], style: ['krea-cg.safetensors'], object: ['object.safetensors'],
  presentation: { 'krea-cg.safetensors': { label: 'CG 画风', previewUrl: '/assets/lora-previews/krea-2-turbo-cg.png' } },
};

describe('ComfyUI compatible LoRA selection', () => {
  it('exposes only the fields actually consumed by each adapter', () => {
    expect(comfyUiModelLoraChoices({ adapter: 'comfyui-sdxl', loraCatalog: catalog }).map(x => x.field)).toEqual(['characterLora']);
    expect(comfyUiModelLoraChoices({ adapter: 'comfyui-native-image', loraCatalog: catalog }).map(x => x.field)).toEqual(['styleLora']);
    expect(comfyUiModelLoraChoices({ adapter: 'comfyui-illustrious', loraCatalog: catalog }).map(x => x.field)).toEqual(['styleLora', 'characterLora', 'objectLora']);
    expect(comfyUiModelLoraChoices({ adapter: 'http', loraCatalog: catalog })).toEqual([]);
  });

  it('keeps existing style presentation and the style-only helper unchanged', () => {
    const model = { adapter: 'comfyui-native-image', loraCatalog: catalog };
    expect(comfyUiModelLoraChoices(model)).toEqual(comfyUiStyleChoices(model));
    expect(comfyUiModelLoraChoices(model)[0]).toMatchObject({ label: 'CG 画风', previewUrl: catalog.presentation['krea-cg.safetensors'].previewUrl });
  });

  it('writes a character selection to the real graph input, not styleLora', () => {
    const choice = comfyUiModelLoraChoices({ adapter: 'comfyui-sdxl', loraCatalog: catalog })[0];
    const patch = comfyUiLoraSelectionPatch(choice, {});
    expect(patch).toEqual({ characterLora: character });
    const graph = buildComfyUiIllustriousPrompt({ prompt: 'Fixture only', checkpoint: 'meixuan.safetensors', ...patch });
    expect(graph['10']).toMatchObject({ class_type: 'LoraLoaderModelOnly', inputs: { lora_name: character } });
  });

  it('toggles only its own category without losing other selected LoRAs', () => {
    const choices = comfyUiModelLoraChoices({ adapter: 'comfyui-illustrious', loraCatalog: catalog });
    const data = { characterLora: character, styleLora: 'krea-cg.safetensors', objectLora: 'object.safetensors' };
    expect({ ...data, ...comfyUiLoraSelectionPatch(choices[1], data) }).toEqual({ ...data, characterLora: '' });
  });

  it('preserves the same model before invoking workflow defaults and resets on model changes', () => {
    const source = readFileSync(new URL('./components/CanvasNodes.tsx', import.meta.url), 'utf8');
    const body = source.split('const selectPlanModel =')[1].split('const selectPlanStyle =')[0];
    const guard = body.indexOf('if (model.id === selectedModel?.id) { setPlanModelId(model.id); return; }');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(body.indexOf('data.onSelectComfyUiWorkflow'));
    expect(body).toContain("characterLora: '', styleLora: '', objectLora: ''");
  });
});
