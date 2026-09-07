/** UI contract only: execution must be supplied by the authenticated canvas adapter. */
export type CreativeAssetKind = 'image' | 'video' | 'audio' | 'model' | 'text';
export type CreativeAsset = {
  id: string;
  nodeId: string;
  kind: CreativeAssetKind;
  name: string;
  url?: string;
  previewUrl?: string;
  text?: string;
  width?: number;
  height?: number;
  sample?: boolean;
};
export type CreativeStage = {
  id: string;
  title: string;
  state: 'ready' | 'running' | 'pending' | 'error';
  detail: string;
};
export type AgentConnection = 'disconnected' | 'connecting' | 'connected' | 'error' | 'preview';
export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  reference?: CreativeAsset;
  references?: { token: string; asset: CreativeAsset }[];
  sample?: boolean;
};

export function assetKindForFile(file: Pick<File, 'name' | 'type'>): CreativeAssetKind | null {
  if (/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) return 'image';
  if (/^video\/(mp4|webm|quicktime)$/.test(file.type)) return 'video';
  if (/^audio\//.test(file.type)) return 'audio';
  if (/\.(glb|gltf)$/i.test(file.name)) return 'model';
  if (/\.(txt|md)$/i.test(file.name)) return 'text';
  return null;
}

export function nextAssetId(assets: CreativeAsset[], currentId: string, delta: number) {
  if (!assets.length) return null;
  const index = Math.max(0, assets.findIndex(asset => asset.id === currentId));
  return assets[((index + delta) % assets.length + assets.length) % assets.length].id;
}

export function canSendToAgent(connection: AgentConnection, draft: string, busy: boolean) {
  return connection === 'connected' && !!draft.trim() && !busy;
}

export const assetKindLabels: Record<CreativeAssetKind, string> = {
  image: '图片', video: '视频', audio: '音频', model: '3D 模型', text: '文本',
};
