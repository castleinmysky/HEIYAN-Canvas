import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error JavaScript backend adapter is runtime-tested by Vitest.
import { createGptSovitsAudioAdapter } from '../local-bridge/engine/server/adapters/gpt-sovits-audio.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('GPT-SoVITS audio adapter', () => {
  it('switches the selected voice pair and returns the WAV bytes unchanged', async () => {
    const wav = Buffer.from('RIFF-test-wave');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, headers: new Headers(), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, headers: new Headers(), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'audio/wav' }), arrayBuffer: async () => wav });
    globalThis.fetch = fetchMock;
    const adapter = createGptSovitsAudioAdapter({ id: 'voice-test', config: {
      baseUrl: 'http://127.0.0.1:9880', endpoint: '/tts',
      gptWeights: 'D:\\AI\\GPT-SoVITS\\voices\\原神\\角色.ckpt',
      sovitsWeights: 'D:\\AI\\GPT-SoVITS\\voices\\原神\\角色.pth',
      referenceAudioPath: 'D:\\AI\\GPT-SoVITS\\voices\\原神\\参考.wav',
      referenceText: '测试参考音频', referenceLanguage: 'zh',
    } });

    const outputs = await adapter.run({ prompt: '你好，旅行者。', options: { audioLanguage: 'zh', audioSpeed: 1.15 } });

    expect(String(fetchMock.mock.calls[0][0])).toContain('/set_gpt_weights?weights_path=');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/set_sovits_weights?weights_path=');
    const request = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(request).toMatchObject({ text: '你好，旅行者。', text_lang: 'zh', prompt_text: '测试参考音频', speed_factor: 1.15, media_type: 'wav', streaming_mode: false });
    expect(outputs[0]).toMatchObject({ mediaType: 'audio', extension: '.wav' });
    expect(outputs[0].buffer.equals(wav)).toBe(true);
  });

  it('rejects non-local GPT-SoVITS services', () => {
    expect(() => createGptSovitsAudioAdapter({ config: { baseUrl: 'https://example.com' } })).toThrow(/仅允许连接本机服务/);
  });
});
