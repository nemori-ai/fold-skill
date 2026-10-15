// Page frame for the full versions of three round-two sketches (03 来源矩阵、04 让位图、05 批次记谱).
// The static sketches (kit.mjs `page`) draw one chosen frame; these pages step through every frame.
//
// One stage gives: the frame bar (‹ ▶ ›, date, title, a scrubbable tick strip), the relation headline,
// a figure, a side panel (this round, or the pinned detail), a key, one tooltip, the keyboard, and a
// render timer. Frame state lives in the URL (?frame=<index>, as in shell.mjs and the other forms),
// so links to other forms carry the same moment. Records are the replay's precomputed snapshots:
// stepping does not re-project state, which keeps a frame change inside one animation frame.
import {
  scenario, records, escapeHTML as esc, formatDate, formatTime, getItem, currentAsk, findEvent, notice, kindLabel,
} from '../../variants/shared.mjs?v=feedback-loop-1';
import { withDataset } from '../../data/select.mjs';
import { followFrames } from '../../embed.mjs';
import { chosenFrame, identityColors, rootOf, personName } from './kit.mjs';

export { esc, scenario, records, formatDate, formatTime, getItem, findEvent, kindLabel, identityColors, rootOf, personName };
export const frames = scenario.frames;
export const dayTime = at => `${formatDate(at)} ${formatTime(at)}`;
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- names ----------

/** The short name of an item: its category short name (roots), else a trimmed title. */
export function shortOf(id) {
  const category = scenario.categories?.[id];
  if (category?.short) return category.short;
  const title = latestTitle(id);
  return title.length > 8 ? `${title.slice(0, 7)}…` : title;
}
const titleCache = new Map();
/** The item's title at frame `upto` (or the latest it had before), falling back to any version. */
export function titleAt(id, upto = frames.length - 1) {
  for (let i = Math.min(upto, frames.length - 1); i >= 0; i -= 1) {
    const item = records[i].snapshot.items[id];
    if (item) return item.title;
  }
  return latestTitle(id);
}
function latestTitle(id) {
  if (!titleCache.has(id)) {
    let title = scenario.categories?.[id]?.label || id;
    for (let i = frames.length - 1; i >= 0; i -= 1) { const item = records[i].snapshot.items[id]; if (item) { title = item.title; break; } }
    titleCache.set(id, title);
  }
  return titleCache.get(id);
}
export const colorOf = id => identityColors[rootOf(id)] || '#8a8f87';

// ---------- the person's own inputs and responses ----------

export const isSelf = event => Boolean(event.self) || event.from === scenario.persona?.name;
const platformOf = channel => {
  const head = String(channel || '').split('·')[0].trim();
  return { 问答: '问答站', 论坛: '论坛', 邮件列表: '邮件列表', 博客评论: '博客', CI: 'CI', 订阅邮件: '邮件' }[head] || head || '来源处';
};
const sourceAction = id => scenario.feedback?.sourceActions?.find(action => action.id === id)?.label;
/** The object a response acted on, as the person would name it: a PR or issue number, else the item. */
function objectOf(event, link) {
  const number = String(event.url || '').match(/\/(?:pull|issues)\/(\d+)/)?.[1];
  return number ? `#${number}` : shortOf(link.target);
}
/**
 * One feedback link as an action sentence: what the person did and where, never the original text.
 * “你在 GitHub 上批准了 #13572”“你在问答站回复了 Gerda Moberg”“你在 Fold 里选了「锁定周六上午」”.
 */
