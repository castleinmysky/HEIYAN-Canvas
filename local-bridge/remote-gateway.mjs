import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { siteOrigin } from './gateway.mjs';

const allowed = (method, route) =>
  (method === 'POST' && ['/connect', '/assets'].includes(route)) ||
  (method === 'GET' && ['/status', '/resources', '/recipes'].includes(route)) ||
  (['GET', 'POST'].includes(method) && /^\/jobs\/local_[a-f0-9-]{36}$/.test(route)) ||
  (method === 'POST' && /^\/jobs\/local_[a-f0-9-]{36}\/cancel$/.test(route)) ||
  (method === 'GET' && /^\/jobs\/local_[a-f0-9-]{36}\/(preview|outputs\/\d+)$/.test(route));

/** Tunnel this port only. Never forward the local pairing page or arbitrary URLs. */
export function createRemoteGateway({ token, localToken, upstream, port = 8291, fetchImpl = fetch, origins = [siteOrigin] }) {
  if (!/^[\w-]{43}$/.test(token) || token === localToken) throw new Error('An independent remote access code is required.');
  const destination = new URL(upstream);
  if (destination.protocol !== 'http:' || destination.hostname !== '127.0.0.1' || destination.username || destination.password || destination.pathname !== '/' || destination.search || destination.hash) throw new Error('Remote gateway upstream must be loopback.');
  let active = 0, uploads = 0;
  const server = http.createServer(async (req, res) => {
    const send = (status, error) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error })); };
    const controller = new AbortController();
    let counted = false, uploading = false;
    res.on('close', () => controller.abort());
    try {
      if (req.headers.host !== '127.0.0.1:' + server.address().port) return send(403, 'Gateway host rejected.');
      const origin = req.headers.origin;
      if (origin && !origins.includes(origin)) return send(403, 'Website not allowed.');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges');
      }
      // Exact request target: no queries, encoded traversal, absolute URLs, admin or pairing routes.
      const route = req.url;
      const method = req.method === 'OPTIONS' ? String(req.headers['access-control-request-method'] || 'POST') : req.method;
      if (!allowed(method, route)) return send(404, 'Operation not available.');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      const actual = Buffer.from(token);
      if (actual.length !== supplied.length || !timingSafeEqual(supplied, actual)) return send(401, 'Remote access code is invalid.');
      uploading = route === '/assets';
      if (active >= 12 || (uploading && uploads >= 2)) return send(429, 'Connector is busy. Try again shortly.');
      counted = true; active++; if (uploading) uploads++;
      const limit = uploading ? 64 * 1024 ** 2 : 1024 ** 2;
      if (Number(req.headers['content-length']) > limit) return send(413, 'Request exceeds the upload limit.');
      let body;
      if (req.method === 'POST') {
        const parts = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > limit) return send(413, 'Request exceeds the upload limit.'); parts.push(chunk); }
        body = Buffer.concat(parts);
      }
      const response = await fetchImpl(destination.origin + route, { method: req.method, body, redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]), headers: {
        Authorization: 'Bearer ' + localToken, Origin: siteOrigin,
        ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
        ...(req.headers.range ? { Range: req.headers.range } : {}),
      } });
      res.writeHead(response.status, { 'Cache-Control': 'no-store', ...Object.fromEntries(['content-type', 'content-length', 'content-range', 'accept-ranges'].map(key => [key, response.headers.get(key)]).filter(([, value]) => value)) });
      if (response.body) await pipeline(Readable.fromWeb(response.body), res); else res.end();
    } catch { if (!res.headersSent && !res.destroyed) send(502, 'Generation connector unavailable. Check the deployment machine.'); else res.destroy(); }
    finally { if (counted) { active--; if (uploading) uploads--; } }
  });
  server.requestTimeout = 120_000; server.headersTimeout = 15_000; server.maxHeadersCount = 40;
  return { server, listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server.address())); }) };
}
