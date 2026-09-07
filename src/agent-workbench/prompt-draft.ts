import { assetKindLabels, type CreativeAsset } from './types';

export type CanvasReference = { token: string; asset: CreativeAsset };
export type AgentPromptDraft = {
  text: string;
  references: CanvasReference[];
  nextReference: number;
  promptTokenIds: string[];
  negativePromptTokenIds: string[];
};
export type TextRange = { start: number; end: number };
export const emptyPromptDraft = (): AgentPromptDraft => ({ text: '', references: [], nextReference: 1, promptTokenIds: [], negativePromptTokenIds: [] });
export const PROMPT_LIMIT = 8000;

/** Tokens are allocated monotonically, never inferred from a node's editable name. */
export function insertCanvasReference(draft: AgentPromptDraft, asset: CreativeAsset, range: TextRange = { start: draft.text.length, end: draft.text.length }) {
  const existing = draft.references.find(reference => reference.asset.nodeId === asset.nodeId);
  const token = existing?.token || `${assetKindLabels[asset.kind].replace(/\s/g, '')}${draft.nextReference}`;
  const start = Math.max(0, Math.min(range.start, draft.text.length));
  const end = Math.max(start, Math.min(range.end, draft.text.length));
  const prefix = start && !/\s$/.test(draft.text.slice(0, start)) ? ' ' : '';
  const inserted = `${prefix}@${token} `;
  const text = draft.text.slice(0, start) + inserted + draft.text.slice(end);
  if (text.length > PROMPT_LIMIT) return { draft, caret: start, error: '提示词已达 8000 字，请删减后再插入引用。' };
  return { draft: { ...draft, text, references: existing ? draft.references : [...draft.references, { token, asset }], nextReference: draft.nextReference + (existing ? 0 : 1) }, caret: start + inserted.length, error: '' };
}

export function removeCanvasReference(draft: AgentPromptDraft, nodeId: string): AgentPromptDraft {
  const reference = draft.references.find(item => item.asset.nodeId === nodeId);
  if (!reference) return draft;
  const escaped = reference.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { ...draft, text: draft.text.replace(new RegExp(`@${escaped}(?![\\p{L}\\p{N}_])`, 'gu'), ''), references: draft.references.filter(item => item !== reference) };
}

export function activeCanvasMention(text: string, range: TextRange) {
  if (range.start !== range.end) return null;
  const match = /(?:^|[\s，。；：、（(])@([^@\s，。；：、（）()]{0,60})$/u.exec(text.slice(0, range.start));
  return match ? { start: range.start - match[1].length - 1, end: range.start, query: match[1] } : null;
}

export function findCanvasAssets(assets: CreativeAsset[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  const unique = [...new Map(assets.map(asset => [asset.nodeId, asset])).values()];
  return unique.filter(asset => `${asset.name} ${assetKindLabels[asset.kind]} ${asset.nodeId}`.toLocaleLowerCase().includes(needle));
}
