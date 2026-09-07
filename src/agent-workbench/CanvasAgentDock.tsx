import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { ReferenceMediaThumbnail, type CanvasNodeKind, type InputReference, type PromptClipboardReference } from '../components/CanvasNodes';
import { UiIcon, type UiIconName } from '../components/UiIcon';
import { resolveComposerDrag } from './composer-resize';
import { agentComposerLimits, agentRailWidth } from './workbench-layout';
import { useCanvasAgent } from './use-canvas-agent';
import { consumePairingFragment, downloadPortableConnector, CONNECTOR_RELEASES_URL } from './portable-connector';
import type { AgentCanvasAccess } from './agent-session';
import { addConversationReferences, CONVERSATION_LIMIT, conversationDraftKey, emptyConversationDraft, parseConversationDraft, saveConversationDraft, type ConversationDraft } from './conversation-draft';
import './CanvasAgentDock.css';

export type CanvasAgentItem = {
  id: string; title: string; kind: CanvasNodeKind; state?: string; status?: string;
  reference?: PromptClipboardReference & { previewUrl?: string };
};
const kindIcon = (item: CanvasAgentItem): UiIconName => item.kind.includes('video') || item.reference?.type === 'video' ? 'video'
  : item.kind.includes('audio') || item.reference?.type === 'audio' ? 'audio'
  : item.kind.includes('model') || item.reference?.type === 'model' ? 'model3d'
  : item.kind === 'text' || item.reference?.type === 'text' ? 'text' : 'image';
