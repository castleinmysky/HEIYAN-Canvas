import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, Handle, Position, ReactFlow, applyNodeChanges, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import { UiIcon } from '../components/UiIcon';
import { useMobileCanvas } from '../mobile-canvas';
import { AgentPanel, AgentWorkbench, AssetVisual, WorkbenchDialog } from './AgentWorkbench';
import { assetKindForFile, type AgentConnection, type ConversationMessage, type CreativeAsset, type CreativeStage } from './types';
import { modelPresentation } from '../model-settings-catalog';
import { PreviewModelMenu, PreviewSpecMenu, previewModel, previewSpecSummary, type PreviewGeneration } from './PreviewGenerationSettings';
import { AgentPromptEditor, AgentPresetPicker, CanvasReferencePicker } from './AgentPromptEditor';
import { emptyPromptDraft, insertCanvasReference, type TextRange } from './prompt-draft';
import { resolvePromptTokenSelectionTags } from '../components/PromptTokenComposer';
import { supportsNegativePromptTokens } from '../prompt-token-library';

// Fixtures never enter the production canvas store, task API, or generation history.
export const sampleAssets: CreativeAsset[] = [
  { id: 'forest', nodeId: 'sample-forest', kind: 'image', name: '薄雾森林', url: '/agent-preview/forest.png', width: 1086, height: 1448, sample: true },
  { id: 'desert', nodeId: 'sample-desert', kind: 'image', name: '沙海遗迹', url: '/agent-preview/desert.png', width: 1086, height: 1448, sample: true },
  { id: 'snow', nodeId: 'sample-snow', kind: 'image', name: '雪山月色', url: '/agent-preview/snow.png', width: 1086, height: 1448, sample: true },
];
const referenceAsset: CreativeAsset = { ...sampleAssets[0], id: 'reference', nodeId: 'sample-reference', name: '角色参考' };
const sampleMessages: ConversationMessage[] = [
  { id: 'sample-request', role: 'user', text: '保留这个人物，生成三种不同背景。', reference: referenceAsset, sample: true },
  { id: 'sample-response', role: 'assistant', text: '三个场景已完成，人物特征保持一致。', sample: true },
];
const imageStages: CreativeStage[] = [
  { id: 'reference', title: '读取角色参考', state: 'ready', detail: '示例：锁定人物、服装与画风。' },
  { id: 'nodes', title: '创建并连接节点', state: 'ready', detail: '示例：森林、遗迹、雪山三个场景。' },
  { id: 'images', title: '生成场景素材', state: 'ready', detail: '展示预先准备的 3 张示例图，不是真实任务。' },
];
const filmStages: CreativeStage[] = [
  { id: 'script', title: '剧本与分镜', state: 'pending', detail: '确定镜头内容、节奏与时长。' },
  { id: 'assets', title: '角色与场景素材', state: 'ready', detail: '已载入 3 张示例素材；不是成片。' },
  { id: 'shots', title: '镜头视频', state: 'pending', detail: '后续接入视频节点生成与镜头连续性检查。' },
  { id: 'sound', title: '配音、音效与音乐', state: 'pending', detail: '后续接入音频节点与声音时间线。' },
  { id: 'edit', title: '剪辑与成片导出', state: 'pending', detail: '后续接入剪辑合成、字幕与导出；目前尚未实现。' },
];
type PreviewNode = Node<{ asset: CreativeAsset; isReference?: boolean }, 'previewAsset'>;
function PreviewAssetNode({ data, selected }: NodeProps<PreviewNode>) {
  return <div className={`aw-media-node${selected ? ' is-selected' : ''}`}>
    <header className="aw-node-title"><UiIcon name={data.asset.kind === 'image' ? 'image' : data.asset.kind === 'model' ? 'model3d' : data.asset.kind} /><strong>{data.asset.name}</strong><small>{data.asset.kind === 'image' ? '3:4 · 示例' : '本页素材'}</small></header>
    <AssetVisual asset={data.asset} />
    {!data.isReference && <Handle type="target" position={Position.Left} isConnectable={false} />}
    {data.isReference && <Handle type="source" position={Position.Right} isConnectable={false} />}
  </div>;
}
const nodeTypes = { previewAsset: PreviewAssetNode };
const initialNodes: PreviewNode[] = [
  { id: referenceAsset.nodeId, type: 'previewAsset', position: { x: 100, y: 225 }, style: { width: 192, height: 256 }, data: { asset: referenceAsset, isReference: true } },
  ...sampleAssets.map((asset, index): PreviewNode => ({ id: asset.nodeId, type: 'previewAsset', position: { x: 505, y: index * 292 }, style: { width: 180, height: 240 }, data: { asset }, selected: index === 0 })),
];
const initialEdges: Edge[] = sampleAssets.map(asset => ({ id: `reference-${asset.id}`, source: referenceAsset.nodeId, target: asset.nodeId, type: 'default' }));
type PreviewDialog = 'generation' | 'models' | 'reference' | 'references' | 'presets' | 'connection' | 'history' | 'settings' | 'text' | null;

