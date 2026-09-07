import fs from 'node:fs/promises';
import path from 'node:path';

const ACTIVE_STATES = new Set(['queued', 'running', 'cancelling', 'paused']);
const OUTPUT_URL = /^\/media\/outputs\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,180})$/;
const keyFor = (taskId, url) => JSON.stringify([String(taskId || ''), String(url || '').trim()]);
const urlFor = (output) => String(output?.mediaUrl || '').trim();

function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}
function filenameFor(value) {
  const url = String(value || '').trim();
  const match = url.match(OUTPUT_URL);
  if (url.startsWith('/media/outputs/') && !match) fail(400, 'generated_path_invalid', '生成文件路径无效');
  return match?.[1] || '';
}

// Check each existing ancestor, not only the leaf: Windows junctions are links too.
async function regularPath(target, kind, { allowMissing = false, io = fs } = {}) {
  const full = path.resolve(target);
  const root = path.parse(full).root;
  let cursor = root;
  for (const segment of full.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let info;
    try { info = await io.lstat(cursor); }
    catch (error) {
      if (allowMissing && error.code === 'ENOENT') return null;
      throw error;
    }
    if (info.isSymbolicLink()) fail(409, 'generated_path_unsafe', '生成文件路径包含链接，未执行清理');
    if (cursor !== full && !info.isDirectory()) fail(409, 'generated_path_unsafe', '生成文件父目录无效');
    if (cursor === full) {
      if (kind === 'directory' ? !info.isDirectory() : !info.isFile()) fail(409, 'generated_path_unsafe', '清理仅支持普通生成文件');
      const resolved = await io.realpath(cursor);
      if (path.resolve(resolved).toLowerCase() !== full.toLowerCase()) fail(409, 'generated_path_unsafe', '生成文件路径发生重定向');
      return info;
    }
  }
  fail(409, 'generated_path_unsafe', '生成文件目录无效');
}

