export const characterTurnaroundHeadRatio = 4;
export const characterTurnaroundHeadRatios = [1, 1.5, 2, 3.5, 4, 6.5, 7.5, 8, 9] as const;
export const characterTurnaroundPose = 'T-Pose';
export const characterTurnaroundPoses = ['T-Pose', 'A-Pose'] as const;

export type CharacterTurnaroundHeadRatio = typeof characterTurnaroundHeadRatios[number];
export type CharacterTurnaroundPose = typeof characterTurnaroundPoses[number];

export const characterTurnaroundRatioFeel: Record<CharacterTurnaroundHeadRatio, string> = {
  1: '团子',
  1.5: '战斗头像 Q 版',
  2: '经典 Q 版',
  3.5: '可爱游戏',
  4: '风格化',
  6.5: '自然手游',
  7.5: '修长',
  8: '写实英雄',
  9: '超模神性',
};

function ratioKey(headRatio: number) {
  return String(headRatio).replace('.', '_');
}

export function characterProportionGuideFileName(headRatio: number, pose: CharacterTurnaroundPose = characterTurnaroundPose) {
  const poseSuffix = pose === 'A-Pose' ? '-a-pose' : '';
  return `character-proportion-${ratioKey(headRatio)}-heads${poseSuffix}.png`;
}

export function characterProportionGuideUrl(headRatio: number, pose: CharacterTurnaroundPose = characterTurnaroundPose) {
  const revision = headRatio === 1 ? '?v=dango-true-circle-v4' : '?v=proportion-head-cues-v5';
  return `/character-guides/${characterProportionGuideFileName(headRatio, pose)}${revision}`;
}

function proportionProfile(headRatio: number) {
  if (headRatio <= 1) return {
    shoulderLine: 0.58,
    pelvisLine: 0.76,
    kneeLine: 0.89,
    intent: '视觉一头身团子／图标型角色：头脸与身体融合为一个主体轮廓，整体感受可爱、滑稽、像吉祥物或表情包。',
    specialRule: '这是非标准人形的团子体，不允许生成独立脖子、正常长度的胸腹、腰部、骨盆、大腿或小腿。主体不需要铺满画面，必须优先保证圆形：头脸主体在正面、侧面和背面都必须是严格圆形的三维体积，并占完整角色高度的至少 88%；服装结构压缩为主体表面的纹样、领口和短披片，微型手脚直接嵌在主体轮廓附近。不要擅自回退成二头身 Q 版。',
  };
  if (headRatio <= 1.5) return {
    shoulderLine: 1.02,
    pelvisLine: 1.22,
    kneeLine: 1.38,
    intent: '一点五头身战斗头像 Q 版：保留一个完整、独立且占主导的大头，下巴以下的全部身体被压缩在半个头高内，形成头像式、徽章式、战斗表情包式的强烈视觉冲击。',
    specialRule: '头骨顶部到下巴必须正好占 1H；下巴到脚底只能占 0.5H。允许独立的极短躯干、短粗手臂和短腿，但躯干、骨盆、双腿与双脚的总高度不得超过 0.5H。头部必须约占总高度的三分之二，严禁把身体拉长成二头身或更高比例。',
  };
  if (headRatio <= 2) return {
    shoulderLine: 1.08,
    pelvisLine: 1.46,
    kneeLine: 1.76,
    intent: '二头身经典 Q 版角色：头部约占总高一半，身体短小、重心低，整体感受幼态、亲切、玩具化。',
    specialRule: '下巴以下只允许使用 1H 完成躯干、骨盆、腿和脚；四肢必须明显短粗，不能生成三头身以上的修长身体。',
  };
  if (headRatio >= 9) return {
    shoulderLine: 1.2,
    pelvisLine: 4.55,
    kneeLine: 6.85,
    intent: '九头身超模／神性英雄比例：头部很小，躯干修长，腰线高，腿部极长，整体感受高贵、冷峻、具有强烈时装感和压迫感。',
    specialRule: '必须保留明显的小头与超长腿关系，腿长应超过上半身长度；不要回缩成常见七至八头身。',
  };
  if (headRatio >= 8) return {
    shoulderLine: 1.2,
    pelvisLine: 4.25,
    kneeLine: 6.2,
    intent: '八头身写实英雄比例：头部较小、肩背展开、四肢修长，整体感受成熟、强健、可靠且具有英雄气质。',
    specialRule: '保持写实长腿与稳定躯干，避免头部放大或四肢缩短导致比例退回六至七头身。',
  };
  const pelvisLine = Number((headRatio * 0.56).toFixed(1));
  return {
    shoulderLine: 1.15,
    pelvisLine,
    kneeLine: Number((pelvisLine + (headRatio - pelvisLine) * 0.52).toFixed(1)),
    intent: headRatio <= 4
      ? '风格化游戏角色比例：头部较大、轮廓紧凑，兼顾可爱感、动作辨识度和完整的人形结构。'
      : '修长游戏角色比例：头身关系自然，四肢清晰，兼顾成熟感、造型表现力和建模可用性。',
    specialRule: '严格跟随比例骨架中的头部、躯干、骨盆和腿长关系，不得回到角色身份参考图的原始身材。',
  };
}

