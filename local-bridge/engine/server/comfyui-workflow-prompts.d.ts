export type ComfyUiFrontendWorkflow = Record<string, unknown> & { nodes: unknown[] };

export function mergeComfyUiPromptParts(...values: unknown[]): string;
export function applyComfyUiCanvasPromptsToWorkflow(
  workflow: ComfyUiFrontendWorkflow,
  prompts?: { positivePrompt?: string; negativePrompt?: string; positivePrefix?: string },
): ComfyUiFrontendWorkflow;
export function extractComfyUiCanvasPromptsFromWorkflow(workflow: unknown): {
  positivePrompt: string;
  negativePrompt: string;
};
export function stripComfyUiPromptPrefix(prompt: unknown, prefix: unknown): string;
export type ComfyUiCanvasState = {
  positivePrompt?: string;
  negativePrompt?: string;
  positivePrefix?: string;
  checkpoint?: string;
  ratio?: string;
  resolution?: string;
  comfySeedMode?: 'random' | 'fixed';
  seed?: number;
  comfySteps?: number;
  comfyCfg?: number;
  comfySampler?: string;
  comfyScheduler?: string;
  comfyDenoise?: number;
  referenceDenoise?: number;
  referenceImage?: string;
  maskImage?: string;
  characterLora?: string;
  characterLoraStrength?: number;
};
export function applyComfyUiCanvasStateToWorkflow(workflow: ComfyUiFrontendWorkflow, state?: ComfyUiCanvasState): ComfyUiFrontendWorkflow;
export function extractComfyUiCanvasStateFromWorkflow(workflow: unknown): ComfyUiCanvasState & { positivePrompt: string; negativePrompt: string };
export function applyComfyUiCanvasStateToPrompt(prompt: Record<string, unknown>, state?: ComfyUiCanvasState): Record<string, unknown> | null;
