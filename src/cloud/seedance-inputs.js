const SEEDANCE_PORT_TYPES = {
  prompt: new Set(['text']),
  first_frame: new Set(['image']),
  last_frame: new Set(['image']),
  reference: new Set(['image', 'video', 'audio']),
};

function isSeedance25(model) {
  const name = typeof model === 'string' ? model : model?.config?.model || model?.model || model?.id;
  return /^doubao-seedance-2-5(?:-|$)/i.test(String(name || ''));
}

export function validateSeedanceInputs(inputs, model) {
  const counts = { firstFrame: 0, lastFrame: 0, images: 0, videos: 0, audios: 0 };
  const limits = isSeedance25(model)
    ? { images: 30, videos: 10, audios: 10, total: 50 }
    : { images: 9, videos: 1, audios: 3, total: 15 };

  for (const input of inputs) {
    const allowedTypes = SEEDANCE_PORT_TYPES[input.port];
    if (!allowedTypes) throw new Error('Seedance 输入端口无效');
    if (!allowedTypes.has(input.type)) throw new Error(`Seedance ${input.port} 端口不支持 ${input.type} 输入`);

    if (input.port === 'first_frame') counts.firstFrame += 1;
    if (input.port === 'last_frame') counts.lastFrame += 1;
    if (input.port === 'reference' && input.type === 'image') counts.images += 1;
    if (input.port === 'reference' && input.type === 'video') counts.videos += 1;
    if (input.port === 'reference' && input.type === 'audio') counts.audios += 1;
  }

  if (counts.firstFrame > 1) throw new Error('Seedance 首帧只支持一张图片');
  if (counts.lastFrame > 1) throw new Error('Seedance 尾帧只支持一张图片');
  if (counts.images > limits.images) throw new Error(isSeedance25(model) ? 'Seedance 2.5 最多支持 30 张参考图' : 'Seedance 最多支持九张普通参考图');
  if (counts.videos > limits.videos) throw new Error(isSeedance25(model) ? 'Seedance 2.5 最多支持 10 段参考视频' : 'Seedance 最多支持一段参考视频');
  if (counts.audios > limits.audios) throw new Error(isSeedance25(model) ? 'Seedance 2.5 最多支持 10 段参考音频' : 'Seedance 最多支持三段参考音频');
  if (counts.images + counts.videos + counts.audios > limits.total) throw new Error(`Seedance 最多支持 ${limits.total} 份参考素材`);
  if ((counts.firstFrame || counts.lastFrame) && (counts.images || counts.videos || counts.audios)) {
    throw new Error('Seedance 首帧/尾帧模式不能同时连接普通参考素材；请只保留首帧和尾帧，或只使用参考端口');
  }
  if (counts.audios && counts.images + counts.videos + counts.firstFrame + counts.lastFrame === 0) {
    throw new Error('参考音频必须同时连接至少一个图片或视频参考');
  }

  return inputs;
}
