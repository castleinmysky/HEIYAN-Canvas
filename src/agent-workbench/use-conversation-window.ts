import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { AgentMessage } from './agent-session';

export const CHAT_WINDOW = 60;
export const shouldPauseFollowing = (following: boolean, bottom: boolean, userScrolled: boolean) => !bottom && (!following || userScrolled);
export function messageWindow(total: number, start: number | null) {
  const from = start === null ? Math.max(0, total - CHAT_WINDOW) : Math.max(0, Math.min(start, Math.max(0, total - 1)));
  return { from, to: Math.min(total, from + CHAT_WINDOW) };
}
// Bounded, explicit pages: no giant spacer, no growing DOM or scroll range.
// The archive is never deleted, and source-message navigation loads its page.
export function useConversationWindow(messages: AgentMessage[], element: RefObject<HTMLElement | null>, scope: string) {
  const [start, setStart] = useState<number | null>(null), [away, setAway] = useState(false);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const following = useRef(true), jump = useRef<{ kind: 'latest' | 'top' | 'message'; id?: string } | null>(null);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const scrollIntentUntil = useRef(0);
  const [jumpVersion, setJumpVersion] = useState(0);
  const range = messageWindow(messages.length, start);
  const latest = () => { scrollIntentUntil.current = 0; following.current = true; anchor.current = null; setFocusTarget(null); setAway(false); setStart(null); jump.current = { kind: 'latest' }; setJumpVersion(v => v + 1); };
  useEffect(latest, [scope]);
  useEffect(() => {
    const el = element.current; if (!el) return;
    const intent = () => { scrollIntentUntil.current = performance.now() + 800; };
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) intent(); };
    const key = (event: KeyboardEvent) => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) intent(); };
    const pointer = (event: globalThis.PointerEvent) => { if (event.target === el) intent(); };
    el.addEventListener('wheel', wheel, { passive: true }); el.addEventListener('touchmove', intent, { passive: true });
    el.addEventListener('keydown', key); el.addEventListener('pointerdown', pointer);
    return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('touchmove', intent); el.removeEventListener('keydown', key); el.removeEventListener('pointerdown', pointer); };
  }, [element]);
  const page = (next: number) => {
    following.current = false; anchor.current = null; setFocusTarget(null); setAway(true); setStart(next); jump.current = { kind: 'top' }; setJumpVersion(v => v + 1);
  };
  const focus = (id: string) => {
    const index = messages.findIndex(m => m.id === id); if (index < 0) return;
    following.current = false; anchor.current = null; setFocusTarget(id); setAway(true); setStart(Math.max(0, index - 10)); jump.current = { kind: 'message', id }; setJumpVersion(v => v + 1);
  };
  const onScroll = () => {
    const el = element.current; if (!el || !el.clientHeight) return;
    const bottom = range.to === messages.length && el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    // Layout growth, image loading and programmatic anchor adjustments emit
    // scroll too. They are not evidence the reader chose to leave the bottom.
    if (following.current && shouldPauseFollowing(true, bottom, performance.now() < scrollIntentUntil.current) === false && !bottom) return;
    following.current = bottom; setAway(!bottom);
    if (bottom) { anchor.current = null; if (start !== null && range.to === messages.length) setStart(null); }
    else {
      if (start === null) setStart(range.from);
      const top = el.getBoundingClientRect().top;
      const first = [...el.querySelectorAll<HTMLElement>('.canvas-agent-message')].find(e => e.getBoundingClientRect().bottom > top);
      anchor.current = first ? { id: first.id, offset: first.getBoundingClientRect().top - top } : null;
    }
  };
  useLayoutEffect(() => {
    const el = element.current; if (!el) return;
    const action = jump.current;
    if (action) {
      if (action.kind === 'latest') el.scrollTop = el.scrollHeight;
      else if (action.kind === 'top') el.scrollTop = 0;
      else {
        const target = document.getElementById('agent-message-' + action.id);
        if (!target) return; // A collapsed process group may open next frame.
        el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight / 3;
        target.focus({ preventScroll: true });
      }
      jump.current = null;
    } else if (following.current) el.scrollTop = el.scrollHeight;
    else if (anchor.current) {
      const target = document.getElementById(anchor.current.id);
      if (target) el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.current.offset;
    }
  }, [messages, range.from, range.to, jumpVersion]);
  useEffect(() => {
    const el = element.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (following.current) el.scrollTop = el.scrollHeight; });
    // Images/markdown can change height after the first commit.
    observer.observe(el); for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [messages, range.from, range.to]);
  const visible = useMemo(() => messages.slice(range.from, range.to), [messages, range.from, range.to]);
  return { ...range, messages: visible, focusTarget, away, onScroll, latest, focus,
    older: () => page(Math.max(0, range.from - CHAT_WINDOW)), newer: () => range.to + CHAT_WINDOW >= messages.length ? latest() : page(range.to) };
}
