import { describe, expect, it } from 'vitest';
import { promptMarkup, promptPresetChipText } from './components/CanvasNodes';

const token = {
  id: 'light-cinematic',
  scope: 'positive',
  label: '电影光效',
  value: 'cinematic lighting',
  tone: 'environment',
} as const;

describe('prompt preset language', () => {
  it('uses the English model value as the visible chip label in English mode', () => {
    expect(promptPresetChipText(token, 'en')).toBe('cinematic lighting');
    const markup = promptMarkup('', [], [token], 'en');
    expect(markup).toContain('data-prompt-preset-language="en"');
    expect(markup).toContain('<strong>cinematic lighting</strong>');
    expect(markup).toContain('aria-label="Remove positive preset cinematic lighting"');
    expect(markup).not.toContain('<strong>电影光效</strong>');
    expect(markup).not.toMatch(/title="[^"]*[\u3400-\u9fff]/u);
  });

  it('keeps the Chinese label in Chinese mode', () => {
    expect(promptPresetChipText(token, 'zh')).toBe('电影光效');
  });
});
