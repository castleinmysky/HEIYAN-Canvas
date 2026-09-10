import { useEffect, useState } from 'react';
import type { ApiProfile } from './agent-api';
import type { ProbeProgress } from './agent-capabilities';
export function AgentApiForm({ busy, testing, progress, connect, cancel }: { busy: boolean; testing: boolean; progress?: ProbeProgress | null; connect: (profile: ApiProfile) => Promise<boolean>; cancel: () => void }) {
  const [profile, setProfile] = useState<ApiProfile>({ provider: 'official', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '', protocol: 'responses', vision: false, effort: '', contextChars: 48000, contextTokens: 128000, outputTokens: 4096, stream: true, nativeCompaction: true, tokenBudget: 250000, callLimit: 24 });
  const patch = (value: Partial<ApiProfile>) => setProfile(p => ({ ...p, ...value }));
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!testing || !progress) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [testing, progress?.startedAt]);
  return <div className="agent-api-form">
    <label>API 来源<select disabled={busy} value={profile.provider} onChange={e => patch({ provider: e.target.value as ApiProfile['provider'], ...(e.target.value === 'official' ? { baseUrl: 'https://api.openai.com/v1', protocol: 'responses' } : {}) })}><option value="official">OpenAI 官方</option><option value="custom">自定义 / 中转 API</option></select></label>
    {profile.provider === 'custom' && <><label>API 地址<input disabled={busy} type="url" value={profile.baseUrl} onChange={e => patch({ baseUrl: e.target.value })} placeholder="https://你的服务地址/v1" /></label><label>接口协议<select disabled={busy} value={profile.protocol} onChange={e => patch({ protocol: e.target.value as ApiProfile['protocol'] })}><option value="responses">Responses</option><option value="chat">Chat Completions</option></select></label></>}
    <label>API Key<input disabled={busy} type="password" autoComplete="off" value={profile.apiKey} onChange={e => patch({ apiKey: e.target.value })} placeholder="仅在当前页面使用" /></label>
    <label>模型名称<input disabled={busy} value={profile.model} onChange={e => patch({ model: e.target.value })} placeholder="服务提供的完整模型名称" /></label>
    <div className="agent-settings-pair"><label>上下文上限 · token<input disabled={busy} type="number" min={8000} max={2000000} step={1000} value={profile.contextTokens} onChange={e => patch({ contextTokens: Number(e.target.value) })} /></label><label>单次输出预留 · token<input disabled={busy} type="number" min={512} max={128000} step={512} value={profile.outputTokens} onChange={e => patch({ outputTokens: Number(e.target.value) })} /></label></div>
    <p>上限请按所选模型的说明填写。支持时使用服务端输入计数，否则显示保守估算；图片与工具也计入预算。</p>
    <label>思考程度<select disabled={busy} value={profile.effort} onChange={e => patch({ effort: e.target.value })}><option value="">模型默认</option>{['low', 'medium', 'high', 'xhigh', 'max'].map(v => <option key={v}>{v}</option>)}</select></label>
    <label className="agent-api-check"><input disabled={busy} type="checkbox" checked={profile.vision} onChange={e => patch({ vision: e.target.checked })} />启用图片输入并检测实际看图能力</label>
    <label className="agent-api-check"><input disabled={busy} type="checkbox" checked={profile.stream} onChange={e => patch({ stream: e.target.checked })} />逐步显示回复</label>
    {profile.protocol === 'responses' && <label className="agent-api-check"><input disabled={busy} type="checkbox" checked={profile.nativeCompaction} onChange={e => patch({ nativeCompaction: e.target.checked })} />检测并优先使用原生上下文压缩</label>}
    <details><summary>辅助模型、语义检索与费用</summary><div className="agent-settings-fields">
      <label>摘要辅助模型（可选）<input disabled={busy} value={profile.helperModel || ''} onChange={e => patch({ helperModel: e.target.value })} placeholder="留空使用主模型" /></label>
      <label>语义检索模型（可选）<input disabled={busy} value={profile.embeddingModel || ''} onChange={e => patch({ embeddingModel: e.target.value })} placeholder="填写支持 embeddings 的模型名称" /></label>
      <p>检索模型使用同一 API 地址。连接后需在项目资料中建立文字索引；看图仍单独确认。</p>
      {([['input', '主模型输入'], ['output', '主模型输出'], ['cached', '缓存输入'], ['helperInput', '辅助模型输入'], ['helperOutput', '辅助模型输出']] as const).map(([key, label]) => <label key={key}>{label}单价 · USD / 百万 token<input disabled={busy} type="number" min={0} step="any" value={profile.prices?.[key] ?? ''} onChange={e => patch({ prices: { ...profile.prices, [key]: e.target.value === '' ? undefined : Number(e.target.value) } })} placeholder="可不填，仅统计 token" /></label>)}
      <p>单价由你填写，费用为估算；素材生成与语义索引单独计费。</p>
    </div></details>
    <p>密钥不写入会话，刷新后需重新填写。检测会发送少量测试请求，可能计费；模型名称和提供方不会自动更换。</p>
    <button type="button" disabled={busy || !profile.apiKey.trim() || !profile.model.trim()} onClick={async () => { if (await connect(profile)) patch({ apiKey: '' }); }}>{testing ? '正在逐项检测…' : '检测能力并连接'}</button>
    {testing && <button type="button" onClick={cancel}>取消连接检测</button>}
    {testing && progress && <p role="status">正在检测：{progress.label}<br /><span aria-live="off">已等待 {Math.max(0, Math.floor((now - progress.startedAt) / 1000))} 秒 · 本项最多 {Math.ceil(progress.timeoutMs / 1000)} 秒</span><br />{progress.optional ? '可选项超时会跳过，不影响已通过的基础连接。' : '基础工具调用须通过；超时会停止，不自动重试。'}</p>}
  </div>;
}
