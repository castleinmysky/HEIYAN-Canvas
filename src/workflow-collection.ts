export type WorkflowCollectionNodeLike = {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  measured?: { width?: number; height?: number };
  dragging?: boolean;
  data: {
    kind: string;
    title?: string;
    memberIds?: string[];
    collapsed?: boolean;
    jobId?: string;
    jobState?: string;
  };
};

export type WorkflowCollectionEdgeLike = { source: string; target: string };

export type WorkflowCollectionPositionChangeLike = {
  id?: string;
  type: string;
  position?: { x: number; y: number };
  dragging?: boolean;
};

export type WorkflowCollectionInputType = 'text' | 'image' | 'imageSet' | 'video' | 'audio' | 'model';

export type WorkflowCollectionInputNodeLike = WorkflowCollectionNodeLike & {
  data: WorkflowCollectionNodeLike['data'] & {
    text?: string;
    mediaUrl?: string;
    mediaType?: string;
    outputType?: string;
    fileName?: string;
    turnaroundConfirmed?: boolean;
  };
};

export type WorkflowCollectionInputSlot = {
  id: string;
  type: WorkflowCollectionInputType;
  label: string;
  nodeIds: string[];
  boundaryEdgeIds: string[];
  usageCount: number;
  duplicateCount: number;
  mediaUrl?: string;
  text?: string;
};

export type WorkflowCollectionRuntime = {
  memberIds: string[];
  collectionInputs: WorkflowCollectionInputSlot[];
  collectionInputCount: number;
  collectionOutputCount: number;
  collectionContentFrame?: ReturnType<typeof collectionFrameForNodes> extends infer Frame ? Exclude<Frame, null> : never;
};

export const workflowGeneratorKinds = new Set(['imageGenerator', 'videoGenerator', 'modelGenerator']);

export function collapsedCollectionMembershipSignature(nodes: readonly WorkflowCollectionNodeLike[]): string {
  return JSON.stringify(nodes
    .filter((node) => node.data.kind === 'collection')
    .map((node) => [node.id, Boolean(node.data.collapsed), node.data.memberIds || []]));
}

export function collectionFrameRepairSignature(nodes: readonly WorkflowCollectionNodeLike[]): string {
  return JSON.stringify(nodes.map((node) => [
    node.id,
    node.data.kind,
    node.position.x,
    node.position.y,
    node.measured?.width || node.width || 0,
    node.measured?.height || node.height || 0,
    Boolean(node.dragging),
    Boolean(node.data.collapsed),
    node.data.memberIds || [],
  ]));
}

export function collectionRuntimeNodeSignature(nodes: readonly WorkflowCollectionInputNodeLike[]): string {
  return JSON.stringify(nodes.map((node) => [
    node.id,
    node.data.kind,
    node.data.title || '',
    node.position.x,
    node.position.y,
    node.measured?.width || node.width || 0,
    node.measured?.height || node.height || 0,
    node.data.memberIds || [],
    node.data.text || '',
    node.data.mediaUrl || '',
    node.data.mediaType || '',
    node.data.outputType || '',
    Boolean(node.data.turnaroundConfirmed),
  ]));
}

export function collectionRuntimeEdgeSignature(edges: readonly (WorkflowCollectionEdgeLike & { id?: string })[]): string {
  return JSON.stringify(edges.map((edge) => [edge.id || '', edge.source, edge.target]));
}

/**
 * React Flow reports a position change for every selected node. When a
 * collection and its members are box-selected together, the members must not
 * also apply those direct changes or they move twice. This returns the single
 * authoritative member movement derived from the collection frame.
 */
export function collectionMemberPositionChanges(
  nodes: readonly WorkflowCollectionNodeLike[],
  changes: readonly WorkflowCollectionPositionChangeLike[],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const memberIds = new Set<string>();
  const memberChanges: Array<{ id: string; type: 'position'; position: { x: number; y: number }; dragging?: boolean }> = [];
  changes.forEach((change) => {
    if (change.type !== 'position' || !change.id || !change.position) return;
    const collection = nodeById.get(change.id);
    if (collection?.data.kind !== 'collection') return;
    const dx = change.position.x - collection.position.x;
    const dy = change.position.y - collection.position.y;
    (collection.data.memberIds || []).forEach((memberId) => {
      const member = nodeById.get(memberId);
      if (!member) return;
      memberIds.add(memberId);
      memberChanges.push({
        id: memberId,
        type: 'position',
        dragging: change.dragging,
        position: { x: member.position.x + dx, y: member.position.y + dy },
      });
    });
  });
  return { memberIds, memberChanges };
}

