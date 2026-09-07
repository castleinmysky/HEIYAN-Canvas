import { promptTokens } from './prompt-token-library';

export type CanvasInterfaceLanguage = 'zh' | 'en';

export const managedComfyInterfaceCopy = (language: CanvasInterfaceLanguage) => language === 'en' ? {
  title: 'Managed ComfyUI',
  description: 'Connects only to the verified HEIYAN private bundle on this device.',
  states: {
    'not-installed': 'Private bundle not detected', installed: 'Private bundle ready to connect',
    starting: 'Managed runtime is starting', connected: 'Managed runtime connected',
    'repair-required': 'Private bundle requires repair',
  },
  details: {
    'not-installed': 'Run the private installer once when it is available, then recheck here.',
    installed: 'The verified bundle is installed. Connecting makes its capabilities available on the canvas.',
    starting: 'Waiting for the fixed local runtime to become ready.',
    connected: 'Verified local capabilities are available on the canvas.',
    'repair-required': 'Quick verification found a managed bundle integrity or configuration issue.',
  },
  actions: { recheck: 'Recheck', connect: 'Connect', starting: 'Starting…', disconnect: 'Disconnect', verify: 'Quick verify' },
  preview: 'First-run preview', previewLabel: 'Simulation only — no system changes', previewNext: 'Next state', previewExit: 'Exit preview',
  bundle: 'Bundle', capabilities: 'capabilities',
  loading: 'Checking managed ComfyUI…', success: 'Managed ComfyUI state updated.',
  errors: {
    protocol_error: 'The managed service returned an incompatible response.',
    invalid_response: 'The managed service returned unreadable data.',
    network_error: 'The managed service could not be reached.',
    aborted: 'The request was cancelled.',
    poll_timeout: 'The managed runtime did not become ready in time.',
    managed_action_conflict: 'The managed action is unavailable in the current service state.',
  },
  cardLabel: 'Managed ComfyUI connection', previewCardLabel: 'Managed ComfyUI first-run simulation',
} : {
  title: '托管 ComfyUI',
  description: '仅连接这台设备上经过验证的黑岩私有套件。',
  states: {
    'not-installed': '未检测到私有套件', installed: '私有套件可连接', starting: '托管运行时正在启动', connected: '托管运行时已连接', 'repair-required': '私有套件需要修复',
  },
  details: {
    'not-installed': '私有安装器可用后，请先运行一次，再回到这里重新检查。',
    installed: '已安装经过验证的套件；连接后，相应能力才会出现在画布。',
    starting: '正在等待固定的本地运行时就绪。', connected: '经过验证的本地能力已在画布中可用。',
    'repair-required': '快速验证发现托管套件的完整性或配置存在问题。',
  },
  actions: { recheck: '重新检查', connect: '连接', starting: '启动中…', disconnect: '断开连接', verify: '快速验证' },
  preview: '首次使用预览', previewLabel: '仅为模拟，不会更改系统', previewNext: '下一状态', previewExit: '退出预览',
  bundle: '套件', capabilities: '项能力', loading: '正在检查托管 ComfyUI…', success: '托管 ComfyUI 状态已更新。',
  errors: {
    protocol_error: '托管服务返回了不兼容的响应。', invalid_response: '托管服务返回了无法读取的数据。', network_error: '无法连接托管服务。',
    aborted: '请求已取消。', poll_timeout: '托管运行时未能及时就绪。', managed_action_conflict: '当前服务状态无法执行此托管操作。',
  },
  cardLabel: '托管 ComfyUI 连接', previewCardLabel: '托管 ComfyUI 首次使用模拟',
};


