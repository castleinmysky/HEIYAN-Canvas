import { spawn as spawnProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function realDirectory(target) {
  const resolved = await fs.realpath(target);
  if (!(await fs.stat(resolved)).isDirectory()) throw new Error('请选择 ComfyUI 软件文件夹');
  return resolved;
}

function ensureLocalPath(raw) {
  if (!path.isAbsolute(raw) || raw.startsWith('\\\\') || raw.includes('\0')) throw new Error('请选择本机完整的 ComfyUI 软件位置');
  if (path.parse(raw).root === path.resolve(raw)) throw new Error('不能选择整个磁盘');
}

async function findSourceRoot(selected) {
  const choices = [selected, path.join(selected, 'ComfyUI')];
  for (const candidate of choices) {
    if (await exists(path.join(candidate, 'main.py')) && await exists(path.join(candidate, 'comfy'))) return candidate;
  }
  return '';
}

async function firstExisting(candidates) {
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return '';
}

export async function inspectComfyInstallation(rootValue, platform = process.platform) {
  const raw = String(rootValue || '').trim();
  ensureLocalPath(raw);
  const selected = await realDirectory(raw);

  if (platform === 'darwin' && selected.toLowerCase().endsWith('.app')) {
    return { found: true, kind: 'mac-app', selectedPath: selected, sourceRoot: '', executable: 'open', expectedPort: 8188, startSupported: true };
  }

  const sourceRoot = await findSourceRoot(selected);
  if (!sourceRoot) throw new Error('这里没有找到 ComfyUI；请选择包含 main.py 的文件夹或它的上一级');
  const portableHome = sourceRoot === selected ? selected : path.dirname(sourceRoot);
  const windowsPython = await firstExisting([
    path.join(portableHome, 'python_embeded', 'python.exe'),
    path.join(portableHome, 'python_embedded', 'python.exe'),
    path.join(sourceRoot, '.venv', 'Scripts', 'python.exe'),
    path.join(sourceRoot, 'venv', 'Scripts', 'python.exe')
  ]);
  const unixPython = await firstExisting([
    path.join(sourceRoot, '.venv', 'bin', 'python'),
    path.join(sourceRoot, 'venv', 'bin', 'python')
  ]);
  const executable = windowsPython || unixPython || (platform === 'win32' ? 'python' : 'python3');
  return {
    found: true,
    kind: windowsPython ? 'windows-portable' : unixPython ? 'virtual-environment' : 'source',
    selectedPath: selected,
    sourceRoot,
    executable,
    expectedPort: 8188,
    startSupported: true
  };
}

export function startComfyInstallation(installation, { spawnImpl = spawnProcess, platform = process.platform } = {}) {
  let executable = installation.executable;
  let args;
  let cwd;
  if (installation.kind === 'mac-app') {
    executable = 'open';
    args = [installation.selectedPath];
    cwd = path.dirname(installation.selectedPath);
  } else {
    args = ['main.py', '--listen', '127.0.0.1', '--port', String(installation.expectedPort || 8188)];
    if (installation.kind === 'windows-portable') args.push('--windows-standalone-build');
    cwd = installation.sourceRoot;
  }
  const child = spawnImpl(executable, args, { cwd, detached: true, stdio: 'ignore', windowsHide: platform === 'win32', shell: false });
  child.once?.('error', () => { /* readiness polling reports a friendly failure; keep the server alive */ });
  child.unref?.();
  return { started: true, pid: child.pid || null, baseUrl: `http://127.0.0.1:${installation.expectedPort || 8188}` };
}

export async function saveComfyInstallation(privateDir, installation) {
  await fs.mkdir(privateDir, { recursive: true, mode: 0o700 });
  const target = path.join(privateDir, 'comfy-runtime.json');
  const value = { selectedPath: installation.selectedPath, savedAt: new Date().toISOString() };
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function loadComfyInstallation(privateDir, platform = process.platform) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(privateDir, 'comfy-runtime.json'), 'utf8'));
    return await inspectComfyInstallation(value.selectedPath, platform);
  } catch { return null; }
}
