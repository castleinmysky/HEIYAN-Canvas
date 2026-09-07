/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */
import { useEffect, useRef, useState } from 'react';
import {
  characterProportionGuideUrl,
  characterTurnaroundHeadRatios,
  characterTurnaroundPoses,
  characterTurnaroundRatioFeel,
  type CharacterTurnaroundHeadRatio,
  type CharacterTurnaroundPose,
} from '../character-turnaround';
import './CharacterProportionSelector.css';

export type CharacterProportionSelectorState = 'default' | 'hover' | 'focus' | 'active' | 'disabled' | 'loading' | 'error' | 'success';

const proportionDescriptions: Record<CharacterTurnaroundHeadRatio, string> = {
  1: '头脸与身体融合为一个主体，适合吉祥物、图标和表情角色。',
  1.5: '完整大头加压缩身体，适合战斗头像、徽章与表情角色。',
  2: '独立大头与短小身体，适合经典玩具感 Q 版角色。',
  3.5: '保留完整人形结构，同时强化可爱感与动作辨识度。',
  4: '紧凑稳定的风格化人形，适合游戏角色与标准化建模。',
  6.5: '自然手游角色比例，兼顾亲和力、动作和服装表现。',
  7.5: '更修长的英雄体态，适合成熟角色和完整服装设计。',
  8: '接近写实英雄比例，头部较小，四肢舒展且稳定。',
  9: '超模与神性英雄比例，强调高挑、长腿和压迫感。',
};

export function ratioForSelectorIndex(index: number): CharacterTurnaroundHeadRatio {
  const safeIndex = Math.min(characterTurnaroundHeadRatios.length - 1, Math.max(0, Math.round(index)));
  return characterTurnaroundHeadRatios[safeIndex];
}

export function selectorIndexForRatio(headRatio: CharacterTurnaroundHeadRatio) {
  return Math.max(0, characterTurnaroundHeadRatios.indexOf(headRatio));
}

type CharacterProportionSelectorProps = {
  selectedHeadRatio: CharacterTurnaroundHeadRatio;
  selectedPose: CharacterTurnaroundPose;
  onChange: (headRatio: CharacterTurnaroundHeadRatio, pose: CharacterTurnaroundPose) => void;
  visualState?: CharacterProportionSelectorState;
};

export function CharacterProportionSelector({ selectedHeadRatio, selectedPose, onChange, visualState = 'default' }: CharacterProportionSelectorProps) {
  const [draftRatio, setDraftRatio] = useState(selectedHeadRatio);
  const [draftPose, setDraftPose] = useState(selectedPose);
  const pendingChangeRef = useRef<{ headRatio: CharacterTurnaroundHeadRatio; pose: CharacterTurnaroundPose } | null>(null);
  const changeTimerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  const disabled = visualState === 'disabled' || visualState === 'loading';

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => setDraftRatio(selectedHeadRatio), [selectedHeadRatio]);
  useEffect(() => setDraftPose(selectedPose), [selectedPose]);
  useEffect(() => () => {
    if (changeTimerRef.current != null) window.clearTimeout(changeTimerRef.current);
    const pendingChange = pendingChangeRef.current;
    if (pendingChange) onChangeRef.current(pendingChange.headRatio, pendingChange.pose);
  }, []);

  const ratioIndex = selectorIndexForRatio(draftRatio);
  const structureHint = draftRatio <= 2
    ? '1、1.5、2 头身使用不同身体结构，不进行普通线性缩放。'
    : draftRatio <= 4
      ? '当前属于风格化人形区间，骨架会保持完整但明显压缩。'
      : '当前属于标准与修长人形区间，比例变化集中在躯干与腿长。';
  const scheduleChange = (headRatio: CharacterTurnaroundHeadRatio, pose: CharacterTurnaroundPose) => {
    pendingChangeRef.current = { headRatio, pose };
    if (changeTimerRef.current != null) window.clearTimeout(changeTimerRef.current);
    changeTimerRef.current = window.setTimeout(() => {
      const pendingChange = pendingChangeRef.current;
      pendingChangeRef.current = null;
      changeTimerRef.current = null;
      if (pendingChange) onChangeRef.current(pendingChange.headRatio, pendingChange.pose);
    }, 80);
  };
  const changeRatio = (nextRatio: CharacterTurnaroundHeadRatio) => {
    setDraftRatio(nextRatio);
    scheduleChange(nextRatio, draftPose);
  };
  const changePose = (nextPose: CharacterTurnaroundPose) => {
    setDraftPose(nextPose);
    scheduleChange(draftRatio, nextPose);
  };

  return <section className={`character-proportion-selector is-${visualState}`} data-state={visualState} aria-label="头身比例选择器" aria-busy={visualState === 'loading'}>
    <figure className="character-proportion-preview">
      <div className="character-proportion-preview-image">
        <img src={characterProportionGuideUrl(draftRatio, draftPose)} alt={`${draftRatio} 头身 ${draftPose} 正面比例骨架预览`} draggable={false} />
      </div>
      <figcaption><strong>{draftRatio === 1 ? '1 头身团子体' : `${draftRatio} 头身`}</strong><span>{draftPose} 比例骨架</span></figcaption>
    </figure>

    <div className="character-proportion-controls">
      <header className="character-proportion-summary">
        <div><strong>{draftRatio} 头身</strong><span>{characterTurnaroundRatioFeel[draftRatio]}</span></div>
        <p>{proportionDescriptions[draftRatio]}</p>
      </header>

      <div className="character-proportion-scale">
        <div className="character-proportion-zones" aria-hidden="true">
          <strong>团子 / Q 版</strong><strong>风格化人形</strong><strong>标准 / 修长人形</strong>
        </div>
        <label className="character-proportion-range-label" htmlFor="character-proportion-range">头身比</label>
        <input
          id="character-proportion-range"
          className="character-proportion-range nodrag nowheel"
          type="range"
          min="0"
          max={characterTurnaroundHeadRatios.length - 1}
          step="1"
          value={ratioIndex}
          disabled={disabled}
          aria-valuetext={`${draftRatio} 头身，${characterTurnaroundRatioFeel[draftRatio]}`}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => changeRatio(ratioForSelectorIndex(Number(event.currentTarget.value)))}
        />
        <div className="character-proportion-ticks" aria-hidden="true">
          {characterTurnaroundHeadRatios.map((headRatio) => <span key={headRatio} className={headRatio === draftRatio ? 'active' : ''}>{headRatio}</span>)}
        </div>
        <p className="character-proportion-structure-hint"><span aria-hidden="true">ⓘ</span>{structureHint}</p>
      </div>

      <div className="character-proportion-pose-row">
        <strong>姿态</strong>
        <div role="group" aria-label="选择角色姿态">
          {characterTurnaroundPoses.map((pose) => <button type="button" key={pose} className={pose === draftPose ? 'active' : ''} aria-pressed={pose === draftPose} disabled={disabled} onClick={() => changePose(pose)}>{pose}</button>)}
        </div>
      </div>

      <p className="character-proportion-feedback" role={visualState === 'error' ? 'alert' : 'status'}>
        {visualState === 'error'
          ? '比例结构未能同步，请重新选择后再试。'
          : visualState === 'loading'
            ? '正在同步生成节点与比例参考…'
            : visualState === 'success'
              ? '已自动同步到生成节点与比例参考。'
              : '拖动头身比或切换姿态后，生成节点、提示词与比例参考会自动同步。'}
      </p>
    </div>
  </section>;
}
