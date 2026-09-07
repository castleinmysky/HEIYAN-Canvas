/// <reference types="vite/client" />
import { Component, StrictMode, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import './mobile-canvas.css';
import './mobile-pages.css';
import './viewport-shell.css';

// Agent mode is another view of the same canvas, not a second fixture workspace.
const App = lazy(() => import('./App'));

type AppErrorBoundaryState = {
  error: Error | null;
  resetKey: number;
};

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AI Canvas render failed', error, info.componentStack);
  }

  retry = () => {
    this.setState((state) => ({ error: null, resetKey: state.resetKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return <main className="app-error" role="alert">
        <section className="app-error-panel">
          <span className="app-error-code">AI CANVAS</span>
          <h1>画布显示遇到异常</h1>
          <p>本地画布数据不会被清除。你可以先重新打开画布；如果仍未恢复，再重新加载页面。</p>
          <details>
            <summary>查看错误信息</summary>
            <code>{this.state.error.message || '未知渲染错误'}</code>
          </details>
          <div className="app-error-actions">
            <button className="primary" onClick={this.retry}>重新打开画布</button>
            <button onClick={() => window.location.reload()}>重新加载页面</button>
          </div>
        </section>
      </main>;
    }

    return <div key={this.state.resetKey} className="app-boundary-root">{this.props.children}</div>;
  }
}

const root = import.meta.hot?.data.reactRoot ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.reactRoot = root;
root.render(
  <StrictMode>
    <AppErrorBoundary>
      <Suspense fallback={<div role="status">正在打开画布…</div>}>
        <App />
      </Suspense>
    </AppErrorBoundary>
  </StrictMode>,
);
