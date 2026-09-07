import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { TripoPostprocessSubmission } from './TripoPostprocessWorkbench';

type OptimizeMode = 'appearance' | 'topology';
type AppearanceProfile = 'pbr' | 'clean-albedo';

type Props = {
  modelId: string;
  sourceTaskId?: string;
  busy?: boolean;
  status?: string;
  sourceStageLabel: string;
  selectedStageLabel: string;
  sourceAdjusted?: boolean;
  appearanceStageCount?: number;
  topologyStageCount?: number;
  onClose: () => void;
  onSubmit: (submission: TripoPostprocessSubmission) => void;
};

function stopPointer(event: ReactPointerEvent<HTMLElement>) {
  event.stopPropagation();
}

export function TripoModelOptimizePanel({ modelId, sourceTaskId, busy, status, sourceStageLabel, selectedStageLabel, sourceAdjusted, appearanceStageCount = 0, topologyStageCount = 0, onClose, onSubmit }: Props) {
  const [mode, setMode] = useState<OptimizeMode>('appearance');
  const [appearanceProfile, setAppearanceProfile] = useState<AppearanceProfile>('pbr');
  const [textureQuality, setTextureQuality] = useState('detailed');
  const [textureAlignment, setTextureAlignment] = useState('original_image');
  const [faceLimit, setFaceLimit] = useState(10000);
  const [quad, setQuad] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const unavailable = !modelId || !sourceTaskId;
  const effectiveFaceLimit = quad ? Math.min(faceLimit, 10000) : faceLimit;
  const nextStageBase = mode === 'appearance'
    ? appearanceProfile === 'clean-albedo' ? '纯色贴图' : '外观增强'
    : '拓扑优化';
  const existingStageCount = mode === 'appearance' ? appearanceStageCount : topologyStageCount;
  const nextStageLabel = existingStageCount > 0 ? nextStageBase + ' ' + (existingStageCount + 1) : nextStageBase;

  const submit = () => {
    if (unavailable || busy) return;
    setConfirmOpen(false);
    onSubmit(mode === 'appearance'
      ? {
        operation: 'texture',
        modelId,
        options: {
          model: 'v3.0-20250812',
          pbr: appearanceProfile === 'pbr',
          textureQuality,
          textureAlignment,
          ...(appearanceProfile === 'clean-albedo' ? { textureIntent: 'clean_albedo' } : {}),
          bake: false,
        },
      }
      : {
        operation: 'retopology',
        modelId,
        options: {
          model: 'v2.0',
          faceLimit: effectiveFaceLimit,
          quad,
          bake: true,
        },
      });
  };

  return <section className="tripo-model-tool-panel tripo-model-optimize-panel nodrag nowheel" onPointerDown={stopPointer} onWheel={(event) => event.stopPropagation()} aria-label="模型优化">
    <header>
      <div><strong>模型优化</strong><span>生成新的流程结果，不覆盖已有模型</span></div>
      <button type="button" onClick={onClose} aria-label="关闭模型优化">×</button>
    </header>
    <div className="tripo-model-optimize-modes" role="tablist" aria-label="优化类型">
      <button type="button" role="tab" aria-selected={mode === 'appearance'} className={mode === 'appearance' ? 'active' : ''} onClick={() => { setMode('appearance'); setConfirmOpen(false); }}><b>材质</b></button>
      <button type="button" role="tab" aria-selected={mode === 'topology'} className={mode === 'topology' ? 'active' : ''} onClick={() => { setMode('topology'); setConfirmOpen(false); }}><b>拓扑</b></button>
    </div>
    {mode === 'appearance' ? <div className="tripo-model-optimize-settings is-appearance">
      <div className="tripo-appearance-goals" role="radiogroup" aria-label="材质目标">
        <button type="button" role="radio" aria-checked={appearanceProfile === 'pbr'} className={appearanceProfile === 'pbr' ? 'active' : ''} onClick={() => setAppearanceProfile('pbr')}><b>PBR 材质</b><span>真实光泽与材质响应</span></button>
        <button type="button" role="radio" aria-checked={appearanceProfile === 'clean-albedo'} className={appearanceProfile === 'clean-albedo' ? 'active' : ''} onClick={() => { setAppearanceProfile('clean-albedo'); setTextureAlignment('original_image'); }}><b>三渲二纯色</b><span>移除贴图中的光影</span></button>
      </div>
      <p className="tripo-optimize-summary">{appearanceProfile === 'clean-albedo' ? '保留角色配色，硬阴影由预览器实时生成。' : '重建 PBR 贴图，不改变模型轮廓。'}</p>
      <button type="button" className="tripo-optimize-advanced-toggle" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((value) => !value)}><span>高级参数</span><b>{showAdvanced ? '收起' : '展开'}</b></button>
      {showAdvanced && <div className="tripo-optimize-advanced-fields">
        <label><span>增强级别</span><select value={textureQuality} onChange={(event) => setTextureQuality(event.currentTarget.value)}><option value="standard">标准</option><option value="detailed">精细（推荐）</option><option value="extreme">极致</option></select></label>
        <label><span>贴图对齐</span><select disabled={appearanceProfile === 'clean-albedo'} value={textureAlignment} onChange={(event) => setTextureAlignment(event.currentTarget.value)}><option value="original_image">保持参考图特征</option><option value="geometry">按模型几何重建</option></select></label>
      </div>}
    </div> : <div className="tripo-model-optimize-settings">
      <p className="tripo-optimize-summary wide">改善网格结构，方便进入引擎或继续编辑，不会凭空增加几何细节。</p>
      <label><span>目标精度</span><select value={effectiveFaceLimit} onChange={(event) => setFaceLimit(Number(event.currentTarget.value))}><option value={5000}>轻量 · 约 5千面</option><option value={10000}>平衡 · 约 1万面</option>{!quad && <option value={20000}>精细 · 约 2万面</option>}</select></label>
      <label className="tripo-model-export-switch"><input type="checkbox" checked={quad} onChange={(event) => { setQuad(event.currentTarget.checked); if (event.currentTarget.checked && faceLimit > 10000) setFaceLimit(10000); }} /><span><b>四边面</b><small>适合继续编辑；最高约 1 万面</small></span></label>
    </div>}
    {sourceAdjusted && <p className="tripo-model-route-note">将基于“{sourceStageLabel}”生成，当前“{selectedStageLabel}”保持不变。</p>}
    {unavailable && <p className="tripo-model-export-warning">当前模型缺少可用的原始建模或拓扑优化来源，已阻止创建无效任务。</p>}
    {busy && <p className="tripo-model-export-progress"><i /><span><strong>正在优化模型</strong><span>{status || '完成后会自动刷新当前预览。'}</span></span></p>}
    {confirmOpen ? <div className="tripo-model-inline-confirm" role="dialog" aria-label="确认模型优化">
      <div><strong>确认创建{nextStageLabel}任务？</strong><span>流程：{sourceStageLabel} → {nextStageLabel}。该操作会调用你配置的 Tripo 服务，是否收费由服务商决定。</span></div>
      <div><button type="button" onClick={() => setConfirmOpen(false)}>返回设置</button><button type="button" className="primary" onClick={submit}>确认并开始</button></div>
    </div> : <footer><span>{sourceStageLabel} → {nextStageLabel}<b>外部 Tripo 服务</b></span><button type="button" disabled={busy || unavailable} onClick={() => setConfirmOpen(true)}>{busy ? '优化中…' : mode === 'appearance' ? appearanceProfile === 'clean-albedo' ? '修复暗贴图' : '开始外观增强' : '开始拓扑优化'}</button></footer>}
  </section>;
}
