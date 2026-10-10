import { scenario } from './scenario.mjs?v=direct-titles-1';
import { replayScenario, projectState, getItem, diffStates, layoutTreemap } from './engine.mjs?v=direct-titles-1';
import { createBoardMotion } from './motion.mjs';

// Throwaway interaction prototype: authored Agent decisions, deterministic replay,
// no live model, account access, or persistence. One focused time-machine view.
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const records = replayScenario(scenario);
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
let eventFilter = 'all';
let timer = null;
let inspectedJSON;
let currentState, baseState, currentDiff;
const boardMotion=createBoardMotion({duration:1400});
let lastTransition=null, slowMotion=false, panelAnimations=[];
let boardSizes='';
const kinds = {'needs-you':'需要你','in-progress':'进行中',done:'已完成',fyi:'知会'};
const weights = {critical:'关键',high:'高',normal:'常规',low:'低',trace:'微量'};
const statuses = {active:'当前关注',withdrawn:'已撤下',merged:'已合并'};
const verdicts = {used:'采用',duplicate:'重复',noise:'噪音',deferred:'暂缓'};
const changeNames = {added:'新增',updated:'更新',withdrawn:'撤下',restored:'重新纳入',merged:'合并',annotations_changed:'反馈'};
const fieldNames = {summary:'摘要',weight:'档位',share:'份额',share_override:'显式份额',kind:'类型',title:'标题',reason:'原因',sources:'来源',children:'子项',status:'状态',due_at:'截止时间',stale_after:'参考有效期',annotations:'反馈',parent_id:'所属层',merged_into:'合并至'};
const dateFmt = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',weekday:'short'});
const timeFmt = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
const shortDate = ts => dateFmt.format(new Date(ts));
const shortTime = ts => timeFmt.format(new Date(ts));
const frameLabel = (f,i) => `${String(i+1).padStart(2,'0')} · ${shortDate(f.at)} ${shortTime(f.at)} · ${f.title}`;
const json = obj => JSON.stringify(obj,null,2);
const nowISO = () => new Date(cursor).toISOString();
const button = (id,label,extra='') => `<button data-item="${escape(id)}" ${extra}>${label}</button>`;
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
function visibleLayer(state) {return layerId ? getItem(state,layerId)?.children || {budget:64,used:0,items:[]} : state.root;}
function annotationsFor(item,state=currentState) {return (state.annotations||[]).filter(a => a.item===item.id || a.item_id===item.id || item.annotations?.includes(a.id));}
function categoryLabel(item,state=currentState) {return scenario.categories?.[rootId(item,state)]?.label || '关注事项';}
function goFrame(i) {pause();setCursor(stamps[Math.max(0,Math.min(frames.length-1,i))]);}
function setCursor(time) {
  const previousIndex=frameIndex;
  cursor=Math.max(start,Math.min(end,time));
  frameIndex=stamps.reduce((last,t,i)=>t<=cursor?i:last,0);
  if(baseIndex>frameIndex)baseIndex=frameIndex;
  render(previousIndex!==frameIndex?{kind:'frame'}:null);
  if(previousIndex!==frameIndex) {
    document.querySelector('.inputs-panel').scrollTop=0;
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
function animatePanels(previous,kind) {
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  for(const [id,oldContent] of previous) {
    const el=$(id);
    if(el.innerHTML===oldContent || (id==='inspector-body'&&detailMode==='json'))continue;
    const translate=kind==='frame'&&['frame-title','agent-note'].includes(id)?3:0;
    panelAnimations.push(el.animate([{opacity:.45,transform:`translateY(${translate}px)`},{opacity:1,transform:'translateY(0)'}],{duration:200,easing:'cubic-bezier(.22,1,.36,1)'}));
  }
}
function updateMotionControls() {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('replay-motion').disabled=!lastTransition||reduced;
  $('replay-motion').title=reduced?'系统已开启减少动态效果':'重播刚才的份额与布局变化';
  $('slow-motion').disabled=reduced;
  $('slow-motion').title=reduced?'系统已开启减少动态效果':'放慢过渡动画，便于看清去向';
  $('slow-motion').setAttribute('aria-pressed',String(slowMotion));
  $('slow-motion').classList.toggle('is-active',slowMotion);
}
function transitionDuration(kind='frame') {
  const normal=kind==='dive'||kind==='rise'?1600:1400;
  return Math.round(normal*(slowMotion?1.8:1));
}
function replayMotion() {
  if(!lastTransition)return;
  pause();boardMotion.transition(lastTransition.before,{...lastTransition.options,duration:transitionDuration(lastTransition.options.kind)});
}
function syncURL() {
  const p=new URLSearchParams();p.set('frame',String(frameIndex));
  if(cursor!==stamps[frameIndex])p.set('at',String(cursor));
  if(layerId)p.set('layer',layerId);
  if(selected.type==='item')p.set('item',selected.id);
  if(comparing)p.set('base',String(baseIndex));
  history.replaceState(null,'',`${location.pathname}?${p}`);
  document.querySelectorAll('[data-prototype-variant]').forEach(link=>{
    const target=new URLSearchParams(p);target.set('variant',link.dataset.prototypeVariant);
    link.href=`./?${target}`;
  });
}
function render(transition=null) {
  const oldState=currentState, oldBase=baseState;
  const before=transition?boardMotion.capture():null;
  if(!transition)boardMotion.cancel('render');
  panelAnimations.forEach(animation=>animation.cancel());panelAnimations=[];
  const previous=transition?['frame-title','agent-note','event-list','inspector-body','budget-label'].map(id=>[id,$(id).innerHTML]):[];
  currentState=projectState(records[frameIndex].snapshot,nowISO());
  baseState=projectState(records[baseIndex].snapshot,nowISO());
  if(layerId && !getItem(currentState,layerId)?.children && !(comparing&&getItem(baseState,layerId)?.children))layerId=null;
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
  document.querySelector('.note-label').textContent=f.phase==='initial'?'初始状态':'本轮整理依据';
  $('board-hint').textContent=f.phase==='initial'?'暂无关注事项':'点击查看详情 · 有子项可进入下一层';
  const coldStart=frames[0].phase==='initial'&&frameIndex<=3;
  $('cold-start-progress').hidden=!coldStart;
  $('cold-start-progress').innerHTML=coldStart?['暂无事项','导出范围待定','陪妈妈约定','工作事项'].map((label,i)=>`${i?'<span aria-hidden="true">→</span>':''}<button data-frame="${i}" ${i===frameIndex?'aria-current="step"':''}>${label}</button>`).join(''):'';
  const layer=visibleLayer(currentState);
  $('layer-title').textContent=layerId ? `${getItem(currentState,layerId)?.title || '历史条目'} · 子层` : '全部关注事项';
  $('budget-label').innerHTML=`已用 <strong>${layer.used}</strong> / ${layer.budget} <span>· 留白 ${layer.budget-layer.used}</span>`;
  $('breadcrumbs').innerHTML=breadcrumbs();
  $('compare-controls').hidden=!comparing;
  $('base-column').hidden=!comparing;
  $('current-label').hidden=!comparing;
  $('boards-wrap').classList.toggle('is-comparing',comparing);
  $('compare-button').classList.toggle('is-active',comparing);
  $('compare-button').setAttribute('aria-pressed',String(comparing));
  $('base-label').textContent=`基线 · ${shortDate(frames[baseIndex].at)} ${shortTime(frames[baseIndex].at)}`;
  $('current-label').textContent=`当前 · ${shortDate(cursor)} ${shortTime(cursor)}`;
  $('base-select').innerHTML=frames.slice(0,frameIndex+1).map((f,i)=>`<option value="${i}" ${i===baseIndex?'selected':''}>${escape(frameLabel(f,i))}</option>`).join('');
  $('target-select').innerHTML=frames.map((f,i)=>`<option value="${i}" ${i===frameIndex?'selected':''}>${escape(frameLabel(f,i))}</option>`).join('');
  renderEvents();renderBoards();renderInspector();renderTimeline();renderDiffSummary();syncURL();
  $('batch-button').disabled=!f.batch;
  $('batch-button').title=f.batch?`${r.receipt.type} · ${f.batch.batch_id}`:'暂无提交记录';
  if(transition) {
    const links=[...motionLinks(oldState,currentState),...(comparing?motionLinks(oldBase,baseState):[])];
    const contentChanged=!oldState||diffStates(oldState,currentState).changes.length>0||
      (comparing&&(!oldBase||diffStates(oldBase,baseState).changes.length>0));
    const options={...transition,links,contentChanged,duration:transitionDuration(transition.kind)};
    lastTransition={before,options};
    boardMotion.transition(before,options);
    if(boardMotion.inspect().plannedCount===0)lastTransition=null;
    animatePanels(previous,transition.kind);
  }
  updateMotionControls();
}
function breadcrumbs() {
  const nodes=[]; let item=layerId?getItem(currentState,layerId):null; const seen=new Set();
  while(item&&!seen.has(item.id)){seen.add(item.id);nodes.unshift(item);item=item.parent_id?getItem(currentState,item.parent_id):null;}
  return `${layerId?'<button class="rise-button" data-rise="true" aria-label="返回上一层" title="返回上一层（Esc）">↑</button>':''}<button data-layer="" ${!nodes.length?'aria-current="page"':''}>全部关注事项</button>`+nodes.map((n,i)=>`<span aria-hidden="true">/</span><button data-layer="${escape(n.id)}" ${i===nodes.length-1?'aria-current="page"':''}>${escape(n.title)}</button>`).join('');
}
function renderEvents() {
  const events=frames[frameIndex].events, initial=frames[frameIndex].phase==='initial';
  document.querySelector('.inputs-panel .panel-heading h2').textContent=initial?'原始输入':cursor>stamps[frameIndex]+60000?'最近一轮原始输入':'本轮原始输入';
  $('event-count').textContent=`${events.length} 条`;
  $('event-count').title=initial?'尚未进行过整理':`最近整理：${shortDate(frames[frameIndex].at)} ${shortTime(frames[frameIndex].at)}`;
  const shown=eventFilter==='used'?events.filter(e=>e.disposition==='used'):events;
  $('event-list').innerHTML=shown.length?shown.map(e=>`<article class="event-item ${selected.type==='event'&&selected.id===e.id?'is-selected':''}" data-verdict="${e.disposition}"><button class="event-open" data-event="${escape(e.id)}"><span class="event-meta"><span class="channel-tag">${escape(e.channel)}</span><span>${escape(e.from)}</span><time>${shortTime(e.at||frames[frameIndex].at)}</time></span><span class="event-text">${escape(e.text)}</span><span class="event-verdict"><span class="verdict-tag">${verdicts[e.disposition]||e.disposition}</span><span>${escape(e.why)}</span></span></button>${e.relatedIds?.length?`<div class="event-links">${e.relatedIds.map(id=>getItem(currentState,id)?button(id,escape(getItem(currentState,id).title)): '').join('')}</div>`:''}</article>`).join(''):`<div class="empty-detail">${events.length?'本轮暂无被采用的输入。':'本轮暂无原始输入。'}</div>`;
  for(const name of ['all','used']){$(`${name}-events`).classList.toggle('is-active',eventFilter===name);$(`${name}-events`).setAttribute('aria-pressed',String(eventFilter===name));}
  if(initial)$('event-list').innerHTML='<div class="initial-input"><span class="empty-input-mark" aria-hidden="true">↘</span><h3>暂无原始输入</h3><p>当前尚未发生整理。点击播放或前进，查看首批输入。</p></div>';
}
function renderBoards() {
  const focused=document.activeElement;
  const focusBoard=focused.closest?.('.pinboard');
  const focusField=focused.dataset?.dive?'dive':'item';
  const focusId=focused.dataset?.[focusField];
  const workspace=$('workspace');
  if(innerWidth>=1000) {
    const offset=$('current-board').getBoundingClientRect().top-workspace.getBoundingClientRect().top+workspace.scrollTop;
    const height=Math.max(comparing?180:230,Math.min(520,Math.floor(workspace.clientHeight-offset-50)));
    $('current-board').style.height=`${height}px`;$('base-board').style.height=`${height}px`;
  } else {$('current-board').style.height='';$('base-board').style.height='';}
  drawBoard($('current-board'),currentState,false);
  if(comparing)drawBoard($('base-board'),baseState,true);
  const items=visibleLayer(currentState).items||[];
  $('compact-items').hidden=items.length===0;
  $('compact-items').innerHTML=items.map((item,i)=>`<button class="item-key ${selected.id===item.id?'is-selected':''}" data-item="${escape(item.id)}"><span class="item-dot" data-color="${colorFor(item,currentState)}"></span><span>${escape(item.title)}</span><span class="mono">${item.share}</span>${item.children?.items?.length?`<span class="sub-count">↳ ${item.children.items.length}</span>`:''}</button>`).join('');
  if(focusBoard&&focusId)focusBoard.querySelector(`[data-${focusField}="${CSS.escape(focusId)}"]`)?.focus({preventScroll:true});
  boardSizes=currentBoardSizes();
}
function drawBoard(el,state,isBase) {
  const layer=visibleLayer(state), w=el.clientWidth,h=el.clientHeight;
  if(!w||!h)return;
  const layouts=layoutTreemap(layer.items,layer.budget,w,h);
  const changes=new Map((comparing?currentDiff.changes:records[frameIndex].diff.changes).map(c=>[c.item,c]));
  el.innerHTML=layouts.map(rect=>{
    const style=`left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
    if(rect.isBlank) {
      const initial=state.event_seq===0&&!layerId;
      return `<div class="pin-tile is-blank ${initial?'is-initial':''} ${(rect.width<120||rect.height<75)?'is-small':''}" style="${style}" data-share="${rect.share}"><div>${initial?`<span class="empty-board-label">暂无事项</span><strong>64 <small>份未分配</small></strong><p>收到输入并完成整理后，相关事项显示在这里。</p>${!isBase&&!comparing?'<button class="cold-start-button" data-frame="1">查看首批输入 <span aria-hidden="true">→</span></button>':''}`:`<span class="blank-label">未分配</span><strong>${rect.share}</strong><small>份可分配</small>`}</div></div>`;
    }
    const item=getItem(state,rect.id); const small=rect.width<145||rect.height<128, tiny=rect.width<90||rect.height<64;
    const changed=(comparing||frameIndex>0)&&changes.has(item.id), n=item.children?.items?.length||0;
    return `<div class="pin-tile ${small?'is-small':''} ${tiny?'is-tiny':''} ${selected.type==='item'&&selected.id===item.id?'is-selected':''} ${changed?'is-changed':''}" data-id="${escape(item.id)}" data-color="${colorFor(item,state)}" data-share="${item.share}" style="${style}"><button class="tile-button" data-item="${escape(item.id)}" ${isBase?'data-origin="base"':''} aria-label="${escape(item.title)}，份额 ${item.share}，${kinds[item.kind]||item.kind}${n?`，${n} 个子项`:''}"><span class="tile-top"><span class="tile-kind">${kinds[item.kind]||escape(item.kind)}</span><span class="tile-share">${item.share}<small> / ${layer.budget}</small></span></span><h3>${escape(item.title)}</h3><p class="tile-summary">${escape(item.summary)}</p><span class="tile-footer"><span class="tile-id">${changed?`<span class="change-label">${changeNames[changes.get(item.id).type]||'变化'}</span>`:escape(categoryLabel(item,state))}</span>${n?`<span class="children-hint">${n} 个子项</span>`:''}</span></button>${n?`<button class="dive-button" data-dive="${escape(item.id)}" ${isBase?'data-origin="base"':''} aria-label="进入${escape(item.title)}子层" title="进入子层">↗</button>`:''}</div>`;
  }).join('');
}
function renderDiffSummary() {
  $('diff-summary').hidden=!comparing;
  if(!comparing)return;
  const changes=currentDiff.changes;
  $('diff-summary').innerHTML=`<div class="panel-heading"><h3>状态差异</h3><button id="diff-json-button">Diff JSON ↗</button></div>${changes.length?`<div class="diff-list">${changes.map(c=>{const item=getItem(currentState,c.item)||getItem(baseState,c.item);return `<button class="diff-entry" data-item="${escape(c.item)}"><span class="diff-type" data-type="${c.type}">${changeNames[c.type]||c.type}</span><strong>${escape(item?.title||c.item)}</strong><span class="diff-values">${(c.fields||[]).map(f=>fieldNames[f]||f).join('、')}</span>${c.before?.share!==c.after?.share?`<span class="mono">${c.before?.share??'∅'} → ${c.after?.share??'∅'}</span>`:''}</button>`;}).join('')}</div>`:'<p class="empty-diff">业务状态无变化，份额保持不变。</p>'}<p class="diff-caption">比较端点的内容、结构与反馈；两端使用同一 now。撤下项保留在这里，不占当前面积。</p>`;
}
function section(title,content) {return `<section class="detail-section"><h3>${title}</h3>${content}</section>`;}
function scalarChanges(change) {
  const format=(field,value)=>value==null?'未设置':field==='kind'?kinds[value]||value:field==='status'?statuses[value]||value:field==='weight'?weights[value]||value:['due_at','stale_after'].includes(field)?`${shortDate(value)} ${shortTime(value)}`:value;
  const fields=(change.fields||[]).filter(f=>['weight','share','kind','status','due_at','stale_after','merged_into'].includes(f));
  return fields.length?`<dl class="change-facts">${fields.map(f=>`<div><dt>${fieldNames[f]}</dt><dd><span>${escape(format(f,change.before?.[f]))}</span><span aria-hidden="true"> → </span><strong>${escape(format(f,change.after?.[f]))}</strong></dd></div>`).join('')}</dl>`:'';
}
function findEvent(id) {for(const f of frames){const e=f.events.find(e=>e.id===id);if(e)return e;}return null;}
function renderInspector() {
  let title,eyebrow,content,obj;
  if(selected.type==='item') {
    const state=selected.origin==='base'?baseState:currentState;
    const item=getItem(state,selected.id);
    title=item.title;eyebrow=`${categoryLabel(item,state)} · ${item.id}`;obj=item;
    const anns=annotationsFor(item,state),children=item.children?.items||[];
    content=`<div class="detail-status"><span class="kind-badge">${kinds[item.kind]||escape(item.kind)}</span><span>${statuses[item.status]||item.status}</span>${selected.origin==='base'?'<span>基线内容</span>':''}</div><p class="detail-summary">${escape(item.summary)}</p><div class="stat-pair"><div><span>关注份额</span><strong>${item.share}<small> / 64</small></strong></div><div><span>权重</span><strong class="weight-value">${weights[item.weight]||item.weight}<small>${item.weight}</small></strong></div></div>`;
    if(item.reason)content+=section('关注原因',`<p>${escape(item.reason)}</p>`);
    if(item.merged_into)content+=section('已合并到',button(item.merged_into,escape(getItem(currentState,item.merged_into)?.title||item.merged_into)));
    if(children.length)content+=section(`子事项 · ${children.length}`,`<div class="children-list">${children.map(c=>`<div class="child-row">${button(c.id,`<span>${escape(c.title)}</span><small>${kinds[c.kind]||c.kind} · ${c.share} 份</small>`)}${c.children?.items?.length?`<button data-dive="${escape(c.id)}" aria-label="进入${escape(c.title)}子层">↗</button>`:''}</div>`).join('')}</div><button class="text-button" data-dive="${escape(item.id)}">查看子事项概览 ↗</button>`);
    content+=section('时间信息',`<dl class="detail-times"><div><dt>首次纳入</dt><dd>${shortDate(item.created_at)} ${shortTime(item.created_at)}</dd></div><div><dt>距资料更新</dt><dd>${relative(item.since_update)}</dd></div>${item.due_at?`<div><dt>距截止</dt><dd>${relative(item.until_due)}</dd></div>`:''}${item.stale_after?`<div><dt>参考有效期</dt><dd>${relative(item.until_stale)}</dd></div>`:''}</dl>`);
    if(anns.length)content+=section(`用户反馈 · ${anns.length}`,anns.map(a=>`<div class="annotation-item"><div><strong>${escape(a.author)}</strong><span>${a.status==='acknowledged'?'已纳入整理':'待确认'}</span></div><p>${escape(a.text)}</p><small>${a.acknowledged_revision||a.bound_to||a.first_acknowledged_revision||''}</small></div>`).join(''));
    if(item.sources?.length)content+=section(`原始依据 · ${item.sources.length}`,`<div class="source-list">${item.sources.map(source=>{const event=source.ref?.startsWith('event:')?findEvent(source.ref.slice(6)):null;return `<div class="source-item"><div class="event-meta"><span>${escape(source.channel)}</span><span>${escape(source.author||event?.from)}</span></div><p>${escape(source.content||event?.text||source.ref)}</p>${event?`<button class="text-button" data-event="${escape(event.id)}">查看原消息 ↗</button>`:/^https:\/\//.test(source.ref||'')?`<a href="${escape(source.ref)}" target="_blank" rel="noreferrer">打开来源 ↗</a>`:''}</div>`;}).join('')}</div>`);
    const changes=comparing?currentDiff.changes.filter(c=>c.item===item.id):records[frameIndex].diff.changes.filter(c=>c.item===item.id);
    if(changes.length)content+=section(comparing?'与基线相比':'本轮变化',changes.map(c=>`<div class="field-change"><strong>${changeNames[c.type]||c.type}</strong><span>${(c.fields||[]).map(f=>fieldNames[f]||f).join('、')}</span>${scalarChanges(c)}${c.before?.summary&&c.before.summary!==c.after?.summary?`<div class="before-after"><div><small>之前</small><p>${escape(c.before.summary)}</p></div><div><small>之后</small><p>${escape(c.after?.summary||'已退出当前关注')}</p></div></div>`:''}</div>`).join(''));
    const history=records.filter(r=>r.index<=frameIndex&&r.diff.changes.some(c=>c.item===item.id));
    if(history.length)content+=section('事项变化记录',history.map(r=>`<button class="history-row" data-frame="${r.index}"><time>${shortDate(r.frame.at)} ${shortTime(r.frame.at)}</time><span>${escape(r.frame.title)}</span></button>`).join(''));
  } else if(selected.type==='event') {
    const e=findEvent(selected.id);if(!e){selected={type:'state'};return renderInspector();}
    title=e.from;eyebrow=`原始输入 · ${e.channel}`;obj=e;
    content=`<div class="detail-status"><span>${shortDate(e.at)} ${shortTime(e.at)}</span><span class="verdict-tag">${verdicts[e.disposition]}</span></div><blockquote class="message-quote">${escape(e.text)}</blockquote>${section('输入处理原因',`<p>${escape(e.why)}</p>`)}${e.relatedIds?.length?section('关联事项',e.relatedIds.map(id=>button(id,escape(getItem(currentState,id)?.title||id))).join('')):''}`;
    const source=scenario.publicSources?.find(s=>s.id===e.publicSourceId);
    if(source)content+=section('公开事实与出处',`<p>${escape(source.fact)}</p><a href="${escape(source.url)}" target="_blank" rel="noreferrer">${escape(source.title)} ↗</a>`);
  } else if(selected.type==='batch') {
    title='批次声明与回执';eyebrow=frames[frameIndex].batch.batch_id;obj={request:frames[frameIndex].batch,receipt:records[frameIndex].receipt};
    content=`<p class="detail-summary">${escape(frames[frameIndex].narrative)}</p>${section('本轮提交结果',`<dl class="detail-times"><div><dt>输入消息</dt><dd>${frames[frameIndex].events.length} 条</dd></div><div><dt>声明</dt><dd>${frames[frameIndex].batch.declarations.length} 条</dd></div><div><dt>确认反馈</dt><dd>${frames[frameIndex].batch.acknowledges?.length||0} 条</dd></div><div><dt>结果</dt><dd>${records[frameIndex].receipt.type}</dd></div><div><dt>状态版本</dt><dd>${currentState.revision}</dd></div></dl>`)}<p class="detail-note">本原型使用编排好的 Agent 判断。切到原始 JSON，可以核对实际参与回放的声明。</p>`;
  } else if(selected.type==='diff') {
    title='状态差异';eyebrow=`${baseState.revision} → ${currentState.revision}`;obj=currentDiff;
    content=`<p class="detail-summary">${currentDiff.changes.length} 项语义变化。位置、经过时间和派生排序不单独制造差异。</p>${currentDiff.changes.map(c=>section(`${changeNames[c.type]} · ${getItem(currentState,c.item)?.title||getItem(baseState,c.item)?.title||c.item}`,`<p>${(c.fields||[]).map(f=>fieldNames[f]||f).join('、')}</p>${button(c.item,'查看事项 ↗')}`)).join('')}`;
  } else {
    title='当前完整状态';eyebrow=`第 ${frameIndex+1} 帧 · ${currentState.revision}`;obj=currentState;
    const pending=(currentState.annotations||[]).filter(a=>a.status!=='acknowledged');
    content=`<p class="detail-summary">${escape(frames[frameIndex].narrative)}</p><div class="stat-pair"><div><span>当前关注</span><strong>${currentState.root.items.length}<small> 项</small></strong></div><div><span>根层留白</span><strong>${currentState.root.budget-currentState.root.used}<small> / ${currentState.root.budget}</small></strong></div></div>${section('查看说明','<p>左侧是本轮原始输入，中间是整理后的事项状态。点击事项查看依据；点击子层按钮查看子事项。</p><p>拖动下方时间轴回到任何时刻，或比较前后两个状态。</p>')}`;
    if(pending.length)content+=section(`待确认的用户反馈 · ${pending.length}`,pending.map(a=>`<div class="annotation-item"><p>${escape(a.text)}</p>${button(a.item||a.item_id,'查看关联事项 ↗')}</div>`).join(''));
    if(currentState.root.items.length)content+=section('全部顶层事项',currentState.root.items.map(i=>`<div class="child-row">${button(i.id,`<span>${escape(i.title)}</span><small>${kinds[i.kind]} · ${i.share} 份</small>`)}</div>`).join(''));
    const historical=currentState.historical||[];
    if(historical.length)content+=section(`历史事项 · ${historical.length}`,`<details><summary>已撤下与已合并事项</summary>${historical.map(i=>`<div class="child-row">${button(i.id,`<span>${escape(i.title)}</span><small>${statuses[i.status]}</small>`)}</div>`).join('')}</details>`);
    content+='<p class="detail-note">概览只辅助定位，完整 state 才是核对依据。切到「原始 JSON」查看此刻的全部读取视图。</p>';
    if(frames[frameIndex].phase==='initial') {
      title='初始状态：暂无事项';eyebrow='初始状态 · r0 / e0';
      content='<p class="detail-summary">暂无事项、来源或用户反馈，尚未发生提交。</p>'+section('当前计数','<dl class="detail-times"><div><dt>当前条目</dt><dd>0 项</dd></div><div><dt>已分配份额</dt><dd>0 / 64</dd></div><div><dt>事件记录</dt><dd>0 条</dd></div></dl>')+section('查看后续输入','<p>点击「查看首批输入」或播放，逐步查看消息与整理结果。</p><p>每次整理后，可查看事项、份额、子层和原始依据。</p>')+'<p class="detail-note">切到原始 JSON，可以核对当前初始状态。</p>';
    }
  }
  inspectedJSON=obj;
  $('inspector-title').textContent=title;
  $('inspector-eyebrow').textContent=eyebrow;
  $('detail-tab').classList.toggle('is-active',detailMode==='detail');$('json-tab').classList.toggle('is-active',detailMode==='json');
  $('detail-tab').setAttribute('aria-selected',String(detailMode==='detail'));$('json-tab').setAttribute('aria-selected',String(detailMode==='json'));
  $('detail-tab').tabIndex=detailMode==='detail'?0:-1;$('json-tab').tabIndex=detailMode==='json'?0:-1;
  $('inspector-body').setAttribute('aria-labelledby',detailMode==='detail'?'detail-tab':'json-tab');
  $('inspector-body').innerHTML=detailMode==='json'?`<div class="json-heading"><span>只读 · 与画布同一时刻</span><button id="download-json">下载 JSON ↓</button></div><pre class="json-view"><code>${highlightJSON(obj)}</code></pre>`:content;
}
function highlightJSON(obj) {
  return escape(json(obj)).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?\b)/g,(m,str,key,literal,num)=>str?`<span class="${key?'json-key':'json-string'}">${str}</span>${key||''}`:literal?`<span class="json-literal">${literal}</span>`:`<span class="json-number">${num}</span>`);
}
function renderTimeline() {
  $('time-slider').value=cursor;$('time-slider').style.setProperty('--progress',`${100*(cursor-start)/(end-start)}%`);
  $('cursor-date').textContent=shortDate(cursor);$('cursor-time').textContent=shortTime(cursor);
  $('time-slider').setAttribute('aria-valuetext',`${shortDate(cursor)} ${shortTime(cursor)}，${frames[frameIndex].title}`);
  $('between-note').textContent=frames[frameIndex].phase==='initial'?'初始状态：暂无事项':cursor>stamps[frameIndex]+60000?'无新整理，状态保持不变':'';
  $('frame-count').textContent=`${String(frameIndex+1).padStart(2,'0')} / ${frames.length}`;
  $('previous-frame').disabled=frameIndex===0;$('next-frame').disabled=frameIndex===frames.length-1;
  document.querySelectorAll('.timeline-marker').forEach(b=>{b.classList.toggle('is-current',Number(b.dataset.frame)===frameIndex);b.classList.toggle('is-past',Number(b.dataset.frame)<frameIndex);});
  document.querySelectorAll('.chapter-button').forEach(b=>b.classList.toggle('is-active',b.dataset.chapter===frames[frameIndex].chapter));
}
function pause() {if(timer){clearInterval(timer);timer=null;}updatePlayButton();}
function play() {
  if(timer){pause();return;}
  if(frameIndex===frames.length-1)setCursor(start);
  const movingTime=matchMedia('(prefers-reduced-motion: reduce)').matches?0:transitionDuration('frame');
  const interval=movingTime+Math.max(2200,2900/Number($('playback-speed').value));
  timer=setInterval(()=>{if(frameIndex>=frames.length-1){pause();return;}setCursor(stamps[frameIndex+1]);if(frameIndex===frames.length-1)pause();},interval);updatePlayButton();
}
function updatePlayButton() {$('play-button').innerHTML=timer?'<span aria-hidden="true">Ⅱ</span><span>暂停</span>':'<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m6 3 11 7-11 7Z" fill="currentColor"/></svg><span>播放</span>';$('play-button').setAttribute('aria-label',timer?'暂停回放':'开始回放');}
function showInspector() {
  const inspector=document.querySelector('.inspector');
  inspector.scrollTop=0;
  $('inspector-title').focus({preventScroll:true});
  if(matchMedia('(max-width: 759px)').matches)inspector.scrollIntoView({block:'start',behavior:'instant'});
}
function select(type,id,origin) {pause();selected={type,id,origin};detailMode='detail';render();showInspector();}
function toast(message) {$('toast').textContent=message;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,2200);}
function focusLayer() {$('breadcrumbs').querySelector('[aria-current="page"]')?.focus({preventScroll:true});}
function layerPath(id) {
  const path=[],seen=new Set();
  let item=id&&(getItem(currentState,id)||getItem(baseState,id));
  while(item&&!seen.has(item.id)){seen.add(item.id);path.unshift(item.id);item=item.parent_id&&(getItem(currentState,item.parent_id)||getItem(baseState,item.parent_id));}
  return path;
}
function changeLayer(id,origin) {
  pause();if(id===layerId)return;
  const oldPath=layerPath(layerId), nextPath=layerPath(id);
  const rising=!id||oldPath.includes(id);
  const kind=rising?'rise':(!layerId||nextPath.includes(layerId))?'dive':'layout';
  const anchorId=rising?oldPath[nextPath.length]:nextPath[oldPath.length];
  layerId=id;
  selected={type:'item',id:rising?anchorId:id,origin};
  if(!selected.id)selected={type:'state'};
  detailMode='detail';render({kind,anchorId});focusLayer();
}
function dive(id,origin) {changeLayer(id,origin);}
function rise() {changeLayer(layerPath(layerId).at(-2)||null);}
$('story-subtitle').textContent=scenario.subtitle||'查看事项、原始依据与两周内的状态变化。';
$('story-meta').innerHTML=`<strong>${escape(scenario.persona.name)}</strong><span>${escape(scenario.persona.role)}</span><small>${shortDate(start)} 至 ${shortDate(end)}</small>`;
$('story-drawer').innerHTML=`<div><span class="eyebrow">演示说明</span><h2>${escape(scenario.title)}</h2><p>${escape(scenario.persona.context)}</p><p>这是作者编排的演示人物与私人消息，假设 Agent 已经作出了合适的整理判断。它检验状态演变与阅读体验，不评估真实模型能力。</p></div><div><h3>公开资料来源</h3>${(scenario.publicSources||[]).map(s=>`<a href="${escape(s.url)}" target="_blank" rel="noreferrer">${escape(s.title)} ↗</a><p>${escape(s.usedFor||s.fact)}</p>`).join('')}</div>`;
$('time-slider').min=start;$('time-slider').max=end;$('time-slider').step=60000;
$('timeline-markers').innerHTML=frames.map((f,i)=>`<button class="timeline-marker" style="left:${100*(stamps[i]-start)/(end-start)}%" data-frame="${i}" title="${escape(frameLabel(f,i))}" aria-label="跳转到${escape(frameLabel(f,i))}"><span></span></button>`).join('');
const dayCount=Math.floor((end-start)/86400000);
const labelTimes=Array.from({length:dayCount+1},(_,i)=>start+i*86400000);
labelTimes[labelTimes.length-1]=end;
$('day-labels').innerHTML=labelTimes.map(t=>`<span style="left:${100*(t-start)/(end-start)}%">${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}).format(t)}</span>`).join('');
$('chapter-list').innerHTML=scenario.chapters.map((c,i)=>`<button class="chapter-button" title="${escape(c.title)}" data-chapter="${escape(c.id)}" data-frame="${frames.findIndex(f=>f.chapter===c.id)}"><span>${String(i+1).padStart(2,'0')}</span>${escape(c.title.split('·').at(-1).trim())}</button>`).join('');
$('play-button').onclick=play;$('previous-frame').onclick=()=>goFrame(frameIndex-1);$('next-frame').onclick=()=>goFrame(frameIndex+1);$('restart-button').onclick=()=>goFrame(0);
$('playback-speed').onchange=()=>{if(timer){pause();play();}};
$('time-slider').oninput=e=>{pause();setCursor(Number(e.target.value));};
$('base-select').onchange=e=>{pause();baseIndex=Number(e.target.value);render({kind:'frame'});};
$('target-select').onchange=e=>goFrame(Number(e.target.value));
$('compare-button').onclick=()=>{pause();comparing=!comparing;if(comparing)baseIndex=Math.max(0,frameIndex-1);render({kind:'layout'});};
$('close-compare').onclick=()=>{comparing=false;render({kind:'layout'});};
$('replay-motion').onclick=replayMotion;
$('slow-motion').onclick=()=>{slowMotion=!slowMotion;updateMotionControls();if(lastTransition)replayMotion();};
$('all-events').onclick=()=>{eventFilter='all';renderEvents();};$('used-events').onclick=()=>{eventFilter='used';renderEvents();};
$('batch-button').onclick=()=>{if(frames[frameIndex].batch)select('batch');};
$('full-state-button').onclick=()=>{pause();selected={type:'state'};detailMode='json';render();showInspector();};
$('close-detail').onclick=()=>select('state');
$('detail-tab').onclick=()=>{detailMode='detail';renderInspector();};$('json-tab').onclick=()=>{detailMode='json';renderInspector();};
$('story-button').onclick=()=>{const open=$('story-drawer').hidden;$('story-drawer').hidden=!open;$('story-button').setAttribute('aria-expanded',String(open));};
$('copy-json').onclick=async()=>{try{await navigator.clipboard.writeText(json(inspectedJSON));toast('JSON 已复制');}catch{toast('复制受浏览器限制，请用「下载 JSON」');detailMode='json';renderInspector();}};
document.addEventListener('click',e=>{
  if(!$('story-drawer').hidden&&!$('story-drawer').contains(e.target)&&!$('story-button').contains(e.target)){$('story-drawer').hidden=true;$('story-button').setAttribute('aria-expanded','false');}
  const target=e.target.closest('button');if(!target)return;
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
  if(e.key===' '&&!e.target.matches('button,a')){e.preventDefault();play();}
  if(e.key==='ArrowLeft'){e.preventDefault();goFrame(frameIndex-1);}
  if(e.key==='ArrowRight'){e.preventDefault();goFrame(frameIndex+1);}
  if(e.key==='Escape'){pause();if(layerId){rise();}else{selected={type:'state'};detailMode='detail';render();focusLayer();}}
});
let resizeFrame;
const boardResizeObserver=new ResizeObserver(()=>{
  cancelAnimationFrame(resizeFrame);
  resizeFrame=requestAnimationFrame(()=>{
    if(currentBoardSizes()===boardSizes)return;
    boardMotion.cancel('resize');lastTransition=null;renderBoards();updateMotionControls();
  });
});
boardResizeObserver.observe($('boards-wrap'));
boardResizeObserver.observe($('workspace'));
window.addEventListener('scroll',event=>{
  if(event.target===document || event.target===$('workspace')) {
    lastTransition=null;updateMotionControls();
  }
},{capture:true,passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();boardMotion.cancel('hidden');}});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{
  panelAnimations.forEach(animation=>animation.cancel());panelAnimations=[];
  updateMotionControls();
});
render();
// Read-only hooks for browser verification, not part of the Fold product API.
window.foldPrototype={scenario,records,get state(){return currentState;},get cursor(){return cursor;},goFrame,setCursor,getDiff:()=>currentDiff,motion:()=>boardMotion.inspect()};
