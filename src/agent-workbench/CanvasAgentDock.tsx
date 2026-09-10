import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type PointerEvent } from 'react';
import { type CanvasNodeKind, type PromptClipboardReference } from '../components/CanvasNodes';
import { UiIcon } from '../components/UiIcon';
import { resolveComposerDrag } from './composer-resize';
import { agentComposerLimits, agentRailWidth } from './workbench-layout';
import { useCanvasAgent } from './use-canvas-agent';
import { consumePairingFragment, downloadPortableConnector, CONNECTOR_RELEASES_URL } from './portable-connector';
import type { AgentCanvasAccess } from './agent-session';
import { readAgentApprovalMode, saveAgentApprovalMode, type AgentApprovalMode } from './approval-mode';
import { AgentComposerOptions } from './AgentComposerOptions';
import { AgentMessageImages } from './AgentMessageImages';
import { addConversationReferences, CONVERSATION_LIMIT, conversationDraftKey, emptyConversationDraft, parseConversationDraft, saveConversationDraft, type ConversationDraft } from './conversation-draft';
import { AgentProjectPanel } from './AgentProjectPanel';
import { AgentApiForm } from './AgentApiForm';
import { AgentRunPanel, AgentCapabilities } from './AgentRunPanel';
import { AgentNodeThumbnail as ItemPreview } from './AgentNodeThumbnail';
import { AgentProposalCard } from './AgentActionCards';
import { AgentResultCard, parseReceipt } from './AgentResultCard';
import { generationReceipts, type JobSnapshot } from './agent-jobs';
import { AgentConversation } from './AgentConversation';
import { AgentMessageBody } from './AgentMessageBody';
import { AgentHeader, type AgentPage } from './AgentHeader';
import './agent-navigation.css';
import './CanvasAgentDock.css';
import './agent-conversation-reading.css';