export function responseSentence(event, link) {
  if (link.via === 'source') {
    const verb = sourceAction(link.action) || link.action;
    const platform = platformOf(event.channel);
    const place = /^[A-Za-z]/.test(platform) ? `在 ${platform} 上` : `在${platform}`;
    if (link.meaning === 'input' || link.action === 'comment') {
      // “@Gerda Moberg - …”: take two words only when that is someone who wrote in this dataset.
      const m = String(link.value || event.text || '').match(/^@([\w.'’-]+)(?:\s([A-Z][\w'’-]+))?/);
      const to = m && (m[2] && senders().has(`${m[1]} ${m[2]}`) ? `${m[1]} ${m[2]}` : m[1]);
      return `你${place}回复了 ${to || `${objectOf(event, link)} 的讨论`}`;
    }
    return `你${place}${verb}了 ${objectOf(event, link)}`;
  }
  const ask = link.ask && askById(link.ask);
  const label = ask?.actions?.find(action => action.id === link.action)?.label;
  if (link.via === 'button') return `你在 Fold 里选了「${label || link.action}」`;
  const value = String(link.value || '');
  return value && [...value].length <= 18 ? `你回复 Agent：${value}` : `你回复了 Agent${label ? `（${label}）` : ''}`;
}
/** Identical action sentences folded together: six comments on one thread read “……（6 次）”. */
export function foldSentences(responses) {
  const out = new Map();
  for (const r of responses) {
    const text = responseSentence(r.event, r.link);
    if (!out.has(text)) out.set(text, { text, n: 0, first: r });
    out.get(text).n += 1;
  }
  return [...out.values()].map(x => ({ ...x, label: x.n > 1 ? `${x.text}（${x.n} 次）` : x.text }));
}
let senderSet = null;
const senders = () => senderSet || (senderSet = new Set(frames.flatMap(f => f.events.map(e => e.from))));
const askIndex = new Map();
for (const frame of frames) for (const ask of Object.values(frame.asks || {})) if (!askIndex.has(ask.id)) askIndex.set(ask.id, ask);
export const askById = id => askIndex.get(id) || null;

/** Every feedback link the person gave in frame i, with its event. Links that answer a registered ask first. */
export function responsesIn(i) {
  const out = [];
  for (const event of frames[i].events) for (const link of event.feedback || []) out.push({ event, link, frame: i });
  return out.sort((a, b) => Boolean(b.link.ask) - Boolean(a.link.ask) || Date.parse(a.event.at) - Date.parse(b.event.at));
}

// ---------- registered questions over time ----------

const walk = (layer, out = []) => { for (const item of layer?.items || []) { out.push(item); walk(item.children, out); } return out; };
export const activeItems = i => walk(records[i].state.root);
/** For each frame: the questions open after it, newly registered, answered (closed after your response) and lapsed. */
export const askLife = (() => {
  const answered = new Set();
  let previous = new Map();
  return frames.map((frame, i) => {
    for (const event of frame.events) for (const link of event.feedback || []) if (link.ask) answered.add(link.ask);
    const open = new Map();
    for (const item of activeItems(i)) {
      const ask = currentAsk({ index: i, state: records[i].state }, item.id);
      if (ask) open.set(ask.id, { ...ask, item: item.id });
    }
    const fresh = [...open.values()].filter(ask => !previous.has(ask.id));
    const closed = [...previous.values()].filter(ask => !open.has(ask.id));
    const out = { open, fresh, answered: closed.filter(ask => answered.has(ask.id)), lapsed: closed.filter(ask => !answered.has(ask.id)) };
    previous = open;
    return out;
  });
})();

// ---------- detail ----------

/** Versions of an item up to frame `upto`: each frame where its title, share, kind or status changed. */
export function versionsOf(id, upto) {
  const out = [];
  let last = null;
  for (let i = 0; i <= upto; i += 1) {
    const item = records[i].snapshot.items[id];
    if (!item) continue;
    const share = item.status === 'active' ? item.share : 0;
    const key = `${item.title}|${share}|${item.kind}|${item.status}|${item.updated_at}`;
    if (key !== last) out.push({ i, item, share, changed: last === null ? 'new' : item.status !== 'active' ? item.status : 'update' });
    last = key;
  }
  return out;
}

function sourceHTML(source) {
  const event = source.ref?.startsWith('event:') ? findEvent(source.ref.slice(6)) : null;
  const who = source.author || event?.from || '';
  const original = event?.text || source.content || '';
  const quote = source.quote && original && original.startsWith(source.quote.slice(0, 40)) ? '' : source.quote;
  return `<li><small>${esc(source.channel || event?.channel || '')}${who ? ` · ${esc(who)}` : ''}${event ? ` · ${esc(dayTime(event.at))}` : ''}</small>
    ${quote ? `<q>${esc(quote)}</q>` : ''}
    ${original ? `<details><summary>来源原文</summary><p class="st-original">${esc(original)}</p>${event?.url ? `<a href="${esc(event.url)}" target="_blank" rel="noreferrer">原链接（化名，可能打不开）↗</a>` : ''}</details>` : ''}</li>`;
}

