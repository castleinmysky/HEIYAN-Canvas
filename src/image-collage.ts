export type ImageCollageSource = {
  id: string;
  title: string;
  mediaUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
  order?: number;
};

export type ImageCollageEntry = ImageCollageSource & {
  bitmap: ImageBitmap;
};

export type ImageCollageLayout = {
  width: number;
  height: number;
  columns: number;
  cellWidth: number;
  imageHeight: number;
  labelHeight: number;
  gap: number;
  padding: number;
  offsetX: number;
  offsetY: number;
};

export type PositionedImageCompositeLayout = {
  width: number;
  height: number;
  scale: number;
  minX: number;
  minY: number;
};

const median = (values: readonly number[]) => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

export function orderImageCollageSources<T extends ImageCollageSource>(sources: readonly T[]): T[] {
  if (sources.length < 2) return [...sources];
  const rowTolerance = Math.max(40, median(sources.map((source) => Math.max(1, source.height))) * 0.42);
  const rows: Array<{ centerY: number; items: T[] }> = [];
  [...sources]
    .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id))
    .forEach((source) => {
      const centerY = source.y + source.height / 2;
      const row = rows.find((candidate) => Math.abs(candidate.centerY - centerY) <= rowTolerance);
      if (!row) {
        rows.push({ centerY, items: [source] });
        return;
      }
      row.items.push(source);
      row.centerY = row.items.reduce((total, item) => total + item.y + item.height / 2, 0) / row.items.length;
    });
  return rows
    .sort((left, right) => left.centerY - right.centerY)
    .flatMap((row) => row.items.sort((left, right) => left.x - right.x || left.id.localeCompare(right.id)));
}

export function imageCollageLayout(entries: readonly Pick<ImageCollageEntry, 'bitmap'>[]): ImageCollageLayout {
  if (!entries.length) throw new Error('没有可拼接的图片');
  const ratios = entries.map(({ bitmap }) => bitmap.width / Math.max(1, bitmap.height));
  const cellRatio = Math.min(1.85, Math.max(0.72, median(ratios)));
  const estimatedTileHeightRatio = 1 / cellRatio + 0.045;
  const columns = Math.min(entries.length, Math.max(1, Math.ceil(Math.sqrt(entries.length * estimatedTileHeightRatio))));
  const rows = Math.ceil(entries.length / columns);
  const naturalCellWidth = Math.max(...entries.map(({ bitmap }) => bitmap.width));
  let cellWidth = Math.min(1600, Math.max(720, naturalCellWidth));
  let imageHeight = Math.round(cellWidth / cellRatio);
  let labelHeight = Math.max(54, Math.round(cellWidth * 0.045));
  let gap = Math.max(18, Math.round(cellWidth * 0.018));
  let padding = Math.max(24, Math.round(cellWidth * 0.025));
  const contentDimensions = () => ({
    width: columns * cellWidth + (columns - 1) * gap,
    height: rows * (labelHeight + imageHeight) + (rows - 1) * gap,
  });
  const squareDimensions = () => {
    const content = contentDimensions();
    const side = padding * 2 + Math.max(content.width, content.height);
    return { ...content, side };
  };
  const raw = squareDimensions();
  const scale = Math.min(1, 8192 / raw.side, Math.sqrt(40_000_000) / raw.side);
  if (scale < 1) {
    cellWidth = Math.max(320, Math.floor(cellWidth * scale));
    imageHeight = Math.max(240, Math.floor(imageHeight * scale));
    labelHeight = Math.max(36, Math.floor(labelHeight * scale));
    gap = Math.max(10, Math.floor(gap * scale));
    padding = Math.max(14, Math.floor(padding * scale));
  }
  const dimensions = squareDimensions();
  return {
    width: dimensions.side,
    height: dimensions.side,
    columns,
    cellWidth,
    imageHeight,
    labelHeight,
    gap,
    padding,
    offsetX: padding + (dimensions.side - padding * 2 - dimensions.width) / 2,
    offsetY: padding + (dimensions.side - padding * 2 - dimensions.height) / 2,
  };
}

