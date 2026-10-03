import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeishuAdapter } from '../src/platform/sync/feishu.ts';
import { prepareBlockBatches } from '../src/platform/sync/feishuApi.ts';

const credentials = { appId: 'cli_test', appSecret: 'test-secret', collaboratorEmail: 'owner@example.com', updatedAt: '' };
const fixtureNote = { id: 'note-1', content: '# 一条便签\n\n**内容**', attachments: [], createdAt: '', updatedAt: '', syncState: 'local' };
const ok = (data) => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
const failure = (code, status = 400) => new Response(JSON.stringify({ code, msg: 'fixture error' }), { status });

function harness() {
  const state = { calls: [], documentId: 'doc_test_123', revision: 1, title: '', children: [], created: 0, media: 0, link: undefined, intercept: undefined };
  const fetcher = async (url, options) => {
    assert.ok(url.startsWith('https://open.feishu.cn/open-apis/'));
    const parsed = new URL(url);
    const path = parsed.pathname.replace('/open-apis', '');
    const body = options.body ? JSON.parse(options.body) : undefined;
    const request = { path, method: options.method, body, query: parsed.searchParams, headers: options.headers };
    state.calls.push(request);
    const interrupted = await state.intercept?.(request);
    if (interrupted) return interrupted;
    if (path.endsWith('/tenant_access_token/internal')) {
      assert.deepEqual(body, { app_id: credentials.appId, app_secret: credentials.appSecret });
      return new Response(JSON.stringify({ code: 0, tenant_access_token: 'fixture-token', expire: 7200 }));
    }
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    if (path.endsWith('/blocks/convert')) {
      assert.equal(body.content_type, 'markdown');
      return ok({ first_level_block_ids: ['heading', 'paragraph'], blocks: [
        { block_id: 'heading', block_type: 3, heading1: { elements: [{ text_run: { content: '一条便签' } }] } },
        { block_id: 'paragraph', block_type: 2, text: { elements: [{ text_run: { content: '内容' } }] } },
      ] });
    }
    if (path === '/docx/v1/documents' && options.method === 'POST') {
      assert.equal(state.link.creationPending, true, 'creation is checkpointed before remote write');
      state.created++;
      state.title = body.title;
      return ok({ document: { document_id: state.documentId, revision_id: state.revision, title: state.title } });
    }
    if (path === `/docx/v1/documents/${state.documentId}` && options.method === 'GET') {
      return ok({ document: { document_id: state.documentId, revision_id: state.revision, title: state.title } });
    }
    if (path.includes('/permissions/')) {
      assert.equal(parsed.searchParams.get('type'), 'docx');
      assert.equal(parsed.searchParams.get('need_notification'), 'false');
      assert.deepEqual(body, { member_type: 'email', member_id: credentials.collaboratorEmail, perm: 'edit', type: 'user' });
      return ok({ member: body });
    }
    if (path.endsWith('/children') && options.method === 'POST') {
      const type = body.children[0].block_type;
      const id = `media_${++state.media}`;
      state.children.push(id);
      state.revision++;
      return ok({ document_revision_id: state.revision, children: [{ block_id: id, block_type: type, [type === 27 ? 'image' : 'file']: {} }] });
    }
    if (path === '/drive/v1/medias/upload_all') {
      assert.equal(body.attachment_id, 'file');
      assert.equal(body.parent_type, 'docx_file');
      return ok({ file_token: `token_${body.attachment_id}` });
    }
    if (options.method === 'GET') return ok({ block: { block_id: state.documentId, block_type: 1, children: [...state.children] } });
    assert.equal(state.link.documentId, state.documentId, 'identity saved before content writes');
    assert.equal(Number(parsed.searchParams.get('document_revision_id')), state.revision);
    assert.match(parsed.searchParams.get('client_token'), /^[0-9a-f-]{36}$/);
    if (path.endsWith('/descendant')) {
      assert.equal(body.index, -1);
      state.children.push(...body.children_id.map((id) => `${id}_${state.revision}`));
    } else if (path.endsWith('/children/batch_delete')) {
      assert.equal(body.start_index, 0);
      assert.ok(body.end_index < state.children.length, 'new content is staged before deleting old content');
      state.children.splice(body.start_index, body.end_index - body.start_index);
    } else if (options.method === 'PATCH' && body.update_text_elements) state.title = body.update_text_elements.elements[0].text_run.content;
    else if (options.method === 'PATCH' && (body.replace_image || body.replace_file)) { /* media binding */ }
    else assert.fail(`Unexpected request: ${options.method} ${path}`);
    state.revision++;
    return ok({ document_revision_id: state.revision });
  };
  const adapter = createFeishuAdapter(fetcher, 0);
  const context = { provider: 'feishu', credentials, saveFeishuDocument: async (link) => { state.link = structuredClone(link); } };
  return { state, adapter, context, run: (note = fixtureNote, options) => adapter.sync({ ...note, feishu: state.link }, { ...context, options }) };
}

