import { useEffect, useState } from 'react';

export function mobileCanvasLayout(width: number, height: number, coarsePointer: boolean) {
  return width < 768 || (coarsePointer && (width < 960 || (width <= 1100 && height <= 600)));
}

// Keep the desktop mouse contract intact, including narrow desktop windows.
export function canvasTouchInteraction(touch: boolean, selecting: boolean) {
  return {
    panOnDrag: touch ? !selecting : [1],
    selectionOnDrag: touch ? selecting : true,
  };
}

export function mobileCanvasViewport(innerHeight: number, visibleHeight: number, offsetTop = 0) {
  const height = Math.max(1, Math.min(innerHeight, visibleHeight));
  const keyboard = innerHeight - height > 140;
  return {
    height,
    top: offsetTop,
    keyboard,
    bottom: Math.max(0, innerHeight - height - offsetTop),
    sheetHeight: Math.floor(Math.min(390, height * (keyboard ? .58 : .46))),
  };
}

/** Fit the complete node above the composer; never change its aspect ratio. */
export function mobileNodeFocusViewport(input: {
  node: { x: number; y: number; width: number; height: number };
  width: number; height: number; top?: number; bottom: number; minZoom?: number;
}) {
  const { node, width, height, bottom, top = 124, minZoom = .05 } = input;
  const availableWidth = Math.max(1, width - 40);
  const availableHeight = Math.max(1, height - top - bottom - 36);
  const zoom = Math.max(minZoom, Math.min(1, availableWidth / Math.max(1, node.width), availableHeight / Math.max(1, node.height)));
  return {
    x: width / 2 - (node.x + node.width / 2) * zoom,
    y: top + 18 + availableHeight / 2 - (node.y + node.height / 2) * zoom,
    zoom,
  };
}

export function useMobileCanvas() {
  const read = () => {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const mobile = mobileCanvasLayout(window.innerWidth, window.innerHeight, coarse);
    return {
      mobile,
      touch: mobile && coarse,
      width: window.innerWidth,
      ...mobileCanvasViewport(window.innerHeight, window.visualViewport?.height ?? window.innerHeight, window.visualViewport?.offsetTop),
    };
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const pointer = window.matchMedia('(pointer: coarse)');
    const update = () => setState((previous) => {
      const next = read();
      return Object.keys(next).every((key) => next[key as keyof typeof next] === previous[key as keyof typeof next]) ? previous : next;
    });
    window.addEventListener('resize', update);
    pointer.addEventListener('change', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    update();
    return () => {
      window.removeEventListener('resize', update);
      pointer.removeEventListener('change', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);
  // Native dialogs and media portals live outside the canvas, including on Home.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.canvasMobile;
    root.dataset.canvasMobile = String(state.mobile);
    const values = { '--mobile-visible-height': `${state.height}px`, '--mobile-visible-top': `${state.top}px`, '--mobile-bottom-inset': `${state.bottom}px` };
    const saved = Object.fromEntries(Object.keys(values).map((key) => [key, root.style.getPropertyValue(key)]));
    for (const [key, value] of Object.entries(values)) root.style.setProperty(key, value);
    return () => {
      if (previous === undefined) delete root.dataset.canvasMobile;
      else root.dataset.canvasMobile = previous;
      for (const [key, value] of Object.entries(saved)) {
        if (value) root.style.setProperty(key, value);
        else root.style.removeProperty(key);
      }
    };
  }, [state.mobile, state.height, state.top, state.bottom]);
  return state;
}
