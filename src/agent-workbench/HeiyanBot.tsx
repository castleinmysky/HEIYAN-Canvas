import { memo, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties } from 'react';
import type { BotPose } from './living-state';
import { BOT_FACES, botBodyTransform, botEyePath, botEyeTransform, botFaceWithTarget, botFeatureTransform, botShellPath, botSpecularGeometry, type BotLookTarget } from './bot-motion';
import { useBotMorph } from './use-bot-morph';
import { useBotChoreography } from './use-bot-choreography';
import './HeiyanBot.css';

/** A UI character, not another Agent. Animation never calls models or writes canvas state. */
export const HeiyanBot = memo(function HeiyanBot({ pose, expression = pose, completionAt = 0, motionKey = '', label, open, attention = false, noticing = false, lookTarget, disabled = false, dragging = false, dragLean = 0, onClick, dragProps }: {
  pose: BotPose; label: string; open: boolean; attention?: boolean; noticing?: boolean; disabled?: boolean; onClick: () => void;
  expression?: BotPose; completionAt?: number; motionKey?: string; lookTarget?: BotLookTarget; dragging?: boolean; dragLean?: number;
  dragProps?: Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onKeyDown' | 'onClickCapture'>;
}) {
  const surface = useId();
  const button = useRef<HTMLButtonElement>(null), svg = useRef<SVGSVGElement>(null);
  const [paused, setPaused] = useState(() => typeof document === 'undefined' || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [waking, setWaking] = useState(false), previousOpen = useRef(open);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPaused(document.hidden || media.matches);
    update(); document.addEventListener('visibilitychange', update); media.addEventListener('change', update);
    return () => { document.removeEventListener('visibilitychange', update); media.removeEventListener('change', update); };
  }, []);
  useEffect(() => {
    const wake = open && !previousOpen.current && !paused && !disabled;
    previousOpen.current = open; setWaking(wake);
    if (wake) { const timer = window.setTimeout(() => setWaking(false), 420); return () => window.clearTimeout(timer); }
  }, [open, paused, disabled]);
  useEffect(() => {
    if (paused || disabled || dragging || lookTarget?.active) { button.current?.style.setProperty('--bot-look-x', '0px'); button.current?.style.setProperty('--bot-look-y', '0px'); }
  }, [paused, disabled, dragging, lookTarget?.active]);
  useBotMorph(svg, expression, paused || disabled, lookTarget);
  useBotChoreography(svg, expression, motionKey, paused || disabled || dragging);
  // Initial geometry stays stable in React; the finite morph renderer owns SVG attributes.
  const initial = useRef(botFaceWithTarget(BOT_FACES[expression], lookTarget)).current;
  const specular = botSpecularGeometry(initial);
  const doneDelay = useMemo(() => completionAt ? -Math.max(0, Date.now() - completionAt) : 0, [completionAt]);
  const clearLook = () => { button.current?.style.setProperty('--bot-look-x', '0px'); button.current?.style.setProperty('--bot-look-y', '0px'); };
  return <button ref={button} type="button" className="heiyan-bot" data-pose={pose} data-expression={expression} data-noticing={noticing || undefined}
    data-motion-paused={paused || disabled || undefined} data-waking={waking || undefined} data-dragging={dragging || undefined} data-targeting={lookTarget?.active || undefined} data-open={open}
    style={{ '--bot-drag-lean': `${Math.max(-8, Math.min(8, dragLean))}deg`, '--bot-done-delay': `${doneDelay}ms` } as CSSProperties}
    aria-label={open ? '收起 HEIYAN Bot 会话' : `唤醒 HEIYAN Bot · ${label}`} aria-expanded={open}
    aria-controls="heiyan-living-content" title={dragProps ? `${label} · ${open ? '按住拖动停靠会话' : '按住拖动调整位置'}` : label} disabled={disabled} onClick={onClick}
    aria-description={dragProps ? open ? '按住可将完整会话停靠到左侧、右侧或底部中央。也可按 Alt 加方向键直接停靠。' : '按住可在画布中下方自由移动；靠近左侧、右侧或底部中央时自动吸附。也可按 Alt 加方向键直接停靠。' : undefined}
    aria-keyshortcuts={dragProps ? 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowDown' : undefined} {...dragProps}
    onPointerMove={event => {
      dragProps?.onPointerMove?.(event);
      if (paused || disabled || dragging || lookTarget?.active || event.buttons || event.pointerType !== 'mouse' || !['idle','done'].includes(pose)) return;
      const rect = event.currentTarget.getBoundingClientRect();
      event.currentTarget.style.setProperty('--bot-look-x', `${Math.max(-2.2, Math.min(2.2, (event.clientX - rect.left - rect.width / 2) / rect.width * 4.4))}px`);
      event.currentTarget.style.setProperty('--bot-look-y', `${Math.max(-1.6, Math.min(1.6, (event.clientY - rect.top - rect.height / 2) / rect.height * 3.2))}px`);
    }} onPointerLeave={clearLook} onBlur={clearLook}>
    <svg ref={svg} className="heiyan-bot-avatar" viewBox="0 0 64 64" aria-hidden="true">
      <defs><radialGradient className="heiyan-bot-light" id={surface} cx={`${30 + initial.yaw * .85}%`} cy={`${22 + initial.pitch * .55}%`} r="86%"><stop offset="0" stopColor="var(--bot-highlight)"/><stop offset=".65" stopColor="var(--bot-porcelain)"/><stop offset="1" stopColor="var(--bot-shade)"/></radialGradient><radialGradient className="heiyan-bot-depth" id={`${surface}-depth`} cx={`${76 - initial.yaw * .72}%`} cy={`${70 - initial.pitch * .35}%`} r="72%"><stop offset=".34" stopColor="var(--bot-clear)"/><stop offset="1" stopColor="var(--bot-volume)"/></radialGradient><clipPath id={`${surface}-clip`}><path className="heiyan-bot-clip" d={botShellPath(initial)} /></clipPath></defs>
      <g className="heiyan-bot-drag"><g className="heiyan-bot-press"><g className="heiyan-bot-gesture"><g className="heiyan-bot-wake"><g className="heiyan-bot-breath"><g className="heiyan-bot-body" transform={botBodyTransform(initial)}>
        <path className="heiyan-bot-shell" style={{ fill: `url(#${surface})` }} d={botShellPath(initial)} />
        <path className="heiyan-bot-shell-shade" style={{ fill: `url(#${surface}-depth)` }} d={botShellPath(initial)} />
        <ellipse className="heiyan-bot-specular" clipPath={`url(#${surface}-clip)`} cx={specular.cx} cy={specular.cy} rx={specular.rx} ry={specular.ry} transform={`rotate(${specular.rotate} ${specular.cx} ${specular.cy})`} />
        <g className="heiyan-bot-gaze" transform={botFeatureTransform(initial)}><g className="heiyan-bot-observe"><g className="heiyan-bot-pointer"><g className="heiyan-bot-scan"><g className="heiyan-bot-eyes">
          <path className="heiyan-bot-eye-left" d={botEyePath(initial.leftW, initial.leftH, initial.smile)} transform={botEyeTransform(initial, 'left')} />
          <path className="heiyan-bot-eye-right" d={botEyePath(initial.rightW, initial.rightH, initial.smile)} transform={botEyeTransform(initial, 'right')} />
        </g></g></g></g></g>
        <g className="heiyan-bot-thought-cluster" aria-hidden="true">
          <g className="heiyan-bot-thought-dot is-left"><circle cx="18" cy="34" r="6.4"/></g>
          <g className="heiyan-bot-thought-dot is-center"><circle cx="32" cy="28" r="8.2"/></g>
          <g className="heiyan-bot-thought-dot is-right"><circle cx="47" cy="35" r="5.8"/></g>
        </g>
        <g className="heiyan-bot-state-signature heiyan-bot-processing-flow" aria-hidden="true">
          <path className="heiyan-bot-processing-arc is-intake" d="M11 16C6 21 4.5 28 6 35"/>
          <path className="heiyan-bot-processing-arc is-release" d="M53 48C58 43 59.5 36 58 29"/>
          <circle className="heiyan-bot-processing-spark is-main" cx="51" cy="11" r="2.2"/>
          <circle className="heiyan-bot-processing-spark is-trace" cx="57" cy="18" r="1.15"/>
        </g>
        <g className="heiyan-bot-state-signature heiyan-bot-reading-card" aria-hidden="true">
          <rect className="heiyan-bot-reading-paper" x="-5" y="20" width="17" height="24" rx="4"/>
          <rect className="heiyan-bot-reading-mark" x="-1" y="27" width="8" height="2.4" rx="1.2"/><rect className="heiyan-bot-reading-mark" x="-1" y="34" width="6" height="2.4" rx="1.2"/>
        </g>
        <g className="heiyan-bot-state-signature heiyan-bot-execution-trail" aria-hidden="true">
          <rect x="1" y="25" width="8" height="4" rx="2"/><rect x="-3" y="34" width="12" height="4" rx="2"/><rect x="2" y="43" width="7" height="4" rx="2"/>
        </g>
        <g className="heiyan-bot-state-signature heiyan-bot-wait-base" aria-hidden="true">
          <rect x="21" y="59" width="22" height="3" rx="1.5"/>
        </g>
        <g className="heiyan-bot-state-signature heiyan-bot-review-frame" aria-hidden="true">
          <path d="M3 19V4H18M46 4H61V19M61 45V60H46M18 60H3V45"/>
        </g>
        <g className="heiyan-bot-state-signature heiyan-bot-question-cue" aria-hidden="true">
          <path d="M35 20Q42 15 49 20"/>
        </g>
        <g className="heiyan-bot-state-signature heiyan-bot-approval-rails" aria-hidden="true">
          <rect x="3" y="20" width="4" height="24" rx="2"/><rect x="57" y="20" width="4" height="24" rx="2"/>
        </g>
        <g className="heiyan-bot-state-signature heiyan-bot-sleep-cue" aria-hidden="true">
          <path className="is-large" d="M7 14H15L7 22H15"/>
          <path className="is-small" d="M3 7H8L3 12H8"/>
        </g>
      </g></g></g></g></g></g>
    </svg>
    {attention && <span className="heiyan-bot-attention" aria-hidden="true" />}
  </button>;
});
