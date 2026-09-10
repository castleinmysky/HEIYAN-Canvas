import type { AgentState } from './agent-session';
export function progressSignature(state: AgentState) {
  const last = state.messages.at(-1);
  return JSON.stringify([state.active, state.pending?.id, state.pending?.tool, state.pending?.claimed, state.error, last?.id, last?.text, state.usage]);
}
