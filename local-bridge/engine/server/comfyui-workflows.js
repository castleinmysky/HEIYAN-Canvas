function preciseIdentityWorkflow(prefix, method, faceDetailer = false) {
  const methodName = method === 'pulid' ? 'PuLID' : 'InstantID';
  return Object.freeze({
    id: `${prefix}-${method}${faceDetailer ? '-face-detail' : ''}-v1`,
    name: `${methodName} 精准身份${faceDetailer ? '＋面部精修' : '锁定'}`,
    purposes: Object.freeze(faceDetailer ? ['identity', 'final-quality'] : ['identity']),
    purposePriority: Object.freeze(faceDetailer ? { identity: 100, 'final-quality': 110 } : { identity: method === 'instantid' ? 110 : 105 }),
    modePresentation: Object.freeze({
      title: faceDetailer ? '精准身份＋面部精修' : '精准身份锁定',
      description: `${methodName} 提取人脸身份特征${faceDetailer ? '，并在出图后自动精修面部' : '并约束生成角色外观'}`,
      note: '仅适配 SDXL / Illustrious；角色外观图必接',
    }),
    capability: 'image',
    editor: 'managed',
    identityMethod: method,
    identityPrecision: 'precise',
    faceDetailer,
    inputPorts: Object.freeze([
      Object.freeze({ id: 'input', label: '提示词', accepts: Object.freeze(['text']), multiple: true }),
      Object.freeze({ id: 'identity', label: '角色外观', accepts: Object.freeze(['image']), required: true, minImages: 1, maxImages: 1, bindingRole: 'character', bindingMethod: method, preparation: 'fit' }),
    ]),
    controlDefaults: Object.freeze({ identityStrength: method === 'pulid' ? 0.9 : 0.8 }),
    appearanceControl: Object.freeze({
      mode: 'identity', precision: 'precise', method,
      label: `精准身份锁定 · ${methodName}`,
      detail: `${methodName} 使用专用人脸身份编码与 SDXL 兼容模型路径，角色外观图必须连接后才可运行。`,
    }),
    ...(faceDetailer ? { detailEnhancement: Object.freeze({ mode: 'face-detailer', label: '面部细节精修', detail: '使用 face_yolov8m 检测面部，并以低重绘强度进行局部精修。' }) } : {}),
  });
}

