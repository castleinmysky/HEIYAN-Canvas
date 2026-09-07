import { useCallback, useEffect, useState } from 'react';
import {
  normalizeComfyUiResourceCategories,
  type ComfyUiLocalResource,
  type ComfyUiLocalResourceInventory,
} from '../comfyui-local-resources';

type RequestLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type ComfyUiSetupStage = 'offline' | 'discovered' | 'configured';

const emptyInventory = (): ComfyUiLocalResourceInventory => ({ available: false, checkpoints: [], loras: [], models: [], scannedAt: '' });
const responseMessage = (payload: unknown, fallback: string) => {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;
  return typeof record.error === 'string' ? record.error : typeof record.message === 'string' ? record.message : fallback;
};

export function comfyUiSetupStage(inventory: Pick<ComfyUiLocalResourceInventory, 'available' | 'models'>): ComfyUiSetupStage {
  if (!inventory.available) return 'offline';
  return inventory.models.length ? 'configured' : 'discovered';
}

export function comfyUiPreviewInventory(
  inventory: ComfyUiLocalResourceInventory,
  stage: ComfyUiSetupStage | null,
  previewModels: ComfyUiLocalResource[] = inventory.models.map((model) => ({ ...model, enabled: false })),
): ComfyUiLocalResourceInventory {
  if (!stage) return inventory;
  if (stage === 'offline') return { ...emptyInventory(), baseUrl: inventory.baseUrl };
  if (stage === 'discovered') return { ...inventory, available: true, models: [] };
  return { ...inventory, available: true, models: previewModels };
}

function resourceStateLabel(resource: Pick<ComfyUiLocalResource, 'state'>) {
  if (resource.state === 'ready') return '可用';
  if (resource.state === 'missing') return '缺少文件';
  if (resource.state === 'unloaded') return '等待加载';
  return '离线';
}

function resourceTypeLabel(resource: ComfyUiLocalResource) {
  if (resource.capability === 'video') return '本地视频模型';
  if (resource.adapter === 'comfyui-illustrious') return 'Illustrious 图片模型';
  if (resource.adapter === 'comfyui-native-image') return '原生图片模型';
  return 'Checkpoint 图片模型';
}

function workflowBlockingReasons(workflow: ComfyUiLocalResource['workflows'][number]) {
  if (!workflow.readiness || workflow.readiness.ready) return [];
  return Array.from(new Set([
    ...(workflow.readiness.blockingReasons || []),
    ...(workflow.readiness.missingDependencies || []).map((name) => `缺少 ${name}`),
    ...(workflow.readiness.missingPorts || []).map((name) => `缺少输入：${name}`),
  ]));
}

