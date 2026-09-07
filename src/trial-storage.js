// Browser-only storage. No model calls, local machine connections, or cloud media uploads.
export const databaseName = 'heiyan-sites-trial-v1';
let database;
function db() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
async function transaction(mode, work) {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction('records', mode); let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || new Error('Browser storage transaction aborted.'));
    tx.onerror = () => reject(tx.error);
    work(tx.objectStore('records'), value => { result = value; });
  });
}
const read = key => transaction('readonly', (s, done) => { s.get(key).onsuccess = e => done(e.target.result); });
const write = (key, value) => transaction('readwrite', (s, done) => { s.put(value, key); done(value); });
const remove = key => transaction('readwrite', s => { s.delete(key); });
const entries = () => transaction('readonly', (s, done) => {
  const result = []; s.openCursor().onsuccess = e => { const c = e.target.result; if (c) { result.push([c.key, c.value]); c.continue(); } else done(result); };
});
export const localRecords = { read, write, remove, entries, transaction };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const error = (message, status = 400) => json({ error: message }, status);
const unavailable = () => error('This Site is an interaction trial. Real generation and model connections are available in the local HEIYAN app.', 503);
const validId = value => /^[\w-]{1,128}$/.test(value || '');
const canvasKey = (task, board) => `canvas:${task}:${board}`;
const emptyCanvas = () => ({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
const boardInfo = (id, value) => ({ id, title: value.title || (id === 'main' ? '主画布' : '画布'), nodeCount: value.nodes.length, createdAt: value.createdAt, updatedAt: value.updatedAt });
async function saveCanvas(key, incoming) {
  if (!Array.isArray(incoming.nodes) || !Array.isArray(incoming.edges) || incoming.nodes.length > 5000) return error('Invalid canvas data.');
  if (JSON.stringify(incoming).length > 30_000_000) return error('Canvas data is too large.', 413);
  return transaction('readwrite', (s, done) => {
    s.get(key).onsuccess = event => {
      const current = event.target.result || emptyCanvas();
      if (Number(incoming.revision) !== current.revision) return done(error('Another tab updated this canvas. Reload before saving.', 409));
      const value = { ...current, nodes: incoming.nodes, edges: incoming.edges, viewport: incoming.viewport || current.viewport, task: incoming.task, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      s.put(value, key); done(json(value));
    };
  });
}
const mediaTypes = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp'], ['image/gif', '.gif'],
  ['video/mp4', '.mp4'], ['video/webm', '.webm'], ['video/quicktime', '.mov'],
  ['audio/mpeg', '.mp3'], ['audio/wav', '.wav'], ['audio/x-wav', '.wav'], ['audio/flac', '.flac'], ['audio/ogg', '.ogg'],
  ['model/gltf-binary', '.glb'], ['model/gltf+json', '.gltf'],
]);
async function upload(request) {
  const file = (await request.formData()).get('file');
  if (!(file instanceof Blob) || !file.size) return error('Choose a media file.');
  const extension = mediaTypes.get(file.type) || (/\.glb$/i.test(file.name || '') ? '.glb' : '');
  if (!extension) return error('This media format is not supported.');
  if (file.size > 256 * 1024 ** 2) return error('Use a media file smaller than 256 MB.', 413);
  const id = crypto.randomUUID() + extension;
  await write(`asset:${id}`, { blob: file, name: file.name || id, type: file.type, createdAt: new Date().toISOString() });
  return json({ id, url: `/media/assets/${id}`, originalName: file.name || id, mimeType: file.type }, 201);
}
export function mediaResponse(request, blob) {
  const headers = { 'Content-Type': blob.type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': String(blob.size), 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' };
  const range = request.headers.get('range');
  if (!range) return new Response(request.method === 'HEAD' ? null : blob, { headers });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
  const start = match[1] ? Number(match[1]) : Math.max(0, blob.size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(blob.size - 1, Number(match[2])) : blob.size - 1;
  if (start >= blob.size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
  return new Response(request.method === 'HEAD' ? null : blob.slice(start, end + 1), { status: 206, headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${blob.size}` } });
}
export async function handleLocalRequest(request) {
  try {
    const u = new URL(request.url), p = u.pathname, method = request.method;
    const body = async () => request.json();
    const media = /^\/media\/assets\/([\w.-]+)$/.exec(p);
    if (media) {
      if (!['GET', 'HEAD'].includes(method)) return error('Method not allowed.', 405);
      const record = await read(`asset:${media[1]}`);
      return record?.blob ? mediaResponse(request, record.blob) : error('Media is not stored in this browser.', 404);
    }
    if (p.startsWith('/media/')) return error('No generated media exists in this trial.', 404);
    if (p === '/api/v1/health') { await db(); return json({ ok: true, browserLocal: true }); }
    if (p === '/api/v1/context') return json({ mode: 'local', member: { platformAdmin: true }, generationContractVersion: 1 });
    if (p === '/api/v1/models' || p === '/api/v1/admin/models') return method === 'GET' ? json({ models: [] }) : unavailable();
    if (p === '/api/v1/comfyui/resources') return json({ available: false, moduleEnabled: false, baseUrl: '', models: [], resources: [], checkpoints: [], loras: [], workflows: [] });
    if (/^\/api\/(?:v1\/)?(?:comfyui|managed-comfy|local-h3|generate|models)/.test(p)) return unavailable();
    if (p === '/api/v1/jobs') return method === 'GET' ? json({ jobs: [] }) : unavailable();
    if (p.startsWith('/api/v1/jobs/') || p.startsWith('/api/v1/tripo3d')) return unavailable();
    if (p === '/api/v1/clipboard') {
      if (method === 'GET') return json(await read('clipboard') || { clipboard: null });
      if (method === 'PUT' || method === 'POST') { const value = await body(); await write('clipboard', { clipboard: value.clipboard || value, updatedAt: new Date().toISOString() }); return json({ ok: true }); }
    }
    if (p === '/api/settings') {
      if (method === 'GET') return json(await read('settings') || {});
      if (method === 'PATCH') { const value = await body(); const settings = { theme: value.theme, previewCacheLimitMb: value.previewCacheLimitMb }; await write('settings', settings); return json(settings); }
    }
    if (p === '/api/v1/admin/data/summary') {
      const values = await entries(); const assets = values.filter(([k]) => k.startsWith('asset:'));
      const canvases = values.filter(([k]) => k.startsWith('canvas:'));
      const assetBytes = assets.reduce((n, [, v]) => n + v.blob.size, 0);
      const canvasBytes = canvases.reduce((n, [, v]) => n + new Blob([JSON.stringify(v)]).size, 0);
      return json({ updatedAt: new Date().toISOString(), total: { files: assets.length + canvases.length, bytes: assetBytes + canvasBytes }, categories: [ { id: 'assets', label: 'Imported media', files: assets.length, bytes: assetBytes }, { id: 'canvases', label: 'Canvases', files: canvases.length, bytes: canvasBytes }, { id: 'outputs', label: 'Generated results', files: 0, bytes: 0 } ] });
    }
    if (p === '/api/v1/admin/data/previews' && method === 'DELETE') { await caches.delete('heiyan-media-lod-v1'); return json({ removed: { files: 0, bytes: 0 } }); }
    if (p === '/api/v1/asset-library') return json({ assets: [] });
    const route = /^\/api\/v1\/canvas\/([^/]+)(?:\/(.*))?$/.exec(p);
    if (route) {
      const task = decodeURIComponent(route[1]), suffix = route[2] || '', board = u.searchParams.get('canvasId') || 'main';
      if (!validId(task) || !validId(board)) return error('Invalid canvas identifier.');
      const key = canvasKey(task, board);
      if (suffix === 'assets' && method === 'POST') return await upload(request);
      if (suffix === 'paste' && method === 'POST') {
        const value = await body(), clipboard = value.clipboard;
        if (!Array.isArray(clipboard?.nodes) || !Array.isArray(clipboard.edges)) return error('Clipboard data is invalid.');
        const current = await read(key) || emptyCanvas();
        const ids = new Map(clipboard.nodes.map(n => [n.id, crypto.randomUUID()]));
        const left = Math.min(...clipboard.nodes.map(n => Number(n.position?.x) || 0)), top = Math.min(...clipboard.nodes.map(n => Number(n.position?.y) || 0));
        const nodes = clipboard.nodes.map(n => {
          const copied = JSON.parse(JSON.stringify(n), (_key, v) => typeof v === 'string' && ids.has(v) ? ids.get(v) : v);
          copied.id = ids.get(n.id); copied.position = { x: (Number(n.position?.x) || 0) - left + (Number(value.position?.x) || 0), y: (Number(n.position?.y) || 0) - top + (Number(value.position?.y) || 0) };
          copied.selected = true; return copied;
        });
        const edges = clipboard.edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({ ...e, id: crypto.randomUUID(), source: ids.get(e.source), target: ids.get(e.target) }));
        return await saveCanvas(key, { ...current, nodes: [...current.nodes, ...nodes], edges: [...current.edges, ...edges] });
      }
      if (suffix === 'boards') {
        if (method === 'GET') {
          const prefix = `canvas:${task}:`; const records = (await entries()).filter(([k]) => k.startsWith(prefix));
          const boards = records.map(([k, v]) => boardInfo(k.slice(prefix.length), v));
          if (!boards.some(v => v.id === 'main')) boards.unshift(boardInfo('main', emptyCanvas()));
          boards.sort((a, b) => a.id === 'main' ? -1 : b.id === 'main' ? 1 : a.createdAt.localeCompare(b.createdAt));
          return json({ boards });
        }
        if (method === 'POST') { const value = await body(); const id = `canvas-${crypto.randomUUID()}`; const canvas = { ...emptyCanvas(), title: String(value.title || 'New canvas').slice(0, 48) }; await write(canvasKey(task, id), canvas); return json({ board: boardInfo(id, canvas) }, 201); }
      }
      if (suffix.startsWith('boards/') && method === 'DELETE') {
        const id = suffix.slice(7); if (!validId(id)) return error('Invalid canvas identifier.'); if (id === 'main') return error('Keep the main canvas.', 409);
        await remove(canvasKey(task, id)); return new Response(null, { status: 204 });
      }
      if (!suffix && method === 'GET') return json(await read(key) || emptyCanvas());
      if (!suffix && method === 'PUT') return await saveCanvas(key, await body());
    }
    return error('This feature needs the local HEIYAN app. The current canvas is unchanged.', 501);
  } catch (reason) {
    return error(reason?.name === 'QuotaExceededError' ? 'Browser storage is full. Export your canvas and free space before trying again.' : 'Browser storage could not complete the operation. Existing saved data is unchanged.', 500);
  }
}
