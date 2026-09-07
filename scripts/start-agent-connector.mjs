import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentConnector } from '../server/agent-connector.js';
import { CodexRuntime } from '../server/codex-runtime.js';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const origin = option('--origin', process.env.HEIYAN_ORIGIN || 'http://127.0.0.1:8792');
const port = Number(option('--port', '17372'));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('端口必须在 1024–65535 之间');
// A clean workspace avoids inheriting the canvas repository's instructions.
// Login remains owned by Codex. No auth file is read/copied by this connector.
const workspace = await mkdtemp(path.join(os.tmpdir(), 'heiyan-agent-'));
const connector = createAgentConnector({ origin, runtimeFactory: () => new CodexRuntime({ cwd: workspace }) });
connector.server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已占用，请关闭旧连接器或使用 --port 指定端口。' : '连接器启动失败。'); process.exitCode = 1; });
connector.server.listen(port, '127.0.0.1', () => {
  console.log(`HEIYAN 画布连接器\n仅允许网页：${origin}\n连接地址：http://127.0.0.1:${port}\n配对码（10 分钟内有效）：${connector.pairingCode}\n请先自行登录 Codex，再在画布的连接面板中输入配对码。\n关闭此进程会断开会话；不会关闭你的 Codex 应用。`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await connector.close(); process.exit(0); });
