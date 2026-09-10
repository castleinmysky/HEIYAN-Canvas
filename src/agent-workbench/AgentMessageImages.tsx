import { useEffect, useRef, useState } from 'react';
import { readMessageImages } from './message-images';
import './AgentMessageImages.css';
export function AgentMessageImages({ canvasKey, messageId }: { canvasKey: string; messageId: string }) {
  const [images, setImages] = useState<string[]>([]), [selected, setSelected] = useState<string>('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { let current = true; setImages([]); void readMessageImages(canvasKey, messageId).then(value => { if (current) setImages(value); }).catch(() => {}); return () => { current = false; }; }, [canvasKey, messageId]);
  if (!images.length) return null;
  return <div className="agent-sent-images" aria-label="已发送图片">
    {images.map((url, i) => <button key={i} type="button" aria-label={`查看附图 ${i + 1}`} onClick={() => { setSelected(url); dialog.current?.showModal(); }}><img loading="lazy" src={url} alt={`附图 ${i + 1}`} /></button>)}
    <dialog ref={dialog} className="agent-sent-image-viewer" aria-label="附图预览"><button type="button" aria-label="关闭附图" onClick={() => dialog.current?.close()}>×</button>{selected && <img src={selected} alt="已发送的原图" />}</dialog>
  </div>;
}
