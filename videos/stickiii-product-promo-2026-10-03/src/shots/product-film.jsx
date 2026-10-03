import React from 'react';
import gsap from 'gsap';
import {shot,onDrive,onRender,frame} from '../engine.js';
import {Product} from '../product.jsx';
import {setFieldValue,typed,ensureOpen} from '../kit/interact.js';
import {CAPTURE_TEXT} from '../fixtures/desktop.js';

export function Wordmark({compact=false}){return <div className={'wordmark '+(compact?'compact':'')}><img src="/desk-tabs-logo.png"/><span className="en">Stickiii</span>{!compact&&<span className="brand-divider"/>}{!compact&&<span className="zh">贴贴便签</span>}</div>;}
function Stamp({n,label}){return <div className="stamp"><span>{n}</span><span>{label}</span></div>;}
function Copy({shot: s,children}){return <div className="copy"><span className="eyebrow en">{s.headlineEn}</span><h1 className="zh">{s.headline.split('，').map((line,i)=><React.Fragment key={i}>{i>0&&<br/>}{line}</React.Fragment>)}</h1><p className="description zh">{s.description}</p>{children}</div>;}
function Cursor(){return <div className="film-cursor"><span className="click-ring"/><svg width="33" height="43" viewBox="0 0 33 43"><path d="M5 3L5 32L12.7 26L20 39L26 35L19 23L29 22Z" fill="#2d322f" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round"/></svg></div>;}
function Foot({s,label}){return <><Wordmark compact/><Stamp n={String(s.start===0?1:['capture','markdown','windows','themes','ai','feishu','close'].indexOf(s.id)+2).padStart(2,'0')} label={label}/></>;}
export function Hook({shot:s}) {return <><Foot s={s} label="灵感不用等"/><div className="hook-copy"><span className="eyebrow en">{s.headlineEn}</span><h1 className="zh">别让灵感，<br/><span className="underlined">等你忙完。</span></h1><p className="zh">先贴下来。</p></div><div className="paper-stack"><div className="thought-card card-meeting"><span className="paper-tag">会议片段</span><p>先记下来，<br/>会后再整理。</p><span className="paper-rule"/></div><div className="thought-card card-todo"><span className="paper-tag">今天要做</span><p>☐ 整理两条反馈<br/>☐ 写下一个新想法</p></div><div className="thought-card card-idea"><img src="/desk-tabs-logo.png"/><span className="paper-tag">灵感备忘</span><p>这个想法，<br/>值得留住。</p><div className="paper-bottom"><span>Stickiii</span><span>↗</span></div></div></div></>;}
export function Capture({shot:s}) {return <><Foot s={s} label="快速记录"/><Copy shot={s}><div className="shortcut"><kbd>⌘ <small>/ Ctrl</small></kbd><span>+</span><kbd>Shift</kbd><span>+</span><kbd>Space</kbd></div><div className="quiet-label">本地优先 · 自动保存</div></Copy><Product noteId="capture-note" className="feature-window"/><div className="scene-caption">把临时想法，先留在手边。</div><Cursor/></>;}
export function Markdown({shot:s}) {return <><Foot s={s} label="编辑与预览"/><Copy shot={s}><div className="proof-line"><span className="proof-dot"/><span>首行自动成为标题</span></div><div className="format-tags"><span>标题</span><span>待办</span><span>列表</span></div></Copy><Product noteId="markdown-note" className="feature-window" height={350}/><div className="scene-caption">同一条记录，切换编辑 / 预览</div><Cursor/></>;}
export function Windows({shot:s}) {return <><Foot s={s} label="独立窗口"/><div className="wide-copy"><span className="eyebrow en">{s.headlineEn}</span><h1 className="zh">每个想法，各有位置。</h1><p className="description zh">{s.description}</p></div><div className="windows-board"><Product noteId="window-ideas" theme="sage" className="window-ideas" width={330} height={250}/><Product noteId="window-todo" theme="peach" className="window-todo" width={330} height={250}/><Product noteId="window-meeting" theme="sky" className="window-meeting" width={330} height={250}/></div><div className="pin-callout">重要的，留在最上面。</div><Cursor/></>;}
export function Themes({shot:s}) {return <><Foot s={s} label="便签主题"/><Copy shot={s}><div className="swatch-row">{['#ffffff','#dfe2e3','#c7d99a','#b9d9ef','#f2c09b','#d1b9e9','#343a3e'].map(c=><span key={c} style={{background:c}}/>)}</div></Copy><Product noteId="theme-note" className="feature-window theme-window" width={330} height={300}/><Cursor/></>;}
export function Ai({shot:s}) {return <><Foot s={s} label="AI 文字工具"/><Copy shot={s}><div className="function-list"><span>润色</span><span>翻译</span><span>扩写</span><span>解释</span></div><div className="condition">需配置 AI 模型 · 按需使用</div></Copy><Product noteId="ai-note" className="feature-window ai-window" width={330} height={260}/><div className="scene-caption">选择适合这段文字的操作</div><Cursor/></>;}
export function Feishu({shot:s}) {return <><Foot s={s} label="飞书整理"/><Copy shot={s}><div className="sync-modes"><div><span>01</span><p>每条便签<br/><strong>一篇独立文档</strong></p></div><div><span>02</span><p>多条便签<br/><strong>一篇文档里的章节</strong></p></div></div><div className="condition">需要配置飞书应用与文档权限</div></Copy><Product noteId="feishu-note" main className="feature-window feishu-window" width={340} height={330}/><div className="scene-caption">手动同步 · 配置后使用</div><Cursor/></>;}
export function Close({shot:s}) {return <><div className="close-shape shape-one"/><div className="close-shape shape-two"/><div className="brand-hero"><img className="hero-logo" src="/desk-tabs-logo.png"/><div className="hero-name"><span className="en">Stickiii</span><span className="zh">贴贴便签</span></div><p className="close-line zh">灵感来了，先贴下来。</p><div className="platforms"><span>macOS</span><span className="platform-divider"/> <span>Windows</span><span className="platform-divider"/><span>开源 · Apache-2.0</span></div><div className="repo-cta">Divem / stickiii</div><p className="release-note zh">0.1.0 预发布 · Windows 运行待验收</p></div></>;}

const eventTime=(id,action)=>shot(id).actions.find(a=>a.id===action).at;
const root=id=>document.querySelector(`[data-shot="${id}"]`);
const element=(id,sel)=>root(id).querySelector(sel);
const wait=async()=>{await frame();};
async function click(id,selector){const el=element(id,selector);if(!el)throw Error(`${id}: missing ${selector}`);el.click();await wait();}
async function preview(id,want){const btn=element(id,'.editor-mode-switch');if(btn.getAttribute('aria-checked')!==String(want))await click(id,'.editor-mode-switch');}
async function settings(id,want){await ensureOpen(want,()=>element(id,'[aria-label="设置"]').getAttribute('aria-expanded')==='true',()=>element(id,'[aria-label="设置"]').click());}
const progress=(t,a,b)=>Math.max(0,Math.min(1,(t-a)/(b-a)));
function pointer(id,selector,t,at){const c=element(id,'.film-cursor'); const target=selector&&element(id,selector);if(!target){c.style.opacity=0;return;}const bounds=target.getBoundingClientRect(), scene=root(id).getBoundingClientRect();const k=progress(t,at-.45,at);const x=bounds.x-scene.x+bounds.width*.5, y=bounds.y-scene.y+bounds.height*.55;c.style.transform=`translate(${x+(1-k)*65}px,${y+(1-k)*38}px)`;c.style.opacity=t>at-.5&&t<at+1.7?1:0;const ring=c.querySelector('.click-ring');const pulse=progress(t,at,at+.45);ring.style.opacity=t>=at&&pulse<1?String((1-pulse)*.65):0;ring.style.transform=`scale(${.7+pulse*1.8})`;}
export function build(id){return tl=>{const s=shot(id),q=selector=>element(id,selector),start=s.start,end=s.end;
  tl.set(root(id),{opacity:1},start); tl.set(root(id),{opacity:0},end+.55);
  if(['markdown','themes'].includes(id))tl.fromTo(root(id),{clipPath:'inset(0 0 0 100%)'},{clipPath:'inset(0 0 0 0%)',duration:.55,ease:'power2.inOut'},start);
  if(id==='hook'){
    tl.fromTo(q('.hook-copy'),{x:-32,opacity:0},{x:0,opacity:1,duration:.65,ease:'power3.out'},start);
    [['.card-idea',eventTime(id,'thought-land')],['.card-meeting',1.2],['.card-todo',1.65]].forEach(([sel,at])=>tl.fromTo(q(sel),{y:100,x:40,rotation:12,opacity:0},{y:0,x:0,rotation:sel.includes('idea')?-3:sel.includes('meeting')?5:-7,opacity:1,duration:.6,ease:'power3.out'},start+at));
    tl.to(q('.paper-stack'),{x:-15,y:-10,scale:1.025,duration:2,ease:'sine.inOut'},start+2);
  } else if(id==='windows'){
    tl.fromTo(q('.wide-copy'),{y:-25,opacity:0},{y:0,opacity:1,duration:.5,ease:'power2.out'},start);
    [['.window-ideas',0],['.window-todo',eventTime(id,'second-window')],['.window-meeting',eventTime(id,'third-window')]].forEach(([sel,at])=>tl.fromTo(q(sel),{y:100,opacity:0,rotation:5},{y:0,opacity:1,rotation:0,duration:.65,ease:'power3.out'},start+at));
    tl.fromTo(q('.pin-callout'),{y:20,opacity:0},{y:0,opacity:1,duration:.5},start+eventTime(id,'pin-note')+.3);
    tl.to(q('.window-ideas'),{x:40,y:-15,duration:1.1,ease:'power2.inOut'},start+4.4);
    tl.to(q('.window-todo'),{x:-5,y:15,duration:1.1},start+4.4);
  } else if(id==='close'){
    tl.fromTo(q('.hero-logo'),{scale:.6,rotation:-7,opacity:0},{scale:1,rotation:0,opacity:1,duration:.65,ease:'power3.out'},start);
    tl.fromTo(q('.hero-name'),{y:28,opacity:0},{y:0,opacity:1,duration:.6},start+eventTime(id,'brand-land'));
    tl.fromTo(q('.close-line'),{y:20,opacity:0},{y:0,opacity:1,duration:.5},start+1.0);
    tl.fromTo(q('.platforms'),{opacity:0},{opacity:1,duration:.5},start+1.35);
    tl.fromTo(q('.repo-cta'),{opacity:0},{opacity:1,duration:.5},start+1.6);
    tl.fromTo(q('.release-note'),{opacity:0},{opacity:1,duration:.5},start+1.7);
    tl.fromTo(q('.close-shape'),{x:80,rotation:-4},{x:0,rotation:0,duration:4,ease:'power1.out'},start);
  } else {
    tl.fromTo(q('.copy'),{x:id==='markdown'?0:-32,y:id==='markdown'?24:0,opacity:0},{x:0,y:0,opacity:1,duration:.55,ease:'power3.out'},start);
    const at=id==='capture'?eventTime(id,'window-open'):0;
    tl.fromTo(q('.feature-window'),{x:id==='capture'?120:36,y:id==='capture'?60:0,opacity:0,rotation:id==='capture'?4:0},{x:0,y:0,rotation:0,opacity:1,duration:.65,ease:'power3.out'},start+at);
    if(id==='capture')tl.fromTo(q('.shortcut'),{y:10,opacity:0},{y:0,opacity:1,duration:.35},start+.1);
    if(['capture','markdown','ai'].includes(id))tl.to(q('.product-camera'),{scale:1.035,x:-8,y:-7,duration:2,ease:'sine.inOut'},end-2.1);
  }
  if(id==='capture')onDrive(id,async t=>{
    await preview(id,false);const txt=typed(CAPTURE_TEXT,t,eventTime(id,'type-note'),24);setFieldValue(element(id,'textarea.note-content'),txt);await wait();if(t>=eventTime(id,'capture-settle')){window.__flushFilmAutosaves();await wait();}
  });
  if(id==='markdown')onDrive(id,t=>preview(id,t>=eventTime(id,'preview-toggle')));
  if(id==='windows')onDrive(id,async t=>{
    const btn=element(id,'.window-ideas .pinned-badge');const want=t>=eventTime(id,'pin-note');if(btn.getAttribute('aria-pressed')!==String(want))await click(id,'.window-ideas .pinned-badge');
  });
  if(id==='themes')onDrive(id,async t=>{
    const want=t>=eventTime(id,'themes-open');await settings(id,want);
    const theme=t>=eventTime(id,'theme-lavender')?'lavender':t>=eventTime(id,'theme-sage')?'sage':'paper';
    if(want){const name={paper:'纯白',sage:'鼠尾草绿',lavender:'淡紫色'}[theme];const options=[...root(id).querySelectorAll('.theme-choice')];const option=options.find(b=>b.textContent.trim()===name)||options[{paper:0,sage:2,lavender:5}[theme]];if(!option.classList.contains('selected')){option.click();await wait();}}
    element(id,'.film-product').dataset.pageTheme=theme;if(t>=eventTime(id,'theme-lavender')+.52||t>=eventTime(id,'theme-sage')+.52&&t<eventTime(id,'theme-lavender')){window.__flushFilmAutosaves();await wait();}
  });
  if(id==='ai')onDrive(id,async t=>{const btn=element(id,'.ai-action-arrow'),want=t>=eventTime(id,'ai-menu');if(btn.getAttribute('aria-expanded')!==String(want))await click(id,'.ai-action-arrow');});
  if(id==='feishu')onDrive(id,async t=>{
    const want=t>=eventTime(id,'feishu-config');if(!want){await settings(id,false);return;}
    if(!element(id,'.provider-heading')){await settings(id,true);const btn=[...root(id).querySelectorAll('.provider-setting')].find(b=>b.textContent.includes('飞书'));btn.click();await wait();}
    const select=element(id,'.credential-field select'),mode=t>=eventTime(id,'feishu-mode')?'append':'create';if(select.value!==mode){select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}));await wait();}
  });
  onRender(id,t=>{
    if(id==='markdown')pointer(id,'.editor-mode-switch',t,eventTime(id,'preview-toggle'));
    if(id==='windows')pointer(id,'.window-ideas .pinned-badge',t,eventTime(id,'pin-note'));
    if(id==='themes'){const at=t<eventTime(id,'theme-sage')?eventTime(id,'themes-open'):t<eventTime(id,'theme-lavender')?eventTime(id,'theme-sage'):eventTime(id,'theme-lavender');pointer(id,at===eventTime(id,'themes-open')?'[aria-label="设置"]':'.theme-choice.selected',t,at);}
    if(id==='ai')pointer(id,'.ai-action-arrow',t,eventTime(id,'ai-menu'));
    if(id==='feishu')pointer(id,t<eventTime(id,'feishu-mode')?'[aria-label="同步到飞书"]':'.credential-field select',t,t<eventTime(id,'feishu-mode')?eventTime(id,'feishu-config'):eventTime(id,'feishu-mode'));
  });
};}
