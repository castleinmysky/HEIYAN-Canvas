export type H3RuleReference = {
  type: string;
  token: string;
  label?: string;
  sourceId?: string;
  port?: string;
  mediaUrl?: string;
  referenceRole?: H3ReferenceRole;
};

export type H3ReferenceRole = 'unassigned' | 'character' | 'prop' | 'story' | 'storyboard' | 'first_frame' | 'last_frame' | 'scene' | 'style' | 'picture' | 'video' | 'audio';

const includesAny = (value: string, words: string[]) => words.some((word) => value.includes(word));

export function classifyH3Reference(reference: H3RuleReference): H3ReferenceRole {
  if (reference.referenceRole && reference.referenceRole !== 'unassigned') return reference.referenceRole;
  if (reference.type === 'video') return 'video';
  if (reference.type === 'audio') return 'audio';
  const value = `${reference.label || ''} ${reference.token || ''} ${reference.port || ''}`.toLowerCase();
  if (includesAny(value, ['首帧', '第一帧', '起始帧', 'first frame', 'first_frame'])) return 'first_frame';
  if (includesAny(value, ['尾帧', '最后帧', '结束帧', 'final frame', 'last frame', 'last_frame'])) return 'last_frame';
  if (includesAny(value, ['分镜', '故事板', 'storyboard', 'shot board'])) return 'storyboard';
  if (includesAny(value, ['剧情', '剧本', '故事信息', '情节', 'story', 'script'])) return 'story';
  if (includesAny(value, ['道具', '武器', '装备', 'prop', 'weapon'])) return 'prop';
  if (includesAny(value, ['风格', '画风', '渲染', 'style', 'render reference'])) return 'style';
  if (includesAny(value, ['场景', '环境设定', '空间设定', 'scene', 'environment'])) return 'scene';
  if (includesAny(value, ['三视图', '四视图', '角色', '人物', 'turnaround', 'character', '正面', '侧面', '背面']) || ['front', 'left', 'right', 'back'].includes(String(reference.port || '').toLowerCase())) return 'character';
  return 'picture';
}

const safeDuration = (value?: number) => Math.min(30, Math.max(5, Math.round(Number(value) || 5)));
const sourceName = (reference: H3RuleReference) => String(reference.label || reference.token || '未命名素材').replace(/[「」\n\r]/g, ' ').trim();
const roleName = (role: H3ReferenceRole) => role === 'unassigned' ? '未指定用途' : role === 'character' ? '主体资产' : role === 'prop' ? '道具设计' : role === 'story' ? '剧情信息' : role === 'storyboard' ? '画面构图' : role === 'first_frame' ? '精确首帧' : role === 'last_frame' ? '精确尾帧' : role === 'scene' ? '场景设定' : role === 'style' ? '视觉风格' : role === 'video' ? '动作/运镜参考' : role === 'audio' ? '声音参考' : '通用画面参考';
const characterGroupKey = (reference: H3RuleReference) => {
  const identity = sourceName(reference).toLowerCase()
    .replace(/严格\s*90\s*度/g, '')
    .replace(/(角色|人物|三视图|四视图|设定图|turnaround|character|正面|正视图|左侧|右侧|侧面|背面|后视图|front|left|right|side|back)/g, '')
    .replace(/[\s_\-—]+/g, ' ')
    .trim();
  return identity ? `name:${identity}` : `source:${reference.sourceId || 'default-character'}`;
};

