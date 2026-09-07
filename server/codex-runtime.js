import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { agentInstructions, agentTools } from './agent-contract.js';

// These are process/thread overrides, never writes to the user's Codex config.
export const isolatedConfig = {
  'features.apps': false, 'features.plugins': false, 'features.hooks': false,
  'features.shell_tool': false, 'features.unified_exec': false,
  'features.browser_use': false, 'features.computer_use': false,
  'features.image_generation': false, 'features.multi_agent': false,
  // The model catalog may require code_mode_only. Its isolated tool dispatcher
  // must remain available even though shell/environment/third-party tools are
  // disabled. Disabling the host also disables our two dynamic canvas tools.
  'features.code_mode_host': true,
  'features.view_image': false, 'features.memories': false,
  'features.skip_host_skill_discovery': true, 'features.skill_search': false,
  web_search: 'disabled', project_doc_max_bytes: 0, notify: [],
};

export class CodexRuntime extends EventEmitter {
  constructor({ executable = process.env.HEIYAN_CODEX_BIN || 'codex', cwd, environment = process.env, spawnProcess = spawn } = {}) {
    super(); this.pending = new Map(); this.nextId = 1; this.closed = false;
    const args = ['app-server', '--stdio'];
    for (const [key, value] of Object.entries(isolatedConfig)) args.push('-c', `${key}=${JSON.stringify(value)}`);
    this.child = spawnProcess(executable, args, { cwd, env: environment, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      try {
        const message = JSON.parse(line);
        if (message.method) this.emit('message', message);
        else {
          const request = this.pending.get(message.id);
          if (!request) return;
          this.pending.delete(message.id); clearTimeout(request.timer);
          if (message.error) request.reject(Object.assign(new Error(`Codex 接口拒绝了 ${request.method}，请检查版本或本机状态`), { protocolError: message.error }));
          else request.resolve(message.result);
        }
      } catch { /* Ignore non-protocol diagnostics; never relay process logs or credentials. */ }
    });
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => this.fail('Codex 连接管道已关闭'));
    this.child.once('error', () => this.fail('找不到或无法启动 Codex，请先安装并登录自己的 Codex'));
    this.child.once('exit', () => this.fail('Codex 连接进程已结束，请重新配对'));
    this.ready = this.initialize();
    this.ready.catch(() => {});
  }
  write(message) { if (!this.closed) this.child.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('Codex 已断开'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error(`Codex ${method} 响应超时；不会自动重试提交`));
        this.close();
      }, 25000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.write({ id, method, params });
    });
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'heiyan_connector', title: 'HEIYAN 画布连接器', version: '1.2.0' }, capabilities: { experimentalApi: true } });
    this.write({ method: 'initialized', params: {} });
    // Discover ONLY configured server names, then disable each before any thread
    // can start. Do not persist, expose or log the returned configuration.
    const { config } = await this.request('config/read', { includeLayers: false });
    this.config = { ...isolatedConfig };
    this.disabledMcpCount = Object.keys(config?.mcp_servers || {}).length;
    // Config overrides merge tables: an empty table DOES NOT disable inherited
    // servers. Set enabled=false for every exact name without copying secrets.
    this.config.mcp_servers = Object.fromEntries(Object.keys(config?.mcp_servers || {}).map(name => [name, { enabled: false }]));
    return this.account();
  }
  async account() {
    const { account } = await this.request('account/read', { refreshToken: false });
    if (!account) throw new Error('请先在你自己的 Codex 中完成登录，再回来连接');
    return account;
  }
  async startThread() {
    await this.ready;
    const result = await this.request('thread/start', {
      approvalPolicy: 'never', sandbox: 'read-only', environments: [], selectedCapabilityRoots: [],
      ephemeral: true, config: this.config, developerInstructions: agentInstructions,
      dynamicTools: agentTools,
    });
    const inventory = await this.request('mcpServerStatus/list', { threadId: result.thread.id });
    if (inventory.data?.some(server => server.runtimeStatus === 'connected' || Object.keys(server.tools || {}).length) || inventory.nextCursor) {
      this.close(); throw new Error('Codex 的外部工具未成功隔离，已停止连接，请检查版本与配置');
    }
    return result.thread.id;
  }
  async startTurn(threadId, text) {
    return this.request('turn/start', { threadId, environments: [], approvalPolicy: 'never', input: [{ type: 'text', text, text_elements: [] }] });
  }
  respond(id, result) { this.write({ id, result }); }
  deny(id) { this.write({ id, error: { code: -32601, message: 'Only explicitly approved HEIYAN canvas tools are supported.' } }); }
  fail(message) {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(message)); }
    this.pending.clear(); this.emit('disconnected', message);
  }
  close() { this.fail('连接已断开'); this.lines.close(); this.child.kill(); }
}
