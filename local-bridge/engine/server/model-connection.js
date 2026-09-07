import { advancedConnectionEligible, canonicalConnection, connectionBinding, connectionError, publicConnectionBase, connectionEndpoint, sanitizeConnectionConfig } from '../shared/model-connection-settings.js';
const acceptedConnectionStates = new Set(['ready', 'limited']);
import { withAdditionalImageModels } from '../shared/image-model-catalog.js';

function normalizedBaseUrl(value) { return publicConnectionBase(String(value || '').trim()); }

function appendPath(baseUrl, path) {
  return `${normalizedBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

export function modelConnectionRequired(model) {
  return !String(model?.adapter || '').startsWith('comfyui-')
    && String(model?.adapter || '') !== 'gpt-sovits-audio';
}

export function modelConnectionAccepted(connection) {
  return acceptedConnectionStates.has(String(connection?.status || ''));
}

export function modelConnectionProbe(model, apiKey) {
  const adapter = String(model?.adapter || 'http');
  const config = model?.config || {};
  const baseUrl = normalizedBaseUrl(config.baseUrl);
  const bearer = { accept: 'application/json', authorization: `Bearer ${apiKey}` };

  if (config.connectionMode && config.validationEndpoint) {
    return { url: appendPath(baseUrl, connectionEndpoint(config.validationEndpoint)), headers: adapter === 'gemini-image' ? { accept: 'application/json', 'x-goog-api-key': apiKey } : bearer, ...(adapter === 'tripo3d-model' ? { provider: 'tripo3d' } : {}) };
  }
  if (adapter === 'gemini-image') {
    return { url: appendPath(baseUrl, '/v1beta/models?pageSize=1'), headers: { accept: 'application/json', 'x-goog-api-key': apiKey } };
  }
  if (adapter === 'seedance-video') {
    return { url: appendPath(baseUrl, '/models'), headers: bearer };
  }
  if (adapter === 'tripo3d-model') {
    return { url: appendPath(baseUrl, '/account/usage'), headers: bearer, provider: 'tripo3d' };
  }
  if (adapter === 'openai-image' || adapter === 'minimax-h3-video') {
    const suffix = /\/v\d+(?:beta)?$/i.test(new URL(baseUrl).pathname) ? '/models' : '/v1/models';
    return { url: appendPath(baseUrl, suffix), headers: bearer };
  }
  if (adapter === 'http' && config.validationEndpoint) {
    return { url: appendPath(baseUrl, String(config.validationEndpoint)), headers: bearer };
  }
  throw new Error('该服务尚未提供安全的无生成验证方式');
}

function connectionResult(status, message, httpStatus = 0) {
  return { status, message, httpStatus, checkedAt: new Date().toISOString() };
}

export async function verifyModelConnection(model, apiKey, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!modelConnectionRequired(model)) return connectionResult('ready', '本地服务无需 API 密钥');
  if (!String(apiKey || '').trim()) return connectionResult('missing', '请填写 API 密钥');

  let probe;
  try { probe = modelConnectionProbe(model, String(apiKey).trim()); }
  catch (error) { return connectionResult('unverified', '无法验证该服务，请检查连接设置'); }

  try {
    const response = await fetchImpl(probe.url, {
      method: 'GET',
      headers: probe.headers,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) return connectionResult('invalid', 'API 密钥无效或没有访问权限', response.status);
    if (response.status === 429) return connectionResult('limited', 'API 密钥有效，但服务当前受到额度或频率限制', response.status);
    if (!response.ok) {
      const unavailable = response.status >= 500;
      return connectionResult(unavailable ? 'unreachable' : 'unverified', unavailable ? '模型服务暂时不可用' : `服务无法完成验证（HTTP ${response.status}）`, response.status);
    }
    if (probe.provider === 'tripo3d' && payload?.code !== undefined && Number(payload.code) !== 0) {
      return connectionResult('invalid', 'Tripo API 密钥无效或没有访问权限', response.status);
    }
    return connectionResult('ready', 'API 密钥验证通过', response.status);
  } catch {
    return connectionResult('unreachable', '无法连接模型服务，请检查网络后重试');
  }
}

export async function connectModelCandidate(storage, modelId, body, { fetchImpl = fetch, defaultModels = [] } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['apiKey', 'connection'].includes(key))
    || (Object.hasOwn(body, 'apiKey') && (typeof body.apiKey !== 'string' || body.apiKey.length > 8000 || /[\r\n\0]/.test(body.apiKey)))) throw connectionError('request_invalid');
  return storage.transactModelConnection(async ({ models, secrets }) => {
    if (!models.some(model => model.id === modelId)) models = withAdditionalImageModels(models);
    const index = models.findIndex((item) => item.id === modelId);
    const previous = models[index];
    if (!previous || !modelConnectionRequired(previous)) throw connectionError('model_unavailable', 404);
    const supplied = String(body.apiKey || '').trim();
    let candidate = structuredClone(previous);
    if (Object.hasOwn(body, 'connection')) {
      if (!advancedConnectionEligible(previous)) throw connectionError('protocol_invalid');
      const connection = canonicalConnection(previous.capability, body.connection);
      const { adapter, mode, ...config } = connection;
      const retained = sanitizeConnectionConfig(previous.config || {});
      // Remove protocol-specific destination fields before applying the candidate.
      for (const key of ['endpoint', 'editEndpoint', 'validationEndpoint', 'queryEndpoint']) delete retained[key];
      candidate = { ...previous, adapter, config: { ...retained, ...config, connectionMode: mode } };
      if (connectionBinding(previous) !== connectionBinding(candidate) && !supplied) throw connectionError('new_key_required', 409);
    }
    const apiKey = supplied || String(secrets[modelId] || '').trim();
    const verified = await verifyModelConnection(candidate, apiKey, { fetchImpl });
    if (!modelConnectionAccepted(verified)) throw Object.assign(connectionError('verification_failed', verified.status === 'invalid' ? 401 : 422), { connection: verified });
    candidate.enabled = true;
    candidate.config = { ...sanitizeConnectionConfig(candidate.config || {}), connection: verified };
    models[index] = candidate;
    if (supplied) secrets[modelId] = supplied;
    return { models, secrets, model: candidate, connection: verified };
  }, defaultModels);
}
