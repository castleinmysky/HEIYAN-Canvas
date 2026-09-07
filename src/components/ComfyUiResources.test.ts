import { describe, expect, it } from 'vitest';
import { comfyUiSetupStage } from './ComfyUiResources';

describe('ComfyUI first-run setup stage', () => {
  it('distinguishes no runtime, an empty runtime, and a configured capability', () => {
    expect(comfyUiSetupStage({ available: false, models: [] })).toBe('offline');
    expect(comfyUiSetupStage({ available: true, models: [] })).toBe('discovered');
    expect(comfyUiSetupStage({ available: true, models: [{ id: 'local' } as never] })).toBe('configured');
  });
});
