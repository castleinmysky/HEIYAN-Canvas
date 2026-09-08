import type { Node } from '@xyflow/react';
import type { AgentOperation } from '../../server/agent-contract.js';
export type SpatialNode = Pick<Node, 'id' | 'position' | 'parentId' | 'width' | 'height' | 'measured' | 'hidden'> & { data: Record<string, unknown> };
export type CanvasViewport = { x: number; y: number; width: number; height: number; zoom: number };
export function nodeBounds(node: SpatialNode, nodes: SpatialNode[]) {
  let x = node.position.x, y = node.position.y, parent = node.parentId;
  const seen = new Set([node.id]);
  while (parent && !seen.has(parent)) {
    seen.add(parent); const p = nodes.find(n => n.id === parent); if (!p) break;
    x += p.position.x; y += p.position.y; parent = p.parentId;
  }
  return { x, y, width: Math.max(1, node.measured?.width || node.width || 390), height: Math.max(1, node.measured?.height || node.height || 230) };
}
export function spatialInfo(node: SpatialNode, nodes: SpatialNode[], viewport?: CanvasViewport) {
  const bounds = nodeBounds(node, nodes);
  return { position: { ...node.position }, bounds, parentId: node.parentId || '',
    memberIds: Array.isArray(node.data.memberIds) ? node.data.memberIds.filter((id): id is string => typeof id === 'string').slice(0, 200) : [], memberCount: Array.isArray(node.data.memberIds) ? node.data.memberIds.length : 0,
    groupIds: nodes.filter(n => Array.isArray(n.data.memberIds) && n.data.memberIds.includes(node.id)).map(n => n.id),
    ...(viewport ? { visible: !node.hidden && bounds.x < viewport.x + viewport.width && bounds.x + bounds.width > viewport.x && bounds.y < viewport.y + viewport.height && bounds.y + bounds.height > viewport.y } : {}) };
}
/** Positions are planned in canvas coordinates and converted back to parent-local coordinates. */
export function layoutPositions(nodes: SpatialNode[], operation: AgentOperation) {
  const selected = (operation.nodeIds || []).map(id => nodes.find(n => n.id === id));
  if (!selected.length || selected.some(n => !n)) throw Error('排版节点已不存在，请重新读取画布');
  const live = selected as SpatialNode[], ids = new Set(live.map(n => n.id));
  if (ids.size !== live.length) throw Error('排版节点不能重复');
  for (const n of live) {
    let p = n.parentId; const seen = new Set<string>();
    while (p && !seen.has(p)) { if (ids.has(p)) throw Error('请分开排版分组与其中的节点'); seen.add(p); p = nodes.find(v => v.id === p)?.parentId; }
    if (Array.isArray(n.data.memberIds) && n.data.memberIds.some(id => ids.has(String(id)))) throw Error('请分开排版收纳与其中的节点');
  }
  const boxes = live.map(n => nodeBounds(n, nodes)), gap = operation.gap ?? 64;
  let x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  if (['right-of', 'below'].includes(operation.layout || '')) {
    const anchor = nodes.find(n => n.id === operation.anchorId);
    if (!anchor || ids.has(anchor.id)) throw Error('需要一个排版范围外的参考节点');
    const b = nodeBounds(anchor, nodes); x = b.x + (operation.layout === 'right-of' ? b.width + gap : 0); y = b.y + (operation.layout === 'below' ? b.height + gap : 0);
  }
  const columns = operation.columns || Math.ceil(Math.sqrt(live.length));
  const cellWidth = Math.max(...boxes.map(b => b.width)) + gap, cellHeight = Math.max(...boxes.map(b => b.height)) + gap;
  let cursorX = x, cursorY = y;
  return expandGroupMoves(nodes, new Map(live.map((node, i) => {
    const b = boxes[i]; let nextX = cursorX, nextY = cursorY;
    if (operation.layout === 'grid') { nextX = x + i % columns * cellWidth; nextY = y + Math.floor(i / columns) * cellHeight; }
    else if (operation.layout === 'align-left') { nextX = x; nextY = b.y; }
    else if (operation.layout === 'align-top') { nextX = b.x; nextY = y; }
    else if (['column', 'right-of'].includes(operation.layout || '')) cursorY += b.height + gap;
    else cursorX += b.width + gap;
    return [node.id, { x: nextX - (b.x - node.position.x), y: nextY - (b.y - node.position.y) }];
  })));
}
export function expandGroupMoves(nodes: SpatialNode[], requested: Map<string, { x: number; y: number }>) {
  const positions = new Map(requested), byId = new Map(nodes.map(n => [n.id, n])), owners = new Map<string, string>();
  for (const [rootId, next] of requested) {
    const root = byId.get(rootId); if (!root) throw Error('移动节点不存在');
    const dx = next.x - root.position.x, dy = next.y - root.position.y, members = new Set<string>(), visited = new Set([rootId]);
    const collect = (node: SpatialNode) => {
      for (const id of Array.isArray(node.data.memberIds) ? node.data.memberIds : []) {
        if (typeof id !== 'string' || visited.has(id)) continue;
        visited.add(id); const member = byId.get(id); if (!member) continue;
        members.add(id); collect(member);
      }
    };
    collect(root);
    for (const id of members) {
      const member = byId.get(id)!;
      if (requested.has(id) || owners.has(id) && owners.get(id) !== rootId) throw Error('排版范围包含重复的分组成员，请分开处理');
      owners.set(id, rootId);
      let parent = member.parentId, follows = false; const parents = new Set<string>();
      while (parent && !parents.has(parent)) { parents.add(parent); if (requested.has(parent) || members.has(parent)) { follows = true; break; } parent = byId.get(parent)?.parentId; }
      if (!follows) positions.set(id, { x: member.position.x + dx, y: member.position.y + dy });
    }
  }
  for (const p of positions.values()) if (![p.x, p.y].every(v => Number.isFinite(v) && Math.abs(v) <= 100000)) throw Error('排版位置超出画布操作范围，请缩小间距或分批处理');
  return positions;
}
export function layoutWarnings(nodes: SpatialNode[], affected: string[]) {
  const selected = new Set(affected), warnings: string[] = [];
  const boxes = new Map(nodes.map(n => [n.id, nodeBounds(n, nodes)]));
  for (const n of nodes.filter(v => selected.has(v.id) && !v.hidden)) {
    const a = boxes.get(n.id)!;
    for (const other of nodes) {
      if (n.id === other.id || other.hidden || n.parentId === other.id || other.parentId === n.id || Array.isArray(other.data.memberIds) && other.data.memberIds.includes(n.id) || Array.isArray(n.data.memberIds) && n.data.memberIds.includes(other.id)) continue;
      const b = boxes.get(other.id)!;
      if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 8 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 8) {
        const label = `「${String(n.data.title || n.id)}」与「${String(other.data.title || other.id)}」可能重叠`;
        if (!warnings.includes(label)) warnings.push(label);
        if (warnings.length === 8) return warnings;
      }
    }
  }
  return warnings;
}