export const generationHistoryInterfaceCopy = (language: CanvasInterfaceLanguage) => language === 'en' ? {
  title: 'Generation history', open: 'Open generation history', close: 'Close generation history', types: 'Generation history types',
  image: 'Images', video: 'Videos', audio: 'Audio', model: '3D', generated: 'Generated result', local: 'Local generation',
  select: 'Batch select', done: 'Done selecting', clear: 'Clear all history', remove: 'Remove from history', removeSelected: 'Remove selected',
  removeTitle: 'Remove these history entries?', clearTitle: 'Clear this task’s generation history?',
  historyWarning: 'Only history entries are removed. Generated files and media already used on the canvas are kept.',
  confirm: 'Confirm removal', cancel: 'Cancel', removing: 'Removing…', loading: 'Loading…', refresh: 'Refresh',
  loadingTitle: 'Loading generation history', loadingHint: 'Completed, saved outputs only', failed: 'Generation history could not be loaded',
  retry: 'Try again', empty: 'No generation history yet', emptyHint: 'New results will appear here after generation.',
  add: 'Add to canvas', download: 'Download', downloadOriginal: 'Download original', selectAll: 'Select this tab', selected: 'selected', items: 'items',
  preview: 'Preview', closePreview: 'Close preview', playAudio: 'Play generated audio', audioResult: 'Generated audio', modelFile: '3D model file',
  noPrompt: 'No prompt summary was saved for this result.', today: 'Today', yesterday: 'Yesterday', unknownDate: 'Unknown date', loadError: 'Could not load generation history.', removeError: 'Could not remove history.',
  cleanupTitle: 'Clear generated results', cleanupHint: 'Permanently delete app-generated files and their history.',
  cleanupWarning: 'This permanently deletes app-generated files and generation history. Canvas references to these media will stop working. Imported originals, settings and models are kept.',
  cleanupAcknowledgement: 'I understand that these generated files cannot be restored.',
  cleanupConfirm: 'Permanently delete generated results', cleanupWorking: 'Deleting generated results…',
  cleanupSuccess: 'Generated results and history were cleared.', cleanupPartial: 'Some files could not be deleted. Their history was kept. Review the result and retry.',
  cleanupError: 'Generated results could not be cleared.', cleanupRetained: 'Unreferenced items were kept:', files: 'files',
} : {
  title: '生成历史', open: '打开生成历史', close: '关闭生成历史', types: '生成历史类型',
  image: '图片', video: '视频', audio: '音频', model: '3D', generated: '生成结果', local: '本机生成记录',
  select: '批量选择', done: '完成选择', clear: '清空全部历史', remove: '从历史移除', removeSelected: '移除所选',
  removeTitle: '移除所选生成历史？', clearTitle: '清空当前任务的生成历史？',
  historyWarning: '仅移除历史记录，生成文件和画布中已使用的媒体都会保留。',
  confirm: '确认移除', cancel: '取消', removing: '正在移除…', loading: '同步中', refresh: '刷新',
  loadingTitle: '正在读取生成历史', loadingHint: '只读取已完成并保存的输出', failed: '生成历史没有载入',
  retry: '重新读取', empty: '暂无生成历史', emptyHint: '成功生成后，结果会自动出现在这里。',
  add: '放入画布', download: '下载', downloadOriginal: '下载原文件', selectAll: '全选本页', selected: '已选择', items: '项',
  preview: '预览', closePreview: '关闭预览', playAudio: '播放生成音频', audioResult: '音频生成结果', modelFile: '3D 模型文件',
  noPrompt: '该生成记录没有保存提示词摘要。', today: '今天', yesterday: '昨天', unknownDate: '日期未知', loadError: '生成历史读取失败', removeError: '历史记录移除失败',
  cleanupTitle: '清理生成结果', cleanupHint: '永久删除应用生成的文件及其历史记录。',
  cleanupWarning: '此操作会永久删除应用生成的文件和生成历史，画布中引用这些媒体的位置将无法使用。导入的原始素材、配置和模型保持不变。',
  cleanupAcknowledgement: '我已了解：这些生成文件删除后无法恢复。',
  cleanupConfirm: '永久删除生成结果', cleanupWorking: '正在删除生成结果…',
  cleanupSuccess: '生成结果和历史已清理。', cleanupPartial: '部分文件未能删除，对应历史已保留。请检查结果后重试。',
  cleanupError: '生成结果清理失败', cleanupRetained: '已保留没有任务引用的项目：', files: '个文件',
};

export const settingsCenterInterfaceCopy = (language: CanvasInterfaceLanguage) => language === 'en' ? {
  title: 'Settings', subtitle: 'HEIYAN LOCAL CONTROL', close: 'Close settings', navigation: 'Settings categories',
  sections: {
    api: { label: 'API & models', hint: 'Cloud services', intro: 'Find a real model and enter its API key. HEIYAN handles the remaining connection settings.' },
    comfyui: { label: 'Remote ComfyUI Generation', hint: 'Optional module', intro: 'Connect the verified private bundle, or open advanced settings for a separately configured server.' },
    data: { label: 'Data', hint: 'Backup & storage', intro: 'Review local storage, import or export settings, and clear rebuildable preview caches.' },
    about: { label: 'About', hint: 'Version & status', intro: 'Review the HEIYAN version, storage locations, and local service status.' },
  },
  advanced: 'Custom ComfyUI (advanced)', advancedHint: 'For a separately installed and configured ComfyUI server.',
} : {
  title: '设置中心', subtitle: 'HEIYAN LOCAL CONTROL', close: '关闭设置', navigation: '设置分类',
  sections: {
    api: { label: 'API 与模型', hint: '云端服务', intro: '找到真实模型，填写密钥即可。其余连接参数由黑岩画布处理。' },
    comfyui: { label: '远程ComfyUI生成', hint: '可选模块', intro: '连接经过验证的私有套件，或在高级设置中使用单独配置的服务器。' },
    data: { label: '数据管理', hint: '备份与容量', intro: '查看本机占用，导入导出配置，并清理可重新生成的预览缓存。' },
    about: { label: '关于', hint: '版本与运行状态', intro: '查看黑岩画布的版本、存储位置与本机运行状态。' },
  },
  advanced: '自定义 ComfyUI（高级）', advancedHint: '用于单独安装并配置的 ComfyUI 服务器。',
};

