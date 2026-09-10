import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasMetadataCache, createViewportPublisher } from './canvas-render-cache';
import { canvasReferenceGraphSignatures } from './App';
import type { CanvasNode } from './components/CanvasNodes';
import type { Edge } from '@xyflow/react';

afterEach(() => vi.useRealTimers());
describe('large canvas metadata cache', () => {
  const node = (id: string): CanvasNode => ({ id, position: { x: 0, y: 0 }, data: { kind: 'imageGenerator', title: id, mediaUrl: '/fixture.png' } } as CanvasNode);
  it('reuses metadata on movement, but invalidates content, ports, references and deletion', () => {
    const compute = vi.fn(canvasReferenceGraphSignatures);
    const cache = createCanvasMetadataCache(compute);
    const nodes = [node('a'), node('b')], edges: Edge[] = [{ id: 'e', source: 'a', target: 'b' }];
    const first = cache(nodes, edges);
    expect(cache(nodes.map(n => ({ ...n, selected: true, position: { x: 20, y: 30 } })), edges)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
    cache([{ ...nodes[0], data: { ...nodes[0].data, mediaUrl: '/new.png' } }, nodes[1]], edges);
    cache(nodes, [{ ...edges[0], targetHandle: 'input' }]);
    cache(nodes, [{ ...edges[0], data: { referenceToken: '图片2' } }]);
    cache([nodes[1]], []);
    expect(compute).toHaveBeenCalledTimes(5);
  });
  it.each([100, 300, 500])('benchmarks 90 drag frames on %i nodes without user data', count => {
    const nodes = Array.from({ length: count }, (_, i) => node('n'+i));
    const edges: Edge[] = nodes.slice(1).map((n, i) => ({ id: 'e'+i, source: nodes[i].id, target: n.id, data: { referenceToken: '图片1' } }));
    const frames = Array.from({ length: 90 }, (_, i) => nodes.map((n, j) => j === 0 ? { ...n, position: { x: i, y: i } } : n));
    let start = performance.now();
    let baseline;
    for (const frame of frames) baseline = canvasReferenceGraphSignatures(frame, edges);
    const before = performance.now()-start;
    const compute = vi.fn(canvasReferenceGraphSignatures), cache = createCanvasMetadataCache(compute);
    start = performance.now();
    let actual;
    for (const frame of frames) actual = cache(frame, edges);
    const after = performance.now()-start;
    expect(actual).toEqual(baseline);
    expect(compute).toHaveBeenCalledTimes(1);
    console.log(JSON.stringify({ nodes: count, frames: frames.length, referenceWorkBeforeMs: +before.toFixed(2), referenceWorkAfterMs: +after.toFixed(2), computationsBefore: 90, computationsAfter: compute.mock.calls.length }));
  });
});
describe('viewport publication', () => {
  it('coalesces bursts and flushes the exact final viewport', () => {
    vi.useFakeTimers();
    const publish = vi.fn(), updater = createViewportPublisher(publish);
    for (let i=0;i<100;i++) updater.schedule({x:i,y:0,zoom:1});
    expect(publish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
    expect(publish).toHaveBeenCalledExactlyOnceWith({x:99,y:0,zoom:1});
    updater.schedule({x:100,y:0,zoom:1});
    updater.flush({x:101,y:2,zoom:2});
    vi.runAllTimers();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith({x:101,y:2,zoom:2});
  });
  it('cancels pending publication when leaving a canvas', () => {
    vi.useFakeTimers();
    const publish=vi.fn(), updater=createViewportPublisher(publish);
    updater.schedule(1);updater.cancel();vi.runAllTimers();
    expect(publish).not.toHaveBeenCalled();
  });
});
