import type { GenerationProfile } from '../components/CanvasNodes';
import { GenerationRatioOption } from '../components/GeneratorControlPrimitives';
import { UiIcon } from '../components/UiIcon';
import { groupModelsByGeneration, modelPresentation, type GenerationKind } from '../model-settings-catalog';
// @ts-expect-error Reuse the canvas's existing, pure JavaScript profile contract.
import { publicGenerationProfile } from '../cloud/generation-options.js';
import { WorkbenchDialog } from './AgentWorkbench';

// Metadata fixtures, NOT a list of configured/connected accounts.
export const previewModels = [
  { id: 'gpt-image-2', name: 'GPT Image 2', capability: 'image', adapter: 'openai-image', config: { model: 'gpt-image-2' } },
  { id: 'gemini-image', name: 'Gemini', capability: 'image', adapter: 'gemini-image', config: { model: 'gemini-2.5-flash-image' } },
  { id: 'seedance-video', name: 'Seedance', capability: 'video', adapter: 'seedance-video', config: { model: 'doubao-seedance-2-0-260128' } },
  { id: 'minimax-video', name: 'MiniMax', capability: 'video', adapter: 'minimax-h3-video', config: { model: 'MiniMax-H3' } },
  { id: 'tripo3d-model', name: 'Tripo', capability: 'model', adapter: 'tripo3d-model', config: { model: 'v3.1-20260211' } },
] satisfies Array<{ id: string; name: string; capability: GenerationKind; adapter: string; config: { model: string } }>;
export type PreviewGeneration = { model: string; ratio: string; resolution: string; count: number; duration: number };
export const previewModel = (id: string) => previewModels.find(model => model.id === id) || previewModels[0];
export const previewProfile = (id: string): GenerationProfile => publicGenerationProfile(previewModel(id));
export function selectPreviewModel(id: string, current: PreviewGeneration): PreviewGeneration {
  const profile = previewProfile(id);
  return { model: previewModel(id).id,
    ratio: profile.ratios.includes(current.ratio) ? current.ratio : profile.defaultRatio,
    resolution: profile.resolutions.includes(current.resolution) ? current.resolution : profile.defaultResolution,
    count: Math.min(profile.count.max, Math.max(profile.count.min, current.count)),
    duration: current.duration >= profile.duration.min && current.duration <= profile.duration.max ? current.duration : profile.duration.default,
  };
}
export function previewSpecSummary(value: PreviewGeneration) {
  const model = previewModel(value.model);
  return model.capability === 'image' ? `${value.ratio} · ${value.resolution} · ${value.count} 张`
    : model.capability === 'video' ? `${value.ratio} · ${value.resolution} · ${value.duration} 秒`
    : value.resolution === 'DETAILED' ? '精细 · 1 个' : '标准 · 1 个';
}

export function PreviewModelMenu({ current, onChange, onClose }: { current: PreviewGeneration; onChange: (value: PreviewGeneration) => void; onClose: () => void }) {
  return <WorkbenchDialog title="选择生成模型" onClose={onClose}>
    <p>沿用节点模型列表与规格规则。以下为交互示例，不读取或连接你的 API。</p>
    <div className="aw-node-models">{groupModelsByGeneration(previewModels).map(group => <section key={group.id}><h3>{group.zh}</h3>{group.models.map(model => {
      const presentation = modelPresentation(model);
      return <button type="button" key={model.id} aria-pressed={current.model === model.id} onClick={() => { onChange(selectPreviewModel(model.id, current)); onClose(); }}>
        {presentation.icon ? <img src={presentation.icon} alt="" width="24" height="24" /> : <UiIcon name={group.icon} />}
        <span><strong>{presentation.name}</strong><small>{presentation.provider} · 示例配置</small></span>{current.model === model.id && <UiIcon name="check" />}
      </button>;
    })}</section>)}</div>
  </WorkbenchDialog>;
}

export function PreviewSpecMenu({ current, onChange, onClose }: { current: PreviewGeneration; onChange: (value: PreviewGeneration) => void; onClose: () => void }) {
  const profile = previewProfile(current.model), model = previewModel(current.model);
  return <WorkbenchDialog title="生成规格" onClose={onClose}>
    <div className="aw-node-specs">
      {model.capability !== 'model' && <fieldset><legend>构图比例</legend><div className="aw-ratio-options">{profile.ratios.map(ratio => <button type="button" key={ratio} aria-pressed={current.ratio === ratio} onClick={() => onChange({ ...current, ratio })}><GenerationRatioOption ratio={ratio} /></button>)}</div></fieldset>}
      <fieldset><legend>{model.capability === 'model' ? '几何质量' : '分辨率'}</legend><div>{profile.resolutions.map(resolution => <button type="button" key={resolution} aria-pressed={current.resolution === resolution} onClick={() => onChange({ ...current, resolution })}>{resolution === 'STANDARD' ? '标准' : resolution === 'DETAILED' ? '精细' : resolution}</button>)}</div></fieldset>
      {model.capability === 'image' && <fieldset><legend>生成数量</legend><div>{Array.from({ length: profile.count.max - profile.count.min + 1 }, (_, index) => profile.count.min + index).map(count => <button type="button" key={count} aria-pressed={current.count === count} onClick={() => onChange({ ...current, count })}>{count} 张</button>)}</div></fieldset>}
      {model.capability === 'video' && <label>视频时长（秒）<input type="number" min={profile.duration.min} max={profile.duration.max} value={current.duration} onChange={event => onChange({ ...current, duration: Math.min(profile.duration.max, Math.max(profile.duration.min, Number(event.target.value) || profile.duration.default)) })} /></label>}
    </div>
    <p>点击即更新本页节点草稿，不更改已经显示的结果，也不发起生成。</p>
    <button type="button" className="aw-primary" onClick={onClose}>完成</button>
  </WorkbenchDialog>;
}
