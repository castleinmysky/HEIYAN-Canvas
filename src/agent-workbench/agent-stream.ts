import type { ToolCall } from './agent-api';
import { awaitAbortable } from './agent-abort';
type Json = Record<string, any>;
export type RawAnswer = { text: string; calls: ToolCall[]; responseItems?: object[]; usage?: Json; streamed: boolean };
const containsSecret = (value: unknown, secrets: readonly string[]) => typeof value === 'string' && secrets.some(secret => secret && value.includes(secret));
const credentialName = /^(?:api[-_]?key|key|token|access[-_]?token|auth(?:orization)?|password|passwd|secret|signature|sig|cookie|session(?:id)?|code)$/i;
const credentialText = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:api[-_ ]?key|key|token|access[-_ ]?token|auth(?:orization)?|password|passwd|secret|signature|sig|cookie|session(?:id)?|code)\s*[:=])/i;
const decoded = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
export function sanitizeProviderText(value: unknown, secrets: readonly string[] = []) {
  let text = typeof value === 'string' ? value : '';
  for (const secret of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)) text = text.split(secret).join('[凭据已移除]');
  return text;
}
function safeCitation(annotation: Json, secrets: readonly string[] = []) {
  const citation = annotation?.type === 'url_citation' ? annotation : annotation?.url_citation;
  if (!citation || typeof citation.url !== 'string') return null;
  try {
    const url = new URL(citation.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (containsSecret(decoded(url.origin + url.pathname), secrets)) return null;
    const query = [...url.searchParams.entries()];
    url.search = '';
    for (const [name, value] of query) {
      if (credentialName.test(name) || containsSecret(decoded(name), secrets) || containsSecret(decoded(value), secrets)) continue;
      url.searchParams.append(name, value);
    }
    const fragment = decoded(url.hash.slice(1));
    if (containsSecret(fragment, secrets) || credentialText.test(fragment)) url.hash = '';
    const rawTitle = typeof citation.title === 'string' ? citation.title.trim().replace(/[\r\n]+/g, ' ').slice(0, 160) : '';
    const title = !rawTitle || containsSecret(rawTitle, secrets) || credentialText.test(rawTitle) ? url.hostname : rawTitle.replace(/[\[\]()]/g, ' ').replace(/\s{2,}/g, ' ');
    return { type: 'url_citation', url: url.href.replace(/\(/g, '%28').replace(/\)/g, '%29'), title };
  } catch { return null; }
}
type SafeCitation = NonNullable<ReturnType<typeof safeCitation>>;
const isSafeCitation = (value: ReturnType<typeof safeCitation>): value is SafeCitation => value !== null;
export function sanitizeResponseItems(items: unknown, secrets: readonly string[] = []): object[] {
  if (!Array.isArray(items)) return [];
  const safe: object[] = [];
  for (const raw of items.slice(0, 100) as Json[]) {
    if (!raw || typeof raw !== 'object') continue;
    if (!raw.type && ['user', 'assistant'].includes(raw.role) && typeof raw.content === 'string') {
      safe.push({ role: raw.role, content: sanitizeProviderText(raw.content, secrets) });
      continue;
    }
    if (raw.type === 'message' && Array.isArray(raw.content)) {
      const content: object[] = [];
      for (const entry of raw.content.slice(0, 100) as Json[]) {
        if (!entry || entry.type !== 'output_text' || typeof entry.text !== 'string') continue;
        const annotations = (Array.isArray(entry.annotations) ? entry.annotations : []).map((annotation: Json) => safeCitation(annotation, secrets)).filter(isSafeCitation);
        content.push({ type: 'output_text', text: sanitizeProviderText(entry.text, secrets), ...(annotations.length ? { annotations } : {}) });
      }
      if (content.length) safe.push({ type: 'message', role: 'assistant', content });
      continue;
    }
    if (raw.type === 'function_call' && typeof raw.call_id === 'string' && typeof raw.name === 'string' && typeof raw.arguments === 'string'
      && !containsSecret(raw.call_id, secrets) && !containsSecret(raw.name, secrets) && !containsSecret(raw.arguments, secrets)) {
      safe.push({ type: 'function_call', call_id: raw.call_id.slice(0, 200), name: raw.name.slice(0, 160), arguments: raw.arguments });
      continue;
    }
    if (raw.type === 'reasoning' && typeof raw.encrypted_content === 'string' && !containsSecret(raw.encrypted_content, secrets)) {
      safe.push({ type: 'reasoning', encrypted_content: raw.encrypted_content });
      continue;
    }
    if (raw.type === 'compaction' && typeof raw.encrypted_content === 'string' && !containsSecret(raw.encrypted_content, secrets)) {
      safe.push({ type: 'compaction', encrypted_content: raw.encrypted_content });
    }
  }
  return safe;
}
function outputText(content: Json) {
  const text = typeof content.text === 'string' ? content.text : '';
  const references = (Array.isArray(content.annotations) ? content.annotations : []).map((annotation: Json) => safeCitation(annotation)).filter(isSafeCitation);
  const unique = [...new Map(references.map(reference => [reference.url, reference])).values()]
    .filter(reference => !text.includes(reference.url)).slice(0, 8);
  return text + (unique.length ? '\n\n参考来源：\n' + unique.map(reference => `- [${reference.title}](${reference.url})`).join('\n') : '');
}
function safeStreamPrefix(text: string, secrets: readonly string[], previous = '', completed = false) {
  const longest = Math.max(0, ...secrets.filter(Boolean).map(secret => secret.length));
  // Replace every complete secret before moving the withholding boundary. If
  // raw text were sliced first, a long benign suffix could move that boundary
  // through a completed secret and briefly expose its distinctive prefix.
  const sanitized = sanitizeProviderText(text, secrets);
  let end = completed || !longest ? sanitized.length : Math.max(0, sanitized.length - longest + 1);
  const marker = '[凭据已移除]';
  for (let at = sanitized.indexOf(marker); at >= 0; at = sanitized.indexOf(marker, at + marker.length)) {
    if (end > at && end < at + marker.length) { end = at + marker.length; break; }
  }
  const candidate = sanitized.slice(0, end);
  // Replacing a long completed secret with a short marker can temporarily move
  // the calculated tail boundary backwards. Streaming UI is cumulative: keep
  // the last safe prefix until the new sanitized candidate extends it.
  return candidate.startsWith(previous) ? candidate : previous;
}
function streamFailure(data: Json) {
  const failure = data.response?.error || data.error || data;
  const labels: Record<string, string> = {
    server_error: '服务端错误', rate_limit_exceeded: '额度或频率受限',
    invalid_api_key: '密钥验证失败', model_not_found: '模型不可用',
    context_length_exceeded: '上下文超过模型限制', unsupported_parameter: '参数不受支持',
    invalid_request_error: '请求参数未被接受', insufficient_quota: '额度不足',
  };
  // Never echo arbitrary upstream messages, which can contain keys or prompts.
  const reason = labels[failure?.code] || labels[failure?.type] || (data.type === 'response.incomplete' ? '回复未完整结束' : '服务未提供可识别的错误类型');
  return new Error(`模型流式响应失败（${reason}）；本轮已停止，未执行本次响应的工具，也不会自动重发。可关闭“逐步显示回复”后手动重试。`);
}
export function parseAnswer(data: Json, protocol: 'responses' | 'chat', secrets: readonly string[] = []): RawAnswer {
  if (data.error || data.status === 'failed' || data.status === 'incomplete') throw Error('模型响应未完成；本次工具不会执行。');
  let text = '', calls: ToolCall[] = [];
  let responseItems: object[] | undefined;
  if (protocol === 'responses') {
    if (!Array.isArray(data.output)) throw Error('服务未返回 Responses 格式，请检查协议。');
    responseItems = sanitizeResponseItems(data.output, secrets);
    for (const item of responseItems as Json[]) {
      if (item.type === 'message') text += (item.content || []).filter((c: Json) => c.type === 'output_text').map(outputText).join('');
      if (item.type === 'function_call') calls.push({ id: item.call_id, name: item.name, arguments: item.arguments });
    }
  } else {
    const choice = data.choices?.[0], m = choice?.message;
    if (!m || !['stop', 'tool_calls', 'function_call', undefined].includes(choice.finish_reason)) throw Error('模型响应未完整结束；本次工具不会执行。');
    if (typeof m.content === 'string') text = sanitizeProviderText(m.content, secrets);
    calls = (m.tool_calls || []).filter((c: Json) => !containsSecret(c.id, secrets) && !containsSecret(c.function?.name, secrets) && !containsSecret(c.function?.arguments, secrets)).map((c: Json) => ({ id: c.id, name: c.function?.name, arguments: c.function?.arguments }));
  }
  if (!text && !calls.length) throw Error('模型没有返回内容或工具调用。');
  if (calls.length > 12 || calls.some(c => !c.id || !c.name || typeof c.arguments !== 'string') || new Set(calls.map(c => c.id)).size !== calls.length) throw Error('模型返回了无效工具调用。');
  return { text, calls, responseItems, usage: data.usage, streamed: false };
}
export async function readAgentResponse(response: Response, protocol: 'responses' | 'chat', onText?: (text: string) => void, signal?: AbortSignal, secrets: readonly string[] = []): Promise<RawAnswer> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await (signal ? awaitAbortable(signal, () => response.json()) : response.json());
    signal?.throwIfAborted();
    const result = parseAnswer(data, protocol, secrets); onText?.(result.text); return result;
  }
  if (!response.body) throw Error('流式响应为空。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', text = '', streamedSafe = '', bytes = 0, terminal = false, completed: Json | undefined, finish: string | undefined, usage: Json | undefined;
  const calls = new Map<number, Json>();
  const event = (block: string) => {
    const raw = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!raw) return;
    if (raw === '[DONE]') { terminal = true; return; }
    const data: Json = JSON.parse(raw);
    if (data.error || ['error', 'response.failed', 'response.incomplete'].includes(data.type)) throw streamFailure(data);
    if (protocol === 'responses') {
      if (data.type === 'response.output_text.delta') { text += data.delta || ''; streamedSafe = safeStreamPrefix(text, secrets, streamedSafe); onText?.(streamedSafe); }
      if (data.type === 'response.completed') { completed = data.response; terminal = true; }
    } else {
      if (data.usage) usage = data.usage;
      const c = data.choices?.find((c: Json) => c.index === 0) || data.choices?.[0];
      if (c?.finish_reason) finish = c.finish_reason;
      if (typeof c?.delta?.content === 'string') { text += c.delta.content; streamedSafe = safeStreamPrefix(text, secrets, streamedSafe); onText?.(streamedSafe); }
      for (const call of c?.delta?.tool_calls || []) {
        if (!Number.isInteger(call.index) || call.index < 0 || call.index > 11) throw Error('流式工具序号无效。');
        const prev = calls.get(call.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (call.id) prev.id = call.id;
        prev.function.name += call.function?.name || ''; prev.function.arguments += call.function?.arguments || '';
        calls.set(call.index, prev);
      }
    }
  };
  try {
    while (true) {
      const chunk = await (signal ? awaitAbortable(signal, () => reader.read()) : reader.read());
      if (chunk.done) { buffer += decoder.decode(); break; }
      bytes += chunk.value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw Error('模型响应过大，已停止读取。');
      buffer += decoder.decode(chunk.value, { stream: true });
      // Normalize only complete CRLF pairs, including pairs split across chunks.
      buffer = buffer.replace(/\r\n/g, '\n');
      let at;
      while (!terminal && (at = buffer.indexOf('\n\n')) >= 0) { event(buffer.slice(0, at)); buffer = buffer.slice(at + 2); }
      // Completion belongs to the protocol, not to the lifetime of the HTTP
      // connection. Some relays keep sending heartbeats after completion.
      if (terminal) break;
    }
    if (!terminal && buffer.trim()) event(buffer.replace(/\r\n/g, '\n'));
    signal?.throwIfAborted();
    if (!terminal || (protocol === 'responses' && !completed) || (protocol === 'chat' && !finish)) throw Error('连接在回复结束前中断；已显示的文字不代表操作成功，本次工具未执行。');
    const result = parseAnswer(protocol === 'responses' ? completed! : { choices: [{ finish_reason: finish, message: { content: text, tool_calls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v) } }], usage }, protocol, secrets);
    onText?.(result.text); return { ...result, streamed: true };
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
