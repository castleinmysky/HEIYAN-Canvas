import { apiTransport } from './agent-api';
import type { AgentProject } from './agent-memory';
export type SearchDocument = { id: string; source: 'message' | 'node'; title: string; text: string; nodeIds?: string[]; role?: string };
export type SearchHit = SearchDocument & { excerpt: string; offset: number; score: number; match: 'keyword' | 'semantic' | 'both' };
export type SearchResult = { query: string; mode: 'hybrid' | 'keyword'; indexed: number; total: number; note?: string; hits: SearchHit[] };
export type SemanticProfile = { request?: typeof fetch; provider: 'official' | 'custom'; baseUrl: string; apiKey: string; model: string };
export type SearchChunk = { id: string; document: SearchDocument; text: string; offset: number };
export function projectDocuments(project: AgentProject, nodes: SearchDocument[] = []): SearchDocument[] {
  return [...nodes, ...project.messages.map(m => ({ id: m.id, source: 'message' as const, title: m.role === 'user' ? '你的原话' : m.role === 'assistant' ? 'Agent 回复' : '执行记录', text: m.text, role: m.role }))];
}
export function searchChunks(documents: SearchDocument[]): SearchChunk[] {
  const result: SearchChunk[] = [];
  for (const document of documents) {
    if (!document.text.trim() && !document.title.trim()) continue;
    for (let offset = 0; offset < Math.max(1, document.text.length); offset += 900) {
      result.push({ id: `${document.source}:${document.id}:${offset}`, document, text: document.title + '\n' + document.text.slice(offset, offset + 1000), offset });
    }
  }
  return result;
}
const terms = (text: string) => {
  const normal = text.normalize('NFKC').toLocaleLowerCase();
  const words = normal.match(/[a-z0-9_-]+|[\p{Script=Han}]+/gu) || [];
  return [...new Set(words.flatMap(word => /\p{Script=Han}/u.test(word) && word.length > 1 ? [...Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2)), word] : [word]))];
};
export function keywordRank(documents: SearchDocument[], query: string): SearchHit[] {
  const q = query.normalize('NFKC').trim().toLocaleLowerCase(), tokens = terms(q);
  if (!q) return [];
  return documents.map(document => {
    const text = `${document.id} ${document.title}\n${document.text}`.normalize('NFKC').toLocaleLowerCase();
    const exact = text.includes(q), matches = tokens.filter(t => text.includes(t));
    let offset = document.text.toLocaleLowerCase().indexOf(q);
    if (offset < 0) offset = Math.max(0, ...matches.map(t => document.text.toLocaleLowerCase().indexOf(t)).filter(n => n >= 0).slice(0, 1));
    offset = Math.max(0, offset - 100);
    return { ...document, excerpt: document.text.slice(offset, offset + 700), offset, score: (exact ? 10 : 0) + matches.length / Math.max(1, tokens.length), match: 'keyword' as const };
  }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score);
}
export function cosine(a: readonly number[] | Float32Array, b: readonly number[] | Float32Array) {
  if (a.length !== b.length) return -1;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}
