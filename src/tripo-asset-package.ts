export type TripoAssetPackageOptions = {
  modelUrl: string;
  modelFileName?: string;
  assetName?: string;
  format?: string;
  processLabel?: string;
  expectedTextureCount?: number;
};

export type TripoAssetPackageResult = {
  blob: Blob;
  fileName: string;
  textureCount: number;
};

type ZipEntry = { name: string; blob: Blob };
type TextureUsage = { file: string; material: string; slots: string[]; mimeType: string; bytes: number };

const textEncoder = new TextEncoder();
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function zipHeader(size: number) {
  return new Uint8Array(size);
}

function write16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

export async function createStoredZip(entries: ZipEntry[]) {
  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  const records: Array<{ name: Uint8Array; bytes: Uint8Array; crc: number; offset: number }> = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const entry of entries) {
    const name = textEncoder.encode(entry.name.replace(/\\/g, '/'));
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    const crc = crc32(bytes);
    const header = zipHeader(30);
    const view = new DataView(header.buffer);
    write32(view, 0, 0x04034b50);
    write16(view, 4, 20);
    write16(view, 6, 0x0800);
    write16(view, 8, 0);
    write16(view, 10, stamp.time);
    write16(view, 12, stamp.date);
    write32(view, 14, crc);
    write32(view, 18, bytes.byteLength);
    write32(view, 22, bytes.byteLength);
    write16(view, 26, name.byteLength);
    write16(view, 28, 0);
    localParts.push(header, name, bytes);
    records.push({ name, bytes, crc, offset });
    offset += header.byteLength + name.byteLength + bytes.byteLength;
  }

  const centralOffset = offset;
  for (const record of records) {
    const header = zipHeader(46);
    const view = new DataView(header.buffer);
    write32(view, 0, 0x02014b50);
    write16(view, 4, 20);
    write16(view, 6, 20);
    write16(view, 8, 0x0800);
    write16(view, 10, 0);
    write16(view, 12, stamp.time);
    write16(view, 14, stamp.date);
    write32(view, 16, record.crc);
    write32(view, 20, record.bytes.byteLength);
    write32(view, 24, record.bytes.byteLength);
    write16(view, 28, record.name.byteLength);
    write16(view, 30, 0);
    write16(view, 32, 0);
    write16(view, 34, 0);
    write16(view, 36, 0);
    write32(view, 38, 0);
    write32(view, 42, record.offset);
    centralParts.push(header, record.name.buffer.slice(record.name.byteOffset, record.name.byteOffset + record.name.byteLength) as ArrayBuffer);
    offset += header.byteLength + record.name.byteLength;
  }

  const end = zipHeader(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, records.length);
  write16(endView, 10, records.length);
  write32(endView, 12, offset - centralOffset);
  write32(endView, 16, centralOffset);
  write16(endView, 20, 0);
  const endBuffer = end.buffer.slice(end.byteOffset, end.byteOffset + end.byteLength) as ArrayBuffer;
  return new Blob([...localParts, ...centralParts, endBuffer], { type: 'application/zip' });
}

function cleanFilePart(value: string, fallback: string) {
  const cleaned = String(value || '').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^\.+|\.+$/g, '');
  return cleaned || fallback;
}

export function tripoAssetBaseName(value: string | undefined, fallback = 'model') {
  const withoutExtension = String(value || '').trim().replace(/\.[a-z0-9]{2,8}$/i, '');
  const cleaned = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s*_\s*/g, '_')
    .replace(/_+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 96) || fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned) ? '_' + cleaned : cleaned;
}

function extensionFromName(value: string, fallback = 'glb') {
  const match = String(value || '').split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i);
  return (match?.[1] || fallback).toLowerCase();
}

function textureSlotLabel(slot: string) {
  const labels: Record<string, string> = {
    map: 'basecolor', normalMap: 'normal', roughnessMap: 'roughness', metalnessMap: 'metallic',
    emissiveMap: 'emissive', aoMap: 'ao', alphaMap: 'alpha', bumpMap: 'bump', displacementMap: 'height',
    specularMap: 'specular', lightMap: 'light', envMap: 'environment',
  };
  return labels[slot] || cleanFilePart(slot, 'texture').toLowerCase();
}

