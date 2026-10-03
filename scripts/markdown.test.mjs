import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownPreview from '../src/renderer/MarkdownPreview.tsx';
import { markdownForFeishu, markdownTitle, externalWebUrl, attachmentImageMarkdown, contentWithAttachmentImages, noteContentBlocks, removeAttachmentImages } from '../src/shared/markdown.ts';

const render = (content) => renderToStaticMarkup(createElement(MarkdownPreview, { content, locale: 'zh', onOpenLink: () => {} }));

test('Markdown preview renders headings, emphasis, nested lists, tasks, tables, quotes and code', () => {
  const html = render('# 标题\n\n**加粗**和*斜体* ~~划掉~~\n\n- 条目\n  - 子条目\n\n- [x] 完成\n- [ ] 待办\n\n| 列 | 值 |\n| --- | --- |\n| A | B |\n\n> 引用\n\n```js\nconst x = 1;\n```\n\n[飞书](https://open.feishu.cn)');
  for (const part of ['<h1>标题</h1>', '<strong>加粗</strong>', '<em>斜体</em>', '<del>划掉</del>', '<table>', '<blockquote>', '<pre>', 'language-js', 'type="checkbox"', 'checked=""', 'href="https://open.feishu.cn/"']) assert.ok(html.includes(part), part);
});

test('Markdown preview preserves single line breaks for LF, CRLF and CR notes', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const html = render(['**第一行**', '第二行', '[第三行](https://example.com)'].join(newline));
    assert.equal((html.match(/<br\/>/g) ?? []).length, 2, JSON.stringify(newline));
    assert.ok(html.includes('<strong>第一行</strong>'));
    assert.ok(html.includes('href="https://example.com/"'));
  }
});

test('Preview line breaks preserve paragraphs, quote and list continuations without changing code', () => {
  const html = render('第一段\n续行\n\n第二段\n\n> 引用第一行\n> 引用续行\n\n- 列表第一行\n  列表续行\n\n`inline\ncode`\n\n```text\nfirst\nsecond\n```');
  assert.equal((html.match(/<br\/>/g) ?? []).length, 3);
  assert.ok(html.includes('<p>第二段</p>'));
  assert.ok(html.includes('<blockquote>'));
  assert.ok(html.includes('<li>列表第一行'));
  assert.ok(html.includes('<code>inline code</code>'));
  assert.ok(html.includes('<pre><code class="language-text">first\nsecond\n</code></pre>'));
});

test('Markdown headings start on their own line with a space after the hash marks', () => {
  const body = '哭哭 客户计划客户看客户客户看客户 和 生意i也';
  const inline = render(`${body} ##发多少`);
  assert.ok(inline.includes(`${body} ##发多少`));
  assert.equal(inline.includes('<h2>'), false);
  const heading = render(`${body}\n\n## 发多少\n下一行`);
  assert.ok(heading.includes(`<p>${body}</p>`));
  assert.ok(heading.includes('<h2>发多少</h2>'));
  assert.ok(heading.includes('<p>下一行</p>'));
});

test('Markdown cannot execute HTML or open local and executable URL schemes', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29)\n\n[local](file:///etc/passwd)\n\n![local](/etc/passwd)\n\n![remote](https://example.com/image.png)');
  for (const forbidden of ['<script', 'onerror', 'href="javascript:', 'file://', 'src="/etc', 'src=""']) assert.equal(html.includes(forbidden), false, forbidden);
  assert.ok(html.includes('src="https://example.com/image.png"'));
  assert.ok(html.includes('referrerPolicy="no-referrer"'));
  for (const url of ['file:///tmp/file', '/relative/path', 'javascript:alert(1)', 'data:text/html,x', 'https://user:secret@example.com']) assert.equal(externalWebUrl(url), undefined);
});

test('Markdown titles come from the first line and keep plain display text', () => {
  assert.equal(markdownTitle('# **计划** [链接](https://example.com)\n正文'), '计划 链接');
  assert.equal(markdownTitle('\n# 第二行'), '');
  assert.equal(markdownTitle('普通文字\r\n另一行'), '普通文字');
});

test('Feishu image conversion preserves direct and referenced URLs without changing the source', () => {
  const original = '# 图片\n\n![截图](https://example.com/image.png)\n\n![第二张][photo]\n\n[photo]: https://example.com/second.png\n';
  const converted = markdownForFeishu(original);
  assert.equal(converted.imageLinks, true);
  assert.equal(converted.content.includes('!['), false);
  assert.ok(converted.content.includes('https://example.com/image.png'));
  assert.ok(converted.content.includes('https://example.com/second.png'));
  assert.ok(original.includes('![截图]'));
  assert.equal(markdownForFeishu('```md\n![literal](https://example.com/a)\n```').imageLinks, false);
});

const image = { id: 'local-image', name: '图[1].png', mimeType: 'image/png', size: 68, storedPath: '/managed/image.png', previewDataUrl: 'data:image/png;base64,YWJj' };

test('managed images split editable text before and after the image without interpreting code examples', () => {
  const marker = attachmentImageMarkdown(image);
  const content = `前面的文字\n\n${marker}\n\n后面的文字\n\n\`\`\`md\n${marker}\n\`\`\``;
  const blocks = noteContentBlocks(content, [image]);
  assert.deepEqual(blocks.map((block) => block.type), ['text', 'image', 'text']);
  assert.equal(blocks[0].text, '前面的文字');
  assert.ok(blocks[2].text.includes('后面的文字'));
  assert.equal(content.slice(blocks[1].start, blocks[1].end), marker);
  const removed = removeAttachmentImages(content, image.id);
  assert.ok(removed.includes(`\`\`\`md\n${marker}\n\`\`\``));
  assert.equal((removed.match(/attachment:local-image/g) ?? []).length, 1);
  assert.equal(noteContentBlocks(`![foreign](attachment:other)`, [image])[0].type, 'text');
});

test('old image attachments display without duplicating existing references or rewriting plain text', () => {
  const body = contentWithAttachmentImages('Original', [image]);
  assert.ok(body.startsWith('Original\n\n!'));
  assert.equal(contentWithAttachmentImages(body, [image]), body);
  assert.equal(contentWithAttachmentImages('Original', [{ ...image, mimeType: 'text/plain' }]), 'Original');
});

test('Markdown preview resolves only images belonging to the note and rejects local references as links', () => {
  const html = renderToStaticMarkup(createElement(MarkdownPreview, {
    content: `${attachmentImageMarkdown(image)}\n\n![other](attachment:other)\n\n[local](attachment:local-image)\n\n![raw](data:image/png;base64,abc)`,
    noteId: 'A', attachments: [image], locale: 'zh', onOpenLink: () => {},
  }));
  assert.ok(html.includes('src="data:image/png;base64,YWJj"'));
  assert.equal(html.includes('src="attachment:'), false);
  assert.equal(html.includes('href="attachment:'), false);
  assert.equal(html.includes('src="data:image/png;base64,abc"'), false);
});

test('Feishu receives an image name for local images without a local path or unusable attachment link', () => {
  const prepared = markdownForFeishu(attachmentImageMarkdown(image));
  assert.equal(prepared.imageLinks, false);
  assert.equal(prepared.content.includes('attachment:'), false);
  assert.equal(prepared.content.includes('/managed'), false);
  assert.ok(prepared.content.includes('图'));
});
