import { describe, expect, it, vi } from 'vitest';
import {
  MANAGED_COMFY_ROUTES,
  POLL_INTERVAL_MS,
  POLL_MAX_ATTEMPTS,
  ManagedComfyClientError,
  createManagedComfyClient,
  createManagedComfyController,
  parseManagedComfyPublicState,
  type ManagedComfyClock,
  type ManagedComfyPublicState,
} from './managed-comfy-connection';

const state = (name: ManagedComfyPublicState['state'], reasonCode: string | null = name === 'repair-required' ? 'managed_repair_required' : null): ManagedComfyPublicState => ({
  state: name, capabilityCount: name === 'connected' ? 2 : 0, reasonCode,
  ...(name === 'connected' ? { bundle: { id: 'private-bundle', version: '1.0.0', digest: 'a'.repeat(64) } } : {}),
});
const response = (status: number, payload: unknown) => ({ status, json: async () => payload });
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };

class FakeClock implements ManagedComfyClock {
  tasks: Array<{ callback: () => void; milliseconds: number }> = [];
  setTimeout(callback: () => void, milliseconds: number) { const task = { callback, milliseconds }; this.tasks.push(task); return task; }
  clearTimeout(handle: unknown) { this.tasks = this.tasks.filter((task) => task !== handle); }
  runNext() { this.tasks.shift()?.callback(); }
}

