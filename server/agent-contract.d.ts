export type AgentOperation = { action: 'create' | 'update' | 'connect' | 'disconnect' | 'move' | 'select' | 'delete' | 'configure' | 'duplicate' | 'layout'; id?: string; kind?: string; title?: string; prompt?: string; source?: string; target?: string; targetPort?: string; edgeId?: string; x?: number; y?: number; nodeIds?: string[]; modelId?: string; ratio?: string; resolution?: string; count?: number; duration?: number; layout?: 'row' | 'column' | 'grid' | 'align-left' | 'align-top' | 'right-of' | 'below'; anchorId?: string; gap?: number; columns?: number };
export type AgentJobIdentity = { nodeId: string; jobId: string };
export type AgentProposal = { summary?: string; goal?: string; progress?: string; requirements?: string; query?: string; offset?: number; promptOffset?: number; operations?: AgentOperation[]; nodeIds?: string[]; jobIds?: string[]; outputIndexes?: number[]; jobs?: AgentJobIdentity[]; waitSeconds?: number; verdict?: 'meets' | 'needs_changes' | 'uncertain'; reason?: string };
export type AgentGenerationRequest = { summary: string; nodeIds: string[] };
export type AgentContextPort = { id: string; label: string; accepts: string[]; multiple: boolean };
export type AgentContext = { overview?: { totalNodes: number; totalEdges: number; matchedNodes: number; nextOffset: number | null; promptOffset: number }; viewport?: { x: number; y: number; width: number; height: number; zoom: number }; revision: string; availableModels?: Array<{ id: string; name: string; capability: string; ratios: string[]; resolutions: string[]; count?: { min: number; max: number }; duration?: { min: number; max: number } }>; selectedNodeIds?: string[]; selectionKnown?: boolean; nodes: Array<{ id: string; kind: string; title: string; prompt: string; promptLength?: number; promptTruncated?: boolean; spatial?: { position: { x: number; y: number }; bounds: { x: number; y: number; width: number; height: number }; parentId: string; groupIds: string[]; memberIds?: string[]; memberCount?: number; visible?: boolean }; settings?: { ratio: string; resolution: string; count: number; duration: number }; jobId?: string; state: string; hasMedia: boolean; model: string; outputType: string; inputs: AgentContextPort[] }>; edges: Array<{ id?: string; source: string; sourcePort: string; target: string; targetPort: string; referenceToken?: string; type: string }>; referenceIds: string[] };
export const agentKinds: string[];
export function validateAgentTool(tool: string, input: unknown): AgentProposal;
export function sanitizeAgentContext(value: unknown): AgentContext;
export function sanitizeGenerationReport(value: unknown): object[];
export const agentTools: object[];
export const agentInstructions: string;

export const contextInstructions: string;
