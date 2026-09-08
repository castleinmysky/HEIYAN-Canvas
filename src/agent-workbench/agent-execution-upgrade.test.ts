import { probeApi } from './agent-capabilities';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPayload, compactApi, omitNullArguments, strictSchema, type ApiProfile } from './agent-api';
import { readAgentResponse } from './agent-stream';
import { buildProjectContext, contextLimits, estimateTokens } from './agent-context';
import { emptyProject } from './agent-memory';
import { SemanticIndex, type SearchDocument } from './agent-search';
import { runApiAgent, type RunnerCallbacks } from './agent-runner';
import { validateAgentTool, agentTools } from '../../server/agent-contract.js';
const profile: ApiProfile = { provider: 'custom', baseUrl: 'https://gateway.vendor.com/v1', apiKey: 'KEEP_PRIVATE', model: 'main-model', protocol: 'responses', vision: false, effort: '', contextChars: 48000, contextTokens: 48000, outputTokens: 2048, tokenBudget: 250000, callLimit: 8 };
const signal = () => new AbortController().signal;
const json = (body: unknown) => Response.json(body);
function sse(events: string[], size = 7) {
  const bytes = new TextEncoder().encode(events.join(''));
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}
const event = (data: unknown) => 'data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\r\n\r\n';
const final = (text = '完成') => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 10, output_tokens: 2 } });
function callbacks(): RunnerCallbacks {
  return { project: emptyProject, task: () => '保持四头身', notes: () => [], hasNotes: () => false,
    read: vi.fn(async () => ({ revision: 'r1', nodes: [], edges: [], referenceIds: [] })), search: vi.fn(async () => '{}'),
    decide: vi.fn(async () => ({ success: false, result: '用户拒绝' })), message: vi.fn(async () => {}), draft: vi.fn(), usage: vi.fn(async () => {}), summary: vi.fn(async () => {}), activity: vi.fn() };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('streamed model execution', () => {
  it('reassembles UTF-8 and split SSE/CRLF boundaries and returns canonical Responses items', async () => {
    const response = final('四头身角色');
    const onText = vi.fn();
    const parsed = await readAgentResponse(sse([event({ type: 'response.output_text.delta', delta: '四头' }), event({ type: 'response.output_text.delta', delta: '身角色' }), event({ type: 'response.completed', response })], 1), 'responses', onText);
    expect(parsed.text).toBe('四头身角色'); expect(parsed.responseItems).toEqual(response.output); expect(parsed.streamed).toBe(true); expect(onText).toHaveBeenCalledWith('四头身角色');
  });
  it('assembles Chat tool arguments but refuses unfinished tool streams', async () => {
    const events = [event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'heiyan_read_canvas', arguments: '{"query":' } }] } }] }),
      event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"角色"}' } }] }, finish_reason: 'tool_calls' }] }), event({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } }), event('[DONE]')];
    expect((await readAgentResponse(sse(events), 'chat')).calls[0].arguments).toBe('{"query":"角色"}');
    await expect(readAgentResponse(sse(events.slice(0, 1)), 'chat')).rejects.toThrow('中断');
  });
  it('never dispatches tools from an interrupted Responses stream', async () => {
    const c = callbacks();
    vi.stubGlobal('fetch', vi.fn(async () => sse([event({ type: 'response.output_item.added', item: { type: 'function_call', call_id: 'c', name: 'heiyan_request_generation', arguments: '{"nodeIds":["n"],"summary":"生成"}' } })])));
    await expect(runApiAgent({ ...profile, stream: true }, [{ role: 'user', content: '生成图片' }], 't', 'r1', signal(), c)).rejects.toThrow('中断');
    expect(c.decide).not.toHaveBeenCalled();
  });
  it('returns rejection to the model and records no successful generation', async () => {
    const c = callbacks(); let n = 0;
    const fetchMock = vi.fn(async (_: unknown, options: any) => {
      const body = JSON.parse(options.body); expect(options.body).not.toContain(profile.apiKey);
      if (n++ === 0) return json({ ...final(), output: [{ type: 'function_call', call_id: 'c1', name: 'heiyan_request_generation', arguments: JSON.stringify({ summary: '生成', nodeIds: ['n'] }) }] });
      expect(body.input.some((item: any) => item.type === 'function_call_output' && item.output.includes('false'))).toBe(true); return json(final('已取消生成'));
    });
    vi.stubGlobal('fetch', fetchMock);
    await runApiAgent(profile, [{ role: 'user', content: '生成' }], 't', 'r1', signal(), c);
    expect(c.decide).toHaveBeenCalledOnce(); expect(c.message).toHaveBeenLastCalledWith('t:1', '已取消生成');
  });
  it('applies mid-request steering before any proposed side effect', async () => {
    const c = callbacks(); let turn = 0, queued = false;
    c.notes = () => { if (!queued) return []; queued = false; return ['不要生成，先检查']; };
    vi.stubGlobal('fetch', vi.fn(async (_: unknown, options: any) => {
      if (turn++ === 0) { queued = true; return json({ ...final(), output: [{ type: 'function_call', call_id: 'old', name: 'heiyan_request_generation', arguments: '{"summary":"生成","nodeIds":["n"]}' }] }); }
      expect(options.body).toContain('不要生成，先检查'); return json(final('先检查'));
    }));
    await runApiAgent(profile, [{ role: 'user', content: '生成' }], 't', 'r1', signal(), c);
    expect(c.decide).not.toHaveBeenCalled();
  });
  it('does not execute the remainder of a tool batch after new instructions arrive', async () => {
    const c = callbacks(); let notes: string[] = [], turn = 0;
    c.notes = () => notes.splice(0); c.hasNotes = () => !!notes.length;
    c.decide = vi.fn(async () => { notes.push('停止后面的修改'); return { success: true, result: '第一项已执行' }; });
    vi.stubGlobal('fetch', vi.fn(async () => turn++ === 0 ? json({ ...final(), output: ['a', 'b'].map(id => ({ type: 'function_call', call_id: id, name: 'heiyan_edit_canvas', arguments: '{"summary":"新增","operations":[{"action":"create","id":"x","kind":"text","title":"角色"}]}' })) }) : json(final())));
    await runApiAgent(profile, [{ role: 'user', content: '创建' }], 't', 'r1', signal(), c);
    expect(c.decide).toHaveBeenCalledOnce();
  });
  it('blocks the next request when its input and output reserve exceed task budget', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(runApiAgent({ ...profile, tokenBudget: 10 }, [{ role: 'user', content: 'hello' }], 't', 'r1', signal(), callbacks())).rejects.toThrow('预算');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('executes independent reads concurrently while preserving returned tool order', async () => {
    const c = callbacks(); let started = 0, turn = 0; let finishRead!: () => void;
    const gate = new Promise<void>(resolve => { finishRead = resolve; });
    c.read = vi.fn(async () => { started++; await gate; return { revision: 'r1', nodes: [], edges: [], referenceIds: [] }; });
    c.search = vi.fn(async () => { expect(started).toBe(1); finishRead(); return '{}'; });
    vi.stubGlobal('fetch', vi.fn(async (_: unknown, options: any) => {
      if (turn++ === 0) return json({ ...final(), output: ['heiyan_read_canvas', 'heiyan_search_history'].map((name, i) => ({ type: 'function_call', call_id: String(i), name, arguments: '{}' })) });
      const results = JSON.parse(options.body).input.filter((v: any) => v.type === 'function_call_output'); expect(results.map((v: any) => v.call_id)).toEqual(['0', '1']); return json(final());
    }));
    await runApiAgent(profile, [{ role: 'user', content: '读取资料' }], 't', 'r1', signal(), c);
  });
});
describe('protected context and protocol fidelity', () => {
  it('keeps the current request and requirements intact and explicitly rejects impossible budgets', () => {
    const p = emptyProject(); p.requirements = '四头身，纯黑背景，不要武器'; p.goal = '做角色三视图'; p.progress = '背面待完成'; p.summary = '旧摘要'.repeat(3000);
    p.messages = Array.from({ length: 80 }, (_, i) => ({ id: String(i), role: 'user', text: '历史原话'.repeat(100) }));
    const value = buildProjectContext(p, 2500, '最新补充：背部保持红色');
    expect(value).toContain(p.requirements); expect(value).toContain('背部保持红色'); expect(estimateTokens(value)).toBeLessThanOrEqual(2500); expect(p.messages).toHaveLength(80);
    expect(() => buildProjectContext({ ...p, requirements: '不得删除'.repeat(2000) }, 500)).toThrow('要求未被截断');
    expect(contextLimits(profile).input + contextLimits(profile).output).toBeLessThan(profile.contextTokens!);
  });
  it('makes optional enum fields nullable without malformed schema and preserves local validation', () => {
    const schema = strictSchema((agentTools as any[]).find(t => t.name === 'heiyan_edit_canvas').inputSchema);
    expect(schema.properties.operations.items.properties.kind.type).toEqual(['string', 'null']);
    expect(schema.properties.operations.items.required).toContain('kind');
    expect(validateAgentTool('heiyan_read_canvas', omitNullArguments({ query: null, nodeIds: null, offset: null, promptOffset: null }))).toEqual({});
    expect(() => validateAgentTool('heiyan_edit_canvas', omitNullArguments({ summary: 'bad', operations: [{ action: 'delete', id: 'a', apiKey: 'x' }] }))).toThrow();
  });
  it('replays the entire native compaction window with no key in its model payload', async () => {
    const output = [{ role: 'user', content: '必须保留的消息' }, { type: 'compaction', encrypted_content: 'opaque' }, { role: 'assistant', content: '保留结果' }];
    vi.stubGlobal('fetch', vi.fn(async () => json({ output, usage: { input_tokens: 100, output_tokens: 10 } })));
    const result = await compactApi(profile, [{ role: 'user', content: '原始上下文' }], signal());
    const payload = apiPayload(profile, [result.message]) as { input: object[] };
    expect(payload.input).toEqual(output); expect(JSON.stringify(payload)).not.toContain(profile.apiKey);
  });
});
describe('hybrid project retrieval', () => {
  it('finds semantically related text without lexical overlap and invalidates changed/deleted material', async () => {
    const index = new SemanticIndex(); index.configure({ ...profile, model: 'embedding-model' });
    const docs: SearchDocument[] = [{ source: 'message', id: 'm17', title: '原话', text: '朱红色披风的侠客' }, { source: 'node', id: 'snow', title: '场景', text: '冰原雪景' }];
    vi.stubGlobal('fetch', vi.fn(async (_: unknown, options: any) => {
      const input = JSON.parse(options.body).input;
      return json({ data: input.map((text: string, i: number) => ({ index: i, embedding: text.includes('冰') ? [0, 1] : [1, 0] })), usage: { total_tokens: 10 } });
    }));
    await index.build(docs, signal(), () => {});
    const result = await index.search(docs, 'red cape hero', signal());
    expect(result.mode).toBe('hybrid'); expect(result.hits[0].id).toBe('m17'); expect(result.hits[0].match).toBe('semantic'); expect(result.hits[0].text).toBe('朱红色披风的侠客');
    expect((await index.search([{ ...docs[0], text: '冰原雪景' }, docs[1]], 'red cape hero', signal())).hits.some(h => h.id === 'm17')).toBe(false);
    expect((await index.search([docs[1]], 'red cape hero', signal())).hits.some(h => h.id === 'm17')).toBe(false);
    index.configure({ ...profile, model: 'other' }); expect(index.coverage(docs).indexed).toBe(0);
  });
  it('uses a labelled lexical fallback when the embedding service fails', async () => {
    const index = new SemanticIndex(); index.configure({ ...profile, model: 'embedding-model' });
    const docs: SearchDocument[] = [{ id: 'a', source: 'message', title: '原话', text: '四头身角色' }];
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ index: 0, embedding: [1, 0] }] })));
    await index.build(docs, signal(), () => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    const result = await index.search(docs, '四头身', signal()); expect(result.mode).toBe('keyword'); expect(result.note).toContain('暂不可用'); expect(result.hits[0].text).toBe('四头身角色');
  });
});

