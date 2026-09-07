import type { Edge, Node } from '@xyflow/react';
import { portDefinitions, runtimeInputPorts, type CanvasNodeData, type CanvasNodeKind, type ModelInfo } from '../components/CanvasNodes';
import { agentKinds, validateAgentTool, type AgentContext, type AgentProposal } from '../../server/agent-contract.js';

type CanvasNode = Node<CanvasNodeData, CanvasNodeKind>;
export function canvasAgentRevision(nodes: unknown, edges: unknown) {
  const text = JSON.stringify([nodes, edges]);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
export function canvasAgentContext(nodes: CanvasNode[], edges: Edge[], referenceIds: string[], models: ModelInfo[] = []): AgentContext {
  return {
    availableModels: models.slice(0, 100).map(model => ({ id: model.id, name: model.name, capability: model.capability, ratios: model.profile?.ratios || [], resolutions: model.profile?.resolutions || [], count: model.profile?.count, duration: model.profile?.duration })),
    revision: canvasAgentRevision(nodes, edges),
    selectedNodeIds: nodes.filter(node => node.selected).map(node => node.id), selectionKnown: true,
    nodes: nodes.slice(0, 200).map(node => ({ id: node.id, kind: node.data.kind, title: String(node.data.title || '').slice(0, 100),
      prompt: String(node.data.kind === 'text' ? node.data.text || '' : node.data.prompt || '').slice(0, 3000),
      settings: { ratio: node.data.ratio || '', resolution: node.data.resolution || '', count: node.data.count || 1, duration: node.data.duration || 0 },
      state: String(node.data.jobState || ''), hasMedia: !!(node.data.mediaUrl || node.data.outputs?.length), model: String(node.data.modelId || ''),
      outputType: String(node.data.kind === 'result' ? node.data.outputType || '' : node.data.kind === 'unsupported' ? '' : portDefinitions[node.data.kind].outputs[0]?.type || ''),
      inputs: node.data.kind === 'unsupported' ? [] : runtimeInputPorts(node.data.kind, node.data).map(port => ({ id: port.id, label: port.label, accepts: [...port.accepts], multiple: !!port.multiple })),
    })),
    edges: edges.slice(0, 500).map(edge => {
      const source = nodes.find(node => node.id === edge.source);
      return { id: edge.id, source: edge.source, sourcePort: String(edge.sourceHandle || 'output'), target: edge.target, targetPort: String(edge.targetHandle || ''), type: String(source && source.data.kind !== 'unsupported' ? (source.data.kind === 'result' ? source.data.outputType || '' : portDefinitions[source.data.kind].outputs[0]?.type || '') : '') };
    }), referenceIds: referenceIds.slice(0, 64),
  };
}

/** Preflight the entire proposal on copies. Commit once, only after approval. */
export function planAgentEdits(proposal: AgentProposal, originalNodes: CanvasNode[], originalEdges: Edge[], adapters: {
  configure?: (node: CanvasNode, operation: NonNullable<AgentProposal['operations']>[number]) => CanvasNode;
  duplicate?: (nodes: CanvasNode[], edges: Edge[], nodeIds: string[]) => { nodes: CanvasNode[]; edges: Edge[] };
  create: (kind: CanvasNodeKind, index: number) => CanvasNode;
  connect: (source: string, target: string, nodes: CanvasNode[], edges: Edge[], targetPort?: string) => Edge;
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
    } else if (operation.action === 'configure') {
      const id = resolve(operation.id!), node = nodes.find(node => node.id === id);
      if (!node || !adapters.configure) throw Error('配置节点不在当前画布中');
      if (['queued', 'running', 'paused', 'cancelling'].includes(String(node.data.jobState))) throw Error('不能修改执行中节点的参数');
      const configured = adapters.configure(node, operation);
      nodes = nodes.map(item => item.id === id ? configured : item); changed.add(id);
    } else if (operation.action === 'duplicate') {
      const selected = (operation.nodeIds || []).map(resolve);
      if (!selected.length || selected.some(id => !nodes.some(node => node.id === id)) || !adapters.duplicate) throw Error('请选择当前画布中需要复制的节点');
      const copies = adapters.duplicate(nodes, edges, selected);
      if (nodes.length + copies.nodes.length > 200) throw Error('复制后节点数量超过限制');
      nodes = [...nodes.map(node => ({ ...node, selected: false })), ...copies.nodes]; edges = [...edges, ...copies.edges];
    } else if (operation.action === 'select') {
      const selected = new Set((operation.nodeIds || []).map(resolve));
      if ([...selected].some(id => !nodes.some(node => node.id === id))) throw Error('选中节点不在当前画布中');
      nodes = nodes.map(node => ({ ...node, selected: selected.has(node.id) }));
    } else if (operation.action === 'move') {
      const id = resolve(operation.id!);
      if (!nodes.some(node => node.id === id)) throw Error('节点不在当前画布中');
      nodes = nodes.map(node => node.id === id ? { ...node, position: { x: operation.x!, y: operation.y! } } : node);
    } else if (operation.action === 'disconnect') {
      const edge = edges.find(edge => edge.id === operation.edgeId);
      if (!edge) throw Error('连线已不存在');
      const target = nodes.find(node => node.id === edge.target);
      if (['queued', 'running', 'paused', 'cancelling'].includes(String(target?.data.jobState))) throw Error('不能修改执行中节点的输入');
      edges = edges.filter(item => item.id !== edge.id); changed.add(edge.target);
    } else if (operation.action === 'delete') {
      const id = resolve(operation.id!), target = nodes.find(node => node.id === id);
      if (!target) throw Error('节点不在当前画布中');
      if (target.data.kind === 'collection' || nodes.some(node => node.parentId === id || node.data.memberIds?.includes(id))) throw Error('请先在画布解除分组再删除');
      const affected = new Set([id, ...edges.filter(edge => edge.source === id).map(edge => edge.target)]);
      if (nodes.some(node => affected.has(node.id) && ['queued', 'running', 'paused', 'cancelling'].includes(String(node.data.jobState)))) throw Error('不能删除执行中节点或其输入');
      edges.filter(edge => edge.source === id).forEach(edge => changed.add(edge.target));
      nodes = nodes.filter(node => node.id !== id); edges = edges.filter(edge => edge.source !== id && edge.target !== id);
    } else {
      const source = resolve(operation.source!), target = resolve(operation.target!);
      if (!nodes.some(node => node.id === source) || !nodes.some(node => node.id === target)) throw Error('连接节点不在当前画布中');
      const targetNode = nodes.find(node => node.id === target)!;
      if (['queued', 'running', 'paused', 'cancelling'].includes(String(targetNode.data.jobState))) throw Error('不能修改执行中节点的输入');
      edges.push(adapters.connect(source, target, nodes, edges, operation.targetPort)); changed.add(target);
    }
  }
  const stale = new Set(changed), visit = (id: string) => { for (const edge of edges) if (edge.source === id && !stale.has(edge.target)) { stale.add(edge.target); visit(edge.target); } };
  for (const id of changed) visit(id);
  nodes = nodes.map(node => stale.has(node.id) && (node.data.jobState === 'succeeded' || node.data.kind === 'result') ? { ...node, data: { ...node.data, stale: true, status: 'Agent 修改了前序内容，结果可能过期' } } : node);
  return { nodes, edges, result: JSON.stringify({ created: Object.fromEntries(ids), changed: [...changed], generated: false }) };
}
