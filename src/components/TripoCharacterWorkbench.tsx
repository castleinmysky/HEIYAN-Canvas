import { useEffect, useMemo, useRef, useState } from 'react';
import type { TripoPostprocessSubmission } from './TripoPostprocessWorkbench';
import {
  TRIPO_ANIMATION_BATCH_LIMIT,
  buildTripoRetargetSubmission,
  buildTripoRigCheckSubmission,
  buildTripoRigSubmission,
  canStartTripoRig,
  canSubmitTripoAnimation,
  completedTripoAnimationPresets,
  createTripoAnimationBatchKey,
  filterTripoAnimationPresets,
  normalizeAnimationSelection,
  pendingTripoAnimations,
  tripoCharacterConfirmationToken,
  type TripoAnimationCategory,
  type TripoCharacterDraft,
  type TripoCharacterRun,
  type TripoRigModel,
  type TripoRigType,
} from '../tripo-character-workflow';

export type TripoCharacterPreviewSelection = {
  kind: 'pose' | 'animation';
  key: string;
  src?: string;
  clip?: string;
};

export type TripoCharacterPaidConfirmation = {
  kind: 'rig' | 'rerig' | 'retarget';
  title: string;
  message: string;
  token: string;
  submission: TripoPostprocessSubmission;
};

type Props = {
  run: TripoCharacterRun;
  draft: TripoCharacterDraft;
  modelIds: { rigCheck: string; rig: string; retarget: string };
  sourceFormat?: string;
  busyStage?: 'rig-check' | 'rig' | 'retarget' | null;
  inspectionMode?: 'model' | 'skeleton';
  skeletonAvailable?: boolean | null;
  onDraftChange: (draft: TripoCharacterDraft) => void;
  onSubmit: (submission: TripoPostprocessSubmission) => void | Promise<void>;
  onAcceptRig: (runId: string, acceptedAt: string) => void;
  onPreviewSelection: (selection: TripoCharacterPreviewSelection) => void;
  confirmPaidSubmission?: (confirmation: TripoCharacterPaidConfirmation) => boolean | Promise<boolean>;
  onClose: () => void;
};

const RIG_TYPES: Array<{ value: TripoRigType; label: string }> = [
  { value: 'biped', label: '人形' }, { value: 'quadruped', label: '四足' }, { value: 'hexapod', label: '六足' },
  { value: 'octopod', label: '八足' }, { value: 'avian', label: '鸟类' }, { value: 'serpentine', label: '蛇形' }, { value: 'aquatic', label: '水生' },
];

const CATEGORIES: Array<{ value: TripoAnimationCategory | 'all'; label: string }> = [
  { value: 'all', label: '全部' }, { value: 'locomotion', label: '移动' }, { value: 'combat', label: '战斗' },
  { value: 'emotion', label: '情绪' }, { value: 'social', label: '互动' }, { value: 'sport', label: '运动' },
  { value: 'dance', label: '舞蹈' }, { value: 'daily', label: '日常' },
];

export const TRIPO_CHARACTER_INSPECTION_OPTIONS = [
  { key: 'model' as const, label: '模型表面' },
  { key: 'skeleton' as const, label: '骨架叠加' },
];

const stageLabel = (status?: string | null) => {
  if (status === 'succeeded') return '已完成';
  if (status === 'running') return '处理中';
  if (status === 'queued') return '排队中';
  if (status === 'paused') return '待恢复';
  if (status === 'failed') return '失败';
  return '未开始';
};

const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : '当前参数无法提交';

