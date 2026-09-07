import net from 'node:net';
import crypto from 'node:crypto';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', 'host.docker.internal']);
const MODEL_FIELD = /(ckpt|checkpoint|model|unet|vae|lora|clip|control_net|controlnet)/i;

function cleanBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持无账号信息的 HTTP 或 HTTPS 地址');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('请填写服务地址，不要填写 API 路径');
  return `${url.protocol}//${url.host}`;
}

function blockedIp(host) {
  if (!net.isIP(host)) return false;
  if (host === '0.0.0.0' || host === '::') return true;
  return /^169\.254\./.test(host) || /^224\./.test(host) || /^255\./.test(host);
}

function privateIp(host) {
  if (!net.isIP(host)) return false;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^127\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./); return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

export function validateApiEndpoint(value, { allowPrivate = false } = {}) {
  const url = new URL(String(value || '').trim());
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('接口地址格式不正确');
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if(blockedIp(host))throw new Error('该地址不能作为模型接口');
  const loopback=LOOPBACK_HOSTS.has(host)||host==='127.0.0.1'||host==='::1';
  if(privateIp(host)&&!loopback&&!allowPrivate)throw new Error('局域网接口需要明确允许');
  if(!loopback&&!privateIp(host)&&url.protocol!=='https:')throw new Error('公网模型接口必须使用 HTTPS');
  return url.toString();
}

export function validateModelServiceUrl(value, { allowRemote = false, allowlist = [] } = {}) {
  const baseUrl = cleanBaseUrl(value);
  const host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (blockedIp(host)) throw new Error('该地址不能作为模型服务');
  if (!LOOPBACK_HOSTS.has(host)) {
    if (!allowRemote) throw new Error('其他设备地址需要在高级选项中明确允许');
    if (!allowlist.map((item) => item.toLowerCase()).includes(host)) throw new Error('该主机不在服务端允许名单中');
  }
  return baseUrl;
}

function dropdownValues(node) {
  const models = new Set();
  const inputs = { ...(node?.input?.required || {}), ...(node?.input?.optional || {}) };
  for (const [name, definition] of Object.entries(inputs)) {
    if (!MODEL_FIELD.test(name) || !Array.isArray(definition)) continue;
    const candidates = Array.isArray(definition[0]) ? definition[0] : [];
    for (const candidate of candidates) if (typeof candidate === 'string' && candidate.trim()) models.add(candidate.trim());
  }
  return models;
}

function categorizedValues(node, resources) {
  const inputs = { ...(node?.input?.required || {}), ...(node?.input?.optional || {}) };
  for (const [name, definition] of Object.entries(inputs)) {
    if (!MODEL_FIELD.test(name) || !Array.isArray(definition) || !Array.isArray(definition[0])) continue;
    const group = /lora/i.test(name) ? resources.loras : /vae/i.test(name) ? resources.vaes : /control/i.test(name) ? resources.controlnets : resources.models;
    for (const candidate of definition[0]) if (typeof candidate === 'string' && candidate.trim()) group.add(candidate.trim());
  }
}

export function summarizeObjectInfo(objectInfo) {
  const nodes = Object.keys(objectInfo && typeof objectInfo === 'object' ? objectInfo : {}).sort();
  const models = new Set();
  const resources = { models: new Set(), loras: new Set(), vaes: new Set(), controlnets: new Set() };
  for (const node of Object.values(objectInfo || {})) {
    for (const value of dropdownValues(node)) models.add(value);
    categorizedValues(node, resources);
  }
  return {
    nodes, models: [...models].sort(),
    resources: Object.fromEntries(Object.entries(resources).map(([key, values]) => [key, [...values].sort()]))
  };
}

export async function probeComfyUi(baseUrl, { fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  const response = await fetchImpl(`${baseUrl}/object_info`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`ComfyUI 返回 ${response.status}`);
  const objectInfo = await response.json();
  const summary = summarizeObjectInfo(objectInfo);
  if (!summary.nodes.length) throw new Error('没有读取到 ComfyUI 节点');
  return { ...summary, objectInfo };
}

export function parseWorkflow(value) {
  const workflow = typeof value === 'string' ? JSON.parse(value) : value;
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw new Error('工作流 JSON 格式不正确');
  const prompt = workflow.prompt && typeof workflow.prompt === 'object' ? workflow.prompt : workflow;
  if (!Object.values(prompt).some((node) => node && typeof node === 'object' && typeof node.class_type === 'string')) {
    throw new Error('请导入 API 格式的 ComfyUI 工作流 JSON');
  }
  return prompt;
}

export function preflightWorkflow(workflowValue, objectInfo) {
  const workflow = parseWorkflow(workflowValue);
  const summary = summarizeObjectInfo(objectInfo);
  const knownNodes = new Set(summary.nodes);
  const knownModels = new Set(summary.models);
  const missingNodes = new Set();
  const missingModels = new Set();
  for (const node of Object.values(workflow)) {
    if (!knownNodes.has(node.class_type)) missingNodes.add(node.class_type);
    for (const [key, value] of Object.entries(node.inputs || {})) {
      if (MODEL_FIELD.test(key) && typeof value === 'string' && value.trim() && knownModels.size && !knownModels.has(value.trim())) missingModels.add(value.trim());
    }
  }
  return { ok: missingNodes.size === 0 && missingModels.size === 0, missingNodes: [...missingNodes], missingModels: [...missingModels] };
}

export function applyWorkflowValues(workflowValue, ports = {}, values = {}) {
  const workflow = structuredClone(parseWorkflow(workflowValue));
  for (const [semanticName, binding] of Object.entries(ports || {})) {
    if (semanticName === 'output' || values[semanticName] === undefined || !binding?.nodeId || !binding?.input) continue;
    const node = workflow[String(binding.nodeId)];
    if (!node?.inputs) throw new Error(`工作流缺少输入节点 ${binding.nodeId}`);
    node.inputs[binding.input] = values[semanticName];
  }
  return workflow;
}

export async function submitComfyPrompt(baseUrl, prompt, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ prompt, client_id: `echo-${crypto.randomUUID()}` }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`ComfyUI 提交失败（${response.status}）`);
  const payload = await response.json();
  const promptId = payload.prompt_id;
  if (!promptId) throw new Error(payload.error || 'ComfyUI 没有返回任务编号');
  return String(promptId);
}

function outputFiles(history) {
  const files = [];
  for (const node of Object.values(history?.outputs || {})) {
    for (const type of ['images', 'audio', 'gifs']) {
      for (const item of Array.isArray(node?.[type]) ? node[type] : []) {
        if (item?.filename) files.push({ filename: item.filename, subfolder: item.subfolder || '', type: item.type || 'output', mediaType: type === 'audio' ? 'audio' : type === 'gifs' ? 'video' : 'image' });
      }
    }
  }
  return files;
}

export async function waitForComfyResult(baseUrl, promptId, { fetchImpl = fetch, timeoutMs = 300000, pollMs = 650 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const remaining=Math.max(250,timeoutMs-(Date.now()-started));
    const response = await fetchImpl(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { headers: { accept: 'application/json' },signal:AbortSignal.timeout(Math.min(5000,remaining)) });
    if (response.ok) {
      const payload = await response.json();
      const history = payload[promptId];
      if (history) {
        const status = history.status?.status_str;
        if (status === 'error') throw new Error('ComfyUI 生成失败，请在 ComfyUI 中查看节点提示');
        const outputs = outputFiles(history);
        if (outputs.length) return outputs;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error('ComfyUI 生成等待超时，任务可能仍在后台运行');
}
