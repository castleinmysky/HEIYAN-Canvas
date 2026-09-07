import { translateCanvasInterfaceText } from '../interface-language';
import { ModelConnectionDialog } from './ModelConnectionDialog';
import { advancedConnectionEligible, connectionCopy, isAdvancedRowSurface, type ConnectionLanguage } from '../model-connection-settings';
import { groupModelsByGeneration, modelPresentation } from '../model-settings-catalog';
import { UiIcon } from './UiIcon';
import '../model-catalog.css';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

type Capability = 'image' | 'video' | 'audio' | 'model';
type Adapter = 'http' | 'openai-image' | 'gemini-image' | 'seedance-video' | 'minimax-h3-video' | 'comfyui-minimax-h3' | 'comfyui-native-image' | 'comfyui-illustrious' | 'comfyui-sdxl' | 'gpt-sovits-audio' | 'tripo3d-model';
type RequestLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ConnectionState = 'ready' | 'limited' | 'invalid' | 'unreachable' | 'unverified' | 'missing';
type ModelConnection = { status: ConnectionState; message?: string; checkedAt?: string; httpStatus?: number };
type ModelConfig = {
  baseUrl?: string; endpoint?: string; model?: string; apiKeyEnv?: string;
  connectionMode?: 'official' | 'relay'; editEndpoint?: string; queryEndpoint?: string; validationEndpoint?: string;
  defaultRatio?: string; defaultResolution?: string; characterLoras?: string[];
  styleLoras?: string[]; objectLoras?: string[];
  gptWeights?: string; sovitsWeights?: string; referenceAudioPath?: string;
  referenceText?: string; referenceLanguage?: string; defaultLanguage?: string;
  loraPresentation?: Record<string, { label?: string; previewUrl?: string }>;
  connection?: ModelConnection;
};
export type AdminModel = { id: string; name: string; capability: Capability; adapter: Adapter; enabled: boolean; config?: ModelConfig; secret?: { configured: boolean; masked: string } };

export const isLocalComfyUiAdapter = (adapter: Adapter) => ['comfyui-minimax-h3', 'comfyui-native-image', 'comfyui-illustrious', 'comfyui-sdxl'].includes(adapter);
export function cloudModelsForSettings(models: AdminModel[]) { return models.filter((model) => !isLocalComfyUiAdapter(model.adapter)); }
export function mergeCloudModelsWithLocalResources(original: AdminModel[], cloudModels: AdminModel[]) {
  const cloudById = new Map(cloudModels.map((model) => [model.id, model]));
  const consumed = new Set<string>();
  const merged = original.flatMap((model) => {
    if (isLocalComfyUiAdapter(model.adapter)) return [model];
    const replacement = cloudById.get(model.id);
    if (!replacement) return [];
    consumed.add(model.id);
    return [replacement];
  });
  return [...merged, ...cloudModels.filter((model) => !consumed.has(model.id))];
}

const providerNeedsKey = (adapter: Adapter) => adapter !== 'gpt-sovits-audio';
const actualModelName = (model: AdminModel) => modelPresentation(model).name;
const connectionAccepted = (status?: string) => status === 'ready' || status === 'limited';

export function ModelSettingsGroups({ models, language, renderModel }: { models: AdminModel[]; language: ConnectionLanguage; renderModel: (model: AdminModel) => ReactNode }) {
  const id = useId();
  return groupModelsByGeneration(models).map((group) => <section className="model-generation-group" key={group.id} aria-labelledby={`${id}-${group.id}`}>
    <header className="model-generation-heading"><UiIcon name={group.icon} /><h3 id={`${id}-${group.id}`}>{group[language]}</h3><span>{group.models.length}</span></header>
    {group.id === 'image' ? ['openai-image', 'gemini-image', ...new Set(group.models.filter(item => !['openai-image', 'gemini-image'].includes(item.adapter)).map(item => item.adapter))].map(adapter => {
      const rows = group.models.filter(item => item.adapter === adapter);
      return rows.length ? <div className="model-provider-group" key={adapter}><h4>{adapter === 'openai-image' ? 'OpenAI · GPT Image' : adapter === 'gemini-image' ? 'Google · Gemini / Nano Banana' : adapter}</h4>{rows.map(renderModel)}</div> : null;
    }) : group.models.map(renderModel)}
  </section>);
}

