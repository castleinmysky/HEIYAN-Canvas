import { Buffer } from 'buffer';
import { gptImageSize, isFlexibleGptImage } from '../gpt-image-size.js';
import { normalizeImageQuality } from '../../../shared/image-model-catalog.js';

export function bindImageProviders(fetch) {
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
  if (!base || !path) throw new Error('模型 API 地址未配置');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function outputFormat(config) {
  const format = String(config.outputFormat || 'png').toLowerCase();
  return ['png', 'jpeg', 'webp'].includes(format) ? format : 'png';
}

function extensionFor(format, mimeType = '') {
  if (format === 'jpeg' || /jpeg/i.test(mimeType)) return '.jpg';
  if (format === 'webp' || /webp/i.test(mimeType)) return '.webp';
  return '.png';
}

function sizeForRatio(ratio) {
  return ({ '1:1': '1024x1024', '3:4': '1024x1536', '4:3': '1536x1024', '9:16': '1024x1536', '16:9': '1536x1024' })[ratio] || 'auto';
}

const GPT_IMAGE_4K_MODEL = 'gpt-image-2-4k';
const GPT_IMAGE_4K_SIZE = '3840x2160';
const generatedImageMaxBytes = 100 * 1024 * 1024;

function isGptImage4K(config) {
  return String(config.model || '').trim().toLowerCase() === GPT_IMAGE_4K_MODEL;
}

function apiKey(config) {
  const direct = String(config.apiKey || '').trim();
  if (direct) return direct;
  const envName = String(config.apiKeyEnv || '').trim();
  const value = '';
  if (!value) throw new Error(`模型密钥未配置：${envName || '请设置 apiKeyEnv'}`);
  return value;
}

function extensionFromUrl(value) {
  try {
    const extension = new URL(String(value || '')).pathname.toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[0];
    return extension === '.jpeg' ? '.jpg' : extension || '';
  } catch { return ''; }
}

function extensionFromBuffer(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg';
  if (buffer.length >= 4 && buffer.subarray(1, 4).toString() === 'PNG') return '.png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return '.webp';
  return '';
}

async function downloadGeneratedImage(value, prefix, index, signal) {
  let source;
  try { source = new URL(String(value || '')); }
  catch { throw new Error('图片模型返回了无效下载地址'); }
  if (!['http:', 'https:'].includes(source.protocol)) throw new Error('图片模型返回了不受支持的下载地址');
  const response = await providerFetch(source, { signal, redirect: 'follow' });
  if (!response.ok) throw new Error(`生成图片下载失败：HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > generatedImageMaxBytes) throw new Error('生成图片超过 100MB，未保存');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('生成图片下载为空');
  if (buffer.length > generatedImageMaxBytes) throw new Error('生成图片超过 100MB，未保存');
  const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim();
  const mimeExtension = /^image\/(png|jpe?g|webp)$/i.test(mimeType) ? extensionFor('', mimeType) : '';
  const extension = extensionFromUrl(source) || mimeExtension || extensionFromBuffer(buffer) || '.png';
  return { mediaType: 'image', buffer, extension, fileName: `${prefix}-${index + 1}${extension}`, metadata: { provider: prefix, downloaded: true } };
}

async function imageOutputsFromPayload(items, config, prefix, signal) {
  const format = outputFormat(config);
  const outputs = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    if (item.b64_json) {
      outputs.push({
        mediaType: 'image', buffer: Buffer.from(item.b64_json, 'base64'), extension: extensionFor(format),
        fileName: `${prefix}-${index + 1}.${extensionFor(format).slice(1)}`, metadata: { provider: prefix },
      });
    } else if (item.url) outputs.push(await downloadGeneratedImage(item.url, prefix, index, signal));
  }
  return outputs;
}

function imageDimensions(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return null;
  if (buffer.length >= 24 && buffer.subarray(1, 4).toString() === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    for (let offset = 2; offset + 9 < buffer.length;) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > buffer.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += length + 2;
    }
  }
  return null;
}

function validateGptImage4KOutputs(outputs) {
  for (const output of outputs) {
    const dimensions = imageDimensions(output.buffer, output.extension);
    if (!dimensions || dimensions.width !== 3840 || dimensions.height !== 2160) {
      const actual = dimensions ? `${dimensions.width}x${dimensions.height}` : '未知尺寸';
      throw new Error(`GPT Image 2 4K 返回尺寸不正确：请求 ${GPT_IMAGE_4K_SIZE}，实际 ${actual}。结果未作为 4K 保存。`);
    }
    output.metadata = { ...output.metadata, requestedResolution: '4K', width: dimensions.width, height: dimensions.height };
  }
  return outputs;
}

function mimeExtension(mimeType) {
  if (/jpeg/i.test(mimeType)) return '.jpg';
  if (/webp/i.test(mimeType)) return '.webp';
  return '.png';
}

function uploadPart(image) {
  return new Blob([image.buffer], { type: image.mimeType || 'image/png' });
}

function referenceToken(image, index) {
  const stored = String(image?.referenceToken || '').trim();
  return /^(?:图片|图像|image)\d+$/i.test(stored) ? stored : `图片${index + 1}`;
}

function promptWithImageReferenceMap(prompt, referenceImages = []) {
  return referenceImages.reduce(
    (resolved, image, index) => resolved.replaceAll(`@${referenceToken(image, index)}`, `第${index + 1}张参考图`),
    String(prompt || ''),
  );
}

function geminiReferenceParts(prompt, referenceImages = []) {
  if (!referenceImages.length) return [{ text: String(prompt || '') }];
  return [
    { text: promptWithImageReferenceMap(prompt, referenceImages) },
    ...referenceImages.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.buffer.toString('base64') } })),
  ];
}

function imageConfigForJob(job, model) {
  const imageConfig = {};
  if (job.ratio && job.ratio !== 'Auto') imageConfig.aspectRatio = job.ratio;
  if (job.resolution && !/^gemini-2\.5-flash-image/.test(model)) imageConfig.imageSize = job.resolution === '0.5K' ? '512' : job.resolution;
  return Object.keys(imageConfig).length ? imageConfig : undefined;
}

function openAiEditEndpoint(config) {
  if (config.editEndpoint) return config.editEndpoint;
  const endpoint = String(config.endpoint || '/v1/images/generations');
  return endpoint.endsWith('/generations') ? `${endpoint.slice(0, -'/generations'.length)}/edits` : '/v1/images/edits';
}

function isApiNebulaUrl(value) {
  try {
    const hostname = new URL(String(value || '')).hostname.toLowerCase();
    return hostname === 'apinebula.ai' || hostname.endsWith('.apinebula.ai');
  } catch { return false; }
}

function openAiRequestSpec(config, job, hasReferenceImages) {
  const fourK = isGptImage4K(config);
  const useApiNebulaImageHost = fourK && !config.connectionMode && isApiNebulaUrl(config.baseUrl);
  const baseUrl = useApiNebulaImageHost ? 'https://img-api.apinebula.ai/v1' : (config.baseUrl || 'https://api.openai.com');
  const endpoint = useApiNebulaImageHost
    ? (hasReferenceImages ? '/images/edits' : '/images/generations')
    : (hasReferenceImages ? openAiEditEndpoint(config) : (config.endpoint || '/v1/images/generations'));
  return {
    requestUrl: normalizeUrl(baseUrl, endpoint),
    size: fourK ? GPT_IMAGE_4K_SIZE : isFlexibleGptImage(config.model) ? gptImageSize(job.ratio, job.resolution) : sizeForRatio(job.ratio),
    format: fourK ? 'jpeg' : outputFormat(config),
    quality: fourK ? 'high' : normalizeImageQuality(job.options?.imageQuality),
    fourK,
  };
}

async function collectRequestedImages(job, generateOne) {
  const count = Math.max(1, Math.min(4, Number(job.count) || 1));
  const outputs = [];
  for (let index = 0; index < count; index += 1) {
    if (job.signal?.aborted) throw abortError();
    outputs.push(...await generateOne());
    await job.onProgress?.(12 + Math.round(((index + 1) / count) * 76));
  }
  return outputs;
}

function createOpenAiImageAdapter(model) {
  const config = model.config || {};
  return {
    kind: 'image', configured: true,
    async run(job) {
      if (job.signal?.aborted) throw abortError();
      if (job.ratio === '21:9' && !isFlexibleGptImage(config.model)) throw new Error('This model connection does not support 21:9. No request was submitted.');
      await job.onProgress?.(12);
      const referenceImages = job.referenceImages || [];
      const request = openAiRequestSpec(config, job, referenceImages.length > 0);
      const outputs = await collectRequestedImages(job, async () => {
        const body = referenceImages.length ? (() => {
          const form = new FormData();
          form.set('model', config.model || 'gpt-image-2');
          form.set('prompt', promptWithImageReferenceMap(job.prompt, referenceImages));
          form.set('n', '1');
          form.set('size', request.size);
          form.set('output_format', request.format);
          if (!/^gpt-image-(?:1(?:\.5|-mini)?|2)(?:-\d{4}-\d{2}-\d{2})?$/.test(config.model || 'gpt-image-2')) form.set('response_format', 'b64_json');
          if (request.quality) form.set('quality', request.quality);
          if (request.fourK) form.set('input_fidelity', 'high');
          referenceImages.forEach((image, index) => form.append('image', uploadPart(image), image.fileName || `reference-${index + 1}${mimeExtension(image.mimeType)}`));
          return form;
        })() : JSON.stringify({
          model: config.model || 'gpt-image-2', prompt: job.prompt, n: 1,
          size: request.size, output_format: request.format,
          ...(!/^gpt-image-(?:1(?:\.5|-mini)?|2)(?:-\d{4}-\d{2}-\d{2})?$/.test(config.model || 'gpt-image-2') ? { response_format: 'b64_json' } : {}),
          ...(request.quality ? { quality: request.quality } : {}),
        });
        const response = await providerFetch(request.requestUrl, {
          method: 'POST', signal: job.signal, redirect: 'error',
          headers: referenceImages.length ? { Authorization: `Bearer ${apiKey(config)}` } : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey(config)}` },
          body,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
        const outputConfig = request.fourK ? { ...config, outputFormat: request.format } : config;
        const current = await imageOutputsFromPayload(payload.data || [], outputConfig, 'openai', job.signal);
        if (!current.length) throw new Error('OpenAI 未返回图片数据');
        return request.fourK ? validateGptImage4KOutputs(current) : current;
      });
      await job.onProgress?.(88);
      return outputs;
    },
  };
}

