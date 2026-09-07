export type CanvasMediaLodLevel = 'low' | 'high';
export type CanvasLodMediaType = 'image' | 'video';

export const canvasMediaLodEnterZoom = 0.68;
export const canvasMediaLodExitZoom = 0.46;
export const canvasMediaLodMaxEdge = 384;

export function canvasMediaLodLevelForZoom(
  zoom: number,
  current: CanvasMediaLodLevel = 'high',
): CanvasMediaLodLevel {
  const safeZoom = Number.isFinite(zoom) ? zoom : 1;
  if (current === 'low') return safeZoom >= canvasMediaLodEnterZoom ? 'high' : 'low';
  return safeZoom <= canvasMediaLodExitZoom ? 'low' : 'high';
}

function stableSourceHash(value: string) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ (code + index), 0x85ebca6b);
  }
  return `${(left >>> 0).toString(36)}-${(right >>> 0).toString(36)}-${value.length.toString(36)}`;
}

export function canvasMediaLodCacheKey(sourceUrl: string, origin = 'http://heiyan.local') {
  const absolute = new URL(sourceUrl, origin).href;
  return new URL(`/__heiyan_media_lod__/v1/${stableSourceHash(absolute)}.webp`, origin).href;
}

const cacheName = 'heiyan-media-lod-v1';
const memoryUrls = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const queue: Array<() => Promise<void>> = [];
let activeTasks = 0;

function absoluteMediaUrl(value: string) {
  return new URL(value, window.location.href).href;
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('LOD 缩略图生成失败')), 'image/webp', 0.72);
  });
}

async function scaledCanvasBlob(source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, canvasMediaLodMaxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('浏览器无法创建 LOD 画布');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasBlob(canvas);
}

async function imageLodBlob(source: string | Blob) {
  const blob = source instanceof Blob
    ? source
    : await fetch(source, { credentials: 'same-origin', cache: 'force-cache' }).then((response) => {
      if (!response.ok) throw new Error(`LOD 图片读取失败（HTTP ${response.status}）`);
      return response.blob();
    });
  const bitmap = await createImageBitmap(blob);
  try { return await scaledCanvasBlob(bitmap, bitmap.width, bitmap.height); }
  finally { bitmap.close(); }
}

async function videoLodBlob(source: string | Blob) {
  const video = document.createElement('video');
  const objectUrl = source instanceof Blob ? URL.createObjectURL(source) : '';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = typeof source === 'string' ? source : objectUrl;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('LOD 视频帧读取超时')), 15000);
      const finish = (error?: Error) => {
        window.clearTimeout(timer);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('error', onError);
        error ? reject(error) : resolve();
      };
      const onReady = () => finish();
      const onError = () => finish(new Error('LOD 视频帧读取失败'));
      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.load();
    });
    return await scaledCanvasBlob(video, video.videoWidth, video.videoHeight);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function readCachedLod(sourceUrl: string) {
  if (!('caches' in window)) return '';
  const absolute = absoluteMediaUrl(sourceUrl);
  const response = await (await caches.open(cacheName)).match(canvasMediaLodCacheKey(absolute, window.location.origin));
  if (!response || response.headers.get('x-heiyan-lod-source') !== encodeURIComponent(absolute)) return '';
  const blob = await response.blob();
  return blob.size ? URL.createObjectURL(blob) : '';
}

async function storeCachedLod(sourceUrl: string, blob: Blob) {
  if (!('caches' in window)) return;
  const absolute = absoluteMediaUrl(sourceUrl);
  const cache = await caches.open(cacheName);
  await cache.put(canvasMediaLodCacheKey(absolute, window.location.origin), new Response(blob, {
    headers: {
      'content-type': blob.type || 'image/webp',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-heiyan-lod-source': encodeURIComponent(absolute),
    },
  }));
  const keys = await cache.keys();
  if (keys.length > 512) await Promise.all(keys.slice(0, keys.length - 512).map((key) => cache.delete(key)));
}

function pumpQueue() {
  while (activeTasks < 2 && queue.length) {
    const task = queue.shift();
    if (!task) return;
    activeTasks += 1;
    void task().finally(() => {
      activeTasks -= 1;
      pumpQueue();
    });
  }
}

export function persistentMediaLodUrl(options: {
  sourceUrl: string;
  mediaType: CanvasLodMediaType;
  previewUrl?: string;
  sourceBlob?: Blob;
}) {
  if (!options.sourceUrl || typeof window === 'undefined') return Promise.resolve('');
  const sourceUrl = absoluteMediaUrl(options.sourceUrl);
  const memory = memoryUrls.get(sourceUrl);
  if (memory) return Promise.resolve(memory);
  const existing = pending.get(sourceUrl);
  if (existing) return existing;
  const promise = new Promise<string>((resolve) => {
    queue.push(async () => {
      try {
        const cached = await readCachedLod(sourceUrl);
        if (cached) {
          memoryUrls.set(sourceUrl, cached);
          resolve(cached);
          return;
        }
        const previewSource = options.previewUrl ? absoluteMediaUrl(options.previewUrl) : undefined;
        const blob = previewSource
          ? await imageLodBlob(previewSource)
          : options.mediaType === 'video'
            ? await videoLodBlob(options.sourceBlob || sourceUrl)
            : await imageLodBlob(options.sourceBlob || sourceUrl);
        await storeCachedLod(sourceUrl, blob);
        const objectUrl = URL.createObjectURL(blob);
        memoryUrls.set(sourceUrl, objectUrl);
        resolve(objectUrl);
      } catch {
        resolve(options.previewUrl || '');
      } finally {
        pending.delete(sourceUrl);
      }
    });
    pumpQueue();
  });
  pending.set(sourceUrl, promise);
  return promise;
}

export function primePersistentMediaLod(options: {
  sourceUrl: string;
  mediaType: CanvasLodMediaType;
  previewUrl?: string;
  sourceBlob?: Blob;
}) {
  void persistentMediaLodUrl(options);
}
