import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createCanvasMetadataCache, createViewportPublisher } from './canvas-render-cache';
import { canvasTouchInteraction, mobileNodeFocusViewport, useMobileCanvas } from './mobile-canvas';
import { registerTrialTools } from './trial-webmcp';
import { CanvasAgentDock, type CanvasAgentItem } from './agent-workbench/CanvasAgentDock';
import { canvasAgentContext, planAgentEdits } from './agent-workbench/agent-canvas';
import { nodeBounds } from './agent-workbench/agent-spatial';
import { editPreview } from './agent-workbench/agent-proposals';
import { jobSnapshot } from './agent-workbench/agent-jobs';
import type { AgentCanvasAccess } from './agent-workbench/agent-session';
import { validateAgentTool } from '../server/agent-contract.js';
import { agentCompactLayout, toggleAgentWorkspace, type AgentWorkspace } from './agent-workbench/workbench-layout';
import {
  MiniMap, ReactFlow as ReactFlowBase, ReactFlowProvider, SelectionMode, reconnectEdge,
  useEdgesState, useNodesState, useReactFlow, useUpdateNodeInternals, type Connection, type Edge, type IsValidConnection, type OnConnectEnd, type OnReconnect, type ReactFlowProps, type Viewport,
} from '@xyflow/react';
import {
  nodeTypes, canvasImagePreviewUrl, characterRigSourceVersionIndex, comfyUiExplicitWorkflowSelectionDefaults, comfyUiWorkflowIsSelectable, compatibleGeneratorSettings, modelProcessBaseLabel, modelProcessStageLabel, portDefinitions, preferredCharacterPreviewOutput, preferredInteractiveModelOutput, runtimeInputPorts, GeneratorEditorPanel, ComfyUiWorkflowPanel, CharacterAnimatorEditorPanel, type CanvasNode, type CanvasNodeData, type ComfyUiSamplingPreview, type ComfyUiWorkflowInfo, type DataType, type ImageReference, type InputReference, type ModelGeneratorVersion, type ModelInfo, type PromptClipboardReference, type ResultOutput, type ResultState, type ResultVersion, type SendTarget, type SupportedCanvasNodeKind, type TripoSubmittedOptions, type VideoInputMode,
} from './components/CanvasNodes';
import { characterProportionGuideFileName, characterProportionGuideUrl, characterTurnaroundHeadRatios, type CharacterTurnaroundHeadRatio, type CharacterTurnaroundPose } from './character-turnaround';
import { applyModelingStyleContract, isModelingStyleId } from './modeling-style';
import type { TripoPostprocessResult, TripoPostprocessSubmission } from './components/TripoPostprocessWorkbench';
import { buildTripoPostprocessApiBody, resolveTripoCharacterSourceVersion, safeTripoOptimizationSourceIndex } from './tripo3d-postprocess-request';
import { collectionInputSlots, collectionCreationIssue, collectionDeletionNodeIds, collectionMemberPositionChanges, expandedCollectionSelection, growCollectionFrameForNode, remapCollectionMemberIds, type WorkflowCollectionInputSlot } from './workflow-collection';
import { useWorkflowCollections } from './workflow-collections';
import './workflow-collection.css';
import './reference-interaction.css';

import { createTurnaroundCropFiles, multiViewLabels, type TurnaroundCrop, type TurnaroundSideRole, type TurnaroundViewAsset, type TurnaroundViewRole } from './turnaround-split';
import { createTripoCharacterDraft, createTripoCharacterRun, type TripoCharacterRun } from './tripo-character-workflow';
import { hasBoundCanvasTask, resolveStudioMode } from './studio-mode';
import { H3_GENERATION_CONTRACT_VERSION, assertH3GenerationEcho, type H3GenerationOptions } from './h3-generation-contract';
import { validatedComfyUiEditorUrl } from './comfyui-editor-url';
import { createImageCollage, createPositionedImageComposite, loadImageCollageBitmap, orderImageCollageSources, type ImageCollageEntry } from './image-collage';
import type { QuickCropOutput } from './image-quick-crop';
import { UiActionContent, UiIcon, type UiIconName } from './components/UiIcon';
import { GlobalTooltip } from './components/GlobalTooltip';
import { animateCanvasThemeBackground } from './canvas-theme-mask';
import { animateCanvasThemeTransition } from './canvas-theme-transition';
import { mergeComfyUiLocalResources, type ComfyUiLocalResourceInventory } from './comfyui-local-resources';
import { compilePromptTokenSelection, reconcilePromptTokenSelection, supportsNegativePromptTokens } from './prompt-token-library';
import { canvasAssetDownloadUrl, nodeResourceDownloadFileName, videoDownloadFileName } from './media-download';
import { canvasMediaLodLevelForZoom, primePersistentMediaLod, type CanvasMediaLodLevel } from './media-lod';
import { smoothWheelViewport, type GeneratedAssetHistoryItem } from './generation-history';
import { canvasCapabilityModuleEnabled, canvasToolVisible } from './canvas-capability-modules';
import { observeCanvasInterfaceLanguage, storedCanvasInterfaceLanguage, type CanvasInterfaceLanguage } from './interface-language';
import { stripCanvasClipboardRuntime } from '../server/canvas-clipboard-contract.js';
import {
  LOCAL_MEDIA_BINDING_VERSION,
  localMediaAutoPrompt,
  localMediaBindingMethodForPort,
  localMediaBindingRoleForPort,
  planLocalMediaBindings,
  type LocalMediaBindingMethod,
  type LocalMediaBindingRole,
  type LocalMediaVersionPolicy,
} from '../shared/local-media-binding.js';

const loadSettingsCenter = () => import('./components/SettingsCenter').then((module) => ({ default: module.SettingsCenter }));
const SettingsCenter = lazy(loadSettingsCenter);
const GeneratedAssetHistory = lazy(() => import('./components/GeneratedAssetHistory').then((module) => ({ default: module.GeneratedAssetHistory })));

const tools: Array<{ kind: SupportedCanvasNodeKind; icon: UiIconName; label: string }> = [
  { kind: 'text', icon: 'text', label: '文本' }, { kind: 'image', icon: 'image', label: '素材图片' },
  { kind: 'video', icon: 'video', label: '素材视频' }, { kind: 'audio', icon: 'audio', label: '素材音频' }, { kind: 'imageGenerator', icon: 'imageGenerate', label: '图片' },
  { kind: 'videoGenerator', icon: 'videoGenerate', label: '视频' }, { kind: 'audioGenerator', icon: 'audioGenerate', label: '音频' }, { kind: 'modelGenerator', icon: 'model3d', label: '3D 模型' }, { kind: 'comfyUiWorkflow', icon: 'comfy', label: 'ComfyUI 工作流' }, { kind: 'characterAnimator', icon: 'character', label: '角色绑定与动画' }, { kind: 'turnaroundSplitter', icon: 'split', label: '多视图切分' }, { kind: 'result', icon: 'result', label: '结果' },
];
const creatableTools = tools.filter((tool) => tool.kind !== 'result');
const manualTools = tools.filter((tool) => ['text', 'imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow'].includes(tool.kind));

type CanvasShortcutGroup = {
  title: string;
  code: string;
  subtitle: string;
  icon: UiIconName;
  items: readonly CanvasShortcutItem[];
};

type CanvasShortcutItem = {
  keys: readonly string[];
  alternateKeys?: ReadonlyArray<readonly string[]>;
  label: string;
};

export const canvasShortcutGroups: readonly CanvasShortcutGroup[] = [
  {
    title: '创建与运行',
    code: 'BUILD',
    subtitle: '节点创建与执行',
    icon: 'run',
    items: [
      { keys: ['Tab'], label: '在指针位置打开节点菜单' },
      { keys: ['Enter'], label: '运行单个选中的生成节点' },
      { keys: ['Ctrl', 'G'], label: '收纳两个以上选中节点' },
    ],
  },
  {
    title: '节点编辑',
    code: 'EDIT',
    subtitle: '复制、粘贴与管理',
    icon: 'edit',
    items: [
      { keys: ['Ctrl', 'C'], label: '复制节点；多图按原位合成' },
      { keys: ['Ctrl', 'V'], label: '粘贴节点或导入媒体' },
      { keys: ['Ctrl', 'Shift', 'V'], label: '仅粘贴节点设置' },
      { keys: ['Ctrl', 'D'], label: '带输入复制节点或整组（D 也可）' },
      { keys: ['F2'], label: '重命名单个节点' },
      { keys: ['Delete'], alternateKeys: [['Backspace']], label: '删除选中节点' },
    ],
  },
  {
    title: '排列与对齐',
    code: 'ARRAY',
    subtitle: '碰撞排列与收纳',
    icon: 'organize',
    items: [
      { keys: ['Ctrl', '←'], label: '向左碰撞排列' },
      { keys: ['Ctrl', '→'], label: '向右碰撞排列' },
      { keys: ['Ctrl', '↑'], label: '向上碰撞排列' },
      { keys: ['Ctrl', '↓'], label: '向下碰撞排列' },
    ],
  },
  {
    title: '历史与视图',
    code: 'VIEW',
    subtitle: '撤销与镜头控制',
    icon: 'view',
    items: [
      { keys: ['Ctrl', 'Z'], label: '撤销上一步' },
      { keys: ['Ctrl', 'Shift', 'Z'], alternateKeys: [['Ctrl', 'Y']], label: '重做' },
      { keys: ['F'], label: '聚焦所选或全部节点' },
      { keys: ['Home'], label: '显示完整画布' },
      { keys: ['1'], label: '回到 100% 缩放' },
      { keys: ['Esc'], label: '关闭菜单与浮层' },
    ],
  },
];

export const canvasContextShortcutItems: readonly CanvasShortcutItem[] = [
  { keys: ['/'], label: '空白文本：打开提示词预设' },
  { keys: ['Enter'], label: '重命名：确认；节点搜索：创建首项' },
  { keys: ['Esc'], label: '取消拖拽、重命名或关闭局部编辑器' },
  { keys: ['←'], alternateKeys: [['→']], label: '音频波形：前后跳转 2 秒' },
];

function KeyboardShortcutGlyph({ className = '' }: { className?: string }) {
  return <svg className={`keyboard-shortcut-glyph${className ? ` ${className}` : ''}`} viewBox="0 0 72 22" fill="none" aria-hidden="true" focusable="false">
    <path className="keyboard-shortcut-glyph__body" d="M5 1.25h62c1.7 0 2.9 1 3.05 2.55l1.05 13.55c.15 1.85-1.25 3.4-3.1 3.4H4c-1.85 0-3.25-1.55-3.1-3.4L1.95 3.8C2.1 2.25 3.3 1.25 5 1.25Z" />
    <path className="keyboard-shortcut-glyph__lip" d="M1.15 17.55h69.7" />
    <g className="keyboard-shortcut-glyph__keys">
      <rect x="5" y="5" width="4" height="2.5" rx=".8" /><rect x="10.5" y="5" width="4" height="2.5" rx=".8" /><rect x="16" y="5" width="4" height="2.5" rx=".8" /><rect x="21.5" y="5" width="4" height="2.5" rx=".8" /><rect x="27" y="5" width="4" height="2.5" rx=".8" /><rect x="32.5" y="5" width="4" height="2.5" rx=".8" /><rect x="38" y="5" width="4" height="2.5" rx=".8" /><rect x="43.5" y="5" width="4" height="2.5" rx=".8" /><rect x="49" y="5" width="4" height="2.5" rx=".8" /><rect x="54.5" y="5" width="4" height="2.5" rx=".8" /><rect x="60" y="5" width="7" height="2.5" rx=".8" />
      <rect x="5" y="8.8" width="5.5" height="2.5" rx=".8" /><rect x="12" y="8.8" width="4" height="2.5" rx=".8" /><rect x="17.5" y="8.8" width="4" height="2.5" rx=".8" /><rect x="23" y="8.8" width="4" height="2.5" rx=".8" /><rect x="28.5" y="8.8" width="4" height="2.5" rx=".8" /><rect x="34" y="8.8" width="4" height="2.5" rx=".8" /><rect x="39.5" y="8.8" width="4" height="2.5" rx=".8" /><rect x="45" y="8.8" width="4" height="2.5" rx=".8" /><rect x="50.5" y="8.8" width="4" height="2.5" rx=".8" /><rect x="56" y="8.8" width="4" height="2.5" rx=".8" /><rect x="61.5" y="8.8" width="5.5" height="2.5" rx=".8" />
      <rect x="5" y="12.6" width="7" height="2.5" rx=".8" /><rect x="13.5" y="12.6" width="4" height="2.5" rx=".8" /><rect x="19" y="12.6" width="4" height="2.5" rx=".8" /><rect x="24.5" y="12.6" width="4" height="2.5" rx=".8" /><rect x="30" y="12.6" width="4" height="2.5" rx=".8" /><rect x="35.5" y="12.6" width="4" height="2.5" rx=".8" /><rect x="41" y="12.6" width="4" height="2.5" rx=".8" /><rect x="46.5" y="12.6" width="4" height="2.5" rx=".8" /><rect x="52" y="12.6" width="4" height="2.5" rx=".8" /><rect x="57.5" y="12.6" width="9.5" height="2.5" rx=".8" />
      <rect x="5" y="16.4" width="6" height="2.5" rx=".8" /><rect x="12.5" y="16.4" width="5" height="2.5" rx=".8" /><rect x="19" y="16.4" width="28" height="2.5" rx="1" /><rect x="48.5" y="16.4" width="5" height="2.5" rx=".8" /><rect x="55" y="16.4" width="3.5" height="2.5" rx=".8" /><rect x="60" y="16.4" width="3.5" height="2.5" rx=".8" /><rect x="65" y="16.4" width="2" height="2.5" rx=".7" />
    </g>
    <g className="keyboard-shortcut-glyph__signals"><circle cx="63" cy="3.2" r=".55" /><circle cx="65.3" cy="3.2" r=".55" /><circle cx="67.6" cy="3.2" r=".55" /></g>
  </svg>;
}

function ShortcutKeyset({ shortcut }: { shortcut: CanvasShortcutItem }) {
  const sequences = [shortcut.keys, ...(shortcut.alternateKeys || [])];
  return <span className="canvas-shortcut-keyset" aria-label={sequences.map((sequence) => sequence.join(' 加 ')).join(' 或 ')}>{sequences.map((sequence, sequenceIndex) => <span className="canvas-shortcut-key-alternative" key={`${sequence.join('-')}-${sequenceIndex}`}>
    <span>{sequence.map((key, index) => <span className="canvas-shortcut-key-token" key={`${key}-${index}`}><kbd>{key}</kbd>{index < sequence.length - 1 && <b aria-hidden="true">+</b>}</span>)}</span>
    {sequenceIndex < sequences.length - 1 && <i aria-hidden="true">/</i>}
  </span>)}</span>;
}

const defaultViewport: Viewport = { x: 0, y: 0, zoom: 1 };
export function canvasViewportAnnotationScale(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Number(Math.max(0.5, Math.min(2.4, 1 / safeZoom)).toFixed(3));
}
export function canvasViewportDetailClass(zoom: number): '' | 'zoom-detail-mid' | 'zoom-detail-far' {
  if (!Number.isFinite(zoom) || zoom >= 0.68) return '';
  return zoom < 0.44 ? 'zoom-detail-far' : 'zoom-detail-mid';
}
const ReactFlow = (props: ReactFlowProps<CanvasNode, Edge>) => <ReactFlowBase elevateNodesOnSelect={false} {...props} zIndexMode="manual" />;
const canvasThemeStorageKey = 'ai-canvas:theme:v1';
export type CanvasTheme = 'day' | 'night';
export const canvasAppVersionLabel = 'v1.1';
type SettingsCenterSection = 'api' | 'comfyui' | 'data' | 'about';

export function settingsSectionFromPanel(panel: string | null): SettingsCenterSection | null {
  if (panel === 'models' || panel === 'api' || panel === 'settings') return 'api';
  return panel === 'comfyui' || panel === 'data' || panel === 'about' ? panel : null;
}

export function passiveConnectionGuideType(
  nodeId: string,
  singleSelectedNodeId: string | null,
  outputType?: DataType,
): DataType | undefined {
  return nodeId === singleSelectedNodeId ? outputType : undefined;
}

type ContextMenuIconName = UiIconName;

function ContextMenuIcon({ name }: { name: ContextMenuIconName }) {
  return <UiIcon name={name} className="context-menu-icon" />;
}

function ContextMenuItemContent({ icon, children }: { icon: ContextMenuIconName; children: ReactNode }) {
  return <><ContextMenuIcon name={icon} /><span className="context-menu-item-label">{children}</span></>;
}

export function nodeTaskIdForTrace(data: Pick<CanvasNodeData, 'jobId'> | undefined): string {
  return String(data?.jobId || '').trim();
}

export function referenceDenoiseForSubmission(value: unknown, fallback = 0.72): number {
  const requested = Number(value);
  const safeFallback = Number.isFinite(Number(fallback)) ? Math.max(0.05, Math.min(1, Number(fallback))) : 0.72;
  const normalized = Number.isFinite(requested) ? Math.max(0.05, Math.min(1, requested)) : safeFallback;
  return Math.round(normalized * 100) / 100;
}

function ContextMenuSubmenu({ icon, label, open, onOpenChange, children }: { icon: ContextMenuIconName; label: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return <div
    className={`context-submenu${open ? ' is-open' : ''}`}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOpenChange(false); }}
  >
    <button
      type="button"
      className="context-submenu-trigger"
      aria-haspopup="true"
      aria-expanded={open}
      onClick={() => onOpenChange(!open)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') { event.preventDefault(); onOpenChange(true); }
        if (event.key === 'Escape') { event.stopPropagation(); onOpenChange(false); }
      }}
    >
      <ContextMenuIcon name={icon} /><span className="context-menu-item-label">{label}</span><i aria-hidden="true" />
    </button>
    <div className="context-submenu-panel" role="group" aria-label={label}>{children}</div>
  </div>;
}

type ComfyUiEditorState = {
  nodeId: string;
  modelId: string;
  status: 'loading' | 'ready' | 'error';
  sessionId?: string;
  workflowId?: string;
  workflowName?: string;
  scopeTitle?: string;
  modelName?: string;
  editorUrl?: string;
  started?: boolean;
  error?: string;
};

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const ComfyUiEditorDialog = memo(function ComfyUiEditorDialog({ state, apiFetch, onClose, onRetry, onRun, onCanvasSync }: { state: ComfyUiEditorState; apiFetch: ApiFetch; onClose: () => void; onRetry: () => void; onRun: (nodeId: string) => Promise<void>; onCanvasSync: (nodeId: string, canvasState: Record<string, unknown>) => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const workflowRevisionRef = useRef(0);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.fullscreenElement) onClose(); };
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === dialogRef.current);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [onClose]);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (dialogRef.current?.requestFullscreen) void dialogRef.current.requestFullscreen();
  }, []);
  useEffect(() => {
    if (state.status !== 'ready' || !state.editorUrl || !state.sessionId) return;
    const sessionId = state.sessionId;
    const editorOrigin = new URL(state.editorUrl).origin;
    const postToEditor = (payload: Record<string, unknown>) => iframeRef.current?.contentWindow?.postMessage({ ...payload, sessionId }, editorOrigin);
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== editorOrigin || event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.sessionId !== sessionId || typeof data.type !== 'string' || !data.type.startsWith('ai-canvas:comfyui:')) return;
      if (data.type === 'ai-canvas:comfyui:ready') {
        try {
          const response = await apiFetch(`/api/v1/comfyui/editor-sessions/${encodeURIComponent(sessionId)}/workflow`);
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || '节点工作流加载失败');
          workflowRevisionRef.current = Math.max(0, Number(payload.revision) || 0);
          postToEditor({ type: 'ai-canvas:comfyui:load', workflow: payload.workflow, revision: workflowRevisionRef.current, title: payload.title || state.scopeTitle || state.workflowName });
        } catch (error) {
          postToEditor({ type: 'ai-canvas:comfyui:error', error: error instanceof Error ? error.message : '节点工作流加载失败' });
        }
      }
      if (data.type === 'ai-canvas:comfyui:save') {
        try {
          const response = await apiFetch(`/api/v1/comfyui/editor-sessions/${encodeURIComponent(sessionId)}/workflow`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workflow: data.workflow, ...(data.prompt ? { prompt: data.prompt } : {}), revision: workflowRevisionRef.current }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || '节点工作流保存失败');
          workflowRevisionRef.current = Math.max(workflowRevisionRef.current, Number(payload.revision) || 0);
          if (payload.canvasSync && typeof payload.canvasSync === 'object') onCanvasSync(state.nodeId, payload.canvasSync);
          postToEditor({ type: 'ai-canvas:comfyui:saved', requestId: data.requestId, revision: workflowRevisionRef.current });
          if (data.runAfterSave === true) await onRun(state.nodeId);
        } catch (error) {
          postToEditor({ type: 'ai-canvas:comfyui:saved', requestId: data.requestId, error: error instanceof Error ? error.message : '节点工作流保存失败' });
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [apiFetch, onCanvasSync, onRun, state.editorUrl, state.nodeId, state.scopeTitle, state.sessionId, state.status, state.workflowName]);
  return <div className="comfyui-editor-backdrop" role="presentation" onMouseDown={onClose}>
    <section ref={dialogRef} className="comfyui-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="comfyui-editor-title" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><span>COMFYUI EXPERT MODE</span><strong id="comfyui-editor-title">{state.scopeTitle || state.workflowName || '完整工作流编辑器'}</strong><small>{state.modelName || '正在连接本地生成环境'}</small></div>
        <nav><span className="comfyui-editor-scope">当前节点专属</span><button type="button" className="comfyui-editor-fullscreen" aria-label={fullscreen ? '退出浏览器全屏' : '进入浏览器全屏'} title={fullscreen ? '退出浏览器全屏' : '浏览器全屏'} onClick={toggleFullscreen}><UiActionContent icon="expand">{fullscreen ? '退出全屏' : '全屏'}</UiActionContent></button><button type="button" className="ui-icon-button" aria-label="关闭 ComfyUI 编辑器" title="关闭" onClick={onClose}><UiIcon name="close" /></button></nav>
      </header>
      <div className={`comfyui-editor-stage is-${state.status}`}>
        {state.status === 'loading' && <div className="comfyui-editor-state" role="status"><i /><strong>正在启动并连接本地 ComfyUI</strong><span>首次启动会加载节点和模型环境，请稍候。</span></div>}
        {state.status === 'error' && <div className="comfyui-editor-state is-error" role="alert"><strong>完整工作流编辑器暂时无法打开</strong><span>{state.error || '本地 ComfyUI 不可用'}</span><button type="button" onClick={onRetry}>重新连接</button></div>}
        {state.status === 'ready' && state.editorUrl && <iframe ref={iframeRef} title={`${state.workflowName || 'ComfyUI'} 完整工作流编辑器`} src={state.editorUrl} allow="clipboard-read; clipboard-write; fullscreen" allowFullScreen />}
      </div>
      <footer><span><i className={state.status === 'ready' ? 'is-ready' : ''} />{state.status === 'ready' ? (state.started ? '节点会话已启动' : '节点会话已连接') : state.status === 'error' ? '连接失败' : '正在连接'}</span><small>工作流保存到当前任务节点；运行仍进入 AI 创作台队列，结果只回到原节点。</small></footer>
    </section>
  </div>;
});

export function resolveCanvasTheme(storedTheme: string | null): CanvasTheme {
  return storedTheme === 'day' || storedTheme === 'night' ? storedTheme : 'night';
}

function storedCanvasTheme(): CanvasTheme {
  try { return resolveCanvasTheme(window.localStorage.getItem(canvasThemeStorageKey)); }
  catch { return 'night'; }
}

type CanvasViewTransition = { ready: Promise<void>; finished: Promise<void> };
type CanvasTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => CanvasViewTransition;
};

export type CanvasThemeTransitionMotion = {
  nextTheme: CanvasTheme;
  origin: { x: number; y: number };
  radius: number;
  pseudoElement: '::view-transition-new(root)' | '::view-transition-old(root)';
  clipPath: [string, string];
  duration: number;
  easing: string;
};

export function canvasThemeTransitionMotion(
  currentTheme: CanvasTheme,
  origin: { x: number; y: number },
  viewport: { width: number; height: number },
): CanvasThemeTransitionMotion {
  const width = Math.max(1, Number(viewport.width) || 1);
  const height = Math.max(1, Number(viewport.height) || 1);
  const x = Math.max(0, Math.min(width, Number(origin.x) || 0));
  const y = Math.max(0, Math.min(height, Number(origin.y) || 0));
  const radius = Math.ceil(Math.hypot(Math.max(x, width - x), Math.max(y, height - y))) + 2;
  const fullCircle = `circle(${radius}px at ${x}px ${y}px)`;
  const closedCircle = `circle(0px at ${x}px ${y}px)`;
  const toDay = currentTheme === 'night';
  return {
    nextTheme: toDay ? 'day' : 'night',
    origin: { x, y },
    radius,
    pseudoElement: toDay ? '::view-transition-new(root)' : '::view-transition-old(root)',
    clipPath: toDay ? [closedCircle, fullCircle] : [fullCircle, closedCircle],
    duration: Math.round(Math.max(toDay ? 620 : 520, Math.min(toDay ? 820 : 720, radius * (toDay ? .55 : .45)))),
    easing: toDay ? 'cubic-bezier(.2,.74,.16,1)' : 'cubic-bezier(.65,0,.35,1)',
  };
}

function transitionCanvasTheme(
  currentTheme: CanvasTheme,
  setTheme: (theme: CanvasTheme) => void,
  source: HTMLElement,
) {
  const root = document.documentElement;
  if (root.dataset.canvasThemeTransition) return;
  const rect = source.getBoundingClientRect();
  const motion = canvasThemeTransitionMotion(currentTheme, {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }, { width: window.innerWidth, height: window.innerHeight });
  const transitionDocument = document as CanvasTransitionDocument;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const studio = source.closest('.app-shell');
  const background = studio?.querySelector<HTMLElement>('.flow-area');
  // Restore the original whole-scene wipe when View Transitions are supported.
  // Older browsers retain the background-only fallback without hiding nodes.
  if (background && !reduceMotion && !transitionDocument.startViewTransition) {
    root.dataset.canvasThemeTransition = motion.nextTheme === 'day' ? 'to-day' : 'to-night';
    animateCanvasThemeBackground(background, motion, () => {
      flushSync(() => {
        applyCanvasThemeDocument(motion.nextTheme);
        setTheme(motion.nextTheme);
      });
    }, () => { delete root.dataset.canvasThemeTransition; });
    return;
  }
  if (!transitionDocument.startViewTransition || reduceMotion) {
    applyCanvasThemeDocument(motion.nextTheme);
    setTheme(motion.nextTheme);
    return;
  }
  animateCanvasThemeTransition(transitionDocument, motion, () => {
    flushSync(() => {
      applyCanvasThemeDocument(motion.nextTheme);
      setTheme(motion.nextTheme);
    });
  });
}

function applyCanvasThemeDocument(theme: CanvasTheme) {
  document.documentElement.dataset.canvasTheme = theme;
  document.documentElement.style.colorScheme = theme === 'day' ? 'light' : 'dark';
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme === 'day' ? '#ece9e2' : '#202020');
  try { window.localStorage.setItem(canvasThemeStorageKey, theme); }
  catch { /* Theme still works for this session when storage is unavailable. */ }
}

export function containCanvasZoomGesture(event: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'preventDefault'>): boolean {
  if (!event.ctrlKey && !event.metaKey) return false;
  event.preventDefault();
  return true;
}

export function canvasNodeHandleLayoutSignature(node: CanvasNode) {
  const data = node.data;
  return [
    node.id,
    data.kind,
    data.modelInputMode || '',
    data.videoInputMode || '',
    data.turnaroundConfirmed ? 'confirmed' : '',
    (data.disabledMultiviewPorts || []).join(','),
    (data.turnaroundViews || []).map((view) => `${view.role}:${view.mediaUrl}`).join(','),
    (data.inputReferences || []).map((reference) => `${reference.edgeId}:${reference.type}:${reference.port}:${reference.token}`).join(','),
    (data.collectionInputs || []).map((input) => `${input.id}:${input.type}`).join(','),
    data.collapsed ? 'collapsed' : 'expanded',
    String(data.collectionOutputCount || 0),
  ].join('|');
}

export function nodeUsesReferenceGraph(kind: CanvasNodeData['kind']) {
  return ['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow', 'turnaroundSplitter'].includes(kind);
}

export function canvasReferenceGraphSignature(nodes: readonly CanvasNode[], edges: readonly Edge[]) {
  const nodeSignature = nodes.map((node) => {
    const data = node.data;
    const outputSignature = [
      ...(data.latestOutputs || []),
      ...(data.generationVersions || []).flatMap((version) => version.outputs || []),
      ...(data.outputs || []),
      ...(data.resultVersions || []).flatMap((version) => version.outputs || []),
      ...(data.modelVersions || []).flatMap((version) => version.outputs || []),
    ].map((output) => `${output.mediaUrl || ''}:${output.fileName || ''}`).join(',');
    const viewSignature = (data.turnaroundViews || []).map((view) => `${view.role}:${view.mediaUrl}`).join(',');
    return `${node.id}:${data.kind}:${data.text || ''}:${data.mediaUrl || ''}:${data.selectedOutput || 0}:${data.selectedVersion || 0}:${data.selectedModelVersion || 0}:${outputSignature}:${viewSignature}`;
  }).join('|');
  const edgeSignature = edges.map((edge) => `${edge.id}:${edge.source}:${edge.sourceHandle || ''}:${edge.target}:${edge.targetHandle || ''}:${edge.data?.referenceOrder || ''}:${edge.data?.referenceToken || ''}:${edge.data?.sourceMediaUrl || ''}`).join('|');
  return `${nodeSignature}#${edgeSignature}`;
}

/** Build independent signatures so one changed image does not invalidate every generator node. */
export function canvasReferenceGraphSignatures(nodes: readonly CanvasNode[], edges: readonly Edge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, Edge[]>();
  const outgoing = new Map<string, Edge[]>();
  edges.forEach((edge) => {
    incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge]);
  });
  const sourceMemo = new Map<string, string>();
  const sourceSignature = (nodeId: string, visited = new Set<string>()): string => {
    if (sourceMemo.has(nodeId)) return sourceMemo.get(nodeId) || '';
    if (visited.has(nodeId)) return nodeId;
    const nextVisited = new Set(visited).add(nodeId);
    const node = nodeById.get(nodeId);
    if (!node) return nodeId;
    const data = node.data;
    const outputs = (data.latestOutputs || []).map((output) => `${output.mediaUrl || ''}:${output.previewUrl || ''}:${output.fileName || ''}`).join(',');
    const views = (data.turnaroundViews || []).map((view) => `${view.role}:${view.mediaUrl}`).join(',');
    const runs = JSON.stringify(data.characterRuns || []);
    const dependencies: string[] = [];
    if (data.kind === 'result' && !data.mediaUrl) {
      (incoming.get(nodeId) || []).forEach((edge) => dependencies.push(sourceSignature(edge.source, nextVisited)));
    }
    if (['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow'].includes(data.kind) && !outputs) {
      (outgoing.get(nodeId) || []).forEach((edge) => {
        const target = nodeById.get(edge.target);
        if (target?.data.kind === 'result') dependencies.push(sourceSignature(edge.target, nextVisited));
      });
    }
    const signature = `${node.id}:${data.kind}:${data.text || ''}:${data.mediaUrl || ''}:${data.previewUrl || ''}:${data.selectedOutput || 0}:${data.activeCharacterRunId || ''}:${outputs}:${views}:${runs}:${dependencies.join('>')}`;
    sourceMemo.set(nodeId, signature);
    return signature;
  };
  const signatures = new Map<string, string>();
  nodes.filter((node) => nodeUsesReferenceGraph(node.data.kind)).forEach((target) => {
    const edgeSignature = (incoming.get(target.id) || [])
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((edge) => `${edge.id}:${edge.sourceHandle || ''}:${edge.targetHandle || ''}:${edge.data?.referenceOrder || ''}:${edge.data?.referenceToken || ''}:${edge.data?.sourceMediaUrl || ''}:${sourceSignature(edge.source)}`)
      .join('|');
    signatures.set(target.id, `${target.id}:${(target.data.disabledMultiviewPorts || []).join(',')}:${JSON.stringify(target.data.inputReferenceRoles || {})}#${edgeSignature}`);
  });
  return signatures;
}
export const canvasMinimumZoom = 0.05;
export const multiSelectionVisualOffset = 14;

export function canvasPreviewUrlsNearViewport(nodes: readonly CanvasNode[], viewport: Viewport, viewportSize: { width: number; height: number }, limit = 64) {
  const zoom = Math.max(canvasMinimumZoom, viewport.zoom || 1);
  const viewWidth = Math.max(1, viewportSize.width) / zoom;
  const viewHeight = Math.max(1, viewportSize.height) / zoom;
  const left = -viewport.x / zoom - viewWidth;
  const top = -viewport.y / zoom - viewHeight;
  const right = left + viewWidth * 3;
  const bottom = top + viewHeight * 3;
  const centerX = left + viewWidth * 1.5;
  const centerY = top + viewHeight * 1.5;
  const hidden = new Set(nodes.filter(node => node.data.kind === 'collection' && node.data.collapsed).flatMap(node => node.data.memberIds || []));
  const candidates = nodes.flatMap((node) => {
    if (hidden.has(node.id)) return [];
    const width = nodeWidth(node);
    const height = nodeHeight(node);
    if (node.position.x + width < left || node.position.x > right || node.position.y + height < top || node.position.y > bottom) return [];
    const distance = Math.hypot(node.position.x + width / 2 - centerX, node.position.y + height / 2 - centerY);
    const data = node.data;
    const outputType = data.latestMediaType || data.outputType || data.mediaType;
    const outputs = outputType === 'image'
      ? data.latestOutputs || data.outputs || []
      : [];
    const urls = [
      ...(data.kind === 'image' && data.mediaUrl ? [canvasImagePreviewUrl(data.mediaUrl, data.previewUrl)] : []),
      ...outputs.map((output) => canvasImagePreviewUrl(output.mediaUrl, output.previewUrl)),
    ].filter(Boolean);
    return urls.map((url) => ({ url, distance }));
  }).sort((leftEntry, rightEntry) => leftEntry.distance - rightEntry.distance);
  return [...new Set(candidates.map((entry) => entry.url))].slice(0, Math.max(1, limit));
}
const initialNodeWidth = (kind: SupportedCanvasNodeKind | 'unsupported') => kind === 'characterAnimator' ? 520 : kind === 'result' ? 420 : kind === 'turnaroundSplitter' ? 460 : ['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow'].includes(kind) ? 390 : kind === 'text' ? 340 : kind === 'audio' ? 360 : kind === 'image' || kind === 'video' ? 318 : 300;
const initialNodeHeight = (kind: SupportedCanvasNodeKind | 'unsupported') => kind === 'characterAnimator' ? 520 : kind === 'result' ? 300 : kind === 'turnaroundSplitter' ? 420 : ['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow'].includes(kind) ? 250 : kind === 'text' ? 180 : kind === 'audio' ? 150 : kind === 'image' || kind === 'video' ? 240 : 180;
const TOPAZ_UPSCALE_MODEL_ID = 'local-topaz-starlight-upscale';
const GENERATION_OUTPUT_RETENTION_STEPS = 5;
const canvasMediaExtensions = Object.freeze({
  image: new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']),
  video: new Set(['.mp4', '.webm', '.mov']),
  audio: new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg']),
});
const canvasMediaMimeByExtension: Readonly<Record<string, string>> = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
});
type CanvasMediaKind = 'image' | 'video' | 'audio';

function fileExtension(name: string) {
  const fileName = String(name || '').replace(/\\/g, '/').split('/').pop() || '';
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

export function canvasMediaKind(file: Pick<File, 'name' | 'type'>): CanvasMediaKind | null {
  const extension = fileExtension(file.name);
  if (canvasMediaExtensions.image.has(extension)) return 'image';
  if (canvasMediaExtensions.video.has(extension)) return 'video';
  if (canvasMediaExtensions.audio.has(extension)) return 'audio';
  return null;
}

export function normalizedCanvasMediaFile(file: File): File {
  const extension = fileExtension(file.name);
  const expectedMime = canvasMediaMimeByExtension[extension];
  const declaredMime = String(file.type || '').trim().toLowerCase();
  if (!expectedMime || (declaredMime && declaredMime !== 'application/octet-stream')) return file;
  return new File([file], file.name, { type: expectedMime, lastModified: file.lastModified });
}

export function centeredMediaNodePosition(point: { x: number; y: number }, kind: CanvasMediaKind, horizontalOffset = 0) {
  return {
    x: point.x + horizontalOffset - initialNodeWidth(kind) / 2,
    y: point.y - initialNodeHeight(kind) / 2,
  };
}
export const generatorNodeFrameHeight = (width: number) => Math.round(Math.max(320, width) * 250 / 390);
export const modelGeneratorNodeFrameHeight = (width: number) => Math.round(Math.max(320, width) * 3 / 4) + 34;
export function turnaroundSplitterNodeSize(mediaWidth: number, mediaHeight: number) {
  if (!mediaWidth || !mediaHeight) return { width: initialNodeWidth('turnaroundSplitter'), height: initialNodeHeight('turnaroundSplitter') };
  const aspect = Math.max(0.25, Math.min(4, mediaWidth / mediaHeight));
  const previewWidth = Math.min(720, Math.max(430, Math.round(340 * aspect)));
  const width = previewWidth + 24;
  const previewHeight = previewWidth / aspect;
  return { width, height: Math.min(820, Math.max(360, Math.round(previewHeight + 174))) };
}
export function turnaroundConfirmedNodeHeight(width: number, viewCount = 3) {
  const contentWidth = Math.max(386, width - 40);
  if (viewCount <= 3) return Math.min(620, Math.max(360, Math.round(contentWidth / 3 + 178)));
  const columns = Math.min(4, Math.max(2, viewCount));
  const rows = Math.ceil(Math.max(2, viewCount) / columns);
  return Math.min(820, Math.max(360, Math.round(rows * (contentWidth / columns + 34) + 168)));
}
function currentNodeDimension(values: unknown[], fallback: number, minimum: number) {
  const known = values
    .map((value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
    .filter(Boolean);
  return Math.max(minimum, known.length ? Math.max(...known) : fallback);
}

const nodeWidth = (node: CanvasNode) => currentNodeDimension(
  [node.measured?.width, node.width, typeof node.style?.width === 'number' ? node.style.width : 0],
  initialNodeWidth(node.data.kind),
  220,
);
const nodeHeight = (node: CanvasNode) => currentNodeDimension(
  [node.measured?.height, node.height, typeof node.style?.height === 'number' ? node.style.height : 0],
  initialNodeHeight(node.data.kind),
  120,
);
export function multiSelectionToolbarPosition(
  selectedNodes: readonly CanvasNode[],
  viewport: Viewport,
  viewportSize: { width: number; height: number },
): { left: number; top: number; placement: 'above' | 'below' } | null {
  if (selectedNodes.length < 2) return null;
  const selectionLeft = Math.min(...selectedNodes.map((node) => node.position.x));
  const selectionRight = Math.max(...selectedNodes.map((node) => node.position.x + nodeWidth(node)));
  const selectionTop = Math.min(...selectedNodes.map((node) => node.position.y));
  const selectionBottom = Math.max(...selectedNodes.map((node) => node.position.y + nodeHeight(node)));
  const screenLeft = viewport.x + ((selectionLeft + selectionRight) / 2) * viewport.zoom;
  const screenTop = viewport.y + selectionTop * viewport.zoom;
  const screenBottom = viewport.y + selectionBottom * viewport.zoom;
  const safeWidth = Math.max(320, viewportSize.width);
  const halfToolbarWidth = Math.min(210, Math.max(120, (safeWidth - 24) / 2));
  const left = Math.max(halfToolbarWidth + 12, Math.min(safeWidth - halfToolbarWidth - 12, screenLeft));
  const placement = screenTop >= 68 ? 'above' : 'below';
  const top = placement === 'above'
    ? screenTop - 12
    : Math.min(Math.max(12, viewportSize.height - 12), screenBottom + 12);
  return { left: Math.round(left), top: Math.round(top), placement };
}
export const frameNodePosition = (source: CanvasNode) => ({ x: source.position.x + nodeWidth(source) + 72, y: source.position.y });
export function companionNodePosition(
  target: CanvasNode,
  nodes: readonly CanvasNode[],
  companionWidth: number,
  companionHeight: number,
  companionId?: string,
) {
  const gap = 72;
  const targetWidth = nodeWidth(target);
  const targetHeight = nodeHeight(target);
  const candidates = [
    { x: target.position.x - companionWidth - gap, y: target.position.y },
    { x: target.position.x + targetWidth + gap, y: target.position.y },
    { x: target.position.x, y: target.position.y + targetHeight + gap },
    { x: target.position.x, y: target.position.y - companionHeight - gap },
    { x: target.position.x - companionWidth - gap, y: target.position.y + targetHeight + gap },
    { x: target.position.x + targetWidth + gap, y: target.position.y + targetHeight + gap },
  ];
  const clearance = 24;
  const overlaps = (position: { x: number; y: number }) => nodes.some((node) => {
    if (node.id === target.id || node.id === companionId) return false;
    return position.x < node.position.x + nodeWidth(node) + clearance
      && position.x + companionWidth + clearance > node.position.x
      && position.y < node.position.y + nodeHeight(node) + clearance
      && position.y + companionHeight + clearance > node.position.y;
  });
  return candidates.find((position) => !overlaps(position)) || candidates[0];
}

export function rightCompanionNodePosition(
  target: CanvasNode,
  nodes: readonly CanvasNode[],
  companionWidth: number,
  companionHeight: number,
  companionId?: string,
) {
  const gap = 72;
  const clearance = 24;
  const targetWidth = nodeWidth(target);
  const start = { x: target.position.x + targetWidth + gap, y: target.position.y };
  const overlaps = (position: { x: number; y: number }) => nodes.some((node) => {
    if (node.id === target.id || node.id === companionId) return false;
    return position.x < node.position.x + nodeWidth(node) + clearance
      && position.x + companionWidth + clearance > node.position.x
      && position.y < node.position.y + nodeHeight(node) + clearance
      && position.y + companionHeight + clearance > node.position.y;
  });
  for (let step = 0; step < 12; step += 1) {
    const candidate = { x: start.x, y: start.y + step * (companionHeight + gap) };
    if (!overlaps(candidate)) return candidate;
  }
  return start;
}

export function turnaroundImageNodePositions(
  target: CanvasNode,
  nodes: readonly CanvasNode[],
  count: number,
  imageWidth = initialNodeWidth('image'),
  imageHeight = imageWidth,
) {
  const safeCount = Math.max(1, Math.floor(count));
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(safeCount))));
  const rows = Math.ceil(safeCount / columns);
  const gap = 28;
  const blockGap = 72;
  const blockWidth = columns * imageWidth + (columns - 1) * gap;
  const blockHeight = rows * imageHeight + (rows - 1) * gap;
  const startX = target.position.x + nodeWidth(target) + blockGap;
  const blockers = nodes.filter((node) => node.id !== target.id && node.data.derivedFromNodeId !== target.id);
  const overlaps = (x: number, y: number) => blockers.some((node) => x < node.position.x + nodeWidth(node) + gap
    && x + blockWidth + gap > node.position.x
    && y < node.position.y + nodeHeight(node) + gap
    && y + blockHeight + gap > node.position.y);
  let startY = target.position.y;
  for (let step = 0; step < 12 && overlaps(startX, startY); step += 1) startY += blockHeight + blockGap;
  return Array.from({ length: safeCount }, (_, index) => ({
    x: startX + (index % columns) * (imageWidth + gap),
    y: startY + Math.floor(index / columns) * (imageHeight + gap),
  }));
}

export const generatorEditorPanelWidth = 920;

export function generatorRunStartPatch(capability: 'image' | 'video' | 'audio' | 'model'): Partial<CanvasNodeData> {
  return {
    jobId: undefined,
    jobState: 'queued',
    jobStartedAt: new Date().toISOString(),
    progress: 0,
    comfyPreview: undefined,
    status: '正在提交任务',
    stale: false,
    cancelling: false,
    jobPollLost: false,
    ...(capability === 'model' ? { tripoPostprocessOperation: undefined } : {
      latestOutputs: [],
      latestMediaType: undefined,
      selectedOutput: 0,
      mediaUrl: undefined,
      fileName: undefined,
      mediaWidth: undefined,
      mediaHeight: undefined,
    }),
  };
}

export type GeneratorPanelDock = 'bottom' | 'top' | 'left' | 'right';

export function normalizeGeneratorPanelDock(value: unknown): GeneratorPanelDock {
  return ['bottom', 'top', 'left', 'right'].includes(String(value)) ? value as GeneratorPanelDock : 'bottom';
}

export function nearestGeneratorPanelDock(
  point: { x: number; y: number },
  nodeBounds: { left: number; right: number; top: number; bottom: number },
  current: GeneratorPanelDock = 'bottom',
): GeneratorPanelDock {
  const centerX = (nodeBounds.left + nodeBounds.right) / 2;
  const centerY = (nodeBounds.top + nodeBounds.bottom) / 2;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  if (Math.hypot(dx, dy) < 18) return current;
  const normalizedX = dx / Math.max(1, (nodeBounds.right - nodeBounds.left) / 2);
  const normalizedY = dy / Math.max(1, (nodeBounds.bottom - nodeBounds.top) / 2);
  if (Math.abs(normalizedX) > Math.abs(normalizedY)) return normalizedX < 0 ? 'left' : 'right';
  return normalizedY < 0 ? 'top' : 'bottom';
}

export function generatorPanelDockPosition({
  bounds, nodeBounds, preferredDock, panelWidth, panelHeight, viewportHeight,
}: {
  bounds: { left: number; right: number; top: number; bottom: number; width: number; height: number };
  nodeBounds: { left: number; right: number; top: number; bottom: number };
  preferredDock: GeneratorPanelDock;
  panelWidth: number;
  panelHeight: number;
  viewportHeight: number;
}) {
  const padding = 12;
  const gap = 16;
  const viewportBottom = Math.min(bounds.bottom, viewportHeight);
  const spaces: Record<GeneratorPanelDock, number> = {
    bottom: viewportBottom - nodeBounds.bottom - gap - padding,
    top: nodeBounds.top - bounds.top - gap - padding,
    left: nodeBounds.left - bounds.left - gap - padding,
    right: bounds.right - nodeBounds.right - gap - padding,
  };
  const minimum: Record<GeneratorPanelDock, number> = { bottom: 180, top: 180, left: 360, right: 360 };
  const requested = normalizeGeneratorPanelDock(preferredDock);
  const dock = spaces[requested] >= minimum[requested]
    ? requested
    : (Object.keys(spaces) as GeneratorPanelDock[]).sort((left, right) => (spaces[right] / minimum[right]) - (spaces[left] / minimum[left]))[0] ?? 'bottom';
  const verticalDock = dock === 'bottom' || dock === 'top';
  const width = verticalDock
    ? Math.min(panelWidth, Math.max(320, bounds.width - padding * 2))
    : Math.min(panelWidth, Math.max(280, spaces[dock]));
  const maxHeight = verticalDock
    ? Math.max(160, spaces[dock])
    : Math.max(180, viewportBottom - bounds.top - padding * 2);
  const centerX = (nodeBounds.left + nodeBounds.right) / 2;
  const centerY = (nodeBounds.top + nodeBounds.bottom) / 2;
  if (dock === 'bottom' || dock === 'top') {
    return {
      left: Math.max(bounds.left + width / 2 + padding, Math.min(centerX, bounds.right - width / 2 - padding)),
      top: dock === 'bottom' ? nodeBounds.bottom + gap : nodeBounds.top - gap,
      width,
      maxHeight,
      dock,
      panelPlacement: dock === 'bottom' ? 'below' as const : 'above' as const,
    };
  }
  const renderedHeight = Math.min(maxHeight, Math.max(180, panelHeight));
  return {
    left: dock === 'left' ? nodeBounds.left - gap : nodeBounds.right + gap,
    top: Math.max(bounds.top + padding + renderedHeight / 2, Math.min(centerY, viewportBottom - padding - renderedHeight / 2)),
    width,
    maxHeight,
    dock,
    panelPlacement: dock,
  };
}

export function generatorEditorPanelPosition({
  bounds, viewport, node, panelWidth, viewportHeight, screenNodeBounds,
}: {
  bounds: { left: number; right: number; top: number; width: number };
  viewport: { x: number; y: number; zoom: number };
  node: { position: { x: number; y: number }; width: number; height: number; kind: string };
  panelWidth: number;
  viewportHeight: number;
  screenNodeBounds?: { left: number; right: number; top: number; bottom: number };
}) {
  const rawLeft = screenNodeBounds
    ? (screenNodeBounds.left + screenNodeBounds.right) / 2
    : bounds.left + viewport.x + (node.position.x + node.width / 2) * viewport.zoom;
  const nodeScreenTop = screenNodeBounds?.top ?? bounds.top + viewport.y + node.position.y * viewport.zoom;
  const nodeScreenBottom = screenNodeBounds?.bottom ?? bounds.top + viewport.y + (node.position.y + node.height) * viewport.zoom;
  const viewportPadding = 12;
  const panelGap = 16;
  const belowTop = nodeScreenBottom + panelGap;
  const belowHeight = viewportHeight - belowTop - viewportPadding;
  // The editor is a screen-space overlay: it keeps its own UI scale and only
  // follows the selected node. Never mutate the canvas viewport to make room.
  const maxHeight = Math.max(180, belowHeight);
  const halfWidth = Math.min(panelWidth, Math.max(560, bounds.width - 38)) / 2;
  return {
    left: Math.max(bounds.left + halfWidth + 14, Math.min(rawLeft, bounds.right - halfWidth - 14)),
    top: belowTop,
    maxHeight,
    panelPlacement: 'below' as const,
    toolbarPlacement: 'above' as const,
  };
}

export function defaultGeneratorModel(models: ModelInfo[], capability: 'image' | 'video' | 'audio' | 'model'): ModelInfo | undefined {
  const candidates = models.filter((item) => item.capability === capability);
  if (capability === 'image') {
    return candidates.find((item) => item.id === 'gpt-image-2')
      || candidates.find((item) => /^gpt[-_ ]?image(?:2)?[-_ ]?1k$/i.test(item.name.replace(/\s+/g, '')))
      || candidates[0];
  }
  return candidates[0];
}

function isTripoP1Model(model?: ModelInfo) {
  return /(?:^|[^a-z0-9])p1(?:[^a-z0-9]|$)|p1-2026/i.test(`${model?.id || ''} ${model?.name || ''}`);
}

function generatorDefaults(models: ModelInfo[], capability: 'image' | 'video' | 'audio' | 'model') {
  const model = defaultGeneratorModel(models, capability);
  const profile = model?.profile;
  return {
    modelId: model?.id,
    ratio: model?.defaults?.ratio || profile?.defaultRatio || 'Auto',
    resolution: model?.defaults?.resolution || profile?.defaultResolution || (capability === 'image' ? '1K' : capability === 'video' ? '720P' : capability === 'audio' ? 'WAV' : 'STANDARD'),
    count: capability === 'image' ? profile?.count.default || 1 : 1,
    duration: capability === 'video' ? profile?.duration.default || 5 : 5,
    audioEnabled: capability === 'video' && profile?.audio !== false,
    ...(capability === 'model' ? { modelInputMode: 'text' as const, texture: true, pbr: true, textureQuality: 'standard' as const, geometryQuality: 'standard' as const, autoSize: false, exportUv: true, enableImageAutofix: false, textureAlignment: 'original_image' as const, orientation: 'default' as const } : {}),
    ...(capability === 'video' ? { videoInputMode: 'reference' as VideoInputMode } : {}),
    ...(capability === 'audio' ? { audioLanguage: 'zh' as const, audioSpeed: model?.audioOptions?.speed?.default || 1, audioReferenceText: '' } : {}),
  };
}

function comfyUiWorkflowDefaults(models: ModelInfo[]) {
  const model = models.find((item) => item.capability === 'image' && (item.workflows?.some((workflow) => workflow.capability === 'image' && workflow.editor === 'native') || item.workflow?.capability === 'image'));
  const workflow = model?.workflows?.[0] || model?.workflow;
  const profile = model?.profile;
  return {
    comfyUiNodeLayoutVersion: 2 as const,
    modelId: model?.id,
    workflowId: workflow?.id,
    ratio: model?.defaults?.ratio || profile?.defaultRatio || '3:4',
    resolution: model?.defaults?.resolution || profile?.defaultResolution || '1K',
    count: profile?.count.default || 1,
    duration: 5,
    audioEnabled: false,
    referenceDenoise: 0.72,
    comfySeedMode: 'random' as const,
    comfySteps: model?.comfyDefaults?.steps || 28,
    comfyCfg: model?.comfyDefaults?.cfg || 5.5,
    comfySampler: model?.comfyDefaults?.sampler || 'dpmpp_2m_sde',
    comfyScheduler: model?.comfyDefaults?.scheduler || 'karras',
    comfyDenoise: model?.comfyDefaults?.denoise || 1,
  };
}

export function continuationVideoSettings(models: ModelInfo[], source: Pick<CanvasNodeData, 'kind'> & Partial<CanvasNodeData>): Partial<CanvasNodeData> {
  const sourceModel = source.kind === 'videoGenerator' ? models.find((model) => model.id === source.modelId && model.capability === 'video') : undefined;
  return {
    ...generatorDefaults(models, 'video'),
    ...(sourceModel ? compatibleGeneratorSettings(sourceModel, source.ratio, source.resolution, 5) : {}),
    ...(source.kind === 'videoGenerator' ? { audioEnabled: source.audioEnabled, seed: source.seed, refImageSize: source.refImageSize, referenceVideoAudio: source.referenceVideoAudio, h3EncodingPreset: source.h3EncodingPreset, h3SamplingSteps: source.h3SamplingSteps, h3AccelerationMode: source.h3AccelerationMode, h3GuideTimes: source.h3GuideTimes, h3BlockCache: source.h3BlockCache, h3FaceRefine: source.h3FaceRefine } : {}),
    duration: 5,
    videoInputMode: 'first',
  };
}

export function normalizedVideoDuration(value: unknown, profile?: ModelInfo['profile'], fallback = 5): number {
  const minimum = Math.ceil(Number(profile?.duration.min) || fallback);
  const maximum = Math.floor(Number(profile?.duration.max) || minimum);
  const defaultValue = Math.round(Number(profile?.duration.default) || fallback);
  const requested = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(requested) ? Math.round(requested) : defaultValue));
}
export const mediaNodeHeight = (width: number, mediaWidth: number, mediaHeight: number) => Math.round(width * mediaHeight / mediaWidth);

function copyTitleInfo(title: string): { base: string; copyNumber?: number } {
  const trimmed = title.trim();
  const suffix = /(?:\s+副本(?:\s+\d+)*)+$/u.exec(trimmed);
  const base = (suffix ? trimmed.slice(0, suffix.index) : trimmed).trim() || '未命名节点';
  if (!suffix) return { base };
  const finalNumber = /副本\s+(\d+)\s*$/u.exec(trimmed);
  return { base, copyNumber: finalNumber ? Math.max(1, Number(finalNumber[1])) : 1 };
}

export function nextCopyTitle(sourceTitle: string, existingTitles: readonly string[]): string {
  const trimmed = sourceTitle.trim();
  const base = copyTitleInfo(trimmed).base;
  const copies = existingTitles.map(copyTitleInfo).filter((item) => item.base === base && item.copyNumber != null);
  if (!copies.length) return `${base} 副本`;
  const copyNumber = Math.max(copies.length, ...copies.map((item) => item.copyNumber || 1)) + 1;
  return `${base} 副本 ${copyNumber}`;
}

export function cloneCanvasNodeData(source: CanvasNodeData, title: string, preserveInputBindings = false): CanvasNodeData {
  const hasGeneratedResult = Boolean(
    source.mediaUrl
    || source.latestOutputs?.some((output) => output.mediaUrl)
    || source.outputs?.some((output) => output.mediaUrl)
    || source.resultVersions?.some((version) => version.outputs.some((output) => output.mediaUrl))
    || source.modelVersions?.some((version) => version.outputs.some((output) => output.mediaUrl))
    || (source.turnaroundConfirmed && source.turnaroundViews?.some((view) => view.mediaUrl)),
  );
  const isGenerator = ['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow'].includes(source.kind);
  return {
    ...source,
    title,
    jobId: undefined,
    jobState: hasGeneratedResult && isGenerator ? 'succeeded' : undefined,
    jobStartedAt: undefined,
    jobDeadlineAt: undefined,
    jobPollLost: false,
    cancelling: false,
    progress: hasGeneratedResult && isGenerator ? 100 : undefined,
    inputReferences: undefined,
    imageReferences: undefined,
    inputReferenceRoles: preserveInputBindings ? source.inputReferenceRoles : undefined,
  };
}

export function buildCollectionCloneWithInputs(
  sourceId: string,
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
  cloneToken: string,
  offset = 72,
): { collectionId: string; nodes: CanvasNode[]; edges: Edge[]; inputEdgeCount: number } | null {
  const source = nodes.find((node) => node.id === sourceId && node.data.kind === 'collection');
  if (!source) return null;
  const sourceMemberIds = (source.data.memberIds || []).filter((id) => nodes.some((node) => node.id === id));
  if (!sourceMemberIds.length) return null;
  const members = new Set(sourceMemberIds);
  const sourceMembers = sourceMemberIds.map((id) => nodes.find((node) => node.id === id)).filter((node): node is CanvasNode => Boolean(node));
  // A collection owns one uninterrupted layer range: frame first, then its
  // members. The cloned range starts above every existing package so no member
  // from another collection can appear between the cloned frame and contents.
  const collectionLayer = Math.max(
    2,
    ...nodes.map((node) => Number(node.zIndex) || 0),
    ...canvasNodePackageLayers(nodes).values(),
  ) + 1;
  const collectionId = `collection-${cloneToken}`;
  const idMap = new Map<string, string>([[source.id, collectionId]]);
  sourceMembers.forEach((node, index) => idMap.set(node.id, `${node.data.kind}-${cloneToken}-${index}`));
  const copiedGraphEdges = edges.filter((edge) => members.has(edge.target));
  const inputEdgeCount = copiedGraphEdges.filter((edge) => !members.has(edge.source)).length;
  const collectionTitle = nextCopyTitle(source.data.title, nodes.map((node) => node.data.title));
  const copiedMembers = sourceMembers.map((node, index) => {
    let data: CanvasNodeData = {
      ...cloneCanvasNodeData(node.data, node.data.title, true),
      jobId: undefined,
      jobState: undefined,
      jobStartedAt: undefined,
      jobDeadlineAt: undefined,
      jobPollLost: false,
      cancelling: false,
      progress: undefined,
      status: undefined,
    };
    data = remapTurnaroundClipboardSource(data, node.id, copiedGraphEdges, idMap);
    return {
      ...node,
      id: idMap.get(node.id)!,
      selected: false,
      position: { x: node.position.x + offset, y: node.position.y + offset },
      zIndex: collectionLayer + index + 1,
      data,
    };
  });
  const collection: CanvasNode = {
    ...source,
    id: collectionId,
    selected: true,
    position: { x: source.position.x + offset, y: source.position.y + offset },
    zIndex: collectionLayer,
    data: {
      ...source.data,
      title: collectionTitle,
      memberIds: sourceMemberIds.map((id) => idMap.get(id)!).filter(Boolean),
      workflowState: 'idle',
      workflowProgress: 0,
      workflowStatus: '已克隆，可运行',
      workflowFailedNodeIds: [],
    },
  };
  const copiedEdges = copiedGraphEdges.map((edge, index) => ({
    ...edge,
    id: `edge-collection-clone-${cloneToken}-${index}`,
    source: members.has(edge.source) ? idMap.get(edge.source)! : edge.source,
    target: idMap.get(edge.target)!,
    selected: false,
    data: { ...(edge.data || {}) },
  }));
  return {
    collectionId,
    nodes: fitStoredMediaNodes([collection, ...copiedMembers]),
    edges: copiedEdges,
    inputEdgeCount,
  };
}

export function promoteCanvasNodePackage(nodes: readonly CanvasNode[], activeId: string): CanvasNode[] {
  const active = nodes.find((node) => node.id === activeId);
  if (!active) return [...nodes];
  const collection = active.data.kind === 'collection'
    ? active
    : nodes.find((node) => node.data.kind === 'collection' && node.data.memberIds?.includes(activeId));
  const packageIds = new Set(collection ? [collection.id, ...(collection.data.memberIds || [])] : [activeId]);
  const currentLayers = canvasNodePackageLayers(nodes);
  const outsideLayer = Math.max(2, ...nodes
    .filter((node) => !packageIds.has(node.id))
    .flatMap((node) => [Number(node.zIndex) || 0, currentLayers.get(node.id) || 0]));
  if (!collection) {
    const activeLayer = outsideLayer + 1;
    return nodes.map((node) => node.id === activeId && node.zIndex !== activeLayer ? { ...node, zIndex: activeLayer } : node);
  }
  const collectionLayer = outsideLayer + 1;
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const orderedMembers = (collection.data.memberIds || [])
    .filter((id) => indexById.has(id))
    .sort((leftId, rightId) => {
      const left = nodes[indexById.get(leftId)!];
      const right = nodes[indexById.get(rightId)!];
      return (Number(left.zIndex) || 0) - (Number(right.zIndex) || 0)
        || indexById.get(leftId)! - indexById.get(rightId)!;
    });
  if (activeId !== collection.id && orderedMembers.includes(activeId)) {
    orderedMembers.splice(orderedMembers.indexOf(activeId), 1);
    orderedMembers.push(activeId);
  }
  const memberLayers = new Map(orderedMembers.map((id, index) => [id, collectionLayer + index + 1]));
  return nodes.map((node) => node.id === collection.id
    ? (node.zIndex === collectionLayer ? node : { ...node, zIndex: collectionLayer })
    : memberLayers.has(node.id)
      ? (node.zIndex === memberLayers.get(node.id) ? node : { ...node, zIndex: memberLayers.get(node.id) })
      : node);
}

export function canvasNodePackageLayers(nodes: readonly CanvasNode[]): Map<string, number> {
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const claimedMembers = new Set<string>();
  const packages: Array<{ collectionId?: string; ids: string[]; layer: number; order: number }> = [];
  nodes.filter((node) => node.data.kind === 'collection').forEach((collection) => {
    const members = (collection.data.memberIds || []).filter((id) => indexById.has(id));
    members.forEach((id) => claimedMembers.add(id));
    const ids = [collection.id, ...members];
    packages.push({
      collectionId: collection.id,
      ids,
      layer: Math.max(...ids.map((id) => Number(nodes[indexById.get(id)!].zIndex) || 0)),
      order: Math.max(...ids.map((id) => indexById.get(id)!)),
    });
  });
  nodes.forEach((node, index) => {
    if (node.data.kind === 'collection' || claimedMembers.has(node.id)) return;
    packages.push({ ids: [node.id], layer: Number(node.zIndex) || 0, order: index });
  });
  packages.sort((left, right) => left.layer - right.layer || left.order - right.order);
  const layers = new Map<string, number>();
  let nextLayer = 1;
  packages.forEach((item) => {
    if (item.collectionId) {
      layers.set(item.collectionId, nextLayer);
      // nextLayer + 1 is reserved for this collection's curves. Members
      // start above it, keeping frame -> curves -> nodes inside one package.
      item.ids
        .filter((id) => id !== item.collectionId)
        .sort((leftId, rightId) => {
          const left = nodes[indexById.get(leftId)!];
          const right = nodes[indexById.get(rightId)!];
          return (Number(left.zIndex) || 0) - (Number(right.zIndex) || 0)
            || indexById.get(leftId)! - indexById.get(rightId)!;
        })
        .forEach((id, index) => layers.set(id, nextLayer + index + 2));
      nextLayer += item.ids.length + 1;
      return;
    }
    layers.set(item.ids[0], nextLayer);
    nextLayer += 1;
  });
  return layers;
}

export function canvasPackageOwnershipSignature(nodes: readonly CanvasNode[]): string {
  return nodes
    .map((node) => `${node.id}:${node.data.kind}:${(node.data.memberIds || []).join(',')}`)
    .join('|');
}

export function canvasEdgePackageOwners(nodes: readonly CanvasNode[]): Map<string, string> {
  const collectionIds = new Set(nodes
    .filter((node) => node.data.kind === 'collection')
    .map((node) => node.id));
  const ownerByNode = new Map<string, string>();
  collectionIds.forEach((collectionId) => ownerByNode.set(collectionId, collectionId));
  nodes.forEach((node) => {
    if (node.data.kind !== 'collection') return;
    (node.data.memberIds || []).forEach((memberId) => {
      // A collection remains the owner of its own package even if malformed
      // legacy data also lists it as a member of another collection.
      if (!collectionIds.has(memberId)) ownerByNode.set(memberId, node.id);
    });
  });
  return ownerByNode;
}

export function canvasEdgePackageLayer(
  edge: Pick<Edge, 'source' | 'target'>,
  ownerByNode: ReadonlyMap<string, string>,
  nodeLayers: ReadonlyMap<string, number>,
): number {
  const owners = [...new Set([ownerByNode.get(edge.source), ownerByNode.get(edge.target)].filter((id): id is string => Boolean(id)))];
  if (!owners.length) return 0;
  // A boundary or cross-collection curve belongs to the upper package. It is
  // rendered directly above that frame and below every node inside it.
  return Math.max(...owners.map((id) => nodeLayers.get(id) || 0)) + 1;
}

export function normalizeLegacyCopyTitles(nodes: CanvasNode[]): CanvasNode[] {
  const copyCounts = new Map<string, number>();
  return nodes.map((node) => {
    const info = copyTitleInfo(node.data.title);
    if (info.copyNumber == null) return node;
    const copyNumber = (copyCounts.get(info.base) || 0) + 1;
    copyCounts.set(info.base, copyNumber);
    const title = copyNumber === 1 ? `${info.base} 副本` : `${info.base} 副本 ${copyNumber}`;
    return title === node.data.title ? node : { ...node, data: { ...node.data, title } };
  });
}

// Canvas video controls overlay the media surface, so the frame follows the decoded pixels exactly.
export const videoPlayerNodeHeight = (width: number, mediaWidth: number, mediaHeight: number) => mediaNodeHeight(width, mediaWidth, mediaHeight);

function fittedMediaNodeHeight(node: CanvasNode, width: number, mediaWidth: number, mediaHeight: number) {
  const hasVideoPlayer = node.data.kind === 'video'
    || node.data.kind === 'videoGenerator'
    || (node.data.kind === 'result' && (node.data.outputType === 'video' || node.data.mediaType === 'video'));
  return hasVideoPlayer
    ? videoPlayerNodeHeight(width, mediaWidth, mediaHeight)
    : mediaNodeHeight(width, mediaWidth, mediaHeight);
}

export function fitCanvasMediaNodeInCanvas(
  nodes: readonly CanvasNode[],
  id: string,
  mediaWidth: number,
  mediaHeight: number,
): CanvasNode[] {
  if (!Number.isFinite(mediaWidth) || !Number.isFinite(mediaHeight) || mediaWidth <= 0 || mediaHeight <= 0) return [...nodes];
  const target = nodes.find((node) => node.id === id && supportsAutomaticMediaFit(node.data.kind));
  if (!target) return [...nodes];
  const width = nodeWidth(target);
  const height = fittedMediaNodeHeight(target, width, mediaWidth, mediaHeight);
  if (
    Math.round(nodeHeight(target)) === height
    && Number(target.data.mediaWidth) === mediaWidth
    && Number(target.data.mediaHeight) === mediaHeight
  ) return nodes as CanvasNode[];
  const resized: CanvasNode = {
    ...target,
    width,
    height,
    measured: { width, height },
    style: { ...target.style, width, height },
    data: { ...target.data, mediaWidth, mediaHeight },
  };
  let next = nodes.map((node) => node.id === id ? resized : node);
  const owner = next.find((node) => node.data.kind === 'collection' && node.data.memberIds?.includes(id));
  if (!owner) return next;
  const expandedWidth = owner.data.collapsed ? owner.data.expandedWidth || owner.width || 360 : owner.measured?.width || owner.width || 360;
  const expandedHeight = owner.data.collapsed ? owner.data.expandedHeight || owner.height || 220 : owner.measured?.height || owner.height || 220;
  const frame = growCollectionFrameForNode({
    ...owner,
    width: expandedWidth,
    height: expandedHeight,
    measured: { width: expandedWidth, height: expandedHeight },
    data: { ...owner.data, collapsed: false },
  }, resized);
  if (!frame) return next;
  next = next.map((node) => {
    if (node.id !== owner.id) return node;
    if (owner.data.collapsed) {
      const right = Math.max(owner.position.x + expandedWidth, frame.position.x + frame.width);
      const bottom = Math.max(owner.position.y + expandedHeight, frame.position.y + frame.height);
      return {
        ...node,
        data: {
          ...node.data,
          expandedWidth: right - owner.position.x,
          expandedHeight: bottom - owner.position.y,
        },
      };
    }
    return {
      ...node,
      position: frame.position,
      width: frame.width,
      height: frame.height,
      measured: { width: frame.width, height: frame.height },
      style: { ...node.style, width: frame.width, height: frame.height },
      data: { ...node.data, expandedWidth: frame.width, expandedHeight: frame.height },
    };
  });
  return next;
}

function storedMediaDimensions(node: CanvasNode): { width: number; height: number } | null {
  let output: ResultOutput | undefined;
  if (node.data.kind === 'result') {
    const versions = node.data.resultVersions || [];
    const activeVersion = versions[node.data.selectedVersion ?? Math.max(0, versions.length - 1)];
    const outputs = activeVersion?.outputs || node.data.outputs || [];
    output = outputs[Math.min(node.data.selectedOutput || 0, Math.max(0, outputs.length - 1))]
      || outputs.find((item) => item.mediaUrl);
  } else if (node.data.kind === 'imageGenerator' || node.data.kind === 'videoGenerator' || node.data.kind === 'audioGenerator' || node.data.kind === 'comfyUiWorkflow') {
    const outputs = node.data.latestOutputs || [];
    output = outputs[Math.min(node.data.selectedOutput || 0, Math.max(0, outputs.length - 1))]
      || outputs.find((item) => item.mediaUrl);
  }
  const width = Number(output?.width ?? node.data.mediaWidth);
  const height = Number(output?.height ?? node.data.mediaHeight);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

/** Repairs legacy/default media frames from the persisted output dimensions. */
export function fitStoredMediaNodes(nodes: readonly CanvasNode[]): CanvasNode[] {
  let next = [...nodes];
  const mediaNodeIds = nodes
    .filter((node) => supportsAutomaticMediaFit(node.data.kind))
    .map((node) => node.id);
  mediaNodeIds.forEach((id) => {
    const node = next.find((item) => item.id === id);
    if (!node) return;
    const dimensions = storedMediaDimensions(node);
    if (dimensions) next = fitCanvasMediaNodeInCanvas(next, id, dimensions.width, dimensions.height);
  });
  return next;
}

function ratioValue(ratio: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(ratio);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

export function nearestSupportedRatio(width: number, height: number, supportedRatios: string[]): string | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const target = width / height;
  return supportedRatios
    .map((ratio, index) => ({ ratio, index, value: ratioValue(ratio) }))
    .filter((candidate): candidate is { ratio: string; index: number; value: number } => candidate.value != null)
    // Log distance treats portrait and landscape ratios symmetrically.
    .sort((left, right) => Math.abs(Math.log(left.value / target)) - Math.abs(Math.log(right.value / target)) || left.index - right.index)[0]
    ?.ratio;
}
const assetCategoryOptions: Array<{ id: AssetCategory; label: string }> = [
  { id: '3d-cartoon', label: '3D卡通' },
  { id: '3d-realistic', label: '3D写实' },
  { id: 'live-action', label: '真人实拍' },
  { id: '2d-illustration', label: '2D插画' },
  { id: '2d-animation', label: '2D动画' },
  { id: 'graphic', label: '平面 / 信息图形' },
  { id: 'gameplay-hybrid', label: '实机融合' },
  { id: 'general', label: '通用元素' },
  { id: 'uncategorized', label: '未分类' },
];

type Snapshot = { nodes: CanvasNode[]; edges: Edge[]; signature: string };
export type CanvasClipboardPayload = { sourceTaskId?: string; nodes: CanvasNode[]; edges: Edge[] };
type Clipboard = CanvasClipboardPayload;
type SaveState = '加载中' | '选择任务' | '已保存' | '有未保存更改' | '正在保存' | '保存失败' | '保存冲突' | '管理模式' | '会话无效';
type MenuPoint = { clientX: number; clientY: number; flowX: number; flowY: number };
type ConnectMenu = MenuPoint & { source: string; sourceHandle: string; outputType: DataType };
type ConnectionDecision = { error: string; replaceEdgeIds: string[]; targetHandle?: string };
type ReconnectSession = { edge: Edge; completed: boolean };
type BatchReferenceDrag = {
  pointerId: number;
  sourceIds: string[];
  start: { x: number; y: number };
  current: { x: number; y: number };
  targetId?: string;
};
type TaskInfo = { taskId: string; project: string; title: string; member: string };
type CanvasBoard = { id: string; title: string; createdAt: string; updatedAt: string; nodeCount: number };

export function canvasDocumentTitle(taskTitle: string) {
  const title = String(taskTitle || '').trim();
  return title ? `黑岩 HEIYAN 画布 · ${title}` : '黑岩 HEIYAN 画布';
}

export function canvasDocumentTitleForLanguage(taskTitle: string, language: CanvasInterfaceLanguage) {
  if (language === 'zh') return canvasDocumentTitle(taskTitle);
  const title = String(taskTitle || '').trim();
  const translatedTitle = title === '主画布' ? 'Main canvas' : title;
  return translatedTitle ? `HEIYAN · ${translatedTitle}` : 'HEIYAN · Infinite Creative Canvas';
}

export function shouldShowCanvasHome(pathname: string, search: string) {
  if (pathname !== '/') return false;
  const params = new URLSearchParams(search);
  return !params.has('task_id') && params.get('mode') !== 'admin-standalone' && params.get('view') !== 'agent' && !params.has('share');
}

function localStudioHref(panel?: 'settings' | 'comfyui' | 'data' | 'about') {
  const params = new URLSearchParams({ task_id: 'local-canvas', project: '本地项目', title: '主画布', member: '本机' });
  if (panel) params.set('panel', panel);
  return `/studio?${params.toString()}`;
}

const heiyanLetters = Array.from('HEIYAN');
const heiyanTitleGlyphs = Array.from('黑岩画布');

export function canvasHomeBranding(language: CanvasInterfaceLanguage) {
  return language === 'en'
    ? { title: 'HEIYAN', subtitle: 'INFINITE CREATIVE CANVAS' }
    : { title: '黑岩画布', subtitle: 'HEIYAN' };
}

function HeiyanLetterline() {
  return <i className="heiyan-letterline" aria-label="HEIYAN">{heiyanLetters.map((letter, index) => <span key={`${letter}-${index}`} aria-hidden="true">{letter}</span>)}</i>;
}

function HeiyanDotField() {
  return <div className="heiyan-dot-field" aria-hidden="true" />;
}

function CanvasHome() {
  const [theme, setTheme] = useState<CanvasTheme>(storedCanvasTheme);
  const [language, setLanguage] = useState<CanvasInterfaceLanguage>(storedCanvasInterfaceLanguage);
  const [showSettingsCenter, setShowSettingsCenter] = useState(false);
  const branding = canvasHomeBranding(language);
  const mobileCanvas = useMobileCanvas();
  const keepHomeSettingsLocal = useCallback(async () => undefined, []);
  useLayoutEffect(() => {
    document.title = language === 'en' ? 'HEIYAN · Infinite Creative Canvas' : '黑岩 HEIYAN 画布';
    applyCanvasThemeDocument(theme);
  }, [language, theme]);
  useEffect(() => {
    const preloadTimer = window.setTimeout(() => { void loadSettingsCenter(); }, 500);
    return () => window.clearTimeout(preloadTimer);
  }, []);
  useEffect(() => observeCanvasInterfaceLanguage(document.body, language), [language]);
  return <main className="echo-home" data-theme={theme} data-language={language} data-mobile={mobileCanvas.mobile || undefined}>
    <GlobalTooltip />
    <HeiyanDotField />
    <header className="echo-home-header">
      <a className="echo-home-brand" href="/" aria-label={language === 'en' ? 'HEIYAN canvas home' : '黑岩 HEIYAN 画布首页'}><img src="/echo-ai-canvas.svg" alt="" /><strong><span data-no-interface-translation>{branding.title}</span>{language === 'en' ? <small className="echo-home-brand-subtitle" data-no-interface-translation>{branding.subtitle}</small> : <HeiyanLetterline />}</strong></a>
      <div className="echo-home-utilities heiyan-utility-cluster top-actions">
        <button type="button" className={`echo-home-theme canvas-theme-toggle is-${theme}`} aria-label={theme === 'night' ? '切换到白昼模式' : '切换到夜间模式'} title={theme === 'night' ? '白昼模式' : '夜间模式'} onClick={(event) => transitionCanvasTheme(theme, setTheme, event.currentTarget)}><span className="theme-toggle-sky" aria-hidden="true"><span className="theme-toggle-stars"><i /><i /><i /></span><span className="theme-toggle-clouds"><i /><i /></span><span className="theme-toggle-orb"><i /><i /><i /></span></span></button>
        <button type="button" className="echo-home-utility-button canvas-language-toggle ui-icon-button" aria-label={language === 'zh' ? '切换到 English' : '切换到中文'} title={language === 'zh' ? '切换到 English' : '切换到中文'} onClick={() => setLanguage((current) => current === 'zh' ? 'en' : 'zh')}><UiIcon name="language" /><span aria-hidden="true">{language === 'zh' ? '中' : 'EN'}</span></button>
        <button type="button" className="echo-home-utility-button ui-icon-button" aria-label="打开设置中心" title="设置中心" onClick={() => setShowSettingsCenter(true)}><UiIcon name="settings" /></button>
        <span className="echo-home-version" title="当前开源版本">{canvasAppVersionLabel}</span>
        <a className="echo-home-github" href="https://github.com/castleinmysky/echo-canvas" target="_blank" rel="noreferrer noopener" aria-label="打开黑岩 HEIYAN 画布 GitHub 仓库" title="GitHub · 黑岩 HEIYAN 画布"><UiIcon name="github" /></a>
      </div>
    </header>
    {showSettingsCenter && <Suspense fallback={null}><SettingsCenter open={showSettingsCenter} initialSection="api" onClose={() => setShowSettingsCenter(false)} onModelsChanged={keepHomeSettingsLocal} version={canvasAppVersionLabel} language={language} /></Suspense>}
    <section className="echo-home-hero">
      <div className="echo-home-signal" aria-hidden="true"><i /><i /><i /></div>
      <h1 className={language === 'en' ? 'is-english' : undefined} data-no-interface-translation><span className={`echo-home-title-copy${language === 'en' ? ' is-english' : ''}`} aria-label={branding.title}>{language === 'en' ? branding.title : heiyanTitleGlyphs.map((glyph, index) => <span className="echo-home-title-glyph" aria-hidden="true" key={`${glyph}-${index}`}>{glyph}</span>)}</span>{language === 'en' ? <i className="echo-home-subtitle" aria-label={branding.subtitle}>{branding.subtitle}</i> : <HeiyanLetterline />}</h1>
      <p className="echo-home-tagline">连接文字、图像与生成模型，让每次生成直接成为下一步输入。</p>
      <div className="echo-home-actions">
        <a className="primary" href={localStudioHref()}>进入画布 <span aria-hidden="true">→</span></a>
      </div>
      <div className="echo-home-flow" aria-label="创作流程">
        <span><UiIcon name="text" />文字</span><i />
        <span><UiIcon name="image" />参考图</span><i />
        <span><UiIcon name="model" />生成模型</span><i />
        <span><UiIcon name="result" />结果</span>
      </div>
    </section>
    <footer className="echo-home-footer"><span>本地优先</span><i />无需账户<i />作品留在你的设备</footer>
  </main>;
}

type LibraryAsset = {
  id: string;
  project: string;
  name: string;
  type: string;
  imageUrl: string;
  imageName: string;
  imageWidth?: number;
  imageHeight?: number;
  tags?: string[];
  contentCategory?: string;
  groupId?: string;
  groupName?: string;
  isGroupCover?: boolean;
};
type LibraryAssetGroup = { id: string; name: string; variants: LibraryAsset[] };
type AssetCategory = '3d-cartoon' | '3d-realistic' | 'live-action' | '2d-illustration' | '2d-animation' | 'graphic' | 'gameplay-hybrid' | 'general' | 'uncategorized';
type CanvasConfirmation = {
  eyebrow: string;
  title: string;
  message: string;
  confirmLabel: string;
  tone: 'paid' | 'danger';
};
const contentAssetCategories = new Set<Exclude<AssetCategory, 'uncategorized'>>([
  '3d-cartoon', '3d-realistic', 'live-action', '2d-illustration', '2d-animation', 'graphic', 'gameplay-hybrid', 'general',
]);

function assetContentCategory(asset?: LibraryAsset): AssetCategory {
  const value = String(asset?.contentCategory || '').trim() as Exclude<AssetCategory, 'uncategorized'>;
  return contentAssetCategories.has(value) ? value : 'uncategorized';
}
type StoredCanvas = { nodes?: unknown[]; edges?: Edge[]; viewport?: Viewport; task?: TaskInfo; revision?: number };

export const defaultCanvasBoardId = 'main';
export function normalizedCanvasBoardId(value: unknown) {
  const id = String(value || defaultCanvasBoardId).trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id) ? id : defaultCanvasBoardId;
}
export function canvasExportFileName(value: unknown) {
  const title = String(value || '黑岩 HEIYAN 画布').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 64) || '黑岩 HEIYAN 画布';
  return `${title}.echo-canvas.json`;
}
export function taskCanvasUrl(taskId: string, canvasId = defaultCanvasBoardId, suffix = '') {
  const base = `/api/v1/canvas/${encodeURIComponent(taskId)}${suffix}`;
  return canvasId === defaultCanvasBoardId ? base : `${base}${suffix.includes('?') ? '&' : '?'}canvasId=${encodeURIComponent(canvasId)}`;
}
type JobOutput = { mediaType: 'image' | 'video' | 'audio' | 'model'; mediaUrl: string | null; fileName: string | null; metadata?: { simulated?: boolean; playable?: boolean; label?: string; width?: number; height?: number; duration?: number; previewUrl?: string; tripoTaskId?: string; seed?: number; codec?: string; bitDepth?: number; crf?: number; encodingPreset?: 'quality' | 'balanced' | 'compact' | 'quality10'; faceRefineRequested?: boolean; faceRefined?: boolean; faceRefineWarning?: string; referenceVideoAudio?: boolean; accelerationMode?: 'standard' | 'turbo' | 'reference8' | 'community8'; samplingSteps?: number; generationDurationMs?: number; queueDurationMs?: number; totalDurationMs?: number } };
type LocalH3QueueStatus = { available: boolean; state: 'idle' | 'busy' | 'queued' | 'running' | 'offline' | 'disabled'; mode?: 'direct' | 'relay'; autoStart?: boolean; concurrency: 1; running: number; queued: number; ahead: number; position: number; estimatedWaitSeconds: number; estimatedRunSeconds: number; error?: string; updatedAt?: string };
type Job = { id: string; nodeId: string; modelId?: string; status: 'queued' | 'running' | 'cancelling' | 'paused' | 'succeeded' | 'failed' | 'cancelled'; progress: number; stage?: string; error?: string; outputs: JobOutput[]; attempt: number; createdAt?: string; updatedAt?: string; deadlineAt?: string; timeoutMs?: number; options?: Record<string, unknown>; usage?: { creditsConsumed?: number; credits_consumed?: number }; localQueue?: LocalH3QueueStatus; comfyPreview?: ComfyUiSamplingPreview; tripoWorkflow?: { creditsConsumed?: number }; tripoPostprocessOperation?: string; postprocessResult?: TripoPostprocessResult; characterRuns?: TripoCharacterRun[]; activeCharacterRunId?: string; activeCharacterJobId?: string; activeCharacterJobRunId?: string; characterJobState?: CanvasNodeData['characterJobState']; characterProgress?: number; characterStatus?: string; activeCharacterOperation?: CanvasNodeData['activeCharacterOperation'] };

export function videoUpscaleFailureMessage(error: unknown) {
  const detail = String(error || '').trim();
  if (!detail) return '未知错误，请再试一次';
  if (detail.includes('FileExistsError') && /temp[\\/]+temp/i.test(detail)) {
    return '本地临时目录冲突，ComfyUI 没能启动。请点“再试一次”。';
  }
  if (detail.includes('本地 ComfyUI 启动失败') || detail.includes('ComfyUI 未启动')) {
    return '本地 ComfyUI 没能启动。请点“再试一次”；仍失败时再检查本地服务。';
  }
  return detail.length > 180 ? `${detail.slice(0, 177)}…` : detail;
}

export function videoUpscaleJobStatus(job: Pick<Job, 'status' | 'progress' | 'stage' | 'error' | 'localQueue'>, model: string, scale: number) {
  if (job.status === 'queued') {
    if (job.localQueue?.state === 'queued') return job.localQueue.ahead > 0 ? `等待处理 · 前方 ${job.localQueue.ahead} 个任务` : '等待本地处理';
    if (job.stage?.includes('启动') || job.stage?.includes('检查')) return job.stage;
    return '已加入高清放大队列';
  }
  if (job.status === 'running') return `Topaz ${model} 正在放大 · ${Math.round(job.progress || 0)}%`;
  if (job.status === 'cancelling') return '正在停止高清放大…';
  if (job.status === 'succeeded') return `高清放大完成 · ${model} · ${scale}×`;
  if (job.status === 'cancelled') return '高清放大已取消，可以重新开始';
  return `高清放大失败：${videoUpscaleFailureMessage(job.error)}`;
}

function canvasJobCreatedAt(job: Pick<Job, 'createdAt' | 'updatedAt'>) {
  const createdAt = Date.parse(String(job.createdAt || ''));
  if (Number.isFinite(createdAt)) return createdAt;
  const updatedAt = Date.parse(String(job.updatedAt || ''));
  return Number.isFinite(updatedAt) ? updatedAt : 0;
}

export function latestCanvasJobsByNode(jobs: readonly Job[]): Job[] {
  const latest = new Map<string, Job>();
  [...jobs]
    .sort((left, right) => canvasJobCreatedAt(right) - canvasJobCreatedAt(left) || String(right.id).localeCompare(String(left.id)))
    .forEach((job) => { if (job.nodeId && !latest.has(job.nodeId)) latest.set(job.nodeId, job); });
  return [...latest.values()];
}

function jobOutputSignature(outputs: readonly { mediaUrl?: string | null }[] | undefined) {
  return (outputs || []).map((output) => String(output.mediaUrl || '')).filter(Boolean).join('|');
}

export function canvasJobNeedsRefresh(data: Pick<CanvasNodeData, 'jobId' | 'jobState' | 'jobStartedAt' | 'jobPollLost' | 'progress' | 'latestOutputs' | 'comfyPreview'>, job: Job) {
  const currentJobId = String(data.jobId || '').trim();
  if (!currentJobId) return true;
  if (currentJobId === job.id) {
    if (data.jobState !== job.status || data.jobPollLost === true) return true;
    if (job.status === 'succeeded' && jobOutputSignature(data.latestOutputs) !== jobOutputSignature(job.outputs)) return true;
    if (Number(data.comfyPreview?.revision || 0) !== Number(job.comfyPreview?.revision || 0)) return true;
    if (Number(data.comfyPreview?.seed ?? -1) !== Number(job.comfyPreview?.seed ?? -1)) return true;
    if (Number(data.comfyPreview?.outputIndex ?? -1) !== Number(job.comfyPreview?.outputIndex ?? -1)) return true;
    return Number(data.progress || 0) !== Number(job.progress || 0) && ['queued', 'running', 'cancelling'].includes(job.status);
  }
  const currentStartedAt = Date.parse(String(data.jobStartedAt || ''));
  const remoteStartedAt = canvasJobCreatedAt(job);
  if (Number.isFinite(currentStartedAt) && remoteStartedAt) return remoteStartedAt >= currentStartedAt;
  return data.jobPollLost === true;
}

type CharacterJobMirror = Pick<Job, 'characterRuns' | 'activeCharacterRunId' | 'activeCharacterJobId' | 'activeCharacterJobRunId' | 'characterJobState' | 'characterProgress' | 'characterStatus' | 'activeCharacterOperation'> & Partial<Pick<Job, 'id' | 'status' | 'progress' | 'error' | 'tripoPostprocessOperation'>>;

export function isTripoCharacterOperation(operation?: string): operation is 'rig-check' | 'rig' | 'retarget' {
  return operation === 'rig-check' || operation === 'rig' || operation === 'retarget';
}

export function characterGeneratorEditorPanelPosition({
  bounds, viewport, node, viewportSize, panelWidth = 680,
}: {
  bounds: { left: number; right: number; top: number; width: number };
  viewport: { x: number; y: number; zoom: number };
  node: { position: { x: number; y: number }; width: number; height: number };
  viewportSize: { width: number; height: number };
  panelWidth?: number;
}) {
  const padding = 14;
  const gap = 16;
  const nodeScreenLeft = bounds.left + viewport.x + node.position.x * viewport.zoom;
  const nodeScreenRight = nodeScreenLeft + node.width * viewport.zoom;
  const nodeScreenTop = bounds.top + viewport.y + node.position.y * viewport.zoom;
  const availableRight = bounds.right - nodeScreenRight - gap - padding;
  const availableHeight = Math.max(320, viewportSize.height - padding * 2);
  const height = Math.min(720, availableHeight);
  const top = Math.max(padding, Math.min(nodeScreenTop, viewportSize.height - height - padding));

  // Keep the paid character workflow physically attached to the node. On normal
  // desktop canvases it always opens on the node's right; only a genuinely narrow
  // viewport falls back to an overlay so controls can never be clipped off-screen.
  if (viewportSize.width > 760 && availableRight >= 360) {
    return {
      left: nodeScreenRight + gap,
      top,
      width: Math.min(panelWidth, availableRight),
      height,
      placement: 'right' as const,
    };
  }

  const width = Math.min(panelWidth, Math.max(280, bounds.width - padding * 2));
  return {
    left: Math.max(bounds.left + padding, Math.min(nodeScreenRight + gap, bounds.right - width - padding)),
    top,
    width,
    height,
    placement: 'overlay' as const,
  };
}

export function characterRetryRequiresPaidConfirmation(operation?: string): boolean {
  return operation !== 'rig-check';
}

export function characterCanvasPatchFromJob(job: CharacterJobMirror): Partial<CanvasNodeData> {
  const patch: Partial<CanvasNodeData> = {};
  const operation = job.activeCharacterOperation
    || (isTripoCharacterOperation(job.tripoPostprocessOperation) ? job.tripoPostprocessOperation : undefined);
  const isCharacterResponse = Boolean(operation);
  if (Array.isArray(job.characterRuns)) patch.characterRuns = job.characterRuns;
  if (Object.prototype.hasOwnProperty.call(job, 'activeCharacterRunId')) patch.activeCharacterRunId = job.activeCharacterRunId;
  if (job.activeCharacterJobId || job.id) patch.activeCharacterJobId = job.activeCharacterJobId || job.id;
  if (Object.prototype.hasOwnProperty.call(job, 'activeCharacterJobRunId')) patch.activeCharacterJobRunId = job.activeCharacterJobRunId;
  if (Object.prototype.hasOwnProperty.call(job, 'characterJobState')) patch.characterJobState = job.characterJobState;
  else if (isCharacterResponse && job.status) patch.characterJobState = job.status;
  if (Object.prototype.hasOwnProperty.call(job, 'characterProgress')) patch.characterProgress = job.characterProgress;
  else if (isCharacterResponse && Number.isFinite(job.progress)) patch.characterProgress = job.progress;
  if (Object.prototype.hasOwnProperty.call(job, 'characterStatus')) patch.characterStatus = job.characterStatus;
  else if (isCharacterResponse && (job.error || job.status)) patch.characterStatus = job.error || String(job.status);
  if (Object.prototype.hasOwnProperty.call(job, 'activeCharacterOperation')) patch.activeCharacterOperation = job.activeCharacterOperation;
  else if (operation) patch.activeCharacterOperation = operation;
  return patch;
}

export function tripoPostprocessSourceTaskId(submission: TripoPostprocessSubmission, currentSourceTaskId: string): string {
  return isTripoCharacterOperation(submission.operation)
    ? String(submission.options.taskId || '').trim()
    : currentSourceTaskId;
}

export function markCanvasCharacterRunsStale(
  runs: readonly TripoCharacterRun[] | undefined,
  versions: readonly Pick<ModelGeneratorVersion, 'jobId'>[],
): TripoCharacterRun[] | undefined {
  if (!runs) return undefined;
  const liveVersionIds = new Set(versions.map((version) => version.jobId));
  return runs.map((run) => ({ ...run, stale: !liveVersionIds.has(run.sourceVersionJobId) }));
}

export function isActiveCanvasCharacterJob(
  data: Pick<CanvasNodeData, 'activeCharacterJobId' | 'characterJobState'>,
  jobId: string,
): boolean {
  return data.activeCharacterJobId === jobId
    && (data.characterJobState === 'queued' || data.characterJobState === 'running' || data.characterJobState === 'cancelling');
}

function modelOutputFormat(output?: ResultOutput, fallback = '') {
  return String(output?.format || output?.fileName?.match(/\.([a-z0-9]+)(?:$|[?#])/i)?.[1] || fallback).trim().toUpperCase();
}

export function tripoSubmittedOptionsFromJob(options?: Record<string, unknown>, submittedAt?: string): TripoSubmittedOptions | undefined {
  if (!options || (!('geometryQuality' in options) && !('textureQuality' in options) && !('workflow' in options))) return undefined;
  const resolution = String(options.resolution || '').toUpperCase() === 'DETAILED' ? 'DETAILED' : 'STANDARD';
  const geometryQuality = options.geometryQuality === 'detailed' || resolution === 'DETAILED' ? 'detailed' : 'standard';
  const textureQuality = options.textureQuality === 'extreme' ? 'extreme' : options.textureQuality === 'detailed' ? 'detailed' : 'standard';
  const texture = options.texture !== false;
  return {
    resolution,
    geometryQuality,
    texture,
    pbr: texture && options.pbr !== false,
    textureQuality,
    ...(options.workflow ? { workflow: String(options.workflow) } : {}),
    ...(options.modelVersion ? { modelVersion: String(options.modelVersion) } : {}),
    ...(submittedAt ? { submittedAt } : {}),
  };
}
export const canvasNodeClipboardMarker = 'echo-ai-canvas:nodes:v1';
export const canvasNodeClipboardFormat = 'web application/x-echo-ai-canvas-nodes';
export const canvasClipboardKeepaliveByteLimit = 60 * 1024;

export function canvasClipboardServerRequest(clipboard: CanvasClipboardPayload): { body: string; byteLength: number; keepalive: boolean } {
  const body = JSON.stringify({ sourceTaskId: clipboard.sourceTaskId, clipboard });
  const byteLength = new TextEncoder().encode(body).byteLength;
  return { body, byteLength, keepalive: byteLength <= canvasClipboardKeepaliveByteLimit };
}

export function serializeCanvasClipboardPayload(clipboard: CanvasClipboardPayload): string {
  return JSON.stringify({ version: 2, clipboard });
}

export function parseCanvasClipboardPayload(value: string): CanvasClipboardPayload | null {
  if (!value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as { clipboard?: CanvasClipboardPayload };
    const clipboard = parsed?.clipboard;
    if (!clipboard || !Array.isArray(clipboard.nodes) || !clipboard.nodes.length || !Array.isArray(clipboard.edges)) return null;
    if (clipboard.nodes.some((node) => !node || typeof node.id !== 'string' || !node.data || typeof node.data.kind !== 'string')) return null;
    return clipboard;
  } catch {
    return null;
  }
}

export function hasCanvasNodeClipboardMarker(clipboardText: string, clipboardTypes: readonly string[]): boolean {
  return clipboardText.trim() === canvasNodeClipboardMarker || clipboardTypes.includes(canvasNodeClipboardFormat);
}

export function canvasPasteSource(clipboardText: string, clipboardTypes: readonly string[], hasMedia: boolean, hasInternalNodes: boolean, canUseServerClipboard: boolean): 'nodes' | 'media' | 'external' {
  const hasNodeClipboard = hasInternalNodes || canUseServerClipboard;
  if (hasCanvasNodeClipboardMarker(clipboardText, clipboardTypes) && hasNodeClipboard) return 'nodes';
  if (hasMedia) return 'media';
  return hasNodeClipboard ? 'nodes' : 'external';
}

export function remapTurnaroundClipboardSource(
  data: CanvasNodeData,
  nodeId: string,
  edges: readonly Pick<Edge, 'source' | 'target'>[],
  idMap: ReadonlyMap<string, string>,
): CanvasNodeData {
  if (data.kind !== 'turnaroundSplitter') return data;
  const connectedSourceId = edges.find((edge) => edge.target === nodeId)?.source;
  const sourceId = data.turnaroundSourceNodeId && idMap.has(data.turnaroundSourceNodeId)
    ? data.turnaroundSourceNodeId
    : connectedSourceId;
  const remappedSourceId = sourceId ? idMap.get(sourceId) : undefined;
  return remappedSourceId ? { ...data, turnaroundSourceNodeId: remappedSourceId } : data;
}

const editableEventTargetSelector = 'input, textarea, select, [contenteditable="true"]';
const nodeRunShortcutBlockedTargetSelector = `${editableEventTargetSelector}, button, a, [role="button"], [role="menu"], [role="dialog"], [data-floating-layer]`;
const nodeRunShortcutKinds = new Set<CanvasNodeData['kind']>(['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow']);

export function isEditableEventTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  return Boolean(element?.closest?.(editableEventTargetSelector));
}

export function isNodeRunShortcutBlockedTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  return Boolean(element?.closest?.(nodeRunShortcutBlockedTargetSelector));
}

export function selectedGeneratorNodeIdForEnterShortcut(nodes: readonly CanvasNode[], input: { key: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; isComposing?: boolean; repeat?: boolean }): string | null {
  if (input.key !== 'Enter' || input.shiftKey || input.ctrlKey || input.altKey || input.metaKey || input.isComposing || input.repeat) return null;
  const selected = nodes.filter((node) => node.selected);
  if (selected.length !== 1 || !nodeRunShortcutKinds.has(selected[0].data.kind)) return null;
  if (selected[0].data.cancelling || ['queued', 'running', 'cancelling', 'paused'].includes(String(selected[0].data.jobState || ''))) return null;
  return selected[0].id;
}

export function canvasClipboardPlainText(nodes: readonly CanvasNode[]): string {
  if (nodes.length === 1 && nodes[0].data.kind === 'text' && nodes[0].data.text) return nodes[0].data.text;
  return canvasNodeClipboardMarker;
}

export type ClipboardImageSource = { mediaUrl: string; fileName?: string };

export function clipboardImageForNode(node?: CanvasNode, explicitMediaUrl?: string): ClipboardImageSource | null {
  if (!node) return null;
  if (node.data.kind === 'image' && node.data.mediaUrl) {
    const mediaUrl = explicitMediaUrl || node.data.mediaUrl;
    return { mediaUrl, fileName: nodeResourceDownloadFileName(node.data.title, node.data.fileName, mediaUrl, 'image') };
  }
  if ((node.data.kind === 'imageGenerator' || node.data.kind === 'comfyUiWorkflow') && node.data.latestMediaType !== 'video') {
    const outputs = node.data.latestOutputs || [];
    const output = node.data.latestOutputs?.find((item) => item.mediaUrl === explicitMediaUrl)
      || outputs[Math.min(node.data.selectedOutput || 0, Math.max(0, outputs.length - 1))]
      || outputs.find((item) => item.mediaUrl);
    return output?.mediaUrl ? { mediaUrl: output.mediaUrl, fileName: nodeResourceDownloadFileName(node.data.title, output.fileName, output.mediaUrl, 'image') } : null;
  }
  if (node.data.kind !== 'result') return null;
  const versions = node.data.resultVersions || [];
  const activeVersion = versions[node.data.selectedVersion ?? Math.max(0, versions.length - 1)];
  const mediaType = activeVersion?.mediaType || node.data.outputType || node.data.mediaType;
  if (mediaType !== 'image') return null;
  const outputs = activeVersion?.outputs || node.data.outputs || (node.data.mediaUrl ? [{ mediaUrl: node.data.mediaUrl, fileName: node.data.fileName }] : []);
  const explicit = outputs.find((item) => item.mediaUrl === explicitMediaUrl);
  const output = explicit || outputs[Math.min(node.data.selectedOutput || 0, Math.max(0, outputs.length - 1))];
  return output?.mediaUrl ? { mediaUrl: output.mediaUrl, fileName: nodeResourceDownloadFileName(node.data.title, output.fileName, output.mediaUrl, 'image') } : null;
}

export function downloadableVideoForNode(node?: CanvasNode, explicitMediaUrl?: string): ClipboardImageSource | null {
  if (!node) return null;
  if (node.data.kind === 'video' && node.data.mediaUrl) {
    const mediaUrl = explicitMediaUrl || node.data.mediaUrl;
    return { mediaUrl, fileName: videoDownloadFileName(node.data.title, node.data.fileName, mediaUrl) };
  }
  if (node.data.kind === 'videoGenerator' && node.data.latestMediaType === 'video') {
    const output = node.data.latestOutputs?.find((item) => item.mediaUrl === explicitMediaUrl)
      || node.data.latestOutputs?.find((item) => item.mediaUrl);
    return output?.mediaUrl ? { mediaUrl: output.mediaUrl, fileName: videoDownloadFileName(node.data.title, output.fileName, output.mediaUrl) } : null;
  }
  if (node.data.kind !== 'result') return null;
  const versions = node.data.resultVersions || [];
  const activeVersion = versions[node.data.selectedVersion ?? Math.max(0, versions.length - 1)];
  const mediaType = activeVersion?.mediaType || node.data.outputType || node.data.mediaType;
  if (mediaType !== 'video') return null;
  const outputs = activeVersion?.outputs || node.data.outputs || (node.data.mediaUrl ? [{ mediaUrl: node.data.mediaUrl, fileName: node.data.fileName }] : []);
  const explicit = outputs.find((item) => item.mediaUrl === explicitMediaUrl);
  const output = explicit || outputs[Math.min(node.data.selectedOutput || 0, Math.max(0, outputs.length - 1))];
  return output?.mediaUrl ? { mediaUrl: output.mediaUrl, fileName: videoDownloadFileName(node.data.title, output.fileName, output.mediaUrl) } : null;
}

async function clipboardPngBlob(mediaUrl: string): Promise<Blob> {
  const response = await window.fetch(new URL(mediaUrl, window.location.href), { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`图片读取失败（HTTP ${response.status}）`);
  const source = await response.blob();
  if (!source.type.startsWith('image/')) throw new Error('当前资源不是可复制的图片');
  if (source.type === 'image/png') return source;
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法转换图片格式');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片转换为 PNG 失败')), 'image/png'));
  } finally {
    bitmap.close();
  }
}

const colorEdge = (edge: Edge, type?: DataType): Edge => type ? { ...edge, data: { ...edge.data, dataType: type }, style: undefined } : edge;

const referenceTokenPrefix = (type: DataType) => type === 'image' ? '图片' : type === 'video' ? '视频' : type === 'audio' ? '音频' : type === 'text' ? '文本' : type === 'model' ? '模型' : '三视图集';

export function withStableReferenceTokens(edges: Edge[], nodes: CanvasNode[]) {
  const assigned = new Map<string, string>();
  const targets = new Set(edges.map((edge) => edge.target));
  targets.forEach((targetId) => {
    (['text', 'image', 'video', 'audio'] as DataType[]).forEach((type) => {
      const prefix = referenceTokenPrefix(type);
      const typedEdges = edges
        .filter((edge) => edge.target === targetId)
        .filter((edge) => {
          const source = nodes.find((node) => node.id === edge.source);
          return Boolean(source && outputTypeFor(source, edge.sourceHandle) === type);
        })
        .sort((a, b) => Number(a.data?.referenceOrder || 0) - Number(b.data?.referenceOrder || 0) || a.id.localeCompare(b.id));
      const tokenPattern = new RegExp(`^${prefix}(\\d+)$`);
      const firstOwner = new Map<string, string>();
      typedEdges.forEach((edge) => {
        const token = String(edge.data?.referenceToken || '');
        if (tokenPattern.test(token) && !firstOwner.has(token)) firstOwner.set(token, edge.id);
      });
      const used = new Set([...firstOwner.keys()].map((token) => Number(tokenPattern.exec(token)?.[1]) || 0).filter(Boolean));
      let next = 1;
      typedEdges.forEach((edge) => {
        const stored = String(edge.data?.referenceToken || '');
        if (tokenPattern.test(stored) && firstOwner.get(stored) === edge.id) return;
        while (used.has(next)) next += 1;
        assigned.set(edge.id, `${prefix}${next}`);
        used.add(next++);
      });
    });
  });
  return assigned.size ? edges.map((edge) => assigned.has(edge.id)
    ? { ...edge, data: { ...edge.data, referenceToken: assigned.get(edge.id) } }
    : edge) : edges;
}

function nextReferenceToken(edges: Edge[], targetId: string, type: DataType) {
  const prefix = referenceTokenPrefix(type);
  const used = new Set(edges
    .filter((edge) => edge.target === targetId)
    .map((edge) => new RegExp(`^${prefix}(\\d+)$`).exec(String(edge.data?.referenceToken || '')))
    .map((match) => Number(match?.[1]) || 0)
    .filter((value) => value > 0));
  let next = 1;
  while (used.has(next)) next += 1;
  return `${prefix}${next}`;
}

function stableReferenceToken(edge: Edge, type: DataType, fallbackIndex: number) {
  const prefix = referenceTokenPrefix(type);
  const stored = String(edge.data?.referenceToken || '');
  return new RegExp(`^${prefix}\\d+$`).test(stored) ? stored : `${prefix}${fallbackIndex}`;
}

export function referenceTokenAfterReconnect(edges: Edge[], oldEdge: Edge, targetId: string, type: DataType) {
  const prefix = referenceTokenPrefix(type);
  const stored = String(oldEdge.data?.referenceToken || '');
  if (oldEdge.target === targetId && new RegExp(`^${prefix}\\d+$`).test(stored)) return stored;
  return nextReferenceToken(edges.filter((edge) => edge.id !== oldEdge.id), targetId, type);
}
const stripPathClassName = (className?: string) => className?.split(/\s+/).filter((name) => name && name !== 'path-active' && name !== 'path-muted').join(' ') || undefined;
const supportedNodeKinds = new Set<SupportedCanvasNodeKind>(['text', 'image', 'video', 'audio', 'imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow', 'characterAnimator', 'turnaroundSplitter', 'result', 'collection']);

export function isCanvasNodeKind(value: unknown): value is SupportedCanvasNodeKind {
  return typeof value === 'string' && supportedNodeKinds.has(value as SupportedCanvasNodeKind);
}

export function collectionShortcutNodeIds(nodes: readonly CanvasNode[]): string[] {
  const selected = nodes.filter((node) => node.selected);
  if (selected.length < 2 || selected.some((node) => node.data.kind === 'collection')) return [];
  return selected.map((node) => node.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeResultVersion(existing: ResultVersion[] | undefined, version: ResultVersion): ResultVersion[] {
  const previous = existing || [];
  const match = previous.findIndex((item) => item.jobId === version.jobId);
  if (match < 0) return [...previous, version];
  return previous.map((item, index) => index === match ? version : item);
}

export function resultStateLabel(state?: ResultState) {
  return state === 'submitted' ? '已提交交付' : state === 'final' ? '最终成果' : state === 'candidate' ? '候选结果' : '生成结果';
}

export function layoutConnectedNodes(nodes: CanvasNode[], edges: Edge[], selectedIds: Set<string>): Map<string, { x: number; y: number }> {
  const selected = nodes.filter((node) => selectedIds.has(node.id));
  if (selected.length < 2) return new Map();
  const selectedSet = new Set(selected.map((node) => node.id));
  const incoming = new Map(selected.map((node) => [node.id, 0]));
  edges.forEach((edge) => { if (selectedSet.has(edge.source) && selectedSet.has(edge.target)) incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1); });
  const depth = new Map<string, number>();
  const queue = selected.filter((node) => (incoming.get(node.id) || 0) === 0).map((node) => node.id);
  if (!queue.length) queue.push(...selected.map((node) => node.id));
  queue.forEach((id) => depth.set(id, 0));
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    edges.filter((edge) => edge.source === source && selectedSet.has(edge.target)).forEach((edge) => {
      depth.set(edge.target, Math.max(depth.get(edge.target) || 0, (depth.get(source) || 0) + 1));
      incoming.set(edge.target, Math.max(0, (incoming.get(edge.target) || 0) - 1));
      if (incoming.get(edge.target) === 0) queue.push(edge.target);
    });
  }
  selected.forEach((node) => { if (!depth.has(node.id)) depth.set(node.id, 0); });
  const originX = Math.min(...selected.map((node) => node.position.x));
  const originY = Math.min(...selected.map((node) => node.position.y));
  const layers = new Map<number, CanvasNode[]>();
  selected.forEach((node) => layers.set(depth.get(node.id) || 0, [...(layers.get(depth.get(node.id) || 0) || []), node]));
  const orderedLayers = Array.from(layers.entries()).sort(([a], [b]) => a - b);
  const layerWidths = new Map(orderedLayers.map(([layer, layerNodes]) => [layer, Math.max(...layerNodes.map(nodeWidth))]));
  const positions = new Map<string, { x: number; y: number }>();
  let x = originX;
  orderedLayers.forEach(([layer, layerNodes]) => {
    let y = originY;
    layerNodes.sort((a, b) => a.position.y - b.position.y).forEach((node) => {
      positions.set(node.id, { x, y });
      y += nodeHeight(node) + 48;
    });
    x += (layerWidths.get(layer) || 0) + 96;
  });
  return positions;
}

type SelectionArrangeMode = 'left' | 'right' | 'top' | 'bottom' | 'spaceX';
export const selectionArrangeCollisionGap = 16;

export function selectionArrangeModeForShortcut(key: string): Exclude<SelectionArrangeMode, 'spaceX'> | null {
  if (key === 'ArrowLeft') return 'left';
  if (key === 'ArrowRight') return 'right';
  if (key === 'ArrowUp') return 'top';
  if (key === 'ArrowDown') return 'bottom';
  return null;
}

export function arrangeSelectedNodes(nodes: CanvasNode[], mode: SelectionArrangeMode, allNodes: readonly CanvasNode[] = nodes): Map<string, { x: number; y: number }> {
  if (nodes.length < 2) return new Map();
  const left = Math.min(...nodes.map((node) => node.position.x));
  const right = Math.max(...nodes.map((node) => node.position.x + nodeWidth(node)));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const bottom = Math.max(...nodes.map((node) => node.position.y + nodeHeight(node)));
  const positions = new Map<string, { x: number; y: number }>();
  const place = (node: CanvasNode, x = node.position.x, y = node.position.y) => positions.set(node.id, { x, y });
  const overlaps = (startA: number, endA: number, startB: number, endB: number) => startA < endB && endA > startB;
  const selectedIds = new Set(nodes.map((node) => node.id));
  const fixed = allNodes.filter((node) => (
    !selectedIds.has(node.id)
    && !(node.data.kind === 'collection' && node.data.memberIds?.some((id) => selectedIds.has(id)))
  ));
  const placedBounds = (node: CanvasNode) => {
    const position = positions.get(node.id) || node.position;
    return { x: position.x, y: position.y, width: nodeWidth(node), height: nodeHeight(node) };
  };
  const collidesWithRequiredGap = (start: number, size: number, blockerStart: number, blockerSize: number) => (
    start < blockerStart + blockerSize + selectionArrangeCollisionGap
    && start + size + selectionArrangeCollisionGap > blockerStart
  );
  const freeHorizontalPosition = (node: CanvasNode, start: number, direction: 1 | -1, placed: CanvasNode[]) => {
    let x = start;
    const blockers = [...fixed, ...placed].filter((candidate) => {
      const bounds = placedBounds(candidate);
      return overlaps(node.position.y, node.position.y + nodeHeight(node), bounds.y, bounds.y + bounds.height);
    });
    for (let pass = 0; pass <= blockers.length; pass += 1) {
      const collisions = blockers.filter((candidate) => {
        const bounds = placedBounds(candidate);
        return collidesWithRequiredGap(x, nodeWidth(node), bounds.x, bounds.width);
      });
      if (!collisions.length) break;
      x = direction === 1
        ? Math.max(...collisions.map((candidate) => { const bounds = placedBounds(candidate); return bounds.x + bounds.width + selectionArrangeCollisionGap; }))
        : Math.min(...collisions.map((candidate) => placedBounds(candidate).x)) - nodeWidth(node) - selectionArrangeCollisionGap;
    }
    return x;
  };
  const freeVerticalPosition = (node: CanvasNode, start: number, direction: 1 | -1, placed: CanvasNode[]) => {
    let y = start;
    const blockers = [...fixed, ...placed].filter((candidate) => {
      const bounds = placedBounds(candidate);
      return overlaps(node.position.x, node.position.x + nodeWidth(node), bounds.x, bounds.x + bounds.width);
    });
    for (let pass = 0; pass <= blockers.length; pass += 1) {
      const collisions = blockers.filter((candidate) => {
        const bounds = placedBounds(candidate);
        return collidesWithRequiredGap(y, nodeHeight(node), bounds.y, bounds.height);
      });
      if (!collisions.length) break;
      y = direction === 1
        ? Math.max(...collisions.map((candidate) => { const bounds = placedBounds(candidate); return bounds.y + bounds.height + selectionArrangeCollisionGap; }))
        : Math.min(...collisions.map((candidate) => placedBounds(candidate).y)) - nodeHeight(node) - selectionArrangeCollisionGap;
    }
    return y;
  };
  if (mode === 'left' || mode === 'right') {
    const ordered = [...nodes].sort((a, b) => (mode === 'left' ? 1 : -1) * (a.position.x - b.position.x) || a.position.y - b.position.y || a.id.localeCompare(b.id));
    ordered.forEach((node, index) => {
      const x = freeHorizontalPosition(node, mode === 'left' ? left : right - nodeWidth(node), mode === 'left' ? 1 : -1, ordered.slice(0, index));
      place(node, x, node.position.y);
    });
  }
  else if (mode === 'top' || mode === 'bottom') {
    const ordered = [...nodes].sort((a, b) => (mode === 'top' ? 1 : -1) * (a.position.y - b.position.y) || a.position.x - b.position.x || a.id.localeCompare(b.id));
    ordered.forEach((node, index) => {
      const y = freeVerticalPosition(node, mode === 'top' ? top : bottom - nodeHeight(node), mode === 'top' ? 1 : -1, ordered.slice(0, index));
      place(node, node.position.x, y);
    });
  }
  else if (mode === 'spaceX' && nodes.length > 2) {
    const ordered = [...nodes].sort((a, b) => a.position.x - b.position.x);
    const gap = Math.max(24, (right - left - ordered.reduce((sum, node) => sum + nodeWidth(node), 0)) / (ordered.length - 1));
    let x = left;
    ordered.forEach((node) => { place(node, x); x += nodeWidth(node) + gap; });
  }
  return positions;
}

export function withoutInputReferenceConnection(edges: readonly Edge[], targetId: string, edgeId: string): Edge[] {
  return edges.filter((edge) => !(edge.id === edgeId && edge.target === targetId));
}

export const defaultComfyUiWorkflowNodeTitle = 'ComfyUI 本地生图';

export function normalizeStoredNode(value: unknown, loadedModels: ModelInfo[]): CanvasNode | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null;

  const rawData = isRecord(value.data) ? value.data : {};
  const dataKind = rawData.kind;
  const nodeType = value.type;
  const historicalType = rawData.unsupportedType;
  const kind = isCanvasNodeKind(dataKind) ? dataKind : isCanvasNodeKind(nodeType) ? nodeType
    : dataKind === 'unsupported' && isCanvasNodeKind(historicalType) ? historicalType : 'unsupported';
  const rawPosition = isRecord(value.position) ? value.position : {};
  const x = typeof rawPosition.x === 'number' && Number.isFinite(rawPosition.x) ? rawPosition.x : 0;
  const y = typeof rawPosition.y === 'number' && Number.isFinite(rawPosition.y) ? rawPosition.y : 0;
  const unsupportedType = [dataKind, nodeType].find((candidate) => typeof candidate === 'string' && candidate.trim()) as string | undefined;
  const storedTitle = typeof rawData.title === 'string' ? rawData.title.trim() : '';
  const title = kind === 'comfyUiWorkflow' && storedTitle.replace(/\s+/g, '') === '高品质角色立绘·ComfyUI'
    ? defaultComfyUiWorkflowNodeTitle
    : storedTitle
      ? storedTitle
    : kind === 'unsupported'
      ? '无法识别的历史节点'
      : kind === 'comfyUiWorkflow'
        ? defaultComfyUiWorkflowNodeTitle
        : tools.find((tool) => tool.kind === kind)?.label || kind;

  const videoInputMode: VideoInputMode = kind === 'videoGenerator' && rawData.videoInputMode === 'first'
    ? 'first'
    : kind === 'videoGenerator' && (rawData.videoInputMode === 'first_last' || rawData.videoInputMode === 'frames')
      ? 'first_last'
      : 'reference';
  const storedHeadRatio = Number(rawData.characterHeadRatio);
  const isProportionGuide = rawData.systemAssetKind === 'character-proportion-guide'
    && characterTurnaroundHeadRatios.includes(storedHeadRatio as CharacterTurnaroundHeadRatio);
  const proportionPose: CharacterTurnaroundPose = rawData.characterPose === 'A-Pose' ? 'A-Pose' : 'T-Pose';
  const migrateComfyUiNodeLayout = kind === 'comfyUiWorkflow' && rawData.comfyUiNodeLayoutVersion !== 2;
  return {
    id: value.id,
    type: kind,
    position: { x, y },
    width: migrateComfyUiNodeLayout ? initialNodeWidth(kind) : typeof value.width === 'number' && Number.isFinite(value.width) ? value.width : initialNodeWidth(kind),
    height: migrateComfyUiNodeLayout ? initialNodeHeight(kind) : typeof value.height === 'number' && Number.isFinite(value.height) ? value.height : initialNodeHeight(kind),
    selected: false,
    data: {
      ...rawData,
      kind,
      title,
      models: loadedModels,
      ...(kind === 'comfyUiWorkflow' ? {
        comfyUiNodeLayoutVersion: 2 as const,
        collapsed: undefined,
        expandedWidth: undefined,
        expandedHeight: undefined,
        posePreviewState: rawData.posePreviewUrl ? 'ready' as const : 'idle' as const,
        posePreviewError: undefined,
      } : {}),
      ...(kind === 'videoGenerator' ? { videoInputMode } : {}),
      ...(isProportionGuide ? {
        mediaUrl: characterProportionGuideUrl(storedHeadRatio, proportionPose),
        fileName: characterProportionGuideFileName(storedHeadRatio, proportionPose),
        characterHeadRatio: storedHeadRatio,
        characterPose: proportionPose,
      } : {}),
      ...(kind === 'result' && typeof rawData.selectedVersion !== 'number' && typeof rawData.selectedVersionIndex === 'number' ? { selectedVersion: rawData.selectedVersionIndex } : {}),
      ...(kind !== 'unsupported' && dataKind === 'unsupported' ? { unsupportedType: undefined, diagnostic: undefined } : {}),
      ...(kind === 'unsupported' ? {
        unsupportedType: unsupportedType || '未知',
        diagnostic: '节点类型缺失或不受当前版本支持',
      } : {}),
    } as CanvasNodeData,
  };
}

const outputTypeFor = (node: CanvasNode, handle?: string | null) => {
  void handle;
  if (node.data.kind === 'unsupported') return undefined;
  if (node.data.kind === 'result') return node.data.outputType;
  if (node.data.kind === 'turnaroundSplitter' && !node.data.turnaroundConfirmed) return undefined;
  return portDefinitions[node.data.kind].outputs[0]?.type;
};

export function reconcileComfyUiWorkflowInputEdges(
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
  targetId: string,
  workflow: Pick<ComfyUiWorkflowInfo, 'inputPorts'>,
): { edges: Edge[]; remappedCount: number; removedCount: number } {
  const imagePorts = (workflow.inputPorts || []).filter((port) => port.accepts.includes('image'));
  const incomingImageEdges = edges
    .filter((edge) => {
      const source = nodes.find((node) => node.id === edge.source);
      return edge.target === targetId && Boolean(source) && outputTypeFor(source!) === 'image';
    })
    .sort((a, b) => Number(a.data?.referenceOrder || 0) - Number(b.data?.referenceOrder || 0) || a.id.localeCompare(b.id));
  if (!incomingImageEdges.length) return { edges: [...edges], remappedCount: 0, removedCount: 0 };

  const removeIds = new Set<string>();
  const targetHandleByEdgeId = new Map<string, string>();
  const proposals = incomingImageEdges.flatMap((edge) => {
    const previousHandle = String(edge.targetHandle || '');
    const previousRole = localMediaBindingRoleForPort(previousHandle);
    const exactPort = imagePorts.find((port) => port.id === previousHandle);
    const semanticPort = imagePorts.find((port) => (port.bindingRole || localMediaBindingRoleForPort(port.id)) === previousRole);
    const port = exactPort || semanticPort || (imagePorts.length === 1 ? imagePorts[0] : undefined);
    if (!port) {
      removeIds.add(edge.id);
      return [];
    }
    const priority = exactPort ? 0 : semanticPort ? 1 : 2;
    return [{ edge, port, priority }];
  });
  imagePorts.forEach((port) => {
    const capacity = Math.max(1, Math.min(8, Number(port.maxImages) || 1));
    const candidates = proposals
      .filter((proposal) => proposal.port.id === port.id)
      .sort((a, b) => a.priority - b.priority
        || Number(a.edge.data?.referenceOrder || 0) - Number(b.edge.data?.referenceOrder || 0)
        || a.edge.id.localeCompare(b.edge.id));
    candidates.slice(0, capacity).forEach(({ edge }) => targetHandleByEdgeId.set(edge.id, port.id));
    candidates.slice(capacity).forEach(({ edge }) => removeIds.add(edge.id));
  });

  let remappedCount = 0;
  const nextEdges = edges.flatMap((edge) => {
    if (removeIds.has(edge.id)) return [];
    const nextHandle = targetHandleByEdgeId.get(edge.id);
    if (!nextHandle || edge.targetHandle === nextHandle) return [edge];
    remappedCount += 1;
    return [{ ...edge, targetHandle: nextHandle }];
  });
  return { edges: nextEdges, remappedCount, removedCount: removeIds.size };
}

export function collectionReplacementPayload(source: CanvasNode, expectedType: WorkflowCollectionInputSlot['type']) {
  if (expectedType === 'text') {
    const text = source.data.kind === 'text' ? String(source.data.text || '') : '';
    return text ? { text, status: '组输入已替换' } : null;
  }
  if (expectedType === 'imageSet') {
    return source.data.kind === 'turnaroundSplitter' && source.data.turnaroundConfirmed
      ? { status: '组输入已替换' }
      : null;
  }
  const candidateOutputs = source.data.kind === 'result'
    ? source.data.outputs || []
    : source.data.latestOutputs || [];
  const selectedIndex = ['result', 'imageGenerator', 'comfyUiWorkflow'].includes(source.data.kind)
    ? Math.max(0, Number(source.data.selectedOutput) || 0)
    : 0;
  const selectedOutput = candidateOutputs[selectedIndex] || candidateOutputs.find((output) => output.mediaUrl);
  const mediaUrl = String(source.data.mediaUrl || selectedOutput?.mediaUrl || '').trim();
  if (!mediaUrl) return null;
  return {
    mediaUrl,
    mediaType: expectedType,
    outputType: expectedType,
    fileName: String(source.data.fileName || selectedOutput?.fileName || '').trim() || undefined,
    mediaDuration: ['video', 'audio'].includes(expectedType) ? Math.max(0, Number(source.data.mediaDuration) || 0) : undefined,
    status: '组输入已替换',
  } satisfies Partial<CanvasNodeData>;
}

export function replaceCollectionInputGraph(
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
  slot: WorkflowCollectionInputSlot,
  sourceId: string,
  sourceHandle: string,
  patch: Partial<CanvasNodeData>,
) {
  const replacementMediaUrl = slot.type === 'text' ? undefined : String(patch.mediaUrl || '');
  const legacyCollection = nodes.find((node) => node.data.kind === 'collection'
    && slot.nodeIds.some((nodeId) => node.data.memberIds?.includes(nodeId)));
  const legacyMembers = new Set(legacyCollection?.data.memberIds || []);
  const internalEdgeIds = legacyCollection
    ? edges.filter((edge) => slot.nodeIds.includes(edge.source) && legacyMembers.has(edge.target)).map((edge) => edge.id)
    : [];
  const replacementEdgeIds = new Set([...slot.boundaryEdgeIds, ...internalEdgeIds]);
  const nextEdges = edges.map((edge) => replacementEdgeIds.has(edge.id)
    ? { ...edge, source: sourceId, sourceHandle, data: { ...(edge.data || {}), ...(replacementMediaUrl ? { sourceMediaUrl: replacementMediaUrl } : {}) } }
    : edge);
  const changedRoots = new Set<string>(slot.nodeIds);
  const staleIds = new Set<string>();
  replacementEdgeIds.forEach((edgeId) => {
    const edge = nextEdges.find((item) => item.id === edgeId);
    if (edge) {
      changedRoots.add(edge.target);
      staleIds.add(edge.target);
    }
  });
  const visit = (id: string) => nextEdges.filter((edge) => edge.source === id).forEach((edge) => {
    if (staleIds.has(edge.target)) return;
    staleIds.add(edge.target);
    visit(edge.target);
  });
  changedRoots.forEach((id) => visit(id));
  const nextNodes = nodes.map((node) => legacyCollection && node.id === legacyCollection.id
    ? { ...node, data: { ...node.data, memberIds: (node.data.memberIds || []).filter((id) => !slot.nodeIds.includes(id)) } }
    : slot.nodeIds.includes(node.id) && !legacyCollection
      ? { ...node, data: { ...node.data, ...patch } }
    : staleIds.has(node.id) && (node.data.jobState === 'succeeded' || node.data.kind === 'result')
      ? { ...node, data: { ...node.data, stale: true, status: '组输入已替换，结果可能过期' } }
      : node);
  return { nodes: nextNodes, edges: nextEdges };
}

export function planCollectionInputReplacement(nodes: readonly CanvasNode[], edges: readonly Edge[], collectionId: string, slotId: string, sourceId: string, sourceHandle = 'output') {
  const fail = (error: string) => ({ error, changed: false, nodes: [...nodes], edges: [...edges], usageCount: 0 });
  const collection = nodes.find(node => node.id === collectionId && node.data.kind === 'collection');
  const source = nodes.find(node => node.id === sourceId);
  if (!collection || !source) return fail('组输入已经变化，请重新拖入');
  const members = new Set(collection.data.memberIds || []);
  if (members.has(sourceId)) return fail('请使用组外的新输入节点进行替换');
  if (['running', 'cancelling'].includes(String(collection.data.workflowState)) || nodes.some(node => members.has(node.id) && ['queued', 'running', 'cancelling'].includes(String(node.data.jobState)))) return fail('组内仍有任务执行中，暂时不能替换输入');
  const slot = collectionInputSlots(nodes, edges, [...members]).find(item => item.id === slotId);
  if (!slot) return fail('组输入已经变化，请重新拖入');
  const output = resolveGeneratorSourceOutput(nodes, edges, sourceId);
  if (outputTypeFor(source, sourceHandle) !== slot.type) return fail('新来源与该输入的类型不兼容');
  if (!output.value && slot.type !== 'imageSet') return fail('新输入节点还没有可用内容');
  const edgeIds = new Set([...slot.boundaryEdgeIds, ...edges.filter(edge => slot.nodeIds.includes(edge.source) && members.has(edge.target)).map(edge => edge.id)]);
  const affected = edges.filter(edge => edgeIds.has(edge.id) && members.has(edge.target));
  if (!affected.length) return fail('该入口已没有可替换的引用');
  if (affected.every(edge => edge.source === sourceId && (edge.sourceHandle || 'output') === sourceHandle)) return fail('该入口已经引用这个节点');
  const workingEdges = edges.filter(edge => !edgeIds.has(edge.id));
  const replacements = new Map<string, Edge>();
  for (const edge of affected) {
    const connection = { source: sourceId, sourceHandle, target: edge.target, targetHandle: edge.targetHandle || null };
    const decision = evaluateConnection(connection, [...nodes], workingEdges);
    if (decision.error) return fail('无法替换组输入：' + decision.error);
    const data = { ...(edge.data || {}) };
    delete data.sourceMediaUrl; delete data.sourceVersion; delete data.cacheKey; delete data.lineage;
    if (data.pinSourceMedia && output.value) { data.sourceMediaUrl = output.value; data.sourceVersion = output.value; }
    const next = { ...edge, ...connection, targetHandle: decision.targetHandle || edge.targetHandle, data };
    replacements.set(edge.id, next); workingEdges.push(next);
  }
  const nextEdges = edges.map(edge => replacements.get(edge.id) || edge);
  const stale = new Set(affected.map(edge => edge.target)), queue = [...stale];
  while (queue.length) { const id = queue.shift()!; for (const edge of nextEdges) if (edge.source === id && !stale.has(edge.target)) { stale.add(edge.target); queue.push(edge.target); } }
  const nextNodes = nodes.map(node => stale.has(node.id) ? { ...node, data: { ...node.data, stale: true, status: '引用已替换，重新生成后更新结果' } } : node);
  return { error: '', changed: true, nodes: nextNodes, edges: nextEdges, usageCount: affected.length };
}

function defaultInputPort(kind: CanvasNodeData['kind'], type: DataType, data?: CanvasNodeData) {
  return runtimeInputPorts(kind, data).find((port) => port.accepts.includes(type))?.id;
}

export function nearestCanvasInputPort(
  pointerY: number,
  handles: readonly { id: string; top: number; height: number }[],
): string | undefined {
  return [...handles]
    .filter((handle) => handle.id && Number.isFinite(handle.top) && Number.isFinite(handle.height) && handle.height > 0)
    .sort((left, right) => Math.abs(left.top + left.height / 2 - pointerY) - Math.abs(right.top + right.height / 2 - pointerY))[0]?.id;
}

function migrateStoredInputPort(target: CanvasNode | undefined, sourceType: DataType | undefined, handle?: string | null) {
  if (!target || !sourceType) return undefined;
  const ports = runtimeInputPorts(target.data.kind, target.data);
  const stored = ports.find((port) => port.id === handle && port.accepts.includes(sourceType));
  return stored?.id || ports.find((port) => port.accepts.includes(sourceType))?.id;
}

export type GeneratorInput = {
  port: string;
  type: DataType;
  value: string;
  duration?: number;
  sourceId?: string;
  referenceToken?: string;
  guideFrame?: number;
  bindingVersion?: 1;
  role?: LocalMediaBindingRole;
  bindingMethod?: LocalMediaBindingMethod;
  versionPolicy?: LocalMediaVersionPolicy;
  sourceVersion?: string;
  strength?: number;
  preparation?: string;
  cacheKey?: string;
};

type GeneratorSourceOutput = { type?: DataType; value?: string; previewUrl?: string; width?: number; height?: number; duration?: number };

function pinnedMediaUrlForEdge(edge: Edge, target: CanvasNode | undefined) {
  const explicitlyPinned = edge.data?.pinSourceMedia === true || Boolean(edge.data?.lineage);
  const snapshotTarget = target?.data.kind === 'turnaroundSplitter' || target?.data.kind === 'result';
  return explicitlyPinned || snapshotTarget ? String(edge.data?.sourceMediaUrl || '') : '';
}

function liveReferenceEdgeData(data: Edge['data']): Edge['data'] {
  if (!data || (!Object.prototype.hasOwnProperty.call(data, 'sourceMediaUrl')
    && !Object.prototype.hasOwnProperty.call(data, 'sourceVersion')
    && !Object.prototype.hasOwnProperty.call(data, 'pinSourceMedia'))) return data;
  const next = { ...data };
  delete next.sourceMediaUrl;
  delete next.sourceVersion;
  delete next.pinSourceMedia;
  return next;
}

export function inputReferenceVersionEdgeData(
  data: Edge['data'],
  policy: LocalMediaVersionPolicy,
  sourceMediaUrl = '',
): Edge['data'] {
  const next: Record<string, unknown> = { ...(data || {}), mediaBindingVersion: LOCAL_MEDIA_BINDING_VERSION };
  if (policy === 'locked') {
    const sourceVersion = String(sourceMediaUrl || next.sourceMediaUrl || '').trim();
    if (!sourceVersion) return next as Edge['data'];
    next.pinSourceMedia = true;
    next.sourceMediaUrl = sourceVersion;
    next.sourceVersion = sourceVersion;
    return next as Edge['data'];
  }
  if (!next.lineage) {
    delete next.pinSourceMedia;
    delete next.sourceMediaUrl;
    delete next.sourceVersion;
  }
  return next as Edge['data'];
}

function localMediaWorkflowForNode(target: CanvasNode | undefined) {
  if (!target || !['imageGenerator', 'comfyUiWorkflow'].includes(target.data.kind)) return undefined;
  const selectedModel = target.data.models?.find((model) => model.id === target.data.modelId)
    || target.data.models?.find((model) => ['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(model.adapter || ''));
  const workflows = selectedModel?.workflows?.length ? selectedModel.workflows : selectedModel?.workflow ? [selectedModel.workflow] : [];
  return {
    model: selectedModel,
    workflow: workflows.find((workflow) => workflow.id === target.data.workflowId) || workflows[0],
  };
}

function localMediaInputMetadata(target: CanvasNode | undefined, port: string, edge: Edge) {
  const selection = localMediaWorkflowForNode(target);
  const workflowPort = selection?.workflow?.inputPorts?.find((candidate) => candidate.id === port && candidate.accepts.includes('image'));
  const role = workflowPort?.bindingRole || localMediaBindingRoleForPort(port);
  const bindingMethod = workflowPort?.bindingMethod || localMediaBindingMethodForPort(selection?.workflow, port, { family: selection?.model?.localImageFamily });
  const sourceVersion = String(edge.data?.sourceVersion || edge.data?.sourceMediaUrl || '');
  const numericStrength = Number(edge.data?.referenceStrength);
  return {
    bindingVersion: LOCAL_MEDIA_BINDING_VERSION,
    role,
    bindingMethod,
    versionPolicy: edge.data?.pinSourceMedia === true ? 'locked' as const : 'latest' as const,
    ...(sourceVersion ? { sourceVersion } : {}),
    ...(Number.isFinite(numericStrength) ? { strength: Math.max(0, Math.min(2, numericStrength)) } : {}),
    ...(workflowPort?.preparation ? { preparation: workflowPort.preparation } : {}),
  };
}

function resolveGeneratorSourceOutput(
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
  sourceId: string,
  pinnedMediaUrl = '',
  visited = new Set<string>(),
): GeneratorSourceOutput {
  if (visited.has(sourceId)) return {};
  visited.add(sourceId);
  const source = nodes.find((node) => node.id === sourceId);
  if (!source) return {};
  const sourceWidth = Number(source.data.mediaWidth) > 0 ? Number(source.data.mediaWidth) : undefined;
  const sourceHeight = Number(source.data.mediaHeight) > 0 ? Number(source.data.mediaHeight) : undefined;
  const duration = Math.min(15, Math.max(0, Number(source.data.mediaDuration) || 0));
  const pinnedType = source.data.kind === 'result'
    ? source.data.outputType || source.data.mediaType
    : source.data.latestMediaType || outputTypeFor(source);
  if (pinnedMediaUrl && pinnedType && ['image', 'video', 'audio', 'model'].includes(pinnedType)) {
    const pinnedOutput = source.data.latestOutputs?.find((output) => output.mediaUrl === pinnedMediaUrl);
    return { type: pinnedType, value: pinnedMediaUrl, previewUrl: pinnedOutput?.previewUrl, width: Number(pinnedOutput?.width) || sourceWidth, height: Number(pinnedOutput?.height) || sourceHeight, ...(pinnedType === 'video' && duration ? { duration } : {}) };
  }
  if (source.data.kind === 'result' && !source.data.mediaUrl) {
    const passthrough = edges.find((edge) => edge.target === sourceId);
    return passthrough ? resolveGeneratorSourceOutput(nodes, edges, passthrough.source, String(passthrough.data?.sourceMediaUrl || ''), visited) : {};
  }
  if (source.data.kind === 'characterAnimator') {
    const runs = source.data.characterRuns || [];
    const activeRun = runs.find((run) => run.id === source.data.activeCharacterRunId) || runs[0];
    const fallback = preferredInteractiveModelOutput(source.data.latestOutputs || []);
    const output = preferredCharacterPreviewOutput(activeRun, fallback);
    if (output?.mediaUrl) return { type: 'model', value: output.mediaUrl };
  }
  if (source.data.kind === 'imageGenerator' || source.data.kind === 'videoGenerator' || source.data.kind === 'audioGenerator' || source.data.kind === 'modelGenerator' || source.data.kind === 'comfyUiWorkflow') {
    const outputs = source.data.latestOutputs || [];
    const latest = pinnedMediaUrl
      ? outputs.find((output) => output.mediaUrl === pinnedMediaUrl)
      : source.data.kind === 'imageGenerator' || source.data.kind === 'comfyUiWorkflow'
        ? outputs[Math.min(source.data.selectedOutput || 0, Math.max(0, outputs.length - 1))] || outputs.find((output) => output.mediaUrl)
        : outputs.find((output) => output.mediaUrl);
    if (latest?.mediaUrl) return {
      type: source.data.latestMediaType || (source.data.kind === 'imageGenerator' || source.data.kind === 'comfyUiWorkflow' ? 'image' : source.data.kind === 'videoGenerator' ? 'video' : source.data.kind === 'audioGenerator' ? 'audio' : 'model'),
      value: latest.mediaUrl,
      previewUrl: latest.previewUrl,
      width: Number(latest.width) || sourceWidth,
      height: Number(latest.height) || sourceHeight,
      ...(source.data.latestMediaType === 'video' && duration ? { duration } : {}),
    };
    const generated = edges
      .filter((edge) => edge.source === sourceId)
      .map((edge) => nodes.find((node) => node.id === edge.target))
      .find((node) => node?.data.kind === 'result' && Boolean(node.data.mediaUrl));
    if (generated) return { type: generated.data.outputType || generated.data.mediaType, value: generated.data.mediaUrl, previewUrl: generated.data.previewUrl, width: Number(generated.data.mediaWidth) || undefined, height: Number(generated.data.mediaHeight) || undefined };
  }
  const type = source.data.kind === 'text' ? 'text' : source.data.outputType || source.data.mediaType || (source.data.kind === 'image' ? 'image' : source.data.kind === 'video' ? 'video' : source.data.kind === 'audio' ? 'audio' : undefined);
  return { type, value: type === 'text' ? source.data.text : source.data.mediaUrl, previewUrl: source.data.previewUrl, width: sourceWidth, height: sourceHeight, ...(type === 'video' && duration ? { duration } : {}) };
}

export function canvasInputReferencesFromGraph(graphNodes: readonly CanvasNode[], graphEdges: readonly Edge[], nodeId: string): InputReference[] {
  const counters: Record<DataType, number> = { text: 0, image: 0, imageSet: 0, video: 0, audio: 0, model: 0 };
  const references: InputReference[] = [];
  const target = graphNodes.find((node) => node.id === nodeId);
  const disabledMultiviewPorts = new Set<string>(target?.data.disabledMultiviewPorts || []);
  graphEdges.filter((edge) => edge.target === nodeId).sort((a, b) => Number(a.data?.referenceOrder || 0) - Number(b.data?.referenceOrder || 0) || a.id.localeCompare(b.id)).forEach((edge, index) => {
    const source = graphNodes.find((node) => node.id === edge.source);
    if (source?.data.kind === 'turnaroundSplitter' && source.data.turnaroundConfirmed) {
      if (source.data.turnaroundViews?.length !== 3) return;
      const viewLabels: Record<string, string> = { front: '正面', left: '左侧', right: '右侧', back: '背面' };
      (source.data.turnaroundViews || []).filter((view) => !disabledMultiviewPorts.has(view.role)).forEach((view, viewIndex) => references.push({
        index: index * 4 + viewIndex + 1,
        type: 'image',
        token: view.role,
        label: viewLabels[view.role] || view.role,
        sourceId: edge.source,
        port: view.role,
        edgeId: edge.id,
        mediaUrl: view.mediaUrl,
        referenceRole: target?.data.inputReferenceRoles?.[view.role] || 'character',
      }));
      return;
    }
    const type = source ? outputTypeFor(source, edge.sourceHandle) : undefined;
    if (!type) return;
    counters[type] += 1;
    const token = stableReferenceToken(edge, type, counters[type]);
    const storedRole = target?.data.inputReferenceRoles?.[token];
    const referenceRole = type !== 'image' ? undefined : ['character', 'prop', 'scene'].includes(String(storedRole)) ? 'character' : ['storyboard', 'first_frame', 'last_frame'].includes(String(storedRole)) ? 'storyboard' : 'picture';
    const resolved = resolveGeneratorSourceOutput(graphNodes, graphEdges, edge.source, pinnedMediaUrlForEdge(edge, target));
    const port = edge.targetHandle || '';
    const localMedia = type === 'image' ? localMediaInputMetadata(target, port, edge) : undefined;
    references.push({ index: index + 1, type, token, label: source?.data.title || `输入 ${index + 1}`, sourceId: edge.source, port, edgeId: edge.id, mediaUrl: ['image', 'video', 'audio'].includes(type) ? resolved.value : undefined, previewUrl: ['image', 'video'].includes(type) ? resolved.previewUrl : undefined, mediaWidth: type === 'image' ? resolved.width : undefined, mediaHeight: type === 'image' ? resolved.height : undefined, duration: type === 'video' || type === 'audio' ? resolved.duration : undefined, text: type === 'text' ? resolved.value : source?.data.text, referenceRole, ...(localMedia ? { mediaBindingRole: localMedia.role, mediaBindingMethod: localMedia.bindingMethod, mediaVersionPolicy: localMedia.versionPolicy, sourceVersion: localMedia.sourceVersion, referenceStrength: localMedia.strength } : {}) });
  });
  return references;
}

export function turnaroundGeneratorInputs(node: CanvasNode, disabledPorts: readonly string[] = []): GeneratorInput[] {
  if (node.data.kind !== 'turnaroundSplitter' || !node.data.turnaroundConfirmed || node.data.turnaroundViews?.length !== 3) return [];
  const disabled = new Set(disabledPorts);
  return (node.data.turnaroundViews || []).flatMap((view) => view.mediaUrl && !disabled.has(view.role) ? [{
    port: view.role,
    type: 'image' as const,
    value: view.mediaUrl,
    sourceId: node.id,
    referenceToken: view.role,
  }] : []);
}

export function filterPromptImageInputs(inputs: GeneratorInput[], prompt: string): GeneratorInput[] {
  void prompt;
  return inputs;
}

export function collectGeneratorInputsFromGraph(nodes: readonly CanvasNode[], edges: readonly Edge[], id: string): GeneratorInput[] {
  const counters: Partial<Record<DataType, number>> = {};
  const targetNode = nodes.find((node) => node.id === id);
  const disabledMultiviewPorts = targetNode?.data.disabledMultiviewPorts || [];
  return edges.filter((edge) => edge.target === id).sort((a, b) => Number(a.data?.referenceOrder || 0) - Number(b.data?.referenceOrder || 0) || a.id.localeCompare(b.id)).flatMap((edge) => {
    const source = nodes.find((node) => node.id === edge.source);
    if (source?.data.kind === 'turnaroundSplitter') return turnaroundGeneratorInputs(source, disabledMultiviewPorts);
    const output = resolveGeneratorSourceOutput(nodes, edges, edge.source, pinnedMediaUrlForEdge(edge, targetNode));
    if (!output.type || !output.value) return [];
    counters[output.type] = (counters[output.type] || 0) + 1;
    const referenceToken = ['image', 'video', 'audio', 'text'].includes(output.type)
      ? stableReferenceToken(edge, output.type, counters[output.type] || 1)
      : undefined;
    const port = edge.targetHandle || '';
    const localMedia = output.type === 'image' ? localMediaInputMetadata(targetNode, port, edge) : undefined;
    return [{
      port, type: output.type, value: String(output.value), sourceId: edge.source,
      ...(referenceToken ? { referenceToken } : {}),
      ...(localMedia || {}),
      ...(!['first', 'first_last'].includes(targetNode?.data.videoInputMode || '') && ['image', 'video', 'audio'].includes(output.type) && Number.isFinite(Number(targetNode?.data.h3GuideTimes?.[edge.id])) ? { guideFrame: Math.round(Number(targetNode?.data.h3GuideTimes?.[edge.id]) * 24) } : {}),
      ...(output.type === 'video' && output.duration ? { duration: output.duration } : {}),
    }];
  });
}

export function replaceInputReferenceInGraph(
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
  targetId: string,
  edgeId: string,
  sourceId: string,
): { changed: boolean; edges: Edge[]; error: string; sourceLabel?: string } {
  const oldEdge = edges.find((edge) => edge.id === edgeId && edge.target === targetId);
  const source = nodes.find((node) => node.id === sourceId);
  const sourceOutput = source ? resolveGeneratorSourceOutput(nodes, edges, source.id) : {};
  if (!oldEdge || !source || sourceOutput.type !== 'image' || !sourceOutput.value) {
    return { changed: false, edges: [...edges], error: '所选图片当前没有可用输出' };
  }
  if (oldEdge.source === sourceId) return { changed: false, edges: [...edges], error: '', sourceLabel: source.data.title || '所选图片' };
  const connection: Connection = { source: sourceId, sourceHandle: 'output', target: targetId, targetHandle: oldEdge.targetHandle ?? null };
  const decision = evaluateConnection(connection, [...nodes], [...edges], oldEdge.id);
  if (decision.error) {
    return { changed: false, edges: [...edges], error: decision.error === '禁止重复连接' ? '该图片已经被当前节点引用' : decision.error };
  }
  const next = withStableReferenceTokens(edges.map((edge) => edge.id === edgeId ? colorEdge({
    ...edge,
    source: sourceId,
    sourceHandle: 'output',
    data: liveReferenceEdgeData(edge.data),
    reconnectable: 'target',
  }, 'image') : edge), [...nodes]);
  return { changed: true, edges: next, error: '', sourceLabel: source.data.title || '所选图片' };
}

export function resolvePromptTextReferences(authoredPrompt: string, inputs: GeneratorInput[]) {
  let resolved = authoredPrompt;
  const referenced = new Set<GeneratorInput>();
  for (const input of inputs.filter((candidate) => candidate.type === 'text' && candidate.value)) {
    const alias = input.referenceToken ? `@${input.referenceToken}` : '';
    if (alias && resolved.includes(alias)) {
      resolved = resolved.replaceAll(alias, input.value);
      referenced.add(input);
    }
  }
  const remaining = inputs
    .filter((input) => input.type === 'text' && (input.port === 'prompt' || input.port === 'input') && !referenced.has(input))
    .map((input) => input.value);
  return [resolved, ...remaining].filter(Boolean).join('\n');
}

export function canonicalizeImageReferenceSubmission(prompt: string, inputs: GeneratorInput[]) {
  const images = inputs
    .map((input, index) => ({ input, index, ordinal: /^图片(\d+)$/.exec(String(input.referenceToken || '')) }))
    .filter((item) => item.input.type === 'image')
    .sort((left, right) => (Number(left.ordinal?.[1]) || Number.MAX_SAFE_INTEGER) - (Number(right.ordinal?.[1]) || Number.MAX_SAFE_INTEGER) || left.index - right.index);
  if (!images.length) return { prompt, inputs };
  const tokenMap = new Map<string, string>();
  const canonicalImages = images.map(({ input }, index) => {
    const oldToken = String(input.referenceToken || `图片${index + 1}`);
    const nextToken = `图片${index + 1}`;
    tokenMap.set(oldToken, nextToken);
    return { ...input, referenceToken: nextToken };
  });
  const canonicalPrompt = String(prompt || '')
    .replace(/@图片\d+/g, (token) => `@${tokenMap.get(token.slice(1)) || token.slice(1)}`)
    .replace(/\{\{\s*(?:Image|Picture)\s*(\d+)\s*\}\}/gi, (_token, ordinal) => `@${tokenMap.get(`图片${ordinal}`) || `图片${ordinal}`}`)
    .replace(/<Picture\s+(\d+)>/gi, (_token, ordinal) => `@${tokenMap.get(`图片${ordinal}`) || `图片${ordinal}`}`);
  return { prompt: canonicalPrompt, inputs: [...inputs.filter((input) => input.type !== 'image'), ...canonicalImages] };
}

export function mapVideoMaterialInputs(inputs: GeneratorInput[], mode: VideoInputMode): GeneratorInput[] {
  const prompts = inputs.filter((input) => input.type === 'text').map((input) => ({ ...input, port: 'prompt' }));
  const materials = inputs.filter((input) => input.type !== 'text').map((input) => ({ ...input, port: 'material' }));
  if (mode === 'reference') return [...prompts, ...materials.map((input) => ({ ...input, port: 'reference' }))];
  if (materials.some((input) => input.type !== 'image')) throw new Error(`${mode === 'first' ? '单首帧' : '首帧＋尾帧'}模式仅支持图片素材，请切换至全能参考`);
  const expectedImageCount = mode === 'first' ? 1 : 2;
  if (materials.length !== expectedImageCount) throw new Error(mode === 'first'
    ? '单首帧模式需要恰好一张图片'
    : '首帧＋尾帧模式需要恰好两张图片，接入顺序为首帧→尾帧');
  return mode === 'first'
    ? [...prompts, { ...materials[0], port: 'first_frame' }]
    : [...prompts, { ...materials[0], port: 'first_frame' }, { ...materials[1], port: 'last_frame' }];
}

export function supportsAutomaticMediaFit(kind: CanvasNodeData['kind']) {
  return ['image', 'video', 'result', 'imageGenerator', 'videoGenerator', 'comfyUiWorkflow'].includes(kind);
}

export function evaluateConnection(connection: Connection, nodes: CanvasNode[], edges: Edge[], ignoredEdgeId?: string): ConnectionDecision {
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  const relevantEdges = edges.filter((edge) => edge.id !== ignoredEdgeId);
  if (!source || !target || !connection.sourceHandle || !connection.targetHandle) return { error: '连接端口无效', replaceEdgeIds: [] };
  if (source.data.kind === 'unsupported' || target.data.kind === 'unsupported') return { error: '不支持的历史节点不能参与连接', replaceEdgeIds: [] };
  if (source.id === target.id) return { error: '禁止节点自连', replaceEdgeIds: [] };
  const seen = new Set<string>();
  const visit = (id: string): boolean => id === source.id || (!seen.has(id) && (seen.add(id), relevantEdges.filter((edge) => edge.source === id).some((edge) => visit(edge.target))));
  if (visit(target.id)) return { error: '连接会形成环路', replaceEdgeIds: [] };
  const outputType = outputTypeFor(source, connection.sourceHandle);
  // Handle ids from older canvases are accepted, while type decides whether the target can consume the edge.
  const targetInputs = runtimeInputPorts(target.data.kind, target.data);
  const requestedInput = targetInputs.find((port) => port.id === connection.targetHandle);
  const input = requestedInput || targetInputs.find((port) => Boolean(outputType && port.accepts.includes(outputType)));
  const targetHandle = input?.id || connection.targetHandle;
  if (relevantEdges.some((edge) => edge.source === source.id && edge.target === target.id && edge.sourceHandle === connection.sourceHandle && edge.targetHandle === targetHandle)) return { error: '禁止重复连接', replaceEdgeIds: [] };
  if (!outputType || !input?.accepts.includes(outputType)) {
    return { error: `类型不兼容：${outputType || '未知'} 无法连接到 ${input?.label || '目标端口'}`, replaceEdgeIds: [] };
  }
  if (outputType === 'audio' && ['videoGenerator', 'audioGenerator'].includes(target.data.kind)) {
    if (target.data.kind === 'videoGenerator' && ['first', 'first_last'].includes(String(target.data.videoInputMode))) return { error: '首帧模式仅支持图片素材，请切换至全能参考', replaceEdgeIds: [] };
    const model = target.data.models?.find((item) => item.id === target.data.modelId && item.capability === (target.data.kind === 'audioGenerator' ? 'audio' : 'video'));
    if (!model?.profile?.audioInput) return { error: target.data.kind === 'audioGenerator' ? '当前音频模型不支持参考音色' : '当前视频模型不支持参考音频', replaceEdgeIds: [] };
    const existingAudioEdges = relevantEdges.filter((edge) => edge.target === target.id && outputTypeFor(nodes.find((node) => node.id === edge.source)!, edge.sourceHandle) === 'audio');
    const maximumAudios = target.data.kind === 'audioGenerator' ? 1 : 3;
    if (existingAudioEdges.length >= maximumAudios) return { error: target.data.kind === 'audioGenerator' ? '参考音色一次只能连接一段音频' : '全能参考最多支持三段独立参考音频', replaceEdgeIds: [] };
  }
  if (target.data.kind === 'comfyUiWorkflow' && outputType === 'image') {
    const existingPortEdges = relevantEdges.filter((edge) => edge.target === target.id
      && edge.targetHandle === targetHandle
      && outputTypeFor(nodes.find((node) => node.id === edge.source)!, edge.sourceHandle) === 'image');
    if (existingPortEdges.length) return { error: `${input?.label || '参考图'}端口只能连接 1 张图`, replaceEdgeIds: [] };
  }
  if (target.data.kind === 'videoGenerator' && ['first', 'first_last'].includes(String(target.data.videoInputMode)) && outputType === 'video') {
    return { error: '首帧模式仅支持图片素材，请切换至全能参考', replaceEdgeIds: [] };
  }
  if (target.data.kind === 'videoGenerator' && outputType === 'video') {
    const existingVideoEdges = relevantEdges.filter((edge) => edge.target === target.id && outputTypeFor(nodes.find((node) => node.id === edge.source)!, edge.sourceHandle) === 'video');
    const model = target.data.models?.find((item) => item.id === target.data.modelId && item.capability === 'video');
    const maximumVideos = model?.adapter === 'comfyui-minimax-h3' ? 3 : 1;
    if (existingVideoEdges.length >= maximumVideos) return { error: maximumVideos === 3 ? '本地 H3 全能参考最多支持三段参考视频' : '当前视频模型只支持一个视频输入', replaceEdgeIds: [] };
  }
  const replaceEdgeIds = input?.multiple ? [] : relevantEdges.filter((edge) => edge.target === target.id && edge.targetHandle === targetHandle).map((edge) => edge.id);
  return { error: '', replaceEdgeIds, targetHandle };
}

export function agentConnectionForNodes(sourceId: string, targetId: string, nodes: CanvasNode[]): Connection {
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  if (!source || !target) throw new Error('连接节点不在当前画布中');
  const sourceHandle = 'output';
  const sourceType = outputTypeFor(source, sourceHandle);
  if (!sourceType) throw new Error('来源节点没有可连接的输出');
  const targetHandle = defaultInputPort(target.data.kind, sourceType, target.data);
  if (!targetHandle) throw new Error(`目标节点没有兼容 ${sourceType} 的输入端口`);
  return { source: sourceId, sourceHandle, target: targetId, targetHandle };
}

export type SelectedCloneMode = 'with-inputs' | 'next-step';
export type SelectedClonePlan = {
  nodes: CanvasNode[];
  edges: Edge[];
  connectedCount: number;
  skipped: Array<{ id: string; reason: string }>;
};

export function nextStepNodeTitle(sourceTitle: string, existingTitles: readonly string[]) {
  const trimmed = sourceTitle.trim() || '未命名节点';
  const base = trimmed.replace(/\s*·\s*下一步(?:\s+\d+)?\s*$/u, '').trim() || '未命名节点';
  const prefix = `${base} · 下一步`;
  const used = existingTitles.flatMap((title) => {
    const match = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s+(\\d+))?$`, 'u').exec(title.trim());
    return match ? [match[1] ? Math.max(2, Number(match[1])) : 1] : [];
  });
  return used.length ? `${prefix} ${Math.max(...used) + 1}` : prefix;
}

function freshNextStepNodeData(data: CanvasNodeData): CanvasNodeData {
  return {
    ...data,
    jobId: undefined,
    jobState: undefined,
    jobStartedAt: undefined,
    jobDeadlineAt: undefined,
    jobPollLost: false,
    cancelling: false,
    progress: undefined,
    status: undefined,
    stale: false,
    latestOutputs: undefined,
    generationVersions: undefined,
    latestMediaType: undefined,
    modelVersions: undefined,
    selectedModelVersion: undefined,
    modelExportVersions: undefined,
    modelExportFormat: undefined,
    modelExportSourceTaskId: undefined,
    modelExportSourceVersion: undefined,
    characterRuns: undefined,
    activeCharacterRunId: undefined,
    activeCharacterJobId: undefined,
    activeCharacterJobRunId: undefined,
    characterJobState: undefined,
    characterProgress: undefined,
    characterStatus: undefined,
    activeCharacterOperation: undefined,
    characterDrafts: undefined,
  };
}

/**
 * Clones a selected subgraph as one visual group. "with-inputs" keeps every
 * edge entering the selection (and remaps internal edges). "next-step" keeps
 * settings and layout, then connects each original output to its own clone
 * when that clone has a compatible input.
 */
export function buildSelectedClonePlan(
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
  selectedIds: readonly string[],
  mode: SelectedCloneMode,
  cloneToken: string,
  gap = 96,
): SelectedClonePlan {
  const expandedIds = expandedCollectionSelection(nodes, new Set(selectedIds));
  const sources = nodes.filter((node) => expandedIds.has(node.id));
  if (!sources.length) return { nodes: [], edges: [], connectedCount: 0, skipped: [] };
  const minX = Math.min(...sources.map((node) => node.position.x));
  const right = Math.max(...sources.map((node) => node.position.x + nodeWidth(node)));
  const offsetX = right - minX + gap;
  const idMap = new Map(sources.map((node, index) => [node.id, `${node.data.kind}-${cloneToken}-${index}`]));
  const existingTitles = nodes.map((node) => node.data.title);
  const sourceEdges = mode === 'with-inputs' ? edges.filter((edge) => expandedIds.has(edge.target)) : [];
  const firstCloneLayer = Math.max(2, ...nodes.map((node) => Number(node.zIndex) || 0), ...canvasNodePackageLayers(nodes).values()) + 1;
  const minimumSourceLayer = Math.min(...sources.map((node) => Number(node.zIndex) || 0));
  const copies = sources.map((node) => {
    const title = mode === 'next-step'
      ? nextStepNodeTitle(node.data.title, existingTitles)
      : nextCopyTitle(node.data.title, existingTitles);
    existingTitles.push(title);
    let data = cloneCanvasNodeData(node.data, title, mode === 'with-inputs');
    data = remapTurnaroundClipboardSource(data, node.id, sourceEdges, idMap);
    data = remapCollectionMemberIds(data, idMap);
    if (data.kind === 'collection') Object.assign(data, { workflowState: 'idle', workflowProgress: 0, workflowStatus: mode === 'next-step' ? '已创建下一步' : '已带输入克隆', workflowFailedNodeIds: [] });
    return {
      ...node,
      id: idMap.get(node.id)!,
      selected: true,
      position: { x: node.position.x + offsetX, y: node.position.y },
      zIndex: firstCloneLayer + Math.max(0, (Number(node.zIndex) || 0) - minimumSourceLayer),
      data,
    };
  });
  const copyBySourceId = new Map(sources.map((source, index) => [source.id, copies[index]]));
  if (mode === 'with-inputs') {
    const copiedEdges = sourceEdges.map((edge, index) => ({
      ...edge,
      id: `edge-clone-input-${cloneToken}-${index}`,
      source: expandedIds.has(edge.source) ? idMap.get(edge.source)! : edge.source,
      target: idMap.get(edge.target)!,
      selected: false,
      data: edge.data ? { ...edge.data } : undefined,
      style: edge.style ? { ...edge.style } : undefined,
    }));
    const edgeIdMap = new Map(sourceEdges.map((edge, index) => [edge.id, copiedEdges[index].id]));
    copies.forEach(copy => {
      if (copy.data.h3GuideTimes) copy.data.h3GuideTimes = Object.fromEntries(Object.entries(copy.data.h3GuideTimes).filter(([id]) => edgeIdMap.has(id)).map(([id, value]) => [edgeIdMap.get(id)!, value]));
      if (copy.data.inputReferenceRoles) copy.data.inputReferenceRoles = { ...copy.data.inputReferenceRoles };
    });
    return { nodes: copies, edges: copiedEdges, connectedCount: copiedEdges.length, skipped: [] };
  }

  const skipped: SelectedClonePlan['skipped'] = [];
  const connected: Edge[] = [];
  const workingNodes = [...nodes, ...copies];
  const continuableKinds = new Set<CanvasNodeData['kind']>(['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow', 'characterAnimator']);
  sources.forEach((source, index) => {
    const clone = copyBySourceId.get(source.id)!;
    if (!continuableKinds.has(clone.data.kind)) {
      skipped.push({ id: source.id, reason: '节点没有可接续的同类型输入端口' });
      return;
    }
    const outputType = outputTypeFor(source, 'output');
    const targetHandle = outputType ? defaultInputPort(clone.data.kind, outputType, clone.data) : undefined;
    if (!outputType || !targetHandle) {
      skipped.push({ id: source.id, reason: '节点没有可接续的同类型输入端口' });
      return;
    }
    const connection: Connection = { source: source.id, sourceHandle: 'output', target: clone.id, targetHandle };
    const decision = evaluateConnection(connection, workingNodes, [...edges, ...connected]);
    if (decision.error) {
      skipped.push({ id: source.id, reason: decision.error });
      return;
    }
    clone.data = freshNextStepNodeData(clone.data);
    connected.push(colorEdge({
      id: `edge-next-step-${cloneToken}-${index}`,
      ...connection,
      selected: false,
      reconnectable: 'target',
      data: { referenceOrder: index + 1, referenceToken: nextReferenceToken([...edges, ...connected], clone.id, outputType) },
    }, outputType));
  });
  return { nodes: copies, edges: connected, connectedCount: connected.length, skipped };
}

export type BatchReferenceConnectionPlan = {
  targetId?: string;
  sourceIds: string[];
  connections: Array<{ sourceId: string; sourceHandle: string; targetHandle: string; type: DataType }>;
  skipped: Array<{ id: string; reason: string }>;
  error: string;
};

/** Output ports can be wired before generation. Keep a stable visual reading order. */
export function selectedReferenceSourceIds(nodes: readonly CanvasNode[], selectedIds: readonly string[]) {
  const selected = new Set(selectedIds);
  return orderImageCollageSources(nodes.filter(node => selected.has(node.id) && outputTypeFor(node, 'output')).map(node => ({
    id: node.id, title: node.data.title, mediaUrl: '',
    x: node.position.x, y: node.position.y, width: nodeWidth(node), height: nodeHeight(node),
  }))).map(node => node.id);
}

/** Plan every type against the same port rules as single-node wiring.
 * Never replace an occupied single-value input as a side effect of a batch.
 */
export function planBatchReferenceConnections(
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
  selectedIds: readonly string[],
  targetId: string | undefined,
): BatchReferenceConnectionPlan {
  const skipped: BatchReferenceConnectionPlan['skipped'] = [];
  const connections: BatchReferenceConnectionPlan['connections'] = [];
  const target = nodes.find(node => node.id === targetId);
  if (!target || !runtimeInputPorts(target.data.kind, target.data).length) {
    return { sourceIds: [], connections, skipped, error: '请拖到有兼容输入端口的节点' };
  }
  const ordered = selectedReferenceSourceIds(nodes, selectedIds);
  for (const id of new Set(selectedIds)) {
    if (!ordered.includes(id)) skipped.push({ id, reason: '节点没有可连接的输出端口' });
  }
  const model = target.data.models?.find(item => item.id === target.data.modelId);
  const limits = model?.profile?.referenceLimits;
  const mediaTypes: DataType[] = ['image', 'video', 'audio'];
  let workingEdges = [...edges];
  for (const sourceId of ordered) {
    const source = nodes.find(node => node.id === sourceId)!;
    const type = outputTypeFor(source, 'output')!;
    const targetHandle = defaultInputPort(target.data.kind, type, target.data);
    if (sourceId === target.id) { skipped.push({ id: sourceId, reason: '目标节点不能连接自身' }); continue; }
    if (!targetHandle) { skipped.push({ id: sourceId, reason: '目标节点没有兼容此类型的输入端口' }); continue; }
    const connection: Connection = { source: sourceId, sourceHandle: 'output', target: target.id, targetHandle };
    const decision = evaluateConnection(connection, [...nodes], workingEdges);
    if (decision.error || decision.replaceEdgeIds.length) {
      skipped.push({ id: sourceId, reason: decision.error || '该输入端口已连接，批量操作不会覆盖原连接' });
      continue;
    }
    const connectedMediaTypes = workingEdges.filter(edge => edge.target === target.id).flatMap(edge => {
      const node = nodes.find(item => item.id === edge.source);
      const output = node && outputTypeFor(node, edge.sourceHandle);
      return output && mediaTypes.includes(output) ? [output] : [];
    });
    const typeLimit = type === 'image' ? limits?.images : type === 'video' ? limits?.videos : type === 'audio' ? limits?.audios : undefined;
    const frameLimit = target.data.kind === 'videoGenerator' && type === 'image'
      ? target.data.videoInputMode === 'first' ? 1 : target.data.videoInputMode === 'first_last' ? 2 : Infinity
      : Infinity;
    const maximum = Math.min(typeLimit ?? Infinity, frameLimit);
    if (mediaTypes.includes(type) && (connectedMediaTypes.filter(item => item === type).length >= maximum || connectedMediaTypes.length >= (limits?.total ?? Infinity))) {
      skipped.push({ id: sourceId, reason: '已达到当前模型或输入模式的素材数量上限' });
      continue;
    }
    const port = decision.targetHandle || targetHandle;
    connections.push({ sourceId, sourceHandle: 'output', targetHandle: port, type });
    workingEdges.push({ id: `batch-reference-plan-${connections.length}-${sourceId}`, ...connection, targetHandle: port });
  }
  return {
    targetId: target.id, sourceIds: connections.map(item => item.sourceId), connections, skipped,
    error: connections.length ? '' : skipped[0]?.reason || '选区内没有可连接到此节点的输出',
  };
}

// Compatibility for earlier callers; the operation now supports every output type.
export const planBatchImageReferenceConnections = planBatchReferenceConnections;

export type PromptReferenceConnectionPlan = {
  tokenMap: Record<string, string>;
  connections: Array<{ sourceId: string; targetHandle: string; type: DataType; referenceToken: string }>;
  skipped: Array<{ token: string; reason: string }>;
  error: string;
};

export function planPromptReferenceConnections(
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
  targetId: string,
  references: readonly PromptClipboardReference[],
): PromptReferenceConnectionPlan {
  const tokenMap: Record<string, string> = {};
  const connections: PromptReferenceConnectionPlan['connections'] = [];
  const skipped: PromptReferenceConnectionPlan['skipped'] = [];
  const target = nodes.find((node) => node.id === targetId);
  if (!target || !['imageGenerator', 'videoGenerator', 'comfyUiWorkflow'].includes(target.data.kind)) {
    return { tokenMap, connections, skipped, error: '当前提示词节点不支持自动关联素材' };
  }
  let workingEdges = withStableReferenceTokens([...edges], [...nodes]);
  const model = target.data.models?.find((item) => item.id === target.data.modelId);
  const limits = model?.profile?.referenceLimits;
  const mediaEdgeCount = () => workingEdges.filter((edge) => {
    if (edge.target !== target.id) return false;
    const source = nodes.find((node) => node.id === edge.source);
    return source ? ['image', 'video', 'audio'].includes(String(outputTypeFor(source, edge.sourceHandle))) : false;
  }).length;
  const imageEdgeCount = () => workingEdges.filter((edge) => {
    if (edge.target !== target.id) return false;
    const source = nodes.find((node) => node.id === edge.source);
    return source ? outputTypeFor(source, edge.sourceHandle) === 'image' : false;
  }).length;

  references.forEach((reference, index) => {
    if (tokenMap[reference.token]) return;
    const source = nodes.find((node) => node.id === reference.sourceId);
    const sourceType = source ? outputTypeFor(source, 'output') : undefined;
    if (!source || sourceType !== reference.type) {
      skipped.push({ token: reference.token, reason: '原素材节点已不存在或类型已经变化' });
      return;
    }
    const existing = workingEdges.find((edge) => edge.source === source.id && edge.target === target.id && outputTypeFor(source, edge.sourceHandle) === sourceType);
    if (existing) {
      tokenMap[reference.token] = String(existing.data?.referenceToken || reference.token);
      return;
    }
    if (sourceType === 'image' && limits && (imageEdgeCount() >= limits.images || mediaEdgeCount() >= limits.total)) {
      skipped.push({ token: reference.token, reason: `当前模型最多支持 ${limits.images} 张参考图` });
      return;
    }
    const targetHandle = defaultInputPort(target.data.kind, sourceType, target.data);
    if (!targetHandle) {
      skipped.push({ token: reference.token, reason: '目标节点没有兼容输入端口' });
      return;
    }
    const connection: Connection = { source: source.id, sourceHandle: 'output', target: target.id, targetHandle };
    const decision = evaluateConnection(connection, [...nodes], workingEdges);
    if (decision.error) {
      skipped.push({ token: reference.token, reason: decision.error });
      return;
    }
    const referenceToken = nextReferenceToken(workingEdges, target.id, sourceType);
    tokenMap[reference.token] = referenceToken;
    connections.push({
      sourceId: source.id,
      targetHandle,
      type: sourceType,
      referenceToken,
    });
    workingEdges = [...workingEdges, colorEdge({
      id: `prompt-paste-plan-${index}-${source.id}`,
      source: source.id,
      sourceHandle: 'output',
      target: target.id,
      targetHandle,
      data: { referenceOrder: Date.now() + index, referenceToken },
    }, sourceType)];
  });
  return {
    tokenMap,
    connections,
    skipped,
    error: Object.keys(tokenMap).length ? '' : (skipped[0]?.reason || '没有可自动关联的素材'),
  };
}

export function serializeCanvasNode(node: CanvasNode): CanvasNode {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    width: node.measured?.width || node.width || initialNodeWidth(node.data.kind),
    height: node.measured?.height || node.height || initialNodeHeight(node.data.kind),
    selected: false,
    data: stripCanvasClipboardRuntime(Object.fromEntries(Object.entries(node.data).filter(([, value]) => typeof value !== 'function'))) as CanvasNodeData,
  };
}

export function canvasHistorySnapshot(nodes: readonly CanvasNode[], edges: readonly Edge[]): Snapshot {
  const historyNodes = nodes.map((node) => ({
    ...node,
    data: Object.fromEntries(Object.entries(node.data).filter(([key, value]) => !['models', 'inputReferences', 'imageReferences', 'hasIncomingConnection', 'hasOutgoingConnection', 'connectionGuideType', 'publicMode'].includes(key) && typeof value !== 'function')) as CanvasNodeData,
  }));
  const historyEdges = edges.map((edge) => ({ ...edge, className: stripPathClassName(edge.className) }));
  const cloned = JSON.parse(JSON.stringify({ nodes: historyNodes, edges: historyEdges })) as { nodes: CanvasNode[]; edges: Edge[] };
  return { ...cloned, signature: canvasAutosaveSignature(cloned.nodes, cloned.edges) };
}

const transientCanvasDataKeys = new Set([
  'status',
  'progress',
  'localQueue',
  'cancelling',
  'characterStatus',
  'characterProgress',
  'workflowStatus',
  'workflowProgress',
]);

/**
 * Tracks only durable canvas changes. Polling progress and display-only status
 * must not enqueue a full canvas write every 500ms, while job state changes,
 * outputs, graph edits, node positions and generator settings remain durable.
 */
export function canvasAutosaveSignature(nodes: readonly CanvasNode[], edges: readonly Edge[]) {
  const durableNodes = nodes.map((node) => {
    const serialized = serializeCanvasNode(node);
    return {
      ...serialized,
      data: Object.fromEntries(Object.entries(serialized.data).filter(([key]) => !transientCanvasDataKeys.has(key))),
    };
  });
  const durableEdges = edges.map((edge) => ({ ...edge, className: stripPathClassName(edge.className) }));
  return JSON.stringify({ nodes: durableNodes, edges: durableEdges });
}

export function canvasAutosaveSignatureForInteraction(previousSignature: string, nodes: readonly CanvasNode[], edges: readonly Edge[], interactionActive: boolean) {
  return interactionActive ? previousSignature : canvasAutosaveSignature(nodes, edges);
}

function AssetLibraryCard({ group, importingAssetIds, onImport, onDragStart, onDragEnd }: {
  group: LibraryAssetGroup;
  importingAssetIds: string[];
  onImport: (asset: LibraryAsset) => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>, asset: LibraryAsset) => void;
  onDragEnd: () => void;
}) {
  const cover = group.variants.find((asset) => asset.isGroupCover) || group.variants[0];
  const [selectedId, setSelectedId] = useState(cover.id);
  const asset = group.variants.find((item) => item.id === selectedId) || cover;
  const importing = importingAssetIds.includes(asset.id);
  return <article className="asset-library-card">
    <button className="asset-library-preview" draggable={!importing} onDragStart={(event) => onDragStart(event, asset)} onDragEnd={onDragEnd} disabled={importing} onClick={() => onImport(asset)}>
      <img src={asset.imageUrl} alt={asset.name || asset.imageName || 'AI 资产'} draggable={false} />
      {group.variants.length > 1 && <span className="asset-library-variant-count">{group.variants.length} 个变体</span>}
    </button>
    {group.variants.length > 1 && <div className="asset-library-variants" aria-label={`${group.name} 变体`}>
      {group.variants.map((variant) => <button key={variant.id} className={variant.id === asset.id ? 'active' : ''} title={variant.imageName || variant.name || '变体'} onClick={() => setSelectedId(variant.id)}><img src={variant.imageUrl} alt="" draggable={false} /></button>)}
    </div>}
  </article>;
}

async function readApiJson(response: Response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) throw new Error('AI 创作台会话已失效，请从工作空间重新打开该任务');
    throw new Error('内容暂时无法显示，请刷新后重试');
  }
}

export function CanvasBootLoader({ leaving = false, failed = false, taskTitle = '' }: { leaving?: boolean; failed?: boolean; taskTitle?: string }) {
  const status = failed ? '画布加载遇到问题' : leaving ? '创作空间已就绪' : '正在读取画布内容';
  return <div className={`canvas-boot-loader${leaving ? ' is-leaving' : ''}${failed ? ' is-failed' : ''}`} role={failed ? 'alert' : 'status'} aria-live="polite" aria-label={status}>
    <div className="canvas-boot-grid" aria-hidden="true" />
    <section className="canvas-boot-content">
      <div className="canvas-boot-brand">
        <span aria-hidden="true"><UiIcon name="spark" /></span>
        <strong>AI 创作台</strong>
      </div>
      <div className="canvas-boot-copy">
        <h1>{failed ? '画布暂时无法打开' : leaving ? '画布已准备好' : '正在打开画布'}</h1>
        <p>{taskTitle || '恢复节点、素材与创作内容'}</p>
      </div>
      <div className="canvas-boot-progress" aria-hidden="true">
        <i className={!failed ? 'is-active' : ''} />
      </div>
      <footer className="canvas-boot-status"><span><i />{status}</span>{failed && <button type="button" onClick={() => window.location.reload()}>重新载入</button>}</footer>
    </section>
  </div>;
}

function Studio() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [agentWorkspace, setAgentWorkspace] = useState<AgentWorkspace>(() => window.location.pathname.replace(/\/$/, '') === '/agent-preview' || params.get('view') === 'agent' ? 'conversation' : 'closed');
  const agentOpen = agentWorkspace !== 'closed';
  const agentCanvasView = agentWorkspace === 'canvas';
  const studioMode = resolveStudioMode(window.location.pathname, window.location.search);
  const publicMode = studioMode === 'public';
  const adminStandaloneMode = studioMode === 'admin-standalone';
  const hasTaskContext = hasBoundCanvasTask(studioMode, window.location.search);
  const [publicWorkspaceId, setPublicWorkspaceId] = useState('');
  const publicWorkspaceIdRef = useRef('');
  const publicSessionTokenRef = useRef('');
  const task = useMemo<TaskInfo>(() => adminStandaloneMode
    ? { taskId: 'admin-standalone', project: '管理员独立画布', title: '管理员 AI 创作台', member: '管理员' }
    : { taskId: publicMode ? publicWorkspaceId || 'public-workspace' : (params.get('task_id') || 'local-canvas'), project: publicMode ? '外部工作区' : (params.get('project') || '本地项目'), title: publicMode ? '独立 AI 创作台' : (params.get('title') || '本地画布'), member: publicMode ? '外部用户' : (params.get('member') || '本机') }, [adminStandaloneMode, params, publicMode, publicWorkspaceId]);
  const apiHeaders = useMemo<Record<string, string>>(() => {
    if (publicMode) return { 'x-ai-canvas-mode': 'public' };
    return {} as Record<string, string>;
  }, [publicMode]);
  const apiFetch = useCallback((input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    Object.entries(apiHeaders).forEach(([name, value]) => headers.set(name, value));
    if (publicMode && publicSessionTokenRef.current) headers.set('x-ai-canvas-public-session', publicSessionTokenRef.current);
    return window.fetch(input, { ...init, headers });
  }, [apiHeaders]);
  const shareRequested = params.get('share') === '1';
  const [activeCanvasId, setActiveCanvasId] = useState(() => normalizedCanvasBoardId(params.get('canvas_id')));
  const [canvasBoards, setCanvasBoards] = useState<CanvasBoard[]>([]);
  const [canvasAppMenuOpen, setCanvasAppMenuOpen] = useState(false);
  const [canvasBoardMenuOpen, setCanvasBoardMenuOpen] = useState(false);
  const [newCanvasTitle, setNewCanvasTitle] = useState('');
  const [creatingCanvasBoard, setCreatingCanvasBoard] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const comfyUiModuleEnabled = canvasCapabilityModuleEnabled(models, 'comfyui');
  const localH3ModelId = models.find((model) => model.adapter === 'comfyui-minimax-h3')?.id || '';
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>(storedCanvasTheme);
  const [canvasLanguage, setCanvasLanguage] = useState<CanvasInterfaceLanguage>(storedCanvasInterfaceLanguage);
  useEffect(() => { document.title = canvasDocumentTitleForLanguage(task.title, canvasLanguage); }, [canvasLanguage, task.title]);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [generationContractVersion, setGenerationContractVersion] = useState(0);
  const [shareMode, setShareMode] = useState(false);
  const [showSettingsCenter, setShowSettingsCenter] = useState(false);
  const [showGeneratedAssetHistory, setShowGeneratedAssetHistory] = useState(false);
  const [settingsCenterSection, setSettingsCenterSection] = useState<SettingsCenterSection>('api');
  useEffect(() => observeCanvasInterfaceLanguage(document.body, canvasLanguage), [canvasLanguage]);
  useEffect(() => {
    if (!platformAdmin) return;
    const preloadTimer = window.setTimeout(() => { void loadSettingsCenter(); }, 500);
    return () => window.clearTimeout(preloadTimer);
  }, [platformAdmin]);
  useEffect(() => {
    if (!platformAdmin) return;
    const requestedSection = settingsSectionFromPanel(params.get('panel'));
    if (requestedSection) {
      setSettingsCenterSection(requestedSection);
      setShowSettingsCenter(true);
    }
  }, [params, platformAdmin]);
  const [comfyUiEditor, setComfyUiEditor] = useState<ComfyUiEditorState | null>(null);
  const comfyUiEditorRequestRef = useRef(0);
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([]);
  const [assetListCanScroll, setAssetListCanScroll] = useState(false);
  const [assetListAtEnd, setAssetListAtEnd] = useState(true);
  const assetListRef = useRef<HTMLDivElement>(null);
  const [assetCategory, setAssetCategory] = useState<AssetCategory>('3d-cartoon');
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [importingAssetIds, setImportingAssetIds] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [canvasConfirmation, setCanvasConfirmation] = useState<CanvasConfirmation | null>(null);
  const canvasConfirmationResolverRef = useRef<((accepted: boolean) => void) | null>(null);
  const [publicWorkspaceIssue, setPublicWorkspaceIssue] = useState<string | null>(null);
  const [, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const [saveNonce, setSaveNonce] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('加载中');
  const [ready, setReady] = useState(false);
  const [showCanvasLoader, setShowCanvasLoader] = useState(hasTaskContext && !adminStandaloneMode);
  const [canvasLoaderLeaving, setCanvasLoaderLeaving] = useState(false);
  const loadedCanvasKeyRef = useRef<string | null>(null);
  const skipNextAutosaveRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const saveDelayRef = useRef(900);
  const saveBlockedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const savePendingRef = useRef(false);
  const saveCanvasNowRef = useRef<((immediate?: boolean) => Promise<boolean>) | null>(null);
  const textEditRef = useRef(new Map<string, number>());
  const pollTimers = useRef(new Map<string, number>());
  const pollFailures = useRef(new Map<string, number>());
  const pollEpochs = useRef(new Map<string, number>());
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  // Node copies are intentionally session-scoped. Internal cross-task copies are
  // relayed through the server clipboard, whose TTL and process lifetime prevent
  // stale nodes from reappearing after a machine or service restart.
  const clipboardRef = useRef<Clipboard>({ nodes: [], edges: [] });
  const clipboardSyncSequenceRef = useRef(0);
  const handledCanvasPasteRef = useRef(false);
  const keyboardPasteModeRef = useRef<'full' | 'settings'>('full');
  const restoringRef = useRef(false);
  const [, setHistoryNonce] = useState(0);
  const [nodeMenu, setNodeMenu] = useState<MenuPoint | null>(null);
  const [paneMenu, setPaneMenu] = useState<MenuPoint | null>(null);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showShortcutGuide, setShowShortcutGuide] = useState(false);
  const [viewport, setViewport] = useState<Viewport>(defaultViewport);
  const [zoom, setZoom] = useState(defaultViewport.zoom);
  const [mediaLodLevel, setMediaLodLevel] = useState<CanvasMediaLodLevel>('high');
  const viewportPublisher = useMemo(() => createViewportPublisher((next: Viewport) => {
    setViewport(next); setZoom(next.zoom); setMediaLodLevel(current => canvasMediaLodLevelForZoom(next.zoom, current));
  }), []);
  useEffect(() => () => viewportPublisher.cancel(), [viewportPublisher, task.taskId, activeCanvasId]);
  const [viewportSize, setViewportSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const mobileCanvas = useMobileCanvas();
  const [touchSelecting, setTouchSelecting] = useState(false);
  const [mobilePresetsOpen, setMobilePresetsOpen] = useState(false);
  const flowAreaRef = useRef<HTMLDivElement>(null);
  const smoothZoomTargetRef = useRef<Viewport | null>(null);
  const smoothZoomFrameRef = useRef<number | null>(null);
  const smoothZoomLastFrameRef = useRef(0);
  const shortcutGuideRef = useRef<HTMLDivElement>(null);
  const previewWarmCacheRef = useRef(new Map<string, boolean>());
  const previewWarmTimerRef = useRef<number | null>(null);
  const previewWarmViewportRef = useRef(viewport);
  const previewWarmViewportSizeRef = useRef(viewportSize);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadPointRef = useRef<{ x: number; y: number } | null>(null);
  const collageCreatingRef = useRef(false);
  const pointerRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [connectMenu, setConnectMenu] = useState<ConnectMenu | null>(null);
  const [batchReferenceDrag, setBatchReferenceDrag] = useState<BatchReferenceDrag | null>(null);
  const batchReferenceDragRef = useRef<BatchReferenceDrag | null>(null);
  useEffect(() => {
    previewWarmViewportRef.current = viewport;
    previewWarmViewportSizeRef.current = viewportSize;
    if (!ready || mediaLodLevel === 'low') {
      if (previewWarmTimerRef.current !== null) window.clearTimeout(previewWarmTimerRef.current);
      previewWarmTimerRef.current = null;
      return;
    }
    // Throttle instead of debouncing. During a continuous pan the old version
    // cancelled every pending warm-up, so previews only started loading after
    // the user stopped moving and appeared to reload from scratch.
    if (previewWarmTimerRef.current !== null) return;
    previewWarmTimerRef.current = window.setTimeout(() => {
      previewWarmTimerRef.current = null;
      const area = flowAreaRef.current;
      if (!area) return;
      const currentViewport = previewWarmViewportRef.current;
      const currentViewportSize = previewWarmViewportSizeRef.current;
      const urls = canvasPreviewUrlsNearViewport(nodesRef.current, currentViewport, {
        width: area.clientWidth || currentViewportSize.width,
        height: area.clientHeight || currentViewportSize.height,
      });
      const cache = previewWarmCacheRef.current;
      urls.forEach((url) => {
        const existing = cache.get(url);
        if (existing) {
          cache.delete(url);
          cache.set(url, existing);
          return;
        }
        // Warm only bounded, low-resolution derivatives. Retaining 64 decoded
        // 4K originals here could consume gigabytes when a group expands.
        cache.set(url, true);
        primePersistentMediaLod({ sourceUrl: url, mediaType: 'image' });
      });
      while (cache.size > 64) cache.delete(cache.keys().next().value as string);
    }, 48);
  }, [mediaLodLevel, nodes, ready, viewport, viewportSize]);
  useEffect(() => () => {
    if (previewWarmTimerRef.current !== null) window.clearTimeout(previewWarmTimerRef.current);
    previewWarmTimerRef.current = null;
    previewWarmCacheRef.current.clear();
  }, []);
  useEffect(() => {
    if (!hasTaskContext || adminStandaloneMode) {
      setShowCanvasLoader(false);
      setCanvasLoaderLeaving(false);
      return;
    }
    if (!ready) {
      setShowCanvasLoader(true);
      setCanvasLoaderLeaving(false);
      return;
    }
    setCanvasLoaderLeaving(false);
    setShowCanvasLoader(false);
  }, [adminStandaloneMode, hasTaskContext, ready]);
  const connectionFeedbackRef = useRef<{ connection: Connection; error: string } | null>(null);
  const reconnectSessionRef = useRef<ReconnectSession | null>(null);
  const [contextMenu, setContextMenu] = useState<{ clientX: number; clientY: number; nodeId: string; nodeIds: string[]; imageUrl?: string; videoUrl?: string } | null>(null);
  const [contextSubmenu, setContextSubmenu] = useState<string | null>(null);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [nodeQuery, setNodeQuery] = useState('');
  const [isSelecting, setIsSelecting] = useState(false);
  useEffect(() => { setContextSubmenu(null); }, [contextMenu?.clientX, contextMenu?.clientY]);
  const flow = useReactFlow<CanvasNode, Edge>();
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const area = flowAreaRef.current;
    if (!area) return;
    const stopAnimation = () => {
      if (smoothZoomFrameRef.current !== null) window.cancelAnimationFrame(smoothZoomFrameRef.current);
      smoothZoomFrameRef.current = null;
      smoothZoomTargetRef.current = null;
      smoothZoomLastFrameRef.current = 0;
    };
    const animate = (time: number) => {
      const target = smoothZoomTargetRef.current;
      if (!target) { smoothZoomFrameRef.current = null; return; }
      const current = flow.getViewport();
      const elapsed = smoothZoomLastFrameRef.current ? Math.min(34, Math.max(8, time - smoothZoomLastFrameRef.current)) : 16;
      smoothZoomLastFrameRef.current = time;
      const blend = 1 - Math.exp(-elapsed / 58);
      const next = {
        x: current.x + (target.x - current.x) * blend,
        y: current.y + (target.y - current.y) * blend,
        zoom: current.zoom + (target.zoom - current.zoom) * blend,
      };
      const settled = Math.abs(target.zoom - next.zoom) < 0.00035 && Math.abs(target.x - next.x) < 0.08 && Math.abs(target.y - next.y) < 0.08;
      void flow.setViewport(settled ? target : next, { duration: 0 });
      if (settled) {
        smoothZoomFrameRef.current = null;
        smoothZoomTargetRef.current = null;
        smoothZoomLastFrameRef.current = 0;
      } else smoothZoomFrameRef.current = window.requestAnimationFrame(animate);
    };
    const onWheel = (event: WheelEvent) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      if (!eventTarget?.closest('.react-flow') || eventTarget.closest('.nowheel, input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = area.getBoundingClientRect();
      const deltaY = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * Math.max(1, bounds.height) : event.deltaY;
      const base = smoothZoomTargetRef.current || flow.getViewport();
      smoothZoomTargetRef.current = smoothWheelViewport(base, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, deltaY, canvasMinimumZoom, 2.5);
      if (smoothZoomFrameRef.current === null) smoothZoomFrameRef.current = window.requestAnimationFrame(animate);
    };
    area.addEventListener('wheel', onWheel, { capture: true, passive: false });
    area.addEventListener('pointerdown', stopAnimation, { capture: true });
    return () => {
      area.removeEventListener('wheel', onWheel, { capture: true });
      area.removeEventListener('pointerdown', stopAnimation, { capture: true });
      stopAnimation();
    };
  }, [flow]);
  const requestCanvasConfirmation = useCallback((confirmation: CanvasConfirmation) => new Promise<boolean>((resolve) => {
    canvasConfirmationResolverRef.current?.(false);
    canvasConfirmationResolverRef.current = resolve;
    setCanvasConfirmation(confirmation);
  }), []);
  const resolveCanvasConfirmation = useCallback((accepted: boolean) => {
    const resolver = canvasConfirmationResolverRef.current;
    canvasConfirmationResolverRef.current = null;
    setCanvasConfirmation(null);
    resolver?.(accepted);
  }, []);
  const closeComfyUiEditor = useCallback(() => {
    comfyUiEditorRequestRef.current += 1;
    if (comfyUiEditor?.sessionId) void apiFetch(`/api/v1/comfyui/editor-sessions/${encodeURIComponent(comfyUiEditor.sessionId)}`, { method: 'DELETE' }).catch(() => undefined);
    setComfyUiEditor(null);
  }, [apiFetch, comfyUiEditor]);
  const openComfyUiEditor = useCallback(async (nodeId: string, modelId: string, workflowId: string) => {
    window.dispatchEvent(new Event('ai-canvas:pause-videos'));
    const requestId = comfyUiEditorRequestRef.current + 1;
    comfyUiEditorRequestRef.current = requestId;
    setComfyUiEditor({ nodeId, modelId, workflowId, status: 'loading' });
    try {
      if (saveCanvasNowRef.current) {
        let saved = await saveCanvasNowRef.current(true);
        if (!saved && saveInFlightRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          saved = await saveCanvasNowRef.current(true);
        }
        if (!saved) throw new Error('当前画布尚未保存，无法建立节点专属工作流会话');
      }
      const canvasNode = nodesRef.current.find((item) => item.id === nodeId);
      if (!canvasNode || canvasNode.data.kind !== 'comfyUiWorkflow') throw new Error('当前 ComfyUI 工作流节点不存在');
      const selectedModel = models.find((model) => model.id === modelId);
      const positivePrompt = compilePromptTokenSelection(canvasNode.data.prompt || '', canvasNode.data.promptTokenIds, selectedModel?.adapter, 'positive', canvasNode.data.prompt || '', 'image', selectedModel?.localImageFamily);
      const negativePrompt = compilePromptTokenSelection(canvasNode.data.negativePrompt || '', canvasNode.data.negativePromptTokenIds, selectedModel?.adapter, 'negative', canvasNode.data.negativePrompt || '', 'image', selectedModel?.localImageFamily);
      const referenceImages = collectGeneratorInputsFromGraph(nodesRef.current, edgesRef.current, nodeId).filter((input) => input.type === 'image');
      const response = await apiFetch('/api/v1/comfyui/editor-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.taskId, canvasId: activeCanvasId, nodeId, modelId, workflowId, taskTitle: task.title, browserHostname: window.location.hostname, positivePrompt, negativePrompt, referenceImages }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '本地 ComfyUI 编辑器连接失败');
      const editor = payload.editor && typeof payload.editor === 'object' ? payload.editor : {};
      const editorUrl = validatedComfyUiEditorUrl(editor.url, window.location.hostname);
      if (comfyUiEditorRequestRef.current !== requestId) return;
      setComfyUiEditor({
        nodeId,
        modelId,
        status: 'ready',
        sessionId: String(editor.sessionId || ''),
        workflowId: String(editor.id || ''),
        workflowName: String(editor.name || '完整工作流编辑器'),
        scopeTitle: String(editor.scopeTitle || ''),
        modelName: String(editor.modelName || ''),
        editorUrl,
        started: Boolean(editor.started),
      });
    } catch (error) {
      if (comfyUiEditorRequestRef.current !== requestId) return;
      setComfyUiEditor({ nodeId, modelId, workflowId, status: 'error', error: error instanceof Error ? error.message : '本地 ComfyUI 编辑器连接失败' });
    }
  }, [activeCanvasId, apiFetch, models, task.taskId, task.title]);
  const retryComfyUiEditor = useCallback(() => {
    if (!comfyUiEditor) return;
    void openComfyUiEditor(comfyUiEditor.nodeId, comfyUiEditor.modelId, String(comfyUiEditor.workflowId || ''));
  }, [comfyUiEditor, openComfyUiEditor]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => {
    if (!localH3ModelId) return;
    let cancelled = false;
    let timer = 0;
    const refresh = async () => {
      try {
        const response = await apiFetch(`/api/v1/local-h3/queue?modelId=${encodeURIComponent(localH3ModelId)}`);
        const payload = await response.json();
        if (!cancelled && response.ok) setModels((current) => current.map((model) => model.id === localH3ModelId ? { ...model, localQueueStatus: payload.queue || undefined } : model));
      } catch {
        if (!cancelled) setModels((current) => current.map((model) => model.id === localH3ModelId && model.localQueueStatus ? { ...model, localQueueStatus: { ...model.localQueueStatus, available: false, state: 'offline', error: '无法连接本地 H3 队列' } } : model));
      } finally {
        if (!cancelled) timer = window.setTimeout(refresh, 4000);
      }
    };
    void refresh();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [apiFetch, localH3ModelId, setModels]);
  useEffect(() => {
    const updateViewportSize = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', updateViewportSize);
    window.visualViewport?.addEventListener('resize', updateViewportSize);
    return () => {
      window.removeEventListener('resize', updateViewportSize);
      window.visualViewport?.removeEventListener('resize', updateViewportSize);
    };
  }, []);
  useEffect(() => {
    if (!canvasConfirmation) return;
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      resolveCanvasConfirmation(false);
    };
    window.addEventListener('keydown', dismissOnEscape);
    return () => window.removeEventListener('keydown', dismissOnEscape);
  }, [canvasConfirmation, resolveCanvasConfirmation]);
  useEffect(() => {
    if (!canvasAppMenuOpen && !canvasBoardMenuOpen) return;
    const closeCanvasMenus = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setCanvasAppMenuOpen(false);
      setCanvasBoardMenuOpen(false);
    };
    window.addEventListener('keydown', closeCanvasMenus);
    return () => window.removeEventListener('keydown', closeCanvasMenus);
  }, [canvasAppMenuOpen, canvasBoardMenuOpen]);
  useEffect(() => {
    if (!showShortcutGuide) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!shortcutGuideRef.current?.contains(event.target as Node)) setShowShortcutGuide(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowShortcutGuide(false);
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    window.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      window.removeEventListener('keydown', dismissOnEscape);
    };
  }, [showShortcutGuide]);
  useEffect(() => () => {
    canvasConfirmationResolverRef.current?.(false);
    canvasConfirmationResolverRef.current = null;
  }, []);
  useLayoutEffect(() => { applyCanvasThemeDocument(canvasTheme); }, [canvasTheme]);
  useEffect(() => {
    const area = flowAreaRef.current;
    if (!area) return;
    const keepZoomInsideCanvas = (event: WheelEvent) => { containCanvasZoomGesture(event); };
    const blockBrowserZoomOutsideCanvas = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || area.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // Cancel only the browser's host-wide page zoom. Do not stop propagation:
    // React Flow needs the complete wheel stream for cursor-centred continuous zoom.
    area.addEventListener('wheel', keepZoomInsideCanvas, { capture: true, passive: false });
    document.addEventListener('wheel', blockBrowserZoomOutsideCanvas, { capture: true, passive: false });
    return () => {
      area.removeEventListener('wheel', keepZoomInsideCanvas, { capture: true });
      document.removeEventListener('wheel', blockBrowserZoomOutsideCanvas, { capture: true });
    };
  }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 3200); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const endSelection = () => setIsSelecting(false);
    window.addEventListener('pointerup', endSelection, true);
    window.addEventListener('blur', endSelection);
    return () => { window.removeEventListener('pointerup', endSelection, true); window.removeEventListener('blur', endSelection); };
  }, []);
  const snapshot = useCallback((): Snapshot => canvasHistorySnapshot(nodesRef.current, edgesRef.current), []);
  const pushHistory = useCallback(() => {
    if (restoringRef.current) return;
    const next = snapshot();
    if (historyRef.current.at(-1)?.signature === next.signature) return;
    historyRef.current = [...historyRef.current.slice(-49), next];
    futureRef.current = [];
    setHistoryNonce((value) => value + 1);
  }, [snapshot]);
  const restoreSnapshot = useCallback((next: Snapshot) => {
    restoringRef.current = true;
    setNodes(next.nodes); setEdges(next.edges);
    nodesRef.current = next.nodes; edgesRef.current = next.edges;
    requestAnimationFrame(() => { restoringRef.current = false; });
    setHistoryNonce((value) => value + 1);
  }, [setEdges, setNodes]);
  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    futureRef.current.push(snapshot());
    restoreSnapshot(previous);
  }, [restoreSnapshot, snapshot]);
  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current = [...historyRef.current.slice(-49), snapshot()];
    restoreSnapshot(next);
  }, [restoreSnapshot, snapshot]);

  const descendants = useCallback((id: string) => {
    const found = new Set<string>();
    const visit = (source: string) => edgesRef.current.filter((edge) => edge.source === source).forEach((edge) => { if (!found.has(edge.target)) { found.add(edge.target); visit(edge.target); } });
    visit(id);
    return found;
  }, []);

  const staleNodes = useCallback((starts: Iterable<string>, status: string) => {
    const staleIds = new Set<string>();
    Array.from(starts).forEach((id) => { staleIds.add(id); descendants(id).forEach((child) => staleIds.add(child)); });
    setNodes((current) => current.map((node) => staleIds.has(node.id) && (node.data.jobState === 'succeeded' || node.data.kind === 'result')
      ? { ...node, data: { ...node.data, stale: true, status } } : node));
  }, [descendants, setNodes]);

  const updateNode = useCallback((id: string, patch: Partial<CanvasNodeData>, mode?: 'text' | 'runtime') => {
    saveDelayRef.current = mode === 'text' ? 1200 : mode === 'runtime' ? 800 : 900;
    if (mode === 'text') {
      const activeTimer = textEditRef.current.get(id);
      if (activeTimer == null) pushHistory();
      else window.clearTimeout(activeTimer);
      textEditRef.current.set(id, window.setTimeout(() => textEditRef.current.delete(id), 500));
    } else if (mode !== 'runtime') pushHistory();
    const changed = Object.keys(patch).some((key) => ['text', 'html', 'prompt', 'promptTokenIds', 'negativePromptTokenIds', 'mediaUrl', 'modelId', 'workflowId', 'comfyParameterBinding', 'ratio', 'resolution', 'count', 'duration', 'audioEnabled', 'audioLanguage', 'audioSpeed', 'audioReferenceText', 'videoInputMode', 'refImageSize', 'referenceVideoAudio', 'h3EncodingPreset', 'h3SamplingSteps', 'h3AccelerationMode', 'h3GuideTimes', 'h3BlockCache', 'h3FaceRefine', 'seed', 'comfySeedMode', 'comfySteps', 'comfyCfg', 'comfySampler', 'comfyScheduler', 'comfyDenoise', 'referenceDenoise', 'characterLora', 'characterLoraStrength', 'styleLora', 'objectLora', 'identityStrength', 'proportionStrength', 'poseStrength', 'poseEstimator', 'lineartStrength', 'characterHeadRatio', 'characterPose', 'outputFormat', 'cameraFixed', 'texture', 'pbr', 'autoSize', 'enableImageAutofix', 'modelInputMode', 'modelPreset', 'textureQuality', 'geometryQuality', 'imageSeed', 'textureSeed', 'modelSeed', 'faceLimit', 'quad', 'smartLowPoly', 'generateParts', 'exportUv', 'textureAlignment', 'orientation', 'negativePrompt', 'modelingStyleId'].includes(key));
    const staleIds = changed ? descendants(id) : new Set<string>();
    const nextNodes = nodesRef.current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, ...patch, ...(changed && node.data.jobState === 'succeeded' ? { stale: true } : {}) } }
      : staleIds.has(node.id) && (node.data.jobState === 'succeeded' || node.data.kind === 'result') ? { ...node, data: { ...node.data, stale: true, status: '前序输入已变更，结果可能过期' } } : node);
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
  }, [descendants, pushHistory, setNodes]);
  const selectComfyUiWorkflow = useCallback((id: string, modelId: string, workflowId: string) => {
    const current = nodesRef.current.find((node) => node.id === id && node.data.kind === 'comfyUiWorkflow');
    const model = models.find((candidate) => candidate.id === modelId);
    const workflows = model?.workflows?.length ? model.workflows : model?.workflow ? [model.workflow] : [];
    const workflow = workflows.find((candidate) => candidate.id === workflowId);
    if (!current || !model || !workflow || !comfyUiWorkflowIsSelectable(workflow)) return;

    const reconciliation = reconcileComfyUiWorkflowInputEdges(nodesRef.current, edgesRef.current, id, workflow);
    const unchanged = current.data.modelId === model.id
      && current.data.workflowId === workflow.id
      && reconciliation.remappedCount === 0
      && reconciliation.removedCount === 0;
    if (unchanged) return;

    const imagePorts = (workflow.inputPorts || []).filter((port) => port.accepts.includes('image'));
    const modeTitle = workflow.modePresentation?.title || workflow.name;
    const statusParts = [`已切换到${modeTitle}`];
    const selectionDefaults = comfyUiExplicitWorkflowSelectionDefaults(model, workflow, current.data);
    if (workflow.qualityProfile?.mode === 'high-res-refine') statusParts.push(`高清精修使用 ${selectionDefaults.resolution}`);
    if (reconciliation.remappedCount > 0) statusParts.push(`已自动匹配 ${reconciliation.remappedCount} 个参考输入`);
    if (reconciliation.removedCount > 0) statusParts.push(`已断开 ${reconciliation.removedCount} 张不兼容参考图`);

    pushHistory();
    edgesRef.current = reconciliation.edges;
    setEdges(reconciliation.edges);
    updateNode(id, {
      ...selectionDefaults,
      status: statusParts.join(' · '),
    }, 'runtime');
  }, [models, pushHistory, setEdges, updateNode]);
  const previewComfyUiPose = useCallback(async (id: string) => {
    const node = nodesRef.current.find((candidate) => candidate.id === id && candidate.data.kind === 'comfyUiWorkflow');
    const model = node ? models.find((candidate) => candidate.id === node.data.modelId) : undefined;
    const workflows = model?.workflows?.length ? model.workflows : model?.workflow ? [model.workflow] : [];
    const workflow = workflows.find((candidate) => candidate.id === node?.data.workflowId) || workflows[0];
    const poseInput = node ? collectGeneratorInputsFromGraph(nodesRef.current, edgesRef.current, id).find((input) => input.type === 'image' && input.port === 'pose') : undefined;
    const hasPosePort = workflow?.inputPorts?.some((port) => port.id === 'pose' && port.accepts.includes('image'));
    if (!node || !model || !workflow || !hasPosePort || workflow.poseControl?.mode === 'unsupported') return setToast('当前模型或生成方式不支持骨架预览');
    if (!poseInput?.value) return setToast('请先连接动作姿势参考图');
    if (publicMode || shareMode) return setToast('骨架预览仅支持本地编辑画布');
    const profile = model.profile;
    const ratio = profile?.ratios.includes(String(node.data.ratio || '')) ? String(node.data.ratio) : model.defaults?.ratio || profile?.defaultRatio || '3:4';
    const poseEstimator = node.data.poseEstimator === 'dwpose' ? 'dwpose' : 'sdpose';
    updateNode(id, { posePreviewState: 'running', posePreviewError: undefined }, 'runtime');
    try {
      const response = await apiFetch('/api/v1/comfyui/pose-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.taskId, canvasId: activeCanvasId, nodeId: id, modelId: model.id, workflowId: workflow.id, ratio, poseEstimator, referenceImage: poseInput }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '骨架预览生成失败');
      const preview = payload.preview && typeof payload.preview === 'object' ? payload.preview : null;
      if (!preview?.url || !preview?.key) throw new Error('骨架预览结果无效');
      const latest = nodesRef.current.find((candidate) => candidate.id === id);
      const latestPose = collectGeneratorInputsFromGraph(nodesRef.current, edgesRef.current, id).find((input) => input.type === 'image' && input.port === 'pose');
      const latestModel = latest ? models.find((candidate) => candidate.id === latest.data.modelId) : undefined;
      const latestRatio = latestModel?.profile?.ratios.includes(String(latest?.data.ratio || '')) ? String(latest?.data.ratio) : latestModel?.defaults?.ratio || latestModel?.profile?.defaultRatio || '3:4';
      const latestEstimator = latest?.data.poseEstimator === 'dwpose' ? 'dwpose' : 'sdpose';
      if (!latest || latestPose?.value !== poseInput.value || latestRatio !== ratio || latestEstimator !== poseEstimator) {
        updateNode(id, { posePreviewState: 'idle' }, 'runtime');
        return setToast('姿势参考或画幅已变化，请重新预览骨架');
      }
      updateNode(id, {
        posePreviewState: 'ready',
        posePreviewUrl: String(preview.url),
        posePreviewSourceUrl: poseInput.value,
        posePreviewKey: String(preview.key),
        posePreviewEstimator: poseEstimator,
        posePreviewRatio: ratio,
        posePreviewCached: Boolean(preview.cached),
        posePreviewError: undefined,
      }, 'runtime');
      setToast(preview.cached ? '骨架预览已从缓存读取' : '骨架预览已生成并缓存');
    } catch (error) {
      const message = error instanceof Error ? error.message : '骨架预览生成失败';
      const latest = nodesRef.current.find((candidate) => candidate.id === id);
      const latestPose = collectGeneratorInputsFromGraph(nodesRef.current, edgesRef.current, id).find((input) => input.type === 'image' && input.port === 'pose');
      const latestModel = latest ? models.find((candidate) => candidate.id === latest.data.modelId) : undefined;
      const latestRatio = latestModel?.profile?.ratios.includes(String(latest?.data.ratio || '')) ? String(latest?.data.ratio) : latestModel?.defaults?.ratio || latestModel?.profile?.defaultRatio || '3:4';
      const latestEstimator = latest?.data.poseEstimator === 'dwpose' ? 'dwpose' : 'sdpose';
      if (!latest || latestPose?.value !== poseInput.value || latestRatio !== ratio || latestEstimator !== poseEstimator) return;
      updateNode(id, { posePreviewState: 'failed', posePreviewError: message }, 'runtime');
      setToast(message);
    }
  }, [activeCanvasId, apiFetch, models, publicMode, shareMode, task.taskId, updateNode]);
  const syncComfyUiEditorCanvasState = useCallback((id: string, canvasState: Record<string, unknown>) => {
    const current = nodesRef.current.find((node) => node.id === id && node.data.kind === 'comfyUiWorkflow');
    if (!current) return;
    const selectedModel = models.find((model) => model.id === current.data.modelId);
    const positive = reconcilePromptTokenSelection(
      String(canvasState.positivePrompt || ''), current.data.prompt || '', current.data.promptTokenIds, selectedModel?.adapter, 'positive', current.data.prompt || '', selectedModel?.localImageFamily,
    );
    const negative = reconcilePromptTokenSelection(
      String(canvasState.negativePrompt || ''), current.data.negativePrompt || '', current.data.negativePromptTokenIds, selectedModel?.adapter, 'negative', current.data.negativePrompt || '', selectedModel?.localImageFamily,
    );
    const fixedSeed = canvasState.comfySeedMode === 'fixed' && Number.isInteger(Number(canvasState.seed));
    updateNode(id, {
      prompt: positive.manualPrompt,
      negativePrompt: negative.manualPrompt,
      promptTokenIds: positive.selectedIds,
      negativePromptTokenIds: negative.selectedIds,
      comfyParameterBinding: `${String(current.data.modelId || '').trim()}::${String(current.data.workflowId || '').trim()}`,
      ...(typeof canvasState.ratio === 'string' ? { ratio: canvasState.ratio } : {}),
      ...(typeof canvasState.resolution === 'string' ? { resolution: canvasState.resolution } : {}),
      comfySeedMode: fixedSeed ? 'fixed' : 'random',
      seed: fixedSeed ? Number(canvasState.seed) : undefined,
      ...(Number.isFinite(Number(canvasState.comfySteps)) ? { comfySteps: Number(canvasState.comfySteps) } : {}),
      ...(Number.isFinite(Number(canvasState.comfyCfg)) ? { comfyCfg: Number(canvasState.comfyCfg) } : {}),
      ...(typeof canvasState.comfySampler === 'string' ? { comfySampler: canvasState.comfySampler } : {}),
      ...(typeof canvasState.comfyScheduler === 'string' ? { comfyScheduler: canvasState.comfyScheduler } : {}),
      ...(Number.isFinite(Number(canvasState.comfyDenoise)) ? { comfyDenoise: Number(canvasState.comfyDenoise) } : {}),
      ...(typeof canvasState.characterLora === 'string' ? { characterLora: canvasState.characterLora } : {}),
      ...(Number.isFinite(Number(canvasState.characterLoraStrength)) ? { characterLoraStrength: Number(canvasState.characterLoraStrength) } : {}),
      status: '完整工作流已同步到当前节点',
    });
  }, [models, updateNode]);
  const endTextEdit = useCallback((id: string) => {
    const timer = textEditRef.current.get(id);
    if (timer != null) window.clearTimeout(timer);
    textEditRef.current.delete(id);
  }, []);

  const uploadAsset = useCallback(async (id: string, file: File) => {
    updateNode(id, { status: '正在上传...' });
    const body = new FormData(); body.append('file', file);
    try {
      const response = await apiFetch(`/api/v1/canvas/${encodeURIComponent(task.taskId)}/assets`, { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '上传失败');
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        primePersistentMediaLod({
          sourceUrl: payload.url,
          mediaType: file.type.startsWith('video/') ? 'video' : 'image',
          previewUrl: payload.previewUrl,
          sourceBlob: file,
        });
      }
      updateNode(id, { mediaUrl: payload.url, previewUrl: payload.previewUrl, mediaType: payload.mediaType, outputType: payload.mediaType, fileName: payload.originalName, mediaWidth: Number(payload.width) || undefined, mediaHeight: Number(payload.height) || undefined, imageInpaintActive: false, imageInpaintPreviousUrl: undefined, imageInpaintPreviousPreviewUrl: undefined, imageInpaintPreviousFileName: undefined, imageInpaintPreviousWidth: undefined, imageInpaintPreviousHeight: undefined, imageInpaintMaskUrl: undefined, status: '上传完成' });
      return true;
    } catch (error) {
      updateNode(id, { status: error instanceof Error ? error.message : '上传失败' });
      return false;
    }
  }, [apiFetch, task.taskId, updateNode]);

  const applyJob = useCallback((job: Job) => {
    const targetNode = nodesRef.current.find((node) => node.id === job.nodeId);
    const targetModel = targetNode?.data.models?.find((model) => model.id === targetNode.data.modelId);
    const completedElapsedMs = job.status === 'succeeded' ? Date.parse(job.updatedAt || '') - Date.parse(job.createdAt || '') : Number.NaN;
    const latestOutputs: ResultOutput[] = job.outputs.map((output) => ({
      mediaUrl: output.mediaUrl || undefined,
      fileName: output.fileName || undefined,
      ...output.metadata,
      ...(targetModel?.adapter === 'comfyui-minimax-h3' && Number.isFinite(completedElapsedMs) && completedElapsedMs >= 0 ? {
        generationDurationMs: Number(output.metadata?.generationDurationMs) >= 0 ? Number(output.metadata?.generationDurationMs) : completedElapsedMs,
        totalDurationMs: Number(output.metadata?.totalDurationMs) >= 0 ? Number(output.metadata?.totalDurationMs) : completedElapsedMs,
      } : {}),
    }));
    let nextNodes = nodesRef.current.map<CanvasNode>((node) => {
      if (node.id !== job.nodeId) return node;
      if (isTripoCharacterOperation(job.tripoPostprocessOperation) || isTripoCharacterOperation(job.activeCharacterOperation)) {
        return { ...node, data: { ...node.data, ...characterCanvasPatchFromJob(job) } };
      }
      const tripoSubmittedOptions = node.data.kind === 'modelGenerator' ? tripoSubmittedOptionsFromJob(job.options, job.createdAt) : undefined;
      const isPostprocess = Boolean(job.tripoPostprocessOperation);
      const isResultPostprocess = Boolean(job.tripoPostprocessOperation && node.data.kind === 'result');
      const isGeneratorExport = Boolean(job.tripoPostprocessOperation === 'convert' && node.data.kind === 'modelGenerator');
      const isGeneratorOptimization = Boolean(['texture', 'retopology'].includes(job.tripoPostprocessOperation || '') && node.data.kind === 'modelGenerator');
      const postprocessVersions = isResultPostprocess && job.status === 'succeeded' && latestOutputs.length
        ? [
          ...(node.data.resultVersions || []).filter((version) => version.jobId !== job.id),
          { jobId: job.id, createdAt: job.updatedAt || new Date().toISOString(), outputs: latestOutputs, mediaType: 'model' as const },
        ]
        : undefined;
      const exportFormat = modelOutputFormat(latestOutputs[0], node.data.modelExportFormat);
      const modelExportVersions = isGeneratorExport && job.status === 'succeeded' && latestOutputs.length
        ? [
          ...(node.data.modelExportVersions || []).filter((version) => version.jobId !== job.id),
          { jobId: job.id, format: exportFormat, createdAt: job.updatedAt || new Date().toISOString(), outputs: latestOutputs, sourceTaskId: node.data.modelExportSourceTaskId, sourceVersion: node.data.modelExportSourceVersion },
        ]
        : undefined;
      const modelVersions = node.data.kind === 'modelGenerator' && job.status === 'succeeded' && latestOutputs.length && !isGeneratorExport
        ? isGeneratorOptimization
          ? [
            ...(node.data.modelVersions?.length
              ? node.data.modelVersions.filter((version) => version.jobId !== job.id)
              : node.data.latestOutputs?.length
                ? [{ jobId: `source-${job.id}`, createdAt: node.data.jobStartedAt, outputs: node.data.latestOutputs, operation: 'generate' as const }]
                : []),
            { jobId: job.id, createdAt: job.updatedAt || new Date().toISOString(), outputs: latestOutputs, operation: job.tripoPostprocessOperation as 'texture' | 'retopology' },
          ]
          : [{ jobId: job.id, createdAt: job.updatedAt || new Date().toISOString(), outputs: latestOutputs, operation: 'generate' as const }]
        : undefined;
      const postprocessFirst = latestOutputs[0];
      const isVideoUpscale = node.data.videoUpscale === true && job.modelId === TOPAZ_UPSCALE_MODEL_ID;
      const videoUpscaleOutput = isVideoUpscale ? latestOutputs.find((output) => output.mediaUrl) : undefined;
      const isImageInpaint = node.data.kind === 'image' && node.data.imageInpaintActive === true;
      const imageInpaintOutput = isImageInpaint && job.status === 'succeeded' ? latestOutputs.find((output) => output.mediaUrl) : undefined;
      const videoUpscaleModel = String(job.options?.topazModel || node.data.topazModel || '星光 2.6');
      const videoUpscaleScale = Number(job.options?.topazScale || node.data.topazScale || 2);
      // Image/video results are fitted from their decoded output dimensions
      // below. Resetting them to the generic generator frame on every terminal
      // poll caused portrait nodes to oscillate between 320x205 and 320x480.
      const restoreGeneratorFrame = job.status === 'succeeded' && node.data.kind === 'modelGenerator';
      const width = nodeWidth(node);
      const frameDimensions = restoreGeneratorFrame
        ? { width, height: node.data.kind === 'modelGenerator' ? modelGeneratorNodeFrameHeight(width) : generatorNodeFrameHeight(width) }
        : undefined;
      const previousGenerationVersions = node.data.generationVersions?.length
        ? node.data.generationVersions
        : node.data.latestOutputs?.length && node.data.jobId && node.data.jobId !== job.id
          ? [{ jobId: node.data.jobId, createdAt: String(node.data.jobUpdatedAt || node.data.jobStartedAt || '') || undefined, outputs: node.data.latestOutputs, mediaType: node.data.latestMediaType || job.outputs[0]?.mediaType || 'image' }]
          : [];
      const generationVersions = job.status === 'succeeded'
        && latestOutputs.length
        && ['imageGenerator', 'videoGenerator', 'comfyUiWorkflow'].includes(node.data.kind)
        ? [
          ...previousGenerationVersions.filter((version) => version.jobId !== job.id),
          { jobId: job.id, createdAt: job.updatedAt || new Date().toISOString(), outputs: latestOutputs, mediaType: job.outputs[0]?.mediaType || 'image' },
        ].slice(-GENERATION_OUTPUT_RETENTION_STEPS)
        : undefined;
      return {
        ...node,
        ...frameDimensions,
        ...(frameDimensions ? {
          measured: { ...node.measured, ...frameDimensions },
          style: { ...node.style, ...frameDimensions },
        } : {}),
        data: {
          ...node.data, jobId: job.id, jobState: job.status, jobStartedAt: job.createdAt || job.updatedAt || node.data.jobStartedAt || new Date().toISOString(), jobUpdatedAt: job.updatedAt || node.data.jobUpdatedAt, jobDeadlineAt: job.deadlineAt, progress: job.progress, comfyPreview: ['succeeded', 'cancelled'].includes(job.status) ? undefined : job.comfyPreview, stale: false, cancelling: job.status === 'cancelling', jobPollLost: false,
          localQueue: job.localQueue,
          ...(job.status === 'succeeded' && latestOutputs.length && !isGeneratorExport ? { latestOutputs, latestOutputJobId: job.id, latestMediaType: job.outputs[0].mediaType, selectedOutput: 0 } : {}),
          ...(generationVersions ? { generationVersions } : {}),
          ...(tripoSubmittedOptions ? { tripoSubmittedOptions } : {}),
          ...(isPostprocess ? { tripoPostprocessOperation: job.tripoPostprocessOperation, ...(job.postprocessResult ? { tripoPostprocessResult: job.postprocessResult } : {}) } : {}),
          ...(modelExportVersions ? { modelExportVersions, modelExportFormat: exportFormat } : {}),
          ...(modelVersions ? { modelVersions, selectedModelVersion: modelVersions.length - 1, modelTextureMetadata: undefined, ...(node.data.characterRuns ? { characterRuns: markCanvasCharacterRunsStale(node.data.characterRuns, modelVersions) } : {}), ...(!isGeneratorOptimization ? { modelExportVersions: [], modelExportFormat: undefined, modelExportSourceTaskId: undefined, modelExportSourceVersion: undefined, tripoPostprocessOperation: undefined } : {}) } : {}),
          ...(postprocessVersions ? { resultVersions: postprocessVersions, selectedVersion: postprocessVersions.length - 1, outputs: latestOutputs, selectedOutput: 0, outputType: 'model', mediaType: 'model', mediaUrl: postprocessFirst?.mediaUrl, fileName: postprocessFirst?.fileName } : {}),
          ...(job.status === 'succeeded' && videoUpscaleOutput ? { mediaUrl: videoUpscaleOutput.mediaUrl, fileName: videoUpscaleOutput.fileName, mediaType: 'video', outputType: 'video' } : {}),
          ...(imageInpaintOutput ? { mediaUrl: imageInpaintOutput.mediaUrl, previewUrl: imageInpaintOutput.previewUrl, fileName: imageInpaintOutput.fileName, mediaWidth: Number(imageInpaintOutput.width) || node.data.mediaWidth, mediaHeight: Number(imageInpaintOutput.height) || node.data.mediaHeight, mediaType: 'image', outputType: 'image' } : {}),
          ...(isImageInpaint && ['succeeded', 'failed', 'cancelled'].includes(job.status) ? { imageInpaintActive: false } : {}),
          status: isImageInpaint
            ? job.status === 'queued' ? (job.localQueue?.ahead ? `等待局部重绘 · 前方 ${job.localQueue.ahead} 个任务` : '等待本机局部重绘') : job.status === 'running' ? (job.stage || `正在局部重绘 · ${Math.round(job.progress || 0)}%`) : job.status === 'cancelling' ? '正在停止局部重绘…' : job.status === 'succeeded' ? '局部重绘完成' : job.status === 'cancelled' ? '局部重绘已取消，原图未改变' : `局部重绘失败：${job.error || '请再试一次'}`
            : isVideoUpscale
            ? videoUpscaleJobStatus(job, videoUpscaleModel, videoUpscaleScale)
            : job.status === 'queued' ? (job.localQueue ? `本机排队中 · 前方 ${job.localQueue.ahead} 个任务` : isGeneratorExport ? '模型导出任务排队中' : isGeneratorOptimization ? '模型优化任务排队中' : isResultPostprocess ? '后处理任务排队中' : '任务排队中') : job.status === 'running' ? (isGeneratorExport ? `正在转换 ${node.data.modelExportFormat || '模型格式'}` : isGeneratorOptimization ? '正在优化模型' : isResultPostprocess ? 'Tripo 后处理中' : job.stage || '生成中') : job.status === 'cancelling' ? '正在取消任务，请稍候…' : job.status === 'paused' ? `远端任务已暂停：${job.error || '可恢复已有任务，或明确确认后新建远端任务'}` : job.status === 'succeeded' ? (isGeneratorExport ? `${exportFormat || '模型'} 导出文件已生成` : isGeneratorOptimization ? `模型优化完成：${modelProcessBaseLabel(job.tripoPostprocessOperation)}` : isResultPostprocess ? job.tripoPostprocessOperation === 'rig-check' ? '绑定检查完成' : '后处理完成，已追加为新版本' : '生成完成') : job.status === 'cancelled' ? '任务已取消' : `${isGeneratorExport ? '模型导出' : isGeneratorOptimization ? '模型优化' : isResultPostprocess ? '后处理' : '生成'}失败：${job.error || '未知错误'}`,
        },
      };
    });
    const completedMedia = job.status === 'succeeded'
      ? latestOutputs.find((output) => output.mediaUrl && Number(output.width) > 0 && Number(output.height) > 0)
      : undefined;
    if (completedMedia) {
      nextNodes = fitCanvasMediaNodeInCanvas(nextNodes, job.nodeId, Number(completedMedia.width), Number(completedMedia.height));
    }
    if (targetNode?.data.imageInpaintActive && job.status === 'succeeded') {
      const staleIds = descendants(job.nodeId);
      nextNodes = nextNodes.map((node) => staleIds.has(node.id) && (node.data.jobState === 'succeeded' || node.data.kind === 'result')
        ? { ...node, data: { ...node.data, stale: true, status: '原图已局部重绘，后续结果可能过期' } }
        : node);
    }
    const updatedModelNode = nextNodes.find((node) => node.id === job.nodeId && node.data.kind === 'modelGenerator');
    const updatedModelVersions = updatedModelNode?.data.modelVersions;
    if (updatedModelNode && job.status === 'succeeded' && updatedModelVersions?.length) {
      const downstreamCharacterIds = new Set(edgesRef.current
        .filter((edge) => edge.source === updatedModelNode.id)
        .map((edge) => edge.target));
      nextNodes = nextNodes.map((node) => {
        if (node.data.kind !== 'characterAnimator' || !downstreamCharacterIds.has(node.id)) return node;
        const characterRuns = markCanvasCharacterRunsStale(node.data.characterRuns, updatedModelVersions) || [];
        const allSourcesMissing = characterRuns.length > 0 && characterRuns.every((run) => run.stale);
        return {
          ...node,
          data: {
            ...node.data,
            modelVersions: updatedModelVersions,
            characterRuns,
            stale: allSourcesMissing,
            ...(allSourcesMissing ? { status: '来源模型版本已替换；历史绑定结果仍保留，请从新版本创建角色节点。' } : {}),
          },
        };
      });
    }
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
  }, [descendants, setNodes]);

  const pollJob = useCallback((jobId: string) => {
    if (pollTimers.current.has(jobId)) return;
    const epoch = (pollEpochs.current.get(jobId) || 0) + 1;
    pollEpochs.current.set(jobId, epoch);
    const poll = async () => {
      const requestController = new AbortController();
      const requestTimeout = window.setTimeout(() => requestController.abort(), 8_000);
      try {
        const jobUrl = publicMode
          ? `/api/public/jobs/${encodeURIComponent(jobId)}`
          : `/api/v1/jobs/${encodeURIComponent(jobId)}?taskId=${encodeURIComponent(task.taskId)}`;
        const response = await apiFetch(jobUrl, { signal: requestController.signal });
        const payload = await response.json();
        if (pollEpochs.current.get(jobId) !== epoch) return;
        if (!response.ok) {
          if (publicMode && response.status === 401) setPublicWorkspaceIssue('外部工作区会话已失效，请重新打开。');
          throw new Error(payload.error || '任务查询失败');
        }
        pollFailures.current.delete(jobId);
        applyJob(payload.job);
        if (payload.job.status === 'queued' || payload.job.status === 'running' || payload.job.status === 'cancelling') pollTimers.current.set(jobId, window.setTimeout(poll, 500));
        else pollTimers.current.delete(jobId);
      } catch (error) {
        if (pollEpochs.current.get(jobId) !== epoch) return;
        const reason = error instanceof DOMException && error.name === 'AbortError'
          ? '任务状态查询超时'
          : error instanceof Error ? error.message : '任务查询失败';
        const failures = (pollFailures.current.get(jobId) || 0) + 1;
        if (failures < 3) {
          pollFailures.current.set(jobId, failures);
          setToast(`${reason}，正在重试（${failures}/3）`);
          pollTimers.current.set(jobId, window.setTimeout(poll, failures * 1_000));
        } else {
          pollFailures.current.delete(jobId);
          pollTimers.current.delete(jobId);
          setNodes((current) => current.map((node) => isActiveCanvasCharacterJob(node.data, jobId)
            ? { ...node, data: { ...node.data, characterJobState: 'failed', characterStatus: `角色任务状态连续查询失败：${reason}。可恢复远端任务。` } }
            : node));
          const status = `任务状态连续查询失败，画布已停止等待：${reason}。你可以重新查询或取消任务。`;
          setNodes((current) => current.map((node) => node.data.jobId === jobId && (node.data.jobState === 'queued' || node.data.jobState === 'running' || node.data.jobState === 'cancelling')
            ? { ...node, data: { ...node.data, jobState: 'failed', jobPollLost: true, cancelling: false, status } }
            : node));
          setToast('任务状态查询已中断，画布不再持续等待');
        }
      } finally {
        window.clearTimeout(requestTimeout);
      }
    };
    pollTimers.current.set(jobId, window.setTimeout(poll, 250));
  }, [apiFetch, applyJob, publicMode, setNodes, task.taskId]);

  useEffect(() => {
    if (!ready || !hasTaskContext || publicMode) return;
    let stopped = false;
    let syncing = false;
    let controller: AbortController | null = null;
    const reconcileJobs = async () => {
      if (stopped || syncing || document.visibilityState === 'hidden') return;
      syncing = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 8_000);
      try {
        const response = await apiFetch(`/api/v1/jobs?taskId=${encodeURIComponent(task.taskId)}&canvasId=${encodeURIComponent(activeCanvasId)}`, { signal: controller.signal });
        const payload = await readApiJson(response);
        if (!response.ok || stopped) return;
        const latestJobs = latestCanvasJobsByNode(Array.isArray(payload.jobs) ? payload.jobs as Job[] : []);
        latestJobs.forEach((job) => {
          const node = nodesRef.current.find((entry) => entry.id === job.nodeId);
          if (!node || !canvasJobNeedsRefresh(node.data, job)) return;
          applyJob(job);
          if (job.status === 'queued' || job.status === 'running' || job.status === 'cancelling') pollJob(job.id);
        });
      } catch {
        // A localhost service restart is expected to fail briefly. The next focus,
        // visibility, online, or interval signal retries without disturbing edits.
      } finally {
        window.clearTimeout(timeout);
        controller = null;
        syncing = false;
      }
    };
    const onResume = () => { void reconcileJobs(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void reconcileJobs(); };
    window.addEventListener('focus', onResume);
    window.addEventListener('online', onResume);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = window.setInterval(onResume, 15_000);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onResume);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeCanvasId, apiFetch, applyJob, hasTaskContext, pollJob, publicMode, ready, task.taskId]);

  const collectInputs = useCallback((id: string) => collectGeneratorInputsFromGraph(nodesRef.current, edgesRef.current, id), []);

  const runGenerator = useCallback(async (id: string) => {
    if (shareMode && !publicMode) {
      setToast('外部分享模式暂不允许生成');
      return;
    }
    const node = nodesRef.current.find((item) => item.id === id);
    if (!node || !['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow'].includes(node.data.kind)) return;
    const capability = node.data.kind === 'imageGenerator' || node.data.kind === 'comfyUiWorkflow' ? 'image' : node.data.kind === 'videoGenerator' ? 'video' : node.data.kind === 'audioGenerator' ? 'audio' : 'model';
    const selectedModel = node.data.kind === 'comfyUiWorkflow'
      ? models.find((model) => model.id === node.data.modelId && model.capability === 'image' && (model.workflows?.length || model.workflow?.capability === 'image'))
        || models.find((model) => model.capability === 'image' && (model.workflows?.length || model.workflow?.capability === 'image'))
      : models.find((model) => model.id === node.data.modelId && model.capability === capability) || models.find((model) => model.capability === capability);
    if (node.data.kind === 'comfyUiWorkflow' && !selectedModel) {
      const message = '未找到可用的本地 ComfyUI 图片工作流';
      updateNode(id, { jobState: 'failed', status: message }, 'runtime');
      setToast(message);
      return;
    }
    const usesPromptPresets = capability !== 'audio' && (node.data.kind !== 'modelGenerator' || (node.data.modelInputMode || 'text') === 'text');
    const promptTokenTarget = capability === 'image' ? 'image' : capability === 'video' ? 'video' : 'model';
    const tokenCompiledPrompt = usesPromptPresets
      ? compilePromptTokenSelection(node.data.prompt || '', node.data.promptTokenIds, selectedModel?.adapter, 'positive', node.data.prompt || '', promptTokenTarget, selectedModel?.localImageFamily)
      : node.data.prompt || '';
    const selectedModelingStyle = node.data.kind === 'imageGenerator' && isModelingStyleId(node.data.modelingStyleId)
      ? node.data.modelingStyleId
      : undefined;
    const effectiveAuthoredPrompt = selectedModelingStyle
      ? applyModelingStyleContract(tokenCompiledPrompt, selectedModelingStyle)
      : tokenCompiledPrompt;
    const compiledNegativePrompt = usesPromptPresets && supportsNegativePromptTokens(selectedModel?.adapter)
      ? compilePromptTokenSelection(node.data.negativePrompt || '', node.data.negativePromptTokenIds, selectedModel?.adapter, 'negative', node.data.negativePrompt || '', promptTokenTarget, selectedModel?.localImageFamily)
      : '';
    const collectedInputs = collectInputs(id) as GeneratorInput[];
    const selectedInputs = filterPromptImageInputs(collectedInputs, effectiveAuthoredPrompt);
    let inputs = selectedInputs;
    try {
      if (node.data.kind === 'videoGenerator') inputs = mapVideoMaterialInputs(selectedInputs, node.data.videoInputMode === 'first' ? 'first' : node.data.videoInputMode === 'first_last' ? 'first_last' : 'reference');
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频素材输入无效';
      updateNode(id, { jobState: 'failed', status: message }, 'runtime');
      setToast(message);
      return;
    }
    let prompt = resolvePromptTextReferences(effectiveAuthoredPrompt, inputs);
    if (capability === 'image') {
      const canonical = canonicalizeImageReferenceSubmission(prompt, inputs);
      prompt = canonical.prompt;
      inputs = canonical.inputs;
    }
    if (['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(selectedModel?.adapter || '')) {
      const workflows = selectedModel?.workflows?.length ? selectedModel.workflows : selectedModel?.workflow ? [selectedModel.workflow] : [];
      const workflow = workflows.find((candidate) => candidate.id === node.data.workflowId) || workflows[0];
      if (!workflow) {
        const message = '当前本地模型还没有可用的生成方式';
        updateNode(id, { jobState: 'failed', status: message }, 'runtime');
        setToast(message);
        return;
      }
      const bindingPlan = planLocalMediaBindings({
        workflow,
        inputs: inputs.map((input) => {
          if (input.type !== 'image' || input.strength !== undefined) return input as unknown as Record<string, unknown>;
          const workflowDefaults = workflow.controlDefaults || {};
          const effectiveStrength = input.port === 'identity' ? node.data.identityStrength ?? workflowDefaults.identityStrength
            : input.port === 'proportion' ? node.data.proportionStrength ?? workflowDefaults.proportionStrength
              : input.port === 'pose' ? node.data.poseStrength ?? workflowDefaults.poseStrength
                : input.port === 'lineart' ? node.data.lineartStrength ?? workflowDefaults.lineartStrength
                  : undefined;
          return effectiveStrength === undefined ? input as unknown as Record<string, unknown> : { ...input, strength: effectiveStrength };
        }),
        context: { family: selectedModel?.localImageFamily },
      });
      if (!bindingPlan.ready) {
        const message = bindingPlan.errors[0] || '当前图片不能用于这个生成方式';
        updateNode(id, { jobState: 'failed', status: message }, 'runtime');
        setToast(message);
        return;
      }
      if (!prompt.trim()) prompt = localMediaAutoPrompt(bindingPlan.bindings);
      let imageIndex = 0;
      inputs = inputs.map((input) => input.type === 'image'
        ? { ...bindingPlan.bindings[imageIndex++] } as GeneratorInput
        : input);
    }
    if (node.data.kind === 'comfyUiWorkflow') {
      const workflows = selectedModel?.workflows?.length ? selectedModel.workflows : selectedModel?.workflow ? [selectedModel.workflow] : [];
      const workflow = workflows.find((candidate) => candidate.id === node.data.workflowId) || workflows[0];
      const missingPort = workflow?.inputPorts?.find((port) => port.required && port.accepts.includes('image')
        && !inputs.some((input) => input.type === 'image' && input.port === port.id));
      if (missingPort) {
        const message = `请先连接${missingPort.label}`;
        updateNode(id, { jobState: 'failed', status: message }, 'runtime');
        setToast(message);
        return;
      }
    }
    if (selectedModel?.localImageFamily === 'qwen-image-edit-2511') {
      const qwenReferences = inputs.filter((input) => input.type === 'image');
      const qwenPorts = qwenReferences.map((input) => input.port);
      if (qwenReferences.length < 1 || qwenReferences.length > 2 || qwenPorts.filter((port) => port === 'reference').length !== 1 || qwenPorts.filter((port) => port === 'pose').length > 1 || qwenPorts.some((port) => !['reference', 'pose'].includes(port))) {
        const message = 'Qwen Image Edit 2511 需要角色外观图；动作姿势图可选，两个端口各限 1 张';
        updateNode(id, { jobState: 'failed', status: message }, 'runtime');
        setToast(message);
        return;
      }
    }
    const requiredMediaMissing = capability === 'video' && !inputs.some((input) => input.type === 'image' || input.type === 'video');
    const modelInputMode = node.data.modelInputMode || (inputs.some((input) => input.type === 'image') ? 'image' : 'text');
    const h3VideoInputMode = node.data.videoInputMode === 'first' ? 'first' : node.data.videoInputMode === 'first_last' ? 'first_last' : 'reference';
    const modelImages = inputs.filter((input) => input.type === 'image');
    let tripoOperation: 'generate-model' | 'image-to-multiview' | 'image-to-multiview-to-model' = 'generate-model';
    if (capability === 'model') {
      let message = '';
      if (modelInputMode === 'text' && !prompt.trim()) message = '文生 3D 需要提示词';
      else if (modelInputMode === 'image' && modelImages.length !== 1) message = '单图生 3D 需要 front 端口恰好一张图片';
      else if (modelInputMode === 'imageToMultiview' && modelImages.length !== 1) message = '单图→仅四视图需要 front 端口恰好一张图片';
      else if (modelInputMode === 'imageToMultiviewToModel' && modelImages.length !== 1) message = '单图→多视图→3D 需要 front 端口恰好一张图片';
      else if (modelInputMode === 'multiview') {
        const viewPorts = modelImages.map((input) => input.port);
        const namedPorts = new Set(viewPorts);
        if (modelImages.length < 2 || modelImages.length > 4 || !namedPorts.has('front') || namedPorts.size !== modelImages.length || viewPorts.some((port) => !['front', 'left', 'back', 'right'].includes(port))) {
          message = '直接多视图需要 2–4 张图片：front 必填，left/back/right 至少再接一个，且每个方向只能一张';
        }
      }
      if (message) {
        updateNode(id, { jobState: 'failed', status: message }, 'runtime');
        setToast(message);
        return;
      }
      tripoOperation = modelInputMode === 'imageToMultiview' ? 'image-to-multiview' : modelInputMode === 'imageToMultiviewToModel' ? 'image-to-multiview-to-model' : 'generate-model';
    }
    const localComfyImage = capability === 'image' && ['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(selectedModel?.adapter || '');
    if (localComfyImage && !prompt.trim()) {
      const message = inputs.some((input) => input.type === 'image') ? '当前修改需要说明要改什么' : '请描述想要生成的内容';
      updateNode(id, { jobState: 'failed', status: message }, 'runtime');
      setToast(message);
      return;
    }
    if (capability === 'audio') {
      const audioReferences = inputs.filter((input) => input.type === 'audio');
      const message = !prompt.trim()
        ? '请输入要朗读的文字'
        : audioReferences.length > 1
          ? '参考音色一次只能连接一段音频'
          : audioReferences.length === 1 && !String(node.data.audioReferenceText || '').trim()
            ? '请填写参考音频说了什么'
            : '';
      if (message) {
        updateNode(id, { jobState: 'failed', status: message }, 'runtime');
        setToast(message);
        return;
      }
    }
    if ((!localComfyImage && capability !== 'model' && !prompt.trim()) || requiredMediaMissing) {
      const message = !prompt.trim() ? '请先填写提示词' : '请先连接需要生成的视频或图片素材';
      updateNode(id, { jobState: 'failed', status: message }, 'runtime');
      setToast(message);
      return;
    }
    const defaults = generatorDefaults(models, capability);
    const profile = selectedModel?.profile;
    const requestedRatio = node.data.ratio || selectedModel?.defaults?.ratio || defaults.ratio;
    const storedResolution = String(node.data.resolution || '').toUpperCase();
    const requestedResolution = profile?.resolutions.includes(storedResolution)
      ? storedResolution
      : selectedModel?.defaults?.resolution || profile?.defaultResolution || defaults.resolution;
    const options = {
      // Output specification is independent from the canvas node's display frame.
      ratio: requestedRatio,
      count: capability === 'image' ? node.data.count || profile?.count.default || defaults.count : 1,
      duration: capability === 'video' ? normalizedVideoDuration(node.data.duration, profile, defaults.duration) : 5,
      resolution: requestedResolution,
      ...(selectedModel?.adapter === 'openai-image' ? { imageQuality: node.data.imageQuality || 'auto' } : {}),
      audioEnabled: capability === 'video' ? node.data.audioEnabled !== false && profile?.audio !== false : false,
      ...(capability === 'audio' ? {
        audioLanguage: node.data.audioLanguage || 'zh',
        audioSpeed: node.data.audioSpeed || selectedModel?.audioOptions?.speed?.default || 1,
        audioReferenceText: String(node.data.audioReferenceText || '').trim(),
      } : {}),
      ...(capability === 'video' && profile?.outputFormats ? { outputFormat: node.data.outputFormat === 'mov' ? 'mov' : 'mp4' } : {}),
      ...(['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(selectedModel?.adapter || '') ? {
        comfySeedMode: node.data.comfySeedMode === 'fixed' ? 'fixed' : 'random',
        ...(node.data.comfySeedMode === 'fixed' && Number.isInteger(Number(node.data.seed)) ? { seed: Number(node.data.seed) } : {}),
        comfySteps: Math.max(1, Math.min(100, Number(node.data.comfySteps ?? selectedModel?.comfyDefaults?.steps) || 28)),
        comfyCfg: Math.max(1, Math.min(30, Number(node.data.comfyCfg ?? selectedModel?.comfyDefaults?.cfg) || 5.5)),
        comfySampler: String(node.data.comfySampler || selectedModel?.comfyDefaults?.sampler || 'dpmpp_2m_sde'),
        comfyScheduler: String(node.data.comfyScheduler || selectedModel?.comfyDefaults?.scheduler || 'karras'),
        comfyDenoise: Math.max(0.05, Math.min(1, Number(node.data.comfyDenoise ?? selectedModel?.comfyDefaults?.denoise) || 1)),
        referenceDenoise: referenceDenoiseForSubmission(node.data.referenceDenoise),
        ...(compiledNegativePrompt ? { negativePrompt: compiledNegativePrompt } : {}),
        characterLora: String(node.data.characterLora || ''),
        characterLoraStrength: Math.max(0, Math.min(1.5, Number(node.data.characterLoraStrength ?? 0.8))),
        ...(['comfyui-illustrious', 'comfyui-sdxl', 'comfyui-native-image'].includes(selectedModel?.adapter || '') ? {
          poseStrength: Number(node.data.poseStrength ?? 0.85),
          poseEstimator: node.data.poseEstimator === 'dwpose' ? 'dwpose' : 'sdpose',
        } : {}),
        ...(['comfyui-illustrious', 'comfyui-native-image'].includes(selectedModel?.adapter || '') ? {
          styleLora: String(node.data.styleLora || ''),
        } : {}),
        ...(selectedModel?.adapter === 'comfyui-illustrious' ? {
          identityStrength: Number(node.data.identityStrength ?? 0.75),
          proportionStrength: Number(node.data.proportionStrength ?? 0.45),
          lineartStrength: Number(node.data.lineartStrength ?? 0.7),
          objectLora: String(node.data.objectLora || ''),
        } : {}),
      } : {}),
      ...(selectedModel?.adapter === 'comfyui-minimax-h3' ? {
        refImageSize: node.data.refImageSize === 'max' ? 'max' : 'match',
        referenceVideoAudio: node.data.referenceVideoAudio !== false,
        h3EncodingPreset: ['quality', 'compact', 'quality10'].includes(String(node.data.h3EncodingPreset)) ? node.data.h3EncodingPreset : 'balanced',
        h3SamplingSteps: [24, 28].includes(Number(node.data.h3SamplingSteps)) ? node.data.h3SamplingSteps : 20,
        h3AccelerationMode: h3VideoInputMode !== 'reference' && ['community8', 'reference8'].includes(node.data.h3AccelerationMode || '') ? 'standard' : node.data.h3AccelerationMode === 'turbo' ? 'turbo' : node.data.h3AccelerationMode === 'community8' ? 'community8' : node.data.h3AccelerationMode === 'reference8' ? 'reference8' : 'standard',
        h3BlockCache: h3VideoInputMode === 'reference' && (node.data.h3AccelerationMode || 'standard') === 'standard' && node.data.h3BlockCache === true,
        h3FaceRefine: selectedModel?.managed !== true && node.data.h3FaceRefine === true,
        ...(node.data.seed === undefined ? {} : { seed: node.data.seed }),
      } : {}),
      ...(selectedModel?.adapter === 'seedance-video' ? {
        // Low-frequency Ark options remain safely pinned to server defaults.
        cameraFixed: Boolean(node.data.cameraFixed),
      } : {}),
      ...(selectedModel?.adapter === 'tripo3d-model' ? {
        workflow: modelInputMode === 'text' ? 'text-to-model' : modelInputMode === 'image' ? 'image-to-model' : modelInputMode === 'imageToMultiview' ? 'image-to-multiview' : modelInputMode === 'multiview' ? 'multiview-to-model' : 'image-to-multiview-to-model',
        texture: node.data.texture !== false,
        pbr: node.data.texture !== false && node.data.pbr !== false,
        textureQuality: node.data.textureQuality || 'standard',
        geometryQuality: isTripoP1Model(selectedModel) ? 'standard' : node.data.geometryQuality || (requestedResolution === 'DETAILED' ? 'detailed' : 'standard'),
        autoSize: Boolean(node.data.autoSize),
        exportUv: node.data.exportUv !== false,
        enableImageAutofix: Boolean(node.data.enableImageAutofix),
        quad: !isTripoP1Model(selectedModel) && Boolean(node.data.quad),
        smartLowPoly: !isTripoP1Model(selectedModel) && Boolean(node.data.smartLowPoly),
        generateParts: !isTripoP1Model(selectedModel) && Boolean(node.data.generateParts),
        ...(modelInputMode !== 'text' ? { textureAlignment: node.data.textureAlignment || 'original_image', orientation: node.data.orientation || 'default' } : {}),
        ...(modelInputMode === 'text' && compiledNegativePrompt ? { negativePrompt: compiledNegativePrompt } : {}),
        ...(node.data.modelSeed === undefined ? {} : { modelSeed: node.data.modelSeed }),
        ...(modelInputMode === 'text' && node.data.imageSeed !== undefined ? { imageSeed: node.data.imageSeed } : {}),
        ...(node.data.textureSeed === undefined ? {} : { textureSeed: node.data.textureSeed }),
        ...(node.data.faceLimit === undefined ? {} : { faceLimit: node.data.faceLimit }),
      } : {}),
    };
    if (selectedModel?.adapter === 'comfyui-minimax-h3') {
      if (generationContractVersion !== H3_GENERATION_CONTRACT_VERSION) {
        const message = '当前创作服务需要更新。任务未提交，请重启 AI 创作台后重试';
        updateNode(id, { jobState: 'failed', status: message }, 'runtime');
        setToast(message);
        return;
      }
      if (options.h3AccelerationMode === 'community8' && options.duration > 15) {
        const message = 'H3 社区增强 8步只支持 5–15 秒，请先调整时长';
        updateNode(id, { jobState: 'failed', status: message }, 'runtime');
        setToast(message);
        return;
      }
    }
    try {
      updateNode(id, generatorRunStartPatch(capability), 'runtime');
      const modelId = selectedModel?.id || node.data.modelId || '';
      const response = await apiFetch('/api/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.taskId, canvasId: activeCanvasId, taskTitle: task.title, nodeId: id, nodeTitle: node.data.title, modelId, capability, ...(node.data.kind === 'comfyUiWorkflow' && node.data.workflowId ? { workflowId: node.data.workflowId } : {}), ...(selectedModel?.adapter === 'comfyui-minimax-h3' ? { generationContractVersion: H3_GENERATION_CONTRACT_VERSION } : {}), ...(capability === 'model' ? { operation: tripoOperation } : {}), prompt, inputs, options }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '任务提交失败');
      if (selectedModel?.adapter === 'comfyui-minimax-h3') {
        try { assertH3GenerationEcho({ modelId, capability, prompt, inputs, options: options as H3GenerationOptions }, payload.job); }
        catch (contractError) {
          if (payload.job?.id) await apiFetch(`/api/v1/jobs/${encodeURIComponent(payload.job.id)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.taskId }) }).catch(() => undefined);
          throw contractError;
        }
      }
      const submittedJobId = String(payload.job?.id || '').trim();
      if (!submittedJobId) throw new Error('任务已提交，但暂时无法显示进度；请先在任务记录中确认，避免重复提交');
      applyJob(payload.job); pollJob(submittedJobId);
      return submittedJobId;
    } catch (error) { updateNode(id, { jobState: 'failed', status: error instanceof Error ? error.message : '任务提交失败' }, 'runtime'); setToast(error instanceof Error ? error.message : '任务提交失败'); }
  // The model catalog/profile is loaded asynchronously. Keep it in the dependency
  // list so generation never submits with the initial 5-second fallback profile.
  }, [activeCanvasId, apiFetch, applyJob, collectInputs, generationContractVersion, models, pollJob, publicMode, shareMode, task.taskId, task.title, updateNode]);

  const runComfyUiWorkflow = useCallback(async (id: string) => {
    const node = nodesRef.current.find((item) => item.id === id);
    if (!node || node.data.kind !== 'comfyUiWorkflow') return;
    const workflowModel = models.find((model) => model.id === node.data.modelId && (model.workflows?.length || model.workflow))
      || models.find((model) => model.workflows?.length || model.workflow);
    const workflows = workflowModel?.workflows?.length ? workflowModel.workflows : workflowModel?.workflow ? [workflowModel.workflow] : [];
    const workflow = workflows.find((item) => item.id === node.data.workflowId) || workflows[0];
    if (!workflowModel || !workflow) {
      const message = '当前节点没有可执行的本地 ComfyUI 工作流';
      updateNode(id, { jobState: 'failed', status: message }, 'runtime');
      setToast(message);
      return;
    }
    if (node.data.workflowId !== workflow.id) updateNode(id, { workflowId: workflow.id }, 'runtime');
    await runGenerator(id);
  }, [models, runGenerator, updateNode]);

  const runTripoPostprocess = useCallback(async (id: string, submission: TripoPostprocessSubmission) => {
    if (publicMode || shareMode) {
      setToast('Tripo3D 后处理仅支持本地编辑画布');
      return;
    }
    const node = nodesRef.current.find((item) => item.id === id);
    if (!node || (node.data.kind !== 'result' && node.data.kind !== 'modelGenerator' && node.data.kind !== 'characterAnimator')) return;
    const isCharacterSubmission = isTripoCharacterOperation(submission.operation)
      && Boolean(String(submission.options._characterRunId || '').trim());
    const versions = node.data.resultVersions || [];
    const activeVersion = versions[node.data.selectedVersion ?? Math.max(0, versions.length - 1)];
    const isModelWorkflowNode = node.data.kind === 'modelGenerator' || node.data.kind === 'characterAnimator';
    const generatorVersions = isModelWorkflowNode ? node.data.modelVersions || [] : [];
    const selectedGeneratorIndex = Math.min(
      node.data.selectedModelVersion ?? Math.max(0, generatorVersions.length - 1),
      Math.max(0, generatorVersions.length - 1),
    );
    const safeGeneratorIndex = node.data.kind === 'modelGenerator' && !isCharacterSubmission
      ? safeTripoOptimizationSourceIndex(generatorVersions, selectedGeneratorIndex, submission.operation)
      : -1;
    if (!isCharacterSubmission && node.data.kind === 'modelGenerator' && generatorVersions.length && safeGeneratorIndex < 0) {
      setToast('当前流程没有可用的原始建模或拓扑优化结果，已阻止创建无效任务。');
      return;
    }
    const selectedGeneratorVersion = generatorVersions[selectedGeneratorIndex];
    const characterGeneratorVersion = isCharacterSubmission
      ? resolveTripoCharacterSourceVersion(generatorVersions, submission.options, selectedGeneratorIndex)
      : undefined;
    const effectiveGeneratorVersion = isCharacterSubmission
      ? characterGeneratorVersion || selectedGeneratorVersion
      : safeGeneratorIndex >= 0 ? generatorVersions[safeGeneratorIndex] : undefined;
    const sourceWasAdjusted = Boolean(selectedGeneratorVersion && effectiveGeneratorVersion && selectedGeneratorVersion !== effectiveGeneratorVersion);
    if (sourceWasAdjusted) setToast('当前选中的是外观增强结果，已自动回溯到最近的几何流程，避免无效重复贴图。');
    const outputs = isModelWorkflowNode
      ? effectiveGeneratorVersion?.outputs || node.data.latestOutputs || []
      : activeVersion?.outputs || node.data.outputs || [];
    const selected = isModelWorkflowNode ? 0 : Math.min(node.data.selectedOutput || 0, Math.max(0, outputs.length - 1));
    const sourceOutput = outputs[selected];
    const sourceVersionOperation = effectiveGeneratorVersion?.operation || activeVersion?.operation || '';
    // Character operations must preserve the official remote task chain. A
    // retopology result can also have a local FBX archive, but selecting that
    // file here would replace task_id with file_token and break rig-check.
    const preferSourceAsset = !isCharacterSubmission && Boolean(sourceVersionOperation && sourceVersionOperation !== 'generate');
    const sourceTaskId = tripoPostprocessSourceTaskId(submission, sourceOutput?.tripoTaskId || '');
    if (!sourceTaskId && !(preferSourceAsset && sourceOutput?.mediaUrl && sourceOutput?.fileName)) {
      setToast('当前模型缺少 Tripo 源任务信息，暂时只能下载原始文件');
      return;
    }
    let requestBody;
    try {
      const connectedReferenceImages = submission.operation === 'texture' && submission.options.textureAlignment === 'original_image'
        ? (collectInputs(id) as GeneratorInput[])
          .filter((input) => input.type === 'image')
          .slice(0, 4)
          .map((input) => ({ port: input.port, type: 'image' as const, value: input.value }))
        : [];
      requestBody = buildTripoPostprocessApiBody({
        taskId: task.taskId,
        canvasId: activeCanvasId,
        taskTitle: task.title,
        nodeId: id,
        sourceTaskId,
        sourceAssetUrl: sourceOutput?.mediaUrl,
        sourceFileName: sourceOutput?.fileName,
        preferSourceAsset,
        referenceImages: connectedReferenceImages,
        sourceVersionOperation,
      }, submission);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Tripo 后处理参数无效');
      return;
    }
    let responseReceived = false;
    try {
      const generatorOperation = node.data.kind === 'modelGenerator' ? submission.operation : '';
      if (isCharacterSubmission) updateNode(id, { characterJobState: 'queued', characterProgress: 0, characterStatus: '正在提交角色任务', activeCharacterOperation: submission.operation as CanvasNodeData['activeCharacterOperation'], activeCharacterJobRunId: String(submission.options._characterRunId || '') }, 'runtime');
      if (!isCharacterSubmission)
      updateNode(id, { jobId: undefined, jobState: 'queued', jobStartedAt: new Date().toISOString(), progress: 0, status: generatorOperation === 'convert' ? `正在提交 ${String(submission.options.format || '').toUpperCase()} 导出任务` : ['texture', 'retopology'].includes(generatorOperation) ? '正在提交模型优化任务' : '正在提交 Tripo 后处理任务', tripoPostprocessOperation: submission.operation, ...(generatorOperation === 'convert' ? { modelExportFormat: String(submission.options.format || '').toUpperCase(), modelExportSourceTaskId: sourceTaskId, modelExportSourceVersion: (node.data.selectedModelVersion ?? Math.max(0, (node.data.modelVersions?.length || 1) - 1)) + 1 } : {}), tripoPostprocessResult: undefined, stale: false, cancelling: false, jobPollLost: false }, 'runtime');
      const response = await apiFetch('/api/v1/tripo3d/postprocess', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      responseReceived = true;
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Tripo 后处理任务提交失败');
      applyJob(payload.job); pollJob(payload.job.id);
    } catch (error) {
      if (isCharacterSubmission) {
        const characterReason = error instanceof Error ? error.message : '角色任务提交失败';
        const characterMessage = responseReceived ? characterReason : `角色任务提交结果未知，请先恢复查询，避免重复扣费：${characterReason}`;
        updateNode(id, { characterJobState: 'failed', characterStatus: characterMessage }, 'runtime');
        setToast(characterMessage);
        return;
      }
      const reason = error instanceof Error ? error.message : 'Tripo 后处理任务提交失败';
      const message = responseReceived ? reason : `后处理提交结果未知，请先刷新任务状态，避免重复提交：${reason}`;
      updateNode(id, { jobState: 'failed', tripoPostprocessOperation: undefined, status: message }, 'runtime'); setToast(message);
    }
  }, [activeCanvasId, apiFetch, applyJob, collectInputs, pollJob, publicMode, shareMode, task.taskId, task.title, updateNode]);

  const jobAction = useCallback(async (id: string, action: 'cancel' | 'retry' | 'resume' | 'retryPaid') => {
    const node = nodesRef.current.find((item) => item.id === id);
    if (!node?.data.jobId) return;
    const paidRetry = action === 'retryPaid' || action === 'retry';
    if (paidRetry) {
      const confirmed = await requestCanvasConfirmation({
        eyebrow: 'EXTERNAL RETRY', title: '新建远端任务', tone: 'paid', confirmLabel: '确认新建任务',
        message: canvasLanguage === 'en' ? 'This creates a new task at your cloud provider and may incur a new charge. To retrieve an existing task, cancel and choose Resume.' : '这会调用你配置的云服务创建新任务，可能产生新的费用。仅恢复已有任务时，请取消并选择恢复远端任务。',
      });
      if (!confirmed) return;
    }
    const requestController = new AbortController();
    const requestTimeout = window.setTimeout(() => requestController.abort(), 8_000);
    try {
      if (action === 'cancel') updateNode(id, { status: '正在确认任务是否可以取消…' }, 'runtime');
      if (action === 'resume') updateNode(id, { status: '正在恢复远端任务，不会创建新任务…' }, 'runtime');
      if (paidRetry) updateNode(id, { status: '已确认，正在创建新的远端任务…' }, 'runtime');
      const endpoint = action === 'retryPaid' ? 'retry' : action;
      const response = await apiFetch(`/api/v1/jobs/${encodeURIComponent(node.data.jobId)}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.taskId, ...(paidRetry ? { confirmNewPaidSubmission: true } : {}) }), signal: requestController.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '操作失败');
      applyJob(payload.job);
      if (action === 'cancel') {
        pollFailures.current.delete(node.data.jobId);
        if (payload.job.status === 'cancelling') {
          pollJob(payload.job.id);
        } else {
          pollEpochs.current.set(node.data.jobId, (pollEpochs.current.get(node.data.jobId) || 0) + 1);
          const timer = pollTimers.current.get(node.data.jobId);
          if (timer != null) window.clearTimeout(timer);
          pollTimers.current.delete(node.data.jobId);
        }
      } else {
        pollFailures.current.delete(payload.job.id);
        pollJob(payload.job.id);
      }
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? action === 'cancel' ? '取消等待超时，任务可能仍在继续；请稍后刷新状态' : '操作等待超时，请刷新任务状态'
        : error instanceof Error ? error.message : '操作失败';
      if (action === 'cancel') updateNode(id, { cancelling: false, status: `无法取消：${message}` }, 'runtime');
      setToast(message);
    } finally {
      window.clearTimeout(requestTimeout);
    }
  }, [apiFetch, applyJob, pollJob, requestCanvasConfirmation, task.taskId, updateNode]);
  const workflows = useWorkflowCollections({
    nodes,
    edges,
    nodesRef,
    edgesRef,
    setNodes,
    runGenerator,
    pushHistory,
    requestConfirmation: requestCanvasConfirmation,
    setToast,
    disabled: publicMode || shareMode,
  });

  const replaceCollectionInput = useCallback((collectionId: string, slotId: string, sourceId: string, sourceHandle?: string | null) => {
    const plan = planCollectionInputReplacement(nodesRef.current, edgesRef.current, collectionId, slotId, sourceId, sourceHandle || 'output');
    if (!plan.changed) return setToast(plan.error);
    pushHistory();
    nodesRef.current = plan.nodes; edgesRef.current = plan.edges;
    setNodes(plan.nodes); setEdges(plan.edges);
    setToast(`已替换 ${plan.usageCount} 处引用；原素材不变，Ctrl+Z 可撤销`);
  }, [pushHistory, setEdges, setNodes]);

  const disconnectCollectionInput = useCallback((_collectionId: string, _slotId: string) => {
    setToast('共同参考入口用于整体替换；请双击需要取消的关联曲线');
  }, [setToast]);

  const characterJobAction = useCallback(async (id: string, action: 'resume' | 'retryPaid') => {
    const node = nodesRef.current.find((item) => item.id === id);
    const characterJobId = node?.data.activeCharacterJobId;
    if (!characterJobId) return;
    const freeRigCheckRetry = action === 'retryPaid'
      && !characterRetryRequiresPaidConfirmation(node?.data.activeCharacterOperation);
    if (action === 'retryPaid' && !freeRigCheckRetry) {
      const confirmed = await requestCanvasConfirmation({
        eyebrow: 'EXTERNAL RETRY', title: '重试远端角色任务', tone: 'paid', confirmLabel: '确认重新提交',
        message: '这会调用你配置的 Tripo3D 服务新建角色任务，是否收费由服务商决定。已有远端任务请优先使用恢复，避免重复提交。',
      });
      if (!confirmed) return;
    }
    const requestController = new AbortController();
    const requestTimeout = window.setTimeout(() => requestController.abort(), 8_000);
    try {
      updateNode(id, {
        characterStatus: action === 'resume'
          ? '正在恢复远端角色任务，不会创建新任务'
          : freeRigCheckRetry
            ? '正在重新执行兼容检查'
            : '已确认，正在创建新的远端角色任务',
      }, 'runtime');
      const endpoint = action === 'retryPaid' ? 'retry' : 'resume';
      const response = await apiFetch(`/api/v1/jobs/${encodeURIComponent(characterJobId)}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.taskId, ...(action === 'retryPaid' ? { confirmNewPaidSubmission: true } : {}) }),
        signal: requestController.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '角色任务操作失败');
      applyJob(payload.job);
      pollFailures.current.delete(payload.job.id);
      pollJob(payload.job.id);
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? '角色任务操作请求超时，请重新查询状态'
        : error instanceof Error ? error.message : '角色任务操作失败';
      updateNode(id, { characterJobState: 'failed', characterStatus: message }, 'runtime');
      setToast(message);
    } finally {
      window.clearTimeout(requestTimeout);
    }
  }, [apiFetch, applyJob, pollJob, requestCanvasConfirmation, task.taskId, updateNode]);

  const resumeJobPolling = useCallback((id: string) => {
    const node = nodesRef.current.find((item) => item.id === id);
    if (!node?.data.jobId) return;
    const timer = pollTimers.current.get(node.data.jobId);
    if (timer != null) window.clearTimeout(timer);
    pollTimers.current.delete(node.data.jobId);
    pollFailures.current.delete(node.data.jobId);
    updateNode(id, { jobState: 'running', jobPollLost: false, cancelling: false, status: '正在重新查询任务状态…' }, 'runtime');
    pollJob(node.data.jobId);
  }, [pollJob, updateNode]);

  const setResultState = useCallback((id: string, state: ResultState) => {
    pushHistory();
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, resultState: state, status: resultStateLabel(state) } } : node));
  }, [pushHistory, setNodes]);
  const selectResultVersion = useCallback((id: string, versionIndex: number) => {
    const node = nodesRef.current.find((item) => item.id === id);
    const version = node?.data.resultVersions?.[versionIndex];
    if (!node || !version) return;
    const first = version.outputs[0];
    pushHistory();
    setNodes((current) => current.map((item) => item.id === id ? { ...item, data: { ...item.data, selectedVersion: versionIndex, outputs: version.outputs, selectedOutput: 0, mediaUrl: first?.mediaUrl, fileName: first?.fileName, mediaType: version.mediaType, outputType: version.mediaType, jobId: version.jobId } } : item));
  }, [pushHistory, setNodes]);
  const sendResult = useCallback((id: string, target: SendTarget) => {
    const source = nodesRef.current.find((node) => node.id === id);
    if (!source) return;
    const outputType = source.data.outputType || source.data.mediaType;
    if (!outputType) {
      setToast('当前结果暂无可发送的媒体类型');
      return;
    }
    const kind: SupportedCanvasNodeKind = target;
    const targetHandle = defaultInputPort(kind, outputType);
    const newId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const capability = kind === 'videoGenerator' ? 'video' : kind === 'audioGenerator' ? 'audio' : 'image';
    const defaults = generatorDefaults(models, capability);
    const node = {
      id: newId,
      type: kind,
      position: { x: source.position.x + nodeWidth(source) + 96, y: source.position.y },
      width: initialNodeWidth(kind),
      height: initialNodeHeight(kind),
      data: { kind, title: kind === 'imageGenerator' ? '图片生成' : kind === 'audioGenerator' ? '音频生成' : '视频生成', outputType: capability, ...defaults } as CanvasNodeData };
    pushHistory();
    setNodes((current) => [...current, node]);
    setEdges((current) => [...current, colorEdge({ id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, source: id, sourceHandle: 'output', target: newId, targetHandle }, outputType)]);
  }, [models, pushHistory, setEdges, setNodes]);
  const focusSource = useCallback((id: string) => {
    const source = nodesRef.current.find((node) => node.id === id);
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })));
    if (source) requestAnimationFrame(() => flow.setCenter(source.position.x + 180, source.position.y + 120, { zoom: Math.max(flow.getZoom(), 0.85), duration: 180 }));
  }, [flow, setNodes]);
  const inputReferencesFor = useCallback((nodeId: string, graphNodes = nodesRef.current, graphEdges = edgesRef.current): InputReference[] => (
    canvasInputReferencesFromGraph(graphNodes, graphEdges, nodeId)
  ), []);
  const createQuickCropNode = useCallback(async (sourceId: string, output: QuickCropOutput, requestedSourceUrl?: string) => {
    if (publicMode) throw new Error('共享画布暂不允许保存裁切结果');
    const source = nodesRef.current.find((node) => node.id === sourceId && ['image', 'imageGenerator', 'comfyUiWorkflow'].includes(node.data.kind));
    const sourceUrl = requestedSourceUrl || source?.data.mediaUrl || source?.data.latestOutputs?.find((item) => item.mediaUrl)?.mediaUrl;
    if (!source || !sourceUrl) throw new Error('未找到可裁切的原图');
    const stamp = Date.now();
    const id = `image-crop-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    const width = initialNodeWidth('image');
    const height = mediaNodeHeight(width, output.width, output.height);
    const position = rightCompanionNodePosition(source, nodesRef.current, width, height, id);
    const cropNode: CanvasNode = {
      id,
      type: 'image',
      selected: true,
      position,
      width,
      height,
      measured: { width, height },
      style: { width, height },
      data: {
        kind: 'image',
        title: `${source.data.title || '图片'} · ${output.label}`,
        mediaType: 'image',
        outputType: 'image',
        mediaWidth: output.width,
        mediaHeight: output.height,
        fileName: output.file.name,
        derivedFromNodeId: sourceId,
        status: '正在保存裁切结果…',
      } as CanvasNodeData,
    };
    const edge = colorEdge({
      id: `edge-image-crop-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
      source: sourceId,
      sourceHandle: 'output',
      target: id,
      targetHandle: 'lineage',
      data: { referenceOrder: stamp, sourceMediaUrl: sourceUrl, lineage: 'image-crop' },
      reconnectable: false,
    }, 'image');
    pushHistory();
    setNodes((current) => {
      const next = [...current.map((node) => ({ ...node, selected: false })), cropNode];
      nodesRef.current = next;
      return next;
    });
    setEdges((current) => {
      const next = [...current, edge];
      edgesRef.current = next;
      return next;
    });
    const body = new FormData();
    body.append('file', output.file, output.file.name);
    try {
      const response = await apiFetch(`/api/v1/canvas/${encodeURIComponent(task.taskId)}/assets`, { method: 'POST', body });
      const payload = await readApiJson(response);
      if (!response.ok) throw new Error(payload.error || '裁切结果保存失败');
      setNodes((current) => {
        const next = current.map((node) => node.id === id ? {
          ...node,
          data: { ...node.data, mediaUrl: payload.url, previewUrl: payload.previewUrl, fileName: payload.originalName || output.file.name, mediaWidth: output.width, mediaHeight: output.height, status: `裁切完成 · ${output.width} × ${output.height}` },
        } : node);
        nodesRef.current = next;
        return next;
      });
      setToast(`已创建并连接 ${output.label} 裁切图片`);
    } catch (reason) {
      setNodes((current) => {
        const next = current.filter((node) => node.id !== id);
        nodesRef.current = next;
        return next;
      });
      setEdges((current) => {
        const next = current.filter((candidate) => candidate.id !== edge.id);
        edgesRef.current = next;
        return next;
      });
      throw reason;
    }
  }, [apiFetch, publicMode, pushHistory, setEdges, setNodes, setToast, task.taskId]);
  const runImageInpaint = useCallback(async (sourceId: string, prompt: string, maskFile: File) => {
    if (publicMode || shareMode) throw new Error('局部重绘仅支持本地编辑画布');
    const source = nodesRef.current.find((node) => node.id === sourceId && node.data.kind === 'image');
    const sourceUrl = source?.data.mediaUrl;
    if (!source || !sourceUrl) throw new Error('未找到需要局部重绘的图片');
    if (['queued', 'running', 'cancelling'].includes(String(source.data.jobState || ''))) throw new Error('这张图片正在处理中，请稍候');
    const model = models.find((candidate) => candidate.id === 'anima-base-v1-local');
    const workflows = model?.workflows?.length ? model.workflows : model?.workflow ? [model.workflow] : [];
    const workflow = workflows.find((candidate) => candidate.id === 'anima-base-v1-inpaint-v1');
    if (!model || !workflow) throw new Error('本机还没有接好 Anima 局部重绘');
    if (!comfyUiWorkflowIsSelectable(workflow)) throw new Error(workflow.readiness?.blockingReasons?.[0] || 'Anima 局部重绘当前不可用');

    const body = new FormData();
    body.append('file', maskFile, maskFile.name);
    const assetResponse = await apiFetch(`/api/v1/canvas/${encodeURIComponent(task.taskId)}/assets`, { method: 'POST', body });
    const assetPayload = await readApiJson(assetResponse);
    if (!assetResponse.ok || !assetPayload.url) throw new Error(assetPayload.error || '重绘区域保存失败');

    const ratio = nearestSupportedRatio(Number(source.data.mediaWidth) || 1, Number(source.data.mediaHeight) || 1, model.profile?.ratios || [])
      || model.defaults?.ratio || model.profile?.defaultRatio || '1:1';
    const resolution = model.defaults?.resolution || model.profile?.defaultResolution || '1K';
    const options = {
      ratio,
      resolution,
      count: 1,
      duration: 5,
      audioEnabled: false,
      comfySeedMode: 'random',
      comfySteps: model.comfyDefaults?.steps || 30,
      comfyCfg: model.comfyDefaults?.cfg || 4,
      comfySampler: model.comfyDefaults?.sampler || 'er_sde',
      comfyScheduler: model.comfyDefaults?.scheduler || 'simple',
      comfyDenoise: 0.72,
      referenceDenoise: 0.72,
      poseStrength: 0.85,
      poseEstimator: 'sdpose',
      characterLora: '',
      characterLoraStrength: 0.8,
      styleLora: '',
    };
    pushHistory();
    updateNode(sourceId, {
      imageInpaintActive: true,
      imageInpaintPreviousUrl: sourceUrl,
      imageInpaintPreviousPreviewUrl: source.data.previewUrl,
      imageInpaintPreviousFileName: source.data.fileName,
      imageInpaintPreviousWidth: source.data.mediaWidth,
      imageInpaintPreviousHeight: source.data.mediaHeight,
      imageInpaintMaskUrl: String(assetPayload.url),
      modelId: model.id,
      workflowId: workflow.id,
      jobId: undefined,
      jobState: 'queued',
      progress: 0,
      status: '正在送往本机 Anima…',
    }, 'runtime');
    try {
      const response = await apiFetch('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.taskId,
          canvasId: activeCanvasId,
          taskTitle: task.title,
          nodeId: sourceId,
          modelId: model.id,
          capability: 'image',
          workflowId: workflow.id,
          prompt,
          inputs: [
            { port: 'reference', type: 'image', value: sourceUrl },
            { port: 'mask', type: 'image', value: String(assetPayload.url) },
          ],
          options,
        }),
      });
      const payload = await readApiJson(response);
      if (!response.ok) throw new Error(payload.error || '局部重绘任务提交失败');
      const submittedJobId = String(payload.job?.id || '').trim();
      if (!submittedJobId) throw new Error('局部重绘已提交，但暂时无法显示进度；请先查看任务记录，避免重复提交');
      applyJob(payload.job as Job);
      pollJob(submittedJobId);
      setToast('已开始局部重绘，原图会保留到完成');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '局部重绘任务提交失败';
      updateNode(sourceId, { imageInpaintActive: false, jobState: 'failed', status: message }, 'runtime');
      setToast(message);
      throw reason;
    }
  }, [activeCanvasId, apiFetch, applyJob, models, pollJob, publicMode, pushHistory, setToast, shareMode, task.taskId, task.title, updateNode]);
  const restoreImageInpaint = useCallback((sourceId: string) => {
    const source = nodesRef.current.find((node) => node.id === sourceId && node.data.kind === 'image');
    if (!source?.data.imageInpaintPreviousUrl) return;
    if (['queued', 'running', 'cancelling'].includes(String(source.data.jobState || ''))) {
      setToast('局部重绘正在进行，完成后再恢复');
      return;
    }
    updateNode(sourceId, {
      mediaUrl: source.data.imageInpaintPreviousUrl,
      previewUrl: source.data.imageInpaintPreviousPreviewUrl,
      fileName: source.data.imageInpaintPreviousFileName,
      mediaWidth: source.data.imageInpaintPreviousWidth,
      mediaHeight: source.data.imageInpaintPreviousHeight,
      imageInpaintPreviousUrl: undefined,
      imageInpaintPreviousPreviewUrl: undefined,
      imageInpaintPreviousFileName: undefined,
      imageInpaintPreviousWidth: undefined,
      imageInpaintPreviousHeight: undefined,
      imageInpaintMaskUrl: undefined,
      imageInpaintActive: false,
      jobId: undefined,
      jobState: undefined,
      progress: undefined,
      status: '已恢复到局部重绘前的图片',
    });
    setToast('已恢复上张图片');
  }, [setToast, updateNode]);
  const createVideoUpscaleNode = useCallback((sourceId: string, requestedSourceUrl?: string) => {
    if (publicMode || shareMode) {
      setToast('高清放大仅支持本地编辑画布');
      return;
    }
    const source = nodesRef.current.find((node) => node.id === sourceId && ['video', 'videoGenerator'].includes(node.data.kind));
    const sourceOutput = source?.data.latestOutputs?.find((output) => output.mediaUrl === requestedSourceUrl)
      || source?.data.latestOutputs?.find((output) => output.mediaUrl);
    const sourceUrl = requestedSourceUrl || source?.data.mediaUrl || sourceOutput?.mediaUrl;
    if (!source || !sourceUrl) {
      setToast('请先让视频节点产生可用视频');
      return;
    }
    const stamp = Date.now();
    const id = `video-upscale-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    const width = 356;
    const sourceWidth = Math.max(0, Number(source.data.mediaWidth) || Number(sourceOutput?.width) || 0);
    const sourceHeight = Math.max(0, Number(source.data.mediaHeight) || Number(sourceOutput?.height) || 0);
    const sourceDuration = Math.max(0, Number(source.data.mediaDuration) || Number(sourceOutput?.duration) || 0);
    const height = 436;
    const position = rightCompanionNodePosition(source, nodesRef.current, width, height, id);
    const upscaleNode: CanvasNode = {
      id,
      type: 'video',
      selected: true,
      position,
      width,
      height,
      measured: { width, height },
      style: { width, height },
      data: {
        kind: 'video',
        title: `${source.data.title || '视频'} · 高清放大`,
        mediaType: 'video',
        outputType: 'video',
        modelId: TOPAZ_UPSCALE_MODEL_ID,
        videoUpscale: true,
        videoUpscaleSourceUrl: sourceUrl,
        videoUpscaleSourceWidth: sourceWidth || undefined,
        videoUpscaleSourceHeight: sourceHeight || undefined,
        videoUpscaleSourceDuration: sourceDuration || undefined,
        derivedFromNodeId: sourceId,
        topazModel: '星光 2.6',
        topazVram: 22,
        topazScale: 2,
        topazStrength: 1,
        topazInputQuality: 14,
        topazSharpness: '锐利（默认）',
        status: '选择倍数和画面效果，然后开始',
      } as CanvasNodeData,
    };
    const edge = colorEdge({
      id: `edge-video-upscale-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
      source: sourceId,
      sourceHandle: 'output',
      target: id,
      targetHandle: 'lineage',
      data: { referenceOrder: stamp, sourceMediaUrl: sourceUrl, lineage: 'video-upscale' },
      reconnectable: false,
    }, 'video');
    pushHistory();
    setNodes((current) => {
      const next = [...current.map((node) => ({ ...node, selected: false })), upscaleNode];
      nodesRef.current = next;
      return next;
    });
    setEdges((current) => {
      const next = [...current, edge];
      edgesRef.current = next;
      return next;
    });
    setToast('已添加高清放大，确认后开始');
  }, [publicMode, pushHistory, setEdges, setNodes, setToast, shareMode]);

  const confirmVideoUpscale = useCallback(async (id: string) => {
    const node = nodesRef.current.find((candidate) => candidate.id === id && candidate.data.videoUpscale === true);
    const sourceUrl = String(node?.data.videoUpscaleSourceUrl || '').trim();
    if (!node || !sourceUrl) {
      setToast('高清放大节点缺少源视频，请从原视频重新创建');
      return;
    }
    if (['queued', 'running', 'cancelling'].includes(String(node.data.jobState || ''))) {
      setToast('高清放大任务已经在运行');
      return;
    }
    if (node.data.jobPollLost && node.data.jobId) {
      updateNode(id, { status: '正在重新查询高清放大任务', jobPollLost: false }, 'runtime');
      pollJob(node.data.jobId);
      setToast('正在重新查询高清放大任务');
      return;
    }
    const topazModels = ['星光 2.6', 'Astra', 'Astra HQ', 'Astra Fast', 'Astra Sharp'];
    const topazModel = topazModels.includes(String(node.data.topazModel)) ? String(node.data.topazModel) : '星光 2.6';
    const topazVram = Math.round(Math.min(24, Math.max(8, Number(node.data.topazVram) || 22)) * 10) / 10;
    const topazScale = Math.min(4, Math.max(1, Math.round(Number(node.data.topazScale) || 2))) as 1 | 2 | 3 | 4;
    const topazStrength = [0.7, 1, 1.3].includes(Number(node.data.topazStrength)) ? Number(node.data.topazStrength) as 0.7 | 1 | 1.3 : 1;
    const topazInputQuality = Math.min(40, Math.max(0, Math.round(Number(node.data.topazInputQuality ?? 14))));
    const topazSharpness = ['自然', '平衡', '锐利（默认）'].includes(String(node.data.topazSharpness)) ? String(node.data.topazSharpness) : '锐利（默认）';
    const sourceDuration = Math.max(0, Number(node.data.videoUpscaleSourceDuration) || 0);
    const retryJobId = ['failed', 'cancelled'].includes(String(node.data.jobState || '')) ? String(node.data.jobId || '').trim() : '';
    updateNode(id, { jobId: retryJobId || undefined, jobState: 'queued', progress: 0, status: '正在加入高清放大队列', stale: false, cancelling: false, jobPollLost: false, jobStartedAt: undefined, jobUpdatedAt: undefined, jobDeadlineAt: undefined, localQueue: undefined, comfyPreview: undefined }, 'runtime');
    try {
      const response = await apiFetch(retryJobId ? `/api/v1/jobs/${encodeURIComponent(retryJobId)}/retry` : '/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryJobId ? { taskId: task.taskId } : {
          taskId: task.taskId,
          canvasId: activeCanvasId,
          taskTitle: task.title,
          nodeId: id,
          modelId: TOPAZ_UPSCALE_MODEL_ID,
          capability: 'video',
          prompt: '',
          inputs: [{ port: 'source', type: 'video', value: sourceUrl, ...(sourceDuration > 0 ? { duration: sourceDuration } : {}) }],
          options: { ratio: '16:9', resolution: '4K', duration: 5, audioEnabled: true, topazModel, topazVram, topazScale, topazStrength, topazInputQuality, topazSharpness },
        }),
      });
      const payload = await readApiJson(response);
      if (!response.ok) throw new Error(payload.error || '高清放大任务提交失败');
      const jobId = String(payload.job?.id || '').trim();
      if (!jobId) throw new Error('高清放大已提交，但暂时无法显示进度；请先在任务记录中确认，避免重复提交');
      applyJob(payload.job);
      pollJob(jobId);
      setToast(`${retryJobId ? '已重新加入队列' : '已加入队列'} · ${topazModel} · ${topazScale}×`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '高清放大任务提交失败';
      updateNode(id, { jobState: 'failed', status: message }, 'runtime');
      setToast(message);
    }
  }, [activeCanvasId, apiFetch, applyJob, pollJob, setToast, task.taskId, task.title, updateNode]);
  const createTurnaroundSplit = useCallback((sourceId: string, mediaUrl?: string) => {
    if (publicMode) return;
    const source = nodesRef.current.find((node) => node.id === sourceId);
    const sourceUrl = mediaUrl || source?.data.mediaUrl || source?.data.latestOutputs?.find((output) => output.mediaUrl)?.mediaUrl;
    if (!source || !sourceUrl) return setToast('请先让图片节点产生可用图片');
    const existingEdge = edgesRef.current.find((edge) => edge.source === sourceId && nodesRef.current.find((node) => node.id === edge.target)?.data.kind === 'turnaroundSplitter');
    if (existingEdge) {
      setEdges((current) => current.map((edge) => edge.id === existingEdge.id ? { ...edge, data: { ...(edge.data || {}), sourceMediaUrl: sourceUrl } } : edge));
      setNodes((current) => current.map((node) => node.id === existingEdge.target
        ? { ...node, selected: true, data: { ...node.data, turnaroundSourceUrl: sourceUrl, turnaroundSourceNodeId: sourceId } }
        : { ...node, selected: false }));
      return;
    }
    const stamp = Date.now();
    const id = `turnaroundSplitter-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    const width = initialNodeWidth('turnaroundSplitter');
    const height = initialNodeHeight('turnaroundSplitter');
    const position = rightCompanionNodePosition(source, nodesRef.current, width, height, id);
    const node: CanvasNode = {
      id,
      type: 'turnaroundSplitter',
      selected: true,
      position,
      width,
      height,
      data: {
        kind: 'turnaroundSplitter',
        title: '多视图切分',
        turnaroundSourceUrl: sourceUrl,
        turnaroundSourceNodeId: sourceId,
        turnaroundSideRole: 'left',
        turnaroundViewCount: 3,
        turnaroundConfirmed: false,
        status: '正在识别三视图…',
      } as CanvasNodeData,
    };
    pushHistory();
    setNodes((current) => [...current.map((item) => ({ ...item, selected: false })), node]);
    setEdges((current) => [...current, colorEdge({
      id: `edge-turnaround-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
      source: sourceId,
      sourceHandle: 'output',
      target: id,
      targetHandle: 'input',
      data: { referenceOrder: stamp, sourceMediaUrl: sourceUrl },
      reconnectable: 'target',
    }, 'image')]);
  }, [publicMode, pushHistory, setEdges, setNodes]);
  const confirmTurnaroundSplit = useCallback(async (targetId: string, crops: TurnaroundCrop[], sideRole: TurnaroundSideRole) => {
    const node = nodesRef.current.find((item) => item.id === targetId);
    const sourceUrl = node?.data.turnaroundSourceUrl;
    if (!node || node.data.kind !== 'turnaroundSplitter' || !sourceUrl) throw new Error('未找到待切分的原图');
    const viewCount = crops.length;
    const viewLabels = multiViewLabels(viewCount, sideRole);
    setNodes((current) => current.map((item) => item.id === targetId ? { ...item, data: { ...item.data, status: `正在生成并保存 ${viewCount} 张视图…` } } : item));
    const files = await createTurnaroundCropFiles(sourceUrl, crops, sideRole, 1024, node.data.turnaroundMaskStrokes || []);
    const views = await Promise.all(files.map(async ({ file, role }) => {
      const body = new FormData();
      body.append('file', file, file.name);
      const response = await apiFetch(`/api/v1/canvas/${encodeURIComponent(task.taskId)}/assets`, { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `${role} 视图保存失败`);
      return { role, mediaUrl: payload.url, fileName: payload.originalName, width: 1024, height: 1024 } as TurnaroundViewAsset;
    }));
    pushHistory();
    setNodes((current) => current.map((item) => item.id === targetId ? {
      ...item,
      data: {
        ...item.data,
        turnaroundCrops: crops,
        turnaroundViewCount: viewCount,
        turnaroundSideRole: sideRole,
        turnaroundViews: views,
        turnaroundConfirmed: true,
        outputType: viewCount === 3 ? 'imageSet' : undefined,
        status: `切分完成：${viewLabels.join('、')}`,
      },
    } : item));
    staleNodes(edgesRef.current.filter((edge) => edge.source === targetId).map((edge) => edge.target), '多视图已更新，模型结果可能过期');
  }, [apiFetch, pushHistory, setNodes, staleNodes, task.taskId]);
  const placeTurnaroundImageNodes = useCallback((targetId: string) => {
    if (publicMode) return;
    const splitter = nodesRef.current.find((node) => node.id === targetId && node.data.kind === 'turnaroundSplitter');
    const views = splitter?.data.turnaroundConfirmed ? splitter.data.turnaroundViews || [] : [];
    if (!splitter || !views.length) return setToast('请先确认多视图切分');
    const sideRole: TurnaroundSideRole = splitter.data.turnaroundSideRole === 'right' ? 'right' : 'left';
    const viewLabels = multiViewLabels(views.length, sideRole);
    const width = initialNodeWidth('image');
    const height = mediaNodeHeight(width, views[0].width || 1024, views[0].height || 1024);
    const positions = turnaroundImageNodePositions(splitter, nodesRef.current, views.length, width, height);
    const existingByRole = new Map<TurnaroundViewRole, CanvasNode>();
    nodesRef.current.forEach((node) => {
      if (node.data.kind === 'image' && node.data.derivedFromNodeId === targetId && node.data.turnaroundViewRole) existingByRole.set(node.data.turnaroundViewRole, node);
    });
    const alreadyCurrent = views.every((view) => existingByRole.get(view.role)?.data.mediaUrl === view.mediaUrl);
    if (alreadyCurrent) {
      const ids = new Set(views.map((view) => existingByRole.get(view.role)?.id).filter((id): id is string => Boolean(id)));
      setNodes((current) => current.map((node) => ({ ...node, selected: ids.has(node.id) })));
      setToast(`已选中 ${ids.size} 个裁切图片节点`);
      return;
    }
    const stamp = Date.now();
    const created: CanvasNode[] = views.flatMap((view, index) => existingByRole.has(view.role) ? [] : [{
      id: `image-turnaround-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'image',
      selected: true,
      position: positions[index],
      width,
      height,
      measured: { width, height },
      style: { width, height },
      data: {
        kind: 'image',
        title: `${splitter.data.title || '多视图切分'} · ${viewLabels[index] || `视图 ${index + 1}`}`,
        mediaUrl: view.mediaUrl,
        mediaType: 'image',
        outputType: 'image',
        mediaWidth: view.width || 1024,
        mediaHeight: view.height || 1024,
        fileName: view.fileName || `view-${index + 1}.png`,
        derivedFromNodeId: targetId,
        turnaroundViewRole: view.role,
        status: `切分结果 · ${view.width || 1024} × ${view.height || 1024}`,
      } as CanvasNodeData,
    }]);
    const updatedCount = views.filter((view) => existingByRole.has(view.role)).length;
    pushHistory();
    setNodes((current) => {
      const next = [
        ...current.map((node) => {
          const viewIndex = views.findIndex((view) => node.id === existingByRole.get(view.role)?.id);
          if (viewIndex < 0) return { ...node, selected: false };
          const view = views[viewIndex];
          return {
            ...node,
            selected: true,
            data: {
              ...node.data,
              title: `${splitter.data.title || '多视图切分'} · ${viewLabels[viewIndex] || `视图 ${viewIndex + 1}`}`,
              mediaUrl: view.mediaUrl,
              mediaWidth: view.width || 1024,
              mediaHeight: view.height || 1024,
              fileName: view.fileName || node.data.fileName,
              turnaroundViewRole: view.role,
              status: `切分结果 · ${view.width || 1024} × ${view.height || 1024}`,
            },
          };
        }),
        ...created,
      ];
      nodesRef.current = next;
      return next;
    });
    setToast(`已在右侧放置 ${views.length} 个裁切图片节点${updatedCount ? `，更新 ${updatedCount} 个` : ''}`);
  }, [publicMode, pushHistory, setNodes, setToast]);
  const quickCreateFrom = useCallback((sourceId: string, kind: 'text' | 'imageGenerator' | 'videoGenerator' | 'modelGenerator', creationMode?: 'textToImage' | 'imageToImage' | 'imageEdit') => {
    const source = nodesRef.current.find((node) => node.id === sourceId);
    if (!source) return;
    const sourceOutput = resolveGeneratorSourceOutput(nodesRef.current, edgesRef.current, sourceId);
    const stamp = Date.now();
    const id = `${kind}-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    const capability = kind === 'videoGenerator' ? 'video' : kind === 'modelGenerator' ? 'model' : 'image';
    const generatorTitle = kind === 'imageGenerator'
      ? creationMode === 'imageEdit' ? 'AI 图片编辑' : creationMode === 'imageToImage' ? '图片生成（图生图）' : '图片生成（文生图）'
      : kind === 'modelGenerator' ? '3D 模型生成' : '视频生成';
    const defaults = generatorDefaults(models, capability);
    const newNode: CanvasNode = {
      id,
      type: kind,
      selected: true,
      position: { x: source.position.x + nodeWidth(source) + 72, y: source.position.y },
      width: initialNodeWidth(kind),
      height: initialNodeHeight(kind),
      data: {
        kind,
        title: kind === 'text' ? '文本' : generatorTitle,
        creationMode,
        outputType: kind === 'text' ? 'text' : capability,
        ...(kind === 'text' ? {} : defaults),
        ...(kind === 'modelGenerator' && sourceOutput.type === 'image' ? { modelInputMode: 'image' as const } : {}),
      } as CanvasNodeData,
    };
    pushHistory();
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), newNode]);
    if (kind !== 'text' && sourceOutput.type && sourceOutput.value) {
      const targetHandle = defaultInputPort(kind, sourceOutput.type, newNode.data);
      if (!targetHandle) return;
      setEdges((current) => [...current, colorEdge({
        id: `edge-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
        source: sourceId,
        sourceHandle: 'output',
        target: id,
        targetHandle,
        data: { referenceOrder: stamp, referenceToken: nextReferenceToken(edgesRef.current, id, sourceOutput.type!) },
      }, sourceOutput.type)]);
    }
  }, [models, pushHistory, setEdges, setNodes]);
  const duplicateNode = useCallback((id: string) => {
    const source = nodesRef.current.find((node) => node.id === id) || flow.getNode(id);
    if (!source) return;
    const copyId = `${source.data.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const copyTitle = nextCopyTitle(source.data.title, nodesRef.current.map((node) => node.data.title));
    pushHistory();
    setNodes((current) => {
      const next = [...current.map((node) => ({ ...node, selected: false })), {
      ...source,
      id: copyId,
      selected: true,
      position: { x: source.position.x + 42, y: source.position.y + 42 },
      data: cloneCanvasNodeData(source.data, copyTitle),
      }];
      nodesRef.current = next;
      return next;
    });
    setToast('已克隆节点');
  }, [flow, pushHistory, setNodes]);
  const cloneNodeWithInputs = useCallback((id: string) => {
    const source = nodesRef.current.find((node) => node.id === id) || flow.getNode(id);
    if (!source) return;
    const stamp = Date.now();
    const cloneId = `${source.data.kind}-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    const inputEdges = edgesRef.current.filter((edge) => edge.target === id);
    const copyTitle = nextCopyTitle(source.data.title, nodesRef.current.map((node) => node.data.title));
    const clone: CanvasNode = {
      ...source,
      id: cloneId,
      selected: true,
      position: { x: source.position.x + 72, y: source.position.y + 72 },
      data: cloneCanvasNodeData(source.data, copyTitle, true),
    };
    const copiedEdges = inputEdges.map((edge, index) => {
      const input = nodesRef.current.find((node) => node.id === edge.source);
      return colorEdge({
        ...edge,
        id: `edge-clone-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        target: cloneId,
        selected: false,
        data: { ...(edge.data || {}), referenceOrder: stamp + index },
        reconnectable: 'target' as const,
      }, input ? outputTypeFor(input, edge.sourceHandle) : undefined);
    });
    pushHistory();
    setNodes((current) => { const next = [...current.map((node) => ({ ...node, selected: false })), clone]; nodesRef.current = next; return next; });
    setEdges((current) => { const next = [...current, ...copiedEdges]; edgesRef.current = next; return next; });
    setToast(inputEdges.length ? `已克隆节点，并保留 ${inputEdges.length} 条输入连线` : '已克隆节点');
  }, [flow, pushHistory, setEdges, setNodes]);
  const cloneSelectedNodes = useCallback((ids: readonly string[], mode: SelectedCloneMode) => {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const plan = buildSelectedClonePlan(nodesRef.current, edgesRef.current, ids, mode, token);
    if (!plan.nodes.length) {
      setToast('没有可克隆的节点');
      return;
    }
    pushHistory();
    setNodes((current) => {
      const next = [...current.map((node) => ({ ...node, selected: false })), ...plan.nodes];
      nodesRef.current = next;
      return next;
    });
    setEdges((current) => {
      const next = [...current.map((edge) => ({ ...edge, selected: false })), ...plan.edges];
      edgesRef.current = next;
      return next;
    });
    if (mode === 'with-inputs') {
      setToast(`已带输入克隆 ${plan.nodes.length} 个节点${plan.connectedCount ? `，保留 ${plan.connectedCount} 条输入与组内连线` : ''}`);
      return;
    }
    setToast(`已克隆为下一步：${plan.connectedCount} 个自动接续${plan.skipped.length ? `，${plan.skipped.length} 个无兼容输入仅克隆` : ''}`);
  }, [pushHistory, setEdges, setNodes, setToast]);
  const cloneCollectionWithInputs = useCallback((id: string) => {
    const source = nodesRef.current.find((node) => node.id === id && node.data.kind === 'collection');
    if (!source) return;
    const cloneToken = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const clone = buildCollectionCloneWithInputs(id, nodesRef.current, edgesRef.current, cloneToken);
    if (!clone) {
      setToast('收纳内没有可克隆的节点');
      return;
    }
    pushHistory();
    setNodes((current) => {
      const next = [...current.map((node) => ({ ...node, selected: false })), ...clone.nodes];
      nodesRef.current = next;
      return next;
    });
    setEdges((current) => {
      const next = [...current.map((edge) => ({ ...edge, selected: false })), ...clone.edges];
      edgesRef.current = next;
      return next;
    });
    setToast(`已克隆收纳和其中 ${clone.nodes.length - 1} 个节点${clone.inputEdgeCount ? `，保留 ${clone.inputEdgeCount} 条输入连线` : ''}`);
  }, [pushHistory, setEdges, setNodes, setToast]);
  const deleteNode = useCallback((id: string) => {
    const deletion = collectionDeletionNodeIds(nodesRef.current, [id]);
    const deletingCollection = nodesRef.current.some((node) => node.id === id && node.data.kind === 'collection');
    const downstream = edgesRef.current
      .filter((edge) => deletion.has(edge.source) && !deletion.has(edge.target))
      .map((edge) => edge.target);
    pushHistory();
    staleNodes(downstream, '前序节点已删除，结果可能过期');
    setNodes((current) => {
      const next = current.filter((node) => !deletion.has(node.id));
      nodesRef.current = next;
      return next;
    });
    setEdges((current) => {
      const next = current.filter((edge) => !deletion.has(edge.source) && !deletion.has(edge.target));
      edgesRef.current = next;
      return next;
    });
    if (deletingCollection) setToast(`已删除整个收纳组及其中 ${deletion.size - 1} 个节点`);
  }, [pushHistory, setEdges, setNodes, setToast, staleNodes]);
  const selectNode = useCallback((id: string) => {
    setNodes((current) => {
      const layered = id ? promoteCanvasNodePackage(current, id) : current;
      const next = layered.map((node) => ({ ...node, selected: node.id === id }));
      nodesRef.current = next;
      return next;
    });
  }, [setNodes]);
  const addImageReference = useCallback((targetId: string, sourceId: string) => {
    const source = nodesRef.current.find((node) => node.id === sourceId);
    const target = nodesRef.current.find((node) => node.id === targetId);
    if (!source || !target || !['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow'].includes(target.data.kind)) return;
    const targetHandle = defaultInputPort(target.data.kind, 'image', target.data);
    if (!targetHandle) return;
    const connection: Connection = { source: sourceId, sourceHandle: 'output', target: targetId, targetHandle };
    const decision = evaluateConnection(connection, nodesRef.current, edgesRef.current);
    if (decision.error === '禁止重复连接') return;
    if (decision.error) return setToast(decision.error);
    pushHistory();
    const edge = colorEdge({ id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...connection, data: { referenceOrder: Date.now(), referenceToken: nextReferenceToken(edgesRef.current, targetId, 'image') }, reconnectable: 'target' }, 'image');
    setEdges((current) => [...current, edge]);
    staleNodes([targetId], '输入已变更，结果可能过期');
  }, [pushHistory, setEdges, setToast, staleNodes]);
  const pastePromptReferences = useCallback((targetId: string, references: PromptClipboardReference[]) => {
    const plan = planPromptReferenceConnections(nodesRef.current, edgesRef.current, targetId, references);
    const linkedCount = Object.keys(plan.tokenMap).length;
    if (plan.connections.length) {
      pushHistory();
      const stamp = Date.now();
      const created = plan.connections.map((connection, index) => colorEdge({
        id: `edge-prompt-paste-${stamp}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        source: connection.sourceId,
        sourceHandle: 'output',
        target: targetId,
        targetHandle: connection.targetHandle,
        data: {
          referenceOrder: stamp + index,
          referenceToken: connection.referenceToken,
        },
        reconnectable: 'target',
      }, connection.type));
      setEdges((current) => {
        const next = withStableReferenceTokens([...current, ...created], nodesRef.current);
        edgesRef.current = next;
        return next;
      });
      staleNodes([targetId], '粘贴提示词时关联的参考素材已变更，结果可能过期');
    }
    if (linkedCount) setToast(`已识别并关联 ${linkedCount} 个提示词引用${plan.skipped.length ? `，${plan.skipped.length} 个未找到原素材` : ''}`);
    else if (plan.error) setToast(plan.error);
    return { tokenMap: plan.tokenMap, linkedCount, skippedCount: plan.skipped.length };
  }, [pushHistory, setEdges, setToast, staleNodes]);
  const replaceInputReference = useCallback((targetId: string, edgeId: string, sourceId: string) => {
    const replacement = replaceInputReferenceInGraph(nodesRef.current, edgesRef.current, targetId, edgeId, sourceId);
    if (replacement.error) { setToast(replacement.error); return false; }
    if (!replacement.changed) return true;
    pushHistory();
    edgesRef.current = replacement.edges;
    setEdges(replacement.edges);
    staleNodes([targetId], '引用图片已替换，结果可能过期');
    setToast(`已替换为 ${replacement.sourceLabel}，节点连线和提交输入已同步更新`);
    return true;
  }, [pushHistory, setEdges, setToast, staleNodes]);
  const setInputReferenceVersionPolicy = useCallback((targetId: string, edgeId: string, policy: LocalMediaVersionPolicy) => {
    const edge = edgesRef.current.find((candidate) => candidate.id === edgeId && candidate.target === targetId);
    const target = nodesRef.current.find((candidate) => candidate.id === targetId);
    if (!edge || !target || edge.data?.lineage) return;
    const current = resolveGeneratorSourceOutput(nodesRef.current, edgesRef.current, edge.source);
    if (policy === 'locked' && (current.type !== 'image' || !current.value)) {
      setToast('这张参考图当前还没有可固定的画面');
      return;
    }
    pushHistory();
    setEdges((allEdges) => {
      const next = allEdges.map((candidate) => candidate.id === edgeId
        ? { ...candidate, data: inputReferenceVersionEdgeData(candidate.data, policy, String(current.value || '')) }
        : candidate);
      edgesRef.current = next;
      return next;
    });
    setToast(policy === 'locked' ? '已固定当前图片，来源变化不会替换它' : '已改为跟随来源的最新图片');
  }, [pushHistory, setEdges, setToast]);
  const removeImageReference = useCallback((targetId: string, sourceId: string) => {
    const target = nodesRef.current.find((node) => node.id === targetId);
    if (!target || !['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow'].includes(target.data.kind)) return;
    const matching = edgesRef.current.filter((edge) => edge.source === sourceId && edge.target === targetId && outputTypeFor(nodesRef.current.find((node) => node.id === edge.source) || target, edge.sourceHandle) === 'image');
    if (!matching.length) return;
    pushHistory();
    const ids = new Set(matching.map((edge) => edge.id));
    setEdges((current) => current.filter((edge) => !ids.has(edge.id)));
    staleNodes([targetId], '输入已变更，结果可能过期');
  }, [pushHistory, setEdges, staleNodes]);
  const disconnectInputReference = useCallback((targetId: string, edgeId: string) => {
    const edge = edgesRef.current.find((candidate) => candidate.id === edgeId && candidate.target === targetId);
    if (!edge) return;
    pushHistory();
    setEdges((current) => withoutInputReferenceConnection(current, targetId, edgeId));
    staleNodes([targetId], '输入已取消关联，结果可能过期');
    setToast('已取消输入关联，可使用 Ctrl+Z 撤销');
  }, [pushHistory, setEdges, setToast, staleNodes]);
  const uploadModelView = useCallback(async (targetId: string, port: 'front' | 'left' | 'back' | 'right', file: File) => {
    if (!file.type.startsWith('image/')) return setToast('请选择 PNG、JPG 或 WebP 图片');
    const target = nodesRef.current.find((node) => node.id === targetId);
    if (!target || target.data.kind !== 'modelGenerator') return;
    const viewLabels = { front: '正面', left: '左侧', back: '背面', right: '右侧' } as const;
    const viewOrder = { front: 0, left: 1, back: 2, right: 3 } as const;
    const sourceId = `image-${port}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const width = initialNodeWidth('image');
    const source: CanvasNode = {
      id: sourceId,
      type: 'image',
      selected: false,
      position: { x: target.position.x - width - 72, y: target.position.y + viewOrder[port] * 56 },
      width,
      height: initialNodeHeight('image'),
      data: { kind: 'image', title: `${viewLabels[port]}参考图`, outputType: 'image', mediaType: 'image', status: '正在上传' } as CanvasNodeData,
    };
    pushHistory();
    setNodes((current) => [...current, source]);
    try {
      const body = new FormData();
      body.append('file', file, file.name || `${port}-${Date.now()}.png`);
      const response = await apiFetch(`/api/v1/canvas/${encodeURIComponent(task.taskId)}/assets`, { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `${viewLabels[port]}视角上传失败`);
      setNodes((current) => current.map((node) => {
        if (node.id === sourceId) return { ...node, data: { ...node.data, mediaUrl: payload.url, previewUrl: payload.previewUrl, mediaWidth: Number(payload.width) || undefined, mediaHeight: Number(payload.height) || undefined, fileName: payload.originalName, status: '已接入模型视角' } };
        if (node.id !== targetId) return node;
        const disabled = new Set(node.data.disabledMultiviewPorts || []);
        disabled.add(port);
        return { ...node, data: { ...node.data, disabledMultiviewPorts: [...disabled], status: `${viewLabels[port]}视角已更新` } };
      }));
      setEdges((current) => {
        const retained = current.filter((edge) => !(edge.target === targetId && edge.targetHandle === port));
        return [...retained, colorEdge({
          id: `edge-model-view-${port}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          source: sourceId,
          sourceHandle: 'output',
          target: targetId,
          targetHandle: port,
          data: { referenceOrder: Date.now(), referenceToken: port, sourceMediaUrl: payload.url },
          reconnectable: 'target',
        }, 'image')];
      });
      staleNodes([targetId], `${viewLabels[port]}视角已更新，模型结果可能过期`);
      setToast(`${viewLabels[port]}视角已补充`);
    } catch (error) {
      setNodes((current) => current.filter((node) => node.id !== sourceId));
      setToast(error instanceof Error ? error.message : `${viewLabels[port]}视角上传失败`);
    }
  }, [apiFetch, pushHistory, setEdges, setNodes, setToast, staleNodes, task.taskId]);

  const removeModelView = useCallback((targetId: string, port: 'front' | 'left' | 'back' | 'right') => {
    const target = nodesRef.current.find((node) => node.id === targetId);
    if (!target || target.data.kind !== 'modelGenerator') return;
    const viewLabels = { front: '正面', left: '左侧', back: '背面', right: '右侧' } as const;
    const matchingEdgeIds = new Set(edgesRef.current.filter((edge) => edge.target === targetId && edge.targetHandle === port).map((edge) => edge.id));
    pushHistory();
    setEdges((current) => current.filter((edge) => !matchingEdgeIds.has(edge.id)));
    setNodes((current) => current.map((node) => {
      if (node.id !== targetId) return node;
      const disabled = new Set(node.data.disabledMultiviewPorts || []);
      disabled.add(port);
      return { ...node, data: { ...node.data, disabledMultiviewPorts: [...disabled], status: `${viewLabels[port]}视角已取消` } };
    }));
    staleNodes([targetId], `${viewLabels[port]}视角已取消，模型结果可能过期`);
    setToast(`${viewLabels[port]}视角已取消，可随时手动补图`);
  }, [pushHistory, setEdges, setNodes, setToast, staleNodes]);
  const imageReferencesFor = useCallback((targetId: string): ImageReference[] => orderImageCollageSources(nodesRef.current
    .filter((node) => node.id !== targetId)
    .flatMap((node) => {
      const output = resolveGeneratorSourceOutput(nodesRef.current, edgesRef.current, node.id);
      return output.type === 'image' && output.value ? [{
        id: node.id,
        sourceId: node.id,
        title: node.data.title || '图片',
        label: node.data.title || '图片',
        mediaUrl: output.value,
        x: node.position.x,
        y: node.position.y,
        width: nodeWidth(node),
        height: nodeHeight(node),
      }] : [];
    })).map(({ sourceId, label, mediaUrl }) => ({ sourceId, label, mediaUrl })), []);
  const pasteImageReference = useCallback(async (targetId: string, file: File) => {
    if (!file.type.startsWith('image/')) return;
    const target = nodesRef.current.find((node) => node.id === targetId);
    if (!target || !['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow'].includes(target.data.kind)) return;
    const sourceId = `image-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const source: CanvasNode = {
      id: sourceId,
      type: 'image',
      selected: false,
      position: { x: target.position.x - initialNodeWidth('image') - 72, y: target.position.y + 40 },
      width: initialNodeWidth('image'),
      height: initialNodeHeight('image'),
      data: { kind: 'image', title: '粘贴图片', outputType: 'image', status: '正在上传', ratio: 'Auto', resolution: '1K', count: 1, duration: 5, audioEnabled: false } as CanvasNodeData,
    };
    pushHistory();
    setNodes((current) => [...current, source]);
    try {
      const body = new FormData();
      body.append('file', file, file.name || `pasted-${Date.now()}.png`);
      const response = await apiFetch(`/api/v1/canvas/${encodeURIComponent(task.taskId)}/assets`, { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '粘贴图片上传失败');
      setNodes((current) => current.map((node) => node.id === sourceId ? { ...node, data: { ...node.data, mediaUrl: payload.url, previewUrl: payload.previewUrl, mediaType: 'image', outputType: 'image', mediaWidth: Number(payload.width) || undefined, mediaHeight: Number(payload.height) || undefined, fileName: payload.originalName, status: '已作为参考图' } } : node));
      const targetHandle = defaultInputPort(target.data.kind, 'image', target.data);
      if (!targetHandle) throw new Error('目标节点不接受图片输入');
      const connection: Connection = { source: sourceId, sourceHandle: 'output', target: targetId, targetHandle };
      const decision = evaluateConnection(connection, [...nodesRef.current, source], edgesRef.current);
      if (decision.error) throw new Error(decision.error);
      setEdges((current) => [...current, colorEdge({ id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...connection, data: { referenceOrder: Date.now(), referenceToken: nextReferenceToken(current, targetId, 'image') }, reconnectable: 'target' }, 'image')]);
      staleNodes([targetId], '输入已变更，结果可能过期');
      setToast('图片已接入输入');
    } catch (error) {
      setNodes((current) => current.filter((node) => node.id !== sourceId));
      setToast(error instanceof Error ? error.message : '粘贴图片上传失败');
    }
  }, [pushHistory, setEdges, setNodes, staleNodes, task.taskId]);
  const fitMediaNode = useCallback((id: string, mediaWidth: number, mediaHeight: number, mediaDuration?: number) => {
    if (!mediaWidth || !mediaHeight) return;
    setNodes((current) => {
      let next = fitCanvasMediaNodeInCanvas(current, id, mediaWidth, mediaHeight);
      if (mediaDuration !== undefined) {
        const target = next.find((node) => node.id === id);
        if (target && target.data.mediaDuration !== mediaDuration) {
          next = next.map((node) => node.id === id ? { ...node, data: { ...node.data, mediaDuration } } : node);
        }
      }
      if (next === current) return current;
      nodesRef.current = next;
      return next;
    });
  }, [setNodes]);
  const fitTurnaroundNode = useCallback((id: string, mediaWidth: number, mediaHeight: number) => {
    if (!mediaWidth || !mediaHeight) return;
    const size = turnaroundSplitterNodeSize(mediaWidth, mediaHeight);
    setNodes((current) => current.map((node) => {
      if (node.id !== id || node.data.kind !== 'turnaroundSplitter') return node;
      if (Math.round(nodeWidth(node)) === size.width && Math.round(nodeHeight(node)) === size.height
        && node.data.mediaWidth === mediaWidth && node.data.mediaHeight === mediaHeight) return node;
      return {
        ...node,
        width: size.width,
        height: size.height,
        measured: { width: size.width, height: size.height },
        style: { ...node.style, width: size.width, height: size.height },
        data: { ...node.data, mediaWidth, mediaHeight },
      };
    }));
  }, [setNodes]);
  const fitTurnaroundConfirmedNode = useCallback((id: string) => {
    setNodes((current) => current.map((node) => {
      if (node.id !== id || node.data.kind !== 'turnaroundSplitter' || !node.data.turnaroundConfirmed) return node;
      const width = nodeWidth(node);
      const height = turnaroundConfirmedNodeHeight(width, node.data.turnaroundViews?.length || node.data.turnaroundViewCount || 3);
      if (Math.round(nodeHeight(node)) === height) return node;
      return { ...node, width, height, measured: { width, height }, style: { ...node.style, width, height } };
    }));
  }, [setNodes]);
  const captureVideoFrame = useCallback(async (sourceId: string, file: File, mediaWidth: number, mediaHeight: number, label: '首帧' | '尾帧' | '当前帧') => {
    const source = nodesRef.current.find((node) => node.id === sourceId);
    if (!source) throw new Error('来源视频节点不存在');
    const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const width = initialNodeWidth('image');
    const height = mediaNodeHeight(width, mediaWidth, mediaHeight);
    const frameNode: CanvasNode = {
      id,
      type: 'image',
      selected: true,
      position: frameNodePosition(source),
      width,
      height,
      measured: { width, height },
      style: { width, height },
      data: {
        kind: 'image',
        title: `${source.data.title || '视频'} ${label}`,
        mediaWidth,
        mediaHeight,
        mediaType: 'image',
        outputType: 'image',
        fileName: file.name,
        status: '正在保存帧图',
      } as CanvasNodeData,
    };
    pushHistory();
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), frameNode]);
    const body = new FormData();
    body.append('file', file, file.name);
    try {
      const response = await apiFetch(`/api/v1/canvas/${encodeURIComponent(task.taskId)}/assets`, { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '帧图保存失败');
      setNodes((current) => current.map((node) => node.id === id ? {
        ...node,
        data: { ...node.data, mediaUrl: payload.url, previewUrl: payload.previewUrl, mediaType: 'image', outputType: 'image', fileName: payload.originalName, mediaWidth: Number(payload.width) || mediaWidth, mediaHeight: Number(payload.height) || mediaHeight, status: '帧图已保存' },
      } : node));
      setToast(`${label}已保存为右侧图片节点`);
      return id;
    } catch (error) {
      setNodes((current) => current.filter((node) => node.id !== id));
      throw error instanceof Error ? error : new Error('帧图保存失败');
    }
  }, [apiFetch, pushHistory, setNodes, task.taskId]);
  const continueVideoFromTail = useCallback(async (sourceId: string, file: File, mediaWidth: number, mediaHeight: number) => {
    const source = nodesRef.current.find((node) => node.id === sourceId);
    if (!source) throw new Error('来源视频节点不存在');
    const imageId = await captureVideoFrame(sourceId, file, mediaWidth, mediaHeight, '尾帧');
    if (!imageId) return;
    const stamp = Date.now();
    const id = `videoGenerator-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    const width = initialNodeWidth('videoGenerator');
    const node: CanvasNode = {
      id, type: 'videoGenerator', selected: true,
      position: { x: frameNodePosition(source).x + initialNodeWidth('image') + 72, y: source.position.y },
      width, height: initialNodeHeight('videoGenerator'), measured: { width, height: initialNodeHeight('videoGenerator') }, style: { width, height: initialNodeHeight('videoGenerator') },
      data: { kind: 'videoGenerator', title: '视频续接', outputType: 'video', ...continuationVideoSettings(models, source.data) } as CanvasNodeData,
    };
    pushHistory();
    setNodes((current) => [...current.map((item) => ({ ...item, selected: false })), node]);
    setEdges((current) => [...current, colorEdge({ id: `edge-tail-${stamp}-${Math.random().toString(36).slice(2, 8)}`, source: imageId, sourceHandle: 'output', target: id, targetHandle: 'input', data: { referenceOrder: stamp, referenceToken: '图片1' }, reconnectable: 'target' }, 'image')]);
    setToast('已截取尾帧并创建下一段视频节点');
  }, [captureVideoFrame, models, pushHistory, setEdges, setNodes]);
  const createCharacterNode = useCallback((sourceId: string, requestedVersionIndex?: number) => {
    const source = nodesRef.current.find((node) => node.id === sourceId);
    if (!source || source.data.kind !== 'modelGenerator') return;
    const versions: ModelGeneratorVersion[] = source.data.modelVersions?.length
      ? source.data.modelVersions
      : source.data.latestOutputs?.length
        ? [{ jobId: source.data.jobId || `source-${source.id}`, createdAt: source.data.jobStartedAt, outputs: source.data.latestOutputs, operation: 'generate' }]
        : [];
    const selectedIndex = Math.min(requestedVersionIndex ?? source.data.selectedModelVersion ?? Math.max(0, versions.length - 1), Math.max(0, versions.length - 1));
    const sourceVersionIndex = characterRigSourceVersionIndex(versions, selectedIndex);
    const sourceVersion = versions[sourceVersionIndex];
    const sourceOutput = preferredInteractiveModelOutput(sourceVersion?.outputs || []);
    if (!sourceVersion?.jobId || !sourceOutput?.tripoTaskId) {
      setToast('当前模型没有可用于绑定的 Tripo 几何结果；请先完成建模或重拓扑。');
      return;
    }
    const existing = nodesRef.current.find((node) => node.data.kind === 'characterAnimator'
      && node.data.characterRuns?.some((run) => run.sourceVersionJobId === sourceVersion.jobId));
    if (existing) {
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === existing.id })));
      setToast('已定位到这个模型对应的角色绑定与动画节点');
      return existing.id;
    }
    const stamp = Date.now();
    const id = `characterAnimator-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    const runId = `character-${sourceVersion.jobId}`;
    const legacyRun = source.data.characterRuns?.find((run) => run.id === runId || run.sourceVersionJobId === sourceVersion.jobId);
    const sourceLabel = modelProcessStageLabel(versions, sourceVersionIndex);
    const run = legacyRun || createTripoCharacterRun({
      id: runId,
      sourceVersionJobId: sourceVersion.jobId,
      sourceVersionIndex,
      sourceLabel: `${sourceLabel} · 绑定源`,
      sourceTaskId: sourceOutput.tripoTaskId,
    });
    const draft = source.data.characterDrafts?.[run.id] || createTripoCharacterDraft(run);
    const width = initialNodeWidth('characterAnimator');
    const height = initialNodeHeight('characterAnimator');
    const position = rightCompanionNodePosition(source, nodesRef.current, width, height, id);
    const characterNode: CanvasNode = {
      id,
      type: 'characterAnimator',
      selected: true,
      position,
      width,
      height,
      data: {
        kind: 'characterAnimator',
        title: '角色绑定与动画',
        outputType: 'model',
        mediaType: 'model',
        latestMediaType: 'model',
        latestOutputs: sourceVersion.outputs,
        modelVersions: versions,
        selectedModelVersion: sourceVersionIndex,
        modelId: source.data.modelId,
        characterRuns: [run],
        activeCharacterRunId: run.id,
        characterDrafts: { [run.id]: draft },
        selectedCharacterPose: 'model',
        status: `已接入${sourceLabel}，可以开始自动绑骨`,
      } as CanvasNodeData,
    };
    pushHistory();
    const nextNodes = [...nodesRef.current.map((node) => ({ ...node, selected: false })), characterNode];
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    setEdges((current) => [...current, colorEdge({
      id: `edge-character-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
      source: sourceId,
      sourceHandle: 'output',
      target: id,
      targetHandle: 'input',
      data: { referenceOrder: stamp, sourceVersionJobId: sourceVersion.jobId },
      reconnectable: 'target',
    }, 'model')]);
    setToast('已创建“角色绑定与动画”节点');
    return id;
  }, [pushHistory, setEdges, setNodes]);
  const [generatorPanelDockDrag, setGeneratorPanelDockDrag] = useState<{ nodeId: string; dock: GeneratorPanelDock } | null>(null);
  const beginGeneratorPanelDockDrag = useCallback((id: string, pointer: { pointerId: number; clientX: number; clientY: number }) => {
    const area = flowAreaRef.current;
    const node = nodesRef.current.find((candidate) => candidate.id === id && ['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow'].includes(candidate.data.kind));
    if (!area || !node) return;
    let latestDock = normalizeGeneratorPanelDock(node.data.generatorPanelDock || node.data.comfyPanelDock);
    const nodeBounds = () => Array.from(area.querySelectorAll<HTMLElement>('.react-flow__node'))
      .find((element) => element.dataset.id === id)?.getBoundingClientRect();
    const updateDock = (clientX: number, clientY: number) => {
      const rect = nodeBounds();
      if (!rect) return;
      latestDock = nearestGeneratorPanelDock({ x: clientX, y: clientY }, rect, latestDock);
      setGeneratorPanelDockDrag((current) => current?.nodeId === id && current.dock === latestDock ? current : { nodeId: id, dock: latestDock });
    };
    updateDock(pointer.clientX, pointer.clientY);
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointer.pointerId) return;
      event.preventDefault();
      updateDock(event.clientX, event.clientY);
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== pointer.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setGeneratorPanelDockDrag(null);
      updateNode(id, { generatorPanelDock: latestDock }, 'runtime');
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, [updateNode]);
  const attachActions = useCallback((node: CanvasNode, referenceGraph?: { nodes: CanvasNode[]; edges: Edge[] }): CanvasNode => ({
    ...node,
    data: {
      ...node.data,
      publicMode,
      models,
      inputReferences: ['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow', 'turnaroundSplitter'].includes(node.data.kind)
        ? inputReferencesFor(node.id, referenceGraph?.nodes, referenceGraph?.edges)
        : undefined,
      imageReferences: undefined,
      onListImageReferences: imageReferencesFor,
      onAddImageReference: addImageReference,
      onRemoveImageReference: removeImageReference,
      onDisconnectInputReference: disconnectInputReference,
      onSetInputReferenceVersionPolicy: setInputReferenceVersionPolicy,
      onDisconnectCollectionInput: disconnectCollectionInput,
      onPasteImageReference: pasteImageReference,
      onPastePromptReferences: pastePromptReferences,
      onReplaceInputReference: replaceInputReference,
      onUploadModelView: uploadModelView,
      onRemoveModelView: removeModelView,
      onQuickCropImage: createQuickCropNode,
      onInpaintImage: runImageInpaint,
      onRestoreImageInpaint: restoreImageInpaint,
      onUpscaleVideo: undefined,
      onConfirmVideoUpscale: undefined,
      onCreateTurnaroundSplit: createTurnaroundSplit,
      onConfirmTurnaroundSplit: confirmTurnaroundSplit,
      onPlaceTurnaroundImages: placeTurnaroundImageNodes,
      onChange: updateNode,
      onEditStart: selectNode,
      onEditEnd: endTextEdit,
      onUpload: uploadAsset,
      onRun: node.data.kind === 'comfyUiWorkflow' ? runComfyUiWorkflow : runGenerator,
      onBeginGeneratorPanelDockDrag: beginGeneratorPanelDockDrag,
      onSelectComfyUiWorkflow: selectComfyUiWorkflow,
      onOpenComfyUiEditor: openComfyUiEditor,
      onPreviewPose: previewComfyUiPose,
      onRunTripoPostprocess: runTripoPostprocess,
      onCreateCharacterNode: createCharacterNode,
      onCancel: (id) => jobAction(id, 'cancel'),
      onRetry: (id) => jobAction(id, 'retry'),
      onResume: (id) => jobAction(id, 'resume'),
      onRetryPaid: (id) => jobAction(id, 'retryPaid'),
      onResumeCharacterJob: (id) => characterJobAction(id, 'resume'),
      onRetryCharacterPaid: (id) => characterJobAction(id, 'retryPaid'),
      onRefreshJob: resumeJobPolling,
      onSetResultState: setResultState,
      onSelectResultVersion: selectResultVersion,
      onSend: sendResult,
      onFocusSource: focusSource,
      onQuickCreate: quickCreateFrom,
      onDuplicate: duplicateNode,
      onDelete: deleteNode,
      onBeginRename: (id) => { selectNode(id); setContextMenu(null); setRenamingNodeId(id); },
      onCommitRename: (id, title) => { updateNode(id, { title }); setRenamingNodeId((current) => current === id ? null : current); },
      onCancelRename: (id) => setRenamingNodeId((current) => current === id ? null : current),
      onResizeStart: pushHistory,
      onMediaSize: fitMediaNode,
      onTurnaroundSourceSize: fitTurnaroundNode,
      onFitTurnaroundConfirmed: fitTurnaroundConfirmedNode,
      onCaptureVideoFrame: captureVideoFrame,
      onContinueVideoFromTail,
    },
  }), [addImageReference, beginGeneratorPanelDockDrag, createCharacterNode, captureVideoFrame, continueVideoFromTail, confirmTurnaroundSplit, confirmVideoUpscale, createQuickCropNode, createVideoUpscaleNode, createTurnaroundSplit, deleteNode, disconnectCollectionInput, disconnectInputReference, duplicateNode, endTextEdit, fitMediaNode, fitTurnaroundConfirmedNode, fitTurnaroundNode, focusSource, imageReferencesFor, inputReferencesFor, jobAction, models, openComfyUiEditor, pasteImageReference, pastePromptReferences, placeTurnaroundImageNodes, previewComfyUiPose, replaceInputReference, restoreImageInpaint, runImageInpaint, setInputReferenceVersionPolicy, uploadModelView, removeModelView, publicMode, pushHistory, quickCreateFrom, removeImageReference, resumeJobPolling, runComfyUiWorkflow, runGenerator, runTripoPostprocess, selectComfyUiWorkflow, selectNode, selectResultVersion, sendResult, setResultState, updateNode, uploadAsset]);
  const onContinueVideoFromTail = continueVideoFromTail;
  useEffect(() => {
    if (!models.length) return;
    setNodes((current) => current.map((node) => {
      if (!['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow'].includes(node.data.kind)) return attachActions(node);
      const capability = node.data.kind === 'videoGenerator' ? 'video' : node.data.kind === 'audioGenerator' ? 'audio' : node.data.kind === 'modelGenerator' ? 'model' : 'image';
      const selected = node.data.kind === 'comfyUiWorkflow'
        ? models.find((model) => model.id === node.data.modelId && (model.workflows?.length || model.workflow)) || models.find((model) => model.workflows?.length || model.workflow)
        : models.find((model) => model.id === node.data.modelId && model.capability === capability) || models.find((model) => model.capability === capability);
      const defaults = node.data.kind === 'comfyUiWorkflow' ? comfyUiWorkflowDefaults(models) : generatorDefaults(models, capability);
      const profile = selected?.profile;
      const selectedWorkflow = node.data.kind === 'comfyUiWorkflow'
        ? (selected?.workflows?.find((workflow) => workflow.id === node.data.workflowId) || selected?.workflow || selected?.workflows?.[0])
        : undefined;
      return attachActions({
        ...node,
        data: {
          ...node.data,
          modelId: selected?.id || defaults.modelId,
          ...(node.data.kind === 'comfyUiWorkflow' ? { workflowId: selectedWorkflow?.id || (defaults as { workflowId?: string }).workflowId } : {}),
          ratio: profile?.ratios.includes(String(node.data.ratio || '')) ? node.data.ratio : selected?.defaults?.ratio || defaults.ratio,
          resolution: profile?.resolutions.includes(String(node.data.resolution || '').toUpperCase()) ? String(node.data.resolution).toUpperCase() : selected?.defaults?.resolution || defaults.resolution,
          count: capability === 'image' ? node.data.count || profile?.count.default || defaults.count : 1,
          duration: capability === 'video' ? Math.min(profile?.duration.max || defaults.duration, Math.max(profile?.duration.min || defaults.duration, Number(node.data.duration || defaults.duration))) : 5,
          audioEnabled: capability === 'video' ? node.data.audioEnabled !== false && profile?.audio !== false : false,
          ...(capability === 'video' ? { videoInputMode: node.data.videoInputMode === 'first' ? 'first' : node.data.videoInputMode === 'first_last' ? 'first_last' : 'reference' as VideoInputMode } : {}),
          ...(capability === 'model' ? { modelInputMode: node.data.modelInputMode || 'text', texture: node.data.texture !== false, pbr: node.data.texture !== false && node.data.pbr !== false, textureQuality: node.data.textureQuality || 'standard', geometryQuality: isTripoP1Model(selected) ? 'standard' : node.data.geometryQuality || 'standard', autoSize: Boolean(node.data.autoSize), exportUv: node.data.exportUv !== false, enableImageAutofix: Boolean(node.data.enableImageAutofix), textureAlignment: node.data.textureAlignment || 'original_image', orientation: node.data.orientation || 'default', ...(isTripoP1Model(selected) ? { quad: false, smartLowPoly: false, generateParts: false } : {}) } : {}),
        },
      });
    }));
  }, [attachActions, models, setNodes]);

  const activeCanvasKey = `${task.taskId}:${publicMode ? defaultCanvasBoardId : activeCanvasId}`;

  useEffect(() => {
    if (!hasTaskContext) {
      loadedCanvasKeyRef.current = null;
      setReady(false);
      setSaveState('选择任务');
      return;
    }
    let cancelled = false;
    loadedCanvasKeyRef.current = null;
    skipNextAutosaveRef.current = false;
    historyRef.current = [];
    futureRef.current = [];
    setHistoryNonce((value) => value + 1);
    setReady(false);
    setPublicWorkspaceIssue(null);
    setSaveState('加载中');
    const apiPrefix = publicMode ? '/api/public' : '/api/v1';
    const bootstrap = publicMode
      ? publicWorkspaceIdRef.current
        ? Promise.resolve(publicWorkspaceIdRef.current)
        : apiFetch('/api/public/session', { method: 'POST' }).then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || '外部工作区初始化失败');
          const workspaceId = String(payload.workspaceId || '');
          const sessionToken = String(payload.sessionToken || '');
          if (!workspaceId || !sessionToken) throw new Error('外部工作区初始化失败');
          publicWorkspaceIdRef.current = workspaceId;
          publicSessionTokenRef.current = sessionToken;
          setPublicWorkspaceId(workspaceId);
          return workspaceId;
        })
      : Promise.resolve(task.taskId);
    bootstrap.then((workspaceId) => {
      const activeTaskId = publicMode ? workspaceId : task.taskId;
      const canvasUrl = publicMode ? `${apiPrefix}/canvas` : taskCanvasUrl(activeTaskId, activeCanvasId);
      Promise.all([
      apiFetch(canvasUrl).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || '加载失败'); return payload as StoredCanvas; }),
      apiFetch(`${apiPrefix}/models`).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || '模型加载失败'); return payload.models as ModelInfo[]; }),
      apiFetch(`${apiPrefix}/context`).then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || '会话加载失败');
        if (adminStandaloneMode && (payload.purpose !== 'admin-standalone' || !payload.member?.platformAdmin)) throw new Error('该入口仅允许平台管理员访问');
        return { admin: Boolean(payload.member?.platformAdmin), share: payload.mode === 'share', generationContractVersion: Number(payload.generationContractVersion) || 0 };
      }),
      apiFetch(`${apiPrefix}/jobs?taskId=${encodeURIComponent(activeTaskId)}${publicMode ? '' : `&canvasId=${encodeURIComponent(activeCanvasId)}`}`).then(async (response) => { const payload = await response.json(); return response.ok ? payload.jobs as Job[] : []; }),
      publicMode || shareRequested
        ? Promise.resolve([] as CanvasBoard[])
        : apiFetch(`/api/v1/canvas/${encodeURIComponent(activeTaskId)}/boards`).then(async (response) => { const payload = await readApiJson(response); if (!response.ok) throw new Error(payload.error || '任务画布列表加载失败'); return Array.isArray(payload.boards) ? payload.boards as CanvasBoard[] : []; }),
    ]).then(([canvas, loadedModels, context, loadedJobs, loadedCanvasBoards]) => {
      if (cancelled) return;
      setModels(loadedModels);
      setPlatformAdmin(context.admin);
      setGenerationContractVersion(context.generationContractVersion);
      setShareMode(context.share || shareRequested);
      setCanvasBoards(loadedCanvasBoards);
      const actionless = fitStoredMediaNodes(normalizeLegacyCopyTitles((Array.isArray(canvas.nodes) ? canvas.nodes : []).map((node) => normalizeStoredNode(node, loadedModels)).filter((node): node is CanvasNode => node !== null)));
      const rawEdges = Array.isArray(canvas.edges) ? canvas.edges : [];
      actionless.forEach((node) => {
        if (node.data.kind !== 'videoGenerator') return;
        const incoming = rawEdges.filter((edge) => edge.target === node.id).map((edge) => String(edge.targetHandle || ''));
        const hasLegacyFrames = incoming.some((handle) => ['startImage', 'endImage', 'first_frame', 'last_frame'].includes(handle));
        const hasLegacyReference = incoming.some((handle) => ['reference', 'referenceVideo'].includes(handle));
        if (hasLegacyFrames && !hasLegacyReference) node.data.videoInputMode = 'first_last';
      });
      const nodeIds = new Set(actionless.map((node) => node.id));
      const coloredEdges = withStableReferenceTokens(
        (Array.isArray(canvas.edges) ? canvas.edges : []).filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)).map((edge) => {
          const source = actionless.find((node) => node.id === edge.source);
          const target = actionless.find((node) => node.id === edge.target);
          const sourceType = source ? outputTypeFor(source, edge.sourceHandle) : undefined;
          const targetHandle = migrateStoredInputPort(target, sourceType, edge.targetHandle);
          return { ...colorEdge({ ...edge, sourceHandle: 'output', targetHandle }, sourceType), reconnectable: 'target' as const };
        }),
        actionless,
      );
      setNodes(actionless); setEdges(coloredEdges); nodesRef.current = actionless; edgesRef.current = coloredEdges;
      setRevision(canvas.revision || 0); revisionRef.current = canvas.revision || 0; saveBlockedRef.current = false;
      const loadedViewport = canvas.viewport || defaultViewport;
      setViewport(loadedViewport); setZoom(loadedViewport.zoom); setMediaLodLevel(canvasMediaLodLevelForZoom(loadedViewport.zoom));
      requestAnimationFrame(() => flow.setViewport(loadedViewport));
      setSaveState('已保存');
      loadedCanvasKeyRef.current = `${activeTaskId}:${publicMode ? defaultCanvasBoardId : activeCanvasId}`;
      skipNextAutosaveRef.current = true;
      setReady(true);
      requestAnimationFrame(() => {
        // Restore only the latest submitted job per node so an older long-running
        // completion can never overwrite the preview selected by a newer run.
        latestCanvasJobsByNode(loadedJobs).forEach((job) => { applyJob(job); if (job.status === 'queued' || job.status === 'running' || job.status === 'cancelling') pollJob(job.id); });
      });
    }).catch((error) => {
      if (!cancelled) {
        // A failed load must never turn the initial empty state into a saved canvas.
        loadedCanvasKeyRef.current = null;
        setReady(false);
        const message = error instanceof Error ? error.message : '加载失败';
        setToast(message);
        if (publicMode) setPublicWorkspaceIssue(message);
        setSaveState('保存失败');
      }
    });
    });
    return () => { cancelled = true; pollTimers.current.forEach((timer) => window.clearTimeout(timer)); pollTimers.current.clear(); pollFailures.current.clear(); pollEpochs.current.clear(); };
  }, [activeCanvasId, adminStandaloneMode, apiFetch, applyJob, flow, hasTaskContext, pollJob, publicMode, publicWorkspaceId, setEdges, setNodes, shareRequested, task.taskId]);

  const serializeNodes = useCallback(() => nodesRef.current.map(serializeCanvasNode), []);
  const canvasInteractionActive = nodes.some((node) => Boolean(node.dragging || node.resizing));
  const autosaveSignatureRef = useRef('');
  const autosaveSignature = useMemo(() => {
    const signature = canvasAutosaveSignatureForInteraction(autosaveSignatureRef.current, nodes, edges, canvasInteractionActive);
    if (!canvasInteractionActive) autosaveSignatureRef.current = signature;
    return signature;
  }, [canvasInteractionActive, edges, nodes]);
  const save = useCallback(async (immediate = false) => {
    if (!ready || loadedCanvasKeyRef.current !== activeCanvasKey || saveBlockedRef.current) return false;
    if (saveInFlightRef.current) {
      savePendingRef.current = true;
      return false;
    }
    saveInFlightRef.current = true;
    savePendingRef.current = false;
    setSaveState('正在保存');
    const canvasUrl = publicMode ? '/api/public/canvas' : taskCanvasUrl(task.taskId, activeCanvasId);
    const request = (init: RequestInit = {}) => apiFetch(canvasUrl, init);
    try {
      const serializedEdges = edgesRef.current.map((edge) => ({ ...edge, className: stripPathClassName(edge.className) }));
      const response = await request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes: serializeNodes(), edges: serializedEdges, viewport: flow.getViewport(), task, revision: revisionRef.current }) });
      const payload = await response.json();
      if (response.status === 409) {
        saveBlockedRef.current = true;
        setSaveState('保存冲突');
        setToast(payload.error || '另一窗口已更新画布；本窗口内容仍保留，未覆盖远端版本');
        return false;
      }
      if (!response.ok) throw new Error(payload.error || '保存失败');
      setRevision(payload.revision); revisionRef.current = payload.revision; setSaveState('已保存');
      return true;
    } catch (error) {
      setSaveState('保存失败');
      setToast(error instanceof Error ? error.message : '保存失败');
      return false;
    }
    finally {
      saveInFlightRef.current = false;
      if (savePendingRef.current && !saveBlockedRef.current) {
        savePendingRef.current = false;
        setSaveNonce((value) => value + 1);
      }
    }
  }, [activeCanvasId, activeCanvasKey, apiFetch, flow, publicMode, ready, serializeNodes, task]);
  useEffect(() => {
    saveCanvasNowRef.current = save;
    return () => { if (saveCanvasNowRef.current === save) saveCanvasNowRef.current = null; };
  }, [save]);
  useEffect(() => registerTrialTools(
    () => ({ nodes: serializeNodes(), edges: edgesRef.current, viewport: flow.getViewport() }),
    () => save(true),
  ), [save, serializeNodes, flow]);
  useEffect(() => {
    if (!ready || loadedCanvasKeyRef.current !== activeCanvasKey || saveBlockedRef.current) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    setSaveState('有未保存更改');
    if (canvasInteractionActive) {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      return;
    }
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const delay = saveDelayRef.current;
    saveDelayRef.current = 900;
    saveTimer.current = window.setTimeout(() => { void save(); }, delay);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [activeCanvasKey, autosaveSignature, canvasInteractionActive, ready, save, saveNonce]);

  const overwriteSaveConflict = useCallback(async () => {
    const canvasUrl = publicMode ? '/api/public/canvas' : taskCanvasUrl(task.taskId, activeCanvasId);
    try {
      const latestResponse = await apiFetch(canvasUrl);
      const latest = await readApiJson(latestResponse);
      if (!latestResponse.ok) throw new Error(latest.error || '无法读取远端画布');
      revisionRef.current = Number(latest.revision) || 0;
      saveBlockedRef.current = false;
      setSaveState('有未保存更改');
      if (!await save(true)) return;
      setToast('已按本窗口内容保存');
    } catch (error) {
      saveBlockedRef.current = true;
      setSaveState('保存冲突');
      setToast(error instanceof Error ? error.message : '解决保存冲突失败');
    }
  }, [activeCanvasId, apiFetch, publicMode, save, task.taskId]);

  useEffect(() => {
    const flushBeforeBackground = () => {
      if (document.visibilityState === 'hidden' && saveState === '有未保存更改') void save(true);
    };
    document.addEventListener('visibilitychange', flushBeforeBackground);
    return () => document.removeEventListener('visibilitychange', flushBeforeBackground);
  }, [save, saveState]);

  const switchCanvasBoard = useCallback(async (canvasId: string) => {
    const nextCanvasId = normalizedCanvasBoardId(canvasId);
    if (nextCanvasId === activeCanvasId) { setCanvasBoardMenuOpen(false); return; }
    if (ready && saveState !== '已保存') {
      const saved = await save(true);
      if (!saved) { setToast('当前画布尚未保存，已停止切换以保护内容'); return; }
    }
    historyRef.current = [];
    futureRef.current = [];
    setCanvasBoardMenuOpen(false);
    const url = new URL(window.location.href);
    if (nextCanvasId === defaultCanvasBoardId) url.searchParams.delete('canvas_id');
    else url.searchParams.set('canvas_id', nextCanvasId);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setActiveCanvasId(nextCanvasId);
  }, [activeCanvasId, ready, save, saveState]);

  const createCanvasBoard = useCallback(async () => {
    if (creatingCanvasBoard || publicMode || shareMode) return;
    setCreatingCanvasBoard(true);
    try {
      if (ready && saveState !== '已保存' && !await save(true)) throw new Error('当前画布尚未保存，未创建新画布');
      const title = newCanvasTitle.trim() || `画布 ${canvasBoards.length + 1}`;
      const response = await apiFetch(`/api/v1/canvas/${encodeURIComponent(task.taskId)}/boards`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
      });
      const payload = await readApiJson(response);
      if (!response.ok || !payload.board?.id) throw new Error(payload.error || '创建任务画布失败');
      const board = payload.board as CanvasBoard;
      setCanvasBoards((current) => [...current.filter((item) => item.id !== board.id), board]);
      setNewCanvasTitle('');
      await switchCanvasBoard(board.id);
      setToast(`已创建“${board.title}”`);
    } catch (error) { setToast(error instanceof Error ? error.message : '创建任务画布失败'); }
    finally { setCreatingCanvasBoard(false); }
  }, [apiFetch, canvasBoards.length, creatingCanvasBoard, newCanvasTitle, publicMode, ready, save, saveState, shareMode, switchCanvasBoard, task.taskId]);

  const activeCanvasBoard = canvasBoards.find((board) => board.id === activeCanvasId)
    || { id: activeCanvasId, title: activeCanvasId === defaultCanvasBoardId ? (adminStandaloneMode ? '资产制作总画布' : '主画布') : '任务画布', createdAt: '', updatedAt: '', nodeCount: nodes.length };
  const visibleCanvasBoards = canvasBoards.some((board) => board.id === activeCanvasBoard.id)
    ? canvasBoards
    : [activeCanvasBoard, ...canvasBoards];
  const canvasBoardDeleteDisabled = activeCanvasId === defaultCanvasBoardId || visibleCanvasBoards.length <= 1 || saveState === '正在保存';

  const exportCurrentCanvas = useCallback(() => {
    const serializedEdges = edgesRef.current.map((edge) => ({ ...edge, className: stripPathClassName(edge.className) }));
    const payload = {
      schema: 'echo-canvas/current-canvas@1',
      appVersion: canvasAppVersionLabel,
      exportedAt: new Date().toISOString(),
      canvas: {
        id: activeCanvasId,
        title: activeCanvasBoard.title || '主画布',
        task,
        state: { nodes: serializeNodes(), edges: serializedEdges, viewport: flow.getViewport() },
      },
    };
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = canvasExportFileName(activeCanvasBoard.title);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setCanvasAppMenuOpen(false);
    setCanvasBoardMenuOpen(false);
    setToast(`已导出“${activeCanvasBoard.title || '主画布'}”`);
  }, [activeCanvasBoard.title, activeCanvasId, flow, serializeNodes, task]);

  const deleteActiveCanvasBoard = useCallback(async () => {
    if (activeCanvasId === defaultCanvasBoardId) { setToast('主画布需要保留，不能删除'); return; }
    if (visibleCanvasBoards.length <= 1) { setToast('至少需要保留一张画布'); return; }
    if (saveState === '正在保存' || saveInFlightRef.current) { setToast('正在保存，请稍后再删除'); return; }
    const confirmed = await requestCanvasConfirmation({
      eyebrow: 'DELETE CANVAS',
      title: `删除“${activeCanvasBoard.title || '当前画布'}”`,
      tone: 'danger',
      confirmLabel: '确认删除',
      message: `这会永久删除当前画布及其节点和连线${saveState === '已保存' ? '' : '，未保存的修改也会丢失'}；本地素材与模型文件不会被删除。`,
    });
    if (!confirmed) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    setCanvasBoardMenuOpen(false);
    try {
      const response = await apiFetch(`/api/v1/canvas/${encodeURIComponent(task.taskId)}/boards/${encodeURIComponent(activeCanvasId)}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await readApiJson(response);
        throw new Error(payload.error || '删除画布失败');
      }
      const remaining = visibleCanvasBoards.filter((board) => board.id !== activeCanvasId);
      const nextBoard = remaining.find((board) => board.id === defaultCanvasBoardId) || remaining[0];
      if (!nextBoard) throw new Error('至少需要保留一张画布');
      loadedCanvasKeyRef.current = null;
      historyRef.current = [];
      futureRef.current = [];
      setHistoryNonce((value) => value + 1);
      setCanvasBoards(remaining);
      const url = new URL(window.location.href);
      if (nextBoard.id === defaultCanvasBoardId) url.searchParams.delete('canvas_id');
      else url.searchParams.set('canvas_id', nextBoard.id);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      setActiveCanvasId(nextBoard.id);
      setToast(`已删除“${activeCanvasBoard.title || '当前画布'}”`);
    } catch (error) {
      if (saveState !== '已保存') setSaveNonce((value) => value + 1);
      setToast(error instanceof Error ? error.message : '删除画布失败');
    }
  }, [activeCanvasBoard.title, activeCanvasId, apiFetch, requestCanvasConfirmation, saveState, task.taskId, visibleCanvasBoards]);

  const addNode = useCallback((kind: SupportedCanvasNodeKind, clientX?: number, clientY?: number, pending?: ConnectMenu, exactPosition = false) => {
    if (!canvasToolVisible(kind, models)) {
      setToast('请先在设置中心启用一项本地生成能力');
      return '';
    }
    if (kind === 'characterAnimator') {
      const source = pending ? nodesRef.current.find((node) => node.id === pending.source) : undefined;
      if (source?.data.kind === 'modelGenerator') return createCharacterNode(source.id, source.data.selectedModelVersion) || '';
      setToast('请从一个已生成的 3D 模型节点点击“绑定动画”，或拖出模型连线后创建。');
      return '';
    }
    const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const desired = clientX == null || clientY == null ? flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) : flow.screenToFlowPosition({ x: clientX, y: clientY });
    let position = desired;
    for (let step = 0; !exactPosition && step < 24 && nodesRef.current.some((node) => Math.abs(node.position.x - position.x) < 390 && Math.abs(node.position.y - position.y) < 270); step += 1) {
      const ring = Math.floor(step / 4) + 1;
      position = { x: desired.x + (step % 2 ? -1 : 1) * ring * 72, y: desired.y + (step % 4 < 2 ? 1 : -1) * ring * 60 };
    }
    const capability = kind === 'videoGenerator' ? 'video' : kind === 'audioGenerator' ? 'audio' : kind === 'modelGenerator' ? 'model' : 'image';
    pushHistory();
    const defaults = kind === 'turnaroundSplitter' ? {} : kind === 'comfyUiWorkflow' ? comfyUiWorkflowDefaults(models) : generatorDefaults(models, capability);
    const newNode = attachActions({ id, type: kind, selected: true, position, width: initialNodeWidth(kind), height: initialNodeHeight(kind), data: { kind, title: kind === 'comfyUiWorkflow' ? defaultComfyUiWorkflowNodeTitle : tools.find((tool) => tool.kind === kind)?.label || kind, outputType: ['text', 'image', 'video', 'audio'].includes(kind) ? kind as DataType : kind === 'imageGenerator' || kind === 'comfyUiWorkflow' ? 'image' : kind === 'videoGenerator' ? 'video' : kind === 'audioGenerator' ? 'audio' : kind === 'modelGenerator' ? 'model' : undefined, ...defaults, ...(kind === 'modelGenerator' && pending?.outputType === 'imageSet' ? { modelInputMode: 'multiview' as const } : {}) } as CanvasNodeData });
    const nextNodes = [...nodesRef.current.map((node) => ({ ...node, selected: false })), newNode];
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    if (pending) {
      const input = runtimeInputPorts(kind, newNode.data).find((port) => port.id === defaultInputPort(kind, pending.outputType, newNode.data));
      if (input) setEdges((current) => [...current, colorEdge({ id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, source: pending.source, sourceHandle: pending.sourceHandle, target: id, targetHandle: input.id }, pending.outputType)]);
    }
    setNodeMenu(null); setConnectMenu(null); setNodeQuery('');
    return id;
  }, [attachActions, createCharacterNode, flow, models, pushHistory, setEdges, setNodes]);
  const generatedAssetModelNames = useMemo(() => new Map(models.map((model) => [model.id, model.name])), [models]);
  const addGeneratedAssetToCanvas = useCallback((item: GeneratedAssetHistoryItem) => {
    const bounds = flowAreaRef.current?.getBoundingClientRect();
    const clientX = bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2;
    const clientY = bounds ? bounds.top + bounds.height / 2 : window.innerHeight / 2;
    const kind: SupportedCanvasNodeKind = item.kind === 'model' ? 'result' : item.kind;
    const nodeId = addNode(kind, clientX, clientY);
    if (!nodeId) return;
    const fallbackTitle = item.kind === 'image' ? '历史图片' : item.kind === 'video' ? '历史视频' : item.kind === 'audio' ? '历史音频' : '历史 3D 模型';
    const title = String(item.fileName || '').replace(/\.[a-z0-9]{1,8}$/i, '').trim() || fallbackTitle;
    const output: ResultOutput = { mediaUrl: item.mediaUrl, previewUrl: item.previewUrl, fileName: item.fileName, width: item.width, height: item.height, duration: item.duration };
    updateNode(nodeId, {
      title,
      mediaUrl: item.mediaUrl,
      previewUrl: item.previewUrl,
      fileName: item.fileName,
      mediaType: item.kind,
      outputType: item.kind,
      mediaWidth: item.width,
      mediaHeight: item.height,
      status: '已从生成资产恢复到画布',
      ...(item.kind === 'model' ? { outputs: [output], selectedOutput: 0, resultState: 'output' as ResultState } : {}),
    });
    setToast(`已把“${title}”放入画布`);
  }, [addNode, updateNode]);
  const startBlankCanvas = useCallback(() => {
    const clientX = Math.round(window.innerWidth / 2);
    const clientY = Math.round(window.innerHeight / 2);
    const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
    setNodeQuery('');
    setNodeMenu({ clientX, clientY, flowX: point.x, flowY: point.y });
  }, [flow]);

  const validateConnection = useCallback((connection: Connection, ignoredEdgeId?: string) => {
    const target = nodesRef.current.find((node) => node.id === connection.target && node.data.kind === 'collection');
    if (target && String(connection.targetHandle || '').startsWith('collection-input-slot:')) {
      const plan = planCollectionInputReplacement(nodesRef.current, edgesRef.current, target.id, String(connection.targetHandle).slice('collection-input-slot:'.length), connection.source, connection.sourceHandle || 'output');
      return { error: plan.error, replaceEdgeIds: [] };
    }
    return evaluateConnection(connection, nodesRef.current, edgesRef.current, ignoredEdgeId);
  }, [workflows.collectionRuntime]);
  const isValidConnection: IsValidConnection<Edge> = useCallback((candidate) => {
    const connection: Connection = {
      source: candidate.source,
      sourceHandle: candidate.sourceHandle ?? null,
      target: candidate.target,
      targetHandle: candidate.targetHandle ?? null,
    };
    const decision = validateConnection(connection, reconnectSessionRef.current?.edge.id);
    connectionFeedbackRef.current = { connection, error: decision.error };
    return decision.error === '';
  }, [validateConnection]);
  const onConnect = useCallback((connection: Connection) => {
    if (String(connection.targetHandle || '').startsWith('collection-input-slot:')) {
      replaceCollectionInput(connection.target, String(connection.targetHandle).slice('collection-input-slot:'.length), connection.source, connection.sourceHandle);
      return;
    }
    const decision = evaluateConnection(connection, nodesRef.current, edgesRef.current);
    if (decision.error) return setToast(decision.error);
    const source = nodesRef.current.find((node) => node.id === connection.source)!;
    const normalizedConnection = { ...connection, targetHandle: decision.targetHandle || connection.targetHandle };
    pushHistory();
    const sourceType = outputTypeFor(source, connection.sourceHandle);
    const edge: Edge = colorEdge({ id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...normalizedConnection, data: { referenceOrder: Date.now(), ...(sourceType ? { referenceToken: nextReferenceToken(edgesRef.current, normalizedConnection.target, sourceType) } : {}) }, reconnectable: 'target' }, sourceType);
    setEdges((current) => [...current.filter((item) => !decision.replaceEdgeIds.includes(item.id)), edge]);
    if (source.data.kind === 'turnaroundSplitter') {
      setNodes((current) => current.map((node) => node.id === connection.target && node.data.kind === 'modelGenerator'
        ? { ...node, data: { ...node.data, modelInputMode: 'multiview' } }
        : node));
    }
    if (decision.replaceEdgeIds.length) setToast('已替换该输入端口的原连接，可使用 Ctrl+Z 撤销');
    staleNodes([normalizedConnection.target], '输入连接已变更，结果可能过期');
  }, [pushHistory, replaceCollectionInput, setEdges, setNodes, staleNodes, validateConnection]);
  const onReconnectStart: NonNullable<ReactFlowProps<CanvasNode, Edge>['onReconnectStart']> = useCallback((_event, edge) => {
    reconnectSessionRef.current = { edge, completed: false };
    connectionFeedbackRef.current = null;
  }, []);
  const onReconnect: OnReconnect<Edge> = useCallback((oldEdge, newConnection) => {
    if (oldEdge.data?.collectionProxy || String(newConnection.targetHandle || '').startsWith('collection-input-slot:')) {
      setToast('组输入请从新来源的输出端拖入对应引用入口；原连线保持不变');
      return;
    }
    if (oldEdge.data?.collectionProxy || String(newConnection.targetHandle || '').startsWith('collection-input-slot:')) { setToast('请从新来源输出端拖入组引用入口；原连线保持不变'); return; }
    const decision = validateConnection(newConnection, oldEdge.id);
    if (decision.error) return setToast(decision.error);
    const source = nodesRef.current.find((node) => node.id === newConnection.source);
    const outputType = source ? outputTypeFor(source, newConnection.sourceHandle) : undefined;
    const normalizedConnection = { ...newConnection, targetHandle: decision.targetHandle || newConnection.targetHandle };
    pushHistory();
    setEdges((current) => {
      const withoutReplaced = current.filter((edge) => !decision.replaceEdgeIds.includes(edge.id));
      const referenceToken = outputType ? referenceTokenAfterReconnect(withoutReplaced, oldEdge, normalizedConnection.target, outputType) : undefined;
      const reconnected = reconnectEdge(oldEdge, normalizedConnection, withoutReplaced, { shouldReplaceId: false }).map((edge) => edge.id === oldEdge.id
        ? colorEdge({ ...edge, data: { ...(edge.data || {}), ...(referenceToken ? { referenceToken } : {}) }, reconnectable: 'target' }, outputType)
        : edge);
      return withStableReferenceTokens(reconnected, nodesRef.current);
    });
    if (reconnectSessionRef.current) reconnectSessionRef.current.completed = true;
    if (decision.replaceEdgeIds.length) setToast('已替换该输入端口的原连接，可使用 Ctrl+Z 撤销');
    staleNodes(new Set([oldEdge.target, normalizedConnection.target]), '输入连接已变更，结果可能过期');
  }, [pushHistory, setEdges, staleNodes, validateConnection]);
  const onReconnectEnd: NonNullable<ReactFlowProps<CanvasNode, Edge>['onReconnectEnd']> = useCallback((_event, _edge, _handleType, state) => {
    const session = reconnectSessionRef.current;
    if (session && !session.completed && state.toHandle !== null) {
      const error = connectionFeedbackRef.current?.error;
      if (error) setToast(error);
    }
    reconnectSessionRef.current = null;
    connectionFeedbackRef.current = null;
  }, []);

  const connectBatchReferences = useCallback((sourceIds: readonly string[], targetId: string | undefined) => {
    const plan = planBatchReferenceConnections(nodesRef.current, edgesRef.current, sourceIds, targetId);
    if (plan.error || !plan.targetId || !plan.connections.length) {
      setToast(plan.error || '没有可连接的节点输出');
      return;
    }
    pushHistory();
    const createdAt = Date.now();
    setEdges((current) => {
      const next = [...current];
      plan.connections.forEach((connection, index) => {
        const referenceToken = nextReferenceToken(next, plan.targetId!, connection.type);
        next.push(colorEdge({
          id: `edge-${createdAt}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          source: connection.sourceId,
          sourceHandle: connection.sourceHandle,
          target: plan.targetId!,
          targetHandle: connection.targetHandle,
          data: { referenceOrder: createdAt + index, referenceToken },
          reconnectable: 'target',
        }, connection.type));
      });
      return withStableReferenceTokens(next, nodesRef.current);
    });
    if (plan.connections.some(connection => connection.type === 'imageSet')) {
      setNodes(current => current.map(node => node.id === plan.targetId && node.data.kind === 'modelGenerator'
        ? { ...node, data: { ...node.data, modelInputMode: 'multiview' } } : node));
    }
    staleNodes([plan.targetId], '批量输入连接已变更，结果可能过期');
    const skippedReason = plan.skipped.length ? `；跳过 ${plan.skipped.length} 个：${plan.skipped[0].reason}` : '';
    setToast(`已按画布顺序连接 ${plan.connections.length} 个节点${skippedReason}，可使用 Ctrl+Z 撤销`);
  }, [pushHistory, setEdges, setNodes, staleNodes]);

  useEffect(() => {
    if (!batchReferenceDrag) return;
    const pointerId = batchReferenceDrag.pointerId;
    document.body.classList.add('batch-reference-dragging');
    const updateDrag = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      const area = flowAreaRef.current;
      const current = batchReferenceDragRef.current;
      if (!area || !current) return;
      const bounds = area.getBoundingClientRect();
      const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.react-flow__node');
      const next: BatchReferenceDrag = {
        ...current,
        current: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        targetId: targetElement?.dataset.id,
      };
      batchReferenceDragRef.current = next;
      setBatchReferenceDrag(next);
    };
    const finishDrag = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      const current = batchReferenceDragRef.current;
      batchReferenceDragRef.current = null;
      setBatchReferenceDrag(null);
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.react-flow__node');
      if (current) connectBatchReferences(current.sourceIds, target?.dataset.id);
    };
    const cancelDrag = (event: PointerEvent | KeyboardEvent) => {
      if ('pointerId' in event && event.pointerId !== pointerId) return;
      if ('key' in event && event.key !== 'Escape') return;
      batchReferenceDragRef.current = null;
      setBatchReferenceDrag(null);
    };
    window.addEventListener('pointermove', updateDrag, { passive: false });
    window.addEventListener('pointerup', finishDrag, { passive: false });
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('keydown', cancelDrag);
    return () => {
      document.body.classList.remove('batch-reference-dragging');
      window.removeEventListener('pointermove', updateDrag);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', cancelDrag);
      window.removeEventListener('keydown', cancelDrag);
    };
  }, [batchReferenceDrag?.pointerId, connectBatchReferences]);

  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    if (state.isValid === true || state.fromHandle?.type !== 'source') {
      connectionFeedbackRef.current = null;
      return;
    }
    if (state.toHandle !== null) {
      const error = connectionFeedbackRef.current?.error;
      if (error) setToast(error);
      connectionFeedbackRef.current = null;
      return;
    }
    if (!state.fromHandle?.nodeId || !state.fromHandle.id) return;
    const source = nodesRef.current.find((node) => node.id === state.fromHandle?.nodeId);
    if (!source) return;
    const outputType = outputTypeFor(source, state.fromHandle.id);
    if (!outputType) return;
    const clientPoint = 'changedTouches' in event && event.changedTouches.length
      ? { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }
      : { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
    // Floating generator controls may sit above the React Flow node. Walk the full
    // hit stack so dropping anywhere on the visible node still reaches its ports.
    const targetElement = document.elementsFromPoint(clientPoint.x, clientPoint.y)
      .map((element) => element.closest<HTMLElement>('.react-flow__node'))
      .find((element): element is HTMLElement => Boolean(element));
    const targetId = targetElement?.dataset.id;
    const target = targetId && targetId !== source.id ? nodesRef.current.find((node) => node.id === targetId) : undefined;
    const nearestVisiblePort = targetElement && target
      ? nearestCanvasInputPort(clientPoint.y, Array.from(targetElement.querySelectorAll<HTMLElement>('[data-canvas-input-port]')).flatMap((handle) => {
        const portId = String(handle.dataset.canvasInputPort || '');
        const port = runtimeInputPorts(target.data.kind, target.data).find((candidate) => candidate.id === portId && candidate.accepts.includes(outputType));
        if (!port) return [];
        const rect = handle.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? [{ id: port.id, top: rect.top, height: rect.height }] : [];
      }))
      : undefined;
    const targetHandle = target && target.data.kind !== 'unsupported'
      ? nearestVisiblePort || defaultInputPort(target.data.kind, outputType, target.data)
      : undefined;
    if (target && targetHandle) {
      onConnect({ source: source.id, sourceHandle: state.fromHandle.id, target: target.id, targetHandle });
      connectionFeedbackRef.current = null;
      return;
    }
    const point = flow.screenToFlowPosition(clientPoint);
    setConnectMenu({ clientX: clientPoint.x, clientY: clientPoint.y, flowX: point.x, flowY: point.y, source: source.id, sourceHandle: state.fromHandle.id || outputType, outputType });
    setNodeMenu(null); setNodeQuery('');
  }, [flow, onConnect]);

  const openNodeMenu = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return;
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setNodeMenu({ clientX: event.clientX, clientY: event.clientY, flowX: position.x, flowY: position.y });
    setNodeQuery('');
  }, [flow]);
  const copySelected = useCallback((ids?: Set<string>, announce = true): Clipboard => {
    const syncSequence = ++clipboardSyncSequenceRef.current;
    const baseSelected = ids || new Set(nodesRef.current.filter((node) => node.selected).map((node) => node.id));
    const selected = expandedCollectionSelection(nodesRef.current, baseSelected);
    const clipboard: Clipboard = {
      sourceTaskId: task.taskId,
      nodes: nodesRef.current.filter((node) => selected.has(node.id)).map(serializeCanvasNode),
      edges: edgesRef.current.filter((edge) => selected.has(edge.source) && selected.has(edge.target)).map((edge) => ({ ...edge, data: edge.data ? { ...edge.data } : undefined, style: edge.style ? { ...edge.style } : undefined })),
    };
    clipboardRef.current = clipboard;
    const summary = `${clipboard.nodes.length} 个节点${clipboard.edges.length ? `和 ${clipboard.edges.length} 条节点连线` : ''}`;
    if (!publicMode && !shareMode && clipboard.sourceTaskId && clipboard.nodes.length) {
      const relay = canvasClipboardServerRequest(clipboard);
      if (announce) setToast(`正在同步 ${summary}，完成后即可跨任务粘贴`);
      void apiFetch('/api/v1/clipboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: relay.keepalive,
        body: relay.body,
      }).then(async (response) => {
        const payload = await readApiJson(response);
        if (!response.ok) throw new Error(payload.error || '跨任务剪贴板同步失败');
        if (announce && clipboardSyncSequenceRef.current === syncSequence) setToast(`已复制 ${summary}，可切换到其他任务粘贴`);
      }).catch((error) => {
        if (announce && clipboardSyncSequenceRef.current === syncSequence) {
          const message = error instanceof Error ? error.message : '跨任务剪贴板同步失败';
          setToast(`节点已复制到当前页面，但跨任务同步失败：${message}`);
        }
      });
    } else if (announce && clipboard.nodes.length) {
      setToast(`已复制 ${summary}`);
    }
    return clipboard;
  }, [apiFetch, publicMode, shareMode, task.taskId]);
  const copySelectedFromMenu = useCallback((ids: Set<string>) => {
    const copiedNodes = nodesRef.current.filter((node) => ids.has(node.id));
    const clipboard = copySelected(ids);
    const payload = serializeCanvasClipboardPayload(clipboard);
    if (window.navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      try {
        void window.navigator.clipboard.write([new ClipboardItem({
          [canvasNodeClipboardFormat]: new Blob([payload], { type: canvasNodeClipboardFormat }),
          'text/plain': new Blob([canvasClipboardPlainText(copiedNodes)], { type: 'text/plain' }),
        })]).catch(() => window.navigator.clipboard?.writeText(canvasClipboardPlainText(copiedNodes)).catch(() => setToast('浏览器未允许写入系统剪贴板，请改用 Ctrl/Cmd+C')));
      } catch {
        void window.navigator.clipboard?.writeText(canvasClipboardPlainText(copiedNodes)).catch(() => setToast('浏览器未允许写入系统剪贴板，请改用 Ctrl/Cmd+C'));
      }
    } else {
      void window.navigator.clipboard?.writeText(canvasClipboardPlainText(copiedNodes)).catch(() => setToast('浏览器未允许写入系统剪贴板，请改用 Ctrl/Cmd+C'));
    }
  }, [copySelected]);
  const copyTaskId = useCallback(async (taskId: string) => {
    try {
      if (!window.navigator.clipboard?.writeText) throw new Error('当前浏览器不支持写入剪贴板');
      await window.navigator.clipboard.writeText(taskId);
      setToast(`已复制 Task ID：${taskId}`);
    } catch (error) {
      setToast(error instanceof Error ? `复制 Task ID 失败：${error.message}` : '复制 Task ID 失败');
    }
  }, []);
  const writePngToExternalClipboard = useCallback(async (
    png: Promise<Blob>,
    fileName: string,
    successMessage: string,
    nodeClipboard?: Clipboard,
  ) => {
    try {
      if (window.navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        try {
          // Keep the browser-native path first so HTTPS/localhost needs no server round trip.
          const clipboardItem: Record<string, Blob | Promise<Blob>> = { 'image/png': png };
          if (nodeClipboard?.nodes.length) {
            clipboardItem[canvasNodeClipboardFormat] = new Blob(
              [serializeCanvasClipboardPayload(nodeClipboard)],
              { type: canvasNodeClipboardFormat },
            );
            clipboardItem['text/plain'] = new Blob([canvasNodeClipboardMarker], { type: 'text/plain' });
          }
          await window.navigator.clipboard.write([new ClipboardItem(clipboardItem)]);
          setToast(successMessage);
          return;
        } catch {
          // LAN HTTP and embedded browsers may expose the API but reject the write.
          // The authenticated local Windows service below is the real fallback.
        }
      }
      if (publicMode || shareMode) throw new Error('共享画布不能访问本机系统剪贴板');
      const form = new FormData();
      form.append('file', await png, fileName);
      const response = await apiFetch('/api/v1/system-clipboard/image', { method: 'POST', body: form });
      const payload = await readApiJson(response);
      if (!response.ok) throw new Error(payload.error || '本机剪贴板写入失败');
      setToast(successMessage);
    } catch (error) {
      setToast(error instanceof Error ? `复制图片失败：${error.message}` : '复制图片失败');
    }
  }, [apiFetch, publicMode, shareMode]);
  const copyImageToExternalClipboard = useCallback((source: ClipboardImageSource) => {
    const fileName = `${source.fileName?.replace(/\.[^.]+$/, '') || 'canvas-image'}.png`;
    void writePngToExternalClipboard(
      clipboardPngBlob(source.mediaUrl),
      fileName,
      '图片已复制到系统剪贴板，可直接粘贴到其他软件',
    );
  }, [writePngToExternalClipboard]);
  const createSelectionClipboardPng = useCallback(async (selected: readonly CanvasNode[]) => {
    const entries: ImageCollageEntry[] = [];
    try {
      for (let order = 0; order < selected.length; order += 1) {
        const node = selected[order];
        const image = clipboardImageForNode(node);
        if (!image) throw new Error('选择中包含非图片节点');
        entries.push({
          id: node.id,
          title: node.data.title || '图片',
          mediaUrl: image.mediaUrl,
          x: node.position.x,
          y: node.position.y,
          width: nodeWidth(node),
          height: nodeHeight(node),
          zIndex: Number(node.zIndex) || 0,
          order,
          bitmap: await loadImageCollageBitmap(image.mediaUrl),
        });
      }
      return (await createPositionedImageComposite(entries)).blob;
    } finally {
      entries.forEach((entry) => entry.bitmap.close?.());
    }
  }, []);
  useEffect(() => {
    const onCanvasCopy = (event: ClipboardEvent) => {
      if (isEditableEventTarget(event.target)) return;
      const selected = nodesRef.current.filter((node) => node.selected);
      if (!selected.length) return;
      const copyAsComposite = selected.length >= 2 && selected.every((node) => Boolean(clipboardImageForNode(node)));
      if (copyAsComposite) {
        event.preventDefault();
        const clipboard = copySelected(undefined, false);
        if (event.clipboardData) {
          try {
            event.clipboardData.setData(canvasNodeClipboardFormat, serializeCanvasClipboardPayload(clipboard));
          } catch { /* Browser-native async clipboard remains the primary dual-format path. */ }
          event.clipboardData.setData('text/plain', canvasNodeClipboardMarker);
        }
        setToast(`正在按画布原位合成 ${selected.length} 张图片...`);
        void writePngToExternalClipboard(
          createSelectionClipboardPng(selected),
          `canvas-selection-${Date.now()}.png`,
          `已按原位复制 ${selected.length} 张图片，可直接粘贴`,
          clipboard,
        );
        return;
      }
      if (!event.clipboardData) return;
      const clipboard = copySelected();
      try {
        event.clipboardData.setData(canvasNodeClipboardFormat, serializeCanvasClipboardPayload(clipboard));
      } catch { /* text/plain remains the mandatory interoperable fallback. */ }
      event.clipboardData.setData('text/plain', canvasClipboardPlainText(selected));
      event.preventDefault();
    };
    document.addEventListener('copy', onCanvasCopy, true);
    return () => document.removeEventListener('copy', onCanvasCopy, true);
  }, [copySelected, createSelectionClipboardPng, task.taskId, writePngToExternalClipboard]);
  const pasteNodes = useCallback(async (flowPoint?: { x: number; y: number }, mode: 'full' | 'settings' = 'full') => {
    let clipboard = clipboardRef.current;
    if (!clipboard.nodes.length && !publicMode && !shareMode) {
      try {
        const response = await apiFetch('/api/v1/clipboard');
        const payload = await readApiJson(response);
        if (response.ok && payload.clipboard?.nodes?.length) {
          clipboard = payload.clipboard as Clipboard;
          clipboardRef.current = clipboard;
        }
      } catch { /* A local clipboard remains the primary path. */ }
    }
    if (!clipboard.nodes.length) { setToast('没有可粘贴的节点，请先在源任务按 Ctrl/Cmd+C'); return; }
    if (clipboard.sourceTaskId && clipboard.sourceTaskId !== task.taskId) {
      if (publicMode || shareMode) { setToast('跨任务粘贴仅支持本地编辑画布'); return; }
      try {
        const response = await apiFetch(taskCanvasUrl(task.taskId, activeCanvasId, '/paste'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceTaskId: clipboard.sourceTaskId, clipboard, position: flowPoint, mode }),
        });
        const payload = await readApiJson(response);
        if (!response.ok) throw new Error(payload.error || '跨任务粘贴失败');
        skipNextAutosaveRef.current = true;
        setNodes((payload.nodes as CanvasNode[]).map((node) => attachActions(node)));
        setEdges(payload.edges as Edge[]);
        setRevision(Number(payload.revision) || 0);
        revisionRef.current = Number(payload.revision) || 0;
        setSaveState('已保存');
        requestAnimationFrame(() => setNodes((current) => current.map((node) => attachActions(node))));
        setToast(`已粘贴 ${payload.copiedNodeCount || 0} 个节点${mode === 'full' && payload.copiedAssetCount ? `，已复制 ${payload.copiedAssetCount} 个素材` : ''}`);
      } catch (error) { setToast(error instanceof Error ? error.message : '跨任务粘贴失败'); }
      return;
    }
    const sourceNodes = mode === 'settings'
      ? clipboard.nodes.filter((node) => !['image', 'video', 'audio'].includes(node.data.kind))
      : clipboard.nodes;
    if (!sourceNodes.length) { setToast('仅粘贴参数时请至少选择文本或生成节点'); return; }
    pushHistory();
    const stamp = Date.now();
    const idMap = new Map(sourceNodes.map((node, index) => [node.id, `${node.data.kind}-${stamp}-${index}`]));
    const minX = Math.min(...sourceNodes.map((node) => node.position.x));
    const minY = Math.min(...sourceNodes.map((node) => node.position.y));
    const offset = flowPoint ? { x: flowPoint.x - minX, y: flowPoint.y - minY } : { x: 36, y: 36 };
    const firstPasteLayer = Math.max(2, ...nodesRef.current.map((node) => Number(node.zIndex) || 0)) + 1;
    const pasteLayerBySourceId = new Map<string, number>();
    sourceNodes.filter((node) => node.data.kind === 'collection').forEach((collection, index) => {
      const frameLayer = firstPasteLayer + index * 2;
      pasteLayerBySourceId.set(collection.id, frameLayer);
      (collection.data.memberIds || []).forEach((memberId) => pasteLayerBySourceId.set(memberId, frameLayer + 1));
    });
    const standalonePasteLayer = firstPasteLayer + sourceNodes.filter((node) => node.data.kind === 'collection').length * 2;
    const copies = sourceNodes.map((node) => {
      let data = stripCanvasClipboardRuntime(node.data) as CanvasNodeData;
      data = remapTurnaroundClipboardSource(data, node.id, clipboard.edges, idMap);
      data = remapCollectionMemberIds(data, idMap);
      if (data.kind === 'collection') Object.assign(data, { workflowState: 'idle', workflowProgress: 0, workflowStatus: '已粘贴，可运行', workflowFailedNodeIds: [] });
      if (mode === 'settings') Object.assign(data, { mediaUrl: undefined, mediaType: undefined, mediaWidth: undefined, mediaHeight: undefined, mediaDuration: undefined, fileName: undefined });
      return { ...node, id: idMap.get(node.id)!, selected: true, position: { x: node.position.x + offset.x, y: node.position.y + offset.y }, zIndex: pasteLayerBySourceId.get(node.id) ?? standalonePasteLayer, data };
    });
    const edgeCopies = clipboard.edges.filter((edge) => idMap.has(edge.source) && idMap.has(edge.target)).map((edge, index) => ({ ...edge, id: `edge-${stamp}-${index}`, source: idMap.get(edge.source)!, target: idMap.get(edge.target)!, selected: false }));
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...copies]);
    setEdges((current) => [...current.map((edge) => ({ ...edge, selected: false })), ...edgeCopies]);
  }, [activeCanvasId, apiFetch, attachActions, publicMode, pushHistory, setEdges, setNodes, shareMode, task.taskId]);
  const deleteSelectedNodes = useCallback(() => {
    const selectedIds = nodesRef.current.filter((node) => node.selected).map((node) => node.id);
    if (!selectedIds.length) return;
    const deletion = collectionDeletionNodeIds(nodesRef.current, selectedIds);
    const collectionCount = nodesRef.current.filter((node) => deletion.has(node.id) && node.data.kind === 'collection').length;
    const downstream = edgesRef.current.filter((edge) => deletion.has(edge.source) && !deletion.has(edge.target)).map((edge) => edge.target);
    pushHistory();
    staleNodes(downstream, '前序节点已删除，结果可能过期');
    setNodes((current) => {
      const next = current.filter((node) => !deletion.has(node.id));
      nodesRef.current = next;
      return next;
    });
    setEdges((current) => {
      const next = current.filter((edge) => !deletion.has(edge.source) && !deletion.has(edge.target));
      edgesRef.current = next;
      return next;
    });
    if (collectionCount) setToast(`已删除 ${collectionCount} 个收纳组及其中节点`);
  }, [pushHistory, setEdges, setNodes, setToast, staleNodes]);
  const arrangeSelected = useCallback((mode: SelectionArrangeMode | 'auto') => {
    const selected = nodesRef.current.filter((node) => node.selected);
    if (selected.length < 2) return;
    const positions = mode === 'auto'
      ? layoutConnectedNodes(nodesRef.current, edgesRef.current, new Set(selected.map((node) => node.id)))
      : arrangeSelectedNodes(selected, mode, nodesRef.current);
    if (!positions.size) return;
    pushHistory();
    setNodes((current) => {
      const next = current.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node);
      nodesRef.current = next;
      return next;
    });
  }, [pushHistory, setNodes]);
  useEffect(() => {
    const trackPointer = (event: PointerEvent) => { pointerRef.current = { x: event.clientX, y: event.clientY }; };
    window.addEventListener('pointermove', trackPointer, { passive: true });
    return () => window.removeEventListener('pointermove', trackPointer);
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editing = isEditableEventTarget(event.target);
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'v' && !editing) {
        // Let the browser emit its native paste event first so screenshots and
        // copied media files remain available through ClipboardEvent.clipboardData.
        keyboardPasteModeRef.current = event.shiftKey ? 'settings' : 'full';
      }
      else if (command && !event.altKey && !event.shiftKey && !editing && selectionArrangeModeForShortcut(event.key)) {
        if (nodesRef.current.filter((node) => node.selected).length < 2) return;
        event.preventDefault();
        arrangeSelected(selectionArrangeModeForShortcut(event.key)!);
      }
      else if (command && event.key.toLowerCase() === 'g' && !event.shiftKey && !editing) {
        const selectedIds = collectionShortcutNodeIds(nodesRef.current);
        if (selectedIds.length < 2) return;
        event.preventDefault();
        workflows.createCollection(selectedIds);
      }
      else if (event.key === 'Enter' && !isNodeRunShortcutBlockedTarget(event.target) && !nodeMenu && !paneMenu && !connectMenu && !contextMenu && !comfyUiEditor) {
        const nodeId = selectedGeneratorNodeIdForEnterShortcut(nodesRef.current, {
          key: event.key,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          isComposing: event.isComposing,
          repeat: event.repeat,
        });
        if (!nodeId) return;
        event.preventDefault();
        const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
        if (node?.data.kind === 'comfyUiWorkflow') void runComfyUiWorkflow(nodeId);
        else void runGenerator(nodeId);
      }
      else if (event.key === 'F2' && !editing) {
        const selected = nodesRef.current.filter((node) => node.selected);
        if (selected.length !== 1) return;
        event.preventDefault();
        setContextMenu(null);
        setRenamingNodeId(selected[0].id);
      }
      else if (command && event.key.toLowerCase() === 'z' && !event.shiftKey && !editing) { event.preventDefault(); undo(); }
      else if (command && ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y') && !editing) { event.preventDefault(); redo(); }
      else if (event.key.toLowerCase() === 'd' && !editing && !event.altKey && !event.shiftKey && !event.isComposing && nodesRef.current.some((node) => node.selected)) {
        event.preventDefault();
        if (event.repeat) return;
        cloneSelectedNodes(nodesRef.current.filter((node) => node.selected).map((node) => node.id), 'with-inputs');
      }
      else if ((event.key === 'Backspace' || event.key === 'Delete') && !editing) {
        if (!nodesRef.current.some((node) => node.selected)) return;
        event.preventDefault();
        deleteSelectedNodes();
      }
      else if (event.key.toLowerCase() === 'f' && !editing) {
        event.preventDefault();
        const selected = nodesRef.current.filter((node) => node.selected);
        flow.fitView({ nodes: selected.length ? selected : undefined, padding: selected.length ? 0.22 : 0.12, duration: 160, minZoom: 0.65, maxZoom: 1.25 });
      }
      else if (event.key === 'Home' && !editing) { event.preventDefault(); flow.fitView({ padding: 0.12, duration: 160, minZoom: canvasMinimumZoom, maxZoom: 1.15 }); }
      else if (event.key === '1' && !editing) { event.preventDefault(); const viewport = flow.getViewport(); flow.setViewport({ ...viewport, zoom: 1 }, { duration: 140 }); }
      else if (event.key === 'Tab' && !editing) {
        event.preventDefault();
        openNodeMenu({ button: 0, clientX: pointerRef.current.x, clientY: pointerRef.current.y } as React.MouseEvent);
      }
      else if (event.key === 'Escape') { setNodeMenu(null); setPaneMenu(null); setConnectMenu(null); setContextMenu(null); setRenamingNodeId(null); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [arrangeSelected, cloneSelectedNodes, comfyUiEditor, connectMenu, contextMenu, copySelected, deleteSelectedNodes, flow, nodeMenu, openNodeMenu, paneMenu, pasteNodes, redo, runComfyUiWorkflow, runGenerator, undo, workflows.createCollection]);
  const visibleCreatableTools = creatableTools.filter((tool) => canvasToolVisible(tool.kind, models));
  const visibleManualTools = manualTools.filter((tool) => canvasToolVisible(tool.kind, models));
  const filteredTools = visibleCreatableTools.filter((tool) => `${tool.label} ${tool.kind}`.toLowerCase().includes(nodeQuery.toLowerCase()));
  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    const currentNodes = nodesRef.current;
    const nodeById = new Map(currentNodes.map((node) => [node.id, node]));
    const collectionByMember = new Map<string, CanvasNode>();
    currentNodes.forEach((node) => {
      if (node.data.kind !== 'collection' || node.data.collapsed) return;
      (node.data.memberIds || []).forEach((memberId) => collectionByMember.set(memberId, node));
    });
    const collectionMovement = collectionMemberPositionChanges(currentNodes, changes);
    const expandedChanges: Parameters<typeof onNodesChange>[0] = [
      ...changes.filter((change) => !(change.type === 'position' && collectionMovement.memberIds.has(change.id))),
      ...collectionMovement.memberChanges,
    ];
    const activatedIds = changes.flatMap((change) => change.type === 'select' && change.selected ? [change.id] : []);
    const collectionGrowth = new Map<string, { position: { x: number; y: number }; width: number; height: number }>();
    expandedChanges.forEach((change) => {
      if (change.type !== 'position' || !change.position) return;
      const collection = nodeById.get(change.id);
      if (collection?.data.kind === 'collection' || collectionMovement.memberIds.has(change.id)) return;
      const owner = collectionByMember.get(change.id);
      const member = nodeById.get(change.id);
      if (!owner || !member) return;
      const currentGrowth = collectionGrowth.get(owner.id);
      const frame = growCollectionFrameForNode({
        ...owner,
        ...(currentGrowth ? { position: currentGrowth.position, width: currentGrowth.width, height: currentGrowth.height, measured: undefined } : {}),
      }, { ...member, position: change.position });
      if (frame) collectionGrowth.set(owner.id, frame);
    });
    collectionGrowth.forEach((frame, id) => {
      expandedChanges.push({ id, type: 'position', position: frame.position, dragging: false });
      expandedChanges.push({ id, type: 'dimensions', dimensions: { width: frame.width, height: frame.height }, resizing: false, setAttributes: true });
    });
    const removed = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id));
    const completedDrag = changes.some((change) => change.type === 'position' && 'dragging' in change && change.dragging === false);
    if (completedDrag) saveDelayRef.current = 180;
    if (removed.size) { pushHistory(); const downstream = edgesRef.current.filter((edge) => removed.has(edge.source) && !removed.has(edge.target)).map((edge) => edge.target); staleNodes(downstream, '前序节点已删除，结果可能过期'); }
    onNodesChange(expandedChanges);
    if (activatedIds.length === 1) setNodes((current) => {
      const next = promoteCanvasNodePackage(current, activatedIds[0]);
      nodesRef.current = next;
      return next;
    });
    if (collectionGrowth.size) setNodes((current) => current.map((node) => {
      const frame = collectionGrowth.get(node.id);
      return frame ? { ...node, data: { ...node.data, expandedWidth: frame.width, expandedHeight: frame.height } } : node;
    }));
  }, [onNodesChange, pushHistory, setNodes, staleNodes]);
  const disconnectEdges = useCallback((edgeIds: Set<string>) => {
    if (!edgeIds.size) return;
    const targets = edgesRef.current.filter((edge) => edgeIds.has(edge.id)).map((edge) => edge.target);
    pushHistory();
    setEdges((current) => current.filter((edge) => !edgeIds.has(edge.id)));
    staleNodes(targets, '输入连接已断开，结果可能过期');
    setToast('连接已断开，可使用 Ctrl+Z 撤销');
  }, [pushHistory, setEdges, staleNodes]);
  const handleEdgesChange = useCallback((changes: Parameters<typeof onEdgesChange>[0]) => {
    const removedIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id));
    if (removedIds.size) { pushHistory(); const targets = edgesRef.current.filter((edge) => removedIds.has(edge.id)).map((edge) => edge.target); staleNodes(targets, '输入连接已删除，结果可能过期'); }
    onEdgesChange(changes);
  }, [onEdgesChange, pushHistory, staleNodes]);
  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const selectedReferenceIds = useMemo(() => selectedReferenceSourceIds(nodes, nodes.filter(node => node.selected).map(node => node.id)), [nodes]);
  const batchSelectionHandlePosition = useMemo(() => {
    if (selectedNodes.length < 2) return null;
    const right = Math.max(...selectedNodes.map((node) => node.position.x + nodeWidth(node)));
    const top = Math.min(...selectedNodes.map((node) => node.position.y));
    const bottom = Math.max(...selectedNodes.map((node) => node.position.y + nodeHeight(node)));
    return {
      left: viewport.x + right * viewport.zoom + multiSelectionVisualOffset,
      top: viewport.y + ((top + bottom) / 2) * viewport.zoom,
    };
  }, [selectedNodes, viewport]);
  const selectionToolbarPosition = useMemo(() => multiSelectionToolbarPosition(selectedNodes, viewport, {
    width: flowAreaRef.current?.clientWidth || window.innerWidth,
    height: flowAreaRef.current?.clientHeight || window.innerHeight,
  }), [selectedNodes, viewport]);
  const activeBatchReferencePlan = useMemo(() => batchReferenceDrag?.targetId
    ? planBatchReferenceConnections(nodes, edges, batchReferenceDrag.sourceIds, batchReferenceDrag.targetId)
    : null, [batchReferenceDrag?.sourceIds, batchReferenceDrag?.targetId, edges, nodes]);
  const batchTargetHighlight = useMemo(() => {
    if (!batchReferenceDrag?.targetId) return null;
    const target = nodes.find((node) => node.id === batchReferenceDrag.targetId);
    if (!target) return null;
    return {
      left: viewport.x + target.position.x * viewport.zoom,
      top: viewport.y + target.position.y * viewport.zoom,
      width: nodeWidth(target) * viewport.zoom,
      height: nodeHeight(target) * viewport.zoom,
    };
  }, [batchReferenceDrag?.targetId, nodes, viewport]);
  const startBatchReferenceDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !selectedReferenceIds.length || !flowAreaRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = flowAreaRef.current.getBoundingClientRect();
    const start = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const drag: BatchReferenceDrag = {
      pointerId: event.pointerId,
      sourceIds: [...selectedReferenceIds],
      start,
      current: start,
    };
    batchReferenceDragRef.current = drag;
    setBatchReferenceDrag(drag);
    setContextMenu(null);
    setPaneMenu(null);
    setNodeMenu(null);
    setConnectMenu(null);
  }, [selectedReferenceIds]);
  const singleSelectedNodeId = selectedNodes.length === 1 ? selectedNodes[0].id : null;
  const switchAgentWorkspace = useCallback((next: AgentWorkspace) => {
    // One owner for both surfaces. Dismiss only transient UI, never selection,
    // drafts, references, graph data or running work.
    if (document.activeElement instanceof HTMLElement && document.activeElement.matches('input,textarea,[contenteditable]')) document.activeElement.blur();
    setNodeMenu(null); setPaneMenu(null); setConnectMenu(null); setContextMenu(null);
    setCanvasAppMenuOpen(false); setCanvasBoardMenuOpen(false); setMobilePresetsOpen(false); setShowShortcutGuide(false);
    setAgentWorkspace(next);
  }, []);
  const selectedGenerator = selectedNodes.length === 1 && ['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow'].includes(selectedNodes[0].data.kind) ? selectedNodes[0] : null;
  const agentItemsCache = useMemo(() => createCanvasMetadataCache<CanvasNode, Edge, CanvasAgentItem[]>((sourceNodes, sourceEdges) => sourceNodes.map((node) => {
    const nodes = sourceNodes as CanvasNode[], edges = sourceEdges as Edge[];
    const output = resolveGeneratorSourceOutput(nodes, edges, node.id);
    return { id: node.id, title: node.data.title || '未命名节点', kind: node.data.kind, state: node.data.jobState, status: node.data.status,
      ...(output.type && output.value ? { reference: { sourceId: node.id, type: output.type, label: node.data.title || '未命名节点', token: `node-${node.id}`, previewUrl: output.previewUrl, ...(output.type === 'text' ? { text: String(output.value) } : { mediaUrl: String(output.value) }), duration: output.duration } } : {}),
    };
  })), []);
  const agentItems = useMemo<CanvasAgentItem[]>(() => !agentOpen ? [] : agentItemsCache(nodes, edges), [agentOpen, nodes, edges, agentItemsCache]);
  const [agentFollow, setAgentFollow] = useState(() => { try { return localStorage.getItem('heiyan:agent-follow') !== 'off'; } catch { return true; } });
  const agentRevealUntil = useRef(0);
  const agentFollowRef = useRef(agentFollow); agentFollowRef.current = agentFollow;
  const agentOpenRef = useRef(agentOpen); agentOpenRef.current = agentOpen;
  const [agentFeedback, setAgentFeedback] = useState<{ ids: string[]; label: string; at: number } | null>(null);
  useEffect(() => { setAgentFeedback(null); }, [activeCanvasKey]);
  useEffect(() => { if (!agentFeedback) return; const timer = setTimeout(() => setAgentFeedback(null), 7000); return () => clearTimeout(timer); }, [agentFeedback]);
  const revealAgentNodes = useCallback((ids: string[], label: string, automatic = false) => {
    if (loadedCanvasKeyRef.current !== activeCanvasKey) return;
    const live = ids.filter(id => nodesRef.current.some(n => n.id === id));
    setAgentFeedback({ ids: live, label, at: Date.now() });
    if (!live.length || automatic && (!agentFollowRef.current || !agentOpenRef.current)) return;
    agentRevealUntil.current = Date.now() + 500;
    if (!automatic || agentCompactLayout(window.innerWidth)) setAgentWorkspace('canvas');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (loadedCanvasKeyRef.current !== activeCanvasKey) return;
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260;
      void flow.fitView({ nodes: live.map(id => ({ id })), padding: .22, duration, minZoom: canvasMinimumZoom, maxZoom: 1 });
    }));
  }, [activeCanvasKey, flow]);
  const focusAgentNode = useCallback((nodeId: string) => {
    selectNode(nodeId);
    // Mobile selection tracking owns the viewport after the surface switch.
    // Starting another animation here would race it and visibly jump twice.
    if (mobileCanvas.mobile) return;
    requestAnimationFrame(() => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      const bounds = flowAreaRef.current?.getBoundingClientRect();
      if (!node || !bounds) return;
      const position = flow.getInternalNode(nodeId)?.internals.positionAbsolute || node.position;
      const width = node.measured?.width || node.width || 390;
      const height = node.measured?.height || node.height || 230;
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240;
      if (agentCompactLayout(mobileCanvas.width)) {
        const hasEditor = ['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow', 'characterAnimator'].includes(node.data.kind);
        const target = mobileNodeFocusViewport({ node: { ...position, width, height }, width: mobileCanvas.width, height: mobileCanvas.height, top: 120, bottom: hasEditor ? mobileCanvas.sheetHeight + 12 : 82, minZoom: canvasMinimumZoom });
        void flow.setViewport({ ...target, x: target.x - bounds.left, y: target.y + mobileCanvas.top - bounds.top }, { duration });
      } else {
        void flow.setCenter(position.x + width / 2, position.y + height / 2, { zoom: Math.min(1, (bounds.width - 100) / width, (bounds.height - 130) / height), duration });
      }
    });
  }, [flow, selectNode, mobileCanvas.mobile, mobileCanvas.width, mobileCanvas.height, mobileCanvas.top, mobileCanvas.sheetHeight]);
  const agentPreviewPlan = useRef<{ key: string; plan: ReturnType<typeof planAgentEdits> } | null>(null);
  const agentCanvasAccess = useMemo<AgentCanvasAccess>(() => {
    const ensureReady = () => { if (!ready || shareMode || loadedCanvasKeyRef.current !== activeCanvasKey || saveBlockedRef.current) throw Error('画布尚未就绪或已切换，操作未执行'); };
    const read = (referenceIds: string[], request: import('../server/agent-contract.js').AgentProposal = {}) => {
      ensureReady();
      const view = flow.getViewport(), area = flowAreaRef.current?.getBoundingClientRect();
      return canvasAgentContext(nodesRef.current, edgesRef.current, referenceIds, models, request, area ? { x: -view.x / view.zoom, y: -view.y / view.zoom, width: area.width / view.zoom, height: area.height / view.zoom, zoom: view.zoom } : undefined);
    };
    const prepare = (proposal: import('../server/agent-contract.js').AgentProposal) => {
      const context = read([]), key = activeCanvasKey + ':' + context.revision + ':' + JSON.stringify(proposal);
      const selection = (plan: ReturnType<typeof planAgentEdits>) => {
        const changesSelection = proposal.operations?.some(op => ['select', 'duplicate'].includes(op.action)), currentNodes = new Map(nodesRef.current.map(n => [n.id, n]));
        return { ...plan, nodes: plan.nodes.map(n => { const current = currentNodes.get(n.id); if (!current) return n;
          return { ...n, selected: changesSelection ? n.selected : current.selected, dragging: current.dragging, data: { ...n.data, progress: current.data.progress, jobUpdatedAt: current.data.jobUpdatedAt, jobDeadlineAt: current.data.jobDeadlineAt, comfyPreview: current.data.comfyPreview, localQueue: current.data.localQueue, status: n.data.stale !== current.data.stale ? n.data.status : current.data.status } };
        }) };
      };
      if (agentPreviewPlan.current?.key === key) return selection(agentPreviewPlan.current.plan);
      const bounds = flowAreaRef.current?.getBoundingClientRect();
      const center = flow.screenToFlowPosition({ x: bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2, y: bounds ? bounds.top + bounds.height / 2 : window.innerHeight / 2 });
      const startX = nodesRef.current.length ? Math.max(...nodesRef.current.map(node => node.position.x + (node.width || 390))) + 80 : center.x - 180;
      const planned = planAgentEdits(proposal, nodesRef.current, edgesRef.current, {
        duplicate: (nodes, edges, nodeIds) => buildSelectedClonePlan(nodes, edges, nodeIds, 'with-inputs', crypto.randomUUID()),
        configure: (node, operation) => {
          const capability = ({ imageGenerator: 'image', videoGenerator: 'video', audioGenerator: 'audio', modelGenerator: 'model' } as Record<string, string>)[node.data.kind];
          const model = models.find(model => model.id === (operation.modelId || node.data.modelId) && model.capability === capability);
          if (!capability || !model) throw Error('该节点没有匹配的可用模型');
          const profile = model.profile;
          if (operation.ratio && !profile?.ratios.includes(operation.ratio)) throw Error('模型不支持该比例');
          if (operation.resolution && !profile?.resolutions.includes(operation.resolution)) throw Error('模型不支持该分辨率');
          for (const key of ['count', 'duration'] as const) {
            const value = operation[key], range = profile?.[key];
            if (value !== undefined && (!range || value < range.min || value > range.max || (key === 'count' && !Number.isInteger(value)) || (key === 'duration' && capability !== 'video'))) throw Error('模型不支持该数量或时长');
          }
          const defaults = compatibleGeneratorSettings(model, node.data.ratio, node.data.resolution, node.data.duration);
          const currentCount = node.data.count || 1;
          const count = profile ? Math.max(profile.count.min, Math.min(profile.count.max, currentCount)) : currentCount;
          node = { ...node, data: { ...node.data, count } };
          return { ...node, data: { ...node.data, ...defaults, ...(operation.ratio ? { ratio: operation.ratio } : {}), ...(operation.resolution ? { resolution: operation.resolution } : {}), ...(operation.count !== undefined ? { count: operation.count } : {}), ...(operation.duration !== undefined ? { duration: operation.duration } : {}) } };
        },
        create: (kind, index) => {
          if (!canvasToolVisible(kind as SupportedCanvasNodeKind, models)) throw Error('此节点能力尚未启用，请先在画布设置中配置');
          const capability = kind === 'videoGenerator' ? 'video' : kind === 'audioGenerator' ? 'audio' : kind === 'modelGenerator' ? 'model' : 'image';
          return attachActions({ id: `${kind}-${crypto.randomUUID()}`, type: kind, position: { x: startX + (index % 3) * 470, y: center.y + Math.floor(index / 3) * 340 }, width: initialNodeWidth(kind), height: initialNodeHeight(kind), data: { ...(kind === 'text' ? {} : generatorDefaults(models, capability)), kind, title: '', outputType: kind === 'text' ? 'text' : capability } as CanvasNodeData });
        },
        connect: (source, target, nodes, edges, targetPort) => {
          const connection = agentConnectionForNodes(source, target, nodes);
          if (targetPort) {
            const node = nodes.find(node => node.id === target)!;
            if (!runtimeInputPorts(node.data.kind, node.data).some(port => port.id === targetPort)) throw Error('目标输入端口不存在，请重新读取画布');
            connection.targetHandle = targetPort;
          }
          const decision = evaluateConnection(connection, nodes, edges);
          if (decision.error) throw Error(decision.error);
          if (decision.replaceEdgeIds.length) throw Error('该端口已有连接，请先在画布中确认替换');
          const sourceType = outputTypeFor(nodes.find(node => node.id === source)!, 'output');
          return colorEdge({ ...connection, id: `edge-${crypto.randomUUID()}`, targetHandle: decision.targetHandle || null, data: { referenceOrder: Date.now(), ...(sourceType ? { referenceToken: nextReferenceToken(edges, target, sourceType) } : {}) }, reconnectable: 'target' }, sourceType);
        },
      });
      agentPreviewPlan.current = { key, plan: planned };
      return selection(planned);
    };
    return { read, reveal: revealAgentNodes, jobs: targets => { ensureReady(); return targets.map(target => jobSnapshot(nodesRef.current, target)); }, preview: proposal => { const planned = prepare(proposal); return editPreview(nodesRef.current, planned.nodes, edgesRef.current, planned.edges, read([]).revision, planned.warnings, read([]).availableModels); }, documents: () => {
      read([]);
      return nodesRef.current.map(node => ({ id: node.id, source: 'node' as const, title: String(node.data.title || node.id),
        text: String(node.data.kind === 'text' ? node.data.text || '' : node.data.prompt || ''),
        nodeIds: [...new Set([node.id, ...edgesRef.current.filter(e => e.source === node.id || e.target === node.id).flatMap(e => [e.source, e.target])])] }));
    }, images: async (nodeIds, jobIds, outputIndexes) => {
      read([]);
      const images: string[] = [];
      for (const [i, id] of nodeIds.slice(0, 4).entries()) {
        const node = nodesRef.current.find(n => n.id === id);
        if (!node) throw Error('图片节点已不存在');
        const resultJob = jobIds ? jobSnapshot(nodesRef.current, { nodeId: id, jobId: jobIds[i] }) : null;
        const output = resultJob?.outputs[outputIndexes?.[i] || 0];
        if (resultJob && (resultJob.state !== 'succeeded' || resultJob.type !== 'image' || !output?.mediaUrl || output.simulated)) throw Error('此任务的指定图片尚不可读取，请先核实结果');
        const source = resultJob ? { mediaUrl: output!.mediaUrl! } : clipboardImageForNode(node);
        if (!source) throw Error(`节点「${node.data.title}」没有可读取的图片`);
        let blob = await clipboardPngBlob(source.mediaUrl);
        if (blob.size > 3 * 1024 * 1024) {
          const bitmap = await createImageBitmap(blob);
          try {
            for (const limit of [1536, 1024, 768]) {
              const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
              const preview = document.createElement('canvas'); preview.width = Math.max(1, Math.round(bitmap.width * scale)); preview.height = Math.max(1, Math.round(bitmap.height * scale));
              const context = preview.getContext('2d'); if (!context) throw Error('无法准备检查图片');
              context.drawImage(bitmap, 0, 0, preview.width, preview.height);
              blob = await new Promise<Blob>((resolve, reject) => preview.toBlob(value => value ? resolve(value) : reject(Error('检查图片转换失败')), 'image/png'));
              if (blob.size <= 3 * 1024 * 1024) break;
            }
          } finally { bitmap.close(); }
        }
        if (blob.size > 3 * 1024 * 1024) throw Error('检查图片仍超过传输上限，请先在节点核实素材');
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error('图片读取失败')); reader.readAsDataURL(blob); });
        images.push(data);
      }
      return images;
    }, edit: (proposal, revision) => {
      if (read([]).revision !== revision) throw Error('画布已变化，请重新确认方案');
      const planned = prepare(proposal);
      agentPreviewPlan.current = null;
      pushHistory(); nodesRef.current = planned.nodes; edgesRef.current = planned.edges;
      setNodes(planned.nodes); setEdges(planned.edges); setToast('Agent 已修改画布，可撤销；尚未提交生成');
      revealAgentNodes(planned.affected, proposal.summary || 'Agent 已修改画布', true);
      return planned.result;
    }, generate: async (request, revision) => {
      if (read([]).revision !== revision) throw Error('画布已变化，请重新确认生成');
      const nodeIds = validateAgentTool('heiyan_request_generation', request).nodeIds || [];
      const generatorKinds = new Set(['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow']);
      const targets = nodeIds.map((id) => nodesRef.current.find((node) => node.id === id));
      if (targets.some((node) => !node)) throw Error('生成节点已不在当前画布');
      if (targets.some((node) => !generatorKinds.has(node!.data.kind))) throw Error('只能提交图片、视频、音频、3D 或 ComfyUI 生成节点');
      if (targets.some((node) => ['queued', 'running', 'paused', 'cancelling'].includes(String(node!.data.jobState || '')))) throw Error('所选节点中有任务尚未结束');
      const submitted: Array<{ id: string; jobId: string; title: string; expected: { count: number; ratio: string; resolution: string; duration: number } }> = [], failed: string[] = [];
      for (const node of targets) {
        const jobId = await runGenerator(node!.id);
        if (jobId) submitted.push({ id: node!.id, jobId, title: String(node!.data.title || node!.id), expected: { count: node!.data.count || 1, ratio: node!.data.ratio || '', resolution: node!.data.resolution || '', duration: node!.data.duration || 0 } });
        else failed.push(node!.id);
      }
      if (!submitted.length) throw Error('生成请求未提交，请在节点中检查模型、提示词和输入素材');
      setToast(`Agent 已提交 ${submitted.length} 个生成任务${failed.length ? `，${failed.length} 个未提交` : ''}`);
      revealAgentNodes(submitted.map(n => n.id), '已提交生成，等待素材返回', true);
      return JSON.stringify({ summary: request.summary, submitted, failed, generated: false });
    } };
  }, [activeCanvasKey, attachActions, flow, models, pushHistory, ready, revealAgentNodes, runGenerator, setEdges, setNodes, setToast, shareMode]);
  const selectedCharacterGenerator = selectedNodes.length === 1 && selectedNodes[0].data.kind === 'characterAnimator' ? selectedNodes[0] : null;
  const focusMobileNode = useCallback((nodeId: string) => {
    if (!mobileCanvas.mobile || Date.now() < agentRevealUntil.current) return;
    if (agentOpen && !agentCanvasView) return;
    const node = nodesRef.current.find((item) => item.id === nodeId);
    const area = flowAreaRef.current;
    if (!node || !area) return;
    const bounds = area.getBoundingClientRect();
    const position = flow.getInternalNode(nodeId)?.internals.positionAbsolute || node.position;
    const hasEditor = ['imageGenerator', 'videoGenerator', 'audioGenerator', 'modelGenerator', 'comfyUiWorkflow', 'characterAnimator'].includes(node.data.kind);
    const target = mobileNodeFocusViewport({
      node: { ...position, width: node.measured?.width || node.width || 390, height: node.measured?.height || node.height || 230 },
      width: mobileCanvas.width,
      height: mobileCanvas.height,
      top: mobileCanvas.keyboard ? 12 : mobileCanvas.width > mobileCanvas.height ? 70 : 124,
      bottom: hasEditor ? mobileCanvas.sheetHeight + 12 : 82,
      minZoom: canvasMinimumZoom,
    });
    void flow.setViewport({ ...target, x: target.x - bounds.left, y: target.y + mobileCanvas.top - bounds.top }, {
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260,
    });
  }, [flow, mobileCanvas.mobile, mobileCanvas.width, mobileCanvas.height, mobileCanvas.keyboard, mobileCanvas.sheetHeight, mobileCanvas.top, agentOpen, agentCanvasView]);
  useEffect(() => {
    if (!mobileCanvas.mobile || !singleSelectedNodeId) return;
    // Only selection / screen changes trigger tracking, not pan, zoom or typing.
    const timer = window.setTimeout(() => focusMobileNode(singleSelectedNodeId), 80);
    return () => window.clearTimeout(timer);
  }, [singleSelectedNodeId, selectedNodes[0]?.measured?.width, selectedNodes[0]?.measured?.height, mobileCanvas.mobile, focusMobileNode]);
  useEffect(() => { setMobilePresetsOpen(false); }, [singleSelectedNodeId]);
  useEffect(() => { if (mobileCanvas.keyboard) setMobilePresetsOpen(false); }, [mobileCanvas.keyboard]);
  const selectedConnectionGuideType = useMemo<DataType | undefined>(() => {
    if (selectedNodes.length !== 1) return undefined;
    const node = selectedNodes[0];
    return node.data.kind === 'result' ? node.data.outputType : portDefinitions[node.data.kind].outputs[0]?.type;
  }, [selectedNodes]);
  const preferredGeneratorPanelDock = selectedGenerator
    ? generatorPanelDockDrag?.nodeId === selectedGenerator.id
      ? generatorPanelDockDrag.dock
      : normalizeGeneratorPanelDock(selectedGenerator.data.generatorPanelDock || selectedGenerator.data.comfyPanelDock)
    : 'bottom';
  const generatorPanelLayerRef = useRef<HTMLDivElement>(null);
  const [generatorPanelMeasuredHeight, setGeneratorPanelMeasuredHeight] = useState(560);
  const [generatorPanelPosition, setGeneratorPanelPosition] = useState<{
    left: number;
    top: number;
    width?: number;
    maxHeight: number;
    dock: GeneratorPanelDock;
    panelPlacement: 'above' | 'below' | 'left' | 'right';
  } | null>(null);
  useLayoutEffect(() => {
    const area = flowAreaRef.current;
    if (!selectedGenerator || !area) {
      setGeneratorPanelPosition(null);
      return;
    }
    if (mobileCanvas.mobile) {
      setGeneratorPanelPosition((current) => current?.dock === 'bottom' && current.width === mobileCanvas.width - 16 && current.maxHeight === mobileCanvas.sheetHeight
        ? current : { left: 8, top: 0, width: mobileCanvas.width - 16, maxHeight: mobileCanvas.sheetHeight, dock: 'bottom', panelPlacement: 'below' });
      return;
    }
    const nodeElement = Array.from(area.querySelectorAll<HTMLElement>('.react-flow__node'))
      .find((element) => element.dataset.id === selectedGenerator.id);
    const bounds = area.getBoundingClientRect();
    const screenNodeBounds = nodeElement?.getBoundingClientRect();
    const nodeWidth = selectedGenerator.measured?.width || selectedGenerator.width || 390;
    const nodeHeight = selectedGenerator.measured?.height || selectedGenerator.height || 230;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const fallbackNodeBounds = {
      left: bounds.left + viewport.x + selectedGenerator.position.x * viewport.zoom,
      right: bounds.left + viewport.x + (selectedGenerator.position.x + nodeWidth) * viewport.zoom,
      top: bounds.top + viewport.y + selectedGenerator.position.y * viewport.zoom,
      bottom: bounds.top + viewport.y + (selectedGenerator.position.y + nodeHeight) * viewport.zoom,
    };
    const position = generatorPanelDockPosition({
      bounds: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height },
      nodeBounds: screenNodeBounds || fallbackNodeBounds,
      preferredDock: preferredGeneratorPanelDock,
      panelWidth: generatorEditorPanelWidth,
      panelHeight: generatorPanelMeasuredHeight,
      viewportHeight,
    });
    setGeneratorPanelPosition((current) => current
      && Math.abs(current.left - position.left) < .5
      && Math.abs(current.top - position.top) < .5
      && Math.abs((current.width || 0) - (position.width || 0)) < .5
      && Math.abs(current.maxHeight - position.maxHeight) < .5
      && current.dock === position.dock
      && current.panelPlacement === position.panelPlacement
      ? current
      : { left: position.left, top: position.top, ...(position.width ? { width: position.width } : {}), maxHeight: position.maxHeight, dock: position.dock, panelPlacement: position.panelPlacement });
  }, [generatorPanelMeasuredHeight, preferredGeneratorPanelDock, selectedGenerator, viewport, viewportSize, mobileCanvas.mobile, mobileCanvas.width, mobileCanvas.sheetHeight]);
  useLayoutEffect(() => {
    if (!selectedGenerator || !generatorPanelPosition) return;
    const element = generatorPanelLayerRef.current;
    if (!element) return;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      if (height > 0) setGeneratorPanelMeasuredHeight((current) => Math.abs(current - height) < .5 ? current : height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [generatorPanelPosition?.dock, selectedGenerator?.id]);
  const characterGeneratorPanelPosition = useMemo(() => {
    if (!selectedCharacterGenerator || !flowAreaRef.current) return null;
    const bounds = flowAreaRef.current.getBoundingClientRect();
    const position = characterGeneratorEditorPanelPosition({
      bounds,
      viewport,
      node: {
        position: selectedCharacterGenerator.position,
        width: selectedCharacterGenerator.measured?.width || 680,
        height: selectedCharacterGenerator.measured?.height || 520,
      },
      viewportSize,
    });
    return { left: position.left, top: position.top, width: position.width, height: position.height };
  }, [selectedCharacterGenerator, viewport, viewportSize]);
  const createCollageFromSelection = useCallback(async (nodeIds: readonly string[]) => {
    if (collageCreatingRef.current) { setToast('正在制作上一张拼图，请稍候'); return; }
    const selectedIds = new Set(nodeIds);
    const sources = orderImageCollageSources(nodesRef.current
      .filter((node) => selectedIds.has(node.id))
      .flatMap((node) => {
        const image = clipboardImageForNode(node);
        return image ? [{
          id: node.id,
          title: node.data.title || '图片',
          mediaUrl: image.mediaUrl,
          x: node.position.x,
          y: node.position.y,
          width: nodeWidth(node),
          height: nodeHeight(node),
        }] : [];
      }));
    if (sources.length < 2) { setToast('请至少框选两张已经生成或上传的图片'); return; }
    if (sources.length > 24) { setToast('单张拼图最多支持 24 张图片，请分两次整理'); return; }
    collageCreatingRef.current = true;
    setToast(`正在读取并整理 ${sources.length} 张图片...`);
    const entries: ImageCollageEntry[] = [];
    let collageNodeId = '';
    try {
      for (const source of sources) entries.push({ ...source, bitmap: await loadImageCollageBitmap(source.mediaUrl) });
      const collage = await createImageCollage(entries);
      const stamp = Date.now();
      collageNodeId = `image-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
      const fileName = `review-collage-${stamp}.jpg`;
      const file = new File([collage.blob], fileName, { type: 'image/jpeg' });
      const displayWidth = Math.min(760, Math.max(520, collage.width / 8));
      const displayHeight = mediaNodeHeight(displayWidth, collage.width, collage.height);
      const maxRight = Math.max(...sources.map((source) => source.x + source.width));
      const minTop = Math.min(...sources.map((source) => source.y));
      const collageNode: CanvasNode = {
        id: collageNodeId,
        type: 'image',
        selected: true,
        position: { x: maxRight + 96, y: minTop },
        width: displayWidth,
        height: displayHeight,
        measured: { width: displayWidth, height: displayHeight },
        style: { width: displayWidth, height: displayHeight },
        data: {
          kind: 'image',
          title: `评审拼图 · ${sources.length}张`,
          outputType: 'image',
          mediaType: 'image',
          mediaWidth: collage.width,
          mediaHeight: collage.height,
          fileName,
          status: '正在保存拼图',
        } as CanvasNodeData,
      };
      pushHistory();
      setNodes((current) => {
        const next = [...current.map((node) => ({ ...node, selected: false })), collageNode];
        nodesRef.current = next;
        return next;
      });
      const body = new FormData();
      body.append('file', file, fileName);
      const response = await apiFetch(`/api/v1/canvas/${encodeURIComponent(task.taskId)}/assets`, { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '拼图保存失败');
      setNodes((current) => {
        const next = current.map((node) => node.id === collageNodeId ? {
          ...node,
          data: { ...node.data, mediaUrl: payload.url, previewUrl: payload.previewUrl, fileName: payload.originalName || fileName, mediaWidth: Number(payload.width) || undefined, mediaHeight: Number(payload.height) || undefined, status: '拼图已生成，可右键下载' },
        } : node);
        nodesRef.current = next;
        return next;
      });
      setToast(`已将 ${sources.length} 张图片拼成一张评审大图`);
    } catch (error) {
      if (collageNodeId) setNodes((current) => {
        const next = current.filter((node) => node.id !== collageNodeId);
        nodesRef.current = next;
        return next;
      });
      setToast(error instanceof Error ? error.message : '拼图生成失败');
    } finally {
      entries.forEach((entry) => entry.bitmap.close());
      collageCreatingRef.current = false;
    }
  }, [apiFetch, pushHistory, setNodes, task.taskId]);
  const importMediaFiles = useCallback(async (files: Iterable<File>, point?: { x: number; y: number }) => {
    const candidates = Array.from(files);
    const supported = candidates.map((file) => ({ file: normalizedCanvasMediaFile(file), kind: canvasMediaKind(file) }))
      .filter((item): item is { file: File; kind: CanvasMediaKind } => item.kind !== null);
    if (!supported.length) {
      if (candidates.length) setToast('未识别到可导入的图片或视频。支持 PNG、JPG、WEBP、GIF、MP4、WEBM、MOV。');
      return 0;
    }
    const base = point || flow.screenToFlowPosition({ x: pointerRef.current.x, y: pointerRef.current.y });
    setToast(`正在导入 ${supported.length} 个素材...`);
    const created = supported.map(({ file, kind }, index) => {
      const position = centeredMediaNodePosition(base, kind, index * 340);
      const screen = flow.flowToScreenPosition(position);
      return { file, id: addNode(kind, screen.x, screen.y, undefined, true) };
    });
    const results = await Promise.all(created.map(({ id, file }) => uploadAsset(id, file)));
    const imported = results.filter(Boolean).length;
    setToast(imported === supported.length ? `已导入 ${imported} 个素材` : `已导入 ${imported}/${supported.length} 个素材，其余上传失败`);
    return imported;
  }, [addNode, flow, uploadAsset]);
  const openUpload = useCallback((point?: { x: number; y: number }) => {
    if (shareMode && !publicMode) { setToast('外部分享模式暂不允许上传素材'); return; }
    uploadPointRef.current = point || flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    uploadInputRef.current?.click();
  }, [flow, shareMode]);
  const uploadFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const point = uploadPointRef.current || flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    uploadPointRef.current = null;
    void importMediaFiles(files, point);
  }, [flow, importMediaFiles]);
  const reportExternalClipboard = useCallback((clipboard: DataTransfer) => {
    const html = clipboard.getData('text/html');
    const text = clipboard.getData('text/plain').trim();
    if (/<img\b/i.test(html) || /^https?:\/\//i.test(text)) setToast('检测到网页图片地址。当前浏览器可能受登录或跨域限制，请保存图片后拖入或上传。');
    else setToast('未检测到可导入的图片、视频或音频文件');
  }, []);
  const onCanvasPaste = useCallback((event: ClipboardEvent) => {
    if (isEditableEventTarget(event.target)) return;
    if (handledCanvasPasteRef.current) return;
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const transferredNodes = parseCanvasClipboardPayload(clipboard.getData(canvasNodeClipboardFormat));
    if (transferredNodes) clipboardRef.current = transferredNodes;
    const files = Array.from(clipboard.files).filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/'));
    if (!files.length) {
      const itemFiles = Array.from(clipboard.items)
        .filter((item) => item.type.startsWith('image/') || item.type.startsWith('video/') || item.type.startsWith('audio/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      files.push(...itemFiles);
    }
    const source = canvasPasteSource(clipboard.getData('text/plain'), Array.from(clipboard.types), files.length > 0, Boolean(transferredNodes || clipboardRef.current.nodes.length), !publicMode && !shareMode);
    if (source === 'nodes') {
      event.preventDefault();
      const mode = keyboardPasteModeRef.current;
      keyboardPasteModeRef.current = 'full';
      void pasteNodes(flow.screenToFlowPosition(pointerRef.current), mode);
    } else if (source === 'media') {
      handledCanvasPasteRef.current = true;
      window.setTimeout(() => { handledCanvasPasteRef.current = false; }, 0);
      event.preventDefault();
      keyboardPasteModeRef.current = 'full';
      void importMediaFiles(files);
    } else {
      keyboardPasteModeRef.current = 'full';
      reportExternalClipboard(clipboard);
    }
  }, [flow, importMediaFiles, pasteNodes, publicMode, reportExternalClipboard, shareMode]);
  const importLibraryAsset = useCallback(async (assetId: string, point: { x: number; y: number }) => {
    if (importingAssetIds.includes(assetId)) return;
    setImportingAssetIds((current) => [...current, assetId]);
    try {
      const response = await fetch(`/api/v1/canvas/${encodeURIComponent(task.taskId)}/assets/from-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, project: task.project }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '导入资产失败');
      const screen = flow.flowToScreenPosition(point);
      const nodeId = addNode('image', screen.x, screen.y);
      updateNode(nodeId, {
        title: payload.displayName || payload.originalName || 'AI 资产',
        mediaUrl: payload.url,
        previewUrl: payload.previewUrl,
        mediaType: 'image',
        outputType: 'image',
        fileName: payload.originalName || payload.displayName,
        mediaWidth: Number(payload.width) || undefined,
        mediaHeight: Number(payload.height) || undefined,
        status: '已从 AI 资产库导入',
      });
      setToast('已导入为任务图片节点');
    } catch (error) {
      setToast(error instanceof Error ? error.message : '导入资产失败');
    } finally {
      setImportingAssetIds((current) => current.filter((id) => id !== assetId));
    }
  }, [addNode, flow, importingAssetIds, task.project, task.taskId, updateNode]);
  const loadAssetLibrary = useCallback(async () => {
    if (!task.project || task.project === '未指定项目') {
      setLibraryError('当前任务未提供项目，无法读取项目资产');
      setLibraryAssets([]);
      return;
    }
    setLibraryLoading(true);
    setLibraryError('');
    try {
      const response = await fetch(`/api/v1/asset-library?project=${encodeURIComponent(task.project)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '资产库加载失败');
      setLibraryAssets(Array.isArray(payload.items) ? payload.items : []);
    } catch (error) {
      setLibraryAssets([]);
      setLibraryError(error instanceof Error ? error.message : '资产库加载失败');
    } finally {
      setLibraryLoading(false);
    }
  }, [task.project]);
  const openAssetLibrary = useCallback(() => {
    if (publicMode) { setToast('访客工作区暂不提供团队资产库'); return; }
    if (shareMode) { setToast('分享模式暂不提供团队资产库'); return; }
    setShowAssetLibrary(true);
    void loadAssetLibrary();
  }, [loadAssetLibrary, publicMode, shareMode]);
  const onAssetDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>, asset: LibraryAsset) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/ai-canvas-asset', JSON.stringify({ assetId: asset.id }));
  }, []);
  const onAssetDragEnd = useCallback(() => setShowAssetLibrary(false), []);
  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const assetPayload = event.dataTransfer.getData('application/ai-canvas-asset');
    if (assetPayload) {
      try {
        const parsed = JSON.parse(assetPayload) as { assetId?: unknown };
        if (typeof parsed.assetId !== 'string' || !parsed.assetId) throw new Error('资产信息无效');
        void importLibraryAsset(parsed.assetId, point);
      } catch (error) {
        setToast(error instanceof Error ? error.message : '资产信息无效');
      }
      return;
    }
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) {
      files.push(...Array.from(event.dataTransfer.items).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((file): file is File => file !== null));
    }
    if (files.length) {
      void importMediaFiles(files, point);
      return;
    }
    const kind = event.dataTransfer.getData('application/ai-canvas');
    if (isCanvasNodeKind(kind)) addNode(kind, event.clientX, event.clientY);
    else if (event.dataTransfer.types.includes('text/uri-list') || event.dataTransfer.types.includes('text/html')) setToast('检测到网页图片地址。请保存图片后拖入或上传。');
  }, [addNode, flow, importLibraryAsset, importMediaFiles]);
  const onCanvasDragOver = useCallback((event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types);
    if (!types.includes('Files') && !types.includes('application/ai-canvas') && !types.includes('application/ai-canvas-asset')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, []);
  useEffect(() => {
    if (!showAssetLibrary) return;
    void loadAssetLibrary();
  }, [loadAssetLibrary, showAssetLibrary]);
  useEffect(() => {
    // Blank-canvas clicks leave focus on document.body, so capture at document level instead of the flow container.
    document.addEventListener('paste', onCanvasPaste, true);
    return () => document.removeEventListener('paste', onCanvasPaste, true);
  }, [onCanvasPaste]);
  const clearPublicWorkspace = useCallback(async () => {
    if (!publicMode) return;
    const confirmed = await requestCanvasConfirmation({
      eyebrow: 'IRREVERSIBLE', title: '清空当前工作区', tone: 'danger', confirmLabel: '确认清空',
      message: '当前外部工作区中的画布与素材将被永久清空，此操作无法撤销。',
    });
    if (!confirmed) return;
    try {
      const response = await apiFetch('/api/public/workspace', { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '清空工作区失败');
      window.location.reload();
    } catch (error) {
      setToast(error instanceof Error ? error.message : '清空工作区失败');
    }
  }, [apiFetch, publicMode, requestCanvasConfirmation]);

  const publicGenerationSummary = useMemo(() => {
    const running = nodes.filter((node) => node.data.jobState === 'queued' || node.data.jobState === 'running' || node.data.jobState === 'cancelling').length;
    const failed = nodes.filter((node) => node.data.jobState === 'failed').length;
    if (running) return `${running} 项正在生成，可继续编辑画布`;
    if (failed) return `${failed} 项未完成，可在对应节点重试`;
    return '';
  }, [nodes]);

  const fitReadable = useCallback(() => {
    flow.fitView({ padding: 0.12, duration: 180, minZoom: 0.65, maxZoom: 1.15 });
  }, [flow]);
  const libraryAssetGroups = useMemo<LibraryAssetGroup[]>(() => {
    const groups = new Map<string, LibraryAssetGroup>();
    libraryAssets.forEach((asset) => {
      const id = asset.groupId || `asset:${asset.id}`;
      const group = groups.get(id) || { id, name: asset.groupName || asset.name || '未命名资产', variants: [] };
      group.variants.push(asset);
      groups.set(id, group);
    });
    return Array.from(groups.values()).map((group) => ({
      ...group,
      variants: [...group.variants].sort((a, b) => Number(Boolean(b.isGroupCover)) - Number(Boolean(a.isGroupCover))),
    }));
  }, [libraryAssets]);
  const visibleAssetCategoryOptions = useMemo(() => assetCategoryOptions.filter((category) => (
    libraryAssetGroups.some((group) => group.variants.some((asset) => assetContentCategory(asset) === category.id))
  )), [libraryAssetGroups]);
  useEffect(() => {
    if (!visibleAssetCategoryOptions.some((category) => category.id === assetCategory)) {
      setAssetCategory(visibleAssetCategoryOptions[0]?.id || 'uncategorized');
    }
  }, [assetCategory, visibleAssetCategoryOptions]);
  const filteredLibraryAssetGroups = useMemo(() => {
    return libraryAssetGroups.map((group) => {
      const variants = group.variants.filter((asset) => assetContentCategory(asset) === assetCategory);
      return variants.length ? { ...group, variants } : null;
    }).filter((group): group is LibraryAssetGroup => Boolean(group));
  }, [assetCategory, libraryAssetGroups]);
  useEffect(() => {
    if (!showAssetLibrary) return;
    const list = assetListRef.current;
    if (!list) return;
    const updateScrollHint = () => {
      const canScroll = list.scrollHeight > list.clientHeight + 1;
      setAssetListCanScroll(canScroll);
      setAssetListAtEnd(!canScroll || list.scrollTop + list.clientHeight >= list.scrollHeight - 2);
    };
    updateScrollHint();
    const observer = new ResizeObserver(updateScrollHint);
    observer.observe(list);
    return () => observer.disconnect();
  }, [filteredLibraryAssetGroups, showAssetLibrary]);
  const connectedNodeSides = useMemo(() => {
    const sides = new Map<string, { incoming: boolean; outgoing: boolean }>();
    edges.forEach((edge) => {
      sides.set(edge.source, { ...(sides.get(edge.source) || { incoming: false, outgoing: false }), outgoing: true });
      sides.set(edge.target, { ...(sides.get(edge.target) || { incoming: false, outgoing: false }), incoming: true });
    });
    return sides;
  }, [edges]);
  const referenceSignatureCache = useMemo(() => createCanvasMetadataCache(canvasReferenceGraphSignatures), []);
  const referenceGraphSignatures = useMemo(() => referenceSignatureCache(nodes, edges), [edges, nodes, referenceSignatureCache]);
  const packageOwnershipSignature = useMemo(() => canvasPackageOwnershipSignature(nodes), [nodes]);
  const packageLayerSignature = useMemo(() => nodes.map((node) => `${node.id}:${node.data.kind}:${node.zIndex || 0}:${(node.data.memberIds || []).join(',')}`).join('|'), [nodes]);
  const edgePackageOwners = useMemo(() => canvasEdgePackageOwners(nodes), [packageOwnershipSignature]);
  const renderedPackageLayers = useMemo(() => canvasNodePackageLayers(nodes), [packageLayerSignature]);
  const renderedNodeCacheRef = useRef(new Map<string, {
    sourceNode: CanvasNode;
    attachActions: unknown;
    zIndex: number;
    incoming?: boolean;
    outgoing?: boolean;
    collectionRuntime?: unknown;
    connectionGuideType?: DataType;
    singleNodeSelected: boolean;
    inlineRenaming: boolean;
    mediaLodLevel: CanvasMediaLodLevel;
    referenceGraphSignature: string;
    setCollectionCollapsed: unknown;
    runCollection: unknown;
    rendered: CanvasNode;
  }>());
  const renderedNodes = useMemo(() => {
    const nextCache = new Map<string, typeof renderedNodeCacheRef.current extends Map<string, infer Entry> ? Entry : never>();
    const rendered = nodes.filter((node) => !workflows.collapsedMemberIds.has(node.id)).map((node) => {
      const sides = connectedNodeSides.get(node.id);
      const collectionRuntime = node.data.kind === 'collection' ? workflows.collectionRuntime.get(node.id) : undefined;
      const zIndex = renderedPackageLayers.get(node.id) || (node.data.kind === 'collection' ? 1 : 2);
      const usesReferences = nodeUsesReferenceGraph(node.data.kind);
      const nodeReferenceSignature = usesReferences ? referenceGraphSignatures.get(node.id) || '' : '';
      const cached = renderedNodeCacheRef.current.get(node.id);
      const singleNodeSelected = node.id === singleSelectedNodeId;
      const connectionGuideType = passiveConnectionGuideType(node.id, singleSelectedNodeId, selectedConnectionGuideType);
      const inlineRenaming = node.id === renamingNodeId;
      if (cached
        && cached.sourceNode === node
        && cached.attachActions === attachActions
        && cached.zIndex === zIndex
        && cached.incoming === sides?.incoming
        && cached.outgoing === sides?.outgoing
        && cached.collectionRuntime === collectionRuntime
        && cached.connectionGuideType === connectionGuideType
        && cached.singleNodeSelected === singleNodeSelected
        && cached.inlineRenaming === inlineRenaming
        && cached.mediaLodLevel === mediaLodLevel
        && cached.referenceGraphSignature === nodeReferenceSignature
        && cached.setCollectionCollapsed === workflows.setCollectionCollapsed
        && cached.runCollection === workflows.runCollection) {
        nextCache.set(node.id, cached);
        return cached.rendered;
      }
      const prepared = attachActions({
        ...node,
...(node.data.kind === 'collection' ? { dragHandle: '.collection-node', zIndex, height: Math.max(Number(node.height) || 124, 84 + (collectionRuntime?.collectionInputs.length || 0) * 40), style: { ...node.style, height: Math.max(Number(node.height) || 124, 84 + (collectionRuntime?.collectionInputs.length || 0) * 40), width: node.width } } : { zIndex }),
        data: {
          ...node.data, ...collectionRuntime, connectionGuideType, singleNodeSelected, inlineRenaming, mediaLodLevel,
          hasIncomingConnection: sides?.incoming, hasOutgoingConnection: sides?.outgoing,
          onSetCollectionCollapsed: workflows.setCollectionCollapsed, onRunCollection: workflows.runCollection,
        },
      }, { nodes, edges });
      nextCache.set(node.id, {
        sourceNode: node,
        attachActions,
        zIndex,
        incoming: sides?.incoming,
        outgoing: sides?.outgoing,
        collectionRuntime,
        connectionGuideType,
        singleNodeSelected,
        inlineRenaming,
        mediaLodLevel,
        referenceGraphSignature: nodeReferenceSignature,
        setCollectionCollapsed: workflows.setCollectionCollapsed,
        runCollection: workflows.runCollection,
        rendered: prepared,
      });
      return prepared;
    });
    renderedNodeCacheRef.current = nextCache;
    return rendered;
  }, [attachActions, connectedNodeSides, mediaLodLevel, nodes, referenceGraphSignatures, renderedPackageLayers, renamingNodeId, selectedConnectionGuideType, singleSelectedNodeId, workflows.collapsedMemberIds, workflows.collectionRuntime, workflows.runCollection, workflows.setCollectionCollapsed]);
  const handleLayoutSignatures = useMemo(() => new Map(renderedNodes.map((node) => [node.id, canvasNodeHandleLayoutSignature(node)])), [renderedNodes]);
  const previousHandleLayoutSignatures = useRef(new Map<string, string>());
  useEffect(() => {
    const changedIds = renderedNodes
      .filter((node) => previousHandleLayoutSignatures.current.get(node.id) !== handleLayoutSignatures.get(node.id))
      .map((node) => node.id);
    previousHandleLayoutSignatures.current = handleLayoutSignatures;
    if (!changedIds.length) return;
    const frame = window.requestAnimationFrame(() => updateNodeInternals(changedIds));
    return () => window.cancelAnimationFrame(frame);
  }, [handleLayoutSignatures, renderedNodes, updateNodeInternals]);

  const selectedPath = useMemo(() => {
    if (!singleSelectedNodeId) return null;
    const edgeIds = new Set<string>();
    const visitUpstream = (id: string) => edges.forEach((edge) => { if (edge.target === id && !edgeIds.has(edge.id)) { edgeIds.add(edge.id); visitUpstream(edge.source); } });
    const visitDownstream = (id: string) => edges.forEach((edge) => { if (edge.source === id && !edgeIds.has(edge.id)) { edgeIds.add(edge.id); visitDownstream(edge.target); } });
    visitUpstream(singleSelectedNodeId); visitDownstream(singleSelectedNodeId);
    return { edgeIds };
  }, [edges, singleSelectedNodeId]);
  const collapsedCollectionByMember = useMemo(() => {
    const collectionByMember = new Map<string, string>();
    nodes.forEach((node) => {
      if (node.data.kind !== 'collection' || !node.data.collapsed) return;
      (node.data.memberIds || []).forEach((memberId) => collectionByMember.set(memberId, node.id));
    });
    return collectionByMember;
  }, [nodes]);
  const collectionInputProxyByEdge = useMemo(() => {
    const proxies = new Map<string, { collectionId: string; slotId: string }>();
    workflows.collectionRuntime.forEach((runtime, collectionId) => runtime.collectionInputs.forEach((slot) => {
      slot.boundaryEdgeIds.forEach((edgeId) => proxies.set(edgeId, { collectionId, slotId: slot.id }));
    }));
    return proxies;
  }, [workflows.collectionRuntime]);
  const renderedEdges = useMemo(() => {
    const proxyEndpoints = new Set<string>();
    const renderedInputSlots = new Set<string>();
    return edges.flatMap((edge) => {
      const sourceCollectionId = collapsedCollectionByMember.get(edge.source);
      const inputProxy = collectionInputProxyByEdge.get(edge.id);
      const targetCollectionId = inputProxy?.collectionId || collapsedCollectionByMember.get(edge.target);
      const source = sourceCollectionId || edge.source;
      const target = targetCollectionId || edge.target;
      if (source === target) return [];
      const isCollectionProxy = Boolean(sourceCollectionId || targetCollectionId);
      const sourceHandle = sourceCollectionId ? 'collection-output' : edge.sourceHandle;
      const targetHandle = inputProxy
        ? `collection-input-slot:${inputProxy.slotId}`
        : targetCollectionId ? 'collection-input' : edge.targetHandle;
      if (inputProxy) {
        const inputSlotKey = `${target}:${targetHandle}`;
        if (renderedInputSlots.has(inputSlotKey)) return [];
        renderedInputSlots.add(inputSlotKey);
      }
      if (isCollectionProxy) {
        const endpointKey = `${source}:${sourceHandle || ''}->${target}:${targetHandle || ''}`;
        if (proxyEndpoints.has(endpointKey)) return [];
        proxyEndpoints.add(endpointKey);
      }
      return [{
        ...edge,
        source,
        target,
        sourceHandle,
        targetHandle,
        zIndex: canvasEdgePackageLayer(edge, edgePackageOwners, renderedPackageLayers),
        data: { ...(edge.data || {}), collectionProxy: isCollectionProxy },
        reconnectable: isCollectionProxy ? false : edge.reconnectable,
        className: [stripPathClassName(edge.className), isCollectionProxy ? 'collection-proxy-edge' : '', selectedPath ? (selectedPath.edgeIds.has(edge.id) ? 'path-active' : 'path-muted') : ''].filter(Boolean).join(' ') || undefined,
      } as Edge];
    });
  }, [collapsedCollectionByMember, collectionInputProxyByEdge, edgePackageOwners, edges, renderedPackageLayers, selectedPath]);

  const reloadModels = useCallback(async () => {
    const [modelResponse, resourceResponse] = await Promise.all([
      apiFetch('/api/v1/models'),
      apiFetch('/api/v1/comfyui/resources').catch(() => null),
    ]);
    const payload = await readApiJson(modelResponse);
    if (!modelResponse.ok) throw new Error(payload.error || '模型加载失败');
    const resourcePayload = resourceResponse?.ok ? await readApiJson(resourceResponse) as ComfyUiLocalResourceInventory : null;
    setModels(mergeComfyUiLocalResources(payload.models || [], resourcePayload));
  }, [apiFetch]);

  useEffect(() => {
    if (!ready || publicMode || shareMode) return;
    let cancelled = false;
    apiFetch('/api/v1/comfyui/resources').then(async (response) => {
      if (!response.ok) return;
      const resourcePayload = await readApiJson(response) as ComfyUiLocalResourceInventory;
      if (!cancelled) setModels((current) => mergeComfyUiLocalResources(current, resourcePayload));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [apiFetch, publicMode, ready, shareMode, setModels]);

  const contextMenuNode = contextMenu ? nodes.find((node) => node.id === contextMenu.nodeId) : undefined;
  const contextMenuCollectionIssue = contextMenu?.nodeIds.length && contextMenu.nodeIds.length > 1
    ? collectionCreationIssue(nodes, contextMenu.nodeIds)
    : '';
  const contextMenuImage = clipboardImageForNode(contextMenuNode, contextMenu?.imageUrl);
  const contextMenuVideo = downloadableVideoForNode(contextMenuNode, contextMenu?.videoUrl);
  const contextMenuTaskId = contextMenu?.nodeIds.length === 1 ? nodeTaskIdForTrace(contextMenuNode?.data) : '';
  const contextMenuCollageImageCount = contextMenu ? contextMenu.nodeIds.reduce((count, nodeId) => count + (clipboardImageForNode(nodes.find((node) => node.id === nodeId)) ? 1 : 0), 0) : 0;
  const contextMenuCollection = contextMenu && contextMenuNode?.data.kind !== 'collection' ? workflows.collectionForNode(contextMenu.nodeId) : undefined;
  const contextMenuHasConnections = Boolean(contextMenu && edges.some((edge) => edge.source === contextMenu.nodeId || edge.target === contextMenu.nodeId));
  const contextMenuOpensLeft = Boolean(contextMenu && contextMenu.clientX > window.innerWidth - 440);
  return <main data-agent-open={agentOpen && !shareMode || undefined} data-agent-canvas={agentCanvasView || undefined} data-theme={canvasTheme} data-language={canvasLanguage} data-mobile={mobileCanvas.mobile || undefined} data-mobile-keyboard={mobileCanvas.mobile && mobileCanvas.keyboard || undefined} style={mobileCanvas.mobile ? { '--mobile-visible-height': `${mobileCanvas.height}px`, '--mobile-bottom-inset': `${mobileCanvas.bottom}px`, '--mobile-sheet-height': `${mobileCanvas.sheetHeight}px` } as CSSProperties : undefined} className={`app-shell${hasTaskContext ? '' : ' is-task-unbound'}${publicMode ? ' is-public' : ''}${comfyUiEditor ? ' is-comfyui-editor-open' : ''}`}>
    <GlobalTooltip />
    {showCanvasLoader && <CanvasBootLoader leaving={canvasLoaderLeaving} failed={!ready && saveState === '保存失败'} taskTitle={task.title} />}
    <header className="topbar">
      {!publicMode && !shareMode ? <div className="canvas-top-left-controls">
        <div className={`canvas-app-menu-shell${canvasAppMenuOpen ? ' is-open' : ''}`}>
          <button className="canvas-app-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={canvasAppMenuOpen} aria-label="打开主菜单" title="菜单" onClick={() => { setCanvasAppMenuOpen((value) => !value); setCanvasBoardMenuOpen(false); }}><UiIcon name="menu" /></button>
          {canvasAppMenuOpen && <section className="canvas-board-menu canvas-app-menu" role="menu" aria-label="主菜单">
            <section className="canvas-board-menu-section" aria-labelledby="canvas-menu-navigation-title">
              <header className="canvas-board-menu-section-title"><strong id="canvas-menu-navigation-title">菜单</strong></header>
              <nav className="canvas-board-menu-nav" aria-label="全局菜单">
                <a href="/" role="menuitem" onClick={() => setCanvasAppMenuOpen(false)}><UiIcon name="home" /><span>主页</span></a>
                <a href="https://github.com/castleinmysky/echo-canvas#readme" target="_blank" rel="noreferrer noopener" role="menuitem"><UiIcon name="document" /><span>使用文档</span><UiIcon name="external" /></a>
              </nav>
            </section>
            <section className="canvas-board-menu-section" aria-labelledby="canvas-menu-file-title">
              <header className="canvas-board-menu-section-title"><strong id="canvas-menu-file-title">文件</strong></header>
              <div className="canvas-board-menu-actions" role="group" aria-label="文件操作">
                <button type="button" role="menuitem" onClick={() => { setCanvasAppMenuOpen(false); setShowGeneratedAssetHistory(true); }}><UiIcon name="history" /><span>生成历史</span></button>
                <button type="button" role="menuitem" onClick={() => { setCanvasAppMenuOpen(false); openUpload(); }}><UiIcon name="upload" /><span>导入本地素材</span></button>
                <button type="button" role="menuitem" onClick={exportCurrentCanvas}><UiIcon name="download" /><span>导出当前画布</span></button>
              </div>
            </section>
            <section className="canvas-board-menu-section" aria-labelledby="canvas-menu-edit-title">
              <header className="canvas-board-menu-section-title"><strong id="canvas-menu-edit-title">编辑</strong></header>
              <div className="canvas-board-menu-actions" role="group" aria-label="编辑操作">
                <button type="button" role="menuitem" disabled={!historyRef.current.length} onClick={() => { undo(); setCanvasAppMenuOpen(false); }}><UiIcon name="undo" /><span>撤销</span><kbd>Ctrl Z</kbd></button>
                <button type="button" role="menuitem" disabled={!futureRef.current.length} onClick={() => { redo(); setCanvasAppMenuOpen(false); }}><UiIcon name="redo" /><span>重做</span><kbd>Ctrl Shift Z</kbd></button>
              </div>
            </section>
          </section>}
        </div>
        <div className={`canvas-board-switcher${canvasBoardMenuOpen ? ' is-open' : ''}`}>
          <button className="canvas-board-trigger" type="button" aria-haspopup="menu" aria-expanded={canvasBoardMenuOpen} aria-label={`当前画布：${activeCanvasBoard.title}`} onClick={() => { setCanvasBoardMenuOpen((value) => !value); setCanvasAppMenuOpen(false); }}>
            <span className="canvas-board-trigger-copy"><strong>{activeCanvasBoard.title || '主画布'}</strong><span className="canvas-board-trigger-label">画布 {visibleCanvasBoards.length} · 本机</span></span><UiIcon name="chevronDown" className="canvas-board-trigger-chevron" />
          </button>
          {canvasBoardMenuOpen && <section className="canvas-board-menu canvas-board-picker" role="menu" aria-label="画布列表">
            <section className="canvas-board-menu-section" aria-labelledby="canvas-menu-board-title">
              <header className="canvas-board-menu-section-title"><strong id="canvas-menu-board-title">画布</strong><span>{visibleCanvasBoards.length} 张 · 独立保存</span></header>
              <div className="canvas-board-list">{visibleCanvasBoards.map((board) => <button key={board.id} type="button" role="menuitem" className={board.id === activeCanvasId ? 'active' : ''} onClick={() => void switchCanvasBoard(board.id)}><span><strong>{board.title || '未命名画布'}</strong><small>{board.nodeCount} 个节点</small></span><i>{board.id === activeCanvasId ? '当前' : '打开'}</i></button>)}</div>
              <form className="canvas-board-create" onSubmit={(event) => { event.preventDefault(); void createCanvasBoard(); }}>
                <UiIcon name="add" /><input id="new-canvas-board-title" aria-label="新画布名称" value={newCanvasTitle} maxLength={48} placeholder={`新建画布 ${canvasBoards.length + 1}`} onChange={(event) => setNewCanvasTitle(event.target.value)} /><button type="submit" disabled={creatingCanvasBoard}>{creatingCanvasBoard ? '创建中' : '创建'}</button>
              </form>
              <div className="canvas-board-menu-actions canvas-board-danger-action" role="group" aria-label="画布管理">
                <button type="button" role="menuitem" className="danger" disabled={canvasBoardDeleteDisabled} title={activeCanvasId === defaultCanvasBoardId ? '主画布需要保留' : saveState === '正在保存' ? '保存完成后可删除' : undefined} onClick={() => void deleteActiveCanvasBoard()}><UiIcon name="delete" /><span>删除当前画布</span></button>
              </div>
            </section>
          </section>}
        </div>
        <button type="button" className="generated-asset-history-trigger" aria-label="打开生成历史" title="生成历史" onClick={() => { setShowGeneratedAssetHistory(true); setCanvasAppMenuOpen(false); setCanvasBoardMenuOpen(false); }}><UiIcon name="history" /><span>生成历史</span></button>
      </div> : <button className="back-button" onClick={() => history.length > 1 ? history.back() : window.close()}><UiIcon name="back" /> <span>工作空间</span></button>}
      <div className="task-context"><strong>{task.title}</strong><span>{task.project}</span><i /><span>{shareMode ? '外部访客' : task.member}</span></div>
      <div className="canvas-top-right-controls">
      <div className="top-actions heiyan-utility-cluster" role="group" aria-label="画布设置与工具">
        <button type="button" className={`canvas-theme-toggle is-${canvasTheme}`} aria-label={canvasTheme === 'night' ? '切换到白昼模式' : '切换到夜间模式'} title={canvasTheme === 'night' ? '切换到白昼模式' : '切换到夜间模式'} onClick={(event) => transitionCanvasTheme(canvasTheme, setCanvasTheme, event.currentTarget)}><span className="theme-toggle-sky" aria-hidden="true"><span className="theme-toggle-stars"><i /><i /><i /></span><span className="theme-toggle-clouds"><i /><i /></span><span className="theme-toggle-orb"><i /><i /><i /></span></span></button>
        <button type="button" className="canvas-language-toggle ui-icon-button" aria-label={canvasLanguage === 'zh' ? '切换到 English' : '切换到中文'} title={canvasLanguage === 'zh' ? '切换到 English' : '切换到中文'} onClick={() => setCanvasLanguage((current) => current === 'zh' ? 'en' : 'zh')}><UiIcon name="language" /><span aria-hidden="true">{canvasLanguage === 'zh' ? '中' : 'EN'}</span></button>
        <span className="canvas-utility-divider" aria-hidden="true" />
        {shareMode && <span className="share-mode-badge">只读分享</span>}
        {!shareMode && platformAdmin && <button className="settings-center-trigger ui-icon-button" aria-label="打开设置中心" title="设置中心" onClick={() => { setSettingsCenterSection('api'); setShowSettingsCenter(true); }}><UiIcon name="settings" /></button>}
        <span className="canvas-app-version" title="当前开源版本">{canvasAppVersionLabel}</span>
        <a className="canvas-app-github ui-icon-button" href="https://github.com/castleinmysky/echo-canvas" target="_blank" rel="noreferrer noopener" aria-label="打开黑岩 HEIYAN 画布 GitHub 仓库" title="GitHub · 黑岩 HEIYAN 画布"><UiIcon name="github" /></a>
      </div>
      {!shareMode && <button id="canvas-agent-toggle" type="button" className="canvas-agent-toggle" aria-label={agentWorkspace === 'conversation' ? '收起 Agent 会话' : '打开 Agent 会话'} aria-controls="canvas-agent-conversation" aria-expanded={agentOpen} aria-pressed={agentOpen} title="Agent 创作会话" onClick={() => switchAgentWorkspace(toggleAgentWorkspace(agentWorkspace))}><UiIcon name="robot" /><span>Agent</span></button>}
      </div>
      {!shareMode && ['保存冲突', '保存失败', '会话无效'].includes(saveState) && <div className="canvas-save-alert" role="status">{saveState === '保存冲突' ? <><span className="conflict-label">另一窗口有更新，本窗口尚未覆盖</span><button className="reload-button" onClick={() => window.location.reload()}><UiActionContent icon="retry">加载远端</UiActionContent></button><button className="reload-button" onClick={() => void overwriteSaveConflict()}><UiActionContent icon="check">保留本窗口</UiActionContent></button></> : <span className={`save-state state-${saveState}`}><span />{saveState}</span>}</div>}
    </header>
    {!shareMode && platformAdmin && showSettingsCenter && <Suspense fallback={null}><SettingsCenter open={showSettingsCenter} initialSection={settingsCenterSection} onClose={() => setShowSettingsCenter(false)} request={apiFetch} onModelsChanged={reloadModels} version={canvasAppVersionLabel} language={canvasLanguage} /></Suspense>}
    {!shareMode && showGeneratedAssetHistory && <Suspense fallback={null}><GeneratedAssetHistory key={activeCanvasKey} canvasId={activeCanvasId} open={showGeneratedAssetHistory} taskId={task.taskId} request={apiFetch} language={canvasLanguage} modelNames={generatedAssetModelNames} nodeNames={new Map(nodes.map(node => [JSON.stringify([activeCanvasId, node.id]), node.data.title || '']))} onClose={() => setShowGeneratedAssetHistory(false)} onAddToCanvas={addGeneratedAssetToCanvas} /></Suspense>}
    {!shareMode && comfyUiEditor && <ComfyUiEditorDialog state={comfyUiEditor} apiFetch={apiFetch} onClose={closeComfyUiEditor} onRetry={retryComfyUiEditor} onRun={runComfyUiWorkflow} onCanvasSync={syncComfyUiEditorCanvasState} />}
    <section className="studio-layout" inert={!shareMode && agentOpen && agentCompactLayout(mobileCanvas.width) && !agentCanvasView} aria-hidden={!shareMode && agentOpen && agentCompactLayout(mobileCanvas.width) && !agentCanvasView || undefined}><div ref={flowAreaRef} className="flow-area" onClickCapture={(event) => {
      if (!mobileCanvas.mobile || !(event.target instanceof Element) || !event.target.closest('.image-hand-card')) return;
      const nodeId = event.target.closest<HTMLElement>('.react-flow__node')?.dataset.id;
      if (nodeId) { if (nodeId !== singleSelectedNodeId) selectNode(nodeId); else focusMobileNode(nodeId); }
    }} onDropCapture={onDrop} onDragOverCapture={onCanvasDragOver} onDoubleClick={(event) => { if ((event.target as HTMLElement).classList.contains('react-flow__pane')) openNodeMenu(event); }}>
      <HeiyanDotField />
      <ReactFlow className={[isSelecting ? 'selection-active' : '', selectedNodes.length > 1 ? 'multi-selection-active' : selectedNodes.length === 1 ? 'single-selection-active' : '', canvasViewportDetailClass(zoom)].filter(Boolean).join(' ') || undefined} style={{ '--canvas-annotation-scale': canvasViewportAnnotationScale(zoom) } as CSSProperties} nodes={renderedNodes} edges={renderedEdges} nodeTypes={nodeTypes} onNodeClick={(_, node) => { if (mobileCanvas.mobile && node.id === singleSelectedNodeId) focusMobileNode(node.id); }} onlyRenderVisibleElements onSelectionStart={() => setIsSelecting(true)} onSelectionEnd={() => setIsSelecting(false)} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onEdgeDoubleClick={(event, edge) => { event.stopPropagation(); disconnectEdges(new Set([edge.id])); }} onConnect={onConnect} onConnectEnd={onConnectEnd} onReconnectStart={onReconnectStart} onReconnect={onReconnect} onReconnectEnd={onReconnectEnd} isValidConnection={isValidConnection} edgesReconnectable connectionRadius={36} reconnectRadius={26} onSelectionContextMenu={(event, selectedNodes) => { event.preventDefault(); event.stopPropagation(); const selectedIds = selectedNodes.map((node) => node.id); if (!selectedIds.length) return; setContextMenu({ clientX: event.clientX, clientY: event.clientY, nodeId: selectedIds[0], nodeIds: selectedIds }); setPaneMenu(null); setNodeMenu(null); setConnectMenu(null); }} onPaneContextMenu={(event) => { event.preventDefault(); const selectedIds = nodesRef.current.filter((node) => node.selected).map((node) => node.id); if (selectedIds.length > 1) { setContextMenu({ clientX: event.clientX, clientY: event.clientY, nodeId: selectedIds[0], nodeIds: selectedIds }); setPaneMenu(null); } else { const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); setPaneMenu({ clientX: event.clientX, clientY: event.clientY, flowX: point.x, flowY: point.y }); setContextMenu(null); } setNodeMenu(null); setConnectMenu(null); }} onNodeContextMenu={(event, node) => { event.preventDefault(); const selectedIds = node.selected ? nodesRef.current.filter((item) => item.selected).map((item) => item.id) : [node.id]; if (!node.selected) selectNode(node.id); const target = event.target; const mediaSource = target instanceof HTMLElement ? target.dataset.mediaSource : undefined; const mediaKind = target instanceof HTMLElement ? target.dataset.mediaKind : undefined; const imageUrl = selectedIds.length === 1 && target instanceof HTMLImageElement && mediaKind !== 'video' ? mediaSource || target.getAttribute('src') || undefined : undefined; const videoUrl = selectedIds.length === 1 && ((target instanceof HTMLVideoElement) || mediaKind === 'video') ? mediaSource || (target instanceof HTMLVideoElement ? target.currentSrc || target.getAttribute('src') || undefined : undefined) : undefined; setContextMenu({ clientX: event.clientX, clientY: event.clientY, nodeId: node.id, nodeIds: selectedIds, ...(imageUrl ? { imageUrl } : {}), ...(videoUrl ? { videoUrl } : {}) }); setPaneMenu(null); setNodeMenu(null); setConnectMenu(null); }} onPaneClick={() => { window.dispatchEvent(new Event('ai-canvas:pause-videos')); setNodeMenu(null); setPaneMenu(null); setConnectMenu(null); setContextMenu(null); selectNode(''); }} onNodeDragStart={pushHistory} onMove={(_, nextViewport) => viewportPublisher.schedule(nextViewport)} onMoveEnd={(_, nextViewport) => { viewportPublisher.flush(nextViewport); if (ready) { setSaveState('有未保存更改'); setSaveNonce((value) => value + 1); } }} deleteKeyCode={null} {...canvasTouchInteraction(mobileCanvas.touch, touchSelecting)} selectionMode={SelectionMode.Partial} panOnScroll={false} zoomOnScroll={false} zoomOnPinch zoomOnDoubleClick={false} minZoom={canvasMinimumZoom} maxZoom={2.5} defaultViewport={defaultViewport}>
        {showMiniMap && <MiniMap pannable zoomable nodeColor={canvasTheme === 'day' ? '#d0d3d8' : '#697386'} />}
      </ReactFlow>
      {mobileCanvas.mobile && !shareMode && !selectedGenerator && !selectedCharacterGenerator && <nav className="mobile-canvas-tools" aria-label={canvasLanguage === 'en' ? 'Canvas tools' : '画布操作'}>
        <button type="button" onClick={() => { const clientX = window.innerWidth / 2; const clientY = Math.min(mobileCanvas.height / 2, 320); const point = flow.screenToFlowPosition({ x: clientX, y: clientY }); setNodeMenu({ clientX, clientY, flowX: point.x, flowY: point.y }); setNodeQuery(''); setContextMenu(null); }}><UiIcon name="add" /><span>{canvasLanguage === 'en' ? 'Add' : '添加'}</span></button>
        <button type="button" onClick={() => openUpload()}><UiIcon name="upload" /><span>{canvasLanguage === 'en' ? 'Import' : '导入'}</span></button>
        {mobileCanvas.touch && <button type="button" aria-pressed={touchSelecting} onClick={() => setTouchSelecting((value) => !value)}><UiIcon name={touchSelecting ? 'check' : 'view'} /><span>{canvasLanguage === 'en' ? (touchSelecting ? 'Select' : 'Pan') : (touchSelecting ? '框选' : '平移')}</span></button>}
        <button type="button" onClick={fitReadable}><UiIcon name="fit" /><span>{canvasLanguage === 'en' ? 'Fit' : '全览'}</span></button>
        <button type="button" disabled={!selectedNodes.length} onClick={() => { const ids = selectedNodes.map((node) => node.id); if (!ids.length) return; setContextMenu({ clientX: 12, clientY: 120, nodeId: ids[0], nodeIds: ids }); setNodeMenu(null); }}><UiIcon name="more" /><span>{canvasLanguage === 'en' ? 'Actions' : '操作'}</span></button>
      </nav>}
      {mobileCanvas.mobile && (nodeMenu || connectMenu || contextMenu || paneMenu) && <button type="button" className="mobile-menu-dismiss" aria-label={canvasLanguage === 'en' ? 'Close menu' : '关闭菜单'} onClick={() => { setNodeMenu(null); setConnectMenu(null); setContextMenu(null); setPaneMenu(null); }}><UiIcon name="close" /></button>}
      {batchReferenceDrag && <svg className={`batch-reference-wire${activeBatchReferencePlan?.sourceIds.length ? ' is-valid' : batchReferenceDrag.targetId ? ' is-invalid' : ''}`} aria-hidden="true">
        <path d={`M ${batchReferenceDrag.start.x} ${batchReferenceDrag.start.y} C ${batchReferenceDrag.start.x + 72} ${batchReferenceDrag.start.y}, ${batchReferenceDrag.current.x - 72} ${batchReferenceDrag.current.y}, ${batchReferenceDrag.current.x} ${batchReferenceDrag.current.y}`} />
        <circle cx={batchReferenceDrag.current.x} cy={batchReferenceDrag.current.y} r="5" />
      </svg>}
      {agentFeedback && <>
        <div className="agent-canvas-feedback" role="status"><span>{agentFeedback.label}</span>{!!agentFeedback.ids.length && <button type="button" onClick={() => revealAgentNodes(agentFeedback.ids, agentFeedback.label)}>查看变化</button>}<button type="button" aria-label="关闭变化提示" onClick={() => setAgentFeedback(null)}>×</button></div>
        {agentFeedback.ids.slice(0, 80).map(id => { const node = nodes.find(n => n.id === id); if (!node) return null; const b = nodeBounds(node, nodes); return <div key={id} className="agent-canvas-spot" aria-hidden="true" style={{ left: b.x * viewport.zoom + viewport.x, top: b.y * viewport.zoom + viewport.y, width: b.width * viewport.zoom, height: b.height * viewport.zoom }}><span>Agent · {node.data.title || '已更新'}</span></div>; })}
      </>}
      {batchTargetHighlight && <div className={`batch-reference-target-highlight${activeBatchReferencePlan?.sourceIds.length ? ' is-valid' : ' is-invalid'}`} style={batchTargetHighlight} aria-hidden="true" />}
      {!shareMode && batchSelectionHandlePosition && <button
        type="button"
        className={`selection-batch-reference-handle${batchReferenceDrag ? ' is-dragging' : ''}`}
        style={batchSelectionHandlePosition}
        disabled={!selectedReferenceIds.length}
        aria-label={`批量连接 ${selectedReferenceIds.length} 个节点`}
        title={selectedReferenceIds.length ? `拖到目标节点，批量连接 ${selectedReferenceIds.length} 个兼容输出` : '选区内没有可连接的输出端口'}
        onPointerDown={startBatchReferenceDrag}
      ><span>{selectedReferenceIds.length}</span></button>}
      {publicMode && !ready && <div className="public-workspace-state" role="status">
        {publicWorkspaceIssue ? <>
          <strong>工作区暂时不可用</strong>
          <p>{publicWorkspaceIssue}</p>
          <button onClick={() => window.location.reload()}>重新打开</button>
        </> : <>
          <strong>正在准备创作台</strong>
          <p>正在恢复此工作区中的画布与任务。</p>
        </>}
      </div>}
      {publicMode && ready && publicGenerationSummary && <div className="public-workspace-status" role="status">
        {publicGenerationSummary}
      </div>}
      {publicMode && nodes.length === 0 && ready && <div className="empty-canvas public-empty-canvas">
        <span aria-hidden="true">+</span>
        <strong>开始创作</strong>
        <p>从提示词、素材或一张空白画布开始</p>
        <div className="empty-canvas-actions">
          <button className="primary" onClick={() => addNode('imageGenerator', window.innerWidth / 2, window.innerHeight / 2)}><UiActionContent icon="imageGenerate">提示词</UiActionContent></button>
          <button onClick={startBlankCanvas}><UiActionContent icon="add">空白画布</UiActionContent></button>
          <button onClick={() => openUpload()}><UiActionContent icon="upload">上传</UiActionContent></button>
        </div>
      </div>}
      {publicMode && <div className="public-workspace-actions">
        <button onClick={() => void clearPublicWorkspace()} title="清空当前工作区"><UiActionContent icon="clear">清空</UiActionContent></button>
      </div>}
      {nodes.length === 0 && (hasTaskContext && ready ? <div className="empty-canvas"><span aria-hidden="true"><UiIcon name="add" /></span><strong>从这里开始创作</strong><p>选择一个起点，后面都能继续连接</p><div className="empty-canvas-actions"><button className="primary" onClick={startBlankCanvas}><UiActionContent icon="add">空白画布</UiActionContent></button><button onClick={() => openUpload()}><UiActionContent icon="upload">本地素材</UiActionContent></button></div></div> : !hasTaskContext ? <div className="empty-canvas empty-canvas-unbound"><strong>请先选择任务</strong><p>每个任务独立保存一张创作画布</p><button onClick={() => history.length > 1 ? history.back() : window.close()}><UiActionContent icon="back">工作空间</UiActionContent></button></div> : null)}
      {(!agentOpen || !agentCompactLayout(mobileCanvas.width) || agentCanvasView) && selectedGenerator && generatorPanelPosition && <div ref={generatorPanelLayerRef} data-mobile-presets={mobileCanvas.mobile ? mobilePresetsOpen : undefined} data-dock={generatorPanelPosition.dock} className={`generator-panel-layer${selectedGenerator.data.kind === 'modelGenerator' ? ' generator-panel-layer-model' : ''}${selectedGenerator.data.kind === 'comfyUiWorkflow' ? ' generator-panel-layer-comfyui' : ''}${generatorPanelDockDrag?.nodeId === selectedGenerator.id ? ' is-dock-dragging' : ''}`} style={{ left: generatorPanelPosition.left, top: generatorPanelPosition.top, maxHeight: generatorPanelPosition.maxHeight, ...(generatorPanelPosition.width ? { width: generatorPanelPosition.width, maxWidth: generatorPanelPosition.width, '--generator-panel-width': `${generatorPanelPosition.width}px` } : {}) } as CSSProperties}>{mobileCanvas.mobile && <header className="mobile-editor-head"><strong>{selectedGenerator.data.title || (canvasLanguage === 'en' ? 'Generation editor' : '生成编辑器')}</strong><button type="button" className="mobile-presets-toggle" aria-expanded={mobilePresetsOpen} onClick={() => { if (mobileCanvas.keyboard && document.activeElement instanceof HTMLElement) document.activeElement.blur(); setMobilePresetsOpen((value) => !value); }}>{canvasLanguage === 'en' ? 'Presets' : '预设'}</button><button type="button" aria-label={canvasLanguage === 'en' ? 'Node actions' : '节点操作'} onClick={() => setContextMenu({ clientX: 12, clientY: 120, nodeId: selectedGenerator.id, nodeIds: [selectedGenerator.id] })}><UiIcon name="more" /></button><button type="button" aria-label={canvasLanguage === 'en' ? 'Close editor' : '收起编辑器'} onClick={() => selectNode('')}><UiIcon name="chevronDown" /></button></header>}{selectedGenerator.data.kind === 'comfyUiWorkflow'
        ? <ComfyUiWorkflowPanel key={selectedGenerator.id} id={selectedGenerator.id} data={{ ...attachActions(selectedGenerator).data, generatorPanelDock: generatorPanelPosition.dock, generatorPanelDockDragging: generatorPanelDockDrag?.nodeId === selectedGenerator.id }} />
        : <GeneratorEditorPanel key={selectedGenerator.id} id={selectedGenerator.id} data={{ ...attachActions(selectedGenerator).data, generatorPanelDock: generatorPanelPosition.dock, generatorPanelDockDragging: generatorPanelDockDrag?.nodeId === selectedGenerator.id }} />}</div>}
      {selectedCharacterGenerator && characterGeneratorPanelPosition && <div className="generator-panel-layer character-generator-panel-layer" style={characterGeneratorPanelPosition}>{mobileCanvas.mobile && <header className="mobile-editor-head"><strong>{canvasLanguage === 'en' ? 'Character editor' : '角色编辑器'}</strong><button type="button" aria-label={canvasLanguage === 'en' ? 'Node actions' : '节点操作'} onClick={() => setContextMenu({ clientX: 12, clientY: 120, nodeId: selectedCharacterGenerator.id, nodeIds: [selectedCharacterGenerator.id] })}><UiIcon name="more" /></button><button type="button" aria-label={canvasLanguage === 'en' ? 'Close editor' : '收起编辑器'} onClick={() => selectNode('')}><UiIcon name="chevronDown" /></button></header>}<CharacterAnimatorEditorPanel key={selectedCharacterGenerator.id} id={selectedCharacterGenerator.id} data={attachActions(selectedCharacterGenerator).data} /></div>}
      <input ref={uploadInputRef} className="hidden-input" type="file" accept="image/*,video/*,audio/*,.mp3,.wav,.m4a,.aac,.ogg" multiple onChange={(event) => { uploadFiles(event.target.files); event.target.value = ''; }} />
      {!shareMode && showAssetLibrary && <aside className="asset-library-drawer" aria-label="当前项目 AI 资产库">
        <header className="asset-library-head"><strong>导入 AI 资产</strong><button className="ui-icon-button" aria-label="关闭资产库" title="关闭" onClick={() => setShowAssetLibrary(false)}><UiIcon name="close" /></button></header>
        <nav className="asset-library-filters" aria-label="内容形态筛选">{visibleAssetCategoryOptions.map((category) => <button key={category.id} className={assetCategory === category.id ? 'active' : ''} onClick={() => setAssetCategory(category.id)}>{category.label}</button>)}</nav>
        {libraryLoading && <div className="asset-library-state">正在读取项目资产...</div>}
        {!libraryLoading && libraryError && <div className="asset-library-state error"><span>{libraryError}</span><button onClick={() => void loadAssetLibrary()}>重试</button></div>}
        {!libraryLoading && !libraryError && libraryAssets.length === 0 && <div className="asset-library-state">当前项目暂无 AI 图片资产</div>}
        {!libraryLoading && !libraryError && libraryAssets.length > 0 && filteredLibraryAssetGroups.length === 0 && <div className="asset-library-state">当前内容形态暂无 AI 图片资产</div>}
        {!libraryLoading && !libraryError && filteredLibraryAssetGroups.length > 0 && <div className={`asset-library-list${assetListCanScroll && !assetListAtEnd ? ' has-more' : ''}`}>
          <div ref={assetListRef} className="asset-library-grid" onScroll={(event) => {
            const list = event.currentTarget;
            setAssetListAtEnd(list.scrollTop + list.clientHeight >= list.scrollHeight - 2);
          }}>
            {filteredLibraryAssetGroups.map((group) => <AssetLibraryCard key={group.id} group={group} importingAssetIds={importingAssetIds} onDragStart={onAssetDragStart} onDragEnd={onAssetDragEnd} onImport={(asset) => void importLibraryAsset(asset.id, flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }))} />)}
          </div>
          {assetListCanScroll && !assetListAtEnd && <div className="asset-library-scroll-hint" aria-hidden="true"><span>向下滑动查看全部</span><i>↓</i></div>}
        </div>}
      </aside>}
      <div ref={shortcutGuideRef} className={`canvas-shortcut-guide${showShortcutGuide ? ' is-open' : ''}`}>
        <button
          type="button"
          className="canvas-shortcut-trigger"
          aria-label="查看画布快捷键"
          aria-haspopup="dialog"
          aria-expanded={showShortcutGuide}
          aria-controls="canvas-shortcut-panel"
          title="画布快捷键"
          onClick={() => setShowShortcutGuide((value) => !value)}
        ><KeyboardShortcutGlyph /></button>
        {showShortcutGuide && <section id="canvas-shortcut-panel" className="canvas-shortcut-panel" role="dialog" aria-label="画布快捷键">
          <header className="canvas-shortcut-panel__header">
            <span className="canvas-shortcut-panel__mark"><KeyboardShortcutGlyph /></span>
            <span><strong>快捷键图谱</strong><small>HEIYAN · CONTROL MAP</small></span>
            <span className="canvas-shortcut-panel__status"><i />{canvasShortcutGroups.reduce((total, group) => total + group.items.length, 0)} GLOBAL · {canvasContextShortcutItems.length} LOCAL</span>
            <button type="button" className="canvas-shortcut-panel__close ui-icon-button" aria-label="关闭快捷键窗口" onClick={() => setShowShortcutGuide(false)}><UiIcon name="close" /></button>
          </header>
          <div className="canvas-shortcut-panel__groups">
            {canvasShortcutGroups.map((group, groupIndex) => <section className="canvas-shortcut-group" key={group.title}>
              <header><span className="canvas-shortcut-group__index">{String(groupIndex + 1).padStart(2, '0')}</span><span><strong>{group.title}</strong><small>{group.subtitle}</small></span><UiIcon name={group.icon} /><em>{group.code}</em></header>
              <div>{group.items.map((shortcut) => <div className="canvas-shortcut-row" key={`${group.title}-${shortcut.keys.join('-')}`}>
                <span>{shortcut.label}</span>
                <ShortcutKeyset shortcut={shortcut} />
              </div>)}</div>
            </section>)}
          </div>
          <aside className="canvas-shortcut-contexts" aria-label="局部快捷键">
            <span><strong>局部操作</strong><small>获得对应工具焦点后生效</small></span>
            <div>{canvasContextShortcutItems.map((shortcut) => <span className="canvas-shortcut-context" key={`context-${shortcut.keys.join('-')}`}><ShortcutKeyset shortcut={shortcut} /><span>{shortcut.label}</span></span>)}</div>
          </aside>
          <footer><span>画布焦点 · 非文字编辑状态</span><span><kbd>Esc</kbd> 关闭图谱</span></footer>
        </section>}
      </div>
      <div className="view-controls"><button className="view-controls-zoom" type="button" aria-label="缩小画布" title="缩小" onClick={() => void flow.zoomOut({ duration: 120 })}>−</button><span className="zoom-label">{Math.round(zoom * 100)}%</span><button className="view-controls-zoom" type="button" aria-label="放大画布" title="放大" onClick={() => void flow.zoomIn({ duration: 120 })}>+</button><button className="view-controls-fit ui-icon-button" aria-label="适应画布" title="适应画布" onClick={fitReadable}><UiIcon name="fit" /></button><button className={`view-controls-minimap ui-icon-button${showMiniMap ? ' active' : ''}`} aria-label={showMiniMap ? '隐藏小地图' : '显示小地图'} title="小地图" onClick={() => setShowMiniMap((value) => !value)}><UiIcon name="minimap" /></button></div>
          {nodeMenu && <div className="node-search" style={{ left: Math.min(nodeMenu.clientX, window.innerWidth - 270), top: Math.min(nodeMenu.clientY - 62, window.innerHeight - 350) }} onDoubleClick={(event) => event.stopPropagation()}><div className="search-heading"><strong>创建节点</strong><kbd>Esc</kbd></div><input autoFocus={!mobileCanvas.mobile} value={nodeQuery} placeholder="搜索文本、图片、视频、音频、3D" onChange={(event) => setNodeQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && filteredTools[0]) { const point = flow.flowToScreenPosition({ x: nodeMenu.flowX, y: nodeMenu.flowY }); addNode(filteredTools[0].kind, point.x, point.y); } }} />{visibleManualTools.filter((tool) => `${tool.label} ${tool.kind}`.toLowerCase().includes(nodeQuery.toLowerCase())).map((tool) => <button key={tool.kind} onClick={() => { const point = flow.flowToScreenPosition({ x: nodeMenu.flowX, y: nodeMenu.flowY }); addNode(tool.kind, point.x, point.y); }}><span><UiIcon name={tool.icon} /></span><strong>{tool.label}</strong><small>{tool.kind.includes('Generator') ? 'AI 生成' : '文本输入'}</small></button>)}</div>}
      {paneMenu && <div className={`context-menu pane-menu${paneMenu.clientX > window.innerWidth - 440 ? ' opens-left' : ''}`} role="group" aria-label="画布操作" style={{ left: Math.min(paneMenu.clientX, window.innerWidth - 224), top: Math.max(12, Math.min(paneMenu.clientY, window.innerHeight - 180)) }}>
        <div className="menu-label">画布</div>
        <button type="button" onClick={() => { setNodeMenu(paneMenu); setNodeQuery(''); setPaneMenu(null); }}><ContextMenuItemContent icon="add">添加节点…</ContextMenuItemContent></button>
        <button type="button" onClick={() => { openUpload({ x: paneMenu.flowX, y: paneMenu.flowY }); setPaneMenu(null); }}><ContextMenuItemContent icon="upload">导入本地素材</ContextMenuItemContent></button>
        <button type="button" onClick={() => { void pasteNodes({ x: paneMenu.flowX, y: paneMenu.flowY }); setPaneMenu(null); }}><ContextMenuItemContent icon="paste">粘贴</ContextMenuItemContent></button>
      </div>}
      {connectMenu && <div className="node-search connect-search" style={{ left: Math.min(connectMenu.clientX, window.innerWidth - 270), top: Math.min(connectMenu.clientY, window.innerHeight - 300) }}><div className="search-heading"><strong>继续连接 {connectMenu.outputType === 'text' ? '文本' : connectMenu.outputType === 'image' ? '图片' : connectMenu.outputType === 'audio' ? '音频' : '视频'}</strong><kbd>Esc</kbd></div><div className="connect-hint">选择下一步，系统会自动连线</div>{visibleCreatableTools.filter((tool) => runtimeInputPorts(tool.kind).some((port) => port.accepts.includes(connectMenu.outputType))).map((tool) => <button key={tool.kind} onClick={() => addNode(tool.kind, connectMenu.clientX, connectMenu.clientY, connectMenu)}><span><UiIcon name={tool.icon} /></span><strong>{tool.label}</strong><small>可接收{connectMenu.outputType === 'text' ? '文本' : connectMenu.outputType === 'image' ? '图片' : connectMenu.outputType === 'audio' ? '音频' : '视频'}</small></button>)}</div>}
      {contextMenu && <div className={`context-menu node-context-menu${contextMenuOpensLeft ? ' opens-left' : ''}`} role="group" aria-label={contextMenu.nodeIds.length > 1 ? '所选节点操作' : '节点操作'} style={{ left: Math.min(contextMenu.clientX, window.innerWidth - 224), top: Math.max(12, Math.min(contextMenu.clientY, window.innerHeight - ((contextMenu.nodeIds.length > 1 ? 250 : contextMenuImage || contextMenuVideo ? 460 : contextMenuNode?.data.kind === 'collection' ? 340 : 310) + (contextMenuTaskId ? 40 : 0)))) }}>
        {contextMenu.nodeIds.length > 1 && <>
          <div className="menu-label selection-context-heading">已选择 {contextMenu.nodeIds.length} 个节点</div>
          <button type="button" onClick={() => { copySelectedFromMenu(new Set(contextMenu.nodeIds)); setContextMenu(null); }}><ContextMenuItemContent icon="copy">复制所选节点</ContextMenuItemContent></button>
          <ContextMenuSubmenu icon="clone" label="创建副本" open={contextSubmenu === 'selection-copy'} onOpenChange={(open) => setContextSubmenu(open ? 'selection-copy' : null)}>
            <button type="button" title="保留现有输入关系" onClick={() => { cloneSelectedNodes(contextMenu.nodeIds, 'with-inputs'); setContextMenu(null); }}><ContextMenuItemContent icon="linkedClone">带输入克隆</ContextMenuItemContent></button>
            <button type="button" title="复制设置，并把原节点连接到对应副本" onClick={() => { cloneSelectedNodes(contextMenu.nodeIds, 'next-step'); setContextMenu(null); }}><ContextMenuItemContent icon="next">克隆为下一步</ContextMenuItemContent></button>
          </ContextMenuSubmenu>
          <ContextMenuSubmenu icon="organize" label="整理" open={contextSubmenu === 'selection-organize'} onOpenChange={(open) => setContextSubmenu(open ? 'selection-organize' : null)}>
            <button type="button" disabled={Boolean(contextMenuCollectionIssue)} title={contextMenuCollectionIssue || '把所选节点折叠成一个收纳'} onClick={() => { workflows.createCollection(contextMenu.nodeIds); setContextMenu(null); }}><ContextMenuItemContent icon="collection">收纳所选节点</ContextMenuItemContent></button>
            <button type="button" disabled={contextMenuCollageImageCount < 2} title={contextMenuCollageImageCount < 2 ? '至少需要两张可读取的图片' : '按画布位置自动编号并拼成一张大图'} onClick={() => { const nodeIds = [...contextMenu.nodeIds]; setContextMenu(null); void createCollageFromSelection(nodeIds); }}><ContextMenuItemContent icon="collage">拼成一张图{contextMenuCollageImageCount ? `（${contextMenuCollageImageCount}张）` : ''}</ContextMenuItemContent></button>
          </ContextMenuSubmenu>
        </>}
        {contextMenu.nodeIds.length === 1 && contextMenuImage && <>
          <div className="menu-label">{contextMenuNode?.data.title || '图片节点'}</div>
          <button onClick={() => { void copyImageToExternalClipboard(contextMenuImage); setContextMenu(null); }}><ContextMenuItemContent icon="copy">复制图片</ContextMenuItemContent></button>
          <a href={canvasAssetDownloadUrl(contextMenuImage.mediaUrl, contextMenuImage.fileName || '图片.png')} download={contextMenuImage.fileName || '图片.png'} onClick={() => setContextMenu(null)}><ContextMenuItemContent icon="download">下载图片</ContextMenuItemContent></a>
          <div className="menu-divider" />
        </>}
        {contextMenu.nodeIds.length === 1 && contextMenuVideo && <>
          {!contextMenuImage && <div className="menu-label">{contextMenuNode?.data.title || '视频节点'}</div>}
          <a href={canvasAssetDownloadUrl(contextMenuVideo.mediaUrl, contextMenuVideo.fileName || '视频.mp4')} download={contextMenuVideo.fileName || '视频.mp4'} onClick={() => setContextMenu(null)}><ContextMenuItemContent icon="download">下载视频</ContextMenuItemContent></a>
          <div className="menu-divider" />
        </>}
        {contextMenu.nodeIds.length === 1 && contextMenuNode?.data.kind === 'collection' && <>
          <div className="menu-label">{contextMenuNode.data.title || '收纳'}</div>
          {!['running', 'cancelling'].includes(String(contextMenuNode.data.workflowState || '')) && <button onClick={() => { void workflows.runCollection(contextMenu.nodeId); setContextMenu(null); }}><ContextMenuItemContent icon="run">运行</ContextMenuItemContent></button>}
          <button onClick={() => { workflows.setCollectionCollapsed(contextMenu.nodeId, !contextMenuNode.data.collapsed); setContextMenu(null); }}><ContextMenuItemContent icon={contextMenuNode.data.collapsed ? 'expand' : 'collapse'}>{contextMenuNode.data.collapsed ? '展开内容' : '收起内容'}</ContextMenuItemContent></button>
          <button onClick={() => { setRenamingNodeId(contextMenu.nodeId); setContextMenu(null); }}><ContextMenuItemContent icon="rename">重命名</ContextMenuItemContent></button>
          <button onClick={() => { cloneCollectionWithInputs(contextMenu.nodeId); setContextMenu(null); }}><ContextMenuItemContent icon="linkedClone">带输入克隆</ContextMenuItemContent></button>
          <button type="button" title="只移除收纳外壳，里面的节点会保留" onClick={() => { workflows.dissolveCollection(contextMenu.nodeId); setContextMenu(null); }}><ContextMenuItemContent icon="dissolve">解散收纳</ContextMenuItemContent></button>
          <div className="menu-divider" />
          <button className="danger" onClick={() => { deleteNode(contextMenu.nodeId); setContextMenu(null); }}><ContextMenuItemContent icon="delete">删除收纳和节点</ContextMenuItemContent></button>
        </>}
        {contextMenu.nodeIds.length === 1 && contextMenuNode?.data.kind !== 'collection' && <>
        {!contextMenuImage && !contextMenuVideo && <div className="menu-label">{contextMenuNode?.data.title || '节点'}</div>}
        {contextMenuCollection && <button onClick={() => { void workflows.runCollection(contextMenuCollection.id, contextMenu.nodeId); setContextMenu(null); }}><ContextMenuItemContent icon="run">从这里运行</ContextMenuItemContent></button>}
        <button onClick={() => { setRenamingNodeId(contextMenu.nodeId); setContextMenu(null); }}><ContextMenuItemContent icon="rename">重命名</ContextMenuItemContent></button>
        {contextMenuTaskId && <button type="button" title={`生成任务：${contextMenuTaskId}`} onClick={() => { void copyTaskId(contextMenuTaskId); setContextMenu(null); }}><ContextMenuItemContent icon="copy">复制 Task ID</ContextMenuItemContent></button>}
        <button onClick={() => { copySelectedFromMenu(new Set([contextMenu.nodeId])); setContextMenu(null); }}><ContextMenuItemContent icon="copy">复制节点</ContextMenuItemContent></button>
        <ContextMenuSubmenu icon="clone" label="创建副本" open={contextSubmenu === 'node-copy'} onOpenChange={(open) => setContextSubmenu(open ? 'node-copy' : null)}>
          <button type="button" onClick={() => { duplicateNode(contextMenu.nodeId); setContextMenu(null); }}><ContextMenuItemContent icon="clone">普通克隆</ContextMenuItemContent></button>
          <button type="button" title="副本继续使用当前节点的输入" onClick={() => { cloneNodeWithInputs(contextMenu.nodeId); setContextMenu(null); }}><ContextMenuItemContent icon="linkedClone">带输入克隆</ContextMenuItemContent></button>
        </ContextMenuSubmenu>
        {contextMenuHasConnections && <ContextMenuSubmenu icon="more" label="更多" open={contextSubmenu === 'node-more'} onOpenChange={(open) => setContextSubmenu(open ? 'node-more' : null)}>
          {contextMenuHasConnections && <button type="button" onClick={() => { const connected = new Set(edgesRef.current.filter((edge) => edge.source === contextMenu.nodeId || edge.target === contextMenu.nodeId).map((edge) => edge.id)); disconnectEdges(connected); setContextMenu(null); }}><ContextMenuItemContent icon="disconnect">断开所有连接</ContextMenuItemContent></button>}
        </ContextMenuSubmenu>}
        <div className="menu-divider" />
        <button className="danger" onClick={() => { pushHistory(); const downstream = edgesRef.current.filter((edge) => edge.source === contextMenu.nodeId).map((edge) => edge.target); staleNodes(downstream, '前序节点已删除，结果可能过期'); setNodes((current) => current.filter((node) => node.id !== contextMenu.nodeId)); setEdges((current) => current.filter((edge) => edge.source !== contextMenu.nodeId && edge.target !== contextMenu.nodeId)); setContextMenu(null); }}><ContextMenuItemContent icon="delete">删除节点</ContextMenuItemContent></button></>}
      </div>}
      {selectionToolbarPosition && <div className="selection-toolbar" data-placement={selectionToolbarPosition.placement} style={{ left: selectionToolbarPosition.left, top: selectionToolbarPosition.top }}><strong><span>{selectedNodes.length}</span> 个节点</strong><div className="selection-toolbar-group"><button title="向左紧密排列 · Ctrl + ←" aria-label="向左紧密排列" onClick={() => arrangeSelected('left')}><UiIcon name="left" /></button><button title="向右紧密排列 · Ctrl + →" aria-label="向右紧密排列" onClick={() => arrangeSelected('right')}><UiIcon name="right" /></button><button title="向上紧密排列 · Ctrl + ↑" aria-label="向上紧密排列" onClick={() => arrangeSelected('top')}><UiIcon name="up" /></button><button title="向下紧密排列 · Ctrl + ↓" aria-label="向下紧密排列" onClick={() => arrangeSelected('bottom')}><UiIcon name="down" /></button><button title="均匀分布" aria-label="均匀分布" disabled={selectedNodes.length < 3} onClick={() => arrangeSelected('spaceX')}><UiIcon name="distribute" /></button><button title="自动排列" aria-label="自动排列" onClick={() => arrangeSelected('auto')}><UiIcon name="autoArrange" /></button></div></div>}
    </div></section>
    {!shareMode && <CanvasAgentDock key={activeCanvasKey} canvasKey={activeCanvasKey} open={agentOpen} canvasView={agentCanvasView} items={agentItems} selectedId={singleSelectedNodeId} ready={ready} access={agentCanvasAccess}
      followCanvas={agentFollow} onFollowCanvas={value => { setAgentFollow(value); try { localStorage.setItem('heiyan:agent-follow', value ? 'on' : 'off'); } catch { /* Current-page setting still applies. */ } }}
      onClose={() => switchAgentWorkspace('closed')} onViewChange={canvas => switchAgentWorkspace(canvas ? 'canvas' : 'conversation')}
      onFocus={focusAgentNode} onUpload={() => openUpload()} />}
    {canvasConfirmation && <div className="canvas-confirmation-layer" role="presentation" data-tone={canvasConfirmation.tone} onPointerDown={(event) => {
      event.stopPropagation();
      if (event.target === event.currentTarget) resolveCanvasConfirmation(false);
    }}>
      <section className="canvas-confirmation-card" role="dialog" aria-modal="true" aria-labelledby="canvas-confirmation-title">
        <header><span>{canvasConfirmation.eyebrow}</span><strong id="canvas-confirmation-title">{canvasConfirmation.title}</strong></header>
        <p>{canvasConfirmation.message}</p>
        <footer><button type="button" onClick={() => resolveCanvasConfirmation(false)}>取消</button><button type="button" className="primary" onClick={() => resolveCanvasConfirmation(true)}>{canvasConfirmation.confirmLabel}</button></footer>
      </section>
    </div>}
    {toast && <div className="toast" role="alert">{toast}</div>}
  </main>;
}

export default function App() {
  if (shouldShowCanvasHome(window.location.pathname, window.location.search)) return <CanvasHome />;
  return <ReactFlowProvider><Studio /></ReactFlowProvider>;
}