export function compileH3FullReferencePrompt({ references, direction = '', duration = 5 }: { references: H3RuleReference[]; direction?: string; duration?: number }) {
  // inputReferences 与任务提交共用同一套边排序；这里再排除空节点，使 Picture/Video/Audio 序号与服务器真实收到的媒体完全一致。
  const usable = references.filter((reference) => ['image', 'video', 'audio'].includes(reference.type) && Boolean(reference.mediaUrl));
  const images = usable.filter((reference) => reference.type === 'image');
  const videos = usable.filter((reference) => reference.type === 'video');
  const audios = usable.filter((reference) => reference.type === 'audio');
  const classified = images.map((reference, index) => ({ reference, picture: index + 1, role: reference.referenceRole || 'unassigned' as H3ReferenceRole }));
  const pictureToken = (number: number) => `@${classified[number - 1]?.reference.token || `图片${number}`}`;
  const stablePictureList = (numbers: number[]) => numbers.map(pictureToken).join('、');
  const definitions: string[] = [];
  const retention: string[] = [];
  const subjects: Array<{ number: number; role: 'character' | 'prop' | 'scene' | 'style'; pictures: number[] }> = [];
  let subjectNumber = 1;

  const sequence = [
    ...classified.map((item) => `${pictureToken(item.picture)}「${sourceName(item.reference)}」=${roleName(item.role)}`),
    ...videos.map((reference) => `@${reference.token}「${sourceName(reference)}」=动作/运镜`),
    ...audios.map((reference) => `@${reference.token}「${sourceName(reference)}」=声音`),
  ];
  definitions.push(sequence.length ? `引用顺序：${sequence.join('；')}。` : '当前没有可提交的参考媒体。');

  const characterGroups = new Map<string, number[]>();
  for (const item of classified.filter((candidate) => candidate.role === 'character')) {
    const key = characterGroupKey(item.reference);
    characterGroups.set(key, [...(characterGroups.get(key) || []), item.picture]);
  }
  for (const pictures of characterGroups.values()) subjects.push({ number: subjectNumber++, role: 'character', pictures });
  for (const role of ['prop', 'scene', 'style'] as const) {
    for (const item of classified.filter((candidate) => candidate.role === role)) subjects.push({ number: subjectNumber++, role, pictures: [item.picture] });
  }

  for (const subject of subjects) {
    const pictures = stablePictureList(subject.pictures);
    if (subject.role === 'character') {
      definitions.push(`<Subject ${subject.number}> = ${pictures}：同一主体；锁定身份、造型、结构、比例、材质和固定配色，不继承参考图的姿势、构图与背景。`);
      retention.push(`<Subject ${subject.number}> fully_preserved：主体身份与设计全程一致。`);
    } else if (subject.role === 'prop') {
      definitions.push(`<Subject ${subject.number}> = ${pictures}：道具；锁定造型、材质、比例及与角色的接触关系。`);
      retention.push(`<Subject ${subject.number}> fully_preserved：道具不得变形、复制、换手或穿模。`);
    } else if (subject.role === 'scene') {
      definitions.push(`<Subject ${subject.number}> = ${pictures}：场景；锁定空间结构、材质和关键陈设。`);
      retention.push(`<Subject ${subject.number}> fully_preserved：保持空间连续性。`);
    } else {
      definitions.push(`<Subject ${subject.number}> = ${pictures}：风格；只参考渲染、材质、光照和色彩。`);
      retention.push(`<Subject ${subject.number}> weak_reference：不继承其中的角色、物体和构图。`);
    }
  }

  for (const item of classified.filter((candidate) => ['unassigned', 'story', 'storyboard', 'first_frame', 'last_frame', 'picture'].includes(candidate.role))) {
    if (item.role === 'unassigned') {
      definitions.push(`${pictureToken(item.picture)}：用途未指定；不得推断它属于主体资产、分镜、首尾帧、剧情或风格。`);
      retention.push(`${pictureToken(item.picture)} unassigned：用户指定用途前只作为弱通用参考。`);
    } else if (item.role === 'story') {
      definitions.push(`${pictureToken(item.picture)}：剧情资料；只提取事件、关系和情绪，不锁定角色外观、画风或镜头。`);
      retention.push(`${pictureToken(item.picture)} weak_reference：只保留导演要求采用的剧情信息。`);
    } else if (item.role === 'storyboard') {
      definitions.push(`${pictureToken(item.picture)}：分镜；只锁定景别、机位、摆位、方向与动作意图。`);
      retention.push(`${pictureToken(item.picture)} fully_preserved：保留镜头信息，不复制边框、标注和草稿画风。`);
    } else if (item.role === 'first_frame') {
      definitions.push(`${pictureToken(item.picture)}：精确首帧。`);
      retention.push(`${pictureToken(item.picture)} fully_preserved：从其构图、姿势、机位和物体状态开始。`);
    } else if (item.role === 'last_frame') {
      definitions.push(`${pictureToken(item.picture)}：精确尾帧。`);
      retention.push(`${pictureToken(item.picture)} fully_preserved：结束于其构图、姿势、机位和物体状态。`);
    } else {
      definitions.push(`${pictureToken(item.picture)}：通用参考；仅执行导演明确分配的视觉职责。`);
      retention.push(`${pictureToken(item.picture)} weak_reference：只采用导演文字明确要求的视觉信息，不覆盖主体或画面定义。`);
    }
  }

  videos.forEach((reference) => {
    definitions.push(`@${reference.token} 是动作/运镜参考，不重新定义主体外观。`);
    retention.push(`@${reference.token} weak_reference：只继承动作、镜头和节奏。`);
  });
  audios.forEach((reference) => {
    definitions.push(`@${reference.token} 是声音参考，只执行指定的音色、节奏或原音职责。`);
    retention.push(`@${reference.token} fully_preserved：声音职责保持一致。`);
  });

  const storyboard = classified.find((item) => item.role === 'storyboard')?.picture;
  const firstFrame = classified.find((item) => item.role === 'first_frame')?.picture;
  const lastFrame = classified.find((item) => item.role === 'last_frame')?.picture;
  const primaryCharacter = subjects.find((subject) => subject.role === 'character')?.number;
  const primaryProp = subjects.find((subject) => subject.role === 'prop')?.number;
  const previousBrief = /summary:\n[\s\S]*?导演要求：\s*([^\n]+)/.exec(direction)?.[1]?.trim();
  const authoritativeDirection = previousBrief || direction.trim() || '[请填写一个可观察的主要动作链、动作结果，以及需要的对白或声音。]';
  const opening = firstFrame ? `镜头必须从 ${pictureToken(firstFrame)} 精确开始。` : '先建立清楚的起始姿势、物体状态和空间关系。';
  const storyboardRule = storyboard ? `景别、机位、人物位置和画面方向严格遵循 ${pictureToken(storyboard)}。` : '景别和构图服从导演文字要求。';
  const characterRule = primaryCharacter ? `<Subject ${primaryCharacter}> 全程保持已定义的主体身份、造型、结构、比例、材质和固定配色。` : '';
  const propRule = primaryProp ? `<Subject ${primaryProp}> 全程保持准确设计、比例和符合物理的手部/身体接触。` : '';
  const ending = lastFrame ? `动作连续收束到 ${pictureToken(lastFrame)}，最终姿势、道具状态、构图、机位、光照和空间关系必须准确匹配该尾帧。` : '动作自然减速并停在稳定、符合物理的最终姿势，头发、服装和配件完成滞后运动。';

  return `subject_definitions:\n${definitions.join('\n')}\n\nsummary:\n[全参考生成，${safeDuration(duration)} 秒] 导演要求：${authoritativeDirection}\n\nretention_analysis:\n${retention.length ? retention.join('\n') : '无参考媒体。'}\n素材各司其职，不得互相覆盖。\n\ndetailed_description:\n[Shot 1] ${opening}${storyboardRule}${characterRule}${propRule} 按 summary 完成一条连续、可见、符合物理的动作链，只使用一个明确的主要运镜；保持主体身份、物体接触、空间和光照连续。禁止复制三视图排版、分镜边框、箭头、字幕、标注与参考线。${ending}\n\noverall_soundscape:\n声音与画面动作同步。${audios.length ? ` ${audios.map((reference) => `@${reference.token}`).join('、')} 按定义使用。` : ''}\n\nnon_diegetic_music:\nN/A`;
}
