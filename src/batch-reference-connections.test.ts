import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { planBatchReferenceConnections, selectedReferenceSourceIds, collectGeneratorInputsFromGraph } from './App';
import type { CanvasNode, CanvasNodeData } from './components/CanvasNodes';

function node(id: string, kind: CanvasNodeData['kind'], x = 0, extra = {}): CanvasNode {
  return { id, type: kind, position: { x, y: 0 }, width: 200, height: 160, data: { kind, title: id, ...extra } as CanvasNodeData };
}
function videoTarget(extra = {}) {
  return node('target', 'videoGenerator', 1800, { videoInputMode: 'reference', modelId: 'video', models: [
    { id: 'video', capability: 'video', adapter: 'seedance-video', profile: { audioInput: true, referenceLimits: { images: 4, videos: 1, audios: 3, total: 8 } } },
  ], ...extra });
}
function edge(source: string, target = 'target', targetHandle = 'input'): Edge {
  return { id: source + '-' + target, source, sourceHandle: 'output', target, targetHandle };
}
describe('mixed selection batch wiring', () => {
  it('exposes all declared output types, including outputs not generated yet, but excludes containers', () => {
    const sources = ['text', 'image', 'video', 'audio', 'modelGenerator', 'imageGenerator', 'videoGenerator', 'audioGenerator'].map((kind, i) => node(kind, kind as CanvasNodeData['kind'], i * 250));
    const nodes = [...sources, node('collection', 'collection'), node('unknown', 'unsupported')];
    expect(selectedReferenceSourceIds(nodes, nodes.map(n => n.id).reverse())).toEqual(sources.map(n => n.id));
  });
  it('fans mixed text/image/video/audio into compatible ports in visual order', () => {
    const sources = [node('text', 'text', 0), node('image', 'image', 250), node('video', 'video', 500), node('audio', 'audio', 750)];
    const target = videoTarget();
    const plan = planBatchReferenceConnections([...sources, target], [], sources.map(n => n.id).reverse(), target.id);
    expect(plan.error).toBe('');
    expect(plan.connections.map(c => c.type)).toEqual(['text', 'image', 'video', 'audio']);
    expect(plan.connections.every(c => c.targetHandle === 'input' && c.sourceHandle === 'output')).toBe(true);
    expect(plan.sourceIds).toEqual(sources.map(n => n.id));
  });
  it('connects text to image generation but skips incompatible audio without blocking valid inputs', () => {
    const nodes = [node('text', 'text'), node('audio', 'audio', 250), node('target', 'imageGenerator', 900)];
    const plan = planBatchReferenceConnections(nodes, [], ['text', 'audio'], 'target');
    expect(plan.sourceIds).toEqual(['text']);
    expect(plan.skipped.map(s => s.id)).toEqual(['audio']);
  });
  it('uses the selected audio models real input support and leaves every source untouched', () => {
    const target = node('target', 'audioGenerator', 900, { modelId: 'voice', models: [{ id: 'voice', capability: 'audio', profile: { audioInput: true } }] });
    const nodes = [node('text', 'text'), node('voice1', 'audio', 250), node('voice2', 'audio', 500), target];
    const before = JSON.stringify(nodes);
    expect(planBatchReferenceConnections(nodes, [], ['voice1', 'voice2', 'text'], 'target').sourceIds).toEqual(['text', 'voice1']);
    expect(JSON.stringify(nodes)).toBe(before);
    target.data.models![0].profile!.audioInput = false;
    expect(planBatchReferenceConnections(nodes, [], ['text', 'voice1'], 'target').sourceIds).toEqual(['text']);
  });
  it('routes text and images into separate 3D ports, never replacing an occupied front view', () => {
    const nodes = [node('text', 'text'), node('first', 'image', 250), node('second', 'image', 500), node('target', 'modelGenerator', 900)];
    const plan = planBatchReferenceConnections(nodes, [], ['text', 'first', 'second'], 'target');
    expect(plan.connections.map(c => [c.sourceId, c.targetHandle])).toEqual([['text', 'input'], ['first', 'front']]);
    expect(plan.skipped[0].reason).toContain('不会覆盖');
    const edges = [edge('first', 'target', 'front')];
    expect(planBatchReferenceConnections(nodes, edges, ['text', 'second'], 'target').sourceIds).toEqual(['text']);
    expect(edges).toHaveLength(1);
  });
  it('accepts 3D model outputs for character animation and preserves a single-input limit', () => {
    const nodes = [node('model1', 'modelGenerator'), node('model2', 'modelGenerator', 250), node('target', 'characterAnimator', 900)];
    expect(planBatchReferenceConnections(nodes, [], ['model1', 'model2'], 'target').sourceIds).toEqual(['model1']);
  });
  it('retains confirmed image-set connections for multiview 3D workflows', () => {
    const nodes = [node('views', 'turnaroundSplitter', 0, { turnaroundConfirmed: true }), node('target', 'modelGenerator', 900)];
    expect(planBatchReferenceConnections(nodes, [], ['views'], 'target').connections[0]).toMatchObject({ type: 'imageSet', targetHandle: 'multiview' });
  });
  it('uses declared media inputs for a result node without requiring a generation model', () => {
    const sources = [node('image', 'image'), node('video', 'video', 250), node('audio', 'audio', 500), node('model', 'modelGenerator', 750)];
    expect(planBatchReferenceConnections([...sources, node('target', 'result', 1800)], [], sources.map(n => n.id), 'target').sourceIds).toEqual(sources.map(n => n.id));
  });
  it('respects per-type and combined capacities including existing media', () => {
    const target = videoTarget({ models: [{ id: 'video', capability: 'video', profile: { audioInput: true, referenceLimits: { images: 1, videos: 1, audios: 1, total: 2 } } }] });
    const nodes = [node('image1', 'image', 0), node('image2', 'image', 250), node('audio1', 'audio', 500), node('audio2', 'audio', 750), node('text', 'text', 1000), target];
    const plan = planBatchReferenceConnections(nodes, [edge('image1')], ['image2', 'audio1', 'audio2', 'text'], 'target');
    expect(plan.sourceIds).toEqual(['audio1', 'text']);
  });
  it.each([['first', 1], ['first_last', 2]] as const)('respects %s frame mode without auto-changing it', (videoInputMode, expected) => {
    const target = videoTarget({ videoInputMode });
    const sources = [node('a', 'image'), node('b', 'image', 250), node('c', 'image', 500), node('v', 'video', 750)];
    const plan = planBatchReferenceConnections([...sources, target], [], sources.map(n => n.id), 'target');
    expect(plan.sourceIds).toEqual(sources.slice(0, expected).map(n => n.id));
    expect(target.data.videoInputMode).toBe(videoInputMode);
  });
  it('deduplicates selection IDs and rejects existing edges, self-connections and cycles', () => {
    const nodes = [node('a', 'imageGenerator'), node('b', 'imageGenerator', 250), node('target', 'imageGenerator', 900)];
    expect(planBatchReferenceConnections(nodes, [edge('a')], ['a', 'a', 'b', 'target'], 'target').sourceIds).toEqual(['b']);
    const plan = planBatchReferenceConnections(nodes, [edge('target', 'b')], ['b'], 'target');
    expect(plan.sourceIds).toEqual([]);
    expect(plan.error).toContain('环路');
  });
  it('rechecks a deleted target and does not invent ports on upload-only nodes', () => {
    const nodes = [node('a', 'text'), node('target', 'image')];
    expect(planBatchReferenceConnections(nodes, [], ['a'], 'missing').connections).toEqual([]);
    expect(planBatchReferenceConnections(nodes, [], ['a'], 'target').error).toContain('兼容输入');
  });
  it('collects every mixed connected input for the normal generation path', () => {
    const nodes = [node('text', 'text', 0, { text: '描述' }), node('image', 'image', 250, { mediaUrl: 'blob:image' }), node('video', 'video', 500, { mediaUrl: 'blob:video' }), node('audio', 'audio', 750, { mediaUrl: 'blob:audio' }), videoTarget()];
    const plan = planBatchReferenceConnections(nodes, [], ['text', 'image', 'video', 'audio'], 'target');
    const inputs = collectGeneratorInputsFromGraph(nodes, plan.connections.map(c => edge(c.sourceId, 'target', c.targetHandle)), 'target');
    expect(new Set(inputs.map(i => i.type))).toEqual(new Set(['text', 'image', 'video', 'audio']));
  });
});
