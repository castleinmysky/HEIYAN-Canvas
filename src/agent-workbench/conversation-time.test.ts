import { it, expect } from 'vitest';
import { conversationTimeLabel, needsConversationTime } from './conversation-time';
it('only separates gaps and date changes, not every message', () => {
  const start = new Date(2026, 8, 11, 12).getTime();
  expect(needsConversationTime(start)).toBe(true);
  expect(needsConversationTime(start + 60_000, start)).toBe(false);
  expect(needsConversationTime(start + 300_000, start)).toBe(true);
  expect(needsConversationTime(undefined, start)).toBe(false);
  expect(needsConversationTime(new Date(2026,8,12).getTime(), new Date(2026,8,11,23,59).getTime())).toBe(true);
});
it('formats today, yesterday and older dates using local calendar days', () => {
  const now = new Date(2026,8,11,12).getTime();
  expect(conversationTimeLabel(new Date(2026,8,11,9,5).getTime(), now)).toBe('今天 09:05');
  expect(conversationTimeLabel(new Date(2026,8,10,23,56).getTime(), now)).toBe('昨天 23:56');
  expect(conversationTimeLabel(new Date(2026,8,8,9,5).getTime(), now)).toBe('9月8日 09:05');
});