const workflowByAdapter = Object.freeze({
  'comfyui-sdxl': Object.freeze([
    Object.freeze({
      id: 'sdxl-image-v1',
      name: 'SDXL 美宣基础生图',
      purposes: Object.freeze(['draft', 'character']),
      purposePriority: Object.freeze({ draft: 55, character: 70 }),
      modePresentation: Object.freeze({ title: '自由生成', description: '文生图或普通参考图重绘', note: '不锁定人体骨架' }),
      capability: 'image',
      templateFile: 'SDXL_Meixuan_Base.json',
      inputPorts: Object.freeze([
        Object.freeze({ id: 'input', label: '主参考图', accepts: Object.freeze(['text', 'image']), multiple: true, maxImages: 1, bindingRole: 'composition', bindingMethod: 'image-to-image', preparation: 'fit' }),
      ]),
      poseControl: Object.freeze({ mode: 'guided', label: '近似参考', detail: '参考图会影响构图和动作，但不会严格锁定人体骨架。' }),
      loraSlots: Object.freeze([
        Object.freeze({ id: 'character', label: '人物刻画 LoRA' }),
      ]),
    }),
    Object.freeze({
      id: 'sdxl-highres-refine-v1',
      name: 'SDXL 高清二次精修',
      purposes: Object.freeze(['final-quality']),
      purposePriority: Object.freeze({ 'final-quality': 95 }),
      qualityProfile: Object.freeze({ mode: 'high-res-refine', maxIntermediateEdge: 2048, refineDenoise: 0.25 }),
      modePresentation: Object.freeze({ title: '高清定稿', description: '先基础采样，再以低重绘强度精修并精确输出 2K/4K', note: '保持原比例，不裁切、不拉伸' }),
      capability: 'image',
      templateFile: 'SDXL_Meixuan_Base.json',
      inputPorts: Object.freeze([
        Object.freeze({ id: 'input', label: '主参考图', accepts: Object.freeze(['text', 'image']), multiple: true, maxImages: 1, bindingRole: 'composition', bindingMethod: 'image-to-image', preparation: 'fit' }),
      ]),
      poseControl: Object.freeze({ mode: 'guided', label: '近似参考', detail: '参考图会影响构图和动作，但不会严格锁定人体骨架。' }),
      loraSlots: Object.freeze([
        Object.freeze({ id: 'character', label: '人物刻画 LoRA' }),
      ]),
    }),
    preciseIdentityWorkflow('sdxl', 'instantid'),
    preciseIdentityWorkflow('sdxl', 'pulid'),
    preciseIdentityWorkflow('sdxl', 'instantid', true),
    Object.freeze({
      id: 'sdxl-pose-v1',
      name: 'SDXL 动作姿势控制',
      purposes: Object.freeze(['pose']),
      purposePriority: Object.freeze({ pose: 100 }),
      modePresentation: Object.freeze({ title: '姿势控制', description: '按识别到的人体骨架约束动作', note: '四肢清晰、无遮挡时最稳定' }),
      capability: 'image',
      editor: 'managed',
      inputPorts: Object.freeze([
        Object.freeze({ id: 'input', label: '提示词', accepts: Object.freeze(['text']), multiple: true }),
        Object.freeze({ id: 'pose', label: '动作姿势', accepts: Object.freeze(['image']), required: true, minImages: 1, maxImages: 1, bindingRole: 'pose', bindingMethod: 'controlnet-pose', preparation: 'pose' }),
      ]),
      controlDefaults: Object.freeze({ poseStrength: 0.85 }),
      poseControl: Object.freeze({ mode: 'exact', label: '骨架控制', detail: '自动提取参考图骨架，并通过 OpenPose ControlNet 约束人物姿势；识别结果会受遮挡和肢体交叉影响。' }),
      loraSlots: Object.freeze([
        Object.freeze({ id: 'character', label: '人物刻画 LoRA' }),
      ]),
    }),
    Object.freeze({
      id: 'sdxl-character-consistency-v1',
      name: 'SDXL 角色一致性',
      purposes: Object.freeze(['identity']),
      purposePriority: Object.freeze({ identity: 60 }),
      modePresentation: Object.freeze({ title: '角色一致性', description: '角色外观与动作姿势分别控制', note: '角色外观必接，使用 SDXL IPAdapter' }),
      capability: 'image',
      editor: 'managed',
      inputPorts: Object.freeze([
        Object.freeze({ id: 'input', label: '提示词', accepts: Object.freeze(['text']), multiple: true }),
        Object.freeze({ id: 'identity', label: '角色外观', accepts: Object.freeze(['image']), required: true, minImages: 1, maxImages: 1, bindingRole: 'character', bindingMethod: 'ipadapter', preparation: 'fit' }),
        Object.freeze({ id: 'pose', label: '动作姿势', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'pose', bindingMethod: 'controlnet-pose', preparation: 'pose' }),
      ]),
      controlDefaults: Object.freeze({ identityStrength: 0.75, poseStrength: 0.85 }),
      appearanceControl: Object.freeze({ mode: 'identity', precision: 'approximate', method: 'ipadapter', label: '近似身份保持 · IPAdapter', detail: '角色图通过 SDXL IPAdapter 近似保持脸型、发型、服装与配色；不等同于专用身份锁定。' }),
      poseControl: Object.freeze({ mode: 'exact', label: '骨架控制', detail: '动作姿势图会单独提取骨架，并通过 OpenPose ControlNet 约束人物动作。' }),
      loraSlots: Object.freeze([
        Object.freeze({ id: 'character', label: '人物刻画 LoRA' }),
      ]),
    }),
  ]),
  'comfyui-illustrious': Object.freeze([
    Object.freeze({
      id: 'illustrious-character-v1',
      name: '高品质角色立绘',
      purposes: Object.freeze(['character']),
      purposePriority: Object.freeze({ character: 100 }),
      modePresentation: Object.freeze({ title: '角色立绘', description: '角色设计与普通参考图重绘', note: '不锁定人体骨架' }),
      capability: 'image',
      templateFile: 'ILXL_Game_Character_Base.json',
      inputPorts: Object.freeze([
        Object.freeze({ id: 'input', label: '主参考图', accepts: Object.freeze(['text', 'image']), multiple: true, maxImages: 1, bindingRole: 'composition', bindingMethod: 'image-to-image', preparation: 'fit' }),
      ]),
      poseControl: Object.freeze({ mode: 'guided', label: '近似参考', detail: '参考图会影响构图和动作；需要严格骨架时请切换到多路控制综合定稿。' }),
    }),
    Object.freeze({
      id: 'illustrious-highres-refine-v1',
      name: 'Illustrious 高清二次精修',
      purposes: Object.freeze(['final-quality']),
      purposePriority: Object.freeze({ 'final-quality': 100 }),
      qualityProfile: Object.freeze({ mode: 'high-res-refine', maxIntermediateEdge: 2048, refineDenoise: 0.25 }),
      modePresentation: Object.freeze({ title: '高清定稿', description: '先角色采样，再以低重绘强度精修并精确输出 2K/4K', note: '保持原比例，不裁切、不拉伸' }),
      capability: 'image',
      templateFile: 'ILXL_Game_Character_Base.json',
      inputPorts: Object.freeze([
        Object.freeze({ id: 'input', label: '主参考图', accepts: Object.freeze(['text', 'image']), multiple: true, maxImages: 1, bindingRole: 'composition', bindingMethod: 'image-to-image', preparation: 'fit' }),
      ]),
      poseControl: Object.freeze({ mode: 'guided', label: '近似参考', detail: '参考图会影响构图和动作；需要严格骨架时请切换到多路控制综合定稿。' }),
    }),
    preciseIdentityWorkflow('illustrious', 'instantid'),
    preciseIdentityWorkflow('illustrious', 'pulid'),
    preciseIdentityWorkflow('illustrious', 'instantid', true),
    Object.freeze({
      id: 'illustrious-character-final-v1',
      name: '多路控制综合定稿',
      purposes: Object.freeze(['pose', 'identity']),
      purposePriority: Object.freeze({ pose: 90, identity: 60 }),
      modePresentation: Object.freeze({ title: '角色一致性', description: '角色外观、比例、姿势和线稿分别控制', note: '接入角色图后使用 SDXL IPAdapter' }),
      capability: 'image',
      editor: 'managed',
      inputPorts: Object.freeze([
        Object.freeze({ id: 'input', label: '提示词', accepts: Object.freeze(['text']), multiple: true }),
        Object.freeze({ id: 'identity', label: '角色外观', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'character', bindingMethod: 'ipadapter', preparation: 'fit' }),
        Object.freeze({ id: 'proportion', label: '头身比例', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'proportion', bindingMethod: 'ipadapter', preparation: 'fit' }),
        Object.freeze({ id: 'pose', label: '动作姿势', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'pose', bindingMethod: 'controlnet-pose', preparation: 'pose' }),
        Object.freeze({ id: 'lineart', label: '线稿上色', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'lineart', bindingMethod: 'controlnet-lineart', preparation: 'lineart' }),
      ]),
      controlDefaults: Object.freeze({
        identityStrength: 0.75,
        proportionStrength: 0.45,
        poseStrength: 0.85,
        lineartStrength: 0.7,
      }),
      appearanceControl: Object.freeze({ mode: 'identity', precision: 'approximate', method: 'ipadapter', label: '近似身份保持 · IPAdapter', detail: '角色图通过 SDXL IPAdapter 近似保持脸型、发型、服装与配色；不等同于专用身份锁定。' }),
      poseControl: Object.freeze({ mode: 'exact', label: '骨架控制', detail: '自动提取参考图骨架，并通过 OpenPose ControlNet 约束人物姿势；识别结果会受遮挡和肢体交叉影响。' }),
      loraSlots: Object.freeze([
        Object.freeze({ id: 'character', label: '角色 LoRA' }),
        Object.freeze({ id: 'style', label: '画风 LoRA' }),
        Object.freeze({ id: 'object', label: '物件 LoRA' }),
      ]),
    }),
  ]),
  'comfyui-minimax-h3': Object.freeze([
    Object.freeze({
      id: 'minimax-h3-video-v1',
      name: '本地 H3 视频',
      capability: 'video',
      templateFile: 'MiniMax_H3_Image_to_Video_Audio_FIXED_STARLIGHT26.json',
    }),
  ]),
});

