import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { generationHistoryInterfaceCopy, settingsCenterInterfaceCopy, translateCanvasInterfaceText, type CanvasInterfaceLanguage } from '../interface-language';
import { ModelSettings, type AdminModel } from './ModelSettings';
import { UiIcon, type UiIconName } from './UiIcon';
import './GeneratedAssetHistory.css';
import { LocalConnectorSettings } from './LocalConnectorSettings';

type RequestLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type SettingsCenterSection = 'api' | 'comfyui' | 'data' | 'about';
type DataCategory = { id: string; label: string; files: number; bytes: number };
type DataSummary = { updatedAt: string; total: { files: number; bytes: number }; categories: DataCategory[] };
type SettingsBackup = { format: 'heiyan-settings-backup'; version: 1; createdAt: string; models?: AdminModel[]; settings?: Record<string, unknown> };

const sections: { id: SettingsCenterSection; icon: UiIconName }[] = [
  { id: 'api', icon: 'key' },
  { id: 'comfyui', icon: 'comfy' },
  { id: 'data', icon: 'database' },
  { id: 'about', icon: 'info' },
];

export function settingsSectionFromPanel(panel: string | null): SettingsCenterSection | null {
  if (panel === 'models' || panel === 'api' || panel === 'settings') return 'api';
  return panel === 'comfyui' || panel === 'data' || panel === 'about' ? panel : null;
}

