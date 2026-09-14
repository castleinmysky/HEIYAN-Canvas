import { it, expect } from 'vitest';
import { clearSubmittedDraft, restoreSubmittedDraft } from './conversation-draft';
it('clears submitted content and references immediately', () => {
  const draft = { text: '继续中断的任务', nodeIds: ['one'] };
  expect(clearSubmittedDraft(draft, draft)).toEqual({ text: '', nodeIds: [] });
});
it('restores a failed submission without overwriting new typing', () => {
  expect(restoreSubmittedDraft({ text: '新要求', nodeIds: ['two'] }, { text: '原要求', nodeIds: ['one'] })).toEqual({ text: '原要求\n新要求', nodeIds: ['one', 'two'] });
});
it('restores an untouched empty composer exactly', () => {
  const draft = { text: '原要求', nodeIds: ['one'] };
  expect(restoreSubmittedDraft({ text: '', nodeIds: [] }, draft)).toEqual(draft);
});
