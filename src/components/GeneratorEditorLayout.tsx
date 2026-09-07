import type { ReactNode } from 'react';

/** Presentation slots only: model, prompt, references and submission stay owned by the node editor. */
export type GeneratorComposerOptions = {
  leadingControl: ReactNode;
  toolbar: ReactNode;
  presetsOpen: boolean;
  onSettings: () => void;
};

export function GeneratorEditorLayout({ composer, comfy = false, cancelling, header, prompt, delivery, controls, feedback, actions }: {
  composer?: GeneratorComposerOptions; comfy?: boolean; cancelling?: ReactNode;
  header: ReactNode; prompt: ReactNode; delivery?: ReactNode; controls: ReactNode; feedback?: ReactNode; actions: ReactNode;
}) {
  return <section className={`generator-editor-panel${comfy ? ' comfyui-generator-editor-panel' : ''} nodrag nowheel`} data-presentation={composer ? 'composer' : undefined} onPointerDown={(event) => event.stopPropagation()}>
    {cancelling}
    {composer ? <>
      <div className="generator-composer-options">{composer.leadingControl}{controls}</div>
      {header}
      <div className="generator-composer-writing">{prompt}</div>
      {feedback}
      <footer className="generator-composer-footer">{composer.toolbar}{actions}</footer>
    </> : <>
      <div className="generator-panel-connector" />
      <div className="generator-panel-scroll-body">{header}{prompt}{delivery}</div>
      <footer className={`generator-panel-footer${comfy ? ' comfyui-generator-footer nodrag nowheel' : ''}`}>{controls}{feedback}{actions}</footer>
    </>}
  </section>;
}
