export const MANAGED_COMFY_ROUTES = Object.freeze({
  status: '/api/v1/admin/comfyui/managed/status',
  connect: '/api/v1/admin/comfyui/managed/connect',
  verify: '/api/v1/admin/comfyui/managed/verify',
  disconnect: '/api/v1/admin/comfyui/managed/connection',
});

export const POLL_INTERVAL_MS = 500;
export const POLL_MAX_ATTEMPTS = 12;

export type ManagedComfyStateName = 'not-installed' | 'installed' | 'starting' | 'connected' | 'repair-required';
export type ManagedComfyClientErrorCode = 'protocol_error' | 'invalid_response' | 'network_error' | 'aborted' | 'poll_timeout' | 'managed_action_conflict';

export type ManagedComfyBundle = { id: string; version: string; digest: string };
export type ManagedComfyPublicState = {
  state: ManagedComfyStateName;
  capabilityCount: number;
  reasonCode: string | null;
  bundle?: ManagedComfyBundle;
};
export type ManagedComfyClientResult = { status: number; data: ManagedComfyPublicState };
export type ManagedComfyRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Pick<Response, 'status' | 'json'>>;

export class ManagedComfyClientError extends Error {
  readonly code: ManagedComfyClientErrorCode;

  constructor(code: ManagedComfyClientErrorCode) {
    super(code);
    this.name = 'ManagedComfyClientError';
    this.code = code;
  }
}

const states = new Set<ManagedComfyStateName>(['not-installed', 'installed', 'starting', 'connected', 'repair-required']);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const reasonPattern = /^managed_[a-z0-9_]{1,127}$/;

function closedKeys(record: Record<string, unknown>, required: string[], optional: string[] = []) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(record, key)) && Object.keys(record).every((key) => allowed.has(key));
}

function parseBundle(value: unknown): ManagedComfyBundle | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ManagedComfyClientError('protocol_error');
  const record = value as Record<string, unknown>;
  if (!closedKeys(record, ['id', 'version', 'digest']) || typeof record.id !== 'string' || !identifierPattern.test(record.id)
    || typeof record.version !== 'string' || !identifierPattern.test(record.version)
    || typeof record.digest !== 'string' || !digestPattern.test(record.digest)) throw new ManagedComfyClientError('protocol_error');
  return { id: record.id, version: record.version, digest: record.digest };
}

export function parseManagedComfyPublicState(value: unknown): ManagedComfyPublicState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ManagedComfyClientError('protocol_error');
  const record = value as Record<string, unknown>;
  if (!closedKeys(record, ['state', 'capabilityCount', 'reasonCode'], ['bundle'])
    || typeof record.state !== 'string' || !states.has(record.state as ManagedComfyStateName)
    || !Number.isSafeInteger(record.capabilityCount) || (record.capabilityCount as number) < 0
    || (record.state !== 'connected' && record.capabilityCount !== 0)
    || !(record.reasonCode === null || (typeof record.reasonCode === 'string' && reasonPattern.test(record.reasonCode)))) {
    throw new ManagedComfyClientError('protocol_error');
  }
  const bundle = parseBundle(record.bundle);
  return {
    state: record.state as ManagedComfyStateName,
    capabilityCount: record.capabilityCount as number,
    reasonCode: record.reasonCode as string | null,
    ...(bundle ? { bundle } : {}),
  };
}

type Endpoint = 'status' | 'connect' | 'verify' | 'disconnect';

function validEndpointResponse(endpoint: Endpoint, status: number, data: ManagedComfyPublicState) {
  const hasReason = data.reasonCode !== null;
  if (endpoint === 'status') return status === 200 && hasReason === (data.state === 'repair-required');
  if (endpoint === 'connect') {
    if (status === 200) return data.state === 'connected' && !hasReason;
    if (status === 202) return data.state === 'starting' && !hasReason;
    if (status === 409) return (data.state === 'not-installed' && !hasReason)
      || ((data.state === 'installed' || data.state === 'repair-required') && hasReason);
    return false;
  }
  if (endpoint === 'verify') {
    if (status === 200) return (data.state === 'installed' || data.state === 'starting' || data.state === 'connected') && !hasReason;
    return status === 409 && data.state === 'repair-required' && hasReason;
  }
  if (status === 200) return (data.state === 'not-installed' || data.state === 'installed') && !hasReason;
  return status === 409 && hasReason;
}

