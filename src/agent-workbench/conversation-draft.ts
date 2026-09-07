export type ConversationDraft = { text: string; nodeIds: string[] };
export const CONVERSATION_LIMIT = 8000;
export const emptyConversationDraft = (): ConversationDraft => ({ text: '', nodeIds: [] });
export const conversationDraftKey = (canvasKey: string) => `heiyan:agent-conversation:v1:${encodeURIComponent(canvasKey)}`;

export function parseConversationDraft(value: string | null): ConversationDraft {
  try {
    const parsed = JSON.parse(value || 'null');
    if (!parsed || typeof parsed.text !== 'string' || !Array.isArray(parsed.nodeIds)) return emptyConversationDraft();
    return { text: parsed.text.slice(0, CONVERSATION_LIMIT), nodeIds: [...new Set<string>(parsed.nodeIds.filter((id: unknown) => typeof id === 'string' && id.length <= 256))].slice(0, 64) };
  } catch { return emptyConversationDraft(); }
}

/** Store identities, not temporary media URLs, credentials, or another node's prompt. */
export function addConversationReferences(draft: ConversationDraft, ids: readonly string[]): ConversationDraft {
  return { ...draft, nodeIds: [...new Set([...draft.nodeIds, ...ids])].slice(0, 64) };
}

export function saveConversationDraft(storage: Pick<Storage, 'setItem'>, canvasKey: string, draft: ConversationDraft): boolean {
  try { storage.setItem(conversationDraftKey(canvasKey), JSON.stringify(draft)); return true; }
  catch { return false; }
}
