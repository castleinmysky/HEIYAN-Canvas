import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);

export function createStorage({ dataDir, privateDir, configDir = path.join(dataDir, '..', 'config'), platform = process.platform, io = fs }) {
  const projectsFile = path.join(dataDir, 'projects.json');
  const modelsFile = path.join(dataDir, 'models.json');
  const studioModelsFile = path.join(dataDir, 'studio-models.json');
  const secretsFile = path.join(privateDir, 'model-secrets.json');
  const connectionJournal = path.join(privateDir, 'model-connection-transaction.json');
  const settingsFile = path.join(configDir, 'settings.json');
  const jobsFile = path.join(dataDir, 'jobs.json');
  const historyFile = path.join(dataDir, 'generation-history.json');
  const clipboardFile = path.join(dataDir, 'clipboard.json');
  const canvasesDir = path.join(dataDir, 'canvases');

  function safeSegment(value, fallback = 'main') {
    const normalized = String(value || fallback).trim();
    return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(normalized) ? normalized : fallback;
  }

  function canvasFile(taskId, canvasId = 'main') {
    return path.join(canvasesDir, safeSegment(taskId, 'local-canvas'), `${safeSegment(canvasId)}.json`);
  }

  async function readJson(file, fallback) {
    try { return JSON.parse(await io.readFile(file, 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
  }

  let writeQueue = Promise.resolve();
  async function writeJsonNow(file, value, raw = false) {
    await io.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await io.writeFile(temporary, raw ? value : `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      for (let attempt = 0; ; attempt += 1) {
        try { await io.rename(temporary, file); break; }
        catch (error) {
          // Windows file scanners can briefly hold the destination open.
          if (platform !== 'win32' || !TRANSIENT_RENAME_ERRORS.has(error?.code) || attempt >= 4) throw error;
          await delay(25 * (2 ** attempt));
        }
      }
    } catch (error) {
      // Never remove the destination; a failed replacement must retain its old contents.
      await io.unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  function writeJson(file, value) {
    const task = writeQueue.then(async () => { await recoverModelConnectionNow(); return writeJsonNow(file, value); });
    writeQueue = task.catch(() => undefined);
    return task;
  }

  function updateJson(file, fallback, mutate) {
    const task = writeQueue.then(async () => {
      await recoverModelConnectionNow();
      const current = await readJson(file, fallback);
      const next = await mutate(current);
      await writeJsonNow(file, next);
      return next;
    });
    writeQueue = task.catch(() => undefined);
    return task;
  }


  async function optionalBytes(file) {
    try { return await io.readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function restoreBytes(file, bytes) {
    if (bytes === null) await io.unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    else await writeJsonNow(file, bytes, true);
  }
  async function recoverModelConnectionNow() {
    const journal = await readJson(connectionJournal, null).catch(() => {
      throw Object.assign(new Error('Model connection recovery required'), { code: 'connection_recovery_required', status: 503 });
    });
    if (!journal) return;
    if (journal.version !== 1 || !['string', 'object'].includes(typeof journal.models) || !['string', 'object'].includes(typeof journal.secrets)
      || (typeof journal.models === 'object' && journal.models !== null) || (typeof journal.secrets === 'object' && journal.secrets !== null)) {
      throw Object.assign(new Error('Model connection recovery required'), { code: 'connection_recovery_required' });
    }
    await restoreBytes(studioModelsFile, journal.models);
    await restoreBytes(secretsFile, journal.secrets);
    await io.unlink(connectionJournal);
  }
  function connectionState() {
    const task = writeQueue.then(async () => {
      await recoverModelConnectionNow();
      try { return { models: await readJson(studioModelsFile, null), secrets: await readJson(secretsFile, {}) }; }
      catch { throw Object.assign(new Error('Model connection storage could not be read'), { code: 'connection_storage_invalid', status: 503 }); }
    });
    writeQueue = task.catch(() => undefined);
    return task;
  }
  function transactModelConnection(mutate, defaultModels = []) {
    const task = writeQueue.then(async () => {
      await recoverModelConnectionNow();
      const modelsBytes = await optionalBytes(studioModelsFile);
      const secretsBytes = await optionalBytes(secretsFile);
      const current = { models: modelsBytes === null ? defaultModels : JSON.parse(modelsBytes), secrets: secretsBytes === null ? {} : JSON.parse(secretsBytes) };
      // Validation and network probing occur before the durable journal or either data file changes.
      const result = await mutate(structuredClone(current));
      if (!result || !Array.isArray(result.models) || !result.secrets || typeof result.secrets !== 'object') throw new Error('Invalid model connection transaction');
      await writeJsonNow(connectionJournal, { version: 1, models: modelsBytes, secrets: secretsBytes });
      try {
        await writeJsonNow(studioModelsFile, result.models);
        await writeJsonNow(secretsFile, result.secrets);
        await io.unlink(connectionJournal); // Commit point; an interrupted transaction rolls back on next read.
      } catch {
        try { await recoverModelConnectionNow(); }
        catch { throw Object.assign(new Error('Model connection recovery required'), { code: 'connection_recovery_required', status: 503 }); }
        throw Object.assign(new Error('Model connection was not saved'), { code: 'connection_commit_failed', status: 503 });
      }
      return result;
    });
    writeQueue = task.catch(() => undefined);
    return task;
  }

  async function projects() { return readJson(projectsFile, []); }
  async function saveProjects(value) { return writeJson(projectsFile, value); }
  async function models() { return readJson(modelsFile, []); }
  async function saveModels(value) { return writeJson(modelsFile, value); }
  async function studioModels() { return (await connectionState()).models; }
  async function saveStudioModels(value) { return writeJson(studioModelsFile, value); }
  async function secrets() { return (await connectionState()).secrets; }
  async function saveSecrets(value) { return writeJson(secretsFile, value); }
  async function settings() { return readJson(settingsFile, { theme: 'dark', previewCacheLimitMb: 2048 }); }
  async function saveSettings(value) { return writeJson(settingsFile, value); }
  async function generationHistory() { return readJson(historyFile, []); }
  async function updateGenerationHistory(mutate) { return updateJson(historyFile, [], mutate); }
  async function jobs() { return readJson(jobsFile, []); }
  async function saveJobs(value) { return writeJson(jobsFile, value); }
  async function updateJobs(mutate) { return updateJson(jobsFile, [], mutate); }
  async function clipboard() { return readJson(clipboardFile, { clipboard: null, updatedAt: '' }); }
  async function saveClipboard(value) { return writeJson(clipboardFile, value); }
  async function canvas(taskId, canvasId = 'main') {
    return readJson(canvasFile(taskId, canvasId), {
      nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
      task: { taskId: safeSegment(taskId, 'local-canvas'), project: '本地项目', title: '本地画布', member: '本机' },
      revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  }
  async function saveCanvas(taskId, canvasId, value) { return writeJson(canvasFile(taskId, canvasId), value); }
  async function deleteCanvas(taskId, canvasId) {
    const id = String(canvasId || '').trim();
    if (id === 'main' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) return false;
    try { await io.unlink(canvasFile(taskId, id)); return true; }
    catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
  }
  async function updateCanvas(taskId, canvasId, mutate) {
    const file = canvasFile(taskId, canvasId);
    const fallback = await canvas(taskId, canvasId);
    return updateJson(file, fallback, mutate);
  }
  async function canvasBoards(taskId) {
    const taskDir = path.dirname(canvasFile(taskId, 'main'));
    let entries = [];
    try { entries = await io.readdir(taskDir, { withFileTypes: true }); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const ids = new Set(['main', ...entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name.slice(0, -5))]);
    const boards = [];
    for (const id of ids) {
      const value = await canvas(taskId, id);
      boards.push({
        id,
        title: String(value?.title || (id === 'main' ? '主画布' : id)).slice(0, 48),
        createdAt: value?.createdAt || '', updatedAt: value?.updatedAt || '',
        nodeCount: Array.isArray(value?.nodes) ? value.nodes.length : 0,
      });
    }
    return boards.sort((left, right) => left.id === 'main' ? -1 : right.id === 'main' ? 1 : String(left.createdAt).localeCompare(String(right.createdAt)));
  }

  async function updateProjects(mutate) { return updateJson(projectsFile, [], mutate); }
  async function updateModels(mutate) { return updateJson(modelsFile, [], mutate); }
  async function updateSecrets(mutate) { return updateJson(secretsFile, {}, mutate); }

  return { dataDir, privateDir, configDir, connectionState, transactModelConnection, projects, saveProjects, updateProjects, models, saveModels, updateModels, studioModels, saveStudioModels, secrets, saveSecrets, updateSecrets, settings, saveSettings, generationHistory, updateGenerationHistory, jobs, saveJobs, updateJobs, clipboard, saveClipboard, canvas, saveCanvas, deleteCanvas, updateCanvas, canvasBoards };
}

export function makeId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
