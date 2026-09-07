import { localRecords, handleLocalRequest } from './trial-storage.js';
import { preserveHistoryVisibility } from './cloud/history-state.js';
import { connectorAddress, localConnectorUrl } from './connector-address.js';

export { localConnectorUrl } from './connector-address.js';
const connectionKey = 'local-comfy:connection';
const machineKey = id => 'local-comfy:machine:' + id;
const identified = id => /^[\w-]{16,80}$/.test(id || '') && id !== 'local-loopback-v1';
const key = id => 'cloud:job:' + id;
const active = job => ['queued', 'running', 'cancelling'].includes(job.status);
const json = (payload, status = 200) => Response.json(payload, { status });
const now = () => new Date().toISOString();

/** Calls go to the explicitly paired connector, never through the Site/cloud API proxy. */
export function createLocalComfyApi({ nativeFetch, baseApi, origin, records = localRecords, locks = globalThis.navigator?.locks }) {
  const pending = new Map();
  async function connection() { return await records.read(connectionKey); }
  async function remote(path, options = {}, candidate, job) {
    let saved = candidate || await connection();
    // A connection switch must never redirect an existing job to the new machine.
    if (!candidate && job && identified(job.bridgeServerId) && job.bridgeServerId !== saved?.serverId) {
      saved = await records.read(machineKey(job.bridgeServerId));
      if (!saved) throw new Error('Reconnect to the machine that accepted this task. It was not submitted to another machine.');
    }
    const token = saved?.token;
    const baseUrl = connectorAddress(saved?.baseUrl);
    if (!token) throw new Error('Generation connector is not paired.');
    if (job && ((job.bridgeServerId && job.bridgeServerId !== (saved.serverId || 'local-loopback-v1')) || (!job.bridgeServerId && (baseUrl !== localConnectorUrl || identified(saved.serverId))))) throw new Error('Reconnect to the machine that accepted this task. It was not submitted to another machine.');
    let response;
    try { response = await nativeFetch(baseUrl + path, { ...options, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(120_000), headers: { ...options.headers, Authorization: 'Bearer ' + token } }); }
    catch { throw new Error(baseUrl === localConnectorUrl ? 'Open the local connector on this computer and allow local network access in the browser.' : 'Remote connector unavailable. Keep the deployment machine online and check its current HTTPS address.'); }
    if (!response.ok) { const payload = await response.json().catch(() => ({})); throw Object.assign(new Error(String(payload.error || 'Generation connector request failed.').replaceAll(token, '[redacted]')), { status: response.status, code: 'connector_rejected' }); }
    return response;
  }
  const remoteJson = async (path, value, candidate, job) => (await remote(path, value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }, candidate, job)).json();
  async function patch(id, change, assets = []) {
    return records.transaction('readwrite', (store, done) => { store.get(key(id)).onsuccess = event => {
      const current = event.target.result; if (!current) return done(null);
      // A delayed poll/upload/submission response cannot revive a cancelled task.
      const next = { ...current, ...change, updatedAt: now() };
      if (change.outputs) next.outputs = preserveHistoryVisibility(current.outputs, change.outputs);
      if (current.bridgeCancelRequested && !['succeeded', 'failed', 'cancelled'].includes(change.status)) {
        Object.assign(next, { status: current.status, stage: current.stage, bridgeWaiting: false });
      }
      for (const [assetKey, asset] of assets) store.put(asset, assetKey);
      store.put(next, key(id)); done(next);
    }; });
  }
  async function accept(job, received) {
    const { id: _id, taskId: _task, canvasId: _canvas, inputs: _inputs, outputs: rawOutputs, comfyPreview: _preview, ...change } = received;
    if (received.status !== 'succeeded') return patch(job.id, { ...change, comfyPreview: undefined, bridgeAcknowledged: true, bridgeWaiting: false });
    const outputs = [], assets = [];
    for (const [index, output] of (rawOutputs || []).entries()) {
      const response = await remote('/jobs/' + job.id + '/outputs/' + index, {}, undefined, job);
      const blob = await response.blob();
      if (!blob.size || blob.size > 256 * 1024 ** 2) throw new Error('Local result exceeds the browser storage limit. The original remains in the deployment folder.');
      const extension = String(output.fileName || '').match(/\.[a-z0-9]{2,5}$/i)?.[0] || (output.mediaType === 'video' ? '.mp4' : '.png');
      const assetId = job.id + '-' + index + extension;
      assets.push(['asset:' + assetId, { blob, name: output.fileName || assetId, type: blob.type, source: 'generated', createdAt: now() }]);
      outputs.push({ ...output, mediaUrl: '/media/assets/' + assetId });
    }
    return patch(job.id, { ...change, outputs, comfyPreview: undefined, bridgeAcknowledged: true, bridgeWaiting: false, error: '', bridgePayload: undefined }, assets);
  }
  async function prepare(job) {
    let payload = job.bridgePayload;
    if (!payload) {
      const inputs = [];
      for (const input of job.inputs || []) {
        if (!['image', 'video', 'audio', 'model', 'character', 'pose', 'lineart'].includes(input.type)) { inputs.push(input); continue; }
        if (!/^\/media\/assets\/[\w.-]+$/.test(input.value || '')) throw new Error('Import the reference into this canvas before sending it to the local connector.');
        const source = await handleLocalRequest(new Request(new URL(input.value, origin)));
        if (!source.ok) throw new Error('The input media is no longer saved in this browser.');
        const blob = await source.blob();
        if (blob.size > 63 * 1024 * 1024) throw new Error('Local reference files must be smaller than 63 MB.');
        const form = new FormData(); form.append('file', blob, input.value.split('/').pop());
        const uploaded = await (await remote('/assets', { method: 'POST', body: form }, undefined, job)).json();
        inputs.push({ ...input, value: uploaded.url });
      }
      payload = { modelId: job.modelId, capability: job.capability, nodeId: job.nodeId, workflowId: job.workflowId, generationContractVersion: job.generationContractVersion, prompt: job.prompt, options: job.options, inputs };
      // Save the exact idempotent request before the first submit, including uploaded IDs.
      await patch(job.id, { bridgePayload: payload });
    }
    return payload;
  }
  async function synchronize(job) {
    if (!active(job) && !job.bridgeWaiting) return job;
    if (pending.has(job.id)) return pending.get(job.id);
    const work = async () => {
      job = await records.read(key(job.id));
      if (!job || (!active(job) && !job.bridgeWaiting)) return job;
      if (job.bridgeCancelRequested) return cancelRemote(job);
      try {
        let received;
        if (job.bridgeAcknowledged) received = await remoteJson('/jobs/' + job.id, undefined, undefined, job);
        else {
          const payload = await prepare(job);
          job = await patch(job.id, { bridgeSubmissionStarted: true });
          if (!job || job.bridgeCancelRequested) return job;
          received = await remoteJson('/jobs/' + job.id, payload, undefined, job);
        }
        return await accept(job, received.job);
      } catch (error) {
        // Reconnect only to the same ID. Never create a second GPU task after refresh.
        const rejected = [400, 409, 404].includes(error.status);
        return patch(job.id, { status: rejected ? 'failed' : job.status, bridgeWaiting: !rejected, stage: rejected ? 'Local task needs attention' : 'Reconnecting to local engine', error: String(error.message || error) });
      }
    };
    const promise = (locks ? locks.request('heiyan-local:' + job.id, work) : work()).finally(() => pending.delete(job.id));
    pending.set(job.id, promise); return promise;
  }
  async function cancelRemote(job, stopWaiting = false) {
    try {
      // Never synchronize/submit a task as a prerequisite for cancellation.
      const result = await remoteJson('/jobs/' + job.id + '/cancel', {}, undefined, job);
      if (!result.job || !['queued', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled'].includes(result.job.status)) throw new Error('Invalid cancellation response.');
      const next = await accept(job, result.job);
      if (['succeeded', 'failed', 'cancelled'].includes(next.status)) return patch(job.id, { bridgeCancellationUnconfirmed: false, bridgeWaiting: false });
      return patch(job.id, { status: 'cancelling', stage: 'Waiting for the original machine to confirm cancellation', bridgeWaiting: false });
    } catch (error) {
      const neverSubmitted = !job.bridgeSubmissionStarted && !job.bridgePayload && !job.bridgeAcknowledged;
      if (error.status === 404 && neverSubmitted) return patch(job.id, { status: 'cancelled', stage: 'Cancelled before submission', bridgeWaiting: false, bridgeCancellationUnconfirmed: false, error: '' });
      if (stopWaiting) return patch(job.id, { status: 'cancelled', stage: 'Local waiting ended; remote cancellation unconfirmed', bridgeWaiting: false, bridgeCancellationUnconfirmed: true, error: 'Remote cancellation could not be confirmed. Check the original machine; this task will not be resubmitted.' });
      return patch(job.id, { status: 'cancelling', stage: 'Remote cancellation unconfirmed', bridgeWaiting: false, bridgeCancellationUnconfirmed: true, error: String(error.message || error) });
    }
  }
  async function cancel(job, stopWaiting = false) {
    if (!active(job) && !job.bridgeWaiting) return job;
    await patch(job.id, { bridgeCancelRequested: true, status: 'cancelling', bridgeWaiting: false, stage: 'Cancelling on the original machine' });
    const work = async () => {
      const current = await records.read(key(job.id));
      if (!current || !active(current)) return current;
      return cancelRemote(current, stopWaiting);
    };
    // Shares the submission lock across tabs, so cancel cannot overtake a POST.
    if (locks) return locks.request('heiyan-local:' + job.id, work);
    await pending.get(job.id);
    return work();
  }
  async function create(body) {
    const saved = await connection();
    const model = saved?.models?.find(item => item.id === body.modelId);
    if (!saved?.enabled || !model) return json({ error: 'Pair the local connector in Settings first.' }, 409);
    if (!String(body.prompt || '').trim() && !body.inputs?.length) return json({ error: 'Enter a prompt or connect reference media.' }, 400);
    const job = { id: 'local_' + crypto.randomUUID(), localBridge: true, taskId: body.taskId || 'local-canvas', canvasId: body.canvasId || 'main', nodeId: body.nodeId, nodeTitle: String(body.nodeTitle || '').slice(0, 160), modelId: body.modelId, modelAdapter: model.adapter, capability: body.capability, workflowId: body.workflowId, generationContractVersion: body.generationContractVersion, prompt: String(body.prompt || '').slice(0, 12000), options: body.options || {}, inputs: body.inputs || [], status: 'queued', stage: 'Preparing local generation', progress: 0, outputs: [], attempt: 1, createdAt: now(), updatedAt: now() };
    job.bridgeServerId = saved.serverId || 'local-loopback-v1';
    const duplicate = await records.transaction('readwrite', (store, done) => {
      let found;
      store.get(connectionKey).onsuccess = event => {
      const current = event.target.result;
      if (!current?.enabled || current.revision !== saved.revision || current.token !== saved.token) return done({ connectionChanged: true });
      store.openCursor().onsuccess = event => { const cursor = event.target.result;
        if (cursor) { const value = cursor.value; if (String(cursor.key).startsWith('cloud:job:') && value.taskId === job.taskId && value.canvasId === job.canvasId && value.nodeId === job.nodeId && active(value)) found = value; cursor.continue(); }
        else { if (!found) store.put(job, key(job.id)); done(found); }
      };
      };
    });
    if (duplicate?.connectionChanged) return json({ error: 'Connection changed. Check the selected machine before generating.' }, 409);
    if (duplicate) return json({ error: 'This node already has a running task.', job: duplicate }, 409);
    void synchronize(job); return json({ job }, 202);
  }
  return async request => {
    const url = new URL(request.url), route = url.pathname;
    try {
      if (route === '/api/v1/local-connector') {
        if (request.method === 'GET') { const saved = await connection(); return json({ enabled: Boolean(saved?.enabled), modelCount: saved?.models?.length || 0, baseUrl: saved?.baseUrl || localConnectorUrl }); }
        if (request.method === 'DELETE') { await records.transaction('readwrite', (store, done) => { store.get(connectionKey).onsuccess = event => { store.put({ ...event.target.result, enabled: false, revision: crypto.randomUUID() }, connectionKey); done(true); }; }); return json({ enabled: false }); }
        if (request.method === 'POST') {
          const body = await request.json(); const saved = await connection();
          const baseUrl = connectorAddress(body.baseUrl ?? saved?.baseUrl);
          if (baseUrl !== (saved?.baseUrl || localConnectorUrl) && !String(body.code || '').trim()) return json({ error: 'Enter the access code again when changing the HTTPS address.' }, 400);
          const token = String(body.code || saved?.token || '').trim();
          if (!/^[\w-]{43}$/.test(token)) return json({ error: 'Enter the pairing code shown by your local connector.' }, 400);
          const result = await remoteJson('/connect', {}, { token, baseUrl });
          if (![1, 2].includes(result.version) || (baseUrl !== localConnectorUrl && (result.version !== 2 || !identified(result.serverId))) || !Array.isArray(result.models) || result.models.some(model => !String(model.adapter).startsWith('comfyui-'))) return json({ code: 'connector_update_required', error: 'Update the generation connector before pairing.' }, 409);
          const serverId = result.serverId || 'local-loopback-v1';
          const belongsElsewhere = job => job.localBridge && (active(job) || job.bridgeWaiting)
            && job.bridgeServerId !== serverId
            && !((!job.bridgeServerId || job.bridgeServerId === 'local-loopback-v1') && baseUrl === localConnectorUrl && (!saved?.baseUrl || saved.baseUrl === localConnectorUrl) && saved?.token === token);
          let cancelledTaskCount = 0, unconfirmedTaskCount = 0;
          if (body.cancelOriginalTasks === true) {
            const current = await connection();
            if (current?.revision !== saved?.revision || current?.token !== saved?.token) return json({ code: 'connection_changed', error: 'Another tab changed the connection. Check it and try again.' }, 409);
            const originals = (await records.entries()).filter(([id, job]) => String(id).startsWith('cloud:job:') && belongsElsewhere(job)).map(([, job]) => job);
            const results = await Promise.all(originals.map(job => cancel(job, body.stopWaitingIfUnavailable === true)));
            cancelledTaskCount = results.filter(job => job?.status === 'cancelled').length;
            unconfirmedTaskCount = results.filter(job => job?.bridgeCancellationUnconfirmed).length;
            if (results.some(job => active(job))) return json({ code: unconfirmedTaskCount ? 'cancellation_unconfirmed' : 'cancellation_pending', taskCount: results.filter(job => active(job)).length, error: unconfirmedTaskCount ? 'Remote cancellation could not be confirmed. You may explicitly end local waiting and switch; the original machine may still be working.' : 'Cancellation requested. Wait for confirmation from the original machine, then try again.' }, 409);
          }
          const changed = await records.transaction('readwrite', (store, done) => {
            store.get(connectionKey).onsuccess = event => {
              const current = event.target.result;
              if (current?.revision !== saved?.revision || current?.token !== saved?.token) return done({ code: 'connection_changed' });
              let blockedCount = 0;
              const upgrades = [];
              store.openCursor().onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                  const job = cursor.value;
                  if (String(cursor.key).startsWith('cloud:job:') && job.localBridge && (active(job) || job.bridgeWaiting)) {
                    if ((!job.bridgeServerId || job.bridgeServerId === 'local-loopback-v1') && baseUrl === localConnectorUrl && (!saved?.baseUrl || saved.baseUrl === localConnectorUrl) && saved?.token === token) upgrades.push([cursor.key, { ...job, bridgeServerId: serverId }]);
                    else if (job.bridgeServerId !== serverId) blockedCount++;
                  }
                  cursor.continue();
                } else {
                  if (blockedCount) return done({ code: 'tasks_bound_to_original', taskCount: blockedCount });
                  // Store only in browser-private connection records, never job/export payloads.
                  if (identified(current?.serverId)) store.put(current, machineKey(current.serverId));
                  for (const [id, job] of upgrades) store.put(job, id);
                  const next = { token, baseUrl, serverId, revision: crypto.randomUUID(), enabled: true, models: result.models };
                  store.put(next, connectionKey);
                  if (identified(serverId)) store.put(next, machineKey(serverId));
                  done({ cancelledTaskCount, unconfirmedTaskCount });
                }
              };
            };
          });
          if (changed.code) return json({ ...changed, error: changed.code === 'connection_changed' ? 'Another tab changed the connection. Check it and try again. Any confirmed cancellations remain in history.' : 'Unfinished tasks belong to the original machine. Cancel them before switching; they will not be resubmitted.' }, 409);
          return json({ enabled: true, baseUrl, modelCount: result.models.length, cancelledTaskCount: changed.cancelledTaskCount, unconfirmedTaskCount: changed.unconfirmedTaskCount });
        }
      }
      if (route === '/api/v1/models' && request.method === 'GET') {
        const response = await baseApi(request); const payload = await response.json(); const saved = await connection();
        return json({ ...payload, models: [...payload.models, ...(saved?.enabled ? saved.models : [])] });
      }
      if (['/api/v1/comfyui/resources', '/api/v1/comfyui/recipes'].includes(route) && (await connection())?.enabled) return json(await remoteJson(route.replace('/api/v1/comfyui', '')));
      if (route === '/api/v1/jobs' && request.method === 'POST') {
        const body = await request.clone().json();
        if ((await connection())?.models?.some(model => model.id === body.modelId)) return create(body);
      }
      if (route === '/api/v1/jobs' && request.method === 'GET') {
        const response = await baseApi(request); const payload = await response.json();
        // Listing history is observational: never submit, poll or re-import GPU outputs.
        if (url.searchParams.get('historyOnly') === '1') return json(payload);
        return json({ ...payload, jobs: await Promise.all((payload.jobs || []).map(job => job.localBridge ? synchronize(job) : job)) });
      }
      const match = /^\/api\/v1\/jobs\/(local_[a-f0-9-]{36})(?:\/(resume|retry|cancel))?$/.exec(route);
      if (match) {
        const job = await records.read(key(match[1])); if (!job) return json({ error: 'Task not found in this browser.' }, 404);
        if (request.method === 'GET' || (request.method === 'POST' && match[2] === 'resume')) return json({ job: await synchronize(job) });
        if (request.method === 'POST' && match[2] === 'cancel') { const body = await request.json().catch(() => ({})); return json({ job: await cancel(job, body.stopWaitingIfUnavailable === true) }); }
        if (request.method === 'POST' && match[2] === 'retry') {
          const body = await request.json().catch(() => ({}));
          if (body.confirmNewPaidSubmission !== true) return json({ error: 'Confirm a new generation first.' }, 409);
          return create(job);
        }
        return json({ error: 'Method not allowed.' }, 405);
      }
      return baseApi(request);
    } catch (error) { return json({ error: String(error.message || 'Local connection failed.'), ...(error.code ? { code: error.code } : {}) }, error.status || 503); }
  };
}
