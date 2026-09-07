import { describe, expect, it } from 'vitest';
import { canvasAgentContext, canvasAgentRevision, planAgentEdits } from './agent-canvas';
import { connectorAddress, readAgentConnection } from './agent-session';
import type { CanvasNodeData, CanvasNodeKind } from '../components/CanvasNodes';
import type { Node } from '@xyflow/react';

const node = (id: string, kind: CanvasNodeKind = 'text'): Node<CanvasNodeData, CanvasNodeKind> => ({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, title: id, text: 'original' } as CanvasNodeData });
const adapters = { create: (kind: CanvasNodeKind, index: number) => node(`created-${index}`, kind), connect: (source: string, target: string) => ({ id: source + target, source, target }) };
describe('Agent canvas operations', () => {
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
    const result = canvasAgentContext([a], [], ['a']);
    expect(JSON.stringify(result)).not.toContain('private-url');
    expect(result.revision).not.toBe(canvasAgentRevision([{ ...a, position: { x: 3, y: 2 } }], []));
  });
  it('never forwards pairing secrets to a non-loopback host', () => {
    expect(connectorAddress('http://127.0.0.1:17372')).toBe('http://127.0.0.1:17372');
    for (const value of ['https://evil.test', 'http://127.0.0.1:17372/path', 'http://u:p@localhost:17372', 'http://localhost:17372/?token=x']) expect(() => connectorAddress(value)).toThrow();
    expect(readAgentConnection({ getItem: () => JSON.stringify({ url: 'https://evil.test', token: 'a'.repeat(32) }) })).toBeNull();
  });
});