function extensionForMime(mimeType: string) {
  if (/jpe?g/i.test(mimeType)) return 'jpg';
  if (/webp/i.test(mimeType)) return 'webp';
  if (/bmp/i.test(mimeType)) return 'bmp';
  return 'png';
}

function findBytes(source: Uint8Array, needle: number[], from = 0) {
  outer: for (let index = Math.max(0, from); index <= source.length - needle.length; index += 1) {
    for (let part = 0; part < needle.length; part += 1) if (source[index + part] !== needle[part]) continue outer;
    return index;
  }
  return -1;
}

function textureSlotsFromFileName(fileName: string) {
  const value = fileName.toLowerCase();
  if (/normal|nor\b/.test(value)) return ['normal'];
  if (/rough/.test(value)) return ['roughness'];
  if (/metal/.test(value)) return ['metallic'];
  if (/emiss/.test(value)) return ['emissive'];
  if (/occlusion|(?:^|[_-])ao(?:[_-]|\.)/.test(value)) return ['ao'];
  if (/alpha|opacity/.test(value)) return ['alpha'];
  if (/base|color|diffuse|albedo/.test(value)) return ['basecolor'];
  return ['texture'];
}

async function extractEmbeddedFbxTextures(modelBlob: Blob, fallbackFolder: string) {
  const bytes = new Uint8Array(await modelBlob.arrayBuffer());
  const decoder = new TextDecoder('windows-1252');
  const fullText = decoder.decode(bytes);
  const folderMatch = /(?:^|[\\/])([A-Za-z0-9_.-]+\.fbm)[\\/][A-Za-z0-9_. -]+\.(?:png|jpe?g|webp|bmp|tga)/i.exec(fullText);
  const textureFolder = cleanFilePart(folderMatch?.[1] || fallbackFolder, fallbackFolder);
  const entries: ZipEntry[] = [];
  const usages: TextureUsage[] = [];
  const usedNames = new Set<string>();

  const addImage = (start: number, end: number, mimeType: string, extension: string) => {
    const context = decoder.decode(bytes.subarray(Math.max(0, start - 4096), start));
    const names = [...context.matchAll(/([A-Za-z0-9_. -]+\.(?:png|jpe?g|webp|bmp|tga))/ig)];
    const hintedName = names.at(-1)?.[1] || `texture_${entries.length + 1}.${extension}`;
    let fileName = cleanFilePart(hintedName, `texture_${entries.length + 1}.${extension}`);
    if (!/\.[a-z0-9]+$/i.test(fileName)) fileName += `.${extension}`;
    let packagePath = `${textureFolder}/${fileName}`;
    let suffix = 2;
    while (usedNames.has(packagePath.toLowerCase())) {
      const stem = fileName.replace(/\.[^.]+$/, '');
      const ext = extensionFromName(fileName, extension);
      packagePath = `${textureFolder}/${stem}_${suffix}.${ext}`;
      suffix += 1;
    }
    usedNames.add(packagePath.toLowerCase());
    const imageBytes = bytes.slice(start, end);
    const blob = new Blob([imageBytes.buffer], { type: mimeType });
    entries.push({ name: packagePath, blob });
    usages.push({ file: packagePath, material: 'FBX embedded media', slots: textureSlotsFromFileName(fileName), mimeType, bytes: blob.size });
  };

  let cursor = 0;
  while ((cursor = findBytes(bytes, [0xff, 0xd8, 0xff], cursor)) >= 0) {
    const endMarker = findBytes(bytes, [0xff, 0xd9], cursor + 3);
    if (endMarker < 0) break;
    addImage(cursor, endMarker + 2, 'image/jpeg', 'jpg');
    cursor = endMarker + 2;
  }

  cursor = 0;
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  while ((cursor = findBytes(bytes, pngSignature, cursor)) >= 0) {
    const iend = findBytes(bytes, [0x49, 0x45, 0x4e, 0x44], cursor + pngSignature.length);
    if (iend < 0 || iend + 8 > bytes.length) break;
    addImage(cursor, iend + 8, 'image/png', 'png');
    cursor = iend + 8;
  }

  return { entries, usages, textureFolder };
}
async function canvasBlob(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建贴图导出画布');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('贴图转换失败');
  return blob;
}

