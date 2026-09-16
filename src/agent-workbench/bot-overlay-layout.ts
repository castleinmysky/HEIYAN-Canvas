export type BotOverlayBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

export type BotOverlayPanel = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  dock: 'top' | 'bottom' | 'left' | 'right';
};

function validBounds(bounds: BotOverlayBounds) {
  return [bounds.left, bounds.right, bounds.top, bounds.bottom, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.right >= bounds.left && bounds.bottom >= bounds.top && bounds.width >= 0 && bounds.height >= 0;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const nonnegativeOption = (value: number, fallback: number) => Number.isFinite(value) && value >= 0 ? value : fallback;

/**
 * Constrain the existing generator-panel anchor without changing its dock direction.
 * Pass the measured floating Bot rectangle only; a side dock already reduces canvas.
 * measuredHeight is the current rendered panel height, never an estimated minimum.
 * compact signals that the actual remaining space cannot provide minHeight; callers
 * must render their compact UI in that space rather than force a larger CSS minimum.
 */
export function constrainPanelToBot<T extends BotOverlayPanel>({
  panel, canvas, bot, measuredHeight, gap = 12, topInset = 72, minHeight = 128,
}: {
  panel: T;
  canvas: BotOverlayBounds;
  bot: BotOverlayBounds | null;
  measuredHeight: number;
  gap?: number;
  topInset?: number;
  minHeight?: number;
}): { panel: T; compact: boolean; availableHeight: number } {
  if (!validBounds(canvas)
    || ![panel.left, panel.top, panel.width, panel.maxHeight, measuredHeight].every(Number.isFinite)
    || panel.width < 0 || panel.maxHeight < 0 || measuredHeight < 0
    || !['top', 'bottom', 'left', 'right'].includes(panel.dock)) {
    return { panel, compact: true, availableHeight: 0 };
  }

  const safeGap = nonnegativeOption(gap, 12);
  const safeInset = nonnegativeOption(topInset, 72);
  const minimum = nonnegativeOption(minHeight, 128);
  const safeLeft = Math.min(canvas.right, canvas.left + safeGap);
  const safeRight = Math.max(safeLeft, canvas.right - safeGap);
  const safeTop = Math.min(canvas.bottom, canvas.top + safeInset);
  let safeBottom = Math.max(safeTop, canvas.bottom - safeGap);
  let bottomReservedForBot = false;

  // CSS transforms: top/bottom = horizontal centre; left = right edge;
  // right = left edge. Both side directions use the vertical centre.
  const xOrigin = panel.dock === 'left' ? 1 : panel.dock === 'right' ? 0 : .5;
  const yOrigin = panel.dock === 'top' ? 1 : panel.dock === 'bottom' ? 0 : .5;
  const width = Math.min(panel.width, safeRight - safeLeft);
  const oldLeft = panel.left - panel.width * xOrigin;
  const left = clamp(oldLeft, safeLeft, safeRight - width);

  if (bot && validBounds(bot) && bot.width > 0 && bot.height > 0
    && left < bot.right && left + width > bot.left
    && bot.bottom > safeTop && bot.top < safeBottom) {
    safeBottom = clamp(bot.top - safeGap, safeTop, safeBottom);
    bottomReservedForBot = true;
  }

  // A panel docked below a node owns its top seam: moving that seam upward makes
  // the editor overlap the preview it belongs to. When the floating Bot consumes
  // bottom space, preserve the seam and reduce only the editor's available height.
  if (bottomReservedForBot && panel.dock === 'bottom' && panel.top >= safeTop && panel.top <= canvas.bottom) {
    const availableHeight = Math.max(0, safeBottom - panel.top);
    const maxHeight = Math.min(panel.maxHeight, availableHeight);
    const anchorLeft = left === oldLeft && width === panel.width ? panel.left : left + width * xOrigin;
    const next = anchorLeft === panel.left && width === panel.width && maxHeight === panel.maxHeight
      ? panel : { ...panel, left: anchorLeft, width, maxHeight };
    return { panel: next, compact: availableHeight < minimum || width <= 0, availableHeight };
  }

  const availableHeight = safeBottom - safeTop;
  const maxHeight = Math.min(panel.maxHeight, availableHeight);
  const previousHeight = Math.min(measuredHeight, panel.maxHeight);
  const height = Math.min(measuredHeight, maxHeight);
  const oldTop = panel.top - previousHeight * yOrigin;
  const top = clamp(oldTop, safeTop, safeBottom - height);
  const anchorLeft = left === oldLeft && width === panel.width ? panel.left : left + width * xOrigin;
  const anchorTop = top === oldTop && height === previousHeight ? panel.top : top + height * yOrigin;
  const next = anchorLeft === panel.left && anchorTop === panel.top && width === panel.width && maxHeight === panel.maxHeight
    ? panel : { ...panel, left: anchorLeft, top: anchorTop, width, maxHeight };
  return { panel: next, compact: availableHeight < minimum || width <= 0, availableHeight };
}

