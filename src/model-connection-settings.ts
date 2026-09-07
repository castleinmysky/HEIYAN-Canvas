import { advancedConnectionEligible, connectionDefaults, connectionProtocols, type ConnectionSettings } from '../shared/model-connection-settings.js';
export { advancedConnectionEligible, connectionProtocols };
export type { ConnectionSettings, ConnectionProtocol } from '../shared/model-connection-settings.js';
export type ConnectionLanguage = 'zh' | 'en';
export function connectionDraft(model: { adapter: string; config?: { [key: string]: unknown } }): ConnectionSettings {
  const config = model.config || {};
  const defaults = connectionDefaults(model.adapter, typeof config.model === 'string' ? config.model : '');
  const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : defaults.baseUrl;
  const mode = config.connectionMode === 'official' ? 'official' : config.connectionMode === 'relay' ? 'relay' : baseUrl === defaults.baseUrl ? 'official' : 'relay';
  const result = { ...defaults, baseUrl, mode } as ConnectionSettings;
  if (mode === 'relay') for (const key of ['endpoint', 'editEndpoint', 'queryEndpoint', 'validationEndpoint'] as const) {
    if (typeof config[key] === 'string' && !(key === 'endpoint' && model.adapter === 'tripo3d-model')) result[key] = config[key];
  }
  return result;
}
export function isAdvancedRowSurface(target: { closest: (selector: string) => unknown } | null) {
  return Boolean(target && !target.closest('button,input,select,textarea,label,a,[role="button"],[contenteditable="true"]'));
}
type Focusable = { focus: () => void };
type KeyLike = { key: string; shiftKey?: boolean; preventDefault: () => void; stopPropagation: () => void };
export function createConnectionFocusController({ focusables, active, opener, cancel }: {
  focusables: () => Focusable[]; active: () => Focusable | null; opener?: Focusable | null; cancel: () => void;
}) {
  return {
    activate() { focusables()[0]?.focus(); },
    deactivate() { opener?.focus(); },
    keydown(event: KeyLike) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); return; }
      const index = items.indexOf(active()!);
      if (index < 0 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault(); (event.shiftKey ? items.at(-1) : items[0])?.focus();
      }
    },
  };
}
export const connectionCopy = (language: ConnectionLanguage) => language === 'en' ? {
  title: 'Advanced API connection', advanced: 'Advanced', description: 'Configure only this model. The relay must implement the selected protocol.',
  protocol: 'Provider protocol', mode: 'Connection type', official: 'Official API', relay: 'Compatible relay',
  baseUrl: 'Base URL', model: 'Model ID', endpoint: 'Generation path', editEndpoint: 'Image edit path', queryEndpoint: 'Task query path',
  validationEndpoint: 'Read-only verification path', derived: 'Determined by the selected Tripo workflow',
  key: 'API key', keyHint: 'Leave empty to retain the saved key only when the protocol and origin stay unchanged. A new protocol or origin requires a new key.',
  keyPlaceholder: 'Enter a new API key', cancel: 'Cancel', submit: 'Verify and save', working: 'Verifying…',
  officialHint: 'Official addresses and paths are fixed by the server.', relayHint: 'Only use a trusted HTTPS relay. Your new key will be sent to the displayed destination.',
  verificationHint: 'Verification sends a read-only request. It does not generate content or test paid model output.',
  failure: 'Connection was not saved. Check the settings and try again.', newKey: 'Enter a new key for the changed protocol or origin.',
  invalid: 'Check the HTTPS destination, model ID and same-origin endpoint paths.', unavailable: 'This model does not support advanced API connections.',
  ready: 'Connection verified and saved.',
} : {
  title: '高级 API 连接', advanced: '高级', description: '仅配置当前模型。中转服务必须兼容所选协议。',
  protocol: '服务商协议', mode: '连接方式', official: '官方 API', relay: '兼容中转',
  baseUrl: '基础地址', model: '模型 ID', endpoint: '生成路径', editEndpoint: '图片编辑路径', queryEndpoint: '任务查询路径',
  validationEndpoint: '只读验证路径', derived: '由所选 Tripo 工作流自动确定',
  key: 'API 密钥', keyHint: '协议和服务域名不变时，留空可保留已保存的密钥；更换协议或域名必须填写新密钥。',
  keyPlaceholder: '填写新的 API 密钥', cancel: '取消', submit: '验证并保存', working: '正在验证…',
  officialHint: '官方地址和路径由服务器固定。', relayHint: '仅使用可信的 HTTPS 中转。新密钥将发送到当前显示的服务地址。',
  verificationHint: '验证仅发送只读请求，不会生成内容，也不会测试付费模型输出。',
  failure: '连接未保存，请检查设置后重试。', newKey: '协议或域名已更改，请填写新的密钥。',
  invalid: '请检查 HTTPS 地址、模型 ID 与同源接口路径。', unavailable: '该模型不支持高级 API 连接。',
  ready: '连接已验证并保存。',
};