async function textureImageBlob(texture: any) {
  const image = texture?.source?.data || texture?.image;
  if (!image) return null;
  const src = typeof image.currentSrc === 'string' && image.currentSrc || typeof image.src === 'string' && image.src || '';
  if (src) {
    try {
      const response = await fetch(src);
      if (response.ok) {
        const blob = await response.blob();
        if (blob.size && /^image\//i.test(blob.type)) return blob;
      }
    } catch {}
  }
  const width = Number(image.naturalWidth || image.videoWidth || image.width || 0);
  const height = Number(image.naturalHeight || image.videoHeight || image.height || 0);
  if (width > 0 && height > 0) return canvasBlob(image as CanvasImageSource, width, height);
  return null;
}

function disposeObject(root: any) {
  root?.traverse?.((node: any) => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material || {})) (value as any)?.isTexture && (value as any).dispose?.();
      material?.dispose?.();
    }
  });
}

async function extractTextures(modelUrl: string, format: string, textureFolder: string) {
  const THREE = await import('three');
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url: string) => new URL(url, new URL(modelUrl, window.location.href)).href);
  let root: any;
  if (format === 'fbx') {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    root = await new FBXLoader(manager).loadAsync(modelUrl);
  } else if (format === 'glb' || format === 'gltf') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    root = (await new GLTFLoader(manager).loadAsync(modelUrl)).scene;
  } else {
    return { entries: [] as ZipEntry[], usages: [] as TextureUsage[] };
  }

  const textureRecords = new Map<string, { texture: any; material: string; slots: Set<string> }>();
  root.traverse?.((node: any) => {
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      for (const [slot, value] of Object.entries(material || {})) {
        const texture = value as any;
        if (!texture?.isTexture) continue;
        const key = String(texture.source?.uuid || texture.uuid || slot);
        const existing = textureRecords.get(key);
        if (existing) existing.slots.add(slot);
        else textureRecords.set(key, { texture, material: cleanFilePart(material.name, 'material'), slots: new Set([slot]) });
      }
    }
  });

  const entries: ZipEntry[] = [];
  const usages: TextureUsage[] = [];
  const usedNames = new Set<string>();
  let index = 0;
  try {
    for (const record of textureRecords.values()) {
      const blob = await textureImageBlob(record.texture);
      if (!blob) continue;
      index += 1;
      const firstSlot = [...record.slots][0] || 'texture';
      const base = cleanFilePart(record.texture.name || record.material + '_' + textureSlotLabel(firstSlot), 'texture_' + index);
      let file = textureFolder + '/' + base + '.' + extensionForMime(blob.type);
      while (usedNames.has(file.toLowerCase())) file = textureFolder + '/' + base + '_' + index + '.' + extensionForMime(blob.type);
      usedNames.add(file.toLowerCase());
      entries.push({ name: file, blob });
      usages.push({ file, material: record.material, slots: [...record.slots].map(textureSlotLabel), mimeType: blob.type || 'image/png', bytes: blob.size });
    }
  } finally {
    disposeObject(root);
  }
  return { entries, usages };
}

