import { useMemo, useState } from 'react';
import type { AgentCanvasAccess, AgentPending } from './agent-session';
import type { CanvasAgentItem } from './CanvasAgentDock';
import type { AgentEditPreview } from './agent-proposals';
import { UiIcon } from '../components/UiIcon';
function ProposalText({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  return <><p>{full ? text : text.slice(0, 240)}{!full && text.length > 240 ? '…' : ''}</p>{text.length > 240 && <button type="button" aria-expanded={full} onClick={() => setFull(v => !v)}>{full ? '收起长文' : '展开完整内容（' + text.length + ' 字）'}</button>}</>;
}
function PreviousText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return <details className="agent-proposal-before" onToggle={e => setOpen(e.currentTarget.open)}><summary>查看修改前</summary>{open && <ProposalText text={text} />}</details>;
}
export function AgentProposalCard({ pending, items, access, ready, busy, focus, decide, revise }: {
  pending: AgentPending; items: CanvasAgentItem[]; access?: AgentCanvasAccess; ready: boolean; busy: boolean; focus: (id: string) => void; decide: (approved: boolean) => void; revise?: () => void;
}) {
  // Network polling returns new objects for the same proposal. Keep canvas
  // and access dependencies live, but do not recompute for identical input.
  const signature = JSON.stringify(pending.input);
  const input = useMemo(() => JSON.parse(signature) as AgentPending['input'], [signature]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [limit, setLimit] = useState(12);
  const result = useMemo(() => {
    if (!ready) return { error: '画布尚未就绪' };
    try { return { preview: access?.preview?.(input) }; }
    catch (e) { return { error: e instanceof Error ? e.message : '暂时无法预览方案' }; }
  }, [pending.id, input, items, access, ready]);
  const preview: AgentEditPreview | undefined = result.preview;
  const changed = preview && preview.revision !== pending.revision;
  return <section id="agent-pending-proposal" tabIndex={-1} className="canvas-agent-proposal agent-visual-proposal agent-compact-proposal" aria-label="待确认的画布修改">
    <header><span className="agent-card-kicker">待确认方案</span><strong>待确认方案</strong><small>{preview ? `${preview.count} 个节点将发生变化` : '请重新读取画布后调整方案'}</small></header>
    <details className="agent-proposal-summary"><summary>{(pending.input.summary || '').slice(0, 100)}{(pending.input.summary || '').length > 100 ? '…' : ''}</summary><p>{pending.input.summary}</p></details>
    {preview?.changes.slice(0, limit).map(change => {
      return <details className="agent-change-card" key={pending.id + ':' + change.id} onToggle={event => { const open = event.currentTarget.open; setExpanded(previous => ({ ...previous, [pending.id + ':' + change.id]: open })); }}>
        <summary><UiIcon name="edit" /><span><b>{change.title}</b><small>{change.action} · {change.fields.map(f => f.label).slice(0, 3).join('、')}</small></span><em>详情</em></summary>
        {expanded[pending.id + ':' + change.id] && <>
        {change.exists && <button type="button" onClick={() => focus(change.id)}>在画布查看</button>}
        <dl>{change.fields.map(f => <div className="agent-change-field" key={f.label}><dt>{f.label}</dt><dd><span><small>修改后</small><ProposalText text={f.after} /></span></dd><PreviousText text={f.before} /></div>)}</dl>
        </>}
      </details>;
    })}
    {preview && preview.changes.length > limit && <button type="button" onClick={() => setLimit(n => n + 12)}>再显示 {Math.min(12, preview.changes.length - limit)} 个节点</button>}
    {preview && preview.count > preview.changes.length && <p>还有 {preview.count - preview.changes.length} 个节点，展开画布核对整体布局。</p>}
    {!!preview?.warnings.length && <div className="agent-layout-warnings"><b>布局提示</b>{preview.warnings.map(w => <p key={w}>{w}</p>)}</div>}
    {(result.error || changed) && <p role="alert">{result.error || '画布已变化，请让 Agent 重新读取并更新方案。'}</p>}
    {pending.claimed ? <p role="status">正在应用这份方案…</p> : <footer><button type="button" disabled={busy} onClick={() => decide(false)}>退回方案</button>{revise && (result.error || changed) && <button type="button" disabled={busy || !ready} onClick={revise}>重新核对方案</button>}<button type="button" className="agent-confirm-action" disabled={busy || !ready || !!result.error || !!changed || !preview} onClick={() => decide(true)}>确认修改</button></footer>}
  </section>;
}
