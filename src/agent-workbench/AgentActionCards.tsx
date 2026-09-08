import { useMemo } from 'react';
import type { AgentCanvasAccess, AgentPending } from './agent-session';
import type { CanvasAgentItem } from './CanvasAgentDock';
import type { AgentEditPreview } from './agent-proposals';
import { AgentNodeThumbnail } from './AgentNodeThumbnail';
export function AgentProposalCard({ pending, items, access, ready, busy, focus, decide, revise }: {
  pending: AgentPending; items: CanvasAgentItem[]; access?: AgentCanvasAccess; ready: boolean; busy: boolean; focus: (id: string) => void; decide: (approved: boolean) => void; revise?: () => void;
}) {
  const result = useMemo(() => {
    if (!ready) return { error: '画布尚未就绪' };
    try { return { preview: access?.preview?.(pending.input) }; }
    catch (e) { return { error: e instanceof Error ? e.message : '暂时无法预览方案' }; }
  }, [pending.id, pending.input, items, access, ready]);
  const preview: AgentEditPreview | undefined = result.preview;
  const changed = preview && preview.revision !== pending.revision;
  return <section id="agent-pending-proposal" tabIndex={-1} className="canvas-agent-proposal agent-visual-proposal" aria-label="待确认的画布修改">
    <header><span className="agent-card-kicker">待确认方案</span><strong>{pending.input.summary}</strong><small>{preview ? `${preview.count} 个节点将发生变化` : '请重新读取画布后调整方案'}</small></header>
    {preview?.changes.map(change => {
      const item = items.find(n => n.id === change.id);
      return <details className="agent-change-card" key={change.id} open={preview.count <= 3}>
        <summary><span className="canvas-agent-thumb"><AgentNodeThumbnail item={item || { id: change.id, kind: change.kind as CanvasAgentItem['kind'] }} /></span><span><b>{change.title}</b><small>{change.action} · {change.fields.map(f => f.label).slice(0, 3).join('、')}</small></span><em>{change.action}</em></summary>
        {change.exists && <button type="button" onClick={() => focus(change.id)}>在画布查看</button>}
        <dl>{change.fields.map(f => <div className="agent-change-field" key={f.label}><dt>{f.label}</dt><dd><span><small>修改前</small><p>{f.before}</p></span><span><small>修改后</small><p>{f.after}</p></span></dd></div>)}</dl>
      </details>;
    })}
    {preview && preview.count > preview.changes.length && <p>还有 {preview.count - preview.changes.length} 个节点，展开画布核对整体布局。</p>}
    {!!preview?.warnings.length && <div className="agent-layout-warnings"><b>布局提示</b>{preview.warnings.map(w => <p key={w}>{w}</p>)}</div>}
    {(result.error || changed) && <p role="alert">{result.error || '画布已变化，请让 Agent 重新读取并更新方案。'}</p>}
    {pending.claimed ? <p role="status">正在应用这份方案…</p> : <footer><button type="button" disabled={busy} onClick={() => decide(false)}>退回方案</button>{revise && (result.error || changed) && <button type="button" disabled={busy || !ready} onClick={revise}>重新核对方案</button>}<button type="button" className="agent-confirm-action" disabled={busy || !ready || !!result.error || !!changed || !preview} onClick={() => decide(true)}>确认修改</button></footer>}
  </section>;
}
