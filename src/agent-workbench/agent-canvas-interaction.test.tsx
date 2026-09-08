import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CanvasNode, CanvasNodeKind } from '../components/CanvasNodes';
import { canvasAgentContext, canvasAgentRevision, planAgentEdits } from './agent-canvas';
import { expandGroupMoves, layoutPositions, nodeBounds } from './agent-spatial';
import { editPreview } from './agent-proposals';
import { generationReceipts, imageScope, jobSnapshot, resultChecks, safeJobReport, validateAssessment, waitForJobs, type JobSnapshot } from './agent-jobs';
import { sanitizeAgentContext, sanitizeGenerationReport, validateAgentTool } from '../../server/agent-contract.js';
import { AgentResultCard } from './AgentResultCard';
import { emptyProject, type ExecutionReceipt } from './agent-memory';
import { runApiAgent, type RunnerCallbacks } from './agent-runner';
import type { ApiProfile } from './agent-api';
const node = (id: string, kind: CanvasNodeKind = 'imageGenerator'): CanvasNode => ({ id, type: kind, position: { x: 0, y: 0 }, width: 200, height: 120, data: { kind, title: id, prompt: '旧描述' } });
const target = { nodeId: 'n', jobId: 'new', expected: { count: 1, ratio: '1:1', resolution: '512x512' } };
const output = { mediaUrl: 'https://assets.example/result.png', width: 512, height: 512 };
const job = (): JobSnapshot => ({ ...target, title: '角色', state: 'succeeded', detail: '', type: 'image', outputs: [output] });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('spatial planning and reviewable changes', () => {
  it('retains absolute bounds, parent-local positions and viewport without leaking extra fields', () => {
    const parent = { ...node('group', 'collection'), position: { x: 1000, y: 400 } };
    const child = { ...node('child'), parentId: 'group', position: { x: 20, y: 30 }, data: { ...node('child').data, apiKey: 'NEVER_SEND' } };
    const result = sanitizeAgentContext({ ...canvasAgentContext([parent, child], [], [], [], {}, { x: 1000, y: 400, width: 600, height: 500, zoom: 1 }), apiKey: 'NEVER_SEND' });
    expect(result.nodes[1].spatial).toMatchObject({ position: { x: 20, y: 30 }, bounds: { x: 1020, y: 430, width: 200, height: 120 }, parentId: 'group', visible: true });
    expect(JSON.stringify(result)).not.toContain('NEVER_SEND');
  });
  it('uses measured widths, converts cross-parent layouts and keeps originals unchanged', () => {
    const a = { ...node('a'), measured: { width: 300, height: 200 } }, parent = { ...node('p', 'collection'), position: { x: 1000, y: 500 } }, b = { ...node('b'), parentId: 'p' };
    const positions = layoutPositions([a, parent, b], { action: 'layout', nodeIds: ['a', 'b'], layout: 'row', gap: 50 });
    expect(positions.get('a')).toEqual({ x: 0, y: 0 });
    expect(nodeBounds({ ...b, position: positions.get('b')! }, [a, parent, b])).toMatchObject({ x: 350, y: 0 });
    expect(b.position).toEqual({ x: 0, y: 0 });
  });
  it('places nodes relative to the anchor and rejects moving a group with its child', () => {
    const anchor = { ...node('a'), position: { x: 100, y: 100 } }, b = node('b');
    expect(layoutPositions([anchor, b], { action: 'layout', nodeIds: ['b'], layout: 'right-of', anchorId: 'a', gap: 64 }).get('b')).toEqual({ x: 364, y: 100 });
    expect(() => layoutPositions([anchor, { ...b, parentId: 'a' }], { action: 'layout', nodeIds: ['a', 'b'], layout: 'row' })).toThrow('分开');
  });
  it('does not invalidate approval merely because the user locates a node or progress ticks', () => {
    const n = node('n'), original = canvasAgentRevision([n], []);
    expect(canvasAgentRevision([{ ...n, selected: true, data: { ...n.data, progress: 25, status: '运行中' } }], [])).toBe(original);
    expect(canvasAgentRevision([{ ...n, data: { ...n.data, prompt: '新要求' } }], [])).not.toBe(original);
    expect(canvasAgentRevision([{ ...n, data: { ...n.data, jobId: 'another-job' } }], [])).not.toBe(original);
  });
  it('moves collection members together without double-moving children in parent coordinates', () => {
    const group = { ...node('g', 'collection'), data: { ...node('g', 'collection').data, memberIds: ['child', 'parent'] } };
    const parent = { ...node('parent'), position: { x: 100, y: 200 } }, child = { ...node('child'), parentId: 'parent', position: { x: 10, y: 20 } };
    const positions = expandGroupMoves([group, parent, child], new Map([['g', { x: 500, y: 300 }]]));
    expect(positions.get('parent')).toEqual({ x: 600, y: 500 }); expect(positions.has('child')).toBe(false);
    const next = [group, parent, child].map(n => positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n);
    expect(nodeBounds(next[2], next)).toMatchObject({ x: 610, y: 520 });
  });
  it('previews exact content and connections while failed later edits commit nothing', () => {
    const a = node('a', 'text'), b = node('b'), before = JSON.stringify([a, b]);
    const adapters = { create: (kind: CanvasNodeKind) => node('created', kind), connect: (source: string, target: string) => ({ id: 'link', source, target }) };
    const planned = planAgentEdits({ summary: '调整', operations: [{ action: 'update', id: 'b', prompt: '四头身角色' }, { action: 'connect', source: 'a', target: 'b' }, { action: 'layout', nodeIds: ['b'], layout: 'right-of', anchorId: 'a' }] }, [a, b], [], adapters);
    const preview = editPreview([a, b], planned.nodes, [], planned.edges, 'r', planned.warnings);
    expect(preview.changes[0].fields).toEqual(expect.arrayContaining([{ label: '描述', before: '旧描述', after: '四头身角色' }, { label: '输入引用', before: '无', after: 'a' }]));
    expect(JSON.stringify([a, b])).toBe(before);
    expect(() => planAgentEdits({ summary: '失败', operations: [{ action: 'update', id: 'b', prompt: '新描述' }, { action: 'layout', layout: 'row', nodeIds: ['missing'] }] }, [a, b], [], adapters)).toThrow();
    expect(JSON.stringify([a, b])).toBe(before);
  });
});
describe('exact task results and assessments', () => {
  it('never attributes old visible outputs to a new job, even a success with no new output', () => {
    const n = node('n'); n.data = { ...n.data, jobId: 'new', jobState: 'running', latestOutputs: [output], latestOutputJobId: 'old' };
    expect(jobSnapshot([n], target).outputs).toEqual([]);
    n.data.jobState = 'succeeded'; expect(jobSnapshot([n], target).outputs).toEqual([]);
    n.data.latestOutputJobId = 'new'; expect(jobSnapshot([n], target).outputs).toEqual([output]);
  });
  it('finds the exact historical version and never substitutes another current job', () => {
    const n = node('n'); n.data = { ...n.data, jobId: 'other', jobState: 'succeeded', latestOutputs: [output], generationVersions: [{ jobId: 'new', mediaType: 'image', outputs: [{ ...output, mediaUrl: '/exact.png' }] }] };
    expect(jobSnapshot([n], target).outputs[0].mediaUrl).toBe('/exact.png');
    expect(jobSnapshot([n], { ...target, jobId: 'unknown-job' })).toMatchObject({ state: 'unknown', outputs: [] });
    expect(jobSnapshot([], target).state).toBe('missing');
  });
  it('labels missing metadata as unknown and flags wrong count or simulated assets', () => {
    expect(resultChecks({ ...job(), outputs: [{ mediaUrl: '/image.png' }] }).find(c => c.label === '比例')?.state).toBe('unknown');
    expect(resultChecks({ ...job(), outputs: [{ ...output, simulated: true }] }).find(c => c.label === '素材返回')?.state).toBe('failed');
    expect(resultChecks({ ...job(), outputs: [output, output] }).find(c => c.label === '数量')?.state).toBe('failed');
  });
  it('requires every exact image and verified metadata before recording meets', () => {
    const seen = new Map<string, string>();
    expect(() => validateAssessment(job(), 'meets', seen)).toThrow('尚不能');
    seen.set(imageScope('n', 'old', 0), output.mediaUrl); expect(() => validateAssessment(job(), 'meets', seen)).toThrow();
    seen.set(imageScope('n', 'new', 0), output.mediaUrl); expect(validateAssessment(job(), 'meets', seen).read).toBe(1);
    expect(() => validateAssessment({ ...job(), outputs: [output, { ...output, mediaUrl: '/second.png' }] }, 'meets', seen)).toThrow();
    expect(() => validateAssessment({ ...job(), outputs: [{ mediaUrl: output.mediaUrl }] }, 'meets', seen)).toThrow();
    expect(() => validateAssessment({ ...job(), type: 'video' }, 'meets', seen)).toThrow();
    expect(validateAssessment({ ...job(), type: 'video' }, 'uncertain', seen)).toBeTruthy();
  });
  it('sends only safe metadata through the connector, with no media URLs or extra keys', () => {
    const report = safeJobReport([job()]);
    const clean = sanitizeGenerationReport(report.map(r => ({ ...r, apiKey: 'PRIVATE_KEY', outputs: r.outputs.map(o => ({ ...o, mediaUrl: 'PRIVATE_URL' })) })));
    expect(JSON.stringify(clean)).not.toMatch(/PRIVATE_|assets\.example/);
    expect(clean[0]).toMatchObject({ jobId: 'new', outputs: [{ width: 512, height: 512, available: true }] });
  });
  it('waits for actual terminal state and handles an explicit abort', async () => {
    vi.useFakeTimers(); let current = { ...job(), state: 'running' };
    const read = () => [current], progress = vi.fn(), abort = new AbortController();
    const completed = waitForJobs(read, 60, abort.signal, progress); current = job();
    await vi.advanceTimersByTimeAsync(1200); expect((await completed)[0].state).toBe('succeeded');
    current = { ...job(), state: 'running' }; const stopped = waitForJobs(read, 60, abort.signal, progress);
    const rejected = expect(stopped).rejects.toThrow('停止'); abort.abort(); await rejected;
  });
  it('validates exact result identities and keeps schema limits on layout and image variants', () => {
    expect(validateAgentTool('heiyan_read_images', { nodeIds: ['n'], jobIds: ['new'], outputIndexes: [0] })).toMatchObject({ jobIds: ['new'] });
    expect(() => validateAgentTool('heiyan_read_images', { nodeIds: ['n'], jobIds: ['new'], outputIndexes: [-1] })).toThrow();
    expect(() => validateAgentTool('heiyan_read_generation', { jobs: [{ nodeId: 'n', jobId: 'new' }], waitSeconds: 61 })).toThrow();
    expect(() => validateAgentTool('heiyan_edit_canvas', { summary: '布局', operations: [{ action: 'layout', nodeIds: ['n'], layout: 'row', gap: -10 }] })).toThrow();
  });
  it('renders the exact result card, objective checks and explicit follow-up controls', () => {
    const receipt: ExecutionReceipt = { id: 'r', tool: 'heiyan_request_generation', status: 'succeeded', at: 1, result: JSON.stringify({ summary: '生成角色', submitted: [{ id: 'n', jobId: 'new', expected: target.expected }] }) };
    expect(generationReceipts([receipt])[0].targets[0].jobId).toBe('new');
    const html = renderToStaticMarkup(<AgentResultCard receipt={receipt} receipts={[receipt]} jobs={[job()]} items={[]} focus={vi.fn()} connected active={false} followup={vi.fn()} />);
    expect(html).toContain('内容待检查'); expect(html).toContain('让 Agent 检查'); expect(html).toContain(output.mediaUrl); expect(html).toContain('本次结果 1');
    expect(html).not.toContain('Agent 评估符合要求');
  });
});
describe('generation execution observation', () => {
  it('waits without extra model calls and returns observed job state before assessment', async () => {
    const profile: ApiProfile = { provider: 'custom', baseUrl: 'https://api.example/v1', apiKey: 'test', model: 'main', protocol: 'responses', vision: true, effort: '', contextChars: 48000, contextTokens: 100000, outputTokens: 2048, tokenBudget: 900000 };
    let calls = 0, reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (_: unknown, init: RequestInit) => {
      if (!calls++) return Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: 'gen', name: 'heiyan_request_generation', arguments: '{"summary":"生成角色","nodeIds":["n"]}' }], usage: { input_tokens: 10, output_tokens: 1 } });
      expect(String(init.body)).toContain('observed'); expect(String(init.body)).toContain('succeeded');
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '现在检查结果' }] }], usage: { input_tokens: 10, output_tokens: 1 } });
    }));
    const c: RunnerCallbacks = { project: emptyProject, task: () => '生成角色', notes: () => [], hasNotes: () => false, read: async () => ({ revision: 'r', nodes: [], edges: [], referenceIds: [] }), search: async () => '',
      decide: vi.fn(async () => ({ success: true, result: JSON.stringify({ submitted: [{ id: 'n', jobId: 'new' }] }) })),
      inspect: vi.fn(async () => JSON.stringify({ revision: 'latest', jobs: [{ nodeId: 'n', jobId: 'new', state: reads++ ? 'succeeded' : 'running' }] })), message: async () => {}, draft: () => {}, usage: async () => {}, summary: async () => {}, activity: () => {} };
    await runApiAgent(profile, [{ role: 'user', content: '生成角色' }], 't', 'r', new AbortController().signal, c);
    expect(c.decide).toHaveBeenCalledTimes(1); expect(c.inspect).toHaveBeenCalledTimes(2); expect(calls).toBe(2);
  });
});