const nativeWorkflowByFamily = Object.freeze({
  'flux2-klein': Object.freeze({
    id: 'flux2-klein-t2i-v1', name: 'FLUX.2 Klein 基础生图', capability: 'image', templateFile: 'FLUX2_Klein_4B_Base.json',
    purposes: Object.freeze(['draft', 'pose']), purposePriority: Object.freeze({ draft: 75, pose: 55 }),
    inputPorts: Object.freeze([
      Object.freeze({ id: 'input', label: '提示词', accepts: Object.freeze(['text']), multiple: true }),
      Object.freeze({ id: 'reference', label: '画面参考', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'composition', bindingMethod: 'reference-latent', preparation: 'fit' }),
      Object.freeze({ id: 'pose', label: '动作姿势', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'pose', bindingMethod: 'reference-latent', preparation: 'pose' }),
    ]),
    controlDefaults: Object.freeze({ poseStrength: 0.85 }),
    poseControl: Object.freeze({ mode: 'guided', label: '骨架引导', detail: '骨架图通过 FLUX.2 原生 ReferenceLatent 参与构图，能明显引导动作，但不承诺逐关节锁定。' }),
  }),
  'qwen-image': Object.freeze({
    id: 'qwen-image-t2i-v1', name: 'Qwen Image 基础生图', capability: 'image', templateFile: 'Qwen_Image_Base.json',
    purposes: Object.freeze(['character', 'final-quality']), purposePriority: Object.freeze({ character: 72, 'final-quality': 76 }),
    modePresentation: Object.freeze({ title: '直接画', description: '输入文字，选择画风后生成图片' }),
    inputPorts: Object.freeze([
      Object.freeze({ id: 'input', label: '文本', accepts: Object.freeze(['text']), multiple: true }),
    ]),
    loraSlots: Object.freeze([
      Object.freeze({ id: 'style', label: '画风' }),
    ]),
  }),
  'qwen-image-edit-2511': Object.freeze({
    id: 'qwen-image-edit-2511-v1', name: 'Qwen Image Edit 2511', capability: 'image', templateFile: 'Qwen_Image_Edit_2511_Base.json',
    purposes: Object.freeze(['edit', 'identity', 'pose']), purposePriority: Object.freeze({ edit: 100, identity: 75, pose: 60 }),
    modePresentation: Object.freeze({ title: '角色一致性编辑', description: '保留原角色并修改动作或画面', note: '角色外观必接，属于参考图编辑' }),
    inputPorts: Object.freeze([
      Object.freeze({ id: 'input', label: '编辑指令', accepts: Object.freeze(['text']), multiple: true }),
      Object.freeze({ id: 'reference', label: '角色外观', accepts: Object.freeze(['image']), required: true, minImages: 1, maxImages: 1, bindingRole: 'character', bindingMethod: 'native-multimodal', preparation: 'fit' }),
      Object.freeze({ id: 'pose', label: '动作姿势', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'pose', bindingMethod: 'native-multimodal', preparation: 'pose' }),
    ]),
    controlDefaults: Object.freeze({ poseStrength: 0.85 }),
    appearanceControl: Object.freeze({ mode: 'reference', precision: 'approximate', method: 'reference', label: '近似参考保持', detail: '以角色原图作为编辑起点；降低重绘强度会更接近原角色，但不等同于专用身份编码器。' }),
    poseControl: Object.freeze({ mode: 'guided', label: '双图姿势引导', detail: '角色外观作为图 1，骨架图作为图 2，由 Qwen 编辑模型同时保持人物并引导动作；不会严格锁定每个关节。' }),
  }),
  'hidream-i1-full': Object.freeze({
    id: 'hidream-i1-full-t2i-v1', name: 'HiDream-I1 Full 基础生图', capability: 'image', templateFile: 'HiDream_I1_Full_Base.json',
    purposes: Object.freeze(['final-quality', 'pose']), purposePriority: Object.freeze({ 'final-quality': 80, pose: 45 }),
    inputPorts: Object.freeze([
      Object.freeze({ id: 'input', label: '提示词', accepts: Object.freeze(['text']), multiple: true }),
      Object.freeze({ id: 'reference', label: '画面参考', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'composition', bindingMethod: 'image-to-image', preparation: 'fit' }),
      Object.freeze({ id: 'pose', label: '动作姿势', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'pose', bindingMethod: 'latent-guide', preparation: 'pose' }),
    ]),
    controlDefaults: Object.freeze({ poseStrength: 0.85 }),
    poseControl: Object.freeze({ mode: 'guided', label: '骨架重绘引导', detail: '骨架图会作为 HiDream 的初始结构进行重绘；动作通常接近参考，但不是专用 ControlNet。' }),
  }),
  'newbie-image-exp01': Object.freeze({
    id: 'newbie-image-exp01-t2i-v1', name: 'NewBie Image Exp0.1', capability: 'image', templateFile: 'NewBie_Image_Exp01_Base.json',
    purposes: Object.freeze(['character', 'pose']), purposePriority: Object.freeze({ character: 80, pose: 40 }),
    inputPorts: Object.freeze([
      Object.freeze({ id: 'input', label: '提示词', accepts: Object.freeze(['text']), multiple: true }),
      Object.freeze({ id: 'reference', label: '画面参考', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'composition', bindingMethod: 'image-to-image', preparation: 'fit' }),
      Object.freeze({ id: 'pose', label: '动作姿势', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'pose', bindingMethod: 'latent-guide', preparation: 'pose' }),
    ]),
    controlDefaults: Object.freeze({ poseStrength: 0.85 }),
    poseControl: Object.freeze({ mode: 'guided', label: '骨架重绘引导', detail: '骨架图会作为 NewBie 的初始结构进行重绘；属于研究模型的近似引导，不是严格控制。' }),
  }),
  'krea2-turbo': Object.freeze({
    id: 'krea2-turbo-t2i-v1', name: 'Krea 2 Turbo 基础生图', capability: 'image', templateFile: 'Krea2_Turbo_Base.json',
    purposes: Object.freeze(['draft', 'pose']), purposePriority: Object.freeze({ draft: 100, pose: 35 }),
    inputPorts: Object.freeze([
      Object.freeze({ id: 'input', label: '提示词', accepts: Object.freeze(['text']), multiple: true }),
      Object.freeze({ id: 'reference', label: '画面参考', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'composition', bindingMethod: 'image-to-image', preparation: 'fit' }),
      Object.freeze({ id: 'pose', label: '动作姿势', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'pose', bindingMethod: 'latent-guide', preparation: 'pose' }),
    ]),
    controlDefaults: Object.freeze({ poseStrength: 0.85 }),
    poseControl: Object.freeze({ mode: 'guided', label: '骨架重绘引导', detail: '骨架图会作为 Krea 2 的初始结构进行重绘；速度优先，姿势精度低于专用 ControlNet。' }),
  }),
  'z-image-turbo': Object.freeze({
    id: 'z-image-turbo-t2i-v1', name: 'Z-Image Turbo 基础生图', capability: 'image', templateFile: 'Z_Image_Turbo_Base.json',
    purposes: Object.freeze(['draft', 'pose']), purposePriority: Object.freeze({ draft: 90, pose: 95 }),
    inputPorts: Object.freeze([
      Object.freeze({ id: 'input', label: '提示词', accepts: Object.freeze(['text']), multiple: true }),
      Object.freeze({ id: 'reference', label: '画面参考', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'composition', bindingMethod: 'image-to-image', preparation: 'fit' }),
      Object.freeze({ id: 'pose', label: '动作姿势', accepts: Object.freeze(['image']), maxImages: 1, bindingRole: 'pose', bindingMethod: 'controlnet-pose', preparation: 'pose' }),
    ]),
    controlDefaults: Object.freeze({ poseStrength: 0.85 }),
    poseControl: Object.freeze({ mode: 'exact', label: 'Z-Image 骨架控制', detail: '自动提取骨架，并通过 Z-Image Turbo 专用 Fun ControlNet 约束人物姿势。' }),
  }),
  'anima-base-v1': Object.freeze([
    Object.freeze({
      id: 'anima-base-v1-t2i-v1',
      name: 'Anima Base v1 基础生图',
      purposes: Object.freeze(['draft', 'character']),
      purposePriority: Object.freeze({ draft: 65, character: 75 }),
      capability: 'image',
      templateFile: 'Anima_Base_v1_T2I.json',
      modePresentation: Object.freeze({ title: '基础生图', description: '二次元角色与非写实插画生成', note: '适合 512–1536 像素画幅' }),
      inputPorts: Object.freeze([
        Object.freeze({ id: 'input', label: '提示词', accepts: Object.freeze(['text']), multiple: true }),
      ]),
    }),
    Object.freeze({
      id: 'anima-base-v1-inpaint-v1',
      name: 'Anima LLLite 局部重绘',
      purposes: Object.freeze(['edit', 'inpaint']),
      purposePriority: Object.freeze({ edit: 85, inpaint: 100 }),
      capability: 'image',
      templateFile: 'Anima_Base_v1_Inpaint.json',
      modePresentation: Object.freeze({ title: '局部重绘', description: '换装、脱装备与手脚局部修复', note: '白色区域重绘，黑色区域保留' }),
      inputPorts: Object.freeze([
        Object.freeze({ id: 'input', label: '提示词', accepts: Object.freeze(['text']), multiple: true }),
        Object.freeze({ id: 'reference', label: '原图', accepts: Object.freeze(['image']), required: true, minImages: 1, maxImages: 1, bindingRole: 'character', bindingMethod: 'inpaint-source', preparation: 'fit' }),
        Object.freeze({ id: 'mask', label: '重绘蒙版', accepts: Object.freeze(['image']), required: true, minImages: 1, maxImages: 1, bindingRole: 'mask', bindingMethod: 'inpaint-mask', preparation: 'mask' }),
      ]),
      appearanceControl: Object.freeze({ mode: 'reference', label: '蒙版外保持', detail: '原图作为编辑起点；白色蒙版内重新生成，黑色蒙版外尽量保持原图。' }),
    }),
  ]),
});

