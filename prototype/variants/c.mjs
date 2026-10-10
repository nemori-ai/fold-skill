import { makeSurface } from './c-surface.mjs?v=liquid-calm-1';
import { escapeHTML as esc, formatDate, formatTime, kindLabel, allItems, colorFor, detailHTML, inputHTML } from './shared.mjs?v=feedback-loop-1';

// A visual reading experiment. The liquid surface never writes to Fold state.
// Volume is a perceptual cue; the separate budget strip is the exact measure.
const LIMIT = 24;
const BRIDGE_LIMIT = 8;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const icon = name => ({play:'<path d="m7 4 10 6-10 6Z"/>',pause:'<path d="M6 4h3v12H6zm6 0h3v12h-3z"/>',left:'<path d="m12 4-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.5"/>',right:'<path d="m8 4 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.5"/>'}[name] || '');
const svg = name => `<svg viewBox="0 0 20 20" aria-hidden="true">${icon(name)}</svg>`;

function mergeLinks(before,after) {
  if(!before||!after)return [];
  const edges=new Map();
  for(const [source,target,reverse] of [[before,after,false],[after,before,true]]) {
    const targetItems=new Map(allItems(target).map(i=>[i.id,i]));
    for(const item of allItems(source).filter(i=>i.status==='active')) {
      let node=targetItems.get(item.id);const seen=new Set();
      while(node?.merged_into&&!seen.has(node.id)) {
        seen.add(node.id);node=targetItems.get(node.merged_into);
        if(node?.status==='active'){const edge=reverse?{from:node.id,to:item.id}:{from:item.id,to:node.id};edges.set(`${edge.from}:${edge.to}`,edge);break;}
      }
    }
  }
  return [...edges.values()];
}

function layout(items,width,height,memory) {
  const count=items.length;
  if(!count)return [];
  const load=items.reduce((sum,item)=>sum+item.share,0)/64;
  // A wide sheet lets a drop stretch sideways. The load changes how closely
  // the group fills its space; the budget strip remains the exact encoding.
  const layoutWidth=Math.min(width,height*2.3),stretch=width/layoutWidth;
  const padding=12,gap=7+12*(1-load);
  const coefficient=Math.sqrt(layoutWidth*height*(.50+.18*load)/Math.PI);
  const bodies=items.map((item,index)=>{
    const remembered=memory.get(item.id),angle=index*2.39996-1.9;
    const spread=count===1?0:Math.sqrt((index+.5)/count);
    return {id:item.id,item,r:coefficient*Math.sqrt(item.share/64),stretch,
      x:remembered?remembered.x*layoutWidth:layoutWidth*.5+Math.cos(angle)*layoutWidth*.26*spread,
      y:remembered?remembered.y*height:height*.49+Math.sin(angle)*height*.25*spread};
  });
  for(let attempt=0;attempt<10;attempt++) {
    for(let pass=0;pass<240;pass++) {
      const attraction=.013*(1-load);
      for(const body of bodies){body.x+=(layoutWidth/2-body.x)*attraction;body.y+=(height/2-body.y)*attraction;}
      for(let i=0;i<count;i++)for(let j=i+1;j<count;j++) {
        const a=bodies[i],b=bodies[j];let dx=b.x-a.x,dy=b.y-a.y;
        let distance=Math.hypot(dx,dy);
        if(distance<.01){dx=Math.cos(i+j);dy=Math.sin(i+j);distance=1;}
        const overlap=(a.r+b.r)*1.11+gap-distance;
        if(overlap>0){const amount=overlap*.8;const total=a.r*a.r+b.r*b.r;const aw=b.r*b.r/total,bw=1-aw;a.x-=dx/distance*amount*aw;a.y-=dy/distance*amount*aw;b.x+=dx/distance*amount*bw;b.y+=dy/distance*amount*bw;}
      }
      for(const body of bodies){body.x=clamp(body.x,padding+body.r*1.10,layoutWidth-padding-body.r*1.10);body.y=clamp(body.y,padding+body.r*1.06,height-padding-body.r*1.06);}
    }
    const collision=bodies.some((a,i)=>bodies.slice(i+1).some(b=>Math.hypot(a.x-b.x,a.y-b.y)<(a.r+b.r)*1.10+gap-2));
    if(!collision)break;
    bodies.forEach(b=>b.r*=.966);
  }
  for(const body of bodies){body.x*=stretch;memory.set(body.id,{x:body.x/width,y:body.y/height});}
  return bodies;
}

