import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AgentPanel, AgentResults, AssetVisual, type AgentPanelProps } from './AgentWorkbench';
import { assetKindForFile, canSendToAgent, nextAssetId, type CreativeAsset } from './types';
import { previewProfile, selectPreviewModel, previewSpecSummary } from './PreviewGenerationSettings';
import { GenerationRatioOption, GeneratorControlCardContent, generationRatioIconGeometry } from '../components/GeneratorControlPrimitives';

const assets: CreativeAsset[] = [
  { id: 'a', nodeId: 'node-a', kind: 'image', name: '森林', url: '/forest.png', sample: true },
  { id: 'b', nodeId: 'node-b', kind: 'video', name: '镜头', url: '/shot.mp4', sample: true },
  { id: 'c', nodeId: 'node-c', kind: 'audio', name: '配音', url: '/voice.wav', sample: true },
];
const props: AgentPanelProps = {
  connection: 'preview', messages: [], assets, stages: [], selectedId: 'a', draft: '做一部短片',
  modelLabel: '图像模型', ratio: '3:4', resolution: '1K',
  onDraft: vi.fn(), onSelect: vi.fn(), onLocate: vi.fn(), onEdit: vi.fn(), onClearReference: vi.fn(),
  onAttach: vi.fn(), onSettings: vi.fn(), onConnection: vi.fn(), onClose: vi.fn(),
};

describe('Agent preview safety and asset contracts', () => {
  it('uses the existing model profiles and normalizes incompatible settings', () => {
    const image = { model: 'gpt-image-2', ratio: '3:4', resolution: '1K', count: 4, duration: 5 };
    const video = selectPreviewModel('seedance-video', image);
    expect(video.ratio).toBe('3:4');
    expect(video.resolution).toBe(previewProfile('seedance-video').defaultResolution);
    expect(video.count).toBe(1);
    expect(previewSpecSummary(video)).toContain('5 秒');
    const model = selectPreviewModel('tripo3d-model', video);
    expect(model.ratio).toBe('Auto');
    expect(model.resolution).toBe('STANDARD');
    expect(previewSpecSummary(model)).toBe('标准 · 1 个');
  });
  it('shares node control markup and ratio geometry without importing its runtime', () => {
    const html = renderToStaticMarkup(<GeneratorControlCardContent icon="model" label="模型" value="GPT Image 2" expanded={false} />);
    expect(html).toContain('generator-control-card__copy');
    expect(html).toContain('<small>模型</small><strong>GPT Image 2</strong>');
    expect(generationRatioIconGeometry('3:4')).toMatchObject({ width: 12, height: 16, adaptive: false });
    expect(generationRatioIconGeometry('Auto').adaptive).toBe(true);
    expect(renderToStaticMarkup(<GenerationRatioOption ratio="21:9" />)).toContain('21:9');
    const nodes = readFileSync(resolve('src/components/CanvasNodes.tsx'), 'utf8');
    expect(nodes).toContain("import { GeneratorControlCardContent, GenerationRatioOption } from './GeneratorControlPrimitives'");
  });
  it.each(['preview', 'disconnected', 'connecting', 'error'] as const)('never executes a real command while %s', state => {
    expect(canSendToAgent(state, '生成视频', false)).toBe(false);
  });
  it('requires a connected, idle adapter and nonempty draft', () => {
    expect(canSendToAgent('connected', '生成视频', false)).toBe(true);
    expect(canSendToAgent('connected', '   ', false)).toBe(false);
    expect(canSendToAgent('connected', '生成视频', true)).toBe(false);
  });
  it('cycles stable asset IDs without mutating order', () => {
    const ids = assets.map(asset => asset.id);
    expect(nextAssetId(assets, 'a', -1)).toBe('c');
    expect(nextAssetId(assets, 'c', 1)).toBe('a');
    expect(nextAssetId(assets, 'missing', 1)).toBe('b');
    expect(nextAssetId([], 'a', 1)).toBeNull();
    expect(assets.map(asset => asset.id)).toEqual(ids);
  });
  it.each([
    ['scene.png', 'image/png', 'image'], ['shot.mp4', 'video/mp4', 'video'],
    ['voice.wav', 'audio/wav', 'audio'], ['prop.glb', '', 'model'], ['scene.GLTF', '', 'model'],
    ['script.md', 'text/markdown', 'text'], ['run.exe', 'application/octet-stream', null],
    ['web.svg', 'image/svg+xml', null],
  ])('classifies local file %s without pretending all assets are images', (name, type, expected) => {
    expect(assetKindForFile({ name, type })).toBe(expected);
  });
  it('does not put video or audio bytes in image elements', () => {
    expect(renderToStaticMarkup(<AssetVisual asset={assets[1]} />)).not.toContain('<img');
    expect(renderToStaticMarkup(<AssetVisual asset={assets[2]} />)).toContain('音频');
    expect(renderToStaticMarkup(<AssetVisual asset={{ ...assets[1], previewUrl: '/poster.png' }} />)).toContain('src="/poster.png"');
  });
  it('keeps result selection by stable ID and does not reorder downloads', () => {
    const html = renderToStaticMarkup(<AgentResults assets={assets} selectedId="b" onSelect={vi.fn()} onLocate={vi.fn()} onEdit={vi.fn()} />);
    expect(html).toContain('下载镜头');
    expect(html).toContain('href="/shot.mp4"');
    expect(html).toContain('aria-label="选择镜头" aria-pressed="true"');
  });
  it('requires an execution callback even when connection is marked connected', () => {
    const html = renderToStaticMarkup(<AgentPanel {...props} connection="connected" />);
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
  });
  it('labels preview honestly and only enables its separate preview callback', () => {
    const html = renderToStaticMarkup(<AgentPanel {...props} onPreviewDraft={vi.fn()} />);
    expect(html).toContain('预览发送指令（不执行生成）');
    expect(html).toContain('不连接 Codex，不消耗额度');
    expect(html).not.toMatch(/type="submit"[^>]*disabled=""/);
  });
  it('renders failure and disabled loading states without removing assets', () => {
    const html = renderToStaticMarkup(<AgentPanel {...props} busy error="执行失败" onPreviewDraft={vi.fn()} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('执行失败');
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('下载森林');
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
  });
  it('uses the real canvas and local store on the Agent route', () => {
    const bootstrap = readFileSync(resolve('src/trial-bootstrap.ts'), 'utf8');
    expect(bootstrap).not.toContain("=== '/agent-preview'");
    expect(bootstrap).toContain("'indexedDB' in window");
    expect(bootstrap).toContain('createTrialRequestBridge');
    const main = readFileSync(resolve('src/main.tsx'), 'utf8');
    expect(main).toContain("const App = lazy(() => import('./App'))");
    expect(main).not.toContain('<AgentPreview');
  });
  it('fixture module has no storage, network, task submission, or fake connected state', () => {
    const source = readFileSync(resolve('src/agent-workbench/AgentPreview.tsx'), 'utf8');
    expect(source).not.toMatch(/\bfetch\(|\blocalStorage\.|\bindexedDB\.|\/api\/v1/);
    expect(source).not.toContain("? 'connected'");
    expect(source).toContain('目前尚未实现');
    expect(source).toContain('不是成片');
  });
});
