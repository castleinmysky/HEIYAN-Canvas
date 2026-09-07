import { CharacterProportionSelector, type CharacterProportionSelectorState } from './CharacterProportionSelector';

const previewStates: CharacterProportionSelectorState[] = ['default', 'hover', 'focus', 'active', 'disabled', 'loading', 'error', 'success'];

export function CharacterProportionSelectorPreview() {
  return <main>{previewStates.map((state) => <section key={state} aria-label={`${state} state`}><h2>{state}</h2><CharacterProportionSelector selectedHeadRatio={1.5} selectedPose="T-Pose" visualState={state} onChange={() => undefined} /></section>)}</main>;
}
