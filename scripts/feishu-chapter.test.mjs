import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeishuAdapter } from '../src/platform/sync/feishu.ts';
import { parseFeishuTarget, feishuTargetKey, selectFeishuDocument } from '../src/shared/feishuTarget.ts';
import { SyncConfigStore } from './fixtures/legacy-config-store.ts';

const targetUrl = 'https://team.feishu.cn/docx/DocA?from=share';
const credentials = { appId:'cli_test', appSecret:'fixture-secret', syncMode:'append', targetDocumentUrl:targetUrl, updatedAt:'' };
const note = (id, content, attachments = []) => ({ id, content, attachments, createdAt:'',updatedAt:'',syncState:'local' });
const ok = data => new Response(JSON.stringify({code:0,data}));
function harness() {
  const documents=new Map();
  for(const id of ['DocA','DocB']) documents.set(id,{id,title:'原有文档标题',revision:1,roots:[`${id}Existing`],blocks:new Map([[`${id}Existing`,{block_id:`${id}Existing`,block_type:2,text:{elements:[{text_run:{content:'原有内容不得更改'}}]}}]])});
  const state={documents,notes:new Map(),calls:[],afterWrite:undefined,beforeRequest:undefined,created:0,counter:0,wikiType:'docx',wikiDocument:'DocA'};
  const receipts=new Map();
  const fetcher=async(url,init)=>{
    assert.ok(url.startsWith('https://open.feishu.cn/open-apis/'));
    const u=new URL(url), path=u.pathname.replace('/open-apis',''), body=init.body?JSON.parse(init.body):undefined;
    const request={path,method:init.method,body,query:u.searchParams}; state.calls.push(request);
    const early=await state.beforeRequest?.(request); if(early)return early;
    if(path.endsWith('/tenant_access_token/internal'))return new Response(JSON.stringify({code:0,tenant_access_token:'token',expire:7200}));
    assert.equal(init.headers.Authorization,'Bearer token');
    if(path.includes('/wiki/v2/'))return ok({node:{obj_type:state.wikiType,obj_token:state.wikiDocument}});
    if(path.endsWith('/blocks/convert'))return ok({first_level_block_ids:['body'],blocks:[{block_id:'body',block_type:2,text:{elements:[{text_run:{content:body.content.trim()}}]}}]});
    if(path.includes('/permissions/'))return ok({});
    if(path==='/drive/v1/medias/upload_all')return ok({file_token:`token_${body.attachment_id}`});
    if(path==='/docx/v1/documents'&&init.method==='POST'){
      const id=`Created${++state.created}`;const d={id,title:body.title,revision:1,roots:[],blocks:new Map()};documents.set(id,d);
      return ok({document:{document_id:id,revision_id:1,title:body.title}});
    }
    const id=path.split('/')[4], d=documents.get(id);assert.ok(d,`Unknown document ${path}`);
    if(path===`/docx/v1/documents/${id}`)return ok({document:{document_id:id,revision_id:d.revision,title:d.title}});
    const root={block_id:id,block_type:1,children:[...d.roots]};
    if(init.method==='GET'){
      if(path.endsWith(`/blocks/${id}`))return ok({block:root});
      assert.equal(Number(u.searchParams.get('page_size')),500);
      const all=[root,...d.blocks.values()], offset=Number(u.searchParams.get('page_token')||0);
      // Exercise pagination instead of relying on the root being in the first/last page.
      return ok({items:all.slice(offset,offset+2),has_more:offset+2<all.length,page_token:String(offset+2)});
    }
    const token=u.searchParams.get('client_token');assert.match(token,/^[a-f0-9-]{36}$/);
    if(receipts.has(token))return ok(structuredClone(receipts.get(token)));
    assert.equal(Number(u.searchParams.get('document_revision_id')),d.revision);
    let result;
    if(path.endsWith('/children')){
      const type=body.children[0].block_type;const inner=`Media${++state.counter}`;const wrapper=type===23?`View${state.counter}`:inner;
      if(type===23){d.blocks.set(inner,{block_id:inner,block_type:23,file:{}});d.blocks.set(wrapper,{block_id:wrapper,block_type:33,children:[inner]});}
      else d.blocks.set(inner,{block_id:inner,block_type:27,image:{}});
      const position=body.index===-1?d.roots.length:body.index;d.roots.splice(position,0,wrapper);d.revision++;
      result={document_revision_id:d.revision,children:[type===23?{block_id:wrapper,block_type:33,children:[{block_id:inner,block_type:23,file:{}}]}:{block_id:inner,block_type:type,image:{}}]};
    }else if(path.endsWith('/descendant')){
      const relations=new Map(body.descendants.map(b=>[b.block_id,`Real${++state.counter}`]));
      for(const b of body.descendants)d.blocks.set(relations.get(b.block_id),{...structuredClone(b),block_id:relations.get(b.block_id),parent_id:id,children:(b.children??[]).map(child=>relations.get(child))});
      d.roots.splice(body.index===-1?d.roots.length:body.index,0,...body.children_id.map(child=>relations.get(child)));
      result={document_revision_id:++d.revision,block_id_relations:[...relations].map(([temporary_block_id,block_id])=>({temporary_block_id,block_id}))};
    }else if(path.endsWith('/children/batch_delete')){
      const deleted=d.roots.splice(body.start_index,body.end_index-body.start_index);
      const remove=id=>{for(const child of d.blocks.get(id)?.children??[])remove(child);d.blocks.delete(id);};deleted.forEach(remove);
      result={document_revision_id:++d.revision};
    }else if(init.method==='PATCH'){
      if(body.update_text_elements)d.title=body.update_text_elements.elements[0].text_run.content;
      else { const block=d.blocks.get(path.split('/').pop()); if(body.replace_image)block.image={token:body.replace_image.token}; if(body.replace_file)block.file={token:body.replace_file.token}; }
      result={document_revision_id:++d.revision};
    }else assert.fail(`Unexpected write ${path}`);
    receipts.set(token,structuredClone(result));
    await state.afterWrite?.(request);
    return ok(result);
  };
  const adapter=createFeishuAdapter(fetcher,0);
  async function sync(input,config=credentials,options){
    const previous=state.notes.get(input.id);const local={...input,feishu:previous?.feishu,feishuTargets:previous?.feishuTargets};state.notes.set(input.id,local);
    return adapter.sync(local,{provider:'feishu',credentials:config,options,saveFeishuDocument:async link=>{
      const current=state.notes.get(input.id);state.notes.set(input.id,{...current,feishu:structuredClone(link),feishuTargets:{...current.feishuTargets,[link.targetKey]:structuredClone(link)}});
    }});
  }
  return {state,sync,doc:documents.get('DocA')};
}

