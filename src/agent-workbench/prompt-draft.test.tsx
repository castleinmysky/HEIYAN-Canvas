import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { activeCanvasMention, emptyPromptDraft, findCanvasAssets, insertCanvasReference, removeCanvasReference } from './prompt-draft';
import { AgentPromptEditor, AgentPresetPicker } from './AgentPromptEditor';
import { AgentPanel, type AgentPanelProps } from './AgentWorkbench';
import { resolvePromptTokenSelectionTags } from '../components/PromptTokenComposer';
import { filterPromptTokens } from '../prompt-token-library';
import { mobileCanvasViewport } from '../mobile-canvas';
import type { CreativeAsset } from './types';
import { resolveComposerDrag } from './composer-resize';

const a: CreativeAsset = { id: 'a', nodeId: 'node-a', kind: 'image', name: '同名场景', url: '/agent-preview/forest.png' };
const b: CreativeAsset = { ...a, id: 'b', nodeId: 'node-b' };
describe('Agent prompt and stable canvas references', () => {
  it('binds same-name nodes independently and does not duplicate an existing binding', () => {
    const first = insertCanvasReference(emptyPromptDraft(), a).draft;
    const second = insertCanvasReference(first, b).draft;
    const again = insertCanvasReference(second, a).draft;
    expect(again.references.map(item => [item.token, item.asset.nodeId])).toEqual([['图片1', 'node-a'], ['图片2', 'node-b']]);
    expect(again.text).toBe('@图片1 @图片2 @图片1 ');
    expect(again.nextReference).toBe(3);
  });
  it('replaces an active mention without overwriting text after the caret', () => {
    const draft = { ...emptyPromptDraft(), text: '把 @同名 放进视频' };
    const mention = activeCanvasMention(draft.text, { start: 5, end: 5 });
    expect(mention).toEqual({ start: 2, end: 5, query: '同名' });
    const result = insertCanvasReference(draft, a, mention!);
    expect(result.draft.text).toBe('把 @图片1  放进视频');
    expect(result.caret).toBe(7);
  });
  it('removes exact tokens without retargeting longer aliases or reusing their numbers', () => {
    let draft = insertCanvasReference(emptyPromptDraft(), a).draft;
    draft = { ...draft, text: '@图片1 @图片10，@图片1。邮箱abc@图片1x' };
    draft = removeCanvasReference(draft, 'node-a');
    expect(draft.text).toBe(' @图片10，。邮箱abc@图片1x');
    const next = insertCanvasReference(draft, b).draft;
    expect(next.references[0].token).toBe('图片2');
  });
  it('does not mutate the draft when inserting would exceed the input limit', () => {
    const draft = { ...emptyPromptDraft(), text: '字'.repeat(8000) };
    const result = insertCanvasReference(draft, a);
    expect(result.draft).toBe(draft);
    expect(result.error).toContain('8000');
  });
  it.each(['a@domain', '完成 @图 后续', '@'])('does not confuse arbitrary text with selected references: %s', text => {
    const result = activeCanvasMention(text, { start: text.length, end: text.length });
    expect(!!result).toBe(text === '@');
  });
  it('does not open suggestions over a selected range', () => {
    expect(activeCanvasMention('@图片', { start: 0, end: 3 })).toBeNull();
  });
  it('searches all asset types and deduplicates by node ID, not name', () => {
    const video: CreativeAsset = { ...a, id: 'v', nodeId: 'node-v', kind: 'video', name: '镜头' };
    expect(findCanvasAssets([a, b, a, video], '').length).toBe(3);
    expect(findCanvasAssets([a, video], '视频')).toEqual([video]);
    expect(findCanvasAssets([a, b], 'NODE-B')).toEqual([b]);
  });
  it('reuses the original preset values and never enables persistent preview preferences', () => {
    const token = filterPromptTokens('positive', '全部', '', 'image')[0];
    const draft = { ...emptyPromptDraft(), promptTokenIds: [token.id] };
    const tags = resolvePromptTokenSelectionTags('openai-image', draft.promptTokenIds, [], 'image');
    expect(tags[0].value).toBe(token.values.natural);
    const html = renderToStaticMarkup(<AgentPresetPicker value={draft} adapter="openai-image" target="image" onChange={vi.fn()} onClose={vi.fn()} />);
    expect(html).toContain('提示词级联预设器');
    const source = readFileSync('src/agent-workbench/AgentPromptEditor.tsx', 'utf8');
    expect(source).not.toMatch(/\bpersistenceKey=|\bfetch\(|\blocalStorage\.|\bindexedDB\./);
  });
  it('places model and spec controls before the prompt, with one context strip', () => {
    const inputRef = createRef<HTMLTextAreaElement>();
    const selection = { current: { start: 0, end: 0 } };
    const editor = <AgentPromptEditor value={insertCanvasReference(emptyPromptDraft(), a).draft} assets={[a]} adapter="openai-image" target="image" onChange={vi.fn()} onPreview={vi.fn()} inputRef={inputRef} selection={selection} />;
    const props: AgentPanelProps = { connection: 'preview', messages: [], assets: [], stages: [], selectedId: '', draft: '', modelLabel: 'GPT Image 2', ratio: '3:4', resolution: '1K', onDraft: vi.fn(), onSelect: vi.fn(), onLocate: vi.fn(), onEdit: vi.fn(), onClearReference: vi.fn(), onAttach: vi.fn(), onSettings: vi.fn(), onConnection: vi.fn(), onClose: vi.fn(), promptEditor: editor };
    const html = renderToStaticMarkup(<AgentPanel {...props} />);
    expect(html.indexOf('aw-generation-options')).toBeLessThan(html.indexOf('<textarea'));
    expect(html).toContain('aw-prompt-context');
    expect(html).toContain('预览引用：同名场景');
  });
  it('tracks the visible keyboard viewport without changing desktop layout', () => {
    expect(mobileCanvasViewport(844, 500, 0)).toMatchObject({ height: 500, keyboard: true });
    expect(mobileCanvasViewport(900, 900, 0)).toMatchObject({ height: 900, keyboard: false });
  });
  it('expands within viewport bounds, but only collapses on a deliberate downward pull', () => {
    const base = { startHeight: 220, minHeight: 180, maxHeight: 420, elapsed: 300 };
    expect(resolveComposerDrag({ ...base, deltaY: -500 })).toEqual({ height: 420, collapsed: false });
    expect(resolveComposerDrag({ ...base, deltaY: 12 })).toEqual({ height: 208, collapsed: false });
    expect(resolveComposerDrag({ ...base, deltaY: 60, elapsed: 60 }).collapsed).toBe(true);
    expect(resolveComposerDrag({ ...base, deltaY: 110, elapsed: 900 }).collapsed).toBe(true);
    expect(resolveComposerDrag({ ...base, deltaY: 60, elapsed: 1000 }).collapsed).toBe(false);
  });
});
