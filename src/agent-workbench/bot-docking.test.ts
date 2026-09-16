import { describe, expect, it, vi } from 'vitest';
import {
  BOT_DRAG_THRESHOLD,
  botDockAnchorPoint,
  botDockTarget,
  clampBotFreePoint,
  effectiveBotDockPlacement,
  nearestBotDock,
  normalizeBotFreePosition,
  readBotDockPlacement,
  readBotFreePosition,
  resolveBotFreePoint,
  saveBotDockPlacement,
  saveBotFreePosition,
  type BotDockPlacement,
} from './bot-docking';

describe('Bot dock persistence', () => {
  it.each<BotDockPlacement>(['floating', 'left', 'right'])('round-trips %s through the versioned storage key', placement => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    saveBotDockPlacement(storage, placement);
    expect(values.get('heiyan:bot-dock:v1')).toBe(placement);
    expect(readBotDockPlacement(storage)).toBe(placement);
  });

  it.each([null, '', 'bottom', 'LEFT', ' right ', 'null', '{"placement":"left"}'])('falls back for an absent or invalid stored value: %s', value => {
    const getItem = vi.fn(() => value);
    expect(readBotDockPlacement({ getItem })).toBe('floating');
    expect(getItem).toHaveBeenCalledWith('heiyan:bot-dock:v1');
  });

  it('keeps the UI usable if either storage operation throws', () => {
    const unavailable = () => { throw new Error('Storage is unavailable'); };
    expect(readBotDockPlacement({ getItem: unavailable })).toBe('floating');
    expect(() => saveBotDockPlacement({ setItem: unavailable }, 'right')).not.toThrow();
  });
});

describe('Bot free resting position', () => {
  it('persists a normalized point independently from its work dock', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    saveBotFreePosition(storage, { x: .36, y: .72 });
    expect(readBotFreePosition(storage)).toEqual({ x: .36, y: .72 });
    saveBotFreePosition(storage, null);
    expect(readBotFreePosition(storage)).toBeNull();
  });

  it.each(['', '{}', '{"x":2,"y":.7}', '{"x":".4","y":.7}', 'null', 'bad json'])('rejects an invalid free point: %s', value => {
    expect(readBotFreePosition({ getItem: () => value })).toBeNull();
  });

  it('keeps arbitrary resting points inside the middle/lower safe region', () => {
    expect(clampBotFreePoint({ x: 5, y: 100, width: 1200, height: 800 })).toEqual({ x: 40, y: 336 });
    expect(clampBotFreePoint({ x: 1199, y: 799, width: 1200, height: 800 })).toEqual({ x: 1160, y: 760 });
    const normalized = normalizeBotFreePosition({ x: 360, y: 600 }, 1200, 800);
    expect(normalized).toEqual({ x: .3, y: .75 });
    expect(resolveBotFreePoint(normalized!, 1200, 800)).toEqual({ x: 360, y: 600 });
  });

  it('selects the nearest real work dock without overwriting the resting point', () => {
    expect(nearestBotDock({ x: 100, y: 600, width: 1200, height: 800 })).toBe('left');
    expect(nearestBotDock({ x: 1100, y: 600, width: 1200, height: 800 })).toBe('right');
    expect(nearestBotDock({ x: 600, y: 700, width: 1200, height: 800 })).toBe('floating');
    expect(nearestBotDock({ x: 40, y: 600, width: 400, height: 800 })).toBe('floating');
    expect(botDockAnchorPoint('left', 1200, 800)).toEqual({ x: 44, y: 748 });
    expect(botDockAnchorPoint('right', 1200, 800)).toEqual({ x: 1156, y: 748 });
  });
});

