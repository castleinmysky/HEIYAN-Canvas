import { useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Edge, OnNodeDrag } from '@xyflow/react';
import type { CanvasNode, CanvasNodeData } from './components/CanvasNodes';
import { collapsedCollectionMembershipSignature, collectionCreationIssue, collectionFrameContainingMembers, collectionFrameForNodes, collectionFrameRepairSignature, collectionMemberIds, collectionRuntimeEdgeSignature, collectionRuntimeIndex, collectionRuntimeNodeSignature, workflowExecutionBatches, workflowIdsFromStart } from './workflow-collection';

type Confirmation = { eyebrow: string; title: string; message: string; confirmLabel: string; tone: 'paid' | 'danger' };
type WorkflowState = NonNullable<CanvasNodeData['workflowState']>;
type TerminalState = 'succeeded' | 'failed' | 'cancelled' | 'paused';
type WorkflowRunHandle = { controller: AbortController; completion: Promise<void> };
const activeWorkflowJobStates = new Set(['queued', 'running']);

type Options = {
  nodes: CanvasNode[];
  edges: Edge[];
  nodesRef: MutableRefObject<CanvasNode[]>;
  edgesRef: MutableRefObject<Edge[]>;
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  runGenerator: (id: string) => Promise<string | undefined>;
  pushHistory: () => void;
  requestConfirmation: (confirmation: Confirmation) => Promise<boolean>;
  setToast: (message: string) => void;
  disabled?: boolean;
};

function workflowPatch(state: WorkflowState, status: string, progress: number, failedNodeIds: string[] = []) {
  return { workflowState: state, workflowStatus: status, workflowProgress: progress, workflowFailedNodeIds: failedNodeIds } satisfies Partial<CanvasNodeData>;
}

export function waitForWorkflowTerminal(nodesRef: MutableRefObject<CanvasNode[]>, id: string, expectedJobId?: string, signal?: AbortSignal, timeoutMs = 48 * 60 * 60 * 1000) {
  return new Promise<TerminalState>((resolve, reject) => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, state?: TerminalState) => {
      if (timer !== undefined) globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(state!);
    };
    const onAbort = () => finish(new DOMException('流程已取消', 'AbortError'));
    const tick = () => {
      if (signal?.aborted) return onAbort();
      const node = nodesRef.current.find((item) => item.id === id);
      if (!node) return finish(new Error('执行节点已被删除'));
      if (expectedJobId && node.data.jobId !== expectedJobId) return finish(new Error('节点任务已被其他操作替换，整组已停止等待'));
      const state = node.data.jobState;
      if (state === 'succeeded' || state === 'failed' || state === 'cancelled' || state === 'paused') return finish(undefined, state);
      if (Date.now() - started > timeoutMs) return finish(new Error('等待任务状态超时'));
      timer = globalThis.setTimeout(tick, 250);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    tick();
  });
}

export function workflowNodeHasActiveJob(node?: CanvasNode) {
  return Boolean(node && activeWorkflowJobStates.has(String(node.data.jobState || '')));
}

export function waitForWorkflowJobId(nodesRef: MutableRefObject<CanvasNode[]>, id: string, signal?: AbortSignal, timeoutMs = 120_000) {
  return new Promise<string>((resolve, reject) => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, jobId?: string) => {
      if (timer !== undefined) globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(jobId!);
    };
    const onAbort = () => finish(new DOMException('流程已取消', 'AbortError'));
    const tick = () => {
      if (signal?.aborted) return onAbort();
      const node = nodesRef.current.find((item) => item.id === id);
      if (!node) return finish(new Error('执行节点已被删除'));
      const jobId = String(node.data.jobId || '').trim();
      if (jobId) return finish(undefined, jobId);
      if (!workflowNodeHasActiveJob(node)) {
        return finish(new Error(`${node.data.title || '生成节点'}：${node.data.status || '现有任务未能完成提交'}`));
      }
      if (Date.now() - started > timeoutMs) return finish(new Error('等待现有任务提交超时'));
      timer = globalThis.setTimeout(tick, 100);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    tick();
  });
}

