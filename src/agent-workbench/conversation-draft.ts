export type ConversationDraft = { text: string; nodeIds: string[] };
export const CONVERSATION_LIMIT = 8000;
export const CONVERSATION_REFERENCE_LIMIT = 12;
export function selectedConversationReferences(ids: readonly string[], availableIds: readonly string[], existingIds: readonly string[]) {
  const available = new Set(availableIds), existing = new Set(existingIds);
  return [...new Set(ids)].filter(id => available.has(id) && !existing.has(id));
}
export const hasConversationContent = (draft: ConversationDraft, imageCount = 0) => Boolean(draft.text.trim() || draft.nodeIds.length || imageCount);
export const conversationSubmissionText = (draft: ConversationDraft) => draft.text.trim() || (draft.nodeIds.length
  ? '请查看本次引用的画布节点，概括相关内容并询问我接下来需要怎样处理；暂不修改或生成。'
  : '请分析这些图片，并结合当前画布说明可执行的下一步。');
export const emptyConversationDraft = (): ConversationDraft => ({ text: '', nodeIds: [] });
export function restoreSubmittedDraft(current: ConversationDraft, submitted: ConversationDraft): ConversationDraft {
  return { text: current.text ? submitted.text ? submitted.text + '\n' + current.text : current.text : submitted.text,
    nodeIds: [...new Set([...submitted.nodeIds, ...current.nodeIds])] };
}
export const conversationDraftKey = (canvasKey: string) => `heiyan:agent-conversation:v1:${encodeURIComponent(canvasKey)}`;
export function clearSubmittedDraft(current: ConversationDraft, submitted: ConversationDraft): ConversationDraft {
  return { text: current.text === submitted.text ? '' : current.text, nodeIds: current.nodeIds.filter(id => !submitted.nodeIds.includes(id)) };
}

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
