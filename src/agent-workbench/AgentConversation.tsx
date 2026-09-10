import type { ReactNode } from 'react';
import type { AgentMessage } from './agent-session';

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

export function AgentConversation({ messages, renderMessage }: {
  messages: AgentMessage[]; renderMessage: (message: AgentMessage) => ReactNode;
}) {
  return <>{conversationGroups(messages).map(group => {
    const blocks: { id: string; notices: boolean; messages: AgentMessage[] }[] = [];
    for (const message of group.messages) {
      const notices = message.role === 'notice' && !message.id.startsWith('execution:');
      const previous = blocks[blocks.length - 1];
      if (notices && previous?.notices) previous.messages.push(message);
      else blocks.push({ id: message.id, notices, messages: [message] });
    }
    return <section className="agent-conversation-turn" key={group.id} aria-label="请求与相关回复">
      {blocks.map(block => block.notices ? <details className="agent-process-group" key={block.id}>
        <summary><span>过程记录 · {block.messages.length}</span><span aria-hidden="true">›</span></summary>
        <div>{block.messages.map(renderMessage)}</div>
      </details> : block.messages.map(renderMessage))}
    </section>;
  })}</>;
}
