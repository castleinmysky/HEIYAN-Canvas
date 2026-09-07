import type { TripoPostprocessSubmission } from './components/TripoPostprocessWorkbench';

export const TRIPO_ANIMATION_BATCH_LIMIT = 5;

export type TripoRigModel = 'v1.0-20240301' | 'v2.5-20260210';
export type TripoRigType = 'biped' | 'quadruped' | 'hexapod' | 'octopod' | 'avian' | 'serpentine' | 'aquatic';
export type TripoRigSpec = 'tripo' | 'mixamo';
export type TripoCharacterOutputFormat = 'glb' | 'fbx';
export type TripoAnimationCategory = 'locomotion' | 'combat' | 'emotion' | 'social' | 'sport' | 'dance' | 'daily';

export type TripoAnimationPreset = {
  key: string;
  label: string;
  category: TripoAnimationCategory;
  rigModel: TripoRigModel;
  rigTypes: TripoRigType[];
};

const V1_BIPED_PRESET_IDS = [
  'preset:biped:afraid', 'preset:biped:agree', 'preset:biped:angry_01', 'preset:biped:angry_02', 'preset:biped:angry_03',
  'preset:biped:basketball_shot', 'preset:biped:bow', 'preset:biped:box_01', 'preset:biped:box_02', 'preset:biped:box_03',
  'preset:biped:cast_a_spell', 'preset:biped:cheer', 'preset:biped:chop', 'preset:biped:clap', 'preset:biped:climb',
  'preset:biped:complain_01', 'preset:biped:complain_02', 'preset:biped:cross_body_crunch', 'preset:biped:crossover_dribble',
  'preset:biped:cry', 'preset:biped:dance_01', 'preset:biped:dance_02', 'preset:biped:dance_03', 'preset:biped:dance_04',
  'preset:biped:dance_05', 'preset:biped:dance_06', 'preset:biped:defeat_02', 'preset:biped:defeat_03', 'preset:biped:depressed',
  'preset:biped:dig', 'preset:biped:dive', 'preset:biped:dribble', 'preset:biped:fall', 'preset:biped:fire',
  'preset:biped:flee_01', 'preset:biped:flee_02', 'preset:biped:flip', 'preset:biped:fold_arms', 'preset:biped:football_catch',
  'preset:biped:football_save', 'preset:biped:football_pass', 'preset:biped:freaky', 'preset:biped:frightened',
  'preset:biped:front_kick_01', 'preset:biped:front_kick_02', 'preset:biped:frustrated_01', 'preset:biped:frustrated_02',
  'preset:biped:golf', 'preset:biped:greet_01', 'preset:biped:greet_02', 'preset:biped:greet_03', 'preset:biped:greet_04',
  'preset:biped:heart_pose', 'preset:biped:hit_to_body_01', 'preset:biped:hit_to_body_02', 'preset:biped:hit_to_head',
  'preset:biped:hit_to_side', 'preset:biped:hit_to_stomach', 'preset:biped:hug', 'preset:biped:hurt', 'preset:biped:idle',
  'preset:biped:jump_down', 'preset:biped:jump', 'preset:biped:jump_rope_01', 'preset:biped:jump_rope_02',
  'preset:biped:laugh_01', 'preset:biped:laugh_02', 'preset:biped:lift_heavy', 'preset:biped:look_around',
  'preset:biped:make_a_call_01', 'preset:biped:make_a_call_02', 'preset:biped:pitch_baseball',
  'preset:biped:play_mobile_game', 'preset:biped:play_video_game', 'preset:biped:press-up', 'preset:biped:run_upstairs',
  'preset:biped:run', 'preset:biped:scared_01', 'preset:biped:scared_02', 'preset:biped:scratch', 'preset:biped:shoot',
  'preset:biped:shovel', 'preset:biped:sing_01', 'preset:biped:sing_02', 'preset:biped:sing_03', 'preset:biped:sing_04',
  'preset:biped:sit', 'preset:biped:slash', 'preset:biped:sob', 'preset:biped:standing_relax', 'preset:biped:surf',
  'preset:biped:swagger', 'preset:biped:swim', 'preset:biped:turn', 'preset:biped:victory_celebration',
  'preset:biped:volleyball', 'preset:biped:wait', 'preset:biped:walk', 'preset:biped:warm_up',
  'preset:biped:wave_goodbye_01', 'preset:biped:wave_goodbye_02',
] as const;

