import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createAgentConnector } from './server/agent-connector.js';
import { CodexRuntime } from './server/codex-runtime.js';
import { canvasSite, createLocalControl } from './portable/control.js';

const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runPortable({ root, codex, childEnv, packageId }) {
  const createHashName = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
  const stateDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'HEIYAN', 'AgentConnector', packageId);
  const stateFile = path.join(stateDir, 'instance.json');
  const alive = pid => { if (!Number.isSafeInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
  async function management(instance, route) {
    if (instance.packageId !== packageId || !Number.isInteger(instance.port) || instance.port < 1024 || instance.port > 65535 || !/^[\w-]{32}$/.test(instance.secret)) throw Error('本机状态不匹配，不会停止其他进程');
    const base = `http://127.0.0.1:${instance.port}`;
    const response = await fetch(base + '/local/' + route, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000), headers: { Origin: base, 'Content-Type': 'application/json', Authorization: 'Bearer ' + instance.secret }, body: '{}' });
    if (!response.ok) throw Error('本机状态已失效，不会停止其他进程');
    const result = await response.json();
    if (route === 'status' && (result.app !== 'heiyan-portable' || result.packageId !== packageId)) throw Error('端口不属于当前连接器');
    return result;
  }
  async function existing() {
    let instance; try { instance = await readJson(stateFile); } catch { return null; }
    try { await management(instance, 'status'); return instance; }
    catch { if (alive(instance.pid)) throw Error('本包的连接器仍在启动或暂时无响应，请稍后重试；不会强制结束任务。'); return null; }
  }
  function openSetup(url) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:HEIYAN_LAUNCH_URL -WindowStyle Hidden'], { env: { ...process.env, HEIYAN_LAUNCH_URL: url }, stdio: 'ignore', windowsHide: true });
    if (result.error || result.status !== 0) throw Error('未能打开浏览器，请检查系统默认浏览器后再次启动。');
  }
  async function serve() {
    await fs.mkdir(stateDir, { recursive: true });
    const guard = net.createServer(socket => socket.destroy());
    const guardName = createHashName(root + (process.env.USERNAME || packageId));
    try { await new Promise((resolve, reject) => { guard.once('error', reject); guard.listen('\\\\.\\pipe\\heiyan-agent-' + guardName, resolve); }); }
    catch (error) { if (error.code === 'EADDRINUSE') return; throw error; }
    let connector, loginChild, probeChild, closing = false;
    const cleanup = async () => {
      if (closing) return; closing = true;
      loginChild?.kill(); probeChild?.kill(); if (connector) await connector.close(); guard.close();
      try { if ((await readJson(stateFile)).pid === process.pid) await fs.unlink(stateFile); } catch { /* keep unrelated state */ }
    };
    try {
      const configuration = await readJson(path.join(root, 'connector.json'));
      const site = canvasSite(configuration.siteUrl);
      const port = Number(configuration.port || 17372);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('连接端口配置无效');
      const secret = crypto.randomBytes(24).toString('base64url');
      const workspace = await fs.mkdtemp(path.join(stateDir, 'workspace-'));
      let loggedIn = false, checkedAt = 0, checking, loginError = '';
      const probe = async () => {
        if (!loginChild && Date.now() - checkedAt > 10000 && !checking) {
          checking = new Promise(resolve => {
            const child = spawn(codex, ['login', 'status'], { cwd: workspace, env: childEnv, windowsHide: true, stdio: 'ignore' });
            probeChild = child; const timer = setTimeout(() => child.kill(), 8000);
            const finish = success => { clearTimeout(timer); if (probeChild === child) probeChild = null; loggedIn = success; checkedAt = Date.now(); resolve(); };
            child.once('error', () => finish(false)); child.once('exit', code => finish(code === 0));
          }).finally(() => { checking = null; });
        }
        if (checking) await checking;
        return { loggedIn, loggingIn: !!loginChild, error: loginError };
      };
      const login = async () => {
        if (loginChild) return; loginError = '';
        loginChild = spawn(codex, ['login'], { cwd: workspace, env: childEnv, windowsHide: true, stdio: 'ignore' });
        loginChild.once('error', () => { loginError = '无法打开官方登录，请检查运行文件与网络后重试。'; loginChild = null; checkedAt = 0; });
        loginChild.once('exit', code => { if (code !== 0) loginError = '登录未完成。请检查网络后重新点击登录；不会自动重试。'; loginChild = null; checkedAt = 0; });
      };
      connector = createAgentConnector({ origin: site.origin,
        runtimeFactory: () => new CodexRuntime({ executable: codex, cwd: workspace, environment: childEnv }),
        localHandler: createLocalControl({ secret, packageId, siteUrl: site.href, probe, login, stop: async () => { await cleanup(); process.exit(0); } }),
      });
      const listen = requested => new Promise((resolve, reject) => { const failure = error => { connector.server.off('listening', success); reject(error); }; const success = () => { connector.server.off('error', failure); resolve(); }; connector.server.once('error', failure); connector.server.once('listening', success); connector.server.listen(requested, '127.0.0.1'); });
      try { await listen(port); } catch (error) { if (error.code !== 'EADDRINUSE') throw error; await listen(0); }
      await fs.writeFile(stateFile, JSON.stringify({ pid: process.pid, packageId, port: connector.server.address().port, secret }), { mode: 0o600 });
      for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await cleanup(); process.exit(0); });
    } catch (error) { await cleanup(); throw error; }
  }
  const command = process.argv[2] || 'start';
  if (command === 'serve') return serve();
  if (command === 'stop') {
    const instance = await existing(); if (!instance) { console.log('HEIYAN connector is not running.'); return; }
    await management(instance, 'stop'); console.log('HEIYAN connector stopped. Other Codex processes were not touched.'); return;
  }
  if (command !== 'start') throw Error('不支持的启动命令');
  let instance = await existing();
  if (!instance) {
    await fs.mkdir(stateDir, { recursive: true });
    const output = await fs.open(path.join(stateDir, 'startup.log'), 'a');
    const child = spawn(process.execPath, [process.argv[1], 'serve', '--release', process.env.HEIYAN_CONNECTOR_RELEASE || ''], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output.fd, output.fd], env: process.env });
    child.unref(); await output.close();
    for (let attempt = 0; attempt < 50; attempt++) { await pause(300); try { instance = await existing(); if (instance) break; } catch { /* startup still pending */ } }
    if (!instance) throw Error('连接器启动失败，请查看本机 HEIYAN/AgentConnector 目录中的 startup.log。');
  }
  if (!process.argv.includes('--no-open')) openSetup(`http://127.0.0.1:${instance.port}/setup#key=${instance.secret}`);
  console.log('HEIYAN is running. Follow the instructions in your browser.');
}
