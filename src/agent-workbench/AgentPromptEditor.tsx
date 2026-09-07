import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { PromptTokenComposer, resolvePromptTokenSelectionTags } from '../components/PromptTokenComposer';
import { supportsNegativePromptTokens, type PromptTokenTarget } from '../prompt-token-library';
import { UiIcon } from '../components/UiIcon';
import { AssetVisual, WorkbenchDialog } from './AgentWorkbench';
import { assetKindLabels, type CreativeAsset } from './types';
import { activeCanvasMention, findCanvasAssets, insertCanvasReference, removeCanvasReference, PROMPT_LIMIT, type AgentPromptDraft, type TextRange } from './prompt-draft';
import './AgentPromptEditor.css';

export function AgentPromptEditor({ value, assets, onChange, onPreview, inputRef, selection, adapter, target }: {
  value: AgentPromptDraft; assets: CreativeAsset[]; onChange: (value: AgentPromptDraft) => void;
  onPreview: (asset: CreativeAsset) => void; inputRef: RefObject<HTMLTextAreaElement | null>;
  selection: RefObject<TextRange>; adapter: string; target: PromptTokenTarget;
}) {
  const id = useId(), listId = useId();
  const [mention, setMention] = useState<ReturnType<typeof activeCanvasMention>>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');
  const composing = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpen = !!mention;
  useLayoutEffect(() => {
    const menu = menuRef.current, input = inputRef.current;
    if (!menuOpen || !menu || !input) return;
    const place = () => {
      const rect = input.getBoundingClientRect();
      const top = window.visualViewport?.offsetTop || 0;
      const space = Math.max(0, rect.top - top - 8);
      menu.style.left = `${Math.max(8, rect.left)}px`;
      menu.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
      menu.style.maxHeight = `${Math.min(300, space)}px`;
      menu.style.top = `${rect.top - Math.min(menu.scrollHeight + 2, 300, space) - 4}px`;
    };
    menu.showPopover(); place();
    const observer = new ResizeObserver(place); observer.observe(menu);
    window.addEventListener('resize', place); window.visualViewport?.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.visualViewport?.removeEventListener('resize', place); menu.hidePopover(); };
  }, [menuOpen, inputRef]);
  const matches = findCanvasAssets(assets, mention?.query || '').slice(0, 8);
  const tags = resolvePromptTokenSelectionTags(adapter, value.promptTokenIds, supportsNegativePromptTokens(adapter) ? value.negativePromptTokenIds : [], target);
  const sync = (element: HTMLTextAreaElement) => {
    selection.current = { start: element.selectionStart, end: element.selectionEnd };
    const next = composing.current ? null : activeCanvasMention(element.value, selection.current);
    if (next?.start !== mention?.start || next?.end !== mention?.end || next?.query !== mention?.query) setActive(0);
    setMention(next);
  };
  const insert = (asset: CreativeAsset) => {
    const result = insertCanvasReference(value, asset, mention || selection.current);
    onChange(result.draft); setError(result.error); setMention(null);
    selection.current = { start: result.caret, end: result.caret };
    requestAnimationFrame(() => { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.setSelectionRange(result.caret, result.caret); });
  };
  return <div className="aw-prompt-editor">
    {(!!value.references.length || !!tags.length) && <div className="aw-prompt-context">
    {!!value.references.length && <div className="aw-prompt-references" aria-label="本次引用的节点">{value.references.map(reference => <div className="aw-prompt-reference" key={reference.asset.nodeId}>
      <button type="button" onClick={() => onPreview(reference.asset)} aria-label={`预览引用：${reference.asset.name}`}><AssetVisual asset={reference.asset} /><span><b>@{reference.token}</b><small>{reference.asset.name}</small></span></button>
      <button type="button" aria-label={`移除引用：${reference.asset.name}`} onClick={() => onChange(removeCanvasReference(value, reference.asset.nodeId))}><UiIcon name="close" /></button>
    </div>)}</div>}
    {!!tags.length && <div className="aw-selected-presets" aria-label="已选提示词">{tags.map(tag => <button type="button" key={tag.id} title={tag.value} aria-label={`移除预设：${tag.label}`} onClick={() => onChange({ ...value, [tag.scope === 'negative' ? 'negativePromptTokenIds' : 'promptTokenIds']: (tag.scope === 'negative' ? value.negativePromptTokenIds : value.promptTokenIds).filter(id => id !== tag.id) })}>{tag.scope === 'negative' && '排除：'}{tag.label}<UiIcon name="close" /></button>)}</div>}
    </div>}
    <label htmlFor={id} className="aw-sr-only">创作指令</label>
    <textarea id={id} ref={inputRef} rows={2} maxLength={PROMPT_LIMIT} value={value.text} placeholder="描述你的想法，输入 @ 引用画布节点…"
      aria-controls={mention ? listId : undefined} aria-expanded={!!mention} aria-autocomplete="list" aria-activedescendant={mention && matches[active] ? `${listId}-${active}` : undefined} aria-describedby={error ? `${id}-error` : undefined}
      onChange={event => { onChange({ ...value, text: event.target.value }); setError(''); sync(event.currentTarget); }}
      onSelect={event => sync(event.currentTarget)} onFocus={event => sync(event.currentTarget)} onBlur={event => { if (!menuRef.current?.contains(event.relatedTarget as Node | null)) setMention(null); }}
      onCompositionStart={() => { composing.current = true; setMention(null); }} onCompositionEnd={event => { composing.current = false; sync(event.currentTarget); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || composing.current || !mention) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMention(null); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => matches.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : 0); }
        else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && matches[active]) { event.preventDefault(); event.stopPropagation(); insert(matches[active]); }
      }} />
    {mention && <div ref={menuRef} popover="auto" className="aw-mention-menu" onToggle={event => { if (event.newState === 'closed') setMention(null); }} onMouseDown={event => event.preventDefault()}><div className="aw-mention-heading"><span>引用画布节点</span><small>↑ ↓ 选择 · Enter 插入</small></div><div id={listId} role="listbox" aria-label="画布节点建议">{matches.map((asset, index) => <button id={`${listId}-${index}`} key={asset.nodeId} type="button" tabIndex={-1} role="option" aria-selected={index === active} onClick={() => insert(asset)}><AssetVisual asset={asset} /><span><strong>{asset.name}</strong><small>{assetKindLabels[asset.kind]} · {asset.nodeId}</small></span></button>)}{!matches.length && <p>没有匹配的节点，试试名称或素材类型。</p>}</div></div>}
    {error && <p id={`${id}-error`} role="alert" className="aw-inline-error">{error}</p>}
  </div>;
}

