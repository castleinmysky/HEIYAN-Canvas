import { describe, expect, it, vi } from 'vitest';
import { settleLivingShape } from './use-living-shape-motion';

function animated(style: Record<string, string>) {
  const cancel = vi.fn();
  const removeProperty = vi.fn((property: string) => { delete style[property]; });
  return { element: { getAnimations: () => [{ cancel }], style: { removeProperty } } as any, cancel, removeProperty };
}

describe('living surface animation recovery', () => {
  it('restores visible content and final geometry when an opening animation is interrupted', () => {
    const skin = animated({ transform: 'scale(.1)', opacity: '.9' });
    const content = animated({ opacity: '0' });
    const anchor = animated({ transform: 'translateX(40px)' });
    settleLivingShape({ skin: skin.element, content: content.element, anchor: anchor.element });
    expect(content.cancel).toHaveBeenCalledOnce();
    expect(content.removeProperty).toHaveBeenCalledWith('opacity');
    expect(skin.removeProperty.mock.calls.map(([name]) => name)).toEqual(['transform', 'opacity']);
    expect(anchor.removeProperty).toHaveBeenCalledWith('transform');
  });
});

