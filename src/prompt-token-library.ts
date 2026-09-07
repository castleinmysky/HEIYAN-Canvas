import { doubledPositivePromptTokens } from './prompt-token-library-doubled';
import { expandedPositivePromptTokens } from './prompt-token-library-expanded';
import { animePositivePromptTokens } from './prompt-token-library-anime';

export type PromptTokenScope = 'positive' | 'negative';
export type PromptDialect = 'natural' | 'sdxl' | 'illustrious';
export type PromptTokenTarget = 'image' | 'video' | 'model';
export type PromptTokenTone = 'subject' | 'wardrobe' | 'action' | 'camera' | 'environment' | 'elements' | 'finish' | 'quality' | 'anatomy' | 'frame' | 'content';

export type PromptToken = {
  id: string;
  scope: PromptTokenScope;
  category: string;
  group: string;
  label: string;
  values: Record<PromptDialect, string>;
  aliases?: string[];
};

export type PromptTokenRecipe = {
  id: string;
  label: string;
  description: string;
  scope: PromptTokenScope;
  sectionIds: string[];
  tokenIds: string[];
  keywords?: string[];
  guidance?: string;
  preview: 'character-sheet' | 'action-grid' | 'key-art' | 'style' | 'negative';
  targets?: PromptTokenTarget[];
};

export type PromptTokenNavigationItem = {
  id: string;
  label: string;
  hint: string;
  categories: string[];
};

export const astralAvatarPromptTokenId = 'fx-energy-astral-avatar';
export const duplicateCharacterNegativePromptTokenId = 'negative-duplicate';
export const astralAvatarMisreadNegativePromptTokenId = 'negative-astral-avatar-misread';

export const promptTokenNavigation: Record<PromptTokenScope, PromptTokenNavigationItem[]> = {
  positive: [
    { id: 'subject', label: '主体', hint: '画谁', categories: ['人物'] },
    { id: 'wardrobe', label: '穿搭', hint: '穿什么', categories: ['服饰', '汉服'] },
    { id: 'action', label: '动作', hint: '在做什么', categories: ['表情动作'] },
    { id: 'camera', label: '画面', hint: '怎么拍', categories: ['构图', '镜头'] },
    { id: 'environment', label: '环境', hint: '在哪里', categories: ['场景', '建筑', '自然', '光影环境', '色彩'] },
    { id: 'elements', label: '元素', hint: '还要什么', categories: ['物品', '生物', '魔法', '特效'] },
    { id: 'finish', label: '风格', hint: '画成什么样', categories: ['画风', '质量渲染'] },
  ],
  negative: [
    { id: 'quality', label: '画质', hint: '排除画质问题', categories: ['质量'] },
    { id: 'anatomy', label: '人体', hint: '排除人体问题', categories: ['人体', '手部', '面部'] },
    { id: 'frame', label: '画面', hint: '排除画面干扰', categories: ['构图', '文字', '背景', '色彩光线'] },
    { id: 'content', label: '内容', hint: '排除不需要的内容', categories: ['内容控制'] },
  ],
};

export function promptTokenTone(entry: Pick<PromptToken, 'scope' | 'category'>): PromptTokenTone {
  const section = promptTokenNavigation[entry.scope].find((item) => item.categories.includes(entry.category));
  return (section?.id || (entry.scope === 'negative' ? 'content' : 'subject')) as PromptTokenTone;
}

export const promptTokenMarkerPattern = /\{\{prompt-token:(positive|negative):([a-z0-9][a-z0-9_-]*)\}\}/gi;

export function promptTokenMarker(scope: PromptTokenScope, id: string): string {
  return `{{prompt-token:${scope}:${id}}}`;
}

const token = (
  id: string,
  scope: PromptTokenScope,
  category: string,
  group: string,
  label: string,
  illustrious: string,
  sdxl = illustrious,
  natural = sdxl,
  aliases: string[] = [],
): PromptToken => ({ id, scope, category, group, label, values: { illustrious, sdxl, natural }, aliases });

type PromptTokenRow = readonly [
  id: string,
  label: string,
  illustrious: string,
  sdxl?: string,
  natural?: string,
  aliases?: string[],
];

const tokenGroup = (
  scope: PromptTokenScope,
  category: string,
  group: string,
  rows: readonly PromptTokenRow[],
): PromptToken[] => rows.map(([id, label, illustrious, sdxl, natural, aliases]) => {
  const sdxlValue = sdxl || illustrious;
  return token(id, scope, category, group, label, illustrious, sdxlValue, natural || sdxlValue, aliases || []);
});

