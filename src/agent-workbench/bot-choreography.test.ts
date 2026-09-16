import { describe, expect, it } from 'vitest';
import { BOT_GESTURES, botGesture } from './bot-choreography';
import type { BotPose } from './living-state';

describe('HEIYAN causal choreography', () => {
  it('covers every truthful pose with finite, bounded, returning keyframes', () => {
    const poses: BotPose[] = ['idle','processing','thinking','reading','executing','waiting','reviewing','question','approval','done','error','offline'];
    expect(Object.keys(BOT_GESTURES).sort()).toEqual([...poses].sort());
    for (const pose of poses) {
      const value = botGesture(pose);
      expect(value.x.length).toBe(value.y.length); expect(value.y.length).toBe(value.rotate.length); expect(value.times.length).toBe(value.x.length);
      expect(value.times[0]).toBe(0); expect(value.times.at(-1)).toBe(1); expect(value.duration).toBeLessThanOrEqual(.62);
      expect([...value.x, ...value.y, ...value.rotate, ...value.times, value.duration].every(Number.isFinite)).toBe(true);
      expect(Math.max(...value.x.map(Math.abs), ...value.y.map(Math.abs))).toBeLessThanOrEqual(4.2);
    }
  });
  it('makes completion and failure noticeably different without a looping performance', () => {
    expect(botGesture('done').y).toContain(-4.2);
    expect(botGesture('error').x.length).toBeGreaterThan(botGesture('done').x.length);
    expect(botGesture('thinking')).not.toEqual(botGesture('executing'));
  });
});

