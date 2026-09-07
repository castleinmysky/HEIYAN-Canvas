export type HashRecordV1 = {
  algorithm: 'sha256';
  state: 'not_computed' | 'computed';
  value: string | null;
};

export type PayloadCategoryV1 = 'runtime' | 'python_runtime' | 'custom_node' | 'workflow' | 'model';

export type PayloadFileV1 = {
  sourceId: string;
  category: PayloadCategoryV1;
  logicalPath: string;
  targetPath: string;
  bytes: number;
  hash: HashRecordV1;
};

export type FindingCountV1 = { code: string; count: number };

export interface InventoryReportV1 {
  schemaVersion: 'inventory-report/v1';
  hashMode: 'none' | 'all';
  sources: Array<{ id: string; kind: 'comfy' | 'models' | 'workflows' }>;
  payloadFiles: PayloadFileV1[];
  runtime: {
    fileCount: number;
    bytes: number;
    nativeBinaryCount: number;
    python: {
      state: 'portable' | 'machine_bound' | 'missing';
      configPresent: boolean;
      findings: string[];
    };
  };
  customNodes: {
    records: Array<{
      id: string;
      logicalPath: string;
      fileCount: number;
      bytes: number;
      versionState: 'versioned_unverified' | 'unversioned';
      nativeBinaryCount: number;
      findings: string[];
    }>;
    fileCount: number;
    bytes: number;
  };
  workflows: {
    records: Array<{
      logicalPath: string;
      bytes: number;
      parseStatus: 'parsed' | 'invalid_json' | 'unsupported_shape';
      nodeTypeMultiset: Record<string, number>;
      nodeCount: number;
      linkCount: number;
      sanitizerFindings: string[];
    }>;
    fileCount: number;
    bytes: number;
    parsed: number;
    blocked: number;
  };
  models: {
    records: Array<{
      sourceId: string;
      logicalPath: string;
      category: string;
      bytes: number;
      hash: HashRecordV1;
    }>;
    categories: Array<{ category: string; fileCount: number; bytes: number }>;
    fileCount: number;
    bytes: number;
    incompleteBlocked: number;
  };
  exclusions: Array<{ reason: string; fileCount: number; bytes: number }>;
  portability: {
    status: 'ready' | 'blocked';
    blockers: FindingCountV1[];
    warnings: FindingCountV1[];
  };
  summary: {
    discovered: { records: number; files: number; bytes: number };
    excluded: { files: number; bytes: number };
  };
}

export interface LocalBundleManifestV1 {
  schemaVersion: 'local-bundle-manifest/v1';
  bundle: { id: string; version: string; digest: string };
  buildState: 'draft' | 'build_ready';
  runtime: { entrypoint: string; pythonPortability: 'portable' | 'rebuild_required' };
  payloadFiles: PayloadFileV1[];
  customNodes: Array<{ id: string; versionState: 'pinned' | 'unverified' }>;
  workflows: Array<{ id: string; logicalPath: string }>;
  models: Array<{ id: string; category: string; logicalPath: string; bytes: number; hash: HashRecordV1 }>;
  capabilities: Array<{ id: string; workflowId: string; requiredModels: string[]; requiredCustomNodes: string[] }>;
  exclusions: string[];
  localOnly: { uploadForbidden: true; repositoryPayloadForbidden: true };
}

export interface InstallationReceiptV1 {
  schemaVersion: 'installation-receipt/v1';
  storage: { logicalPath: 'state/private/installation-receipt-v1.json'; private: true };
  bundle: { id: string; version: string; digest: string };
  installation: {
    id: string;
    installRoot: string;
    modelRoots: string[];
    endpoint: string;
    state: 'installed' | 'repair_required' | 'rolled_back';
    verifiedAt: string;
  };
  capabilities: Array<{ id: string; state: 'ready' | 'blocked'; findings: string[] }>;
}

export const INVENTORY_REPORT_VERSION: 'inventory-report/v1';
export const LOCAL_BUNDLE_MANIFEST_VERSION: 'local-bundle-manifest/v1';
export const INSTALLATION_RECEIPT_VERSION: 'installation-receipt/v1';
export function normalizeLogicalPath(value: string): string;
export function validateLogicalTargetPath(value: string, category: PayloadCategoryV1): string;
export function logicalTargetPath(category: PayloadCategoryV1, sourceId: string, logicalPath: string): string;
export function canonicalJson(value: unknown): string;
export function canonicalSha256(value: unknown): string;
export function managedComfyManifestDigest(manifest: LocalBundleManifestV1): string;
export function validateInventoryReportV1(report: InventoryReportV1): InventoryReportV1;
export function validateLocalBundleManifestV1(manifest: LocalBundleManifestV1): LocalBundleManifestV1;
export function validateInstallationReceiptV1(receipt: InstallationReceiptV1): InstallationReceiptV1;
export function createInstallationReceiptV1(
  input: Omit<InstallationReceiptV1, 'schemaVersion' | 'storage'>,
  options?: { clock?: () => Date | string },
): InstallationReceiptV1;
export type InventoryAccessObserver = (operation: 'access' | 'hash' | 'lstat' | 'open' | 'readdir' | 'readFile' | 'realpath' | 'stat', lexicalPath: string) => void | Promise<void>;
export type InventoryFileSystem = Pick<typeof import('node:fs/promises'), 'access' | 'lstat' | 'open' | 'readdir' | 'readFile' | 'realpath' | 'stat'> & {
  hash?: (lexicalPath: string) => Promise<HashRecordV1>;
};
export function inventoryManagedComfyBundle(options: {
  comfyRoot: string;
  modelRoots: string[];
  workflowRoots: string[];
  hashMode: 'none' | 'all';
  observer?: InventoryAccessObserver;
  fsImpl?: InventoryFileSystem;
}): Promise<InventoryReportV1>;
export function writeInventoryReportCreateNew(reportPath: string, report: InventoryReportV1, options?: { observer?: InventoryAccessObserver; fsImpl?: InventoryFileSystem }): Promise<void>;
export function runInventoryToNewReport(options: {
  comfyRoot: string;
  modelRoots: string[];
  workflowRoots: string[];
  reportPath: string;
  hashMode: 'none' | 'all';
  productRoot?: string;
  observer?: InventoryAccessObserver;
  fsImpl?: InventoryFileSystem;
}): Promise<InventoryReportV1>;
