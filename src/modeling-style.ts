export type ModelingStyleId = 'cel-shader-game' | 'animation-3d' | 'hand-painted-game' | 'realistic-pbr';

export type ModelingStyleDefinition = {
  id: ModelingStyleId;
  label: string;
  shortLabel: string;
  eyebrow: string;
  description: string;
  suitableFor: string;
  contract: {
    form: string;
    shading: string;
    material: string;
    outline: string;
    lighting: string;
    avoid: string;
  };
};

export const modelingStyleDefinitions: readonly ModelingStyleDefinition[] = [
  {
    id: 'cel-shader-game',
    label: '游戏级 Cel Shader',
    shortLabel: 'Cel Shader',
    eyebrow: '纯固有色与实时硬阴影',
    description: '锁定为可建模的三维游戏角色参考：图片只提供干净固有色，硬阴影由最终三渲二材质实时生成。',
    suitableFor: '二次元游戏、英雄角色、三视图建模稿',
    contract: {
      form: '明确的三维体块、干净锐利的轮廓转折、中等细节密度；头发必须由可建模发束组成，不得画成纯平面线稿。',
      shading: '建模参考与颜色贴图阶段只输出 100% 固有色，不得把 Cel 阴影、高光或环境遮蔽画进颜色；最终二值硬阴影由实时 Cel Shader 单独生成。',
      material: 'Base Color / Albedo 分区必须干净准确；禁止烘焙灯光、阴影、AO、接触阴影、高光、反射、照片纹理、皮肤毛孔和随机噪点。',
      outline: '使用细而稳定的深色外轮廓与少量结构线，线宽一致，不得忽粗忽细或消失。',
      lighting: '使用无光照材质检查方式与均匀中性环境，只展示固有色；不得产生明暗渐变、投影、黑位压缩或环境戏剧光。',
      avoid: '二维赛璐璐插画、厚涂、油画、黏土、写实摄影、过度 PBR、霓虹环境光、复杂场景和后期特效。',
    },
  },
  {
    id: 'animation-3d',
    label: '动画电影 3D',
    shortLabel: '动画 3D',
    eyebrow: '完整体积与柔和材质',
    description: '锁定为高完成度动画电影角色，强调雕塑体积、柔和材质和统一的工作室布光。',
    suitableFor: '动画短片、可爱角色、宣传片角色设定',
    contract: {
      form: '饱满清晰的雕塑体积、圆润但有控制的轮廓；五官、发束和服装均需体现真实三维厚度。',
      shading: '连续柔和的三维明暗与稳定的接触阴影，不使用线稿主导，也不使用硬切的二阶阴影。',
      material: '干净的风格化材质，皮肤具有轻微柔润感，布料与金属反射简化但可辨识，禁止照片级脏污。',
      outline: '不使用显式描边；依靠轮廓、色块分离和柔和边缘光保持可读性。',
      lighting: '固定三点式动画棚拍光，柔和主光、弱补光、轻微轮廓光；所有视图曝光与色温一致。',
      avoid: '二维动漫线稿、硬边 Cel Shading、写实摄影、蜡像皮肤、塑料玩具高光、强景深和戏剧化背景。',
    },
  },
  {
    id: 'hand-painted-game',
    label: '手绘贴图 3D',
    shortLabel: '手绘 3D',
    eyebrow: '游戏手绘材质语言',
    description: '锁定为专业游戏手绘贴图资产，结构清晰、色彩归纳稳定，避免随机写实纹理。',
    suitableFor: 'MOBA、卡通 RPG、低中模游戏资产',
    contract: {
      form: '可生产的中等面数体块，轮廓夸张但结构明确；褶皱与装饰优先服务远距离辨识。',
      shading: '主要明暗信息绘制在色彩与纹理中，保留少量稳定实时光照，不得每个视图重新绘制高光位置。',
      material: '手绘漫反射贴图语言，笔触克制、色块完整，金属和皮革通过色相与明度组织区分。',
      outline: '默认不使用黑色描边，以轮廓剪影和明度分组建立边界；必要结构线保持极少且统一。',
      lighting: '固定弱中性棚拍光，避免强烈环境反射覆盖手绘贴图信息；背景保持单色。',
      avoid: '照片扫描纹理、随机污渍、超写实 PBR、二维插画、强烈 Cel 描边、塑料玩具质感和复杂环境光。',
    },
  },
  {
    id: 'realistic-pbr',
    label: '写实 PBR 角色',
    shortLabel: '写实 PBR',
    eyebrow: '统一物理材质响应',
    description: '锁定为专业写实游戏角色资产，统一皮肤、布料和金属的物理材质与棚拍条件。',
    suitableFor: '主机游戏、写实宣传角色、高精度资产',
    contract: {
      form: '可信的人体结构、真实厚度和高精度服装构造，微细节服从大结构，不得夸张成卡通比例。',
      shading: '连续物理光照、稳定软阴影与接触阴影，所有视图使用同一曝光、同一法线细节强度。',
      material: '遵循 PBR 金属度与粗糙度逻辑；皮肤、布料、皮革和金属响应明确，细节真实但不过度锐化。',
      outline: '完全不使用描边或插画结构线，边界由真实几何轮廓与材质反差建立。',
      lighting: '固定中性灰棚三点布光，色温与曝光锁定；禁止彩色环境光改变固有色。',
      avoid: 'Cel Shading、二维线稿、手绘贴图感、黏土、玩具塑料、夸张卡通体块、电影调色和复杂场景。',
    },
  },
] as const;

const styleContractStart = '【建模画风锁定】';
const styleContractEnd = '【建模画风锁定结束】';

export function isModelingStyleId(value: unknown): value is ModelingStyleId {
  return modelingStyleDefinitions.some((style) => style.id === value);
}

export function modelingStyleDefinition(styleId: ModelingStyleId) {
  return modelingStyleDefinitions.find((style) => style.id === styleId)!;
}

export function stripModelingStyleContract(prompt: string) {
  return String(prompt || '').replace(/\n*【建模画风锁定】[\s\S]*?【建模画风锁定结束】\n*/g, '\n\n').trim();
}

export function buildModelingStyleContract(styleId: ModelingStyleId) {
  const style = modelingStyleDefinition(styleId);
  return `${styleContractStart}
契约：${style.label}。稳定性优先于自由发挥；这是同一角色连续生成时必须复用的固定视觉规范，不是可随机解释的气氛词。

1. 三维造型：${style.contract.form}
2. 着色模型：${style.contract.shading}
3. 材质响应：${style.contract.material}
4. 轮廓规则：${style.contract.outline}
5. 灯光与背景：${style.contract.lighting}
6. 严格禁用：${style.contract.avoid}

一致性复核：正面、侧面、背面必须像同一个已完成的 3D 模型在固定棚拍环境中旋转；几何体块、固有色、材质粗糙度、阴影层级、轮廓处理、曝光和色温不得随视图改变。若参考图的偶然渲染方式与本契约冲突，保留角色身份和服装设计，但渲染语言必须服从本契约。
${styleContractEnd}`;
}

export function applyModelingStyleContract(prompt: string, styleId?: ModelingStyleId) {
  const basePrompt = stripModelingStyleContract(prompt);
  if (!styleId) return basePrompt;
  return [basePrompt, buildModelingStyleContract(styleId)].filter(Boolean).join('\n\n');
}