export function CanvasReferencePicker({ assets, current, onInsert, onCanvas, onClose }: {
  assets: CreativeAsset[]; current: AgentPromptDraft; onInsert: (assets: CreativeAsset[]) => void; onCanvas: () => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const matches = findCanvasAssets(assets, query);
  return <WorkbenchDialog title="引用画布节点" onClose={onClose}>
    <label>搜索节点<input value={query} onChange={event => setQuery(event.target.value)} placeholder="名称、类型或节点 ID" /></label>
    <div className="aw-node-picker" aria-label="可引用节点">{matches.map(asset => <button type="button" key={asset.nodeId} aria-pressed={selected.includes(asset.nodeId)} onClick={() => setSelected(ids => ids.includes(asset.nodeId) ? ids.filter(id => id !== asset.nodeId) : [...ids, asset.nodeId])}><AssetVisual asset={asset} /><span><strong>{asset.name}</strong><small>{assetKindLabels[asset.kind]} · {current.references.some(item => item.asset.nodeId === asset.nodeId) ? '已引用' : asset.nodeId}</small></span><UiIcon name={selected.includes(asset.nodeId) ? 'check' : 'add'} /></button>)}</div>
    {!matches.length && <p role="status">{assets.length ? '没有匹配的节点，请换个名称搜索。' : '画布还没有节点，可先添加素材或文本。'}</p>}
    <div className="aw-dialog-actions aw-picker-actions"><button type="button" onClick={onCanvas}><UiIcon name="fit" />去画布点选</button><button type="button" className="aw-primary" disabled={!selected.length} onClick={() => onInsert(selected.flatMap(id => assets.find(asset => asset.nodeId === id) || []))}>引用{selected.length ? ` ${selected.length} 个节点` : '所选节点'}</button></div>
  </WorkbenchDialog>;
}

export function AgentPresetPicker({ value, adapter, target, onChange, onClose }: {
  value: AgentPromptDraft; adapter: string; target: PromptTokenTarget; onChange: (value: AgentPromptDraft) => void; onClose: () => void;
}) {
  return <WorkbenchDialog title="提示词预设" onClose={onClose}><div className="aw-preset-picker">
    {/* No persistenceKey: reuse the node preset UI without reading/writing real canvas preferences. */}
    <PromptTokenComposer layout="panel" adapter={adapter} target={target} promptTokenIds={value.promptTokenIds} negativePromptTokenIds={value.negativePromptTokenIds} onChange={patch => onChange({ ...value, ...patch })} />
  </div><button type="button" className="aw-primary" onClick={onClose}>完成</button></WorkbenchDialog>;
}
