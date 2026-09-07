async function providerFetch(...args) {
  try { return await fetch(...args); }
  catch (error) { if (error?.name === 'AbortError') throw abortError(); throw new Error('Model service request failed'); }
}
function abortError() {
  const error = new Error('任务已取消');
  error.name = 'AbortError';
  return error;
}

function normalizeUrl(baseUrl, endpoint) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const path = String(endpoint || '').trim();
  if (!base || !path) throw new Error('Seedance API 地址未配置');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function ratioForArk(ratio) {
  return ratio === 'Auto' || !ratio ? 'adaptive' : ratio;
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

async function cancelRemoteTask(taskUrl, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try { await providerFetch(taskUrl, { method: 'DELETE', headers, redirect: 'error', signal: controller.signal }); }
  catch { /* Remote cancellation is best-effort after a local abort. */ }
  finally { clearTimeout(timer); }
}

function mediaUrlInput(type, value, role) {
  if (!/^https:\/\//i.test(String(value || ''))) return null;
  return { type: `${type}_url`, [`${type}_url`]: { url: value }, role };
}

function imageReferenceContent(reference, role = 'reference_image') {
  if (!reference?.buffer || !reference?.mimeType) return null;
  return {
    type: 'image_url',
    image_url: { url: `data:${reference.mimeType};base64,${reference.buffer.toString('base64')}` },
    role,
  };
}

function imageInputContent(input, role) {
  const item = mediaUrlInput('image', input.value, role);
  return item;
}

function supportsServiceTier(model) {
  return !/^doubao-seedance-2-(?:0|5)(?:-|$)/i.test(String(model || ''));
}

export function isSeedance25Model(model) {
  return /^doubao-seedance-2-5(?:-|$)/i.test(String(model || '').trim());
}

export function seedanceRequestBody({ model, prompt, inputs = [], referenceImages = [], options = {}, callbackUrl }) {
  const content = [];
  const seedance25 = isSeedance25Model(model);
  if (prompt) content.push({ type: 'text', text: prompt });

  const explicitFrame = (port, role) => {
    const input = inputs.find((item) => item.type === 'image' && item.port === port);
    const item = input && imageInputContent(input, role);
    if (item) content.push(item);
  };
  explicitFrame('first_frame', 'first_frame');
  explicitFrame('last_frame', 'last_frame');

  const explicitReferenceFrame = (port, role) => {
    const reference = referenceImages.find((item) => item.port === port);
    const item = reference && imageReferenceContent(reference, role);
    if (item) content.push(item);
  };
  explicitReferenceFrame('first_frame', 'first_frame');
  explicitReferenceFrame('last_frame', 'last_frame');

  const imageLimit = seedance25 ? 30 : 9;
  const videoLimit = seedance25 ? 10 : 1;
  const audioLimit = seedance25 ? 10 : 3;
  let remainingImageSlots = imageLimit;
  referenceImages
    .filter((reference) => reference.port !== 'first_frame' && reference.port !== 'last_frame')
    .slice(0, remainingImageSlots)
    .forEach((reference) => {
      const item = imageReferenceContent(reference);
      if (item) { content.push(item); remainingImageSlots -= 1; }
    });
  if (remainingImageSlots > 0) {
    inputs
      .filter((input) => input.type === 'image' && input.port !== 'first_frame' && input.port !== 'last_frame')
      .slice(0, remainingImageSlots)
      .forEach((input) => {
        const item = imageInputContent(input, 'reference_image');
        if (item) content.push(item);
      });
  }
  inputs.filter((input) => input.type === 'video' && input.port !== 'first_frame' && input.port !== 'last_frame').slice(0, videoLimit).forEach((input) => {
    const item = mediaUrlInput('video', input.value, 'reference_video');
    if (item) content.push(item);
  });
  inputs.filter((input) => input.type === 'audio' && input.port !== 'first_frame' && input.port !== 'last_frame').slice(0, audioLimit).forEach((input) => {
    const item = mediaUrlInput('audio', input.value, 'reference_audio');
    if (item) content.push(item);
  });
  if (!content.length) throw new Error('Seedance 需要提示词或可公开访问的参考素材');
  if (seedance25) {
    // Seedance 2.5 has its own Ark contract. Keep this allowlist deliberately
    // narrow so legacy 2.0-only controls never leak into a paid 2.5 request.
    const resolution = String(options.resolution || '').toLowerCase();
    if (resolution && !['480p', '720p'].includes(resolution)) throw new Error('Seedance 2.5 resolution must be 480P or 720P');
    const outputFormat = String(options.outputFormat || '').toLowerCase();
    if (outputFormat && !['mp4', 'mov'].includes(outputFormat)) throw new Error('Seedance 2.5 output format must be mp4 or mov');
    const hasFrameRole = content.some((item) => item.role === 'first_frame' || item.role === 'last_frame');
    return {
      model,
      content,
      generate_audio: Boolean(options.audioEnabled),
      ratio: hasFrameRole ? 'adaptive' : ratioForArk(options.ratio),
      duration: options.duration,
      ...(resolution ? { resolution } : {}),
      ...(outputFormat ? { output_format: outputFormat } : {}),
      watermark: false,
    };
  }
  return {
    model,
    content,
    generate_audio: Boolean(options.audioEnabled),
    ratio: ratioForArk(options.ratio),
    duration: options.duration,
    resolution: String(options.resolution || '720P').toLowerCase(),
    seed: options.seed ?? -1,
    camera_fixed: Boolean(options.cameraFixed),
    return_last_frame: Boolean(options.returnLastFrame),
    priority: options.priority ?? 0,
    ...(supportsServiceTier(model) ? { service_tier: options.serviceTier === 'flex' ? 'flex' : 'default' } : {}),
    execution_expires_after: options.executionExpiresAfter ?? 172800,
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    ...(options.webSearch ? { tools: [{ type: 'web_search' }] } : {}),
    watermark: false,
  };
}

export function createSeedanceVideoAdapter(model) {
  const config = model.config || {};
  const apiKey = String(config.apiKey || '').trim();
  const createUrl = normalizeUrl(config.baseUrl, config.endpoint || '/contents/generations/tasks');
  const pollInterval = Math.max(3000, Number(config.pollIntervalMs) || 5000);
  const pollTimeoutMs = Math.max(60000, Math.min(86400000, Number(config.pollTimeoutMs) || 2700000));
  if (!apiKey) throw new Error(`模型 ${model.id} 未配置 API 密钥`);

  return {
    kind: 'video',
    configured: true,
    async run(job) {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      const body = seedanceRequestBody({ model: config.model || model.id, prompt: job.prompt, inputs: job.inputs, referenceImages: job.referenceImages, options: job.options, callbackUrl: job.callbackUrl });
      const actualVideoReferences = body.content.filter((item) => item.role === 'reference_video');
      const actualVideoInputCount = actualVideoReferences.length;
      const seedance25 = isSeedance25Model(config.model || model.id);
      const inputVideoDuration = actualVideoInputCount
        ? Math.min(seedance25 ? 30 : 15, Math.max(0, ...job.inputs.filter((input) => input.type === 'video' && /^https:\/\//i.test(String(input.value || ''))).slice(0, seedance25 ? 10 : 1).map((input) => Number(input.duration) || 0)))
        : 0;
      await job.onProgress?.(12);
      const createResponse = await providerFetch(createUrl, { method: 'POST', headers, redirect: 'error', body: JSON.stringify(body), signal: job.signal });
      const createPayload = await createResponse.json().catch(() => ({}));
      if (!createResponse.ok || !createPayload.id) throw new Error(`Seedance 任务创建失败：HTTP ${createResponse.status}`);
      const taskUrl = `${createUrl}/${encodeURIComponent(createPayload.id)}`;
      const pollingDeadline = Date.now() + pollTimeoutMs;
      job.onRemoteTask?.(createPayload.id);
      let attempts = 0;
      while (true) {
        if (job.signal?.aborted) {
          await cancelRemoteTask(taskUrl, headers);
          throw abortError();
        }
        if (Date.now() >= pollingDeadline) throw new Error('Seedance 生成等待超时，请稍后刷新任务状态');
        try {
          if (job.waitForCallback) await job.waitForCallback(Math.min(pollInterval, Math.max(1, pollingDeadline - Date.now())));
          else await sleep(Math.min(pollInterval, Math.max(1, pollingDeadline - Date.now())), job.signal);
        } catch (error) {
          if (error?.name === 'AbortError') await cancelRemoteTask(taskUrl, headers);
          throw error;
        }
        const response = await providerFetch(taskUrl, { headers, redirect: 'error', signal: job.signal });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`Seedance 任务查询失败：HTTP ${response.status}`);
        if (payload.status === 'succeeded') {
          const mediaUrl = payload.content?.video_url;
          if (!mediaUrl) throw new Error('Seedance 未返回视频地址');
          return {
            outputs: [{
              mediaType: 'video',
              mediaUrl,
              fileName: `${createPayload.id}.${body.output_format === 'mov' ? 'mov' : 'mp4'}`,
              metadata: {
                remote: true,
                seedanceTaskId: createPayload.id,
                duration: payload.duration,
                ratio: payload.ratio,
                resolution: payload.resolution,
                generateAudio: payload.generate_audio,
                completionTokens: Number(payload.usage?.completion_tokens) || undefined,
              },
            }],
            usage: payload.usage && typeof payload.usage === 'object' ? {
              completionTokens: Number(payload.usage.completion_tokens) || undefined,
            } : undefined,
            actualVideoInputCount,
            inputVideoDuration,
          };
        }
        if (['failed', 'cancelled', 'expired'].includes(payload.status)) throw new Error(`Seedance 任务${payload.status}`);
        attempts += 1;
        await job.onProgress?.(Math.min(92, 18 + Math.floor(Math.log2(attempts + 1) * 13)));
      }
    },
  };
}
