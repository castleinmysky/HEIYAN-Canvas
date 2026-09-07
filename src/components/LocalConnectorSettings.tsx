import { useEffect, useRef, useState } from 'react';
import { UiIcon } from './UiIcon';
import type { CanvasInterfaceLanguage } from '../interface-language';
import { localConnectorUrl } from '../connector-address.js';
import './LocalConnectorSettings.css';

type RequestLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export function connectorErrorMessage(payload: { code?: string; error?: string; taskCount?: number }, status: number, en: boolean, remote: boolean) {
  if (en) return payload.error || 'Connection failed. Check the deployment machine.';
  if (payload.code === 'tasks_bound_to_original') return `有 ${payload.taskCount || 1} 个未结束的任务绑定原机器。请取消原任务后切换，旧任务不会在新机器重新提交。`;
  if (payload.code === 'cancellation_unconfirmed') return '无法确认原机器上的任务是否已取消。可重试取消，或仅结束本地等待后切换；原机器可能仍在执行。';
  if (payload.code === 'cancellation_pending') return '已请求取消，正在等待原机器确认。请稍后重新检查。';
  if (payload.code === 'connection_changed') return '其他标签页刚修改了连接，请重新检查后再连接。已完成的取消会保留在历史中。';
  if (payload.code === 'connector_update_required') return '连接器版本或模型数据不兼容，请更新部署包中的连接器后重试。';
  if (status === 409) return '部署端拒绝了连接，请确认启动的是当前解压包中的 ComfyUI，且端口未被其他安装占用。';
  if (status === 400) return '请检查 HTTPS 地址，并填写连接器显示的访问码。更换地址时需要重新填写访问码。';
  if (status === 401) return '访问码不正确，请从部署机器的配对页面重新复制。';
  return remote ? '远程连接未完成。请确认部署机器、ComfyUI 和临时通道正在运行，并使用当前的 HTTPS 地址与访问码。' : '连接未完成。请确认本机部署包和连接器均已启动、配对码正确，并允许浏览器访问本地网络。';
}
export function LocalConnectorSettings({ request, language, onModelsChanged }: { request: RequestLike; language: CanvasInterfaceLanguage; onModelsChanged: () => Promise<void> }) {
  const en = language === 'en';
  const [code, setCode] = useState('');
  const [state, setState] = useState({ enabled: false, modelCount: 0, baseUrl: localConnectorUrl });
  const [mode, setMode] = useState<'local' | 'remote'>('local');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [canCancelTasks, setCanCancelTasks] = useState(false);
  const [canStopWaiting, setCanStopWaiting] = useState(false);
  const [switchNotice, setSwitchNotice] = useState('');
  const cancelTasksRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!canCancelTasks) return;
    const frame = requestAnimationFrame(() => cancelTasksRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' }));
    return () => cancelAnimationFrame(frame);
  }, [canCancelTasks]);
  useEffect(() => { let mounted = true; void request('/api/v1/local-connector').then(r => r.json()).then(value => { if (mounted) { setState(value); if (value.baseUrl && value.baseUrl !== localConnectorUrl) { setMode('remote'); setAddress(value.baseUrl); } } }).catch(() => {}); return () => { mounted = false; }; }, [request]);
  const baseUrl = mode === 'local' ? localConnectorUrl : address.trim().replace(/\/$/, '');
  const unchanged = state.enabled && baseUrl === state.baseUrl;
  const update = async (disable = false, cancelOriginalTasks = false, stopWaitingIfUnavailable = false) => {
    setBusy(true); setError(''); setCanCancelTasks(false); setCanStopWaiting(false); setSwitchNotice('');
    try {
      const response = await request('/api/v1/local-connector', { method: disable ? 'DELETE' : 'POST', ...(disable ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, baseUrl, cancelOriginalTasks, stopWaitingIfUnavailable }) }) });
      const payload = await response.json();
      if (!response.ok) {
        setCanCancelTasks(['tasks_bound_to_original', 'cancellation_unconfirmed', 'cancellation_pending'].includes(payload.code));
        setCanStopWaiting(payload.code === 'cancellation_unconfirmed');
        throw new Error(connectorErrorMessage(payload, response.status, en, mode === 'remote'));
      }
      if (payload.unconfirmedTaskCount) setSwitchNotice(en ? 'Switched. Local waiting has ended, but remote cancellation is unconfirmed. Check the original machine. Old tasks will not be resubmitted.' : '已切换并结束本地等待，但无法确认远端取消，请检查原机器。旧任务不会重新提交。');
      else if (cancelOriginalTasks) setSwitchNotice(en ? 'Switched. Original tasks have ended; completed results and history are preserved.' : '已切换。原任务已结束，已有结果和历史记录均保留。');
      setState(current => ({ ...current, ...payload })); setCode(''); await onModelsChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : en ? 'Connection failed.' : '连接失败。'); }
    finally { setBusy(false); }
  };
  return <section className="local-connector-card" data-no-interface-translation>
    <header><span className="local-connector-symbol"><UiIcon name="comfy" /></span><div><h2>{en ? 'Connect ComfyUI' : '连接 ComfyUI'}</h2><p>{en ? 'Use the models and workflows in your HEIYAN deployment.' : '使用黑岩部署包中的模型与工作流。'}</p></div></header>
    <div className="connector-location" role="group" aria-label={en ? 'Deployment location' : '部署位置'}>{(['local', 'remote'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => { setMode(value); setCode(''); setError(''); setCanCancelTasks(false); }}><UiIcon name={value === 'local' ? 'home' : 'link'} />{value === 'local' ? en ? 'This computer' : '当前电脑' : en ? 'Another network' : '其他网络的机器'}</button>)}</div>
    {mode === 'local' ? <ol><li>{en ? 'Start ComfyUI from the deployment folder.' : '在部署包目录中启动 ComfyUI。'}</li><li>{en ? 'Run Start-Site-Connector, then open the pairing page.' : '运行 Start-Site-Connector，再打开配对页面。'} <a href="http://127.0.0.1:8289/" target="_blank" rel="noreferrer">{en ? 'Open pairing page' : '打开配对页面'} <span aria-hidden="true">↗</span></a></li><li>{en ? 'Paste the pairing code below and allow local network access when asked.' : '粘贴下方配对码，并在浏览器询问时允许本地网络访问。'}</li></ol> : <ol><li>{en ? 'On the deployment machine, start ComfyUI and Start-Remote-Connector.' : '在部署机器上启动 ComfyUI，再运行 Start-Remote-Connector。'}</li><li>{en ? 'On that machine, open 127.0.0.1:8289 and copy its HTTPS address and remote access code.' : '在部署机器上打开 127.0.0.1:8289，复制 HTTPS 地址和独立访问码。'}</li><li>{en ? 'Enter both below. The temporary address changes when the tunnel restarts.' : '在下方填写两项信息。临时通道重启后，地址会变化。'}</li></ol>}
    <form onSubmit={event => { event.preventDefault(); void update(); }}>
      {mode === 'remote' && <div className="connector-address"><label htmlFor="remote-comfy-address">{en ? 'HTTPS address' : 'HTTPS 地址'}</label><input id="remote-comfy-address" type="url" disabled={busy} required autoComplete="off" spellCheck={false} value={address} onChange={event => { setAddress(event.target.value); setCode(''); setCanCancelTasks(false); }} placeholder="https://…trycloudflare.com" /></div>}
      <label htmlFor="local-pair-code">{mode === 'remote' ? en ? 'Remote access code' : '远程访问码' : en ? 'Pairing code' : '配对码'}</label>
      <div className="local-connector-pair"><input id="local-pair-code" type="password" disabled={busy} autoComplete="off" spellCheck={false} value={code} onChange={event => { setCode(event.target.value); setCanCancelTasks(false); }} placeholder={unchanged ? en ? 'Saved only in this browser' : '仅保存在当前浏览器' : en ? 'Paste the code from the deployment machine' : '粘贴部署机器显示的访问码'} /><button type="submit" disabled={busy || (!unchanged && !code.trim()) || !baseUrl}>{busy ? en ? 'Connecting…' : '连接中…' : unchanged ? en ? 'Check connection' : '重新检查' : en ? 'Connect' : '连接'}</button></div>
    </form>
    <div className="local-connector-status" role="status"><span className={state.enabled ? 'is-paired' : ''}>{state.enabled ? en ? `${state.modelCount} ComfyUI models connected` : `已接入 ${state.modelCount} 个 ComfyUI 模型` : en ? 'Not connected' : '未连接'}</span>{state.enabled && <button type="button" disabled={busy} onClick={() => void update(true)}>{en ? 'Disable on canvas' : '在画布中停用'}</button>}</div>
    {error && <p className="local-connector-error" role="alert">{error}</p>}
    {canCancelTasks && <div ref={cancelTasksRef} className="connector-keep-tasks"><p>{en ? 'Cancel unfinished tasks on the original machine, then use the selected deployment. Completed results and history are kept.' : '取消原机器的未完成任务后，使用本次选择的部署。已有生成结果和历史记录不会删除。'}</p><button type="button" disabled={busy} onClick={() => void update(false, true)}>{en ? 'Cancel original tasks and switch' : '取消原任务并切换'}</button>{canStopWaiting && <button type="button" disabled={busy} onClick={() => void update(false, true, true)}>{en ? 'End local waiting and switch (remote cancellation unconfirmed)' : '仅结束本地等待并切换（远端取消未确认）'}</button>}</div>}
    {switchNotice && <p className="connector-retained-notice" role="status">{switchNotice}</p>}
    <footer>{mode === 'remote' && <p>{en ? 'Temporary tunnels are for testing, not an always-on service. Cloudflare forwards prompts, reference files and results. Keep the access code private.' : '临时通道用于试用，不保证长期在线。提示词、参考素材和生成结果会经 Cloudflare 转发，请勿公开访问码。'}</p>}{en ? 'Choose models, LoRAs and capabilities on the canvas. Keep the deployment machine, ComfyUI and connector running. Refreshing the page does not cancel submitted jobs; disabling models does not stop jobs or shut down the remote service. Cloud APIs are unchanged.' : '模型、LoRA 和具体能力仍在画布内选择。保持部署机器、ComfyUI 和连接器运行，刷新不会取消已提交任务；停用模型不会取消任务或关闭远程服务。云 API 不受影响。'}</footer>
  </section>;
}
