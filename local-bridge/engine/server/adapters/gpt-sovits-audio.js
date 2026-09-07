import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let voiceQueue = Promise.resolve();

function abortError() {
  const error = new Error('任务已取消');
  error.name = 'AbortError';
  return error;
}

function localBaseUrl(value) {
  const url = new URL(String(value || 'http://127.0.0.1:9880'));
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('GPT-SoVITS 仅允许连接本机服务');
  }
  return url.toString().replace(/\/$/, '');
}

async function responseError(response, fallback) {
  const contentType = String(response.headers.get('content-type') || '');
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}));
    return String(payload.error || payload.message || payload.detail || fallback);
  }
  return String(await response.text().catch(() => '') || fallback).slice(0, 500);
}

async function switchWeight(baseUrl, endpoint, weightsPath, signal) {
  const value = String(weightsPath || '').trim();
  if (!value) return;
  const url = new URL(endpoint, `${baseUrl}/`);
  url.searchParams.set('weights_path', value);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(await responseError(response, `GPT-SoVITS 模型切换失败（HTTP ${response.status}）`));
}

function queued(task) {
  const run = voiceQueue.then(task, task);
  voiceQueue = run.catch(() => undefined);
  return run;
}

export function createGptSovitsAudioAdapter(model) {
  const config = model.config || {};
  const baseUrl = localBaseUrl(config.baseUrl);
  const endpoint = String(config.endpoint || '/tts').trim() || '/tts';
  if (!endpoint.startsWith('/')) throw new Error('GPT-SoVITS 生成路径必须以 / 开头');

  return {
    kind: 'audio',
    configured: true,
    async run(job) {
      return queued(async () => {
        if (job.signal?.aborted) throw abortError();
        if (!String(job.prompt || '').trim()) throw new Error('请输入需要朗读的文字');
        await job.onProgress?.(8);

        const reference = (job.referenceMedia || []).find((item) => item.type === 'audio');
        const tempRoot = reference ? await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-canvas-gpt-sovits-')) : '';
        const referenceFile = reference ? path.join(tempRoot, path.basename(reference.fileName || 'reference.wav')) : String(config.referenceAudioPath || '').trim();
        try {
          if (reference) await fs.promises.writeFile(referenceFile, reference.buffer, { flag: 'wx' });
          if (!referenceFile) throw new Error('当前声音缺少参考音频，请连接一段参考音频或在模型配置中设置');

          await switchWeight(baseUrl, '/set_gpt_weights', config.gptWeights, job.signal);
          await switchWeight(baseUrl, '/set_sovits_weights', config.sovitsWeights, job.signal);
          await job.onProgress?.(24);

          const textLanguage = String(job.options?.audioLanguage || config.defaultLanguage || 'zh').trim();
          const referenceLanguage = String(config.referenceLanguage || textLanguage).trim();
          const referenceText = String(job.options?.audioReferenceText || config.referenceText || '').trim();
          if (!referenceText) throw new Error('参考音频需要对应台词，才能稳定保留声音');
          const speed = Number(job.options?.audioSpeed ?? 1);
          const payload = {
            text: String(job.prompt).trim(),
            text_lang: textLanguage,
            ref_audio_path: referenceFile,
            prompt_text: referenceText,
            prompt_lang: referenceLanguage,
            text_split_method: 'cut5',
            batch_size: 1,
            speed_factor: Math.max(0.5, Math.min(2, Number.isFinite(speed) ? speed : 1)),
            media_type: 'wav',
            streaming_mode: false,
          };
          const response = await fetch(new URL(endpoint, `${baseUrl}/`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: job.signal,
          });
          if (!response.ok) throw new Error(await responseError(response, `GPT-SoVITS 生成失败（HTTP ${response.status}）`));
          const contentType = String(response.headers.get('content-type') || '').toLowerCase();
          if (!contentType.includes('audio') && !contentType.includes('octet-stream')) throw new Error('GPT-SoVITS 未返回音频');
          const buffer = Buffer.from(await response.arrayBuffer());
          if (!buffer.length) throw new Error('GPT-SoVITS 返回了空音频');
          await job.onProgress?.(92);
          return [{
            mediaType: 'audio',
            buffer,
            extension: '.wav',
            fileName: `${model.id || 'gpt-sovits'}-${Date.now()}.wav`,
            metadata: { local: true, provider: 'gpt-sovits', language: textLanguage, speed: payload.speed_factor },
          }];
        } finally {
          if (tempRoot) await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
        }
      });
    },
  };
}
