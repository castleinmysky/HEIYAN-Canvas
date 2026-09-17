export type BotDockPlacement = 'floating' | 'left' | 'right';
export type BotFreePosition = { x: number; y: number };
export type BotDragMode = 'off' | 'free-or-dock' | 'dock-only';

const botDockStorageKey = 'heiyan:bot-dock:v1';
const botFreePositionStorageKey = 'heiyan:bot-free-position:v1';
const sideDockMinWidth = 960;
const sideDockHotzone = 72;
const floatingDockHotzone = 120;
const freePositionMargin = 40;
const freePositionTopRatio = .42;

export const BOT_DRAG_THRESHOLD = 8;

/** Collapsed surfaces may rest freely; a full conversation only changes docks. */
export function livingBotDragMode(living: boolean, open: boolean, dockable: boolean): BotDragMode {
  if (!living || !dockable) return 'off';
  return open ? 'dock-only' : 'free-or-dock';
}

export function readBotDockPlacement(storage: Pick<Storage, 'getItem'>): BotDockPlacement {
  try {
    const value = storage.getItem(botDockStorageKey);
    return value === 'left' || value === 'right' ? value : 'floating';
  } catch {
    return 'floating';
  }
}

export function saveBotDockPlacement(storage: Pick<Storage, 'setItem'>, placement: BotDockPlacement): void {
  try {
    storage.setItem(botDockStorageKey, placement);
  } catch {
    // The current in-memory placement remains usable when storage is unavailable.
  }
}

export function readBotFreePosition(storage: Pick<Storage, 'getItem'>): BotFreePosition | null {
  try {
    const value = storage.getItem(botFreePositionStorageKey);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<BotFreePosition>;
    return typeof parsed.x === 'number' && Number.isFinite(parsed.x) && parsed.x >= 0 && parsed.x <= 1
      && typeof parsed.y === 'number' && Number.isFinite(parsed.y) && parsed.y >= 0 && parsed.y <= 1
      ? { x: parsed.x, y: parsed.y }
      : null;
  } catch {
    return null;
  }
}

export function saveBotFreePosition(storage: Pick<Storage, 'setItem' | 'removeItem'>, position: BotFreePosition | null): void {
  try {
    if (position) storage.setItem(botFreePositionStorageKey, JSON.stringify(position));
    else storage.removeItem(botFreePositionStorageKey);
  } catch {
    // Position remains usable in memory when device storage is unavailable.
  }
}

export function effectiveBotDockPlacement(saved: BotDockPlacement, width: number): BotDockPlacement {
  return Number.isFinite(width) && width >= sideDockMinWidth ? saved : 'floating';
}

/** A free Bot rests only in the middle/lower canvas and keeps a safe viewport margin. */
export function clampBotFreePoint({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const minX = Math.min(freePositionMargin, width / 2), maxX = Math.max(minX, width - freePositionMargin);
  const maxY = Math.max(0, height - freePositionMargin);
  const minY = Math.min(maxY, Math.max(Math.min(96, maxY), height * freePositionTopRatio));
  return { x: Math.max(minX, Math.min(maxX, x)), y: Math.max(minY, Math.min(maxY, y)) };
}

export function normalizeBotFreePosition(point: { x: number; y: number }, width: number, height: number): BotFreePosition | null {
  const clamped = clampBotFreePoint({ ...point, width, height });
  return clamped ? { x: clamped.x / width, y: clamped.y / height } : null;
}

export function resolveBotFreePoint(position: BotFreePosition, width: number, height: number) {
  return clampBotFreePoint({ x: position.x * width, y: position.y * height, width, height });
}

export function botDockAnchorPoint(placement: BotDockPlacement, width: number, height: number, botSize = 56) {
  const radius = Math.max(0, botSize) / 2;
  const edgeX = Math.min(16 + radius, width / 2), y = Math.max(0, height - 24 - radius);
  return { x: placement === 'left' ? edgeX : placement === 'right' ? width - edgeX : width / 2, y };
}

/** Chooses where a full conversation should work, without changing the Bot's remembered resting point. */
export function nearestBotDock({ x, y, width, height }: { x: number; y: number; width: number; height: number }): BotDockPlacement {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return 'floating';
  const bottom = botDockAnchorPoint('floating', width, height);
  const candidates: Array<[BotDockPlacement, number]> = [['floating', Math.hypot(x - bottom.x, y - bottom.y)]];
  if (width >= sideDockMinWidth) candidates.push(['left', Math.max(0, x)], ['right', Math.max(0, width - x)]);
  return candidates.reduce((best, candidate) => candidate[1] < best[1] ? candidate : best)[0];
}

/** Pointer coordinates are relative to the viewport, including its outer edges. */
export function botDockTarget({ x, y, width, height }: {
  x: number;
  y: number;
  width: number;
  height: number;
}): BotDockPlacement | null {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  if (x < 0 || x > width || y < 0 || y > height) return null;

  if (width >= sideDockMinWidth) {
    if (x <= sideDockHotzone) return 'left';
    if (x >= width - sideDockHotzone) return 'right';
  }

  const floatingTop = Math.max(0, height - floatingDockHotzone);
  return x >= width * .25 && x <= width * .75 && y >= floatingTop ? 'floating' : null;
}