function buildDangoTurnaroundPrompt(characterReference: string, proportionReference: string, pose: CharacterTurnaroundPose) {
  const appendageRule = pose === 'A-Pose'
    ? '两枚极短的手部突起从单体轮廓左右中部向斜下约 45 度伸出；每侧长度不得超过总高的 15%。'
    : '两枚极短的手部突起从单体轮廓左右中部水平伸出；每侧长度不得超过总高的 15%。';
  return `这是“无躯干的一头身团子体”转换任务，不是普通 Q 版人物缩短任务。

输入图职责：
- ${characterReference}（第一张输入图）仅提供角色身份：五官、发型、发色、代表性头饰、服装纹样、配色和材质。
- ${proportionReference}（第二张输入图）提供唯一允许的结构：一个长着脸、接近圆形且具有明确厚度的头身融合体，以及直接嵌在其边缘的微型手脚。

最重要的结构定义：头脸就是整个身体。不是“大头加小身体”，而是彻底删除独立身体，把角色身份和服装元素重新设计到同一个头脸球体表面。

必须同时满足：
1. 从头顶到落地点定义为总高 1U，单一头脸主体必须连续占据总高至少 88%，剩余高度只用于嵌在底缘的微小脚尖。
2. 正面与背面的中央主体必须是严格圆形：忽略手脚后，高度 ÷ 宽度必须保持在 0.98–1.02，严禁画成蛋形、胶囊形或任何椭圆。
3. 严格 90 度侧面的中央主体也必须是同样大小的圆，侧面直径必须达到正面直径的 98%–102%，证明它是完整球体，严禁压成纸片或窄刀片。
4. 脸直接位于这个大球体的正面，脸部下方不能闭合出一个独立下巴轮廓，不能再连接第二个躯干形状。
5. 底部只允许两枚嵌在球体底缘的微小脚尖；不得画出腿段、膝盖或明显裆部间隙。
6. 服装必须压缩成包裹在球体表面的领口、胸前纹样、腰封图案和极短披片；不得用胸甲、裙身或外套重新搭出独立躯干。
7. 发型和披发可以包覆球体，但不能用头发遮住一个实际存在的普通身体。
8. ${appendageRule}

输出同一个团子模型的三个正交视图：正面、严格 90 度侧面、背面。三个视图必须是同一枚连续球体旋转后的结果，球体顶部、最大宽度位置和底缘水平对齐：
- 正面：五官长在球体正面，身份特征清晰。
- 侧面：只有一个连续的圆形侧轮廓，面部侧影位于球体前表面；侧面圆的直径与正面相同，不得出现头、胸、腹、臀的多段轮廓。
- 背面：发型、头饰和服装纹样包覆同一个球体背面；不得补画普通后背、腰臀或双腿。

禁止结果：普通二头身或三头身 Q 版、独立头部加独立身体、可见脖子、长胸腹、腰胯分段、裙装躯干、完整手臂、完整大腿或小腿。只要能在头脸球体下方辨认出另一个“身体块”，就判定失败并在输出前重做。

生成前内部复核：忽略头发、手脚和装饰，检查每个视图的中央主轮廓；三个视图都必须是严格圆形，高宽比在 0.98–1.02，三者直径差不得超过 2%，主体连续占总高至少 88%。主体不需要铺满画面，应保留清楚留白。如果仍是椭圆、纸片侧面，或主体下方存在独立躯干和腿，禁止输出。

渲染基线：保持同一个可旋转的三维团子体、轮廓清楚、材质分区稳定；如果存在“建模画风锁定”契约，则着色、材质、轮廓、灯光和背景必须服从该契约。使用正交摄像机，无透视畸变并完整显示三个视图。不要武器、道具、特效、地面、文字、标签、水印或噪点。`;
}

