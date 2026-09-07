import { describe, expect, it } from 'vitest';
import { managedComfyInterfaceCopy, promptPresetChipInterfaceCopy, settingsCenterInterfaceCopy, translateCanvasInterfaceText } from './interface-language';

describe('canvas interface language', () => {
  it('translates common canvas controls into English', () => {
    expect(translateCanvasInterfaceText('资产', 'en')).toBe('Assets');
    expect(translateCanvasInterfaceText('画布 3 · 本机', 'en')).toBe('Canvas 3 · Local');
    expect(translateCanvasInterfaceText('  等待视频  ', 'en')).toBe('  Waiting for video  ');
    expect(translateCanvasInterfaceText('描述想要生成的内容', 'en')).toBe('Describe what you want to generate');
    expect(translateCanvasInterfaceText('已有参考图，可不填；也可补充场景、服装或氛围', 'en')).toBe('Reference image attached. Optionally add scene, wardrobe, or mood.');
    expect(translateCanvasInterfaceText('创作流程', 'en')).toBe('Creation flow');
    expect(translateCanvasInterfaceText('作品留在你的设备', 'en')).toBe('Work stays on your device');
    expect(translateCanvasInterfaceText('正向', 'en')).toBe('Positive');
    expect(translateCanvasInterfaceText('负向', 'en')).toBe('Negative');
    expect(translateCanvasInterfaceText('首次使用流程预览', 'en')).toBe('First-run preview');
  });

  it('never leaves untranslated Chinese in English UI mode', () => {
    expect(translateCanvasInterfaceText('未知界面提示', 'en')).toBe('Interface option');
    expect(translateCanvasInterfaceText('安装官方桌面版', 'en')).toBe('Install official desktop app');
    expect(translateCanvasInterfaceText('发现 67 项本机资源，尚未建立画布模型', 'en')).toBe('67 local resources found; no canvas model configured yet');
    expect(translateCanvasInterfaceText('ComfyUI 已启动，识别到 4 个模型', 'en')).toBe('ComfyUI started; 4 models detected');
    expect(translateCanvasInterfaceText('项资源', 'en')).toBe('resources');
    expect(translateCanvasInterfaceText('个服务验证可用 · 验证不会生成内容或产生费用', 'en')).toContain('Verification generates no content');
    expect(translateCanvasInterfaceText('本地生成', 'en')).toBe('Local generation');
    expect(translateCanvasInterfaceText('安装并启用本地生成模块后，对应模型和节点才会出现在画布。', 'en')).not.toMatch(/[\u3400-\u9fff]/u);
    expect(translateCanvasInterfaceText('资产', 'zh')).toBe('资产');
  });

  it('switches structured preset chips without translating user-written prompt text', () => {
    const copy = promptPresetChipInterfaceCopy('电影光效', 'cinematic lighting', 'positive', 'en');
    expect(copy.text).toBe('cinematic lighting');
    expect(copy.title).not.toMatch(/[\u3400-\u9fff]/u);
    expect(copy.removeLabel).toBe('Remove positive preset cinematic lighting');
  });

  it('provides exact bilingual managed connection and settings copy', () => {
    const english = JSON.stringify({ managed: managedComfyInterfaceCopy('en'), settings: settingsCenterInterfaceCopy('en') });
    expect(english).not.toMatch(/[\u3400-\u9fff]/u);
    expect(managedComfyInterfaceCopy('zh').details['not-installed']).toContain('私有安装器');
    expect(settingsCenterInterfaceCopy('zh').advanced).toBe('自定义 ComfyUI（高级）');
  });
});
