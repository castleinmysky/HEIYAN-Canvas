/** Narrow desktop windows still get two panes; touch layouts keep the 960px sheet. */
export type AgentWorkspace = 'closed' | 'conversation' | 'canvas';
export const toggleAgentWorkspace = (current: AgentWorkspace): AgentWorkspace => current === 'conversation' ? 'closed' : 'conversation';
export const agentCompactLayout = (width: number, coarsePointer = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false) => width < (coarsePointer ? 960 : 768);
export function agentRailWidth(requested: number, viewportWidth: number) {
  return Math.round(Math.max(360, Math.min(640, viewportWidth * .48, requested)));
}
export function agentComposerLimits(height: number) {
  const max = Math.max(140, Math.min(height * .72, height - 120));
  return { min: Math.min(200, max), max };
}
export function agentViewportLayout(width: number, height: number) {
  const compact = agentCompactLayout(width);
  return { compact, header: 64, rail: compact ? width : Math.min(520, Math.max(400, width * .34)),
    composerMax: Math.max(160, Math.min(height * .7, height - 150)) };
}
