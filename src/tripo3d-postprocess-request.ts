export type TripoPostprocessApiSubmission = {
  operation: string;
  modelId: string;
  options: Record<string, unknown>;
};

export type TripoPostprocessApiContext = {
  taskId: string;
  canvasId?: string;
  taskTitle: string;
  nodeId: string;
  sourceTaskId?: string;
  sourceAssetUrl?: string;
  sourceFileName?: string;
  preferSourceAsset?: boolean;
  referenceImages?: Array<{ port: string; type: 'image'; value: string }>;
  sourceVersionOperation?: string;
};

export type TripoPostprocessApiBody = {
  taskId: string;
  canvasId?: string;
  taskTitle: string;
  nodeId: string;
  modelId: string;
  sourceTaskId?: string;
  sourceAssetUrl?: string;
  sourceFileName?: string;
  referenceImages?: Array<{ port: string; type: 'image'; value: string }>;
  sourceVersionOperation?: string;
  operation: string;
  options: Record<string, unknown>;
};

export function isValidTripoTaskId(value: unknown) {
  const normalized = String(value ?? '').trim();
  return Boolean(normalized) && normalized.length <= 240 && !/[\u0000-\u001f]/.test(normalized);
}

export function tripoOptionsForLocalSourceAsset(options: Record<string, unknown>) {
  const next = { ...options };
  ['taskId', 'task_id', 'fileToken', 'file_token', 'url', 'sourceUrl', 'source_url'].forEach((key) => delete next[key]);
  return next;
}

export function resolveTripoCharacterSourceVersion<T extends { jobId: string }>(
  versions: T[],
  options: Record<string, unknown>,
  selectedIndex: number,
) {
  const sourceJobId = String(options._characterSourceVersionJobId || '').trim();
  const rawSourceIndex = options._characterSourceVersionIndex;
  const sourceIndex = rawSourceIndex === undefined || rawSourceIndex === null || String(rawSourceIndex).trim() === ''
    ? Number.NaN
    : Number(rawSourceIndex);
  return versions.find((version) => version.jobId === sourceJobId)
    || (Number.isInteger(sourceIndex) ? versions[sourceIndex] : undefined)
    || versions[selectedIndex];
}

/**
 * Builds the exact JSON body used by App.tsx. Tripo task IDs are opaque and
 * must not be assigned a client-invented prefix. Smart Segment is the one mesh
 * operation whose official input is a file_token or HTTPS URL rather than a
 * task_id, so the selected canvas result is intentionally omitted there.
 */
export function buildTripoPostprocessApiBody(
  context: TripoPostprocessApiContext,
  submission: TripoPostprocessApiSubmission,
): TripoPostprocessApiBody {
  const operation = String(submission.operation || '').trim();
  const sourceTaskId = String(context.sourceTaskId ?? '').trim();
  const sourceAssetUrl = String(context.sourceAssetUrl ?? '').trim();
  const sourceFileName = String(context.sourceFileName ?? '').trim();
  const taskChainOperation = ['rig-check', 'rig', 'retarget'].includes(operation);
  const useSourceAsset = Boolean(!taskChainOperation && context.preferSourceAsset && sourceAssetUrl && sourceFileName);
  const referenceImages = Array.isArray(context.referenceImages) ? context.referenceImages.slice(0, 4) : [];
  if (operation !== 'smart-segment' && !useSourceAsset && !isValidTripoTaskId(sourceTaskId)) {
    throw new Error('当前结果缺少有效的 Tripo3D task_id');
  }
  return {
    taskId: context.taskId,
    ...(context.canvasId ? { canvasId: context.canvasId } : {}),
    taskTitle: context.taskTitle,
    nodeId: context.nodeId,
    modelId: submission.modelId,
    ...(operation === 'smart-segment'
      ? {}
      : useSourceAsset
        ? { sourceAssetUrl, sourceFileName }
        : { sourceTaskId }),
    ...(referenceImages.length ? { referenceImages } : {}),
    ...(context.sourceVersionOperation ? { sourceVersionOperation: context.sourceVersionOperation } : {}),
    operation,
    options: useSourceAsset ? tripoOptionsForLocalSourceAsset(submission.options) : submission.options,
  };
}
export function safeTripoOptimizationSourceIndex(
  versions: Array<{ operation?: string }>,
  selectedIndex: number,
  requestedOperation: string,
) {
  const boundedIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, versions.length - 1));
  if (!['texture', 'retopology'].includes(requestedOperation) || versions[boundedIndex]?.operation !== 'texture') return boundedIndex;
  for (let index = boundedIndex - 1; index >= 0; index -= 1) {
    if (versions[index]?.operation !== 'texture') return index;
  }
  return -1;
}
