import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { CanvasAgentDock, searchableAgentNodes, type CanvasAgentItem } from './CanvasAgentDock';
import { addConversationReferences, conversationDraftKey, emptyConversationDraft, parseConversationDraft, saveConversationDraft } from './conversation-draft';
import { agentCompactLayout, agentRailWidth, toggleAgentWorkspace } from './workbench-layout';
import { mobileCanvasLayout } from '../mobile-canvas';

describe('Independent canvas conversation', () => {
  const items: CanvasAgentItem[] = [{ id: 'image', title: '角色', kind: 'imageGenerator' }, { id: 'video', title: '分镜', kind: 'videoGenerator' }];
  it('references unfinished nodes as context and retains selection across searches', () => {
    expect(searchableAgentNodes(items, '角色').map(item => item.id)).toEqual(['image']);
    const original = { text: '制作一部短片', nodeIds: ['image'] };
    expect(addConversationReferences(original, ['video', 'image'])).toEqual({ text: original.text, nodeIds: ['image', 'video'] });
    expect(original.nodeIds).toEqual(['image']);
  });
  it('isolates drafts by canvas and stores identities instead of URLs or node prompts', () => {
    expect(conversationDraftKey('task:main')).not.toBe(conversationDraftKey('task:second'));
    const setItem = vi.fn();
    expect(saveConversationDraft({ setItem }, 'task:main', { text: '续写分镜', nodeIds: ['image'] })).toBe(true);
    expect(JSON.parse(setItem.mock.calls[0][1])).toEqual({ text: '续写分镜', nodeIds: ['image'] });
  });
  it('round trips Unicode drafts and keeps a missing node reference available to remove', () => {
    const draft = { text: '角色 A\n镜头二 🎬', nodeIds: ['removed-node'] };
    expect(parseConversationDraft(JSON.stringify(draft))).toEqual(draft);
  });
  it.each([null, '{', '{}', '{"text":2,"nodeIds":[]}', '{"text":"x","nodeIds":null}'])('recovers malformed storage %s', value => {
    expect(parseConversationDraft(value)).toEqual(emptyConversationDraft());
  });
  it('limits malformed or oversized stored references and content', () => {
    expect(parseConversationDraft(JSON.stringify({ text: 'a'.repeat(9000), nodeIds: ['one', 'one', null, {}, 7, 'x'.repeat(300)] }))).toEqual({ text: 'a'.repeat(8000), nodeIds: ['one'] });
    expect(addConversationReferences(emptyConversationDraft(), Array.from({ length: 100 }, (_, i) => String(i))).nodeIds).toHaveLength(64);
  });
  it('reports blocked storage rather than claiming a saved draft', () => {
    expect(saveConversationDraft({ setItem: () => { throw Error('quota'); } }, 'task', emptyConversationDraft())).toBe(false);
  });
  it('renders a real disconnected state with no fabricated messages or generation controls', () => {
    const html = renderToStaticMarkup(<CanvasAgentDock canvasKey="test" items={items} ready onClose={vi.fn()} onFocus={vi.fn()} onUpload={vi.fn()} onViewChange={vi.fn()} />);
    expect(html).toContain('会话消息');
    expect(html).toContain('Agent 未连接');
    expect(html).toContain('会话描述');
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
    expect(html).not.toMatch(/generator-editor-panel|generator-run-controls|生成结果会显示在这里|生成视频/);
  });
  it('keeps a dismissed conversation mounted but outside keyboard and screen-reader navigation', () => {
    const html = renderToStaticMarkup(<CanvasAgentDock canvasKey="test" open={false} items={items} ready onClose={vi.fn()} onFocus={vi.fn()} onUpload={vi.fn()} onViewChange={vi.fn()} />);
    expect(html).toContain('id="canvas-agent-conversation"');
    expect(html).toContain('data-open="false"');
    expect(html).toContain('inert=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('会话描述');
  });
  it.each([320, 375, 414])('keeps the phone conversation layout at %dpx', width => {
    expect(agentCompactLayout(width, true)).toBe(true);
    expect(agentCompactLayout(width, false)).toBe(true);
  });
  it.each([768, 791, 960, 1280, 1920])('uses a pushing split on %dpx desktop windows', width => {
    expect(agentCompactLayout(width, false)).toBe(false);
    expect(agentRailWidth(1000, width)).toBeLessThanOrEqual(width * .48 + 1);
    expect(width - agentRailWidth(1000, width)).toBeGreaterThanOrEqual(399);
  });
  it('keeps narrow touch tablets in compact mode independently of desktop windows', () => {
    expect(agentCompactLayout(768, true)).toBe(true);
    expect(agentCompactLayout(959, true)).toBe(true);
    expect(agentCompactLayout(960, true)).toBe(false);
  });
  it('separates the Agent entry from utilities and gives conversation an opaque non-dotted surface', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/<\/div>\s*\{!shareMode && <button id="canvas-agent-toggle"/);
    expect(app).toContain('aria-controls="canvas-agent-conversation" aria-expanded={agentOpen}');
    expect(app).toContain('open={agentOpen}');
    const css = readFileSync('src/agent-workbench/CanvasAgentDock.css', 'utf8');
    const conversationStyle = css.slice(css.indexOf('.canvas-agent-conversation {'), css.indexOf('.canvas-agent-quiet-state {'));
    expect(conversationStyle).not.toContain('radial-gradient');
    expect(conversationStyle).toContain('background: var(--cad-rail)');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });
  it('does not bind conversation to a selected generator and uses a guarded canvas boundary', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const dock = app.slice(app.indexOf('<CanvasAgentDock'), app.indexOf('<CanvasAgentDock') + 540);
    expect(dock).toContain('key={activeCanvasKey} canvasKey={activeCanvasKey}');
    expect(dock).toContain('access={agentCanvasAccess}');
    expect(dock).not.toMatch(/editor=|target=|onQuote=|onCreate=|onSettings=/);
    expect(app).toContain('(!agentOpen || !agentCompactLayout(mobileCanvas.width) || agentCanvasView) && selectedGenerator');
    const source = readFileSync('src/agent-workbench/CanvasAgentDock.tsx', 'utf8');
    expect(source).not.toMatch(/GeneratorEditorPanel|ComfyUiWorkflowPanel|pastePromptReferences|\bfetch\(|setNodes\(|setEdges\(/);
    expect(source).toContain('event.nativeEvent.isComposing');
    expect(source).toContain('event.preventDefault(); void send();');
  });
  it('uses consistent vector controls instead of font glyphs and alignment arrows', () => {
    const html = renderToStaticMarkup(<CanvasAgentDock canvasKey="test" items={items} ready onClose={vi.fn()} onFocus={vi.fn()} onUpload={vi.fn()} onViewChange={vi.fn()} />);
    expect(html).toContain('调节高度 · 双击复原');
    expect(html).not.toContain('＠');
    expect(html).toContain('M10 16V4M5 9l5-5 5 5');
    const css = readFileSync('src/agent-workbench/CanvasAgentDock.css', 'utf8');
    expect(css).toContain('.canvas-agent-grip:is(:hover,:active,:focus-visible) { background: transparent;');
  });
  it('returns to the conversation from canvas instead of closing the Agent', () => {
    expect(toggleAgentWorkspace('closed')).toBe('conversation');
    expect(toggleAgentWorkspace('canvas')).toBe('conversation');
    expect(toggleAgentWorkspace('conversation')).toBe('closed');
  });
  it('uses the parent-owned view and disables the covered canvas in full-screen conversation', () => {
    const html = renderToStaticMarkup(<CanvasAgentDock canvasKey="test" canvasView items={items} ready onClose={vi.fn()} onFocus={vi.fn()} onUpload={vi.fn()} onViewChange={vi.fn()} />);
    expect(html).toContain('data-canvas-view="true"');
    const app = readFileSync('src/App.tsx', 'utf8');
    const source = readFileSync('src/agent-workbench/CanvasAgentDock.tsx', 'utf8');
    expect(app).toContain('canvasView={agentCanvasView}');
    expect(app).toContain('inert={!shareMode && agentOpen && agentCompactLayout(mobileCanvas.width) && !agentCanvasView}');
    expect(source).not.toContain('setCanvasView');
    expect(app).not.toContain('if (nodeId) focusAgentNode(nodeId)');
    const css = readFileSync('src/agent-workbench/CanvasAgentDock.css', 'utf8');
    expect(css).toContain('height: var(--mobile-visible-height, 100dvh);');
    expect(css).not.toContain('100dvh) - 62px');
  });
  it.each([375, 761, 767, 768, 959, 960])('shares phone and touch tablet layout boundaries at %d CSS pixels', width => {
    expect(mobileCanvasLayout(width, 900, true)).toBe(agentCompactLayout(width, true));
    expect(mobileCanvasLayout(width, 900, false)).toBe(agentCompactLayout(width, false));
  });
});