function concreteCollectionInputType(node: WorkflowCollectionInputNodeLike): WorkflowCollectionInputType | undefined {
  if (node.data.kind === 'text') return 'text';
  if (node.data.kind === 'image') return 'image';
  if (node.data.kind === 'video') return 'video';
  if (node.data.kind === 'audio') return 'audio';
  return undefined;
}

function collectionInputType(node: WorkflowCollectionInputNodeLike): WorkflowCollectionInputType | undefined {
  const concrete = concreteCollectionInputType(node);
  if (concrete) return concrete;
  const explicit = String(node.data.outputType || node.data.mediaType || '');
  if (['text', 'image', 'imageSet', 'video', 'audio', 'model'].includes(explicit)) return explicit as WorkflowCollectionInputType;
  if (node.data.kind === 'imageGenerator') return 'image';
  if (node.data.kind === 'videoGenerator') return 'video';
  if (node.data.kind === 'modelGenerator' || node.data.kind === 'characterAnimator') return 'model';
  if (node.data.kind === 'turnaroundSplitter' && node.data.turnaroundConfirmed) return 'imageSet';
  return undefined;
}

function normalizedCollectionInputIdentity(node: WorkflowCollectionInputNodeLike, type: WorkflowCollectionInputType) {
  if (type === 'text') {
    const text = String(node.data.text || '').replace(/\r\n/g, '\n').trim();
    return text ? `text:${text}` : `empty:${node.id}`;
  }
  const mediaUrl = String(node.data.mediaUrl || '').trim();
  return mediaUrl ? `${type}:${mediaUrl}` : `empty:${node.id}`;
}

type CollectionInputCandidate = {
  node: WorkflowCollectionInputNodeLike;
  boundaryEdgeIds: string[];
  usageCount: number;
};

function collectionInputSlotsFromCandidates(
  candidates: ReadonlyMap<string, CollectionInputCandidate>,
  members: ReadonlySet<string>,
): WorkflowCollectionInputSlot[] {
  const groups = new Map<string, CollectionInputCandidate[]>();
  candidates.forEach((candidate) => {
    const type = collectionInputType(candidate.node)!;
    const key = normalizedCollectionInputIdentity(candidate.node, type);
    const list = groups.get(key) || [];
    list.push(candidate);
    groups.set(key, list);
  });

  const slots = [...groups.values()].map((items) => {
    const first = items[0].node;
    const type = collectionInputType(first)!;
    const nodeIds = items.filter((item) => members.has(item.node.id)).map((item) => item.node.id).sort();
    const externalNodeIds = items.filter((item) => !members.has(item.node.id)).map((item) => item.node.id).sort();
    const identityId = nodeIds[0] || externalNodeIds[0] || first.id;
    const mediaUrl = type === 'text' ? undefined : String(first.data.mediaUrl || '').trim() || undefined;
    const text = type === 'text' ? String(first.data.text || '') : undefined;
    return {
      id: `input:${items.flatMap(item => item.boundaryEdgeIds).sort()[0] || identityId}`,
      type,
      label: first.data.title || `${type === 'text' ? '文本' : type === 'image' ? '图片' : type === 'imageSet' ? '多视图' : type === 'video' ? '视频' : type === 'audio' ? '音频' : '模型'}输入`,
      nodeIds,
      boundaryEdgeIds: items.flatMap((item) => item.boundaryEdgeIds).sort(),
      usageCount: items.reduce((total, item) => total + item.usageCount, 0),
      duplicateCount: items.length,
      sourceY: Math.min(...items.map((item) => Number(item.node.position?.y) || 0)),
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(text !== undefined ? { text } : {}),
    };
  });
  return slots.sort((left, right) => left.id.localeCompare(right.id)
    || left.label.localeCompare(right.label, 'zh-CN')
    || left.id.localeCompare(right.id))
    .map(({ sourceY: _sourceY, ...slot }) => slot);
}

/**
 * Builds the replaceable boundary ports for a collection. Identical, concrete
 * references collapse into one port, while empty inputs remain independent so
 * unrelated placeholders are never guessed together.
 */
