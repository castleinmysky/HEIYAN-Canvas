import type { ModelInfo, SupportedCanvasNodeKind } from './components/CanvasNodes';

export type CanvasCapabilityModuleId = 'comfyui';
type CanvasCapabilityModel = Pick<ModelInfo, 'adapter'> & { enabled?: boolean };

export function canvasCapabilityModuleEnabled(models: readonly CanvasCapabilityModel[], moduleId: CanvasCapabilityModuleId) {
  if (moduleId === 'comfyui') {
    return models.some((model) => model.enabled !== false && String(model.adapter || '').startsWith('comfyui-'));
  }
  return false;
}

export function canvasToolVisible(kind: SupportedCanvasNodeKind, models: readonly CanvasCapabilityModel[]): boolean {
  return kind !== 'audioGenerator' && (kind !== 'comfyUiWorkflow' || canvasCapabilityModuleEnabled(models, 'comfyui'));
}
