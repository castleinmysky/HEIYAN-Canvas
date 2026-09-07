import type { AgentProposal } from '../../server/agent-contract.js';

export type AgentApprovalMode = 'ask' | 'assist';
export const agentApprovalModeKey = 'heiyan:agent-approval-mode:v1';

export function readAgentApprovalMode(storage: Pick<Storage, 'getItem'>): AgentApprovalMode {
  try { return storage.getItem(agentApprovalModeKey) === 'assist' ? 'assist' : 'ask'; }
  catch { return 'ask'; }
}

export function saveAgentApprovalMode(storage: Pick<Storage, 'setItem'>, mode: AgentApprovalMode) {
  try { storage.setItem(agentApprovalModeKey, mode); } catch { /* Keep the in-memory choice. */ }
}

/** Assist mode only auto-approves reversible, non-destructive canvas structure edits. */
export function mayAutoApproveAgentProposal(mode: AgentApprovalMode, proposal: AgentProposal) {
  const operations = proposal.operations;
  return mode === 'assist' && Array.isArray(operations) && operations.length > 0
    && operations.every(operation => operation.action === 'create' || operation.action === 'connect');
}
