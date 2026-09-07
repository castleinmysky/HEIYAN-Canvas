import type { Edge, Node } from '@xyflow/react';
import type { CanvasNodeData, CanvasNodeKind } from '../components/CanvasNodes';
import { agentKinds, validateAgentTool, type AgentContext, type AgentProposal } from '../../server/agent-contract.js';

type CanvasNode = Node<CanvasNodeData, CanvasNodeKind>;
export function canvasAgentRevision(nodes: unknown, edges: unknown) {
  const text = JSON.stringify([nodes, edges]);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
export function canvasAgentContext(nodes: CanvasNode[], edges: Edge[], referenceIds: string[]): AgentContext {
  return {
    revision: canvasAgentRevision(nodes, edges),
    nodes: nodes.slice(0, 200).map(node => ({ id: node.id, kind: node.data.kind, title: String(node.data.title || '').slice(0, 100),
      prompt: String(node.data.kind === 'text' ? node.data.text || '' : node.data.prompt || '').slice(0, 3000),
      state: String(node.data.jobState || ''), hasMedia: !!(node.data.mediaUrl || node.data.outputs?.length), model: String(node.data.modelId || '') })),
    edges: edges.slice(0, 500).map(edge => ({ source: edge.source, target: edge.target })), referenceIds: referenceIds.slice(0, 64),
  };
}

/** Preflight the entire proposal on copies. Commit once, only after approval. */
export function planAgentEdits(proposal: AgentProposal, originalNodes: CanvasNode[], originalEdges: Edge[], adapters: {
  create: (kind: CanvasNodeKind, index: number) => CanvasNode;
  connect: (source: string, target: string, nodes: CanvasNode[], edges: Edge[]) => Edge;
}) {
  const { operations } = validateAgentTool('heiyan_edit_canvas', proposal);
  let nodes = [...originalNodes], edges = [...originalEdges];
  const ids = new Map<string, string>(), changed = new Set<string>();
  const resolve = (id: string) => ids.get(id) || id;
  for (const operation of operations || []) {
    if (operation.action === 'create') {
      if (nodes.length >= 200) throw Error('当前画布节点过多，请先整理画布');
      if (ids.has(operation.id!) || nodes.some(node => node.id === operation.id)) throw Error('新节点标识重复');
      const node = adapters.create(operation.kind as CanvasNodeKind, ids.size);
      if (nodes.some(item => item.id === node.id)) throw Error('节点标识冲突');
      node.data = { ...node.data, title: operation.title!, ...(operation.prompt === undefined ? {} : node.data.kind === 'text' ? { text: operation.prompt } : { prompt: operation.prompt }) };
      ids.set(operation.id!, node.id); nodes.push(node); changed.add(node.id);
    } else if (operation.action === 'update') {
      const id = resolve(operation.id!), node = nodes.find(node => node.id === id);
      if (!node || !agentKinds.includes(node.data.kind)) throw Error('只能编辑当前画布中的文本或生成节点');
      if (['queued', 'running', 'paused', 'cancelling'].includes(String(node.data.jobState))) throw Error('节点任务尚未结束，请先在节点中处理');
      if (operation.title === undefined && operation.prompt === undefined) throw Error('没有需要修改的内容');
      nodes = nodes.map(item => item.id !== id ? item : { ...item, data: { ...item.data,
        ...(operation.title === undefined ? {} : { title: operation.title }),
        ...(operation.prompt === undefined ? {} : item.data.kind === 'text' ? { text: operation.prompt, html: undefined } : { prompt: operation.prompt }),
      } });
      changed.add(id);
    } else {
      const source = resolve(operation.source!), target = resolve(operation.target!);
      if (!nodes.some(node => node.id === source) || !nodes.some(node => node.id === target)) throw Error('连接节点不在当前画布中');
      const targetNode = nodes.find(node => node.id === target)!;
      if (['queued', 'running', 'paused', 'cancelling'].includes(String(targetNode.data.jobState))) throw Error('不能修改执行中节点的输入');
      edges.push(adapters.connect(source, target, nodes, edges)); changed.add(target);
    }
  }
  const stale = new Set(changed), visit = (id: string) => { for (const edge of edges) if (edge.source === id && !stale.has(edge.target)) { stale.add(edge.target); visit(edge.target); } };
  for (const id of changed) visit(id);
  nodes = nodes.map(node => stale.has(node.id) && (node.data.jobState === 'succeeded' || node.data.kind === 'result') ? { ...node, data: { ...node.data, stale: true, status: 'Agent 修改了前序内容，结果可能过期' } } : node);
  return { nodes, edges, result: JSON.stringify({ created: Object.fromEntries(ids), changed: [...changed], generated: false }) };
}