test('first sync authenticates, writes Markdown blocks, grants edit access, verifies, and returns a document URL', async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(result.status, 'synced');
  assert.equal(result.remoteUrl, `https://feishu.cn/docx/${h.state.documentId}`);
  assert.equal(h.state.title, '一条便签');
  assert.equal(h.state.created, 1);
  assert.equal(h.state.children.length, 2);
  assert.equal(h.state.link.revisionId, h.state.revision);
  assert.ok(h.state.link.syncedAt);
  assert.match(h.state.link.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(credentials.appSecret), false);
});

test('repeated sync reuses one document; unchanged content does not produce writes', async () => {
  const h = harness();
  await h.run();
  const before = h.state.calls.length;
  assert.equal((await h.run()).status, 'synced');
  assert.ok(h.state.calls.slice(before).every((call) => call.method === 'GET'));
  assert.equal((await h.run({ ...fixtureNote, content: '# 改过的标题\n\n新内容' })).status, 'synced');
  assert.equal(h.state.created, 1);
  assert.equal(h.state.title, '改过的标题');
  assert.equal(h.state.children.length, 2);
  assert.equal(h.state.calls.filter((call) => call.path.endsWith('/tenant_access_token/internal')).length, 1);
});

test('remote edits require explicit overwrite and never silently erase the remote version', async () => {
  const h = harness();
  await h.run();
  h.state.revision++;
  h.state.children.push('remote-edit');
  const before = h.state.calls.length;
  assert.equal((await h.run()).status, 'conflict');
  assert.ok(h.state.calls.slice(before).every((call) => call.method === 'GET'));
  assert.ok(h.state.children.includes('remote-edit'));
  assert.equal((await h.run(fixtureNote, { overwriteRemote: true })).status, 'synced');
  assert.equal(h.state.created, 1);
  assert.equal(h.state.children.length, 2);
});

test('failed content writes keep the old remote text and retry uses the same document', async () => {
  const h = harness();
  await h.run();
  const previous = [...h.state.children];
  h.state.intercept = (request) => request.path.endsWith('/descendant') ? failure(1770032, 403) : undefined;
  const result = await h.run({ ...fixtureNote, content: '# 新版本' });
  assert.equal(result.status, 'error');
  assert.equal(result.message, 'permission');
  assert.deepEqual(h.state.children, previous);
  assert.equal(h.state.created, 1);
  h.state.intercept = undefined;
  assert.equal((await h.run({ ...fixtureNote, content: '# 新版本' })).status, 'synced');
  assert.equal(h.state.created, 1);
});

test('a partial staged update is recoverable and never duplicates the final content', async () => {
  const h = harness();
  await h.run();
  h.state.intercept = (request) => request.method === 'PATCH' ? failure(1770032, 403) : undefined;
  assert.equal((await h.run({ ...fixtureNote, content: '# 新标题' })).status, 'error');
  assert.equal(h.state.children.length, 4);
  assert.equal(h.state.link.syncedAt, undefined);
  h.state.intercept = undefined;
  assert.equal((await h.run({ ...fixtureNote, content: '# 新标题' })).status, 'synced');
  assert.equal(h.state.children.length, 2);
  assert.equal(h.state.created, 1);
});