/** Summary, reason, sources with original text, version list and response trail of one item at frame i. */
export function itemDetailHTML(id, i, { lead = '' } = {}) {
  const versions = versionsOf(id, i);
  const now = records[i].snapshot.items[id];
  const item = now || versions.at(-1)?.item;
  if (!item) return `<p class="st-muted">这件事在 ${esc(dayTime(frames[i].at))} 之前还没有出现。</p>`;
  const sources = item.sources || [];
  const trail = [];
  for (let k = 0; k <= i; k += 1) for (const r of responsesIn(k)) if (r.link.target === id) trail.push(r);
  const asks = [...new Map(frames.slice(0, i + 1).flatMap(f => Object.values(f.asks || {})).filter(a => a.item === id).map(a => [a.id, a])).values()];
  const open = askLife[i].open.get(asks.find(a => askLife[i].open.has(a.id))?.id);
  return `${lead}
    <p class="st-summary">${esc(item.summary || '')}</p>
    ${item.reason ? `<section><h4>依据</h4><p>${esc(item.reason)}</p></section>` : ''}
    ${asks.length ? `<section><h4>登记的问题</h4><ul class="st-asks">${asks.map(a => `<li class="${open?.id === a.id ? 'is-open' : ''}"><b>${open?.id === a.id ? '开着' : askLife.slice(0, i + 1).some(l => l.answered.some(x => x.id === a.id)) ? '已答' : '已失效'}</b>${esc(a.prompt)}</li>`).join('')}</ul></section>` : ''}
    ${trail.length ? `<section><h4>你的回应</h4><ul class="st-trail">${trail.slice(-6).map(r => `<li><time>${esc(dayTime(r.event.at))}</time>${esc(responseSentence(r.event, r.link))}${r.link.ask ? '<small>答登记的问题</small>' : ''}</li>`).join('')}</ul>${trail.length > 6 ? `<p class="st-muted">另有 ${trail.length - 6} 条更早的回应。</p>` : ''}</section>` : ''}
    ${sources.length ? `<section><h4>来源 <small>${sources.length} 条</small></h4><ul class="st-sources">${sources.slice(0, 6).map(sourceHTML).join('')}</ul>${sources.length > 6 ? `<p class="st-muted">另有 ${sources.length - 6} 条来源，见状态 JSON。</p>` : ''}</section>` : ''}
    <section><h4>版本 <small>${versions.length} 个</small></h4><ol class="st-versions">${versions.slice(-8).map(v => `<li class="${v.i === i ? 'is-now' : ''}"><time>${esc(dayTime(frames[v.i].at))}</time><b>${v.changed === 'new' ? '新增' : v.changed === 'withdrawn' ? '撤下' : v.changed === 'merged' ? '并入' : `${v.share} 份`}</b><span>${esc(v.item.title)}</span></li>`).join('')}</ol></section>`;
}
export const kindWord = item => (item.status && item.status !== 'active' ? { withdrawn: '已撤下', merged: '已并入' }[item.status] : kindLabel[item.kind] || item.kind);

// ---------- the stage ----------

const OTHER = [
  ['lineage', '身份线'], ['timing', '回应时序'], ['provenance', '来源矩阵'], ['yield', '让位图'], ['notation', '批次记谱'],
  ['../multiples', '两周小倍数'], ['../../index.html?variant=a', 'A 空间'], ['../../index.html?variant=b', 'B 时间'], ['../../index.html?variant=d', 'D 首页'],
];

