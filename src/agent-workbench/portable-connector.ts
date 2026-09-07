import { connectorAddress } from './agent-session';

export const CONNECTOR_RELEASES_URL = 'https://github.com/castleinmysky/HEIYAN-Canvas/releases/latest';

export function parsePairingFragment(hash: string) {
  if (!hash.startsWith('#heiyan-pair=')) return null;
  try {
    const params = new URLSearchParams(hash.slice('#heiyan-pair='.length));
    const code = params.get('code') || '';
    if (!/^[A-Za-z0-9_-]{32}$/.test(code)) return null;
    return { url: connectorAddress(params.get('url') || ''), code };
  } catch { return null; }
}
export function consumePairingFragment(location: Pick<Location, 'hash' | 'pathname' | 'search'>, history: Pick<History, 'replaceState'>) {
  if (!location.hash.startsWith('#heiyan-pair=')) return null;
  const pair = parsePairingFragment(location.hash);
  // Pairing secrets live only in URL fragments, never query strings or logs.
  history.replaceState(null, '', location.pathname + location.search);
  return pair;
}
type Part = { path: string; bytes: number; sha256: string };
type PortableManifest = { filename: string; bytes: number; parts: Part[] };
export function validatePortableManifest(value: unknown): PortableManifest {
  const item = value as PortableManifest;
  if (!item || item.filename !== 'HEIYAN-Connector-Windows-x64.zip' || !Array.isArray(item.parts) || !item.parts.length || item.parts.length > 32) throw Error('下载清单无效');
  if (!item.parts.every(part => /^\/downloads\/heiyan-windows\/[a-f0-9]{16}\/part-\d{3}\.bin$/.test(part.path) && /^[a-f0-9]{64}$/.test(part.sha256) && Number.isSafeInteger(part.bytes) && part.bytes > 0 && part.bytes <= 20 * 1024 * 1024)) throw Error('下载文件清单无效');
  if (new Set(item.parts.map(part => part.path)).size !== item.parts.length || item.bytes !== item.parts.reduce((sum, part) => sum + part.bytes, 0) || item.bytes > 512 * 1024 * 1024) throw Error('下载大小校验失败');
  return item;
}
export async function downloadPortableConnector(onProgress: (percent: number) => void, signal?: AbortSignal) {
  const metadata = await fetch('/downloads/heiyan-windows/manifest.json', { cache: 'no-cache', signal });
  if (metadata.status === 404) throw Error('此部署未附带安装包，请使用下方 GitHub Releases 下载入口。');
  if (!metadata.ok) throw Error('免安装包暂时无法下载，请稍后重试。');
  const manifest = validatePortableManifest(await metadata.json());
  const chunks: ArrayBuffer[] = []; let bytes = 0;
  for (const part of manifest.parts) {
    const response = await fetch(part.path, { cache: 'force-cache', signal });
    if (!response.ok) throw Error('下载中断，请重试；已缓存的分片无需重复下载。');
    const chunk = await response.arrayBuffer();
    if (chunk.byteLength !== part.bytes) throw Error('下载不完整，请重试。');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', chunk)), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== part.sha256) throw Error('下载校验失败，请刷新页面后重试，不要运行损坏的文件。');
    chunks.push(chunk); bytes += chunk.byteLength; onProgress(Math.round(bytes / manifest.bytes * 100));
  }
  const objectUrl = URL.createObjectURL(new Blob(chunks, { type: 'application/zip' }));
  const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = manifest.filename;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}