function rootText(d){return d.roots.flatMap(id=>{const b=d.blocks.get(id);const elements=(b?.heading1??b?.text)?.elements;return elements?[elements.map(e=>e.text_run.content).join('')]:[];});}

test('new notes append independent chapters and preserve the target title and original blocks',async()=>{
  const h=harness();
  assert.equal((await h.sync(note('one','# 第一条\n\n第一条正文'))).status,'synced');
  assert.equal((await h.sync(note('two','第二条\n第二条正文'))).status,'synced');
  assert.deepEqual(rootText(h.doc),['原有内容不得更改','第一条','第一条正文','第二条','第二条正文']);
  assert.equal(h.doc.title,'原有文档标题');assert.equal(h.state.created,0);
  assert.equal(h.state.calls.some(c=>c.path.includes('/permissions/')),false);
});

test('append mode uploads image and file attachments as owned media blocks',async()=>{
  const h=harness();
  const attachments=[
    {id:'image-1',name:'截图.png',mimeType:'image/png',size:12,storedPath:'/managed/image.png'},
    {id:'file-1',name:'说明.pdf',mimeType:'application/pdf',size:18,storedPath:'/managed/readme.pdf'},
  ];
  const result=await h.sync(note('media','标题\n正文',attachments));
  assert.equal(result.status,'synced');
  const link=h.state.notes.get('media').feishu;
  assert.equal(link.chapter.blockIds.length,4);
  assert.equal(h.state.calls.filter(c=>c.path==='/drive/v1/medias/upload_all').length,2);
  assert.deepEqual(rootText(h.doc),['原有内容不得更改','标题','正文']);
  assert.equal((await h.sync(note('media','标题\n正文',attachments))).status,'synced');
  assert.equal(h.state.calls.filter(c=>c.path==='/drive/v1/medias/upload_all').length,2);
});

