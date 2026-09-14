import { useState } from 'react';
import type { AgentQuestion, QuestionAnswers } from '../../server/agent-questions.js';
import { UiIcon } from '../components/UiIcon';
import './AgentQuestionCard.css';

// Component-scope Hallmark: existing HEIYAN type, surface and focus tokens.
// Rest / hover / press / focus / loading / disabled / error / answered are explicit.
export function AgentQuestionCard({ question, connected, onAnswer, onTouch }: {
  question: AgentQuestion; connected: boolean;
  onAnswer: (id: string, answers?: QuestionAnswers) => Promise<void>; onTouch: (id: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ended = ['answered', 'cancelled'].includes(question.status);
  const complete = question.questions.every(q => values[q.id]?.trim());
  const submit = async (defer = false) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onAnswer(question.id, defer ? undefined : Object.fromEntries(question.questions.map(q => [q.id, { answers: [values[q.id].trim()] }]))); }
    catch (e) { setError(e instanceof Error ? e.message : '回答未能发送，内容已保留，请重试'); }
    finally { setBusy(false); }
  };
  const change = (id: string, value: string) => { setValues(previous => ({ ...previous, [id]: value })); onTouch(question.id); };
  return <section className="agent-question" data-status={question.status} aria-label="Agent 提问" aria-busy={busy}>
    <header><UiIcon name={ended ? 'check' : 'mention'} /><span>{question.status === 'answered' ? '已回答' : question.status === 'cancelled' ? '已停止提问' : question.status === 'deferred' ? '待你回来回答' : '需要你的想法'}</span></header>
    {question.questions.map((q, index) => <fieldset key={q.id} disabled={busy || ended}>
      <legend>{question.questions.length > 1 && <span>{index + 1}. </span>}{q.question}</legend>
      {ended ? <p className="agent-question-answer">{question.answers?.[q.id]?.answers.join('、') || '未作选择'}</p> : <>
        {!!q.options.length && <div className="agent-question-options">{q.options.map(option => <label key={option.label} data-selected={!custom[q.id] && values[q.id] === option.label}>
          <input type="radio" name={question.id + ':' + q.id} checked={!custom[q.id] && values[q.id] === option.label} onChange={() => { setCustom(previous => ({ ...previous, [q.id]: false })); change(q.id, option.label); }} />
          <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
        </label>)}</div>}
        {!!q.options.length && <label className="agent-question-other"><input type="radio" name={question.id + ':' + q.id} checked={custom[q.id] === true} onChange={() => { setCustom(previous => ({ ...previous, [q.id]: true })); change(q.id, ''); }} />自己填写</label>}
        {(!q.options.length || custom[q.id]) && (q.isSecret ? <input type="password" className="agent-question-text" autoComplete="off" aria-label={'私密回答：' + q.question} value={values[q.id] || ''} maxLength={4000} onFocus={() => onTouch(question.id)} onChange={event => change(q.id, event.target.value)} />
          : <textarea className="agent-question-text" rows={2} aria-label={'回答：' + q.question} placeholder="写下你的想法…" maxLength={4000} value={values[q.id] || ''} onFocus={() => onTouch(question.id)} onChange={event => change(q.id, event.target.value)} />)}
      </>}
    </fieldset>)}
    {!ended && <>
      {!connected && <p className="agent-question-hint">恢复 Agent 连接后即可回答。</p>}
      {question.status === 'deferred' && <p className="agent-question-hint">没有替你选择。回答后，Agent 会结合已有进展继续。</p>}
      {error && <p className="agent-question-error" role="alert"><UiIcon name="info" />{error}</p>}
      <footer>{question.status === 'pending' && <button type="button" disabled={busy || !connected} onClick={() => void submit(true)}>稍后回答，先继续</button>}<button type="button" className="agent-question-submit" disabled={busy || !complete || !connected} onClick={() => void submit()}>{busy ? '正在发送…' : '提交回答'}<UiIcon name="right" /></button></footer>
    </>}
  </section>;
}
