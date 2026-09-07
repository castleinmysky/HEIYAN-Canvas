// Only adapter calls use this transport. Ordinary canvas media and page fetches do not.
export function createCloudTransport({ origin, fetchImpl }) {
  return async function cloudFetch(input, init) {
    const upstream = new Request(input, init);
    if (new URL(upstream.url).protocol !== 'https:') throw new Error('Online model services must use HTTPS.');
    const headers = new Headers({
      'x-heiyan-cloud': '1',
      'x-heiyan-upstream': upstream.url,
      'x-heiyan-method': upstream.method,
    });
    for (const name of ['accept', 'content-type', 'range']) if (upstream.headers.has(name)) headers.set(name, upstream.headers.get(name));
    for (const [source, target] of [['authorization', 'x-heiyan-api-authorization'], ['x-goog-api-key', 'x-heiyan-api-google-key']]) {
      if (upstream.headers.has(source)) headers.set(target, upstream.headers.get(source));
    }
    const body = ['GET', 'HEAD'].includes(upstream.method) ? undefined : await upstream.blob();
    if (body && body.size > 64 * 1024 * 1024) throw new Error('Cloud API requests must be smaller than 64 MB.');
    return fetchImpl(`${origin}/api/cloud/request`, {
      method: 'POST', headers, body, signal: upstream.signal, credentials: 'same-origin',
    });
  };
}
