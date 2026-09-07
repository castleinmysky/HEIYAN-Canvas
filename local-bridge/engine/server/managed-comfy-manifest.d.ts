import type { LocalBundleManifestV1 } from './managed-comfy-bundle.js';

export type PlanIncludeV1 = { kind: 'file' | 'tree'; logicalPath: string };
export type ManagedComfyCapabilityPlanV1 = {
  schemaVersion: 'managed-comfy-capability-plan/v1';
  bundle: { id: string; version: string };
  runtime: { sourceId: string; executableOrEntrypoint: string; includes: PlanIncludeV1[] };
  python: { sourceId: string; executableOrEntrypoint: string; includes: PlanIncludeV1[] };
  capabilities: Array<{ id: string; workflowId: string; modelRoles: Record<string, string>; requiredCustomNodes: string[] }>;
  workflows: Array<{ id: string; sourceId: string; logicalPath: string }>;
  models: Array<{ id: string; sourceId: string; logicalPath: string; category: string }>;
  customNodes: Array<{ id: string; sourceId: string; logicalPath: string; versionState: 'pinned' | 'unverified' }>;
};

export const MANAGED_COMFY_CAPABILITY_PLAN_VERSION: 'managed-comfy-capability-plan/v1';
export const MANAGED_COMFY_COMPILED_SOURCE_ID: 'echo-canvas-compiled';
export const MANAGED_COMFY_BRIDGE_ID: 'echo_canvas_managed_bridge';
export function validateManagedComfyCapabilityPlanV1(plan: ManagedComfyCapabilityPlanV1): ManagedComfyCapabilityPlanV1;
export function sanitizeManagedComfyWorkflow(workflow: unknown, plan: ManagedComfyCapabilityPlanV1): unknown;
export function compileManagedComfyCapabilityPlan(options: {
  plan: ManagedComfyCapabilityPlanV1;
  outputDir: string;
  sourceRoots: Record<string, string> | Map<string, string>;
  fsImpl?: typeof import('node:fs/promises');
  reader?: (target: string) => Promise<Buffer>;
  hasher?: (target: string, bytes?: Buffer) => Promise<string>;
  clock?: () => Date | string;
  failurePoint?: (name: string, context: Record<string, unknown>) => Promise<void>;
}): Promise<{ state: 'compiled' | 'already_compiled'; manifest: LocalBundleManifestV1; manifestPath: string; mutations: number }>;
