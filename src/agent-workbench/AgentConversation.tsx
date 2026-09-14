import { Fragment, useState, type ReactNode } from 'react';
import { conversationTimeLabel, needsConversationTime, messageTime } from './conversation-time';
import type { AgentMessage } from './agent-session';
import type { ExecutionReceipt } from './agent-memory';
import { canvasCapability } from '../../server/agent-capabilities.js';

export function isProcessMessage(message: AgentMessage, receipts: readonly ExecutionReceipt[] = []) {
  if (message.role !== 'notice' || message.question) return false;
  if (!message.id.startsWith('execution:')) return !/失败|错误|未核实|需.{0,4}确认|中断|未执行/.test(message.text);
  const receipt = receipts.find(r => r.id === message.id.slice(10));
  if (receipt?.status !== 'succeeded') return false;
  if (receipt.tool === 'heiyan_canvas_capabilities' || receipt.tool === 'heiyan_project_checkpoint') return true;
  if (receipt.tool === 'heiyan_canvas_action') {
    try { const data = JSON.parse(receipt.result); return data.status !== 'needs_user' && ['read', 'view'].includes(canvasCapability(data.action)?.risk || ''); } catch { return false; }
  }
  return false;
}
// Older connectors saved a generated steering label as part of user text.
// Presentation compatibility only: keep stored history and model input intact.
export function displayConversationMessage(message: AgentMessage): AgentMessage {
  return message.role === 'user' && message.text.startsWith('补充要求：')
    ? { ...message, text: message.text.slice('补充要求：'.length) } : message;
}

// Presentation groups retain chronological order and original message IDs.
// A group ending does not imply that generation has succeeded.
export function conversationGroups(messages: AgentMessage[]) {
  const groups: { id: string; messages: AgentMessage[] }[] = [];
  for (const message of messages) {
    if (!groups.length || message.role === 'user') groups.push({ id: message.id, messages: [] });
    groups[groups.length - 1].messages.push(message);
  }
  return groups;
}
function ProcessMessages({ messages, renderMessage, reveal }: { messages: AgentMessage[]; renderMessage: (message: AgentMessage) => ReactNode; reveal?: string | null }) {
  const [open, setOpen] = useState(false);
  const shown = open || messages.some(m => m.id === reveal);
  // Background bookkeeping stays out of normal conversation. Only an explicit
  // history/search navigation to a record can reveal it here.
  if (!messages.some(m => m.id === reveal)) return null;
  return <details className="agent-process-group" open={shown} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><span>过程记录 · {messages.length}</span><span aria-hidden="true">›</span></summary>
    {shown && <div>{messages.map(renderMessage)}</div>}
  </details>;
}

export function AgentConversation({ messages, renderMessage, reveal, receipts = [], canvasKey = '' }: {
  messages: AgentMessage[]; renderMessage: (message: AgentMessage) => ReactNode; reveal?: string | null; receipts?: readonly ExecutionReceipt[]; canvasKey?: string;
}) {
  let previousTime: number | undefined;
  const renderTimed = (message: AgentMessage) => {
    const time = messageTime(canvasKey, message.id) || message.question?.createdAt;
    const show = needsConversationTime(time, previousTime);
    if (time) previousTime = time;
    return <Fragment key={message.id}>{show && <time className="agent-conversation-time" dateTime={new Date(time!).toISOString()}>{conversationTimeLabel(time!)}</time>}{renderMessage(displayConversationMessage(message))}</Fragment>;
  };
  return <>{conversationGroups(messages).map(group => {
    const blocks: { id: string; notices: boolean; messages: AgentMessage[] }[] = [];
    let process: typeof blocks[number] | undefined;
    const reviews = new Set<string>();
    for (const message of group.messages) {
      const receipt = message.id.startsWith('execution:') ? receipts.find(r => r.id === message.id.slice(10)) : undefined;
      const reviewKey = receipt?.tool === 'heiyan_review_result' && receipt.status === 'succeeded' ? receipt.result : '';
      const duplicate = !!reviewKey && reviews.has(reviewKey);
      if (reviewKey) reviews.add(reviewKey);
      const notices = isProcessMessage(message, receipts) || duplicate;
      if (notices) {
        if (!process) { process = { id: 'process:' + group.id, notices: true, messages: [] }; blocks.push(process); }
        process.messages.push(message);
      } else blocks.push({ id: message.id, notices: false, messages: [message] });
    }
    return <section className="agent-conversation-turn" key={group.id} aria-label="请求与相关回复">
      {blocks.map(block => block.notices ? <ProcessMessages key={block.id} messages={block.messages} renderMessage={renderMessage} reveal={reveal} /> : block.messages.map(renderTimed))}
    </section>;
  })}</>;
}
