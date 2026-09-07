import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { createAgentConnector } from '../server/agent-connector.js';
import { validateAgentTool, sanitizeAgentContext } from '../server/agent-contract.js';

const origin = 'http://127.0.0.1:5201';
const context = { revision: 'rev-a', nodes: [], edges: [], referenceIds: [] };
class FakeRuntime extends EventEmitter {
  constructor() { super(); this.closed = false; this.ready = Promise.resolve({ type: 'chatgpt' }); this.calls = []; this.responses = []; this.serial = 0; }
  account() { return Promise.resolve({ type: 'chatgpt' }); }
  async startThread() { return 'thread-' + ++this.serial; }
  async startTurn(threadId, text) { this.calls.push({ threadId, text }); return { turn: { id: 'turn-' + this.calls.length } }; }
  request(method, params) { this.calls.push({ method, params }); return Promise.resolve({}); }
  respond(id, result) { this.responses.push({ id, result }); }
  deny(id) { this.responses.push({ id, denied: true }); }
  close() { this.closed = true; this.emit('disconnected', 'closed'); }
  tool(tool, args = {}, threadId = 'thread-1') { this.emit('message', { id: this.responses.length + 10, method: 'item/tool/call', params: { threadId, turnId: 'turn-1', tool, arguments: args, namespace: null } }); }
}
async function fixture(t) {
  const runtime = new FakeRuntime();
  const connector = createAgentConnector({ origin, runtimeFactory: () => runtime, pairingCode: 'test-code' });
  await new Promise(resolve => connector.server.listen(0, '127.0.0.1', resolve));
  t.after(() => connector.close());
  const base = `http://127.0.0.1:${connector.server.address().port}`;
  let token = '';
  const call = async (path, value = {}, extra = {}) => {
    const response = await fetch(base + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(value) });
    return { status: response.status, data: await response.json() };
  };
  const pair = async () => { const result = await call('/pair', { code: 'test-code' }); token = result.data.token; return result; };
  const send = (canvasKey = 'task-a:main', requestId = 'request-a') => call('/send', { canvasKey, requestId, text: '规划一个角色', context });
  return { runtime, connector, call, pair, send, base };
}
test('pairing is required, origin and Host are checked, no account login surface', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/state', { canvasKey: 'a' })).status, 401);
  assert.equal((await f.call('/pair', { code: 'test-code' }, { Origin: 'https://evil.test' })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    const request = http.request(f.base + '/pair', { method: 'POST', headers: { Host: 'evil.test', Origin: origin, 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', error => error.code === 'ECONNRESET' ? resolve('connection-denied') : reject(error)); request.end(JSON.stringify({ code: 'test-code' }));
  });
  assert.ok([403, 'connection-denied'].includes(badHostStatus));
  assert.equal((await f.call('/pair', { code: 'wrong' })).status, 401);
  assert.equal((await f.pair()).status, 200);
  assert.equal((await f.call('/account/login', { canvasKey: 'a' })).status, 409);
  assert.equal(f.runtime.calls.length, 0);
});
test('pairing does not create a model turn; sends are idempotent and canvases isolated', async t => {
  const f = await fixture(t); await f.pair();
  assert.equal(f.runtime.calls.length, 0);
  await f.send(); await f.send();
  assert.equal(f.runtime.calls.length, 1);
  assert.equal((await f.send('task-a:main', 'different')).status, 409);
  const other = await f.call('/state', { canvasKey: 'task-b:main' });
  assert.deepEqual(other.data.messages, []);
  assert.equal(other.data.pending, null);
  assert.equal((await f.call('/state', { canvasKey: 'task-a:main' })).data.messages[0].role, 'user');
});
test('canvas reads return current sanitized data, not stale send snapshots', async t => {
  const f = await fixture(t); await f.pair(); await f.send(); f.runtime.tool('heiyan_read_canvas');
  const { data } = await f.call('/state', { canvasKey: 'task-a:main' });
  await f.call('/read', { canvasKey: 'task-a:main', id: data.pending.id, context: { ...context, revision: 'rev-b', apiKey: 'do-not-send' } });
  const output = JSON.parse(f.runtime.responses[0].result.contentItems[0].text);
  assert.equal(output.revision, 'rev-b'); assert.equal(output.apiKey, undefined);
});
test('editing requires confirmation, rejects stale/cross-canvas IDs, claims execute only once', async t => {
  const f = await fixture(t); await f.pair(); await f.send();
  f.runtime.tool('heiyan_edit_canvas', { summary: '创建文本', operations: [{ action: 'create', id: 'x', kind: 'text', title: '故事', prompt: '开始' }] });
  const { data } = await f.call('/state', { canvasKey: 'task-a:main' });
  assert.equal(f.runtime.responses.length, 0);
  assert.equal((await f.call('/decision', { canvasKey: 'b', id: data.pending.id, approved: true, revision: 'rev-a' })).status, 409);
  const decision = { canvasKey: 'task-a:main', id: data.pending.id, approved: true, revision: 'rev-a' };
  const claims = await Promise.all([f.call('/decision', decision), f.call('/decision', decision)]);
  assert.deepEqual(claims.map(x => x.status).sort(), [200, 409]);
  const claim = claims.find(x => x.status === 200).data.claim;
  assert.equal((await f.call('/result', { ...decision, claim: 'bad', success: true, result: 'done' })).status, 404);
  assert.equal((await f.call('/result', { ...decision, claim, success: true, result: 'created text' })).status, 200);
  assert.equal((await f.call('/decision', decision)).status, 409);
  assert.equal(f.runtime.responses[0].result.success, true);
});
test('stale revisions and rejection return tool failure without applying anything', async t => {
  const f = await fixture(t); await f.pair(); await f.send();
  for (const input of [{ approved: true, revision: 'changed' }, { approved: false, revision: 'rev-a' }]) {
    f.runtime.tool('heiyan_edit_canvas', { summary: '修改', operations: [{ action: 'update', id: 'x', title: '标题' }] });
    const { data } = await f.call('/state', { canvasKey: 'task-a:main' });
    assert.equal((await f.call('/decision', { canvasKey: 'task-a:main', id: data.pending.id, ...input })).data.execute, false);
  }
  assert.ok(f.runtime.responses.every(item => item.result.success === false));
});
test('generation always pauses for approval and reports a single claimed execution', async t => {
  const f = await fixture(t); const pair = await f.pair(); await f.send();
  assert.equal(pair.data.protocol, 2);
  assert.ok(pair.data.capabilities.includes('request_generation'));
  f.runtime.tool('heiyan_request_generation', { summary: '生成两个镜头', nodeIds: ['shot-a', 'shot-b'] });
  const { data } = await f.call('/state', { canvasKey: 'task-a:main' });
  assert.equal(data.pending.tool, 'heiyan_request_generation');
  assert.deepEqual(data.pending.input.nodeIds, ['shot-a', 'shot-b']);
  const approved = await f.call('/decision', { canvasKey: 'task-a:main', id: data.pending.id, approved: true, revision: 'rev-a' });
  assert.equal(approved.data.execute, true);
  assert.equal((await f.call('/decision', { canvasKey: 'task-a:main', id: data.pending.id, approved: true, revision: 'rev-a' })).status, 409);
  assert.equal((await f.call('/result', { canvasKey: 'task-a:main', id: data.pending.id, claim: approved.data.claim, success: true, result: 'submitted' })).status, 200);
  assert.equal(f.runtime.responses[0].result.success, true);
});
test('unsupported tools are refused, stopping cancels a pending edit, disconnect revokes access', async t => {
  const f = await fixture(t); await f.pair(); await f.send();
  f.runtime.tool('heiyan_delete_everything', {});
  assert.equal(f.runtime.responses[0].result.success, false);
  f.runtime.emit('message', { id: 100, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1' } });
  assert.ok(f.runtime.responses.at(-1).denied);
  f.runtime.tool('heiyan_edit_canvas', { summary: '修改', operations: [{ action: 'update', id: 'x', title: '标题' }] });
  assert.equal((await f.call('/stop', { canvasKey: 'task-a:main' })).data.pending, null);
  assert.equal(f.runtime.calls.at(-1).method, 'turn/interrupt');
  await f.call('/disconnect');
  assert.equal((await f.call('/state', { canvasKey: 'task-a:main' })).status, 401);
});
test('contract strips provider secrets and limits allowed edit fields', () => {
  const safe = sanitizeAgentContext({ ...context, secret: 'key', nodes: [{ id: 'a', kind: 'imageGenerator', title: 'a', mediaUrl: 'private', apiKey: 'key' }] });
  assert.equal(safe.nodes[0].mediaUrl, undefined); assert.equal(safe.nodes[0].apiKey, undefined);
  for (const patch of [{ modelId: 'other' }, { mediaUrl: 'private' }, { kind: 'imageGenerator' }]) assert.throws(() => validateAgentTool('heiyan_edit_canvas', { summary: '修改', operations: [{ action: 'update', id: 'a', ...patch }] }));
  assert.throws(() => sanitizeAgentContext({ ...context, nodes: [null] }), /有效/);
  assert.throws(() => sanitizeAgentContext({ ...context, edges: [{ source: 'a' }] }), /有效/);
});
test('late requests and deltas from a stopped turn cannot affect a newer turn', async t => {
  const f = await fixture(t); await f.pair(); await f.send();
  await f.call('/stop', { canvasKey: 'task-a:main' });
  await f.send('task-a:main', 'new-turn');
  f.runtime.tool('heiyan_edit_canvas', { summary: '旧方案', operations: [{ action: 'create', id: 'old', kind: 'text', title: '旧标题' }] });
  f.runtime.emit('message', { method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'old', delta: '旧回复' } });
  f.runtime.emit('message', { method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  const { data } = await f.call('/state', { canvasKey: 'task-a:main' });
  assert.equal(data.pending, null); assert.equal(data.active, true);
  assert.ok(f.runtime.responses.at(-1).denied);
  assert.ok(!data.messages.some(m => m.id === 'old'));
});