export type CanvasAgentItem = {
  id: string; title: string; kind: CanvasNodeKind; state?: string; status?: string;
  reference?: PromptClipboardReference & { previewUrl?: string };
};
export function searchableAgentNodes(items: readonly CanvasAgentItem[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter(item => !needle || (item.title + ' ' + item.id).toLocaleLowerCase().includes(needle));
}
export function CanvasAgentDock({ canvasKey, open = true, canvasView = false, items, selectedId, ready, access, onClose, onFocus, onUpload, onViewChange, followCanvas = true, onFollowCanvas }: {
  canvasKey: string; items: CanvasAgentItem[]; selectedId?: string | null; ready: boolean;
  open?: boolean;
  canvasView?: boolean;
  followCanvas?: boolean; onFollowCanvas?: (value: boolean) => void;
  access?: AgentCanvasAccess;
  onClose: () => void; onFocus: (id: string) => void; onUpload: () => void;
  onViewChange: (canvas: boolean) => void;
}) {
  const [approvalMode, setApprovalMode] = useState<AgentApprovalMode>(() => typeof localStorage === 'undefined' ? 'ask' : readAgentApprovalMode(localStorage, canvasKey));
  const agent = useCanvasAgent(canvasKey, access, approvalMode);
  const [page, setPage] = useState<AgentPage>('chat');
  useEffect(() => { setPage('chat'); }, [canvasKey]);
  const generationRuns = useMemo(() => generationReceipts(agent.project.receipts), [agent.project.receipts]);
  const liveJobs = useMemo(() => { if (!ready || !access?.jobs) return []; try { return access.jobs(generationRuns.flatMap(r => r.targets)); } catch { return []; } }, [ready, access, generationRuns, items]);
  const observedJobs = useRef(new Map<string, string>());
  useEffect(() => {
    const done: JobSnapshot[] = [];
    for (const job of liveJobs) { const key = job.nodeId + ':' + job.jobId, previous = observedJobs.current.get(key); if (previous && previous !== 'succeeded' && job.state === 'succeeded') done.push(job); }
    observedJobs.current = new Map(liveJobs.map(j => [j.nodeId + ':' + j.jobId, j.state]));
    if (done.length) access?.reveal?.(done.map(j => j.nodeId), `${done.length} 个生成任务已完成，可查看结果`, true);
  }, [liveJobs, access]);
  const generationPreview = useMemo(() => { if (!ready || agent.state.pending?.tool !== 'heiyan_request_generation') return undefined; try { return access?.read([], { nodeIds: agent.state.pending.input.nodeIds }); } catch { return undefined; } }, [agent.state.pending, access, ready, items]);
  const imageReadPreview = useMemo(() => { const p = agent.state.pending; if (!ready || p?.tool !== 'heiyan_read_images' || !p.input.jobIds || !access?.jobs) return []; try { return access.jobs((p.input.nodeIds || []).map((nodeId, i) => ({ nodeId, jobId: p.input.jobIds![i] }))); } catch { return []; } }, [agent.state.pending, access, ready, items]);
  const receiptById = useMemo(() => new Map(agent.project.receipts.map(r => [r.id, r])), [agent.project.receipts]);
  const [rememberImages, setRememberImages] = useState(false);
  useEffect(() => setRememberImages(false), [agent.state.pending?.id]);
  const [connectionMode, setConnectionMode] = useState<'codex' | 'api'>('codex');
  const [connectorUrl, setConnectorUrl] = useState('http://127.0.0.1:17372');
  const [pairingCode, setPairingCode] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(() => !agent.connection);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [images, setImages] = useState<Array<{ id: string; url: string; name: string; bytes: number }>>([]);
  const [attachmentError, setAttachmentError] = useState('');
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
    } else if (!agent.connection && !agent.api) {
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
    if ((!draft.text.trim() && !images.length) || !ready || !agent.state.connected || agent.busy) return;
    if (agent.state.active) {
      if (images.length) { setAttachmentError('执行中可补充文字；图片请在本轮结束后发送。'); return; }
      const text = draft.text;
      if (await agent.steer(text)) { if (draftRef.current.text === text) updateDraft({ ...draftRef.current, text: '' }); }
      return;
    }
    const submitted = draft;
    const submittedImages = images;
    const text = submitted.text.trim() || '请分析这些图片，并结合当前画布说明可执行的下一步。';
    if (await agent.send(text, submitted.nodeIds, submittedImages.map(image => image.url))) {
      // Never erase the next message typed while the previous one was sending.
      if (draftRef.current.text === submitted.text) updateDraft({ ...draftRef.current, text: '' });
      setImages(current => current.map(image => image.id).join() === submittedImages.map(image => image.id).join() ? [] : current);
    }
  };
  const pasteImages = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault(); setAttachmentError('');
    if (!(agent.api?.vision || agent.connection?.capabilities?.includes('image_input'))) { setAttachmentError(agent.connection ? '当前连接未启用图片输入，请检查 API 检测结果或更新连接器' : '请先连接支持图片输入的 Codex 连接器'); return; }
    const accepted = files.filter(file => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type));
    if (accepted.length !== files.length) { setAttachmentError('仅支持 PNG、JPEG 或 WebP 图片'); return; }
    if (images.length + accepted.length > 4 || accepted.some(file => file.size > 5 * 1024 * 1024) || images.reduce((sum, image) => sum + image.bytes, 0) + accepted.reduce((sum, file) => sum + file.size, 0) > 12 * 1024 * 1024) { setAttachmentError('每次最多 4 张，单张不超过 5 MB、合计不超过 12 MB'); return; }
    const loaded = await Promise.all(accepted.map(file => new Promise<{ id: string; url: string; name: string; bytes: number }>((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error('无法读取剪贴板图片')); reader.onload = () => resolve({ id: crypto.randomUUID(), url: String(reader.result), name: file.name || '剪贴板图片', bytes: file.size }); reader.readAsDataURL(file);
    })));
    setImages(current => [...current, ...loaded]);
  };
  useEffect(() => { if (followMessages.current && messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight; }, [agent.state.messages, agent.state.pending]);
  const view = (canvas: boolean) => { input.current?.blur(); setPage('chat'); setConnectionOpen(false); setPickerOpen(false); onViewChange(canvas); };
  const chooseApprovalMode = (mode: AgentApprovalMode) => { setApprovalMode(mode); saveAgentApprovalMode(localStorage, mode, canvasKey); };
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

  return <aside ref={dock} id="canvas-agent-conversation" className="canvas-agent-dock" data-open={open} data-page={connectionOpen ? 'settings' : page} inert={!open} aria-hidden={!open} data-canvas-view={canvasView} data-connection-open={connectionOpen || undefined} aria-label="Agent 创作会话" onKeyDown={event => {
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
    <AgentHeader page={connectionOpen ? 'settings' : page} connected={agent.state.connected} active={agent.state.active} waiting={!!agent.state.pending && !agent.state.pending.claimed}
      onPage={next => { input.current?.blur(); setPickerOpen(false); onViewChange(false); setPage(next); setConnectionOpen(next === 'settings'); }}
      onView={view} onClose={onClose} />
    {connectionOpen && <section className="canvas-agent-connection-panel" aria-label="Agent 连接状态">
      <UiIcon name="link" /><h2>选择 Agent 连接方式</h2>
      <label className="agent-follow-setting"><input type="checkbox" checked={followCanvas} disabled={!onFollowCanvas} onChange={event => onFollowCanvas?.(event.target.checked)} />跟随画布变化</label>
      <div className="agent-connection-tabs"><button type="button" aria-pressed={connectionMode === 'codex'} onClick={() => setConnectionMode('codex')}>本机 Codex</button><button type="button" aria-pressed={connectionMode === 'api'} onClick={() => setConnectionMode('api')}>官方 / 自定义 API</button></div>
      {connectionMode === 'api' && <AgentApiForm busy={agent.busy || agent.state.active} testing={agent.testingConnection} progress={agent.connectionProgress} cancel={agent.cancelConnectionTest} connect={async profile => { const ok = await agent.connectApi(profile); return ok; }} />}
      {connectionMode === 'codex' && <>
      <p>无需注册画布账号。Windows 免安装包已包含运行环境，解压后双击启动；后续普通更新会在启动时自动完成。</p>
      {agent.connection ? <><p>已配对设备：{agent.connection.device}</p><button type="button" disabled={agent.busy} onClick={() => void agent.disconnect()}>断开连接</button>{!agent.state.connected && <button type="button" disabled={agent.busy} onClick={agent.forget}>移除本页的失效连接</button>}</> : <>
        <button className="canvas-agent-download" type="button" disabled={downloadProgress !== null} onClick={async () => {
          setDownloadError(''); setDownloadProgress(0);
          try { await downloadPortableConnector(setDownloadProgress); } catch (error) { setDownloadError(error instanceof Error ? error.message : '下载失败，请稍后重试'); }
          finally { setDownloadProgress(null); }
        }}><UiIcon name="download" />{downloadProgress === null ? '下载 Windows 免安装包' : `正在下载 ${downloadProgress}%`}</button>
        {downloadError && <p className="canvas-agent-download-feedback" role="alert">{downloadError}</p>}
        <p className="canvas-agent-install-help">① 解压 ZIP　② 双击「启动黑岩连接器.cmd」　③ 打开当前画布并配对。连接器使用本机 Codex 登录。</p>
        <p><a href={CONNECTOR_RELEASES_URL} target="_blank" rel="noreferrer">从 GitHub Releases 下载连接器</a></p>
        {pairingPrefilled && <p className="canvas-agent-install-help">连接器已自动填好地址和一次性配对码。请确认这是你刚启动的本机连接器，再点击“配对并连接”。</p>}
        <label>连接地址<input type="url" value={connectorUrl} onChange={event => setConnectorUrl(event.target.value)} autoComplete="off" /></label>
        <label>配对码<input type="password" value={pairingCode} onChange={event => setPairingCode(event.target.value)} autoComplete="off" placeholder="输入连接器显示的配对码，不是 API 密钥" /></label>
        <button type="button" disabled={agent.busy || !pairingCode.trim()} onClick={async () => { if (await agent.pair(connectorUrl, pairingCode)) { setPairingCode(''); view(false); } }}>{agent.busy ? '正在连接…' : '配对并连接'}</button>
        <details className="canvas-agent-advanced-install"><summary>其他系统 / 手动启动</summary><a href="/downloads/heiyan-codex-connector.zip" download>下载源码连接器</a><p className="canvas-agent-start-command">需自行安装 Node.js 22+ 与 Codex。在解压目录运行：<code>npm run agent:connector -- --origin {typeof location === 'undefined' ? 'http://127.0.0.1:8792' : location.origin}</code></p></details>
      </>}
      </>}
      {connectionMode === 'api' && agent.api && <button type="button" disabled={agent.busy || agent.state.active} onClick={() => void agent.disconnect()}>断开 API</button>}
      <AgentCapabilities capabilities={agent.capabilities} />
      {!agent.api && agent.state.connected && !agent.connection?.capabilities?.includes('generation_results') && <p>当前连接器支持基础操作。空间排版、等待生成和结果评估需要更新连接器并重新配对。</p>}
      {agent.error && <p role="alert">{agent.error}</p>}
      <div className="canvas-agent-boundary"><strong>仅授权当前画布</strong><p>相关节点、项目要求和你批准的图片会发送给当前选中的模型服务。Agent 可分析附图、提议修改画布，也可集中请求生成；真实生成永远需要你明确确认。读取画布图片前会列出节点并请求确认，可选择仅在本轮内允许再次读取这些节点。项目记忆随画布保存，API 密钥不写入会话。</p></div>
      <button type="button" onClick={() => view(false)}>返回会话<UiIcon name="right" /></button>
    </section>}
    <section className="agent-function-page" hidden={connectionOpen || !['memory', 'progress'].includes(page)} aria-label={page === 'memory' ? '项目记忆' : '执行进度'}>
    <div hidden={page !== 'memory'}>
    <AgentProjectPanel expanded project={agent.project} ready={agent.memoryReady} error={agent.memoryError} busy={agent.busy || agent.state.active} save={agent.saveMemory} reload={agent.reloadMemory} searchTools={{ search: agent.search, focus: id => { view(true); onFocus(id); }, indexState: agent.indexState, configure: agent.configureSemantic, clear: agent.clearSemantic, build: agent.buildIndex, stop: agent.stopIndex, busy: agent.busy || agent.state.active }} />
    </div><div hidden={page !== 'progress'}>
    <AgentRunPanel expanded activity={agent.activity} trace={agent.trace} active={agent.state.active} usage={agent.runUsage} api={agent.api} connectorUsage={agent.state.usage} updateBudget={agent.updateBudget} focus={id => { view(true); onFocus(id); }} nodeTitle={id => items.find(item => item.id === id)?.title || id} />
    </div></section>
    {page === 'skills' && !connectionOpen && <section className="agent-function-page agent-skill-placeholder" aria-label="Skill"><UiIcon name="toolbox" /><h2>Skill</h2><p>入口已预留，尚未接入技能。</p><button type="button" onClick={() => setPage('chat')}>返回会话</button></section>}
    <section ref={messageList} className="canvas-agent-conversation" aria-label="会话消息" onScroll={event => { const el = event.currentTarget; followMessages.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {!agent.state.messages.length && <div className="canvas-agent-quiet-state">
        <span className="canvas-agent-emblem"><UiIcon name="robot" /></span>
        <h2>从一个想法开始</h2>
        <p>描述你的创作目标，<br />也可以引用画布中的素材与节点。</p>
        <span className="canvas-agent-scope">图像 · 视频 · 声音 · 3D · 短片</span>
      </div>}
      <AgentConversation messages={agent.state.messages} renderMessage={message => <article className="canvas-agent-message" data-role={message.role} id={'agent-message-' + message.id} tabIndex={-1} key={message.id}><small>{message.role === 'user' ? '你' : message.role === 'assistant' ? 'Agent' : '画布'}</small><div>{message.role === 'notice' && message.id.startsWith('execution:') && receiptById.has(message.id.slice(10)) ? <AgentResultCard receipt={receiptById.get(message.id.slice(10))!} jobs={liveJobs} receipts={agent.project.receipts} items={items} connected={agent.state.connected} active={agent.busy || agent.state.active} focus={(ids, label) => { view(true); if (access?.reveal) access.reveal(ids, label); else if (ids[0]) onFocus(ids[0]); }} followup={(text, ids) => { view(false); void agent.send(text, ids); }} /> : message.role === 'assistant' ? <AgentMessageBody text={message.text} /> : message.text}</div>{message.imageCount ? <><AgentMessageImages canvasKey={canvasKey} messageId={message.id} /><em>附图 {message.imageCount} 张 · {message.model}{message.effort ? ` · ${message.effort}` : ''}</em></> : null}</article>} />
      {agent.state.pending?.tool === 'heiyan_edit_canvas' && <AgentProposalCard pending={agent.state.pending} items={items} access={access} ready={ready} busy={agent.busy} focus={id => { view(true); onFocus(id); }} decide={approved => void agent.decide(approved)} revise={agent.api || agent.connection?.capabilities?.includes('steering') ? () => void agent.steer('请重新读取当前画布，核对并修正待确认的方案。之前尚未执行的方案作废。') : undefined} />}
      {agent.state.pending?.tool === 'heiyan_request_generation' && <section id="agent-pending-proposal" tabIndex={-1} className="canvas-agent-proposal canvas-agent-generation-proposal" aria-label="待确认的真实生成">
        <strong>确认真实生成</strong><p>{agent.state.pending.input.summary}</p>
        <div className="agent-generation-plan">{agent.state.pending.input.nodeIds?.map(id => { const item = items.find(n => n.id === id), node = generationPreview?.nodes.find(n => n.id === id); return <article key={id}><header>{item && <span className="canvas-agent-thumb"><ItemPreview item={item} /></span>}<strong>{item?.title || '原节点不可用'}</strong>{item && <button type="button" onClick={() => { view(true); onFocus(id); }}>定位</button>}</header><p>{generationPreview?.availableModels?.find(m => m.id === node?.model)?.name || node?.model || '尚未配置模型'}</p><p>{[node?.settings?.ratio, node?.settings?.resolution, node?.settings?.count ? `${node.settings.count} 个` : '', node?.settings?.duration ? `${node.settings.duration} 秒` : ''].filter(Boolean).join(' · ')}</p><details><summary>查看描述与输入</summary><p>{node?.prompt || '无文字描述'}</p><p>输入：{generationPreview?.edges.filter(e => e.target === id).map(e => items.find(n => n.id === e.source)?.title || '来源节点').join('、') || '无节点引用'}</p></details></article>; })}</div>
        {generationPreview?.revision !== agent.state.pending.revision && <p role="alert">画布已变化，请重新读取并核对本次生成配置。</p>}
        <p>将使用各节点当前的模型、规格和输入，可能产生资源消耗。</p>
        {agent.state.pending.claimed ? <p>生成请求已领取，正在提交；不会重复执行。</p> : <footer><button type="button" disabled={agent.busy} onClick={() => void agent.decide(false)}>取消本次操作</button><button type="button" className="agent-confirm-action" disabled={agent.busy || !ready || generationPreview?.revision !== agent.state.pending.revision} onClick={() => void agent.decide(true)}>确认并生成</button></footer>}
      </section>}
      {agent.state.pending && ['heiyan_read_images', 'heiyan_project_checkpoint'].includes(agent.state.pending.tool) && <section id="agent-pending-proposal" tabIndex={-1} className="canvas-agent-proposal">
        <strong>{agent.state.pending.tool === 'heiyan_read_images' ? '确认读取图片' : '确认保存项目记忆'}</strong>
        {agent.state.pending.tool === 'heiyan_read_images' ? <><p>将以下节点图片发送给当前模型：</p><ul>{agent.state.pending.input.nodeIds?.map((id, i) => { const item = items.find(n => n.id === id), output = imageReadPreview[i]?.outputs[agent.state.pending?.input.outputIndexes?.[i] || 0]; return <li className="agent-image-permission" key={id + ':' + i}><span className="canvas-agent-thumb">{agent.state.pending?.input.jobIds ? output?.mediaUrl && imageReadPreview[i]?.type === 'image' ? <img src={output.previewUrl || output.mediaUrl} alt="待发送的指定结果" /> : '不可用' : item ? <ItemPreview item={item} /> : null}</span><span>{item?.title || id}{agent.state.pending?.input.jobIds ? ` · 任务 ${agent.state.pending.input.jobIds[i].slice(-6)} · 第 ${(agent.state.pending.input.outputIndexes?.[i] || 0) + 1} 个结果` : ''}</span></li>; })}</ul></> : <>{(['goal', 'requirements', 'progress', 'summary'] as const).map(key => agent.state.pending?.input[key] !== undefined ? <div key={key}><b>{({ goal: '目标', requirements: '明确要求', progress: '进度', summary: '摘要' })[key]}</b><p>{agent.state.pending?.input[key]}</p></div> : null)}</>}
        {agent.state.pending.tool === 'heiyan_read_images' && <p>检查图会按传输上限缩小，原始素材保留在节点中。</p>}
        {agent.state.pending.tool === 'heiyan_read_images' && !agent.state.pending.claimed && <label className="agent-api-check"><input type="checkbox" checked={rememberImages} onChange={e => setRememberImages(e.target.checked)} />本轮允许再次读取以上指定图片，结束后失效</label>}
        {agent.state.pending.claimed ? <p>操作已领取，请等待结果。</p> : <footer><button type="button" disabled={agent.busy} onClick={() => void agent.decide(false)}>取消本次操作</button><button type="button" className="agent-confirm-action" disabled={agent.busy || !ready || !agent.memoryReady} onClick={() => void agent.decide(true, rememberImages)}>{agent.state.pending.tool === 'heiyan_read_images' ? '允许读取图片' : '确认保存记忆'}</button></footer>}
      </section>}
      {agent.state.active && <p className="canvas-agent-progress" role="status">{!agent.state.connected ? '状态连接中断，执行结果待核实；请勿重复发送。' : agent.state.pending?.tool === 'heiyan_request_generation' ? '等待生成确认…' : agent.state.pending?.tool === 'heiyan_read_generation' ? '等待素材生成，仍可补充要求或停止等待…' : agent.state.pending?.tool === 'heiyan_review_result' ? '正在记录结果检查…' : agent.state.pending ? '等待画布操作…' : 'Agent 正在处理…'}</p>}
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
      {agent.state.pending && !agent.state.pending.claimed && ['heiyan_edit_canvas', 'heiyan_request_generation', 'heiyan_read_images', 'heiyan_project_checkpoint'].includes(agent.state.pending.tool) && <button type="button" className="agent-pending-jump" onClick={() => { const card = document.getElementById('agent-pending-proposal'); card?.scrollIntoView({ block: 'start', behavior: 'instant' }); card?.focus({ preventScroll: true }); }}><span>有一项操作等待你确认</span><span>查看方案 ↑</span></button>}
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
          {!!images.length && <div className="canvas-agent-image-attachments" aria-label="本轮图片附件">{images.map(image => <figure key={image.id}><img src={image.url} alt={image.name} /><button type="button" aria-label={'移除 ' + image.name} onClick={() => setImages(current => current.filter(item => item.id !== image.id))}><UiIcon name="close" /></button></figure>)}</div>}
          <textarea ref={input} className="canvas-agent-input" aria-label="会话描述" aria-describedby="canvas-agent-send-hint" placeholder={agent.state.active ? "补充要求，Agent 会在下一次操作前处理" : "描述创作需求，@ 引用画布，也可直接粘贴图片"} value={draft.text} maxLength={CONVERSATION_LIMIT}
            onPaste={event => void pasteImages(event)}
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

            <AgentComposerOptions mode={approvalMode} onMode={chooseApprovalMode} models={agent.models} model={agent.model} effort={agent.effort} onModel={agent.setModel} onEffort={agent.setEffort} active={agent.state.active} />
            <div className="canvas-agent-submit-actions">{agent.state.active && !!draft.text.trim() && <button type="submit" className="agent-steer-button" disabled={agent.busy || !(agent.api || agent.connection?.capabilities?.includes('steering'))}>补充要求</button>}
            {agent.state.active ? <button type="button" className="canvas-agent-send" aria-label="停止本轮会话" title="停止本轮会话" disabled={agent.busy} onClick={() => void agent.stop()}><UiIcon name="stop" /></button> : <button type="submit" className="canvas-agent-send" aria-label={agent.state.connected ? '发送消息' : '发送消息（需先连接 Agent）'} title={agent.state.connected ? '发送 · Enter，换行 · Shift+Enter' : '请先连接 Agent'} disabled={!agent.state.connected || !agent.memoryReady || (!draft.text.trim() && !images.length) || !ready || agent.busy}><UiIcon name="arrowUp" /></button>}
            </div>
          </footer>
          {attachmentError && <p className="canvas-agent-attachment-error" role="alert">{attachmentError}</p>}
        </>}
    </form>
    <p className="canvas-agent-footnote" id="canvas-agent-send-hint" role={saveFailed ? 'alert' : undefined}>{saveFailed ? '无法保存草稿，请勿关闭此页面' : agent.state.connected ? approvalMode === 'full' ? '全自动 · 删除、覆盖与付费生成无需确认' : approvalMode === 'assist' ? '当前连接 · 安全操作自动批准' : '项目会话自动保存 · 修改画布前需确认' : 'Agent 未连接 · 草稿仅保存在此浏览器'}</p>
  </aside>;
}
