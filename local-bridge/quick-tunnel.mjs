import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export function quickTunnelArgs(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid gateway port.');
  return ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:' + port, '--http-host-header', '127.0.0.1:' + port, '--protocol', 'http2'];
}

export async function startQuickTunnel({ root, port, onUrl, onMessage }) {
  const release = JSON.parse(await fs.readFile(path.join(root, 'cloudflared-release.json'), 'utf8'));
  const binary = path.join(root, 'cloudflared.exe');
  const bytes = await fs.readFile(binary).catch(() => { throw new Error('Use the complete Remote Connector add-on; cloudflared.exe is missing.'); });
  if (createHash('sha256').update(bytes).digest('hex') !== release.sha256) throw new Error('Cloudflare program verification failed. Replace the add-on with a verified copy.');
  const child = spawn(binary, quickTunnelArgs(port), { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let pendingUrl = '', registered = false, tail = '';
  const output = chunk => {
    tail = (tail + chunk.toString()).slice(-8000);
    const match = tail.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com/);
    if (match) pendingUrl = match[0];
    if (tail.includes('Registered tunnel connection')) registered = true;
    if (pendingUrl && registered) onUrl(pendingUrl);
  };
  child.stdout.on('data', output); child.stderr.on('data', output);
  child.on('error', () => { onUrl(''); onMessage('The HTTPS tunnel could not start.'); });
  child.on('exit', () => { onUrl(''); onMessage('HTTPS tunnel stopped. Local generation stays available. Restart the connector to obtain a new address.'); });
  return { stop: () => child.kill(), child };
}
