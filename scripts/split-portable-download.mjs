import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [archive, destination] = process.argv.slice(2);
if (!archive || !destination) throw Error('Expected archive and download directory');
const hash = crypto.createHash('sha256'); for await (const chunk of createReadStream(archive)) hash.update(chunk);
const sha256 = hash.digest('hex'); const id = sha256.slice(0, 16);
const directory = path.join(destination, id); await fs.mkdir(directory, { recursive: true });
const parts = []; let bytes = 0, index = 0;
for await (const chunk of createReadStream(archive, { highWaterMark: 20 * 1024 * 1024 })) {
  const filename = `part-${String(index++).padStart(3, '0')}.bin`; await fs.writeFile(path.join(directory, filename), chunk);
  parts.push({ path: `/downloads/heiyan-windows/${id}/${filename}`, bytes: chunk.length, sha256: crypto.createHash('sha256').update(chunk).digest('hex') }); bytes += chunk.length;
}
await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ filename: 'HEIYAN-Connector-Windows-x64.zip', platform: 'win32-x64', version: '1.1.0', bytes, sha256, parts }, null, 2) + '\n');
console.log(JSON.stringify({ bytes, sha256, parts: parts.length }));
