import { useCallback, useEffect, useRef, useState } from 'react';
import { agentConnectionKey, agentRequest, connectorAddress, emptyAgentState, readAgentConnection, type AgentCanvasAccess, type AgentConnection, type AgentState } from './agent-session';

export function useCanvasAgent(canvasKey: string, access?: AgentCanvasAccess) {
  const [connection, setConnection] = useState<AgentConnection | null>(() => { try { return readAgentConnection(sessionStorage); } catch { return null; } });
  const [state, setState] = useState(emptyAgentState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accessRef = useRef(access); accessRef.current = access;
  const refs = useRef<string[]>([]);
  const mounted = useRef(true);
  const actionLock = useRef(false);
  const sendAttempt = useRef<{ text: string; requestId: string } | null>(null);
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
  const lock = async (action: () => Promise<void>) => {
    if (actionLock.current) return false;
    actionLock.current = true; setBusy(true); setError('');
    try { await action(); return true; } catch (reason) { report(reason); return false; }
    finally { actionLock.current = false; if (mounted.current) setBusy(false); }
  };
  return {
    connection, state, busy, error,
    pair: (url: string, code: string) => lock(async () => {
      const next: AgentConnection = { url: connectorAddress(url), ...await agentRequest({ url }, '/pair', { code: code.trim() }) };
      // Per-tab pairing is not an account. The user's Codex credentials never
      // enter the browser. Refresh reconnects without resubmitting a turn.
      try { sessionStorage.setItem(agentConnectionKey, JSON.stringify(next)); } catch { /* Connection stays usable until this tab closes. */ }
      if (mounted.current) { setConnection(next); setState(emptyAgentState()); }
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
    send: (text: string, nodeIds: string[]) => lock(async () => {
      if (!connection || !accessRef.current || !state.connected) throw Error('请先连接自己的 Codex，并等待画布加载');
      refs.current = nodeIds;
      if (!sendAttempt.current || sendAttempt.current.text !== text) sendAttempt.current = { text, requestId: crypto.randomUUID() };
      await agentRequest(connection, '/send', { canvasKey, ...sendAttempt.current, context: accessRef.current.read(nodeIds) });
      sendAttempt.current = null;
      // Acceptance is final even if the subsequent status read fails. Keeping
      // the submitted draft would invite a second, billable model turn.
      try { await refresh(); } catch (reason) { report(reason); }
    }),
    stop: () => lock(async () => { if (connection) { await agentRequest(connection, '/stop', { canvasKey }); await refresh(); } }),
    decide: (approved: boolean) => lock(async () => {
      const pending = state.pending;
      if (!connection || !pending || !accessRef.current) return;
      const revision = accessRef.current.read(refs.current).revision;
      const decision = await agentRequest(connection, '/decision', { canvasKey, id: pending.id, approved, revision });
      if (decision.execute) {
        let result: string, success = false;
        // The server atomically grants a single-use claim. A lost acknowledgement
        // retries ONLY the result, never the canvas mutation.
        try { if (!mounted.current) throw Error('画布会话已关闭，本次操作未执行'); result = accessRef.current.edit(decision.input, revision); success = true; }
        catch (reason) { result = reason instanceof Error ? reason.message : '画布未修改'; }
        pendingDelivery.current = { id: pending.id, claim: decision.claim, success, result };
      }
      await refresh();
    }),
  };
}
