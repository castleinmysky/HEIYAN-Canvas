import { apiStep, compactApi, countApiTokens, helperProfile, omitNullArguments, usageRecord, validateApiProfile, type ApiProfile, type Capability, type UsageRecord } from './agent-api';
import { validateAgentTool } from '../../server/agent-contract.js';
import { embedTexts } from './agent-search';

export async function probeApi(profile: ApiProfile, signal: AbortSignal, report: (capability: Capability) => void, record?: (usage: UsageRecord) => void) {
  validateApiProfile(profile);
  const tested: ApiProfile = { ...profile, stream: false, strict: false, nativeCompaction: false, countTokens: false };
  const row = (key: string, label: string, status: Capability['status'], detail: string) => report({ key, label, status, detail });
  const messages = [{ role: 'user' as const, content: '连接检测：请调用 heiyan_read_canvas，参数 {}。这是空画布测试，不执行修改。' }];
  const first = await apiStep(tested, messages, signal);
  record?.(usageRecord(tested, first.usage, messages, first.text, '连接检测'));
  if (first.calls.length !== 1 || first.calls[0].name !== 'heiyan_read_canvas') throw Error('模型未通过工具调用检测，请选择支持工具调用的模型或协议。');
  validateAgentTool(first.calls[0].name, omitNullArguments(JSON.parse(first.calls[0].arguments)));
  const history = [...messages, { role: 'assistant' as const, content: first.text, toolCalls: first.calls, responseItems: first.responseItems },
    { role: 'tool' as const, callId: first.calls[0].id, content: JSON.stringify({ revision: 'probe', nodes: [], edges: [], referenceIds: [] }) }];
  const second = await apiStep(tested, history, signal, { instructions: '只回答“连接成功”。', tools: false });
  record?.(usageRecord(tested, second.usage, history, second.text, '连接检测'));
  row('tools', '工具调用与结果回传', 'passed', '两次请求已完成往返检测');
  row('effort', '思考参数', profile.effort ? 'passed' : 'untested', profile.effort ? `接口接受 ${profile.effort}；内部是否按该强度执行无法验证` : '使用模型默认值');
  const optional = async (key: string, label: string, run: () => Promise<void>) => {
    if (signal.aborted) throw Error('连接检测已停止');
    try { await run(); }
    catch (e) { if (signal.aborted) throw e; row(key, label, 'unavailable', e instanceof Error ? e.message : '本次检测未通过'); }
  };
  await optional('stream', '流式回复', async () => {
    const result = await apiStep({ ...tested, stream: true }, [{ role: 'user', content: '只回答“就绪”。' }], signal, { tools: false });
    record?.(usageRecord(tested, result.usage, [], result.text, '连接检测'));
    tested.stream = result.streamed && profile.stream !== false;
    row('stream', '流式回复', result.streamed ? 'passed' : 'unavailable', result.streamed ? (tested.stream ? '已启用逐步显示' : '检测通过，按设置使用完整回复') : '服务返回完整 JSON，已采用兼容模式');
  });
  await optional('strict', '工具参数约束', async () => {
    const result = await apiStep({ ...tested, strict: true, stream: false }, messages, signal);
    record?.(usageRecord(tested, result.usage, messages, result.text, '连接检测'));
    if (result.calls.length !== 1 || result.calls[0].name !== 'heiyan_read_canvas') throw Error('严格参数检测未通过，继续使用本地校验。');
    const args = JSON.parse(result.calls[0].arguments);
    if (!['nodeIds', 'query', 'offset', 'promptOffset'].every(key => Object.hasOwn(args, key))) throw Error('接口没有遵循严格格式，继续使用本地校验。');
    validateAgentTool(result.calls[0].name, omitNullArguments(JSON.parse(result.calls[0].arguments)));
    tested.strict = true; row('strict', '工具参数约束', 'passed', '接口接受严格格式，画布仍逐项校验实际操作');
  });
  if (profile.vision) await optional('vision', '图片理解样例', async () => {
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
    await optional('count', '输入 token 计数', async () => { await countApiTokens(tested, messages, signal); tested.countTokens = true; row('count', '输入 token 计数', 'passed', '发出请求前可读取服务端计数'); });
    if (profile.nativeCompaction !== false) await optional('compact', '原生上下文压缩', async () => {
      const compacted = await compactApi(tested, history, signal);
      const result = await apiStep({ ...tested, stream: false }, [compacted.message, { role: 'user', content: '只回答“恢复成功”。' }], signal, { tools: false });
      record?.(usageRecord(tested, compacted.usage, history, '', '压缩检测'));
      record?.(usageRecord(tested, result.usage, [], result.text, '压缩检测'));
      tested.nativeCompaction = true; row('compact', '原生上下文压缩', 'passed', '已压缩并使用返回内容继续对话');
    });
    else row('compact', '原生上下文压缩', 'untested', '按设置使用项目摘要');
  } else { row('count', '输入 token 计数', 'untested', 'Chat 协议使用保守估算'); row('compact', '原生上下文压缩', 'untested', 'Chat 协议使用项目摘要'); }
  if (profile.helperModel) await optional('helper', '辅助模型', async () => {
    tested.helperModel = '';
    const p = helperProfile(profile), result = await apiStep(p, [{ role: 'user', content: '只回答“就绪”。' }], signal, { tools: false });
    record?.(usageRecord(p, result.usage, [], result.text, '辅助模型检测'));
    tested.helperModel = profile.helperModel; row('helper', '辅助模型', 'passed', '仅用于整理文字摘要，关键判断仍由主模型完成');
  });
  if (profile.embeddingModel) await optional('embedding', '语义检索模型', async () => {
    tested.embeddingModel = '';
    await embedTexts({ ...profile, model: profile.embeddingModel! }, ['红衣角色参考', '天气情况'], signal);
    tested.embeddingModel = profile.embeddingModel; row('embedding', '语义检索模型', 'passed', '向量接口可用；建立索引后启用语义检索');
  });
  return tested;
}
