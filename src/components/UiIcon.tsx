import type { ReactNode, SVGProps } from 'react';

export type UiIconName =
  | 'add' | 'upload' | 'paste' | 'copy' | 'clone' | 'linkedClone' | 'next'
  | 'organize' | 'collection' | 'collage' | 'download' | 'archive' | 'run'
  | 'expand' | 'collapse' | 'rename' | 'toolbox' | 'dissolve' | 'delete'
  | 'disconnect' | 'more' | 'undo' | 'redo' | 'usage' | 'model' | 'back'
  | 'chevronDown' | 'close' | 'fit' | 'minimap' | 'view' | 'search'
  | 'text' | 'image' | 'video' | 'audio' | 'imageGenerate' | 'videoGenerate' | 'audioGenerate' | 'play' | 'pause'
  | 'model3d' | 'comfy' | 'character' | 'split' | 'result' | 'preview'
  | 'link' | 'lock' | 'unlock' | 'crop' | 'edit' | 'retry' | 'clear' | 'send' | 'candidate'
  | 'final' | 'submitted' | 'left' | 'right' | 'up' | 'down' | 'distribute'
  | 'autoArrange' | 'check' | 'external' | 'replace' | 'swap' | 'spark' | 'robot' | 'arrowUp' | 'mention' | 'stop'
  | 'menu' | 'home' | 'document' | 'github' | 'settings' | 'key' | 'database' | 'info' | 'history' | 'language';

