import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error JavaScript backend image adapters are runtime-tested by Vitest.
import { createGeminiImageAdapter, createOpenAiImageAdapter, GPT_IMAGE_NATIVE_RATIO_ERROR } from '../local-bridge/engine/server/adapters/image-providers.js';

const originalFetch = globalThis.fetch;
const pixel = Buffer.from('unchanged-image-bytes');

function jpegHeader(width: number, height: number) {
  const buffer = Buffer.alloc(21);
  buffer[0] = 0xff; buffer[1] = 0xd8;
  buffer[2] = 0xff; buffer[3] = 0xc0;
  buffer.writeUInt16BE(17, 4);
  buffer[6] = 8;
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  buffer[19] = 0xff; buffer[20] = 0xd9;
  return buffer;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('image provider aspect-ratio contracts', () => {
  it('rejects unsupported legacy GPT Image 21:9 before any paid upstream request', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const adapter = createOpenAiImageAdapter({ config: { apiKey: 'test-key', model: 'gpt-image-1.5' } });
    await expect(adapter.run({ ratio: '21:9', prompt: 'test', count: 1 })).rejects.toThrow(GPT_IMAGE_NATIVE_RATIO_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests exact native GPT Image 2 21:9 and preserves returned image bytes', async () => {
    const wide = jpegHeader(1568, 672);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ b64_json: wide.toString('base64') }] }) });
    globalThis.fetch = fetchMock;
    const adapter = createOpenAiImageAdapter({ config: { apiKey: 'test-key', model: 'gpt-image-2' } });
    const outputs = await adapter.run({ ratio: '21:9', resolution: '1K', prompt: 'test', count: 1 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).size).toBe('1568x672');
    expect(outputs[0].buffer.equals(wide)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a supported GPT Image output byte-for-byte without post-processing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: pixel.toString('base64') }] }),
    });
    const adapter = createOpenAiImageAdapter({ config: { apiKey: 'test-key' } });

    const outputs = await adapter.run({ ratio: '1:1', prompt: 'test', count: 1 });
    expect(outputs[0].buffer.equals(pixel)).toBe(true);
  });

  it('translates canvas tokens to the official OpenAI edit attachment order', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: pixel.toString('base64') }] }),
    });
    globalThis.fetch = fetchMock;
    const adapter = createOpenAiImageAdapter({ config: { apiKey: 'test-key' } });

    await adapter.run({
      ratio: '1:1', prompt: '让 @图片3 只提供画风', count: 1,
      referenceImages: [
        { buffer: pixel, mimeType: 'image/png', fileName: 'identity.png', referenceToken: '图片1' },
        { buffer: pixel, mimeType: 'image/png', fileName: 'style.png', referenceToken: '图片3' },
      ],
    });
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.getAll('image')).toHaveLength(2);
    expect(body.get('prompt')).toBe('让 第2张参考图 只提供画风');
  });

  it('uses the APINebula 4K image endpoint and exact 3840x2160 edit contract', async () => {
    const image4k = jpegHeader(3840, 2160);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: image4k.toString('base64') }] }),
    });
    globalThis.fetch = fetchMock;
    const adapter = createOpenAiImageAdapter({ config: {
      baseUrl: 'https://apinebula.ai', endpoint: '/v1/chat/completions', model: 'gpt-image-2-4k', apiKey: 'test-key',
    } });

    const outputs = await adapter.run({
      ratio: '16:9', resolution: '4K', prompt: 'test', count: 1,
      referenceImages: [{ buffer: pixel, mimeType: 'image/png', fileName: 'reference.png' }],
    });
    const [url, options] = fetchMock.mock.calls[0];
    const body = options.body as FormData;
    expect(url).toBe('https://img-api.apinebula.ai/v1/images/edits');
    expect(body.get('model')).toBe('gpt-image-2-4k');
    expect(body.get('size')).toBe('3840x2160');
    expect(body.get('quality')).toBe('high');
    expect(body.get('output_format')).toBe('jpeg');
    expect(body.get('response_format')).toBe('b64_json');
    expect(body.get('input_fidelity')).toBe('high');
    expect(outputs[0]).toMatchObject({ extension: '.jpg', metadata: { requestedResolution: '4K', width: 3840, height: 2160 } });
  });

  it('does not label an undersized GPT Image 2 result as successful 4K', async () => {
    const image1k = jpegHeader(1536, 1024);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: image1k.toString('base64') }] }),
    });
    const adapter = createOpenAiImageAdapter({ config: {
      baseUrl: 'https://apinebula.ai', endpoint: '/v1/chat/completions', model: 'gpt-image-2-4k', apiKey: 'test-key',
    } });

    await expect(adapter.run({ ratio: '16:9', resolution: '4K', prompt: 'test', count: 1 }))
      .rejects.toThrow('请求 3840x2160，实际 1536x1024');
  });

  it('passes 21:9 natively to Gemini and keeps its returned bytes unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: pixel.toString('base64') } }] } }] }),
    });
    globalThis.fetch = fetchMock;
    const adapter = createGeminiImageAdapter({ config: { apiKey: 'test-key' } });

    const outputs = await adapter.run({ ratio: '21:9', resolution: '1K', prompt: 'test', count: 1 });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.generationConfig.imageConfig.aspectRatio).toBe('21:9');
    expect(outputs[0].buffer.equals(pixel)).toBe(true);
  });

  it('uses Gemini official text-then-images order with ordinal references', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: pixel.toString('base64') } }] } }] }),
    });
    globalThis.fetch = fetchMock;
    const adapter = createGeminiImageAdapter({ config: { apiKey: 'test-key' } });

    await adapter.run({
      ratio: '16:9', resolution: '1K', prompt: '@图片1 保留身份，@图片4 提供画风', count: 1,
      referenceImages: [
        { buffer: Buffer.from('identity'), mimeType: 'image/png', referenceToken: '图片1' },
        { buffer: Buffer.from('style'), mimeType: 'image/png', referenceToken: '图片4' },
      ],
    });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    const parts = request.contents[0].parts;
    expect(parts[0].text).toContain('第1张参考图 保留身份，第2张参考图 提供画风');
    expect(parts[1].inlineData.data).toBe(Buffer.from('identity').toString('base64'));
    expect(parts[2].inlineData.data).toBe(Buffer.from('style').toString('base64'));
  });
});
