import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error JavaScript backend adapters are runtime-tested by Vitest.
import { createTripo3dClient, createTripo3dModelAdapter, Tripo3dSubmissionUnknownError, tripo3dRequest } from '../local-bridge/engine/server/adapters/tripo3d-model.js';

const API = 'https://openapi.tripo3d.com/v3';
const ok = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify({ code: 0, data }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
  ...init,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Tripo3D v3 request families', () => {
  it('builds H v3.1 text-to-model with independent advanced quality options', async () => {
    const request = await tripo3dRequest({
      model: 'v3.1-20260211',
      prompt: 'A low-poly treasure chest',
      options: {
        workflow: 'text-to-model', negativePrompt: 'broken mesh', texture: true, pbr: true,
        textureQuality: 'extreme', geometryQuality: 'standard', autoSize: true,
        modelSeed: 42, imageSeed: 43, textureSeed: 44, faceLimit: 50000,
        compress: 'geometry', exportUv: false, quad: false, smartLowPoly: false, generateParts: false,
      },
    });
    expect(request).toMatchObject({
      endpoint: '/generation/text-to-model', workflow: 'text-to-model',
      body: {
        prompt: 'A low-poly treasure chest', model: 'v3.1-20260211', negative_prompt: 'broken mesh',
        texture: true, pbr: true, texture_quality: 'extreme', geometry_quality: 'standard',
        auto_size: true, model_seed: 42, image_seed: 43, texture_seed: 44,
        face_limit: 50000, compress: 'geometry', export_uv: false,
      },
    });
  });

  it('uploads one private image with presign and builds image-to-model', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ presigned_url: 'https://upload.example/image', file_token: 'file_abc' }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const client = createTripo3dClient({ apiKey: 'server-secret', fetchImpl: fetchMock });
    const request = await tripo3dRequest({
      client,
      model: 'v3.1-20260211',
      referenceImages: [{ buffer: Buffer.from('png'), mimeType: 'image/png', fileName: 'image.png', port: 'input' }],
      options: { workflow: 'image-to-model', enableImageAutofix: true, textureAlignment: 'geometry', orientation: 'align_image' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API}/files/presign`, expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://upload.example/image', {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('png'), signal: undefined,
    });
    expect(JSON.stringify(fetchMock.mock.calls[1])).not.toContain('server-secret');
    expect(request).toMatchObject({
      endpoint: '/generation/image-to-model',
      body: { input: 'file_abc', enable_image_autofix: true, texture_alignment: 'geometry', orientation: 'align_image' },
    });
  });

  it('uploads an archived FBX model with the official large-file flow', async () => {
    const modelBuffer = Buffer.from('fbx-model');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ presigned_url: 'https://upload.example/model', file_token: 'file_model' }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const client = createTripo3dClient({ apiKey: 'server-secret', fetchImpl: fetchMock });
    await expect(client.uploadFile({ buffer: modelBuffer, fileName: 'optimized.fbx', format: 'fbx' })).resolves.toBe('file_model');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ format: 'fbx' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://upload.example/model', {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: modelBuffer, signal: undefined,
    });
  });

  it('reports terminal task status without exposing untrusted upstream error text', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({
      task_id: 'task_failed',
      status: 'failed',
      progress: 95,
      error_code: 2014,
      error_message: 'Unsupported source task type; Bearer server-secret',
    }));
    const client = createTripo3dClient({ apiKey: 'server-secret', fetchImpl: fetchMock });
    const error = await client.pollTask('task_failed', { pollIntervalMs: 1 }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: 'Tripo3D task ended with status failed', code: 'failed' });
    expect(JSON.stringify(error)).not.toContain('server-secret');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('constructs image-to-multiview without leaking model generation options', async () => {
    const client = createTripo3dClient({ apiKey: 'test', fetchImpl: vi.fn() });
    const request = await tripo3dRequest({
      client,
      inputs: [{ type: 'image', port: 'input', value: 'https://example.com/source.png' }],
      options: { workflow: 'image-to-multiview', texture: true, faceLimit: 2000 },
    });
    expect(request).toEqual({
      workflow: 'image-to-multiview', endpoint: '/generation/image-to-multiview',
      body: { input: 'https://example.com/source.png' },
    });
  });

  it('canonicalizes named multiview inputs to front-left-back-right', async () => {
    const client = createTripo3dClient({ apiKey: 'test', fetchImpl: vi.fn() });
    const request = await tripo3dRequest({
      client,
      model: 'v3.1-20260211',
      options: {
        workflow: 'multiview-to-model', texture: false, pbr: false,
        namedViews: {
          right: 'https://example.com/right.png', front: 'https://example.com/front.png',
          back: 'https://example.com/back.png', left: 'https://example.com/left.png',
        },
      },
    });
    expect(request.endpoint).toBe('/generation/multiview-to-model');
    expect(request.body.inputs).toEqual([
      { front: 'https://example.com/front.png' },
      { left: 'https://example.com/left.png' },
      { back: 'https://example.com/back.png' },
      { right: 'https://example.com/right.png' },
    ]);
  });

  it('accepts a successful image-to-multiview task id as the sole multiview source', async () => {
    const client = createTripo3dClient({ apiKey: 'test', fetchImpl: vi.fn() });
    const request = await tripo3dRequest({
      client,
      model: 'P1-20260311',
      options: { workflow: 'multiview-to-model', multiviewTaskId: 'task_views', faceLimit: 3000 },
    });
    expect(request.body).toMatchObject({ model: 'P1-20260311', inputs: [{ task_id: 'task_views' }], face_limit: 3000 });
    expect(request.body).not.toHaveProperty('geometry_quality');
    expect(request.body).not.toHaveProperty('quad');
  });

  it('rejects incomplete, duplicate, and mixed multiview formats before fetch', async () => {
    const fetchMock = vi.fn();
    const client = createTripo3dClient({ apiKey: 'test', fetchImpl: fetchMock });
    await expect(tripo3dRequest({ client, options: { workflow: 'multiview-to-model', namedViews: { front: 'front.png' } } }))
      .rejects.toThrow('front plus at least one other view');
    await expect(tripo3dRequest({
      client,
      inputs: [{ type: 'image', port: 'front', value: 'front-a.png' }],
      options: { workflow: 'multiview-to-model', namedViews: { front: 'front-b.png', left: 'left.png' } },
    })).rejects.toThrow('Duplicate Tripo3D front view');
    await expect(tripo3dRequest({
      client,
      options: {
        workflow: 'multiview-to-model', multiviewTaskId: 'task_views',
        namedViews: { front: 'front.png', left: 'left.png' },
      },
    })).rejects.toThrow('exactly one format');
    await expect(tripo3dRequest({
      client,
      options: {
        workflow: 'multiview-to-model', multiviewInputs: ['front', '', '', ''],
      },
    })).rejects.toThrow('front plus at least one other view');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Tripo3D resilient client contract', () => {
  it('throws for a missing key before fetch can be reached', () => {
    const fetchMock = vi.fn();
    expect(() => createTripo3dClient({ apiKey: '', fetchImpl: fetchMock })).toThrow('API Key');
    expect(() => createTripo3dModelAdapter({ id: 'tripo', config: { apiKey: '' } })).toThrow('API Key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never retries an ambiguous paid creation POST', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('socket reset with Bearer secret'));
    const client = createTripo3dClient({ apiKey: 'secret', fetchImpl: fetchMock, maximumRetries: 10 });
    const error = await client.createTask('/generation/text-to-model', { prompt: 'cat' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Tripo3dSubmissionUnknownError);
    if (!(error instanceof Error)) throw new Error('Expected a submission error');
    expect(JSON.stringify(error)).not.toContain('secret');
    expect(error.message).not.toContain('secret');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('queries up to 100 task states with the official batch endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({
      tasks: {
        task_a: { task_id: 'task_a', status: 'running', progress: 40 },
        task_b: { task_id: 'task_b', status: 'success', progress: 100 },
      },
      missed: ['task_missing'],
    }));
    const client = createTripo3dClient({ apiKey: 'secret', fetchImpl: fetchMock });
    await expect(client.queryTasks(['task_a', 'task_b', 'task_missing', 'task_a']))
      .resolves.toMatchObject({ tasks: { task_a: { progress: 40 }, task_b: { progress: 100 } }, missed: ['task_missing'] });
    expect(fetchMock).toHaveBeenCalledWith(`${API}/tasks/list`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ task_ids: ['task_a', 'task_b', 'task_missing'] }),
    }));
    await expect(client.queryTasks(Array.from({ length: 101 }, (_, index) => `task_${index}`))).rejects.toThrow('at most 100');
  });

  it('falls back to individual task queries when an older gateway has no batch route', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 404, message: 'route not found' }), { status: 404 }))
      .mockResolvedValueOnce(ok({ task_id: 'task_a', status: 'running', progress: 20 }))
      .mockResolvedValueOnce(ok({ task_id: 'task_b', status: 'success', progress: 100 }));
    const client = createTripo3dClient({ apiKey: 'secret', fetchImpl: fetchMock });
    await expect(client.queryTasks(['task_a', 'task_b'])).resolves.toMatchObject({
      tasks: { task_a: { progress: 20 }, task_b: { progress: 100 } }, missed: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps decimal precision in official account usage', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok([
      { task_id: 'task_a', type: 'text_to_model', credits_consumed: 12.75, created_at: '2026-08-11T10:00:00Z' },
    ]));
    const client = createTripo3dClient({ apiKey: 'secret', fetchImpl: fetchMock });
    await expect(client.queryAccountUsage()).resolves.toEqual([
      { task_id: 'task_a', type: 'text_to_model', credits_consumed: 12.75, created_at: '2026-08-11T10:00:00Z' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(`${API}/account/usage`, expect.objectContaining({ method: 'GET' }));
  });

  it('retries network, 429, 500, 502, 503, and 504 query failures with capped backoff and Retry-After', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '0.02' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 504 }))
      .mockResolvedValueOnce(ok({ task_id: 'task_1', status: 'running', progress: 25 }));
    const retryDelays: number[] = [];
    const client = createTripo3dClient({
      apiKey: 'secret', fetchImpl: fetchMock, retryBaseDelayMs: 10, retryMaximumDelayMs: 40, maximumRetries: 6,
      sleepImpl: async (milliseconds: number) => { retryDelays.push(milliseconds); },
    });
    await expect(client.queryTask('task_1', { deadline: Date.now() + 1000 }))
      .resolves.toMatchObject({ task_id: 'task_1', progress: 25 });
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(retryDelays).toEqual([10, 20, 40, 40, 40, 40]);
  });

  it('fails permanent 4xx immediately', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 1001, message: 'bad request; Bearer secret' }), { status: 400 }));
    const client = createTripo3dClient({ apiKey: 'secret', fetchImpl: fetchMock, maximumRetries: 6 });
    const error = await client.queryTask('task_1').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: 'Tripo3D task query failed: HTTP 400', status: 400, code: '1001' });
    expect(JSON.stringify(error)).not.toContain('secret');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('obeys the total deadline and AbortSignal during retry delay', async () => {
    vi.useFakeTimers();
    const timeoutFetch = vi.fn().mockRejectedValue(new Error('offline'));
    const timeoutClient = createTripo3dClient({ apiKey: 'secret', fetchImpl: timeoutFetch, retryBaseDelayMs: 100, maximumRetries: 6 });
    await expect(timeoutClient.queryTask('task_1', { deadline: Date.now() + 50 })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(timeoutFetch).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    const abortFetch = vi.fn().mockRejectedValue(new Error('offline'));
    const abortClient = createTripo3dClient({ apiKey: 'secret', fetchImpl: abortFetch, retryBaseDelayMs: 100, maximumRetries: 6 });
    const pending = abortClient.queryTask('task_2', { signal: controller.signal, deadline: Date.now() + 1000 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('retries transient CDN downloads without sending the API key', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('model-data', { status: 200 }));
    const client = createTripo3dClient({ apiKey: 'do-not-leak', fetchImpl: fetchMock, retryBaseDelayMs: 10, maximumRetries: 1 });
    const responsePromise = client.download('https://cdn.example/model.glb', { deadline: Date.now() + 1000 });
    await vi.runAllTimersAsync();
    const response = await responsePromise;
    expect(await response.text()).toBe('model-data');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) expect(JSON.stringify(call)).not.toContain('do-not-leak');
  });
});

describe('Tripo3D adapter polling and resume', () => {
  it('resumes a persisted task id and exposes remote URLs without buffering large assets', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({
      task_id: 'task_resumed', type: 'text_to_model', status: 'success', progress: 100,
      output: { model_url: 'https://cdn.example/model.glb', rendered_image_url: 'https://cdn.example/preview.png' },
      credits_consumed: 88,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createTripo3dModelAdapter({ id: 'tripo', config: { apiKey: 'secret', model: 'v3.1-20260211' } });
    const result = await adapter.run({
      remoteTaskId: 'task_resumed', operation: 'text-to-model', options: {},
      signal: new AbortController().signal,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${API}/tasks/task_resumed`, expect.objectContaining({ method: 'GET' }));
    expect(result.usage).toEqual({ creditsConsumed: 88 });
    expect(result.outputs[0]).toMatchObject({
      mediaType: 'model', mediaUrl: 'https://cdn.example/model.glb', previewUrl: 'https://cdn.example/preview.png',
      extension: '.glb', metadata: { format: 'glb', rawOutput: { model_url: 'https://cdn.example/model.glb' } },
    });
    expect(result.outputs[0]).not.toHaveProperty('buffer');
  });

  it('marks quad output as FBX and persists the remote task before polling', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ task_id: 'task_quad' }))
      .mockResolvedValueOnce(ok({
        task_id: 'task_quad', type: 'text_to_model', status: 'success', progress: 100,
        output: { model_url: 'https://cdn.example/model.fbx' }, credits_consumed: 120,
      }));
    vi.stubGlobal('fetch', fetchMock);
    const persisted: unknown[] = [];
    const adapter = createTripo3dModelAdapter({ id: 'tripo', config: { apiKey: 'secret', model: 'v3.1-20260211', pollIntervalMs: 1 } });
    const result = await adapter.run({
      prompt: 'quad cat', inputs: [], referenceImages: [], options: { workflow: 'text-to-model', quad: true, texture: true },
      onRemoteTask: (id: string, metadata: unknown) => { persisted.push({ id, metadata }); },
      signal: new AbortController().signal,
    });
    expect(persisted).toHaveLength(1);
    expect(result.outputs[0]).toMatchObject({ extension: '.fbx', fileName: 'task_quad.fbx', metadata: { format: 'fbx' } });
  });

  it('persists submission_unknown and does not retry a paid POST', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection reset'));
    vi.stubGlobal('fetch', fetchMock);
    const states: unknown[] = [];
    const adapter = createTripo3dModelAdapter({ id: 'tripo', config: { apiKey: 'secret', model: 'v3.1-20260211' } });
    await expect(adapter.run({
      prompt: 'cat', inputs: [], referenceImages: [], options: { workflow: 'text-to-model' },
      onSubmissionUnknown: (state: unknown) => { states.push(state); },
    })).rejects.toBeInstanceOf(Tripo3dSubmissionUnknownError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(states).toEqual([expect.objectContaining({ state: 'submission_unknown', phase: 'submission_unknown' })]);
    expect(JSON.stringify(states)).not.toContain('secret');
  });
});

