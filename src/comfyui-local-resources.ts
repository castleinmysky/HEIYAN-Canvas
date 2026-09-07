import type { AppearanceControlInfo, ComfyUiPurposeRecommendation, ComfyUiWorkflowReadiness, DetailEnhancementInfo, ModelInfo } from './components/CanvasNodes';

export type ComfyUiLocalResourceState = 'ready' | 'unloaded' | 'missing' | 'offline';

export type ComfyUiResourceCategoryId =
  | 'checkpoint'
  | 'unet'
  | 'clip'
  | 'vae'
  | 'lora'
  | 'controlnet'
  | 'preprocessor'
  | 'upscaler'
  | 'ipadapter'
  | 'instantid'
  | 'pulid'
  | 'facedetailer';

export type ComfyUiCategorizedResource = {
  id?: string;
  name: string;
  state: ComfyUiLocalResourceState;
  message?: string;
  method?: string;
  precision?: 'precise' | 'detail';
  optional?: boolean;
  loader?: { className: string; inputName: string };
  size?: number;
  sha256?: string;
};

export type ComfyUiResourceCategory = {
  id: ComfyUiResourceCategoryId | string;
  label?: string;
  items: ComfyUiCategorizedResource[];
};

export type ComfyUiLocalResource = {
  id: string;
  name: string;
  capability: 'image' | 'video';
  adapter: string;
  enabled: boolean;
  baseUrl: string;
  checkpoint: string;
  filePresent: boolean;
  installed: boolean;
  state: ComfyUiLocalResourceState;
  message: string;
  workflows: Array<{
    id: string;
    name: string;
    editor: 'native' | 'managed';
    appearanceControl?: AppearanceControlInfo;
    detailEnhancement?: DetailEnhancementInfo;
    readiness?: ComfyUiWorkflowReadiness;
  }>;
};

export type ComfyUiLocalResourceInventory = {
  available: boolean;
  baseUrl?: string;
  checkpoints: string[];
  loras: string[];
  categories?: ComfyUiResourceCategory[];
  nodeClasses?: Record<string, boolean>;
  purposeRecommendations?: ComfyUiPurposeRecommendation[];
  models: ComfyUiLocalResource[];
  scannedAt: string;
};

export type ComfyUiRecipeVersion = {
  version: number;
  status: string;
  createdAt: string;
  publishedAt?: string;
  sourceVersion?: number;
};

export type ComfyUiCapabilityRecipe = {
  id: string;
  modelId: string;
  modelName: string;
  workflowId: string;
  name: string;
  description: string;
  status: string;
  activeVersion: number | null;
  draftVersion: number | null;
  versions: ComfyUiRecipeVersion[];
  readiness: ComfyUiWorkflowReadiness;
  readOnly?: boolean;
};

export type ComfyUiRecipeCatalog = {
  revision: number;
  recipes: ComfyUiCapabilityRecipe[];
};

export const COMFYUI_RESOURCE_CATEGORY_LABELS: Record<ComfyUiResourceCategoryId, string> = {
  checkpoint: 'Checkpoint',
  unet: 'UNet',
  clip: 'CLIP / Text Encoder',
  vae: 'VAE',
  lora: 'LoRA',
  controlnet: 'ControlNet',
  preprocessor: '预处理器',
  upscaler: '放大模型',
  ipadapter: 'IPAdapter',
  instantid: 'InstantID',
  pulid: 'PuLID',
  facedetailer: 'FaceDetailer',
};

const orderedResourceCategoryIds = Object.keys(COMFYUI_RESOURCE_CATEGORY_LABELS) as ComfyUiResourceCategoryId[];

export function normalizeComfyUiResourceCategories(inventory: Pick<ComfyUiLocalResourceInventory, 'categories' | 'checkpoints' | 'loras'>): ComfyUiResourceCategory[] {
  const received = new Map((inventory.categories || []).map((category) => [category.id.toLowerCase(), category]));
  return orderedResourceCategoryIds.map((id) => {
    const category = received.get(id);
    const legacyNames = id === 'checkpoint' ? inventory.checkpoints : id === 'lora' ? inventory.loras : [];
    return {
      id,
      label: category?.label || COMFYUI_RESOURCE_CATEGORY_LABELS[id],
      items: category?.items?.map((item) => ({ ...item, state: item.state || 'missing' })) || legacyNames.map((name) => ({ name, state: 'ready' as const })),
    };
  });
}

export function mergeComfyUiLocalResources(models: ModelInfo[], inventory?: Pick<ComfyUiLocalResourceInventory, 'models' | 'purposeRecommendations'> | null) {
  if (!inventory?.models?.length) return models;
  const resources = new Map(inventory.models.map((resource) => [resource.id, resource]));
  return models.map((model) => {
    const resource = resources.get(model.id);
    if (!resource) return model;
    const resourceWorkflowById = new Map((resource.workflows || []).map((workflow) => [workflow.id, workflow]));
    const withReadiness = (workflow: NonNullable<ModelInfo['workflow']>) => {
      const resourceWorkflow = resourceWorkflowById.get(workflow.id);
      return {
        ...workflow,
        ...(resourceWorkflow?.appearanceControl ? { appearanceControl: resourceWorkflow.appearanceControl } : {}),
        ...(resourceWorkflow?.detailEnhancement ? { detailEnhancement: resourceWorkflow.detailEnhancement } : {}),
        ...(resourceWorkflow?.readiness ? { readiness: resourceWorkflow.readiness } : {}),
      };
    };
    return {
      ...model,
      ...(model.workflow ? { workflow: withReadiness(model.workflow) } : {}),
      ...(model.workflows ? { workflows: model.workflows.map(withReadiness) } : {}),
      ...(inventory.purposeRecommendations ? { purposeRecommendations: inventory.purposeRecommendations } : {}),
      localResource: {
        state: resource.state,
        installed: resource.installed,
        checkpoint: resource.checkpoint,
        message: resource.message,
      },
    };
  });
}
