import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudTransport } from '../src/cloud-transport.js';
import { handleCloudRelay } from '../server/cloud-relay.js';

test('multipart image edits preserve binary data and reach only the explicitly selected upstream', async () => {
  const origin = 'https://canvas.chatgpt.site';
  let calls = 0;
  const cloudFetch = createCloudTransport({ origin, fetchImpl: async (url, init) => {
    const headers = new Headers(init.headers); headers.set('origin', origin);
    return handleCloudRelay(new Request(url, { ...init, headers }), { fetchImpl: async (upstream, options) => {
      calls += 1; assert.equal(upstream.href, 'https://relay.vendor.com/v1/images/edits');
      assert.equal(options.headers.get('authorization'), 'Bearer fixture');
      const form = await new Request(upstream, { ...options, duplex: 'half' }).formData();
      assert.equal(form.get('model'), 'my-image-model');
      assert.equal(await form.get('image').text(), 'reference-pixels');
      return Response.json({ data: [{ b64_json: 'fixture' }] });
    } });
  } });
  const body = new FormData(); body.set('model', 'my-image-model'); body.set('image', new File(['reference-pixels'], 'ref.png', { type: 'image/png' }));
  const response = await cloudFetch('https://relay.vendor.com/v1/images/edits', { method: 'POST', headers: { authorization: 'Bearer fixture' }, body });
  assert.equal(response.status, 200); assert.equal(calls, 1);
});

test('Gemini key remains distinct from Site authorization', async () => {
  let called = false;
  const transport = createCloudTransport({ origin: 'https://canvas.chatgpt.site', fetchImpl: async (_url, options) => {
    called = true;
    assert.equal(options.headers.get('x-heiyan-api-google-key'), 'fixture-google');
    assert.equal(options.headers.has('authorization'), false);
    assert.equal(options.credentials, 'same-origin');
    return Response.json({ models: [] });
  } });
  await transport('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': 'fixture-google' } });
  assert.equal(called, true);
});
