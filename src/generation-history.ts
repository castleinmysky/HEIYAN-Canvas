export type GeneratedAssetKind = 'image' | 'video' | 'audio' | 'model';

export type GenerationHistoryOutput = {
  mediaType?: GeneratedAssetKind;
  mediaUrl?: string | null;
  fileName?: string | null;
  historyHiddenAt?: string;
  mediaDeletedAt?: string;
  metadata?: {
    simulated?: boolean;
    previewUrl?: string;
    previewDeletedAt?: string;
    width?: number;
    height?: number;
    duration?: number;
    label?: string;
  };
};

export type GenerationHistoryJob = {
  id: string;
  nodeId?: string;
  nodeTitle?: string;
  taskId?: string;
  canvasId?: string;
  modelId?: string;
  capability?: GeneratedAssetKind;
  prompt?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  outputs?: GenerationHistoryOutput[];
};

export type GeneratedAssetHistoryItem = {
  id: string;
  jobId: string;
  outputIndex: number;
  nodeId?: string;
  nodeTitle?: string;
  outputCount?: number;
  canvasId: string;
  modelId?: string;
  modelName?: string;
  kind: GeneratedAssetKind;
  mediaUrl: string;
  previewUrl?: string;
  fileName?: string;
  prompt?: string;
  createdAt: string;
  width?: number;
  height?: number;
  duration?: number;
};

const supportedKinds = new Set<GeneratedAssetKind>(['image', 'video', 'audio', 'model']);

function safeCreatedAt(job: GenerationHistoryJob) {
  const value = String(job.updatedAt || job.createdAt || '').trim();
  return Number.isFinite(Date.parse(value)) ? value : new Date(0).toISOString();
}

export function generatedAssetItemsFromJobs(
  jobs: readonly GenerationHistoryJob[],
  modelNames: ReadonlyMap<string, string> = new Map(),
): GeneratedAssetHistoryItem[] {
  const latestByUrl = new Map<string, GeneratedAssetHistoryItem>();
  const historyKey = (job: GenerationHistoryJob, url: string) => JSON.stringify([job.taskId || '', url]);
  const hidden = new Set(jobs.flatMap((job) => (job.outputs || []).filter((output) => output.historyHiddenAt || output.mediaDeletedAt).map((output) => historyKey(job, String(output.mediaUrl || '').trim()))));
  jobs.forEach((job) => {
    if (job.status !== 'succeeded') return;
    const createdAt = safeCreatedAt(job);
    const outputs = Array.isArray(job.outputs) ? job.outputs : [];
    const siblingImage = outputs.find((output) => output.mediaType === 'image' && output.mediaUrl && !output.mediaDeletedAt && output.metadata?.simulated !== true);
    outputs.forEach((output, outputIndex) => {
      const mediaUrl = String(output.mediaUrl || '').trim();
      const kind = output.mediaType;
      if (hidden.has(historyKey(job, mediaUrl))) return;
      if (!mediaUrl || !kind || !supportedKinds.has(kind) || output.metadata?.simulated === true) return;
      const previewUrl = String((output.metadata?.previewDeletedAt ? '' : output.metadata?.previewUrl) || (kind === 'model' ? siblingImage?.mediaUrl || '' : '')).trim() || undefined;
      const item: GeneratedAssetHistoryItem = {
        id: `${job.id}:${outputIndex}`,
        jobId: job.id,
        outputIndex,
        nodeId: job.nodeId,
        nodeTitle: job.nodeTitle,
        outputCount: outputs.length,
        canvasId: String(job.canvasId || 'main'),
        modelId: job.modelId,
        modelName: job.modelId ? modelNames.get(job.modelId) : undefined,
        kind,
        mediaUrl,
        previewUrl,
        fileName: String(output.fileName || '').trim() || undefined,
        prompt: String(job.prompt || '').trim() || undefined,
        createdAt,
        width: Number(output.metadata?.width) > 0 ? Number(output.metadata?.width) : undefined,
        height: Number(output.metadata?.height) > 0 ? Number(output.metadata?.height) : undefined,
        duration: Number(output.metadata?.duration) > 0 ? Number(output.metadata?.duration) : undefined,
      };
      const existing = latestByUrl.get(mediaUrl);
      if (!existing || Date.parse(existing.createdAt) <= Date.parse(item.createdAt)) latestByUrl.set(mediaUrl, item);
    });
  });
  return [...latestByUrl.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function generatedAssetDayKey(createdAt: string, now = new Date()) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return '日期未知';
  const sameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  if (sameDay(date, now)) return '今天';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replaceAll('/', '-');
}

export function groupGeneratedAssetsByDay(items: readonly GeneratedAssetHistoryItem[], now = new Date()) {
  const groups = new Map<string, GeneratedAssetHistoryItem[]>();
  items.forEach((item) => {
    const key = generatedAssetDayKey(item.createdAt, now);
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  return [...groups].map(([label, assets]) => ({ label, assets }));
}

export function smoothWheelViewport(
  viewport: { x: number; y: number; zoom: number },
  pointer: { x: number; y: number },
  wheelDeltaY: number,
  minZoom: number,
  maxZoom: number,
) {
  const normalizedDelta = Math.max(-240, Math.min(240, Number.isFinite(wheelDeltaY) ? wheelDeltaY : 0));
  const nextZoom = Math.max(minZoom, Math.min(maxZoom, viewport.zoom * Math.exp(-normalizedDelta * 0.0018)));
  const worldX = (pointer.x - viewport.x) / viewport.zoom;
  const worldY = (pointer.y - viewport.y) / viewport.zoom;
  return {
    x: pointer.x - worldX * nextZoom,
    y: pointer.y - worldY * nextZoom,
    zoom: nextZoom,
  };
}
