export const LOCAL_MEDIA_BINDING_VERSION = 1;

export const LOCAL_MEDIA_BINDING_ROLES = Object.freeze([
  'character',
  'pose',
  'composition',
  'proportion',
  'lineart',
  'mask',
  'style',
  'picture',
]);

export const LOCAL_MEDIA_BINDING_METHODS = Object.freeze([
  'native-multimodal',
  'instantid',
  'pulid',
  'ipadapter',
  'controlnet-pose',
  'controlnet-lineart',
  'reference-latent',
  'latent-guide',
  'image-to-image',
  'inpaint-source',
  'inpaint-mask',
]);

const roleSet = new Set(LOCAL_MEDIA_BINDING_ROLES);
const methodSet = new Set(LOCAL_MEDIA_BINDING_METHODS);

const roleLabels = Object.freeze({
  character: '角色参考',
  pose: '动作迁移',
  composition: '画面参考',
  proportion: '比例参考',
  lineart: '线稿参考',
  mask: '修改范围',
  style: '画风参考',
  picture: '图片参考',
});

export function localMediaBindingRoleLabel(role) {
  return roleLabels[role] || roleLabels.picture;
}

const autoPromptParts = Object.freeze({
  character: 'preserve the character identity, face, hairstyle, and distinctive appearance from the character reference',
  pose: 'match the body pose and action from the pose reference',
  composition: 'follow the composition and spatial layout of the picture reference',
  proportion: 'follow the body proportions from the proportion reference',
  lineart: 'follow the structure and contours of the line-art reference',
  style: 'follow the visual style of the style reference',
  picture: 'use the connected picture as a visual reference',
});

export function localMediaAutoPrompt(bindings) {
  const normalized = Array.isArray(bindings) ? bindings : [];
  if (!normalized.length || normalized.some((binding) => binding?.role === 'mask'
    || binding?.bindingMethod === 'inpaint-source'
    || binding?.bindingMethod === 'inpaint-mask')) return '';
  const roles = [...new Set(normalized
    .map((binding) => roleSet.has(String(binding?.role || '')) ? String(binding.role) : 'picture')
    .filter((role) => role !== 'mask'))];
  const guidance = roles.map((role) => autoPromptParts[role]).filter(Boolean);
  if (!guidance.length) return '';
  return `${guidance.join(', ')}, create a complete and coherent image with clear details and natural anatomy`;
}

export function localMediaBindingRoleForPort(port, type = 'image') {
  if (type !== 'image') return 'picture';
  const value = String(port || '').trim().toLowerCase();
  if (value === 'identity' || value === 'reference' || value === 'character') return 'character';
  if (value === 'pose' || value === 'motion') return 'pose';
  if (value === 'proportion') return 'proportion';
  if (value === 'lineart' || value === 'line') return 'lineart';
  if (value === 'mask') return 'mask';
  if (value === 'style') return 'style';
  if (value === 'input' || value === 'composition' || value === 'structure') return 'composition';
  return 'picture';
}

function explicitImagePort(workflow, portId) {
  return (Array.isArray(workflow?.inputPorts) ? workflow.inputPorts : [])
    .find((port) => String(port?.id || '') === String(portId || '') && Array.isArray(port?.accepts) && port.accepts.includes('image')) || null;
}

export function localMediaBindingMethodForPort(workflow, portId, context = {}) {
  const port = explicitImagePort(workflow, portId);
  const explicit = String(port?.bindingMethod || '').trim();
  if (methodSet.has(explicit)) return explicit;
  const role = roleSet.has(String(port?.bindingRole || '')) ? String(port.bindingRole) : localMediaBindingRoleForPort(portId);
  const family = String(context?.family || '').trim();
  if (role === 'mask') return 'inpaint-mask';
  if (role === 'lineart') return 'controlnet-lineart';
  if (role === 'proportion') return 'ipadapter';
  if (role === 'character') {
    if (String(workflow?.identityMethod || '') === 'instantid') return 'instantid';
    if (String(workflow?.identityMethod || '') === 'pulid') return 'pulid';
    if (family === 'qwen-image-edit-2511') return 'native-multimodal';
    if (String(workflow?.id || '').includes('inpaint')) return 'inpaint-source';
    return 'ipadapter';
  }
  if (role === 'pose') {
    if (family === 'qwen-image-edit-2511') return 'native-multimodal';
    if (family === 'z-image-turbo' || workflow?.poseControl?.mode === 'exact') return 'controlnet-pose';
    if (family === 'flux2-klein') return 'reference-latent';
    return 'latent-guide';
  }
  if (role === 'composition') return family === 'qwen-image-edit-2511' ? 'native-multimodal' : 'image-to-image';
  if (role === 'style') return 'ipadapter';
  return 'image-to-image';
}

export function localMediaBindingCapabilities(workflow, context = {}) {
  return (Array.isArray(workflow?.inputPorts) ? workflow.inputPorts : [])
    .filter((port) => Array.isArray(port?.accepts) && port.accepts.includes('image'))
    .map((port) => {
      const role = roleSet.has(String(port.bindingRole || '')) ? String(port.bindingRole) : localMediaBindingRoleForPort(port.id);
      const minimum = port.required ? Math.max(1, Number(port.minImages) || 1) : Math.max(0, Number(port.minImages) || 0);
      const maximum = Math.max(minimum, Math.min(8, Number(port.maxImages) || 1));
      return Object.freeze({
        port: String(port.id || ''),
        label: String(port.label || localMediaBindingRoleLabel(role)),
        role,
        method: localMediaBindingMethodForPort(workflow, port.id, context),
        minimum,
        maximum,
        preparation: String(port.preparation || (role === 'pose' ? 'pose' : role === 'lineart' ? 'lineart' : role === 'mask' ? 'mask' : 'fit')),
      });
    });
}

