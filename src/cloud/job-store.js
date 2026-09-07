import { Buffer } from 'buffer';
import { preserveHistoryVisibility } from './history-state.js';
import { localRecords, handleLocalRequest } from '../trial-storage.js';
import { normalizeGenerationOptions } from './generation-options.js';
import { validateSeedanceInputs } from './seedance-inputs.js';
import { validateMiniMaxH3Inputs } from './minimax-h3-inputs.js';
import { createCloudProviders } from './providers.js';
import { normalizeTripo3dPostprocessOperation, tripo3dPostprocessRequest } from './adapters/tripo3d-postprocess.js';
import { TRIPO_CLEAN_ALBEDO_TEXTURE_INTENT, tripoCleanAlbedoTexturePrompt } from './tripo3d-texture-intent.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const now = () => new Date().toISOString();
const activeStatuses = new Set(['queued', 'running', 'cancelling', 'paused']);
const jobKey = id => `cloud:job:${id}`;
const mimeFor = (kind, extension) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json' })[extension] || (kind === 'image' ? 'image/png' : 'application/octet-stream');
const binding = model => JSON.stringify([model.adapter, model.config.baseUrl, model.config.endpoint, model.config.model]);
const mergeWorkflow = (current, incoming) => ({ ...current, ...incoming, stages: { ...current?.stages, ...incoming?.stages } });

