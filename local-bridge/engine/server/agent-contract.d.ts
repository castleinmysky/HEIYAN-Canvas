export type AgentOperation = { action: 'create' | 'update' | 'connect'; id?: string; kind?: string; title?: string; prompt?: string; source?: string; target?: string };
export type AgentProposal = { summary?: string; operations?: AgentOperation[]; nodeIds?: string[] };
export type AgentContext = { revision: string; nodes: Array<{ id: string; kind: string; title: string; prompt: string; state: string; hasMedia: boolean; model: string }>; edges: Array<{ source: string; target: string }>; referenceIds: string[] };
export const agentKinds: string[];
export function validateAgentTool(tool: string, input: unknown): AgentProposal;
export function sanitizeAgentContext(value: unknown): AgentContext;
export const agentTools: object[];
export const agentInstructions: string;
