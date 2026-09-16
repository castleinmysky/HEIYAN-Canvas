import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animate } from 'motion';
import { BOT_FACES, BOT_MORPH_MS, botBodyTransform, botEyePath, botEyeTransform, botFaceWithTarget, botFeatureTransform, botShellPath, botSpecularGeometry, mixBotFace, type BotFace, type BotLookTarget } from './bot-motion';
import type { BotPose } from './living-state';

/** At most one finite RAF transition per avatar; no React render per frame. */
export function useBotMorph(svg: RefObject<SVGSVGElement | null>, pose: BotPose, paused: boolean, lookTarget?: BotLookTarget) {
  const current = useRef<BotFace>(BOT_FACES[pose]);
  useLayoutEffect(() => {
    const root = svg.current;
    if (!root) return;
    const shell = root.querySelector('.heiyan-bot-shell'), shade = root.querySelector('.heiyan-bot-shell-shade'), clip = root.querySelector('.heiyan-bot-clip'), specular = root.querySelector('.heiyan-bot-specular'), gaze = root.querySelector('.heiyan-bot-gaze'), body = root.querySelector('.heiyan-bot-body'), light = root.querySelector('.heiyan-bot-light'), depth = root.querySelector('.heiyan-bot-depth');
    const left = root.querySelector('.heiyan-bot-eye-left'), right = root.querySelector('.heiyan-bot-eye-right');
    const write = (face: BotFace) => {
      current.current = face;
      shell?.setAttribute('d', botShellPath(face));
      shade?.setAttribute('d', botShellPath(face));
      clip?.setAttribute('d', botShellPath(face));
      const glint = botSpecularGeometry(face);
      specular?.setAttribute('cx', String(glint.cx)); specular?.setAttribute('cy', String(glint.cy));
      specular?.setAttribute('rx', String(glint.rx)); specular?.setAttribute('ry', String(glint.ry));
      specular?.setAttribute('transform', `rotate(${glint.rotate} ${glint.cx} ${glint.cy})`);
      left?.setAttribute('d', botEyePath(face.leftW, face.leftH, face.smile));
      right?.setAttribute('d', botEyePath(face.rightW, face.rightH, face.smile));
      left?.setAttribute('transform', botEyeTransform(face, 'left'));
      right?.setAttribute('transform', botEyeTransform(face, 'right'));
      gaze?.setAttribute('transform', botFeatureTransform(face));
      body?.setAttribute('transform', botBodyTransform(face));
      light?.setAttribute('cx', `${30 + face.yaw * .85}%`);
      light?.setAttribute('cy', `${22 + face.pitch * .55}%`);
      depth?.setAttribute('cx', `${76 - face.yaw * .72}%`);
      depth?.setAttribute('cy', `${70 - face.pitch * .35}%`);
    };
    const target = botFaceWithTarget(BOT_FACES[pose], lookTarget), from = current.current;
    if (paused || from === target) { write(target); root.dataset.morphing = 'false'; return; }
    root.dataset.morphing = 'true';
    const controls = animate(0, 1, { duration: BOT_MORPH_MS / 1000, ease: [0.16, 1, 0.3, 1],
      onUpdate: progress => write(mixBotFace(from, target, progress)), onComplete: () => { root.dataset.morphing = 'false'; } });
    return () => { controls.stop(); root.dataset.morphing = 'false'; };
  }, [svg, pose, paused, lookTarget?.active, lookTarget?.x, lookTarget?.y]);
}

