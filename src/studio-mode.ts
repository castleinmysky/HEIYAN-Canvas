export type StudioMode = 'task' | 'admin-standalone' | 'public';

export function resolveStudioMode(pathname: string, search: string): StudioMode {
  if (pathname === '/public' || pathname.startsWith('/public/')) return 'public';
  return new URLSearchParams(search).get('mode') === 'admin-standalone' ? 'admin-standalone' : 'task';
}

export function hasBoundCanvasTask(mode: StudioMode, search: string): boolean {
  void search;
  return mode === 'public' || mode === 'admin-standalone' || mode === 'task';
}
