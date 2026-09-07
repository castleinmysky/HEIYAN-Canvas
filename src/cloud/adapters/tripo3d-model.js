
import { normalizeTripo3dGenerationOptions, TRIPO3D_H_MODEL } from '../generation-options.js';
import { createTripo3dClient, Tripo3dSubmissionUnknownError } from './tripo3d-client.js';

const VIEW_ORDER = Object.freeze(['front', 'left', 'back', 'right']);
const WORKFLOW_ALIASES = Object.freeze({
  text: 'text-to-model',
  'text-to-model': 'text-to-model',
  text_to_model: 'text-to-model',
  image: 'image-to-model',
  'image-to-model': 'image-to-model',
  image_to_model: 'image-to-model',
  'image-to-multiview': 'image-to-multiview',
  image_to_multiview: 'image-to-multiview',
  multiview: 'multiview-to-model',
  'multiview-to-model': 'multiview-to-model',
  multiview_to_model: 'multiview-to-model',
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function tripo3dRequestHash(request) {
  const bytes = new TextEncoder().encode(canonicalJson({ endpoint: request.endpoint, body: request.body }));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

function normalizeWorkflow(options, prompt, inputs, references) {
  const requested = String(options.workflow || options.operation || '').trim().toLowerCase();
  if (requested) {
    const workflow = WORKFLOW_ALIASES[requested];
    if (!workflow) throw new Error(`Unsupported Tripo3D workflow: ${requested}`);
    return workflow;
  }
  const hasNamedViews = Object.keys(options.namedViews || {}).length > 0
    || inputs.some((input) => VIEW_ORDER.includes(String(input.port || '').toLowerCase()))
    || references.some((reference) => VIEW_ORDER.includes(String(reference.port || '').toLowerCase()));
  if (hasNamedViews || options.multiviewTaskId || options.multiviewInputs) return 'multiview-to-model';
  if (references.length > 0 || inputs.some((input) => input.type === 'image')) return 'image-to-model';
  if (String(prompt || '').trim()) return 'text-to-model';
  throw new Error('Tripo3D requires a prompt, image, multiview task, or named views');
}

function modelOptionBody(normalized, workflow) {
  const body = {
    model: normalized.modelVersion,
    texture: normalized.texture,
    pbr: normalized.pbr,
    texture_quality: normalized.textureQuality,
    auto_size: normalized.autoSize,
    export_uv: normalized.exportUv,
    ...(normalized.modelSeed === undefined ? {} : { model_seed: normalized.modelSeed }),
    ...(normalized.textureSeed === undefined ? {} : { texture_seed: normalized.textureSeed }),
    ...(normalized.faceLimit === undefined ? {} : { face_limit: normalized.faceLimit }),
    ...(normalized.compress === undefined ? {} : { compress: normalized.compress }),
  };
  if (normalized.modelFamily === 'h') {
    body.geometry_quality = normalized.geometryQuality;
    body.quad = normalized.quad;
    body.smart_low_poly = normalized.smartLowPoly;
    body.generate_parts = normalized.generateParts;
  }
  if (workflow === 'text-to-model') {
    if (normalized.negativePrompt) body.negative_prompt = normalized.negativePrompt;
    if (normalized.imageSeed !== undefined) body.image_seed = normalized.imageSeed;
  } else {
    body.texture_alignment = normalized.textureAlignment;
    body.orientation = normalized.orientation;
    if (workflow === 'image-to-model') body.enable_image_autofix = normalized.enableImageAutofix;
  }
  return body;
}

function imageInputs(inputs) {
  return inputs.filter((input) => input?.type === 'image' && String(input.value || '').trim());
}

async function resolveSingleImage(client, inputs, references, signal) {
  if (references.length > 1 || imageInputs(inputs).length > 1) throw new Error('Tripo3D single-image workflow accepts exactly one image');
  if (references[0]) return client.uploadFile(references[0], { signal });
  const input = String(imageInputs(inputs)[0]?.value || '').trim();
  if (!input) throw new Error('Tripo3D image workflow requires one source image');
  return input;
}

function normalizedNamedViews(options, inputs, references) {
  const named = new Map();
  const add = (view, source, origin) => {
    const key = String(view || '').trim().toLowerCase();
    if (!VIEW_ORDER.includes(key)) throw new Error(`Invalid Tripo3D view name from ${origin}: ${key}`);
    if (named.has(key)) throw new Error(`Duplicate Tripo3D ${key} view`);
    named.set(key, source);
  };
  for (const [view, value] of Object.entries(options.namedViews || {})) {
    if (value !== undefined && value !== null && value !== '') add(view, { value }, 'namedViews');
  }
  for (const input of imageInputs(inputs)) {
    const view = String(input.port || '').trim().toLowerCase();
    if (VIEW_ORDER.includes(view) && !references.some((reference) => String(reference.port || '').trim().toLowerCase() === view)) {
      add(view, { value: input.value }, 'inputs');
    }
  }
  for (const reference of references) {
    const view = String(reference.port || '').trim().toLowerCase();
    if (VIEW_ORDER.includes(view)) add(view, { reference }, 'referenceImages');
  }
  return named;
}

async function multiviewInputs(client, options, inputs, references, signal) {
  const taskId = String(options.multiviewTaskId || options.sourceTaskId || '').trim();
  const positional = options.multiviewInputs;
  const named = normalizedNamedViews(options, inputs, references);
  const formats = Number(Boolean(taskId)) + Number(positional !== undefined) + Number(named.size > 0);
  if (formats !== 1) {
    throw new Error('Tripo3D multiview input must use exactly one format: task_id, named views, or positional views');
  }
  if (taskId) return [{ task_id: taskId }];
  if (positional !== undefined) {
    if (!Array.isArray(positional) || positional.length !== 4 || positional.some((value) => typeof value !== 'string')) {
      throw new Error('Tripo3D positional multiview input must contain four strings in front-left-back-right order');
    }
    if (!String(positional[0]).trim() || positional.filter((value) => String(value).trim()).length < 2) {
      throw new Error('Tripo3D multiview requires front plus at least one other view');
    }
    return positional.map((value) => String(value).trim());
  }
  if (!named.has('front') || named.size < 2) throw new Error('Tripo3D multiview requires front plus at least one other view');
  const result = [];
  for (const view of VIEW_ORDER) {
    const source = named.get(view);
    if (!source) continue;
    const value = source.reference
      ? await client.uploadFile(source.reference, { signal })
      : source.value;
    result.push({ [view]: value });
  }
  return result;
}

export async function tripo3dRequest({
  client,
  baseUrl,
  headers = {},
  model = TRIPO3D_H_MODEL,
  prompt,
  inputs = [],
  referenceImages = [],
  options = {},
  signal,
}) {
  let requestClient = client;
  const workflow = normalizeWorkflow(options, prompt, inputs, referenceImages);
  if (workflow !== 'text-to-model' && !requestClient) {
    const bearer = String(headers.Authorization || headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    requestClient = createTripo3dClient({ baseUrl, apiKey: bearer });
  }
  if (workflow === 'image-to-multiview') {
    const input = await resolveSingleImage(requestClient, inputs, referenceImages, signal);
    return { workflow, endpoint: '/generation/image-to-multiview', body: { input } };
  }
  const normalized = normalizeTripo3dGenerationOptions({ model }, { ...options, workflow });
  const common = modelOptionBody(normalized, workflow);
  if (workflow === 'text-to-model') {
    const text = String(prompt || '').trim();
    if (!text) throw new Error('Tripo3D text-to-model requires a prompt');
    if (text.length > 1024) throw new Error('Tripo3D prompt cannot exceed 1024 characters');
    return { workflow, endpoint: '/generation/text-to-model', body: { prompt: text, ...common }, options: normalized };
  }
  if (workflow === 'image-to-model') {
    const input = await resolveSingleImage(requestClient, inputs, referenceImages, signal);
    return { workflow, endpoint: '/generation/image-to-model', body: { input, ...common }, options: normalized };
  }
  const resolvedInputs = await multiviewInputs(requestClient, options, inputs, referenceImages, signal);
  return { workflow, endpoint: '/generation/multiview-to-model', body: { inputs: resolvedInputs, ...common }, options: normalized };
}

function successOutputs(task, taskId, request) {
  const rawOutput = task.output && typeof task.output === 'object' ? task.output : {};
  const creditsConsumed = Number(task.credits_consumed) || 0;
  if (request.workflow === 'image-to-multiview') {
    return VIEW_ORDER
      .map((view) => ({ view, mediaUrl: String(rawOutput[`${view}_view_url`] || '').trim() }))
      .filter((entry) => entry.mediaUrl)
      .map((entry) => ({
        mediaType: 'image',
        mediaUrl: entry.mediaUrl,
        extension: '.png',
        fileName: `${taskId}-${entry.view}.png`,
        metadata: {
          provider: 'tripo3d',
          tripoTaskId: taskId,
          workflow: request.workflow,
          view: entry.view,
          creditsConsumed,
          rawOutput,
        },
      }));
  }
  const format = request.options?.quad ? 'fbx' : 'glb';
  const modelUrl = String(rawOutput.model_url || '').trim();
  if (!modelUrl) throw new Error('Tripo3D task succeeded without model_url');
  return [{
    mediaType: 'model',
    mediaUrl: modelUrl,
    previewUrl: String(rawOutput.rendered_image_url || '').trim() || null,
    extension: `.${format}`,
    fileName: `${taskId}.${format}`,
    metadata: {
      provider: 'tripo3d',
      tripoTaskId: taskId,
      taskType: task.type,
      workflow: request.workflow,
      format,
      creditsConsumed,
      remoteModelUrl: modelUrl,
      remotePreviewUrl: String(rawOutput.rendered_image_url || '').trim() || null,
      rawOutput,
    },
  }];
}

function workflowFromJob(job) {
  const operation = String(job.operation || '').trim().toLowerCase();
  if (operation === 'image-to-multiview') return 'image-to-multiview';
  if (WORKFLOW_ALIASES[operation]) return WORKFLOW_ALIASES[operation];
  const configured = String(job.options?.workflow || '').trim().toLowerCase();
  return WORKFLOW_ALIASES[configured] || '';
}

function persistedStage(job, stageName) {
  const stage = job.tripoWorkflow?.stages?.[stageName];
  return stage && typeof stage === 'object' ? stage : {};
}

function persistedStageTaskId(job, stageName, { allowLegacy = false } = {}) {
  const stage = persistedStage(job, stageName);
  const direct = String(stage.taskId || '').trim();
  if (direct) return direct;
  const currentStage = String(job.tripoWorkflow?.currentStage || '').trim();
  if (currentStage === stageName) {
    const current = String(job.tripoWorkflow?.currentTaskId || '').trim();
    if (current) return current;
  }
  return allowLegacy ? String(job.remoteTaskId || job.resumeRemoteTaskId || job.tripoTaskId || '').trim() : '';
}

function stageSubmissionIsUnknown(job, stageName) {
  const stage = persistedStage(job, stageName);
  return !String(stage.taskId || '').trim()
    && (stage.status === 'submitting'
      || stage.status === 'submission_unknown'
      || (job.tripoWorkflow?.phase === 'submission_unknown' && job.tripoWorkflow?.currentStage === stageName));
}

export function createTripo3dModelAdapter(model) {
  const config = model.config || {};
  const apiKeyEnvironment = String(config.apiKeyEnv || 'TRIPO_API_KEY').trim();
  const apiKey = String(config.apiKey || '' || '').trim();
  if (!apiKey) throw new Error(`Model ${model.id} has no Tripo3D API Key configured`);
  const client = createTripo3dClient({
    baseUrl: config.baseUrl || 'https://openapi.tripo3d.com/v3',
    apiKey,
    fetchImpl: config.fetchImpl,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaximumDelayMs: config.retryMaximumDelayMs,
    maximumRetries: config.maximumRetries,
  });

  return {
    kind: 'model',
    configured: true,
    client,
    async run(job) {
      const attempt = Number(job.attempt) || 1;
      const chain = String(job.operation || '').trim().toLowerCase() === 'image-to-multiview-to-model';

      const runStage = async ({ stageName, request, allowLegacyTaskId = false, progressFloor = 10, progressCeiling = 95 }) => {
        const requestHash = await tripo3dRequestHash(request);
        if (stageSubmissionIsUnknown(job, stageName)) {
          throw new Tripo3dSubmissionUnknownError(`Tripo3D ${stageName} submission outcome is unknown; do not retry automatically`);
        }
        let taskId = persistedStageTaskId(job, stageName, { allowLegacy: allowLegacyTaskId });
        if (!taskId) {
          await job.onWorkflowState?.({
            phase: 'submitting', currentStage: stageName, currentTaskId: '', workflow: request.workflow,
            requestHash, attempt,
            stages: { [stageName]: { status: 'submitting', requestHash, workflow: request.workflow, attempt } },
          });
          let created;
          try {
            created = await client.createTask(request.endpoint, request.body, { signal: job.signal });
          } catch (error) {
            if (error instanceof Tripo3dSubmissionUnknownError || error?.submissionUnknown) {
              await job.onSubmissionUnknown?.({
                state: 'submission_unknown', phase: 'submission_unknown', currentStage: stageName,
                currentTaskId: '', workflow: request.workflow, requestHash, attempt,
                stages: { [stageName]: { status: 'submission_unknown', requestHash, workflow: request.workflow, attempt } },
              });
            }
            throw error;
          }
          taskId = created.task_id;
          await job.onRemoteTask?.(taskId, {
            stage: stageName, workflow: request.workflow, requestHash, phase: 'polling', attempt,
          });
          await job.onWorkflowState?.({
            phase: 'polling', currentStage: stageName, currentTaskId: taskId,
            workflow: request.workflow, requestHash, attempt,
            stages: { [stageName]: { taskId, status: 'polling', requestHash, workflow: request.workflow, attempt } },
          });
        } else {
          await job.onWorkflowState?.({
            phase: 'polling', currentStage: stageName, currentTaskId: taskId,
            workflow: request.workflow, requestHash, attempt, resumed: true,
            stages: { [stageName]: { ...persistedStage(job, stageName), taskId, status: 'polling', requestHash, workflow: request.workflow, attempt } },
          });
        }

        const task = await client.pollTask(taskId, {
          signal: job.signal,
          timeoutMs: Math.max(1, Number(config.pollTimeoutMs) || 900000),
          pollIntervalMs: Math.max(1, Number(config.pollIntervalMs) || 2000),
          onProgress: async (progress, remoteTask) => {
            const scaled = progressFloor + ((progressCeiling - progressFloor) * Math.max(0, Math.min(100, progress)) / 100);
            await job.onProgress?.(Math.max(progressFloor, Math.min(progressCeiling, scaled)), remoteTask);
          },
        });
        const stageCredits = Number(task.credits_consumed) || 0;
        await job.onWorkflowState?.({
          phase: 'remote_complete', currentStage: stageName, currentTaskId: taskId,
          workflow: request.workflow, requestHash, attempt,
          stages: {
            [stageName]: {
              ...persistedStage(job, stageName), taskId, status: 'success', requestHash,
              workflow: request.workflow, attempt, creditsConsumed: stageCredits, rawOutput: task.output || {},
            },
          },
        });
        return { task, taskId, request, requestHash };
      };

      let completed;
      let totalCredits = 0;
      if (chain) {
        const existingMultiview = persistedStage(job, 'multiview');
        let multiviewTaskId = String(existingMultiview.taskId || '').trim();
        if (multiviewTaskId && existingMultiview.status === 'success') {
          totalCredits += Number(existingMultiview.creditsConsumed) || 0;
        } else {
          const multiviewRequest = await tripo3dRequest({
            client,
            model: config.model || TRIPO3D_H_MODEL,
            prompt: job.prompt,
            inputs: job.inputs || [],
            referenceImages: job.referenceImages || [],
            options: { ...(job.options || {}), workflow: 'image-to-multiview' },
            signal: job.signal,
          });
          const stageOne = await runStage({ stageName: 'multiview', request: multiviewRequest, allowLegacyTaskId: true, progressFloor: 10, progressCeiling: 45 });
          multiviewTaskId = stageOne.taskId;
          const stageCredits = Number(stageOne.task.credits_consumed) || 0;
          totalCredits += stageCredits;
          // This checkpoint is intentionally awaited before the paid model POST.
          // A crash after it is safe to resume at stage two without repeating stage one.
          await job.onWorkflowState?.({
            phase: 'stage_complete', currentStage: 'multiview', currentTaskId: multiviewTaskId,
            workflow: 'image-to-multiview', requestHash: stageOne.requestHash, creditsConsumed: totalCredits,
            stages: {
              multiview: {
                taskId: multiviewTaskId, status: 'success', requestHash: stageOne.requestHash,
                workflow: 'image-to-multiview', creditsConsumed: stageCredits, rawOutput: stageOne.task.output || {},
              },
            },
          });
        }

        const modelRequest = await tripo3dRequest({
          client,
          model: config.model || TRIPO3D_H_MODEL,
          prompt: job.prompt,
          inputs: [],
          referenceImages: [],
          options: {
            ...(job.options || {}), workflow: 'multiview-to-model', multiviewTaskId,
            namedViews: undefined, multiviewInputs: undefined, sourceTaskId: undefined,
          },
          signal: job.signal,
        });
        completed = await runStage({ stageName: 'model', request: modelRequest, progressFloor: 50, progressCeiling: 95 });
        totalCredits += Number(completed.task.credits_consumed) || 0;
      } else {
        const workflow = workflowFromJob(job);
        let stageName = workflow === 'image-to-multiview' ? 'multiview' : 'model';
        const knownTaskId = persistedStageTaskId(job, stageName, { allowLegacy: true });
        let request = job.requestContract;
        if (!request?.workflow) {
          request = knownTaskId
            ? {
              workflow: workflow || 'text-to-model', endpoint: '', body: {},
              ...((workflow || 'text-to-model') === 'image-to-multiview' ? {} : {
                options: normalizeTripo3dGenerationOptions(
                  { model: config.model || TRIPO3D_H_MODEL },
                  { ...(job.options || {}), workflow: workflow || 'text-to-model' },
                ),
              }),
            }
            : await tripo3dRequest({
              client,
              model: config.model || TRIPO3D_H_MODEL,
              prompt: job.prompt,
              inputs: job.inputs || [],
              referenceImages: job.referenceImages || [],
              options: { ...(job.options || {}), ...(workflow ? { workflow } : {}) },
              signal: job.signal,
            });
        }
        stageName = request.workflow === 'image-to-multiview' ? 'multiview' : 'model';
        completed = await runStage({ stageName, request, allowLegacyTaskId: true });
        totalCredits = Number(completed.task.credits_consumed) || 0;
      }

      const outputs = successOutputs(completed.task, completed.taskId, completed.request);
      return {
        outputs,
        usage: { creditsConsumed: totalCredits },
        remoteTaskId: completed.taskId,
        requestHash: completed.requestHash,
        workflow: completed.request.workflow,
        rawTask: completed.task,
      };
    },
  };
}

export { createTripo3dClient, Tripo3dSubmissionUnknownError } from './tripo3d-client.js';