const V25_PRESETS: ReadonlyArray<{ key: string; rigType: TripoRigType }> = [
  ...['idle', 'walk', 'run', 'dive', 'climb', 'jump', 'slash', 'shoot', 'hurt', 'fall', 'turn']
    .map((name) => ({ key: `preset:${name}`, rigType: 'biped' as const })),
  { key: 'preset:quadruped:walk', rigType: 'quadruped' },
  { key: 'preset:hexapod:walk', rigType: 'hexapod' },
  { key: 'preset:octopod:walk', rigType: 'octopod' },
  { key: 'preset:serpentine:march', rigType: 'serpentine' },
  { key: 'preset:aquatic:march', rigType: 'aquatic' },
];

const COMMON_LABELS: Record<string, string> = {
  idle: '待机', walk: '行走', run: '奔跑', dive: '俯冲', climb: '攀爬', jump: '跳跃', slash: '挥砍', shoot: '射击',
  hurt: '受击', fall: '倒下', turn: '转身', march: '游动', sit: '坐下', wait: '等待', cheer: '欢呼', clap: '鼓掌',
};

const labelForPreset = (key: string) => {
  const name = key.split(':').at(-1) || key;
  return COMMON_LABELS[name] || name.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const categoryForPreset = (key: string): TripoAnimationCategory => {
  if (/walk|run|idle|turn|climb|dive|fall|jump|flee|swim|march/.test(key)) return 'locomotion';
  if (/box|kick|hit_|hurt|slash|shoot|fire|chop|cast_a_spell|defeat/.test(key)) return 'combat';
  if (/dance|sing|swagger/.test(key)) return 'dance';
  if (/basketball|football|golf|volleyball|surf|dribble|press-up|crunch|rope/.test(key)) return 'sport';
  if (/greet|wave|agree|hug|clap|bow|call|cheer|heart_pose/.test(key)) return 'social';
  if (/afraid|angry|complain|cry|depressed|freaky|frightened|frustrated|laugh|scared|sob|victory/.test(key)) return 'emotion';
  return 'daily';
};

export const TRIPO_ANIMATION_PRESET_REGISTRY = Object.freeze({
  schemaVersion: 1,
  officialSnapshotDate: '2026-08-11',
  source: 'https://developers.tripo3d.com/en/docs/animations-retarget',
  presets: Object.freeze([
    ...V1_BIPED_PRESET_IDS.map((key) => ({
      key, label: labelForPreset(key), category: categoryForPreset(key), rigModel: 'v1.0-20240301' as const, rigTypes: ['biped' as const],
    })),
    ...V25_PRESETS.map(({ key, rigType }) => ({
      key, label: labelForPreset(key), category: categoryForPreset(key), rigModel: 'v2.5-20260210' as const, rigTypes: [rigType],
    })),
  ] satisfies TripoAnimationPreset[]),
});

export function filterTripoAnimationPresets(options: {
  rigModel: TripoRigModel;
  rigType: TripoRigType;
  category?: TripoAnimationCategory | 'all';
  query?: string;
}) {
  const query = String(options.query || '').trim().toLocaleLowerCase();
  return TRIPO_ANIMATION_PRESET_REGISTRY.presets.filter((preset) => (
    preset.rigModel === options.rigModel
    && (preset.rigTypes as readonly TripoRigType[]).includes(options.rigType)
    && (!options.category || options.category === 'all' || preset.category === options.category)
    && (!query || `${preset.label} ${preset.key}`.toLocaleLowerCase().includes(query))
  ));
}

export function normalizeAnimationSelection(values: readonly string[], limit = TRIPO_ANIMATION_BATCH_LIMIT) {
  const presets = Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
  if (presets.length > limit) throw new Error(`单批最多选择 ${limit} 个动画`);
  return presets;
}

export type TripoCharacterStageStatus = 'queued' | 'running' | 'failed' | 'paused' | 'succeeded';

export type TripoCharacterOutput = {
  url?: string;
  mediaUrl?: string;
  fileName?: string;
  presetKey?: string;
  clip?: string;
  archived?: boolean;
};

export type TripoCharacterStageRecord = {
  jobId: string;
  status: TripoCharacterStageStatus;
  remoteTaskId: string | null;
  creditsConsumed: number;
  outputs: TripoCharacterOutput[];
  updatedAt: string;
};

export type TripoCharacterRigCheckRecord = TripoCharacterStageRecord & {
  riggable: boolean | null;
  rigType: TripoRigType | null;
};

export type TripoCharacterAnimationOptions = {
  outFormat: TripoCharacterOutputFormat;
  bakeAnimation: boolean;
  exportWithGeometry: boolean;
  animateInPlace: boolean;
};

export type TripoCharacterAnimationBatch = TripoCharacterStageRecord & {
  batchKey: string;
  presets: string[];
  options: TripoCharacterAnimationOptions;
  mappedOutputs?: Array<{ preset: string | null; output: TripoCharacterOutput }>;
};

export type TripoCharacterRun = {
  id: string;
  sourceVersionJobId: string;
  sourceVersionIndex: number;
  sourceLabel: string;
  sourceTaskId: string;
  stale: boolean;
  rigModel: TripoRigModel;
  rigType: TripoRigType;
  rigSpec: TripoRigSpec;
  rigCheck: TripoCharacterRigCheckRecord | null;
  rig: TripoCharacterStageRecord | null;
  acceptedAt: string | null;
  animationBatches: TripoCharacterAnimationBatch[];
  selectedAnimationKey: string | null;
};

export type TripoCharacterDraft = {
  tab: 'pose' | 'animation';
  rigModel: TripoRigModel;
  rigType: TripoRigType;
  rigSpec: TripoRigSpec;
  rigOutFormat: TripoCharacterOutputFormat;
  query: string;
  category: TripoAnimationCategory | 'all';
  selectedPresets: string[];
  animationOptions: TripoCharacterAnimationOptions;
};

export function createTripoCharacterDraft(run?: TripoCharacterRun): TripoCharacterDraft {
  return {
    tab: 'pose',
    rigModel: run?.rigModel || 'v1.0-20240301',
    rigType: run?.rigType || 'biped',
    rigSpec: run?.rigSpec || 'mixamo',
    rigOutFormat: 'glb',
    query: '',
    category: 'all',
    selectedPresets: [],
    animationOptions: { outFormat: 'glb', bakeAnimation: true, exportWithGeometry: true, animateInPlace: true },
  };
}

export function createTripoCharacterRun(input: Pick<TripoCharacterRun, 'id' | 'sourceVersionJobId' | 'sourceVersionIndex' | 'sourceLabel' | 'sourceTaskId'>): TripoCharacterRun {
  return {
    ...input,
    stale: false,
    rigModel: 'v1.0-20240301',
    rigType: 'biped',
    rigSpec: 'mixamo',
    rigCheck: null,
    rig: null,
    acceptedAt: null,
    animationBatches: [],
    selectedAnimationKey: null,
  };
}

export function isTripoCharacterRunSourceStale(run: TripoCharacterRun, source: {
  jobId: string;
  index: number;
  taskId: string;
} | null | undefined) {
  return !source
    || run.sourceVersionJobId !== source.jobId
    || run.sourceVersionIndex !== source.index
    || run.sourceTaskId !== source.taskId;
}

export function withTripoCharacterRunSource(run: TripoCharacterRun, source: Parameters<typeof isTripoCharacterRunSourceStale>[1]) {
  const stale = isTripoCharacterRunSourceStale(run, source);
  return stale === run.stale ? run : { ...run, stale };
}

const STATUS_RANK: Record<TripoCharacterStageStatus, number> = { failed: 0, queued: 1, running: 2, paused: 3, succeeded: 4 };

const outputIdentity = (output: TripoCharacterOutput) => output.presetKey || output.mediaUrl || output.url || output.fileName || JSON.stringify(output);

function mergeOutputs(current: TripoCharacterOutput[], incoming: TripoCharacterOutput[]) {
  const merged = new Map<string, TripoCharacterOutput>();
  [...current, ...incoming].forEach((output) => {
    const key = outputIdentity(output);
    merged.set(key, { ...(merged.get(key) || {}), ...output });
  });
  return [...merged.values()];
}

function isNewerOrEqual(incoming: string, current: string) {
  const incomingTime = Date.parse(incoming);
  const currentTime = Date.parse(current);
  if (Number.isNaN(incomingTime) || Number.isNaN(currentTime)) return incoming >= current;
  return incomingTime >= currentTime;
}

function mergeStageRecord<T extends TripoCharacterStageRecord>(current: T | null | undefined, incoming: T): T {
  if (!current) return incoming;
  if (current.jobId !== incoming.jobId) {
    if (current.status === 'succeeded' && incoming.status !== 'succeeded') return current;
    return incoming;
  }
  if (STATUS_RANK[incoming.status] < STATUS_RANK[current.status]) return current;
  if (STATUS_RANK[incoming.status] === STATUS_RANK[current.status] && !isNewerOrEqual(incoming.updatedAt, current.updatedAt)) return current;
  return {
    ...current,
    ...incoming,
    remoteTaskId: incoming.remoteTaskId || current.remoteTaskId,
    creditsConsumed: Math.max(current.creditsConsumed || 0, incoming.creditsConsumed || 0),
    outputs: mergeOutputs(current.outputs || [], incoming.outputs || []),
  };
}

export type TripoCharacterStageUpdate = { runId: string } & (
  | { stage: 'rig-check'; record: TripoCharacterRigCheckRecord }
  | { stage: 'rig'; record: TripoCharacterStageRecord }
  | { stage: 'retarget'; batchKey: string; record: TripoCharacterAnimationBatch }
);

export function mergeTripoCharacterStage(run: TripoCharacterRun, update: TripoCharacterStageUpdate): TripoCharacterRun {
  if (run.id !== update.runId) throw new Error('角色任务回调与当前 run 不匹配');
  if (update.stage === 'rig-check') return { ...run, rigCheck: mergeStageRecord(run.rigCheck, update.record) };
  if (update.stage === 'rig') {
    const rig = mergeStageRecord(run.rig, update.record);
    const replacedSuccessfulRig = run.rig?.status === 'succeeded' && rig.status === 'succeeded' && run.rig.jobId !== rig.jobId;
    return { ...run, rig, acceptedAt: replacedSuccessfulRig ? null : run.acceptedAt, selectedAnimationKey: replacedSuccessfulRig ? null : run.selectedAnimationKey };
  }
  if (!update.batchKey || update.batchKey !== update.record.batchKey) throw new Error('动画回调缺少匹配的 batchKey');
  const index = run.animationBatches.findIndex((batch) => batch.batchKey === update.batchKey);
  if (index < 0) return { ...run, animationBatches: [...run.animationBatches, update.record] };
  const merged = mergeStageRecord(run.animationBatches[index], update.record);
  return { ...run, animationBatches: run.animationBatches.map((batch, batchIndex) => batchIndex === index ? merged : batch) };
}

export function completedTripoAnimationPresets(run: TripoCharacterRun) {
  return new Set(run.animationBatches.flatMap((batch) => batch.status === 'succeeded' ? batch.presets : []));
}

export function pendingTripoAnimations(selection: readonly string[], run: TripoCharacterRun) {
  const selected = normalizeAnimationSelection(selection);
  const completed = completedTripoAnimationPresets(run);
  const incompletePresets = selected.filter((preset) => !completed.has(preset));
  return { incompletePresets, count: incompletePresets.length };
}

export function canStartTripoRig(run: TripoCharacterRun, _sourceFormat = 'glb') {
  if (run.stale) return false;
  return run.rigCheck?.status === 'succeeded' && run.rigCheck.riggable === true;
}

export function canSubmitTripoAnimation(run: TripoCharacterRun) {
  return !run.stale && run.rig?.status === 'succeeded' && Boolean(run.rig.remoteTaskId) && Boolean(run.acceptedAt);
}

function characterMetadata(run: TripoCharacterRun, stage: 'rig-check' | 'rig' | 'retarget', batchKey = '') {
  return {
    _characterRunId: run.id,
    _characterStage: stage,
    _characterBatchKey: batchKey,
    _characterSourceVersionJobId: run.sourceVersionJobId,
    _characterSourceVersionIndex: run.sourceVersionIndex,
    _characterSourceLabel: run.sourceLabel,
    _characterSourceTaskId: run.sourceTaskId,
  };
}

export function buildTripoRigCheckSubmission(run: TripoCharacterRun, modelId: string): TripoPostprocessSubmission {
  if (run.stale) throw new Error('源模型版本已变化，请从当前版本新建角色任务');
  return {
    operation: 'rig-check', modelId,
    options: { taskId: run.sourceTaskId, ...characterMetadata(run, 'rig-check') },
  };
}

export function buildTripoRigSubmission(run: TripoCharacterRun, input: {
  modelId: string;
  rigModel: TripoRigModel;
  rigType: TripoRigType;
  spec: TripoRigSpec;
  outFormat: TripoCharacterOutputFormat;
  sourceFormat?: string;
}): TripoPostprocessSubmission {
  if (!canStartTripoRig(run, input.sourceFormat)) throw new Error(run.rigCheck?.riggable === false ? '当前模型不支持自动绑骨' : '请先完成兼容检查');
  if (input.rigModel === 'v1.0-20240301' && input.rigType !== 'biped') throw new Error('Rig v1.0 仅支持人形骨架');
  return {
    operation: 'rig', modelId: input.modelId,
    options: {
      taskId: run.sourceTaskId, model: input.rigModel, rigType: input.rigType, spec: input.spec, outFormat: input.outFormat,
      ...characterMetadata(run, 'rig'),
    },
  };
}

export function createTripoAnimationBatchKey(run: TripoCharacterRun, presets: readonly string[], options: TripoCharacterAnimationOptions) {
  return `${run.id}:${normalizeAnimationSelection(presets).join('|')}:${options.outFormat}:${Number(options.bakeAnimation)}:${Number(options.exportWithGeometry)}:${Number(options.animateInPlace)}`;
}

export function buildTripoRetargetSubmission(run: TripoCharacterRun, input: {
  modelId: string;
  batchKey: string;
  presets: readonly string[];
  options: TripoCharacterAnimationOptions;
}): TripoPostprocessSubmission {
  if (!canSubmitTripoAnimation(run)) throw new Error(run.acceptedAt ? '绑定任务尚未完成' : '请先完成骨架验收');
  const { incompletePresets } = pendingTripoAnimations(input.presets, run);
  if (!incompletePresets.length) throw new Error('所选动画均已完成，无需重复生成');
  if (!input.batchKey.trim()) throw new Error('动画批次缺少 batchKey');
  if (input.options.bakeAnimation && input.options.outFormat !== 'glb') throw new Error('动画烘焙仅支持 GLB 输出');
  return {
    operation: 'retarget', modelId: input.modelId,
    options: {
      taskId: run.rig!.remoteTaskId,
      animations: incompletePresets,
      outFormat: input.options.outFormat,
      ...(input.options.outFormat === 'glb' ? { bakeAnimation: input.options.bakeAnimation } : {}),
      exportWithGeometry: input.options.exportWithGeometry,
      animateInPlace: input.options.animateInPlace,
      ...characterMetadata(run, 'retarget', input.batchKey),
    },
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
  return value;
}

export function tripoCharacterConfirmationToken(submission: TripoPostprocessSubmission) {
  return JSON.stringify(stableValue(submission));
}

export function isTripoCharacterConfirmationCurrent(token: string | null | undefined, submission: TripoPostprocessSubmission) {
  return Boolean(token) && token === tripoCharacterConfirmationToken(submission);
}
