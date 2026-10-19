import { scenario, notice } from './scenario.mjs?v=feedback-loop-1';
import { projectState, getItem, diffStates } from './engine.mjs?v=feedback-loop-1';
import { layoutFill } from './variants/a-layout.mjs';
import { records, currentAsk, feedbackTrail, personName } from './variants/shared.mjs?v=feedback-loop-1';
import { normalizeAsk, responseHTML, composerHTML, deferHTML, scheduleHTML, keypadHTML, bindResponses } from './respond.mjs?v=respond-1';
import { TAIL_ID, streamNames, markdownHTML, plainText, eventRef, actionText, authorOf, feedbackLine, foldLayer, openAsks, dueText,
  itemVersions, createAnswerBook, answerWords, approveSubject } from './variants/spatial-kit.mjs';
import { followFrames } from './embed.mjs';
import { currentDataset } from './data/select.mjs';
import { createIx, IX } from './forms/motion/ix.mjs';
import { itemFacts, rounds } from './forms/motion/dial-model.mjs';
import { createBeat, createBoard, roll, flipText, planGrains, drawGrains } from './motion.mjs';

// The original time machine: a treemap of the current layer, the round's inputs on the left and a
// detail reader on the right. Authored or replayed Agent decisions only; nothing here writes Fold state.
// Answers given on this page stay in a page-local answer book (saved → acknowledged after the next round).
// 动画与交互按第三轮的标准（forms/polish/tree-motion.md）：只在换轮与作答两种节拍上动（motion.mjs 管“一组怎么动”，
// 这里编排谁在哪一组）；悬停概要、点击沿格子弹出、引线与详情卡共用 forms/motion/ix.mjs，详情卡就是右栏。
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const frames = scenario.frames;
const stamps = frames.map(f => Date.parse(f.at));
const start = stamps[0], end = Math.max(stamps.at(-1), Date.parse(scenario.endAt));
const query = new URLSearchParams(location.search);
let frameIndex = Math.min(frames.length - 1, Math.max(0, Math.floor(Number(query.get('frame'))) || 0));
let cursor = query.has('at') && Number.isFinite(Number(query.get('at'))) ? Math.max(start,Math.min(end,Number(query.get('at')))) : stamps[frameIndex];
frameIndex=stamps.reduce((last,t,i)=>t<=cursor?i:last,0);
// ?item= names the item to read: on the board it opens as the detail card after the first render, else in the reader.
let selected = query.get('item') ? {type:'item',id:query.get('item')} : {type:'state'};
let layerId = query.get('layer') || null;
let comparing = query.has('base');
let baseIndex = Math.min(frameIndex, Math.max(0, Math.floor(Number(query.get('base'))) || 0));
let detailMode = 'detail';
let inspectedJSON;
let currentState, baseState, currentDiff;
let slowMotion=false;
let boardSizes='';
let speed=1;
let panel=null;                     // an open response panel in the reader or the card: { kind, key }
let lastAnswer=null;                // the most recent answer, for U
const openGroups=new Set(['self']); // input groups the reader unfolded; kept across frames
const answers=createAnswerBook(frames);
// Motion (motion.mjs): the beat in flight, a pin for stills (foldTree.beatAt), the last turn (重播), the grains of the
// concept layer, the count the headline shows, and which items each board folded into its tail block.
let beat=null, pinnedBeat=null, lastTurn=null, grains=null, heroShown=null;
const tails={current:new Set(),base:new Set()};
// Interaction (motion/ix.mjs, set up below): the item whose detail card is open, and what the card shows.
let ix=null, cardEl=null, cardMode='detail';
// Play: rounds advance only while nothing holds them (hovering, an open card); a held round keeps its place.
const player={on:false,held:false,acc:0,at:0,timer:null};
const TURN_S=1.0;                   // the turn's own motion (tree-motion.md 3.2), before the round is read
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
// A new round is a turn (tree-motion.md 3.2); dragging the time slider passes quick, so a drag does not queue up turns.
function setCursor(time,{quick=false}={}) {
  const previousIndex=frameIndex, previousCursor=cursor;
  cursor=Math.max(start,Math.min(end,time));
  frameIndex=stamps.reduce((last,t,i)=>t<=cursor?i:last,0);
  if(baseIndex>frameIndex)baseIndex=frameIndex;
  const turned=previousIndex!==frameIndex;
  if(turned){panel=null;ix?.reset();lastTurn={from:previousIndex,to:frameIndex};}
  render(turned?{kind:quick?'quick':'turn',from:previousIndex}:null);
  if(turned) {
    $('event-list').closest('.inputs-panel').scrollTop=0;
    // Answers given before this round are now with the Agent: the receipts fill in on the board; say so to a screen reader.
    const received=answers.list(previousCursor).filter(record=>answers.status(record,previousCursor).status==='saved'&&answers.status(record,cursor).status==='acknowledged');
    if(received.length)announce(`Agent 已在 ${shortTime(stamps[frameIndex])} 的整理中收到你的 ${received.length} 条回应`);
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
function updateMotionControls() {
  const off=reduced();
  $('replay-motion').disabled=!lastTurn||off;
  $('replay-motion').title=off?'系统已开启减少动态效果':'重播刚才这一轮的整理';
  $('slow-motion').disabled=off;
  $('slow-motion').title=off?'系统已开启减少动态效果':'放慢过渡，便于看清去向';
  $('slow-motion').setAttribute('aria-pressed',String(slowMotion));
  $('slow-motion').classList.toggle('is-active',slowMotion);
}
// 重播: the board goes back to the round before without motion, then the turn plays again (panels stay as they are).
function replayMotion() {
  pause();ix?.reset();
  if(!lastTurn||reduced())return;
  beat?.finish();beat=null;
  const keep={frameIndex,cursor};
  frameIndex=lastTurn.from;cursor=stamps[lastTurn.from];
  currentState=projectState(records[frameIndex].snapshot,nowISO());
  renderBoards(null);renderHero(null);
  frameIndex=keep.frameIndex;cursor=keep.cursor;
  render({kind:'turn',from:lastTurn.from});
}
function syncURL() {
  const p=new URLSearchParams();p.set('frame',String(frameIndex));
  if(cursor!==stamps[frameIndex])p.set('at',String(cursor));
  if(layerId)p.set('layer',layerId);
  const item=ix?.s.open||(selected.type==='item'?selected.id:null);
  if(item)p.set('item',item);
  if(comparing)p.set('base',String(baseIndex));
  for(const [key,value] of new URLSearchParams(location.search))if(key==='data')p.set('data',value);
  history.replaceState(null,'',`${location.pathname}?${p}`);
  reportFrame(frameIndex);
  document.querySelectorAll('[data-prototype-variant]').forEach(link=>{
    const target=new URLSearchParams(p);target.set('variant',link.dataset.prototypeVariant);
    link.href=`./?${target}`;
  });
}
// Which beat a transition plays (motion.mjs BEATS): a new round is a turn; dragging, comparing and resizing are quick;
// diving and rising zoom through the anchor tile; answering and undoing are their own short beats.
const beatOf=transition=>!transition?null:transition.kind==='dive'||transition.kind==='rise'?'zoom'
  :['turn','answer','undo','quick'].includes(transition.kind)?transition.kind:'quick';
function render(transition=null) {
  const oldState=currentState, oldBase=baseState;
  // A beat still in flight jumps to its end first; the next one starts from there.
  beat?.finish();beat=null;grains=null;
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
  const f=frames[frameIndex];
  if(selected.type==='batch'&&!f.batch)selected={type:'state'};
  if(selected.type==='event'&&Date.parse(findEvent(selected.id)?.at)>cursor)selected={type:'state'};
  const kind=reduced()?null:beatOf(transition);
  if(kind){beat=createBeat(kind,{scale:slowMotion?3:1,pinned:pinnedBeat});if(player.held&&kind!=='answer'&&kind!=='undo')beat.hold();}
  // The cut: words change at once (tree-motion.md 3.2); numbers wait for their beat.
  $('frame-date').textContent=`${shortDate(cursor)} · ${shortTime(cursor)}`;
  if(!ix?.s.open)$('frame-title').textContent=f.title;
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
  renderHero(beat);
  flipText(beat,$('budget-label'),layerId===TAIL_ID?`<span>每格 1 份 · 放大显示</span>`:`已用 <strong>${layer.used}</strong> / ${layer.budget}<span> · 留白 ${layer.budget-layer.used}</span>`,beat?beat.spec.settle:0);
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
  renderEvents();renderBoards(beat,links,transition);
  // An item on the board is read in its detail card, grown out of its tile; the reader keeps the overview beneath.
  if(selected.type==='item'&&selected.origin!=='base'&&ix&&onBoard(selected.id)){const id=selected.id;selected={type:'state'};detailMode='detail';afterBeat(()=>openCard(id));}
  renderInspector();renderTimeline();renderDiffSummary();syncURL();
  if(JSON.stringify(selected)===previousSelection&&selected.type!=='state')document.querySelector('.inspector').scrollTop=inspectorScroll;
  if(beat&&kind==='turn'&&!layerId&&!comparing)grains=grainsFor(beat);
  refreshCard();
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
  const streams=[...new Set(others.map(e=>e.stream||'all'))].sort((a,b)=>['work','family','life','community','subscription','all'].indexOf(a)-['work','family','life','community','subscription','all'].indexOf(b));
  for(const stream of streams) {
    const list=others.filter(e=>(e.stream||'all')===stream), used=list.filter(e=>e.disposition==='used'), rest=list.filter(e=>e.disposition!=='used');
    const restOpen=openGroups.has(`rest:${stream}`), open=!openGroups.has(`closed:${stream}`);
    const counts=Object.entries(rest.reduce((acc,e)=>{acc[e.disposition]=(acc[e.disposition]||0)+1;return acc;},{})).map(([k,n])=>`${verdicts[k]||k} ${n}`).join(' · ');
    const rows=used.map(e=>eventRow(e,frameIndex)).join('')+(rest.length?(restOpen?`<div class="group-rest">${rest.map(e=>eventRow(e,frameIndex)).join('')}</div><button class="group-more" data-group-toggle="rest:${stream}" aria-expanded="true">收起其余 ${rest.length} 条</button>`:`<button class="group-more" data-group-toggle="rest:${stream}" aria-expanded="false">其余 ${rest.length} 条 · ${counts} ▸</button>`):'');
    html.push(groupHTML(`closed:${stream}`,streamNames[stream]||'输入',`采用 ${used.length} / ${list.length}`,rows||'<p class="group-empty">本轮没有输入。</p>',{open}));
  }
  $('event-list').innerHTML=html.join('');
}

// ---------- the headline: how many items on this board wait for you ----------

/** Items of the visible layer with an open question you have not answered on this page (tree-motion.md 2.1). */
function waitingNow(layer=visibleLayer(currentState)) {
  return layer.items.filter(item=>{const ask=askOf(currentState,frameIndex,item.id);return ask&&receiptOf(item,ask)?.mode!=='answer';}).length;
}
/** The hero number turns over on its beat (motion.mjs roll); the words beside it change at the cut. */
function renderHero(ctx) {
  const layer=visibleLayer(currentState), n=waitingNow(layer);
  const answered=layer.items.filter(item=>{const ask=askOf(currentState,frameIndex,item.id);return ask&&receiptOf(item,ask)?.mode==='answer';}).length;
  const el=$('layer-title');
  if(!el.querySelector('.hero-n'))el.innerHTML='<span class="hero"><b class="hero-n"></b><span class="hero-unit">件等你回应</span></span><span class="layer-meta"></span>';
  const meta=layerId===TAIL_ID?`放大：这 ${layer.items.length} 件在全部事项里合计 ${layer.used} 份`:layerId?`子层 · 独立 64 份预算 · ${layer.items.length} 件`
    :`共 ${layer.items.length} 件${answered?` · ${answered} 件你已回应`:''}`;
  const num=el.querySelector('.hero-n');
  if(ctx&&heroShown!=null&&heroShown!==n)roll(ctx,num,heroShown,n,ctx.spec.hero);else num.textContent=String(n);
  heroShown=n;
  el.querySelector('.layer-meta').textContent=meta;
  el.setAttribute('aria-label',`${n} 件等你回应，${meta}`);
}

// ---------- board ----------

const boards={};
function renderBoards(ctx=null,links=[],transition=null) {
  const workspace=$('workspace');
  if(innerWidth>=1000) {
    const offset=$('current-board').getBoundingClientRect().top-workspace.getBoundingClientRect().top+workspace.scrollTop;
    const height=Math.max(comparing?200:260,Math.min(620,Math.floor(workspace.clientHeight-offset-44)));
    $('current-board').style.height=`${height}px`;$('base-board').style.height=`${height}px`;
  } else {$('current-board').style.height='';$('base-board').style.height='';}
  const zoom=transition&&(transition.kind==='dive'||transition.kind==='rise')?transition:null;
  drawBoard('current',$('current-board'),currentState,false,{ctx,links,zoom,from:transition?.from});
  if(comparing)drawBoard('base',$('base-board'),baseState,true,{ctx,links,zoom});
  else if(boards.base){boards.base.clear();tails.base=new Set();}
  boardSizes=currentBoardSizes();
}
/** Size classes go on the tile's body (not the tile), so an old body kept for its leaving words keeps its old layout. */
function tileClasses(rect,extra='') {
  const tiny=rect.height<58, narrow=!tiny&&rect.width<104, small=!tiny&&!narrow&&(rect.width<150||rect.height<128);
  return `${small?'is-small':''} ${narrow?'is-narrow':''} ${tiny?'is-tiny':''} ${extra}`;
}
/**
 * Your answer to this item, wherever it now stands (tree-motion.md 2.1): the latest one given on this page up to the cursor,
 * compared with the question it now asks. answer = this very question (re-registered or not); prior = it now asks another;
 * closed = it asks nothing. The receipt follows the item across versions instead of vanishing when the Agent rewrites it.
 */
function receiptOf(item,ask) {
  const record=item&&answers.find(item.id,cursor);
  if(!record)return null;
  return {record,...answers.status(record,cursor),mode:ask?(!record.ask||record.ask===ask.id?'answer':'prior'):'closed'};
}
const answeredHere=(item,ask)=>{const rc=receiptOf(item,ask);return rc?.mode==='answer'?rc:null;};
function receiptText(answer) {return answer.status==='acknowledged'?`已收到 · Agent ${shortTime(answer.at)} 读到`:'已保存 · 等下一轮整理';}
// The short form on a tile: “你批准了上一版 · 已收到”.
const receiptShort=rc=>`${answerWords(rc.record)}${rc.mode==='prior'?'上一版':''} · ${rc.status==='acknowledged'?'已收到':'已保存'}`;
const TICK='<i class="rc-tick" aria-hidden="true"><b></b></i>';
function itemTile(rect,item,state,isBase,index,changes) {
  const ask=askOf(state,index,item.id), normalized=ask&&normalizeAsk(ask);
  const rc=isBase?null:receiptOf(item,ask), answered=rc?.mode==='answer';
  const changed=(comparing||frameIndex>0)&&changes.get(item.id), n=item.children?.items?.length||0;
  const kind=kinds[item.kind]||escape(item.kind);
  const approve=normalized?.expects==='approve';
  const inline=approve&&!isBase&&rect.width>=190&&rect.height>=112;
  const subject=approve?approveSubject(ask,index):null;
  const shareDelta=changed&&changed.before?.share!=null&&changed.after?.share!=null?`份额 ${changed.before.share}→${changed.after.share}`:changed?changeNames[changed.type]||'变化':'';
  const label=answered?`<span class="tile-answered">✓ ${escape(answerWords(rc.record).replace(/^你/,''))}</span>`:ask?`<span class="tile-ask">${askLabel(normalized)}</span>${item.kind!=='needs-you'?`<span class="tile-kind-after">· ${kind}</span>`:''}`:`<span class="tile-kind">${kind}</span>`;
  const aria=`${item.title}，份额 ${item.share}，${kind}${ask&&!answered?`，${askLabel(normalized)}：${ask.prompt}`:''}${rc?`，${answerWords(rc.record)}${rc.mode==='prior'?'（答的是上一版）':''}，${receiptText(rc)}`:''}${changed?`，${shareDelta}`:''}${n?`，${n} 个子项`:''}`;
  const received=rc?.status==='acknowledged'?' is-received':'';
  // The receipt stays where the answer was given: inline under the title (or in place of the buttons, below).
  const line=rc&&!(answered&&inline)?`<p class="tile-rc${received}" data-part="receipt">${TICK}<span>${answered?receiptText(rc):escape(receiptShort(rc))}</span></p>`:'';
  const actions=inline?(answered?`<div class="tile-actions is-answered${received}" data-part="receipt"><span class="tile-receipt"><b>${TICK}${escape(answerWords(rc.record))}</b><span>${receiptText(rc)}</span></span><button class="tile-undo" data-undo="${escape(rc.record.key)}">撤销</button></div>`
    :`<div class="tile-actions" data-part="actions" role="group" aria-label="${escape(ask.prompt)}"><button class="tile-approve is-primary" data-answer="${escape(item.id)}:approve">批准</button><button class="tile-approve" data-answer="${escape(item.id)}:request-changes">要求修改</button></div>`):'';
  // On the current board the words are not a control: the keyboard reaches the tile through ix's hidden buttons.
  const head=isBase?`<button class="tile-button" data-item="${escape(item.id)}" data-origin="base" aria-label="${escape(aria)}">`:`<div class="tile-button" data-item="${escape(item.id)}" aria-hidden="true">`;
  const html=`${head}<span class="tile-top"><span class="tile-label" data-part="label">${label}</span><span class="tile-share" data-part="share">${item.share}<small> 份</small></span></span><h3 data-part="title">${escape(item.title)}</h3>${subject&&inline?`<p class="tile-subject" data-part="subject"><b>#${escape(subject.number)}</b> ${escape(subject.title)}</p>`:''}${ask&&!answered?`<p class="tile-prompt" data-part="prompt">${escape(ask.prompt)}</p>`:''}${line}<p class="tile-summary" data-part="summary">${escape(item.summary)}</p>${shareDelta||n?`<span class="tile-footer" data-part="footer">${shareDelta?`<span class="change-label">${shareDelta}</span>`:'<span></span>'}</span>`:''}${isBase?'</button>':'</div>'}${actions}${n?`<button class="dive-button" data-dive="${escape(item.id)}" ${isBase?'data-origin="base"':''} aria-label="进入${escape(item.title)}子层，${n} 个子项" title="进入子层">${n} 子项 <span aria-hidden="true">↗</span></button>`:''}`;
  const open=isBase?selected.type==='item'&&selected.id===item.id:ix?.s.open===item.id;
  return {id:item.id,...rect,html,key:`${html.length}:${html}`,aria,
    className:`${ask?'has-ask':''} ${answered?'is-answered':''} ${changed?'is-changed':''} ${n?'has-children':''} ${open?'is-selected':''}`,
    bodyClass:tileClasses(rect,`${inline?'has-actions':''} ${n?'has-children':''}`),
    attrs:{'data-color':colorFor(item,state),'data-share':item.share}};
}
function tailTile(rect,fold,state,changes,isBase) {
  const fresh=new Set(fold.tail.filter(item=>changes.get(item.id)?.type==='added').map(item=>item.id));
  const ordered=tailOrder(fold.tail,isBase?baseIndex:frameIndex);
  const selectedHere=selected.type==='item'&&fold.tail.some(item=>item.id===selected.id);
  const html=`<button class="tile-button tail-button" data-tail="open" ${isBase?'data-origin="base"':''} aria-label="另有 ${fold.tail.length} 件小事，各 1 份，合计 ${fold.tailShare} 份；铺开查看"><span class="tile-top"><span class="tile-kind" data-part="label">另有 <b>${fold.tail.length}</b> 件小事</span><span class="tile-share" data-part="share">${fold.tailShare}<small> 份</small></span></span><span class="tail-note" data-part="note">各占 1 份${fresh.size?` · <i>${fresh.size} 件本轮新增</i>`:''}</span><ul class="tail-list" data-part="list">${ordered.map(item=>`<li data-tail-item="${escape(item.id)}" data-color="${colorFor(item,state)}" class="${fresh.has(item.id)?'is-new':''}${selected.type==='item'&&selected.id===item.id?' is-selected':''}">${escape(item.title)}</li>`).join('')}</ul><span class="tail-more"></span><span class="tail-open">铺开 <span aria-hidden="true">↗</span></span></button>`;
  return {id:TAIL_ID,...rect,html,key:html,className:`is-tail ${selectedHere?'has-selected':''} ${fresh.size?'is-changed':''}`,bodyClass:tileClasses(rect),attrs:{'data-share':fold.tailShare}};
}
function blankTile(rect,state,isBase) {
  const initial=state.event_seq===0&&!layerId;
  const html=`<div class="blank-body">${initial?`<span class="empty-board-label">暂无事项</span><strong>64 <small>份未分配</small></strong><p>收到输入并完成整理后，相关事项显示在这里。</p>${!isBase&&!comparing?'<button class="cold-start-button" data-frame="1">查看首批输入 <span aria-hidden="true">→</span></button>':''}`:`<span class="blank-label" data-part="label">未分配</span><strong data-part="blank">${rect.share}</strong><small>份留白</small>`}</div>`;
  return {id:'__blank__',...rect,html,key:html,className:`is-blank ${initial?'is-initial':''}`,bodyClass:(rect.width<120||rect.height<75)?'is-small':'',attrs:{'data-share':rect.share}};
}
/** Ids of the items on this board whose question was registered after the round the turn came from (outlined once). */
function newAsks(state,index,from) {
  if(from==null||from>=index)return new Set();
  const before=new Set();
  const walk=(s,layer)=>{for(const item of layer?.items||[]){const ask=currentAsk(s,item.id);if(ask)before.add(ask.id);walk(s,item.children);}};
  walk({index:from,state:records[from].state},records[from].state.root);
  return new Set(visibleLayer(state,index).items.filter(item=>{const ask=askOf(state,index,item.id);return ask&&!before.has(ask.id);}).map(item=>item.id));
}
function drawBoard(name,el,state,isBase,{ctx,links,zoom,from}) {
  const w=el.clientWidth,h=el.clientHeight;
  if(!w||!h)return;
  boards[name]??=createBoard(el,{tileClass:'pin-tile',idKey:isBase?'baseId':'id',onRender:fitTile});
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
  // Items that come out of the tail block start from it; items folded into it fly into it.
  const tailNow=new Set(fold.tail.map(item=>item.id)), fromTail=new Set(entries.map(e=>e.id).filter(id=>tails[name].has(id)));
  const front=new Set(entries.filter(e=>/\bis-answered\b/.test(e.className)).map(e=>e.id));
  const rings=ctx?.spec.ring&&!isBase?newAsks(state,index,from):new Set();
  boards[name].update(entries,{ctx,links,zoom:zoomRects,fromTail,toTail:tailNow,tailId:TAIL_ID,front,rings});
  tails[name]=tailNow;
  if(!isBase) {
    const items=entries.filter(e=>e.id!==TAIL_ID&&e.id!=='__blank__');
    boardIds=new Set(items.map(e=>e.id));proxies=items.map(e=>({id:e.id,label:e.aria}));
    proxyKey=`${frameIndex}:${layerId||''}:${proxies.map(p=>p.id).join(',')}`;
  }
}
// Never leave half-cut lines: drop the summary first, then the prompt, then clamp the subject and title.
function fitTile(tile,entry,body) {
  if(entry.id==='__blank__'){if(entry.width<44||entry.height<28)body.dataset.fit='sliver';else body.removeAttribute('data-fit');return;}
  const box=body.querySelector('.tile-button');
  // Fit results live in the body's data-fit, written again with the body.
  const fit=new Set();tile.removeAttribute('data-clipped');
  const done=()=>{if(fit.size)body.dataset.fit=[...fit].join(' ');else body.removeAttribute('data-fit');};
  if(entry.width<34||entry.height<22){fit.add('sliver');done();return;}
  if(entry.id===TAIL_ID){done();fitTail(box);return;}
  const label=box.querySelector('.tile-label');
  if(label&&label.scrollWidth>label.clientWidth+1)fit.add('compact-label');
  if(fit.size)done();
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
// What this version asks and how to answer it here. Saved is not acknowledged; neither is the outside action done.
// An answer given to an earlier version (or to a question since closed) stays above, so it never silently disappears.
function askSection(item,state,index,base=false) {
  const ask=askOf(state,index,item.id);
  const rc=base?null:receiptOf(item,ask);
  const prior=rc&&rc.mode!=='answer'?`<div class="og-receipt is-compact${rc.status==='acknowledged'?' is-received':''}"><span class="og-check" aria-hidden="true">✓</span><span><b>${escape(answerWords(rc.record))}${rc.mode==='prior'?'（上一版）':''}</b><small>${rc.status==='acknowledged'?`Agent 已在 ${shortDate(rc.at)} ${shortTime(rc.at)} 的整理中收到。${rc.mode==='prior'?'这件事随后改写，问的是下面这个新问题。':'这个问题之后关上了。'}`:`${shortTime(rc.record.at)} 已保存，等 Agent 下一轮整理。`}</small></span><button class="text-button" data-undo="${escape(rc.record.key)}">撤销</button></div>`:'';
  if(!ask)return prior?section('你的回应',prior):item.kind==='needs-you'?section('回应',`<p class="ask-missing">这一版没有登记回应路径：Agent 改写了内容但未重新登记，回应无法从这里回传。</p>`):'';
  const normalized=normalizeAsk(ask), answer=rc?.mode==='answer'?rc:null, registered=frames[ask.frameIndex];
  const subject=normalized.expects==='approve'?approveSubject(ask,index):null;
  const due=dueText({due:ask.due_at?Date.parse(ask.due_at):null},cursor);
  let body=`${prior}<p class="ask-prompt">${escape(ask.prompt)}</p>`;
  if(subject)body+=`<p class="ask-subject">批准后由 Agent 去 GitHub ${subject.verb} <b>#${escape(subject.number)}</b>${subject.title?` · ${escape(subject.title)}`:''}</p>`;
  if(due)body+=`<p class="ask-due${ask.due_at&&Date.parse(ask.due_at)<cursor?' is-late':''}">${escape(due)}</p>`;
  if(base)body+='<p class="ask-meta">基线时刻的版本，只读。</p>';
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
  let content=`<div class="stat-pair"><div><span>当前关注</span><strong>${currentState.root.items.length}<small> 项</small></strong></div><div><span>等你回应</span><strong>${asks.filter(entry=>!answeredHere(entry.item,entry.ask)).length}<small> 个</small></strong></div><div><span>根层留白</span><strong>${currentState.root.budget-currentState.root.used}<small> / ${currentState.root.budget}</small></strong></div></div>`;
  if(reviews.length)content+=section(`工作评审 · ${reviews.length}`,`<div class="review-list">${reviews.map(({item,ask})=>{
    const answer=answeredHere(item,ask), subject=approveSubject(ask,frameIndex);
    return `<article class="review-row ${answer?'is-answered':''}" data-related="${escape(item.id)}"><button class="review-open" data-item="${escape(item.id)}"><span class="review-pr"><b>#${escape(subject?.number||'')}</b> ${escape(subject?.title||item.title)}</span><span class="review-prompt">${escape(ask.prompt)}</span></button>${answer?`<div class="og-receipt is-compact ${answer.status==='acknowledged'?'is-received':''}"><span class="og-check" aria-hidden="true">✓</span><span><b>${escape(answerWords(answer.record))}</b><small>${receiptText(answer)}</small></span><button class="text-button" data-undo="${escape(answer.record.key)}">撤销</button></div>`:`<div class="review-actions"><button class="og-btn is-primary" data-answer="${escape(item.id)}:approve">批准</button><button class="og-btn is-line" data-answer="${escape(item.id)}:request-changes">要求修改</button></div>`}</article>`;
  }).join('')}</div>`);
  if(others.length)content+=section(`其他问题 · ${others.length}`,`<div class="ask-list">${others.map(entry=>{const answer=answeredHere(entry.item,entry.ask);const due=dueText(entry,cursor);return `<button class="ask-row" data-item="${escape(entry.item.id)}" data-related="${escape(entry.item.id)}"><span class="ask-expects">${answer?'✓ 已回应':askLabel(entry.ask)}</span><strong>${escape(entry.ask.prompt)}</strong><small>${escape(entry.item.title)} · ${entry.item.share} 份${due?` · <em class="${entry.overdue?'is-late':''}">${escape(due)}</em>`:''}</small></button>`;}).join('')}</div>`);
  const own=frames[frameIndex].events.filter(e=>e.self);
  if(own.length)content+=section(`这一轮你在原处做了 · ${own.length}`,`<div class="own-list">${own.slice(0,5).map(e=>`<button class="own-row" data-event="${escape(e.id)}"><b>${escape(actionText(e).sentence)}</b><span>${escape(actionText(e).title||'')}</span></button>`).join('')}${own.length>5?`<p class="own-more">另 ${own.length-5} 件在左侧「你」一栏</p>`:''}</div>`);
  const pending=(currentState.annotations||[]).filter(a=>a.status!=='acknowledged');
  if(pending.length)content+=section(`待确认的用户反馈 · ${pending.length}`,pending.map(a=>`<div class="annotation-item"><p>${escape(a.text)}</p>${button(a.item||a.item_id,'查看关联事项 ↗','class="text-button"')}</div>`).join(''));
  if(currentState.root.items.length)content+=section('全部顶层事项',`<details><summary>${currentState.root.items.length} 项，按份额</summary>${currentState.root.items.map(i=>`<div class="child-row">${button(i.id,`<span>${escape(i.title)}</span><small>${kinds[i.kind]} · ${i.share} 份</small>`)}</div>`).join('')}</details>`);
  const historical=currentState.historical||[];
  if(historical.length)content+=section(`历史事项 · ${historical.length}`,`<details><summary>已撤下与已合并事项</summary>${historical.map(i=>`<div class="child-row">${button(i.id,`<span>${escape(i.title)}</span><small>${statuses[i.status]}</small>`)}</div>`).join('')}</details>`);
  content+='<p class="detail-note">概览只辅助定位；切到「原始 JSON」核对此刻完整 state。</p>';
  const done=asks.filter(entry=>answeredHere(entry.item,entry.ask)).length;
  return {title:`${currentState.root.items.length} 项关注，${asks.length-done} 个问题等你${done?`，${done} 个已回应`:''}`,content};
}
/** The detail of one item: what the reader shows for an item off the board, and what its card shows on it. */
function itemDetail(item,state,index,{base=false}={}) {
  let content;
  const anns=annotationsFor(item,state),children=item.children?.items||[];
  content=`<div class="detail-status"><span class="kind-badge">${kinds[item.kind]||escape(item.kind)}</span><span>${statuses[item.status]||item.status}</span><span class="mono">${item.share} / 64 份 · ${weights[item.weight]||item.weight}</span>${base?'<span>基线内容</span>':''}</div><p class="detail-summary">${escape(item.summary)}</p>`;
  content+=askSection(item,state,index,base);
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
  return {title:item.title,eyebrow:`${categoryLabel(item,state)} · ${item.id}`,content,obj:item};
}
function renderInspector() {
  let title,eyebrow,content,obj;
  if(selected.type==='item') {
    const base=selected.origin==='base', state=base?baseState:currentState, index=base?baseIndex:frameIndex;
    ({title,eyebrow,content,obj}=itemDetail(getItem(state,selected.id),state,index,{base}));
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
const basePicker=createPicker($('base-picker'),{label:'对比基线时刻',onChange:v=>{pause();ix.reset();baseIndex=v;render({kind:'quick'});}});
const targetPicker=createPicker($('target-picker'),{label:'对比当前时刻',onChange:v=>goFrame(v)});
function setupSpeed() {
  const group=$('playback-speed'), radios=[...group.querySelectorAll('[role="radio"]')];
  const apply=(value,focus)=>{
    speed=value;
    radios.forEach(r=>{const on=Number(r.dataset.speed)===value;r.setAttribute('aria-checked',String(on));r.tabIndex=on?0:-1;if(on&&focus)r.focus();});
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
    if(dragging){const t=timeAt(e.clientX);if(t!==cursor)setCursor(t,{quick:true});}
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
// ---------- play: a turn, then time to read the settled board; hovering or an open card holds the round ----------

const readS=()=>Math.max(2.2,2.9/speed);
function playTick() {
  const t=performance.now()/1000, dt=Math.min(0.25,t-player.at);
  player.at=t;
  if(!player.on)return;
  if(!player.held&&pinnedBeat==null)player.acc+=dt;
  if(player.acc>=(reduced()?0:TURN_S*(slowMotion?3:1))+readS()) {
    player.acc=0;
    if(frameIndex>=frames.length-1){pause();return;}
    setCursor(stamps[frameIndex+1]);
    if(frameIndex===frames.length-1)pause();
  }
}
function pause() {
  if(player.timer){clearInterval(player.timer);player.timer=null;}
  player.on=false;player.acc=0;updatePlayButton();
}
function play() {
  if(player.on){pause();return;}
  ix?.reset();
  if(frameIndex===frames.length-1)setCursor(start);
  player.on=true;player.acc=0;player.at=performance.now()/1000;
  player.timer=setInterval(playTick,100);
  updatePlayButton();
}
/** ix holds and lets go of the round in flight and of play (hovering a tile, an open card). */
// Your own answer is never held: its receipt draws while you hover or read the card.
function holdMotion(){player.held=true;if(beat&&beat.kind!=='answer'&&beat.kind!=='undo')beat.hold();}
function releaseMotion(){player.held=false;beat?.release();}
function updatePlayButton() {$('play-button').innerHTML=player.on?'<span aria-hidden="true">Ⅱ</span><span>暂停</span>':'<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m6 3 11 7-11 7Z" fill="currentColor"/></svg><span>播放</span>';$('play-button').setAttribute('aria-label',player.on?'暂停回放':'开始回放');}
function showInspector() {
  const inspector=document.querySelector('.inspector');
  inspector.scrollTop=0;
  $('inspector-title').focus({preventScroll:true});
  if(matchMedia('(max-width: 759px)').matches)inspector.scrollIntoView({block:'start',behavior:'instant'});
}
/** Is this item a tile on the current board (so it is read in its card)? */
const onBoard=id=>Boolean(id&&id!==TAIL_ID&&id!=='__blank__'&&boards.current?.ids().includes(id)&&getItem(currentState,id));
function select(type,id,origin) {
  pause();
  // An item on the current board opens as its card, grown out of its tile.
  if(type==='item'&&origin!=='base'&&onBoard(id)){openCard(id);return;}
  ix?.reset();
  if(!(type==='item'&&selected.type==='item'&&selected.id===id))panel=null;
  selected={type,id,origin};detailMode='detail';render();showInspector();
}
// Answers are said in their receipts on the board; a screen reader hears them here.
const live=document.createElement('div');
live.className='sr-only';live.setAttribute('role','status');live.setAttribute('aria-live','polite');
document.body.append(live);
function announce(message){live.textContent='';requestAnimationFrame(()=>{live.textContent=message;});}
let toastTimer=null;
function toast(message) {
  const el=$('toast');
  el.innerHTML=`<span>${escape(message)}</span>`;
  el.hidden=false;el.classList.remove('is-leaving');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.classList.add('is-leaving');toastTimer=setTimeout(()=>{el.hidden=true;el.classList.remove('is-leaving');},180);},2600);
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
  ix?.reset();
  const oldPath=layerPath(layerId), nextPath=layerPath(id);
  const rising=!id||oldPath.includes(id);
  const kind=rising?'rise':(!layerId||nextPath.includes(layerId))?'dive':'layout';
  const anchorId=rising?oldPath[nextPath.length]:nextPath[oldPath.length];
  // Remember where the anchor sits on each board before the layer changes: the dive opens from it.
  const anchorRect={current:boards.current?.rect(anchorId),base:boards.base?.rect(anchorId)};
  layerId=id;
  // Rising out of the tail keeps whatever small item was being read; diving into it starts from the overview.
  // An item that ends up on the board (the one risen out of, the small item picked in the tail) opens as its card.
  if(focusItem)selected={type:'item',id:focusItem};
  else if(anchorId===TAIL_ID){if(!rising||selected.type!=='item')selected={type:'state'};}
  else selected={type:'item',id:rising?anchorId:id,origin};
  if(selected.type==='item'&&!selected.id)selected={type:'state'};
  panel=null;detailMode='detail';render({kind,anchorId,anchorRect});
  focusLayer();
}
function dive(id,origin) {changeLayer(id,origin);}
function rise() {changeLayer(layerId===TAIL_ID?null:layerPath(layerId).at(-2)||null);}
// ---------- answers: the question folds into a receipt where it stands; the area waits for the next round ----------

let answersVersion=0;               // bumps on every answer or undo, so cards and keyboard proxies are rewritten
function answer(itemId,actionId,extra={}) {
  const item=getItem(currentState,itemId), ask=item&&askOf(currentState,frameIndex,itemId);
  if(!ask)return null;
  const normalized=normalizeAsk(ask);
  const action=actionId==='snooze'?{id:'snooze',label:'稍后提醒',meaning:'snooze'}:normalized.actions.find(a=>a.id===actionId);
  if(!action)return null;
  pause();panel=null;
  lastAnswer=answers.save(item,ask,action,cursor,extra);answersVersion++;
  render({kind:'answer'});
  announce(`${answerWords(lastAnswer)} · 已保存，等 Agent 下一轮整理`);
  return lastAnswer;
}
function undoAnswer(key) {
  const record=answers.store.list().find(r=>r.key===key);
  if(!record)return;
  answers.undo(record);answersVersion++;
  if(lastAnswer?.key===key)lastAnswer=null;
  render({kind:'undo'});
  announce('已撤销，这个问题重新等你回应');
}
const responders={
  ask:target=>askOf(currentState,frameIndex,target),
  respond:(target,action,extra)=>answer(target,action.id,extra),
  undo:()=>{},
};
bindResponses($('inspector-body'),{...responders,open:(kind,key)=>{panel=kind==='actions'?null:{kind,key};renderInspector();}});
// ---------- interaction (forms/motion/ix.mjs): hover a tile for its summary, click it for its card ----------

const stage=document.querySelector('.main-grid');
{const link=document.createElement('link');link.rel='stylesheet';link.href='forms/motion/ix.css';document.head.append(link);}
// The concept layer: this round's inputs as grey grains, on one canvas over the stage (below the cards and leaders).
const grainCanvas=document.createElement('canvas');
grainCanvas.className='tree-grains';grainCanvas.setAttribute('aria-hidden','true');
stage.append(grainCanvas);
const grainCtx=grainCanvas.getContext('2d');
let grainsDrawn=false;
/** A client rect in stage px, as {x0, y0, x1, y1}. */
const inStage=r=>{const s=stage.getBoundingClientRect();return {x0:r.left-s.left,y0:r.top-s.top,x1:r.right-s.left,y1:r.bottom-s.top};};
const boardBox=()=>inStage($('current-board').getBoundingClientRect());
// The item tiles on the current board (not the tail block, not the blank), in reading order, with their labels.
let boardIds=new Set(), proxies=[], proxyKey='';
function tileBox(id) {
  const r=boards.current?.rect(id);
  if(!r)return null;
  const b=boardBox();
  return {x0:b.x0+r.x,y0:b.y0+r.y,x1:b.x0+r.x+r.width,y1:b.y0+r.y+r.height};
}
/** The 10 px band just outside the board counts as the tile at that edge (a tile is hit across its whole area inside). */
function bandHit(x,y) {
  const b=boardBox(), pad=10;
  if(x<b.x0-pad||x>b.x1+pad||y<b.y0-pad||y>b.y1+pad)return null;
  const px=Math.max(0,Math.min(b.x1-b.x0-0.5,x-b.x0)), py=Math.max(0,Math.min(b.y1-b.y0-0.5,y-b.y0));
  for(const id of boardIds){const r=boards.current.rect(id);if(r&&px>=r.x&&px<r.x+r.width&&py>=r.y&&py<r.y+r.height)return id;}
  return null;
}
/** What a card may say part-way through a turn (tree-motion.md 3.3: nothing ahead of its beat). */
const ALL_SEEN={inputs:true,share:true,asks:true};
function seenNow() {
  if(!beat||beat.done||beat.kind!=='turn')return ALL_SEEN;
  const t=beat.t, s=beat.spec.seen;
  return {inputs:t>=s.inputs,share:t>=s.share,asks:t>=s.asks};
}
const rootLevel=()=>!layerId||layerId===TAIL_ID;
/** The facts of one tile: the dial's itemFacts for root-level items (stream, inputs, change), plus this page's answer. */
function factsOf(id) {
  const item=getItem(currentState,id);
  const base=rootLevel()&&item?itemFacts(frameIndex,id):null;
  const ask=item&&askOf(currentState,frameIndex,id);
  return {...(base||{}),id,i:frameIndex,short:base?.short||item?.title||id,item,ask,rc:item?receiptOf(item,ask):null};
}
function receiptLine(rc,seen) {
  const words=`${answerWords(rc.record)}${rc.mode==='prior'?'上一版':''}`;
  const status=rc.status==='acknowledged'&&seen.inputs?`已收到 · ${shortTime(rc.at)}`:'已保存，等下一轮整理';
  return `<div class="ix-ask tc-rc${rc.status==='acknowledged'&&seen.inputs?' is-received':''}"><i></i><span>✓ ${escape(words)}</span><small>${status}</small></div>`;
}
/** The summary: which stream, the whole title, shares and how this round changed them, its inputs, its question or receipt. */
function peekCard(f,{seen}) {
  const item=f.item;
  if(!item)return '';
  const share=seen.share||f.before==null?item.share:f.before;
  const from=f.stream?.length?`来自${f.stream.join(' · ')}`:categoryLabel(item);
  const change=!seen.share?'本轮的份额还没落定':f.change?.text||'';
  const inputs=!f.inputs?'':!seen.inputs?'本轮的输入还在路上':f.inputs.length?`本轮进了 ${f.inputs.length} 条输入`:'本轮没有输入进它';
  const ask=f.ask&&f.rc?.mode!=='answer'&&seen.asks?`<div class="ix-ask"><i></i><span>${escape(f.ask.prompt)}</span>${f.ask.due_at?`<small>${escape(dueText({due:Date.parse(f.ask.due_at)},cursor))}</small>`:''}</div>`:'';
  return `<div class="ix-k">${escape(from)}</div><div class="ix-q">${escape(item.title)}</div><div class="ix-d">${share} 份${change?` · ${escape(change)}`:''}</div>${inputs?`<div class="ix-d">${inputs}</div>`:''}${f.rc?receiptLine(f.rc,seen):''}${ask}`;
}
/** The card: the reader's own detail of this item (itemDetail), under a head that says “这一件”. */
let cardBodyHTML='';
function cardHTML(id) {
  const item=getItem(currentState,id);
  if(!item)return '';
  cardBodyHTML=itemDetail(item,currentState,frameIndex).content;
  return `<div class="tc-head"><span class="tc-kicker">这一件 · ${escape(categoryLabel(item))} · ${escape(item.id)}</span><button class="tc-close" data-x="close" aria-label="收回，回到概览" title="收回（Esc）">↶ 概览</button></div><h2 class="tc-title">${escape(item.title)}</h2><div class="inspector-body tc-body">${cardBodyHTML}</div>`;
}
/** After an answer, an undo or a panel opening in the card: rewrite its body in place (the card keeps its place and scroll). */
function refreshCard() {
  const id=ix?.s.open;
  if(!id||!cardEl||cardEl.hidden)return;
  const item=getItem(currentState,id), body=cardEl.querySelector('.tc-body');
  if(!item){ix.close();return;}
  if(!body)return;
  const html=itemDetail(item,currentState,frameIndex).content;
  if(html!==cardBodyHTML){const top=cardEl.scrollTop;cardBodyHTML=html;body.innerHTML=html;cardEl.scrollTop=top;}
  if(panel)body.querySelector('.og-panel textarea, .og-panel [data-rs-keypad], .og-panel button')?.focus({preventScroll:true});
}
/**
 * The card lies over the reader column (the overview stays beneath it); the leader runs level from the tile's edge to the
 * card's. With the reader below the board (narrow windows) the card lies over it and the leader runs down.
 */
function placeCard(id,el) {
  const t=tileBox(id), r=inStage(document.querySelector('.inspector').getBoundingClientRect());
  if(!t)return null;
  const beside=r.x0>=t.x1-1, w=Math.round(r.x1-r.x0), h=Math.round(Math.min(r.y1-r.y0,beside?1e6:innerHeight-24));
  el.style.width=`${w}px`;el.style.height=`${h}px`;el.style.maxHeight=`${h}px`;
  const x=r.x0, y=r.y0, lift=IX.pop/2;
  if(beside) {
    const ty=Math.max(y+16,Math.min(y+h-16,(t.y0+t.y1)/2));
    return {x,y,w,h,path:[{x:t.x1+lift,y:ty},{x,y:ty}]};
  }
  const tx=Math.max(x+16,Math.min(x+w-16,(t.x0+t.x1)/2));
  return {x,y,w,h,path:[{x:tx,y:t.y1+lift},{x:tx,y}]};
}
function openCard(id) {
  if(!ix||!onBoard(id))return false;
  pause();
  if(selected.type==='item'){selected={type:'state'};renderInspector();}
  ix.open(id);
  // With the reader below the board (phones), the card lies there too: bring it into view.
  if(matchMedia('(max-width: 759px)').matches)requestAnimationFrame(()=>document.querySelector('.inspector').scrollIntoView({block:'start',behavior:reduced()?'instant':'smooth'}));
  return true;
}
/** Open a card once the beat in flight has ended (rising out of a layer, an ?item= address), if nothing moved on. */
function afterBeat(fn) {
  const at={frameIndex,layerId}, go=()=>{if(frameIndex===at.frameIndex&&layerId===at.layerId)fn();};
  if(beat&&!beat.done)beat.clean(()=>requestAnimationFrame(go));else requestAnimationFrame(go);
}
// Tiles by short name too (foldTree.hover('#13572')): id, then the dial's short name, then the title.
function namedTile(name) {
  if(boardIds.has(name))return name;
  for(const id of boardIds){const f=rootLevel()?itemFacts(frameIndex,id):null;if(f?.short===name||getItem(currentState,id)?.title===name)return id;}
  return null;
}
// The keyboard's proxies come right after 对比 in the tab order (tree-motion.md 3.5), before the base board's own buttons.
const keysHost=document.createElement('div');
keysHost.className='board-keys';
$('compare-button').after(keysHost);
ix=createIx({
  stage, keysIn:keysHost,
  label:'格子：Tab 逐格看概要，Enter 展开详情，Esc 收回',
  facts:factsOf, has:id=>boardIds.has(id), named:namedTile,
  index:()=>`${frameIndex}:${layerId||''}:${answersVersion}`,
  hit:bandHit,
  pointOf:id=>{const b=tileBox(id);return b&&{x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2};},
  anchor:id=>{
    const b=tileBox(id), board=boardBox(), right=(b.x0+b.x1)/2<=(board.x0+board.x1)/2;
    return {x:right?b.x1:b.x0,y:Math.min(b.y1-12,b.y0+28),facing:right?1:-1,keep:b};
  },
  detailPlace:placeCard,
  pause:holdMotion, resume:releaseMotion, paused:()=>player.held,
  last:frames.length-1, answerHref:()=>null,
  skip:'.inputs-panel, .inspector, .frame-heading, .frame-note, .board-heading, .board-legend, .diff-summary, .compare-controls, .cold-start-progress, #base-column',
  seen:seenNow,
  peekHTML:peekCard, detailHTML:f=>cardHTML(f.id),
});
cardEl=stage.querySelector(':scope > .ix-detail');
cardEl.classList.add('tree-card');
bindResponses(cardEl,{...responders,open:(kind,key)=>{panel=kind==='actions'?null:{kind,key};refreshCard();}});

// One frame: dim the other tiles, lift the open one, ring the keyboard's, cut the title, then the cards, then the grains.
const dimmed=new WeakMap();
let lastOpen=null;
function paintTiles(X) {
  const board=boards.current;
  if(!board)return;
  const pid=X.popId&&X.pop>0.001?X.popId:null;
  for(const id of board.ids()) {
    const el=board.element(id);
    const o=X.focus&&X.focus!==id?Math.round((1-0.3*X.dim)*1000)/1000:1;
    if(dimmed.get(el)!==o){el.firstChild.style.opacity=o===1?'':String(o);dimmed.set(el,o);}
    el.classList.toggle('is-popped',id===pid);
    el.classList.toggle('is-keyfocus',id===X.keyFocus);
    el.classList.toggle('is-selected',id===ix.s.open);
    if(id===pid){const r=board.rect(id);el.style.setProperty('--psx',(1+IX.pop*X.pop/r.width).toFixed(4));el.style.setProperty('--psy',(1+IX.pop*X.pop/r.height).toFixed(4));el.style.setProperty('--pop',X.pop.toFixed(3));}
  }
  $('current-board').classList.toggle('has-pop',Boolean(pid));
}
function sizeGrains() {
  const dpr=devicePixelRatio||1, w=stage.clientWidth, h=stage.clientHeight;
  if(grainCanvas.width!==Math.round(w*dpr)||grainCanvas.height!==Math.round(h*dpr)){grainCanvas.width=Math.round(w*dpr);grainCanvas.height=Math.round(h*dpr);grainCanvas.style.width=`${w}px`;grainCanvas.style.height=`${h}px`;}
}
/** Plan this turn's grains (two inputs a grain): taken-in ones end inside the tile they went to, the rest go out short. */
function grainsFor(ctx) {
  const r=rounds[frameIndex];
  if(!r?.events?.length||!boards.current)return null;
  const panel=inStage(document.querySelector('.inputs-panel').getBoundingClientRect()), b=boardBox();
  if(panel.x1>b.x0+1)return null; // the inputs are not to the left of the board (narrow windows): no grains
  const landOf=id=>{
    const at=id&&(boardIds.has(id)?id:tails.current.has(id)?TAIL_ID:null), rect=at&&boards.current.rect(at);
    return rect?{x:b.x0+rect.x,y:b.y0+rect.y,width:rect.width,height:rect.height}:null;
  };
  const inputs=r.events.map(e=>({key:`${frameIndex}:${e.k}`,land:landOf(e.root)}));
  sizeGrains();
  return {ctx,list:planGrains(inputs,{start:{x:panel.x1,y0:panel.y0+48,y1:Math.min(panel.y1,b.y1)-12},board:{x:b.x0,y:b.y0,width:b.x1-b.x0,height:b.y1-b.y0},span:ctx.spec.grains})};
}
function paintGrains(X) {
  const g=grains;
  if(!g){if(grainsDrawn){grainCtx.clearRect(0,0,grainCanvas.width,grainCanvas.height);grainsDrawn=false;}return;}
  const alive=!g.ctx.done&&drawGrains(grainCtx,g.list,g.ctx.t,devicePixelRatio||1);
  grainsDrawn=true;
  grainCanvas.style.opacity=X.dim?String(1-0.6*X.dim):'';
  if(!alive){grainCtx.clearRect(0,0,grainCanvas.width,grainCanvas.height);grainsDrawn=false;grains=null;}
}
function tick() {
  requestAnimationFrame(tick);
  const X=ix.frame();
  // The cut: the headline turns to “这一件” while the card is out, and back once it has folded away.
  const title=X.detail&&ix.view?`这一件 · ${ix.view.short}`:frames[frameIndex].title;
  if($('frame-title').textContent!==title)$('frame-title').textContent=title;
  if(ix.s.open!==lastOpen){lastOpen=ix.s.open;syncURL();}
  paintTiles(X);
  ix.paint();
  ix.sync(`${proxyKey}:${answersVersion}`,proxies);
  paintGrains(X);
}
// Hovering an input or a question points at the tile that carries it (or the tail block holding it).
document.addEventListener('pointerover',e=>{
  const source=e.target.closest?.('[data-related]');
  document.querySelectorAll('.pin-tile.is-linked').forEach(t=>t.classList.remove('is-linked'));
  if(source&&!e.target.closest('.pinboard'))linkTiles(source.dataset.related.split(' ').filter(Boolean));
});
function linkTiles(ids) {
  const board=$('current-board');
  for(const id of ids) {
    const tile=board.querySelector(`.pin-tile[data-id="${CSS.escape(id)}"]:not(.is-leaving)`)||(board.querySelector(`.pin-tile.is-tail [data-tail-item="${CSS.escape(id)}"]`)?.closest('.pin-tile'));
    tile?.classList.add('is-linked');
  }
}
// Stills and checks: where the tiles are, which to pick, a point just outside one.
function tilesList() {
  const board=boards.current;
  if(!board)return [];
  return board.ids().map(id=>{
    const item=getItem(currentState,id), ask=item&&askOf(currentState,frameIndex,id), rc=item&&receiptOf(item,ask);
    return {id,short:item&&rootLevel()?itemFacts(frameIndex,id).short:id,rect:board.rect(id),share:item?.share??null,ask:ask?.id||null,receipt:rc?{mode:rc.mode,status:rc.status}:null};
  });
}
/** The largest item tile on the board's left edge (the band outside it is the workspace's own margin). */
function pickTile() {
  const list=tilesList().filter(t=>boardIds.has(t.id)), area=t=>t.rect.width*t.rect.height;
  const left=list.filter(t=>t.rect.x<0.5).sort((a,b)=>area(b)-area(a));
  return (left[0]||list.sort((a,b)=>area(b)-area(a))[0])?.id||null;
}
function nearOf(id,px=9) {
  const r=boards.current?.rect(id), b=$('current-board').getBoundingClientRect();
  if(!r)return null;
  if(r.x<0.5)return {x:b.left-px,y:b.top+r.y+r.height/2};
  if(r.y+r.height>b.height-0.5)return {x:b.left+r.x+r.width/2,y:b.bottom+px};
  if(r.x+r.width>b.width-0.5)return {x:b.right+px,y:b.top+r.y+r.height/2};
  return null;
}
// ---------- 自动讲一遍 (tree-motion.md 3.4): three beats, about 10 s, once ----------
// Only when this page is the top window, was opened directly (no referrer) and its address had no ?frame= (syncURL
// writes one at once, so read the address the page was loaded with). Any key or press skips to the end state.
const TELLS={
  // f21 → f22; approve #13572 in its tile; f23 (the two weeks' largest yield).
  composite:{from:'f21',to:'f22',next:'f23',item:'pr-reviews-0814',action:'approve',via:'tile'},
  // f03 → f04 (two bill leads merge into one tile); choose 固定模板 in the export tile's card; f05.
  story:{from:'f03',to:'f04',next:'f05',item:'launch',action:'fixed',via:'card'},
};
const topLevel=(()=>{try{return window.top===window;}catch{return false;}})();
const loadedWith=new URL(performance.getEntriesByType?.('navigation')?.[0]?.name||location.href);
const tellPlan=(()=>{
  const p=TELLS[currentDataset()];
  if(!p)return null;
  const at=id=>frames.findIndex(f=>f.id===id), q={...p,a:at(p.from),b:at(p.to),c:at(p.next)};
  return q.a>=0&&q.b===q.a+1&&q.c===q.b+1?q:null;
})();
let tell=null, tellRecord=null;
/** Put the board at round i with no motion (the tell's starting point). */
function jumpTo(i) {
  beat?.finish();beat=null;
  cursor=stamps[i];frameIndex=i;if(baseIndex>frameIndex)baseIndex=frameIndex;
  lastTurn=null;render(null);
}
function startTell() {
  if(!tellPlan||reduced())return;
  stopTell();pause();ix.reset();
  // 重演 first takes back the answer the last telling gave for you.
  if(tellRecord){const r=answers.store.list().find(x=>x.key===tellRecord.key);if(r){answers.undo(r);answersVersion++;}tellRecord=null;}
  layerId=null;comparing=false;selected={type:'state'};panel=null;
  jumpTo(tellPlan.a);
  const P=tellPlan;
  const steps=[
    [900,()=>setCursor(stamps[P.b])],
    [2600,()=>{if(P.via==='card')ix.open(P.item);else ix.hover(P.item,'tour');}],
    [4400,()=>{tellRecord=answer(P.item,P.action);}],
    [5400,()=>{if(P.via==='card')ix.close();else if(ix.s.via==='tour')ix.hover(null,'now');}],
    [6000,()=>setCursor(stamps[P.c])],
    [7800,()=>ix.hover(P.item,'tour')],
    [10000,()=>stopTell()],
  ];
  tell={timers:steps.map(([ms,fn])=>setTimeout(()=>{if(tell)fn();},ms))};
}
function stopTell(skip=false) {
  if(!tell)return;
  tell.timers.forEach(clearTimeout);tell=null;
  if(ix.s.via==='tour')ix.hover(null,'now');
  if(!skip)return;
  // The end state: the answer given at f22 (or f04), the round after it, nothing in flight.
  ix.reset();
  const P=tellPlan;
  if(!tellRecord) {
    const state=records[P.b].state, item=getItem(state,P.item), ask=item&&currentAsk({index:P.b,state},P.item);
    const action=ask&&normalizeAsk(ask).actions.find(a=>a.id===P.action);
    if(action){tellRecord=answers.save(item,ask,action,stamps[P.b]);answersVersion++;}
  }
  if(frameIndex!==P.c)setCursor(stamps[P.c]);else render(null);
  beat?.finish();beat=null;grains=null;
}
// Any key skips (and is spent on skipping); so does a press anywhere, which then goes on as usual.
addEventListener('keydown',e=>{if(!tell)return;e.preventDefault();e.stopImmediatePropagation();stopTell(true);},true);
addEventListener('pointerdown',e=>{if(tell&&!e.target.closest?.('#tell-again'))stopTell(true);},true);
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
$('compare-button').onclick=()=>{pause();comparing=!comparing;if(comparing)baseIndex=Math.max(0,frameIndex-1);ix.reset();render({kind:'quick'});};
$('close-compare').onclick=()=>{comparing=false;ix.reset();render({kind:'quick'});};
$('replay-motion').onclick=replayMotion;
$('slow-motion').onclick=()=>{slowMotion=!slowMotion;updateMotionControls();if(lastTurn)replayMotion();};
$('note-toggle').onclick=()=>{const open=!$('frame-note').classList.contains('is-open');$('frame-note').classList.toggle('is-open',open);$('note-toggle').setAttribute('aria-expanded',String(open));$('note-toggle').textContent=open?'收起':'展开';};
$('full-state-button').onclick=()=>{pause();selected={type:'state'};detailMode='json';render();showInspector();};
$('close-detail').onclick=()=>select('state');
// 重演: the view bar has it whenever this page is the top window (the tell itself plays only when opened directly).
{const again=document.createElement('button');again.id='tell-again';again.type='button';again.title='把换轮、作答、下一轮三拍再讲一遍（约 10 秒，任意键跳过）';again.innerHTML='<span aria-hidden="true">▷</span> 重演';again.hidden=!topLevel||!tellPlan;again.onclick=()=>startTell();document.querySelector('.view-actions').prepend(again);}
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
// Whether Esc was ix's (an open card or a summary), read before ix folds it.
let escForIx=false;
document.addEventListener('keydown',e=>{if(e.key==='Escape')escForIx=Boolean(ix.s.open||ix.s.hover);},true);
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!$('story-drawer').hidden){$('story-drawer').hidden=true;$('story-button').setAttribute('aria-expanded','false');$('story-button').focus();return;}
  if(e.target.matches('input,textarea,select,[contenteditable]')||e.altKey||e.metaKey||e.ctrlKey)return;
  if(e.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
    e.preventDefault();e.stopPropagation();
    const next=e.key==='Home'?'detail':e.key==='End'?'json':detailMode==='detail'?'json':'detail';
    detailMode=next;renderInspector();$(`${next}-tab`).focus();return;
  }
  const key=e.key.toLowerCase();
  // A / R answer the item being read: its card, or the reader's.
  const reading=ix.s.open||(selected.type==='item'&&selected.origin!=='base'?selected.id:null);
  if((key==='a'||key==='r')&&reading) {
    const item=getItem(currentState,reading), ask=item&&askOf(currentState,frameIndex,item.id);
    if(ask&&normalizeAsk(ask).expects==='approve'&&!answeredHere(item,ask)){e.preventDefault();answer(item.id,key==='a'?'approve':'request-changes');return;}
  }
  if(key==='u'&&lastAnswer){e.preventDefault();undoAnswer(lastAnswer.key);return;}
  if(e.key===' '&&!e.target.matches('button,a,summary')){e.preventDefault();play();}
  if(e.key==='ArrowLeft'){e.preventDefault();goFrame(frameIndex-1);}
  if(e.key==='ArrowRight'){e.preventDefault();goFrame(frameIndex+1);}
  if(e.key==='Escape'){
    // An open card or a summary is ix's to fold (it puts focus back on the tile's button).
    if(escForIx||ix.s.open)return;
    pause();
    if(panel){panel=null;renderInspector();return;}
    if(layerId){rise();}else{selected={type:'state'};detailMode='detail';render();focusLayer();}
  }
});
let resizeFrame;
const boardResizeObserver=new ResizeObserver(()=>{
  cancelAnimationFrame(resizeFrame);
  resizeFrame=requestAnimationFrame(()=>{
    sizeGrains();ix.relayout();
    if(currentBoardSizes()===boardSizes)return;
    beat?.finish();beat=null;grains=null;
    renderBoards(null);renderHero(null);updateMotionControls();
  });
});
boardResizeObserver.observe($('boards-wrap'));
boardResizeObserver.observe($('workspace'));
boardResizeObserver.observe(stage);
// The card is placed once when it opens; a scrolled workspace or page moves the tile under it, so place it again.
document.addEventListener('scroll',()=>{if(ix.s.open||ix.s.peek)ix.relayout();},{capture:true,passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();stopTell(true);beat?.finish();beat=null;grains=null;}});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{beat?.finish();beat=null;grains=null;updateMotionControls();});
// Opened directly: the first frame drawn is already the tell's starting round (no flash of the opening round).
const tellsNow=topLevel&&!document.referrer&&!loadedWith.searchParams.has('frame')&&tellPlan&&!reduced();
if(tellsNow){frameIndex=tellPlan.a;cursor=stamps[frameIndex];}
render();
requestAnimationFrame(tick);
if(tellsNow)startTell();
// Read-only hooks for browser verification, not part of the Fold product API.
window.foldPrototype={scenario,records,get state(){return currentState;},get cursor(){return cursor;},goFrame,setCursor,getDiff:()=>currentDiff,
  motion:()=>boards.current?.inspect(),answers:()=>answers.list(),select:(id)=>select('item',id),openTail:()=>changeLayer(TAIL_ID)};
// The same hooks as foldDial (hover / unhover / open / close / ixAt / paused / pointOf / ixState) plus this page's own.
window.foldTree={
  ...ix.hooks(),
  get index(){return frameIndex;},
  go:i=>goFrame(i), play:()=>{if(!player.on)play();}, stop:()=>pause(),
  /** Pin every beat in flight (and the next ones) at t seconds from its cut; null lets go. */
  beatAt:t=>{pinnedBeat=t==null?null:Number(t);beat?.pin(pinnedBeat);},
  beat:()=>beat&&{kind:beat.kind,t:beat.t,total:beat.total,done:beat.done,held:beat.held},
  answer:(id,action)=>Boolean(answer(id,action)), undo:id=>{const r=answers.find(id,cursor);if(r)undoAnswer(r.key);return Boolean(r);},
  waiting:()=>waitingNow(), hero:()=>$('layer-title').querySelector('.hero-n')?.textContent,
  tiles:()=>tilesList(), pick:()=>pickTile(), nearOf:(id,px=9)=>nearOf(id,px),
  tell:()=>startTell(), skip:()=>stopTell(true), telling:()=>Boolean(tell),
  motion:()=>boards.current?.inspect(), player:()=>({on:player.on,held:player.held}),
};
