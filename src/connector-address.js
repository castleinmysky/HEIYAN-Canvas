export const localConnectorUrl = 'http://127.0.0.1:8289';
export function connectorAddress(value = localConnectorUrl) {
  const raw = String(value).trim();
  if (raw === localConnectorUrl || raw === localConnectorUrl + '/') return localConnectorUrl;
  let url;
  try { url = new URL(raw); } catch { throw new Error('Enter the HTTPS address shown by the remote connector.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i.test(url.hostname)
    || /(?:^|\.)(?:localhost|local|internal|lan|home|invalid)$/i.test(url.hostname)) {
    throw new Error('Use a public HTTPS origin without a path, query, or credentials.');
  }
  return url.origin;
}
