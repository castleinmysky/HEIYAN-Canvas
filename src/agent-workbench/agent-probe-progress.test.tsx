import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentApiForm } from './AgentApiForm';
describe('connection probe progress', () => {
  it('shows the actual stage, its deadline and cancellation without making requests', () => {
    const connect = vi.fn();
    const html = renderToStaticMarkup(<AgentApiForm busy testing progress={{ label: '工具参数约束', startedAt: Date.now(), timeoutMs: 20000, optional: true }} connect={connect} cancel={vi.fn()} />);
    expect(html).toContain('工具参数约束'); expect(html).toContain('20');
    expect(html).toContain('可选项超时会跳过'); expect(html).toContain('取消连接检测');
    expect(connect).not.toHaveBeenCalled();
  });
  it('does not show stale progress outside a connection test', () => {
    const html = renderToStaticMarkup(<AgentApiForm busy={false} testing={false} progress={{ label: '旧检测', startedAt: 0, timeoutMs: 20000, optional: true }} connect={vi.fn()} cancel={vi.fn()} />);
    expect(html).not.toContain('旧检测'); expect(html).not.toContain('取消连接检测');
  });
});
