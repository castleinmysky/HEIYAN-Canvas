const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

export class Tripo3dApiError extends Error {
  constructor(message, { status = 0, code = '', retryable = false } = {}) {
    super(message);
    this.name = 'Tripo3dApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export class Tripo3dSubmissionUnknownError extends Error {
  constructor(message) {
    // Never attach the raw fetch error: custom fetch implementations can put
    // request headers (including Authorization) on the error object.
    super(message);
    this.name = 'Tripo3dSubmissionUnknownError';
    this.code = 'submission_unknown';
    this.submissionUnknown = true;
  }
}

function abortError() {
  const error = new Error('Tripo3D request aborted');
  error.name = 'AbortError';
  return error;
}

function deadlineError() {
  const error = new Error('Tripo3D request deadline exceeded');
  error.name = 'TimeoutError';
  error.code = 'deadline_exceeded';
  return error;
}

function normalizeUrl(baseUrl, endpoint) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const path = String(endpoint || '').trim();
  if (!base || !path) throw new Error('Tripo3D API URL is not configured');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function sleep(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

function messageFromPayload(_payload, fallback) { return fallback; }

function retryAfterMilliseconds(response, now = Date.now()) {
  const value = String(response?.headers?.get?.('retry-after') || '').trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}

async function parseApiResponse(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  const apiCode = payload?.code;
  if (!response.ok || (apiCode !== undefined && Number(apiCode) !== 0)) {
    const retryable = TRANSIENT_HTTP_STATUSES.has(response.status);
    throw new Tripo3dApiError(messageFromPayload(payload, `${fallback}: HTTP ${response.status}`), {
      status: response.status,
      code: /^\d{1,12}$/.test(String(apiCode ?? '')) ? String(apiCode) : '',
      retryable,
    });
  }
  return payload?.data || {};
}

async function fetchWithRetry(fetchImpl, url, init, {
  signal,
  deadline,
  baseDelayMs,
  maximumDelayMs,
  maximumRetries,
  sleepImpl,
}) {
  let retry = 0;
  while (true) {
    if (signal?.aborted) throw abortError();
    if (Date.now() >= deadline) throw deadlineError();
    let response;
    let networkError;
    try {
      response = await fetchImpl(url, { ...init, redirect: init.redirect || 'error', signal });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw abortError();
      networkError = error;
    }
    if (response && !TRANSIENT_HTTP_STATUSES.has(response.status)) return response;
    if (retry >= maximumRetries) {
      if (networkError) throw new Tripo3dApiError('Tripo3D network request failed', { retryable: true });
      return response;
    }
    const exponentialDelay = Math.min(maximumDelayMs, baseDelayMs * (2 ** retry));
    const requestedDelay = response ? retryAfterMilliseconds(response) : undefined;
    const delay = Math.min(maximumDelayMs, requestedDelay ?? exponentialDelay);
    if (Date.now() + delay >= deadline) throw deadlineError();
    retry += 1;
    await sleepImpl(delay, signal);
  }
}

export function createTripo3dClient({
  baseUrl = 'https://openapi.tripo3d.com/v3',
  apiKey,
  fetchImpl = globalThis.fetch,
  retryBaseDelayMs = 500,
  retryMaximumDelayMs = 8000,
  maximumRetries = 6,
  sleepImpl = sleep,
} = {}) {
  const secret = String(apiKey || '').trim();
  if (!secret) throw new Error('Tripo3D API Key is not configured');
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is not available');
  const originalFetch = fetchImpl;
  fetchImpl = async (...args) => {
    try { return await originalFetch(...args); }
    catch (error) { if (error?.name === 'AbortError') throw abortError(); throw new Error('Tripo3D network request failed'); }
  };
  const apiBaseUrl = String(baseUrl || '').replace(/\/$/, '');
  const jsonHeaders = Object.freeze({ 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` });
  const authHeaders = Object.freeze({ Authorization: `Bearer ${secret}` });

  async function createTask(endpoint, body, { signal } = {}) {
    let response;
    try {
      response = await fetchImpl(normalizeUrl(apiBaseUrl, endpoint), {
        method: 'POST', redirect: 'error',
        headers: jsonHeaders,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw abortError();
      throw new Tripo3dSubmissionUnknownError('Tripo3D task submission outcome is unknown; do not retry automatically');
    }
    if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
      throw new Tripo3dSubmissionUnknownError(`Tripo3D task submission returned HTTP ${response.status}; do not retry automatically`);
    }
    const data = await parseApiResponse(response, 'Tripo3D task creation failed');
    const taskId = String(data.task_id || '').trim();
    if (!taskId) throw new Tripo3dSubmissionUnknownError('Tripo3D task response did not contain task_id; do not retry automatically');
    return { ...data, task_id: taskId };
  }

  async function queryTask(taskId, { signal, deadline = Date.now() + 900000 } = {}) {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) throw new Error('Tripo3D task_id is required');
    const response = await fetchWithRetry(
      fetchImpl,
      normalizeUrl(apiBaseUrl, `/tasks/${encodeURIComponent(normalizedTaskId)}`),
      { method: 'GET', headers: authHeaders },
      {
        signal,
        deadline,
        baseDelayMs: Math.max(1, Number(retryBaseDelayMs) || 500),
        maximumDelayMs: Math.max(1, Number(retryMaximumDelayMs) || 8000),
        maximumRetries: Math.max(0, Number(maximumRetries) || 0),
        sleepImpl,
      },
    );
    return parseApiResponse(response, 'Tripo3D task query failed');
  }

  async function queryTasks(taskIds, { signal, deadline = Date.now() + 900000 } = {}) {
    const normalizedTaskIds = [...new Set((Array.isArray(taskIds) ? taskIds : [])
      .map((taskId) => String(taskId || '').trim()).filter(Boolean))];
    if (!normalizedTaskIds.length) return { tasks: {}, missed: [] };
    if (normalizedTaskIds.length > 100) throw new Error('Tripo3D batch task query supports at most 100 task IDs');
    let data;
    try {
      const response = await fetchWithRetry(
        fetchImpl,
        normalizeUrl(apiBaseUrl, '/tasks/list'),
        { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ task_ids: normalizedTaskIds }) },
        {
          signal,
          deadline,
          baseDelayMs: Math.max(1, Number(retryBaseDelayMs) || 500),
          maximumDelayMs: Math.max(1, Number(retryMaximumDelayMs) || 8000),
          maximumRetries: Math.max(0, Number(maximumRetries) || 0),
          sleepImpl,
        },
      );
      data = await parseApiResponse(response, 'Tripo3D batch task query failed');
    } catch (error) {
      if (!(error instanceof Tripo3dApiError) || ![404, 405, 501].includes(error.status)) throw error;
      const settled = await Promise.allSettled(normalizedTaskIds.map((taskId) => queryTask(taskId, { signal, deadline })));
      const tasks = {};
      const missed = [];
      settled.forEach((result, index) => {
        const taskId = normalizedTaskIds[index];
        if (result.status === 'fulfilled') tasks[taskId] = result.value;
        else missed.push(taskId);
      });
      return { tasks, missed };
    }
    const tasks = data?.tasks && typeof data.tasks === 'object' && !Array.isArray(data.tasks) ? data.tasks : {};
    const missed = Array.isArray(data?.missed) ? data.missed.map((taskId) => String(taskId || '').trim()).filter(Boolean) : [];
    return { tasks, missed };
  }

  async function queryAccountUsage({ signal, deadline = Date.now() + 60000 } = {}) {
    const response = await fetchWithRetry(
      fetchImpl,
      normalizeUrl(apiBaseUrl, '/account/usage'),
      { method: 'GET', headers: authHeaders },
      {
        signal,
        deadline,
        baseDelayMs: Math.max(1, Number(retryBaseDelayMs) || 500),
        maximumDelayMs: Math.max(1, Number(retryMaximumDelayMs) || 8000),
        maximumRetries: Math.max(0, Number(maximumRetries) || 0),
        sleepImpl,
      },
    );
    const data = await parseApiResponse(response, 'Tripo3D account usage query failed');
    return (Array.isArray(data) ? data : []).map((entry) => ({
      task_id: String(entry?.task_id || '').trim(),
      type: String(entry?.type || '').trim(),
      credits_consumed: Math.max(0, Number(entry?.credits_consumed) || 0),
      created_at: String(entry?.created_at || '').trim(),
    })).filter((entry) => entry.task_id);
  }

  async function pollTask(taskId, {
    signal,
    timeoutMs = 900000,
    pollIntervalMs = 2000,
    onProgress,
  } = {}) {
    const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 900000);
    while (true) {
      const task = await queryTask(taskId, { signal, deadline });
      await onProgress?.(Math.max(0, Math.min(100, Number(task.progress) || 0)), task);
      if (task.status === 'success') return task;
      if (['failed', 'cancelled', 'banned', 'expired', 'unknown'].includes(task.status)) {
        throw new Tripo3dApiError(messageFromPayload(task, `Tripo3D task ended with status ${task.status}`), {
          code: String(task.status || ''),
        });
      }
      const delay = Math.max(1, Number(pollIntervalMs) || 2000);
      if (Date.now() + delay >= deadline) throw deadlineError();
      await sleepImpl(delay, signal);
    }
  }

  async function uploadFile(reference, { signal } = {}) {
    const buffer = reference?.buffer;
    if (!buffer?.length) throw new Error('Tripo3D upload file is empty');
    const mimeType = String(reference.mimeType || '').toLowerCase();
    const explicitFormat = String(reference.format || reference.fileName?.match(/\.([a-z0-9]+)$/i)?.[1] || '').trim().toLowerCase();
    const format = explicitFormat || (mimeType === 'image/png' ? 'png'
      : mimeType === 'image/jpeg' ? 'jpg'
        : mimeType === 'image/webp' ? 'webp'
          : '');
    const imageFormats = new Set(['jpeg', 'jpg', 'png', 'webp', 'bmp', 'tiff']);
    const modelFormats = new Set(['glb', 'gltf', 'fbx', 'obj', 'stl', '3mf', 'usdz']);
    if (!imageFormats.has(format) && !modelFormats.has(format)) {
      throw new Error('Tripo3D upload supports common image and 3D model formats only');
    }
    const maximumBytes = imageFormats.has(format) ? 20 * 1024 * 1024 : 150 * 1024 * 1024;
    if (buffer.length > maximumBytes) {
      throw new Error(imageFormats.has(format)
        ? 'Tripo3D reference image cannot exceed 20MB'
        : 'Tripo3D model upload cannot exceed 150MB');
    }
    const presignResponse = await fetchImpl(normalizeUrl(apiBaseUrl, '/files/presign'), {
      method: 'POST', redirect: 'error',
      headers: jsonHeaders,
      body: JSON.stringify({ format }),
      signal,
    });
    const presign = await parseApiResponse(presignResponse, 'Tripo3D file presign failed');
    const uploadUrl = String(presign.presigned_url || '').trim();
    const fileToken = String(presign.file_token || '').trim();
    if (!/^https:\/\//i.test(uploadUrl) || !fileToken) throw new Error('Tripo3D presign response is incomplete');
    const uploadResponse = await fetchImpl(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
      signal,
    });
    if (!uploadResponse.ok) throw new Tripo3dApiError(`Tripo3D file upload failed: HTTP ${uploadResponse.status}`, { status: uploadResponse.status });
    return fileToken;
  }

  async function download(url, { signal, deadline = Date.now() + 900000 } = {}) {
    const normalizedUrl = String(url || '').trim();
    if (!/^https:\/\//i.test(normalizedUrl)) throw new Error('Tripo3D download URL must use HTTPS');
    return fetchWithRetry(
      fetchImpl,
      normalizedUrl,
      { method: 'GET', headers: {}, redirect: 'follow' },
      {
        signal,
        deadline,
        baseDelayMs: Math.max(1, Number(retryBaseDelayMs) || 500),
        maximumDelayMs: Math.max(1, Number(retryMaximumDelayMs) || 8000),
        maximumRetries: Math.max(0, Number(maximumRetries) || 0),
        sleepImpl,
      },
    );
  }

  return Object.freeze({ createTask, queryTask, queryTasks, queryAccountUsage, pollTask, uploadFile, download });
}

export const TRIPO3D_TRANSIENT_HTTP_STATUSES = Object.freeze([...TRANSIENT_HTTP_STATUSES]);
