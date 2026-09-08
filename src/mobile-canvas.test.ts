import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canvasTouchInteraction, mobileCanvasLayout, mobileCanvasViewport, mobileNodeFocusViewport } from './mobile-canvas';

describe('mobile canvas without desktop regressions', () => {
  it('keeps the desktop middle-button pan and drag-selection contract', () => {
    for (const selecting of [true, false]) {
      expect(canvasTouchInteraction(false, selecting)).toEqual({ panOnDrag: [1], selectionOnDrag: true });
    }
    expect(mobileCanvasLayout(1440, 900, false)).toBe(false);
    expect(mobileCanvasLayout(1280, 720, true)).toBe(false);
    expect(mobileCanvasLayout(1024, 768, true)).toBe(false);
  });
  it('enables phone portrait and touch landscape, not landscape desktop', () => {
    expect(mobileCanvasLayout(390, 844, true)).toBe(true);
    expect(mobileCanvasLayout(932, 430, true)).toBe(true);
    expect(mobileCanvasLayout(932, 430, false)).toBe(false);
    expect(canvasTouchInteraction(true, false)).toEqual({ panOnDrag: true, selectionOnDrag: false });
    expect(canvasTouchInteraction(true, true)).toEqual({ panOnDrag: false, selectionOnDrag: true });
  });
  it('keeps the sheet above the keyboard and accounts for viewport panning', () => {
    expect(mobileCanvasViewport(844, 844)).toEqual({ height: 844, top: 0, keyboard: false, bottom: 0, sheetHeight: 388 });
    expect(mobileCanvasViewport(844, 360, 50)).toEqual({ height: 360, top: 50, keyboard: true, bottom: 434, sheetHeight: 208 });
    expect(mobileCanvasViewport(600, 700)).toEqual({ height: 600, top: 0, keyboard: false, bottom: 0, sheetHeight: 276 });
  });
  it.each([[320, 568, 124], [390, 844, 124], [430, 932, 124], [844, 390, 70], [390, 360, 12]])('fits portrait and widescreen nodes above the composer at %s x %s', (width, height, top) => {
    const bottom = mobileCanvasViewport(top === 12 ? 844 : height, height).sheetHeight + 12;
    for (const size of [[390, 693], [700, 300], [390, 390]]) {
      const node = { x: -1200, y: 2400, width: size[0], height: size[1] };
      const view = mobileNodeFocusViewport({ node, width, height, top, bottom });
      const left = node.x * view.zoom + view.x;
      const upper = node.y * view.zoom + view.y;
      expect(left).toBeGreaterThanOrEqual(19.99);
      expect(left + node.width * view.zoom).toBeLessThanOrEqual(width - 19.99);
      expect(upper).toBeGreaterThanOrEqual(top + 17.99);
      expect(upper + node.height * view.zoom).toBeLessThanOrEqual(height - bottom - 17.99);
      expect(view.zoom).toBeLessThanOrEqual(1);
    }
  });
  it('scopes mobile overrides and preserves desktop editor positioning', () => {
    const css = readFileSync(new URL('./mobile-canvas.css', import.meta.url), 'utf8');
    // Every enabled rule is guarded; only the default hidden mobile controls are global.
    const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((match) => match[1].trim()).filter((selector) => !selector.startsWith('@'));
    expect(selectors.filter((selector) => !selector.includes("[data-mobile='true']") && !selector.startsWith('.mobile-canvas-tools'))).toEqual([]);
    const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('canvasTouchInteraction(mobileCanvas.touch, touchSelecting)');
    expect(app).toContain('zoomOnPinch zoomOnDoubleClick={false}');
    expect(app).toContain('autoFocus={!mobileCanvas.mobile}');
    expect(app).toContain('generatorPanelDockPosition({');
    expect(app).toContain('if (!mobileCanvas.mobile || Date.now() < agentRevealUntil.current) return;');
    expect(app).toContain("setMobilePresetsOpen(false)");
    expect(css).toMatch(/\.mobile-editor-head\s*\{[^}]*pointer-events:\s*auto/);
    expect(css).toMatch(/\.generator-panel-footer\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    const pages = readFileSync(new URL('./mobile-pages.css', import.meta.url), 'utf8');
    const pageSelectors = [...pages.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((match) => match[1].trim());
    expect(pageSelectors.every((selector) => selector.startsWith("html[data-canvas-mobile='true']"))).toBe(true);
    for (const surface of ['echo-home', 'settings-center', 'model-connection-dialog', 'generated-asset-history', 'quick-crop-dialog', 'media-preview-dialog', 'comfyui-editor-dialog']) expect(pages).toContain(surface);
  });
});
