import type { CanvasNode, ResultOutput } from '../components/CanvasNodes';
import type { ExecutionReceipt } from './agent-memory';
export type JobTarget = { nodeId: string; jobId: string; title?: string; expected?: { count?: number; ratio?: string; resolution?: string; duration?: number }; criteria?: string };
export type JobSnapshot = JobTarget & { title: string; state: string; progress?: number; detail: string; stale?: boolean; type: string; outputs: ResultOutput[] };
export type ResultCheck = { label: string; state: 'passed' | 'failed' | 'unknown'; detail: string };
export const jobLabels: Record<string, string> = { queued: '排队中', running: '生成中', paused: '已暂停', cancelling: '取消中', succeeded: '生成完成', failed: '生成失败', cancelled: '已取消', unknown: '状态待核实', missing: '节点已移除' };
export const waitingJob = (state: string) => ['queued', 'running', 'paused', 'cancelling'].includes(state);
export const imageScope = (nodeId: string, jobId?: string, index = 0) => JSON.stringify([nodeId, jobId || '', index]);
export function jobSnapshot(nodes: CanvasNode[], target: JobTarget): JobSnapshot {
  const n = nodes.find(n => n.id === target.nodeId);
  if (!n) return { ...target, title: target.title || '原节点已移除', state: 'missing', detail: '无法从当前画布核实此任务', type: '', outputs: [] };
  const d = n.data;
  const version = [...(d.generationVersions || []), ...(d.modelVersions || []), ...(d.resultVersions || []), ...(d.modelExportVersions || [])].find(v => v.jobId === target.jobId);
  const matches = d.jobId === target.jobId;
  const state = version ? 'succeeded' : matches ? d.jobPollLost ? 'unknown' : d.jobState || 'unknown' : 'unknown';
  const type = version && 'mediaType' in version ? version.mediaType : n.data.kind === 'modelGenerator' ? 'model' : n.data.kind === 'audioGenerator' ? 'audio' : d.latestMediaType || (n.data.kind === 'videoGenerator' ? 'video' : 'image');
  // Old latestOutputs remain visible while a new job runs. Never attribute them to the new job.
  const outputs = version?.outputs || (matches && state === 'succeeded' && d.latestOutputJobId === target.jobId ? d.latestOutputs || [] : []);
  return { ...target, title: target.title || String(d.title || n.id), state, type, outputs,
    ...(matches && waitingJob(state) && Number.isFinite(d.progress) ? { progress: Math.min(100, Math.max(0, d.progress!)) } : {}),
    stale: !!d.stale, detail: state === 'unknown' ? '此任务状态尚无法核实，请定位节点查看；不会自动重试' : matches ? String(d.status || jobLabels[state] || state) : '已在节点历史版本中找到本次结果' };
}
export function resultChecks(job: JobSnapshot): ResultCheck[] {
  const expected = job.expected || {}, actual = job.outputs, checks: ResultCheck[] = [];
  if (job.state !== 'succeeded') return [{ label: '任务完成', state: ['failed', 'cancelled'].includes(job.state) ? 'failed' : 'unknown', detail: jobLabels[job.state] || '状态待核实' }];
  const usable = actual.filter(v => !!v.mediaUrl && v.simulated !== true && v.playable !== false);
  checks.push({ label: '素材返回', state: usable.length === actual.length && actual.length ? 'passed' : 'failed', detail: `${usable.length} 个可用素材${actual.some(v => v.simulated) ? '，含模拟结果' : ''}` });
  if (job.type !== 'model' && expected.count) checks.push({ label: '数量', state: actual.length === expected.count ? 'passed' : 'failed', detail: `${actual.length} / ${expected.count}` });
  const ratio = expected.ratio?.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (ratio) {
    const known = actual.length > 0 && actual.every(v => v.width && v.height);
    checks.push({ label: '比例', state: !known ? 'unknown' : actual.every(v => Math.abs(v.width! / v.height! / (+ratio[1] / +ratio[2]) - 1) <= .025) ? 'passed' : 'failed', detail: known ? `${actual.map(v => `${v.width}×${v.height}`).join('、')}；要求 ${expected.ratio}` : '服务未返回尺寸，尚不能判断' });
  }
  const resolution = expected.resolution?.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (expected.resolution) checks.push({ label: '分辨率', state: !resolution || !actual.length || actual.some(v => !v.width || !v.height) ? 'unknown' : actual.every(v => v.width === +resolution[1] && v.height === +resolution[2]) ? 'passed' : 'failed', detail: resolution ? `要求 ${expected.resolution}` : `规格 ${expected.resolution}，由模型定义，需核对实际尺寸` });
  if (job.type === 'video' && expected.duration) checks.push({ label: '时长', state: !actual.length || actual.some(v => !v.duration) ? 'unknown' : actual.every(v => Math.abs(v.duration! - expected.duration!) <= .5) ? 'passed' : 'failed', detail: `要求 ${expected.duration} 秒${actual[0]?.duration ? `，返回 ${actual.map(v => v.duration).join('、')} 秒` : '，服务未返回时长'}` });
  return checks;
}
export function safeJobReport(jobs: JobSnapshot[]) {
  return jobs.map(j => ({ nodeId: j.nodeId, jobId: j.jobId, title: j.title, state: j.state, progress: j.progress, stale: j.stale, type: j.type, expected: j.expected, criteria: j.criteria,
    checks: resultChecks(j), outputs: j.outputs.map((v, index) => ({ index, available: !!v.mediaUrl, width: v.width, height: v.height, duration: v.duration, simulated: !!v.simulated, playable: v.playable !== false })) }));
}
export function validateAssessment(job: JobSnapshot, verdict: string, seenImages: Map<string, string>) {
  const read = job.outputs.filter((output, index) => !!output.mediaUrl && seenImages.get(imageScope(job.nodeId, job.jobId, index)) === output.mediaUrl).length;
  const allRead = job.type === 'image' && job.outputs.length > 0 && read === job.outputs.length;
  const checks = resultChecks(job), failed = checks.some(c => c.state === 'failed');
  if (verdict === 'meets' && (job.state !== 'succeeded' || !allRead || checks.some(c => c.state !== 'passed'))) throw Error('尚不能记录符合要求：需要读取本次全部图片并完成参数核对。未核实的结果请标记 uncertain。');
  if (verdict === 'needs_changes' && job.state === 'succeeded' && !failed && !allRead) throw Error('请先获准读取实际图片再评价内容，无法检查的结果请标记 uncertain。');
  return { read, checks };
}
export function generationReceipts(receipts: ExecutionReceipt[]) {
  return receipts.filter(r => r.tool === 'heiyan_request_generation' && r.status === 'succeeded').flatMap(r => {
    try {
      const result = JSON.parse(r.result);
      const targets: JobTarget[] = (result.submitted || []).filter((v: any) => typeof v.id === 'string' && typeof v.jobId === 'string').map((v: any) => ({ nodeId: v.id, jobId: v.jobId, title: v.title, expected: v.expected, criteria: result.summary }));
      return targets.length ? [{ id: r.id, at: r.at, summary: String(result.summary || '素材生成'), targets, failed: Array.isArray(result.failed) ? result.failed : [] }] : [];
    } catch { return []; }
  }).slice(-30);
}
export async function waitForJobs(read: () => JobSnapshot[], seconds: number, signal: AbortSignal, update: (jobs: JobSnapshot[]) => void) {
  const deadline = Date.now() + seconds * 1000;
  while (true) {
    if (signal.aborted) throw Error('已停止等待，已提交的素材任务仍可在节点查看');
    const jobs = read(); update(jobs);
    if (!jobs.some(j => waitingJob(j.state)) || Date.now() >= deadline) return jobs;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(Error('等待已停止')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.min(1200, Math.max(0, deadline - Date.now())));
      signal.addEventListener('abort', abort, { once: true });
    });
  }
}