function createGeminiImageAdapter(model) {
  const config = model.config || {};
  return {
    kind: 'image', configured: true,
    async run(job) {
      if (job.signal?.aborted) throw abortError();
      await job.onProgress?.(12);
      const geminiModel = config.model || 'gemini-2.5-flash-image';
      const endpoint = config.endpoint || `/v1beta/models/${geminiModel}:generateContent`;
      const referenceImages = job.referenceImages || [];
      const requestedRatio = job.ratio === 'Auto' ? 'wide landscape' : job.ratio;
      const prompt = `${job.prompt}\n\nComposition requirement: generate the final image in ${requestedRatio} aspect ratio.`;
      const imageConfig = imageConfigForJob(job, geminiModel);
      const outputs = await collectRequestedImages(job, async () => {
        const response = await providerFetch(normalizeUrl(config.baseUrl || 'https://generativelanguage.googleapis.com', endpoint), {
          method: 'POST', signal: job.signal, redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey(config) },
          body: JSON.stringify({
            contents: [{ parts: geminiReferenceParts(prompt, referenceImages) }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(imageConfig ? { imageConfig } : {}) },
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
        const parts = payload.candidates?.flatMap((candidate) => candidate?.content?.parts || []) || [];
        const images = parts.filter((part) => part?.inlineData?.data).map((part) => ({ data: part.inlineData.data, mimeType: part.inlineData.mimeType || '' }));
        if (!images.length) throw new Error('Gemini 未返回图片数据');
        return images.map((image, index) => ({
          mediaType: 'image', buffer: Buffer.from(image.data, 'base64'), extension: extensionFor('', image.mimeType),
          fileName: `gemini-${index + 1}${extensionFor('', image.mimeType)}`, metadata: { provider: 'gemini' },
        }));
      });
      await job.onProgress?.(88);
      return outputs;
    },
  };
}
return { createOpenAiImageAdapter, createGeminiImageAdapter, promptWithImageReferenceMap, geminiReferenceParts };
}