function definitionsForModel(model) {
  if (String(model?.adapter || '') === 'comfyui-native-image') {
    const definition = nativeWorkflowByFamily[String(model?.config?.family || '')];
    return Array.isArray(definition) ? definition : definition ? [definition] : [];
  }
  const definitions = workflowByAdapter[String(model?.adapter || '')] || [];
  if (model?.config?.managed !== true) return definitions;
  const allowed = Array.isArray(model?.config?.allowedWorkflowIds) ? model.config.allowedWorkflowIds : [];
  return definitions.filter((definition) => allowed.includes(definition.id));
}

const DEFAULT_ADVANCED_SAMPLING_CONTROLS = Object.freeze(['steps', 'cfg', 'sampler', 'scheduler']);

function samplingControlsFor(definition, model) {
  if (definition?.samplingControls) return definition.samplingControls;
  if (definition?.capability !== 'image') return null;
  const adapter = String(model?.adapter || '');
  const family = String(model?.config?.family || '');
  const advanced = family === 'flux2-klein'
    ? DEFAULT_ADVANCED_SAMPLING_CONTROLS.filter((field) => field !== 'scheduler')
    : [...DEFAULT_ADVANCED_SAMPLING_CONTROLS];
  const variationPort = definition?.inputPorts?.find((port) => port.accepts?.includes('image')
    && ['image-to-image', 'native-multimodal', 'inpaint-source'].includes(String(port.bindingMethod || '')));
  if (!variationPort) return Object.freeze({ advanced: Object.freeze(advanced) });
  const requiresImagePort = variationPort.id;
  const configuredDefault = Number(model?.config?.referenceDenoise);
  const defaultValue = Number.isFinite(configuredDefault)
    ? Math.max(0.05, Math.min(1, configuredDefault))
    : 0.72;
  return Object.freeze({
    advanced: Object.freeze(advanced),
    variation: Object.freeze({ field: 'referenceDenoise', requiresImagePort, defaultValue }),
  });
}

