import { describe, expect, it } from 'vitest';
// @ts-expect-error JavaScript backend adapters are runtime-tested by Vitest.
import { minimaxH3RequestBody } from '../local-bridge/engine/server/adapters/minimax-h3-video.js';

describe('MiniMax-H3 request body', () => {
  it('uses a concrete ratio for text-to-video when Auto is selected', () => {
    const body = minimaxH3RequestBody({ model: 'MiniMax-H3', prompt: 'A cinematic city', options: { ratio: 'Auto', resolution: '2K', duration: 5 } });
    expect(body.ratio).toBe('9:16');
    expect(body.aigc_watermark).toBe(false);
    expect(body.content).toEqual([{ type: 'text', text: 'A cinematic city' }]);
  });

  it('uses adaptive ratio for first and last frame mode', () => {
    const body = minimaxH3RequestBody({
      model: 'MiniMax-H3', prompt: 'Animate this scene', options: { ratio: '16:9', resolution: '768P', duration: 5 },
      inputs: [{ port: 'first_frame', type: 'image', value: 'https://example.com/first.png' }, { port: 'last_frame', type: 'image', value: 'https://example.com/last.png' }],
    });
    expect(body.ratio).toBe('adaptive');
    expect(body.content.map((item: { role?: string }) => item.role)).toEqual([undefined, 'first_frame', 'last_frame']);
  });

  it('keeps three reference videos and an adaptive reference ratio', () => {
    const body = minimaxH3RequestBody({
      model: 'MiniMax-H3', prompt: 'Use the references', options: { ratio: 'Auto', resolution: '2K', duration: 5 },
      inputs: [1, 2, 3].map((index) => ({ port: 'reference', type: 'video', value: `https://example.com/${index}.mp4` })),
    });
    expect(body.ratio).toBe('adaptive');
    expect(body.content.filter((item: { role?: string }) => item.role === 'reference_video')).toHaveLength(3);
  });
});
