import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { prepareNoteContent, attachmentImageMarkdown } from '../src/shared/markdown.ts';
import { createNoteMatcher } from '../src/renderer/noteSearch.ts';

function measure(name, run) {
  run();
  const times = Array.from({ length: 7 }, () => { const start = performance.now(); run(); return performance.now() - start; }).sort((a, b) => a - b);
  return { name, medianMs: times[3], maxMs: times[6] };
}
const paragraph = '# 项目记录\n\n- [ ] 处理任务，补充文档，检查相关变化。\n- 普通内容 **强调说明** [参考](https://example.com)\n\n';
const results = [];
for (const size of [2, 10, 50, 100]) {
  const content = paragraph.repeat(Math.ceil(size * 1024 / paragraph.length)).slice(0, size * 1024);
  results.push(measure(`editor-${size}KiChars`, () => prepareNoteContent(content, [])));
}
const image = { id: 'image', name: 'fixture.png', mimeType: 'image/png' };
const content = paragraph.repeat(100) + '\n\n' + attachmentImageMarkdown(image) + '\n\n';
results.push(measure('editor-image', () => prepareNoteContent(content, [image])));
const notes = Array.from({ length: 5_000 }, () => ({ content: '工作记录数据\n'.repeat(300), attachments: [] }));
const matches = createNoteMatcher('工');
results.push(measure('search-5000-frequent-char', () => notes.filter(matches)));
const built = await build({ build: { write: false }, logLevel: 'error' });
const chunks = built.output.filter((file) => file.type === 'chunk').map((file) => ({ name: file.fileName, entry: file.isEntry, bytes: Buffer.byteLength(file.code), gzipBytes: gzipSync(file.code).length }));
console.log(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, samples: 7, results, chunks }, null, 2));
