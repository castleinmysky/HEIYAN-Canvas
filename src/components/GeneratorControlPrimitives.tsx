import { UiIcon, type UiIconName } from './UiIcon';

/** Shared presentation only: generation state remains owned by its node. */
export function GeneratorControlCardContent({ icon, label, value, expanded }: { icon: UiIconName; label: string; value: string; expanded: boolean }) {
  return <>
    <span className="generator-control-card__icon"><UiIcon name={icon} /></span>
    <span className="generator-control-card__copy"><small>{label}</small><strong>{value}</strong></span>
    <UiIcon name="chevronDown" className={`generator-control-card__chevron${expanded ? ' is-open' : ''}`} />
  </>;
}

export function generationRatioIconGeometry(ratio: string) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(ratio || '').trim());
  if (!match) return { width: 22, height: 14, x: 4, y: 3, radius: 2.5, adaptive: true };
  const aspect = Number(match[1]) / Number(match[2]);
  const maxWidth = 26;
  const maxHeight = 16;
  const width = aspect >= maxWidth / maxHeight ? maxWidth : maxHeight * aspect;
  const height = aspect >= maxWidth / maxHeight ? maxWidth / aspect : maxHeight;
  return {
    width: Number(width.toFixed(3)),
    height: Number(height.toFixed(3)),
    x: Number(((30 - width) / 2).toFixed(3)),
    y: Number(((20 - height) / 2).toFixed(3)),
    radius: Number(Math.min(3, width / 5, height / 5).toFixed(3)),
    adaptive: false,
  };
}

export function GenerationRatioOption({ ratio }: { ratio: string }) {
  const frame = generationRatioIconGeometry(ratio);
  return <>
    <svg className={`generation-ratio-icon${frame.adaptive ? ' is-adaptive' : ''}`} viewBox="0 0 30 20" aria-hidden="true" focusable="false">
      <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} rx={frame.radius} />
      {frame.adaptive && <path d="M8 7V5h3M19 5h3v2M22 13v2h-3M11 15H8v-2" />}
    </svg>
    <span>{ratio}</span>
  </>;
}
