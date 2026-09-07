import { localRecords } from '../trial-storage.js';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const active = new Set(['queued', 'running', 'cancelling', 'paused']);
const keyFor = (task, url) => JSON.stringify([task, url]);

export function createCloudHistoryStore({ records = localRecords }) {
  async function handle(request) {
    const path = new URL(request.url).pathname;
    if (!['/api/v1/generation-history', '/api/v1/admin/data/generated-results', '/api/v1/admin/data/summary'].includes(path)) return null;
    if (path.endsWith('/summary') && request.method === 'GET') {
      const values = await records.entries();
      const categories = [
        { id: 'assets', label: 'Imported media', files: 0, bytes: 0 },
        { id: 'outputs', label: 'Generated results', files: 0, bytes: 0 },
        { id: 'canvases', label: 'Canvases', files: 0, bytes: 0 },
      ];
      for (const [key, value] of values) {
        const category = key.startsWith('asset:') ? categories[value.source === 'generated' ? 1 : 0] : key.startsWith('canvas:') ? categories[2] : null;
        if (category) { category.files += 1; category.bytes += value.blob?.size ?? new Blob([JSON.stringify(value)]).size; }
      }
      return json({ updatedAt: new Date().toISOString(), total: categories.reduce((sum, row) => ({ files: sum.files + row.files, bytes: sum.bytes + row.bytes }), { files: 0, bytes: 0 }), categories });
    }
    if (request.method !== 'DELETE') return json({ error: 'Method not allowed.' }, 405);
    const body = await request.json().catch(() => ({}));
    const clearFiles = path.endsWith('/generated-results');
    if (clearFiles && body.confirmation !== 'delete-generated-results') return json({ error: 'Confirm permanent deletion of generated results.', code: 'generated_cleanup_confirmation' }, 400);
    if (!clearFiles && (typeof body.taskId !== 'string' || !body.taskId || !body.clearAll && (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > 1000))) return json({ error: 'Select valid history entries.' }, 400);
    return records.transaction('readwrite', (store, done) => {
      const values = [];
      store.openCursor().onsuccess = event => {
        const cursor = event.target.result;
        if (cursor) { values.push([cursor.key, cursor.value]); cursor.continue(); return; }
        const jobs = values.filter(([key]) => String(key).startsWith('cloud:job:'));
        const timestamp = new Date().toISOString();
        if (clearFiles) {
          if (jobs.some(([, job]) => active.has(job.status))) return done(json({ error: 'Finish or cancel active and paused tasks before clearing results.', code: 'generated_jobs_active' }, 409));
          const referenced = new Set(jobs.flatMap(([, job]) => (job.outputs || []).flatMap(output => [output.mediaUrl, output.metadata?.previewUrl]).filter(Boolean)));
          const removed = { files: 0, bytes: 0 }; let retainedFiles = 0;
          const deleted = new Set();
          for (const [key, value] of values) if (String(key).startsWith('asset:') && value.source === 'generated') {
            const url = '/media/assets/' + String(key).slice(6);
            if (referenced.has(url)) { store.delete(key); removed.files += 1; removed.bytes += value.blob.size; deleted.add(url); }
            else retainedFiles += 1;
          }
          for (const [key, job] of jobs) store.put({ ...job, outputs: (job.outputs || []).map(output => ({ ...output, ...(deleted.has(output.mediaUrl) ? { mediaDeletedAt: timestamp, historyHiddenAt: timestamp } : {}), ...(deleted.has(output.metadata?.previewUrl) ? { metadata: { ...output.metadata, previewDeletedAt: timestamp } } : {}) })) }, key);
          return done(json({ ok: true, removed, failed: [], retained: { files: retainedFiles }, retainedFiles }));
        }
        const eligible = jobs.filter(([, job]) => job.taskId === body.taskId && (!body.canvasId || (job.canvasId || 'main') === body.canvasId) && job.status === 'succeeded');
        const selected = new Set();
        if (body.clearAll === true) {
          for (const [, job] of eligible) for (const output of job.outputs || []) if (output.mediaUrl) selected.add(keyFor(job.taskId, output.mediaUrl));
        } else for (const entry of body.entries || []) {
          const job = eligible.find(([, item]) => item.id === entry.jobId)?.[1];
          if (!job || !Number.isInteger(entry.outputIndex) || entry.outputIndex < 0 || !entry.mediaUrl || job.outputs?.[entry.outputIndex]?.mediaUrl !== entry.mediaUrl) return done(json({ error: 'History changed. Refresh the selection before deleting.', code: 'history_selection_stale' }, 409));
          selected.add(keyFor(job.taskId, entry.mediaUrl));
        }
        for (const [key, job] of jobs) if (!body.canvasId || (job.canvasId || 'main') === body.canvasId) store.put({ ...job, outputs: (job.outputs || []).map(output => selected.has(keyFor(job.taskId, output.mediaUrl)) ? { ...output, historyHiddenAt: timestamp } : output) }, key);
        done(json({ ok: true, removed: selected.size }));
      };
    });
  }
  return { handle };
}