export default function AgentPreview() {
  const [theme, setTheme] = useState<'night' | 'day'>('night');
  const [view, setView] = useState<'chat' | 'canvas'>('chat');
  const [panelOpen, setPanelOpen] = useState(true);
  const [nodes, setNodes] = useState<PreviewNode[]>(initialNodes);
  const [selectedId, setSelectedId] = useState('forest');
  const [reference, setReference] = useState<CreativeAsset | undefined>(referenceAsset);
  const [prompt, setPrompt] = useState(() => ({ ...emptyPromptDraft(), references: [{ token: '图片1', asset: referenceAsset }], nextReference: 2 }));
  const draft = prompt.text;
  const setDraft = (text: string) => setPrompt(current => ({ ...current, text }));
  const [pickingReference, setPickingReference] = useState(false);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const promptSelection = useRef<TextRange>({ start: 0, end: 0 });
  const [messages, setMessages] = useState(sampleMessages);
  const [dialog, setDialog] = useState<PreviewDialog>(null);
  const [generation, setGeneration] = useState<PreviewGeneration>({ model: 'gpt-image-2', ratio: '3:4', resolution: '1K', count: 1, duration: 5 });
  const [filmPlan, setFilmPlan] = useState(false);
  const [statePreview, setStatePreview] = useState<'ready' | 'empty' | 'loading' | 'error' | 'disconnected'>('ready');
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [textDraft, setTextDraft] = useState('');
  const [touchSelecting, setTouchSelecting] = useState(false);
  const flow = useRef<ReactFlowInstance<PreviewNode, Edge> | null>(null);
  const canvasElement = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const pendingFocus = useRef<string | null>(null);
  const viewport = useMobileCanvas();
  const mobile = viewport.width < 960;
  const currentModel = previewModel(generation.model);
  const promptTags = resolvePromptTokenSelectionTags(currentModel.adapter, prompt.promptTokenIds, supportsNegativePromptTokens(currentModel.adapter) ? prompt.negativePromptTokenIds : [], currentModel.capability);
  const positiveDraft = [draft.trim(), promptTags.filter(tag => tag.scope === 'positive').map(tag => tag.value).join('，')].filter(Boolean).join('\n');
  const canvasAssets = useMemo(() => nodes.map(node => node.data.asset), [nodes]);
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = () => reduceMotion() ? 0 : 240;

  useEffect(() => {
    const oldTitle = document.title;
    document.title = '黑岩画布 · Agent 交互预览';
    return () => { document.title = oldTitle; urls.current.forEach(url => URL.revokeObjectURL(url)); };
  }, []);
  const fit = useCallback(() => {
    if (flow.current) void flow.current.fitView({ padding: .16, maxZoom: 1.2, duration: reduceMotion() ? 0 : 240 });
  }, []);
  useEffect(() => {
    const element = canvasElement.current;
    if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver(entries => {
      if (entries[0].contentRect.width < 1 || entries[0].contentRect.height < 1 || pendingFocus.current) return;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(fit);
    });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [fit]);
  useEffect(() => {
    if (view !== 'canvas' && mobile) return;
    const id = pendingFocus.current;
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      const node = flow.current?.getNode(id);
      if (node) void flow.current?.fitView({ nodes: [node], padding: .3, maxZoom: 1.1, duration: duration() });
      pendingFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [view, mobile, selectedId]);
  const selectAsset = (id: string) => {
    setSelectedId(id);
    setNodes(current => current.map(node => ({ ...node, selected: node.data.asset.id === id })));
  };
  const locate = (asset: CreativeAsset) => {
    selectAsset(asset.id);
    setView('canvas');
    if (mobile && view !== 'canvas') pendingFocus.current = asset.nodeId;
    else { const node = flow.current?.getNode(asset.nodeId); if (node) void flow.current?.fitView({ nodes: [node], padding: .3, maxZoom: 1.1, duration: duration() }); }
  };
  const quoteAssets = (assets: CreativeAsset[]) => {
    let next = prompt, range = promptSelection.current, issue = '';
    for (const asset of assets) {
      const result = insertCanvasReference(next, asset, range);
      next = result.draft; range = { start: result.caret, end: result.caret }; issue = result.error;
      if (issue) break;
    }
    setPrompt(next); promptSelection.current = range; setError(issue);
    setDialog(null); setPickingReference(false); setView('chat'); setPanelOpen(true);
    requestAnimationFrame(() => { promptInput.current?.focus({ preventScroll: true }); promptInput.current?.setSelectionRange(range.start, range.end); });
  };
  const edit = (asset: CreativeAsset) => {
    // Quoting a result must not overwrite an instruction already being written.
    quoteAssets([asset]);
  };
  useEffect(() => {
    if (!pickingReference) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPickingReference(false); setView('chat'); } };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [pickingReference]);
  const assets = statePreview === 'empty' || statePreview === 'loading' ? [] : sampleAssets;
  const connection: AgentConnection = statePreview === 'disconnected' ? 'disconnected' : 'preview';
  const stages = statePreview === 'empty' ? [] : statePreview === 'loading'
    ? imageStages.map((stage, index): CreativeStage => ({ ...stage, state: index === 0 ? 'ready' : index === 1 ? 'running' : 'pending', detail: index === 1 ? '演示执行状态，未发起真实任务。' : stage.detail }))
    : statePreview === 'error' ? imageStages.map((stage, index): CreativeStage => ({ ...stage, state: index < 2 ? 'ready' : 'error', detail: index === 2 ? '演示错误，既有素材仍保留。' : stage.detail }))
    : filmPlan ? filmStages : imageStages;
  const visibleMessages = useMemo(() => statePreview === 'empty' ? [] : statePreview === 'loading' || statePreview === 'error'
    ? [sampleMessages[0], { id: `sample-${statePreview}`, role: 'assistant' as const, sample: true, text: statePreview === 'loading' ? '示例：正在准备节点与素材，执行进度会显示在下方。' : '示例：任务未完成，已保留原有素材。' }]
    : filmPlan ? [
      { ...sampleMessages[0], text: '围绕这个角色，制作一部冒险短片。' },
      { ...sampleMessages[1], text: '先梳理剧本和分镜，再准备场景、镜头与声音。素材齐备后，还需要剪辑成片。' },
      ...messages.slice(sampleMessages.length),
    ] : messages, [statePreview, messages, filmPlan]);
  const busy = statePreview === 'loading';
  const shownError = error || (statePreview === 'error' ? '演示错误：执行服务未连接。请检查连接后重试，原有素材不会被删除。' : '');
  const addAsset = (asset: CreativeAsset) => {
    setNodes(current => [...current, { id: asset.nodeId, type: 'previewAsset', position: { x: 30 + current.length * 36, y: 140 + current.length * 30 }, style: { width: 192, height: 256 }, data: { asset, isReference: true } }]);
    quoteAssets([asset]);
  };
  const attachment = async (file?: File) => {
    if (!file) return;
    const kind = assetKindForFile(file);
    if (!kind) { setError('暂不支持此格式。请选择图片、视频、音频、GLB/GLTF 或文本文件。'); return; }
    if (file.size > 25 * 1024 * 1024) { setError('预览素材需小于 25 MB。请选择较小文件；本页不会上传任何素材。'); return; }
    const id = crypto.randomUUID();
    const asset: CreativeAsset = { id, nodeId: `preview-${id}`, name: file.name, kind };
    try {
      if (kind === 'text') asset.text = (await file.text()).slice(0, 8000);
      else { asset.url = URL.createObjectURL(file); urls.current.push(asset.url); }
      addAsset(asset);
    } catch { setError('无法读取这个文件。请重新选择素材，现有节点不受影响。'); }
  };
  const sendPreview = () => {
    if (!positiveDraft || busy || connection !== 'preview') return;
    const text = [positiveDraft, promptTags.some(tag => tag.scope === 'negative') ? `排除：${promptTags.filter(tag => tag.scope === 'negative').map(tag => tag.value).join('，')}` : ''].filter(Boolean).join('\n');
    setMessages(current => [...current, { id: crypto.randomUUID(), role: 'user', text, references: prompt.references }, { id: crypto.randomUUID(), role: 'assistant', text: '演示：指令与节点引用已记录在本页。真实 Codex 执行尚未接入，不会产生生成任务或费用。' }]);
    setPrompt({ ...emptyPromptDraft(), nextReference: prompt.nextReference }); promptSelection.current = { start: 0, end: 0 }; setStatePreview('ready');
  };
  const canvas = <div ref={canvasElement} style={{ width: '100%', height: '100%' }}>
    <ReactFlow<PreviewNode, Edge> nodes={nodes} edges={initialEdges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .16 }} minZoom={.15} maxZoom={2}
      onInit={instance => { flow.current = instance; fit(); }} onNodesChange={changes => setNodes(current => applyNodeChanges(changes, current))}
      onNodeClick={(_, node) => { if (pickingReference) quoteAssets([node.data.asset]); else selectAsset(node.data.asset.id); }} onMove={(_, next) => setZoom(next.zoom)} nodesConnectable={false} edgesReconnectable={false}
      panOnDrag={mobile ? !touchSelecting : [1]} selectionOnDrag={mobile ? touchSelecting : true} deleteKeyCode={null} zoomOnDoubleClick={false}>
      <Background variant={BackgroundVariant.Dots} gap={32} size={1} color="var(--aw-dot)" />
    </ReactFlow>
    {pickingReference && <div className="aw-pick-banner" role="status"><span>点击要引用的节点</span><button type="button" onClick={() => { setPickingReference(false); setView('chat'); }}>取消</button></div>}
    <nav className="aw-node-tools" aria-label="画布工具"><button type="button" className="aw-icon-button" aria-label={touchSelecting ? '切换拖动画布' : '切换框选节点'} aria-pressed={touchSelecting} onClick={() => setTouchSelecting(value => !value)}><UiIcon name="view" /></button><button type="button" className="aw-icon-button" aria-label="添加素材节点" onClick={() => input.current?.click()}><UiIcon name="add" /></button><button type="button" className="aw-icon-button" aria-label="添加文本节点" onClick={() => setDialog('text')}><UiIcon name="text" /></button><button type="button" className="aw-icon-button" aria-label="打开制作计划" onClick={() => { setFilmPlan(true); setPanelOpen(true); setView('chat'); }}><UiIcon name="comfy" /></button></nav>
    <div className="aw-canvas-controls"><div className="aw-zoom-group"><button type="button" aria-label="缩小画布" onClick={() => void flow.current?.zoomOut({ duration: duration() })}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="放大画布" onClick={() => void flow.current?.zoomIn({ duration: duration() })}>+</button></div><button type="button" className="aw-icon-button" onClick={fit} aria-label="适应所有节点"><UiIcon name="fit" /></button></div>
    <button type="button" className="aw-mobile-edit" onClick={() => edit(nodes.find(node => node.data.asset.id === selectedId)?.data.asset || sampleAssets[0])}>引用节点</button>
  </div>;
  const panel = <AgentPanel connection={connection} messages={visibleMessages} assets={assets} stages={stages} selectedId={selectedId} reference={reference} draft={positiveDraft} busy={busy} error={shownError}
    modelLabel={modelPresentation(previewModel(generation.model)).name} ratio={generation.ratio} resolution={generation.resolution} specSummary={previewSpecSummary(generation)} onDraft={setDraft} onSelect={selectAsset} onLocate={locate} onEdit={edit}
    onModel={() => setDialog('models')} onReference={() => setDialog('reference')}
    onQuoteNodes={() => setDialog('references')} onPresets={() => setDialog('presets')}
    referenceCount={prompt.references.length} presetCount={promptTags.length}
    promptEditor={<AgentPromptEditor value={prompt} assets={canvasAssets} onChange={setPrompt} onPreview={asset => { setReference(asset); setDialog('reference'); }} inputRef={promptInput} selection={promptSelection} adapter={currentModel.adapter} target={currentModel.capability} />}
    onClearReference={() => setReference(undefined)} onAttach={() => input.current?.click()} onSettings={() => setDialog('generation')} onConnection={() => setDialog('connection')}
    onClose={() => { setPanelOpen(false); setView('canvas'); }} onPreviewDraft={sendPreview} />;

  return <AgentWorkbench canvas={canvas} panel={panel} project={filmPlan ? '短片创作' : '角色场景探索'} theme={theme} onTheme={() => setTheme(value => value === 'night' ? 'day' : 'night')}
    onHistory={() => setDialog('history')} onSettings={() => setDialog('settings')} mobileView={view} onMobileView={setView} panelOpen={panelOpen} onPanelOpen={setPanelOpen}
    height={viewport.height} top={viewport.top} keyboard={viewport.keyboard}>
    <input ref={input} className="aw-file-input" type="file" aria-label="本页参考素材" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime,audio/*,.glb,.gltf,.txt,.md" onChange={event => { void attachment(event.target.files?.[0]); event.target.value = ''; }} />
    {dialog === 'generation' && <PreviewSpecMenu current={generation} onClose={() => setDialog(null)} onChange={setGeneration} />}
    {dialog === 'models' && <PreviewModelMenu current={generation} onClose={() => setDialog(null)} onChange={setGeneration} />}
    {dialog === 'references' && <CanvasReferencePicker assets={canvasAssets} current={prompt} onInsert={quoteAssets} onClose={() => setDialog(null)} onCanvas={() => { setDialog(null); setPickingReference(true); setView('canvas'); }} />}
    {dialog === 'presets' && <AgentPresetPicker value={prompt} onChange={setPrompt} adapter={currentModel.adapter} target={currentModel.capability} onClose={() => setDialog(null)} />}
    {dialog === 'reference' && reference && <WorkbenchDialog title={reference.name} onClose={() => setDialog(null)}><div className="aw-reference-large">{reference.kind === 'text' ? <p>{reference.text}</p> : reference.kind === 'video' ? <video src={reference.url} controls playsInline preload="metadata" /> : reference.kind === 'audio' ? <audio src={reference.url} controls preload="metadata" /> : <AssetVisual asset={reference} />}</div><p>引用当前素材，操作仅影响本页会话。</p><div className="aw-dialog-actions"><button type="button" onClick={() => { locate(reference); setDialog(null); }}>定位来源节点</button><button type="button" className="aw-primary" onClick={() => quoteAssets([reference])}>插入引用</button></div></WorkbenchDialog>}
    {dialog === 'connection' && <WorkbenchDialog title="Codex 连接" onClose={() => setDialog(null)}><p>当前为界面交互预览，尚未连接 Codex，也不会发送模型请求。</p><p>正式接入需要独立执行服务。Agent 将通过受限接口操作当前画布，付费生成仍需确认；不会直接改动主平台任务。</p><button type="button" data-autofocus className="aw-primary" onClick={() => setDialog(null)}>继续体验界面</button></WorkbenchDialog>}
    {dialog === 'history' && <WorkbenchDialog title="示例生成历史" onClose={() => setDialog(null)}><p>这里仅展示本页示例，不读取你的真实生成记录。</p><div className="aw-history-list">{sampleAssets.map(asset => <button type="button" key={asset.id} onClick={() => { locate(asset); setDialog(null); }}><AssetVisual asset={asset} /><span>{asset.name}<small>预先准备的示例图片</small></span></button>)}</div></WorkbenchDialog>}
    {dialog === 'settings' && <WorkbenchDialog title="预览设置" onClose={() => setDialog(null)}><label>制作场景<select value={filmPlan ? 'film' : 'image'} onChange={event => setFilmPlan(event.target.value === 'film')}><option value="image">角色场景探索</option><option value="film">短片制作计划</option></select></label><label>界面状态<select value={statePreview} onChange={event => setStatePreview(event.target.value as typeof statePreview)}><option value="ready">结果已就绪</option><option value="empty">空会话</option><option value="loading">任务执行中（演示）</option><option value="error">任务失败（演示）</option><option value="disconnected">尚未连接</option></select></label><p>所有设置只影响此预览。刷新页面恢复示例，不保存到真实项目。</p><button type="button" className="aw-primary" onClick={() => setDialog(null)}>查看效果</button></WorkbenchDialog>}
    {dialog === 'text' && <WorkbenchDialog title="添加文本节点" onClose={() => setDialog(null)}><label>节点内容<textarea rows={4} value={textDraft} maxLength={8000} onChange={event => setTextDraft(event.target.value)} /></label><button type="button" className="aw-primary" disabled={!textDraft.trim()} onClick={() => { const id = crypto.randomUUID(); addAsset({ id, nodeId: `preview-${id}`, kind: 'text', name: textDraft.trim().slice(0, 24), text: textDraft }); setTextDraft(''); setDialog(null); }}>添加到预览画布</button></WorkbenchDialog>}
  </AgentWorkbench>;
}
