type Motion = { nextTheme: 'day' | 'night'; clipPath: [string, string]; duration: number; easing: string };
type ThemeTransition = { finished: Promise<void>; updateCallbackDone?: Promise<void> };
type ThemeDocument = { documentElement: HTMLElement; startViewTransition?: (commit: () => void) => ThemeTransition };

/** One continuous old/new scene. No node hiding, remounting, or media reload. */
export function animateCanvasThemeTransition(doc: ThemeDocument, motion: Motion, commit: () => void) {
  const root = doc.documentElement;
  if (root.dataset.canvasThemeTransition) return;
  if (!doc.startViewTransition) { commit(); return; }
  let committed = false;
  const apply = () => { if (!committed) { committed = true; commit(); } };
  root.dataset.canvasThemeTransition = motion.nextTheme === 'day' ? 'to-day' : 'to-night';
  // Establish the first clipped frame before capture, rather than applying it
  // later in transition.ready (which can expose an unmasked frame).
  root.style.setProperty('--heiyan-theme-from', motion.clipPath[0]);
  root.style.setProperty('--heiyan-theme-to', motion.clipPath[1]);
  root.style.setProperty('--heiyan-theme-duration', motion.duration + 'ms');
  root.style.setProperty('--heiyan-theme-easing', motion.easing);
  const finish = () => {
    delete root.dataset.canvasThemeTransition;
    for (const name of ['from', 'to', 'duration', 'easing']) root.style.removeProperty('--heiyan-theme-' + name);
  };
  try {
    const transition = doc.startViewTransition(apply);
    void transition.updateCallbackDone?.catch(() => {});
    void transition.finished.then(() => { apply(); finish(); }, () => { apply(); finish(); });
  } catch { apply(); finish(); }
}
