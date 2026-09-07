function abortError() {
  const error = new Error('任务已取消');
  error.name = 'AbortError';
  return error;
}

function interpolate(value, context) {
  if (typeof value === 'string') return value.replace(/\{\{([\w.]+)\}\}/g, (_match, path) => path.split('.').reduce((current, key) => current?.[key], context) ?? '');
  if (Array.isArray(value)) return value.map((item) => interpolate(item, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, context)]));
  return value;
}

function findPath(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

function mediaTypeFromUrl(url, fallback) {
  if (/\.(mp4|webm|mov)(?:\?|$)/i.test(url)) return 'video';
  if (/\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(url)) return 'image';
  return fallback;
}

export function createHttpAdapter(model) {
  const config = model.http;
  if (!config?.url) throw new Error(`模型 ${model.id} 缺少 http.url`);
  return {
    kind: model.capability,
    configured: true,
    async run(job) {
      if (job.signal?.aborted) throw abortError();
      await job.onProgress?.(15);
      const context = {
        prompt: job.prompt,
        inputs: job.inputs,
        options: job.options,
        ratio: job.ratio,
        resolution: job.resolution,
        count: job.count,
        duration: job.duration,
        audioEnabled: job.audioEnabled,
      };
      const headers = { 'Content-Type': 'application/json', ...interpolate(config.headers || {}, { ...context, env: process.env }) };
      const body = interpolate(config.body || { prompt: '{{prompt}}', inputs: '{{inputs}}', options: '{{options}}' }, context);
      const response = await fetch(config.url, { method: config.method || 'POST', headers, body: JSON.stringify(body), signal: job.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(findPath(payload, config.errorPath) || payload.error || `HTTP ${response.status}`);
      await job.onProgress?.(80);
      const rawOutputs = findPath(payload, config.outputsPath || 'outputs') || findPath(payload, config.outputPath || 'data.url');
      const list = Array.isArray(rawOutputs) ? rawOutputs : [rawOutputs];
      const outputs = list.filter(Boolean).map((item, index) => {
        const url = typeof item === 'string' ? item : item.url || item.mediaUrl;
        if (!url) throw new Error(`模型 ${model.id} 第 ${index + 1} 个输出缺少 URL`);
        return { mediaType: typeof item === 'object' && item.mediaType ? item.mediaType : mediaTypeFromUrl(url, model.capability), mediaUrl: url, fileName: typeof item === 'object' ? item.fileName : null, metadata: { remote: true } };
      });
      if (!outputs.length) throw new Error(`模型 ${model.id} 未返回输出`);
      return outputs;
    },
  };
}
