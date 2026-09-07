export const canvasClipboardNodeKinds = new Set([
  'text',
  'image',
  'video',
  'audio',
  'imageGenerator',
  'videoGenerator',
  'modelGenerator',
  'comfyUiWorkflow',
  'characterAnimator',
  'turnaroundSplitter',
  'result',
  'collection',
]);

export const canvasClipboardRuntimeKeys = new Set([
  'jobId',
  'jobState',
  'jobStartedAt',
  'jobDeadlineAt',
  'jobUpdatedAt',
  'jobPollLost',
  'cancelling',
  'progress',
  'status',
  'stale',
  'simulated',
  'playable',
  'models',
  'inputReferences',
  'imageReferences',
  'hasIncomingConnection',
  'hasOutgoingConnection',
  'connectionGuideType',
  'publicMode',
  'workflowState',
  'workflowProgress',
  'workflowStatus',
  'workflowFailedNodeIds',
  'localQueue',
  'comfyPreview',
  'generatorPanelDockDragging',
  'singleNodeSelected',
  'inlineRenaming',
  'characterJobState',
  'characterProgress',
  'characterStatus',
  'activeCharacterJobId',
  'activeCharacterJobRunId',
  'activeCharacterOperation',
  'posePreviewState',
  'posePreviewUrl',
  'posePreviewSourceUrl',
  'posePreviewKey',
  'posePreviewEstimator',
  'posePreviewRatio',
  'posePreviewCached',
  'posePreviewError',
]);

function stripNestedJobReferences(value) {
  if (Array.isArray(value)) return value.map(stripNestedJobReferences);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [
    key,
    key === 'jobId' || key === 'sourceVersionJobId' ? '' : stripNestedJobReferences(nestedValue),
  ]));
}

export function stripCanvasClipboardRuntime(data) {
  const cleaned = { ...(data && typeof data === 'object' ? data : {}) };
  for (const key of canvasClipboardRuntimeKeys) delete cleaned[key];
  for (const key of ['resultVersions', 'generationVersions', 'modelVersions', 'modelExportVersions', 'characterRuns']) {
    if (Array.isArray(cleaned[key])) cleaned[key] = stripNestedJobReferences(cleaned[key]);
  }
  return cleaned;
}
