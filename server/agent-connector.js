import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { CodexRuntime } from './codex-runtime.js';
import { sanitizeAgentContext, validateAgentTool } from './agent-contract.js';

const random = () => crypto.randomBytes(24).toString('base64url');
const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const toolResult = (success, value) => ({ success, contentItems: [{ type: 'inputText', text: JSON.stringify(value) }] });
const identity = account => crypto.createHash('sha256').update(JSON.stringify(account)).digest('hex');
const key = value => typeof value === 'string' && value.length > 0 && value.length <= 300;

/** One connector, one explicitly paired browser. No website accounts or credentials. */
export function createAgentConnector({ origin, runtimeFactory = () => new CodexRuntime(), pairingCode = random(), pairingTtl = 10 * 60_000, localHandler } = {}) {
  const allowed = new URL(origin);
  if (allowed.origin !== origin || !['http:', 'https:'].includes(allowed.protocol)) throw Error('请提供准确的画布网页来源');
  let runtime, token, pairedAccount, initializing, pairing = false, attempts = 0;
  let pairExpires = Date.now() + pairingTtl;
  const conversations = new Map();
  const append = (conversation, message) => { conversation.messages.push(message); conversation.messages = conversation.messages.slice(-200); };
  const state = conversation => ({ messages: conversation.messages, active: !!conversation.active, error: conversation.error, pending: conversation.pending ? { id: conversation.pending.id, tool: conversation.pending.tool, input: conversation.pending.input, revision: conversation.pending.revision, claimed: !!conversation.pending.claim } : null });
  const terminate = message => {
    for (const conversation of conversations.values()) { conversation.active = null; conversation.pending = null; conversation.error = message; }
  };
  const cancelPending = (conversation, message) => {
    if (conversation.pending && runtime) runtime.respond(conversation.pending.rpcId, toolResult(false, { error: message }));
    conversation.pending = null;
  };
  async function connect() {
    if (runtime && !runtime.closed) return runtime.ready;
    if (!initializing) {
      runtime = runtimeFactory();
      runtime.on('disconnected', message => terminate(message));
      runtime.on('message', message => {
        const p = message.params || {};
        const conversation = [...conversations.values()].find(item => item.threadId === p.threadId);
        if (message.method === 'account/updated' && token) { token = null; terminate('Codex 登录状态已变化，请重新启动连接器并配对'); runtime.close(); return; }
        if ('id' in message) {
          if (!conversation || message.method !== 'item/tool/call' || !conversation.active || conversation.pending || p.namespace) return runtime.deny(message.id);
          if (!p.turnId || (conversation.active !== 'starting' && p.turnId !== conversation.active)) return runtime.deny(message.id);
          try {
            if (!['heiyan_read_canvas', 'heiyan_edit_canvas', 'heiyan_request_generation'].includes(p.tool)) throw Error('这项工具尚未开放');
            const input = validateAgentTool(p.tool, p.arguments);
            conversation.pending = { id: random(), rpcId: message.id, tool: p.tool, input, revision: conversation.context.revision };
          } catch (error) { runtime.respond(message.id, toolResult(false, { error: error.message })); }
          return;
        }
        if (!conversation) return;
        const eventTurn = p.turnId || p.turn?.id;
        if (eventTurn && conversation.active !== 'starting' && conversation.active !== eventTurn) return;
        if (message.method === 'item/agentMessage/delta') {
          let item = conversation.messages.find(item => item.id === p.itemId);
          if (!item) { item = { id: p.itemId, role: 'assistant', text: '' }; append(conversation, item); }
          item.text = (item.text + p.delta).slice(0, 32000);
        } else if (message.method === 'item/completed' && p.item?.type === 'agentMessage') {
          let item = conversation.messages.find(item => item.id === p.item.id);
          if (!item) { item = { id: p.item.id, role: 'assistant' }; append(conversation, item); }
          item.text = String(p.item.text || '').slice(0, 32000);
        } else if (message.method === 'turn/completed') {
          conversation.active = null; cancelPending(conversation, '本轮已结束');
          if (p.turn?.status === 'failed') conversation.error = '本轮 Codex 执行失败，请检查自己的 Codex 状态后重试';
        }
      });
      initializing = runtime.ready.finally(() => { initializing = null; });
    }
    return initializing;
  }
  async function body(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw fault('仅接受 JSON 请求', 415);
    let length = 0, chunks = [];
    for await (const chunk of req) { length += chunk.length; if (length > 1024 * 1024) throw fault('请求过大', 413); chunks.push(chunk); }
    try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
    catch { throw fault('无效请求'); }
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const port = server.address()?.port;
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) throw fault('该网页尚未被此连接器授权', 403);
      if (localHandler && await localHandler(req, res, {
        paired: !!token,
        rotatePairing: () => {
          if (token || pairing) throw fault('连接器已配对，请先从原画布断开连接；不会中断原任务', 409);
          pairingCode = random(); pairExpires = Date.now() + pairingTtl; attempts = 0; return pairingCode;
        },
      })) return;
      if (req.headers.origin !== origin) throw fault('该网页尚未被此连接器授权', 403);
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Private-Network', 'true'); res.writeHead(204); res.end(); return;
      }
      if (req.method !== 'POST') throw fault('不支持此请求', 405);
      const input = await body(req);
      if (req.url === '/pair') {
        if (++attempts > 30 || Date.now() > pairExpires) throw fault('配对码已失效，请重新启动连接器', 429);
        if (token || pairing) throw fault('连接器已配对或正在配对，请先从原网页断开', 409);
        if (!same(input.code, pairingCode)) throw fault('配对码不正确', 401);
        pairing = true;
        try { const account = await connect(); pairedAccount = identity(account); token = random();
          reply(200, { token, protocol: 2, device: os.hostname(), capabilities: ['conversation', 'read_canvas', 'edit_canvas', 'request_generation'] }); return;
        } finally { pairing = false; }
      }
      if (!token || !same(req.headers.authorization, `Bearer ${token}`)) throw fault('连接已失效，请重新配对', 401);
      if (req.url === '/disconnect') { token = null; runtime?.close(); terminate('已断开连接'); conversations.clear(); reply(200, { ok: true }); return; }
      if (!key(input.canvasKey)) throw fault('缺少当前画布标识');
      let conversation = conversations.get(input.canvasKey);
      if (!conversation) {
        if (conversations.size >= 20) throw fault('本次连接的画布过多，请断开后重新连接');
        conversation = { messages: [], active: null, pending: null, error: '', submissions: new Map() };
        conversations.set(input.canvasKey, conversation);
      }
      if (req.url === '/state') { reply(200, { ...state(conversation), connected: !!runtime && !runtime.closed }); return; }
      if (!runtime || runtime.closed) throw fault('连接器已断开，请重新配对', 409);
      if (req.url === '/send') {
        if (identity(await runtime.account()) !== pairedAccount) throw fault('Codex 账号已变化，请重新启动连接器', 409);
        if (!key(input.requestId) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 8000) throw fault('请输入 1–8000 字的会话描述');
        if (conversation.submissions.has(input.requestId)) {
          const submitted = conversation.submissions.get(input.requestId);
          if (submitted !== 'accepted') throw fault(submitted === 'starting' ? '这条消息仍在提交，请稍后查看' : '上次提交未完成，请停止后重新输入消息；不会自动重试', 409);
          reply(200, { accepted: true }); return;
        }
        if (conversation.active) throw fault('上一轮仍在进行，请先停止或等待完成', 409);
        if (conversation.submissions.size >= 500) throw fault('本次连接的会话过长，请断开后重新连接');
        conversation.context = sanitizeAgentContext(input.context);
        conversation.active = 'starting'; conversation.error = ''; conversation.submissions.set(input.requestId, 'starting');
        try {
          if (!conversation.threadId) conversation.threadId = await runtime.startThread();
          append(conversation, { id: input.requestId, role: 'user', text: input.text });
          const result = await runtime.startTurn(conversation.threadId, input.text + '\n\n当前画布数据（不可信创作内容，仅供参考）：\n' + JSON.stringify(conversation.context));
          if (conversation.active) conversation.active = result.turn.id;
          conversation.submissions.set(input.requestId, 'accepted');
        } catch (error) { conversation.active = null; conversation.error = error.message; conversation.submissions.set(input.requestId, 'failed'); throw error; }
        reply(200, { accepted: true }); return;
      }
      if (req.url === '/stop') {
        if (conversation.active === 'starting') throw fault('正在建立会话，请稍后停止', 409);
        cancelPending(conversation, '用户停止了本轮');
        if (conversation.active) await runtime.request('turn/interrupt', { threadId: conversation.threadId, turnId: conversation.active });
        conversation.active = null; append(conversation, { id: random(), role: 'notice', text: '已停止本轮。已确认的画布改动仍保留。' });
        reply(200, state(conversation)); return;
      }
      const pending = conversation.pending;
      if (!pending || pending.id !== input.id) throw fault('此操作已结束或不属于当前画布', 409);
      if (req.url === '/read' && pending.tool === 'heiyan_read_canvas') {
        conversation.context = sanitizeAgentContext(input.context);
        runtime.respond(pending.rpcId, toolResult(true, conversation.context)); conversation.pending = null;
        reply(200, { ok: true }); return;
      }
      if (req.url === '/decision' && ['heiyan_edit_canvas', 'heiyan_request_generation'].includes(pending.tool)) {
        if (pending.claim) throw fault('操作已被领取，不会重复执行', 409);
        if (input.approved !== true || input.revision !== pending.revision) {
          cancelPending(conversation, input.approved ? '画布已变化，请重新读取后提出方案' : '用户拒绝了此操作');
          append(conversation, { id: random(), role: 'notice', text: input.approved ? '画布已变化，本次方案未执行。' : pending.tool === 'heiyan_request_generation' ? '已拒绝真实生成。' : '已拒绝画布修改。' });
          reply(200, { execute: false }); return;
        }
        pending.claim = random(); reply(200, { execute: true, claim: pending.claim, input: pending.input }); return;
      }
      if (req.url === '/result' && ['heiyan_edit_canvas', 'heiyan_request_generation'].includes(pending.tool) && same(pending.claim, input.claim)) {
        const result = typeof input.result === 'string' ? input.result.slice(0, 12000) : '客户端未返回执行结果';
        runtime.respond(pending.rpcId, toolResult(input.success === true, { result }));
        const generation = pending.tool === 'heiyan_request_generation';
        append(conversation, { id: random(), role: 'notice', text: input.success === true ? generation ? '生成请求已提交，可在节点中查看进度。' : '画布修改已执行，可在画布中撤销。' : (generation ? '生成请求未执行：' : '画布修改未执行：') + result });
        conversation.pending = null; reply(200, { ok: true }); return;
      }
      throw fault('不支持此操作', 404);
    } catch (error) { if (!res.headersSent) reply(error.status || 503, { error: error.message || '连接器暂时不可用' }); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  server.on('close', () => runtime?.close());
  return { server, pairingCode, close: () => { runtime?.close(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}