function publicDefinition(definition, model) {
  const { templateFile: _templateFile, inputPorts, controlDefaults, appearanceControl, poseControl, modePresentation, loraSlots, purposes, purposePriority, qualityProfile, detailEnhancement, samplingControls: _samplingControls, ...definitionFields } = definition;
  const samplingControls = samplingControlsFor(definition, model);
  return {
    ...definitionFields,
    ...(inputPorts?.length ? { inputPorts: inputPorts.map((port) => ({ ...port, accepts: [...port.accepts] })) } : {}),
    ...(controlDefaults ? { controlDefaults: { ...controlDefaults } } : {}),
    ...(appearanceControl ? { appearanceControl: { ...appearanceControl } } : {}),
    ...(poseControl ? { poseControl: { ...poseControl } } : {}),
    ...(modePresentation ? { modePresentation: { ...modePresentation } } : {}),
    ...(loraSlots?.length ? { loraSlots: loraSlots.map((slot) => ({ ...slot })) } : {}),
    ...(purposes?.length ? { purposes: [...purposes] } : {}),
    ...(purposePriority ? { purposePriority: { ...purposePriority } } : {}),
    ...(qualityProfile ? { qualityProfile: { ...qualityProfile } } : {}),
    ...(detailEnhancement ? { detailEnhancement: { ...detailEnhancement } } : {}),
    ...(samplingControls ? {
      samplingControls: {
        advanced: [...samplingControls.advanced],
        ...(samplingControls.variation ? { variation: { ...samplingControls.variation } } : {}),
      },
    } : {}),
    modelId: String(model?.id || ''),
    modelName: String(model?.name || definition.name),
    editor: definition.editor === 'managed' ? 'managed' : 'native',
  };
}

