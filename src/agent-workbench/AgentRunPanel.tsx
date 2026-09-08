import { useEffect, useState } from 'react';
import type { ApiProfile, Capability, UsageRecord } from './agent-api';
import type { AgentActivity } from './agent-runner';
import type { AgentState } from './agent-session';
export function AgentCapabilities({ capabilities }: { capabilities: Capability[] }) {
  return capabilities.length ? <details className="agent-capability-report"><summary>连接能力 · {capabilities.filter(c => c.status === 'passed').length} 项通过</summary><ul>{capabilities.map(c => <li key={c.key} data-status={c.status}><b>{c.label}</b><span>{({ passed: '通过', unavailable: '未通过', untested: '未检测' })[c.status]}</span><small>{c.detail}</small></li>)}</ul></details> : null;
}
export function AgentRunPanel({ activity, trace, active, usage, api, connectorUsage, updateBudget, focus, nodeTitle }: {
  activity: AgentActivity; trace: AgentActivity[]; active: boolean; usage: UsageRecord[]; api: ApiProfile | null; connectorUsage?: AgentState['usage'];
  updateBudget: (fields: Pick<ApiProfile, 'tokenBudget' | 'callLimit'>) => void; focus: (id: string) => void; nodeTitle: (id: string) => string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  const total = usage.reduce((s, u) => ({ input: s.input + u.input, output: s.output + u.output, cached: s.cached + u.cached, usd: s.usd + (u.usd || 0), priced: s.priced + (u.usd === undefined ? 0 : 1) }), { input: 0, output: 0, cached: 0, usd: 0, priced: 0 });
  return <details className="agent-run-panel"><summary><span>{activity.detail}</span>{active && <small>{Math.max(0, Math.floor((now - activity.at) / 1000))} 秒前更新</small>}</summary><div className="agent-run-content">
    {activity.input !== undefined && <div><label>本次输入 · {activity.measured ? '服务端计数' : '估算'}<strong>{activity.input.toLocaleString()} / {activity.limit?.toLocaleString() || '上限未知'}</strong></label>{activity.limit && <progress value={Math.min(activity.input, activity.limit)} max={activity.limit} />}</div>}
    {!!activity.nodeIds?.length && <div className="agent-source-chips">{activity.nodeIds.map(id => <button type="button" key={id} onClick={() => focus(id)}>{nodeTitle(id)}</button>)}</div>}
    {api && <>
      <p>本轮调用 {usage.length} 次 · 输入 {total.input.toLocaleString()} · 输出 {total.output.toLocaleString()} · 缓存命中 {total.cached.toLocaleString()} token{usage.some(u => u.source === 'estimated') ? '（含估算）' : ''}</p>
      <p>{total.priced ? `已配置单价部分约 $${total.usd.toFixed(4)}${total.priced < usage.length ? '；部分调用未计价' : ''}` : '未设置单价，暂只统计 token'}</p>
      <div className="agent-settings-pair"><label>每轮累计 token 预算<input aria-label="每轮累计 token 预算" disabled={active} type="number" min={10000} max={10000000} step={10000} value={api.tokenBudget || 250000} onChange={e => updateBudget({ tokenBudget: Number(e.target.value) })} /></label><label>每轮模型调用上限<input aria-label="每轮模型调用上限" disabled={active} type="number" min={1} max={48} value={api.callLimit || 24} onChange={e => updateBudget({ callLimit: Number(e.target.value) })} /></label></div>
      <p>预算包含对话与摘要，不含素材生成、索引与检索。每次请求预留输出额度；用量未返回时按估算控制。</p>
    </>}
    {!api && <p>{connectorUsage ? `最近一次 Codex 用量：输入 ${connectorUsage.inputTokens.toLocaleString()} · 输出 ${connectorUsage.outputTokens.toLocaleString()} · 缓存 ${connectorUsage.cachedInputTokens.toLocaleString()} token` : 'Codex 用量尚未返回；不会显示为零消耗。'}</p>}
    {!!trace.length && <ol className="agent-execution-trace">{trace.slice(-20).map((entry, index) => <li key={entry.at + ':' + index}><time>{new Date(entry.at).toLocaleTimeString()}</time><span>{entry.detail}</span></li>)}</ol>}
  </div></details>;
}
