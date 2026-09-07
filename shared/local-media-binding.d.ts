export type LocalMediaBindingRole = 'character' | 'pose' | 'composition' | 'proportion' | 'lineart' | 'mask' | 'style' | 'picture';
export type LocalMediaBindingMethod = 'native-multimodal' | 'instantid' | 'pulid' | 'ipadapter' | 'controlnet-pose' | 'controlnet-lineart' | 'reference-latent' | 'latent-guide' | 'image-to-image' | 'inpaint-source' | 'inpaint-mask';
export type LocalMediaVersionPolicy = 'latest' | 'locked';
export type LocalMediaPreparation = 'fit' | 'pose' | 'lineart' | 'mask' | string;

export type LocalMediaInputPort = {
  id: string;
  label: string;
  accepts: Array<'text' | 'image'> | readonly ('text' | 'image')[];
  multiple?: boolean;
  required?: boolean;
  minImages?: number;
  maxImages?: number;
  bindingRole?: LocalMediaBindingRole;
  bindingMethod?: LocalMediaBindingMethod;
  preparation?: LocalMediaPreparation;
};

export type LocalMediaBinding = {
  bindingVersion: 1;
  port: string;
  type: string;
  value: string;
  sourceId: string;
  referenceToken: string;
  role: LocalMediaBindingRole;
  roleLabel: string;
  bindingMethod: LocalMediaBindingMethod;
  versionPolicy: LocalMediaVersionPolicy;
  sourceVersion: string;
  strength?: number;
  preparation: string;
  cacheKey: string;
};

export type LocalMediaBindingCapability = {
  port: string;
  label: string;
  role: LocalMediaBindingRole;
  method: LocalMediaBindingMethod;
  minimum: number;
  maximum: number;
  preparation: string;
};

export const LOCAL_MEDIA_BINDING_VERSION: 1;
export const LOCAL_MEDIA_BINDING_ROLES: readonly LocalMediaBindingRole[];
export const LOCAL_MEDIA_BINDING_METHODS: readonly LocalMediaBindingMethod[];
export function localMediaBindingRoleLabel(role: string): string;
export function localMediaAutoPrompt(bindings: readonly Partial<LocalMediaBinding>[]): string;
export function localMediaBindingRoleForPort(port: string, type?: string): LocalMediaBindingRole;
export function localMediaBindingMethodForPort(workflow: unknown, portId: string, context?: { family?: string }): LocalMediaBindingMethod;
export function localMediaBindingCapabilities(workflow: unknown, context?: { family?: string }): readonly LocalMediaBindingCapability[];
export function localMediaPreparationCacheKey(binding: Partial<LocalMediaBinding> & { value?: string }): string;
export function normalizeLocalMediaBinding(input: Record<string, unknown>, options?: Record<string, unknown>): LocalMediaBinding;
export function planLocalMediaBindings(value?: { workflow?: unknown; inputs?: Array<Record<string, unknown>>; context?: { family?: string } }): { version: 1; bindings: readonly LocalMediaBinding[]; capabilities: readonly LocalMediaBindingCapability[]; errors: readonly string[]; ready: boolean };
export function localMediaBindingProvenance(bindings: readonly Partial<LocalMediaBinding>[]): Array<Omit<LocalMediaBinding, 'type' | 'value' | 'roleLabel' | 'cacheKey'>>;