describe('Bot dock responsive placement', () => {
  it.each<BotDockPlacement>(['floating', 'left', 'right'])('uses the saved %s choice at and above 960px', placement => {
    expect(effectiveBotDockPlacement(placement, 960)).toBe(placement);
    expect(effectiveBotDockPlacement(placement, 1920)).toBe(placement);
  });

  it.each([959.99, 375, 0, -1, NaN, Infinity, -Infinity])('falls back to floating at invalid or narrow width %s', width => {
    expect(effectiveBotDockPlacement('left', width)).toBe('floating');
    expect(effectiveBotDockPlacement('right', width)).toBe('floating');
  });

  it('does not discard the saved side choice during a narrow-screen fallback', () => {
    const saved = readBotDockPlacement({ getItem: () => 'right' });
    expect(effectiveBotDockPlacement(saved, 959)).toBe('floating');
    expect(effectiveBotDockPlacement(saved, 960)).toBe('right');
  });
});

describe('Bot dock drag targets', () => {
  const viewport = { width: 1200, height: 800 };
  const target = (x: number, y: number) => botDockTarget({ ...viewport, x, y });

  it('uses an exact 8px drag threshold', () => {
    expect(BOT_DRAG_THRESHOLD).toBe(8);
  });

  it('includes the exact 72px side boundaries throughout the viewport height', () => {
    for (const y of [0, 400, 800]) {
      expect(target(0, y)).toBe('left');
      expect(target(72, y)).toBe('left');
      expect(target(72.01, y)).toBeNull();
      expect(target(1127.99, y)).toBeNull();
      expect(target(1128, y)).toBe('right');
      expect(target(1200, y)).toBe('right');
    }
  });

  it('enables side targets at exactly 960px', () => {
    expect(botDockTarget({ x: 72, y: 400, width: 960, height: 800 })).toBe('left');
    expect(botDockTarget({ x: 888, y: 400, width: 960, height: 800 })).toBe('right');
    expect(botDockTarget({ x: 72, y: 400, width: 959.99, height: 800 })).toBeNull();
    expect(botDockTarget({ x: 900, y: 400, width: 959.99, height: 800 })).toBeNull();
  });

  it('includes the central 50% and exact last-120px boundaries for floating', () => {
    for (const x of [300, 600, 900]) {
      expect(target(x, 679.99)).toBeNull();
      expect(target(x, 680)).toBe('floating');
      expect(target(x, 800)).toBe('floating');
    }
    expect(target(299.99, 800)).toBeNull();
    expect(target(900.01, 800)).toBeNull();
    expect(target(600, 400)).toBeNull();
  });

  it('offers only the bottom floating target on narrow viewports', () => {
    const narrow = { width: 400, height: 800 };
    for (const x of [0, 72, 328, 400]) {
      expect(botDockTarget({ ...narrow, x, y: 800 })).toBeNull();
    }
    expect(botDockTarget({ ...narrow, x: 100, y: 680 })).toBe('floating');
    expect(botDockTarget({ ...narrow, x: 300, y: 800 })).toBe('floating');
    expect(botDockTarget({ ...narrow, x: 200, y: 679.99 })).toBeNull();
  });

  it('clamps the floating target top to a short viewport', () => {
    expect(botDockTarget({ x: 200, y: 0, width: 400, height: 100 })).toBe('floating');
    expect(botDockTarget({ x: 200, y: 100, width: 400, height: 100 })).toBe('floating');
    expect(botDockTarget({ x: 200, y: -0.01, width: 400, height: 100 })).toBeNull();
  });

  it.each([
    [-0.01, 400], [1200.01, 400], [0, -0.01], [0, 800.01],
    [600, -0.01], [600, 800.01], [1200, -0.01], [1200, 800.01],
  ])('rejects out-of-viewport pointer (%s, %s)', (x, y) => {
    expect(target(x, y)).toBeNull();
  });

  it.each(['x', 'y', 'width', 'height'] as const)('rejects all non-finite values for %s', field => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(botDockTarget({ ...viewport, x: 0, y: 400, [field]: value })).toBeNull();
    }
  });

  it.each([
    [0, 800], [-1, 800], [1200, 0], [1200, -1],
  ])('rejects non-positive viewport dimensions %s x %s', (width, height) => {
    expect(botDockTarget({ x: 0, y: 0, width, height })).toBeNull();
  });
});

