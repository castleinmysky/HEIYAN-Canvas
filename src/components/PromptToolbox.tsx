import { useState } from 'react';
import { characterTurnaroundPose, type CharacterTurnaroundHeadRatio, type CharacterTurnaroundPose } from '../character-turnaround';
import { modelingStyleDefinition, modelingStyleDefinitions, type ModelingStyleId } from '../modeling-style';
import { CharacterProportionSelector, type CharacterProportionSelectorState } from './CharacterProportionSelector';
import './PromptToolbox.css';

type PromptToolId = 'proportion' | 'modeling-style';

type PromptToolboxProps = {
  selectedHeadRatio: CharacterTurnaroundHeadRatio;
  selectedPose?: CharacterTurnaroundPose;
  selectedModelingStyle?: ModelingStyleId;
  proportionState?: CharacterProportionSelectorState;
  onApplyProportion: (headRatio: CharacterTurnaroundHeadRatio, pose: CharacterTurnaroundPose) => void;
  onApplyModelingStyle: (styleId?: ModelingStyleId) => void;
  onClose: () => void;
};

function ToolButton({ active, complete, icon, title, description, badge, disabled, onClick }: {
  active?: boolean;
  complete?: boolean;
  icon: string;
  title: string;
  description: string;
  badge?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return <button type="button" className={`prompt-tool-button${active ? ' active' : ''}${complete ? ' complete' : ''}`} disabled={disabled} onClick={onClick}>
    <span className="prompt-tool-icon" aria-hidden="true">{icon}</span>
    <span><strong>{title}</strong><small>{description}</small></span>
    {badge && <em>{badge}</em>}
  </button>;
}

function ModelingStyleSelector({ selectedStyle, onChange }: { selectedStyle?: ModelingStyleId; onChange: (styleId?: ModelingStyleId) => void }) {
  const activeStyle = selectedStyle ? modelingStyleDefinition(selectedStyle) : undefined;
  return <section className="modeling-style-selector" aria-label="建模画风锁定">
    <header className="prompt-tool-detail-header">
      <div><small>专业稳定模式</small><strong>建模画风契约</strong></div>
      <p>不是追加几个风格词，而是同时锁定造型、着色、材质、轮廓、灯光和禁用项，减少同一角色反复抽卡。</p>
      <div className="style-stability-badge"><b>STRICT</b><span>6 个维度统一约束</span><i>跨视图复核</i></div>
    </header>

    <div className="modeling-style-grid">
      {modelingStyleDefinitions.map((style) => <button
        type="button"
        key={style.id}
        className={`modeling-style-card style-${style.id}${selectedStyle === style.id ? ' active' : ''}`}
        aria-pressed={selectedStyle === style.id}
        onClick={() => onChange(style.id)}
      >
        <span className="modeling-style-visual" aria-hidden="true"><i /><i /><i /></span>
        <span className="modeling-style-card-copy"><small>{style.eyebrow}</small><strong>{style.label}</strong><p>{style.description}</p><em>{style.suitableFor}</em></span>
        <b className="modeling-style-check">{selectedStyle === style.id ? '✓' : '+'}</b>
      </button>)}
    </div>

    <div className={`style-contract-preview${activeStyle ? ' has-contract' : ''}`}>
      {activeStyle ? <>
        <header><div><small>当前契约</small><strong>{activeStyle.label}</strong></div><span>已写入提示词</span></header>
        <dl>
          <div><dt>造型</dt><dd>{activeStyle.contract.form}</dd></div>
          <div><dt>着色</dt><dd>{activeStyle.contract.shading}</dd></div>
          <div><dt>材质</dt><dd>{activeStyle.contract.material}</dd></div>
          <div><dt>灯光</dt><dd>{activeStyle.contract.lighting}</dd></div>
        </dl>
        <footer><span>切换契约时会替换旧画风段落，不会重复堆叠提示词。</span><button type="button" onClick={() => onChange(undefined)}>清除画风锁定</button></footer>
      </> : <><strong>尚未锁定建模画风</strong><span>选择上方任一专业契约后，会保留现有角色描述并写入固定画风规范。</span></>}
    </div>
  </section>;
}

export function PromptToolbox({ selectedHeadRatio, selectedPose = characterTurnaroundPose, selectedModelingStyle, proportionState = 'default', onApplyProportion, onApplyModelingStyle, onClose }: PromptToolboxProps) {
  const [activeTool, setActiveTool] = useState<PromptToolId>('proportion');
  return <section className="prompt-toolbox">
    <header className="prompt-toolbox-header">
      <div><span className="prompt-toolbox-mark" aria-hidden="true">▦</span><span><strong>角色三视图工具</strong><small>统一角色比例、站姿与建模视觉语言</small></span></div>
      <div className="prompt-toolbox-summary"><span><b>1</b> 个生产工具</span><span><b>{selectedModelingStyle ? 2 : 1}</b> 个已启用约束</span></div>
      <button type="button" className="prompt-toolbox-close" aria-label="关闭角色三视图工具" onClick={onClose}>×</button>
    </header>

    <div className="prompt-toolbox-layout">
      <nav className="prompt-toolbox-nav" aria-label="提示词工具分类">
        <small>生产工具</small>
        <ToolButton active complete icon="三" title="角色三视图" description="比例、姿态与建模画风" badge="使用中" />
        <small>其他工具</small>
        <ToolButton disabled icon="镜" title="镜头与构图" description="正交、景别与机位规范" badge="后续" />
        <ToolButton disabled icon="光" title="材质与灯光" description="独立材质棚拍规范" badge="后续" />
      </nav>

      <main className="prompt-toolbox-content">
        <div className="prompt-toolbox-breadcrumb"><span>角色三视图工具</span><b>›</b><strong>生产约束</strong></div>
        <div className="prompt-toolbox-subtools" role="tablist" aria-label="角色三视图子工具">
          <button type="button" role="tab" aria-selected={activeTool === 'proportion'} className={activeTool === 'proportion' ? 'active' : ''} onClick={() => setActiveTool('proportion')}><span>比</span><strong>人体比例</strong><small>{selectedHeadRatio} 头身 · {selectedPose}</small><em>结构</em></button>
          <button type="button" role="tab" aria-selected={activeTool === 'modeling-style'} className={activeTool === 'modeling-style' ? 'active' : ''} onClick={() => setActiveTool('modeling-style')}><span>材</span><strong>建模画风</strong><small>{selectedModelingStyle ? modelingStyleDefinition(selectedModelingStyle).shortLabel : '待选择专业契约'}</small><em>{selectedModelingStyle ? '已锁定' : 'NEW'}</em></button>
        </div>
        {activeTool === 'proportion' ? <section className="prompt-tool-proportion">
          <header className="prompt-tool-detail-header compact"><div><small>角色三视图 · 结构约束</small><strong>人体比例与标准姿态</strong></div><p>这是三视图工具的结构模块：锁定骨架比例并自动关联参考图；建模画风契约会继续保留。</p></header>
          <CharacterProportionSelector selectedHeadRatio={selectedHeadRatio} selectedPose={selectedPose} onChange={onApplyProportion} visualState={proportionState} />
        </section> : <ModelingStyleSelector selectedStyle={selectedModelingStyle} onChange={onApplyModelingStyle} />}
      </main>
    </div>

    <footer className="prompt-toolbox-footer"><span><b>角色三视图组合规则</b> 人体比例负责结构，建模画风负责视觉语言，两者独立替换、同时生效。</span><small>所有契约都会写入当前生成节点并随画布保存。</small></footer>
  </section>;
}
