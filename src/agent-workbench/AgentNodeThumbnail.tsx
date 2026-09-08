import { ReferenceMediaThumbnail, type InputReference } from '../components/CanvasNodes';
import { UiIcon } from '../components/UiIcon';
import type { CanvasAgentItem } from './CanvasAgentDock';
export function AgentNodeThumbnail({ item }: { item: Pick<CanvasAgentItem, 'id' | 'kind' | 'reference'> }) {
  const r = item.reference;
  return r && ['image', 'video'].includes(r.type) ? <ReferenceMediaThumbnail reference={{ ...r, index: 1, edgeId: item.id, port: 'output' } as InputReference} />
    : <UiIcon name={item.kind.toLowerCase().includes('video') ? 'video' : item.kind.toLowerCase().includes('audio') ? 'audio' : item.kind.toLowerCase().includes('model') ? 'model3d' : item.kind === 'text' ? 'text' : 'image'} />;
}