const rawPromptTokens: PromptToken[] = [
  token('subject-single', 'positive', '人物', '对象', '单人', 'solo', 'single character', 'a single character', ['一个人', 'solo']),
  token('subject-full-body', 'positive', '人物', '对象', '全身', 'full body', 'full body', 'full-body view'),
  token('subject-adult-woman', 'positive', '人物', '身份', '成年女性', '1girl, adult', 'adult woman', 'an adult woman'),
  token('subject-adult-man', 'positive', '人物', '身份', '成年男性', '1boy, adult', 'adult man', 'an adult man'),
  token('subject-warrior', 'positive', '人物', '身份', '战士', 'warrior', 'warrior', 'a warrior'),
  token('subject-knight', 'positive', '人物', '身份', '骑士', 'knight', 'fantasy knight', 'a fantasy knight'),
  token('subject-mage', 'positive', '人物', '身份', '法师', 'mage', 'fantasy mage', 'a fantasy mage'),
  token('subject-archer', 'positive', '人物', '身份', '弓箭手', 'archer', 'fantasy archer', 'a fantasy archer'),
  token('body-slender', 'positive', '人物', '体型', '修长', 'slender', 'slender build', 'a slender build'),
  token('body-athletic', 'positive', '人物', '体型', '健美', 'athletic', 'athletic build', 'an athletic build'),
  token('hair-long', 'positive', '人物', '外形', '长发', 'long hair', 'long hair', 'long hair'),
  token('hair-short', 'positive', '人物', '外形', '短发', 'short hair', 'short hair', 'short hair'),
  token('hair-black', 'positive', '人物', '外形', '黑发', 'black hair', 'black hair', 'black hair'),
  token('hair-white', 'positive', '人物', '外形', '白发', 'white hair', 'white hair', 'white hair'),

  token('outfit-armor', 'positive', '服饰', '类型', '幻想铠甲', 'fantasy armor', 'fantasy armor', 'wearing ornate fantasy armor'),
  token('outfit-robe', 'positive', '服饰', '类型', '法师长袍', 'mage robe', 'mage robe', 'wearing a layered mage robe'),
  token('outfit-dress', 'positive', '服饰', '类型', '礼服', 'elegant dress', 'elegant dress', 'wearing an elegant dress'),
  token('outfit-cloak', 'positive', '服饰', '部件', '披风', 'cape', 'flowing cape', 'with a flowing cape'),
  token('outfit-boots', 'positive', '服饰', '部件', '长靴', 'tall boots', 'tall boots', 'wearing tall boots'),
  token('material-metal', 'positive', '服饰', '材质', '金属', 'polished metal', 'polished metal', 'polished metal materials'),
  token('material-leather', 'positive', '服饰', '材质', '皮革', 'leather', 'detailed leather', 'detailed leather materials'),
  token('palette-red-black', 'positive', '服饰', '配色', '红黑配色', 'red and black color scheme', 'red and black palette', 'a red and black color palette'),
  token('palette-blue-silver', 'positive', '服饰', '配色', '蓝银配色', 'blue and silver color scheme', 'blue and silver palette', 'a blue and silver color palette'),
  token('palette-gold-accent', 'positive', '服饰', '配色', '金色点缀', 'gold accents', 'gold accents', 'subtle gold accents'),

  token('expression-confident', 'positive', '表情动作', '表情', '自信', 'confident expression', 'confident expression', 'a confident expression'),
  token('expression-calm', 'positive', '表情动作', '表情', '沉静', 'calm expression', 'calm expression', 'a calm expression'),
  token('expression-serious', 'positive', '表情动作', '表情', '严肃', 'serious expression', 'serious expression', 'a serious expression'),
  token('pose-standing', 'positive', '表情动作', '站姿', '自然站立', 'standing', 'natural standing pose', 'standing in a natural pose'),
  token('pose-action', 'positive', '表情动作', '身体姿态', '动态姿势', 'dynamic pose', 'dynamic action pose', 'in a dynamic action pose'),
  token('pose-weapon-ready', 'positive', '表情动作', '战斗动作', '持武器戒备', 'holding weapon, ready stance', 'holding a weapon, ready stance', 'holding a weapon in a ready stance'),
  token('gaze-camera', 'positive', '表情动作', '视线', '看向镜头', 'looking at viewer', 'looking at camera', 'looking toward the camera'),
  token('gaze-away', 'positive', '表情动作', '视线', '望向远方', 'looking away', 'looking into the distance', 'looking into the distance'),

  token('composition-centered', 'positive', '构图', '构图', '居中构图', 'centered composition', 'centered composition', 'a centered composition'),
  token('composition-character-design', 'positive', '构图', '构图', '角色设定图', 'character design', 'character concept art', 'character concept art presentation'),
  token('composition-splash', 'positive', '构图', '构图', '游戏美宣', 'game promotional art', 'game key art', 'polished fantasy game key art'),
  token('shot-close-up', 'positive', '镜头', '景别', '特写', 'close-up', 'close-up shot', 'a close-up shot'),
  token('shot-medium', 'positive', '镜头', '景别', '中景', 'medium shot', 'medium shot', 'a medium shot'),
  token('shot-long', 'positive', '镜头', '景别', '全景', 'full body, wide shot', 'full-body wide shot', 'a full-body wide shot'),
  token('angle-eye-level', 'positive', '镜头', '视角', '平视', 'eye level', 'eye-level view', 'viewed at eye level'),
  token('angle-low', 'positive', '镜头', '视角', '低机位', 'from below', 'low-angle view', 'viewed from a low angle'),
  token('lens-dynamic', 'positive', '镜头', '透视效果', '动感透视', 'dynamic perspective', 'dynamic perspective', 'dynamic perspective with controlled foreshortening'),

  token('scene-plain', 'positive', '场景', '场景', '纯净背景', 'simple background', 'plain background', 'a clean plain background'),
  token('scene-studio', 'positive', '场景', '场景', '影棚背景', 'studio background', 'studio backdrop', 'a minimal studio backdrop'),
  token('scene-castle', 'positive', '场景', '场景', '幻想城堡', 'fantasy castle', 'fantasy castle environment', 'a grand fantasy castle environment'),
  token('scene-forest', 'positive', '场景', '场景', '魔法森林', 'enchanted forest', 'enchanted forest', 'an enchanted forest'),
  token('lighting-soft', 'positive', '光影环境', '光线', '柔和光', 'soft lighting', 'soft diffused lighting', 'soft diffused lighting'),
  token('lighting-cinematic', 'positive', '光影环境', '光线', '电影光', 'cinematic lighting', 'cinematic lighting', 'cinematic key lighting'),
  token('lighting-rim', 'positive', '光影环境', '光线', '轮廓光', 'rim lighting', 'rim lighting', 'a controlled rim light'),
  token('mood-heroic', 'positive', '光影环境', '氛围', '英雄感', 'heroic atmosphere', 'heroic atmosphere', 'a heroic atmosphere'),
  token('mood-mysterious', 'positive', '光影环境', '氛围', '神秘感', 'mysterious atmosphere', 'mysterious atmosphere', 'a mysterious atmosphere'),

  token('style-anime-game', 'positive', '画风', '画风', '二次元游戏美术', 'anime game art', 'anime game character art', 'polished anime game character art'),
  token('style-painterly', 'positive', '画风', '画风', '厚涂插画', 'painterly illustration', 'painterly illustration', 'a painterly digital illustration'),
  token('style-clean-lineart', 'positive', '画风', '画风', '干净线稿', 'clean lineart', 'clean line art', 'clean controlled line art'),
  token('quality-masterpiece', 'positive', '质量渲染', '质量', '高品质', 'masterpiece, best quality, amazing quality', 'high quality, highly detailed', 'high quality and highly detailed'),
  token('quality-detail', 'positive', '质量渲染', '质量', '精细细节', 'intricate details', 'intricate details', 'intricate, readable details'),
  token('quality-sharp', 'positive', '质量渲染', '质量', '清晰锐利', 'sharp focus', 'sharp focus', 'sharp, well-defined details'),

  ...tokenGroup('positive', '人物', '对象', [
    ['subject-one-girl', '1女孩', '1girl', 'one young woman', 'one young woman'],
    ['subject-one-boy', '1男孩', '1boy', 'one young man', 'one young man'],
    ['subject-two-girls', '2女孩', '2girls', 'two young women', 'two young women'],
    ['subject-two-boys', '2男孩', '2boys', 'two young men', 'two young men'],
    ['subject-three-girls', '3女孩', '3girls', 'three young women', 'three young women'],
    ['subject-three-boys', '3男孩', '3boys', 'three young men', 'three young men'],
    ['subject-pair', '双人', '2people', 'two characters', 'two characters together'],
    ['subject-trio', '三人', '3people', 'three characters', 'three characters together'],
    ['subject-group', '群像', 'group, multiple people', 'group portrait', 'a group of characters'],
    ['subject-duo-contrast', '角色组合', 'character duo, contrasting designs', 'contrasting character duo', 'two contrasting character designs'],
    ['subject-multiple-girls', '多位女性', 'multiple girls', 'multiple female characters', 'multiple female characters'],
    ['subject-sisters', '姐妹', 'sisters', 'sisters together', 'a group of sisters together'],
    ['subject-little-girl', '小女孩', 'little girl', 'young girl', 'a young girl'],
    ['subject-little-boy', '小男孩', 'little boy', 'young boy', 'a young boy'],
    ['subject-young-lady', '少女', 'young lady', 'young woman', 'a young woman'],
    ['subject-bishoujo', '美少女', 'bishoujo', 'beautiful anime girl', 'a beautiful anime-style young woman'],
    ['subject-kawaii', '可爱角色', 'kawaii', 'cute character', 'a cute character'],
    ['subject-adult-female', '成熟女性', 'mature female', 'mature woman', 'a mature adult woman'],
  ]),
  ...tokenGroup('positive', '人物', '身份', [
    ['subject-princess', '公主', 'princess', 'fantasy princess', 'a fantasy princess'],
    ['subject-queen', '女王', 'queen', 'regal queen', 'a regal queen'],
    ['subject-prince', '王子', 'prince', 'fantasy prince', 'a fantasy prince'],
    ['subject-king', '国王', 'king', 'regal king', 'a regal king'],
    ['subject-assassin', '刺客', 'assassin', 'fantasy assassin', 'a stealthy fantasy assassin'],
    ['subject-samurai', '武士', 'samurai', 'samurai warrior', 'a samurai warrior'],
    ['subject-ninja', '忍者', 'ninja', 'ninja warrior', 'a ninja warrior'],
    ['subject-paladin', '圣骑士', 'paladin', 'holy paladin', 'a holy paladin'],
    ['subject-priest', '祭司', 'priest', 'fantasy priest', 'a fantasy priest'],
    ['subject-witch', '女巫', 'witch', 'fantasy witch', 'a fantasy witch'],
    ['subject-elf', '精灵', 'elf', 'elven character', 'an elven character'],
    ['subject-demon', '恶魔', 'demon', 'demon character', 'a demonic character'],
    ['subject-angel', '天使', 'angel', 'angelic character', 'an angelic character'],
    ['subject-android', '机械人', 'android', 'fantasy android', 'a fantasy android'],
  ]),
  ...tokenGroup('positive', '人物', '体型', [
    ['body-tall', '高挑', 'tall', 'tall build', 'a tall build'],
    ['body-petite', '娇小', 'petite', 'petite build', 'a petite build'],
    ['body-muscular', '强壮', 'muscular', 'muscular build', 'a muscular build'],
    ['body-curvy', '丰满', 'curvy', 'curvy build', 'a curvy build'],
    ['body-slim', '纤细', 'slim', 'slim build', 'a slim build'],
    ['body-chibi', 'Q版', 'chibi', 'chibi proportions', 'stylized chibi proportions'],
  ]),
  ...tokenGroup('positive', '人物', '外形', [
    ['hair-ponytail', '马尾', 'ponytail', 'ponytail hairstyle', 'hair tied in a ponytail'],
    ['hair-twintails', '双马尾', 'twintails', 'twin-tail hairstyle', 'hair styled in twin tails'],
    ['hair-braided', '编发', 'braid', 'braided hair', 'braided hair'],
    ['hair-wavy', '波浪发', 'wavy hair', 'wavy hair', 'wavy hair'],
    ['hair-blonde', '金发', 'blonde hair', 'blonde hair', 'blonde hair'],
    ['hair-red', '红发', 'red hair', 'red hair', 'red hair'],
    ['hair-blue', '蓝发', 'blue hair', 'blue hair', 'blue hair'],
  ]),
  ...tokenGroup('positive', '人物', '五官', [
    ['eyes-blue', '蓝眼', 'blue eyes', 'blue eyes', 'blue eyes'],
    ['eyes-red', '红眼', 'red eyes', 'red eyes', 'red eyes'],
    ['eyes-gold', '金瞳', 'golden eyes', 'golden eyes', 'golden eyes'],
    ['eyes-sharp', '锐利眼神', 'sharp eyes', 'sharp eyes', 'a sharp focused gaze'],
    ['eyes-round', '圆眼', 'round eyes', 'round eyes', 'round eyes'],
    ['face-freckles', '雀斑', 'freckles', 'facial freckles', 'subtle facial freckles'],
    ['face-scar', '面部伤疤', 'facial scar', 'facial scar', 'a visible facial scar'],
    ['ears-elf', '精灵耳', 'pointy ears', 'pointed elf ears', 'pointed elven ears'],
  ]),

  ...tokenGroup('positive', '服饰', '类型', [
    ['outfit-casual', '休闲服', 'casual clothes', 'casual clothing', 'wearing casual clothing'],
    ['outfit-school', '学院制服', 'school uniform', 'academy uniform', 'wearing a structured academy uniform'],
    ['outfit-military', '军装', 'military uniform', 'military uniform', 'wearing a tailored military uniform'],
    ['outfit-suit', '西装', 'suit', 'formal suit', 'wearing a formal suit'],
    ['outfit-kimono', '和服', 'kimono', 'traditional kimono', 'wearing a traditional kimono'],
    ['outfit-hanfu', '汉服', 'hanfu', 'traditional hanfu', 'wearing layered traditional hanfu'],
    ['outfit-qipao', '旗袍', 'china dress', 'qipao dress', 'wearing an elegant qipao dress'],
    ['outfit-cyberpunk', '赛博服饰', 'cyberpunk clothes', 'cyberpunk outfit', 'wearing a detailed cyberpunk outfit'],
    ['outfit-gothic', '哥特服饰', 'gothic fashion', 'gothic fashion', 'wearing gothic fashion'],
    ['outfit-streetwear', '街头服饰', 'streetwear', 'modern streetwear', 'wearing modern streetwear'],
    ['outfit-priest', '祭司长袍', 'priest robe', 'ceremonial priest robe', 'wearing a ceremonial priest robe'],
    ['outfit-adventurer', '冒险者服', 'adventurer outfit', 'fantasy adventurer outfit', 'wearing practical fantasy adventurer clothing'],
  ]),
  ...tokenGroup('positive', '服饰', '部件', [
    ['part-gloves', '手套', 'gloves', 'fitted gloves', 'wearing fitted gloves'],
    ['part-hood', '兜帽', 'hood', 'hooded garment', 'wearing a hood'],
    ['part-helmet', '头盔', 'helmet', 'fantasy helmet', 'wearing a fantasy helmet'],
    ['part-crown', '王冠', 'crown', 'ornate crown', 'wearing an ornate crown'],
    ['part-necklace', '项链', 'necklace', 'ornate necklace', 'wearing an ornate necklace'],
    ['part-earrings', '耳饰', 'earrings', 'decorative earrings', 'wearing decorative earrings'],
    ['part-belt', '腰带', 'belt', 'decorative belt', 'wearing a detailed belt'],
    ['part-pauldrons', '肩甲', 'pauldrons', 'ornate pauldrons', 'wearing a pair of ornate pauldrons'],
    ['part-gauntlets', '臂甲', 'gauntlets', 'armored forearm gauntlets', 'wearing reinforced forearm gauntlets'],
    ['part-stockings', '长袜', 'long stockings', 'long stockings', 'wearing long stockings'],
  ]),
  ...tokenGroup('positive', '服饰', '材质', [
    ['material-silk', '丝绸', 'silk', 'silk fabric', 'lustrous silk fabric'],
    ['material-velvet', '天鹅绒', 'velvet', 'velvet fabric', 'soft velvet fabric'],
    ['material-lace', '蕾丝', 'lace', 'lace details', 'delicate lace details'],
    ['material-chiffon', '薄纱', 'sheer fabric', 'layered sheer fabric', 'layered translucent sheer fabric'],
    ['material-fur', '皮草', 'fur material', 'soft fur material', 'soft fur material'],
    ['material-crystal', '水晶', 'crystal', 'crystal details', 'faceted crystal details'],
    ['material-gold', '黄金', 'gold', 'golden material', 'polished golden material'],
  ]),
  ...tokenGroup('positive', '服饰', '配色', [
    ['palette-monochrome', '单色系', 'monochrome', 'monochrome palette', 'a controlled monochrome palette'],
    ['palette-black-gold', '黑金配色', 'black and gold color scheme', 'black and gold palette', 'a black and gold palette'],
    ['palette-white-gold', '白金配色', 'white and gold color scheme', 'white and gold palette', 'a white and gold palette'],
    ['palette-purple-gold', '紫金配色', 'purple and gold color scheme', 'purple and gold palette', 'a purple and gold palette'],
    ['palette-green-brown', '绿棕配色', 'green and brown color scheme', 'green and brown palette', 'an earthy green and brown palette'],
    ['palette-pastel', '柔和粉彩', 'pastel colors', 'pastel palette', 'a soft pastel palette'],
    ['palette-neon', '霓虹配色', 'neon colors', 'neon palette', 'a vivid neon palette'],
  ]),

  ...tokenGroup('positive', '汉服', '款式', [
    ['hanfu-ruqun', '襦裙', 'ruqun hanfu', 'traditional ruqun hanfu', 'wearing a traditional ruqun hanfu'],
    ['hanfu-aoqun', '袄裙', 'aoqun hanfu', 'traditional aoqun hanfu', 'wearing a traditional aoqun hanfu'],
    ['hanfu-shenyi', '深衣', 'shenyi hanfu', 'traditional shenyi robe', 'wearing a traditional shenyi robe'],
    ['hanfu-quju', '曲裾', 'quju robe', 'curved-hem quju hanfu', 'wearing a curved-hem quju hanfu'],
    ['hanfu-zhiju', '直裾', 'zhiju robe', 'straight-hem zhiju hanfu', 'wearing a straight-hem zhiju hanfu'],
    ['hanfu-tang', '唐制汉服', 'Tang dynasty hanfu', 'Tang-inspired hanfu', 'wearing Tang-inspired hanfu'],
    ['hanfu-song', '宋制汉服', 'Song dynasty hanfu', 'Song-inspired hanfu', 'wearing Song-inspired hanfu'],
    ['hanfu-ming', '明制汉服', 'Ming dynasty hanfu', 'Ming-inspired hanfu', 'wearing Ming-inspired hanfu'],
    ['hanfu-round-collar', '圆领袍', 'yuanlingpao', 'round-collar Chinese robe', 'wearing a traditional round-collar Chinese robe'],
    ['hanfu-wuxia', '武侠劲装', 'wuxia outfit', 'layered wuxia clothing', 'wearing practical layered wuxia clothing'],
    ['hanfu-palace', '宫廷华服', 'Chinese palace dress', 'ornate Chinese court dress', 'wearing an ornate Chinese court dress'],
    ['hanfu-scholar', '文士长衫', 'scholar robe', 'traditional Chinese scholar robe', 'wearing a traditional Chinese scholar robe'],
  ]),
  ...tokenGroup('positive', '汉服', '结构', [
    ['hanfu-cross-collar', '交领', 'cross-collar hanfu', 'cross-collar hanfu', 'a crossed-collar garment'],
    ['hanfu-right-lapel', '右衽', 'right-lapel hanfu', 'right-lapel hanfu', 'a traditional right-lapel closure'],
    ['hanfu-wide-sleeves', '广袖', 'wide sleeves', 'wide flowing sleeves', 'wide flowing sleeves'],
    ['hanfu-narrow-sleeves', '窄袖', 'narrow sleeves', 'fitted narrow sleeves', 'fitted narrow sleeves'],
    ['hanfu-water-sleeves', '水袖', 'water sleeves', 'long flowing water sleeves', 'long flowing water sleeves'],
    ['hanfu-layered', '多层叠穿', 'layered hanfu', 'layered hanfu garments', 'multiple layered hanfu garments'],
    ['hanfu-high-waist', '齐胸高腰', 'high-waisted chest-high ruqun', 'high-waisted chest-high ruqun', 'a high-waisted chest-high ruqun silhouette'],
    ['hanfu-pleated-skirt', '百褶裙', 'pleated hanfu skirt', 'pleated Chinese skirt', 'a finely pleated Chinese skirt'],
    ['hanfu-long-train', '曳地长摆', 'long trailing hem', 'long trailing garment hem', 'a long trailing garment hem'],
    ['hanfu-waist-sash', '束腰系带', 'waist sash', 'layered waist sash', 'a layered tied waist sash'],
  ]),
  ...tokenGroup('positive', '汉服', '配饰', [
    ['hanfu-jade-pendant', '玉佩', 'jade pendant', 'traditional jade pendant', 'wearing a traditional jade pendant'],
    ['hanfu-hairpin', '发簪', 'hairpin', 'ornate Chinese hairpin', 'wearing an ornate Chinese hairpin'],
    ['hanfu-buyao', '步摇', 'buyao hair ornament', 'dangling buyao hair ornament', 'wearing a dangling buyao hair ornament'],
    ['hanfu-coronet', '发冠', 'Chinese hair crown', 'ornate Chinese hair crown', 'wearing an ornate Chinese hair crown'],
    ['hanfu-folding-fan', '折扇', 'folding fan', 'traditional folding fan', 'holding a traditional folding fan'],
    ['hanfu-sachet', '香囊', 'embroidered sachet', 'embroidered Chinese sachet', 'wearing an embroidered Chinese sachet'],
    ['hanfu-tassels', '流苏', 'decorative tassels', 'layered decorative tassels', 'decorated with layered tassels'],
    ['hanfu-arm-silk', '披帛', 'pibo silk scarf', 'flowing pibo silk scarf', 'with a flowing pibo silk scarf'],
    ['hanfu-cape', '斗篷', 'Chinese cloak', 'traditional Chinese cloak', 'wearing a traditional Chinese cloak'],
    ['hanfu-belt', '蹀躞带', 'diexie belt', 'traditional Chinese diexie belt', 'wearing a traditional Chinese diexie belt'],
  ]),
  ...tokenGroup('positive', '汉服', '纹样', [
    ['hanfu-cloud-pattern', '云纹', 'cloud pattern', 'traditional cloud motifs', 'decorated with traditional cloud motifs'],
    ['hanfu-dragon-pattern', '龙纹', 'dragon pattern', 'embroidered dragon motifs', 'decorated with embroidered dragon motifs'],
    ['hanfu-phoenix-pattern', '凤纹', 'phoenix pattern', 'embroidered phoenix motifs', 'decorated with embroidered phoenix motifs'],
    ['hanfu-lotus-pattern', '莲纹', 'lotus pattern', 'embroidered lotus motifs', 'decorated with embroidered lotus motifs'],
    ['hanfu-crane-pattern', '鹤纹', 'crane pattern', 'embroidered crane motifs', 'decorated with embroidered crane motifs'],
    ['hanfu-landscape-pattern', '山水纹', 'landscape pattern', 'Chinese landscape motifs', 'decorated with Chinese landscape motifs'],
    ['hanfu-brocade', '织锦', 'Chinese brocade', 'intricate Chinese brocade', 'made from intricate Chinese brocade'],
    ['hanfu-gold-embroidery', '金线刺绣', 'gold embroidery', 'fine gold-thread embroidery', 'decorated with fine gold-thread embroidery'],
  ]),

  ...tokenGroup('positive', '表情动作', '表情', [
    ['expression-smile', '微笑', 'smile', 'gentle smile', 'a gentle smile'],
    ['expression-gentle', '温柔', 'gentle expression', 'gentle expression', 'a gentle expression'],
    ['expression-joyful', '开心', 'happy', 'joyful expression', 'a joyful expression'],
    ['expression-angry', '愤怒', 'angry', 'angry expression', 'an angry expression'],
    ['expression-sad', '悲伤', 'sad', 'sad expression', 'a sad expression'],
    ['expression-surprised', '惊讶', 'surprised', 'surprised expression', 'a surprised expression'],
    ['expression-determined', '坚定', 'determined', 'determined expression', 'a determined expression'],
    ['expression-shy', '害羞', 'shy', 'shy expression', 'a shy expression'],
    ['expression-smirk', '轻蔑笑', 'smirk', 'confident smirk', 'a confident smirk'],
    ['expression-crying', '落泪', 'crying', 'tearful expression', 'a tearful expression'],
  ]),
  ...tokenGroup('positive', '表情动作', '坐姿', [
    ['pose-sitting', '坐姿', 'sitting', 'seated pose', 'sitting naturally'],
  ]),
  ...tokenGroup('positive', '表情动作', '跪蹲', [
    ['pose-kneeling', '跪姿', 'kneeling', 'kneeling pose', 'kneeling gracefully'],
  ]),
  ...tokenGroup('positive', '表情动作', '行走跑跳', [
    ['pose-walking', '行走', 'walking', 'walking pose', 'walking forward'],
    ['pose-running', '奔跑', 'running', 'running pose', 'running dynamically'],
    ['pose-jumping', '跳跃', 'jumping', 'jumping pose', 'jumping through the air'],
    ['pose-landing', '落地', 'landing pose', 'dynamic landing pose', 'landing in a dynamic pose'],
  ]),
  ...tokenGroup('positive', '表情动作', '战斗动作', [
    ['pose-sword-swing', '挥剑', 'swinging sword', 'sword-swinging action', 'swinging a sword'],
    ['pose-spellcasting', '施法', 'casting spell', 'spellcasting pose', 'casting a spell'],
    ['pose-fighting', '战斗架势', 'fighting stance', 'combat stance', 'holding a ready combat stance'],
  ]),
  ...tokenGroup('positive', '表情动作', '手臂动作', [
    ['pose-reaching', '伸手', 'reaching out', 'reaching pose', 'reaching one hand forward'],
    ['pose-crossed-arms', '抱臂', 'crossed arms', 'arms crossed', 'standing with arms crossed'],
    ['pose-hands-hips', '叉腰', 'hands on hips', 'hands-on-hips pose', 'standing with hands on hips'],
  ]),
  ...tokenGroup('positive', '表情动作', '身体姿态', [
    ['pose-floating', '悬浮', 'floating', 'floating pose', 'floating in the air'],
    ['pose-turning', '回身', 'turning around', 'turning pose', 'turning the body around'],
    ['pose-leaning', '倚靠', 'leaning', 'leaning pose', 'leaning casually against a surface'],
  ]),
  ...tokenGroup('positive', '表情动作', '舞蹈运动', [
    ['pose-dancing', '舞蹈', 'dancing', 'dance pose', 'moving in an elegant dance pose'],
  ]),
  ...tokenGroup('positive', '表情动作', '视线', [
    ['gaze-side', '侧目', 'side glance', 'side glance', 'glancing to the side'],
    ['gaze-up', '向上看', 'looking up', 'looking upward', 'looking upward'],
    ['gaze-down', '向下看', 'looking down', 'looking downward', 'looking downward'],
    ['gaze-closed', '闭眼', 'eyes closed', 'closed eyes', 'with eyes closed'],
    ['gaze-over-shoulder', '回眸', 'looking over shoulder', 'over-the-shoulder glance', 'looking back over one shoulder'],
    ['gaze-profile', '侧脸凝视', 'profile, looking ahead', 'profile gaze', 'shown in profile while looking ahead'],
  ]),
  ...tokenGroup('positive', '表情动作', '手势', [
    ['gesture-open-palm', '张开手掌', 'open hand', 'open-palm gesture', 'holding an open palm forward'],
    ['gesture-fist', '握拳', 'clenched fist', 'clenched-fist gesture', 'clenching one fist'],
    ['gesture-pointing', '指向', 'pointing', 'pointing gesture', 'pointing toward something'],
    ['gesture-peace', '胜利手势', 'peace sign', 'peace-sign gesture', 'making a peace sign'],
    ['gesture-holding', '双手持物', 'holding object with both hands', 'holding an object with both hands', 'holding an object with both hands'],
    ['gesture-prayer', '祈祷', 'hands together', 'prayer gesture', 'holding both hands together in prayer'],
    ['gesture-wave', '挥手', 'waving', 'waving hand', 'waving one hand'],
    ['gesture-hand-chest', '手放心口', 'hand on chest', 'hand-on-chest gesture', 'resting one hand over the chest'],
  ]),

  ...tokenGroup('positive', '构图', '构图', [
    ['composition-thirds', '三分构图', 'rule of thirds', 'rule-of-thirds composition', 'a rule-of-thirds composition'],
    ['composition-symmetry', '对称构图', 'symmetrical composition', 'symmetrical composition', 'a symmetrical composition'],
    ['composition-diagonal', '对角线构图', 'diagonal composition', 'diagonal composition', 'a strong diagonal composition'],
    ['composition-triangle', '三角构图', 'triangular composition', 'triangular composition', 'a stable triangular composition'],
    ['composition-dynamic', '动态构图', 'dynamic composition', 'dynamic composition', 'a dynamic composition'],
    ['composition-negative-space', '留白构图', 'negative space', 'negative-space composition', 'a composition with intentional negative space'],
    ['composition-poster', '海报构图', 'poster composition', 'poster-style composition', 'a polished poster composition'],
    ['composition-cinematic', '电影构图', 'cinematic composition', 'cinematic composition', 'a cinematic composition'],
    ['composition-layered', '前中后景', 'layered composition', 'layered depth composition', 'a layered foreground, midground, and background'],
    ['composition-frame', '框式构图', 'frame within frame', 'frame-within-a-frame composition', 'a frame-within-a-frame composition'],
  ]),
  ...tokenGroup('positive', '镜头', '景别', [
    ['shot-extreme-closeup', '大特写', 'extreme close-up', 'extreme close-up', 'an extreme close-up'],
    ['shot-bust', '胸像', 'bust shot', 'bust portrait', 'a bust portrait'],
    ['shot-upper-body', '半身', 'waist-up portrait', 'upper-body shot', 'an upper-body shot'],
    ['shot-knee-up', '膝上景', 'cowboy shot', 'knee-up shot', 'a knee-up character shot'],
    ['shot-establishing', '远景', 'establishing shot', 'wide establishing shot', 'a wide establishing shot'],
  ]),
  ...tokenGroup('positive', '镜头', '视角', [
    ['angle-high', '俯拍', 'from above', 'high-angle view', 'viewed from above'],
    ['angle-birds-eye', '鸟瞰', 'bird eye view', 'bird\'s-eye view', 'seen from a bird\'s-eye view'],
    ['angle-worms-eye', '仰视', 'worm eye view', 'worm\'s-eye view', 'seen from a dramatic worm\'s-eye view'],
    ['angle-three-quarter', '四分之三侧面', 'three-quarter view', 'three-quarter view', 'shown from a three-quarter view'],
    ['angle-profile', '正侧面', 'profile', 'side profile', 'shown in side profile'],
    ['angle-back', '背面视角', 'from behind', 'back view', 'viewed from behind'],
    ['angle-dutch', '倾斜镜头', 'dutch angle', 'Dutch-angle view', 'shown with a Dutch-angle composition'],
    ['angle-over-shoulder', '越肩视角', 'over the shoulder', 'over-the-shoulder view', 'seen from over the shoulder'],
  ]),
  ...tokenGroup('positive', '镜头', '镜头类型', [
    ['lens-wide', '广角', 'wide angle lens', 'wide-angle lens', 'captured with a wide-angle lens'],
    ['lens-telephoto', '长焦', 'telephoto lens', 'telephoto lens', 'captured with a telephoto lens'],
    ['lens-fisheye', '鱼眼', 'fisheye lens', 'fisheye lens', 'captured with a fisheye lens'],
    ['lens-macro', '微距', 'macro lens', 'macro close-up lens', 'captured with a macro close-up lens'],
    ['lens-anamorphic', '变形宽银幕', 'anamorphic lens', 'anamorphic cinematic lens', 'captured with an anamorphic cinematic lens'],
    ['lens-tilt-shift', '移轴', 'tilt-shift lens', 'tilt-shift lens', 'captured with a tilt-shift lens'],
    ['lens-orthographic', '正交视图', 'orthographic view', 'orthographic camera view', 'shown in an orthographic camera view'],
  ]),
  ...tokenGroup('positive', '镜头', '景深对焦', [
    ['lens-shallow-dof', '浅景深', 'shallow depth of field', 'shallow depth of field', 'with a shallow depth of field'],
    ['lens-deep-focus', '深焦', 'deep focus', 'deep focus', 'with deep focus throughout the scene'],
    ['lens-bokeh', '背景散景', 'bokeh', 'soft bokeh', 'with soft background bokeh'],
  ]),
  ...tokenGroup('positive', '镜头', '透视效果', [
    ['lens-foreshortening', '透视缩短', 'foreshortening', 'dramatic foreshortening', 'with dramatic controlled foreshortening'],
  ]),
  ...tokenGroup('positive', '镜头', '成像风格', [
    ['lens-motion', '运动模糊', 'motion blur', 'controlled motion blur', 'with controlled motion blur'],
  ]),
  ...tokenGroup('positive', '镜头', '焦段', [
    ['lens-24mm', '24mm广角', '24mm lens', '24 mm wide-angle lens', 'captured with a 24 mm wide-angle lens'],
    ['lens-35mm', '35mm人文', '35mm lens', '35 mm lens', 'captured with a 35 mm lens'],
    ['lens-50mm', '50mm标准', '50mm lens', '50 mm standard lens', 'captured with a 50 mm standard lens'],
    ['lens-85mm', '85mm人像', '85mm lens', '85 mm portrait lens', 'captured with an 85 mm portrait lens'],
  ]),

  ...tokenGroup('positive', '场景', '场景', [
    ['scene-palace', '宫殿', 'palace interior', 'grand palace interior', 'inside a grand palace'],
    ['scene-ruins', '古代遗迹', 'ancient ruins', 'ancient ruins', 'among ancient ruins'],
    ['scene-city', '城市街道', 'city street', 'city street', 'on a detailed city street'],
    ['scene-cyber-city', '赛博都市', 'cyberpunk city', 'cyberpunk city', 'in a neon cyberpunk city'],
    ['scene-village', '幻想村庄', 'fantasy village', 'fantasy village', 'in a peaceful fantasy village'],
    ['scene-battlefield', '战场', 'battlefield', 'fantasy battlefield', 'on a dramatic fantasy battlefield'],
    ['scene-temple', '神殿', 'temple', 'ancient temple', 'inside an ancient temple'],
    ['scene-library', '图书馆', 'library', 'grand library', 'inside a grand library'],
    ['scene-throne', '王座厅', 'throne room', 'royal throne room', 'inside a royal throne room'],
    ['scene-desert', '沙漠', 'desert', 'vast desert', 'in a vast desert'],
    ['scene-snow-mountain', '雪山', 'snowy mountain', 'snow-covered mountains', 'among snow-covered mountains'],
    ['scene-ocean-cliff', '海边悬崖', 'ocean cliff', 'cliff above the ocean', 'on a cliff overlooking the ocean'],
    ['scene-garden', '花园', 'flower garden', 'ornate flower garden', 'in an ornate flower garden'],
    ['scene-workshop', '工坊', 'workshop', 'fantasy workshop', 'inside a detailed fantasy workshop'],
    ['scene-airship', '飞空艇', 'airship deck', 'fantasy airship deck', 'on the deck of a fantasy airship'],
    ['scene-space', '太空', 'outer space', 'deep-space environment', 'in a deep-space environment'],
  ]),
  ...tokenGroup('positive', '场景', '场景细节', [
    ['scene-foreground-depth', '前景遮挡', 'foreground elements', 'layered foreground elements', 'with layered foreground elements'],
    ['scene-grand-architecture', '宏伟建筑', 'grand architecture', 'monumental fantasy architecture', 'surrounded by monumental fantasy architecture'],
    ['scene-overgrown-ruins', '藤蔓遗迹', 'overgrown ruins', 'overgrown ancient ruins', 'among ancient ruins covered in vines'],
    ['scene-candle-clusters', '烛火群', 'many candles', 'clusters of glowing candles', 'surrounded by clusters of glowing candles'],
    ['scene-banners', '旗帜飘扬', 'flowing banners', 'large flowing banners', 'with large banners flowing in the air'],
    ['scene-floating-islands', '浮空岛', 'floating islands', 'fantasy floating islands', 'among fantasy floating islands'],
    ['scene-waterfall', '瀑布', 'waterfall', 'towering waterfall', 'near a towering waterfall'],
    ['scene-giant-moon', '巨型月亮', 'giant moon', 'enormous moon in background', 'with an enormous moon in the background'],
    ['scene-magic-portal', '传送门', 'magic portal', 'glowing magical portal', 'near a glowing magical portal'],
    ['scene-battle-debris', '战场残骸', 'battle debris', 'scattered battlefield debris', 'surrounded by scattered battlefield debris'],
  ]),
  ...tokenGroup('positive', '光影环境', '光线', [
    ['lighting-backlight', '逆光', 'backlighting', 'strong backlight', 'lit from behind'],
    ['lighting-side', '侧光', 'side lighting', 'directional side light', 'lit by directional side light'],
    ['lighting-volumetric', '体积光', 'volumetric lighting', 'volumetric lighting', 'with visible volumetric light'],
    ['lighting-god-rays', '耶稣光', 'god rays', 'crepuscular rays', 'with dramatic shafts of light'],
    ['lighting-moon', '月光', 'moonlight', 'cool moonlight', 'illuminated by cool moonlight'],
    ['lighting-sunset', '夕阳', 'sunset lighting', 'warm sunset light', 'illuminated by warm sunset light'],
    ['lighting-neon', '霓虹灯光', 'neon lighting', 'neon lighting', 'illuminated by neon lights'],
    ['lighting-candle', '烛光', 'candlelight', 'warm candlelight', 'illuminated by warm candlelight'],
    ['lighting-dramatic-shadow', '戏剧阴影', 'dramatic shadows', 'dramatic shadow lighting', 'with dramatic controlled shadows'],
    ['lighting-overcast', '阴天柔光', 'overcast lighting', 'soft overcast light', 'under soft overcast light'],
    ['lighting-studio', '影棚布光', 'studio lighting', 'professional studio lighting', 'with professional studio lighting'],
    ['lighting-silhouette', '剪影光', 'silhouette lighting', 'silhouette backlight', 'rendered as a strong lit silhouette'],
  ]),
  ...tokenGroup('positive', '光影环境', '氛围', [
    ['mood-romantic', '浪漫', 'romantic atmosphere', 'romantic atmosphere', 'a romantic atmosphere'],
    ['mood-dark', '暗黑', 'dark atmosphere', 'dark fantasy atmosphere', 'a dark fantasy atmosphere'],
    ['mood-peaceful', '宁静', 'peaceful atmosphere', 'peaceful atmosphere', 'a peaceful atmosphere'],
    ['mood-tense', '紧张', 'tense atmosphere', 'tense atmosphere', 'a tense atmosphere'],
    ['mood-epic', '史诗感', 'epic atmosphere', 'epic atmosphere', 'an epic atmosphere'],
    ['mood-dreamy', '梦幻', 'dreamy atmosphere', 'dreamlike atmosphere', 'a dreamlike atmosphere'],
    ['mood-melancholic', '忧郁', 'melancholic atmosphere', 'melancholic atmosphere', 'a melancholic atmosphere'],
    ['mood-sacred', '神圣', 'sacred atmosphere', 'sacred atmosphere', 'a sacred atmosphere'],
    ['mood-horror', '恐怖', 'horror atmosphere', 'ominous horror atmosphere', 'an ominous horror atmosphere'],
    ['mood-festive', '庆典', 'festive atmosphere', 'festive atmosphere', 'a lively festive atmosphere'],
  ]),
  ...tokenGroup('positive', '光影环境', '天气', [
    ['weather-rain', '雨天', 'rain', 'rainy weather', 'during rainfall'],
    ['weather-snow', '下雪', 'snowing', 'snowfall', 'during gentle snowfall'],
    ['weather-fog', '雾气', 'fog', 'dense atmospheric fog', 'with dense atmospheric fog'],
    ['weather-storm', '暴风雨', 'storm', 'dramatic storm', 'during a dramatic storm'],
    ['weather-wind', '大风', 'wind', 'windy weather', 'in strong wind'],
    ['weather-sunny', '晴天', 'sunny', 'clear sunny weather', 'under a clear sunny sky'],
    ['weather-starry', '星空', 'starry sky', 'star-filled night sky', 'beneath a star-filled night sky'],
    ['weather-cloudy', '多云', 'cloudy sky', 'dramatic cloudy sky', 'beneath a dramatic cloudy sky'],
    ['weather-dust', '沙尘', 'dust in air', 'airborne dust', 'with dust drifting through the air'],
    ['weather-petals', '花瓣飞舞', 'falling petals', 'petals drifting in the air', 'with flower petals drifting in the air'],
  ]),

  ...tokenGroup('positive', '物品', '武器', [
    ['weapon-sword', '长剑', 'sword', 'long sword', 'holding a long sword'],
    ['weapon-greatsword', '巨剑', 'greatsword', 'massive greatsword', 'holding a massive greatsword'],
    ['weapon-katana', '武士刀', 'katana', 'katana sword', 'holding a katana'],
    ['weapon-spear', '长枪', 'spear', 'long spear', 'holding a long spear'],
    ['weapon-bow', '弓箭', 'bow and arrow', 'bow and arrow', 'holding a bow and arrow'],
    ['weapon-staff', '法杖', 'staff', 'magic staff', 'holding a magic staff'],
    ['weapon-dagger', '匕首', 'dagger', 'ornate dagger', 'holding an ornate dagger'],
    ['weapon-shield', '盾牌', 'shield', 'fantasy shield', 'holding a fantasy shield'],
    ['weapon-hammer', '战锤', 'war hammer', 'war hammer', 'holding a heavy war hammer'],
    ['weapon-firearm', '枪械', 'firearm', 'firearm', 'holding a firearm'],
    ['weapon-scythe', '镰刀', 'scythe', 'fantasy scythe', 'holding a fantasy scythe'],
    ['weapon-chain', '锁链武器', 'chain weapon', 'fantasy chain weapon', 'wielding a fantasy chain weapon'],
  ]),
  ...tokenGroup('positive', '物品', '道具', [
    ['prop-book', '魔法书', 'magic book', 'ancient magic book', 'holding an ancient magic book'],
    ['prop-lantern', '提灯', 'lantern', 'ornate lantern', 'holding an ornate lantern'],
    ['prop-umbrella', '雨伞', 'umbrella', 'decorative umbrella', 'holding a decorative umbrella'],
    ['prop-flower', '花朵', 'flower', 'delicate flower', 'holding a delicate flower'],
    ['prop-crystal', '水晶', 'crystal', 'glowing crystal', 'holding a glowing crystal'],
    ['prop-potion', '药水瓶', 'potion bottle', 'glowing potion bottle', 'holding a glowing potion bottle'],
    ['prop-scroll', '卷轴', 'scroll', 'ancient scroll', 'holding an ancient scroll'],
    ['prop-instrument', '乐器', 'musical instrument', 'ornate musical instrument', 'holding an ornate musical instrument'],
    ['prop-mask', '面具', 'mask', 'ornate mask', 'holding or wearing an ornate mask'],
    ['prop-clock', '怀表', 'pocket watch', 'antique pocket watch', 'holding an antique pocket watch'],
  ]),
  ...tokenGroup('positive', '魔法', '元素', [
    ['magic-fire', '火焰魔法', 'fire magic', 'fire magic effects', 'surrounded by fire magic'],
    ['magic-ice', '冰霜魔法', 'ice magic', 'ice magic effects', 'surrounded by ice magic'],
    ['magic-lightning', '雷电魔法', 'lightning magic', 'lightning magic effects', 'surrounded by lightning magic'],
    ['magic-wind', '风系魔法', 'wind magic', 'wind magic effects', 'surrounded by wind magic'],
    ['magic-water', '水系魔法', 'water magic', 'water magic effects', 'surrounded by water magic'],
    ['magic-light', '圣光魔法', 'light magic', 'holy light magic', 'surrounded by holy light magic'],
    ['magic-dark', '暗影魔法', 'dark magic', 'dark shadow magic', 'surrounded by dark shadow magic'],
    ['magic-circle', '魔法阵', 'magic circle', 'glowing magic circle', 'with a glowing magic circle'],
    ['magic-runes', '符文', 'glowing runes', 'glowing magical runes', 'surrounded by glowing magical runes'],
    ['magic-aura', '能量光环', 'energy aura', 'luminous energy aura', 'surrounded by a luminous energy aura'],
  ]),
  ...tokenGroup('positive', '魔法', '法术形态', [
    ['magic-orb', '魔法球', 'magic orb', 'glowing magical orb', 'holding a glowing magical orb'],
    ['magic-beam', '能量光束', 'energy beam', 'focused magical energy beam', 'casting a focused magical energy beam'],
    ['magic-blade', '能量刃', 'energy blade', 'glowing magical energy blade', 'wielding a glowing magical energy blade'],
    ['magic-shield', '魔法护盾', 'magic shield', 'translucent magical shield', 'protected by a translucent magical shield'],
    ['magic-wings', '能量羽翼', 'energy wings', 'luminous magical wings', 'with luminous magical wings'],
    ['magic-chains', '魔法锁链', 'magic chains', 'glowing magical chains', 'surrounded by glowing magical chains'],
    ['magic-particles', '魔法粒子', 'magic particles', 'floating magical particles', 'surrounded by floating magical particles'],
    ['magic-vortex', '能量旋涡', 'energy vortex', 'swirling magical vortex', 'inside a swirling magical vortex'],
    ['magic-portal-effect', '空间门特效', 'portal effect', 'luminous dimensional portal', 'opening a luminous dimensional portal'],
    ['magic-sigil', '魔法印记', 'magic sigil', 'glowing arcane sigil', 'with a glowing arcane sigil'],
    ['magic-trail', '能量拖尾', 'energy trail', 'flowing magical energy trails', 'with flowing magical energy trails'],
    ['magic-explosion', '法术爆发', 'magic explosion', 'controlled magical explosion', 'casting a controlled magical explosion'],
  ]),
  ...tokenGroup('positive', '魔法', '能量质感', [
    ['magic-glow', '柔和辉光', 'soft magical glow', 'soft luminous magical glow', 'with a soft luminous magical glow'],
    ['magic-sparks', '能量火花', 'magic sparks', 'bright magical sparks', 'surrounded by bright magical sparks'],
    ['magic-mist', '魔力雾气', 'magic mist', 'luminous magical mist', 'surrounded by luminous magical mist'],
    ['magic-shards', '能量碎片', 'energy shards', 'floating crystalline energy shards', 'surrounded by floating crystalline energy shards'],
    ['magic-embers', '魔法余烬', 'magic embers', 'glowing magical embers', 'surrounded by glowing magical embers'],
    ['magic-arcs', '电弧跳跃', 'energy arcs', 'branching magical energy arcs', 'surrounded by branching magical energy arcs'],
    ['magic-halo', '圣环', 'magic halo', 'luminous magical halo', 'with a luminous magical halo'],
    ['magic-distortion', '空间扭曲', 'space distortion', 'magical spatial distortion', 'with visible magical spatial distortion'],
  ]),

  ...tokenGroup('positive', '画风', '画风', [
    ['style-anime', '日系动画', 'anime style', 'anime illustration', 'a polished anime illustration'],
    ['style-semi-realistic', '半写实', 'semi-realistic', 'semi-realistic illustration', 'a semi-realistic illustration'],
    ['style-concept-art', '概念设计', 'concept art', 'professional concept art', 'professional concept art'],
    ['style-watercolor', '水彩', 'watercolor', 'watercolor illustration', 'a watercolor illustration'],
    ['style-oil-painting', '油画', 'oil painting', 'oil-painting style', 'an oil-painting style illustration'],
    ['style-ink', '水墨', 'ink wash painting', 'ink-wash illustration', 'an expressive ink-wash illustration'],
    ['style-cel-shading', '赛璐璐', 'cel shading', 'cel-shaded illustration', 'a crisp cel-shaded illustration'],
    ['style-pixel-art', '像素画', 'pixel art', 'pixel-art style', 'a detailed pixel-art illustration'],
    ['style-comic', '漫画', 'comic style', 'comic-book illustration', 'a comic-book illustration'],
    ['style-storybook', '绘本', 'storybook illustration', 'storybook illustration', 'a charming storybook illustration'],
    ['style-chinese-fantasy', '国风幻想', 'chinese fantasy', 'Chinese fantasy illustration', 'a Chinese fantasy illustration'],
    ['style-western-fantasy', '西方奇幻', 'western fantasy', 'Western fantasy illustration', 'a Western fantasy illustration'],
    ['style-dark-fantasy', '暗黑奇幻', 'dark fantasy', 'dark fantasy illustration', 'a dark fantasy illustration'],
    ['style-art-nouveau', '新艺术风', 'art nouveau', 'Art Nouveau illustration', 'an Art Nouveau illustration'],
    ['style-retro', '复古插画', 'retro illustration', 'retro illustration', 'a retro-styled illustration'],
  ]),
  ...tokenGroup('positive', '画风', '商业风格', [
    ['style-mobile-gacha', '手游卡面', 'mobile game card art', 'premium mobile-game card illustration', 'a premium mobile-game card illustration'],
    ['style-chinese-game', '国游美宣', 'Chinese game promotional art', 'Chinese fantasy game key art', 'polished Chinese fantasy game key art'],
    ['style-korean-game', '韩系游戏', 'Korean game art', 'Korean-style fantasy game art', 'polished Korean-style fantasy game art'],
    ['style-visual-novel', '视觉小说', 'visual novel art', 'visual-novel character illustration', 'a polished visual-novel character illustration'],
    ['style-card-illustration', '集换式卡牌', 'trading card illustration', 'premium trading-card illustration', 'a premium trading-card illustration'],
    ['style-matte-painting', '影视概念', 'matte painting', 'cinematic matte-painting concept art', 'cinematic matte-painting concept art'],
    ['style-graphic-poster', '平面海报', 'graphic poster', 'bold graphic poster design', 'a bold graphic poster illustration'],
    ['style-low-poly', '低多边形', 'low poly style', 'stylized low-poly rendering', 'a stylized low-poly rendering'],
  ]),
  ...tokenGroup('positive', '质量渲染', '渲染', [
    ['render-3d', '三维渲染', '3d render', 'high-end 3D render', 'a high-end 3D render'],
    ['render-pbr', 'PBR材质', 'PBR', 'physically based rendering', 'physically based materials and lighting'],
    ['render-cinematic', '电影级渲染', 'cinematic render', 'cinematic rendering', 'cinematic rendering'],
    ['render-soft', '柔和明暗', 'soft shading', 'soft shading', 'soft controlled shading'],
    ['render-hard-surface', '硬表面', 'hard surface', 'hard-surface rendering', 'detailed hard-surface rendering'],
    ['render-glossy', '光泽材质', 'glossy', 'glossy materials', 'glossy reflective materials'],
    ['render-matte', '哑光材质', 'matte', 'matte materials', 'soft matte materials'],
    ['render-subsurface', '皮肤透光', 'subsurface scattering', 'subsurface skin scattering', 'natural subsurface skin scattering'],
    ['render-toon', '卡通渲染', 'toon rendering', 'toon rendering', 'clean stylized toon rendering'],
    ['render-handpainted', '手绘贴图', 'hand-painted texture', 'hand-painted textures', 'rich hand-painted textures'],
  ]),
  ...tokenGroup('positive', '质量渲染', '质量', [
    ['quality-ultra-detail', '超精细', 'ultra-detailed', 'ultra detailed', 'extremely detailed'],
    ['quality-fine-texture', '细腻纹理', 'fine texture', 'fine material textures', 'fine readable material textures'],
    ['quality-clean-edges', '边缘干净', 'clean edges', 'clean controlled edges', 'clean controlled edges'],
    ['quality-rich-color', '色彩丰富', 'rich colors', 'rich controlled colors', 'rich controlled colors'],
    ['quality-depth', '空间层次', 'depth', 'strong visual depth', 'strong visual depth'],
    ['quality-color-grading', '专业调色', 'professional color grading', 'professional color grading', 'professional color grading'],
    ['quality-high-contrast', '高对比', 'high contrast', 'controlled high contrast', 'controlled high contrast'],
    ['quality-balanced', '细节平衡', 'balanced details', 'balanced readable details', 'balanced readable details'],
    ['quality-polished', '完成度高', 'polished', 'highly polished artwork', 'highly polished finished artwork'],
    ['quality-production', '商业成稿', 'production quality', 'production-quality artwork', 'production-quality finished artwork'],
  ]),
  ...tokenGroup('positive', '质量渲染', '专项优化', [
    ['quality-readable-silhouette', '轮廓清晰', 'readable silhouette', 'clear readable silhouette', 'a clear and readable silhouette'],
    ['quality-clean-anatomy', '结构准确', 'accurate anatomy', 'clean accurate anatomy', 'clean and accurate anatomy'],
    ['quality-precise-hands', '手部精确', 'detailed hands', 'accurately drawn hands', 'accurately drawn detailed hands'],
    ['quality-face-detail', '五官精致', 'detailed face', 'refined facial details', 'refined and consistent facial details'],
    ['quality-material-separation', '材质区分', 'clear material separation', 'clear material separation', 'clear separation between materials'],
    ['quality-consistent-light', '光影统一', 'consistent lighting', 'consistent lighting and shadows', 'consistent lighting and cast shadows'],
  ]),

  ...expandedPositivePromptTokens,
  ...doubledPositivePromptTokens,
  ...animePositivePromptTokens,

  token('negative-low-quality', 'negative', '质量', '基础质量', '低质量', 'worst quality, low quality, normal quality', 'worst quality, low quality, lowres', 'low quality, low resolution, blurry details'),
  token('negative-artifacts', 'negative', '质量', '基础质量', '压缩与噪点', 'jpeg artifacts, noise, blurry', 'jpeg artifacts, noise, blurry', 'compression artifacts, noise, blur'),
  ...tokenGroup('negative', '质量', '基础质量', [
    ['negative-deformed-art', '整体变形', 'deformed, distorted', 'deformed, distorted', 'deformed or distorted output'],
    ['negative-amateur', '业余感', 'amateur, poorly drawn', 'amateur, poorly drawn', 'amateur or poorly drawn result'],
    ['negative-unfinished', '未完成', 'unfinished', 'unfinished artwork', 'unfinished artwork'],
    ['negative-low-detail', '细节不足', 'low detail', 'low detail', 'insufficient detail'],
    ['negative-corrupted', '画面损坏', 'corrupted image', 'corrupted image', 'a corrupted image'],
    ['negative-grainy', '颗粒粗糙', 'grainy', 'excessive grain', 'excessive image grain'],
    ['negative-noisy-lines', '线条杂乱', 'messy lines', 'messy linework', 'messy uncontrolled linework'],
    ['negative-draft', '草稿状态', 'rough draft', 'rough draft', 'an unfinished rough draft'],
  ]),
  token('negative-anatomy', 'negative', '人体', '结构错误', '错误人体', 'bad anatomy, distorted proportions', 'bad anatomy, distorted proportions', 'incorrect anatomy, distorted proportions'),
  token('negative-hands', 'negative', '手部', '手部错误', '错误手部', 'malformed hands, extra fingers, missing fingers', 'malformed hands, extra fingers, missing fingers', 'malformed hands, extra or missing fingers'),
  token('negative-limbs', 'negative', '人体', '结构错误', '肢体错误', 'extra limbs, missing limbs, fused limbs', 'extra limbs, missing limbs, fused limbs', 'extra, missing, or fused limbs'),
  token('negative-face', 'negative', '面部', '面部错误', '错误五官', 'bad face, asymmetrical eyes, malformed eyes', 'bad face, asymmetrical eyes, malformed eyes', 'distorted facial features, asymmetrical eyes'),
  token('negative-duplicate', 'negative', '构图', '画面布局', '重复人物', 'duplicate character, cloned face, extra person', 'duplicated character, cloned face, unintended extra person', 'duplicated characters, cloned faces, or unintended extra people'),
  token('negative-crop', 'negative', '构图', '画面布局', '错误裁切', 'cropped, out of frame, cut off', 'cropped, out of frame, cut off', 'unintended cropping, subject cut off, out of frame'),
  token('negative-layout', 'negative', '构图', '画面布局', '角色表格', 'character sheet, turnaround, split screen, grid layout', 'character sheet, turnaround, split screen, grid layout', 'character sheet, split-screen, or grid layout'),
  token('negative-text', 'negative', '文字', '水印标识', '文字水印', 'text, watermark, logo, signature, username', 'text, watermark, logo, signature, username', 'text, watermark, logo, signature, or username'),
  token('negative-background', 'negative', '背景', '背景干扰', '杂乱背景', 'cluttered background, distracting background', 'cluttered background, distracting background', 'a cluttered or distracting background'),

  ...tokenGroup('negative', '质量', '清晰度', [
    ['negative-pixelated', '像素化', 'pixelated', 'pixelated', 'pixelated image'],
    ['negative-lowres', '低分辨率', 'lowres', 'low resolution', 'low-resolution output'],
    ['negative-oversharpened', '过度锐化', 'oversharpened', 'oversharpened', 'overly sharpened details'],
    ['negative-overexposed', '曝光过度', 'overexposed', 'overexposed', 'overexposed image'],
    ['negative-underexposed', '曝光不足', 'underexposed', 'underexposed', 'underexposed image'],
    ['negative-color-banding', '色带断层', 'color banding', 'color banding', 'visible color banding'],
    ['negative-chromatic', '色散', 'chromatic aberration', 'chromatic aberration', 'unwanted chromatic aberration'],
    ['negative-dirty', '脏污画面', 'dirty image', 'dirty image', 'dirty-looking image'],
    ['negative-moire', '摩尔纹', 'moire pattern', 'moiré pattern', 'visible moiré patterns'],
    ['negative-aliasing', '锯齿边缘', 'aliasing, jagged edges', 'aliasing, jagged edges', 'jagged aliased edges'],
  ]),
  ...tokenGroup('negative', '人体', '肢体错误', [
    ['negative-extra-arms', '多余手臂', 'extra arms', 'extra arms', 'extra arms'],
    ['negative-extra-legs', '多余腿', 'extra legs', 'extra legs', 'extra legs'],
    ['negative-extra-digits', '多余手指', 'extra digits', 'extra fingers', 'extra fingers'],
    ['negative-missing-digits', '缺失手指', 'missing digits', 'missing fingers', 'missing fingers'],
    ['negative-long-neck', '脖子过长', 'long neck', 'unnaturally long neck', 'an unnaturally long neck'],
    ['negative-twisted-body', '身体扭曲', 'twisted body', 'twisted body', 'a twisted body'],
    ['negative-joints', '关节错位', 'dislocated joints', 'dislocated joints', 'dislocated joints'],
    ['negative-broken-wrist', '手腕折断', 'broken wrist', 'unnatural wrist', 'an unnatural wrist angle'],
    ['negative-broken-ankle', '脚踝折断', 'broken ankle', 'unnatural ankle', 'an unnatural ankle angle'],
  ]),
  ...tokenGroup('negative', '手部', '手指错误', [
    ['negative-fused-fingers', '手指粘连', 'fused fingers', 'fused fingers', 'fused fingers'],
    ['negative-webbed-fingers', '蹼状手指', 'webbed fingers', 'webbed fingers', 'webbed fingers'],
    ['negative-long-fingers', '手指过长', 'long fingers', 'unnaturally long fingers', 'unnaturally long fingers'],
    ['negative-short-fingers', '手指过短', 'short fingers', 'unnaturally short fingers', 'unnaturally short fingers'],
    ['negative-broken-fingers', '手指折断', 'broken fingers', 'broken finger joints', 'broken or dislocated finger joints'],
    ['negative-wrong-thumb', '拇指位置错误', 'wrong thumb', 'misplaced thumb', 'a misplaced thumb'],
    ['negative-extra-thumb', '多余拇指', 'extra thumb', 'extra thumb', 'an extra thumb'],
  ]),
  ...tokenGroup('negative', '手部', '手掌手腕', [
    ['negative-reversed-hand', '手掌翻转', 'reversed hand', 'reversed hand orientation', 'a reversed hand orientation'],
    ['negative-duplicate-hand', '重复手掌', 'duplicate hand', 'duplicated hand', 'a duplicated hand'],
    ['negative-floating-hand', '手掌悬空', 'floating hand', 'detached floating hand', 'a detached floating hand'],
    ['negative-palm-shape', '手掌变形', 'malformed palm', 'malformed palm', 'a malformed palm'],
    ['negative-wrist-connection', '手腕连接错误', 'bad wrist connection', 'incorrect hand-wrist connection', 'an incorrect connection between hand and wrist'],
  ]),
  ...tokenGroup('negative', '面部', '面部错误', [
    ['negative-cross-eye', '斗鸡眼', 'cross-eyed', 'cross-eyed', 'crossed eyes'],
    ['negative-duplicate-face', '重复五官', 'duplicate face', 'duplicated facial features', 'duplicated facial features'],
    ['negative-misaligned-eyes', '眼睛错位', 'misaligned eyes', 'misaligned eyes', 'misaligned eyes'],
    ['negative-bad-teeth', '错误牙齿', 'bad teeth', 'malformed teeth', 'malformed teeth'],
    ['negative-bad-ears', '错误耳朵', 'bad ears', 'malformed ears', 'malformed ears'],
    ['negative-melted-face', '融化脸', 'melted face', 'melted face', 'a melted or distorted face'],
    ['negative-plastic-skin', '塑料皮肤', 'plastic skin', 'plastic-looking skin', 'unnaturally plastic-looking skin'],
  ]),
  ...tokenGroup('negative', '面部', '五官细节', [
    ['negative-extra-eyes', '多余眼睛', 'extra eyes', 'extra eyes', 'extra eyes'],
    ['negative-missing-eye', '缺失眼睛', 'missing eye', 'missing eye', 'a missing eye'],
    ['negative-eye-size', '眼睛大小不一', 'uneven eye size', 'mismatched eye size', 'mismatched eye size'],
    ['negative-lazy-eye', '眼神偏斜', 'lazy eye', 'misdirected eye gaze', 'misdirected eye gaze'],
    ['negative-mouth-shape', '嘴型扭曲', 'distorted mouth', 'distorted mouth shape', 'a distorted mouth shape'],
    ['negative-extra-teeth', '牙齿重复', 'extra teeth', 'duplicated teeth', 'duplicated or extra teeth'],
    ['negative-waxy-face', '蜡像脸', 'waxy face', 'waxy artificial face', 'a waxy artificial-looking face'],
    ['negative-face-shadow', '脸部阴影错误', 'bad face shadow', 'inconsistent facial shadows', 'inconsistent facial shadows'],
  ]),
  ...tokenGroup('negative', '构图', '透视裁切', [
    ['negative-perspective', '透视错误', 'bad perspective', 'incorrect perspective', 'incorrect perspective'],
    ['negative-horizon', '地平线倾斜', 'tilted horizon', 'tilted horizon', 'an unintentionally tilted horizon'],
    ['negative-too-small', '主体过小', 'subject too small', 'subject too small', 'a subject that is too small in frame'],
    ['negative-too-large', '主体过大', 'subject too large', 'subject too large', 'a subject that is too large in frame'],
    ['negative-empty-frame', '画面空洞', 'empty frame', 'empty composition', 'an unintentionally empty composition'],
    ['negative-tangent', '轮廓相切', 'bad tangent', 'awkward tangencies', 'awkward visual tangencies'],
    ['negative-center-cut', '主体被切断', 'subject cut off', 'main subject cut off', 'the main subject cut off by the frame'],
    ['negative-unbalanced', '重心失衡', 'unbalanced composition', 'unbalanced composition', 'an unbalanced composition'],
    ['negative-overlap', '错误遮挡', 'awkward overlap', 'awkward overlapping forms', 'awkward overlapping forms'],
    ['negative-scale', '比例失调', 'inconsistent scale', 'inconsistent object scale', 'inconsistent object scale'],
  ]),
  ...tokenGroup('negative', '文字', '界面标识', [
    ['negative-caption', '字幕', 'caption', 'captions', 'captions'],
    ['negative-speech-bubble', '对话框', 'speech bubble', 'speech bubbles', 'speech bubbles'],
    ['negative-ui', '界面元素', 'UI, interface', 'user-interface elements', 'user-interface elements'],
    ['negative-timestamp', '时间戳', 'timestamp', 'timestamp', 'timestamp'],
    ['negative-border', '边框装饰', 'decorative border', 'decorative frame border', 'decorative frame border'],
    ['negative-qr', '二维码', 'QR code', 'QR code', 'QR code'],
  ]),
  ...tokenGroup('negative', '背景', '背景干扰', [
    ['negative-busy-background', '背景过密', 'busy background', 'overly busy background', 'an overly busy background'],
    ['negative-photobomber', '多余路人', 'background person', 'unwanted background people', 'unwanted people in the background'],
    ['negative-repeat-pattern', '重复纹理', 'repeating pattern', 'unwanted repeating pattern', 'an unwanted repeating background pattern'],
    ['negative-floating-objects', '漂浮杂物', 'floating objects', 'unwanted floating objects', 'unwanted floating objects'],
    ['negative-shadow-mismatch', '阴影不匹配', 'inconsistent shadows', 'inconsistent shadows', 'inconsistent cast shadows'],
    ['negative-horizon-clutter', '地平线穿头', 'horizon through head', 'horizon line through head', 'a horizon line cutting through the subject'],
    ['negative-background-merge', '人物融入背景', 'subject blends into background', 'poor subject-background separation', 'poor separation between subject and background'],
    ['negative-empty-background', '背景过空', 'empty background', 'overly empty background', 'an overly empty background'],
  ]),
  ...tokenGroup('negative', '色彩光线', '色彩光照', [
    ['negative-oversaturated', '过度饱和', 'oversaturated', 'oversaturated colors', 'overly saturated colors'],
    ['negative-undersaturated', '饱和度不足', 'undersaturated', 'undersaturated colors', 'weak undersaturated colors'],
    ['negative-color-cast', '严重偏色', 'color cast', 'strong color cast', 'an unwanted strong color cast'],
    ['negative-muddy-colors', '颜色浑浊', 'muddy colors', 'muddy colors', 'muddy indistinct colors'],
    ['negative-flat-lighting', '光线平淡', 'flat lighting', 'flat lighting', 'flat unstructured lighting'],
    ['negative-harsh-light', '光线生硬', 'harsh lighting', 'harsh lighting', 'overly harsh lighting'],
    ['negative-inconsistent-light', '光向混乱', 'inconsistent lighting', 'inconsistent lighting direction', 'inconsistent lighting direction'],
    ['negative-crushed-black', '暗部死黑', 'crushed blacks', 'crushed shadow detail', 'crushed black shadow detail'],
    ['negative-blown-highlight', '高光死白', 'blown highlights', 'blown highlights', 'blown-out highlights'],
    ['negative-poor-contrast', '对比失衡', 'poor contrast', 'poor contrast balance', 'poorly balanced contrast'],
  ]),
  ...tokenGroup('negative', '内容控制', '多余内容', [
    ['negative-astral-avatar-misread', '元神误画', 'separate second physical character, unrelated face, mismatched identity, solid giant body, extra foreground person', 'separate second physical character, unrelated face, mismatched identity, solid giant body, extra foreground person', 'a separate second physical character, an unrelated face or mismatched identity for the spirit, a solid giant body, or an extra foreground person'],
    ['negative-unwanted-crowd', '不要人群', 'crowd, many people', 'unwanted crowd', 'an unwanted crowd'],
    ['negative-unwanted-animal', '不要动物', 'animal, pet', 'unwanted animals', 'unwanted animals'],
    ['negative-unwanted-vehicle', '不要载具', 'vehicle, car', 'unwanted vehicles', 'unwanted vehicles'],
    ['negative-unwanted-object', '不要杂物', 'unwanted objects', 'unwanted extra objects', 'unwanted extra objects'],
    ['negative-modern-object', '不要现代物件', 'modern objects', 'anachronistic modern objects', 'anachronistic modern objects'],
  ]),
  ...tokenGroup('negative', '内容控制', '风格排除', [
    ['negative-photorealistic', '不要真人感', 'photorealistic, photo', 'photorealistic style', 'photorealistic style'],
    ['negative-anime-style', '不要二次元', 'anime style', 'anime illustration style', 'anime illustration style'],
    ['negative-3d-style', '不要三维感', '3d render', '3D-rendered style', '3D-rendered style'],
    ['negative-sketch-style', '不要草稿感', 'sketch, rough lines', 'rough sketch style', 'rough unfinished sketch style'],
    ['negative-chibi-style', '不要Q版', 'chibi', 'chibi proportions', 'chibi proportions'],
  ]),
];

