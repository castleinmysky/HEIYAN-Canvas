export type TurnaroundViewRole = 'front' | 'left' | 'back' | 'right' | `view-${number}`;
export type TurnaroundSideRole = Extract<TurnaroundViewRole, 'left' | 'right'>;

export type TurnaroundCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TurnaroundViewAsset = {
  role: TurnaroundViewRole;
  mediaUrl: string;
  fileName?: string;
  width: number;
  height: number;
};

export type TurnaroundMaskPoint = { x: number; y: number };
export type TurnaroundMaskStroke = {
  viewIndex: number;
  size: number;
  points: TurnaroundMaskPoint[];
};

export type TurnaroundDetection = {
  crops: [TurnaroundCrop, TurnaroundCrop, TurnaroundCrop];
  confidence: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Number(value.toFixed(5));

export function normalizeTurnaroundCrop(crop: TurnaroundCrop): TurnaroundCrop {
  const width = clamp(Number(crop.width) || 0.2, 0.08, 1);
  const height = clamp(Number(crop.height) || 0.2, 0.08, 1);
  return {
    x: round(clamp(Number(crop.x) || 0, 0, 1 - width)),
    y: round(clamp(Number(crop.y) || 0, 0, 1 - height)),
    width: round(width),
    height: round(height),
  };
}

export const defaultTurnaroundCrops = (): [TurnaroundCrop, TurnaroundCrop, TurnaroundCrop] => [
  { x: 0, y: 0, width: 1 / 3, height: 1 },
  { x: 1 / 3, y: 0, width: 1 / 3, height: 1 },
  { x: 2 / 3, y: 0, width: 1 / 3, height: 1 },
];

export const multiViewCountLimits = { min: 2, max: 12 } as const;

export function normalizeMultiViewCount(value: number) {
  return Math.min(multiViewCountLimits.max, Math.max(multiViewCountLimits.min, Math.round(Number(value) || 3)));
}

export function defaultMultiViewCrops(viewCount: number): TurnaroundCrop[] {
  const count = normalizeMultiViewCount(viewCount);
  return multiViewCropsFromSplitLines(Array.from({ length: count - 1 }, (_, index) => (index + 1) / count));
}

export function multiViewCropsFromSplitLines(rawLines: readonly number[]): TurnaroundCrop[] {
  const count = normalizeMultiViewCount(rawLines.length + 1);
  const minimumWidth = Math.min(0.08, 0.8 / count);
  const lines: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const fallback = (index + 1) / count;
    const requested = Number.isFinite(Number(rawLines[index])) ? Number(rawLines[index]) : fallback;
    const lower = (lines[index - 1] || 0) + minimumWidth;
    const upper = 1 - (count - index - 1) * minimumWidth;
    lines.push(round(clamp(requested, lower, upper)));
  }
  const boundaries = [0, ...lines, 1];
  return Array.from({ length: count }, (_, index) => ({
    x: round(boundaries[index]),
    y: 0,
    width: round(boundaries[index + 1] - boundaries[index]),
    height: 1,
  }));
}

export function multiViewSplitLinesFromCrops(crops: readonly TurnaroundCrop[]): number[] {
  if (crops.length < multiViewCountLimits.min || crops.length > multiViewCountLimits.max) {
    return defaultMultiViewCrops(3).slice(0, -1).map((crop) => round(crop.x + crop.width));
  }
  return multiViewCropsFromSplitLines(crops.slice(0, -1).map((crop) => crop.x + crop.width))
    .slice(0, -1)
    .map((crop) => round(crop.x + crop.width));
}

export function multiViewRoles(viewCount: number, sideRole: TurnaroundSideRole): TurnaroundViewRole[] {
  const count = normalizeMultiViewCount(viewCount);
  return count === 3
    ? ['front', sideRole, 'back']
    : Array.from({ length: count }, (_, index) => `view-${index + 1}` as TurnaroundViewRole);
}

export function multiViewLabels(viewCount: number, sideRole: TurnaroundSideRole) {
  const count = normalizeMultiViewCount(viewCount);
  return count === 3
    ? ['正面', sideRole === 'left' ? '左侧' : '右侧', '背面']
    : Array.from({ length: count }, (_, index) => `视图 ${index + 1}`);
}

export function turnaroundCropsFromSplitLines(firstLine: number, secondLine: number): [TurnaroundCrop, TurnaroundCrop, TurnaroundCrop] {
  return multiViewCropsFromSplitLines([firstLine, secondLine]) as [TurnaroundCrop, TurnaroundCrop, TurnaroundCrop];
}

