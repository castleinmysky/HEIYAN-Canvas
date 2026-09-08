import { useEffect, useRef, useState } from 'react';
import type { SearchResult, SemanticProfile } from './agent-search';
export type AgentSearchProps = {
  search: (query: string, signal?: AbortSignal) => Promise<SearchResult>; focus: (id: string) => void; busy: boolean;
  indexState: { configured: boolean; building: boolean; indexed: number; total: number; tokens: number; error: string; service?: string };
  configure: (profile: SemanticProfile) => Promise<boolean>; clear: () => void; build: () => Promise<boolean>; stop: () => void;
};
export function AgentSearchPanel({ search, focus, indexState, configure, clear, build, stop, busy }: AgentSearchProps) {
  const [query, setQuery] = useState(''), [result, setResult] = useState<SearchResult | null>(null), [searching, setSearching] = useState(false), [error, setError] = useState('');
  const [profile, setProfile] = useState<SemanticProfile>({ provider: 'official', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  return <section className="agent-search-panel" aria-label="检索项目资料">
    <form onSubmit={async e => {
      e.preventDefault(); if (!query.trim()) return;
      controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
      setSearching(true); setError('');
      try { const value = await search(query, abort.signal); if (!abort.signal.aborted) setResult(value); }
      catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '检索失败'); }
      finally { if (controller.current === abort) setSearching(false); }
    }}><label>查找对话与画布<input value={query} maxLength={500} onChange={e => setQuery(e.target.value)} placeholder="例如：上次那个红衣角色" /></label><button type="submit" disabled={searching || !query.trim()}>{searching ? '正在检索…' : '查找资料'}</button></form>
    <details><summary>语义检索 · {indexState.configured ? `${indexState.indexed} / ${indexState.total} 段` : '未配置'}</summary>
      <p>关键词检索覆盖全部原文。语义检索可找到说法不同但含义相近的资料，需要向量 API；建立索引会发送本项目的节点文字与对话，不发送图片。</p>
      {!indexState.configured ? <div className="agent-settings-fields">
        <label>检索 API 来源<select value={profile.provider} onChange={e => setProfile(p => ({ ...p, provider: e.target.value as SemanticProfile['provider'] }))}><option value="official">OpenAI 官方</option><option value="custom">自定义 / 中转 API</option></select></label>
        {profile.provider === 'custom' && <label>API 地址<input type="url" value={profile.baseUrl} onChange={e => setProfile(p => ({ ...p, baseUrl: e.target.value }))} /></label>}
        <label>向量模型名称<input value={profile.model} onChange={e => setProfile(p => ({ ...p, model: e.target.value }))} placeholder="服务提供的 embeddings 模型" /></label>
        <label>检索 API Key<input type="password" autoComplete="off" value={profile.apiKey} onChange={e => setProfile(p => ({ ...p, apiKey: e.target.value }))} /></label>
        <button type="button" disabled={busy || !profile.model.trim() || !profile.apiKey.trim()} onClick={async () => { if (await configure(profile)) setProfile(p => ({ ...p, apiKey: '' })); }}>检测检索连接</button>
      </div> : <>
        <p>检索服务：{indexState.service}。已索引 {indexState.indexed} / {indexState.total} 段。本页索引最多 6000 段；有未索引内容时，关键词仍可检索。索引与密钥仅在当前页面保留。</p>
        {indexState.building ? <><progress value={indexState.indexed} max={Math.max(1, indexState.total)} /><button type="button" onClick={stop}>停止建立索引</button></> : <button type="button" disabled={busy} onClick={() => void build()}>建立 / 更新文字索引</button>}
        <button type="button" disabled={busy} onClick={clear}>移除检索连接与本页索引</button>
        {!!indexState.tokens && <p>建立索引已报告 {indexState.tokens.toLocaleString()} token；查询另有少量调用。</p>}
      </>}
      {indexState.error && <p role="alert">{indexState.error}</p>}
    </details>
    {error && <p role="alert">{error}</p>}
    {result && <><p>“{result.query}” · {result.mode === 'hybrid' ? '语义 + 关键词' : '关键词'} · {result.hits.length} 个结果{result.note ? `。${result.note}` : ''}</p>
      {result.hits.map(hit => <article key={hit.source + ':' + hit.id}><small>{hit.source === 'node' ? '画布节点' : hit.title} · {({ both: '语义与关键词匹配', semantic: '语义相近', keyword: '关键词匹配' })[hit.match]}</small>
        <p>{hit.excerpt || hit.title}</p>
        <button type="button" onClick={() => { if (hit.source === 'node') focus(hit.id); else { const element = document.getElementById('agent-message-' + hit.id); element?.scrollIntoView({ block: 'center', behavior: 'smooth' }); element?.focus({ preventScroll: true }); } }}>{hit.source === 'node' ? '定位节点：' + hit.title : '定位原始消息'}</button>
        <details><summary>查看完整原文</summary><p className="agent-search-original">{hit.text}</p></details>
      </article>)}
      {!result.hits.length && <p>没有找到相关原文，可以换个描述或更新语义索引。</p>}
    </>}
  </section>;
}