export async function embedTexts(profile: SemanticProfile, texts: string[], signal: AbortSignal) {
  const response = await apiTransport({ ...profile, protocol: 'responses' }, { model: profile.model, input: texts, encoding_format: 'float' }, AbortSignal.any([signal, AbortSignal.timeout(60000)]), 'embeddings');
  const result = await response.json();
  if (!Array.isArray(result.data) || result.data.length !== texts.length) throw Error('服务未返回完整的语义向量。');
  const rows = [...result.data].sort((a, b) => a.index - b.index);
  if (rows.some((v, i) => v.index !== i || !Array.isArray(v.embedding) || !v.embedding.length || v.embedding.length > 8192 || !v.embedding.every(Number.isFinite)) || new Set(rows.map(v => v.embedding.length)).size !== 1) throw Error('服务返回的语义向量格式无效。');
  return { vectors: rows.map(v => new Float32Array(v.embedding)), tokens: result.usage?.total_tokens ?? result.usage?.prompt_tokens };
}
export class SemanticIndex {
  private profile: SemanticProfile | null = null;
  private vectors = new Map<string, { text: string; vector: Float32Array }>();
  private queries = new Map<string, Float32Array>();
  private generation = 0;
  configure(profile: SemanticProfile | null) { this.generation++; this.profile = profile; this.vectors.clear(); this.queries.clear(); }
  get configured() { return !!this.profile; }
  coverage(documents: SearchDocument[]) {
    const chunks = searchChunks(documents);
    return { indexed: chunks.filter(c => this.vectors.get(c.id)?.text === c.text).length, total: chunks.length };
  }
  async build(documents: SearchDocument[], signal: AbortSignal, onProgress: (indexed: number, total: number, tokens?: number) => void) {
    const profile = this.profile, generation = this.generation;
    if (!profile) throw Error('请先配置语义检索 API。');
    const chunks = searchChunks(documents), live = new Set(chunks.map(c => c.id));
    const fresh = new Map(chunks.map(c => [c.id, c.text]));
    for (const [id, cached] of this.vectors) if (!live.has(id) || cached.text !== fresh.get(id)) this.vectors.delete(id);
    // Keep the browser index bounded. Coverage is always shown; lexical search
    // still covers every current document, including unindexed material.
    const pending = chunks.filter(c => this.vectors.get(c.id)?.text !== c.text).slice(0, Math.max(0, 6000 - this.vectors.size));
    onProgress(this.coverage(documents).indexed, chunks.length);
    for (let at = 0; at < pending.length; at += 24) {
      if (signal.aborted || generation !== this.generation) throw Error('索引已停止。');
      const batch = pending.slice(at, at + 24), result = await embedTexts(profile, batch.map(c => c.text), signal);
      if (signal.aborted || generation !== this.generation) throw Error('索引已停止。');
      batch.forEach((c, i) => this.vectors.set(c.id, { text: c.text, vector: result.vectors[i] }));
      onProgress(this.coverage(documents).indexed, chunks.length, result.tokens);
    }
  }
  async search(documents: SearchDocument[], query: string, signal: AbortSignal): Promise<SearchResult> {
    const generation = this.generation;
    const lexical = keywordRank(documents, query), chunks = searchChunks(documents), coverage = this.coverage(documents);
    const fallback: SearchResult = { query, mode: 'keyword', ...coverage, hits: lexical.slice(0, 40) };
    if (!query.trim() || !this.profile || !coverage.indexed) return fallback;
    let vector = this.queries.get(query);
    try {
      if (!vector) { vector = (await embedTexts(this.profile, [query], signal)).vectors[0]; if (generation !== this.generation) throw Error('检索连接已变化，请重新检索。'); if (this.queries.size >= 64) this.queries.clear(); this.queries.set(query, vector); }
    } catch (e) { if (signal.aborted || generation !== this.generation) throw e; return { ...fallback, note: '语义服务暂不可用，已使用关键词检索。' }; }
    const semantic = chunks.map(c => ({ chunk: c, score: this.vectors.get(c.id)?.text === c.text ? cosine(vector!, this.vectors.get(c.id)!.vector) : -1 })).filter(c => c.score > .15).sort((a, b) => b.score - a.score);
    const fused = new Map<string, SearchHit>();
    lexical.slice(0, 80).forEach((hit, i) => fused.set(`${hit.source}:${hit.id}`, { ...hit, score: 1 / (30 + i) }));
    const seen = new Set<string>();
    for (const { chunk, score } of semantic) {
      const key = `${chunk.document.source}:${chunk.document.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const old = fused.get(key);
      fused.set(key, { ...chunk.document, excerpt: old?.excerpt || chunk.document.text.slice(chunk.offset, chunk.offset + 700), offset: old?.offset ?? chunk.offset,
        score: (old?.score || 0) + 1 / (30 + seen.size - 1) + score / 1000, match: old ? 'both' : 'semantic' });
      if (seen.size >= 80) break;
    }
    return { query, mode: 'hybrid', ...coverage, ...(coverage.indexed < coverage.total ? { note: '部分新增或修改内容尚未建立语义索引，关键词检索仍覆盖全部原文。' } : {}), hits: [...fused.values()].sort((a, b) => b.score - a.score).slice(0, 40) };
  }
}
export function serializeSearch(result: SearchResult, offset = 0, textOffset = 0) {
  const page = result.hits.slice(offset, offset + 12);
  return JSON.stringify({ query: result.query, mode: result.mode, indexed: result.indexed, totalChunks: result.total, note: result.note, total: result.hits.length,
    nextOffset: offset + page.length < result.hits.length ? offset + page.length : null,
    matches: page.map(({ text, ...hit }) => ({ ...hit, text: text.slice(textOffset, textOffset + 4500), textLength: text.length, nextTextOffset: textOffset + 4500 < text.length ? textOffset + 4500 : null })) });
}
