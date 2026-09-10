import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiStep, type ApiProfile, type Capability } from './agent-api';
import { probeApi, PROBE_LIMITS, type ProbeProgress } from './agent-capabilities';
import { readAgentResponse } from './agent-stream';

const profile: ApiProfile = { provider: 'custom', baseUrl: 'https://relay.example/v1', apiKey: 'fixture-only', model: 'unchanged-model', protocol: 'responses', vision: false, effort: '', contextChars: 48000, stream: false, nativeCompaction: false };
const complete = (tools = false) => ({ status: 'completed', output: [tools
  ? { type: 'function_call', call_id: 'probe', name: 'heiyan_read_canvas', arguments: '{"nodeIds":null,"query":null,"offset":null,"promptOffset":null}' }
  : { type: 'message', content: [{ type: 'output_text', text: '连接成功' }] }] });
const never = <T,>() => new Promise<T>(() => {});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const signal = () => new AbortController().signal;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded connection probes', () => {
  it('preserves the self-hosted transport and its injected request adapter', async () => {
    const fallback = vi.fn(() => { throw Error('Unexpected global transport'); });
    vi.stubGlobal('fetch', fallback);
    const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(url).toBe('/api/v1/agent/cloud/request');
      expect(init?.credentials).toBe('same-origin');
      expect(new Headers(init?.headers).get('x-heiyan-upstream')).toBe('https://relay.example/v1/responses');
      expect(JSON.parse(String(init?.body)).model).toBe(profile.model);
      expect(String(init?.body)).not.toContain(profile.apiKey);
      return Response.json(complete());
    });
    expect((await apiStep({ ...profile, request }, [{ role: 'user', content: 'hello' }], signal())).text).toBe('连接成功');
    expect(request).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled();
  });

  it.each([1, 2])('reports and releases a stuck required round %s without retrying', async round => {
    vi.useFakeTimers();
    const progress: ProbeProgress[] = [], rows: Capability[] = [];
    const request = vi.fn(async () => request.mock.calls.length === round ? never<Response>() : Response.json(complete(true)));
    const result = probeApi({ ...profile, request }, signal(), row => rows.push(row), undefined, value => progress.push(value)).catch(e => e);
    await vi.advanceTimersByTimeAsync(PROBE_LIMITS.required);
    expect((await result).message).toContain('检测超时');
    expect(progress.at(-1)?.label).toContain(round === 1 ? '1/2' : '2/2');
    expect(rows.at(-1)?.status).toBe('unavailable');
    expect(request).toHaveBeenCalledTimes(round);
  });

  it.each(['524', 'timeout'])('keeps the connection usable after optional strict %s, using local validation', async failure => {
    vi.useFakeTimers();
    let late: ((value: Response) => void) | undefined;
    const rows: Capability[] = [];
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (new Headers(init?.headers).get('x-heiyan-upstream')?.endsWith('/input_tokens')) return new Response(null, { status: 404 });
      if (body.tools?.some((tool: { strict: boolean }) => tool.strict)) {
        if (failure === '524') return new Response(null, { status: 524 });
        return new Promise<Response>(resolve => { late = resolve; });
      }
      return Response.json(complete(!!body.tools));
    });
    const result = probeApi({ ...profile, request }, signal(), row => rows.push(row));
    await vi.advanceTimersByTimeAsync(PROBE_LIMITS.optional);
    const tested = await result;
    expect(tested.model).toBe(profile.model); expect(tested.strict).toBe(false);
    expect(rows.find(row => row.key === 'tools')?.status).toBe('passed');
    expect(rows.find(row => row.key === 'strict')?.detail).toContain('画布本地参数校验');
    expect(rows.find(row => row.key === 'strict')?.detail).toContain(failure === '524' ? '524（上游响应超时）' : '20 秒');
    const snapshot = JSON.stringify(rows);
    late?.(Response.json(complete(true)));
    await vi.advanceTimersByTimeAsync(1);
    expect(tested.strict).toBe(false); expect(JSON.stringify(rows)).toBe(snapshot);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('skips remaining optional probes after the total deadline without discarding passed basics', async () => {
    vi.useFakeTimers();
    const rows: Capability[] = [];
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (request.mock.calls.length > 2) return never<Response>();
      const tools = !!JSON.parse(String(init?.body)).tools;
      return new Promise<Response>(resolve => setTimeout(() => resolve(Response.json(complete(tools))), 35000));
    });
    const result = probeApi({ ...profile, request, stream: true, nativeCompaction: true, helperModel: 'helper', embeddingModel: 'embedding' }, signal(), row => rows.push(row));
    await vi.advanceTimersByTimeAsync(PROBE_LIMITS.total);
    expect(await result).toMatchObject({ strict: false, stream: false, nativeCompaction: false, countTokens: false, helperModel: '', embeddingModel: '' });
    expect(request).toHaveBeenCalledTimes(5);
    expect(rows.find(row => row.key === 'tools')?.status).toBe('passed');
    expect(rows.find(row => row.key === 'stream')?.detail).toContain('2 分钟');
  });

  it('cancels a request adapter that ignores abort and discards its late response', async () => {
    const abort = new AbortController(), started = deferred<void>(), response = deferred<Response>();
    const cancel = vi.fn(), request = vi.fn(() => { started.resolve(); return response.promise; });
    const rows: Capability[] = [];
    const result = probeApi({ ...profile, request }, abort.signal, row => rows.push(row)).catch(e => e);
    await started.promise;
    abort.abort(Error('连接检测已取消'));
    expect((await result).message).toBe('连接检测已取消');
    response.resolve(new Response(new ReadableStream({ cancel })));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledOnce(); expect(rows).toEqual([]); expect(request).toHaveBeenCalledOnce();
  });
});

describe('response lifetime independent of relay connection', () => {
  it.each(['responses', 'chat'] as const)('finishes %s on its terminal event even if close and cancel never settle', async protocol => {
    const events = protocol === 'responses' ? [{ type: 'response.completed', response: complete() }] : [
      { choices: [{ index: 0, delta: { content: '连接成功' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 9, completion_tokens: 2 } }, '[DONE]',
    ];
    const cancel = vi.fn(() => never<void>());
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(events.map(event => 'data: ' + (typeof event === 'string' ? event : JSON.stringify(event)) + '\n\n').join('')));
      // The intermediary intentionally leaves the HTTP connection open.
    }, cancel });
    const response = await readAgentResponse(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), protocol);
    expect(response.text).toBe('连接成功'); expect(response.streamed).toBe(true); expect(cancel).toHaveBeenCalledOnce();
    if (protocol === 'chat') expect(response.usage?.prompt_tokens).toBe(9);
  });

  it('cancels an incomplete SSE body without returning partial tools', async () => {
    const abort = new AbortController(), started = deferred<void>(), cancel = vi.fn();
    const request = vi.fn(async () => { started.resolve(); return new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } }); });
    const result = apiStep({ ...profile, request }, [], abort.signal).catch(e => e);
    await started.promise; await new Promise(resolve => setTimeout(resolve, 0));
    abort.abort(Error('取消读取'));
    expect((await result).message).toBe('取消读取'); expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels an incomplete JSON body without waiting for EOF', async () => {
    const abort = new AbortController(), started = deferred<void>();
    const request = vi.fn(async () => { started.resolve(); return new Response(new ReadableStream(), { headers: { 'content-type': 'application/json' } }); });
    const result = apiStep({ ...profile, request }, [], abort.signal).catch(e => e);
    await started.promise; await new Promise(resolve => setTimeout(resolve, 0));
    abort.abort(Error('取消读取'));
    expect((await result).message).toBe('取消读取');
  });
});
