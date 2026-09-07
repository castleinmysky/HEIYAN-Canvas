import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { agentConnectionForNodes, evaluateConnection } from '../App';
import type { CanvasNodeData, CanvasNodeKind } from '../components/CanvasNodes';

const node = (id: string, kind: CanvasNodeKind, data: Partial<CanvasNodeData> = {}): Node<CanvasNodeData, CanvasNodeKind> => ({
  id, type: kind, position: { x: 0, y: 0 }, data: { kind, title: id, ...data } as CanvasNodeData,
});

describe('Agent automatic connection ports', () => {
  it('routes an image asset into an image generator reference input', () => {
    const nodes = [node('appearance', 'image', { mediaType: 'image', outputType: 'image' }), node('character', 'imageGenerator')];
    const connection = agentConnectionForNodes('appearance', 'character', nodes);
    expect(connection).toMatchObject({ sourceHandle: 'output', targetHandle: 'input' });
    expect(evaluateConnection(connection, nodes, [])).toMatchObject({ error: '' });
  });

  it('routes a text node into the generator compatible input', () => {
    const nodes = [node('description', 'text', { text: '蓝白连体泳装' }), node('character', 'imageGenerator')];
    expect(agentConnectionForNodes('description', 'character', nodes).targetHandle).toBe('input');
  });
});