export function promptPresetChipInterfaceCopy(label: string, value: string, scope: 'positive' | 'negative', language: CanvasInterfaceLanguage) {
  if (language === 'en') return {
    text: value,
    title: `${scope === 'negative' ? 'Negative' : 'Positive'} preset · ${value} · Click to show Chinese label · Double-click to detach as plain text · Drag to reorder`,
    removeLabel: `Remove ${scope === 'negative' ? 'negative' : 'positive'} preset ${value}`,
  };
  return {
    text: label,
    title: `${scope === 'negative' ? '负向' : '正向'}预设 · 中文：${label} · 英文：${value} · 当前显示中文，点击切换英文 · 双击转成普通文字并取消关联 · 可拖拽调整位置`,
    removeLabel: `移除${scope === 'negative' ? '负向' : '正向'}预设 ${label}`,
  };
}

export const canvasInterfaceLanguageStorageKey = 'ai-canvas:interface-language:v1';

export function storedCanvasInterfaceLanguage(): CanvasInterfaceLanguage {
  if (typeof window === 'undefined') return 'zh';
  try { return window.localStorage.getItem(canvasInterfaceLanguageStorageKey) === 'en' ? 'en' : 'zh'; }
  catch { return 'zh'; }
}

const englishByChinese: Readonly<Record<string, string>> = Object.freeze({
  '主页': 'Home',
  '创作流程': 'Creation flow',
  '本地优先': 'Local-first',
  '无需账户': 'No account required',
  '作品留在你的设备': 'Work stays on your device',
  '菜单': 'Menu',
  '使用文档': 'Documentation',
  '打开黑岩 HEIYAN 画布 GitHub 仓库': 'Open HEIYAN canvas GitHub repository',
  'GitHub · 黑岩 HEIYAN 画布': 'GitHub · HEIYAN canvas',
  '文件': 'File',
  '导入本地素材': 'Import local media',
  '导出当前画布': 'Export canvas',
  '编辑': 'Edit',
  '撤销': 'Undo',
  '重做': 'Redo',
  '画布': 'Canvas',
  '主画布': 'Main canvas',
  '本地项目': 'Local project',
  '未命名画布': 'Untitled canvas',
  '当前': 'Current',
  '打开': 'Open',
  '创建': 'Create',
  '创建中': 'Creating',
  '删除当前画布': 'Delete canvas',
  '资产': 'Assets',
  '生成资产': 'Generated assets',
  '生成历史': 'Generation history',
  '打开生成历史': 'Open generation history',
  '关闭生成历史': 'Close generation history',
  '正在清理生成结果，请稍后再生成': 'Generated results are being cleared. Try generating again shortly.',
  '有任务正在提交或运行，请稍后清理': 'A task is being submitted or is running. Try clearing later.',
  '请先完成或取消运行中、排队中和可恢复的任务': 'Complete or cancel running, queued, and resumable tasks before clearing.',
  '生成目录中存在链接，未执行清理': 'A link was found in the output directory. Nothing was deleted.',
  '工作空间': 'Workspace',
  '外部访客': 'Guest',
  '只读分享': 'Read only',
  '设置中心': 'Settings',
  '图片历史': 'Images',
  '视频历史': 'Videos',
  '音频历史': 'Audio',
  '3D 世界': '3D models',
  '批量操作': 'Batch',
  '刷新': 'Refresh',
  '关闭': 'Close',
  '关闭设置': 'Close settings',
  '下载': 'Download',
  '添加到画布': 'Add to canvas',
  '暂无历史记录': 'No generated assets yet',
  '暂无真实生成资产': 'No generated assets yet',
  '文本': 'Text',
  '图片': 'Image',
  '视频': 'Video',
  '音频': 'Audio',
  '素材图片': 'Image asset',
  '素材视频': 'Video asset',
  '素材音频': 'Audio asset',
  '3D 模型': '3D model',
  '结果': 'Result',
  'ComfyUI 工作流': 'ComfyUI workflow',
  'ComfyUI 本地生图': 'ComfyUI local image',
  'ComfyUI 本地生成': 'ComfyUI local generation',
  '角色绑定与动画': 'Character rig & animation',
  '多视图切分': 'Multi-view splitter',
  '等待图片': 'Waiting for image',
  '等待视频': 'Waiting for video',
  '等待音频': 'Waiting for audio',
  '等待生成结果': 'Waiting for result',
  '等待生成图片': 'Waiting for image',
  '等待生成视频': 'Waiting for video',
  '正在准备预览': 'Preparing preview',
  '替换': 'Replace',
  '上传': 'Upload',
  '查看': 'View',
  '复制': 'Duplicate',
  '删除': 'Delete',
  '输入': 'Input',
  '输出': 'Output',
  '提示词': 'Prompt',
  '正向': 'Positive',
  '负向': 'Negative',
  '正向提示词': 'Positive prompt',
  '负向提示词': 'Negative prompt',
  '正向或负向提示词预设': 'Positive or negative prompt presets',
  '首次使用流程预览': 'First-run preview',
  '正在预览新用户流程': 'Previewing the new-user flow',
  '需要从头测试？': 'Need to test from the beginning?',
  '仅改变当前设置窗口的展示，不会关闭 ComfyUI、移动模型或修改真实配置。': 'This only changes the current settings view. It will not stop ComfyUI, move models, or change real settings.',
  '可从“未安装”状态走完整流程，不触碰本机软件和模型。': 'Walk through the full flow from “Not installed” without touching local software or models.',
  '退出预览': 'Exit preview',
  '预览首次使用': 'Preview first run',
  '预览操作不会发出连接、扫描或启用请求。': 'Preview actions do not send connection, scan, or enable requests.',
  '预览：已进入模型识别步骤，真实配置没有变化': 'Preview: moved to model detection; real settings are unchanged',
  '预览：已识别本机模型，默认均未加入画布': 'Preview: local models detected; none are enabled on the canvas by default',
  '预览：扫描完成，真实配置没有变化': 'Preview: scan complete; real settings are unchanged',
  '预览：软件位置已接受，真实路径与配置没有变化': 'Preview: software location accepted; the real path and settings are unchanged',
  '描述想要生成的内容': 'Describe what you want to generate',
  '描述想要生成的内容，输入 @ 引用参考图': 'Describe what you want to generate; type @ to reference an image',
  '说明要修改什么': 'Describe what you want to change',
  '已有参考图，可不填；也可补充场景、服装或氛围': 'Reference image attached. Optionally add scene, wardrobe, or mood.',
  '双击输入文本…': 'Double-click to enter text…',
  '编辑设置': 'Edit settings',
  '生成失败': 'Generation failed',
  '生成成功': 'Generated',
  '等待生成 3D 模型': 'Waiting for 3D model',
  '3D 生成': '3D generation',
  '拖动外壳移动': 'Drag shell to move',
  '多视图输入': 'Multi-view input',
  '正面 / 单图': 'Front / single image',
  '左侧': 'Left',
  '右侧': 'Right',
  '背面': 'Back',
  '已连接输入': 'Connected inputs',
  '插入 Prompt': 'Insert prompt',
  '定位来源': 'Locate source',
  '角色三视图': 'Character turnaround',
  '角色三视图工具': 'Character turnaround tool',
  '主体': 'Subject',
  '穿搭': 'Wardrobe',
  '动作': 'Action',
  '画面': 'Frame',
  '环境': 'Environment',
  '元素': 'Elements',
  '风格': 'Style',
  '画质': 'Quality',
  '人体': 'Anatomy',
  '内容': 'Content',
  '基础内搭': 'Base layers',
  '魅力内搭': 'Lingerie',
  '亲吻依偎': 'Kiss & cuddle',
  '模型': 'Model',
  '规格': 'Format',
  '工具': 'Tool',
  '生成': 'Generate',
  '取消': 'Cancel',
  '确定': 'Confirm',
  '保存并应用': 'Save & apply',
  'API 与模型': 'API & models',
  '找到真实模型，填写密钥即可。其余连接参数由黑岩画布处理。': 'Choose a real model and enter its API key. The canvas handles the remaining connection settings.',
  '填写 API 密钥': 'Enter API key',
  '连接可用': 'Connected',
  '连接受限': 'Connected · rate limited',
  '密钥无效': 'Invalid key',
  '服务不可达': 'Service unreachable',
  '需要验证': 'Verification required',
  '尚未连接': 'Not connected',
  '等待验证': 'Waiting to verify',
  '正在验证': 'Verifying',
  '正在验证…': 'Verifying…',
  '验证并连接': 'Verify & connect',
  '断开': 'Disconnect',
  '断开中…': 'Disconnecting…',
  '所有已配置服务均已验证': 'All configured services are verified',
  '请先填写一个 API 密钥': 'Enter at least one API key',
  '没有需要 API 密钥的云端模型。': 'No cloud model requires an API key.',
  '数据管理': 'Data',
  '关于': 'About',
  '本机': 'Local',
  '切换到 English': 'Switch to English',
  '切换到中文': 'Switch to Chinese',
  '打开设置中心': 'Open settings',
  '打开生成资产': 'Open generated assets',
  '打开主菜单': 'Open main menu',
  '画布列表': 'Canvas list',
  '全局菜单': 'Global menu',
  '文件操作': 'File actions',
  '编辑操作': 'Edit actions',
  '画布管理': 'Canvas management',
  '新画布名称': 'New canvas name',
  '当前开源版本': 'Current open-source version',
  '切换到白昼模式': 'Switch to light mode',
  '切换到夜间模式': 'Switch to dark mode',
  '白昼模式': 'Light mode',
  '夜间模式': 'Dark mode',
  '进入画布': 'Open canvas',
  '连接 ComfyUI': 'Connect ComfyUI',
  'ComfyUI 本地能力': 'Local ComfyUI',
  '本地生成': 'Local generation',
  '远程ComfyUI生成': 'Remote ComfyUI Generation',
  '本地生成模块': 'Local generation module',
  '安装并启用本地生成模块后，对应模型和节点才会出现在画布。': 'Models and nodes appear on the canvas only after the local generation module is installed and enabled.',
  '请先在设置中心启用一项本地生成能力': 'Enable a local generation capability in Settings first',
  'ComfyUI 运行引擎': 'ComfyUI runtime',
  'ComfyUI 本机地址': 'Local ComfyUI address',
  'ComfyUI 配置进度': 'ComfyUI setup progress',
  '已识别的本地模型': 'Detected local models',
  '运行引擎': 'Runtime',
  '工作流能力': 'Workflow capabilities',
  '本机地址': 'Local address',
  '未连接': 'Not connected',
  '已发现运行引擎': 'Runtime detected',
  '本地能力已就绪': 'Local capabilities ready',
  '启动 ComfyUI 后保持默认地址即可': 'Start ComfyUI and keep the default address',
  '检测并连接': 'Detect & connect',
  '重新扫描': 'Scan again',
  '识别模型': 'Detect models',
  '正在检测…': 'Detecting…',
  '正在识别…': 'Detecting…',
  '正在读取本机 ComfyUI…': 'Reading local ComfyUI…',
  '只读取本机模型和节点信息，不移动模型文件，也不会运行工作流。': 'Reads local models and node metadata only. No files are moved and no workflow is run.',
  '这台电脑还没有 ComfyUI？': 'No ComfyUI on this computer yet?',
  '先安装官方桌面版，它会准备独立的 Python 与 GPU 运行环境。': 'Install the official desktop app first. It prepares an isolated Python and GPU runtime.',
  '安装官方桌面版': 'Install official desktop app',
  '打开官方安装向导': 'Open official installation guide',
  '安装运行引擎': 'Install runtime',
  '只需完成一次': 'One-time setup',
  '选择能力包': 'Choose capability pack',
  '图片、视频按需安装': 'Install image or video support as needed',
  '自动装载工作流': 'Load workflows automatically',
  '画布已内置工作流': 'Workflows are bundled with the canvas',
  '我已经安装，指定软件位置': 'Already installed? Choose its location',
  '收起已有软件连接': 'Hide existing installation setup',
  'ComfyUI 软件文件夹': 'ComfyUI application folder',
  '保存位置并启动': 'Save location & start',
  '正在启动…': 'Starting…',
  '可选择包含 main.py 的文件夹，或便携版的上一级文件夹。之后画布会自动启动和连接。': 'Choose the folder containing main.py, or the parent folder of a portable install. The canvas will start and connect it automatically next time.',
  '选择第一个能力包': 'Choose your first capability pack',
  '工作流已经随画布提供；这里只需要安装与它匹配的模型文件。': 'Workflows are already bundled. Install only the matching model files here.',
  '推荐入门': 'Recommended starter',
  '基础图片生成': 'Basic image generation',
  'SDXL Checkpoint · 文生图 · 普通参考图': 'SDXL checkpoint · text to image · standard reference image',
  '查看模型与许可': 'View model & license',
  '高性能设备': 'High-performance hardware',
  '本地视频生成': 'Local video generation',
  'MiniMax H3 · 需要更大的显存与磁盘空间': 'MiniMax H3 · requires more VRAM and disk space',
  '查看安装方式': 'View installation guide',
  '模型通常是数 GB 到数十 GB。正式的一键安装必须先显示下载体积、保存位置和许可证，并由用户确认；当前版本不会静默下载。': 'Models can range from several to tens of GB. One-click installation must show size, destination, and license for confirmation; this version never downloads silently.',
  '先启动并连接 ComfyUI': 'Start and connect ComfyUI first',
  'ComfyUI 是本地运行引擎；模型是它读取的资源；工作流决定模型可以完成的具体任务。': 'ComfyUI is the local runtime, models are its resources, and workflows define the tasks each model can perform.',
  '高级信息': 'Advanced information',
  '查看模型文件分类与扫描状态': 'View model-file categories and scan status',
  '连接 ComfyUI 后显示本机资源统计。': 'Connect ComfyUI to view local resource statistics.',
  '画布中已启用': 'Enabled on canvas',
  '启用到画布': 'Enable on canvas',
  '个工作流能力': 'workflow capabilities',
  '个能力': 'capabilities',
  '项资源': 'resources',
  '个服务验证可用 · 验证不会生成内容或产生费用': 'services verified · Verification generates no content and incurs no cost',
  '工作流决定这个模型在画布里能做什么': 'Workflows define what this model can do on the canvas',
  '可打开完整工作流编辑器': 'Full workflow editor available',
  '由画布直接管理': 'Managed directly by the canvas',
  '这个模型还没有绑定工作流。': 'No workflow is bound to this model yet.',
  '从安装开始配置本机运行引擎、模型与工作流能力。': 'Set up the local runtime, models, and workflow capabilities from installation onward.',
  '查看画布快捷键': 'View canvas shortcuts',
  '缩小画布': 'Zoom out',
  '放大画布': 'Zoom in',
  '适应画布': 'Fit canvas',
  '显示小地图': 'Show minimap',
  '小地图': 'Minimap',
  '缩小': 'Zoom out',
  '放大': 'Zoom in',
  '正在打开创作台': 'Opening studio',
  '正在恢复画布内容': 'Restoring canvas',
  '正在准备画布': 'Preparing canvas',
  '创作空间已就绪': 'Studio ready',
  '画布已准备好': 'Canvas ready',
  '正在打开画布': 'Opening canvas',
  '恢复节点、素材与创作内容': 'Restoring nodes, media, and creative content',
  '文字': 'Text',
  '参考图': 'Reference',
  '本地模型': 'Local model',
  '连接文字、图像与本地模型，让每次生成直接成为下一步输入。': 'Connect text, images, and local models so every result becomes the next input.',
  '连接文字、图像与生成模型，让每次生成直接成为下一步输入。': 'Connect text, images, and generation models so every result becomes the next input.',
  '生成模型': 'Generation model',
  '人物': 'Characters',
  '服饰': 'Clothing',
  '汉服': 'Hanfu',
  '表情动作': 'Expression & action',
  '构图': 'Composition',
  '镜头': 'Camera',
  '场景': 'Scene',
  '建筑': 'Architecture',
  '自然': 'Nature',
  '光影环境': 'Lighting',
  '色彩': 'Color',
  '物品': 'Objects',
  '生物': 'Creatures',
  '魔法': 'Magic',
  '特效': 'Effects',
  '画风': 'Visual style',
  '质量渲染': 'Quality & render',
});

