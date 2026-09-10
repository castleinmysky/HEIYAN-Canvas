import { useEffect, useState } from 'react';
import type { AgentProject } from './agent-memory';
import { AgentSearchPanel, type AgentSearchProps } from './AgentSearchPanel';
import { toolLabels } from './agent-runner';
import './AgentProjectPanel.css';
export function AgentProjectPanel({ expanded = false, project, ready, error, busy, save, reload, searchTools }: { expanded?: boolean; project: AgentProject; ready: boolean; error: string; busy: boolean; save: (fields: Pick<AgentProject, 'requirements' | 'goal' | 'progress' | 'summary'>) => Promise<boolean>; reload: () => Promise<boolean>; searchTools: AgentSearchProps }) {
  const fields = (p: AgentProject) => ({ requirements: p.requirements, goal: p.goal, progress: p.progress, summary: p.summary });
  const [draft, setDraft] = useState(fields(project)), [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!dirty) setDraft(fields(project)); }, [project, dirty]);
  const unknown = project.receipts.filter(r => r.status === 'claimed' && r.tool !== 'model_turn');
  return <details open={expanded || undefined} className="agent-project-panel" data-error={!!error || undefined}>
    <summary tabIndex={expanded ? -1 : undefined} onClick={event => { if (expanded) event.preventDefault(); }}><strong>项目记忆</strong><small>{error ? '保存异常' : ready ? '当前画布' : '正在载入'}</small></summary>
    <div className="agent-project-fields">
      <p className="memory-intro">目标与约束随画布保存，切换模型后继续沿用。</p>
      {(['goal', 'requirements', 'progress', 'summary'] as const).map(key => {
        const title = ({ goal: '当前目标', requirements: '已确认的要求', progress: '已完成与待办', summary: '上下文摘要' })[key];
        const full = opened.includes(key), value = draft[key];
        return <section className="memory-section" key={key} aria-label={title}>
          <div className="memory-section-head"><h3>{title}</h3><button type="button" disabled={!ready || saving} aria-label={`${editing === key ? '完成编辑' : '编辑'}${title}`} onClick={() => setEditing(editing === key ? null : key)}>{editing === key ? '完成编辑' : '编辑'}</button></div>
          {key === 'requirements' && <small className="memory-hint">保留用户原文，不自动改写</small>}
          {editing === key ? <textarea autoFocus aria-label={title} rows={8} maxLength={24000} value={value} onChange={e => { setDraft(d => ({ ...d, [key]: e.target.value })); setDirty(true); }} />
            : <p className={`memory-value${!value ? ' is-empty' : ''}`} id={`memory-value-${key}`}>{value ? (full || value.length <= 120 ? value : value.slice(0, 120) + '…') : '尚未记录'}</p>}
          {editing !== key && value.length > 120 && <button className="memory-expand" type="button" aria-expanded={full} aria-controls={`memory-value-${key}`} onClick={() => setOpened(items => full ? items.filter(item => item !== key) : [...items, key])}>{full ? '收起' : '展开全文'}</button>}
        </section>;
      })}
      <div className="memory-save-bar"><span role="status">{saving ? '正在保存…' : dirty ? '有未保存的修改' : project.updatedAt ? '已保存 · ' + new Date(project.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '尚未保存'}</span><button type="button" disabled={!ready || busy || saving || !dirty} onClick={async () => { setSaving(true); try { if (await save(draft)) { setDirty(false); setEditing(null); } } finally { setSaving(false); } }}>{saving ? '保存中…' : '保存项目记忆'}</button></div>
      {error && <p role="alert">{error}</p>}
      <div className="memory-history-head"><h3>历史与检索</h3><button type="button" disabled={busy || saving} title="重新载入记录，保留未保存的编辑" onClick={async () => { await reload(); }}>刷新记录</button></div>
      <p className="memory-hint">{project.messages.length.toLocaleString()} 条对话记录 · {project.receipts.length.toLocaleString()} 条执行记录</p>
      {!!unknown.length && <p role="status">有 {unknown.length} 项操作的执行结果未确认。继续前请核实节点状态；这些操作不会自动重放。</p>}
      <details className="memory-search"><summary>查找历史对话与节点</summary><AgentSearchPanel {...searchTools} /></details>
      <details><summary>执行记录 · {project.receipts.length}</summary>{project.receipts.slice(-30).reverse().map(r => <article key={r.id}><small>{toolLabels[r.tool] || (r.tool === 'model_turn' ? '模型对话' : '画布操作')} · {({ claimed: '结果待核实', succeeded: '已返回成功', failed: '失败', rejected: '已拒绝' })[r.status]}</small><p>{r.result}</p></article>)}</details>
    </div>
  </details>;
}
