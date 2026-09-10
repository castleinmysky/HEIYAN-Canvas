import { Fragment, type ReactNode } from 'react';

// A deliberately small, inert Markdown subset. Model text never becomes HTML,
// embeds, scripts or executable canvas actions; streaming fragments stay readable.
function inline(text: string): ReactNode[] {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  const nodes: ReactNode[] = [];
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index!;
    nodes.push(text.slice(start, at));
    const token = match[0];
    if (token.startsWith('`')) nodes.push(<code key={at}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('**')) nodes.push(<strong key={at}>{token.slice(2, -2)}</strong>);
    else {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(token)!;
      let safe = false;
      try { safe = ['https:', 'http:'].includes(new URL(link[2]).protocol); } catch { /* Display unsafe or relative URLs as text. */ }
      nodes.push(safe ? <a key={at} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a> : token);
    }
    start = at + token.length;
  }
  nodes.push(text.slice(start));
  return nodes;
}

export function AgentMessageBody({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  const isList = (line: string) => /^\s*(?:[-*+] |\d+[.)] )/.test(line);
  const boundary = (line: string) => !line.trim() || /^```|^#{1,6} |^> /.test(line) || isList(line);
  for (let i = 0; i < lines.length;) {
    const key = i;
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim(); const code: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(<figure className="agent-message-code" key={key}>{language && <figcaption>{language}</figcaption>}<pre tabIndex={0} aria-label="代码内容"><code>{code.join('\n')}</code></pre></figure>);
    } else if (/^#{1,6} /.test(line)) {
      blocks.push(<h3 key={key}>{inline(line.replace(/^#{1,6} /, ''))}</h3>); i++;
    } else if (isList(line)) {
      const ordered = /^\s*\d+[.)] /.test(line);
      const start = ordered ? Number(line.trim().match(/^\d+/)![0]) : undefined;
      const items: ReactNode[] = [];
      while (i < lines.length && isList(lines[i]) && /^\s*\d+[.)] /.test(lines[i]) === ordered) {
        items.push(<li key={i}>{inline(lines[i++].replace(/^\s*(?:[-*+] |\d+[.)] )/, ''))}</li>);
      }
      blocks.push(ordered ? <ol start={start} key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    } else if (line.startsWith('> ')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) quote.push(lines[i++].slice(2));
      blocks.push(<blockquote key={key}>{inline(quote.join('\n'))}</blockquote>);
    } else {
      const paragraph = [lines[i++]];
      while (i < lines.length && !boundary(lines[i])) paragraph.push(lines[i++]);
      blocks.push(<p key={key}>{paragraph.map((part, index) => <Fragment key={index}>{index > 0 && <br />}{inline(part)}</Fragment>)}</p>);
    }
  }
  return <div className="agent-message-prose">{blocks}</div>;
}
