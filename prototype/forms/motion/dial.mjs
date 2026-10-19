// 份额拨盘（dial）：官网用的概念动画，也能逐帧停下。读其他形式共用的同一份回放，不另造数据，不改契约。
// 两层（story.md）：概念层约八成，灰阶、可密、一直动、跨切点不断；信息层约两成，墨黑加一个朱红，只在节拍上动，
// 每个数字都能在 dial/data.json 里对上。画法：canvas 画车道、记号与线束，SVG 只画环与文字。
//
// 模式：默认 hero（20 秒三拍循环）；空格连播全部轮次（每轮 4 秒）；←/→ 逐帧并停住；?frame= 直接停在那帧；
// 被合页 all.html 用 followFrames 驱动时只走单帧。prefers-reduced-motion 时每拍直接到终态，概念层不动。
import { notice, frames, rounds, lanes, hero, BUDGET, orderOf, shortOf, scenario } from './dial-model.mjs';
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
// The cursor swings 0.5 s, the bundle follows 0.3 s after it lands; the note and the bundle stay until the hard cut.
const T = { shares: 2.2, sharesDur: 0.6, cursor: 2.9, swing: 0.5, bundleDelay: 0.3, bundleDur: 0.3, end: 4.0 };
const PHASES = [['输入涌入', 0, 1.6], ['归并压缩', 1.6, 2.2], ['份额分配', 2.2, 2.8], ['回应路径', 2.9, 3.6]];
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
  const bq = tc ? clamp01((T0 - land - T.bundleDelay) / T.bundleDur) : 0;
  const duck = 1 - 0.6 * Math.max(win(T0, T.shares - 0.1, T.shares + T.sharesDur + 0.1), same ? 0 : win(T0, T.cursor, land + 0.25));
  return {
    i: seg.i, kind: 'round', T: T0, layout, labels: afterShares ? settled[seg.i] : settled[seg.j], cursor, callout, calloutAlpha,
    asks: T0 < T.cursor ? from.askRoots : r.askRoots, cursorRoot: (T0 < T.cursor ? fc : tc)?.root ?? null,
    bundle: bq > 0 ? { round: r, q: bq, alpha: 1 } : null,
    inputs: [{ round: r, T: T0, mode: 'full', target: settled[seg.i] }],
    counters: {
      cum: r.cumulative - r.inputs + r.inputs * easeOutCubic(clamp01((T0 - 0.2) / 1.7)),
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
    asks: r.askRoots, cursorRoot: tc?.root ?? null, bundle: null,
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
    bundle: r.cursor ? { round: r, q: 1, alpha: 1 } : null,
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
const clock = () => performance.now() / 1000;
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
    <p class="fs-foot">动画只读同一份回放，不写回状态，也不承载作答。${esc(notice)}
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
        <svg class="dl-ring" aria-label="64 份预算环"><g class="dl-ticks"></g><g class="dl-blank"></g><g class="dl-sectors"></g><g class="dl-asks"></g><g class="dl-labels"></g><path class="dl-leader"/><g class="dl-cursor"><line class="dl-needle"/><rect class="dl-tag"/><text class="dl-tag-t"></text></g><g class="dl-hub"></g></svg>
        <div class="dl-title"><div class="dl-kicker"></div><h2></h2></div>
        <div class="dl-callout" hidden><div class="dl-c-k"><i></i>要你回 · 要紧</div><div class="dl-c-q"></div><div class="dl-c-d"></div></div>
      </div>
      <div class="dl-panels">
        <section class="dl-p"><h4>输入 · 片段</h4><div class="dl-feed"></div></section>
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
    callout: $('.dl-callout'), cq: $('.dl-c-q'), cd: $('.dl-c-d'),
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
  const tb = { x2: els.title.offsetLeft + els.title.offsetWidth, y2: els.title.offsetTop + els.title.offsetHeight };
  const R = Math.max(96, Math.min(H * 0.34, W * 0.21, 250));
  const cy = H * 0.53;
  // The title card has a fixed height (two lines of narration), so the ring and its outer labels can clear it.
  const need = R + 40;
  let cx = Math.max(W * 0.36, R + 70);
  if (tb.y2 + 10 > cy - need) { const dy = cy - tb.y2 - 10; cx = Math.max(cx, tb.x2 + 6 + Math.sqrt(Math.max(0, need * need - dy * dy))); }
  cx = Math.min(cx, W - R - 160);
  const laneA = [-24, -12, 0, 12, 24].map(d => (d * Math.PI) / 180);
  // Where a ray from the centre leaves the stage (with room for a lane's label above it).
  const exit = (a, m = 0) => { const c = Math.cos(a), s = Math.sin(a); const ts = [c > 0 ? (W - cx) / c : Infinity, s > 0 ? (H - m - cy) / s : s < 0 ? (m - cy) / s : Infinity]; return Math.min(...ts); };
  return {
    W, H, R, Rin: R * 0.74, cx, cy, dpr: Math.min(2, devicePixelRatio || 1),
    laneIn: R + 58, lanes: laneA.map(a => ({ a, out: exit(a, 20) - 4 })),
    bg: Array.from({ length: 27 }, (_, k) => (-52 + k * 4) * Math.PI / 180).filter(a => laneA.every(b => Math.abs(a - b) > 0.03)).map(a => ({ a, out: exit(a) })),
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
  node('text', { x: g.cx, y: g.cy + g.R * 0.2, class: 'dl-hero', 'font-size': (g.R * 0.66).toFixed(1) }, els.hub).textContent = String(BUDGET);
  node('text', { x: g.cx, y: g.cy + g.R * 0.2 + 22, class: 'dl-hero-s' }, els.hub).textContent = '份 · 每层预算';
  sectorEls.clear(); labelEls.clear(); els.sectors.replaceChildren(); els.labels.replaceChildren();
  lastKey = ''; calloutSize = null; ticksShown = BUDGET; hubShown = 1;
}

function resize() {
  g = measure();
  buildStatic();
  ctxField = sizeCanvas(els.field, g.W, g.H);
  ctxMarks = sizeCanvas(els.marks, g.W, g.H);
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
  const key = `${[...s.layout.map].map(([id, [a, b]]) => `${id}:${a.toFixed(3)}:${b.toFixed(3)}`).join('|')}#${s.cursorRoot}#${s.cursor.hollow}#${s.labels.used}#${s.asks.join()}`;
  if (key !== lastKey) {
    lastKey = key;
    const seen = new Set();
    for (const [id, [a0, a1]] of s.layout.map) {
      seen.add(id);
      let el = sectorEls.get(id);
      if (!el) { el = node('path', {}, els.sectors); sectorEls.set(id, el); }
      el.setAttribute('d', wedge(a0, a1, g.Rin, g.R));
      el.setAttribute('class', `${parity.get(id) ? 'is-b' : 'is-a'}${id === s.cursorRoot ? ' is-cursor' : ''}`);
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
      if (!el) { el = node('text', {}, els.labels); labelEls.set(l.id, el); }
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
  // Cursor: a black needle through the band and a black tag with the item's short name; hollow when nothing is urgent.
  const a = s.cursor.angle, hollow = s.cursor.hollow;
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
}

function placeCallout(s, tx, ty, tw) {
  const c = s.callout;
  const show = c && !s.cursor.hollow && s.calloutAlpha > 0.01;
  els.callout.hidden = !show;
  els.leader.setAttribute('d', '');
  if (!show) return;
  const due = c.due || '没有期限';
  if (els.cq.textContent !== c.short || els.cd.textContent !== due || !calloutSize) {
    els.cq.textContent = c.short; els.cd.textContent = due;
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
  els.callout.style.opacity = s.calloutAlpha.toFixed(3);
  const ex = side > 0 ? x : x + bw, ey = Math.max(y + 10, Math.min(y + bh - 10, ty));
  els.leader.setAttribute('d', `M${(side > 0 ? tx + tw / 2 : tx - tw / 2).toFixed(1)},${ty.toFixed(1)}L${ex.toFixed(1)},${ey.toFixed(1)}`);
  els.leader.style.opacity = s.calloutAlpha.toFixed(3);
}

// ---------- drawing: canvas (concept field, information marks) ----------
let ctxField = null, ctxMarks = null;
const laneOf = e => g.lanes[Math.max(0, Math.min(g.lanes.length - 1, e.lane))];

function drawMarks(s) {
  const ctx = ctxMarks;
  ctx.clearRect(0, 0, g.W, g.H);
  // The five lanes and their count this round.
  ctx.save();
  ctx.setLineDash([3, 5]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(31,45,38,.32)';
  const counts = rounds[s.i].byLane;
  g.lanes.forEach((L, k) => {
    const [x1, y1] = pt(g.laneIn, L.a), [x2, y2] = pt(L.out, L.a);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.save(); ctx.setLineDash([]);
    ctx.font = '11px ui-monospace, "SF Mono", Menlo, monospace'; ctx.textAlign = 'right'; ctx.fillStyle = C.ink2;
    const [lx, ly] = pt(L.out - 6, L.a);
    ctx.fillStyle = C.paper; ctx.fillRect(lx - 70, ly - 17, 72, 14);
    ctx.fillStyle = C.ink2;
    ctx.fillText(`${lanes[k].label} ${s.counters.rolling ? '' : counts[k]}`.trim(), lx, ly - 6);
    ctx.restore();
  });
  ctx.restore();
  for (const batch of s.inputs) drawInputs(ctx, batch, s);
  if (s.bundle) drawBundle(ctx, s);
}

function drawInputs(ctx, { round, T: t, mode, d, target }, s) {
  const n = round.events.length;
  if (!n) return;
  const spread = mode === 'lapse' ? d : 1.1;
  for (const e of round.events) {
    const L = laneOf(e);
    const spawn = mode === 'rest' ? -9 : (e.k / n) * spread + e.r1 * (mode === 'lapse' ? 0.02 : 0.08);
    const travel = mode === 'lapse' ? 0.28 + e.r2 * 0.22 : 0.45 + e.r2 * 0.45;
    let u = (t - spawn) / travel;
    if (u < 0) continue;
    let alpha = 1, r, a = L.a + (e.r3 - 0.5) * 0.05 * (1 - Math.min(1, u));
    const disp = e.disposition;
    if (mode === 'rest' && disp !== 'deferred') continue;
    if (disp === 'noise' || disp === 'duplicate' || disp === 'unjudged') {
      const die = 0.5 + e.r3 * 0.35;
      if (u > die + 0.3) continue;
      if (u > die) { alpha = 1 - (u - die) / 0.3; u = die + (u - die) * 0.3; }
    } else if (disp === 'deferred') {
      const park = 0.84 + e.r3 * 0.12;
      if (u > park) u = park;
      if (u >= park) alpha = 0.45;
      if (mode === 'full' && t > 3.5) alpha *= clamp01(1 - (t - 3.5) / 0.35);
      if (mode === 'lapse' && u >= park) alpha *= clamp01(1 - (t - spawn - travel * park) / 0.2);
      if (mode === 'rest') alpha = 0.4;
      if (alpha <= 0.01) continue;
    } else if (u > 1) {
      // Used: absorbed into its sector along the rim; a used input without an active root fades at the rim.
      const over = (t - spawn - travel) / (0.3 + e.r1 * 0.3);
      if (mode === 'lapse' || !e.root || !target?.map.get(e.root)) { if (over > 0.5) continue; alpha = 1 - over * 2; u = 1; }
      else {
        const goal = midOf(target, e.root);
        if (over > 1.25) continue;
        if (over > 1) { flash(ctx, goal, 1 - (over - 1) / 0.25); continue; }
        const w = easeInOutCubic(clamp01(over));
        a = L.a + shortest(L.a, goal) * w;
        r = lerp(g.laneIn, (g.R + g.Rin) / 2, w * w);
      }
    }
    if (r == null) r = lerp(L.out, g.laneIn, Math.min(1, u));
    const [x, y] = pt(r, a);
    ctx.globalAlpha = alpha * (e.machine ? 0.4 : 0.9);
    if (e.self) {
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.strokeStyle = e.machine ? C.ink2 : C.ink; ctx.lineWidth = 1.8;
      const dx = Math.cos(a) * 3.2, dy = Math.sin(a) * 3.2;
      ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
function flash(ctx, a, alpha) {
  ctx.globalAlpha = alpha * 0.8; ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R + 1.5, a - 0.03, a + 0.03); ctx.stroke();
  ctx.globalAlpha = 1;
}

// The bundle: the used inputs related to the cursor's item, each from its lane around the ring into the tag.
function drawBundle(ctx, s) {
  const { round, q, alpha } = s.bundle;
  const list = round.related;
  if (!list.length || alpha <= 0) return;
  const end = s.cursor.angle, n = list.length;
  ctx.save();
  ctx.globalAlpha = alpha * 0.75; ctx.strokeStyle = C.ink; ctx.lineWidth = 0.9;
  list.forEach((e, k) => {
    const start = laneOf(e).a + (e.r3 - 0.5) * 0.06;
    const r0 = g.R + 74 + (n > 1 ? (k / (n - 1)) * 40 : 20);
    const d = shortest(start, end);
    const steps = 48, upto = Math.max(1, Math.round(steps * q));
    ctx.beginPath();
    for (let j = 0; j <= upto; j += 1) {
      const w = j / steps;
      const r = lerp(r0, g.R + 58, easeInOutCubic(clamp01((w - 0.62) / 0.38)));
      const [x, y] = pt(r, start + d * w);
      if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  });
  ctx.restore();
}

// Concept layer: background lanes with grey traffic, a rotating band of glyphs and field fragments, wires on the left.
// Grey only, no readable numbers, never inside the hub; it keeps running across cuts and dims while the information moves.
const glyphs = (() => {
  const texts = rounds.flatMap(r => [...r.fragments, ...r.channels.slice(0, 6)]).filter(Boolean);
  return Array.from({ length: 84 }, (_, k) => {
    const h = Math.sin(k * 91.7) * 43758.5453, f = h - Math.floor(h);
    return { a: (k / 84) * Math.PI * 2, r: 70 + f * 46, block: k % 3 === 0, text: texts[(k * 37) % Math.max(1, texts.length)]?.replace(/\d/g, '·').slice(0, 16) || '', bits: Math.floor(f * 4096) };
  });
})();
const wires = Array.from({ length: 34 }, (_, k) => { const h = Math.sin(k * 12.9898) * 43758.5453; return { y: (k / 34), f: h - Math.floor(h), end: 2.2 + (k / 34) * 1.9 }; });

function drawField(s, c) {
  const ctx = ctxField;
  ctx.clearRect(0, 0, g.W, g.H);
  const base = s.intro ? s.intro.concept : 1;
  const alpha = base * s.duck;
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Background lanes and traffic, denser in busier rounds.
  const busy = 0.6 + Math.min(1.4, rounds[s.i].inputs / 120);
  ctx.lineWidth = 1;
  g.bg.forEach((L, k) => {
    const r0 = g.R + 128, len = L.out - r0;
    if (len < 40) return;
    ctx.strokeStyle = 'rgba(31,45,38,.07)'; ctx.setLineDash([2, 6]);
    ctx.beginPath(); ctx.moveTo(...pt(r0, L.a)); ctx.lineTo(...pt(L.out, L.a)); ctx.stroke();
    ctx.setLineDash([]);
    const speed = 26 + ((k * 37) % 11) * 7, count = Math.round((3 + (k % 4)) * busy);
    for (let m = 0; m < count; m += 1) {
      const u = 1 - ((c * speed / len + m / count + k * 0.13) % 1);
      const r = r0 + len * u;
      const fade = Math.min(1, (r - r0) / 60);
      ctx.fillStyle = `rgba(93,107,99,${(0.32 * fade).toFixed(3)})`;
      const [x, y] = pt(r, L.a);
      ctx.fillRect(x - 2.5, y - 1, 5, 2);
    }
  });
  // Glyph band: rotates slowly, with an eased surge every two seconds (spec.md: two surges per 4 s).
  const phi = c * 0.012 + 0.035 * (Math.floor(c / 2) + easeInOutCubic((c / 2) % 1));
  ctx.font = '8.5px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (const gl of glyphs) {
    const a = gl.a + phi, r = g.R + gl.r;
    const [x, y] = pt(r, a);
    if (x < 0 || x > g.W || y < 0 || y > g.H) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    if (gl.block) {
      ctx.fillStyle = 'rgba(31,45,38,.22)';
      for (let b = 0; b < 12; b += 1) if (gl.bits >> b & 1) ctx.fillRect((b % 4) * 3.2, Math.floor(b / 4) * 3.2 - 5, 2.4, 2.4);
    } else {
      ctx.fillStyle = 'rgba(93,107,99,.5)';
      ctx.fillText(gl.text, 0, 0);
    }
    ctx.restore();
  }
  // Wires from the left edge to the outside of the glyph band, drifting.
  ctx.lineWidth = 0.7;
  for (const w of wires) {
    const a = Math.PI * (0.62 + w.f * 0.76), [ex, ey] = pt(g.R + 122, a);
    const sy = g.H * w.y, sway = Math.sin(c * 0.35 + w.f * 9) * 18;
    ctx.strokeStyle = `rgba(31,45,38,${(0.06 + w.f * 0.12).toFixed(3)})`;
    ctx.beginPath(); ctx.moveTo(0, sy);
    ctx.bezierCurveTo(g.W * 0.08, sy + sway, ex - 90 * Math.cos(a) * -1, ey + sway * 0.5, ex, ey);
    ctx.stroke();
  }
  ctx.restore();
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
  if (s.kind === 'lapse') {
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
    const f = s.kind === 'round' ? clamp01((s.T - a) / (b - a)) : s.kind === 'lapse' ? s.progress : s.kind === 'hold' ? 1 : 0;
    const key = f.toFixed(2);
    if (li.dataset.f !== key) { li.dataset.f = key; li.querySelector('u').style.transform = `scaleX(${f})`; li.classList.toggle('is-on', f > 0 && f < 1); }
  });
  put(els.allocV, `${Math.round(s.kind === 'round' && s.T < T.shares ? rounds[Math.max(0, s.i - 1)].allocated : r.allocated)} / ${BUDGET}`);
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
function paintPanels(s, c) {
  const r = rounds[s.i];
  // Feed: field fragments of this round, scrolling; grey and clipped (concept layer).
  const rate = s.kind === 'round' && s.T < 1.6 ? 9 : 2.5;
  // Digits are blanked: the concept layer shows no readable numbers (story.md).
  const lines = r.channels.length ? r.channels.map(line => line.replace(/\d/g, '·')) : ['—'];
  const start = Math.floor(c * rate) % lines.length;
  put(els.feed, Array.from({ length: 6 }, (_, k) => lines[(start + k) % lines.length]).join('\n'));
  // Disposition grid: one cell per input of this round, lit as it arrives.
  let ctx = panelCtx(els.grid);
  if (ctx) {
    const w = els.grid._w, h = els.grid._h, cols = 24, rows = 10, cw = w / cols, ch = h / rows;
    ctx.clearRect(0, 0, w, h);
    const n = r.events.length;
    for (let k = 0; k < cols * rows; k += 1) {
      const e = r.events[k];
      const arrived = e && (s.kind !== 'round' || s.T > (k / Math.max(1, n)) * 1.1 + 0.45);
      const flick = Math.sin(k * 7.1 + c * 3.3) > 0.94 ? 0.12 : 0;
      ctx.fillStyle = !e ? `rgba(31,45,38,${0.04 + flick})` : !arrived ? 'rgba(31,45,38,.06)'
        : e.disposition === 'used' ? 'rgba(31,45,38,.62)' : e.disposition === 'deferred' ? 'rgba(31,45,38,.28)' : 'rgba(31,45,38,.12)';
      ctx.fillRect((k % cols) * cw + 0.5, Math.floor(k / cols) * ch + 0.5, cw - 1.5, ch - 1.5);
    }
  }
  // Allocation per round against the hard stop (information: data.json rounds.allocated).
  ctx = panelCtx(els.alloc);
  if (ctx) {
    const w = els.alloc._w, h = els.alloc._h, n = rounds.length - 1;
    ctx.clearRect(0, 0, w, h);
    const x = k => 4 + ((k - 1) / Math.max(1, n - 1)) * (w - 30), y = v => h - 4 - (v / BUDGET) * (h - 12);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, y(BUDGET)); ctx.lineTo(w, y(BUDGET)); ctx.stroke();
    ctx.font = '9px ui-monospace, Menlo, monospace'; ctx.fillStyle = C.ink2; ctx.textAlign = 'right'; ctx.fillText('64', w, y(BUDGET) + 10);
    const upto = s.kind === 'round' && s.T < T.shares ? s.i - 1 : s.i;
    ctx.lineWidth = 1;
    for (const [from, to, style] of [[1, n, 'rgba(31,45,38,.15)'], [1, upto, C.ink]]) {
      if (to < from) continue;
      ctx.strokeStyle = style; ctx.beginPath();
      for (let k = from; k <= to; k += 1) { const X = x(k), Y = y(rounds[k].allocated); if (k === from) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
      ctx.stroke();
    }
    if (upto >= 1) { ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(x(upto), y(rounds[upto].allocated), 2.6, 0, Math.PI * 2); ctx.fill(); }
  }
  // Signal: a grey waveform (concept layer).
  ctx = panelCtx(els.wave);
  if (ctx) {
    const w = els.wave._w, h = els.wave._h;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(31,45,38,.45)'; ctx.lineWidth = 1;
    for (const [amp, off] of [[0.32, 0.3], [0.22, 0.72]]) {
      ctx.beginPath();
      for (let X = 0; X <= w; X += 2) {
        const v = Math.sin(X * 0.07 + c * 2.1 + off * 9) * 0.6 + Math.sin(X * 0.023 - c * 0.9) * 0.4 + (Math.sin(X * 1.7 + c * 13) > 0.97 ? 0.8 : 0);
        const Y = h * off + v * h * amp * 0.5;
        if (X) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
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
  let t = now / 1000;
  const dt = lastT == null ? 0 : Math.min(0.1, t - lastT);
  if (perf.on && lastT != null) perf.times.push(t - lastT);
  lastT = t;
  // ?at=<seconds>: a still of the hero at that moment (for stills and checks); any control releases it.
  if (player.freeze != null && player.mode === 'hero') { t = player.segs[0].t0 + player.freeze; conceptClock = player.freeze; }
  const s = sceneAt(t);
  // First open: 0.4 s of stillness, the concept layer included (direct note 1).
  if (player.freeze == null && !reduced() && !(s.intro && s.intro.concept === 0)) conceptClock += dt;
  paintTicks(s.intro ? s.intro.ticks : BUDGET, s.intro ? s.intro.hub : 1);
  drawField(s, conceptClock);
  drawMarks(s);
  drawRing(s);
  paintText(s);
  paintPanels(s, conceptClock);
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
  resize();
  const params = new URLSearchParams(location.search);
  const asked = params.get('frame');
  const byId = asked == null ? -1 : frames.findIndex(f => f.id === asked);
  const index = asked == null ? null : byId >= 0 ? byId : Number(asked);
  // Inside all.html the page follows the bar's frame: single-frame only, no loop and no continuous play.
  // Embedded without a frame (the gallery thumbnail, the site's viewer) it plays the loop like a page of its own.
  const follow = () => { document.body.classList.add('dl-followed'); player.followed = true; };
  report = followFrames(i => { follow(); player.freeze = null; hold(i, 'jump'); });
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
    if (!b) return;
    player.freeze = null;
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
    player.freeze = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); hold(player.index + (event.key === 'ArrowLeft' ? -1 : 1), 'step'); }
    if (event.key === ' ' && !player.followed) {
      event.preventDefault();
      if (player.mode === 'play') hold(player.index);
      else startPlay(player.mode === 'frame' ? player.index + 1 : 1);
    }
  });
  // Re-measure whenever the stage or the title card changes size (also once styles and fonts have settled).
  let timer = null, seen = '';
  const remeasure = () => {
    const key = `${els.main.clientWidth}x${els.main.clientHeight}:${els.title.offsetWidth}x${els.title.offsetHeight}`;
    if (key !== seen) { seen = key; clearTimeout(timer); timer = setTimeout(resize, 60); }
  };
  new ResizeObserver(remeasure).observe(els.main);
  new ResizeObserver(remeasure).observe(els.title);
  document.fonts?.ready.then(remeasure);
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
  };
  requestAnimationFrame(frame);
}
