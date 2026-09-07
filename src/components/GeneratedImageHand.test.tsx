import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { GeneratedImageHand, imageHandLayout } from './GeneratedImageHand';

const images = Array.from({ length: 4 }, (_, index) => ({ mediaUrl: `/media/assets/${index}.png`, width: 1024, height: 1024 }));

describe('generated image hand', () => {
  it('shows a straight front card and distinct partially exposed cards underneath', () => {
    const cards = imageHandLayout(images, 0);
    expect(cards[0]).toMatchObject({ index: 0, front: true, x: 0, y: 0, angle: 0 });
    expect(cards.slice(1).every(card => card.z < cards[0].z && card.y === 0 && card.x === 0 && card.angle !== 0)).toBe(true);
    expect(new Set(cards.map(card => `${card.x}:${card.y}:${card.angle}`)).size).toBe(4);
    expect(cards.some(card => card.angle < 0)).toBe(true);
    expect(cards.some(card => card.angle > 0)).toBe(true);
  });
  it('brings any selected original index forward without reordering or mutating outputs', () => {
    const before = JSON.stringify(images);
    for (let selected = 0; selected < images.length; selected++) {
      const cards = imageHandLayout(images, selected);
      expect(cards.map(card => card.index)).toEqual([0, 1, 2, 3]);
      expect(cards.filter(card => card.front).map(card => card.index)).toEqual([selected]);
      expect(cards[selected].z).toBeGreaterThan(Math.max(...cards.filter(card => !card.front).map(card => card.z)));
      expect(cards[selected].angle).toBe(0);
    }
    expect(JSON.stringify(images)).toBe(before);
  });
  it('keeps saved indexes when an output is missing and falls back safely', () => {
    const partial = [{}, images[1], {}, images[3]];
    expect(imageHandLayout(partial, 99).map(card => card.index)).toEqual([1, 3]);
    expect(imageHandLayout(partial, 99).find(card => card.front)?.index).toBe(1);
    expect(imageHandLayout([], 0)).toEqual([]);
    expect(imageHandLayout([images[0]], 0)).toEqual([{ index: 0, front: true, x: 0, y: 0, angle: 0, z: 2 }]);
  });
  it('bounds the fan and softens wide-image angles so corners do not swing into titles', () => {
    for (const count of [2, 4, 8, 10]) {
      const batch = Array.from({ length: count }, (_, index) => ({ mediaUrl: `${index}.png` }));
      for (const card of imageHandLayout(batch, 0)) {
        expect(card.x).toBe(0);
        expect(Math.abs(card.angle)).toBeLessThan(16);
        expect(card.y).toBe(0);
      }
    }
    const wide = imageHandLayout(images.map(image => ({ ...image, width: 3696, height: 1584 })), 0);
    expect(Math.abs(wide[1].angle)).toBeLessThan(Math.abs(imageHandLayout(images, 0)[1].angle));
  });
  it('anchors the fan near the lower-left corner and never raises hover stacking order', () => {
    const css = readFileSync(new URL('./GeneratedImageHand.css', import.meta.url), 'utf8');
    expect(css).toContain('transform-origin: 6% 94%');
    expect(css.match(/z-index:/g)).toHaveLength(1);
    expect(css).toContain('z-index: var(--hand-z)');
    expect(css).not.toContain('--hand-raised-z');
    const source = readFileSync(new URL('./GeneratedImageHand.tsx', import.meta.url), 'utf8');
    expect(source.match(/onSelect\(card.index\)/g)).toHaveLength(1);
    expect(source).toMatch(/onClick=\{event => \{[^}]*onSelect\(card.index\)/);
  });
  it('renders every full-size card with accessible selection and English copy', () => {
    const emphasized: number[] = [];
    const html = renderToStaticMarkup(<GeneratedImageHand outputs={images} selected={2} en onSelect={() => {}}
      renderImage={(image, index, high) => { if (high) emphasized.push(index); return <img src={image.mediaUrl} alt="" />; }} />);
    expect(html.match(/class="image-hand-card/g)).toHaveLength(4);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('Image 3 of 4, front');
    expect(html).not.toMatch(/[\u4e00-\u9fff]/);
    expect(emphasized).toEqual([2]);
    expect(html).toContain('nodrag');
  });
});