export function createStage({ id, no, name, relation, storyIndex, key, tools = '', playMs = 1500 }) {
  const params = new URLSearchParams(location.search);
  let index = chosenFrame(id, storyIndex);
  if (params.get('frame') !== String(index)) { params.set('frame', index); history.replaceState(null, '', `?${params}`); }
  const perfOn = params.has('perf');
  document.title = `Fold · ${name}`;
  document.body.classList.add('st-page');
  // Day breaks and chapters give the tick strip its rhythm.
  const dayKey = at => formatDate(at);
  document.body.innerHTML = `<div class="st" data-form="${id}">
    <header class="st-bar">
      <a class="st-home" href="${esc(withDataset('../index.html'))}" title="全部形式">← 形式</a>
      <span class="st-name"><b>${String(no).padStart(2, '0')}</b>${esc(name)}</span>
      <div class="st-nav">
        <button type="button" data-st="prev" aria-label="上一帧（←）" title="上一帧（←）">‹</button>
        <button type="button" data-st="play" aria-label="播放（空格）" title="播放 / 暂停（空格）"><span class="st-play-icon"></span></button>
        <button type="button" data-st="next" aria-label="下一帧（→）" title="下一帧（→）">›</button>
      </div>
      <div class="st-when"><span class="st-date"></span><span class="st-title"></span></div>
      <div class="st-ticks" role="slider" tabindex="0" aria-label="选择帧" aria-valuemin="0" aria-valuemax="${frames.length - 1}">${frames.map((f, i) => `<i data-tick="${i}" class="${i && dayKey(frames[i - 1].at) !== dayKey(f.at) ? 'is-day' : ''}${i && frames[i - 1].chapter !== f.chapter ? ' is-chapter' : ''}"></i>`).join('')}</div>
      <div class="st-tools">${tools}</div>
    </header>
    <div class="st-head"><div class="st-kicker">FOLD · 第二轮草图 · 完整版</div><h1>${esc(relation)}</h1></div>
    <div class="st-body">
      <main class="st-figure" id="st-figure" aria-label="${esc(name)}"></main>
      <aside class="st-side" aria-live="polite"><div class="st-side-inner"></div>
        <nav class="st-elsewhere"></nav>
        <p class="st-notice">${esc(notice)}</p></aside>
    </div>
    <footer class="st-key">${key}<span class="st-perf" ${perfOn ? '' : 'hidden'}></span></footer>
    <div class="st-tip" role="tooltip" hidden></div>
  </div>`;
  const $ = s => document.querySelector(s);
  const figure = $('#st-figure'), sideInner = $('.st-side-inner'), tip = $('.st-tip'), ticks = $('.st-ticks');
  const listeners = new Set();
  let timer = null, overview = () => null, detail = null, lastSide = '';
  const perf = { script: [], layout: [] };

  function renderSide() {
    const content = (detail || overview)(index);
    if (!content) return;
    const html = `<div class="st-side-kicker">${content.kicker || ''}${detail ? '<button type="button" class="st-unpin" data-st="unpin" title="取消固定（Esc）">×</button>' : ''}</div>
      <h2>${content.title || ''}</h2>${content.body || ''}`;
    if (html === lastSide) return;
    lastSide = html;
    sideInner.innerHTML = html;
    // A short settle instead of a hard swap; the Web Animations API needs no forced reflow to restart.
    if (!reduced()) sideInner.animate([{ opacity: 0.35, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
  }
  function renderBar() {
    const f = frames[index];
    $('.st-date').textContent = `${dayTime(f.at)} · ${f.id} · ${records[index].state.revision}`;
    $('.st-title').textContent = f.title;
    ticks.setAttribute('aria-valuenow', index);
    ticks.setAttribute('aria-valuetext', `${dayTime(f.at)} ${f.title}`);
    ticks.querySelectorAll('[data-tick]').forEach((t, i) => { t.classList.toggle('is-on', i === index); t.classList.toggle('is-past', i < index); });
    $('.st-elsewhere').innerHTML = `<h4>同一帧在其他形式</h4>${OTHER.filter(([href]) => href !== id).map(([href, label]) => {
      const url = href.includes('?') ? `${href}&frame=${index}` : `${href}.html?frame=${index}`;
      return `<a href="${esc(withDataset(url))}">${label}</a>`;
    }).join('')}`;
  }
  function go(next, { fromPlay = false } = {}) {
    next = Math.max(0, Math.min(frames.length - 1, Math.round(next)));
    if (!fromPlay) pause();
    if (next === index) return;
    const previous = index;
    index = next;
    const q = new URLSearchParams(location.search);
    q.set('frame', index);
    history.replaceState(null, '', `?${q}`);
    // The timed update covers everything a step redraws: bar, figure and side panel.
    stage.measure(() => { renderBar(); for (const fn of listeners) fn(index, previous); renderSide(); });
    reportFrame(index);
  }
  function play() {
    if (timer) return;
    if (index === frames.length - 1) go(0, { fromPlay: true });
    document.body.classList.add('st-playing');
    timer = setInterval(() => {
      if (index >= frames.length - 1) { pause(); return; }
      go(index + 1, { fromPlay: true });
      if (index >= frames.length - 1) pause();
    }, reduced() ? Math.max(playMs, 1800) : playMs);
  }
  function pause() { if (!timer) return; clearInterval(timer); timer = null; document.body.classList.remove('st-playing'); }

  const stage = {
    id, figure, frames,
    get index() { return index; },
    go, play, pause, toggle: () => (timer ? pause() : play()),
    onFrame(fn) { listeners.add(fn); },
    setOverview(fn) { overview = fn; renderSide(); },
    /** Pin a detail renderer (fn(index) → {kicker,title,body}); null returns to this round's overview. */
    showDetail(fn) { detail = fn; renderSide(); },
    refreshSide: renderSide,
    get pinned() { return Boolean(detail); },
    onEscape: () => false,
    onKey: () => false,
    tip(html, anchor) {
      tip.innerHTML = html;
      tip.hidden = false;
      const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = (r.left + r.right) / 2 - w / 2, y = r.top - h - 8;
      if (y < 56) y = r.bottom + 8;
      x = Math.max(8, Math.min(innerWidth - w - 8, x));
      tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    },
    untip() { tip.hidden = true; },
    /** Time one update; with ?perf also force style and layout so the number covers what the browser must do before paint. */
    measure(fn) {
      const t0 = performance.now();
      fn();
      const t1 = performance.now();
      perf.script.push(t1 - t0);
      if (perfOn) {
        void figure.offsetHeight;
        perf.layout.push(performance.now() - t0);
        const s = summary(perf.layout);
        $('.st-perf').textContent = `切帧：脚本 ${summary(perf.script).p50.toFixed(1)} ms · 含样式与布局 p50 ${s.p50.toFixed(1)} / p95 ${s.p95.toFixed(1)} ms（${s.n} 次）`;
      }
    },
    perf: () => ({ script: summary(perf.script), layout: summary(perf.layout) }),
    resetPerf() { perf.script.length = 0; perf.layout.length = 0; },
  };
  const summary = list => {
    const sorted = [...list].sort((a, b) => a - b), at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] || 0;
    return { n: list.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) || 0, mean: list.reduce((s, x) => s + x, 0) / (list.length || 1) };
  };

  document.addEventListener('click', event => {
    const b = event.target.closest('[data-st]');
    if (!b) return;
    const action = b.dataset.st;
    if (action === 'prev') go(index - 1);
    else if (action === 'next') go(index + 1);
    else if (action === 'play') stage.toggle();
    else if (action === 'unpin') { if (!stage.onEscape()) stage.showDetail(null); }
    else if (action === 'go') go(Number(b.dataset.frame));
  });
  // The tick strip scrubs: press and drag across it.
  const tickAt = x => {
    const r = ticks.getBoundingClientRect();
    const items = [...ticks.children];
    let best = 0, dist = Infinity;
    items.forEach((t, i) => { const c = t.getBoundingClientRect(); const d = Math.abs((c.left + c.right) / 2 - x); if (d < dist) { dist = d; best = i; } });
    return x < r.left - 20 || x > r.right + 20 ? index : best;
  };
  ticks.addEventListener('pointerdown', event => {
    ticks.setPointerCapture(event.pointerId);
    go(tickAt(event.clientX));
    const move = e => go(tickAt(e.clientX));
    const up = () => { ticks.removeEventListener('pointermove', move); ticks.removeEventListener('pointerup', up); stage.untip(); };
    ticks.addEventListener('pointermove', move);
    ticks.addEventListener('pointerup', up);
  });
  ticks.addEventListener('pointermove', event => {
    const i = tickAt(event.clientX);
    stage.tip(`<b>${esc(dayTime(frames[i].at))}</b> · ${esc(frames[i].id)}<br>${esc(frames[i].title)}`, ticks.children[i]);
  });
  ticks.addEventListener('pointerleave', () => stage.untip());

  document.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea,select,[contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (stage.onKey(event)) { event.preventDefault(); return; }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); go(index + (event.key === 'ArrowLeft' ? -1 : 1)); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); go(event.key === 'Home' ? 0 : frames.length - 1); }
    else if (event.key === ' ' && !event.target.closest('button, a, summary')) { event.preventDefault(); stage.toggle(); }
    else if (event.key === 'Escape') { stage.untip(); if (!stage.onEscape() && detail) stage.showDetail(null); }
  });
  renderBar();
  // Embedded in all.html: the page above steps every prototype together.
  const reportFrame = followFrames(i => go(i));
  reportFrame(index);
  window.foldSketch = stage;
  return stage;
}