describe('Tripo3D two-stage image-to-multiview-to-model recovery', () => {
  const multiviewSuccess = {
    task_id: 'task_views', type: 'generate_multiview_image', status: 'success', progress: 100,
    output: {
      front_view_url: 'https://cdn.example/front.png', left_view_url: 'https://cdn.example/left.png',
      back_view_url: 'https://cdn.example/back.png', right_view_url: 'https://cdn.example/right.png',
    },
    credits_consumed: 12,
  };
  const modelSuccess = {
    task_id: 'task_model', type: 'multiview_to_model', status: 'success', progress: 100,
    output: { model_url: 'https://cdn.example/model.glb', rendered_image_url: 'https://cdn.example/model.png' },
    credits_consumed: 90,
  };

  it('persists stage one success before the single stage-two POST', async () => {
    let stageOnePersisted = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/generation/image-to-multiview')) return ok({ task_id: 'task_views' });
      if (url.endsWith('/tasks/task_views')) return ok(multiviewSuccess);
      if (url.endsWith('/generation/multiview-to-model')) {
        expect(stageOnePersisted).toBe(true);
        expect(JSON.parse(String(init?.body))).toMatchObject({ inputs: [{ task_id: 'task_views' }] });
        return ok({ task_id: 'task_model' });
      }
      if (url.endsWith('/tasks/task_model')) return ok(modelSuccess);
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createTripo3dModelAdapter({ id: 'tripo', config: { apiKey: 'secret', model: 'v3.1-20260211' } });
    const result = await adapter.run({
      operation: 'image-to-multiview-to-model',
      inputs: [{ type: 'image', port: 'input', value: 'https://example.com/source.png' }],
      referenceImages: [], options: { workflow: 'multiview-to-model' },
      onWorkflowState: (patch: { stages?: { multiview?: { status?: string } } }) => {
        if (patch.stages?.multiview?.status === 'success') stageOnePersisted = true;
      },
    });
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts.map(([url]) => url)).toEqual([
      `${API}/generation/image-to-multiview`, `${API}/generation/multiview-to-model`,
    ]);
    expect(result.usage).toEqual({ creditsConsumed: 102 });
    expect(result.outputs[0]).toMatchObject({ mediaUrl: 'https://cdn.example/model.glb', extension: '.glb' });
  });

  it('resumes a stage-one checkpoint by creating only the missing model stage', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ task_id: 'task_model' }))
      .mockResolvedValueOnce(ok(modelSuccess));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createTripo3dModelAdapter({ id: 'tripo', config: { apiKey: 'secret', model: 'v3.1-20260211' } });
    await adapter.run({
      operation: 'image-to-multiview-to-model', options: {}, inputs: [], referenceImages: [],
      tripoWorkflow: {
        phase: 'stage_complete', currentStage: 'multiview', currentTaskId: 'task_views',
        stages: { multiview: { taskId: 'task_views', status: 'success', creditsConsumed: 12 } },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API}/generation/multiview-to-model`, expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ inputs: [{ task_id: 'task_views' }] });
  });

  it('resumes a known model task with query only and zero duplicate POSTs', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(modelSuccess));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createTripo3dModelAdapter({ id: 'tripo', config: { apiKey: 'secret', model: 'v3.1-20260211' } });
    await adapter.run({
      operation: 'image-to-multiview-to-model', options: {}, inputs: [], referenceImages: [],
      tripoWorkflow: {
        phase: 'polling', currentStage: 'model', currentTaskId: 'task_model',
        stages: {
          multiview: { taskId: 'task_views', status: 'success', creditsConsumed: 12 },
          model: { taskId: 'task_model', status: 'polling' },
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${API}/tasks/task_model`, expect.objectContaining({ method: 'GET' }));
  });

  it('never resubmits stage two after an ambiguous model POST', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('connection reset'));
    vi.stubGlobal('fetch', fetchMock);
    const unknownStates: unknown[] = [];
    const adapter = createTripo3dModelAdapter({ id: 'tripo', config: { apiKey: 'secret', model: 'v3.1-20260211' } });
    await expect(adapter.run({
      operation: 'image-to-multiview-to-model', options: {}, inputs: [], referenceImages: [],
      tripoWorkflow: {
        phase: 'stage_complete', currentStage: 'multiview', currentTaskId: 'task_views',
        stages: { multiview: { taskId: 'task_views', status: 'success' } },
      },
      onSubmissionUnknown: (patch: unknown) => { unknownStates.push(patch); },
    })).rejects.toBeInstanceOf(Tripo3dSubmissionUnknownError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(unknownStates).toEqual([expect.objectContaining({
      phase: 'submission_unknown', currentStage: 'model',
      stages: { model: expect.objectContaining({ status: 'submission_unknown' }) },
    })]);

    const retryFetch = vi.fn();
    vi.stubGlobal('fetch', retryFetch);
    const resumedAdapter = createTripo3dModelAdapter({ id: 'tripo', config: { apiKey: 'secret', model: 'v3.1-20260211' } });
    await expect(resumedAdapter.run({
      operation: 'image-to-multiview-to-model', options: {}, inputs: [], referenceImages: [],
      tripoWorkflow: {
        phase: 'submission_unknown', currentStage: 'model', currentTaskId: 'task_views',
        stages: {
          multiview: { taskId: 'task_views', status: 'success' },
          model: { status: 'submission_unknown' },
        },
      },
    })).rejects.toBeInstanceOf(Tripo3dSubmissionUnknownError);
    expect(retryFetch).not.toHaveBeenCalled();
  });

  it('does not cross the stage boundary when the persisted checkpoint crashes', async () => {
    const firstFetch = vi.fn()
      .mockResolvedValueOnce(ok({ task_id: 'task_views' }))
      .mockResolvedValueOnce(ok(multiviewSuccess));
    vi.stubGlobal('fetch', firstFetch);
    let workflow: Record<string, any> = { phase: 'queued', stages: {} };
    const adapter = createTripo3dModelAdapter({ id: 'tripo', config: { apiKey: 'secret', model: 'v3.1-20260211' } });
    await expect(adapter.run({
      operation: 'image-to-multiview-to-model',
      inputs: [{ type: 'image', port: 'input', value: 'https://example.com/source.png' }],
      referenceImages: [], options: {},
      onWorkflowState: (patch: Record<string, any>) => {
        workflow = { ...workflow, ...patch, stages: { ...workflow.stages, ...(patch.stages || {}) } };
        if (patch.phase === 'stage_complete') throw new Error('simulated crash after durable checkpoint');
      },
    })).rejects.toThrow('simulated crash after durable checkpoint');
    expect(firstFetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(workflow.stages.multiview).toMatchObject({ taskId: 'task_views', status: 'success' });

    const resumedFetch = vi.fn()
      .mockResolvedValueOnce(ok({ task_id: 'task_model' }))
      .mockResolvedValueOnce(ok(modelSuccess));
    vi.stubGlobal('fetch', resumedFetch);
    const resumedAdapter = createTripo3dModelAdapter({ id: 'tripo', config: { apiKey: 'secret', model: 'v3.1-20260211' } });
    await resumedAdapter.run({
      operation: 'image-to-multiview-to-model', inputs: [], referenceImages: [], options: {}, tripoWorkflow: workflow,
    });
    expect(resumedFetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(resumedFetch).toHaveBeenNthCalledWith(1, `${API}/generation/multiview-to-model`, expect.objectContaining({ method: 'POST' }));
  });

  it('maps a single-stage job operation to image-to-multiview', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ task_id: 'task_views' }))
      .mockResolvedValueOnce(ok(multiviewSuccess));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createTripo3dModelAdapter({ id: 'tripo', config: { apiKey: 'secret', model: 'v3.1-20260211' } });
    const result = await adapter.run({
      operation: 'image-to-multiview', options: {},
      inputs: [{ type: 'image', port: 'input', value: 'https://example.com/source.png' }], referenceImages: [],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API}/generation/image-to-multiview`, expect.objectContaining({ method: 'POST' }));
    expect(result.outputs).toHaveLength(4);
    expect(result.outputs[0]).toMatchObject({ mediaType: 'image', metadata: { view: 'front' } });
  });
});