const positivePromptTokenTaxonomyOverrides: Readonly<Record<string, Partial<Pick<PromptToken, 'category' | 'group' | 'label' | 'values' | 'aliases'>>>> = Object.freeze({
  'subject-adult-woman': { category: '人物', group: '性别气质' },
  'subject-adult-man': { category: '人物', group: '性别气质' },
  'subject-full-body': { category: '镜头', group: '景别' },
  'outfit-armor': { category: '服饰', group: '护甲结构' },
  'outfit-robe': { category: '服饰', group: '连身礼服' },
  'outfit-dress': { category: '服饰', group: '连身礼服' },
  'stance-back-to-back': { category: '表情动作', group: '人物互动' },
  'composition-character-design': { category: '画风', group: '商业用途' },
  'composition-splash': { category: '画风', group: '商业用途' },
  'style-watercolor': { category: '画风', group: '绘画媒介' },
  'style-oil-painting': { category: '画风', group: '绘画媒介' },
  'style-ink': { category: '画风', group: '绘画媒介' },
  'style-clean-lineart': { category: '画风', group: '表现技法' },
  'style-cel-shading': { category: '画风', group: '表现技法' },
  'style-low-poly': { category: '画风', group: '视觉风格' },
  'scene-grand-architecture': { category: '建筑', group: '公共建筑' },
  'scene-floating-islands': { category: '自然', group: '地貌' },
  'scene-giant-moon': { category: '自然', group: '天空天象' },
  'scene-magic-portal': { category: '魔法', group: '魔法效果' },
  'material-crystal': {
    label: '水晶材质',
    values: { illustrious: 'crystal material', sdxl: 'faceted crystal material', natural: 'made with faceted crystal material' },
  },
  'prop-crystal': { label: '发光水晶' },
  'hanfu-pleated-skirt': { label: '汉服百褶裙' },
  'hanfu-cloud-pattern': {
    label: '汉服云纹',
    values: { illustrious: 'traditional Chinese cloud pattern', sdxl: 'traditional Chinese cloud motifs', natural: 'decorated with traditional Chinese cloud motifs' },
  },
  'hanfu-dragon-pattern': {
    label: '汉服龙纹',
    values: { illustrious: 'traditional Chinese dragon pattern', sdxl: 'embroidered traditional Chinese dragon motifs', natural: 'decorated with embroidered traditional Chinese dragon motifs' },
  },
  'hanfu-phoenix-pattern': {
    label: '汉服凤纹',
    values: { illustrious: 'traditional Chinese phoenix pattern', sdxl: 'embroidered traditional Chinese phoenix motifs', natural: 'decorated with embroidered traditional Chinese phoenix motifs' },
  },
  'palette-monochrome': {
    label: '单色穿搭',
    values: { illustrious: 'monochrome outfit', sdxl: 'monochrome clothing palette', natural: 'a controlled monochrome clothing palette' },
  },
  'palette-pastel': {
    label: '粉彩穿搭',
    values: { illustrious: 'pastel color outfit', sdxl: 'pastel clothing palette', natural: 'a soft pastel clothing palette' },
  },
  'palette-neon': {
    label: '霓虹穿搭',
    values: { illustrious: 'neon color outfit', sdxl: 'neon clothing palette', natural: 'a vivid neon clothing palette' },
  },
  'scene-library': {
    label: '图书馆室内',
    values: { illustrious: 'library interior', sdxl: 'grand library interior', natural: 'inside a grand library interior' },
  },
  'architecture-real-library': { label: '公共图书馆' },
  'mood-melancholic': { label: '忧郁氛围' },
  'emotion-melancholy': { label: '忧郁表情' },
  'optical-crisp': { label: '锐利成像' },
});

