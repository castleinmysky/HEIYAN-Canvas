import type { AgentMessage, AgentState } from './agent-session';
import type { AgentActivity } from './agent-runner';
import { mayAutoApproveAgentProposal, type AgentApprovalMode } from './approval-mode';

export type BotPose = 'idle' | 'processing' | 'thinking' | 'reading' | 'executing' | 'waiting' | 'reviewing' | 'question' | 'approval' | 'done' | 'error' | 'offline';
export type LivingPanel = 'none' | 'history' | 'approval' | 'question' | 'references' | 'settings';
export type LivingStatus = { pose: BotPose; label: string; active: boolean; attention: boolean };
export type LivingBotActivation = 'close' | 'quick' | 'conversation';
const permissionTools = new Set(['heiyan_edit_canvas', 'heiyan_request_generation', 'heiyan_read_images', 'heiyan_project_checkpoint', 'heiyan_crop_images', 'heiyan_canvas_action']);
function compactMessageText(value: string) {
  let text = value.trim();
  if (!text) return '';
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const payload = JSON.parse(text);
      if (typeof payload === 'string') text = payload;
      else if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const record = payload as Record<string, unknown>;
        text = [record.summary, record.message, record.error, record.reason]
          .find(item => typeof item === 'string' && item.trim()) as string || '';
      } else text = '';
    } catch {
      // Streaming or malformed machine payloads must never leak into the compact UI.
      return '';
    }
  }
  return text
    .replace(/```[\s\S]*?```/g, ' 已附代码 ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' 已附图片 ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
/** Latest real Agent receipt for the collapsed conversation; runtime state is rendered separately. */
export function compactAgentReceiptEntry(messages: readonly AgentMessage[]) {
  for (const message of [...messages].reverse()) {
    if (message.role === 'user' || message.question) continue;
    const text = compactMessageText(message.text || '');
    if (text) return { id: message.id, text };
  }
  return null;
}
export function compactAgentReceipt(messages: readonly AgentMessage[]) {
  return compactAgentReceiptEntry(messages)?.text || '';
}
export function needsAgentApproval(state: AgentState, mode: AgentApprovalMode) {
  const p = state.pending;
  return !!p && !p.claimed && permissionTools.has(p.tool) && !mayAutoApproveAgentProposal(mode, p.input, p.tool);
}
export function pendingActivity(state: AgentState, mode: AgentApprovalMode): { phase: string; detail: string } {
  const p = state.pending;
  if (state.messages.some(m => m.question?.status === 'pending')) return { phase: 'question', detail: '等待你的回答' };
  if (p) {
    if (needsAgentApproval(state, mode)) return { phase: 'approval', detail: '需要你的授权' };
    if (p.tool === 'heiyan_read_generation') return { phase: 'waiting-generation', detail: '等待生成结果' };
    if (p.tool === 'heiyan_review_result') return { phase: 'reviewing', detail: '检查结果' };
    if (['heiyan_read_canvas', 'heiyan_read_images', 'heiyan_search_history', 'heiyan_search_task_memory', 'heiyan_canvas_capabilities'].includes(p.tool)) return { phase: 'reading', detail: '读取任务上下文' };
    return { phase: 'executing', detail: '执行画布操作' };
  }
  return state.activity || { phase: 'processing', detail: '正在处理' };
}
export function activityStatus(phase: string, detail = ''): LivingStatus {
  const result = (pose: BotPose, label: string, active = true, attention = false) => ({ pose, label, active, attention });
  // Older connectors reported context compaction as generic processing; retain its real meaning.
  if (phase === 'processing' && detail.includes('整理上下文')) return result('reading', detail);
  if (phase === 'question') return result('question', '需要你的回答', false, true);
  if (phase === 'approval') return result('approval', '需要你的授权', false, true);
  if (['waiting-generation','waiting','queued'].includes(phase)) return result('waiting', detail || '等待生成结果');
  if (['reviewing','validating','inspecting'].includes(phase)) return result('reviewing', detail || '检查结果');
  if (['executing','editing','tool'].includes(phase)) return result('executing', detail || '执行画布操作');
  if (['reading','searching','context','compacting'].includes(phase)) return result('reading', detail || (phase === 'searching' ? '查找参考' : phase === 'compacting' ? '整理上下文' : '读取上下文'));
  if (['thinking','reasoning','planning'].includes(phase)) return result('thinking', detail || '思考中');
  if (['blocked','failed','error'].includes(phase)) return result('error', detail || '遇到问题 · 查看原因', false, true);
  if (phase === 'done') return result('done', detail || '本轮已结束', false);
  if (['preparing','processing','responding','steering','reconnected','connection'].includes(phase)) return result('processing', detail || (phase === 'responding' ? '组织回复' : phase === 'steering' ? '处理补充要求' : '正在处理'));
  return result('processing', detail || '正在处理');
}
export function livingStatus({ state, activity, mode, busy, restoring, hasConnection, error, jobs }: {
  state: AgentState; activity: AgentActivity; mode: AgentApprovalMode; busy: boolean; restoring: boolean;
  hasConnection: boolean; error?: string; jobs: readonly { state: string }[];
}): LivingStatus {
  const result = (pose: BotPose, label: string, active = false, attention = false) => ({ pose, label, active, attention });
  if (restoring) return result('processing', '恢复连接', true);
  if (!state.connected) {
    const reason = String(error || '').replace(/\s+/g, ' ').trim().slice(0, 56);
    return result('offline', hasConnection ? reason ? `连接中断 · ${reason}` : '连接中断 · 状态待核实' : '连接 Agent', false, hasConnection);
  }
  if (error || state.error) return result('error', '遇到问题 · 查看原因', false, true);
  if (state.active || busy) {
    const current = state.pending || state.messages.some(m => m.question?.status === 'pending') ? pendingActivity(state, mode) : state.activity || activity;
    return activityStatus(current.phase, current.detail);
  }
  const running = jobs.filter(j => ['queued', 'running', 'paused', 'cancelling'].includes(j.state));
  if (running.length) return result('waiting', `${running.length} 项生成等待结果`, true);
  if (jobs.some(j => ['unknown', 'missing'].includes(j.state))) return result('error', '生成状态待核实', false, true);
  if (jobs.some(j => j.state === 'failed')) return result('error', '生成失败 · 查看原因', false, true);
  if (activity.phase === 'done') return activityStatus(activity.phase, activity.detail);
  return result('idle', '有什么想一起做的？');
}
/** Stable visual-width estimate: CJK and emoji occupy roughly two Latin cells. */
export function compactReceiptWidth(text: string, stoppable = false) {
  const units = [...text].reduce((total, character) => {
    if (/\s/u.test(character)) return total + .5;
    const point = character.codePointAt(0) || 0;
    return total + (point >= 0x2e80 || point >= 0x1f300 ? 2 : 1);
  }, 0);
  // 134px is the avatar, disclosure control, gaps and text padding. Width
  // changes in restrained 40px steps so streaming text never jitters the Bot.
  return Math.max(260, Math.min(480, Math.ceil((134 + (stoppable ? 40 : 0) + units * 7) / 40) * 40));
}
/** Width is a content requirement, never a timer, token count or Bot pose. */
export function livingWidth(open: boolean, panel: LivingPanel, compactLabel: boolean, quickEditing = false, compactText = '', stoppable = false) {
  if (!open) return quickEditing ? 420 : compactLabel ? compactReceiptWidth(compactText, stoppable) : 72;
  return panel === 'history' ? 960 : panel === 'none' ? 800 : 840;
}
/** A bare idle Bot opens quick input first; visible work/status remains a route to the full conversation. */
export function livingBotActivation(open: boolean, compactLabel: boolean, connected: boolean): LivingBotActivation {
  if (open) return 'close';
  return !compactLabel && connected ? 'quick' : 'conversation';
}
/** A brand-new connected canvas has no full conversation to reveal yet. */
export function canExpandLivingConversation({ connected, messages, pending, question, attention, jobs }: {
  connected: boolean; messages: number; pending: boolean; question: boolean; attention: boolean; jobs: number;
}) {
  return !connected || messages > 0 || pending || question || attention || jobs > 0;
}
/** Folding hides presentation only: drafts, attachments and pending work stay mounted. */
export function canFoldOnCanvas({ selecting, composing }: { selecting: boolean; composing: boolean }) {
  return !selecting && !composing;
}
