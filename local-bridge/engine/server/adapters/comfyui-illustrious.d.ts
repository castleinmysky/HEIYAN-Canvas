export type ComfyUiIllustriousDimensions = { width: number; height: number };
export type ComfyUiPromptNode = { class_type: string; inputs: Record<string, any>; _meta?: { title?: string } };

export const ILLUSTRIOUS_CHARACTER_FINAL_WORKFLOW_ID: 'illustrious-character-final-v1';
export const SDXL_CHARACTER_CONSISTENCY_WORKFLOW_ID: 'sdxl-character-consistency-v1';
export const SDXL_POSE_WORKFLOW_ID: 'sdxl-pose-v1';
export const SDXL_HIGHRES_REFINE_WORKFLOW_ID: 'sdxl-highres-refine-v1';
export const ILLUSTRIOUS_HIGHRES_REFINE_WORKFLOW_ID: 'illustrious-highres-refine-v1';
export const SDXL_INSTANTID_WORKFLOW_ID: 'sdxl-instantid-v1';
export const SDXL_PULID_WORKFLOW_ID: 'sdxl-pulid-v1';
export const SDXL_INSTANTID_FACE_DETAIL_WORKFLOW_ID: 'sdxl-instantid-face-detail-v1';
export const ILLUSTRIOUS_INSTANTID_WORKFLOW_ID: 'illustrious-instantid-v1';
export const ILLUSTRIOUS_PULID_WORKFLOW_ID: 'illustrious-pulid-v1';
export const ILLUSTRIOUS_INSTANTID_FACE_DETAIL_WORKFLOW_ID: 'illustrious-instantid-face-detail-v1';
export const COMFYUI_IDENTITY_MODELS: Readonly<{ instantId: string; instantIdControlNet: string; pulid: string; faceDetector: string }>;
export const SDPOSE_CHECKPOINT: 'sdpose_wholebody_fp16.safetensors';
export const ILLUSTRIOUS_CONTROL_MODELS: Readonly<{ ipAdapter: string; clipVision: string; openPose: string; lineart: string }>;

export function comfyUiIllustriousBaseUrl(value?: unknown): string;
export function illustriousDimensions(ratio?: unknown): ComfyUiIllustriousDimensions;
export function illustriousOutputDimensions(ratio?: unknown, resolution?: unknown): ComfyUiIllustriousDimensions;
export function highResRefinementIntermediateDimensions(ratio?: unknown, resolution?: unknown): ComfyUiIllustriousDimensions;
export function comfyUiPreciseIdentityWorkflow(workflowId?: unknown): { method: 'instantid' | 'pulid'; faceDetailer: boolean } | null;
export function comfyUiPoseCacheKey(referenceBuffer: ArrayBuffer | ArrayBufferView | Buffer, poseEstimator?: 'sdpose' | 'dwpose', ratio?: string, referenceCacheKey?: string): string;
export function comfyUiIdentityCacheName(referenceBuffer: ArrayBuffer | ArrayBufferView | Buffer, fileName?: string, mimeType?: string, referenceCacheKey?: string): string;
export function buildComfyUiPosePreviewPrompt(options?: { referenceImage?: string; poseEstimator?: 'sdpose' | 'dwpose'; ratio?: string; filenamePrefix?: string }): Record<string, ComfyUiPromptNode>;
export function ensureComfyUiPoseMap(options?: { config?: Record<string, any>; fetchImpl?: typeof fetch; reference?: { buffer: Buffer; mimeType?: string; fileName?: string }; poseEstimator?: 'sdpose' | 'dwpose'; ratio?: string; signal?: AbortSignal }): Promise<{ key: string; buffer: Buffer; cached: boolean; fileName: string; promptId?: string }>;
export function buildComfyUiIllustriousPrompt(options?: Record<string, unknown>): Record<string, ComfyUiPromptNode>;
export function buildComfyUiCharacterFinalPrompt(options?: Record<string, unknown>): Record<string, ComfyUiPromptNode>;
export function prepareComfyUiCustomPrompt(value: unknown, options?: { seed?: number; prompt?: string; negativePrompt?: string; positivePrefix?: string; checkpoint?: string; referenceImage?: string; referenceDenoise?: number; ratio?: string; resolution?: string; upscaleModel?: string; steps?: number; cfg?: number; sampler?: string; scheduler?: string; denoise?: number; characterLora?: string; characterLoraStrength?: number; highResRefine?: boolean; refineDenoise?: number; filenamePrefix?: string }): Record<string, ComfyUiPromptNode> | null;
export function comfyUiIllustriousHistoryImage(entry: unknown): { filename: string; subfolder: string; type: string } | null;
export function readComfyUiOutputFile(outputDirectory: unknown, file: { filename?: unknown; subfolder?: unknown; type?: unknown }, maximumBytes?: number): Promise<Buffer | null>;
export function decodeComfyUiPreviewFrame(value: ArrayBuffer | ArrayBufferView | Buffer): { buffer: Buffer; contentType: 'image/png' | 'image/jpeg'; metadata: Record<string, unknown> } | null;
export function inspectComfyUiIllustrious(config?: Record<string, unknown>, fetchImpl?: typeof fetch, workflow?: { workflowId?: string; loras?: string[]; resolution?: string; poseEstimator?: 'sdpose' | 'dwpose' }): Promise<{ available: boolean; baseUrl: string; checkpoint?: string; upscaleModel?: string; error: string }>;
export function createComfyUiIllustriousAdapter(model: { id?: string; adapter?: string; config?: Record<string, unknown> }, fetchImpl?: typeof fetch, runtime?: { WebSocketImpl?: typeof WebSocket | null }): {
  kind: 'image';
  configured: true;
  run(job: Record<string, any>): Promise<Array<Record<string, any>>>;
};
