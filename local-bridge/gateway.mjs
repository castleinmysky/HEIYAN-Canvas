import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const siteOrigin = 'https://heiyan.f2vfhjcckr.chatgpt.site';
const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const validId = id => /^local_[a-f0-9-]{36}$/.test(id);
const isLocalModel = model => String(model?.adapter || '').startsWith('comfyui-');
const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const safeMedia = value => /^\/media\/(?:outputs|previews)\/[\w./-]+(?:\?[^#]*)?$/.test(value || '') && !String(value).includes('..');
async function body(req, limit = 1024 * 1024) {
  const parts = []; let bytes = 0;
  for await (const part of req) { bytes += part.length; if (bytes > limit) throw Object.assign(new Error('Request too large'), { status: 413 }); parts.push(part); }
  return Buffer.concat(parts);
}
const fail = (status, message) => Object.assign(new Error(message), { status });

/** A narrow authenticated loopback gateway. The full local application is never exposed. */
export function createGateway({ token, stateDir, upstream, fetchImpl = fetch, origins = [siteOrigin], port = 8289, comfyPort = 8288, verifyTarget = async () => {}, completeCatalog = async models => models, serverId = createHash('sha256').update(token).digest('hex'), remoteInfo = () => null }) {
  if (!Number.isInteger(comfyPort) || comfyPort < 1024 || comfyPort > 65535 || [8289, 8291].includes(comfyPort)) throw new Error('Invalid local ComfyUI port.');
  const inFlight = new Map();
  let catalog = [];
  const allowedOrigins = new Set(origins);
  const send = (res, status, value) => { res.writeHead(status, jsonHeaders); res.end(JSON.stringify(value)); };
  const receiptPath = id => path.join(stateDir, 'receipts', id + '.json');
  const read = async id => { try { return JSON.parse(await fs.readFile(receiptPath(id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const write = async (id, value) => { await fs.mkdir(path.dirname(receiptPath(id)), { recursive: true }); const tmp = receiptPath(id) + '.tmp'; await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(tmp, receiptPath(id)); };
  async function api(route, options = {}) {
    const response = await fetchImpl(upstream + route, { ...options, redirect: 'error' });
    const payload = await response.json();
    if (!response.ok) throw fail(response.status, 'The local engine could not complete this request. Check the local engine window.');
    return payload;
  }
  const post = (route, value) => api(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  async function models() { catalog = (await api('/api/v1/models')).models.filter(isLocalModel); return catalog; }
  async function locate(id, receipt) {
    if (!receipt) throw fail(404, 'No submitted task found. No generation was started.');
    if (receipt.rejected) throw fail(409, 'The local engine rejected this task. Submit a new task after correcting the inputs.');
    if (receipt.remoteId) return (await api('/api/v1/jobs/' + receipt.remoteId)).job;
    const jobs = (await api('/api/v1/jobs?taskId=bridge-' + id)).jobs;
    const job = jobs.find(item => item.taskId === 'bridge-' + id);
    if (!job) throw fail(409, 'Submission could not be confirmed. No task was automatically resubmitted.');
    await write(id, { ...receipt, remoteId: job.id }); return job;
  }
  function publicJob(id, job) {
    return { ...job, id, remoteId: undefined, taskId: undefined, inputs: undefined,
      stage: terminal.has(job.status) ? job.status : 'Generating locally',
      error: job.error ? 'The local generation failed. Check the local engine window for details.' : '',
      outputs: (job.outputs || []).map((output, index) => ({ ...output, mediaUrl: '/jobs/' + id + '/outputs/' + index, previewUrl: undefined, metadata: undefined })),
      comfyPreview: job.comfyPreview?.url && safeMedia(job.comfyPreview.url) ? { ...job.comfyPreview, url: '/jobs/' + id + '/preview' } : undefined,
    };
  }
  async function submit(id, payload) {
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    let receipt = await read(id);
    if (receipt) { if (receipt.hash !== hash) throw fail(409, 'This task ID was already used with different inputs.'); return publicJob(id, await locate(id, receipt)); }
    try { await verifyTarget(); } catch (error) { throw fail(409, error.message); }
    if (!(await models()).some(model => model.id === payload.modelId)) throw fail(400, 'Select an available local model.');
    if ((payload.inputs || []).some(input => ['image', 'video', 'audio', 'model', 'character', 'pose', 'lineart'].includes(input.type) && !/^\/media\/assets\/[\w.-]+$/.test(input.value || ''))) throw fail(400, 'Media must be uploaded to this local connector first.');
    receipt = { hash, createdAt: new Date().toISOString() };
    await write(id, receipt); // Durable before dispatch. Never auto-repeat an uncertain dispatch.
    try {
      const { job } = await post('/api/v1/jobs', { ...payload, taskId: 'bridge-' + id, canvasId: 'main' });
      await write(id, { ...receipt, remoteId: job.id });
      return publicJob(id, job);
    } catch (e) { if (e.status >= 400 && e.status < 500) await write(id, { ...receipt, rejected: true }); throw e; }
  }
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    try {
      const expectedHost = '127.0.0.1:' + server.address().port;
      if (req.headers.host !== expectedHost) throw fail(403, 'Loopback host required.');
      if (origin && !allowedOrigins.has(origin)) throw fail(403, 'This website is not paired with this connector.');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.url === '/' && req.method === 'GET' && !origin && !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' });
        const info = remoteInfo();
        const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
        const remotePanel = info ? '<h2>跨网络连接 / Remote connection</h2><p>HTTPS 地址 / HTTPS address</p><code>' + escape(info.url || '通道连接中或已断开，请稍后刷新 / Tunnel connecting or offline. Refresh shortly.') + '</code><p>独立访问码 / Private access code</p><code>' + escape(info.token) + '</code><p>在其他设备的设置中选择“其他网络的机器”，填写上面的地址和访问码。<br>Select “Another network” on the other device, then enter both values. Cloudflare forwards prompts, references and results. Keep the access code private. Restarting changes the temporary address.</p>' : '<p>跨网络访问请改用 Start-Remote-Connector.cmd。<br>For cross-network access, use Start-Remote-Connector.cmd.</p>';
        res.end('<!doctype html><title>HEIYAN Connector</title><style>body{font:16px system-ui;background:#18191a;color:#eee;max-width:680px;margin:8vh auto;padding:24px}code{display:block;padding:20px;background:#27292b;overflow-wrap:anywhere;border-radius:12px;user-select:all}p{line-height:1.7;color:#bcbfc2}h2{margin-top:40px}</style><h1>HEIYAN · 连接信息</h1><p>设置 → 远程ComfyUI生成 / Settings → Remote ComfyUI Generation</p><h2>本机配对码 / Same-computer code</h2><code>' + token + '</code>' + remotePanel + '<p>生成期间保持连接器和 ComfyUI 运行。不要分享此页面或访问码。<br>Keep both programs running. Do not publicly share this page or its codes.</p>'); return;
      }
      const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      const actual = Buffer.from(token);
      if (supplied.length !== actual.length || !timingSafeEqual(supplied, actual)) throw fail(401, 'Pairing code is invalid.');
      const url = new URL(req.url, 'http://' + expectedHost), route = url.pathname;
      if (route === '/connect' && req.method === 'POST') {
        try { await verifyTarget(); } catch (error) { throw fail(409, error.message); }
        await post('/api/v1/comfyui/connect', { baseUrl: 'http://127.0.0.1:' + comfyPort });
        const discovered = await api('/api/v1/admin/models');
        const packageModels = await completeCatalog(discovered.models);
        await api('/api/v1/admin/models', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ models: packageModels.map(model => ({ ...model, enabled: isLocalModel(model) && model.config?.discoveryReady !== false })) }) });
        return send(res, 200, { connected: true, version: 2, serverId, models: await models() });
      }
      if (route === '/status' && req.method === 'GET') return send(res, 200, { connected: true, version: 2, serverId, models: await models() });
      if (['/resources', '/recipes'].includes(route) && req.method === 'GET') return send(res, 200, await api('/api/v1/comfyui' + route));
      if (route === '/assets' && req.method === 'POST') {
        const bytes = await body(req, 64 * 1024 * 1024);
        const contentType = String(req.headers['content-type'] || '');
        if (!contentType.startsWith('multipart/form-data;')) throw fail(400, 'A media file is required.');
        return send(res, 201, await api('/api/v1/canvas/site-bridge/assets', { method: 'POST', body: bytes, headers: { 'Content-Type': contentType } }));
      }
      const match = /^\/jobs\/(local_[a-f0-9-]{36})(?:\/(cancel|preview|outputs\/\d+))?$/.exec(route);
      if (!match || !validId(match[1])) throw fail(404, 'Operation not available.');
      const [, id, operation] = match;
      if (!operation && req.method === 'POST') {
        const payload = JSON.parse((await body(req)).toString('utf8'));
        if (inFlight.has(id)) await inFlight.get(id);
        const promise = submit(id, payload); inFlight.set(id, promise);
        try { return send(res, 202, { job: await promise }); } finally { inFlight.delete(id); }
      }
      const job = await locate(id, await read(id));
      if (!operation && req.method === 'GET') return send(res, 200, { job: publicJob(id, job) });
      if (operation === 'cancel' && req.method === 'POST') {
        const result = terminal.has(job.status) ? job : (await post('/api/v1/jobs/' + job.id + '/cancel', {})).job;
        return send(res, 200, { job: publicJob(id, result) });
      }
      if (req.method === 'GET' && (operation === 'preview' || operation?.startsWith('outputs/'))) {
        const mediaUrl = operation === 'preview' ? job.comfyPreview?.url : job.outputs?.[Number(operation.split('/')[1])]?.mediaUrl;
        if (!safeMedia(mediaUrl)) throw fail(404, 'Result is not available yet.');
        const response = await fetchImpl(upstream + mediaUrl, { headers: req.headers.range ? { Range: req.headers.range } : {}, redirect: 'error' });
        if (!response.ok) throw fail(response.status, 'Result could not be read.');
        res.writeHead(response.status, Object.fromEntries(['content-type', 'content-length', 'content-range', 'accept-ranges'].map(key => [key, response.headers.get(key)]).filter(([, value]) => value)));
        if (response.body) await pipeline(Readable.fromWeb(response.body), res); else res.end(); return;
      }
      throw fail(405, 'Method not allowed.');
    } catch (error) {
      if (!res.headersSent && !res.destroyed) send(res, error.status || 500, { error: error.status ? error.message : 'Local connector unavailable. Check that the deployment package is running.' });
      else res.end();
    }
  });
  server.requestTimeout = 120_000;
  return { server, listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server.address())); }) };
}
