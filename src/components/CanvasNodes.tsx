import { Component, memo, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ComponentType, type CSSProperties, type ErrorInfo, type PointerEvent as ReactPointerEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { Handle, NodeResizer, Position, useConnection, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import type { CharacterTurnaroundHeadRatio, CharacterTurnaroundPose } from '../character-turnaround';
import type { ModelingStyleId } from '../modeling-style';
import { gptImageSize } from '../cloud/gpt-image-size.js';
import { TripoModelViewer, type TripoAnimationClipInfo, type TripoAnimationProgress, type TripoModelFormat, type TripoModelMetadata } from './TripoModelViewer';
import { TripoModelExportPanel, type TripoModelExportVersion } from './TripoModelExportPanel';
import { TripoModelOptimizePanel } from './TripoModelOptimizePanel';
import { TripoPostprocessWorkbench, type TripoPostprocessResult, type TripoPostprocessSubmission } from './TripoPostprocessWorkbench';
import { defaultMultiViewCrops, detectTurnaroundBackgroundColor, multiViewCountLimits, multiViewCropsFromSplitLines, multiViewLabels, multiViewSplitLinesFromCrops, normalizeMultiViewCount, normalizeTurnaroundCrop, paintTurnaroundMaskStrokes, type TurnaroundCrop, type TurnaroundMaskStroke, type TurnaroundSideRole, type TurnaroundViewAsset, type TurnaroundViewRole } from '../turnaround-split';
import { safeTripoOptimizationSourceIndex } from '../tripo3d-postprocess-request';
import { TripoCharacterWorkbench, type TripoCharacterPreviewSelection } from './TripoCharacterWorkbench';
import { buildTripoRigCheckSubmission, createTripoCharacterDraft, createTripoCharacterRun, type TripoCharacterDraft, type TripoCharacterRun } from '../tripo-character-workflow';
import { createStoredZip, downloadBlob, tripoAssetBaseName } from '../tripo-asset-package';
import { appendPromptPreset, filterPromptPresets, promptPresets, type PromptPreset } from '../prompt-presets';
import type { H3ReferenceRole } from '../h3-full-reference-rule';
import type { WorkflowCollectionInputSlot } from '../workflow-collection';
import { createQuickCropFiles, quickCropPresets, type QuickCropOutput, type QuickCropPresetId, type QuickCropSpec } from '../image-quick-crop';
import { UiActionContent, UiIcon, type UiIconName } from './UiIcon';
import { PromptTokenComposer, resolvePromptTokenSelectionTags, type PromptTokenSelectionTag } from './PromptTokenComposer';
import { promptTokenMarker, promptTokenMarkerPattern, supportsNegativePromptTokens } from '../prompt-token-library';
import { canvasAssetDownloadUrl, nodeResourceDownloadFileName, videoDownloadFileName } from '../media-download';
import { persistentMediaLodUrl, type CanvasMediaLodLevel } from '../media-lod';
import { localMediaBindingRoleForPort, type LocalMediaBindingMethod, type LocalMediaBindingRole, type LocalMediaVersionPolicy } from '../../shared/local-media-binding.js';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';
import { promptPresetChipInterfaceCopy, storedCanvasInterfaceLanguage } from '../interface-language';
import { GeneratedImageHand } from './GeneratedImageHand';
import { GeneratorControlCardContent, GenerationRatioOption } from './GeneratorControlPrimitives';
import { GeneratorEditorLayout, type GeneratorComposerOptions } from './GeneratorEditorLayout';
export { generationRatioIconGeometry } from './GeneratorControlPrimitives';

export type DataType = 'text' | 'image' | 'imageSet' | 'video' | 'audio' | 'model';
export type VideoInputMode = 'reference' | 'first' | 'first_last';
export type SupportedCanvasNodeKind = 'text' | 'image' | 'video' | 'audio' | 'imageGenerator' | 'videoGenerator' | 'audioGenerator' | 'modelGenerator' | 'comfyUiWorkflow' | 'characterAnimator' | 'turnaroundSplitter' | 'result' | 'collection';
export type CanvasNodeKind = SupportedCanvasNodeKind | 'unsupported';

export function canvasImagePreviewUrl(mediaUrl?: string, explicitPreviewUrl?: string) {
  if (explicitPreviewUrl) return explicitPreviewUrl;
  if (!mediaUrl) return '';
  const [withoutHash, hash = ''] = mediaUrl.split('#', 2);
  const [pathname, query = ''] = withoutHash.split('?', 2);
  const localCanvasAsset = /^\/api\/(?:v1\/canvas\/[^/]+\/assets|public\/canvas\/assets)\/[^/]+$/i.test(pathname);
  if (!localCanvasAsset || /(?:^|&)preview=1(?:&|$)/.test(query)) return mediaUrl;
  return `${pathname}?${query ? `${query}&` : ''}preview=1${hash ? `#${hash}` : ''}`;
}
export type GenerationProfile = {
  ratios: string[];
  resolutions: string[];
  defaultRatio: string;
  defaultResolution: string;
  count: { min: number; max: number; default: number };
  duration: { min: number; max: number; default: number };
  audio: boolean;
  audioInput: boolean;
  legacyArkOptions?: boolean;
  outputFormats?: Array<'mp4' | 'mov'>;
  referenceLimits?: { images: number; videos: number; audios: number; total: number };
};
export type LocalH3QueueStatus = { available: boolean; state: 'idle' | 'busy' | 'queued' | 'running' | 'offline' | 'disabled'; mode?: 'direct' | 'relay'; autoStart?: boolean; concurrency: 1; running: number; queued: number; ahead: number; position: number; estimatedWaitSeconds: number; estimatedRunSeconds: number; error?: string; updatedAt?: string };
export type PoseControlMode = 'exact' | 'guided' | 'unsupported';
export type PoseControlInfo = { mode: PoseControlMode; label: string; detail: string };
export type AppearanceControlMode = 'identity' | 'reference' | 'unsupported';
export type AppearanceControlPrecision = 'precise' | 'approximate';
export type AppearanceControlInfo = { mode: AppearanceControlMode; precision?: AppearanceControlPrecision; method?: string; label: string; detail: string };
export type DetailEnhancementInfo = { mode: 'face-detailer'; label: string; detail: string };
export type ComfyUiWorkflowModePresentation = { title: string; description: string; note?: string };
export type ComfyUiAdvancedSamplingField = 'steps' | 'cfg' | 'sampler' | 'scheduler';
export type ComfyUiSamplingControls = {
  advanced: ComfyUiAdvancedSamplingField[];
  variation?: { field: 'referenceDenoise' | 'comfyDenoise'; requiresImagePort: string; defaultValue: number };
};
export type ComfyUiPurposeIntent = 'draft' | 'character' | 'edit' | 'pose' | 'identity' | 'inpaint' | 'final-quality';
export type ComfyUiWorkflowReadiness = {
  ready: boolean;
  blockingReasons: string[];
  missingDependencies: string[];
  missingPorts?: string[];
};
export type ComfyUiPurposeRecommendation = {
  purpose: ComfyUiPurposeIntent;
  label: string;
  recommendation: { modelId: string; modelName: string; workflowId: string; workflowName: string; priority: number; reason: string } | null;
  reason: string;
  blocked: Array<{ modelId: string; modelName: string; workflowId: string; workflowName: string; reasons: string[] }>;
};
export type ComfyUiWorkflowInfo = {
  id: string;
  name: string;
  capability: 'image' | 'video';
  modelId: string;
  modelName: string;
  editor: 'native' | 'managed';
  inputPorts?: Array<{ id: string; label: string; accepts: Array<'text' | 'image'>; multiple?: boolean; required?: boolean; minImages?: number; maxImages?: number; bindingRole?: LocalMediaBindingRole; bindingMethod?: LocalMediaBindingMethod; preparation?: string }>;
  controlDefaults?: Record<string, number>;
  appearanceControl?: AppearanceControlInfo;
  detailEnhancement?: DetailEnhancementInfo;
  poseControl?: PoseControlInfo;
  modePresentation?: ComfyUiWorkflowModePresentation;
  loraSlots?: Array<{ id: string; label: string }>;
  purposes?: ComfyUiPurposeIntent[];
  purposePriority?: Partial<Record<ComfyUiPurposeIntent, number>>;
  readiness?: ComfyUiWorkflowReadiness;
  qualityProfile?: { mode: 'high-res-refine'; maxIntermediateEdge: number; refineDenoise: number };
  samplingControls?: ComfyUiSamplingControls;
};
export type ModelInfo = {
  managed?: boolean;
  id: string;
  name: string;
  capability: 'image' | 'video' | 'audio' | 'model';
  adapter?: string;
  localImageFamily?: string;
  profile?: GenerationProfile;
  defaults?: { ratio: string; resolution: string };
  workflow?: ComfyUiWorkflowInfo;
  workflows?: ComfyUiWorkflowInfo[];
  loraCatalog?: {
    character: string[];
    style: string[];
    object: string[];
    presentation?: Record<string, { label?: string; previewUrl?: string }>;
  };
  comfyDefaults?: { steps: number; cfg: number; sampler: string; scheduler: string; denoise: number };
  localResource?: { state: 'ready' | 'unloaded' | 'missing' | 'offline'; installed: boolean; checkpoint: string; message: string };
  purposeRecommendations?: ComfyUiPurposeRecommendation[];
  localQueueStatus?: LocalH3QueueStatus;
  audioOptions?: {
    languages?: Array<{ id: 'zh' | 'ja' | 'en' | 'ko' | 'yue'; label: string }>;
    speed?: { min: number; max: number; default: number };
    referenceAudio?: boolean;
    voiceLibraries?: Array<{ id: string; label: string; installed: boolean; voiceCount?: number }>;
  };
  pricing?: { currency: 'CNY' | 'USD'; perOutput?: Record<string, number>; perSecond?: Record<string, number>; perSecondWithVideoInput?: Record<string, number>; completionTokenRates?: { withoutVideoInput?: Record<string, number>; withVideoInput?: Record<string, number> }; basis?: string; finalBasis?: string };
};

export const COMFY_UI_PURPOSES: ReadonlyArray<{ id: ComfyUiPurposeIntent; label: string }> = Object.freeze([
  { id: 'draft', label: '快速草稿' },
  { id: 'character', label: '角色立绘' },
  { id: 'edit', label: '参考图编辑' },
  { id: 'pose', label: '姿势控制' },
  { id: 'identity', label: '角色一致性' },
  { id: 'inpaint', label: '局部重绘' },
  { id: 'final-quality', label: '高品质定稿' },
]);

export function comfyUiWorkflowBlockingReasons(workflow?: Pick<ComfyUiWorkflowInfo, 'readiness'>): string[] {
  if (!workflow?.readiness || workflow.readiness.ready) return [];
  return Array.from(new Set([
    ...(workflow.readiness.blockingReasons || []),
    ...(workflow.readiness.missingDependencies || []).map((name) => `缺少依赖：${name}`),
    ...(workflow.readiness.missingPorts || []).map((name) => `缺少输入：${name}`),
  ]));
}

export function comfyUiWorkflowIsSelectable(workflow?: Pick<ComfyUiWorkflowInfo, 'readiness'>) {
  return !workflow?.readiness || workflow.readiness.ready;
}

export function comfyUiPurposeRecommendationFor(models: Array<Pick<ModelInfo, 'purposeRecommendations'>>, purpose?: ComfyUiPurposeIntent) {
  if (!purpose) return undefined;
  return models.find((model) => model.purposeRecommendations?.length)?.purposeRecommendations?.find((entry) => entry.purpose === purpose);
}

export type LocalModelPresentation = {
  icon: UiIconName;
  description: string;
};

export function localModelPresentation(model: Pick<ModelInfo, 'id' | 'name' | 'adapter' | 'localImageFamily'>): LocalModelPresentation {
  const identity = `${model.id} ${model.name} ${model.localImageFamily || ''}`.toLowerCase();
  if (identity.includes('anima')) return { icon: 'edit', description: '画动漫人物，也能改衣服和手脚。' };
  if (identity.includes('qwen') && identity.includes('edit')) return { icon: 'edit', description: '接角色参考图，保持人物并修改动作或画面。' };
  if (identity.includes('qwen')) return { icon: 'candidate', description: '适合中文海报、游戏美宣和细节成图。' };
  if (identity.includes('krea')) return { icon: 'run', description: '很快出图，适合先试几个想法。' };
  if (identity.includes('z-image')) return { icon: 'spark', description: '很快出图，适合草图和多种方案。' };
  if (identity.includes('hidream')) return { icon: 'candidate', description: '画面细节多，适合做最后成图。' };
  if (identity.includes('flux')) return { icon: 'imageGenerate', description: '适合真人质感、物品和大场景。' };
  if (identity.includes('newbie')) return { icon: 'character', description: '适合动漫人物和角色立绘。' };
  if (identity.includes('illustrious') || model.adapter === 'comfyui-illustrious') return { icon: 'character', description: '适合动漫角色、游戏立绘和人物细节。' };
  if (identity.includes('美宣') || identity.includes('sdxl') || model.adapter === 'comfyui-sdxl') return { icon: 'image', description: '适合游戏宣传图、海报和商业画面。' };
  return { icon: 'imageGenerate', description: '适合日常画图和尝试新想法。' };
}

export function localModelDisplayName(name: string) {
  return String(name || '')
    .replace(/\s*[（(]本地[)）]\s*$/u, '')
    .replace(/\s*[（(]\u5185\u90e8\u7814\u7a76[^)）]*[)）]\s*$/u, '')
    .trim();
}

export function localModelStatusLabel(model: Pick<ModelInfo, 'name' | 'localResource'>) {
  if (model.localResource?.state === 'missing') return '缺文件';
  if (model.localResource?.state === 'offline') return '离线';
  if (model.localResource?.state === 'unloaded') return '待刷新';
  if (/\u5185\u90e8\u7814\u7a76|非商用/u.test(model.name)) return '研究用';
  return model.localResource?.state === 'ready' ? '就绪' : '本地';
}

const poseControlModeRank: Record<PoseControlMode, number> = { unsupported: 0, guided: 1, exact: 2 };
const appearanceControlModeRank = (control: AppearanceControlInfo) => control.mode === 'unsupported'
  ? 0
  : control.precision === 'precise'
    ? 3
    : control.mode === 'identity'
      ? 2
      : 1;

export function localModelPoseControl(model: Pick<ModelInfo, 'workflow' | 'workflows'>): PoseControlInfo {
  const workflows = model.workflows?.length ? model.workflows : model.workflow ? [model.workflow] : [];
  return workflows.reduce<PoseControlInfo>((best, workflow) => {
    const candidate = workflow.poseControl;
    return candidate && poseControlModeRank[candidate.mode] > poseControlModeRank[best.mode] ? candidate : best;
  }, { mode: 'unsupported', label: '尚未适配', detail: '当前工作流尚未接入姿势控制器。' });
}

export function localModelAppearanceControl(model: Pick<ModelInfo, 'workflow' | 'workflows'>): AppearanceControlInfo {
  const workflows = model.workflows?.length ? model.workflows : model.workflow ? [model.workflow] : [];
  return workflows.reduce<AppearanceControlInfo>((best, workflow) => {
    const candidate = workflow.appearanceControl;
    return candidate && appearanceControlModeRank(candidate) > appearanceControlModeRank(best) ? candidate : best;
  }, { mode: 'unsupported', label: '未适配', detail: '当前模型没有可验证的角色外观锁定路径。' });
}

export function comfyUiIdentityPrecisionLabel(control?: Pick<AppearanceControlInfo, 'mode' | 'precision' | 'method'>) {
  if (!control || control.mode === 'unsupported') return '';
  if (control.precision === 'precise') return `精准身份锁定${control.method ? ` · ${control.method === 'instantid' ? 'InstantID' : control.method === 'pulid' ? 'PuLID' : control.method}` : ''}`;
  return control.mode === 'identity' || control.mode === 'reference' ? '近似外观参考' : '';
}

export function comfyUiWorkflowModePresentation(workflow: ComfyUiWorkflowInfo): ComfyUiWorkflowModePresentation {
  if (workflow.modePresentation) return workflow.modePresentation;
  if (workflow.editor === 'managed') return {
    title: workflow.poseControl?.mode === 'exact' ? '姿势控制' : workflow.name,
    description: workflow.poseControl?.detail || '使用画布控制图约束生成结果',
    note: '接入对应控制图后生效',
  };
  return {
    title: workflow.name,
    description: workflow.poseControl?.detail || '使用提示词或普通参考图生成',
    note: workflow.poseControl?.mode === 'guided' ? '不锁定人体骨架' : undefined,
  };
}

export function comfyUiWorkflowPresentationIcon(workflow: ComfyUiWorkflowInfo): UiIconName {
  if (/edit|编辑|重绘/i.test(`${workflow.id} ${workflow.name}`)) return 'edit';
  if (workflow.appearanceControl && workflow.appearanceControl.mode !== 'unsupported') return 'character';
  if (workflow.poseControl && workflow.poseControl.mode !== 'unsupported') return 'autoArrange';
  if (workflow.editor === 'managed') return 'collection';
  return 'imageGenerate';
}

export type ComfyUiSimpleModePresentation = {
  id: 'draw' | 'character' | 'pose' | 'edit' | 'inpaint';
  title: string;
  description: string;
  icon: UiIconName;
};

export function comfyUiWorkflowSimplePresentation(workflow: ComfyUiWorkflowInfo): ComfyUiSimpleModePresentation {
  const identity = `${workflow.id} ${workflow.name}`.toLowerCase();
  if (/inpaint|局部/.test(identity)) return { id: 'inpaint', title: '局部修改', description: '涂出要改的地方，其他位置尽量不动。', icon: 'edit' };
  if (/edit|编辑|重绘/.test(identity)) return { id: 'edit', title: '修改图片', description: '接一张图片，再告诉它想改什么。', icon: 'edit' };
  if (workflow.poseControl?.mode === 'exact') return { id: 'pose', title: '照着姿势', description: '接一张动作图，按图里的姿势来画。', icon: 'autoArrange' };
  if (workflow.appearanceControl && workflow.appearanceControl.mode !== 'unsupported') return { id: 'character', title: '保持角色', description: '接一张角色图，尽量画成同一个角色。', icon: 'character' };
  return { id: 'draw', title: '直接画', description: '输入你想要的画面，马上开始生成。', icon: 'imageGenerate' };
}

export function comfyUiWorkflowForResolution(model: ModelInfo | undefined, workflow: ComfyUiWorkflowInfo | undefined, resolution: string) {
  if (!model || !workflow || comfyUiWorkflowSimplePresentation(workflow).id !== 'draw') return workflow;
  const workflows = model.workflows?.length ? model.workflows : model.workflow ? [model.workflow] : [];
  const wantsHighResolution = String(resolution || '').toUpperCase() !== '1K';
  const target = wantsHighResolution
    ? workflows.find((candidate) => candidate.qualityProfile?.mode === 'high-res-refine' && comfyUiWorkflowIsSelectable(candidate))
    : workflows.find((candidate) => candidate.qualityProfile?.mode !== 'high-res-refine' && comfyUiWorkflowSimplePresentation(candidate).id === 'draw' && comfyUiWorkflowIsSelectable(candidate));
  return target || workflow;
}

const defaultAdvancedSamplingFields: ComfyUiAdvancedSamplingField[] = ['steps', 'cfg', 'sampler', 'scheduler'];

export function comfyUiAdvancedSamplingFields(workflow?: Pick<ComfyUiWorkflowInfo, 'samplingControls'>): ComfyUiAdvancedSamplingField[] {
  return workflow?.samplingControls?.advanced?.length ? workflow.samplingControls.advanced : defaultAdvancedSamplingFields;
}

type ComfyUiSamplingWorkflowContext = Pick<ComfyUiWorkflowInfo, 'samplingControls'>
  & Partial<Pick<ComfyUiWorkflowInfo, 'id' | 'editor' | 'inputPorts'>>;

export function effectiveComfyUiSamplingControls(
  model: Pick<ModelInfo, 'adapter' | 'localImageFamily'> | undefined,
  workflow: ComfyUiSamplingWorkflowContext | undefined,
): ComfyUiSamplingControls {
  if (workflow?.samplingControls) return workflow.samplingControls;
  const advanced = model?.localImageFamily === 'flux2-klein'
    ? defaultAdvancedSamplingFields.filter((field) => field !== 'scheduler')
    : defaultAdvancedSamplingFields;
  const imageToImagePort = workflow?.inputPorts?.find((port) => port.accepts.includes('image')
    && ['image-to-image', 'native-multimodal', 'inpaint-source'].includes(String(port.bindingMethod || '')))?.id || '';
  const referencePort = imageToImagePort
    || (model?.localImageFamily === 'qwen-image-edit-2511'
      || (model?.localImageFamily === 'anima-base-v1' && workflow?.id === 'anima-base-v1-inpaint-v1') ? 'reference' : '')
    || (['comfyui-sdxl', 'comfyui-illustrious'].includes(String(model?.adapter || ''))
      && workflow?.editor !== 'managed'
      && workflow?.inputPorts?.some((port) => port.id === 'input' && port.accepts.includes('image')) ? 'input' : '');
  return {
    advanced: [...advanced],
    ...(referencePort ? { variation: { field: 'referenceDenoise', requiresImagePort: referencePort, defaultValue: 0.72 } } : {}),
  };
}

export function comfyUiRuntimeSettingsLabel(
  model: Pick<ModelInfo, 'adapter' | 'localImageFamily' | 'comfyDefaults'> | undefined,
  workflow: ComfyUiSamplingWorkflowContext | undefined,
  values: Pick<CanvasNodeData, 'comfySeedMode' | 'comfySteps' | 'comfyCfg' | 'comfySampler' | 'comfyScheduler' | 'comfyDenoise' | 'referenceDenoise'>,
  variationEnabled = false,
): '模型推荐' | '已自定义' {
  if (values.comfySeedMode === 'fixed') return '已自定义';
  const defaults = model?.comfyDefaults;
  const samplingControls = effectiveComfyUiSamplingControls(model, workflow);
  const valueByField = {
    steps: values.comfySteps,
    cfg: values.comfyCfg,
    sampler: values.comfySampler,
    scheduler: values.comfyScheduler,
  };
  const defaultByField = {
    steps: defaults?.steps,
    cfg: defaults?.cfg,
    sampler: defaults?.sampler,
    scheduler: defaults?.scheduler,
  };
  const advancedCustomized = samplingControls.advanced.some((field) => {
    const current = valueByField[field];
    const recommended = defaultByField[field];
    if (current == null || recommended == null) return false;
    return typeof recommended === 'number'
      ? Math.abs(Number(current) - recommended) > 0.0001
      : String(current) !== String(recommended);
  });
  const variation = samplingControls.variation;
  const variationValue = variation?.field === 'comfyDenoise' ? values.comfyDenoise : values.referenceDenoise;
  const variationCustomized = Boolean(variationEnabled && variation && variationValue != null
    && Math.abs(Number(variationValue) - variation.defaultValue) > 0.0001);
  return advancedCustomized || variationCustomized ? '已自定义' : '模型推荐';
}

export function shouldDismissGeneratorPopover(container: Pick<HTMLElement, 'contains'> | null, target: EventTarget | null) {
  return Boolean(container && target && !container.contains(target as globalThis.Node));
}

function useGeneratorPopoverDismiss(containerRef: { current: HTMLDivElement | null }, open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const dismissOnPointerDown = (event: PointerEvent) => {
      if (shouldDismissGeneratorPopover(containerRef.current, event.target)) onDismiss();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', dismissOnPointerDown, true);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointerDown, true);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [containerRef, onDismiss, open]);
}

export function compatibleGeneratorSettings(model: ModelInfo, currentRatio?: string, currentResolution?: string, currentDuration?: number) {
  const profile = model.profile;
  const ratio = currentRatio && profile?.ratios.includes(currentRatio)
    ? currentRatio
    : model.defaults?.ratio || profile?.defaultRatio || profile?.ratios[0] || 'Auto';
  const normalizedResolution = String(currentResolution || '').toUpperCase();
  const resolution = normalizedResolution && profile?.resolutions.includes(normalizedResolution)
    ? normalizedResolution
    : model.defaults?.resolution || profile?.defaultResolution || profile?.resolutions[0] || normalizedResolution;
  const duration = currentDuration && profile && currentDuration >= profile.duration.min && currentDuration <= profile.duration.max
    ? currentDuration : profile?.duration.default;
  return { modelId: model.id, ratio, resolution, ...(model.capability === 'video' ? { duration } : {}) };
}

export function comfyUiParameterBindingId(modelId?: string, workflowId?: string) {
  return `${String(modelId || '').trim()}::${String(workflowId || '').trim()}`;
}

export type ComfyUiParameterProfile = Partial<Pick<CanvasNodeData,
  'ratio' | 'resolution' | 'count' | 'comfySeedMode' | 'seed' | 'comfySteps' | 'comfyCfg' | 'comfySampler' | 'comfyScheduler' | 'comfyDenoise'
  | 'referenceDenoise' | 'characterLora' | 'characterLoraStrength' | 'styleLora' | 'objectLora'
  | 'identityStrength' | 'proportionStrength' | 'poseStrength' | 'poseEstimator' | 'lineartStrength' | 'characterHeadRatio' | 'characterPose'
>>;

const comfyUiProfileKeys: Array<keyof ComfyUiParameterProfile> = [
  'ratio', 'resolution', 'count', 'comfySeedMode', 'seed', 'comfySteps', 'comfyCfg', 'comfySampler', 'comfyScheduler', 'comfyDenoise',
  'referenceDenoise', 'characterLora', 'characterLoraStrength', 'styleLora', 'objectLora',
  'identityStrength', 'proportionStrength', 'poseStrength', 'poseEstimator', 'lineartStrength', 'characterHeadRatio', 'characterPose',
];

export function captureComfyUiParameterProfile(current: Partial<CanvasNodeData> = {}): ComfyUiParameterProfile {
  return comfyUiProfileKeys.reduce<ComfyUiParameterProfile>((profile, key) => {
    const value = current[key];
    if (value !== undefined) (profile as Record<string, unknown>)[key] = value;
    return profile;
  }, {});
}

export function comfyUiBindingDefaults(model: ModelInfo, workflow: ComfyUiWorkflowInfo, current: Partial<CanvasNodeData> = {}) {
  const targetBinding = comfyUiParameterBindingId(model.id, workflow.id);
  const previousBinding = String(current.comfyParameterBinding || '').trim();
  const profiles = { ...(current.comfyParameterProfiles || {}) };
  const currentProfile = captureComfyUiParameterProfile(current);
  if (previousBinding) profiles[previousBinding] = currentProfile;
  const savedProfile = previousBinding === targetBinding ? currentProfile : profiles[targetBinding];
  const compatible = compatibleGeneratorSettings(
    model,
    savedProfile?.ratio ?? current.ratio,
    savedProfile?.resolution ?? current.resolution,
  );
  const defaultCount = model.profile?.count.default || 1;
  const requestedCount = Number(savedProfile?.count ?? current.count ?? defaultCount);
  const count = model.profile
    ? Math.min(model.profile.count.max, Math.max(model.profile.count.min, Number.isFinite(requestedCount) ? requestedCount : defaultCount))
    : Math.max(1, Number.isFinite(requestedCount) ? requestedCount : defaultCount);
  return {
    ...(workflow.controlDefaults || {}),
    comfySeedMode: 'random' as const,
    seed: undefined,
    comfySteps: model.comfyDefaults?.steps || 28,
    comfyCfg: model.comfyDefaults?.cfg || 5.5,
    comfySampler: model.comfyDefaults?.sampler || 'dpmpp_2m_sde',
    comfyScheduler: model.comfyDefaults?.scheduler || 'karras',
    comfyDenoise: model.comfyDefaults?.denoise || 1,
    characterLora: '',
    characterLoraStrength: 0.8,
    styleLora: '',
    objectLora: '',
    ...(savedProfile || {}),
    ...compatible,
    count,
    modelId: model.id,
    workflowId: workflow.id,
    comfyParameterBinding: targetBinding,
    comfyParameterProfiles: profiles,
  };
}

export function comfyUiExplicitWorkflowSelectionDefaults(model: ModelInfo, workflow: ComfyUiWorkflowInfo, current: Partial<CanvasNodeData> = {}) {
  const defaults = comfyUiBindingDefaults(model, workflow, current);
  if (workflow.qualityProfile?.mode !== 'high-res-refine' || String(defaults.resolution || '').toUpperCase() !== '1K') return defaults;
  const supportedResolutions = model.profile?.resolutions || [];
  const resolution = supportedResolutions.find((candidate) => String(candidate).toUpperCase() === '2K')
    || supportedResolutions.find((candidate) => String(candidate).toUpperCase() !== '1K')
    || '2K';
  return { ...defaults, resolution };
}
export type JobState = 'queued' | 'running' | 'cancelling' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
export type ComfyUiSamplingPreview = {
  url?: string;
  revision: number;
  contentType?: string;
  byteLength?: number;
  step: number;
  steps: number;
  nodeId?: string;
  outputIndex: number;
  seed?: number;
  updatedAt?: string;
};
export type TripoModelInputMode = 'text' | 'image' | 'imageToMultiview' | 'imageToMultiviewToModel' | 'multiview';
export type TripoModelPreset = 'preview' | 'game' | 'detail' | 'custom';
export type ResultOutput = { mediaUrl?: string; previewUrl?: string; fileName?: string; format?: string; simulated?: boolean; playable?: boolean; label?: string; width?: number; height?: number; duration?: number; tripoTaskId?: string; seed?: number; codec?: string; bitDepth?: number; crf?: number; encodingPreset?: 'quality' | 'balanced' | 'compact' | 'quality10'; faceRefineRequested?: boolean; faceRefined?: boolean; faceRefineWarning?: string; referenceVideoAudio?: boolean; accelerationMode?: 'standard' | 'turbo' | 'reference8' | 'community8'; samplingSteps?: number; generationDurationMs?: number; queueDurationMs?: number; totalDurationMs?: number };

export function generatedMediaDimensions(data: Pick<CanvasNodeData, 'mediaWidth' | 'mediaHeight'>, output?: ResultOutput): string {
  const width = Number(output?.width ?? data.mediaWidth);
  const height = Number(output?.height ?? data.mediaHeight);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? `${Math.round(width)} × ${Math.round(height)}`
    : '';
}
export type ResultVersion = { jobId: string; createdAt?: string; outputs: ResultOutput[]; mediaType: 'image' | 'video' | 'audio' | 'model'; operation?: string };
export type ModelExportVersion = TripoModelExportVersion;
export type ModelGeneratorVersion = { jobId: string; createdAt?: string; outputs: ResultOutput[]; operation: 'generate' | 'texture' | 'retopology' };

export function modelProcessBaseLabel(operation?: string) {
  return operation === 'texture' ? '外观增强' : operation === 'retopology' ? '拓扑优化' : '原始建模';
}

export function modelProcessStageLabel(versions: ModelGeneratorVersion[], index: number) {
  const version = versions[index];
  const base = modelProcessBaseLabel(version?.operation);
  const total = versions.filter((entry) => entry.operation === version?.operation).length;
  if (total < 2) return base;
  const occurrence = versions.slice(0, index + 1).filter((entry) => entry.operation === version?.operation).length;
  return base + ' ' + occurrence;
}

export function shouldDisplayModelFailure(
  jobState: JobState | undefined,
  jobId: string | undefined,
  versions: ModelGeneratorVersion[],
  selectedIndex: number,
) {
  if (jobState !== 'failed') return false;
  const selected = versions[selectedIndex];
  return !selected || selected.jobId === jobId;
}

export type ResultState = 'output' | 'candidate' | 'final' | 'submitted';
export type SendTarget = 'imageGenerator' | 'videoGenerator' | 'audioGenerator';
export type InputReference = { index: number; type: DataType; label: string; token: string; displayToken?: string; sourceId: string; port: string; edgeId: string; mediaUrl?: string; previewUrl?: string; mediaWidth?: number; mediaHeight?: number; duration?: number; text?: string; referenceRole?: H3ReferenceRole; mediaBindingRole?: LocalMediaBindingRole; mediaBindingMethod?: LocalMediaBindingMethod; mediaVersionPolicy?: LocalMediaVersionPolicy; sourceVersion?: string; referenceStrength?: number };
export function linkedImageReferencesForReplacement(references: readonly InputReference[]) {
  return references.filter((reference) => reference.type === 'image' && Boolean(reference.mediaUrl));
}
export function liveInputReferenceForReplacement(references: readonly InputReference[], openedReference: InputReference) {
  return references.find((reference) => reference.edgeId === openedReference.edgeId && reference.type === openedReference.type);
}
export const promptReferenceClipboardFormat = 'application/x-ai-canvas-prompt-references+json';
export type PromptClipboardReference = Pick<InputReference, 'type' | 'token' | 'sourceId' | 'label' | 'mediaUrl' | 'duration' | 'text'>;
export type PromptReferencePasteResult = { tokenMap: Record<string, string>; linkedCount: number; skippedCount: number };
export type PromptReferenceClipboardPayload = { version: 1; text: string; references: PromptClipboardReference[] };

export function h3OfficialPromptExample(references: InputReference[]) {
  const tokenFor = (type: 'image' | 'video' | 'audio', fallback: string) => references.find((reference) => reference.type === type)?.token || fallback;
  const image = tokenFor('image', '图片1');
  const video = tokenFor('video', '视频1');
  const audio = tokenFor('audio', '音频1');
  return `沿用@${video}的希区柯克式运镜，让@${image}中的人物面对镜头演唱，演唱声音参照@${audio}。保持人物身份、服装与场景连续，口型与歌声同步。`;
}
export type ImageReference = { sourceId: string; label: string; mediaUrl: string };

export function modelFormatFromOutput(output?: ResultOutput): TripoModelFormat | undefined {
  if (!output) return undefined;
  const explicit = String(output.format || '').trim().toLowerCase().replace(/^\./, '');
  if (explicit === 'glb' || explicit === 'model/gltf-binary' || explicit === 'gltf-binary') return 'glb';
  if (explicit === 'gltf' || explicit === 'model/gltf+json') return 'gltf';
  if (explicit === 'fbx') return 'fbx';
  const match = `${output.fileName || ''} ${output.mediaUrl || ''}`.match(/\.(glb|gltf|fbx)(?:$|[\s?#])/i);
  return match?.[1]?.toLowerCase() as TripoModelFormat | undefined;
}

export function previewableModelFormat(output?: ResultOutput): TripoModelFormat | undefined {
  return output?.mediaUrl ? modelFormatFromOutput(output) : undefined;
}

export function preferredInteractiveModelOutput(outputs: ResultOutput[]) {
  return outputs.find((output) => previewableModelFormat(output)) || outputs.find((output) => output.mediaUrl);
}

export function characterSourceModelFormat(
  run: Pick<TripoCharacterRun, 'sourceVersionJobId' | 'sourceVersionIndex' | 'sourceTaskId'> | undefined,
  versions: ModelGeneratorVersion[],
  latestOutput?: ResultOutput,
): TripoModelFormat | undefined {
  if (!run) return undefined;
  const sourceVersion = versions.find((version) => version.jobId === run.sourceVersionJobId)
    || versions[run.sourceVersionIndex];
  const sourceOutput = preferredInteractiveModelOutput(sourceVersion?.outputs || []);
  const sourceFormat = modelFormatFromOutput(sourceOutput);
  if (sourceFormat) return sourceFormat;

  const latestFormat = modelFormatFromOutput(latestOutput);
  if (!latestFormat) return undefined;
  const sameTask = Boolean(latestOutput?.tripoTaskId && (
    latestOutput.tripoTaskId === sourceOutput?.tripoTaskId
    || latestOutput.tripoTaskId === run.sourceTaskId
  ));
  const sameAsset = Boolean(sourceOutput?.mediaUrl && sourceOutput.mediaUrl === latestOutput?.mediaUrl);
  return sameTask || sameAsset ? latestFormat : undefined;
}

export function characterJobBelongsToRun(
  data: Pick<CanvasNodeData, 'activeCharacterJobRunId' | 'activeCharacterOperation'>,
  activeRunId: string | undefined,
  sourceFormat: string | undefined,
) {
  if (data.activeCharacterJobRunId) return data.activeCharacterJobRunId === activeRunId;
  return !(data.activeCharacterOperation === 'rig-check' && sourceFormat !== 'glb');
}

export function isCharacterRigSourceVersion(version?: ModelGeneratorVersion) {
  if (!version || version.operation === 'texture') return false;
  const output = preferredInteractiveModelOutput(version.outputs || []);
  const format = modelFormatFromOutput(output);
  if (!output?.tripoTaskId || !format) return false;
  if (version.operation === 'generate') return true;
  return Boolean(output.mediaUrl && output.fileName && ['glb', 'gltf', 'fbx'].includes(format));
}

export function characterRigSourceVersionIndex(versions: ModelGeneratorVersion[], selectedIndex: number) {
  if (!versions.length) return -1;
  const safeSelectedIndex = Math.min(Math.max(0, selectedIndex), versions.length - 1);
  if (isCharacterRigSourceVersion(versions[safeSelectedIndex])) return safeSelectedIndex;
  for (let index = safeSelectedIndex - 1; index >= 0; index -= 1) {
    if (isCharacterRigSourceVersion(versions[index])) return index;
  }
  return versions.findIndex(isCharacterRigSourceVersion);
}

export function canPreviewGlbOutput(output?: ResultOutput) {
  return previewableModelFormat(output) === 'glb';
}
export type TripoSubmittedOptions = {
  resolution: 'STANDARD' | 'DETAILED';
  geometryQuality: 'standard' | 'detailed';
  texture: boolean;
  pbr: boolean;
  textureQuality: 'standard' | 'detailed' | 'extreme';
  workflow?: string;
  modelVersion?: string;
  submittedAt?: string;
};
export type CanvasNodeData = Record<string, unknown> & {
  kind: CanvasNodeKind;
  title: string;
  text?: string;
  html?: string;
  prompt?: string;
  mediaUrl?: string;
  previewUrl?: string;
  mediaLodLevel?: CanvasMediaLodLevel;
  mediaType?: 'image' | 'video' | 'audio' | 'model';
  mediaWidth?: number;
  mediaHeight?: number;
  mediaDuration?: number;
  outputType?: DataType;
  fileName?: string;
  imageQuality?: 'auto' | 'low' | 'medium' | 'high';
  outputs?: ResultOutput[];
  resultVersions?: ResultVersion[];
  selectedVersion?: number;
  resultState?: ResultState;
  latestOutputs?: ResultOutput[];
  generationVersions?: ResultVersion[];
  latestMediaType?: 'image' | 'video' | 'audio' | 'model';
  modelExportVersions?: ModelExportVersion[];
  modelExportFormat?: string;
  modelExportSourceTaskId?: string;
  modelExportSourceVersion?: number;
  modelVersions?: ModelGeneratorVersion[];
  selectedModelVersion?: number;
  modelTextureMetadata?: TripoModelMetadata;
  characterRuns?: TripoCharacterRun[];
  activeCharacterRunId?: string;
  activeCharacterJobId?: string;
  activeCharacterJobRunId?: string;
  characterJobState?: JobState;
  characterProgress?: number;
  characterStatus?: string;
  activeCharacterOperation?: 'rig-check' | 'rig' | 'retarget';
  characterDrafts?: Record<string, TripoCharacterDraft>;
  selectedCharacterPose?: string;
  characterPreviewStage?: 'source' | 'rig' | 'animation';
  characterSkeletonAvailable?: boolean;
  selectedOutput?: number;
  status?: string;
  modelId?: string;
  workflowId?: string;
  comfyParameterBinding?: string;
  comfyParameterProfiles?: Record<string, ComfyUiParameterProfile>;
  ratio?: string;
  resolution?: string;
  count?: number;
  duration?: number;
  audioEnabled?: boolean;
  audioLanguage?: 'zh' | 'ja' | 'en' | 'ko' | 'yue';
  audioSpeed?: number;
  audioReferenceText?: string;
  seed?: number;
  comfySeedMode?: 'random' | 'fixed';
  comfySteps?: number;
  comfyCfg?: number;
  comfySampler?: string;
  comfyScheduler?: string;
  comfyDenoise?: number;
  cameraFixed?: boolean;
  returnLastFrame?: boolean;
  priority?: number;
  serviceTier?: 'default' | 'flex';
  videoInputMode?: VideoInputMode;
  refImageSize?: 'match' | 'max';
  referenceDenoise?: number;
  identityStrength?: number;
  proportionStrength?: number;
  poseStrength?: number;
  poseEstimator?: 'sdpose' | 'dwpose';
  posePreviewState?: 'idle' | 'running' | 'ready' | 'failed';
  posePreviewUrl?: string;
  posePreviewSourceUrl?: string;
  posePreviewKey?: string;
  posePreviewEstimator?: 'sdpose' | 'dwpose';
  posePreviewRatio?: string;
  posePreviewCached?: boolean;
  posePreviewError?: string;
  lineartStrength?: number;
  characterLora?: string;
  characterLoraStrength?: number;
  styleLora?: string;
  objectLora?: string;
  referenceVideoAudio?: boolean;
  h3EncodingPreset?: 'quality' | 'balanced' | 'compact' | 'quality10';
  h3SamplingSteps?: 20 | 24 | 28;
  h3AccelerationMode?: 'standard' | 'turbo' | 'reference8' | 'community8';
  h3GuideTimes?: Record<string, number>;
  h3BlockCache?: boolean;
  h3FaceRefine?: boolean;
  outputFormat?: 'mp4' | 'mov';
  executionExpiresAfter?: number;
  webSearch?: boolean;
  texture?: boolean;
  pbr?: boolean;
  autoSize?: boolean;
  enableImageAutofix?: boolean;
  modelInputMode?: TripoModelInputMode;
  modelPreset?: TripoModelPreset;
  textureQuality?: 'standard' | 'detailed' | 'extreme';
  geometryQuality?: 'standard' | 'detailed';
  imageSeed?: number;
  textureSeed?: number;
  modelSeed?: number;
  faceLimit?: number;
  quad?: boolean;
  smartLowPoly?: boolean;
  generateParts?: boolean;
  exportUv?: boolean;
  textureAlignment?: 'original_image' | 'geometry';
  orientation?: 'default' | 'align_image';
  negativePrompt?: string;
  promptTokenIds?: string[];
  negativePromptTokenIds?: string[];
  tripoPostprocessOperation?: string;
  tripoPostprocessResult?: TripoPostprocessResult;
  tripoSubmittedOptions?: TripoSubmittedOptions;
  jobId?: string;
  /** Job that actually produced latestOutputs; submitting a new job does not change it. */
  latestOutputJobId?: string;
  jobState?: JobState;
  jobStartedAt?: string;
  jobDeadlineAt?: string;
  jobPollLost?: boolean;
  cancelling?: boolean;
  progress?: number;
  comfyPreview?: ComfyUiSamplingPreview;
  comfyUiNodeLayoutVersion?: 2;
  generatorPanelDock?: 'bottom' | 'top' | 'left' | 'right';
  generatorPanelDockDragging?: boolean;
  /** Compatibility with canvases saved during the initial ComfyUI-only docking rollout. */
  comfyPanelDock?: 'bottom' | 'top' | 'left' | 'right';
  localQueue?: LocalH3QueueStatus;
  stale?: boolean;
  simulated?: boolean;
  playable?: boolean;
  publicMode?: boolean;
  singleNodeSelected?: boolean;
  inlineRenaming?: boolean;
  models?: ModelInfo[];
  creationMode?: 'textToImage' | 'imageToImage' | 'imageEdit';
  characterHeadRatio?: CharacterTurnaroundHeadRatio;
  characterPose?: CharacterTurnaroundPose;
  modelingStyleId?: ModelingStyleId;
  systemAssetKind?: 'character-proportion-guide';
  turnaroundSourceUrl?: string;
  turnaroundSourceNodeId?: string;
  turnaroundCrops?: TurnaroundCrop[];
  turnaroundViewCount?: number;
  turnaroundConfidence?: number;
  turnaroundDetectionVersion?: number;
  turnaroundSideRole?: TurnaroundSideRole;
  turnaroundViews?: TurnaroundViewAsset[];
  turnaroundConfirmed?: boolean;
  turnaroundMaskStrokes?: TurnaroundMaskStroke[];
  turnaroundBackgroundColor?: string;
  turnaroundViewRole?: TurnaroundViewRole;
  derivedFromNodeId?: string;
  imageInpaintActive?: boolean;
  imageInpaintPreviousUrl?: string;
  imageInpaintPreviousPreviewUrl?: string;
  imageInpaintPreviousFileName?: string;
  imageInpaintPreviousWidth?: number;
  imageInpaintPreviousHeight?: number;
  imageInpaintMaskUrl?: string;
  videoUpscale?: boolean;
  videoUpscaleSourceUrl?: string;
  videoUpscaleSourceWidth?: number;
  videoUpscaleSourceHeight?: number;
  videoUpscaleSourceDuration?: number;
  topazModel?: '星光 2.6' | 'Astra' | 'Astra HQ' | 'Astra Fast' | 'Astra Sharp';
  topazVram?: number;
  topazScale?: 1 | 2 | 3 | 4;
  topazStrength?: 0.7 | 1 | 1.3;
  topazInputQuality?: number;
  topazSharpness?: '自然' | '平衡' | '锐利（默认）';
  disabledMultiviewPorts?: Array<'front' | 'left' | 'back' | 'right'>;
  memberIds?: string[];
  collapsed?: boolean;
  executable?: boolean;
  expandedWidth?: number;
  expandedHeight?: number;
  collectionInputCount?: number;
  collectionOutputCount?: number;
  collectionInputs?: WorkflowCollectionInputSlot[];
  collectionContentFrame?: { position: { x: number; y: number }; width: number; height: number };
  workflowState?: 'idle' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled';
  workflowProgress?: number;
  workflowStatus?: string;
  workflowFailedNodeIds?: string[];
  inputReferences?: InputReference[];
  inputReferenceRoles?: Partial<Record<string, H3ReferenceRole>>;
  imageReferences?: ImageReference[];
  onListImageReferences?: (targetId: string) => ImageReference[];
  connectionGuideType?: DataType;
  hasIncomingConnection?: boolean;
  hasOutgoingConnection?: boolean;
  onAddImageReference: (targetId: string, sourceId: string) => void;
  onRemoveImageReference: (targetId: string, sourceId: string) => void;
  onDisconnectInputReference?: (targetId: string, edgeId: string) => void;
  onSetInputReferenceVersionPolicy?: (targetId: string, edgeId: string, policy: LocalMediaVersionPolicy) => void;
  onPasteImageReference: (targetId: string, file: File) => void;
  onPastePromptReferences?: (targetId: string, references: PromptClipboardReference[]) => PromptReferencePasteResult;
  // View-only command supplied by the Agent dock, never stored on a graph node.
  promptReferenceInsertion?: { requestId: string; tokens: string[] };
  onPromptReferenceInserted?: (requestId: string) => void;
  onReplaceInputReference?: (targetId: string, edgeId: string, sourceId: string) => boolean;
  onUploadModelView?: (targetId: string, port: 'front' | 'left' | 'back' | 'right', file: File) => Promise<void> | void;
  onRemoveModelView?: (targetId: string, port: 'front' | 'left' | 'back' | 'right') => void;
  onCreateTurnaroundSplit?: (sourceId: string, mediaUrl?: string) => void;
  onQuickCropImage?: (sourceId: string, output: QuickCropOutput, sourceMediaUrl?: string) => Promise<void> | void;
  onInpaintImage?: (sourceId: string, prompt: string, maskFile: File) => Promise<void> | void;
  onRestoreImageInpaint?: (sourceId: string) => void;
  onUpscaleVideo?: (sourceId: string, sourceMediaUrl?: string) => Promise<void> | void;
  onConfirmVideoUpscale?: (nodeId: string) => Promise<void> | void;
  onConfirmTurnaroundSplit?: (targetId: string, crops: TurnaroundCrop[], sideRole: TurnaroundSideRole) => Promise<void> | void;
  onPlaceTurnaroundImages?: (targetId: string) => void;
  onChange: (id: string, patch: Partial<CanvasNodeData>, mode?: 'text' | 'runtime') => void;
  onEditStart: (id: string) => void;
  onEditEnd: (id: string) => void;
  onUpload: (id: string, file: File) => void;
  onRun: (id: string) => void;
  onBeginGeneratorPanelDockDrag?: (id: string, pointer: { pointerId: number; clientX: number; clientY: number }) => void;
  onSelectComfyUiWorkflow?: (id: string, modelId: string, workflowId: string) => void;
  onOpenComfyUiEditor?: (id: string, modelId: string, workflowId: string) => void;
  onPreviewPose?: (id: string) => Promise<void> | void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onResume?: (id: string) => void;
  onRetryPaid?: (id: string) => void;
  onResumeCharacterJob?: (id: string) => void;
  onRetryCharacterPaid?: (id: string) => void;
  onRunTripoPostprocess?: (id: string, submission: TripoPostprocessSubmission) => void;
  onCreateCharacterNode?: (sourceId: string, sourceVersionIndex?: number) => void;
  onRefreshJob: (id: string) => void;
  onSetResultState: (id: string, state: ResultState) => void;
  onSelectResultVersion: (id: string, version: number) => void;
  onSend: (id: string, target: SendTarget) => void;
  onFocusSource: (id: string) => void;
  onQuickCreate: (id: string, kind: 'text' | 'imageGenerator' | 'videoGenerator' | 'modelGenerator', creationMode?: 'textToImage' | 'imageToImage' | 'imageEdit') => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onBeginRename?: (id: string) => void;
  onCommitRename?: (id: string, title: string) => void;
  onCancelRename?: (id: string) => void;
  onResizeStart?: (id: string) => void;
  onMediaSize?: (id: string, width: number, height: number, duration?: number) => void;
  onTurnaroundSourceSize?: (id: string, width: number, height: number) => void;
  onFitTurnaroundConfirmed?: (id: string) => void;
  onCaptureVideoFrame?: (sourceId: string, file: File, width: number, height: number, label: '首帧' | '尾帧' | '当前帧') => Promise<unknown> | void;
  onContinueVideoFromFrame?: (sourceId: string, file: File, width: number, height: number) => Promise<void> | void;
  onSetCollectionCollapsed?: (id: string, collapsed: boolean) => void;
  onDisconnectCollectionInput?: (id: string, slotId: string) => void;
  onRunCollection?: (id: string, startNodeId?: string) => void;
  unsupportedType?: string;
  diagnostic?: string;
};
export type CanvasNode = Node<CanvasNodeData, CanvasNodeKind>;

export const portDefinitions: Record<CanvasNodeKind, {
  inputs: Array<{ id: string; label: string; accepts: DataType[]; multiple?: boolean }>;
  outputs: Array<{ id: string; label: string; type: DataType }>;
}> = {
  text: { inputs: [], outputs: [{ id: 'output', label: '输出', type: 'text' }] },
  image: { inputs: [], outputs: [{ id: 'output', label: '输出', type: 'image' }] },
  video: { inputs: [], outputs: [{ id: 'output', label: '输出', type: 'video' }] },
  audio: { inputs: [], outputs: [{ id: 'output', label: '输出', type: 'audio' }] },
  imageGenerator: {
    inputs: [{ id: 'input', label: '输入', accepts: ['text', 'image', 'video'], multiple: true }],
    outputs: [{ id: 'output', label: '输出', type: 'image' }],
  },
  comfyUiWorkflow: {
    inputs: [{ id: 'input', label: '参考输入', accepts: ['text', 'image'], multiple: true }],
    outputs: [{ id: 'output', label: '图片输出', type: 'image' }],
  },
  videoGenerator: {
    inputs: [{ id: 'input', label: '输入', accepts: ['text', 'image', 'video', 'audio'], multiple: true }],
    outputs: [{ id: 'output', label: '输出', type: 'video' }],
  },
  audioGenerator: {
    inputs: [{ id: 'input', label: '输入', accepts: ['text', 'audio'], multiple: true }],
    outputs: [{ id: 'output', label: '输出', type: 'audio' }],
  },
  modelGenerator: {
    inputs: [{ id: 'input', label: '输入', accepts: ['text', 'image'], multiple: true }],
    outputs: [{ id: 'output', label: '输出', type: 'model' }],
  },
  characterAnimator: {
    inputs: [{ id: 'input', label: '3D 模型', accepts: ['model'] }],
    outputs: [{ id: 'output', label: '角色模型', type: 'model' }],
  },
  turnaroundSplitter: {
    inputs: [{ id: 'input', label: '三视图图片', accepts: ['image'] }],
    outputs: [{ id: 'output', label: '三视图集', type: 'imageSet' }],
  },
  result: { inputs: [{ id: 'input', label: '输入', accepts: ['image', 'video', 'audio', 'model'], multiple: true }], outputs: [] },
  collection: { inputs: [], outputs: [] },
  unsupported: { inputs: [], outputs: [] },
};

const tripoDirectionalInputs: Array<{ id: string; label: string; accepts: DataType[]; multiple?: boolean }> = [
  { id: 'input', label: '提示词', accepts: ['text'], multiple: true },
  { id: 'multiview', label: '多视图输入', accepts: ['imageSet'] },
  { id: 'front', label: '正面 / 单图', accepts: ['image'] },
  { id: 'left', label: '左侧', accepts: ['image'] },
  { id: 'back', label: '背面', accepts: ['image'] },
  { id: 'right', label: '右侧', accepts: ['image'] },
];

export function comfyUiGenerationWorkflows(model?: Pick<ModelInfo, 'workflow' | 'workflows'>): ComfyUiWorkflowInfo[] {
  const workflows = model?.workflows?.length ? model.workflows : model?.workflow ? [model.workflow] : [];
  return workflows.filter((workflow) => workflow.capability === 'image'
    && !workflow.purposes?.includes('inpaint')
    && !workflow.inputPorts?.some((port) => port.id === 'mask'));
}

export function comfyUiGenerationPortLabel(portId: string, fallback = '') {
  if (portId === 'input') return '文本';
  if (portId === 'identity' || portId === 'reference') return '角色参考';
  if (portId === 'pose') return '动作迁移';
  return fallback;
}

const comfyUiGenerationPortOrder = ['input', 'identity', 'reference', 'pose'] as const;

export function comfyUiGenerationInputPorts(model?: Pick<ModelInfo, 'workflow' | 'workflows'>) {
  const workflows = comfyUiGenerationWorkflows(model);
  const supported = new Set(workflows.flatMap((workflow) => workflow.inputPorts || []).map((port) => port.id));
  const ports: Array<{ id: string; label: string; accepts: DataType[]; multiple?: boolean }> = [];
  if (workflows.some((workflow) => (workflow.inputPorts || []).some((port) => port.id === 'input' && port.accepts.includes('text')))) {
    ports.push({ id: 'input', label: comfyUiGenerationPortLabel('input'), accepts: ['text'], multiple: true });
  }
  if (supported.has('identity')) ports.push({ id: 'identity', label: comfyUiGenerationPortLabel('identity'), accepts: ['image'] });
  else if (supported.has('reference')) ports.push({ id: 'reference', label: comfyUiGenerationPortLabel('reference'), accepts: ['image'] });
  if (supported.has('pose')) ports.push({ id: 'pose', label: comfyUiGenerationPortLabel('pose'), accepts: ['image'] });
  return ports.sort((left, right) => comfyUiGenerationPortOrder.indexOf(left.id as (typeof comfyUiGenerationPortOrder)[number]) - comfyUiGenerationPortOrder.indexOf(right.id as (typeof comfyUiGenerationPortOrder)[number]));
}

export function visibleComfyUiInputPorts<T extends { id: string }>(
  availablePorts: T[],
  connectedPorts: Iterable<string>,
  activeConnectionType?: DataType | null,
) {
  const connected = new Set(Array.from(connectedPorts).filter(Boolean));
  return availablePorts.filter((port) => {
    if (activeConnectionType) return connected.has(port.id)
      || ('accepts' in port && Array.isArray(port.accepts) && port.accepts.includes(activeConnectionType));
    if (connected.size > 0) return connected.has(port.id);
    return port.id === 'input';
  });
}

export function comfyUiWorkflowForConnectedPorts(
  model: Pick<ModelInfo, 'workflow' | 'workflows'> | undefined,
  connectedPorts: Iterable<string>,
  currentWorkflowId = '',
) {
  const connected = new Set<LocalMediaBindingRole>(Array.from(connectedPorts)
    .filter((port) => port !== 'input')
    .map((port) => localMediaBindingRoleForPort(port) as LocalMediaBindingRole));
  const candidates = comfyUiGenerationWorkflows(model).filter((workflow) => {
    if (!comfyUiWorkflowIsSelectable(workflow)) return false;
    const requiredRoles = (workflow.inputPorts || [])
      .filter((port) => port.required && port.accepts.includes('image'))
      .map((port) => port.bindingRole || localMediaBindingRoleForPort(port.id));
    return requiredRoles.every((role) => connected.has(role));
  });
  const score = (workflow: ComfyUiWorkflowInfo) => {
    const imageRoles = (workflow.inputPorts || [])
      .filter((port) => port.accepts.includes('image'))
      .map((port) => port.bindingRole || localMediaBindingRoleForPort(port.id));
    const supported = new Set(imageRoles);
    const matched = Array.from(connected).filter((role) => supported.has(role)).length;
    const unsupported = Array.from(connected).filter((role) => !supported.has(role)).length;
    const extra = imageRoles.filter((role) => !connected.has(role)).length;
    const hasAppearanceReference = connected.has('character');
    const purpose = hasAppearanceReference && connected.has('pose')
      ? Number(workflow.purposePriority?.identity || 0) + Number(workflow.purposePriority?.pose || 0)
      : hasAppearanceReference
        ? Number(workflow.purposePriority?.identity || 0)
        : connected.has('pose')
          ? Number(workflow.purposePriority?.pose || 0)
          : Number(workflow.purposePriority?.draft || workflow.purposePriority?.character || 0);
    return matched * 1000 - unsupported * 500 - extra * 40 + purpose + (workflow.id === currentWorkflowId ? 2 : 0) - (workflow.qualityProfile?.mode === 'high-res-refine' ? 1 : 0);
  };
  return candidates.sort((left, right) => score(right) - score(left))[0] || comfyUiGenerationWorkflows(model).find(comfyUiWorkflowIsSelectable);
}

export function comfyUiWorkflowForGenerationContext(
  model: ModelInfo | undefined,
  connectedPorts: Iterable<string>,
  currentWorkflowId: string,
  resolution: string,
) {
  const connectedWorkflow = comfyUiWorkflowForConnectedPorts(model, connectedPorts, currentWorkflowId);
  return comfyUiWorkflowForResolution(model, connectedWorkflow, resolution);
}

export function runtimeInputPorts(kind: CanvasNodeKind, data?: Pick<CanvasNodeData, 'workflowId' | 'modelId' | 'models'>) {
  if (kind === 'modelGenerator') return tripoDirectionalInputs;
  if (kind === 'comfyUiWorkflow' && data) {
    const model = data.models?.find((item) => item.id === data.modelId) || data.models?.find((item) => item.workflows?.length || item.workflow);
    const ports = comfyUiGenerationInputPorts(model);
    if (model) return ports;
  }
  return portDefinitions[kind].inputs;
}

const labels: Record<CanvasNodeKind, string> = {
  text: '文本', image: '图片', video: '视频', audio: '音频', imageGenerator: '图片生成', videoGenerator: '视频生成', audioGenerator: '音频生成', modelGenerator: '3D 生成', comfyUiWorkflow: 'ComfyUI 工作流', characterAnimator: '角色绑定与动画', turnaroundSplitter: '图片工具', result: '结果', collection: '收纳', unsupported: '不支持的节点',
};
const nodeTypeIcons: Record<CanvasNodeKind, UiIconName> = {
  text: 'text', image: 'image', video: 'video', audio: 'audio', imageGenerator: 'imageGenerate', videoGenerator: 'videoGenerate', audioGenerator: 'audioGenerate', modelGenerator: 'model3d', comfyUiWorkflow: 'comfy', characterAnimator: 'character', turnaroundSplitter: 'split', result: 'result', collection: 'collection', unsupported: 'info',
};

function sanitizeRichHtml(value: string) {
  const template = document.createElement('template');
  template.innerHTML = value;
  template.content.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach((node) => node.remove());
  const foreignPresentationAttributes = new Set(['style', 'class', 'id', 'color', 'bgcolor', 'face', 'size', 'width', 'height']);
  template.content.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (foreignPresentationAttributes.has(attribute.name.toLowerCase())
        || attribute.name.startsWith('on')
        || (['href', 'src'].includes(attribute.name) && /^\s*javascript:/i.test(attribute.value))) element.removeAttribute(attribute.name);
    });
  });
  return template.innerHTML;
}

function PortHandles({ kind, data, side, outputType, connectionType, connected }: { kind: CanvasNodeKind; data?: CanvasNodeData; side: 'input' | 'output'; outputType?: DataType; connectionType?: DataType | null; connected?: boolean }) {
  const availablePorts = side === 'input'
    ? runtimeInputPorts(kind, data)
    : kind === 'result' && outputType ? [{ id: 'output', label: '输出', type: outputType }] : portDefinitions[kind].outputs;
  const connectedPortIds = new Set((data?.inputReferences || []).map((reference) => reference.port).filter(Boolean));
  const smartComfyInput = kind === 'comfyUiWorkflow' && side === 'input';
  const ports = smartComfyInput
    ? visibleComfyUiInputPorts(runtimeInputPorts(kind, data), connectedPortIds, connectionType)
    : availablePorts;
  const fanned = smartComfyInput && Boolean(connectionType) && ports.length > 1;
  const resolved = smartComfyInput && !connectionType && connectedPortIds.size > 0;
  return <div className={`port-stack port-stack-${side}${ports.length > 1 ? ' port-stack-multi' : ''}${smartComfyInput ? ' port-stack-smart' : ''}${connected ? ' is-connected' : ' is-collapsed'}${fanned ? ' is-fanned' : ''}${resolved ? ' is-resolved' : ''}`} data-port-count={ports.length} data-port-mode={fanned ? 'choosing' : resolved ? 'connected' : 'default'}>
    {ports.map((port) => {
      const label = port.label;
      const type = side === 'output'
        ? ('type' in port ? port.type : undefined)
        : ('accepts' in port ? (connectionType && port.accepts.includes(connectionType) ? connectionType : port.accepts[0]) : undefined);
      const compatible = side === 'input' && connectionType ? 'accepts' in port && port.accepts.includes(connectionType) : null;
      const className = ['port-row', `port-${type || 'media'}`, compatible === true ? 'port-compatible' : compatible === false ? 'port-incompatible' : ''].filter(Boolean).join(' ');
      return <div className={className} key={port.id} title={label}>
        {side === 'input' && <Handle id={port.id} type="target" position={Position.Left} data-canvas-input-port={port.id} aria-label={`${label}输入端口`} />}
        <span>{label}</span>
        {side === 'output' && <Handle id={port.id} type="source" position={Position.Right} aria-label={`${label}输出端口`} />}
      </div>;
    })}
  </div>;
}

function acceptsInputType(data: CanvasNodeData, type: DataType) {
  if (data.kind === 'videoGenerator' && ['first', 'first_last'].includes(String(data.videoInputMode)) && (type === 'video' || type === 'audio')) return false;
  if (data.kind === 'videoGenerator' && type === 'audio') {
    return Boolean(data.models?.find((model) => model.id === data.modelId && model.capability === 'video')?.profile?.audioInput);
  }
  return runtimeInputPorts(data.kind, data).some((port) => port.accepts.includes(type));
}

export function normalizedNodeTitle(value: string, fallback: string): string {
  return value.trim().slice(0, 120) || fallback.trim().slice(0, 120);
}

function InlineNodeTitle({ id, data, fallback, dragEnabled = false }: { id: string; data: CanvasNodeData; fallback: string; dragEnabled?: boolean }) {
  const title = data.title || fallback;
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!data.inlineRenaming) {
      setDraft(title);
      return;
    }
    finishedRef.current = false;
    setDraft(title);
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data.inlineRenaming, title]);

  const commit = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    data.onCommitRename?.(id, normalizedNodeTitle(draft, title));
  };
  const cancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setDraft(title);
    data.onCancelRename?.(id);
  };

  if (data.inlineRenaming) return <input
    ref={inputRef}
    className="node-inline-title-input nodrag nowheel"
    aria-label="重命名节点"
    value={draft}
    maxLength={120}
    onChange={(event) => setDraft(event.currentTarget.value)}
    onPointerDown={(event) => event.stopPropagation()}
    onDoubleClick={(event) => event.stopPropagation()}
    onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    }}
  />;

  return <strong
    className={`node-inline-title-display${dragEnabled ? '' : ' nodrag'}`}
    title={`${title} · 双击重命名`}
    onDoubleClick={(event) => {
      event.preventDefault();
      event.stopPropagation();
      data.onBeginRename?.(id);
    }}
  >{title}</strong>;
}

export function canvasNodeVisualRadius(width?: number, height?: number) {
  const shortestEdge = Math.min(Number(width) || 300, Number(height) || 180);
  return Math.round(Math.max(8, Math.min(16, shortestEdge / 24)));
}

function canvasNodeRadiusStyle(width?: number, height?: number) {
  return { '--canvas-node-radius': `${canvasNodeVisualRadius(width, height)}px` } as CSSProperties;
}

function NodeShell({ id, data, children, selected, width, height, titleFallback, titleMeta, titleMetaClassName }: NodeProps<CanvasNode> & { children: ReactNode; titleFallback?: string; titleMeta?: ReactNode; titleMetaClassName?: string }) {
  const updateNodeInternals = useUpdateNodeInternals();
  const connectionSource = useConnection<CanvasNode, { sourceId: string; connectionType: DataType } | null>((state) => {
    if (!state.inProgress || state.fromHandle.type !== 'source') return null;
    const sourceType = state.fromNode.data.kind === 'result'
      ? state.fromNode.data.outputType
      : state.fromNode.data.kind === 'turnaroundSplitter' && !state.fromNode.data.turnaroundConfirmed
        ? undefined
      : portDefinitions[state.fromNode.data.kind].outputs.find((port) => port.id === state.fromHandle.id)?.type;
    return sourceType ? { sourceId: state.fromNode.id, connectionType: sourceType } : null;
  });
  const sourceId = connectionSource?.sourceId;
  const connectionType = connectionSource?.connectionType;
  const comfyUiConnectedPortSignature = data.kind === 'comfyUiWorkflow'
    ? (data.inputReferences || []).map((reference) => reference.port).filter(Boolean).sort().join('|')
    : '';
  // ComfyUI swaps one resting handle for its compatible semantic handles while
  // a wire is moving. Re-measure in the same commit so the visible targets and
  // React Flow's magnetic hit areas never drift apart.
  useLayoutEffect(() => {
    if (data.kind === 'comfyUiWorkflow') updateNodeInternals(id);
  }, [comfyUiConnectedPortSignature, connectionType, data.kind, id, updateNodeInternals]);
  const guideType = connectionType ? undefined : data.connectionGuideType;
  const effectiveConnectionType = connectionType || guideType;
  const acceptsConnection = effectiveConnectionType ? acceptsInputType(data, effectiveConnectionType) : false;
  const connectionClass = !connectionType ? '' : sourceId === id ? 'connection-source connection-active' : acceptsConnection ? 'connection-compatible connection-active' : 'connection-incompatible connection-active';
  const guideClass = !guideType ? '' : selected ? 'connection-guide-source' : acceptsConnection ? 'connection-guide-compatible' : 'connection-guide-incompatible';
  const accent = data.outputType || data.mediaType || (['text', 'image', 'video', 'audio'].includes(data.kind) ? data.kind : data.kind === 'videoGenerator' ? 'video' : data.kind === 'audioGenerator' ? 'audio' : data.kind === 'modelGenerator' || data.kind === 'characterAnimator' ? 'model' : data.kind === 'turnaroundSplitter' ? 'imageSet' : 'image');
  const textCount = data.kind === 'text' ? (data.text || '').length : 0;
  const mediaSize = ['image', 'video'].includes(data.kind) && data.mediaWidth && data.mediaHeight ? `${data.mediaWidth}×${data.mediaHeight}` : '';
  const resizeLimits = data.kind === 'image' || data.kind === 'video'
    ? { minWidth: 240, minHeight: 170, maxWidth: 960, maxHeight: 720 }
    : data.kind === 'audio'
      ? { minWidth: 300, minHeight: 120, maxWidth: 720, maxHeight: 260 }
      : data.kind === 'text'
      ? { minWidth: 260, minHeight: 160, maxWidth: 760, maxHeight: 900 }
      : data.kind === 'result'
        ? { minWidth: 300, minHeight: 220, maxWidth: 960, maxHeight: 760 }
        : data.kind === 'turnaroundSplitter'
          ? { minWidth: 410, minHeight: 360, maxWidth: 920, maxHeight: 820 }
        : data.kind === 'comfyUiWorkflow'
          ? { minWidth: 320, minHeight: 220, maxWidth: 920, maxHeight: 760 }
        : { minWidth: 320, minHeight: 220, maxWidth: 920, maxHeight: 760 };
  const keepsMediaRatio = data.kind === 'image'
    || data.kind === 'video'
    || (data.kind === 'result' && Boolean(data.mediaUrl));
  return <div className={`canvas-node node-${data.kind} type-${accent} ${data.stale ? 'node-stale' : ''} ${selected ? 'node-expanded' : 'node-compact'} ${connectionClass} ${guideClass}`} style={canvasNodeRadiusStyle(width, height)}>
    <div className="node-external-label node-shell-external-label">
      <UiIcon name={nodeTypeIcons[data.kind]} className="node-title-type-icon" />
      <InlineNodeTitle id={id} data={data} fallback={titleFallback || labels[data.kind]} />
      {(titleMeta || data.kind === 'text' || mediaSize) && <span className={titleMetaClassName}>{titleMeta || (data.kind === 'text' ? `${textCount} 字` : mediaSize)}</span>}
    </div>
    <NodeResizer {...resizeLimits} keepAspectRatio={keepsMediaRatio} isVisible={selected} onResizeStart={() => data.onResizeStart?.(id)} handleClassName="canvas-node-resize-handle" lineClassName="canvas-node-resize-line" />
    <div className={`node-heading ${data.kind === 'modelGenerator' || data.kind === 'characterAnimator' ? 'model-node-drag-shell' : ''}`}>
      {(data.kind === 'modelGenerator' || data.kind === 'characterAnimator') && <i className="model-node-drag-grip" aria-hidden="true"><b /><b /><b /></i>}
      <span>{labels[data.kind]}</span>
      {(data.kind === 'modelGenerator' || data.kind === 'characterAnimator') && <small className="model-node-drag-hint">拖动外壳移动</small>}
      {mediaSize && <small>{mediaSize}</small>}
      {data.stale && <em>已过期</em>}
    </div>
    {runtimeInputPorts(data.kind, data).length > 0 && <PortHandles kind={data.kind} data={data} side="input" connectionType={connectionType} connected={data.hasIncomingConnection} />}
    <div className="node-content">
      <div className="node-body">{children}</div>
    </div>
    {(data.kind !== 'turnaroundSplitter' || (data.turnaroundConfirmed && data.turnaroundViews?.length === 3)) && <PortHandles kind={data.kind} data={data} side="output" outputType={data.outputType} connectionType={connectionType} connected={data.hasOutgoingConnection} />}
  </div>;
}

const promptPresetRecentStorageKey = 'ai-canvas:text-prompt-presets:recent:v1';

function readRecentPromptPresetIds() {
  if (typeof window === 'undefined') return [] as string[];
  try {
    const stored = JSON.parse(window.localStorage.getItem(promptPresetRecentStorageKey) || '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string').slice(0, 4) : [];
  } catch {
    return [];
  }
}

function rememberPromptPreset(id: string, previous: string[]) {
  const next = [id, ...previous.filter((value) => value !== id)].slice(0, 4);
  try { window.localStorage.setItem(promptPresetRecentStorageKey, JSON.stringify(next)); } catch { /* storage is optional */ }
  return next;
}

function TextPromptPresetPopover({ anchorRef, hasText, onApply, onDismiss }: {
  anchorRef: { current: HTMLButtonElement | null };
  hasText: boolean;
  onApply: (preset: PromptPreset) => void;
  onDismiss: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [recentIds, setRecentIds] = useState(readRecentPromptPresetIds);
  const [position, setPosition] = useState({ left: 12, top: 12, placement: 'right' as 'right' | 'left', visible: false });
  const recentPresets = recentIds.map((id) => promptPresets.find((preset) => preset.id === id)).filter((preset): preset is PromptPreset => Boolean(preset));
  const results = filterPromptPresets(query);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  useEffect(() => {
    let frame = 0;
    const followAnchor = () => {
      const anchor = anchorRef.current;
      const card = cardRef.current;
      if (anchor && card) {
        const anchorBounds = anchor.getBoundingClientRect();
        const padding = 12;
        const gap = 12;
        const width = Math.min(408, window.innerWidth - padding * 2);
        const height = Math.min(card.offsetHeight || 500, window.innerHeight - padding * 2);
        const hasRoomOnRight = window.innerWidth - anchorBounds.right >= width + gap + padding;
        const placement = hasRoomOnRight ? 'right' : 'left';
        const left = placement === 'right'
          ? Math.min(anchorBounds.right + gap, window.innerWidth - width - padding)
          : Math.max(padding, anchorBounds.left - width - gap);
        const top = Math.max(padding, Math.min(anchorBounds.top - 10, window.innerHeight - height - padding));
        setPosition((current) => current.visible && current.placement === placement && Math.abs(current.left - left) < .5 && Math.abs(current.top - top) < .5
          ? current
          : { left, top, placement, visible: true });
      }
      frame = window.requestAnimationFrame(followAnchor);
    };
    followAnchor();
    return () => window.cancelAnimationFrame(frame);
  }, [anchorRef]);

  const apply = (preset: PromptPreset) => {
    setRecentIds((current) => rememberPromptPreset(preset.id, current));
    onApply(preset);
  };
  const theme = typeof document === 'undefined' ? 'night' : document.querySelector('.app-shell')?.getAttribute('data-theme') || 'night';
  const card = <div
    className="text-prompt-preset-backdrop nodrag nowheel"
    data-theme={theme}
    onPointerDown={(event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    }}
    onWheel={(event) => event.stopPropagation()}
  >
    <section
      ref={cardRef}
      className={`text-prompt-preset-card opens-${position.placement}`}
      style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden' }}
      role="dialog"
      aria-modal="true"
      aria-label="提示词助手"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <header><div><strong>提示词助手</strong><small>点一下就{hasText ? '追加' : '写入'}，不会调用模型</small></div><button type="button" className="ui-icon-button" aria-label="关闭提示词助手" onClick={onDismiss}><UiIcon name="close" /></button></header>
      <label className="text-prompt-preset-search"><UiIcon name="search" /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索功能，例如：反推构图" /></label>
      {!query && recentPresets.length > 0 && <div className="text-prompt-preset-recent"><small>最近使用</small><div>{recentPresets.map((preset) => <button key={preset.id} type="button" onClick={() => apply(preset)}>{preset.label}</button>)}</div></div>}
      <div className="text-prompt-preset-section-label"><small>{query ? `搜索结果 ${results.length}` : '功能预设'}</small><span>{hasText ? '追加到当前文本' : '写入当前节点'}</span></div>
      <div className="text-prompt-preset-grid">
        {results.map((preset) => <button key={preset.id} type="button" onClick={() => apply(preset)}><UiIcon name="spark" /><span><strong>{preset.label}</strong><small>{preset.description}</small></span></button>)}
        {!results.length && <p>没有找到相关功能</p>}
      </div>
    </section>
  </div>;
  return typeof document === 'undefined' ? card : createPortal(card, document.body);
}

const TextNode = memo((props: NodeProps<CanvasNode>) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const presetAnchorRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [showPromptPresets, setShowPromptPresets] = useState(false);
  const hasTextContent = Boolean((props.data.text || '').trim());
  useEffect(() => {
    const html = sanitizeRichHtml(props.data.html || props.data.text || '');
    if (!editing && editorRef.current && editorRef.current.innerHTML !== html) editorRef.current.innerHTML = html;
  }, [editing, props.data.html, props.data.text, props.selected]);
  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (!props.selected) setShowPromptPresets(false);
  }, [props.selected]);
  const format = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    const editor = editorRef.current;
    if (editor) props.data.onChange(props.id, { html: editor.innerHTML, text: editor.innerText }, 'text');
  };
  const block = (value: string) => format('formatBlock', value);
  const applyPreset = (preset: PromptPreset) => {
    const currentText = editorRef.current?.innerText || props.data.text || '';
    const text = appendPromptPreset(currentText, preset.prompt);
    const html = escapePromptHtml(text).replace(/\n/g, '<br>');
    if (editorRef.current) editorRef.current.innerHTML = html;
    props.data.onChange(props.id, { text, html }, 'text');
    setShowPromptPresets(false);
  };
  return <NodeShell {...props}>
    {!props.selected && (hasTextContent
      ? <div className="node-summary text-summary" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(props.data.html || props.data.text || '') }} />
      : <EmptyNodeState icon="text" label="等待输入文本" className="text-empty-state" />)}
    {!props.selected && <div className="node-hover-actions nodrag"><button onClick={(event) => { event.stopPropagation(); props.data.onEditStart(props.id); setEditing(true); }}><UiActionContent icon="edit">编辑</UiActionContent></button></div>}
    {props.selected && <>
      <button ref={presetAnchorRef} type="button" className={`text-prompt-preset-trigger nodrag${showPromptPresets ? ' active' : ''}`} aria-expanded={showPromptPresets} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setShowPromptPresets((value) => !value); }}><UiActionContent icon="spark">预设</UiActionContent></button>
      {editing && <div className="rich-toolbar nodrag">
        <button onMouseDown={(event) => { event.preventDefault(); block('h1'); }}>H1</button><button onMouseDown={(event) => { event.preventDefault(); block('h2'); }}>H2</button><button onMouseDown={(event) => { event.preventDefault(); block('h3'); }}>H3</button><button onMouseDown={(event) => { event.preventDefault(); block('p'); }}>正文</button>
        <button onMouseDown={(event) => { event.preventDefault(); format('bold'); }}><b>粗</b></button><button onMouseDown={(event) => { event.preventDefault(); format('italic'); }}><i>斜</i></button><button onMouseDown={(event) => { event.preventDefault(); format('insertUnorderedList'); }}>无序</button><button onMouseDown={(event) => { event.preventDefault(); format('insertOrderedList'); }}>有序</button><button onMouseDown={(event) => { event.preventDefault(); format('insertHorizontalRule'); }}>分隔线</button>
      </div>}
      <div ref={editorRef} className={`rich-editor nowheel nodrag ${editing ? 'editing' : ''}`} contentEditable={editing} suppressContentEditableWarning data-placeholder="双击输入文本…" onDoubleClick={(event) => { event.stopPropagation(); setEditing(true); props.data.onEditStart(props.id); }} onInput={(event) => props.data.onChange(props.id, { html: event.currentTarget.innerHTML, text: event.currentTarget.innerText }, 'text')} onKeyDown={(event) => { if (event.key === '/' && !event.currentTarget.innerText.trim()) { event.preventDefault(); setShowPromptPresets(true); } }} onBlur={() => { setEditing(false); props.data.onEditEnd(props.id); }} />
      {showPromptPresets && <TextPromptPresetPopover anchorRef={presetAnchorRef} hasText={Boolean((props.data.text || '').trim())} onApply={applyPreset} onDismiss={() => setShowPromptPresets(false)} />}
    </>}
  </NodeShell>;
});

export function activateVideoStage(moved: boolean | undefined, onSelect: (() => void) | undefined, onTogglePlayback: () => void) {
  if (moved) return false;
  onSelect?.();
  onTogglePlayback();
  return true;
}

export function reloadCanvasVideoElement(video: Pick<HTMLVideoElement, 'pause' | 'load'>) {
  video.pause();
  video.load();
}

function EmptyNodeState({ icon, label, className = '' }: { icon: UiIconName; label: string; className?: string }) {
  return <div className={`node-empty-state${className ? ` ${className}` : ''}`}><UiIcon name={icon} /><span>{label}</span></div>;
}

function usePersistentMediaLod(sourceUrl: string, mediaType: 'image' | 'video', previewUrl?: string) {
  const [lodUrl, setLodUrl] = useState(previewUrl || '');
  useEffect(() => {
    let active = true;
    setLodUrl(previewUrl || '');
    void persistentMediaLodUrl({ sourceUrl, mediaType, previewUrl }).then((url) => {
      if (active && url) setLodUrl(url);
    });
    return () => { active = false; };
  }, [mediaType, previewUrl, sourceUrl]);
  return lodUrl;
}

function CanvasLodImage({ src, previewUrl, lodLevel, className = '', alt, style, onLoad }: {
  src: string;
  previewUrl?: string;
  lodLevel: CanvasMediaLodLevel;
  className?: string;
  alt: string;
  style?: CSSProperties;
  onLoad?: (image: HTMLImageElement) => void;
}) {
  const lodUrl = usePersistentMediaLod(src, 'image', previewUrl);
  const [highActivated, setHighActivated] = useState(lodLevel === 'high' || !previewUrl);
  const [highReady, setHighReady] = useState(false);
  const [lodFailed, setLodFailed] = useState(false);
  useEffect(() => {
    setHighActivated(lodLevel === 'high' || !previewUrl);
    setHighReady(false);
    setLodFailed(false);
  }, [src]);
  useEffect(() => {
    if (lodLevel === 'high') setHighActivated(true);
  }, [lodLevel]);
  const usableLod = Boolean(lodUrl && !lodFailed);
  return <span className={`media-lod-stack ${className} is-${lodLevel}${usableLod ? ' has-lod' : ''}${highReady ? ' is-high-ready' : ''}`} style={style}>
    {lodUrl && <img className="media-lod-layer media-lod-preview" draggable={false} decoding="async" src={lodUrl} alt="" aria-hidden="true" data-media-source={src} data-media-kind="image" onLoad={() => setLodFailed(false)} onError={() => { setLodFailed(true); setHighActivated(true); }} />}
    {highActivated && <img className={`media-lod-layer media-lod-full${highReady ? ' is-ready' : ''}`} draggable={false} decoding="async" src={src} alt={alt} data-media-source={src} data-media-kind="image" onDragStart={(event) => event.preventDefault()} onLoad={(event) => { setHighReady(true); onLoad?.(event.currentTarget); }} />}
    {!lodUrl && !highActivated && <EmptyNodeState icon="image" label="正在准备预览" />}
  </span>;
}

function CanvasImageResultHand({ outputs, selected, lodLevel, onSelect, onMediaSize }: {
  outputs: ResultOutput[]; selected: number; lodLevel: CanvasMediaLodLevel;
  onSelect: (index: number) => void;
  onMediaSize?: (width: number, height: number) => void;
}) {
  const en = storedCanvasInterfaceLanguage() === 'en';
  return <GeneratedImageHand outputs={outputs} selected={selected} en={en} onSelect={onSelect}
    renderImage={(output, index, emphasized) => <CanvasLodImage src={output.mediaUrl!} previewUrl={output.previewUrl}
      className="node-media-surface" lodLevel={emphasized ? lodLevel : 'low'} alt={output.fileName || (en ? `Generated image ${index + 1}` : `生成结果 ${index + 1}`)}
      onLoad={image => { if (index === selected && (!output.width || !output.height)) onMediaSize?.(image.naturalWidth, image.naturalHeight); }} />} />;
}

function CanvasVideoPlayer({ src, poster, lodLevel = 'high', className = '', onSelect, onLoadedMetadata, onCaptureFrame, onContinueFromTail }: { src: string; poster?: string; lodLevel?: CanvasMediaLodLevel; className?: string; onSelect?: () => void; onLoadedMetadata?: (video: HTMLVideoElement) => void; onCaptureFrame?: (file: File, width: number, height: number, label: '首帧' | '尾帧' | '当前帧') => Promise<unknown> | void; onContinueFromTail?: (file: File, width: number, height: number) => Promise<void> | void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const lodUrl = usePersistentMediaLod(src, 'video', poster);
  const [highActivated, setHighActivated] = useState(lodLevel === 'high' || !poster);
  const [lodFailed, setLodFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [capturing, setCapturing] = useState<'首帧' | '尾帧' | '当前帧' | '尾帧续接' | null>(null);
  const [captureError, setCaptureError] = useState('');
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false);
  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };
  const stopCanvasGesture = (event: SyntheticEvent) => event.stopPropagation();
  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try { await video.play(); }
      catch { setPlaying(false); }
    } else video.pause();
  };
  const waitForDecodedFrame = (video: HTMLVideoElement, targetTime: number) => new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      window.clearTimeout(timeout);
      resolve();
    };
    const onSeeked = () => {
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(() => finish());
      } else {
        requestAnimationFrame(finish);
      }
    };
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      reject(new Error('视频帧解码超时'));
    }, 10000);
    video.addEventListener('seeked', onSeeked, { once: true });
    const boundedTarget = Math.max(0, Math.min(targetTime, Number.isFinite(video.duration) ? video.duration : targetTime));
    if (Math.abs(video.currentTime - boundedTarget) < 0.001 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) onSeeked();
    else video.currentTime = boundedTarget;
  });
  const capture = async (action: '首帧' | '尾帧' | '当前帧' | '尾帧续接') => {
    const video = videoRef.current;
    if (!video || !onCaptureFrame || capturing || !video.videoWidth || !video.videoHeight) return;
    const label = action === '尾帧续接' ? '尾帧' : action;
    const wasPlaying = !video.paused;
    video.pause();
    setCapturing(action);
    setCaptureError('');
    try {
      if (label === '首帧') {
        await waitForDecodedFrame(video, 0);
      } else if (label === '尾帧') {
        if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('视频时长不可用，暂无法定位最后一帧');
        await waitForDecodedFrame(video, Math.max(0, video.duration - 0.001));
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建帧图画布');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG 导出失败')), 'image/png'));
      const name = `video-${label}-${Date.now()}.png`;
      const file = new File([blob], name, { type: 'image/png' });
      if (action === '尾帧续接' && onContinueFromTail) await onContinueFromTail(file, canvas.width, canvas.height);
      else await onCaptureFrame(file, canvas.width, canvas.height, label);
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : '帧图截取失败');
    } finally {
      setCapturing(null);
      if (wasPlaying && label !== '尾帧') void video.play().catch(() => undefined);
    }
  };
  useEffect(() => {
    const pause = () => videoRef.current?.pause();
    window.addEventListener('ai-canvas:pause-videos', pause);
    return () => window.removeEventListener('ai-canvas:pause-videos', pause);
  }, []);
  useEffect(() => {
    setHighActivated(lodLevel === 'high' || !poster);
    setLodFailed(false);
  }, [src]);
  useEffect(() => {
    if (lodLevel === 'high') setHighActivated(true);
    else videoRef.current?.pause();
  }, [lodLevel]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    reloadCanvasVideoElement(video);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setCaptureError('');
    setCaptureMenuOpen(false);
  }, [src]);
  const seek = (event: ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(event.currentTarget.value);
    const video = videoRef.current;
    if (video && Number.isFinite(nextTime)) video.currentTime = nextTime;
    setCurrentTime(nextTime);
  };
  const markPointerStart = (event: React.PointerEvent<HTMLDivElement>) => { pointerStartRef.current = { x: event.clientX, y: event.clientY, moved: false }; };
  const markPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) start.moved = true;
  };
  const toggleFromStage = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    activateVideoStage(pointerStartRef.current?.moved, onSelect, () => void togglePlayback());
    pointerStartRef.current = null;
  };
  const usableLod = Boolean(lodUrl && !lodFailed);
  return <div className={`canvas-video-player is-lod-${lodLevel}${usableLod ? ' has-lod' : ''}`}>
    <div className="canvas-video-stage" onPointerDown={markPointerStart} onPointerMove={markPointerMove} onClick={toggleFromStage}>
      {lodUrl && <img className="canvas-video-lod-poster" draggable={false} decoding="async" src={lodUrl} alt="" aria-hidden="true" data-media-source={src} data-media-kind="video" onLoad={() => setLodFailed(false)} onError={() => { setLodFailed(true); setHighActivated(true); }} />}
      {highActivated && <video key={src} ref={videoRef} className={className} src={src} data-media-source={src} data-media-kind="video" playsInline preload="metadata" onLoadedMetadata={(event) => { const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0; setDuration(nextDuration); onLoadedMetadata?.(event.currentTarget); }} onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setCurrentTime(videoRef.current?.currentTime || duration); }} />}
      {!lodUrl && !highActivated && <EmptyNodeState icon="video" label="正在准备预览" />}
    </div>
    <div className="canvas-video-controls nodrag nowheel" aria-label="视频播放控制" onPointerDown={stopCanvasGesture} onMouseDown={stopCanvasGesture} onClick={(event) => { stopCanvasGesture(event); onSelect?.(); }} onKeyDown={stopCanvasGesture}>
      <button type="button" className="canvas-video-play-toggle nodrag nowheel" aria-label={playing ? '暂停视频' : '播放视频'} title={playing ? '暂停' : '播放'} onClick={() => void togglePlayback()}>
        {playing ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3.5v9m7-9v9" /></svg> : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3.5 7 4.5-7 4.5z" /></svg>}
      </button>
      <input className="canvas-video-progress nodrag nowheel" type="range" min="0" max={duration || 0} step="0.01" value={Math.min(currentTime, duration || 0)} aria-label="播放进度" onChange={seek} />
      <span className="canvas-video-time">{captureError || `${formatTime(currentTime)} / ${formatTime(duration)}`}</span>
      {onCaptureFrame && <div className={`canvas-video-capture-menu ${captureMenuOpen ? 'is-open' : ''}`}>
        <button type="button" className="canvas-video-capture-trigger" aria-label="截取视频帧" aria-expanded={captureMenuOpen} title="截帧" onClick={() => setCaptureMenuOpen((open) => !open)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="4" width="10" height="8" rx="1.5" /><path d="M6 4V2.75h4V4m-2 2.25v3.5m-1.75-1.75h3.5" /></svg>
        </button>
        <div className="canvas-video-capture-options" role="menu" aria-label="截帧方式">
          {(['首帧', '尾帧', '当前帧'] as const).map((label) => <button key={label} type="button" role="menuitem" disabled={Boolean(capturing)} title={label === '首帧' ? '截取时间轴 0 秒的第一帧' : label === '尾帧' ? '直接定位并截取视频最后一帧' : '截取当前已播放画面'} onClick={() => { setCaptureMenuOpen(false); void capture(label); }}>{capturing === label ? '处理中…' : label}</button>)}
          {onContinueFromTail && <button type="button" role="menuitem" disabled={Boolean(capturing)} title="截取真实尾帧，并创建一个已连接的下一段视频生成节点" onClick={() => { setCaptureMenuOpen(false); void capture('尾帧续接'); }}>{capturing === '尾帧续接' ? '处理中…' : '尾帧续接'}</button>}
        </div>
      </div>}
    </div>
  </div>;
}

function MediaDeliveryActions({ mediaUrl, fileName, nodeTitle, mediaType, previewUrl }: { mediaUrl: string; fileName?: string; nodeTitle?: string; mediaType: 'image' | 'video' | 'audio' | 'model'; previewUrl?: string }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const downloadName = nodeResourceDownloadFileName(nodeTitle, fileName, mediaUrl, mediaType);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(mediaUrl, window.location.origin).href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  return <>
    <div className="media-delivery-actions nodrag" onPointerDown={stop}>
      {(mediaType !== 'model' || previewUrl) && <button className="ui-icon-button" type="button" aria-label="全屏预览" title="预览" onClick={() => setPreviewOpen(true)}><UiIcon name="preview" /></button>}
      <a className="ui-icon-button" href={canvasAssetDownloadUrl(mediaUrl, downloadName)} download={downloadName} title={`下载 ${downloadName}`} aria-label="下载" onClick={stop}><UiIcon name="download" /></a>
      <button className={`ui-icon-button${copied ? ' is-success' : ''}`} type="button" aria-label={copied ? '链接已复制' : '复制媒体链接'} title={copied ? '已复制' : '复制链接'} onClick={() => void copyLink()}><UiIcon name={copied ? 'check' : 'link'} /></button>
    </div>
    {previewOpen && createPortal(<div className="media-preview-dialog" role="dialog" aria-modal="true" aria-label="媒体预览" onMouseDown={() => setPreviewOpen(false)}>
      <div className="media-preview-dialog-content" onMouseDown={(event) => event.stopPropagation()}>
        <button className="media-preview-dialog-close ui-icon-button" type="button" aria-label="关闭预览" onClick={() => setPreviewOpen(false)} title="关闭"><UiIcon name="close" /></button>
        {mediaType === 'video' ? <video controls autoPlay src={mediaUrl} /> : mediaType === 'audio' ? <AudioWaveformPlayer className="media-preview-audio" src={mediaUrl} /> : <img src={mediaType === 'model' ? previewUrl : mediaUrl} alt={downloadName} />}
      </div>
    </div>, document.body)}
  </>;
}

function ImageToolToolbar({ onInpaint, onRestore, onCrop, onSplit }: { onInpaint?: () => void; onRestore?: () => void; onCrop?: () => void; onSplit?: () => void }) {
  return <div className="image-tool-toolbar nodrag nowheel" role="toolbar" aria-label="图片工具" onPointerDown={(event) => event.stopPropagation()}>
    {onInpaint && <button type="button" title="涂出需要修改的区域" onClick={(event) => { event.stopPropagation(); onInpaint(); }}><UiActionContent icon="edit">局部重绘</UiActionContent></button>}
    {onRestore && <button type="button" title="恢复到重绘前的图片" onClick={(event) => { event.stopPropagation(); onRestore(); }}><UiActionContent icon="retry">恢复上张</UiActionContent></button>}
    {onCrop && <button type="button" title="快速裁切" onClick={(event) => { event.stopPropagation(); onCrop(); }}><UiActionContent icon="crop">裁切</UiActionContent></button>}
    {onSplit && <button type="button" title="多视图切分" onClick={(event) => { event.stopPropagation(); onSplit(); }}><UiActionContent icon="split">切分</UiActionContent></button>}
  </div>;
}

function VideoToolToolbar({ onUpscale }: { onUpscale: () => void }) {
  return <div className="image-tool-toolbar nodrag nowheel" role="toolbar" aria-label="视频工具" onPointerDown={(event) => event.stopPropagation()}>
    <button type="button" title="创建本地 Topaz 高清放大设置节点" onClick={(event) => { event.stopPropagation(); onUpscale(); }}><UiActionContent icon="spark">高清放大</UiActionContent></button>
  </div>;
}

const topazModelChoices = ['星光 2.6', 'Astra', 'Astra HQ', 'Astra Fast', 'Astra Sharp'] as const;
const topazSharpnessChoices = ['自然', '平衡', '锐利（默认）'] as const;
const topazScaleChoices = [1, 2, 3, 4] as const;
const topazLookChoices = [
  { value: 0.7, label: '柔和', level: 'soft' },
  { value: 1, label: '自然', level: 'natural' },
  { value: 1.3, label: '清晰', level: 'clear' },
] as const;

export function topazUpscalePreviewLabel(width?: number, height?: number, scale: 1 | 2 | 3 | 4 = 2) {
  if (!width || !height) return `${scale}× · 最高 4K`;
  const outputWidth = Math.round(width * scale);
  const outputHeight = Math.round(height * scale);
  const within4k = Math.max(outputWidth, outputHeight) <= 3840 && Math.min(outputWidth, outputHeight) <= 2160;
  return within4k ? `${outputWidth} × ${outputHeight}` : '最高 4K';
}

export function topazUpscaleActionLabel(state: JobState | undefined, progress = 0, pollLost = false) {
  if (pollLost) return '重新查询';
  if (state === 'queued') return '排队中';
  if (state === 'running') return `正在放大 ${Math.round(progress)}%`;
  if (state === 'cancelling') return '正在停止';
  if (state === 'succeeded') return '已完成';
  if (state === 'failed') return '再试一次';
  if (state === 'cancelled') return '重新开始';
  return '开始放大';
}

export function TopazUpscaleControls({ id, data }: { id: string; data: CanvasNodeData }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const model = data.topazModel || '星光 2.6';
  const scale = data.topazScale || 2;
  const strength = data.topazStrength ?? 1;
  const busy = ['queued', 'running', 'cancelling'].includes(String(data.jobState || ''));
  const failed = data.jobState === 'failed';
  const succeeded = data.jobState === 'succeeded';
  const sourceSize = data.videoUpscaleSourceWidth && data.videoUpscaleSourceHeight
    ? `${data.videoUpscaleSourceWidth} × ${data.videoUpscaleSourceHeight}`
    : '原视频';
  const outputSize = topazUpscalePreviewLabel(data.videoUpscaleSourceWidth, data.videoUpscaleSourceHeight, scale);
  const sourceMeta = [
    data.videoUpscaleSourceDuration ? `${Math.round(data.videoUpscaleSourceDuration)} 秒` : '',
    '保留声音',
  ].filter(Boolean).join(' · ');
  const change = (patch: Partial<CanvasNodeData>) => data.onChange(id, patch, 'text');
  return <div className={`topaz-upscale-config nowheel${failed ? ' is-error' : ''}${busy ? ' is-loading' : ''}${succeeded ? ' is-success' : ''}`} aria-busy={busy}>
    <header title="按住这里拖动节点">
      <span className="topaz-upscale-mark"><UiIcon name="spark" /></span>
      <div><strong>高清放大</strong><small>本地处理 · 拖动这里移动</small></div>
      <button type="button" className="topaz-upscale-close nodrag" disabled={busy} aria-label="关闭高清放大设置" title="关闭" onClick={() => data.onDelete(id)}><UiIcon name="close" /></button>
    </header>
    <div className="topaz-upscale-body">
      {failed && <div className="topaz-upscale-error" role="alert"><UiIcon name="retry" /><div><strong>没有完成</strong><span>{data.status || '检查设置后再试一次'}</span></div></div>}
      <section className="topaz-upscale-choice" aria-labelledby={`${id}-scale-label`}>
        <div className="topaz-upscale-section-title"><span id={`${id}-scale-label`}>放大</span><strong>{scale}×</strong></div>
        <div className="topaz-scale-picker nodrag" role="group" aria-label="放大倍数">
          {topazScaleChoices.map((value) => <button key={value} type="button" className={scale === value ? 'active' : ''} aria-pressed={scale === value} disabled={busy} onClick={() => change({ topazScale: value })}>{value}×</button>)}
        </div>
      </section>
      <section className="topaz-upscale-choice" aria-labelledby={`${id}-look-label`}>
        <div className="topaz-upscale-section-title"><span id={`${id}-look-label`}>画面</span></div>
        <div className="topaz-look-picker nodrag" role="group" aria-label="画面效果">
          {topazLookChoices.map((choice) => <button key={choice.value} type="button" className={strength === choice.value ? 'active' : ''} aria-pressed={strength === choice.value} disabled={busy} onClick={() => change({ topazStrength: choice.value })}><span className="topaz-look-sample" data-level={choice.level} aria-hidden="true"><i /><i /><i /></span><b>{choice.label}</b></button>)}
        </div>
      </section>
      <div className="topaz-upscale-source" aria-label={`输出预览：${sourceSize} 到 ${outputSize}`}>
        <span>{sourceSize}</span><i aria-hidden="true">→</i><strong>{outputSize}</strong><em><UiIcon name="audio" />{sourceMeta}</em>
      </div>
      <button type="button" className="topaz-upscale-more nodrag" aria-expanded={showAdvanced} disabled={busy} onClick={() => setShowAdvanced((current) => !current)}><span><UiIcon name="more" />更多设置</span><UiIcon name="chevronDown" className={showAdvanced ? 'is-open' : ''} /></button>
      {showAdvanced && <div className="topaz-upscale-fields nodrag">
        <label><span>模型</span><select value={model} disabled={busy} onChange={(event) => change({ topazModel: event.currentTarget.value as CanvasNodeData['topazModel'] })}>{topazModelChoices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select></label>
        <label><span>显存 <output>{Number(data.topazVram ?? 22).toFixed(Number(data.topazVram ?? 22) % 1 ? 1 : 0)} GB</output></span><input type="range" min="8" max="24" step="0.1" disabled={busy} value={data.topazVram ?? 22} onChange={(event) => change({ topazVram: Math.min(24, Math.max(8, Number(event.currentTarget.value) || 8)) })} /></label>
        <label><span>压缩 <output>QP {data.topazInputQuality ?? 14}</output></span><input type="range" min="0" max="40" step="1" disabled={busy} value={data.topazInputQuality ?? 14} onChange={(event) => change({ topazInputQuality: Math.min(40, Math.max(0, Math.round(Number(event.currentTarget.value) || 0))) })} /></label>
        <label><span>锐度</span><select disabled={busy || model !== '星光 2.6'} value={data.topazSharpness || '锐利（默认）'} onChange={(event) => change({ topazSharpness: event.currentTarget.value as CanvasNodeData['topazSharpness'] })}>{topazSharpnessChoices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select></label>
      </div>}
    </div>
    <footer className="nodrag"><button type="button" className="primary" disabled={!data.videoUpscaleSourceUrl || busy || succeeded} onClick={() => void data.onConfirmVideoUpscale?.(id)}><UiActionContent icon={succeeded ? 'check' : failed || data.jobPollLost ? 'retry' : 'spark'}>{topazUpscaleActionLabel(data.jobState, data.progress, data.jobPollLost)}</UiActionContent></button></footer>
  </div>;
}

function ImageQuickCropDialog({
  sourceId, mediaUrl, fileName, sourceWidth, sourceHeight, onApply, onClose,
}: {
  sourceId: string;
  mediaUrl: string;
  fileName?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  onApply: (sourceId: string, output: QuickCropOutput, sourceMediaUrl?: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [presetId, setPresetId] = useState<QuickCropPresetId>('1:1');
  const [freeWidth, setFreeWidth] = useState(Math.max(64, Math.round(sourceWidth || 1920)));
  const [freeHeight, setFreeHeight] = useState(Math.max(64, Math.round(sourceHeight || 1080)));
  const [focus, setFocus] = useState({ x: 0.5, y: 0.5 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const preset = quickCropPresets.find((item) => item.id === presetId);
  const activeSpec: QuickCropSpec = preset || {
    id: 'free', label: '自由', width: freeWidth, height: freeHeight, hint: `${freeWidth} × ${freeHeight}`,
  };
  const updateFocus = (clientX: number, clientY: number) => {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    setFocus({
      x: Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (clientY - bounds.top) / bounds.height)),
    });
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);
  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const [output] = await createQuickCropFiles(mediaUrl, [activeSpec], focus, zoom, fileName || 'image');
      await onApply(sourceId, output, mediaUrl);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片裁切失败');
    } finally {
      setBusy(false);
    }
  };
  const dayTheme = typeof document !== 'undefined' && Boolean(document.querySelector('.app-shell[data-theme="day"]'));
  return createPortal(<div className={`quick-crop-backdrop${dayTheme ? ' is-day' : ''}`} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="quick-crop-dialog nodrag nowheel" role="dialog" aria-modal="true" aria-label="图片快速裁切" onPointerDown={(event) => event.stopPropagation()}>
      <header><div><span>IMAGE TOOLS</span><strong>快速裁切</strong><small>拖动画面定位主体，应用后自动创建节点</small></div><button type="button" className="ui-icon-button" disabled={busy} onClick={onClose} aria-label="关闭"><UiIcon name="close" /></button></header>
      <div className="quick-crop-body">
        <div className="quick-crop-preview-column">
          <div
            ref={stageRef}
            className={`quick-crop-stage${dragging ? ' is-dragging' : ''}`}
            style={{
              aspectRatio: `${Math.max(1, activeSpec.width)} / ${Math.max(1, activeSpec.height)}`,
              ...(activeSpec.width >= activeSpec.height ? { width: 'min(100%, 680px)' } : { width: 'auto', height: 'min(58vh, 610px)' }),
            }}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); updateFocus(event.clientX, event.clientY); }}
            onPointerMove={(event) => { if (dragging) updateFocus(event.clientX, event.clientY); }}
            onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); }}
            onPointerCancel={() => setDragging(false)}
          >
            <img draggable={false} src={mediaUrl} alt="裁切预览" style={{ objectPosition: `${focus.x * 100}% ${focus.y * 100}%`, transform: `scale(${zoom})`, transformOrigin: `${focus.x * 100}% ${focus.y * 100}%` }} />
            <div className="quick-crop-grid" aria-hidden="true"><i /><i /><i /><i /></div>
            <span className="quick-crop-focus" style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }} aria-hidden="true" />
          </div>
          <div className="quick-crop-zoom"><span>缩放</span><input type="range" min="1" max="4" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><b>{zoom.toFixed(2)}×</b><button type="button" title="回到原始位置" onClick={() => { setFocus({ x: 0.5, y: 0.5 }); setZoom(1); }}><UiActionContent icon="retry">复位</UiActionContent></button></div>
          <p>画面不会被拉伸；超出选定版式的区域会被裁掉。</p>
        </div>
        <aside className="quick-crop-presets">
          <div className="quick-crop-section-title"><strong>版式规格</strong><span>选择一个输出比例</span></div>
          <div className="quick-crop-preset-grid">
            {quickCropPresets.map((item) => <button key={item.id} type="button" className={presetId === item.id ? 'active' : ''} onClick={() => setPresetId(item.id)}><i style={{ aspectRatio: `${item.width} / ${item.height}` }} /><span><b>{item.label}</b><small>{item.width} × {item.height}</small><em>{item.hint}</em></span></button>)}
            <button type="button" className={presetId === 'free' ? 'active' : ''} onClick={() => setPresetId('free')}><i className="is-free">↔</i><span><b>自由尺寸</b><small>64–8192 px</small><em>自定义宽高</em></span></button>
          </div>
          {presetId === 'free' && <div className="quick-crop-free-size"><label>宽度<input type="number" min="64" max="8192" value={freeWidth} onChange={(event) => setFreeWidth(Number(event.target.value))} /></label><button type="button" className="ui-icon-button" aria-label="交换宽高" title="交换宽高" onClick={() => { setFreeWidth(freeHeight); setFreeHeight(freeWidth); }}><UiIcon name="swap" /></button><label>高度<input type="number" min="64" max="8192" value={freeHeight} onChange={(event) => setFreeHeight(Number(event.target.value))} /></label></div>}
          <div className="quick-crop-output-summary"><span>当前输出</span><strong>{activeSpec.label}</strong><b>{activeSpec.width} × {activeSpec.height}</b></div>
        </aside>
      </div>
      {error && <div className="quick-crop-error" role="alert">{error}</div>}
      <footer><span>原图会保留，新节点将自动连接到原图</span><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="primary" disabled={busy} onClick={() => void apply()}>{busy ? '正在裁切并保存…' : '应用并创建节点'}</button></footer>
    </section>
  </div>, document.body);
}

type ImageInpaintPoint = { x: number; y: number };
type ImageInpaintStroke = { size: number; points: ImageInpaintPoint[] };

function paintImageInpaintStrokes(context: CanvasRenderingContext2D, strokes: ImageInpaintStroke[], width: number, height: number, color: string) {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = color;
  context.fillStyle = color;
  strokes.forEach((stroke) => {
    const points = stroke.points;
    if (!points.length) return;
    const lineWidth = Math.max(2, stroke.size * Math.min(width, height));
    context.lineWidth = lineWidth;
    if (points.length === 1) {
      context.beginPath();
      context.arc(points[0].x * width, points[0].y * height, lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.beginPath();
    context.moveTo(points[0].x * width, points[0].y * height);
    points.slice(1).forEach((point) => context.lineTo(point.x * width, point.y * height));
    context.stroke();
  });
}

async function createImageInpaintMask(width: number, height: number, strokes: ImageInpaintStroke[], fileName?: string) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建重绘区域');
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  paintImageInpaintStrokes(context, strokes, width, height, '#fff');
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('重绘区域保存失败')), 'image/png'));
  const baseName = String(fileName || 'image').replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 80) || 'image';
  return new File([blob], `${baseName}-局部重绘区域.png`, { type: 'image/png' });
}

function ImageInpaintDialog({
  sourceId, mediaUrl, fileName, sourceWidth, sourceHeight, onApply, onClose,
}: {
  sourceId: string;
  mediaUrl: string;
  fileName?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  onApply: (sourceId: string, prompt: string, maskFile: File) => Promise<void> | void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [brushSize, setBrushSize] = useState(0.055);
  const [strokes, setStrokes] = useState<ImageInpaintStroke[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: Math.max(1, Math.round(sourceWidth || 1024)), height: Math.max(1, Math.round(sourceHeight || 1024)) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): ImageInpaintPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width))),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / Math.max(1, bounds.height))),
    };
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== naturalSize.width) canvas.width = naturalSize.width;
    if (canvas.height !== naturalSize.height) canvas.height = naturalSize.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    paintImageInpaintStrokes(context, strokes, canvas.width, canvas.height, 'rgba(71, 205, 239, .58)');
  }, [naturalSize, strokes]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !busy) {
        event.preventDefault();
        setStrokes((current) => current.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);
  const apply = async () => {
    if (!strokes.length) { setError('先在图片上涂出要修改的区域'); return; }
    if (!prompt.trim()) { setError('告诉我这里要改成什么'); return; }
    setBusy(true);
    setError('');
    try {
      const maskFile = await createImageInpaintMask(naturalSize.width, naturalSize.height, strokes, fileName);
      await onApply(sourceId, prompt.trim(), maskFile);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '局部重绘没有开始，请再试一次');
    } finally {
      setBusy(false);
    }
  };
  const dayTheme = typeof document !== 'undefined' && Boolean(document.querySelector('.app-shell[data-theme="day"]'));
  return createPortal(<div className={`image-inpaint-backdrop${dayTheme ? ' is-day' : ''}`} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="image-inpaint-dialog nodrag nowheel" role="dialog" aria-modal="true" aria-label="局部重绘" onPointerDown={(event) => event.stopPropagation()}>
      <header><div><strong>局部重绘</strong><small>涂出要改的地方，再说想改成什么</small></div><button type="button" className="ui-icon-button" disabled={busy} onClick={onClose} aria-label="关闭"><UiIcon name="close" /></button></header>
      <div className="image-inpaint-body">
        <div className="image-inpaint-workspace">
          <div className="image-inpaint-stage" style={{ aspectRatio: `${naturalSize.width} / ${naturalSize.height}` }}>
            <img src={mediaUrl} alt={fileName || '待局部重绘图片'} draggable={false} onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
            <canvas
              ref={canvasRef}
              aria-label="在图片上涂出需要重绘的区域"
              onPointerDown={(event) => {
                if (busy) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrawing(true);
                setStrokes((current) => [...current, { size: brushSize, points: [pointFromEvent(event)] }]);
              }}
              onPointerMove={(event) => {
                if (!drawing || busy) return;
                const point = pointFromEvent(event);
                setStrokes((current) => current.map((stroke, index) => index === current.length - 1 ? { ...stroke, points: [...stroke.points, point] } : stroke));
              }}
              onPointerUp={() => setDrawing(false)}
              onPointerCancel={() => setDrawing(false)}
            />
          </div>
          <div className="image-inpaint-brush"><span>笔刷</span><input type="range" min="0.015" max="0.16" step="0.005" value={brushSize} disabled={busy} onChange={(event) => setBrushSize(Number(event.currentTarget.value))} /><i style={{ width: `${8 + brushSize * 100}px`, height: `${8 + brushSize * 100}px` }} /><button type="button" disabled={busy || !strokes.length} onClick={() => setStrokes((current) => current.slice(0, -1))}>撤回一笔</button><button type="button" disabled={busy || !strokes.length} onClick={() => setStrokes([])}>清除</button></div>
        </div>
        <aside className="image-inpaint-instruction">
          <label htmlFor={`${sourceId}-inpaint-prompt`}>这里要改成什么</label>
          <textarea id={`${sourceId}-inpaint-prompt`} autoFocus value={prompt} disabled={busy} placeholder="例如：把手修自然，保持人物和背景不变" onChange={(event) => setPrompt(event.currentTarget.value)} />
          <p><span aria-hidden="true" />蓝色区域会被重新绘制，其他地方尽量保持不变。</p>
        </aside>
      </div>
      {error && <div className="image-inpaint-error" role="alert">{error}</div>}
      <footer><span>使用本机 Anima · 原图会保留，可恢复上张</span><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="primary" disabled={busy || !strokes.length || !prompt.trim()} onClick={() => void apply()}>{busy ? '正在开始…' : '开始重绘'}</button></footer>
    </section>
  </div>, document.body);
}

function MediaNode(props: NodeProps<CanvasNode>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [quickCropOpen, setQuickCropOpen] = useState(false);
  const [inpaintOpen, setInpaintOpen] = useState(false);
  const expected = props.data.kind === 'image' ? 'image' : 'video';
  const accept = expected === 'image' ? '.png,.jpg,.jpeg,.webp,.gif' : '.mp4,.webm,.mov';
  const upload = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) props.data.onUpload(props.id, file); event.target.value = ''; };
  const saveSize = (width: number, height: number, duration?: number) => {
    if (width <= 0 || height <= 0) return;
    const mediaDuration = Number.isFinite(duration) && Number(duration) > 0 ? Math.min(15, Number(duration)) : undefined;
    if (props.data.onMediaSize) {
      props.data.onMediaSize(props.id, width, height, mediaDuration);
    } else if (props.data.mediaWidth !== width || props.data.mediaHeight !== height || (mediaDuration !== undefined && props.data.mediaDuration !== mediaDuration)) {
      props.data.onChange(props.id, { mediaWidth: width, mediaHeight: height, ...(mediaDuration !== undefined ? { mediaDuration } : {}) });
    }
  };
  const mediaStyle: CSSProperties | undefined = props.data.mediaWidth && props.data.mediaHeight ? { aspectRatio: `${props.data.mediaWidth} / ${props.data.mediaHeight}` } : undefined;
  const cardTitle = props.data.title || (expected === 'image' ? '图片素材' : '视频素材');
  const dimensions = props.data.mediaWidth && props.data.mediaHeight ? `${props.data.mediaWidth} × ${props.data.mediaHeight}` : '';
  const videoDownloadName = expected === 'video' && props.data.mediaUrl
    ? videoDownloadFileName(cardTitle, props.data.fileName, props.data.mediaUrl)
    : '';
  const imageDownloadName = expected === 'image' && props.data.mediaUrl
    ? nodeResourceDownloadFileName(cardTitle, props.data.fileName, props.data.mediaUrl, 'image')
    : '';
  const lodLevel = props.selected ? 'high' : props.data.mediaLodLevel || 'high';

  if (expected === 'image') {
    const createImageFlow = (creationMode: 'textToImage' | 'imageToImage' | 'imageEdit') => props.data.onQuickCreate(props.id, 'imageGenerator', creationMode);
    return <NodeShell {...props} titleFallback={cardTitle} titleMeta={dimensions || undefined}>
      {props.data.derivedFromNodeId && <Handle className="image-lineage-handle" type="target" position={Position.Left} id="lineage" isConnectable={false} />}
      {props.selected && props.data.mediaUrl && !props.data.publicMode && <ImageToolToolbar onRestore={props.data.imageInpaintPreviousUrl && props.data.onRestoreImageInpaint ? () => props.data.onRestoreImageInpaint?.(props.id) : undefined} onCrop={props.data.onQuickCropImage ? () => setQuickCropOpen(true) : undefined} onSplit={props.data.onCreateTurnaroundSplit ? () => props.data.onCreateTurnaroundSplit?.(props.id, props.data.mediaUrl) : undefined} />}
      <div className={`lib-image-stage media-card-stage ${props.data.mediaUrl ? 'has-media' : 'is-empty'}`}>
        {props.data.mediaUrl
          ? <CanvasLodImage className="media-preview lib-image-preview node-media-surface" style={mediaStyle} src={props.data.mediaUrl} previewUrl={props.data.previewUrl} lodLevel={lodLevel} alt={props.data.fileName || '图片'} onLoad={(image) => { if (!props.data.mediaWidth || !props.data.mediaHeight) saveSize(image.naturalWidth, image.naturalHeight); }} />
          : <EmptyNodeState icon="image" label="等待图片" className="lib-image-empty" />}
        {props.data.imageInpaintActive && <div className="image-inpaint-node-status"><UiIcon name="spark" />{props.data.status || '正在局部重绘'}</div>}
        <div className="node-hover-actions nodrag">
          <button title="上传或替换图片" onClick={() => inputRef.current?.click()}><UiActionContent icon={props.data.mediaUrl ? 'replace' : 'upload'}>{props.data.mediaUrl ? '替换' : '上传'}</UiActionContent></button>
          {props.data.mediaUrl ? <><a title="查看原图" href={props.data.mediaUrl} target="_blank" rel="noreferrer"><UiActionContent icon="external">查看</UiActionContent></a><a title={`下载 ${imageDownloadName}`} href={canvasAssetDownloadUrl(props.data.mediaUrl, imageDownloadName)} download={imageDownloadName}><UiActionContent icon="download">下载</UiActionContent></a><button title="复制节点" onClick={() => props.data.onDuplicate(props.id)}><UiActionContent icon="clone">复制</UiActionContent></button><button className="danger" title="删除节点" onClick={() => props.data.onDelete(props.id)}><UiActionContent icon="delete">删除</UiActionContent></button></> : <><button onClick={() => createImageFlow('textToImage')}><UiActionContent icon="text">文生图</UiActionContent></button><button onClick={() => createImageFlow('imageToImage')}><UiActionContent icon="imageGenerate">图生图</UiActionContent></button><button onClick={() => createImageFlow('imageEdit')}><UiActionContent icon="edit">AI 编辑</UiActionContent></button></>}
        </div>
      </div>
      <input ref={inputRef} className="hidden-input" type="file" accept={accept} onChange={upload} />
      {quickCropOpen && props.data.mediaUrl && props.data.onQuickCropImage && <ImageQuickCropDialog sourceId={props.id} mediaUrl={props.data.mediaUrl} fileName={props.data.fileName} sourceWidth={props.data.mediaWidth} sourceHeight={props.data.mediaHeight} onApply={props.data.onQuickCropImage} onClose={() => setQuickCropOpen(false)} />}
      {inpaintOpen && props.data.mediaUrl && props.data.onInpaintImage && <ImageInpaintDialog sourceId={props.id} mediaUrl={props.data.mediaUrl} fileName={props.data.fileName} sourceWidth={props.data.mediaWidth} sourceHeight={props.data.mediaHeight} onApply={props.data.onInpaintImage} onClose={() => setInpaintOpen(false)} />}
      {props.selected && <div className="lib-image-quick-panel nodrag" aria-label="快捷创建后续节点">
        <button title="创建文本节点" onClick={() => props.data.onQuickCreate(props.id, 'text')}><UiIcon name="text" /><span>文本</span></button>
        <button title="使用当前图片继续生成" onClick={() => createImageFlow('imageToImage')}><UiIcon name="imageGenerate" /><span>图片</span></button>
        <button title="使用当前图片生成视频" onClick={() => props.data.onQuickCreate(props.id, 'videoGenerator')}><UiIcon name="videoGenerate" /><span>视频</span></button>
        <button title="使用当前图片生成 3D 模型" onClick={() => props.data.onQuickCreate(props.id, 'modelGenerator')}><UiIcon name="model3d" /><span>模型</span></button>
        <button title="替换当前图片" onClick={() => inputRef.current?.click()}><UiIcon name="replace" /><span>替换</span></button>
      </div>}
    </NodeShell>;
  }

  return <NodeShell {...props} titleFallback={cardTitle} titleMeta={dimensions || undefined}>
    {props.data.derivedFromNodeId && <Handle className="image-lineage-handle" type="target" position={Position.Left} id="lineage" isConnectable={false} />}
    {props.selected && props.data.mediaUrl && !props.data.publicMode && props.data.onUpscaleVideo && <VideoToolToolbar onUpscale={() => void props.data.onUpscaleVideo?.(props.id, props.data.mediaUrl)} />}
    <div className={`video-stage media-card-stage ${props.data.mediaUrl ? 'has-media' : 'is-empty'}`}>
      {props.data.mediaUrl ? <CanvasVideoPlayer className="media-preview" src={props.data.mediaUrl} poster={props.data.previewUrl} lodLevel={lodLevel} onSelect={() => props.data.onEditStart(props.id)} onLoadedMetadata={(video) => saveSize(video.videoWidth, video.videoHeight, video.duration)} onCaptureFrame={(file, width, height, label) => props.data.onCaptureVideoFrame?.(props.id, file, width, height, label)} onContinueFromTail={(file, width, height) => props.data.onContinueVideoFromFrame?.(props.id, file, width, height)} /> : props.data.videoUpscale && props.data.videoUpscaleSourceUrl && !['queued', 'running', 'cancelling'].includes(String(props.data.jobState || '')) ? <TopazUpscaleControls id={props.id} data={props.data} /> : props.data.videoUpscale ? <div className="media-empty video-upscale-placeholder"><UiIcon name="spark" /><strong>{props.data.jobState === 'failed' ? '高清放大失败' : props.data.jobState === 'cancelled' ? '高清放大已取消' : props.data.topazModel || 'Topaz 星光 2.6'}</strong><span>{props.data.status || `高清放大处理中 · ${Math.round(props.data.progress || 0)}%`}</span></div> : <EmptyNodeState icon="video" label="等待视频" className="media-empty" />}
      <div className="node-hover-actions nodrag">{!props.data.videoUpscale && <button onClick={() => inputRef.current?.click()}><UiActionContent icon={props.data.mediaUrl ? 'replace' : 'upload'}>{props.data.mediaUrl ? '替换' : '上传'}</UiActionContent></button>}{props.data.mediaUrl && <><a href={props.data.mediaUrl} target="_blank" rel="noreferrer"><UiActionContent icon="external">查看</UiActionContent></a><a href={canvasAssetDownloadUrl(props.data.mediaUrl, videoDownloadName)} download={videoDownloadName}><UiActionContent icon="download">下载</UiActionContent></a></>}</div>
    </div>
    <input ref={inputRef} className="hidden-input" type="file" accept={accept} onChange={upload} />
  </NodeShell>;
}
const ImageNode = memo(MediaNode);
const VideoNode = memo(MediaNode);

const AudioNode = memo((props: NodeProps<CanvasNode>) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) props.data.onUpload(props.id, file);
    event.target.value = '';
  };
  const title = props.data.title || '音频素材';
  const audioDownloadName = props.data.mediaUrl ? nodeResourceDownloadFileName(title, props.data.fileName, props.data.mediaUrl, 'audio') : '';
  return <NodeShell {...props} titleFallback={title} titleMeta={props.data.mediaDuration ? `${Math.round(props.data.mediaDuration)} 秒` : undefined}>
    <div className={`canvas-audio-stage ${props.data.mediaUrl ? 'has-media' : 'is-empty'}`}>
      {props.data.mediaUrl
        ? <AudioWaveformPlayer className="canvas-audio-player" src={props.data.mediaUrl} onDuration={(duration) => {
          if (duration > 0 && props.data.mediaDuration !== duration) props.data.onChange(props.id, { mediaDuration: duration });
        }} />
        : <EmptyNodeState icon="audio" label="等待音频" className="media-empty" />}
      <div className="node-hover-actions nodrag">
        <button onClick={() => inputRef.current?.click()}><UiActionContent icon={props.data.mediaUrl ? 'replace' : 'upload'}>{props.data.mediaUrl ? '替换' : '上传'}</UiActionContent></button>
        {props.data.mediaUrl ? <><a href={canvasAssetDownloadUrl(props.data.mediaUrl, audioDownloadName)} download={audioDownloadName} title={`下载 ${audioDownloadName}`}><UiActionContent icon="download">下载</UiActionContent></a><button onClick={() => props.data.onDuplicate(props.id)}><UiActionContent icon="clone">复制</UiActionContent></button><button className="danger" onClick={() => props.data.onDelete(props.id)}><UiActionContent icon="delete">删除</UiActionContent></button></> : null}
      </div>
    </div>
    <input ref={inputRef} className="hidden-input" type="file" accept=".mp3,.wav,.m4a,.aac,.ogg" onChange={upload} />
  </NodeShell>;
});

export function floatingReferencePreviewPosition(
  anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  viewport: { width: number; height: number },
  preview: { width: number; height: number } = { width: 260, height: 220 },
  padding = 12,
  gap = 8,
) {
  const width = Math.min(preview.width, Math.max(0, viewport.width - padding * 2));
  const left = Math.max(padding, Math.min((anchor.left + anchor.right - width) / 2, viewport.width - width - padding));
  const above = anchor.top - preview.height - gap;
  const top = above >= padding
    ? above
    : Math.max(padding, Math.min(anchor.bottom + gap, viewport.height - preview.height - padding));
  return { left, top };
}

export function ReferenceMediaThumbnail({ reference }: { reference: InputReference }) {
  const isVideo = reference.type === 'video';
  const lodUrl = usePersistentMediaLod(reference.mediaUrl || '', isVideo ? 'video' : 'image', reference.previewUrl);
  const [previewFailed, setPreviewFailed] = useState(false);
  useEffect(() => setPreviewFailed(false), [lodUrl, reference.mediaUrl]);
  const imageUrl = isVideo ? lodUrl : canvasImagePreviewUrl(reference.mediaUrl, reference.previewUrl);
  if (imageUrl && !previewFailed) return <img src={imageUrl} alt="" draggable={false} decoding="async" onError={() => setPreviewFailed(true)} />;
  if (isVideo && reference.mediaUrl) return <video src={reference.mediaUrl} muted playsInline preload="metadata" aria-hidden="true" />;
  return <UiIcon name={isVideo ? 'video' : 'image'} />;
}

function CompactImageReferenceChip({ targetId, data, reference, ordinal, onInsert }: { targetId: string; data: CanvasNodeData; reference: InputReference; ordinal: number; onInsert: () => void }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPosition, setPreviewPosition] = useState<{ left: number; top: number } | null>(null);
  const selectedModel = data.models?.find((model) => model.id === data.modelId);
  const workflows = selectedModel?.workflows?.length ? selectedModel.workflows : selectedModel?.workflow ? [selectedModel.workflow] : [];
  const workflow = workflows.find((candidate) => candidate.id === data.workflowId) || workflows[0];
  const workflowPortLabel = workflow?.inputPorts?.find((port) => port.id === reference.port)?.label;
  const portLabel = data.kind === 'comfyUiWorkflow'
    ? comfyUiGenerationPortLabel(reference.port, workflowPortLabel)
    : workflowPortLabel;
  const updatePreviewPosition = () => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    setPreviewPosition(floatingReferencePreviewPosition(anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
  };
  const showPreview = () => {
    updatePreviewPosition();
    setPreviewOpen(true);
  };
  useEffect(() => {
    if (!previewOpen) return;
    const followAnchor = () => updatePreviewPosition();
    window.addEventListener('resize', followAnchor);
    document.addEventListener('scroll', followAnchor, true);
    return () => {
      window.removeEventListener('resize', followAnchor);
      document.removeEventListener('scroll', followAnchor, true);
    };
  }, [previewOpen]);
  const preview = previewOpen && previewPosition && reference.mediaUrl ? <div
    className="input-reference-hover-preview nodrag nowheel"
    style={previewPosition}
    aria-hidden="true"
  >
    <ReferenceMediaThumbnail reference={reference} />
    <span><strong>{portLabel || reference.displayToken || `图片${ordinal}`}</strong><small>{reference.label || reference.token}</small></span>
  </div> : null;
  return <span
    ref={anchorRef}
    className="input-reference-chip-shell"
    onMouseEnter={showPreview}
    onMouseLeave={() => setPreviewOpen(false)}
    onFocusCapture={showPreview}
    onBlurCapture={(event) => { if (!(event.relatedTarget instanceof HTMLElement) || !event.currentTarget.contains(event.relatedTarget)) setPreviewOpen(false); }}
  >
    <button type="button" className="input-reference-role-chip" title={`${portLabel ? `${portLabel} · ` : ''}插入 ${reference.displayToken || reference.token} · ${reference.label || reference.token}`} aria-label={`${portLabel || '参考图片'}，插入${reference.displayToken || reference.token}`} onClick={onInsert}>
      <span className="input-reference-thumb"><ReferenceMediaThumbnail reference={reference} /><b>{referenceTokenOrdinal(reference.displayToken || reference.token, ordinal)}</b></span>
      {portLabel && <span className="input-reference-port-label">{portLabel}</span>}
    </button>

    <button
      type="button"
      className="input-reference-unlink"
      aria-label={`取消关联 图片 ${ordinal}`}
      title="取消与当前生成节点的关联"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setPreviewOpen(false);
        data.onDisconnectInputReference?.(targetId, reference.edgeId);
      }}
    ><UiIcon name="close" /></button>
    {preview && typeof document !== 'undefined' ? createPortal(preview, anchorRef.current?.closest('.app-shell') || document.body) : preview}
  </span>;
}

function InputReferences({ id, data, compact = false }: { id: string; data: CanvasNodeData; compact?: boolean }) {
  const refs = data.inputReferences || [];
  if (!refs.length) return null;
  const insertToken = (token: string, type: DataType) => {
    const promptToken = `@${token}`;
    data.onChange(id, { prompt: [data.prompt?.trimEnd(), promptToken].filter(Boolean).join(' ') }, 'text');
  };
  const groups = (['text', 'image', 'video', 'audio'] as DataType[]).map((type) => ({ type, items: refs.filter((ref) => ref.type === type) })).filter((group) => group.items.length);
  const typeLabel = (type: DataType) => type === 'text' ? '文本' : type === 'image' ? '图片' : type === 'video' ? '视频' : '音频';
  if (compact) return <div className="input-reference-chips nodrag">{groups.flatMap((group) => group.type === 'image' || group.type === 'video'
    ? group.items.map((ref, imageIndex) => <CompactImageReferenceChip key={`${ref.sourceId}-${ref.port}-${ref.index}`} targetId={id} data={data} reference={ref} ordinal={imageIndex + 1} onInsert={() => insertToken(ref.token, ref.type)} />)
    : group.items.map(ref => <span className="input-reference-text-chip" key={ref.edgeId}>
      <button type="button" onClick={() => insertToken(ref.token, ref.type)} title={ref.text || ref.label} aria-label={`插入${ref.displayToken || ref.token}`}><UiIcon name={ref.type === 'audio' ? 'audio' : 'text'} /><b>{ref.displayToken || ref.token}</b><span>{(ref.text || ref.label || '').replace(/\s+/g, ' ').slice(0, 24)}</span></button>
      <button type="button" className="input-reference-text-remove" aria-label={`断开${ref.displayToken || ref.token}`} onClick={() => data.onDisconnectInputReference?.(id, ref.edgeId)}><UiIcon name="close" /></button>
    </span>))}</div>;
  return <div className="input-references nodrag"><div className="reference-heading">已连接输入 <span>{refs.length}</span></div>{groups.map((group) => <div className="reference-group" key={group.type}><small>{typeLabel(group.type)}输入</small><div className="reference-list">
    {group.items.map((ref) => <div className="reference-item" key={`${ref.sourceId}-${ref.port}-${ref.index}`}>
      <button className="reference-token" onClick={() => insertToken(ref.token, ref.type)} title={`插入 ${ref.type === 'image' ? '@' : ''}${ref.token} 到 Prompt`}>
        <span className={`reference-preview ref-${ref.type}`}>{ref.mediaUrl && (ref.type === 'image' || ref.type === 'video') ? <ReferenceMediaThumbnail reference={ref} /> : ref.index}</span>
        <span><strong>{ref.displayToken || ref.token}</strong><small>{ref.label}{ref.text ? ` · ${ref.text.slice(0, 30)}` : ''}</small></span>
      </button>
      <div className="reference-actions"><button onClick={() => insertToken(ref.token, ref.type)}>插入 Prompt</button><button onClick={() => data.onFocusSource(ref.sourceId)} title={`定位到 ${ref.label}`}>定位来源</button></div>
    </div>)}
  </div></div>)}</div>;
}

function escapePromptHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}

export function normalizePromptText(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizePromptReferenceSyntax(text: string, references: readonly InputReference[] = []) {
  const images = references.filter((reference) => reference.type === 'image');
  const imageToken = (rawIndex: string) => images[Number(rawIndex) - 1]?.token || `图片${Math.max(1, Number(rawIndex) || 1)}`;
  return String(text || '')
    .replace(/\{\{\s*(?:Image|Picture)\s*(\d+)\s*\}\}/gi, (_match, rawIndex) => `@${imageToken(rawIndex)}`)
    .replace(/<Picture\s+(\d+)>/gi, (_match, rawIndex) => `@${imageToken(rawIndex)}`);
}

export function promptReferenceClipboardPayload(text: string, references: readonly InputReference[]): PromptReferenceClipboardPayload {
  const normalizedText = normalizePromptReferenceSyntax(text, references);
  const referencePattern = references
    .map((reference) => reference.token)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const mentionedTokens = new Set(referencePattern
    ? Array.from(normalizedText.matchAll(new RegExp(`@(${referencePattern})`, 'g')), (match) => match[1])
    : []);
  const seen = new Set<string>();
  return {
    version: 1,
    text: normalizedText,
    references: references.flatMap((reference) => {
      if (!mentionedTokens.has(reference.token) || seen.has(reference.token)) return [];
      seen.add(reference.token);
      return [{
        type: reference.type,
        token: reference.token,
        sourceId: reference.sourceId,
        label: reference.label,
        ...(reference.mediaUrl ? { mediaUrl: reference.mediaUrl } : {}),
        ...(reference.duration ? { duration: reference.duration } : {}),
        ...(reference.text ? { text: reference.text } : {}),
      }];
    }),
  };
}

export function parsePromptReferenceClipboardPayload(raw: string): PromptReferenceClipboardPayload | null {
  try {
    const payload = JSON.parse(raw) as Partial<PromptReferenceClipboardPayload>;
    if (payload.version !== 1 || typeof payload.text !== 'string' || !Array.isArray(payload.references)) return null;
    const references = payload.references.flatMap((reference) => {
      if (!reference || typeof reference !== 'object') return [];
      const candidate = reference as Partial<PromptClipboardReference>;
      if (!['text', 'image', 'video', 'audio'].includes(String(candidate.type)) || typeof candidate.token !== 'string' || typeof candidate.sourceId !== 'string') return [];
      return [{
        type: candidate.type as DataType,
        token: candidate.token,
        sourceId: candidate.sourceId,
        label: typeof candidate.label === 'string' ? candidate.label : candidate.token,
        ...(typeof candidate.mediaUrl === 'string' ? { mediaUrl: candidate.mediaUrl } : {}),
        ...(typeof candidate.duration === 'number' ? { duration: candidate.duration } : {}),
        ...(typeof candidate.text === 'string' ? { text: candidate.text } : {}),
      }];
    });
    return { version: 1, text: payload.text, references };
  } catch {
    return null;
  }
}

export function remapPastedPromptReferenceTokens(text: string, tokenMap: Readonly<Record<string, string>>) {
  return Object.entries(tokenMap)
    .filter(([source, target]) => Boolean(source && target))
    .sort(([left], [right]) => right.length - left.length)
    .reduce((value, [source, target]) => value.replaceAll(`@${source}`, `@${target}`), String(text || ''));
}

export function referenceTokenOrdinal(token: string, fallback: number) {
  const match = /(\d+)$/.exec(String(token || ''));
  return Math.max(1, Number(match?.[1]) || fallback);
}

export function canonicalizeImageReferenceDisplay(references: readonly InputReference[]) {
  const images = references
    .map((reference, index) => ({ reference, index, ordinal: /^图片(\d+)$/.exec(String(reference.token || '')) }))
    .filter((item) => item.reference.type === 'image')
    .sort((left, right) => (Number(left.ordinal?.[1]) || Number.MAX_SAFE_INTEGER) - (Number(right.ordinal?.[1]) || Number.MAX_SAFE_INTEGER) || left.index - right.index)
    .map(({ reference }, index) => ({ ...reference, displayToken: `图片${index + 1}` }));
  let imageIndex = 0;
  return references.map((reference) => reference.type === 'image' ? images[imageIndex++] : reference);
}

export function poseReferenceFitNotice(reference: Pick<InputReference, 'mediaWidth' | 'mediaHeight'> | undefined, targetRatio: string) {
  const width = Number(reference?.mediaWidth);
  const height = Number(reference?.mediaHeight);
  const [ratioWidth, ratioHeight] = String(targetRatio || '').split(':').map(Number);
  const target = ratioWidth > 0 && ratioHeight > 0 ? ratioWidth / ratioHeight : 0;
  const source = width > 0 && height > 0 ? width / height : 0;
  const mismatch = source > 0 && target > 0 ? Math.max(source / target, target / source) : 1;
  if (mismatch >= 1.35) return `参考图与 ${targetRatio} 画幅差异较大；骨架会等比缩放并用黑边补足，不拉伸、不裁切，但人物在目标画幅中会相应缩小。`;
  return `骨架会等比适配到 ${targetRatio} 画幅并补边，不拉伸、不裁切；请先确认骨架预览中的双臂、双腿和关节完整。`;
}

export function floatingMentionMenuPosition(
  caret: Pick<DOMRect, 'left' | 'top' | 'bottom'>,
  viewport: { width: number; height: number },
  menu: { width: number; height: number } = { width: 360, height: 194 },
  padding = 12,
  gap = 6,
) {
  const width = Math.min(menu.width, Math.max(0, viewport.width - padding * 2));
  const left = Math.max(padding, Math.min(caret.left, viewport.width - width - padding));
  const below = caret.bottom + gap;
  const top = below + menu.height <= viewport.height - padding
    ? below
    : Math.max(padding, caret.top - menu.height - gap);
  return { left, top };
}

export function floatingMediaPreviewPosition(
  menu: { left: number; top: number; width: number },
  viewport: { width: number; height: number },
  preview: { width: number; height: number } = { width: 320, height: 360 },
  padding = 12,
  gap = 10,
) {
  const right = menu.left + menu.width + gap;
  const left = right + preview.width <= viewport.width - padding
    ? right
    : Math.max(padding, menu.left - preview.width - gap);
  const top = Math.max(padding, Math.min(menu.top, viewport.height - preview.height - padding));
  return { left, top };
}

export function reconcilePromptReferenceAliases(prompt: string, references: InputReference[]) {
  const available = references.filter((reference) => reference.type === 'text' ? Boolean(reference.text) : Boolean(reference.mediaUrl));
  const currentTokens = new Set(available.map((reference) => `@${reference.token}`));
  return normalizePromptText(normalizePromptReferenceSyntax(prompt, available)
    .replace(/@(图片|视频|音频|文本)\d+/g, (token) => currentTokens.has(token) ? token : '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(?:、\s*){2,}/g, '、')
    .replace(/、\s*([，。；：])/g, '$1'));
}

export type PromptPresetChipLanguage = 'zh' | 'en';

export function promptPresetChipLanguageForElement(element?: Element | null): PromptPresetChipLanguage {
  const explicitLanguage = element?.closest<HTMLElement>('[data-language]')?.dataset.language
    || (typeof document !== 'undefined' ? document.querySelector<HTMLElement>('[data-language]')?.dataset.language : undefined);
  if (explicitLanguage === 'en' || explicitLanguage === 'zh') return explicitLanguage;
  if (typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('en')) return 'en';
  return storedCanvasInterfaceLanguage();
}

export function promptPresetChipText(token: Pick<PromptTokenSelectionTag, 'label' | 'value'>, language: PromptPresetChipLanguage = 'zh') {
  return language === 'en' ? token.value : token.label;
}

export function promptPresetDetachedText(
  token: Pick<PromptTokenSelectionTag, 'label' | 'value'>,
  language: PromptPresetChipLanguage = 'zh',
) {
  return String(promptPresetChipText(token, language) || token.value || token.label || '').trim();
}

export function promptPresetDetachedInsertionText(
  token: Pick<PromptTokenSelectionTag, 'label' | 'value'>,
  language: PromptPresetChipLanguage,
  beforeText = '',
  afterText = '',
) {
  const literal = promptPresetDetachedText(token, language);
  if (!literal) return '';
  const before = beforeText.trimEnd();
  const after = afterText.trimStart();
  const needsLeadingSeparator = Boolean(before) && !/[,，;；:：.!?。！？、(\[{]$/.test(before);
  const needsTrailingSeparator = !after || !/^[,，;；:：.!?。！？、)\]}]/.test(after);
  return `${needsLeadingSeparator ? ', ' : ''}${literal}${needsTrailingSeparator ? after ? ', ' : ',' : ''}`;
}

export function nextPromptPresetChipLanguage(language?: string): PromptPresetChipLanguage {
  return language === 'en' ? 'zh' : 'en';
}

export function partitionPromptTokenSelectionTags(tokens: readonly PromptTokenSelectionTag[]) {
  return {
    positive: tokens.filter((token) => token.scope === 'positive'),
    negative: tokens.filter((token) => token.scope === 'negative'),
  };
}

function promptPresetChipTitle(token: Pick<PromptTokenSelectionTag, 'scope' | 'label' | 'value'>, language: PromptPresetChipLanguage) {
  return promptPresetChipInterfaceCopy(token.label, token.value, token.scope, language).title;
}

function promptPresetRemoveLabel(token: Pick<PromptTokenSelectionTag, 'scope' | 'label' | 'value'>, language: PromptPresetChipLanguage) {
  return promptPresetChipInterfaceCopy(token.label, token.value, token.scope, language).removeLabel;
}

function promptPresetMarkupForToken(token: PromptTokenSelectionTag, language: PromptPresetChipLanguage) {
  return `<span class="prompt-preset-inline is-${token.scope}" contenteditable="false" data-prompt-preset-token="${escapePromptHtml(token.id)}" data-prompt-preset-scope="${token.scope}" data-prompt-preset-tone="${token.tone}" data-prompt-preset-label="${escapePromptHtml(token.label)}" data-prompt-preset-value="${escapePromptHtml(token.value)}" data-prompt-preset-language="${language}" title="${escapePromptHtml(promptPresetChipTitle(token, language))}"><i aria-hidden="true"></i><strong>${escapePromptHtml(promptPresetChipText(token, language))}</strong><button type="button" data-remove-prompt-preset="${escapePromptHtml(token.id)}" aria-label="${escapePromptHtml(promptPresetRemoveLabel(token, language))}">×</button></span>`;
}

function promptPresetMarkup(tokens: readonly PromptTokenSelectionTag[], language: PromptPresetChipLanguage) {
  return tokens.map((token) => `${promptPresetMarkupForToken(token, language)} `).join('');
}

function NegativePromptTokenTray({ tokens, onRemove }: { tokens: readonly PromptTokenSelectionTag[]; onRemove: (tokenId: string) => void }) {
  const [languages, setLanguages] = useState<Record<string, PromptPresetChipLanguage>>({});
  const interfaceLanguage = promptPresetChipLanguageForElement();
  return <section className={`negative-prompt-tray${tokens.length ? ' has-tokens' : ' is-empty'}`} aria-label="负向提示词标签">
    <header>
      <span><i aria-hidden="true" />负向提示词</span>
      <small>与正向提示词分开提交</small>
    </header>
    {tokens.length
      ? <div className="negative-prompt-tray__tokens">{tokens.map((token) => {
        const language = languages[token.id] || interfaceLanguage;
        const title = promptPresetChipTitle(token, language);
        return <span key={token.id} className="negative-prompt-token" data-prompt-preset-language={language}>
          <button type="button" className="negative-prompt-token__language" title={title} aria-label={title} onClick={() => setLanguages((current) => ({ ...current, [token.id]: nextPromptPresetChipLanguage(current[token.id] || interfaceLanguage) }))}>
            <i aria-hidden="true" />
            <strong>{promptPresetChipText(token, language)}</strong>
          </button>
          <button type="button" className="negative-prompt-token__remove" aria-label={promptPresetRemoveLabel(token, language)} onClick={() => onRemove(token.id)}>×</button>
        </span>;
      })}</div>
      : <p>从上方“负向”词库选择后，会集中显示在这里。</p>}
  </section>;
}

export function promptMarkup(prompt: string, references: InputReference[], presetTokens: readonly PromptTokenSelectionTag[] = [], language: PromptPresetChipLanguage = 'zh') {
  const usable = references.filter((reference) => reference.type === 'text' ? Boolean(reference.text) : Boolean(reference.mediaUrl));
  const normalizedPrompt = normalizePromptReferenceSyntax(prompt, usable);
  type PromptMarkupAlias =
    | { kind: 'reference'; reference: InputReference; legacyPicture: boolean; label: string }
    | { kind: 'preset'; token: PromptTokenSelectionTag }
    | { kind: 'discard-preset' };
  const aliases = new Map<string, PromptMarkupAlias>();
  const subjectLabels = new Map<string, string>();
  for (const match of normalizedPrompt.matchAll(/<Subject\s+(\d+)>\s*=\s*([^\n：]+)/g)) {
    for (const token of match[2].match(/@[\p{L}\p{N}_-]+/gu) || []) subjectLabels.set(token, `Subject ${match[1]}`);
  }
  const counters: Partial<Record<DataType, number>> = {};
  usable.forEach((reference) => {
    counters[reference.type] = (counters[reference.type] || 0) + 1;
    const ordinal = counters[reference.type] || 1;
    const family = reference.type === 'image' ? 'Picture' : reference.type === 'video' ? 'Video' : reference.type === 'audio' ? 'Audio' : 'Text';
    const stableAlias = `@${reference.token}`;
    const displayedOrdinal = referenceTokenOrdinal(reference.displayToken || reference.token, ordinal);
    const roleLabel = reference.type !== 'image' ? `${family} ${displayedOrdinal}` : `图片 ${displayedOrdinal}`;
    aliases.set(stableAlias, { kind: 'reference', reference, legacyPicture: false, label: subjectLabels.get(stableAlias) || roleLabel });
    if (reference.type === 'image') {
      aliases.set(`<Picture ${ordinal}>`, { kind: 'reference', reference, legacyPicture: true, label: `Picture ${ordinal}` });
      aliases.set(`{{Image ${ordinal}}}`, { kind: 'reference', reference, legacyPicture: true, label: `Image ${ordinal}` });
      aliases.set(`{{Picture ${ordinal}}}`, { kind: 'reference', reference, legacyPicture: true, label: `Picture ${ordinal}` });
    }
  });
  const selectedPresetMap = new Map(presetTokens.map((token) => [`${token.scope}:${token.id}`, token]));
  for (const match of normalizedPrompt.matchAll(promptTokenMarkerPattern)) {
    const scope = String(match[1]).toLowerCase() === 'negative' ? 'negative' : 'positive';
    const id = String(match[2]).toLowerCase();
    const token = selectedPresetMap.get(`${scope}:${id}`);
    aliases.set(match[0], token ? { kind: 'preset', token } : { kind: 'discard-preset' });
  }
  if (!aliases.size) {
    const manualMarkup = escapePromptHtml(normalizedPrompt).replace(/\n/g, '<br>');
    const presetMarkup = promptPresetMarkup(presetTokens, language);
    return manualMarkup + (manualMarkup && presetMarkup ? ' ' : '') + presetMarkup;
  }
  const tokenPattern = Array.from(aliases.keys())
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((left, right) => right.length - left.length)
    .join('|');
  const matcher = new RegExp(tokenPattern, 'g');
  let cursor = 0;
  let markup = '';
  const renderedPresets = new Set<string>();
  for (const match of normalizedPrompt.matchAll(matcher)) {
    const index = match.index ?? 0;
    markup += escapePromptHtml(normalizedPrompt.slice(cursor, index)).replace(/\n/g, '<br>');
    const alias = aliases.get(match[0]);
    if (!alias) {
      markup += escapePromptHtml(match[0]);
    } else if (alias.kind === 'preset') {
      const key = `${alias.token.scope}:${alias.token.id}`;
      if (!renderedPresets.has(key)) {
        renderedPresets.add(key);
        markup += promptPresetMarkupForToken(alias.token, language);
      }
    } else if (alias.kind === 'discard-preset') {
      // Removed or model-incompatible preset markers stay invisible and never reach the model.
    } else if (alias.reference.type !== 'text' && !alias.reference.mediaUrl) {
      markup += escapePromptHtml(match[0]);
    } else {
      const literal = match[0];
      const kindClass = ` prompt-reference-${alias.reference.type}`;
      const title = `${alias.label} · ${alias.reference.label || alias.reference.token}`;
      const preview = alias.reference.type === 'image'
        ? `<img src="${escapePromptHtml(alias.reference.mediaUrl || '')}" alt="" draggable="false">`
        : alias.reference.type === 'video'
          ? `<video src="${escapePromptHtml(alias.reference.mediaUrl || '')}" muted preload="metadata" draggable="false"></video>`
          : `<i aria-hidden="true">${alias.reference.type === 'audio' ? '音' : '文'}</i>`;
      const storedLiteral = alias.legacyPicture ? `@${alias.reference.token}` : literal;
      markup += `<span class="prompt-reference-inline${kindClass}" contenteditable="false" data-prompt-literal="${escapePromptHtml(storedLiteral)}" data-reference-token="${escapePromptHtml(alias.reference.token)}" data-reference-edge-id="${escapePromptHtml(alias.reference.edgeId || '')}" data-source-id="${escapePromptHtml(alias.reference.sourceId)}" title="${escapePromptHtml(`${title} · 可拖拽调整位置`)}">${preview}<strong>${escapePromptHtml(alias.label)}</strong><button type="button" data-remove-reference="${escapePromptHtml(storedLiteral)}" aria-label="移除 ${escapePromptHtml(alias.label)}"><svg class="ui-icon prompt-reference-remove-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 5l10 10M15 5 5 15" /></svg></button></span>`;
    }
    cursor = index + match[0].length;
  }
  const manualMarkup = markup + escapePromptHtml(normalizedPrompt.slice(cursor)).replace(/\n/g, '<br>');
  const legacyPresetMarkup = promptPresetMarkup(presetTokens.filter((token) => !renderedPresets.has(`${token.scope}:${token.id}`)), language);
  return manualMarkup + (manualMarkup && legacyPresetMarkup ? ' ' : '') + legacyPresetMarkup;
}

type PromptPresetSerialization = 'marker' | 'value';

function serializePromptDomNodes(nodes: ArrayLike<ChildNode> | Iterable<ChildNode>, presetSerialization: PromptPresetSerialization = 'marker'): string {
  const visit = (node: ChildNode): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof HTMLElement)) return '';
    if (node.dataset.promptPresetToken) {
      if (presetSerialization === 'value') return node.dataset.promptPresetValue || '';
      const scope = node.dataset.promptPresetScope === 'negative' ? 'negative' : 'positive';
      return promptTokenMarker(scope, node.dataset.promptPresetToken);
    }
    if (node.dataset.promptLiteral) return node.dataset.promptLiteral;
    if (node.dataset.referenceToken) return `@${node.dataset.referenceToken}`;
    if (node.tagName === 'BR') return '\n';
    const content = serializePromptDomNodes(node.childNodes, presetSerialization);
    return ['DIV', 'P'].includes(node.tagName) ? `${content}\n` : content;
  };
  return Array.from(nodes).map(visit).join('');
}

export function retainedPromptTokenIds(currentIds: readonly string[] | undefined, renderedIds: readonly string[]) {
  const rendered = new Set(renderedIds);
  return (currentIds || []).filter((id, index, ids) => rendered.has(id) && ids.indexOf(id) === index);
}

export function promptInlineReferenceSignature(references: readonly InputReference[]) {
  return JSON.stringify(references.map((reference) => [
    reference.type,
    reference.label,
    reference.token,
    reference.displayToken || '',
    reference.sourceId,
    reference.port,
    reference.edgeId,
    reference.mediaUrl || '',
    reference.text || '',
  ]));
}

const promptInlineChipSelector = '[data-prompt-preset-token], [data-reference-token], [data-prompt-literal]';

function updatePromptInlineRangeSelection(editor: HTMLElement) {
  const selection = editor.ownerDocument.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)).filter((range) => !range.collapsed)
    : [];
  const intersects = (range: Range, node: HTMLElement) => {
    try { return range.intersectsNode(node); }
    catch { return false; }
  };
  const editorRanges = ranges.filter((range) => intersects(range, editor));
  editor.classList.toggle('has-range-selection', editorRanges.length > 0);
  const editorContents = editor.ownerDocument.createRange();
  editorContents.selectNodeContents(editor);
  const coversAll = editorRanges.some((range) => {
    try {
      return range.compareBoundaryPoints(0, editorContents) <= 0
        && range.compareBoundaryPoints(2, editorContents) >= 0;
    } catch { return false; }
  });
  editor.classList.toggle('is-all-range-selected', coversAll);
  editor.querySelectorAll<HTMLElement>(promptInlineChipSelector).forEach((chip) => {
    chip.classList.toggle('is-range-selected', editorRanges.some((range) => intersects(range, chip)));
  });
}

type PromptChipDragOrigin = {
  chip: HTMLElement;
  placeholder: Comment | null;
  originParent: HTMLElement;
  originPreviousSibling: ChildNode | null;
  originNextSibling: ChildNode | null;
  originPreviousText: string | null;
  originNextText: string | null;
};

type PromptChipPointerDrag = {
  pointerId: number;
  chip: HTMLElement | null;
  chips: HTMLElement[];
  origins: PromptChipDragOrigin[];
  selectionRange: Range | null;
  selectionGroup: HTMLElement | null;
  selectionOrigin: Comment | null;
  dropAnchor: HTMLElement | null;
  startX: number;
  startY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  started: boolean;
};

function promptChipsForPointerDrag(editor: HTMLElement, chip: HTMLElement) {
  const selected = Array.from(editor.querySelectorAll<HTMLElement>(promptInlineChipSelector))
    .filter((candidate) => candidate.classList.contains('is-range-selected'));
  return chip.classList.contains('is-range-selected') && selected.length > 1 ? selected : [chip];
}

function promptSelectionRangeAtPointer(editor: HTMLElement, clientX: number, clientY: number) {
  const selection = editor.ownerDocument.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (range.collapsed || !editor.contains(range.commonAncestorContainer)) return null;
  const overSelection = Array.from(range.getClientRects()).some((rect) => clientX >= rect.left - 2
    && clientX <= rect.right + 2
    && clientY >= rect.top - 2
    && clientY <= rect.bottom + 2);
  return overSelection ? range : null;
}

function promptChipsInSelection(editor: HTMLElement, range: Range) {
  return Array.from(editor.querySelectorAll<HTMLElement>(promptInlineChipSelector)).filter((candidate) => {
    try { return range.intersectsNode(candidate); }
    catch { return false; }
  });
}

function promptSelectionRangeForPointerDrag(editor: HTMLElement, chip: HTMLElement) {
  const selection = editor.ownerDocument.getSelection();
  if (!chip.classList.contains('is-range-selected') || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (range.collapsed || !editor.contains(range.commonAncestorContainer)) return null;
  try { if (!range.intersectsNode(chip)) return null; }
  catch { return null; }
  Array.from(editor.querySelectorAll<HTMLElement>(promptInlineChipSelector))
    .filter((candidate) => candidate.classList.contains('is-range-selected'))
    .forEach((candidate) => {
      if (candidate.contains(range.startContainer)) range.setStartBefore(candidate);
      if (candidate.contains(range.endContainer)) range.setEndAfter(candidate);
    });
  return range;
}

function animatePromptChipCollision(editor: HTMLElement, mutate: () => void) {
  const isDragged = (element: HTMLElement) => element.classList.contains('is-live-dragging') || Boolean(element.closest('.prompt-selection-drag-group.is-live-dragging'));
  const elements = Array.from(editor.querySelectorAll<HTMLElement>(promptInlineChipSelector)).filter((element) => !isDragged(element));
  const before = new Map(elements.map((element) => [element, element.getBoundingClientRect()]));
  mutate();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  window.requestAnimationFrame(() => {
    Array.from(editor.querySelectorAll<HTMLElement>(promptInlineChipSelector)).filter((element) => !isDragged(element)).forEach((element) => {
      const first = before.get(element);
      if (!first || typeof element.animate !== 'function') return;
      const last = element.getBoundingClientRect();
      const x = first.left - last.left;
      const y = first.top - last.top;
      if (Math.abs(x) < .5 && Math.abs(y) < .5) return;
      element.animate([
        { transform: `translate3d(${x}px, ${y}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' },
      ], { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  });
}

export function promptDragCollisionPoint(clientX: number, clientY: number, grabOffsetX: number, grabOffsetY: number, boxHeight: number) {
  return {
    x: clientX - grabOffsetX,
    y: clientY - grabOffsetY + Math.max(1, boxHeight) / 2,
  };
}

export function compactPromptDragTextBoundary(previousText: string, nextText: string) {
  const previous = previousText.replace(/[ \t]+$/g, '');
  const next = nextText.replace(/^[ \t]+/g, '');
  const separator = previous && next && !/[\n([{]$/.test(previous) && !/^[\n,，.;；:：!?。！？、)\]}]/.test(next) ? ' ' : '';
  return { previous: `${previous}${separator}`, next };
}

function closePromptChipGap(previous: ChildNode | null, next: ChildNode | null) {
  if (!previous || !next || previous.nextSibling !== next) return;
  if (previous.nodeType === Node.TEXT_NODE && next.nodeType === Node.TEXT_NODE) {
    const compacted = compactPromptDragTextBoundary(previous.textContent || '', next.textContent || '');
    previous.textContent = compacted.previous;
    next.textContent = compacted.next;
    return;
  }
  if (previous.nodeType === Node.TEXT_NODE) previous.textContent = (previous.textContent || '').replace(/[ \t]+$/g, ' ');
  if (next.nodeType === Node.TEXT_NODE) next.textContent = (next.textContent || '').replace(/^[ \t]+/g, ' ');
}

function removePromptChipDragSpacing(chip: HTMLElement) {
  const previous = chip.previousSibling;
  const next = chip.nextSibling;
  if (previous?.nodeType === Node.TEXT_NODE) previous.textContent = (previous.textContent || '').replace(/[ \t]+$/, '');
  if (next?.nodeType === Node.TEXT_NODE) next.textContent = (next.textContent || '').replace(/^[ \t]+/, '');
}

function promptInlineDropRange(editor: HTMLElement, clientX: number, clientY: number, draggedChips: readonly HTMLElement[] = []) {
  const doc = editor.ownerDocument;
  const pointedChip = doc.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(promptInlineChipSelector);
  if (pointedChip && editor.contains(pointedChip)) {
    if (draggedChips.includes(pointedChip)) return null;
    const range = doc.createRange();
    range.selectNode(pointedChip);
    range.collapse(clientX < pointedChip.getBoundingClientRect().left + pointedChip.getBoundingClientRect().width / 2);
    return range;
  }
  const directRange = doc.caretRangeFromPoint?.(clientX, clientY) || null;
  const fallbackPosition = directRange ? null : (doc as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Parameters<Range['setStart']>[0]; offset: number } | null;
  }).caretPositionFromPoint?.(clientX, clientY);
  let range = directRange || (fallbackPosition ? (() => {
    const fallbackRange = doc.createRange();
    fallbackRange.setStart(fallbackPosition.offsetNode, fallbackPosition.offset);
    fallbackRange.collapse(true);
    return fallbackRange;
  })() : null);
  if ((!range || !editor.contains(range.startContainer)) && (() => {
    const bounds = editor.getBoundingClientRect();
    return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
  })()) {
    range = doc.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  if (!range || !editor.contains(range.startContainer) || draggedChips.some((chip) => chip.contains(range.startContainer))) return null;
  return range;
}

function promptPresetChipElement(token: PromptTokenSelectionTag, language: PromptPresetChipLanguage) {
  const chip = document.createElement('span');
  chip.className = `prompt-preset-inline is-${token.scope}`;
  chip.contentEditable = 'false';
  chip.draggable = false;
  chip.dataset.promptPresetToken = token.id;
  chip.dataset.promptPresetScope = token.scope;
  chip.dataset.promptPresetTone = token.tone;
  chip.dataset.promptPresetLabel = token.label;
  chip.dataset.promptPresetValue = token.value;
  chip.dataset.promptPresetLanguage = language;
  chip.title = promptPresetChipTitle(token, language);
  const marker = document.createElement('i');
  marker.setAttribute('aria-hidden', 'true');
  const value = document.createElement('strong');
  value.textContent = promptPresetChipText(token, language);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.removePromptPreset = token.id;
  remove.setAttribute('aria-label', promptPresetRemoveLabel(token, language));
  remove.textContent = '×';
  chip.append(marker, value, remove);
  return chip;
}

function togglePromptPresetChipLanguage(chip: HTMLElement) {
  const language = nextPromptPresetChipLanguage(chip.dataset.promptPresetLanguage);
  const token: Pick<PromptTokenSelectionTag, 'scope' | 'label' | 'value'> = {
    scope: chip.dataset.promptPresetScope === 'negative' ? 'negative' : 'positive',
    label: chip.dataset.promptPresetLabel || '',
    value: chip.dataset.promptPresetValue || '',
  };
  chip.dataset.promptPresetLanguage = language;
  chip.title = promptPresetChipTitle(token, language);
  const text = chip.querySelector<HTMLElement>('strong');
  if (text) text.textContent = promptPresetChipText(token, language);
  const remove = chip.querySelector<HTMLElement>('[data-remove-prompt-preset]');
  if (remove) remove.setAttribute('aria-label', promptPresetRemoveLabel(token, language));
}

function promptReferenceChipElement(reference: Pick<InputReference, 'type' | 'token' | 'displayToken' | 'sourceId' | 'edgeId' | 'mediaUrl'>, ordinal: number) {
  const chip = document.createElement('span');
  chip.className = `prompt-reference-inline prompt-reference-${reference.type}`;
  chip.contentEditable = 'false';
  chip.draggable = false;
  chip.dataset.promptLiteral = `@${reference.token}`;
  chip.dataset.referenceToken = reference.token;
  chip.dataset.referenceEdgeId = reference.edgeId;
  chip.dataset.sourceId = reference.sourceId;
  const preview = reference.type === 'image' ? document.createElement('img') : reference.type === 'video' ? document.createElement('video') : document.createElement('i');
  if (preview instanceof HTMLImageElement || preview instanceof HTMLVideoElement) preview.src = reference.mediaUrl || '';
  if (preview instanceof HTMLImageElement || preview instanceof HTMLVideoElement) preview.draggable = false;
  if (preview instanceof HTMLImageElement) preview.alt = '';
  if (preview instanceof HTMLVideoElement) { preview.muted = true; preview.preload = 'metadata'; }
  if (preview instanceof HTMLElement && (reference.type === 'audio' || reference.type === 'text')) preview.textContent = reference.type === 'audio' ? '音' : '文';
  const label = document.createElement('strong');
  label.textContent = `${reference.type === 'image' ? 'Picture' : reference.type === 'video' ? 'Video' : reference.type === 'audio' ? 'Audio' : 'Text'} ${referenceTokenOrdinal(reference.displayToken || reference.token, ordinal)}`;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.removeReference = reference.token;
  remove.setAttribute('aria-label', `移除 @${reference.token}`);
  remove.textContent = '×';
  chip.append(preview, label, remove);
  return chip;
}

type PromptPresetToggleHandler = (token: PromptTokenSelectionTag, selected: boolean) => void;

function PromptInlineEditor({ id, data, references, showMentions, onShowMentions, onPasteImage, placeholder = '描述想要生成的内容，输入 @ 引用参考图', inlinePresetTokens = [], managedPresetScopes = ['positive', 'negative'], preset }: { id: string; data: CanvasNodeData; references: InputReference[]; showMentions: boolean; onShowMentions: (value: boolean) => void; onPasteImage: (clipboard: DataTransfer | null) => File | null; placeholder?: string; inlinePresetTokens?: readonly PromptTokenSelectionTag[]; managedPresetScopes?: readonly PromptTokenSelectionTag['scope'][]; preset?: ReactNode | ((onTokenToggle: PromptPresetToggleHandler) => ReactNode) }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const promptChipPointerDragRef = useRef<PromptChipPointerDrag | null>(null);
  const promptPresetTapRef = useRef<{ tokenId: string; at: number } | null>(null);
  const suppressPromptChipClickRef = useRef(false);
  const [mentionPosition, setMentionPosition] = useState<{ left: number; top: number } | null>(null);
  const [replacementMenu, setReplacementMenu] = useState<{ reference: InputReference; left: number; top: number } | null>(null);
  const [replacementQuery, setReplacementQuery] = useState('');
  const [replacementPreview, setReplacementPreview] = useState<{ label: string; mediaUrl: string } | null>(null);
  const [replacementImageReferences, setReplacementImageReferences] = useState<ImageReference[]>([]);
  const availableReferences = references.filter((reference) => reference.type === 'text' ? Boolean(reference.text) : Boolean(reference.mediaUrl));
  const availableReferenceSignature = promptInlineReferenceSignature(availableReferences);
  const inlinePresetTokenSignature = inlinePresetTokens.map((token) => `${token.scope}:${token.id}:${token.label}:${token.value}`).join('|');
  const managesPositivePresets = managedPresetScopes.includes('positive');
  const managesNegativePresets = managedPresetScopes.includes('negative');
  const saveSelection = () => {
    const selection = window.getSelection();
    const editor = editorRef.current;
    if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return;
    selectionRef.current = selection.getRangeAt(0).cloneRange();
  };
  const serializePrompt = () => {
    const editor = editorRef.current;
    if (!editor) return '';
    return normalizePromptText(serializePromptDomNodes(editor.childNodes));
  };
  const syncPrompt = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const value = normalizePromptReferenceSyntax(serializePrompt(), availableReferences);
    const renderedPositiveIds = managesPositivePresets ? Array.from(editor.querySelectorAll<HTMLElement>('[data-prompt-preset-token][data-prompt-preset-scope="positive"]'), (chip) => String(chip.dataset.promptPresetToken || '')).filter(Boolean) : [];
    const renderedNegativeIds = managesNegativePresets ? Array.from(editor.querySelectorAll<HTMLElement>('[data-prompt-preset-token][data-prompt-preset-scope="negative"]'), (chip) => String(chip.dataset.promptPresetToken || '')).filter(Boolean) : [];
    const nextPositiveIds = managesPositivePresets ? retainedPromptTokenIds(data.promptTokenIds, renderedPositiveIds) : data.promptTokenIds || [];
    const nextNegativeIds = managesNegativePresets ? retainedPromptTokenIds(data.negativePromptTokenIds, renderedNegativeIds) : data.negativePromptTokenIds || [];
    const patch: Partial<Pick<CanvasNodeData, 'prompt' | 'promptTokenIds' | 'negativePromptTokenIds'>> = {};
    if (value !== (data.prompt || '')) patch.prompt = value;
    if (managesPositivePresets && (nextPositiveIds.length !== (data.promptTokenIds || []).length || nextPositiveIds.some((tokenId, index) => tokenId !== data.promptTokenIds?.[index]))) patch.promptTokenIds = nextPositiveIds;
    if (managesNegativePresets && (nextNegativeIds.length !== (data.negativePromptTokenIds || []).length || nextNegativeIds.some((tokenId, index) => tokenId !== data.negativePromptTokenIds?.[index]))) patch.negativePromptTokenIds = nextNegativeIds;
    if (Object.keys(patch).length) data.onChange(id, patch, 'text');
  };
  const suppressNextPromptChipClick = () => {
    suppressPromptChipClickRef.current = true;
    window.requestAnimationFrame(() => { suppressPromptChipClickRef.current = false; });
  };
  const promptDragElements = (state: PromptChipPointerDrag) => state.selectionGroup ? [state.selectionGroup] : state.chips;
  const followPromptChipPointer = (state: PromptChipPointerDrag, clientX: number, clientY: number) => {
    const elements = promptDragElements(state);
    elements.forEach((element) => {
      element.style.setProperty('--prompt-chip-drag-x', '0px');
      element.style.setProperty('--prompt-chip-drag-y', '0px');
    });
    const anchor = state.selectionGroup || state.chip || elements[0];
    if (!anchor) return;
    const bounds = anchor.getBoundingClientRect();
    const x = `${clientX - bounds.left - state.grabOffsetX}px`;
    const y = `${clientY - bounds.top - state.grabOffsetY}px`;
    elements.forEach((element) => {
      element.style.setProperty('--prompt-chip-drag-x', x);
      element.style.setProperty('--prompt-chip-drag-y', y);
    });
  };
  const alignPromptChipToDropAnchor = (state: PromptChipPointerDrag, dropAnchor: HTMLElement) => {
    const elements = promptDragElements(state);
    elements.forEach((element) => {
      element.style.setProperty('--prompt-chip-drag-x', '0px');
      element.style.setProperty('--prompt-chip-drag-y', '0px');
    });
    const anchor = state.selectionGroup || state.chip || elements[0];
    if (!anchor) return;
    const anchorBounds = anchor.getBoundingClientRect();
    const anchorTargetBounds = dropAnchor.getBoundingClientRect();
    const x = `${anchorTargetBounds.left - anchorBounds.left}px`;
    const y = `${anchorTargetBounds.top - anchorBounds.top}px`;
    elements.forEach((element) => {
      element.style.setProperty('--prompt-chip-drag-x', x);
      element.style.setProperty('--prompt-chip-drag-y', y);
    });
  };
  const movePromptChipToPoint = (clientX: number, clientY: number) => {
    const editor = editorRef.current;
    const state = promptChipPointerDragRef.current;
    if (!editor || !state?.started) return false;
    state.dropAnchor?.remove();
    state.dropAnchor = null;
    const draggedElements = promptDragElements(state);
    const dragAnchor = state.selectionGroup || state.chip || draggedElements[0];
    const dragBounds = dragAnchor?.getBoundingClientRect();
    const collisionPoint = promptDragCollisionPoint(clientX, clientY, state.grabOffsetX, state.grabOffsetY, dragBounds?.height || 24);
    const range = promptInlineDropRange(editor, collisionPoint.x, collisionPoint.y, draggedElements);
    if (!range) {
      followPromptChipPointer(state, clientX, clientY);
      return false;
    }
    const dropAnchor = editor.ownerDocument.createElement('span');
    const anchorSource = state.selectionGroup || state.chip || state.chips[0];
    const sourceBounds = anchorSource?.getBoundingClientRect();
    dropAnchor.className = 'prompt-chip-drop-anchor';
    dropAnchor.contentEditable = 'false';
    dropAnchor.setAttribute('aria-hidden', 'true');
    dropAnchor.style.setProperty('--prompt-drop-anchor-width', `${Math.round(Math.max(48, sourceBounds?.width || 48))}px`);
    dropAnchor.style.setProperty('--prompt-drop-anchor-height', `${Math.round(Math.max(22, sourceBounds?.height || 22))}px`);
    range.insertNode(dropAnchor);
    state.dropAnchor = dropAnchor;
    if (state.dropAnchor) alignPromptChipToDropAnchor(state, state.dropAnchor);
    else followPromptChipPointer(state, clientX, clientY);
    return true;
  };
  const finishPromptChipPointerDrag = (commit: boolean) => {
    const editor = editorRef.current;
    const state = promptChipPointerDragRef.current;
    if (!editor || !state) return;
    const dropAnchor = state.dropAnchor;
    state.dropAnchor = null;
    let caretNode: ChildNode | null = state.chips[state.chips.length - 1] || null;
    if (state.selectionGroup && state.started) {
      const group = state.selectionGroup;
      if (!commit && state.selectionOrigin?.parentNode) {
        animatePromptChipCollision(editor, () => state.selectionOrigin?.parentNode?.insertBefore(group, state.selectionOrigin));
      } else if (commit && dropAnchor?.parentNode) {
        animatePromptChipCollision(editor, () => dropAnchor.parentNode?.insertBefore(group, dropAnchor));
      }
      dropAnchor?.remove();
      const groupParent = group.parentNode;
      const groupChildren = Array.from(group.childNodes);
      groupChildren.forEach((child) => groupParent?.insertBefore(child, group));
      group.remove();
      caretNode = groupChildren[groupChildren.length - 1] || caretNode;
      const previous = state.selectionOrigin?.previousSibling || null;
      const next = state.selectionOrigin?.nextSibling || null;
      state.selectionOrigin?.remove();
      if (commit) closePromptChipGap(previous, next);
    } else if (!commit && state.started) {
      dropAnchor?.remove();
      animatePromptChipCollision(editor, () => {
        state.origins.forEach((origin) => {
          const previous = origin.chip.previousSibling;
          const next = origin.chip.nextSibling;
          if (origin.placeholder?.parentNode) origin.placeholder.parentNode.insertBefore(origin.chip, origin.placeholder);
          else if (origin.originNextSibling?.parentNode === origin.originParent) origin.originParent.insertBefore(origin.chip, origin.originNextSibling);
          else origin.originParent.appendChild(origin.chip);
          origin.placeholder?.remove();
          closePromptChipGap(previous, next);
        });
        state.origins.forEach((origin) => {
          if (origin.originPreviousText !== null && origin.originPreviousSibling?.parentNode === origin.originParent) origin.originPreviousSibling.textContent = origin.originPreviousText;
          if (origin.originNextText !== null && origin.originNextSibling?.parentNode === origin.originParent) origin.originNextSibling.textContent = origin.originNextText;
        });
      });
    } else if (commit && state.started) {
      if (dropAnchor?.parentNode) {
        const anchorParent = dropAnchor.parentNode;
        state.chips.forEach((chip) => anchorParent.insertBefore(chip, dropAnchor));
      }
      dropAnchor?.remove();
      state.chips.forEach(removePromptChipDragSpacing);
      state.origins.forEach((origin) => {
        const previous = origin.placeholder?.previousSibling || null;
        const next = origin.placeholder?.nextSibling || null;
        origin.placeholder?.remove();
        closePromptChipGap(previous, next);
      });
    }
    state.chips.forEach((chip) => {
      chip.classList.remove('is-live-dragging');
      chip.style.removeProperty('--prompt-chip-drag-x');
      chip.style.removeProperty('--prompt-chip-drag-y');
    });
    state.selectionGroup?.style.removeProperty('--prompt-chip-drag-x');
    state.selectionGroup?.style.removeProperty('--prompt-chip-drag-y');
    editor.classList.remove('is-chip-live-dragging', 'is-chip-group-live-dragging');
    promptChipPointerDragRef.current = null;
    if (editor.hasPointerCapture(state.pointerId)) editor.releasePointerCapture(state.pointerId);
    if (!state.started) return;
    const caretMarker = editor.ownerDocument.createComment('prompt-chip-caret');
    if (caretNode?.parentNode) caretNode.parentNode.insertBefore(caretMarker, caretNode.nextSibling);
    editor.normalize();
    const range = document.createRange();
    if (caretMarker.parentNode) range.setStartBefore(caretMarker);
    else range.selectNodeContents(editor);
    range.collapse(true);
    caretMarker.remove();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    selectionRef.current = range.cloneRange();
    if (commit) syncPrompt();
    suppressNextPromptChipClick();
  };
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // A live drag keeps the original chip node in a ref. Rebuilding innerHTML here
    // would clone the chip; the next pointer move would then insert the original too.
    if (promptChipPointerDragRef.current) return;
    if (document.activeElement === editor) {
      editor.querySelectorAll<HTMLElement>('[data-reference-token]').forEach((chip) => {
        const reference = availableReferences.find((candidate) => candidate.edgeId === chip.dataset.referenceEdgeId)
          || availableReferences.find((candidate) => candidate.token === chip.dataset.referenceToken && candidate.type === 'image');
        if (!reference) return;
        chip.dataset.referenceEdgeId = reference.edgeId;
        chip.dataset.sourceId = reference.sourceId;
        chip.title = `${reference.displayToken || reference.token} · ${reference.label || reference.token}`;
        const preview = chip.querySelector<HTMLImageElement>('img');
        if (preview && reference.mediaUrl && preview.getAttribute('src') !== reference.mediaUrl) preview.src = reference.mediaUrl;
      });
      return;
    }
    const markup = promptMarkup(data.prompt || '', availableReferences, inlinePresetTokens, promptPresetChipLanguageForElement(editor));
    if (editor.innerHTML !== markup) editor.innerHTML = markup;
  }, [data.prompt, availableReferenceSignature, inlinePresetTokenSignature]);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const ownerDocument = editor.ownerDocument;
    const updateSelectionAppearance = () => updatePromptInlineRangeSelection(editor);
    ownerDocument.addEventListener('selectionchange', updateSelectionAppearance);
    return () => {
      ownerDocument.removeEventListener('selectionchange', updateSelectionAppearance);
      editor.classList.remove('has-range-selection', 'is-all-range-selected');
      editor.querySelectorAll<HTMLElement>(promptInlineChipSelector).forEach((chip) => chip.classList.remove('is-range-selected'));
    };
  }, []);
  const insertReference = (reference: InputReference) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    const range = selectionRef.current?.commonAncestorContainer && editor.contains(selectionRef.current.commonAncestorContainer)
      ? selectionRef.current.cloneRange()
      : document.createRange();
    if (!selectionRef.current || !editor.contains(range.commonAncestorContainer)) range.selectNodeContents(editor);
    if (!selectionRef.current || !editor.contains(range.commonAncestorContainer)) range.collapse(false);
    if (range.collapsed && range.endContainer.nodeType === Node.TEXT_NODE) {
      const text = range.endContainer.textContent || '';
      const prefix = text.slice(0, range.endOffset).match(/@[^\s@]*$/)?.[0];
      if (prefix) range.setStart(range.endContainer, range.endOffset - prefix.length);
    }
    range.deleteContents();
    const ordinal = availableReferences.filter((candidate) => candidate.type === reference.type).indexOf(reference) + 1;
    const chip = promptReferenceChipElement(reference, ordinal);
    const trailingSpace = document.createTextNode(' ');
    const fragment = document.createDocumentFragment();
    fragment.append(chip, trailingSpace);
    range.insertNode(fragment);
    range.setStartAfter(trailingSpace);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    selectionRef.current = range.cloneRange();
    syncPrompt();
    onShowMentions(false);
  };
  const removeReference = (element: HTMLElement) => {
    element.remove();
    syncPrompt();
  };
  const consumedInsertion = useRef('');
  useEffect(() => {
    const request = data.promptReferenceInsertion;
    if (!request || consumedInsertion.current === request.requestId) return;
    const pending = request.tokens.map((token) => availableReferences.find((reference) => reference.token === token));
    // Wait for the graph's new edges before rendering chips with their real IDs.
    if (pending.some((reference) => !reference)) return;
    consumedInsertion.current = request.requestId;
    pending.forEach((reference) => { if (reference) insertReference(reference); });
    data.onPromptReferenceInserted?.(request.requestId);
  }, [data.promptReferenceInsertion?.requestId, availableReferenceSignature]);
  const removePromptPreset = (element: HTMLElement) => {
    const tokenId = String(element.dataset.promptPresetToken || '');
    const scope = element.dataset.promptPresetScope === 'negative' ? 'negative' : 'positive';
    if (!tokenId) return;
    const spacer = element.nextSibling;
    if (spacer?.nodeType === Node.TEXT_NODE && spacer.textContent?.startsWith(' ')) spacer.textContent = spacer.textContent.slice(1);
    element.remove();
    syncPrompt();
    data.onChange(id, scope === 'negative'
      ? { negativePromptTokenIds: (data.negativePromptTokenIds || []).filter((candidate) => candidate !== tokenId) }
      : { promptTokenIds: (data.promptTokenIds || []).filter((candidate) => candidate !== tokenId) });
  };
  const detachPromptPresetToText = (element: HTMLElement) => {
    const editor = editorRef.current;
    const tokenId = String(element.dataset.promptPresetToken || '');
    const scope = element.dataset.promptPresetScope === 'negative' ? 'negative' : 'positive';
    if (!editor || !tokenId || !editor.contains(element)) return;
    const editorNodes = Array.from(editor.childNodes);
    const elementIndex = editorNodes.indexOf(element);
    const beforeText = serializePromptDomNodes(editorNodes.slice(0, elementIndex), 'value');
    const afterText = serializePromptDomNodes(editorNodes.slice(elementIndex + 1), 'value');
    const language: PromptPresetChipLanguage = element.dataset.promptPresetLanguage === 'en' ? 'en' : 'zh';
    const token = {
      label: element.dataset.promptPresetLabel || '',
      value: element.dataset.promptPresetValue || '',
    };
    const literal = promptPresetDetachedText(token, language);
    const insertionText = promptPresetDetachedInsertionText(token, language, beforeText, afterText);
    if (!literal || !insertionText) return;
    if (insertionText.startsWith(', ') && element.previousSibling?.nodeType === Node.TEXT_NODE) {
      element.previousSibling.textContent = String(element.previousSibling.textContent || '').replace(/\s+$/g, '');
    }
    if (insertionText.endsWith(', ') && element.nextSibling?.nodeType === Node.TEXT_NODE) {
      element.nextSibling.textContent = String(element.nextSibling.textContent || '').replace(/^\s+/g, '');
    } else if (!insertionText.endsWith(', ') && /^[,，;；:：.!?。！？、]/.test(afterText.trimStart()) && element.nextSibling?.nodeType === Node.TEXT_NODE) {
      element.nextSibling.textContent = String(element.nextSibling.textContent || '').replace(/^\s+(?=[,，;；:：.!?。！？、])/g, '');
    }
    const textNode = editor.ownerDocument.createTextNode(insertionText);
    element.replaceWith(textNode);
    editor.focus();
    const range = editor.ownerDocument.createRange();
    const literalOffset = insertionText.indexOf(literal);
    range.setStart(textNode, literalOffset);
    range.setEnd(textNode, literalOffset + literal.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    selectionRef.current = range.cloneRange();
    const prompt = normalizePromptReferenceSyntax(
      normalizePromptText(serializePromptDomNodes(editor.childNodes)),
      availableReferences,
    );
    const patch: Partial<Pick<CanvasNodeData, 'prompt' | 'promptTokenIds' | 'negativePromptTokenIds'>> = { prompt };
    if (scope === 'negative') patch.negativePromptTokenIds = (data.negativePromptTokenIds || []).filter((candidate) => candidate !== tokenId);
    else patch.promptTokenIds = (data.promptTokenIds || []).filter((candidate) => candidate !== tokenId);
    data.onChange(id, patch, 'text');
    onShowMentions(false);
    suppressNextPromptChipClick();
  };
  const handlePromptPresetToggle: PromptPresetToggleHandler = (token, selected) => {
    const editor = editorRef.current;
    if (!editor) return;
    const matchingSelector = `[data-prompt-preset-token="${CSS.escape(token.id)}"][data-prompt-preset-scope="${token.scope}"]`;
    if (!selected) {
      editor.querySelectorAll<HTMLElement>(matchingSelector).forEach((chip) => {
        const spacer = chip.nextSibling;
        if (spacer?.nodeType === Node.TEXT_NODE && spacer.textContent?.startsWith(' ')) spacer.textContent = spacer.textContent.slice(1);
        chip.remove();
      });
      syncPrompt();
      return;
    }
    if (editor.querySelector(matchingSelector)) return;
    editor.focus();
    const selection = window.getSelection();
    let range = selectionRef.current?.commonAncestorContainer && editor.contains(selectionRef.current.commonAncestorContainer)
      ? selectionRef.current.cloneRange()
      : null;
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    const leadingSpace = document.createTextNode(' ');
    const chip = promptPresetChipElement(token, promptPresetChipLanguageForElement(editor));
    const trailingSpace = document.createTextNode(' ');
    const fragment = document.createDocumentFragment();
    fragment.append(leadingSpace, chip, trailingSpace);
    range.insertNode(fragment);
    range.setStartAfter(trailingSpace);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    selectionRef.current = range.cloneRange();
    syncPrompt();
  };
  const insertClipboardPrompt = (text: string, pastedReferences: InputReference[]) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    let range = selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)
      ? selection.getRangeAt(0).cloneRange()
      : selectionRef.current?.cloneRange();
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    const referencesByToken = new Map(pastedReferences.map((reference) => [reference.token, reference]));
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let ordinal = 0;
    for (const match of text.matchAll(/@([\p{L}\p{N}_-]+)/gu)) {
      const index = match.index ?? 0;
      if (index > cursor) fragment.append(document.createTextNode(text.slice(cursor, index)));
      const reference = referencesByToken.get(match[1]);
      if (reference) {
        ordinal += 1;
        fragment.append(promptReferenceChipElement(reference, referenceTokenOrdinal(reference.token, ordinal)));
      } else {
        fragment.append(document.createTextNode(match[0]));
      }
      cursor = index + match[0].length;
    }
    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    const lastNode = fragment.lastChild;
    if (!lastNode) return;
    range.insertNode(fragment);
    range.setStartAfter(lastNode);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    selectionRef.current = range.cloneRange();
    syncPrompt();
    onShowMentions(false);
  };
  const placeMentionMenu = (range: Range) => {
    const caret = range.cloneRange();
    caret.collapse(true);
    const rect = caret.getBoundingClientRect();
    setMentionPosition(floatingMentionMenuPosition(rect, { width: window.innerWidth, height: window.innerHeight }));
  };
  const updateMentionMenu = () => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const editor = editorRef.current;
    if (!editor || !range || !editor.contains(range.commonAncestorContainer)) {
      setMentionPosition(null);
      return onShowMentions(false);
    }
    const prefix = range.cloneRange();
    prefix.selectNodeContents(editor);
    prefix.setEnd(range.endContainer, range.endOffset);
    if (!/@[^\s@]*$/.test(prefix.toString())) {
      setMentionPosition(null);
      return onShowMentions(false);
    }
    placeMentionMenu(range);
    onShowMentions(true);
  };
  const openReferenceReplacement = (reference: InputReference, anchor: HTMLElement) => {
    const bounds = anchor.getBoundingClientRect();
    const width = Math.min(470, window.innerWidth - 24);
    const estimatedHeight = 420;
    const left = Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12));
    const top = bounds.bottom + 8 + estimatedHeight <= window.innerHeight - 12
      ? bounds.bottom + 8
      : Math.max(12, bounds.top - estimatedHeight - 8);
    setReplacementQuery('');
    setReplacementPreview(null);
    setReplacementImageReferences(data.onListImageReferences?.(id) || data.imageReferences || []);
    setReplacementMenu({ reference, left, top });
    onShowMentions(false);
  };
  useEffect(() => {
    if (!showMentions) return;
    const followCaret = () => {
      const editor = editorRef.current;
      const range = selectionRef.current;
      if (!editor || !range || !editor.contains(range.commonAncestorContainer)) return;
      placeMentionMenu(range);
    };
    window.addEventListener('resize', followCaret);
    document.addEventListener('scroll', followCaret, true);
    return () => {
      window.removeEventListener('resize', followCaret);
      document.removeEventListener('scroll', followCaret, true);
    };
  }, [showMentions]);
  useEffect(() => {
    if (!replacementMenu) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-floating-layer="prompt-reference-replace"]') || target.closest('[data-reference-token]')) return;
      setReplacementMenu(null);
      setReplacementPreview(null);
    };
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setReplacementMenu(null); setReplacementPreview(null); } };
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('keydown', dismissOnEscape);
    };
  }, [replacementMenu]);
  const mentionMenu = showMentions && mentionPosition ? <div
    className="image-mention-menu is-floating nodrag nowheel"
    data-floating-layer="prompt-mention"
    style={mentionPosition}
    onPointerDown={(event) => event.stopPropagation()}
    onWheel={(event) => event.stopPropagation()}
  >{availableReferences.length ? availableReferences.map((reference) => <button key={`${reference.edgeId}-${reference.port}`} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => insertReference(reference)}>{reference.type === 'image' ? <img src={canvasImagePreviewUrl(reference.mediaUrl)} alt="" /> : <i className={`reference-menu-kind is-${reference.type}`}>{reference.type === 'video' ? '视' : reference.type === 'audio' ? '音' : '文'}</i>}<span><strong>@{reference.displayToken || reference.token}</strong><small>{reference.label} · 已连线{reference.type === 'image' ? '图片' : reference.type === 'video' ? '视频' : reference.type === 'audio' ? '音频' : '文本'}</small></span></button>) : <span>请先将素材节点连线到当前生成节点</span>}</div> : null;
  const linkedImageReferences = linkedImageReferencesForReplacement(availableReferences);
  const linkedImageSourceIds = new Set(linkedImageReferences.map((reference) => reference.sourceId));
  const liveReplacementReference = replacementMenu
    ? liveInputReferenceForReplacement(availableReferences, replacementMenu.reference)
    : undefined;
  const replacementCandidates = replacementImageReferences.filter((candidate) => !replacementQuery.trim() || `${candidate.label} ${candidate.sourceId}`.toLowerCase().includes(replacementQuery.trim().toLowerCase()));
  const replacementPicker = replacementMenu && liveReplacementReference ? <div
    className="prompt-reference-replace-menu nodrag nowheel"
    data-floating-layer="prompt-reference-replace"
    style={{ left: replacementMenu.left, top: replacementMenu.top }}
    onPointerDown={(event) => event.stopPropagation()}
    onWheel={(event) => event.stopPropagation()}
  >
    <div className="prompt-reference-replace-nav">
      <header><span><small>替换引用</small><strong>@{liveReplacementReference.displayToken || liveReplacementReference.token}</strong></span><button type="button" className="ui-icon-button" aria-label="关闭替换图片" onClick={() => { setReplacementMenu(null); setReplacementPreview(null); }}><UiIcon name="close" /></button></header>
      <input autoFocus value={replacementQuery} placeholder="搜索" onChange={(event) => setReplacementQuery(event.target.value)} />
      <section className="prompt-reference-linked">
        <div className="prompt-reference-linked-heading"><small>已引用</small><span>{linkedImageReferences.length}</span></div>
        <div className="prompt-reference-linked-grid">{linkedImageReferences.map((reference) => {
          const active = reference.edgeId === liveReplacementReference.edgeId;
          return <button key={`${reference.edgeId}-${reference.sourceId}`} type="button" className={active ? 'is-active' : ''} title={`@${reference.displayToken || reference.token} · ${reference.label}`} aria-label={`选择 @${reference.displayToken || reference.token}，当前参考图 ${reference.label}`} onMouseEnter={() => reference.mediaUrl && setReplacementPreview({ label: reference.label, mediaUrl: reference.mediaUrl })} onMouseLeave={() => setReplacementPreview(null)} onClick={() => {
            setReplacementMenu((current) => current ? { ...current, reference } : current);
            setReplacementQuery('');
            setReplacementPreview(null);
          }}><img src={canvasImagePreviewUrl(reference.mediaUrl)} alt="" /><span>@{reference.displayToken || reference.token}</span></button>;
        })}</div>
      </section>
      <section><small>素材引用</small><button type="button" className="is-active"><UiIcon name="image" /><strong>图片</strong><span>›</span></button><button type="button" disabled><UiIcon name="video" /><strong>视频</strong><span>›</span></button><button type="button" disabled><UiIcon name="audio" /><strong>音频</strong><span>›</span></button></section>
    </div>
    <div className="prompt-reference-replace-options">{replacementCandidates.length ? replacementCandidates.map((candidate) => {
      const current = candidate.sourceId === liveReplacementReference.sourceId;
      const occupied = !current && linkedImageSourceIds.has(candidate.sourceId);
      return <button key={candidate.sourceId} type="button" className={`${current ? 'is-current' : ''}${occupied ? ' is-occupied' : ''}`} aria-disabled={occupied} title={occupied ? '这张图片已被当前节点的其他引用使用' : candidate.label} onMouseEnter={() => setReplacementPreview({ label: candidate.label, mediaUrl: candidate.mediaUrl })} onMouseLeave={() => setReplacementPreview(null)} onMouseDown={(event) => event.preventDefault()} onClick={() => {
        if (occupied) return;
        if (current || data.onReplaceInputReference?.(id, liveReplacementReference.edgeId, candidate.sourceId)) { setReplacementMenu(null); setReplacementPreview(null); }
      }}><img src={canvasImagePreviewUrl(candidate.mediaUrl)} alt="" /><span><strong>{candidate.label}</strong><small>{current ? '当前引用' : occupied ? '已用于其他引用' : '点击替换'}</small></span></button>;
    }) : <p>当前画布没有匹配的图片节点</p>}</div>
    <footer><span>选择后会同步替换连线与提交素材</span></footer>
  </div> : null;
  const replacementHoverPreview = replacementMenu && replacementPreview && typeof window !== 'undefined' ? <div
    className="prompt-reference-hover-preview"
    data-floating-layer="prompt-reference-preview"
    style={floatingMediaPreviewPosition(
      { left: replacementMenu.left, top: replacementMenu.top, width: Math.min(470, window.innerWidth - 24) },
      { width: window.innerWidth, height: window.innerHeight },
    )}
  ><img src={canvasImagePreviewUrl(replacementPreview.mediaUrl)} alt="" /><span>{replacementPreview.label}</span></div> : null;
  const presetContent = typeof preset === 'function' ? preset(handlePromptPresetToggle) : preset;
  return <div ref={controlRef} className={`prompt-control${presetContent ? ' has-preset-toolcard' : ''}`}>
    {presetContent && <div className="prompt-preset-toolcard nodrag nowheel">{presetContent}</div>}
    <div className="prompt-inline-shell">
      <div
        ref={editorRef}
        className="nodrag nowheel prompt-input prompt-inline-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        data-manual-empty={data.prompt?.trim() ? undefined : 'true'}
        onFocus={() => { saveSelection(); data.onEditStart(id); updateMentionMenu(); }}
        onBlur={() => { syncPrompt(); data.onEditEnd(id); onShowMentions(false); }}
        onBeforeInput={(event) => {
          if (event.nativeEvent.inputType.startsWith('delete')) queueMicrotask(syncPrompt);
        }}
        onInput={() => { saveSelection(); syncPrompt(); updateMentionMenu(); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            finishPromptChipPointerDrag(false);
            onShowMentions(false);
            setReplacementMenu(null);
            setReplacementPreview(null);
          }
        }}
        onKeyUp={(event) => {
          saveSelection();
          if (event.key === 'Backspace' || event.key === 'Delete') syncPrompt();
          updateMentionMenu();
        }}
        onMouseUp={() => { saveSelection(); updateMentionMenu(); }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          const target = event.target as HTMLElement;
          const presetRemove = target.closest<HTMLElement>('[data-remove-prompt-preset]');
          const presetChip = presetRemove?.closest<HTMLElement>('[data-prompt-preset-token]');
          if (presetRemove && presetChip && event.currentTarget.contains(presetChip)) {
            event.preventDefault();
            event.stopPropagation();
            removePromptPreset(presetChip);
            suppressNextPromptChipClick();
            return;
          }
          if (target.closest('button')) return;
          const pointedChip = target.closest<HTMLElement>(promptInlineChipSelector);
          const chip = pointedChip && event.currentTarget.contains(pointedChip) ? pointedChip : null;
          const selectionRange = chip
            ? promptSelectionRangeForPointerDrag(event.currentTarget, chip)
            : promptSelectionRangeAtPointer(event.currentTarget, event.clientX, event.clientY);
          if (!chip && !selectionRange) return;
          const chips = selectionRange ? promptChipsInSelection(event.currentTarget, selectionRange) : chip ? promptChipsForPointerDrag(event.currentTarget, chip) : [];
          if (chip?.matches('[data-prompt-preset-token]') || selectionRange) event.preventDefault();
          const bounds = selectionRange?.getBoundingClientRect() || chip?.getBoundingClientRect() || { left: event.clientX, top: event.clientY };
          promptChipPointerDragRef.current = {
            pointerId: event.pointerId,
            chip,
            chips,
            origins: chips.map((draggedChip) => {
              const originPreviousSibling = draggedChip.previousSibling;
              const originNextSibling = draggedChip.nextSibling;
              return {
                chip: draggedChip,
                placeholder: null,
                originParent: draggedChip.parentElement || event.currentTarget,
                originPreviousSibling,
                originNextSibling,
                originPreviousText: originPreviousSibling?.nodeType === Node.TEXT_NODE ? originPreviousSibling.textContent : null,
                originNextText: originNextSibling?.nodeType === Node.TEXT_NODE ? originNextSibling.textContent : null,
              };
            }),
            selectionRange,
            selectionGroup: null,
            selectionOrigin: null,
            dropAnchor: null,
            startX: event.clientX,
            startY: event.clientY,
            grabOffsetX: event.clientX - bounds.left,
            grabOffsetY: event.clientY - bounds.top,
            started: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const state = promptChipPointerDragRef.current;
          if (!state || state.pointerId !== event.pointerId) return;
          if (!state.started && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 4) return;
          if (!state.started) {
            state.started = true;
            if (state.selectionRange) {
              const clickedChipIndex = state.chip ? Math.max(0, state.chips.indexOf(state.chip)) : 0;
              const fragment = state.selectionRange.extractContents();
              const origin = event.currentTarget.ownerDocument.createComment('prompt-selection-origin');
              state.selectionRange.insertNode(origin);
              const group = event.currentTarget.ownerDocument.createElement('span');
              group.className = 'prompt-selection-drag-group is-live-dragging';
              group.contentEditable = 'false';
              group.append(fragment);
              origin.parentNode?.insertBefore(group, origin);
              state.selectionOrigin = origin;
              state.selectionGroup = group;
              state.chips = Array.from(group.querySelectorAll<HTMLElement>(promptInlineChipSelector));
              state.chip = state.chip ? state.chips[Math.min(clickedChipIndex, state.chips.length - 1)] || null : null;
            } else {
              state.origins.forEach((origin) => {
                const placeholder = event.currentTarget.ownerDocument.createComment('prompt-chip-origin');
                origin.placeholder = placeholder;
                origin.chip.parentNode?.insertBefore(placeholder, origin.chip);
                origin.chip.classList.add('is-live-dragging');
              });
            }
            event.currentTarget.classList.add('is-chip-live-dragging');
            event.currentTarget.classList.toggle('is-chip-group-live-dragging', Boolean(state.selectionGroup) || state.chips.length > 1);
            onShowMentions(false);
            setReplacementMenu(null);
            setReplacementPreview(null);
            window.getSelection()?.removeAllRanges();
            updatePromptInlineRangeSelection(event.currentTarget);
          }
          event.preventDefault();
          event.stopPropagation();
          movePromptChipToPoint(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          const state = promptChipPointerDragRef.current;
          if (!state || state.pointerId !== event.pointerId) return;
          const presetChip = !state.started && state.chip?.matches('[data-prompt-preset-token]') ? state.chip : null;
          if (state.started) {
            event.preventDefault();
            event.stopPropagation();
            promptPresetTapRef.current = null;
            movePromptChipToPoint(event.clientX, event.clientY);
          }
          finishPromptChipPointerDrag(true);
          if (presetChip && event.currentTarget.contains(presetChip)) {
            event.preventDefault();
            event.stopPropagation();
            const tokenId = String(presetChip.dataset.promptPresetToken || '');
            const now = Date.now();
            const previousTap = promptPresetTapRef.current;
            if (tokenId && previousTap?.tokenId === tokenId && now - previousTap.at <= 360) {
              promptPresetTapRef.current = null;
              detachPromptPresetToText(presetChip);
            } else {
              promptPresetTapRef.current = tokenId ? { tokenId, at: now } : null;
              togglePromptPresetChipLanguage(presetChip);
              suppressNextPromptChipClick();
            }
          }
        }}
        onPointerCancel={() => finishPromptChipPointerDrag(false)}
        onLostPointerCapture={(event) => { if (promptChipPointerDragRef.current?.pointerId === event.pointerId) finishPromptChipPointerDrag(false); }}
        onDragStart={(event) => { if ((event.target as HTMLElement).closest(promptInlineChipSelector)) event.preventDefault(); }}
        onClick={(event) => {
          if (suppressPromptChipClickRef.current) { event.preventDefault(); event.stopPropagation(); return; }
          const target = event.target as HTMLElement;
          const presetRemove = target.closest<HTMLElement>('[data-remove-prompt-preset]');
          const presetChip = target.closest<HTMLElement>('[data-prompt-preset-token]');
          const removeElement = target.closest<HTMLElement>('[data-remove-reference]')?.closest<HTMLElement>('[data-prompt-literal], [data-reference-token]');
          const chip = target.closest<HTMLElement>('[data-reference-token]');
          const edgeId = chip?.dataset.referenceEdgeId;
          const sourceId = chip?.dataset.sourceId;
          const reference = chip ? availableReferences.find((candidate) => candidate.edgeId === edgeId) || availableReferences.find((candidate) => candidate.token === chip.dataset.referenceToken && candidate.sourceId === sourceId) : undefined;
          if (presetRemove && presetChip) { event.preventDefault(); event.stopPropagation(); removePromptPreset(presetChip); }
          else if (presetChip) { event.preventDefault(); event.stopPropagation(); togglePromptPresetChipLanguage(presetChip); }
          else if (removeElement) { event.preventDefault(); removeReference(removeElement); }
          else if (reference?.type === 'image' && chip) { event.preventDefault(); event.stopPropagation(); openReferenceReplacement(reference, chip); }
          else if (sourceId) data.onFocusSource(sourceId);
          else updateMentionMenu();
        }} onDoubleClick={(event) => {
          const presetChip = (event.target as HTMLElement).closest<HTMLElement>('[data-prompt-preset-token]');
          if (!presetChip || !event.currentTarget.contains(presetChip)) return;
          event.preventDefault();
          event.stopPropagation();
          detachPromptPresetToText(presetChip);
        }} onCopy={(event) => {
        const editor = editorRef.current;
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (!editor || !range || range.collapsed || !editor.contains(range.commonAncestorContainer)) return;
        const text = normalizePromptText(serializePromptDomNodes(range.cloneContents().childNodes, 'value'));
        if (!text) return;
        const payload = promptReferenceClipboardPayload(text, availableReferences);
        event.clipboardData.setData('text/plain', text);
        if (payload.references.length) {
          try { event.clipboardData.setData(promptReferenceClipboardFormat, JSON.stringify(payload)); }
          catch { /* Plain prompt text remains available outside AI Canvas. */ }
        }
        event.preventDefault();
      }} onPaste={(event) => {
        const image = onPasteImage(event.clipboardData);
        if (image) { event.preventDefault(); data.onPasteImageReference(id, image); return; }
        const payload = parsePromptReferenceClipboardPayload(event.clipboardData.getData(promptReferenceClipboardFormat));
        if (payload) {
          event.preventDefault();
          const result = data.onPastePromptReferences?.(id, payload.references) || { tokenMap: {}, linkedCount: 0, skippedCount: payload.references.length };
          const remappedText = remapPastedPromptReferenceTokens(payload.text, result.tokenMap);
          const pastedReferences = payload.references.flatMap((reference, index) => {
            const token = result.tokenMap[reference.token];
            return token ? [{ ...reference, token, index: index + 1, port: 'input', edgeId: `clipboard-${reference.sourceId}-${token}` } as InputReference] : [];
          });
          insertClipboardPrompt(remappedText, pastedReferences);
          return;
        }
        const plainText = event.clipboardData.getData('text/plain');
        if (!plainText) return;
        event.preventDefault();
        insertClipboardPrompt(plainText.replace(/\r\n?/g, '\n'), []);
      }} />
    </div>
    {mentionMenu && typeof document !== 'undefined' ? createPortal(mentionMenu, controlRef.current?.closest('.app-shell') || document.body) : mentionMenu}
    {replacementPicker && typeof document !== 'undefined' ? createPortal(replacementPicker, controlRef.current?.closest('.app-shell') || document.body) : replacementPicker}
    {replacementHoverPreview && typeof document !== 'undefined' ? createPortal(replacementHoverPreview, controlRef.current?.closest('.app-shell') || document.body) : replacementHoverPreview}
  </div>;
}
function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function GenerationTimer({ startedAt }: { startedAt?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const started = Date.parse(startedAt || '');
  return <span className="generation-timer">{Number.isFinite(started) ? formatElapsed(now - started) : '00:00'}</span>;
}

export function GenerationActivityOverlay({ state, startedAt }: { state?: JobState; startedAt?: string }) {
  if (state !== 'queued' && state !== 'running') return null;
  return <div className={`generator-busy-overlay is-${state} nodrag nowheel`} role="status" aria-live="polite">
    <div className="generator-busy-core">
      <i className="generator-busy-pulse" aria-hidden="true" />
      <div className="generator-busy-heading"><span>{state === 'queued' ? '任务排队' : '正在生成'}</span><GenerationTimer startedAt={startedAt} /></div>
      <small>{state === 'queued' ? '等待生成资源' : '生成引擎工作中'}</small>
      <div className="generation-progress-indicator" aria-hidden="true"><i /></div>
    </div>
  </div>;
}

function generatorCapability(kind: CanvasNodeKind): ModelInfo['capability'] {
  return kind === 'imageGenerator' || kind === 'comfyUiWorkflow' ? 'image' : kind === 'videoGenerator' ? 'video' : kind === 'audioGenerator' ? 'audio' : 'model';
}

function isTripoP1(model?: ModelInfo) {
  return /(?:^|[^a-z0-9])p1(?:[^a-z0-9]|$)|p1-2026/i.test(`${model?.id || ''} ${model?.name || ''}`);
}

function tripoModelFamilyLabel(model?: ModelInfo) {
  return isTripoP1(model) ? 'P1 · 低多边形清洁拓扑' : 'H v3.1 · 高精度通用模型';
}

function TripoToggle({ active, disabled, title, children, onClick }: { active: boolean; disabled?: boolean; title?: string; children: ReactNode; onClick: () => void }) {
  return <button type="button" className={active ? 'active' : ''} disabled={disabled} title={title} onClick={onClick}>{children}</button>;
}

function TripoImageWorkflowNotice({ id, data, mode, references }: { id: string; data: CanvasNodeData; mode: Exclude<TripoModelInputMode, 'text'>; references: InputReference[] }) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadPort, setUploadPort] = useState<'front' | 'left' | 'back' | 'right' | null>(null);
  const [uploadingPort, setUploadingPort] = useState<'front' | 'left' | 'back' | 'right' | null>(null);
  const imageReferences = references.filter((reference) => reference.type === 'image');
  const viewPorts: Array<{ id: 'front' | 'left' | 'back' | 'right'; label: string; required?: boolean }> = [
    { id: 'front', label: '正面', required: true },
    { id: 'left', label: '左侧' },
    { id: 'back', label: '背面' },
    { id: 'right', label: '右侧' },
  ];
  const multiview = mode === 'multiview';
  const copy = mode === 'image'
    ? { eyebrow: '单图建模', title: '单图建模不使用提示词', body: '模型只读取已连接的单张参考图，文字内容不会提交给 Tripo。' }
    : mode === 'imageToMultiview'
      ? { eyebrow: '视图补全', title: '多视图补全不使用提示词', body: '系统只根据已连接的单张参考图补全其他方向，不读取文字描述。' }
      : mode === 'imageToMultiviewToModel'
        ? { eyebrow: '自动多视图建模', title: '自动多视图建模不使用提示词', body: '系统先从单张参考图补全视角，再使用这些图片建模，文字内容不会提交给 Tripo。' }
        : { eyebrow: '多视图建模', title: '多视图建模不使用提示词', body: '模型只读取当前启用的正面、侧面与背面参考图，文字内容不会提交给 Tripo。' };
  const chooseFile = (port: 'front' | 'left' | 'back' | 'right') => {
    setUploadPort(port);
    uploadRef.current?.click();
  };
  const uploadView = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !uploadPort || !data.onUploadModelView) return;
    const port = uploadPort;
    setUploadingPort(port);
    try {
      await data.onUploadModelView(id, port, file);
    } finally {
      setUploadingPort(null);
      setUploadPort(null);
    }
  };
  return <section className="tripo-prompt-notice" aria-label={copy.title}>
    <header>
      <span className="tripo-prompt-notice-mark" aria-hidden="true">◇</span>
      <div><small>{copy.eyebrow}</small><strong>{copy.title}</strong></div>
      <b>{multiview ? `已启用 ${imageReferences.length} 个视角` : imageReferences.length ? `已连接 ${imageReferences.length} 张参考图` : '等待参考图'}</b>
    </header>
    <p>{copy.body}</p>
    {multiview && <div className="tripo-view-input-status" aria-label="多视图连接状态">
      {viewPorts.map((view) => {
        const reference = imageReferences.find((item) => item.port === view.id);
        const connected = Boolean(reference?.mediaUrl);
        const uploading = uploadingPort === view.id;
        return <div key={view.id} className={connected ? 'is-connected' : view.required ? 'is-required' : ''}>
          {connected ? <img src={reference?.mediaUrl} alt="" /> : <i aria-hidden="true">{view.required ? '!' : '+'}</i>}
          <span><strong>{view.label}</strong><small>{connected ? '已启用' : view.required ? '必填' : '未连接'}</small></span>
          {!data.publicMode && (connected
            ? <button type="button" className="tripo-view-remove" aria-label={`取消${view.label}视角`} title={`取消${view.label}视角`} onClick={() => data.onRemoveModelView?.(id, view.id)}><UiIcon name="close" /></button>
            : <button type="button" className="tripo-view-add" disabled={uploading} aria-label={`补充${view.label}视角`} onClick={() => chooseFile(view.id)}>{uploading ? '上传中' : '补图'}</button>)}
        </div>;
      })}
      <input ref={uploadRef} className="hidden-input" type="file" accept=".png,.jpg,.jpeg,.webp" onChange={uploadView} />
    </div>}
    <footer><span>生成后的文字入口</span><strong>AI 重贴图 / 材质描述</strong><small>需要改变颜色或材质时，在下一阶段输入描述。</small></footer>
  </section>;
}
function TripoNumberField({ label, value, min, max, disabled, hint, onChange }: { label: string; value?: number; min: number; max: number; disabled?: boolean; hint?: string; onChange: (value?: number) => void }) {
  return <label className="tripo-number-field"><span>{label}</span><input type="number" className="nodrag nowheel" value={value ?? ''} min={min} max={max} step="1" disabled={disabled} placeholder="自动" onChange={(event) => onChange(event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value))} />{hint && <small>{hint}</small>}</label>;
}

export function tripoModelInputLabel(mode?: TripoModelInputMode) {
  return mode === 'text' ? '提示词' : mode === 'multiview' ? '多视图' : '单张图片';
}

export function tripoModelPresetLabel(preset: TripoModelPreset) {
  return preset === 'preview' ? '快速预览' : preset === 'game' ? '游戏资产' : preset === 'detail' ? '精细展示' : '自定义设置';
}

export function tripoSubmittedSpecLabel(options?: TripoSubmittedOptions) {
  if (!options) return '';
  const geometry = options.geometryQuality === 'detailed' || options.resolution === 'DETAILED' ? '详细几何' : '常规几何';
  const texture = !options.texture
    ? '无纹理'
    : options.textureQuality === 'extreme'
      ? '极致纹理'
      : options.textureQuality === 'detailed'
        ? '高清纹理'
        : '基础纹理';
  return `${geometry} · ${texture} · ${options.pbr && options.texture ? 'PBR' : '非 PBR'}`;
}

export function tripoSettingsDifferFromSubmission(data: Pick<CanvasNodeData, 'resolution' | 'geometryQuality' | 'texture' | 'pbr' | 'textureQuality'>, options?: TripoSubmittedOptions) {
  if (!options) return false;
  const resolution = String(data.resolution || '').toUpperCase() === 'DETAILED' ? 'DETAILED' : 'STANDARD';
  const geometryQuality = data.geometryQuality || (resolution === 'DETAILED' ? 'detailed' : 'standard');
  const texture = data.texture !== false;
  return resolution !== options.resolution
    || geometryQuality !== options.geometryQuality
    || texture !== options.texture
    || (texture && (data.pbr !== false) !== options.pbr)
    || (texture && (data.textureQuality || 'standard') !== options.textureQuality);
}

export function resolvedTripoModelPreset(data: Pick<CanvasNodeData, 'modelPreset' | 'geometryQuality' | 'resolution' | 'texture' | 'pbr' | 'textureQuality' | 'quad' | 'generateParts' | 'faceLimit'>): TripoModelPreset {
  if (data.modelPreset) return data.modelPreset;
  if (data.quad || data.generateParts || data.faceLimit !== undefined || data.textureQuality === 'extreme' || data.texture === false) return 'custom';
  if (data.geometryQuality === 'detailed' || String(data.resolution || '').toUpperCase() === 'DETAILED' || data.textureQuality === 'detailed') return 'detail';
  if (data.pbr === false) return 'preview';
  return 'game';
}

export function tripoModelPresetSettings(preset: Exclude<TripoModelPreset, 'custom'>, p1 = false): Partial<CanvasNodeData> {
  if (preset === 'preview') return {
    modelPreset: preset,
    resolution: 'STANDARD',
    geometryQuality: 'standard',
    texture: true,
    pbr: false,
    textureQuality: 'standard',
    quad: false,
    smartLowPoly: false,
    generateParts: false,
    faceLimit: undefined,
    exportUv: true,
  };
  if (preset === 'detail') return {
    modelPreset: preset,
    resolution: p1 ? 'STANDARD' : 'DETAILED',
    geometryQuality: p1 ? 'standard' : 'detailed',
    texture: true,
    pbr: true,
    textureQuality: 'detailed',
    quad: false,
    smartLowPoly: false,
    generateParts: false,
    faceLimit: undefined,
    exportUv: true,
  };
  return {
    modelPreset: preset,
    resolution: 'STANDARD',
    geometryQuality: 'standard',
    texture: true,
    pbr: true,
    textureQuality: 'standard',
    quad: false,
    smartLowPoly: false,
    generateParts: false,
    faceLimit: undefined,
    exportUv: true,
  };
}

function TripoModelControls({ id, data, model }: { id: string; data: CanvasNodeData; model?: ModelInfo }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const p1 = isTripoP1(model);
  const mode = data.modelInputMode || 'text';
  const imageWorkflow = mode !== 'text';
  const texture = data.texture !== false;
  const generateParts = Boolean(data.generateParts);
  const geometryQuality = data.geometryQuality || (String(data.resolution || '').toUpperCase() === 'DETAILED' ? 'detailed' : 'standard');
  const submittedOptions = data.tripoSubmittedOptions;
  const settingsChangedAfterSubmission = tripoSettingsDifferFromSubmission(data, submittedOptions);
  const preset = resolvedTripoModelPreset(data);
  const faceMin = p1 ? 50 : 500;
  const faceMax = p1 ? 20_000 : data.quad ? (data.smartLowPoly ? 10_000 : 150_000) : data.smartLowPoly ? 20_000 : geometryQuality === 'detailed' ? 2_000_000 : 1_500_000;
  const setMode = (nextMode: TripoModelInputMode) => data.onChange(id, {
    modelInputMode: nextMode,
    ...(nextMode === 'text' ? { enableImageAutofix: false, textureAlignment: 'original_image', orientation: 'default' } : { negativePrompt: '', imageSeed: undefined }),
  });
  const setAdvanced = (patch: Partial<CanvasNodeData>) => data.onChange(id, { ...patch, modelPreset: 'custom' });
  const simpleInput = mode === 'text' ? 'text' : mode === 'multiview' ? 'multiview' : 'image';
  const inputHint = mode === 'text'
    ? '没有参考图时使用，直接描述想要的角色或物体。'
    : mode === 'image'
      ? '使用一张正面图或单张参考图生成 3D 模型。'
      : mode === 'imageToMultiview'
        ? '只补全多个方向的参考图，不生成 3D 模型。'
        : mode === 'imageToMultiviewToModel'
          ? '先补全多个方向，再生成 3D 模型，角色还原会更稳定。'
          : '使用 2–4 张不同方向的图片，角色还原最稳定。';
  const resultCopy = preset === 'preview'
    ? '优先生成速度，适合先确认轮廓和整体造型。'
    : preset === 'game'
      ? '兼顾造型、材质与通用性，适合继续导入游戏引擎。'
      : preset === 'detail'
        ? p1 ? '当前模型会使用其支持的最高质量。' : '保留更多结构和表面细节，适合最终展示。'
        : '你已经修改了高级参数，系统会按当前自定义设置生成。';
  return <div className="tripo-generation-controls">
    <div className="tripo-simple-section">
      <div className="tripo-simple-heading"><div><small>我提供什么</small><strong>选择参考来源</strong></div><span>系统会自动处理其余参数</span></div>
      <div className="tripo-choice-grid tripo-input-choice-grid">
        <button type="button" className={simpleInput === 'text' ? 'active' : ''} aria-pressed={simpleInput === 'text'} onClick={() => setMode('text')}><strong>提示词</strong><span>只有文字描述</span></button>
        <button type="button" className={simpleInput === 'image' ? 'active' : ''} aria-pressed={simpleInput === 'image'} onClick={() => setMode('image')}><strong>单张图片</strong><span>一张角色参考图</span></button>
        <button type="button" className={simpleInput === 'multiview' ? 'active' : ''} aria-pressed={simpleInput === 'multiview'} onClick={() => setMode('multiview')}><strong>多视图</strong><span>正面、侧面、背面</span></button>
      </div>
      <p className="tripo-simple-hint">{inputHint}</p>
    </div>

    <div className="tripo-simple-section">
      <div className="tripo-simple-heading"><div><small>我要拿它做什么</small><strong>选择模型用途</strong></div><span>{preset === 'custom' ? '当前使用自定义设置' : '推荐：游戏资产'}</span></div>
      <div className="tripo-choice-grid tripo-purpose-choice-grid">
        <button type="button" className={preset === 'preview' ? 'active' : ''} aria-pressed={preset === 'preview'} onClick={() => data.onChange(id, tripoModelPresetSettings('preview', p1))}><strong>快速预览</strong><span>更快确认造型</span></button>
        <button type="button" className={preset === 'game' ? 'active recommended' : 'recommended'} aria-pressed={preset === 'game'} onClick={() => data.onChange(id, tripoModelPresetSettings('game', p1))}><em>推荐</em><strong>游戏资产</strong><span>质量与通用性平衡</span></button>
        <button type="button" className={preset === 'detail' ? 'active' : ''} aria-pressed={preset === 'detail'} onClick={() => data.onChange(id, tripoModelPresetSettings('detail', p1))}><strong>精细展示</strong><span>保留更多细节</span></button>
      </div>
    </div>

    <div className="tripo-result-summary">
      <div><small>{submittedOptions ? '下次生成方案' : '当前方案'}</small><strong>{tripoModelInputLabel(mode)} · {tripoModelPresetLabel(preset)}</strong></div>
      <p>{resultCopy}</p>
      <span>{texture ? '带颜色与材质' : '无颜色模型'} · {data.quad ? '可编辑 FBX 文件' : '通用 3D 文件'} · {data.autoSize ? '自动统一尺寸' : '保留原始尺寸'}</span>
    </div>

    {submittedOptions && <div className={`tripo-submitted-spec ${settingsChangedAfterSubmission ? 'is-changed' : ''}`}>
      <div><small>已生成模型的实际规格</small><strong>{tripoSubmittedSpecLabel(submittedOptions)}</strong></div>
      <p>{settingsChangedAfterSubmission ? '当前设置已改变，只会影响下一次生成；上方模型仍是这个实际规格。' : '这是上一次生成实际使用的规格。'}</p>
    </div>}

    <button type="button" className="tripo-advanced-toggle" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((value) => !value)}><span><strong>高级设置</strong><small>面数、贴图、UV、Seed 等，通常不需要调整</small></span><b>{showAdvanced ? '收起' : '展开'}</b></button>

    {showAdvanced && <div className="tripo-advanced-grid">
      <div className="tripo-control-group tripo-mode-control">
        <div className="tripo-control-heading"><small>输入细节</small><span>特殊单图流程与多视图方向</span></div>
        <section>
          <TripoToggle active={mode === 'image'} onClick={() => setMode('image')}>直接生成 3D</TripoToggle>
          <TripoToggle active={mode === 'imageToMultiviewToModel'} onClick={() => setMode('imageToMultiviewToModel')}>先补全视图再生成</TripoToggle>
          <TripoToggle active={mode === 'imageToMultiview'} onClick={() => setMode('imageToMultiview')}>只生成多视图</TripoToggle>
        </section>
        {mode === 'multiview' && <div className="tripo-port-guide"><span><b>必填</b> 正面</span><span>左侧</span><span>背面</span><span>右侧</span></div>}
      </div>

      <div className="tripo-control-group">
        <div className="tripo-control-heading"><small>表面与颜色</small><span>{texture ? '生成颜色材质' : '无颜色模型'}</span></div>
        <section>
          <TripoToggle active={texture} disabled={generateParts} title={generateParts ? '分离部件要求关闭材质' : undefined} onClick={() => setAdvanced({ texture: true, pbr: data.pbr !== false })}>生成颜色材质</TripoToggle>
          <TripoToggle active={texture && data.pbr !== false} disabled={!texture || generateParts} onClick={() => setAdvanced({ pbr: !(texture && data.pbr !== false) })}>真实光泽材质</TripoToggle>
          <TripoToggle active={!texture} onClick={() => setAdvanced({ texture: false, pbr: false })}>无颜色模型</TripoToggle>
          {(['standard', 'detailed', 'extreme'] as const).map((quality) => <TripoToggle key={quality} active={(data.textureQuality || 'standard') === quality} disabled={!texture} onClick={() => setAdvanced({ textureQuality: quality })}>{quality === 'standard' ? '基础清晰度' : quality === 'detailed' ? '高清贴图' : '最高贴图'}</TripoToggle>)}
        </section>
      </div>

      <div className="tripo-control-group">
        <div className="tripo-control-heading"><small>模型结构</small><span>{p1 ? '当前模型已自动控制面数' : '细节与模型复杂度'}</span></div>
        <section>
          <TripoToggle active={geometryQuality === 'standard'} onClick={() => setAdvanced({ geometryQuality: 'standard', resolution: 'STANDARD' })}>常规细节</TripoToggle>
          <TripoToggle active={geometryQuality === 'detailed'} disabled={p1} title={p1 ? '当前模型固定使用常规细节' : undefined} onClick={() => setAdvanced({ geometryQuality: 'detailed', resolution: 'DETAILED' })}>更多细节</TripoToggle>
          <TripoToggle active={Boolean(data.quad)} disabled={p1 || generateParts} title={p1 ? '当前模型不支持四边面' : generateParts ? '分离部件不支持四边面' : undefined} onClick={() => setAdvanced({ quad: !data.quad })}>四边面 FBX</TripoToggle>
          <TripoToggle active={Boolean(data.smartLowPoly)} disabled={p1} title={p1 ? '当前模型已自动优化面数' : undefined} onClick={() => setAdvanced({ smartLowPoly: !data.smartLowPoly })}>自动减面</TripoToggle>
          <TripoToggle active={generateParts} disabled={p1} title={p1 ? '当前模型不支持分离部件' : undefined} onClick={() => setAdvanced(generateParts ? { generateParts: false } : { generateParts: true, texture: false, pbr: false, quad: false })}>分离部件</TripoToggle>
        </section>
        <TripoNumberField label="面数上限" value={data.faceLimit} min={faceMin} max={faceMax} hint={`可填 ${faceMin.toLocaleString()}–${faceMax.toLocaleString()}`} onChange={(faceLimit) => setAdvanced({ faceLimit })} />
      </div>

      <div className="tripo-control-group">
        <div className="tripo-control-heading"><small>文件与尺寸</small><span>保持默认即可用于大多数情况</span></div>
        <section>
          <TripoToggle active={Boolean(data.autoSize)} onClick={() => setAdvanced({ autoSize: !data.autoSize })}>自动统一尺寸</TripoToggle>
          <TripoToggle active={data.exportUv !== false} onClick={() => setAdvanced({ exportUv: data.exportUv === false })}>保留 UV</TripoToggle>
          <TripoToggle active={Boolean(data.enableImageAutofix)} disabled={!imageWorkflow} title={!imageWorkflow ? '仅图片输入支持自动修复' : undefined} onClick={() => setAdvanced({ enableImageAutofix: !data.enableImageAutofix })}>自动修复参考图</TripoToggle>
        </section>
        <div className="tripo-select-grid">
          <label><span>颜色对齐方式</span><select disabled={!imageWorkflow || !texture} value={data.textureAlignment || 'original_image'} onChange={(event) => setAdvanced({ textureAlignment: event.currentTarget.value as CanvasNodeData['textureAlignment'] })}><option value="original_image">跟随参考图</option><option value="geometry">跟随模型结构</option></select></label>
          <label><span>模型方向</span><select disabled={!imageWorkflow || !texture} value={data.orientation || 'default'} onChange={(event) => setAdvanced({ orientation: event.currentTarget.value as CanvasNodeData['orientation'] })}><option value="default">自动</option><option value="align_image">跟随参考图</option></select></label>
        </div>
      </div>

      <div className="tripo-control-group">
        <div className="tripo-control-heading"><small>复现同一结果</small><span>只有需要精确复现时才填写</span></div>
        <div className="tripo-number-grid">
          <TripoNumberField label="模型 Seed" value={data.modelSeed} min={0} max={4_294_967_295} onChange={(modelSeed) => setAdvanced({ modelSeed })} />
          <TripoNumberField label="图片 Seed" value={data.imageSeed} min={0} max={4_294_967_295} disabled={mode !== 'text'} hint={mode !== 'text' ? '仅提示词输入' : undefined} onChange={(imageSeed) => setAdvanced({ imageSeed })} />
          <TripoNumberField label="材质 Seed" value={data.textureSeed} min={0} max={4_294_967_295} disabled={!texture} onChange={(textureSeed) => setAdvanced({ textureSeed })} />
        </div>
        <label className="tripo-negative-prompt"><span>不希望出现的内容</span><textarea className="nodrag nowheel" maxLength={255} disabled={mode !== 'text'} value={data.negativePrompt || ''} placeholder={mode === 'text' ? '例如：多余部件、破损表面，最多 255 字' : '仅提示词输入支持'} onChange={(event) => setAdvanced({ negativePrompt: event.currentTarget.value })} /><small>{(data.negativePrompt || '').length}/255</small></label>
      </div>
    </div>}
  </div>;
}

function localQueueWaitLabel(seconds: number) {
  const minutes = Math.max(1, Math.ceil(Math.max(0, Number(seconds) || 0) / 60));
  return minutes < 60 ? `约 ${minutes} 分钟` : `约 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export function formatGenerationDuration(milliseconds?: number) {
  if (!Number.isFinite(milliseconds) || Number(milliseconds) < 0) return '';
  const seconds = Math.max(1, Math.round(Number(milliseconds) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}小时${minutes ? `${minutes}分` : ''}${remainder ? `${remainder}秒` : ''}`;
  if (minutes) return `${minutes}分${remainder ? `${remainder}秒` : ''}`;
  return `${remainder}秒`;
}

export function h3GenerationModesForInput(mode: VideoInputMode, publicMode = false) {
  return [
    { id: 'standard' as const, label: '正式质量 · 20步' },
    { id: 'turbo' as const, label: `官方预览 · ${mode === 'reference' ? 4 : 8}步` },
    ...(mode === 'reference' && !publicMode ? [
      { id: 'reference8' as const, label: '全参加速 · 8步' },
      { id: 'community8' as const, label: '社区增强 · 8步' },
    ] : []),
  ];
}

function SpecHelpLabel({ label, help }: { label: string; help: string }) {
  return <span className="generator-spec-help" tabIndex={0} aria-label={`${label}：${help}`}>
    <small>{label}</small><i aria-hidden="true">?</i><span role="tooltip">{help}</span>
  </span>;
}

export function GeneratorEditorPanel({ id, data, composer }: { id: string; data: CanvasNodeData; composer?: GeneratorComposerOptions }) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showSpecMenu, setShowSpecMenu] = useState(false);
  const [showVideoInputMenu, setShowVideoInputMenu] = useState(false);
  const [showH3Guides, setShowH3Guides] = useState(false);
  const [h3GuideCandidate, setH3GuideCandidate] = useState('');
  const [h3GuideDraftTime, setH3GuideDraftTime] = useState(1);
  const popoverRegionRef = useRef<HTMLDivElement>(null);
  const [showImageMentions, setShowImageMentions] = useState(false);
  useGeneratorPopoverDismiss(popoverRegionRef, showModelMenu || showSpecMenu || showVideoInputMenu, () => {
    setShowModelMenu(false);
    setShowSpecMenu(false);
    setShowVideoInputMenu(false);
  });
  const capability = generatorCapability(data.kind);
  const modelControlIcon: UiIconName = capability === 'video' ? 'videoGenerate' : capability === 'audio' ? 'audioGenerate' : capability === 'model' ? 'model3d' : 'imageGenerate';
  const panelDockLabel = data.generatorPanelDock === 'top' ? '上方'
    : data.generatorPanelDock === 'left' ? '左侧'
      : data.generatorPanelDock === 'right' ? '右侧'
        : '下方';
  const busy = data.jobState === 'queued' || data.jobState === 'running' || data.jobState === 'cancelling';
  const runningCannotCancel = capability !== 'video' && data.jobState === 'running';
  const canCancel = (busy || Boolean(data.jobPollLost)) && !runningCannotCancel;
  const models = (data.models || []).filter((model) => model.capability === capability
    && (data.kind === 'comfyUiWorkflow'
      ? model.workflows?.some((workflow) => workflow.capability === 'image' && workflow.editor === 'native') || model.workflow?.capability === 'image' && model.workflow.editor === 'native'
      : !(data.kind === 'imageGenerator' && ['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(model.adapter || ''))));
  const selectedModel = models.find((model) => model.id === data.modelId) || models[0];
  const isLocalH3 = selectedModel?.adapter === 'comfyui-minimax-h3';
  const localQueue = data.jobState === 'queued' && data.localQueue ? data.localQueue : selectedModel?.localQueueStatus;
  const localOffline = Boolean(isLocalH3 && localQueue && !localQueue.available);
  const localDirectCanStart = Boolean(localOffline && localQueue?.mode === 'direct' && localQueue.autoStart);
  const localMachineBusy = Boolean(isLocalH3 && localQueue?.available && (localQueue.running > 0 || localQueue.queued > 0));
  const localQueueLabel = localQueue ? localQueueWaitLabel(localQueue.estimatedWaitSeconds) : '';
  const generatorStatusLabel = busy
    ? data.cancelling ? '正在取消' : data.jobState === 'queued' ? `本机排队中${data.localQueue ? ` · 前方 ${data.localQueue.ahead} 个 · ${localQueueWaitLabel(data.localQueue.estimatedWaitSeconds)}` : ''}` : '生成中'
    : localDirectCanStart ? 'H3 未启动 · 点击生成自动启动'
      : localOffline ? 'H3 生成机离线'
        : isLocalH3 && localQueue?.state === 'idle' ? '本机空闲'
          : data.jobState === 'paused' ? '远端任务已暂停'
            : data.jobState === 'failed' ? (data.jobPollLost ? '状态查询中断' : '生成失败')
              : data.status || '就绪';
  const storedPromptReferences = data.inputReferences || [];
  const promptReferences = capability === 'image' ? canonicalizeImageReferenceDisplay(storedPromptReferences) : storedPromptReferences;
  const displayData = capability === 'image' ? { ...data, inputReferences: promptReferences } : data;
  const promptReferenceSignature = promptReferences.map((reference) => `${reference.edgeId}:${reference.port}:${reference.type}:${reference.token}:${reference.displayToken || ''}:${reference.referenceRole || ''}:${reference.mediaUrl || ''}:${reference.text || ''}`).join('|');
  const tripoInputMode = data.modelInputMode || 'text';
  const promptPresetsAvailable = capability !== 'audio' && (capability !== 'model' || tripoInputMode === 'text');
  const selectedPromptTokens = capability === 'audio'
    ? { positive: [] as PromptTokenSelectionTag[], negative: [] as PromptTokenSelectionTag[] }
    : partitionPromptTokenSelectionTags(resolvePromptTokenSelectionTags(selectedModel?.adapter, data.promptTokenIds, data.negativePromptTokenIds, capability, selectedModel?.localImageFamily));
  const fallbackProfile: GenerationProfile = capability === 'image'
    ? { ratios: ['Auto', '1:1', '16:9', '21:9', '9:16', '4:3', '3:4'], resolutions: ['1K', '4K'], defaultRatio: 'Auto', defaultResolution: '1K', count: { min: 1, max: 4, default: 1 }, duration: { min: 5, max: 5, default: 5 }, audio: false, audioInput: false }
    : capability === 'video'
      ? { ratios: ['Auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], resolutions: ['480P', '720P', '1080P', '4K'], defaultRatio: 'Auto', defaultResolution: '720P', count: { min: 1, max: 1, default: 1 }, duration: { min: 4, max: 15, default: 5 }, audio: true, audioInput: false }
      : capability === 'audio'
        ? { ratios: ['Auto'], resolutions: ['WAV'], defaultRatio: 'Auto', defaultResolution: 'WAV', count: { min: 1, max: 1, default: 1 }, duration: { min: 1, max: 1, default: 1 }, audio: true, audioInput: true }
      : { ratios: ['Auto'], resolutions: ['STANDARD', 'DETAILED'], defaultRatio: 'Auto', defaultResolution: 'STANDARD', count: { min: 1, max: 1, default: 1 }, duration: { min: 1, max: 1, default: 1 }, audio: false, audioInput: false };
  const profile = selectedModel?.profile || fallbackProfile;
  const nativeCinemaModel = capability === 'image'
    ? models.find((model) => model.id !== selectedModel?.id && model.profile?.ratios.includes('21:9'))
    : undefined;
  const isSeedance = selectedModel?.adapter === 'seedance-video';
  const isLocalH3Spec = selectedModel?.adapter === 'comfyui-minimax-h3';
  const selectedRatio = data.ratio && profile.ratios.includes(data.ratio) ? data.ratio : (selectedModel?.defaults?.ratio || profile.defaultRatio);
  const unsupportedStoredRatio = Boolean(data.ratio && data.ratio !== 'Auto' && !profile.ratios.includes(data.ratio));
  const selectedResolution = data.resolution && profile.resolutions.includes(data.resolution.toUpperCase()) ? data.resolution.toUpperCase() : (selectedModel?.defaults?.resolution || profile.defaultResolution);
  const selectedDuration = Math.min(profile.duration.max, Math.max(profile.duration.min, Number(data.duration || profile.duration.default)));
  const resolutionOptions = profile.resolutions;
  const ratioOptions = profile.ratios;
  const countOptions = Array.from({ length: profile.count.max - profile.count.min + 1 }, (_, index) => profile.count.min + index);
  const specSummary = capability === 'video'
    ? `${selectedRatio} · ${selectedResolution}${isLocalH3Spec ? '（约1MP）· 24fps' : ''} · ${selectedDuration} 秒${profile.audio ? (data.audioEnabled === false ? ' · 无音频' : ' · 含音频') : ''}`
    : capability === 'audio'
      ? `${selectedModel?.audioOptions?.languages?.find((item) => item.id === (data.audioLanguage || 'zh'))?.label || '中文'} · ${Number(data.audioSpeed || selectedModel?.audioOptions?.speed?.default || 1).toFixed(1)}× · WAV`
    : capability === 'model'
      ? `${tripoModelInputLabel(data.modelInputMode)} · ${tripoModelPresetLabel(resolvedTripoModelPreset(data))}`
      : `${selectedRatio} · ${selectedResolution} · ${data.count || profile.count.default} 张`;
  const hasVideoInput = (data.inputReferences || []).some((reference) => reference.type === 'video');
  const videoInputMode: VideoInputMode = data.videoInputMode === 'first' ? 'first' : data.videoInputMode === 'first_last' ? 'first_last' : 'reference';
  const materialReferences = (data.inputReferences || []).filter((reference) => reference.port === 'material');
  const materialImages = materialReferences.filter((reference) => reference.type === 'image');
  const hasReferenceMedia = materialReferences.some((reference) => reference.type === 'video' || reference.type === 'audio');
  const videoInputModeLabel = videoInputMode === 'first' ? '单首帧' : videoInputMode === 'first_last' ? '首帧＋尾帧' : '全能参考';
  const h3GuideReferences = promptReferences.filter((reference) => ['image', 'video', 'audio'].includes(reference.type));
  const activeH3Guides = h3GuideReferences.filter((reference) => Number.isFinite(Number(data.h3GuideTimes?.[reference.edgeId])));
  const availableH3GuideReferences = h3GuideReferences.filter((reference) => !activeH3Guides.some((active) => active.edgeId === reference.edgeId));
  const selectedH3Mode = videoInputMode !== 'reference' && ['reference8', 'community8'].includes(data.h3AccelerationMode || '') ? 'standard' : (data.h3AccelerationMode || 'standard');
  const h3ModeOptions = h3GenerationModesForInput(videoInputMode, Boolean(data.publicMode));
  const modeHint = videoInputMode === 'first'
    ? hasReferenceMedia ? '单首帧仅支持图片，请移除视频或音频素材' : materialImages.length !== 1 ? '单首帧需要恰好一张图片' : '当前图片将作为首帧'
    : videoInputMode === 'first_last'
      ? hasReferenceMedia ? '首帧＋尾帧仅支持图片，请移除视频或音频素材' : materialImages.length !== 2 ? '首帧＋尾帧需要恰好两张图片，接入顺序为首帧→尾帧' : '第 1 张为首帧，第 2 张为尾帧'
      : !hasReferenceMedia && materialImages.length === 1 ? '检测到一张图片，可切换为单首帧模式' : !hasReferenceMedia && materialImages.length === 2 ? '检测到两张图片，可切换为首帧＋尾帧模式' : '图片、视频、音频均作为参考素材';
  const submissionServiceLabel = isLocalH3 || selectedModel?.adapter?.startsWith('comfyui-')
    ? '本机模型服务'
    : capability === 'audio' && selectedModel?.adapter === 'gpt-sovits-audio'
      ? '本机语音服务'
      : '使用你配置的模型服务';
  const latestOutputs = data.latestOutputs || [];
  const latestMediaType = data.latestMediaType || capability;
  const firstLatest = latestOutputs.find((output) => output.mediaUrl);
  const h3GenerationDuration = isLocalH3Spec ? formatGenerationDuration(firstLatest?.generationDurationMs) : '';
  const h3TotalDuration = isLocalH3Spec ? formatGenerationDuration(firstLatest?.totalDurationMs) : '';
  const imageFromClipboard = (clipboard: DataTransfer | null) => {
    if (!clipboard) return null;
    return Array.from(clipboard.files).find((file) => file.type.startsWith('image/')) || Array.from(clipboard.items).find((item) => item.type.startsWith('image/'))?.getAsFile() || null;
  };
  useEffect(() => {
    const captureImagePaste = (event: globalThis.ClipboardEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('prompt-input')) return;
      const image = imageFromClipboard(event.clipboardData);
      if (!image) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      data.onPasteImageReference(id, image);
    };
    document.addEventListener('paste', captureImagePaste, true);
    return () => document.removeEventListener('paste', captureImagePaste, true);
  }, [data, id]);
  useEffect(() => {
    if (!data.prompt) return;
    const nextPrompt = reconcilePromptReferenceAliases(data.prompt, promptReferences);
    if (nextPrompt !== data.prompt) data.onChange(id, { prompt: nextPrompt });
  }, [id, promptReferenceSignature]);
  useEffect(() => {
    const current = data.h3GuideTimes || {};
    const validEdges = new Set(h3GuideReferences.map((reference) => reference.edgeId));
    const cleaned = Object.fromEntries(Object.entries(current).filter(([edgeId]) => validEdges.has(edgeId)));
    if (Object.keys(cleaned).length !== Object.keys(current).length) data.onChange(id, { h3GuideTimes: cleaned });
  }, [id, promptReferenceSignature]);
  const header = <div className="generator-panel-quickbar">
      <button type="button" className="generator-panel-kind generator-panel-drag-handle" aria-label={`拖动生成面板，当前停靠在预览节点${panelDockLabel}`} title="拖动并停靠到预览节点上、下、左、右侧" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); data.onBeginGeneratorPanelDockDrag?.(id, { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY }); }}><b aria-hidden="true">⠿</b><span>{capability === 'image' ? '图片生成' : capability === 'video' ? '视频生成' : capability === 'audio' ? '音频生成' : '3D 模型生成'}</span><small>{data.generatorPanelDockDragging ? `松开停靠${panelDockLabel}` : `${panelDockLabel}停靠`}</small></button>
      <InputReferences id={id} data={displayData} compact />
      <div className={`node-status generator-panel-head-status status-${data.jobState || 'idle'} ${data.jobState === 'failed' || data.jobState === 'paused' ? 'generator-failure-status' : ''}`} role="status" title={generatorStatusLabel}><span className="status-dot" /><span className="generator-status-label">{generatorStatusLabel}</span>{busy && <GenerationTimer startedAt={data.jobStartedAt} />}</div>
    </div>;
  const prompt = capability === 'model' && tripoInputMode !== 'text'
      ? <TripoImageWorkflowNotice id={id} data={data} mode={tripoInputMode} references={data.inputReferences || []} />
      : <div className="generator-prompt-composer nodrag nowheel">
          <PromptInlineEditor
            id={id}
            data={data}
            references={promptReferences}
            showMentions={showImageMentions}
            onShowMentions={setShowImageMentions}
            onPasteImage={imageFromClipboard}
            inlinePresetTokens={selectedPromptTokens.positive}
            managedPresetScopes={['positive']}
            preset={promptPresetsAvailable && (!composer || composer.presetsOpen) ? (onTokenToggle) => <PromptTokenComposer
              layout="toolcard"
              persistenceKey={`${capability}-generator:${id}`}
              adapter={selectedModel?.adapter}
              modelFamily={selectedModel?.localImageFamily}
              target={capability}
              manualPrompt={data.prompt || ''}
              promptTokenIds={data.promptTokenIds}
              negativePromptTokenIds={data.negativePromptTokenIds}
              onTokenToggle={(token, selected) => { if (token.scope === 'positive') onTokenToggle(token, selected); }}
              onChange={(patch) => data.onChange(id, patch)}
            /> : undefined}
          />
          {supportsNegativePromptTokens(selectedModel?.adapter) && <NegativePromptTokenTray tokens={selectedPromptTokens.negative} onRemove={(tokenId) => data.onChange(id, { negativePromptTokenIds: (data.negativePromptTokenIds || []).filter((candidate) => candidate !== tokenId) })} />}
        </div>;
  const delivery = firstLatest?.mediaUrl && data.publicMode && <div className="generator-panel-output-bar nodrag" aria-label="生成结果操作">
      <strong>生成结果</strong>
      <MediaDeliveryActions mediaUrl={firstLatest.mediaUrl} fileName={firstLatest.fileName} nodeTitle={data.title} mediaType={latestMediaType} previewUrl={firstLatest.previewUrl} />
    </div>;
  const controls = <div ref={popoverRegionRef} className="generator-run-controls">
        <div className="generator-popover-anchor"><button type="button" className="generator-control-button generator-control-card generator-model-button" aria-label="切换生成模型" aria-expanded={showModelMenu} onClick={() => { setShowModelMenu((value) => !value); setShowSpecMenu(false); setShowVideoInputMenu(false); }}><GeneratorControlCardContent icon={modelControlIcon} label="模型" value={selectedModel?.name || '选择模型'} expanded={showModelMenu} /></button>{showModelMenu && <div className="generator-popover generator-model-menu">{models.map((model) => <button key={model.id} className={model.id === (selectedModel?.id || data.modelId) ? 'active' : ''} onClick={() => { const p1 = isTripoP1(model); data.onChange(id, { ...compatibleGeneratorSettings(model, data.ratio, data.resolution, data.duration), ...(model.capability === 'model' && p1 ? { geometryQuality: 'standard', resolution: 'STANDARD', quad: false, smartLowPoly: false, generateParts: false } : {}) }); setShowModelMenu(false); }}><strong>{model.name}</strong><small>{model.capability === 'image' ? '图片生成模型' : model.capability === 'video' ? '视频生成模型' : model.capability === 'audio' ? '本地语音模型' : tripoModelFamilyLabel(model)}</small></button>)}</div>}</div>
        {capability === 'video' && <div className="generator-popover-anchor generator-input-mode-anchor">
          <button type="button" className="generator-control-button generator-control-card generator-input-mode-button" aria-label="切换视频输入方式" aria-expanded={showVideoInputMenu} title={modeHint} onClick={() => { setShowVideoInputMenu((value) => !value); setShowModelMenu(false); setShowSpecMenu(false); }}><GeneratorControlCardContent icon="link" label="输入方式" value={videoInputModeLabel} expanded={showVideoInputMenu} /></button>
          {showVideoInputMenu && <div className="generator-popover generator-input-mode-menu" role="menu">
            {([
              ['reference', '全能参考', '图片、视频、音频作为参考素材'],
              ['first', '单首帧', '需要连接 1 张图片'],
              ['first_last', '首帧＋尾帧', '按连接顺序需要 2 张图片'],
            ] as const).map(([mode, label, description]) => <button type="button" role="menuitemradio" aria-checked={videoInputMode === mode} aria-label={`${label}：${description}`} key={mode} className={videoInputMode === mode ? 'active' : ''} onClick={() => { data.onChange(id, { videoInputMode: mode, ...(mode !== 'reference' ? { h3GuideTimes: {}, h3BlockCache: false } : {}), ...(mode !== 'reference' && ['reference8', 'community8'].includes(data.h3AccelerationMode || '') ? { h3AccelerationMode: 'standard' as const, h3SamplingSteps: 20 } : {}) }); setShowVideoInputMenu(false); }}><strong>{label}</strong><i className="generator-option-help" aria-hidden="true">?</i><span className="generator-option-tooltip" role="tooltip">{description}</span></button>)}
          </div>}
        </div>}
        <div className="generator-popover-anchor">
          <button type="button" className="generator-control-button generator-control-card generator-spec-button" aria-label={capability === 'audio' ? '设置声音' : '设置生成规格'} aria-expanded={showSpecMenu} onClick={() => { setShowSpecMenu((value) => !value); setShowModelMenu(false); setShowVideoInputMenu(false); }}><GeneratorControlCardContent icon={capability === 'audio' ? 'audio' : 'crop'} label={capability === 'audio' ? '声音' : '规格'} value={specSummary} expanded={showSpecMenu} /></button>
          {showSpecMenu && <div className={`generator-popover generator-spec-menu ${capability === 'model' ? 'tripo-spec-menu' : ''}`}>
            {selectedModel?.adapter === 'openai-image' && profile.ratios.includes('21:9') && selectedRatio === '21:9' && <p className="generator-input-mode-hint" data-no-interface-translation>{promptPresetChipLanguageForElement() === 'en' ? `Native 21:9 · ${gptImageSize(selectedRatio, selectedResolution)} px. No crop or padding. 4K is a resolution tier; high-resolution output is experimental. Relay support may vary.` : `原生 21:9 · ${gptImageSize(selectedRatio, selectedResolution)} 像素，不裁切、不补边。4K 为分辨率档位，高分辨率输出为实验能力；中转接口需支持自定义尺寸。`}</p>}
            {capability !== 'model' && capability !== 'audio' && <div><small>比例</small><section>{ratioOptions.map((option) => <button key={option} className={`generator-ratio-option${selectedRatio === option ? ' active' : ''}`} aria-label={`比例 ${option}`} aria-pressed={selectedRatio === option} onClick={() => data.onChange(id, { ratio: option })}><GenerationRatioOption ratio={option} /></button>)}</section></div>}
            {capability === 'image' && !profile.ratios.includes('21:9') && <div><small>21:9 超宽画幅</small><p className="generator-input-mode-hint">当前模型连接未开放 21:9；不会自动裁切、补边或切换模型。</p>{nativeCinemaModel && <section><button type="button" onClick={() => { data.onChange(id, { modelId: nativeCinemaModel.id, ratio: '21:9' }); setShowSpecMenu(false); }}>切换到 {nativeCinemaModel.name}</button></section>}</div>}
            {capability !== 'model' && capability !== 'audio' && <div><small>分辨率</small><section>{resolutionOptions.map((option) => <button key={option} className={selectedResolution === option ? 'active' : ''} onClick={() => data.onChange(id, { resolution: option })}>{option}</button>)}</section></div>}
            {selectedModel?.adapter === 'openai-image' && <div><small>图像质量 · 与分辨率独立</small><section>{(['auto', 'low', 'medium', 'high'] as const).map(option => <button key={option} className={(data.imageQuality || 'auto') === option ? 'active' : ''} onClick={() => data.onChange(id, { imageQuality: option })}>{({ auto: '自动', low: '快速草稿', medium: '均衡', high: '高质量' })[option]}</button>)}</section></div>}
            {capability === 'audio' && <>
              <div><small>朗读语言</small><section>{(selectedModel?.audioOptions?.languages || [{ id: 'zh' as const, label: '中文' }, { id: 'ja' as const, label: '日语' }, { id: 'en' as const, label: '英语' }]).map((option) => <button key={option.id} className={(data.audioLanguage || 'zh') === option.id ? 'active' : ''} onClick={() => data.onChange(id, { audioLanguage: option.id })}>{option.label}</button>)}</section></div>
              <div className="generator-video-spec generator-duration-slider"><div><small>语速</small><strong>{Number(data.audioSpeed || selectedModel?.audioOptions?.speed?.default || 1).toFixed(1)}×</strong></div><section><span>慢</span><input className="nodrag nowheel" type="range" min={selectedModel?.audioOptions?.speed?.min || .5} max={selectedModel?.audioOptions?.speed?.max || 2} step="0.05" value={data.audioSpeed || selectedModel?.audioOptions?.speed?.default || 1} aria-label="语速" onPointerDown={(event) => event.stopPropagation()} onChange={(event) => data.onChange(id, { audioSpeed: Number(event.currentTarget.value) })} /><span>快</span></section></div>
              <label className="generator-audio-reference-text"><small>参考音频说了什么</small><textarea className="nodrag nowheel" value={data.audioReferenceText || ''} placeholder="连接参考音频时填写原句；内置音色可留空" onChange={(event) => data.onChange(id, { audioReferenceText: event.currentTarget.value })} /></label>
              <div className="generator-audio-library-status"><small>角色音色库</small>{(selectedModel?.audioOptions?.voiceLibraries || []).map((library) => <span key={library.id} className={library.installed ? 'is-installed' : ''}><i />{library.label}<b>{library.installed ? `${library.voiceCount || ''} 可用` : '未安装'}</b></span>)}</div>
            </>}
            {capability === 'video' && profile.outputFormats && <div><small>输出格式</small><section>{profile.outputFormats.map((option) => <button key={option} className={(data.outputFormat || 'mp4') === option ? 'active' : ''} onClick={() => data.onChange(id, { outputFormat: option })}>{option.toUpperCase()}</button>)}</section></div>}
            {capability === 'model' && <TripoModelControls id={id} data={data} model={selectedModel} />}
            {capability === 'image' && <div><small>数量</small><section>{countOptions.map((option) => <button key={option} className={(data.count || profile.count.default) === option ? 'active' : ''} onClick={() => { data.onChange(id, { count: option }); setShowSpecMenu(false); }}>{option} 张</button>)}</section></div>}
            {capability === 'video' && <>
              <div className="generator-video-spec generator-duration-slider"><div><small>时长</small><strong>{selectedDuration} 秒</strong></div><section><span>{profile.duration.min} 秒</span><input className="nodrag nowheel" type="range" min={profile.duration.min} max={profile.duration.max} step="1" value={selectedDuration} aria-label="视频时长" onPointerDown={(event) => event.stopPropagation()} onChange={(event) => { const duration = Number(event.currentTarget.value); const h3GuideTimes = Object.fromEntries(Object.entries(data.h3GuideTimes || {}).map(([edgeId, seconds]) => [edgeId, Math.min(duration, Number(seconds))])); data.onChange(id, { duration, h3GuideTimes }); }} /><span>{profile.duration.max} 秒</span></section></div>
              {profile.audio && <div className="generator-video-spec"><small>音频</small><section><button className={data.audioEnabled === false ? '' : 'active'} onClick={() => data.onChange(id, { audioEnabled: true })}>含音频</button><button className={data.audioEnabled === false ? 'active' : ''} onClick={() => data.onChange(id, { audioEnabled: false })}>无音频</button></section></div>}
              {isLocalH3Spec && videoInputMode === 'reference' && <div className="generator-video-spec"><SpecHelpLabel label="参考图精度" help="匹配画布会缩放到约 1MP；最高一致性尽量保留原图细节，但会增加显存和耗时。" /><section><button className={data.refImageSize === 'max' ? '' : 'active'} onClick={() => data.onChange(id, { refImageSize: 'match' })}>匹配画布</button><button className={data.refImageSize === 'max' ? 'active' : ''} onClick={() => data.onChange(id, { refImageSize: 'max' })}>最高一致性</button></section></div>}
              {isLocalH3Spec && videoInputMode === 'reference' && hasVideoInput && <div className="generator-video-spec"><SpecHelpLabel label="参考视频原声" help="保留原声只为实际含音轨的视频建立音频标签；静音视频不会占用音频编号。" /><section><button className={data.referenceVideoAudio === false ? '' : 'active'} onClick={() => data.onChange(id, { referenceVideoAudio: true })}>保留原声</button><button className={data.referenceVideoAudio === false ? 'active' : ''} onClick={() => data.onChange(id, { referenceVideoAudio: false })}>仅参考画面</button></section></div>}
              {isLocalH3Spec && <div className="generator-video-spec generator-h3-seed"><SpecHelpLabel label="Seed" help={firstLatest?.seed !== undefined ? `留空时每次随机；填写后可复现相近结果。上次实际 Seed：${firstLatest.seed}` : '留空时每次生成随机 Seed；填写后可复现相近结果。'} /><section><input className="nodrag nowheel" type="number" min="0" max="4294967295" step="1" value={data.seed ?? ''} placeholder="随机" aria-label="H3 Seed" onChange={(event) => data.onChange(id, { seed: event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value) })} /><button type="button" onClick={() => data.onChange(id, { seed: undefined })}>随机</button>{firstLatest?.seed !== undefined && <button type="button" onClick={() => data.onChange(id, { seed: firstLatest.seed })}>复用 {firstLatest.seed}</button>}</section></div>}
              {isLocalH3Spec && <div className="generator-video-spec"><SpecHelpLabel label="生成模式" help={videoInputMode === 'reference' ? '已按全能参考输入筛选；首帧专属模式不会显示。' : `已按${videoInputModeLabel}筛选；全能参考专属模式不会显示。`} /><section>{h3ModeOptions.map((option) => <button key={option.id} className={selectedH3Mode === option.id ? 'active' : ''} onClick={() => data.onChange(id, { h3AccelerationMode: option.id, ...(option.id !== 'standard' ? { h3SamplingSteps: 20, h3BlockCache: false } : {}), ...(option.id === 'community8' ? { duration: Math.min(selectedDuration, 15) } : {}) })}>{option.label}</button>)}</section></div>}
              {isLocalH3Spec && <div className="generator-video-spec"><SpecHelpLabel label="编码预设" help="高画质 / 均衡 / 小文件使用 8-bit H.264；10-bit 高画质使用 yuv420p10le，减少渐变和暗部色带。" /><section><button className={(data.h3EncodingPreset || 'balanced') === 'quality' ? 'active' : ''} onClick={() => data.onChange(id, { h3EncodingPreset: 'quality' })}>高画质</button><button className={(data.h3EncodingPreset || 'balanced') === 'balanced' ? 'active' : ''} onClick={() => data.onChange(id, { h3EncodingPreset: 'balanced' })}>均衡</button><button className={(data.h3EncodingPreset || 'balanced') === 'compact' ? 'active' : ''} onClick={() => data.onChange(id, { h3EncodingPreset: 'compact' })}>小文件</button><button className={data.h3EncodingPreset === 'quality10' ? 'active' : ''} onClick={() => data.onChange(id, { h3EncodingPreset: 'quality10' })}>10-bit</button></section></div>}
              {isLocalH3Spec && !data.publicMode && (data.h3AccelerationMode || 'standard') === 'standard' && <div className="generator-video-spec"><SpecHelpLabel label="采样步数" help="可在 20、24、28 步间选择；其余设置保持一致，便于比较画面质量。" /><section>{([20, 24, 28] as const).map((steps) => <button key={steps} className={(data.h3SamplingSteps || 20) === steps ? 'active' : ''} onClick={() => data.onChange(id, { h3SamplingSteps: steps })}>{steps}步</button>)}</section></div>}
              {isLocalH3Spec && videoInputMode === 'reference' && !data.publicMode && (data.h3AccelerationMode || 'standard') === 'standard' && <div className="generator-video-spec"><SpecHelpLabel label="生成加速" help="关闭时使用完整生成；Balanced 可缩短等待时间，并优先保持画面质量。" /><section><button className={data.h3BlockCache ? '' : 'active'} onClick={() => data.onChange(id, { h3BlockCache: false })}>关闭</button><button className={data.h3BlockCache ? 'active' : ''} onClick={() => data.onChange(id, { h3BlockCache: true })}>Balanced</button></section></div>}
              {isLocalH3Spec && selectedModel?.managed !== true && !data.publicMode && <div className="generator-video-spec"><SpecHelpLabel label="生成后修复小脸" help="对生成结果中面积较小的主要人脸做一次局部 H3 修复，会增加生成时间；关闭时不执行二次处理。" /><section><button className={data.h3FaceRefine ? '' : 'active'} onClick={() => data.onChange(id, { h3FaceRefine: false })}>关闭</button><button className={data.h3FaceRefine ? 'active' : ''} onClick={() => data.onChange(id, { h3FaceRefine: true })}>开启</button></section></div>}
              {isLocalH3Spec && videoInputMode === 'reference' && !data.publicMode && h3GuideReferences.length > 0 && <div className={`generator-video-spec generator-h3-guides${showH3Guides ? ' is-open' : ''}`}><SpecHelpLabel label="时间锚点" help="可选高级功能：让指定素材在某一秒成为强参考。例如“图片3 → 4秒”表示第4秒重点匹配图片3。普通生成不需要设置。" /><section><button className={activeH3Guides.length ? 'active' : ''} onClick={() => setShowH3Guides((value) => !value)}>{activeH3Guides.length ? `已设置 ${activeH3Guides.length} 个` : '未使用'}</button><button onClick={() => setShowH3Guides((value) => !value)}>{showH3Guides ? '收起' : '设置'}</button></section>{showH3Guides && <div className="generator-h3-guide-editor"><p>让某个素材在指定时间成为强参考；不设置时，所有素材都是普通参考。</p>{activeH3Guides.map((reference) => <label key={reference.edgeId}><span>{reference.token}</span><input className="nodrag nowheel" type="number" min="0" max={selectedDuration} step="0.1" value={data.h3GuideTimes?.[reference.edgeId] ?? 0} aria-label={`${reference.token} 时间锚点`} onChange={(event) => data.onChange(id, { h3GuideTimes: { ...(data.h3GuideTimes || {}), [reference.edgeId]: Math.min(selectedDuration, Math.max(0, Number(event.currentTarget.value))) } })} /><small>秒</small><button type="button" aria-label={`移除 ${reference.token} 时间锚点`} onClick={() => { const next = { ...(data.h3GuideTimes || {}) }; delete next[reference.edgeId]; data.onChange(id, { h3GuideTimes: next }); }}><UiIcon name="close" /></button></label>)}{availableH3GuideReferences.length > 0 && <div className="generator-h3-guide-add"><select className="nodrag nowheel" value={h3GuideCandidate} onChange={(event) => setH3GuideCandidate(event.currentTarget.value)}><option value="">选择素材</option>{availableH3GuideReferences.map((reference) => <option key={reference.edgeId} value={reference.edgeId}>{reference.token}</option>)}</select><input className="nodrag nowheel" type="number" min="0" max={selectedDuration} step="0.1" value={h3GuideDraftTime} aria-label="新时间锚点秒数" onChange={(event) => setH3GuideDraftTime(Math.min(selectedDuration, Math.max(0, Number(event.currentTarget.value))))} /><small>秒</small><button type="button" disabled={!h3GuideCandidate} onClick={() => { if (!h3GuideCandidate) return; data.onChange(id, { h3GuideTimes: { ...(data.h3GuideTimes || {}), [h3GuideCandidate]: h3GuideDraftTime } }); setH3GuideCandidate(''); }}>添加</button></div>}</div>}</div>}
              {isSeedance && profile.legacyArkOptions !== false && <div className="generator-video-spec"><small>镜头</small><section><button className={data.cameraFixed ? 'active' : ''} onClick={() => data.onChange(id, { cameraFixed: true })}>固定镜头</button><button className={data.cameraFixed ? '' : 'active'} onClick={() => data.onChange(id, { cameraFixed: false })}>自由运镜</button></section></div>}
            </>}
          </div>}
        </div>
      </div>;
  const feedback = ((!busy && h3GenerationDuration) || (!busy && firstLatest?.faceRefineWarning) || unsupportedStoredRatio) && <div className="generator-panel-feedback">
        {!busy && h3GenerationDuration && <span className="h3-generation-duration" title={h3TotalDuration && h3TotalDuration !== h3GenerationDuration ? `从提交到结果共 ${h3TotalDuration}` : undefined}>本次生成耗时 {h3GenerationDuration}{h3TotalDuration && h3TotalDuration !== h3GenerationDuration ? ` · 总计 ${h3TotalDuration}` : ''}</span>}
        {!busy && firstLatest?.faceRefineWarning && <span className="h3-face-refine-warning" title={firstLatest.faceRefineWarning}>小脸修复未完成，已保留原视频</span>}
        {unsupportedStoredRatio && <p className="generator-failure-message generator-ratio-warning" role="alert"><span>当前模型不支持原生 {data.ratio}。</span><button type="button" onClick={() => data.onChange(id, { ratio: selectedRatio, resolution: selectedResolution })}>改用 {selectedRatio} · {selectedResolution}</button></p>}
      </div>;
  const actions = <>
      <div className="run-actions"><button className="node-button primary generator-run-button" disabled={busy || !data.modelId || unsupportedStoredRatio || data.jobState === 'paused' || (localOffline && !localDirectCanStart)} onClick={() => data.onRun(id)}>{busy ? (data.cancelling ? '取消中…' : data.jobState === 'queued' ? '排队中…' : '生成中…') : <><span>{localDirectCanStart ? '启动 H3 并生成' : localOffline ? '生成机离线' : isLocalH3 && localMachineBusy ? '加入生成队列' : capability === 'video' ? '生成视频' : capability === 'audio' ? '生成音频' : capability === 'model' ? '生成 3D 模型' : `生成${Number(data.count || profile.count.default) > 1 ? ` ${data.count} 张` : ''}`}</span><small>{isLocalH3 ? localDirectCanStart ? '自动启动 ComfyUI · 就绪后提交' : localOffline ? '请启动 Windows 生成机' : localMachineBusy ? `前方 ${(localQueue?.running || 0) + (localQueue?.queued || 0)} 个 · ${localQueueLabel}` : '本机空闲 · 立即开始' : submissionServiceLabel}</small></>}</button>{canCancel && <button className="node-button" disabled={data.cancelling} onClick={() => data.onCancel(id)}>{data.cancelling ? '取消中' : '取消'}</button>}{data.jobState === 'paused' && capability === 'model' ? <><button className="node-button tripo-resume-button" onClick={() => data.onResume?.(id)}>恢复远端任务</button><button className="node-button tripo-paid-retry-button" onClick={() => data.onRetryPaid?.(id)}>新建远端任务</button></> : data.jobPollLost ? <button className="node-button" onClick={() => data.onRefreshJob(id)}>重新查询</button> : (data.jobState === 'failed' || data.jobState === 'cancelled') && (capability === 'model' ? <button className="node-button tripo-paid-retry-button" onClick={() => data.onRetryPaid?.(id)}>新建远端任务</button> : <button className="node-button" onClick={() => data.onRetry(id)}>重试</button>)}</div>
    </>;
  return <>
    <GeneratorEditorLayout composer={composer} header={header} prompt={prompt} delivery={delivery} controls={controls} feedback={feedback} actions={actions}
      cancelling={data.cancelling && <div className="generator-panel-cancelling" role="status"><i /><strong>正在终止生成任务</strong><span>已向生成服务发送取消请求，正在等待停止确认…</span></div>} />
    {(data.jobState === 'failed' || data.jobState === 'paused') && data.status && <p className="generator-failure-message" role="alert">{data.status}</p>}
  </>;
}

export function ComfyUiSamplingViewport({ id, data, modelName, workflowName, compact = false }: { id?: string; data: CanvasNodeData; modelName: string; workflowName: string; compact?: boolean }) {
  const busy = data.jobState === 'queued' || data.jobState === 'running' || data.jobState === 'cancelling';
  const finalOutputs = data.latestOutputs || [];
  const selectedOutputIndex = Math.min(data.selectedOutput || 0, Math.max(0, finalOutputs.length - 1));
  const finalImage = finalOutputs[selectedOutputIndex]?.mediaUrl
    ? finalOutputs[selectedOutputIndex]
    : finalOutputs.find((output) => output.mediaUrl);
  const preview = data.comfyPreview;
  const imageUrl = busy ? preview?.url : finalImage?.mediaUrl || preview?.url;
  const lodLevel = data.mediaLodLevel || 'high';
  const samplingPercent = preview?.steps ? Math.max(0, Math.min(100, Math.round((preview.step / preview.steps) * 100))) : Math.max(0, Math.min(100, Math.round(Number(data.progress) || 0)));
  const stageLabel = data.jobState === 'queued'
    ? '等待本机生成资源'
    : data.jobState === 'running'
      ? preview?.step ? `KSampler · ${preview.step} / ${preview.steps}` : '正在加载模型与工作流'
      : data.jobState === 'cancelling'
        ? '正在停止本地采样'
        : data.jobState === 'succeeded'
          ? `生成完成 · ${finalOutputs.length || 1} 张`
          : data.jobState === 'failed'
            ? '工作流执行失败 · 保留最后采样帧'
            : '本地工作流预览';
  return <section className={`comfyui-sampling-viewport nowheel is-${data.jobState || 'idle'}${imageUrl ? ' has-image' : ''}${compact ? ' is-compact' : ''}`} aria-label="ComfyUI 真实采样视口">
    {!compact && <>
    <header><div><span>LOCAL COMFYUI</span><strong>{modelName}</strong></div><small>{workflowName}</small></header>
    </>}
    <div className="comfyui-sampling-stage">
      {imageUrl ? (busy
        ? <img key={imageUrl} className={compact ? 'generator-latest-media node-media-surface' : 'node-media-surface'} src={imageUrl} draggable={false} decoding="async" alt="ComfyUI 实时采样预览" />
        : <CanvasLodImage className={compact ? 'generator-latest-media node-media-surface' : 'node-media-surface'} src={imageUrl} previewUrl={finalImage?.previewUrl} lodLevel={lodLevel} alt="ComfyUI 最终生成结果" onLoad={(image) => {
          if (id && finalImage?.mediaUrl === imageUrl && (!finalImage?.width || !finalImage?.height)) data.onMediaSize?.(id, image.naturalWidth, image.naturalHeight);
        }} />)
        : <EmptyNodeState icon="comfy" label={data.jobState === 'queued' ? '等待本机生成资源' : data.jobState === 'running' ? '等待首张采样预览' : '等待生成图片'} className="comfyui-sampling-placeholder" />}
      {compact && <span className="comfyui-sampling-sr-status" role="status" aria-live="polite">{stageLabel}{busy ? ` · ${samplingPercent}%` : ''}</span>}
      {compact && busy && <div className="comfyui-sampling-compact-progress" aria-label={`采样进度 ${samplingPercent}%`}><i style={{ width: `${samplingPercent}%` }} /></div>}
    </div>
    {!compact && <>
    <footer>
      <div><strong>{stageLabel}</strong><span>{preview?.outputIndex !== undefined ? `第 ${preview.outputIndex + 1} 张` : '本地 GPU'}{busy ? ` · ${samplingPercent}%` : ''}</span></div>
      <div className="comfyui-sampling-progress" aria-label={`采样进度 ${samplingPercent}%`}><i style={{ width: `${samplingPercent}%` }} /></div>
      {busy && <GenerationTimer startedAt={data.jobStartedAt} />}
    </footer>
    {!busy && finalOutputs.length > 1 && <div className="comfyui-sampling-gallery">{finalOutputs.map((output, index) => output.mediaUrl ? <img key={`${output.mediaUrl}-${index}`} src={canvasImagePreviewUrl(output.mediaUrl, output.previewUrl)} loading="lazy" decoding="async" draggable={false} alt={`ComfyUI 结果 ${index + 1}`} /> : null)}</div>}
    </>}
  </section>;
}

export function comfyUiActualSeeds(data: Pick<CanvasNodeData, 'jobState' | 'comfyPreview' | 'latestOutputs'>): number[] {
  const activeSeed = Number(data.comfyPreview?.seed);
  if (Number.isInteger(activeSeed) && activeSeed >= 0 && activeSeed <= 4294967295) return [activeSeed];
  if (data.jobState === 'queued' || data.jobState === 'running' || data.jobState === 'cancelling') return [];
  return [...new Set((data.latestOutputs || [])
    .map((output) => Number(output.seed))
    .filter((seed) => Number.isInteger(seed) && seed >= 0 && seed <= 4294967295))];
}

export type ComfyUiStyleChoice = {
  id: string;
  label: string;
  fileName: string;
  field: 'styleLora' | 'characterLora' | 'objectLora';
  previewUrl?: string;
};

export function comfyUiLoraDisplayName(fileName: string) {
  const displayName = String(fileName || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/\.(safetensors|ckpt|pt)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '未命名画风';
  if (/^XB KREA 2 TURBO CG(?: c\d+ st\d+)?$/i.test(displayName)) return 'CG 画风';
  return displayName;
}

export function comfyUiStyleChoices(model?: Pick<ModelInfo, 'loraCatalog'>): ComfyUiStyleChoice[] {
  const choices: ComfyUiStyleChoice[] = [];
  const seen = new Set<string>();
  const append = (names: string[]) => names.forEach((fileName) => {
    const normalized = String(fileName || '').trim();
    if (!normalized || seen.has(normalized.toLowerCase())) return;
    seen.add(normalized.toLowerCase());
    const presentation = model?.loraCatalog?.presentation?.[normalized];
    choices.push({
      id: `styleLora:${normalized}`,
      label: presentation?.label || comfyUiLoraDisplayName(normalized),
      fileName: normalized,
      field: 'styleLora',
      ...(presentation?.previewUrl ? { previewUrl: presentation.previewUrl } : {}),
    });
  });
  append(model?.loraCatalog?.style || []);
  return choices;
}

export function comfyUiModelHasStyleChoices(model?: Pick<ModelInfo, 'loraCatalog'>) {
  return comfyUiStyleChoices(model).length > 0;
}

export function comfyUiModelLoraChoices(model?: Pick<ModelInfo, 'adapter' | 'loraCatalog'>): ComfyUiStyleChoice[] {
  const adapter = model?.adapter;
  const choices = ['comfyui-illustrious', 'comfyui-native-image'].includes(adapter || '') ? comfyUiStyleChoices(model) : [];
  const categories: Array<['character' | 'object', 'characterLora' | 'objectLora']> = adapter === 'comfyui-illustrious'
    ? [['character', 'characterLora'], ['object', 'objectLora']]
    : adapter === 'comfyui-sdxl' ? [['character', 'characterLora']] : [];
  for (const [category, field] of categories) {
    const seen = new Set<string>();
    for (const value of model?.loraCatalog?.[category] || []) {
      const fileName = String(value || '').trim();
      if (!fileName || seen.has(fileName.toLowerCase())) continue;
      seen.add(fileName.toLowerCase());
      const presentation = model?.loraCatalog?.presentation?.[fileName];
      choices.push({ id: `${field}:${fileName}`, fileName, field, label: presentation?.label || comfyUiLoraDisplayName(fileName), ...(presentation?.previewUrl ? { previewUrl: presentation.previewUrl } : {}) });
    }
  }
  return choices;
}

export function comfyUiLoraSelectionPatch(choice: ComfyUiStyleChoice, data: Pick<CanvasNodeData, 'styleLora' | 'characterLora' | 'objectLora'>) {
  return { [choice.field]: data[choice.field] === choice.fileName ? '' : choice.fileName };
}

export function ComfyUiWorkflowPanel({ id, data, composer }: { id: string; data: CanvasNodeData; composer?: GeneratorComposerOptions }) {
  const [showImageMentions, setShowImageMentions] = useState(false);
  const [showPlanMenu, setShowPlanMenu] = useState(false);
  const [planMenuPlacement, setPlanMenuPlacement] = useState<'above' | 'below'>('above');
  const [planModelId, setPlanModelId] = useState('');
  const [showSpecMenu, setShowSpecMenu] = useState(false);
  const [showParameterMenu, setShowParameterMenu] = useState(false);
  const popoverRegionRef = useRef<HTMLDivElement>(null);
  useGeneratorPopoverDismiss(popoverRegionRef, showPlanMenu || showSpecMenu || showParameterMenu, () => {
    setShowPlanMenu(false);
    setShowSpecMenu(false);
    setShowParameterMenu(false);
  });
  const workflowChoices = (data.models || []).flatMap((model) => {
    const workflows = comfyUiGenerationWorkflows(model);
    return workflows.filter((workflow) => model.capability === 'image' && ['native', 'managed'].includes(workflow.editor))
      .map((workflow) => ({ model, workflow }));
  });
  const selectedChoice = workflowChoices.find((choice) => choice.model.id === data.modelId && choice.workflow.id === data.workflowId)
    || workflowChoices.find((choice) => choice.model.id === data.modelId)
    || workflowChoices[0];
  const localModels = workflowChoices.reduce<ModelInfo[]>((models, choice) => models.some((model) => model.id === choice.model.id) ? models : [...models, choice.model], []);
  const selectedModel = selectedChoice?.model;
  const selectedWorkflow = selectedChoice?.workflow;
  const selectedModelDisplayName = selectedModel ? localModelDisplayName(selectedModel.name) : '选择本地模型';
  const selectedStyleChoices = comfyUiModelLoraChoices(selectedModel);
  const selectedLoraLabels = selectedStyleChoices.filter((choice) => choice.fileName === data[choice.field]).map((choice) => choice.label);
  const selectedPlanDisplayName = selectedModel ? `${selectedModelDisplayName} · ${selectedLoraLabels.join(' + ') || '原生画风'}` : '选择大模型';
  const activePlanModelId = localModels.some((model) => model.id === planModelId) ? planModelId : '';
  const activePlanModel = localModels.find((model) => model.id === activePlanModelId);
  const activePlanStyleChoices = comfyUiModelLoraChoices(activePlanModel);
  const selectedPromptTokens = partitionPromptTokenSelectionTags(resolvePromptTokenSelectionTags(selectedModel?.adapter, data.promptTokenIds, data.negativePromptTokenIds, 'image', selectedModel?.localImageFamily));
  const selectedParameterBinding = comfyUiParameterBindingId(selectedModel?.id, selectedWorkflow?.id);
  useEffect(() => {
    if (!selectedModel || !selectedWorkflow || data.comfyParameterBinding === selectedParameterBinding) return;
    data.onChange(id, {
      ...comfyUiBindingDefaults(selectedModel, selectedWorkflow, data),
      status: `已同步当前模型参数：${selectedModel.name}`,
    });
  }, [data.comfyParameterBinding, data.onChange, data.ratio, data.resolution, id, selectedModel, selectedParameterBinding, selectedWorkflow]);
  const selectedResource = selectedModel?.localResource;
  const selectedResourceUnavailable = selectedResource?.state === 'missing' || selectedResource?.state === 'unloaded' || selectedResource?.state === 'offline';
  const selectedWorkflowBlockingReasons = comfyUiWorkflowBlockingReasons(selectedWorkflow);
  const selectedWorkflowBlocked = !comfyUiWorkflowIsSelectable(selectedWorkflow);
  const isManagedControl = selectedWorkflow?.editor === 'managed';
  const isGenericSdxl = selectedModel?.adapter === 'comfyui-sdxl';
  const isQwenImageEdit = selectedModel?.localImageFamily === 'qwen-image-edit-2511';
  const selectedControlPorts = (selectedWorkflow?.inputPorts || []).filter((port) => port.accepts.includes('image'));
  const selectedControlPortIds = new Set(selectedControlPorts.map((port) => port.id));
  const appearanceControl = selectedWorkflow?.appearanceControl;
  const appearancePort = selectedControlPorts.find((port) => ['identity', 'reference'].includes(port.id));
  const loraSlotIds = new Set((selectedWorkflow?.loraSlots || []).map((slot) => slot.id));
  const hasLoraSlots = loraSlotIds.size > 0;
  const profile = selectedModel?.profile || {
    ratios: ['3:4', '16:9', '21:9', '9:16', '4:3', '1:1'], resolutions: ['1K', '2K', '4K'], defaultRatio: '3:4', defaultResolution: '1K',
    count: { min: 1, max: 4, default: 1 }, duration: { min: 5, max: 5, default: 5 }, audio: false, audioInput: false,
  };
  const selectedResolution = profile.resolutions.includes(String(data.resolution || '').toUpperCase()) ? String(data.resolution).toUpperCase() : selectedModel?.defaults?.resolution || profile.defaultResolution;
  const references = canonicalizeImageReferenceDisplay(data.inputReferences || []);
  const connectedGenerationPorts = references
    .filter((reference) => reference.type === 'image' && (reference.port === 'identity' || reference.port === 'reference' || reference.port === 'pose'))
    .map((reference) => reference.port);
  const resolvedGenerationWorkflow = comfyUiWorkflowForGenerationContext(selectedModel, connectedGenerationPorts, selectedWorkflow?.id || '', selectedResolution);
  useEffect(() => {
    if (!selectedModel || !resolvedGenerationWorkflow || data.modelId !== selectedModel.id || data.workflowId === resolvedGenerationWorkflow.id) return;
    if (data.onSelectComfyUiWorkflow) data.onSelectComfyUiWorkflow(id, selectedModel.id, resolvedGenerationWorkflow.id);
    else data.onChange(id, { ...comfyUiBindingDefaults(selectedModel, resolvedGenerationWorkflow, data), status: '已按连接内容准备生成方式' });
  }, [data.modelId, data.onChange, data.onSelectComfyUiWorkflow, data.workflowId, id, resolvedGenerationWorkflow, selectedModel]);
  const missingRequiredControlPorts = selectedControlPorts.filter((port) => port.required && !references.some((reference) => reference.type === 'image' && reference.port === port.id));
  const imageReferenceCount = references.filter((reference) => reference.type === 'image').length;
  const isInPlaceEditWorkflow = Boolean(selectedWorkflow?.id?.toLowerCase().includes('inpaint')
    || selectedControlPorts.some((port) => port.bindingRole === 'mask' || port.id === 'mask'));
  const promptPlaceholder = isInPlaceEditWorkflow
    ? '说明要修改什么'
    : imageReferenceCount > 0
      ? '已有参考图，可不填；也可补充场景、服装或氛围'
      : '描述想要生成的内容';
  const displayData = { ...data, inputReferences: references };
  const selectedRatio = profile.ratios.includes(String(data.ratio || '')) ? String(data.ratio) : selectedModel?.defaults?.ratio || profile.defaultRatio;
  const selectedCount = Math.min(profile.count.max, Math.max(profile.count.min, Number(data.count || profile.count.default)));
  const comfySeedMode = data.comfySeedMode === 'fixed' ? 'fixed' : 'random';
  const actualSeeds = comfyUiActualSeeds(data);
  const actualSeedLabel = actualSeeds.length
    ? actualSeeds.join(' · ')
    : comfySeedMode === 'fixed'
      ? String(Number(data.seed ?? 42))
      : data.jobState === 'queued' || data.jobState === 'running'
        ? '正在分配…'
        : '生成时分配';
  const actualSeedTitle = data.jobState === 'queued' || data.jobState === 'running' || data.jobState === 'cancelling'
    ? '本次实际种子'
    : actualSeeds.length
      ? '上次实际种子'
      : '实际种子';
  const comfySteps = Math.max(1, Math.min(100, Number(data.comfySteps ?? selectedModel?.comfyDefaults?.steps) || 28));
  const comfyCfg = Math.max(1, Math.min(30, Number(data.comfyCfg ?? selectedModel?.comfyDefaults?.cfg) || 5.5));
  const comfySampler = String(data.comfySampler || selectedModel?.comfyDefaults?.sampler || 'dpmpp_2m_sde');
  const comfyScheduler = String(data.comfyScheduler || selectedModel?.comfyDefaults?.scheduler || 'karras');
  const comfyDenoise = Math.max(0.05, Math.min(1, Number(data.comfyDenoise ?? selectedModel?.comfyDefaults?.denoise) || 1));
  const samplingControls = effectiveComfyUiSamplingControls(selectedModel, selectedWorkflow);
  const advancedSamplingFields = samplingControls.advanced;
  const variationControl = samplingControls.variation;
  const variationEnabled = Boolean(variationControl && references.some((reference) => reference.type === 'image' && reference.port === variationControl.requiresImagePort));
  const samplerChoices = [...new Set([comfySampler, 'dpmpp_2m_sde', 'dpmpp_2m', 'euler_ancestral', 'euler'])];
  const schedulerChoices = [...new Set([comfyScheduler, 'karras', 'normal', 'simple', 'sgm_uniform'])];
  const variationDefault = Math.max(0.05, Math.min(1, Number(variationControl?.defaultValue) || 0.72));
  const selectedReferenceDenoise = Number.isFinite(Number(data.referenceDenoise))
    ? Math.max(0.05, Math.min(1, Number(data.referenceDenoise)))
    : variationDefault;
  const selectedVariationValue = variationControl?.field === 'comfyDenoise' ? comfyDenoise : selectedReferenceDenoise;
  const selectedVariationLabel = selectedVariationValue >= 0.95 ? '重做' : selectedVariationValue >= 0.8 ? '大改' : selectedVariationValue >= 0.66 ? '平衡' : selectedVariationValue >= 0.53 ? '小改' : '保留';
  const selectedVariationNumber = selectedVariationValue.toFixed(2);
  const runtimeSettingsLabel = comfyUiRuntimeSettingsLabel(selectedModel, selectedWorkflow, data, variationEnabled);
  const controlStrength = (value: number | undefined, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const identityStrength = controlStrength(data.identityStrength, selectedWorkflow?.controlDefaults?.identityStrength || 0.75);
  const proportionStrength = controlStrength(data.proportionStrength, selectedWorkflow?.controlDefaults?.proportionStrength || 0.45);
  const poseStrength = controlStrength(data.poseStrength, selectedWorkflow?.controlDefaults?.poseStrength || 0.85);
  const poseEstimator = data.poseEstimator === 'dwpose' ? 'dwpose' : 'sdpose';
  const lineartStrength = controlStrength(data.lineartStrength, selectedWorkflow?.controlDefaults?.lineartStrength || 0.7);
  const poseReference = references.find((reference) => reference.type === 'image' && reference.port === 'pose');
  const appearanceReference = appearancePort ? references.find((reference) => reference.type === 'image' && reference.port === appearancePort.id) : undefined;
  const poseFitNotice = poseReferenceFitNotice(poseReference, selectedRatio);
  const posePreviewCurrent = Boolean(poseReference?.mediaUrl
    && data.posePreviewUrl
    && data.posePreviewSourceUrl === poseReference.mediaUrl
    && data.posePreviewEstimator === poseEstimator
    && data.posePreviewRatio === selectedRatio);
  const posePreviewRunning = data.posePreviewState === 'running';
  const characterLoraStrength = controlStrength(data.characterLoraStrength, 0.8);
  const selectedHeadRatio = data.characterHeadRatio || 4;
  const selectedPose = data.characterPose || 'T-Pose';
  const connectedControlLabels = selectedControlPorts
    .filter((port) => references.some((reference) => reference.type === 'image' && reference.port === port.id))
    .map((port) => port.label);
  const busy = data.jobState === 'queued' || data.jobState === 'running' || data.jobState === 'cancelling';
  const imageFromClipboard = (clipboard: DataTransfer | null) => {
    if (!clipboard) return null;
    return Array.from(clipboard.files).find((file) => file.type.startsWith('image/'))
      || Array.from(clipboard.items).find((item) => item.type.startsWith('image/'))?.getAsFile()
      || null;
  };
  const stateLabel = data.jobState === 'queued' ? '工作流排队中'
    : data.jobState === 'running' ? 'ComfyUI 工作流执行中'
      : data.jobState === 'cancelling' ? '正在停止工作流'
        : data.jobState === 'succeeded' ? `已输出 ${data.latestOutputs?.length || 0} 张结果到当前预览节点`
          : data.jobState === 'failed' ? data.status || '工作流执行失败'
            : selectedResourceUnavailable
              ? selectedResource.message
              : selectedWorkflowBlocked
                ? selectedWorkflowBlockingReasons[0] || '当前生成方式依赖未就绪'
              : missingRequiredControlPorts.length
                ? `请接入${missingRequiredControlPorts.map((port) => port.id === 'identity' ? '角色参考' : port.id === 'pose' ? '动作迁移' : port.label).join('、')}`
              : selectedModel
              ? connectedControlLabels.length
                ? `已接入 ${connectedControlLabels.map((label) => label === '角色外观' ? '角色参考' : label === '动作姿势' ? '动作迁移' : label).join('、')}`
                : appearancePort?.required
                  ? '请接入角色参考'
                  : appearanceControl && appearanceControl.mode !== 'unsupported'
                    ? `可接入角色参考${selectedControlPortIds.has('pose') ? '或动作迁移' : ''}`
                : selectedControlPortIds.has('pose')
                  ? '可接入动作迁移'
                  : '可以开始画了'
              : '没有可用的本地生图模型';
  const panelDockLabel = data.generatorPanelDock === 'top' ? '上方'
    : data.generatorPanelDock === 'left' ? '左侧'
      : data.generatorPanelDock === 'right' ? '右侧'
        : '下方';
  const selectPlanModel = (model: ModelInfo) => {
    if (model.id === selectedModel?.id) { setPlanModelId(model.id); return; }
    const workflow = comfyUiWorkflowForGenerationContext(model, connectedGenerationPorts, '', selectedResolution);
    setPlanModelId(model.id);
    if (!workflow) return;
    if (data.onSelectComfyUiWorkflow) data.onSelectComfyUiWorkflow(id, model.id, workflow.id);
    else data.onChange(id, { ...comfyUiBindingDefaults(model, workflow, data), status: `已选择 ${localModelDisplayName(model.name)}` });
    data.onChange(id, { characterLora: '', styleLora: '', objectLora: '', status: `已选择 ${localModelDisplayName(model.name)} · 原生画风` });
    if (!comfyUiModelLoraChoices(model).length) {
      setShowPlanMenu(false);
      setPlanModelId('');
    }
  };
  const selectPlanStyle = (choice: ComfyUiStyleChoice) => {
    data.onChange(id, {
      ...comfyUiLoraSelectionPatch(choice, data),
      status: data[choice.field] === choice.fileName ? `已取消：${choice.label}` : `已选择：${choice.label}`,
    });
    setShowPlanMenu(false);
  };
  const selectResolution = (resolution: string) => {
    const workflow = comfyUiWorkflowForResolution(selectedModel, selectedWorkflow, resolution);
    if (selectedModel && workflow && workflow.id !== selectedWorkflow?.id) {
      if (data.onSelectComfyUiWorkflow) data.onSelectComfyUiWorkflow(id, selectedModel.id, workflow.id);
      else data.onChange(id, { ...comfyUiBindingDefaults(selectedModel, workflow, data), resolution, status: `已选择 ${resolution}` });
    }
    data.onChange(id, { resolution });
  };
  const resetRuntimeSettings = () => {
    const defaults = selectedModel?.comfyDefaults;
    const patch: Partial<CanvasNodeData> = { comfySeedMode: 'random', seed: undefined };
    if (advancedSamplingFields.includes('steps') && defaults) patch.comfySteps = defaults.steps;
    if (advancedSamplingFields.includes('cfg') && defaults) patch.comfyCfg = defaults.cfg;
    if (advancedSamplingFields.includes('sampler') && defaults) patch.comfySampler = defaults.sampler;
    if (advancedSamplingFields.includes('scheduler') && defaults) patch.comfyScheduler = defaults.scheduler;
    if (variationControl?.field === 'referenceDenoise') patch.referenceDenoise = variationDefault;
    if (variationControl?.field === 'comfyDenoise') patch.comfyDenoise = variationDefault;
    data.onChange(id, patch);
  };
  const header = <div className="generator-panel-quickbar">
        <button type="button" className="generator-panel-kind generator-panel-drag-handle" aria-label={`拖动提示词级联器，当前停靠在预览节点${panelDockLabel}`} title="拖动并停靠到预览节点上、下、左、右侧" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); data.onBeginGeneratorPanelDockDrag?.(id, { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY }); }}><b aria-hidden="true">⠿</b><span>ComfyUI 本地生图</span><small>{data.generatorPanelDockDragging ? `松开停靠${panelDockLabel}` : `${panelDockLabel}停靠`}</small></button>
        <InputReferences id={id} data={displayData} compact />
        <div className={`node-status generator-panel-head-status status-${data.jobState || 'idle'}`} role="status" title={stateLabel}><span className="status-dot" /><span className="generator-status-label">{stateLabel}</span>{busy && <GenerationTimer startedAt={data.jobStartedAt} />}</div>
    </div>;
  const prompt = <div className="comfyui-workflow-panel__prompt nodrag nowheel">
      <PromptInlineEditor
        id={id}
        data={data}
        references={references}
        placeholder={promptPlaceholder}
        showMentions={showImageMentions}
        onShowMentions={setShowImageMentions}
        onPasteImage={imageFromClipboard}
        inlinePresetTokens={selectedPromptTokens.positive}
        managedPresetScopes={['positive']}
        preset={!composer || composer.presetsOpen ? (onTokenToggle) => <PromptTokenComposer
          layout="toolcard"
          persistenceKey={`comfy-workflow:${id}`}
          adapter={selectedModel?.adapter}
          modelFamily={selectedModel?.localImageFamily}
          manualPrompt={data.prompt || ''}
          promptTokenIds={data.promptTokenIds}
          negativePromptTokenIds={data.negativePromptTokenIds}
          onTokenToggle={(token, selected) => { if (token.scope === 'positive') onTokenToggle(token, selected); }}
          onChange={(patch) => data.onChange(id, patch)}
        /> : undefined}
      />
      <NegativePromptTokenTray tokens={selectedPromptTokens.negative} onRemove={(tokenId) => data.onChange(id, { negativePromptTokenIds: (data.negativePromptTokenIds || []).filter((candidate) => candidate !== tokenId) })} />
    </div>;
  const controls = <div ref={popoverRegionRef} className="generator-run-controls comfyui-generator-controls">
        <div className="generator-popover-anchor">
          <button type="button" className="generator-control-button generator-control-card generator-model-button comfyui-control-card" aria-label={`选择大模型和画风，当前为${selectedPlanDisplayName}`} aria-expanded={showPlanMenu} onClick={(event) => {
            const nextOpen = !showPlanMenu;
            if (nextOpen && typeof window !== 'undefined') {
              const rect = event.currentTarget.getBoundingClientRect();
              const roomAbove = rect.top;
              const roomBelow = window.innerHeight - rect.bottom;
              setPlanMenuPlacement(roomBelow >= 440 || roomBelow > roomAbove ? 'below' : 'above');
            }
            setShowPlanMenu(nextOpen);
            setPlanModelId(nextOpen ? selectedModel?.id || '' : '');
            setShowSpecMenu(false);
            setShowParameterMenu(false);
          }}><GeneratorControlCardContent icon={selectedModel ? localModelPresentation(selectedModel).icon : 'imageGenerate'} label="大模型" value={selectedPlanDisplayName} expanded={showPlanMenu} /></button>
          {showPlanMenu && <div className={`generator-popover generator-spec-menu comfyui-workflow-menu comfyui-model-menu comfyui-plan-menu opens-${planMenuPlacement}`} aria-label="选择大模型">
            <div className="comfyui-plan-model-list">{localModels.map((model) => {
                  const presentation = localModelPresentation(model);
                  const resourceBlocked = ['missing', 'unloaded', 'offline'].includes(String(model.localResource?.state || ''));
                  const active = model.id === activePlanModelId;
                  return <button type="button" key={model.id} className={`comfyui-model-choice${active ? ' active' : ''}`} data-state={resourceBlocked ? 'error' : model.id === selectedModel?.id ? 'success' : 'idle'} aria-pressed={active} aria-label={`${localModelDisplayName(model.name)}。${resourceBlocked ? '这个模型还没准备好' : presentation.description}`} onClick={() => selectPlanModel(model)}>
                    <span className="comfyui-model-choice__icon"><UiIcon name={presentation.icon} /></span>
                    <span className="comfyui-model-choice__copy"><strong>{localModelDisplayName(model.name)}</strong><small>{presentation.description}</small></span>
                  </button>;
                })}</div>
            {activePlanModel && activePlanStyleChoices.length > 0 && <aside className="comfyui-plan-method-flyout comfyui-style-flyout" aria-label={`${localModelDisplayName(activePlanModel.name)}支持的画风`}>
              <header><strong>{activePlanStyleChoices.every((choice) => choice.field === 'styleLora') ? '画风' : 'LoRA'}</strong><small>{localModelDisplayName(activePlanModel.name)}</small></header>
              <div className="comfyui-plan-method-list comfyui-style-list">{activePlanStyleChoices.map((choice) => {
                const active = activePlanModel.id === selectedModel?.id
                  && data[choice.field] === choice.fileName;
                return <button type="button" key={choice.id} className={`comfyui-plan-method-choice comfyui-style-choice${choice.previewUrl ? ' has-preview' : ''}${active ? ' active' : ''}`} data-state={active ? 'success' : 'idle'} aria-pressed={active} onClick={() => selectPlanStyle(choice)}>
                  <span className="comfyui-plan-method-choice__icon">{choice.previewUrl
                    ? <img src={choice.previewUrl} alt="" aria-hidden="true" draggable={false} decoding="async" />
                    : <UiIcon name="spark" />}</span>
                  <span className="comfyui-plan-method-choice__copy"><strong>{choice.label}</strong><small>{choice.field === 'characterLora' ? '人物 LoRA' : choice.field === 'objectLora' ? '物体 LoRA' : '改变画面的整体风格'}</small></span>
                  <span className="comfyui-plan-method-choice__state" aria-hidden="true"><i>{active && <UiIcon name="check" />}</i><b>{active ? '已选' : '选择'}</b></span>
                </button>;
              })}</div>
              </aside>}
          </div>}
        </div>
        <div className="generator-popover-anchor">
          <button type="button" className="generator-control-button generator-control-card generator-spec-button comfyui-control-card" aria-label="设置生成规格" aria-expanded={showSpecMenu} onClick={() => { setShowSpecMenu((value) => !value); setShowPlanMenu(false); setShowParameterMenu(false); }}><GeneratorControlCardContent icon="crop" label="规格" value={`${selectedRatio} · ${selectedResolution} · ${selectedCount} 张`} expanded={showSpecMenu} /></button>
          {showSpecMenu && <div className="generator-popover generator-spec-menu comfyui-spec-menu">
            <div><small>比例</small><section>{profile.ratios.map((ratio) => <button type="button" key={ratio} className={`generator-ratio-option${selectedRatio === ratio ? ' active' : ''}`} aria-label={`比例 ${ratio}`} aria-pressed={selectedRatio === ratio} onClick={() => data.onChange(id, { ratio })}><GenerationRatioOption ratio={ratio} /></button>)}</section></div>
            <div><small>清晰度</small><section>{profile.resolutions.map((resolution) => <button type="button" key={resolution} className={selectedResolution === resolution ? 'active' : ''} onClick={() => selectResolution(resolution)}>{resolution}</button>)}</section></div>
            <div><small>数量</small><section>{Array.from({ length: profile.count.max - profile.count.min + 1 }, (_, index) => profile.count.min + index).map((count) => <button type="button" key={count} className={selectedCount === count ? 'active' : ''} onClick={() => data.onChange(id, { count })}>{count} 张</button>)}</section></div>
          </div>}
        </div>
        <div className="generator-popover-anchor">
          <button type="button" className="generator-control-button generator-control-card comfyui-control-card" aria-label={`设置运行方式，当前${runtimeSettingsLabel}`} aria-expanded={showParameterMenu} onClick={() => { setShowParameterMenu((value) => !value); setShowPlanMenu(false); setShowSpecMenu(false); }}><GeneratorControlCardContent icon="spark" label="运行设置" value={runtimeSettingsLabel} expanded={showParameterMenu} /></button>
          {showParameterMenu && <div className="generator-popover comfyui-parameter-menu">
            <header className="comfyui-runtime-heading"><strong>怎么生成</strong><small>模型已经调好，通常只需选择结果是否重复。</small></header>
            <label className="comfyui-runtime-primary"><span>每次结果<small>想看不同结果，还是重复同一张</small></span><select aria-label="每次生成结果" value={comfySeedMode} onChange={(event) => data.onChange(id, { comfySeedMode: event.currentTarget.value === 'fixed' ? 'fixed' : 'random', ...(event.currentTarget.value === 'fixed' ? { seed: Number.isInteger(Number(data.seed)) ? Number(data.seed) : 42 } : { seed: undefined }) })}><option value="random">每次不同</option><option value="fixed">重复同一结果</option></select></label>
            {comfySeedMode === 'fixed' && <label className="comfyui-runtime-primary"><span>固定编号<small>相同编号可以复现这次结果</small></span><input aria-label="固定结果编号" type="number" min={0} max={4294967295} step={1} value={Number(data.seed ?? 42)} onChange={(event) => data.onChange(id, { comfySeedMode: 'fixed', seed: Math.max(0, Math.min(4294967295, Math.round(Number(event.currentTarget.value) || 0))) })} /></label>}
            {variationEnabled && variationControl && <section className="comfyui-variation-control" aria-label="改动程度">
              <header><span><strong>改动程度</strong><small>越靠右越敢改，换画风时可选“大改”或“重做”</small></span><b>{selectedVariationLabel} · {selectedVariationNumber}</b></header>
              <div>{[
                { value: 0.45, label: '保留' },
                { value: 0.6, label: '小改' },
                { value: 0.72, label: '平衡' },
                { value: 0.85, label: '大改' },
                { value: 1, label: '重做' },
              ].map((choice) => <button type="button" key={choice.value} className={Math.abs(selectedVariationValue - choice.value) < 0.001 ? 'active' : ''} aria-pressed={Math.abs(selectedVariationValue - choice.value) < 0.001} onClick={() => data.onChange(id, variationControl.field === 'comfyDenoise' ? { comfyDenoise: choice.value } : { referenceDenoise: choice.value })}>{choice.label}</button>)}</div>
            </section>}
            <details className="comfyui-advanced-settings">
              <summary><span><strong>采样参数</strong><small>独立设置，通常不用改</small></span><UiIcon name="chevronDown" /></summary>
              <div className="comfyui-advanced-settings__body">
                {variationEnabled && variationControl && <div className="comfyui-variation-readout" aria-label={`重绘强度 ${selectedVariationNumber}`}><span>重绘强度<small>由上方“改动程度”控制</small></span><strong>{selectedVariationNumber}</strong></div>}
                <div className="comfyui-actual-seed" aria-label={`${actualSeedTitle} ${actualSeedLabel}`}><span>{actualSeedTitle}<small>{comfySeedMode === 'random' ? '每次不同模式的真实编号' : '重复同一结果'}</small></span><strong title={actualSeedLabel}>{actualSeedLabel}</strong></div>
                {advancedSamplingFields.includes('steps') && <label><span>计算轮数<small>Steps</small></span><input aria-label="ComfyUI 采样步数" type="number" min={1} max={100} step={1} value={comfySteps} onChange={(event) => data.onChange(id, { comfySteps: Math.max(1, Math.min(100, Math.round(Number(event.currentTarget.value) || 1))) })} /></label>}
                {advancedSamplingFields.includes('cfg') && <label><span>提示词力度<small>CFG</small></span><input aria-label="ComfyUI CFG" type="number" min={1} max={30} step={0.1} value={comfyCfg} onChange={(event) => data.onChange(id, { comfyCfg: Math.max(1, Math.min(30, Number(event.currentTarget.value) || 1)) })} /></label>}
                {advancedSamplingFields.includes('sampler') && <label><span>采样算法<small>Sampler</small></span><select aria-label="ComfyUI 采样器" value={comfySampler} onChange={(event) => data.onChange(id, { comfySampler: event.currentTarget.value })}>{samplerChoices.map((sampler) => <option key={sampler} value={sampler}>{sampler}</option>)}</select></label>}
                {advancedSamplingFields.includes('scheduler') && <label><span>采样节奏<small>Scheduler</small></span><select aria-label="ComfyUI 调度器" value={comfyScheduler} onChange={(event) => data.onChange(id, { comfyScheduler: event.currentTarget.value })}>{schedulerChoices.map((scheduler) => <option key={scheduler} value={scheduler}>{scheduler}</option>)}</select></label>}
              </div>
              <p>这些数值不是越高越好，改动后可能更慢或降低模型原本效果。</p>
            </details>
            {runtimeSettingsLabel === '已自定义' && <button type="button" className="comfyui-settings-reset" onClick={resetRuntimeSettings}><UiIcon name="retry" /><span>恢复模型推荐值</span></button>}
          </div>}
        </div>
      </div>;
  const actions = <div className="run-actions"><button type="button" className="node-button primary generator-run-button" disabled={busy || Boolean(data.jobPollLost && data.jobId) || !selectedModel || selectedResourceUnavailable || selectedWorkflowBlocked || missingRequiredControlPorts.length > 0 || data.jobState === 'paused'} onClick={() => data.onRun(id)}><span>{busy ? data.cancelling ? '停止中…' : data.jobState === 'queued' ? '排队中…' : '生成中…' : missingRequiredControlPorts.length ? `请接入${missingRequiredControlPorts.map((port) => port.label).join('、')}` : `生成 ${selectedCount} 张`}</span></button>{busy && <button type="button" className="node-button" disabled={data.cancelling} onClick={() => data.onCancel(id)}>{data.cancelling ? '停止中' : '停止'}</button>}{data.jobPollLost && data.jobId && <><button type="button" className="node-button" onClick={() => data.onRefreshJob(id)}>重新查询</button><button type="button" className="node-button" onClick={() => data.onCancel(id)}>强制停止</button></>}</div>;
  return <GeneratorEditorLayout composer={composer} comfy header={header} prompt={prompt} controls={controls} actions={actions}
    cancelling={data.cancelling && <div className="generator-panel-cancelling" role="status"><i /><strong>正在停止本地采样</strong><span>已向 ComfyUI 发送停止请求，正在等待确认…</span></div>} />;
}


type ModelToolFloatingLayerProps = {
  anchorRef: { current: HTMLDivElement | null };
  children: ReactNode;
  onDismiss: () => void;
};

function ModelToolFloatingLayer({ anchorRef, children, onDismiss }: ModelToolFloatingLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12, visible: false });

  useEffect(() => {
    let frame = 0;
    const updatePosition = () => {
      const anchor = anchorRef.current;
      const layer = layerRef.current;
      if (!anchor || !layer) return;
      const anchorBounds = anchor.getBoundingClientRect();
      const padding = 12;
      const gap = 8;
      const width = Math.min(438, Math.max(280, window.innerWidth - padding * 2));
      const height = Math.min(layer.offsetHeight || 520, window.innerHeight - padding * 2);
      const left = Math.max(padding, Math.min(anchorBounds.right - width, window.innerWidth - width - padding));
      const above = anchorBounds.top - height - gap;
      const below = anchorBounds.bottom + gap;
      const top = above >= padding
        ? above
        : Math.max(padding, Math.min(below, window.innerHeight - height - padding));
      setPosition((current) => current.visible && Math.abs(current.left - left) < .5 && Math.abs(current.top - top) < .5
        ? current
        : { left, top, visible: true });
    };
    const followAnchor = () => {
      updatePosition();
      frame = window.requestAnimationFrame(followAnchor);
    };
    followAnchor();
    return () => window.cancelAnimationFrame(frame);
  }, [anchorRef]);

  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', dismissOnEscape);
    return () => window.removeEventListener('keydown', dismissOnEscape);
  }, [onDismiss]);

  return createPortal(
    <div className="model-tool-floating-backdrop nodrag nowheel" onPointerDown={(event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    }}>
      <div
        ref={layerRef}
        className="model-tool-floating-layer nodrag nowheel"
        style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden' }}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export type ModelNodeToolbarFloatingPosition = {
  left: number;
  top: number;
  placement: 'above' | 'below';
};

export function modelVersionTrackScrollLeft(
  track: { scrollLeft: number; clientWidth: number },
  item: { offsetLeft: number; offsetWidth: number },
  padding = 8,
) {
  const visibleLeft = track.scrollLeft + padding;
  const visibleRight = track.scrollLeft + track.clientWidth - padding;
  if (item.offsetLeft < visibleLeft) return Math.max(0, item.offsetLeft - padding);
  const itemRight = item.offsetLeft + item.offsetWidth;
  return itemRight > visibleRight ? Math.max(0, itemRight + padding - track.clientWidth) : track.scrollLeft;
}

export function modelNodeToolbarFloatingPosition(
  anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  toolbar: { width: number; height: number },
  viewport: { width: number; height: number },
): ModelNodeToolbarFloatingPosition {
  const padding = 12;
  const gap = 10;
  const width = Math.min(Math.max(1, toolbar.width), Math.max(1, viewport.width - padding * 2));
  const height = Math.min(Math.max(1, toolbar.height), Math.max(1, viewport.height - padding * 2));
  const centeredLeft = anchor.left + ((anchor.right - anchor.left) - width) / 2;
  const left = Math.max(padding, Math.min(centeredLeft, viewport.width - width - padding));
  const aboveTop = anchor.top - height - gap;
  if (aboveTop >= padding) return { left, top: aboveTop, placement: 'above' };
  const belowTop = Math.max(padding, Math.min(anchor.bottom + gap, viewport.height - height - padding));
  return { left, top: belowTop, placement: 'below' };
}

type ModelNodeFloatingToolbarProps = {
  nodeAnchorRef: { current: HTMLDivElement | null };
  toolbarRef: { current: HTMLDivElement | null };
  children: ReactNode;
};

function ModelNodeFloatingToolbar({ nodeAnchorRef, toolbarRef, children }: ModelNodeFloatingToolbarProps) {
  const [position, setPosition] = useState<ModelNodeToolbarFloatingPosition & { visible: boolean }>({ left: 12, top: 12, placement: 'above', visible: false });

  useEffect(() => {
    let frame = 0;
    const followNode = () => {
      const marker = nodeAnchorRef.current;
      const toolbar = toolbarRef.current;
      const anchor = marker?.closest('.react-flow__node') || marker;
      if (anchor && toolbar) {
        const next = modelNodeToolbarFloatingPosition(
          anchor.getBoundingClientRect(),
          { width: toolbar.offsetWidth || 1, height: toolbar.offsetHeight || 1 },
          { width: window.innerWidth, height: window.innerHeight },
        );
        setPosition((current) => current.visible
          && current.placement === next.placement
          && Math.abs(current.left - next.left) < .5
          && Math.abs(current.top - next.top) < .5
          ? current
          : { ...next, visible: true });
      }
      frame = window.requestAnimationFrame(followNode);
    };
    followNode();
    return () => window.cancelAnimationFrame(frame);
  }, [nodeAnchorRef, toolbarRef]);

  return createPortal(
    <div className="model-node-floating-toolbar-shell nodrag" data-placement={position.placement} style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}

export type CharacterWorkbenchFloatingPosition = {
  left: number;
  top: number;
  width: number;
  height: number;
  side: 'right' | 'left' | 'overlay';
};

export function characterWorkbenchFloatingPosition(
  anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'height'>,
  viewport: { width: number; height: number },
): CharacterWorkbenchFloatingPosition {
  const padding = 14;
  const gap = 14;
  const maxWidth = 520;
  const minWidth = 440;
  const availableHeight = Math.max(240, viewport.height - padding * 2);
  if (viewport.width <= 760) {
    return {
      left: padding,
      top: padding,
      width: Math.max(280, viewport.width - padding * 2),
      height: availableHeight,
      side: 'overlay',
    };
  }
  const availableRight = viewport.width - anchor.right - gap - padding;
  const availableLeft = anchor.left - gap - padding;
  const side = availableRight >= minWidth || availableRight >= availableLeft ? 'right' : 'left';
  const availableWidth = side === 'right' ? availableRight : availableLeft;
  const width = Math.min(maxWidth, Math.max(minWidth, availableWidth));
  const rawLeft = side === 'right' ? anchor.right + gap : anchor.left - gap - width;
  const left = Math.max(padding, Math.min(rawLeft, viewport.width - width - padding));
  const height = Math.min(720, Math.max(520, anchor.height), availableHeight);
  const top = Math.max(padding, Math.min(anchor.top, viewport.height - height - padding));
  return { left, top, width, height, side };
}

export function shouldDismissCharacterWorkbenchFromPointer(target: Element | null, button: number) {
  if (button !== 0) return false;
  if (target?.closest('.generator-panel-layer') || target?.closest('.generator-editor-panel')) return false;
  return Boolean(target?.closest('.react-flow') && !target.closest('.react-flow__node'));
}

export function shouldDismissCharacterWorkbenchFromTarget(target: Element | null) {
  return shouldDismissCharacterWorkbenchFromPointer(target, 0);
}

function CharacterWorkbenchDock({ anchorRef, onDismiss, children }: { anchorRef: { current: HTMLDivElement | null }; onDismiss: () => void; children: ReactNode }) {
  const [position, setPosition] = useState<CharacterWorkbenchFloatingPosition & { visible: boolean }>({ left: 14, top: 14, width: 440, height: 640, side: 'right', visible: false });
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const closeFromCanvasBlank = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (shouldDismissCharacterWorkbenchFromPointer(target, event.button)) onDismissRef.current();
    };
    document.addEventListener('pointerdown', closeFromCanvasBlank, true);
    return () => document.removeEventListener('pointerdown', closeFromCanvasBlank, true);
  }, []);

  useEffect(() => {
    let frame = 0;
    const followAnchor = () => {
      const toolbar = anchorRef.current;
      const anchor = toolbar?.closest('.react-flow__node') || toolbar;
      if (anchor) {
        const next = characterWorkbenchFloatingPosition(anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
        setPosition((current) => current.visible
          && current.side === next.side
          && Math.abs(current.left - next.left) < .5
          && Math.abs(current.top - next.top) < .5
          && Math.abs(current.width - next.width) < .5
          && Math.abs(current.height - next.height) < .5
          ? current
          : { ...next, visible: true });
      }
      frame = window.requestAnimationFrame(followAnchor);
    };
    followAnchor();
    return () => window.cancelAnimationFrame(frame);
  }, [anchorRef]);

  return createPortal(
    <div className='tripo-character-dock nodrag'>
      <div
        className='tripo-character-dock__panel nowheel'
        data-side={position.side}
        style={{ left: position.left, top: position.top, width: position.width, height: position.height, visibility: position.visible ? 'visible' : 'hidden' }}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

type ArchivedCharacterOutput = ResultOutput & { url?: string };
type ArchivedCharacterRun = TripoCharacterRun & {
  rig?: (TripoCharacterRun['rig'] & { outputs?: ArchivedCharacterOutput[] }) | null;
  animationBatches: Array<TripoCharacterRun['animationBatches'][number] & {
    outputs?: ArchivedCharacterOutput[];
    mappedOutputs?: Array<{ preset: string | null; output: ArchivedCharacterOutput }>;
  }>;
};

function localCharacterOutput(output?: ArchivedCharacterOutput): ResultOutput | undefined {
  const mediaUrl = String(output?.mediaUrl || output?.url || '').trim();
  if (!mediaUrl || /^https?:\/\//i.test(mediaUrl) || /^\/\//.test(mediaUrl)) return undefined;
  return { ...output, mediaUrl };
}

export function selectedCharacterAnimationOutput(run: TripoCharacterRun | undefined) {
  const archived = run as ArchivedCharacterRun | undefined;
  if (archived?.selectedAnimationKey) {
    const mapped = archived.animationBatches
      .flatMap((batch) => batch.mappedOutputs || [])
      .find((entry) => entry.preset === archived.selectedAnimationKey)?.output;
    const direct = archived.animationBatches
      .flatMap((batch) => batch.outputs || [])
      .find((output) => output.presetKey === archived.selectedAnimationKey);
    const animation = localCharacterOutput(mapped || direct);
    if (animation) return animation;
  }
  return undefined;
}

export function preferredCharacterPreviewOutput(run: TripoCharacterRun | undefined, fallback?: ResultOutput) {
  const archived = run as ArchivedCharacterRun | undefined;
  const animation = selectedCharacterAnimationOutput(run);
  if (animation) return animation;
  if (archived?.rig?.status === 'succeeded') {
    const rig = (archived.rig.outputs || []).map(localCharacterOutput).find(Boolean);
    if (rig) return rig;
  }
  return fallback;
}

export function normalizedCharacterInspectionMode(value?: string): 'model' | 'skeleton' {
  return value === 'skeleton' ? 'skeleton' : 'model';
}

function GeneratorNode(props: NodeProps<CanvasNode>) {
  const [quickCropOpen, setQuickCropOpen] = useState(false);
  const [showModelExport, setShowModelExport] = useState(false);
  const [showModelOptimize, setShowModelOptimize] = useState(false);
  const [showCharacterWorkbench, setShowCharacterWorkbench] = useState(false);
  const [animationClips, setAnimationClips] = useState<TripoAnimationClipInfo[]>([]);
  const [selectedAnimationClip, setSelectedAnimationClip] = useState<string | number | null>(0);
  const [animationPlaying, setAnimationPlaying] = useState(true);
  const [animationLoop, setAnimationLoop] = useState(true);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [animationSeekSeconds, setAnimationSeekSeconds] = useState(0);
  const [animationProgress, setAnimationProgress] = useState<TripoAnimationProgress>({ clip: null, currentTime: 0, duration: 0, progress: 0, playing: false });
  const [skeletonAvailable, setSkeletonAvailable] = useState<boolean | null>(null);
  const modelToolsAnchorRef = useRef<HTMLDivElement>(null);
  const modelNodeAnchorRef = useRef<HTMLDivElement>(null);
  const capability = generatorCapability(props.data.kind);
  const busy = props.data.jobState === 'queued' || props.data.jobState === 'running' || props.data.jobState === 'cancelling';
  const runningCannotCancel = capability !== 'video' && props.data.kind !== 'comfyUiWorkflow' && props.data.jobState === 'running';
  const canCancel = (busy || Boolean(props.data.jobPollLost)) && !runningCannotCancel;
  const models = (props.data.models || []).filter((model) => model.capability === capability
    && (props.data.kind === 'comfyUiWorkflow'
      ? model.workflows?.some((workflow) => workflow.capability === 'image' && workflow.editor === 'native') || model.workflow?.capability === 'image' && model.workflow.editor === 'native'
      : !(props.data.kind === 'imageGenerator' && ['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(model.adapter || ''))));
  const selectedModel = models.find((model) => model.id === props.data.modelId) || models[0];
  const selectedWorkflow = props.data.kind === 'comfyUiWorkflow'
    ? (selectedModel?.workflows?.length ? selectedModel.workflows : selectedModel?.workflow ? [selectedModel.workflow] : [])
      .find((workflow) => workflow.id === props.data.workflowId)
      || (selectedModel?.workflows?.length ? selectedModel.workflows[0] : selectedModel?.workflow)
    : undefined;
  const profile = selectedModel?.profile;
  const unsupportedStoredRatio = Boolean(props.data.ratio && props.data.ratio !== 'Auto' && profile && !profile.ratios.includes(props.data.ratio));
  const defaultRatio = selectedModel?.defaults?.ratio || profile?.defaultRatio || 'Auto';
  const defaultResolution = selectedModel?.defaults?.resolution || profile?.defaultResolution || (capability === 'image' ? '1K' : capability === 'video' ? '720P' : capability === 'audio' ? 'WAV' : 'STANDARD');
  const specSummary = capability === 'video'
    ? `${props.data.ratio || defaultRatio} · ${props.data.resolution || defaultResolution} · ${props.data.duration || profile?.duration.default || 5} 秒${props.data.audioEnabled === false ? ' · 无音频' : ' · 含音频'}`
    : capability === 'audio'
      ? `${selectedModel?.audioOptions?.languages?.find((item) => item.id === (props.data.audioLanguage || 'zh'))?.label || '中文'} · ${Number(props.data.audioSpeed || selectedModel?.audioOptions?.speed?.default || 1).toFixed(1)}× · WAV`
    : capability === 'model'
      ? props.data.tripoSubmittedOptions && props.data.latestOutputs?.length
        ? `实际生成 · ${tripoSubmittedSpecLabel(props.data.tripoSubmittedOptions)}`
        : `${tripoModelInputLabel(props.data.modelInputMode)} · ${tripoModelPresetLabel(resolvedTripoModelPreset(props.data))}`
      : `${props.data.ratio || defaultRatio} · ${props.data.resolution || defaultResolution} · ${props.data.count || profile?.count.default || 1} 张`;
  const latestOutputs = props.data.latestOutputs || [];
  const latestMediaType = props.data.latestMediaType || capability;
  const hasImageHand = latestMediaType === 'image' && !busy && latestOutputs.filter(output => output.mediaUrl).length > 1;
  const selectedOutputIndex = Math.min(props.data.selectedOutput || 0, Math.max(0, latestOutputs.length - 1));
  const firstLatest = latestMediaType === 'image'
    ? (latestOutputs[selectedOutputIndex]?.mediaUrl ? latestOutputs[selectedOutputIndex] : latestOutputs.find((output) => output.mediaUrl))
    : latestMediaType === 'model' ? preferredInteractiveModelOutput(latestOutputs) : latestOutputs.find((output) => output.mediaUrl);
  const lodLevel = props.selected ? 'high' : props.data.mediaLodLevel || 'high';
  const latestDimensions = generatedMediaDimensions(props.data, firstLatest);
  const latestGenerationDuration = selectedModel?.adapter === 'comfyui-minimax-h3' ? formatGenerationDuration(firstLatest?.generationDurationMs) : '';
  const modelExportBusy = busy && props.data.tripoPostprocessOperation === 'convert';
  const modelOptimizeBusy = busy && ['texture', 'retopology'].includes(props.data.tripoPostprocessOperation || '');
  const modelVersions = props.data.modelVersions || [];
  const selectedModelVersion = Math.min(props.data.selectedModelVersion ?? Math.max(0, modelVersions.length - 1), Math.max(0, modelVersions.length - 1));
  useEffect(() => {
    if (!props.selected) return;
    const frame = window.requestAnimationFrame(() => {
      const track = modelToolsAnchorRef.current?.querySelector<HTMLElement>('.model-version-track');
      const current = track?.querySelector<HTMLElement>('button.is-current');
      if (track && current) track.scrollLeft = modelVersionTrackScrollLeft(track, current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.selected, selectedModelVersion, modelVersions.length]);
  const optimizationSourceIndex = safeTripoOptimizationSourceIndex(modelVersions, selectedModelVersion, 'texture');
  const selectedModelStageLabel = modelProcessStageLabel(modelVersions, selectedModelVersion);
  const optimizationSourceStageLabel = modelProcessStageLabel(modelVersions, Math.max(0, optimizationSourceIndex));
  const optimizationSourceOutput = preferredInteractiveModelOutput(modelVersions[Math.max(0, optimizationSourceIndex)]?.outputs || latestOutputs);
  const optimizationSourceAdjusted = optimizationSourceIndex >= 0 && optimizationSourceIndex !== selectedModelVersion;
  const appearanceStageCount = modelVersions.filter((version) => version.operation === 'texture').length;
  const topologyStageCount = modelVersions.filter((version) => version.operation === 'retopology').length;
  const characterRuns = props.data.characterRuns || [];
  const activeCharacterRun = characterRuns.find((run) => run.id === props.data.activeCharacterRunId);
  const characterDraft = activeCharacterRun
    ? props.data.characterDrafts?.[activeCharacterRun.id] || createTripoCharacterDraft(activeCharacterRun)
    : undefined;
  const characterSourceVersionIndex = characterRigSourceVersionIndex(modelVersions, selectedModelVersion);
  const characterSourceVersion = modelVersions[characterSourceVersionIndex];
  const characterSourceOutput = preferredInteractiveModelOutput(characterSourceVersion?.outputs || []);
  const characterSourceAdjusted = characterSourceVersionIndex >= 0 && characterSourceVersionIndex !== selectedModelVersion;
  const characterSourceStageLabel = characterSourceVersionIndex >= 0
    ? modelProcessStageLabel(modelVersions, characterSourceVersionIndex)
    : '';
  const characterSourceFormat = characterSourceModelFormat(activeCharacterRun, modelVersions, firstLatest);
  const characterAnimationOutput = undefined;
  const modelPreviewOutput = firstLatest;
  const previewFormat = previewableModelFormat(modelPreviewOutput);
  const requestedCharacterInspectionMode = normalizedCharacterInspectionMode(props.data.selectedCharacterPose);
  const characterInspectionMode = 'model' as const;
  const characterBusy = props.data.characterJobState === 'queued' || props.data.characterJobState === 'running';
  const characterJobMatchesRun = characterJobBelongsToRun(props.data, activeCharacterRun?.id, characterSourceFormat);
  const busyCharacterStage = characterBusy && characterJobMatchesRun && ['rig-check', 'rig', 'retarget'].includes(props.data.activeCharacterOperation || '')
    ? props.data.activeCharacterOperation as 'rig-check' | 'rig' | 'retarget'
    : null;
  const canCreateCharacter = Boolean(characterSourceVersion?.jobId && characterSourceOutput?.tripoTaskId);
  const openCharacterWorkbench = () => {
    if (!characterSourceVersion?.jobId || !characterSourceOutput?.tripoTaskId) return;
    const runId = `character-${characterSourceVersion.jobId}`;
    const existingRun = characterRuns.find((run) => run.id === runId);
    const run = existingRun || createTripoCharacterRun({
      id: runId,
      sourceVersionJobId: characterSourceVersion.jobId,
      sourceVersionIndex: characterSourceVersionIndex,
      sourceLabel: characterSourceAdjusted ? `${characterSourceStageLabel} · 绑定源` : characterSourceStageLabel,
      sourceTaskId: characterSourceOutput.tripoTaskId,
    });
    props.data.onChange(props.id, {
      characterRuns: existingRun ? characterRuns : [...characterRuns, run],
      activeCharacterRunId: runId,
      characterDrafts: {
        ...(props.data.characterDrafts || {}),
        [runId]: props.data.characterDrafts?.[runId] || createTripoCharacterDraft(run),
      },
    }, 'runtime');
    setShowModelOptimize(false);
    setShowModelExport(false);
    setShowCharacterWorkbench(true);
  };
  useEffect(() => {
    if (!showCharacterWorkbench) return;
    if (!characterSourceVersion?.jobId || !characterSourceOutput?.tripoTaskId) return;
    const runId = `character-${characterSourceVersion.jobId}`;
    if (activeCharacterRun?.id === runId) return;
    const existingRun = characterRuns.find((run) => run.id === runId);
    const run = existingRun || createTripoCharacterRun({
      id: runId,
      sourceVersionJobId: characterSourceVersion.jobId,
      sourceVersionIndex: characterSourceVersionIndex,
      sourceLabel: `${characterSourceStageLabel} · 绑定源`,
      sourceTaskId: characterSourceOutput.tripoTaskId,
    });
    props.data.onChange(props.id, {
      characterRuns: existingRun ? characterRuns : [...characterRuns, run],
      activeCharacterRunId: runId,
      characterDrafts: {
        ...(props.data.characterDrafts || {}),
        [runId]: props.data.characterDrafts?.[runId] || createTripoCharacterDraft(run),
      },
    }, 'runtime');
  }, [showCharacterWorkbench, characterSourceFormat, characterSourceVersion?.jobId, characterSourceOutput?.tripoTaskId, activeCharacterRun?.id]);
  const updateActiveCharacterRun = (update: (run: TripoCharacterRun) => TripoCharacterRun) => {
    if (!activeCharacterRun) return;
    props.data.onChange(props.id, {
      characterRuns: characterRuns.map((run) => run.id === activeCharacterRun.id ? update(run) : run),
    }, 'runtime');
  };
  const handleCharacterPreview = (selection: TripoCharacterPreviewSelection) => {
    updateActiveCharacterRun((run) => ({ ...run, selectedAnimationKey: selection.kind === 'animation' ? selection.key : null }));
    props.data.onChange(props.id, { selectedCharacterPose: selection.kind === 'pose' ? selection.key : undefined }, 'runtime');
    if (selection.kind === 'animation') {
      setAnimationPlaying(true);
      setAnimationSeekSeconds(0);
    } else setAnimationPlaying(false);
  };

  useEffect(() => {
    setAnimationClips([]);
    setSelectedAnimationClip(0);
    setAnimationSeekSeconds(0);
    setAnimationProgress({ clip: null, currentTime: 0, duration: 0, progress: 0, playing: false });
  }, [modelPreviewOutput?.mediaUrl]);
  useEffect(() => setSkeletonAvailable(null), [modelPreviewOutput?.mediaUrl]);
  useEffect(() => {
    if (props.selected && props.data.singleNodeSelected !== false) return;
    setShowModelOptimize(false);
    setShowModelExport(false);
    setShowCharacterWorkbench(false);
  }, [props.selected, props.data.singleNodeSelected]);
  const showGeneratorFailure = capability !== 'model'
    ? props.data.jobState === 'failed'
    : shouldDisplayModelFailure(props.data.jobState, props.data.jobId, modelVersions, selectedModelVersion);
  const comfySamplingPercent = props.data.comfyPreview?.steps
    ? Math.max(0, Math.min(100, Math.round((props.data.comfyPreview.step / props.data.comfyPreview.steps) * 100)))
    : Math.max(0, Math.min(100, Math.round(Number(props.data.progress) || 0)));
  const comfyRuntimeLabel = props.data.jobState === 'queued'
    ? '排队中'
    : props.data.jobState === 'cancelling'
      ? '停止中'
      : `采样中 · ${comfySamplingPercent}%`;
  const externalMeta = props.data.kind === 'comfyUiWorkflow' && busy
    ? comfyRuntimeLabel
    : latestDimensions
      ? `${latestDimensions}${latestGenerationDuration ? ` · 耗时 ${latestGenerationDuration}` : ''}`
      : busy
        ? (props.data.jobState === 'queued' ? '排队中' : props.data.jobState === 'cancelling' ? '取消中' : '生成中')
        : specSummary;
  return <NodeShell
    {...props}
    titleFallback={props.data.kind === 'comfyUiWorkflow' ? `${selectedWorkflow?.name || '本地图片工作流'} · ComfyUI` : `${capability === 'image' ? '图片' : capability === 'video' ? '视频' : capability === 'audio' ? '音频' : '3D 模型'}生成`}
    titleMeta={externalMeta}
    titleMetaClassName={props.data.kind === 'comfyUiWorkflow' && busy ? 'generator-external-runtime' : undefined}
  >
    {props.selected && props.data.singleNodeSelected !== false && latestMediaType === 'image' && firstLatest?.mediaUrl && !props.data.publicMode && props.data.onCreateTurnaroundSplit && props.data.onQuickCropImage && <ImageToolToolbar onCrop={() => setQuickCropOpen(true)} onSplit={() => props.data.onCreateTurnaroundSplit?.(props.id, firstLatest.mediaUrl)} />}
    {props.selected && props.data.singleNodeSelected !== false && latestMediaType === 'video' && firstLatest?.mediaUrl && !props.data.publicMode && props.data.onUpscaleVideo && <VideoToolToolbar onUpscale={() => void props.data.onUpscaleVideo?.(props.id, firstLatest.mediaUrl)} />}
    <div className={`generator-preview generator-preview-anchor preview-${capability} ${firstLatest || props.data.comfyPreview?.url ? 'has-latest-output' : ''}${hasImageHand ? ' has-image-hand' : ''}`}>
      {hasImageHand ? <CanvasImageResultHand outputs={latestOutputs} selected={selectedOutputIndex} lodLevel={lodLevel}
        onSelect={index => { const output = latestOutputs[index]; props.data.onChange(props.id, { selectedOutput: index, mediaWidth: output.width, mediaHeight: output.height }, 'runtime'); }}
        onMediaSize={(width, height) => props.data.onMediaSize?.(props.id, width, height)} /> : props.data.kind === 'comfyUiWorkflow'
        ? <ComfyUiSamplingViewport id={props.id} data={props.data} modelName={selectedModel?.name || '未选择本地模型'} workflowName={selectedWorkflow?.name || '未选择工作流'} compact />
        : firstLatest?.mediaUrl ? (latestMediaType === 'video'
        ? <CanvasVideoPlayer className="generator-latest-media" src={firstLatest.mediaUrl} poster={firstLatest.previewUrl} lodLevel={lodLevel} onSelect={() => props.data.onEditStart(props.id)} onLoadedMetadata={(video) => props.data.onMediaSize?.(props.id, video.videoWidth, video.videoHeight)} onCaptureFrame={(file, width, height, label) => props.data.onCaptureVideoFrame?.(props.id, file, width, height, label)} onContinueFromTail={(file, width, height) => props.data.onContinueVideoFromFrame?.(props.id, file, width, height)} />
        : latestMediaType === 'audio'
          ? <AudioWaveformPlayer className="generator-latest-audio" src={firstLatest.mediaUrl} onDuration={(duration) => { if (props.data.mediaDuration !== duration) props.data.onChange(props.id, { mediaDuration: duration }, 'runtime'); }} />
        : latestMediaType === 'model'
          ? <div className="generator-model-result">
            {previewFormat && modelPreviewOutput?.mediaUrl ? <TripoModelViewer src={modelPreviewOutput.mediaUrl} format={previewFormat} poster={modelPreviewOutput.previewUrl || firstLatest.previewUrl} alt={modelPreviewOutput.fileName || firstLatest.fileName || '3D 模型预览'} onModelMetadata={(metadata) => props.data.onChange(props.id, { modelTextureMetadata: metadata }, 'runtime')} inspectionMode={characterInspectionMode} onSkeletonAvailabilityChange={(available) => { setSkeletonAvailable(available); if (!available && requestedCharacterInspectionMode === 'skeleton') props.data.onChange(props.id, { selectedCharacterPose: 'model' }, 'runtime'); }} onAnimationClipsChange={(clips) => { setAnimationClips(clips); setSelectedAnimationClip(clips[0]?.index ?? null); }} selectedAnimationClip={selectedAnimationClip} animationPlaying={Boolean(characterAnimationOutput) && animationPlaying} animationLoop={animationLoop} animationSpeed={animationSpeed} animationSeekSeconds={animationSeekSeconds} onAnimationProgress={setAnimationProgress} /> : firstLatest.previewUrl ? <img className="generator-latest-media node-media-surface" draggable={false} src={firstLatest.previewUrl} alt={firstLatest.fileName || '3D 模型预览'} onLoad={(event) => props.data.onMediaSize?.(props.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} /> : <span>模型格式不支持浏览器几何预览</span>}
            <div ref={modelNodeAnchorRef} className="model-tools-node-anchor" aria-hidden="true" />
            {props.selected && props.data.singleNodeSelected !== false && <ModelNodeFloatingToolbar nodeAnchorRef={modelNodeAnchorRef} toolbarRef={modelToolsAnchorRef}>
              <div ref={modelToolsAnchorRef} className="model-preview-tools nodrag nowheel" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
              <div className="model-version-track" aria-label="模型版本流程">
                <span className="model-version-track__label">模型</span>
                {modelVersions.map((version, index) => <button type="button" key={version.jobId} className={index === selectedModelVersion ? 'is-current' : ''} title={modelProcessStageLabel(modelVersions, index)} onClick={(event) => { event.stopPropagation(); props.data.onChange(props.id, { selectedModelVersion: index, latestOutputs: version.outputs, latestMediaType: 'model', modelTextureMetadata: undefined, jobId: version.jobId, jobState: 'succeeded', progress: 100, status: '当前显示：' + modelProcessStageLabel(modelVersions, index), jobPollLost: false, cancelling: false, tripoPostprocessOperation: version.operation === 'generate' ? undefined : version.operation }, 'runtime'); }}><i aria-hidden="true" /><span>{modelProcessStageLabel(modelVersions, index)}</span></button>)}
              </div>
              <span className="model-preview-tools__divider" aria-hidden="true" />
              <div className="model-preview-actions" aria-label="模型操作">
                <button type="button" className={`model-preview-tool-button ${showModelOptimize ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); setShowModelOptimize((value) => !value); setShowModelExport(false); }}>优化</button>
                <button type="button" className="model-preview-tool-button character-primary" disabled={!canCreateCharacter} title={canCreateCharacter ? (characterSourceAdjusted ? `将从最近的${characterSourceStageLabel}结果创建独立角色节点` : `从当前${characterSourceStageLabel}结果创建独立角色节点`) : '没有找到可用于绑定的模型版本'} onClick={(event) => { event.stopPropagation(); props.data.onCreateCharacterNode?.(props.id, characterSourceVersionIndex); }}>绑定动画</button>
                <button type="button" className={`model-preview-tool-button ${showModelExport ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); setShowModelExport((value) => !value); setShowModelOptimize(false); }}>导出</button>
              </div>
            </div>
            </ModelNodeFloatingToolbar>}
            {showModelOptimize && <ModelToolFloatingLayer anchorRef={modelToolsAnchorRef} onDismiss={() => setShowModelOptimize(false)}><TripoModelOptimizePanel modelId={selectedModel?.id || props.data.modelId || ''} sourceTaskId={optimizationSourceOutput?.tripoTaskId} busy={modelOptimizeBusy} status={props.data.status} sourceStageLabel={optimizationSourceStageLabel} selectedStageLabel={selectedModelStageLabel} sourceAdjusted={optimizationSourceAdjusted} appearanceStageCount={appearanceStageCount} topologyStageCount={topologyStageCount} onClose={() => setShowModelOptimize(false)} onSubmit={(submission) => props.data.onRunTripoPostprocess?.(props.id, submission)} /></ModelToolFloatingLayer>}
            {showModelExport && <ModelToolFloatingLayer anchorRef={modelToolsAnchorRef} onDismiss={() => setShowModelExport(false)}><TripoModelExportPanel modelId={selectedModel?.id || props.data.modelId || ''} sourceUrl={firstLatest.mediaUrl} sourceFileName={firstLatest.fileName} assetName={props.data.title || '3D 模型'} sourceTaskId={firstLatest.tripoTaskId} sourceVersion={selectedModelVersion + 1} sourceLabel={selectedModelStageLabel} busy={modelExportBusy} status={props.data.status} pendingFormat={props.data.modelExportFormat} versions={props.data.modelExportVersions} modelMetadata={props.data.modelTextureMetadata} onClose={() => setShowModelExport(false)} onSubmit={(submission) => props.data.onRunTripoPostprocess?.(props.id, submission)} /></ModelToolFloatingLayer>}
            {showCharacterWorkbench && activeCharacterRun && characterDraft && <CharacterWorkbenchDock anchorRef={modelNodeAnchorRef} onDismiss={() => setShowCharacterWorkbench(false)}>
              {characterJobMatchesRun && (props.data.characterJobState === 'paused' || props.data.characterJobState === 'failed') && <div className="tripo-character-recovery" role="alert">
                <div><strong>{props.data.characterJobState === 'paused' ? '角色任务已暂停' : '角色任务失败'}</strong><span>{props.data.characterStatus || '可恢复已知远端任务；新建远端任务需要再次确认。'}</span></div>
                <button type="button" onClick={() => props.data.onResumeCharacterJob?.(props.id)}>恢复任务</button>
                <button type="button" className="is-danger" onClick={() => props.data.onRetryCharacterPaid?.(props.id)}>{props.data.activeCharacterOperation === 'rig-check' ? '重新检查' : '新建远端任务'}</button>
              </div>}
              <TripoCharacterWorkbench
                run={activeCharacterRun}
                draft={characterDraft}
                modelIds={{ rigCheck: selectedModel?.id || props.data.modelId || '', rig: selectedModel?.id || props.data.modelId || '', retarget: selectedModel?.id || props.data.modelId || '' }}
                sourceFormat={characterSourceFormat || ''}
                busyStage={busyCharacterStage}
                inspectionMode={characterInspectionMode}
                skeletonAvailable={skeletonAvailable}
                onDraftChange={(nextDraft) => props.data.onChange(props.id, { characterDrafts: { ...(props.data.characterDrafts || {}), [activeCharacterRun.id]: nextDraft } }, 'runtime')}
                onSubmit={(submission) => props.data.onRunTripoPostprocess?.(props.id, submission)}
                onAcceptRig={(runId, acceptedAt) => {
                  props.data.onChange(props.id, {
                    characterRuns: characterRuns.map((run) => run.id === runId ? { ...run, acceptedAt } : run),
                    characterDrafts: { ...(props.data.characterDrafts || {}), [runId]: { ...characterDraft, tab: 'animation' } },
                  }, 'runtime');
                }}
                onPreviewSelection={handleCharacterPreview}
                onClose={() => setShowCharacterWorkbench(false)}
              />
              {characterAnimationOutput && <section className="tripo-character-playback" aria-label="角色动画播放控制">
                <div className="tripo-character-playback__heading"><strong>动画预览</strong><span>{animationProgress.clip?.name || activeCharacterRun.selectedAnimationKey || '等待动画片段'}</span></div>
                <div className="tripo-character-playback__controls">
                  <button type="button" onClick={() => setAnimationPlaying((value) => !value)}>{animationPlaying ? '暂停' : '播放'}</button>
                  <button type="button" aria-pressed={animationLoop} onClick={() => setAnimationLoop((value) => !value)}>循环</button>
                  <label><span>片段</span><select value={selectedAnimationClip ?? ''} onChange={(event) => setSelectedAnimationClip(Number(event.currentTarget.value))}>{animationClips.map((clip) => <option key={clip.index} value={clip.index}>{clip.name}</option>)}</select></label>
                  <label><span>速度</span><select value={animationSpeed} onChange={(event) => setAnimationSpeed(Number(event.currentTarget.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label>
                </div>
                <label className="tripo-character-playback__timeline"><span>{animationProgress.currentTime.toFixed(1)}s</span><input type="range" min={0} max={Math.max(animationProgress.duration, .01)} step={.01} value={Math.min(animationProgress.currentTime, Math.max(animationProgress.duration, .01))} onChange={(event) => setAnimationSeekSeconds(Number(event.currentTarget.value))} /><span>{animationProgress.duration.toFixed(1)}s</span></label>
              </section>}
            </CharacterWorkbenchDock>}
          </div>
          : <CanvasLodImage className="generator-latest-media node-media-surface" src={firstLatest.mediaUrl} previewUrl={firstLatest.previewUrl} lodLevel={lodLevel} alt={firstLatest.fileName || '最新生成结果'} onLoad={(image) => { if (!firstLatest.width || !firstLatest.height) props.data.onMediaSize?.(props.id, image.naturalWidth, image.naturalHeight); }} />)
        : busy ? null : <EmptyNodeState icon={capability === 'image' ? 'imageGenerate' : capability === 'video' ? 'videoGenerate' : capability === 'audio' ? 'audioGenerate' : 'model3d'} label={props.data.jobState === 'paused' ? '远端任务已暂停' : props.data.jobState === 'failed' ? (props.data.jobPollLost ? '任务状态查询中断' : '生成失败') : props.data.jobState === 'cancelled' ? '任务已取消' : props.data.jobState === 'succeeded' ? '等待生成结果' : `等待生成${capability === 'image' ? '图片' : capability === 'video' ? '视频' : capability === 'audio' ? '音频' : ' 3D 模型'}`} />}
      {props.data.kind !== 'comfyUiWorkflow' && <GenerationActivityOverlay state={props.data.jobState} startedAt={props.data.jobStartedAt} />}
      {props.data.cancelling && <div className="generator-cancelling-state nodrag" role="status"><i /><strong>正在取消任务</strong><span>正在等待生成服务确认停止，请稍候…</span></div>}
    </div>
    {props.selected && props.data.singleNodeSelected !== false && latestMediaType === 'image' && firstLatest?.mediaUrl && !props.data.publicMode && <div className="lib-image-quick-panel generator-image-quick-panel nodrag" aria-label="使用生成结果创建下一步">
      <button title="使用当前结果继续生成图片" onClick={() => props.data.onQuickCreate(props.id, 'imageGenerator', 'imageToImage')}><UiIcon name="imageGenerate" /><span>图片</span></button>
      <button title="使用当前结果生成视频" onClick={() => props.data.onQuickCreate(props.id, 'videoGenerator')}><UiIcon name="videoGenerate" /><span>视频</span></button>
      <button title="使用当前结果生成 3D 模型" onClick={() => props.data.onQuickCreate(props.id, 'modelGenerator')}><UiIcon name="model3d" /><span>模型</span></button>
    </div>}
    {showGeneratorFailure && props.data.status && <div className="generator-node-failure nodrag" role="alert"><strong>{props.data.jobPollLost ? '状态查询中断' : '生成失败'}</strong><span>{props.data.status}</span>{props.data.jobPollLost && <button type="button" onClick={(event) => { event.stopPropagation(); props.data.onRefreshJob(props.id); }}>重新查询</button>}</div>}
    {props.data.jobState === 'paused' && <div className="generator-node-failure generator-node-paused nodrag" role="status"><strong>远端任务已暂停</strong><span>{props.data.status || '可继续查询已有 Tripo3D 任务，不会重复创建远端任务。'}</span><div><button type="button" onClick={(event) => { event.stopPropagation(); props.data.onResume?.(props.id); }}>恢复远端任务</button><button type="button" className="danger" onClick={(event) => { event.stopPropagation(); props.data.onRetryPaid?.(props.id); }}>新建远端任务</button></div></div>}
    {quickCropOpen && firstLatest?.mediaUrl && props.data.onQuickCropImage && <ImageQuickCropDialog sourceId={props.id} mediaUrl={firstLatest.mediaUrl} fileName={firstLatest.fileName} sourceWidth={firstLatest.width} sourceHeight={firstLatest.height} onApply={props.data.onQuickCropImage} onClose={() => setQuickCropOpen(false)} />}
    <div className="node-hover-actions nodrag">{props.data.jobState === 'paused' ? <button onClick={() => props.data.onResume?.(props.id)}>恢复</button> : canCancel ? <button disabled={props.data.cancelling} onClick={() => props.data.onCancel(props.id)}>{props.data.cancelling ? '取消中' : '取消任务'}</button> : <button onClick={() => props.data.onRun(props.id)} disabled={!props.data.modelId || unsupportedStoredRatio}>生成</button>}<button onClick={() => props.data.onEditStart(props.id)}>编辑设置</button></div>
  </NodeShell>;
}

function characterAnimatorRuntime(data: CanvasNodeData) {
  const runs = data.characterRuns || [];
  const activeRun = runs.find((run) => run.id === data.activeCharacterRunId) || runs[0];
  const draft = activeRun ? data.characterDrafts?.[activeRun.id] || createTripoCharacterDraft(activeRun) : undefined;
  const versions = data.modelVersions || [];
  const sourceVersion = activeRun ? versions.find((version) => version.jobId === activeRun.sourceVersionJobId) : versions[0];
  const sourceOutput = preferredInteractiveModelOutput(sourceVersion?.outputs || data.latestOutputs || []);
  const archivedRun = activeRun as ArchivedCharacterRun | undefined;
  const rigOutput = (archivedRun?.rig?.outputs || []).map(localCharacterOutput).find(Boolean);
  const animationOutput = selectedCharacterAnimationOutput(activeRun);
  const automaticStage: 'source' | 'rig' | 'animation' = animationOutput ? 'animation' : rigOutput ? 'rig' : 'source';
  const previewStage = data.characterPreviewStage || automaticStage;
  const previewOutput = previewStage === 'animation'
    ? animationOutput || rigOutput || sourceOutput
    : previewStage === 'rig'
      ? rigOutput || sourceOutput
      : sourceOutput;
  const sourceFormat = characterSourceModelFormat(activeRun, versions, sourceOutput);
  const requestedInspectionMode = normalizedCharacterInspectionMode(data.selectedCharacterPose);
  const skeletonAvailable = data.characterSkeletonAvailable ?? null;
  const inspectionMode = requestedInspectionMode === 'skeleton' && skeletonAvailable === false ? 'model' : requestedInspectionMode;
  const characterBusy = data.characterJobState === 'queued' || data.characterJobState === 'running';
  const characterJobMatchesRun = characterJobBelongsToRun(data, activeRun?.id, sourceFormat);
  const busyStage = characterBusy && characterJobMatchesRun && ['rig-check', 'rig', 'retarget'].includes(data.activeCharacterOperation || '')
    ? data.activeCharacterOperation as 'rig-check' | 'rig' | 'retarget'
    : null;
  const model = (data.models || []).find((candidate) => candidate.id === data.modelId)
    || (data.models || []).find((candidate) => candidate.capability === 'model');
  return {
    runs, activeRun, draft, versions, sourceOutput, rigOutput, animationOutput, automaticStage, previewStage,
    previewOutput, sourceFormat, requestedInspectionMode, skeletonAvailable, inspectionMode,
    characterBusy, characterJobMatchesRun, busyStage, model,
  };
}

function CharacterAnimatorNodeView(props: NodeProps<CanvasNode>) {
  const [animationClips, setAnimationClips] = useState<TripoAnimationClipInfo[]>([]);
  const [selectedAnimationClip, setSelectedAnimationClip] = useState<string | number | null>(0);
  const [animationPlaying, setAnimationPlaying] = useState(true);
  const [animationLoop, setAnimationLoop] = useState(true);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [animationSeekSeconds, setAnimationSeekSeconds] = useState(0);
  const [animationProgress, setAnimationProgress] = useState<TripoAnimationProgress>({ clip: null, currentTime: 0, duration: 0, progress: 0, playing: false });
  const nodeAnchorRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const {
    runs, activeRun, draft, rigOutput, animationOutput, previewStage, previewOutput, sourceFormat,
    requestedInspectionMode, skeletonAvailable, inspectionMode, characterBusy, characterJobMatchesRun,
    busyStage, model,
  } = characterAnimatorRuntime(props.data);
  const previewFormat = previewableModelFormat(previewOutput);
  const showWorkbench = false;
  const setShowWorkbench = (_visible: boolean) => undefined;
  const setPreviewStage = (stage: 'source' | 'rig' | 'animation') => props.data.onChange(props.id, { characterPreviewStage: stage }, 'runtime');
  const handlePreviewSelection = (selection: TripoCharacterPreviewSelection) => {
    if (!activeRun) return;
    props.data.onChange(props.id, {
      characterRuns: runs.map((run) => run.id === activeRun.id ? { ...run, selectedAnimationKey: selection.kind === 'animation' ? selection.key : run.selectedAnimationKey } : run),
      ...(selection.kind === 'pose' ? { selectedCharacterPose: selection.key } : {}),
      characterPreviewStage: selection.kind === 'animation' ? 'animation' : rigOutput ? 'rig' : 'source',
    }, 'runtime');
  };

  useEffect(() => {
    const nextStage = animationOutput ? 'animation' : rigOutput ? 'rig' : 'source';
    if (props.data.characterPreviewStage !== nextStage) props.data.onChange(props.id, { characterPreviewStage: nextStage }, 'runtime');
  }, [animationOutput?.mediaUrl, rigOutput?.mediaUrl]);
  useEffect(() => {
    setAnimationClips([]);
    setSelectedAnimationClip(0);
    setAnimationSeekSeconds(0);
    setAnimationProgress({ clip: null, currentTime: 0, duration: 0, progress: 0, playing: false });
  }, [animationOutput?.mediaUrl]);
  useEffect(() => {
    if (props.data.characterSkeletonAvailable !== undefined) props.data.onChange(props.id, { characterSkeletonAvailable: undefined }, 'runtime');
  }, [previewOutput?.mediaUrl]);

  return <NodeShell {...props} titleFallback="角色绑定与动画" titleMeta={activeRun?.sourceLabel || '等待 3D 模型输入'}>
    <div className={`generator-preview generator-preview-anchor preview-model ${previewOutput?.mediaUrl ? 'has-latest-output' : ''}`}>
      {previewOutput?.mediaUrl && previewFormat ? <div className="generator-model-result character-animator-stage">
        <TripoModelViewer
          src={previewOutput.mediaUrl}
          format={previewFormat}
          poster={previewOutput.previewUrl}
          alt={previewOutput.fileName || '角色模型预览'}
          inspectionMode={inspectionMode}
          onSkeletonAvailabilityChange={(available) => {
            if (props.data.characterSkeletonAvailable !== available) props.data.onChange(props.id, {
              characterSkeletonAvailable: available,
              ...(!available && requestedInspectionMode === 'skeleton' ? { selectedCharacterPose: 'model' } : {}),
            }, 'runtime');
          }}
          onAnimationClipsChange={(clips) => { setAnimationClips(clips); setSelectedAnimationClip(clips[0]?.index ?? null); }}
          selectedAnimationClip={selectedAnimationClip}
          animationPlaying={previewStage === 'animation' && Boolean(animationOutput) && animationPlaying}
          animationLoop={animationLoop}
          animationSpeed={animationSpeed}
          animationSeekSeconds={animationSeekSeconds}
          onAnimationProgress={setAnimationProgress}
        />
        <div ref={nodeAnchorRef} className="model-tools-node-anchor" aria-hidden="true" />
        <div className="character-animator-badge"><span>RIG &amp; MOTION</span><strong>{previewStage === 'animation' ? '动画预览' : previewStage === 'rig' ? '骨架预览' : '源模型'}</strong></div>
        {props.selected && props.data.singleNodeSelected !== false && <ModelNodeFloatingToolbar nodeAnchorRef={nodeAnchorRef} toolbarRef={toolbarRef}>
          <div ref={toolbarRef} className="model-preview-tools character-node-tools nodrag nowheel" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <div className="model-version-track" aria-label="角色制作流程">
              <span className="model-version-track__label">角色</span>
              <button type="button" className={previewStage === 'source' ? 'is-current' : ''} onClick={() => props.data.onChange(props.id, { characterPreviewStage: 'source' }, 'runtime')}><i aria-hidden="true" /><span>源模型</span></button>
              <button type="button" disabled={!rigOutput} className={previewStage === 'rig' ? 'is-current' : ''} onClick={() => props.data.onChange(props.id, { characterPreviewStage: 'rig' }, 'runtime')}><i aria-hidden="true" /><span>已绑定</span></button>
              <button type="button" disabled={!animationOutput} className={previewStage === 'animation' ? 'is-current' : ''} onClick={() => props.data.onChange(props.id, { characterPreviewStage: 'animation' }, 'runtime')}><i aria-hidden="true" /><span>动画</span></button>
            </div>
            <span className="model-preview-tools__divider" aria-hidden="true" />
            <div className="model-preview-actions" aria-label="角色操作">
              <button type="button" className="model-preview-tool-button character-primary active" onClick={() => props.data.onEditStart(props.id)}>工作流</button>
              <button type="button" className={`model-preview-tool-button ${inspectionMode === 'skeleton' ? 'active' : ''}`} disabled={!rigOutput || skeletonAvailable === false} onClick={() => props.data.onChange(props.id, { selectedCharacterPose: inspectionMode === 'skeleton' ? 'model' : 'skeleton' }, 'runtime')}>骨架</button>
              {previewOutput.mediaUrl && <a className="model-preview-tool-button character-node-download" href={canvasAssetDownloadUrl(previewOutput.mediaUrl, nodeResourceDownloadFileName(props.data.title, previewOutput.fileName, previewOutput.mediaUrl, 'model'))} download={nodeResourceDownloadFileName(props.data.title, previewOutput.fileName, previewOutput.mediaUrl, 'model')}>导出</a>}
            </div>
          </div>
        </ModelNodeFloatingToolbar>}
        {false && props.selected && showWorkbench && activeRun && draft && <CharacterWorkbenchDock anchorRef={nodeAnchorRef} onDismiss={() => setShowWorkbench(false)}>
          {characterJobMatchesRun && (props.data.characterJobState === 'paused' || props.data.characterJobState === 'failed') && <div className="tripo-character-recovery" role="alert">
            <div><strong>{props.data.characterJobState === 'paused' ? '角色任务已暂停' : '角色任务失败'}</strong><span>{props.data.characterStatus || '可恢复已知远端任务；新建远端任务需要再次确认。'}</span></div>
            <button type="button" onClick={() => props.data.onResumeCharacterJob?.(props.id)}>恢复任务</button>
            <button type="button" className="is-danger" onClick={() => props.data.onRetryCharacterPaid?.(props.id)}>{props.data.activeCharacterOperation === 'rig-check' ? '重新检查' : '新建远端任务'}</button>
          </div>}
          <TripoCharacterWorkbench
            run={activeRun}
            draft={draft!}
            modelIds={{ rigCheck: model?.id || props.data.modelId || '', rig: model?.id || props.data.modelId || '', retarget: model?.id || props.data.modelId || '' }}
            sourceFormat={sourceFormat || ''}
            busyStage={busyStage}
            inspectionMode={inspectionMode}
            skeletonAvailable={skeletonAvailable}
            onDraftChange={(nextDraft) => props.data.onChange(props.id, { characterDrafts: { ...(props.data.characterDrafts || {}), [activeRun.id]: nextDraft } }, 'runtime')}
            onSubmit={(submission) => props.data.onRunTripoPostprocess?.(props.id, submission)}
            onAcceptRig={(runId, acceptedAt) => {
              props.data.onChange(props.id, {
                characterRuns: runs.map((run) => run.id === runId ? { ...run, acceptedAt } : run),
                characterDrafts: { ...(props.data.characterDrafts || {}), [runId]: { ...draft!, tab: 'animation' } },
              }, 'runtime');
              setPreviewStage('rig');
            }}
            onPreviewSelection={handlePreviewSelection}
            onClose={() => setShowWorkbench(false)}
          />
          {animationOutput && <section className="tripo-character-playback" aria-label="角色动画播放控制">
            <div className="tripo-character-playback__heading"><strong>动画预览</strong><span>{animationProgress.clip?.name || activeRun.selectedAnimationKey || '等待动画片段'}</span></div>
            <div className="tripo-character-playback__controls">
              <button type="button" onClick={() => setAnimationPlaying((value) => !value)}>{animationPlaying ? '暂停' : '播放'}</button>
              <button type="button" aria-pressed={animationLoop} onClick={() => setAnimationLoop((value) => !value)}>循环</button>
              <label><span>片段</span><select value={selectedAnimationClip ?? ''} onChange={(event) => setSelectedAnimationClip(Number(event.currentTarget.value))}>{animationClips.map((clip) => <option key={clip.index} value={clip.index}>{clip.name}</option>)}</select></label>
              <label><span>速度</span><select value={animationSpeed} onChange={(event) => setAnimationSpeed(Number(event.currentTarget.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label>
            </div>
            <label className="tripo-character-playback__timeline"><span>{animationProgress.currentTime.toFixed(1)}s</span><input type="range" min={0} max={Math.max(animationProgress.duration, .01)} step={.01} value={Math.min(animationProgress.currentTime, Math.max(animationProgress.duration, .01))} onChange={(event) => setAnimationSeekSeconds(Number(event.currentTarget.value))} /><span>{animationProgress.duration.toFixed(1)}s</span></label>
          </section>}
        </CharacterWorkbenchDock>}
        {animationOutput && <section className="character-node-playback-overlay nodrag nowheel" aria-label="角色动画播放控制" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => setAnimationPlaying((value) => !value)}>{animationPlaying ? '暂停' : '播放'}</button>
          <button type="button" aria-pressed={animationLoop} onClick={() => setAnimationLoop((value) => !value)}>循环</button>
          <label><span>片段</span><select value={selectedAnimationClip ?? ''} onChange={(event) => setSelectedAnimationClip(Number(event.currentTarget.value))}>{animationClips.map((clip) => <option key={clip.index} value={clip.index}>{clip.name}</option>)}</select></label>
          <label><span>速度</span><select value={animationSpeed} onChange={(event) => setAnimationSpeed(Number(event.currentTarget.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label>
          <label className="character-node-playback-overlay__timeline"><span>{animationProgress.currentTime.toFixed(1)}s</span><input type="range" min={0} max={Math.max(animationProgress.duration, .01)} step={.01} value={Math.min(animationProgress.currentTime, Math.max(animationProgress.duration, .01))} onChange={(event) => setAnimationSeekSeconds(Number(event.currentTarget.value))} /><span>{animationProgress.duration.toFixed(1)}s</span></label>
        </section>}
        {characterBusy && <GenerationActivityOverlay state={props.data.characterJobState} startedAt={props.data.jobStartedAt} />}
      </div> : <EmptyNodeState icon="character" label="等待 3D 模型" className="character-animator-empty" />}
    </div>
    <div className="node-hover-actions nodrag"><button onClick={() => props.data.onEditStart(props.id)} disabled={!activeRun}>编辑设置</button><button onClick={() => props.data.onDuplicate(props.id)}>克隆</button></div>
  </NodeShell>;
}

export function CharacterAnimatorEditorPanel({ id, data }: { id: string; data: CanvasNodeData }) {
  const runtime = characterAnimatorRuntime(data);
  const {
    runs, activeRun, draft, rigOutput, sourceFormat, inspectionMode, skeletonAvailable,
    characterBusy, characterJobMatchesRun, busyStage, model,
  } = runtime;

  useEffect(() => {
    const closeFromCanvasBlank = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (shouldDismissCharacterWorkbenchFromPointer(target, event.button)) data.onEditStart('');
    };
    document.addEventListener('pointerdown', closeFromCanvasBlank, true);
    return () => document.removeEventListener('pointerdown', closeFromCanvasBlank, true);
  }, [data.onEditStart]);

  const stateLabel = characterBusy
    ? data.characterJobState === 'queued' ? '任务排队中' : '远端任务处理中'
    : data.characterJobState === 'paused' ? '任务已暂停'
      : data.characterJobState === 'failed' ? '任务失败'
        : activeRun?.animationBatches.some((batch) => batch.status === 'succeeded') ? '动画已生成'
          : activeRun?.rig?.status === 'succeeded' ? '骨架已生成'
            : '等待设置';

  return <section className="generator-editor-panel character-generator-editor-panel nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
    <div className="generator-panel-connector" />
    <div className="generator-panel-quickbar character-generator-quickbar">
      <span className="generator-panel-kind"><b>◇</b>角色绑定与动画</span>
      <InputReferences id={id} data={data} compact />
      <span className="character-generator-source">{activeRun?.sourceLabel || '等待 3D 模型'}</span>
      <span className="character-generator-state" data-state={data.characterJobState || 'idle'}>{stateLabel}</span>
      <button type="button" className="character-generator-close ui-icon-button" aria-label="关闭角色生成器工作台" onClick={() => data.onEditStart('')}><UiIcon name="close" /></button>
    </div>
    {!activeRun || !draft
      ? <div className="character-generator-missing"><strong>还没有可用的来源模型</strong><span>从完成生成或重拓扑的 3D 模型节点点击“绑定动画”，系统会自动关联对应模型。</span></div>
      : <>
        {characterJobMatchesRun && (data.characterJobState === 'paused' || data.characterJobState === 'failed') && <div className="tripo-character-recovery" role="alert">
          <div><strong>{data.characterJobState === 'paused' ? '角色任务已暂停' : '角色任务失败'}</strong><span>{data.characterStatus || '可恢复已知远端任务；新建远端任务需要再次确认。'}</span></div>
          {data.activeCharacterOperation === 'rig-check'
            ? <button type="button" onClick={() => data.onRunTripoPostprocess?.(id, buildTripoRigCheckSubmission(activeRun, model?.id || data.modelId || ''))}>重新兼容检查</button>
            : <><button type="button" onClick={() => data.onResumeCharacterJob?.(id)}>恢复任务</button><button type="button" className="is-danger" onClick={() => data.onRetryCharacterPaid?.(id)}>新建远端任务</button></>}
        </div>}
        <TripoCharacterWorkbench
          run={activeRun}
          draft={draft}
          modelIds={{ rigCheck: model?.id || data.modelId || '', rig: model?.id || data.modelId || '', retarget: model?.id || data.modelId || '' }}
          sourceFormat={sourceFormat || ''}
          busyStage={busyStage}
          inspectionMode={inspectionMode}
          skeletonAvailable={skeletonAvailable}
          onDraftChange={(nextDraft) => data.onChange(id, { characterDrafts: { ...(data.characterDrafts || {}), [activeRun.id]: nextDraft } }, 'runtime')}
          onSubmit={(submission) => data.onRunTripoPostprocess?.(id, submission)}
          onAcceptRig={(runId, acceptedAt) => data.onChange(id, {
            characterRuns: runs.map((run) => run.id === runId ? { ...run, acceptedAt } : run),
            characterDrafts: { ...(data.characterDrafts || {}), [runId]: { ...draft, tab: 'animation' } },
            characterPreviewStage: 'rig',
          }, 'runtime')}
          onPreviewSelection={(selection) => data.onChange(id, {
            characterRuns: runs.map((run) => run.id === activeRun.id ? { ...run, selectedAnimationKey: selection.kind === 'animation' ? selection.key : run.selectedAnimationKey } : run),
            ...(selection.kind === 'pose' ? { selectedCharacterPose: selection.key } : {}),
            characterPreviewStage: selection.kind === 'animation' ? 'animation' : rigOutput ? 'rig' : 'source',
          }, 'runtime')}
          onClose={() => data.onEditStart('')}
        />
      </>}
  </section>;
}
const ImageGeneratorNode = memo(GeneratorNode);
const VideoGeneratorNode = memo(GeneratorNode);
const AudioGeneratorNode = memo(GeneratorNode);
const ModelGeneratorNode = memo(GeneratorNode);
const ComfyUiWorkflowNode = memo(GeneratorNode);
const CharacterAnimatorNode = memo(CharacterAnimatorNodeView);

type TurnaroundLineDrag = {
  pointerId: number;
  index: number;
};

function splitLinesFromCrops(crops: TurnaroundCrop[]) {
  return multiViewSplitLinesFromCrops(crops);
}

function TurnaroundCropPreview({ sourceUrl, crop, alt, sourceSize }: { sourceUrl: string; crop: TurnaroundCrop; alt: string; sourceSize: { width: number; height: number } }) {
  const cropAspect = sourceSize.width && sourceSize.height
    ? crop.width * sourceSize.width / (crop.height * sourceSize.height)
    : 1;
  return <div className="turnaround-crop-preview">
    <span className="turnaround-crop-preview-inner" style={cropAspect >= 1 ? { width: '100%', aspectRatio: `${cropAspect}` } : { height: '100%', aspectRatio: `${cropAspect}` }}>
      <img
        draggable={false}
        src={sourceUrl}
        alt={alt}
        style={{
          width: `${100 / crop.width}%`,
          height: `${100 / crop.height}%`,
          left: `${-crop.x * 100 / crop.width}%`,
          top: `${-crop.y * 100 / crop.height}%`,
        }}
      />
    </span>
  </div>;
}

function TurnaroundMaskCanvas({ sourceUrl, crop, viewIndex, strokes, brushSize, backgroundColor, previewColor, onStrokeComplete }: {
  sourceUrl: string;
  crop: TurnaroundCrop;
  viewIndex: number;
  strokes: TurnaroundMaskStroke[];
  brushSize: number;
  backgroundColor: string;
  previewColor: string;
  onStrokeComplete: (stroke: TurnaroundMaskStroke) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const strokeRef = useRef<TurnaroundMaskStroke | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const sourceX = crop.x * image.naturalWidth;
      const sourceY = crop.y * image.naturalHeight;
      const sourceWidth = Math.max(1, crop.width * image.naturalWidth);
      const sourceHeight = Math.max(1, crop.height * image.naturalHeight);
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const safeArea = canvas.width * 0.94;
      const scale = Math.min(safeArea / sourceWidth, safeArea / sourceHeight);
      const targetWidth = sourceWidth * scale;
      const targetHeight = sourceHeight * scale;
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, (canvas.width - targetWidth) / 2, (canvas.height - targetHeight) / 2, targetWidth, targetHeight);
      paintTurnaroundMaskStrokes(context, strokes, viewIndex, canvas.width, previewColor);
    };
    image.src = sourceUrl;
    return () => { cancelled = true; image.onload = null; };
  }, [backgroundColor, crop.height, crop.width, crop.x, crop.y, previewColor, sourceUrl, strokes, viewIndex]);

  const pointFor = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))),
    };
  };
  const moveBrushCursor = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    const point = pointFor(event);
    cursor.hidden = false;
    cursor.style.left = `${point.x * 100}%`;
    cursor.style.top = `${point.y * 100}%`;
  };
  const drawSegment = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.strokeStyle = previewColor;
    context.fillStyle = previewColor;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(2, brushSize * canvas.width);
    context.beginPath();
    context.moveTo(from.x * canvas.width, from.y * canvas.height);
    context.lineTo(to.x * canvas.width, to.y * canvas.height);
    context.stroke();
  };
  const beginStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFor(event);
    moveBrushCursor(event);
    strokeRef.current = { viewIndex, size: brushSize, points: [point] };
    drawSegment(point, point);
  };
  const moveStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    moveBrushCursor(event);
    const stroke = strokeRef.current;
    if (!stroke || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = pointFor(event);
    const previous = stroke.points[stroke.points.length - 1];
    stroke.points.push(point);
    drawSegment(previous, point);
  };
  const endStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current;
    if (!stroke) return;
    strokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onStrokeComplete({ ...stroke, points: [...stroke.points] });
  };

  return <div className="turnaround-mask-canvas-shell">
    <canvas
      ref={canvasRef}
      className="turnaround-mask-canvas nodrag nowheel"
      width={768}
      height={768}
      onPointerEnter={moveBrushCursor}
      onPointerDown={beginStroke}
      onPointerMove={moveStroke}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onPointerLeave={() => { if (cursorRef.current) cursorRef.current.hidden = true; }}
    />
    <span ref={cursorRef} hidden className="turnaround-brush-cursor" style={{ width: `${brushSize * 100}%`, height: `${brushSize * 100}%` }} aria-hidden="true" />
  </div>;
}

function TurnaroundSideRoleToggle({ value, onChange }: { value: TurnaroundSideRole; onChange: (value: TurnaroundSideRole) => void }) {
  return <button
    type="button"
    className="turnaround-side-role-toggle nodrag"
    data-side={value}
    role="switch"
    aria-checked={value === 'right'}
    aria-label={`当前为${value === 'left' ? '左侧' : '右侧'}，点击切换`}
    title={`切换为${value === 'left' ? '右侧' : '左侧'}`}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={() => onChange(value === 'left' ? 'right' : 'left')}
  ><i aria-hidden="true" /><span>左</span><span>右</span></button>;
}

function TurnaroundDirectionControl({ label, onOpen, overlay = false }: {
  label: string;
  onOpen: () => void;
  overlay?: boolean;
}) {
  return <div className={`turnaround-direction-control nodrag ${overlay ? 'is-overlay' : ''}`} onPointerDown={(event) => event.stopPropagation()}>
    <button type="button" className="turnaround-direction-open" title={`打开${label}擦除窗口`} onClick={onOpen}>{label}</button>
  </div>;
}

const TurnaroundSplitterNode = memo((props: NodeProps<CanvasNode>) => {
  // Keep the existing crop-detection version so old canvases retain their
  // manually adjusted three-view boundaries when the multi-view UI loads.
  const detectionVersion = 4;
  const sourceReference = props.data.inputReferences?.find((reference) => reference.type === 'image' && reference.mediaUrl);
  const sourceUrl = sourceReference?.mediaUrl || '';
  const sourceNodeId = sourceReference?.sourceId || '';
  const storedCrops = props.data.turnaroundCrops && props.data.turnaroundCrops.length >= multiViewCountLimits.min && props.data.turnaroundCrops.length <= multiViewCountLimits.max
    ? props.data.turnaroundCrops.map(normalizeTurnaroundCrop)
    : [];
  const storedViewCount = normalizeMultiViewCount(props.data.turnaroundViewCount || storedCrops.length || 3);
  const initialCrops = storedCrops.length === storedViewCount ? storedCrops : defaultMultiViewCrops(storedViewCount);
  const [editing, setEditing] = useState(false);
  const [viewCount, setViewCount] = useState(storedViewCount);
  const [maskEditorView, setMaskEditorView] = useState<number | null>(null);
  const [maskDraft, setMaskDraft] = useState<TurnaroundMaskStroke[]>([]);
  const [brushSize, setBrushSize] = useState(0.045);
  const [maskStrokes, setMaskStrokes] = useState<TurnaroundMaskStroke[]>(props.data.turnaroundMaskStrokes || []);
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });
  const [splitLines, setSplitLines] = useState<number[]>(() => splitLinesFromCrops(initialCrops));
  const [draftCrops, setDraftCrops] = useState<TurnaroundCrop[]>(initialCrops);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<TurnaroundLineDrag | null>(null);
  const splitLinesRef = useRef(splitLines);
  const sideRole: TurnaroundSideRole = props.data.turnaroundSideRole === 'right' ? 'right' : 'left';
  const labels = multiViewLabels(viewCount, sideRole);

  useEffect(() => {
    if (!dragRef.current && storedCrops.length >= multiViewCountLimits.min && storedCrops.length <= multiViewCountLimits.max) {
      const nextCount = normalizeMultiViewCount(props.data.turnaroundViewCount || storedCrops.length);
      const nextLines = splitLinesFromCrops(storedCrops);
      setViewCount(nextCount);
      splitLinesRef.current = nextLines;
      setSplitLines(nextLines);
      setDraftCrops(multiViewCropsFromSplitLines(nextLines));
    }
  }, [props.data.turnaroundCrops, props.data.turnaroundViewCount]);

  useEffect(() => {
    setMaskStrokes(props.data.turnaroundMaskStrokes || []);
  }, [props.data.turnaroundMaskStrokes]);

  useEffect(() => {
    if (!sourceUrl) return setSourceSize({ width: 0, height: 0 });
    const image = new Image();
    image.onload = () => {
      setSourceSize({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = sourceUrl;
    return () => { image.onload = null; };
  }, [sourceUrl]);

  useEffect(() => {
    if (maskEditorView === null) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMaskEditorView(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [maskEditorView]);

  useEffect(() => {
    if (!sourceUrl || (props.data.turnaroundSourceUrl === sourceUrl && props.data.turnaroundBackgroundColor)) return;
    let cancelled = false;
    void detectTurnaroundBackgroundColor(sourceUrl).then((color) => {
      if (!cancelled) props.data.onChange(props.id, { turnaroundBackgroundColor: color }, 'runtime');
    }).catch(() => {
      if (!cancelled) props.data.onChange(props.id, { turnaroundBackgroundColor: 'rgb(0, 0, 0)' }, 'runtime');
    });
    return () => { cancelled = true; };
  }, [props.data.turnaroundBackgroundColor, props.data.turnaroundSourceUrl, sourceUrl]);

  useEffect(() => {
    const sameSource = props.data.turnaroundSourceNodeId
      ? props.data.turnaroundSourceNodeId === sourceNodeId
      : props.data.turnaroundSourceUrl === sourceUrl;
    if (!sourceUrl || (sameSource && storedCrops.length === viewCount && props.data.turnaroundDetectionVersion === detectionVersion)) return;
    setError('');
    const nextCrops = defaultMultiViewCrops(viewCount);
    const nextLines = splitLinesFromCrops(nextCrops);
    splitLinesRef.current = nextLines;
    setSplitLines(nextLines);
    setDraftCrops(nextCrops);
    setMaskStrokes([]);
    props.data.onChange(props.id, {
      turnaroundSourceUrl: sourceUrl,
      turnaroundSourceNodeId: sourceNodeId,
      turnaroundCrops: nextCrops,
      turnaroundViewCount: viewCount,
      turnaroundConfidence: 1,
      turnaroundDetectionVersion: detectionVersion,
      turnaroundSideRole: sideRole,
      turnaroundConfirmed: false,
      turnaroundViews: undefined,
      turnaroundMaskStrokes: [],
      outputType: undefined,
      status: `拖动 ${viewCount - 1} 道竖线确定 ${viewCount} 个视图`,
    }, 'runtime');
  }, [props.data.turnaroundDetectionVersion, props.data.turnaroundSourceNodeId, props.data.turnaroundSourceUrl, sourceNodeId, sourceUrl, viewCount]);

  const invalidateResult = (crops: TurnaroundCrop[], nextSideRole = sideRole, extra: Partial<CanvasNodeData> = {}) => {
    props.data.onChange(props.id, {
      turnaroundCrops: crops,
      turnaroundViewCount: crops.length,
      turnaroundSideRole: nextSideRole,
      turnaroundConfirmed: false,
      turnaroundViews: undefined,
      outputType: undefined,
      status: '调整后请重新确认切分',
      ...extra,
    });
  };

  const beginDrag = (event: ReactPointerEvent, index: number) => {
    if (!stageRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    stageRef.current.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, index };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage || drag.pointerId !== event.pointerId) return;
    const rect = stage.getBoundingClientRect();
    const position = (event.clientX - rect.left) / Math.max(1, rect.width);
    const current = splitLinesRef.current;
    const minimumWidth = Math.min(0.08, 0.8 / viewCount);
    const lower = (drag.index === 0 ? 0 : current[drag.index - 1]) + minimumWidth;
    const upper = (drag.index === current.length - 1 ? 1 : current[drag.index + 1]) - minimumWidth;
    const next = current.map((line, index) => index === drag.index ? Math.min(upper, Math.max(lower, position)) : line);
    splitLinesRef.current = next;
    setSplitLines(next);
    setDraftCrops(multiViewCropsFromSplitLines(next));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (stageRef.current?.hasPointerCapture(event.pointerId)) stageRef.current.releasePointerCapture(event.pointerId);
    const nextCrops = multiViewCropsFromSplitLines(splitLinesRef.current);
    setDraftCrops(nextCrops);
    setMaskStrokes([]);
    invalidateResult(nextCrops, sideRole, { turnaroundMaskStrokes: [] });
  };

  const chooseSideRole = (nextSideRole: TurnaroundSideRole) => {
    if (nextSideRole === sideRole) return;
    invalidateResult(draftCrops, nextSideRole);
  };

  const changeViewCount = (delta: number) => {
    const nextCount = normalizeMultiViewCount(viewCount + delta);
    if (nextCount === viewCount) return;
    const nextCrops = defaultMultiViewCrops(nextCount);
    const nextLines = splitLinesFromCrops(nextCrops);
    setViewCount(nextCount);
    setEditing(true);
    setMaskEditorView(null);
    setMaskStrokes([]);
    splitLinesRef.current = nextLines;
    setSplitLines(nextLines);
    setDraftCrops(nextCrops);
    props.data.onChange(props.id, {
      turnaroundViewCount: nextCount,
      turnaroundCrops: nextCrops,
      turnaroundMaskStrokes: [],
      turnaroundConfirmed: false,
      turnaroundViews: undefined,
      outputType: undefined,
      status: `已调整为 ${nextCount} 个视图，请拖动切分线`,
    });
  };

  const updateMaskStrokes = (next: TurnaroundMaskStroke[]) => {
    setMaskStrokes(next);
    props.data.onChange(props.id, {
      turnaroundMaskStrokes: next,
      turnaroundConfirmed: false,
      turnaroundViews: undefined,
      outputType: undefined,
      status: next.length ? '已添加画笔擦除蒙版，请确认切分' : '擦除蒙版已清空',
    });
  };
  const openMaskEditor = (viewIndex: number) => {
    setMaskDraft(maskStrokes.filter((stroke) => stroke.viewIndex === viewIndex));
    setMaskEditorView(viewIndex);
  };
  const confirmMaskEditor = () => {
    if (maskEditorView === null) return;
    updateMaskStrokes([
      ...maskStrokes.filter((stroke) => stroke.viewIndex !== maskEditorView),
      ...maskDraft,
    ]);
    setMaskEditorView(null);
  };

  const confirm = async () => {
    if (!sourceUrl || draftCrops.length !== viewCount || confirming) return;
    setConfirming(true);
    setError('');
    try {
      await props.data.onConfirmTurnaroundSplit?.(props.id, draftCrops, sideRole);
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '多视图切分失败');
    } finally {
      setConfirming(false);
    }
  };

  const activeViews = props.data.turnaroundConfirmed && props.data.turnaroundViews?.length === viewCount
    ? props.data.turnaroundViews
    : null;
  const showSplitEditor = !activeViews || editing;
  const downloadViews = async () => {
    if (!activeViews || downloading) return;
    setDownloading(true);
    setError('');
    try {
      const baseName = tripoAssetBaseName(props.data.title, '多视图');
      const entries = await Promise.all(activeViews.map(async (view, index) => {
        const response = await fetch(new URL(view.mediaUrl, window.location.href), { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`${labels[index] || view.role}图片读取失败（HTTP ${response.status}）`);
        return { name: `${baseName}/${baseName}_${view.role}.png`, blob: await response.blob() };
      }));
      downloadBlob(await createStoredZip(entries), `${baseName}_多视图.zip`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '多视图下载失败');
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (activeViews && !editing) props.data.onFitTurnaroundConfirmed?.(props.id);
  }, [activeViews, editing, props.data.onFitTurnaroundConfirmed, props.id]);

  const stageAspectRatio = sourceSize.width && sourceSize.height ? `${sourceSize.width} / ${sourceSize.height}` : '16 / 9';
  const zoneWidths = draftCrops.map((crop) => crop.width);
  const zoneLefts = draftCrops.map((crop) => crop.x);
  const backgroundColor = props.data.turnaroundBackgroundColor || 'rgb(0, 0, 0)';
  const maskPreviewColor = 'rgba(255, 94, 76, .72)';

  return <>
    <NodeShell {...props}>
      <section className={`turnaround-splitter ${editing ? 'is-editing' : ''}`}>
        <header><div><strong>多视图切分</strong><span>{activeViews ? `已确认 ${activeViews.length} 张图片` : props.data.status || '等待图片输入'}</span></div><div className="turnaround-view-count nodrag" aria-label="切分视图数量"><button type="button" aria-label="减少一个视图" disabled={viewCount <= multiViewCountLimits.min || confirming} onClick={() => changeViewCount(-1)}>−</button><b>{viewCount}</b><button type="button" aria-label="增加一个视图" disabled={viewCount >= multiViewCountLimits.max || confirming} onClick={() => changeViewCount(1)}>+</button></div>{activeViews && viewCount === 3 && <em>可连接 Tripo3D</em>}</header>
        {!sourceUrl ? <EmptyNodeState icon="split" label="等待多视图图片" className="turnaround-empty" /> : showSplitEditor ? <>
          <div
            ref={stageRef}
            className="turnaround-adjust-stage nodrag nowheel"
            style={{ aspectRatio: stageAspectRatio }}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <img draggable={false} src={sourceUrl} alt="多视图原图" onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              setSourceSize({ width: naturalWidth, height: naturalHeight });
              props.data.onTurnaroundSourceSize?.(props.id, naturalWidth, naturalHeight);
            }} />
            {labels.map((label, index) => <div key={`${label}-${index}`} className={`turnaround-split-zone zone-${index + 1}`} style={{ left: `${zoneLefts[index] * 100}%`, width: `${zoneWidths[index] * 100}%` }}>
              <TurnaroundDirectionControl label={label} overlay onOpen={() => openMaskEditor(index)} />
            </div>)}
            {splitLines.map((line, index) => <button key={index} type="button" className="turnaround-split-line" aria-label={`切分线 ${index + 1}`} style={{ left: `${line * 100}%` }} onPointerDown={(event) => beginDrag(event, index)}><i /></button>)}
          </div>
          {viewCount === 3 && <div className="turnaround-side-role-row nodrag"><span>侧面方向</span><TurnaroundSideRoleToggle value={sideRole} onChange={chooseSideRole} /></div>}
          <p className="turnaround-adjust-hint"><strong>拖动 {viewCount - 1} 道竖线完成切分。</strong><span>点击视图名称可单独擦除越界元素。</span></p>
        </> : <>
        <div className="turnaround-view-grid" style={{ gridTemplateColumns: `repeat(${Math.min(4, viewCount)}, minmax(0, 1fr))` }}>
          {activeViews.map((view, index) => <article key={`${view.role}-${index}`}>
            <div className="turnaround-crop-preview confirmed"><img draggable={false} src={view.mediaUrl} alt={labels[index]} /></div>
            <TurnaroundDirectionControl label={labels[index]} onOpen={() => openMaskEditor(index)} />
          </article>)}
        </div>
        {viewCount === 3 && <div className="turnaround-side-role-row nodrag"><span>侧面方向</span><TurnaroundSideRoleToggle value={sideRole} onChange={chooseSideRole} /></div>}
        </>}
        {error && <p className="turnaround-error" role="alert">{error}</p>}
        {sourceUrl && <footer className="nodrag">
          {showSplitEditor
            ? <button type="button" className="primary" disabled={draftCrops.length !== viewCount || confirming} onClick={() => void confirm()}>{confirming ? '切分中…' : `确认切分 ${viewCount} 张`}</button>
            : <><button type="button" onClick={() => setEditing(true)}>重新调整</button><button type="button" className="turnaround-download-button" disabled={downloading} onClick={() => void downloadViews()}>{downloading ? '打包中…' : '下载多视图'}</button>{!props.data.publicMode && <button type="button" className="primary" onClick={() => props.data.onPlaceTurnaroundImages?.(props.id)}>在右侧放置图片节点</button>}</>}
        </footer>}
      </section>
    </NodeShell>
    {maskEditorView !== null && typeof document !== 'undefined' && createPortal(<div className="turnaround-mask-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) setMaskEditorView(null);
    }}>
      <section className="turnaround-mask-dialog nodrag nowheel" role="dialog" aria-modal="true" aria-label={`${labels[maskEditorView]}擦除编辑`} onPointerDown={(event) => event.stopPropagation()}>
        <header>
          <div><strong>{labels[maskEditorView]} · 擦除越界元素</strong><span>红色蒙版表示确认后会被背景色覆盖的区域</span></div>
          <button type="button" className="ui-icon-button" aria-label="关闭擦除窗口" title="关闭" onClick={() => setMaskEditorView(null)}><UiIcon name="close" /></button>
        </header>
        <div className="turnaround-mask-dialog-toolbar">
          <label className="turnaround-brush-size"><strong>画笔大小</strong><input type="range" min="2" max="12" step="1" value={Math.round(brushSize * 100)} onChange={(event) => setBrushSize(Number(event.target.value) / 100)} /><span>{Math.round(brushSize * 100)}</span></label>
          <button type="button" disabled={!maskDraft.length} onClick={() => setMaskDraft((current) => current.slice(0, -1))}>撤销一笔</button>
          <button type="button" disabled={!maskDraft.length} onClick={() => setMaskDraft([])}>清空</button>
        </div>
        <div className="turnaround-mask-dialog-canvas">
          <TurnaroundMaskCanvas sourceUrl={sourceUrl} crop={draftCrops[maskEditorView]} viewIndex={maskEditorView} strokes={maskDraft} brushSize={brushSize} backgroundColor={backgroundColor} previewColor={maskPreviewColor} onStrokeComplete={(stroke) => setMaskDraft((current) => [...current, stroke])} />
        </div>
        <div className="turnaround-mask-dialog-note"><i style={{ background: maskPreviewColor }} /><span><strong>红色区域将被擦除</strong>，输出时自动填充原图背景色。</span><span className="turnaround-background-swatch" title="识别到的背景色" style={{ background: backgroundColor }} /></div>
        <footer><button type="button" onClick={() => setMaskEditorView(null)}>取消</button><button type="button" className="primary" onClick={confirmMaskEditor}>确认擦除</button></footer>
      </section>
    </div>, document.body)}
  </>;
});

const ResultNode = memo((props: NodeProps<CanvasNode>) => {
  const [showTripoWorkbench, setShowTripoWorkbench] = useState(false);
  const versions = props.data.resultVersions || [];
  const activeVersion = versions[props.data.selectedVersion ?? Math.max(0, versions.length - 1)];
  const outputs = activeVersion?.outputs || props.data.outputs || (props.data.mediaUrl ? [{ mediaUrl: props.data.mediaUrl, fileName: props.data.fileName }] : []);
  const selected = Math.min(props.data.selectedOutput || 0, Math.max(0, outputs.length - 1));
  const current = outputs[selected]; const mediaUrl = current?.mediaUrl || props.data.mediaUrl; const previewUrl = current?.previewUrl; const fileName = current?.fileName || props.data.fileName;
  const previewFormat = previewableModelFormat(current || (mediaUrl ? { mediaUrl, fileName } : undefined));
  const sourceTripoTaskId = current?.tripoTaskId || '';
  const sourceModelFormat = String(current?.format || fileName?.match(/\.([a-z0-9]+)(?:$|[?#])/i)?.[1] || '').toLowerCase();
  const tripoPresets = (props.data.models || []).filter((model) => model.capability === 'model' && model.adapter === 'tripo3d-model').map((model) => ({ id: model.id, name: model.name }));
  const postprocessBusy = props.data.jobState === 'queued' || props.data.jobState === 'running' || props.data.jobState === 'cancelling';
  const dimensions = current?.width && current?.height ? `${current.width}×${current.height}` : '';
  const outputType = props.data.outputType || props.data.mediaType;
  const isImageResult = activeVersion?.mediaType === 'image'
    || outputType === 'image'
    || (!outputType && Boolean(mediaUrl));
  const stateLabel = props.data.resultState === 'submitted' ? '已提交交付' : props.data.resultState === 'final' ? '最终成果' : props.data.resultState === 'candidate' ? '候选结果' : '生成结果';
  const deliveryMediaType = outputType === 'video' ? 'video' : outputType === 'audio' ? 'audio' : outputType === 'model' ? 'model' : 'image';
  const downloadName = nodeResourceDownloadFileName(props.data.title, fileName, mediaUrl, deliveryMediaType);
  const lodLevel = props.selected ? 'high' : props.data.mediaLodLevel || 'high';
  const hasImageHand = isImageResult && outputs.filter(output => output.mediaUrl).length > 1;
  return <NodeShell {...props} titleFallback="生成结果" titleMeta={dimensions || stateLabel}>
    <div className={`result-card-stage ${outputType === 'video' ? 'has-video' : outputType === 'audio' ? 'has-audio' : outputType === 'model' ? 'has-model' : ''}${hasImageHand ? ' has-image-hand' : ''}`}>
      {hasImageHand ? <CanvasImageResultHand outputs={outputs} selected={selected} lodLevel={lodLevel}
        onSelect={index => { const output = outputs[index]; props.data.onChange(props.id, { selectedOutput: index, mediaUrl: output.mediaUrl, previewUrl: output.previewUrl, fileName: output.fileName, mediaWidth: output.width, mediaHeight: output.height }); }}
        onMediaSize={(width, height) => props.data.onMediaSize?.(props.id, width, height)} /> : mediaUrl ? (outputType === 'video'
        ? <CanvasVideoPlayer className="media-preview" src={mediaUrl} poster={previewUrl || props.data.previewUrl} lodLevel={lodLevel} onSelect={() => props.data.onEditStart(props.id)} onLoadedMetadata={(video) => props.data.onMediaSize?.(props.id, video.videoWidth, video.videoHeight)} onCaptureFrame={(file, width, height, label) => props.data.onCaptureVideoFrame?.(props.id, file, width, height, label)} onContinueFromTail={(file, width, height) => props.data.onContinueVideoFromFrame?.(props.id, file, width, height)} />
        : outputType === 'audio'
          ? <AudioWaveformPlayer className="result-audio-player" src={mediaUrl} onDuration={(duration) => { if (props.data.mediaDuration !== duration) props.data.onChange(props.id, { mediaDuration: duration }, 'runtime'); }} />
        : outputType === 'model'
          ? <div className="result-model-preview">{previewFormat ? <TripoModelViewer src={mediaUrl} format={previewFormat} poster={previewUrl} alt={fileName || '3D 模型预览'} /> : previewUrl ? <img className="media-preview result-main node-media-surface" draggable={false} src={previewUrl} alt={fileName || '3D 模型预览'} onLoad={(event) => props.data.onMediaSize?.(props.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} /> : <div className="result-placeholder"><strong>模型已生成，此格式请下载查看</strong></div>}<a className="model-preview-download nodrag" href={canvasAssetDownloadUrl(mediaUrl, downloadName)} download={downloadName}>下载模型</a></div>
          : <CanvasLodImage className="media-preview result-main node-media-surface" src={mediaUrl} previewUrl={previewUrl || props.data.previewUrl} lodLevel={lodLevel} alt={fileName || '结果'} onLoad={(image) => { if (!current?.width || !current?.height) props.data.onMediaSize?.(props.id, image.naturalWidth, image.naturalHeight); }} />) : <EmptyNodeState icon="result" label={props.data.simulated ? '演示结果暂无媒体' : '等待生成结果'} className="result-placeholder" />}
    </div>
    {props.selected && versions.length > 1 && <div className="result-version-strip nodrag"><span>历史版本</span>{versions.map((version, index) => <button key={version.jobId} className={index === (props.data.selectedVersion ?? versions.length - 1) ? 'active' : ''} onClick={() => props.data.onSelectResultVersion(props.id, index)}>V{index + 1}</button>)}</div>}
    {props.selected && !hasImageHand && outputs.length > 1 && <div className="result-gallery nodrag">{outputs.map((output, index) => <button key={`${output.mediaUrl}-${index}`} className={index === selected ? 'active' : ''} onClick={() => props.data.onChange(props.id, { selectedOutput: index, mediaUrl: output.mediaUrl, previewUrl: output.previewUrl, fileName: output.fileName })}>{output.previewUrl || output.mediaUrl ? <img draggable={false} loading="lazy" decoding="async" onDragStart={(event) => event.preventDefault()} src={canvasImagePreviewUrl(output.mediaUrl, output.previewUrl)} alt={`结果 ${index + 1}`} /> : <span>{index + 1}</span>}</button>)}</div>}
    {!props.selected && <div className="node-hover-actions nodrag">{mediaUrl && (props.data.publicMode ? <MediaDeliveryActions mediaUrl={mediaUrl} fileName={fileName} nodeTitle={props.data.title} mediaType={deliveryMediaType} previewUrl={previewUrl} /> : <a href={canvasAssetDownloadUrl(mediaUrl, downloadName)} download={downloadName}><UiActionContent icon="download">下载</UiActionContent></a>)}{!props.data.publicMode && <button onClick={() => props.data.onSetResultState(props.id, props.data.resultState === 'candidate' ? 'output' : 'candidate')}><UiActionContent icon="candidate">{props.data.resultState === 'candidate' ? '取消' : '候选'}</UiActionContent></button>}</div>}
    {props.selected && <div className="node-editor result-editor nodrag"><div className="result-actions">{mediaUrl && (props.data.publicMode ? <MediaDeliveryActions mediaUrl={mediaUrl} fileName={fileName} nodeTitle={props.data.title} mediaType={deliveryMediaType} previewUrl={previewUrl} /> : <a className="node-button" href={canvasAssetDownloadUrl(mediaUrl, downloadName)} download={downloadName}><UiActionContent icon="download">下载</UiActionContent></a>)}{!props.data.publicMode && <>{sourceTripoTaskId && <button className={`node-button tripo-postprocess-entry ${showTripoWorkbench ? 'marked' : ''}`} disabled={!tripoPresets.length} title={tripoPresets.length ? '打开 Tripo3D 模型后处理工作台' : '需要先启用 Tripo3D 模型预设'} onClick={() => setShowTripoWorkbench((value) => !value)}><UiActionContent icon="model3d">后处理</UiActionContent></button>}<button className={`node-button ${props.data.resultState === 'candidate' ? 'marked' : ''}`} onClick={() => props.data.onSetResultState(props.id, 'candidate')}><UiActionContent icon="candidate">候选</UiActionContent></button><button className={`node-button ${props.data.resultState === 'final' ? 'marked' : ''}`} onClick={() => props.data.onSetResultState(props.id, 'final')}><UiActionContent icon="final">最终</UiActionContent></button><button className={`node-button ${props.data.resultState === 'submitted' ? 'marked' : ''}`} onClick={() => props.data.onSetResultState(props.id, 'submitted')}><UiActionContent icon="submitted">已提交</UiActionContent></button>{outputType !== 'model' && <><button className="node-button" title="发送到图片生成" onClick={() => props.data.onSend(props.id, 'imageGenerator')}><UiActionContent icon="imageGenerate">图片</UiActionContent></button><button className="node-button" title="发送到视频生成" onClick={() => props.data.onSend(props.id, 'videoGenerator')}><UiActionContent icon="videoGenerate">视频</UiActionContent></button></>}</>}</div></div>}
    {props.selected && showTripoWorkbench && sourceTripoTaskId && <TripoPostprocessWorkbench sourceTaskId={sourceTripoTaskId} sourceFormat={sourceModelFormat} presets={tripoPresets} busy={postprocessBusy} result={props.data.tripoPostprocessResult} onClose={() => setShowTripoWorkbench(false)} onSubmit={(submission) => props.data.onRunTripoPostprocess?.(props.id, submission)} />}
    {props.selected && props.data.tripoPostprocessResult?.operation === 'rig-check' && typeof props.data.tripoPostprocessResult.riggable === 'boolean' && <div className={`tripo-rig-check-inline ${props.data.tripoPostprocessResult.riggable ? 'success' : 'failure'}`}><strong>{props.data.tripoPostprocessResult.riggable ? '绑定检查：可绑定' : '绑定检查：不可绑定'}</strong><span>{props.data.tripoPostprocessResult.rigType ? `建议骨架 ${props.data.tripoPostprocessResult.rigType}` : '未返回建议骨架类型'}</span></div>}
    {props.selected && props.data.tripoPostprocessOperation && (props.data.jobState === 'paused' || props.data.jobState === 'failed') && <div className="tripo-postprocess-recovery nodrag" role="alert"><div><strong>{props.data.jobState === 'paused' ? '后处理任务已暂停' : '后处理任务失败'}</strong><span>{props.data.status}</span></div><button type="button" onClick={() => props.data.onResume?.(props.id)}>恢复远端任务</button><button type="button" className="danger" onClick={() => props.data.onRetryPaid?.(props.id)}>新建远端任务</button></div>}
  </NodeShell>;
});

const CollectionNode = memo((props: NodeProps<CanvasNode>) => {
  const members = props.data.memberIds || [];
  const inputs = props.data.collectionInputs || [];
  const updateCollectionInternals = useUpdateNodeInternals();
  const portLayout = inputs.map(input => input.id).join('|');
  useEffect(() => {
    const frame = requestAnimationFrame(() => updateCollectionInternals(props.id));
    return () => cancelAnimationFrame(frame);
  }, [props.id, portLayout, props.data.collapsed, updateCollectionInternals]);
  const collapsed = Boolean(props.data.collapsed);
  const state = props.data.workflowState || 'idle';
  const active = state === 'running' || state === 'cancelling';
  const contentFrame = props.data.collectionContentFrame;
  const shouldResizeAroundContent = (_event: unknown, params: { x: number; y: number; width: number; height: number }) => {
    if (!contentFrame) return true;
    const tolerance = 1;
    return params.x <= contentFrame.position.x + tolerance
      && params.y <= contentFrame.position.y + tolerance
      && params.x + params.width >= contentFrame.position.x + contentFrame.width - tolerance
      && params.y + params.height >= contentFrame.position.y + contentFrame.height - tolerance;
  };
  const stateLabel = state === 'running' ? '执行中'
    : state === 'cancelling' ? '已停止'
      : state === 'succeeded' ? '已完成'
        : state === 'failed' ? '执行失败'
          : state === 'cancelled' ? '已取消' : '可执行流程';
  return <div className={`collection-node${collapsed ? ' is-collapsed' : ''} workflow-${state}`} style={canvasNodeRadiusStyle(props.width, props.height)} onDoubleClick={(event) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, .nodrag')) return;
    event.stopPropagation();
    props.data.onSetCollectionCollapsed?.(props.id, !collapsed);
  }}>
    {inputs.length > 0 && <div className={`collection-input-port-rail nodrag nowheel${inputs.length > 8 ? ' is-dense' : ''}`} aria-label="组合输入端口">
      {inputs.map((input, index) => <div key={input.id} className="collection-input-row">
        <Handle className={`collection-input-port type-${input.type}`} type="target" position={Position.Left}
          id={`collection-input-slot:${input.id}`} isConnectable={!active}
          title={`替换「${input.label}」 · 同步 ${input.usageCount} 处引用 · 不会修改原素材`}
          aria-label={`替换${input.label}`} />
        <span className="collection-input-label"><b>{index + 1}</b>
          {input.mediaUrl && input.type === 'image' ? <img src={canvasImagePreviewUrl(input.mediaUrl)} alt="" draggable={false} /> : <UiIcon name={input.type === 'text' ? 'text' : input.type === 'audio' ? 'audio' : input.type === 'video' ? 'video' : 'image'} />}
          <span><strong>{input.label}</strong><small>{input.usageCount} 处引用 · 拖入替换</small></span>
        </span>
      </div>)}

    </div>}
    {collapsed && Number(props.data.collectionOutputCount) > 0 && <Handle className="collection-proxy-handle collection-proxy-output" type="source" position={Position.Right} id="collection-output" isConnectable={false} />}
    {!collapsed && <NodeResizer isVisible={props.selected} minWidth={Math.max(280, contentFrame?.width || 0)} minHeight={Math.max(160, contentFrame?.height || 0)} shouldResize={shouldResizeAroundContent} lineClassName="canvas-node-resize-line" handleClassName="canvas-node-resize-handle" onResizeStart={() => props.data.onResizeStart?.(props.id)} />}
    <header className="collection-node-heading">
      <div className="collection-drag-handle"><UiIcon name="collection" className="node-title-type-icon" /><InlineNodeTitle id={props.id} data={props.data} fallback="未命名收纳" /><span>{members.length} 个节点</span></div>
      <em>{stateLabel}</em>
      {props.data.executable !== false && <div className="collection-run-actions nodrag nowheel">
        {active
          ? <span className="collection-running-label">执行中</span>
          : <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); props.data.onRunCollection?.(props.id); }}>运行</button>}
      </div>}
    </header>
    {collapsed ? <div className="collection-collapsed-body">
      <div className="collection-collapsed-summary"><span>输入 {inputs.length}</span><b>{props.data.workflowStatus || '双击展开'}</b><span>输出 {props.data.collectionOutputCount || 0}</span></div>
    </div>
      : <div className={`collection-workflow-status is-${state}`}><div><span>{props.data.workflowStatus || '双击标题栏收起；右键管理收纳'}</span><strong>{Math.round(Number(props.data.workflowProgress) || 0)}%</strong></div><i><span style={{ width: `${Math.max(0, Math.min(100, Number(props.data.workflowProgress) || 0))}%` }} /></i></div>}
  </div>;
});

const UnsupportedNode = memo((props: NodeProps<CanvasNode>) => <div className="canvas-node node-unsupported" style={canvasNodeRadiusStyle(props.width, props.height)} role="alert">
  <span className="node-error-label"><UiIcon name="info" className="node-title-type-icon" />UNSUPPORTED</span>
  <strong>{props.data.title || '无法识别的历史节点'}</strong>
  <p>该节点类型无法安全显示，已隔离处理，不会影响画布中的其他节点。</p>
  {props.data.unsupportedType && <code>原类型：{props.data.unsupportedType}</code>}
  <div className="node-error-actions nodrag">
    <button className="danger" onClick={() => props.data.onDelete(props.id)}>删除节点</button>
  </div>
</div>);

type NodeBoundaryProps = {
  nodeId: string;
  onDelete?: (id: string) => void;
  children: ReactNode;
};

type NodeBoundaryState = {
  error: Error | null;
  resetKey: number;
};

class NodeErrorBoundary extends Component<NodeBoundaryProps, NodeBoundaryState> {
  state: NodeBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<NodeBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Canvas node ${this.props.nodeId} failed`, error, info.componentStack);
  }

  retry = () => {
    this.setState((state) => ({ error: null, resetKey: state.resetKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return <div className="canvas-node node-error" role="alert">
        <span className="node-error-label">NODE ERROR</span>
        <strong>节点显示失败</strong>
        <p>该节点发生异常，其他节点仍可继续使用。</p>
        <code>{this.state.error.message || '未知节点错误'}</code>
        <div className="node-error-actions nodrag">
          <button onClick={this.retry}>重试显示</button>
          {this.props.onDelete && <button className="danger" onClick={() => this.props.onDelete?.(this.props.nodeId)}>删除节点</button>}
        </div>
      </div>;
    }

    return <div key={this.state.resetKey} className="node-boundary-root">{this.props.children}</div>;
  }
}

function withNodeErrorBoundary(NodeComponent: ComponentType<NodeProps<CanvasNode>>) {
  return memo((props: NodeProps<CanvasNode>) => <NodeErrorBoundary nodeId={props.id} onDelete={props.data.onDelete}>
    <NodeComponent {...props} />
  </NodeErrorBoundary>);
}

export const nodeTypes = {
  text: withNodeErrorBoundary(TextNode),
  image: withNodeErrorBoundary(ImageNode),
  video: withNodeErrorBoundary(VideoNode),
  audio: withNodeErrorBoundary(AudioNode),
  imageGenerator: withNodeErrorBoundary(ImageGeneratorNode),
  videoGenerator: withNodeErrorBoundary(VideoGeneratorNode),
  audioGenerator: withNodeErrorBoundary(AudioGeneratorNode),
  modelGenerator: withNodeErrorBoundary(ModelGeneratorNode),
  comfyUiWorkflow: withNodeErrorBoundary(ComfyUiWorkflowNode),
  characterAnimator: withNodeErrorBoundary(CharacterAnimatorNode),
  turnaroundSplitter: withNodeErrorBoundary(TurnaroundSplitterNode),
  result: withNodeErrorBoundary(ResultNode),
  collection: withNodeErrorBoundary(CollectionNode),
  unsupported: withNodeErrorBoundary(UnsupportedNode),
};
