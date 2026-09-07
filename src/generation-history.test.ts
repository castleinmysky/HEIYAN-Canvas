import { describe, expect, it } from 'vitest';
import { generatedAssetDayKey, generatedAssetItemsFromJobs, groupGeneratedAssetsByDay, smoothWheelViewport } from './generation-history';

describe('generated asset history', () => {
  it('uses only real successful outputs, deduplicates URLs, and keeps the newest record', () => {
    const items = generatedAssetItemsFromJobs([
      { id: 'old', status: 'succeeded', updatedAt: '2026-09-01T08:00:00.000Z', modelId: 'm1', outputs: [{ mediaType: 'image', mediaUrl: '/same.png', fileName: 'old.png' }] },
      { id: 'failed', status: 'failed', outputs: [{ mediaType: 'image', mediaUrl: '/failed.png' }] },
      { id: 'fake', status: 'succeeded', outputs: [{ mediaType: 'video', mediaUrl: '/fake.mp4', metadata: { simulated: true } }] },
      { id: 'new', status: 'succeeded', updatedAt: '2026-09-02T08:00:00.000Z', modelId: 'm1', canvasId: 'ideas', outputs: [{ mediaType: 'image', mediaUrl: '/same.png', fileName: 'new.png', metadata: { width: 1024, height: 768 } }] },
    ], new Map([['m1', '真实模型']]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ jobId: 'new', canvasId: 'ideas', fileName: 'new.png', modelName: '真实模型', width: 1024, height: 768 });
  });

  it('groups records into readable local dates', () => {
    const now = new Date('2026-09-04T12:00:00');
    expect(generatedAssetDayKey('2026-09-04T08:00:00', now)).toBe('今天');
    expect(generatedAssetDayKey('2026-09-03T08:00:00', now)).toBe('昨天');
    expect(groupGeneratedAssetsByDay([{ id: '1', jobId: 'j', canvasId: 'main', kind: 'image', mediaUrl: '/a.png', createdAt: '2026-09-03T08:00:00' }], now)[0].label).toBe('昨天');
  });
});

describe('smooth wheel viewport', () => {
  it('keeps the canvas point beneath the cursor anchored while zooming', () => {
    const viewport = { x: 100, y: 50, zoom: 1 };
    const pointer = { x: 400, y: 300 };
    const next = smoothWheelViewport(viewport, pointer, -120, 0.1, 2.5);
    expect(next.zoom).toBeGreaterThan(1);
    expect((pointer.x - next.x) / next.zoom).toBeCloseTo((pointer.x - viewport.x) / viewport.zoom, 8);
    expect((pointer.y - next.y) / next.zoom).toBeCloseTo((pointer.y - viewport.y) / viewport.zoom, 8);
  });

  it('respects the zoom range', () => {
    expect(smoothWheelViewport({ x: 0, y: 0, zoom: 2.5 }, { x: 0, y: 0 }, -240, 0.2, 2.5).zoom).toBe(2.5);
    expect(smoothWheelViewport({ x: 0, y: 0, zoom: 0.2 }, { x: 0, y: 0 }, 240, 0.2, 2.5).zoom).toBe(0.2);
  });
});
