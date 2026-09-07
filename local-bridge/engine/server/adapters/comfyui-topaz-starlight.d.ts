export type ComfyUiTopazPromptNode = { class_type: string; inputs: Record<string, unknown> };

export function buildComfyUiTopazStarlightPrompt(options?: {
  video?: string;
  model?: string;
  vram?: number;
  scale?: number;
  strength?: number;
  inputQuality?: number;
  sharpness?: string;
  filenamePrefix?: string;
}): Record<string, ComfyUiTopazPromptNode>;

export function inspectComfyUiTopazStarlight(
  config?: Record<string, unknown>,
  fetchImpl?: typeof fetch,
): Promise<{ available: boolean; baseUrl: string; error: string }>;

export function comfyUiTopazStarlightHistoryOutput(
  entry: Record<string, any>,
  options?: {
    baseUrl?: string;
    promptId?: string;
    model?: string;
    vram?: number;
    scale?: number;
    strength?: number;
    inputQuality?: number;
    sharpness?: string;
  },
): { mediaType: 'video'; mediaUrl: string; fileName: string; metadata: Record<string, any> } | null;

export function createComfyUiTopazStarlightAdapter(
  model: { id?: string; config?: Record<string, unknown> },
  fetchImpl?: typeof fetch,
): {
  kind: 'video';
  configured: true;
  run(job: Record<string, any>): Promise<{ outputs: Array<Record<string, any>>; usage: Record<string, any> }>;
};
