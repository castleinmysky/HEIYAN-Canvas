import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { canonicalConnection, connectionDefaults } from '../../shared/model-connection-settings.js';
import { advancedConnectionEligible, connectionCopy, connectionDraft, connectionProtocols, createConnectionFocusController, type ConnectionLanguage, type ConnectionSettings } from '../model-connection-settings';
import type { AdminModel } from './ModelSettings';
import { modelPresentation } from '../model-settings-catalog';
import { imageModelCatalog, imageModelEntry } from '../../shared/image-model-catalog.js';
import './ModelConnectionDialog.css';

type RequestLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export function ModelConnectionDialogFields({ value, apiKey, language, busy, error, onChange, onKeyChange }: {
  value: ConnectionSettings; apiKey: string; language: ConnectionLanguage; busy: boolean; error: string;
  onChange: (value: ConnectionSettings) => void; onKeyChange: (value: string) => void;
}) {
  const copy = connectionCopy(language);
  const set = (key: keyof ConnectionSettings, text: string) => onChange({ ...value, [key]: text });
  const capability = Object.keys(connectionProtocols).find((key) => connectionProtocols[key].includes(value.adapter)) || '';
  const presets = imageModelCatalog.filter(item => item.adapter === value.adapter);
  const selectedPreset = imageModelEntry(value.adapter, value.model);
  const selectModel = (model: string) => onChange(value.mode === 'official' ? connectionDefaults(value.adapter, model) : { ...value, model, ...(value.adapter === 'gemini-image' && value.endpoint?.includes('/models/' + value.model + ':generateContent') ? { endpoint: value.endpoint.replace('/models/' + value.model + ':generateContent', '/models/' + model + ':generateContent') } : {}) });
  return <>
    <p>{copy.description}</p>
    <label>{copy.protocol}<select data-connection-first value={value.adapter} disabled={busy} onChange={(event) => onChange(connectionDefaults(event.target.value))}>{connectionProtocols[capability]?.map((adapter) => <option key={adapter} value={adapter}>{adapter}</option>)}</select></label>
    <label>{copy.mode}<select value={value.mode} disabled={busy} onChange={(event) => onChange(event.target.value === 'official' ? connectionDefaults(value.adapter, value.model) : { ...value, mode: 'relay' })}><option value="official">{copy.official}</option><option value="relay">{copy.relay}</option></select></label>
    {presets.length > 0 && <label>{language === 'en' ? 'Image model' : '选择图像型号'}<select value={selectedPreset?.id || ''} disabled={busy} onChange={event => { if (event.target.value) selectModel(event.target.value); }}><option value="">{language === 'en' ? 'Custom model ID' : '自定义模型 ID'}</option>{['current', 'legacy', 'deprecated'].map(state => <optgroup key={state} label={language === 'en' ? state : state === 'current' ? '当前型号' : state === 'legacy' ? '上一代 · 保留兼容' : '历史型号 · 官方已弃用'}>{presets.filter(item => item.state === state).map(item => <option value={item.id} key={item.id}>{item.name} · {language === 'en' ? item.state : item.tier}</option>)}</optgroup>)}</select></label>}
    {selectedPreset && <small>{language === 'en' ? (selectedPreset.state === 'deprecated' ? 'Deprecated by the official provider. Retained for compatible existing connections only.' : 'Resolution and quality depend on the selected model. Account access is separate.') : selectedPreset.description}</small>}
    <label>{copy.model}<input value={value.model} disabled={busy} autoComplete="off" onChange={(event) => selectModel(event.target.value)} /></label>
    {value.adapter === 'seedance-video' && language !== 'en' && <section className="model-provider-guide" aria-label="Seedance 自有账号接入"><strong>使用你自己的 Seedance 账户与额度</strong>{value.mode === 'official' ? <><p>① 在火山方舟开通账户可用的 Seedance 型号，按控制台要求完成认证和权限申请。</p><p>② 创建自己的 Ark API Key，填写获准使用的模型 ID 或接入点 ID（ep-…）。连接成功不等于所有型号都已获权。</p><p>③ 输入素材须满足所选型号的规则；涉及私域人像时，使用你自己账户已授权的素材资产，作者账户的 Asset ID 不能直接共享。</p><a href="https://console.volcengine.com/ark/region:ark+cn-beijing/apikey" target="_blank" rel="noreferrer">打开火山方舟 API Key 管理 ↗</a><a href="https://www.volcengine.com/docs/82379/1520758" target="_blank" rel="noreferrer">查看官方视频接口与素材规则 ↗</a></> : <p>填写你自己的中转密钥、模型 ID 和 HTTPS 地址。服务须同时兼容 Ark 创建任务、查询任务与取消任务协议；只有“返视频”的网页账号或不同格式的接口不能直接通用。</p>}<small>不会自动试生成或使用作者的共享账户。费用由本连接所填密钥对应的服务商账户承担。</small></section>}
    <label>{copy.baseUrl}<input type="url" value={value.baseUrl} readOnly={value.mode === 'official'} disabled={busy} autoComplete="off" spellCheck={false} onChange={(event) => set('baseUrl', event.target.value)} /></label>
    {(['endpoint', 'editEndpoint', 'queryEndpoint', 'validationEndpoint'] as const).map((key) => value[key] !== undefined ? <label key={key}>{copy[key]}<input value={value[key]} readOnly={value.mode === 'official'} disabled={busy} autoComplete="off" spellCheck={false} onChange={(event) => set(key, event.target.value)} /></label> : null)}
    {value.adapter === 'tripo3d-model' && <label>{copy.endpoint}<input readOnly value={copy.derived} /></label>}
    <small>{value.mode === 'official' ? copy.officialHint : copy.relayHint}</small>
    <label>{copy.key}<input type="password" autoComplete="new-password" value={apiKey} disabled={busy} placeholder={copy.keyPlaceholder} onChange={(event) => onKeyChange(event.target.value)} /></label>
    <small>{copy.keyHint}</small><small>{copy.verificationHint}</small>
    {value.adapter === 'seedance-video' && language === 'en' && <p>Use your own Ark API key and an authorized model or endpoint ID. Private portrait asset IDs must belong to, or be authorized for, your account. Relays must implement Ark task creation, polling and cancellation. No generation is submitted during connection checks.</p>}
    {error && <p className="model-connection-error" role="alert">{error}</p>}
  </>;
}
type DialogProps = {
  model: AdminModel; language?: ConnectionLanguage; request?: RequestLike; opener?: HTMLElement | null;
  onClose: () => void; onSaved: (model: AdminModel) => void | Promise<void>;
};
export function ModelConnectionDialog(props: DialogProps) {
  return advancedConnectionEligible(props.model) ? <EligibleModelConnectionDialog {...props} /> : null;
}
function EligibleModelConnectionDialog({ model, language = 'zh', request = fetch, opener, onClose, onSaved }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState(() => connectionDraft(model));
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const copy = connectionCopy(language);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  const changeDraft = (value: ConnectionSettings) => {
    if (value.adapter !== draft.adapter || value.baseUrl !== draft.baseUrl) setApiKey('');
    setDraft(value);
  };
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Portals sit outside .app-shell; inherit its current tokens on html theme changes.
    const themeSource = opener?.closest('.app-shell') || document.querySelector('.app-shell') || document.documentElement;
    const syncTheme = () => {
      const theme = getComputedStyle(themeSource);
      for (const name of ['text', 'text-soft', 'plane-base', 'plane-raised', 'surface', 'control', 'border', 'primary', 'primary-ink', 'danger', 'shadow-float', 'font-ui']) {
        dialog.style.setProperty('--canvas-' + name, theme.getPropertyValue('--canvas-' + name));
      }
      dialog.style.colorScheme = document.documentElement.dataset.canvasTheme === 'day' ? 'light' : 'dark';
    };
    syncTheme();
    const themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-canvas-theme'] });
    if (themeSource !== document.documentElement) themeObserver.observe(themeSource, { attributes: true, attributeFilter: ['data-theme'] });
    const controller = createConnectionFocusController({
      focusables: () => [...dialog.querySelectorAll<HTMLElement>('select:not(:disabled),input:not(:disabled),button:not(:disabled),[tabindex="0"]')],
      active: () => document.activeElement as HTMLElement,
      opener,
      cancel: () => { if (!busyRef.current) { setApiKey(''); closeRef.current(); } },
    });
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    controller.activate();
    const keydown = (event: KeyboardEvent) => controller.keydown(event);
    dialog.addEventListener('keydown', keydown);
    return () => { themeObserver.disconnect(); dialog.removeEventListener('keydown', keydown); if (dialog.open && typeof dialog.close === 'function') dialog.close(); controller.deactivate(); };
  }, [opener]);
  if (!advancedConnectionEligible(model) || typeof document === 'undefined') return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (busy) return;
    let connection: ConnectionSettings;
    try { connection = canonicalConnection(model.capability, draft); } catch { setError(copy.invalid); return; }
    setBusy(true); setError('');
    try {
      const response = await request('/api/v1/admin/models/' + encodeURIComponent(model.id) + '/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.code === 'new_key_required' ? copy.newKey : copy.failure); return; }
      setApiKey(''); await onSaved(payload.model); onClose();
    } catch { setError(copy.failure); }
    finally { setBusy(false); }
  };
  return createPortal(<dialog ref={dialogRef} className="model-connection-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) { setApiKey(''); onClose(); } }}>
    <form onSubmit={(event) => void submit(event)} onClick={(event) => event.stopPropagation()}>
      <header><h2 id={titleId}>{copy.title}</h2><strong>{modelPresentation({ ...model, adapter: draft.adapter, config: { model: draft.model } }).name}</strong></header>
      <div className="model-connection-fields"><ModelConnectionDialogFields value={draft} apiKey={apiKey} language={language} busy={busy} error={error} onChange={changeDraft} onKeyChange={setApiKey} /></div>
      <footer><button type="button" disabled={busy} onClick={() => { setApiKey(''); onClose(); }}>{copy.cancel}</button><button type="submit" disabled={busy}>{busy ? copy.working : copy.submit}</button></footer>
    </form>
  </dialog>, document.body);
}
