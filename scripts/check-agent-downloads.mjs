import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
for (const name of ['heiyan-windows', 'heiyan-connector-update']) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'public/downloads', name, 'manifest.json'), 'utf8'));
  for (const item of manifest.parts || manifest.files) {
    const resource = item.url || item.path;
    if (!resource.startsWith('/downloads/') || resource.includes('..')) throw Error('Invalid download path');
    let bytes;
    try { bytes = await fs.readFile(path.join(root, 'public', resource)); }
    catch { throw Error(`Missing published download asset: ${resource}. Restore the verified original file before building.`); }
    if (bytes.length !== item.bytes || digest(bytes) !== item.sha256) throw Error(`Download integrity mismatch: ${resource}`);
  }
}
console.log('Windows package and incremental connector downloads verified.');
