import { expect, it } from 'vitest';
import { mergeMessages } from './agent-memory';
import { cleanQuestion, questionMessage } from '../../server/agent-questions.js';
it('does not resurrect cancelled questions from old connector polls', () => {
  const question = cleanQuestion({id:'q',status:'cancelled',source:'codex',createdAt:1,updatedAt:3,questions:[{id:'a',question:'选择什么？',options:[]}]});
  const saved = questionMessage(question);
  for (const status of ['pending','deferred']) {
    const incoming = questionMessage(cleanQuestion({...question,status,updatedAt:4}));
    expect(mergeMessages([saved],[incoming])[0].question?.status).toBe('cancelled');
    expect(mergeMessages([saved],[incoming])[0].question?.answers).toBeUndefined();
  }
});