export function searchableAgentNodes(items: readonly CanvasAgentItem[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter(item => !needle || (item.title + ' ' + item.id).toLocaleLowerCase().includes(needle));
}
function ItemPreview({ item }: { item: CanvasAgentItem }) {
  const reference = item.reference;
  if (reference && ['image', 'video'].includes(reference.type)) return <ReferenceMediaThumbnail reference={{ ...reference, index: 1, edgeId: item.id, port: 'output' } as InputReference} />;
  return <UiIcon name={kindIcon(item)} />;
}

export function CanvasAgentDock({ canvasKey, open = true, canvasView = false, items, selectedId, ready, access, onClose, onFocus, onUpload, onViewChange }: {
  canvasKey: string; items: CanvasAgentItem[]; selectedId?: string | null; ready: boolean;
  open?: boolean;
  canvasView?: boolean;
  access?: AgentCanvasAccess;
  onClose: () => void; onFocus: (id: string) => void; onUpload: () => void;
  onViewChange: (canvas: boolean) => void;
}) {
  const agent = useCanvasAgent(canvasKey, access);
  const [connectorUrl, setConnectorUrl] = useState('http://127.0.0.1:17372');
  const [pairingCode, setPairingCode] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(() => !agent.connection);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [pairingPrefilled, setPairingPrefilled] = useState(false);
  useEffect(() => {
    const pair = consumePairingFragment(window.location, window.history);
    if (pair) { setConnectorUrl(pair.url); setPairingCode(pair.code); setPairingPrefilled(true); setConnectionOpen(true); }
  }, []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState<number>();
  const [railWidth, setRailWidth] = useState<number>();
  const [railResizing, setRailResizing] = useState(false);
  const [composerResizing, setComposerResizing] = useState(false);
  const [railSize, setRailSize] = useState({ width: 360, max: 640 });
  const [draft, setDraft] = useState(() => {
    try { return parseConversationDraft(localStorage.getItem(conversationDraftKey(canvasKey))); }
    catch { return emptyConversationDraft(); }
  });
  const [saveFailed, setSaveFailed] = useState(false);
  const dock = useRef<HTMLElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const drag = useRef<{ y: number; at: number; height: number } | null>(null);
  const railDrag = useRef<{ x: number; width: number } | null>(null);
  const dragged = useRef(false);
  const composing = useRef(false);
  const messageList = useRef<HTMLElement>(null);
  const followMessages = useRef(true);
  const draftRef = useRef(draft); draftRef.current = draft;
  // Keep the conversation mounted during dismissal: the slide can finish and
  // an in-flight reply is not lost just because the user looks at the canvas.
  useEffect(() => {
    if (!open) {
      setPickerOpen(false); setConnectionOpen(false); setRailResizing(false);
      setComposerResizing(false); drag.current = null; railDrag.current = null;
      if (dock.current?.contains(document.activeElement)) document.getElementById('canvas-agent-toggle')?.focus({ preventScroll: true });
    } else if (!agent.connection) {
      setConnectionOpen(true);
    }
  }, [open]);
  // A draft belongs to this canvas conversation. Selecting a node never changes it.
  const updateDraft = (next: ConversationDraft) => {
    draftRef.current = next;
    setDraft(next);
    try { setSaveFailed(!saveConversationDraft(localStorage, canvasKey, next)); }
    catch { setSaveFailed(true); }
  };
  const send = async () => {
    if (!draft.text.trim() || !ready || !agent.state.connected || agent.state.active || agent.busy) return;
    const submitted = draft;
    if (await agent.send(submitted.text, submitted.nodeIds)) {
      // Never erase the next message typed while the previous one was sending.
      if (draftRef.current.text === submitted.text) updateDraft({ ...draftRef.current, text: '' });
    }
  };
  useEffect(() => { if (followMessages.current && messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight; }, [agent.state.messages, agent.state.pending]);
  const view = (canvas: boolean) => { input.current?.blur(); setConnectionOpen(false); setPickerOpen(false); onViewChange(canvas); };
  useEffect(() => { if (canvasView) setConnectionOpen(false); setPickerOpen(false); }, [canvasView]);
  const closePicker = () => { setPickerOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const openPicker = (element: HTMLElement) => {
    trigger.current = element; setQuery(''); setChosen(draft.nodeIds); setPickerOpen(true); setCollapsed(false);
    if (window.innerWidth < 960 && element instanceof HTMLTextAreaElement) element.blur();
  };
  const selected = items.find(item => item.id === selectedId);
  const references = draft.nodeIds.map(id => ({ id, item: items.find(item => item.id === id) }));
  const results = searchableAgentNodes(items, query);
  const addReferences = (ids: string[]) => {
    updateDraft(addConversationReferences(draft, ids));
    closePicker(); setCollapsed(false); input.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const element = composer.current;
    const shell = dock.current?.closest<HTMLElement>('.app-shell');
    if (!element) return;
    const measure = () => shell?.style.setProperty('--agent-composer-height', element.getBoundingClientRect().height + 'px');
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => { observer.disconnect(); shell?.style.removeProperty('--agent-composer-height'); };
  }, []);
  useEffect(() => {
    const element = dock.current;
    if (!element) return;
    const measure = () => setRailSize({ width: Math.round(element.getBoundingClientRect().width), max: agentRailWidth(640, window.innerWidth) });
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => {
    const shell = dock.current?.closest<HTMLElement>('.app-shell');
    const measure = () => { if (railWidth) shell?.style.setProperty('--canvas-agent-width', agentRailWidth(railWidth, window.innerWidth) + 'px'); };
    measure(); window.addEventListener('resize', measure);
    return () => { window.removeEventListener('resize', measure); shell?.style.removeProperty('--canvas-agent-width'); };
  }, [railWidth]);
  useEffect(() => {
    const shell = dock.current?.closest<HTMLElement>('.app-shell');
    if (railResizing) shell?.setAttribute('data-agent-resizing', 'true');
    else shell?.removeAttribute('data-agent-resizing');
    return () => shell?.removeAttribute('data-agent-resizing');
  }, [railResizing]);
  useEffect(() => {
    if (!pickerOpen) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) setPickerOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closePicker(); } };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [pickerOpen]);
  const limits = () => agentComposerLimits(window.visualViewport?.height || window.innerHeight);
  const clampHeight = (value: number) => Math.max(limits().min, Math.min(limits().max, value));
  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    setComposerResizing(false);
    if (!start) return;
    drag.current = null;
    if (dragged.current) {
      const next = resolveComposerDrag({ startHeight: start.height, deltaY: event.clientY - start.y, elapsed: performance.now() - start.at, minHeight: limits().min, maxHeight: limits().max });
      setCollapsed(next.collapsed); if (!next.collapsed) setHeight(next.height);
      if (next.collapsed && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <aside ref={dock} id="canvas-agent-conversation" className="canvas-agent-dock" data-open={open} inert={!open} aria-hidden={!open} data-canvas-view={canvasView} data-connection-open={connectionOpen || undefined} aria-label="Agent 创作会话" onKeyDown={event => {
    if (event.key === 'Escape' && !pickerOpen && !event.nativeEvent.isComposing) { event.stopPropagation(); onClose(); document.getElementById('canvas-agent-toggle')?.focus({ preventScroll: true }); }
  }}>
    <div role="separator" className="canvas-agent-resizer" data-dragging={railResizing || undefined} aria-label="调整会话侧栏宽度" aria-controls="canvas-agent-conversation" aria-orientation="vertical" tabIndex={0} aria-valuemin={360} aria-valuemax={railSize.max} aria-valuenow={railSize.width} aria-valuetext={`${railSize.width} 像素`}
      onPointerDown={event => { if (event.button === 0) { event.preventDefault(); railDrag.current = { x: event.clientX, width: dock.current?.getBoundingClientRect().width || railSize.width }; setRailResizing(true); event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerMove={event => { const start = railDrag.current; if (start && event.currentTarget.hasPointerCapture(event.pointerId)) setRailWidth(agentRailWidth(start.width + start.x - event.clientX, window.innerWidth)); }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { railDrag.current = null; setRailResizing(false); }}
      onLostPointerCapture={() => { railDrag.current = null; setRailResizing(false); }}
      onDoubleClick={() => setRailWidth(undefined)}
      onKeyDown={event => {
        if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setRailWidth(event.key === 'Home' ? 360 : railSize.max); }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setRailWidth(agentRailWidth(railSize.width + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 32 : 8), window.innerWidth)); }
      }} />
    <header className="canvas-agent-head">
      <strong className="canvas-agent-title">{connectionOpen ? '连接 Codex' : '创作会话'}</strong>
      <nav className="canvas-agent-views" aria-label="手机工作区">
        <button type="button" aria-pressed={!canvasView} onClick={() => view(false)}>会话</button>
        <button type="button" aria-pressed={canvasView} onClick={() => view(true)}>画布</button>
      </nav>
      <button type="button" className="canvas-agent-connection" data-connected={agent.state.connected || undefined} aria-label="查看 Agent 连接" aria-expanded={connectionOpen} onClick={() => { if (canvasView) onViewChange(false); setConnectionOpen(value => !value); setPickerOpen(false); input.current?.blur(); }}><i aria-hidden="true" /><span>{agent.state.connected ? 'Codex 已连接' : 'Codex 未连接'}</span><UiIcon name="chevronDown" /></button>
      <button type="button" className="canvas-agent-icon" aria-label="关闭创作会话" title="关闭会话" onClick={onClose}><UiIcon name="close" /></button>
    </header>
    {connectionOpen && <section className="canvas-agent-connection-panel" aria-label="Agent 连接状态">
      <UiIcon name="link" /><h2>连接你自己的 Codex</h2>
      <p>无需注册画布账号。Windows 免安装包已包含运行环境，解压后双击启动即可。</p>
      {agent.connection ? <><p>已配对设备：{agent.connection.device}</p><button type="button" disabled={agent.busy} onClick={() => void agent.disconnect()}>断开连接</button>{!agent.state.connected && <button type="button" disabled={agent.busy} onClick={agent.forget}>移除本页的失效连接</button>}</> : <>
        <button className="canvas-agent-download" type="button" disabled={downloadProgress !== null} onClick={async () => {
          setDownloadError(''); setDownloadProgress(0);
          try { await downloadPortableConnector(setDownloadProgress); } catch (error) { setDownloadError(error instanceof Error ? error.message : '下载失败，请稍后重试'); }
          finally { setDownloadProgress(null); }
        }}><UiIcon name="download" />{downloadProgress === null ? '下载 Windows 免安装包' : `正在下载 · ${downloadProgress}%`}</button>
        <p className="canvas-agent-install-help">① 完整解压 ZIP　② 双击「启动黑岩连接器.cmd」　③ 按引导登录并打开画布。需要结束时运行停止脚本。</p>
        {downloadError && <p role="alert">{downloadError}</p>}
        <p className="canvas-agent-install-help"><a href={CONNECTOR_RELEASES_URL} target="_blank" rel="noopener noreferrer">GitHub Releases 下载</a> · 没有本地安装包时使用；私有仓库需要访问权限。</p>
        {pairingPrefilled && <p className="canvas-agent-install-help">连接器已自动填好地址和一次性配对码。请确认这是你刚启动的本机连接器，再点击“配对并连接”。</p>}
        <label>连接地址<input type="url" value={connectorUrl} onChange={event => setConnectorUrl(event.target.value)} autoComplete="off" /></label>
        <label>配对码<input type="password" value={pairingCode} onChange={event => setPairingCode(event.target.value)} autoComplete="off" placeholder="输入连接器显示的配对码，不是 API 密钥" /></label>
        <button type="button" disabled={agent.busy || !pairingCode.trim()} onClick={async () => { if (await agent.pair(connectorUrl, pairingCode)) { setPairingCode(''); setConnectionOpen(false); } }}>{agent.busy ? '正在连接…' : '配对并连接'}</button>
        <details className="canvas-agent-advanced-install"><summary>其他系统 / 手动启动</summary><a href={CONNECTOR_RELEASES_URL} target="_blank" rel="noopener noreferrer">下载源码连接器</a><p className="canvas-agent-start-command">需自行安装 Node.js 22.13+ 与 Codex CLI。在解压目录运行：<code>npm run agent:connector -- --origin {typeof location === 'undefined' ? 'http://127.0.0.1:8792' : location.origin}</code></p></details>
      </>}
      {agent.error && <p role="alert">{agent.error}</p>}
      <div className="canvas-agent-boundary"><strong>仅授权当前画布</strong><p>描述与画布上下文会发送给你自己的 Codex。修改节点前会请你确认；真实生成仍由你在节点中提交。当前版本仅支持同机连接，手机远程配对尚未开放。</p></div>
      <button type="button" onClick={() => setConnectionOpen(false)}>返回会话<UiIcon name="right" /></button>
    </section>}
    <section ref={messageList} className="canvas-agent-conversation" aria-label="会话消息" onScroll={event => { const el = event.currentTarget; followMessages.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {!agent.state.messages.length && <div className="canvas-agent-quiet-state">
        <span className="canvas-agent-emblem"><UiIcon name="robot" /></span>
        <h2>从一个想法开始</h2>
        <p>描述你的创作目标，<br />也可以引用画布中的素材与节点。</p>
        <span className="canvas-agent-scope">图像 · 视频 · 声音 · 3D · 短片</span>
      </div>}
      {agent.state.messages.map(message => <article className="canvas-agent-message" data-role={message.role} key={message.id}><small>{message.role === 'user' ? '你' : message.role === 'assistant' ? 'Codex' : '画布'}</small><div>{message.text}</div></article>)}
      {agent.state.pending?.tool === 'heiyan_edit_canvas' && <section className="canvas-agent-proposal" aria-label="待确认的画布修改">
        <strong>确认画布修改</strong><p>{agent.state.pending.input.summary}</p>
        <ol>{agent.state.pending.input.operations?.map((operation, index) => <li key={index}>{operation.action === 'create' ? '创建' : operation.action === 'update' ? '修改' : '连接'} · {operation.title || operation.id || `${operation.source} → ${operation.target}`}{operation.prompt !== undefined && <details><summary>查看完整描述</summary><p>{operation.prompt}</p></details>}</li>)}</ol>
        {agent.state.pending.claimed ? <p>此操作已领取，等待执行结果；不会重复修改画布。</p> : <footer><button type="button" disabled={agent.busy} onClick={() => void agent.decide(false)}>拒绝</button><button type="button" disabled={agent.busy || !ready} onClick={() => void agent.decide(true)}>确认修改</button></footer>}
      </section>}
      {agent.state.active && <p className="canvas-agent-progress" role="status">{agent.state.pending ? '等待画布操作…' : 'Codex 正在处理…'}</p>}
      {(agent.error || agent.state.error) && <p className="canvas-agent-error" role="alert">{agent.error || agent.state.error}</p>}
    </section>
    {pickerOpen && <div ref={popup} className="canvas-agent-popup" role="dialog" aria-label="引用画布节点">
      <header><strong>引用画布节点</strong><button type="button" className="canvas-agent-icon" aria-label="关闭选择面板" onClick={closePicker}><UiIcon name="close" /></button></header>
      <input autoFocus={typeof window !== 'undefined' && window.innerWidth >= 960} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称" aria-label="搜索画布节点" />
      <div className="canvas-agent-reference-list">
        {results.map(item => <button type="button" key={item.id} aria-pressed={chosen.includes(item.id)} onClick={() => setChosen(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}>
          <span className="canvas-agent-thumb"><ItemPreview item={item} /></span>
          <span>{item.title}<small>{item.reference ? '含素材' : '节点上下文'}{item.id === selectedId ? ' · 当前选中' : ''}</small></span>
          <UiIcon name={chosen.includes(item.id) ? 'check' : 'add'} />
        </button>)}
      </div>
      {!results.length && <p>{items.length ? '没有匹配的节点' : '画布还没有节点，先导入素材或创建节点。'}</p>}
      <footer><span>仅作为会话引用，不会连线</span><button type="button" disabled={!chosen.length} onClick={() => addReferences(chosen)}>添加引用{chosen.length ? ' · ' + chosen.length : ''}</button></footer>
    </div>}
    <form ref={composer} className="canvas-agent-composer" data-collapsed={collapsed} data-resizing={composerResizing || undefined} onSubmit={event => { event.preventDefault(); void send(); }} style={!collapsed && height ? { '--agent-resized-height': height + 'px' } as CSSProperties : undefined}>
      <button type="button" className="canvas-agent-grip" aria-label="拖动调整输入面板，向下滑动收起" aria-expanded={!collapsed} title="调节高度 · 双击复原"
        onDoubleClick={() => { setHeight(undefined); setCollapsed(false); }}
        onPointerDown={event => {
          if (event.button !== 0) return; event.preventDefault(); dragged.current = false;
          setComposerResizing(true);
          drag.current = { y: event.clientY, at: performance.now(), height: composer.current?.getBoundingClientRect().height || 180 };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (!drag.current || (!dragged.current && Math.abs(event.clientY - drag.current.y) < 2)) return;
          dragged.current = true; setCollapsed(false); setHeight(clampHeight(drag.current.height - (event.clientY - drag.current.y)));
        }}
        onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; setComposerResizing(false); }} onLostPointerCapture={() => { drag.current = null; setComposerResizing(false); }}
        onClick={() => { if (dragged.current) { dragged.current = false; return; } setCollapsed(value => !value); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setCollapsed(true); }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setCollapsed(false); setHeight(clampHeight((height || composer.current?.offsetHeight || 180) + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 32 : 8))); }
        }}><i aria-hidden="true" /></button>
      {collapsed ? <button type="button" className="canvas-agent-reopen" onClick={() => { setCollapsed(false); requestAnimationFrame(() => input.current?.focus()); }}><UiIcon name="edit" /><span>{draft.text || '继续描述你的想法…'}</span><UiIcon name="arrowUp" /></button>
        : <>
          {!!references.length && <div className="canvas-agent-context-references" aria-label="本次会话引用">
            {references.map(({ id, item }) => <div key={id} className="canvas-agent-context-chip" data-missing={!item || undefined}>
              <button type="button" className="canvas-agent-reference-locate" disabled={!item} title={item ? '定位：' + item.title : '原节点已不可用'} onClick={() => { view(true); onFocus(id); }}>
                <span className="canvas-agent-thumb">{item ? <ItemPreview item={item} /> : <UiIcon name="info" />}</span><span>{item?.title || '节点已不可用'}</span>
              </button>
              <button type="button" className="canvas-agent-reference-remove" aria-label={'移除引用 ' + (item?.title || id)} onClick={() => updateDraft({ ...draft, nodeIds: draft.nodeIds.filter(value => value !== id) })}><UiIcon name="close" /></button>
            </div>)}
          </div>}
          <textarea ref={input} className="canvas-agent-input" aria-label="会话描述" aria-describedby="canvas-agent-send-hint" placeholder="描述你想完成的创作，@ 引用画布" value={draft.text} maxLength={CONVERSATION_LIMIT}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onChange={event => updateDraft({ ...draft, text: event.target.value })}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && agent.state.connected) { event.preventDefault(); void send(); }
              if (event.key === '@' && !composing.current && !event.nativeEvent.isComposing) { event.preventDefault(); openPicker(event.currentTarget); }
            }} />
          <footer className="canvas-agent-composer-footer">
            <div className="canvas-agent-tools">
              <button type="button" className="canvas-agent-icon" aria-label="引用画布节点" title="引用节点 · @" aria-expanded={pickerOpen} disabled={!ready} onClick={event => openPicker(event.currentTarget)}><UiIcon name="mention" /></button>
              <button type="button" className="canvas-agent-icon" aria-label="导入素材到画布" title="导入素材" disabled={!ready} onClick={onUpload}><UiIcon name="upload" /></button>
              {selected && !draft.nodeIds.includes(selected.id) && <button type="button" className="canvas-agent-quote-selected" title={'引用：' + selected.title} onClick={() => addReferences([selected.id])}><UiIcon name="link" /><span>引用选中</span></button>}
            </div>
            {agent.state.active ? <button type="button" className="canvas-agent-send" aria-label="停止本轮会话" title="停止本轮会话" disabled={agent.busy} onClick={() => void agent.stop()}><UiIcon name="stop" /></button> : <button type="submit" className="canvas-agent-send" aria-label={agent.state.connected ? '发送消息' : '发送消息（需先连接 Codex）'} title={agent.state.connected ? '发送 · Enter，换行 · Shift+Enter' : '请先连接自己的 Codex'} disabled={!agent.state.connected || !draft.text.trim() || !ready || agent.busy}><UiIcon name="arrowUp" /></button>}
          </footer>
        </>}
    </form>
    <p className="canvas-agent-footnote" id="canvas-agent-send-hint" role={saveFailed ? 'alert' : undefined}>{saveFailed ? '无法保存草稿，请勿关闭此页面' : agent.state.connected ? '使用自己的 Codex · 修改画布前需确认' : 'Codex 未连接 · 草稿仅保存在此浏览器'}</p>
  </aside>;
}