export function createCloudJobStore({ models, fetchImpl, origin, records = localRecords, providers = createCloudProviders(fetchImpl), locks = globalThis.navigator?.locks }) {
  const active = new Map();
  let cleaning = false;
  async function allJobs() { return (await records.entries()).filter(([key]) => key.startsWith('cloud:job:')).map(([, value]) => value); }
  async function patch(id, change) {
    return records.transaction('readwrite', (store, done) => {
      store.get(jobKey(id)).onsuccess = event => {
        const current = event.target.result;
        if (!current) return done(null);
        const next = { ...current, ...(typeof change === 'function' ? change(current) : change), updatedAt: now() };
        if (next.outputs !== current.outputs) next.outputs = preserveHistoryVisibility(current.outputs, next.outputs);
        store.put(next, jobKey(id)); done(next);
      };
    });
  }
  async function reference(input) {
    if (!['image', 'video', 'audio', 'model'].includes(input.type)) return null;
    const value = String(input.value || '');
    let response;
    if (/^\/media\/assets\/[\w.-]+$/.test(value)) response = await handleLocalRequest(new Request(new URL(value, origin)));
    else if (/^https:\/\//.test(value) && input.type === 'image') response = await fetchImpl(value);
    else return null;
    if (!response.ok) throw new Error('A referenced media file could not be read.');
    const blob = await response.blob();
    if (blob.size > 64 * 1024 * 1024) throw new Error('A reference exceeds the online 64 MB request limit.');
    return { ...input, cacheKey: value, mimeType: blob.type, buffer: Buffer.from(await blob.arrayBuffer()), fileName: value.split('/').pop() };
  }
  async function outputRecords(outputs) {
    const assets = [], stored = [], remap = new Map();
    for (const output of outputs) {
      let blob;
      const extension = String(output.extension || String(output.fileName || output.mediaUrl || '').match(/\.[a-z0-9]{2,5}(?=$|\?)/i)?.[0] || (output.mediaType === 'model' ? '.glb' : output.mediaType === 'video' ? '.mp4' : '.png')).toLowerCase();
      if (output.buffer) blob = new Blob([new Uint8Array(output.buffer)], { type: mimeFor(output.mediaType, extension) });
      else {
        const response = await fetchImpl(output.mediaUrl);
        if (!response.ok) throw new Error('The generated result could not be downloaded. Resume result retrieval; do not submit another generation.');
        blob = await response.blob();
      }
      if (!blob.size || blob.size > 256 * 1024 * 1024) throw new Error('The generated result is empty or exceeds 256 MB.');
      const id = crypto.randomUUID() + extension, url = `/media/assets/${id}`;
      const name = String(output.fileName || id).replace(/[\\/\x00-\x1f]/g, '_').slice(0, 180);
      assets.push([`asset:${id}`, { blob, name, type: blob.type, source: 'generated', createdAt: now() }]);
      if (output.mediaUrl) remap.set(output.mediaUrl, url);
      const { buffer: _buffer, ...rest } = output;
      stored.push({ ...rest, mediaUrl: url, fileName: name });
      const previewUrl = output.previewUrl || output.metadata?.previewUrl;
      if (previewUrl && previewUrl !== output.mediaUrl && /^https:\/\//.test(previewUrl)) {
        try {
          const previewResponse = await fetchImpl(previewUrl);
          if (previewResponse.ok) {
            const preview = await previewResponse.blob();
            if (preview.size && preview.size <= 8 * 1024 * 1024 && preview.type.startsWith('image/')) {
              const previewId = crypto.randomUUID() + (preview.type === 'image/webp' ? '.webp' : preview.type === 'image/jpeg' ? '.jpg' : '.png');
              const localPreview = '/media/assets/' + previewId;
              assets.push(['asset:' + previewId, { blob: preview, name: previewId, type: preview.type, source: 'generated', createdAt: now() }]);
              stored.at(-1).previewUrl = localPreview;
              stored.at(-1).metadata = { ...stored.at(-1).metadata, previewUrl: localPreview };
            }
          }
        } catch { /* Preview retrieval cannot discard a successfully retrieved original. */ }
      }
    }
    for (const output of stored) if (remap.has(output.metadata?.previewUrl)) output.metadata = { ...output.metadata, previewUrl: remap.get(output.metadata.previewUrl) };
    return { assets, stored };
  }
  async function execute(job, controller) {
    let key = '';
    try {
      const model = await models.runtimeModel(job.modelId); key = model.config.apiKey;
      if (job.modelBinding !== binding(model)) throw new Error('This model connection changed. Restore the original connection before resuming its task.');
      await patch(job.id, { status: 'running', stage: 'Generating', progress: 8, error: '' });
      const referenceMedia = (await Promise.all(job.inputs.filter(input => !['seedance-video', 'minimax-h3-video'].includes(model.adapter) || !/^https:\/\//.test(input.value || '')).map(reference))).filter(Boolean);
      if (model.adapter === 'seedance-video' && referenceMedia.some(item => ['video', 'audio'].includes(item.type))) throw new Error('Seedance video/audio references require your own publicly accessible HTTPS media URLs. Browser-local files are not uploaded automatically.');
      const inputs = model.adapter === 'minimax-h3-video' ? job.inputs.map(input => {
        const found = referenceMedia.find(item => item.cacheKey === input.value && item.type === input.type);
        return found && ['video', 'audio'].includes(found.type) ? { ...input, value: `data:${found.mimeType};base64,${found.buffer.toString('base64')}` } : input;
      }) : job.inputs;
      const callbacks = {
        signal: controller.signal,
        onSubmissionStarted: () => patch(job.id, { submissionStartedAt: now() }),
        onProgress: progress => patch(job.id, { progress: Math.min(95, Math.max(8, Number(progress) || 8)) }),
        onRemoteTask: (remoteTaskId, workflow) => patch(job.id, current => ({ remoteTaskId: String(remoteTaskId), tripoWorkflow: mergeWorkflow(current.tripoWorkflow, workflow) })),
        onWorkflowState: workflow => patch(job.id, current => ({ tripoWorkflow: mergeWorkflow(current.tripoWorkflow, workflow) })),
        onSubmissionUnknown: workflow => patch(job.id, current => ({ tripoWorkflow: mergeWorkflow(current.tripoWorkflow, workflow), submissionUnknown: true })),
      };
      let generated;
      if (job.pendingOutputs) generated = { ...job.pendingCompletion, outputs: job.pendingOutputs };
      else if (job.tripoPostprocessOperation) {
        const runner = providers.postprocess(model);
        const options = { ...job.postprocessOptions };
        if (job.postprocessSourceAsset?.url && !job.remoteTaskId && !options.fileToken) {
          const media = await reference({ type: 'model', value: job.postprocessSourceAsset.url });
          if (!media) throw new Error('Select a locally imported model for this operation.');
          options.fileToken = await runner.client.uploadFile(media, { signal: controller.signal });
          for (const name of ['taskId', 'task_id', 'url', 'sourceUrl', 'source_url']) delete options[name];
          await patch(job.id, { postprocessOptions: options });
        }
        const cleanAlbedo = job.tripoPostprocessOperation === 'texture' && options.textureIntent === TRIPO_CLEAN_ALBEDO_TEXTURE_INTENT;
        if (job.tripoPostprocessOperation === 'texture' && !job.remoteTaskId && options.textureAlignment === 'original_image' && !options.texturePrompt) {
          const order = ['front', 'left', 'back', 'right'];
          const images = referenceMedia.filter(item => item.type === 'image').sort((a, b) => order.indexOf(a.port) - order.indexOf(b.port));
          const fourViews = images.length === 4 && order.every(port => images.some(image => image.port === port));
          const selected = cleanAlbedo || !fourViews ? images.slice(0, 1) : images;
          const uploaded = [];
          for (const image of selected) uploaded.push({ fileToken: await runner.client.uploadFile(image, { signal: controller.signal }) });
          if (uploaded.length) options.texturePrompt = cleanAlbedo ? tripoCleanAlbedoTexturePrompt(uploaded[0].fileToken) : fourViews ? { images: uploaded } : { image: uploaded[0] };
          else if (cleanAlbedo) options.texturePrompt = tripoCleanAlbedoTexturePrompt();
          await patch(job.id, { postprocessOptions: options });
        }
        generated = await runner.run({ operation: job.tripoPostprocessOperation, options, remoteTaskId: job.remoteTaskId, ...callbacks });
      } else {
        const options = normalizeGenerationOptions(model, job.options);
        if (['openai-image', 'gemini-image'].includes(model.adapter)) await callbacks.onSubmissionStarted();
        generated = await providers.get(model).run({ ...job, inputs, referenceImages: referenceMedia.filter(item => item.type === 'image'), referenceMedia, ratio: options.ratio, resolution: options.resolution, count: options.count, options, ...callbacks });
      }
      const outputs = Array.isArray(generated) ? generated : generated.outputs || [];
      // Persist remote result URLs before downloading, so retries retrieve existing work.
      if (outputs.every(output => output.mediaUrl && !output.buffer)) {
        const { outputs: _outputs, rawTask: _rawTask, ...pendingCompletion } = Array.isArray(generated) ? {} : generated;
        await patch(job.id, { pendingOutputs: outputs, pendingCompletion });
      }
      const { assets, stored } = await outputRecords(outputs);
      if (!stored.length && job.tripoPostprocessOperation !== 'rig-check') throw new Error('The service returned no generated result.');
      const completion = { status: 'succeeded', progress: 100, stage: 'Complete', outputs: stored, pendingOutputs: undefined, error: '', ...(generated.usage ? { usage: generated.usage } : {}), ...(job.tripoPostprocessOperation ? { postprocessResult: { operation: generated.operation, taskId: generated.taskId, modelUrl: generated.modelUrl, modelUrls: generated.modelUrls, renderedImageUrl: generated.renderedImageUrl, riggable: generated.riggable, rigType: generated.rigType } } : {}) };
      await records.transaction('readwrite', (store) => {
        store.get(jobKey(job.id)).onsuccess = event => {
          if (controller.signal.aborted || event.target.result?.status === 'cancelled') return;
          for (const [id, asset] of assets) store.put(asset, id);
          store.put({ ...event.target.result, ...completion, outputs: preserveHistoryVisibility(event.target.result?.outputs, completion.outputs), updatedAt: now() }, jobKey(job.id));
        };
      });
    } catch (error) {
      const current = await records.read(jobKey(job.id));
      const cancelled = controller.signal.aborted;
      let message = String(error?.message || 'Cloud generation failed.').slice(0, 600);
      if (key) message = message.split(key).join('[redacted]');
      const canRetrieve = current?.remoteTaskId || current?.pendingOutputs;
      await patch(job.id, { status: cancelled ? 'cancelled' : canRetrieve || current?.submissionStartedAt || current?.submissionUnknown ? 'paused' : 'failed', stage: cancelled ? 'Cancelled' : canRetrieve ? 'Result retrieval paused' : 'Request stopped', error: cancelled ? '' : message, submissionUnknown: !canRetrieve && Boolean(current?.submissionStartedAt || current?.submissionUnknown), progress: 0 });
    }
  }
  function start(job) {
    if (active.has(job.id)) return;
    const controller = new AbortController();
    const work = async lock => { if (lock !== null) await execute(job, controller); };
    const promise = (locks ? locks.request(`heiyan-job:${job.id}`, { ifAvailable: true }, work) : work(true)).finally(() => active.delete(job.id));
    active.set(job.id, { controller, promise });
  }
  async function settleInterrupted(job) {
    if (job.localBridge) return job; // The independent local connector owns execution.
    if (!['queued', 'running', 'cancelling'].includes(job.status) || active.has(job.id) || Date.now() - Date.parse(job.updatedAt) < 15000) return job;
    if (locks && (await locks.query()).held.some(lock => lock.name === `heiyan-job:${job.id}`)) return job;
    return patch(job.id, { status: 'paused', stage: 'Resume saved task', error: job.remoteTaskId || job.pendingOutputs ? 'Continue retrieving the existing cloud task.' : 'The previous request was interrupted. Its submission outcome is unknown; it will not be resubmitted automatically.', submissionUnknown: !job.remoteTaskId && !job.pendingOutputs });
  }
  async function createJob(body, postprocess = false) {
    if (cleaning) return json({ error: 'Generated results are being cleared.' }, 409);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid generation request.' }, 400);
    const model = await models.runtimeModel(body.modelId);
    if (postprocess) {
      if (model.adapter !== 'tripo3d-model') return json({ error: 'Select a connected Tripo3D model for this operation.' }, 400);
      const operation = normalizeTripo3dPostprocessOperation(body.operation);
      const options = { ...(body.options || {}) };
      if (body.sourceAssetUrl) for (const key of ['taskId', 'task_id', 'fileToken', 'file_token', 'url', 'sourceUrl', 'source_url']) delete options[key];
      else if (body.sourceTaskId) options.taskId = String(body.sourceTaskId);
      tripo3dPostprocessRequest(operation, body.sourceAssetUrl ? { ...options, fileToken: 'file_pending_local_upload' } : options);
      body = { ...body, operation, options, inputs: (body.referenceImages || []).slice(0, 4).map(input => ({ ...input, type: 'image', port: input.port || 'front' })), sourceAsset: body.sourceAssetUrl ? { url: body.sourceAssetUrl, fileName: body.sourceFileName } : body.sourceAsset };
    }
    if (model.capability !== body.capability && !postprocess) return json({ error: 'Model capability does not match this node.' }, 400);
    const inputs = Array.isArray(body.inputs) ? body.inputs : [];
    if (inputs.length > 52) return json({ error: 'Too many input references.' }, 400);
    const prompt = String(body.prompt || '').slice(0, 12000);
    if (!prompt && !inputs.length && !postprocess) return json({ error: 'Enter a prompt or connect reference media.' }, 400);
    if (model.adapter === 'seedance-video') {
      validateSeedanceInputs(inputs, model);
      if (inputs.some(input => ['video', 'audio'].includes(input.type) && !/^https:\/\//.test(input.value || ''))) return json({ error: 'Seedance video/audio references require publicly accessible HTTPS URLs.' }, 400);
    }
    if (model.adapter === 'minimax-h3-video') validateMiniMaxH3Inputs(inputs);
    if (!postprocess) normalizeGenerationOptions(model, body.options || {});
    const job = { id: `job_${crypto.randomUUID()}`, taskId: String(body.taskId || 'local-canvas').slice(0, 128), canvasId: String(body.canvasId || 'main').slice(0, 128), nodeId: String(body.nodeId || '').slice(0, 160), nodeTitle: String(body.nodeTitle || '').slice(0, 160), modelId: model.id, modelAdapter: model.adapter, modelBinding: binding(model), capability: model.capability, prompt, inputs, options: body.options || {}, operation: body.operation || '', status: 'queued', progress: 0, stage: 'Queued', outputs: [], attempt: 1, createdAt: now(), updatedAt: now(), ...(postprocess ? { tripoPostprocessOperation: body.operation, postprocessOptions: body.options || {}, postprocessSourceAsset: body.sourceAsset } : {}) };
    const created = await records.transaction('readwrite', (store, done) => {
      let duplicate;
      store.openCursor().onsuccess = event => {
        const cursor = event.target.result;
        if (cursor) {
          const other = cursor.value;
          if (String(cursor.key).startsWith('cloud:job:') && other.taskId === job.taskId && other.canvasId === job.canvasId && other.nodeId === job.nodeId && ['queued', 'running', 'cancelling'].includes(other.status)) duplicate = other;
          cursor.continue();
        } else { if (!duplicate) store.put(job, jobKey(job.id)); done(duplicate || null); }
      };
    });
    if (created) return json({ error: 'This node already has a running task.', job: created }, 409);
    start(job); return json({ job }, 202);
  }
  async function handle(request) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (!path.startsWith('/api/v1/jobs') && path !== '/api/v1/tripo3d/postprocess') return null;
    try {
      if (path === '/api/v1/jobs' && method === 'GET') {
        const jobs = await Promise.all((await allJobs()).filter(job => (!url.searchParams.get('taskId') || job.taskId === url.searchParams.get('taskId')) && (!url.searchParams.get('canvasId') || (job.canvasId || 'main') === url.searchParams.get('canvasId'))).map(job => url.searchParams.get('historyOnly') === '1' ? job : settleInterrupted(job)));
        return json({ jobs });
      }
      if ((path === '/api/v1/jobs' || path === '/api/v1/tripo3d/postprocess') && method === 'POST') return await createJob(await request.json(), path.endsWith('/postprocess'));
      const match = /^\/api\/v1\/jobs\/([\w-]+)(?:\/(resume|retry|cancel))?$/.exec(path);
      if (!match) return json({ error: 'Unknown task operation.' }, 404);
      const job = await records.read(jobKey(match[1]));
      if (!job) return json({ error: 'Task not found in this browser.' }, 404);
      if (!match[2] && method === 'GET') return json({ job: await settleInterrupted(job) });
      if (method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      if (match[2] === 'cancel') {
        active.get(job.id)?.controller.abort();
        return json({ job: await patch(job.id, { status: 'cancelled', stage: 'Cancelled', error: '' }) });
      }
      if (match[2] === 'resume') {
        if (!job.remoteTaskId && !job.pendingOutputs && !job.tripoWorkflow?.currentTaskId) return json({ error: 'There is no confirmed remote task to resume. No new request was submitted.' }, 409);
        if (job.status === 'succeeded' || active.has(job.id)) return json({ job });
        start(job); return json({ job }, 202);
      }
      const body = await request.json().catch(() => ({}));
      if (body.confirmNewPaidSubmission !== true) return json({ error: 'Confirm a new paid generation before retrying.' }, 409);
      return createJob({ ...job, capability: job.capability, nodeId: job.nodeId, operation: job.tripoPostprocessOperation || job.operation, options: job.postprocessOptions || job.options, sourceAssetUrl: job.postprocessSourceAsset?.url, sourceFileName: job.postprocessSourceAsset?.fileName, referenceImages: job.inputs }, Boolean(job.tripoPostprocessOperation));
    } catch { return json({ error: 'The request could not be accepted. Check the model connection and input settings; no automatic retry was made.' }, 400); }
  }
  return { handle, allJobs, patch, active, waitForIdle: async () => { await Promise.all([...active.values()].map(value => value.promise)); }, setCleaning: value => { cleaning = value; } };
}
