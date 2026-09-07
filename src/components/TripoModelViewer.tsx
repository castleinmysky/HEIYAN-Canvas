import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export type TripoModelViewerProps = {
  src: string;
  format?: TripoModelFormat;
  poster?: string;
  alt?: string;
  className?: string;
  onModelMetadata?: (metadata: TripoModelMetadata) => void;
  onAnimationClipsChange?: (clips: TripoAnimationClipInfo[]) => void;
  selectedAnimationClip?: string | number | null;
  animationPlaying?: boolean;
  animationLoop?: boolean;
  animationSpeed?: number;
  animationSeekSeconds?: number;
  onAnimationProgress?: (progress: TripoAnimationProgress) => void;
  inspectionMode?: TripoInspectionMode;
  onSkeletonAvailabilityChange?: (available: boolean) => void;
};

export type TripoModelFormat = 'glb' | 'gltf' | 'fbx';

export type TripoModelMetadata = {
  textureCount: number;
  maxTextureWidth: number;
  maxTextureHeight: number;
  maxTextureSize: number;
};

export type TripoAnimationClipInfo = {
  index: number;
  name: string;
  duration: number;
};

export type TripoAnimationProgress = {
  clip: TripoAnimationClipInfo | null;
  currentTime: number;
  duration: number;
  progress: number;
  playing: boolean;
};

export function tripoAxisPointerToViewHelperClient(
  point: { clientX: number; clientY: number },
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  helperSize = 128,
) {
  return {
    clientX: rect.left + ((point.clientX - rect.left) / Math.max(1, rect.width)) * helperSize,
    clientY: rect.top + ((point.clientY - rect.top) / Math.max(1, rect.height)) * helperSize,
  };
}

export type TripoAnimationClipLike = {
  name?: string;
  duration?: number;
};

export type TripoAnimationActionLike = {
  time: number;
  timeScale?: number;
  paused?: boolean;
  clampWhenFinished?: boolean;
  play: () => TripoAnimationActionLike | void;
  stop: () => TripoAnimationActionLike | void;
  reset: () => TripoAnimationActionLike | void;
  setLoop?: (mode: unknown, repetitions: number) => TripoAnimationActionLike | void;
  setEffectiveTimeScale?: (scale: number) => TripoAnimationActionLike | void;
};

export type TripoAnimationMixerLike<Clip extends TripoAnimationClipLike = TripoAnimationClipLike> = {
  clipAction: (clip: Clip) => TripoAnimationActionLike;
  update: (deltaSeconds: number) => void;
  stopAllAction: () => void;
  uncacheClip?: (clip: Clip) => void;
  uncacheRoot: (root: unknown) => void;
};

export type TripoAnimationController = {
  clips: TripoAnimationClipInfo[];
  select: (clip: string | number | null) => void;
  setPlaying: (playing: boolean) => void;
  setLoop: (loop: boolean) => void;
  setSpeed: (speed: number) => void;
  seek: (seconds: number) => void;
  dispose: () => void;
};

type TripoAnimationControllerOptions<Clip extends TripoAnimationClipLike> = {
  root: unknown;
  clips?: Clip[] | null;
  createMixer: (root: unknown) => TripoAnimationMixerLike<Clip>;
  requestFrame: (callback: (timestamp: number) => void) => number;
  cancelFrame: (frame: number) => void;
  now?: () => number;
  loopRepeat?: unknown;
  loopOnce?: unknown;
  render?: () => void;
  onProgress?: (progress: TripoAnimationProgress) => void;
};

export function resolveTripoAnimationAsset<Root, Clip extends TripoAnimationClipLike>(
  format: TripoModelFormat,
  loaded: Root | { scene: Root; animations?: Clip[] | null },
): { root: Root; clips: Clip[] } {
  if (format === 'fbx') {
    const root = loaded as Root & { animations?: Clip[] | null };
    return { root, clips: Array.isArray(root.animations) ? root.animations : [] };
  }
  const gltf = loaded as { scene: Root; animations?: Clip[] | null };
  return { root: gltf.scene, clips: Array.isArray(gltf.animations) ? gltf.animations : [] };
}

export function createTripoAnimationController<Clip extends TripoAnimationClipLike>(
  options: TripoAnimationControllerOptions<Clip>,
): TripoAnimationController {
  const sourceClips = Array.isArray(options.clips) ? options.clips : [];
  const clips = sourceClips.map((clip, index) => ({
    index,
    name: String(clip.name || `Animation ${index + 1}`),
    duration: Math.max(0, Number(clip.duration) || 0),
  }));
  const mixer = options.createMixer(options.root);
  const now = options.now || (() => performance.now());
  let selectedIndex = sourceClips.length > 0 ? 0 : -1;
  let action: TripoAnimationActionLike | undefined;
  let playing = false;
  let loop = true;
  let speed = 1;
  let frame = 0;
  let disposed = false;
  let lastTimestamp = 0;

  const selectedClip = () => clips[selectedIndex] || null;
  const emitProgress = () => {
    const clip = selectedClip();
    const duration = clip?.duration || 0;
    const actionTime = Math.max(0, Number(action?.time) || 0);
    const currentTime = duration > 0 ? Math.min(actionTime, duration) : 0;
    options.onProgress?.({
      clip,
      currentTime,
      duration,
      progress: duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0,
      playing,
    });
  };
  const applyLoop = () => {
    if (!action) return;
    action.setLoop?.(loop ? options.loopRepeat : options.loopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
  };
  const applySpeed = () => {
    if (!action) return;
    action.timeScale = speed;
    action.setEffectiveTimeScale?.(speed);
  };
  const cancelTick = () => {
    if (!frame) return;
    options.cancelFrame(frame);
    frame = 0;
  };
  const tick = (timestamp: number) => {
    frame = 0;
    if (disposed || !playing || !action) return;
    const currentTimestamp = Number.isFinite(timestamp) ? timestamp : now();
    const deltaSeconds = Math.max(0, Math.min(0.25, (currentTimestamp - lastTimestamp) / 1000));
    lastTimestamp = currentTimestamp;
    mixer.update(deltaSeconds);
    options.render?.();
    emitProgress();
    frame = options.requestFrame(tick);
  };
  const scheduleTick = () => {
    if (disposed || frame || !playing || !action) return;
    lastTimestamp = now();
    frame = options.requestFrame(tick);
  };
  const activate = () => {
    action?.stop();
    action = selectedIndex >= 0 ? mixer.clipAction(sourceClips[selectedIndex]) : undefined;
    if (!action) {
      cancelTick();
      emitProgress();
      return;
    }
    action.reset();
    applyLoop();
    applySpeed();
    action.paused = !playing;
    action.play();
    options.render?.();
    emitProgress();
    scheduleTick();
  };

  if (selectedIndex >= 0) activate();
  else emitProgress();

  return {
    clips,
    select: (selection) => {
      if (disposed) return;
      const nextIndex = selection === null
        ? -1
        : typeof selection === 'number'
          ? Math.trunc(selection)
          : clips.findIndex((clip) => clip.name === selection);
      selectedIndex = nextIndex >= 0 && nextIndex < sourceClips.length ? nextIndex : -1;
      activate();
    },
    setPlaying: (nextPlaying) => {
      if (disposed) return;
      playing = Boolean(nextPlaying) && Boolean(action);
      if (action) {
        action.paused = !playing;
        if (playing) action.play();
      }
      if (playing) scheduleTick();
      else cancelTick();
      options.render?.();
      emitProgress();
    },
    setLoop: (nextLoop) => {
      if (disposed) return;
      loop = Boolean(nextLoop);
      applyLoop();
      emitProgress();
    },
    setSpeed: (nextSpeed) => {
      if (disposed) return;
      const numericSpeed = Number(nextSpeed);
      speed = Number.isFinite(numericSpeed) ? Math.max(0.05, Math.min(4, numericSpeed)) : 1;
      applySpeed();
      emitProgress();
    },
    seek: (seconds) => {
      if (disposed || !action) return;
      const duration = selectedClip()?.duration || 0;
      const numericSeconds = Number(seconds);
      action.time = Math.max(0, Math.min(Number.isFinite(numericSeconds) ? numericSeconds : 0, duration));
      mixer.update(0);
      options.render?.();
      emitProgress();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelTick();
      action?.stop();
      mixer.stopAllAction();
      sourceClips.forEach((clip) => mixer.uncacheClip?.(clip));
      mixer.uncacheRoot(options.root);
    },
  };
}


export type TripoInspectionMode = 'model' | 'skeleton';

export type TripoSkeletonNodeLike = {
  isBone?: boolean;
  isSkinnedMesh?: boolean;
  skeleton?: { bones?: unknown[] | null } | null;
  traverse?: (visit: (node: TripoSkeletonNodeLike) => void) => void;
};

export type TripoSkeletonHelperLike = {
  visible: boolean;
  geometry?: { dispose?: () => void } | null;
  material?: { dispose?: () => void } | Array<{ dispose?: () => void }> | null;
};

export type TripoSkeletonInspectionController = {
  available: boolean;
  setMode: (mode: TripoInspectionMode) => void;
  dispose: () => void;
};

export type TripoSkeletonInspectionControllerOptions<Helper extends TripoSkeletonHelperLike> = {
  root: TripoSkeletonNodeLike;
  initialMode?: TripoInspectionMode;
  createHelper: (root: TripoSkeletonNodeLike) => Helper;
  attachHelper: (helper: Helper) => void;
  detachHelper: (helper: Helper) => void;
  render?: () => void;
  onAvailabilityChange?: (available: boolean) => void;
};

export function tripoRootHasSkeleton(root: TripoSkeletonNodeLike | null | undefined) {
  if (!root) return false;
  let available = false;
  const inspect = (node: TripoSkeletonNodeLike) => {
    if (available) return;
    if (node.isBone || (node.isSkinnedMesh && Array.isArray(node.skeleton?.bones) && node.skeleton.bones.length > 0)) {
      available = true;
    }
  };
  inspect(root);
  if (!available) root.traverse?.(inspect);
  return available;
}

export function createTripoSkeletonInspectionController<Helper extends TripoSkeletonHelperLike>(
  options: TripoSkeletonInspectionControllerOptions<Helper>,
): TripoSkeletonInspectionController {
  const available = tripoRootHasSkeleton(options.root);
  const helper = available ? options.createHelper(options.root) : undefined;
  let disposed = false;
  if (helper) {
    helper.visible = false;
    options.attachHelper(helper);
  }
  options.onAvailabilityChange?.(available);

  const setMode = (mode: TripoInspectionMode) => {
    if (disposed) return;
    if (helper) helper.visible = mode === 'skeleton';
    options.render?.();
  };
  setMode(options.initialMode || 'model');

  return {
    available,
    setMode,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (!helper) return;
      helper.visible = false;
      options.detachHelper(helper);
      helper.geometry?.dispose?.();
      const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
      materials.forEach((material) => material?.dispose?.());
    },
  };
}
type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';
export const TRIPO_PREVIEW_FREEZE_DELAY_MS = 1400;
type ViewerRenderMode = 'pbr' | 'white' | 'texture' | 'cel';
type ViewerProjection = 'orthographic' | 'perspective';
type ViewerStats = { triangles: number; meshes: number; materials: number; bytes: number };
type ViewerViewState = {
  projection: ViewerProjection;
  cameraPosition: [number, number, number];
  target: [number, number, number];
  orthographicZoom: number;
};

