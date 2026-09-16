import { useEffect, useState, type RefObject } from 'react';

/** Visibility gate shared by Bot motion and the single surface FLIP renderer. */
export function useLivingSurface(_root: RefObject<HTMLElement | null>, _enabled: boolean, _layoutKey: string) {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

