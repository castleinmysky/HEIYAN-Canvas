import { describe, expect, it } from 'vitest';
import { canvasCapabilityModuleEnabled, canvasToolVisible } from './canvas-capability-modules';

describe('canvas capability module visibility', () => {
  it('keeps ComfyUI-specific canvas affordances hidden before a local model is enabled', () => {
    const cloudOnly = [{ adapter: 'openai-image', enabled: true }];
    const disabledLocal = [{ adapter: 'comfyui-sdxl', enabled: false }];

    expect(canvasCapabilityModuleEnabled(cloudOnly, 'comfyui')).toBe(false);
    expect(canvasToolVisible('comfyUiWorkflow', cloudOnly)).toBe(false);
    expect(canvasToolVisible('comfyUiWorkflow', disabledLocal)).toBe(false);
    expect(canvasToolVisible('imageGenerator', cloudOnly)).toBe(true);
  });

  it('reveals the local workflow affordance only after a ComfyUI model is enabled', () => {
    const configured = [{ adapter: 'comfyui-native-image', enabled: true }];

    expect(canvasCapabilityModuleEnabled(configured, 'comfyui')).toBe(true);
    expect(canvasToolVisible('comfyUiWorkflow', configured)).toBe(true);
  });
});
