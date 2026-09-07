import path from 'node:path';
import { createApp } from './app.js';
import { resolveRuntimePaths } from './paths.js';

const port = Number(process.env.PORT || 8792);
const host = process.env.HOST || '127.0.0.1';
const paths = resolveRuntimePaths();
createApp({ dataDir: paths.data, privateDir: paths.private, runtimePaths: paths }).listen(port, host, () => {
  const visibleHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  console.log(`Echo AI Canvas Open Source: http://${visibleHost}:${port}`);
});
