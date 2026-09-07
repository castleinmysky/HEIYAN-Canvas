import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GeneratedImageHand } from '../components/GeneratedImageHand';
import { GeneratorControlCardContent } from '../components/GeneratorControlPrimitives';
import { UiIcon, type UiIconName } from '../components/UiIcon';
import { assetKindLabels, canSendToAgent, nextAssetId, type AgentConnection, type ConversationMessage, type CreativeAsset, type CreativeStage } from './types';
import './AgentWorkbench.css';
import { resolveComposerDrag } from './composer-resize';

const assetIcons: Record<CreativeAsset['kind'], UiIconName> = { image: 'image', video: 'video', audio: 'audio', model: 'model3d', text: 'text' };

export function AgentGlyph() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M1.5 11v5M22.5 11v5M9 16h6"/><circle cx="8.5" cy="11.5" r=".7"/><circle cx="15.5" cy="11.5" r=".7"/></svg>;
}

function ThemeGlyph({ night }: { night: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{night ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></> : <path d="M20 14a8 8 0 0 1-10-10A8.5 8.5 0 1 0 20 14Z"/>}</svg>;
}

export function AssetVisual({ asset, className = '' }: { asset: CreativeAsset; className?: string }) {
  const [failedUrl, setFailedUrl] = useState('');
  const image = asset.previewUrl || (asset.kind === 'image' ? asset.url : undefined);
  return image && failedUrl !== image
    ? <img className={className} src={image} alt={asset.name} width={asset.width || 768} height={asset.height || 1024} draggable={false} decoding="async" onError={() => setFailedUrl(image)} />
    : <span className={`aw-asset-placeholder ${className}`}><UiIcon name={assetIcons[asset.kind]} /><span>{image ? '预览暂不可用' : assetKindLabels[asset.kind]}</span></span>;
}

export function WorkbenchDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    (dialog?.querySelector<HTMLElement>('input, select, textarea, [data-autofocus]') || dialog?.querySelector<HTMLElement>('.aw-dialog-body button:not(:disabled)'))?.focus();
    return () => { dialog?.close(); previous?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className="aw-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}><header><h2 id={titleId}>{title}</h2><button type="button" className="aw-icon-button" onClick={onClose} aria-label="关闭窗口"><UiIcon name="close" /></button></header><div className="aw-dialog-body">{children}</div></dialog>;
}

export function AgentResults({ assets, selectedId, onSelect, onLocate, onEdit }: {
  assets: CreativeAsset[]; selectedId: string;
  onSelect: (id: string) => void; onLocate: (asset: CreativeAsset) => void; onEdit: (asset: CreativeAsset) => void;
}) {
  const selected = assets.find(asset => asset.id === selectedId) || assets[0];
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const selectable = assets.map(asset => ({ ...asset, mediaUrl: asset.url || asset.id, fileName: asset.name }));
  if (!selected) return null;
  const selectedIndex = assets.indexOf(selected);
  return <section className="aw-results" aria-label="创作结果">
    <div className="aw-desktop-thumbnails">{assets.map(asset => <button key={asset.id} type="button" onClick={() => onSelect(asset.id)} aria-label={`选择${asset.name}`} aria-pressed={asset.id === selected.id}><AssetVisual asset={asset} /><span>{asset.name}</span></button>)}</div>
    <div className="aw-mobile-result" onPointerDownCapture={event => { swiped.current = false; pointer.current = event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : null; }}
      onPointerCancel={() => { pointer.current = null; }} onPointerUp={event => {
        const start = pointer.current; pointer.current = null;
        if (!start) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          swiped.current = true;
          const next = nextAssetId(assets, selected.id, dx < 0 ? 1 : -1);
          if (next) onSelect(next);
        }
      }} onClickCapture={event => { if (swiped.current) { event.preventDefault(); event.stopPropagation(); swiped.current = false; } }}>
      <div className="aw-hand-frame"><GeneratedImageHand outputs={selectable} selected={selectedIndex} onSelect={index => onSelect(assets[index].id)} renderImage={(_output, index) => <><AssetVisual asset={assets[index]} /><span className="aw-card-caption"><span>{assets[index].name}</span><small>{index + 1} / {assets.length}</small></span></>} /></div>
    </div>
    <div className="aw-result-pagination" aria-label="切换结果"><button type="button" className="aw-icon-button" aria-label="上一张结果" disabled={assets.length < 2} onClick={() => { const id = nextAssetId(assets, selected.id, -1); if (id) onSelect(id); }}><UiIcon name="back" /></button><span role="status">{selectedIndex + 1} / {assets.length}</span><button type="button" className="aw-icon-button" aria-label="下一张结果" disabled={assets.length < 2} onClick={() => { const id = nextAssetId(assets, selected.id, 1); if (id) onSelect(id); }}><UiIcon name="back" className="aw-turn-right" /></button></div>
    <div className="aw-result-actions"><button type="button" onClick={() => onLocate(selected)}><UiIcon name="fit" /><span>查看节点</span></button><button type="button" onClick={() => onEdit(selected)}><UiIcon name="edit" /><span>继续修改</span></button>{selected.url && <a href={selected.url} download={`${selected.name}${selected.kind === 'image' ? '.png' : ''}`} aria-label={`下载${selected.name}`}><UiIcon name="download" /></a>}</div>
  </section>;
}

