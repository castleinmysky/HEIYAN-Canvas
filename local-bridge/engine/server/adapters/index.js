import { createHttpAdapter } from './http.js';
import { createGeminiImageAdapter, createOpenAiImageAdapter } from './image-providers.js';
import { createSeedanceVideoAdapter } from './seedance-video.js';
import { createMiniMaxH3VideoAdapter } from './minimax-h3-video.js';
import { createComfyUiMiniMaxH3Adapter } from './comfyui-minimax-h3.js';
import { createComfyUiIllustriousAdapter } from './comfyui-illustrious.js';
import { createComfyUiNativeImageAdapter } from './comfyui-native-image.js';
import { createComfyUiTopazStarlightAdapter } from './comfyui-topaz-starlight.js';
import { createTripo3dModelAdapter } from './tripo3d-model.js';
import { createGptSovitsAudioAdapter } from './gpt-sovits-audio.js';

export function getAdapter(model, fetchImpl = fetch) {
  if (model.adapter === 'http') return createHttpAdapter(model);
  if (model.adapter === 'openai-image') return createOpenAiImageAdapter(model);
  if (model.adapter === 'gemini-image') return createGeminiImageAdapter(model);
  if (model.adapter === 'seedance-video') return createSeedanceVideoAdapter(model);
  if (model.adapter === 'minimax-h3-video') return createMiniMaxH3VideoAdapter(model);
  if (model.adapter === 'comfyui-minimax-h3') return createComfyUiMiniMaxH3Adapter(model, fetchImpl);
  if (model.adapter === 'comfyui-sdxl' || model.adapter === 'comfyui-illustrious') return createComfyUiIllustriousAdapter(model, fetchImpl);
  if (model.adapter === 'comfyui-native-image') return createComfyUiNativeImageAdapter(model, fetchImpl);
  if (model.adapter === 'comfyui-topaz-starlight') return createComfyUiTopazStarlightAdapter(model, fetchImpl);
  if (model.adapter === 'tripo3d-model') return createTripo3dModelAdapter(model);
  if (model.adapter === 'gpt-sovits-audio') return createGptSovitsAudioAdapter(model);
  throw new Error(`模型 ${model.id} 的 adapter 未配置`);
}
