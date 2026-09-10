import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentMessageBody } from './AgentMessageBody';

describe('Agent reply presentation', () => {
  const render = (text: string) => renderToStaticMarkup(<AgentMessageBody text={text} />);
  it('renders readable paragraphs, headings, emphasis and lists', () => {
    const html = render('## 镜头方案\n\n先确认**角色**。\n下一步。\n\n- 场景\n- 动作\n\n3. 镜头\n4. 配音');
    expect(html).toContain('<h3>镜头方案</h3>');
    expect(html).toContain('<strong>角色</strong>');
    expect(html).toContain('<br/>');
    expect(html).toContain('<ul><li>场景</li><li>动作</li></ul>');
    expect(html).toContain('<ol start="3">');
  });
  it('keeps HTML inert and disallows executable and embedded links', () => {
    const html = render('<img src=x onerror=alert(1)>\n\n[危险](javascript:alert) [数据](data:text/html,test) [网页](https://example.com)');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('handles incomplete streaming fences and leaves code unformatted', () => {
    const html = render('```json\n{"text":"**角色**"}');
    expect(html).toContain('<figcaption>json</figcaption>');
    expect(html).toContain('**角色**');
    expect(html).not.toContain('<strong>');
  });
  it('preserves empty, literal fragments and quotes without crashing', () => {
    expect(render('')).toContain('agent-message-prose');
    expect(render('**未完成')).toContain('**未完成');
    expect(render('> 引用\n> 第二行')).toContain('<blockquote>');
    expect(render('`节点`')).toContain('<code>节点</code>');
  });
});
