import { useEffect, useState, type RefObject } from 'react';
import type { BotLookTarget } from './bot-motion';

type Bounds = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
export type BotTargetCue = 'selected' | 'observe' | 'act' | 'result' | 'error';
export const NO_BOT_LOOK: BotLookTarget = { x: 0, y: 0, active: false };
export function botLookVector(bot: Bounds, node: Bounds, viewport = { width: window.innerWidth, height: window.innerHeight }): BotLookTarget {
  const dx = node.left + node.width / 2 - (bot.left + bot.width / 2);
  const dy = node.top + node.height / 2 - (bot.top + bot.height / 2);
  return { x: Math.max(-1, Math.min(1, dx / Math.max(180, viewport.width * .34))),
    y: Math.max(-1, Math.min(1, dy / Math.max(140, viewport.height * .34))), active: true };
}
export function botLookVectorMany(bot: Bounds, nodes: readonly Bounds[], viewport = { width: window.innerWidth, height: window.innerHeight }): BotLookTarget {
  if (!nodes.length) return NO_BOT_LOOK;
  const center = nodes.reduce((value, node) => ({
    left: value.left + node.left + node.width / 2,
    top: value.top + node.top + node.height / 2,
  }), { left: 0, top: 0 });
  return botLookVector(bot, { left: center.left / nodes.length, top: center.top / nodes.length, width: 0, height: 0 }, viewport);
}
/** Four low-frequency geometry reads per second while a real node is targeted. */
export function useBotNodeLook(dock: RefObject<HTMLElement | null>, nodeIds: readonly string[], enabled: boolean, cue: BotTargetCue = 'selected') {
  const [target, setTarget] = useState<BotLookTarget>(NO_BOT_LOOK);
  useEffect(() => {
    const ids = [...new Set(nodeIds.filter(Boolean))];
    if (!enabled || !ids.length) { setTarget(NO_BOT_LOOK); return; }
    let marked: HTMLElement[] = [];
    const update = () => {
      if (document.hidden) return;
      const bot = dock.current?.querySelector<HTMLElement>('.heiyan-bot');
      const nodes = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].filter(element => ids.includes(element.dataset.id || ''));
      for (const node of marked) if (!nodes.includes(node)) delete node.dataset.heiyanBotTarget;
      marked = nodes;
      for (const node of nodes) node.dataset.heiyanBotTarget = cue;
      if (!bot || !nodes.length) { setTarget(current => current.active ? NO_BOT_LOOK : current); return; }
      const next = botLookVectorMany(bot.getBoundingClientRect(), nodes.map(node => node.getBoundingClientRect()));
      setTarget(current => Math.abs(current.x - next.x) < .02 && Math.abs(current.y - next.y) < .02 && current.active ? current : next);
    };
    update(); const timer = window.setInterval(update, 250);
    window.addEventListener('resize', update); document.addEventListener('visibilitychange', update);
    return () => { for (const node of marked) delete node.dataset.heiyanBotTarget; window.clearInterval(timer); window.removeEventListener('resize', update); document.removeEventListener('visibilitychange', update); };
  }, [dock, nodeIds.join('\u0001'), enabled, cue]);
  return target;
}

