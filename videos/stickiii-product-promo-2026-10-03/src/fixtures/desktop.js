// Synthetic notes. No user data, filesystem, credentials or external service calls.
const date='2026-10-03T10:00:00+08:00';
const make=(id,content,theme='paper',updatedAt='2026-10-02T09:00:00+08:00')=>({id,content,theme,attachments:[],createdAt:date,updatedAt,syncState:'local'});
export const CAPTURE_TEXT='周一例会\n\n先把想法记下来。\n\n- 新版首页：让记录更直接\n- 会后整理反馈\n- 周五确认下一步';
export const MARKDOWN_TEXT='# 周一例会\n\n先记下来，再慢慢整理。\n\n## 接下来\n- [x] 记下今天的想法\n- [ ] 整理会上提到的反馈\n- [ ] 周五确认下一步\n\n> 好想法，不用等。';
const notes=[
  make('feishu-note','# 本周的想法\n\n准备整理到飞书。\n\n- 首页入口再直接一点\n- 反馈集中到每周复盘\n- 先记录，再一起讨论','paper',date),
  make('capture-note',''),make('markdown-note',MARKDOWN_TEXT),
  make('window-ideas','灵感备忘\n\n把首页做得更简单。\n\n让「记下来」成为第一步。','sage'),
  make('window-todo','今天要做\n\n☑ 看完访谈记录\n☐ 整理两条关键反馈\n☐ 写下一个新想法','peach'),
  make('window-meeting','会议片段\n\n用户最在意的是：\n\n随时能记，不打断手头的事。','sky'),
  make('theme-note','一个小想法\n\n颜色，也可以有自己的偏好。\n\n把重要的事，留在手边。'),
  make('ai-note','会后备忘\n\n今天讨论了首页和反馈，\n周五再确认下一步。')
];
const store=new Map(notes.map(n=>[n.id,n]));
const listeners={};
const subscribe=(name,fn)=>{(listeners[name]??=new Set()).add(fn);return()=>listeners[name].delete(fn);};
window.__filmBridgeLog=[];
window.desktopTabs={
  getWindowContext:async()=>({noteId:null,openNoteIds:[],readyNoteIds:[],pinned:false}),
  listNotes:async()=>structuredClone([...store.values()]),
  saveNote:async note=>{store.set(note.id,structuredClone(note));window.__filmBridgeLog.push({operation:'saveNote',noteId:note.id,filmTime:window.CURRENT_TIME??0});return structuredClone(note);},
  deleteNote:async id=>{store.delete(id);},
  listShortcuts:async()=>[{action:'toggleWindow',accelerator:'CommandOrControl+Shift+Space'},{action:'newNote',accelerator:'CommandOrControl+Shift+N'},{action:'previousNote',accelerator:'CommandOrControl+Alt+Left'},{action:'nextNote',accelerator:'CommandOrControl+Alt+Right'}],
  listSyncConfigs:async()=>[],getAiConfig:async()=>null,
  setPinnedWindow:async pinned=>pinned,
  setWindowTitle:async()=>{},openNoteWindow:async()=>{},focusNoteWindow:async()=>{},closeNoteWindow:async()=>{},openMainWindow:async()=>{},
  pickFiles:async()=>[],openAttachment:async()=>{throw new Error('Film does not access files');},openExternalLink:async()=>false,
  syncNote:async(_,provider)=>({status:'not-configured',provider}),
  saveSyncConfig:async()=>({status:'unavailable'}),clearSyncConfig:async()=>({status:'unavailable'}),
  saveAiConfig:async()=>({status:'unavailable'}),clearAiConfig:async()=>({status:'unavailable'}),testAiConnection:async()=>({status:'error',message:'invalid-config'}),
  polishNote:async()=>({status:'not-configured'}),aiNote:async()=>({status:'not-configured'}),
  saveShortcuts:async shortcuts=>({status:'saved',shortcuts}),completeExit:async()=>{},quitApplication:async()=>{},minimizeWindow:()=>{},closeWindow:()=>{},
};
for(const name of ['WindowsChanged','NoteChanged','CloseRequested','ExitCancelled','NoteActivated','SettingsRequested','RestoreFailed','ShortcutAction','ExitRequested'])window.desktopTabs['on'+name]=fn=>subscribe(name,fn);

// Only the product's 520ms autosave timer is bridged to film time. Other timers are native.
const realSetTimeout=window.setTimeout.bind(window),realClearTimeout=window.clearTimeout.bind(window),pendingSaves=new Map();
let timerId=-1;
window.setTimeout=(fn,delay,...args)=>{if(delay!==520)return realSetTimeout(fn,delay,...args);const id=timerId--;pendingSaves.set(id,()=>fn(...args));return id;};
window.clearTimeout=id=>{if(id<0)pendingSaves.delete(id);else realClearTimeout(id);};
window.__flushFilmAutosaves=()=>{const callbacks=[...pendingSaves.values()];pendingSaves.clear();callbacks.forEach(fn=>fn());};
