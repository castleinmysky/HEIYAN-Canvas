export type QuickCropPresetId = '1:1' | '16:9' | '9:16' | '21:9' | '4:3' | '3:3' | 'free';

export type QuickCropSpec = {
  id: QuickCropPresetId;
  label: string;
  width: number;
  height: number;
  hint: string;
};

export type QuickCropOutput = QuickCropSpec & { file: File };

export const quickCropPresets: readonly QuickCropSpec[] = Object.freeze([
  { id: '1:1', label: '1:1', width: 2048, height: 2048, hint: '高清方形' },
  { id: '16:9', label: '16:9', width: 1920, height: 1080, hint: '横版视频' },
  { id: '9:16', label: '9:16', width: 1080, height: 1920, hint: '竖版视频' },
  { id: '21:9', label: '21:9', width: 2520, height: 1080, hint: '超宽银幕' },
  { id: '4:3', label: '4:3', width: 2048, height: 1536, hint: '传统横幅' },
  { id: '3:3', label: '3:3', width: 1536, height: 1536, hint: '轻量方形' },
]);

export function validatedQuickCropSize(width: number, height: number) {
  const normalizedWidth = Math.round(Number(width));
  const normalizedHeight = Math.round(Number(height));
  if (!Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight) || normalizedWidth < 64 || normalizedHeight < 64) {
    throw new Error('自由尺寸的宽高不能小于 64px');
  }
  if (normalizedWidth > 8192 || normalizedHeight > 8192 || normalizedWidth * normalizedHeight > 40_000_000) {
    throw new Error('单张输出最大 8192px，且不能超过 4000 万像素');
  }
  return { width: normalizedWidth, height: normalizedHeight };
}

export function quickCropSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  focusX = 0.5,
  focusY = 0.5,
  zoom = 1,
) {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) throw new Error('图片尺寸无效');
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  let width = sourceWidth;
  let height = sourceHeight;
  if (sourceRatio > targetRatio) width = sourceHeight * targetRatio;
  else height = sourceWidth / targetRatio;
  const safeZoom = Math.min(4, Math.max(1, Number(zoom) || 1));
  width /= safeZoom;
  height /= safeZoom;
  const normalizedFocusX = Math.min(1, Math.max(0, Number(focusX) || 0));
  const normalizedFocusY = Math.min(1, Math.max(0, Number(focusY) || 0));
  const x = Math.min(sourceWidth - width, Math.max(0, normalizedFocusX * sourceWidth - width / 2));
  const y = Math.min(sourceHeight - height, Math.max(0, normalizedFocusY * sourceHeight - height / 2));
  return { x, y, width, height };
}

function safeCropName(value: string) {
  return value.trim().replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'image';
}

export async function createQuickCropFiles(
  mediaUrl: string,
  specs: readonly QuickCropSpec[],
  focus: { x: number; y: number },
  zoom: number,
  sourceName = 'image',
): Promise<QuickCropOutput[]> {
  if (!specs.length) throw new Error('请至少选择一个输出规格');
  const response = await window.fetch(new URL(mediaUrl, window.location.href), { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`原图读取失败（HTTP ${response.status}）`);
  const sourceBlob = await response.blob();
  if (!sourceBlob.type.startsWith('image/')) throw new Error('当前资源不是可裁切图片');
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const outputs: QuickCropOutput[] = [];
    for (const spec of specs) {
      const size = validatedQuickCropSize(spec.width, spec.height);
      const crop = quickCropSourceRect(bitmap.width, bitmap.height, size.width, size.height, focus.x, focus.y, zoom);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法创建裁切画布');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error(`${spec.label} 裁切导出失败`)),
        'image/png',
      ));
      const suffix = spec.id === 'free' ? `${size.width}x${size.height}` : spec.id.replace(':', 'x');
      outputs.push({ ...spec, ...size, file: new File([blob], `${safeCropName(sourceName)}-${suffix}.png`, { type: 'image/png' }) });
    }
    return outputs;
  } finally {
    bitmap.close?.();
  }
}
