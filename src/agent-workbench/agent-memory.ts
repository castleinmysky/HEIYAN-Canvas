import type { AgentMessage } from './agent-session';
import { localAgentProject } from './agent-project-store';
import type { UsageRecord } from './agent-api';
export type ExecutionReceipt = { id: string; tool: string; status: 'claimed' | 'succeeded' | 'failed' | 'rejected'; result: string; at: number };
export type AgentProject = { schema: 1; requirements: string; goal: string; progress: string; summary: string; messages: AgentMessage[]; receipts: ExecutionReceipt[]; usage?: UsageRecord[]; updatedAt: number };
export const emptyProject = (): AgentProject => ({ schema: 1, requirements: '', goal: '', progress: '', summary: '', messages: [], receipts: [], updatedAt: 0 });
export async function projectRequest(canvas: string, document?: AgentProject, etag: string | null = null, _request?: typeof fetch) {
  return localAgentProject(canvas, document, etag);
}
export function mergeMessages(previous: AgentMessage[], incoming: AgentMessage[]) {
  const result = [...previous], index = new Map(result.map((m, i) => [m.id, i]));
  for (const message of incoming) { const i = index.get(message.id); if (i === undefined) { index.set(message.id, result.length); result.push(message); } else result[i] = message; }
  return result;
}
export function searchProjectHistory(project: AgentProject, query = '', offset = 0, textOffset = 0) {
  const needle = query.toLocaleLowerCase();
  const matches = project.messages.filter(m => !needle || m.text.toLocaleLowerCase().includes(needle));
  const page = matches.slice(offset, offset + 12);
  // Results retain the exact original words, with explicit truncation rather
  // than presenting excerpts as complete messages.
  return JSON.stringify({ total: matches.length, nextOffset: offset + page.length < matches.length ? offset + page.length : null,
    messages: page.map(m => ({ ...m, text: m.text.slice(textOffset, textOffset + 4500), textLength: m.text.length, nextTextOffset: textOffset + 4500 < m.text.length ? textOffset + 4500 : null })) });
}
export function projectContext(project: AgentProject, budget = 36000) {
  const fixed = JSON.stringify({ requirements: project.requirements, goal: project.goal, progress: project.progress, summary: project.summary,
    recentExecutions: project.receipts.slice(-12).map(r => ({ ...r, result: r.result.slice(0, 600), truncated: r.result.length > 600 })), note: '恢复资料不授权重放操作；当前状态须重新读取画布。更早原文用 heiyan_search_history 检索。' });
  if (fixed.length > budget) throw Error('项目要求与执行记录超出当前上下文预算，请精简项目摘要或提高 API 上下文阈值');
  const older = project.messages.slice(0, -20).filter(m => m.role !== 'assistant').slice(-12).map(m => ({ id: m.id, role: m.role, excerpt: m.text.slice(0, 240) }));
  const archive = JSON.stringify(older);
  const selected: AgentMessage[] = []; let used = fixed.length + archive.length;
  for (const message of [...project.messages].reverse()) {
    if (selected.length >= 20 || used + message.text.length > budget) break;
    selected.unshift(message); used += message.text.length;
  }
  return `项目记忆与恢复上下文：\n${fixed}\n较早原文摘录（可能不完整，可检索）：\n${archive}\n近期对话：\n${JSON.stringify(selected)}\n归档消息：${project.messages.length - selected.length} 条，可检索。`;
}