async function readResult(endpoint: Endpoint, response: Pick<Response, 'status' | 'json'>): Promise<ManagedComfyClientResult> {
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new ManagedComfyClientError('invalid_response'); }
  const data = parseManagedComfyPublicState(payload);
  if (!validEndpointResponse(endpoint, response.status, data)) throw new ManagedComfyClientError('protocol_error');
  return { status: response.status, data };
}

function asClientError(reason: unknown, signal: AbortSignal): ManagedComfyClientError {
  if (reason instanceof ManagedComfyClientError) return reason;
  if (signal.aborted || (reason instanceof Error && reason.name === 'AbortError')) return new ManagedComfyClientError('aborted');
  return new ManagedComfyClientError('network_error');
}

export function createManagedComfyClient(request: ManagedComfyRequest = fetch) {
  const invoke = async (endpoint: Endpoint, signal: AbortSignal): Promise<ManagedComfyClientResult> => {
    const init: RequestInit = endpoint === 'status'
      ? { method: 'GET', body: undefined, signal }
      : endpoint === 'connect'
        ? { method: 'POST', body: undefined, signal }
        : endpoint === 'verify'
          ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"scope":"quick"}', signal }
          : { method: 'DELETE', body: undefined, signal };
    try { return await readResult(endpoint, await request(MANAGED_COMFY_ROUTES[endpoint], init)); }
    catch (reason) { throw asClientError(reason, signal); }
  };
  return {
    status: (signal: AbortSignal) => invoke('status', signal),
    connect: (signal: AbortSignal) => invoke('connect', signal),
    verifyQuick: (signal: AbortSignal) => invoke('verify', signal),
    disconnect: (signal: AbortSignal) => invoke('disconnect', signal),
  };
}

export type ManagedComfyClient = ReturnType<typeof createManagedComfyClient>;
export type ManagedComfyControllerSnapshot = {
  state: ManagedComfyPublicState;
  lastSettledRealState: ManagedComfyPublicState;
  pending: boolean;
  polling: boolean;
  preview: boolean;
  errorCode: ManagedComfyClientErrorCode | null;
  success: boolean;
};

export type ManagedComfyClock = {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
};

