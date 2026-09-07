import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  comfyUiHistoryOutput,
  comfyUiLocalBaseUrl,
  comfyUiViewUrl,
  inspectComfyUiMiniMaxH3Queue,
} from './comfyui-minimax-h3.js';

const requiredNodes = Object.freeze([
  'LoadVideo',
  'GetVideoComponents',
  'ComfyNumberConvert',
  'TopazStarlight',
  'CreateVideo',
  'SaveVideo',
]);

function abortError() {
  const error = new Error('任务已取消');
  error.name = 'AbortError';
  return error;
}

function sleep(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function responseJson(response, label) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}${payload?.error ? ` · ${payload.error}` : ''}`);
  return payload;
}

function historyError(entry) {
  const messages = Array.isArray(entry?.status?.messages) ? entry.status.messages : [];
  const failure = messages.find((message) => Array.isArray(message) && ['execution_error', 'execution_interrupted'].includes(message[0]));
  if (!failure) return '';
  const detail = failure[1] || {};
  return String(detail.exception_message || detail.message || failure[0]);
}

export function comfyUiTopazStarlightHistoryOutput(entry, {
  baseUrl = 'http://127.0.0.1:8188',
  promptId = '',
  model = '星光 2.6',
  vram = 22,
  scale = 2,
  strength = 1,
  inputQuality = 14,
  sharpness = '锐利（默认）',
} = {}) {
  const file = comfyUiHistoryOutput(entry);
  if (!file) return null;
  return {
    mediaType: 'video',
    mediaUrl: comfyUiViewUrl(baseUrl, file),
    fileName: file.filename,
    metadata: {
      remote: false,
      local: true,
      provider: 'comfyui',
      promptId: String(promptId || ''),
      upscaleModel: model === '星光 2.6' ? 'Topaz 星光 2.6' : `Topaz ${model}`,
      scale: Number(scale) || 2,
      vramGiB: Number(vram) || 22,
      strength: Number(strength) || 1,
      inputQuality: Number(inputQuality) || 14,
      sharpness: String(sharpness || '锐利（默认）'),
      nativeAudio: true,
    },
  };
}

export function buildComfyUiTopazStarlightPrompt({
  video,
  model = '星光 2.6',
  vram = 22,
  scale = 2,
  strength = 1,
  inputQuality = 14,
  sharpness = '锐利（默认）',
  filenamePrefix = 'video/AI_Canvas_Topaz_Starlight',
} = {}) {
  if (!String(video || '').trim()) throw new Error('Topaz 星光需要一个本地视频输入');
  return {
    '1': { class_type: 'LoadVideo', inputs: { file: String(video) } },
    '2': { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
    '3': { class_type: 'ComfyNumberConvert', inputs: { value: ['2', 2] } },
    '4': {
      class_type: 'TopazStarlight',
      inputs: {
        '图像': ['2', 0],
        '模型': model,
        '显存上限': Math.max(8, Math.min(24, Number(vram) || 22)),
        '放大倍数': Math.max(1, Math.min(4, Number(scale) || 2)),
        '帧率': ['3', 1],
        '增强强度': Math.max(0.7, Math.min(1.3, Number(strength) || 1)),
        '输入质量': Math.max(0, Math.min(40, Math.round(Number(inputQuality) || 14))),
        '锐度档位': sharpness,
      },
    },
    '5': {
      class_type: 'CreateVideo',
      inputs: { images: ['4', 0], fps: ['2', 2], audio: ['2', 1], bit_depth: ['2', 3] },
    },
    '6': {
      class_type: 'SaveVideo',
      inputs: {
        video: ['5', 0],
        filename_prefix: filenamePrefix,
        format: 'mp4',
        codec: 'h264',
        'codec.encoding': 're-encode',
        'codec.encoding.crf': 18,
      },
    },
  };
}

export async function inspectComfyUiTopazStarlight(config = {}, fetchImpl = fetch) {
  const baseUrl = comfyUiLocalBaseUrl(config.baseUrl);
  let stats;
  try { stats = await fetchImpl(`${baseUrl}/system_stats`); }
  catch { return { available: false, baseUrl, error: 'ComfyUI 未启动或本地端口不可访问' }; }
  if (!stats.ok) return { available: false, baseUrl, error: `ComfyUI 状态检查失败：HTTP ${stats.status}` };
  for (const nodeName of requiredNodes) {
    try {
      const response = await fetchImpl(`${baseUrl}/object_info/${encodeURIComponent(nodeName)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.[nodeName]) return { available: false, baseUrl, error: `当前 ComfyUI 缺少 ${nodeName} 节点` };
      if (nodeName === 'TopazStarlight') {
        const models = payload.TopazStarlight?.input?.required?.['模型']?.[0];
        if (!Array.isArray(models) || !models.includes('星光 2.6')) return { available: false, baseUrl, error: 'Topaz 节点未提供星光 2.6 模型' };
      }
    } catch {
      return { available: false, baseUrl, error: `无法核对 ComfyUI ${nodeName} 节点` };
    }
  }
  return { available: true, baseUrl, error: '' };
}