describe('managed ComfyUI closed client', () => {
  it('uses only the four exact routes, methods, bodies and quick verification scope', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const payloads = [state('installed'), state('connected'), state('installed'), state('installed')];
    const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => { calls.push([url, init]); return response(200, payloads.shift()); });
    const client = createManagedComfyClient(request);
    const signal = new AbortController().signal;
    await client.status(signal); await client.connect(signal); await client.verifyQuick(signal); await client.disconnect(signal);
    expect(calls.map(([url]) => url)).toEqual(Object.values(MANAGED_COMFY_ROUTES));
    expect(calls.map(([, init]) => [init?.method, init?.body])).toEqual([['GET', undefined], ['POST', undefined], ['POST', '{"scope":"quick"}'], ['DELETE', undefined]]);
    expect(calls[2][1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(calls.every(([, init]) => init?.signal === signal)).toBe(true);
  });

  it('accepts only the exact endpoint-specific status/state/reason matrix', async () => {
    const valid = [
      ['status', 200, state('not-installed')], ['status', 200, state('repair-required')],
      ['connect', 200, state('connected')], ['connect', 202, state('starting')], ['connect', 409, state('not-installed')],
      ['connect', 409, state('installed', 'managed_busy')], ['connect', 409, state('repair-required')],
      ['verifyQuick', 200, state('installed')], ['verifyQuick', 200, state('starting')], ['verifyQuick', 200, state('connected')], ['verifyQuick', 409, state('repair-required')],
      ['disconnect', 200, state('not-installed')], ['disconnect', 200, state('installed')], ['disconnect', 409, state('connected', 'managed_busy')],
    ] as const;
    for (const [method, status, payload] of valid) {
      const client = createManagedComfyClient(async () => response(status, payload));
      await expect(client[method](new AbortController().signal)).resolves.toMatchObject({ status, data: payload });
    }
    const invalid = [
      ['status', 200, state('installed', 'managed_busy')], ['status', 409, state('repair-required')],
      ['connect', 200, state('starting')], ['connect', 202, state('connected')], ['connect', 409, state('connected', 'managed_busy')],
      ['verifyQuick', 200, state('not-installed')], ['verifyQuick', 409, state('installed', 'managed_busy')],
      ['disconnect', 200, state('connected')], ['disconnect', 409, state('connected')],
    ] as const;
    for (const [method, status, payload] of invalid) {
      const client = createManagedComfyClient(async () => response(status, payload));
      await expect(client[method](new AbortController().signal)).rejects.toMatchObject({ code: 'protocol_error' });
    }
  });

  it('rejects extra fields, bounds, invalid bundle data and raw non-state responses', async () => {
    expect(() => parseManagedComfyPublicState({ ...state('installed'), endpoint: 'D:\\private' })).toThrowError(ManagedComfyClientError);
    expect(() => parseManagedComfyPublicState({ ...state('installed'), capabilityCount: 1 })).toThrowError(ManagedComfyClientError);
    expect(() => parseManagedComfyPublicState({ ...state('connected'), capabilityCount: Number.MAX_SAFE_INTEGER + 1 })).toThrowError(ManagedComfyClientError);
    expect(() => parseManagedComfyPublicState({ ...state('connected'), bundle: { id: '../x', version: '1', digest: 'A'.repeat(64) } })).toThrowError(ManagedComfyClientError);
    expect(() => parseManagedComfyPublicState({ ...state('repair-required'), reasonCode: 'D:\\secret' })).toThrowError(ManagedComfyClientError);
    const raw = createManagedComfyClient(async () => response(500, { error: 'D:\\private\\secret' }));
    await expect(raw.status(new AbortController().signal)).rejects.toMatchObject({ code: 'protocol_error', message: 'protocol_error' });
    const invalidJson = createManagedComfyClient(async () => ({ status: 200, json: async () => { throw new Error('raw'); } }));
    await expect(invalidJson.status(new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_response', message: 'invalid_response' });
  });
});

describe('managed ComfyUI controller', () => {
  it('initially performs only status and keeps mutation actions single-flight', async () => {
    let resolveInitial!: (value: ReturnType<typeof response>) => void;
    const initial = new Promise<ReturnType<typeof response>>((resolve) => { resolveInitial = resolve; });
    const request = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => initial);
    const controller = createManagedComfyController({ client: createManagedComfyClient(request) });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(MANAGED_COMFY_ROUTES.status);
    resolveInitial(response(200, state('installed'))); await flush();
    let resolveConnect!: (value: ReturnType<typeof response>) => void;
    request.mockImplementationOnce(() => new Promise((resolve) => { resolveConnect = resolve; }));
    void controller.connect(); void controller.connect();
    expect(request).toHaveBeenCalledTimes(2);
    resolveConnect(response(200, state('connected'))); await flush();
    expect(controller.getSnapshot().state.state).toBe('connected');
    controller.dispose();
  });

  it('polls serially with exact bounds and exposes poll_timeout', async () => {
    const clock = new FakeClock();
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => response(init?.method === 'POST' ? 202 : 200, state('starting')));
    const controller = createManagedComfyController({ client: createManagedComfyClient(request), clock, autoLoad: false });
    void controller.connect(); await flush();
    expect(clock.tasks).toHaveLength(1);
    expect(clock.tasks[0].milliseconds).toBe(POLL_INTERVAL_MS);
    for (let index = 0; index < POLL_MAX_ATTEMPTS; index += 1) { clock.runNext(); await flush(); expect(clock.tasks.length).toBe(index === POLL_MAX_ATTEMPTS - 1 ? 0 : 1); }
    expect(request).toHaveBeenCalledTimes(1 + POLL_MAX_ATTEMPTS);
    expect(controller.getSnapshot()).toMatchObject({ pending: false, polling: false, errorCode: 'poll_timeout' });
  });

  it('rejects late ignored-abort results after dispose and never publishes resources', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    const request = vi.fn(() => new Promise<ReturnType<typeof response>>((done) => { resolve = done; }));
    const resources = vi.fn();
    const controller = createManagedComfyController({ client: createManagedComfyClient(request), onResourcesChanged: resources });
    const listener = vi.fn(); controller.subscribe(listener);
    controller.dispose();
    resolve(response(200, state('connected'))); await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(resources).not.toHaveBeenCalled();
  });

  it('aborts and generation-rejects a late request when preview creates a newer generation', async () => {
    let resolveLate!: (value: ReturnType<typeof response>) => void;
    let lateSignal: AbortSignal | undefined;
    const queue = [response(200, state('installed'))];
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (queue.length) return queue.shift()!;
      lateSignal = init?.signal ?? undefined;
      return await new Promise<ReturnType<typeof response>>((resolve) => { resolveLate = resolve; });
    });
    const resources = vi.fn();
    const controller = createManagedComfyController({ client: createManagedComfyClient(request), onResourcesChanged: resources });
    await flush(); void controller.recheck(); await flush();
    controller.enterPreview();
    expect(lateSignal?.aborted).toBe(true);
    resolveLate(response(200, state('connected'))); await flush();
    expect(controller.getSnapshot()).toMatchObject({ preview: true, state: { state: 'not-installed' } });
    expect(resources).not.toHaveBeenCalled();
  });

  it('notifies only capability visibility changes and maps non-repair conflicts', async () => {
    const queue = [response(200, state('installed')), response(200, state('connected')), response(409, state('installed', 'managed_busy'))];
    const resources = vi.fn();
    const controller = createManagedComfyController({ client: createManagedComfyClient(async () => queue.shift()!), onResourcesChanged: resources });
    await flush(); void controller.connect(); await flush();
    expect(resources).toHaveBeenCalledTimes(1);
    void controller.disconnect(); await flush();
    expect(controller.getSnapshot().errorCode).toBe('managed_action_conflict');
    expect(resources).toHaveBeenCalledTimes(1);
  });

  it('runs preview locally and restores the last real state without requests or callbacks', async () => {
    const request = vi.fn(async () => response(200, state('installed')));
    const resources = vi.fn();
    const controller = createManagedComfyController({ client: createManagedComfyClient(request), onResourcesChanged: resources });
    await flush();
    controller.enterPreview(); controller.advancePreview(); controller.advancePreview(); controller.advancePreview();
    expect(controller.getSnapshot()).toMatchObject({ preview: true, state: { state: 'connected' } });
    controller.exitPreview();
    expect(controller.getSnapshot()).toMatchObject({ preview: false, state: { state: 'installed' } });
    expect(request).toHaveBeenCalledTimes(1);
    expect(resources).not.toHaveBeenCalled();
  });
});