function borderBackground(data: Uint8ClampedArray, width: number, height: number) {
  const samples: Array<[number, number, number]> = [];
  const radius = Math.max(1, Math.floor(Math.min(width, height) * 0.025));
  const corners = [[0, 0], [width - radius, 0], [0, height - radius], [width - radius, height - radius]];
  corners.forEach(([startX, startY]) => {
    for (let y = startY; y < Math.min(height, startY + radius); y += 1) {
      for (let x = startX; x < Math.min(width, startX + radius); x += 1) {
        const offset = (y * width + x) * 4;
        if (data[offset + 3] > 16) samples.push([data[offset], data[offset + 1], data[offset + 2]]);
      }
    }
  });
  if (!samples.length) return [0, 0, 0] as const;
  samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  return samples[Math.floor(samples.length / 2)] as [number, number, number];
}

function weightedCenters(histogram: number[], total: number) {
  const width = histogram.length;
  let centers = [width / 6, width / 2, width * 5 / 6];
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const weighted = [0, 0, 0];
    const counts = [0, 0, 0];
    histogram.forEach((weight, x) => {
      if (!weight) return;
      let cluster = 0;
      if (Math.abs(x - centers[1]) < Math.abs(x - centers[cluster])) cluster = 1;
      if (Math.abs(x - centers[2]) < Math.abs(x - centers[cluster])) cluster = 2;
      weighted[cluster] += x * weight;
      counts[cluster] += weight;
    });
    centers = centers.map((center, index) => counts[index] > total * 0.015 ? weighted[index] / counts[index] : center);
    centers.sort((a, b) => a - b);
  }
  return centers;
}

export function detectTurnaroundCropBoxes(
  pixels: { data: Uint8ClampedArray; width: number; height: number },
): TurnaroundDetection {
  const { data, width, height } = pixels;
  if (width < 12 || height < 12 || data.length < width * height * 4) return { crops: defaultTurnaroundCrops(), confidence: 0 };
  const [backgroundR, backgroundG, backgroundB] = borderBackground(data, width, height);
  const histogram = Array.from({ length: width }, () => 0);
  const active = new Uint8Array(width * height);
  let foreground = 0;
  const thresholdSquared = 34 * 34;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const alpha = data[offset + 3];
      const red = data[offset] - backgroundR;
      const green = data[offset + 1] - backgroundG;
      const blue = data[offset + 2] - backgroundB;
      const isForeground = alpha > 40 && (alpha < 245 || red * red + green * green + blue * blue > thresholdSquared);
      if (!isForeground) continue;
      active[pixel] = 1;
      histogram[x] += 1;
      foreground += 1;
    }
  }
  const foregroundRatio = foreground / (width * height);
  if (foregroundRatio < 0.012 || foregroundRatio > 0.88) return { crops: defaultTurnaroundCrops(), confidence: 0.12 };

  const centers = weightedCenters(histogram, foreground);
  const bounds = Array.from({ length: 3 }, () => ({ minX: width, minY: height, maxX: -1, maxY: -1, count: 0 }));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!active[y * width + x]) continue;
      let cluster = 0;
      if (Math.abs(x - centers[1]) < Math.abs(x - centers[cluster])) cluster = 1;
      if (Math.abs(x - centers[2]) < Math.abs(x - centers[cluster])) cluster = 2;
      const bound = bounds[cluster];
      bound.minX = Math.min(bound.minX, x);
      bound.minY = Math.min(bound.minY, y);
      bound.maxX = Math.max(bound.maxX, x);
      bound.maxY = Math.max(bound.maxY, y);
      bound.count += 1;
    }
  }

  const counts = bounds.map((bound) => bound.count);
  const balanced = Math.min(...counts) / Math.max(1, Math.max(...counts));
  const separated = Math.min(centers[1] - centers[0], centers[2] - centers[1]) / width;
  if (bounds.some((bound) => bound.count < foreground * 0.055 || bound.maxX < bound.minX)) {
    return { crops: defaultTurnaroundCrops(), confidence: round(clamp(balanced * 0.35, 0.08, 0.35)) };
  }

  const paddingX = Math.max(3, Math.round(width * 0.025));
  const paddingY = Math.max(3, Math.round(height * 0.035));
  const crops = bounds.map((bound, index) => {
    const boundWidth = bound.maxX - bound.minX + 1;
    const boundHeight = bound.maxY - bound.minY + 1;
    const leftSpacing = index > 0 ? centers[index] - centers[index - 1] : centers[1] - centers[0];
    const rightSpacing = index < 2 ? centers[index + 1] - centers[index] : centers[2] - centers[1];
    const neighborSpacing = Math.min(leftSpacing, rightSpacing);
    const observedHalfSpan = Math.max(centers[index] - bound.minX, bound.maxX - centers[index]);
    const tPoseLike = boundWidth / Math.max(1, boundHeight) >= 0.48
      || observedHalfSpan >= neighborSpacing * 0.46;
    const tPoseSafetyFactor = index === 1 ? 0.72 : 0.9;
    const safeHalfSpan = tPoseLike
      ? Math.max(observedHalfSpan + paddingX, neighborSpacing * tPoseSafetyFactor)
      : observedHalfSpan + paddingX;
    const minX = Math.max(0, centers[index] - safeHalfSpan);
    const maxX = Math.min(width - 1, centers[index] + safeHalfSpan);
    return normalizeTurnaroundCrop({
      x: minX / width,
      y: (bound.minY - paddingY) / height,
      width: (maxX - minX + 1) / width,
      height: (boundHeight + paddingY * 2) / height,
    });
  }) as [TurnaroundCrop, TurnaroundCrop, TurnaroundCrop];
  const confidence = round(clamp(0.36 + balanced * 0.34 + separated * 0.9, 0.15, 0.96));
  return { crops, confidence };
}

