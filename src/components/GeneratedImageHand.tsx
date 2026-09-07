import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './GeneratedImageHand.css';

export type HandImage = { mediaUrl?: string; previewUrl?: string; fileName?: string; width?: number; height?: number };

/** Original output indexes remain stable: selecting a card never reorders saved assets. */
export function imageHandLayout(outputs: HandImage[], selected: number) {
  const indexes = outputs.flatMap((output, index) => output.mediaUrl ? [index] : []);
  const front = indexes.includes(selected) ? selected : indexes[0];
  const behind = indexes.filter(index => index !== front);
  const levels = Math.ceil(behind.length / 2);
  return indexes.map(index => {
    const rank = behind.indexOf(index);
    if (index === front) return { index, front: true, x: 0, y: 0, angle: 0, z: indexes.length + 1 };
    const depth = Math.floor(rank / 2) + 1;
    const spread = depth / (levels + 1);
    const side = rank % 2 === 0 ? 1 : -1;
    const output = outputs[index];
    const ratio = output.width && output.height ? output.width / output.height : 1;
    const angleScale = Math.min(1, 1.4 / ratio);
    // All cards share the lower-left pivot; avoid sliding their anchors apart.
    return { index, front: false, x: 0, y: 0, angle: side * (4 + 12 * spread) * angleScale, z: indexes.length - rank };
  });
}

export function GeneratedImageHand({ outputs, selected, en = false, onSelect, renderImage }: {
  outputs: HandImage[];
  selected: number;
  en?: boolean;
  onSelect: (index: number) => void;
  renderImage: (output: HandImage, index: number, emphasized: boolean) => ReactNode;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const cards = imageHandLayout(outputs, selected);
  return <div className="generated-image-hand nodrag" role="group" data-no-interface-translation
    aria-label={en ? 'Generated images. Hover to lift; click to bring forward.' : '生成结果：悬停抬起，点击置于最前'}>
    {cards.map((card, position) => <button type="button" key={`${outputs[card.index].mediaUrl}-${card.index}`}
      ref={button => { if (button) buttons.current.set(card.index, button); else buttons.current.delete(card.index); }}
      className={`image-hand-card${card.front ? ' is-front' : ''}${hovered === card.index || focused === card.index ? ' is-raised' : ''}`}
      style={{ '--hand-x': `${card.x}%`, '--hand-y': `${card.y}%`, '--hand-angle': `${card.angle}deg`, '--hand-z': card.z } as CSSProperties}
      aria-pressed={card.front} aria-label={en ? `Image ${position + 1} of ${cards.length}${card.front ? ', front' : ', bring forward'}` : `第 ${position + 1} 张，共 ${cards.length} 张${card.front ? '，当前前排' : '，点击置前'}`}
      onPointerDown={event => event.stopPropagation()}
      onPointerEnter={event => { if (event.pointerType !== 'touch') { setHovered(card.index); setFocused(null); } }}
      onPointerLeave={() => setHovered(value => value === card.index ? null : value)}
      onPointerCancel={() => setHovered(null)}
      onFocus={() => { setFocused(card.index); setHovered(null); }} onBlur={() => setFocused(null)}
      onClick={event => { event.stopPropagation(); setHovered(null); setFocused(null); onSelect(card.index); }}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', ' ', 'Enter'].includes(event.key)) return;
        event.stopPropagation();
        if (event.key === ' ' || event.key === 'Enter') return; // Native button activation.
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : (position + (event.key === 'ArrowRight' ? 1 : -1) + cards.length) % cards.length;
        buttons.current.get(cards[next].index)?.focus();
      }}>
      <span className="image-hand-surface">
        {renderImage(outputs[card.index], card.index, card.front || hovered === card.index || focused === card.index)}
        <span className="image-hand-index" aria-hidden="true">{String(position + 1).padStart(2, '0')}{card.front && <small> / {cards.length}</small>}</span>
      </span>
    </button>)}
  </div>;
}
