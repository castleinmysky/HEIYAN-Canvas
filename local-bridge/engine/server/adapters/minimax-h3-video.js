async function providerFetch(...args) {
  try { return await fetch(...args); }
  catch (error) { if (error?.name === 'AbortError') throw abortError(); throw new Error('Model service request failed'); }
}
function abortError() { const error = new Error('Task cancelled'); error.name = 'AbortError'; return error; }

function normalizeUrl(baseUrl, endpoint) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const path = String(endpoint || '').trim();
  if (!base || !path) throw new Error('MiniMax API address is not configured');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function sleep(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

async function cancelRemoteTask(taskUrl, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try { await providerFetch(taskUrl, { method: 'DELETE', headers, redirect: 'error', signal: controller.signal }); }
  catch { /* Cancellation is best-effort. */ }
  finally { clearTimeout(timer); }
}

function mediaUrlInput(type, value, role) {
  const url = String(value || '');
  if (!/^(https:\/\/|data:)/i.test(url)) return null;
  return { type: `${type}_url`, [`${type}_url`]: { url }, role };
}

function imageReferenceContent(reference, role = 'reference_image') {
  if (!reference?.buffer || !reference?.mimeType) return null;
  return { type: 'image_url', image_url: { url: `data:${reference.mimeType};base64,${reference.buffer.toString('base64')}` }, role };
}

function ratioForMiniMax(ratio, content) {
  const hasFrame = content.some((item) => item.role === 'first_frame' || item.role === 'last_frame');
  const hasReference = content.some((item) => String(item.role || '').startsWith('reference_'));
  if (hasFrame) return 'adaptive';
  if (ratio === 'Auto' || !ratio) return hasReference ? 'adaptive' : '9:16';
  return ratio;
}

export function minimaxH3RequestBody({ model, prompt, inputs = [], referenceImages = [], options = {}, callbackUrl }) {
  if (!prompt) throw new Error('MiniMax-H3 requires a prompt');
  const content = [{ type: 'text', text: prompt }];
  const explicitFrame = (port, role) => {
    const input = inputs.find((item) => item.type === 'image' && item.port === port);
    const item = input && mediaUrlInput('image', input.value, role);
    if (item) content.push(item);
    const embedded = item ? null : referenceImages.find((item) => item.port === port);
    const embeddedItem = embedded && imageReferenceContent(embedded, role);
    if (embeddedItem) content.push(embeddedItem);
  };
  explicitFrame('first_frame', 'first_frame');
  explicitFrame('last_frame', 'last_frame');
  const embeddedReferences = referenceImages.filter((item) => item.port !== 'first_frame' && item.port !== 'last_frame');
  embeddedReferences.slice(0, 9).forEach((reference) => { const item = imageReferenceContent(reference); if (item) content.push(item); });
  if (!embeddedReferences.length) inputs.filter((input) => input.type === 'image' && input.port === 'reference').slice(0, 9).forEach((input) => { const item = mediaUrlInput('image', input.value, 'reference_image'); if (item) content.push(item); });
  inputs.filter((input) => input.type === 'video' && input.port === 'reference').slice(0, 3).forEach((input) => { const item = mediaUrlInput('video', input.value, 'reference_video'); if (item) content.push(item); });
  inputs.filter((input) => input.type === 'audio' && input.port === 'reference').slice(0, 3).forEach((input) => { const item = mediaUrlInput('audio', input.value, 'reference_audio'); if (item) content.push(item); });
  return { model, content, resolution: options.resolution || '2K', duration: options.duration, ratio: ratioForMiniMax(options.ratio, content), aigc_watermark: false, ...(callbackUrl ? { callback_url: callbackUrl } : {}) };
}

export function createMiniMaxH3VideoAdapter(model) {
  const config = model.config || {};
  const apiKey = String(config.apiKey || '').trim();
  const createUrl = normalizeUrl(config.baseUrl, config.endpoint || '/v2/video_generation');
  const queryBaseUrl = normalizeUrl(config.baseUrl, config.queryEndpoint || '/v2/query/video_generation');
  const pollInterval = Math.max(3000, Number(config.pollIntervalMs) || 5000);
  const pollTimeoutMs = Math.max(60000, Math.min(86400000, Number(config.pollTimeoutMs) || 2700000));
  if (!apiKey) throw new Error(`Model ${model.id} has no API key configured`);
  return { kind: 'video', configured: true, async run(job) {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    const body = minimaxH3RequestBody({ model: config.model || 'MiniMax-H3', prompt: job.prompt, inputs: job.inputs, referenceImages: job.referenceImages, options: job.options, callbackUrl: job.callbackUrl });
    const actualVideoInputCount = body.content.filter((item) => item.role === 'reference_video').length;
    const inputVideoDuration = actualVideoInputCount ? Math.min(15, job.inputs.filter((input) => input.type === 'video' && input.port === 'reference').reduce((sum, input) => sum + (Number(input.duration) || 0), 0)) : 0;
    await job.onProgress?.(12);
    const createResponse = await providerFetch(createUrl, { method: 'POST', headers, redirect: 'error', body: JSON.stringify(body), signal: job.signal });
    const createPayload = await createResponse.json().catch(() => ({}));
    const taskId = createPayload.task_id;
    if (!createResponse.ok || !taskId) throw new Error(`MiniMax task creation failed: HTTP ${createResponse.status}`);
    const taskUrl = `${queryBaseUrl}/${encodeURIComponent(taskId)}`;
    const pollingDeadline = Date.now() + pollTimeoutMs;
    job.onRemoteTask?.(taskId);
    let attempts = 0;
    while (true) {
      if (job.signal?.aborted) { await cancelRemoteTask(`${createUrl}/${encodeURIComponent(taskId)}`, headers); throw abortError(); }
      if (Date.now() >= pollingDeadline) throw new Error('MiniMax-H3 polling timed out');
      await sleep(Math.min(pollInterval, Math.max(1, pollingDeadline - Date.now())), job.signal);
      const response = await providerFetch(taskUrl, { headers, redirect: 'error', signal: job.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`MiniMax task query failed: HTTP ${response.status}`);
      const task = payload.task || payload;
      if (task.status === 'succeeded') {
        const mediaUrl = task.content?.url;
        if (!mediaUrl) throw new Error('MiniMax-H3 did not return a video URL');
        return { outputs: [{ mediaType: 'video', mediaUrl, fileName: `${taskId}.mp4`, metadata: { remote: true, minimaxTaskId: taskId, duration: task.duration, ratio: task.ratio, resolution: task.resolution } }], usage: task.usage && typeof task.usage === 'object' ? task.usage : undefined, actualVideoInputCount, inputVideoDuration };
      }
      if (['failed', 'cancelled'].includes(task.status)) throw new Error(`MiniMax-H3 task ${task.status}`);
      attempts += 1;
      await job.onProgress?.(Math.min(92, 18 + Math.floor(Math.log2(attempts + 1) * 13)));
    }
  } };
}
