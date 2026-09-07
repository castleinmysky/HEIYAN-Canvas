import type { PromptToken } from './prompt-token-library';

type AnimeTokenRow = readonly [
  id: string,
  label: string,
  illustrious: string,
  sdxl: string,
  natural: string,
  aliases?: string[],
];

const animeGroup = (category: string, group: string, rows: readonly AnimeTokenRow[]): PromptToken[] => rows.map(([
  id, label, illustrious, sdxl, natural, aliases,
]) => ({
  id,
  scope: 'positive',
  category,
  group,
  label,
  values: { illustrious, sdxl, natural },
  aliases: aliases || [],
}));

/**
 * Anime-focused vocabulary. It stays inside the existing task-first taxonomy,
 * so adding useful depth does not add another top-level menu to the composer.
 * Illustrious uses concise tag-like phrases; general image models receive
 * readable English descriptions of the same intent.
 */
export const animePositivePromptTokens: PromptToken[] = [
  ...animeGroup('人物', '幻想职业', [
    ['anime-role-heroine', '动画女主角', 'anime heroine', 'anime heroine', 'a heroine from an original anime story', ['女主', '女主角']],
    ['anime-role-hero', '动画男主角', 'anime hero', 'anime hero', 'a hero from an original anime story', ['男主', '男主角']],
    ['anime-role-rival', '宿敌角色', 'rival character', 'anime rival character', 'a rival character with a distinctive silhouette', ['劲敌', '对手']],
    ['anime-role-magical-warrior', '魔法战士', 'magical warrior', 'anime magical warrior character', 'a magical warrior in an original anime setting', ['魔法少女', '变身角色']],
    ['anime-role-idol', '偶像角色', 'idol', 'anime idol performer', 'a pop idol character performing on stage', ['偶像歌手']],
    ['anime-role-mecha-pilot', '机甲驾驶员', 'mecha pilot', 'anime mecha pilot', 'a pilot from an original mecha anime setting', ['机器人驾驶员']],
    ['anime-role-onmyoji', '阴阳师角色', 'onmyouji', 'anime onmyoji', 'an onmyoji character in a stylized anime setting', ['阴阳师']],
    ['anime-role-swordmaster', '剑豪角色', 'swordmaster', 'anime swordmaster', 'a master swordsman in an original anime setting', ['剑客', '剑士']],
  ]),
  ...animeGroup('人物', '发型细节', [
    ['anime-hair-ahoge', '呆毛', 'ahoge', 'single expressive ahoge hair strand', 'one expressive strand of hair rising from the crown', ['天线毛']],
    ['anime-hair-drill-curls', '钻头卷', 'drill hair', 'anime drill-curl hairstyle', 'hair styled into structured spiral drill curls', ['螺旋卷']],
    ['anime-hair-wolf-cut', '狼尾发型', 'wolf cut', 'layered anime wolf-cut hairstyle', 'a layered wolf-cut hairstyle with a tapered nape', ['狼尾']],
    ['anime-hair-inner-color', '内层挑染', 'colored inner hair', 'contrasting inner-color anime hair', 'hair with a contrasting color hidden in its inner layers', ['挂耳染']],
    ['anime-hair-glossy-highlight', '动画高光发丝', 'hair highlight, glossy hair', 'graphic anime hair highlights', 'clean graphic highlights shaped across glossy anime hair', ['头发高光']],
  ]),
  ...animeGroup('人物', '五官特征', [
    ['anime-eyes-large-expressive', '大而灵动的眼睛', 'large expressive eyes', 'large expressive anime eyes', 'large expressive eyes with clear emotional focus', ['大眼睛']],
    ['anime-eyes-luminous', '通透发光眼睛', 'detailed eyes, glowing eyes', 'luminous detailed anime eyes', 'luminous layered irises with crisp highlights', ['水灵眼睛', '通透眼睛']],
    ['anime-eyes-heart-pupils', '心形瞳孔', 'heart-shaped pupils', 'anime eyes with heart-shaped pupils', 'stylized irises with small heart-shaped pupils', ['爱心眼']],
    ['anime-eyes-sanpaku', '三白眼', 'sanpaku', 'stylized sanpaku anime eyes', 'stylized eyes with visible sclera beneath the iris', ['下三白']],
    ['anime-eyes-sleepy', '慵懒半睁眼', 'half-closed eyes', 'sleepy half-lidded anime eyes', 'relaxed half-lidded eyes with a sleepy expression', ['半睁眼']],
    ['anime-face-fang', '可爱小虎牙', 'fang', 'small cute anime fang', 'one small visible canine tooth in a playful expression', ['虎牙']],
    ['anime-face-blush-lines', '漫画害羞线', 'blush stickers', 'graphic anime blush lines', 'small graphic blush lines across the cheeks', ['害羞线', '腮红线']],
  ]),
  ...animeGroup('服饰', '服装风格', [
    ['anime-outfit-magical', '魔法变身服', 'magical warrior costume', 'ornate anime transformation costume', 'an original ornate magical transformation costume', ['魔法少女服']],
    ['anime-outfit-idol-stage', '偶像舞台服', 'idol costume', 'polished anime idol stage costume', 'a polished original idol costume designed for a stage performance', ['打歌服']],
    ['anime-outfit-fantasy-academy', '幻想学院服', 'fantasy academy uniform', 'original fantasy academy uniform', 'an original layered uniform for a fantasy academy'],
    ['anime-outfit-gothic-lolita', '哥特洛丽塔', 'gothic lolita', 'detailed gothic-lolita anime fashion', 'detailed gothic-lolita fashion with a balanced original design', ['哥特裙']],
    ['anime-outfit-techwear', '未来机能服', 'anime techwear', 'futuristic anime techwear outfit', 'a futuristic anime outfit combining functional layers and luminous details', ['机能风']],
    ['anime-outfit-shrine-maiden', '巫女服', 'miko', 'stylized shrine-maiden outfit', 'a stylized red-and-white shrine-maiden outfit', ['神社巫女']],
  ]),
  ...animeGroup('服饰', '制服职业装', [
    ['anime-uniform-sailor-collar', '水手领制服', 'sailor collar uniform', 'anime academy uniform with sailor collar', 'an original academy uniform built around a sailor-style collar', ['水手服']],
    ['anime-uniform-blazer', '学院西装制服', 'school blazer', 'academy-style blazer uniform', 'an academy-inspired blazer uniform', ['制服西装']],
    ['anime-uniform-pilot-suit', '机甲驾驶服', 'pilot suit', 'fitted futuristic anime pilot suit', 'a fitted futuristic pilot suit with readable functional panels', ['驾驶员服']],
    ['anime-uniform-maid', '女仆制服', 'maid, maid apron', 'classic anime maid uniform', 'a classic modest maid uniform with a structured apron', ['女仆装']],
    ['anime-uniform-butler', '执事制服', 'butler uniform', 'elegant anime butler uniform', 'an elegant tailored butler uniform with gloves', ['管家服']],
    ['anime-uniform-military-academy', '军校制服', 'military academy uniform', 'original anime military-academy uniform', 'an original formal military-academy uniform with readable insignia', ['军校服']],
    ['anime-uniform-space-fleet', '宇宙舰队制服', 'space fleet uniform', 'original anime space-fleet uniform', 'an original futuristic uniform for a space-fleet officer', ['舰队制服']],
    ['anime-uniform-cafe', '主题咖啡店制服', 'cafe uniform', 'cute anime themed-cafe uniform', 'a polished original themed-cafe service uniform', ['咖啡店制服']],
    ['anime-uniform-detective', '侦探造型', 'detective outfit', 'stylized anime detective outfit', 'a smart detective outfit with a coat and practical accessories', ['侦探服']],
  ]),
  ...animeGroup('服饰', '上装', [
    ['anime-top-sailor-blouse', '水手领上衣', 'sailor blouse', 'anime sailor-collar blouse', 'a neat blouse with a broad sailor-style collar'],
    ['anime-top-oversized-hoodie', '宽松连帽卫衣', 'oversized hoodie', 'oversized anime hoodie', 'an oversized hooded sweatshirt with soft folds', ['大卫衣']],
    ['anime-top-knit-cardigan', '针织开衫', 'knit cardigan', 'soft anime knit cardigan', 'a soft buttoned knit cardigan layered over the top', ['毛衣开衫']],
    ['anime-top-bow-blouse', '蝴蝶结衬衫', 'blouse, neck ribbon', 'anime blouse with neck ribbon', 'a fitted blouse finished with a large neck ribbon', ['领结衬衫']],
    ['anime-top-detached-sleeves', '分离袖上衣', 'detached sleeves', 'anime top with detached sleeves', 'a stylized top with matching detached sleeves', ['独立袖']],
    ['anime-top-frilled-blouse', '荷叶边上衣', 'frilled blouse', 'anime frilled blouse', 'a layered blouse edged with controlled frills', ['花边上衣']],
  ]),
  ...animeGroup('服饰', '下装', [
    ['anime-bottom-high-waist-shorts', '高腰短裤', 'high-waist shorts', 'anime high-waisted shorts', 'high-waisted tailored shorts with a clean silhouette'],
    ['anime-bottom-techwear-cargo', '机能束脚裤', 'techwear cargo pants', 'anime techwear cargo trousers', 'tapered cargo trousers with functional straps and pockets', ['机能裤']],
    ['anime-bottom-layered-shorts', '层叠战斗短裤', 'layered combat shorts', 'layered anime combat shorts', 'layered fitted shorts designed for a fantasy action costume'],
  ]),
  ...animeGroup('服饰', '裙装', [
    ['anime-skirt-magical-layered', '魔法层叠裙', 'layered magical skirt', 'layered anime magical costume skirt', 'a short layered magical costume skirt with a readable petal silhouette'],
    ['anime-skirt-idol-asymmetric', '偶像不对称裙', 'asymmetrical idol skirt', 'asymmetrical anime idol skirt', 'an asymmetrical performance skirt with controlled decorative layers'],
    ['anime-skirt-gothic-tiered', '哥特蛋糕裙', 'tiered gothic skirt', 'tiered gothic anime skirt', 'a structured tiered gothic skirt with lace-edged layers', ['蛋糕裙']],
    ['anime-skirt-long-flowing', '长款飘逸裙', 'long flowing skirt', 'long flowing anime skirt', 'a long lightweight skirt flowing clearly with the character motion'],
  ]),
  ...animeGroup('服饰', '连身礼服', [
    ['anime-dress-transformation', '变身礼裙', 'transformation dress', 'ornate anime transformation dress', 'an original transformation dress built around a strong symbolic motif'],
    ['anime-dress-princess', '动画公主裙', 'anime princess dress', 'original anime princess gown', 'an original fantasy princess gown with a clean animated silhouette'],
    ['anime-dress-stage', '偶像演出礼裙', 'idol stage dress', 'polished anime idol performance dress', 'a polished stage dress designed for energetic dance movement'],
    ['anime-dress-qipao-fantasy', '幻想改良旗袍', 'fantasy china dress', 'anime fantasy qipao-inspired dress', 'an original anime fantasy dress inspired by the structure of a qipao'],
  ]),
  ...animeGroup('服饰', '外套', [
    ['anime-outer-capelet', '短斗篷', 'capelet', 'anime fantasy shoulder capelet', 'a short fantasy capelet draped over the shoulders', ['小披风']],
    ['anime-outer-yukata', '夏日浴衣', 'yukata', 'colorful anime summer yukata', 'a lightweight summer yukata with an original seasonal pattern', ['浴衣']],
    ['anime-outer-happi', '祭典法被', 'happi coat', 'anime festival happi coat', 'a short festival happi coat with a bold original emblem', ['法被']],
  ]),
  ...animeGroup('服饰', '运动休闲', [
    ['anime-casual-school-jersey', '校园运动服', 'school tracksuit', 'anime academy tracksuit', 'a practical academy tracksuit with clean color blocking', ['运动校服']],
    ['anime-casual-athletic-jacket', '运动外套', 'track jacket', 'anime athletic track jacket', 'a fitted athletic track jacket with contrasting side stripes'],
    ['anime-casual-layered-street', '日系叠穿', 'layered streetwear', 'layered anime streetwear', 'casual layered streetwear with balanced oversized and fitted pieces', ['休闲叠穿']],
    ['anime-casual-cozy-roomwear', '居家常服', 'cozy roomwear', 'cozy anime roomwear', 'soft modest roomwear designed for a relaxed home scene', ['家居服']],
  ]),
  ...animeGroup('服饰', '鞋靴', [
    ['anime-shoes-platform', '厚底短靴', 'platform boots', 'anime platform ankle boots', 'fashionable platform ankle boots with a stable silhouette'],
    ['anime-shoes-idol', '偶像舞台鞋', 'idol shoes', 'anime idol stage shoes', 'decorative stage shoes designed to match an idol costume'],
  ]),
  ...animeGroup('服饰', '袜类手套', [
    ['anime-legwear-striped', '条纹长袜', 'striped thighhighs', 'anime striped long stockings', 'long stockings with a clean repeated stripe pattern'],
    ['anime-gloves-opera', '长款礼服手套', 'elbow gloves', 'anime elbow-length formal gloves', 'elegant gloves extending above the elbow'],
  ]),
  ...animeGroup('服饰', '头饰', [
    ['anime-headwear-large-ribbon', '大蝴蝶结头饰', 'large hair bow', 'large anime hair ribbon', 'a large structured ribbon used as the primary hair ornament', ['大头花']],
    ['anime-headwear-cat-ear-band', '猫耳发箍', 'cat ear headband', 'anime cat-ear headband', 'a playful headband shaped like cat ears', ['猫耳头饰']],
    ['anime-headwear-mini-hat', '迷你礼帽', 'mini top hat', 'anime miniature top-hat accessory', 'a small decorative top hat tilted on the hair', ['小礼帽']],
    ['anime-headwear-star-clips', '星星发夹', 'star hair ornament', 'anime star-shaped hair clips', 'several small star-shaped clips arranged in the hair', ['星星头饰']],
    ['anime-headwear-flower-crown', '花环头饰', 'flower crown', 'anime flower-crown headpiece', 'a delicate crown woven from small seasonal flowers'],
  ]),
  ...animeGroup('服饰', '搭配配件', [
    ['anime-accessory-magical-brooch', '变身胸针', 'magical brooch', 'original anime transformation brooch', 'an original jeweled brooch that serves as the transformation focus', ['魔法胸针']],
    ['anime-accessory-waist-pouch', '冒险腰包', 'belt pouch', 'anime fantasy belt pouches', 'small practical pouches attached to the character belt'],
    ['anime-accessory-headphones', '未来耳机', 'futuristic headphones', 'anime futuristic headset', 'a sleek futuristic headset integrated into the character silhouette'],
    ['anime-accessory-eyepatch', '角色眼罩', 'eyepatch', 'stylized anime eyepatch', 'a clean stylized eyepatch used as a deliberate character-design element'],
  ]),
  ...animeGroup('服饰', '护甲结构', [
    ['anime-armor-magical', '魔法少女护甲', 'magical armor', 'ornate anime magical armor', 'ornate magical armor integrated into an original transformation costume'],
    ['anime-armor-mecha', '机甲外骨骼', 'powered exoskeleton', 'anime powered exoskeleton armor', 'a readable futuristic powered exoskeleton around the limbs and torso'],
    ['anime-armor-asymmetric', '不对称角色护甲', 'asymmetrical armor', 'asymmetrical anime character armor', 'an asymmetrical armor design balancing one protected side against a lighter side'],
  ]),
  ...animeGroup('服饰', '服装配色', [
    ['anime-palette-heroine', '主角白蓝金', 'white blue gold outfit', 'white-blue-gold anime costume palette', 'a heroic costume palette of white, clear blue, and restrained gold accents'],
    ['anime-palette-rival', '宿敌黑红银', 'black red silver outfit', 'black-red-silver anime costume palette', 'a rival-character palette of black, deep red, and sharp silver accents'],
    ['anime-palette-idol', '偶像糖果配色', 'candy color idol outfit', 'candy-colored anime idol costume palette', 'a coordinated stage palette using bright candy colors and clean white accents'],
    ['anime-palette-magical', '魔法渐变配色', 'iridescent magical outfit', 'iridescent gradient anime costume palette', 'a magical costume palette shifting smoothly between two luminous hues'],
  ]),
  ...animeGroup('服饰', '纹样工艺', [
    ['anime-pattern-character-emblem', '角色专属徽记', 'character emblem', 'original anime character emblem on clothing', 'an original symbolic emblem repeated subtly across the costume', ['角色logo']],
    ['anime-pattern-star-motif', '星月纹样', 'star and moon motif', 'anime star-and-moon costume motif', 'a controlled repeating star-and-moon motif across selected garment panels'],
    ['anime-pattern-magic-circuit', '魔法回路纹', 'magic circuit pattern', 'glowing anime magic-circuit garment pattern', 'thin glowing circuit-like magical lines integrated into the garment'],
    ['anime-pattern-contrast-trim', '撞色滚边', 'contrast trim', 'contrast anime costume edging', 'clean contrasting trim that clarifies the costume construction'],
  ]),

  ...animeGroup('表情动作', '表情', [
    ['anime-expression-pout', '鼓腮生气', 'pout, puffed cheeks', 'anime pout with puffed cheeks', 'a playful pout with slightly puffed cheeks', ['嘟嘴', '鼓脸']],
    ['anime-expression-flustered', '慌张脸红', 'flustered, blush', 'flustered blushing anime expression', 'a visibly flustered expression with a natural blush', ['害羞脸红']],
    ['anime-expression-smug', '得意坏笑', 'smug', 'smug anime expression', 'a self-satisfied playful smirk', ['得意脸']],
    ['anime-expression-determined', '热血坚定', 'determined expression', 'determined shounen-style expression', 'a fiercely determined expression ready for action', ['热血脸']],
    ['anime-expression-teary-smile', '含泪微笑', 'teary smile', 'emotional anime smile with tears', 'a restrained emotional smile with tears gathering in the eyes', ['泪光微笑']],
    ['anime-expression-sparkling', '憧憬星星眼', 'sparkling eyes, excited', 'excited anime expression with sparkling eyes', 'an excited hopeful expression with sparkling eyes', ['憧憬脸']],
  ]),
  ...animeGroup('表情动作', '身体姿态', [
    ['anime-pose-transformation', '变身定格姿势', 'transformation pose', 'dramatic anime transformation pose', 'a dramatic transformation pose with a clear readable silhouette', ['变身动作']],
    ['anime-pose-hero-landing', '英雄落地', 'superhero landing', 'dynamic anime hero landing pose', 'a dynamic one-knee landing pose after a powerful jump', ['落地姿势']],
    ['anime-pose-cape-turn', '回身甩披风', 'turning around, cape flutter', 'dramatic anime turn with flowing cape', 'turning sharply while a cape sweeps through the air'],
    ['anime-pose-power-charge', '蓄力姿势', 'powering up', 'anime power-charging stance', 'a grounded action pose while gathering visible energy', ['聚气', '蓄力']],
  ]),
  ...animeGroup('表情动作', '战斗动作', [
    ['anime-action-sword-draw', '拔刀瞬间', 'iaijutsu, drawing sword', 'dynamic anime sword-draw action', 'the precise instant a character draws a sword into an attack', ['拔刀斩']],
    ['anime-action-airborne-strike', '空中突击', 'aerial attack', 'dynamic airborne anime attack', 'an airborne attack with a clear trajectory and readable body mechanics', ['空中攻击']],
    ['anime-action-spell-cast', '咏唱施法', 'casting spell, hand gesture', 'anime spell-casting gesture', 'performing a deliberate spell-casting gesture with focused energy', ['释放魔法']],
    ['anime-action-duel-clash', '武器对撞', 'weapon clash', 'dramatic anime weapon clash', 'two weapons meeting at the decisive instant of a duel', ['对刀', '拼刀']],
    ['anime-action-rapid-dash', '高速突进', 'dashing, motion blur', 'high-speed anime combat dash', 'a rapid forward combat dash with a readable direction of travel', ['瞬身', '冲刺']],
  ]),
  ...animeGroup('表情动作', '舞蹈运动', [
    ['anime-action-idol-dance', '偶像舞步', 'idol dance pose', 'energetic anime idol dance pose', 'an energetic coordinated pop-idol dance pose', ['舞台舞蹈']],
    ['anime-action-mic-performance', '持麦演唱', 'singing, holding microphone', 'anime stage singing performance', 'singing into a handheld microphone during a lively stage performance', ['唱歌']],
  ]),

  ...animeGroup('构图', '构图结构', [
    ['anime-composition-key-visual', '动画主视觉', 'anime key visual', 'cinematic anime key-visual composition', 'a cinematic key visual for an original animated story', ['动画海报', '动漫主视觉']],
    ['anime-composition-ensemble', '角色群像主视觉', 'ensemble cast, key visual', 'anime ensemble-cast key visual', 'an ensemble key visual with each character clearly staged and readable', ['群像海报']],
    ['anime-composition-diagonal-action', '斜线动作构图', 'diagonal composition, dynamic action', 'diagonal anime action composition', 'a strong diagonal composition that reinforces the direction of action', ['对角线构图']],
    ['anime-composition-emotional-closeup', '情绪脸部特写', 'face close-up, emotional focus', 'emotional anime face close-up', 'a tightly framed face close-up centered on the character emotion', ['大脸特写']],
  ]),
  ...animeGroup('构图', '画幅布局', [
    ['anime-layout-light-novel-cover', '轻小说封面', 'light novel cover', 'light-novel cover layout', 'a light-novel cover composition with balanced title space', ['轻小说插画']],
    ['anime-layout-manga-cover', '漫画单行本封面', 'manga cover', 'manga-volume cover layout', 'a manga volume cover with a strong central silhouette', ['漫画封面']],
    ['anime-layout-visual-novel-cg', '视觉小说事件CG', 'visual novel event cg', 'visual-novel event CG composition', 'a polished event illustration from an original visual novel', ['事件CG']],
    ['anime-layout-character-lineup', '动画角色排排站', 'character lineup, height chart', 'anime cast lineup with height comparison', 'a clean full-body cast lineup showing relative character heights', ['身高对比']],
  ]),
  ...animeGroup('构图', '图形版式', [
    ['anime-layout-manga-panels', '日漫分镜页', 'manga panels, monochrome', 'readable Japanese-manga panel page', 'a readable monochrome manga page with clear panel flow', ['漫画分镜']],
    ['anime-layout-expression-sheet', '表情设定表', 'expression sheet, multiple expressions', 'anime character expression sheet', 'a clean character sheet comparing several facial expressions', ['表情表']],
    ['anime-layout-outfit-sheet', '服装设定表', 'outfit design sheet', 'anime costume design sheet', 'a clean costume design sheet showing front, back, and key details', ['服装三视图']],
  ]),

  ...animeGroup('场景', '场景类型', [
    ['anime-scene-school-rooftop', '夕阳天台', 'school rooftop, sunset', 'anime school rooftop at sunset', 'a quiet school rooftop under a vivid sunset sky', ['校园天台']],
    ['anime-scene-summer-festival', '夏日祭夜景', 'summer festival, night', 'anime summer festival at night', 'a lively summer festival at night with lanterns and food stalls', ['祭典夜市']],
    ['anime-scene-shrine-steps', '神社石阶', 'shrine, stone stairs', 'anime shrine stone steps', 'long stone steps leading to a shrine beneath trees', ['神社台阶']],
    ['anime-scene-rainy-crossing', '雨夜电车道口', 'railroad crossing, rain, night', 'anime railway crossing on a rainy night', 'a railway crossing glowing softly through rain at night', ['电车道口']],
    ['anime-scene-mecha-hangar', '机甲整备库', 'mecha hangar', 'large anime mecha maintenance hangar', 'a vast maintenance hangar built around an original giant robot', ['机库']],
    ['anime-scene-floating-city', '天空浮岛城', 'floating city, sky islands', 'anime fantasy city among floating islands', 'a bright fantasy city spread across floating islands in the sky', ['天空城']],
    ['anime-scene-fantasy-guild', '冒险者公会', 'adventurer guild interior', 'anime fantasy adventurer guild hall', 'a warm busy guild hall for fantasy adventurers', ['公会大厅']],
    ['anime-scene-cherry-path', '樱花校园路', 'cherry blossoms, school path', 'anime school path lined with cherry blossoms', 'a school path covered by drifting cherry blossoms', ['樱花路']],
  ]),
  ...animeGroup('场景', '场景细节', [
    ['anime-scene-window-curtains', '风吹白窗帘', 'white curtains, wind', 'sunlit anime window with billowing white curtains', 'white curtains billowing through an open sunlit window', ['白窗帘']],
    ['anime-scene-vending-machine', '夜间自动贩卖机', 'vending machine, night', 'glowing anime vending machine at night', 'a lone vending machine casting colored light into the night', ['贩卖机夜景']],
    ['anime-scene-classroom-after-school', '放学后教室', 'classroom, after school', 'quiet anime classroom after school', 'a quiet classroom after school with warm angled sunlight', ['黄昏教室']],
    ['anime-scene-train-window', '电车窗边', 'train interior, window seat', 'anime train window seat', 'a quiet seat beside a train window with scenery passing outside', ['列车窗边']],
  ]),

  ...animeGroup('光影环境', '光源照明', [
    ['anime-lighting-cel-key', '动画主光', 'anime key light, cel shading', 'clean directional anime key light', 'a clean directional key light designed for cel-shaded forms', ['赛璐璐光影']],
    ['anime-lighting-window-sunset', '橙色窗边夕照', 'sunset window light', 'warm anime sunset window light', 'warm orange sunset light entering through a nearby window', ['夕阳窗光']],
    ['anime-lighting-stage-neon', '偶像舞台灯', 'concert stage lighting', 'colorful anime concert stage lighting', 'layered colorful concert lights focused on the performer', ['舞台灯光']],
    ['anime-lighting-moon-rim', '月光轮廓边', 'moonlight rim light', 'blue anime moonlight rim lighting', 'a cool blue moonlit rim separating the character from the night', ['月光边缘光']],
  ]),
  ...animeGroup('光影环境', '氛围', [
    ['anime-mood-youthful', '青春动画感', 'youthful anime atmosphere', 'bright youthful anime atmosphere', 'a bright youthful atmosphere filled with possibility', ['青春感']],
    ['anime-mood-bittersweet', '淡淡离别感', 'bittersweet atmosphere', 'bittersweet anime farewell atmosphere', 'a restrained bittersweet mood suggesting an approaching farewell', ['离别氛围']],
    ['anime-mood-hotblooded', '热血高燃', 'hot-blooded atmosphere', 'high-energy heroic anime atmosphere', 'a high-energy heroic atmosphere at the peak of action', ['高燃', '热血氛围']],
    ['anime-mood-healing', '治愈日常感', 'iyashikei atmosphere', 'gentle healing anime atmosphere', 'a calm comforting slice-of-life atmosphere', ['治愈系']],
  ]),

  ...animeGroup('特效', '动态表现', [
    ['anime-fx-impact-burst', '漫画冲击爆点', 'impact burst', 'anime impact-burst effect', 'a sharp graphic impact burst at the contact point', ['冲击线']],
    ['anime-fx-motion-smear', '动画运动拉伸', 'motion smear', 'controlled anime motion-smear frame', 'a controlled animation smear that clearly conveys very fast motion', ['拖影帧']],
    ['anime-fx-sakuga-debris', '作画碎石飞散', 'flying debris, impact', 'dynamic anime impact debris', 'small rocks and debris lifting around a forceful anime impact', ['碎石特效']],
  ]),
  ...animeGroup('特效', '镜头视觉', [
    ['anime-fx-eye-glint', '眼神闪光', 'eye glint', 'dramatic anime eye-glint effect', 'a brief sharp glint crossing the character eye', ['眼睛闪光']],
    ['anime-fx-emotion-symbols', '漫画情绪符号', 'manga symbols', 'subtle manga emotion symbols', 'small readable manga-style symbols expressing the character mood', ['汗滴', '青筋']],
    ['anime-fx-screentone', '漫画网点', 'screentone', 'controlled manga screentone overlay', 'a controlled monochrome screentone treatment with clean value separation', ['网点纸']],
    ['anime-fx-petal-overlay', '前景花瓣', 'foreground petals', 'anime foreground petal overlay', 'soft flower petals crossing the foreground at varied depths', ['花瓣飘落']],
  ]),

  ...animeGroup('画风', '视觉风格', [
    ['anime-style-tv-cel', '电视动画赛璐璐', 'anime screencap, cel shading', 'clean television-anime cel illustration', 'a clean television-anime look with crisp cel shading', ['TV动画']],
    ['anime-style-film', '动画电影质感', 'anime movie style', 'cinematic anime-film illustration', 'a cinematic animated-film look with nuanced light and atmosphere', ['动画电影']],
    ['anime-style-painterly', '半厚涂二次元', 'painterly anime style', 'painterly semi-realistic anime illustration', 'a polished anime illustration with soft painterly rendering', ['二次元厚涂']],
    ['anime-style-pastel', '柔彩二次元', 'pastel anime style', 'soft pastel anime illustration', 'a soft anime illustration using a restrained pastel palette', ['清新二次元']],
    ['anime-style-retro-90s', '九十年代动画', '1990s anime style', 'retro 1990s anime aesthetic', 'a retro 1990s animation look with hand-painted cel characters', ['老动画', '复古动漫']],
    ['anime-style-digital-2000s', '千禧年动画', '2000s anime style', 'early-2000s digital anime aesthetic', 'an early-2000s digital anime look with crisp gradients and luminous color', ['千禧动漫']],
    ['anime-style-chibi-polished', '精品Q版插画', 'polished chibi illustration', 'polished chibi anime illustration', 'a polished super-deformed anime illustration with readable details', ['精品Q版']],
    ['anime-style-background-art', '动画背景美术', 'anime background art', 'hand-painted anime background illustration', 'hand-painted animated-film background art', ['动漫场景']],
  ]),
  ...animeGroup('画风', '审美流派', [
    ['anime-aesthetic-shoujo', '少女漫画美学', 'shoujo manga style', 'elegant shoujo-manga aesthetic', 'an elegant shoujo-manga aesthetic with graceful shapes and emotional detail', ['少女漫']],
    ['anime-aesthetic-shounen', '少年漫画美学', 'shounen manga style', 'energetic shounen-manga aesthetic', 'an energetic shounen-manga aesthetic with bold action clarity', ['少年漫']],
    ['anime-aesthetic-seinen', '青年漫画美学', 'seinen manga style', 'mature seinen-manga aesthetic', 'a grounded mature manga aesthetic with restrained dramatic detail', ['青年漫']],
    ['anime-aesthetic-moe', '萌系美学', 'moe style', 'soft appealing moe-anime aesthetic', 'a soft appealing anime aesthetic with rounded shapes and gentle expressions', ['萌系']],
    ['anime-aesthetic-cool', '冷酷潮流二次元', 'cool anime aesthetic', 'graphic fashion-forward anime aesthetic', 'a cool fashion-forward anime aesthetic with confident graphic shapes', ['潮流二次元']],
  ]),
  ...animeGroup('画风', '线面语言', [
    ['anime-line-thin-clean', '极细清线', 'thin lineart', 'very thin clean anime line art', 'very thin and controlled anime line work', ['细线稿']],
    ['anime-line-colored', '彩色线稿', 'colored lineart', 'colored anime line art', 'colored line work harmonized with each filled shape', ['色线']],
    ['anime-line-bold-manga', '粗黑漫画线', 'bold manga lineart', 'bold black manga ink lines', 'bold black ink lines with decisive variation in weight', ['粗线稿']],
    ['anime-line-variable-weight', '粗细变化线稿', 'varied line weight', 'anime line art with varied line weight', 'clean line art whose weight changes to describe depth and emphasis', ['线条粗细变化']],
    ['anime-line-monochrome-ink', '黑白漫画墨线', 'monochrome manga ink', 'monochrome manga ink drawing', 'a finished black-and-white manga drawing with crisp ink contours', ['日漫黑白稿']],
  ]),
  ...animeGroup('画风', '表现技法', [
    ['anime-technique-two-tone-cel', '二阶赛璐璐', 'two-tone cel shading', 'two-tone anime cel shading', 'clean two-tone cel shading with one readable shadow family', ['二分阴影']],
    ['anime-technique-three-tone-cel', '三阶赛璐璐', 'three-tone cel shading', 'three-tone anime cel shading', 'three-level cel shading with controlled light, midtone, and shadow shapes', ['三段阴影']],
    ['anime-technique-soft-cel', '柔边赛璐璐', 'soft cel shading', 'soft-edged anime cel shading', 'anime cel shading softened selectively around skin and atmospheric edges', ['软赛璐璐']],
    ['anime-technique-watercolor-line', '水彩动画插画', 'watercolor anime illustration', 'anime line art with watercolor rendering', 'clean anime line work filled with transparent watercolor washes', ['水彩二次元']],
    ['anime-technique-gouache', '平涂动画海报', 'gouache anime poster', 'flat gouache anime-poster rendering', 'an anime-poster treatment using opaque flat gouache-like color shapes', ['平涂海报']],
  ]),
  ...animeGroup('画风', '商业用途', [
    ['anime-use-light-novel', '轻小说插图', 'light novel illustration', 'professional light-novel illustration', 'a publication-ready illustration for an original light novel', ['轻小说内页']],
    ['anime-use-gacha-card', '二次元卡池立绘', 'gacha card illustration', 'premium anime gacha-card illustration', 'a premium collectible character illustration for an original anime game', ['抽卡立绘']],
    ['anime-use-animation-promo', '动画宣传绘', 'anime promotional illustration', 'official-style anime promotional key art', 'polished promotional key art for an original animated series', ['动画宣发']],
    ['anime-use-character-merch', '角色周边插图', 'character merchandise illustration', 'clean anime character merchandise artwork', 'clean character-focused artwork designed for original merchandise', ['谷子图']],
  ]),

  ...animeGroup('质量渲染', '渲染方式', [
    ['anime-render-skin', '动画皮肤明暗', 'anime skin shading', 'refined anime skin rendering', 'clean stylized skin shading with gentle warm transitions', ['二次元皮肤']],
    ['anime-render-hair', '动画发丝光泽', 'detailed anime hair shading', 'refined layered anime hair rendering', 'layered anime hair rendering with clean grouped strands and highlights', ['二次元头发']],
    ['anime-render-eyes', '动画眼睛精修', 'highly detailed anime eyes', 'highly refined anime eye rendering', 'highly refined layered irises, pupils, reflections, and eyelids', ['二次元眼睛']],
    ['anime-render-background', '角色与背景融合', 'anime compositing', 'cohesive anime character-background compositing', 'cohesive color and light integration between the anime character and background', ['动画合成']],
  ]),
  ...animeGroup('质量渲染', '细节优化', [
    ['anime-quality-face-consistency', '动画脸型一致', 'consistent anime face', 'consistent anime facial design', 'strictly consistent anime facial proportions and feature placement', ['脸型稳定']],
    ['anime-quality-line-color', '线色严密贴合', 'precise line and color alignment', 'precise anime line-to-color registration', 'filled colors aligned precisely beneath every contour line', ['不漏色']],
    ['anime-quality-cel-shadow', '阴影形状干净', 'clean cel shadow shapes', 'clean controlled anime cel-shadow shapes', 'clean purposeful cel-shadow shapes that follow the form', ['阴影干净']],
    ['anime-quality-silhouette', '角色剪影鲜明', 'distinct anime silhouette', 'distinct readable anime character silhouette', 'a distinctive character silhouette readable even at thumbnail size', ['剪影设计']],
  ]),
  ...animeGroup('质量渲染', '交付标准', [
    ['anime-delivery-model-sheet', '动画设定稿级', 'anime model sheet quality', 'production anime model-sheet finish', 'a clean production-ready character model-sheet finish', ['设定稿']],
    ['anime-delivery-key-visual', '动画主视觉级', 'anime key visual quality', 'production anime key-visual finish', 'a polished promotional key visual suitable for an original animation project', ['KV级']],
    ['anime-delivery-manga-print', '漫画印刷稿级', 'manga print quality', 'publication-ready manga print finish', 'a crisp publication-ready black-and-white manga finish', ['漫画成稿']],
  ]),
];
