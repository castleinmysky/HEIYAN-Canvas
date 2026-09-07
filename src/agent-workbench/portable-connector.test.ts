import { describe, it, expect } from 'vitest';
import { parsePairingFragment, consumePairingFragment, validatePortableManifest } from './portable-connector';

describe('portable connector onboarding', () => {
  const code = 'a'.repeat(32);
  it('consumes the one-time fragment without pairing or changing canvas query parameters', () => {
    let replaced = '';
    const location = { pathname: '/studio', search: '?task_id=my-canvas&view=agent', hash: '#heiyan-pair=' + new URLSearchParams({ url: 'http://127.0.0.1:17372', code }) };
    expect(consumePairingFragment(location, { replaceState: (_data, _unused, url) => { replaced = String(url); } })).toEqual({ url: 'http://127.0.0.1:17372', code });
    expect(replaced).toBe('/studio?task_id=my-canvas&view=agent');
  });
  it('rejects remote endpoints, userinfo and malformed codes', () => {
    for (const url of ['https://evil.test', 'http://evil.test:17372', 'http://user:pass@127.0.0.1:17372', 'http://127.0.0.1:17372/private']) expect(parsePairingFragment('#heiyan-pair=' + new URLSearchParams({ url, code }))).toBeNull();
    expect(parsePairingFragment('#heiyan-pair=url=http://localhost:17372&code=invalid')).toBeNull();
    expect(parsePairingFragment('#unrelated')).toBeNull();
  });
  it('download manifest restricts paths, part sizes, hashes and total size', () => {
    const part = { path: '/downloads/heiyan-windows/0123456789abcdef/part-000.bin', bytes: 42, sha256: 'a'.repeat(64) };
    const manifest = { filename: 'HEIYAN-Connector-Windows-x64.zip', bytes: 42, parts: [part] };
    expect(validatePortableManifest(manifest)).toEqual(manifest);
    for (const patch of [{ path: 'https://evil.test/file' }, { path: '/downloads/heiyan-windows/../../private' }, { bytes: 24 * 1024 * 1024 }, { sha256: 'bad' }]) expect(() => validatePortableManifest({ ...manifest, parts: [{ ...part, ...patch }] })).toThrow();
    expect(() => validatePortableManifest({ ...manifest, parts: [part, part], bytes: 84 })).toThrow();
    expect(() => validatePortableManifest({ ...manifest, bytes: 43 })).toThrow();
  });
});
