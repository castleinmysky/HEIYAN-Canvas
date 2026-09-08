import { useEffect, useState } from 'react';
import type { AgentProject } from './agent-memory';
import { AgentSearchPanel, type AgentSearchProps } from './AgentSearchPanel';
import { toolLabels } from './agent-runner';
export function AgentProjectPanel({ project, ready, error, busy, save, reload, searchTools }: { project: AgentProject; ready: boolean; error: string; busy: boolean; save: (fields: Pick<AgentProject, 'requirements' | 'goal' | 'progress' | 'summary'>) => Promise<boolean>; reload: () => Promise<boolean>; searchTools: AgentSearchProps }) {
  const fields = (p: AgentProject) => ({ requirements: p.requirements, goal: p.goal, progress: p.progress, summary: p.summary });
  const [draft, setDraft] = useState(fields(project)), [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setDraft(fields(project)); }, [project, dirty]);
  const unknown = project.receipts.filter(r => r.status === 'claimed' && r.tool !== 'model_turn');
  return <details className="agent-project-panel">
    <summary>项目记忆与进度 <small>{error ? '保存异常' : ready ? `${project.messages.length} 条记录` : '正在载入'}</small></summary>
    <div className="agent-project-fields">
      <p>随当前画布保存。切换模型后继续使用这些要求与记录。</p>
      {(['goal', 'requirements', 'progress', 'summary'] as const).map(key => <label key={key}>{({ goal: '当前目标', requirements: '已确认的要求（保留原文）', progress: '已完成与待办', summary: '上下文摘要' })[key]}<textarea rows={key === 'requirements' ? 4 : 3} maxLength={24000} value={draft[key]} onChange={e => { setDraft(d => ({ ...d, [key]: e.target.value })); setDirty(true); }} /></label>)}
      <button type="button" disabled={!ready || busy || !dirty} onClick={async () => { if (await save(draft)) setDirty(false); }}>保存项目记忆</button>
      <p>{project.updatedAt ? `最近保存：${new Date(project.updatedAt).toLocaleString()}` : '尚未保存项目记忆'}</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={async () => { await reload(); }}>重新载入记录（保留未保存的编辑）</button>
      {!!unknown.length && <p role="status">有 {unknown.length} 项操作的执行结果未确认。继续前请核实节点状态；这些操作不会自动重放。</p>}
      <AgentSearchPanel {...searchTools} />
      <details><summary>执行记录 · {project.receipts.length}</summary>{project.receipts.slice(-30).reverse().map(r => <article key={r.id}><small>{toolLabels[r.tool] || (r.tool === 'model_turn' ? '模型对话' : '画布操作')} · {({ claimed: '结果待核实', succeeded: '已返回成功', failed: '失败', rejected: '已拒绝' })[r.status]}</small><p>{r.result}</p></article>)}</details>
    </div>
  </details>;
}
