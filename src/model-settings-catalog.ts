import { connectionDefaults } from '../shared/model-connection-settings.js';
import { imageModelEntry } from '../shared/image-model-catalog.js';

export type GenerationKind = 'image' | 'video' | 'audio' | 'model';
type CatalogModel = { name: string; capability: GenerationKind; adapter: string; config?: { model?: string } };

export const generationGroups = [
  { id: 'image', zh: '图片生成', en: 'Image generation', icon: 'imageGenerate' },
  { id: 'video', zh: '视频生成', en: 'Video generation', icon: 'videoGenerate' },
  { id: 'audio', zh: '音频生成', en: 'Audio generation', icon: 'audioGenerate' },
  { id: 'model', zh: '3D 生成', en: '3D generation', icon: 'model3d' },
] as const;

// Presentation only: never change a saved provider, model ID, endpoint or key.
// Sources and original brand assets: public/provider-icons/SOURCES.md.
const providers: Record<string, { name: string; icon: string; models: Record<string, string> }> = {
  'openai-image': { name: 'OpenAI', icon: 'openai.png', models: { 'gpt-image-2': 'GPT Image 2' } },
  'gemini-image': { name: 'Google', icon: 'gemini.png', models: { 'gemini-2.5-flash-image': 'Gemini 2.5 Flash Image' } },
  'seedance-video': { name: 'ByteDance Seed', icon: 'bytedance-seed.ico', models: { 'doubao-seedance-2-0-260128': 'Seedance 2.0' } },
  'minimax-h3-video': { name: 'MiniMax', icon: 'minimax.ico', models: { 'MiniMax-H3': 'MiniMax H3' } },
  'tripo3d-model': { name: 'Tripo', icon: 'tripo.png', models: { 'v3.1-20260211': 'Tripo v3.1', 'tripo-v3.1': 'Tripo v3.1' } },
};

export function modelPresentation(model: CatalogModel) {
  let modelId = model.config?.model?.trim() || '';
  if (!modelId) {
    try { modelId = connectionDefaults(model.adapter).model; } catch { /* Generic/custom protocol has no official default. */ }
  }
  const provider = providers[model.adapter];
  const entry = imageModelEntry(model.adapter, modelId);
  const officialName = entry?.name || provider?.models[modelId];
  return {
    modelId,
    name: officialName || modelId || model.name,
    tier: entry?.tier || '',
    description: entry?.description || '',
    state: entry?.state || '',
    provider: officialName ? provider.name : '',
    icon: officialName ? `/provider-icons/${provider.icon}` : '',
  };
}

export function groupModelsByGeneration<T extends CatalogModel>(models: readonly T[]) {
  return generationGroups.map((group) => ({ ...group, models: models.filter((model) => model.capability === group.id) }))
    .filter((group) => group.models.length > 0);
}