async function uploadVideo(fetchImpl, baseUrl, reference, signal) {
  const extension = /\.(mp4|webm|mov)$/i.exec(reference.fileName || '')?.[0] || '.mp4';
  const fileName = `ai-canvas-topaz-${crypto.randomUUID()}${extension.toLowerCase()}`;
  const form = new FormData();
  form.append('image', new Blob([reference.buffer], { type: reference.mimeType || 'video/mp4' }), fileName);
  form.append('type', 'input');
  form.append('overwrite', 'false');
  const response = await fetchImpl(`${baseUrl}/upload/image`, { method: 'POST', body: form, signal });
  const payload = await responseJson(response, 'ComfyUI 视频上传失败');
  return String(payload.name || fileName);
}

async function cleanupUploadedVideo(inputDirectory, name) {
  if (!inputDirectory || !path.isAbsolute(String(inputDirectory))) return;
  const root = path.resolve(String(inputDirectory));
  const safeName = path.basename(String(name || ''));
  if (!safeName.startsWith('ai-canvas-topaz-')) return;
  const target = path.resolve(root, safeName);
  if (path.dirname(target) !== root) return;
  try { await fs.promises.unlink(target); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function cancelPrompt(fetchImpl, baseUrl, promptId) {
  try {
    const queue = await fetchImpl(`${baseUrl}/queue`).then((response) => response.json());
    const running = Array.isArray(queue?.queue_running) && queue.queue_running.some((item) => Array.isArray(item) && item[1] === promptId);
    await fetchImpl(`${baseUrl}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) });
    if (running) await fetchImpl(`${baseUrl}/interrupt`, { method: 'POST' });
  } catch { /* 本地取消是尽力而为。 */ }
}

export function createComfyUiTopazStarlightAdapter(model, fetchImpl = fetch) {
  const config = model.config || {};
  const baseUrl = comfyUiLocalBaseUrl(config.baseUrl);
  const pollInterval = Math.max(500, Number(config.pollIntervalMs) || 3000);
  return { kind: 'video', configured: true, async run(job) {
    const sources = (job.referenceMedia || []).filter((reference) => reference.type === 'video');
    if (sources.length !== 1) throw new Error('高清放大需要且只能使用一个当前画布中的视频');
    const readiness = await inspectComfyUiTopazStarlight(config, fetchImpl);
    if (!readiness.available) throw new Error(readiness.error);
    const uploadedName = await uploadVideo(fetchImpl, baseUrl, sources[0], job.signal);
    let promptId = '';
    try {
      const topazModel = String(job.options?.topazModel || '星光 2.6');
      const topazVram = Number(job.options?.topazVram ?? 22);
      const topazScale = Number(job.options?.topazScale ?? 2);
      const topazStrength = Number(job.options?.topazStrength ?? 1);
      const topazInputQuality = Number(job.options?.topazInputQuality ?? 14);
      const topazSharpness = String(job.options?.topazSharpness || '锐利（默认）');
      const graph = buildComfyUiTopazStarlightPrompt({
        video: uploadedName,
        model: topazModel,
        vram: topazVram,
        scale: topazScale,
        strength: topazStrength,
        inputQuality: topazInputQuality,
        sharpness: topazSharpness,
      });
      const response = await fetchImpl(`${baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: graph, client_id: `ai-canvas-topaz-${crypto.randomUUID()}` }),
        signal: job.signal,
      });
      const submitted = await responseJson(response, 'ComfyUI Topaz 提交失败');
      promptId = String(submitted.prompt_id || '');
      if (!promptId) throw new Error('ComfyUI Topaz 未返回任务 ID');
      await job.onRemoteTask?.(promptId);
      await job.onProgress?.(12);
      let attempts = 0;
      while (true) {
        await sleep(pollInterval, job.signal);
        const queueState = await inspectComfyUiMiniMaxH3Queue(config, fetchImpl, promptId);
        if (queueState.available) await job.onQueueState?.(queueState);
        const history = await fetchImpl(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { signal: job.signal });
        const payload = await responseJson(history, 'ComfyUI Topaz 状态查询失败');
        const entry = payload[promptId] || (payload.prompt_id === promptId ? payload : null);
        const failure = historyError(entry);
        if (failure) throw new Error(`ComfyUI Topaz 处理失败：${failure}`);
        const output = comfyUiTopazStarlightHistoryOutput(entry, {
          baseUrl,
          promptId,
          model: topazModel,
          vram: topazVram,
          scale: topazScale,
          strength: topazStrength,
          inputQuality: topazInputQuality,
          sharpness: topazSharpness,
        });
        if (output) {
          return {
            outputs: [output],
            usage: { local: true, gpuSeconds: null },
          };
        }
        attempts += 1;
        await job.onProgress?.(Math.min(94, 14 + Math.floor(Math.log2(attempts + 1) * 9)));
      }
    } catch (error) {
      if (job.signal?.aborted || error?.name === 'AbortError') {
        if (promptId) await cancelPrompt(fetchImpl, baseUrl, promptId);
        throw abortError();
      }
      throw error;
    } finally {
      await cleanupUploadedVideo(config.inputDirectory, uploadedName).catch(() => {});
    }
  } };
}
