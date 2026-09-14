import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentConversation, isProcessMessage } from './AgentConversation';
import type { AgentMessage } from './agent-session';
it('combines interleaved notices into one collapsed process per user turn', () => {
  const messages: AgentMessage[] = [{ id: 'u', role: 'user', text: '继续' }, { id: 'n1', role: 'notice', text: '已读取' }, { id: 'a', role: 'assistant', text: '正在调整' }, { id: 'n2', role: 'notice', text: '记忆已保存' }];
  const html = renderToStaticMarkup(<AgentConversation messages={messages} renderMessage={m => <p key={m.id}>{m.text}</p>} />);
  expect(html).not.toContain('agent-process-group');
  expect(html).not.toContain('过程记录'); expect(html).toContain('正在调整');
  expect(html).not.toContain('记忆已保存');
});
it('keeps failures, questions and unverified outcomes visible', () => {
  expect(isProcessMessage({ id: 'n', role: 'notice', text: '连接中断' })).toBe(false);
  expect(isProcessMessage({ id: 'execution:r', role: 'notice', text: '失败' }, [{ id: 'r', tool: 'heiyan_canvas_capabilities', status: 'failed', result: '失败', at: 0 }])).toBe(false);
});
it('folds successful read receipts but preserves edits', () => {
  const m: AgentMessage = { id: 'execution:r', role: 'notice', text: '已查询' };
  const receipt = { id: 'r', tool: 'heiyan_canvas_capabilities', status: 'succeeded' as const, result: '{}', at: 0 };
  expect(isProcessMessage(m, [receipt])).toBe(true);
  expect(isProcessMessage(m, [{ ...receipt, tool: 'heiyan_edit_canvas' }])).toBe(false);
});
it('keeps identical reviews once in main flow and keeps originals revealable', () => {
  const messages: AgentMessage[] = ['a', 'b'].map(id => ({ id: 'execution:' + id, role: 'notice', text: '未核实' }));
  const receipts = ['a', 'b'].map(id => ({ id, tool: 'heiyan_review_result', status: 'succeeded' as const, result: '{"nodeId":"one","verdict":"uncertain"}', at: 0 }));
  const renderMessage = (m: AgentMessage) => <p key={m.id}>{m.text}</p>;
  const html = renderToStaticMarkup(<AgentConversation messages={messages} receipts={receipts} renderMessage={renderMessage} />);
  expect(html.match(/未核实/g)).toHaveLength(1);
  const revealed = renderToStaticMarkup(<AgentConversation messages={messages} receipts={receipts} renderMessage={renderMessage} reveal="execution:b" />);
  expect(revealed.match(/未核实/g)).toHaveLength(2);
});
