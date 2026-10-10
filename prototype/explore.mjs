import { createModel, escapeHTML as esc, inputHTML } from './variants/shared.mjs?v=feedback-loop-1';

// The prototype is served as static files. Keep a review's modules and styles
// together even when an already-open browser has cached the previous version.
const reviewVersion = new URL(import.meta.url).searchParams.get('v') || 'feedback-loop-1';

// Three disposable visual encodings, on the same route and the same state.
const variants={a:{name:'空间排布',question:'查看当前事项、份额与余量'},b:{name:'时间展开',question:'查看事项份额随时间的变化'},c:{name:'流动形态',question:'用液体体量查看份额变化'},d:{name:'手机首页',question:'在手机上一眼看到需要你的事并直接回应'}};
let key=new URLSearchParams(location.search).get('variant')?.toLowerCase();
if(!variants[key])key='a';
document.querySelector('link[href="styles.css"]')?.remove();
const base=document.createElement('link');base.rel='stylesheet';base.href='./explore.css';document.head.append(base);
document.body.className='lab-page';
document.body.innerHTML=`<a class="lab-skip" href="#variant-host">跳到内容</a><div id="variant-host" tabindex="-1"></div>
  <nav class="lab-switcher" aria-label="视觉表达对比"><span class="lab-mark">FOLD <small>方案对比</small></span><button class="lab-arrow" data-cycle="-1" aria-label="上一个方案">‹</button><div class="lab-options">${Object.entries(variants).map(([id,v])=>`<button data-variant="${id}" title="${v.question}" aria-pressed="false"><b>${id.toUpperCase()}</b><span>${v.name}</span></button>`).join('')}</div><button class="lab-arrow" data-cycle="1" aria-label="下一个方案">›</button><div class="lab-utilities"><select id="lab-scene" aria-label="选择回放片段"><option value="">选择回放片段</option><option value="0">初始空状态</option><option value="5">账单合并前</option><option value="6">同张账单合并</option><option value="7">根层 64 份全部分配</option><option value="3:launch">发布方案子项</option><option value="25">补偿任务重复</option><option value="36">两周末状态</option></select><button data-lab-inspect="state">状态</button><button id="lab-about-toggle" aria-expanded="false">说明</button><a id="lab-classic" href="./">原版 ↗</a></div></nav>
  <aside id="lab-inspector" class="lab-inspector" aria-label="核对完整数据" hidden><div class="lab-inspector-top"><h2 id="lab-inspector-title">完整状态 JSON</h2><button id="lab-inspector-close" aria-label="关闭数据核对">×</button></div><div class="lab-inspector-tabs"><button data-lab-inspect="state">完整状态 JSON</button><button data-lab-inspect="inputs">原始输入</button><button data-lab-inspect="batch">声明与回执</button><button data-lab-inspect="diff">变化对比</button></div><div id="lab-inspector-body"></div></aside>
  <aside id="lab-about" class="lab-about" hidden><button id="lab-about-close" aria-label="关闭方案说明">×</button><span class="lab-eyebrow">同一份状态，四种展示方式</span><h2>视觉表达对比</h2><p>四种方案使用相同的演示事件、整理判断与完整状态，展示方式不同。</p><ul><li>当前事项的优先级与份额。</li><li>本轮新增、更新及撤下的事项。</li><li>可核对的原始输入、声明、回执与状态。</li></ul><p>A 用纸片与真实留白表达份额；B 用时间轨迹解释变化；C 用液体体量表达份额变化，准确份额见独立预算带与 JSON；D 是手机首页，卡片高度表达份额，登记的反馈按钮表达需要你做什么。</p><p class="lab-small">人物与私人消息为演示创作，Agent 判断预先编排。每个子层有独立预算，历史不计入此刻的份额。尚未选定方案。</p><p class="lab-small">← → 逐帧 · 空格播放 · Esc 返回 · Alt+←/→ 换方案</p></aside>`;