const responseMessage = (payload: unknown, fallback: string) => payload && typeof payload === 'object' && 'error' in payload ? String((payload as { error?: unknown }).error || fallback) : fallback;
const byteLabel = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${Math.max(0, bytes)} B`;

export function advancedComfyConditionalTree(open: boolean, content: ReactNode) {
  return open ? content : null;
}

export function SettingsCenter({ open, initialSection = 'api', onClose, request = fetch, onModelsChanged, version, language }: { open: boolean; initialSection?: SettingsCenterSection; onClose: () => void; request?: RequestLike; onModelsChanged: () => Promise<void>; version: string; language: CanvasInterfaceLanguage }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<SettingsCenterSection>(initialSection);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const copy = settingsCenterInterfaceCopy(language);

  useEffect(() => {
    if (open) setSection(initialSection);
    setAdvancedOpen(false);
  }, [initialSection, open]);
  useEffect(() => { setAdvancedOpen(false); }, [section]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const closeSettings = () => { setAdvancedOpen(false); onClose(); };
  if (!open) return null;
  return <dialog ref={dialogRef} className="settings-center" aria-labelledby="settings-center-title" onCancel={(event) => { event.preventDefault(); closeSettings(); }} onClick={(event) => { if (event.target === event.currentTarget) closeSettings(); }}>
    <div className="settings-center-shell">
      <header className="settings-center-head">
        <span className="settings-center-mark"><UiIcon name="settings" /></span>
        <div><strong id="settings-center-title">{copy.title}</strong><small>{copy.subtitle}</small></div>
        <span className="settings-center-version">{version}</span>
        <button type="button" className="settings-center-close ui-icon-button" aria-label={copy.close} title={copy.close} onClick={closeSettings}><UiIcon name="close" /></button>
      </header>
      <div className="settings-center-body">
        <nav className="settings-center-nav" aria-label={copy.navigation}>
          {sections.map((item) => <button type="button" key={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => { setAdvancedOpen(false); setSection(item.id); }}><UiIcon name={item.icon} /><strong>{copy.sections[item.id].label}</strong></button>)}
        </nav>
        <main className="settings-center-content" key={section}>
          <header className="settings-section-intro"><strong>{copy.sections[section].label}</strong><span>{section === 'comfyui' ? language === 'en' ? 'Pair this browser with the deployment package running on the same computer.' : '将当前浏览器与同一台电脑上运行的部署包配对。' : copy.sections[section].intro}</span></header>
          {section === 'comfyui' && <LocalConnectorSettings request={request} onModelsChanged={onModelsChanged} language={language} />}
          {section === 'api' && <ModelSettings open embedded onClose={onClose} request={request} onModelsChanged={onModelsChanged} language={language} />}
          {section === 'data' && <DataManagement request={request} onModelsChanged={onModelsChanged} language={language} />}
          {section === 'about' && <section className="trial-settings-message" data-no-interface-translation><h2>HEIYAN · {version}</h2><p>{language === 'en' ? 'Canvas, media, history and encrypted API keys are saved in this browser. Back up important work before clearing browser data. Cloud requests pass through this Site to your selected provider; the Site does not store your keys or media.' : '画布、素材、历史和加密后的 API 密钥保存在当前浏览器。清除浏览器数据前，请备份重要作品。云请求经由此站点转发到你选择的服务商，站点不持久保存密钥和素材。'}</p><p>{language === 'en' ? 'Keep the page open while generating. Tasks with a saved provider ID can resume retrieval after reopening; interrupted synchronous image requests will not be resubmitted automatically.' : '生成期间请保持网页打开。已记录服务商任务编号的任务可在重新打开后恢复查询；中断的同步图片请求不会自动重新提交。'}</p></section>}
        </main>
      </div>
    </div>
  </dialog>;
}


export async function requestGeneratedResultsCleanup(request: RequestLike, acknowledged: boolean) {
  if (!acknowledged) throw new Error('Generated result deletion requires explicit confirmation');
  const response = await request('/api/v1/admin/data/generated-results', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'delete-generated-results' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(responseMessage(payload, '生成结果清理失败'));
  return payload;
}

export function GeneratedResultsConfirmation({ language, acknowledged, busy, onAcknowledged, onCancel, onConfirm }: {
  language: CanvasInterfaceLanguage; acknowledged: boolean; busy: boolean;
  onAcknowledged: (value: boolean) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const copy = generationHistoryInterfaceCopy(language);
  return <div className="settings-generated-confirm" role="group" aria-labelledby="generated-cleanup-warning">
    <p id="generated-cleanup-warning">{copy.cleanupWarning}</p>
    <label><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => onAcknowledged(event.target.checked)} />{copy.cleanupAcknowledgement}</label>
    <div><button type="button" disabled={busy} onClick={onCancel}>{copy.cancel}</button><button type="button" className="danger" disabled={!acknowledged || busy} onClick={onConfirm}>{busy ? copy.cleanupWorking : copy.cleanupConfirm}</button></div>
  </div>;
}

function DataManagement({ request, onModelsChanged, language }: { request: RequestLike; onModelsChanged: () => Promise<void>; language: CanvasInterfaceLanguage }) {
  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingBackup, setPendingBackup] = useState<SettingsBackup | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const [generatedArmed, setGeneratedArmed] = useState(false);
  const [generatedAcknowledged, setGeneratedAcknowledged] = useState(false);
  const historyCopy = generationHistoryInterfaceCopy(language);

  const loadSummary = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await request('/api/v1/admin/data/summary');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(payload, '数据统计读取失败'));
      setSummary(payload as DataSummary);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '数据统计读取失败'); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const exportConfiguration = async () => {
    setError(''); setNotice('');
    try {
      const [modelsResponse, settingsResponse] = await Promise.all([request('/api/v1/admin/models'), request('/api/settings')]);
      const modelsPayload = await modelsResponse.json();
      const settingsPayload = await settingsResponse.json();
      if (!modelsResponse.ok) throw new Error(responseMessage(modelsPayload, '模型配置导出失败'));
      if (!settingsResponse.ok) throw new Error(responseMessage(settingsPayload, '偏好配置导出失败'));
      const models = (modelsPayload.models || []).map(({ secret: _secret, ...model }: AdminModel) => model);
      const backup: SettingsBackup = { format: 'heiyan-settings-backup', version: 1, createdAt: new Date().toISOString(), models, settings: settingsPayload };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `heiyan-settings-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
      setNotice('配置备份已导出；API 密钥未包含在文件中');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '配置导出失败'); }
  };
  const chooseBackup = async (file?: File) => {
    if (!file) return;
    setError(''); setNotice('');
    try {
      const backup = JSON.parse(await file.text()) as SettingsBackup;
      if (backup.format !== 'heiyan-settings-backup' || backup.version !== 1) throw new Error('这不是受支持的黑岩设置备份');
      setPendingBackup(backup);
    } catch (reason) { setPendingBackup(null); setError(reason instanceof Error ? reason.message : '备份文件无法读取'); }
  };
  const applyBackup = async () => {
    if (!pendingBackup) return;
    setLoading(true); setError(''); setNotice('');
    try {
      if (Array.isArray(pendingBackup.models)) {
        const response = await request('/api/v1/admin/models', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ models: pendingBackup.models }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(responseMessage(payload, '模型配置导入失败'));
      }
      if (pendingBackup.settings) {
        const response = await request('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pendingBackup.settings) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(responseMessage(payload, '偏好配置导入失败'));
      }
      await onModelsChanged(); setPendingBackup(null); setNotice(language === 'en' ? 'Configuration imported. Changed provider destinations require a new API key.' : '配置已导入；服务地址发生变化的模型需要重新填写 API 密钥。'); await loadSummary();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '配置导入失败'); }
    finally { setLoading(false); }
  };
  const clearPreviews = async () => {
    if (!clearArmed) { setClearArmed(true); setNotice('再次点击以确认清理预览缓存'); return; }
    setLoading(true); setError(''); setNotice('');
    try {
      const response = await request('/api/v1/admin/data/previews', { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(payload, '预览缓存清理失败'));
      setClearArmed(false); setNotice(`已清理 ${payload.removed?.files || 0} 个预览文件，画布与生成结果未受影响`); await loadSummary();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '预览缓存清理失败'); }
    finally { setLoading(false); }
  };


  const clearGenerated = async () => {
    if (!generatedArmed || !generatedAcknowledged || loading) return;
    setLoading(true); setError(''); setNotice('');
    try {
      const payload = await requestGeneratedResultsCleanup(request, generatedAcknowledged);
      setGeneratedArmed(false); setGeneratedAcknowledged(false);
      await loadSummary();
      setNotice((payload.partial ? historyCopy.cleanupPartial : historyCopy.cleanupSuccess) + ' ' + (payload.removed?.files || 0) + ' ' + historyCopy.files + (payload.retainedFiles ? ' · ' + historyCopy.cleanupRetained + ' ' + payload.retainedFiles : ''));
      window.dispatchEvent(new Event('generation-results-cleared'));
    } catch (reason) {
      setError(translateCanvasInterfaceText(reason instanceof Error ? reason.message : historyCopy.cleanupError, language));
    } finally { setLoading(false); }
  };

  return <section className="settings-data-panel">
    {error && <div className="settings-inline-error" role="alert">{error}</div>}
    {notice && <div className="settings-inline-notice" role="status">{notice}</div>}
    <section className="settings-data-block">
      <header><span><strong>本机数据占用</strong><small>统计画布、素材、结果与缓存的真实文件</small></span><button type="button" onClick={() => void loadSummary()} disabled={loading}>{loading ? '统计中…' : '刷新统计'}</button></header>
      <div className="settings-data-total"><strong>{summary ? byteLabel(summary.total.bytes) : '—'}</strong><span>{summary ? `${summary.total.files} 个文件` : '等待统计'}</span></div>
      <div className="settings-data-rows">{summary?.categories.map((category) => <div key={category.id}><span><strong>{category.label}</strong><small>{category.files} 个文件</small></span><b>{byteLabel(category.bytes)}</b></div>)}</div>
    </section>
    <section className="settings-data-block settings-backup-block">
      <header><span><strong>配置备份</strong><small>导出模型与偏好，不导出 API 密钥和作品文件</small></span></header>
      <div className="settings-action-row"><button type="button" onClick={() => void exportConfiguration()}><UiIcon name="download" />导出配置</button><label className="settings-file-button"><UiIcon name="upload" />选择备份<input type="file" accept="application/json,.json" onChange={(event) => void chooseBackup(event.target.files?.[0])} /></label></div>
      {pendingBackup && <div className="settings-import-confirm"><span><strong>备份已读取</strong><small>{pendingBackup.models?.length || 0} 个模型 · {new Date(pendingBackup.createdAt).toLocaleString('zh-CN')}</small></span><button type="button" className="primary" disabled={loading} onClick={() => void applyBackup()}>应用备份</button></div>}
    </section>
    <section className="settings-data-block settings-generated-block">
      <header><span><strong>{historyCopy.cleanupTitle}</strong><small>{historyCopy.cleanupHint}</small></span><button type="button" className="danger" disabled={loading || generatedArmed} onClick={() => { setGeneratedArmed(true); setGeneratedAcknowledged(false); setError(''); setNotice(''); }}>{historyCopy.cleanupTitle}</button></header>
      {generatedArmed && <GeneratedResultsConfirmation language={language} acknowledged={generatedAcknowledged} busy={loading} onAcknowledged={setGeneratedAcknowledged} onCancel={() => { setGeneratedArmed(false); setGeneratedAcknowledged(false); }} onConfirm={() => void clearGenerated()} />}
    </section>
    <section className="settings-data-block settings-cache-block">
      <header><span><strong>预览缓存</strong><small>仅删除可重新生成的预览图，不触碰画布、素材或生成结果</small></span><button type="button" className={clearArmed ? 'danger is-armed' : 'danger'} disabled={loading} onClick={() => void clearPreviews()}>{clearArmed ? '确认清理缓存' : '清理预览缓存'}</button></header>
    </section>
  </section>;
}