export function createGeneratedHistory({ storage, activeJobs = new Map(), io = fs, clock = () => new Date().toISOString() }) {
  let cleaning = false;
  let submissions = 0;

  function generationGuard(req, res, next) {
    if (req.method !== 'POST') return next();
    if (cleaning) return res.status(409).json({ error: '正在清理生成结果，请稍后再生成', code: 'generated_cleanup_busy' });
    submissions += 1;
    let released = false;
    const release = () => { if (!released) { released = true; submissions -= 1; } };
    res.once('finish', release);
    // A disconnected client does not stop an awaited generation handler.
    // Hold the reservation until the handler ends its response, even on a closed socket.
    const end = res.end;
    if (typeof end === 'function') res.end = function (...args) {
      try { return end.apply(this, args); } finally { release(); }
    };
    next();
  }

  async function jobsWithHistory(jobs) {
    const records = await storage.generationHistory();
    const hidden = new Map(records.map((record) => [keyFor(record.taskId, record.mediaUrl), record.removedAt]));
    return jobs.map((job) => ({
      ...job,
      outputs: (Array.isArray(job.outputs) ? job.outputs : []).map((output) => {
        const removedAt = hidden.get(keyFor(job.taskId, urlFor(output)));
        return removedAt ? { ...output, historyHiddenAt: removedAt } : output;
      }),
    }));
  }

  async function hideUrls(records) {
    const removedAt = clock();
    await storage.updateGenerationHistory((current) => {
      const byKey = new Map(current.map((record) => [keyFor(record.taskId, record.mediaUrl), record]));
      for (const record of records) {
        const key = keyFor(record.taskId, record.mediaUrl);
        if (!byKey.has(key)) byKey.set(key, { taskId: record.taskId, mediaUrl: record.mediaUrl, removedAt });
      }
      return [...byKey.values()];
    });
  }

  async function removeHistory({ taskId, entries, clearAll } = {}) {
    if (cleaning) fail(409, 'generated_cleanup_busy', '正在清理生成结果，请稍后重试');
    if (typeof taskId !== 'string' || !taskId.trim() || taskId.length > 128) fail(400, 'history_selection_invalid', '请选择有效任务');
    const jobs = (await storage.jobs()).filter((job) => job.taskId === taskId && job.status === 'succeeded');
    const urls = new Set();
    if (clearAll === true) {
      for (const job of jobs) for (const output of job.outputs || []) if (urlFor(output)) urls.add(urlFor(output));
    } else {
      if (!Array.isArray(entries) || !entries.length || entries.length > 1000) fail(400, 'history_selection_invalid', '请选择要移除的历史记录');
      for (const selection of entries) {
        const job = jobs.find((item) => item.id === selection?.jobId);
        const index = selection?.outputIndex;
        if (!job || !Number.isSafeInteger(index) || index < 0 || typeof selection.mediaUrl !== 'string' || !selection.mediaUrl || urlFor(job.outputs?.[index]) !== selection.mediaUrl) fail(409, 'history_selection_stale', '历史记录已变化，请刷新后重试');
        urls.add(selection.mediaUrl);
      }
    }
    await hideUrls([...urls].map((mediaUrl) => ({ taskId, mediaUrl })));
    return { ok: true, removed: urls.size };
  }

  async function clearGeneratedResults({ confirmation } = {}) {
    if (confirmation !== 'delete-generated-results') fail(400, 'generated_cleanup_confirmation', '请明确确认永久删除生成文件和历史');
    if (cleaning || submissions || activeJobs.size) fail(409, 'generated_cleanup_busy', '有任务正在提交或运行，请稍后清理');
    cleaning = true;
    try {
      const jobs = await storage.jobs();
      if (jobs.some((job) => ACTIVE_STATES.has(job.status))) fail(409, 'generated_jobs_active', '请先完成或取消运行中、排队中和可恢复的任务');
      const root = path.resolve(storage.dataDir, 'outputs');
      await regularPath(storage.dataDir, 'directory', { io });
      await regularPath(path.join(storage.dataDir, 'jobs.json'), 'file', { allowMissing: true, io });
      const rootInfo = await regularPath(root, 'directory', { allowMissing: true, io });
      const referenced = new Set();
      for (const job of jobs) for (const output of job.outputs || []) {
        for (const value of [output.mediaUrl, output.previewUrl, output.metadata?.previewUrl]) {
          const name = filenameFor(value);
          if (name) referenced.add(name);
        }
      }
      const planned = new Map();
      const missing = new Set();
      let retainedFiles = 0;
      if (rootInfo) {
        for (const entry of await io.readdir(root, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) fail(409, 'generated_path_unsafe', '生成目录中存在链接，未执行清理');
          // A UUID-like filename is not ownership evidence. Retain unreferenced files.
          if (!referenced.has(entry.name)) { retainedFiles += 1; continue; }
          const target = path.join(root, entry.name);
          const info = await regularPath(target, 'file', { io });
          planned.set(entry.name, { target, info });
        }
      }
      for (const name of referenced) {
        if (!planned.has(name)) {
          const info = await regularPath(path.join(root, name), 'file', { allowMissing: true, io });
          if (info) planned.set(name, { target: path.join(root, name), info });
          else missing.add(name);
        }
      }

      const removed = { files: 0, bytes: 0 };
      const failed = [];
      const deleted = new Set();
      for (const [name, { target, info }] of planned) {
        try {
          const current = await regularPath(target, 'file', { allowMissing: true, io });
          if (!current) { missing.add(name); continue; }
          if (current.dev !== info.dev || current.ino !== info.ino || current.size !== info.size || current.mtimeMs !== info.mtimeMs) fail(409, 'generated_file_changed', '文件在清理期间发生变化');
          await io.unlink(target);
          deleted.add(name);
          removed.files += 1; removed.bytes += info.size;
        } catch (error) {
          failed.push({ file: name, code: String(error.code || 'delete_failed') });
        }
      }

      const absent = new Set([...deleted, ...missing]);
      const hidden = [];
      const removedAt = clock();
      let metadataSaved = true;
      try {
        await storage.updateJobs((current) => current.map((job) => ({
          ...job,
          outputs: (job.outputs || []).map((output) => {
            const name = filenameFor(output.mediaUrl);
            const gone = name && absent.has(name);
            const historyOnly = !name && urlFor(output);
            if (gone || historyOnly) hidden.push({ taskId: String(job.taskId || ''), mediaUrl: urlFor(output) });
            const previewGone = absent.has(filenameFor(output.metadata?.previewUrl || output.previewUrl));
            return {
              ...output,
              ...(gone ? { mediaDeletedAt: removedAt } : {}),
              ...(previewGone ? { metadata: { ...output.metadata, previewDeletedAt: removedAt } } : {}),
            };
          }),
        })));
        await hideUrls(hidden);
      } catch (error) {
        metadataSaved = false;
        failed.push({ file: 'generation-metadata', code: String(error.code || 'metadata_write_failed') });
      }
      return { ok: failed.length === 0, partial: failed.length > 0, removed, failed, retainedFiles, historyRemoved: metadataSaved ? hidden.length : 0, metadataSaved };
    } finally { cleaning = false; }
  }

  return { jobsWithHistory, removeHistory, clearGeneratedResults, generationGuard };
}
