import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animate } from 'motion';

type SurfaceSnapshot = { rect: DOMRect; anchor: DOMRect | null };
type AnimatedSurfaceElement = Pick<HTMLElement, 'getAnimations' | 'style'>;

function settleElement(element: AnimatedSurfaceElement | null | undefined, properties: readonly string[]) {
  if (!element) return;
  element.getAnimations().forEach(animation => animation.cancel());
  properties.forEach(property => element.style.removeProperty(property));
}

/** Interrupted FLIP animations must never leave real controls transparent. */
export function settleLivingShape(elements: { skin?: AnimatedSurfaceElement | null; content?: AnimatedSurfaceElement | null; anchor?: AnimatedSurfaceElement | null }) {
  settleElement(elements.skin, ['transform', 'opacity']);
  settleElement(elements.content, ['opacity']);
  settleElement(elements.anchor, ['transform']);
}

/** One surface animator. Floating mode grows from the Bot's previous real viewport position. */
export function useLivingShapeMotion(dock: RefObject<HTMLElement | null>, signature: string, enabled: boolean) {
  const previous = useRef<SurfaceSnapshot | null>(null);
  const running = useRef<Array<{ stop: () => void }>>([]);
  useLayoutEffect(() => () => {
    running.current.forEach(control => control.stop()); running.current = [];
    const root = dock.current;
    if (root) settleLivingShape({
      skin: root.querySelector<HTMLElement>('.heiyan-living-skin'),
      content: root.querySelector<HTMLElement>('.heiyan-living-content'),
      anchor: root.querySelector<HTMLElement>('.heiyan-living-anchor'),
    });
  }, [dock]);
  useLayoutEffect(() => {
    const root = dock.current;
    if (!root || !enabled) {
      previous.current = null; running.current.forEach(control => control.stop()); running.current = [];
      if (root) settleLivingShape({
        skin: root.querySelector<HTMLElement>('.heiyan-living-skin'),
        content: root.querySelector<HTMLElement>('.heiyan-living-content'),
        anchor: root.querySelector<HTMLElement>('.heiyan-living-anchor'),
      });
      return;
    }
    const rect = root.getBoundingClientRect(), anchor = root.querySelector<HTMLElement>('.heiyan-living-anchor');
    const snapshot = { rect, anchor: anchor?.getBoundingClientRect() || null }, before = previous.current;
    previous.current = snapshot;
    const skin = root.querySelector<HTMLElement>('.heiyan-living-skin');
    const content = root.querySelector<HTMLElement>('.heiyan-living-content');
    running.current.forEach(control => control.stop()); running.current = [];
    settleLivingShape({ skin, content, anchor });
    if (!before || !rect.width || !rect.height || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!skin || Math.abs(before.rect.width - rect.width) < 1 && Math.abs(before.rect.height - rect.height) < 1) return;
    const side = root.dataset.dockPlacement;
    if (side !== 'floating') {
      // A side dock is a stable split pane, not a pill growing into a sheet.
      // Scaling its full height from the collapsed Bot briefly leaves a blank,
      // half-sized shell when the rail is reopened or an animation is interrupted.
      const shape = animate(skin, { opacity: [.9, 1] }, { duration: .18, ease: [0.16, 1, 0.3, 1] });
      running.current = [shape]; return;
    }
    skin.style.transformOrigin = '0 0';
    const shape = animate(skin, {
      x: [before.rect.x - rect.x, 0], y: [before.rect.y - rect.y, 0],
      scaleX: [before.rect.width / rect.width, 1], scaleY: [before.rect.height / rect.height, 1], opacity: [.9, 1],
    }, { duration: .44, ease: [0.16, 1, 0.3, 1] });
    const avatar = anchor && before.anchor ? animate(anchor, {
      x: [before.anchor.x - snapshot.anchor!.x, 0], y: [before.anchor.y - snapshot.anchor!.y, 0],
    }, { duration: .44, ease: [0.16, 1, 0.3, 1] }) : undefined;
    // Never animate the real controls from opacity 0 here. The FLIP signature
    // also changes for width, dock and panel updates; interrupting a delayed
    // content animation could otherwise leave a fully expanded empty shell.
    // CSS owns the short open-only reveal and always falls back to opacity 1.
    running.current = [shape,...(avatar ? [avatar] : [])];
  }, [dock, signature, enabled]);
}
