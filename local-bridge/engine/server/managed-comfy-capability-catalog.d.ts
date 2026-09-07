import type { InstallationReceiptV1, LocalBundleManifestV1 } from './managed-comfy-bundle.js';

export type ManagedComfyProjection = {
  capabilityId: string;
  workflowId: string;
  workflow: { id: string; logicalPath: string };
  runtimeModels: Record<string, string>;
  catalog: {
    workflowId: string;
    adapter: string;
    capability: 'image' | 'video';
    name: string;
    requiredModelRoles: Readonly<Record<string, string>>;
    requiredNodeTypes: readonly string[];
    loaderInputs: readonly { nodeType: string; input: string; roles: readonly string[] }[];
  };
  model: Record<string, unknown>;
};

export const managedComfyCapabilityCatalog: Readonly<Record<string, ManagedComfyProjection['catalog']>>;
export function assertManagedComfyId(value: unknown, label?: string): string;
export function resolveManagedComfyCapabilities(manifest: LocalBundleManifestV1, receipt: InstallationReceiptV1): ManagedComfyProjection[];
export function managedComfyRequiredNodeTypes(projections: ManagedComfyProjection[], workflowNodeTypes?: string[]): string[];