const promptTokenEnglishByChinese = new Map(promptTokens.map((entry) => {
  const englishAlias = entry.aliases?.find((alias) => /^[\x20-\x7e]+$/.test(alias));
  const value = englishAlias || entry.values.sdxl || entry.values.natural || entry.id;
  const concise = value
    .replace(/^an? adult (?:wearing|holding|with)\s+/i, '')
    .replace(/^an? (?:adult |character |person )?/i, '')
    .replace(/,?\s*adult$/i, '')
    .trim();
  return [entry.label, concise || entry.id] as const;
}));

const fragmentTranslations: ReadonlyArray<readonly [string, string]> = Object.entries({
  '角色绑定与动画': 'character rig and animation', '多视图输入': 'multi-view input', '本地工作流': 'local workflow',
  '最终生成结果': 'final generated result', '当前生成结果': 'current result', '生成资产': 'generated assets',
  '高清放大': 'upscale', '提示词': 'prompt', '工作流': 'workflow', '参考图片': 'reference image',
  '参考视频': 'reference video', '参考音频': 'reference audio', '参考图': 'reference', '素材图片': 'image asset',
  '素材视频': 'video asset', '素材音频': 'audio asset', '图片': 'image', '视频': 'video', '音频': 'audio',
  '文本': 'text', '模型': 'model', '画布': 'canvas', '节点': 'node', '输入端口': 'input port',
  '输出端口': 'output port', '输入': 'input', '输出': 'output', '生成失败': 'generation failed',
  '生成成功': 'generated', '生成': 'generate', '等待': 'waiting', '正在': 'working', '已连接': 'connected',
  '已完成': 'completed', '已取消': 'cancelled', '失败': 'failed', '成功': 'success', '设置': 'settings',
  '编辑': 'edit', '打开': 'open', '关闭': 'close', '选择': 'select', '添加': 'add', '移除': 'remove',
  '删除': 'delete', '替换': 'replace', '下载': 'download', '上传': 'upload', '查看': 'view', '定位': 'locate',
  '复制': 'duplicate', '重命名': 'rename', '当前': 'current', '默认': 'default', '本地': 'local', '本机': 'local', '主画布': 'main canvas',
  '自动': 'auto', '手动': 'manual', '启用': 'enable', '停用': 'disable', '保存': 'save', '刷新': 'refresh',
  '取消': 'cancel', '确定': 'confirm', '运行': 'run', '连接': 'connect', '断开': 'disconnect', '来源': 'source',
  '历史': 'history', '详情': 'details', '更多': 'more', '返回': 'back', '下一步': 'next', '上一页': 'previous',
  '下一页': 'next', '缩小': 'zoom out', '放大': 'zoom in', '适应': 'fit', '小地图': 'minimap', '文件': 'file',
  '名称': 'name', '类型': 'type', '状态': 'status', '进度': 'progress', '数量': 'count', '规格': 'format',
  '分辨率': 'resolution', '时长': 'duration', '秒': 'sec', '张': 'outputs', '个': '', '未使用': 'unused',
  '可用': 'available', '不可用': 'unavailable', '无': 'none', '暂无': 'none', '错误': 'error', '异常': 'error',
}).sort((left, right) => right[0].length - left[0].length);

