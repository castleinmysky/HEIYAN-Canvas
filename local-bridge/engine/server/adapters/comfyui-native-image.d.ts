export type ComfyUiNativePromptNode = {
  class_type: string;
  inputs: Record<string, any>;
  _meta?: { title?: string; aiCanvasRole?: string };
};

export type ComfyUiNativePrompt = Record<string, ComfyUiNativePromptNode>;

export const Z_IMAGE_POSE_CONTROL_MODEL: string;
export function buildComfyUiNativePrompt(config?: Record<string, any>, options?: Record<string, any>): ComfyUiNativePrompt;
export function nativeImageFilenamePrefix(family: string, jobId: string, outputIndex?: number): string;
export function nativeImageJobDenoise(options?: Record<string, any>, hasReference?: boolean): number;
export function nativePoseModeForFamily(family?: string): 'exact' | 'guided' | 'unsupported';
export function nativePoseGuidedDenoise(strength?: number): number;
export function prepareComfyUiNativePrompt(prompt: unknown, config?: Record<string, any>, options?: Record<string, any>): ComfyUiNativePrompt | null;
export function inspectComfyUiNativeImage(config?: Record<string, any>, fetchImpl?: typeof fetch, options?: { resolution?: string; poseEnabled?: boolean; poseEstimator?: 'sdpose' | 'dwpose'; previewOnly?: boolean; workflowId?: string; styleLora?: string }): Promise<Record<string, any>>;
export function uploadComfyUiNativeReference(fetchImpl: typeof fetch, baseUrl: string, reference: Record<string, any>, signal?: AbortSignal, options?: { persistent?: boolean; namespace?: 'editor' | 'cache'; inputDirectory?: string }): Promise<string>;
export function createComfyUiNativeImageAdapter(model: Record<string, any>, fetchImpl?: typeof fetch, runtime?: Record<string, any>): {
  kind: 'image';
  configured: true;
  run(job: Record<string, any>): Promise<any[]>;
};
