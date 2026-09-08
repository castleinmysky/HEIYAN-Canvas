import type { ExecutionReceipt } from './agent-memory';
import { useState } from 'react';
import { canvasImagePreviewUrl } from '../components/CanvasNodes';
import type { CanvasAgentItem } from './CanvasAgentDock';
import { generationReceipts, jobLabels, resultChecks, waitingJob, type JobSnapshot } from './agent-jobs';
import { AgentNodeThumbnail } from './AgentNodeThumbnail';
const labels = { meets: 'Agent 评估符合要求', needs_changes: '需要调整', uncertain: '还有内容未核实' };
function JobMedia({ job }: { job: JobSnapshot }) {
  const [selected, setSelected] = useState(0), index = Math.min(selected, Math.max(0, job.outputs.length - 1)), output = job.outputs[index];
  if (!output?.mediaUrl) return null;
  const url = output.mediaUrl;
  const downloadable = /^(https?:|blob:|\/)/i.test(url) && !url.startsWith('//');
  return <div className="agent-job-media">{job.type === 'image' ? <img loading="lazy" src={canvasImagePreviewUrl(url, output.previewUrl)} alt={`${job.title} · 本次第 ${index + 1} 个结果`} /> : job.type === 'video' ? <video key={url} controls preload="none" poster={output.previewUrl} src={url} /> : job.type === 'audio' ? <audio key={url} controls preload="none" src={url} /> : <p>本次 3D 素材已返回，可下载查看或定位节点。</p>}
    {job.outputs.length > 1 && <div className="agent-output-choices" aria-label="选择本次结果">{job.outputs.map((_, i) => <button type="button" key={i} aria-pressed={index === i} onClick={() => setSelected(i)}>结果 {i + 1}</button>)}</div>}
    {downloadable && <a href={url} download target="_blank" rel="noopener noreferrer">打开 / 下载本次结果 {index + 1}</a>}
  </div>;
}
export function parseReceipt(receipt: ExecutionReceipt) { try { return JSON.parse(receipt.result); } catch { return null; } }
export function AgentResultCard({ receipt, jobs, receipts, items, focus, connected, active, followup }: {
  receipt: ExecutionReceipt; jobs: JobSnapshot[]; receipts: ExecutionReceipt[]; items: CanvasAgentItem[]; focus: (ids: string[], label: string) => void;
  connected: boolean; active: boolean; followup: (text: string, ids: string[]) => void;
}) {
  const data = parseReceipt(receipt);
  if (receipt.status !== 'succeeded' || !data) return <div>{receipt.status === 'failed' ? '操作未完成：' : ''}{receipt.result}</div>;
  if (receipt.tool === 'heiyan_review_result') return <div className="agent-assessment" data-verdict={data.verdict}><b>{labels[data.verdict as keyof typeof labels] || 'Agent 评估'}</b><p>{data.reason}</p><small>基于已读取的结果与本次要求，仍可由你确认或提出调整。</small><button type="button" onClick={() => focus([data.nodeId], '查看评估结果')}>定位结果</button></div>;
  if (receipt.tool === 'heiyan_edit_canvas') {
    const ids: string[] = data.affected || [...Object.values(data.created || {}), ...(data.changed || [])];
    return <section className="agent-edit-result"><span className="agent-card-kicker">画布已更新</span><strong>{data.summary || '已应用画布方案'}</strong><p>{Object.keys(data.created || {}).length ? `新增 ${Object.keys(data.created).length} 个节点 · ` : ''}{data.affectedCount ?? ids.length} 个节点受影响{data.deleted?.length ? ` · 移除 ${data.deleted.length} 个节点` : ''}</p><div className="agent-source-chips">{ids.slice(0, 12).map(id => <button type="button" key={id} disabled={!items.some(n => n.id === id)} onClick={() => focus([id], '查看修改结果')}>{items.find(n => n.id === id)?.title || data.titles?.[id] || '原节点已移除'}</button>)}</div>{!!ids.length && <button type="button" onClick={() => focus(ids, '查看本次修改')}>查看本次变化</button>}<small>已保留画布撤销记录；生成任务另行确认。</small></section>;
  }
  if (receipt.tool !== 'heiyan_request_generation') return <div>{receipt.result}</div>;
  const run = generationReceipts([receipt])[0];
  if (!run) return <div>生成已提交，请在节点核实状态。</div>;
  const current = run.targets.map(t => jobs.find(j => j.nodeId === t.nodeId && j.jobId === t.jobId)).filter((j): j is JobSnapshot => !!j);
  const completed = current.filter(j => j.state === 'succeeded').length;
  return <section className="agent-generation-results" aria-label="本次生成结果"><header><span className="agent-card-kicker">{current.some(j => waitingJob(j.state)) ? '素材处理中' : '生成任务记录'}</span><strong>{run.summary}</strong><span>{completed} / {run.targets.length} 个任务生成完成</span></header>
    {current.map(job => {
      const checks = resultChecks(job), review = [...receipts].reverse().filter(r => r.tool === 'heiyan_review_result' && r.status === 'succeeded').map(parseReceipt).find(r => r?.nodeId === job.nodeId && r?.jobId === job.jobId);
      return <article className="agent-job-card" key={job.nodeId + ':' + job.jobId} data-state={job.state}>
        <header><span className="canvas-agent-thumb"><AgentNodeThumbnail item={items.find(n => n.id === job.nodeId) || { id: job.nodeId, kind: 'imageGenerator' }} /></span><strong>{job.title}</strong><span>{jobLabels[job.state] || '状态待核实'}</span></header>
        {waitingJob(job.state) && <><progress max={100} value={job.progress} aria-label={job.progress === undefined ? '服务未返回进度' : `生成进度 ${job.progress}%`} /><p>{job.progress === undefined ? '等待服务返回进度' : `${Math.round(job.progress)}%`} · {job.detail}</p></>}
        {job.state === 'succeeded' && <JobMedia job={job} />}
        {!waitingJob(job.state) && job.state !== 'succeeded' && <p role="status">{job.detail}</p>}
        {job.state === 'succeeded' && <><ul className="agent-result-checks">{checks.map(c => <li key={c.label} data-state={c.state}><span>{c.label}</span><b>{({ passed: '已核对', failed: '不符', unknown: '未核实' })[c.state]}</b><small>{c.detail}</small></li>)}</ul><p className="agent-review-state">{review ? labels[review.verdict as keyof typeof labels] : '内容待检查 · 参数核对不代表画面符合要求'}</p>{review && <details><summary>查看评估理由</summary><p>{review.reason}</p></details>}</>}
        {job.stale && <p>节点内容后来有修改，请结合本次任务要求判断这份结果。</p>}
        <footer><button type="button" onClick={() => focus([job.nodeId], '查看本次生成结果')}>定位节点</button>
          {job.state === 'succeeded' && <button type="button" disabled={!connected || active} onClick={() => followup(`请检查生成任务 ${job.jobId}（节点 ${job.nodeId}）。本次目标：${run.summary}。先读取该任务的实际结果和参数，图片需要确认后逐个读取；按要求评估并记录结论，明确未核实部分。不要自动重新生成。`, [job.nodeId])}>让 Agent 检查</button>}
          {['failed', 'cancelled'].includes(job.state) || job.state === 'succeeded' && (review?.verdict === 'needs_changes' || checks.some(c => c.state === 'failed')) ? <button type="button" disabled={!connected || active} onClick={() => followup(`请核实任务 ${job.jobId}（节点 ${job.nodeId}）的失败或不符原因。本次目标：${run.summary}。${review?.reason || checks.filter(c => c.state === 'failed').map(c => c.label + '：' + c.detail).join('；')} 请解释修正方案，必要修改与重新生成均经画布确认后执行。`, [job.nodeId])}>提出修正并重试</button> : null}
        </footer>
      </article>;
    })}
    {!current.length && <p>画布暂未就绪，正在等待可核实的节点状态。</p>}
    {!!run.failed.length && <p role="alert">还有 {run.failed.length} 个节点未提交成功，请核实后再决定是否重试。</p>}
    <small>内容检查会使用当前 Agent 的额度；发送图片与重新生成仍需确认。</small>
  </section>;
}
