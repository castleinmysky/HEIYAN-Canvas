import { useRef, useState } from 'react';
import type { JobSnapshot } from './agent-jobs';
import { canvasAssetDownloadUrl, nodeResourceDownloadFileName, type DownloadMediaType } from '../media-download';
import './agent-media-gallery.css';

export function safeChatMediaUrl(value?: string) {
  return !!value && /^(https?:\/\/|blob:|\/(?!\/))/i.test(value) && !/[\s\\\u0000-\u001f]/.test(value);
}

export function AgentMediaGallery({ job }: { job: JobSnapshot }) {
  const [selected, setSelected] = useState(0);
  const [limit, setLimit] = useState(6);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const outputs = job.outputs.filter(output => safeChatMediaUrl(output.mediaUrl));
  const output = outputs[Math.min(selected, Math.max(0, outputs.length - 1))];
  const type: DownloadMediaType = ['image', 'video', 'audio'].includes(job.type) ? job.type as DownloadMediaType : 'model';
  const download = (url: string, index: number) => {
    const name = nodeResourceDownloadFileName(`${job.title}${outputs.length > 1 ? ` ${index + 1}` : ''}`, undefined, url, type);
    return <a href={canvasAssetDownloadUrl(url, name)} download={name} target="_blank" rel="noopener noreferrer">下载{outputs.length > 1 ? ` ${index + 1}` : ''}</a>;
  };
  if (!output) return <p>本次结果暂不可访问，请在画布查看。</p>;
  return <div className="agent-media-gallery">
    <div className="agent-media-grid" data-type={type} data-multiple={outputs.length > 1}>
      {outputs.slice(0, limit).map((item, index) => <div className="agent-media-item" key={`${index}:${item.mediaUrl}`}>
        {type === 'image' ? <button type="button" className="agent-media-open" aria-label={`放大 ${job.title} 第 ${index + 1} 张`} onClick={() => { setSelected(index); setOpen(true); dialog.current?.showModal(); }}>
          <img loading="lazy" decoding="async" src={safeChatMediaUrl(item.previewUrl) ? item.previewUrl : item.mediaUrl} alt={`${job.title} ${index + 1}`} />
        </button> : type === 'video' ? <video controls playsInline preload="none" src={item.mediaUrl} poster={safeChatMediaUrl(item.previewUrl) ? item.previewUrl : undefined} />
          : type === 'audio' ? <audio controls preload="none" src={item.mediaUrl} /> : <p>3D 文件 · {job.title}</p>}
        {download(item.mediaUrl!, index)}
      </div>)}
    </div>
    {outputs.length > limit && <button type="button" onClick={() => setLimit(n => n + 6)}>再显示 {Math.min(6, outputs.length - limit)} 个结果</button>}
    {type === 'image' && <dialog ref={dialog} onClose={() => setOpen(false)} className="agent-media-viewer" aria-label="查看生成图片" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} onKeyDown={event => {
      if (event.key === 'ArrowLeft') setSelected(n => Math.max(0, n - 1));
      if (event.key === 'ArrowRight') setSelected(n => Math.min(outputs.length - 1, n + 1));
    }}>
      <header><span>{job.title} · {selected + 1} / {outputs.length}</span><button type="button" aria-label="关闭图片" onClick={() => dialog.current?.close()}>×</button></header>
      {open && <img src={output.mediaUrl} alt={job.title} />}
      <footer><button type="button" disabled={selected === 0} onClick={() => setSelected(n => n - 1)}>上一张</button>{download(output.mediaUrl!, selected)}<button type="button" disabled={selected >= outputs.length - 1} onClick={() => setSelected(n => n + 1)}>下一张</button></footer>
    </dialog>}
  </div>;
}
