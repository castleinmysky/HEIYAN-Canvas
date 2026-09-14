import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeQuestions, questionAnswers, cleanQuestion, questionMessage, questionResult } from '../../server/agent-questions.js';
import { AgentConversation } from './AgentConversation';
import { AgentHeader } from './AgentHeader';
import { mergeMessages } from './agent-memory';
import { validateAgentTool, agentTools } from '../../server/agent-contract.js';
const questions = normalizeQuestions([{ id: 'style', question: '选择角色风格？', options: [{ label: '保留原风格', description: '保持当前风格' }] }]);
const q = cleanQuestion({ id: 'q-1', questions, status: 'pending', source: 'api', createdAt: 1 });
describe('conversation questions', () => {
  it('has a shared model tool with bounded validated inputs', () => {
    expect(agentTools.some((tool: any) => tool.name === 'heiyan_ask_question')).toBe(true);
    expect(validateAgentTool('heiyan_ask_question', { questions })).toEqual({ questions });
    expect(() => normalizeQuestions([...questions, ...questions])).toThrow();
    expect(() => normalizeQuestions([{ ...questions[0], id: '__proto__' }])).toThrow();
    expect(() => questionAnswers(questions, {})).toThrow();
    expect(() => questionAnswers(questions, { style: { answers: [''] } })).toThrow();
    expect(() => questionAnswers(questions, { style: { answers: ['A', 'B'] } })).toThrow();
    expect(questionAnswers(questions, { style: { answers: ['用户自己的回答'] } }).style.answers).toEqual(['用户自己的回答']);
  });
  it('never treats a deferred question as consent', () => {
    expect(questionResult(q).answers).toEqual({});
    expect(questionResult(q).status).toBe('deferred');
    expect(questionResult(q).instruction).toContain('已经授权');
  });
  it('persists status-only changes without losing identity', () => {
    const before = [questionMessage(q)], deferred = questionMessage({ ...q, status: 'deferred', updatedAt: 2 });
    expect(mergeMessages(before, [deferred])[0].question?.status).toBe('deferred');
    expect(mergeMessages(before, [questionMessage(q)])).toBe(before);
  });
  it('does not hide a question inside collapsed process records', () => {
    const html = renderToStaticMarkup(AgentConversation({ messages: [questionMessage(q)], renderMessage: m => m.text }));
    expect(html).toContain('选择角色风格'); expect(html).not.toContain('agent-process-group');
  });
  it('shows the question status without changing standalone navigation', () => {
    const html = renderToStaticMarkup(AgentHeader({ page: 'chat', connected: true, active: true, waiting: false, questioning: true, onPage() {}, onView() {}, onClose() {} }));
    expect(html).toContain('等待回答');
    expect(html).toContain('项目记忆');
    expect(html).toContain('执行进度');
    expect(html).toContain('Skill（预留）');
  });
});
