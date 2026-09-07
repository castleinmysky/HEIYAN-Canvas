import { useMemo, useState, type ReactNode } from 'react';
import { isValidTripoTaskId } from '../tripo3d-postprocess-request';

export type TripoPostprocessOperation = 'texture' | 'segment' | 'smart-segment' | 'complete' | 'retopology' | 'convert' | 'rig-check' | 'rig' | 'retarget';
export type TripoPostprocessSubmission = { operation: TripoPostprocessOperation; modelId: string; options: Record<string, unknown> };
export type TripoPostprocessResult = { operation?: string; riggable?: boolean; rigType?: string | null };

type TripoPreset = { id: string; name: string };
type Props = {
  sourceTaskId: string;
  sourceFormat: string;
  presets: TripoPreset[];
  busy?: boolean;
  result?: TripoPostprocessResult;
  onClose: () => void;
  onSubmit: (submission: TripoPostprocessSubmission) => void;
};

const operationLabels: Record<TripoPostprocessOperation, string> = {
  texture: '重新贴图', segment: '语义分割', 'smart-segment': '智能分割', complete: '网格补全', retopology: '重拓扑', convert: '格式转换', 'rig-check': '绑定检查', rig: '自动绑定', retarget: '动画重定向',
};
const httpsUrl = (value: string, label: string) => {
  const normalized = value.trim();
  if (!/^https:\/\//i.test(normalized)) throw new Error(`${label}必须是 HTTPS URL`);
  return normalized;
};
const optionalInteger = (value: string, label: string, minimum: number, maximum: number) => {
  if (!value.trim()) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${label}范围为 ${minimum.toLocaleString()}–${maximum.toLocaleString()}`);
  return number;
};
const optionalNumber = (value: string, label: string, minimum: number, exclusive = false) => {
  if (!value.trim()) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || (exclusive ? number <= minimum : number < minimum)) throw new Error(`${label}${exclusive ? '必须大于' : '不能小于'} ${minimum}`);
  return number;
};
const list = (value: string) => value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
const sourceOptions = (sourceTaskId: string) => ({ taskId: sourceTaskId });

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="tripo-post-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Toggle({ active, disabled, children, onClick }: { active: boolean; disabled?: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" className={active ? 'active' : ''} disabled={disabled} onClick={onClick}>{children}</button>;
}

export function TripoPostprocessWorkbench({ sourceTaskId, sourceFormat, presets, busy, result, onClose, onSubmit }: Props) {
  const [operation, setOperation] = useState<TripoPostprocessOperation>('texture');
  const [modelId, setModelId] = useState(presets[0]?.id || '');
  const [error, setError] = useState('');

  const [textureModel, setTextureModel] = useState('v3.0-20250812');
  const [texturePromptMode, setTexturePromptMode] = useState<'none' | 'text' | 'image' | 'views'>('none');
  const [textureText, setTextureText] = useState('');
  const [textureImage, setTextureImage] = useState('');
  const [textureViews, setTextureViews] = useState(['', '', '', '']);
  const [styleImage, setStyleImage] = useState('');
  const [texturePbr, setTexturePbr] = useState(true);
  const [textureQuality, setTextureQuality] = useState('detailed');
  const [textureAlignment, setTextureAlignment] = useState('original_image');
  const [textureSeed, setTextureSeed] = useState('');
  const [textureParts, setTextureParts] = useState('');
  const [textureCompress, setTextureCompress] = useState(false);
  const [textureBake, setTextureBake] = useState(false);

  const [segmentModel, setSegmentModel] = useState('v2.0-20260430');
  const [segmentGranularity, setSegmentGranularity] = useState('balanced');
  const [segmentConnectivity, setSegmentConnectivity] = useState(false);
  const [segmentRefImage, setSegmentRefImage] = useState('');

  const [smartSegmentType, setSmartSegmentType] = useState<'image' | 'model'>('model');
  const [smartSegmentSource, setSmartSegmentSource] = useState('');
  const [smartSegmentGranularity, setSmartSegmentGranularity] = useState('medium');
  const [smartSegmentHint, setSmartSegmentHint] = useState('');
  const [smartSegmentTransform, setSmartSegmentTransform] = useState('1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1');

  const [completionMode, setCompletionMode] = useState('ai_completion');
  const [completionParts, setCompletionParts] = useState('');

  const [retopoModel, setRetopoModel] = useState('v2.0');
  const [retopoFaceLimit, setRetopoFaceLimit] = useState('10000');
  const [retopoQuad, setRetopoQuad] = useState(false);
  const [retopoBake, setRetopoBake] = useState(true);
  const [retopoParts, setRetopoParts] = useState('');

  const [convertFormat, setConvertFormat] = useState('GLTF');
  const [convertQuad, setConvertQuad] = useState(false);
  const [forceSymmetry, setForceSymmetry] = useState(false);
  const [convertFaceLimit, setConvertFaceLimit] = useState('');
  const [flattenBottom, setFlattenBottom] = useState(false);
  const [flattenThreshold, setFlattenThreshold] = useState('');
  const [textureSize, setTextureSize] = useState('4096');
  const [textureFormat, setTextureFormat] = useState('PNG');
  const [convertBake, setConvertBake] = useState(true);
  const [packUv, setPackUv] = useState(false);
  const [vertexColors, setVertexColors] = useState(false);
  const [pivotBottom, setPivotBottom] = useState(false);
  const [scaleFactor, setScaleFactor] = useState('1');
  const [withAnimation, setWithAnimation] = useState(false);
  const [convertInPlace, setConvertInPlace] = useState(false);
  const [convertParts, setConvertParts] = useState('');
  const [exportOrientation, setExportOrientation] = useState('+y');
  const [fbxPreset, setFbxPreset] = useState('blender');

  const [rigModel, setRigModel] = useState('v2.5-20260210');
  const [rigType, setRigType] = useState('biped');
  const [rigSpec, setRigSpec] = useState('tripo');
  const [rigFormat, setRigFormat] = useState('glb');

  const [retargetBatch, setRetargetBatch] = useState(false);
  const [animations, setAnimations] = useState('preset:walk');
  const [retargetFormat, setRetargetFormat] = useState('glb');
  const [bakeAnimation, setBakeAnimation] = useState(false);
  const [exportGeometry, setExportGeometry] = useState(true);
  const [retargetInPlace, setRetargetInPlace] = useState(false);

  const effectiveConvertFormat = convertQuad ? 'FBX' : convertFormat;
  const rigCheckSupported = sourceFormat.toLowerCase() === 'glb';
  const retopoMaximum = retopoModel === 'v2.0' ? (retopoQuad ? 10_000 : 20_000) : (retopoQuad ? 150_000 : 2_000_000);
  const operationHint = useMemo(() => operation === 'texture'
    ? '质量修复：这是六类模型后处理中唯一会直接重建外观贴图的功能。建议重新提供参考图；精细与极致档会增加费用。'
    : operation === 'segment'
      ? '模型编辑：只拆分现有网格，不会增加几何或贴图细节。'
      : operation === 'smart-segment'
        ? '模型编辑：从图片或 GLB 自动建模并分割；要求 file_token 或公网 HTTPS URL，模型模式仅支持 GLB。'
        : operation === 'complete'
          ? '模型编辑：只接受语义分割任务，用于补全部件或封闭切口，不是通用质量增强。'
          : operation === 'retopology'
            ? '模型编辑：重建生产可用拓扑并控制面数，不会补回源模型缺失的造型细节。'
            : operation === 'convert'
              ? '导出交付：转换格式、朝向、贴图尺寸与轴心，不会提高模型本身质量。'
              : operation === 'rig-check'
                ? '动画：仅查询模型是否适合自动绑定，不产生新模型文件。'
                : operation === 'rig'
                  ? '动画：为现有模型创建骨架与蒙皮，不会改善模型外观。'
                  : '动画：源任务必须已经完成绑定；批量最多 5 个预设动画。', [operation]);

  const buildOptions = (): Record<string, unknown> => {
    const base = sourceOptions(sourceTaskId);
    if (operation === 'texture') {
      let texturePrompt: Record<string, unknown> | undefined;
      if (texturePromptMode === 'text') {
        if (!textureText.trim()) throw new Error('文本贴图模式需要提示词');
        texturePrompt = { text: textureText.trim(), ...(styleImage.trim() ? { styleImage: { url: httpsUrl(styleImage, '风格图') } } : {}) };
      } else if (texturePromptMode === 'image') {
        texturePrompt = { image: { url: httpsUrl(textureImage, '贴图参考图') } };
      } else if (texturePromptMode === 'views') {
        if (textureViews.some((url) => !url.trim())) throw new Error('四视图贴图必须依次填写 front / left / back / right');
        texturePrompt = { images: textureViews.map((url, index) => ({ url: httpsUrl(url, ['front', 'left', 'back', 'right'][index]) })) };
      }
      const seed = optionalInteger(textureSeed, '纹理 Seed', 0, 4_294_967_295);
      return { ...base, model: textureModel, ...(texturePrompt ? { texturePrompt } : {}), pbr: texturePbr, textureQuality, textureAlignment, ...(seed === undefined ? {} : { textureSeed: seed }), ...(list(textureParts).length ? { partNames: list(textureParts) } : {}), ...(textureCompress ? { compress: 'geometry' } : {}), bake: textureBake };
    }
    if (operation === 'segment') {
      if (segmentModel === 'v1.0-20250506') return { ...base, model: segmentModel };
      const refImage = segmentRefImage.trim();
      if (refImage && !/^(?:https:\/\/|file_)/i.test(refImage)) throw new Error('分割参考图必须是 HTTPS URL 或 file_token');
      return { ...base, model: segmentModel, ...(refImage ? { refImage } : { segmentationGranularity: segmentGranularity, splitByConnectivity: segmentConnectivity }) };
    }
    if (operation === 'smart-segment') {
      const source = smartSegmentSource.trim();
      if (!source || /[\u0000-\u001f]/.test(source) || (/^[a-z][a-z0-9+.-]*:\/\//i.test(source) && !/^https:\/\//i.test(source))) throw new Error('智能分割输入必须是 file_token 或 HTTPS URL');
      const sourceOption = /^https:\/\//i.test(source) ? { url: source } : { fileToken: source };
      let transform: number[] | undefined;
      if (smartSegmentType === 'model') {
        transform = list(smartSegmentTransform).map(Number);
        if (transform.length !== 16 || transform.some((value) => !Number.isFinite(value))) throw new Error('模型变换必须包含 16 个有限数字');
      }
      return { ...sourceOption, segType: smartSegmentType, granularity: smartSegmentGranularity, ...(smartSegmentHint.trim() ? { hint: smartSegmentHint.trim() } : {}), ...(transform ? { transform, sourceFormat: 'glb' } : {}) };
    }
    if (operation === 'complete') {
      return { ...base, model: 'v1.0-20250506', completionMode, ...(list(completionParts).length ? { partNames: list(completionParts) } : {}) };
    }
    if (operation === 'retopology') {
      const minimum = retopoModel === 'v2.0' ? 500 : 1;
      const faceLimit = optionalInteger(retopoFaceLimit, '目标面数', minimum, retopoMaximum);
      if (retopoModel === 'v1.0' && faceLimit === undefined) throw new Error('重拓扑 v1.0 必须填写目标面数');
      return { ...base, model: retopoModel, quad: retopoQuad, ...(faceLimit === undefined ? {} : { faceLimit }), ...(retopoModel === 'v2.0' ? { bake: retopoBake, ...(list(retopoParts).length ? { partNames: list(retopoParts) } : {}) } : {}) };
    }
    if (operation === 'convert') {
      const faceLimit = optionalInteger(convertFaceLimit, '目标面数', 1, convertQuad ? 150_000 : 2_000_000);
      const threshold = optionalNumber(flattenThreshold, '平底阈值', 0);
      const size = optionalInteger(textureSize, '纹理尺寸', 1, Number.MAX_SAFE_INTEGER);
      const scale = optionalNumber(scaleFactor, '缩放', 0, true);
      if (forceSymmetry && !convertQuad) throw new Error('强制对称要求开启四边面');
      if (vertexColors && !['OBJ', 'GLTF'].includes(effectiveConvertFormat)) throw new Error('顶点色仅支持 OBJ 或 GLTF');
      if (convertInPlace && !withAnimation) throw new Error('原地动画要求开启包含动画');
      return { ...base, format: effectiveConvertFormat, quad: convertQuad, forceSymmetry, ...(faceLimit === undefined ? {} : { faceLimit }), flattenBottom, ...(threshold === undefined ? {} : { flattenBottomThreshold: threshold }), ...(size === undefined ? {} : { textureSize: size }), textureFormat, bake: convertBake, packUv, exportVertexColors: vertexColors, pivotToCenterBottom: pivotBottom, ...(scale === undefined ? {} : { scaleFactor: scale }), withAnimation, animateInPlace: convertInPlace, ...(list(convertParts).length ? { partNames: list(convertParts) } : {}), exportOrientation, ...(effectiveConvertFormat === 'FBX' ? { fbxPreset } : {}) };
    }
    if (operation === 'rig-check') {
      if (!rigCheckSupported) throw new Error('绑定检查仅支持 GLB；请先转换为 GLB 并选择该版本');
      return { ...base, sourceFormat: 'glb' };
    }
    if (operation === 'rig') return { ...base, model: rigModel, rigType, spec: rigSpec, outFormat: rigFormat };
    const animationList = list(animations);
    if (!animationList.length || animationList.length > (retargetBatch ? 5 : 1)) throw new Error(retargetBatch ? '批量动画需要 1–5 个预设' : '单动画模式只能填写一个预设');
    if (animationList.some((animation) => !/^preset:[a-z0-9_:-]+$/i.test(animation))) throw new Error('动画必须使用 preset:walk 形式的预设标识');
    if (bakeAnimation && retargetFormat !== 'glb') throw new Error('烘焙动画仅支持 GLB 输出');
    return { ...base, ...(retargetBatch ? { animations: animationList } : { animation: animationList[0] }), outFormat: retargetFormat, ...(retargetFormat === 'glb' ? { bakeAnimation } : {}), exportWithGeometry: exportGeometry, animateInPlace: retargetInPlace };
  };

  const submit = () => {
    try {
      if (operation !== 'smart-segment' && !isValidTripoTaskId(sourceTaskId)) throw new Error('当前结果缺少有效的 Tripo3D task_id');
      if (!modelId) throw new Error('没有已启用的 Tripo3D 模型预设');
      const options = buildOptions(); setError(''); onSubmit({ operation, modelId, options });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '表单参数无效'); }
  };

  return <section className="tripo-postprocess-workbench" aria-label="Tripo3D 后处理工作台">
    <header><div><strong>Tripo 后处理</strong><small>源任务 {sourceTaskId}</small></div><button type="button" onClick={onClose} aria-label="关闭后处理工作台">×</button></header>
    <div className="tripo-postprocess-operations">{(Object.keys(operationLabels) as TripoPostprocessOperation[]).map((item) => <button type="button" key={item} className={operation === item ? 'active' : ''} disabled={item === 'rig-check' && !rigCheckSupported} title={item === 'rig-check' && !rigCheckSupported ? '绑定检查仅支持 GLB，请先转换格式' : undefined} onClick={() => { setOperation(item); setError(''); }}>{operationLabels[item]}</button>)}</div>
    <div className="tripo-postprocess-source"><Field label="执行预设"><select value={modelId} onChange={(event) => setModelId(event.currentTarget.value)}>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></Field><p>{operationHint}</p></div>

    <div className="tripo-postprocess-form">
      {operation === 'texture' && <>
        <div className='tripo-post-quality-note'><strong>真正改善外观质量</strong><span>优先重新上传原始参考图，并选择精细或极致贴图。只切换预览渲染模式不会改变模型文件本身。</span></div>
        <Field label="贴图模型"><select value={textureModel} onChange={(event) => { setTextureModel(event.currentTarget.value); if (event.currentTarget.value !== 'v3.0-20250812') setTextureCompress(false); }}><option value="v3.0-20250812">v3.0</option><option value="v2.5-20250123">v2.5</option></select></Field>
        <Field label="提示方式"><select value={texturePromptMode} onChange={(event) => setTexturePromptMode(event.currentTarget.value as typeof texturePromptMode)}><option value="none">沿用模型信息</option><option value="text">文本</option><option value="image">单张参考图</option><option value="views">四视图</option></select></Field>
        {texturePromptMode === 'text' && <><Field label="贴图提示词"><textarea value={textureText} onChange={(event) => setTextureText(event.currentTarget.value)} /></Field><Field label="风格图 URL" hint="仅文本模式可用"><input value={styleImage} placeholder="https://…" onChange={(event) => setStyleImage(event.currentTarget.value)} /></Field></>}
        {texturePromptMode === 'image' && <Field label="参考图 URL"><input value={textureImage} placeholder="https://…" onChange={(event) => setTextureImage(event.currentTarget.value)} /></Field>}
        {texturePromptMode === 'views' && textureViews.map((value, index) => <Field key={index} label={`${['Front', 'Left', 'Back', 'Right'][index]} URL`}><input value={value} placeholder="https://…" onChange={(event) => setTextureViews((current) => current.map((item, itemIndex) => itemIndex === index ? event.currentTarget.value : item))} /></Field>)}
        <Field label="贴图质量"><select value={textureQuality} onChange={(event) => setTextureQuality(event.currentTarget.value)}><option value="standard">标准</option><option value="detailed">精细</option><option value="extreme">极致</option></select></Field>
        <Field label="对齐"><select value={textureAlignment} onChange={(event) => setTextureAlignment(event.currentTarget.value)}><option value="original_image">原图</option><option value="geometry">几何</option></select></Field>
        <Field label="纹理 Seed"><input type="number" min="0" max="4294967295" value={textureSeed} placeholder="自动" onChange={(event) => setTextureSeed(event.currentTarget.value)} /></Field>
        <Field label="部件名称" hint="逗号或换行分隔"><textarea value={textureParts} onChange={(event) => setTextureParts(event.currentTarget.value)} /></Field>
        <div className="tripo-post-toggle-row"><Toggle active={texturePbr} onClick={() => setTexturePbr((value) => !value)}>PBR</Toggle><Toggle active={textureBake} onClick={() => setTextureBake((value) => !value)}>烘焙</Toggle><Toggle active={textureCompress} disabled={textureModel !== 'v3.0-20250812'} onClick={() => setTextureCompress((value) => !value)}>压缩几何</Toggle></div>
      </>}
      {operation === 'segment' && <>
        <Field label="分割模型"><select value={segmentModel} onChange={(event) => { setSegmentModel(event.currentTarget.value); if (event.currentTarget.value === 'v1.0-20250506') setSegmentRefImage(''); }}><option value="v2.0-20260430">v2.0</option><option value="v1.0-20250506">v1.0</option></select></Field>
        <Field label="粒度" hint={segmentModel.startsWith('v1') ? 'v2.0 专属' : segmentRefImage ? '填写参考图时停用' : undefined}><select disabled={segmentModel.startsWith('v1') || Boolean(segmentRefImage)} value={segmentGranularity} onChange={(event) => setSegmentGranularity(event.currentTarget.value)}><option value="simple">简单</option><option value="balanced">平衡</option><option value="detailed">精细</option></select></Field>
        <Field label="参考图 URL / Token" hint="与粒度、连通性互斥"><input disabled={segmentModel.startsWith('v1')} value={segmentRefImage} placeholder="https://… 或 file_…" onChange={(event) => setSegmentRefImage(event.currentTarget.value)} /></Field>
        <div className="tripo-post-toggle-row"><Toggle active={segmentConnectivity} disabled={segmentModel.startsWith('v1') || Boolean(segmentRefImage)} onClick={() => setSegmentConnectivity((value) => !value)}>按连通性拆分</Toggle></div>
      </>}
      {operation === 'smart-segment' && <>
        <Field label="输入类型"><select value={smartSegmentType} onChange={(event) => setSmartSegmentType(event.currentTarget.value as typeof smartSegmentType)}><option value="model">GLB 模型</option><option value="image">图片</option></select></Field>
        <Field label="文件 Token / 公网 URL" hint={smartSegmentType === 'model' ? '模型模式仅支持 GLB；不能直接使用 task_id' : 'PNG / JPEG / WebP'}><input value={smartSegmentSource} placeholder="file_… 或 https://…" onChange={(event) => setSmartSegmentSource(event.currentTarget.value)} /></Field>
        <Field label="粒度"><select value={smartSegmentGranularity} onChange={(event) => setSmartSegmentGranularity(event.currentTarget.value)}><option value="coarse">粗</option><option value="medium">中</option><option value="fine">细</option></select></Field>
        <Field label="识别提示词"><textarea value={smartSegmentHint} placeholder="可选：角色、武器、护甲…" onChange={(event) => setSmartSegmentHint(event.currentTarget.value)} /></Field>
        {smartSegmentType === 'model' && <Field label="4×4 变换矩阵" hint="列主序，16 个数字"><textarea value={smartSegmentTransform} onChange={(event) => setSmartSegmentTransform(event.currentTarget.value)} /></Field>}
      </>}
      {operation === 'complete' && <>
        <Field label="补全方式"><select value={completionMode} onChange={(event) => setCompletionMode(event.currentTarget.value)}><option value="ai_completion">AI 补全</option><option value="quick_cap">快速封口</option></select></Field>
        <Field label="部件名称" hint="留空补全所有部件；逗号或换行分隔"><textarea value={completionParts} onChange={(event) => setCompletionParts(event.currentTarget.value)} /></Field>
      </>}
      {operation === 'retopology' && <>
        <Field label="重拓扑模型"><select value={retopoModel} onChange={(event) => setRetopoModel(event.currentTarget.value)}><option value="v2.0">v2.0</option><option value="v1.0">v1.0</option></select></Field>
        <Field label="目标面数" hint={`${retopoModel === 'v2.0' ? 500 : 1}–${retopoMaximum.toLocaleString()}`}><input type="number" value={retopoFaceLimit} onChange={(event) => setRetopoFaceLimit(event.currentTarget.value)} /></Field>
        <Field label="部件名称" hint={retopoModel === 'v1.0' ? 'v2.0 专属' : '逗号或换行分隔'}><textarea disabled={retopoModel === 'v1.0'} value={retopoParts} onChange={(event) => setRetopoParts(event.currentTarget.value)} /></Field>
        <div className="tripo-post-toggle-row"><Toggle active={retopoQuad} onClick={() => setRetopoQuad((value) => !value)}>四边面</Toggle><Toggle active={retopoBake} disabled={retopoModel === 'v1.0'} onClick={() => setRetopoBake((value) => !value)}>烘焙</Toggle></div>
      </>}
      {operation === 'convert' && <>
        <Field label="格式" hint={convertQuad ? '四边面强制 FBX' : undefined}><select disabled={convertQuad} value={effectiveConvertFormat} onChange={(event) => setConvertFormat(event.currentTarget.value)}>{['GLTF', 'FBX', 'USDZ', 'OBJ', 'STL', '3MF'].map((format) => <option key={format}>{format}</option>)}</select></Field>
        <Field label="目标面数" hint={`1–${(convertQuad ? 150_000 : 2_000_000).toLocaleString()}`}><input type="number" value={convertFaceLimit} placeholder="保持原始" onChange={(event) => setConvertFaceLimit(event.currentTarget.value)} /></Field>
        <Field label="平底阈值"><input type="number" min="0" value={flattenThreshold} placeholder="可选" onChange={(event) => setFlattenThreshold(event.currentTarget.value)} /></Field>
        <Field label="纹理尺寸"><input type="number" min="1" value={textureSize} onChange={(event) => setTextureSize(event.currentTarget.value)} /></Field>
        <Field label="纹理格式"><select value={textureFormat} onChange={(event) => setTextureFormat(event.currentTarget.value)}>{['PNG', 'JPEG', 'WEBP', 'BMP', 'DPX', 'HDR', 'OPEN_EXR', 'TARGA', 'TIFF'].map((format) => <option key={format}>{format}</option>)}</select></Field>
        <Field label="缩放"><input type="number" min="0.0001" step="0.01" value={scaleFactor} onChange={(event) => setScaleFactor(event.currentTarget.value)} /></Field>
        <Field label="导出朝向"><select value={exportOrientation} onChange={(event) => setExportOrientation(event.currentTarget.value)}>{['+x', '-x', '+y', '-y'].map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="FBX 预设"><select disabled={effectiveConvertFormat !== 'FBX'} value={fbxPreset} onChange={(event) => setFbxPreset(event.currentTarget.value)}><option value="blender">Blender</option><option value="3dsmax">3ds Max</option><option value="mixamo">Mixamo</option></select></Field>
        <Field label="部件名称" hint="逗号或换行分隔"><textarea value={convertParts} onChange={(event) => setConvertParts(event.currentTarget.value)} /></Field>
        <div className="tripo-post-toggle-row"><Toggle active={convertQuad} onClick={() => { setConvertQuad((value) => !value); if (convertQuad) setForceSymmetry(false); }}>四边面</Toggle><Toggle active={forceSymmetry} disabled={!convertQuad} onClick={() => setForceSymmetry((value) => !value)}>强制对称</Toggle><Toggle active={flattenBottom} onClick={() => setFlattenBottom((value) => !value)}>平底</Toggle><Toggle active={convertBake} onClick={() => setConvertBake((value) => !value)}>烘焙</Toggle><Toggle active={packUv} onClick={() => setPackUv((value) => !value)}>重排 UV</Toggle><Toggle active={vertexColors} disabled={!['OBJ', 'GLTF'].includes(effectiveConvertFormat)} onClick={() => setVertexColors((value) => !value)}>顶点色</Toggle><Toggle active={pivotBottom} onClick={() => setPivotBottom((value) => !value)}>底部中心轴</Toggle><Toggle active={withAnimation} onClick={() => { setWithAnimation((value) => !value); if (withAnimation) setConvertInPlace(false); }}>包含动画</Toggle><Toggle active={convertInPlace} disabled={!withAnimation} onClick={() => setConvertInPlace((value) => !value)}>原地动画</Toggle></div>
      </>}
      {operation === 'rig-check' && <div className="tripo-rig-check-copy"><strong>检查 GLB 绑定兼容性</strong><p>提交后只返回 riggable 与建议 rigType，不创建模型输出。源任务应指向 GLB 模型。</p>{result?.operation === 'rig-check' && typeof result.riggable === 'boolean' && <div className={result.riggable ? 'success' : 'failure'}><b>{result.riggable ? '可绑定' : '不可绑定'}</b><span>{result.rigType ? `建议骨架：${result.rigType}` : '未返回建议骨架类型'}</span></div>}</div>}
      {operation === 'rig' && <>
        <Field label="绑定模型"><select value={rigModel} onChange={(event) => { setRigModel(event.currentTarget.value); if (event.currentTarget.value === 'v1.0-20240301') setRigType('biped'); }}><option value="v2.5-20260210">v2.5</option><option value="v1.0-20240301">v1.0</option></select></Field>
        <Field label="骨架类型"><select value={rigType} onChange={(event) => setRigType(event.currentTarget.value)}>{['biped', 'quadruped', 'hexapod', 'octopod', 'avian', 'serpentine', 'aquatic'].map((type) => <option key={type} disabled={rigModel.startsWith('v1') && type !== 'biped'}>{type}</option>)}</select></Field>
        <Field label="规范"><select value={rigSpec} onChange={(event) => setRigSpec(event.currentTarget.value)}><option value="tripo">Tripo</option><option value="mixamo">Mixamo</option></select></Field>
        <Field label="输出"><select value={rigFormat} onChange={(event) => setRigFormat(event.currentTarget.value)}><option value="glb">GLB</option><option value="fbx">FBX</option></select></Field>
      </>}
      {operation === 'retarget' && <>
        <Field label={retargetBatch ? '动画预设（1–5 个）' : '动画预设'} hint="preset:walk；逗号或换行分隔"><textarea value={animations} onChange={(event) => setAnimations(event.currentTarget.value)} /></Field>
        <Field label="输出"><select value={retargetFormat} onChange={(event) => { setRetargetFormat(event.currentTarget.value); if (event.currentTarget.value !== 'glb') setBakeAnimation(false); }}><option value="glb">GLB</option><option value="fbx">FBX</option></select></Field>
        <div className="tripo-post-toggle-row"><Toggle active={retargetBatch} onClick={() => setRetargetBatch((value) => !value)}>{retargetBatch ? '批量（最多 5 个）' : '单动画'}</Toggle><Toggle active={bakeAnimation} disabled={retargetFormat !== 'glb'} onClick={() => setBakeAnimation((value) => !value)}>烘焙动画</Toggle><Toggle active={exportGeometry} onClick={() => setExportGeometry((value) => !value)}>导出几何</Toggle><Toggle active={retargetInPlace} onClick={() => setRetargetInPlace((value) => !value)}>原地动画</Toggle></div>
      </>}
    </div>
    {error && <p className="tripo-postprocess-error" role="alert">{error}</p>}
    <footer><span>将调用你配置的外部服务；暂停后优先恢复远端任务，避免重复提交。</span><button type="button" className="primary" disabled={busy || !modelId} onClick={submit}>{busy ? '处理中…' : `执行${operationLabels[operation]}`}</button></footer>
  </section>;
}
