import path from 'node:path';

function normalized(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export async function verifyDeployment({ comfyPort, comfyRoot, fetchImpl = fetch }) {
  const response = await fetchImpl('http://127.0.0.1:' + comfyPort + '/system_stats', { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('ComfyUI deployment is unavailable. Start this package first.');
  const stats = await response.json();
  const argv = stats.system?.argv;
  const modelFlag = Array.isArray(argv) ? argv.indexOf('--models-directory') : -1;
  if (!Array.isArray(argv) || normalized(argv[0]) !== normalized(path.join(comfyRoot, 'main.py'))
    || modelFlag < 0 || !argv[modelFlag + 1] || normalized(argv[modelFlag + 1]) !== normalized(path.join(comfyRoot, 'models'))) {
    throw new Error('This port belongs to another ComfyUI installation. Start ComfyUI from this HEIYAN package; do not connect the old environment. / 该端口不是当前解压包的 ComfyUI，请启动当前包内的环境。');
  }
}