export function collectionInputSlots(
  nodes: readonly WorkflowCollectionInputNodeLike[],
  edges: readonly (WorkflowCollectionEdgeLike & { id?: string })[],
  memberIds: readonly string[],
): WorkflowCollectionInputSlot[] {
  const members = new Set(memberIds);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const candidates = new Map<string, CollectionInputCandidate>();
  const candidateFor = (node: WorkflowCollectionInputNodeLike) => {
    const current = candidates.get(node.id) || { node, boundaryEdgeIds: [], usageCount: 0 };
    candidates.set(node.id, current);
    return current;
  };
  edges.forEach((edge) => {
    if (!members.has(edge.target)) return;
    const node = nodeById.get(edge.source);
    if (!node) return;
    if (members.has(edge.source)) {
      if (!concreteCollectionInputType(node)) return;
      candidateFor(node).usageCount += 1;
      return;
    }
    if (!collectionInputType(node)) return;
    const current = candidateFor(node);
    if (edge.id) current.boundaryEdgeIds.push(edge.id);
    current.usageCount += 1;
  });

  return collectionInputSlotsFromCandidates(candidates, members);
}

/**
 * Computes every collection's UI runtime in one graph pass. Nodes and edges
 * are indexed once, avoiding a complete canvas scan for each collection.
 */
export function collectionRuntimeIndex(
  nodes: readonly WorkflowCollectionInputNodeLike[],
  edges: readonly (WorkflowCollectionEdgeLike & { id?: string })[],
): Map<string, WorkflowCollectionRuntime> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const collections = nodes.filter((node) => node.data.kind === 'collection');
  const membersByCollection = new Map<string, Set<string>>();
  const collectionsByMember = new Map<string, string[]>();
  collections.forEach((collection) => {
    const members = new Set((collection.data.memberIds || []).filter((id) => nodeById.has(id)));
    membersByCollection.set(collection.id, members);
    members.forEach((memberId) => collectionsByMember.set(memberId, [...(collectionsByMember.get(memberId) || []), collection.id]));
  });

  const candidatesByCollection = new Map<string, Map<string, CollectionInputCandidate>>();
  const outputCountByCollection = new Map<string, number>();
  const candidateFor = (collectionId: string, node: WorkflowCollectionInputNodeLike) => {
    const candidates = candidatesByCollection.get(collectionId) || new Map<string, CollectionInputCandidate>();
    candidatesByCollection.set(collectionId, candidates);
    const current = candidates.get(node.id) || { node, boundaryEdgeIds: [], usageCount: 0 };
    candidates.set(node.id, current);
    return current;
  };

  edges.forEach((edge) => {
    const sourceNode = nodeById.get(edge.source);
    (collectionsByMember.get(edge.target) || []).forEach((collectionId) => {
      if (!sourceNode) return;
      const members = membersByCollection.get(collectionId)!;
      if (members.has(edge.source)) {
        if (concreteCollectionInputType(sourceNode)) candidateFor(collectionId, sourceNode).usageCount += 1;
        return;
      }
      if (!collectionInputType(sourceNode)) return;
      const current = candidateFor(collectionId, sourceNode);
      if (edge.id) current.boundaryEdgeIds.push(edge.id);
      current.usageCount += 1;
    });
    (collectionsByMember.get(edge.source) || []).forEach((collectionId) => {
      if (membersByCollection.get(collectionId)!.has(edge.target)) return;
      outputCountByCollection.set(collectionId, (outputCountByCollection.get(collectionId) || 0) + 1);
    });
  });

  return new Map(collections.map((collection) => {
    const members = membersByCollection.get(collection.id) || new Set<string>();
    const memberIds = [...members];
    const inputs = collectionInputSlotsFromCandidates(candidatesByCollection.get(collection.id) || new Map(), members);
    const memberNodes = memberIds.map((id) => nodeById.get(id)!).filter(Boolean);
    return [collection.id, {
      memberIds,
      collectionInputs: inputs,
      collectionInputCount: inputs.length,
      collectionOutputCount: outputCountByCollection.get(collection.id) || 0,
      collectionContentFrame: collectionFrameForNodes(memberNodes) || undefined,
    }];
  }));
}

