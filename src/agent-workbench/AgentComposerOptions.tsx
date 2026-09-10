import { useEffect, useRef } from 'react';
import { UiIcon } from '../components/UiIcon';
import type { AgentApprovalMode } from './approval-mode';
import './AgentComposerOptions.css';

const modes: { value: AgentApprovalMode; label: string; detail: string }[] = [
  { value: 'ask', label: '请求批准', detail: '修改画布、读取素材与生成前请求确认。' },
  { value: 'assist', label: '帮我批准', detail: '自动批准创建和连线；覆盖、删除与付费生成仍需确认。' },
  { value: 'full', label: '完全访问权限', detail: '仅当前画布：允许删除、覆盖、读取素材及付费生成，不再逐项确认。受现有额度限制；在当前浏览器记住选择，可随时改回请求批准。' },
];
const effortNames: Record<string, string> = { none: '无', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: '超高' };
export function AgentComposerOptions({ mode, onMode, models, model, effort, onModel, onEffort, active }: {
  mode: AgentApprovalMode; onMode: (value: AgentApprovalMode) => void;
  models: { id: string; model: string; name: string; efforts: { value: string }[] }[];
  model: string; effort: string; onModel: (value: string) => void; onEffort: (value: string) => void; active: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const close = (focus = false) => root.current?.querySelectorAll('details[open]').forEach(element => {
    (element as HTMLDetailsElement).open = false;
    if (focus) element.querySelector('summary')?.focus();
  });
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  useEffect(() => { close(); }, [active]);
  const selected = models.find(item => item.model === model);
  return <div className="agent-composer-options" ref={root} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <details className="agent-option-menu" onToggle={event => { if (event.currentTarget.open) root.current?.querySelectorAll('details').forEach(other => { if (other !== event.currentTarget) other.open = false; }); }}>
      <summary aria-label="审批模式"><UiIcon name="lock" />{modes.find(item => item.value === mode)?.label}<UiIcon name="chevronDown" /></summary>
      <div className="agent-option-panel"><fieldset><legend>画布操作权限</legend>{modes.map(item => <label key={item.value}><input type="radio" name="composer-approval" checked={mode === item.value} onChange={() => { onMode(item.value); close(true); }} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}</fieldset></div>
    </details>
    {!!models.length && <details className="agent-option-menu agent-model-menu" onToggle={event => { if (event.currentTarget.open) root.current?.querySelectorAll('details').forEach(other => { if (other !== event.currentTarget) other.open = false; }); }}>
      <summary aria-label="模型与思考强度"><span>{selected?.name || model}</span><span>{effortNames[effort] || effort}</span><UiIcon name="chevronDown" /></summary>
      <div className="agent-option-panel"><fieldset disabled={active}><legend>模型</legend>{models.map(item => <label key={item.id}><input type="radio" name="composer-model" checked={model === item.model} onChange={() => onModel(item.model)} /><span>{item.name}</span></label>)}</fieldset>
        {!!selected?.efforts.length && <fieldset className="agent-effort-slider" disabled={active}><legend>思考强度</legend><div className="agent-effort-title"><UiIcon name="spark" /><span><strong>{effortNames[effort] || effort}</strong><small>{selected.name}</small></span></div><input type="range" aria-label="思考强度" min={0} max={Math.max(0, selected.efforts.length - 1)} step={1} value={Math.max(0, selected.efforts.findIndex(item => item.value === effort))} disabled={active || selected.efforts.length < 2} onChange={event => onEffort(selected.efforts[Number(event.target.value)].value)} /><div className="agent-effort-ticks">{selected.efforts.map(item => <button key={item.value} type="button" aria-label={effortNames[item.value] || item.value} aria-pressed={item.value === effort} onClick={() => onEffort(item.value)}>•</button>)}</div></fieldset>}
        {active && <p>本轮运行中，停止或完成后可切换模型。</p>}
      </div>
    </details>}
  </div>;
}
