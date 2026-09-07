import { describe, expect, it, vi } from 'vitest';
import { advancedConnectionEligible, connectionDraft, connectionCopy, createConnectionFocusController, isAdvancedRowSurface } from './model-connection-settings';
import { canonicalConnection, connectionDefaults, publicConnectionBase, connectionEndpoint, sanitizeConnectionConfig } from '../shared/model-connection-settings.js';
describe('advanced connection settings', () => {
  it('allows exactly supported cloud protocols, never local rows', () => {
    for (const adapter of ['comfyui-native-image', 'comfyui-illustrious', 'comfyui-minimax-h3', 'gpt-sovits-audio', 'http']) expect(advancedConnectionEligible({ adapter, capability: 'image' })).toBe(false);
    expect(advancedConnectionEligible({ adapter: 'openai-image', capability: 'image' })).toBe(true);
    expect(advancedConnectionEligible({ adapter: 'openai-image', capability: 'video' })).toBe(false);
    expect(isAdvancedRowSurface({ closest: () => null })).toBe(true);
    expect(isAdvancedRowSurface({ closest: () => ({}) })).toBe(false);
  });
  it('canonicalizes hostile official destinations and model-dependent paths', () => {
    expect(canonicalConnection('image', { ...connectionDefaults('gemini-image', 'new-model'), baseUrl: 'https://untrusted.example.com', endpoint: '/wrong', validationEndpoint: '/wrong' })).toEqual(connectionDefaults('gemini-image', 'new-model'));
    expect(connectionDraft({ adapter: 'openai-image', config: { baseUrl: 'https://relay.example.com', model: 'mine', endpoint: '/generate' } })).toMatchObject({ mode: 'relay', endpoint: '/generate', model: 'mine' });
  });
  it('rejects unsafe public destinations and same-origin endpoint escapes', () => {
    for (const url of ['http://relay.example.com', 'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://a.local', 'https://a.internal', 'https://user:secret@relay.example.com', 'https://relay.example.com?key=x', 'https://relay.example.com#x', 'https://relay.example.com/../a', 'https://relay.example.com/%2e%2e/a', 'https://2130706433']) expect(() => publicConnectionBase(url), url).toThrow();
    for (const endpoint of ['https://other.example.com/a', '//other.example.com/a', '/a/../x', '/%2e%2e/x', '/x?q=a', '/x#fragment', '/x\\a']) expect(() => connectionEndpoint(endpoint), endpoint).toThrow();
    expect(publicConnectionBase('https://custom-compatible.example.com/provider/v1')).toBe('https://custom-compatible.example.com/provider/v1');
    expect(() => canonicalConnection('model', { ...connectionDefaults('tripo3d-model'), endpoint: '/generation/hacked' })).toThrow();
    expect(() => canonicalConnection('audio', connectionDefaults('openai-image'))).toThrow();
    expect(() => canonicalConnection('image', { ...connectionDefaults('openai-image'), extra: true })).toThrow();
  });
  it('scrubs nested credentials without returning saved key fragments', () => {
    expect(sanitizeConnectionConfig({ model: 'm', nested: { apiKey: 'secret', authorization: 'secret', auth: { access_token: 'secret' }, note: 'my secret' } }, ['secret'])).toEqual({ model: 'm', nested: { auth: {}, note: '[redacted]' } });
  });
  it('focuses the first field, contains Tab, cancels Escape and restores the opener', () => {
    const first = { focus: vi.fn() }, last = { focus: vi.fn() }, opener = { focus: vi.fn() }, cancel = vi.fn();
    let active = last;
    const controller = createConnectionFocusController({ focusables: () => [first, last], active: () => active, opener, cancel });
    controller.activate(); expect(first.focus).toHaveBeenCalledOnce();
    const key = (key: string, shiftKey = false) => ({ key, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    const tab = key('Tab'); controller.keydown(tab); expect(tab.preventDefault).toHaveBeenCalled(); expect(first.focus).toHaveBeenCalledTimes(2);
    active = first; controller.keydown(key('Tab', true)); expect(last.focus).toHaveBeenCalledOnce();
    const escape = key('Escape'); controller.keydown(escape); expect(cancel).toHaveBeenCalledOnce(); expect(escape.stopPropagation).toHaveBeenCalledOnce();
    controller.deactivate(); expect(opener.focus).toHaveBeenCalledOnce();
  });
  it('provides complete bilingual advanced copy', () => {
    expect(Object.keys(connectionCopy('zh'))).toEqual(Object.keys(connectionCopy('en')));
    expect(JSON.stringify(connectionCopy('en'))).not.toMatch(/[\u3400-\u9fff]/u);
  });
});
