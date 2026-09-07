import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ModelConnectionDialog, ModelConnectionDialogFields } from './ModelConnectionDialog';
import { ModelSettings } from './ModelSettings';
import { connectionDefaults } from '../../shared/model-connection-settings.js';
import { connectionCopy } from '../model-connection-settings';
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
describe('advanced model dialog contract', () => {
  it('keeps the ordinary simple-key panel bilingual while adding advanced controls', () => {
    for (const language of ['zh', 'en'] as const) {
      const markup = renderToStaticMarkup(createElement(ModelSettings, { open: true, language, onClose: vi.fn(), onModelsChanged: async () => undefined }));
      expect(markup).toContain(language === 'en' ? 'API &amp; models' : 'API 与模型');
      if (language === 'en') expect(markup).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });
  it('renders every field and warning in both languages without saved keys', () => {
    for (const language of ['zh', 'en'] as const) {
      const copy = connectionCopy(language);
      const markup = renderToStaticMarkup(createElement(ModelConnectionDialogFields, { value: connectionDefaults('openai-image'), apiKey: '', language, busy: false, error: '', onChange: vi.fn(), onKeyChange: vi.fn() }));
      for (const key of ['protocol', 'mode', 'baseUrl', 'model', 'endpoint', 'editEndpoint', 'validationEndpoint', 'key', 'keyHint', 'verificationHint'] as const) expect(markup).toContain(copy[key]);
      expect(markup).toContain('type="password"'); expect(markup).toContain('value=""');
      if (language === 'en') expect(markup).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });
  it('shows Tripo workflow-derived endpoint read-only and never mounts a local dialog', () => {
    const markup = renderToStaticMarkup(createElement(ModelConnectionDialogFields, { value: connectionDefaults('tripo3d-model'), apiKey: '', language: 'en', busy: false, error: '', onChange: vi.fn(), onKeyChange: vi.fn() }));
    expect(markup).toContain(connectionCopy('en').derived);
    const request = vi.fn();
    expect(renderToStaticMarkup(createElement(ModelConnectionDialog, { model: { id: 'local', name: 'Local', capability: 'audio', adapter: 'gpt-sovits-audio', enabled: true }, request, onClose: vi.fn(), onSaved: vi.fn() }))).toBe('');
    expect(request).not.toHaveBeenCalled();
  });
  it('uses a labelled modal portal, prevents parent form submission and keeps cancel request-free', () => {
    const code = source('./ModelConnectionDialog.tsx');
    expect(code).toContain('createPortal(<dialog'); expect(code).toContain('aria-modal="true"'); expect(code).toContain('aria-labelledby={titleId}');
    expect(code).toContain('event.preventDefault(); event.stopPropagation();');
    expect(code).toContain("setApiKey(''); onClose();");
    expect(code).toContain("value.adapter !== draft.adapter || value.baseUrl !== draft.baseUrl) setApiKey('')");
    expect(code).toContain('document.body'); expect(code).toContain('dialog.showModal()');
    expect(code).toContain('data-canvas-theme'); expect(code).toContain('getComputedStyle(themeSource)'); expect(code).toContain('themeObserver.disconnect()');
    expect(source('./ModelConnectionDialog.css')).toContain(':focus-visible');
    expect(source('./ModelSettings.tsx')).toContain('isAdvancedRowSurface(event.target as HTMLElement)');
    expect(source('./ModelSettings.tsx')).toContain('type="button" aria-label={advancedCopy.title');
    expect(source('./SettingsCenter.tsx')).toContain('onModelsChanged={onModelsChanged} language={language}');
    expect(code).not.toMatch(/localStorage|sessionStorage|\bconsole\.(?:log|warn|error|debug)\s*\(/);
  });
});
