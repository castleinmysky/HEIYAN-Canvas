import './styles.css';
import './trial.css';
import { createTrialRequestBridge } from './trial-request-bridge.js';
import { createCloudApi } from './cloud/api.js';
import { createLocalComfyApi } from './local-comfy-api.js';

async function openTrial() {
  // Every editing route, including Agent mode, uses the same device-local store.
  if (!('indexedDB' in window)) throw new Error('This browser cannot save the trial workspace. Please use a current desktop browser.');
  const nativeFetch = window.fetch.bind(window);
  const localApi = createLocalComfyApi({ origin: location.origin, nativeFetch, baseApi: createCloudApi({ origin: location.origin, nativeFetch }) });
  const bridge = createTrialRequestBridge({ origin: location.origin, nativeFetch, localApi });
  window.fetch = bridge.fetch;
  const check = await fetch('/api/v1/health');
  if (!check.ok || !(await check.json()).browserLocal) throw new Error('The browser-local workspace could not be initialized.');
  await import('./main');
  // Storage guidance lives in Settings / About, not a permanent canvas overlay.
}

openTrial().catch((error) => {
  const panel = document.createElement('main'); panel.className = 'trial-start-error';
  const title = document.createElement('h1'); title.textContent = 'HEIYAN';
  const message = document.createElement('p'); message.textContent = String(error.message || error);
  const retry = document.createElement('button'); retry.textContent = 'Reload / 重新加载'; retry.onclick = () => location.reload();
  panel.append(title, message, retry); document.getElementById('root')!.replaceChildren(panel);
});
