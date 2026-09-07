import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudDestination, handleCloudRelay } from '../server/cloud-relay.js';
const origin = 'https://canvas.chatgpt.site';
const request = (headers = {}, body) => new Request(`${origin}/api/cloud/request`, { method: 'POST', headers: { origin, 'x-heiyan-cloud': '1', 'x-heiyan-method': 'GET', 'x-heiyan-upstream': 'https://api.vendor.com/v1/models', ...headers }, ...(body ? { body } : {}) });

test('rejects local/IP/credential/non-HTTPS destinations without network requests', async () => {
  for (const url of ['http://api.vendor.com', 'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://example.local', 'https://intranet', 'https://name:pass@api.vendor.com', 'https://api.vendor.com/#key', 'https://api.vendor.com:8188']) {
    assert.throws(() => cloudDestination(url));
    assert.equal((await handleCloudRelay(request({ 'x-heiyan-upstream': url }), { fetchImpl: () => { throw new Error('Must not run'); } })).status, 400);
  }
});
test('rejects cross-origin and plain form requests', async () => {
  assert.equal((await handleCloudRelay(request({ origin: 'https://wrong.com' }))).status, 403);
  assert.equal((await handleCloudRelay(request({ 'x-heiyan-cloud': '' }))).status, 403);
});
test('sends only selected API auth, never Site cookies or its auth', async () => {
  let calls = 0;
  const response = await handleCloudRelay(request({ cookie: 'private-cookie', authorization: 'site-private', 'x-heiyan-api-authorization': 'Bearer fixture-key' }), { fetchImpl: async (url, init) => {
    calls += 1; assert.equal(url.origin, 'https://api.vendor.com');
    assert.equal(init.headers.get('authorization'), 'Bearer fixture-key');
    assert.equal(init.headers.has('cookie'), false); assert.equal(init.redirect, 'manual');
    return new Response('ok', { headers: { 'set-cookie': 'not-forwarded', 'content-type': 'application/json' } });
  } });
  assert.equal(calls, 1); assert.equal(await response.text(), 'ok'); assert.equal(response.headers.has('set-cookie'), false);
});
test('never follows redirects with keys or automatically retries paid POSTs', async () => {
  let calls = 0;
  const response = await handleCloudRelay(request({ 'x-heiyan-method': 'POST' }, '{}'), { fetchImpl: async () => { calls += 1; return new Response(null, { status: 307, headers: { location: 'https://other.com' } }); } });
  assert.equal(calls, 1); assert.equal(response.status, 502); assert.equal(response.headers.has('location'), false);
});
test('streams binary result and preserves HTTP partial responses', async () => {
  const response = await handleCloudRelay(request(), { fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-2/10' } }) });
  assert.equal(response.status, 206); assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  assert.equal(response.headers.get('content-range'), 'bytes 0-2/10');
});
test('does not leak thrown credential-bearing errors', async () => {
  const response = await handleCloudRelay(request(), { fetchImpl: async () => { throw new Error('Authorization: fixture-secret'); } });
  assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /fixture-secret/);
});
