import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createGateway } from './gateway.mjs';
import { createRemoteGateway } from './remote-gateway.mjs';
import { startQuickTunnel } from './quick-tunnel.mjs';
import { verifyDeployment } from './deployment-target.mjs';
import { completePackageModels } from './package-models.mjs';
import { createApp } from './engine/server/app.js';
import { resolveRuntimePaths } from './engine/server/paths.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const comfyRoot = await fs.realpath(path.join(root, '../ComfyUI'));
// Machine-local selection, never supplied by remote clients or copied into bundles.
let comfyPort = 8288;
try { comfyPort = JSON.parse(await fs.readFile(path.join(root, 'connection.json'), 'utf8')).comfyPort; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!Number.isInteger(comfyPort) || comfyPort < 1024 || comfyPort > 65535 || [8289, 8291].includes(comfyPort)) throw new Error('Invalid local ComfyUI port in SiteBridge/connection.json.');
const paths = resolveRuntimePaths({ ECHO_HOME: path.join(root, 'state') });
await fs.mkdir(paths.private, { recursive: true });
const tokenFile = path.join(paths.private, 'pairing-code');
let token;
try { token = await fs.readFile(tokenFile, 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; token = randomBytes(32).toString('base64url'); await fs.writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' }); }
// Isolated state, no original canvas configuration, cloud secrets or original output directories.
const env = { ECHO_HOME: paths.root, ECHO_ALLOW_REMOTE_ADMIN: '0' };
const internal = createApp({ dataDir: paths.data, privateDir: paths.private, runtimePaths: paths, env }).listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { internal.once('listening', resolve); internal.once('error', reject); });
const remoteMode = process.argv.includes('--remote');
let remoteToken, tunnel, remoteGateway, remoteUrl = '';
const gateway = createGateway({ token, stateDir: paths.private, upstream: 'http://127.0.0.1:' + internal.address().port, comfyPort, verifyTarget: () => verifyDeployment({ comfyPort, comfyRoot }), completeCatalog: models => completePackageModels(models, { comfyPort, comfyRoot }), remoteInfo: () => remoteMode ? { token: remoteToken, url: remoteUrl } : null });
if (remoteMode) {
  const file = path.join(paths.private, 'remote-access-code');
  try { remoteToken = (await fs.readFile(file, 'utf8')).trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; remoteToken = randomBytes(32).toString('base64url'); await fs.writeFile(file, remoteToken, { mode: 0o600, flag: 'wx' }); }
}
try { await gateway.listen(); }
catch (error) { internal.close(); console.error(error.code === 'EADDRINUSE' ? 'HEIYAN connector is already running on 8289. No existing service was stopped.' : 'HEIYAN connector could not start.'); process.exitCode = 1; }
if (!process.exitCode) console.log('HEIYAN local connector ready. Open http://127.0.0.1:8289 to get the pairing code.\nKeep this window and ComfyUI open while generating.');
if (!process.exitCode && remoteMode) {
  try {
    if (process.argv.includes('--rotate-remote-code')) {
      remoteToken = randomBytes(32).toString('base64url');
      await fs.writeFile(path.join(paths.private, 'remote-access-code'), remoteToken, { mode: 0o600 });
    }
    remoteGateway = createRemoteGateway({ token: remoteToken, localToken: token, upstream: 'http://127.0.0.1:8289' });
    const address = await remoteGateway.listen();
    console.log('Starting temporary HTTPS connection. Cloudflare forwards prompts, input media and results. The remote code stays on the local pairing page.');
    tunnel = await startQuickTunnel({ root, port: address.port, onUrl: url => { if (remoteUrl !== url) { remoteUrl = url; console.log(url ? 'Remote address ready: ' + url + '\nOpen http://127.0.0.1:8289 for the private access code.' : 'Remote tunnel is offline.'); } }, onMessage: message => console.log(message) });
  } catch (error) { remoteGateway?.server.close(); console.error('Remote connection unavailable: ' + error.message); }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { tunnel?.stop(); remoteGateway?.server.close(); gateway.server.close(); internal.close(); process.exit(0); });
process.once('exit', () => tunnel?.stop());
