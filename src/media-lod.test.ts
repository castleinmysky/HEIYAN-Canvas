import { describe, expect, it } from 'vitest';
import { canvasMediaLodCacheKey, canvasMediaLodLevelForZoom } from './media-lod';

describe('canvas media LOD', () => {
  it('uses hysteresis so wheel zoom does not flicker between sources', () => {
    expect(canvasMediaLodLevelForZoom(0.45, 'high')).toBe('low');
    expect(canvasMediaLodLevelForZoom(0.55, 'low')).toBe('low');
    expect(canvasMediaLodLevelForZoom(0.69, 'low')).toBe('high');
    expect(canvasMediaLodLevelForZoom(0.55, 'high')).toBe('high');
  });

  it('creates stable source-specific persistent cache keys', () => {
    const first = canvasMediaLodCacheKey('/media/assets/a.png', 'http://127.0.0.1:8792');
    expect(first).toBe(canvasMediaLodCacheKey('/media/assets/a.png', 'http://127.0.0.1:8792'));
    expect(first).not.toBe(canvasMediaLodCacheKey('/media/assets/b.png', 'http://127.0.0.1:8792'));
  });
});
