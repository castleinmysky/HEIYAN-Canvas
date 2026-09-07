export const TRIPO_CLEAN_ALBEDO_TEXTURE_INTENT = 'clean_albedo';

export const TRIPO_CLEAN_ALBEDO_PROMPT = [
  '为日式三渲二游戏角色生成干净的固有色（Base Color / Albedo）贴图。',
  '严格保留参考图中的角色身份、配色和材质分区，但所有受光结果必须从颜色贴图中移除。',
  '亮面必须是 100% 原始固有色；不要烘焙灯光、阴影、环境遮蔽、接触阴影、高光、反射、渐变或调色。',
  '不要压黑暗部，不要黑位溢出，不要把头发、皮肤、布料或金属的受光明暗误认为固有色。',
  '输出应像无光照材质检查图，最终硬阴影由实时 Cel Shader 单独生成。',
].join('\n');

export function tripoCleanAlbedoTexturePrompt(styleImageFileToken) {
  const fileToken = String(styleImageFileToken || '').trim();
  return {
    text: TRIPO_CLEAN_ALBEDO_PROMPT,
    ...(fileToken ? { styleImage: { fileToken } } : {}),
  };
}
