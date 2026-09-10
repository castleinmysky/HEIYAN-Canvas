import { agentInstructions, contextInstructions, agentTools } from '../../server/agent-contract.js';
import { contextLimits, estimateTokens, messageTokens } from './agent-context';
import { readAgentResponse } from './agent-stream';
import { awaitAbortable } from './agent-abort';
export type ApiProfile = {
  request?: typeof fetch;
  provider: 'official' | 'custom'; baseUrl: string; apiKey: string; model: string; protocol: 'responses' | 'chat'; vision: boolean; effort: string; contextChars: number;
  contextTokens?: number; outputTokens?: number; stream?: boolean; strict?: boolean; nativeCompaction?: boolean; countTokens?: boolean;
  helperModel?: string; embeddingModel?: string; tokenBudget?: number; callLimit?: number;
  prices?: { input?: number; output?: number; cached?: number; helperInput?: number; helperOutput?: number };
};
export type ToolCall = { id: string; name: string; arguments: string };
export type ApiMessage = { role: 'user' | 'assistant' | 'tool'; content: string; images?: string[]; toolCalls?: ToolCall[]; callId?: string; responseItems?: object[] };
export type Capability = { key: string; label: string; status: 'passed' | 'unavailable' | 'untested'; detail: string };
export type UsageRecord = { id: string; model: string; kind: string; input: number; output: number; cached: number; source: 'reported' | 'estimated'; usd?: number; at: number };
export function apiEndpoint(profile: Pick<ApiProfile, 'provider' | 'baseUrl' | 'protocol'>, resource?: string) {
  const url = new URL(profile.provider === 'official' ? 'https://api.openai.com/v1' : profile.baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('请输入不含密钥的 HTTPS API 地址');
  url.pathname = url.pathname.replace(/\/$/, '').replace(/\/(responses(?:\/(?:compact|input_tokens))?|chat\/completions|embeddings)$/, '') + '/' + (resource || (profile.protocol === 'responses' ? 'responses' : 'chat/completions'));
  return url.href;
}
const toolSpecs = agentTools as Array<{ name: string; description: string; inputSchema: object }>;
export function strictSchema(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (!value.type && value.enum?.length) value = { ...value, type: typeof value.enum[0] };
  if (value.type === 'object') {
    const required = new Set(value.required || []);
    const properties = Object.fromEntries(Object.entries(value.properties || {}).map(([key, v]) => {
      const next = strictSchema(v);
      return [key, required.has(key) ? next : { ...next, type: [...new Set([...(Array.isArray(next.type) ? next.type : [next.type]), 'null'])], ...(next.enum ? { enum: [...next.enum, null] } : {}) }];
    }));
    return { ...value, properties, additionalProperties: false, required: Object.keys(properties) };
  }
  return { ...value, ...(value.items ? { items: strictSchema(value.items) } : {}) };
}
export function validateApiProfile(profile: ApiProfile) {
  apiEndpoint(profile);
  const window = profile.contextTokens || 48000, output = profile.outputTokens || 4096;
  if (!Number.isInteger(window) || window < 8000 || window > 2000000 || !Number.isInteger(output) || output < 512 || output > window / 3) throw Error('请填写有效的上下文上限与输出预留，输出不超过上下文的三分之一。');
  if (!Number.isInteger(profile.tokenBudget || 250000) || (profile.tokenBudget || 250000) < 10000 || (profile.tokenBudget || 250000) > 10000000 || !Number.isInteger(profile.callLimit || 24) || (profile.callLimit || 24) < 1 || (profile.callLimit || 24) > 48) throw Error('请检查本轮 token 预算与模型调用上限。');
  if (Object.values(profile.prices || {}).some(v => v !== undefined && (!Number.isFinite(v) || v < 0))) throw Error('单价需要填写非负数字。');
}
export function omitNullArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNullArguments);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, omitNullArguments(v)]));
  return value;
}
export function apiPayload(profile: ApiProfile, messages: ApiMessage[], instructions = agentInstructions + contextInstructions, tools = true) {
  const common = { model: profile.model, stream: profile.stream === true };
  const specs = toolSpecs.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: profile.strict ? strictSchema(t.inputSchema) : t.inputSchema, strict: !!profile.strict }));
  if (profile.protocol === 'responses') {
    const input: object[] = [];
    for (const m of messages) {
      if (m.role === 'assistant' && m.responseItems?.length) { input.push(...m.responseItems.filter((item: any) => item.type !== 'reasoning' || item.encrypted_content)); continue; }
      if (m.role === 'tool') {
        input.push({ type: 'function_call_output', call_id: m.callId, output: m.content });
        if (m.images?.length) input.push({ role: 'user', content: [{ type: 'input_text', text: '已批准读取的画布图片，与上一条工具结果对应。' }, ...m.images.map(image_url => ({ type: 'input_image', image_url }))] });
      } else {
        if (m.content || m.images?.length) input.push({ role: m.role, content: m.role === 'user' ? [{ type: 'input_text', text: m.content }, ...(m.images || []).map(image_url => ({ type: 'input_image', image_url }))] : [{ type: 'output_text', text: m.content }] });
        for (const call of m.toolCalls || []) input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments });
      }
    }
    return { ...common, instructions, input, store: false, max_output_tokens: contextLimits(profile).output,
      ...(profile.provider === 'official' ? { include: ['reasoning.encrypted_content'] } : {}),
      ...(profile.effort ? { reasoning: { effort: profile.effort } } : {}), ...(tools ? { parallel_tool_calls: true, tools: specs } : {}) };
  }
  const history: object[] = [{ role: 'system', content: instructions }];
  for (const m of messages) {
    if (m.role === 'tool') {
      history.push({ role: 'tool', tool_call_id: m.callId, content: m.content });
      if (m.images?.length) history.push({ role: 'user', content: [{ type: 'text', text: '已批准读取的画布图片。' }, ...m.images.map(url => ({ type: 'image_url', image_url: { url } }))] });
    } else history.push({ role: m.role, content: m.images?.length ? [{ type: 'text', text: m.content }, ...m.images.map(url => ({ type: 'image_url', image_url: { url } }))] : m.content || null,
      ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}) });
  }
  return { ...common, messages: history, max_completion_tokens: contextLimits(profile).output, ...(profile.stream ? { stream_options: { include_usage: true } } : {}),
    ...(profile.effort ? { reasoning_effort: profile.effort } : {}), ...(tools ? { parallel_tool_calls: true, tools: specs.map(({ type, ...fn }) => ({ type, function: fn })) } : {}) };
}
export class ApiHttpError extends Error { constructor(public status: number) { super(({ 401: '密钥未通过验证', 403: '当前服务拒绝访问此模型', 404: '模型或接口不存在', 429: '额度或请求频率达到上限' } as Record<number, string>)[status] || `API 请求失败（${status}），请检查模型、参数与协议`); } }
export async function apiTransport(profile: Pick<ApiProfile, 'provider' | 'baseUrl' | 'protocol' | 'apiKey' | 'request'>, body: object, signal: AbortSignal, resource?: string) {
  if (!profile.apiKey.trim()) throw Error('请填写 API 密钥');
  const response = await awaitAbortable(signal, async () => {
    const value = await (profile.request || fetch)('/api/v1/agent/cloud/request', { method: 'POST', credentials: 'same-origin', signal,
      headers: { 'Content-Type': 'application/json', 'x-heiyan-cloud': '1', 'x-heiyan-method': 'POST', 'x-heiyan-upstream': apiEndpoint(profile, resource), 'x-heiyan-api-authorization': 'Bearer ' + profile.apiKey.trim() }, body: JSON.stringify(body) });
    if (signal.aborted) { void value.body?.cancel().catch(() => {}); signal.throwIfAborted(); }
    return value;
  });
  if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new ApiHttpError(response.status); }
  return response;
}
export function usageRecord(profile: ApiProfile, usage: any, messages: ApiMessage[], text: string, kind = '对话'): UsageRecord {
  const incoming = usage?.input_tokens ?? usage?.prompt_tokens;
  const outgoing = usage?.output_tokens ?? usage?.completion_tokens;
  const reported = Number.isFinite(incoming) && Number.isFinite(outgoing);
  const input = reported ? Math.max(0, incoming) : messageTokens(messages, agentInstructions + contextInstructions + JSON.stringify(agentTools));
  const output = reported ? Math.max(0, outgoing) : estimateTokens(text);
  const cached = reported ? Math.min(input, Math.max(0, usage?.input_tokens_details?.cached_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? 0)) : 0;
  const p = profile.prices;
  const usd = p?.input !== undefined && p?.output !== undefined ? ((input - cached) * p.input + cached * (p.cached ?? p.input) + output * p.output) / 1e6 : undefined;
  return { id: crypto.randomUUID(), model: profile.model, kind, input, output, cached, source: reported ? 'reported' : 'estimated', usd, at: Date.now() };
}
export async function apiStep(profile: ApiProfile, messages: ApiMessage[], signal: AbortSignal, options?: { instructions?: string; tools?: boolean; onText?: (text: string) => void }) {
  if (!profile.model.trim()) throw Error('请填写模型名称');
  const timed = AbortSignal.any([signal, AbortSignal.timeout(180000)]);
  const response = await apiTransport(profile, apiPayload(profile, messages, options?.instructions, options?.tools), timed);
  return readAgentResponse(response, profile.protocol, options?.onText, timed);
}
export async function countApiTokens(profile: ApiProfile, messages: ApiMessage[], signal: AbortSignal) {
  const payload = apiPayload(profile, messages) as { model: string; input?: object[]; instructions?: string; tools?: object[] };
  const response = await apiTransport(profile, { model: payload.model, input: payload.input, instructions: payload.instructions, tools: payload.tools }, AbortSignal.any([signal, AbortSignal.timeout(25000)]), 'responses/input_tokens');
  const data = await response.json();
  if (!Number.isSafeInteger(data.input_tokens) || data.input_tokens < 0) throw Error('接口没有返回有效的 token 计数。');
  return data.input_tokens as number;
}
export async function compactApi(profile: ApiProfile, messages: ApiMessage[], signal: AbortSignal) {
  const payload = apiPayload(profile, messages) as { input?: object[]; instructions?: string };
  const response = await apiTransport(profile, { model: profile.model, input: payload.input, instructions: payload.instructions }, AbortSignal.any([signal, AbortSignal.timeout(180000)]), 'responses/compact');
  const data = await response.json();
  if (!Array.isArray(data.output) || !data.output.some((item: any) => item.type === 'compaction' && typeof item.encrypted_content === 'string')) throw Error('该接口未返回可继续使用的原生压缩结果。');
  // The ENTIRE canonical compacted window must be replayed, not just its opaque item.
  return { message: { role: 'assistant', content: '', responseItems: data.output } as ApiMessage, usage: data.usage };
}
export function helperProfile(profile: ApiProfile): ApiProfile {
  return profile.helperModel ? { ...profile, model: profile.helperModel, effort: '', strict: false, stream: false, outputTokens: 2048,
    prices: { input: profile.prices?.helperInput, output: profile.prices?.helperOutput } } : { ...profile, stream: false, outputTokens: 2048 };
}
