import { UiIcon, type UiIconName } from '../components/UiIcon';
import './AgentHeader.css';

export type AgentPage = 'chat' | 'memory' | 'progress' | 'settings' | 'skills';
const pages: { id: AgentPage; label: string; icon: UiIconName }[] = [
  { id: 'chat', label: '会话', icon: 'robot' },
  { id: 'memory', label: '项目记忆', icon: 'document' },
  { id: 'progress', label: '执行进度', icon: 'usage' },
  { id: 'settings', label: '连接与设置', icon: 'settings' },
  { id: 'skills', label: 'Skill（预留）', icon: 'toolbox' },
];
export function AgentHeader({ page, connected, active, waiting, onPage, onView, onClose }: {
  page: AgentPage; connected: boolean; active: boolean; waiting: boolean;
  onPage: (page: AgentPage) => void; onView: (canvas: boolean) => void; onClose: () => void;
}) {
  const status = !connected ? '尚未连接' : waiting ? '等待确认' : active ? '处理中' : '已连接';
  return <header className="canvas-agent-head agent-header-compact">
    <nav className="agent-top-navigation" aria-label="Agent 功能">
      {pages.map(item => <button key={item.id} type="button" className="canvas-agent-icon" aria-label={item.label} title={item.label} aria-pressed={page === item.id} onClick={() => onPage(item.id)}>
        <UiIcon name={item.icon} />
        {item.id === 'progress' && (active || waiting) && <span className="agent-nav-indicator" />}
      </button>)}
    </nav>
    <span className="agent-top-status" title={status} role="status">{status}</span>
    <button type="button" className="canvas-agent-icon agent-top-canvas" aria-label="查看画布" title="查看画布" onClick={() => onView(true)}><UiIcon name="organize" /></button>
    <button type="button" className="canvas-agent-icon" aria-label="收起创作会话" title="收起会话" onClick={onClose}><UiIcon name="close" /></button>
  </header>;
}
