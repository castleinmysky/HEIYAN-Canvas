import type { BotPose } from './living-state';

export type BotGesture = { x: number[]; y: number[]; rotate: number[]; times: number[]; duration: number };

// Finite transition gestures only. Long-running truth stays in the pose and expression.
// Character direction: observant, decisive and restrained. It acknowledges work,
// commits to action, double-checks uncertainty and never performs fake busyness.
export const BOT_GESTURES: Record<BotPose, BotGesture> = {
  idle: { x: [0, 0], y: [0, 0], rotate: [0, 0], times: [0, 1], duration: .18 },
  processing: { x: [0, -.7, .5, 0], y: [0, -1.8, -.8, 0], rotate: [0, -2.2, 1.1, 0], times: [0, .22, .55, 1], duration: .56 },
  thinking: { x: [0, -1, 0], y: [0, -1.4, 0], rotate: [0, -3, 0], times: [0, .5, 1], duration: .44 },
  reading: { x: [0, -2.4, 0], y: [0, -.5, 0], rotate: [0, -2.5, 0], times: [0, .44, 1], duration: .38 },
  executing: { x: [0, 2.8, 0], y: [0, -.8, 0], rotate: [0, 1.6, 0], times: [0, .32, 1], duration: .3 },
  waiting: { x: [0, 0], y: [0, 1], rotate: [0, 0], times: [0, 1], duration: .28 },
  reviewing: { x: [0, -2.2, 1.8, -1, 0], y: [0, -.7, -.7, -.4, 0], rotate: [0, -2.4, 1.8, -1, 0], times: [0, .24, .52, .76, 1], duration: .62 },
  question: { x: [0, .8, 0], y: [0, -2.6, 0], rotate: [0, -3, 0], times: [0, .5, 1], duration: .42 },
  approval: { x: [0, 0, 0], y: [0, -1.2, 0], rotate: [0, 0, 0], times: [0, .42, 1], duration: .34 },
  done: { x: [0, 0, 0], y: [0, -4.2, 0], rotate: [0, -3, 0], times: [0, .4, 1], duration: .5 },
  error: { x: [0, -2.4, .9, 0], y: [0, .6, .2, 0], rotate: [0, -3, 1, 0], times: [0, .24, .62, 1], duration: .46 },
  offline: { x: [0, -.8, 0], y: [0, 1.2, 0], rotate: [0, -3, 0], times: [0, .55, 1], duration: .5 },
};

export function botGesture(pose: BotPose) { return BOT_GESTURES[pose]; }

