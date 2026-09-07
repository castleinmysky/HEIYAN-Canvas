const MINIMAX_H3_PORT_TYPES = {
  prompt: new Set(['text']),
  first_frame: new Set(['image']),
  last_frame: new Set(['image']),
  reference: new Set(['image', 'video', 'audio']),
};

export function validateMiniMaxH3Inputs(inputs) {
  const counts = { firstFrame: 0, lastFrame: 0, images: 0, videos: 0, audios: 0, videoDuration: 0, audioDuration: 0 };
  for (const input of inputs) {
    const allowedTypes = MINIMAX_H3_PORT_TYPES[input.port];
    if (!allowedTypes) throw new Error('MiniMax-H3 input port is invalid');
    if (!allowedTypes.has(input.type)) throw new Error(`MiniMax-H3 ${input.port} does not support ${input.type} input`);
    if (input.port === 'first_frame') counts.firstFrame += 1;
    if (input.port === 'last_frame') counts.lastFrame += 1;
    if (input.port === 'reference' && input.type === 'image') counts.images += 1;
    if (input.port === 'reference' && input.type === 'video') { counts.videos += 1; counts.videoDuration += Number(input.duration) || 0; }
    if (input.port === 'reference' && input.type === 'audio') { counts.audios += 1; counts.audioDuration += Number(input.duration) || 0; }
  }
  if (counts.firstFrame > 1) throw new Error('MiniMax-H3 supports one first frame');
  if (counts.lastFrame > 1) throw new Error('MiniMax-H3 supports one last frame');
  if (counts.images > 9) throw new Error('MiniMax-H3 supports up to nine reference images');
  if (counts.videos > 3) throw new Error('MiniMax-H3 supports up to three reference videos');
  if (counts.audios > 3) throw new Error('MiniMax-H3 supports up to three reference audio clips');
  if (counts.videoDuration > 15) throw new Error('MiniMax-H3 reference videos cannot exceed 15 seconds in total');
  if (counts.audioDuration > 15) throw new Error('MiniMax-H3 reference audio cannot exceed 15 seconds in total');
  if ((counts.firstFrame || counts.lastFrame) && (counts.images || counts.videos || counts.audios)) throw new Error('MiniMax-H3 frame mode cannot be combined with reference inputs');
  if (counts.audios && counts.images + counts.videos + counts.firstFrame + counts.lastFrame === 0) throw new Error('MiniMax-H3 reference audio requires an image or video reference');
  return inputs;
}