describe('provider capability detection', () => {
  it('keeps the selected model and reports unsupported streaming/strict features honestly', async () => {
    const capabilities: any[] = [], models: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_: unknown, options: any) => {
      const body = JSON.parse(options.body); models.push(body.model);
      if (options.headers['x-heiyan-upstream'].endsWith('/input_tokens')) return new Response('', { status: 404 });
      if (body.tools?.some((t: any) => t.strict)) return new Response('', { status: 400 });
      if (body.tools) return json({ ...final(), output: [{ type: 'function_call', call_id: 'probe', name: 'heiyan_read_canvas', arguments: '{}' }] });
      return json(final('连接成功'));
    }));
    const tested = await probeApi({ ...profile, nativeCompaction: false, stream: true }, signal(), c => capabilities.push(c));
    expect(tested.stream).toBe(false); expect(tested.strict).toBe(false); expect(tested.countTokens).toBe(false);
    expect(capabilities.find(c => c.key === 'tools').status).toBe('passed'); expect(capabilities.find(c => c.key === 'stream').status).toBe('unavailable');
    expect(new Set(models)).toEqual(new Set(['main-model']));
  });
  it('verifies native compaction by actually continuing from its canonical window', async () => {
    const capabilities: any[] = [];
    let replayed = false;
    vi.stubGlobal('fetch', vi.fn(async (_: unknown, options: any) => {
      const body = JSON.parse(options.body), target = options.headers['x-heiyan-upstream'];
      if (target.endsWith('/input_tokens')) return json({ input_tokens: 100 });
      if (target.endsWith('/compact')) return json({ output: [{ type: 'compaction', encrypted_content: 'opaque' }, { role: 'user', content: 'retained' }], usage: { input_tokens: 100, output_tokens: 10 } });
      if (body.input?.some((i: any) => i.type === 'compaction')) { expect(body.input.some((i: any) => i.content === 'retained')).toBe(true); replayed = true; }
      if (body.tools) return json({ ...final(), output: [{ type: 'function_call', call_id: 'probe', name: 'heiyan_read_canvas', arguments: body.tools[0].strict ? '{"query":null,"nodeIds":null,"offset":null,"promptOffset":null}' : '{}' }] });
      return body.stream ? sse([event({ type: 'response.completed', response: final() })]) : json(final());
    }));
    const tested = await probeApi({ ...profile, nativeCompaction: true, stream: true }, signal(), c => capabilities.push(c));
    expect(tested.strict).toBe(true); expect(tested.countTokens).toBe(true); expect(tested.nativeCompaction).toBe(true); expect(tested.stream).toBe(true); expect(replayed).toBe(true);
  });
});
