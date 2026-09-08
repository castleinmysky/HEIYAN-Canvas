import type { Edge } from '@xyflow/react';
import { runtimeInputPorts, type CanvasNode } from '../components/CanvasNodes';
import type { AgentContext } from '../../server/agent-contract.js';
import { nodeBounds } from './agent-spatial';
export type PreviewChange = { id: string; title: string; kind: string; action: string; exists: boolean; fields: Array<{ label: string; before: string; after: string }> };
export type AgentEditPreview = { revision: string; changes: PreviewChange[]; warnings: string[]; count: number };
const value = (v: unknown) => v === undefined || v === null || v === '' ? '未设置' : String(v);
export function editPreview(before: CanvasNode[], after: CanvasNode[], previousEdges: Edge[], nextEdges: Edge[], revision: string, warnings: string[], models: NonNullable<AgentContext['availableModels']> = []): AgentEditPreview {
  const names = new Map([...before, ...after].map(n => [n.id, String(n.data.title || n.id)]));
  const beforeMap = new Map(before.map(n => [n.id, n])), afterMap = new Map(after.map(n => [n.id, n]));
  const inputs = (edges: Edge[]) => { const result = new Map<string, string[]>(); for (const e of edges) { const list = result.get(e.target) || [], target = afterMap.get(e.target) || beforeMap.get(e.target); const label = target && target.data.kind !== 'unsupported' ? runtimeInputPorts(target.data.kind, target.data).find(p => p.id === e.targetHandle)?.label : ''; list.push(`${names.get(e.source) || '来源节点'}${e.targetHandle ? ` · ${label || '指定输入'}` : ''}`); result.set(e.target, list); } return result; };
  const previousInputs = inputs(previousEdges), nextInputs = inputs(nextEdges);
  const changes: PreviewChange[] = [];
  for (const id of new Set([...before.map(n => n.id), ...after.map(n => n.id)])) {
    const old = beforeMap.get(id), next = afterMap.get(id), node = next || old!;
    const fields: PreviewChange['fields'] = [];
    const field = (label: string, a: unknown, b: unknown) => { if (value(a) !== value(b)) fields.push({ label, before: value(a), after: value(b) }); };
    field('名称', old?.data.title, next?.data.title);
    field('描述', old?.data.kind === 'text' ? old.data.text : old?.data.prompt, next?.data.kind === 'text' ? next.data.text : next?.data.prompt);
    field('模型', models.find(m => m.id === old?.data.modelId)?.name || old?.data.modelId, models.find(m => m.id === next?.data.modelId)?.name || next?.data.modelId);
    for (const [key, label] of [['ratio', '比例'], ['resolution', '分辨率'], ['count', '数量'], ['duration', '时长（秒）']] as const) field(label, old?.data[key], next?.data[key]);
    const a = old && nodeBounds(old, before), b = next && nodeBounds(next, after);
    field('画布位置', a ? `${Math.round(a.x)}, ${Math.round(a.y)}` : undefined, b ? `${Math.round(b.x)}, ${Math.round(b.y)}` : undefined);
    field('输入引用', old ? previousInputs.get(id)?.join('、') || '无' : undefined, next ? nextInputs.get(id)?.join('、') || '无' : undefined);
    if (old && next && old.selected !== next.selected) field('选择状态', old.selected ? '选中' : '未选中', next.selected ? '选中' : '未选中');
    if (!old || !next || fields.length) changes.push({ id, title: String(node.data.title || '未命名节点'), kind: node.data.kind, action: !old ? '新增' : !next ? '移除' : fields.every(f => f.label === '画布位置') ? '移动' : '修改', exists: !!old, fields });
  }
  return { revision, changes: changes.slice(0, 60), warnings, count: changes.length };
}
