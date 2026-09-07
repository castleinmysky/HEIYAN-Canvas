import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BOOTSTRAP_VERSION = '1.0.0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codex = path.join(root, 'runtime', 'codex', 'bin', 'codex.exe');
const packageId = crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 20);
const childEnv = { ...process.env, PATH: [path.dirname(codex), path.join(root, 'runtime/codex/codex-path'), process.env.PATH || ''].join(path.delimiter) };
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const validVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
const compareVersions = (left, right) => left.split('.').map(Number).reduce((result, part, index) => result || part - Number(right.split('.')[index]), 0);

export function validateUpdateManifest(value, siteOrigin) {
  const origin = new URL(siteOrigin).origin;
  if (!value || value.schema !== 1 || value.channel !== 'stable' || !validVersion(value.version) || value.minBootstrapVersion !== BOOTSTRAP_VERSION) throw Error('更新清单不受支持');
  if (value.runtime?.node !== '22.23.2' || value.runtime?.codex !== '0.153.4') throw Error('更新需要新的完整运行包');
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > 32) throw Error('更新文件清单无效');
  let total = 0;
  const paths = new Set();
  for (const entry of value.files) {
    if (!/^(portable-main\.mjs|server\/[a-z0-9-]+\.js|portable\/[a-z0-9.-]+)$/.test(entry?.path || '') || !/^\/downloads\/heiyan-connector-update\/\d+\.\d+\.\d+\/[a-z0-9./-]+$/.test(entry?.url || '') || !/^[a-f0-9]{64}$/.test(entry?.sha256 || '') || !Number.isSafeInteger(entry?.bytes) || entry.bytes < 1 || entry.bytes > 1024 * 1024) throw Error('更新文件清单无效');
    if (new URL(entry.url, origin).origin !== origin) throw Error('更新地址无效');
    if (!entry.url.startsWith(`/downloads/heiyan-connector-update/${value.version}/`) || paths.has(entry.path)) throw Error('更新文件清单无效');
    paths.add(entry.path);
    total += entry.bytes;
  }
  if (total > 4 * 1024 * 1024 || !value.files.some(entry => entry.path === 'portable-main.mjs')) throw Error('更新包无效');
  return value;
}

async function validateRuntime() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('此包适用于 Windows x64。请勿在 ZIP 内直接运行，先完整解压。');
  const manifest = await readJson(path.join(root, 'runtime-manifest.json'));
  for (const entry of manifest.files) {
    const file = path.resolve(root, entry.path);
    if (!file.startsWith(path.join(root, 'runtime') + path.sep) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('运行环境清单无效');
    const hash = crypto.createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== entry.sha256) throw Error('运行文件缺失或校验失败，请重新下载完整 ZIP 并解压，不要关闭系统防护。');
  }
  return manifest;
}

async function validateRelease(directory, manifest) {
  for (const entry of manifest.files) {
    const file = path.resolve(directory, entry.path);
    if (!file.startsWith(directory + path.sep)) throw Error('本机连接器版本无效');
    const data = await fs.readFile(file);
    if (data.length !== entry.bytes || sha256(data) !== entry.sha256) throw Error('本机连接器文件校验失败');
  }
}

async function installUpdate(site, currentVersion) {
  const response = await fetch(new URL('/downloads/heiyan-connector-update/manifest.json', site), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw Error('暂时无法检查更新');
  const manifest = validateUpdateManifest(await response.json(), site.origin);
  if (currentVersion && compareVersions(manifest.version, currentVersion) <= 0) return null;
  const releaseRoot = path.join(root, 'app', 'releases');
  const finalDir = path.join(releaseRoot, manifest.version);
  try { await validateRelease(finalDir, manifest); return manifest; } catch { /* download a clean release */ }
  const stage = path.join(releaseRoot, '.stage-' + crypto.randomUUID());
  await fs.mkdir(stage, { recursive: true });
  try {
    for (const entry of manifest.files) {
      const download = await fetch(new URL(entry.url, site), { redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!download.ok) throw Error('更新文件下载失败');
      const data = Buffer.from(await download.arrayBuffer());
      if (data.length !== entry.bytes || sha256(data) !== entry.sha256) throw Error('更新文件校验失败');
      const target = path.join(stage, entry.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, data);
    }
    await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await fs.mkdir(releaseRoot, { recursive: true });
    try { await fs.rename(stage, finalDir); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    return manifest;
  } finally { try { await fs.rm(stage, { recursive: true, force: true }); } catch { /* best effort */ } }
}

async function selectRelease() {
  const configuration = await readJson(path.join(root, 'connector.json'));
  const site = new URL(configuration.siteUrl);
  if (site.username || site.password || site.hash || !(site.protocol === 'https:' || (site.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(site.hostname)))) throw Error('连接器更新地址无效');
  const pointerFile = path.join(root, 'app', 'current.json');
  let pointer; try { pointer = await readJson(pointerFile); } catch { pointer = null; }
  let currentVersion = validVersion(pointer?.version) ? pointer.version : null;
  if (process.argv[2] !== 'serve') {
    try {
      console.log('Checking for HEIYAN connector updates...');
      const update = await installUpdate(site, currentVersion);
      if (update) { currentVersion = update.version; await fs.writeFile(pointerFile, JSON.stringify({ version: currentVersion }) + '\n'); console.log(`HEIYAN connector updated to ${currentVersion}.`); }
    } catch (error) { console.warn('Update skipped:', error.message); }
  }
  const requested = process.argv.includes('--release') ? process.argv[process.argv.indexOf('--release') + 1] : null;
  const version = validVersion(requested) ? requested : currentVersion;
  if (!version) throw Error('连接器应用文件缺失，请重新下载完整 ZIP');
  const directory = path.join(root, 'app', 'releases', version);
  const manifest = validateUpdateManifest(await readJson(path.join(directory, 'manifest.json')), site.origin);
  if (manifest.version !== version) throw Error('本机连接器版本不匹配');
  await validateRelease(directory, manifest);
  process.env.HEIYAN_CONNECTOR_RELEASE = version;
  return path.join(directory, 'portable-main.mjs');
}

async function main() {
  const command = process.argv[2] || 'start';
  if (!['start', 'stop', 'serve', 'check'].includes(command)) throw Error('不支持的启动命令');
  console.log('Checking HEIYAN portable runtime...'); await validateRuntime();
  if (command === 'check') {
    await selectRelease();
    const version = spawnSync(codex, ['--version'], { env: childEnv, encoding: 'utf8', windowsHide: true });
    if (version.status !== 0) throw Error('Codex 运行检查失败'); console.log(version.stdout.trim()); return;
  }
  const entry = await selectRelease();
  const application = await import(pathToFileURL(entry).href);
  await application.runPortable({ root, codex, childEnv, packageId });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message || '连接器启动失败'); process.exitCode = 1; });
