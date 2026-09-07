import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { animateCanvasThemeTransition } from './canvas-theme-transition';

describe('whole-scene day/night reveal', () => {
  it.each(['day', 'night'] as const)('clips the first frame before capture and commits %s once', async nextTheme => {
    const dataset: Record<string, string> = {};
    const values = new Map<string, string>();
    const root = { dataset, style: { setProperty: (key: string, value: string) => values.set(key, value), removeProperty: (key: string) => values.delete(key) } } as unknown as HTMLElement;
    const commit = vi.fn(); let resolve!: () => void;
    const finished = new Promise<void>(done => { resolve = done; });
    const doc = { documentElement: root, startViewTransition: vi.fn((apply: () => void) => {
      expect(values.get('--heiyan-theme-from')).toBe('circle(0px at 900px 20px)');
      expect(dataset.canvasThemeTransition).toBe('to-' + nextTheme);
      apply(); return { finished };
    }) };
    const motion = { nextTheme, clipPath: ['circle(0px at 900px 20px)', 'circle(1200px at 900px 20px)'] as [string, string], duration: 720, easing: 'ease' };
    animateCanvasThemeTransition(doc, motion, commit);
    animateCanvasThemeTransition(doc, motion, commit);
    expect(commit).toHaveBeenCalledTimes(1); expect(doc.startViewTransition).toHaveBeenCalledTimes(1);
    resolve(); await finished; await Promise.resolve();
    expect(dataset.canvasThemeTransition).toBeUndefined(); expect(values.size).toBe(0);
  });
  it('removes the gate and still commits if snapshots are unavailable', () => {
    const root = { dataset: {}, style: { setProperty: vi.fn(), removeProperty: vi.fn() } } as unknown as HTMLElement;
    const commit = vi.fn();
    animateCanvasThemeTransition({ documentElement: root, startViewTransition: () => { throw new Error('unavailable'); } }, { nextTheme: 'day', clipPath: ['a', 'b'], duration: 720, easing: 'ease' }, commit);
    expect(commit).toHaveBeenCalledOnce(); expect(root.dataset.canvasThemeTransition).toBeUndefined();
  });
  it('uses the whole-scene wipe with no node visibility toggles or delayed animation installation', () => {
    const code = readFileSync(new URL('./canvas-theme-transition.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(code).not.toMatch(/\.ready\.then|\.animate\(|cloneNode|visibility\s*=|opacity\s*=|display\s*=/);
    expect(css).toContain('animation: heiyan-theme-reveal var(--heiyan-theme-duration) var(--heiyan-theme-easing) both;');
    expect(css).toContain("html[data-canvas-theme-transition='to-night']::view-transition-old(root)");
  });
});
