import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { ManagedComfyControllerSnapshot, ManagedComfyPublicState } from '../managed-comfy-connection';
import { ManagedComfyCardView } from './ManagedComfyCard';
import { ManagedComfyCardPreview, managedComfyInteractionStates } from './ManagedComfyCard.preview';

const publicState = (state: ManagedComfyPublicState['state']): ManagedComfyPublicState => ({ state, capabilityCount: state === 'connected' ? 6 : 0, reasonCode: state === 'repair-required' ? 'managed_digest_mismatch' : null, ...(state === 'connected' ? { bundle: { id: 'heiyan', version: '2.1.0', digest: 'b'.repeat(64) } } : {}) });
const snapshot = (name: ManagedComfyPublicState['state'], extra: Partial<ManagedComfyControllerSnapshot> = {}): ManagedComfyControllerSnapshot => {
  const value = publicState(name);
  return { state: value, lastSettledRealState: value, pending: false, polling: false, preview: false, errorCode: null, success: false, ...extra };
};

describe('ManagedComfyCard SSR surface', () => {
  it.each([
    ['not-installed', 'Recheck'], ['installed', 'Connect'], ['starting', 'Starting…'], ['connected', 'Disconnect'], ['repair-required', 'Quick verify'],
  ] as const)('renders %s with exactly its state action', (state, action) => {
    const html = renderToStaticMarkup(createElement(ManagedComfyCardView, { snapshot: snapshot(state), language: 'en' }));
    expect(html).toContain(action);
    expect((html.match(/managed-comfy-action primary/g) || [])).toHaveLength(1);
    expect(html).not.toMatch(/input|textarea|select|127\.0\.0\.1|workflow|model path/i);
    if (state === 'starting') { expect(html).toContain('aria-busy="true"'); expect(html).toContain('disabled=""'); }
    if (state === 'connected') { expect(html).toContain('2.1.0'); expect(html).toContain('6'); }
  });

  it('renders bilingual ARIA, stable error and non-colour success regions without leaking CJK in English', () => {
    const english = renderToStaticMarkup(createElement(ManagedComfyCardView, { snapshot: snapshot('installed', { errorCode: 'network_error' }), language: 'en' }));
    expect(english).toContain('role="alert"'); expect(english).not.toMatch(/[\u3400-\u9fff]/u);
    const chinese = renderToStaticMarkup(createElement(ManagedComfyCardView, { snapshot: snapshot('installed', { success: true }), language: 'zh' }));
    expect(chinese).toContain('role="status"'); expect(chinese).toContain('托管 ComfyUI 状态已更新');
  });

  it('compiles all eight build-only interaction states with no request surface', () => {
    const html = renderToStaticMarkup(createElement(ManagedComfyCardPreview, { language: 'en' }));
    expect(managedComfyInteractionStates).toHaveLength(8);
    managedComfyInteractionStates.forEach((state) => expect(html).toContain(`interaction-${state}`));
    expect(html).not.toMatch(/[\u3400-\u9fff]/u);
  });
});

