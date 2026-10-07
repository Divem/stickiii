import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNoteContent, contentWithAttachmentImages, noteContentBlocks, attachmentImageMarkdown } from '../src/shared/markdown.ts';
import { createNoteMatcher, noteSearchMatches } from '../src/renderer/noteSearch.ts';
import { noteListRange, noteListScroll } from '../src/renderer/noteListViewport.ts';
import { AttachmentPreviewCache } from '../src/renderer/attachmentPreviewCache.ts';

test('editor preparation keeps exact text, block offsets and code fences for current and legacy images', () => {
  const image = { id: 'image', name: '图[1].png', mimeType: 'image/png' };
  const second = { ...image, id: 'second' };
  const marker = attachmentImageMarkdown(image);
  for (const newline of ['\n', '\r\n', '\r']) {
    for (const content of ['', '# Heading', `before${newline}${newline}${marker}${newline}${newline}after`, `\`\`\`md${newline}${marker}${newline}\`\`\``, `\`\`\`md${newline}${marker}`]) {
      for (const attachments of [[], [image], [image, second]]) {
        const prepared = prepareNoteContent(content, attachments);
        const body = contentWithAttachmentImages(content, attachments);
        assert.equal(prepared.content, body);
        assert.deepEqual(prepared.blocks, noteContentBlocks(body, attachments));
        for (const block of prepared.blocks) if (block.type === 'text') assert.equal(body.slice(block.start, block.end), block.text);
      }
    }
  }
  const content = '普通文字 **强调**\n'.repeat(10_000);
  assert.deepEqual(prepareNoteContent(content, []), { content, blocks: [{ type: 'text', start: 0, end: content.length, text: content }] });
});

test('reused boolean search preserves literal Unicode matching without accumulating global regex state', () => {
  for (const query of ['Test.+', 'σ', 'ſ', '😀', '[', '\\', '工', 'missing']) {
    const match = createNoteMatcher(query);
    for (const content of ['TEST.+ σ Σ ς s ſ 😀 [ \\', '工作'.repeat(10_000), 'unrelated']) {
      const expected = noteSearchMatches(content, query).length > 0;
      for (let i = 0; i < 3; i++) assert.equal(match({ content, attachments: [] }), expected);
    }
  }
  assert.equal(createNoteMatcher('截图.PNG')({ content: '', attachments: [{ name: '截图.png' }] }), true);
});

test('list viewport stays bounded at either end, after shrinking results and keyboard wraparound', () => {
  for (const total of [0, 1, 100, 5_000, 10_000]) for (const height of [0, 80, 200, 280]) for (const top of [0, 1000, total * 54]) {
    const { start, end } = noteListRange(total, top, height, 54);
    assert.ok(start >= 0 && end >= start && end <= total);
    assert.ok(end - start <= Math.ceil(height / 54) + 8);
  }
  const lastTop = noteListScroll(0, 200, 4_999, 54);
  const last = noteListRange(5_000, lastTop, 200, 54);
  assert.ok(last.start <= 4_999 && last.end === 5_000);
  assert.equal(noteListScroll(lastTop, 200, 0, 54), 0);
  assert.equal(noteListScroll(0, 200, 1, 54), 0);
});

test('preview cache merges in-flight requests, isolates note identity, bounds memory and retries failures', async () => {
  const calls = [];
  let release;
  const cache = new AttachmentPreviewCache(async (note, image) => { calls.push([note, image]); if (calls.length === 1) await new Promise((resolve) => { release = resolve; }); return image; }, 32, 2);
  const one = cache.get('A', 'waiting'); const two = cache.get('A', 'waiting');
  assert.equal(one, two); release(); await one;
  await cache.get('A', 'waiting'); assert.equal(calls.length, 1);
  await cache.get('B', 'waiting'); assert.equal(calls.length, 2);
});

test('preview LRU evicts by both entry count and UTF-16 byte budget, and does not cache errors', async () => {
  const calls = [];
  let fail = true;
  const cache = new AttachmentPreviewCache(async (_note, id) => { calls.push(id); if (id === 'error' && fail) throw Error('failed'); return id; }, 12, 2);
  await cache.get('A', 'aa'); await cache.get('A', 'bb'); await cache.get('A', 'aa');
  await cache.get('A', 'cc'); await cache.get('A', 'bb');
  assert.deepEqual(calls, ['aa', 'bb', 'cc', 'bb']);
  await cache.get('A', 'oversized'); await cache.get('A', 'oversized');
  assert.equal(calls.filter((id) => id === 'oversized').length, 2);
  await assert.rejects(cache.get('A', 'error')); fail = false; await cache.get('A', 'error');
  assert.equal(calls.filter((id) => id === 'error').length, 2);
});