/**
 * Hidden legacy aliases keep saved canvases and prompt markers working while
 * preventing the same semantic choice from appearing twice in the selector.
 */
export const promptTokenIdAliases: Readonly<Record<string, string>> = Object.freeze({
  'depth-shallow': 'lens-shallow-dof',
  'depth-deep': 'lens-deep-focus',
  'fx-bokeh': 'lens-bokeh',
  'fx-motion-blur': 'lens-motion',
  'scene-cyber-city': 'arch-cyber-city',
  'scene-throne': 'interior-throne-room',
  'scene-desert': 'terrain-desert',
  'scene-workshop': 'interior-workshop',
  'scene-waterfall': 'water-waterfall',
  'scene-foreground-depth': 'guide-foreground-framing',
  'weather-starry': 'sky-starry',
  'weather-petals': 'fx-petals',
  'magic-trail': 'fx-energy-motion-trail',
  'pose-combat-two-hand-spell': 'magic-cast-two-hands',
});

function canonicalPromptTokenId(id: string): string {
  let canonicalId = id;
  const visited = new Set<string>();
  while (promptTokenIdAliases[canonicalId] && !visited.has(canonicalId)) {
    visited.add(canonicalId);
    canonicalId = promptTokenIdAliases[canonicalId];
  }
  return canonicalId;
}