const host=document.getElementById('variant-host');
const inspector=document.getElementById('lab-inspector');
let mountedCleanup=null,variantStyle=null,generation=0,inspection='state';
function syncURL(s) {
  const query=new URLSearchParams();query.set('variant',key);query.set('frame',s.index);
  if(s.cursor!==Date.parse(s.frame.at))query.set('at',s.cursor);
  if(s.layerId)query.set('layer',s.layerId);
  if(s.selectedId)query.set('item',s.selectedId);
  if(s.comparing)query.set('base',s.baseIndex);
  history.replaceState(null,'',`${location.pathname}?${query}`);
  const classic=new URLSearchParams(query);classic.delete('variant');
  document.getElementById('lab-classic').href=`./?${classic}`;
  if(!inspector.hidden)renderInspector(s);
}
const model=createModel(syncURL);
function renderInspector(s=model.snapshot()) {
  const titles={state:'完整状态 JSON',batch:'本次声明与回执',inputs:'本轮原始输入',diff:'与比较起点的差异'};
  document.getElementById('lab-inspector-title').textContent=titles[inspection];
  const value=inspection==='state'?s.state:inspection==='batch'?{request:s.frame.batch,receipt:s.records[s.index].receipt}:
    {base_event_seq:s.baseState.event_seq,source_event_seq:s.state.event_seq,now:s.now,...s.diff};
  document.getElementById('lab-inspector-body').innerHTML=inspection==='inputs'?inputHTML(s):`<pre>${esc(JSON.stringify(value,null,2))}</pre>`;
  inspector.querySelectorAll('[data-lab-inspect]').forEach(button=>button.classList.toggle('is-active',button.dataset.labInspect===inspection));
}
function inspect(type) {
  inspection=type;model.pause();inspector.hidden=false;renderInspector();document.getElementById('lab-inspector-close').focus({preventScroll:true});
}
async function switchVariant(next) {
  if(!variants[next])return;
  const token=++generation;
  model.pause();mountedCleanup?.();mountedCleanup=null;
  variantStyle?.remove();key=next;
  host.className=`variant-${key}`;host.innerHTML='<div class="lab-loading">正在加载视图…</div>';
  const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=`./variants/${key}.css?v=${reviewVersion}`;variantStyle=stylesheet;
  const stylesReady=new Promise(resolve=>{stylesheet.onload=resolve;stylesheet.onerror=resolve;});document.head.append(stylesheet);
  document.querySelectorAll('[data-variant]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.variant===key)));
  document.title=`Fold · ${variants[key].name}`;syncURL(model.snapshot());
  try {
    const module=await import(`./variants/${key}.mjs?v=${reviewVersion}`);await stylesReady;
    if(token!==generation)return;
    host.innerHTML='';mountedCleanup=module.mount(host,model)||null;
  }catch(error){
    if(token!==generation)return;
    host.innerHTML=`<div class="lab-loading"><h1>视图加载失败</h1><p>${esc(error.message)}</p><a href="./">打开原版</a></div>`;
    console.error(error);
  }
}
const order=Object.keys(variants);
const cycle=direction=>switchVariant(order[(order.indexOf(key)+direction+order.length)%order.length]);
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.variant){switchVariant(button.dataset.variant);return;}
  if(button.dataset.cycle){cycle(Number(button.dataset.cycle));return;}
  if(button.dataset.labInspect){inspect(button.dataset.labInspect);return;}
  if(button.dataset.sharedSelect){model.select(button.dataset.sharedSelect);return;}
  if(button.dataset.sharedDive){model.dive(button.dataset.sharedDive);return;}
});
document.getElementById('lab-inspector-close').onclick=()=>{inspector.hidden=true;host.focus({preventScroll:true});};
const about=document.getElementById('lab-about');
document.getElementById('lab-about-toggle').onclick=()=>{about.hidden=!about.hidden;document.getElementById('lab-about-toggle').setAttribute('aria-expanded',String(!about.hidden));};
document.getElementById('lab-about-close').onclick=()=>{about.hidden=true;document.getElementById('lab-about-toggle').setAttribute('aria-expanded','false');};
document.getElementById('lab-scene').onchange=event=>{
  if(!event.target.value)return;
  const [index,layer]=event.target.value.split(':');model.goRoot();model.goFrame(Number(index));model.select(null);
  if(layer)model.dive(layer);event.target.value='';
};
document.addEventListener('keydown',event=>{
  if(event.target.matches('input,textarea,select,[contenteditable]'))return;
  if(event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();cycle(event.key==='ArrowLeft'?-1:1);return;}
  if(event.metaKey||event.ctrlKey||event.altKey)return;
  if(event.key==='Escape'){
    if(!inspector.hidden){inspector.hidden=true;host.focus({preventScroll:true});return;}
    if(!about.hidden){about.hidden=true;document.getElementById('lab-about-toggle').setAttribute('aria-expanded','false');document.getElementById('lab-about-toggle').focus({preventScroll:true});return;}
    model.rise();
  }
  if(event.key==='ArrowLeft'){event.preventDefault();model.goFrame(model.snapshot().index-1);}
  if(event.key==='ArrowRight'){event.preventDefault();model.goFrame(model.snapshot().index+1);}
  if(event.key===' '&&!event.target.closest('button,a,summary')){event.preventDefault();model.togglePlay();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)model.pause();});
window.foldLab={model,get variant(){return key;},switchVariant};
switchVariant(key);
