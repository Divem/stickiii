// Delivery QA, not product tests: real interaction state + history-independent frame rendering.
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {serve} from './server.mjs';
const plan=JSON.parse(await readFile('plan.json','utf8'));
const {server,url}=await serve();const browser=await chromium.launch({headless:true});
const failures=[],external=[];
const create=async()=>{const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>failures.push(e.message));page.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('data:'))external.push(r.url());});await page.goto(url,{waitUntil:'networkidle'});await page.evaluate(()=>window.__filmReady);return page;};
const state=page=>page.evaluate(()=>{const t=window.CURRENT_TIME;const s=[...document.querySelectorAll('[data-shot]')].find(n=>getComputedStyle(n).opacity==='1'&&getComputedStyle(n).visibility==='visible');return {t,shot:s?.dataset.shot,brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length,fields:s?[...s.querySelectorAll('textarea')].map(n=>n.value):[],preview:s?.querySelector('.editor-mode-switch')?.getAttribute('aria-checked'),pin:s?.querySelector('.window-ideas .pinned-badge')?.getAttribute('aria-pressed'),theme:s?.querySelector('.theme-choice.selected')?.textContent,mode:s?.querySelector('select')?.value,aiMenu:!!s?.querySelector('.ai-action-menu'),fontZh:document.fonts.check('30px "PingFang SC"'),fontEn:document.fonts.check('30px "Avenir Next"')};});
const points=[{t:7.3,shot:'capture'},{t:10.5,shot:'capture'},{t:16,shot:'markdown',preview:'true'},{t:24.5,shot:'windows',pin:'true'},{t:29.8,shot:'themes',theme:'鼠尾草绿'},{t:31.7,shot:'themes',theme:'淡紫色'},{t:35.5,shot:'ai',aiMenu:true},{t:39.5,shot:'feishu',mode:'create'},{t:42.5,shot:'feishu',mode:'append'},{t:49.8,shot:'close'}];
const checks=[];
try{
 const page=await create();
 for(const p of points){await page.evaluate(t=>window.seek(t),p.t);const s=await state(page);for(const [k,v] of Object.entries(p))if(s[k]!==v)failures.push(`State ${p.t}: ${k} expected ${v}, got ${s[k]}`);if(s.brokenImages)failures.push('Broken images');checks.push(s);}
 const comparisons=[];
 for(const target of [10.5,16,24.5,31.7,42.5]){
  const fresh=await create();await fresh.evaluate(t=>window.seek(t),target);const a=await fresh.screenshot();const canonical=await state(fresh);await fresh.close();
  for(const t of [42.5,31.7,7.3,49.8,29.8])await page.evaluate(t=>window.seek(t),t);
  await page.evaluate(t=>window.seek(t),target);const b=await page.screenshot();const after=await state(page);
  const ha=createHash('sha256').update(a).digest('hex'),hb=createHash('sha256').update(b).digest('hex');comparisons.push({time:target,equalPixels:ha===hb,equalState:JSON.stringify(canonical)===JSON.stringify(after),freshSha256:ha,afterHistorySha256:hb});
  if(ha!==hb){failures.push(`Frame ${target} differs after non-linear seek`);await mkdir('evidence/seek-diff',{recursive:true});await writeFile(`evidence/seek-diff/fresh-${target}.png`,a);await writeFile(`evidence/seek-diff/history-${target}.png`,b);}
 }
 const report={ok:!failures.length&&!external.length,checks,seekComparisons:comparisons,failures,externalRequests:[...new Set(external)],limits:['UI fixture checks do not establish native macOS/Windows runtime acceptance','No AI model or Feishu remote calls','No audio listening']};await writeFile('evidence/render-qa.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,states:checks.length,seekFrames:comparisons.length,failures,external:report.externalRequests}));if(!report.ok)process.exitCode=1;
}finally{await browser.close();server.close();}
