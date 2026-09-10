import type { AgentProposal } from '../../server/agent-contract.js';

export type AgentApprovalMode = 'ask' | 'assist' | 'full';
export const agentApprovalModeKey = 'heiyan:agent-approval-mode:v1';

export function readAgentApprovalMode(storage: Pick<Storage, 'getItem'>, canvasKey?: string): AgentApprovalMode {
  try { const value = storage.getItem(canvasKey ? agentApprovalModeKey + ':' + encodeURIComponent(canvasKey) : agentApprovalModeKey); return value === 'assist' || canvasKey && value === 'full' ? value as AgentApprovalMode : 'ask'; }
  catch { return 'ask'; }
}

export function saveAgentApprovalMode(storage: Pick<Storage, 'setItem'>, mode: AgentApprovalMode, canvasKey?: string) {
  // Persist only within the authenticated canvas scope; never promote a legacy global grant.
  try { storage.setItem(canvasKey ? agentApprovalModeKey + ':' + encodeURIComponent(canvasKey) : agentApprovalModeKey, !canvasKey && mode === 'full' ? 'ask' : mode); } catch { /* Keep the in-memory choice. */ }
}

/** Assist mode only auto-approves reversible, non-destructive canvas structure edits. */
export function mayAutoApproveAgentProposal(mode: AgentApprovalMode, proposal: AgentProposal, tool = 'heiyan_edit_canvas') {
  if (mode === 'full') return ['heiyan_edit_canvas', 'heiyan_request_generation', 'heiyan_read_images', 'heiyan_project_checkpoint'].includes(tool);
  if (tool !== 'heiyan_edit_canvas') return false;
  const operations = proposal.operations;
  return mode === 'assist' && Array.isArray(operations) && operations.length > 0
    && operations.every(operation => operation.action === 'create' || operation.action === 'connect');
}
