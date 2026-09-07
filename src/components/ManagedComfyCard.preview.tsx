import type { CanvasInterfaceLanguage } from '../interface-language';
import { ManagedComfyCardView, initialManagedComfySnapshot } from './ManagedComfyCard';

export const managedComfyInteractionStates = ['default', 'hover', 'focus', 'active', 'disabled', 'loading', 'error', 'success'] as const;

export function ManagedComfyCardPreview({ language = 'en' }: { language?: CanvasInterfaceLanguage }) {
  const snapshot = { ...initialManagedComfySnapshot(), pending: false };
  return <div className="managed-comfy-state-preview">
    {managedComfyInteractionStates.map((state) => <ManagedComfyCardView key={state} snapshot={snapshot} language={language} forcedState={state} />)}
  </div>;
}
