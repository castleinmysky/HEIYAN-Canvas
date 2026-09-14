import { describe, expect, it } from 'vitest';
import { apiPayload, apiStep, type ApiProfile } from './agent-api';
import { parseAnswer } from './agent-stream';

const profile = (overrides: Partial<ApiProfile> = {}): ApiProfile => ({
  provider: 'custom', baseUrl: 'https://relay.example/v1', apiKey: 'sk-test-secret-value', model: 'agent-model',
  protocol: 'responses', vision: false, effort: '', contextChars: 48000, stream: false, nativeCompaction: false,
  ...overrides,
});
const adversarialResponse = (apiKey: string) => ({ status: 'completed', output: [
  { type: 'message', role: 'assistant', authorization: `Bearer ${apiKey}`, content: [{ type: 'output_text', text: `结论 ${apiKey}`, cookie: 'heiyan_session=provider-cookie', annotations: [
    { type: 'url_citation', url: `https://example.com/research?api_key=${apiKey}#token=${apiKey}`, title: `Authorization: Bearer ${apiKey}; Cookie: provider-cookie` },
    { type: 'url_citation', url: 'https://example.com/guide?page=2&lang=zh#section', title: 'Research guide' },
    { type: 'url_citation', url: `https://example.com/routed?${apiKey}-field=drop-name&route=keep&echo=prefix-${apiKey}-suffix&page=2#section`, title: 'Secret query fields' },
    { type: 'url_citation', url: `https://example.com/duplicates?tag=safe&tag=prefix-${apiKey}-suffix&tag=also-safe#section`, title: 'Duplicate safe routes' },
    { type: 'url_citation', url: `https://${apiKey}:provider-cookie@example.com/private`, title: 'credential URL' },
  ] }] },
  { type: 'function_call', call_id: 'call-1', name: 'heiyan_read_canvas', arguments: '{}', apiKey },
  { type: 'function_call', call_id: 'call-secret', name: 'heiyan_read_canvas', arguments: JSON.stringify({ providerToken: apiKey }) },
  { type: 'reasoning', encrypted_content: `opaque-${apiKey}`, cookie: 'provider-cookie' },
  { type: 'provider_debug', authorization: `Bearer ${apiKey}`, cookie: 'provider-cookie' },
], usage: { input_tokens: 4, output_tokens: 2 } });
const stream = (response: object, deltas = ['结论']) => {
  const payload = [...deltas.map(delta => 'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta })), 'data: ' + JSON.stringify({ type: 'response.completed', response })].join('\r\n\r\n') + '\r\n\r\n';
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
};

describe('optional Agent web research', () => {
  it('adds exactly one managed web_search tool only when Responses opts in', () => {
    const tools = (apiPayload(profile({ webSearch: true }), [{ role: 'user', content: 'research' }]) as any).tools;
    expect(tools.filter((tool: any) => tool.type === 'web_search')).toEqual([{ type: 'web_search' }]);
  });

  it('keeps web search disabled by default, when switched off, and for Chat Completions', () => {
    for (const current of [profile(), profile({ webSearch: false }), profile({ protocol: 'chat', webSearch: true })]) {
      const payload = apiPayload(current, [{ role: 'user', content: 'hello' }]) as any;
      const tools = payload.tools || [];
      expect(tools.some((tool: any) => tool.type === 'web_search' || tool.function?.type === 'web_search')).toBe(false);
    }
  });

  it('renders only safe http/https URL citations as clickable sources', () => {
    const apiKey = 'sk-citation-secret-value';
    const answer = parseAnswer({ output: [{ type: 'message', content: [{ type: 'output_text', text: '结论', annotations: [
      { type: 'url_citation', url: 'https://example.com/source', title: 'Example [source]' },
      { type: 'url_citation', url: 'javascript:alert(1)', title: 'unsafe' },
      { type: 'url_citation', url: `https://${apiKey}:cookie-secret@example.com/private`, title: 'credential URL' },
      { type: 'url_citation', url: 'https://example.com/a)injected', title: 'parentheses' },
    ] }] }] }, 'responses');
    expect(answer.text).toContain('[Example source](https://example.com/source)');
    expect(answer.text).not.toContain('javascript:');
    expect(answer.text).not.toContain(apiKey);
    expect(answer.text).not.toContain('cookie-secret');
    expect(answer.text).toContain('(https://example.com/a%29injected)');
  });

  it('sanitizes a real non-streamed response before display, persistence and replay', async () => {
    const apiKey = 'sk-test-secret-value';
    const authorization = `Bearer ${apiKey}`;
    const cookie = 'heiyan_session=private-cookie-value';
    let captured = '';
    const events: object[] = [];
    const logs: unknown[][] = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...args: unknown[]) => { logs.push(args); };
    console.warn = (...args: unknown[]) => { logs.push(args); };
    console.error = (...args: unknown[]) => { logs.push(args); };
    const request: typeof fetch = async (_input, init) => {
      captured = String(init?.body || '');
      expect(String(new Headers(init?.headers).get('x-heiyan-api-authorization'))).toBe(authorization);
      return new Response(JSON.stringify(adversarialResponse(apiKey)), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const answer = await apiStep(profile({ request, apiKey, webSearch: true }), [{ role: 'user', content: 'hello' }], new AbortController().signal, { onText: text => events.push({ type: 'agent.text', text }) });
      const requestBody = JSON.parse(captured);
      const replay = apiPayload(profile({ apiKey }), [{ role: 'assistant', content: answer.text, responseItems: answer.responseItems }]) as any;
      const defensiveReplay = apiPayload(profile({ apiKey }), [{ role: 'assistant', content: '', responseItems: adversarialResponse(apiKey).output }]) as any;
      const plainReplay = apiPayload(profile({ apiKey }), [{ role: 'assistant', content: `模型正文 ${apiKey}` }]) as any;
      const chatReplay = apiPayload(profile({ apiKey, protocol: 'chat' }), [{ role: 'assistant', content: `模型正文 ${apiKey}` }]) as any;
      const persisted = JSON.stringify({ role: 'assistant', content: answer.text, responseItems: answer.responseItems });
      const surfaces = [captured, JSON.stringify(requestBody), answer.text, JSON.stringify(answer.responseItems), JSON.stringify(events), JSON.stringify(logs), persisted, JSON.stringify(replay.input), JSON.stringify(defensiveReplay.input), JSON.stringify(plainReplay.input), JSON.stringify(chatReplay.messages)];
      for (const surface of surfaces) for (const secret of [apiKey, authorization, cookie, 'private-cookie-value', 'provider-cookie', '?api_key=', '#token=']) expect(surface).not.toContain(secret);
      expect(JSON.stringify((apiPayload(profile({ apiKey }), [{ role: 'user', content: `用户原文 ${apiKey}` }]) as any).input)).toContain(apiKey);
      expect(Object.keys(requestBody)).not.toContain('Authorization');
      expect(Object.keys(requestBody)).not.toContain('Cookie');
      expect(answer.text).toContain('[example.com](https://example.com/research)');
      expect(answer.text).toContain('[Research guide](https://example.com/guide?page=2&lang=zh#section)');
      expect(answer.text).toContain('[Secret query fields](https://example.com/routed?route=keep&page=2#section)');
      expect(answer.text).toContain('[Duplicate safe routes](https://example.com/duplicates?tag=safe&tag=also-safe#section)');
      expect(answer.responseItems).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function_call', call_id: 'call-1' })]));
      expect(answer.responseItems?.some((item: any) => item.type === 'reasoning')).toBe(false);
    } finally {
      console.log = original.log; console.warn = original.warn; console.error = original.error;
    }
  });

  it('sanitizes the completed canonical items from a real streamed response before replay', async () => {
    const apiKey = 'sk-stream-secret-value';
    const events: string[] = [];
    const prefix = '这是一段长度超过密钥的普通前缀，应当只能稳定向前显示。结论 ';
    const suffix = ' 这是密钥后面足够长的普通内容，用来让流式尾部窗口完整越过密钥位置。';
    const completed = adversarialResponse(apiKey);
    (completed.output[0] as any).content[0].text = prefix + apiKey + suffix;
    const request: typeof fetch = async () => stream(completed, [prefix, apiKey.slice(0, 8), apiKey.slice(8), suffix]);
    const answer = await apiStep(profile({ request, apiKey, stream: true }), [{ role: 'user', content: 'research' }], new AbortController().signal, { onText: text => events.push(text) });
    const replay = apiPayload(profile({ apiKey }), [{ role: 'assistant', content: answer.text, responseItems: answer.responseItems }]) as any;
    for (const surface of [answer.text, JSON.stringify(answer.responseItems), JSON.stringify(events), JSON.stringify(replay.input)]) {
      for (const secret of [apiKey, `Bearer ${apiKey}`, 'provider-cookie', '?api_key=', '#token=']) expect(surface).not.toContain(secret);
    }
    expect(answer.streamed).toBe(true);
    expect(events.join('\n')).not.toContain(apiKey.slice(0, 8));
    for (let index = 1; index < events.length; index++) expect(events[index].startsWith(events[index - 1])).toBe(true);
    expect(answer.text).toContain('[example.com](https://example.com/research)');
    expect(answer.text).toContain('[Research guide](https://example.com/guide?page=2&lang=zh#section)');
    expect(answer.text).toContain('[Secret query fields](https://example.com/routed?route=keep&page=2#section)');
    expect(answer.text).toContain('[Duplicate safe routes](https://example.com/duplicates?tag=safe&tag=also-safe#section)');
  });

  it('never exposes or leaves a persistable secret prefix when a stream later fails', async () => {
    const apiKey = 'provider-' + 'stream-marker-value';
    const deltas = ['结论 ', apiKey.slice(0, 9), apiKey.slice(9), ' 后续普通文字长到足以让保留窗口越过完整密钥，但任何中间帧都不应泄露。'];
    const payload = [
      ...deltas.map(delta => 'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta })),
      'data: ' + JSON.stringify({ type: 'response.failed', response: { error: { code: 'server_error' } } }),
    ].join('\n\n') + '\n\n';
    const request: typeof fetch = async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(payload)); controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
    const events: string[] = [];

    await expect(apiStep(profile({ request, apiKey, stream: true }), [{ role: 'user', content: 'research' }], new AbortController().signal, { onText: text => events.push(text) })).rejects.toThrow('模型流式响应失败');
    const persistedPartial = events.at(-1) || '';
    for (const surface of [...events, persistedPartial]) {
      expect(surface).not.toContain(apiKey);
      expect(surface).not.toContain(apiKey.slice(0, 9));
    }
    for (let index = 1; index < events.length; index++) expect(events[index].startsWith(events[index - 1])).toBe(true);
    expect(persistedPartial).toContain('[凭据已移除]');
  });

  it('removes credential-key fragments and titles from every assistant surface', () => {
    const apiKey = 'sk-metadata-secret-value';
    const credentialFields = ['token', 'code', 'signature', 'sig', 'passwd'] as const;
    for (const field of credentialFields) {
      const answer = parseAnswer({ status: 'completed', output: [{
        type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '结论', annotations: [
          { type: 'url_citation', url: `https://example.com/${field}/fragment?keep=${field}#${field}=opaque-value`, title: `Safe ${field} page` },
          { type: 'url_citation', url: `https://example.com/${field}/title?keep=${field}#section`, title: `${field}=opaque-value` },
        ] }],
      }] }, 'responses', [apiKey]);
      const persisted = JSON.stringify({ role: 'assistant', content: answer.text, responseItems: answer.responseItems });
      const replay = apiPayload(profile({ apiKey }), [{ role: 'assistant', content: answer.text, responseItems: answer.responseItems }]) as any;
      const surfaces = [answer.text, JSON.stringify(answer.responseItems), persisted, JSON.stringify(replay.input)];

      expect(answer.text).toContain(`[Safe ${field} page](https://example.com/${field}/fragment?keep=${field})`);
      expect(answer.text).toContain(`[example.com](https://example.com/${field}/title?keep=${field}#section)`);
      for (const surface of surfaces) {
        expect(surface).not.toContain(`#${field}=`);
        expect(surface).not.toContain(`${field}=opaque-value`);
      }
    }
  });
});