const initialState = (): ManagedComfyPublicState => ({ state: 'not-installed', capabilityCount: 0, reasonCode: null });
const defaultClock: ManagedComfyClock = {
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type ManagedComfyController = ReturnType<typeof createManagedComfyController>;

export function createManagedComfyController({
  client,
  clock = defaultClock,
  onResourcesChanged = async () => undefined,
  autoLoad = true,
}: {
  client: ManagedComfyClient;
  clock?: ManagedComfyClock;
  onResourcesChanged?: () => Promise<void> | void;
  autoLoad?: boolean;
}) {
  let snapshot: ManagedComfyControllerSnapshot = {
    state: initialState(), lastSettledRealState: initialState(), pending: autoLoad, polling: false, preview: false, errorCode: null, success: false,
  };
  let generation = 0;
  let disposed = false;
  let active: AbortController | null = null;
  let timer: unknown = null;
  const listeners = new Set<() => void>();

  const publish = () => { if (!disposed) listeners.forEach((listener) => listener()); };
  const update = (next: Partial<ManagedComfyControllerSnapshot>) => { snapshot = { ...snapshot, ...next }; publish(); };
  const clearTimer = () => { if (timer !== null) { clock.clearTimeout(timer); timer = null; } };
  const abortActive = () => { active?.abort(); active = null; };
  const nextGeneration = () => { generation += 1; clearTimer(); abortActive(); return generation; };
  const current = (token: number) => !disposed && token === generation;
  const visible = (state: ManagedComfyPublicState) => state.state === 'connected';

  const settle = async (token: number, next: ManagedComfyPublicState, notifyResources: boolean) => {
    if (!current(token)) return false;
    const previous = snapshot.lastSettledRealState;
    snapshot = { ...snapshot, state: next, lastSettledRealState: next, errorCode: null };
    publish();
    if (notifyResources && visible(previous) !== visible(next)) {
      await onResourcesChanged();
      if (!current(token)) return false;
    }
    return current(token);
  };

  const fail = (token: number, reason: unknown) => {
    if (!current(token)) return;
    const error = reason instanceof ManagedComfyClientError ? reason : new ManagedComfyClientError('network_error');
    if (error.code === 'aborted') return;
    update({ pending: false, polling: false, errorCode: error.code, success: false });
  };

  const schedulePoll = (token: number, attempt: number, notifyResources: boolean) => {
    if (!current(token)) return;
    if (attempt >= POLL_MAX_ATTEMPTS) {
      update({ pending: false, polling: false, errorCode: 'poll_timeout', success: false });
      return;
    }
    timer = clock.setTimeout(() => {
      timer = null;
      void pollOnce(token, attempt + 1, notifyResources);
    }, POLL_INTERVAL_MS);
  };

  const pollOnce = async (token: number, attempt: number, notifyResources: boolean) => {
    if (!current(token)) return;
    active = new AbortController();
    try {
      const result = await client.status(active.signal);
      if (!current(token)) return;
      active = null;
      if (!(await settle(token, result.data, notifyResources))) return;
      if (result.data.state === 'starting') schedulePoll(token, attempt, notifyResources);
      else update({ pending: false, polling: false, success: true });
    } catch (reason) { active = null; fail(token, reason); }
  };

  const run = async (kind: 'status' | 'connect' | 'verify' | 'disconnect', notifyResources: boolean) => {
    if (disposed || snapshot.pending || snapshot.preview) return;
    const token = nextGeneration();
    active = new AbortController();
    update({ pending: true, polling: false, errorCode: null, success: false });
    try {
      const result = kind === 'status' ? await client.status(active.signal)
        : kind === 'connect' ? await client.connect(active.signal)
          : kind === 'verify' ? await client.verifyQuick(active.signal)
            : await client.disconnect(active.signal);
      if (!current(token)) return;
      active = null;
      if (result.status === 409) {
        snapshot = { ...snapshot, state: result.data, lastSettledRealState: result.data };
        update({ pending: false, polling: false, errorCode: result.data.state === 'repair-required' ? null : 'managed_action_conflict', success: false });
        return;
      }
      if (!(await settle(token, result.data, notifyResources))) return;
      if (result.data.state === 'starting') {
        update({ pending: true, polling: true });
        schedulePoll(token, 0, notifyResources);
      } else update({ pending: false, polling: false, success: true });
    } catch (reason) { active = null; fail(token, reason); }
  };

  const initialLoad = async () => {
    const token = nextGeneration();
    active = new AbortController();
    try {
      const result = await client.status(active.signal);
      if (!current(token)) return;
      active = null;
      if (!(await settle(token, result.data, false))) return;
      if (result.data.state === 'starting') {
        update({ pending: true, polling: true });
        schedulePoll(token, 0, false);
      } else update({ pending: false, polling: false });
    } catch (reason) { active = null; fail(token, reason); }
  };

  const previewStates: ManagedComfyPublicState[] = [
    initialState(),
    { state: 'installed', capabilityCount: 0, reasonCode: null },
    { state: 'starting', capabilityCount: 0, reasonCode: null },
    { state: 'connected', capabilityCount: 2, reasonCode: null, bundle: { id: 'heiyan-private', version: '1.0.0', digest: '0'.repeat(64) } },
  ];

  const controller = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    recheck: () => run('status', false),
    connect: () => run('connect', true),
    verifyQuick: () => run('verify', true),
    disconnect: () => run('disconnect', true),
    enterPreview() {
      if (disposed || snapshot.errorCode || !['not-installed', 'installed'].includes(snapshot.lastSettledRealState.state)) return;
      nextGeneration();
      update({ state: previewStates[0], preview: true, pending: false, polling: false, success: false });
    },
    advancePreview() {
      if (!snapshot.preview || disposed) return;
      const index = previewStates.findIndex((entry) => entry.state === snapshot.state.state);
      update({ state: previewStates[Math.min(index + 1, previewStates.length - 1)] });
    },
    exitPreview() {
      if (!snapshot.preview || disposed) return;
      nextGeneration();
      update({ state: snapshot.lastSettledRealState, preview: false, pending: false, polling: false, errorCode: null, success: false });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      clearTimer();
      abortActive();
      listeners.clear();
    },
  };
  if (autoLoad) void initialLoad();
  return controller;
}
