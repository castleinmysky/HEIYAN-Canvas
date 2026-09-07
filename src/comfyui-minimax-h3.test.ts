import { describe, expect, it } from 'vitest';
import { managedComfyCapabilityCatalog } from '../local-bridge/engine/server/managed-comfy-capability-catalog.js';
import {
  buildComfyUiMiniMaxH3Prompt,
  buildComfyUiMiniMaxH3FaceRefinePrompt,
  buildComfyUiMiniMaxH3ReferencePrompt,
  comfyUiHistoryOutput,
  comfyUiLocalBaseUrl,
  comfyUiMiniMaxH3Encoding,
  comfyUiMiniMaxH3QueueStatus,
  comfyUiViewUrl,
  createComfyUiMiniMaxH3Adapter,
  minimaxH3LocalDimensions,
  minimaxH3LocalFrameCount,
  mapComfyUiMiniMaxH3ReferencePrompt,
  videoContainerHasAudioTrack,
  validateComfyUiMiniMaxH3Inputs,
} from '../local-bridge/engine/server/adapters/comfyui-minimax-h3.js';

describe('ComfyUI MiniMax H3 local adapter', () => {
  it('allows loopback only and uses the installed H3 canvas contract', () => {
    expect(comfyUiLocalBaseUrl('http://127.0.0.1:8188/')).toBe('http://127.0.0.1:8188');
    expect(() => comfyUiLocalBaseUrl('https://example.com')).toThrow(/loopback/);
    expect(minimaxH3LocalDimensions('9:16')).toEqual({ width: 768, height: 1344 });
    expect(minimaxH3LocalDimensions('21:9')).toEqual({ width: 1568, height: 672 });
    const cinema = minimaxH3LocalDimensions('21:9');
    expect(cinema.width * 9).toBe(cinema.height * 21);
    expect(minimaxH3LocalFrameCount(5)).toBe(124);
    expect(minimaxH3LocalFrameCount(15)).toBe(362);
    expect(minimaxH3LocalFrameCount(30)).toBe(736);
  });

  it('builds text or first-last-frame workflows with native audio output', () => {
    const graph = buildComfyUiMiniMaxH3Prompt({ prompt: 'A local shot with ambience', ratio: '16:9', duration: 5, seed: 42, firstFrame: 'first.png', lastFrame: 'last.png', encodingPreset: 'quality', samplingSteps: 24 });
    expect(graph['1'].inputs.unet_name).toBe('minimax_h3_fl2va_pruned_int8_convrot.safetensors');
    expect(graph['5'].inputs).toMatchObject({ width: 1344, height: 768, length: 124, first_frame: ['22', 0], last_frame: ['21', 0] });
    expect(graph['22']).toEqual({ class_type: 'ImageScale', inputs: { image: ['20', 0], upscale_method: 'lanczos', width: 1344, height: 768, crop: 'center' } });
    expect(graph['12'].class_type).toBe('VAEDecodeAudio');
    expect(graph['13'].inputs.audio).toEqual(['12', 0]);
    expect(graph['14'].class_type).toBe('SaveVideo');
    expect(graph['14'].inputs).toMatchObject({ format: 'mp4', codec: 'h264', 'codec.encoding': 're-encode', 'codec.encoding.crf': 18 });
    expect(graph['8'].inputs.steps).toBe(24);
    expect(comfyUiMiniMaxH3Encoding('compact')).toMatchObject({ preset: 'compact', codec: 'h264', bitDepth: 8, crf: 28 });
    const tenBit = buildComfyUiMiniMaxH3Prompt({ prompt: '10-bit gradient', encodingPreset: 'quality10' });
    expect(comfyUiMiniMaxH3Encoding('quality10')).toMatchObject({ preset: 'quality10', codec: 'h264', bitDepth: 10, crf: 18 });
    expect(tenBit['13'].inputs.bit_depth).toBe(10);
    const silent = buildComfyUiMiniMaxH3Prompt({ prompt: 'Silent shot', audioEnabled: false });
    expect(silent['4']).toBeUndefined();
    expect(silent['12']).toBeUndefined();
    expect(silent['13'].inputs.audio).toBeUndefined();

    const cinema = buildComfyUiMiniMaxH3Prompt({ prompt: 'Undistorted cinema frame', ratio: '21:9', firstFrame: 'cinema.png' });
    expect(cinema['5'].inputs).toMatchObject({ width: 1568, height: 672, first_frame: ['22', 0] });
    expect(cinema['22'].inputs).toMatchObject({ width: 1568, height: 672, crop: 'center' });
  });

  it('uses the dedicated Turbo graph for first-frame and omni-reference modes', () => {
    const frameGraph = buildComfyUiMiniMaxH3Prompt({ prompt: 'Turbo frame', firstFrame: 'first.png', accelerationMode: 'turbo' });
    expect(frameGraph['15']).toEqual({ class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', strength_model: 1 } });
    expect(frameGraph['16']).toEqual({ class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['15', 0], shift_video: 12, shift_audio: 3 } });
    expect(frameGraph['7'].inputs.sampler_name).toBe('euler');
    expect(frameGraph['8'].inputs).toMatchObject({ model: ['16', 0], steps: 8, scheduler: 'simple' });
    expect(frameGraph['9'].inputs.model).toEqual(['16', 0]);

    const referenceGraph = buildComfyUiMiniMaxH3ReferencePrompt({ prompt: 'Turbo reference', images: ['reference.png'], accelerationMode: 'turbo' });
    expect(referenceGraph['15']).toEqual({ class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors', strength_model: 1 } });
    expect(referenceGraph['16']).toEqual({ class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['15', 0], shift_video: 12, shift_audio: 3 } });
    expect(referenceGraph['7'].inputs.sampler_name).toBe('euler');
    expect(referenceGraph['8'].inputs).toMatchObject({ model: ['16', 0], steps: 4, scheduler: 'simple' });
    expect(referenceGraph['9'].inputs.model).toEqual(['16', 0]);
  });

  it('builds a native 30-second Ref2VA base-model 8-step graph without a fake LoRA', () => {
    const graph = buildComfyUiMiniMaxH3ReferencePrompt({ prompt: 'Long omni-reference shot', images: ['reference.png'], duration: 30, accelerationMode: 'reference8' });
    expect(graph['5'].inputs.length).toBe(736);
    expect(graph['15']).toBeUndefined();
    expect(graph['16']).toEqual({ class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['1', 0], shift_video: 8, shift_audio: 3 } });
    expect(graph['7'].inputs.sampler_name).toBe('dpmpp_2m');
    expect(graph['8'].inputs).toMatchObject({ model: ['16', 0], steps: 8, scheduler: 'sgm_uniform' });
    expect(graph['9'].inputs.model).toEqual(['16', 0]);
    expect(() => buildComfyUiMiniMaxH3Prompt({ prompt: 'Wrong input mode', accelerationMode: 'reference8' })).toThrow(/omni-reference/);
  });

  it('keeps the community Ref2VA 8-step path isolated behind its dedicated loader and sampler', () => {
    const graph = buildComfyUiMiniMaxH3ReferencePrompt({ prompt: 'Community reference comparison', images: ['reference.png'], accelerationMode: 'community8' });
    expect(graph['15']).toEqual({ class_type: 'MiniMaxH3TurboLoRA', inputs: { model: ['1', 0], lora_name: 'minimax_h3_turbo_v4_step600_ema.safetensors', strength: 1, low_vram: false } });
    expect(graph['17']).toEqual({ class_type: 'MiniMaxH3TurboSampler', inputs: {} });
    expect(graph['8'].inputs).toMatchObject({ model: ['15', 0], steps: 8, scheduler: 'simple' });
    expect(graph['9'].inputs.model).toEqual(['15', 0]);
    expect(graph['10'].inputs.sampler).toEqual(['17', 0]);
    expect(() => buildComfyUiMiniMaxH3Prompt({ prompt: 'Wrong community input mode', accelerationMode: 'community8' })).toThrow(/omni-reference/);
    expect(() => buildComfyUiMiniMaxH3ReferencePrompt({ prompt: 'Too long', images: ['reference.png'], duration: 30, accelerationMode: 'community8' })).toThrow(/15 seconds/);
  });

  it('keeps first-last-frame mode separate from omni-reference mode', () => {
    expect(validateComfyUiMiniMaxH3Inputs([{ port: 'first_frame', type: 'image' }])).toHaveLength(1);
    expect(validateComfyUiMiniMaxH3Inputs([{ port: 'first_frame', type: 'image' }, { port: 'last_frame', type: 'image' }])).toHaveLength(2);
    expect(validateComfyUiMiniMaxH3Inputs([{ port: 'reference', type: 'video', duration: 5 }, { port: 'reference', type: 'audio' }])).toHaveLength(2);
    expect(() => validateComfyUiMiniMaxH3Inputs([{ port: 'last_frame', type: 'image' }])).toThrow(/requires a first frame/);
    expect(() => validateComfyUiMiniMaxH3Inputs([{ port: 'reference', type: 'image' }, { port: 'first_frame', type: 'image' }])).toThrow(/cannot mix/);
    expect(() => validateComfyUiMiniMaxH3Inputs(Array.from({ length: 10 }, () => ({ port: 'reference', type: 'image' })))).toThrow(/9 images/);
    expect(() => validateComfyUiMiniMaxH3Inputs(Array.from({ length: 4 }, () => ({ port: 'reference', type: 'video', duration: 5 })))).toThrow(/3 videos/);
    expect(() => validateComfyUiMiniMaxH3Inputs(Array.from({ length: 4 }, () => ({ port: 'reference', type: 'audio' })))).toThrow(/3 standalone audio/);
  });

  it('builds the deterministic 8-image plus 1-audio R2V graph without inference', () => {
    const images = Array.from({ length: 8 }, (_, index) => `picture-${index + 1}.png`);
    const graph = buildComfyUiMiniMaxH3ReferencePrompt({ prompt: '<Picture 1> walks, voiced by <Audio 1>', images, audios: ['voice.wav'], seed: 77 });
    expect(graph['1'].inputs.unet_name).toBe('minimax_h3_ref2va_pruned_int8_convrot.safetensors');
    expect(graph['5'].class_type).toBe('MiniMaxH3ReferenceToVideo');
    expect(graph['5'].inputs['ref_images.ref_image_0']).toEqual(['20', 0]);
    expect(graph['5'].inputs['ref_images.ref_image_7']).toEqual(['27', 0]);
    expect(graph['5'].inputs['ref_audios.ref_audio_0']).toEqual(['60', 0]);
    expect(Object.keys(graph).filter((key) => graph[key].class_type === 'LoadImage')).toHaveLength(8);
    expect(graph['60']).toEqual({ class_type: 'LoadAudio', inputs: { audio: 'voice.wav' } });
  });

  it('chains official H3 timed image, video, and audio guides and the internal balanced cache', () => {
    const graph = buildComfyUiMiniMaxH3ReferencePrompt({
      prompt: 'Timed guide validation', duration: 5, blockCache: true,
      images: ['subject.png'],
      guides: [
        { type: 'image', file: 'frame.png', frameIndex: 24 },
        { type: 'video', file: 'clip.mp4', frameIndex: 48, hasAudioTrack: true },
        { type: 'audio', file: 'cue.wav', frameIndex: 72 },
      ],
    });
    expect(graph['18']).toEqual({ class_type: 'ApplyH3Ref2VAUltraSafeBlockCache', inputs: expect.objectContaining({ model: ['1', 0], mode: 'Ref2VA Balanced', cache_storage: 'CPU (VRAM-safe)' }) });
    expect(graph['8'].inputs.model).toEqual(['18', 0]);
    expect(graph['104']).toEqual({ class_type: 'MiniMaxH3AddGuide', inputs: expect.objectContaining({ positive: ['5', 0], latent: ['5', 1], frame_idx: 24, image: ['100', 0] }) });
    expect(graph['109']).toEqual({ class_type: 'MiniMaxH3AddGuide', inputs: expect.objectContaining({ positive: ['104', 0], frame_idx: 48, image: ['107', 0], audio: ['106', 1] }) });
    expect(graph['114']).toEqual({ class_type: 'MiniMaxH3AddGuide', inputs: expect.objectContaining({ positive: ['109', 0], frame_idx: 72, audio: ['110', 0] }) });
    expect(graph['9'].inputs.conditioning).toEqual(['114', 0]);
  });

  it('rejects timed guides outside the generated clip', () => {
    expect(() => buildComfyUiMiniMaxH3ReferencePrompt({ prompt: 'bad guide', duration: 5, guides: [{ type: 'image', file: 'late.png', frameIndex: 124 }] })).toThrow(/within 0-123/);
  });

  it('builds the verified post-generation small-face refine graph and preserves audio', () => {
    const graph = buildComfyUiMiniMaxH3FaceRefinePrompt({ video: 'base.mp4', duration: 5, seed: 42, audioEnabled: true, encodingPreset: 'quality' });
    expect(graph['4'].inputs.length).toBe(124);
    expect(graph['5']).toEqual({ class_type: 'H3FaceTrackCrop', inputs: expect.objectContaining({ detector: 'face_yolov8m.pt', identity_track: false, select: 'largest' }) });
    expect(graph['13'].inputs).toMatchObject({ lora_name: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors', strength_model: 0.75 });
    expect(graph['17'].inputs).toMatchObject({ steps: 4, denoise: 0.45 });
    expect(graph['19'].inputs).toMatchObject({ strength_small_face: 0.8, strength_large_face: 0.35 });
    expect(graph['23'].inputs.audio).toEqual(['2', 1]);
    expect(graph['24'].inputs['codec.encoding.crf']).toBe(18);
    expect(buildComfyUiMiniMaxH3FaceRefinePrompt({ video: 'base.mp4', encodingPreset: 'quality10' })['23'].inputs.bit_depth).toBe(10);
  });

  it('rejects uninstalled managed face refinement before any network or generation request', async () => {
    let requests = 0;
    const models = Object.fromEntries(Object.entries(managedComfyCapabilityCatalog['minimax-h3-video-v1'].requiredModelRoles).map(([role, id]) => [role, `fixture/${id}.safetensors`]));
    const adapter = createComfyUiMiniMaxH3Adapter({ id: 'managed-h3', config: { managed: true, baseUrl: 'http://127.0.0.1:8288', models } }, (async () => { requests++; throw new Error('Unexpected network request'); }) as typeof fetch);
    await expect(adapter.run({ prompt: 'Face test', inputs: [], referenceImages: [], options: { h3FaceRefine: true }, signal: new AbortController().signal })).rejects.toThrow(/optional local resources/);
    expect(requests).toBe(0);
  });

  it('runs face refine as a required second prompt and returns only its output', async () => {
    let promptCount = 0;
    const remoteIds: string[] = [];
    const faceNodes = new Set(['H3FaceTrackCrop', 'H3InjectVideoLatent', 'H3PerFrameDenoise', 'H3FaceStitch', 'ImageFromBatch', 'AICanvasVideoFrames24FPS', 'MiniMaxH3ReferenceToVideo', 'MiniMaxH3SigmaShift']);
    const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: {} }));
      if (url.endsWith('/object_info/MiniMaxH3ImageToVideo')) return new Response(JSON.stringify({ MiniMaxH3ImageToVideo: {} }));
      if (url.endsWith('/object_info/LoraLoaderModelOnly')) return new Response(JSON.stringify({ LoraLoaderModelOnly: { input: { required: { lora_name: [['minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors']] } } } }));
      for (const node of faceNodes) if (url.endsWith(`/object_info/${node}`)) return new Response(JSON.stringify({ [node]: {} }));
      if (url.endsWith('/queue')) return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }));
      if (url.endsWith('/upload/image')) return new Response(JSON.stringify({ name: 'refine-input.mp4' }));
      if (url.includes('/view?')) return new Response(Buffer.from('base-video'), { status: 200, headers: { 'Content-Type': 'video/mp4' } });
      if (url.endsWith('/prompt')) return new Response(JSON.stringify({ prompt_id: ++promptCount === 1 ? 'base-prompt' : 'refine-prompt' }));
      if (url.endsWith('/history/base-prompt')) return new Response(JSON.stringify({ 'base-prompt': { status: { messages: [] }, outputs: { '14': { videos: [{ filename: 'base.mp4', subfolder: 'video', type: 'output' }] } } } }));
      if (url.endsWith('/history/refine-prompt')) return new Response(JSON.stringify({ 'refine-prompt': { status: { messages: [] }, outputs: { '24': { videos: [{ filename: 'refined.mp4', subfolder: 'video', type: 'output' }] } } } }));
      throw new Error(`Unexpected request ${url} ${init.method || 'GET'}`);
    };
    const adapter = createComfyUiMiniMaxH3Adapter({ id: 'local-h3', config: { baseUrl: 'http://127.0.0.1:8188', pollIntervalMs: 1 } }, fakeFetch as typeof fetch);
    const result = await adapter.run({ prompt: 'Face test', inputs: [], referenceImages: [], options: { duration: 5, seed: 42, h3FaceRefine: true }, onRemoteTask: (id: string) => remoteIds.push(id), signal: new AbortController().signal });
    expect(promptCount).toBe(2);
    expect(remoteIds).toEqual(['base-prompt', 'refine-prompt']);
    expect(result.outputs[0]).toMatchObject({ fileName: 'refined.mp4', metadata: { promptId: 'base-prompt', faceRefinePromptId: 'refine-prompt', faceRefined: true } });
  });

  it('retries a HostBuffer face-refine failure and preserves the base video if the retry also fails', async () => {
    let promptCount = 0;
    const faceNodes = new Set(['H3FaceTrackCrop', 'H3InjectVideoLatent', 'H3PerFrameDenoise', 'H3FaceStitch', 'ImageFromBatch', 'AICanvasVideoFrames24FPS', 'MiniMaxH3ReferenceToVideo', 'MiniMaxH3SigmaShift']);
    const fakeFetch = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: {} }));
      if (url.endsWith('/object_info/MiniMaxH3ImageToVideo')) return new Response(JSON.stringify({ MiniMaxH3ImageToVideo: {} }));
      if (url.endsWith('/object_info/LoraLoaderModelOnly')) return new Response(JSON.stringify({ LoraLoaderModelOnly: { input: { required: { lora_name: [['minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors']] } } } }));
      for (const node of faceNodes) if (url.endsWith(`/object_info/${node}`)) return new Response(JSON.stringify({ [node]: {} }));
      if (url.endsWith('/queue')) return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }));
      if (url.endsWith('/free')) return new Response('{}', { status: 404 });
      if (url.endsWith('/upload/image')) return new Response(JSON.stringify({ name: 'refine-input.mp4' }));
      if (url.includes('/view?')) return new Response(Buffer.from('base-video'));
      if (url.endsWith('/prompt')) return new Response(JSON.stringify({ prompt_id: ['base', 'refine-1', 'refine-2'][promptCount++] }));
      if (url.endsWith('/history/base')) return new Response(JSON.stringify({ base: { status: { messages: [] }, outputs: { '14': { videos: [{ filename: 'base.mp4', subfolder: 'video', type: 'output' }] } } } }));
      if (/\/history\/refine-[12]$/.test(url)) {
        const id = url.endsWith('1') ? 'refine-1' : 'refine-2';
        return new Response(JSON.stringify({ [id]: { status: { messages: [['execution_error', { exception_message: 'HostBuffer.read_file_slice failed' }]] }, outputs: {} } }));
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const adapter = createComfyUiMiniMaxH3Adapter({ id: 'local-h3', config: { baseUrl: 'http://127.0.0.1:8188', pollIntervalMs: 1 } }, fakeFetch as typeof fetch);
    const result = await adapter.run({ prompt: 'Face retry', inputs: [], referenceImages: [], options: { duration: 5, h3FaceRefine: true }, signal: new AbortController().signal });
    expect(promptCount).toBe(3);
    expect(result.outputs[0]).toMatchObject({ fileName: 'base.mp4', metadata: { faceRefineRequested: true, faceRefined: false, faceRefineWarning: expect.stringContaining('HostBuffer.read_file_slice') } });
  });

  it('maps canvas references to H3 tags and offsets standalone audio after video soundtracks', () => {
    const prompt = mapComfyUiMiniMaxH3ReferencePrompt('@图片1 follows @视频1 and speaks with @音频1', [
      { type: 'image', referenceToken: '图片1' }, { type: 'video' }, { type: 'audio' },
    ]);
    expect(prompt).toContain('<Picture 1> follows <Video 1> and speaks with <Audio 2>');
    expect(prompt).toContain('<Audio 1>');
    const graph = buildComfyUiMiniMaxH3ReferencePrompt({ prompt, videos: ['motion.mp4'], audios: ['voice.wav'] });
    expect(graph['5'].inputs).toMatchObject({ 'ref_videos.ref_video_0': ['42', 0], 'ref_video_audios.ref_video_audio_0': ['41', 1], 'ref_audios.ref_audio_0': ['60', 0] });
    expect(graph['40'].class_type).toBe('LoadVideo');
    expect(graph['41'].class_type).toBe('GetVideoComponents');
    expect(graph['42']).toEqual({ class_type: 'AICanvasVideoFrames24FPS', inputs: { images: ['41', 0], source_fps: ['41', 2] } });
  });

  it('does not reserve an audio token or wire a soundtrack for a silent reference video', () => {
    expect(videoContainerHasAudioTrack(Buffer.from('....soun....'), '.mp4')).toBe(true);
    expect(videoContainerHasAudioTrack(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x83, 0x81, 0x02]), '.webm')).toBe(true);
    expect(videoContainerHasAudioTrack(Buffer.from('silent'), '.mp4')).toBe(false);
    const prompt = mapComfyUiMiniMaxH3ReferencePrompt('@视频1 with @音频1', [
      { type: 'video', referenceToken: '视频1', hasAudioTrack: false }, { type: 'audio', referenceToken: '音频1' },
    ]);
    expect(prompt).toContain('<Video 1> with <Audio 1>');
    const graph = buildComfyUiMiniMaxH3ReferencePrompt({ prompt, videos: [{ file: 'silent.mp4', hasAudioTrack: false }], audios: ['voice.wav'] });
    expect(graph['5'].inputs['ref_video_audios.ref_video_audio_0']).toBeUndefined();
  });

  it('maps the shared single-machine ComfyUI queue to position and ETA', () => {
    const queue = comfyUiMiniMaxH3QueueStatus({
      queue_running: [[0, 'running-1']],
      queue_pending: [[1, 'mine'], [2, 'after-mine']],
    }, { promptId: 'mine', estimatedRunSeconds: 300 });
    expect(queue).toMatchObject({ state: 'queued', concurrency: 1, running: 1, queued: 2, ahead: 1, position: 1, estimatedWaitSeconds: 300 });
  });

  it('extracts a saved ComfyUI video and builds a local view URL', () => {
    const file = comfyUiHistoryOutput({ outputs: { '14': { videos: [{ filename: 'MiniMax_H3_00003_.mp4', subfolder: 'video', type: 'output' }] } } });
    expect(file).toEqual({ filename: 'MiniMax_H3_00003_.mp4', subfolder: 'video', type: 'output' });
    expect(comfyUiViewUrl('http://localhost:8188', file!)).toBe('http://localhost:8188/view?filename=MiniMax_H3_00003_.mp4&subfolder=video&type=output');
  });

  it('rejects Turbo explicitly when its task-specific LoRA is missing', async () => {
    const fakeFetch = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: {} }));
      if (url.endsWith('/object_info/MiniMaxH3ImageToVideo')) return new Response(JSON.stringify({ MiniMaxH3ImageToVideo: {} }));
      if (url.endsWith('/object_info/LoraLoaderModelOnly')) return new Response(JSON.stringify({ LoraLoaderModelOnly: { input: { required: { lora_name: [[]] } } } }));
      if (url.endsWith('/object_info/MiniMaxH3SigmaShift')) return new Response(JSON.stringify({ MiniMaxH3SigmaShift: {} }));
      throw new Error(`Unexpected request ${url}`);
    };
    const adapter = createComfyUiMiniMaxH3Adapter({ id: 'local-h3', config: { baseUrl: 'http://127.0.0.1:8188' } }, fakeFetch as typeof fetch);
    await expect(adapter.run({ prompt: 'Turbo test', inputs: [], referenceImages: [], options: { h3AccelerationMode: 'turbo' }, signal: new AbortController().signal })).rejects.toThrow(/Turbo weight is not installed/);
  });

  it('submits once, polls history, and returns the local MP4 without a real generation', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ url, method: init.method || 'GET' });
      if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: {} }));
      if (url.endsWith('/object_info/MiniMaxH3ImageToVideo')) return new Response(JSON.stringify({ MiniMaxH3ImageToVideo: {} }));
      if (url.endsWith('/queue')) return new Response(JSON.stringify({ queue_running: [[0, 'prompt-local-1']], queue_pending: [] }));
      if (url.endsWith('/prompt')) return new Response(JSON.stringify({ prompt_id: 'prompt-local-1' }));
      if (url.endsWith('/history/prompt-local-1')) return new Response(JSON.stringify({
        'prompt-local-1': { status: { status_str: 'success', messages: [] }, outputs: { '14': { videos: [{ filename: 'MiniMax_H3_00003_.mp4', subfolder: 'video', type: 'output' }] } } },
      }));
      throw new Error(`Unexpected request ${url}`);
    };
    const remoteIds: string[] = [];
    const adapter = createComfyUiMiniMaxH3Adapter({ id: 'local-h3', config: { baseUrl: 'http://127.0.0.1:8188', pollIntervalMs: 1 } }, fakeFetch as typeof fetch);
    const result = await adapter.run({
      prompt: 'Local test', inputs: [], referenceImages: [], options: { ratio: '16:9', duration: 5, seed: 42, h3EncodingPreset: 'compact', referenceVideoAudio: false },
      onRemoteTask: (id: string) => { remoteIds.push(id); }, onProgress: () => {}, signal: new AbortController().signal,
    });
    expect(requests.filter((request) => request.url.endsWith('/prompt'))).toHaveLength(1);
    expect(remoteIds).toEqual(['prompt-local-1']);
    expect(result.outputs[0]).toMatchObject({ mediaType: 'video', fileName: 'MiniMax_H3_00003_.mp4', metadata: { local: true, nativeAudio: true, seed: 42, codec: 'h264', bitDepth: 8, crf: 28, encodingPreset: 'compact', referenceVideoAudio: false, samplingSteps: 20 } });
  });

  it('uploads and submits all 8 images plus 1 audio to R2V without real inference', async () => {
    let uploadCount = 0;
    let submittedGraph: Record<string, any> | undefined;
    const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: {} }));
      if (url.endsWith('/object_info/MiniMaxH3ImageToVideo')) return new Response(JSON.stringify({ MiniMaxH3ImageToVideo: {} }));
      if (url.endsWith('/object_info/MiniMaxH3ReferenceToVideo')) return new Response(JSON.stringify({ MiniMaxH3ReferenceToVideo: {} }));
      if (url.endsWith('/object_info/AICanvasVideoFrames24FPS')) return new Response(JSON.stringify({ AICanvasVideoFrames24FPS: {} }));
      if (url.endsWith('/object_info/MiniMaxH3SigmaShift')) return new Response(JSON.stringify({ MiniMaxH3SigmaShift: {} }));
      if (url.endsWith('/object_info/UNETLoader')) return new Response(JSON.stringify({ UNETLoader: { input: { required: { unet_name: [['minimax_h3_ref2va_pruned_int8_convrot.safetensors']] } } } }));
      if (url.endsWith('/upload/image')) return new Response(JSON.stringify({ name: `uploaded-${uploadCount++}` }));
      if (url.endsWith('/queue')) return new Response(JSON.stringify({ queue_running: [[0, 'prompt-r2v']], queue_pending: [] }));
      if (url.endsWith('/prompt')) {
        submittedGraph = JSON.parse(String(init.body)).prompt;
        return new Response(JSON.stringify({ prompt_id: 'prompt-r2v' }));
      }
      if (url.endsWith('/history/prompt-r2v')) return new Response(JSON.stringify({
        'prompt-r2v': { status: { status_str: 'success', messages: [] }, outputs: { '14': { videos: [{ filename: 'r2v.mp4', subfolder: 'video', type: 'output' }] } } },
      }));
      throw new Error(`Unexpected request ${url}`);
    };
    const referenceImages = Array.from({ length: 8 }, (_, index) => ({
      buffer: Buffer.from(`image-${index}`), mimeType: 'image/png', fileName: `image-${index}.png`, port: 'reference', referenceToken: `图片${index + 1}`,
    }));
    const inputs = [
      ...referenceImages.map((_, index) => ({ port: 'reference', type: 'image', value: `/image-${index}.png`, referenceToken: `图片${index + 1}` })),
      { port: 'reference', type: 'audio', value: '/voice.wav', referenceToken: '音频1' },
    ];
    const adapter = createComfyUiMiniMaxH3Adapter({ id: 'local-h3', config: { baseUrl: 'http://127.0.0.1:8188', pollIntervalMs: 1 } }, fakeFetch as typeof fetch);
    const result = await adapter.run({
      prompt: '@图片1 walks and speaks with @音频1', inputs, referenceImages,
      referenceMedia: [{ buffer: Buffer.from('voice'), mimeType: 'audio/wav', fileName: 'voice.wav', port: 'reference', type: 'audio', referenceToken: '音频1' }],
      options: { ratio: '16:9', duration: 30, refImageSize: 'max', h3AccelerationMode: 'reference8' }, signal: new AbortController().signal,
    });
    expect(uploadCount).toBe(9);
    expect(submittedGraph?.['1'].inputs.unet_name).toBe('minimax_h3_ref2va_pruned_int8_convrot.safetensors');
    expect(submittedGraph?.['5'].inputs).toMatchObject({ ref_image_size: 'max', 'ref_images.ref_image_0': ['20', 0], 'ref_images.ref_image_7': ['27', 0], 'ref_audios.ref_audio_0': ['60', 0] });
    expect(submittedGraph?.['5'].inputs.length).toBe(736);
    expect(submittedGraph?.['15']).toBeUndefined();
    expect(submittedGraph?.['16']).toEqual({ class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['1', 0], shift_video: 8, shift_audio: 3 } });
    expect(submittedGraph?.['5'].inputs.prompt).toContain('<Picture 1> walks and speaks with <Audio 1>');
    expect(result.outputs[0].metadata.generationDurationMs).toEqual(expect.any(Number));
    expect(result.outputs[0].metadata).toMatchObject({ accelerationMode: 'reference8', samplingSteps: 8 });
  });
});