test('share failure is not success and retains the remote identity for retry', async () => {
  const h = harness();
  h.state.intercept = (request) => request.path.includes('/permissions/') ? failure(1063003) : undefined;
  const result = await h.run();
  assert.equal(result.status, 'error');
  assert.equal(result.message, 'share-failed');
  assert.ok(result.remoteUrl);
  assert.equal(h.state.link.syncedAt, undefined);
  h.state.intercept = undefined;
  assert.equal((await h.run()).status, 'synced');
  assert.equal(h.state.created, 1);
});

test('unknown document creation result cannot be retried into a duplicate', async () => {
  const h = harness();
  h.state.intercept = (request) => { if (request.path === '/docx/v1/documents' && request.method === 'POST') throw new Error('socket closed'); };
  assert.equal((await h.run()).message, 'create-uncertain');
  assert.equal(h.state.link.creationPending, true);
  const requests = h.state.calls.length;
  assert.equal((await h.run()).message, 'create-uncertain');
  assert.equal(h.state.calls.length, requests);
});

test('missing configuration, empty notes, missing recipient, and changed app do not write', async () => {
  const h = harness();
  assert.equal((await h.adapter.sync(fixtureNote, { provider: 'feishu' })).status, 'not-configured');
  assert.equal((await h.adapter.sync(fixtureNote, { ...h.context, credentials: { ...credentials, collaboratorEmail: '' } })).message, 'collaborator-required');
  assert.equal((await h.run({ ...fixtureNote, content: '  ' })).message, 'empty-note');
  h.state.link = { appId: 'another-app' };
  assert.equal((await h.run()).message, 'app-changed');
  assert.equal(h.state.calls.length, 0);
});

test('no remote document is created when local checkpoint persistence fails', async () => {
  const h = harness();
  const result = await h.adapter.sync(fixtureNote, { ...h.context, saveFeishuDocument: async () => { throw new Error('disk full'); } });
  assert.equal(result.message, 'local-save');
  assert.equal(h.state.created, 0);
});

test('image links and local attachments are uploaded and reported accurately', async () => {
  const h = harness();
  const result = await h.run({ ...fixtureNote, content: '# 图片\n\n![截图](https://example.com/a.png)', attachments: [{ id: 'file', name: 'readme.txt', mimeType: 'text/plain', size: 4, storedPath: '/managed/readme.txt' }] });
  assert.deepEqual(result.warnings, ['image-links']);
  assert.equal(h.state.calls.filter((call) => call.path === '/drive/v1/medias/upload_all').length, 1);
  assert.equal(h.state.calls.some((call) => call.path.endsWith('/children')), true);
  assert.equal(h.state.children.length, 3);
  const payload = h.state.calls.find((call) => call.path.endsWith('/blocks/convert')).body.content;
  assert.ok(payload.includes('[截图](https://example.com/a.png)'));
  assert.equal(payload.includes('!['), false);
});

test('nested tables are cleaned and batched without splitting a parent from its descendants', () => {
  const converted = { first_level_block_ids: ['table'], blocks: [
    { block_id: 'table', block_type: 31, children: ['cell'], table: { property: { row_size: 1, column_size: 1, merge_info: [] } }, revision_id: 0 },
    { block_id: 'cell', block_type: 32, children: ['text'], table_cell: {} },
    { block_id: 'text', block_type: 2, text: { elements: [] } },
  ] };
  const batches = prepareBlockBatches(converted);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].children_id, ['table']);
  assert.equal(batches[0].descendants.length, 3);
  assert.equal('merge_info' in batches[0].descendants[0].table.property, false);
  assert.equal('revision_id' in batches[0].descendants[0], false);
  assert.equal('merge_info' in converted.blocks[0].table.property, true);
  const large = Array.from({length:1001}, (_, i) => ({block_id:`block_${i}`,block_type:2,text:{elements:[]}}));
  assert.deepEqual(prepareBlockBatches({first_level_block_ids:large.map(b=>b.block_id),blocks:large}).map(b=>b.descendants.length),[1000,1]);
  assert.throws(() => prepareBlockBatches({first_level_block_ids:['missing'],blocks:large}));
});
