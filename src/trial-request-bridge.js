import { handleLocalRequest } from './trial-storage.js';

export const isInteractionTrial = () => false;

// The private Site authenticates normal page assets, but not ServiceWorker installs.
// Keep the local API in the page; media elements use session-local Blob URLs.
export function createTrialRequestBridge({ origin, nativeFetch, localApi = handleLocalRequest }) {
  const mediaUrls = new Map();
  const durableUrls = new Map();

  function mediaPath(value) {
    if (typeof value !== 'string' || (!value.startsWith('/media/assets/') && !value.startsWith(`${origin}/media/assets/`))) return null;
    const url = new URL(value, origin);
    return /^\/media\/assets\/[\w.-]+$/.test(url.pathname) && !url.search && !url.hash ? url.pathname : null;
  }

  async function hydrate(value) {
    const path = mediaPath(value);
    if (path) {
      if (!mediaUrls.has(path)) mediaUrls.set(path, (async () => {
        const response = await handleLocalRequest(new Request(new URL(path, origin)));
        if (!response.ok) { mediaUrls.delete(path); return value; }
        const url = URL.createObjectURL(await response.blob());
        durableUrls.set(url, path);
        return url;
      })());
      return mediaUrls.get(path);
    }
    if (Array.isArray(value)) return Promise.all(value.map(hydrate));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await hydrate(item)])));
    return value;
  }

  function serialize(value) {
    if (typeof value === 'string') return durableUrls.get(value) || value;
    if (Array.isArray(value)) return value.map(serialize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
    return value;
  }

  async function localFetch(input, init) {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    // Agent API calls (including SSE) must reach the authenticated host relay,
    // not the browser-local canvas API or JSON hydration layer.
    if (url.origin === origin && url.pathname === '/api/cloud/request') return nativeFetch(input, init);
    if (url.origin !== origin || !/^\/(api|media)\//.test(url.pathname)) return nativeFetch(input, init);
    let request = new Request(input instanceof Request ? input : url, init);
    request.signal.throwIfAborted();
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('content-type')?.includes('application/json')) {
      try {
        const payload = serialize(await request.clone().json());
        request = new Request(request, { body: JSON.stringify(payload) });
      } catch {
        // The API returns its normal validation error for malformed JSON.
      }
    }
    const response = await localApi(request);
    request.signal.throwIfAborted();
    if (!response.headers.get('content-type')?.includes('application/json')) return response;
    const value = await hydrate(await response.json());
    return new Response(JSON.stringify(value), { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  return {
    fetch: localFetch,
    serialize,
    dispose() {
      for (const url of durableUrls.keys()) URL.revokeObjectURL(url);
      durableUrls.clear(); mediaUrls.clear();
    },
  };
}
