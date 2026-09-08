import type { ApiMessage, ApiProfile } from './agent-api';
import type { AgentProject } from './agent-memory';

// A conservative fallback, never presented as a tokenizer measurement. Provider
// input-token counts and returned usage supersede it when available.
export function estimateTokens(text: string) {
  const nonAscii = text.match(/[^\x00-\x7f]/gu)?.length || 0;
  return Math.ceil((text.length - nonAscii) / 3 + nonAscii * 1.5);
}
export function contextLimits(profile: ApiProfile) {
  const window = Math.floor(profile.contextTokens || Math.max(16000, profile.contextChars || 48000));
  const output = Math.min(Math.floor(profile.outputTokens || 4096), Math.floor(window / 3));
  const margin = Math.max(1024, Math.ceil(window * .1));
  return { window, output, input: window - output - margin, margin };
}
export function messageTokens(messages: ApiMessage[], instructions = '') {
  return estimateTokens(instructions) + messages.reduce((sum, m) => sum + 12 + estimateTokens(m.content)
    + estimateTokens(JSON.stringify(m.toolCalls || [])) + estimateTokens(JSON.stringify(m.responseItems || []).replace(/data:image\/[^\"]+/g, '[image]'))
    + (m.images?.length || 0) * 4096, 0);
}
export function clipTokens(text: string, budget: number) {
  if (estimateTokens(text) <= budget) return text;
  let low = 0, high = text.length;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (estimateTokens(text.slice(0, mid)) <= budget - 30) low = mid; else high = mid - 1; }
  return text.slice(0, low) + '\n[节选，完整原文可检索]';
}
export function buildProjectContext(project: AgentProject, budget: number, task = '', retrieved = '') {
  const protectedText = JSON.stringify({ currentRequest: task, goal: project.goal, requirements: project.requirements, progress: project.progress,
    note: '明确要求与当前请求优先。摘要只是恢复资料；结果未知的操作先核实，不得重放。查询原文可用 heiyan_search_history。' });
  if (estimateTokens(protectedText) + 100 > budget) throw Error('当前目标、明确要求与待办已超过上下文预算。请提高模型上下文上限，或手动精简项目记忆；要求未被截断。');
  let result = `固定要求与任务：\n${protectedText}`;
  const add = (title: string, text: string, share: number) => {
    const remaining = budget - estimateTokens(result) - 40;
    if (remaining < 100 || !text) return;
    result += `\n${title}：\n` + clipTokens(text, Math.min(remaining, Math.floor(budget * share)));
  };
  add('最近执行状态', JSON.stringify(project.receipts.slice(-8).map(r => ({ id: r.id, tool: r.tool, status: r.status, result: r.result.slice(0, 350) }))), .18);
  add('相关原文与节点', retrieved, .25);
  add('项目摘要（可回查）', project.summary, .2);
  const recent: typeof project.messages = [];
  for (const m of [...project.messages].reverse()) {
    if (recent.length >= 16) break;
    if (estimateTokens(result + JSON.stringify([...recent, m])) + 80 > budget) continue;
    recent.unshift(m);
  }
  result += `\n近期原文：\n${JSON.stringify(recent)}\n另有 ${project.messages.length - recent.length} 条原文可检索。`;
  return result;
}
