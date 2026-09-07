import { describe, expect, it } from 'vitest';
import { comfyUiPreviewInventory, comfyUiSetupStage } from './components/ComfyUiResources';
import type { ComfyUiLocalResourceInventory } from './comfyui-local-resources';

const inventory: ComfyUiLocalResourceInventory = {
  available: true,
  baseUrl: 'http://127.0.0.1:8188',
  checkpoints: ['model.safetensors'],
  loras: [],
  scannedAt: '2026-09-04T00:00:00.000Z',
  models: [{ id: 'local-model', name: 'Local model', capability: 'image', adapter: 'comfyui-native-image', enabled: true, baseUrl: 'http://127.0.0.1:8188', checkpoint: 'model.safetensors', filePresent: true, installed: true, state: 'ready', message: 'ready', workflows: [] }],
};

describe('ComfyUI first-run preview', () => {
  it('can show the offline and discovery steps without changing the real inventory', () => {
    expect(comfyUiSetupStage(comfyUiPreviewInventory(inventory, 'offline'))).toBe('offline');
    expect(comfyUiSetupStage(comfyUiPreviewInventory(inventory, 'discovered'))).toBe('discovered');
    expect(inventory.models[0].enabled).toBe(true);
  });

  it('shows detected models as disabled by default in the configured preview', () => {
    const preview = comfyUiPreviewInventory(inventory, 'configured');
    expect(comfyUiSetupStage(preview)).toBe('configured');
    expect(preview.models[0].enabled).toBe(false);
    expect(inventory.models[0].enabled).toBe(true);
  });
});
