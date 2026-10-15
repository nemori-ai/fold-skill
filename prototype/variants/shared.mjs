import { scenario, notice } from '../scenario.mjs?v=feedback-loop-1';
import { replayScenario, projectState, getItem, diffStates } from '../engine.mjs?v=feedback-loop-1';

// All three visual experiments read the same replay. Only their encoding differs.
export { scenario, notice, getItem };
/** How the forms name the person: a short given name when the dataset has one. */
export const personName = scenario.persona?.short || scenario.persona?.name || '你';
export const records = replayScenario(scenario);
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const kindLabel = {'needs-you':'需要你','in-progress':'进行中',done:'已完成',fyi:'知会'};
export const statusLabel = {active:'当前关注',withdrawn:'已撤下',merged:'已合并'};
const dates = new Intl.DateTimeFormat('zh-CN',{timeZone:scenario.timeZone||'Asia/Shanghai',month:'numeric',day:'numeric',weekday:'short'});
const times = new Intl.DateTimeFormat('zh-CN',{timeZone:scenario.timeZone||'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
export const formatDate = value => dates.format(new Date(value));
export const formatTime = value => times.format(new Date(value));
export function allItems(state) {
  if(!state)return [];
  const result=[];
  const walk=layer=>{for(const item of layer?.items||[]){result.push(item);walk(item.children);}};
  walk(state.root);result.push(...(state.historical||[]));return result;
}
export const getLayer=(state,id)=>id?(getItem(state,id)?.children||{budget:64,used:0,items:[]}):state.root;
const colors={sage:'#8cac91',blue:'#89aec4',sand:'#d3b477',clay:'#cd947a',lilac:'#b29cbb',mint:'#80b9ab'};
export function colorFor(item,state) {
  let node=item;const seen=new Set();
  while(node?.parent_id&&!seen.has(node.id)){seen.add(node.id);node=getItem(state,node.parent_id);}
  const id=node?.id||item?.id||'none';
  const category=scenario.categories?.[id];
  return colors[category?.colorKey]||Object.values(colors)[Math.abs([...id].reduce((n,c)=>n+c.charCodeAt(0),0))%6];
}
export function findEvent(id) {
  for(const frame of scenario.frames){const event=frame.events.find(e=>e.id===id);if(event)return event;}
  return null;
}
function itemPath(state,id) {
  const path=[],seen=new Set();let item=id&&getItem(state,id);
  while(item&&!seen.has(item.id)){seen.add(item.id);path.unshift(item);item=item.parent_id&&getItem(state,item.parent_id);}
  return path;
}
const esc=escapeHTML;
export function detailHTML(s,id) {
  const item=getItem(s.state,id)||getItem(s.baseState,id);
  if(!item)return '<p>未找到该事项，请选择其他事项。</p>';
  const anns=(s.state.annotations||[]).filter(a=>a.item===id||a.item_id===id||item.annotations?.includes(a.id));
  const sources=item.sources||[];
  const children=item.children?.items||[];
  return `<div class="shared-detail"><div class="shared-kicker">${kindLabel[item.kind]||item.kind} · ${item.share} / 64</div><h2>${esc(item.title)}</h2><p class="shared-summary">${esc(item.summary)}</p>${item.reason?`<section><h3>关注原因</h3><p>${esc(item.reason)}</p></section>`:''}${item.merged_into?`<p>已合并到 <button data-shared-select="${esc(item.merged_into)}">${esc(getItem(s.state,item.merged_into)?.title||item.merged_into)}</button></p>`:''}${children.length?`<section><h3>子事项</h3><div class="shared-children">${children.map(c=>`<button data-shared-select="${esc(c.id)}"><span>${esc(c.title)}</span><small>${c.share} 份 · ${kindLabel[c.kind]}</small></button>`).join('')}</div><button class="shared-link" data-shared-dive="${esc(item.id)}">查看子事项概览 ↗</button></section>`:''}${anns.length?`<section><h3>用户反馈</h3>${anns.map(a=>`<blockquote><p>${esc(a.text)}</p><footer>${esc(a.author||'用户')} · ${a.status==='acknowledged'?'已纳入整理':'等待处理确认'}</footer></blockquote>`).join('')}</section>`:''}${sources.length?`<section><h3>原始依据</h3>${sources.map(source=>{const e=source.ref?.startsWith('event:')?findEvent(source.ref.slice(6)):null;return `<article class="shared-source"><small>${esc(source.channel)} · ${esc(source.author||e?.from||'')}</small><p>${esc(source.quote||source.content||e?.text||source.ref)}</p>${/^https:\/\//.test(source.ref||'')?`<a href="${esc(source.ref)}" target="_blank" rel="noreferrer">打开原始来源 ↗</a>`:''}</article>`;}).join('')}</section>`:''}<details><summary>此事项的原始 JSON</summary><pre>${esc(JSON.stringify(item,null,2))}</pre></details></div>`;
}
export function inputHTML(s) {
  const labels={used:'采用',duplicate:'重复',noise:'噪音',deferred:'暂缓'};
  return s.frame.events.length?s.frame.events.map(e=>`<article class="shared-input"><div><small>${esc(e.channel)} · ${esc(e.from)} · ${formatTime(e.at)}</small><span>${labels[e.disposition]||e.disposition}</span></div><p>${esc(e.text)}</p><small>${esc(e.why)}</small></article>`).join(''):'<p>本轮暂无原始输入。</p>';
}

export function createModel(onChange=()=>{}) {
  const params=new URLSearchParams(location.search),frames=scenario.frames;
  const stamps=frames.map(f=>Date.parse(f.at));
  const start=stamps[0],end=Date.parse(scenario.endAt);
  let index=Math.min(frames.length-1,Math.max(0,Math.floor(Number(params.get('frame')??6))||0));
  let cursor=params.has('at')?Math.min(end,Math.max(start,Number(params.get('at'))||stamps[index])):stamps[index];
  index=stamps.reduce((last,t,i)=>t<=cursor?i:last,0);
  let layerId=params.get('layer')||null,selectedId=params.get('item')||null;
  let comparing=params.has('base'),baseIndex=comparing?Math.min(index,Math.max(0,Math.floor(Number(params.get('base')))||0)):Math.max(0,index-1);
  let timer=null,current,disposed=false;
  const subscribers=new Set();
  function build() {
    const now=new Date(cursor).toISOString();
    const state=projectState(records[index].snapshot,now);
    const previousState=projectState(records[Math.max(0,index-1)].snapshot,now);
    const baseState=projectState(records[baseIndex].snapshot,now);
    if(layerId&&!getItem(state,layerId)?.children)layerId=null;
    if(selectedId&&!getItem(state,selectedId)&&!getItem(baseState,selectedId))selectedId=null;
    return {scenario,frames,records,index,frame:frames[index],state,previousState,baseState,layerId,
      layer:getLayer(state,layerId),baseLayer:getLayer(baseState,layerId),selectedId,
      selectedItem:selectedId?(getItem(state,selectedId)||getItem(baseState,selectedId)):null,
      baseIndex,comparing,playing:Boolean(timer),now,cursor,start,end,path:itemPath(state,layerId),
      diff:diffStates(baseState,state),frameDiff:records[index].diff};
  }
  function emit(type,extra={}) {
    if(disposed)return;
    const previous=current;current=build();
    onChange(current);
    for(const fn of subscribers)fn(current,{type,previous,...extra});
  }
  function stop(){if(timer){clearInterval(timer);timer=null;}}
  function setCursor(time) {
    stop();cursor=Math.min(end,Math.max(start,Number(time)||start));
    index=stamps.reduce((last,t,i)=>t<=cursor?i:last,0);
    if(baseIndex>index)baseIndex=index;
    if(!comparing)baseIndex=Math.max(0,index-1);
    emit('frame');
  }
  const model={
    snapshot:()=>current,
    subscribe(fn){subscribers.add(fn);fn(current,{type:'init',previous:null});return()=>subscribers.delete(fn);},
    goFrame(i){setCursor(stamps[Math.max(0,Math.min(frames.length-1,Math.round(i)))]);},
    setCursor,
    select(id){stop();selectedId=id||null;emit('select');},
    dive(id){
      const item=getItem(current.state,id);if(!item?.children)return;
      stop();layerId=id;selectedId=null;emit('dive',{anchorId:id});
    },
    rise(){
      if(!layerId)return;
      stop();const anchorId=layerId;layerId=getItem(current.state,layerId)?.parent_id||null;
      selectedId=anchorId;emit('rise',{anchorId});
    },
    goRoot(){stop();const anchorId=current.path[0]?.id;layerId=null;selectedId=anchorId||null;emit('rise',{anchorId});},
    setBase(i){stop();baseIndex=Math.min(index,Math.max(0,Math.round(i)));comparing=true;emit('compare');},
    setCompare(value){stop();comparing=Boolean(value);if(comparing)baseIndex=Math.max(0,index-1);emit('compare');},
    togglePlay(){
      if(timer){stop();emit('play');return;}
      if(index===frames.length-1){cursor=start;index=0;baseIndex=0;}
      timer=setInterval(()=>{
        if(index===frames.length-1){stop();emit('play');return;}
        index+=1;cursor=stamps[index];if(!comparing)baseIndex=Math.max(0,index-1);
        if(index===frames.length-1)stop();emit('frame');
      },5600);
      emit('play');
    },
    pause(){if(timer){stop();emit('play');}},
    findEvent,
    dispose(){stop();disposed=true;subscribers.clear();},
  };
  current=build();return model;
}

// Host-side feedback records (docs/domain-model.md). An ask answers for one output
// version; a rewrite without a new ask means no feedback path is registered for it.
const askRegistries = (() => {
  const registry = new Map();
  return scenario.frames.map((frame, index) => {
    const state = projectState(records[index].snapshot, frame.at);
    for (const [id, value] of Object.entries(frame.asks || {})) {
      registry.set(id, { ...value, version: getItem(state, id)?.updated_at, frameIndex: index });
    }
    return new Map(registry);
  });
})();
export function currentAsk(s, id) {
  const entry = askRegistries[s.index]?.get(id), item = getItem(s.state, id);
  return entry && item && entry.version === item.updated_at ? entry : null;
}
export function feedbackTrail(s, id) {
  const trail = [];
  scenario.frames.slice(0, s.index + 1).forEach((frame, frameIndex) => {
    for (const event of frame.events) {
      const links = (event.feedback || []).filter(link => link.target === id);
      if (links.length || event.reminder?.target === id) trail.push({ event, links, frameIndex });
    }
  });
  return trail;
}

// The person's own moves in the family stream (authored, Swedish): the channel reads “app · who”,
// and call logs, reactions and payments carry `kind`. Returns the action without the subject
// (“用 iMessage 回复 Kajsa”“给诊所打了电话”), or null for other streams.
const FAMILY_APPS = { iMessage: ' iMessage ', SMS: '短信', WhatsApp: ' WhatsApp ', 'E-post': '邮件' };
const FAMILY_GROUPS = { Familjen: '家庭群', Syskon: '兄妹群', 'Föräldrar 6B': '6B 家长群', 'Kräftskiva 22/8 🦞': '派对群', 'Grannar Tallstigen': '街坊群' };
const FAMILY_NAMES = { Mamma: '母亲', 'Gunnel granne': '邻居 Gunnel', 'Djurkliniken Kvarnbacken': '诊所', 'Rörfixarna Söder': '水管工', Ekorren: '幼儿园老师' };
const familyName = who => FAMILY_NAMES[who] || ` ${who} `;
export function familyMove(event) {
  if (event?.stream !== 'family') return null;
  const [app, who = ''] = String(event.channel || '').split(' · ');
  const text = String(event.text || ''), group = FAMILY_GROUPS[who];
  const say = value => value.replace(/\s{2,}/g, ' ').trim();
  if (event.kind === 'call_log') return say(`给${familyName(text.match(/till (.+?) ·/)?.[1] || who)}打了电话`);
  if (event.kind === 'reaction') return say(group ? `在${group}里点了赞` : `给${familyName(who)}的消息点了赞`);
  if (event.kind === 'swish_sent') return '用 Swish 转了账';
  if (event.kind === 'screen_time_approved') return '批准了 Signe 的屏幕时间申请';
  if (event.kind === 'list_update') return '在购物清单上勾掉了几样';
  if (group) return `在${group}里回复`;
  if (app === 'Förskoleappen') return '在幼儿园 App 里回复老师';
  return say(`用${FAMILY_APPS[app] || ` ${app} `}回复${familyName(who)}`);
}