function organizeExtractedTextures(
  extracted: { entries: ZipEntry[]; usages: TextureUsage[] },
  assetName: string,
  textureFolder: string,
) {
  const labels: Record<string, string> = {
    basecolor: 'BaseColor', normal: 'Normal', roughness: 'Roughness', metallic: 'Metallic',
    emissive: 'Emissive', ao: 'AO', alpha: 'Alpha', bump: 'Bump', height: 'Height',
    specular: 'Specular', light: 'Light', environment: 'Environment', texture: 'Texture',
  };
  const counts = new Map<string, number>();
  const entries: ZipEntry[] = [];
  const usages: TextureUsage[] = [];
  extracted.entries.forEach((entry, index) => {
    const usage = extracted.usages[index] || {
      file: entry.name,
      material: 'material',
      slots: ['texture'],
      mimeType: entry.blob.type || 'image/png',
      bytes: entry.blob.size,
    };
    const slot = String(usage.slots[0] || 'texture').toLowerCase();
    const label = labels[slot] || cleanFilePart(slot, 'Texture');
    const ordinal = (counts.get(label) || 0) + 1;
    counts.set(label, ordinal);
    const extension = extensionFromName(entry.name, extensionForMime(usage.mimeType || entry.blob.type));
    const file = textureFolder + '/' + assetName + '_' + label + '_' + String(ordinal).padStart(2, '0') + '.' + extension;
    entries.push({ name: file, blob: entry.blob });
    usages.push({ ...usage, file });
  });
  return { entries, usages };
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function buildTripoAssetPackage(options: TripoAssetPackageOptions): Promise<TripoAssetPackageResult> {
  const format = String(options.format || extensionFromName(options.modelFileName || options.modelUrl)).toLowerCase();
  const sourceName = options.modelFileName || 'model.' + format;
  const extension = extensionFromName(sourceName, format);
  const sourceBaseName = tripoAssetBaseName(sourceName, 'model');
  const baseName = tripoAssetBaseName(options.assetName, sourceBaseName);
  const modelFileName = baseName + '.' + extension;
  const response = await fetch(options.modelUrl);
  if (!response.ok) throw new Error('模型文件读取失败（HTTP ' + response.status + '）');
  const modelBlob = await response.blob();
  if (!modelBlob.size) throw new Error('模型文件为空，无法创建资产包');
  const textureFolder = '贴图';
  let extracted: Awaited<ReturnType<typeof extractTextures>> = { entries: [], usages: [] };
  try {
    if (format === 'fbx') {
      const embedded = await extractEmbeddedFbxTextures(modelBlob, textureFolder);
      extracted = embedded.entries.length ? embedded : await extractTextures(options.modelUrl, format, embedded.textureFolder);
    } else {
      extracted = await extractTextures(options.modelUrl, format, textureFolder);
    }
  } catch (error) {
    if ((options.expectedTextureCount || 0) > 0) throw new Error('模型包含贴图，但贴图提取失败：' + (error instanceof Error ? error.message : '未知错误'));
  }
  if ((options.expectedTextureCount || 0) > 0 && extracted.entries.length === 0) throw new Error('模型包含贴图，但没有提取到可打包的贴图；已停止下载，避免生成不完整资产包');
  extracted = organizeExtractedTextures(extracted, baseName, textureFolder);

  const manifest = {
    schema: 'ai-canvas-model-package-v1',
    createdAt: new Date().toISOString(),
    process: options.processLabel || '当前流程',
    assetName: baseName,
    model: { file: modelFileName, format: format.toUpperCase(), bytes: modelBlob.size },
    textures: extracted.usages,
  };
  const readme = [
    'AI 画布 3D 资产包',
    '',
    '流程：' + (options.processLabel || '当前流程'),
    '模型：' + modelFileName,
    '贴图：' + extracted.entries.length + ' 张',
    '',
    '贴图统一位于「贴图」目录；FBX 内嵌贴图保持在模型中，该目录为方便编辑和归档而整理的副本。',
  ].join('\r\n');
  const entries: ZipEntry[] = [
    { name: baseName + '/' + modelFileName, blob: modelBlob },
    ...extracted.entries.map((entry) => ({ ...entry, name: baseName + '/' + entry.name })),
    { name: baseName + '/' + baseName + '_AssetManifest.json', blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) },
    { name: baseName + '/' + baseName + '_README.txt', blob: new Blob([readme], { type: 'text/plain;charset=utf-8' }) },
  ];
  return {
    blob: await createStoredZip(entries),
    fileName: baseName + '_资产包.zip',
    textureCount: extracted.entries.length,
  };
}
