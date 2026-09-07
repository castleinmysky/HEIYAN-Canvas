import type { InstallationReceiptV1, LocalBundleManifestV1, PayloadFileV1 } from './managed-comfy-bundle.js';

export type DeploymentHooks = {
  copy?: (source: string, target: string, context: Record<string, unknown>) => Promise<void>;
  stat?: (target: string) => Promise<{
    size: number;
    mtimeMs: number;
    ino?: number;
    isFile(): boolean;
  }>;
  diskSpace?: (target: string, context?: { phase: 'bundle' | 'install'; budget: DeploymentBudget }) => Promise<number>;
  failurePoint?: (name: string, context: Record<string, unknown>) => Promise<void>;
  offlineImportPreflight?: (context: Record<string, unknown>) => Promise<boolean>;
};

export type RuntimeMetadata = {
  strategy: 'portable' | 'rebuilt';
  manifestDigest: string;
};

export type DeploymentBudget = Readonly<{
  payloadBytes: number;
  supportBytes: number;
  manifestBytes: number;
  receiptBytes: number;
  temporaryOverlapBytes: number;
  transactionReserveBytes: number;
  requiredBytes: number;
}>;

export function buildPrivateBundle(options: {
  manifest: LocalBundleManifestV1;
  sourceRoots: Record<string, string> | Map<string, string>;
  bundleDir: string;
  manifestPath?: string;
  productRoot?: string;
  installerSourceRoot?: string;
  copyConcurrency?: number;
  hooks?: DeploymentHooks;
}): Promise<{
  state: 'built';
  bundleDir: string;
  copiedFiles: number;
  reusedFiles: number;
  bytes: number;
  requiredBytes: number;
  budget: DeploymentBudget;
}>;

export function installPrivateBundle(options: {
  bundleRoot: string;
  manifest?: LocalBundleManifestV1;
  installRoot: string;
  installationId: string;
  endpoint: string;
  runtimeMetadata?: RuntimeMetadata;
  clock?: () => Date | string;
  hooks?: DeploymentHooks;
}): Promise<{
  state: 'installed' | 'upgraded' | 'already_verified';
  receipt: InstallationReceiptV1;
  copiedFiles: number;
  reusedFiles: number;
  requiredBytes: number;
  budget: DeploymentBudget | null;
}>;

export function verifyInstallationReceipt(
  receipt: InstallationReceiptV1,
  manifest: LocalBundleManifestV1,
  options?: { hooks?: DeploymentHooks },
): Promise<boolean>;

export const managedComfyDeploymentPaths: Readonly<{
  receipt: 'state/private/installation-receipt-v1.json';
  stateDirectories: readonly string[];
}>;

export const managedComfyDeploymentPolicy: Readonly<{
  transactionReserveBytes: number;
}>;

export type DeploymentPayloadFile = PayloadFileV1;