const cjkPattern = /[\u3400-\u9fff]/;

function englishFallback(source: string, partiallyTranslated: string) {
  const sourceLower = source.toLowerCase();
  if (/失败|错误|异常/.test(source)) return sourceLower.includes('api') ? 'API operation failed' : 'Operation failed';
  if (/等待|暂无/.test(source)) return 'Waiting for content';
  if (/正在/.test(source)) return 'Working…';
  if (/删除/.test(source)) return 'Delete option';
  if (/设置|配置/.test(source)) return 'Settings option';
  if (/模型/.test(source)) return 'Model option';
  if (/工作流/.test(source)) return 'Workflow option';
  const latin = partiallyTranslated.replace(/[\u3400-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim();
  return latin ? `${latin} · UI` : 'Interface option';
}

const composedTranslations: ReadonlyArray<[RegExp, (...groups: string[]) => string]> = [
  [/^画布 (\d+) · 本机$/, (count) => `Canvas ${count} · Local`],
  [/^当前画布：(.+)$/, (name) => `Current canvas: ${translateCanvasInterfaceText(name, 'en')}`],
  [/^(\d+) 张 · 独立保存$/, (count) => `${count} canvases · saved separately`],
  [/^(\d+) 个节点$/, (count) => `${count} nodes`],
  [/^(\d+) 个$/, (count) => count],
  [/^(\d+) 个能力$/, (count) => `${count} capabilities`],
  [/^(\d+) 项资源$/, (count) => `${count} resources`],
  [/^发现 (\d+) 项本机资源，尚未建立画布模型$/, (count) => `${count} local resources found; no canvas model configured yet`],
  [/^(\d+) 个模型可用，(\d+) 个已加入画布$/, (ready, enabled) => `${ready} models available, ${enabled} enabled on canvas`],
  [/^已识别 (\d+) 个可用模型$/, (count) => `${count} available models detected`],
  [/^ComfyUI 已启动，识别到 (\d+) 个模型$/, (count) => `ComfyUI started; ${count} models detected`],
  [/^预览：(.+) 已加入画布，真实配置没有变化$/, (name) => `Preview: ${translateCanvasInterfaceText(name, 'en')} enabled on canvas; real settings are unchanged`],
  [/^预览：(.+) 已从画布隐藏，真实配置没有变化$/, (name) => `Preview: ${translateCanvasInterfaceText(name, 'en')} hidden from canvas; real settings are unchanged`],
  [/^(.+) API 密钥$/, (name) => `${translateCanvasInterfaceText(name, 'en')} API key`],
  [/^已保存 (.+)$/, (masked) => `Saved ${masked}`],
  [/^(\d+)\s*\/\s*(\d+)\s*个服务验证可用 · 验证不会生成内容或产生费用$/, (ready, total) => `${ready} / ${total} services verified · Verification generates no content and incurs no cost`],
  [/^(\d+) 个服务已验证并同步到画布$/, (count) => `${count} services verified and synced to the canvas`],
  [/^(.+) 已断开$/, (name) => `${translateCanvasInterfaceText(name, 'en')} disconnected`],
  [/^新建画布 (\d+)$/, (count) => `New canvas ${count}`],
  [/^已连接输入 (\d+)$/, (count) => `Connected inputs ${count}`],
  [/^(\d+) 个图片输入$/, (count) => `${count} image inputs`],
  [/^(\d+) 个视频输入$/, (count) => `${count} video inputs`],
  [/^(\d+) 个音频输入$/, (count) => `${count} audio inputs`],
  [/^(\d+) 个文本输入$/, (count) => `${count} text inputs`],
  [/^图片输入$/, () => 'Image input'],
  [/^视频输入$/, () => 'Video input'],
  [/^音频输入$/, () => 'Audio input'],
  [/^文本输入$/, () => 'Text input'],
  [/^(.+) · (\d+) 张$/, (settings, count) => `${settings} · ${count} outputs`],
  [/^(.+)输入端口$/, (label) => `${translateCanvasInterfaceText(label, 'en')} input port`],
  [/^(.+)输出端口$/, (label) => `${translateCanvasInterfaceText(label, 'en')} output port`],
];

export function translateCanvasInterfaceText(value: string, language: CanvasInterfaceLanguage): string {
  if (language === 'zh' || !value) return value;
  const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match) return value;
  const [, prefix, body, suffix] = match;
  const exact = englishByChinese[body];
  if (exact) return `${prefix}${exact}${suffix}`;
  const promptToken = promptTokenEnglishByChinese.get(body);
  if (promptToken) return `${prefix}${promptToken}${suffix}`;
  for (const [pattern, compose] of composedTranslations) {
    const groups = body.match(pattern);
    if (groups) return `${prefix}${compose(...groups.slice(1))}${suffix}`;
  }
  if (!cjkPattern.test(body)) return value;
  let translated = body;
  fragmentTranslations.forEach(([chinese, english]) => { translated = translated.replaceAll(chinese, english); });
  if (cjkPattern.test(translated)) translated = englishFallback(body, translated);
  return `${prefix}${translated}${suffix}`;
}

type TextRecord = { source: string; rendered: string };
type AttributeRecord = { source: string; rendered: string };
const textRecords = new WeakMap<Text, TextRecord>();
const attributeRecords = new WeakMap<Element, Map<string, AttributeRecord>>();
const translatableAttributes = ['aria-label', 'title', 'placeholder', 'data-placeholder'] as const;

function isUserContent(node: Node) {
  const parent = node instanceof Element ? node : node.parentElement;
  return Boolean(parent?.closest('[data-no-interface-translation], .node-inline-title-input, .rich-editor, .prompt-inline-editor, [contenteditable="true"]'));
}

function translateTextNode(node: Text, language: CanvasInterfaceLanguage) {
  if (isUserContent(node)) return;
  const current = node.nodeValue || '';
  let record = textRecords.get(node);
  if (!record || current !== record.rendered) record = { source: current, rendered: current };
  const rendered = translateCanvasInterfaceText(record.source, language);
  record.rendered = rendered;
  textRecords.set(node, record);
  if (current !== rendered) node.nodeValue = rendered;
}

function translateAttributes(element: Element, language: CanvasInterfaceLanguage) {
  const userContent = isUserContent(element);
  if (userContent && !element.hasAttribute('data-placeholder')) return;
  let records = attributeRecords.get(element);
  if (!records) {
    records = new Map();
    attributeRecords.set(element, records);
  }
  translatableAttributes.forEach((name) => {
    if (userContent && name !== 'data-placeholder') return;
    const current = element.getAttribute(name);
    if (current == null) return;
    let record = records!.get(name);
    if (!record || current !== record.rendered) record = { source: current, rendered: current };
    const rendered = translateCanvasInterfaceText(record.source, language);
    record.rendered = rendered;
    records!.set(name, record);
    if (current !== rendered) element.setAttribute(name, rendered);
  });
}

function syncPromptPresetChip(element: HTMLElement, language: CanvasInterfaceLanguage) {
  const label = element.dataset.promptPresetLabel || '';
  const value = element.dataset.promptPresetValue || '';
  if (!label && !value) return;
  const scope = element.dataset.promptPresetScope === 'negative' ? 'negative' : 'positive';
  const copy = promptPresetChipInterfaceCopy(label, value, scope, language);
  element.dataset.promptPresetLanguage = language;
  element.title = copy.title;
  const visibleText = Array.from(element.children).find((child) => child.tagName === 'STRONG');
  if (visibleText && visibleText.textContent !== copy.text) visibleText.textContent = copy.text;
  const remove = element.querySelector<HTMLElement>('[data-remove-prompt-preset]');
  if (remove) remove.setAttribute('aria-label', copy.removeLabel);
}

function syncPromptPresetChips(root: Element, language: CanvasInterfaceLanguage) {
  if (root instanceof HTMLElement && root.matches('[data-prompt-preset-token]')) syncPromptPresetChip(root, language);
  root.querySelectorAll<HTMLElement>('[data-prompt-preset-token]').forEach((chip) => syncPromptPresetChip(chip, language));
}

function translateSubtree(root: Node, language: CanvasInterfaceLanguage) {
  if (root instanceof Text) {
    translateTextNode(root, language);
    return;
  }
  if (!(root instanceof Element)) return;
  syncPromptPresetChips(root, language);
  translateAttributes(root, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current instanceof Text) translateTextNode(current, language);
    else if (current instanceof Element) translateAttributes(current, language);
    current = walker.nextNode();
  }
}

export function observeCanvasInterfaceLanguage(root: HTMLElement, language: CanvasInterfaceLanguage) {
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  try { window.localStorage.setItem(canvasInterfaceLanguageStorageKey, language); }
  catch { /* The language still applies for this session. */ }
  translateSubtree(root, language);
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'characterData' && mutation.target instanceof Text) translateTextNode(mutation.target, language);
      else if (mutation.type === 'attributes' && mutation.target instanceof Element) translateAttributes(mutation.target, language);
      else mutation.addedNodes.forEach((node) => translateSubtree(node, language));
    });
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...translatableAttributes] });
  return () => observer.disconnect();
}