export type TripoCalibrationSwatch = {
  id: string;
  label: string;
  base: string;
  shadow: string;
};

export const tripoCalibrationFallbackColors = ['#e7d9d2', '#d8bd83', '#8297b0', '#5f6c7b', '#2e333b'];

function calibrationShadowColor(hex: string) {
  const numeric = Number.parseInt(hex.replace('#', ''), 16);
  const red = (numeric >> 16) & 255;
  const green = (numeric >> 8) & 255;
  const blue = numeric & 255;
  const channel = (value: number, scale: number, lift: number) => Math.max(0, Math.min(255, Math.round(value * scale + lift)));
  const shadow = [channel(red, 0.66, 3), channel(green, 0.7, 5), channel(blue, 0.78, 11)];
  return `#${shadow.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function createTripoCalibrationSwatches(colors: string[]) {
  const unique = colors
    .map((color) => color.trim().toLowerCase())
    .filter((color) => /^#[0-9a-f]{6}$/.test(color))
    .filter((color, index, all) => all.indexOf(color) === index);
  const resolved = [...unique.slice(0, 5)];
  tripoCalibrationFallbackColors.forEach((color) => {
    if (resolved.length < 5 && !resolved.includes(color)) resolved.push(color);
  });
  return resolved.slice(0, 5).map((base, index) => ({
    id: `model-color-${index + 1}`,
    label: `主色 ${index + 1}`,
    base,
    shadow: calibrationShadowColor(base),
  }));
}

export const tripoCelShaderPreset = {
  // Authored albedo is always the 1.0 lit color. A light-independent binary
  // normal test applies one fixed shadow multiplier with no interpolation.
  color: { background: 0xd9d9d7, exposure: 1, litLevel: 1, shadowLevel: 0.58, shadowThreshold: 0.08 },
  outline: { thickness: 0.0024, color: [0.035, 0.045, 0.065] as [number, number, number], alpha: 0.84, minScale: 0.72, maxScale: 1.08 },
} as const;

export function resolveTripoCelShadeMultiplier(normalDotKey: number) {
  return normalDotKey >= tripoCelShaderPreset.color.shadowThreshold
    ? tripoCelShaderPreset.color.litLevel
    : tripoCelShaderPreset.color.shadowLevel;
}
const renderModes: Array<{ id: ViewerRenderMode; label: string; title: string }> = [
  { id: 'pbr', label: 'PBR', title: '真实材质与环境反射' },
  { id: 'white', label: '白模', title: '只检查模型体块和轮廓' },
  { id: 'texture', label: '贴图', title: '不受灯光影响的纯贴图检查' },
  { id: 'cel', label: '三渲二', title: '日式二阶 Toon：原色基底、固定硬阴影、无环境光与 ACES、独立描边' },
];

export function resolveTripoCalibrationVisibility(mode: ViewerRenderMode, wireframe: boolean) {
  return {
    pbr: !wireframe && mode === 'pbr',
    cel: !wireframe && mode === 'cel',
  };
}

export function resolveTripoCalibrationLayout(input: {
  maxExtent: number;
  characterHeight: number;
  floorY: number;
  lowerSilhouetteMaxZ: number;
}) {
  const radius = Math.max(input.maxExtent * 0.032, input.characterHeight * 0.022);
  const leftZ = input.lowerSilhouetteMaxZ + radius * 9.75;
  return {
    radius,
    floorY: input.floorY + radius * 1.06,
    leftZ,
    innerEdgeZ: leftZ - radius * 8.275,
  };
}
type ViewerRuntime = {
  render: () => void;
  resize: () => void;
  setRenderMode: (mode: ViewerRenderMode) => void;
  setProjection: (projection: ViewerProjection) => void;
  setWireframe: (active: boolean) => void;
  captureFrame: () => string | undefined;
  getViewState: () => ViewerViewState;
  animation: TripoAnimationController;
  inspection: TripoSkeletonInspectionController;
  dispose: () => void;
};

export function tripoViewerSourceTransition(active: boolean): { active: boolean; status: ViewerStatus } {
  return { active, status: active ? 'loading' : 'idle' };
}

export function tripoViewerBlocksNodeDrag(status: ViewerStatus) {
  return status !== 'idle';
}

export function tripoViewerPointerIsClick(deltaX: number, deltaY: number, threshold = 6) {
  return Math.hypot(deltaX, deltaY) <= threshold;
}

function modelBasePath(src: string) {
  const absolute = new URL(src, window.location.href);
  absolute.hash = '';
  absolute.search = '';
  absolute.pathname = absolute.pathname.slice(0, absolute.pathname.lastIndexOf('/') + 1);
  return absolute.href;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return '3D 模型预览加载失败';
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
}

export function TripoModelViewer({
  src,
  format = 'glb',
  poster,
  alt = '3D 模型交互预览',
  className = '',
  onModelMetadata,
  onAnimationClipsChange,
  selectedAnimationClip,
  animationPlaying = false,
  animationLoop = true,
  animationSpeed = 1,
  animationSeekSeconds,
  onAnimationProgress,
  inspectionMode = 'model',
  onSkeletonAvailabilityChange,
}: TripoModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const axisCanvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ViewerRuntime | undefined>(undefined);
  const viewerViewStateRef = useRef<ViewerViewState | undefined>(undefined);
  const freezeTimerRef = useRef<number | undefined>(undefined);
  const activationGestureCleanupRef = useRef<(() => void) | undefined>(undefined);
  const metadataCallbackRef = useRef(onModelMetadata);
  metadataCallbackRef.current = onModelMetadata;
  const clipsCallbackRef = useRef(onAnimationClipsChange);
  clipsCallbackRef.current = onAnimationClipsChange;
  const progressCallbackRef = useRef(onAnimationProgress);
  const skeletonAvailabilityCallbackRef = useRef(onSkeletonAvailabilityChange);
  skeletonAvailabilityCallbackRef.current = onSkeletonAvailabilityChange;
  const inspectionModeRef = useRef(inspectionMode);
  inspectionModeRef.current = inspectionMode;
  progressCallbackRef.current = onAnimationProgress;
  const animationControlRef = useRef({ selectedAnimationClip, animationPlaying, animationLoop, animationSpeed, animationSeekSeconds });
  animationControlRef.current = { selectedAnimationClip, animationPlaying, animationLoop, animationSpeed, animationSeekSeconds };
  const [active, setActive] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [renderMode, setRenderMode] = useState<ViewerRenderMode>('pbr');
  const [projection, setProjection] = useState<ViewerProjection>('orthographic');
  const [stats, setStats] = useState<ViewerStats>();
  const [status, setStatus] = useState<ViewerStatus>('idle');
  const [message, setMessage] = useState('');
  const [frozenPoster, setFrozenPoster] = useState<string>();
  const [freezePending, setFreezePending] = useState(false);

  useEffect(() => {
    const transition = tripoViewerSourceTransition(active);
    if (freezeTimerRef.current !== undefined) window.clearTimeout(freezeTimerRef.current);
    freezeTimerRef.current = undefined;
    setMessage('');
    setActive(transition.active);
    setStatus(transition.status);
    setFrozenPoster(undefined);
    setFreezePending(false);
    viewerViewStateRef.current = undefined;
  }, [src]);


  useEffect(() => {
    runtimeRef.current?.animation.select(selectedAnimationClip ?? null);
  }, [selectedAnimationClip]);

  useEffect(() => {
    runtimeRef.current?.animation.setPlaying(animationPlaying);
  }, [animationPlaying]);

  useEffect(() => {
    runtimeRef.current?.animation.setLoop(animationLoop);
  }, [animationLoop]);

  useEffect(() => {
    runtimeRef.current?.animation.setSpeed(animationSpeed);
  }, [animationSpeed]);

  useEffect(() => {
    if (animationSeekSeconds !== undefined) runtimeRef.current?.animation.seek(animationSeekSeconds);
  }, [animationSeekSeconds]);

  useEffect(() => {
    if (runtimeRef.current) onAnimationClipsChange?.(runtimeRef.current.animation.clips);
  }, [onAnimationClipsChange]);

  useEffect(() => {
    runtimeRef.current?.inspection.setMode(inspectionMode);
  }, [inspectionMode]);

  useEffect(() => {
    if (runtimeRef.current) onSkeletonAvailabilityChange?.(runtimeRef.current.inspection.available);
  }, [onSkeletonAvailabilityChange]);
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const axisCanvas = axisCanvasRef.current;
    if (!canvas || !axisCanvas) return;
    const controller = new AbortController();
    let disposed = false;
    let runtime: ViewerRuntime | undefined;
    let pendingDispose: (() => void) | undefined;
    setStatus('loading');
    setMessage('正在加载高质量模型…');
    setWireframe(false);
    setRenderMode('pbr');
    setProjection('orthographic');
    setStats(undefined);

    skeletonAvailabilityCallbackRef.current?.(false);
    const load = async () => {
      const [THREE, controlsModule, hdrModule, composerModule, renderPassModule, gtaoModule, outputPassModule, lightProbeModule, outlineModule, viewHelperModule] = await Promise.all([
        import('three'),
        import('three/examples/jsm/controls/OrbitControls.js'),
        import('three/examples/jsm/loaders/HDRLoader.js'),
        import('three/examples/jsm/postprocessing/EffectComposer.js'),
        import('three/examples/jsm/postprocessing/RenderPass.js'),
        import('three/examples/jsm/postprocessing/GTAOPass.js'),
        import('three/examples/jsm/postprocessing/OutputPass.js'),
        import('three/examples/jsm/lights/LightProbeGenerator.js'),
        import('three/examples/jsm/effects/OutlineEffect.js'),
        import('three/examples/jsm/helpers/ViewHelper.js'),
      ]);
      if (disposed) return;

      // Keep the canvas look-dev space identical to the main 3D asset library.
      // GLTF base colors are sRGB while all lighting and PBR math stay linear.
      if (THREE.ColorManagement) THREE.ColorManagement.workingColorSpace = THREE.LinearSRGBColorSpace;

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.95;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const axisRenderer = new THREE.WebGLRenderer({ canvas: axisCanvas, antialias: true, alpha: true, powerPreference: 'low-power' });
      axisRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      axisRenderer.setSize(128, 128, false);
      axisRenderer.setClearColor(0x000000, 0);

      const scene = new THREE.Scene();
      scene.background = null;
      const perspectiveCamera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
      const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
      let camera: any = orthographicCamera;
      const composer = new composerModule.EffectComposer(renderer);
      const renderPass = new renderPassModule.RenderPass(scene, camera);
      const gtaoPass = new gtaoModule.GTAOPass(scene, camera, 1, 1);
      gtaoPass.output = gtaoModule.GTAOPass.OUTPUT.Default;
      gtaoPass.blendIntensity = 0.88;
      const outputPass = new outputPassModule.OutputPass();
      composer.addPass(renderPass);
      composer.addPass(gtaoPass);
      composer.addPass(outputPass);
      const outlineEffect = new outlineModule.OutlineEffect(renderer, {
        defaultThickness: tripoCelShaderPreset.outline.thickness,
        defaultColor: tripoCelShaderPreset.outline.color,
        defaultAlpha: tripoCelShaderPreset.outline.alpha,
        defaultKeepAlive: true,
      });
      const controls = new controlsModule.OrbitControls(camera, canvas);
      controls.enableDamping = false;
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      controls.rotateSpeed = 0.68;
      controls.panSpeed = 0.74;
      controls.zoomSpeed = 0.82;
      controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
      controls.mouseButtons.RIGHT = THREE.MOUSE.DOLLY;

      // React Flow reserves middle mouse for panning the whole canvas. OrbitControls
      // receives this target-level event first; stopping it here keeps the gesture
      // inside the 3D viewport without disabling the canvas shortcut elsewhere.
      const stopViewerGesturePropagation = (event: PointerEvent | MouseEvent) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
      };
      canvas.addEventListener('pointerdown', stopViewerGesturePropagation);
      canvas.addEventListener('auxclick', stopViewerGesturePropagation);

      const studio = new THREE.Scene();
      const panel = (color: number, intensity: number, position: number[], rotation: number[], scale: number[]) => {
        const radiance = new THREE.Color(color).multiplyScalar(intensity);
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ color: radiance, side: THREE.DoubleSide, toneMapped: false }),
        );
        mesh.position.set(...position);
        mesh.rotation.set(...rotation);
        mesh.scale.set(...scale);
        studio.add(mesh);
      };
      panel(0xffffff, 1.35, [0, 5.5, 4], [-0.62, 0, 0], [8.5, 5.5, 1]);
      panel(0xffffff, 0.42, [-5, 1.5, 2], [0, 1.12, 0], [5.2, 7.5, 1]);
      panel(0xffffff, 0.26, [4.5, 2.2, -4], [0, -0.82, 0], [4.4, 6.2, 1]);
      panel(0x242424, 0.08, [0, -3, 0], [-Math.PI / 2, 0, 0], [16, 16, 1]);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const fallbackEnvironment = pmrem.fromScene(studio, 0.045).texture;
      let environment = fallbackEnvironment;
      pmrem.dispose();
      studio.traverse((node: any) => {
        node.geometry?.dispose?.();
        node.material?.dispose?.();
      });
      scene.environment = fallbackEnvironment;
      let diffuseProbe: any;
      pendingDispose = () => {
        environment.dispose();
        gtaoPass.dispose?.();
        outputPass.dispose?.();
        composer.dispose?.();
        renderer.renderLists.dispose();
        renderer.dispose();
      };

      try {
        const daylight = await new hdrModule.HDRLoader().loadAsync('/lookdev/kloofendal_48d_partly_cloudy_1k.hdr?v=20260811-pbr1');
        if (disposed) {
          daylight.dispose();
          return;
        }
        daylight.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = daylight;
        environment = daylight;
        fallbackEnvironment.dispose();
        const cubeTarget = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType });
        cubeTarget.fromEquirectangularTexture(renderer, daylight);
        diffuseProbe = await lightProbeModule.LightProbeGenerator.fromCubeRenderTarget(renderer, cubeTarget);
        cubeTarget.dispose();
        if (!disposed && diffuseProbe) {
          diffuseProbe.intensity = 0.42;
          scene.add(diffuseProbe);
        }
      } catch (error) {
        if (!controller.signal.aborted) console.warn('HDR environment unavailable, using studio fallback.', error);
      }

      const hemi = new THREE.HemisphereLight(0xffffff, 0x17191b, 0.2);
      scene.add(hemi);
      const key = new THREE.DirectionalLight(0xffffff, 1.18);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -0.00012;
      key.shadow.normalBias = 0.018;
      key.shadow.radius = 3;
      scene.add(key, key.target);
      const fill = new THREE.DirectionalLight(0xcddcff, 0.22);
      const rim = new THREE.DirectionalLight(0xfff4e6, 0.28);
      scene.add(fill, rim);

      const response = await fetch(src, { signal: controller.signal });
      if (!response.ok) throw new Error(`模型下载失败（HTTP ${response.status}）`);
      const buffer = await response.arrayBuffer();
      if (disposed) return;
      let root: any;
      let animationClips: any[] = [];
      if (format === 'fbx') {
        const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
        const asset = resolveTripoAnimationAsset('fbx', new FBXLoader().parse(buffer, modelBasePath(src)));
        root = asset.root;
        animationClips = asset.clips;
      } else {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        const gltf = await new Promise<any>((resolve, reject) => {
          loader.parse(buffer, modelBasePath(src), resolve, reject);
        });
        const asset = resolveTripoAnimationAsset(format, gltf);
        root = asset.root;
        animationClips = asset.clips;
      }
      if (disposed) return;
      const materialSet = new Set<any>();
      const geometrySet = new Set<any>();
      const textureSet = new Set<any>();
      const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

      // Normalize non-PBR materials (Phong/Lambert/Basic) to MeshStandardMaterial
      // so that scene.environment, environmentIntensity, shadows and HDRI
      // reflections actually take effect — identical to the 3D asset library.
      const normalizeMaterial = (source: any): any => {
        if (!source) return source;
        if (source.isMeshStandardMaterial || source.isMeshPhysicalMaterial) {
          if (source.map) source.map.colorSpace = THREE.SRGBColorSpace;
          if (source.emissiveMap) source.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          source.envMapIntensity = Math.max(0.85, Number(source.envMapIntensity) || 1);
          return source;
        }
        const shininess = Number(source.shininess);
        const converted = new THREE.MeshStandardMaterial({
          name: source.name || '',
          color: source.color?.clone?.() || new THREE.Color(0xffffff),
          map: source.map || null,
          emissive: source.emissive?.clone?.() || new THREE.Color(0x000000),
          emissiveMap: source.emissiveMap || null,
          emissiveIntensity: Number.isFinite(Number(source.emissiveIntensity)) ? Number(source.emissiveIntensity) : 0,
          normalMap: source.normalMap || null,
          normalScale: source.normalScale?.clone?.() || null,
          alphaMap: source.alphaMap || null,
          transparent: source.transparent || false,
          opacity: source.opacity ?? 1,
          side: source.side,
          roughness: Number.isFinite(shininess) ? Math.max(0.18, Math.min(0.88, 1 - Math.sqrt(Math.max(0, shininess) / 120))) : 0.62,
          metalness: 0,
        });
        if (converted.map) converted.map.colorSpace = THREE.SRGBColorSpace;
        if (converted.emissiveMap) converted.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        converted.envMapIntensity = 1;
        return converted;
      };

      let meshCount = 0;
      let triangleCount = 0;
      root.traverse((node: any) => {
        if (!node.isMesh) return;
        meshCount += 1;
        triangleCount += node.geometry?.index ? node.geometry.index.count / 3 : (node.geometry?.attributes?.position?.count || 0) / 3;
        node.castShadow = true;
        node.receiveShadow = true;
        geometrySet.add(node.geometry);
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        const normalized = materials.map(normalizeMaterial);
        node.material = Array.isArray(node.material) ? normalized : normalized[0];
        node.userData.tripoOriginalMaterial = node.material;
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach((material: any) => {
          if (!material) return;
          materialSet.add(material);
          ['map', 'normalMap', 'metalnessMap', 'roughnessMap', 'aoMap', 'emissiveMap'].forEach((slot) => {
            if (material[slot]?.isTexture) {
              material[slot].anisotropy = maxAnisotropy;
              textureSet.add(material[slot]);
            }
          });
        });
      });
      let maxTextureWidth = 0;
      let maxTextureHeight = 0;
      textureSet.forEach((texture) => {
        const image = texture?.source?.data || texture?.image;
        const width = Math.max(0, Number(image?.naturalWidth || image?.videoWidth || image?.width) || 0);
        const height = Math.max(0, Number(image?.naturalHeight || image?.videoHeight || image?.height) || 0);
        maxTextureWidth = Math.max(maxTextureWidth, width);
        maxTextureHeight = Math.max(maxTextureHeight, height);
      });
      metadataCallbackRef.current?.({
        textureCount: textureSet.size,
        maxTextureWidth,
        maxTextureHeight,
        maxTextureSize: Math.max(maxTextureWidth, maxTextureHeight),
      });
      setStats({ triangles: Math.round(triangleCount), meshes: meshCount, materials: materialSet.size, bytes: buffer.byteLength });

      scene.add(root);
      const sourceBox = new THREE.Box3().setFromObject(root);
      const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
      root.position.sub(sourceCenter);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const maxExtent = Math.max(size.x, size.y, size.z, 0.1);
      const floorRadius = Math.max(maxExtent * 0.18, size.y * 0.38, Math.min(Math.max(size.x, size.z) * 0.75, size.y * 0.65));
      const target = new THREE.Vector3(0, size.y * 0.025, 0);
      const viewHelper = new viewHelperModule.ViewHelper(camera, axisCanvas);
      viewHelper.center.copy(target);
      viewHelper.location.right = 0;
      viewHelper.location.bottom = 0;
      viewHelper.setLabels('X', 'Y', 'Z');
      viewHelper.setLabelStyle('700 22px Arial', '#101214', 13);
      const axisRaycaster = new THREE.Raycaster();
      const axisPointer = new THREE.Vector2();
      const axisHitCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0, 4);
      axisHitCamera.position.set(0, 0, 2);
      axisHitCamera.updateProjectionMatrix();
      axisHitCamera.updateMatrixWorld(true);
      const axisPointSprites = viewHelper.children.filter((child: any) => child.isSprite && /^(pos|neg)[XYZ]$/.test(child.userData?.type || ''));
      const axisPointBase = new Map<any, { scale: any; opacity: number }>(axisPointSprites.map((point: any) => [point, {
        scale: point.scale.clone(),
        opacity: point.material.opacity,
      }]));
      let hoveredAxisPoint: any | undefined;
      const setHoveredAxisPoint = (next: any | undefined) => {
        if (hoveredAxisPoint === next) return;
        hoveredAxisPoint = next;
        axisPointSprites.forEach((point: any) => {
          const base = axisPointBase.get(point)!;
          point.scale.copy(base.scale).multiplyScalar(point === next ? 1.3 : 1);
          point.material.opacity = point === next ? 1 : base.opacity;
          point.renderOrder = point === next ? 20 : 0;
        });
        axisCanvas.classList.toggle('is-axis-point-hovered', Boolean(next));
        axisCanvas.title = next ? `点击切换到 ${String(next.userData.type).replace('pos', '+').replace('neg', '-')} 轴视角` : '点击 X / Y / Z 正负轴端切换标准视角';
        axisRenderer.clear();
        viewHelper.render(axisRenderer);
      };
      const axisPointAtPointer = (event: PointerEvent) => {
        const rect = axisCanvas.getBoundingClientRect();
        axisPointer.set(
          ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
          -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
        );
        axisRaycaster.setFromCamera(axisPointer, axisHitCamera);
        return axisRaycaster.intersectObjects(axisPointSprites, false)[0]?.object;
      };
      const handleViewHelperPointerMove = (event: PointerEvent) => setHoveredAxisPoint(axisPointAtPointer(event));
      const handleViewHelperPointerLeave = () => setHoveredAxisPoint(undefined);
      axisCanvas.addEventListener('pointermove', handleViewHelperPointerMove);
      axisCanvas.addEventListener('pointerleave', handleViewHelperPointerLeave);

      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(floorRadius, 96),
        new THREE.MeshStandardMaterial({ color: 0x242728, roughness: 0.88, metalness: 0 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = box.min.y - maxExtent * 0.012;
      floor.receiveShadow = true;
      scene.add(floor);

      // A soft contact patch anchors the model even where realtime shadow maps
      // are too sparse (thin feet, small accessories and low-poly silhouettes).
      const aoCanvas = document.createElement('canvas');
      aoCanvas.width = 256;
      aoCanvas.height = 256;
      const aoContext = aoCanvas.getContext('2d');
      if (aoContext) {
        const gradient = aoContext.createRadialGradient(128, 128, 8, 128, 128, 128);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
        gradient.addColorStop(0.42, 'rgba(0, 0, 0, 0.34)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        aoContext.fillStyle = gradient;
        aoContext.fillRect(0, 0, 256, 256);
      }
      const aoTexture = new THREE.CanvasTexture(aoCanvas);
      aoTexture.colorSpace = THREE.SRGBColorSpace;
      const contactAo = new THREE.Mesh(
        new THREE.CircleGeometry(1, 96),
        new THREE.MeshBasicMaterial({
          map: aoTexture,
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      contactAo.rotation.x = -Math.PI / 2;
      contactAo.position.y = floor.position.y + maxExtent * 0.002;
      contactAo.scale.set(floorRadius * 0.78, floorRadius * 0.56, 1);
      contactAo.renderOrder = 1;
      scene.add(contactAo);


      const lookdevGeometries = new Set<any>();
      const lookdevMaterials = new Set<any>();
      const registerGeometry = (geometry: any) => {
        lookdevGeometries.add(geometry);
        return geometry;
      };
      const registerMaterial = (material: any) => {
        lookdevMaterials.add(material);
        return material;
      };
      const configureCelMaterial = (material: any) => {
        material.toneMapped = false;
        material.onBeforeCompile = (shader: any) => {
          shader.uniforms.tripoCelShadowLevel = { value: tripoCelShaderPreset.color.shadowLevel };
          shader.uniforms.tripoCelShadowThreshold = { value: tripoCelShaderPreset.color.shadowThreshold };
          shader.uniforms.tripoCelKeyDirection = { value: new THREE.Vector3(0.46, 0.78, 0.42).normalize() };
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vTripoCelViewNormal;')
            .replace(
              /#if defined \( USE_ENVMAP \) \|\| defined \( USE_SKINNING \)[\s\S]*?#endif/,
              '#include <beginnormal_vertex>\n#include <morphnormal_vertex>\n#include <skinbase_vertex>\n#include <skinnormal_vertex>\n#include <defaultnormal_vertex>\nvTripoCelViewNormal = normalize( transformedNormal );',
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              '#include <common>\nuniform float tripoCelShadowLevel;\nuniform float tripoCelShadowThreshold;\nuniform vec3 tripoCelKeyDirection;\nvarying vec3 vTripoCelViewNormal;',
            )
            .replace(
              'vec3 outgoingLight = reflectedLight.indirectDiffuse;',
              'vec3 tripoCelNormal = normalize( vTripoCelViewNormal );\n#ifdef DOUBLE_SIDED\ntripoCelNormal *= ( gl_FrontFacing ? 1.0 : -1.0 );\n#endif\nvec3 tripoCelKeyView = normalize( mat3( viewMatrix ) * tripoCelKeyDirection );\nfloat tripoCelBand = step( tripoCelShadowThreshold, dot( tripoCelNormal, tripoCelKeyView ) );\nfloat tripoCelShade = mix( tripoCelShadowLevel, 1.0, tripoCelBand );\nvec3 outgoingLight = reflectedLight.indirectDiffuse * tripoCelShade;',
            );
        };
        material.customProgramCacheKey = () => 'tripo-binary-unlit-cel-v1';
        material.userData.tripoCelLitLevel = tripoCelShaderPreset.color.litLevel;
        material.userData.tripoCelShadowLevel = tripoCelShaderPreset.color.shadowLevel;
        return material;
      };
      const lowerSilhouetteCutoffY = box.min.y + size.y * 0.34;
      let lowerSilhouetteMaxZ = Number.NEGATIVE_INFINITY;
      const lowerSilhouettePoint = new THREE.Vector3();
      root.traverse((node: any) => {
        if (!node.isMesh) return;
        const positions = node.geometry?.attributes?.position;
        if (!positions?.count) return;
        const stride = Math.max(1, Math.ceil(positions.count / 5000));
        for (let index = 0; index < positions.count; index += stride) {
          lowerSilhouettePoint.fromBufferAttribute(positions, index).applyMatrix4(node.matrixWorld);
          if (lowerSilhouettePoint.y <= lowerSilhouetteCutoffY) {
            lowerSilhouetteMaxZ = Math.max(lowerSilhouetteMaxZ, lowerSilhouettePoint.z);
          }
        }
      });
      if (!Number.isFinite(lowerSilhouetteMaxZ)) lowerSilhouetteMaxZ = box.max.z;
      const calibrationLayout = resolveTripoCalibrationLayout({
        maxExtent,
        characterHeight: size.y,
        floorY: floor.position.y,
        lowerSilhouetteMaxZ,
      });
      const referenceRadius = calibrationLayout.radius;
      const referenceFloorY = calibrationLayout.floorY;
      const referenceLeftZ = calibrationLayout.leftZ;
      const referenceFrontX = maxExtent * 0.08;
      const standardChartColors = [
        0xe6c5b5, 0xb63f3f, 0xd6a84f, 0x5d915d,
        0x4d91a6, 0x4d65a6, 0x8060a5, 0xe4e2dc,
        0xa2a19d, 0x5e6063, 0x6b4636, 0x1e2023,
      ];
      const sphereGeometry = registerGeometry(new THREE.SphereGeometry(referenceRadius, 48, 32));
      const pbrCalibrationGroup = new THREE.Group();
      pbrCalibrationGroup.name = 'PBR LookDev Standards';
      const graySphere = new THREE.Mesh(
        sphereGeometry,
        registerMaterial(new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.72, metalness: 0 })),
      );
      graySphere.name = '18 Percent Gray Sphere';
      graySphere.position.set(referenceFrontX, referenceFloorY, referenceLeftZ);
      graySphere.castShadow = true;
      graySphere.receiveShadow = true;
      const chromeSphere = new THREE.Mesh(
        sphereGeometry,
        registerMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.035, metalness: 1 })),
      );
      chromeSphere.name = 'Chrome Environment Sphere';
      chromeSphere.position.set(referenceFrontX, referenceFloorY, referenceLeftZ - referenceRadius * 2.55);
      chromeSphere.castShadow = true;
      chromeSphere.receiveShadow = true;
      pbrCalibrationGroup.add(graySphere, chromeSphere);

      const createPhysicalColorChart = (mode: 'pbr' | 'cel') => {
        const chart = new THREE.Group();
        chart.name = mode === 'pbr' ? 'PBR Environment Color Chart' : 'Cel Standard Color Chart';
        chart.rotation.y = Math.PI / 2;
        chart.position.set(referenceFrontX, referenceFloorY + referenceRadius * 0.15, referenceLeftZ - referenceRadius * 6.15);
        const chartWidth = referenceRadius * 4.25;
        const chartHeight = referenceRadius * 2.55;
        const backing = new THREE.Mesh(
          registerGeometry(new THREE.PlaneGeometry(chartWidth, chartHeight)),
          registerMaterial(mode === 'pbr'
            ? new THREE.MeshStandardMaterial({ color: 0x202326, roughness: 0.78, metalness: 0 })
            : new THREE.MeshBasicMaterial({ color: 0x202326, toneMapped: false })),
        );
        backing.position.z = -referenceRadius * 0.035;
        chart.add(backing);
        const patchGeometry = registerGeometry(new THREE.PlaneGeometry(referenceRadius * 0.72, referenceRadius * 0.62));
        standardChartColors.forEach((color, index) => {
          const column = index % 4;
          const row = Math.floor(index / 4);
          const material = mode === 'pbr'
            ? new THREE.MeshStandardMaterial({ color, roughness: 0.64, metalness: 0 })
            : new THREE.MeshBasicMaterial({ color, toneMapped: false });
          const patch = new THREE.Mesh(patchGeometry, registerMaterial(material));
          patch.position.set(
            (column - 1.5) * referenceRadius * 0.91,
            (1 - row) * referenceRadius * 0.77,
            0,
          );
          patch.castShadow = mode === 'pbr';
          patch.receiveShadow = mode === 'pbr';
          chart.add(patch);
        });
        return chart;
      };
      pbrCalibrationGroup.add(createPhysicalColorChart('pbr'));

      const celCalibrationGroup = new THREE.Group();
      celCalibrationGroup.name = 'Cel LookDev Standards';
      const createCelBandMaterial = (baseColor: number) => registerMaterial(configureCelMaterial(new THREE.MeshBasicMaterial({
        color: baseColor,
        toneMapped: false,
      })));
      const celSphere = new THREE.Mesh(sphereGeometry, createCelBandMaterial(0xdde4eb));
      celSphere.name = 'Two Band Cel Sphere';
      celSphere.position.set(referenceFrontX, referenceFloorY, referenceLeftZ);
      const celHead = new THREE.Mesh(sphereGeometry, createCelBandMaterial(0xe7c7b9));
      celHead.name = 'Cel Face Volume Standard';
      celHead.position.set(referenceFrontX, referenceFloorY + referenceRadius * 0.08, referenceLeftZ - referenceRadius * 2.65);
      celHead.scale.set(0.76, 1, 0.7);
      const celNose = new THREE.Mesh(
        registerGeometry(new THREE.ConeGeometry(referenceRadius * 0.2, referenceRadius * 0.5, 16)),
        createCelBandMaterial(0xe7c7b9),
      );
      celNose.rotation.z = -Math.PI / 2;
      celNose.position.set(referenceFrontX + referenceRadius * 0.78, referenceFloorY, referenceLeftZ - referenceRadius * 2.65);
      celCalibrationGroup.add(celSphere, celHead, celNose, createPhysicalColorChart('cel'));
      [celSphere, celHead, celNose].forEach((mesh) => {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      });
      pbrCalibrationGroup.visible = false;
      celCalibrationGroup.visible = false;
      scene.add(pbrCalibrationGroup, celCalibrationGroup);


      key.position.set(maxExtent * 2.3, maxExtent * 3.1, maxExtent * 2.6);
      key.target.position.set(0, floor.position.y, 0);
      key.target.updateMatrixWorld();
      const shadowExtent = maxExtent * 1.65;
      key.shadow.camera.left = -shadowExtent;
      key.shadow.camera.right = shadowExtent;
      key.shadow.camera.top = shadowExtent;
      key.shadow.camera.bottom = -shadowExtent;
      key.shadow.camera.near = Math.max(0.01, maxExtent * 0.02);
      key.shadow.camera.far = maxExtent * 8;
      key.shadow.camera.updateProjectionMatrix();
      fill.position.set(-maxExtent * 2.4, maxExtent * 1.7, maxExtent * 2);
      rim.position.set(-maxExtent * 2.1, maxExtent * 2.2, -maxExtent * 2.5);
      gtaoPass.updateGtaoMaterial({
        radius: maxExtent * 0.075,
        distanceExponent: 1.65,
        thickness: maxExtent * 0.16,
        distanceFallOff: 1.1,
        scale: 1,
        samples: 16,
        screenSpaceRadius: false,
      });
      gtaoPass.updatePdMaterial({
        lumaPhi: 8,
        depthPhi: 2,
        normalPhi: 3,
        radius: 4,
        radiusExponent: 1.8,
        rings: 2,
        samples: 16,
      });

      let fitDistance = 1;
      let wireframeEnabled = false;
      let activeRenderMode: ViewerRenderMode = 'pbr';
      const generatedMaterials = new Set<any>();
      const outlineMeshes = new Set<any>();
      const diagnosticMeshes = new Set<any>();
      const fitPerspectiveForAspect = (aspect: number) => {
        const verticalFov = THREE.MathUtils.degToRad(perspectiveCamera.fov);
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
        const verticalDistance = size.y / (2 * Math.tan(verticalFov / 2));
        // Tripo exports face +X. In the front view, Z is the on-screen horizontal axis.
        const horizontalDistance = size.z / (2 * Math.tan(horizontalFov / 2));
        return Math.max(verticalDistance, horizontalDistance, size.x * 1.7, maxExtent * 0.7) * 1.16;
      };
      const fitOrthographicHeight = (aspect: number) => Math.max(size.y * 1.16, size.z / Math.max(aspect, 0.1) * 1.16, maxExtent * 0.72);
      const updateCelOutlineReduction = () => {
        const cameraScale = camera.isOrthographicCamera
          ? Math.sqrt(Math.max(0.01, camera.zoom || 1))
          : Math.sqrt(fitDistance / Math.max(0.001, camera.position.distanceTo(controls.target)));
        const reduction = THREE.MathUtils.clamp(
          cameraScale,
          tripoCelShaderPreset.outline.minScale,
          tripoCelShaderPreset.outline.maxScale,
        );
        generatedMaterials.forEach((material) => {
          if (!material?.userData?.outlineParameters) return;
          material.userData.outlineParameters.thickness = tripoCelShaderPreset.outline.thickness
            * reduction
            * (material.userData.pencilLineWeight || 1);
        });
      };
      const render = () => {
        if (activeRenderMode === 'cel' && !wireframeEnabled) {
          updateCelOutlineReduction();
          outlineEffect.render(scene, camera);
        } else composer.render();
        axisRenderer.clear();
        viewHelper.render(axisRenderer);
      };
      const captureFrame = () => {
        try {
          render();
          const sourceWidth = Math.max(1, canvas.width);
          const sourceHeight = Math.max(1, canvas.height);
          const scale = Math.min(1, 1200 / Math.max(sourceWidth, sourceHeight));
          const snapshot = document.createElement('canvas');
          snapshot.width = Math.max(1, Math.round(sourceWidth * scale));
          snapshot.height = Math.max(1, Math.round(sourceHeight * scale));
          const context = snapshot.getContext('2d');
          if (!context) return undefined;
          context.drawImage(canvas, 0, 0, snapshot.width, snapshot.height);
          return snapshot.toDataURL('image/webp', 0.86);
        } catch {
          return undefined;
        }
      };
      const animation = createTripoAnimationController({
        root,
        clips: animationClips,
        createMixer: (mixerRoot) => new THREE.AnimationMixer(mixerRoot as any) as unknown as TripoAnimationMixerLike<any>,
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        cancelFrame: (frame) => window.cancelAnimationFrame(frame),
        now: () => performance.now(),
        loopRepeat: THREE.LoopRepeat,
        loopOnce: THREE.LoopOnce,
        render,
        onProgress: (progress) => progressCallbackRef.current?.(progress),
      });
      clipsCallbackRef.current?.(animation.clips);
      const initialAnimationControls = animationControlRef.current;
      if (initialAnimationControls.selectedAnimationClip !== undefined) {
        animation.select(initialAnimationControls.selectedAnimationClip);
      }
      animation.setLoop(initialAnimationControls.animationLoop);
      animation.setSpeed(initialAnimationControls.animationSpeed);
      if (initialAnimationControls.animationSeekSeconds !== undefined) {
        animation.seek(initialAnimationControls.animationSeekSeconds);
      }
      animation.setPlaying(initialAnimationControls.animationPlaying);
      const inspection = createTripoSkeletonInspectionController({
        root,
        initialMode: inspectionModeRef.current,
        createHelper: (helperRoot) => {
          const helper = new THREE.SkeletonHelper(helperRoot as any);
          helper.visible = false;
          helper.frustumCulled = false;
          helper.renderOrder = 12;
          const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
          materials.forEach((material: any) => {
            material.depthTest = false;
            material.depthWrite = false;
            material.transparent = true;
            material.opacity = 0.92;
          });
          return helper;
        },
        attachHelper: (helper) => scene.add(helper as any),
        detachHelper: (helper) => scene.remove(helper as any),
        render,
        onAvailabilityChange: (available) => skeletonAvailabilityCallbackRef.current?.(available),
      });


      const renderStableFrames = () => {
        render();
        window.requestAnimationFrame(() => {
          if (disposed) return;
          render();
          window.requestAnimationFrame(() => { if (!disposed) render(); });
        });
        window.setTimeout(() => { if (!disposed) render(); }, 180);
      };
      const clearGeneratedLook = () => {
        diagnosticMeshes.forEach((diagnostic) => {
          diagnostic.parent?.remove(diagnostic);
          diagnostic.geometry?.dispose?.();
          diagnostic.material?.dispose?.();
        });
        diagnosticMeshes.clear();
        outlineMeshes.forEach((outline) => {
          outline.parent?.remove(outline);
          outline.material?.dispose?.();
        });
        outlineMeshes.clear();
        generatedMaterials.forEach((material) => material.dispose?.());
        generatedMaterials.clear();
      };
      const applyWireframeOverlay = () => {
        if (!wireframeEnabled) return;
        root.traverse((node: any) => {
          if (!node.isMesh || node.userData?.tripoOutline) return;
          const originals = Array.isArray(node.userData.tripoOriginalMaterial)
            ? node.userData.tripoOriginalMaterial
            : [node.userData.tripoOriginalMaterial];
          const surfaceMaterial = () => {
            const material = new THREE.MeshStandardMaterial({
              color: 0x8e989f,
              roughness: 0.78,
              metalness: 0,
              side: THREE.DoubleSide,
            });
            generatedMaterials.add(material);
            return material;
          };
          node.material = Array.isArray(node.userData.tripoOriginalMaterial)
            ? originals.map(surfaceMaterial)
            : surfaceMaterial();
          const wireMaterial = new THREE.LineBasicMaterial({
            color: 0x11171b,
            transparent: true,
            opacity: 0.78,
            depthTest: true,
            depthWrite: false,
            toneMapped: false,
          });
          const geometryTriangles = node.geometry?.index
            ? node.geometry.index.count / 3
            : (node.geometry?.attributes?.position?.count || 0) / 3;
          const diagnosticGeometry = geometryTriangles <= 250000
            ? new THREE.WireframeGeometry(node.geometry)
            : new THREE.EdgesGeometry(node.geometry, 12);
          const wire = new THREE.LineSegments(diagnosticGeometry, wireMaterial);
          wire.renderOrder = 4;
          wire.userData.tripoWireframe = true;
          node.add(wire);
          diagnosticMeshes.add(wire);
        });
      };
      const applyRenderMode = (mode: ViewerRenderMode) => {
        activeRenderMode = mode;
        clearGeneratedLook();
        const profile = wireframeEnabled
          ? { key: 0.92, fill: 0.28, rim: 0.24, hemi: 0.22 }
          : mode === 'cel'
          ? { key: 0, fill: 0, rim: 0, hemi: 0 }
          : mode === 'white'
            ? { key: 1.04, fill: 0.2, rim: 0.24, hemi: 0.18 }
            : mode === 'texture'
              ? { key: 0, fill: 0, rim: 0, hemi: 0 }
              : { key: 1.18, fill: 0.22, rim: 0.28, hemi: 0.2 };
        key.intensity = profile.key;
        fill.intensity = profile.fill;
        rim.intensity = profile.rim;
        hemi.intensity = profile.hemi;
        const animeColorSpace = mode === 'cel' && !wireframeEnabled;
        renderer.toneMapping = animeColorSpace ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = animeColorSpace ? tripoCelShaderPreset.color.exposure : 0.95;
        key.color.setHex(0xffffff);
        fill.color.setHex(mode === 'cel' ? 0xb8d9ff : 0xcddcff);
        rim.color.setHex(mode === 'cel' ? 0xdff2ff : 0xfff4e6);
        hemi.color.setHex(mode === 'cel' ? 0xe4f0ff : 0xffffff);
        hemi.groundColor.setHex(mode === 'cel' ? 0x273044 : 0x17191b);
        if (diffuseProbe) diffuseProbe.intensity = wireframeEnabled ? 0.12 : mode === 'pbr' ? 0.42 : mode === 'white' ? 0.16 : 0;
        scene.background = mode === 'cel' ? new THREE.Color(tripoCelShaderPreset.color.background) : mode === 'texture' ? new THREE.Color(0x808080) : null;
        scene.environmentIntensity = wireframeEnabled ? 0.16 : mode === 'pbr' ? 0.94 : mode === 'white' ? 0.2 : 0;
        floor.visible = !wireframeEnabled && (mode === 'pbr' || mode === 'white');
        contactAo.visible = !wireframeEnabled && (mode === 'pbr' || mode === 'white');
        contactAo.material.opacity = mode === 'white' ? 0.18 : 0.28;
        floor.material.color.setHex(mode === 'white' ? 0xe2e2e2 : 0x3a3a3a);
        floor.material.roughness = mode === 'white' ? 0.86 : 0.78;
        floor.material.metalness = mode === 'pbr' ? 0.05 : 0;
        root.traverse((node: any) => {
          if (!node.isMesh || node.userData?.tripoOutline) return;
          node.castShadow = mode === 'pbr' || mode === 'white';
          node.receiveShadow = mode === 'pbr' || mode === 'white';
          const original = node.userData.tripoOriginalMaterial;
          const originals = Array.isArray(original) ? original : [original];
          if (mode === 'pbr') {
            node.material = original;
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            mats.forEach((m: any) => {
              if (!m) return;
              if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
                m.envMapIntensity = Math.max(0.85, Number(m.envMapIntensity) || 1);
                m.needsUpdate = true;
              }
            });
            return;
          }
          const createMaterial = (source: any) => {
            let material;
            if (mode === 'white') {
              material = new THREE.MeshStandardMaterial({ color: 0xd9e1ea, roughness: 0.64, metalness: 0 });
            } else if (mode === 'texture') {
              material = new THREE.MeshBasicMaterial({
                name: source?.name || '',
                color: source?.color?.clone?.() || new THREE.Color(0xffffff),
                map: source?.map || null,
                alphaMap: source?.alphaMap || null,
                transparent: source?.transparent || false,
                opacity: source?.opacity ?? 1,
                alphaTest: source?.alphaTest || 0,
                side: source?.side,
                depthWrite: source?.depthWrite,
              });
            } else {
              const toonColor = source?.color?.clone?.() || new THREE.Color(0x5f8ec8);
              const toonMap = source?.map || null;
              if (toonMap) toonMap.colorSpace = THREE.SRGBColorSpace;
              material = configureCelMaterial(new THREE.MeshBasicMaterial({
                name: source?.name || '',
                color: toonColor,
                map: toonMap,
                alphaMap: source?.alphaMap || null,
                transparent: source?.transparent || false,
                opacity: source?.opacity ?? 1,
                alphaTest: source?.alphaTest || 0,
                side: source?.side,
                depthTest: source?.depthTest,
                depthWrite: source?.depthWrite,
                premultipliedAlpha: source?.premultipliedAlpha || false,
                vertexColors: source?.vertexColors || false,
                toneMapped: false,
              }));
              // Pencil+ style material line functions: pale materials receive a
              // slightly lighter/thinner line, dark materials retain a firmer line.
              const outlineColor = toonColor.clone()
                .multiplyScalar(0.18)
                .lerp(new THREE.Color(0x101725), 0.62);
              const materialLuma = THREE.MathUtils.clamp(
                toonColor.r * 0.2126 + toonColor.g * 0.7152 + toonColor.b * 0.0722,
                0,
                1,
              );
              material.userData.pencilLineWeight = THREE.MathUtils.lerp(1.04, 0.88, materialLuma);
              material.userData.outlineParameters = {
                thickness: tripoCelShaderPreset.outline.thickness * material.userData.pencilLineWeight,
                color: [outlineColor.r, outlineColor.g, outlineColor.b],
                alpha: tripoCelShaderPreset.outline.alpha,
                visible: true,
                keepAlive: true,
              };
            }
            generatedMaterials.add(material);
            return material;
          };
          node.material = Array.isArray(original) ? originals.map(createMaterial) : createMaterial(originals[0]);
          if (mode === 'texture') {
            const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x101214, side: THREE.BackSide });
            const outline = new THREE.Mesh(node.geometry, outlineMaterial);
            outline.scale.setScalar(1.012);
            outline.renderOrder = -1;
            outline.userData.tripoOutline = true;
            node.add(outline);
            outlineMeshes.add(outline);
          }
        });
        applyWireframeOverlay();
        const calibrationVisibility = resolveTripoCalibrationVisibility(mode, wireframeEnabled);
        pbrCalibrationGroup.visible = calibrationVisibility.pbr;
        celCalibrationGroup.visible = calibrationVisibility.cel;
        gtaoPass.enabled = wireframeEnabled || mode === 'pbr' || mode === 'white';
        render();
      };
      let lastViewportWidth = 0;
      let lastViewportHeight = 0;
      let lastPixelRatio = renderer.getPixelRatio();
      const resize = (force = false) => {
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        if (!force
          && Math.abs(width - lastViewportWidth) < .5
          && Math.abs(height - lastViewportHeight) < .5
          && Math.abs(pixelRatio - lastPixelRatio) < .01) return;
        lastViewportWidth = width;
        lastViewportHeight = height;
        if (Math.abs(pixelRatio - lastPixelRatio) >= .01) {
          lastPixelRatio = pixelRatio;
          renderer.setPixelRatio(pixelRatio);
          composer.setPixelRatio(pixelRatio);
        }
        const previousDistance = Math.max(0.001, perspectiveCamera.position.distanceTo(controls.target));
        const zoomRatio = fitDistance > 0 ? previousDistance / fitDistance : 1;
        const direction = camera.position.clone().sub(controls.target).normalize();
        renderer.setSize(width, height, false);
        composer.setSize(width, height);
        const aspect = width / height;
        perspectiveCamera.aspect = aspect;
        perspectiveCamera.updateProjectionMatrix();
        const orthoHeight = fitOrthographicHeight(aspect);
        orthographicCamera.left = -orthoHeight * aspect / 2;
        orthographicCamera.right = orthoHeight * aspect / 2;
        orthographicCamera.top = orthoHeight / 2;
        orthographicCamera.bottom = -orthoHeight / 2;
        orthographicCamera.updateProjectionMatrix();
        const nextFit = fitPerspectiveForAspect(aspect);
        if (camera === perspectiveCamera && fitDistance > 0 && direction.lengthSq() > 0) camera.position.copy(controls.target).add(direction.multiplyScalar(nextFit * zoomRatio));
        fitDistance = nextFit;
        controls.minDistance = fitDistance * 0.32;
        controls.maxDistance = fitDistance * 4;
        perspectiveCamera.near = orthographicCamera.near = Math.max(maxExtent * 0.005, 0.001);
        perspectiveCamera.far = orthographicCamera.far = Math.max(maxExtent * 30, 100);
        perspectiveCamera.updateProjectionMatrix();
        orthographicCamera.updateProjectionMatrix();
        render();
      };

      const applyProjection = (nextProjection: ViewerProjection) => {
        const direction = camera.position.clone().sub(controls.target).normalize();
        camera = nextProjection === 'perspective' ? perspectiveCamera : orthographicCamera;
        renderPass.camera = camera;
        gtaoPass.camera = camera;
        camera.position.copy(controls.target).add(direction.multiplyScalar(fitDistance));
        camera.up.set(0, 1, 0);
        controls.object = camera;
        viewHelper.camera = camera;
        controls.update();
        resize(true);
      };

      controls.target.copy(target);
      const rect = canvas.getBoundingClientRect();
      const initialAspect = Math.max(1, rect.width) / Math.max(1, rect.height);
      fitDistance = fitPerspectiveForAspect(initialAspect);
      const savedView = viewerViewStateRef.current;
      if (savedView) {
        camera = savedView.projection === 'perspective' ? perspectiveCamera : orthographicCamera;
        renderPass.camera = camera;
        gtaoPass.camera = camera;
        controls.object = camera;
        controls.target.set(...savedView.target);
        camera.position.set(...savedView.cameraPosition);
        orthographicCamera.zoom = savedView.orthographicZoom;
        orthographicCamera.updateProjectionMatrix();
      } else {
        camera.position.set(target.x + fitDistance, target.y + size.y * 0.035, target.z);
        perspectiveCamera.position.copy(camera.position);
        orthographicCamera.position.copy(camera.position);
      }
      viewHelper.camera = camera;
      controls.update();
      controls.addEventListener('change', render);

      let viewHelperFrame = 0;
      let viewHelperLastFrame = 0;
      const animateViewHelper = (timestamp: number) => {
        const delta = viewHelperLastFrame ? Math.min(0.05, (timestamp - viewHelperLastFrame) / 1000) : 1 / 60;
        viewHelperLastFrame = timestamp;
        viewHelper.update(delta);
        controls.target.copy(viewHelper.center);
        controls.update();
        render();
        if (viewHelper.animating) viewHelperFrame = window.requestAnimationFrame(animateViewHelper);
        else viewHelperLastFrame = 0;
      };
      const handleViewHelperPointerUp = (event: PointerEvent) => {
        if (event.button !== 0) return;
        viewHelper.camera = camera;
        viewHelper.center.copy(controls.target);
        const normalizedPointer = tripoAxisPointerToViewHelperClient(event, axisCanvas.getBoundingClientRect());
        if (!viewHelper.handleClick(normalizedPointer)) return;
        event.preventDefault();
        event.stopPropagation();
        setHoveredAxisPoint(undefined);
        window.cancelAnimationFrame(viewHelperFrame);
        viewHelperLastFrame = 0;
        viewHelperFrame = window.requestAnimationFrame(animateViewHelper);
      };
      axisCanvas.addEventListener('pointerup', handleViewHelperPointerUp);

      let resizeFrame = 0;
      const scheduleResize = () => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => resize());
      };
      const resizeObserver = new ResizeObserver(scheduleResize);
      resizeObserver.observe(canvas);
      const flowViewport = canvas.closest('.react-flow__viewport');
      const transformObserver = new MutationObserver(scheduleResize);
      if (flowViewport) transformObserver.observe(flowViewport, { attributes: true, attributeFilter: ['style', 'class'] });
      window.addEventListener('resize', scheduleResize);
      window.visualViewport?.addEventListener('resize', scheduleResize);
      const settleTimers = [80, 240, 700].map((delay) => window.setTimeout(scheduleResize, delay));
      materialSet.forEach((material) => {
        Object.values(material).forEach((value: any) => {
          if (value?.isTexture) textureSet.add(value);
        });
      });

      runtime = {
        animation,
        render,
        inspection,
        resize,
        setRenderMode: applyRenderMode,
        setProjection: applyProjection,
        setWireframe: (enabled) => {
          wireframeEnabled = enabled;
          applyRenderMode(activeRenderMode);
        },
        captureFrame,
        getViewState: () => ({
          projection: camera === perspectiveCamera ? 'perspective' : 'orthographic',
          cameraPosition: camera.position.toArray() as [number, number, number],
          target: controls.target.toArray() as [number, number, number],
          orthographicZoom: orthographicCamera.zoom,
        }),
        dispose: () => {
          animation.dispose();
          resizeObserver.disconnect();
          inspection.dispose();
          transformObserver.disconnect();
          window.cancelAnimationFrame(resizeFrame);
          window.cancelAnimationFrame(viewHelperFrame);
          settleTimers.forEach((timer) => window.clearTimeout(timer));
          window.removeEventListener('resize', scheduleResize);
          window.visualViewport?.removeEventListener('resize', scheduleResize);
          controls.removeEventListener('change', render);
          canvas.removeEventListener('pointerdown', stopViewerGesturePropagation);
          canvas.removeEventListener('auxclick', stopViewerGesturePropagation);
          axisCanvas.removeEventListener('pointerup', handleViewHelperPointerUp);
          axisCanvas.removeEventListener('pointermove', handleViewHelperPointerMove);
          axisCanvas.removeEventListener('pointerleave', handleViewHelperPointerLeave);
          setHoveredAxisPoint(undefined);
          controls.dispose();
          viewHelper.dispose();
          axisRenderer.dispose();
          clearGeneratedLook();
          textureSet.forEach((texture) => texture.dispose?.());
          materialSet.forEach((material) => material.dispose?.());
          geometrySet.forEach((geometry) => geometry.dispose?.());
          lookdevGeometries.forEach((geometry) => geometry.dispose?.());
          lookdevMaterials.forEach((material) => material.dispose?.());
          scene.remove(pbrCalibrationGroup, celCalibrationGroup);
          floor.geometry.dispose();
          floor.material.dispose();
          contactAo.geometry.dispose();
          contactAo.material.dispose();
          aoTexture.dispose();
          gtaoPass.dispose?.();
          outputPass.dispose?.();
          composer.dispose?.();
          environment.dispose();
          renderer.renderLists.dispose();
          renderer.dispose();
        },
      };
      pendingDispose = runtime.dispose;
      runtimeRef.current = runtime;
      applyRenderMode(activeRenderMode);
      resize(true);
      if (typeof renderer.compileAsync === 'function') {
        await renderer.compileAsync(scene, camera).catch(() => undefined);
        if (disposed) return;
      }
      renderStableFrames();
      setStatus('ready');
      setMessage('');
    };

    load().catch((error) => {
      if (controller.signal.aborted || disposed) return;
      pendingDispose?.();
      pendingDispose = undefined;
      setStatus('error');
      setMessage(errorMessage(error));
    });

    return () => {
      disposed = true;
      controller.abort();
      pendingDispose?.();
      pendingDispose = undefined;
      if (runtimeRef.current === runtime) runtimeRef.current = undefined;
    };
  }, [active, format, src]);

  const cancelPendingFreeze = () => {
    if (freezeTimerRef.current !== undefined) window.clearTimeout(freezeTimerRef.current);
    freezeTimerRef.current = undefined;
    setFreezePending(false);
  };
  const activate = () => {
    cancelPendingFreeze();
    setMessage('');
    setStatus('loading');
    setActive(true);
  };
  const beginPreviewActivationGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || tripoViewerBlocksNodeDrag(status)) return;
    activationGestureCleanupRef.current?.();
    const { pointerId, clientX, clientY } = event;
    const cleanup = () => {
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', cleanup, true);
      if (activationGestureCleanupRef.current === cleanup) activationGestureCleanupRef.current = undefined;
    };
    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      if (tripoViewerPointerIsClick(upEvent.clientX - clientX, upEvent.clientY - clientY)) activate();
    };
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', cleanup, true);
    activationGestureCleanupRef.current = cleanup;
  };
  useEffect(() => () => activationGestureCleanupRef.current?.(), []);
  const freezePreview = () => {
    cancelPendingFreeze();
    const currentRuntime = runtimeRef.current;
    const snapshot = currentRuntime?.captureFrame();
    if (snapshot) setFrozenPoster(snapshot);
    if (currentRuntime) viewerViewStateRef.current = currentRuntime.getViewState();
    setActive(false);
    setStatus('idle');
  };
  const schedulePreviewFreeze = () => {
    if (freezeTimerRef.current !== undefined) window.clearTimeout(freezeTimerRef.current);
    setFreezePending(true);
    freezeTimerRef.current = window.setTimeout(() => {
      freezeTimerRef.current = undefined;
      freezePreview();
    }, TRIPO_PREVIEW_FREEZE_DELAY_MS);
  };

  useEffect(() => {
    if (!active) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) {
        cancelPendingFreeze();
        return;
      }
      schedulePreviewFreeze();
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      if (freezeTimerRef.current !== undefined) window.clearTimeout(freezeTimerRef.current);
      freezeTimerRef.current = undefined;
    };
  }, [active]);

  const toggleWireframe = () => {
    const next = !wireframe;
    setWireframe(next);
    runtimeRef.current?.setWireframe(next);
  };
  const changeRenderMode = (mode: ViewerRenderMode) => {
    if (wireframe) {
      setWireframe(false);
      runtimeRef.current?.setWireframe(false);
    }
    setRenderMode(mode);
    runtimeRef.current?.setRenderMode(mode);
  };
  const changeProjection = (next: ViewerProjection) => {
    setProjection(next);
    runtimeRef.current?.setProjection(next);
  };

  // Before activation, the full preview surface belongs to React Flow so the
  // node can be dragged. Once activated, the same surface belongs to OrbitControls.
  const blocksNodeDrag = tripoViewerBlocksNodeDrag(status);
  return <div
    ref={containerRef}
    className={`tripo-model-viewer ${blocksNodeDrag ? 'nodrag' : ''} nopan nowheel ${status === 'ready' ? 'is-interactive' : ''} ${status === 'idle' ? 'is-frozen' : ''} ${freezePending ? 'is-freeze-pending' : ''} ${className}`}
    aria-label={alt}
    onPointerEnter={cancelPendingFreeze}
    onPointerDown={(event) => {
      cancelPendingFreeze();
      if (blocksNodeDrag) event.stopPropagation();
    }}
    onAuxClick={(event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
    }}
  >
    {(frozenPoster || poster) && status !== 'ready' && <img className="tripo-viewer-poster" src={frozenPoster || poster} alt={alt} draggable={false} />}
    <canvas ref={canvasRef} aria-hidden={status !== 'ready'} />
    <canvas ref={axisCanvasRef} className='tripo-axis-navigation-canvas nodrag nopan nowheel' aria-label='世界坐标视角导航：X 红、Y 绿、Z 蓝' />
    {status === 'idle' && <div
      className="tripo-viewer-poster-action nopan nowheel"
      onPointerDown={beginPreviewActivationGesture}
    >
      <button type="button" className="nodrag" onClick={(event) => { event.stopPropagation(); activate(); }}>点击激活 3D 预览</button>
      <span>{frozenPoster ? '当前画面已冻结 · 点击继续交互' : '按需加载 · 点击画面外短暂等待后自动冻结'}</span>
    </div>}
    {status === 'loading' && <div className="tripo-viewer-state" role="status"><strong>正在加载完整模型</strong><span>{message}</span></div>}
    {status === 'error' && <div className="tripo-viewer-state error nodrag nowheel" role="alert"><strong>交互预览加载失败</strong><span>{message}</span>{(frozenPoster || poster) && <button type="button" onClick={(event) => { event.stopPropagation(); setActive(false); setStatus('idle'); }}>返回静态预览</button>}</div>}
    {status === 'ready' && <div className='tripo-studio-note nodrag nowheel'><strong>左键旋转 · 中键平移 · 滚轮缩放</strong><span>Studio Preview</span></div>}
    {status === 'ready' && freezePending && <div className='tripo-viewer-freeze-notice nodrag nowheel' role='status'><strong>即将暂停预览</strong><span>移回画面继续</span></div>}
    {status === 'ready' && <div className='tripo-lookdev-menu tripo-camera-menu nodrag nowheel' role='group' aria-label='相机模式'>
      <strong>相机</strong>
      <button type='button' className={projection === 'orthographic' ? 'active' : ''} aria-pressed={projection === 'orthographic'} onClick={() => changeProjection('orthographic')}>正交</button>
      <button type='button' className={projection === 'perspective' ? 'active' : ''} aria-pressed={projection === 'perspective'} onClick={() => changeProjection('perspective')}>透视</button>
    </div>}
    {status === 'ready' && <div className='tripo-lookdev-menu tripo-render-menu nodrag nowheel' role='group' aria-label='渲染模式'>
      <strong>渲染</strong>
      {renderModes.map((mode) => <button
        key={mode.id}
        type='button'
        className={!wireframe && renderMode === mode.id ? 'active' : ''}
        aria-pressed={!wireframe && renderMode === mode.id}
        title={mode.title}
        onClick={() => changeRenderMode(mode.id)}
      >{mode.label}</button>)}
      <button type='button' className={wireframe ? 'active' : ''} aria-pressed={wireframe} title='中性实体底模与真实三角拓扑线' onClick={toggleWireframe}>线框</button>
    </div>}
    {status === 'ready' && <div className='tripo-axis-navigation-label nodrag nowheel' aria-hidden='true'>
      <strong>世界坐标</strong><span>点击轴向切换视角</span>
    </div>}
    {status === 'ready' && stats && <div className='tripo-viewer-stats nodrag nowheel'>
      <strong>三角面 {stats.triangles.toLocaleString()}</strong>
      <span>网格 {stats.meshes} · 材质 {stats.materials} · {formatFileSize(stats.bytes)}</span>
    </div>}
  </div>;
}
