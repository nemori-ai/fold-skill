// 第三轮 · 概念动画 01 整理脉冲（pulse）。一轮整理演成 4.25 秒的一次脉冲：涌入、折叠、一问。
// 故事、节奏与约束见 pulse/story.md 与 pulse/spec.md；画面上的数字与 pulse/data.json 对得上。
//
// 只读同一份回放：variants/shared.mjs 的 records（scenario.mjs → engine.mjs）与 sketches/stage.mjs 的 askLife，
// 本页不另造数据。两层：概念层（pulse-field.mjs，粒子、弧、辉光、余辉，可以装饰）在下；信息层（本文件，
// 枝、64 格、朱红线、数字与面板，只在节拍上动、每个数都有出处）在上，文字只用等宽字。
//
// 两层共用一套以根为圆心的极坐标：根弧半径 r0，扇形外沿半径 R，64 条份额线是从根出发的射线。云在外沿之外的
// 环带里，事件沿射线朝根落下；收拢弧与根同心、张角等于扇形，从云的最外沿一路收到根。云里一颗主粒子就是一条
// 真实事件：采用的被弧带进扇形、落到所属条目在根上的格子，停一拍，再化成一束光顺着枝流到梢；暂缓的停在
// 外沿外侧成一圈余烬；噪音在原地熄灭。每根枝就是一条份额射线从根到梢被点亮（直线，静止时与射线重合）。
//
// 交互与份额拨盘同一标准（story.md 末节“交互”）：悬停枝条看概要，点击展开详情，两者都让本轮的时钟停住；
// 事实取自 dial-model.mjs 的 itemFacts，按本页“哪条输入进了哪件”的规则算，卡上的条数就是枝上走过的光。
//
// 地址参数：?frame=<帧> 打开某一轮并演一次；?from=<帧> 从某一轮起连播；都没有时从 f00 空状态起连播，
// 播完 28 轮接片尾，收回根，再从 f00 开始。?data= 选数据集，?card=0 收起概念卡，?perf 显示帧率，
// ?debug=geom 画出每根枝与射线的角度差。
import { scenario, records, frames, askLife, isSelf, shortOf, dayTime, reduced, esc, formatDate } from '../sketches/stage.mjs';
import { notice } from '../../variants/shared.mjs?v=feedback-loop-1';
import { formById, notesHref } from '../catalog.mjs';
import { followFrames } from '../../embed.mjs';
import { withDataset } from '../../data/select.mjs';
import { createField } from './pulse-field.mjs';
// Hover and detail read the same facts as 份额拨盘 (one rule for both pages; see `into` below), through the shared
// interaction module.
import { itemFacts, lanes as factLanes } from './dial-model.mjs';
import { createIx, placeBeside, placeColumn, edgePoint, IX } from './ix.mjs';

// ---------- timing (seconds) ----------
const ROUND = 4.25, OPEN = 1.0, END = 3.0, REWIND = 1.0;
const B2 = 1.0, B3 = 3.1;                 // beat boundaries: 涌入 [0, 1.0)、折叠 [1.0, 3.1)、一问 [3.1, 4.25)
// Beat 2, in order: the sweep crosses the cloud to the fan's rim (ARC0 → RIM), then carries the adopted inputs
// in through the fan and settles on the root (RIM → ARC1); they rest on their cells (REST), then run up their
// branches as light (FLOW), one after another when several go into the same branch (within QUEUE).
const ARC0 = 1.0, RIM = 1.45, ARC1 = 2.15;
const REST = 0.12, FLOW = 0.4, QUEUE = 0.24;
const RUN = ARC1 + REST;                  // the first light leaves the root
const SHIFT = 2.4;                        // branches no adopted input runs into shrink, wither or merge from here
const READOUT = 2.85;                     // “→ 动了 n” lands, once the tips have flashed
const STRIKE = B3 + 0.3;                  // vermilion strike, after 0.3 s of dimming
const STAGES = [[0, '收到'], [B2, '归并'], [RUN, '分配'], [B3, '回应']];
const VERM = 'rgb(240, 88, 50)';
const INK = [232, 230, 223];
const MONO = '"SF Mono", ui-monospace, Menlo, Consolas, "PingFang SC", "Noto Sans Mono CJK SC", monospace';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeOut4 = k => 1 - (1 - clamp(k)) ** 4;
const easeInOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
const smooth01 = x => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
const bump = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(Math.PI * (t - a) / (b - a)));
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
const hash = text => { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };
const gauss = r => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());

// ---------- data: everything below is read from the replay ----------
const LANES = ['work', 'community', 'life', 'family', 'subscription'];
const LANE_WORD = { work: '工作', community: '社区', life: '生活', family: '家庭', subscription: '订阅' };
const hasStreams = frames.some(f => f.events.some(e => e.stream));
// Lane widths follow the square root of each stream's two-week total, so busy streams look busy without crowding one edge.
const laneWeight = (() => {
  const totals = Object.fromEntries(LANES.map(s => [s, 0]));
  for (const f of frames) for (const e of f.events) if (e.stream in totals) totals[e.stream] += 1;
  return LANES.map(s => Math.sqrt(totals[s] || 1));
})();
const DISP = ['used', 'deferred', 'noise', 'duplicate', 'unjudged'];

/** The active root an item belongs to at frame i: up through parents, along merges. */
function rootAt(i, id) {
  const items = records[i].snapshot.items;
  let item = items[id];
  for (let guard = 0; item && guard < 16; guard += 1) {
    if (item.status === 'merged' && item.merged_into && items[item.merged_into]) item = items[item.merged_into];
    else if (item.parent_id && items[item.parent_id]) item = items[item.parent_id];
    else break;
  }
  return item ? item.id : id;
}
// Stable order of root items: by first appearance, then by rank in that frame. It never changes.
const order = new Map();
for (const r of records) for (const item of r.state.root.items) if (!order.has(item.id)) order.set(item.id, order.size);
const byOrder = (a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9);

