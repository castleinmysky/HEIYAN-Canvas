import { describe, expect, it } from 'vitest';
import { BOT_FACES, advanceBotMotion, botBodyTransform, botExpression, botEyePath, botFaceWithTarget, botFeatureTransform, botShellPath, initialBotMotion, mixBotFace } from './bot-motion';
import type { BotPose } from './living-state';

describe('HEIYAN vector motion', () => {
  it('provides finite distinct geometry for every real pose with compatible path commands', () => {
    const paths = new Set<string>();
    for (const face of Object.values(BOT_FACES)) {
      expect(Object.values(face).every(Number.isFinite)).toBe(true);
      const eye = botEyePath(face.leftW, face.leftH, face.smile);
      expect(eye.match(/[A-Za-z]/g)?.join('')).toBe('MCCCZ');
      expect(botShellPath(face).match(/[A-Za-z]/g)?.join('')).toBe('MCCCCZ');
      expect(face.leftW).toBeGreaterThan(4);
      expect(Math.abs(face.lean)).toBeLessThanOrEqual(12);
      expect(botBodyTransform(face)).not.toContain('NaN');
      expect(botFeatureTransform(face)).not.toContain('NaN');
      paths.add(JSON.stringify(face));
    }
    expect(paths.size).toBe(Object.keys(BOT_FACES).length);
  });
  it('turns the vector head and asymmetric expression toward a bounded real target', () => {
    const left = botFaceWithTarget(BOT_FACES.executing, { x: -1, y: -.8, active: true });
    const right = botFaceWithTarget(BOT_FACES.executing, { x: 1, y: .8, active: true });
    expect(left.yaw).toBeLessThan(right.yaw); expect(left.pitch).toBeLessThan(right.pitch);
    expect(left.leftW).toBeGreaterThan(left.rightW); expect(right.rightW).toBeGreaterThan(right.leftW);
    expect(botFeatureTransform(left)).not.toBe(botFeatureTransform(right));
    expect(botShellPath(left)).not.toBe(botShellPath(right));
    expect(botFaceWithTarget(BOT_FACES.idle, { x: 9, y: -9, active: true }).yaw).toBe(15);
    expect(botFaceWithTarget(BOT_FACES.idle, { x: 0, y: 0, active: false })).toBe(BOT_FACES.idle);
  });
  it('interpolates from the current geometry and clamps overshoot', () => {
    const from = BOT_FACES.reading, to = BOT_FACES.question;
    expect(mixBotFace(from, to, 0)).toEqual(from);
    expect(mixBotFace(from, to, 1)).toEqual(to);
    expect(mixBotFace(from, to, 5)).toEqual(to);
    const midway = mixBotFace(from, to, .5);
    expect(midway.leftW).toBe((from.leftW + to.leftW) / 2);
    expect(mixBotFace(midway, BOT_FACES.error, 0)).toEqual(midway);
  });
  it('does not celebrate a restored completed snapshot', () => {
    const state = advanceBotMotion(initialBotMotion('a', 'done'), 'a', 'done', true, 1000);
    expect(state.sequence).toBe(0); expect(botExpression(state, 1000)).toBe('idle');
  });
  it('celebrates once at a real work-to-done edge then settles without changing business pose', () => {
    let state = advanceBotMotion(initialBotMotion('a', 'idle'), 'a', 'executing', true, 1000);
    state = advanceBotMotion(state, 'a', 'done', true, 1200);
    expect(state.sequence).toBe(1); expect(botExpression(state, 1250)).toBe('done');
    state = advanceBotMotion(state, 'a', 'done', true, 1500);
    expect(state.sequence).toBe(1); expect(state.until).toBe(2100);
    expect(botExpression(state, 2200)).toBe('idle'); expect(state.pose).toBe('done');
  });
  it('allows a new work cycle but never rearms on approval alone, error, idle, or reconnect', () => {
    for (const interruption of ['error','offline','idle'] as BotPose[]) {
      let state = advanceBotMotion(initialBotMotion('a','idle'), 'a', 'reading', true, 10);
      state = advanceBotMotion(state, 'a', interruption, true, 20);
      expect(botExpression(state, 20)).toBe(interruption);
      state = advanceBotMotion(state, 'a', 'done', true, 30);
      expect(state.sequence).toBe(0);
    }
    let state = advanceBotMotion(initialBotMotion('a','idle'), 'a', 'approval', true, 10);
    state = advanceBotMotion(state, 'a', 'done', true, 20); expect(state.sequence).toBe(0);
    state = advanceBotMotion(state, 'a', 'thinking', true, 30);
    state = advanceBotMotion(state, 'a', 'question', true, 40);
    state = advanceBotMotion(state, 'a', 'done', true, 50); expect(state.sequence).toBe(1);
  });
  it('never replays hidden completions or carries success across canvases', () => {
    let state = advanceBotMotion(initialBotMotion('a','idle'), 'a', 'executing', true, 10);
    state = advanceBotMotion(state, 'a', 'done', false, 20);
    state = advanceBotMotion(state, 'a', 'done', true, 30); expect(state.sequence).toBe(0);
    state = advanceBotMotion(state, 'a', 'executing', true, 40);
    state = advanceBotMotion(state, 'b', 'done', true, 50); expect(state.sequence).toBe(0);
  });
  it('does not confuse reconnect processing with an observed task run', () => {
    let state = advanceBotMotion(initialBotMotion('a','offline'), 'a', 'processing', true, 10, false);
    state = advanceBotMotion(state, 'a', 'done', true, 20, true);
    expect(state.sequence).toBe(0); expect(botExpression(state, 20)).toBe('idle');
  });
});

