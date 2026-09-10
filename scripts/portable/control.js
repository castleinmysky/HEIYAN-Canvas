import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';

const secureEqual = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function canvasSite(value) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw Error('画布地址必须为 HTTPS 网站或本机 HTTP 地址');
  return url;
}
export function pairingLink(site, connectorUrl, code) {
  const target = canvasSite(site);
  if(target.pathname === '/') target.pathname='/studio';
  target.searchParams.set('view', 'agent');
  target.hash = 'heiyan-pair=' + new URLSearchParams({ url: connectorUrl, code }).toString();
  return target.href;
}
export function createLocalControl({ secret, packageId, siteUrl, probe, login, stop, version, distribution }) {
  return async (req, res, connector) => {
    const pathname = req.url?.split('?')[0];
    if (!['/setup', '/setup.js', '/setup.css'].includes(pathname) && !pathname?.startsWith('/local/')) return false;
    const ownOrigin = 'http://' + req.headers.host;
    const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try {
      if (!pathname.startsWith('/local/')) {
        if (req.method !== 'GET' || (req.headers.origin && req.headers.origin !== ownOrigin)) { reply(403, { error: '请使用启动脚本打开连接器' }); return true; }
        const filename = pathname === '/setup' ? 'setup.html' : pathname.slice(1);
        const data = await readFile(new URL(filename, import.meta.url));
        res.writeHead(200, { 'Content-Type': pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(data); return true;
      }
      if (req.method !== 'POST' || req.headers.origin !== ownOrigin || !secureEqual(req.headers.authorization, 'Bearer ' + secret) || !String(req.headers['content-type']).startsWith('application/json')) { reply(403, { error: '本机管理授权已失效，请重新双击启动脚本' }); return true; }
      let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 2048) throw Error('请求过大'); }
      if (pathname === '/local/status') reply(200, { app: 'heiyan-portable', packageId, version, distribution, ...(await probe()), paired: connector.paired, site: canvasSite(siteUrl).href });
      else if (pathname === '/local/login') { if (connector.paired) throw Error('请先从原画布断开连接，再重新登录'); await login(); reply(200, { ok: true }); }
      else if (pathname === '/local/connect') {
        if (!(await probe()).loggedIn) throw Error('请先完成自己的 Codex 登录');
        reply(200, { url: pairingLink(siteUrl, ownOrigin, connector.rotatePairing()) });
      } else if (pathname === '/local/stop') { reply(200, { ok: true }); setTimeout(stop, 100); }
      else reply(404, { error: '不支持此操作' });
    } catch (error) { if (!res.headersSent) reply(error.status || 400, { error: error.message }); }
    return true;
  };
}
