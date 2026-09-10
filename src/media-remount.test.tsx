import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CanvasLodImage } from './components/CanvasNodes';
import { cachedMediaLodUrl, persistentMediaLodUrl } from './media-lod';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('virtualized image preview reuse', () => {
  it('shares local preview aliases and paints the cached derivative immediately on remount', async () => {
    const src = '/api/v1/canvas/fixture/assets/remount.png';
    const origin = 'http://canvas.local';
    const match = vi.fn(async () => new Response(new Blob(['fixture']), {
      headers: { 'x-heiyan-lod-source': encodeURIComponent(origin + src) },
    }));
    const cachesMock = { open: vi.fn(async () => ({ match })) };
    vi.stubGlobal('window', { location: { href: origin + '/', origin }, caches: cachesMock });
    vi.stubGlobal('caches', cachesMock);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached-remount-image');
    await persistentMediaLodUrl({ sourceUrl: src + '?preview=1', mediaType: 'image' });
    expect(cachedMediaLodUrl(src)).toBe('blob:cached-remount-image');
    expect(cachedMediaLodUrl(src + '?preview=lod')).toBe('blob:cached-remount-image');
    expect(cachedMediaLodUrl(src + '?token=other')).toBe('');
    expect(cachedMediaLodUrl('https://other.example' + src)).toBe('');
    for (let i = 0; i < 10; i++) {
      const html = renderToStaticMarkup(<CanvasLodImage src={src} lodLevel="low" alt="fixture" />);
      expect(html).toContain('src="blob:cached-remount-image"');
      expect(html).not.toContain('media-lod-full');
      await persistentMediaLodUrl({ sourceUrl: src, mediaType: 'image' });
    }
    expect(match).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps originals inactive at low zoom without an explicit preview', () => {
    const html = renderToStaticMarkup(<CanvasLodImage src="/api/v1/canvas/fixture/assets/low.png" lodLevel="low" alt="fixture" />);
    expect(html).toContain('preview=1');
    expect(html).not.toContain('media-lod-full');
    expect(renderToStaticMarkup(<CanvasLodImage src="/full.png" lodLevel="high" alt="fixture" />)).toContain('media-lod-full');
  });
});
