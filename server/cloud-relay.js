// A stateless transport for the user's explicitly selected cloud API.
// Deployment access is enforced by http-app; this handler also rejects cross-site calls.
const forwardedHeaders = ['accept', 'content-type', 'range'];
const responseHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'retry-after'];
const allowedMethods = new Set(['GET', 'POST', 'PUT', 'DELETE', 'HEAD']);
const maxRequestBytes = 64 * 1024 * 1024;
const maxResponseBytes = 256 * 1024 * 1024;
const fail = (message, status) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });

export function cloudDestination(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Use a valid public HTTPS API address.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443'
    || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.endsWith('.')
    || /(?:^|\.)(?:localhost|local|internal|invalid|test|example|onion)$/.test(host)
    || host.endsWith('.home.arpa') || host.endsWith('.arpa')) throw new Error('Only public HTTPS services are available online.');
  return url;
}

function boundedStream(stream, limit) {
  if (!stream) return null;
  let bytes = 0;
  return stream.pipeThrough(new TransformStream({ transform(chunk, controller) {
    bytes += chunk.byteLength;
    if (bytes > limit) throw new Error('Cloud transfer exceeds the supported size.');
    controller.enqueue(chunk);
  } }));
}

export async function handleCloudRelay(request, { fetchImpl = fetch } = {}) {
  const requestUrl = new URL(request.url);
  if (request.method !== 'POST') return fail('Method not allowed.', 405);
  if (request.headers.get('origin') !== requestUrl.origin || request.headers.get('x-heiyan-cloud') !== '1') return fail('Open this connection from your HEIYAN canvas.', 403);
  const method = request.headers.get('x-heiyan-method') || '';
  if (!allowedMethods.has(method)) return fail('Unsupported cloud request method.', 400);
  let target;
  try { target = cloudDestination(request.headers.get('x-heiyan-upstream')); }
  catch (error) { return fail(error.message, 400); }
  if (target.origin === requestUrl.origin || target.hostname.endsWith('.chatgpt.site') || target.hostname.endsWith('.chatgpt-team.site')) return fail('The canvas itself cannot be used as a model endpoint.', 400);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxRequestBytes) return fail('Use a request smaller than 64 MB.', 413);
  const headers = new Headers();
  for (const name of forwardedHeaders) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  // Never forward Site cookies, its own authorization, or arbitrary caller headers.
  for (const [source, destination] of [['x-heiyan-api-authorization', 'authorization'], ['x-heiyan-api-google-key', 'x-goog-api-key']]) {
    const value = request.headers.get(source);
    if (value) { if (value.length > 8000) return fail('API key is too long.', 400); headers.set(destination, value); }
  }
  try {
    const response = await fetchImpl(target, {
      method, headers, redirect: 'manual', signal: request.signal,
      ...(!['GET', 'HEAD'].includes(method) ? { body: boundedStream(request.body, maxRequestBytes), duplex: 'half' } : {}),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return fail('The service returned a redirect. Use its final HTTPS API address.', 502);
    }
    const size = Number(response.headers.get('content-length'));
    if (Number.isFinite(size) && size > maxResponseBytes) { await response.body?.cancel(); return fail('The cloud result exceeds 256 MB.', 413); }
    const safeHeaders = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const name of responseHeaders) if (response.headers.has(name)) safeHeaders.set(name, response.headers.get(name));
    return new Response(method === 'HEAD' ? null : boundedStream(response.body, maxResponseBytes), { status: response.status, headers: safeHeaders });
  } catch {
    // Fetch implementations sometimes include sensitive request headers in errors.
    return fail('Could not reach the selected cloud service. No automatic resubmission was made.', 502);
  }
}
