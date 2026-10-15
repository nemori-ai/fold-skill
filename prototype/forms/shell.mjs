import {
  createModel, scenario, records, escapeHTML as esc, inputHTML, formatDate, formatTime,
  kindLabel, getItem, allItems, currentAsk, feedbackTrail, findEvent, notice, personName,
} from '../variants/shared.mjs?v=feedback-loop-1';
import { formById, notesHref } from './catalog.mjs';
import { followFrames } from '../embed.mjs';

// One page frame for every form: frame stepper, concept card, data inspector.
// Forms receive the shared replay model and only change the encoding.
// Root identity colours come from the dataset's categories (`color`); categories without one take
// the next colour of a fixed palette, in category order, so every dataset gets stable identities.
const palette = ['#2f7f6f', '#b8643a', '#c49a2c', '#86569c', '#3a78b0', '#c04f78', '#5b8c37', '#8a6a3c', '#4f6fa8', '#a3485a', '#6b7f2a', '#7a5c99'];
const identityColors = Object.fromEntries(Object.entries(scenario.categories || {})
  .map(([id, category], index) => [id, category.color || palette[index % palette.length]]));
function rootOf(state, id) {
  let item = getItem(state, id);
  const seen = new Set();
  while (item?.parent_id && !seen.has(item.id)) { seen.add(item.id); item = getItem(state, item.parent_id); }
  return item?.id || id;
}
const span = ms => {
  const abs = Math.abs(ms), m = Math.round(abs / 60000), h = Math.round(abs / 3600000), d = Math.round(abs / 86400000);
  return abs < 3600000 ? `${Math.max(1, m)} 分钟` : abs < 172800000 ? `${h} 小时` : `${d} 天`;
};
export const kit = {
  esc, scenario, records, kindLabel, formatDate, formatTime, getItem, allItems, currentAsk, feedbackTrail, findEvent, personName,
  // Who wrote a source: the hand-written story names the author; real-corpus sources only point at their event.
  author: source => source?.author || (source?.ref?.startsWith('event:') ? findEvent(source.ref.slice(6))?.from : '') || source?.channel || '来源',
  identity: (state, id) => identityColors[rootOf(state, id)] || '#8a8f87',
  identityColors, rootOf,
  until: ms => (ms >= 0 ? `还有 ${span(ms)}` : `已过 ${span(ms)}`),
  ago: seconds => (seconds == null ? '—' : seconds < 60 ? '刚刚' : `${span(seconds * 1000)}前`),
  frameOf: at => scenario.frames.findIndex(frame => frame.at === at),
  changes: s => new Map((s.frameDiff.changes || []).filter(c => c.type !== 'annotations_changed').map(c => [c.item, c])),
  activeItems(state) {
    const out = [];
    const walk = (layer, depth) => { for (const item of layer?.items || []) { out.push({ item, depth }); walk(item.children, depth + 1); } };
    walk(state.root, 0);
    return out;
  },
  asks(s) { return kit.activeItems(s.state).map(({ item }) => ({ item, ask: currentAsk(s, item.id) })).filter(x => x.ask); },
  dayTime: at => `${formatDate(at)} ${formatTime(at)}`,
  toast(message) {
    const el = document.getElementById('fs-toast');
    el.textContent = message; el.hidden = false;
    clearTimeout(kit.toastTimer); kit.toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  },
};

