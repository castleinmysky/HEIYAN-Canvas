import { useCallback, useEffect, useRef, useState } from 'react';
import { agentConnectionKey, agentRequest, connectorAddress, emptyAgentState, readAgentConnection, type AgentCanvasAccess, type AgentConnection, type AgentModelOption, type AgentState, type AgentPending } from './agent-session';
import { mayAutoApproveAgentProposal, type AgentApprovalMode } from './approval-mode';
import { validateAgentTool, type AgentProposal } from '../../server/agent-contract.js';
import { emptyProject, mergeMessages, projectRequest, searchProjectHistory, type AgentProject, type ExecutionReceipt } from './agent-memory';
import { validateApiProfile, type ApiMessage, type ApiProfile, type Capability, type UsageRecord } from './agent-api';
import { probeApi } from './agent-capabilities';
import { buildProjectContext, contextLimits } from './agent-context';
import { runApiAgent, toolLabels, type AgentActivity } from './agent-runner';
import { SemanticIndex, embedTexts, projectDocuments, serializeSearch, type SemanticProfile, type SearchResult } from './agent-search';
import { generationReceipts, imageScope, validateAssessment, safeJobReport, waitForJobs, waitingJob } from './agent-jobs';

export function useCanvasAgent(canvasKey: string, access?: AgentCanvasAccess, approvalMode: AgentApprovalMode = 'ask') {
  const [connection, setConnection] = useState<AgentConnection | null>(() => { try { return readAgentConnection(sessionStorage); } catch { return null; } });
  const [state, setState] = useState(emptyAgentState);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [project, setProject] = useState<AgentProject>(emptyProject), [memoryReady, setMemoryReady] = useState(false), [memoryError, setMemoryError] = useState('');
  const [api, setApi] = useState<ApiProfile | null>(null), [models, setModels] = useState<AgentModelOption[]>([]);
  const [model, setModel] = useState(''), [effort, setEffort] = useState('');
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [activity, setActivity] = useState<AgentActivity>({ phase: 'idle', detail: '等待任务', at: Date.now() });
  const [trace, setTrace] = useState<AgentActivity[]>([]);
  const [indexState, setIndexState] = useState<{ configured: boolean; building: boolean; indexed: number; total: number; tokens: number; error: string; service?: string }>({ configured: false, building: false, indexed: 0, total: 0, tokens: 0, error: '' });
  const connectionController = useRef<AbortController | null>(null);
  const semantic = useRef(new SemanticIndex()), indexController = useRef<AbortController | null>(null);
  const apiHistory = useRef<ApiMessage[]>([]), pendingNotes = useRef<string[]>([]);
  const task = useRef({ id: '', text: '', notes: [] as string[], imageGrants: new Set<string>(), seenImages: new Map<string, string>() });
  const nativeRead = useRef<{ id: string; abort: AbortController } | null>(null);
  const resultWait = useRef<AbortController | null>(null);
  const [runUsage, setRunUsage] = useState<UsageRecord[]>([]);
  const setProgress = (value: AgentActivity) => {
    if (!mounted.current) return;
    setActivity(previous => ({ ...previous, ...value }));
    setTrace(previous => previous.at(-1)?.phase === value.phase && previous.at(-1)?.detail === value.detail ? previous : [...previous, value].slice(-60));
  };
  const accessRef = useRef(access); accessRef.current = access;
  const projectRef = useRef(project), etag = useRef<string | null>(null), loaded = useRef(false);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const unsavedMessages = useRef<AgentProject['messages']>([]);
  const mounted = useRef(true), actionLock = useRef(false), polling = useRef(false), refs = useRef<string[]>([]);
  const stateRef = useRef(state); stateRef.current = state;
  const apiRef = useRef(api); apiRef.current = api;
  const controller = useRef<AbortController | null>(null);
  const apiDecision = useRef<((value: { success: boolean; result: string; images?: string[] }) => void) | null>(null);
  const pendingDelivery = useRef<{ id: string; claim: string; success: boolean; result: string; images?: string[] } | null>(null);
  const updateState = useCallback((next: Partial<AgentState>) => { if (mounted.current) { stateRef.current = { ...stateRef.current, ...next }; setState(stateRef.current); } }, []);
  const report = (e: unknown) => { if (mounted.current) setError(e instanceof Error ? e.message : '连接暂时不可用'); };
  const loadProject = useCallback(async () => {
    try {
      await saveQueue.current;
      const value = await projectRequest(canvasKey);
      if (!mounted.current) return;
      const restored = value.document || emptyProject();
      projectRef.current = { ...restored, messages: mergeMessages(restored.messages, unsavedMessages.current) }; etag.current = value.etag; loaded.current = true;
      setProject(projectRef.current); setMemoryReady(true); setMemoryError('');
      updateState({ messages: projectRef.current.messages });
    } catch (e) { if (mounted.current) { setMemoryError(e instanceof Error ? e.message : '项目记录读取失败'); setMemoryReady(false); loaded.current = false; } }
  }, [canvasKey, updateState]);
  useEffect(() => { mounted.current = true; void loadProject(); return () => { mounted.current = false; controller.current?.abort(); nativeRead.current?.abort.abort(); resultWait.current?.abort(); indexController.current?.abort(); connectionController.current?.abort(); apiDecision.current?.({ success: false, result: '画布已关闭，本次操作未执行' }); }; }, [loadProject]);
  const commit = useCallback((change: (p: AgentProject) => AgentProject) => {
    const operation = saveQueue.current.then(async () => {
      if (!loaded.current || !mounted.current) throw Error('请先载入项目记忆，再继续操作');
      const changed = change(projectRef.current);
      const next = { ...changed, messages: mergeMessages(changed.messages, unsavedMessages.current) };
      const value = await projectRequest(canvasKey, next, etag.current);
      unsavedMessages.current = unsavedMessages.current.filter(m => !next.messages.some(saved => saved.id === m.id && saved.text === m.text));
      etag.current = value.etag; projectRef.current = { ...next, updatedAt: value.updatedAt || Date.now() };
      if (mounted.current) { setProject(projectRef.current); setMemoryError(''); }
      return projectRef.current;
    });
    saveQueue.current = operation.catch(e => { if (mounted.current) setMemoryError(e instanceof Error ? e.message : '保存失败'); });
    return operation;
  }, [canvasKey]);
  const receipt = (id: string, tool: string, status: ExecutionReceipt['status'], result = '') => commit(p => ({ ...p, receipts: [...p.receipts.filter(r => r.id !== id), { id, tool, status, result, at: Date.now() }] }));
  const recordMessage = async (message: AgentProject['messages'][number]) => {
    unsavedMessages.current = mergeMessages(unsavedMessages.current, [message]);
    updateState({ messages: mergeMessages(stateRef.current.messages, [message]) });
    const p = await commit(p => ({ ...p, messages: mergeMessages(p.messages, [message]) })); updateState({ messages: p.messages });
  };
  const lock = async (action: () => Promise<void>) => {
    if (actionLock.current) return false;
    actionLock.current = true; setBusy(true); setError('');
    try { await action(); return true; } catch (e) { report(e); return false; }
    finally { actionLock.current = false; if (mounted.current) setBusy(false); }
  };
  const currentAccess = () => { if (!accessRef.current || !mounted.current) throw Error('当前画布不可用'); return accessRef.current; };
  const documents = () => projectDocuments(projectRef.current, accessRef.current?.documents?.() || []);
  const search = async (query: string, signal: AbortSignal = AbortSignal.timeout(60000)): Promise<SearchResult> => {
    const result = await semantic.current.search(documents(), query, signal);
    if (mounted.current) setIndexState(s => ({ ...s, indexed: result.indexed, total: result.total }));
    return result;
  };
  const searchTool = async (request: AgentProposal) => request.query?.trim() ? serializeSearch(await search(request.query, controller.current?.signal), request.offset, request.promptOffset)
    : searchProjectHistory(projectRef.current, '', request.offset, request.promptOffset);
  const readCanvas = async (request?: AgentProposal) => {
    const canvas = currentAccess();
    let next = request;
    let matchedIds: string[] | undefined;
    if (request?.query?.trim() && semantic.current.configured) {
      const result = await semantic.current.search(accessRef.current?.documents?.() || [], request.query, controller.current?.signal || AbortSignal.timeout(60000));
      const ids = result.hits.filter(h => h.source === 'node').map(h => h.id);
      matchedIds = ids;
      next = { nodeIds: ids.slice(request.offset || 0, (request.offset || 0) + 12), promptOffset: request.promptOffset };
    }
    const context = canvas.read(refs.current, next);
    if (matchedIds) {
      const offset = request?.offset || 0;
      context.nodes.sort((a, b) => matchedIds.indexOf(a.id) - matchedIds.indexOf(b.id));
      context.overview = { ...context.overview!, matchedNodes: matchedIds.length, nextOffset: offset + 12 < matchedIds.length ? offset + 12 : null };
    }
    setProgress({ phase: 'reading', detail: request?.query ? `查找画布：${request.query}` : `已读取 ${context.nodes.length} 个节点`, nodeIds: context.nodes.map(n => n.id), at: Date.now() });
    return context;
  };
  const recordUsage = async (value: UsageRecord) => {
    if (mounted.current) setRunUsage(previous => [...previous, value]);
    await commit(p => ({ ...p, usage: [...(p.usage || []), value].slice(-500) }));
  };
  const inspect = async (tool: string, request: AgentProposal, id: string, signal: AbortSignal) => {
    const proposal = validateAgentTool(tool, request), canvas = currentAccess();
    if (!canvas.jobs) throw Error('当前画布不支持任务状态读取');
    const known = generationReceipts(projectRef.current.receipts).flatMap(r => r.targets);
    const targets = proposal.jobs!.map(j => known.find(t => t.nodeId === j.nodeId && t.jobId === j.jobId) || j);
    if (tool === 'heiyan_read_generation') {
      const abort = new AbortController(); resultWait.current = abort;
      try {
        const jobs = await waitForJobs(() => currentAccess().jobs!(targets), proposal.waitSeconds || 0, AbortSignal.any([signal, abort.signal]), jobs => {
          const done = jobs.filter(j => j.state === 'succeeded').length;
          setProgress({ phase: 'waiting-generation', detail: jobs.some(j => waitingJob(j.state)) ? `等待素材 · ${done}/${jobs.length} 个任务完成` : '已核对本次生成状态', nodeIds: jobs.map(j => j.nodeId), at: Date.now() });
        });
        return JSON.stringify({ revision: currentAccess().read(refs.current).revision, jobs: safeJobReport(jobs) });
      } finally { if (resultWait.current === abort) resultWait.current = null; }
    }
    const existing = projectRef.current.receipts.find(r => r.id === id);
    if (existing) return existing.result;
    if (signal.aborted) throw Error('本轮已停止，评估未保存');
    const job = canvas.jobs(targets)[0];
    const { read, checks } = validateAssessment(job, proposal.verdict!, task.current.seenImages);
    const result = JSON.stringify({ nodeId: job.nodeId, jobId: job.jobId, verdict: proposal.verdict, reason: proposal.reason, checkedOutputs: read, totalOutputs: job.outputs.length, metadata: checks, at: Date.now() });
    await receipt(id, 'heiyan_review_result', 'succeeded', result);
    await recordMessage({ id: `execution:${id}`, role: 'notice', text: result });
    return result;
  };
  const execute = async (pending: AgentPending, approved: boolean): Promise<{ success: boolean; result: string; images?: string[] }> => {
    const old = projectRef.current.receipts.find(r => r.id === pending.id);
    if (old) return { success: old.status === 'succeeded', result: old.status === 'claimed' ? '此操作已领取，结果未知；先核实画布，不得自动重放。' : old.result };
    if (!approved) { await receipt(pending.id, pending.tool, 'rejected', '用户拒绝了此操作'); return { success: false, result: '用户拒绝了此操作，不要重复申请' }; }
    setProgress({ phase: 'executing', detail: toolLabels[pending.tool] || '执行画布操作', nodeIds: pending.input.nodeIds, at: Date.now() });
    // Durable claim MUST succeed before any canvas mutation or paid generation.
    await receipt(pending.id, pending.tool, 'claimed', JSON.stringify(pending.input));
    let result = '', images: string[] | undefined, success = false;
    try {
      const canvas = currentAccess();
      if (pendingNotes.current.length) throw Error('用户已补充要求，请重新读取画布并调整方案');
      if (canvas.read(refs.current).revision !== pending.revision) throw Error('画布已变化，请重新读取后提出方案');
      if (pending.tool === 'heiyan_read_images') {
        if (apiRef.current && !apiRef.current.vision) throw Error('该连接未启用图片输入');
        if (!canvas.images) throw Error('图片读取未启用');
        const p = pending.input;
        const exact = p.jobIds && canvas.jobs ? canvas.jobs((p.nodeIds || []).map((nodeId, i) => ({ nodeId, jobId: p.jobIds![i] }))) : [];
        images = await canvas.images(p.nodeIds || [], p.jobIds, p.outputIndexes);
        exact.forEach((job, i) => { const index = p.outputIndexes?.[i] || 0, output = job.outputs[index]; if (images?.[i] && output?.mediaUrl) task.current.seenImages.set(imageScope(job.nodeId, job.jobId, index), output.mediaUrl); });
        result = `已读取 ${images.length} 张图片${p.jobIds ? '，对应指定的生成任务与结果序号' : ''}`;
      } else if (pending.tool === 'heiyan_project_checkpoint') {
        const v = pending.input;
        await commit(p => ({ ...p, summary: v.summary || '', ...(v.requirements !== undefined ? { requirements: v.requirements } : {}), ...(v.goal !== undefined ? { goal: v.goal } : {}), ...(v.progress !== undefined ? { progress: v.progress } : {}) }));
        result = '项目记忆和进度已按确认内容保存';
      } else if (pending.tool === 'heiyan_request_generation') result = JSON.stringify({ ...JSON.parse(await canvas.generate(pending.input, pending.revision)), taskId: task.current.id });
      else result = canvas.edit(pending.input, pending.revision);
      success = true;
    } catch (e) { result = e instanceof Error ? e.message : '操作未执行'; }
    // If acknowledgement storage fails, leave the durable claim in place. Never
    // retry the mutation after a crash or uncertain result.
    await receipt(pending.id, pending.tool, success ? 'succeeded' : 'failed', result);
    await recordMessage({ id: `execution:${pending.id}`, role: 'notice', text: result });
    return { success, result, images };
  };
  const refresh = useCallback(async () => {
    if (!connection || apiRef.current || !loaded.current || polling.current) return;
    polling.current = true;
    try {
      if ((connection.protocol || 0) < 4) throw Error('请下载 1.4.0 连接器并重新配对，旧版不支持完整项目上下文');
      const value: AgentState = await agentRequest(connection, '/state', { canvasKey });
      if (!mounted.current || apiRef.current) return;
      if (nativeRead.current && nativeRead.current.id !== value.pending?.id) { nativeRead.current.abort.abort(); nativeRead.current = null; }
      if (value.active && !nativeRead.current) setProgress({ phase: value.pending ? 'approval' : 'thinking', detail: value.pending ? toolLabels[value.pending.tool] || '等待确认' : 'Codex 正在处理任务', nodeIds: value.pending?.input.nodeIds, at: Date.now(), ...(value.usage ? { input: value.usage.inputTokens, limit: value.usage.modelContextWindow, measured: true } : {}) });
      else if (!value.active && stateRef.current.active) { setProgress({ phase: 'done', detail: '本轮已结束，结果请结合画布查看', at: Date.now() }); task.current.imageGrants.clear(); }
      let merged = mergeMessages(projectRef.current.messages, value.messages);
      updateState({ ...value, messages: merged });
      // Persist completed/pending boundaries, avoiding one cloud write per token.
      if (!value.active || value.pending) {
        if (JSON.stringify(merged) !== JSON.stringify(projectRef.current.messages)) merged = (await commit(p => ({ ...p, messages: mergeMessages(p.messages, value.messages) }))).messages;
      }
      updateState({ ...value, messages: merged });
      if (pendingDelivery.current) {
        const delivery = pendingDelivery.current;
        if (value.pending?.id === delivery.id) await agentRequest(connection, '/result', { canvasKey, ...delivery });
        pendingDelivery.current = null;
      } else if (value.pending?.tool === 'heiyan_read_canvas' && accessRef.current) {
        await agentRequest(connection, '/read', { canvasKey, id: value.pending.id, context: await readCanvas(value.pending.input) });
      } else if (value.pending?.tool === 'heiyan_search_history') {
        await agentRequest(connection, '/read', { canvasKey, id: value.pending.id, history: await searchTool(value.pending.input) });
      } else if (value.pending && ['heiyan_read_generation', 'heiyan_review_result'].includes(value.pending.tool) && nativeRead.current?.id !== value.pending.id) {
        const pending = value.pending, abort = new AbortController(); nativeRead.current = { id: pending.id, abort };
        void (async () => {
          let history = '', success = true;
          try { history = await inspect(pending.tool, pending.input, pending.id, abort.signal); }
          catch (e) { success = false; history = e instanceof Error ? e.message : '结果检查失败'; }
          if (abort.signal.aborted || !mounted.current) return;
          await agentRequest(connection, '/read', { canvasKey, id: pending.id, history, success, ...(pending.tool === 'heiyan_read_generation' && success ? JSON.parse(history) : {}) });
        })().catch(e => { if (!abort.signal.aborted) report(e); }).finally(() => { if (nativeRead.current?.abort === abort) nativeRead.current = null; });
      }
    } finally { polling.current = false; }
  }, [canvasKey, connection, commit, updateState]);
  useEffect(() => {
    if (!connection || api) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { await refresh(); } catch (e) { report(e); updateState({ connected: false }); } if (!stopped) timer = setTimeout(poll, 1200); };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [connection, api, memoryReady, refresh, updateState]);
  useEffect(() => {
    if (!connection || api) return;
    let cancelled = false;
    void agentRequest(connection, '/models', {}).then(result => { if (!cancelled) { const list: AgentModelOption[] = result.models || []; setModels(list); setModel(list.find(m => m.isDefault)?.model || list[0]?.model || ''); } }).catch(report);
    return () => { cancelled = true; };
  }, [connection, api]);
  useEffect(() => {
    const selected = models.find(m => m.model === model);
    if (selected && !selected.efforts.some(e => e.value === effort)) setEffort(selected.defaultEffort || selected.efforts[0]?.value || '');
  }, [models, model, effort]);
  const decidePending = async (approved: boolean, rememberImages = false) => {
    const pending = stateRef.current.pending;
    if (!pending || !accessRef.current) return;
    if (approved && rememberImages && pending.tool === 'heiyan_read_images') (pending.input.nodeIds || []).forEach((id, i) => task.current.imageGrants.add(imageScope(id, pending.input.jobIds?.[i], pending.input.outputIndexes?.[i])));
    if (apiRef.current) {
      const resolve = apiDecision.current;
      if (!resolve) throw Error('本次会话已结束，请重新提出任务');
      try { const result = await execute(pending, approved); apiDecision.current = null; updateState({ pending: null }); resolve(result); }
      catch (e) { apiDecision.current = null; updateState({ pending: null }); resolve({ success: false, result: '保存或执行结果未知，请核实画布；不得重放操作。' }); throw e; }
    } else if (connection) {
      const revision = currentAccess().read(refs.current).revision;
      const decision = await agentRequest(connection, '/decision', { canvasKey, id: pending.id, approved, revision });
      if (decision.execute) {
        let result;
        try { result = await execute(pending, approved); }
        catch (e) { result = { success: false, result: '保存或执行结果未知，请核实画布，不得重放。' }; report(e); }
        pendingDelivery.current = { id: pending.id, claim: decision.claim, ...result };
      }
      await refresh();
    }
  };
  useEffect(() => {
    const pending = state.pending;
    if (!pending || pending.claimed) return;
    const automaticCheckpoint = pending.tool === 'heiyan_project_checkpoint' && pending.input.requirements === undefined && pending.input.goal === undefined;
    const automaticImages = pending.tool === 'heiyan_read_images' && !!pending.input.nodeIds?.length && pending.input.nodeIds.every((id, i) => task.current.imageGrants.has(imageScope(id, pending.input.jobIds?.[i], pending.input.outputIndexes?.[i])));
    if (!automaticCheckpoint && !automaticImages && (pending.tool !== 'heiyan_edit_canvas' || !mayAutoApproveAgentProposal(approvalMode, pending.input))) return;
    void lock(() => decidePending(true));
  }, [approvalMode, state.pending?.id, state.pending?.claimed]);
  const runApi = async (profile: ApiProfile, messages: ApiMessage[], turnId: string, observedRevision: string) => {
    const abort = new AbortController(); controller.current = abort;
    try {
      apiHistory.current = await runApiAgent(profile, messages, turnId, observedRevision, abort.signal, {
        project: () => projectRef.current, task: () => task.current.text + (task.current.notes.length ? '\n补充要求：\n' + task.current.notes.join('\n') : ''),
        notes: () => pendingNotes.current.splice(0), hasNotes: () => pendingNotes.current.length > 0,
        read: readCanvas, search: searchTool, inspect,
        decide: pending => new Promise(resolve => { apiDecision.current = resolve; updateState({ pending }); setProgress({ phase: 'approval', detail: `等待确认：${toolLabels[pending.tool] || '画布操作'}`, nodeIds: pending.input.nodeIds, at: Date.now() }); }),
        message: (id, text, partial) => recordMessage({ id, role: 'assistant', text: (partial ? '[回复未完成，相关操作未执行]\n' : '') + text, model: profile.model }),
        draft: (id, text) => { if (controller.current === abort && mounted.current) updateState({ messages: mergeMessages(stateRef.current.messages, [{ id, role: 'assistant', text, model: profile.model }]) }); },
        usage: recordUsage, summary: async summary => { await commit(p => ({ ...p, summary })); }, activity: setProgress,
      });
      await receipt(turnId, 'model_turn', 'succeeded', '本轮对话已完成');
    } catch (e) {
      apiHistory.current = [];
      if (controller.current === abort) {
        report(e); setProgress({ phase: abort.signal.aborted ? 'stopped' : 'blocked', detail: e instanceof Error ? e.message : '本轮中断', at: Date.now() });
        try { await receipt(turnId, 'model_turn', 'failed', e instanceof Error ? e.message : '本轮中断'); } catch { /* Existing durable claim remains. */ }
      }
    } finally { if (controller.current === abort) { controller.current = null; apiDecision.current = null; task.current.imageGrants.clear(); updateState({ active: false, pending: null }); } }
  };
  return {
    connection: api ? { url: api.baseUrl, token: '', capabilities: api.vision ? ['image_input'] : [], device: api.provider === 'official' ? '官方 API' : '自定义 API' } : connection,
    state, busy, error, activity, trace, capabilities, runUsage, indexState, models: api ? [] : models, model, effort, setModel, setEffort,
    project, memoryReady, memoryError, api, reloadMemory: () => lock(loadProject),
    saveMemory: (fields: Pick<AgentProject, 'requirements' | 'goal' | 'progress' | 'summary'>) => lock(async () => { await commit(p => ({ ...p, ...fields })); }),
    search,
    configureSemantic: (profile: SemanticProfile) => lock(async () => {
      if (stateRef.current.active) throw Error('请在当前任务结束后修改检索连接。');
      await embedTexts(profile, ['检索连接检测'], AbortSignal.timeout(60000));
      semantic.current.configure(profile); setIndexState({ configured: true, building: false, indexed: 0, total: semantic.current.coverage(documents()).total, tokens: 0, error: '', service: `${profile.provider === 'official' ? 'OpenAI' : new URL(profile.baseUrl).hostname} · ${profile.model}` });
    }),
    clearSemantic: () => { indexController.current?.abort(); semantic.current.configure(null); setIndexState({ configured: false, building: false, indexed: 0, total: 0, tokens: 0, error: '' }); },
    buildIndex: () => lock(async () => {
      const abort = new AbortController(); indexController.current = abort;
      setIndexState(s => ({ ...s, building: true, error: '' }));
      try { await semantic.current.build(documents(), abort.signal, (indexed, total, tokens = 0) => { if (mounted.current) setIndexState(s => ({ ...s, indexed, total, tokens: s.tokens + tokens })); }); }
      catch (e) { if (mounted.current) setIndexState(s => ({ ...s, error: e instanceof Error ? e.message : '索引未完成' })); }
      finally { if (mounted.current) setIndexState(s => ({ ...s, building: false })); indexController.current = null; }
    }),
    stopIndex: () => indexController.current?.abort(),
    updateBudget: (fields: Pick<ApiProfile, 'tokenBudget' | 'callLimit'>) => { if (!stateRef.current.active && apiRef.current) { const next = { ...apiRef.current, ...fields }; try { validateApiProfile(next); setApi(next); apiRef.current = next; } catch (e) { report(e); } } },
    cancelConnectionTest: () => connectionController.current?.abort(),
    testingConnection: !!connectionController.current,
    connectApi: (profile: ApiProfile) => lock(async () => {
      if (stateRef.current.active) throw Error('请先停止当前任务再切换连接');
      const abort = new AbortController(); connectionController.current = abort; const timer = setTimeout(() => abort.abort(), 300000);
      setCapabilities([]); setRunUsage([]);
      try {
        const tested = await probeApi(profile, abort.signal, c => setCapabilities(previous => [...previous.filter(v => v.key !== c.key), c]), u => setRunUsage(previous => [...previous, u]));
        if (abort.signal.aborted || !mounted.current) throw Error('连接检测已取消');
        setApi(tested); apiRef.current = tested; apiHistory.current = [];
        semantic.current.configure(null); setIndexState({ configured: false, building: false, indexed: 0, total: 0, tokens: 0, error: '' });
        if (tested.embeddingModel) { semantic.current.configure({ ...tested, model: tested.embeddingModel }); setIndexState({ configured: true, building: false, indexed: 0, total: semantic.current.coverage(documents()).total, tokens: 0, error: '', service: `${tested.provider === 'official' ? 'OpenAI' : new URL(tested.baseUrl).hostname} · ${tested.embeddingModel}` }); }
        updateState({ connected: true, active: false, pending: null, error: '', messages: projectRef.current.messages });
      } finally { clearTimeout(timer); connectionController.current = null; }
    }),
    pair: (url: string, code: string) => lock(async () => {
      if (stateRef.current.active) throw Error('请先停止当前任务');
      const paired = await agentRequest({ url }, '/pair', { code: code.trim() });
      const next: AgentConnection = { url: connectorAddress(url), ...paired };
      if ((next.protocol || 0) < 4) { await agentRequest(next, '/disconnect', {}); throw Error('请下载 1.4.0 连接器，或成功更新后重新配对'); }
      apiHistory.current = [];
      sessionStorage.setItem(agentConnectionKey, JSON.stringify(next)); setApi(null); apiRef.current = null; setConnection(next); updateState({ connected: true, messages: projectRef.current.messages });
    }),
    disconnect: () => lock(async () => {
      if (stateRef.current.active) throw Error('请先停止当前任务');
      if (apiRef.current) { setApi(null); apiRef.current = null; }
      else if (connection) await agentRequest(connection, '/disconnect', {});
      apiHistory.current = []; semantic.current.configure(null); setIndexState(s => ({ ...s, configured: false, indexed: 0 }));
      sessionStorage.removeItem(agentConnectionKey); setConnection(null); updateState({ connected: false, pending: null, messages: projectRef.current.messages });
    }),
    forget: () => { nativeRead.current?.abort.abort(); resultWait.current?.abort(); indexController.current?.abort(); semantic.current.configure(null); setIndexState(s => ({ ...s, configured: false, indexed: 0 })); apiHistory.current = []; controller.current?.abort(); apiDecision.current?.({ success: false, result: '连接已移除' }); apiDecision.current = null; sessionStorage.removeItem(agentConnectionKey); setConnection(null); setApi(null); apiRef.current = null; updateState({ connected: false, active: false, pending: null, messages: projectRef.current.messages }); },
    send: (text: string, nodeIds: string[], images: string[] = []) => lock(async () => {
      if (!loaded.current) throw Error('项目记忆未载入，暂时不能开始任务');
      if (!stateRef.current.connected || stateRef.current.active) throw Error('请先连接并等待当前任务完成');
      if (apiRef.current && images.length && !apiRef.current.vision) throw Error('请在 API 连接中启用图片输入');
      const context = currentAccess().read(nodeIds); refs.current = nodeIds;
      const id = crypto.randomUUID();
      const budget = apiRef.current ? Math.floor(contextLimits(apiRef.current).input * .4) : 16000;
      task.current = { id, text, notes: [], imageGrants: new Set(), seenImages: new Map() }; pendingNotes.current = []; setRunUsage([]); setTrace([]);
      setActivity({ phase: 'preparing', detail: '正在读取项目要求与相关资料', at: Date.now() });
      const recovered = text.trim() ? await search(text) : null;
      const recovery = buildProjectContext(projectRef.current, budget, text, recovered ? serializeSearch(recovered) : '');
      await receipt(id, 'model_turn', 'claimed', '消息已准备提交；断线后不会自动重发');
      await recordMessage({ id, role: 'user', text, imageCount: images.length, model: apiRef.current?.model || model });
      updateState({ active: true, pending: null, error: '' });
      if (apiRef.current) {
        const profile = apiRef.current;
        if (images.length && !profile.vision) { updateState({ active: false }); throw Error('请在 API 连接中启用图片输入'); }
        const previous = apiHistory.current;
        const current: ApiMessage = { role: 'user', content: recovery + '\n当前请求：' + text + '\n最新画布：' + JSON.stringify(context), images };
        void runApi(profile, [...previous, current], id, context.revision);
      } else if (connection) {
        try { await agentRequest(connection, '/send', { canvasKey, requestId: id, text, images, model, effort, context, recovery }); await receipt(id, 'model_turn', 'succeeded', 'Codex 已接受请求，完成状态以对话和画布为准'); }
        catch (e) { updateState({ active: false }); throw e; }
        try { await refresh(); } catch (e) { report(e); }
      }
    }),
    stop: () => lock(async () => {
      resultWait.current?.abort(); nativeRead.current?.abort.abort();
      if (apiRef.current) { controller.current?.abort(); apiDecision.current?.({ success: false, result: '用户停止了本轮' }); apiDecision.current = null; updateState({ active: false, pending: null }); }
      else if (connection) { await agentRequest(connection, '/stop', { canvasKey }); await refresh(); }
    }),
    steer: (text: string) => lock(async () => {
      if (!stateRef.current.active || !text.trim() || text.length > 8000) throw Error('请在任务运行时补充 1–8000 字的要求。');
      const id = crypto.randomUUID();
      resultWait.current?.abort(); nativeRead.current?.abort.abort();
      if (apiRef.current) {
        task.current.notes.push(text); pendingNotes.current.push(text);
        await recordMessage({ id, role: 'user', text: '补充要求：' + text });
        apiDecision.current?.({ success: false, result: '用户补充了要求，本次方案未执行；请重新读取画布并调整。' }); apiDecision.current = null; updateState({ pending: null });
        setProgress({ phase: 'steering', detail: '补充要求已加入，将在下一次操作前处理', at: Date.now() });
      } else if (connection) {
        if (!connection.capabilities?.includes('steering')) throw Error('执行中补充要求需要 1.5.0 连接器，请更新后重新配对。');
        await agentRequest(connection, '/steer', { canvasKey, requestId: id, text });
        await recordMessage({ id, role: 'user', text: '补充要求：' + text }); await refresh();
      }
    }),
    decide: (approved: boolean, rememberImages = false) => lock(() => decidePending(approved, rememberImages)),
  };
}