const intimatePoseIdsRoutedToCuddles = new Set([
  'pose-adult-intimate-close-embrace',
  'pose-adult-intimate-back-hug',
  'pose-adult-intimate-waist-embrace',
  'pose-adult-intimate-forehead-touch',
  'pose-adult-intimate-almost-kiss',
  'pose-adult-intimate-cheek-kiss',
  'pose-adult-intimate-neck-nuzzle',
  'pose-adult-intimate-shoulder-rest',
  'pose-adult-intimate-arms-neck',
  'pose-adult-intimate-lap-embrace',
  'pose-adult-intimate-wall-embrace',
  'pose-adult-intimate-spoon-cuddle',
]);

const cuddlePoseIdsRoutedToInteraction = new Set([
  'pose-adult-nonexplicit-adjust-collar',
  'pose-adult-nonexplicit-loosen-tie',
  'pose-adult-nonexplicit-drape-coat',
  'pose-adult-nonexplicit-wrist-dance',
  'pose-adult-nonexplicit-hair-caress',
  'pose-adult-nonexplicit-shoulder-massage',
]);

function canonicalizePositivePromptToken(entry: PromptToken): PromptToken {
  if (entry.scope !== 'positive') return entry;
  const taxonomyOverride = positivePromptTokenTaxonomyOverrides[entry.id];
  if (taxonomyOverride) entry = { ...entry, ...taxonomyOverride };

  if (entry.id.startsWith('pose-adult-sensual-')) return { ...entry, group: '魅力姿态' };
  if (entry.id.startsWith('pose-adult-editorial-')) return { ...entry, group: '写真姿态' };
  if (entry.id.startsWith('pose-adult-intimate-')) return { ...entry, group: intimatePoseIdsRoutedToCuddles.has(entry.id) ? '亲吻依偎' : '亲密互动' };
  if (entry.id.startsWith('pose-adult-nonexplicit-')) return { ...entry, group: cuddlePoseIdsRoutedToInteraction.has(entry.id) ? '亲密互动' : '亲吻依偎' };

  let group = entry.group;
  switch (entry.category) {
    case '人物': {
      if (group === '对象') {
        if (entry.id === 'subject-sisters') group = '人物关系';
        else if (['subject-little-girl', 'subject-little-boy', 'subject-young-lady', 'subject-adult-female'].includes(entry.id)) group = '年龄阶段';
        else if (['subject-bishoujo', 'subject-kawaii'].includes(entry.id)) group = '性别气质';
        else group = '对象数量';
      } else if (group === '身份') {
        if (['subject-elf', 'subject-demon', 'subject-angel', 'subject-android'].includes(entry.id)) group = '种族特征';
        else if (['subject-princess', 'subject-queen', 'subject-prince', 'subject-king'].includes(entry.id)) group = '传统职业';
        else group = '幻想职业';
      } else if (group === '体型') group = '体型结构';
      else if (group === '外形') group = ['hair-black', 'hair-white', 'hair-blonde', 'hair-red', 'hair-blue'].includes(entry.id) ? '发色' : '发型细节';
      else if (group === '五官' || group === '眼睛细节') group = '五官特征';
      else if (group === '年龄气质') group = entry.id.startsWith('age-') ? '年龄阶段' : '性别气质';
      break;
    }
    case '服饰': {
      if (group === '内衣') group = '基础内搭';
      else if (group === '类型') group = '服装风格';
      else if (group === '材质') group = '服装材质';
      else if (group === '配色') group = '服装配色';
      else if (group === '纹样') group = '纹样工艺';
      else if (group === '鞋袜') group = ['footwear-stockings', 'footwear-tabi'].includes(entry.id) ? '袜类手套' : '鞋靴';
      else if (group === '部件') {
        if (entry.id === 'outfit-cloak') group = '外套';
        else if (entry.id === 'outfit-boots') group = '鞋靴';
        else if (['part-gloves', 'part-stockings'].includes(entry.id)) group = '袜类手套';
        else if (['part-hood', 'part-helmet', 'part-crown'].includes(entry.id)) group = '头饰';
        else if (['part-necklace', 'part-earrings'].includes(entry.id)) group = '首饰';
        else if (['part-pauldrons', 'part-gauntlets'].includes(entry.id)) group = '护甲结构';
        else group = '搭配配件';
      }
      break;
    }
    case '汉服':
      if (group === '款式' || group === '历史形制') group = '形制款式';
      else if (group === '结构' || group === '领襟结构') group = '结构细节';
      else if (group === '传统配饰') group = '配饰';
      else if (group === '纹样') group = '纹样工艺';
      break;
    case '物品':
      if (group === '道具') group = '日常道具';
      break;
    case '生物':
      if (group === '动物') group = entry.id === 'animal-eagle' ? '鸟类' : '陆生动物';
      else if (group === '幻想生物' || group === '神话生物') group = '神话幻想生物';
      break;
    case '建筑':
      if (group === '中式建筑') group = '中国建筑';
      else if (group === '欧式建筑') group = '欧洲建筑';
      else if (group === '科幻建筑') group = '幻想科幻建筑';
      break;
    case '构图':
      if (group === '构图') group = '构图结构';
      else if (group === '视觉引导') group = '视觉动线';
      break;
    case '场景':
      if (group === '场景') group = '场景类型';
      break;
    case '光影环境':
      if (group === '光线') group = '光源照明';
      break;
    case '画风':
      if (group === '画风') group = '视觉风格';
      else if (group === '商业风格') group = '商业用途';
      break;
    case '质量渲染':
      if (group === '质量') group = '质量标准';
      else if (group === '渲染') group = '渲染方式';
      else if (group === '专项优化') group = '细节优化';
      break;
    case '魔法':
      if (group === '元素') group = '元素属性';
      break;
  }
  return group === entry.group ? entry : { ...entry, group };
}