export function TripoCharacterWorkbench({
  run, draft, modelIds, sourceFormat = 'glb', busyStage, onDraftChange, onSubmit, onAcceptRig,
  inspectionMode = 'model', skeletonAvailable = null, onPreviewSelection, confirmPaidSubmission, onClose,
}: Props) {
  const [error, setError] = useState('');
  const [pendingPaidConfirmation, setPendingPaidConfirmation] = useState<TripoCharacterPaidConfirmation | null>(null);
  const [confirmingPaidSubmission, setConfirmingPaidSubmission] = useState(false);
  const paidFingerprints = useRef<{ rig: string; retarget: string }>({ rig: '', retarget: '' });
  const patchDraft = (patch: Partial<TripoCharacterDraft>) => onDraftChange({ ...draft, ...patch });
  const patchAnimationOptions = (patch: Partial<TripoCharacterDraft['animationOptions']>) => {
    onDraftChange({ ...draft, animationOptions: { ...draft.animationOptions, ...patch } });
  };

  const compatiblePresets = useMemo(() => filterTripoAnimationPresets({
    rigModel: draft.rigModel, rigType: draft.rigType, category: draft.category, query: draft.query,
  }), [draft.rigModel, draft.rigType, draft.category, draft.query]);
  const completedPresets = useMemo(() => completedTripoAnimationPresets(run), [run]);
  const pendingAnimations = useMemo(() => pendingTripoAnimations(draft.selectedPresets, run), [draft.selectedPresets, run]);

  let rigSubmission: TripoPostprocessSubmission | null = null;
  let retargetSubmission: TripoPostprocessSubmission | null = null;
  try {
    rigSubmission = buildTripoRigSubmission(run, {
      modelId: modelIds.rig, rigModel: draft.rigModel, rigType: draft.rigType, spec: draft.rigSpec, outFormat: draft.rigOutFormat,
      sourceFormat,
    });
  } catch { /* The stage UI explains why rigging is blocked. */ }
  try {
    const batchKey = createTripoAnimationBatchKey(run, draft.selectedPresets, draft.animationOptions);
    retargetSubmission = buildTripoRetargetSubmission(run, {
      modelId: modelIds.retarget, batchKey, presets: draft.selectedPresets, options: draft.animationOptions,
    });
  } catch { /* The animation footer explains why submission is blocked. */ }
  paidFingerprints.current = {
    rig: rigSubmission ? tripoCharacterConfirmationToken(rigSubmission) : '',
    retarget: retargetSubmission ? tripoCharacterConfirmationToken(retargetSubmission) : '',
  };

  const askForPaidConfirmation = async (
    kind: TripoCharacterPaidConfirmation['kind'],
    submission: TripoPostprocessSubmission,
  ) => {
    const token = tripoCharacterConfirmationToken(submission);
    const isRerig = kind === 'rerig';
    const title = isRerig ? '确认重新绑骨' : kind === 'rig' ? '确认自动绑骨' : '确认生成动画';
    const uploadsLocalSource = (kind === 'rig' || kind === 'rerig') && sourceFormat.toLocaleLowerCase() !== 'glb';
    const message = isRerig
      ? uploadsLocalSource
        ? `将保留当前绑定结果，同时把当前重拓扑 ${sourceFormat.toUpperCase()} 上传至你配置的 Tripo 服务；新绑定成功后再替换。服务商可能收费。`
        : '将保留当前绑定结果，直到新的绑定成功。该操作会提交新的外部 API 任务，服务商可能收费。'
      : uploadsLocalSource
        ? `将把当前重拓扑 ${sourceFormat.toUpperCase()} 上传至你配置的 Tripo 服务，并直接执行自动绑骨。服务商可能收费。`
      : '该操作会提交新的外部 API 任务，服务商可能收费；已知远端任务会优先恢复，避免重复提交。';
    const confirmation = { kind, title, message, token, submission };
    if (!confirmPaidSubmission) {
      setPendingPaidConfirmation(confirmation);
      return;
    }
    const accepted = await confirmPaidSubmission(confirmation);
    const key = kind === 'retarget' ? 'retarget' : 'rig';
    if (!accepted) return;
    if (paidFingerprints.current[key] !== token) {
      setError('确认后参数发生变化，请按当前设置重新确认。');
      return;
    }
    setError('');
    await onSubmit(submission);
  };

  const confirmPendingPaidSubmission = async () => {
    const confirmation = pendingPaidConfirmation;
    if (!confirmation || confirmingPaidSubmission) return;
    const key = confirmation.kind === 'retarget' ? 'retarget' : 'rig';
    if (paidFingerprints.current[key] !== confirmation.token) {
      setPendingPaidConfirmation(null);
      setError('确认期间参数发生变化，请按当前设置重新确认。');
      return;
    }
    setConfirmingPaidSubmission(true);
    setError('');
    try {
      await onSubmit(confirmation.submission);
      setPendingPaidConfirmation(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setConfirmingPaidSubmission(false);
    }
  };

  const submitRigCheck = async () => {
    try {
      setError('');
      await onSubmit(buildTripoRigCheckSubmission(run, modelIds.rigCheck));
    } catch (reason) { setError(errorMessage(reason)); }
  };

  const submitRig = async () => {
    try {
      const submission = buildTripoRigSubmission(run, {
        modelId: modelIds.rig, rigModel: draft.rigModel, rigType: draft.rigType, spec: draft.rigSpec, outFormat: draft.rigOutFormat,
        sourceFormat,
      });
      await askForPaidConfirmation(run.rig?.status === 'succeeded' ? 'rerig' : 'rig', submission);
    } catch (reason) { setError(errorMessage(reason)); }
  };

  const submitAnimations = async () => {
    try {
      const batchKey = createTripoAnimationBatchKey(run, draft.selectedPresets, draft.animationOptions);
      const submission = buildTripoRetargetSubmission(run, {
        modelId: modelIds.retarget, batchKey, presets: draft.selectedPresets, options: draft.animationOptions,
      });
      await askForPaidConfirmation('retarget', submission);
    } catch (reason) { setError(errorMessage(reason)); }
  };

  const togglePreset = (presetKey: string) => {
    try {
      const selectedPresets = draft.selectedPresets.includes(presetKey)
        ? draft.selectedPresets.filter((key) => key !== presetKey)
        : normalizeAnimationSelection([...draft.selectedPresets, presetKey]);
      setError('');
      patchDraft({ selectedPresets });
    } catch (reason) { setError(errorMessage(reason)); }
  };

  const previewAnimation = (presetKey: string) => {
    const mappedOutput = run.animationBatches
      .flatMap((batch) => batch.mappedOutputs || [])
      .find((candidate) => candidate.preset === presetKey)?.output;
    const fallbackOutput = run.animationBatches
      .flatMap((batch) => batch.outputs)
      .find((candidate) => candidate.presetKey === presetKey);
    const output = mappedOutput || fallbackOutput;
    onPreviewSelection({ kind: 'animation', key: presetKey, src: output?.mediaUrl || output?.url, clip: output?.clip });
  };

  const rigSucceeded = run.rig?.status === 'succeeded';
  const accepted = Boolean(run.acceptedAt);
  const normalizedSourceFormat = sourceFormat.toLocaleLowerCase();
  const rigCheckUnavailable = !run.sourceTaskId && normalizedSourceFormat !== 'glb';
  const rigCheckBlocked = rigCheckUnavailable || run.stale;
  const rigCheckPassed = rigCheckUnavailable || (run.rigCheck?.status === 'succeeded' && run.rigCheck.riggable !== false);
  const workflowStage: 'rig-check' | 'rig' | 'review' = !rigCheckPassed ? 'rig-check' : !rigSucceeded ? 'rig' : 'review';
  const [expandedStage, setExpandedStage] = useState<'rig-check' | 'rig' | 'review'>(workflowStage);

  useEffect(() => {
    setExpandedStage(workflowStage);
  }, [workflowStage]);

  useEffect(() => {
    if (!pendingPaidConfirmation) return;
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || confirmingPaidSubmission) return;
      event.preventDefault();
      setPendingPaidConfirmation(null);
    };
    window.addEventListener('keydown', dismissOnEscape);
    return () => window.removeEventListener('keydown', dismissOnEscape);
  }, [confirmingPaidSubmission, pendingPaidConfirmation]);

  const completedAnimationCount = run.animationBatches.filter((batch) => batch.status === 'succeeded').length;
  const generatorAction = expandedStage === 'rig-check'
    ? { label: rigCheckUnavailable ? `${sourceFormat.toUpperCase()} 不支持检查` : busyStage === 'rig-check' ? '检查中…' : run.rigCheck ? '重新检查' : '开始检查', cost: '只检查当前模型', disabled: Boolean(busyStage) || rigCheckBlocked, run: submitRigCheck }
    : expandedStage === 'rig'
      ? { label: busyStage === 'rig' ? '绑骨处理中…' : rigSucceeded ? '重新自动绑骨' : '生成绑定模型', cost: '提交到已配置的 Tripo 服务', disabled: Boolean(busyStage) || !canStartTripoRig(run, sourceFormat), run: submitRig }
      : draft.tab === 'animation'
        ? { label: busyStage === 'retarget' ? '生成动画中…' : '生成所选动画', cost: `${pendingAnimations.count} 个待生成动作`, disabled: Boolean(busyStage) || !canSubmitTripoAnimation(run) || !retargetSubmission || pendingAnimations.count === 0, run: submitAnimations }
        : { label: accepted ? '骨架已验收' : '确认骨架并进入动画', cost: '人工验收', disabled: !rigSucceeded || accepted, run: async () => onAcceptRig(run.id, new Date().toISOString()) };

  return <aside className="tripo-character-workbench" aria-label="游戏就绪角色工作台" data-stale={run.stale || undefined}>
    <div className="tripo-character-workbench__contract-header">
      <span className="tripo-character-workbench__contract-mark">◇</span>
      <div><small>角色生产工作流</small><strong>让来源 3D 模型成为可驱动角色</strong><p>先免费检查，再生成骨架；验收后选择并生成动画。</p></div>
      <em>{accepted ? '骨架已验收' : rigSucceeded ? '等待验收' : '官方 Tripo 流程'}</em>
    </div>

    <ol className="tripo-character-workbench__progress" aria-label="角色制作进度">
      <li data-active={expandedStage === 'rig-check'} data-state={rigCheckUnavailable ? 'skipped' : run.rigCheck?.status || 'idle'}><button type="button" onClick={() => setExpandedStage('rig-check')}><span>01</span><b>兼容检查</b><small>{rigCheckUnavailable ? '格式跳过' : stageLabel(run.rigCheck?.status)}</small></button></li>
      <li data-active={expandedStage === 'rig'} data-state={run.rig?.status || 'idle'}><button type="button" disabled={!rigCheckPassed} onClick={() => setExpandedStage('rig')}><span>02</span><b>自动绑骨</b><small>{stageLabel(run.rig?.status)}</small></button></li>
      <li data-active={expandedStage === 'review' && draft.tab === 'pose'} data-state={accepted ? 'succeeded' : rigSucceeded ? 'ready' : 'idle'}><button type="button" disabled={!rigSucceeded} onClick={() => { setExpandedStage('review'); patchDraft({ tab: 'pose' }); }}><span>03</span><b>骨架验收</b><small>{accepted ? '已通过' : rigSucceeded ? '待验收' : '未开始'}</small></button></li>
      <li data-active={expandedStage === 'review' && draft.tab === 'animation'} data-state={completedAnimationCount ? 'succeeded' : 'idle'}><button type="button" disabled={!accepted} onClick={() => { setExpandedStage('review'); patchDraft({ tab: 'animation' }); }}><span>04</span><b>动作动画</b><small>{completedAnimationCount || '未开始'}</small></button></li>
    </ol>

    {run.stale && <div className="tripo-character-workbench__notice" role="alert" data-tone="warning">
      <strong>源模型版本已更新</strong><span>当前角色分支保留为历史记录。请从新的模型版本重新创建角色任务，不会自动扣费。</span>
    </div>}

    <section className="tripo-character-workbench__stage" aria-labelledby="character-rig-check-title" data-expanded={expandedStage === 'rig-check'}>
      <button type="button" className="tripo-character-workbench__stage-heading" aria-expanded={expandedStage === 'rig-check'} onClick={() => setExpandedStage('rig-check')}>
        <div><span>01</span><strong id="character-rig-check-title">免费兼容检查</strong></div>
        <small>Rig Check · 只检查当前模型</small>
      </button>
      <div className="tripo-character-workbench__source-audit">
        <article><span>来源模型</span><strong>{run.sourceLabel || '3D 模型生成'}</strong><small>{run.sourceVersionJobId || '等待模型版本'}</small></article>
        <article><span>官方任务输入</span><strong>{run.sourceTaskId ? 'Task ID 已连接' : '缺少 Task ID'}</strong><small>{run.sourceTaskId || '请从成功生成或重拓扑结果创建角色节点'}</small></article>
        <article><span>模型格式</span><strong>{sourceFormat ? sourceFormat.toUpperCase() : '等待识别'}</strong><small>{run.sourceTaskId ? '由 Tripo 远端任务解析模型' : '本地文件仅支持 GLB 检查'}</small></article>
      </div>
      <div className="tripo-character-workbench__check-readiness" data-ready={!rigCheckBlocked || undefined}>
        <i aria-hidden="true" />
        <div><strong>{rigCheckBlocked ? '暂时不能提交兼容检查' : run.rigCheck?.status === 'succeeded' ? '兼容检查已经完成' : '已准备好执行检查'}</strong><span>{rigCheckBlocked ? '请确认来源模型已生成且仍可用。' : '只检查已生成模型，不会重新生成。'}</span></div>
      </div>
      {run.rigCheck?.status === 'succeeded' && <div className="tripo-character-workbench__result" data-result={run.rigCheck.riggable ? 'pass' : 'fail'}>
        <strong>{run.rigCheck.riggable ? '模型可以绑骨' : '当前模型不适合自动绑骨'}</strong>
        <span>{run.rigCheck.rigType ? `建议骨架：${RIG_TYPES.find((item) => item.value === run.rigCheck?.rigType)?.label || run.rigCheck.rigType}` : '未返回建议骨架类型'}</span>
      </div>}
      {rigCheckUnavailable && <small className="tripo-character-workbench__field-note">兼容检查仅支持 GLB；当前重拓扑 {sourceFormat.toUpperCase()} 会在外部服务确认后上传，并直接用于自动绑骨。</small>}
    </section>

    <section className="tripo-character-workbench__stage" aria-labelledby="character-rig-title" data-expanded={expandedStage === 'rig'}>
      <button type="button" className="tripo-character-workbench__stage-heading" aria-expanded={expandedStage === 'rig'} onClick={() => setExpandedStage('rig')}>
        <div><span>02</span><strong id="character-rig-title">自动绑骨</strong></div>
        <small>外部 Tripo 服务</small>
      </button>
      <div className="tripo-character-workbench__field-grid">
        <label><span>绑定模型</span><select value={draft.rigModel} onChange={(event) => {
          const rigModel = event.currentTarget.value as TripoRigModel;
          patchDraft({ rigModel, ...(rigModel === 'v1.0-20240301' ? { rigType: 'biped' as const } : {}) });
        }}><option value="v1.0-20240301">Rig v1.0 · 人形动作库</option><option value="v2.5-20260210">Rig v2.5 · 生物骨架</option></select></label>
        <label><span>骨架类型</span><select value={draft.rigType} onChange={(event) => patchDraft({ rigType: event.currentTarget.value as TripoRigType })}>
          {RIG_TYPES.map((type) => <option key={type.value} value={type.value} disabled={draft.rigModel === 'v1.0-20240301' && type.value !== 'biped'}>{type.label}</option>)}
        </select></label>
        <label><span>骨骼规范</span><select value={draft.rigSpec} onChange={(event) => patchDraft({ rigSpec: event.currentTarget.value as TripoCharacterDraft['rigSpec'] })}>
          <option value="mixamo">Mixamo · Unity / Unreal</option><option value="tripo">Tripo 原生</option>
        </select></label>
        <label><span>基础模型</span><select value={draft.rigOutFormat} onChange={(event) => patchDraft({ rigOutFormat: event.currentTarget.value as TripoCharacterDraft['rigOutFormat'] })}>
          <option value="glb">GLB</option><option value="fbx">FBX</option>
        </select></label>
      </div>
    </section>

    <section className="tripo-character-workbench__stage tripo-character-workbench__review" aria-labelledby="character-review-title" data-locked={!rigSucceeded || undefined} data-expanded={expandedStage === 'review'}>
      <button type="button" className="tripo-character-workbench__stage-heading" aria-expanded={expandedStage === 'review'} onClick={() => setExpandedStage('review')}>
        <div><span>03</span><strong id="character-review-title">骨架验收</strong></div>
        <small>{accepted ? '已确认' : rigSucceeded ? '需要人工确认' : '等待绑骨'}</small>
      </button>
      <div className="tripo-character-workbench__tabs" role="tablist" aria-label="动作工作区">
        <button type="button" role="tab" aria-selected={draft.tab === 'pose'} className={draft.tab === 'pose' ? 'is-active' : ''} disabled={!rigSucceeded} onClick={() => patchDraft({ tab: 'pose' })}>Pose</button>
        <button type="button" role="tab" aria-selected={draft.tab === 'animation'} className={draft.tab === 'animation' ? 'is-active' : ''} disabled={!accepted} onClick={() => patchDraft({ tab: 'animation' })}>动画</button>
      </div>

      {draft.tab === 'pose' && <div className="tripo-character-workbench__pose-panel" role="tabpanel">
        <div className="tripo-character-workbench__view-modes">
          {TRIPO_CHARACTER_INSPECTION_OPTIONS.map((pose) => <button type="button" key={pose.key} aria-pressed={inspectionMode === pose.key} disabled={!rigSucceeded || (pose.key === 'skeleton' && skeletonAvailable === false)} title={pose.key === 'skeleton' && skeletonAvailable === false ? '当前预览文件未检测到骨架' : undefined} onClick={() => onPreviewSelection({ kind: 'pose', key: pose.key })}>{pose.label}</button>)}
        </div>
        {skeletonAvailable === false && <p className="tripo-character-workbench__field-note" role="status">当前预览文件未检测到骨架，骨架叠加不可用；可重新绑定后再检查。</p>}
        <ul className="tripo-character-workbench__review-points">
          <li>肩、肘、腕的旋转方向</li><li>髋、膝、踝的弯曲与脚底位置</li><li>动作预览下的蒙皮拉伸和穿插</li>
        </ul>
        <p className="tripo-character-workbench__field-note">这里用于检查自动骨架和权重，不提供逐根骨骼编辑。</p>
      </div>}

      {draft.tab === 'animation' && <div className="tripo-character-workbench__animation-panel" role="tabpanel">
        <div className="tripo-character-workbench__browser-tools">
          <label className="tripo-character-workbench__search"><span>搜索动作</span><input value={draft.query} placeholder="Idle、Walk、Attack…" onChange={(event) => patchDraft({ query: event.currentTarget.value })} /></label>
          <label><span>分类</span><select value={draft.category} onChange={(event) => patchDraft({ category: event.currentTarget.value as TripoCharacterDraft['category'] })}>
            {CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
          </select></label>
        </div>
        <div className="tripo-character-workbench__preset-list" aria-label="兼容动画预设">
          {compatiblePresets.map((preset) => {
            const selected = draft.selectedPresets.includes(preset.key);
            const completed = completedPresets.has(preset.key);
            return <article key={preset.key} className="tripo-character-workbench__preset" data-selected={selected || undefined} data-completed={completed || undefined}>
              <button type="button" className="tripo-character-workbench__preset-select" aria-pressed={selected} onClick={() => togglePreset(preset.key)}>
                <span className="tripo-character-workbench__preset-mark" aria-hidden="true">{selected ? '✓' : ''}</span>
                <span><strong>{preset.label}</strong><small>{preset.key}</small></span>
                {completed && <em>已归档</em>}
              </button>
              <button type="button" className="tripo-character-workbench__preview-action" disabled={!completed} onClick={() => previewAnimation(preset.key)}>预览</button>
            </article>;
          })}
          {!compatiblePresets.length && <div className="tripo-character-workbench__empty">
            <strong>当前骨架暂无官方预设</strong><span>可调整骨架模型、类型或搜索条件。鸟类骨架当前官方文档未公布可用动作 ID。</span>
          </div>}
        </div>

        <div className="tripo-character-workbench__export-options">
          <label><span>输出格式</span><select value={draft.animationOptions.outFormat} onChange={(event) => {
            const outFormat = event.currentTarget.value as TripoCharacterDraft['animationOptions']['outFormat'];
            patchAnimationOptions({ outFormat, ...(outFormat === 'fbx' ? { bakeAnimation: false } : {}) });
          }}><option value="glb">GLB · 网页预览</option><option value="fbx">FBX · Unity / Unreal</option></select></label>
          <div className="tripo-character-workbench__toggle-row">
            <button type="button" aria-pressed={draft.animationOptions.animateInPlace} onClick={() => patchAnimationOptions({ animateInPlace: !draft.animationOptions.animateInPlace })}>原地动画</button>
            <button type="button" aria-pressed={draft.animationOptions.exportWithGeometry} onClick={() => patchAnimationOptions({ exportWithGeometry: !draft.animationOptions.exportWithGeometry })}>携带模型</button>
            <button type="button" aria-pressed={draft.animationOptions.bakeAnimation} disabled={draft.animationOptions.outFormat !== 'glb'} onClick={() => patchAnimationOptions({ bakeAnimation: !draft.animationOptions.bakeAnimation })}>烘焙动画</button>
          </div>
        </div>

        <footer className="tripo-character-workbench__animation-footer">
          <div><strong>已选 {draft.selectedPresets.length}/{TRIPO_ANIMATION_BATCH_LIMIT}</strong><span>{pendingAnimations.count} 个待生成动作</span></div>
        </footer>
      </div>}
    </section>

    <footer className="tripo-character-workbench__generator-footer">
      <div className="tripo-character-workbench__summary-card"><span>◇ 模型</span><strong>{draft.rigModel === 'v1.0-20240301' ? 'Tripo Rig v1.0' : 'Tripo Rig v2.5'}</strong></div>
      <div className="tripo-character-workbench__summary-card"><span>▣ 规格</span><strong>{draft.rigType === 'biped' ? '人形骨架' : draft.rigType} · {draft.rigSpec === 'mixamo' ? 'Mixamo' : 'Tripo'} · {draft.tab === 'animation' ? draft.animationOptions.outFormat.toUpperCase() : draft.rigOutFormat.toUpperCase()}</strong></div>
      <div className="tripo-character-workbench__generator-status"><i data-state={busyStage || 'idle'} /><span>{run.sourceLabel || '来源模型'} · {sourceFormat.toUpperCase()}</span></div>
      <button type="button" className="tripo-character-workbench__generator-action" disabled={generatorAction.disabled} onClick={() => void generatorAction.run()}><span>{generatorAction.label}</span><small>{generatorAction.cost}</small></button>
    </footer>

    {error && <p className="tripo-character-workbench__error" role="alert">{error}</p>}
    {pendingPaidConfirmation && <div className="tripo-character-paid-confirm-layer" role="presentation" onPointerDown={(event) => {
      event.stopPropagation();
      if (event.target === event.currentTarget && !confirmingPaidSubmission) setPendingPaidConfirmation(null);
    }}>
      <section className="tripo-character-paid-confirm" role="dialog" aria-modal="true" aria-labelledby="tripo-character-paid-confirm-title">
        <header>
          <div><span>EXTERNAL API</span><strong id="tripo-character-paid-confirm-title">{pendingPaidConfirmation.title}</strong></div>
          <button type="button" aria-label="取消确认" disabled={confirmingPaidSubmission} onClick={() => setPendingPaidConfirmation(null)}>×</button>
        </header>
        <div className="tripo-character-paid-confirm__body">
          <p>{pendingPaidConfirmation.message}</p>
          <dl>
            <div><dt>来源</dt><dd>{run.sourceLabel || '当前模型版本'}</dd></div>
            <div><dt>格式</dt><dd>{sourceFormat.toUpperCase()}</dd></div>
            <div><dt>任务</dt><dd>{pendingPaidConfirmation.kind === 'retarget' ? '动作动画' : pendingPaidConfirmation.kind === 'rerig' ? '重新绑骨' : '自动绑骨'}</dd></div>
          </dl>
        </div>
        <footer>
          <button type="button" className="tripo-character-workbench__secondary-action" disabled={confirmingPaidSubmission} onClick={() => setPendingPaidConfirmation(null)}>取消</button>
          <button type="button" className="tripo-character-workbench__primary-action" disabled={confirmingPaidSubmission} onClick={() => void confirmPendingPaidSubmission()}>
            {confirmingPaidSubmission ? '提交中…' : pendingPaidConfirmation.kind === 'retarget' ? '确认生成动画' : pendingPaidConfirmation.kind === 'rerig' ? '确认重新绑骨' : '确认自动绑骨'}
          </button>
        </footer>
      </section>
    </div>}
  </aside>;
}
