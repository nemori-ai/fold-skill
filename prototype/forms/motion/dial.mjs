// 份额拨盘（dial）：官网用的概念动画，也能逐帧停下。读其他形式共用的同一份回放，不另造数据，不改契约。
// 两层（story.md）：概念层约八成，灰阶、可密、一直动、跨切点不断；信息层约两成，墨黑加一个朱红，只在节拍上动，
// 每个数字都能在 dial/data.json 里对上。画法：canvas 画车道、记号与线束，SVG 只画环与文字。
//
// 模式：默认 hero（20 秒三拍循环）；空格连播全部轮次（每轮 4 秒）；←/→ 逐帧并停住；?frame= 直接停在那帧；
// 被合页 all.html 用 followFrames 驱动时只走单帧。prefers-reduced-motion 时每拍直接到终态，概念层不动。
// 交互（story.md「交互」）：悬停或 Tab 到扇区看概要，点击展开详情；两者都让播放停在当前轮，离开或收回 0.4 秒后接着播。
import { notice, frames, rounds, lanes, hero, BUDGET, orderOf, shortOf, scenario, itemFacts } from './dial-model.mjs';
import { createIx, placeBeside, summaryOf, IX } from './ix.mjs';
import { motions } from '../catalog.mjs';
import { followFrames } from '../../embed.mjs';
import { withDataset, keepDataset, datasets, currentDataset } from '../../data/select.mjs';

const form = motions.find(m => m.id === 'dial');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const last = frames.length - 1;

// ---------- colours: canvases need concrete values (forms.css tokens, paper theme) ----------
// No vermilion here: on this page it belongs to the questions only, which the SVG and the callout draw.
const C = { ink: '#1f2d26', ink2: '#5d6b63', paper: '#f6f5ef' };

// ---------- choreography: seconds within one 4.0 s round (spec.md 末行) ----------
// Inputs spawn over 0.6 s and take 0.4–0.7 s to reach the ring; shares settle at 1.3–1.8; the cursor swings at 1.9
// and lands at 2.4; the bundle comes in from 2.7 (0.3 s a line, neighbours 0.1 s apart, spread at most 0.4 s);
// 1.3 s to read; hard cut at 4.0.
const T = { flow: 0.6, travel: 0.4, travelJitter: 0.3, shares: 1.3, sharesDur: 0.5, cursor: 1.9, swing: 0.5, bundle: 2.7, bundleDur: 0.3, end: 4.0 };
const PHASES = [['输入涌入', 0, 1.0], ['归并压缩', 1.0, 1.3], ['份额分配', 1.3, 1.8], ['回应路径', 1.9, 2.7]];
// The five panels' headings while one item is open: they switch to that item's view (paintPanels).
const PANEL_ITEM = ['输入 · 这一件', '处置 · 这一件', '一轮四段 · 这一件', '份额 · 逐轮 ', '信号 · 它的输入'];
const HERO = { intro: 1.5, b1: 4.0, b2: 9.0, b3: 5.5 };

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - (1 - t) ** 3;
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
// Fast start, settles with an overshoot of about 3.7 % (story.md: no more than 4 %).
const easeOutBack = t => { const u = t - 1; return 1 + 2 * u ** 3 + u ** 2; };
const ang = u => -Math.PI / 2 + (u / BUDGET) * Math.PI * 2;
const STOP = ang(0);
const shortest = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const fmt = n => Math.round(n).toLocaleString('en-US');

// ---------- shares: sizes per round, laid out clockwise in a stable order (first seen) from 0 ----------
const sizeMaps = rounds.map(r => new Map(r.sectors.map(s => [s.id, s.share])));
function blend(a, b, p) {
  const out = new Map();
  for (const id of new Set([...a.keys(), ...b.keys()])) out.set(id, Math.max(0, lerp(a.get(id) || 0, b.get(id) || 0, p)));
  return out;
}
// The ring never passes the hard stop: an overshooting blend is scaled back to 64.
function layoutOf(sizes) {
  const ids = [...sizes.keys()].sort((x, y) => orderOf(x) - orderOf(y));
  const total = ids.reduce((sum, id) => sum + sizes.get(id), 0);
  const k = total > BUDGET ? BUDGET / total : 1;
  let pos = 0;
  const map = new Map();
  for (const id of ids) { const w = sizes.get(id) * k; map.set(id, [pos, pos + w]); pos += w; }
  return { map, used: pos };
}
const midOf = (layout, id) => { const a = layout.map.get(id); return a ? ang((a[0] + a[1]) / 2) : null; };
const settled = rounds.map((_, i) => layoutOf(sizeMaps[i]));
const parity = new Map([...new Set(rounds.flatMap(r => r.sectors.map(s => s.id)))].sort((a, b) => orderOf(a) - orderOf(b)).map((id, k) => [id, k % 2]));

// ---------- scene: what the information layer shows at a moment ----------
// Segments: intro (f00, optionally counting the ticks out), round (one batch, choreographed), lapse (a run of
// rounds at a fraction of a second each), jump (a quick settle between two frames) and hold (one frame, still).
function cursorAngle(c, layout) { return c ? (midOf(layout, c.root) ?? STOP) : STOP; }

function roundScene(seg, t) {
  const r = rounds[seg.i], from = rounds[seg.j];
  const T0 = (t - seg.t0) / seg.scale;
  const p = T0 < T.shares ? 0 : T0 < T.shares + T.sharesDur ? easeOutBack(clamp01((T0 - T.shares) / T.sharesDur)) : 1;
  const layout = layoutOf(blend(sizeMaps[seg.j], sizeMaps[seg.i], p));
  const afterShares = T0 >= T.shares;
  const fc = from.cursor, tc = r.cursor;
  const same = (fc?.root ?? null) === (tc?.root ?? null);
  const fromA = cursorAngle(fc, layout), toA = cursorAngle(tc, layout);
  let cursor;
  let land = T.cursor;
  if (T0 < T.cursor || same) cursor = { angle: T0 < T.cursor ? fromA : toA, hollow: T0 < T.cursor ? !fc : !tc, c: T0 < T.cursor ? fc : tc };
  else {
    land = T.cursor + T.swing;
    const q = clamp01((T0 - T.cursor) / T.swing);
    const e = tc ? easeOutBack(q) : easeInOutCubic(q);
    cursor = { angle: fromA + shortest(fromA, toA) * e, hollow: !tc, c: tc };
  }
  const swinging = !same && T0 >= T.cursor && T0 < land;
  const callout = swinging ? null : T0 < T.cursor ? fc : tc;
  // The old note fades just before the swing; the new one fades in once the cursor has landed.
  const calloutAlpha = swinging ? 0 : T0 < T.cursor ? (same ? 1 : clamp01((T.cursor - T0) / 0.12)) : clamp01((T0 - land) / 0.15 + (same ? 1 : 0));
  const bt = tc ? T0 - T.bundle : -1;
  const duck = 1 - 0.6 * Math.max(win(T0, T.shares - 0.1, T.shares + T.sharesDur + 0.1), same ? 0 : win(T0, T.cursor, land + 0.25));
  return {
    i: seg.i, kind: 'round', T: T0, layout, labels: afterShares ? settled[seg.i] : settled[seg.j], cursor, callout, calloutAlpha,
    asks: T0 < T.cursor ? from.askRoots : r.askRoots, cursorRoot: (T0 < T.cursor ? fc : tc)?.root ?? null,
    bundle: bt > 0 ? { round: r, t: bt } : null,
    inputs: [{ round: r, T: T0, mode: 'full', target: settled[seg.i] }],
    load: lerp(from.inputs, r.inputs, easeOutCubic(clamp01(T0 / 0.5))),
    counters: {
      cum: r.cumulative - r.inputs + r.inputs * easeOutCubic(clamp01((T0 - 0.2) / 1.0)),
      read: r.inputs, used: r.used, decl: r.declarations,
      items: (afterShares ? r : from).sectors.length, blank: (afterShares ? r : from).blank,
      open: (T0 < T.cursor ? from : r).openAsks, urgent: (T0 < T.cursor ? from : r).urgent,
    },
    progress: clamp01(T0 / T.end), duck,
  };
}
// Smooth 0→1→0 window with 0.12 s edges.
function win(x, a, b) { return Math.min(clamp01((x - a) / 0.12 + 0.0), clamp01((b - x) / 0.12)); }

function lapseScene(seg, t) {
  const n = seg.b - seg.a + 1, d = seg.dur / n;
  const tau = Math.max(0, t - seg.t0);
  const k = Math.min(n - 1, Math.floor(tau / d));
  const i = seg.a + k, r = rounds[i], prev = rounds[i - 1];
  const f = clamp01((tau - k * d) / d);
  const local = tau - k * d;
  // Sectors may jump each round: a 90 ms settle, never a drift (direct note 2).
  const layout = layoutOf(blend(sizeMaps[i - 1], sizeMaps[i], easeOutCubic(clamp01(local / 0.09))));
  const fc = prev.cursor, tc = r.cursor, same = (fc?.root ?? null) === (tc?.root ?? null);
  const fromA = cursorAngle(fc, layout), toA = cursorAngle(tc, layout);
  const q = clamp01((local - 0.03) / Math.min(0.3, d * 0.8));
  const cursor = same ? { angle: toA, hollow: !tc, c: tc } : { angle: fromA + shortest(fromA, toA) * (tc ? easeOutBack(q) : easeInOutCubic(q)), hollow: !tc, c: tc };
  const roll = key => lerp(prev[key], r[key], f);
  return {
    i, kind: 'lapse', lapse: { a: seg.a, b: seg.b, k, n }, layout, labels: settled[i], cursor,
    callout: same || q >= 1 ? tc : null, calloutAlpha: same ? 1 : clamp01((q - 1) * 4 + (q >= 1 ? 1 : 0)),
    asks: r.askRoots, cursorRoot: tc?.root ?? null, bundle: null, load: lerp(prev.inputs, r.inputs, f),
    inputs: [{ round: prev, T: local + d, mode: 'lapse', d }, { round: r, T: local, mode: 'lapse', d }].filter(x => x.round.index >= seg.a),
    counters: {
      cum: lerp(prev.cumulative, r.cumulative, f), read: roll('inputs'), used: roll('used'), decl: roll('declarations'),
      items: lerp(prev.sectors.length, r.sectors.length, f), blank: roll('blank'), open: roll('openAsks'), urgent: roll('urgent'), rolling: true,
    },
    progress: f, duck: 1,
  };
}