test('updating one chapter preserves its position and every other chapter',async()=>{
  const h=harness();await h.sync(note('one','# 第一条\n原正文'));await h.sync(note('two','# 第二条\n第二条正文'));
  const otherIds=[...h.state.notes.get('two').feishu.chapter.blockIds];
  assert.equal((await h.sync(note('one','# 第一条修订\n新正文'))).status,'synced');
  assert.deepEqual(rootText(h.doc),['原有内容不得更改','第一条修订','新正文','第二条','第二条正文']);
  assert.ok(otherIds.every(id=>h.doc.blocks.has(id)));
  const before=h.state.calls.length;assert.equal((await h.sync(note('one','# 第一条修订\n新正文'))).status,'synced');
  assert.ok(h.state.calls.slice(before).every(c=>c.method==='GET'));
});

test('editing another chapter does not cause a conflict; editing this chapter requires scoped confirmation',async()=>{
  const h=harness();await h.sync(note('one','第一条\n正文'));await h.sync(note('two','第二条\n正文'));
  const other=h.state.notes.get('two').feishu.chapter.blockIds[1];h.doc.blocks.get(other).text.elements[0].text_run.content='云端第二条改动';h.doc.revision++;
  assert.equal((await h.sync(note('one','第一条\n正文'))).status,'synced');
  const own=h.state.notes.get('one').feishu.chapter.blockIds[1];h.doc.blocks.get(own).text.elements[0].text_run.content='云端第一条改动';h.doc.revision++;
  const conflict=await h.sync(note('one','第一条\n本地新版'));assert.equal(conflict.status,'conflict');assert.equal(conflict.scope,'chapter');
  assert.equal((await h.sync(note('one','第一条\n本地新版'),credentials,{overwriteRemote:true})).status,'synced');
  assert.ok(rootText(h.doc).includes('云端第二条改动'));assert.ok(rootText(h.doc).includes('本地新版'));
});

test('unknown append receipt is replayed with its original token and does not duplicate a chapter',async()=>{
  const h=harness();let interrupted=false;
  h.state.afterWrite=r=>{if(!interrupted&&r.path.endsWith('/descendant')){interrupted=true;throw new Error('connection lost after write');}};
  assert.equal((await h.sync(note('one','标题\n正文'))).status,'error');
  const pending=h.state.notes.get('one').feishu.chapter.pending;assert.equal(pending.phase,'insert');
  h.state.afterWrite=undefined;
  assert.equal((await h.sync(note('one','标题\n正文'))).status,'synced');
  assert.deepEqual(rootText(h.doc),['原有内容不得更改','标题','正文']);
  const writes=h.state.calls.filter(c=>c.path.endsWith('/descendant'));assert.equal(writes[0].query.get('client_token'),writes[1].query.get('client_token'));
});

test('retry after a lost delete response cannot remove other chapters',async()=>{
  const h=harness();await h.sync(note('one','标题\n旧内容'));await h.sync(note('two','另一条\n不能删除'));
  let interrupted=false;h.state.afterWrite=r=>{if(!interrupted&&r.method==='DELETE'){interrupted=true;throw new Error('lost delete receipt');}};
  assert.equal((await h.sync(note('one','标题\n新内容'))).status,'error');
  h.state.afterWrite=undefined;
  assert.equal((await h.sync(note('one','标题\n新内容'))).status,'synced');
  assert.deepEqual(rootText(h.doc),['原有内容不得更改','标题','新内容','另一条','不能删除']);
});

test('pending older text is reconciled before syncing newer edits',async()=>{
  const h=harness();let failed=false;h.state.afterWrite=r=>{if(!failed&&r.path.endsWith('/descendant')){failed=true;throw new Error('lost receipt');}};
  await h.sync(note('one','标题\n旧内容'));h.state.afterWrite=undefined;
  assert.equal((await h.sync(note('one','标题\n新内容'))).status,'synced');
  assert.deepEqual(rootText(h.doc),['原有内容不得更改','标题','新内容']);
});

test('switching target documents and switching back restores the original chapter mapping',async()=>{
  const h=harness();const first=note('one','标题\n正文');await h.sync(first);
  await h.sync(first,{...credentials,targetDocumentUrl:'https://team.feishu.cn/docx/DocB'});
  assert.equal((await h.sync(first)).status,'synced');
  assert.equal(h.doc.roots.length,3);assert.equal(h.state.documents.get('DocB').roots.length,3);
  assert.equal(Object.keys(h.state.notes.get('one').feishuTargets).length,2);
});

