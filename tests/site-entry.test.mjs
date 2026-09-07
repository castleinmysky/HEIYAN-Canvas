import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/site-entry.js';

test('Worker exposes cloud transport and serves the SPA through static asset binding', async () => {
  const requests = [];
  const env = { ASSETS: { fetch: async request => {
    const path = new URL(request.url).pathname; requests.push(path);
    return new Response(path === '/index.html' ? '<html>HEIYAN</html>' : '', { status: path === '/index.html' ? 200 : 404 });
  } } };
  assert.equal(await (await worker.fetch(new Request('https://canvas.chatgpt.site/studio'), env)).text(), '<html>HEIYAN</html>');
  assert.deepEqual(requests, ['/studio', '/index.html']);
  const home = await worker.fetch(new Request('https://canvas.chatgpt.site/'), env);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('Location'), null);
  assert.equal(await home.text(), '<html>HEIYAN</html>');
  assert.equal((await (await worker.fetch(new Request('https://canvas.chatgpt.site/api/cloud/status'), env)).json()).localCapabilities, false);
  assert.equal((await worker.fetch(new Request('https://canvas.chatgpt.site/api/cloud/request'), env)).status, 405);
  assert.equal((await worker.fetch(new Request('https://canvas.chatgpt.site/missing.js'), env)).status, 404);
});
