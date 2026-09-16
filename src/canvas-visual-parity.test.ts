import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./canvas-visual-parity.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');

describe('shared HEIYAN canvas visual contract', () => {
  it('uses the same fine dot geometry in day and night', () => {
    expect(css).toContain('--canvas-dot-pitch: 10px;');
    expect(css).toContain('--canvas-dot-radius: 1px;');
    expect(css).toContain('--canvas-dot-color: #17191b;');
    expect(css).toContain('--canvas-dot-color: #dfe0e1;');
    expect(css).toContain('background-size: var(--canvas-dot-pattern-size);');
    expect(css).not.toMatch(/34px 34px|--heiyan-dot-base/);
  });

  it('keeps edges neutral while node and Agent states carry colour', () => {
    expect(styles).toContain('stroke: var(--canvas-edge-rest)');
    expect(styles).toContain('stroke: var(--canvas-edge-hover)');
    expect(styles).toContain('stroke: var(--canvas-edge-active)');
    expect(css).toContain('--canvas-signal-image:');
    expect(css).toContain('.canvas-node.type-video');
    expect(css).not.toContain('edge-signal-');
  });

  it('loads the parity layer after product-owned base styles and supports reduced motion', () => {
    expect(main).toContain("import './canvas-visual-parity.css';");
    expect(main.indexOf("import './canvas-visual-parity.css';")).toBeGreaterThan(main.indexOf("import './styles.css';"));
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/transition:\s*all/);
  });
});
