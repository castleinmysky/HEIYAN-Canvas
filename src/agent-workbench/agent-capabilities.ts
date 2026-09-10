import { apiStep, compactApi, countApiTokens, helperProfile, omitNullArguments, usageRecord, validateApiProfile, ApiHttpError, type ApiProfile, type Capability, type UsageRecord } from './agent-api';
import { validateAgentTool } from '../../server/agent-contract.js';
import { embedTexts } from './agent-search';
import { awaitAbortable } from './agent-abort';

export type ProbeProgress = { label: string; startedAt: number; timeoutMs: number; optional: boolean };
export const PROBE_LIMITS = { total: 120000, required: 45000, optional: 20000 } as const;
export async function probeApi(profile: ApiProfile, signal: AbortSignal, report: (capability: Capability) => void, record?: (usage: UsageRecord) => void, progress?: (value: ProbeProgress) => void) {
  validateApiProfile(profile);
  const deadline = Date.now() + PROBE_LIMITS.total;
  const tested: ApiProfile = { ...profile, vision: false, helperModel: '', embeddingModel: '', stream: false, strict: false, nativeCompaction: false, countTokens: false };
  const row = (key: string, label: string, status: Capability['status'], detail: string) => report({ key, label, status, detail });
  const stage = async <T,>(label: string, optional: boolean, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    const timeoutMs = Math.min(optional ? PROBE_LIMITS.optional : PROBE_LIMITS.required, deadline - Date.now());
    if (timeoutMs <= 0) throw Error('连接检测已达 2 分钟，未继续发送检测请求');
    const abort = new AbortController(), active = AbortSignal.any([signal, abort.signal]);
    const timer = setTimeout(() => abort.abort(Error(`${label}检测超时（${Math.ceil(timeoutMs / 1000)} 秒），未自动重试`)), timeoutMs);
    progress?.({ label, optional, startedAt: Date.now(), timeoutMs });
    try { return await awaitAbortable(active, () => work(active)); }
    finally { clearTimeout(timer); }
  };
  const required = async <T,>(label: string, work: (signal: AbortSignal) => Promise<T>) => {
    try { return await stage(label, false, work); }
    catch (e) {
      if (!signal.aborted) row('tools', '工具调用与结果回传', 'unavailable', e instanceof Error ? e.message : '基础检测未完成');
      throw e;
    }
  };
  const messages = [{ role: 'user' as const, content: '连接检测：请调用 heiyan_read_canvas，参数 {}。这是空画布测试，不执行修改。' }];
  const first = await required('工具调用（1/2）', active => apiStep(tested, messages, active));
  record?.(usageRecord(tested, first.usage, messages, first.text, '连接检测'));
  if (first.calls.length !== 1 || first.calls[0].name !== 'heiyan_read_canvas') throw Error('模型未通过工具调用检测，请选择支持工具调用的模型或协议。');
  validateAgentTool(first.calls[0].name, omitNullArguments(JSON.parse(first.calls[0].arguments)));
  const history = [...messages, { role: 'assistant' as const, content: first.text, toolCalls: first.calls, responseItems: first.responseItems },
    { role: 'tool' as const, callId: first.calls[0].id, content: JSON.stringify({ revision: 'probe', nodes: [], edges: [], referenceIds: [] }) }];
  const second = await required('工具结果回传（2/2）', active => apiStep(tested, history, active, { instructions: '只回答“连接成功”。', tools: false }));
  record?.(usageRecord(tested, second.usage, history, second.text, '连接检测'));
  row('tools', '工具调用与结果回传', 'passed', '两次请求已完成往返检测');
  row('effort', '思考参数', profile.effort ? 'passed' : 'untested', profile.effort ? `接口接受 ${profile.effort}；内部是否按该强度执行无法验证` : '使用模型默认值');
  const optional = async (key: string, label: string, run: (signal: AbortSignal) => Promise<void>) => {
    signal.throwIfAborted();
    try { await stage(label, true, run); }
    catch (e) {
      if (signal.aborted) throw e;
      const fallback = ({ strict: '已使用画布本地参数校验', count: '已使用保守估算', compact: '已使用项目摘要', stream: '已使用完整回复，不启用流式' } as Record<string, string>)[key];
      const reason = e instanceof ApiHttpError ? `检测接口返回 HTTP ${e.status}${e.status === 524 ? '（上游响应超时）' : ''}` : e instanceof Error ? e.message : '本次检测未通过';
      row(key, label, 'unavailable', fallback ? `${fallback}；${reason}` : reason);
    }
  };
  await optional('strict', '工具参数约束', async signal => {
    const result = await apiStep({ ...tested, strict: true, stream: false }, messages, signal);
    record?.(usageRecord(tested, result.usage, messages, result.text, '连接检测'));
    if (result.calls.length !== 1 || result.calls[0].name !== 'heiyan_read_canvas') throw Error('严格参数检测未通过，继续使用本地校验。');
    const args = JSON.parse(result.calls[0].arguments);
    if (!['nodeIds', 'query', 'offset', 'promptOffset'].every(key => Object.hasOwn(args, key))) throw Error('接口没有遵循严格格式，继续使用本地校验。');
    validateAgentTool(result.calls[0].name, omitNullArguments(JSON.parse(result.calls[0].arguments)));
    tested.strict = true; row('strict', '工具参数约束', 'passed', '接口接受严格格式，画布仍逐项校验实际操作');
  });
  if (profile.vision) await optional('vision', '图片理解样例', async signal => {
    tested.vision = false;
    const colors = [{ name: '红色', css: '#ed2525' }, { name: '蓝色', css: '#164df5' }, { name: '绿色', css: '#15ac3b' }];
    const color = colors[crypto.getRandomValues(new Uint8Array(1))[0] % colors.length];
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const context = canvas.getContext('2d'); if (!context) throw Error('无法准备图片检测。');
    context.fillStyle = color.css; context.fillRect(0, 0, 128, 128);
    const input = [{ role: 'user' as const, content: '观察附图，只用中文回答主色名称。', images: [canvas.toDataURL('image/png')] }];
    const result = await apiStep(tested, input, signal, { tools: false });
    record?.(usageRecord(tested, result.usage, input, result.text, '图片检测'));
    if (!result.text.includes(color.name)) throw Error('图片样例未识别正确，暂未启用图片输入。');
    tested.vision = true; row('vision', '图片理解样例', 'passed', '已识别实际发送的测试图片；具体素材仍需检查结果');
  });
  else { tested.vision = false; row('vision', '图片理解样例', 'untested', '未启用图片输入'); }
  if (profile.protocol === 'responses') {
    await optional('count', '输入 token 计数', async signal => { await awaitAbortable(signal, () => countApiTokens(tested, messages, signal)); tested.countTokens = true; row('count', '输入 token 计数', 'passed', '发出请求前可读取服务端计数'); });
    if (profile.nativeCompaction !== false) await optional('compact', '原生上下文压缩', async signal => {
      const compacted = await awaitAbortable(signal, () => compactApi(tested, history, signal));
      const result = await apiStep({ ...tested, stream: false }, [compacted.message, { role: 'user', content: '只回答“恢复成功”。' }], signal, { tools: false });
      record?.(usageRecord(tested, compacted.usage, history, '', '压缩检测'));
      record?.(usageRecord(tested, result.usage, [], result.text, '压缩检测'));
      tested.nativeCompaction = true; row('compact', '原生上下文压缩', 'passed', '已压缩并使用返回内容继续对话');
    });
    else row('compact', '原生上下文压缩', 'untested', '按设置使用项目摘要');
  } else { row('count', '输入 token 计数', 'untested', 'Chat 协议使用保守估算'); row('compact', '原生上下文压缩', 'untested', 'Chat 协议使用项目摘要'); }
  if (profile.helperModel) await optional('helper', '辅助模型', async signal => {
    tested.helperModel = '';
    const p = helperProfile(profile), result = await apiStep(p, [{ role: 'user', content: '只回答“就绪”。' }], signal, { tools: false });
    record?.(usageRecord(p, result.usage, [], result.text, '辅助模型检测'));
    tested.helperModel = profile.helperModel; row('helper', '辅助模型', 'passed', '仅用于整理文字摘要，关键判断仍由主模型完成');
  });
  if (profile.embeddingModel) await optional('embedding', '语义检索模型', async signal => {
    tested.embeddingModel = '';
    await awaitAbortable(signal, () => embedTexts({ ...profile, model: profile.embeddingModel! }, ['红衣角色参考', '天气情况'], signal));
    tested.embeddingModel = profile.embeddingModel; row('embedding', '语义检索模型', 'passed', '向量接口可用；建立索引后启用语义检索');
  });
  // Probe the same tool + strict-argument combination that conversations use.
  // Keep all optional capability checks non-streaming until this round trip succeeds.
  if (profile.stream === false) row('stream', '流式回复', 'untested', '按设置使用完整回复');
  else await optional('stream', '流式回复', async signal => {
    const streamed = { ...tested, stream: true };
    const result = await apiStep(streamed, messages, signal);
    record?.(usageRecord(tested, result.usage, messages, result.text, '流式工具检测'));
    if (!result.streamed) throw Error('服务返回完整 JSON，而非流式响应');
    if (result.calls.length !== 1 || result.calls[0].name !== 'heiyan_read_canvas') throw Error('流式响应没有返回所需工具调用');
    validateAgentTool(result.calls[0].name, omitNullArguments(JSON.parse(result.calls[0].arguments)));
    const streamedHistory = [...messages, { role: 'assistant' as const, content: result.text, toolCalls: result.calls, responseItems: result.responseItems },
      { role: 'tool' as const, callId: result.calls[0].id, content: JSON.stringify({ revision: 'probe', nodes: [], edges: [], referenceIds: [] }) }];
    const reply = await apiStep(streamed, streamedHistory, signal, { instructions: '只回答“连接成功”。', tools: false });
    record?.(usageRecord(tested, reply.usage, streamedHistory, reply.text, '流式工具检测'));
    if (!reply.streamed || !reply.text.trim()) throw Error('流式工具结果回传未完成');
    tested.stream = true;
    row('stream', '流式回复', 'passed', '流式工具调用与结果回传已完成，已启用逐步显示');
  });
  return tested;
}