/**
 * Keeps concrete root inputs outside a newly created collection. They remain
 * ordinary canvas nodes and become the collection's replaceable boundary
 * inputs, while downstream workflow nodes are grouped normally.
 */
export function collectionMemberIds(
  nodes: readonly WorkflowCollectionInputNodeLike[],
  edges: readonly WorkflowCollectionEdgeLike[],
  selectedIds: readonly string[],
) {
  const selected = new Set(selectedIds);
  const externalInputs = new Set(nodes
    .filter((node) => selected.has(node.id) && Boolean(concreteCollectionInputType(node)))
    .filter((node) => edges.some((edge) => edge.source === node.id && selected.has(edge.target) && edge.target !== node.id))
    .map((node) => node.id));
  return selectedIds.filter((id) => !externalInputs.has(id));
}

function nodeWidth(node: WorkflowCollectionNodeLike) {
  return Math.max(120, Number(node.measured?.width || node.width) || 300);
}

function nodeHeight(node: WorkflowCollectionNodeLike) {
  return Math.max(80, Number(node.measured?.height || node.height) || 180);
}

export function collectionFrameForNodes(nodes: readonly WorkflowCollectionNodeLike[]) {
  if (!nodes.length) return null;
  const paddingX = 42;
  const paddingBottom = 42;
  const headerHeight = 46;
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + nodeWidth(node)));
  const maxY = Math.max(...nodes.map((node) => node.position.y + nodeHeight(node)));
  return {
    position: { x: minX - paddingX, y: minY - headerHeight - 18 },
    width: Math.max(280, maxX - minX + paddingX * 2),
    height: Math.max(160, maxY - minY + headerHeight + paddingBottom + 18),
  };
}

/**
 * Expands an open collection only when a member crosses its safe content
 * boundary. Existing extra space is preserved so ordinary internal dragging
 * does not make the frame pulse or shrink.
 */
export function growCollectionFrameForNode(
  collection: WorkflowCollectionNodeLike & { width?: number; height?: number; data: WorkflowCollectionNodeLike['data'] & { collapsed?: boolean } },
  member: WorkflowCollectionNodeLike,
) {
  if (collection.data.collapsed || member.id === collection.id || member.data.kind === 'collection') return null;
  const paddingX = 42;
  const paddingBottom = 42;
  const paddingTop = 64;
  const currentLeft = collection.position.x;
  const currentTop = collection.position.y;
  // Explicit frame dimensions own layout; delayed DOM measurements must not
  // feed a resize back into the same frame during expand/collapse.
  const currentWidth = Number(collection.width) || nodeWidth(collection);
  const currentHeight = Number(collection.height) || nodeHeight(collection);
  const currentRight = currentLeft + currentWidth;
  const currentBottom = currentTop + currentHeight;
  const nextLeft = Math.min(currentLeft, member.position.x - paddingX);
  const nextTop = Math.min(currentTop, member.position.y - paddingTop);
  const nextRight = Math.max(currentRight, member.position.x + nodeWidth(member) + paddingX);
  const nextBottom = Math.max(currentBottom, member.position.y + nodeHeight(member) + paddingBottom);
  const width = nextRight - nextLeft;
  const height = nextBottom - nextTop;
  // Browser zoom / fractional pixel rounding is not a content-boundary change.
  if (Math.abs(nextLeft - currentLeft) < 1 && Math.abs(nextTop - currentTop) < 1 && width - currentWidth < 1 && height - currentHeight < 1) return null;
  return { position: { x: nextLeft, y: nextTop }, width, height };
}

/**
 * Repairs a manually resized expanded collection without scaling its member
 * nodes. Extra user-created space is preserved; only crossed content bounds
 * are expanded back into the frame.
 */
export function collectionFrameContainingMembers(
  collection: WorkflowCollectionNodeLike & { width?: number; height?: number; data: WorkflowCollectionNodeLike['data'] & { collapsed?: boolean } },
  members: readonly WorkflowCollectionNodeLike[],
) {
  if (collection.data.collapsed || !members.length) return null;
  let current = collection;
  let repaired = false;
  members.forEach((member) => {
    const frame = growCollectionFrameForNode(current, member);
    if (!frame) return;
    repaired = true;
    current = { ...current, ...frame, measured: { width: frame.width, height: frame.height } };
  });
  return repaired ? { position: current.position, width: nodeWidth(current), height: nodeHeight(current) } : null;
}

