const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const provided = params.get('key');
if (provided) { sessionStorage.setItem('heiyan-local-control', provided); history.replaceState(null, '', location.pathname); }
const secret = provided || sessionStorage.getItem('heiyan-local-control');
let stopped = false;
async function request(route) {
  const response = await fetch('/local/' + route, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret }, body: '{}', signal: AbortSignal.timeout(15000) });
  const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
}
async function refresh() {
  if (stopped) return;
  try {
    const state = await request('status');
    $('badge').textContent = state.paired ? '画布已连接' : '运行中';
    $('login-state').textContent = state.loggingIn ? '请在刚打开的官方页面完成登录。' : state.loggedIn ? '已检测到有效的 Codex 登录。' : '尚未登录。点击下方按钮，在官方页面使用自己的账号登录。';
    $('login').disabled = state.loggedIn || state.loggingIn || state.paired;
    $('login').textContent = state.loggedIn ? '已登录' : state.loggingIn ? '等待登录完成…' : '在官方页面登录';
    $('connect').disabled = !state.loggedIn || state.paired;
    $('connect-state').textContent = state.paired ? '已经有画布连接。请回到原画布继续；如需重新配对，先在原画布断开连接。' : '将打开 ' + state.site + '，连接地址和一次性配对码会自动填好。';
    if (state.error) $('error').textContent = state.error;
  } catch (error) { $('badge').textContent = '未连接'; $('login').disabled = true; $('connect').disabled = true; $('error').textContent = error.message || '连接器已停止，请重新双击启动脚本。'; }
  if (!stopped) setTimeout(refresh, 2500);
}
$('login').onclick = async () => { $('login').disabled = true; $('error').textContent = ''; try { await request('login'); } catch (error) { $('error').textContent = error.message; $('login').disabled = false; } };
$('connect').onclick = async () => { $('connect').disabled = true; $('error').textContent = ''; try { const result = await request('connect'); const target = new URL(result.url); if (!['https:', 'http:'].includes(target.protocol)) throw Error('连接地址无效'); location.assign(target.href); } catch (error) { $('error').textContent = error.message; $('connect').disabled = false; } };
$('stop').onclick = async () => { if (!confirm('停止连接器会结束当前 Agent 会话，但不会关闭其他 Codex 任务。继续吗？')) return; try { await request('stop'); stopped = true; for (const id of ['login','connect','stop']) $(id).disabled = true; $('badge').textContent = '已停止'; $('error').textContent = '可以关闭本页。'; } catch (error) { $('error').textContent = error.message; } };
refresh();
