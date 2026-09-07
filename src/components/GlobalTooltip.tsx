import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type TooltipAnchor = {
  text: string;
  rect: { top: number; right: number; bottom: number; left: number; width: number; height: number };
};

type TooltipPosition = { left: number; top: number; placement: 'top' | 'bottom' };

function tooltipTarget(value: EventTarget | null) {
  if (!(value instanceof Element)) return null;
  const target = value.closest<HTMLElement>('[title], [data-heiyan-tooltip]');
  if (!target) return null;
  const nativeTitle = target.getAttribute('title')?.replace(/\s+/g, ' ').trim();
  if (nativeTitle) {
    target.dataset.heiyanTooltip = nativeTitle;
    target.removeAttribute('title');
  }
  return target.dataset.heiyanTooltip?.trim() ? target : null;
}

function anchorFor(target: HTMLElement): TooltipAnchor | null {
  const text = target.dataset.heiyanTooltip?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const rect = target.getBoundingClientRect();
  return {
    text: text.slice(0, 240),
    rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height },
  };
}

export function GlobalTooltip() {
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<number | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const lastPointerDownAtRef = useRef(0);

  useEffect(() => {
    const clearShowTimer = () => {
      if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    };
    const hide = () => {
      clearShowTimer();
      activeTargetRef.current = null;
      setAnchor(null);
      setPosition(null);
    };
    const show = (target: HTMLElement, immediate = false) => {
      clearShowTimer();
      activeTargetRef.current = target;
      const commit = () => {
        if (activeTargetRef.current !== target || !target.isConnected) return;
        setPosition(null);
        setAnchor(anchorFor(target));
      };
      if (immediate) commit();
      else showTimerRef.current = window.setTimeout(commit, 280);
    };
    const onPointerOver = (event: PointerEvent) => {
      const target = tooltipTarget(event.target);
      if (!target || activeTargetRef.current === target) return;
      show(target);
    };
    const onPointerOut = (event: PointerEvent) => {
      const current = activeTargetRef.current;
      if (!current) return;
      const next = event.relatedTarget;
      if (next instanceof Node && current.contains(next)) return;
      if (tooltipTarget(event.target) === current) hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (performance.now() - lastPointerDownAtRef.current < 500) return;
      const target = tooltipTarget(event.target);
      if (target) show(target, true);
    };
    const onFocusOut = (event: FocusEvent) => {
      const current = activeTargetRef.current;
      if (!current) return;
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !current.contains(next)) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    const onPointerDown = () => { lastPointerDownAtRef.current = performance.now(); hide(); };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      clearShowTimer();
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!anchor || !tooltipRef.current) return;
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const margin = 12;
    const gap = 10;
    const center = anchor.rect.left + anchor.rect.width / 2;
    const left = Math.max(margin + tooltipRect.width / 2, Math.min(window.innerWidth - margin - tooltipRect.width / 2, center));
    const fitsAbove = anchor.rect.top - tooltipRect.height - gap >= margin;
    setPosition({ left, top: fitsAbove ? anchor.rect.top - gap : anchor.rect.bottom + gap, placement: fitsAbove ? 'top' : 'bottom' });
  }, [anchor]);

  if (!anchor) return null;
  return <div
    ref={tooltipRef}
    className={`heiyan-global-tooltip${position ? ' is-ready' : ''}`}
    role="tooltip"
    data-placement={position?.placement || 'top'}
    style={position ? { left: position.left, top: position.top } : { left: anchor.rect.left + anchor.rect.width / 2, top: anchor.rect.top }}
  >{anchor.text}</div>;
}