export function mount(host,model) {
  host.classList.add('variant-c');
  host.innerHTML=`<div class="c-shell">
    <header class="c-header"><a class="c-brand" href="./"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 5C10 1 22 3 24 10c2 7-3 16-11 15C5 24 0 11 5 5Z" fill="currentColor"/><path d="M9 6c5-2 10 0 11 3" fill="none" stroke="currentColor" stroke-width="2" opacity=".3"/></svg><span>Fold</span></a><span class="c-header-caption">事项回放</span><div class="c-header-actions"><button type="button" data-c-action="inputs">本轮输入 <span class="c-input-count"></span></button><button type="button" data-lab-inspect="state">完整状态 ↗</button></div></header>
    <section class="c-intro"><div class="c-date"></div><div class="c-title-row"><h1 class="c-title"></h1><span class="c-revision"></span></div><p class="c-narrative"></p></section>
    <section class="c-stage"><div class="c-scene-column"><nav class="c-path" aria-label="当前层级"></nav><div class="c-scene" aria-label="事项份额概览"><canvas class="c-canvas" aria-hidden="true"></canvas><svg class="c-leaders" aria-hidden="true"></svg><div class="c-labels"></div><div class="c-empty" hidden><span class="c-empty-mark" aria-hidden="true">·</span><h2>暂无事项</h2><p>当前尚未纳入任何事项。</p><button type="button" data-c-action="next">查看下一次整理 →</button></div><div class="c-fallback" hidden></div></div><div class="c-scene-caption"><span class="c-render-note">体量辅助比较，准确份额见下方。</span><button type="button" class="c-feedback" data-c-action="feedback" hidden></button></div></div><aside class="c-reading" aria-label="阅读事项" hidden><div class="c-reading-top"><span class="c-reading-kind">事项详情</span><button type="button" data-c-action="close" aria-label="关闭详情">×</button></div><div class="c-reading-content"></div></aside></section>
    <section class="c-footer"><div class="c-budget-heading"><span class="c-budget-title">当前层份额</span><span class="c-budget-values"></span></div><div class="c-budget-track" aria-label="准确份额分配"></div><div class="c-transport"><div class="c-playback"><button type="button" data-c-action="prev" aria-label="上一帧">${svg('left')}</button><button type="button" class="c-play" data-c-action="play" aria-label="播放回放">${svg('play')}<span>播放</span></button><button type="button" data-c-action="next" aria-label="下一帧">${svg('right')}</button></div><div class="c-time-current"></div><div class="c-range-wrap"><input class="c-range" type="range" min="0" max="36" step="1" value="0" aria-label="选择回放帧"><div class="c-range-labels"><span>10月12日</span><span>10月25日</span></div></div><span class="c-frame-count"></span></div><details class="c-all-items"><summary>全部事项 <span class="c-total"></span></summary><div class="c-item-list"></div></details></section>
  </div>`;
  const q=selector=>host.querySelector(selector);
  const sceneElement=q('.c-scene'),canvas=q('.c-canvas'),labelLayer=q('.c-labels'),leaderLayer=q('.c-leaders');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let snapshot=model.snapshot(),surface=null,failed=false,disposed=false,visible=true,width=1,height=1;
  let bodies=[],flight=null,raf=0,hoverId=null,mode='item',lastGeometryKey='',resizeFrame=0;
  let lastDraw=0,materialTime=0,labelsDirty=true;
  const memories=new Map(),labels=new Map(),ghostLabels=new Map();
  try{surface=makeSurface(canvas,LIMIT,BRIDGE_LIMIT);}catch(error){failed=true;console.info('Fold liquid view uses its readable fallback:',error.message);}

  function memoryFor(id){const key=id||'root';if(!memories.has(key))memories.set(key,new Map());return memories.get(key);}
  function sample(now=performance.now()) {
    if(!flight)return bodies;
    const raw=clamp((now-flight.start)/flight.duration,0,1),t=ease(raw);
    return flight.parts.map(part=>{
      const radius=lerp(part.from.r,part.to.r,t);
      const dx=part.from.x-part.to.x,dy=part.from.y-part.to.y,distance=Math.hypot(dx,dy);
      const velocity=raw<.5?12*raw*raw:12*(1-raw)*(1-raw);
      const lag=Math.min(radius*.38,distance*.075*velocity);
      const strain=(part.to.r-part.from.r)/Math.max(part.to.r,part.from.r,1)*Math.sin(Math.PI*raw);
      return{id:part.id,item:part.item,color:part.color,
        x:lerp(part.from.x,part.to.x,t),y:lerp(part.from.y,part.to.y,t),r:radius,
        flowX:dx/Math.max(distance,1)*lag,flowY:dy/Math.max(distance,1)*lag,strain,
        stretch:lerp(part.from.stretch||1,part.to.stretch||1,t),opacity:lerp(part.from.opacity,part.to.opacity,t)};
    });
  }
  function requestDraw(){if(!raf&&!disposed&&visible&&!document.hidden)raf=requestAnimationFrame(draw);}
  function draw(now) {
    raf=0;if(disposed||!visible||document.hidden)return;
    const moving=surface&&!failed&&!reduced.matches&&(bodies.length||flight);
    // The material has its own clock: 30 fps, paused offscreen/when hidden.
    // Reading labels are updated only for a real layout transition.
    if(moving&&lastDraw&&now-lastDraw<1000/30-1){requestDraw();return;}
    const delta=lastDraw?Math.min((now-lastDraw)/1000,.05):0;
    lastDraw=now;if(!reduced.matches)materialTime+=delta;
    const visual=sample(now);let t=1,bridges=[];
    if(flight){t=clamp((now-flight.start)/flight.duration,0,1);const map=new Map(visual.map(b=>[b.id,b]));bridges=flight.links.map(link=>{const a=map.get(link.from),b=map.get(link.to);if(!a||!b)return null;return{a,b,width:Math.min(a.r,b.r)*.34*Math.sin(Math.PI*t),color:b.color};}).filter(Boolean);}
    if(surface&&!failed)surface.draw(visual,bridges,snapshot.selectedId,hoverId,materialTime,{reducedMotion:reduced.matches});
    if(flight||labelsDirty){positionLabels(visual);labelsDirty=false;}
    if(flight&&t>=1){bodies=flight.targets;flight=null;clearGhostLabels();positionLabels(bodies);}
    if(flight||moving)requestDraw();
  }
  function positionLabels(visual) {
    const byId=new Map(visual.map(b=>[b.id,b]));const placed=[];const paths=[];
    const active=snapshot.layer.items.map(item=>byId.get(item.id)).filter(Boolean).sort((a,b)=>b.r-a.r);
    const mobileLabels=innerWidth<760,metrics=new Map();
    for(const b of active){
      const entry=labels.get(b.id);if(!entry)continue;
      const small=b.r<42,compact=b.r<76,labelWidth=small?118:clamp(b.r*1.7*(b.stretch||1),100,228);
      entry.el.classList.toggle('is-small',small);entry.el.classList.toggle('is-compact',compact);
      entry.el.style.width=`${labelWidth}px`;
      metrics.set(b.id,{small,compact,labelWidth});
    }
    for(const b of active) {
      const entry=labels.get(b.id);if(!entry)continue;
      const {small,compact,labelWidth}=metrics.get(b.id);
      const labelHeight=mobileLabels?entry.el.getBoundingClientRect().height:small?44:compact?58:86;
      let x=b.x,y=b.y;
      if(small){const outward=b.x<width*.5?-1:1;x+=outward*(b.r*(b.stretch||1)+37);y+=b.y<height*.5?-12:13;}
      x=clamp(x,labelWidth/2+8,width-labelWidth/2-8);y=clamp(y,labelHeight/2+8,height-labelHeight/2-8);
      if(small&&mobileLabels){
        // Find the nearest gap between the actual text boxes. Longer titles
        // must not inherit the old, fixed 44px collision estimate.
        const preferred={x,y},minX=labelWidth/2+8,maxX=width-labelWidth/2-8,minY=labelHeight/2+8,maxY=height-labelHeight/2-8;
        const xs=[x,b.x,minX,maxX,...placed.flatMap(r=>[r.x-(r.w+labelWidth)/2-7,r.x+(r.w+labelWidth)/2+7])];
        const ys=[y,b.y,minY,maxY,...placed.flatMap(r=>[r.y-(r.h+labelHeight)/2-7,r.y+(r.h+labelHeight)/2+7])];
        const crossesText=(candidate,r)=>{
          let first=0,last=1;
          for(const [start,end,low,high] of [[b.x,candidate.x,r.x-r.w/2-3,r.x+r.w/2+3],[b.y,candidate.y,r.y-r.h/2-3,r.y+r.h/2+3]]){
            const delta=end-start;
            if(Math.abs(delta)<.001){if(start<low||start>high)return false;continue;}
            const a=(low-start)/delta,z=(high-start)/delta;
            first=Math.max(first,Math.min(a,z));last=Math.min(last,Math.max(a,z));
            if(first>last)return false;
          }
          return true;
        };
        let best=null;
        for(const cx of xs)for(const cy of ys){
          const candidate={x:clamp(cx,minX,maxX),y:clamp(cy,minY,maxY)};
          if(placed.some(r=>Math.abs(candidate.x-r.x)<(labelWidth+r.w)/2+6&&Math.abs(candidate.y-r.y)<(labelHeight+r.h)/2+6))continue;
          const score=(candidate.x-preferred.x)**2+(candidate.y-preferred.y)**2+placed.filter(r=>crossesText(candidate,r)).length*width*height;
          if(!best||score<best.score)best={...candidate,score};
        }
        if(best){x=best.x;y=best.y;}
      }else if(small)for(let pass=0;pass<12;pass++){
        const overlap=placed.find(r=>Math.abs(x-r.x)<(labelWidth+r.w)/2+5&&Math.abs(y-r.y)<(labelHeight+r.h)/2+4);
        if(!overlap)break;
        y=clamp(y+(y<overlap.y?-1:1)*10,labelHeight/2+8,height-labelHeight/2-8);
        if(pass>7)x=clamp(x+(x<width/2?-1:1)*10,labelWidth/2+8,width-labelWidth/2-8);
      }
      placed.push({x,y,w:labelWidth,h:labelHeight});
      entry.el.style.transform=`translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
      entry.el.style.opacity=String(clamp(b.opacity,0,1));
      if(small&&b.opacity>.2){const dx=x-b.x,dy=y-b.y,d=Math.max(1,Math.hypot(dx,dy));const startX=b.x+dx/d*b.r*.75,startY=b.y+dy/d*b.r*.75;paths.push(`<path d="M${startX.toFixed(1)},${startY.toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)}"/>`);}
    }
    leaderLayer.innerHTML=paths.join('');
    const progress=flight?clamp((performance.now()-flight.start)/flight.duration,0,1):1;
    for(const [id,el] of ghostLabels){
      const body=byId.get(id);
      if(!body){el.remove();ghostLabels.delete(id);continue;}
      const small=body.r<42,compact=body.r<76;
      el.classList.toggle('is-small',small);el.classList.toggle('is-compact',compact);
      el.style.width=`${small?118:clamp(body.r*1.7*(body.stretch||1),100,228)}px`;
      el.style.transform=`translate3d(${body.x}px,${body.y}px,0) translate(-50%,-50%)`;
      el.style.opacity=String(clamp((.88-progress)/.32,0,1));
    }
  }
  function clearGhostLabels(){for(const el of ghostLabels.values())el.remove();ghostLabels.clear();}
  function syncLabels(s,meta) {
    labelsDirty=true;
    const ids=new Set(s.layer.items.map(i=>i.id));
    for(const [id,entry] of labels)if(!ids.has(id)){
      if(meta.type==='frame'&&!reduced.matches&&!failed){
        entry.el.classList.add('is-ghost');entry.el.setAttribute('aria-hidden','true');entry.el.inert=true;entry.el.removeAttribute('data-c-select');
        ghostLabels.get(id)?.remove();ghostLabels.set(id,entry.el);
      }else entry.el.remove();
      labels.delete(id);
    }
    for(const id of ids){ghostLabels.get(id)?.remove();ghostLabels.delete(id);}
    for(const item of s.layer.items){let entry=labels.get(item.id);if(!entry){const el=document.createElement('button');el.type='button';el.className='c-label';el.dataset.cSelect=item.id;labelLayer.append(el);entry={el,signature:''};labels.set(item.id,entry);}
      const signature=`${item.title}|${item.share}|${item.kind}|${item.children?.items.length||0}`;
      if(signature!==entry.signature){entry.el.innerHTML=`<span class="c-label-kind">${esc(kindLabel[item.kind]||item.kind)}</span><strong>${esc(item.title)}</strong><span class="c-label-meta"><span>${item.share}<small> / ${s.layer.budget}</small></span>${item.children?.items.length?`<span class="c-label-children">${item.children.items.length} 个子项</span>`:''}</span>`;entry.signature=signature;}
      entry.el.classList.toggle('is-selected',s.selectedId===item.id);entry.el.setAttribute('aria-pressed',String(s.selectedId===item.id));entry.el.setAttribute('aria-label',`${item.title}，${kindLabel[item.kind]||item.kind}，份额 ${item.share}，查看详情`);
    }
  }
  function arrange(s,meta={type:'resize'}) {
    const nextWidth=sceneElement.clientWidth,nextHeight=sceneElement.clientHeight;
    if(nextWidth<1||nextHeight<1)return;
    const oldVisual=sample(),oldMap=new Map(oldVisual.map(b=>[b.id,b]));
    const sizeChanged=nextWidth!==width||nextHeight!==height;
    width=nextWidth;height=nextHeight;
    if(sizeChanged){surface?.resize(width,height);leaderLayer.setAttribute('viewBox',`0 0 ${width} ${height}`);}
    const key=`${s.layerId||'root'}:${width}:${height}:${s.layer.items.map(i=>`${i.id}:${i.share}`).join('|')}`;
    if(key===lastGeometryKey&&meta.type!=='dive'&&meta.type!=='rise'){requestDraw();return;}
    lastGeometryKey=key;
    const memory=memoryFor(s.layerId);
    const links=meta.type==='frame'&&meta.previous?.layerId===s.layerId?mergeLinks(meta.previous.state,s.state):[];
    for(const item of s.layer.items)if(!memory.has(item.id)) {
      const sourceIds=links.filter(l=>l.to===item.id).map(l=>oldMap.get(l.from)).filter(Boolean);
      if(sourceIds.length){const total=sourceIds.reduce((n,b)=>n+b.r*b.r,0);memory.set(item.id,{x:sourceIds.reduce((n,b)=>n+b.x*b.r*b.r,0)/total/width,y:sourceIds.reduce((n,b)=>n+b.y*b.r*b.r,0)/total/height});}
    }
    const targets=layout(s.layer.items,width,height,memory).map(b=>({...b,color:colorFor(b.item,s.state),opacity:1}));
    if(failed||reduced.matches||meta.type==='init'){bodies=targets;flight=null;clearGhostLabels();requestDraw();return;}
    const nextMap=new Map(targets.map(b=>[b.id,b])),parts=[];
    const anchor=oldMap.get(meta.anchorId),newAnchor=nextMap.get(meta.anchorId);
    for(const target of targets){let from=oldMap.get(target.id);
      if(meta.type==='dive'&&anchor)from={...target,x:anchor.x+(target.x-width/2)*.06,y:anchor.y+(target.y-height/2)*.06,r:target.r*.13,opacity:0};
      else if(meta.type==='rise'&&newAnchor)from={...target,x:width/2+(target.x-newAnchor.x)*1.8,y:height/2+(target.y-newAnchor.y)*1.8,r:target.r*1.6,opacity:0};
      else if(!from){const sources=links.filter(l=>l.to===target.id).map(l=>oldMap.get(l.from)).filter(Boolean);from=sources.length?{...target,x:sources.reduce((n,b)=>n+b.x,0)/sources.length,y:sources.reduce((n,b)=>n+b.y,0)/sources.length,r:target.r*.28,opacity:0}:{...target,y:target.y+10,r:target.r*.22,opacity:0};}
      parts.push({id:target.id,item:target.item,color:target.color,from,to:target});
    }
    for(const old of oldVisual)if(!nextMap.has(old.id)){
      let to={...old,r:old.r*.16,opacity:0};
      const target=nextMap.get(links.find(l=>l.from===old.id)?.to);
      if(target)to={...to,x:target.x,y:target.y};
      else if(meta.type==='dive'){to={...to,x:width/2+(old.x-(anchor?.x||width/2))*2.7,y:height/2+(old.y-(anchor?.y||height/2))*2.7};if(old.id===meta.anchorId)to={...to,x:width/2,y:height/2,r:Math.max(width,height)*.65};}
      else if(meta.type==='rise'&&newAnchor)to={...to,x:newAnchor.x,y:newAnchor.y,r:old.r*.12};
      parts.push({id:old.id,item:old.item,color:old.color,from:old,to});
    }
    flight={parts:parts.slice(0,LIMIT),targets,links,start:performance.now(),duration:meta.type==='resize'?420:meta.type==='dive'||meta.type==='rise'?1900:1700};
    requestDraw();
  }
  function renderReading(s) {
    const reading=q('.c-reading'),content=q('.c-reading-content');
    const show=mode!=='item'||Boolean(s.selectedItem);reading.hidden=!show;q('.c-stage').classList.toggle('has-reading',show);
    if(!show)return;
    const signature=mode==='item'?`${s.selectedId}:${s.state.event_seq}:${s.now}`:`${mode}:${s.state.event_seq}:${s.index}`;
    if(content.dataset.signature===signature)return;
    content.dataset.signature=signature;
    if(mode==='inputs'){q('.c-reading-kind').textContent='原始输入';content.innerHTML=`<h2>本轮输入</h2><p class="c-reading-intro">本轮收到 ${s.frame.events.length} 条原始输入。</p>${inputHTML(s)}`;}
    else if(mode==='feedback'){q('.c-reading-kind').textContent='反馈状态';const pending=(s.state.annotations||[]).filter(a=>a.status==='saved');content.innerHTML=`<h2>待确认反馈</h2>${pending.length?pending.map(a=>`<blockquote><p>${esc(a.text)}</p><footer>${esc(a.author||'用户')}</footer><button type="button" data-c-select="${esc(a.item||a.item_id)}">查看对应事项 ↗</button></blockquote>`).join(''):'<p>暂无待确认反馈。</p>'}`;}
    else{q('.c-reading-kind').textContent='事项详情';content.innerHTML=detailHTML(s,s.selectedId);}
  }
  function render(s,meta) {
    snapshot=s;
    if(meta.type==='select')mode='item';
    if(meta.type==='dive')mode='item';
    q('.c-date').textContent=`${formatDate(s.now)} · ${formatTime(s.now)}`;
    q('.c-title').textContent=s.frame.title;q('.c-narrative').textContent=s.frame.narrative;
    q('.c-revision').textContent=`${s.state.revision} · ${s.index+1}/${s.frames.length}`;
    q('.c-input-count').textContent=s.frame.events.length||'';
    q('.c-path').innerHTML=`${s.layerId?'<button type="button" data-c-action="rise" aria-label="返回上一层">↑</button>':''}<button type="button" data-c-action="root" ${!s.layerId?'aria-current="page"':''}>全部事项</button>${s.path.map((item,i)=>`<span aria-hidden="true">/</span><button type="button" data-c-dive="${esc(item.id)}" ${i===s.path.length-1?'aria-current="page"':''}>${esc(item.title)}</button>`).join('')}`;
    const pending=(s.state.annotations||[]).filter(a=>a.status==='saved');q('.c-feedback').hidden=!pending.length;q('.c-feedback').textContent=`${pending.length} 条待确认反馈 ↗`;
    q('.c-budget-title').textContent=s.layerId?'子层份额（独立预算）':'当前层份额';
    q('.c-budget-values').innerHTML=`<strong>${s.layer.used}</strong><span> / ${s.layer.budget}</span><span class="c-budget-space">未分配 ${s.layer.budget-s.layer.used} 份</span>`;
    q('.c-budget-track').innerHTML=s.layer.items.map(item=>`<button type="button" data-c-select="${esc(item.id)}" style="width:${item.share/s.layer.budget*100}%;--item-color:${colorFor(item,s.state)}" aria-label="${esc(item.title)}，${item.share}份" title="${esc(item.title)} · ${item.share}份"></button>`).join('')+`<span class="c-budget-unused" style="width:${(s.layer.budget-s.layer.used)/s.layer.budget*100}%" aria-label="未分配${s.layer.budget-s.layer.used}份"></span>`;
    q('.c-time-current').textContent=`${formatDate(s.now)} ${formatTime(s.now)}`;q('.c-frame-count').textContent=`${String(s.index+1).padStart(2,'0')} / ${s.frames.length}`;
    const range=q('.c-range');range.max=String(s.frames.length-1);range.value=String(s.index);range.style.setProperty('--progress',`${s.index/(s.frames.length-1)*100}%`);range.setAttribute('aria-valuetext',`${formatDate(s.now)} ${formatTime(s.now)}，${s.frame.title}`);
    q('.c-play').innerHTML=`${svg(s.playing?'pause':'play')}<span>${s.playing?'暂停':'播放'}</span>`;q('.c-play').setAttribute('aria-label',s.playing?'暂停回放':'播放回放');
    q('[data-c-action="prev"]').disabled=s.index===0;q('.c-playback [data-c-action="next"]').disabled=s.index===s.frames.length-1;
    q('.c-empty').hidden=s.layer.items.length>0;q('.c-total').textContent=`${s.layer.items.length} 项`;
    q('.c-item-list').innerHTML=s.layer.items.map(item=>`<button type="button" data-c-select="${esc(item.id)}"><span style="--item-color:${colorFor(item,s.state)}"></span><strong>${esc(item.title)}</strong><span>${item.share} 份</span></button>`).join('');
    q('.c-all-items').hidden=!s.layer.items.length;
    renderReading(s);syncLabels(s,meta);
    if(s.layer.items.length>LIMIT){failed=true;}
    renderFallback(s);arrange(s,meta);
    if(meta.type==='dive'||meta.type==='rise'){
      q('.c-path button:last-child')?.focus({preventScroll:true});
      if(innerWidth<760)q('.c-scene-column').scrollIntoView({block:'start',behavior:'instant'});
    }
  }
  function renderFallback(s) {
    q('.c-fallback').hidden=!failed;canvas.hidden=failed;labelLayer.hidden=failed;leaderLayer.hidden=failed;
    if(!failed)return;
    q('.c-render-note').textContent='液体视图不可用，已显示事项列表；份额与完整状态仍可查看。';
    q('.c-fallback').innerHTML=s.layer.items.map(item=>`<button type="button" data-c-select="${esc(item.id)}" aria-pressed="${s.selectedId===item.id}" style="--item-color:${colorFor(item,s.state)}"><span>${kindLabel[item.kind]||esc(item.kind)} · ${item.share} / ${s.layer.budget}${s.selectedId===item.id?' · 当前查看':''}</span><strong>${esc(item.title)}</strong><p>${esc(item.summary)}</p></button>`).join('');
  }
  function onClick(event) {
    const button=event.target.closest('button');if(!button||!host.contains(button))return;
    if(button.dataset.cSelect){mode='item';model.select(button.dataset.cSelect);showReading();return;}
    if(button.dataset.cDive){model.dive(button.dataset.cDive);return;}
    switch(button.dataset.cAction){case'prev':model.goFrame(snapshot.index-1);break;case'next':model.goFrame(snapshot.index+1);break;case'play':model.togglePlay();break;case'rise':model.rise();break;case'root':model.goRoot();break;case'close':{const id=snapshot.selectedId;mode='item';model.select(null);labels.get(id)?.el.focus({preventScroll:true});if(innerWidth<760)q('.c-scene-column').scrollIntoView({block:'start',behavior:'instant'});break;}case'inputs':model.pause();mode=mode==='inputs'?'item':'inputs';renderReading(snapshot);arrange(snapshot,{type:'resize'});showReading();break;case'feedback':model.pause();mode='feedback';renderReading(snapshot);arrange(snapshot,{type:'resize'});showReading();break;}
  }
  function showReading(){if(q('.c-reading').hidden)return;if(innerWidth<760)q('.c-reading').scrollIntoView({block:'start',behavior:'instant'});const heading=q('.c-reading h2');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});}
  function hit(event) {const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;return sample().filter(b=>b.opacity>.5&&snapshot.layer.items.some(i=>i.id===b.id)).find(b=>Math.hypot((x-b.x)/(1.06*(b.stretch||1)),(y-b.y)/.95)<b.r)?.id||null;}
  function onPointerMove(event){const id=hit(event);if(id!==hoverId){hoverId=id;canvas.style.cursor=id?'pointer':'default';requestDraw();}}
  function onPointerLeave(){hoverId=null;canvas.style.cursor='default';requestDraw();}
  function onCanvasClick(event){const id=hit(event);if(id){mode='item';model.select(id);showReading();}}
  function onRange(event){model.goFrame(Number(event.target.value));}
  function onPreference(){if(reduced.matches&&flight){bodies=flight.targets;flight=null;clearGhostLabels();labelsDirty=true;}lastDraw=0;requestDraw();}
  function onVisibility(){lastDraw=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;}else requestDraw();}
  function onContextLost(event){event.preventDefault();failed=true;cancelAnimationFrame(raf);raf=0;renderFallback(snapshot);}
  function onFocus(event){const label=event.target.closest('[data-c-select]');if(label){hoverId=label.dataset.cSelect;requestDraw();}}
  function onFocusOut(event){
    const previous=event.target.closest('[data-c-select]');
    if(!previous||hoverId!==previous.dataset.cSelect)return;
    const next=event.relatedTarget?.closest?.('[data-c-select]');
    hoverId=next&&host.contains(next)?next.dataset.cSelect:null;requestDraw();
  }
  host.addEventListener('click',onClick);host.addEventListener('focusin',onFocus);host.addEventListener('focusout',onFocusOut);q('.c-range').addEventListener('input',onRange);
  sceneElement.addEventListener('pointermove',onPointerMove);sceneElement.addEventListener('pointerleave',onPointerLeave);canvas.addEventListener('click',onCanvasClick);canvas.addEventListener('webglcontextlost',onContextLost);
  reduced.addEventListener('change',onPreference);document.addEventListener('visibilitychange',onVisibility);
  const observer=new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(!disposed&&snapshot)arrange(snapshot,{type:'resize'});});});observer.observe(sceneElement);
  const intersection=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false;lastDraw=0;if(visible)requestDraw();else{cancelAnimationFrame(raf);raf=0;}});intersection.observe(sceneElement);
  const unsubscribe=model.subscribe(render);
  return()=>{disposed=true;unsubscribe();cancelAnimationFrame(raf);cancelAnimationFrame(resizeFrame);observer.disconnect();intersection.disconnect();host.removeEventListener('click',onClick);host.removeEventListener('focusin',onFocus);host.removeEventListener('focusout',onFocusOut);q('.c-range')?.removeEventListener('input',onRange);sceneElement.removeEventListener('pointermove',onPointerMove);sceneElement.removeEventListener('pointerleave',onPointerLeave);canvas.removeEventListener('click',onCanvasClick);canvas.removeEventListener('webglcontextlost',onContextLost);reduced.removeEventListener('change',onPreference);document.removeEventListener('visibilitychange',onVisibility);surface?.dispose();};
}
