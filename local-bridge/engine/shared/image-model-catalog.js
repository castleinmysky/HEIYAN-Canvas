import { connectionDefaults } from './model-connection-settings.js';
// Official model inventory checked 2026-09-07. Account access is verified separately.
// Sources: developers.openai.com/api/docs/models/all
// ai.google.dev/gemini-api/docs/generate-content/image-generation
export const imageModelCatalog = Object.freeze([
  { id: 'gpt-image-2', adapter: 'openai-image', name: 'GPT Image 2', tier: '旗舰', state: 'current', description: '灵活尺寸；质量 Auto / Low / Medium / High，质量与分辨率分别设置。' },
  { id: 'gemini-3.1-flash-lite-image', adapter: 'gemini-image', name: 'Gemini 3.1 Flash Lite Image', tier: '轻量', state: 'current', description: 'Nano Banana 2 Lite · 1K，适合快速迭代。' },
  { id: 'gemini-3.1-flash-image', adapter: 'gemini-image', name: 'Gemini 3.1 Flash Image', tier: '标准', state: 'current', description: 'Nano Banana 2 · 0.5K / 1K / 2K / 4K。' },
  { id: 'gemini-3-pro-image', adapter: 'gemini-image', name: 'Gemini 3 Pro Image', tier: '专业', state: 'current', description: 'Nano Banana Pro · 1K / 2K / 4K，复杂视觉与文字排版。' },
  { id: 'gemini-2.5-flash-image', adapter: 'gemini-image', name: 'Gemini 2.5 Flash Image', tier: '上一代', state: 'legacy', description: 'Nano Banana · 固定 1K；保留已有连接。' },
  { id: 'gpt-image-1.5', adapter: 'openai-image', name: 'GPT Image 1.5', tier: '历史兼容', state: 'deprecated', description: '官方已标记弃用。仅保留现有连接或明确支持该 ID 的中转。' },
  { id: 'gpt-image-1', adapter: 'openai-image', name: 'GPT Image 1', tier: '历史兼容', state: 'deprecated', description: '官方已标记弃用，不保证新账号可用。' },
  { id: 'gpt-image-1-mini', adapter: 'openai-image', name: 'GPT Image 1 Mini', tier: '历史兼容', state: 'deprecated', description: '历史轻量型号，官方已标记弃用。' },
  { id: 'chatgpt-image-latest', adapter: 'openai-image', name: 'ChatGPT Image Latest', tier: '历史兼容', state: 'deprecated', description: '官方已标记弃用的旧别名，不代表当前最新图像模型。' },
]);
export function imageModelEntry(adapter, id) {
  return imageModelCatalog.find(item => item.adapter === adapter && item.id === id);
}
export const additionalImageModels = imageModelCatalog.filter(item => item.adapter === 'gemini-image' && item.state === 'current')
  .map(item => ({ id: item.id, name: item.name, capability: 'image', adapter: item.adapter, config: { model: item.id } }));
export const imageQualityOptions = ['auto', 'low', 'medium', 'high'];
export function withAdditionalImageModels(records) {
  const ids = new Set(records.map(model => model.id));
  return [...records, ...additionalImageModels.filter(model => !ids.has(model.id)).map(model => ({ ...model, enabled: false, config: connectionDefaults(model.adapter, model.config.model) }))];
}
export function normalizeImageQuality(value = 'auto') {
  if (!imageQualityOptions.includes(value)) throw Error('图像质量必须是 Auto / Low / Medium / High');
  return value;
}