export function comfyUiWorkflowsForModel(model) {
  return definitionsForModel(model)
    .filter((definition) => definition.capability === model?.capability)
    .map((definition) => publicDefinition(definition, model));
}

export function comfyUiWorkflowForModel(model, workflowId = '') {
  const definitions = definitionsForModel(model).filter((definition) => definition.capability === model?.capability);
  const requestedId = String(workflowId || '').trim();
  const definition = requestedId
    ? definitions.find((item) => item.id === requestedId) || (model?.config?.managed === true ? null : definitions[0])
    : definitions[0];
  return definition ? publicDefinition(definition, model) : null;
}

export function explicitComfyUiWorkflowForModel(model, workflowId = '') {
  const requestedId = String(workflowId || '').trim();
  if (!requestedId) return null;
  const definition = definitionsForModel(model)
    .filter((item) => item.capability === model?.capability)
    .find((item) => item.id === requestedId);
  return definition ? publicDefinition(definition, model) : null;
}

export function comfyUiWorkflowTemplateForModel(model, workflowId = '') {
  const definitions = definitionsForModel(model).filter((definition) => definition.capability === model?.capability);
  const requestedId = String(workflowId || '').trim();
  const definition = requestedId
    ? definitions.find((item) => item.id === requestedId) || (model?.config?.managed === true ? null : definitions[0])
    : definitions[0];
  return definition?.templateFile || null;
}

export function isComfyUiWorkflowModel(model) {
  return comfyUiWorkflowsForModel(model).length > 0;
}
