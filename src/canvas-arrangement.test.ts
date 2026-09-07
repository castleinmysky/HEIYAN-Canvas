import { describe, expect, it } from 'vitest';
import { arrangeSelectedNodes, planBatchImageReferenceConnections, selectionArrangeCollisionGap } from './App';
import type { CanvasNode, CanvasNodeData } from './components/CanvasNodes';

function canvasNode(id: string, x: number, y: number, width: number, height: number, measuredWidth = width, measuredHeight = height): CanvasNode {
  return {
    id,
    type: 'text',
    position: { x, y },
    width,
    height,
    measured: { width: measuredWidth, height: measuredHeight },
    style: { width, height },
    data: { kind: 'text', title: id } as CanvasNodeData,
  };
}

describe('selection collision arrangement', () => {
  it('uses the largest current dimensions and keeps a visible gap after horizontal packing', () => {
    const first = canvasNode('first', 0, 0, 320, 180, 220, 120);
    const second = canvasNode('second', 640, 20, 280, 160, 220, 120);
    const positions = arrangeSelectedNodes([first, second], 'left');

    expect(positions.get('first')).toEqual({ x: 0, y: 0 });
    expect(positions.get('second')).toEqual({ x: 320 + selectionArrangeCollisionGap, y: 20 });
  });

  it('keeps the same collision gap after vertical packing', () => {
    const first = canvasNode('first', 0, 0, 300, 240, 220, 120);
    const second = canvasNode('second', 20, 600, 260, 200, 220, 120);
    const positions = arrangeSelectedNodes([first, second], 'top');

    expect(positions.get('first')).toEqual({ x: 0, y: 0 });
    expect(positions.get('second')).toEqual({ x: 20, y: 240 + selectionArrangeCollisionGap });
  });

  it('treats unselected canvas nodes as blockers instead of arranging through them', () => {
    const first = canvasNode('first', 0, 0, 300, 160);
    const second = canvasNode('second', 700, 0, 280, 160);
    const obstacle = canvasNode('obstacle', 316, 0, 320, 160);
    const positions = arrangeSelectedNodes([first, second], 'left', [first, second, obstacle]);

    expect(positions.get('first')).toEqual({ x: 0, y: 0 });
    expect(positions.get('second')).toEqual({ x: 636 + selectionArrangeCollisionGap, y: 0 });
  });

  it('does not treat the selected nodes own collection frame as a solid obstacle', () => {
    const first = canvasNode('first', 40, 40, 300, 160);
    const second = canvasNode('second', 700, 40, 280, 160);
    const collection = canvasNode('collection', 0, 0, 1100, 700);
    collection.type = 'collection';
    collection.data = { kind: 'collection', title: 'group', memberIds: ['first', 'second'] } as CanvasNodeData;
    const positions = arrangeSelectedNodes([first, second], 'left', [collection, first, second]);

    expect(positions.get('first')).toEqual({ x: 40, y: 40 });
    expect(positions.get('second')).toEqual({ x: 40 + 300 + selectionArrangeCollisionGap, y: 40 });
  });
});

describe('batch reference connections', () => {
  it('connects selected image-output nodes before they have generated media', () => {
    const first = canvasNode('first-source', 20, 20, 320, 220);
    first.type = 'imageGenerator';
    first.data = { kind: 'imageGenerator', title: '参考图一' } as CanvasNodeData;

    const second = canvasNode('second-source', 380, 20, 320, 220);
    second.type = 'imageGenerator';
    second.data = { kind: 'imageGenerator', title: '参考图二' } as CanvasNodeData;

    const target = canvasNode('target', 760, 20, 320, 220);
    target.type = 'imageGenerator';
    target.data = { kind: 'imageGenerator', title: '目标节点' } as CanvasNodeData;

    const plan = planBatchImageReferenceConnections(
      [first, second, target],
      [],
      [first.id, second.id],
      target.id,
    );

    expect(plan.error).toBe('');
    expect(plan.sourceIds).toEqual([first.id, second.id]);
    expect(plan.targetId).toBe(target.id);
    expect(plan.skipped).toEqual([]);
  });
});
