import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsCenter, advancedComfyConditionalTree } from './SettingsCenter';

describe('SettingsCenter managed ComfyUI integration', () => {
  it('keeps the advanced legacy subtree absent until its true branch', () => {
    const sentinel = createElement('div', null, 'LEGACY_SENTINEL');
    expect(renderToStaticMarkup(advancedComfyConditionalTree(false, sentinel))).not.toContain('LEGACY_SENTINEL');
    expect(renderToStaticMarkup(advancedComfyConditionalTree(true, sentinel))).toContain('LEGACY_SENTINEL');
  });

  it('renders the complete English local-generation subtree with zero Han characters', () => {
    const html = renderToStaticMarkup(createElement(SettingsCenter, { open: true, initialSection: 'comfyui', onClose: vi.fn(), onModelsChanged: async () => undefined, version: 'v1.0', language: 'en' }));
    ['Settings', 'API &amp; models', 'Remote ComfyUI Generation', 'Data', 'About', 'Connect ComfyUI', 'Another network', 'Pairing code', 'Close settings'].forEach((copy) => expect(html).toContain(copy));
    expect(html).not.toContain('LEGACY_SENTINEL');
    expect(html).not.toMatch(/[\u3400-\u9fff]/u);
  });

  it('retains exact representative Chinese copy', () => {
    const html = renderToStaticMarkup(createElement(SettingsCenter, { open: true, initialSection: 'comfyui', onClose: vi.fn(), onModelsChanged: async () => undefined, version: 'v1.0', language: 'zh' }));
    expect(html).toContain('设置中心'); expect(html).toContain('远程ComfyUI生成'); expect(html).toContain('配对码');
  });

  it('source-gates lazy mount, native details and lifecycle resets', () => {
    const source = readFileSync(resolve('src/components/SettingsCenter.tsx'), 'utf8');
    expect(source).toContain("section === 'comfyui' && <LocalConnectorSettings");
    expect(source).not.toContain('<ComfyUiResources');
    expect(source).toMatch(/useState\(false\)/);
    expect(source).toMatch(/setAdvancedOpen\(false\)/g);
    expect(source).not.toMatch(/section === 'comfyui' && <ComfyUiResources/);
  });

  it('passes language at both callsites and keeps home refresh navigation-free', () => {
    const app = readFileSync(resolve('src/App.tsx'), 'utf8');
    expect((app.match(/<SettingsCenter /g) || [])).toHaveLength(2);
    expect(app).toContain('language={language}'); expect(app).toContain('language={canvasLanguage}');
    expect(app).toMatch(/const keepHomeSettingsLocal = useCallback\(async \(\) => undefined, \[\]\)/);
  });
});
