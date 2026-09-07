import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CodexRuntime } from '../server/codex-runtime.js';

function fixture(t, inventory = { data: [{ runtimeStatus: 'disabled', tools: {} }], nextCursor: null }) {
  const requests = [], launch = {};
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const emit = message => child.stdout.write(JSON.stringify(message) + '\n');
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    const message = JSON.parse(chunk.toString()); requests.push(message);
    const results = {
      initialize: { userAgent: 'fixture' },
      'config/read': { config: { mcp_servers: { 'exact.server-name': { url: 'do-not-forward', bearer_token: 'do-not-forward' } } } },
      'account/read': { account: { type: 'chatgpt' } },
      'thread/start': { thread: { id: 'test-thread' } },
      'mcpServerStatus/list': inventory,
      'model/list': { data: [{ id: 'gpt-test', model: 'gpt-test', displayName: 'GPT Test', description: 'Vision model', hidden: false, isDefault: true, inputModalities: ['text', 'image'], defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'medium', description: 'Balanced' }] }], nextCursor: null },
      'turn/start': { turn: { id: 'test-turn' } },
    };
    if (Object.hasOwn(results, message.method)) queueMicrotask(() => emit({ id: message.id, result: results[message.method] }));
    callback();
  } });
  child.kill = () => { child.killed = true; child.stdout.end(); child.stderr.end(); return true; };
  const runtime = new CodexRuntime({ cwd: 'empty-workspace', spawnProcess: (file, args, options) => { Object.assign(launch, { file, args, options }); return child; } });
  t.after(() => runtime.close());
  return { runtime, requests, child, launch, emit };
}
test('Codex wire handshake isolates inherited capabilities without account/config writes', async t => {
  const f = fixture(t); await f.runtime.ready;
  assert.equal(f.requests.some(r => r.method === 'thread/start'), false);
  const thread = await f.runtime.startThread();
  const start = f.requests.find(r => r.method === 'thread/start').params;
  assert.equal(start.approvalPolicy, 'never'); assert.equal(start.sandbox, 'read-only');
  // Preserve the dispatcher required by code_mode_only models, not system tools.
  assert.equal(start.config['features.code_mode_host'], true);
  assert.equal(start.config['features.code_mode'], undefined);
  for (const feature of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'computer_use', 'browser_use', 'image_generation']) assert.equal(start.config['features.' + feature], false);
  assert.deepEqual(start.environments, []); assert.deepEqual(start.selectedCapabilityRoots, []);
  assert.deepEqual(start.config.mcp_servers, { 'exact.server-name': { enabled: false } });
  assert.ok(!JSON.stringify(start).includes('do-not-forward'));
  assert.deepEqual(start.dynamicTools.map(t => t.name), ['heiyan_read_canvas', 'heiyan_edit_canvas', 'heiyan_request_generation']);
  assert.ok(start.dynamicTools.every(t => t.type === 'function'));
  assert.equal(f.requests.find(r => r.method === 'mcpServerStatus/list').params.threadId, thread);
  assert.equal(f.launch.options.shell, false); assert.equal(f.launch.options.windowsHide, true);
  await f.runtime.startTurn(thread, 'one message');
  assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1);
  assert.ok(f.requests.every(r => !['account/login/start', 'account/logout', 'config/value/write', 'config/batchWrite'].includes(r.method)));
});
test('a still-connected external tool fails closed before any model turn', async t => {
  const f = fixture(t, { data: [{ runtimeStatus: 'connected', tools: { unsafe: {} } }] });
  await assert.rejects(f.runtime.startThread(), /未成功隔离/);
  assert.equal(f.child.killed, true); assert.ok(!f.requests.some(r => r.method === 'turn/start'));
});
test('dynamic tool requests and result responses preserve RPC identity', async t => {
  const f = fixture(t); await f.runtime.ready;
  const events = []; f.runtime.on('message', event => events.push(event));
  f.emit({ id: 'tool-call-id', method: 'item/tool/call', params: { threadId: 'test-thread', turnId: 'test-turn', tool: 'heiyan_read_canvas', namespace: null, arguments: {} } });
  assert.equal(events[0].id, 'tool-call-id');
  f.runtime.respond(events[0].id, { success: true, contentItems: [{ type: 'inputText', text: '{}' }] });
  assert.equal(f.requests.at(-1).id, 'tool-call-id'); assert.equal(f.requests.at(-1).result.success, true);
});
test('model discovery and multimodal turn options follow the advertised catalog', async t => {
  const f = fixture(t); const models = await f.runtime.models();
  assert.deepEqual(models[0].inputModalities, ['text', 'image']);
  await f.runtime.startTurn('thread', 'look', { model: 'gpt-test', effort: 'medium', images: ['data:image/png;base64,YQ=='] });
  const turn = f.requests.findLast(request => request.method === 'turn/start').params;
  assert.equal(turn.model, 'gpt-test'); assert.equal(turn.effort, 'medium');
  assert.deepEqual(turn.input[1], { type: 'image', url: 'data:image/png;base64,YQ==', detail: 'high' });
});