export function ComfyUiResources({
  open,
  onClose,
  request = fetch,
  onResourcesChanged,
  embedded = false,
}: {
  open: boolean;
  onClose: () => void;
  request?: RequestLike;
  onResourcesChanged?: () => Promise<void>;
  embedded?: boolean;
}) {
  const [inventory, setInventory] = useState<ComfyUiLocalResourceInventory>(emptyInventory);
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8188');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [manualSetup, setManualSetup] = useState(false);
  const [installationPath, setInstallationPath] = useState('');
  const [installationConnecting, setInstallationConnecting] = useState(false);
  const [publicationMutating, setPublicationMutating] = useState('');
  const [previewStage, setPreviewStage] = useState<ComfyUiSetupStage | null>(null);
  const [previewModels, setPreviewModels] = useState<ComfyUiLocalResource[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadResources = useCallback(async (notifyCanvas = false) => {
    setLoading(true);
    setError('');
    try {
      const response = await request('/api/v1/comfyui/resources');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(payload, 'ComfyUI 状态读取失败'));
      const next = payload as ComfyUiLocalResourceInventory;
      setInventory(next);
      if (next.baseUrl) setBaseUrl(next.baseUrl);
      setSelectedId((current) => next.models.some((model) => model.id === current) ? current : next.models[0]?.id || '');
      if (notifyCanvas) await onResourcesChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ComfyUI 状态读取失败');
    } finally {
      setLoading(false);
    }
  }, [onResourcesChanged, request]);

  useEffect(() => {
    if (!open) return;
    setNotice('');
    void loadResources();
  }, [loadResources, open]);

  const connectComfyUi = useCallback(async () => {
    if (previewStage) {
      setError('');
      setNotice('');
      if (previewStage === 'offline') {
        setPreviewStage('discovered');
        setNotice('预览：已进入模型识别步骤，真实配置没有变化');
      } else if (previewStage === 'discovered') {
        const models = inventory.models.map((model) => ({ ...model, enabled: false }));
        setPreviewModels(models);
        setSelectedId(models[0]?.id || '');
        setPreviewStage('configured');
        setNotice('预览：已识别本机模型，默认均未加入画布');
      } else {
        setNotice('预览：扫描完成，真实配置没有变化');
      }
      return;
    }
    setConnecting(true);
    setError('');
    setNotice('');
    try {
      let nextBaseUrl = baseUrl;
      if (!inventory.available && /^http:\/\/(127\.0\.0\.1|localhost):8188\/?$/i.test(baseUrl.trim())) {
        const detectedResponse = await request('/api/model-settings/comfyui/auto-connect', { method: 'POST' });
        const detectedPayload = await detectedResponse.json().catch(() => ({}));
        if (!detectedResponse.ok) throw new Error(responseMessage(detectedPayload, '本机 ComfyUI 检测失败'));
        if (!detectedPayload.found) {
          setManualSetup(true);
          throw new Error('这台电脑还没有可连接的 ComfyUI，请先安装，或指定已有软件位置。');
        }
        nextBaseUrl = String(detectedPayload.baseUrl || baseUrl);
        setBaseUrl(nextBaseUrl);
      }
      const response = await request('/api/v1/comfyui/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: nextBaseUrl }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(payload, 'ComfyUI 连接失败'));
      await loadResources(true);
      setNotice(`已识别 ${Number(payload.discoveredModels || 0)} 个可用模型`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ComfyUI 连接失败');
    } finally {
      setConnecting(false);
    }
  }, [baseUrl, inventory.available, inventory.models, loadResources, previewStage, request]);

  const connectInstallation = useCallback(async () => {
    if (!installationPath.trim()) {
      setError('请填写 ComfyUI 软件文件夹的完整路径');
      return;
    }
    if (previewStage) {
      const models = inventory.models.map((model) => ({ ...model, enabled: false }));
      setPreviewModels(models);
      setSelectedId(models[0]?.id || '');
      setPreviewStage('configured');
      setManualSetup(false);
      setNotice('预览：软件位置已接受，真实路径与配置没有变化');
      return;
    }
    setInstallationConnecting(true);
    setError('');
    setNotice('');
    try {
      const response = await request('/api/model-settings/comfyui/connect-installation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootPath: installationPath.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(payload, 'ComfyUI 软件连接失败'));
      const nextBaseUrl = String(payload.baseUrl || 'http://127.0.0.1:8188');
      const persistResponse = await request('/api/v1/comfyui/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: nextBaseUrl }),
      });
      const persistPayload = await persistResponse.json().catch(() => ({}));
      if (!persistResponse.ok) throw new Error(responseMessage(persistPayload, 'ComfyUI 模型识别失败'));
      setBaseUrl(nextBaseUrl);
      setManualSetup(false);
      await loadResources(true);
      setNotice(`ComfyUI 已启动，识别到 ${Number(persistPayload.discoveredModels || 0)} 个模型`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ComfyUI 软件连接失败');
    } finally {
      setInstallationConnecting(false);
    }
  }, [installationPath, inventory.models, loadResources, previewStage, request]);

  const togglePublication = useCallback(async (model: ComfyUiLocalResource) => {
    const enabled = !model.enabled;
    if (previewStage) {
      setPreviewModels((current) => current.map((item) => item.id === model.id ? { ...item, enabled } : item));
      setNotice(`预览：${model.name} ${enabled ? '已加入画布' : '已从画布隐藏'}，真实配置没有变化`);
      return;
    }
    setPublicationMutating(model.id);
    setError('');
    setNotice('');
    try {
      const response = await request(`/api/v1/admin/comfyui/models/${encodeURIComponent(model.id)}/publication`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(payload, '模型状态保存失败'));
      setInventory((current) => ({
        ...current,
        models: current.models.map((item) => item.id === model.id ? { ...item, enabled } : item),
      }));
      setNotice(enabled ? `${model.name} 已加入画布` : `${model.name} 已从画布隐藏`);
      await onResourcesChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模型状态保存失败');
    } finally {
      setPublicationMutating('');
    }
  }, [onResourcesChanged, previewStage, request]);

  if (!open) return null;

  const displayedInventory = comfyUiPreviewInventory(inventory, previewStage, previewModels);
  const stage = comfyUiSetupStage(displayedInventory);
  const selected = displayedInventory.models.find((model) => model.id === selectedId);
  const resourceCategories = normalizeComfyUiResourceCategories(displayedInventory).filter((category) => category.items.length);
  const installedResourceCount = resourceCategories.reduce((count, category) => count + category.items.length, 0);
  const enabledCount = displayedInventory.models.filter((model) => model.enabled).length;
  const readyCount = displayedInventory.models.filter((model) => model.state === 'ready').length;
  const stageCopy = stage === 'offline'
    ? ['未连接', '启动 ComfyUI 后保持默认地址即可']
    : stage === 'discovered'
      ? ['已发现运行引擎', `发现 ${installedResourceCount} 项本机资源，尚未建立画布模型`]
      : ['本地能力已就绪', `${readyCount} 个模型可用，${enabledCount} 个已加入画布`];

  return <section className={`model-settings model-settings-simple comfyui-simple${embedded ? ' is-embedded' : ''}`} aria-label="本地生成模块">
    {!embedded && <header className="model-settings-head"><strong>本地生成</strong><button type="button" onClick={onClose}>关闭</button></header>}
    <div className="comfyui-simple-scroll">
      <section className={`comfyui-preview-bar${previewStage ? ' is-active' : ''}`} aria-label="首次使用流程预览">
        <span><i aria-hidden="true" /><strong>{previewStage ? '正在预览新用户流程' : '需要从头测试？'}</strong><small>{previewStage ? '仅改变当前设置窗口的展示，不会关闭 ComfyUI、移动模型或修改真实配置。' : '可从“未安装”状态走完整流程，不触碰本机软件和模型。'}</small></span>
        <button type="button" onClick={() => {
          setError(''); setNotice(''); setManualSetup(false);
          if (previewStage) {
            setPreviewStage(null);
            setSelectedId(inventory.models[0]?.id || '');
          } else {
            setPreviewModels(inventory.models.map((model) => ({ ...model, enabled: false })));
            setPreviewStage('offline');
            setSelectedId('');
          }
        }}>{previewStage ? '退出预览' : '预览首次使用'}</button>
      </section>
      <section className={`comfyui-runtime-card is-${stage}`}>
        <div className="comfyui-runtime-symbol" aria-hidden="true"><i /><i /><i /></div>
        <span className="comfyui-runtime-copy"><strong>ComfyUI 运行引擎</strong><small>{stageCopy[1]}</small></span>
        <span className="comfyui-runtime-state"><i />{stageCopy[0]}</span>
        <form onSubmit={(event) => { event.preventDefault(); void connectComfyUi(); }}>
          <label><span>本机地址</span><input value={baseUrl} spellCheck={false} aria-label="ComfyUI 本机地址" onChange={(event) => setBaseUrl(event.target.value)} /></label>
          <button className="primary" type="submit" disabled={connecting}>{connecting ? '正在检测…' : stage === 'configured' ? '重新扫描' : stage === 'discovered' ? '识别模型' : '检测并连接'}</button>
        </form>
        <p>{previewStage ? '预览操作不会发出连接、扫描或启用请求。' : '只读取本机模型和节点信息，不移动模型文件，也不会运行工作流。'}</p>
      </section>

      {error && <div className="settings-inline-error" role="alert">{error}</div>}
      {notice && <div className="settings-inline-notice" role="status">{notice}</div>}

      <div className="comfyui-setup-path" aria-label="ComfyUI 配置进度">
        <span className={displayedInventory.available ? 'complete' : 'current'}><b>01</b><i>运行引擎</i></span>
        <span className={stage === 'configured' ? 'complete' : displayedInventory.available ? 'current' : ''}><b>02</b><i>本地模型</i></span>
        <span className={stage === 'configured' ? 'current' : ''}><b>03</b><i>工作流能力</i></span>
      </div>

      {stage === 'offline' && !loading && <section className="comfyui-first-run">
        <header><span><strong>这台电脑还没有 ComfyUI？</strong><small>先安装官方桌面版，它会准备独立的 Python 与 GPU 运行环境。</small></span><a href="https://docs.comfy.org/installation/desktop/windows" target="_blank" rel="noreferrer">打开官方安装向导</a></header>
        <div className="comfyui-first-run-steps">
          <span><b>1</b><strong>安装运行引擎</strong><small>只需完成一次</small></span>
          <span><b>2</b><strong>选择能力包</strong><small>图片、视频按需安装</small></span>
          <span><b>3</b><strong>自动装载工作流</strong><small>画布已内置工作流</small></span>
        </div>
        <button className="comfyui-existing-toggle" type="button" onClick={() => setManualSetup((current) => !current)}>{manualSetup ? '收起已有软件连接' : '我已经安装，指定软件位置'}</button>
        {manualSetup && <form className="comfyui-installation-path" onSubmit={(event) => { event.preventDefault(); void connectInstallation(); }}>
          <label><span>ComfyUI 软件文件夹</span><input value={installationPath} spellCheck={false} placeholder="例如 D:\\ComfyUI_windows_portable" onChange={(event) => setInstallationPath(event.target.value)} /></label>
          <button type="submit" disabled={installationConnecting}>{installationConnecting ? '正在启动…' : '保存位置并启动'}</button>
          <small>可选择包含 main.py 的文件夹，或便携版的上一级文件夹。之后画布会自动启动和连接。</small>
        </form>}
      </section>}

      {loading && !displayedInventory.models.length && !previewStage ? <div className="model-settings-empty">正在读取本机 ComfyUI…</div> : displayedInventory.models.length ? <div className="comfyui-capability-layout">
        <nav className="comfyui-model-list" aria-label="已识别的本地模型">
          <header><strong>本地模型</strong><small>{displayedInventory.models.length} 个</small></header>
          {displayedInventory.models.map((model) => <button type="button" key={model.id} className={model.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(model.id)}>
            <span><i className={`is-${model.state}`} /><strong>{model.name}</strong></span>
            <small>{resourceTypeLabel(model)} · {model.workflows.length} 个能力</small>
          </button>)}
        </nav>

        <main className="comfyui-capability-detail">
          {selected && <>
            <header>
              <span><strong>{selected.name}</strong><small>{resourceTypeLabel(selected)}</small></span>
              <button type="button" className={selected.enabled ? 'is-enabled' : ''} disabled={publicationMutating === selected.id} aria-pressed={selected.enabled} onClick={() => void togglePublication(selected)}>
                <i />{publicationMutating === selected.id ? '保存中…' : selected.enabled ? '画布中已启用' : '启用到画布'}
              </button>
            </header>
            <div className="comfyui-model-health">
              <span><i className={`is-${selected.state}`} /><strong>{resourceStateLabel(selected)}</strong><small>{selected.message}</small></span>
              <span><strong>{selected.workflows.length}</strong><small>个工作流能力</small></span>
            </div>
            <section className="comfyui-workflow-list">
              <header><strong>工作流能力</strong><small>工作流决定这个模型在画布里能做什么</small></header>
              {selected.workflows.length ? selected.workflows.map((workflow) => {
                const reasons = workflowBlockingReasons(workflow);
                return <article key={workflow.id} className={reasons.length ? 'is-blocked' : ''}>
                  <span><strong>{workflow.name}</strong><small>{reasons[0] || (workflow.editor === 'native' ? '可打开完整工作流编辑器' : '由画布直接管理')}</small></span>
                  <em>{reasons.length ? '不可用' : '可用'}</em>
                </article>;
              }) : <p>这个模型还没有绑定工作流。</p>}
            </section>
          </>}
        </main>
      </div> : stage === 'discovered' ? <section className="comfyui-capability-packs">
        <header><strong>选择第一个能力包</strong><small>工作流已经随画布提供；这里只需要安装与它匹配的模型文件。</small></header>
        <div>
          <article><span><b>推荐入门</b><strong>基础图片生成</strong><small>SDXL Checkpoint · 文生图 · 普通参考图</small></span><a href="https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0" target="_blank" rel="noreferrer">查看模型与许可</a></article>
          <article><span><b>高性能设备</b><strong>本地视频生成</strong><small>MiniMax H3 · 需要更大的显存与磁盘空间</small></span><a href="https://docs.comfy.org/interface/features/template" target="_blank" rel="noreferrer">查看安装方式</a></article>
        </div>
        <p>模型通常是数 GB 到数十 GB。正式的一键安装必须先显示下载体积、保存位置和许可证，并由用户确认；当前版本不会静默下载。</p>
      </section> : <section className="comfyui-empty-setup">
        <div className="comfyui-empty-visual" aria-hidden="true"><span /><span /><span /></div>
        <strong>{displayedInventory.available ? 'ComfyUI 已连接，等待识别模型' : '先启动并连接 ComfyUI'}</strong>
        <p>ComfyUI 是本地运行引擎；模型是它读取的资源；工作流决定模型可以完成的具体任务。</p>
      </section>}

      <details className="comfyui-technical-details">
        <summary><span><strong>高级信息</strong><small>查看模型文件分类与扫描状态</small></span><b>{installedResourceCount} 项资源</b></summary>
        <div>
          {resourceCategories.length ? resourceCategories.map((category) => <span key={category.id}><strong>{category.label || category.id}</strong><b>{category.items.length}</b></span>) : <p>连接 ComfyUI 后显示本机资源统计。</p>}
          {displayedInventory.scannedAt && <small>最后扫描：{new Date(displayedInventory.scannedAt).toLocaleString('zh-CN')}</small>}
        </div>
      </details>
    </div>
  </section>;
}