function cardHTML(form) {
  const rows = [['载体', form.carrier], ['场景', form.scene], ['用法', form.usage], ['读者此刻的问题', form.question],
    ['预注意通道', form.channel], ['视觉骨架', `<pre>${esc(form.skeleton)}</pre>`], ['故意舍弃', form.discard],
    ['与 A/B/C/D 的差异', form.diff], ['配色', form.palette], ['灵感', form.inspiration]];
  return `<div class="fs-card-no">形式 ${String(form.no).padStart(2, '0')} · 概念卡</div><h1>${esc(form.name)}</h1>
    <p class="fs-tagline">${esc(form.tagline)}</p>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${k === '视觉骨架' ? v : esc(v)}</dd>`).join('')}</dl>
    <div id="fs-side"></div>
    <p class="fs-foot">回应控件只在本页演示，不写回状态，也不记录已阅。${esc(notice)}<a href="${notesHref('CONCEPTS')}">全部概念卡</a> · <a href="${notesHref('INSPIRATION')}">灵感来源</a></p>`;
}

export function boot(id) {
  const form = formById(id);
  const params = new URLSearchParams(location.search);
  if (!params.has('frame')) { params.set('frame', form.frame); history.replaceState(null, '', `?${params}`); }
  const hideCard = params.get('card') === '0';
  document.title = `Fold · ${form.name}`;
  document.body.className = `fs-page fs-theme-${form.theme}${hideCard ? ' fs-no-card' : ''}`;
  document.body.innerHTML = `<header class="fs-bar">
      <a class="fs-home" href="index.html" title="全部形式">← 形式</a>
      <span class="fs-name"><b>${String(form.no).padStart(2, '0')}</b> ${esc(form.name)}</span>
      <div class="fs-nav"><button data-step="-1" aria-label="上一帧">‹</button>
        <div class="fs-when"><span class="fs-date"></span><span class="fs-title"></span></div>
        <button data-step="1" aria-label="下一帧">›</button></div>
      <div class="fs-ticks" role="group" aria-label="选择帧">${scenario.frames.map((f, i) => `<button data-frame="${i}" title="${esc(`${kit.dayTime(f.at)} ${f.title}`)}"></button>`).join('')}</div>
      <div class="fs-tools"><button data-card aria-pressed="${!hideCard}">概念卡</button><button data-inspect="state">状态</button></div>
    </header>
    <div class="fs-body"><main class="fs-stage" id="fs-stage" tabindex="-1"></main><aside class="fs-card" aria-label="概念卡">${cardHTML(form)}</aside></div>
    <aside class="fs-inspector" hidden aria-label="核对完整数据"><div class="fs-inspector-top"><div class="fs-tabs">
      ${[['state', '完整状态 JSON'], ['inputs', '原始输入'], ['batch', '声明与回执'], ['diff', '本轮变化']].map(([k, v]) => `<button data-inspect="${k}">${v}</button>`).join('')}
      </div><button data-close aria-label="关闭">×</button></div><div class="fs-inspector-body"></div></aside>
    <div id="fs-toast" class="fs-toast" role="status" hidden></div>`;
  const inspector = document.querySelector('.fs-inspector');
  let inspection = 'state';
  function renderInspector(s) {
    const value = inspection === 'state' ? s.state : inspection === 'batch' ? { request: s.frame.batch, receipt: s.records[s.index].receipt }
      : { from: s.frames[Math.max(0, s.index - 1)].id, to: s.frame.id, ...s.frameDiff };
    inspector.querySelector('.fs-inspector-body').innerHTML = inspection === 'inputs' ? inputHTML(s) : `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`;
    inspector.querySelectorAll('[data-inspect]').forEach(b => b.classList.toggle('is-on', b.dataset.inspect === inspection));
  }
  const model = createModel(s => {
    const q = new URLSearchParams(location.search);
    q.set('frame', s.index);
    if (s.selectedId) q.set('item', s.selectedId); else q.delete('item');
    q.delete('at');
    history.replaceState(null, '', `?${q}`);
  });
  const report = followFrames(i => model.goFrame(i));
  model.subscribe(s => {
    report(s.index);
    document.querySelector('.fs-date').textContent = `${kit.dayTime(s.frame.at)} · ${s.frame.id} · ${s.state.revision}`;
    document.querySelector('.fs-title').textContent = s.frame.title;
    document.querySelectorAll('[data-frame]').forEach(b => b.classList.toggle('is-on', Number(b.dataset.frame) === s.index));
    if (!inspector.hidden) renderInspector(s);
  });
  document.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b) return;
    if (b.dataset.step) model.goFrame(model.snapshot().index + Number(b.dataset.step));
    else if (b.dataset.frame) model.goFrame(Number(b.dataset.frame));
    else if (b.dataset.inspect) { inspection = b.dataset.inspect; inspector.hidden = false; renderInspector(model.snapshot()); }
    else if ('close' in b.dataset) inspector.hidden = true;
    else if ('card' in b.dataset) {
      const off = document.body.classList.toggle('fs-no-card');
      b.setAttribute('aria-pressed', String(!off));
    }
  });
  document.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea,select,[contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); model.goFrame(model.snapshot().index - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); model.goFrame(model.snapshot().index + 1); }
    if (event.key === 'Escape') inspector.hidden = true;
  });
  return import(`./${id}.mjs`).then(module => {
    module.mount(document.getElementById('fs-stage'), model, { ...kit, side: document.getElementById('fs-side') });
    window.foldForm = { model, id };
  }).catch(error => {
    document.getElementById('fs-stage').innerHTML = `<p class="fs-error">形式加载失败：${esc(error.message)}</p>`;
    console.error(error);
  });
}
