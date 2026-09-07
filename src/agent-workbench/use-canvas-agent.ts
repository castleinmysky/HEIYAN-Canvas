import { useCallback, useEffect, useRef, useState } from 'react';
import { agentConnectionKey, agentRequest, connectorAddress, emptyAgentState, readAgentConnection, type AgentCanvasAccess, type AgentConnection, type AgentModelOption, type AgentState } from './agent-session';
import { mayAutoApproveAgentProposal, type AgentApprovalMode } from './approval-mode';

export function useCanvasAgent(canvasKey: string, access?: AgentCanvasAccess, approvalMode: AgentApprovalMode = 'ask') {
  const [connection, setConnection] = useState<AgentConnection | null>(() => { try { return readAgentConnection(sessionStorage); } catch { return null; } });
  const [state, setState] = useState(emptyAgentState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [models, setModels] = useState<AgentModelOption[]>([]);
  const [model, setModelState] = useState(() => { try { return localStorage.getItem('heiyan:agent-model:v1') || ''; } catch { return ''; } });
  const [effort, setEffortState] = useState(() => { try { return localStorage.getItem('heiyan:agent-effort:v1') || ''; } catch { return ''; } });
  const accessRef = useRef(access); accessRef.current = access;
  const refs = useRef<string[]>([]);
  const mounted = useRef(true);
  const actionLock = useRef(false);
  const sendAttempt = useRef<{ key: string; text: string; requestId: string; images: string[] } | null>(null);
  const pendingDelivery = useRef<{ id: string; claim: string; success: boolean; result: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const report = (reason: unknown) => { if (mounted.current) setError(reason instanceof TypeError ? '无法访问连接器，请检查是否已启动，以及浏览器是否允许本地网络访问。' : reason instanceof Error ? reason.message : '连接暂时不可用'); };
  const refresh = useCallback(async () => {
    if (!connection) return;
    const current: AgentState = await agentRequest(connection, '/state', { canvasKey });
    if (!mounted.current) return;
    setState(current);
    if (pendingDelivery.current) {
      const delivery = pendingDelivery.current;
      if (current.pending?.id === delivery.id) await agentRequest(connection, '/result', { canvasKey, ...delivery });
      pendingDelivery.current = null;
    } else if (current.pending?.tool === 'heiyan_read_canvas' && accessRef.current) {
      await agentRequest(connection, '/read', { canvasKey, id: current.pending.id, context: accessRef.current.read(refs.current) });
    }
  }, [canvasKey, connection]);
  useEffect(() => {
    if (!connection) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); } catch (reason) { report(reason); if (mounted.current) setState(current => ({ ...current, connected: false })); }
      if (!stopped) timer = setTimeout(poll, 1200);
    };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [connection, refresh]);
  useEffect(() => {
    if (!connection) { setModels([]); return; }
    if (!connection.capabilities?.includes('model_selection')) { setModels([]); return; }
    let cancelled = false;
    void agentRequest(connection, '/models', {}).then(result => { if (!cancelled) setModels(Array.isArray(result.models) ? result.models : []); }).catch(report);
    return () => { cancelled = true; };
  }, [connection]);
  useEffect(() => {
    if (!models.length) return;
    const selected = models.find(item => item.model === model || item.id === model) || models.find(item => item.isDefault) || models[0];
    if (selected.model !== model) setModelState(selected.model);
    if (!selected.efforts.some(item => item.value === effort)) setEffortState(selected.defaultEffort || selected.efforts[0]?.value || '');
  }, [models, model, effort]);
  const lock = async (action: () => Promise<void>) => {
    if (actionLock.current) return false;
    actionLock.current = true; setBusy(true); setError('');
    try { await action(); return true; } catch (reason) { report(reason); return false; }
    finally { actionLock.current = false; if (mounted.current) setBusy(false); }
  };
  const decidePending = async (pending: NonNullable<AgentState['pending']>, approved: boolean) => {
    if (!connection || !accessRef.current) return;
    const revision = accessRef.current.read(refs.current).revision;
    const decision = await agentRequest(connection, '/decision', { canvasKey, id: pending.id, approved, revision });
    if (decision.execute) {
      let result: string, success = false;
      // The server atomically grants a single-use claim. A lost acknowledgement
      // retries ONLY the result, never the canvas mutation.
      try {
        if (!mounted.current) throw Error('画布会话已关闭，本次操作未执行');
        result = pending.tool === 'heiyan_request_generation'
          ? await accessRef.current.generate(decision.input, revision)
          : accessRef.current.edit(decision.input, revision);
        success = true;
      }
      catch (reason) { result = reason instanceof Error ? reason.message : '画布未修改'; }
      pendingDelivery.current = { id: pending.id, claim: decision.claim, success, result };
    }
    await refresh();
  };
  useEffect(() => {
    const pending = state.pending;
    if (!pending || pending.claimed || pending.tool !== 'heiyan_edit_canvas' || !mayAutoApproveAgentProposal(approvalMode, pending.input)) return;
    void lock(() => decidePending(pending, true));
  }, [approvalMode, state.pending?.id, state.pending?.claimed]);
  return {
    connection, state, busy, error, models, model, effort,
    setModel: (value: string) => { setModelState(value); try { localStorage.setItem('heiyan:agent-model:v1', value); } catch { /* use this session */ } },
    setEffort: (value: string) => { setEffortState(value); try { localStorage.setItem('heiyan:agent-effort:v1', value); } catch { /* use this session */ } },
    pair: (url: string, code: string) => lock(async () => {
      const paired = await agentRequest({ url }, '/pair', { code: code.trim() });
      const next: AgentConnection = { url: connectorAddress(url), ...paired };
      // Per-tab pairing is not an account. The user's Codex credentials never
      // enter the browser. Refresh reconnects without resubmitting a turn.
      try { sessionStorage.setItem(agentConnectionKey, JSON.stringify(next)); } catch { /* Connection stays usable until this tab closes. */ }
      if (mounted.current) { setConnection(next); setModels(Array.isArray(paired.models) ? paired.models : []); setState(emptyAgentState()); }
    }),
    disconnect: () => lock(async () => {
      if (connection) await agentRequest(connection, '/disconnect', {});
      try { sessionStorage.removeItem(agentConnectionKey); } catch { /* no stored session */ }
      setConnection(null); setState(emptyAgentState()); pendingDelivery.current = null;
    }),
    forget: () => {
      try { sessionStorage.removeItem(agentConnectionKey); } catch { /* storage unavailable */ }
      setConnection(null); setState(emptyAgentState()); pendingDelivery.current = null;
      setError('已移除本页连接。若旧连接器仍在运行，请在电脑上关闭它后重新启动。');
    },
    send: (text: string, nodeIds: string[], images: string[] = []) => lock(async () => {
      if (!connection || !accessRef.current || !state.connected) throw Error('请先连接自己的 Codex，并等待画布加载');
      refs.current = nodeIds;
      const attemptKey = `${text}\u0000${model}\u0000${effort}\u0000${images.map(image => image.length + ':' + image.slice(-24)).join('|')}`;
      if (!sendAttempt.current || sendAttempt.current.key !== attemptKey) sendAttempt.current = { key: attemptKey, text, images, requestId: crypto.randomUUID() };
      await agentRequest(connection, '/send', { canvasKey, text: sendAttempt.current.text, images: sendAttempt.current.images, requestId: sendAttempt.current.requestId, model, effort, context: accessRef.current.read(nodeIds) });
      sendAttempt.current = null;
      // Acceptance is final even if the subsequent status read fails. Keeping
      // the submitted draft would invite a second, billable model turn.
      try { await refresh(); } catch (reason) { report(reason); }
    }),
    stop: () => lock(async () => { if (connection) { await agentRequest(connection, '/stop', { canvasKey }); await refresh(); } }),
    decide: (approved: boolean) => lock(async () => {
      const pending = state.pending;
      if (pending) await decidePending(pending, approved);
    }),
  };
}