export function buildCharacterTurnaroundPrompt(headRatio = characterTurnaroundHeadRatio, characterReference = '@图片1', proportionReference = '@图片2', pose: CharacterTurnaroundPose = characterTurnaroundPose) {
  if (headRatio <= 1) return buildDangoTurnaroundPrompt(characterReference, proportionReference, pose);
  const profile = proportionProfile(headRatio);
  const guideKind = '骨架比例参考图';
  const measurementRule = `使用全新的严格 ${headRatio} 头身骨架重建角色。设一个头高为 H，H 只计算头骨顶部到下巴底部的距离，不包含任何头发体积：
- 头骨顶部 = 0H
- 下巴 = 1H
- 肩线约为 ${profile.shoulderLine}H
- 胯部约为 ${profile.pelvisLine}H
- 膝盖约为 ${profile.kneeLine}H
- 脚底必须严格位于 ${headRatio}H
- 角色从头骨顶部到脚底的总高度必须严格等于 ${headRatio}H`;
  const poseRule = pose === 'A-Pose'
    ? '标准对称 A-Pose：双臂从肩部向身体两侧斜下约 45 度，双臂与躯干分别形成清晰的 A 字轮廓；手肘伸直但不反关节，手掌朝向身体内侧，双腿伸直并自然分开。严禁变成双臂水平的 T-Pose。'
    : '标准对称 T-Pose：双臂从肩部向左右完全水平伸直，与躯干形成 90 度夹角；手肘伸直，手掌处于中立方向，双腿伸直并自然分开。严禁双臂下垂成 A-Pose。';
  const usageRule = '身体结构必须足够清晰，可直接用于专业 3D 建模和标准人形骨骼绑定参考。';
  return `输入图职责必须严格分开：
- ${characterReference} 是唯一的角色身份参考图，只负责五官、脸型、发型、发色、服装、配色、材质和整体气质，不得继承它的原始身高和身体比例。
- ${proportionReference} 是严格 ${headRatio} 头身、${pose} 的${guideKind}，只负责外轮廓、总高度、头部占比、肢体位置和姿态，不得复制其中的线条、文字、颜色或假人外观。

硬性优先级：${guideKind} > 本提示词的比例规则 > 角色身份参考图的原始身材。只要角色身份图的身材与 ${headRatio} 头身冲突，就必须舍弃原身材，完全服从结构参考图。

先在内部分析角色身份图并保留角色 DNA。去除所有武器、手持道具、视觉特效、粒子和装饰性背景元素。

不要保留参考图的原始身体比例。
${measurementRule}

比例气质：${profile.intent}
特殊执行规则：${profile.specialRule}

生成一张干净的宽幅角色三视图设定图，画面中必须是同一个 3D 角色模型的以下三个视图：
1. 正面视图
2. 严格 90 度侧面视图
3. 背面视图

三个视图必须使用完全一致的头部大小、骨架、身体比例、服装结构和角色尺度。头骨顶部、下巴、肩线、腰线、胯部、膝盖、脚踝和脚底必须分别保持水平对齐。将其视为同一个模型在正交空间中旋转后的展示，绝不能画成三张分别重绘的独立插画。

生成前必须在内部进行比例复核：分别用头高 H 测量三个视图；如果任何一个视图的总高度不是 ${headRatio}H，或三个视图的头部大小不一致，必须先重新调整骨架再输出。不要用“接近 ${headRatio} 头身”代替严格 ${headRatio} 头身。

姿态：${poseRule} 双脚朝向正前方。${usageRule}

镜头与构图：使用正交摄像机，完全没有透视畸变；三个视图间距一致；完整显示角色全身；不要裁切；不要使用动态机位或倾斜角度。

渲染基线：严格继承角色身份参考图的三维建模语言、固有色与材质分区。如果提示词中存在“建模画风锁定”契约，则该契约对造型、着色、材质、轮廓、灯光和背景拥有最高优先级。使用纯色中性背景。不要地面、不要武器、不要道具、不要特效、不要文字、不要标签、不要水印、不要噪点。`;
}

export function preferredTurnaroundRatio(supportedRatios: string[] = [], fallback = 'Auto') {
  return supportedRatios.includes('16:9') ? '16:9' : supportedRatios.includes('3:2') ? '3:2' : fallback;
}
