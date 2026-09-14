import type { AgentMessage } from './agent-session';
import type { CanvasAgentItem } from './CanvasAgentDock';
import { AgentNodeThumbnail } from './AgentNodeThumbnail';
import { UiIcon } from '../components/UiIcon';

export function AgentMessageReferences({ references, items, locate }: {
  references: AgentMessage['nodeRefs']; items: CanvasAgentItem[]; locate: (id: string) => void;
}) {
  if (!references?.length) return null;
  return <div className="agent-message-references" aria-label="本条消息引用的节点">{references.map((ref, index) => {
    const item = items.find(item => item.id === ref.id);
    return <button type="button" key={ref.id} disabled={!item} title={item ? `${ref.title} · 查看当前节点` : `${ref.title} · 节点已不可用`} aria-label={`引用 ${index + 1}：${ref.title}`} onClick={() => locate(ref.id)}>
      <span className="agent-message-reference-thumb">{item ? <AgentNodeThumbnail item={item} /> : <UiIcon name="image" />}</span>
      <span>{ref.title}</span>
    </button>;
  })}</div>;
}
