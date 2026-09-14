import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { canvasCapabilities, discoverCanvasCapabilities, validateCanvasAction } from '../../server/agent-capabilities.js';
import { agentTools, validateAgentTool } from '../../server/agent-contract.js';
import { executeCanvasAction, inspectCanvasNode, missingCanvasActionHandlers, requireCanvasJobActionOutcome, settingsSupportForModel, validateNodeSettingsForModel, type CanvasActionHost } from './agent-canvas-actions';
import { mayAutoApproveAgentProposal } from './approval-mode';
import { canvasAgentRevision } from './agent-canvas';
import { AgentResultCard } from './AgentResultCard';
import type { CanvasNode, CanvasNodeKind } from '../components/CanvasNodes';
const profile = { ratios: ['1:1', '16:9'], resolutions: ['1K', '4K'], defaultRatio: '1:1', defaultResolution: '1K', count: { min: 1, max: 4, default: 1 }, duration: { min: 5, max: 10, default: 5 }, audio: false, audioInput: false };
const imageModel = { id: 'image-model', name: 'Image model', capability: 'image' as const, adapter: 'openai-image', profile, defaults: { ratio: '1:1', resolution: '1K' } };
const node = (id: string, kind: CanvasNodeKind = 'image'): CanvasNode => ({ id, type: kind, position: { x: 0, y: 0 }, width: 200, height: 120, data: { kind, title: id, mediaUrl: '/assets/' + id + '.png', outputType: 'image', ...(kind === 'imageGenerator' ? { modelId: imageModel.id } : {}) } } as CanvasNode);
const proposal = (action: string, args: object) => ({ action, summary: '用户要求的操作', arguments: JSON.stringify(args) });
const host = () => {
  let nodes = [node('a', 'imageGenerator'), node('b')];
  const h: CanvasActionHost = { nodes: () => nodes, edges: () => [], models: () => [imageModel], check: vi.fn(revision => { if (revision && revision !== canvasAgentRevision(nodes, [])) throw Error('画布已变化'); }),
    commit: vi.fn(next => { nodes = next; }), save: vi.fn(async () => {}), perform: {} };
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 1; });
  return h;
};
afterEach(() => vi.unstubAllGlobals());
describe('canvas capability coverage and authorization', () => {
  it('advertises real catalog tools in both model protocols', () => {
    const names = agentTools.map((t: any) => t.name);
    expect(names).toContain('heiyan_canvas_capabilities'); expect(names).toContain('heiyan_canvas_action');
    expect(new Set(canvasCapabilities.map(c => c.action)).size).toBe(canvasCapabilities.length);
    expect(discoverCanvasCapabilities({ action: 'comfy.select' })).toMatchObject({ risk: 'edit' });
    expect(() => discoverCanvasCapabilities({ action: 'media.upload' })).toThrow('没有此画布操作');
  });
  it('wires the standalone ComfyUI/H3 selection, submission and job lifecycle', () => {
    const source = readFileSync('src/App.tsx', 'utf8');
    const section = source.slice(source.indexOf('const host: CanvasActionHost = {'), source.indexOf('return executeCanvasAction(host, proposal, revision)'));
    const handlers = Object.fromEntries([...section.matchAll(/'([a-z_]+\.[a-z_]+)':/g)].map(m => [m[1], () => {}]));
    expect(Object.keys(handlers)).toEqual(expect.arrayContaining(['comfy.select', 'comfy.pose_preview', 'comfy.editor', 'job.cancel', 'job.resume', 'job.retry', 'video.upscale_prepare', 'video.upscale_run', 'canvas.focus', 'canvas.fit', 'canvas.save']));
    expect(missingCanvasActionHandlers(handlers)).toEqual([]);
    for (const name of ['heiyan_canvas_capabilities', 'heiyan_canvas_action']) expect(readFileSync('server/agent-connector.js', 'utf8')).toContain(name);
    expect(readFileSync('scripts/build-connector-update.mjs', 'utf8')).toContain('server/agent-capabilities.js');
  });
  it.each(['apiKey', 'baseUrl', 'jobId', 'mediaUrl', 'onChange', 'models', '__proto__', 'constructor'])('rejects runtime or credential field %s', key => {
    const input = { action: 'node.settings', arguments: `{"nodeId":"a","settings":{"${key}":"secret-or-script"}}` };
    expect(() => validateCanvasAction(input)).toThrow();
  });
  it('rejects unknown actions, extra selectors, duplicates and malformed JSON', () => {
    for (const p of [proposal('terminal.exec', {}), proposal('node.inspect', { nodeId: 'a', taskId: 'other' }), proposal('node.clone', { nodeIds: ['a', 'a'], mode: 'with-inputs' }), { action: 'node.inspect', arguments: '{' }]) expect(() => validateCanvasAction(p)).toThrow();
  });
  it('uses approval policy without treating a file picker as completed work', () => {
    expect(mayAutoApproveAgentProposal('ask', proposal('node.inspect', { nodeId: 'a' }), 'heiyan_canvas_action')).toBe(true);
    expect(mayAutoApproveAgentProposal('ask', proposal('job.retry', { nodeId: 'a', jobId: 'j' }), 'heiyan_canvas_action')).toBe(false);
    expect(mayAutoApproveAgentProposal('full', proposal('job.retry', { nodeId: 'a', jobId: 'j' }), 'heiyan_canvas_action')).toBe(true);
    expect(mayAutoApproveAgentProposal('full', proposal('comfy.editor', { nodeId: 'a' }), 'heiyan_canvas_action')).toBe(false);
  });
  it('blocks cross-canvas nodes and stale revisions before calling an existing handler', async () => {
    const h = host();
    await expect(executeCanvasAction(h, proposal('node.resize', { nodeId: 'other-task', width: 300, height: 200 }), canvasAgentRevision(h.nodes(), []))).rejects.toThrow('不在当前画布');
    await expect(executeCanvasAction(h, proposal('node.resize', { nodeId: 'a', width: 300, height: 200 }), 'stale')).rejects.toThrow('变化');
    expect(h.commit).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
  });
  it('saves real setting changes and propagates uncertain save failures', async () => {
    const h = host(); await executeCanvasAction(h, proposal('node.settings', { nodeId: 'a', settings: { ratio: '16:9', resolution: '4k', count: 2, imageQuality: 'high' } }), canvasAgentRevision(h.nodes(), []));
    expect(h.nodes()[0].data.imageQuality).toBe('high'); expect(h.save).toHaveBeenCalledOnce();
    expect(h.nodes()[0].data.resolution).toBe('4K');
    h.save = vi.fn(async () => { throw Object.assign(Error('not durable'), { uncertain: true }); });
    await expect(executeCanvasAction(h, proposal('node.resize', { nodeId: 'a', width: 300, height: 200 }), canvasAgentRevision(h.nodes(), []))).rejects.toMatchObject({ uncertain: true });
  });
  it('uses exact OpenAI image settings and rejects ComfyUI-only keys', () => {
    const image = node('image', 'imageGenerator');
    const support = settingsSupportForModel(imageModel, 'imageGenerator');
    expect(support.keys).toEqual(expect.arrayContaining(['ratio', 'resolution', 'count', 'imageQuality']));
    expect(support.values.imageQuality.enum).toEqual(['auto', 'low', 'medium', 'high']);
    expect(validateNodeSettingsForModel(image, [imageModel], { imageQuality: 'medium' })).toMatchObject({ imageQuality: 'medium' });
    for (const settings of [{ ratio: '21:9' }, { resolution: '2K' }, { count: 5 }, { duration: 5 }, { seed: 42 }, { comfySteps: 20 }]) {
      expect(() => validateNodeSettingsForModel(image, [imageModel], settings)).toThrow(/不支持/);
    }
  });
  it('uses exact legacy ComfyUI image adapter settings and LoRA values', () => {
    const model = { ...imageModel, id: 'legacy-comfy', adapter: 'comfyui-illustrious', loraCatalog: { style: ['style-a.safetensors'], character: ['hero.safetensors'], object: ['sword.safetensors'] } } as any;
    const image = node('legacy', 'imageGenerator'); image.data.modelId = model.id;
    const support = settingsSupportForModel(model, 'imageGenerator');
    expect(support.values.characterLora.enum).toEqual(['hero.safetensors']);
    expect(validateNodeSettingsForModel(image, [model], { comfySeedMode: 'fixed', seed: 4294967295, comfySteps: 30, characterLora: 'hero.safetensors', identityStrength: 1.2 })).toMatchObject({ seed: 4294967295 });
    expect(() => validateNodeSettingsForModel(image, [model], { imageQuality: 'high' })).toThrow(/不支持/);
    expect(() => validateNodeSettingsForModel(image, [model], { characterLora: 'unknown.safetensors' })).toThrow(/不支持/);
  });
  it('derives native ComfyUI workflow settings from that selected workflow', () => {
    const workflow = { id: 'pose-edit', name: 'Pose edit', capability: 'image', modelId: 'native-comfy', modelName: 'Comfy', editor: 'native', inputPorts: [{ id: 'reference', label: '参考', accepts: ['image'], bindingMethod: 'image-to-image' }, { id: 'pose', label: '姿态', accepts: ['image'] }], samplingControls: { advanced: ['steps'], variation: { field: 'referenceDenoise', requiresImagePort: 'reference', defaultValue: .6 } } } as any;
    const model = { ...imageModel, id: 'native-comfy', adapter: 'comfyui-native-image', workflows: [workflow] } as any;
    const comfy = node('comfy', 'comfyUiWorkflow'); comfy.data.modelId = model.id; comfy.data.workflowId = workflow.id;
    const support = settingsSupportForModel(model, 'comfyUiWorkflow', workflow);
    expect(support.keys).toEqual(expect.arrayContaining(['comfySteps', 'referenceDenoise', 'poseStrength', 'poseEstimator']));
    expect(support.keys).not.toContain('comfyScheduler');
    expect(validateNodeSettingsForModel(comfy, [model], { comfySteps: 30, referenceDenoise: .7, poseEstimator: 'dwpose' })).toMatchObject({ comfySteps: 30 });
    expect(() => validateNodeSettingsForModel(comfy, [model], { comfyScheduler: 'karras' })).toThrow(/不支持/);
    expect(() => validateNodeSettingsForModel(comfy, [model], { comfySteps: 120 })).toThrow(/不支持/);
  });
  it('uses exact Seedance video profile settings', () => {
    const model = { id: 'seedance', name: 'Seedance', capability: 'video', adapter: 'seedance-video', profile: { ...profile, duration: { min: 3, max: 12, default: 5 }, audio: true, legacyArkOptions: true, outputFormats: ['mp4'] } } as any;
    const video = node('seedance-node', 'videoGenerator'); video.data.modelId = model.id;
    const support = settingsSupportForModel(model, 'videoGenerator');
    expect(support.values.outputFormat.enum).toEqual(['mp4']); expect(support.keys).toContain('cameraFixed');
    expect(validateNodeSettingsForModel(video, [model], { duration: 8, videoInputMode: 'first_last', audioEnabled: true, cameraFixed: false, outputFormat: 'mp4' })).toMatchObject({ duration: 8 });
    expect(() => validateNodeSettingsForModel(video, [model], { h3SamplingSteps: 20 })).toThrow(/不支持/);
  });
  it('uses exact MiniMax H3 settings and conditional legal values', () => {
    const model = { id: 'h3', name: 'MiniMax H3', capability: 'video', adapter: 'comfyui-minimax-h3', managed: false, profile } as any;
    const video = node('h3-node', 'videoGenerator'); video.data.modelId = model.id; video.data.videoInputMode = 'reference';
    const support = settingsSupportForModel(model, 'videoGenerator', undefined, video.data);
    expect(support.values.h3AccelerationMode.enum).toEqual(['standard', 'turbo', 'reference8', 'community8']);
    expect(validateNodeSettingsForModel(video, [model], { seed: 4294967295, h3SamplingSteps: 28, h3AccelerationMode: 'reference8', h3FaceRefine: true })).toMatchObject({ seed: 4294967295 });
    expect(() => validateNodeSettingsForModel(video, [model], { cameraFixed: true })).toThrow(/不支持/);
    expect(() => validateNodeSettingsForModel(video, [model], { videoInputMode: 'first', h3AccelerationMode: 'reference8' })).toThrow(/不支持|只支持/);
    video.data.videoInputMode = 'first';
    expect(validateNodeSettingsForModel(video, [model], { videoInputMode: 'reference', h3AccelerationMode: 'reference8' })).toMatchObject({ h3AccelerationMode: 'reference8' });
    expect(() => validateNodeSettingsForModel(video, [model], { h3BlockCache: true, h3AccelerationMode: 'turbo' })).toThrow(/Balanced/);
  });
  it('uses exact GPT-SoVITS audio settings', () => {
    const model = { id: 'voice', name: 'GPT-SoVITS', capability: 'audio', adapter: 'gpt-sovits-audio', profile, audioOptions: { languages: [{ id: 'zh', label: '中文' }, { id: 'en', label: '英语' }], speed: { min: .75, max: 1.5, default: 1 } } } as any;
    const audio = node('voice-node', 'audioGenerator'); audio.data.modelId = model.id;
    expect(settingsSupportForModel(model, 'audioGenerator').values.audioLanguage.enum).toEqual(['zh', 'en']);
    expect(validateNodeSettingsForModel(audio, [model], { audioLanguage: 'en', audioSpeed: 1.25, audioReferenceText: '保持音色' })).toMatchObject({ audioLanguage: 'en' });
    expect(() => validateNodeSettingsForModel(audio, [model], { ratio: '1:1' })).toThrow(/不支持/);
    expect(() => validateNodeSettingsForModel(audio, [model], { audioLanguage: 'ja' })).toThrow(/不支持/);
  });
  it('uses all five effective Tripo modes, their exclusive fields and P1 legal values', () => {
    const model = { id: 'tripo-p1-2026', name: 'Tripo P1', capability: 'model', adapter: 'tripo3d-model', profile } as any;
    const modelNode = node('tripo-node', 'modelGenerator'); modelNode.data.modelId = model.id;
    const modes = ['text', 'image', 'imageToMultiview', 'imageToMultiviewToModel', 'multiview'] as const;
    const textSupport = settingsSupportForModel(model, 'modelGenerator', undefined, { modelInputMode: 'text' });
    expect(textSupport.values.modelInputMode.enum).toEqual(modes);
    expect(textSupport.values.geometryQuality.enum).toEqual(['standard']);
    expect(textSupport.values.negativePrompt.maxLength).toBe(255); expect(textSupport.values.imageSeed.maximum).toBe(4294967295); expect(textSupport.values.faceLimit).toMatchObject({ minimum: 50, maximum: 20000 });
    expect(textSupport.keys).toEqual(expect.arrayContaining(['negativePrompt', 'imageSeed']));
    expect(textSupport.keys).not.toContain('enableImageAutofix');
    Object.assign(modelNode.data, { modelInputMode: 'image', enableImageAutofix: true, textureAlignment: 'geometry', orientation: 'align_image' });
    expect(validateNodeSettingsForModel(modelNode, [model], { modelInputMode: 'text', negativePrompt: '破损表面', imageSeed: 7 })).toMatchObject({ modelInputMode: 'text', imageSeed: 7, enableImageAutofix: false, textureAlignment: 'original_image', orientation: 'default' });
    expect(() => validateNodeSettingsForModel(modelNode, [model], { modelInputMode: 'text', negativePrompt: '坏'.repeat(256) })).toThrow(/长度/);
    expect(() => validateNodeSettingsForModel(modelNode, [model], { modelInputMode: 'text', enableImageAutofix: true })).toThrow(/不支持/);
    for (const mode of modes.slice(1)) {
      expect(validateCanvasAction(proposal('node.settings', { nodeId: 'tripo-node', settings: { modelInputMode: mode } })).args.settings.modelInputMode).toBe(mode);
      const support = settingsSupportForModel(model, 'modelGenerator', undefined, { modelInputMode: mode });
      expect(support.keys).toEqual(expect.arrayContaining(['enableImageAutofix', 'textureAlignment', 'orientation']));
      expect(support.keys).not.toContain('negativePrompt'); expect(support.keys).not.toContain('imageSeed');
      expect(validateNodeSettingsForModel(modelNode, [model], { modelInputMode: mode, modelPreset: 'game', enableImageAutofix: true, textureAlignment: 'geometry', orientation: 'align_image' })).toMatchObject({ modelInputMode: mode, modelPreset: 'game', negativePrompt: '', imageSeed: undefined });
      expect(() => validateNodeSettingsForModel(modelNode, [model], { modelInputMode: mode, negativePrompt: '破损' })).toThrow(/不支持/);
      expect(() => validateNodeSettingsForModel(modelNode, [model], { modelInputMode: mode, imageSeed: 9 })).toThrow(/不支持/);
    }
    expect(() => validateNodeSettingsForModel(modelNode, [model], { geometryQuality: 'detailed' })).toThrow(/不支持/);
    expect(() => validateNodeSettingsForModel(modelNode, [model], { imageQuality: 'high' })).toThrow(/不支持/);
  });
  it('exposes exact settings keys and legal values from models.inspect', async () => {
    const h = host();
    const workflow = { id: 'draw', name: 'Draw', capability: 'image', modelId: 'comfy', modelName: 'Comfy', editor: 'native', inputPorts: [], samplingControls: { advanced: ['steps'] } } as any;
    const model = { ...imageModel, id: 'comfy', adapter: 'comfyui-native-image', workflows: [workflow] } as any;
    const tripo = { id: 'tripo', name: 'Tripo', capability: 'model', adapter: 'tripo3d-model', profile } as any;
    h.models = () => [imageModel, model, tripo];
    const result = JSON.parse(await executeCanvasAction(h, proposal('models.inspect', { modelId: 'comfy' }), canvasAgentRevision(h.nodes(), [])));
    expect(result.result[0].settings.values.comfySteps).toMatchObject({ minimum: 1, maximum: 100 });
    expect(result.result[0].workflows[0].settings.keys).toContain('comfySteps');
    expect(result.result[0].workflows[0].settings.keys).not.toContain('comfyScheduler');
    const tripoResult = JSON.parse(await executeCanvasAction(h, proposal('models.inspect', { modelId: 'tripo' }), canvasAgentRevision(h.nodes(), [])));
    expect(tripoResult.result[0].settings.values.modelInputMode.enum).toEqual(['text', 'image', 'imageToMultiview', 'imageToMultiviewToModel', 'multiview']);
    expect(tripoResult.result[0].settings.keys).toContain('negativePrompt'); expect(tripoResult.result[0].settings.keys).not.toContain('enableImageAutofix');
    expect(Object.keys(tripoResult.result[0].settingsByMode)).toEqual(['text', 'image', 'imageToMultiview', 'imageToMultiviewToModel', 'multiview']);
    for (const [mode, support] of Object.entries(tripoResult.result[0].settingsByMode) as Array<[string, any]>) {
      expect(support.values.modelInputMode.enum).toEqual(['text', 'image', 'imageToMultiview', 'imageToMultiviewToModel', 'multiview']);
      if (mode === 'text') {
        expect(support.keys).toEqual(expect.arrayContaining(['negativePrompt', 'imageSeed']));
        for (const key of ['enableImageAutofix', 'textureAlignment', 'orientation']) expect(support.keys).not.toContain(key);
      } else {
        expect(support.keys).toEqual(expect.arrayContaining(['enableImageAutofix', 'textureAlignment', 'orientation']));
        for (const key of ['negativePrompt', 'imageSeed']) expect(support.keys).not.toContain(key);
      }
    }
  });
  it('performs canvas.save through one durable host save only', async () => {
    const h = host();
    h.perform['canvas.save'] = vi.fn(async () => { await h.save(); return { saved: true }; });
    await executeCanvasAction(h, proposal('canvas.save', {}), canvasAgentRevision(h.nodes(), []));
    expect(h.perform['canvas.save']).toHaveBeenCalledOnce(); expect(h.save).toHaveBeenCalledOnce();
  });
  it('requires explicit changed job outcomes before returning a completed receipt', () => {
    const base = { action: 'resume' as const, previousJobId: 'job-a', jobId: 'job-a', previousState: 'paused', state: 'running', changed: true, ok: true };
    expect(requireCanvasJobActionOutcome(base, 'resume')).toMatchObject({ jobId: 'job-a', state: 'running' });
    for (const outcome of [
      { ...base, ok: false, changed: false, reason: 'declined' as const, message: 'declined' },
      { ...base, changed: false },
      { ...base, action: 'retry' as const },
    ]) expect(() => requireCanvasJobActionOutcome(outcome, outcome.action)).toThrow();
    expect(requireCanvasJobActionOutcome({ ...base, action: 'retry', jobId: 'job-b', state: 'queued' }, 'retry')).toMatchObject({ jobId: 'job-b' });
  });
  it('returns needs_user for external browser gestures, without changing the canvas', async () => {
    const h = host(); const comfy = node('comfy', 'comfyUiWorkflow'); h.nodes().push(comfy); h.perform['comfy.editor'] = vi.fn(() => ({ opened: true }));
    expect(JSON.parse(await executeCanvasAction(h, proposal('comfy.editor', { nodeId: 'comfy' }), canvasAgentRevision(h.nodes(), [])))).toMatchObject({ status: 'needs_user' });
    expect(h.save).not.toHaveBeenCalled(); expect(h.commit).not.toHaveBeenCalled();
  });
  it('renders capability receipts as a readable result card instead of raw JSON', () => {
    const receipt = { id: 'action-result', at: 1, tool: 'heiyan_canvas_action', status: 'succeeded' as const, result: '{"action":"comfy.select","summary":"已选择 H3 工作流","status":"completed","affected":["a"]}' };
    const html = renderToStaticMarkup(AgentResultCard({ receipt, jobs: [], receipts: [receipt], items: [{ id: 'a', title: 'H3 视频', kind: 'comfyUiWorkflow' }], connected: true, active: false, focus() {}, followup() {} }));
    expect(html).toContain('画布操作已完成'); expect(html).toContain('已选择 H3 工作流'); expect(html).not.toContain('&quot;action&quot;');
  });
  it('does not leak hidden node config or callbacks in inspection', () => {
    const n = node('private'); n.data.apiKey = 'SECRET'; n.data.models = [{ apiKey: 'SECRET' }] as any;
    expect(JSON.stringify(inspectCanvasNode(n, []))).not.toContain('SECRET');
  });
});