function statusFor(model: AdminModel, typedKey: string, checking: boolean) {
  if (checking) return { id: 'checking', label: '正在验证' };
  if (typedKey.trim()) return { id: 'pending', label: '等待验证' };
  const status = model.config?.connection?.status;
  if (status === 'ready') return { id: status, label: '连接可用' };
  if (status === 'limited') return { id: status, label: '连接受限' };
  if (status === 'invalid') return { id: status, label: '密钥无效' };
  if (status === 'unreachable') return { id: status, label: '服务不可达' };
  if (model.secret?.configured) return { id: status || 'unverified', label: '需要验证' };
  return { id: 'missing', label: '尚未连接' };
}

export function ModelSettings({ open, onClose, onModelsChanged, request = fetch, embedded = false, language = 'zh' }: { open: boolean; onClose: () => void; onModelsChanged: () => Promise<void>; request?: RequestLike; embedded?: boolean; language?: ConnectionLanguage }) {
  const [advancedId, setAdvancedId] = useState('');
  const advancedOpener = useRef<HTMLElement | null>(null);
  const advancedCopy = connectionCopy(language);
  const t = (value: string) => language === 'en' && value === '正在读取本机配置…' ? 'Loading local settings…' : translateCanvasInterfaceText(value, language);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [removingId, setRemovingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadModels = async () => {
    const response = await request('/api/v1/admin/models');
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '模型配置读取失败');
    setModels(cloudModelsForSettings(payload.models || []));
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(''); setNotice(''); setSecrets({}); setAdvancedId('');
    request('/api/v1/admin/models').then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '模型配置读取失败');
      if (active) setModels(cloudModelsForSettings(payload.models || []));
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '模型配置读取失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, request]);

  const keyModels = useMemo(() => models.filter((model) => providerNeedsKey(model.adapter)), [models]);
  const connectedCount = useMemo(() => keyModels.filter((model) => connectionAccepted(model.config?.connection?.status)).length, [keyModels]);
  const actionableCount = useMemo(() => keyModels.filter((model) => secrets[model.id]?.trim() || model.secret?.configured).length, [keyModels, secrets]);

  const connectModel = async (model: AdminModel, apiKey?: string) => {
    setCheckingIds((current) => new Set(current).add(model.id));
    try {
      const response = await request(`/api/v1/admin/models/${encodeURIComponent(model.id)}/connect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.connection) setModels((current) => current.map((item) => item.id === model.id ? { ...item, config: { ...(item.config || {}), connection: payload.connection } } : item));
        throw new Error(payload.error || '模型连接验证失败');
      }
      setModels((current) => current.map((item) => item.id === model.id ? payload.model : item));
      setSecrets((current) => ({ ...current, [model.id]: '' }));
      return true;
    } finally {
      setCheckingIds((current) => { const next = new Set(current); next.delete(model.id); return next; });
    }
  };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    setError(''); setNotice('');
    const changed = keyModels.filter((model) => secrets[model.id]?.trim());
    const targets = changed.length ? changed : keyModels.filter((model) => model.secret?.configured && !connectionAccepted(model.config?.connection?.status));
    if (!targets.length) { setNotice(connectedCount ? '所有已配置服务均已验证' : '请先填写一个 API 密钥'); return; }
    try {
      for (const model of targets) await connectModel(model, secrets[model.id]);
      await loadModels();
      await onModelsChanged();
      setNotice(`${targets.length} 个服务已验证并同步到画布`);
      if (!embedded) onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '模型连接验证失败'); }
  };

  const removeConnection = async (model: AdminModel) => {
    setRemovingId(model.id); setError(''); setNotice('');
    try {
      const response = await request(`/api/v1/admin/models/${encodeURIComponent(model.id)}/connection`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '模型连接移除失败');
      setModels((current) => current.map((item) => item.id === model.id ? payload.model : item));
      await onModelsChanged();
      setNotice(`${actualModelName(model)} 已断开`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '模型连接移除失败'); }
    finally { setRemovingId(''); }
  };

  if (!open) return null;
  return <><form className={`model-settings model-settings-simple${embedded ? ' is-embedded' : ''}`} aria-label={t('API 与模型')} onSubmit={(event) => void save(event)}>
    {!embedded && <header className="model-settings-head"><strong>{t('API 与模型')}</strong><button type="button" onClick={onClose}>{t('关闭')}</button></header>}
    {error && <div className="settings-inline-error" role="alert">{t(error)}</div>}
    {notice && <div className="settings-inline-notice" role="status">{t(notice)}</div>}
    <div className="model-key-list">
      {loading ? <div className="model-settings-empty">{t('正在读取本机配置…')}</div> : keyModels.length ? <ModelSettingsGroups models={keyModels} language={language} renderModel={(model) => {
        const state = statusFor(model, secrets[model.id] || '', checkingIds.has(model.id));
        const presentation = modelPresentation(model);
        return <div className="model-key-row" key={model.id} onDoubleClick={(event) => {
          if (advancedConnectionEligible(model) && isAdvancedRowSurface(event.target as HTMLElement) && !checkingIds.has(model.id)) {
            advancedOpener.current = event.currentTarget.querySelector<HTMLElement>('.model-connection-advanced');
            setAdvancedId(model.id);
          }
        }}>
          <span className={`model-provider-mark is-${model.adapter}`}>{presentation.icon ? <img src={presentation.icon} width={32} height={32} alt="" draggable={false} /> : <UiIcon name="link" />}</span>
          <span className="model-key-identity"><strong>{presentation.name}{presentation.tier && <em className="model-tier-label">{presentation.tier}</em>}</strong><small>{presentation.description || presentation.provider || (language === 'en' ? 'Custom model' : '自定义模型')}</small><code title={presentation.modelId}>{presentation.modelId}</code><small className="model-connection-destination">{model.config?.connectionMode === 'relay' || (model.config?.baseUrl && !['https://api.openai.com', 'https://generativelanguage.googleapis.com', 'https://ark.cn-beijing.volces.com/api/v3', 'https://api.minimax.io', 'https://openapi.tripo3d.com/v3'].includes(model.config.baseUrl)) ? '兼容中转' : '官方 API'} · {model.config?.baseUrl || '尚未配置地址'}</small></span>
          <label className="model-key-input"><input type="password" autoComplete="new-password" aria-label={t(`${actualModelName(model)} API 密钥`)} placeholder={t(model.secret?.configured ? `已保存 ${model.secret.masked}` : '填写 API 密钥')} value={secrets[model.id] || ''} onChange={(event) => setSecrets((current) => ({ ...current, [model.id]: event.target.value }))} /><span className={`model-key-state is-${state.id}`}><i />{t(state.label)}</span></label>
          <span className="model-key-actions">{advancedConnectionEligible(model) && <button className="model-connection-advanced" type="button" aria-label={advancedCopy.title + ': ' + actualModelName(model)} disabled={checkingIds.has(model.id) || removingId === model.id} onClick={(event) => { advancedOpener.current = event.currentTarget; setAdvancedId(model.id); }}>{advancedCopy.advanced}</button>}
          {model.secret?.configured && !secrets[model.id]?.trim() && <button className="model-key-remove" type="button" disabled={removingId === model.id || checkingIds.has(model.id)} onClick={() => void removeConnection(model)}>{t(removingId === model.id ? '断开中…' : '断开')}</button>}
          </span>
        </div>;
      }} /> : <div className="model-settings-empty">{t('没有需要 API 密钥的云端模型。')}</div>}
    </div>
    <footer className="model-settings-foot"><span>{t(`${connectedCount} / ${keyModels.length} 个服务验证可用 · 验证不会生成内容或产生费用`)}</span><button className="primary" type="submit" disabled={loading || checkingIds.size > 0 || actionableCount === 0}>{t(checkingIds.size ? '正在验证…' : '验证并连接')}</button></footer>
  </form>{advancedId && models.find((model) => model.id === advancedId) && <ModelConnectionDialog key={advancedId} model={models.find((model) => model.id === advancedId)!} language={language} request={request} opener={advancedOpener.current} onClose={() => setAdvancedId('')} onSaved={async (model) => {
    setModels((current) => current.map((item) => item.id === model.id ? model : item));
    setSecrets((current) => ({ ...current, [model.id]: '' }));
    setNotice(advancedCopy.ready);
    await onModelsChanged();
  }} />}</>;
}