const shapes: Record<UiIconName, ReactNode> = {
  add: <><rect x="3" y="3" width="14" height="14" rx="4" /><path d="M10 6.5v7M6.5 10h7" /></>,
  upload: <><path d="M10 13V4M6.5 7.5 10 4l3.5 3.5" /><path d="M4 12.5v2A2.5 2.5 0 0 0 6.5 17h7a2.5 2.5 0 0 0 2.5-2.5v-2" /></>,
  paste: <><rect x="4" y="5" width="12" height="12" rx="3" /><path d="M7 5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 13 4v1M7 9h6M7 12h5" /></>,
  copy: <><rect x="6" y="6" width="10" height="10" rx="3" /><path d="M13.5 6v-.5A2.5 2.5 0 0 0 11 3H5.5A2.5 2.5 0 0 0 3 5.5V11a2.5 2.5 0 0 0 2.5 2.5H6" /></>,
  clone: <><rect x="6" y="6" width="10" height="10" rx="3" /><path d="M13.5 6v-.5A2.5 2.5 0 0 0 11 3H5.5A2.5 2.5 0 0 0 3 5.5V11a2.5 2.5 0 0 0 2.5 2.5H6M11 9v4M9 11h4" /></>,
  linkedClone: <><rect x="7" y="5" width="10" height="10" rx="3" /><path d="M7 12.5H5.5A2.5 2.5 0 0 1 3 10V5.5A2.5 2.5 0 0 1 5.5 3H10a2.5 2.5 0 0 1 2.5 2M3 15h5M6 12l3 3-3 3" /></>,
  next: <><rect x="2.5" y="5" width="5" height="10" rx="2" /><rect x="12.5" y="5" width="5" height="10" rx="2" /><path d="M8.5 10h3M10 8.5l1.5 1.5-1.5 1.5" /></>,
  organize: <><rect x="3" y="3" width="5" height="5" rx="1.5" /><rect x="12" y="3" width="5" height="5" rx="1.5" /><rect x="3" y="12" width="5" height="5" rx="1.5" /><rect x="12" y="12" width="5" height="5" rx="1.5" /><path d="M8 5.5h4M5.5 8v4M14.5 8v4M8 14.5h4" /></>,
  collection: <><rect x="2.5" y="4" width="15" height="12" rx="3" /><circle cx="7" cy="10" r="1.5" /><circle cx="13" cy="10" r="1.5" /><path d="M8.5 10h3" /></>,
  collage: <><rect x="3" y="3" width="14" height="14" rx="3" /><path d="M10 3v14M3 10h14" /></>,
  download: <><path d="M10 3.5v9M6.5 9 10 12.5 13.5 9" /><path d="M4 13v1.5A2.5 2.5 0 0 0 6.5 17h7a2.5 2.5 0 0 0 2.5-2.5V13" /></>,
  archive: <><rect x="3" y="4" width="14" height="13" rx="3" /><path d="M3 8h14M10 6v7M7.5 10.5 10 13l2.5-2.5" /></>,
  run: <><circle cx="10" cy="10" r="7" /><path d="m8.5 7 4.5 3-4.5 3Z" /></>,
  expand: <><path d="M8 3H3v5M12 3h5v5M8 17H3v-5M12 17h5v-5M3 8l5-5M17 8l-5-5M3 12l5 5M17 12l-5 5" /></>,
  collapse: <><path d="M8 8H3V3M12 8h5V3M8 12H3v5M12 12h5v5M3 3l5 5M17 3l-5 5M3 17l5-5M17 17l-5-5" /></>,
  rename: <><path d="m4 14.5-.5 3 3-.5L15.7 7.8a2 2 0 0 0-2.8-2.8L4 14.5Z" /><path d="m11.8 6.2 2.8 2.8M3.5 17.5h13" /></>,
  toolbox: <><rect x="2.5" y="6" width="15" height="11" rx="3" /><path d="M7 6V4.5A1.5 1.5 0 0 1 8.5 3h3A1.5 1.5 0 0 1 13 4.5V6M2.5 10h15M8 10v2h4v-2" /></>,
  dissolve: <><path d="M7 4H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2M13 4h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2M8 10H3.5M5.5 8 3.5 10l2 2M12 10h4.5M14.5 8l2 2-2 2" /></>,
  delete: <><path d="M4.5 6h11M8 3h4l1 3H7l1-3Z" /><path d="m6 6 .7 10h6.6L14 6M8.5 9v4M11.5 9v4" /></>,
  disconnect: <><path d="m7.5 12.5-1 1a3 3 0 0 1-4.2-4.2l2.5-2.5A3 3 0 0 1 9 6.8M12.5 7.5l1-1a3 3 0 0 1 4.2 4.2l-2.5 2.5a3 3 0 0 1-4.2 0M7 10h6M4 3l12 14" /></>,
  more: <><circle cx="4" cy="10" r="1" /><circle cx="10" cy="10" r="1" /><circle cx="16" cy="10" r="1" /></>,
  undo: <><path d="M7.5 5 3.5 9l4 4" /><path d="M4 9h7a5 5 0 0 1 5 5v1" /></>,
  redo: <><path d="m12.5 5 4 4-4 4" /><path d="M16 9H9a5 5 0 0 0-5 5v1" /></>,
  usage: <><path d="M4 15V9M8 15V5M12 15v-3M16 15V7" /><path d="M3 17h14" /></>,
  model: <><path d="m10 2.8 6.5 3.7v7L10 17.2l-6.5-3.7v-7L10 2.8Z" /><path d="m3.8 6.7 6.2 3.6 6.2-3.6M10 10.3v6.5" /></>,
  back: <><path d="m8 4-6 6 6 6M2 10h15" /></>,
  chevronDown: <path d="m5 8 5 5 5-5" />,
  close: <path d="M5 5l10 10M15 5 5 15" />,
  fit: <><path d="M8 3H3v5M12 3h5v5M8 17H3v-5M12 17h5v-5" /></>,
  minimap: <><rect x="3" y="4" width="14" height="12" rx="3" /><path d="m5.5 13 3-3 2.3 2.2 2.7-3.2 2 2.4" /><circle cx="7" cy="7.5" r="1" /></>,
  view: <><path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5Z" /><circle cx="10" cy="10" r="2.3" /></>,
  search: <><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4.3 4.3" /></>,
  text: <><path d="M4 5V3h12v2M10 3v14M7 17h6" /></>,
  image: <><rect x="3" y="3" width="14" height="14" rx="3" /><circle cx="7.5" cy="7.5" r="1.5" /><path d="m5 14 3.5-3.5 2.5 2.5 2-2 2 3" /></>,
  video: <><rect x="2.5" y="4" width="11" height="12" rx="3" /><path d="m13.5 8 4-2v8l-4-2" /></>,
  audio: <><path d="M8 15.5V5l7-1.5V14" /><circle cx="5.5" cy="15.5" r="2.5" /><circle cx="12.5" cy="14" r="2.5" /></>,
  audioGenerate: <><path d="M7.5 15.5V6l6-1.3V14" /><circle cx="5.5" cy="15.5" r="2" /><circle cx="11.5" cy="14" r="2" /><path d="M16 3v4M14 5h4" /></>,
  play: <><circle cx="10" cy="10" r="7" /><path d="m8.5 7 4.5 3-4.5 3Z" /></>,
  pause: <><circle cx="10" cy="10" r="7" /><path d="M8 7v6M12 7v6" /></>,
  imageGenerate: <><rect x="3" y="5" width="12" height="12" rx="3" /><path d="m5.5 14 3-3 2.5 2.5 1.8-1.8" /><path d="M15.5 2.5v4M13.5 4.5h4" /></>,
  videoGenerate: <><rect x="2.5" y="5" width="11" height="11" rx="3" /><path d="m13.5 8.5 4-2v8l-4-2M7 2.5v4M5 4.5h4" /></>,
  model3d: <><path d="m10 3 6 3.5v7L10 17l-6-3.5v-7L10 3Z" /><path d="m4 6.5 6 3.5 6-3.5M10 10v7" /></>,
  comfy: <><rect x="3" y="3" width="5" height="5" rx="1.5" /><rect x="12" y="3" width="5" height="5" rx="1.5" /><rect x="7.5" y="12" width="5" height="5" rx="1.5" /><path d="M8 5.5h4M6.5 8v2l3.5 2M13.5 8v2L10 12" /></>,
  character: <><circle cx="10" cy="6.5" r="3" /><path d="M4.5 17a5.5 5.5 0 0 1 11 0M3 8.5l-1.5 1.5L3 11.5M17 8.5l1.5 1.5-1.5 1.5" /></>,
  split: <><rect x="2.5" y="3" width="15" height="14" rx="3" /><path d="M7.5 3v14M12.5 3v14" /></>,
  result: <><path d="m10 2.5 2 4 4.5.7-3.2 3.2.8 4.6-4.1-2.2L5.9 15l.8-4.6-3.2-3.2L8 6.5l2-4Z" /></>,
  preview: <><path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5Z" /><circle cx="10" cy="10" r="2" /></>,
  link: <><path d="m8 12-1.5 1.5a3 3 0 0 1-4.2-4.2l2.5-2.5A3 3 0 0 1 9 6.8M12 8l1.5-1.5a3 3 0 0 1 4.2 4.2l-2.5 2.5a3 3 0 0 1-4.2 0M7 10h6" /></>,
  lock: <><rect x="4" y="8" width="12" height="9" rx="2.5" /><path d="M7 8V6a3 3 0 0 1 6 0v2M10 11v3" /></>,
  unlock: <><rect x="4" y="8" width="12" height="9" rx="2.5" /><path d="M7 8V6a3 3 0 0 1 5.5-1.6M10 11v3" /></>,
  crop: <><path d="M6 3v11a2 2 0 0 0 2 2h9M3 6h11a2 2 0 0 1 2 2v9" /></>,
  edit: <><path d="m4 14.5-.5 3 3-.5L15.7 7.8a2 2 0 0 0-2.8-2.8L4 14.5Z" /><path d="m11.8 6.2 2.8 2.8" /></>,
  retry: <><path d="M15.5 7A6 6 0 1 0 16 12" /><path d="M15.5 3v4h-4" /></>,
  clear: <><path d="m6 4 10 10-3 3H8L3 12l6-6M4.5 10.5l5 5M3 17h4" /></>,
  send: <><path d="m3 9 14-6-5 14-2.2-5.2L3 9Z" /><path d="m9.8 11.8 3.7-3.7" /></>,
  candidate: <><path d="m10 3 2 4 4.5.7-3.2 3.2.8 4.6-4.1-2.2L5.9 15l.8-4.6-3.2-3.2L8 7l2-4Z" /></>,
  final: <><circle cx="10" cy="10" r="7" /><path d="m6.5 10 2.3 2.3 4.7-4.8" /></>,
  submitted: <><path d="m3 9 14-6-5 14-2.2-5.2L3 9Z" /><path d="m9.8 11.8 3.7-3.7" /></>,
  left: <><path d="M4 3v14M15 6l-4 4 4 4M11 10H5" /></>,
  right: <><path d="M16 3v14M5 6l4 4-4 4M9 10h6" /></>,
  up: <><path d="M3 4h14M6 15l4-4 4 4M10 11V5" /></>,
  down: <><path d="M3 16h14M6 5l4 4 4-4M10 9v6" /></>,
  distribute: <><path d="M3 4v12M17 4v12M7 6v8M13 6v8M7 10h6" /></>,
  autoArrange: <><path d="M5 3v4M3 5h4M15 13v4M13 15h4M12.5 3.5l4 4-8.5 8.5H4v-4l8.5-8.5Z" /></>,
  check: <path d="m4 10 4 4 8-8" />,
  external: <><path d="M9 4H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-4M11 3h6v6M17 3l-8 8" /></>,
  replace: <><path d="M4 7h10M11 4l3 3-3 3M16 13H6M9 10l-3 3 3 3" /></>,
  swap: <><path d="M6 5h8M11 2l3 3-3 3M14 15H6M9 12l-3 3 3 3" /></>,
  spark: <><path d="m10 2 1.4 4.6L16 8l-4.6 1.4L10 14l-1.4-4.6L4 8l4.6-1.4L10 2Z" /><path d="m16 13 .7 2.3L19 16l-2.3.7L16 19l-.7-2.3L13 16l2.3-.7L16 13Z" /></>,
  robot: <><rect x="4" y="6" width="12" height="11" rx="3" /><path d="M10 6V3H8M2 10v3M18 10v3M7 10v1M13 10v1M8 14h4" /></>,
  arrowUp: <path d="M10 16V4M5 9l5-5 5 5" />,
  mention: <><circle cx="10" cy="10" r="3" /><path d="M13 7v5a2 2 0 0 0 4 0v-2a7 7 0 1 0-3 5.75" /></>,
  stop: <rect x="5" y="5" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
  menu: <><path d="M4 6h12M4 10h12M4 14h12" /></>,
  home: <><path d="m3 9 7-6 7 6" /><path d="M5 8v8h10V8M8 16v-5h4v5" /></>,
  document: <><path d="M4 3.5h8.5L16 7v9.5H4Z" /><path d="M12.5 3.5V7H16M7 10h6M7 13h6" /></>,
  settings: <><circle cx="10" cy="10" r="2.6" /><path d="M8.4 3.2 9 2h2l.6 1.2 1.4.6 1.3-.4 1.4 1.4-.4 1.3.6 1.4 1.2.6v2l-1.2.6-.6 1.4.4 1.3-1.4 1.4-1.3-.4-1.4.6L11 18H9l-.6-1.2-1.4-.6-1.3.4-1.4-1.4.4-1.3-.6-1.4L2 11V9l1.2-.6.6-1.4-.4-1.3 1.4-1.4 1.3.4 1.4-.6.9-.9Z" /></>,
  key: <><circle cx="7.2" cy="9.2" r="3.7" /><path d="m10 11.8 6.4 6.4M13 14.8l1.8-1.8M15.2 17l1.8-1.8" /></>,
  database: <><ellipse cx="10" cy="5" rx="6.5" ry="2.8" /><path d="M3.5 5v5c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8V5M3.5 10v5c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8v-5" /></>,
  info: <><circle cx="10" cy="10" r="7" /><path d="M10 9v4M10 6.3h.01" /></>,
  history: <><path d="M4.2 6.2A7 7 0 1 1 3 10" /><path d="M3 3.5v4h4M10 6.5V10l2.5 1.5" /></>,
  language: <><circle cx="10" cy="10" r="7" /><path d="M3.3 10h13.4M10 3c2 2 3 4.3 3 7s-1 5-3 7c-2-2-3-4.3-3-7s1-5 3-7Z" /></>,
  github: <path fill="currentColor" stroke="none" transform="translate(2 2)" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.7 7.7 0 0 1 8 3.84c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />,
};

export function UiIcon({ name, className = '', ...props }: { name: UiIconName } & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  return <svg
    {...props}
    className={`ui-icon${className ? ` ${className}` : ''}`}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={props['aria-label'] ? undefined : true}
    focusable="false"
  >{shapes[name]}</svg>;
}

export function UiActionContent({ icon, children }: { icon: UiIconName; children: ReactNode }) {
  return <><UiIcon name={icon} /><span className="ui-action-label">{children}</span></>;
}