export const promptTokens: PromptToken[] = rawPromptTokens.map(canonicalizePositivePromptToken);

const promptTokenMap = new Map(promptTokens.map((entry) => [entry.id, entry]));

/**
 * Navigation labels stay intentionally short. Multi-clause natural-language
 * values use a literal Chinese display label so the chip is a deterministic
 * translation of the exact English text that will be submitted.
 */
const naturalPromptTokenChineseLabels: Readonly<Record<string, string>> = Object.freeze({
  'negative-anime-style': '二次元插画风格',
  'negative-sketch-style': '粗糙、未完成的草稿风格',
  'negative-chibi-style': 'Q版比例',
  'negative-unwanted-crowd': '不需要的人群',
  'negative-scale': '物体比例不一致',
  'negative-unbalanced': '构图失衡',
  'negative-reversed-hand': '手部朝向反转',
  'negative-fused-fingers': '手指粘连',
  'negative-extra-arms': '多余手臂',
  'angle-worms-eye': '戏剧性虫视角',
  'shot-close-up': '特写镜头',
  'person-fantasy-swordsman': '幻想剑士',
  'vibe-heroic': '鲜明的英雄气概',
  'subject-single': '单个角色',
  'composition-splash': '精修幻想游戏主视觉',
  'fx-particle-ash': '细小灰烬粒子飘过场景',
  'fx-energy-form-fire': '呈火焰形态的魔法能量',
  'composition-depth-multilayer': '从前景到背景的多重清晰空间层次',
  'depth-aerial': '强烈的空气透视',
  'fx-bloom': '细微的发光泛光效果',
  'fx-impact-frame': '强烈的视觉冲击效果',
  'fx-mist-layer': '一层薄薄的地面雾气',
  'fx-rain-streak': '清晰可见的落雨线条',
  'fx-cloth-motion': '布料随动作剧烈飘动',
  'fx-hair-motion': '头发在风中动感飘动',
  'fx-weapon-trail': '武器运动后跟随的发光轨迹',
  'weapon-katana': '手持武士刀',
  'fx-lens-flare': '受控的电影感镜头光晕',
  'quality-polished': '高度精修的完成稿',
  'negative-caption': '字幕',
  'negative-text': '文字、水印、徽标、签名或用户名',
  'negative-face': '扭曲的面部特征、双眼不对称',
  'quality-depth': '强烈的视觉纵深',
  'quality-masterpiece': '高品质且细节丰富',
  'composition-layered': '分层的前景、中景和背景',
  'composition-dynamic': '动态构图',
  'age-young-adult': '青年角色',
  'negative-low-quality': '低质量、低分辨率、细节模糊',
  'negative-anatomy': '人体结构错误、比例扭曲',
  'negative-hands': '手部畸形、手指多余或缺失',
  'negative-limbs': '肢体多余、缺失或粘连',
  'negative-duplicate': '重复角色、克隆脸或意外多出的人物',
  'pose-action': '动态动作姿势',
});

export function promptTokenDisplayLabel(entry: PromptToken, adapter?: string, modelFamily?: string): string {
  return promptDialectForAdapter(adapter, modelFamily) === 'natural'
    ? naturalPromptTokenChineseLabels[entry.id] || entry.label
    : entry.label;
}

export const promptTokenRecipes: PromptTokenRecipe[] = [
  {
    id: 'real-person-portrait', label: '真实人像', description: '自然人物、85mm、真实皮肤和光影', scope: 'positive', sectionIds: ['subject', 'camera', 'finish'],
    tokenIds: ['subject-single', 'shot-upper-body', 'lens-85mm', 'focus-on-eyes', 'style-photo-photoreal', 'detail-real-skin-texture', 'detail-real-lighting'],
    keywords: ['真人', '写实', '照片', '摄影', 'portrait', 'photorealistic'], guidance: '先选人物来自哪里和年龄，再按需要替换镜头或照片类型。', preview: 'style', targets: ['image', 'video'],
  },
  {
    id: 'character-concept', label: '角色设定图', description: '单人全身、居中、干净背景', scope: 'positive', sectionIds: ['subject'],
    tokenIds: ['subject-single', 'subject-full-body', 'composition-centered', 'composition-character-design', 'scene-plain'],
    keywords: ['立绘', '角色卡', '设定稿', 'character sheet'], guidance: '适合角色初稿、立绘与统一设定。', preview: 'character-sheet',
  },
  {
    id: 'action-breakdown', label: '动作分解', description: '全身动作、卡片网格、设定一致', scope: 'positive', sectionIds: ['action'],
    tokenIds: ['subject-single', 'subject-full-body', 'pose-action', 'composition-character-design', 'composition-layout-card-grid', 'quality-consistent-design'],
    keywords: ['动作表', '姿势参考', '连贯动作', 'action sheet'], guidance: '适合动作设计、姿势探索与美术参考。', preview: 'action-grid',
  },
  {
    id: 'game-key-art', label: '游戏美宣', description: '动态构图、电影光、精细细节', scope: 'positive', sectionIds: ['camera'],
    tokenIds: ['composition-splash', 'pose-action', 'lens-dynamic', 'lighting-cinematic', 'quality-detail'],
    keywords: ['主视觉', '海报', 'key art'], guidance: '适合强调冲击力的游戏主视觉。', preview: 'key-art',
  },
  {
    id: 'clean-anime', label: '干净二次元', description: '游戏美术、干净线稿、高品质', scope: 'positive', sectionIds: ['finish'],
    tokenIds: ['style-anime-game', 'style-clean-lineart', 'quality-masterpiece', 'quality-sharp'],
    keywords: ['动漫', '日系', 'anime'], guidance: '适合线条清楚的二次元角色图。', preview: 'style', targets: ['image', 'video'],
  },
  {
    id: 'anime-tv-character', label: '动画角色立绘', description: '赛璐璐、清线、角色剪影鲜明', scope: 'positive', sectionIds: ['subject', 'finish'],
    tokenIds: ['subject-single', 'subject-full-body', 'composition-centered', 'anime-style-tv-cel', 'anime-line-thin-clean', 'anime-technique-two-tone-cel', 'anime-quality-silhouette'],
    keywords: ['动画立绘', '日系角色', '赛璐璐', 'anime character'], guidance: '先确定人物和服装，再用这一套统一动画式线条与明暗。', preview: 'character-sheet', targets: ['image'],
  },
  {
    id: 'anime-key-visual', label: '动画主视觉', description: '主角演出、电影感、宣传绘完成度', scope: 'positive', sectionIds: ['camera', 'finish'],
    tokenIds: ['anime-composition-key-visual', 'pose-action', 'anime-style-film', 'lighting-rim', 'quality-polished'],
    keywords: ['动画海报', '动漫KV', '宣传绘', 'key visual'], guidance: '适合单张动画宣传主视觉；人物关系与环境仍由你单独选择。', preview: 'key-art', targets: ['image'],
  },
  {
    id: 'anime-light-novel-cover', label: '轻小说封面', description: '封面构图、精细角色、保留标题空间', scope: 'positive', sectionIds: ['camera', 'finish'],
    tokenIds: ['anime-layout-light-novel-cover', 'anime-use-light-novel', 'anime-style-painterly', 'anime-render-eyes', 'quality-polished'],
    keywords: ['轻小说', '小说封面', '文库本'], guidance: '默认不生成文字，只为后续标题排版留出稳定空间。', preview: 'key-art', targets: ['image'],
  },
  {
    id: 'anime-manga-page', label: '黑白漫画页', description: '墨线、网点、清楚的分镜阅读顺序', scope: 'positive', sectionIds: ['camera', 'finish'],
    tokenIds: ['anime-layout-manga-panels', 'anime-line-monochrome-ink', 'anime-fx-screentone', 'quality-clean-edges'],
    keywords: ['日漫', '漫画页', '分镜页', '黑白漫画'], guidance: '适合黑白漫画成稿；对白和文字建议后期单独排入。', preview: 'style', targets: ['image'],
  },
  {
    id: 'anime-outfit-sheet', label: '二次元服装设定', description: '全身、服装正反面、结构与配色一致', scope: 'positive', sectionIds: ['wardrobe'],
    tokenIds: ['subject-single', 'subject-full-body', 'anime-layout-outfit-sheet', 'scene-plain', 'anime-line-colored', 'quality-consistent-design', 'anime-quality-line-color'],
    keywords: ['服装设计', '衣服设定', '服设', 'costume sheet'], guidance: '选中后再从穿搭里选择制服、裙装、外套、鞋袜和头饰。', preview: 'character-sheet', targets: ['image'],
  },
  {
    id: 'anime-gacha-card', label: '二次元卡池立绘', description: '角色中心、华丽特效、卡面完成度', scope: 'positive', sectionIds: ['subject', 'elements', 'finish'],
    tokenIds: ['composition-splash', 'anime-use-gacha-card', 'pose-action', 'magic-particles', 'lighting-rim', 'anime-delivery-key-visual'],
    keywords: ['抽卡', '卡池', '手游立绘', 'gacha'], guidance: '适合华丽角色卡面；可以继续叠加一种魔法和一种特效。', preview: 'key-art', targets: ['image'],
  },
  {
    id: 'anime-idol-stage', label: '偶像舞台', description: '舞台服、舞步、彩色演出灯光', scope: 'positive', sectionIds: ['wardrobe', 'action', 'environment'],
    tokenIds: ['anime-role-idol', 'anime-outfit-idol-stage', 'anime-action-idol-dance', 'anime-lighting-stage-neon', 'quality-polished'],
    keywords: ['偶像', '唱跳', '舞台', 'idol'], guidance: '适合舞台单人图；演唱动作可换成持麦演唱。', preview: 'action-grid', targets: ['image', 'video'],
  },
  {
    id: 'anime-mecha-action', label: '机甲战斗动画', description: '驾驶员、机甲库、高速动作与冲击碎石', scope: 'positive', sectionIds: ['subject', 'action', 'environment'],
    tokenIds: ['anime-role-mecha-pilot', 'anime-uniform-pilot-suit', 'anime-scene-mecha-hangar', 'anime-action-rapid-dash', 'anime-fx-sakuga-debris', 'anime-mood-hotblooded'],
    keywords: ['机甲', '机器人', '战斗动画', 'mecha'], guidance: '适合机甲题材气氛与动作；机体外观建议通过角色参考图固定。', preview: 'action-grid', targets: ['image', 'video'],
  },
  {
    id: 'environment-concept', label: '场景概念图', description: '环境主导、电影光、空间细节', scope: 'positive', sectionIds: ['environment'],
    tokenIds: ['composition-subject-environment-led', 'style-concept-art', 'lighting-cinematic', 'quality-detail'],
    keywords: ['场景设计', '环境概念', 'environment concept'], guidance: '适合先确定空间、氛围和场景叙事。', preview: 'key-art', targets: ['image', 'video'],
  },
  {
    id: 'prop-concept', label: '道具设定图', description: '道具主导、正交视图、结构准确', scope: 'positive', sectionIds: ['elements'],
    tokenIds: ['composition-subject-object-led', 'lens-orthographic', 'style-concept-art', 'quality-optimize-props', 'quality-material-separation', 'scene-plain'],
    keywords: ['武器设定', '物件设计', 'prop sheet'], guidance: '适合武器、装备和关键物件的结构设计。', preview: 'character-sheet',
  },
  {
    id: 'editorial-layout', label: '杂志视觉', description: '国际主义、几何造型、有限色盘', scope: 'positive', sectionIds: ['finish'],
    tokenIds: ['style-commercial-editorial', 'style-movement-swiss', 'style-language-geometric', 'color-property-limited', 'quality-production'],
    keywords: ['编辑设计', '版式视觉', 'editorial'], guidance: '适合结构清楚、留白明确的商业编辑视觉。', preview: 'style',
  },
  {
    id: 'filmic-frame', label: '胶片电影感', description: '中画幅、高光晕染、胶片调色', scope: 'positive', sectionIds: ['camera'],
    tokenIds: ['optical-medium-format', 'optical-film-grain', 'optical-halation', 'grade-filmic', 'lighting-cinematic'],
    keywords: ['胶片', '电影帧', 'film look'], guidance: '适合层次柔和、光学特征明确的电影画面。', preview: 'key-art', targets: ['image', 'video'],
  },
  {
    id: 'video-character-motion', label: '人物动态镜头', description: '人物运动、跟拍、衣发自然运动', scope: 'positive', sectionIds: ['action', 'camera'],
    tokenIds: ['subject-single', 'pose-motion-brisk-walk', 'camera-move-follow', 'fx-cloth-motion', 'fx-hair-motion', 'lighting-cinematic'],
    keywords: ['人物视频', '跟拍', '走动', '动态镜头'], guidance: '适合人物边移动边拍摄的连续视频。', preview: 'action-grid', targets: ['video'],
  },
  {
    id: 'video-slow-reveal', label: '缓慢揭示', description: '建立场景、缓慢推镜、逐步揭示主体', scope: 'positive', sectionIds: ['camera', 'environment'],
    tokenIds: ['narrative-establishing', 'camera-move-slow-push', 'narrative-reveal', 'lighting-cinematic'],
    keywords: ['揭示镜头', '推镜', '开场', '氛围视频'], guidance: '适合开场、产品或角色逐渐出现的镜头。', preview: 'key-art', targets: ['video'],
  },
  {
    id: 'model-character-asset', label: '完整角色模型', description: '单人全身、结构清晰、PBR材质', scope: 'positive', sectionIds: ['subject', 'finish'],
    tokenIds: ['subject-single', 'subject-full-body', 'style-language-geometric', 'render-pbr', 'quality-material-separation'],
    keywords: ['3D角色', '完整模型', 'PBR', 'character asset'], guidance: '适合文字生成单个完整角色资产。', preview: 'character-sheet', targets: ['model'],
  },
  {
    id: 'safe-negative', label: '通用负向', description: '低画质、人体错误、重复、文字水印', scope: 'negative', sectionIds: ['quality'],
    tokenIds: ['negative-low-quality', 'negative-anatomy', 'negative-hands', 'negative-limbs', 'negative-duplicate', 'negative-text'],
    keywords: ['基础排除', '常用负面', 'negative'], guidance: '作为通用起点，加入后仍可逐项删改。', preview: 'negative', targets: ['image', 'model'],
  },
];