let cumulative = 0, answeredSoFar = 0, freshSoFar = 0;
const rounds = frames.map((frame, i) => {
  const prevItems = i ? records[i - 1].state.root.items : [];
  const nextItems = records[i].state.root.items;
  const cited = new Map();
  for (const d of frame.batch?.declarations || []) for (const s of d.sources || []) if (s.ref?.startsWith('event:')) cited.set(s.ref.slice(6), d.id);
  const counts = Object.fromEntries(DISP.map(d => [d, 0]));
  const streams = {};
  const events = frame.events.map((e, k) => [e, k]).sort((a, b) => Date.parse(a[0].at) - Date.parse(b[0].at)).map(([e, k]) => {
    const disp = DISP.includes(e.disposition) ? e.disposition : 'unjudged';
    counts[disp] += 1;
    if (e.stream) streams[e.stream] = (streams[e.stream] || 0) + 1;
    const ref = cited.get(e.id) || e.relatedIds?.[0];
    return {
      id: e.id, k, disp, stream: e.stream || null, self: isSelf(e),
      machine: e.author_kind === 'bot' || e.author_kind === 'automation',
      target: disp === 'used' && ref ? rootAt(i, ref) : null,
    };
  });
  // What the batch did, classified as in sketches/notation.mjs: 新增、变大、撤下、合并 are “动了”.
  let moved = 0;
  for (const c of records[i].diff.changes || []) {
    if (c.type === 'annotations_changed') continue;
    const b = c.before?.share, a = c.after?.share;
    if (c.type === 'added' || c.type === 'restored' || c.type === 'withdrawn' || c.type === 'merged' || (b != null && a != null && a > b)) moved += 1;
  }
  const life = askLife[i];
  const prevOpen = i ? askLife[i - 1].open : new Map();
  const ask = (a, at) => ({ id: a.id, item: rootAt(at, a.item), short: a.short || a.prompt });
  const open = [...life.open.values()].map(a => ask(a, i));
  const fresh = new Set(life.fresh.map(a => a.id));
  const answered = new Set(life.answered.map(a => a.id));
  const lapsed = new Set(life.lapsed.map(a => a.id));
  // Your responses to a registered question run up its thread in beat 1.
  const pulses = [];
  for (const e of [...frame.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    for (const link of e.feedback || []) {
      if (!link.ask || !prevOpen.has(link.ask) || pulses.some(p => p.ask === link.ask)) continue;
      pulses.push({ ask: link.ask, item: rootAt(i - 1, prevOpen.get(link.ask).item) });
    }
  }
  const nextIds = new Set(nextItems.map(x => x.id));
  const gone = new Map();
  for (const item of prevItems) {
    if (nextIds.has(item.id)) continue;
    const now = records[i].snapshot.items[item.id];
    gone.set(item.id, now?.status === 'merged' && now.merged_into ? { merged: rootAt(i, now.merged_into) } : { withdrawn: true });
  }
  cumulative += events.length;
  answeredSoFar += answered.size;
  freshSoFar += fresh.size;
  // Which item each input (by its index in frame.events) went into, for the facts the hover and detail show.
  const targetOf = [];
  for (const e of events) targetOf[e.k] = e.target;
  return {
    i, frame, events, targetOf, counts, streams, moved, used: counts.used,
    before: new Map(prevItems.map(x => [x.id, x.share])), after: new Map(nextItems.map(x => [x.id, x.share])), gone,
    open, prevOpen: [...prevOpen.values()].map(a => ask(a, i - 1)), fresh, answered, lapsed, pulses,
    cumulative, answeredSoFar, freshSoFar,
  };
});
const LAST = frames.length - 1;
const TOTAL = cumulative, ASKED = freshSoFar, ANSWERED = answeredSoFar;

// ---------- page ----------
const form = formById('pulse');
const params = new URLSearchParams(location.search);
const hideCard = params.get('card') === '0';
const perfOn = params.has('perf');
const debugGeom = params.get('debug') === 'geom';
const intParam = name => (/^\d+$/.test(params.get(name) || '') ? Math.min(LAST, Number(params.get(name))) : null);
const fromParam = intParam('from'), frameParam = intParam('frame');

document.title = `Fold · ${form.name}`;
document.body.className = `fs-page pl-page fs-theme-dark${hideCard ? ' fs-no-card' : ''}`;
const card = () => {
  const rows = [['载体', form.carrier], ['场景', form.scene], ['用法', form.usage], ['读者此刻的问题', form.question],
    ['预注意通道', form.channel], ['视觉骨架', form.skeleton], ['故意舍弃', form.discard], ['与其他形式的差异', form.diff], ['配色', form.palette], ['灵感', form.inspiration]];
  return `<div class="fs-card-no">第三轮 · 动画 ${String(form.no).padStart(2, '0')} · 概念卡</div><h1>${esc(form.name)}</h1>
    <p class="fs-tagline">${esc(form.tagline)}</p>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${k === '视觉骨架' ? `<pre>${esc(v)}</pre>` : esc(v)}</dd>`).join('')}</dl>
    <p class="fs-foot">不承载作答，只标问题的开与闭。${esc(notice)}<a href="${notesHref('CONCEPTS')}">全部概念卡</a> · <a href="${notesHref('INSPIRATION')}">灵感来源</a></p>`;
};
const dayKey = at => formatDate(at);
document.body.innerHTML = `<header class="fs-bar pl-bar">
    <a class="fs-home" href="${esc(withDataset('../index.html'))}" title="全部形式">← 形式</a>
    <span class="fs-name"><b>${String(form.no).padStart(2, '0')}</b> ${esc(form.name)}</span>
    <div class="fs-nav"><button data-step="-1" aria-label="上一轮（←）" title="上一轮（←）">‹</button>
      <button data-play aria-label="连播（空格）" title="连播 / 暂停（空格）"><span class="pl-play-icon"></span></button>
      <button data-step="1" aria-label="下一轮（→）" title="下一轮（→）">›</button>
      <div class="fs-when"><span class="fs-date"></span><span class="fs-title"></span></div></div>
    <div class="fs-ticks" role="group" aria-label="选择帧">${frames.map((f, i) => `<button data-frame="${i}" class="${i && dayKey(frames[i - 1].at) !== dayKey(f.at) ? 'is-day' : ''}" title="${esc(`${dayTime(f.at)} ${f.title}`)}"></button>`).join('')}</div>
    <div class="fs-tools"><button data-card aria-pressed="${!hideCard}">概念卡</button></div>
  </header>
  <div class="fs-body">
    <main class="pl-stage" id="pl-stage" tabindex="-1" aria-label="整理脉冲动画">
      <canvas class="pl-field" aria-hidden="true"></canvas>
      <canvas class="pl-info" aria-hidden="true"></canvas>
      <div class="pl-top pl-dim"><div class="pl-signal"></div><div class="pl-say"></div></div>
      <div class="pl-hero"><div class="pl-hero-label pl-dim"></div>
        <div class="pl-hero-row"><span class="pl-n pl-dim">0</span><span class="pl-unit pl-dim">条</span>
          <span class="pl-readout"><span class="pl-moved pl-dim"></span><span class="pl-asked"></span></span></div></div>
      <div class="pl-count pl-dim"></div>
      <div class="pl-panels">
        <section class="pl-panel pl-dim" data-p="round"></section>
        <section class="pl-panel" data-p="asks"></section>
        <section class="pl-panel pl-dim" data-p="pipe"></section>
      </div>
      <div class="pl-perf" ${perfOn ? '' : 'hidden'}></div>
      <p class="pl-sr" aria-live="polite"></p>
    </main>
    <aside class="fs-card" aria-label="概念卡">${card()}</aside>
  </div>`;
const $ = s => document.querySelector(s);
const stage = $('#pl-stage');
const fieldCanvas = $('.pl-field'), infoCanvas = $('.pl-info');
const info = infoCanvas.getContext('2d');
const field = createField(fieldCanvas);
const el = {
  signal: $('.pl-signal'), say: $('.pl-say'), heroLabel: $('.pl-hero-label'), n: $('.pl-n'), unit: $('.pl-unit'),
  moved: $('.pl-moved'), asked: $('.pl-asked'), count: $('.pl-count'), perf: $('.pl-perf'), sr: $('.pl-sr'),
  round: $('[data-p="round"]'), asks: $('[data-p="asks"]'), pipe: $('[data-p="pipe"]'), top: $('.pl-top'), hero: $('.pl-hero'), panels: $('.pl-panels'),
  heroRow: $('.pl-hero-row'),
};

// ---------- geometry ----------
let G = null;
function measure() {
  const W = stage.clientWidth, H = stage.clientHeight;
  const pad = clamp(W * 0.022, 18, 30);
  const panelH = 126, panelY = H - panelH - 14;
  const rootY = panelY - 40;
  const heroSize = clamp(H / 6.2, 60, 140);
  stage.style.setProperty('--hero', `${heroSize.toFixed(1)}px`);
  stage.style.setProperty('--pad', `${pad.toFixed(1)}px`);
  stage.style.setProperty('--panel-h', `${panelH}px`);
  const origin = { x: W / 2, y: rootY };
  const fan = (160 * Math.PI) / 180;
  // One polar system for both layers, centred on the root. The root is an arc of 64 cells at radius r0; the fan
  // is a circular sector of radius R over it, as tall as the space under the hero block allows; the cloud lives
  // in the ring outside R, out to the edge of the picture, within the fan's angle so the sweep crosses all of it.
  const r0 = clamp(Math.min(W * 0.06, (rootY - pad) * 0.18), 52, 92);
  const heroBottom = pad + 52 + heroSize + 24;
  const top = Math.max(H * 0.3, heroBottom + 26);
  const R = Math.max(r0 * 2.4, Math.min(rootY - top, (W / 2 - pad - 60) / Math.sin(fan / 2)));
  // How far a ray from the root at angle phi runs before it leaves the open picture (above the panels).
  const box = { x0: pad, x1: W - pad, y0: pad + 4, y1: panelY - 12 };
  const edge = phi => {
    const dx = Math.sin(phi), dy = -Math.cos(phi);
    let d = Infinity;
    if (dx > 1e-6) d = Math.min(d, (box.x1 - origin.x) / dx); else if (dx < -1e-6) d = Math.min(d, (box.x0 - origin.x) / dx);
    if (dy < -1e-6) d = Math.min(d, (box.y0 - origin.y) / dy); else if (dy > 1e-6) d = Math.min(d, (box.y1 - origin.y) / dy);
    return d;
  };
  let far = R + 80;
  for (let k = 0; k <= 64; k += 1) far = Math.max(far, edge(-fan / 2 + (fan * k) / 64));
  G = {
    W, H, pad, panelY, panelH, rootY, origin, fan, r0, R, edge,
    baseR: r0 + 5,                       // where branches leave the root, and where adopted inputs land
    cloudIn: R + 40,                     // the cloud's inner edge; the embers settle between R + 6 and R + 30
    Rfar: far + 12,                      // the sweep starts just outside the farthest input
    key: `${W}x${H}`,
  };
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  field.resize(W, H, dpr);
  infoCanvas.width = Math.round(W * dpr); infoCanvas.height = Math.round(H * dpr);
  infoCanvas.style.width = `${W}px`; infoCanvas.style.height = `${H}px`;
  fieldCanvas.style.width = `${W}px`; fieldCanvas.style.height = `${H}px`;
  info.setTransform(dpr, 0, 0, dpr, 0, 0);
  G.dpr = dpr;
  particleCache.clear();
  buildBackdrop();
  G.masks = null;
  ix.relayout();
}
// Cell c of the 64 (fractional c allowed) sits at this angle on the root arc; 0 is straight up.
const cellAngle = c => -G.fan / 2 + G.fan * (c / 64);
const polar = (phi, rad) => ({ x: G.origin.x + Math.sin(phi) * rad, y: G.origin.y - Math.cos(phi) * rad });
const onRoot = (phi, extra = 0) => polar(phi, G.r0 + extra);
const onFan = (phi, rho) => polar(phi, G.R * rho);
// The information layer's text and panels, where the concept layer steps aside.
// The concept layer goes to 0 inside each line of text and comes back linearly over 40 px around it (tried against
// letting particles pass under outlined words: the fade keeps the small lines legible). Panels keep a box mask.
function masks() {
  const s = stage.getBoundingClientRect();
  const box = (r, feather) => [r.left - s.left, r.top - s.top, r.width, r.height, feather];
  const text = node => {
    if (!node || !node.textContent.trim()) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? box(r, 40) : null;
  };
  const list = [box(el.panels.getBoundingClientRect(), 18)];
  for (const node of [el.signal, el.say, el.heroLabel, el.n, el.unit, el.moved, el.asked, el.count]) list.push(text(node));
  return list.filter(r => r && r[2] > 0 && r[3] > 0);
}

// ---------- the tree at a moment ----------
// Branch k of n sits at an angle by its stable order; its 64-cell span on the root follows the same order,
// so branches do not cross. Presence, width and length are interpolated inside beat 2, driven by the light
// that runs up each branch: a branch takes its new share a little with every light that reaches its tip.
//
// Every branch is one of the 64 share rays lit from the root out to its tip: a straight line from the root's
// centre, on exactly the ray the information layer draws and the concept layer's current runs along
// (cellAngle(c + 0.5)). A wedge of odd width has a ray at its middle; an even wedge's middle falls on the line
// between two rays, and the branch takes the one on its own side of the fan (items on the left the left one,
// items on the right the right one), so neighbours spread apart. In motion the offset from the wedge's middle
// to its ray moves from the old layout's to the new one's as the wedge itself moves, so nothing jumps and every
// held frame is back on a ray. ?debug=geom draws the check (foldPulse.geom() returns it).
const NO_RUNS = new Map();
const arrived = (run, t) => run.reach.reduce((sum, at) => sum + smooth01((t - at) / 0.18), 0) / run.reach.length;
const sideOf = id => (order.get(id) ?? 0) % 2;   // 0 left of the middle, 1 right (place)
const restDelta = (m, side) => clamp(Math.round(m - 0.5 + (side ? 1e-6 : -1e-6)) + 0.5, 0.5, 63.5) - m;
// Wedge middles and ray offsets of a frame's settled tree, by item.
const restCache = new Map();
function restLayout(i) {
  if (!restCache.has(i)) restCache.set(i, new Map(settledTree(i).list.map(b => [b.id, { m: b.m, d: b.delta }])));
  return restCache.get(i);
}
function treeAt(r, t, runs = NO_RUNS) {
  const ids = [...new Set([...r.before.keys(), ...r.after.keys()])].sort(byOrder);
  const was = r.i ? restLayout(r.i - 1) : new Map(), will = restLayout(r.i);
  // The root's cells are re-allotted while the arc carries the adopted inputs in, so each input lands on the cells
  // its item will hold; the branch takes its new width only when the light reaches its tip.
  const allot = easeInOut((t - RIM) / (ARC1 - 0.1 - RIM));
  const list = [];
  for (const id of ids) {
    const sa = r.before.get(id), sb = r.after.get(id), run = runs.get(id);
    let presence = 1, share = sa ?? sb, slot = share, reach = null, length = 1, alpha = 1, grey = 0, mergeInto = null, mergeK = 0;
    if (sa != null && sb != null) {
      share = lerp(sa, sb, run ? arrived(run, t) : easeOut((t - SHIFT) / 0.4));
      slot = lerp(sa, sb, allot);
    } else if (sb != null) {
      // A new branch grows out of its cells with its first light, which is its tip on the way up.
      const g = run ? easeInOut((t - run.leave[0]) / FLOW) : easeOut((t - SHIFT) / 0.45);
      presence = g; length = g; share = sb * (run ? arrived(run, t) : g); slot = sb * allot; reach = sb;
    } else {
      // A branch on its way out keeps its cells until it withers; one that still takes light (an input that
      // closed it) holds until 2.6 s, so the light is on its way up before it fades, and is gone by beat 3.
      const start = run ? 2.6 : SHIFT;
      const w = easeInOut((t - start) / 0.5);
      const gone = r.gone.get(id) || { withdrawn: true };
      presence = 1 - w; share = sa * (1 - w); slot = share; alpha = 1 - w; grey = w;
      if (gone.merged) { mergeInto = gone.merged; mergeK = w; } else length = 1 - 0.8 * w;
    }
    // A new branch has no old layout and one on its way out no new one: each keeps the offset it has.
    const p0 = was.get(id) || will.get(id), p1 = will.get(id) || p0;
    const snap = p0 ? { m0: p0.m, d0: p0.d, m1: p1.m, d1: p1.d } : null;
    list.push({ id, presence, share, slot, reach, length, alpha, grey, mergeInto, mergeK, snap });
  }
  return place(list);
}
function place(list) {
  // Mid-tween, growth and shrinkage overlap; the 64 cells never overflow, they are shared out proportionally.
  const slotOf = b => Math.max(0, b.slot ?? b.share);
  const shares = list.reduce((sum, b) => sum + slotOf(b), 0);
  const fit = shares > 64 ? 64 / shares : 1;
  // Items alternate left and right by first appearance; on each side the oldest sit nearest the middle. Each takes
  // a wedge of the 64 cells as wide as its share, and the two sides meet at the middle unless one side needs more.
  const left = list.filter(b => sideOf(b.id) === 0).sort((a, b) => byOrder(b.id, a.id));
  const right = list.filter(b => sideOf(b.id) === 1).sort((a, b) => byOrder(a.id, b.id));
  const width = bs => bs.reduce((sum, b) => sum + slotOf(b) * fit, 0);
  const L = width(left), R = width(right);
  const start = clamp(32, L, 64 - R) - L;
  const ordered = [...left, ...right];
  const map = new Map();
  let c = start;
  for (const b of ordered) {
    b.c0 = c; b.c1 = c + slotOf(b) * fit; c = b.c1;
    // The ray: at rest the one nearest the wedge's middle; in motion the offset follows the wedge from the old
    // layout to the new (see above). A wedge narrower than one cell (growing in, withering away) keeps it inside.
    const m = (b.c0 + b.c1) / 2, s = b.snap;
    const d = !s ? restDelta(m, sideOf(b.id)) : Math.abs(s.m1 - s.m0) > 1e-6 ? lerp(s.d0, s.d1, clamp((m - s.m0) / (s.m1 - s.m0))) : s.d0;
    b.m = m; b.delta = d * clamp(b.c1 - b.c0);
    b.angle = cellAngle(m + b.delta);
    // Larger shares reach further: 24 shares touch the edge of the fan, one share a little under half way.
    const rho = 0.42 + 0.58 * Math.sqrt(Math.max(0, b.reach ?? b.share) / 24);
    b.tipR = lerp(G.baseR, G.R * rho, b.length);
    map.set(b.id, b);
  }
  // A branch merging into another swings over onto the other's ray as it fades, straight from the root all the way.
  // It sinks toward the root while it crosses, so it passes under the branches in between (the other may sit on
  // the far side of the fan), and rises again along the other's ray.
  for (const b of ordered) if (b.mergeInto && map.has(b.mergeInto)) {
    const to = map.get(b.mergeInto), k = b.mergeK;
    b.angle = lerp(b.angle, to.angle, k);
    b.tipR = lerp(lerp(b.tipR, to.tipR, k), G.baseR + 8, 0.85 * Math.sin(Math.PI * k));
  }
  for (const b of ordered) { b.lift = 0; b.base = polar(b.angle, G.baseR); b.tip = polar(b.angle, b.tipR); }
  return { list: ordered, map, used: L + R, start };
}
// The open item steps out along its own ray (IX.pop): its cells on the root, its base and its tip, still on the ray.
function lift(b, d) { b.lift = d; b.base = polar(b.angle, G.baseR + d); b.tip = polar(b.angle, b.tipR + d); }
const onBranch = (b, u) => ({ x: lerp(b.base.x, b.tip.x, u), y: lerp(b.base.y, b.tip.y, u) });
// The tree held at a frame's end (no motion).
function settledTree(i) {
  if (i < 0) return place([]);
  return place(records[i].state.root.items.map(x => x.id).sort(byOrder).map(id => ({
    id, presence: 1, share: records[i].state.root.items.find(x => x.id === id).share, length: 1, alpha: 1, grey: 0, mergeInto: null, mergeK: 0,
  })));
}

// ---------- particles: one bright particle per real input, a few faint motes around it ----------
const particleCache = new Map();
// Three faint motes per input for texture. A fixed multiple, smaller and darker, so the cloud's density still
// counts inputs and the bright particles stay countable: 234 inputs are 234 bright particles.
const DUST = 3;
// The sweep runs straight through the cloud (ARC0 → RIM), then eases out through the fan onto the root
// (RIM → ARC1), entering the fan at the speed it crossed the cloud and slowing as it closes, so the adopted
// inputs can be watched going in.
function arcRadius(t) {
  if (t <= ARC0) return G.Rfar;
  if (t <= RIM) return lerp(G.Rfar, G.R, (t - ARC0) / (RIM - ARC0));
  const k = clamp((t - RIM) / (ARC1 - RIM));
  const speed = (G.Rfar - G.R) / (RIM - ARC0), power = clamp((speed * (ARC1 - RIM)) / (G.R - G.baseR), 1.2, 2.6);
  return G.R - (G.R - G.baseR) * (1 - (1 - k) ** power);
}
// Each input rides a little ahead of or behind the arc; the spread closes as the arc reaches the root.
const ride = (arc, off) => arc + off * clamp((arc - G.baseR) / 90);
function touchTime(rad, off) {
  if (ride(G.Rfar, off) <= rad) return ARC0;
  let lo = ARC0, hi = ARC1;
  for (let k = 0; k < 24; k += 1) { const mid = (lo + hi) / 2; if (ride(arcRadius(mid), off) > rad) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
// fate: 1 adopted, carried to its cell on the root and up its branch as light; 2 deferred, carried to the rim and
// left there as an ember; 3 noise and duplicates, out where they stand; 4 unjudged, dissolving; 5 a mote.
const FATE = { used: 1, deferred: 2, noise: 3, duplicate: 3, unjudged: 4 };
function particlesFor(i) {
  const key = `${i}:${G.key}`;
  if (particleCache.has(key)) return particleCache.get(key);
  const r = rounds[i], n = r.events.length, cap = n * (1 + DUST);
  const P = {
    n, count: cap, phi: new Float32Array(cap), r1: new Float32Array(cap), rs: new Float32Array(cap),
    ts: new Float32Array(cap), dur: new Float32Array(cap), off: new Float32Array(cap), tt: new Float32Array(cap),
    size: new Float32Array(cap), alpha: new Float32Array(cap), stop: new Float32Array(cap), seed: new Float32Array(cap),
    leave: new Float32Array(cap).fill(-1), ring: new Uint8Array(cap), fate: new Uint8Array(cap), target: new Int16Array(cap).fill(-1),
    targets: [], runs: new Map(), landed: [], resolved: [],
  };
  const rand = rng(hash(`${scenario.id}:${frames[i].id}:${G.key}`));
  // Streams take wedges of the fan's angle, as wide as their lanes were.
  const lanes = hasStreams ? LANES : [null];
  const weights = hasStreams ? laneWeight : [1], wsum = weights.reduce((a, b) => a + b, 0);
  const span = G.fan - 0.03;
  const laneA = weights.map((w, k) => -span / 2 + span * weights.slice(0, k).reduce((a, b) => a + b, 0) / wsum);
  const laneW = weights.map(w => span * w / wsum);
  const blocked = (G.masks || []).map(([x, y, w, h]) => [x - 18, y - 18, w + 36, h + 36]);
  const inMask = (x, y) => blocked.some(([bx, by, bw, bh]) => x > bx && x < bx + bw && y > by && y < by + bh);
  const targetIndex = new Map(), byTarget = new Map();
  let p = 0;
  r.events.forEach((e, j) => {
    const lane = Math.max(0, lanes.indexOf(e.stream));
    let phi = 0, rad = 0;
    for (let tries = 0; tries < 12; tries += 1) {
      phi = laneA[lane] + laneW[lane] * (0.04 + 0.92 * rand());
      const outer = Math.max(G.cloudIn + 24, G.edge(phi) - 8);
      // Denser near the rim, thinning toward the edge of the picture.
      rad = G.cloudIn + (outer - G.cloudIn) * rand() ** 1.45;
      const at = polar(phi, rad);
      if (!inMask(at.x, at.y)) break;
    }
    const ts = 0.03 + 0.48 * (j / Math.max(1, n)) + rand() * 0.03, dur = 0.3 + rand() * 0.12;
    const fate = FATE[e.disp] ?? 4;
    let ti = -1;
    if (fate === 1 && e.target) {
      if (!targetIndex.has(e.target)) { targetIndex.set(e.target, P.targets.length); P.targets.push(e.target); byTarget.set(e.target, []); }
      ti = targetIndex.get(e.target);
      byTarget.get(e.target).push(p);
    }
    for (let q = 0; q <= DUST; q += 1, p += 1) {
      const main = q === 0, spread = 5 + rand() * 12;
      P.r1[p] = main ? rad : rad + gauss(rand) * spread;
      P.phi[p] = main ? phi : phi + (gauss(rand) * spread) / Math.max(60, rad);
      P.rs[p] = P.r1[p] + 140 + rand() * 220;   // it falls in along its ray from beyond the edge
      P.ts[p] = ts + (main ? 0 : rand() * 0.04); P.dur[p] = dur * (main ? 1 : 0.9 + rand() * 0.25);
      P.off[p] = main ? (rand() - 0.35) * 14 : (rand() - 0.5) * 18;
      P.tt[p] = touchTime(P.r1[p], P.off[p]);
      P.size[p] = main ? (2.9 + rand() * 0.45) * (e.machine ? 0.8 : 1) : 0.55 + rand() * 0.3;
      P.alpha[p] = main ? 1.25 * (e.machine ? 0.6 : 1) : 0.07 + rand() * 0.08;
      P.ring[p] = main && e.self ? 1 : 0;
      P.fate[p] = main ? fate : 5;
      P.target[p] = main ? ti : -1;
      P.stop[p] = G.R + 6 + rand() * 24;
      P.seed[p] = rand() * 6.283;
    }
    P.landed.push(ts + dur);
    if (fate !== 1) P.resolved.push(P.tt[p - 1 - DUST]);
  });
  // The adopted inputs of one branch leave the root one after another, within QUEUE, in the order they came in.
  for (const [id, list] of byTarget) {
    const gap = list.length > 1 ? Math.min(0.07, QUEUE / (list.length - 1)) : 0;
    const leave = list.map((pp, k) => (P.leave[pp] = RUN + k * gap));
    P.runs.set(id, { leave, reach: leave.map(at => at + FLOW) });
  }
  P.landed.sort((a, b) => a - b);
  P.resolved.sort((a, b) => a - b);
  particleCache.set(key, P);
  if (particleCache.size > 6) particleCache.delete(particleCache.keys().next().value);
  return P;
}
const countUpTo = (sorted, t) => { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= t) lo = mid + 1; else hi = mid; } return lo; };
// A point at fraction u of a branch's full length, even while the branch is still growing toward it.
const frontOf = (b, u) => onBranch(b, Math.min(1, u / Math.max(b.length, 1e-3)));

// ---------- concept layer: backdrop, twigs, sweep ----------
const MAX_POINTS = 6000, MAX_LINES = 16000;
const pointBuf = new Float32Array(MAX_POINTS * 5), lineBuf = new Float32Array(MAX_LINES * 3);
let backdrop = null, stars = null;
function buildBackdrop() {
  const rand = rng(hash(`backdrop:${G.key}`));
  const segs = [];
  // The concept layer's current runs outward along the same 64 rays the information layer draws for the budget,
  // and on past the rim into the cloud at under half strength, so the rain falls along them.
  for (let c = 0; c < 64; c += 1) {
    const phi = cellAngle(c + 0.5), from = G.r0 + 10, to = Math.max(G.R, G.edge(phi));
    const steps = Math.max(8, Math.round((to - from) / 30));
    let prevD = from;
    for (let q = 1; q <= steps; q += 1) {
      const d = from + (to - from) * (q / steps), a = polar(phi, prevD), b = polar(phi, d);
      segs.push([a.x, a.y, prevD, b.x, b.y, d, d > G.R + 1 ? 0.4 : 1]);
      prevD = d;
    }
  }
  backdrop = segs;
  // A few faint fixed stars so the black is not empty; smaller and dimmer than any input.
  stars = Array.from({ length: 180 }, () => ({ x: rand() * G.W, y: rand() * (G.panelY - 10), s: 0.45 + rand() * 0.35, a: 0.03 + rand() * 0.07, ph: rand() * 6.283 }));
}

// ---------- the clock ----------
// A segment is one round (3.5 s), the opening f00 (1 s), the end card (3 s) or the rewind (1 s).
const play = { index: 0, seg: 'open', t0: 0, playing: false, frozen: null };
const now = () => performance.now() / 1000;
const segLength = seg => ({ open: OPEN, round: ROUND, end: END, rewind: REWIND }[seg]);
function enter(index, seg, at = now()) {
  play.index = index; play.seg = seg; play.t0 = at; play.swapped = false;
  if (seg === 'open' || seg === 'round') onRound(index);
}
let lastReported = null;
function onRound(index) {
  const q = new URLSearchParams(location.search);
  q.set('frame', index);
  history.replaceState(null, '', `?${q}`);
  document.querySelectorAll('[data-frame]').forEach(b => b.classList.toggle('is-on', Number(b.dataset.frame) === index));
  const f = frames[index];
  $('.fs-date').textContent = `${dayTime(f.at)} · ${f.id} · ${records[index].state.revision}`;
  $('.fs-title').textContent = f.title;
  el.sr.textContent = `${f.id}：收到 ${rounds[index].events.length} 条，动了 ${rounds[index].moved} 件，新问 ${rounds[index].fresh.size} 个。`;
  G.masks = null;
  if (lastReported !== index) { lastReported = index; report(index); }
}
function advance(at) {
  const { index, seg } = play;
  if (seg === 'open') enter(Math.min(1, LAST), 'round', at);
  else if (seg === 'round' && index < LAST) enter(index + 1, 'round', at);
  else if (seg === 'round') enter(index, 'end', at);
  else if (seg === 'end') enter(index, 'rewind', at);
  else enter(0, 'open', at);
}
function go(index, { autoplay = false } = {}) {
  index = clamp(Math.round(index), 0, LAST);
  ix.reset();
  play.playing = autoplay; play.frozen = null;
  enter(index, index === 0 ? 'open' : 'round');
  paintPlay();
}
function togglePlay() {
  play.frozen = null;
  if (play.playing) { play.playing = false; paintPlay(); return; }
  play.playing = true;
  // Resuming from a held round moves on; from the last round, the end card follows.
  if (now() - play.t0 >= segLength(play.seg)) advance(now());
  paintPlay();
}
function paintPlay() {
  document.body.classList.toggle('pl-playing', play.playing);
  $('[data-play]').setAttribute('aria-pressed', String(play.playing));
}

// ---------- interaction: hover a branch for a summary, click it for the detail (story.md 交互) ----------
// The same standard as 份额拨盘 through the shared module (ix.mjs: the state machine, the cards, keys and touch), on
// this page's geometry and in its own black and monospace (pulse.css sets the module's variables). Both cards read
// itemFacts (dial-model.mjs) with this page's own rule for which item an input went into (`into`), so the counts are
// the lights drawn. Hovering or opening stops the round's clock where it is (hold); the concept layer keeps its wall
// clock. The open branch steps out IX.pop along its own ray with its cells on the root; the leader leaves the tip, runs
// on out along the ray past the rim, then to the card.
const HIT = 10;   // the lines are thin: a branch is hit this far either side of its line
const into = (round, k) => rounds[round]?.targetOf[k] ?? null;
const factsOf = (i, id) => itemFacts(i, id, into);
// What the interaction shows this frame (ix.frame): the focused item, how far the others are dimmed, the open motion.
let X = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
// The round's clock stands still from hold.at until the interaction lets go.
const hold = { at: null };
const interactive = () => play.seg === 'round' || play.seg === 'end';

// Which branch is under a point of the stage: its name, the line itself within HIT px (the lines are thin), its tip
// light, or its cells on the root. Nearest wins where neighbours' bands overlap near the root.
const segDist = (x, y, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, k = L ? clamp(((x - a.x) * dx + (y - a.y) * dy) / L) : 0;
  return Math.hypot(a.x + dx * k - x, a.y + dy * k - y);
};
function itemAt(x, y) {
  if (!lastTree || !interactive()) return null;
  const rr = Math.hypot(x - G.origin.x, y - G.origin.y), phi = Math.atan2(x - G.origin.x, G.origin.y - y);
  let best = null, bestD = Infinity;
  for (const b of lastTree.list) {
    if (b.alpha < 0.15 || b.length < 0.2) continue;
    const lb = b.labelBox;
    if (lb && x >= lb[0] - 2 && x <= lb[0] + lb[2] + 2 && y >= lb[1] - 2 && y <= lb[1] + lb[3] + 2) return b.id;
    let d = Math.min(segDist(x, y, b.base, b.tip) - (0.7 + b.share * 0.34) / 2, Math.hypot(x - b.tip.x, y - b.tip.y) - (1.6 + b.share * 0.07) - 4);
    if (Math.abs(rr - G.r0 - b.lift) <= 8 && phi >= cellAngle(b.c0) && phi <= cellAngle(b.c1)) d = Math.min(d, 0);
    if (d <= HIT && d < bestD) { best = b.id; bestD = d; }
  }
  return best;
}
const itemNamed = name => (lastTree?.map.has(name) ? name : lastTree?.list.find(b => shortOf(b.id) === name)?.id || null);

// Rectangles on the stage (x0, y0, x1, y1) of the words the cards keep clear of.
function rectOf(node, text = true) {
  if (!node || (text && !node.textContent.trim())) return null;
  const s = stage.getBoundingClientRect();
  let r;
  if (text) { const range = document.createRange(); range.selectNodeContents(node); r = range.getBoundingClientRect(); } else r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x0: r.left - s.left, y0: r.top - s.top, x1: r.right - s.left, y1: r.bottom - s.top } : null;
}
const labelRect = b => (b.labelBox ? { x0: b.labelBox[0], y0: b.labelBox[1], x1: b.labelBox[0] + b.labelBox[2], y1: b.labelBox[1] + b.labelBox[3] } : null);
const wordRects = () => [rectOf(el.signal), rectOf(el.say), rectOf(el.heroLabel), rectOf(el.heroRow, false), rectOf(el.count)];

// The cards keep the round's beats, as the panels do: held mid-round, they do not tell what has not happened yet —
// which inputs went into it before the sweep has brought them to the root, its new share before “动了” lands, a question
// registered this round before the strike.
let roundT = ROUND;
const seenAt = () => ({ inputs: roundT >= ARC1, share: roundT >= READOUT, asks: roundT >= STRIKE });
// Only questions still open after the round (askLife, as the panel counts them: one on an item withdrawn this round
// has lapsed), and none registered this round before the strike.
const asksSeen = (f, seen) => f.asks.filter(a => rounds[f.i].open.some(o => o.id === a.id) && (seen.asks || !rounds[f.i].fresh.has(a.id)));
// The summary card: beside the tip on the side the branch leans to, clear of its name, its line and the words.
function peekPlace(id, w, h) {
  const b = lastTree.map.get(id);
  const lb = labelRect(b), facing = Math.sin(b.angle) >= 0 ? 1 : -1;
  const from = lb ? { x: facing > 0 ? lb.x1 + 3 : lb.x0 - 3, y: (lb.y0 + lb.y1) / 2 } : { x: b.tip.x, y: b.tip.y };
  const avoid = [...wordRects(), lb, { x0: b.tip.x - 8, y0: b.tip.y - 8, x1: b.tip.x + 8, y1: b.tip.y + 8 }];
  return placeBeside({ at: from, from, facing, w, h, gap: 18, steps: 90, bounds: { x0: 8, y0: 8, x1: G.W - 8, y1: G.panelY - 8 }, avoid, segments: [[b.base, b.tip, 6]] });
}
// The detail card hugs the stage edge on the side the branch leans to (else the other), below the words at the top,
// above the panels, and never over the open branch, its tip or its name: beside it if it is clear, else above it, else
// below. The leader leaves the tip and runs on out along the branch's own ray until it is past the rim (or meets the
// card), then straight to the card's nearest edge.
function detailPlace(id, node) {
  const b = lastTree?.map.get(id);
  if (!b) return null;
  const lb = labelRect(b), tip = polar(b.angle, b.tipR + IX.pop);
  const keep = { x0: Math.min(b.base.x, tip.x) - 14, y0: Math.min(b.base.y, tip.y) - 14, x1: Math.max(b.base.x, tip.x) + 14, y1: Math.max(b.base.y, tip.y) + 14 };
  // The name moves out with the branch, IX.pop along the ray.
  if (lb) { const m = IX.pop + 6; keep.x0 = Math.min(keep.x0, lb.x0 - m); keep.y0 = Math.min(keep.y0, lb.y0 - m); keep.x1 = Math.max(keep.x1, lb.x1 + m); keep.y1 = Math.max(keep.y1, lb.y1 + m); }
  return placeColumn({ el: node, facing: Math.sin(b.angle) < -0.02 ? -1 : 1, width: Math.round(clamp(G.W * 0.27, 270, 340)), minWidth: 250,
    bounds: { x0: G.pad, y0: G.pad, x1: G.W - G.pad, y1: G.panelY - 12 }, words: wordRects(), keep, anchorY: tip.y,
    leader: card => {
      const r0 = b.tipR + IX.pop + 5, rMax = Math.max(r0 + 14, G.R + 16);
      let bend = polar(b.angle, rMax);
      for (let rr = r0; rr <= rMax; rr += 2) { const p = polar(b.angle, rr); if (p.x > card.x0 - 6 && p.x < card.x1 + 6 && p.y > card.y0 - 6 && p.y < card.y1 + 6) { bend = p; break; } }
      return [polar(b.angle, r0), bend, edgePoint(bend, card)];
    } });
}
const ix = createIx({
  stage, facts: id => factsOf(play.index, id), index: () => play.index,
  has: id => Boolean(lastTree?.map.has(id)) && interactive(), hit: itemAt, named: itemNamed, skip: '.pl-panels',
  pointOf: id => { const b = lastTree?.map.get(id); return b ? { x: (b.base.x + b.tip.x) / 2, y: (b.base.y + b.tip.y) / 2 } : null; },
  pause: () => { if (hold.at == null) hold.at = now(); }, resume: () => { if (hold.at != null) { play.t0 += now() - hold.at; hold.at = null; } }, paused: () => hold.at != null,
  last: LAST, answerHref: f => withDataset(`../../index.html?variant=d&frame=${f.i}`),
  seen: seenAt, asks: asksSeen, peekPlace, detailPlace, leaders: 'host', trendH: 32,
  pending: '还在路上：弧把它们合到根上之后才知道', label: '枝条：聚焦看概要，回车展开详情',
});
// The concept layer steps aside under the cards, as it does under the words.
const cardMasks = () => ix.rects().map(r => [r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 18]);
// The leaders, on the information layer under the names (their dark outline breaks the line where it passes).
function drawLeaders() {
  const { detail, peek } = ix.leaders();
  info.lineWidth = 1; info.setLineDash([]); info.lineCap = 'butt';
  if (detail) {
    const pts = detail.points, lens = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k].x, p.y - pts[k].y));
    let left = detail.progress * lens.reduce((sum, d) => sum + d, 0);
    info.strokeStyle = ink(0.75);
    info.beginPath(); info.moveTo(pts[0].x, pts[0].y);
    for (let k = 0; k < lens.length && left > 0; k += 1) {
      const f = Math.min(1, left / (lens[k] || 1));
      info.lineTo(lerp(pts[k].x, pts[k + 1].x, f), lerp(pts[k].y, pts[k + 1].y, f));
      left -= lens[k];
    }
    info.stroke();
  }
  if (peek) {
    info.strokeStyle = ink(0.55 * peek.alpha);
    info.beginPath(); info.moveTo(peek.from.x, peek.from.y); info.lineTo(peek.to.x, peek.to.y); info.stroke();
  }
}
// Keyboard: one visually hidden button per branch on screen; focus is a hover, Enter opens.
function syncItems() {
  if (!lastTree) return;
  const list = interactive() ? lastTree.list.filter(b => b.alpha >= 0.15 && b.length >= 0.2) : [];
  ix.sync(`${play.index}:${list.map(b => b.id).join(',')}`, () => list.map(b => ({ id: b.id, label: `${shortOf(b.id)} ${Math.round(b.share)} 份` })));
}

// ---------- drawing ----------
let lastFrameAt = 0, lastDim = -1, panelKey = '', textKey = '', lastTree = null;
const frameTimes = [], cpuTimes = [];
let livePoints = 0, livePeak = 0;

function render(wall) {
  if (!G || !G.W) return;
  if (!G.masks) G.masks = masks();
  const still = reduced();
  const dt = play.frozen ? 1 / 60 : lastFrameAt ? Math.min(0.1, wall - lastFrameAt) : 1 / 60;
  if (!play.frozen && lastFrameAt) { frameTimes.push(wall - lastFrameAt); if (frameTimes.length > 1800) frameTimes.shift(); }
  lastFrameAt = wall;
  // Hovering or opening a branch stops the round's clock (hold); the concept layer's own clock (T) runs on.
  let t = (play.frozen ? play.frozen.t : (hold.at ?? wall) - play.t0);
  const T = play.frozen ? play.frozen.T : wall;
  const len = segLength(play.seg);
  if (!play.frozen && play.playing && hold.at == null && t >= len) { advance(wall); t = 0; }
  t = Math.min(t, len);
  // Reduced motion: each beat jumps to its end state.
  if (still && play.seg === 'round') t = t < B2 ? B2 : t < B3 ? B3 : ROUND;
  else if (still) t = len;
  const i = play.index, r = rounds[i], seg = play.seg;

  // --- the tree and its timing ---
  const inRound = seg === 'round';
  const P = inRound && r.events.length ? particlesFor(i) : null;
  let tree;
  if (inRound) tree = treeAt(r, t, P ? P.runs : NO_RUNS);
  else if (seg === 'open') tree = place([]);
  else tree = settledTree(i);
  // The rewind draws every branch back into the root before f00 begins again.
  const retract = seg === 'rewind' ? easeInOut(t / (REWIND * 0.85)) : 0;
  if (retract) tree = place(tree.list.map(b => ({ ...b, share: b.share * (1 - retract), slot: (b.slot ?? b.share) * (1 - retract), presence: 1 - retract, length: 1 - retract, alpha: 1 - retract,
    snap: { m0: b.m, d0: b.delta, m1: b.m, d1: b.delta } })));
  lastTree = tree; roundT = inRound ? t : ROUND;
  if (!interactive() && (ix.s.hover || ix.s.open || ix.s.peek)) ix.reset();
  X = ix.frame();
  const popped = X.popId && X.pop > 0 ? tree.map.get(X.popId) : null;
  if (popped) lift(popped, IX.pop * X.pop);

  const fresh = inRound ? r.open.filter(a => r.fresh.has(a.id)) : [];
  const dimOn = inRound && fresh.length > 0 && !still;
  // Before the strike the whole picture goes dark for 0.3 s; afterwards it comes back slowly.
  const AFTER = STRIKE + 0.35;
  const dim = !dimOn ? 1 : t < B3 ? 1 : t < STRIKE ? 1 - 0.58 * easeInOut((t - B3) / (STRIKE - B3)) : t < AFTER ? 0.42 : lerp(0.42, 1, easeInOut((t - AFTER) / 0.45));
  // The concept layer's big flash: the arc closing on the root with the adopted inputs, the end of the fold.
  const flash = inRound && !still ? 0.75 * bump(t, ARC1 - 0.1, ARC1 + 0.3) * Math.min(1, r.events.length / 60 + 0.25) : 0;
  let duck = dimOn ? (t < B3 ? 1 : t < STRIKE ? lerp(1, 0.22, easeInOut((t - B3) / (STRIKE - B3))) : t < AFTER ? 0.22 : lerp(0.22, 0.95, easeInOut((t - AFTER) / 0.45))) : 1;
  // Small ducks under information moves: a response running up its thread, the readout landing.
  if (inRound && !still) duck *= 1 - 0.3 * Math.max(r.pulses.length ? bump(t, 0.25, 0.85) : 0, bump(t, READOUT - 0.04, READOUT + 0.28));
  if (seg === 'rewind') duck *= 0.8;

  // --- concept layer ---
  // Hovered or open: the rays and particles inside the item's wedge (out to the edge of the picture) and its own
  // inputs keep their light; everything else drops to 40 %.
  const fw = X.focus && X.dim > 0 ? tree.map.get(X.focus) : null;
  const fa0 = fw ? cellAngle(fw.c0) - 0.004 : 0, fa1 = fw ? cellAngle(fw.c1) + 0.004 : 0, fDim = 1 - 0.6 * X.dim, fIn2 = (G.r0 - 12) ** 2;
  const fk = (x, y) => {
    const dx = x - G.origin.x, dy = G.origin.y - y;
    if (dx * dx + dy * dy < fIn2) return fDim;
    const phi = Math.atan2(dx, dy);
    return phi >= fa0 && phi <= fa1 ? 1 : fDim;
  };
  let np = 0, nl = 0;
  const pushPoint = (x, y, s, a, ring = 0, keep = false) => { if (fw && !keep) a *= fk(x, y); if (np >= MAX_POINTS || a <= 0.003) return; const o = np * 5; pointBuf[o] = x; pointBuf[o + 1] = y; pointBuf[o + 2] = s; pointBuf[o + 3] = a; pointBuf[o + 4] = ring; np += 1; };
  const pushLine = (x0, y0, a0, x1, y1, a1) => { if (fw) { a0 *= fk(x0, y0); a1 *= fk(x1, y1); } if (nl + 2 > MAX_LINES || (a0 <= 0.002 && a1 <= 0.002)) return; const o = nl * 3; lineBuf[o] = x0; lineBuf[o + 1] = y0; lineBuf[o + 2] = a0; lineBuf[o + 3] = x1; lineBuf[o + 4] = y1; lineBuf[o + 5] = a1; nl += 2; };
  const T2 = still ? 0 : T;
  // Under the afterglow a still light piles up to 1/(1-keep) of itself; what stays put deposits only (1-keep) per frame,
  // so it settles at its own alpha, and only what moves leaves a trail. Canvas 2D has no afterglow.
  const norm = field.kind === 'webgl2' && !(still || play.frozen?.still) ? 1 - Math.exp(-Math.min(0.1, dt) / field.tau) : 1;
  // Stars twinkle on their own 2.9 s clock; the backdrop's current runs outward on a 4.1 s clock. Neither locks to the beat.
  for (const s of stars) pushPoint(s.x + Math.sin(T2 * 0.05 + s.ph) * 3, s.y, s.s, norm * s.a * (0.55 + 0.45 * Math.sin(T2 * 2.1667 + s.ph)));
  for (const [x0, y0, d0, x1, y1, d1, k] of backdrop) {
    const wave = rr => k * norm * (0.03 + 0.2 * Math.max(0, Math.sin(rr * 0.016 - T2 * 1.532)) ** 4);
    pushLine(x0, y0, wave(d0), x1, y1, wave(d1));
  }
  // Twigs: fine growth around each branch, seeded by the item, scaled by its share.
  for (const b of tree.list) {
    if (b.alpha <= 0.02 || b.length <= 0.02) continue;
    const rand = rng(hash(b.id));
    const n = Math.min(16, 3 + Math.floor(b.share / 1.8));
    for (let q = 0; q < n; q += 1) {
      const u = 0.5 + rand() * 0.5, at = onBranch(b, u), ahead = onBranch(b, Math.min(1, u + 0.02));
      const dir = Math.atan2(ahead.y - at.y, ahead.x - at.x) + (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.6);
      const L = (8 + rand() * 24) * (0.55 + Math.sqrt(Math.max(0, b.share) / 24)) * b.length;
      const end = { x: at.x + Math.cos(dir) * L, y: at.y + Math.sin(dir) * L };
      const a = 0.3 * b.alpha * norm;
      pushLine(at.x, at.y, a, end.x, end.y, a * 0.5);
      const dir2 = dir + (rand() - 0.5) * 1.1, L2 = L * (0.35 + rand() * 0.4);
      pushLine(end.x, end.y, a * 0.5, end.x + Math.cos(dir2) * L2, end.y + Math.sin(dir2) * L2, 0);
      pushPoint(end.x, end.y, 0.9, 0.16 * b.alpha * norm);
    }
  }
  // The sweep: an arc on the root's centre, exactly as wide as the fan, from beyond the cloud in to the root.
  // A steady leading stroke, with scribbled strokes trailing just outside it; the scribble calms as it closes.
  if (inRound && !still && t >= ARC0 && t <= ARC1 + 0.15) {
    const rad = arcRadius(Math.min(t, ARC1));
    const fadeIn = clamp((t - ARC0) / 0.1), fadeOut = 1 - clamp((t - ARC1) / 0.15);
    const sweepK = (r.events.length ? 1 : 0.3) * fadeIn * fadeOut * (norm < 1 ? 0.42 : 1);
    const amp = rad > G.R ? lerp(3, 10, clamp((rad - G.R) / (G.Rfar - G.R))) : 1.2 + 1.8 * clamp((rad - G.baseR) / (G.R - G.baseR));
    const jitterSeed = Math.floor(T * 20), half = G.fan / 2;
    const m = Math.max(24, Math.round((G.fan * rad) / 7));
    for (let layer = 0; layer < 4; layer += 1) {
      const rand = rng(hash(`${jitterSeed}:${layer}`));
      const lift = layer ? 2 + layer * 4 : 0, la = layer ? 0.55 / layer : 1;
      let prev = null;
      for (let q = 0; q <= m; q += 1) {
        const pt = polar(-half + (2 * half * q) / m, rad + lift + (rand() - 0.5) * (layer ? 2 * amp : 1.2));
        if (prev) pushLine(prev.x, prev.y, sweepK * la * (0.55 + rand() * 0.45), pt.x, pt.y, sweepK * la * (0.55 + rand() * 0.45));
        prev = pt;
      }
    }
  }
  // The round's inputs: one bright particle per input, with its motes.
  if (P) {
    const arcNow = arcRadius(Math.min(t, ARC1));
    for (let p = 0; p < P.count; p += 1) {
      const ts = P.ts[p];
      if (t < ts) continue;
      const land = ts + P.dur[p], fate = P.fate[p];
      // The hovered or open item's own inputs stay lit wherever they are.
      const mine = fw !== null && fate === 1 && P.target[p] >= 0 && P.targets[P.target[p]] === fw.id;
      let phi = P.phi[p], rad, a = P.alpha[p], s = P.size[p];
      if (t < land) {
        // Falling in along its ray toward the root: fast, then settling.
        const q = (t - ts) / P.dur[p];
        rad = lerp(P.rs[p], P.r1[p], easeOut4(q)); a *= 0.8 * lerp(1, norm, smooth01((q - 0.45) / 0.55));
        if (!still && q < 0.7) {
          const from = polar(phi, lerp(P.rs[p], P.r1[p], easeOut4(Math.max(0, q - 0.08 / P.dur[p])))), to = polar(phi, rad);
          pushLine(from.x, from.y, 0, to.x, to.y, a * 0.55 * (1 - q / 0.7));
        }
      } else if (t < P.tt[p] || (still && t < B3)) {
        // Landed with weight: a short impact flash and a damped settle along the ray.
        const since = t - land;
        rad = P.r1[p] - (still ? 0 : 3.2 * Math.exp(-since * 13) * Math.sin(since * 34));
        if (!still) phi += (Math.sin(T * 1.3 + P.seed[p]) * 0.5) / P.r1[p];
        a *= norm * (1 + (still ? 0 : (fate === 5 ? 1.2 : 2.6) * Math.exp(-since / 0.12)));
        // Each input carries a soft halo, so the 234 read as the cloud and the motes and stars as texture.
        if (fate !== 5) { const at = polar(phi, rad); pushPoint(at.x, at.y, s * 2.6, a * 0.2, 2, mine); }
      } else {
        const since = t - P.tt[p];
        if (fate === 1) {
          // Carried in by the arc; inside the fan it turns toward its branch's foot and lands there at ARC1.
          rad = Math.max(G.baseR, Math.min(P.r1[p], ride(arcNow, P.off[p])));
          const b = P.target[p] >= 0 ? tree.map.get(P.targets[P.target[p]]) : null;
          if (!b) {
            // Its item is not on the tree this round: it goes into the root and is gone.
            if (t >= ARC1 + 0.3 || still) continue;
            a *= norm * (1 - clamp((t - ARC1) / 0.3));
          } else {
            const k = smooth01((G.R - rad) / (G.R - G.baseR));
            phi = lerp(phi, b.angle, k);
            if (t >= ARC1 - 0.02 || still) {
              // It rests on its cell until its light leaves; the light is drawn with the branches.
              if (t >= P.leave[p] || still) continue;
              pushPoint(b.base.x, b.base.y, s * 1.15, a * norm * 1.4, 0, mine);
              continue;
            }
            a *= 1 + 0.25 * k;   // moving at full strength, so the afterglow draws its track
            if (k > 0) { const at = polar(phi, rad); pushPoint(at.x, at.y, s * 2.2, 0.5 * k, 2, mine); }   // inside the fan only the adopted are left: they glow
          }
        } else if (fate === 2) {
          // Carried to the rim, dimming as it goes, and left there as an ember.
          rad = Math.max(P.stop[p], Math.min(P.r1[p], ride(arcNow, P.off[p])));
          const sink = clamp(since / 0.6);
          // While the arc pushes it, it moves at full strength (the afterglow draws its track); at rest, normalised.
          a *= lerp(1, 0.36, sink) * (rad > P.stop[p] + 0.5 && rad < P.r1[p] - 0.5 ? 0.85 : norm);
          s *= 1 - 0.15 * sink;
        } else if (fate === 3) {
          const q = since / 0.22;
          if (q >= 1) continue;
          rad = P.r1[p]; a *= norm * (1 + 1.6 * (1 - q)) * (1 - q); s *= 1 - 0.5 * q;
        } else if (fate === 4) {
          const q = since / 0.5;
          if (q >= 1) continue;
          rad = P.r1[p] - 6 * q; a *= norm * (1 - q);
        } else {
          const q = since / 0.3;
          if (q >= 1) continue;
          rad = Math.min(P.r1[p], ride(arcNow, P.off[p])); a *= norm * (1 - q);
        }
      }
      const at = polar(phi, rad);
      pushPoint(at.x, at.y, s, a, P.ring[p], mine);
    }
    // The light running up each branch: its glow and track here, its bright core with the branches.
    if (!still) for (const [id, run] of P.runs) {
      const b = tree.map.get(id);
      if (!b || b.alpha <= 0.02) continue;
      run.leave.forEach(at => {
        const q = (t - at) / FLOW;
        if (q < 0 || q > 1.35) return;
        if (q <= 1) {
          const pt = frontOf(b, easeInOut(q));
          pushPoint(pt.x, pt.y, 5.5, 0.42, 2);
          pushPoint(pt.x, pt.y, 1.6, 0.85);
        } else pushPoint(b.tip.x, b.tip.y, 6.5, norm * 1.6 * (1 - (q - 1) / 0.35), 2);
      });
    }
  }
  // Last round's embers fade out under the new rain.
  if (inRound && i > 0 && t < 0.9 && rounds[i - 1].events.length) {
    const Q = particlesFor(i - 1), fadeK = 1 - t / 0.9;
    for (let p = 0; p < Q.count; p += 1 + DUST) {
      if (Q.fate[p] !== 2) continue;
      const at = polar(Q.phi[p], Q.stop[p]);
      pushPoint(at.x, at.y, Q.size[p] * 0.85, Q.alpha[p] * 0.36 * fadeK * norm, Q.ring[p]);
    }
  }
  livePoints = np; livePeak = Math.max(livePeak, np);
  const cards = cardMasks();
  field.frame({ points: pointBuf, pointCount: np, lines: lineBuf, lineCount: nl, duck, flash, masks: cards.length ? [...G.masks, ...cards] : G.masks, dt, still: still || Boolean(play.frozen && play.frozen.still) });

  // --- information layer ---
  drawInfo({ i, r, t, seg, tree, P, dim, fresh, still });
  // The rewind fades the end card's words out, swaps to f00's while they are invisible, and fades those in,
  // so the last rewind frame and the first f00 frame are the same picture.
  const swap = seg === 'rewind' && t >= REWIND / 2;
  if (swap && !play.swapped) { play.swapped = true; onRound(0); }
  const words = seg === 'rewind' && !still ? smooth01(Math.abs(1 - (2 * t) / REWIND) * 1.15) : 1;
  if (swap) paintText({ i: 0, r: rounds[0], t: OPEN, seg: 'open', P: null, dim: dim * words, fresh: [] });
  else paintText({ i, r, t, seg, P, dim: dim * words, fresh });
  // The cards follow the names just placed; their masks reach the concept layer on the next frame.
  ix.paint();
  syncItems();
  if (perfOn) paintPerf();
}

// A question's thread runs beside its branch, from the tip down into the branch's cells on the root,
// with a slight seeded tremor so it reads as a filament rather than a second branch.
function bolt(seed, b) {
  const rand = rng(hash(seed));
  const side = rand() < 0.5 ? -1 : 1, n = 16, pts = [];
  for (let q = 0; q <= n; q += 1) {
    const u = 1 - q / n, at = onBranch(b, u), ahead = onBranch(b, Math.max(0, u - 0.02));
    const dx = at.x - ahead.x, dy = at.y - ahead.y, len = Math.hypot(dx, dy) || 1;
    const off = q === 0 ? 0 : side * (4 + Math.max(0, b.share) * 0.17) + (rand() - 0.5) * 3.4;
    pts.push({ x: at.x - (dy / len) * off, y: at.y + (dx / len) * off });
  }
  pts.push(cellCenter(b));
  return pts;
}
function strokePath(pts, upto = 1) {
  const n = pts.length - 1, end = upto * n;
  info.beginPath();
  info.moveTo(pts[0].x, pts[0].y);
  for (let q = 1; q <= n; q += 1) {
    if (q <= end) info.lineTo(pts[q].x, pts[q].y);
    else { const k = end - (q - 1); if (k > 0) info.lineTo(lerp(pts[q - 1].x, pts[q].x, k), lerp(pts[q - 1].y, pts[q].y, k)); break; }
  }
  info.stroke();
}
const ink = a => `rgba(${INK[0]}, ${INK[1]}, ${INK[2]}, ${clamp(a).toFixed(3)})`;
const vermA = a => VERM.replace('rgb(', 'rgba(').replace(')', `, ${clamp(a).toFixed(3)})`);
const cellCenter = b => onRoot(b.angle, b.lift || 0);
// A path along a branch from fraction u0 to u1 of its full length.
function traceBranch(b, u0, u1) {
  const n = Math.max(2, Math.ceil((u1 - u0) * 24));
  info.beginPath();
  for (let q = 0; q <= n; q += 1) {
    const pt = frontOf(b, lerp(u0, u1, q / n));
    if (q) info.lineTo(pt.x, pt.y); else info.moveTo(pt.x, pt.y);
  }
}

function drawInfo({ i, r, t, seg, tree, P, dim, fresh, still }) {
  const W = G.W, H = G.H;
  info.clearRect(0, 0, W, H);
  const inRound = seg === 'round';
  const retire = seg === 'rewind' ? 1 - easeInOut(t / (REWIND * 0.85)) : 1;
  const D = dim;
  // Root: 64 cells. Items fill contiguous cells in the same order as their branches; the rest is open budget.
  const openingGlow = seg === 'open' && !still ? bump(t, 0.4, 0.95) : 0;
  const O = G.origin, used0 = tree.start, used1 = tree.start + tree.used;
  // Hovered or open: that item's branch, cells, lines, name and threads keep full strength, the others drop to 70 %,
  // and the share lines inside its wedge come up a little.
  const fw = X.focus && X.dim > 0 ? tree.map.get(X.focus) : null, others = 1 - 0.3 * X.dim;
  const fo = b => (fw && b.id !== fw.id ? others : 1);
  // The 64 share lines: always on screen. Unallocated shares are the faintest grey; allocated ones sit under their branch.
  info.lineWidth = 1;
  for (let c = 0; c < 64; c += 1) {
    const covered = clamp(Math.min(c + 1, used1) - Math.max(c, used0));
    const phi = cellAngle(c + 0.5), a = onRoot(phi, 10), b = onFan(phi, 1);
    const mine = fw && c + 0.5 > fw.c0 && c + 0.5 < fw.c1;
    info.setLineDash(covered > 0.5 ? [] : [1.5, 4.5]);
    info.strokeStyle = ink(((covered > 0.5 ? 0.06 + 0.1 * covered : 0.15) * (1 - openingGlow) * D + 0.5 * openingGlow * D) * (!fw ? 1 : mine ? 1 : others) + (mine ? 0.12 * X.dim * D : 0));
    info.beginPath(); info.moveTo(a.x, a.y); info.lineTo(b.x, b.y); info.stroke();
  }
  info.setLineDash([]);
  // The rim: where the 64 lines end. The cloud lies outside it, the sweep crosses it, the embers settle along it.
  info.strokeStyle = ink((0.09 + 0.3 * openingGlow) * D);
  info.beginPath(); info.arc(O.x, O.y, G.R, -G.fan / 2 - Math.PI / 2, G.fan / 2 - Math.PI / 2); info.stroke();
  // The root: 64 cells on an arc. Items fill contiguous cells under their branches; the rest is open budget.
  const gap = 0.0045;
  info.lineWidth = 7; info.lineCap = 'butt';
  info.strokeStyle = ink((0.13 + 0.5 * openingGlow) * D * (fw ? others : 1));
  for (let c = 0; c < 64; c += 1) {
    const lo = Math.max(c, used0), hi = Math.min(c + 1, used1);
    if (hi - lo >= 0.98) continue;
    info.beginPath(); info.arc(O.x, O.y, G.r0, cellAngle(c) + gap - Math.PI / 2, cellAngle(c + 1) - gap - Math.PI / 2); info.stroke();
  }
  for (const b of tree.list) {
    if (b.c1 - b.c0 <= 0.01) continue;
    info.strokeStyle = ink((0.72 * b.alpha * (1 - b.grey * 0.6) + 0.1) * D * fo(b));
    for (let c = Math.floor(b.c0 + 1e-6); c < Math.ceil(b.c1 - 1e-6); c += 1) {
      const lo = Math.max(b.c0, c), hi = Math.min(b.c1, c + 1);
      // A sliver narrower than the gaps would make canvas draw the long way round.
      if (cellAngle(hi) - cellAngle(lo) <= 2 * gap + 0.002) continue;
      // The open item's cells step out with its branch, on a concentric arc.
      info.beginPath(); info.arc(O.x, O.y, G.r0 + b.lift, cellAngle(lo) + gap - Math.PI / 2, cellAngle(hi) - gap - Math.PI / 2); info.stroke();
    }
  }
  info.font = `11px ${MONO}`;
  info.textBaseline = 'middle';
  info.textAlign = 'center';
  info.fillStyle = ink((0.62 + 0.38 * openingGlow) * D);
  info.fillText(`64 份 · 已分 ${Math.round(tree.used)}`, O.x, O.y + 13);
  // Answered questions leave a mark under the root, one per question, in a row centred on the root.
  const marksBefore = i ? rounds[i - 1].answeredSoFar : 0;
  const marksNow = inRound ? marksBefore + (t >= 0.3 ? r.answered.size : 0) : seg === 'open' ? 0 : r.answeredSoFar;
  const marksX = O.x - (ANSWERED * 6) / 2;
  for (let m = 0; m < marksNow; m += 1) {
    const appear = inRound && m >= marksBefore ? clamp((t - 0.3) / 0.2) : 1;
    info.fillStyle = vermA(0.85 * appear * D * retire);
    info.fillRect(marksX + m * 6, O.y + 23, 3, 3);
  }
  // Branches: width is the share. A branch that adopted inputs this round steps back while the arc brings them
  // in, and is lit again from the root up as far as its first light has climbed.
  info.lineCap = 'round';
  const runOf = b => (inRound && P && !still ? P.runs.get(b.id) : null);
  for (const b of tree.list) {
    if (b.alpha <= 0.01 || b.length <= 0.01) continue;
    const run = runOf(b);
    const lw = 0.7 + Math.max(0, b.share) * 0.34;
    const greyA = b.alpha * 0.9 * D * fo(b), inkA = 0.88 * b.alpha * D * fo(b);
    const col = k => (b.grey ? `rgba(${lerp(INK[0], 120, b.grey) | 0}, ${lerp(INK[1], 120, b.grey) | 0}, ${lerp(INK[2], 120, b.grey) | 0}, ${(greyA * k).toFixed(3)})` : ink(inkA * k));
    const lit = run ? easeInOut((t - run.leave[0]) / FLOW) : 1;
    const wait = run ? 1 - 0.5 * smooth01((t - RIM) / 0.4) : 1;
    info.beginPath(); info.moveTo(b.base.x, b.base.y); info.lineTo(b.tip.x, b.tip.y);
    info.strokeStyle = ink(0.02 * b.alpha * D); info.lineWidth = lw + 2; info.stroke();
    info.strokeStyle = col(lit >= 1 ? 1 : wait); info.lineWidth = lw; info.stroke();
    if (lit > 0 && lit < 1) { traceBranch(b, 0, lit); info.strokeStyle = col(1); info.stroke(); }
    info.fillStyle = col(lit >= 1 ? 1 : wait);
    info.beginPath(); info.arc(b.tip.x, b.tip.y, 1.6 + b.share * 0.07, 0, Math.PI * 2); info.fill();
  }
  // The light: each adopted input rests on its branch's foot, then runs up to the tip; the tip flashes when the
  // first one arrives and brightens with each after it; the whole branch glows briefly once the last is in.
  for (const b of tree.list) {
    const run = runOf(b);
    if (!run || b.alpha <= 0.02) continue;
    const lw = 0.7 + Math.max(0, b.share) * 0.34, tipR = 1.6 + b.share * 0.07, D = dim * fo(b);
    let resting = false, tipHot = 0;
    run.leave.forEach((at, k) => {
      if (t >= ARC1 - 0.02 && t < at) resting = true;
      const since = t - run.reach[k];
      if (since >= 0 && since < 0.25) tipHot = Math.max(tipHot, 1 - since / 0.25);
      const q = (t - at) / FLOW;
      if (q < 0 || q >= 1) return;
      const f = easeInOut(q), from = Math.max(0, f - 0.22);
      traceBranch(b, from, f);
      info.strokeStyle = ink(0.16 * b.alpha * D); info.lineWidth = lw + 7; info.stroke();
      info.strokeStyle = ink(b.alpha * D); info.lineWidth = lw + 1.2; info.stroke();
      const pt = frontOf(b, f);
      info.fillStyle = ink(b.alpha * D);
      info.beginPath(); info.arc(pt.x, pt.y, 2.3, 0, Math.PI * 2); info.fill();
    });
    const after = t - run.reach[run.reach.length - 1];
    if (after >= 0 && after < 0.35) {
      info.beginPath(); info.moveTo(b.base.x, b.base.y); info.lineTo(b.tip.x, b.tip.y);
      info.strokeStyle = ink(0.13 * (1 - after / 0.35) * b.alpha * D); info.lineWidth = lw + 6; info.stroke();
    }
    if (resting) {
      info.fillStyle = ink(0.95 * D);
      info.beginPath(); info.arc(b.base.x, b.base.y, 2.5, 0, Math.PI * 2); info.fill();
      info.strokeStyle = ink(0.35 * D); info.lineWidth = 1;
      info.beginPath(); info.arc(b.base.x, b.base.y, 5.5, 0, Math.PI * 2); info.stroke();
    }
    const first = t - run.reach[0];
    if (first >= 0 && first < 0.4) {
      info.strokeStyle = ink(0.75 * (1 - first / 0.4) * D); info.lineWidth = 1.2;
      info.beginPath(); info.arc(b.tip.x, b.tip.y, tipR + 2 + first * 32, 0, Math.PI * 2); info.stroke();
    }
    if (tipHot > 0) {
      info.fillStyle = ink(D);
      info.beginPath(); info.arc(b.tip.x, b.tip.y, tipR + 1.8 * tipHot, 0, Math.PI * 2); info.fill();
    }
  }
  drawLeaders();
  // Names at the larger tips and at every tip with a question open, outlined so the cloud never covers them.
  const openIds = new Set((inRound && t < STRIKE ? r.prevOpen : seg === 'open' ? [] : r.open).map(a => a.item));
  info.font = `11.5px ${MONO}`;
  const placed = [];
  const named = tree.list.filter(b => b.alpha > 0.15 && b.length >= 0.6 && (b.share >= 6 || openIds.has(b.id))).sort((a, b) => b.share - a.share || byOrder(a.id, b.id));
  for (const b of named) {
    const side = Math.sin(b.angle), align = side < -0.15 ? 'right' : side > 0.15 ? 'left' : 'center';
    const label = `${shortOf(b.id)} ${Math.round(b.share)}`, w = info.measureText(label).width;
    let tx = 0, ty = 0, box = null;
    for (const step of [9, 24, 40]) {
      const x = b.tip.x + side * step, y = b.tip.y - Math.cos(b.angle) * step - 2;
      const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      const r = [x0 - 3, y - 9, w + 6, 18];
      if (!placed.some(q => r[0] < q[0] + q[2] && q[0] < r[0] + r[2] && r[1] < q[1] + q[3] && q[1] < r[1] + r[3])) { tx = x; ty = y; box = r; break; }
    }
    if (!box) continue;
    placed.push(box);
    b.labelBox = box;   // the name is part of the branch's hover target
    info.textAlign = align;
    info.lineWidth = 4; info.strokeStyle = `rgba(9, 10, 11, ${(0.9 * b.alpha).toFixed(3)})`; info.strokeText(label, tx, ty);
    info.fillStyle = ink((fw && b.id === fw.id ? 0.8 + 0.2 * X.dim : 0.8) * b.alpha * D * fo(b)); info.fillText(label, tx, ty);
  }
  // Vermilion: registered questions only. Open threads, responses running up, strikes.
  const threads = [];
  if (inRound) {
    for (const a of r.prevOpen) {
      const b = tree.map.get(a.item);
      if (!b) continue;
      let alpha = 0.55, to = 1;
      // Answered: once your response reaches the tip, the thread draws back from the root and is gone.
      if (r.answered.has(a.id)) { const k = clamp((t - 0.82) / 0.3); to = 1 - k; if (k >= 1) continue; }
      else if (r.lapsed.has(a.id)) { const k = clamp((t - SHIFT) / 0.5); alpha *= 1 - k; if (k >= 1) continue; threads.push({ a, b, alpha, to, grey: Math.max(0.01, k) }); continue; }
      threads.push({ a, b, alpha, to });
    }
    for (const a of fresh) {
      const b = tree.map.get(a.item);
      const k = fresh.indexOf(a), at = STRIKE + 0.1 * k;
      if (!b || t < at) continue;
      const draw = clamp((t - at) / 0.14);
      const hot = t < at + 0.35 ? 1 : 1 - clamp((t - at - 0.35) / 0.45);
      threads.push({ a, b, alpha: 0.55 + 0.45 * hot, to: draw, hot, strike: true });
    }
  } else if (seg !== 'open') {
    for (const a of r.open) { const b = tree.map.get(a.item); if (b) threads.push({ a, b, alpha: 0.55 * retire, to: 1 }); }
  }
  info.lineCap = 'round'; info.lineJoin = 'round';
  for (const th of threads) {
    const seen = bolt(th.a.id, th.b);
    const dimK = th.strike ? 1 : D * fo(th.b);
    if (th.grey) { info.strokeStyle = `rgba(150, 150, 150, ${(th.alpha * dimK).toFixed(3)})`; info.lineWidth = 1; strokePath(seen, th.to); continue; }
    if (th.hot) {
      info.strokeStyle = vermA(0.1 * th.hot); info.lineWidth = 18; strokePath(seen, th.to);
      info.strokeStyle = vermA(0.32 * th.hot); info.lineWidth = 6.5; strokePath(seen, th.to);
      // Where the strike lands on the root, a short burst.
      if (th.to >= 1) {
        const since = t - (STRIKE + 0.1 * fresh.indexOf(th.a) + 0.14), end = seen[seen.length - 1];
        if (since >= 0 && since < 0.4) {
          info.strokeStyle = vermA(0.8 * (1 - since / 0.4)); info.lineWidth = 1.5;
          info.beginPath(); info.arc(end.x, end.y, 4 + since * 50, 0, Math.PI * 2); info.stroke();
        }
      }
    }
    info.strokeStyle = vermA(th.alpha * dimK); info.lineWidth = th.hot ? 2.2 : 1.1; strokePath(seen, th.to);
  }
  if (debugGeom) drawGeom(tree);
  // A response to a registered question runs from the root up its thread.
  if (inRound) r.pulses.forEach((pu, k) => {
    const b = tree.map.get(pu.item);
    if (!b) return;
    const q = (t - 0.3 - 0.08 * k) / 0.5;
    if (q < 0 || q > 1) return;
    const pts = bolt(pu.ask, b), n = pts.length - 1, at = (1 - easeInOut(q)) * n, s = Math.floor(at), f = at - s;
    const p0 = pts[Math.min(n, s)], p1 = pts[Math.min(n, s + 1)];
    const x = lerp(p0.x, p1.x, f), yy = lerp(p0.y, p1.y, f);
    info.fillStyle = vermA(0.25); info.beginPath(); info.arc(x, yy, 7, 0, Math.PI * 2); info.fill();
    info.fillStyle = vermA(1); info.beginPath(); info.arc(x, yy, 2.6, 0, Math.PI * 2); info.fill();
  });
}

// ---------- ?debug=geom: every branch against the rays, read back from the drawn coordinates ----------
// Angles are measured from the root's centre (0 up, positive to the right) off the points actually drawn: the
// branch's base and tip, the information layer's 64 share lines (cellAngle(c + 0.5)) and the concept layer's
// rays, taken from its own backdrop segments. All differences are in degrees.
function geomOf(tree) {
  if (!tree || !G) return [];
  const deg = a => (a * 180) / Math.PI;
  const angleOf = (x, y) => Math.atan2(x - G.origin.x, G.origin.y - y);
  const lines = Array.from({ length: 64 }, (_, c) => { const p = onFan(cellAngle(c + 0.5), 1); return angleOf(p.x, p.y); });
  const concept = [...new Set(backdrop.map(([, , , x1, y1]) => Math.round(angleOf(x1, y1) * 1e9)))].map(v => v / 1e9);
  const nearest = (list, a) => list.reduce((best, x) => (Math.abs(x - a) < Math.abs(best - a) ? x : best), Infinity);
  return tree.list.filter(b => b.alpha > 0.02 && b.length > 0.02).map(b => {
    const base = angleOf(b.base.x, b.base.y), tip = angleOf(b.tip.x, b.tip.y), ray = nearest(lines, tip);
    return {
      id: b.id, short: shortOf(b.id), share: Number(b.share.toFixed(3)), cells: [Number(b.c0.toFixed(3)), Number(b.c1.toFixed(3))],
      ray: Number(((tip - cellAngle(0)) / (G.fan / 64) - 0.5).toFixed(3)),
      base: deg(base), tip: deg(tip), dBase: deg(base - nearest(lines, base)), dTip: deg(tip - ray), dConcept: deg(tip - nearest(concept, tip)),
      inWedge: tip >= cellAngle(b.c0) - 1e-9 && tip <= cellAngle(b.c1) + 1e-9, merging: Boolean(b.mergeInto),
    };
  });
}
function drawGeom(tree) {
  const rows = geomOf(tree);
  info.save();
  info.font = `10.5px ${MONO}`; info.textAlign = 'left'; info.textBaseline = 'top';
  info.strokeStyle = 'rgba(80, 220, 255, 0.9)'; info.fillStyle = 'rgba(80, 220, 255, 0.95)'; info.lineWidth = 1;
  for (const b of tree.list) {
    if (b.alpha <= 0.02 || b.length <= 0.02) continue;
    for (const p of [b.base, b.tip]) { info.beginPath(); info.moveTo(p.x - 4, p.y); info.lineTo(p.x + 4, p.y); info.moveTo(p.x, p.y - 4); info.lineTo(p.x, p.y + 4); info.stroke(); }
  }
  const worst = rows.reduce((m, x) => Math.max(m, Math.abs(x.dBase), Math.abs(x.dTip), Math.abs(x.dConcept)), 0);
  const text = [`geom · ${rows.length} 枝 · 最大角度差 ${worst.toFixed(4)}°`, ...rows.map(x => `${x.short.padEnd(8, '　')} ${String(x.share).padStart(6)} 份  射线 ${x.ray}  Δ根 ${x.dBase.toFixed(4)}°  Δ梢 ${x.dTip.toFixed(4)}°  Δ概念 ${x.dConcept.toFixed(4)}°${x.inWedge ? '' : '  楔形外'}`)];
  const x0 = G.W - G.pad - 520, y0 = G.pad + 40;
  info.fillStyle = 'rgba(9, 10, 11, 0.85)'; info.fillRect(x0 - 8, y0 - 6, 528, text.length * 14 + 10);
  info.fillStyle = 'rgba(80, 220, 255, 0.95)';
  text.forEach((line, k) => info.fillText(line, x0, y0 + k * 14));
  info.restore();
}

const fmt = n => String(Math.round(n));
function paintText({ i, r, t, seg, P, dim, fresh }) {
  const f = frames[i];
  const inRound = seg === 'round';
  // Signal, narration, the round counter: hard cut at the start of each round.
  let signal, say, label = '本轮收到', nShown = 0, unit = '条', moved = '', asked = '', count;
  if (seg === 'open') {
    signal = `${dayTime(f.at)} · 空状态`; say = f.title; nShown = 0;
    count = `开始 · 共 ${LAST} 轮`;
  } else if (seg === 'end' || seg === 'rewind') {
    signal = `${formatDate(frames[0].at)} — ${formatDate(frames[LAST].at)} · ${LAST} 轮整理`; say = '两周'; label = '两周收到';
    const k = seg === 'end' ? easeOut(t / 0.9) : 1;
    nShown = seg === 'end' ? lerp(r.events.length, TOTAL, k) : TOTAL * (1 - easeInOut(t / (REWIND * 0.85)));
    if (seg === 'end' && t >= 1.1) { moved = '→ 新登记 '; asked = `${ASKED} 个问题`; }
    count = `${LAST} / ${LAST} 轮 · 累计 ${TOTAL} 条`;
  } else {
    const sig = f.signal;
    signal = `${dayTime(f.at)} · ${sig?.type === 'review' ? '定时整理，窗口内 0 条' : sig?.reason || '整理'}`;
    say = f.title;
    nShown = P ? countUpTo(P.landed, t) : 0;
    if (t >= READOUT) moved = `→ 动了 ${r.moved}`;
    if (fresh.length && t >= STRIKE) asked = ` · 新问 ${fresh.length}`;
    count = `第 ${i} / ${LAST} 轮 · 累计 ${(i ? rounds[i - 1].cumulative : 0) + nShown} 条`;
  }
  // An open item takes the narration: one cut on open, one on close (as the dial's title card).
  const view = X.detail && seg !== 'open' ? ix.view : null;
  if (view) { signal = `这一件 · ${f.id} · ${dayTime(f.at)}`; say = `第 ${view.i} 轮 · ${view.title}`; }
  const key = `${signal}|${say}|${label}|${fmt(nShown)}|${moved}|${asked}|${count}`;
  if (key !== textKey) {
    textKey = key; G.masks = null;   // the words moved: the concept layer steps aside from where they are now
    el.signal.textContent = signal; el.say.textContent = say; el.heroLabel.textContent = label;
    el.n.textContent = fmt(nShown); el.unit.textContent = unit; el.moved.textContent = moved; el.asked.textContent = asked;
    el.asked.classList.toggle('is-ask', Boolean(asked));
    el.count.textContent = count;
  }
  // Beat 2 lowers the hero to half; the readout keeps full strength.
  const heroK = inRound ? lerp(1, 0.5, easeOut((t - B2) / 0.3)) : seg === 'open' ? 0.45 : 1;
  el.n.style.opacity = (heroK * dim).toFixed(3);
  paintPanels({ i, r, t, seg, P, fresh, view });
  if (Math.abs(dim - lastDim) > 0.005) {
    lastDim = dim;
    stage.querySelectorAll('.pl-dim').forEach(node => { if (node !== el.n) node.style.opacity = dim.toFixed(3); });
    stage.querySelectorAll('.pl-asks-dim').forEach(node => { node.style.opacity = dim.toFixed(3); });
  }
}

function paintPanels({ i, r, t, seg, P, fresh, view }) {
  const inRound = seg === 'round';
  if (view) { paintItemPanels({ i, r, t, seg }, view); return; }
  const n = r.events.length;
  const landed = inRound && P ? countUpTo(P.landed, t) : seg === 'open' ? 0 : n;
  const out = inRound && P ? countUpTo(P.resolved, t) : seg === 'open' ? 0 : n - r.used;
  const settled = !inRound || t >= RIM + 0.1;
  const stageNo = inRound ? STAGES.filter(([at]) => t >= at).length - 1 : -1;
  const askPhase = inRound ? (t < 0.3 ? 0 : t < SHIFT ? 1 : t < STRIKE ? 2 : 3) : 3;
  const key = `${seg}|${i}|${landed}|${out}|${settled}|${stageNo}|${askPhase}|${t >= READOUT}`;
  if (key === panelKey) return;
  panelKey = key;
  const roundLabel = seg === 'open' ? '空状态' : frames[i].id;
  const breakdown = settled && seg !== 'open' ? `暂缓 ${r.counts.deferred} · 噪音 ${r.counts.noise}${r.counts.duplicate ? ` · 重复 ${r.counts.duplicate}` : ''}${r.counts.unjudged ? ` · 未判 ${r.counts.unjudged}` : ''}` : '';
  const total = Math.max(1, n);
  const lanes = hasStreams ? LANES.filter(s => r.streams[s]).map(s => `<i style="flex:${r.streams[s]}" title="${LANE_WORD[s]} ${r.streams[s]}"></i>`).join('') : '';
  const laneWords = hasStreams && seg !== 'open' ? LANES.filter(s => r.streams[s]).map(s => `${LANE_WORD[s]} ${r.streams[s]}`).join(' · ') : '';
  el.round.innerHTML = `<h3>本轮 <small>${esc(roundLabel)}</small></h3>
    <dl><dt>收到</dt><dd>${landed}</dd><dt>没采用</dt><dd>${inRound && t < ARC0 ? '…' : out}<small>${esc(breakdown)}</small></dd><dt>动了</dt><dd>${inRound && t < READOUT ? '…' : seg === 'open' ? 0 : r.moved}<small>${seg === 'open' ? '' : '件 · 新增、变大、撤下、合并'}</small></dd></dl>
    ${lanes ? `<div class="pl-lanes" style="width:${Math.min(100, (landed / total) * 100).toFixed(1)}%">${lanes}</div><p class="pl-lane-words">${esc(laneWords)}</p>` : `<p class="pl-lane-words">${seg === 'open' ? '还没有输入' : n ? '' : '定时整理，窗口内 0 条'}</p>`}`;
  // Open questions: before the strike the list is last round's (answered ones struck, lapsed ones grey); after it, this round's.
  let rows, count;
  if (!inRound) { rows = seg === 'open' ? [] : r.open.map(a => ({ a, state: '' })); count = rows.length; }
  else if (askPhase < 3) {
    rows = r.prevOpen.map(a => ({ a, state: r.answered.has(a.id) && askPhase >= 1 ? 'answered' : r.lapsed.has(a.id) && askPhase >= 2 ? 'lapsed' : '' }));
    count = r.prevOpen.length;
  } else {
    rows = r.open.map(a => ({ a, state: r.fresh.has(a.id) ? 'fresh' : '' }));
    count = r.open.length;
    rows.sort((x, y) => (y.state === 'fresh') - (x.state === 'fresh'));
  }
  const answeredTotal = inRound ? (i ? rounds[i - 1].answeredSoFar : 0) + (askPhase >= 1 ? r.answered.size : 0) : seg === 'open' ? 0 : r.answeredSoFar;
  const shown = rows.slice(0, rows.length > 5 ? 4 : 5);
  el.asks.innerHTML = `<h3 class="pl-asks-dim">开着的问题 <b>${count}</b><small>答掉 ${answeredTotal}</small></h3>
    <ul>${shown.map(({ a, state }) => `<li class="${state ? `is-${state}` : 'pl-asks-dim'}">${state === 'fresh' ? '<b>新</b>' : state === 'answered' ? '<b>答</b>' : state === 'lapsed' ? '<b>失效</b>' : '<b>·</b>'}${esc(a.short)}</li>`).join('')}</ul>
    ${rows.length > shown.length ? `<p class="pl-asks-dim pl-more">另有 ${rows.length - shown.length} 个</p>` : ''}`;
  el.pipe.innerHTML = `<h3>流水线</h3><ol>${[
    ['收到', seg === 'open' ? '—' : `${landed} 条`],
    ['归并', seg === 'open' ? '—' : inRound && t < B2 ? '…' : `采用 ${r.used}`],
    ['分配', seg === 'open' ? '—' : inRound && t < READOUT ? '…' : `动了 ${r.moved} 件`],
    ['回应', seg === 'open' ? '—' : inRound && t < STRIKE ? '…' : `新问 ${r.fresh.size}`],
  ].map(([name, value], k) => `<li class="${k === stageNo ? 'is-on' : ''}"><span>${k + 1}</span>${name}<em>${value}</em></li>`).join('')}</ol>`;
  lastDim = -1;
}

// While one item is open the three panels take its view, on the round's own beats: a value shows once its beat has
// come (its inputs once the sweep has brought them to the root, its share once “动了” lands, questions after the
// strike), so a round held mid-way does not tell what has not happened yet.
function paintItemPanels({ i, r, t, seg }, v) {
  const inRound = seg === 'round';
  const at = k => !inRound || t >= k;
  const askPhase = inRound ? (t < 0.3 ? 0 : t < SHIFT ? 1 : t < STRIKE ? 2 : 3) : 3;
  const stageNo = inRound ? STAGES.filter(([k]) => t >= k).length - 1 : -1;
  const key = `item|${v.id}|${i}|${at(ARC1)}|${at(READOUT)}|${askPhase}|${stageNo}`;
  if (key === panelKey) return;
  panelKey = key;
  const n = v.inputs.length;
  const byLane = factLanes.map((lane, k) => ({ label: lane.label, n: v.inputs.filter(x => x.lane === k).length })).filter(x => x.n);
  el.round.innerHTML = `<h3>这一件 <small>${esc(frames[i].id)} · ${esc(v.short)}</small></h3>
    <dl><dt>份额</dt><dd>${at(READOUT) ? v.share : v.before}<small>/ 64${at(READOUT) ? (v.change ? ` · ${esc(v.change.text)}` : '') : ' · …'}</small></dd>
      <dt>进了它</dt><dd>${at(ARC1) ? n : '…'}<small>条 · 本轮采用的输入</small></dd>
      <dt>来自</dt><dd>${esc(v.stream.join(' · ') || '—')}<small>按它到这一轮采用的输入</small></dd></dl>
    ${at(ARC1) && byLane.length ? `<div class="pl-lanes">${byLane.map(x => `<i style="flex:${x.n}" title="${esc(`${x.label} ${x.n}`)}"></i>`).join('')}</div><p class="pl-lane-words">${esc(byLane.map(x => `${x.label} ${x.n}`).join(' · '))}</p>` : ''}`;
  // Its questions: before the strike, last round's (answered struck, lapsed grey); after it, this round's, with deadlines.
  const dueOf = id => v.asks.find(a => a.id === id)?.due || '';
  const rows = askPhase < 3
    ? r.prevOpen.filter(a => a.item === v.id).map(a => ({ a, state: r.answered.has(a.id) && askPhase >= 1 ? 'answered' : r.lapsed.has(a.id) && askPhase >= 2 ? 'lapsed' : '' }))
    : r.open.filter(a => a.item === v.id).map(a => ({ a, state: inRound && r.fresh.has(a.id) ? 'fresh' : '' }));
  const mark = { fresh: '新', answered: '答', lapsed: '失效' };
  el.asks.innerHTML = `<h3>它的问题 <b>${rows.filter(x => !x.state || x.state === 'fresh').length}</b><small>${esc(v.short)}</small></h3>
    <ul>${rows.slice(0, 4).map(({ a, state }) => `<li class="${state ? `is-${state}` : ''}"><b>${mark[state] || '·'}</b>${esc(a.short)}${dueOf(a.id) ? `<small>${esc(dueOf(a.id))}</small>` : ''}</li>`).join('')}</ul>
    ${rows.length ? '' : '<p class="pl-more">没有开着的问题</p>'}`;
  // The four stages: lit where the round touched it (itemFacts phases), each value on its beat.
  const asked = asksSeen(v, { asks: true }).length;
  const values = [[ARC1, `${n} 条`], [ARC1, `采用 ${n}`], [READOUT, v.change?.text || '—'], [STRIKE, asked ? `问 ${asked}` : '—']];
  el.pipe.innerHTML = `<h3>流水线 <small>这一件</small></h3><ol>${['收到', '归并', '分配', '回应'].map((name, k) => {
    const shown = at(values[k][0]), touched = k === 3 ? asked > 0 : v.phases[k];
    return `<li class="${shown && touched ? 'is-on' : ''}"><span>${k + 1}</span>${name}<em>${shown ? esc(values[k][1]) : '…'}</em></li>`;
  }).join('')}</ol>`;
  lastDim = -1;
}

let perfTick = 0;
function paintPerf() {
  if ((perfTick += 1) % 15 || !frameTimes.length) return;
  const s = frameTimes.slice(-240).sort((a, b) => a - b), mean = s.reduce((x, y) => x + y, 0) / s.length;
  el.perf.textContent = `${field.kind} · ${(1 / mean).toFixed(1)} fps · p95 ${(s[Math.floor(s.length * 0.95)] * 1000).toFixed(1)} ms · 活粒子 ${livePoints}（峰值 ${livePeak}）`;
}

// ---------- loop, input, embedding ----------
let raf = 0, ixTail = false;
function loop(ms) {
  raf = requestAnimationFrame(loop);
  // A held still stops drawing, except while a hover or detail moves on it (and for one frame after).
  const live = ix.live();
  if (play.frozen?.done && !live && !ixTail) return;
  ixTail = live;
  const c0 = performance.now();
  render(ms / 1000);
  if (!play.frozen) { cpuTimes.push(performance.now() - c0); if (cpuTimes.length > 1800) cpuTimes.shift(); }
  if (play.frozen) play.frozen.done = true;
}
const report = followFrames(i => go(i));
// A held still is re-run after a resize, so its afterglow builds again in the new buffers.
new ResizeObserver(() => { measure(); textKey = ''; panelKey = ''; if (play.frozen) window.foldPulse.seek(play.index, play.frozen.t, play.seg); }).observe(stage);
measure();
document.addEventListener('click', event => {
  const b = event.target.closest('button');
  // The keyboard proxies and the detail's own buttons are the interaction module's (ix.mjs), as is a click outside
  // the stage that folds an open detail back.
  if (!b || ix.owns(b)) return;
  if ('play' in b.dataset) ix.reset();
  if (b.dataset.step) go(play.index + Number(b.dataset.step));
  else if (b.dataset.frame) go(Number(b.dataset.frame));
  else if ('play' in b.dataset) togglePlay();
  else if ('card' in b.dataset) { const off = document.body.classList.toggle('fs-no-card'); b.setAttribute('aria-pressed', String(!off)); }
});
document.addEventListener('keydown', event => {
  if (event.target.matches('input,textarea,select,[contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
  // Esc (fold the detail back, drop the summary) and Enter or Space on a branch or in the card are ix.mjs's.
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); go(play.index + (event.key === 'ArrowLeft' ? -1 : 1)); }
  else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); go(event.key === 'Home' ? 0 : LAST); }
  else if (event.key === ' ' && !event.target.closest('button, a, summary')) { event.preventDefault(); ix.reset(); togglePlay(); }
});
// Start: ?from= plays on from that round, ?frame= plays one round and holds, neither plays from the empty state.
if (fromParam != null) go(fromParam, { autoplay: true });
else if (frameParam != null) go(frameParam);
else go(0, { autoplay: true });
raf = requestAnimationFrame(loop);

// For stills and checks: seek(frame, t) renders that moment and holds it; resume() lets the clock run again.
window.foldPulse = {
  rounds, get index() { return play.index; },
  seek(index, t, seg = 'round') {
    index = clamp(Math.round(index), 0, LAST);
    seg = seg === 'round' && index === 0 ? 'open' : seg;
    // Another moment drops hover and detail; the same one (a resize re-runs it) keeps them.
    if (index !== play.index || seg !== play.seg) ix.reset();
    play.playing = false; paintPlay();
    enter(index, seg);
    // Run the last 0.3 s at 60 fps so the afterglow builds, then hold.
    const T = now(), held = hold.at;
    play.frozen = null; hold.at = null;
    for (let k = 18; k >= 1; k -= 1) { play.t0 = T - (t - k / 60); lastFrameAt = T - 1 / 60; render(T); }
    hold.at = held;
    play.frozen = { t, T, still: false, done: false };
    play.t0 = T - t;
    return { index, t, seg: play.seg };
  },
  resume() { play.frozen = null; play.t0 = now(); },
  // Interaction hooks for stills and checks, as foldDial's (ix.mjs): hover / unhover / open / close / ixAt / ix /
  // paused / pointOf (a branch's middle) / ixState; a branch by id or by its short name (母亲换水管, 猫看病).
  ...ix.hooks(),
  facts: (i, id) => factsOf(i, id),
  go, play: () => { if (!play.playing) togglePlay(); }, pause: () => { play.playing = false; paintPlay(); },
  stats() {
    const s = [...frameTimes].sort((a, b) => a - b), mean = s.reduce((x, y) => x + y, 0) / (s.length || 1);
    return { renderer: field.kind, fps: mean ? 1 / mean : null, p95: s.length ? s[Math.floor(s.length * 0.95)] : null, worst: s.length ? s[s.length - 1] : null, over20ms: s.filter(x => x > 0.02).length, livePoints, livePeak, samples: s.length, device: field.device || null,
      cpuMs: cpuTimes.length ? cpuTimes.reduce((x, y) => x + y, 0) / cpuTimes.length : null, cpuP95Ms: cpuTimes.length ? [...cpuTimes].sort((x, y) => x - y)[Math.floor(cpuTimes.length * 0.95)] : null };
  },
  resetStats() { frameTimes.length = 0; cpuTimes.length = 0; livePeak = 0; },
  // The branches of the frame on screen against the rays (?debug=geom draws the same); geom(i, t) computes the tree
  // of round i at second t without drawing it.
  geom: (i, t) => geomOf(i == null ? lastTree : treeAt(rounds[i], t, rounds[i].events.length ? particlesFor(i).runs : NO_RUNS)),
  // What the cloud of round i is made of: bright particles by fate, against the round's inputs.
  census(index) {
    const P = rounds[index].events.length ? particlesFor(index) : null, n = { inputs: rounds[index].events.length, bright: 0, motes: 0, adopted: 0, embers: 0, out: 0, dissolve: 0, lights: 0 };
    if (P) for (let p = 0; p < P.count; p += 1) {
      const f = P.fate[p];
      if (f === 5) { n.motes += 1; continue; }
      n.bright += 1;
      n[['', 'adopted', 'embers', 'out', 'dissolve'][f]] += 1;
    }
    if (P) for (const run of P.runs.values()) n.lights += run.leave.length;
    return n;
  },
};