function holdScene(i, extra = {}) {
  const r = rounds[i];
  return {
    i, kind: 'hold', T: T.end, layout: settled[i], labels: settled[i], cursor: { angle: cursorAngle(r.cursor, settled[i]), hollow: !r.cursor, c: r.cursor },
    callout: r.cursor, calloutAlpha: 1, asks: r.askRoots, cursorRoot: r.cursor?.root ?? null,
    bundle: r.cursor ? { round: r, t: 99 } : null, load: r.inputs,
    inputs: r.inputs ? [{ round: r, T: 99, mode: 'rest', target: settled[i] }] : [],
    counters: { cum: r.cumulative, read: r.inputs, used: r.used, decl: r.declarations, items: r.sectors.length, blank: r.blank, open: r.openAsks, urgent: r.urgent },
    progress: 1, duck: 1, ...extra,
  };
}

function introScene(seg, t) {
  const tau = t - seg.t0;
  const s = holdScene(0);
  s.kind = 'intro';
  s.intro = seg.countOut ? { ticks: clamp01((tau - 0.4) / 0.6) * BUDGET, hub: clamp01((tau - 1.0) / 0.25), concept: clamp01((tau - 0.4) / 0.8) } : null;
  if (s.intro && s.intro.hub < 1) s.cursor = { ...s.cursor, alpha: s.intro.hub };
  return s;
}

function jumpScene(seg, t) {
  const q = easeOutCubic(clamp01((t - seg.t0) / seg.dur));
  const s = holdScene(seg.i);
  const layout = layoutOf(blend(sizeMaps[seg.j], sizeMaps[seg.i], q));
  const fromA = cursorAngle(rounds[seg.j].cursor, layout), toA = cursorAngle(rounds[seg.i].cursor, layout);
  return { ...s, kind: 'jump', layout, cursor: { ...s.cursor, angle: fromA + shortest(fromA, toA) * q }, inputs: [], bundle: q >= 1 ? s.bundle : null, calloutAlpha: q };
}

// ---------- player ----------
// Playback time is wall time minus every pause: hovering or opening a sector stops the loop and the continuous play
// at the moment they are in (the concept layer keeps its own clock and keeps moving).
const wall = () => performance.now() / 1000;
const pause = { at: null, total: 0 };
const clock = () => (pause.at ?? wall()) - pause.total;
const player = { mode: 'hero', segs: [], index: 0, firstHero: true, end: 0, freeze: null, followed: false };
function heroSegments(t0, countOut) {
  const { b1, b2, b3 } = hero;
  if (reduced()) {
    return [
      { kind: 'hold', i: 0, t0, dur: HERO.intro },
      { kind: 'hold', i: b1, t0: t0 + HERO.intro, dur: HERO.b1 },
      { kind: 'hold', i: b2[1], t0: t0 + HERO.intro + HERO.b1, dur: HERO.b2 },
      { kind: 'hold', i: b3, t0: t0 + HERO.intro + HERO.b1 + HERO.b2, dur: HERO.b3 },
    ];
  }
  return [
    { kind: 'intro', i: 0, t0, dur: HERO.intro, countOut },
    { kind: 'round', i: b1, j: 0, t0: t0 + HERO.intro, dur: HERO.b1, scale: 1 },
    { kind: 'lapse', a: b2[0], b: b2[1], t0: t0 + HERO.intro + HERO.b1, dur: HERO.b2 },
    { kind: 'round', i: b3, j: b2[1], t0: t0 + HERO.intro + HERO.b1 + HERO.b2, dur: HERO.b3, scale: 1 },
  ];
}
function setURL() {
  const q = new URLSearchParams(location.search);
  q.delete('frame'); q.delete('mode');
  if (player.mode === 'frame') q.set('frame', player.index);
  if (player.mode === 'play') q.set('mode', 'play');
  history.replaceState(null, '', `?${q}`);
}
function startHero(t0 = clock()) {
  player.mode = 'hero';
  player.segs = heroSegments(t0, player.firstHero && !reduced());
  player.firstHero = false;
  player.end = player.segs.at(-1).t0 + player.segs.at(-1).dur;
  setURL(); paintControls();
}
function roundSeg(i, t0, dur = T.end) {
  return reduced() ? { kind: 'hold', i, t0, dur } : { kind: 'round', i, j: Math.max(0, i - 1), t0, dur, scale: dur / T.end };
}
function startPlay(from) {
  player.mode = 'play';
  const i = from >= last ? 1 : Math.max(1, from);
  player.segs = [roundSeg(i, clock())];
  player.end = Infinity;
  setURL(); paintControls();
}
function hold(i, transition) {
  i = Math.max(0, Math.min(last, i));
  const t = clock();
  const prev = player.index;
  player.mode = 'frame';
  player.index = i;
  if (reduced() || !transition || prev === i) player.segs = [{ kind: 'hold', i, t0: t, dur: Infinity }];
  else if (transition === 'step' && i === prev + 1 && i > 0) player.segs = [{ ...roundSeg(i, t, 2.0) }, { kind: 'hold', i, t0: t + 2.0, dur: Infinity }];
  else player.segs = [{ kind: 'jump', i, j: prev, t0: t, dur: 0.5 }, { kind: 'hold', i, t0: t + 0.5, dur: Infinity }];
  player.end = Infinity;
  setURL(); paintControls();
  report(i);
}
function sceneAt(t) {
  if (player.mode === 'hero' && t >= player.end) startHero(player.end);
  let seg = player.segs.find(s => t >= s.t0 && t < s.t0 + s.dur) || player.segs.at(-1);
  if (player.mode === 'play' && t >= seg.t0 + seg.dur) {
    const next = seg.i + 1;
    if (next > last) { hold(last); seg = player.segs[0]; }
    else { player.segs = [roundSeg(next, seg.t0 + seg.dur)]; seg = player.segs[0]; }
  }
  const s = seg.kind === 'intro' ? introScene(seg, t) : seg.kind === 'round' ? roundScene(seg, t)
    : seg.kind === 'lapse' ? lapseScene(seg, t) : seg.kind === 'jump' ? jumpScene(seg, t) : holdScene(seg.i);
  if (player.mode !== 'frame') player.index = s.i;
  return s;
}

// ---------- page ----------
let report = () => {};
let els = {}, g = null;
const sectorEls = new Map(), labelEls = new Map();

