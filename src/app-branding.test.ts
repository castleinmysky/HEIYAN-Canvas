import { describe, expect, it } from 'vitest';
import { canvasAppVersionLabel, canvasContextShortcutItems, canvasDocumentTitle, canvasDocumentTitleForLanguage, canvasExportFileName, canvasHomeBranding, canvasInputReferencesFromGraph, canvasShortcutGroups, canvasThemeTransitionMotion, canvasViewportDetailClass, settingsSectionFromPanel, shouldShowCanvasHome } from './App';

describe('page branding', () => {
  it('keeps the product name visible before the current canvas name', () => {
    expect(canvasDocumentTitle('无限画布')).toBe('黑岩 HEIYAN 画布 · 无限画布');
  });

  it('uses the product name when no canvas name exists', () => {
    expect(canvasDocumentTitle('')).toBe('黑岩 HEIYAN 画布');
    expect(canvasDocumentTitleForLanguage('', 'en')).toBe('HEIYAN · Infinite Creative Canvas');
    expect(canvasDocumentTitleForLanguage('主画布', 'en')).toBe('HEIYAN · Main canvas');
  });

  it('uses HEIYAN as the stable English brand instead of a literal translation', () => {
    expect(canvasHomeBranding('en')).toEqual({ title: 'HEIYAN', subtitle: 'INFINITE CREATIVE CANVAS' });
    expect(canvasHomeBranding('zh')).toEqual({ title: '黑岩画布', subtitle: 'HEIYAN' });
  });

  it('shows the actual packaged semantic version', () => {
    expect(canvasAppVersionLabel).toBe('v1.1');
  });

  it('exports the current canvas with a filesystem-safe readable name', () => {
    expect(canvasExportFileName('角色:主画布 / A')).toBe('角色-主画布 - A.echo-canvas.json');
    expect(canvasExportFileName('')).toBe('黑岩 HEIYAN 画布.echo-canvas.json');
  });

  it('shows the home only at the bare local root', () => {
    expect(shouldShowCanvasHome('/', '')).toBe(true);
    expect(shouldShowCanvasHome('/studio', '')).toBe(false);
    expect(shouldShowCanvasHome('/', '?task_id=local-canvas')).toBe(false);
    expect(shouldShowCanvasHome('/', '?mode=admin-standalone')).toBe(false);
    expect(shouldShowCanvasHome('/', '?view=agent')).toBe(false);
  });

  it('routes legacy and new links into the unified settings center', () => {
    expect(settingsSectionFromPanel('models')).toBe('api');
    expect(settingsSectionFromPanel('settings')).toBe('api');
    expect(settingsSectionFromPanel('comfyui')).toBe('comfyui');
    expect(settingsSectionFromPanel('data')).toBe('data');
    expect(settingsSectionFromPanel('unknown')).toBeNull();
  });

  it('expands the new daylight from the exact switch position', () => {
    const motion = canvasThemeTransitionMotion('night', { x: 900, y: 30 }, { width: 1200, height: 800 });
    expect(motion.nextTheme).toBe('day');
    expect(motion.pseudoElement).toBe('::view-transition-new(root)');
    expect(motion.clipPath[0]).toBe('circle(0px at 900px 30px)');
    expect(motion.clipPath[1]).toBe(`circle(${motion.radius}px at 900px 30px)`);
  });

  it('pulls daylight back into the switch when returning to night', () => {
    const motion = canvasThemeTransitionMotion('day', { x: 900, y: 30 }, { width: 1200, height: 800 });
    expect(motion.nextTheme).toBe('night');
    expect(motion.pseudoElement).toBe('::view-transition-old(root)');
    expect(motion.clipPath[0]).toBe(`circle(${motion.radius}px at 900px 30px)`);
    expect(motion.clipPath[1]).toBe('circle(0px at 900px 30px)');
  });

  it('keeps the shortcut guide grouped around real canvas commands', () => {
    expect(canvasShortcutGroups.map((group) => group.title)).toEqual([
      '创建与运行', '节点编辑', '排列与对齐', '历史与视图',
    ]);
    const shortcuts = canvasShortcutGroups.flatMap((group) => group.items);
    expect(shortcuts).toEqual(expect.arrayContaining([
      { keys: ['Tab'], label: '在指针位置打开节点菜单' },
      { keys: ['Ctrl', 'V'], label: '粘贴节点或导入媒体' },
      { keys: ['Ctrl', '←'], label: '向左碰撞排列' },
      { keys: ['Home'], label: '显示完整画布' },
    ]));
    expect(shortcuts.find((shortcut) => shortcut.label === '重做')?.alternateKeys).toEqual([['Ctrl', 'Y']]);
    expect(shortcuts.find((shortcut) => shortcut.label === '删除选中节点')?.alternateKeys).toEqual([['Backspace']]);
    expect(canvasContextShortcutItems).toHaveLength(4);
  });

  it('reduces distant node labels before they can overlap', () => {
    expect(canvasViewportDetailClass(0.8)).toBe('');
    expect(canvasViewportDetailClass(0.55)).toBe('zoom-detail-mid');
    expect(canvasViewportDetailClass(0.3)).toBe('zoom-detail-far');
  });

  it('carries a video poster into connected-node reference thumbnails', () => {
    const nodes = [
      { id: 'source', position: { x: 0, y: 0 }, data: { kind: 'video', title: 'Clip', mediaUrl: '/clip.mp4', previewUrl: '/clip-poster.webp', mediaDuration: 5 } },
      { id: 'target', position: { x: 400, y: 0 }, data: { kind: 'videoGenerator' } },
    ] as never;
    const edges = [{ id: 'edge', source: 'source', target: 'target', sourceHandle: 'output', targetHandle: 'input' }] as never;
    expect(canvasInputReferencesFromGraph(nodes, edges, 'target')[0]).toMatchObject({
      type: 'video',
      mediaUrl: '/clip.mp4',
      previewUrl: '/clip-poster.webp',
      duration: 5,
    });
  });
});
