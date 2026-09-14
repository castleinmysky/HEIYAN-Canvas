import { useEffect, useRef, useState } from 'react';
import { cleanQuestion, questionAnswers, questionMessage, questionResult, questionText, QUESTION_WAIT_MS, type AgentQuestion, type Question, type QuestionAnswers } from '../../server/agent-questions.js';
import { agentRequest, type AgentConnection, type AgentMessage } from './agent-session';

type Waiting = { id: string; finish: (answers?: QuestionAnswers, cancelled?: boolean) => Promise<void>; touch: () => void };
export function useAgentQuestions(options: {
  canvasKey: string; messages: AgentMessage[]; connection: AgentConnection | null; api: boolean;
  record: (message: AgentMessage) => Promise<void>; followup: (text: string, requestId: string) => Promise<void>;
  refresh: () => Promise<void>; activity: (detail: string) => void;
}) {
  const current = useRef(options); current.current = options;
  const waiting = useRef<Waiting | null>(null);
  const policyKey = 'heiyan:question-policy:' + options.canvasKey.split('/')[0];
  const [policy, setPolicyState] = useState<'continue' | 'wait'>(() => {
    try { return localStorage.getItem(policyKey) === 'wait' ? 'wait' : 'continue'; } catch { return 'continue'; }
  });
  const policyRef = useRef(policy); policyRef.current = policy;
  const ask = async (questions: Question[], id: string, signal: AbortSignal): Promise<string> => {
    const now = Date.now();
    const question: AgentQuestion = { id, questions, source: 'api', status: 'pending', createdAt: now, updatedAt: now };
    await current.current.record(questionMessage(question));
    if (signal.aborted) throw Error('本轮已停止，问题保留在会话中');
    current.current.activity('等待你的回答');
    return new Promise<string>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined, settled = false, finishing = false;
      const abort = () => { settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); if (waiting.current?.id === id) waiting.current = null; reject(Error('本轮已停止，问题保留在会话中')); };
      const finish = async (answers?: QuestionAnswers, cancelled = false) => {
        if (settled || finishing) return;
        finishing = true;
        clearTimeout(timer);
        // Save the answer before releasing the model. Persistence failure leaves
        // the question waiting and visible; no silent consent or lost reply.
        try { await current.current.record(questionMessage(cleanQuestion({ ...question, answers, status: cancelled ? 'cancelled' : answers ? 'answered' : 'deferred', updatedAt: Date.now() }))); }
        catch (error) { finishing = false; throw error; }
        if (settled || signal.aborted) return;
        settled = true; signal.removeEventListener('abort', abort);
        if (waiting.current?.id === id) waiting.current = null;
        current.current.activity(answers ? '已收到回答，继续任务' : '问题已保留，先处理独立步骤');
        resolve(JSON.stringify(questionResult(question, answers)));
      };
      const touch = () => { clearTimeout(timer); if (policyRef.current === 'continue') timer = setTimeout(() => { void finish().catch(() => current.current.activity('问题保存失败，仍在等待回答；请重试')); }, QUESTION_WAIT_MS); };
      waiting.current = { id, finish, touch }; signal.addEventListener('abort', abort, { once: true }); touch();
    });
  };
  useEffect(() => {
    waiting.current?.touch();
    if (!options.api && options.connection?.capabilities?.includes('user_questions')) {
      void agentRequest(options.connection, '/question-policy', { canvasKey: options.canvasKey, policy }).catch(() => { /* Next state poll reports connectivity; never submit an answer here. */ });
    }
  }, [policy, options.connection, options.api, options.canvasKey]);
  const touchAt = useRef(0);
  const touch = (id: string) => {
    if (waiting.current?.id === id) { waiting.current.touch(); return; }
    const { connection, canvasKey, api } = current.current;
    if (!api && connection?.capabilities?.includes('user_questions') && Date.now() - touchAt.current > 10000) {
      touchAt.current = Date.now(); void agentRequest(connection, '/question-touch', { canvasKey, id }).catch(() => {});
    }
  };
  const reply = async (id: string, value?: QuestionAnswers) => {
    const { messages, connection, canvasKey, api, record, followup, refresh } = current.current;
    const question = messages.find(m => m.question?.id === id)?.question;
    if (!question || ['answered', 'cancelled'].includes(question.status)) throw Error('这个问题已经结束');
    const answers = value ? questionAnswers(question.questions, value) : undefined;
    if (waiting.current?.id === id) { await waiting.current.finish(answers); return; }
    if (!api && question.source === 'codex' && connection?.capabilities?.includes('user_questions')) {
      const response = await agentRequest(connection, '/question-answer', { canvasKey, id, answers, defer: !answers });
      if (!response.needsFollowup) { await record(questionMessage(response.question)); await refresh(); return; }
    }
    if (!answers) { await record(questionMessage({ ...question, status: 'deferred', updatedAt: Date.now() })); return; }
    // A refreshed API page has no live promise. Resume through an explicit new
    // user turn, never pretend the old model invocation is still connected.
    if (question.questions.some(q => q.isSecret)) throw Error('私密提问已结束，请重新提出该问题后回答；私密内容不会转发到普通会话');
    const answered = cleanQuestion({ ...question, answers, status: 'answered', updatedAt: Date.now() });
    const text = '回答之前的问题（' + id + '）：\n' + questionText(answered) + '\n请纳入当前任务，先核实已有结果，不重复执行已提交的操作。';
    if (text.length > 8000) throw Error('回答过长，请缩短到 8000 字以内后重试');
    await followup(text, 'answer:' + id);
    await record(questionMessage(answered));
    if (!api && connection?.capabilities?.includes('user_questions')) await agentRequest(connection, '/question-answer', { canvasKey, id, answers, followupDelivered: true });
  };
  const dismiss = async (ids: string[]) => {
    const { messages, record, connection, canvasKey, api } = current.current;
    for (const id of ids) {
      const question = messages.find(m => m.question?.id === id)?.question;
      if (!question || !['pending', 'deferred'].includes(question.status)) continue;
      if (waiting.current?.id === id) { await waiting.current.finish(undefined, true); continue; }
      await record(questionMessage(cleanQuestion({ ...question, status: 'cancelled', updatedAt: Date.now() })));
      if (!api && question.source === 'codex' && connection?.capabilities?.includes('user_questions')) {
        try { await agentRequest(connection, '/question-answer', { canvasKey, id, defer: true }); }
        catch { current.current.activity('提醒已清除；连接器未收到跳过通知。如仍在等待，可停止当前轮次。'); }
      }
    }
  };
  return { ask, reply, dismiss, touch, policy, waiting: options.messages.some(m => m.question?.status === 'pending'),
    setPolicy: (value: 'continue' | 'wait') => { try { localStorage.setItem(policyKey, value); } catch { /* Use this page's choice. */ } setPolicyState(value); } };
}
