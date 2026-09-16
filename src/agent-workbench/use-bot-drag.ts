import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent } from 'react';
import { BOT_DRAG_THRESHOLD, botDockTarget, effectiveBotDockPlacement, type BotDockPlacement } from './bot-docking';

export type BotDragButtonProps = Pick<ButtonHTMLAttributes<HTMLButtonElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onKeyDown' | 'onClickCapture'>;

type DragSession = {
  pointerId: number;
  element: HTMLButtonElement;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

type DragState = {
  dragging: boolean;
  target: BotDockPlacement | null;
  offset: { x: number; y: number };
  point: { x: number; y: number } | null;
};

export type BotDragDrop = { placement: BotDockPlacement | null; point: { x: number; y: number } | null };

const idleDrag: DragState = { dragging: false, target: null, offset: { x: 0, y: 0 }, point: null };

function dragPoint(active: DragSession, clientX: number, clientY: number) {
  return { x: active.originX + clientX - active.startX, y: active.originY + clientY - active.startY };
}

function pointerTarget(element: HTMLButtonElement, point: { x: number; y: number }) {
  const viewport = element.ownerDocument.defaultView;
  return botDockTarget({ ...point, width: viewport?.innerWidth ?? 0, height: viewport?.innerHeight ?? 0 });
}

/** Spread buttonProps onto the Bot button; keep its ordinary onClick unchanged. */
export function useBotDrag(enabled: boolean, onDrop: (drop: BotDragDrop) => void) {
  const [state, setState] = useState<DragState>(idleDrag);
  const session = useRef<DragSession | null>(null);
  const suppressClick = useRef(false);
  const enabledRef = useRef(enabled);
  const onDropRef = useRef(onDrop);

  const finish = useCallback((updateState = true) => {
    const active = session.current;
    if (!active) return null;
    // Clear the session before releasing capture: lostpointercapture must not finish twice.
    session.current = null;
    if (active.moved) suppressClick.current = true;
    try {
      if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    } catch { /* Capture can already be gone when the button leaves the document. */ }
    if (updateState) setState(idleDrag);
    return active;
  }, []);

  useLayoutEffect(() => {
    enabledRef.current = enabled;
    onDropRef.current = onDrop;
    if (!enabled) finish();
  }, [enabled, onDrop, finish]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const cancel = () => { finish(); };
    const visibility = () => { if (document.visibilityState === 'hidden') cancel(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !session.current) return;
      if (session.current.moved) {
        event.preventDefault();
        event.stopPropagation();
      }
      cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    window.addEventListener('keydown', escape, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('keydown', escape, true);
      document.removeEventListener('visibilitychange', visibility);
      finish(false);
    };
  }, [enabled, finish]);

  const buttonProps: BotDragButtonProps = {
    onPointerDown(event) {
      if (!enabledRef.current || event.button !== 0 || !event.isPrimary || session.current) return;
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      suppressClick.current = false;
      const rect = event.currentTarget.getBoundingClientRect();
      session.current = { pointerId: event.pointerId, element: event.currentTarget, startX: event.clientX, startY: event.clientY, originX: rect.left + rect.width / 2, originY: rect.top + rect.height / 2, moved: false };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        finish();
      }
    },
    onPointerMove(event) {
      const active = session.current;
      if (!active || active.pointerId !== event.pointerId) return;
      if (!enabledRef.current || !(event.buttons & 1) || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
        finish();
        return;
      }
      const offset = { x: event.clientX - active.startX, y: event.clientY - active.startY };
      if (!active.moved && Math.hypot(offset.x, offset.y) < BOT_DRAG_THRESHOLD) return;
      active.moved = true;
      event.preventDefault();
      event.stopPropagation();
      const point = dragPoint(active, event.clientX, event.clientY);
      setState({ dragging: true, target: pointerTarget(active.element, point), offset, point });
    },
    onPointerUp(event) {
      const active = session.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const validPoint = Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
      if (validPoint && Math.hypot(event.clientX - active.startX, event.clientY - active.startY) >= BOT_DRAG_THRESHOLD) active.moved = true;
      const point = validPoint ? dragPoint(active, event.clientX, event.clientY) : null;
      const target = point && active.moved && enabledRef.current && event.button === 0 ? pointerTarget(active.element, point) : null;
      finish();
      if (active.moved) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (active.moved && point && enabledRef.current) onDropRef.current({ placement: target, point });
    },
    onPointerCancel(event) {
      if (session.current?.pointerId === event.pointerId) finish();
    },
    onLostPointerCapture(event) {
      if (session.current?.pointerId === event.pointerId) finish();
    },
    onKeyDown(event) {
      if (!enabledRef.current || event.defaultPrevented) return;
      if (event.key === 'Escape' && session.current) {
        if (session.current.moved) {
          event.preventDefault();
          event.stopPropagation();
        }
        finish();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') suppressClick.current = false;
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.key === 'ArrowLeft' ? 'left' : event.key === 'ArrowRight' ? 'right' : event.key === 'ArrowDown' ? 'floating' : null;
      if (!target) return;
      // Consume these shortcuts even on narrow screens so Alt+Left cannot navigate away.
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const width = event.currentTarget.ownerDocument.defaultView?.innerWidth ?? 0;
      if (effectiveBotDockPlacement(target, width) !== target) return;
      finish();
      onDropRef.current({ placement: target, point: null });
    },
    onClickCapture(event) {
      const suppress = suppressClick.current;
      suppressClick.current = false;
      // Keyboard and assistive activation use detail=0 and retain the original click.
      if (!suppress || event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  return { ...state, buttonProps };
}

