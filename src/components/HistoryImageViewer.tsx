import { useEffect, useRef, useState } from 'react';
import './HistoryImageViewer.css';

export type ImageView = { x: number; y: number; zoom: number };
export function zoomHistoryImage(view: ImageView, point: { x: number; y: number }, delta: number): ImageView {
  const zoom = Math.max(.25, Math.min(12, view.zoom * Math.exp(-Math.max(-240, Math.min(240, delta)) * .002)));
  return { zoom, x: point.x - (point.x - view.x) * zoom / view.zoom, y: point.y - (point.y - view.y) * zoom / view.zoom };
}
const initial: ImageView = { x: 0, y: 0, zoom: 1 };

/** A bounded viewport: original image fits completely, independent of its aspect ratio. */
export function HistoryImageViewer({ src, alt }: { src: string; alt: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ImageView>(initial);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  useEffect(() => { setView(initial); setFailed(false); }, [src]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      const rect = el.getBoundingClientRect();
      setView(current => zoomHistoryImage(current, { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }, event.deltaY * (event.deltaMode === 1 ? 16 : 1)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  return <div ref={frame} className="history-image-viewer nowheel nodrag" tabIndex={0} aria-label="图片预览：滚轮缩放，中键拖动，双击适应窗口"
    onDoubleClick={() => setView(initial)}
    onPointerDown={event => {
      if ((event.button !== 0 && event.button !== 1) || (event.target as Element).closest('button')) return;
      event.preventDefault(); event.stopPropagation();
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const previous = drag.current;
      if (!previous || previous.id !== event.pointerId) return;
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      setView(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
    }}
    onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onAuxClick={event => { if (event.button === 1) event.preventDefault(); }}
    onKeyDown={event => {
      if (event.key === '0') setView(initial);
      else if (event.key === '+' || event.key === '=') setView(current => zoomHistoryImage(current, { x: 0, y: 0 }, -120));
      else if (event.key === '-') setView(current => zoomHistoryImage(current, { x: 0, y: 0 }, 120));
      else return;
      event.preventDefault(); event.stopPropagation();
    }}>
    {failed ? <p role="status">图片暂时无法读取，请确认生成文件仍然可用。</p> : <img src={src} alt={alt} draggable={false} decoding="async" onError={() => setFailed(true)} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }} />}
    <div className="history-image-controls"><button type="button" aria-label="缩小图片" onClick={() => setView(current => zoomHistoryImage(current, { x: 0, y: 0 }, 120))}>−</button><span>{Math.round(view.zoom * 100)}%</span><button type="button" aria-label="放大图片" onClick={() => setView(current => zoomHistoryImage(current, { x: 0, y: 0 }, -120))}>+</button><button type="button" onClick={() => setView(initial)}>适应窗口</button></div>
  </div>;
}
