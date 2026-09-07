import os from 'node:os';
import path from 'node:path';

const APP_FOLDER = 'Echo AI Canvas';
const APP_SLUG = 'echo-ai-canvas';

function absolute(value) {
  return value ? path.resolve(String(value)) : '';
}

export function resolveRuntimePaths(environment = process.env, platform = process.platform, homeDirectory = os.homedir()) {
  const sharedRoot = absolute(environment.ECHO_HOME);
  if (sharedRoot) return {
    root: sharedRoot,
    config: absolute(environment.ECHO_CONFIG_DIR) || path.join(sharedRoot, 'config'),
    data: absolute(environment.ECHO_DATA_DIR) || path.join(sharedRoot, 'data'),
    private: absolute(environment.ECHO_PRIVATE_DIR) || path.join(sharedRoot, 'private'),
    cache: absolute(environment.ECHO_CACHE_DIR) || path.join(sharedRoot, 'cache'),
    logs: absolute(environment.ECHO_LOG_DIR) || path.join(sharedRoot, 'logs')
  };

  if (platform === 'win32') {
    const root = path.join(absolute(environment.LOCALAPPDATA) || path.join(homeDirectory, 'AppData', 'Local'), APP_FOLDER);
    return {
      root,
      config: absolute(environment.ECHO_CONFIG_DIR) || path.join(root, 'config'),
      data: absolute(environment.ECHO_DATA_DIR) || path.join(root, 'data'),
      private: absolute(environment.ECHO_PRIVATE_DIR) || path.join(root, 'private'),
      cache: absolute(environment.ECHO_CACHE_DIR) || path.join(root, 'cache'),
      logs: absolute(environment.ECHO_LOG_DIR) || path.join(root, 'logs')
    };
  }

  if (platform === 'darwin') {
    const support = path.join(homeDirectory, 'Library', 'Application Support', APP_FOLDER);
    return {
      root: support,
      config: absolute(environment.ECHO_CONFIG_DIR) || path.join(support, 'config'),
      data: absolute(environment.ECHO_DATA_DIR) || path.join(support, 'data'),
      private: absolute(environment.ECHO_PRIVATE_DIR) || path.join(support, 'private'),
      cache: absolute(environment.ECHO_CACHE_DIR) || path.join(homeDirectory, 'Library', 'Caches', APP_FOLDER),
      logs: absolute(environment.ECHO_LOG_DIR) || path.join(homeDirectory, 'Library', 'Logs', APP_FOLDER)
    };
  }

  const dataRoot = path.join(absolute(environment.XDG_DATA_HOME) || path.join(homeDirectory, '.local', 'share'), APP_SLUG);
  const configRoot = path.join(absolute(environment.XDG_CONFIG_HOME) || path.join(homeDirectory, '.config'), APP_SLUG);
  return {
    root: dataRoot,
    config: absolute(environment.ECHO_CONFIG_DIR) || configRoot,
    data: absolute(environment.ECHO_DATA_DIR) || path.join(dataRoot, 'data'),
    private: absolute(environment.ECHO_PRIVATE_DIR) || path.join(dataRoot, 'private'),
    cache: absolute(environment.ECHO_CACHE_DIR) || path.join(absolute(environment.XDG_CACHE_HOME) || path.join(homeDirectory, '.cache'), APP_SLUG),
    logs: absolute(environment.ECHO_LOG_DIR) || path.join(absolute(environment.XDG_STATE_HOME) || path.join(homeDirectory, '.local', 'state'), APP_SLUG, 'logs')
  };
}

export function publicRuntimePaths(paths) {
  return {
    projects: path.join(paths.data, 'projects.json'),
    assets: path.join(paths.data, 'assets'),
    outputs: path.join(paths.data, 'outputs'),
    userWorkflows: path.join(paths.data, 'workflows'),
    settings: path.join(paths.config, 'settings.json'),
    cache: paths.cache,
    logs: paths.logs,
    models: '由 ComfyUI 或外部模型服务管理，画布不复制权重'
  };
}