export function collectionCreationIssue(nodes: readonly WorkflowCollectionNodeLike[], ids: readonly string[]): string {
  const selectedIds = new Set(ids);
  const selected = nodes.filter((node) => selectedIds.has(node.id));
  if (selected.length < 2) return '至少选择 2 个未收纳节点';
  if (selected.some((node) => node.data.kind === 'collection')) return '已折叠的收纳不能再次收纳，请先展开或解散';
  const occupied = new Set(nodes
    .filter((node) => node.data.kind === 'collection')
    .flatMap((node) => node.data.memberIds || []));
  if (selected.some((node) => occupied.has(node.id))) return '选中内容已有节点在其他收纳中';
  return '';
}

export function workflowExecutionBatches(
  nodes: readonly WorkflowCollectionNodeLike[],
  edges: readonly WorkflowCollectionEdgeLike[],
  memberIds: readonly string[],
  requestedIds?: ReadonlySet<string>,
): string[][] {
  const members = new Set(memberIds);
  const generators = nodes
    .filter((node) => members.has(node.id) && workflowGeneratorKinds.has(node.data.kind) && (!requestedIds || requestedIds.has(node.id)))
    .map((node) => node.id);
  const generatorSet = new Set(generators);
  const indegree = new Map(generators.map((id) => [id, 0]));
  const outgoing = new Map(generators.map((id) => [id, [] as string[]]));
  edges.forEach((edge) => {
    if (!generatorSet.has(edge.source) || !generatorSet.has(edge.target) || edge.source === edge.target) return;
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  });
  const batches: string[][] = [];
  const remaining = new Set(generators);
  while (remaining.size) {
    const batch = generators.filter((id) => remaining.has(id) && (indegree.get(id) || 0) === 0);
    if (!batch.length) throw new Error('收纳内存在循环连接，无法自动执行');
    batches.push(batch);
    batch.forEach((id) => {
      remaining.delete(id);
      outgoing.get(id)?.forEach((target) => indegree.set(target, (indegree.get(target) || 0) - 1));
    });
  }
  return batches;
}

export function workflowIdsFromStart(
  nodes: readonly WorkflowCollectionNodeLike[],
  edges: readonly WorkflowCollectionEdgeLike[],
  memberIds: readonly string[],
  starts: readonly string[],
) {
  const members = new Set(memberIds);
  const requested = new Set<string>();
  const queue = [...starts.filter((id) => members.has(id))];
  const visited = new Set(queue);
  while (queue.length) {
    const source = queue.shift()!;
    const node = nodes.find((item) => item.id === source);
    if (node && workflowGeneratorKinds.has(node.data.kind)) requested.add(source);
    edges.forEach((edge) => {
      if (edge.source !== source || !members.has(edge.target) || visited.has(edge.target)) return;
      visited.add(edge.target);
      queue.push(edge.target);
    });
  }
  return requested;
}

export function remapCollectionMemberIds<T extends { kind?: string; memberIds?: string[] }>(data: T, idMap: ReadonlyMap<string, string>): T {
  if (data.kind !== 'collection' || !Array.isArray(data.memberIds)) return data;
  return {
    ...data,
    memberIds: data.memberIds.map((id) => idMap.get(id)).filter((id): id is string => Boolean(id)),
  };
}

export function expandedCollectionSelection(nodes: readonly WorkflowCollectionNodeLike[], selectedIds: ReadonlySet<string>) {
  const expanded = new Set(selectedIds);
  nodes.forEach((node) => {
    if (node.data.kind !== 'collection' || !selectedIds.has(node.id)) return;
    (node.data.memberIds || []).forEach((id) => expanded.add(id));
  });
  return expanded;
}

/**
 * Deleting a collection means deleting the complete package. Dissolving a
 * collection remains a separate explicit action that preserves its members.
 */
export function collectionDeletionNodeIds(
  nodes: readonly WorkflowCollectionNodeLike[],
  selectedIds: readonly string[],
): Set<string> {
  const deletion = new Set(selectedIds);
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((node) => {
      if (node.data.kind !== 'collection' || !deletion.has(node.id)) return;
      (node.data.memberIds || []).forEach((memberId) => {
        if (deletion.has(memberId)) return;
        deletion.add(memberId);
        changed = true;
      });
    });
  }
  return deletion;
}
