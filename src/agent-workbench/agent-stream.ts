import type { ToolCall } from './agent-api';
import { awaitAbortable } from './agent-abort';
type Json = Record<string, any>;
export type RawAnswer = { text: string; calls: ToolCall[]; responseItems?: object[]; usage?: Json; streamed: boolean };
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
export function parseAnswer(data: Json, protocol: 'responses' | 'chat'): RawAnswer {
  if (data.error || data.status === 'failed' || data.status === 'incomplete') throw Error('模型响应未完成；本次工具不会执行。');
  let text = '', calls: ToolCall[] = [];
  if (protocol === 'responses') {
    if (!Array.isArray(data.output)) throw Error('服务未返回 Responses 格式，请检查协议。');
    for (const item of data.output) {
      if (item.type === 'message') text += (item.content || []).filter((c: Json) => c.type === 'output_text').map((c: Json) => c.text).join('');
      if (item.type === 'function_call') calls.push({ id: item.call_id, name: item.name, arguments: item.arguments });
    }
  } else {
    const choice = data.choices?.[0], m = choice?.message;
    if (!m || !['stop', 'tool_calls', 'function_call', undefined].includes(choice.finish_reason)) throw Error('模型响应未完整结束；本次工具不会执行。');
    if (typeof m.content === 'string') text = m.content;
    calls = (m.tool_calls || []).map((c: Json) => ({ id: c.id, name: c.function?.name, arguments: c.function?.arguments }));
  }
  if (!text && !calls.length) throw Error('模型没有返回内容或工具调用。');
  if (calls.length > 12 || calls.some(c => !c.id || !c.name || typeof c.arguments !== 'string') || new Set(calls.map(c => c.id)).size !== calls.length) throw Error('模型返回了无效工具调用。');
  return { text, calls, responseItems: protocol === 'responses' ? data.output : undefined, usage: data.usage, streamed: false };
}
export async function readAgentResponse(response: Response, protocol: 'responses' | 'chat', onText?: (text: string) => void, signal?: AbortSignal): Promise<RawAnswer> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await (signal ? awaitAbortable(signal, () => response.json()) : response.json());
    signal?.throwIfAborted();
    const result = parseAnswer(data, protocol); onText?.(result.text); return result;
  }
  if (!response.body) throw Error('流式响应为空。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', text = '', bytes = 0, terminal = false, completed: Json | undefined, finish: string | undefined, usage: Json | undefined;
  const calls = new Map<number, Json>();
  const event = (block: string) => {
    const raw = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!raw) return;
    if (raw === '[DONE]') { terminal = true; return; }
    const data: Json = JSON.parse(raw);
    if (data.error || ['error', 'response.failed', 'response.incomplete'].includes(data.type)) throw streamFailure(data);
    if (protocol === 'responses') {
      if (data.type === 'response.output_text.delta') { text += data.delta || ''; onText?.(text); }
      if (data.type === 'response.completed') { completed = data.response; terminal = true; }
    } else {
      if (data.usage) usage = data.usage;
      const c = data.choices?.find((c: Json) => c.index === 0) || data.choices?.[0];
      if (c?.finish_reason) finish = c.finish_reason;
      if (typeof c?.delta?.content === 'string') { text += c.delta.content; onText?.(text); }
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
    const result = parseAnswer(protocol === 'responses' ? completed! : { choices: [{ finish_reason: finish, message: { content: text, tool_calls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v) } }], usage }, protocol);
    onText?.(result.text); return { ...result, streamed: true };
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
