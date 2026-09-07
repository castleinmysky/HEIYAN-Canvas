import { localRecords } from '../trial-storage.js';
import { publicGenerationProfile } from './generation-options.js';
import { additionalImageModels, imageModelEntry } from '../../shared/image-model-catalog.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const defaultModels = [
  { id: 'gpt-image-2', name: 'GPT Image 2', capability: 'image', adapter: 'openai-image' },
  { id: 'gemini-image', name: 'Gemini Image', capability: 'image', adapter: 'gemini-image' },
  ...additionalImageModels,
  { id: 'seedance-video', name: 'Seedance', capability: 'video', adapter: 'seedance-video' },
  { id: 'minimax-video', name: 'MiniMax', capability: 'video', adapter: 'minimax-h3-video' },
  { id: 'tripo3d-model', name: 'Tripo3D', capability: 'model', adapter: 'tripo3d-model' },
];
const modelKey = id => `cloud:model:${id}`;
const connectionResult = (status, message, httpStatus = 0) => ({ status, message, httpStatus, checkedAt: new Date().toISOString() });

export function createCloudModelStore({ rules, fetchImpl, records = localRecords }) {
  let initialization;
  async function initialize() {
    return initialization ||= records.transaction('readwrite', (store) => {
      for (const model of defaultModels) store.get(modelKey(model.id)).onsuccess = event => {
        if (!event.target.result) store.put({ model: { ...model, enabled: false, config: { ...rules.connectionDefaults(model.adapter, model.config?.model), connection: connectionResult('missing', 'No API key configured') } }, revision: 0 }, modelKey(model.id));
      };
    });
  }
  async function vaultKey() {
    const existing = await records.read('cloud:vault-key');
    if (existing) return existing;
    const generated = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return records.transaction('readwrite', (store, done) => {
      store.get('cloud:vault-key').onsuccess = event => {
        const key = event.target.result || generated;
        if (!event.target.result) store.put(key, 'cloud:vault-key');
        done(key);
      };
    });
  }
  async function seal(secret, binding) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = new TextEncoder().encode(secret);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(binding) }, await vaultKey(), bytes);
    return { iv, ciphertext };
  }
  async function open(record) {
    if (!record?.secretBox) return '';
    const value = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.secretBox.iv, additionalData: new TextEncoder().encode(rules.connectionBinding(record.model)) }, await vaultKey(), record.secretBox.ciphertext);
    return new TextDecoder().decode(value);
  }
  function adminModel(record) {
    return { ...record.model, config: rules.sanitizeConnectionConfig(record.model.config), secret: { configured: Boolean(record.secretBox), masked: record.secretBox ? '••••••••' : '' } };
  }
  function publicModel(record) {
    const model = record.model, profile = publicGenerationProfile(model);
    return { id: model.id, name: imageModelEntry(model.adapter, model.config.model)?.name || model.name, capability: model.capability, adapter: model.adapter, profile, defaults: { ratio: profile.ratios.includes(model.config.defaultRatio) ? model.config.defaultRatio : profile.defaultRatio, resolution: profile.resolutions.includes(model.config.defaultResolution) ? model.config.defaultResolution : profile.defaultResolution } };
  }
  async function all() { await initialize(); return (await records.entries()).filter(([key]) => key.startsWith('cloud:model:')).map(([, value]) => value); }
  async function runtimeModel(id) {
    await initialize();
    const record = await records.read(modelKey(id));
    if (!record?.model.enabled) throw new Error('Connect this cloud model in Settings first.');
    return { ...record.model, config: { ...record.model.config, apiKey: await open(record) } };
  }
  async function verify(model, key) {
    const config = model.config;
    const endpoint = config.validationEndpoint || rules.connectionDefaults(model.adapter, config.model).validationEndpoint;
    if (!endpoint) return connectionResult('unverified', 'This provider has no non-generating verification endpoint.');
    const headers = model.adapter === 'gemini-image' ? { 'x-goog-api-key': key, accept: 'application/json' } : { authorization: `Bearer ${key}`, accept: 'application/json' };
    try {
      const response = await fetchImpl(config.baseUrl.replace(/\/$/, '') + endpoint, { headers, method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000) });
      if ([401, 403].includes(response.status)) return connectionResult('invalid', 'API key is invalid or access is denied.', response.status);
      if (response.status === 429) return connectionResult('limited', 'Connection is currently rate-limited; generation availability is not verified.', 429);
      if (!response.ok) return connectionResult('unverified', `Connection verification returned HTTP ${response.status}.`, response.status);
      if (model.adapter === 'tripo3d-model') {
        const payload = await response.json().catch(() => null);
        if (!payload || payload.code !== undefined && Number(payload.code) !== 0) return connectionResult('invalid', 'Tripo connection was not accepted.', response.status);
      }
      return connectionResult('ready', 'API connection verified. No content was generated.', response.status);
    } catch { return connectionResult('unreachable', 'Could not reach the selected API service.'); }
  }
  async function commit(id, expectedRevision, next) {
    return records.transaction('readwrite', (store, done) => {
      store.get(modelKey(id)).onsuccess = event => {
        if (event.target.result?.revision !== expectedRevision) return done(false);
        store.put({ ...next, revision: expectedRevision + 1 }, modelKey(id)); done(true);
      };
    });
  }
  async function handle(request) {
    const path = new URL(request.url).pathname, method = request.method;
    if (!path.startsWith('/api/v1/admin/models') && path !== '/api/v1/models') return null;
    await initialize();
    if (path === '/api/v1/models' && method === 'GET') return json({ models: (await all()).filter(r => r.model.enabled).map(publicModel) });
    if (path === '/api/v1/admin/models' && method === 'GET') return json({ models: (await all()).map(adminModel) });
    if (path === '/api/v1/admin/models' && method === 'PUT') {
      const body = await request.json().catch(() => null);
      if (!Array.isArray(body?.models) || body.models.length > 100) return json({ error: 'Invalid model backup.' }, 400);
      const candidates = new Map();
      try {
        for (const item of body.models) {
          // Local-only models from a desktop backup do not become online capabilities.
          if (!rules.advancedConnectionEligible(item)) continue;
          if (!/^[\w.-]{1,120}$/.test(item.id) || candidates.has(item.id)) throw new Error('Invalid model ID');
          const config = item.config || {}, defaults = rules.connectionDefaults(item.adapter, config.model);
          const draft = { ...defaults, mode: config.connectionMode || config.mode || (config.baseUrl && config.baseUrl !== defaults.baseUrl ? 'relay' : 'official') };
          for (const field of ['baseUrl', 'endpoint', 'editEndpoint', 'queryEndpoint', 'validationEndpoint', 'model']) if (config[field] !== undefined) draft[field] = config[field];
          const connection = rules.canonicalConnection(item.capability, draft);
          candidates.set(item.id, { id: item.id, name: String(item.name || item.id).slice(0, 160), capability: item.capability, adapter: connection.adapter, config: { ...connection, connectionMode: connection.mode } });
        }
      } catch { return json({ error: 'The backup contains invalid cloud connection settings.' }, 400); }
      await records.transaction('readwrite', store => {
        for (const [id, model] of candidates) store.get(modelKey(id)).onsuccess = event => {
          const previous = event.target.result;
          const sameDestination = previous && rules.connectionBinding(previous.model) === rules.connectionBinding(model);
          const secretBox = sameDestination ? previous.secretBox : undefined;
          model.enabled = Boolean(secretBox && previous.model.enabled);
          model.config.connection = secretBox ? previous.model.config.connection : connectionResult('missing', 'Enter an API key for this connection.');
          store.put({ model, ...(secretBox ? { secretBox } : {}), revision: (previous?.revision || 0) + 1 }, modelKey(id));
        };
      });
      return json({ models: (await all()).map(adminModel) });
    }
    const match = /^\/api\/v1\/admin\/models\/([\w.-]+)\/(connect|connection)$/.exec(path);
    if (!match) return json({ error: 'Use the selected model connection controls.' }, 405);
    const id = match[1], record = await records.read(modelKey(id));
    if (!record) return json({ error: 'Cloud model not found.' }, 404);
    if (match[2] === 'connection' && method === 'DELETE') {
      const next = { model: { ...record.model, enabled: false, config: { ...record.model.config, connection: connectionResult('missing', 'No API key configured') } } };
      if (!await commit(id, record.revision, next)) return json({ error: 'This model changed in another tab. Reload settings.' }, 409);
      return json({ connected: false, model: adminModel(next) });
    }
    if (match[2] !== 'connect' || method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['apiKey', 'connection'].includes(key)) || body.apiKey !== undefined && typeof body.apiKey !== 'string') return json({ error: 'Invalid connection settings.' }, 400);
    let candidate = record.model;
    if (body.connection) {
      try {
        const connection = rules.canonicalConnection(record.model.capability, body.connection);
        candidate = { ...record.model, adapter: connection.adapter, config: { ...rules.sanitizeConnectionConfig(record.model.config), ...connection, connectionMode: connection.mode } };
      } catch (error) { return json({ error: 'Invalid advanced connection settings.', code: error.code || 'connection_invalid' }, 400); }
    }
    const supplied = String(body.apiKey || '').trim();
    if (supplied.length > 8000) return json({ error: 'API key is too long.' }, 400);
    if (rules.connectionBinding(candidate) !== rules.connectionBinding(record.model) && !supplied) return json({ error: 'Enter a new API key when changing the provider or destination.', code: 'new_key_required' }, 400);
    const key = supplied || await open(record);
    if (!key) return json({ error: 'Enter an API key.', code: 'key_required' }, 400);
    const connection = await verify(candidate, key);
    if (!['ready', 'limited'].includes(connection.status)) return json({ error: connection.message, connection }, connection.status === 'invalid' ? 401 : 422);
    const next = { model: { ...candidate, enabled: true, config: { ...candidate.config, connection } }, secretBox: await seal(key, rules.connectionBinding(candidate)) };
    if (!await commit(id, record.revision, next)) return json({ error: 'This model changed while verifying. Reload settings before saving.' }, 409);
    return json({ connected: true, connection, model: adminModel(next) });
  }
  return { handle, runtimeModel, all };
}
