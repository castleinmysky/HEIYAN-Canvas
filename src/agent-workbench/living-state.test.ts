import { describe, expect, it } from 'vitest';
import { activityStatus, canExpandLivingConversation, canFoldOnCanvas, compactAgentReceipt, compactAgentReceiptEntry, compactReceiptWidth, livingBotActivation, livingStatus, livingWidth, needsAgentApproval, pendingActivity } from './living-state';
import { emptyAgentState, type AgentState } from './agent-session';
const input = { state: { ...emptyAgentState(), connected: true }, activity: { phase: 'idle', detail: '', at: 0 }, mode: 'ask' as const, busy: false, restoring: false, hasConnection: true, jobs: [] };
describe('HEIYAN living status and content-driven sizing', () => {
  it('does not call an unknown working phase thinking or manufacture progress', () => {
    expect(livingStatus({ ...input, state: { ...input.state, active: true } }).pose).toBe('processing');
    expect(pendingActivity(input.state, 'ask').phase).toBe('processing');
  });
  it('preserves real reasoning/searching events and changes no width for them', () => {
    for (const phase of ['thinking', 'reading', 'searching', 'executing', 'waiting-generation', 'reviewing', 'responding']) {
      expect(livingStatus({ ...input, state: { ...input.state, active: true, activity: { phase, detail: '' } } }).active).toBe(true);
      expect(livingWidth(true, 'none', true)).toBe(800);
    }
    expect(livingStatus({ ...input, state: { ...input.state, active: true, activity: { phase: 'thinking', detail: '' } } }).pose).toBe('thinking');
  });
  it('maps every emitted runtime phase to a truthful visible reaction', () => {
    const expected = { preparing:'processing', context:'reading', compacting:'reading', thinking:'thinking', responding:'processing', reading:'reading', searching:'reading', executing:'executing', 'waiting-generation':'waiting', reviewing:'reviewing', question:'question', approval:'approval', blocked:'error', done:'done' } as const;
    for (const [phase, pose] of Object.entries(expected)) expect(activityStatus(phase).pose).toBe(pose);
    expect(activityStatus('compacting').label).toBe('整理上下文');
    expect(activityStatus('processing', '整理上下文').pose).toBe('reading');
    expect(activityStatus('responding').label).toBe('组织回复');
    expect(livingStatus({ ...input, state: { ...input.state, active: true }, activity: { phase:'executing', detail:'修改节点', nodeIds:['n1'], at:2 } }).pose).toBe('executing');
  });
  it('separates completed turns, active jobs, missing receipts and real failures', () => {
    const completed = { ...input, activity: { phase: 'done', detail: '', at: 1 } };
    expect(livingStatus(completed).pose).toBe('done');
    expect(livingStatus(completed).active).toBe(false);
    expect(livingStatus({ ...completed, jobs: [{ state: 'running' }] }).pose).toBe('waiting');
    expect(livingStatus({ ...completed, jobs: [{ state: 'unknown' }] }).label).toBe('生成状态待核实');
    expect(livingStatus({ ...completed, jobs: [{ state: 'failed' }] }).pose).toBe('error');
    expect(livingStatus({ ...completed, state: { ...input.state, connected: false, active: true } }).pose).toBe('offline');
    expect(livingStatus({ ...completed, state: { ...input.state, connected: false }, error: '当前授权不属于此工作区' }).label).toBe('连接中断 · 当前授权不属于此工作区');
  });
  it('does not mistake read-only or claimed calls for approval', () => {
    for (const tool of ['heiyan_read_canvas', 'heiyan_read_generation', 'heiyan_review_result', 'heiyan_search_history']) {
      const state = { ...input.state, active: true, pending: { id: 'p', tool, claimed: false, revision: 'r', input: { nodeIds: [] } } } as AgentState;
      expect(needsAgentApproval(state, 'ask')).toBe(false);
      expect(pendingActivity(state, 'ask').phase).not.toBe('approval');
    }
    const state = { ...input.state, active: true, pending: { id: 'p', tool: 'heiyan_request_generation', claimed: false, revision: 'r', input: { nodeIds: ['a'], summary: '生成' } } } as AgentState;
    expect(needsAgentApproval(state, 'ask')).toBe(true);
    expect(needsAgentApproval(state, 'full')).toBe(false);
    expect(needsAgentApproval({ ...state, pending: { ...state.pending!, claimed: true } }, 'ask')).toBe(false);
  });
  it('opens wide only for readable content, and only guards active text selection or IME while folding', () => {
    expect(livingWidth(false, 'none', false)).toBe(72);
    expect(livingWidth(false, 'approval', true)).toBe(260);
    expect(livingWidth(false, 'none', true, true)).toBe(420);
    expect(livingWidth(true, 'history', false)).toBe(960);
    const fold = { selecting: false, composing: false };
    expect(canFoldOnCanvas(fold)).toBe(true);
    for (const field of ['selecting', 'composing']) expect(canFoldOnCanvas({ ...fold, [field]: true })).toBe(false);
  });
  it('grows a collapsed receipt from its readable length in stable bounded steps', () => {
    const short = compactReceiptWidth('完成');
    const medium = compactReceiptWidth('已核对本轮五个节点并完成位置调整');
    const long = compactReceiptWidth('这是一个需要保留更多可读内容的较长回执，仍然不能无限遮挡画布，所以达到上限后继续省略显示。');
    expect(short).toBe(260);
    expect(medium).toBeGreaterThan(short);
    expect(long).toBeGreaterThanOrEqual(medium);
    expect(long).toBeLessThanOrEqual(480);
    expect(livingWidth(false, 'none', true, false, '完成')).toBe(short);
    expect(compactReceiptWidth('完成', true)).toBeGreaterThanOrEqual(short);
    expect(livingWidth(false, 'none', true, true, long.toString())).toBe(420);
  });
  it('opens quick input from a bare connected Bot before opening the full conversation', () => {
    expect(livingBotActivation(false, false, true)).toBe('quick');
    expect(livingBotActivation(false, true, true)).toBe('conversation');
    expect(livingBotActivation(false, false, false)).toBe('conversation');
    expect(livingBotActivation(true, false, true)).toBe('close');
    expect(canExpandLivingConversation({ connected: true, messages: 0, pending: false, question: false, attention: false, jobs: 0 })).toBe(false);
    expect(canExpandLivingConversation({ connected: true, messages: 1, pending: false, question: false, attention: false, jobs: 0 })).toBe(true);
    expect(canExpandLivingConversation({ connected: false, messages: 0, pending: false, question: false, attention: false, jobs: 0 })).toBe(true);
  });
  it('uses the latest Agent receipt in the collapsed conversation instead of runtime status', () => {
    const messages = [
      { id: 'u', role: 'user', text: '请开始' },
      { id: 'a', role: 'assistant', text: '**已读取** 3 个节点\n正在整理方案。' },
    ] as const;
    expect(compactAgentReceipt(messages)).toBe('已读取 3 个节点 正在整理方案。');
    expect(compactAgentReceiptEntry(messages)).toEqual({ id: 'a', text: '已读取 3 个节点 正在整理方案。' });
    expect(compactAgentReceipt([{ id: 'u', role: 'user', text: '只有用户消息' }])).toBe('');
  });
  it('shows a human receipt instead of leaking canvas action JSON', () => {
    expect(compactAgentReceipt([
      { id: 'a', role: 'assistant', text: '我会检查节点并继续处理。' },
      { id: 'execution:1', role: 'notice', text: '{"action":"node.inspect","summary":"已检查角色节点","status":"completed","affected":["n1"]}' },
    ])).toBe('已检查角色节点');
    expect(compactAgentReceipt([
      { id: 'a', role: 'assistant', text: '正在核对画布内容。' },
      { id: 'execution:2', role: 'notice', text: '{"revision":"r2","nodes":[{"id":"n1"}]}' },
    ])).toBe('正在核对画布内容。');
    expect(compactAgentReceipt([
      { id: 'a', role: 'assistant', text: '等待完整回执。' },
      { id: 'stream', role: 'notice', text: '{"action":"node.inspect"' },
    ])).toBe('等待完整回执。');
  });
});

