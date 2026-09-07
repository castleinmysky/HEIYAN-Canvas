import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const identity = value => String(value || '').replaceAll('\\', '/').toLowerCase();
// Inspect only the bounded safetensors header; never deserialize weights or run model code.
export async function completePackageModels(models, { comfyRoot, comfyPort, fetchImpl = fetch }) {
  const response = await fetchImpl('http://127.0.0.1:' + comfyPort + '/object_info', { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Cannot verify the package model inventory.');
  const info = await response.json();
  const checkpoints = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
  const present = new Set(checkpoints.map(identity));
  const records = models.map(model => model.id.startsWith('package-sdxl-') ? { ...model, config: { ...model.config, discoveryReady: present.has(identity(model.config.model)) } } : model);
  const known = new Set(records.map(model => identity(model.config?.model)));
  const base = await fs.realpath(path.join(comfyRoot, 'models/checkpoints'));
  for (const checkpoint of checkpoints) {
    if (typeof checkpoint !== 'string' || !checkpoint.endsWith('.safetensors') || known.has(identity(checkpoint))) continue;
    let file;
    try {
      const target = await fs.realpath(path.resolve(base, checkpoint));
      const relative = path.relative(base, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      file = await fs.open(target, 'r');
      const size = Buffer.alloc(8);
      if ((await file.read(size, 0, 8, 0)).bytesRead !== 8) continue;
      const length = Number(size.readBigUInt64LE());
      if (!Number.isSafeInteger(length) || length < 2 || length > 16 * 1024 * 1024) continue;
      const buffer = Buffer.alloc(length);
      if ((await file.read(buffer, 0, length, 8)).bytesRead !== length) continue;
      const header = JSON.parse(buffer.toString('utf8'));
      if (String(header['model.diffusion_model.label_emb.0.0.weight']?.shape) !== '1280,2816'
        || String(header['conditioner.embedders.1.model.token_embedding.weight']?.shape) !== '49408,1280') continue;
      records.push({ id: 'package-sdxl-' + createHash('sha256').update(identity(checkpoint)).digest('hex').slice(0, 12),
        name: path.basename(checkpoint, '.safetensors'), capability: 'image', adapter: 'comfyui-sdxl', enabled: false,
        config: { baseUrl: 'http://127.0.0.1:' + comfyPort, model: checkpoint, discoveryReady: true, defaultRatio: '3:4', defaultResolution: '1K', steps: 28, cfg: 6, sampler: 'dpmpp_2m_sde', scheduler: 'karras', referenceDenoise: 0.72 },
      });
      known.add(identity(checkpoint));
    } catch { /* Unknown or unreadable checkpoints must not be advertised as compatible. */ }
    finally { await file?.close(); }
  }
  return records;
}
