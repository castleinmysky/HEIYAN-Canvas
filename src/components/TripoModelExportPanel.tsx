import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { buildTripoAssetPackage, downloadBlob, tripoAssetBaseName } from '../tripo-asset-package';
import { canvasAssetDownloadUrl } from '../media-download';
import type { TripoPostprocessSubmission } from './TripoPostprocessWorkbench';
import type { TripoModelMetadata } from './TripoModelViewer';

export type TripoModelExportOutput = {
  mediaUrl?: string;
  fileName?: string;
  previewUrl?: string;
  tripoTaskId?: string;
};

export type TripoModelExportVersion = {
  jobId: string;
  format: string;
  createdAt?: string;
  outputs: TripoModelExportOutput[];
  sourceTaskId?: string;
  sourceVersion?: number;
};

type ExportFormat = 'GLB' | 'FBX' | 'GLTF' | 'OBJ' | 'USDZ' | 'STL' | '3MF';

type Props = {
  modelId: string;
  sourceUrl: string;
  sourceFileName?: string;
  assetName?: string;
  sourceTaskId?: string;
  busy?: boolean;
  status?: string;
  pendingFormat?: string;
  versions?: TripoModelExportVersion[];
  modelMetadata?: TripoModelMetadata;
  sourceVersion?: number;
  sourceLabel?: string;
  onClose: () => void;
  onSubmit: (submission: TripoPostprocessSubmission) => void;
};

const formats: Array<{ id: ExportFormat; label: string; hint: string }> = [
  { id: 'GLB', label: 'GLB', hint: 'PBR 原始交付' },
  { id: 'FBX', label: 'FBX', hint: '游戏引擎 / DCC' },
  { id: 'OBJ', label: 'OBJ', hint: '通用静态模型' },
  { id: 'GLTF', label: 'GLTF', hint: '网页与实时展示' },
  { id: 'USDZ', label: 'USDZ', hint: 'Apple AR' },
  { id: 'STL', label: 'STL', hint: '3D 打印' },
  { id: '3MF', label: '3MF', hint: '彩色打印' },
];

const commonFormats: ExportFormat[] = ['GLB', 'FBX', 'OBJ', 'GLTF'];
const supportedFormats = new Set<ExportFormat>(formats.map((item) => item.id));

