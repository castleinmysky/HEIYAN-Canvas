import { describe, expect, it } from 'vitest';
import { botLookVector, botLookVectorMany } from './use-bot-node-look';
describe('Bot node gaze', () => {
  it('points toward real screen geometry and clamps distant nodes', () => {
    const bot = { left: 480, top: 720, width: 64, height: 64 };
    const viewport = { width: 1000, height: 800 };
    expect(botLookVector(bot, { left: 80, top: 80, width: 120, height: 80 }, viewport)).toMatchObject({ x: -1, y: -1, active: true });
    const right = botLookVector(bot, { left: 680, top: 520, width: 100, height: 80 }, viewport);
    expect(right.x).toBeGreaterThan(0); expect(right.y).toBeLessThan(0);
  });
  it('looks at the centroid of several real target nodes without cycling between them', () => {
    const bot = { left: 480, top: 720, width: 64, height: 64 };
    const viewport = { width: 1000, height: 800 };
    const target = botLookVectorMany(bot, [
      { left: 100, top: 100, width: 100, height: 100 },
      { left: 700, top: 100, width: 100, height: 100 },
    ], viewport);
    expect(Math.abs(target.x)).toBeLessThan(.3); expect(target.y).toBe(-1); expect(target.active).toBe(true);
    expect(botLookVectorMany(bot, [], viewport)).toEqual({ x: 0, y: 0, active: false });
  });
});

