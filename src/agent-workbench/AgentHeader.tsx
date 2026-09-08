import { useEffect, useRef } from 'react';
import { UiIcon } from '../components/UiIcon';
import type { AgentApprovalMode } from './approval-mode';
import './AgentHeader.css';

export function AgentHeader({ visible, connected, connectionLabel, connectionOpen, active, waiting, canvasView, approvalMode, followCanvas, onApproval, onFollow, onConnection, onCompose, onView, onClose }: {
  visible: boolean; connected: boolean; connectionLabel: string; connectionOpen: boolean; active: boolean; waiting: boolean;
  canvasView: boolean; approvalMode: AgentApprovalMode; followCanvas: boolean;
  onApproval: (mode: AgentApprovalMode) => void; onFollow?: (value: boolean) => void;
  onConnection: () => void; onCompose: () => void; onView: (canvas: boolean) => void; onClose: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const closeMenu = (focus = false) => {
    if (menu.current) menu.current.open = false;
    if (focus) menu.current?.querySelector('summary')?.focus();
  };
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) closeMenu();
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  useEffect(() => closeMenu(), [connectionOpen, canvasView, visible]);
  const status = !connected ? '尚未连接' : waiting ? '等待你的确认' : active ? '正在处理任务' : connectionLabel;
  return <header className="canvas-agent-head agent-header-refined">
    <div className="agent-heading-copy"><strong className="canvas-agent-title">{connectionOpen ? '连接设置' : '创作会话'}</strong><span className="agent-heading-status" title={status}>{status}</span></div>
    <div className="agent-heading-actions">
      <button type="button" className="canvas-agent-icon" aria-label={active ? '补充任务要求' : '撰写消息'} title={active ? '补充要求' : '写消息'} onClick={onCompose}><UiIcon name="edit" /></button>
      <details ref={menu} className="agent-header-settings" onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) closeMenu(); }} onKeyDown={event => { if (event.key === 'Escape' && menu.current?.open) { event.preventDefault(); event.stopPropagation(); closeMenu(true); } }}>
        <summary className="canvas-agent-icon" aria-label="Agent 设置" title="Agent 设置"><UiIcon name="settings" /></summary>
        <div className="agent-header-settings-panel" role="group" aria-label="Agent 会话设置">
          <button type="button" className="agent-settings-connection" onClick={() => { closeMenu(); onConnection(); }}><UiIcon name="link" /><span><strong>连接方式</strong><small>{connected ? connectionLabel : '尚未连接 Agent'}</small></span><UiIcon name="right" /></button>
          <fieldset><legend>画布操作权限</legend>
            <label><input type="radio" name="agent-approval-mode" checked={approvalMode === 'ask'} onChange={() => onApproval('ask')} /><span><strong>请求批准</strong><small>每次修改画布前询问</small></span></label>
            <label><input type="radio" name="agent-approval-mode" checked={approvalMode === 'assist'} onChange={() => onApproval('assist')} /><span><strong>帮我批准</strong><small>自动执行创建和连线；覆盖内容与付费生成仍询问</small></span></label>
          </fieldset>
          <label className="agent-settings-follow"><input type="checkbox" checked={followCanvas} disabled={!onFollow} onChange={event => onFollow?.(event.target.checked)} /><span><strong>跟随画布变化</strong><small>自动定位 Agent 修改或生成的节点</small></span></label>
        </div>
      </details>
      <button type="button" className="canvas-agent-icon" aria-label="收起创作会话" title="收起会话" onClick={() => { closeMenu(); onClose(); }}><UiIcon name="close" /></button>
    </div>
    <nav className="canvas-agent-views" aria-label="手机工作区"><button type="button" aria-pressed={!canvasView} onClick={() => onView(false)}>会话</button><button type="button" aria-pressed={canvasView} onClick={() => onView(true)}>画布</button></nav>
    {!connected && !connectionOpen && <button type="button" className="agent-header-connect-alert" onClick={onConnection}><UiIcon name="link" /><span>Agent 未连接</span><strong>去连接</strong></button>}
  </header>;
}
