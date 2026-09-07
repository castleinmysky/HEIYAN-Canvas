import { describe, expect, it } from 'vitest';
import { filterPromptTokens } from './prompt-token-library';

describe('condensed prompt preset groups', () => {
  it('keeps the three dense groups intentionally short', () => {
    const wardrobe = filterPromptTokens('positive', '服饰');
    const actions = filterPromptTokens('positive', '表情动作');
    expect(wardrobe.filter((entry) => entry.group === '基础内搭')).toHaveLength(10);
    expect(wardrobe.filter((entry) => entry.group === '魅力内搭')).toHaveLength(10);
    expect(actions.filter((entry) => entry.group === '亲吻依偎')).toHaveLength(12);
  });
});
