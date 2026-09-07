import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { animateCanvasThemeBackground, type CanvasThemeMaskMotion } from './canvas-theme-mask';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlow } from '@xyflow/react';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function fixture(nextTheme: 'day' | 'night', animationMode = 'normal') {
  vi.useFakeTimers();
  let theme = nextTheme === 'day' ? 'night' : 'day';
  let resolve!: () => void;
  let reject!: () => void;
  const animation = { finished: new Promise<void>((yes, no) => { resolve = yes; reject = no; }), cancel: vi.fn() };
  const animate = vi.fn(() => {
    if (animationMode === 'throws') throw new Error('Animation unavailable');
    return animation;
  });
  const elements: Array<ReturnType<typeof element>> = [];
  function element() {
    return {
      className: '', style: {} as Record<string, string>,
      setAttribute: vi.fn(), append: vi.fn(), remove: vi.fn(),
      animate: animationMode === 'missing' ? undefined : animate,
    };
  }
  const plane = { append: vi.fn() };
  const host = {
    ownerDocument: { createElement: () => { const node = element(); elements.push(node); return node; } },
    querySelector: vi.fn(() => plane),
    getBoundingClientRect: () => ({ left: 20, top: 48 }), append: vi.fn(),
  };
  vi.stubGlobal('getComputedStyle', (_element: unknown, pseudo: string) => pseudo ? {
    backgroundImage: `dots-${theme}`, backgroundSize: '34px 34px', backgroundPosition: '0 0',
  } : { backgroundColor: theme === 'night' ? '#080909' : '#e8e9ea' });
  const apply = vi.fn(() => { theme = nextTheme; });
  const done = vi.fn();
  const motion: CanvasThemeMaskMotion = { nextTheme, origin: { x: 900, y: 30 }, radius: 1400, duration: 720, easing: 'ease' };
  animateCanvasThemeBackground(host as unknown as HTMLElement, motion, apply, done);
  return { host, plane, elements, animate, animation, apply, done, resolve, reject };
}

describe('canvas background theme mask', () => {
  it('reveals daylight from the switch, translated into flow-area coordinates', async () => {
    const f = fixture('day');
    expect(f.elements[0].style.backgroundColor).toBe('#080909');
    expect(f.elements[1].style.backgroundColor).toBe('#e8e9ea');
    expect(f.elements[1].style.backgroundImage).toBe('dots-day');
    expect(f.animate).toHaveBeenCalledWith({ clipPath: ['circle(0px at 880px -18px)', 'circle(1400px at 880px -18px)'] }, { duration: 720, easing: 'ease', fill: 'both' });
    expect(f.apply).toHaveBeenCalledTimes(1);
    expect(f.host.append).not.toHaveBeenCalled();
    expect(f.plane.append).toHaveBeenCalledWith(f.elements[0]);
    expect(f.host.querySelector).toHaveBeenCalledWith('.heiyan-dot-field');
    f.resolve(); await Promise.resolve();
    expect(f.done).toHaveBeenCalledTimes(1);
    expect(f.elements[0].remove).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(f.done).toHaveBeenCalledTimes(1);
  });

  it('retracts daylight into the switch with night underneath', () => {
    const f = fixture('night');
    expect(f.elements[0].style.backgroundColor).toBe('#080909');
    expect(f.elements[1].style.backgroundColor).toBe('#e8e9ea');
    expect(f.animate.mock.calls[0][0].clipPath).toEqual(['circle(1400px at 880px -18px)', 'circle(0px at 880px -18px)']);
    vi.runAllTimers();
    expect(f.done).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'throws'])('still commits the theme and releases the mask when animation is %s', (mode) => {
    const f = fixture('day', mode);
    expect(f.apply).toHaveBeenCalledOnce();
    expect(f.done).toHaveBeenCalledOnce();
    expect(f.elements[0].remove).toHaveBeenCalledOnce();
  });

  it('cleans up a cancelled animation and a stalled finished promise', async () => {
    const cancelled = fixture('day');
    cancelled.reject(); await Promise.resolve();
    expect(cancelled.done).toHaveBeenCalledOnce();
    const stalled = fixture('night');
    vi.advanceTimersByTime(920);
    expect(stalled.done).toHaveBeenCalledOnce();
    expect(stalled.animation.cancel).toHaveBeenCalledOnce();
  });

  it('keeps the mask below live React Flow and never snapshots or clones media', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const code = readFileSync(new URL('./canvas-theme-mask.ts', import.meta.url), 'utf8');
    expect(css).toMatch(/\.heiyan-dot-field > \.canvas-theme-mask\s*\{[^}]*z-index: 1;[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.flow-area > \.react-flow\s*\{[^}]*z-index: 1 !important;/);
    expect(code).not.toMatch(/cloneNode|startViewTransition|requestAnimationFrame|querySelectorAll|<video|<img/);
    expect(app).toContain('if (background && !reduceMotion && !transitionDocument.startViewTransition)');
    expect(app).toContain('if (root.dataset.canvasThemeTransition) return;');
    expect(app).toContain('animateCanvasThemeTransition(transitionDocument, motion,');
  });

  it('guards against React Flow overriding the user style prop with inline z-index zero', () => {
    const defaults = renderToStaticMarkup(createElement(ReactFlow, { nodes: [], edges: [] }));
    const fixed = renderToStaticMarkup(createElement(ReactFlow, { nodes: [], edges: [], style: { zIndex: 1 } }));
    expect(defaults).toContain('z-index:0');
    expect(fixed).toContain('z-index:0');
    const wrapper = fixed.slice(0, fixed.indexOf('>'));
    expect(wrapper).not.toMatch(/visibility:hidden|display:none|opacity:0/);
  });
});
