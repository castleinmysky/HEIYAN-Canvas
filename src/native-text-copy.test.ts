import { describe, expect, it } from 'vitest';
import { hasNativeTextSelection } from './App';

describe('native text copy boundary', () => {
  it('leaves a real browser text selection to the system clipboard', () => {
    expect(hasNativeTextSelection({ isCollapsed: false, toString: () => 'selected text' })).toBe(true);
  });

  it('keeps canvas clipboard handling for collapsed or empty selections', () => {
    expect(hasNativeTextSelection(null)).toBe(false);
    expect(hasNativeTextSelection({ isCollapsed: true, toString: () => 'ignored' })).toBe(false);
    expect(hasNativeTextSelection({ isCollapsed: false, toString: () => '' })).toBe(false);
  });
});