export async function createImageCollage(entries: readonly ImageCollageEntry[]) {
  const layout = imageCollageLayout(entries);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建拼图画布');
  context.fillStyle = '#f4f3ef';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = 'middle';

  entries.forEach((entry, index) => {
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const x = layout.offsetX + column * (layout.cellWidth + layout.gap);
    const y = layout.offsetY + row * (layout.labelHeight + layout.imageHeight + layout.gap);
    context.fillStyle = '#202225';
    context.font = `600 ${Math.max(18, Math.round(layout.labelHeight * 0.38))}px "Microsoft YaHei", sans-serif`;
    const label = `${String(index + 1).padStart(2, '0')}  ${entry.title || '图片'}`;
    context.fillText(label.length > 34 ? `${label.slice(0, 33)}…` : label, x, y + layout.labelHeight / 2, layout.cellWidth);
    context.fillStyle = '#ffffff';
    context.fillRect(x, y + layout.labelHeight, layout.cellWidth, layout.imageHeight);
    const scale = Math.min(layout.cellWidth / entry.bitmap.width, layout.imageHeight / entry.bitmap.height);
    const drawWidth = Math.max(1, Math.round(entry.bitmap.width * scale));
    const drawHeight = Math.max(1, Math.round(entry.bitmap.height * scale));
    const drawX = x + (layout.cellWidth - drawWidth) / 2;
    const drawY = y + layout.labelHeight + (layout.imageHeight - drawHeight) / 2;
    context.drawImage(entry.bitmap, drawX, drawY, drawWidth, drawHeight);
  });

  const encode = (quality: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error('拼图导出失败')),
    'image/jpeg',
    quality,
  ));
  let blob = await encode(0.94);
  if (blob.size > 19 * 1024 * 1024) blob = await encode(0.86);
  if (blob.size > 19 * 1024 * 1024) blob = await encode(0.76);
  if (blob.size > 20 * 1024 * 1024) throw new Error('拼图文件仍超过 20MB，请减少本次选择的图片数量');
  return { blob, width: layout.width, height: layout.height };
}

export function positionedImageCompositeLayout(
  entries: readonly ImageCollageEntry[],
  maxSide = 10_000,
  maxPixels = 32_000_000,
): PositionedImageCompositeLayout {
  if (!entries.length) throw new Error('没有可复制的图片');
  const minX = Math.min(...entries.map((entry) => entry.x));
  const minY = Math.min(...entries.map((entry) => entry.y));
  const maxX = Math.max(...entries.map((entry) => entry.x + Math.max(1, entry.width)));
  const maxY = Math.max(...entries.map((entry) => entry.y + Math.max(1, entry.height)));
  const sceneWidth = Math.max(1, maxX - minX);
  const sceneHeight = Math.max(1, maxY - minY);
  const naturalScales = entries.map((entry) => Math.min(
    entry.bitmap.width / Math.max(1, entry.width),
    entry.bitmap.height / Math.max(1, entry.height),
  )).filter((value) => Number.isFinite(value) && value > 0);
  const naturalScale = Math.max(1, naturalScales.length ? median(naturalScales) : 1);
  const scale = Math.min(
    naturalScale,
    maxSide / sceneWidth,
    maxSide / sceneHeight,
    Math.sqrt(maxPixels / (sceneWidth * sceneHeight)),
  );
  return {
    width: Math.max(1, Math.floor(sceneWidth * scale)),
    height: Math.max(1, Math.floor(sceneHeight * scale)),
    scale,
    minX,
    minY,
  };
}

export async function createPositionedImageComposite(entries: readonly ImageCollageEntry[]) {
  const ordered = entries.map((entry, index) => ({ entry, index })).sort((left, right) =>
    (Number(left.entry.zIndex) || 0) - (Number(right.entry.zIndex) || 0)
    || (Number.isFinite(left.entry.order) ? Number(left.entry.order) : left.index)
      - (Number.isFinite(right.entry.order) ? Number(right.entry.order) : right.index));
  const render = async (maxPixels: number) => {
    const layout = positionedImageCompositeLayout(entries, 10_000, maxPixels);
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建多图剪贴板画布');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    ordered.forEach(({ entry }) => {
      const frameX = (entry.x - layout.minX) * layout.scale;
      const frameY = (entry.y - layout.minY) * layout.scale;
      const frameWidth = Math.max(1, entry.width * layout.scale);
      const frameHeight = Math.max(1, entry.height * layout.scale);
      const scale = Math.min(frameWidth / entry.bitmap.width, frameHeight / entry.bitmap.height);
      const drawWidth = Math.max(1, entry.bitmap.width * scale);
      const drawHeight = Math.max(1, entry.bitmap.height * scale);
      context.drawImage(
        entry.bitmap,
        frameX + (frameWidth - drawWidth) / 2,
        frameY + (frameHeight - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
    });
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('多图剪贴板导出失败')),
      'image/png',
    ));
    return { blob, width: layout.width, height: layout.height };
  };
  let maxPixels = 32_000_000;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await render(maxPixels);
    if (result.blob.size <= 48 * 1024 * 1024) return result;
    maxPixels = Math.max(2_000_000, Math.floor(maxPixels * 0.55));
  }
  throw new Error('合成图片仍超过系统剪贴板限制，请缩小选择范围');
}

export async function loadImageCollageBitmap(mediaUrl: string): Promise<ImageBitmap> {
  const response = await window.fetch(new URL(mediaUrl, window.location.href), { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`图片读取失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('选中的内容包含不可读取的非图片资源');
  return createImageBitmap(blob);
}
