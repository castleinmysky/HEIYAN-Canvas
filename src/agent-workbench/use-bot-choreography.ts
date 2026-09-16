import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animate } from 'motion';
import { botGesture } from './bot-choreography';
import type { BotPose } from './living-state';

/** One bounded gesture for each real runtime transition/event; never invents progress. */
export function useBotChoreography(svg: RefObject<SVGSVGElement | null>, pose: BotPose, eventKey: string, paused: boolean) {
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const gesture = svg.current?.querySelector<SVGGElement>('.heiyan-bot-gesture');
    if (!gesture) return;
    if (!mounted.current) { mounted.current = true; return; }
    if (paused) { gesture.style.removeProperty('transform'); return; }
    const keyframes = botGesture(pose);
    const controls = animate(gesture, { x: keyframes.x, y: keyframes.y, rotate: keyframes.rotate }, {
      duration: keyframes.duration, times: keyframes.times, ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [svg, pose, eventKey, paused]);
}

