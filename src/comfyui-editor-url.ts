function normalizedHostname(value: string) {
  return value.trim().replace(/^\[|\]$/g, '').toLowerCase();
}

function isLoopback(hostname: string) {
  return ['127.0.0.1', 'localhost', '::1'].includes(normalizedHostname(hostname));
}

export function validatedComfyUiEditorUrl(value: unknown, currentHostname: string) {
  let url: URL;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('ComfyUI 编辑器返回了无效的访问地址');
  }
  const expectedHostname = normalizedHostname(currentHostname);
  const actualHostname = normalizedHostname(url.hostname);
  const sameBrowserHost = actualHostname === expectedHostname
    || (isLoopback(actualHostname) && isLoopback(expectedHostname));
  if (url.protocol !== 'http:' || !url.port || url.username || url.password || !sameBrowserHost) {
    throw new Error('ComfyUI 编辑器返回了无效的访问地址');
  }
  return url.toString();
}
