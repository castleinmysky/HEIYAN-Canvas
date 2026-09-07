export const connectionProtocols = Object.freeze({
  image: ['openai-image', 'gemini-image'],
  video: ['seedance-video', 'minimax-h3-video'],
  model: ['tripo3d-model'],
});
export function advancedConnectionEligible(model) {
  return Boolean(model && !String(model.adapter || '').startsWith('comfyui-')
    && model.adapter !== 'gpt-sovits-audio' && connectionProtocols[model.capability]?.includes(model.adapter));
}
export function connectionDefaults(adapter, model = '') {
  const selected = String(model || '').trim();
  switch (adapter) {
    case 'openai-image': return { adapter, mode: 'official', baseUrl: 'https://api.openai.com', endpoint: '/v1/images/generations', editEndpoint: '/v1/images/edits', validationEndpoint: '/v1/models', model: selected || 'gpt-image-2' };
    case 'gemini-image': return { adapter, mode: 'official', baseUrl: 'https://generativelanguage.googleapis.com', endpoint: '/v1beta/models/' + encodeURIComponent(selected || 'gemini-2.5-flash-image') + ':generateContent', validationEndpoint: '/v1beta/models', model: selected || 'gemini-2.5-flash-image' };
    case 'seedance-video': return { adapter, mode: 'official', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', endpoint: '/contents/generations/tasks', validationEndpoint: '/models', model: selected || 'doubao-seedance-2-0-260128' };
    case 'minimax-h3-video': return { adapter, mode: 'official', baseUrl: 'https://api.minimax.io', endpoint: '/v2/video_generation', queryEndpoint: '/v2/query/video_generation', validationEndpoint: '/v1/models', model: selected || 'MiniMax-H3' };
    case 'tripo3d-model': return { adapter, mode: 'official', baseUrl: 'https://openapi.tripo3d.com/v3', validationEndpoint: '/account/usage', model: selected || 'v3.1-20260211' };
    default: throw connectionError('protocol_invalid');
  }
}
export function connectionError(code, status = 400) {
  return Object.assign(new Error('Model connection settings are invalid'), { code, status });
}
export function publicConnectionBase(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) throw connectionError('destination_invalid');
  let url;
  try { url = new URL(value); } catch { throw connectionError('destination_invalid'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host)
    || /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|invalid)$/.test(host)
    || /(?:^|\.)(?:metadata|metadata-google-internal)$/.test(host)) throw connectionError('destination_invalid');
  if (url.pathname !== '/' && (/%|\/{2}|(?:^|\/)\.{1,2}(?:\/|$)/.test(value.slice(value.indexOf(host) + host.length)))) throw connectionError('destination_invalid');
  return url.toString().replace(/\/$/, '');
}
export function connectionEndpoint(value) {
  if (typeof value !== 'string' || value.length > 1024 || !/^\/[A-Za-z0-9_./:-]*$/.test(value)
    || value.startsWith('//') || value.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) throw connectionError('endpoint_invalid');
  return value;
}
export function canonicalConnection(capability, connection) {
  const keys = ['adapter', 'mode', 'baseUrl', 'endpoint', 'model', 'editEndpoint', 'validationEndpoint', 'queryEndpoint'];
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)
    || Object.keys(connection).some((key) => !keys.includes(key))) throw connectionError('connection_invalid');
  if (!connectionProtocols[capability]?.includes(connection.adapter)) throw connectionError('protocol_invalid');
  if (!['official', 'relay'].includes(connection.mode)) throw connectionError('mode_invalid');
  if (typeof connection.baseUrl !== 'string' || (connection.adapter !== 'tripo3d-model' && typeof connection.endpoint !== 'string')) throw connectionError('connection_invalid');
  if (typeof connection.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(connection.model)) throw connectionError('model_invalid');
  if (connection.adapter === 'tripo3d-model' && Object.hasOwn(connection, 'endpoint')) throw connectionError('endpoint_derived');
  if (connection.adapter !== 'openai-image' && Object.hasOwn(connection, 'editEndpoint')) throw connectionError('endpoint_invalid');
  if (connection.adapter !== 'minimax-h3-video' && Object.hasOwn(connection, 'queryEndpoint')) throw connectionError('endpoint_invalid');
  for (const key of ['editEndpoint', 'validationEndpoint', 'queryEndpoint']) if (Object.hasOwn(connection, key) && typeof connection[key] !== 'string') throw connectionError('endpoint_invalid');
  const defaults = connectionDefaults(connection.adapter, connection.model);
  // Official mode never trusts caller-provided destinations or paths.
  if (connection.mode === 'official') return defaults;
  const result = { adapter: connection.adapter, mode: 'relay', baseUrl: publicConnectionBase(connection.baseUrl), model: connection.model };
  for (const key of ['endpoint', 'editEndpoint', 'validationEndpoint', 'queryEndpoint']) {
    if (key === 'endpoint' && connection.adapter === 'tripo3d-model') continue;
    if (key === 'endpoint' && !Object.hasOwn(connection, key)) throw connectionError('endpoint_invalid');
    const value = connection[key] ?? defaults[key];
    if (value !== undefined) result[key] = connectionEndpoint(value);
  }
  return result;
}
export function connectionBinding(model) {
  try { return String(model.adapter) + '\n' + new URL(model.config?.baseUrl).origin; }
  catch { return ''; }
}
export function sanitizeConnectionConfig(value, secrets = []) {
  if (Array.isArray(value)) return value.map((item) => sanitizeConnectionConfig(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/api.?key|authorization|secret|token|password|credential/i.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key))
    .map(([key, item]) => [key, sanitizeConnectionConfig(item, secrets)]));
  if (typeof value === 'string' && secrets.some((secret) => secret && value.includes(secret))) return '[redacted]';
  return value;
}