function cardHTML() {
  const rows = [['载体', form.carrier], ['场景', form.scene], ['用法', form.usage], ['读者此刻的问题', form.question],
    ['预注意通道', form.channel], ['视觉骨架', `<pre>${esc(form.skeleton)}</pre>`], ['故意舍弃', form.discard],
    ['与其他形式的差异', form.diff], ['配色', form.palette], ['灵感', form.inspiration]];
  const onSite = location.pathname.startsWith('/prototype/');
  const note = path => (onSite ? `/prototype-notes/forms/${path}` : `../${path}.md`);
  return `<div class="fs-card-no">第三轮 · 概念动画 ${String(form.no).padStart(2, '0')}</div><h1>${esc(form.name)}</h1>
    <p class="fs-tagline">${esc(form.tagline)}</p>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${k === '视觉骨架' ? v : esc(v)}</dd>`).join('')}</dl>
    <p class="dl-keys"><kbd>空格</kbd> 连播 / 暂停 · <kbd>←</kbd><kbd>→</kbd> 逐帧并停住 · 默认循环 20 秒</p>
    <p class="dl-keys">悬停或 <kbd>Tab</kbd> 到扇区看概要 · 点击或 <kbd>Enter</kbd> 展开详情 · <kbd>Esc</kbd> 收回；悬停与展开时播放停在当前轮</p>
    <p class="fs-foot">动画只读同一份回放，不写回状态，也不承载作答；详情里的问题链到同一帧的 D 手机首页去回答。${esc(notice)}
      <a href="${note('motion/dial/story')}">story</a> · <a href="${note('motion/dial/spec')}">spec</a> · <a href="${note('CONCEPTS')}">全部概念卡</a> · <a href="${note('INSPIRATION')}">灵感来源</a></p>`;
}

function buildDOM() {
  const params = new URLSearchParams(location.search);
  const hideCard = params.get('card') === '0';
  document.title = `Fold · ${form.name}`;
  document.body.className = `fs-page dl-page${hideCard ? ' fs-no-card' : ''}`;
  const set = datasets[currentDataset()];
  document.body.innerHTML = `<header class="fs-bar dl-bar">
      <a class="fs-home" href="${esc(withDataset('../index.html'))}" title="全部形式">← 形式</a>
      <span class="fs-name"><b>${String(form.no).padStart(2, '0')}</b> ${esc(form.name)}</span>
      <div class="dl-modes" role="group" aria-label="模式"><button type="button" data-mode="hero">循环 20 秒</button><button type="button" data-mode="play">连播 <kbd>空格</kbd></button></div>
      <div class="fs-nav"><button type="button" data-step="-1" aria-label="上一帧（←）">‹</button>
        <div class="fs-when"><span class="fs-date"></span><span class="fs-title"></span></div>
        <button type="button" data-step="1" aria-label="下一帧（→）">›</button></div>
      <div class="fs-ticks" role="group" aria-label="选择帧">${frames.map((f, i) => `<button type="button" data-frame="${i}" title="${esc(`${rounds[i].date} · ${f.id} · ${f.title}`)}"></button>`).join('')}</div>
      <div class="fs-tools"><button type="button" data-card aria-pressed="${!hideCard}">概念卡</button></div>
    </header>
    <div class="fs-body"><main class="dl-stage" tabindex="-1">
      <div class="dl-head">
        <div class="dl-brand"><b>FOLD / 份额拨盘</b><span>${esc(scenario.persona?.name || '')} · ${esc(set.label.split(' · ')[0])}</span></div>
        ${[['cum', '累计输入'], ['read', '本轮 读 · 采用'], ['decl', '声明'], ['ring', '环上 · 留白'], ['asks', '问题 · 要紧']].map(([k, label]) => `<div class="dl-count" data-c="${k}"><small>${label}</small><b></b></div>`).join('')}
        <div class="dl-strip" aria-hidden="true">${frames.slice(1).map(() => '<i><u></u></i>').join('')}</div>
      </div>
      <div class="dl-main">
        <canvas class="dl-field" aria-hidden="true"></canvas>
        <canvas class="dl-marks" aria-hidden="true"></canvas>
        <svg class="dl-ring" aria-label="64 份预算环"><g class="dl-pop"></g><g class="dl-ticks"></g><g class="dl-blank"></g><g class="dl-sectors"></g><g class="dl-asks"></g><path class="dl-xline" pathLength="1"/><g class="dl-labels"></g><path class="dl-leader"/><path class="dl-leader dl-peek-leader"/><g class="dl-cursor"><line class="dl-needle"/><rect class="dl-tag"/><text class="dl-tag-t"></text></g><g class="dl-hub"></g></svg>
        <div class="dl-title"><div class="dl-kicker"></div><h2></h2></div>
        <div class="dl-callout" hidden><div class="dl-c-k"><i></i>要你回 · 要紧</div><div class="dl-c-q"></div><div class="dl-c-d"></div><div class="dl-c-more" hidden></div></div>
      </div>
      <div class="dl-panels">
        <section class="dl-p"><h4>输入 · 片段</h4><div class="dl-feed-w"><div class="dl-feed">${'<div></div>'.repeat(7)}</div></div></section>
        <section class="dl-p"><h4>处置 · 本轮</h4><canvas class="dl-grid"></canvas></section>
        <section class="dl-p"><h4>一轮四段</h4><ol class="dl-pipe">${PHASES.map(([name]) => `<li><span>${name}</span><i><u></u></i></li>`).join('')}</ol></section>
        <section class="dl-p"><h4>已分配 · 逐轮 <b class="dl-alloc-v"></b></h4><canvas class="dl-alloc"></canvas></section>
        <section class="dl-p"><h4>信号 · 窗口</h4><canvas class="dl-wave"></canvas><small class="dl-window"></small></section>
      </div>
    </main><aside class="fs-card" aria-label="概念卡">${cardHTML()}</aside></div>`;
  const $ = s => document.querySelector(s);
  els = {
    stage: $('.dl-stage'), main: $('.dl-main'), field: $('.dl-field'), marks: $('.dl-marks'), ring: $('.dl-ring'),
    ticks: $('.dl-ticks'), blank: $('.dl-blank'), sectors: $('.dl-sectors'), asks: $('.dl-asks'), labels: $('.dl-labels'), hub: $('.dl-hub'),
    cursor: $('.dl-cursor'), needle: $('.dl-needle'), tag: $('.dl-tag'), tagText: $('.dl-tag-t'), leader: $('.dl-leader'),
    title: $('.dl-title'), kicker: $('.dl-kicker'), h2: $('.dl-title h2'),
    callout: $('.dl-callout'), cq: $('.dl-c-q'), cd: $('.dl-c-d'), cmore: $('.dl-c-more'),
    pop: $('.dl-pop'), xline: $('.dl-xline'), peekLeader: $('.dl-peek-leader'),
    panelHeads: [...document.querySelectorAll('.dl-p h4')].map(h => ({ h, text: h.firstChild.textContent })),
    counts: Object.fromEntries([...document.querySelectorAll('.dl-count')].map(el => [el.dataset.c, el.querySelector('b')])),
    strip: [...document.querySelectorAll('.dl-strip i')], feed: $('.dl-feed'), grid: $('.dl-grid'), pipe: [...document.querySelectorAll('.dl-pipe li')],
    alloc: $('.dl-alloc'), allocV: $('.dl-alloc-v'), wave: $('.dl-wave'), window: $('.dl-window'),
    date: $('.fs-date'), barTitle: $('.fs-title'), frameTicks: [...document.querySelectorAll('[data-frame]')], modes: [...document.querySelectorAll('[data-mode]')],
  };
}

function paintControls() {
  for (const b of els.modes || []) b.setAttribute('aria-pressed', String(b.dataset.mode === player.mode));
}

// ---------- geometry ----------
const SVG = 'http://www.w3.org/2000/svg';
const node = (name, attrs = {}, parent) => { const el = document.createElementNS(SVG, name); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); if (parent) parent.append(el); return el; };
const pt = (r, a) => [g.cx + r * Math.cos(a), g.cy + r * Math.sin(a)];
const P = (r, a) => pt(r, a).map(v => v.toFixed(2)).join(',');

function measure() {
  const W = els.main.clientWidth, H = els.main.clientHeight;
  // The ring sits a little left of centre (centred when the concept card is folded) and never moves with the
  // narration: the guard below assumes the title card at its tallest (two lines), whatever it shows now.
  const tb = { x2: els.title.offsetLeft + els.title.offsetWidth, y2: els.title.offsetTop + 116 };
  const R = Math.max(96, Math.min(H * 0.34, W * 0.21, 250));
  const cy = H * 0.53;
  const need = R + 34;
  let cx = Math.max(W * (document.body.classList.contains('fs-no-card') ? 0.5 : 0.45), R + 70);
  if (tb.y2 + 10 > cy - need) { const dy = cy - tb.y2 - 10; cx = Math.max(cx, tb.x2 + 6 + Math.sqrt(Math.max(0, need * need - dy * dy))); }
  cx = Math.min(cx, W - R - 160);
  const laneA = [-24, -12, 0, 12, 24].map(d => (d * Math.PI) / 180);
  // Where a ray from the centre leaves the stage (with room for a lane's label above it).
  const exit = (a, m = 0) => { const c = Math.cos(a), s = Math.sin(a); const ts = [c > 0 ? (W - cx) / c : Infinity, s > 0 ? (H - m - cy) / s : s < 0 ? (m - cy) / s : Infinity]; return Math.min(...ts); };
  return {
    W, H, R, Rin: R * 0.74, cx, cy, dpr: Math.min(2, devicePixelRatio || 1),
    laneIn: R + 58, lanes: laneA.map(a => ({ a, out: exit(a, 20) - 4 })),
    bg: Array.from({ length: 27 }, (_, k) => (-52 + k * 4) * Math.PI / 180).filter(a => laneA.every(b => Math.abs(a - b) > 0.03)).map(a => ({ a, out: exit(a) })),
    glyphR: [70, 84, 98].map(d => R + d), bgIn: R + 110,
  };
}

// Panel canvases keep their CSS size (they stretch with the panel); the stage canvases are pinned to the stage.
function sizeCanvas(canvas, w, h, pin = true) {
  const d = g.dpr;
  if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) { canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); }
  if (pin) { canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return ctx;
}

// The static part of the ring: 64 ticks, the hard stop at 0/64 and the hub's 64. Built once per size; never moved.
function buildStatic() {
  els.ring.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
  els.ticks.replaceChildren(); els.hub.replaceChildren();
  for (let k = 0; k < BUDGET; k += 1) {
    const a = ang(k), major = k % 8 === 0;
    node('line', { x1: pt(g.R + 2, a)[0], y1: pt(g.R + 2, a)[1], x2: pt(g.R + (major ? 13 : 8), a)[0], y2: pt(g.R + (major ? 13 : 8), a)[1], class: major ? 'is-major' : '' }, els.ticks);
    if (major && k) { const [x, y] = pt(g.Rin - 12, a); node('text', { x, y, class: 'dl-tick-n' }, els.ticks).textContent = k; }
  }
  const [sx1, sy1] = pt(g.Rin - 20, STOP), [sx2, sy2] = pt(g.R + 20, STOP);
  node('line', { x1: sx1, y1: sy1, x2: sx2, y2: sy2, class: 'dl-stop' }, els.ticks);
  node('text', { x: sx2 + 6, y: sy2 + 4, class: 'dl-stop-n' }, els.ticks).textContent = '0 / 64';
  // The hub's 64: digits about a sixth of the ring's diameter, so the sector names are read first.
  node('text', { x: g.cx, y: g.cy + g.R * 0.1, class: 'dl-hero', 'font-size': (g.R * 0.46).toFixed(1) }, els.hub).textContent = String(BUDGET);
  node('text', { x: g.cx, y: g.cy + g.R * 0.1 + 22, class: 'dl-hero-s' }, els.hub).textContent = '份 · 每层预算';
  sectorEls.clear(); labelEls.clear(); els.sectors.replaceChildren(); els.labels.replaceChildren(); els.pop.replaceChildren();
  lastKey = ''; calloutSize = null; ticksShown = BUDGET; hubShown = 1; ix?.relayout();
}

function resize() {
  g = measure();
  buildStatic();
  ctxField = sizeCanvas(els.field, g.W, g.H);
  ctxMarks = sizeCanvas(els.marks, g.W, g.H);
  buildField(ctxField);
  for (const c of [els.grid, els.alloc, els.wave]) { c._ctx = null; }
}

// ---------- drawing: SVG ring (information layer) ----------
let lastKey = '', tagWidth = 0, calloutSize = null;
function wedge(a0, a1, r0, r1) {
  if (a1 - a0 < 0.002) return '';
  const A0 = ang(a0), A1 = ang(a1), large = a1 - a0 > BUDGET / 2 ? 1 : 0;
  return `M${P(r1, A0)}A${r1},${r1} 0 ${large} 1 ${P(r1, A1)}L${P(r0, A1)}A${r0},${r0} 0 ${large} 0 ${P(r0, A0)}Z`;
}
function arc(a0, a1, r) {
  if (a1 - a0 < 0.002) return '';
  if (a1 - a0 > BUDGET - 0.01) return `${arc(a0, a0 + BUDGET / 2, r)}${arc(a0 + BUDGET / 2, a1 - 0.005, r)}`;
  return `M${P(r, ang(a0))}A${r},${r} 0 ${a1 - a0 > BUDGET / 2 ? 1 : 0} 1 ${P(r, ang(a1))}`;
}
function drawRing(s) {
  const key = `${[...s.layout.map].map(([id, [a, b]]) => `${id}:${a.toFixed(3)}:${b.toFixed(3)}`).join('|')}#${s.cursorRoot}#${s.cursor.hollow}#${s.labels.used}#${s.asks.join()}#${X.keyFocus}`;
  if (key !== lastKey) {
    lastKey = key;
    const seen = new Set();
    for (const [id, [a0, a1]] of s.layout.map) {
      seen.add(id);
      let el = sectorEls.get(id);
      if (!el) { el = node('path', {}, els.sectors); sectorEls.set(id, el); }
      el.setAttribute('d', wedge(a0, a1, g.Rin, g.R));
      // is-focus: the sector a keyboard user has tabbed to gets an ink outline.
      el.setAttribute('class', `${parity.get(id) ? 'is-b' : 'is-a'}${id === s.cursorRoot ? ' is-cursor' : ''}${id === X.keyFocus ? ' is-focus' : ''}`);
    }
    for (const [id, el] of sectorEls) if (!seen.has(id)) { el.remove(); sectorEls.delete(id); }
    // Blank: the dashed arc between the last sector and the hard stop.
    const used = s.layout.used;
    els.blank.innerHTML = used < BUDGET - 0.01 ? `<path d="${arc(used, BUDGET, g.R)}"/><path d="${arc(used, BUDGET, g.Rin)}"/>` : '';
    // Names and shares: sectors of 6 or more (data.json: 1–3 份不标名字), plus the blank.
    const labels = [];
    for (const [id, [a0, a1]] of s.labels.map) {
      const share = Math.round(a1 - a0);
      // The cursor's sector is named by the cursor's own tag.
      if (share < 6 || (id === s.cursorRoot && !s.cursor.hollow)) continue;
      const live = s.layout.map.get(id);
      const mid = live ? ang((live[0] + live[1]) / 2) : ang((a0 + a1) / 2);
      labels.push({ id, mid, text: `${shortOf(id)} ${share}` });
    }
    const blank = Math.round(BUDGET - s.labels.used);
    // A wide blank is named inside its own empty band; a narrow one just outside, left of the hard stop.
    if (blank >= 2) labels.push({ id: '__blank', mid: ang(Math.min((s.layout.used + BUDGET) / 2, BUDGET - 3.5)), text: `留白 ${blank}`, blank: true, inside: BUDGET - s.layout.used >= 5 });
    const keep = new Set();
    for (const l of labels) {
      keep.add(l.id);
      let el = labelEls.get(l.id);
      if (!el) { el = node('text', l.blank ? {} : { 'data-id': l.id }, els.labels); labelEls.set(l.id, el); }
      const [x, y] = pt(l.inside ? (g.R + g.Rin) / 2 : g.R + 22, l.mid), c = Math.cos(l.mid);
      el.setAttribute('x', x.toFixed(1)); el.setAttribute('y', (y + 4).toFixed(1));
      el.setAttribute('text-anchor', l.inside ? 'middle' : c > 0.25 ? 'start' : c < -0.25 ? 'end' : 'middle');
      el.setAttribute('class', `${l.blank ? 'is-blank' : ''}${l.id === s.cursorRoot ? ' is-cursor' : ''}`);
      if (el.textContent !== l.text) el.textContent = l.text;
    }
    for (const [id, el] of labelEls) if (!keep.has(id)) { el.remove(); labelEls.delete(id); }
    // Other open questions: a small dark-vermilion tick on the outer edge of their sector.
    els.asks.innerHTML = s.asks.map(id => { const m = midOf(s.layout, id); if (m == null) return ''; const [x1, y1] = pt(g.R + 1, m), [x2, y2] = pt(g.R + 9, m); return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`; }).join('');
  }
  paintFocus(s);
  // Cursor: a black needle through the band and a black tag with the item's short name; hollow when nothing is urgent.
  const a = s.cursor.angle, hollow = s.cursor.hollow;
  const tagId = hollow ? '' : s.cursor.c?.root || '';
  if (els.cursor.dataset.id !== tagId) { if (tagId) els.cursor.dataset.id = tagId; else delete els.cursor.dataset.id; }
  const [n1x, n1y] = pt(g.Rin - 8, a), [n2x, n2y] = pt(g.R + 14, a);
  els.needle.setAttribute('x1', n1x); els.needle.setAttribute('y1', n1y); els.needle.setAttribute('x2', n2x); els.needle.setAttribute('y2', n2y);
  els.cursor.setAttribute('class', `dl-cursor${hollow ? ' is-hollow' : ''}`);
  els.cursor.style.opacity = s.cursor.alpha ?? 1;
  const share = s.cursor.c && s.labels.map.get(s.cursor.c.root);
  const label = hollow || !s.cursor.c ? '' : `${shortOf(s.cursor.c.root)}${share ? ` ${Math.round(share[1] - share[0])}` : ''}`;
  if (els.tagText.textContent !== label) { els.tagText.textContent = label; tagWidth = label ? els.tagText.getComputedTextLength() + 16 : 0; }
  const tw = tagWidth;
  const [tx, ty] = pt(g.R + 46, a);
  els.tag.setAttribute('x', (tx - tw / 2).toFixed(1)); els.tag.setAttribute('y', (ty - 11).toFixed(1));
  els.tag.setAttribute('width', tw); els.tag.setAttribute('height', label ? 22 : 0);
  els.tagText.setAttribute('x', tx.toFixed(1)); els.tagText.setAttribute('y', (ty + 4.5).toFixed(1));
  placeCallout(s, tx, ty, tw);
  ix.paint();
}

function placeCallout(s, tx, ty, tw) {
  const c = s.callout;
  // An open detail carries the question itself: the note steps back while the detail card unfolds.
  const alpha = s.calloutAlpha * (1 - X.card);
  const show = c && !s.cursor.hollow && alpha > 0.01;
  els.callout.hidden = !show;
  els.leader.setAttribute('d', '');
  calloutRect = null; calloutInPlace = false;
  if (!show) return;
  const due = c.due || '没有期限';
  // Hovering the cursor's own sector adds the summary to this note instead of opening a second card.
  const more = X.peekId === c.root && X.peek > 0 ? summaryOf(itemFacts(s.i, c.root)) : null;
  const moreKey = more ? `${s.i}:${c.root}` : '';
  if (els.cq.textContent !== c.short || els.cd.textContent !== due || els.cmore.dataset.key !== moreKey || !calloutSize) {
    els.cq.textContent = c.short; els.cd.textContent = due;
    els.cmore.dataset.key = moreKey;
    els.cmore.hidden = !more;
    els.cmore.innerHTML = more ? `<div><b>${esc(more.name)}</b>${more.from ? ` · ${esc(more.from)}` : ''}</div><div>${esc(more.change)}</div><div>${esc(more.inputs)}</div>` : '';
    calloutSize = [els.callout.offsetWidth, els.callout.offsetHeight];
  }
  const [bw, bh] = calloutSize;
  const a = s.cursor.angle, right = Math.cos(a) >= -0.2;
  const t = { x2: els.title.offsetLeft + els.title.offsetWidth, y2: els.title.offsetTop + els.title.offsetHeight };
  // Level with the tag, beside it, then slid sideways until the box clears the ring, the title card and the edges.
  const clear = (x, y) => {
    const nx = Math.max(x, Math.min(g.cx, x + bw)), ny = Math.max(y, Math.min(g.cy, y + bh));
    const offTitle = x > t.x2 + 8 || y > t.y2 + 8;
    return offTitle && Math.hypot(nx - g.cx, ny - g.cy) > g.R + 18;
  };
  const y = Math.max(8, Math.min(g.H - bh - 8, ty - bh / 2));
  let x = null, side = right ? 1 : -1;
  for (const dir of [side, -side]) {
    for (let k = 0; k < 120 && x == null; k += 1) {
      const cand = dir > 0 ? tx + tw / 2 + 22 + k * 6 : tx - tw / 2 - 22 - bw - k * 6;
      if (cand < 8 || cand > g.W - bw - 8) break;
      if (clear(cand, y)) { x = cand; side = dir; }
    }
    if (x != null) break;
  }
  if (x == null) x = Math.max(8, Math.min(g.W - bw - 8, tx + tw / 2 + 22));
  els.callout.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  els.callout.style.opacity = alpha.toFixed(3);
  const ex = side > 0 ? x : x + bw, ey = Math.max(y + 10, Math.min(y + bh - 10, ty));
  els.leader.setAttribute('d', `M${(side > 0 ? tx + tw / 2 : tx - tw / 2).toFixed(1)},${ty.toFixed(1)}L${ex.toFixed(1)},${ey.toFixed(1)}`);
  els.leader.style.opacity = alpha.toFixed(3);
  calloutRect = { x0: x, y0: y, x1: x + bw, y1: y + bh };
  calloutInPlace = Boolean(more);
  if (els.callout.dataset.id !== c.root) els.callout.dataset.id = c.root;
}

// ---------- interaction: hover for a summary, click to open the detail (story.md 交互) ----------
// The state machine, the cards, the keys and touch are the shared module's (ix.mjs); this page tells it what is under
// a point (by angle and radius), where a card hangs and how the leader runs on the ring. The hub's 64, the hard stop
// and the 64 ticks never move, and the ring is never turned: a sector steps out along its own radius and a leader
// carries the eye to the card. Both cards read itemFacts (dial-model.mjs), the same replay the ring is drawn from.
let ix = null;
// What the interaction shows this frame (ix.frame): the focused item, how far the others are dimmed, the open motion.
let X = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
let calloutRect = null, calloutInPlace = false, lastScene = null;

// Others drop to 70 %; the open sector steps out along its radius into a group drawn under the ticks, so the ticks
// stay on top and nothing of the static ring moves.
function paintFocus(s) {
  const op = 1 - 0.3 * X.dim;
  const setOp = (el, v) => { const t = v >= 0.999 ? '' : v.toFixed(3); if (el._op !== t) { el._op = t; el.style.opacity = t; } };
  let shift = '';
  const live = X.popId && X.pop > 0.001 && s.layout.map.get(X.popId);
  if (live) { const m = ang((live[0] + live[1]) / 2), d = IX.pop * X.pop; shift = `translate(${(Math.cos(m) * d).toFixed(2)},${(Math.sin(m) * d).toFixed(2)})`; }
  for (const [id, el] of sectorEls) {
    setOp(el, id === X.focus ? 1 : op);
    const tr = id === X.popId ? shift : '';
    if ((el._tr || '') === tr) continue;
    el._tr = tr;
    if (tr) { if (el.parentNode !== els.pop) els.pop.append(el); el.setAttribute('transform', tr); }
    else { els.sectors.append(el); el.removeAttribute('transform'); }
  }
  for (const [id, el] of labelEls) {
    setOp(el, id === X.focus ? 1 : op);
    const tr = id === X.popId ? shift : '';
    if ((el._tr || '') !== tr) { el._tr = tr; if (tr) el.setAttribute('transform', tr); else el.removeAttribute('transform'); }
  }
}

const titleRect = () => ({ x0: els.title.offsetLeft, y0: els.title.offsetTop, x1: els.title.offsetLeft + els.title.offsetWidth, y1: els.title.offsetTop + els.title.offsetHeight });
// The summary card: beside the hovered sector, level with the point at R + 46 (where the cursor's tag sits), slid away
// from the ring until it clears the ring, the title card, the callout, the name and the tag. It stays on the item's own
// side, trying above and below before the other side, and its leader (from the name, else the rim) never passes over
// the ring. For the cursor's own sector the callout grows in place instead (placeCallout, inPlace).
function peekPlace(id, w, h) {
  const s = lastScene, live = s.layout.map.get(id), m = ang((live[0] + live[1]) / 2);
  const b = labelEls.get(id)?.getBBox();
  const lb = b && b.width ? { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height } : null;
  const tag = s.cursor.hollow || !tagWidth ? null : (([x, y]) => ({ x0: x - tagWidth / 2, y0: y - 11, x1: x + tagWidth / 2, y1: y + 11 }))(pt(g.R + 46, s.cursor.angle));
  const [fx, fy] = lb ? [Math.cos(m) >= 0 ? lb.x1 + 3 : lb.x0 - 3, (lb.y0 + lb.y1) / 2] : pt(g.R + 14, m);
  const [tx, ty] = pt(g.R + 46, m);
  return placeBeside({ at: { x: tx, y: ty }, from: { x: fx, y: fy }, facing: Math.cos(m) >= -0.2 ? 1 : -1, w, h, gap: 22, steps: 120, flush: true,
    bounds: { x0: 8, y0: 8, x1: g.W - 8, y1: g.H - 8 }, avoid: [titleRect(), calloutRect, lb, tag],
    zone: { x: g.cx, y: g.cy, r: g.R + 18 }, leaderZone: { x: g.cx, y: g.cy, r: g.R + 8 } });
}

// Where the detail card goes and the leader's path. The card takes the side the sector faces when there is room (else
// the other side), hugs that edge of the stage and never comes into the hub. The leader leaves the stepped-out sector,
// turns just outside the ticks and, when the sector faces away from the card, runs round the ring to it.
function detailPlace(id, el) {
  const live = lastScene?.layout.map.get(id);
  if (!live) return null;
  const mid = ang((live[0] + live[1]) / 2);
  const title = els.title.offsetTop + els.title.offsetHeight;
  const room = side => (side > 0 ? g.W - (g.cx + g.R + 40) - 12 : g.cx - g.R - 40 - 12);
  let side = Math.cos(mid) >= 0 ? 1 : -1;
  if (room(side) < 260 && room(-side) >= 260) side = -side;
  let w = Math.round(Math.max(240, Math.min(340, room(side))));
  let x = side > 0 ? g.W - 12 - w : 12;
  if (side > 0 && x < g.cx + g.Rin + 10) { x = g.cx + g.Rin + 10; w = g.W - 12 - x; }
  if (side < 0 && x + w > g.cx - g.Rin - 10) w = g.cx - g.Rin - 10 - x;
  const minY = side < 0 ? title + 10 : 10;
  el.style.width = `${w}px`;
  el.style.maxHeight = `${Math.max(160, g.H - minY - 10)}px`;
  const h = el.offsetHeight;
  // The leader leaves the sector at its point nearest the card (kept off the sector's edges, and off the cursor's
  // needle, which sits at the middle of its sector), from the rim where the stepped-out sector now ends.
  const a0 = ang(live[0]), a1 = ang(live[1]), toward = side > 0 ? 0 : Math.PI, TAU = Math.PI * 2;
  const rel = (((toward - a0) % TAU) + TAU) % TAU;
  let m = rel <= a1 - a0 ? a0 + rel : rel - (a1 - a0) < TAU - rel ? a1 : a0;
  const inset = Math.min((a1 - a0) / 2, Math.max((a1 - a0) * 0.18, 0.04));
  m = Math.max(a0 + inset, Math.min(a1 - inset, m));
  const c = Math.cos(m), push = [Math.cos(mid) * IX.pop, Math.sin(mid) * IX.pop];
  const direct = side * c >= 0.5;
  const turn = direct ? m : side > 0 ? (Math.sin(m) <= 0 ? -Math.PI / 3 : Math.PI / 3) : (Math.sin(m) <= 0 ? -2 * Math.PI / 3 : 2 * Math.PI / 3);
  // Just outside the ticks; a run over the top goes higher, clear of the hard stop and its “0 / 64”.
  const over = shortest(m, -Math.PI / 2), run = shortest(m, turn);
  const Rl = g.R + (!direct && Math.sign(over) === Math.sign(run) && Math.abs(over) < Math.abs(run) ? 36 : 18);
  const rim = pt(g.R, m);
  const pts = [[rim[0] + push[0], rim[1] + push[1]], pt(Rl, m)];
  if (!direct) { const d = shortest(m, turn), steps = Math.max(2, Math.ceil(Math.abs(d) * 24)); for (let j = 1; j <= steps; j += 1) pts.push(pt(Rl, m + (d * j) / steps)); }
  const ey = pts.at(-1)[1];
  const y = Math.max(minY, Math.min(g.H - h - 10, ey - h * 0.3));
  const ay = Math.max(y + 14, Math.min(y + h - 14, ey));
  pts.push([side > 0 ? x : x + w, ay]);
  return { x, y, w, h, path: pts.map(([px, py]) => ({ x: px, y: py })) };
}

// Which sector is under a point of the stage: by angle and radius, so it follows the ring however the DOM changes.
function idAt(x, y) {
  const s = lastScene;
  if (!s) return null;
  const dx = x - g.cx, dy = y - g.cy, r = Math.hypot(dx, dy);
  if (r < g.Rin - 4 || r > g.R + 16) return null;
  let u = ((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2)) * BUDGET;
  if (u < 0) u += BUDGET;
  for (const [id, [a0, a1]] of s.layout.map) if (u >= a0 && u < a1 && a1 - a0 > 0.05) return id;
  return null;
}
const itemNamed = name => (lastScene?.layout.map.has(name) ? name : [...(lastScene?.layout.map.keys() || [])].find(id => shortOf(id) === name) || null);

// Sector names, the cursor's tag, its callout and the summary card carry data-id; anything else is hit by geometry.
// Keyboard: one hidden button per sector of the round, clockwise from 0.
function makeIx() {
  return createIx({
    stage: els.main,
    facts: id => itemFacts(lastScene.i, id), index: () => lastScene.i,
    has: id => Boolean(lastScene?.layout.map.has(id)), hit: idAt, named: itemNamed,
    pointOf: id => { const live = lastScene?.layout.map.get(id); if (!live) return null; const [x, y] = pt((g.R + g.Rin) / 2, ang((live[0] + live[1]) / 2)); return { x, y }; },
    // Hovering or opening stops play where it is (clock); the concept layer keeps its own clock.
    pause: () => { pause.at = wall(); }, resume: () => { pause.total += wall() - pause.at; pause.at = null; }, paused: () => pause.at != null,
    last, answerHref: f => withDataset(`../../index.html?variant=d&frame=${f.i}`),
    peekPlace, detailPlace, inPlace: () => calloutInPlace, skip: '.dl-title, .dl-callout',
    leaders: { detail: els.xline, peek: els.peekLeader }, trendH: 34,
    label: '环上的事项：Tab 逐个看概要，Enter 展开详情，Esc 收回',
  });
}

// ---------- drawing: canvas (concept field, information marks) ----------
let ctxField = null, ctxMarks = null;
const laneOf = e => g.lanes[Math.max(0, Math.min(g.lanes.length - 1, e.lane))];
const hash = (k, salt) => { const h = Math.sin(k * 12.9898 + salt * 78.233) * 43758.5453; return h - Math.floor(h); };

function drawMarks(s) {
  const ctx = ctxMarks;
  ctx.clearRect(0, 0, g.W, g.H);
  // The five lanes and their count this round (information: data.json byStream).
  ctx.save();
  ctx.setLineDash([3, 5]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(31,45,38,.32)';
  const counts = rounds[s.i].byLane;
  g.lanes.forEach((L, k) => {
    const [x1, y1] = pt(g.laneIn, L.a), [x2, y2] = pt(L.out, L.a);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.save(); ctx.setLineDash([]);
    ctx.font = '11px ui-monospace, "SF Mono", Menlo, monospace'; ctx.textAlign = 'right';
    const [lx, ly] = pt(L.out - 6, L.a);
    ctx.fillStyle = C.paper; ctx.fillRect(lx - 70, ly - 17, 72, 14);
    ctx.fillStyle = C.ink2;
    ctx.fillText(`${lanes[k].label} ${s.counters.rolling ? '' : counts[k]}`.trim(), lx, ly - 6);
    ctx.restore();
  });
  ctx.restore();
  for (const batch of s.inputs) drawInputs(ctx, batch);
  drawLit(ctx, s);
  if (s.bundle) drawBundle(ctx, s);
}

// Hovered or open: this round's inputs taken into that item light up on their own lanes, parked short of the ring;
// every other mark drops to 30 %. Where they sit on the lane is the same per-event variation the flow uses.
function drawLit(ctx, s) {
  if (!X.focus || X.dim <= 0.01) return;
  ctx.lineCap = 'butt';
  for (const e of rounds[s.i].events) {
    if (e.root !== X.focus) continue;
    const L = laneOf(e);
    const a = L.a + (e.r3 - 0.5) * 0.05;
    drawCluster(ctx, pt(lerp(L.out, g.laneIn, 0.42 + e.r3 * 0.46), a), a, e, 0, X.dim);
  }
  ctx.globalAlpha = 1;
}
function drawCluster(ctx, [x0, y0], a, e, gather, alpha) {
  const size = 3 + Math.floor(e.r3 * 3), ca = Math.cos(a), sa = Math.sin(a);
  ctx.globalAlpha = alpha * (e.machine ? 0.55 : 0.95);
  ctx.strokeStyle = e.machine ? C.ink2 : C.ink;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  for (let m = 0; m < size; m += 1) {
    // Trailing dashes sit further out on the lane, a little to either side; they close up as the input is taken in.
    const back = m * 9 * (1 - gather), side = m ? ((m % 2) * 2 - 1) * 2.4 * (1 - gather) : 0, half = 6 - m * 0.7;
    const x = x0 + ca * back - sa * side, y = y0 + sa * back + ca * side;
    ctx.moveTo(x - ca * half, y - sa * half); ctx.lineTo(x + ca * half, y + sa * half);
  }
  ctx.stroke();
  if (e.self) { ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x0, y0, 6.5, 0, Math.PI * 2); ctx.stroke(); }
}

// The round's real inputs (information layer): each one a small cluster of 3–5 ink dashes running in along its
// lane. Used ones are drawn into their sector, deferred ones park outside the ring, noise and duplicates go out.
function drawInputs(ctx, { round, T: t, mode, d, target }) {
  const n = round.events.length;
  if (!n) return;
  const spread = mode === 'lapse' ? d * 0.8 : T.flow;
  ctx.lineCap = 'butt';
  for (const e of round.events) {
    const L = laneOf(e);
    const spawn = mode === 'rest' ? -9 : (e.k / n) * spread + e.r1 * (mode === 'lapse' ? 0.02 : 0.05);
    const travel = mode === 'lapse' ? 0.24 + e.r2 * 0.16 : T.travel + e.r2 * T.travelJitter;
    let u = (t - spawn) / travel;
    if (u < 0) continue;
    let alpha = 1, r = null, gather = 0, a = L.a + (e.r3 - 0.5) * 0.06 * (1 - Math.min(1, u));
    const disp = e.disposition;
    if (mode === 'rest' && disp !== 'deferred') continue;
    if (disp === 'noise' || disp === 'duplicate' || disp === 'unjudged') {
      const die = 0.5 + e.r3 * 0.35;
      if (u > die + 0.3) continue;
      if (u > die) { alpha = 1 - (u - die) / 0.3; u = die + (u - die) * 0.3; }
    } else if (disp === 'deferred') {
      const park = 0.84 + e.r3 * 0.12;
      if (u > park) u = park;
      if (u >= park) { alpha = 0.5; gather = 0.6; }
      if (mode === 'full' && t > 3.5) alpha *= clamp01(1 - (t - 3.5) / 0.35);
      if (mode === 'lapse' && u >= park) alpha *= clamp01(1 - (t - spawn - travel * park) / 0.2);
      if (mode === 'rest') alpha = 0.45;
      if (alpha <= 0.01) continue;
    } else if (u > 1) {
      // Used: drawn along the rim into its sector; one without an active root fades at the rim.
      const over = (t - spawn - travel) / (0.25 + e.r1 * 0.2);
      if (mode === 'lapse' || !e.root || !target?.map.get(e.root)) { if (over > 0.5) continue; alpha = 1 - over * 2; u = 1; }
      else {
        const goal = midOf(target, e.root);
        if (over > 1.25) continue;
        if (over > 1) { flash(ctx, goal, 1 - (over - 1) / 0.25); continue; }
        const w = easeInOutCubic(clamp01(over));
        a = L.a + shortest(L.a, goal) * w;
        r = lerp(g.laneIn, (g.R + g.Rin) / 2, w * w);
        gather = w;
      }
    }
    if (r == null) r = lerp(L.out, g.laneIn, Math.min(1, u));
    // While an item is hovered or open its own marks move to their lit places (drawLit); the rest drop to 30 %.
    const focus = X.dim > 0 ? (X.focus && e.root === X.focus ? 1 - X.dim : 1 - 0.7 * X.dim) : 1;
    if (alpha * focus <= 0.01) continue;
    drawCluster(ctx, pt(r, a), a, e, gather, alpha * focus);
  }
  ctx.globalAlpha = 1;
}
function flash(ctx, a, alpha) {
  ctx.globalAlpha = alpha * 0.8; ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R + 1.5, a - 0.035, a + 0.035); ctx.stroke();
  ctx.globalAlpha = 1;
}

// The bundle: one line for each used input related to the cursor's item. The lines come in from far off the left
// edge, slightly fanned out, swing onto an orbit just outside the ring, run round it and converge on the tag.
function bundlePath(k, n, end, tw) {
  const f = n > 1 ? k / (n - 1) : 0.5;
  const delta = shortest(Math.PI, end), dir = delta >= 0 ? 1 : -1;
  const rho = g.R + 34 + f * 22, ex = g.cx - rho, ey = g.cy;
  const fan = Math.min(g.H * 0.5, 70 + n * 12);
  const y0 = Math.max(12, Math.min(g.H - 12, g.cy + dir * g.H * 0.2 + (f - 0.5) * fan));
  const x0 = -12, pts = [];
  // From the edge: a cubic that arrives at the orbit's leftmost point already moving along the orbit.
  const c1x = x0 + (ex - x0) * 0.5, c1y = y0, c2x = ex, c2y = ey + dir * 80;
  for (let j = 0; j <= 28; j += 1) {
    const u = j / 28, v = 1 - u;
    pts.push([v ** 3 * x0 + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u ** 3 * ex, v ** 3 * y0 + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u ** 3 * ey]);
  }
  // Round the ring, closing in to the tag's radius over the last part and stopping at the tag's edge.
  const stop = (tw / 2 + 6) / (g.R + 46);
  const sweep = Math.abs(delta) > stop ? delta - dir * stop : 0;
  const steps = Math.max(4, Math.round(Math.abs(sweep) * 18));
  for (let j = 1; j <= steps; j += 1) {
    const u = j / steps, rr = lerp(rho, g.R + 46, easeInOutCubic(clamp01((u - 0.6) / 0.4)));
    pts.push(pt(rr, Math.PI + sweep * u));
  }
  return pts;
}
function drawBundle(ctx, s) {
  const { round, t } = s.bundle;
  const list = round.related, n = list.length;
  if (!n || s.cursor.hollow) return;
  const step = n > 1 ? Math.min(0.1, 0.4 / (n - 1)) : 0;
  ctx.save();
  // The bundle belongs to the cursor's item: it stays when that item is the one in focus, and dims with the rest otherwise.
  ctx.globalAlpha = 0.7 * (X.focus && X.focus !== s.cursorRoot ? 1 - 0.7 * X.dim : 1); ctx.strokeStyle = C.ink; ctx.lineJoin = 'round';
  for (let k = 0; k < n; k += 1) {
    const q = easeOutCubic(clamp01((t - k * step) / T.bundleDur));
    if (q <= 0) continue;
    const pts = bundlePath(k, n, s.cursor.angle, tagWidth);
    // Draw the first q of the path by length.
    let total = 0;
    for (let j = 1; j < pts.length; j += 1) total += Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
    let left = total * q;
    ctx.lineWidth = 1.5 + (k % 3) * 0.25;
    ctx.beginPath(); ctx.moveTo(...pts[0]);
    for (let j = 1; j < pts.length && left > 0; j += 1) {
      const [ax, ay] = pts[j - 1], [bx, by] = pts[j], seg = Math.hypot(bx - ax, by - ay);
      if (seg <= left) ctx.lineTo(bx, by); else ctx.lineTo(ax + (bx - ax) * (left / seg), ay + (by - ay) * (left / seg));
      left -= seg;
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Concept layer: traffic on every lane, three rows of glyphs round the ring, wires on the left. Grey only, no
// readable numbers, never inside the hub; it keeps running across cuts and dims while the information moves.
const GLYPH_FONT = '8.5px ui-monospace, "SF Mono", Menlo, monospace';
const TIERS = [
  { name: 'far', speed: 30, half: 3, width: 2, color: 'rgba(93,107,99,0.32)' },
  { name: 'mid', speed: 54, half: 4.5, width: 2.6, color: 'rgba(60,74,67,0.58)' },
  { name: 'near', speed: 88, half: 6, width: 3.4, color: 'rgba(31,45,38,0.86)' },
];
const MAX_CLUSTERS = 11;
let traffic = [], glyphRows = [];
const glyphTexts = [...new Set(rounds.flatMap(r => [...r.fragments, ...r.channels.slice(0, 8)])
  .map(text => text.replace(/\d/g, '·').slice(0, 14)).filter(text => text.trim().length > 3))];
const wires = Array.from({ length: 30 }, (_, k) => ({ y: k / 30, f: hash(k, 3) }));

function buildField(ctx) {
  // Clusters of 3–5 dashes on each lane, in three depths: far ones small, light and slow; near ones large, nearly ink.
  const all = [...g.lanes.map(L => ({ ...L, from: g.laneIn, main: true })), ...g.bg.map(L => ({ ...L, from: g.bgIn, main: false }))];
  traffic = all.filter(L => L.out - L.from > 40).map((L, li) => ({
    ...L,
    clusters: Array.from({ length: MAX_CLUSTERS }, (_, m) => {
      const h = hash(li * 31 + m, 1), tier = h < 0.4 ? 0 : h < 0.75 ? 1 : 2;
      return { tier, speed: TIERS[tier].speed * (0.85 + hash(li * 31 + m, 2) * 0.3), phase: hash(li * 31 + m, 4),
        size: 3 + Math.floor(hash(li * 31 + m, 5) * 3), side: (hash(li * 31 + m, 6) - 0.5) * 5 };
    }),
  }));
  // Three rows of field fragments and bit blocks, evenly spaced round the ring, upright along the tangent.
  ctx.font = GLYPH_FONT;
  let next = 0;
  glyphRows = g.glyphR.map((rad, row) => {
    const items = [];
    const circ = Math.PI * 2 * rad, gap = 14;
    let used = 0;
    for (;;) {
      const block = items.length % 4 === 3;
      const text = block ? '' : glyphTexts[(next += 7) % Math.max(1, glyphTexts.length)] || '';
      const w = block ? 12 : ctx.measureText(text).width;
      if (used + w + gap > circ) break;
      items.push({ block, text, w, bits: Math.floor(hash(items.length + row * 97, 7) * 4096), dark: (items.length + row) % 2 === 0 });
      used += w + gap;
    }
    const space = (circ - items.reduce((sum, it) => sum + it.w, 0)) / Math.max(1, items.length);
    let pos = 0;
    for (const it of items) { it.a = (pos + it.w / 2) / rad; pos += it.w + space; }
    return { rad, items, speed: [0.012, -0.009, 0.016][row] };
  });
}

function drawField(s, c) {
  const ctx = ctxField;
  ctx.clearRect(0, 0, g.W, g.H);
  // Down to 40 % while the information moves (s.duck) and while a sector is hovered or open (X.dim).
  const alpha = (s.intro ? s.intro.concept : 1) * Math.min(s.duck, 1 - 0.6 * X.dim);
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  drawTraffic(ctx, s, c);
  drawGlyphs(ctx, c);
  drawWires(ctx, c);
  ctx.restore();
}

function drawTraffic(ctx, s, c) {
  // Busier rounds put more clusters on every lane; the count follows the round's inputs (it eases between rounds).
  const busy = Math.max(0.5, Math.min(2.6, 0.45 + (s.load ?? 0) / 90));
  const paths = TIERS.map(() => [new Path2D(), new Path2D()]);
  for (const L of traffic) {
    const len = L.out - L.from, ca = Math.cos(L.a), sa = Math.sin(L.a);
    const shown = (L.main ? 4 : 2.6) * busy;
    for (let m = 0; m < MAX_CLUSTERS; m += 1) {
      const vis = clamp01(shown - m);
      if (vis <= 0) break;
      const cl = L.clusters[m], tier = TIERS[cl.tier];
      const u = (cl.phase + (c * cl.speed) / len) % 1;
      const r = L.out - u * len;
      const fade = Math.min(1, (L.out - r) / 30, (r - L.from) / 40) * vis;
      if (fade <= 0.05) continue;
      const path = paths[cl.tier][fade > 0.6 ? 0 : 1];
      for (let k = 0; k < cl.size; k += 1) {
        const rr = r + k * (tier.half * 2 + 4), side = cl.side + (k ? ((k % 2) * 2 - 1) * 1.8 : 0);
        if (rr > L.out) break;
        const x = g.cx + rr * ca - sa * side, y = g.cy + rr * sa + ca * side;
        path.moveTo(x - ca * tier.half, y - sa * tier.half); path.lineTo(x + ca * tier.half, y + sa * tier.half);
      }
    }
  }
  const base = ctx.globalAlpha;
  TIERS.forEach((tier, k) => {
    ctx.strokeStyle = tier.color; ctx.lineWidth = tier.width;
    ctx.globalAlpha = base; ctx.stroke(paths[k][0]);
    ctx.globalAlpha = base * 0.45; ctx.stroke(paths[k][1]);
  });
  ctx.globalAlpha = base;
}

function drawGlyphs(ctx, c) {
  // Each row turns at its own pace, with an eased surge every two seconds (spec.md: two surges per 4 s).
  const surge = Math.floor(c / 2) + easeInOutCubic((c / 2) % 1);
  const d = g.dpr;
  ctx.font = GLYPH_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  glyphRows.forEach(row => {
    const phi = c * row.speed + Math.sign(row.speed) * 0.03 * surge;
    for (const it of row.items) {
      const a = it.a + phi;
      const x = g.cx + row.rad * Math.cos(a), y = g.cy + row.rad * Math.sin(a);
      if (x < -40 || x > g.W + 40 || y < -40 || y > g.H + 40) continue;
      // Along the tangent and always the right way up.
      let rot = a + Math.PI / 2;
      if (Math.cos(rot) < 0) rot += Math.PI;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      ctx.setTransform(d * cr, d * sr, -d * sr, d * cr, d * x, d * y);
      if (it.block) {
        ctx.fillStyle = it.dark ? 'rgba(31,45,38,.32)' : 'rgba(31,45,38,.16)';
        for (let b = 0; b < 12; b += 1) if (it.bits >> b & 1) ctx.fillRect((b % 4) * 3.2 - 6, Math.floor(b / 4) * 3.2 - 4.5, 2.4, 2.4);
      } else {
        ctx.fillStyle = it.dark ? 'rgba(70,84,77,.62)' : 'rgba(93,107,99,.34)';
        ctx.fillText(it.text, 0, 0);
      }
    }
  });
  ctx.setTransform(d, 0, 0, d, 0, 0);
}

function drawWires(ctx, c) {
  // Thin wires from the left edge to just outside the glyph rows, drifting.
  ctx.lineWidth = 0.7;
  for (const w of wires) {
    const a = Math.PI * (0.62 + w.f * 0.76), [ex, ey] = pt(g.R + 108, a);
    const sy = g.H * w.y, sway = Math.sin(c * 0.35 + w.f * 9) * 18;
    ctx.strokeStyle = `rgba(31,45,38,${(0.04 + w.f * 0.07).toFixed(3)})`;
    ctx.beginPath(); ctx.moveTo(0, sy);
    ctx.bezierCurveTo(g.W * 0.08, sy + sway, ex + 90 * Math.cos(a), ey + sway * 0.5, ex, ey);
    ctx.stroke();
  }
}

// ---------- header, title card, panels ----------
const cache = new Map();
const put = (el, text) => { if (cache.get(el) !== text) { cache.set(el, text); el.textContent = text; } };

function paintText(s) {
  const r = rounds[s.i], c = s.counters;
  put(els.counts.cum, fmt(c.cum));
  put(els.counts.read, `${fmt(c.read)} · ${fmt(c.used)}`);
  put(els.counts.decl, fmt(c.decl));
  put(els.counts.ring, `${fmt(c.items)} 件 · ${fmt(c.blank)} 份`);
  put(els.counts.asks, `${fmt(c.open)} · ${fmt(c.urgent)}`);
  els.strip.forEach((el, k) => {
    const n = k + 1;
    const fill = n < s.i ? 1 : n === s.i ? (s.kind === 'hold' || s.kind === 'jump' ? 1 : s.progress) : 0;
    const key = `${fill.toFixed(2)}`;
    if (el.dataset.f !== key) { el.dataset.f = key; el.firstChild.style.transform = `scaleX(${fill})`; }
  });
  const total = frames.length - 1;
  const view = X.detail ? ix.view : null;
  if (view) {
    // The open item's own title card: one hard cut on open, one on close.
    put(els.kicker, `这一件 · ${r.id} · ${r.date}`);
    put(els.h2, `第 ${view.i} 轮 · ${view.short}`);
  } else if (s.kind === 'lapse') {
    put(els.kicker, `快进 · 第 ${s.i} / ${total} 轮 · ${r.date}`);
    put(els.h2, `${s.lapse.n} 轮，每轮 ${(HERO.b2 / s.lapse.n).toFixed(2)} 秒`);
  } else {
    put(els.kicker, `${r.initial ? '空状态' : `第 ${s.i} / ${total} 轮${r.review ? ' · 定时' : ''}`} · ${r.id} · ${r.date}`);
    put(els.h2, r.title);
  }
  put(els.date, `${r.date} · ${r.id}`);
  put(els.barTitle, r.title);
  els.frameTicks.forEach((b, k) => b.classList.toggle('is-on', k === s.i));
  // Pipeline: each phase fills during its window (B's dispatch bars).
  els.pipe.forEach((li, k) => {
    const [, a, b] = PHASES[k];
    // Open item: a phase is full and in ink when it touched this item this round (itemFacts phases), else empty.
    const f = view ? Number(view.phases[k]) : s.kind === 'round' ? clamp01((s.T - a) / (b - a)) : s.kind === 'lapse' ? s.progress : s.kind === 'hold' ? 1 : 0;
    const key = `${f.toFixed(2)}${view ? 'v' : ''}`;
    if (li.dataset.f !== key) { li.dataset.f = key; li.querySelector('u').style.transform = `scaleX(${f})`; li.classList.toggle('is-on', view ? f === 1 : f > 0 && f < 1); }
  });
  els.panelHeads.forEach(({ h, text }, k) => { const t = view ? PANEL_ITEM[k] : text; if (h.firstChild.textContent !== t) h.firstChild.textContent = t; });
  put(els.allocV, `${view ? view.share : Math.round(s.kind === 'round' && s.T < T.shares ? rounds[Math.max(0, s.i - 1)].allocated : r.allocated)} / ${BUDGET}`);
  put(els.window, r.window ? `${fmtShort(r.window.from)} → ${fmtShort(r.window.to)}` : '—');
}
const shortFmt = new Intl.DateTimeFormat('en-GB', { timeZone: scenario.timeZone || 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtShort = at => { const p = Object.fromEntries(shortFmt.formatToParts(new Date(at)).map(x => [x.type, x.value])); return `${p.month}-${p.day} ${p.hour}:${p.minute}`; };

function panelCtx(canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  if (!canvas._ctx || canvas._w !== w || canvas._h !== h) { canvas._w = w; canvas._h = h; canvas._ctx = sizeCanvas(canvas, w, h, false); }
  return canvas._ctx;
}
// The five panels move with the round: the feed rolls in a line per arriving input, the disposition grid lights a
// cell per input, the allocation line grows by one round when the shares land, and the signal window steps along
// the fortnight at each cut. Between beats the feed keeps scrolling and the grid is swept, so stills never freeze.
const FEED_LINES = 7, FEED_H = 12;
const span = (() => {
  const ws = rounds.map(r => r.window).filter(Boolean);
  const from = Math.min(...ws.map(w => Date.parse(w.from)), Date.parse(frames[0].at));
  const to = Math.max(...ws.map(w => Date.parse(w.to)), Date.parse(frames[last].at));
  return { from, to };
})();
function feedPosition(s, c, n) {
  if (s.kind === 'round') { const flow = T.flow + T.travel; return s.T < flow ? n * clamp01((s.T - 0.3) / (flow - 0.3)) : n + (s.T - flow) * 2.5; }
  if (s.kind === 'lapse') return s.progress * n;
  return c * 2.5;
}
// While one item is open every panel takes its view (story.md 交互): the feed rolls only its inputs, the grid lights
// only its cells, the allocation line is its share, and its inputs are ticked on the signal axis.
function paintPanels(s, c) {
  const r = rounds[s.i];
  const view = X.detail ? ix.view : null;
  const mine = view ? new Set(view.inputs.map(x => x.k)) : null;
  const n = view ? view.inputs.length : r.events.length;
  // 输入 · 片段: digits blanked, the concept layer shows no readable numbers (story.md).
  const lines = view ? (view.inputs.length ? view.inputs.map(x => `${x.source.slice(0, 10)} · used · ${view.id.slice(0, 12)}`.replace(/\d/g, '·')) : ['—'])
    : r.channels.length ? r.channels.map(line => line.replace(/\d/g, '·')) : ['—'];
  const p = Math.max(0, view ? c * 2.5 : feedPosition(s, c, n)), base = Math.floor(p);
  const key = `${s.i}:${view?.id || ''}:${base}`;
  if (els.feed.dataset.key !== key) {
    els.feed.dataset.key = key;
    [...els.feed.children].forEach((div, k) => {
      const idx = base - (FEED_LINES - 1) + k;
      div.textContent = n && idx >= 0 ? lines[idx % lines.length] : '';
    });
  }
  els.feed.style.transform = `translateY(${((1 - (p - base)) * FEED_H).toFixed(1)}px)`;
  // 处置 · 本轮: one cell per input, lit (with a short flash) as it arrives; swept by a slow highlight between beats.
  let ctx = panelCtx(els.grid);
  if (ctx) {
    const w = els.grid._w, h = els.grid._h, cols = 24, rows = 10, cw = w / cols, ch = h / rows;
    ctx.clearRect(0, 0, w, h);
    const sweep = Math.floor(c * 30) % (cols * rows);
    for (let k = 0; k < cols * rows; k += 1) {
      const e = r.events[k];
      const at = (k / Math.max(1, n)) * T.flow + T.travel;
      const age = s.kind === 'round' ? s.T - at : s.kind === 'lapse' ? (s.progress - (k / Math.max(1, n)) * 0.8) * (HERO.b2 / s.lapse.n) : 9;
      let alpha;
      if (!e) alpha = 0.04 + (Math.abs(k - sweep) < 3 ? 0.08 : 0);
      else if (mine) alpha = mine.has(k) ? 0.62 + (Math.abs(k - sweep) < 2 ? 0.2 : 0) : 0.05;
      else if (age < 0) alpha = 0.06;
      else {
        const shade = e.disposition === 'used' ? 0.62 : e.disposition === 'deferred' ? 0.3 : 0.13;
        alpha = age < 0.3 ? lerp(0.95, shade, age / 0.3) : shade + (Math.abs(k - sweep) < 2 ? 0.15 : 0);
      }
      ctx.fillStyle = `rgba(31,45,38,${alpha.toFixed(3)})`;
      ctx.fillRect((k % cols) * cw + 0.5, Math.floor(k / cols) * ch + 0.5, cw - 1.5, ch - 1.5);
    }
  }
  // 已分配 · 逐轮 (information: data.json rounds.allocated): the line grows one round as the shares land.
  ctx = panelCtx(els.alloc);
  if (ctx) {
    const w = els.alloc._w, h = els.alloc._h, m = rounds.length - 1;
    ctx.clearRect(0, 0, w, h);
    const x = k => 4 + ((k - 1) / Math.max(1, m - 1)) * (w - 30), y = v => h - 4 - (v / BUDGET) * (h - 12);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, y(BUDGET)); ctx.lineTo(w, y(BUDGET)); ctx.stroke();
    ctx.font = '9px ui-monospace, Menlo, monospace'; ctx.fillStyle = C.ink2; ctx.textAlign = 'right'; ctx.fillText('64', w, y(BUDGET) + 10);
    // The open item's view draws its own share instead of the whole ring's allocation, on the same 0–64 scale.
    const v = k => (view ? view.trend[k] : rounds[k].allocated);
    const grow = view ? 1 : s.kind === 'round' ? clamp01((s.T - T.shares) / T.sharesDur) : s.kind === 'lapse' ? clamp01(s.progress * 4) : 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(31,45,38,.15)'; ctx.beginPath();
    for (let k = 1; k <= m; k += 1) { if (k === 1) ctx.moveTo(x(k), y(v(k))); else ctx.lineTo(x(k), y(v(k))); }
    ctx.stroke();
    let hx = null, hy = null;
    if (s.i >= 1) {
      ctx.strokeStyle = C.ink; ctx.beginPath();
      ctx.moveTo(x(1), y(v(1)));
      for (let k = 2; k < s.i; k += 1) ctx.lineTo(x(k), y(v(k)));
      if (s.i === 1) { hx = x(1); hy = y(v(1)); }
      else { hx = lerp(x(s.i - 1), x(s.i), grow); hy = lerp(y(v(s.i - 1)), y(v(s.i)), grow); ctx.lineTo(hx, hy); }
      ctx.stroke();
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 信号 · 窗口: the fortnight as an axis, this round's signal window as a bracket that steps along at each cut,
  // and a grey waveform running inside it (texture).
  ctx = panelCtx(els.wave);
  if (ctx) {
    const w = els.wave._w, h = els.wave._h;
    ctx.clearRect(0, 0, w, h);
    const prev = rounds[Math.max(0, s.i - 1)].window || r.window, cur = r.window;
    // The open item's view zooms the axis to this round's window, so its inputs can be told apart.
    const axis = view && cur ? { from: Date.parse(cur.from), to: Date.parse(cur.to) } : span;
    const X = at => 2 + ((at - axis.from) / Math.max(1, axis.to - axis.from)) * (w - 4);
    const move = view ? 1 : s.kind === 'round' ? easeOutCubic(clamp01(s.T / 0.4)) : s.kind === 'lapse' ? easeOutCubic(clamp01(s.progress * 3)) : 1;
    const axisY = h - 3;
    ctx.strokeStyle = 'rgba(31,45,38,.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, axisY); ctx.lineTo(w, axisY); ctx.stroke();
    for (const fr of frames) { const fx = X(Date.parse(fr.at)); ctx.beginPath(); ctx.moveTo(fx, axisY); ctx.lineTo(fx, axisY - 3); ctx.stroke(); }
    let x0 = 0, x1 = w;
    if (cur) {
      x0 = lerp(X(Date.parse(prev.from)), X(Date.parse(cur.from)), move);
      x1 = Math.max(x0 + 3, lerp(X(Date.parse(prev.to)), X(Date.parse(cur.to)), move));
      ctx.fillStyle = 'rgba(31,45,38,.1)'; ctx.fillRect(x0, 0, x1 - x0, axisY);
      ctx.fillStyle = C.ink; ctx.fillRect(x0, axisY - 1.5, x1 - x0, 3);
    }
    // The open item: when each of its inputs this round arrived, as ink ticks inside the window.
    if (view) { ctx.fillStyle = C.ink; for (const input of view.inputs) ctx.fillRect(Math.max(x0, Math.min(x1 - 1.5, X(input.at) - 0.75)), axisY - 12, 1.5, 9); }
    ctx.strokeStyle = 'rgba(31,45,38,.45)'; ctx.lineWidth = 1;
    for (const [amp, off] of [[0.3, 0.3], [0.2, 0.62]]) {
      ctx.beginPath();
      for (let px = 0; px <= w; px += 2) {
        const inside = px >= x0 && px <= x1 ? 1 : 0.35;
        const v = (Math.sin(px * 0.07 + c * 2.1 + off * 9) * 0.6 + Math.sin(px * 0.023 - c * 0.9) * 0.4 + (Math.sin(px * 1.7 + c * 13) > 0.97 ? 0.8 : 0)) * inside;
        const py = h * off + v * h * amp * 0.5;
        if (px) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
  }
}

// ---------- loop ----------
let conceptClock = 0, lastT = null;
// ?perf or foldDial.resetPerf(): frame intervals and the script time spent per frame.
const perf = { on: new URLSearchParams(location.search).has('perf'), times: [], work: [] };
function frame(now) {
  const w = now / 1000;
  const dt = lastT == null ? 0 : Math.min(0.1, w - lastT);
  if (perf.on && lastT != null) perf.times.push(w - lastT);
  lastT = w;
  // Playback time stands still while a sector is hovered or open (see clock); the concept layer runs on wall time.
  let t = Math.max(0, (pause.at ?? w) - pause.total);
  // ?at=<seconds>: a still of the hero at that moment (for stills and checks); any control releases it.
  if (player.freeze != null && player.mode === 'hero') { t = player.segs[0].t0 + player.freeze; conceptClock = player.freeze; }
  const s = sceneAt(t);
  lastScene = s;
  X = ix.frame();
  // First open: 0.4 s of stillness, the concept layer included (direct note 1).
  if (player.freeze == null && !reduced() && !(s.intro && s.intro.concept === 0)) conceptClock += dt;
  paintTicks(s.intro ? s.intro.ticks : BUDGET, s.intro ? s.intro.hub : 1);
  drawField(s, conceptClock);
  drawMarks(s);
  drawRing(s);
  paintText(s);
  paintPanels(s, conceptClock);
  ix.sync(s.i, () => rounds[s.i].sectors.map(x => ({ id: x.id, label: `${x.short} ${x.share} 份` })));
  if (perf.on) perf.work.push(performance.now() - now);
  requestAnimationFrame(frame);
}
// The count-out on first open: ticks appear clockwise once, then the hub's 64. After that nothing here changes.
let ticksShown = BUDGET, hubShown = 1;
function paintTicks(n, hub) {
  const k = Math.floor(n);
  if (k !== ticksShown) {
    ticksShown = k;
    els.ticks.querySelectorAll('line:not(.dl-stop)').forEach((el, j) => { el.style.opacity = j < k ? '' : '0'; });
    els.ticks.querySelectorAll('text').forEach(el => { el.style.opacity = k >= BUDGET ? '' : '0'; });
  }
  // The blank's dashed arc and its label arrive with the hub, not before the ticks are counted.
  if (hub !== hubShown) { hubShown = hub; for (const el of [els.hub, els.blank, els.labels]) el.style.opacity = hub >= 1 ? '' : String(hub); }
}

// ---------- boot ----------
export function boot() {
  keepDataset();
  buildDOM();
  ix = makeIx();
  resize();
  const params = new URLSearchParams(location.search);
  const asked = params.get('frame');
  const byId = asked == null ? -1 : frames.findIndex(f => f.id === asked);
  const index = asked == null ? null : byId >= 0 ? byId : Number(asked);
  // Inside all.html the page follows the bar's frame: single-frame only, no loop and no continuous play.
  // Embedded without a frame (the gallery thumbnail, the site's viewer) it plays the loop like a page of its own.
  const follow = () => { document.body.classList.add('dl-followed'); player.followed = true; };
  report = followFrames(i => { follow(); player.freeze = null; ix.reset(); hold(i, 'jump'); });
  if (window.parent !== window && asked != null) follow();
  if (Number.isInteger(index) && index >= 0 && index <= last) {
    player.index = index;
    if (params.get('mode') === 'play' && !player.followed) startPlay(index); else hold(index);
  } else if (params.get('mode') === 'play') startPlay(1);
  else {
    startHero();
    const at = Number(params.get('at'));
    if (params.has('at') && at >= 0 && at < 20) player.freeze = at;
  }
  document.addEventListener('click', event => {
    const b = event.target.closest('button');
    // The keyboard proxies and the detail's own buttons are the interaction module's (ix.mjs).
    if (!b || ix.owns(b)) return;
    player.freeze = null;
    // Navigation drops hover and detail at once, then does what it says.
    if (b.dataset.step || b.dataset.frame || b.dataset.mode) ix.reset();
    if (b.dataset.step) hold(player.index + Number(b.dataset.step), 'step');
    else if (b.dataset.frame) hold(Number(b.dataset.frame), 'jump');
    else if (b.dataset.mode === 'hero' && !player.followed) { player.firstHero = false; startHero(); }
    else if (b.dataset.mode === 'play' && !player.followed) startPlay(player.mode === 'frame' ? player.index + 1 : 1);
    else if ('card' in b.dataset) {
      const off = document.body.classList.toggle('fs-no-card');
      b.setAttribute('aria-pressed', String(!off));
      resize();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.target.matches?.('input,textarea,select,[contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
    // Esc folds the open detail back (or drops the summary): the interaction module's, as are Enter and Space on a
    // sector or in the card.
    if (event.key === 'Escape') return;
    player.freeze = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); ix.reset(); hold(player.index + (event.key === 'ArrowLeft' ? -1 : 1), 'step'); }
    if (event.key === ' ' && !player.followed) {
      event.preventDefault();
      ix.reset();
      if (player.mode === 'play') hold(player.index);
      else startPlay(player.mode === 'frame' ? player.index + 1 : 1);
    }
  });
  // Re-measure whenever the stage changes size (also once styles and fonts have settled). The ring does not follow
  // the title card's height, so a one-line and a two-line narration leave it where it is.
  let timer = null, seen = '';
  const remeasure = () => {
    const key = `${els.main.clientWidth}x${els.main.clientHeight}`;
    if (key !== seen) { seen = key; clearTimeout(timer); timer = setTimeout(resize, 60); }
  };
  new ResizeObserver(remeasure).observe(els.main);
  document.fonts?.ready.then(() => { seen = ''; remeasure(); });
  window.foldDial = {
    player, rounds, hold, startPlay, startHero,
    perf: () => {
      const ts = perf.times.slice(1), avg = ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length);
      const p95 = list => [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.95)] || 0;
      const work = perf.work.slice(1);
      return { frames: ts.length, fps: +(1 / avg).toFixed(1), p95ms: +(p95(ts) * 1000).toFixed(1),
        workMs: +(work.reduce((a, b) => a + b, 0) / Math.max(1, work.length)).toFixed(2), workP95ms: +p95(work).toFixed(2) };
    },
    resetPerf: () => { perf.on = true; perf.times = []; perf.work = []; },
    // Test hooks for stills and checks (ix.mjs): hover / unhover / open / close / ixAt / ix / paused / pointOf / ixState,
    // an item by id or by its short name on the ring (主水管, 猫看病). ixAt(seconds) pins the open or close motion.
    ...ix.hooks(),
    // The ring's centre and radii on the stage (scripts/check-ix.mjs aims just outside the rim).
    geom: () => ({ cx: g.cx, cy: g.cy, R: g.R, Rin: g.Rin }),
  };
  requestAnimationFrame(frame);
}
