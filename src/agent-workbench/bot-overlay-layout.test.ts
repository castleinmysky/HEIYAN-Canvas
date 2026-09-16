import { describe, expect, it } from 'vitest';
import { constrainPanelToBot, type BotOverlayBounds, type BotOverlayPanel } from './bot-overlay-layout';

const bounds = (left: number, top: number, width: number, height: number): BotOverlayBounds => ({ left, top, width, height, right: left + width, bottom: top + height });
const canvas = bounds(0, 0, 1200, 800);
const bot = bounds(290, 600, 620, 176);
const panel = (dock: BotOverlayPanel['dock'] = 'bottom'): BotOverlayPanel => ({ left: 600, top: 160, width: 400, maxHeight: 400, dock });
function rect(position: BotOverlayPanel, measuredHeight: number) {
  const height = Math.min(measuredHeight, position.maxHeight);
  const left = position.left - position.width * (position.dock === 'left' ? 1 : position.dock === 'right' ? 0 : .5);
  const top = position.top - height * (position.dock === 'top' ? 1 : position.dock === 'bottom' ? 0 : .5);
  return bounds(left, top, position.width, height);
}

describe('Bot and node-editor overlay layout', () => {
  it('preserves a safe panel and its extra fields without a Bot', () => {
    const source = { ...panel(), panelPlacement: 'below' as const, label: 'existing' };
    const result = constrainPanelToBot({ panel: source, canvas, bot: null, measuredHeight: 250 });
    expect(result.panel).toBe(source);
    expect(result.panel.panelPlacement).toBe('below');
    expect(result.compact).toBe(false);
    expect(result.availableHeight).toBe(716);
  });

  it.each(['top', 'bottom', 'left', 'right'] as const)('keeps an offscreen %s panel inside the canvas and toolbar bounds', dock => {
    const result = constrainPanelToBot({ panel: { ...panel(dock), left: -900, top: -800 }, canvas, bot: null, measuredHeight: 250 });
    const actual = rect(result.panel, 250);
    expect(actual.left).toBe(12);
    expect(actual.top).toBe(72);
    expect(actual.right).toBeLessThanOrEqual(1188);
    expect(actual.bottom).toBeLessThanOrEqual(788);
    expect(actual.height).toBe(250);
    expect(result.panel.dock).toBe(dock);
  });

  it.each(['top', 'bottom', 'left', 'right'] as const)('clamps the %s panel bottom against the measured Bot top', dock => {
    const result = constrainPanelToBot({ panel: { ...panel(dock), top: 900 }, canvas, bot, measuredHeight: 300 });
    const actual = rect(result.panel, 300);
    expect(actual.bottom).toBe(588);
    expect(actual.top).toBeGreaterThanOrEqual(72);
    expect(actual.height).toBe(300);
    expect(result.availableHeight).toBe(516);
  });

  it('reduces available maxHeight without inventing a rendered height', () => {
    const source = { ...panel(), maxHeight: 900 };
    const result = constrainPanelToBot({ panel: source, canvas, bot, measuredHeight: 200 });
    expect(result.panel.maxHeight).toBe(428);
    expect(result.panel.top).toBe(160);
    expect(rect(result.panel, 200).height).toBe(200);
  });

  it('shrinks an oversized editor without moving its seam into the node preview', () => {
    const result = constrainPanelToBot({ panel: { ...panel(), top: 200, maxHeight: 900 }, canvas, bot, measuredHeight: 850 });
    expect(rect(result.panel, 850)).toEqual(bounds(400, 200, 400, 388));
    expect(result.panel.maxHeight).toBe(388);
  });

  it('keeps the exact below-preview seam when the Bot reserves bottom space', () => {
    const source = { ...panel(), left: 600, top: 366, width: 920, maxHeight: 522 };
    const result = constrainPanelToBot({ panel: source, canvas, bot: bounds(290, 700, 620, 88), measuredHeight: 500 });
    expect(result.panel.top).toBe(366);
    expect(result.panel.maxHeight).toBe(322);
    expect(rect(result.panel, 500).top).toBe(366);
    expect(rect(result.panel, 500).bottom).toBe(688);
  });

  it('does not reserve Bot space for a panel in a separate horizontal region', () => {
    const source = { ...panel('right'), left: 12, width: 200, top: 400, maxHeight: 700 };
    const result = constrainPanelToBot({ panel: source, canvas, bot, measuredHeight: 300 });
    expect(result.availableHeight).toBe(716);
    expect(result.panel).toBe(source);
  });

  it('uses the actual transformed panel interval, including exact touching edges', () => {
    const source = { ...panel('left'), left: bot.left, width: 200, top: 400, maxHeight: 700 };
    expect(constrainPanelToBot({ panel: source, canvas, bot, measuredHeight: 300 }).availableHeight).toBe(716);
    expect(constrainPanelToBot({ panel: { ...source, left: bot.left + .01 }, canvas, bot, measuredHeight: 300 }).availableHeight).toBe(516);
  });

  it('checks overlap after clamping an offscreen panel horizontally', () => {
    const source = { ...panel('left'), left: -400, width: 400, top: 400, maxHeight: 700 };
    const result = constrainPanelToBot({ panel: source, canvas, bot, measuredHeight: 300 });
    expect(rect(result.panel, 300).left).toBe(12);
    expect(result.availableHeight).toBe(516);
  });

  it('limits an editor to the actual side-docked canvas width', () => {
    const splitCanvas = bounds(444, 0, 756, 800);
    const result = constrainPanelToBot({ panel: { ...panel(), width: 920 }, canvas: splitCanvas, bot: null, measuredHeight: 300 });
    expect(result.panel.width).toBe(732);
    expect(rect(result.panel, 300).left).toBe(456);
    expect(rect(result.panel, 300).right).toBe(1188);
  });

  it.each([bounds(290, -200, 620, 200), bounds(290, 800, 620, 100), bounds(1400, 600, 620, 176)])('ignores a Bot outside the available canvas region: %o', outside => {
    expect(constrainPanelToBot({ panel: panel(), canvas, bot: outside, measuredHeight: 250 }).availableHeight).toBe(716);
  });

  it('respects a translated canvas origin', () => {
    const offsetCanvas = bounds(400, 100, 800, 600);
    const result = constrainPanelToBot({ panel: { ...panel('right'), left: 0, top: 0 }, canvas: offsetCanvas, bot: bounds(600, 500, 400, 176), measuredHeight: 300 });
    expect(rect(result.panel, 300)).toEqual(bounds(412, 172, 400, 300));
    expect(result.availableHeight).toBe(316);
  });

  it.each([128, 127.99, 0])('reports actual space of %s px without forcing the minimum through the Bot', available => {
    const tallBot = bounds(290, 72 + 12 + available, 620, 700 - available);
    const result = constrainPanelToBot({ panel: { ...panel(), top: 72 }, canvas, bot: tallBot, measuredHeight: 400 });
    expect(result.availableHeight).toBeCloseTo(available);
    expect(result.compact).toBe(available < 128);
    expect(result.panel.maxHeight).toBeCloseTo(available);
    expect(rect(result.panel, 400).top).toBe(72);
    expect(rect(result.panel, 400).bottom).toBeLessThanOrEqual(tallBot.top - 12 + .0001);
  });

  it('returns zero space when the Bot reaches the toolbar instead of placing the editor offscreen', () => {
    const result = constrainPanelToBot({ panel: panel(), canvas, bot: bounds(290, 20, 620, 756), measuredHeight: 400 });
    expect(result.availableHeight).toBe(0);
    expect(result.compact).toBe(true);
    expect(result.panel.maxHeight).toBe(0);
    expect(result.panel.top).toBe(160);
  });

  it('supports explicitly measured spacing requirements', () => {
    const result = constrainPanelToBot({ panel: panel(), canvas, bot, measuredHeight: 400, gap: 20, topInset: 100, minHeight: 500 });
    expect(result.availableHeight).toBe(420);
    expect(result.compact).toBe(true);
    expect(rect(result.panel, 400).bottom).toBeLessThanOrEqual(580);
  });

  it.each(['top', 'bottom', 'left', 'right'] as const)('is stable when the %s editor is remeasured after applying the height limit', dock => {
    const source = { ...panel(dock), top: 700, maxHeight: 1000 };
    const first = constrainPanelToBot({ panel: source, canvas, bot, measuredHeight: 900 });
    const actualHeight = Math.min(900, first.panel.maxHeight);
    const next = constrainPanelToBot({ panel: first.panel, canvas, bot, measuredHeight: actualHeight });
    expect(next).toEqual(first);
    expect(next.panel).toBe(first.panel);
  });

  it('does not mutate the source panel or measured rectangles', () => {
    const source = Object.freeze({ ...panel(), top: 900 });
    expect(() => constrainPanelToBot({ panel: source, canvas: Object.freeze(canvas), bot: Object.freeze(bot), measuredHeight: 400 })).not.toThrow();
    expect(source.top).toBe(900);
  });

  it.each([NaN, Infinity, -Infinity, -1])('does not fabricate a panel measurement from invalid height %s', measuredHeight => {
    const source = panel();
    expect(constrainPanelToBot({ panel: source, canvas, bot, measuredHeight })).toEqual({ panel: source, compact: true, availableHeight: 0 });
  });

  it('ignores an invalid Bot measurement while still clamping to the canvas', () => {
    const result = constrainPanelToBot({ panel: { ...panel(), top: -400 }, canvas, bot: { ...bot, top: NaN }, measuredHeight: 250 });
    expect(result.panel.top).toBe(72);
    expect(result.availableHeight).toBe(716);
  });

  it('reports impossible canvas space as compact without creating width or height', () => {
    const result = constrainPanelToBot({ panel: panel(), canvas: bounds(0, 0, 10, 10), bot: null, measuredHeight: 250 });
    expect(result.compact).toBe(true);
    expect(result.availableHeight).toBe(0);
    expect(result.panel.width).toBe(0);
    expect(result.panel.maxHeight).toBe(0);
  });
});