export function useWorkflowCollections(options: Options) {
  const { nodes, edges, nodesRef, edgesRef, setNodes, runGenerator, pushHistory, requestConfirmation, setToast, disabled } = options;
  const runs = useRef(new Map<string, WorkflowRunHandle>());
  const collectionDrag = useRef<{ id: string; origin: { x: number; y: number }; members: Map<string, { x: number; y: number }> } | null>(null);

  const updateCollection = useCallback((id: string, patch: Partial<CanvasNodeData>) => {
    const next = nodesRef.current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node);
    nodesRef.current = next;
    setNodes(next);
  }, [nodesRef, setNodes]);

  const frameRepairSignature = useMemo(() => collectionFrameRepairSignature(nodes), [nodes]);
  useEffect(() => {
    if (!nodes.some((node) => node.data.kind === 'collection' && node.data.workflowState === 'cancelling')) return;
    const next = nodes.map((node) => node.data.kind === 'collection' && node.data.workflowState === 'cancelling'
      ? { ...node, data: { ...node.data, ...workflowPatch('cancelled', '整组控制已停止；已提交任务仍会继续生成', Number(node.data.workflowProgress) || 0) } }
      : node);
    nodesRef.current = next;
    setNodes(next);
  }, [frameRepairSignature, nodesRef, setNodes]);

  useEffect(() => {
    if (nodes.some((node) => node.dragging)) return;
    const repairs = new Map<string, { position: { x: number; y: number }; width: number; height: number }>();
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    nodes.forEach((collection) => {
      if (collection.data.kind !== 'collection' || collection.data.collapsed) return;
      const members = (collection.data.memberIds || []).map((id) => nodeById.get(id)!).filter(Boolean);
      const frame = collectionFrameContainingMembers(collection, members);
      if (frame) repairs.set(collection.id, frame);
    });
    if (!repairs.size) return;
    const next = nodes.map((node) => {
      const frame = repairs.get(node.id);
      return frame ? {
        ...node,
        position: frame.position,
        width: frame.width,
        height: frame.height,
        measured: { width: frame.width, height: frame.height },
        style: { ...node.style, width: frame.width, height: frame.height },
        data: { ...node.data, expandedWidth: frame.width, expandedHeight: frame.height },
      } : node;
    });
    nodesRef.current = next;
    setNodes(next);
  }, [frameRepairSignature, nodesRef, setNodes]);

  const createCollection = useCallback((ids: readonly string[]) => {
    const issue = collectionCreationIssue(nodesRef.current, ids);
    if (issue) { setToast(issue); return ''; }
    const members = collectionMemberIds(nodesRef.current, edgesRef.current, ids);
    const selected = nodesRef.current.filter((node) => members.includes(node.id));
    if (!selected.length) { setToast('没有可收纳的流程节点'); return ''; }
    if (selected.length > 99) { setToast('一次最多收纳 99 个节点'); return ''; }
    const frame = collectionFrameForNodes(selected);
    if (!frame) return '';
    pushHistory();
    const id = `collection-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const collectionLayer = Math.max(2, ...nodesRef.current.map((node) => Number(node.zIndex) || 0)) + 1;
    const memberLayer = collectionLayer + 1;
    const collection: CanvasNode = {
      id, type: 'collection', position: frame.position, width: 200, height: 116, selected: true,
      dragHandle: '.collection-node', zIndex: collectionLayer,
      data: { kind: 'collection', title: '未命名收纳', memberIds: members, collapsed: true, expandedWidth: frame.width, expandedHeight: frame.height, executable: true, ...workflowPatch('idle', '已收纳，右键查看内容', 0) } as CanvasNodeData,
    };
    const memberSet = new Set(members);
    const next = [collection, ...nodesRef.current.map((node) => ({
      ...node,
      selected: false,
      ...(memberSet.has(node.id) ? { zIndex: memberLayer } : {}),
    }))];
    nodesRef.current = next;
    setNodes(next);
    const externalInputCount = ids.length - members.length;
    setToast(externalInputCount
      ? `已收纳 ${selected.length} 个流程节点，${externalInputCount} 个输入保留在组合外`
      : `已收纳并折叠 ${selected.length} 个节点`);
    return id;
  }, [edgesRef, nodesRef, pushHistory, setNodes, setToast]);

  const setCollectionCollapsed = useCallback((id: string, collapsed: boolean) => {
    const current = nodesRef.current.find((node) => node.id === id && node.data.kind === 'collection');
    if (!current || Boolean(current.data.collapsed) === collapsed) return;
    pushHistory();
    const toggled = nodesRef.current.map((node) => {
      if (node.id !== id || node.data.kind !== 'collection') return node;
      const width = collapsed ? 200 : node.data.expandedWidth || 360;
      const height = collapsed ? 116 : node.data.expandedHeight || 220;
      return { ...node, width, height, measured: { width, height }, style: { ...node.style, width, height }, selected: true,
        data: { ...node.data, collapsed, ...(collapsed ? { expandedWidth: node.width || 360, expandedHeight: node.height || 220 } : {}) } };
    });
    const collection = toggled.find((node) => node.id === id && node.data.kind === 'collection');
    const next = toggled.map((node) => collection?.data.memberIds?.includes(node.id) ? { ...node, selected: false } : node);
    nodesRef.current = next;
    setNodes(next);
  }, [nodesRef, pushHistory, setNodes]);

  const dissolveCollection = useCallback((id: string) => {
    const collection = nodesRef.current.find((node) => node.id === id && node.data.kind === 'collection');
    if (!collection) return;
    const activeRun = runs.current.get(id);
    activeRun?.controller.abort();
    runs.current.delete(id);
    pushHistory();
    const members = new Set(collection.data.memberIds || []);
    const next = nodesRef.current.filter((node) => node.id !== id).map((node) => members.has(node.id) ? { ...node, selected: true, zIndex: undefined } : { ...node, selected: false });
    nodesRef.current = next;
    setNodes(next);
    setToast(activeRun
      ? '已解散收纳；已提交任务继续生成，尚未提交的后续节点不再运行'
      : '已解散收纳，节点和连线位置保持不变');
  }, [nodesRef, pushHistory, setNodes, setToast]);

  const runCollection = useCallback(async (id: string, startNodeId?: string) => {
    if (disabled || runs.current.has(id)) return;
    const collection = nodesRef.current.find((node) => node.id === id && node.data.kind === 'collection');
    if (!collection) return;
    const members = collection.data.memberIds || [];
    const resumeStarts = startNodeId ? [startNodeId] : collection.data.workflowState === 'failed' ? collection.data.workflowFailedNodeIds || [] : [];
    const requested = resumeStarts.length ? workflowIdsFromStart(nodesRef.current, edgesRef.current, members, resumeStarts) : undefined;
    let batches: string[][];
    try { batches = workflowExecutionBatches(nodesRef.current, edgesRef.current, members, requested); }
    catch (error) { const message = error instanceof Error ? error.message : '流程无法执行'; updateCollection(id, workflowPatch('failed', message, 0)); setToast(message); return; }
    const generatorIds = batches.flat();
    if (!generatorIds.length) { setToast('收纳内没有可执行的生成节点'); return; }
    const adoptedJobs = new Map(generatorIds.flatMap((nodeId) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      return workflowNodeHasActiveJob(node) ? [[nodeId, String(node?.data.jobId || '').trim()]] : [];
    }));
    const submissionIds = generatorIds.filter((nodeId) => !adoptedJobs.has(nodeId));
    const executionSummary = adoptedJobs.size
      ? `检测到 ${adoptedJobs.size} 个节点正在排队或生成，将等待现有任务，不会重复提交；其余 ${submissionIds.length} 个节点按连线顺序运行。`
      : `将按连线顺序执行 ${generatorIds.length} 个生成节点，独立分支会并行运行。`;
    const accepted = await requestConfirmation({
      eyebrow: 'WORKFLOW', title: startNodeId ? '从此运行' : resumeStarts.length ? '继续运行' : '运行整组', tone: 'paid', confirmLabel: '确认运行',
      message: `${executionSummary}${submissionIds.length ? '其中可能包含你配置的外部模型服务，是否收费由对应服务商决定。' : '本次不会新建生成任务。'}`,
    });
    if (!accepted) return;
    const controller = new AbortController();
    updateCollection(id, workflowPatch('running', `准备执行 ${generatorIds.length} 个生成节点`, 0));
    let completed = 0;
    const completion = (async () => {
      try {
        for (const batch of batches) {
          const settled = await Promise.allSettled(batch.map(async (nodeId) => {
            if (controller.signal.aborted) throw new DOMException('流程已取消', 'AbortError');
            updateCollection(id, workflowPatch('running', `正在执行 ${completed + 1}/${generatorIds.length}`, completed / generatorIds.length * 100));
            const currentNode = nodesRef.current.find((item) => item.id === nodeId);
            const shouldAdopt = adoptedJobs.has(nodeId) || workflowNodeHasActiveJob(currentNode);
            const submittedJobId = shouldAdopt
              ? adoptedJobs.get(nodeId) || String(currentNode?.data.jobId || '').trim() || await waitForWorkflowJobId(nodesRef, nodeId, controller.signal)
              : await runGenerator(nodeId);
            if (!submittedJobId) {
              const rejected = nodesRef.current.find((node) => node.id === nodeId);
              throw new Error(`${rejected?.data.title || '生成节点'}：${rejected?.data.status || '任务未提交，请检查节点输入和模型设置'}`);
            }
            if (controller.signal.aborted) throw new DOMException('流程已取消', 'AbortError');

            const outcome = await waitForWorkflowTerminal(nodesRef, nodeId, submittedJobId, controller.signal);
            if (outcome !== 'succeeded') {
              const failed = nodesRef.current.find((node) => node.id === nodeId);
              throw new Error(`${failed?.data.title || '生成节点'}：${failed?.data.status || (outcome === 'cancelled' ? '任务已取消' : '生成失败')}`);
            }
            completed += 1;
            updateCollection(id, workflowPatch('running', `已完成 ${completed}/${generatorIds.length}`, completed / generatorIds.length * 100));
          }));
          const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
          if (rejected) throw rejected.reason;
        }
        updateCollection(id, workflowPatch('succeeded', `整组完成，共 ${completed} 个生成节点`, 100));
        setToast('整组流程已完成');
      } catch (error) {
        if (!controller.signal.aborted) {
          const failedIds = generatorIds.filter((nodeId) => ['failed', 'cancelled', 'paused'].includes(String(nodesRef.current.find((node) => node.id === nodeId)?.data.jobState || '')));
          const message = error instanceof Error ? error.message : '整组执行失败';
          updateCollection(id, workflowPatch('failed', message, completed / generatorIds.length * 100, failedIds));
          setToast(message);
        }
      }
    })();
    runs.current.set(id, { controller, completion });
    try { await completion; }
    finally {
      const active = runs.current.get(id);
      if (active?.controller === controller) runs.current.delete(id);
    }
  }, [disabled, edgesRef, nodesRef, requestConfirmation, runGenerator, setToast, updateCollection]);

  const collapsedMembershipSignature = useMemo(() => collapsedCollectionMembershipSignature(nodes), [nodes]);
  const collapsedMemberIds = useMemo(() => new Set(nodes.filter((node) => node.data.kind === 'collection' && node.data.collapsed).flatMap((node) => node.data.memberIds || [])), [collapsedMembershipSignature]);
  const runtimeNodeSignature = useMemo(() => collectionRuntimeNodeSignature(nodes), [nodes]);
  const runtimeEdgeSignature = useMemo(() => collectionRuntimeEdgeSignature(edges), [edges]);
  const collectionRuntime = useMemo(() => collectionRuntimeIndex(nodes, edges), [runtimeEdgeSignature, runtimeNodeSignature]);

  const collectionForNode = useCallback((nodeId: string) => nodesRef.current.find((node) => node.data.kind === 'collection' && node.data.memberIds?.includes(nodeId)), [nodesRef]);

  const onNodeDragStart: OnNodeDrag<CanvasNode> = useCallback((_event, node) => {
    pushHistory();
    if (node.data.kind !== 'collection') { collectionDrag.current = null; return; }
    collectionDrag.current = {
      id: node.id,
      origin: { ...node.position },
      members: new Map((node.data.memberIds || []).map((memberId) => {
        const member = nodesRef.current.find((item) => item.id === memberId);
        return [memberId, member ? { ...member.position } : { x: 0, y: 0 }];
      })),
    };
  }, [nodesRef, pushHistory]);

  const onNodeDrag: OnNodeDrag<CanvasNode> = useCallback((_event, node) => {
    const drag = collectionDrag.current;
    if (!drag || drag.id !== node.id) return;
    const dx = node.position.x - drag.origin.x;
    const dy = node.position.y - drag.origin.y;
    const next = nodesRef.current.map((item) => {
      const origin = drag.members.get(item.id);
      return origin ? { ...item, position: { x: origin.x + dx, y: origin.y + dy } } : item;
    });
    nodesRef.current = next;
    setNodes(next);
  }, [nodesRef, setNodes]);

  const onNodeDragStop: OnNodeDrag<CanvasNode> = useCallback(() => { collectionDrag.current = null; }, []);

  return {
    createCollection, setCollectionCollapsed, dissolveCollection, runCollection, collapsedMemberIds, collectionRuntime, collectionForNode,
    onNodeDragStart, onNodeDrag, onNodeDragStop,
  };
}

function nextCollection(nodes: CanvasNode[], id: string) {
  return nodes.find((node) => node.id === id && node.data.kind === 'collection');
}