export type AgentPanelProps = {
  connection: AgentConnection; messages: ConversationMessage[]; assets: CreativeAsset[]; stages: CreativeStage[];
  selectedId: string; reference?: CreativeAsset; draft: string; busy?: boolean; error?: string;
  modelLabel: string; ratio: string; resolution: string;
  specSummary?: string; onModel?: () => void; onReference?: () => void;
  promptEditor?: ReactNode; onQuoteNodes?: () => void; onPresets?: () => void;
  referenceCount?: number; presetCount?: number;
  onDraft: (text: string) => void; onSelect: (id: string) => void; onLocate: (asset: CreativeAsset) => void;
  onEdit: (asset: CreativeAsset) => void; onClearReference: () => void; onAttach: () => void;
  onSettings: () => void; onConnection: () => void; onClose: () => void;
  onSend?: () => void; onPreviewDraft?: () => void;
};

export function AgentPanel(props: AgentPanelProps) {
  const { connection, assets, messages, stages, draft, reference, busy = false } = props;
  const inputId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const previousDraft = useRef(draft);
  useEffect(() => {
    if (previousDraft.current !== draft && composerCollapsed) setComposerCollapsed(false);
    previousDraft.current = draft;
  }, [draft, composerCollapsed]);
  const resizeStart = useRef<{ x: number; y: number; time: number; height: number; min: number; max: number } | null>(null);
  const suppressGripClick = useRef(false);
  const composerLimits = () => {
    const form = composerRef.current;
    const height = form?.getBoundingClientRect().height || 220;
    const textareaHeight = form?.querySelector('textarea')?.getBoundingClientRect().height || 56;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const min = Math.min(height - textareaHeight + 56, viewportHeight * .7);
    return { height, min, max: Math.max(min, Math.min(viewportHeight * .7, viewportHeight - 180)) };
  };
  const previousMessage = useRef(messages.at(-1)?.id);
  useEffect(() => {
    // Chat opens at its latest result. Short phones may scroll older messages,
    // but must not land with their current result cut off by the composer.
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' }));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (previousMessage.current === messages.at(-1)?.id) return;
    previousMessage.current = messages.at(-1)?.id;
    // Do not pull the result out of view on every card change or resize.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' });
  }, [messages]);
  const preview = connection === 'preview';
  const sampleContent = preview || messages.some(message => message.sample);
  const progressIcon: UiIconName = stages.some(stage => stage.state === 'error') ? 'info' : stages.every(stage => stage.state === 'ready') ? 'check' : 'history';
  const sendAllowed = canSendToAgent(connection, draft, busy) && !!props.onSend;
  const canPreview = preview && !!props.onPreviewDraft && !!draft.trim() && !busy;
  const send = () => { if (sendAllowed) props.onSend?.(); else if (canPreview) props.onPreviewDraft?.(); };
  return <aside className="aw-panel" aria-label="创作助手">
    <header className="aw-panel-header"><div><h2>创作助手</h2><button type="button" className="aw-connection" data-state={connection} onClick={props.onConnection}><AgentGlyph /><span>Codex</span><i /><span>{({ preview: '交互预览', connected: '已连接', connecting: '连接中', disconnected: '未连接', error: '连接失败' })[connection]}</span></button></div><button type="button" className="aw-icon-button aw-panel-close" onClick={props.onClose} aria-label="收起会话"><UiIcon name="close" /></button></header>
    <div className="aw-conversation" ref={scrollRef}>
      {messages.length === 0 && <div className="aw-empty"><AgentGlyph /><h3>从一个创作想法开始</h3><p>引用素材，描述你想制作的内容。</p><button type="button" onClick={props.onAttach}><UiIcon name="upload" />添加参考素材</button></div>}
      {messages.map(message => <div key={message.id} className={`aw-message aw-message--${message.role}`}>
        {message.role === 'assistant' && <span className="aw-avatar"><AgentGlyph /></span>}
        <div className="aw-message-body">{message.reference && <AssetVisual asset={message.reference} className="aw-message-reference" />}{!!message.references?.length && <div className="aw-message-references">{message.references.map(item => <button type="button" key={item.asset.nodeId} onClick={() => props.onLocate(item.asset)} aria-label={`定位引用：${item.asset.name}`}><AssetVisual asset={item.asset} /><span>@{item.token} · {item.asset.name}</span></button>)}</div>}<p>{message.text}</p>{message.sample && message.role === 'user' && <small>示例会话</small>}</div>
      </div>)}
      {!!stages.length && <details className="aw-progress" data-complete={stages.every(stage => stage.state === 'ready')}><summary><UiIcon name={progressIcon} /><span>{sampleContent ? '示例制作步骤' : '制作步骤'}</span><small>{stages.filter(stage => stage.state === 'ready').length} / {stages.length}</small><UiIcon name="chevronDown" /></summary><ol>{stages.map(stage => <li key={stage.id} data-state={stage.state}><UiIcon name={stage.state === 'ready' ? 'check' : stage.state === 'error' ? 'info' : 'history'} /><div><strong>{stage.title}</strong><p>{stage.detail}</p></div></li>)}</ol></details>}
      <AgentResults assets={assets} selectedId={props.selectedId} onSelect={props.onSelect} onLocate={props.onLocate} onEdit={asset => { props.onEdit(asset); textareaRef.current?.focus({ preventScroll: true }); }} />
      {assets.length > 0 && <p className="aw-result-note">{assets.every(asset => asset.sample) ? '示例素材，仅用于界面验收。' : '结果已添加到画布，可继续调整。'}</p>}
      {props.error && <p className="aw-inline-error" role="alert"><UiIcon name="info" />{props.error}</p>}
    </div>
    <form ref={composerRef} className="aw-composer" aria-label="创作指令" data-collapsed={composerCollapsed} data-resized={composerHeight !== null} style={{ '--aw-composer-height': composerHeight ? `${composerHeight}px` : 'auto' } as CSSProperties} data-state={busy ? 'loading' : props.error ? 'error' : 'default'} onSubmit={event => { event.preventDefault(); send(); }} onKeyDown={event => {
      if (event.target instanceof HTMLTextAreaElement && !event.defaultPrevented && event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
    }}>
      {composerCollapsed ? <button type="button" className="aw-expand-composer" aria-label="展开输入面板" onClick={() => { setComposerCollapsed(false); setComposerHeight(null); requestAnimationFrame(() => composerRef.current?.querySelector('textarea')?.focus({ preventScroll: true })); }}><UiIcon name="edit" /><span>{draft || '继续输入创作指令…'}</span><UiIcon name="up" /></button> : <>
      <button type="button" className="aw-composer-grip" aria-label="调整输入面板高度" title="向上拖动扩大，向下拖动收起；方向键调整" aria-expanded="true"
onPointerDown={event => { if (event.button !== 0 || !event.isPrimary) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); const limits = composerLimits(); resizeStart.current = { x: event.clientX, y: event.clientY, time: performance.now(), ...limits }; suppressGripClick.current = false; }}
        onPointerMove={event => { const start = resizeStart.current; if (!start) return; const dy = event.clientY - start.y; if (Math.abs(dy) < 5 || Math.abs(event.clientX - start.x) > Math.abs(dy)) return; suppressGripClick.current = true; setComposerHeight(resolveComposerDrag({ startHeight: start.height, deltaY: dy, elapsed: performance.now() - start.time, minHeight: start.min, maxHeight: start.max }).height); }}
        onPointerUp={event => { const start = resizeStart.current; resizeStart.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (!start || !suppressGripClick.current) return; const result = resolveComposerDrag({ startHeight: start.height, deltaY: event.clientY - start.y, elapsed: performance.now() - start.time, minHeight: start.min, maxHeight: start.max }); setComposerCollapsed(result.collapsed); if (result.collapsed) composerRef.current?.querySelector('textarea')?.blur(); }}
        onPointerCancel={() => { resizeStart.current = null; suppressGripClick.current = true; }}
        onLostPointerCapture={() => { resizeStart.current = null; }}
        onClick={() => { if (suppressGripClick.current) { suppressGripClick.current = false; return; } setComposerCollapsed(true); }}
        onKeyDown={event => { if (!['ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); if (event.key === 'Escape') { setComposerCollapsed(true); return; } const limits = composerLimits(); setComposerHeight(resolveComposerDrag({ startHeight: limits.height, deltaY: event.key === 'ArrowUp' ? -64 : 64, elapsed: 1000, minHeight: limits.min, maxHeight: limits.max }).height); }}><span /></button>
      <div className="aw-generation-options" aria-label="生成规格"><button type="button" aria-label="切换生成模型" onClick={props.onModel || props.onSettings}><GeneratorControlCardContent icon="model" label="模型" value={props.modelLabel} expanded={false} /></button><button type="button" aria-label="设置生成规格" onClick={props.onSettings}><GeneratorControlCardContent icon="crop" label="规格" value={props.specSummary || `${props.ratio} · ${props.resolution}`} expanded={false} /></button></div>
      {props.promptEditor || <>{reference && <div className="aw-reference-chip"><button type="button" className="aw-reference-open" aria-label={`预览引用：${reference.name}`} onClick={() => props.onReference ? props.onReference() : props.onLocate(reference)}><AssetVisual asset={reference} /><span>{reference.name}</span></button><button type="button" aria-label="移除引用" onClick={props.onClearReference}><UiIcon name="close" /></button></div>}
      <label htmlFor={inputId} className="aw-sr-only">创作指令</label><textarea ref={textareaRef} id={inputId} value={draft} rows={2} maxLength={8000} placeholder="继续描述你的想法…" onChange={event => props.onDraft(event.target.value)} /></>}
<div className="aw-compose-actions">{props.onQuoteNodes && <button type="button" className="aw-quote-button" aria-label="引用画布节点" onClick={props.onQuoteNodes}><span aria-hidden="true">@</span>引用{!!props.referenceCount && <small className="aw-tool-count">{props.referenceCount}</small>}</button>}{props.onPresets && <button type="button" className="aw-icon-button" aria-label="提示词预设" title="提示词预设" onClick={props.onPresets}><UiIcon name="document" />{!!props.presetCount && <small className="aw-tool-count">{props.presetCount}</small>}</button>}<button type="button" className="aw-icon-button aw-attach" aria-label="添加参考素材" onClick={props.onAttach}><UiIcon name="upload" /></button>{!props.onQuoteNodes && <button type="button" className="aw-model" aria-label="Codex 连接设置" onClick={props.onConnection}><AgentGlyph />Codex<UiIcon name="chevronDown" /></button>}<span className="aw-compose-spacer" /><button type="submit" className="aw-send" disabled={!sendAllowed && !canPreview} aria-label={preview ? '预览发送指令（不执行生成）' : busy ? '正在执行' : '发送创作指令'}>{busy ? <span className="aw-spinner" /> : <UiIcon name="up" />}</button></div>
      {connection !== 'connected' && <p className="aw-connection-note">{preview ? '预览模式 · 不连接 Codex，不消耗额度' : connection === 'connecting' ? '正在连接执行服务…' : '连接 Codex 后才能执行创作指令。'}</p>}
      </>}
    </form>
  </aside>;
}

export function AgentWorkbench({ canvas, panel, project, theme, onTheme, onHistory, onSettings, mobileView, onMobileView, panelOpen, onPanelOpen, height, top = 0, keyboard = false, children }: {
  canvas: ReactNode; panel: ReactNode; project: string; theme: 'night' | 'day'; onTheme: () => void;
  onHistory: () => void; onSettings: () => void; mobileView: 'chat' | 'canvas'; onMobileView: (view: 'chat' | 'canvas') => void;
  panelOpen: boolean; onPanelOpen: (open: boolean) => void; height?: number; top?: number; keyboard?: boolean; children?: ReactNode;
}) {
  return <main className="agent-workbench" data-theme={theme} data-mobile-view={mobileView} data-panel-open={panelOpen} data-keyboard={keyboard}
    style={{ '--aw-height': height ? `${height}px` : '100dvh', '--aw-top': `${top}px` } as CSSProperties}>
    <header className="aw-topbar">
      <a className="aw-brand" href="/" aria-label="返回黑岩画布首页"><img src="/echo-ai-canvas.svg" width="28" height="28" alt="" /><span>黑岩画布</span></a>
      <span className="aw-project">{project}</span><span className="aw-preview-badge">交互预览</span>
      <button type="button" className="aw-history" onClick={onHistory}><UiIcon name="history" /><span>生成历史</span></button><span className="aw-top-spacer" />
      <button type="button" className="aw-icon-button" onClick={onTheme} aria-label={theme === 'night' ? '切换白昼模式' : '切换黑夜模式'}><ThemeGlyph night={theme === 'night'} /></button>
      <button type="button" className="aw-icon-button aw-settings" onClick={onSettings} aria-label="预览设置"><UiIcon name="settings" /></button>
      <button type="button" className="aw-agent-toggle" aria-pressed={panelOpen} onClick={() => onPanelOpen(!panelOpen)}><AgentGlyph /><span>Agent</span></button>
      <button type="button" className="aw-view-toggle" onClick={() => onMobileView(mobileView === 'chat' ? 'canvas' : 'chat')}><UiIcon name={mobileView === 'chat' ? 'organize' : 'text'} /><span>{mobileView === 'chat' ? '画布' : '会话'}</span></button>
    </header>
    <div className="aw-workspace"><section className="aw-canvas" aria-label="节点画布">{canvas}</section>{panel}</div>
    {children}
  </main>;
}