export function inferTripoModelExportFormat(sourceFileName?: string, sourceUrl?: string): ExportFormat {
  const candidate = (sourceFileName || sourceUrl?.split(/[?#]/)[0].split('/').pop() || '').match(/\.([a-z0-9]+)$/i)?.[1]?.toUpperCase() as ExportFormat | undefined;
  return candidate && supportedFormats.has(candidate) ? candidate : 'GLB';
}

export function tripoModelDirectDownloadUrl(url: string) {
  if (!url || !/^\/api\/(?:v1\/canvas\/[^/]+\/assets\/|public\/canvas\/assets\/)/.test(url)) return url;
  if (/[?&]download=1(?:&|$)/.test(url)) return url;
  const [withoutHash, hash = ''] = url.split('#', 2);
  return withoutHash + (withoutHash.includes('?') ? '&' : '?') + 'download=1' + (hash ? '#' + hash : '');
}

export function tripoExportVersionMatchesSource(version: TripoModelExportVersion, sourceTaskId: string | undefined, sourceVersion: number) {
  if (version.sourceTaskId && sourceTaskId) return version.sourceTaskId === sourceTaskId;
  if (typeof version.sourceVersion === 'number') return version.sourceVersion === sourceVersion;
  return sourceVersion === 1;
}

export function safeTripoTextureExportOptions(modelMetadata: TripoModelMetadata | undefined, requestedSize: string, textureFormat: string) {
  if (!modelMetadata || modelMetadata.textureCount < 1) return {};
  const options: Record<string, unknown> = { textureFormat };
  if (requestedSize === 'original') return options;
  const size = Number(requestedSize);
  if (!Number.isInteger(size) || size < 1 || !modelMetadata.maxTextureSize || size > modelMetadata.maxTextureSize) return options;
  return { ...options, textureSize: size };
}

function stopPointer(event: ReactPointerEvent<HTMLElement>) {
  event.stopPropagation();
}

export function TripoModelExportPanel({ modelId, sourceUrl, sourceFileName, assetName, sourceTaskId, busy, status, pendingFormat, versions = [], modelMetadata, sourceVersion = 1, sourceLabel = '原始建模', onClose, onSubmit }: Props) {
  const detectedSourceFormat = useMemo(() => inferTripoModelExportFormat(sourceFileName, sourceUrl), [sourceFileName, sourceUrl]);
  const assetBaseName = useMemo(() => tripoAssetBaseName(assetName, tripoAssetBaseName(sourceFileName, '3D_模型')), [assetName, sourceFileName]);
  const [format, setFormat] = useState<ExportFormat>(detectedSourceFormat);
  const downloadModelFileName = assetBaseName + '.' + format.toLowerCase();
  const [textureSize, setTextureSize] = useState('original');
  const [textureFormat, setTextureFormat] = useState('PNG');
  const [fbxPreset, setFbxPreset] = useState('');
  const [pivotBottom, setPivotBottom] = useState(true);
  const [withAnimation, setWithAnimation] = useState(true);
  const [packUv, setPackUv] = useState(false);
  const [exportOrientation, setExportOrientation] = useState('+y');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showMoreFormats, setShowMoreFormats] = useState(false);
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [packageState, setPackageState] = useState<'idle' | 'packing' | 'done' | 'error'>('idle');
  const [packageMessage, setPackageMessage] = useState('');
  const selected = formats.find((item) => item.id === format) || formats[0];
  const currentVersions = useMemo(() => versions.filter((version) => tripoExportVersionMatchesSource(version, sourceTaskId, sourceVersion)), [sourceTaskId, sourceVersion, versions]);
  const latestReady = useMemo(() => [...currentVersions].reverse().find((version) => version.format.toUpperCase() === format), [currentVersions, format]);
  const readyOutput = latestReady?.outputs.find((output) => output.mediaUrl);
  const conversionUnavailable = !sourceTaskId || !modelId;
  const textureKnown = Boolean(modelMetadata);
  const hasTextures = Boolean(modelMetadata?.textureCount);
  const textureSizes = [512, 1024, 2048, 4096, 8192].filter((size) => size <= (modelMetadata?.maxTextureSize || 0));
  const sourceTextureLabel = hasTextures
    ? modelMetadata?.maxTextureWidth && modelMetadata?.maxTextureHeight
      ? [modelMetadata.maxTextureWidth, ' × ', modelMetadata.maxTextureHeight, ' · ', modelMetadata.textureCount, ' 张'].join('')
      : [modelMetadata?.textureCount, ' 张 · 尺寸未读取'].join('')
    : textureKnown ? '无贴图' : '自动识别';
  const isCurrentFile = format === detectedSourceFormat;
  const isPendingFormat = Boolean(busy && pendingFormat?.toUpperCase() === format);
  const supportsTextures = format !== 'STL';
  const supportsAnimation = format === 'FBX' || format === 'GLTF' || format === 'USDZ';
  const packageCapable = format === 'FBX' || format === 'GLB' || format === 'GLTF';

  useEffect(() => {
    setFormat(detectedSourceFormat);
    setConfirmOpen(false);
    setShowRegenerate(false);
    setPackageState('idle');
    setPackageMessage('');
  }, [detectedSourceFormat, sourceTaskId, sourceVersion]);

  useEffect(() => {
    if (textureSize === 'original') return;
    if (!textureSizes.includes(Number(textureSize))) setTextureSize('original');
  }, [textureSize, textureSizes]);

  const selectFormat = (next: ExportFormat) => {
    setFormat(next);
    setConfirmOpen(false);
    setShowRegenerate(false);
    setPackageState('idle');
    setPackageMessage('');
  };

  const downloadAssetPackage = async (modelUrl: string, modelFileName: string | undefined) => {
    if (packageState === 'packing') return;
    setPackageState('packing');
    setPackageMessage('正在整理模型与贴图…');
    try {
      const assetPackage = await buildTripoAssetPackage({
        modelUrl,
        modelFileName,
        assetName: assetBaseName,
        format,
        processLabel: sourceLabel,
        expectedTextureCount: modelMetadata?.textureCount || 0,
      });
      downloadBlob(assetPackage.blob, assetPackage.fileName);
      setPackageState('done');
      setPackageMessage('资产包已生成：模型 + ' + assetPackage.textureCount + ' 张贴图');
    } catch (error) {
      setPackageState('error');
      setPackageMessage(error instanceof Error ? error.message : '资产包生成失败');
    }
  };

  const formatBadge = (target: ExportFormat) => {
    if (target === detectedSourceFormat) return '当前';
    if (busy && pendingFormat?.toUpperCase() === target) return '导出中';
    if (currentVersions.some((version) => version.format.toUpperCase() === target && version.outputs.some((output) => output.mediaUrl))) return '可下载';
    return undefined;
  };

  const submit = () => {
    if (isCurrentFile || conversionUnavailable || busy) return;
    setConfirmOpen(false);
    onSubmit({
      operation: 'convert',
      modelId,
      options: {
        format,
        ...(supportsTextures ? safeTripoTextureExportOptions(modelMetadata, textureSize, textureFormat) : {}),
        bake: supportsTextures,
        packUv,
        pivotToCenterBottom: pivotBottom,
        withAnimation: supportsAnimation && withAnimation,
        exportOrientation,
        ...(format === 'FBX' && fbxPreset ? { fbxPreset } : {}),
      },
    });
  };

  const conversionSettings = <div className="tripo-model-export-settings">
    <div className="tripo-model-export-summary wide">
      <div><span>当前流程</span><strong>{sourceLabel}</strong></div>
      <div><span>将导出</span><strong>{format}</strong></div>
      <div><span>贴图</span><strong>{supportsTextures ? sourceTextureLabel : '此格式不包含'}</strong></div>
    </div>
    {format === 'FBX' && <label className="wide"><span>使用场景</span><select value={fbxPreset} onChange={(event) => setFbxPreset(event.currentTarget.value)}><option value="">通用</option><option value="blender">Blender</option><option value="3dsmax">3ds Max</option><option value="mixamo">Mixamo</option></select></label>}
    <label className="tripo-model-export-switch"><input type="checkbox" checked={pivotBottom} onChange={(event) => setPivotBottom(event.currentTarget.checked)} /><span><b>轴心放到底部中心</b><small>更适合放入场景</small></span></label>
    {supportsAnimation ? <label className="tripo-model-export-switch"><input type="checkbox" checked={withAnimation} onChange={(event) => setWithAnimation(event.currentTarget.checked)} /><span><b>保留动画</b><small>有动画时自动带出</small></span></label> : <div className="tripo-model-export-static-note"><b>静态格式</b><span>不会包含骨骼与动画</span></div>}
    <details className="wide"><summary>更多设置</summary><div>
      {supportsTextures && <><div className="tripo-model-source-texture wide"><span>源贴图</span><strong>{sourceTextureLabel}</strong><small>{textureKnown ? hasTextures ? '不会提供超过原图的虚假 4K 选项。' : '不会发送贴图相关参数。' : '完整 3D 预览加载后自动识别。'}</small></div>{hasTextures && <><label><span>贴图尺寸</span><select value={textureSize} onChange={(event) => setTextureSize(event.currentTarget.value)}><option value="original">保持原始（推荐）</option>{textureSizes.map((size) => <option key={size} value={size}>{size >= 1024 ? (size / 1024) + 'K' : size + 'px'}</option>)}</select></label><label><span>贴图格式</span><select value={textureFormat} onChange={(event) => setTextureFormat(event.currentTarget.value)}><option value="PNG">PNG</option><option value="JPEG">JPEG</option><option value="WEBP">WEBP</option></select></label></>}</>}
      <label><span>导出朝向</span><select value={exportOrientation} onChange={(event) => setExportOrientation(event.currentTarget.value)}>{['+x', '-x', '+y', '-y'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="tripo-model-export-switch"><input type="checkbox" checked={packUv} onChange={(event) => setPackUv(event.currentTarget.checked)} /><span><b>重新排列 UV</b><small>仅在特殊管线需要时开启</small></span></label>
    </div></details>
  </div>;

  const conversionAction = confirmOpen ? <div className="tripo-model-inline-confirm" role="dialog" aria-label="确认格式转换">
    <div><strong>确认导出 {format}？</strong><span>这会调用你配置的 Tripo 格式转换服务，不会替换当前模型；是否收费由服务商决定。</span></div>
    <div><button type="button" onClick={() => setConfirmOpen(false)}>取消</button><button type="button" className="primary" onClick={submit}>确认导出</button></div>
  </div> : <footer><span><strong>外部 Tripo 服务</strong> · 格式转换</span><button type="button" disabled={busy || conversionUnavailable} onClick={() => setConfirmOpen(true)}>{busy ? '导出中…' : '导出 ' + format}</button></footer>;

  return <section className="tripo-model-tool-panel tripo-model-export-panel nodrag nowheel" onPointerDown={stopPointer} onWheel={(event) => event.stopPropagation()} aria-label="导出模型">
    <header>
      <div><strong>导出模型</strong><span>当前流程：{sourceLabel}</span></div>
      <button type="button" onClick={onClose} aria-label="关闭导出模型">×</button>
    </header>
    <div className="tripo-model-export-context"><span>资产名称</span><strong>{assetBaseName}</strong><i>{detectedSourceFormat} · 名称跟随节点窗口</i></div>
    <div className="tripo-model-export-format-section">
      <div className="tripo-model-export-section-heading"><strong>选择格式</strong><span>{selected.hint}</span></div>
      <div className="tripo-model-export-formats">
        {formats.filter((item) => commonFormats.includes(item.id)).map((item) => { const badge = formatBadge(item.id); return <button key={item.id} type="button" className={format === item.id ? 'active' : ''} onClick={() => selectFormat(item.id)}><b>{item.label}</b>{badge && <i>{badge}</i>}</button>; })}
        <button type="button" className={'tripo-model-export-more-toggle ' + (showMoreFormats || !commonFormats.includes(format) ? 'active' : '')} aria-expanded={showMoreFormats} onClick={() => setShowMoreFormats((value) => !value)}><b>更多</b><span>{showMoreFormats ? '收起' : '3 种'}</span></button>
      </div>
      {(showMoreFormats || !commonFormats.includes(format)) && <div className="tripo-model-export-formats secondary">
        {formats.filter((item) => !commonFormats.includes(item.id)).map((item) => { const badge = formatBadge(item.id); return <button key={item.id} type="button" className={format === item.id ? 'active' : ''} onClick={() => selectFormat(item.id)}><b>{item.label}</b><span>{item.hint}</span>{badge && <i>{badge}</i>}</button>; })}
      </div>}
    </div>
    {isCurrentFile ? <><div className="tripo-model-export-direct">
      <div><strong>当前文件已经是 {format}</strong><span>{packageCapable ? '将模型、贴图与资源清单在本机打包为 ZIP' : '此格式不包含独立贴图资源'}</span></div>
      {packageCapable ? <div className="tripo-model-download-actions"><button type="button" disabled={packageState === 'packing'} onClick={() => downloadAssetPackage(sourceUrl, sourceFileName)}>{packageState === 'packing' ? '打包中…' : '下载资产包'}</button><a href={canvasAssetDownloadUrl(sourceUrl, downloadModelFileName)} download={downloadModelFileName}>仅模型</a></div> : <a href={canvasAssetDownloadUrl(sourceUrl, downloadModelFileName)} download={downloadModelFileName}>下载模型</a>}
    </div>{packageMessage && <p className={'tripo-model-package-status ' + packageState} role={packageState === 'error' ? 'alert' : 'status'}>{packageMessage}</p>}</> : readyOutput?.mediaUrl && !showRegenerate ? <div className="tripo-model-export-ready-wrap">
      <div className="tripo-model-export-ready"><div><strong>{format} 已生成</strong><span>{readyOutput.fileName || sourceLabel + ' · 可直接下载'}</span></div>{packageCapable ? <div className="tripo-model-download-actions"><button type="button" disabled={packageState === 'packing'} onClick={() => downloadAssetPackage(readyOutput.mediaUrl || '', readyOutput.fileName)}>{packageState === 'packing' ? '打包中…' : '下载资产包'}</button><a href={canvasAssetDownloadUrl(readyOutput.mediaUrl, downloadModelFileName)} download={downloadModelFileName}>仅模型</a></div> : <a href={canvasAssetDownloadUrl(readyOutput.mediaUrl, downloadModelFileName)} download={downloadModelFileName}>下载 {format}</a>}</div>
      {packageMessage && <p className={'tripo-model-package-status ' + packageState} role={packageState === 'error' ? 'alert' : 'status'}>{packageMessage}</p>}
      <button type="button" className="tripo-model-export-regenerate" onClick={() => setShowRegenerate(true)}>使用其他设置重新导出</button>
    </div> : <>
      {conversionSettings}
      {conversionUnavailable && <p className="tripo-model-export-warning">当前流程缺少 Tripo 源任务信息，只能下载现有文件。</p>}
      {isPendingFormat && <p className="tripo-model-export-progress"><i /><span><strong>正在导出 {format}</strong>{status || '完成后会自动变为可下载。'}</span></p>}
      {conversionAction}
    </>}
  </section>;
}