const modelPromptPositiveCategories = new Set(['人物', '服饰', '汉服', '物品', '生物', '画风', '质量渲染']);
const modelPromptNegativeCategories = new Set(['质量', '人体', '手部', '面部', '内容控制']);

export function promptTokenSupportsTarget(entry: Pick<PromptToken, 'scope' | 'category' | 'group'>, target: PromptTokenTarget = 'image'): boolean {
  if (target === 'image') return true;
  if (target === 'video') return entry.scope === 'positive' && !(entry.category === '质量渲染' && entry.group === '交付标准');
  if (entry.scope === 'negative') return modelPromptNegativeCategories.has(entry.category);
  if (!modelPromptPositiveCategories.has(entry.category)) return false;
  return !(entry.category === '质量渲染' && entry.group === '交付标准');
}

export function filterPromptTokenRecipes(scope: PromptTokenScope, sectionId = '', search = '', target: PromptTokenTarget = 'image'): PromptTokenRecipe[] {
  const query = search.trim().toLowerCase();
  return promptTokenRecipes.filter((recipe) => {
    if (recipe.scope !== scope) return false;
    const targets = recipe.targets || ['image'];
    if (!targets.includes(target)) return false;
    if (!recipe.tokenIds.some((id) => {
      const entry = promptTokenMap.get(id);
      return Boolean(entry && promptTokenSupportsTarget(entry, target));
    })) return false;
    if (!query) return !sectionId || recipe.sectionIds.includes(sectionId);
    const tokenText = recipe.tokenIds.flatMap((id) => {
      const entry = promptTokenMap.get(id);
      return entry ? [entry.label, ...Object.values(entry.values)] : [];
    });
    return [recipe.label, recipe.description, recipe.guidance || '', ...recipe.keywords || [], ...tokenText]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

const danbooruPromptModelFamilies = new Set([
  'anima-base-v1',
  'newbie-image-exp01',
]);

export function promptDialectForAdapter(adapter?: string, modelFamily?: string): PromptDialect {
  if (adapter === 'comfyui-illustrious') return 'illustrious';
  if (adapter === 'comfyui-sdxl') return 'sdxl';
  if (adapter === 'comfyui-native-image' && danbooruPromptModelFamilies.has(String(modelFamily || '').trim().toLowerCase())) return 'illustrious';
  return 'natural';
}

export function promptDialectLabel(adapter?: string, modelFamily?: string): string {
  const dialect = promptDialectForAdapter(adapter, modelFamily);
  return dialect === 'illustrious'
    ? adapter === 'comfyui-illustrious' ? 'Illustrious 标签' : '动漫标签'
    : dialect === 'sdxl' ? 'SDXL 标签' : '自然语言';
}

export function supportsNegativePromptTokens(adapter?: string): boolean {
  return adapter === 'comfyui-illustrious' || adapter === 'comfyui-sdxl' || adapter === 'comfyui-native-image' || adapter === 'tripo3d-model';
}

export function promptTokenById(id: string): PromptToken | undefined {
  return promptTokenMap.get(canonicalPromptTokenId(id));
}

export function normalizedPromptTokenIds(ids: readonly string[] | undefined, scope?: PromptTokenScope): string[] {
  const seen = new Set<string>();
  return (ids || []).flatMap((id) => {
    const canonicalId = canonicalPromptTokenId(id);
    const entry = promptTokenMap.get(canonicalId);
    if (!entry || (scope && entry.scope !== scope) || seen.has(canonicalId)) return [];
    seen.add(canonicalId);
    return [canonicalId];
  });
}

export function reconcilePromptTokenConflicts(
  positiveIds: readonly string[] | undefined,
  negativeIds: readonly string[] | undefined,
): { positiveIds: string[]; negativeIds: string[]; replacedDuplicateCharacter: boolean } {
  const normalizedPositiveIds = normalizedPromptTokenIds(positiveIds, 'positive');
  const normalizedNegativeIds = normalizedPromptTokenIds(negativeIds, 'negative');
  const requestsRealPhotography = normalizedPositiveIds.some((id) => id.startsWith('style-photo-') || id.startsWith('detail-real-'));
  const compatibleNegativeIds = requestsRealPhotography
    ? normalizedNegativeIds.filter((id) => id !== 'negative-photorealistic')
    : normalizedNegativeIds;
  if (!normalizedPositiveIds.includes(astralAvatarPromptTokenId) || !compatibleNegativeIds.includes(duplicateCharacterNegativePromptTokenId)) {
    return { positiveIds: normalizedPositiveIds, negativeIds: compatibleNegativeIds, replacedDuplicateCharacter: false };
  }
  const nextNegativeIds: string[] = [];
  compatibleNegativeIds.forEach((id) => {
    const nextId = id === duplicateCharacterNegativePromptTokenId ? astralAvatarMisreadNegativePromptTokenId : id;
    if (!nextNegativeIds.includes(nextId)) nextNegativeIds.push(nextId);
  });
  return { positiveIds: normalizedPositiveIds, negativeIds: nextNegativeIds, replacedDuplicateCharacter: true };
}

function normalizedPart(value: string): string {
  return value.trim().replace(/[\s_]+/g, ' ').replace(/[.,;，；]+$/g, '').toLowerCase();
}

export function compilePromptTokenSelection(
  manualPrompt: string,
  selectedIds: readonly string[] | undefined,
  adapter: string | undefined,
  scope: PromptTokenScope,
  placementPrompt = manualPrompt,
  target: PromptTokenTarget = 'image',
  modelFamily?: string,
): string {
  const dialect = promptDialectForAdapter(adapter, modelFamily);
  const normalizedIds = normalizedPromptTokenIds(selectedIds, scope).filter((id) => {
    const entry = promptTokenMap.get(id);
    return Boolean(entry && promptTokenSupportsTarget(entry, target));
  });
  const selectedSet = new Set(normalizedIds);
  const manualWithoutMarkers = String(manualPrompt || '').replace(promptTokenMarkerPattern, '');
  const existing = new Set(manualWithoutMarkers.split(/[,，\n]+/).map(normalizedPart).filter(Boolean));
  const emittedIds = new Set<string>();
  const emitToken = (id: string) => {
    const canonicalId = canonicalPromptTokenId(id);
    if (!selectedSet.has(canonicalId) || emittedIds.has(canonicalId)) return '';
    const value = promptTokenMap.get(canonicalId)?.values[dialect]?.trim();
    if (!value) return '';
    const parts = value.split(/[,，]+/).map((part) => part.trim()).filter(Boolean);
    const missingParts = parts.filter((part) => !existing.has(normalizedPart(part)));
    emittedIds.add(canonicalId);
    missingParts.forEach((part) => existing.add(normalizedPart(part)));
    return missingParts.join(', ');
  };
  const expandMarkers = (value: string) => {
    const source = String(value || '');
    const expanded = source.replace(promptTokenMarkerPattern, (marker, markerScope: PromptTokenScope, id: string, offset: number) => {
      if (markerScope !== scope) return '';
      const emitted = emitToken(id);
      if (!emitted) return '';
      const before = source.slice(0, offset);
      const after = source.slice(offset + marker.length);
      const leading = before && !/[\s,，;；:：([{]$/.test(before) ? ', ' : '';
      const trailing = after && !/^[\s,，;；:：.!?。！？)\]}]/.test(after) ? ', ' : '';
      return `${leading}${emitted}${trailing}`;
    });
    return expanded
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,，])/g, '$1')
      .replace(/([,，])\s*([,，])/g, '$1')
      .trim()
      .replace(/^[,，\s]+|[,，\s]+$/g, '');
  };

  const manual = expandMarkers(manualPrompt);
  const placed: string[] = [];
  if (placementPrompt !== manualPrompt) {
    String(placementPrompt || '').replace(promptTokenMarkerPattern, (_marker, markerScope: PromptTokenScope, id: string) => {
      if (markerScope === scope) {
        const value = emitToken(id);
        if (value) placed.push(value);
      }
      return '';
    });
  }
  const emitted = normalizedIds.filter((id) => !emittedIds.has(id)).map(emitToken).filter(Boolean);
  return [manual, ...placed, ...emitted].filter(Boolean).join(', ');
}

function normalizedPromptSequence(value: string): string[] {
  return String(value || '').split(/[,，\n]+/).map(normalizedPart).filter(Boolean);
}

export function reconcilePromptTokenSelection(
  compiledPrompt: string,
  previousManualPrompt: string,
  selectedIds: readonly string[] | undefined,
  adapter: string | undefined,
  scope: PromptTokenScope,
  placementPrompt = previousManualPrompt,
  modelFamily?: string,
): { manualPrompt: string; selectedIds: string[] } {
  const incoming = String(compiledPrompt || '').trim();
  const normalizedIds = normalizedPromptTokenIds(selectedIds, scope);
  const previousCompiled = compilePromptTokenSelection(previousManualPrompt, normalizedIds, adapter, scope, placementPrompt, 'image', modelFamily);
  if (normalizedPromptSequence(incoming).join('\u0000') === normalizedPromptSequence(previousCompiled).join('\u0000')) {
    return { manualPrompt: String(previousManualPrompt || ''), selectedIds: normalizedIds };
  }

  const dialect = promptDialectForAdapter(adapter, modelFamily);
  const sourceParts = incoming.split(/[,，\n]+/).map((part) => part.trim()).filter(Boolean);
  const normalizedSource = sourceParts.map(normalizedPart);
  const consumed = new Set<number>();
  const retained: string[] = [];
  for (const id of normalizedIds) {
    const valueParts = String(promptTokenMap.get(id)?.values[dialect] || '').split(/[,，]+/).map(normalizedPart).filter(Boolean);
    const matches: number[] = [];
    for (const valuePart of valueParts) {
      const index = normalizedSource.findIndex((part, partIndex) => part === valuePart && !consumed.has(partIndex) && !matches.includes(partIndex));
      if (index < 0) { matches.length = 0; break; }
      matches.push(index);
    }
    if (!matches.length || matches.length !== valueParts.length) continue;
    matches.forEach((index) => consumed.add(index));
    retained.push(id);
  }
  return {
    manualPrompt: sourceParts.filter((_, index) => !consumed.has(index)).join(', '),
    selectedIds: retained,
  };
}

const condensedPromptPresetGroups: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  '基础内搭': new Set([
    'clothing-underwear-seamless-bra', 'clothing-underwear-sports-bra', 'clothing-underwear-bralette',
    'clothing-underwear-briefs', 'clothing-underwear-boxer-briefs', 'clothing-underwear-bodysuit',
    'clothing-underwear-shapewear', 'clothing-underwear-pajamas', 'clothing-underwear-nightgown',
    'clothing-underwear-base-layer',
  ]),
  '魅力内搭': new Set([
    'clothing-lingerie-lace-set', 'clothing-lingerie-satin-set', 'clothing-lingerie-mesh-set',
    'clothing-lingerie-embroidered-set', 'clothing-lingerie-lace-bodysuit', 'clothing-lingerie-babydoll',
    'clothing-lingerie-corset-set', 'clothing-lingerie-garter-set', 'clothing-lingerie-sheer-robe',
    'clothing-lingerie-boudoir-robe',
  ]),
  '亲吻依偎': new Set([
    'pose-adult-intimate-close-embrace', 'pose-adult-intimate-back-hug', 'pose-adult-intimate-forehead-touch',
    'pose-adult-intimate-almost-kiss', 'pose-adult-intimate-cheek-kiss', 'pose-adult-intimate-shoulder-rest',
    'pose-adult-intimate-spoon-cuddle', 'pose-adult-nonexplicit-gentle-kiss',
    'pose-adult-nonexplicit-romantic-kiss', 'pose-adult-nonexplicit-forehead-kiss',
    'pose-adult-nonexplicit-bed-cuddle', 'pose-adult-nonexplicit-morning-cuddle',
  ]),
});

export function promptTokenVisibleInPreset(entry: Pick<PromptToken, 'id' | 'group'>): boolean {
  const curatedIds = condensedPromptPresetGroups[entry.group];
  return !curatedIds || curatedIds.has(entry.id);
}

