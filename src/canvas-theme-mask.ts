export type CanvasThemeMaskMotion = {
  nextTheme: 'day' | 'night';
  origin: { x: number; y: number };
  radius: number;
  duration: number;
  easing: string;
};

function backgroundPaint(host: HTMLElement) {
  const dots = host.querySelector<HTMLElement>('.heiyan-dot-field');
  const pattern = dots ? getComputedStyle(dots, '::before') : null;
  return {
    backgroundColor: getComputedStyle(host).backgroundColor,
    backgroundImage: pattern?.backgroundImage || 'none',
    backgroundSize: pattern?.backgroundSize || 'auto',
    backgroundPosition: pattern?.backgroundPosition || '0 0',
  };
}

/** Two flat CSS paints under React Flow, never snapshots/clones of media or nodes. */
export function animateCanvasThemeBackground(
  host: HTMLElement,
  motion: CanvasThemeMaskMotion,
  applyTheme: () => void,
  onFinished: () => void,
) {
  const plane = host.querySelector<HTMLElement>('.heiyan-dot-field');
  if (!plane) { applyTheme(); onFinished(); return; }
  const previous = backgroundPaint(host);
  const rect = host.getBoundingClientRect();
  const mask = host.ownerDocument.createElement('div');
  const reveal = host.ownerDocument.createElement('div');
  mask.className = 'canvas-theme-mask';
  reveal.className = 'canvas-theme-mask__reveal';
  mask.setAttribute('aria-hidden', 'true');
  Object.assign(mask.style, previous);
  mask.append(reveal);
  // Never append after React Flow: equal stacking levels would cover its nodes.
  // Confining the wipe to the background also protects other canvas overlays.
  plane.append(mask);

  let animation: Animation | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    mask.remove();
    animation?.cancel();
    onFinished();
  };
  try {
    // The opaque previous paint stays in place while React commits new tokens.
    applyTheme();
    const next = backgroundPaint(host);
    const toDay = motion.nextTheme === 'day';
    Object.assign(mask.style, toDay ? previous : next);
    Object.assign(reveal.style, toDay ? next : previous);
    const x = motion.origin.x - rect.left;
    const y = motion.origin.y - rect.top;
    const closed = `circle(0px at ${x}px ${y}px)`;
    const full = `circle(${motion.radius}px at ${x}px ${y}px)`;
    const clipPath = toDay ? [closed, full] : [full, closed];
    reveal.style.clipPath = clipPath[0];
    if (typeof reveal.animate !== 'function') {
      finish();
      return;
    }
    animation = reveal.animate({ clipPath }, {
      duration: motion.duration, easing: motion.easing, fill: 'both',
    });
    timer = setTimeout(finish, motion.duration + 200);
    void animation.finished.then(finish, finish);
  } catch {
    // Unsupported/aborted animations must never leave an opaque mask or a lock.
    finish();
  }
}