test('switching create and append modes keeps their separate document mappings',async()=>{
  const h=harness();const n=note('one','标题\n正文');const config={...credentials,syncMode:'create',collaboratorEmail:'owner@example.com'};
  assert.equal((await h.sync(n,config)).status,'synced');assert.equal(h.state.created,1);
  assert.equal((await h.sync(n)).status,'synced');assert.equal(h.doc.roots.length,3);
  assert.equal((await h.sync(n,config)).status,'synced');assert.equal(h.state.created,1);
  assert.equal((await h.sync(n)).status,'synced');assert.equal(h.doc.roots.length,3);
});

test('wiki links resolve obj_token, preserve the input link, and reuse an existing docx chapter',async()=>{
  const h=harness();const n=note('one','标题\n正文');await h.sync(n);
  const url='https://team.feishu.cn/wiki/WikiA?from=share#section';
  const result=await h.sync(n,{...credentials,targetDocumentUrl:url});
  assert.equal(result.status,'synced');assert.equal(result.remoteUrl,url);assert.equal(h.doc.roots.length,3);
  assert.ok(h.state.calls.some(c=>c.path==='/wiki/v2/spaces/get_node'&&c.query.get('token')==='WikiA'));
  h.state.wikiType='sheet';assert.equal((await h.sync(n,{...credentials,targetDocumentUrl:url})).message,'target-not-document');
});

test('missing or interleaved chapter blocks are never deleted using guessed index ranges',async()=>{
  const h=harness();await h.sync(note('one','标题\n正文'));
  h.doc.roots.splice(2,0,'Foreign');h.doc.blocks.set('Foreign',{block_id:'Foreign',block_type:2,text:{elements:[{text_run:{content:'外部插入内容'}}]}});h.doc.revision++;
  assert.equal((await h.sync(note('one','标题\n新正文'),credentials,{overwriteRemote:true})).message,'chapter-missing');
  assert.ok(h.doc.blocks.has('Foreign'));assert.equal(h.state.calls.some(c=>c.method==='DELETE'),false);
});

test('a one-line note creates one heading and does not require a conversion call',async()=>{
  const h=harness();assert.equal((await h.sync(note('one','只有标题'))).status,'synced');
  assert.deepEqual(rootText(h.doc),['原有内容不得更改','只有标题']);assert.equal(h.state.calls.some(c=>c.path.endsWith('/convert')),false);
});

test('target URLs are strictly validated and configuration persists mode and target with secrets kept private',async()=>{
  for(const value of ['https://feishu.cn.evil.test/docx/DocA','file:///tmp/a','https://user:secret@team.feishu.cn/docx/DocA','https://team.feishu.cn/sheets/DocA','https://team.feishu.cn:8443/docx/DocA'])assert.equal(parseFeishuTarget(value),undefined,value);
  assert.equal(parseFeishuTarget(targetUrl).token,'DocA');
  const store=new SyncConfigStore(`/tmp/desk-tabs-mode-${crypto.randomUUID()}`,{available:()=>true,encrypt:()=>Buffer.from('encrypted'),decrypt:()=>'{"ignored":true}'},async()=>{});
  assert.equal((await store.save({provider:'feishu',...credentials})).status,'saved');
  const listed=(await store.list())[0];assert.equal(listed.syncMode,'append');assert.equal(listed.targetDocumentUrl,targetUrl);assert.equal('appSecret' in listed,false);
  assert.equal((await store.save({provider:'feishu',appId:credentials.appId,appSecret:'',syncMode:'create'})).status,'saved');
  assert.equal((await store.credentials('feishu')).appSecret,credentials.appSecret);
  assert.equal((await store.save({provider:'feishu',appId:credentials.appId,appSecret:'',syncMode:'append',targetDocumentUrl:'https://evil.test/docx/DocA'})).status,'invalid');
  assert.equal((await store.list())[0].syncMode,'create');
  const legacy={appId:credentials.appId,documentId:'Created1'};
  assert.equal(selectFeishuDocument({...note('old','旧笔记'),feishu:legacy},feishuTargetKey(credentials.appId,'create'),credentials.appId,'create'),legacy);
});
