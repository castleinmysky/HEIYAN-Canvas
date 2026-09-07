const canvasAssetPath = /^\/api\/(?:v1\/canvas\/[^/]+\/assets\/|public\/canvas\/assets\/)[^/]+$/;
const invalidWindowsFileName = /[<>:"/\\|?*\u0000-\u001f]/g;
const reservedWindowsBaseName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const knownMediaExtension = /\.(?:png|jpe?g|webp|gif|avif|bmp|tiff?|svg|mp4|mov|webm|mkv|avi|m4v|mp3|wav|m4a|aac|ogg|flac|glb|gltf|fbx|obj|stl|usdz|3mf)$/i;

export type DownloadMediaType = 'image' | 'video' | 'audio' | 'model';

function extensionFrom(value: string | undefined) {
  const clean = String(value || '').split(/[?#]/, 1)[0];
  const match = /\.([a-z0-9]{1,8})$/i.exec(clean);
  return match ? `.${match[1].toLowerCase()}` : '';
}

function safeNodeFileBase(value: string | undefined, fallback: string) {
  const clean = String(value || '')
    .replace(invalidWindowsFileName, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 160);
  const base = clean || fallback;
  return reservedWindowsBaseName.test(base) ? `${base}_` : base;
}

function sourceFileBase(value: string | undefined) {
  const clean = String(value || '').split(/[?#]/, 1)[0].replace(/\\/g, '/');
  const tail = clean.slice(clean.lastIndexOf('/') + 1);
  try { return decodeURIComponent(tail); }
  catch { return tail; }
}

export function nodeResourceDownloadFileName(
  nodeTitle: string | undefined,
  sourceFileName: string | undefined,
  mediaUrl: string | undefined,
  mediaType: DownloadMediaType,
  output?: { index: number; count: number },
) {
  const defaults: Record<DownloadMediaType, { base: string; extension: string }> = {
    image: { base: '图片', extension: '.png' },
    video: { base: '视频', extension: '.mp4' },
    audio: { base: '音频', extension: '.wav' },
    model: { base: '3D 模型', extension: '.glb' },
  };
  const fallback = defaults[mediaType];
  const sourceName = sourceFileBase(sourceFileName) || sourceFileBase(mediaUrl);
  const extension = extensionFrom(sourceFileName) || extensionFrom(mediaUrl) || fallback.extension;
  const sourceBase = safeNodeFileBase(sourceName.replace(knownMediaExtension, ''), fallback.base);
  const requestedBase = safeNodeFileBase(nodeTitle, sourceBase).replace(knownMediaExtension, '');
  const suffix = output && output.count > 1 ? `_${String(output.index + 1).padStart(2, '0')}` : '';
  return `${requestedBase || fallback.base}${suffix}${extension}`;
}

export function videoDownloadFileName(
  nodeTitle: string | undefined,
  sourceFileName?: string,
  mediaUrl?: string,
) {
  return nodeResourceDownloadFileName(nodeTitle, sourceFileName, mediaUrl, 'video');
}

export function canvasAssetDownloadUrl(mediaUrl: string, fileName: string) {
  if (!mediaUrl) return mediaUrl;
  let url: URL;
  try { url = new URL(mediaUrl, 'http://ai-canvas.local'); }
  catch { return mediaUrl; }
  if (!canvasAssetPath.test(url.pathname)) return mediaUrl;
  url.searchParams.set('download', '1');
  url.searchParams.set('name', fileName);
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(mediaUrl)
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`;
}
