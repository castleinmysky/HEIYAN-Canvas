import { bindImageProviders } from './adapters/image-providers.js';
import { bindSeedanceProvider } from './adapters/seedance-video.js';
import { bindMiniMaxProvider } from './adapters/minimax-h3-video.js';
import { createTripo3dModelAdapter } from './adapters/tripo3d-model.js';
import { createTripo3dPostprocessRunner } from './adapters/tripo3d-postprocess.js';

export function createCloudProviders(fetchImpl) {
  // There are deliberately no imports of local ComfyUI or GPT-SoVITS adapters.
  const images = bindImageProviders(fetchImpl);
  const seedance = bindSeedanceProvider(fetchImpl);
  const minimax = bindMiniMaxProvider(fetchImpl);
  return {
    get(model) {
      const factories = { 'openai-image': images.createOpenAiImageAdapter, 'gemini-image': images.createGeminiImageAdapter, 'seedance-video': seedance.createSeedanceVideoAdapter, 'minimax-h3-video': minimax.createMiniMaxH3VideoAdapter, 'tripo3d-model': createTripo3dModelAdapter };
      const create = factories[model.adapter];
      if (!create) throw new Error('This model needs a local HEIYAN installation.');
      return create({ ...model, config: { ...model.config, fetchImpl } });
    },
    postprocess(model) { return createTripo3dPostprocessRunner({ ...model.config, fetchImpl }); },
  };
}
