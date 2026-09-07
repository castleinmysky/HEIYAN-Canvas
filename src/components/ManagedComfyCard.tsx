import { useEffect, useRef, useState } from 'react';
import { managedComfyInterfaceCopy, type CanvasInterfaceLanguage } from '../interface-language';
import {
  createManagedComfyClient,
  createManagedComfyController,
  type ManagedComfyController,
  type ManagedComfyControllerSnapshot,
  type ManagedComfyRequest,
  type ManagedComfyStateName,
} from '../managed-comfy-connection';
import { UiIcon } from './UiIcon';

const emptyState = { state: 'not-installed' as const, capabilityCount: 0, reasonCode: null };
export const initialManagedComfySnapshot = (): ManagedComfyControllerSnapshot => ({
  state: emptyState, lastSettledRealState: emptyState, pending: true, polling: false, preview: false, errorCode: null, success: false,
});

export type ManagedComfyCardViewProps = {
  snapshot: ManagedComfyControllerSnapshot;
  language: CanvasInterfaceLanguage;
  onAction?: () => void;
  onPreview?: () => void;
  onPreviewNext?: () => void;
  onPreviewExit?: () => void;
  forcedState?: 'default' | 'hover' | 'focus' | 'active' | 'disabled' | 'loading' | 'error' | 'success';
};

const actionByState: Record<ManagedComfyStateName, 'recheck' | 'connect' | 'starting' | 'disconnect' | 'verify'> = {
  'not-installed': 'recheck', installed: 'connect', starting: 'starting', connected: 'disconnect', 'repair-required': 'verify',
};

export function ManagedComfyCardView({ snapshot, language, onAction, onPreview, onPreviewNext, onPreviewExit, forcedState = 'default' }: ManagedComfyCardViewProps) {
  const copy = managedComfyInterfaceCopy(language);
  const state = snapshot.state;
  const action = actionByState[state.state];
  const loading = snapshot.pending || forcedState === 'loading';
  const disabled = loading || action === 'starting' || forcedState === 'disabled';
  const errorCode = forcedState === 'error' ? 'network_error' : snapshot.errorCode;
  const success = forcedState === 'success' || snapshot.success;
  const canPreview = !snapshot.preview && !loading && !errorCode && (snapshot.lastSettledRealState.state === 'not-installed' || snapshot.lastSettledRealState.state === 'installed');
  const cardClass = `managed-comfy-card state-${state.state} interaction-${forcedState}${loading ? ' is-loading' : ''}${errorCode ? ' is-error' : ''}${success ? ' is-success' : ''}`;

  return <section className={cardClass} aria-label={snapshot.preview ? copy.previewCardLabel : copy.cardLabel} aria-busy={loading || state.state === 'starting' ? 'true' : undefined}>
    <div className="managed-comfy-card-icon" aria-hidden="true"><UiIcon name="comfy" /></div>
    <div className="managed-comfy-card-copy">
      <h2>{copy.title}</h2>
      <p>{copy.description}</p>
    </div>
    <div className="managed-comfy-status" data-tone={errorCode ? 'error' : success ? 'success' : state.state === 'connected' ? 'success' : 'neutral'}>
      <span className="managed-comfy-status-mark" aria-hidden="true" />
      <span><strong>{copy.states[state.state]}</strong><small>{copy.details[state.state]}</small></span>
    </div>
    {state.state === 'connected' && <dl className="managed-comfy-facts">
      {state.bundle && <div><dt>{copy.bundle}</dt><dd>{state.bundle.version}</dd></div>}
      <div><dt>{copy.capabilities}</dt><dd>{state.capabilityCount}</dd></div>
    </dl>}
    {snapshot.preview && <div className="managed-comfy-preview-note" role="status"><UiIcon name="preview" />{copy.previewLabel}</div>}
    {errorCode && <p className="managed-comfy-feedback is-error" role="alert">{copy.errors[errorCode]}</p>}
    {success && !errorCode && <p className="managed-comfy-feedback is-success" role="status">{copy.success}</p>}
    <div className="managed-comfy-actions">
      {snapshot.preview ? <>
        <button type="button" className="managed-comfy-action primary" onClick={onPreviewNext}>{copy.previewNext}</button>
        <button type="button" className="managed-comfy-action secondary" onClick={onPreviewExit}>{copy.previewExit}</button>
      </> : <>
        <button type="button" className="managed-comfy-action primary" disabled={disabled} onClick={onAction}>{loading ? copy.loading : copy.actions[action]}</button>
        {canPreview && <button type="button" className="managed-comfy-action secondary" onClick={onPreview}><UiIcon name="preview" />{copy.preview}</button>}
      </>}
    </div>
  </section>;
}

export function ManagedComfyCard({
  language,
  request = fetch,
  onResourcesChanged,
}: {
  language: CanvasInterfaceLanguage;
  request?: ManagedComfyRequest;
  onResourcesChanged?: () => Promise<void> | void;
}) {
  const controllerRef = useRef<ManagedComfyController | null>(null);
  const [snapshot, setSnapshot] = useState<ManagedComfyControllerSnapshot>(initialManagedComfySnapshot);

  useEffect(() => {
    let mounted = true;
    const controller = createManagedComfyController({ client: createManagedComfyClient(request), onResourcesChanged });
    controllerRef.current = controller;
    const publishSnapshot = () => { if (mounted) setSnapshot(controller.getSnapshot()); };
    const unsubscribe = controller.subscribe(publishSnapshot);
    publishSnapshot();
    return () => {
      mounted = false;
      controllerRef.current = null;
      unsubscribe();
      controller.dispose();
    };
  }, [onResourcesChanged, request]);

  const performStateAction = () => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (snapshot.state.state === 'not-installed') void controller.recheck();
    else if (snapshot.state.state === 'installed') void controller.connect();
    else if (snapshot.state.state === 'connected') void controller.disconnect();
    else if (snapshot.state.state === 'repair-required') void controller.verifyQuick();
  };

  return <ManagedComfyCardView
    snapshot={snapshot}
    language={language}
    onAction={performStateAction}
    onPreview={() => controllerRef.current?.enterPreview()}
    onPreviewNext={() => controllerRef.current?.advancePreview()}
    onPreviewExit={() => controllerRef.current?.exitPreview()}
  />;
}
