export type ManagedComfyPublicState = {
  state: 'not-installed' | 'installed' | 'starting' | 'connected' | 'repair-required';
  bundle?: { id: string; version: string; digest: string };
  capabilityCount: number;
  reasonCode: string | null;
};

export const MANAGED_COMFY_ENDPOINT: 'http://127.0.0.1:8288';
export const MANAGED_COMFY_REGISTRATION: 'managed-comfy-registration-v1.json';
export const MANAGED_COMFY_REGISTRATION_VERSION: 'managed-comfy-registration/v1';
export const MANAGED_COMFY_HEALTH_VERSION: 'echo-canvas-managed-health/v1';
export const MANAGED_COMFY_RUNTIME_HEALTH: 'state/private/runtime-health-v1.json';
export const HEALTH_LIMIT: 1048576;
export const OBJECT_LIMIT: 524288;
export const OBJECT_TOTAL_LIMIT: 8388608;
export const OBJECT_COUNT_LIMIT: 64;
export const MANAGED_RESPONSE_DEADLINE_MS: 3000;

export function createManagedComfyConnectionManager(options: {
  privateDir: string;
  fetchImpl?: typeof fetch;
  spawnImpl?: (...args: unknown[]) => unknown;
  sleepImpl?: (milliseconds: number) => Promise<void>;
  hashFile?: (target: string) => Promise<string>;
  fsImpl?: typeof import('node:fs/promises');
  pollAttempts?: number;
  pollIntervalMs?: number;
  registrationFailurePoint?: (name: string, context: Record<string, unknown>) => Promise<void>;
  runtimeHealthFailurePoint?: (name: string, context: Record<string, unknown>) => Promise<void>;
  deploymentHooks?: Record<string, unknown>;
}): {
  status(): Promise<ManagedComfyPublicState>;
  connect(): Promise<ManagedComfyPublicState>;
  verify(body: { scope: 'quick' | 'full' }): Promise<ManagedComfyPublicState>;
  disconnect(): Promise<ManagedComfyPublicState>;
  models(storedModels?: unknown[]): Promise<unknown[]>;
  catalogResources(): unknown[];
  quickVerify(): Promise<unknown>;
  registrationPath: string;
};
