import type { AgentContext, AgentProposal } from '../../server/agent-contract.js';
import type { SearchDocument } from './agent-search';
import type { AgentEditPreview } from './agent-proposals';
import type { JobSnapshot, JobTarget } from './agent-jobs';

export type AgentMessage = { id: string; role: 'user' | 'assistant' | 'notice'; text: string; imageCount?: number; model?: string; effort?: string };
export type AgentPending = { id: string; tool: string; input: AgentProposal; revision: string; claimed: boolean };
export type AgentState = { messages: AgentMessage[]; active: boolean; connected: boolean; pending: AgentPending | null; error: string; usage?: { inputTokens: number; outputTokens: number; cachedInputTokens: number; modelContextWindow?: number } };
export const emptyAgentState = (): AgentState => ({ messages: [], active: false, connected: false, pending: null, error: '' });
export type AgentCanvasAccess = {
  documents?: () => SearchDocument[];
  read: (referenceIds: string[], request?: AgentProposal) => AgentContext;
  images?: (nodeIds: string[], jobIds?: string[], outputIndexes?: number[]) => Promise<string[]>;
  jobs?: (targets: JobTarget[]) => JobSnapshot[];
  preview?: (proposal: AgentProposal) => AgentEditPreview;
  reveal?: (nodeIds: string[], label: string, automatic?: boolean) => void;
  edit: (proposal: AgentProposal, revision: string) => string;
  generate: (request: AgentProposal, revision: string) => Promise<string>;
};
export type AgentModelOption = { id: string; model: string; name: string; description: string; isDefault: boolean; inputModalities: string[]; defaultEffort: string; efforts: Array<{ value: string; description: string }> };
export type AgentConnection = { url: string; token: string; device: string; protocol?: number; capabilities?: string[] };
export const agentConnectionKey = 'heiyan:codex-connection:v1';

export function connectorAddress(value: string) {
  const url = new URL(value);
  // This first release is loopback only; never send a pairing secret to an
  // arbitrary URL pasted into the connection field or restored from storage.
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !url.port) throw Error('当前版本仅支持本机连接器，例如 http://127.0.0.1:17372');
  return url.origin;
}
export function readAgentConnection(storage: Pick<Storage, 'getItem'>): AgentConnection | null {
  try {
    const parsed = JSON.parse(storage.getItem(agentConnectionKey) || 'null');
    if (!parsed || typeof parsed.token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(parsed.token)) return null;
    return { url: connectorAddress(parsed.url), token: parsed.token, device: String(parsed.device || '本机'), protocol: Number.isSafeInteger(parsed.protocol) ? parsed.protocol : undefined, capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities.filter((value: unknown) => typeof value === 'string').slice(0, 20) : undefined };
  } catch { return null; }
}
export async function agentRequest(connection: Pick<AgentConnection, 'url'> & Partial<AgentConnection>, path: string, body: object) {
  const response = await fetch(connectorAddress(connection.url) + path, { method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(28000), headers: { 'Content-Type': 'application/json', ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}) }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw Error(payload.error || '连接器请求失败');
  return payload;
}
