import { describe, expect, it } from 'vitest';
import { canvasAgentContext, canvasAgentRevision, planAgentEdits } from './agent-canvas';
import { connectorAddress, readAgentConnection } from './agent-session';
import { sanitizeAgentContext } from '../../server/agent-contract.js';
import type { CanvasNodeData, CanvasNodeKind } from '../components/CanvasNodes';
import type { Node } from '@xyflow/react';

const node = (id: string, kind: CanvasNodeKind = 'text'): Node<CanvasNodeData, CanvasNodeKind> => ({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, title: id, text: 'original' } as CanvasNodeData });
const adapters = { create: (kind: CanvasNodeKind, index: number) => node(`created-${index}`, kind), connect: (source: string, target: string) => ({ id: source + target, source, target }) };
describe('Agent canvas operations', () => {
  it('keeps live selection separate from conversation references through the connector', () => {
    const a = { ...node('a'), selected: true }, b = node('b');
    const read = () => sanitizeAgentContext(canvasAgentContext([a, b], [], ['b']));
    expect(read()).toMatchObject({ selectedNodeIds: ['a'], selectionKnown: true, referenceIds: ['b'] });
    a.selected = false;
    expect(read()).toMatchObject({ selectedNodeIds: [], selectionKnown: true, referenceIds: ['b'] });
  });
  it('replaces a reference atomically using the requested port', () => {
    const nodes = [node('a'), node('b'), node('g', 'imageGenerator')];
    const edges = [{ id: 'old', source: 'a', target: 'g' }];
    let port: string | undefined;
    const result = planAgentEdits({ summary: '替换引用', operations: [{ action: 'disconnect', edgeId: 'old' }, { action: 'connect', source: 'b', target: 'g', targetPort: 'prompt' }] }, nodes, edges, { ...adapters, connect: (source, target, _nodes, _edges, targetPort) => { port = targetPort; return { id: 'new', source, target }; } });
    expect(port).toBe('prompt'); expect(result.edges.map(edge => edge.id)).toEqual(['new']); expect(edges[0].id).toBe('old');
    expect(() => planAgentEdits({ summary: '失败', operations: [{ action: 'disconnect', edgeId: 'old' }, { action: 'connect', source: 'missing', target: 'g' }] }, nodes, edges, adapters)).toThrow();
    expect(edges).toHaveLength(1);
  });
  it('moves and selects nodes, and deletes with downstream invalidation', () => {
    const a = node('a'), b = node('b', 'imageGenerator'); b.data.jobState = 'succeeded';
    const result = planAgentEdits({ summary: '整理', operations: [{ action: 'move', id: 'b', x: 600, y: 200 }, { action: 'select', nodeIds: ['b'] }, { action: 'delete', id: 'a' }] }, [a, b], [{ id: 'edge', source: 'a', target: 'b' }], adapters);
    expect(result.nodes).toHaveLength(1); expect(result.edges).toHaveLength(0);
    expect(result.nodes[0]).toMatchObject({ selected: true, position: { x: 600, y: 200 }, data: { stale: true } });
    expect(a.position.x).toBe(0);
  });
  it('plans a full batch without mutating the original and resolves temporary IDs', () => {
    const nodes = [node('original')];
    const result = planAgentEdits({ summary: '创建分镜', operations: [{ action: 'create', id: 'shot', kind: 'imageGenerator', title: '镜头一', prompt: '清晨' }, { action: 'connect', source: 'original', target: 'shot' }] }, nodes, [], adapters);
    expect(nodes).toHaveLength(1); expect(result.nodes).toHaveLength(2);
    expect(result.edges[0].target).toBe('created-0'); expect(result.nodes[1].data.prompt).toBe('清晨');
  });
  it('rejects invalid late operations without partially committing earlier edits', () => {
    const nodes = [node('a')]; const before = JSON.stringify(nodes);
    expect(() => planAgentEdits({ summary: '编辑', operations: [{ action: 'update', id: 'a', prompt: 'new' }, { action: 'connect', source: 'a', target: 'missing' }] }, nodes, [], adapters)).toThrow();
    expect(JSON.stringify(nodes)).toBe(before);
  });
  it('rejects duplicate temp IDs and updates to running nodes', () => {
    expect(() => planAgentEdits({ summary: '创建', operations: [0, 1].map(() => ({ action: 'create', id: 'same', kind: 'text', title: 'A' })) }, [], [], adapters)).toThrow(/重复/);
    const current = node('a', 'imageGenerator'); current.data.jobState = 'running';
    expect(() => planAgentEdits({ summary: '编辑', operations: [{ action: 'update', id: 'a', prompt: 'new' }] }, [current], [], adapters)).toThrow(/尚未结束/);
  });
  it('invalidates downstream results and retains configured models', () => {
    const a = node('a'), b = node('b', 'imageGenerator'); b.data.jobState = 'succeeded'; b.data.modelId = 'user-model';
    const result = planAgentEdits({ summary: '编辑', operations: [{ action: 'update', id: 'a', prompt: 'new' }] }, [a, b], [{ id: 'edge', source: 'a', target: 'b' }], adapters);
    expect(result.nodes[1].data.stale).toBe(true); expect(result.nodes[1].data.modelId).toBe('user-model'); expect(result.nodes[0].data.text).toBe('new');
  });
  it('serializes only canvas metadata and changes revisions when the graph changes', () => {
    const a = node('a'); a.data.mediaUrl = 'private-url';
    const generator = node('generator', 'imageGenerator');
    const result = canvasAgentContext([a, generator], [{ id: 'edge', source: 'a', sourceHandle: 'output', target: 'generator', targetHandle: 'prompt' }], ['a']);
    expect(JSON.stringify(result)).not.toContain('private-url');
    expect(result.nodes[0].outputType).toBe('text');
    expect(result.nodes[1].inputs.some(port => port.id === 'input' && port.accepts.includes('image'))).toBe(true);
    expect(result.edges[0]).toMatchObject({ sourcePort: 'output', targetPort: 'prompt', type: 'text' });
    expect(result.revision).not.toBe(canvasAgentRevision([{ ...a, position: { x: 3, y: 2 } }], []));
  });
  it('never forwards pairing secrets to a non-loopback host', () => {
    expect(connectorAddress('http://127.0.0.1:17372')).toBe('http://127.0.0.1:17372');
    for (const value of ['https://evil.test', 'http://127.0.0.1:17372/path', 'http://u:p@localhost:17372', 'http://localhost:17372/?token=x']) expect(() => connectorAddress(value)).toThrow();
    expect(readAgentConnection({ getItem: () => JSON.stringify({ url: 'https://evil.test', token: 'a'.repeat(32) }) })).toBeNull();
  });
});
