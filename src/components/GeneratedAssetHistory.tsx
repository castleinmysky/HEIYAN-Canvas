import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canvasAssetDownloadUrl, nodeResourceDownloadFileName } from '../media-download';
import { generatedAssetItemsFromJobs, groupGeneratedAssetsByDay, type GeneratedAssetHistoryItem, type GeneratedAssetKind, type GenerationHistoryJob } from '../generation-history';
import { generationHistoryInterfaceCopy, translateCanvasInterfaceText, type CanvasInterfaceLanguage } from '../interface-language';
import { UiIcon, type UiIconName } from './UiIcon';
import './GeneratedAssetHistory.css';
import { HistoryImageViewer } from './HistoryImageViewer';

type RequestLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const tabs: Array<{ id: GeneratedAssetKind; icon: UiIconName }> = [
  { id: 'image', icon: 'image' }, { id: 'video', icon: 'video' }, { id: 'audio', icon: 'audio' }, { id: 'model', icon: 'model3d' },
];
type HistoryCopy = ReturnType<typeof generationHistoryInterfaceCopy>;
const assetTitle = (item: GeneratedAssetHistoryItem, copy: HistoryCopy) => item.nodeTitle?.trim() || copy[item.kind] || copy.generated;
const assetDownloadName = (item: GeneratedAssetHistoryItem, copy: HistoryCopy) => nodeResourceDownloadFileName(assetTitle(item, copy), item.fileName, item.mediaUrl, item.kind, { index: item.outputIndex, count: item.outputCount || 1 });
const assetMeta = (item: GeneratedAssetHistoryItem, copy: HistoryCopy) => item.width && item.height ? item.width + ' × ' + item.height : item.duration ? item.duration.toFixed(item.duration < 10 ? 1 : 0) + ' s' : item.modelName || copy.local;

function AssetVisual({ item, copy, expanded = false }: { item: GeneratedAssetHistoryItem; copy: HistoryCopy; expanded?: boolean }) {
  if (item.kind === 'image' && expanded) return <HistoryImageViewer src={item.mediaUrl} alt={assetTitle(item, copy)} />;
  if (item.kind === 'image') return <img src={item.previewUrl || item.mediaUrl} alt={assetTitle(item, copy)} loading="lazy" decoding="async" onError={event => { if (event.currentTarget.dataset.fallback) return; event.currentTarget.dataset.fallback = 'true'; event.currentTarget.src = item.mediaUrl; }} />;
  if (item.kind === 'video') return <video src={item.mediaUrl} poster={item.previewUrl} preload={expanded ? 'metadata' : 'none'} controls={expanded} muted={!expanded} playsInline />;
  if (item.kind === 'audio') return <div className="generated-asset-audio"><UiIcon name="audio" /><span>{expanded ? copy.playAudio : copy.audioResult}</span>{expanded && <audio src={item.mediaUrl} controls preload="metadata" />}</div>;
  if (item.previewUrl) return <img src={item.previewUrl} alt={assetTitle(item, copy)} loading={expanded ? 'eager' : 'lazy'} decoding="async" />;
  return <div className="generated-asset-model"><UiIcon name="model3d" /><span>{copy.modelFile}</span></div>;
}

export function HistoryRemovalConfirmation({ language, all, busy, error, onCancel, onConfirm }: { language: CanvasInterfaceLanguage; all: boolean; busy: boolean; error?: string; onCancel: () => void; onConfirm: () => void }) {
  const copy = generationHistoryInterfaceCopy(language);
  return <section className="generation-history-confirm" role="alertdialog" aria-modal="true" aria-labelledby="history-removal-title" aria-describedby="history-removal-warning">
    <strong id="history-removal-title">{all ? copy.clearTitle : copy.removeTitle}</strong>
    <p id="history-removal-warning">{copy.historyWarning}</p>
    {error && <p className="generation-history-error" role="alert">{error}</p>}
    <div><button type="button" disabled={busy} onClick={onCancel} autoFocus>{copy.cancel}</button><button type="button" className="history-danger" disabled={busy} onClick={onConfirm}>{busy ? copy.removing : copy.confirm}</button></div>
  </section>;
}