function AboutPanel({ request, version }: { request: RequestLike; version: string }) {
  const [health, setHealth] = useState<{ ok?: boolean; edition?: string } | null>(null);
  const [storage, setStorage] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([request('/api/health').then((response) => response.json()), request('/api/system/storage').then((response) => response.json())]).then(([nextHealth, nextStorage]) => { if (active) { setHealth(nextHealth); setStorage(nextStorage); } }).catch(() => { if (active) setHealth({ ok: false }); });
    return () => { active = false; };
  }, [request]);
  const paths = storage ? Object.entries(storage).filter(([, value]) => typeof value === 'string').slice(0, 4) : [];
  return <section className="settings-about-panel">
    <div className="settings-about-identity"><img src="/echo-ai-canvas.svg" alt="" /><span><strong>黑岩画布</strong><small>H E I Y A N</small></span></div>
    <p>本地优先的视觉创作画布，把文字、图像、云端 API 与本机 ComfyUI 连接成可继续编辑的工作流。</p>
    <dl><div><dt>版本</dt><dd>{version}</dd></div><div><dt>运行状态</dt><dd><i className={health?.ok ? 'is-online' : ''} />{health ? health.ok ? '本机服务正常' : '本机服务异常' : '检测中…'}</dd></div><div><dt>版本类型</dt><dd>{health?.edition === 'open-source' ? '开源本地版' : health?.edition || '检测中…'}</dd></div>{paths.map(([name, value]) => <div key={name}><dt>{name}</dt><dd title={String(value)}>{String(value)}</dd></div>)}</dl>
    <a className="settings-about-link" href="https://github.com/castleinmysky/echo-canvas" target="_blank" rel="noreferrer noopener"><UiIcon name="github" />查看 GitHub 项目<UiIcon name="external" /></a>
  </section>;
}
