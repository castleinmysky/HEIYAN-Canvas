import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { readMessageImages, writeMessageImages } from './message-images';
import { progressSignature } from './agent-progress';
import { emptyAgentState } from './agent-session';
import { emptyProject } from './agent-memory';
import { AgentHeader } from './AgentHeader';
import { AgentProjectPanel } from './AgentProjectPanel';

describe('standalone Agent 1.2 integration', () => {
  it('persists attachments without leaking across canvases or into project text', async () => {
    const image = 'data:image/png;base64,aGVsbG8=';
    await writeMessageImages('canvas-a', 'message', [image]);
    expect(await readMessageImages('canvas-a', 'message')).toEqual([image]);
    expect(await readMessageImages('canvas-b', 'message')).toEqual([]);
    expect(JSON.stringify(emptyProject())).not.toContain(image);
  });
  it('does not treat repeated polling as new progress', () => {
    const state = { ...emptyAgentState(), active: true };
    expect(progressSignature(state)).toBe(progressSignature({ ...state }));
    expect(progressSignature(state)).not.toBe(progressSignature({ ...state, messages: [{ id: '1', role: 'assistant', text: 'Done' }] }));
  });
  it('renders compact navigation with an explicitly reserved skill entry', () => {
    const html = renderToStaticMarkup(<AgentHeader page="memory" connected active={false} waiting={false} onPage={() => {}} onView={() => {}} onClose={() => {}} />);
    for (const label of ['会话', '项目记忆', '执行进度', '连接与设置', 'Skill（预留）']) expect(html).toContain(label);
    expect(html).toContain('aria-pressed="true"');
  });
  it('starts project memory in compact reading mode rather than large textareas', () => {
    const project = { ...emptyProject(), progress: '已完成'.repeat(200), messages: [] };
    const html = renderToStaticMarkup(<AgentProjectPanel expanded project={project} ready error="" busy={false} save={async () => true} reload={async () => true} searchTools={{ search: async () => { throw Error('unused'); }, focus: () => {}, busy: false, indexState: { configured: false, building: false, indexed: 0, total: 0, tokens: 0, error: '' }, configure: async () => true, clear: () => {}, build: async () => true, stop: () => {} }} />);
    expect(html).not.toContain('<textarea');
    expect(html).toContain('展开全文');
    expect(html).toContain('编辑当前目标');
    expect(html).not.toContain(project.progress);
  });
  it('keeps standalone storage and release downloads, not platform-only endpoints', () => {
    const dock = readFileSync('src/agent-workbench/CanvasAgentDock.tsx', 'utf8');
    expect(dock).toContain('CONNECTOR_RELEASES_URL');
    expect(dock).not.toContain('approvedLocalBridge');
    expect(readFileSync('src/agent-workbench/agent-memory.ts', 'utf8')).toContain('localAgentProject(canvas, document, etag)');
    expect(readFileSync('src/components/CanvasNodes.tsx', 'utf8')).not.toContain('21:9 超宽画幅');
    expect(readFileSync('src/styles.css', 'utf8')).toContain('.app-shell .react-flow__nodes { isolation: auto; backface-visibility: visible; }');
  });
});