export function GeneratedAssetHistory({ open, taskId, canvasId = 'main', request = fetch, modelNames, nodeNames, onClose, onAddToCanvas, language = 'zh' }: {
  open: boolean; taskId: string; canvasId?: string; request?: RequestLike; modelNames: ReadonlyMap<string, string>; nodeNames?: ReadonlyMap<string, string>; onClose: () => void; onAddToCanvas: (item: GeneratedAssetHistoryItem) => void; language?: CanvasInterfaceLanguage;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const loadRevision = useRef(0);
  const copy = generationHistoryInterfaceCopy(language);
  const [kind, setKind] = useState<GeneratedAssetKind>('image');
  const [items, setItems] = useState<GeneratedAssetHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<GeneratedAssetHistoryItem | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<'all' | GeneratedAssetHistoryItem[] | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    const revision = ++loadRevision.current;
    setLoading(true); setError('');
    try {
      const response = await request('/api/v1/jobs?taskId=' + encodeURIComponent(taskId) + '&canvasId=' + encodeURIComponent(canvasId) + '&limit=1000&historyOnly=1', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || copy.loadError));
      if (revision === loadRevision.current) setItems(generatedAssetItemsFromJobs((Array.isArray(payload?.jobs) ? payload.jobs as GenerationHistoryJob[] : []).filter(job => job.taskId === taskId && (job.canvasId || 'main') === canvasId), modelNames));
    } catch (reason) {
      if (revision === loadRevision.current) setError(translateCanvasInterfaceText(reason instanceof Error ? reason.message : copy.loadError, language));
    } finally { if (revision === loadRevision.current) setLoading(false); }
  }, [modelNames, request, taskId, canvasId, copy.loadError, language]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => { setItems([]); setPreview(null); setPendingRemoval(null); setSelectedIds(new Set()); }, [taskId, canvasId]);
  useEffect(() => { if (open) void load(); return () => { loadRevision.current += 1; }; }, [load, open]);
  useEffect(() => { const refresh = () => { if (open) void load(); }; window.addEventListener('generation-results-cleared', refresh); return () => window.removeEventListener('generation-results-cleared', refresh); }, [open, load]);
  useEffect(() => { if (!open) { setPreview(null); setSelecting(false); setSelectedIds(new Set()); setPendingRemoval(null); } }, [open]);

  const namedItems = useMemo(() => items.map(item => ({ ...item, nodeTitle: nodeNames?.get(JSON.stringify([item.canvasId, item.nodeId])) || item.nodeTitle })), [items, nodeNames]);
  const visibleItems = useMemo(() => namedItems.filter((item) => item.kind === kind), [namedItems, kind]);
  const groups = useMemo(() => groupGeneratedAssetsByDay(visibleItems), [visibleItems]);
  const selectedItems = useMemo(() => namedItems.filter((item) => selectedIds.has(item.id)), [namedItems, selectedIds]);
  const toggleSelected = (id: string) => setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const downloadItems = (assets: readonly GeneratedAssetHistoryItem[]) => assets.forEach((item) => {
    const name = assetDownloadName(item, copy);
    const anchor = document.createElement('a'); anchor.href = canvasAssetDownloadUrl(item.mediaUrl, name); anchor.download = name; anchor.click();
  });
  const removePending = async () => {
    if (!pendingRemoval || removing) return;
    setRemoving(true); setError(''); loadRevision.current += 1;
    try {
      const response = await request('/api/v1/generation-history', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, canvasId, ...(pendingRemoval === 'all' ? { clearAll: true } : { entries: pendingRemoval.map(({ jobId, outputIndex, mediaUrl }) => ({ jobId, outputIndex, mediaUrl })) }) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || copy.removeError));
      const removedUrls = new Set((pendingRemoval === 'all' ? items : pendingRemoval).map((item) => item.mediaUrl));
      setItems((current) => current.filter((item) => !removedUrls.has(item.mediaUrl)));
      setSelectedIds(new Set()); setPreview(null); setPendingRemoval(null);
      await load();
    } catch (reason) { setError(translateCanvasInterfaceText(reason instanceof Error ? reason.message : copy.removeError, language)); }
    finally { setRemoving(false); setLoading(false); }
  };
  const dayLabel = (label: string) => label === '今天' ? copy.today : label === '昨天' ? copy.yesterday : label === '日期未知' ? copy.unknownDate : label;

  if (!open) return null;
  return <dialog ref={dialogRef} className="generated-asset-history" aria-labelledby="generated-asset-history-title" onCancel={(event) => { event.preventDefault(); if (removing) return; if (pendingRemoval) setPendingRemoval(null); else onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !removing) onClose(); }}>
    <div className="generated-asset-history-shell nowheel">
      <header className="generated-asset-history-head" inert={Boolean(pendingRemoval)}>
        <span className="generated-asset-history-mark"><UiIcon name="history" /></span>
        <span><strong id="generated-asset-history-title">{copy.title}</strong><small>{items.length} {copy.items}</small></span>
        <div className="generation-history-head-actions">
          <button type="button" disabled={!items.length || removing} onClick={() => { setSelecting((value) => !value); setSelectedIds(new Set()); }}>{selecting ? copy.done : copy.select}</button>
          <button type="button" className="history-danger" disabled={!items.length || removing} onClick={() => setPendingRemoval('all')}>{copy.clear}</button>
        </div>
        <button type="button" className="ui-icon-button" aria-label={copy.close} title={copy.close} disabled={removing} onClick={onClose}><UiIcon name="close" /></button>
      </header>
      <nav className="generated-asset-history-tabs" aria-label={copy.types} inert={Boolean(pendingRemoval)}>
        {tabs.map((tab) => <button type="button" key={tab.id} className={kind === tab.id ? 'active' : ''} aria-current={kind === tab.id ? 'page' : undefined} onClick={() => { setKind(tab.id); setSelectedIds(new Set()); }}><UiIcon name={tab.icon} /><span>{copy[tab.id]}</span><b>{items.filter((item) => item.kind === tab.id).length}</b></button>)}
        <button type="button" className="generated-asset-history-refresh" onClick={() => void load()} disabled={loading || removing}><UiIcon name="retry" />{loading ? copy.loading : copy.refresh}</button>
      </nav>
      <main className="generated-asset-history-body" inert={Boolean(pendingRemoval)}>
        {error && <div className="generation-history-error" role="alert">{error}</div>}
        {loading && !items.length && <div className="generated-asset-history-state"><UiIcon name="history" /><strong>{copy.loadingTitle}</strong><span>{copy.loadingHint}</span></div>}
        {!loading && error && !items.length && <div className="generated-asset-history-state is-error"><UiIcon name="retry" /><strong>{copy.failed}</strong><button type="button" onClick={() => void load()}>{copy.retry}</button></div>}
        {!loading && !error && !visibleItems.length && <div className="generated-asset-history-state"><UiIcon name={tabs.find((tab) => tab.id === kind)?.icon || 'archive'} /><strong>{copy.empty}</strong><span>{copy.emptyHint}</span></div>}
        {groups.map((group) => <section className="generated-asset-day" key={group.label}>
          <header><strong>{dayLabel(group.label)}</strong><span>{group.assets.length} {copy.items}</span></header>
          <div className="generated-asset-grid">{group.assets.map((item) => {
            const selected = selectedIds.has(item.id);
            const title = assetTitle(item, copy);
            const name = assetDownloadName(item, copy);
            return <article key={item.id} className={'generated-asset-card' + (selected ? ' is-selected' : '')}>
              <button type="button" className="generated-asset-card-preview" aria-label={copy.preview + ' ' + title} onClick={() => selecting ? toggleSelected(item.id) : setPreview(item)}><AssetVisual item={item} copy={copy} /><span className="generated-asset-kind"><UiIcon name={tabs.find((tab) => tab.id === item.kind)?.icon || 'archive'} />{copy[item.kind]}</span>{selecting && <i className="generated-asset-select-indicator" aria-hidden="true">{selected ? '✓' : ''}</i>}</button>
              <div className="generated-asset-card-meta"><span><strong title={title}>{title}</strong><small>{assetMeta(item, copy)}{item.canvasId !== 'main' ? ' · ' + item.canvasId : ''}</small></span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString(language === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>
              {!selecting && <div className="generated-asset-card-actions"><button type="button" onClick={() => onAddToCanvas(item)}><UiIcon name="add" />{copy.add}</button><a href={canvasAssetDownloadUrl(item.mediaUrl, name)} download={name} title={copy.download + ' ' + name}><UiIcon name="download" /></a><button type="button" className="history-danger" aria-label={copy.remove + ': ' + title} title={copy.remove} disabled={removing} onClick={() => setPendingRemoval([item])}><UiIcon name="delete" /></button></div>}
            </article>;
          })}</div>
        </section>)}
      </main>
      {selecting && <footer className="generated-asset-history-batch" inert={Boolean(pendingRemoval)}><span><strong>{selectedItems.length}</strong> {copy.selected}</span><button type="button" onClick={() => setSelectedIds(new Set(visibleItems.map((item) => item.id)))} disabled={!visibleItems.length}>{copy.selectAll}</button><button type="button" onClick={() => downloadItems(selectedItems)} disabled={!selectedItems.length}><UiIcon name="download" />{copy.download}</button><button type="button" className="history-danger" onClick={() => setPendingRemoval(selectedItems)} disabled={!selectedItems.length || removing}><UiIcon name="delete" />{copy.removeSelected}</button><button type="button" className="primary" onClick={() => selectedItems.forEach(onAddToCanvas)} disabled={!selectedItems.length}><UiIcon name="add" />{copy.add}</button></footer>}
      {preview && <div className="generated-asset-preview-layer" role="dialog" aria-modal="true" aria-label={copy.preview + ' ' + assetTitle(preview, copy)} onClick={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
        <section><header><span><strong>{assetTitle(preview, copy)}</strong><small>{assetMeta(preview, copy)} · {preview.modelName || copy.title}</small></span><button type="button" className="ui-icon-button" aria-label={copy.closePreview} onClick={() => setPreview(null)}><UiIcon name="close" /></button></header><div className="generated-asset-preview-media"><AssetVisual item={preview} copy={copy} expanded /></div><footer><p>{preview.prompt || copy.noPrompt}</p><button type="button" onClick={() => onAddToCanvas(preview)}><UiIcon name="add" />{copy.add}</button><a href={canvasAssetDownloadUrl(preview.mediaUrl, assetDownloadName(preview, copy))} download={assetDownloadName(preview, copy)}><UiIcon name="download" />{copy.downloadOriginal}</a></footer></section>
      </div>}
      {pendingRemoval && <div className="generation-history-confirm-layer"><HistoryRemovalConfirmation language={language} all={pendingRemoval === 'all'} busy={removing} error={error} onCancel={() => setPendingRemoval(null)} onConfirm={() => void removePending()} /></div>}
    </div>
  </dialog>;
}
