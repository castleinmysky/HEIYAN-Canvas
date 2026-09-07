import { handleCloudRelay } from './cloud-relay.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/cloud/status') return Response.json({ cloudApi: true, storage: 'browser-local', localCapabilities: false }, { headers: { 'Cache-Control': 'no-store' } });
    if (url.pathname === '/api/cloud/request') return handleCloudRelay(request);
    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'This operation is handled by the canvas page.' }, { status: 404 });
    if (!env.ASSETS) return new Response('Site assets are unavailable.', { status: 503 });
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404 && request.method === 'GET' && !url.pathname.split('/').pop().includes('.')) {
      url.pathname = '/index.html'; response = await env.ASSETS.fetch(new Request(url, request));
    }
    return response;
  },
};