export async function detectTurnaroundCropsFromUrl(sourceUrl: string): Promise<TurnaroundDetection> {
  const response = await fetch(new URL(sourceUrl, window.location.href), { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`多视图图片读取失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 520 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(12, Math.round(bitmap.width * scale));
    const height = Math.max(12, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('浏览器无法分析三视图图片');
    context.drawImage(bitmap, 0, 0, width, height);
    return detectTurnaroundCropBoxes(context.getImageData(0, 0, width, height));
  } finally {
    bitmap.close();
  }
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('三视图裁切图片编码失败')), 'image/png'));
}

function bitmapBackgroundColor(bitmap: ImageBitmap): [number, number, number] {
  const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(12, Math.round(bitmap.width * scale));
  canvas.height = Math.max(12, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return [0, 0, 0];
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return [...borderBackground(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)] as [number, number, number];
}

export async function detectTurnaroundBackgroundColor(sourceUrl: string): Promise<string> {
  const response = await fetch(new URL(sourceUrl, window.location.href), { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`三视图图片读取失败（HTTP ${response.status}）`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const [red, green, blue] = bitmapBackgroundColor(bitmap);
    return `rgb(${red}, ${green}, ${blue})`;
  } finally {
    bitmap.close();
  }
}

export function paintTurnaroundMaskStrokes(
  context: CanvasRenderingContext2D,
  strokes: readonly TurnaroundMaskStroke[],
  viewIndex: number,
  outputSize: number,
  backgroundColor: string,
) {
  context.save();
  context.strokeStyle = backgroundColor;
  context.fillStyle = backgroundColor;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  strokes.filter((stroke) => stroke.viewIndex === viewIndex && stroke.points.length).forEach((stroke) => {
    const lineWidth = Math.max(2, stroke.size * outputSize);
    context.lineWidth = lineWidth;
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      context.beginPath();
      context.arc(point.x * outputSize, point.y * outputSize, lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point.x * outputSize;
      const y = point.y * outputSize;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  });
  context.restore();
}

export async function createTurnaroundCropFiles(
  sourceUrl: string,
  crops: readonly TurnaroundCrop[],
  sideRole: TurnaroundSideRole,
  outputSize = 1024,
  maskStrokes: readonly TurnaroundMaskStroke[] = [],
) {
  if (crops.length < multiViewCountLimits.min || crops.length > multiViewCountLimits.max) {
    throw new Error(`多视图切分需要 ${multiViewCountLimits.min}–${multiViewCountLimits.max} 个裁切区域`);
  }
  const response = await fetch(new URL(sourceUrl, window.location.href), { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`三视图图片读取失败（HTTP ${response.status}）`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const background = bitmapBackgroundColor(bitmap);
    const backgroundColor = `rgb(${background[0]}, ${background[1]}, ${background[2]})`;
    const roles = multiViewRoles(crops.length, sideRole);
    return await Promise.all(crops.map(async (rawCrop, index) => {
      const crop = normalizeTurnaroundCrop(rawCrop);
      const sourceX = Math.round(crop.x * bitmap.width);
      const sourceY = Math.round(crop.y * bitmap.height);
      const sourceWidth = Math.max(1, Math.round(crop.width * bitmap.width));
      const sourceHeight = Math.max(1, Math.round(crop.height * bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = outputSize;
      canvas.height = outputSize;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法生成多视图裁切图片');
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, outputSize, outputSize);
      const safeArea = outputSize * 0.94;
      const scale = Math.min(safeArea / sourceWidth, safeArea / sourceHeight);
      const targetWidth = sourceWidth * scale;
      const targetHeight = sourceHeight * scale;
      context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, (outputSize - targetWidth) / 2, (outputSize - targetHeight) / 2, targetWidth, targetHeight);
      paintTurnaroundMaskStrokes(context, maskStrokes, index, outputSize, backgroundColor);
      const role = roles[index];
      const blob = await canvasBlob(canvas);
      return { role, file: new File([blob], `turnaround-${role}.png`, { type: 'image/png' }), width: outputSize, height: outputSize };
    }));
  } finally {
    bitmap.close();
  }
}