function boundedStrength(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(2, number)) : 1;
}

function cleanToken(value, fallback) {
  const token = String(value || '').trim();
  return token && /^[^<>\r\n]{1,32}$/.test(token) ? token : fallback;
}

export function localMediaPreparationCacheKey(binding) {
  const source = String(binding?.sourceId || binding?.value || 'unknown');
  const policy = binding?.versionPolicy === 'locked' ? 'locked' : 'latest';
  const version = String(binding?.sourceVersion || binding?.value || (policy === 'locked' ? 'locked' : 'latest'));
  const role = roleSet.has(String(binding?.role || '')) ? String(binding.role) : 'picture';
  const preparation = String(binding?.preparation || 'fit');
  return [LOCAL_MEDIA_BINDING_VERSION, source, policy, version, role, preparation].map((part) => encodeURIComponent(part)).join('|');
}

export function normalizeLocalMediaBinding(input, options = {}) {
  const port = String(input?.port || options.port || '').trim();
  const role = roleSet.has(String(input?.role || ''))
    ? String(input.role)
    : roleSet.has(String(options.role || ''))
      ? String(options.role)
      : localMediaBindingRoleForPort(port, input?.type);
  const method = methodSet.has(String(input?.bindingMethod || ''))
    ? String(input.bindingMethod)
    : methodSet.has(String(options.method || ''))
      ? String(options.method)
      : localMediaBindingMethodForPort(options.workflow, port, options.context);
  const versionPolicy = input?.versionPolicy === 'locked' || input?.pinSourceMedia === true ? 'locked' : 'latest';
  const requestedStrength = input?.strength ?? options.strength;
  const normalized = {
    bindingVersion: LOCAL_MEDIA_BINDING_VERSION,
    port,
    type: String(input?.type || 'image'),
    value: String(input?.value || ''),
    sourceId: String(input?.sourceId || ''),
    referenceToken: cleanToken(input?.referenceToken, String(options.fallbackToken || '图片1')),
    role,
    roleLabel: localMediaBindingRoleLabel(role),
    bindingMethod: method,
    versionPolicy,
    sourceVersion: String(input?.sourceVersion || (versionPolicy === 'locked' ? input?.value || '' : '')),
    ...(Number.isFinite(Number(requestedStrength)) ? { strength: boundedStrength(requestedStrength) } : {}),
    preparation: String(input?.preparation || options.preparation || 'fit'),
  };
  return Object.freeze({ ...normalized, cacheKey: localMediaPreparationCacheKey(normalized) });
}

export function planLocalMediaBindings({ workflow, inputs, context = {} } = {}) {
  const capabilities = localMediaBindingCapabilities(workflow, context);
  const capabilityByPort = new Map(capabilities.map((capability) => [capability.port, capability]));
  const imageInputs = (Array.isArray(inputs) ? inputs : []).filter((input) => input?.type === 'image');
  const bindings = imageInputs.map((input, index) => {
    const capability = capabilityByPort.get(String(input?.port || ''));
    return normalizeLocalMediaBinding(capability ? {
      ...input,
      role: capability.role,
      bindingMethod: capability.method,
      preparation: capability.preparation,
    } : input, {
      workflow,
      context,
      role: capability?.role,
      method: capability?.method,
      preparation: capability?.preparation,
      fallbackToken: `图片${index + 1}`,
    });
  });
  const errors = [];
  const counts = new Map();
  bindings.forEach((binding) => {
    const capability = capabilityByPort.get(binding.port);
    if (!capability) {
      errors.push(`${binding.referenceToken} 不能用于当前生成方式`);
      return;
    }
    counts.set(binding.port, (counts.get(binding.port) || 0) + 1);
  });
  capabilities.forEach((capability) => {
    const count = counts.get(capability.port) || 0;
    if (count < capability.minimum) errors.push(`请连接${capability.label}`);
    if (count > capability.maximum) errors.push(`${capability.label}最多使用 ${capability.maximum} 张图片`);
  });
  return Object.freeze({
    version: LOCAL_MEDIA_BINDING_VERSION,
    bindings: Object.freeze(bindings),
    capabilities: Object.freeze(capabilities),
    errors: Object.freeze([...new Set(errors)]),
    ready: errors.length === 0,
  });
}

export function localMediaBindingProvenance(bindings) {
  return (Array.isArray(bindings) ? bindings : []).map((binding) => ({
    bindingVersion: LOCAL_MEDIA_BINDING_VERSION,
    token: String(binding?.referenceToken || ''),
    role: roleSet.has(String(binding?.role || '')) ? String(binding.role) : 'picture',
    port: String(binding?.port || ''),
    sourceId: String(binding?.sourceId || ''),
    versionPolicy: binding?.versionPolicy === 'locked' ? 'locked' : 'latest',
    sourceVersion: String(binding?.sourceVersion || ''),
    bindingMethod: methodSet.has(String(binding?.bindingMethod || '')) ? String(binding.bindingMethod) : 'image-to-image',
    ...(Number.isFinite(Number(binding?.strength)) ? { strength: boundedStrength(binding.strength) } : {}),
    preparation: String(binding?.preparation || 'fit'),
  }));
}
