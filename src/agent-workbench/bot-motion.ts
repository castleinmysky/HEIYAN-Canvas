import type { BotPose } from './living-state';

// Local, bounded SVG geometry. No model calls, canvas writes or layout dimensions.
export type BotLookTarget = { x: number; y: number; active: boolean };
export type BotFace = { leftW: number; leftH: number; rightW: number; rightH: number; leftTilt: number; rightTilt: number; smile: number; gazeX: number; gazeY: number; lean: number; crown: number; cheek: number; upper: number; lower: number; chin: number; spread: number; yaw: number; pitch: number; squash: number };
const base: BotFace = { leftW: 7.2, leftH: 13.8, rightW: 7.2, rightH: 13.8, leftTilt: 0, rightTilt: 0, smile: 0, gazeX: 0, gazeY: 0, lean: 0, crown: 0, cheek: 0, upper: 0, lower: 0, chin: 0, spread: 15.4, yaw: 0, pitch: 0, squash: 0 };
export const BOT_FACES: Record<BotPose, BotFace> = {
  idle: { ...base },
  // State identity comes from a distinct silhouette + a small semantic module, not
  // from distorting the same face until it looks like another character.
  processing: { ...base, leftW: 7.3, rightW: 7.3, leftH: 12.6, rightH: 12.6, gazeX: -.4, gazeY: -.35, lean: -.8, crown: .35, cheek: .15, chin: .2, spread: 15.2, yaw: -1, pitch: -1 },
  thinking: { ...base, gazeY: -1.5, crown: 1.8, lean: -3, pitch: -2, squash: -.01 },
  reading: { ...base, leftW: 6.8, rightW: 6.8, leftH: 9.6, rightH: 9.6, gazeX: -2.2, gazeY: -6.2, lean: 2, crown: .3, spread: 15.4, yaw: -3, pitch: -1 },
  executing: { ...base, leftW: 6.8, rightW: 6.8, leftH: 12.8, rightH: 12.8, gazeX: 1.4, gazeY: -.6, lean: 2.5, crown: .6, cheek: -.2, chin: .4, spread: 14.8, yaw: 2, pitch: -1 },
  waiting: { ...base, leftW: 7.4, rightW: 7.4, leftH: 3.6, rightH: 3.6, gazeY: 1.5, crown: .2, cheek: .1, lower: .5, pitch: 2 },
  reviewing: { ...base, leftW: 7.2, rightW: 7.2, leftH: 12.8, rightH: 12.8, gazeX: 2.2, gazeY: -1, lean: 2, crown: .5, spread: 15.5, yaw: 3, pitch: -1 },
  question: { ...base, leftW: 8.6, rightW: 8.6, leftH: 14.4, rightH: 14.4, lean: -3, gazeX: 2.2, gazeY: -2.6, crown: 1, cheek: .4, spread: 16, yaw: -2, pitch: -2 },
  approval: { ...base, leftW: 9, rightW: 9, leftH: 14.2, rightH: 14.2, gazeY: -.8, crown: .7, cheek: .4, spread: 16, pitch: -1 },
  done: { ...base, leftW: 10, rightW: 10, leftH: 3, rightH: 3, smile: 5, gazeY: -1.4, crown: 1, cheek: .5, spread: 16, pitch: -2 },
  error: { ...base, leftW: 7.4, rightW: 7.4, leftH: 5.4, rightH: 5.4, leftTilt: 12, rightTilt: -12, gazeY: .5, crown: -.4, cheek: -.4, spread: 15.8, pitch: 1 },
  offline: { ...base, leftW: 9, rightW: 9, leftH: 2.7, rightH: 2.7, smile: -1.4, gazeY: .8, lean: -4.2, crown: -.35, cheek: -.15, lower: .3, chin: .6, spread: 15.2, yaw: -2, pitch: 2, squash: .008 },
};
const number = (v: number) => Number(v.toFixed(3));
// Compatible cubic commands across poses: morph geometry without replacing nodes.
export function botEyePath(width: number, height: number, smile = 0) {
  const x = width / 2, y = height / 2, c = .72, n = number;
  return `M${n(-x)} 0C${n(-x)} ${n(-y - smile)} ${n(x)} ${n(-y - smile)} ${n(x)} 0C${n(x)} ${n(y * c)} ${n(x * c)} ${n(y)} 0 ${n(y - smile)}C${n(-x * c)} ${n(y)} ${n(-x)} ${n(y * c)} ${n(-x)} 0Z`;
}
export function botShellPath(face: BotFace) {
  const yaw = Math.max(-1, Math.min(1, face.yaw / 20));
  const top = number(8 - face.crown + face.pitch * .12), side = number(face.cheek), center = number(32 + face.yaw * .12), bottom = number(56 - face.squash * 22 + face.chin);
  // The far side tucks inward while the near side keeps its volume. This reads as a head turn,
  // rather than translating a flat face across a circular plate.
  const left = number(8 - side + Math.max(0, yaw) * 1.5 + Math.min(0, yaw) * .25);
  const right = number(56 + side + Math.min(0, yaw) * 1.5 + Math.max(0, yaw) * .25);
  const topLeft = number(17 - face.upper + face.yaw * .1 + Math.max(0, yaw) * 1.4);
  const topRight = number(47 + face.upper + face.yaw * .1 + Math.min(0, yaw) * 1.4);
  const bottomLeft = number(18 - face.lower + face.yaw * .055 + Math.max(0, yaw) * .8);
  const bottomRight = number(46 + face.lower + face.yaw * .055 + Math.min(0, yaw) * .8);
  return `M${center} ${top}C${topRight} ${top} ${right} 18 ${right} 32C${right} 47 ${bottomRight} ${bottom} ${center} ${bottom}C${bottomLeft} ${bottom} ${left} 46 ${left} 32C${left} 18 ${topLeft} ${top} ${center} ${top}Z`;
}
export function botBodyTransform(face: BotFace) {
  const scaleX = number(1 + face.squash - Math.abs(face.yaw) * .0025), scaleY = number(1 - face.squash);
  return `translate(32 34) rotate(${number(face.lean)}) skewY(${number(face.yaw * .16)}) scale(${scaleX} ${scaleY}) translate(-32 -34)`;
}
export function botFeatureTransform(face: BotFace) {
  const x = number(face.gazeX + face.yaw * .19), y = number(face.gazeY + face.pitch * .11);
  const scaleX = number(1 - Math.abs(face.yaw) * .0085), scaleY = number(1 + face.pitch * .004);
  // Perspective must pivot around the face plane, otherwise scale/skew looks like a sliding decal.
  return `translate(32,31) translate(${x},${y}) rotate(${number(face.yaw * .08)}) skewY(${number(face.yaw * -.1)}) scale(${scaleX},${scaleY}) translate(-32,-31)`;
}
export function botEyeTransform(face: BotFace, side: 'left' | 'right') {
  const center = side === 'left' ? 32 - face.spread / 2 : 32 + face.spread / 2;
  const tilt = side === 'left' ? face.leftTilt : face.rightTilt;
  return `translate(${number(center)},31) rotate(${number(tilt)})`;
}
export function botSpecularGeometry(face: BotFace) {
  return {
    cx: number(22 + face.yaw * .38), cy: number(18 + face.pitch * .18),
    rx: number(10.5 - Math.abs(face.yaw) * .08), ry: number(5.2 - face.pitch * .025),
    rotate: number(face.yaw * .22),
  };
}
export function botFaceWithTarget(face: BotFace, target?: BotLookTarget): BotFace {
  if (!target?.active) return face;
  const x = Math.max(-1, Math.min(1, target.x)), y = Math.max(-1, Math.min(1, target.y));
  return { ...face, gazeX: face.gazeX + x * 4, gazeY: face.gazeY + y * 3,
    yaw: face.yaw + x * 15, pitch: face.pitch + y * 7, lean: face.lean + x * 2.5,
    leftW: face.leftW * (1 - x * .07), rightW: face.rightW * (1 + x * .07) };
}
export function mixBotFace(from: BotFace, to: BotFace, progress: number): BotFace {
  const t = Math.min(1, Math.max(0, progress));
  if (t === 0) return from;
  if (t === 1) return to;
  return Object.fromEntries(Object.keys(from).map(key => [key, from[key as keyof BotFace] + (to[key as keyof BotFace] - from[key as keyof BotFace]) * t])) as BotFace;
}
export const BOT_MORPH_MS = 420;
export const BOT_COMPLETION_MS = 900;
const working = new Set<BotPose>(['processing', 'reading', 'thinking', 'executing', 'reviewing', 'waiting']);
export type BotMotionState = { scope: string; pose: BotPose; armed: boolean; until: number; sequence: number };
export function initialBotMotion(scope: string, pose: BotPose): BotMotionState {
  return { scope, pose, armed: false, until: 0, sequence: 0 };
}
export function advanceBotMotion(previous: BotMotionState, scope: string, pose: BotPose, visible: boolean, now: number, eligible = true): BotMotionState {
  const before = previous.scope === scope ? previous : initialBotMotion(scope, pose);
  const celebrate = visible && eligible && before.armed && before.pose !== 'done' && pose === 'done';
  const until = !visible || !eligible || pose !== 'done' ? 0 : celebrate ? now + BOT_COMPLETION_MS : before.until;
  return { scope, pose, until, sequence: before.sequence + Number(celebrate),
    armed: visible && eligible && (working.has(pose) || before.armed && ['question', 'approval'].includes(pose)) };
}
export function botExpression(state: BotMotionState, now: number): BotPose {
  return state.pose === 'done' && state.until <= now ? 'idle' : state.pose;
}