export function filterPromptTokens(scope: PromptTokenScope, category = '全部', search = '', target: PromptTokenTarget = 'image'): PromptToken[] {
  const query = search.trim().toLowerCase();
  return promptTokens.filter((entry) => {
    if (entry.scope !== scope || promptTokenIdAliases[entry.id] || !promptTokenVisibleInPreset(entry) || !promptTokenSupportsTarget(entry, target) || (category !== '全部' && entry.category !== category)) return false;
    if (!query) return true;
    const haystack = [entry.label, entry.group, entry.category, ...entry.aliases || [], ...Object.values(entry.values)].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

const preferredCategoryOrder: Record<PromptTokenScope, string[]> = {
  positive: ['人物', '服饰', '汉服', '表情动作', '构图', '镜头', '场景', '建筑', '自然', '光影环境', '色彩', '物品', '生物', '魔法', '特效', '画风', '质量渲染'],
  negative: ['质量', '人体', '手部', '面部', '构图', '文字', '背景', '色彩光线', '内容控制'],
};

/**
 * Stable third-level navigation order. This follows the way an artist builds a
 * prompt, instead of inheriting the incidental load order of the core,
 * expanded, and doubled catalogs.
 */
export const preferredPromptTokenGroupOrder: Readonly<Record<string, readonly string[]>> = Object.freeze({
  人物: ['对象数量', '人物关系', '年龄阶段', '性别气质', '国家身份', '现代职业', '传统职业', '幻想职业', '种族特征', '体型结构', '头身比例', '肤色特征', '五官特征', '发型细节', '发色'],
  服饰: ['服装风格', '上装', '下装', '裙装', '连身礼服', '外套', '制服职业装', '运动休闲', '基础内搭', '魅力内搭', '鞋靴', '袜类手套', '头饰', '首饰', '搭配配件', '护甲结构', '服装材质', '服装配色', '纹样工艺'],
  汉服: ['形制款式', '结构细节', '配饰', '纹样工艺'],
  表情动作: ['表情', '视线', '站姿', '坐姿', '跪蹲', '躺卧', '手势', '手臂动作', '身体姿态', '行走跑跳', '日常动作', '人物互动', '魅力姿态', '写真姿态', '亲密互动', '亲吻依偎', '战斗动作', '舞蹈运动'],
  构图: ['主体布局', '构图结构', '画幅布局', '视觉动线', '景深层次', '图形版式'],
  镜头: ['景别', '视角', '机位', '镜头类型', '焦段', '透视效果', '景深对焦', '镜头运动', '叙事镜头', '成像风格'],
  场景: ['场景类型', '场景细节', '空间状态', '时间段'],
  建筑: ['中国建筑', '欧洲建筑', '现代建筑', '幻想科幻建筑', '室内空间', '公共建筑', '工业设施'],
  自然: ['地貌', '植被', '水体', '天空天象', '季节', '自然现象'],
  光影环境: ['光源照明', '光线方向', '光线质感', '天气', '空气介质', '氛围'],
  色彩: ['综合色调', '主色系', '配色关系', '明暗对比', '色彩属性', '色彩控制', '调色风格'],
  物品: ['日常道具', '武器'],
  生物: ['陆生动物', '鸟类', '水生生物', '宠物坐骑', '神话幻想生物', '怪物'],
  魔法: ['元素属性', '施法方式', '法术形态', '能量质感', '魔法效果'],
  特效: ['能量形态', '能量运动', '粒子效果', '环境效果', '动态表现', '镜头视觉'],
  画风: ['真实摄影', '视觉风格', '审美流派', '绘画媒介', '线面语言', '表现技法', '画面质感', '商业用途', '实验风格'],
  质量渲染: ['质量标准', '渲染方式', '真实细节', '材质精修', '细节优化', '交付标准'],
});

export function promptTokenGroupRank(category: string, group: string): number {
  const rank = preferredPromptTokenGroupOrder[category]?.indexOf(group) ?? -1;
  return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
}

export type PromptTokenGroupNavigationItem = {
  id: string;
  label: string;
  dividerBefore?: boolean;
  members: readonly (readonly [category: string, group: string])[];
};

/**
 * User-facing third-level taxonomy. The source catalog stays granular for
 * maintenance, while the UI combines overlapping or overly technical source
 * groups into one clear creative decision.
 */
export const promptTokenGroupNavigation: Readonly<Record<PromptTokenScope, Readonly<Record<string, readonly PromptTokenGroupNavigationItem[]>>>> = {
  positive: {
    subject: [
      { id: 'subject-count', label: '人数', members: [['人物', '对象数量']] },
      { id: 'subject-relation', label: '人物关系', members: [['人物', '人物关系']] },
      { id: 'subject-age', label: '年龄阶段', dividerBefore: true, members: [['人物', '年龄阶段']] },
      { id: 'subject-gender', label: '性别与气质', members: [['人物', '性别气质']] },
      { id: 'subject-country', label: '国家地区', members: [['人物', '国家身份']] },
      { id: 'subject-role', label: '现实职业', dividerBefore: true, members: [['人物', '现代职业'], ['人物', '传统职业']] },
      { id: 'subject-fantasy-role', label: '幻想职业', members: [['人物', '幻想职业']] },
      { id: 'subject-race', label: '幻想种族', members: [['人物', '种族特征']] },
      { id: 'subject-build', label: '体型比例', dividerBefore: true, members: [['人物', '体型结构'], ['人物', '头身比例']] },
      { id: 'subject-face', label: '面部特征', members: [['人物', '肤色特征'], ['人物', '五官特征']] },
      { id: 'subject-hair-style', label: '发型', members: [['人物', '发型细节']] },
      { id: 'subject-hair-color', label: '发色', members: [['人物', '发色']] },
    ],
    wardrobe: [
      { id: 'wardrobe-look', label: '搭配方案', members: [['服饰', '服装风格'], ['服饰', '制服职业装'], ['服饰', '运动休闲']] },
      { id: 'wardrobe-top', label: '上装', dividerBefore: true, members: [['服饰', '上装']] },
      { id: 'wardrobe-bottom', label: '下装', members: [['服饰', '下装']] },
      { id: 'wardrobe-skirt', label: '裙装', members: [['服饰', '裙装']] },
      { id: 'wardrobe-one-piece', label: '连身装', members: [['服饰', '连身礼服']] },
      { id: 'wardrobe-outerwear', label: '外套', members: [['服饰', '外套']] },
      { id: 'wardrobe-underwear', label: '基础内搭', members: [['服饰', '基础内搭']] },
      { id: 'wardrobe-lingerie', label: '魅力内搭', members: [['服饰', '魅力内搭']] },
      { id: 'wardrobe-footwear', label: '鞋袜手套', dividerBefore: true, members: [['服饰', '鞋靴'], ['服饰', '袜类手套']] },
      { id: 'wardrobe-accessories', label: '配饰', members: [['服饰', '头饰'], ['服饰', '首饰'], ['服饰', '搭配配件']] },
      { id: 'wardrobe-armor', label: '护甲', members: [['服饰', '护甲结构']] },
      { id: 'wardrobe-material-craft', label: '材质纹样', dividerBefore: true, members: [['服饰', '服装材质'], ['服饰', '纹样工艺']] },
      { id: 'wardrobe-color', label: '配色', members: [['服饰', '服装配色']] },
      { id: 'wardrobe-hanfu-form', label: '汉服形制', dividerBefore: true, members: [['汉服', '形制款式'], ['汉服', '结构细节']] },
      { id: 'wardrobe-hanfu-detail', label: '汉服配饰', members: [['汉服', '配饰'], ['汉服', '纹样工艺']] },
    ],
    action: [
      { id: 'action-expression', label: '表情', members: [['表情动作', '表情']] },
      { id: 'action-gaze', label: '视线', members: [['表情动作', '视线']] },
      { id: 'action-posture', label: '基础姿势', dividerBefore: true, members: [['表情动作', '站姿'], ['表情动作', '坐姿'], ['表情动作', '跪蹲'], ['表情动作', '躺卧']] },
      { id: 'action-hands', label: '手部动作', members: [['表情动作', '手势'], ['表情动作', '手臂动作']] },
      { id: 'action-movement', label: '动态姿势', members: [['表情动作', '身体姿态'], ['表情动作', '行走跑跳']] },
      { id: 'action-daily', label: '日常动作', dividerBefore: true, members: [['表情动作', '日常动作']] },
      { id: 'action-interaction', label: '人物互动', members: [['表情动作', '人物互动']] },
      { id: 'action-adult-pose', label: '魅力姿态', dividerBefore: true, members: [['表情动作', '魅力姿态']] },
      { id: 'action-adult-editorial', label: '写真姿态', members: [['表情动作', '写真姿态']] },
      { id: 'action-intimate', label: '亲密互动', members: [['表情动作', '亲密互动']] },
      { id: 'action-kiss-cuddle', label: '亲吻依偎', members: [['表情动作', '亲吻依偎']] },
      { id: 'action-combat', label: '战斗动作', dividerBefore: true, members: [['表情动作', '战斗动作']] },
      { id: 'action-sport', label: '舞蹈运动', members: [['表情动作', '舞蹈运动']] },
    ],
    camera: [
      { id: 'camera-composition', label: '构图布局', members: [['构图', '主体布局'], ['构图', '构图结构'], ['构图', '画幅布局'], ['构图', '图形版式']] },
      { id: 'camera-flow', label: '视觉动线', members: [['构图', '视觉动线']] },
      { id: 'camera-depth', label: '空间层次', members: [['构图', '景深层次']] },
      { id: 'camera-shot', label: '景别', dividerBefore: true, members: [['镜头', '景别']] },
      { id: 'camera-viewpoint', label: '视角机位', members: [['镜头', '视角'], ['镜头', '机位']] },
      { id: 'camera-lens', label: '镜头焦段', members: [['镜头', '镜头类型'], ['镜头', '焦段']] },
      { id: 'camera-focus', label: '透视对焦', members: [['镜头', '透视效果'], ['镜头', '景深对焦']] },
      { id: 'camera-motion', label: '镜头运动', dividerBefore: true, members: [['镜头', '镜头运动']] },
      { id: 'camera-story', label: '叙事镜头', members: [['镜头', '叙事镜头']] },
      { id: 'camera-imaging', label: '成像风格', dividerBefore: true, members: [['镜头', '成像风格']] },
    ],
    environment: [
      { id: 'environment-scene', label: '场景空间', members: [['场景', '场景类型'], ['场景', '场景细节'], ['场景', '空间状态']] },
      { id: 'environment-architecture-style', label: '建筑风格', dividerBefore: true, members: [['建筑', '中国建筑'], ['建筑', '欧洲建筑'], ['建筑', '现代建筑'], ['建筑', '幻想科幻建筑']] },
      { id: 'environment-architecture-space', label: '建筑空间', members: [['建筑', '室内空间'], ['建筑', '公共建筑'], ['建筑', '工业设施']] },
      { id: 'environment-nature', label: '自然景观', dividerBefore: true, members: [['自然', '地貌'], ['自然', '植被'], ['自然', '水体'], ['自然', '天空天象']] },
      { id: 'environment-time', label: '时间季节', dividerBefore: true, members: [['场景', '时间段'], ['自然', '季节']] },
      { id: 'environment-weather', label: '天气现象', members: [['光影环境', '天气'], ['自然', '自然现象']] },
      { id: 'environment-light', label: '光源方向', dividerBefore: true, members: [['光影环境', '光源照明'], ['光影环境', '光线方向']] },
      { id: 'environment-light-quality', label: '光线质感', members: [['光影环境', '光线质感']] },
      { id: 'environment-atmosphere', label: '空气氛围', members: [['光影环境', '空气介质'], ['光影环境', '氛围']] },
      { id: 'environment-color-tone', label: '色调主色', dividerBefore: true, members: [['色彩', '综合色调'], ['色彩', '主色系']] },
      { id: 'environment-color-relation', label: '配色对比', members: [['色彩', '配色关系'], ['色彩', '明暗对比']] },
      { id: 'environment-color-control', label: '色彩控制', members: [['色彩', '色彩控制']] },
      { id: 'environment-grading', label: '调色风格', members: [['色彩', '色彩属性'], ['色彩', '调色风格']] },
    ],
    elements: [
      { id: 'elements-props', label: '道具', members: [['物品', '日常道具']] },
      { id: 'elements-weapons', label: '武器', members: [['物品', '武器']] },
      { id: 'elements-animals', label: '动物', dividerBefore: true, members: [['生物', '陆生动物'], ['生物', '鸟类'], ['生物', '水生生物']] },
      { id: 'elements-companions', label: '宠物坐骑', members: [['生物', '宠物坐骑']] },
      { id: 'elements-creatures', label: '幻想生物', members: [['生物', '神话幻想生物'], ['生物', '怪物']] },
      { id: 'elements-magic-element', label: '魔法属性', dividerBefore: true, members: [['魔法', '元素属性']] },
      { id: 'elements-casting', label: '施法方式', members: [['魔法', '施法方式']] },
      { id: 'elements-magic-effect', label: '魔法效果', members: [['魔法', '法术形态'], ['魔法', '能量质感'], ['魔法', '魔法效果']] },
      { id: 'elements-energy-fx', label: '能量特效', dividerBefore: true, members: [['特效', '能量形态'], ['特效', '能量运动']] },
      { id: 'elements-particles', label: '粒子特效', members: [['特效', '粒子效果']] },
      { id: 'elements-environment-fx', label: '环境动态', members: [['特效', '环境效果'], ['特效', '动态表现']] },
      { id: 'elements-camera-fx', label: '镜头特效', members: [['特效', '镜头视觉']] },
    ],
    finish: [
      { id: 'finish-photo', label: '照片类型', members: [['画风', '真实摄影']] },
      { id: 'finish-style', label: '视觉风格', members: [['画风', '视觉风格']] },
      { id: 'finish-movement', label: '审美流派', members: [['画风', '审美流派']] },
      { id: 'finish-medium', label: '绘画媒介', dividerBefore: true, members: [['画风', '绘画媒介']] },
      { id: 'finish-language', label: '线面语言', members: [['画风', '线面语言']] },
      { id: 'finish-technique', label: '表现技法', members: [['画风', '表现技法']] },
      { id: 'finish-surface', label: '画面质感', members: [['画风', '画面质感']] },
      { id: 'finish-commercial', label: '商业用途', dividerBefore: true, members: [['画风', '商业用途']] },
      { id: 'finish-experimental', label: '实验风格', members: [['画风', '实验风格']] },
      { id: 'finish-quality', label: '质量标准', dividerBefore: true, members: [['质量渲染', '质量标准']] },
      { id: 'finish-render', label: '渲染方式', members: [['质量渲染', '渲染方式']] },
      { id: 'finish-detail', label: '真实细节', members: [['质量渲染', '真实细节']] },
      { id: 'finish-refine', label: '细节精修', members: [['质量渲染', '材质精修'], ['质量渲染', '细节优化']] },
      { id: 'finish-delivery', label: '交付标准', members: [['质量渲染', '交付标准']] },
    ],
  },
  negative: {
    quality: [
      { id: 'negative-quality', label: '画质清晰', members: [['质量', '基础质量'], ['质量', '清晰度']] },
    ],
    anatomy: [
      { id: 'negative-body', label: '人体结构', members: [['人体', '结构错误'], ['人体', '肢体错误']] },
      { id: 'negative-hands', label: '手部错误', members: [['手部', '手部错误'], ['手部', '手指错误'], ['手部', '手掌手腕']] },
      { id: 'negative-face', label: '面部五官', dividerBefore: true, members: [['面部', '面部错误'], ['面部', '五官细节']] },
    ],
    frame: [
      { id: 'negative-composition', label: '构图裁切', members: [['构图', '画面布局'], ['构图', '透视裁切']] },
      { id: 'negative-background', label: '背景干扰', members: [['背景', '背景干扰']] },
      { id: 'negative-color', label: '色彩光线', members: [['色彩光线', '色彩光照']] },
      { id: 'negative-text', label: '文字界面', dividerBefore: true, members: [['文字', '水印标识'], ['文字', '界面标识']] },
    ],
    content: [
      { id: 'negative-content', label: '多余内容', members: [['内容控制', '多余内容']] },
      { id: 'negative-style', label: '排除风格', dividerBefore: true, members: [['内容控制', '风格排除']] },
    ],
  },
};

export function promptTokenCategories(scope: PromptTokenScope): string[] {
  const available = [...new Set(promptTokens.filter((entry) => entry.scope === scope).map((entry) => entry.category))];
  const preferred = preferredCategoryOrder[scope].filter((category) => available.includes(category));
  return ['全部', ...preferred, ...available.filter((category) => !preferred.includes(category))];
}
