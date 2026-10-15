import { scenario, notice } from './scenario.mjs?v=feedback-loop-1';
import { projectState, getItem, diffStates } from './engine.mjs?v=feedback-loop-1';
import { layoutFill } from './variants/a-layout.mjs';
import { records, currentAsk, feedbackTrail, personName } from './variants/shared.mjs?v=feedback-loop-1';
import { normalizeAsk, responseHTML, composerHTML, deferHTML, scheduleHTML, keypadHTML, bindResponses } from './respond.mjs?v=respond-1';
import { TAIL_ID, streamNames, markdownHTML, plainText, eventRef, actionText, authorOf, feedbackLine, foldLayer, openAsks, dueText,
  itemVersions, createAnswerBook, answerWords, approveSubject, createFlipBoard } from './variants/spatial-kit.mjs';
import { followFrames } from './embed.mjs';

// The original time machine: a treemap of the current layer, the round's inputs on the left and a
// detail reader on the right. Authored or replayed Agent decisions only; nothing here writes Fold state.
// Answers given on this page stay in a page-local answer book (saved → acknowledged after the next round).
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const frames = scenario.frames;
const stamps = frames.map(f => Date.parse(f.at));
const start = stamps[0], end = Math.max(stamps.at(-1), Date.parse(scenario.endAt));
const query = new URLSearchParams(location.search);
let frameIndex = Math.min(frames.length - 1, Math.max(0, Math.floor(Number(query.get('frame'))) || 0));
let cursor = query.has('at') && Number.isFinite(Number(query.get('at'))) ? Math.max(start,Math.min(end,Number(query.get('at')))) : stamps[frameIndex];
frameIndex=stamps.reduce((last,t,i)=>t<=cursor?i:last,0);
let selected = query.get('item') ? {type:'item',id:query.get('item')} : {type:'state'};
let layerId = query.get('layer') || null;
let comparing = query.has('base');
let baseIndex = Math.min(frameIndex, Math.max(0, Math.floor(Number(query.get('base'))) || 0));
let detailMode = 'detail';
let timer = null;
let inspectedJSON;
let currentState, baseState, currentDiff;
let slowMotion=false, panelAnimations=[];
let boardSizes='';
let speed=1;
let panel=null;                     // an open response panel in the reader: { kind, key }
let lastAnswer=null;                // the most recent answer, for U / the toast's undo
const openGroups=new Set(['self']); // input groups the reader unfolded; kept across frames
const answers=createAnswerBook(frames);
const FRAME_MS=320, LAYER_MS=460;
const kinds = {'needs-you':'需要你','in-progress':'进行中',done:'已完成',fyi:'知会'};
const weights = {critical:'关键',high:'高',normal:'常规',low:'低',trace:'微量'};
const statuses = {active:'当前关注',withdrawn:'已撤下',merged:'已合并'};
const verdicts = {used:'采用',duplicate:'重复',noise:'噪音',deferred:'暂缓',unjudged:'未判'};
const expectNames = {decide:'决定',input:'提供',act:'去做',ack:'已阅',snooze:'稍后提醒'};
const askOf = (state,index,id) => currentAsk({index,state},id);
const askLabel = ask => ask.expects==='approve' ? '待你批准' : ask.expects==='choose' ? '待你选择' : `待你${ask.meanings.map(x=>expectNames[x]||x).join('、')}`;
const changeNames = {added:'新增',updated:'更新',withdrawn:'撤下',restored:'重新纳入',merged:'合并',annotations_changed:'反馈'};
const fieldNames = {summary:'摘要',weight:'档位',share:'份额',share_override:'显式份额',kind:'类型',title:'标题',reason:'原因',sources:'来源',children:'子项',status:'状态',due_at:'截止时间',stale_after:'参考有效期',annotations:'反馈',parent_id:'所属层',merged_into:'合并至'};
const dateFmt = new Intl.DateTimeFormat('zh-CN',{timeZone:scenario.timeZone||'Asia/Shanghai',month:'2-digit',day:'2-digit',weekday:'short'});
const timeFmt = new Intl.DateTimeFormat('zh-CN',{timeZone:scenario.timeZone||'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
const shortDate = ts => dateFmt.format(new Date(ts));
const shortTime = ts => timeFmt.format(new Date(ts));
const json = obj => JSON.stringify(obj,null,2);
const nowISO = () => new Date(cursor).toISOString();
const button = (id,label,extra='') => `<button data-item="${escape(id)}" ${extra}>${label}</button>`;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function relative(seconds) {
  if (seconds == null) return '未设定';
  const abs = Math.abs(seconds), units = abs >= 86400 ? `${Math.floor(abs/86400)} 天` : abs >= 3600 ? `${Math.floor(abs/3600)} 小时` : `${Math.floor(abs/60)} 分钟`;
  return seconds < 0 ? `已过 ${units}` : units;
}
function allItems(state) {
  const out=[];
  const walk=layer=>{ for(const item of layer?.items||[]) {out.push(item); walk(item.children);} };
  walk(state.root); out.push(...(state.historical||[]));
  return out;
}
function rootId(item,state=currentState) {
  let node=item; const seen=new Set();
  while(node?.parent_id && !seen.has(node.id)) {seen.add(node.id);node=getItem(state,node.parent_id);}
  return node?.id||item.id;
}
function colorFor(item,state) {
  const category=scenario.categories?.[rootId(item,state)];
  return category?.colorKey || ['sage','blue','sand','lilac','clay','mint'][Math.abs([...rootId(item,state)].reduce((a,c)=>a+c.charCodeAt(0),0))%6];
}
// The root layer with its one-share tail folded into one block (TAIL_ID), as the board lays it out.
function foldedRoot(state,index) {return foldLayer(state.root,{index,state});}
// Small items read newest first, the same order in the folded block and when it is spread out.
function tailOrder(tail,index) {
  const added=new Set(records[index].diff.changes.filter(c=>c.type==='added').map(c=>c.item));
  return [...tail].sort((a,b)=>Number(added.has(b.id))-Number(added.has(a.id))||Date.parse(b.updated_at)-Date.parse(a.updated_at));
}
function visibleLayer(state,index=frameIndex) {
  if(layerId===TAIL_ID) {const fold=foldedRoot(state,index);return fold.tail.length?{budget:fold.tailShare,used:fold.tailShare,items:tailOrder(fold.tail,index),isTail:true}:state.root;}
  return layerId ? getItem(state,layerId)?.children || {budget:64,used:0,items:[]} : state.root;
}
function annotationsFor(item,state=currentState) {return (state.annotations||[]).filter(a => a.item===item.id || a.item_id===item.id || item.annotations?.includes(a.id));}
function categoryLabel(item,state=currentState) {return scenario.categories?.[rootId(item,state)]?.label || '关注事项';}
function goFrame(i) {pause();setCursor(stamps[Math.max(0,Math.min(frames.length-1,i))]);}
// Embedded in all.html: the page above steps every prototype together.
const reportFrame=followFrames(goFrame);
function setCursor(time) {
  const previousIndex=frameIndex, previousCursor=cursor;
  cursor=Math.max(start,Math.min(end,time));
  frameIndex=stamps.reduce((last,t,i)=>t<=cursor?i:last,0);
  if(baseIndex>frameIndex)baseIndex=frameIndex;
  if(previousIndex!==frameIndex)panel=null;
  render(previousIndex!==frameIndex?{kind:'frame'}:null);
  if(previousIndex!==frameIndex) {
    $('event-list').closest('.inputs-panel').scrollTop=0;
    // Answers given before this round are now with the Agent: say so once.
    const received=answers.list(previousCursor).filter(record=>answers.status(record,previousCursor).status==='saved'&&answers.status(record,cursor).status==='acknowledged');
    if(received.length)toast(`Agent 已在 ${shortTime(stamps[frameIndex])} 的整理中收到你的 ${received.length} 条回应`);
  }
}
// Only explicit historical merge relations connect different IDs. Rewinding
// follows those same links back to their sources; ordinary additions stay new.
function motionLinks(before,after) {
  const links=new Map();
  const connect=(source,target,reverse)=>{
    if(!source||!target)return;
    const targetItems=new Map(allItems(target).map(item=>[item.id,item]));
    for(const item of allItems(source).filter(item=>item.status==='active')) {
      let node=targetItems.get(item.id); const seen=new Set();
      while(node?.merged_into&&!seen.has(node.id)) {
        seen.add(node.id);node=targetItems.get(node.merged_into);
        if(node?.status==='active') {
          const link=reverse?{from:node.id,to:item.id}:{from:item.id,to:node.id};
          links.set(`${link.from}:${link.to}`,link);break;
        }
      }
    }
  };
  connect(before,after,false);connect(after,before,true);
  return [...links.values()];
}
function currentBoardSizes() {return ['workspace','current-board','base-board'].map(id=>`${$(id).clientWidth}x${$(id).clientHeight}`).join('|');}
function animatePanels(previous) {
  if(reduced())return;
  for(const [id,oldContent] of previous) {
    const el=$(id);
    if(el.innerHTML===oldContent)continue;
    panelAnimations.push(el.animate([{opacity:.55,transform:'translateY(2px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.2,.7,.2,1)'}));
  }
}
function updateMotionControls() {
  const off=reduced();
  $('replay-motion').disabled=!flips.current?.canReplay||off;
  $('replay-motion').title=off?'系统已开启减少动态效果':'重播刚才的份额与布局变化';
  $('slow-motion').disabled=off;
  $('slow-motion').title=off?'系统已开启减少动态效果':'放慢过渡，便于看清去向';
  $('slow-motion').setAttribute('aria-pressed',String(slowMotion));
  $('slow-motion').classList.toggle('is-active',slowMotion);
}
const motionScale=kind=>(kind==='dive'||kind==='rise'?LAYER_MS/FRAME_MS:1)*(slowMotion?3:1);
function replayMotion() {pause();for(const flip of Object.values(flips))flip.replay(slowMotion?3:1);}
function syncURL() {
  const p=new URLSearchParams();p.set('frame',String(frameIndex));
  if(cursor!==stamps[frameIndex])p.set('at',String(cursor));
  if(layerId)p.set('layer',layerId);
  if(selected.type==='item')p.set('item',selected.id);
  if(comparing)p.set('base',String(baseIndex));
  for(const [key,value] of new URLSearchParams(location.search))if(key==='data')p.set('data',value);
  history.replaceState(null,'',`${location.pathname}?${p}`);
  reportFrame(frameIndex);
  document.querySelectorAll('[data-prototype-variant]').forEach(link=>{
    const target=new URLSearchParams(p);target.set('variant',link.dataset.prototypeVariant);
    link.href=`./?${target}`;
  });
}
function render(transition=null) {
  const oldState=currentState, oldBase=baseState;
  panelAnimations.forEach(animation=>animation.cancel());panelAnimations=[];
  const previous=transition?.kind==='frame'?['frame-title','agent-note'].map(id=>[id,$(id).innerHTML]):[];
  const inspectorScroll=document.querySelector('.inspector').scrollTop, previousSelection=JSON.stringify(selected);
  currentState=projectState(records[frameIndex].snapshot,nowISO());
  baseState=projectState(records[baseIndex].snapshot,nowISO());
  if(layerId===TAIL_ID&&!foldedRoot(currentState,frameIndex).tail.length)layerId=null;
  if(layerId&&layerId!==TAIL_ID&&!getItem(currentState,layerId)?.children&&!(comparing&&getItem(baseState,layerId)?.children))layerId=null;
  currentDiff={base_event_seq:baseState.event_seq,source_event_seq:currentState.event_seq,now:nowISO(),...diffStates(baseState,currentState)};
  if(selected.type==='item') {
    const currentItem=getItem(currentState,selected.id), baselineItem=comparing&&getItem(baseState,selected.id);
    if(!currentItem&&!baselineItem)selected={type:'state'};
    else if(!currentItem)selected.origin='base';
    else if(!comparing || (selected.origin==='base'&&!baselineItem))selected.origin=undefined;
  }
  const f=frames[frameIndex], r=records[frameIndex];
  if(selected.type==='batch'&&!f.batch)selected={type:'state'};
  if(selected.type==='event'&&Date.parse(findEvent(selected.id)?.at)>cursor)selected={type:'state'};
  $('frame-date').textContent=`${shortDate(cursor)} · ${shortTime(cursor)}`;
  $('frame-title').textContent=f.title;
  $('revision-tag').textContent=`${currentState.revision} / e${currentState.event_seq}`;
  $('agent-note').textContent=f.narrative;
  document.querySelector('.note-label').textContent=f.phase==='initial'?'初始状态':'整理依据';
  $('legend-changed-label').textContent=comparing?'与基线相比有变化':'本轮有变化';
  $('board-legend').hidden=f.phase==='initial';
  renderSignal();
  const coldStart=scenario.id==='shanghai-two-weeks'&&frames[0].phase==='initial'&&frameIndex<=3;
  $('cold-start-progress').hidden=!coldStart;
  $('cold-start-progress').innerHTML=coldStart?['暂无事项','导出范围待定','陪妈妈约定','工作事项'].map((label,i)=>`${i?'<span aria-hidden="true">→</span>':''}<button data-frame="${i}" ${i===frameIndex?'aria-current="step"':''}>${label}</button>`).join(''):'';
  const layer=visibleLayer(currentState);
  const asked=layer.items.filter(item=>askOf(currentState,frameIndex,item.id));
  const answeredHere=asked.filter(item=>answerOf(item,askOf(currentState,frameIndex,item.id))).length, asking=asked.length-answeredHere;
  $('layer-title').textContent=layerId===TAIL_ID?`放大：这 ${layer.items.length} 件在全部事项里合计 ${layer.used} 份`:layerId?'子层 · 独立 64 份预算':`${layer.items.length} 件${asking?`，${asking} 件等你回应`:''}${answeredHere?`，${answeredHere} 件你已回应`:''}`;
  $('budget-label').innerHTML=layerId===TAIL_ID?`<span>每格 1 份 · 放大显示</span>`:`已用 <strong>${layer.used}</strong> / ${layer.budget}<span> · 留白 ${layer.budget-layer.used}</span>`;
  $('breadcrumbs').innerHTML=breadcrumbs();
  $('compare-controls').hidden=!comparing;
  $('base-column').hidden=!comparing;
  $('current-label').hidden=!comparing;
  $('boards-wrap').classList.toggle('is-comparing',comparing);
  $('compare-button').classList.toggle('is-active',comparing);
  $('compare-button').setAttribute('aria-pressed',String(comparing));
  $('base-label').textContent=`基线 · ${shortDate(frames[baseIndex].at)} ${shortTime(frames[baseIndex].at)}`;
  $('current-label').textContent=`当前 · ${shortDate(cursor)} ${shortTime(cursor)}`;
  if(comparing) {
    const option=(f,i)=>({value:i,meta:`${String(i+1).padStart(2,'0')} · ${shortDate(f.at)} ${shortTime(f.at)}`,title:f.title});
    basePicker.set(frames.slice(0,frameIndex+1).map(option),baseIndex);
    targetPicker.set(frames.map(option),frameIndex);
  } else {basePicker.close(false);targetPicker.close(false);}
  const links=transition?[...motionLinks(oldState,currentState),...(comparing?motionLinks(oldBase,baseState):[])]:[];
  hideHoverCard();
  renderEvents();renderBoards(transition,links);renderInspector();renderTimeline();renderDiffSummary();syncURL();
  if(JSON.stringify(selected)===previousSelection&&selected.type!=='state')document.querySelector('.inspector').scrollTop=inspectorScroll;
  if(transition?.kind==='frame')animatePanels(previous);
  updateMotionControls();
}
function windowText(w) {
  const sameDay=shortDate(w.from)===shortDate(w.to);
  return `${shortDate(w.from)} ${shortTime(w.from)} – ${sameDay?'':`${shortDate(w.to)} `}${shortTime(w.to)}`;
}
// Why the Agent was invoked, folded into the note line: a zero-event review says what the check found.
function renderSignal() {
  const f=frames[frameIndex], signal=f.signal, el=$('signal-note');
  const show=signal&&(signal.type==='review'||signal.reason);
  el.hidden=!show;
  if(!show){el.innerHTML='';}
  else if(signal.type==='review') {
    const r=records[frameIndex], n=r.diff.changes.length;
    el.innerHTML=`<b>零输入 · ${escape(signal.reason)}</b>${r.receipt?.type==='checked'?'检查后不变':`按时间重看，调整 ${n} 项`}`;
  } else el.innerHTML=`<b>${escape(signal.reason)}</b>收到 ${signal.received} 条`;
  // The note never pushes the board around: two lines, the rest one click away.
  const note=$('frame-note');
  note.classList.remove('is-open');$('note-toggle').setAttribute('aria-expanded','false');$('note-toggle').textContent='展开';
  requestAnimationFrame(()=>{const text=note.querySelector('.frame-note-text');$('note-toggle').hidden=text.scrollHeight<=text.clientHeight+2;});
}
function breadcrumbs() {
  if(!layerId)return '';
  if(layerId===TAIL_ID)return `<button class="rise-button" data-rise="true" aria-label="返回全部事项" title="返回（Esc）">↑</button><button data-layer="">全部关注事项</button><span aria-hidden="true">/</span><button data-layer="${TAIL_ID}" aria-current="page">另有 ${visibleLayer(currentState).items.length} 件小事</button>`;
  const nodes=[]; let item=getItem(currentState,layerId); const seen=new Set();
  while(item&&!seen.has(item.id)){seen.add(item.id);nodes.unshift(item);item=item.parent_id?getItem(currentState,item.parent_id):null;}
  return `<button class="rise-button" data-rise="true" aria-label="返回上一层" title="返回上一层（Esc）">↑</button><button data-layer="">全部关注事项</button>`+nodes.map((n,i)=>`<span aria-hidden="true">/</span><button data-layer="${escape(n.id)}" ${i===nodes.length-1?'aria-current="page"':''}>${escape(n.title)}</button>`).join('');
}

// ---------- inputs: grouped by stream, the person's own moves first, the rest folded ----------

function relatedOf(e) {return [...new Set([...(e.relatedIds||[]),...(e.feedback||[]).map(l=>l.target),e.reminder?.target].filter(Boolean))];}
function feedbackLines(e,index) {
  const lines=(e.feedback||[]).map(link=>{
    const line=feedbackLine(e,link,index,currentState);
    const what=line.answers?`回答了「${escape(line.prompt)}」${line.choice?`：${escape(line.choice)}`:''}`:`记在「${escape(line.title)}」上${line.stillOpen?'，那里的问题仍开着':''}`;
    return `<button class="event-loop${line.answers?' is-answer':''}" data-item="${escape(link.target)}"><span aria-hidden="true">↳</span><span>${what}</span></button>`;
  });
  if(e.reminder)lines.push(`<button class="event-loop is-reminder" data-item="${escape(e.reminder.target)}"><span aria-hidden="true">◷</span><span>到点提醒：兑现 ${shortDate(e.reminder.requested_at)} ${shortTime(e.reminder.requested_at)} 约定的稍后提醒</span></button>`);
  return lines.join('');
}
function eventRow(e,index) {
  const related=relatedOf(e).filter(id=>getItem(currentState,id));
  const attrs=`data-verdict="${escape(e.disposition)}" data-related="${escape(related.join(' '))}"`;
  const selectedClass=selected.type==='event'&&selected.id===e.id?' is-selected':'';
  if(e.self) {
    const act=actionText(e);
    return `<article class="event-item is-self${selectedClass}" ${attrs}><button class="event-open" data-event="${escape(e.id)}"><span class="event-action"><b>${escape(act.sentence)}</b><time>${shortTime(e.at)}</time></span>${act.title?`<span class="event-object">${escape(act.title)}</span>`:''}</button>${feedbackLines(e,index)}</article>`;
  }
  const who=authorOf(e), ref=eventRef(e), text=plainText(e.text);
  return `<article class="event-item${selectedClass}" ${attrs}><button class="event-open" data-event="${escape(e.id)}"><span class="event-meta"><span class="event-from">${escape(who.name)}</span>${who.tag?`<span class="event-tag">${who.tag}</span>`:''}<time>${shortTime(e.at||frames[index].at)}</time></span>${ref.title?`<span class="event-object">${ref.label?`<b>${escape(ref.label)}</b> `:''}${escape(ref.title)}</span>`:''}${text?`<span class="event-text">${escape(text)}</span>`:''}<span class="event-verdict"><span class="verdict-tag">${verdicts[e.disposition]||escape(e.disposition)}</span>${escape(e.why||'')}</span></button>${feedbackLines(e,index)}</article>`;
}
function groupHTML(key,title,meta,rows,{open,foldLabel=''}={}) {
  return `<section class="event-group" data-group="${key}"><button class="group-head" data-group-toggle="${key}" aria-expanded="${open}"><span class="group-title">${title}</span><span class="group-meta">${meta}</span><span class="group-caret" aria-hidden="true"></span></button>${open?`<div class="group-body">${rows}</div>`:foldLabel?`<div class="group-fold">${foldLabel}</div>`:''}</section>`;
}
function renderEvents() {
  const f=frames[frameIndex], events=f.events, initial=f.phase==='initial';
  $('inputs-heading').textContent=initial?'输入':cursor>stamps[frameIndex]+60000?'最近一轮输入':'本轮输入';
  $('event-count').textContent=`${events.length} 条`;
  const signal=f.signal;
  $('input-window').innerHTML=signal?.window?`窗口 ${windowText(signal.window)}${signal.coverage?`<br>${escape(signal.coverage)}`:''}`:'';
  if(initial){$('event-list').innerHTML='<div class="initial-input"><span class="empty-input-mark" aria-hidden="true">↘</span><h3>暂无原始输入</h3><p>当前尚未发生整理。点击播放或前进，查看首批输入。</p></div>';return;}
  if(!events.length){$('event-list').innerHTML=`<div class="empty-detail">${signal?.type==='review'?`<h3>这个窗口没有新输入</h3><p>${windowText(signal.window)} 未收到消息。没收到消息不代表现实没有变化；Agent 按当前时间重看了已有事项。</p>`:'本轮暂无原始输入。'}</div>`;return;}
  const html=[];
  const self=events.filter(e=>e.self);
  if(self.length) {
    const open=openGroups.has('self'), answered=self.filter(e=>(e.feedback||[]).length).length;
    const shown=openGroups.has('self:all')?self:self.slice(0,6);
    html.push(groupHTML('self',`你 · ${escape(personName)}`,`${self.length} 件${answered?` · ${answered} 件接上事项`:''}`,
      shown.map(e=>eventRow(e,frameIndex)).join('')+(self.length>shown.length?`<button class="group-more" data-group-toggle="self:all">还有 ${self.length-shown.length} 件 ▾</button>`:''),{open,foldLabel:''}));
  }
  const others=events.filter(e=>!e.self);
  const streams=[...new Set(others.map(e=>e.stream||'all'))].sort((a,b)=>['work','life','community','subscription','all'].indexOf(a)-['work','life','community','subscription','all'].indexOf(b));
  for(const stream of streams) {
    const list=others.filter(e=>(e.stream||'all')===stream), used=list.filter(e=>e.disposition==='used'), rest=list.filter(e=>e.disposition!=='used');
    const restOpen=openGroups.has(`rest:${stream}`), open=!openGroups.has(`closed:${stream}`);
    const counts=Object.entries(rest.reduce((acc,e)=>{acc[e.disposition]=(acc[e.disposition]||0)+1;return acc;},{})).map(([k,n])=>`${verdicts[k]||k} ${n}`).join(' · ');
    const rows=used.map(e=>eventRow(e,frameIndex)).join('')+(rest.length?(restOpen?`<div class="group-rest">${rest.map(e=>eventRow(e,frameIndex)).join('')}</div><button class="group-more" data-group-toggle="rest:${stream}" aria-expanded="true">收起其余 ${rest.length} 条</button>`:`<button class="group-more" data-group-toggle="rest:${stream}" aria-expanded="false">其余 ${rest.length} 条 · ${counts} ▸</button>`):'');
    html.push(groupHTML(`closed:${stream}`,streamNames[stream]||'输入',`采用 ${used.length} / ${list.length}`,rows||'<p class="group-empty">本轮没有输入。</p>',{open}));
  }
  $('event-list').innerHTML=html.join('');
}

// ---------- board ----------

const flips={};
function renderBoards(transition,links=[]) {
  const workspace=$('workspace');
  if(innerWidth>=1000) {
    const offset=$('current-board').getBoundingClientRect().top-workspace.getBoundingClientRect().top+workspace.scrollTop;
    const height=Math.max(comparing?200:260,Math.min(620,Math.floor(workspace.clientHeight-offset-44)));
    $('current-board').style.height=`${height}px`;$('base-board').style.height=`${height}px`;
  } else {$('current-board').style.height='';$('base-board').style.height='';}
  const focused=document.activeElement, focusBoard=focused?.closest?.('.pinboard');
  const focusKey=focusBoard&&(focused.dataset.item?`[data-item="${CSS.escape(focused.dataset.item)}"]`:focused.dataset.answer?`[data-answer="${CSS.escape(focused.dataset.answer)}"]`:focused.dataset.tail?'[data-tail]':focused.dataset.dive?`[data-dive="${CSS.escape(focused.dataset.dive)}"]`:null);
  const zoom=transition&&(transition.kind==='dive'||transition.kind==='rise')?transition:null;
  drawBoard('current',$('current-board'),currentState,false,{transition,links,zoom});
  if(comparing)drawBoard('base',$('base-board'),baseState,true,{transition,links,zoom});
  else flips.base?.clear();
  if(focusBoard&&focusKey&&!focusBoard.contains(document.activeElement))focusBoard.querySelector(`.pin-tile:not(.is-leaving) > .flip-body ${focusKey}`)?.focus({preventScroll:true});
  boardSizes=currentBoardSizes();
}
function tileClasses(rect,extra='') {
  const tiny=rect.height<58, narrow=!tiny&&rect.width<104, small=!tiny&&!narrow&&(rect.width<150||rect.height<128);
  return `${small?'is-small':''} ${narrow?'is-narrow':''} ${tiny?'is-tiny':''} ${extra}`;
}
function answerOf(item,ask) {
  const record=answers.find(item.id,cursor,ask?.id);
  return record?{record,...answers.status(record,cursor)}:null;
}
function receiptText(answer) {return answer.status==='acknowledged'?`Agent ${shortTime(answer.at)} 已收到`:'已保存，等下一轮整理';}
function itemTile(rect,item,state,isBase,index,changes) {
  const ask=askOf(state,index,item.id), normalized=ask&&normalizeAsk(ask), answer=ask&&!isBase?answerOf(item,ask):null;
  const changed=(comparing||frameIndex>0)&&changes.get(item.id), n=item.children?.items?.length||0;
  const kind=kinds[item.kind]||escape(item.kind);
  const approve=normalized?.expects==='approve';
  const inline=approve&&!isBase&&rect.width>=190&&rect.height>=112;
  const subject=approve?approveSubject(ask,index):null;
  const shareDelta=changed&&changed.before?.share!=null&&changed.after?.share!=null?`份额 ${changed.before.share}→${changed.after.share}`:changed?changeNames[changed.type]||'变化':'';
  const label=answer?`<span class="tile-answered">✓ ${escape(answerWords(answer.record).replace(/^你/,''))}</span>`:ask?`<span class="tile-ask">${askLabel(normalized)}</span>${item.kind!=='needs-you'?`<span class="tile-kind-after">· ${kind}</span>`:''}`:`<span class="tile-kind">${kind}</span>`;
  const aria=`${item.title}，份额 ${item.share}，${kind}${ask?`，${askLabel(normalized)}：${ask.prompt}`:''}${answer?`，${answerWords(answer.record)}，${receiptText(answer)}`:''}${changed?`，${shareDelta}`:''}${n?`，${n} 个子项`:''}`;
  const actions=inline?(answer?`<div class="tile-actions is-answered ${answer.status==='acknowledged'?'is-received':''}"><span class="tile-receipt">${receiptText(answer)}</span><button class="tile-undo" data-undo="${escape(answer.record.key)}">撤销</button></div>`
    :`<div class="tile-actions" role="group" aria-label="${escape(ask.prompt)}"><button class="tile-approve is-primary" data-answer="${escape(item.id)}:approve">批准</button><button class="tile-approve" data-answer="${escape(item.id)}:request-changes">要求修改</button></div>`):'';
  const html=`<button class="tile-button" data-item="${escape(item.id)}" ${isBase?'data-origin="base"':''} aria-label="${escape(aria)}"><span class="tile-top"><span class="tile-label">${label}</span><span class="tile-share">${item.share}<small> 份</small></span></span><h3>${escape(item.title)}</h3>${subject&&inline?`<p class="tile-subject"><b>#${escape(subject.number)}</b> ${escape(subject.title)}</p>`:''}${ask&&!answer?`<p class="tile-prompt">${escape(ask.prompt)}</p>`:''}<p class="tile-summary">${escape(item.summary)}</p>${shareDelta||n?`<span class="tile-footer">${shareDelta?`<span class="change-label">${shareDelta}</span>`:'<span></span>'}</span>`:''}</button>${actions}${n?`<button class="dive-button" data-dive="${escape(item.id)}" ${isBase?'data-origin="base"':''} aria-label="进入${escape(item.title)}子层，${n} 个子项" title="进入子层">${n} 子项 <span aria-hidden="true">↗</span></button>`:''}`;
  return {id:item.id,...rect,html,key:`${html.length}:${html}`,
    className:tileClasses(rect,`${ask?'has-ask':''} ${answer?'is-answered':''} ${inline?'has-actions':''} ${changed?'is-changed':''} ${n?'has-children':''} ${selected.type==='item'&&selected.id===item.id?'is-selected':''}`),
    attrs:{'data-color':colorFor(item,state),'data-share':item.share}};
}
function tailTile(rect,fold,state,changes,isBase) {
  const fresh=new Set(fold.tail.filter(item=>changes.get(item.id)?.type==='added').map(item=>item.id));
  const ordered=tailOrder(fold.tail,isBase?baseIndex:frameIndex);
  const selectedHere=selected.type==='item'&&fold.tail.some(item=>item.id===selected.id);
  const html=`<button class="tile-button tail-button" data-tail="open" ${isBase?'data-origin="base"':''} aria-label="另有 ${fold.tail.length} 件小事，各 1 份，合计 ${fold.tailShare} 份；铺开查看"><span class="tile-top"><span class="tile-kind">另有 <b>${fold.tail.length}</b> 件小事</span><span class="tile-share">${fold.tailShare}<small> 份</small></span></span><span class="tail-note">各占 1 份${fresh.size?` · <i>${fresh.size} 件本轮新增</i>`:''}</span><ul class="tail-list">${ordered.map(item=>`<li data-tail-item="${escape(item.id)}" data-color="${colorFor(item,state)}" class="${fresh.has(item.id)?'is-new':''}${selected.type==='item'&&selected.id===item.id?' is-selected':''}">${escape(item.title)}</li>`).join('')}</ul><span class="tail-more"></span><span class="tail-open">铺开 <span aria-hidden="true">↗</span></span></button>`;
  return {id:TAIL_ID,...rect,html,key:html,className:`is-tail ${selectedHere?'has-selected':''} ${fresh.size?'is-changed':''}`,attrs:{'data-share':fold.tailShare}};
}
function blankTile(rect,state,isBase) {
  const initial=state.event_seq===0&&!layerId;
  const html=`<div class="blank-body">${initial?`<span class="empty-board-label">暂无事项</span><strong>64 <small>份未分配</small></strong><p>收到输入并完成整理后，相关事项显示在这里。</p>${!isBase&&!comparing?'<button class="cold-start-button" data-frame="1">查看首批输入 <span aria-hidden="true">→</span></button>':''}`:`<span class="blank-label">未分配</span><strong>${rect.share}</strong><small>份留白</small>`}</div>`;
  return {id:'__blank__',...rect,html,key:html,className:`is-blank ${initial?'is-initial':''} ${(rect.width<120||rect.height<75)?'is-small':''}`,attrs:{'data-share':rect.share}};
}
function drawBoard(name,el,state,isBase,{transition,links,zoom}) {
  const w=el.clientWidth,h=el.clientHeight;
  if(!w||!h)return;
  flips[name]??=createFlipBoard(el,{tileClass:'pin-tile',duration:FRAME_MS,onRender:fitTile});
  const index=isBase?baseIndex:frameIndex;
  const layer=visibleLayer(state,index);
  const fold=!layerId?foldedRoot(state,index):{entries:layer.items,tail:[],tailShare:0};
  const rects=layoutFill(fold.entries,layer.budget,w,h);
  const changes=new Map((comparing?currentDiff.changes:records[frameIndex].diff.changes).map(c=>[c.item,c]));
  const entries=rects.map(rect=>rect.isBlank?blankTile(rect,state,isBase):rect.id===TAIL_ID?tailTile(rect,fold,state,changes,isBase)
    :itemTile(rect,getItem(state,rect.id),state,isBase,index,changes));
  // Dive and rise zoom through the anchor tile; the tail block counts as an anchor too.
  let zoomRects=null;
  if(zoom) {
    const board={x:0,y:0,width:w,height:h};
    const anchor=zoom.kind==='dive'?zoom.anchorRect?.[name]:entries.find(entry=>entry.id===zoom.anchorId);
    if(anchor)zoomRects=zoom.kind==='dive'?{from:anchor,to:board}:{from:board,to:anchor};
  }
  flips[name].update(entries,{animate:Boolean(transition),links,zoom:zoomRects,scale:motionScale(transition?.kind)});
}
// Never leave half-cut lines: drop the summary first, then the prompt, then clamp the subject and title.
function fitTile(tile,entry) {
  if(entry.id==='__blank__'){if(entry.width<44||entry.height<28)tile.dataset.fit='sliver';else tile.removeAttribute('data-fit');return;}
  const body=tile.querySelector(':scope > .flip-body'), box=body.querySelector('.tile-button');
  // Fit results live in data-fit, which the keyed board keeps when it rewrites a tile's classes.
  const fit=new Set();tile.removeAttribute('data-clipped');
  const done=()=>{if(fit.size)tile.dataset.fit=[...fit].join(' ');else tile.removeAttribute('data-fit');};
  if(entry.width<34||entry.height<22){fit.add('sliver');done();return;}
  if(entry.id===TAIL_ID){done();fitTail(box);return;}
  const label=box.querySelector('.tile-label');
  if(label&&label.scrollWidth>label.clientWidth+1)fit.add('compact-label');
  const over=()=>box.scrollHeight>box.clientHeight+1;
  if(!over()){done();return;}
  tile.dataset.clipped='1';
  const clamp=(el,min)=>{
    const lines=Math.max(1,Math.round(el.clientHeight/parseFloat(getComputedStyle(el).lineHeight)));
    for(let n=lines-1;n>=min&&over();n--){el.style.display='-webkit-box';el.style.webkitBoxOrient='vertical';el.style.webkitLineClamp=String(n);el.style.overflow='hidden';}
  };
  const summary=box.querySelector('.tile-summary'), prompt=box.querySelector('.tile-prompt'), subject=box.querySelector('.tile-subject'), title=box.querySelector('h3');
  const footer=box.querySelector('.tile-footer'), cramped=entry.width<150||entry.height<128;
  if(summary){clamp(summary,1);if(over())summary.remove();}
  if(prompt&&over()){clamp(prompt,1);if(over())prompt.remove();}
  // Small tiles keep the title before the change label; the clay edge still says it changed.
  if(footer&&cramped&&over()){footer.remove();fit.add('no-dive');}
  if(subject&&over())clamp(subject,1);
  if(title&&over())clamp(title,1);
  if(over()){box.querySelector('.tile-footer')?.remove();fit.add('no-dive');}
  done();
}
// The tail block lists as many titles as fit and counts the rest.
function fitTail(box) {
  const list=box.querySelector('.tail-list'), more=box.querySelector('.tail-more');
  const items=[...list.children], limit=list.clientHeight;
  let hidden=0;
  for(const li of items){if(li.offsetTop+li.offsetHeight>limit+1){li.hidden=true;hidden++;}}
  more.textContent=hidden?`还有 ${hidden} 件`:'';
}

// ---------- reader ----------

function renderDiffSummary() {
  $('diff-summary').hidden=!comparing;
  if(!comparing)return;
  const changes=currentDiff.changes;
  $('diff-summary').innerHTML=`<div class="panel-heading"><h3>状态差异</h3><button id="diff-json-button">Diff JSON ↗</button></div>${changes.length?`<div class="diff-list">${changes.map(c=>{const item=getItem(currentState,c.item)||getItem(baseState,c.item);return `<button class="diff-entry" data-item="${escape(c.item)}"><span class="diff-type" data-type="${c.type}">${changeNames[c.type]||c.type}</span><strong>${escape(item?.title||c.item)}</strong><span class="diff-values">${(c.fields||[]).map(f=>fieldNames[f]||f).join('、')}</span>${c.before?.share!==c.after?.share?`<span class="mono">${c.before?.share??'∅'} → ${c.after?.share??'∅'}</span>`:''}</button>`;}).join('')}</div>`:'<p class="empty-diff">业务状态无变化，份额保持不变。</p>'}<p class="diff-caption">比较端点的内容、结构与反馈；两端使用同一 now。撤下项保留在这里，不占当前面积。</p>`;
}
function section(title,content,extra='') {return `<section class="detail-section" ${extra}><h3>${title}</h3>${content}</section>`;}
function scalarChanges(change) {
  const format=(field,value)=>value==null?'未设置':field==='kind'?kinds[value]||value:field==='status'?statuses[value]||value:field==='weight'?weights[value]||value:['due_at','stale_after'].includes(field)?`${shortDate(value)} ${shortTime(value)}`:value;
  const fields=(change.fields||[]).filter(f=>['weight','share','kind','status','due_at','stale_after','merged_into'].includes(f));
  return fields.length?`<dl class="change-facts">${fields.map(f=>`<div><dt>${fieldNames[f]}</dt><dd><span>${escape(format(f,change.before?.[f]))}</span><span aria-hidden="true"> → </span><strong>${escape(format(f,change.after?.[f]))}</strong></dd></div>`).join('')}</dl>`:'';
}
const rsClasses={actions:'og-actions',btn:'og-btn',fill:'is-primary',line:'is-line',snooze:'og-snooze',subject:'og-subject',options:'og-options',composer:'og-composer',send:'og-send',suggest:'og-suggest'};
function panelHTML(ask,itemId) {
  if(!panel||!panel.key.startsWith(`${itemId}:`)&&panel.key!==itemId)return '';
  const action=ask.actions.find(a=>`${itemId}:${a.id}`===panel.key);
  const body=panel.kind==='compose'&&action?composerHTML(action,{key:panel.key,classes:rsClasses}):panel.kind==='keypad'&&action?keypadHTML(action,{key:panel.key,classes:rsClasses})
    :panel.kind==='schedule'&&action?scheduleHTML(action,{key:panel.key,now:cursor,classes:rsClasses}):panel.kind==='defer'?deferHTML({target:itemId,now:cursor,classes:rsClasses}):'';
  return body?`<div class="og-panel">${body}<button class="text-button" data-panel-close>收起</button></div>`:'';
}
// What this version asks and how to answer it here. Saved is not acknowledged; neither is the outside action done.
function askSection(item,state,index) {
  const ask=askOf(state,index,item.id);
  if(!ask)return item.kind==='needs-you'?section('回应',`<p class="ask-missing">这一版没有登记回应路径：Agent 改写了内容但未重新登记，回应无法从这里回传。</p>`):'';
  const normalized=normalizeAsk(ask), answer=answerOf(item,ask), registered=frames[ask.frameIndex];
  const subject=normalized.expects==='approve'?approveSubject(ask,index):null;
  const due=dueText({due:ask.due_at?Date.parse(ask.due_at):null},cursor);
  let body=`<p class="ask-prompt">${escape(ask.prompt)}</p>`;
  if(subject)body+=`<p class="ask-subject">批准后由 Agent 去 GitHub ${subject.verb} <b>#${escape(subject.number)}</b>${subject.title?` · ${escape(subject.title)}`:''}</p>`;
  if(due)body+=`<p class="ask-due${ask.due_at&&Date.parse(ask.due_at)<cursor?' is-late':''}">${escape(due)}</p>`;
  if(selected.origin==='base')body+='<p class="ask-meta">基线时刻的版本，只读。</p>';
  else if(answer) body+=`<div class="og-receipt ${answer.status==='acknowledged'?'is-received':''}"><span class="og-check" aria-hidden="true">✓</span><span><b>${escape(answerWords(answer.record))}</b>${answer.record.value&&answer.record.meaning!=='input'?` ${escape(answer.record.value)}`:''}<small>${answer.status==='acknowledged'?`Agent 已在 ${shortDate(answer.at)} ${shortTime(answer.at)} 的整理中收到。${normalized.expects==='approve'?'合并是否完成，看之后的版本。':'事情怎样处理，看之后的版本。'}`:`${shortTime(answer.record.at)} 已保存，等 Agent 下一轮整理；状态尚未改变。`}</small></span><button class="text-button" data-undo="${escape(answer.record.key)}">撤销 <kbd>U</kbd></button></div>`;
  else body+=`<div class="og-respond" data-respond="${escape(item.id)}">${responseHTML(normalized,{target:item.id,classes:rsClasses,showSubject:false})}${panelHTML(normalized,item.id)}</div>${normalized.expects==='approve'?'<p class="ask-keys"><kbd>A</kbd> 批准 · <kbd>R</kbd> 要求修改</p>':''}`;
  body+=`<small class="ask-meta">${shortDate(registered.at)} ${shortTime(registered.at)} 随这一版登记 · 回应只留在本页，交给 Agent 下一轮整理</small>`;
  return `<section class="detail-section ask-card ${answer?'is-answered':''}"><h3><span class="ask-expects">${answer?'你已回应这个问题':askLabel(normalized)}</span></h3>${body}</section>`;
}
function trailSection(item,index) {
  const trail=feedbackTrail({index},item.id);
  if(!trail.length)return '';
  return section(`来源处的回应 · ${trail.length}`,`<ol class="loop-trail">${trail.map(({event,links,frameIndex:fi})=>{
    const lines=links.map(link=>{const line=feedbackLine(event,link,fi,currentState);return line.answers?`回答了「${escape(line.prompt)}」${line.choice?`：${escape(line.choice)}`:''}`:'记在这件事上，没有回答它的问题';});
    const head=event.reminder?'到点提醒':event.self?escape(actionText(event).sentence):`${escape(authorOf(event).name)} 回复`;
    return `<li><time>${shortDate(event.at)} ${shortTime(event.at)}</time><div><strong>${head}</strong><span>${lines.join('；')}</span></div><button class="text-button" data-event="${escape(event.id)}">原文</button></li>`;
  }).join('')}</ol>`);
}
function sourcesSection(item) {
  if(!item.sources?.length)return '';
  return section(`依据 · ${item.sources.length} 条`,`<div class="source-list">${item.sources.map(source=>{
    const event=source.ref?.startsWith('event:')?findEvent(source.ref.slice(6)):null;
    const text=source.content||source.quote||event?.text||'';
    const who=event?authorOf(event):{name:source.author||''};
    const head=`<span class="source-meta">${escape(source.channel||event?.channel||'')}${who.name?` · ${escape(who.name)}`:''}${event?.at?` · ${shortDate(event.at)} ${shortTime(event.at)}`:''}</span>${event?.self?`<b class="source-action">${escape(actionText(event).sentence)}</b>`:''}`;
    if(!text)return `<div class="source-item">${head}${event?`<button class="text-button" data-event="${escape(event.id)}">查看原消息</button>`:''}</div>`;
    const preview=plainText(text);
    return `<details class="source-item"><summary>${head}<span class="source-preview">${escape(preview)}</span><span class="source-toggle">原文</span></summary><div class="md-body">${markdownHTML(text)}</div>${event?`<button class="text-button" data-event="${escape(event.id)}">在输入里定位</button>`:''}</details>`;
  }).join('')}</div>`);
}
function versionsSection(item,index) {
  const versions=itemVersions(item.id,index);
  if(!versions.length)return '';
  const max=Math.max(...versions.map(v=>v.share||0),1);
  return section(`这件事的版本 · ${versions.length}`,`<ol class="version-list">${versions.map(v=>`<li class="${v.index===frameIndex?'is-now':''}"><button class="version-row" data-frame="${v.index}" title="跳到这一帧"><span class="version-when"><time>${shortDate(v.at)} ${shortTime(v.at)}</time><span class="version-type">${changeNames[v.type]||v.type}${v.fields?.includes('share')&&v.before?.share!=null?` · ${v.before.share}→${v.share}`:''}</span></span><span class="version-bar" style="--w:${Math.round((v.share||0)/max*100)}%"><i></i><b>${v.share||0}</b></span><span class="version-title">${escape(v.title||'')}</span>${v.summary&&v.type!=='withdrawn'?`<span class="version-summary">${escape(v.summary)}</span>`:''}</button></li>`).reverse().join('')}</ol>`);
}
function findEvent(id) {for(const f of frames){const e=f.events.find(e=>e.id===id);if(e)return e;}return null;}
function overviewHTML() {
  const asks=openAsks({index:frameIndex,state:currentState,now:nowISO()},{prefer:'approve'});
  const reviews=asks.filter(a=>a.ask.expects==='approve'), others=asks.filter(a=>a.ask.expects!=='approve');
  let content=`<div class="stat-pair"><div><span>当前关注</span><strong>${currentState.root.items.length}<small> 项</small></strong></div><div><span>等你回应</span><strong>${asks.filter(entry=>!answerOf(entry.item,entry.ask)).length}<small> 个</small></strong></div><div><span>根层留白</span><strong>${currentState.root.budget-currentState.root.used}<small> / ${currentState.root.budget}</small></strong></div></div>`;
  if(reviews.length)content+=section(`工作评审 · ${reviews.length}`,`<div class="review-list">${reviews.map(({item,ask})=>{
    const answer=answerOf(item,ask), subject=approveSubject(ask,frameIndex);
    return `<article class="review-row ${answer?'is-answered':''}" data-related="${escape(item.id)}"><button class="review-open" data-item="${escape(item.id)}"><span class="review-pr"><b>#${escape(subject?.number||'')}</b> ${escape(subject?.title||item.title)}</span><span class="review-prompt">${escape(ask.prompt)}</span></button>${answer?`<div class="og-receipt is-compact ${answer.status==='acknowledged'?'is-received':''}"><span class="og-check" aria-hidden="true">✓</span><span><b>${escape(answerWords(answer.record))}</b><small>${receiptText(answer)}</small></span><button class="text-button" data-undo="${escape(answer.record.key)}">撤销</button></div>`:`<div class="review-actions"><button class="og-btn is-primary" data-answer="${escape(item.id)}:approve">批准</button><button class="og-btn is-line" data-answer="${escape(item.id)}:request-changes">要求修改</button></div>`}</article>`;
  }).join('')}</div>`);
  if(others.length)content+=section(`其他问题 · ${others.length}`,`<div class="ask-list">${others.map(entry=>{const answer=answerOf(entry.item,entry.ask);const due=dueText(entry,cursor);return `<button class="ask-row" data-item="${escape(entry.item.id)}" data-related="${escape(entry.item.id)}"><span class="ask-expects">${answer?'✓ 已回应':askLabel(entry.ask)}</span><strong>${escape(entry.ask.prompt)}</strong><small>${escape(entry.item.title)} · ${entry.item.share} 份${due?` · <em class="${entry.overdue?'is-late':''}">${escape(due)}</em>`:''}</small></button>`;}).join('')}</div>`);
  const own=frames[frameIndex].events.filter(e=>e.self);
  if(own.length)content+=section(`这一轮你在原处做了 · ${own.length}`,`<div class="own-list">${own.slice(0,5).map(e=>`<button class="own-row" data-event="${escape(e.id)}"><b>${escape(actionText(e).sentence)}</b><span>${escape(actionText(e).title||'')}</span></button>`).join('')}${own.length>5?`<p class="own-more">另 ${own.length-5} 件在左侧「你」一栏</p>`:''}</div>`);
  const pending=(currentState.annotations||[]).filter(a=>a.status!=='acknowledged');
  if(pending.length)content+=section(`待确认的用户反馈 · ${pending.length}`,pending.map(a=>`<div class="annotation-item"><p>${escape(a.text)}</p>${button(a.item||a.item_id,'查看关联事项 ↗','class="text-button"')}</div>`).join(''));
  if(currentState.root.items.length)content+=section('全部顶层事项',`<details><summary>${currentState.root.items.length} 项，按份额</summary>${currentState.root.items.map(i=>`<div class="child-row">${button(i.id,`<span>${escape(i.title)}</span><small>${kinds[i.kind]} · ${i.share} 份</small>`)}</div>`).join('')}</details>`);
  const historical=currentState.historical||[];
  if(historical.length)content+=section(`历史事项 · ${historical.length}`,`<details><summary>已撤下与已合并事项</summary>${historical.map(i=>`<div class="child-row">${button(i.id,`<span>${escape(i.title)}</span><small>${statuses[i.status]}</small>`)}</div>`).join('')}</details>`);
  content+='<p class="detail-note">概览只辅助定位；切到「原始 JSON」核对此刻完整 state。</p>';
  const done=asks.filter(entry=>answerOf(entry.item,entry.ask)).length;
  return {title:`${currentState.root.items.length} 项关注，${asks.length-done} 个问题等你${done?`，${done} 个已回应`:''}`,content};
}
function renderInspector() {
  let title,eyebrow,content,obj;
  if(selected.type==='item') {
    const state=selected.origin==='base'?baseState:currentState;
    const item=getItem(state,selected.id);
    const index=selected.origin==='base'?baseIndex:frameIndex, ask=askOf(state,index,item.id);
    title=item.title;eyebrow=`${categoryLabel(item,state)} · ${item.id}`;obj=item;
    const anns=annotationsFor(item,state),children=item.children?.items||[];
    content=`<div class="detail-status"><span class="kind-badge">${kinds[item.kind]||escape(item.kind)}</span><span>${statuses[item.status]||item.status}</span><span class="mono">${item.share} / 64 份 · ${weights[item.weight]||item.weight}</span>${selected.origin==='base'?'<span>基线内容</span>':''}</div><p class="detail-summary">${escape(item.summary)}</p>`;
    content+=askSection(item,state,index);
    if(item.reason)content+=section('为什么在这里',`<p>${escape(item.reason)}</p>`);
    if(item.merged_into)content+=section('已合并到',button(item.merged_into,escape(getItem(currentState,item.merged_into)?.title||item.merged_into),'class="text-button"'));
    if(children.length)content+=section(`子事项 · ${children.length}`,`<div class="children-list">${children.map(c=>`<div class="child-row">${button(c.id,`<span>${escape(c.title)}</span><small>${kinds[c.kind]||c.kind} · ${c.share} 份</small>`)}${c.children?.items?.length?`<button data-dive="${escape(c.id)}" aria-label="进入${escape(c.title)}子层">↗</button>`:''}</div>`).join('')}</div><button class="text-button" data-dive="${escape(item.id)}">查看子事项概览 ↗</button>`);
    content+=sourcesSection(item);
    content+=trailSection(item,index);
    if(anns.length)content+=section(`用户反馈 · ${anns.length}`,anns.map(a=>`<div class="annotation-item"><div><strong>${escape(a.author)}</strong><span>${a.status==='acknowledged'?'已纳入整理':'待确认'}</span></div><p>${escape(a.text)}</p><small>${a.acknowledged_revision||a.bound_to||a.first_acknowledged_revision||''}</small></div>`).join(''));
    const changes=comparing?currentDiff.changes.filter(c=>c.item===item.id):records[frameIndex].diff.changes.filter(c=>c.item===item.id);
    if(changes.length)content+=section(comparing?'与基线相比':'本轮变化',changes.map(c=>`<div class="field-change"><strong>${changeNames[c.type]||c.type}</strong><span>${(c.fields||[]).map(f=>fieldNames[f]||f).join('、')}</span>${scalarChanges(c)}${c.before?.summary&&c.before.summary!==c.after?.summary?`<div class="before-after"><div><small>之前</small><p>${escape(c.before.summary)}</p></div><div><small>之后</small><p>${escape(c.after?.summary||'已退出当前关注')}</p></div></div>`:''}</div>`).join(''));
    content+=versionsSection(item,index);
    content+=section('时间',`<dl class="detail-times"><div><dt>首次纳入</dt><dd>${shortDate(item.created_at)} ${shortTime(item.created_at)}</dd></div><div><dt>距资料更新</dt><dd>${relative(item.since_update)}</dd></div>${item.due_at?`<div><dt>距截止</dt><dd>${relative(item.until_due)}</dd></div>`:''}${item.stale_after?`<div><dt>参考有效期</dt><dd>${relative(item.until_stale)}</dd></div>`:''}</dl>`);
  } else if(selected.type==='event') {
    const e=findEvent(selected.id);if(!e){selected={type:'state'};return renderInspector();}
    const who=authorOf(e), ref=eventRef(e), act=e.self?actionText(e):null;
    title=act?act.sentence:who.name;eyebrow=`原始输入 · ${e.channel}`;obj=e;
    content=`<div class="detail-status"><span>${shortDate(e.at)} ${shortTime(e.at)}</span><span class="verdict-tag">${verdicts[e.disposition]||e.disposition}</span>${e.stream?`<span>${streamNames[e.stream]||e.stream}</span>`:''}${who.tag?`<span class="event-tag">${who.tag}</span>`:''}${e.self?`<span>${escape(personName)}本人</span>`:`<span>${escape(who.name)}</span>`}</div>${ref.title?`<p class="event-subject">${ref.label?`<b>${escape(ref.label)}</b> `:''}${escape(ref.title)}</p>`:''}<div class="message-quote md-body">${markdownHTML(e.text)}${e.text_length&&e.text_length>String(e.text||'').length?`<p class="md-cut">原文 ${e.text_length} 字，演示截到 500 字</p>`:''}</div>${section('输入处理原因',`<p>${escape(e.why)}</p>`)}`;
    const loops=feedbackLines(e,frames.findIndex(f=>f.events.includes(e)));
    if(loops)content+=section('接到了哪件事',`<div class="event-loops">${loops}</div>`);
    if(e.relatedIds?.length)content+=section('关联事项',`<div class="related-list">${e.relatedIds.map(id=>button(id,escape(getItem(currentState,id)?.title||id),'class="related-chip"')).join('')}</div>`);
    const source=scenario.publicSources?.find(s=>s.id===e.publicSourceId);
    if(source)content+=section('公开事实与出处',`<p>${escape(source.fact)}</p><a href="${escape(source.url)}" target="_blank" rel="noreferrer">${escape(source.title)} ↗</a>`);
  } else if(selected.type==='batch') {
    title='批次声明与回执';eyebrow=frames[frameIndex].batch.batch_id;obj={request:frames[frameIndex].batch,receipt:records[frameIndex].receipt};
    content=`<p class="detail-summary">${escape(frames[frameIndex].narrative)}</p>${section('本轮提交结果',`<dl class="detail-times"><div><dt>输入消息</dt><dd>${frames[frameIndex].events.length} 条</dd></div><div><dt>声明</dt><dd>${frames[frameIndex].batch.declarations.length} 条</dd></div><div><dt>确认反馈</dt><dd>${frames[frameIndex].batch.acknowledges?.length||0} 条</dd></div><div><dt>结果</dt><dd>${records[frameIndex].receipt.type}</dd></div><div><dt>状态版本</dt><dd>${currentState.revision}</dd></div></dl>`)}<p class="detail-note">切到原始 JSON，可以核对实际参与回放的声明。</p>`;
  } else if(selected.type==='diff') {
    title='状态差异';eyebrow=`${baseState.revision} → ${currentState.revision}`;obj=currentDiff;
    content=`<p class="detail-summary">${currentDiff.changes.length} 项语义变化。位置、经过时间和派生排序不单独制造差异。</p>${currentDiff.changes.map(c=>section(`${changeNames[c.type]} · ${getItem(currentState,c.item)?.title||getItem(baseState,c.item)?.title||c.item}`,`<p>${(c.fields||[]).map(f=>fieldNames[f]||f).join('、')}</p>${button(c.item,'查看事项 ↗','class="text-button"')}`)).join('')}`;
  } else {
    eyebrow=`此刻完整状态 · ${currentState.revision}`;obj=currentState;
    ({title,content}=overviewHTML());
    if(frames[frameIndex].phase==='initial') {
      title='初始状态：暂无事项';eyebrow='初始状态 · r0 / e0';
      content='<p class="detail-summary">暂无事项、来源或用户反馈，尚未发生提交。</p>'+section('当前计数','<dl class="detail-times"><div><dt>当前条目</dt><dd>0 项</dd></div><div><dt>已分配份额</dt><dd>0 / 64</dd></div><div><dt>事件记录</dt><dd>0 条</dd></div></dl>')+section('查看后续输入','<p>点击「查看首批输入」或播放，逐步查看消息与整理结果。</p>')+'<p class="detail-note">切到原始 JSON，可以核对当前初始状态。</p>';
    }
  }
  inspectedJSON=obj;
  $('inspector-title').textContent=title;
  $('inspector-eyebrow').textContent=eyebrow;
  $('close-detail').hidden=selected.type==='state';
  $('detail-tab').classList.toggle('is-active',detailMode==='detail');$('json-tab').classList.toggle('is-active',detailMode==='json');
  $('detail-tab').setAttribute('aria-selected',String(detailMode==='detail'));$('json-tab').setAttribute('aria-selected',String(detailMode==='json'));
  $('detail-tab').tabIndex=detailMode==='detail'?0:-1;$('json-tab').tabIndex=detailMode==='json'?0:-1;
  $('inspector-body').setAttribute('aria-labelledby',detailMode==='detail'?'detail-tab':'json-tab');
  $('inspector-body').innerHTML=detailMode==='json'?`<div class="json-heading"><span>只读 · 与画布同一时刻</span><button id="download-json">下载 JSON ↓</button></div><pre class="json-view"><code>${highlightJSON(obj)}</code></pre>`:content;
  if(panel)$('inspector-body').querySelector('.og-panel textarea, .og-panel [data-rs-keypad], .og-panel button')?.focus({preventScroll:true});
}
function highlightJSON(obj) {
  return escape(json(obj)).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?\b)/g,(m,str,key,literal,num)=>str?`<span class="${key?'json-key':'json-string'}">${str}</span>${key||''}`:literal?`<span class="json-literal">${literal}</span>`:`<span class="json-number">${num}</span>`);
}
function renderTimeline() {
  const slider=$('time-slider');
  slider.style.setProperty('--progress',`${100*(cursor-start)/(end-start)}%`);
  slider.setAttribute('aria-valuemin',String(start));slider.setAttribute('aria-valuemax',String(end));slider.setAttribute('aria-valuenow',String(cursor));
  $('cursor-date').textContent=shortDate(cursor);$('cursor-time').textContent=shortTime(cursor);
  slider.setAttribute('aria-valuetext',`${shortDate(cursor)} ${shortTime(cursor)}，第 ${frameIndex+1} 帧，${frames[frameIndex].title}`);
  $('between-note').textContent=frames[frameIndex].phase==='initial'?'初始状态':cursor>stamps[frameIndex]+60000?'无新整理':'';
  $('frame-count').textContent=`${String(frameIndex+1).padStart(2,'0')} / ${frames.length}`;
  $('previous-frame').disabled=frameIndex===0;$('next-frame').disabled=frameIndex===frames.length-1;
  document.querySelectorAll('.timeline-marker').forEach(b=>{b.classList.toggle('is-current',Number(b.dataset.index)===frameIndex);b.classList.toggle('is-past',Number(b.dataset.index)<frameIndex);});
  document.querySelectorAll('.chapter-button').forEach(b=>b.classList.toggle('is-active',b.dataset.chapter===frames[frameIndex].chapter));
}
// Drawn controls replace native select / range. Each keeps its ARIA role and keys,
// and stops propagation so the page-level ←/→/Esc shortcuts do not fire twice.
function createPicker(host,{label,onChange}) {
  host.innerHTML=`<button type="button" class="picker-button" aria-haspopup="listbox" aria-expanded="false"><span class="picker-meta"></span><span class="picker-title"></span><span class="picker-caret" aria-hidden="true"></span></button><div class="picker-list" role="listbox" tabindex="-1" aria-label="${escape(label)}" hidden></div>`;
  const trigger=host.querySelector('button'), list=host.querySelector('[role="listbox"]');
  trigger.setAttribute('aria-label',label);
  let options=[], value=0, active=0;
  const optionId=v=>`${host.id}-option-${v}`;
  const draw=()=>{
    list.innerHTML=options.map((o,i)=>`<div role="option" id="${optionId(o.value)}" data-value="${o.value}" aria-selected="${o.value===value}" class="${i===active?'is-active':''}"><span class="option-meta">${escape(o.meta)}</span><span class="option-title">${escape(o.title)}</span></div>`).join('');
    if(options[active])list.setAttribute('aria-activedescendant',optionId(options[active].value));
  };
  const reveal=()=>list.querySelector('.is-active')?.scrollIntoView({block:'nearest'});
  const isOpen=()=>!list.hidden;
  function open() {
    active=Math.max(0,options.findIndex(o=>o.value===value));draw();
    list.hidden=false;trigger.setAttribute('aria-expanded','true');list.focus({preventScroll:true});reveal();
  }
  function close(focus=true) {
    if(!isOpen())return;
    list.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus({preventScroll:true});
  }
  function choose(i) {const o=options[i];close();if(o&&o.value!==value)onChange(o.value);}
  trigger.addEventListener('click',()=>isOpen()?close():open());
  trigger.addEventListener('keydown',e=>{
    if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();open();}
  });
  list.addEventListener('keydown',e=>{
    const step={ArrowDown:1,ArrowUp:-1,PageDown:8,PageUp:-8}[e.key];
    if(step!=null)active=Math.max(0,Math.min(options.length-1,active+step));
    else if(e.key==='Home')active=0;
    else if(e.key==='End')active=options.length-1;
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();choose(active);return;}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
    else if(e.key==='Tab'){close(false);return;}
    else {if(['ArrowLeft','ArrowRight'].includes(e.key))e.stopPropagation();return;}
    e.preventDefault();e.stopPropagation();draw();reveal();
  });
  list.addEventListener('click',e=>{const el=e.target.closest('[role="option"]');if(el)choose(options.findIndex(o=>String(o.value)===el.dataset.value));});
  list.addEventListener('pointermove',e=>{const el=e.target.closest('[role="option"]');if(!el)return;const i=options.findIndex(o=>String(o.value)===el.dataset.value);if(i!==active){active=i;list.querySelectorAll('.is-active').forEach(x=>x.classList.remove('is-active'));el.classList.add('is-active');list.setAttribute('aria-activedescendant',el.id);}});
  document.addEventListener('pointerdown',e=>{if(isOpen()&&!host.contains(e.target))close(false);});
  return {
    set(next,v) {
      options=next;value=v;const o=options.find(x=>x.value===v);
      host.querySelector('.picker-meta').textContent=o?.meta||'';host.querySelector('.picker-title').textContent=o?.title||'';
      trigger.title=o?`${o.meta} · ${o.title}`:'';
      if(isOpen()){active=Math.min(active,options.length-1);draw();}
    },
    close,
  };
}
const basePicker=createPicker($('base-picker'),{label:'对比基线时刻',onChange:v=>{pause();baseIndex=v;render({kind:'frame'});}});
const targetPicker=createPicker($('target-picker'),{label:'对比当前时刻',onChange:v=>goFrame(v)});
function setupSpeed() {
  const group=$('playback-speed'), radios=[...group.querySelectorAll('[role="radio"]')];
  const apply=(value,focus)=>{
    speed=value;
    radios.forEach(r=>{const on=Number(r.dataset.speed)===value;r.setAttribute('aria-checked',String(on));r.tabIndex=on?0:-1;if(on&&focus)r.focus();});
    if(timer){pause();play();}
  };
  group.addEventListener('click',e=>{const r=e.target.closest('[role="radio"]');if(r)apply(Number(r.dataset.speed),false);});
  group.addEventListener('keydown',e=>{
    const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[e.key];
    if(step==null)return;
    e.preventDefault();e.stopPropagation();
    const i=radios.findIndex(r=>Number(r.dataset.speed)===speed);
    apply(Number(radios[(i+step+radios.length)%radios.length].dataset.speed),true);
  });
}
function setupScrubber() {
  const slider=$('time-slider'), rail=slider.querySelector('.slider-rail'), hover=$('slider-hover');
  let dragging=false;
  const timeAt=x=>{
    const r=rail.getBoundingClientRect(), p=Math.max(0,Math.min(1,(x-r.left)/r.width));
    const t=Math.round((start+p*(end-start))/60000)*60000;
    const near=stamps.reduce((best,s)=>Math.abs(s-t)<Math.abs(best-t)?s:best,stamps[0]);
    return Math.abs(near-t)/(end-start)*r.width<=7?near:Math.max(start,Math.min(end,t));
  };
  const showHover=x=>{
    const t=timeAt(x), i=stamps.indexOf(t), r=rail.getBoundingClientRect();
    hover.textContent=i>=0?`${String(i+1).padStart(2,'0')} · ${shortDate(t)} ${shortTime(t)} · ${frames[i].title}`:`${shortDate(t)} ${shortTime(t)} · 无新整理`;
    hover.hidden=false;
    const half=hover.offsetWidth/2, left=Math.max(half,Math.min(r.width-half,(t-start)/(end-start)*r.width));
    hover.style.left=`${left}px`;
  };
  slider.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    e.preventDefault();dragging=true;slider.setPointerCapture(e.pointerId);slider.focus({preventScroll:true});
    pause();setCursor(timeAt(e.clientX));showHover(e.clientX);
  });
  slider.addEventListener('pointermove',e=>{
    if(dragging){const t=timeAt(e.clientX);if(t!==cursor)setCursor(t);}
    if(e.pointerType!=='touch'||dragging)showHover(e.clientX);
  });
  const stop=()=>{dragging=false;};
  slider.addEventListener('pointerup',stop);slider.addEventListener('pointercancel',stop);
  slider.addEventListener('pointerleave',()=>{if(!dragging)hover.hidden=true;});
  slider.addEventListener('lostpointercapture',()=>{dragging=false;hover.hidden=true;});
  slider.addEventListener('keydown',e=>{
    const day=86400000;
    const actions={
      ArrowLeft:()=>goFrame(cursor>stamps[frameIndex]?frameIndex:frameIndex-1), ArrowDown:()=>actions.ArrowLeft(),
      ArrowRight:()=>goFrame(frameIndex+1), ArrowUp:()=>actions.ArrowRight(),
      PageUp:()=>{pause();setCursor(cursor+day);}, PageDown:()=>{pause();setCursor(cursor-day);},
      Home:()=>goFrame(0), End:()=>{pause();setCursor(end);},
    };
    if(!actions[e.key])return;
    e.preventDefault();e.stopPropagation();actions[e.key]();
  });
}
function pause() {if(timer){clearInterval(timer);timer=null;}updatePlayButton();}
function play() {
  if(timer){pause();return;}
  if(frameIndex===frames.length-1)setCursor(start);
  // Each round gets its motion plus at least 2.2 s to read the settled board.
  const interval=(reduced()?0:FRAME_MS*(slowMotion?3:1))+Math.max(2200,2900/speed);
  timer=setInterval(()=>{if(frameIndex>=frames.length-1){pause();return;}setCursor(stamps[frameIndex+1]);if(frameIndex===frames.length-1)pause();},interval);updatePlayButton();
}
function updatePlayButton() {$('play-button').innerHTML=timer?'<span aria-hidden="true">Ⅱ</span><span>暂停</span>':'<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m6 3 11 7-11 7Z" fill="currentColor"/></svg><span>播放</span>';$('play-button').setAttribute('aria-label',timer?'暂停回放':'开始回放');}
function showInspector() {
  const inspector=document.querySelector('.inspector');
  inspector.scrollTop=0;
  $('inspector-title').focus({preventScroll:true});
  if(matchMedia('(max-width: 759px)').matches)inspector.scrollIntoView({block:'start',behavior:'instant'});
}
function select(type,id,origin) {pause();if(!(type==='item'&&selected.type==='item'&&selected.id===id))panel=null;selected={type,id,origin};detailMode='detail';render();showInspector();}
let toastTimer=null;
function toast(message,{undo=null}={}) {
  const el=$('toast');
  el.innerHTML=`<span>${escape(message)}</span>${undo?`<button data-undo="${escape(undo.key)}">撤销 <kbd>U</kbd></button>`:''}`;
  el.hidden=false;el.classList.remove('is-leaving');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.classList.add('is-leaving');toastTimer=setTimeout(()=>{el.hidden=true;el.classList.remove('is-leaving');},180);},undo?4200:2600);
}
function focusLayer() {$('breadcrumbs').querySelector('[aria-current="page"]')?.focus({preventScroll:true});}
function layerPath(id) {
  if(id===TAIL_ID)return [TAIL_ID];
  const path=[],seen=new Set();
  let item=id&&(getItem(currentState,id)||getItem(baseState,id));
  while(item&&!seen.has(item.id)){seen.add(item.id);path.unshift(item.id);item=item.parent_id&&(getItem(currentState,item.parent_id)||getItem(baseState,item.parent_id));}
  return path;
}
function changeLayer(id,origin,{focusItem=null}={}) {
  pause();if(id===layerId)return;
  const oldPath=layerPath(layerId), nextPath=layerPath(id);
  const rising=!id||oldPath.includes(id);
  const kind=rising?'rise':(!layerId||nextPath.includes(layerId))?'dive':'layout';
  const anchorId=rising?oldPath[nextPath.length]:nextPath[oldPath.length];
  // Remember where the anchor sits on each board before the layer changes: the dive opens from it.
  const anchorRect={current:flips.current?.rect(anchorId),base:flips.base?.rect(anchorId)};
  layerId=id;
  // Rising out of the tail keeps whatever small item was being read; diving into it starts from the overview.
  if(focusItem)selected={type:'item',id:focusItem};
  else if(anchorId===TAIL_ID){if(!rising||selected.type!=='item')selected={type:'state'};}
  else selected={type:'item',id:rising?anchorId:id,origin};
  if(selected.type==='item'&&!selected.id)selected={type:'state'};
  panel=null;detailMode='detail';render({kind,anchorId,anchorRect});
  if(focusItem)$('current-board').querySelector(`.pin-tile:not(.is-leaving) > .flip-body [data-item="${CSS.escape(focusItem)}"]`)?.focus({preventScroll:true});
  else focusLayer();
}
function dive(id,origin) {changeLayer(id,origin);}
function rise() {changeLayer(layerId===TAIL_ID?null:layerPath(layerId).at(-2)||null);}

// ---------- answers ----------

function answer(itemId,actionId,extra={}) {
  const item=getItem(currentState,itemId), ask=item&&askOf(currentState,frameIndex,itemId);
  if(!ask)return;
  const normalized=normalizeAsk(ask);
  const action=actionId==='snooze'?{id:'snooze',label:'稍后提醒',meaning:'snooze'}:normalized.actions.find(a=>a.id===actionId);
  if(!action)return;
  pause();panel=null;
  lastAnswer=answers.save(item,ask,action,cursor,extra);
  render();
  toast(`${answerWords(lastAnswer)} · 已保存，等 Agent 下一轮整理`,{undo:lastAnswer});
}
function undoAnswer(key) {
  const record=answers.store.list().find(r=>r.key===key);
  if(!record)return;
  answers.undo(record);
  if(lastAnswer?.key===key)lastAnswer=null;
  render();
  toast('已撤销，这个问题重新等你回应');
}
bindResponses($('inspector-body'),{
  ask:target=>askOf(currentState,frameIndex,target),
  respond:(target,action,extra)=>answer(target,action.id,extra),
  open:(kind,key)=>{panel=kind==='actions'?null:{kind,key};renderInspector();},
  undo:()=>{},
});

// ---------- hover card ----------

let hoverTimer=null;
function hideHoverCard() {clearTimeout(hoverTimer);$('hover-card').hidden=true;}
function showHoverCard(tile) {
  const id=tile.dataset.id, isBase=tile.closest('#base-board');
  const state=isBase?baseState:currentState, item=getItem(state,id);
  if(!item)return;
  const ask=askOf(state,isBase?baseIndex:frameIndex,id), normalized=ask&&normalizeAsk(ask), answer=ask&&!isBase&&answerOf(item,ask);
  const card=$('hover-card');
  card.innerHTML=`<span class="hc-kicker">${answer?`✓ ${escape(answerWords(answer.record))}`:ask?askLabel(normalized):kinds[item.kind]||item.kind} · ${item.share} 份</span><strong>${escape(item.title)}</strong><p>${escape(ask&&!answer?ask.prompt:item.summary)}</p><small>点击看依据与版本${item.sources?.length?` · ${item.sources.length} 条依据`:''}</small>`;
  card.hidden=false;
  const r=tile.getBoundingClientRect(), c=card.getBoundingClientRect();
  const left=r.right+10+c.width<innerWidth-8?r.right+10:Math.max(8,r.left-10-c.width);
  const top=Math.max(8,Math.min(innerHeight-c.height-8,r.top));
  card.style.transform=`translate(${Math.round(left)}px,${Math.round(top)}px)`;
}
document.addEventListener('pointerover',e=>{
  const tile=e.target.closest?.('.pinboard .pin-tile[data-id]:not(.is-blank):not(.is-tail):not(.is-leaving)');
  const source=e.target.closest?.('[data-related]');
  document.querySelectorAll('.pin-tile.is-linked').forEach(t=>t.classList.remove('is-linked'));
  if(source&&!tile)linkTiles(source.dataset.related.split(' ').filter(Boolean));
  if(!tile){hideHoverCard();return;}
  if(tile.dataset.clipped!=='1'&&!tile.classList.contains('is-small')&&!tile.classList.contains('is-narrow')&&!tile.classList.contains('is-tiny')){hideHoverCard();return;}
  if(!$('hover-card').hidden&&$('hover-card').dataset.for===tile.dataset.id)return;
  clearTimeout(hoverTimer);
  $('hover-card').dataset.for=tile.dataset.id;
  hoverTimer=setTimeout(()=>showHoverCard(tile),$('hover-card').hidden?320:60);
});
document.addEventListener('pointerleave',hideHoverCard);
// Hovering an input or a question points at the tile that carries it (or the tail block holding it).
function linkTiles(ids) {
  const board=$('current-board');
  for(const id of ids) {
    const tile=board.querySelector(`.pin-tile[data-id="${CSS.escape(id)}"]:not(.is-leaving)`)||(board.querySelector(`.pin-tile.is-tail [data-tail-item="${CSS.escape(id)}"]`)?.closest('.pin-tile'));
    tile?.classList.add('is-linked');
  }
}

// ---------- setup ----------

document.title=`Fold · ${scenario.title}`;if(scenario.id!=='shanghai-two-weeks')$('prototype-notice').textContent=notice;
$('story-title').textContent=scenario.title;
$('story-meta').innerHTML=`<strong>${escape(scenario.persona.name)}</strong><span>${shortDate(start)} – ${shortDate(end)}</span><span>${escape(scenario.persona.role)}</span>`;
$('story-drawer').innerHTML=`<div><span class="eyebrow">演示说明</span><h2>${escape(scenario.title)}</h2><p>${escape(scenario.subtitle||'')}</p><p>${escape(scenario.persona.context)}</p><p>${escape(notice)}</p></div><div><h3>这一页怎样读</h3><ul><li>中间每格是一件事，面积 = 份额；1 份且不等你回应的小事合成一格，点开再铺。</li><li>左栏是这一轮的输入：先列你自己在原处做了什么，其余按工作、生活、社区、订阅分组，只展开被采用的。</li><li>右栏是详情：摘要、依据原文、来源处的回应和这件事两周里的版本。</li><li>工作评审可以在格子里直接批准或要求修改；回应只留在本页，下一轮整理后显示“已收到”，可撤销。</li></ul></div>${(scenario.publicSources||[]).length?`<div><h3>公开资料来源</h3>${scenario.publicSources.map(s=>`<a href="${escape(s.url)}" target="_blank" rel="noreferrer">${escape(s.title)} ↗</a><p>${escape(s.usedFor||s.fact)}</p>`).join('')}</div>`:''}`;
$('timeline-markers').innerHTML=frames.map((f,i)=>`<span class="timeline-marker ${f.signal?.type==='review'?'is-review':''}" style="left:${100*(stamps[i]-start)/(end-start)}%" data-index="${i}"></span>`).join('');
const dayCount=Math.floor((end-start)/86400000);
const labelTimes=Array.from({length:dayCount+1},(_,i)=>start+i*86400000);
labelTimes[labelTimes.length-1]=end;
$('day-labels').innerHTML=labelTimes.map(t=>`<span style="left:${100*(t-start)/(end-start)}%">${new Intl.DateTimeFormat('zh-CN',{timeZone:scenario.timeZone||'Asia/Shanghai',month:'numeric',day:'numeric'}).format(t)}</span>`).join('');
// Chapters sit on the timeline itself, each spanning from its first frame to the next chapter.
const chapterStarts=scenario.chapters.map(c=>frames.findIndex(f=>f.chapter===c.id));
$('chapter-list').innerHTML=scenario.chapters.map((c,i)=>{const from=stamps[chapterStarts[i]]??start, to=i+1<chapterStarts.length?stamps[chapterStarts[i+1]]:end;return `<button class="chapter-button" title="${escape(c.title)}" data-chapter="${escape(c.id)}" data-frame="${chapterStarts[i]}" style="left:${100*(from-start)/(end-start)}%;width:${100*(to-from)/(end-start)}%"><span>${String(i+1).padStart(2,'0')}</span>${escape(c.title.split('·').at(-1).trim())}</button>`;}).join('');
$('play-button').onclick=play;$('previous-frame').onclick=()=>goFrame(frameIndex-1);$('next-frame').onclick=()=>goFrame(frameIndex+1);$('restart-button').onclick=()=>goFrame(0);
setupSpeed();setupScrubber();
$('compare-button').onclick=()=>{pause();comparing=!comparing;if(comparing)baseIndex=Math.max(0,frameIndex-1);render({kind:'layout'});};
$('close-compare').onclick=()=>{comparing=false;render({kind:'layout'});};
$('replay-motion').onclick=replayMotion;
$('slow-motion').onclick=()=>{slowMotion=!slowMotion;updateMotionControls();if(flips.current?.canReplay)replayMotion();};
$('note-toggle').onclick=()=>{const open=!$('frame-note').classList.contains('is-open');$('frame-note').classList.toggle('is-open',open);$('note-toggle').setAttribute('aria-expanded',String(open));$('note-toggle').textContent=open?'收起':'展开';};
$('full-state-button').onclick=()=>{pause();selected={type:'state'};detailMode='json';render();showInspector();};
$('close-detail').onclick=()=>select('state');
$('detail-tab').onclick=()=>{detailMode='detail';renderInspector();};$('json-tab').onclick=()=>{detailMode='json';renderInspector();};
$('story-button').onclick=()=>{const open=$('story-drawer').hidden;$('story-drawer').hidden=!open;$('story-button').setAttribute('aria-expanded',String(open));};
$('copy-json').onclick=async()=>{try{await navigator.clipboard.writeText(json(inspectedJSON));toast('JSON 已复制');}catch{toast('复制受浏览器限制，请用「下载 JSON」');detailMode='json';renderInspector();}};
document.addEventListener('click',e=>{
  if(!$('story-drawer').hidden&&!$('story-drawer').contains(e.target)&&!$('story-button').contains(e.target)){$('story-drawer').hidden=true;$('story-button').setAttribute('aria-expanded','false');}
  const target=e.target.closest('button');if(!target)return;
  if(target.dataset.answer){const [id,action]=target.dataset.answer.split(':');answer(id,action);return;}
  if(target.dataset.undo){undoAnswer(target.dataset.undo);return;}
  if(target.hasAttribute('data-panel-close')){panel=null;renderInspector();return;}
  if(target.dataset.groupToggle){const key=target.dataset.groupToggle;if(openGroups.has(key))openGroups.delete(key);else openGroups.add(key);renderEvents();document.querySelector(`[data-group-toggle="${CSS.escape(key)}"]`)?.focus({preventScroll:true});return;}
  if(target.dataset.tail){
    const item=e.target.closest('[data-tail-item]')?.dataset.tailItem;
    if(target.dataset.origin==='base'){if(item)select('item',item,'base');return;}
    changeLayer(TAIL_ID,undefined,{focusItem:item||null});return;
  }
  if(target.dataset.rise){rise();return;}
  if(target.dataset.dive){dive(target.dataset.dive,target.dataset.origin);return;}
  if(target.dataset.item){select('item',target.dataset.item,target.dataset.origin);return;}
  if(target.dataset.event){select('event',target.dataset.event);return;}
  if(target.hasAttribute('data-layer')){changeLayer(target.dataset.layer||null);return;}
  if(target.hasAttribute('data-frame')){
    const coldControl=target.classList.contains('cold-start-button')||target.closest('.cold-start-progress');
    goFrame(Number(target.dataset.frame));
    if(coldControl){$('frame-title').tabIndex=-1;$('frame-title').focus({preventScroll:true});}
    return;
  }
  if(target.id==='diff-json-button'){selected={type:'diff'};detailMode='json';renderInspector();return;}
  if(target.id==='download-json'){const blob=new Blob([json(inspectedJSON)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`fold-${selected.type}-${frameIndex+1}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!$('story-drawer').hidden){$('story-drawer').hidden=true;$('story-button').setAttribute('aria-expanded','false');$('story-button').focus();return;}
  if(e.target.matches('input,textarea,select,[contenteditable]')||e.altKey||e.metaKey||e.ctrlKey)return;
  if(e.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
    e.preventDefault();e.stopPropagation();
    const next=e.key==='Home'?'detail':e.key==='End'?'json':detailMode==='detail'?'json':'detail';
    detailMode=next;renderInspector();$(`${next}-tab`).focus();return;
  }
  const key=e.key.toLowerCase();
  if((key==='a'||key==='r')&&selected.type==='item'&&selected.origin!=='base') {
    const item=getItem(currentState,selected.id), ask=item&&askOf(currentState,frameIndex,item.id);
    if(ask&&normalizeAsk(ask).expects==='approve'&&!answerOf(item,ask)){e.preventDefault();answer(item.id,key==='a'?'approve':'request-changes');return;}
  }
  if(key==='u'&&lastAnswer){e.preventDefault();undoAnswer(lastAnswer.key);return;}
  if(e.key===' '&&!e.target.matches('button,a,summary')){e.preventDefault();play();}
  if(e.key==='ArrowLeft'){e.preventDefault();goFrame(frameIndex-1);}
  if(e.key==='ArrowRight'){e.preventDefault();goFrame(frameIndex+1);}
  if(e.key==='Escape'){
    pause();hideHoverCard();
    if(panel){panel=null;renderInspector();return;}
    if(layerId){rise();}else{selected={type:'state'};detailMode='detail';render();focusLayer();}
  }
});
let resizeFrame;
const boardResizeObserver=new ResizeObserver(()=>{
  cancelAnimationFrame(resizeFrame);
  resizeFrame=requestAnimationFrame(()=>{
    if(currentBoardSizes()===boardSizes)return;
    renderBoards(null);updateMotionControls();
  });
});
boardResizeObserver.observe($('boards-wrap'));
boardResizeObserver.observe($('workspace'));
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();for(const flip of Object.values(flips))flip.settle();}});
document.addEventListener('scroll',hideHoverCard,{capture:true,passive:true});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{
  panelAnimations.forEach(animation=>animation.cancel());panelAnimations=[];
  for(const flip of Object.values(flips))flip.settle();
  updateMotionControls();
});
render();
// Read-only hooks for browser verification, not part of the Fold product API.
window.foldPrototype={scenario,records,get state(){return currentState;},get cursor(){return cursor;},goFrame,setCursor,getDiff:()=>currentDiff,
  motion:()=>flips.current?.inspect(),answers:()=>answers.list(),select:(id)=>select('item',id),openTail:()=>changeLayer(TAIL_ID)};