describe('managed card CSS and binding gates', () => {
  const css = readFileSync(resolve('src/styles.css'), 'utf8');
  const source = readFileSync(resolve('src/components/ManagedComfyCard.tsx'), 'utf8');

  it('covers eight states, hover capability, focus, targets and reduced motion without slop patterns', () => {
    ['interaction-hover', 'interaction-focus', 'interaction-active', ':disabled', 'is-loading', 'is-error', 'is-success'].forEach((token) => expect(css).toContain(token));
    expect(css).toMatch(/@media \(hover: hover\)[\s\S]*\.managed-comfy-action:hover/);
    expect(css).toMatch(/outline:\s*2px solid var\(--managed-comfy-focus\)/);
    expect(css).toMatch(/outline-offset:\s*2px/);
    expect(css).toMatch(/\.managed-comfy-action[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/transition:\s*all|managed-comfy[^{}]*gradient|managed-comfy[^{}]*backdrop-filter/i);
  });

  it('declares bounded shrinkable layouts for 320, 375, 414 and 768 widths', () => {
    [320, 375, 414, 768].forEach((width) => expect(css).toContain(`max-width: ${width}px`));
    expect(css).toMatch(/\.managed-comfy-card[\s\S]*?max-inline-size:\s*100%/);
    expect(css).toMatch(/\.managed-comfy-actions[\s\S]*?flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.managed-comfy-action[\s\S]*?white-space:\s*nowrap/);
    expect(css).not.toMatch(/managed-comfy[^{}]*min-width:\s*(?:3[2-9]\d|[4-9]\d{2,})px/);
  });

  it('has cleanup that unsubscribes, disposes and blocks unmounted publication', () => {
    expect(source).toMatch(/let mounted = true/);
    expect(source).toMatch(/if \(mounted\) setSnapshot/);
    expect(source).toMatch(/mounted = false;[\s\S]*unsubscribe\(\);[\s\S]*controller\.dispose\(\)/);
    expect(source).toContain('controllerRef.current = null');
  });

  it('resolves production tokens and meets focus contrast for every rendered control and status surface', () => {
    type Oklab = [number, number, number];
    const selectorTokens = (selector: string) => {
      const tokens: Record<string, string> = {};
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const blockPattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
      for (const block of css.matchAll(blockPattern)) {
        for (const declaration of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) tokens[declaration[1]] = declaration[2].trim();
      }
      return tokens;
    };
    const root = selectorTokens(':root');
    const settings = selectorTokens('.settings-center');
    const component = selectorTokens('.settings-managed-comfy');
    const contexts = [
      { name: 'night', tokens: { ...root, ...settings, ...component } },
      { name: 'day canvas', tokens: { ...root, ...selectorTokens('.app-shell[data-theme="day"]'), ...settings, ...component } },
      { name: 'day home', tokens: { ...root, ...selectorTokens(".echo-home[data-theme='day']"), ...settings, ...component } },
    ];
    const toOklab = (lightness: number, chroma: number, hue: number): Oklab => {
      const radians = hue * Math.PI / 180;
      return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
    };
    const resolveColor = (name: string, tokens: Record<string, string>, stack = new Set<string>()): Oklab => {
      if (stack.has(name) || !tokens[name]) throw new Error(`Unresolved CSS token ${name}`);
      stack.add(name);
      const value = tokens[name];
      const variable = value.match(/^var\((--[a-z0-9-]+)\)$/i);
      if (variable) return resolveColor(variable[1], tokens, stack);
      const color = value.match(/^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/i);
      if (color) return toOklab(Number(color[1]) / 100, Number(color[2]), Number(color[3]));
      const mix = value.match(/^color-mix\(in oklab, var\((--[a-z0-9-]+)\)\s+([\d.]+)%,\s*var\((--[a-z0-9-]+)\)\)$/i);
      if (mix) {
        const weight = Number(mix[2]) / 100;
        const first = resolveColor(mix[1], tokens, new Set(stack)); const second = resolveColor(mix[3], tokens, new Set(stack));
        return first.map((channel, index) => channel * weight + second[index] * (1 - weight)) as Oklab;
      }
      throw new Error(`Unsupported CSS color ${name}: ${value}`);
    };
    const luminance = ([lightness, a, b]: Oklab) => {
      const l1 = lightness + .3963377774 * a + .2158037573 * b;
      const m1 = lightness - .1055613458 * a - .0638541728 * b;
      const s1 = lightness - .0894841775 * a - 1.291485548 * b;
      const l = l1 ** 3; const m = m1 ** 3; const s = s1 ** 3;
      const clamp = (value: number) => Math.max(0, Math.min(1, value));
      return .2126 * clamp(4.0767416621 * l - 3.3077115913 * m + .2309699292 * s)
        + .7152 * clamp(-1.2684380046 * l + 2.6097574011 * m - .3413193965 * s)
        + .0722 * clamp(-.0041960863 * l - .7034186147 * m + 1.707614701 * s);
    };
    const ratio = (a: Oklab, b: Oklab) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const surfaces = ['--canvas-primary', '--canvas-control', '--canvas-plane-raised', '--settings-error', '--settings-success'];
    contexts.forEach(({ name, tokens }) => {
      const focus = resolveColor('--managed-comfy-focus', tokens);
      surfaces.forEach((surface) => expect(ratio(focus, resolveColor(surface, tokens)), `${name}: focus vs ${surface}`).toBeGreaterThanOrEqual(3));
    });
  });
});
