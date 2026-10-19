// 第三轮 · 概念动画 01 整理脉冲（pulse）。一轮整理演成 3.5 秒的一次脉冲：涌入、折叠、一问。
// 故事、节奏与约束见 pulse/story.md 与 pulse/spec.md；画面上的数字与 pulse/data.json 对得上。
//
// 只读同一份回放：variants/shared.mjs 的 records（scenario.mjs → engine.mjs）与 sketches/stage.mjs 的 askLife，
// 本页不另造数据。两层：概念层（pulse-field.mjs，粒子、弧、辉光、余辉，可以装饰）在下；信息层（本文件，
// 枝、64 格、朱红线、数字与面板，只在节拍上动、每个数都有出处）在上，文字只用等宽字。
//
// 地址参数：?frame=<帧> 打开某一轮并演一次；?from=<帧> 从某一轮起连播；都没有时从 f00 空状态起连播，
// 播完 28 轮接片尾，收回根，再从 f00 开始。?data= 选数据集，?card=0 收起概念卡，?perf 显示帧率。
import { scenario, records, frames, askLife, isSelf, shortOf, dayTime, reduced, esc, formatDate } from '../sketches/stage.mjs';
import { notice } from '../../variants/shared.mjs?v=feedback-loop-1';
import { formById, notesHref } from '../catalog.mjs';
import { followFrames } from '../../embed.mjs';
import { withDataset } from '../../data/select.mjs';
import { createField } from './pulse-field.mjs';

// ---------- timing (seconds) ----------
const ROUND = 3.5, OPEN = 1.0, END = 3.0, REWIND = 1.0;
const B2 = 1.0, B3 = 2.4;                 // beat boundaries: 涌入 [0, 1.0)、折叠 [1.0, 2.4)、一问 [2.4, 3.5)
const ARC0 = 1.0, ARC1 = 2.05;            // the sweep contracts toward the root
const FLY = 0.4;                          // an adopted input flying into its branch
const STRIKE = 2.7;                       // vermilion strike, after 0.3 s of dimming
const STAGES = [[0, '收到'], [B2, '归并'], [1.7, '分配'], [B3, '回应']];
const VERM = 'rgb(240, 88, 50)';
const INK = [232, 230, 223];
const MONO = '"SF Mono", ui-monospace, Menlo, Consolas, "PingFang SC", "Noto Sans Mono CJK SC", monospace';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeOut4 = k => 1 - (1 - clamp(k)) ** 4;
const easeInOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
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
  const events = [...frame.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map(e => {
    const disp = DISP.includes(e.disposition) ? e.disposition : 'unjudged';
    counts[disp] += 1;
    if (e.stream) streams[e.stream] = (streams[e.stream] || 0) + 1;
    const ref = cited.get(e.id) || e.relatedIds?.[0];
    return {
      id: e.id, disp, stream: e.stream || null, self: isSelf(e),
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
  return {
    i, frame, events, counts, streams, moved, used: counts.used,
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
  const fan = (150 * Math.PI) / 180;
  // The root is an arc of 64 cells; the tree is a symmetric fan over it that spans the width and reaches about
  // seven tenths of the picture's height, staying clear of the hero block.
  const r0 = clamp(Math.min(W * 0.06, (rootY - pad) * 0.18), 52, 92);
  const heroBottom = pad + 52 + heroSize + 24;
  const top = Math.max(H * 0.3, heroBottom + 26);
  const A = Math.max(r0 * 2, W / 2 - clamp(W * 0.1, 96, 150)), B = Math.max(r0 * 1.8, rootY - top);
  const corner = Math.max(Math.hypot(origin.x, origin.y), Math.hypot(W - origin.x, origin.y));
  G = {
    W, H, pad, panelY, panelH, rootY, origin, fan, r0, A, B,
    Rmax: corner + 30, Rmin: r0 + 14,
    cloud: { x0: pad, x1: W - pad, y0: pad + 4, y1: rootY - r0 - 50 },
    sediment: { y0: rootY - 30, y1: rootY - 8, gap: r0 + 44 },
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
}
// Cell c of the 64 (fractional c allowed) sits at this angle on the root arc; 0 is straight up.
const cellAngle = c => -G.fan / 2 + G.fan * (c / 64);
const onRoot = (phi, extra = 0) => ({ x: G.origin.x + Math.sin(phi) * (G.r0 + extra), y: G.origin.y - Math.cos(phi) * (G.r0 + extra) });
const onFan = (phi, rho) => ({ x: G.origin.x + Math.sin(phi) * G.A * rho, y: G.origin.y - Math.cos(phi) * G.B * rho });
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
// so branches do not cross. Presence, width and length are interpolated inside beat 2.
function branchTimes(r, particles) {
  const first = new Map(), last = new Map();
  if (particles) for (let p = 0; p < particles.count; p += 1) {
    if (particles.fate[p] !== 1) continue;
    const id = particles.targets[particles.target[p]], t = particles.tf[p] + FLY;
    if (!first.has(id) || t < first.get(id)) first.set(id, t);
    if (!last.has(id) || t > last.get(id)) last.set(id, t);
  }
  return { first, last };
}
function treeAt(r, t, times) {
  const ids = [...new Set([...r.before.keys(), ...r.after.keys()])].sort(byOrder);
  const list = [];
  for (const id of ids) {
    const sa = r.before.get(id), sb = r.after.get(id);
    let presence = 1, share = sa ?? sb, length = 1, alpha = 1, grey = 0, mergeInto = null, mergeK = 0;
    if (sa != null && sb != null) {
      const start = Math.min(2.0, times.first.get(id) ?? (sb > sa ? 1.75 : 1.7));
      share = lerp(sa, sb, easeOut((t - start) / 0.35));
    } else if (sb != null) {
      const start = clamp((times.first.get(id) ?? 1.75) - 0.3, 1.1, 1.9);
      const g = easeOut((t - start) / 0.45);
      presence = g; share = sb * g; length = g;
    } else {
      const start = Math.max(1.7, Math.min(2.0, (times.last.get(id) ?? 0) + 0.05));
      const w = easeInOut((t - start) / 0.5);
      const gone = r.gone.get(id) || { withdrawn: true };
      presence = 1 - w; share = sa * (1 - w); alpha = 1 - w; grey = w;
      if (gone.merged) { mergeInto = gone.merged; mergeK = w; } else length = 1 - 0.8 * w;
    }
    list.push({ id, presence, share, length, alpha, grey, mergeInto, mergeK });
  }
  return place(list);
}
function place(list) {
  // Mid-tween, growth and shrinkage overlap; the 64 cells never overflow, they are shared out proportionally.
  const shares = list.reduce((sum, b) => sum + Math.max(0, b.share), 0);
  const fit = shares > 64 ? 64 / shares : 1;
  // Items alternate left and right by first appearance; on each side the oldest sit nearest the middle. Each takes
  // a wedge of the 64 cells as wide as its share, and the two sides meet at the middle unless one side needs more.
  const side = b => (order.get(b.id) ?? 0) % 2;
  const left = list.filter(b => side(b) === 0).sort((a, b) => byOrder(b.id, a.id));
  const right = list.filter(b => side(b) === 1).sort((a, b) => byOrder(a.id, b.id));
  const width = bs => bs.reduce((sum, b) => sum + Math.max(0, b.share) * fit, 0);
  const L = width(left), R = width(right);
  const start = clamp(32, L, 64 - R) - L;
  const ordered = [...left, ...right];
  const map = new Map();
  let c = start;
  for (const b of ordered) {
    b.c0 = c; b.c1 = c + Math.max(0, b.share) * fit; c = b.c1;
    b.angle = cellAngle((b.c0 + b.c1) / 2);
    // Larger shares reach further: 24 shares touch the edge of the fan, one share a little under half way.
    const rho = 0.42 + 0.58 * Math.sqrt(Math.max(0, b.share) / 24);
    b.base = onRoot(b.angle, 5);
    const full = onFan(b.angle, rho);
    b.tip = { x: lerp(b.base.x, full.x, b.length), y: lerp(b.base.y, full.y, b.length) };
    map.set(b.id, b);
  }
  for (const b of ordered) if (b.mergeInto && map.has(b.mergeInto)) {
    const to = map.get(b.mergeInto).tip;
    b.tip = { x: lerp(b.tip.x, to.x, b.mergeK), y: lerp(b.tip.y, to.y, b.mergeK) };
  }
  // Rise first, then lean out.
  for (const b of ordered) b.ctrl = { x: lerp(b.base.x, b.tip.x, 0.36), y: lerp(b.base.y, b.tip.y, 0.66) };
  return { list: ordered, map, used: L + R, start };
}
const onBranch = (b, u) => {
  const v = 1 - u;
  return { x: v * v * b.base.x + 2 * v * u * b.ctrl.x + u * u * b.tip.x, y: v * v * b.base.y + 2 * v * u * b.ctrl.y + u * u * b.tip.y };
};
// The tree held at a frame's end (no motion).
function settledTree(i) {
  if (i < 0) return place([]);
  return place(records[i].state.root.items.map(x => x.id).sort(byOrder).map(id => ({
    id, presence: 1, share: records[i].state.root.items.find(x => x.id === id).share, length: 1, alpha: 1, grey: 0, mergeInto: null, mergeK: 0,
  })));
}

// ---------- particles: one seed per real input, puffed into a small cluster ----------
const particleCache = new Map();
// Fast through the sparse outside, slowing as it closes on the root (the reference arc eases out the same way).
const arcRadius = t => G.Rmin + (G.Rmax - G.Rmin) * (1 - easeOut((t - ARC0) / (ARC1 - ARC0)));
function touchTime(d) {
  if (d >= G.Rmax) return ARC0;
  if (d <= G.Rmin) return ARC1;
  let lo = ARC0, hi = ARC1;
  for (let k = 0; k < 22; k += 1) { const mid = (lo + hi) / 2; if (arcRadius(mid) > d) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
function particlesFor(i) {
  const key = `${i}:${G.key}`;
  if (particleCache.has(key)) return particleCache.get(key);
  const r = rounds[i], n = r.events.length;
  const k = n ? Math.max(4, Math.min(16, Math.floor(4000 / n))) : 0;
  const cap = n * k;
  const P = {
    count: cap, k, x0: new Float32Array(cap), y0: new Float32Array(cap), x1: new Float32Array(cap), y1: new Float32Array(cap),
    ts: new Float32Array(cap), dur: new Float32Array(cap), tf: new Float32Array(cap), size: new Float32Array(cap), alpha: new Float32Array(cap),
    ring: new Uint8Array(cap), glow: new Uint8Array(cap), stay: new Uint8Array(cap), fate: new Uint8Array(cap), target: new Int16Array(cap), u: new Float32Array(cap), side: new Float32Array(cap),
    sx: new Float32Array(cap), sy: new Float32Array(cap), seed: new Float32Array(cap), targets: [],
    landed: [], resolved: [],
  };
  const rand = rng(hash(`${scenario.id}:${frames[i].id}:${G.key}`));
  const lanes = hasStreams ? LANES : [null];
  const weights = hasStreams ? laneWeight : [1], wsum = weights.reduce((a, b) => a + b, 0);
  const laneX = weights.map((w, k) => G.cloud.x0 + (G.cloud.x1 - G.cloud.x0) * weights.slice(0, k).reduce((a, b) => a + b, 0) / wsum);
  const laneW = weights.map(w => (G.cloud.x1 - G.cloud.x0) * w / wsum);
  const blocked = (G.masks || []).map(([x, y, w, h]) => [x - 18, y - 18, w + 36, h + 36]);
  const inMask = (x, y) => blocked.some(([bx, by, bw, bh]) => x > bx && x < bx + bw && y > by && y < by + bh);
  const targetIndex = new Map();
  let p = 0;
  r.events.forEach((e, j) => {
    const lane = Math.max(0, lanes.indexOf(e.stream));
    let cx = 0, cy = 0;
    for (let tries = 0; tries < 12; tries += 1) {
      cx = laneX[lane] + laneW[lane] * (0.04 + 0.92 * rand());
      cy = G.cloud.y0 + (G.cloud.y1 - G.cloud.y0) * rand() ** 0.85;
      if (!inMask(cx, cy)) break;
    }
    const ts = 0.03 + 0.48 * (j / Math.max(1, n)) + rand() * 0.03, dur = 0.3 + rand() * 0.12;
    const spread = 7 + rand() * 12;
    let ti = -1;
    if (e.target) { if (!targetIndex.has(e.target)) { targetIndex.set(e.target, P.targets.length); P.targets.push(e.target); } ti = targetIndex.get(e.target); }
    const fateOf = { used: 4, deferred: 2, noise: 3, duplicate: 3, unjudged: 4 };
    for (let q = 0; q < k; q += 1, p += 1) {
      const carrier = q === 0 && e.disp === 'used' && ti >= 0;
      const x1 = carrier ? cx : cx + gauss(rand) * spread, y1 = carrier ? cy : cy + gauss(rand) * spread;
      P.x1[p] = x1; P.y1[p] = y1;
      P.x0[p] = x1 + (rand() - 0.5) * 26; P.y0[p] = -24 - rand() * 150;
      P.ts[p] = ts + rand() * 0.025; P.dur[p] = dur;
      P.tf[p] = touchTime(Math.hypot(x1 - G.origin.x, y1 - G.origin.y)) + rand() * 0.03;
      P.size[p] = (carrier ? 2.7 : 1.1 + rand() * 1.4) * (e.machine ? 0.72 : 1);
      P.alpha[p] = (carrier ? 1 : 0.68 + rand() * 0.4) * (e.machine ? 0.6 : 1);
      P.glow[p] = !carrier && rand() < 0.05 ? 1 : 0;
      P.ring[p] = q === 0 && e.self ? 1 : 0;
      // fate: 1 fly into the branch, 2 sink to embers, 3 go out, 4 dissolve
      P.fate[p] = carrier ? 1 : fateOf[e.disp];
      P.target[p] = carrier ? ti : -1;
      P.u[p] = 0.35 + rand() * 0.35;
      P.side[p] = rand() < 0.5 ? -1 : 1;
      // Deferred inputs settle in a band on either side of the root, clear of the branches' feet.
      const sx = x1 + (rand() - 0.5) * 60, off = sx - G.origin.x;
      P.sx[p] = sx; P.stay[p] = Math.abs(off) < G.sediment.gap ? 1 : 0;
      P.sy[p] = G.sediment.y0 + (G.sediment.y1 - G.sediment.y0) * rand();
      P.seed[p] = rand() * 6.283;
    }
    P.landed.push(ts + dur);
    if (e.disp !== 'used') P.resolved.push(touchTime(Math.hypot(cx - G.origin.x, cy - G.origin.y)));
  });
  P.landed.sort((a, b) => a - b);
  P.resolved.sort((a, b) => a - b);
  particleCache.set(key, P);
  if (particleCache.size > 6) particleCache.delete(particleCache.keys().next().value);
  return P;
}
const smooth01 = x => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
const countUpTo = (sorted, t) => { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= t) lo = mid + 1; else hi = mid; } return lo; };

// ---------- concept layer: backdrop, twigs, sweep ----------
const MAX_POINTS = 6000, MAX_LINES = 16000;
const pointBuf = new Float32Array(MAX_POINTS * 5), lineBuf = new Float32Array(MAX_LINES * 3);
let backdrop = null, stars = null;
function buildBackdrop() {
  const rand = rng(hash(`backdrop:${G.key}`));
  const segs = [];
  // The concept layer's current runs outward along the same 64 lines the information layer draws for the budget.
  for (let c = 0; c < 64; c += 1) {
    const phi = cellAngle(c + 0.5), steps = 12, from = (G.r0 + 10) / G.B;
    let prev = onFan(phi, from), prevD = Math.hypot(prev.x - G.origin.x, prev.y - G.origin.y);
    for (let q = 1; q <= steps; q += 1) {
      const pt = onFan(phi, from + (1 - from) * (q / steps)), d = Math.hypot(pt.x - G.origin.x, pt.y - G.origin.y);
      segs.push([prev.x, prev.y, prevD, pt.x, pt.y, d]);
      prev = pt; prevD = d;
    }
  }
  backdrop = segs;
  stars = Array.from({ length: 700 }, () => ({ x: rand() * G.W, y: rand() * (G.panelY - 10), s: 0.6 + rand() * 0.9, a: 0.08 + rand() * 0.26, ph: rand() * 6.283 }));
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

// ---------- drawing ----------
let lastFrameAt = 0, lastDim = -1, panelKey = '', textKey = '';
const frameTimes = [], cpuTimes = [];
let livePoints = 0, livePeak = 0;

function render(wall) {
  if (!G || !G.W) return;
  if (!G.masks) G.masks = masks();
  const still = reduced();
  const dt = play.frozen ? 1 / 60 : lastFrameAt ? Math.min(0.1, wall - lastFrameAt) : 1 / 60;
  if (!play.frozen && lastFrameAt) { frameTimes.push(wall - lastFrameAt); if (frameTimes.length > 1800) frameTimes.shift(); }
  lastFrameAt = wall;
  let t = (play.frozen ? play.frozen.t : wall - play.t0);
  const T = play.frozen ? play.frozen.T : wall;
  const len = segLength(play.seg);
  if (!play.frozen && play.playing && t >= len) { advance(wall); t = 0; }
  t = Math.min(t, len);
  // Reduced motion: each beat jumps to its end state.
  if (still && play.seg === 'round') t = t < B2 ? B2 : t < B3 ? B3 : ROUND;
  else if (still) t = len;
  const i = play.index, r = rounds[i], seg = play.seg;

  // --- the tree and its timing ---
  const inRound = seg === 'round';
  const P = inRound && r.events.length ? particlesFor(i) : null;
  const times = branchTimes(r, P);
  let tree;
  if (inRound) tree = treeAt(r, t, times);
  else if (seg === 'open') tree = place([]);
  else tree = settledTree(i);
  // The rewind draws every branch back into the root before f00 begins again.
  const retract = seg === 'rewind' ? easeInOut(t / (REWIND * 0.85)) : 0;
  if (retract) tree = place(tree.list.map(b => ({ ...b, share: b.share * (1 - retract), presence: 1 - retract, length: 1 - retract, alpha: 1 - retract })));

  const fresh = inRound ? r.open.filter(a => r.fresh.has(a.id)) : [];
  const dimOn = inRound && fresh.length > 0 && !still;
  // Before the strike the whole picture goes dark for 0.3 s; afterwards it comes back slowly.
  const dim = !dimOn ? 1 : t < B3 ? 1 : t < STRIKE ? 1 - 0.58 * easeInOut((t - B3) / (STRIKE - B3)) : t < 3.05 ? 0.42 : lerp(0.42, 1, easeInOut((t - 3.05) / 0.45));
  const flash = inRound && !still ? 0.75 * bump(t, 2.12, 2.46) * Math.min(1, r.events.length / 60 + 0.25) : 0;
  let duck = dimOn ? (t < B3 ? 1 : t < STRIKE ? lerp(1, 0.22, easeInOut((t - B3) / (STRIKE - B3))) : t < 3.05 ? 0.22 : lerp(0.22, 0.95, easeInOut((t - 3.05) / 0.45))) : 1;
  // Small ducks under information moves: a response running up its thread, the readout landing.
  if (inRound && !still) duck *= 1 - 0.3 * Math.max(r.pulses.length ? bump(t, 0.25, 0.85) : 0, bump(t, 2.18, 2.5));
  if (seg === 'rewind') duck *= 0.8;

  // --- concept layer ---
  let np = 0, nl = 0;
  const pushPoint = (x, y, s, a, ring = 0) => { if (np >= MAX_POINTS || a <= 0.003) return; const o = np * 5; pointBuf[o] = x; pointBuf[o + 1] = y; pointBuf[o + 2] = s; pointBuf[o + 3] = a; pointBuf[o + 4] = ring; np += 1; };
  const pushLine = (x0, y0, a0, x1, y1, a1) => { if (nl + 2 > MAX_LINES || (a0 <= 0.002 && a1 <= 0.002)) return; const o = nl * 3; lineBuf[o] = x0; lineBuf[o + 1] = y0; lineBuf[o + 2] = a0; lineBuf[o + 3] = x1; lineBuf[o + 4] = y1; lineBuf[o + 5] = a1; nl += 2; };
  const T2 = still ? 0 : T;
  // Under the afterglow a still light piles up to 1/(1-keep) of itself; what stays put deposits only (1-keep) per frame,
  // so it settles at its own alpha, and only what moves leaves a trail. Canvas 2D has no afterglow.
  const norm = field.kind === 'webgl2' && !(still || play.frozen?.still) ? 1 - Math.exp(-Math.min(0.1, dt) / field.tau) : 1;
  // Stars twinkle on their own 2.9 s clock; the backdrop's current runs outward on a 4.1 s clock. Neither locks to the beat.
  for (const s of stars) pushPoint(s.x + Math.sin(T2 * 0.05 + s.ph) * 3, s.y, s.s, norm * s.a * (0.55 + 0.45 * Math.sin(T2 * 2.1667 + s.ph)));
  for (const [x0, y0, r0, x1, y1, r1] of backdrop) {
    const wave = rr => norm * (0.03 + 0.2 * Math.max(0, Math.sin(rr * 0.016 - T2 * 1.532)) ** 4);
    pushLine(x0, y0, wave(r0), x1, y1, wave(r1));
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
  // The sweep: a scribbled arc contracting toward the root. Coarse and sparse first, finer as it closes.
  if (inRound && !still && t >= ARC0 && t <= ARC1 + 0.12) {
    const k = clamp((t - ARC0) / (ARC1 - ARC0));
    const rad = arcRadius(Math.min(t, ARC1));
    const fadeIn = clamp((t - ARC0) / 0.12), fadeOut = 1 - clamp((t - ARC1) / 0.12);
    const base = (r.events.length ? 1 : 0.3) * fadeIn * fadeOut;
    const jitterSeed = Math.floor(T * 20);
    // The scribble changes every third frame, so it deposits about three frames' worth.
    const closing = clamp((rad - G.Rmin) / (G.r0 * 1.6));
    const sweepK = base * (norm < 1 ? 0.42 : 1) * (0.15 + 0.85 * closing);
    const span = G.fan / 2 + 0.14;
    for (let layer = 0; layer < 5; layer += 1) {
      const rand = rng(hash(`${jitterSeed}:${layer}`));
      const m = Math.round((60 + 120 * k) * span / 1.78);
      const amp = 42 * (1 - k) + 9;
      let prev = null;
      for (let q = 0; q <= m; q += 1) {
        const a = -span + (2 * span * q) / m;
        const rr = rad + (rand() - 0.5) * 2 * amp + layer * 5;
        const pt = { x: G.origin.x + Math.sin(a) * rr, y: G.origin.y - Math.cos(a) * rr };
        if (prev) pushLine(prev.x, prev.y, sweepK * (0.5 + rand() * 0.5), pt.x, pt.y, sweepK * (0.5 + rand() * 0.5));
        prev = pt;
      }
    }
  }
  // The round's inputs.
  if (P) {
    for (let p = 0; p < P.count; p += 1) {
      const ts = P.ts[p];
      if (t < ts) continue;
      const land = ts + P.dur[p];
      let x, y, a = P.alpha[p], s = P.size[p];
      if (t < land) {
        const q = (t - ts) / P.dur[p], e = easeOut4(q);
        x = lerp(P.x0[p], P.x1[p], e); y = lerp(P.y0[p], P.y1[p], e); a *= 0.8 * lerp(1, norm, smooth01((q - 0.45) / 0.55));
        if (!still && q < 0.7) {
          const eb = easeOut4(Math.max(0, q - 0.08 / P.dur[p]));
          pushLine(lerp(P.x0[p], P.x1[p], eb), lerp(P.y0[p], P.y1[p], eb), 0, x, y, a * 0.55 * (1 - q / 0.7));
        }
      } else if (t < P.tf[p] || still && t < B3) {
        // Landed with weight: a short impact flash and a damped settle.
        const since = t - land;
        x = P.x1[p] + (still ? 0 : Math.sin(T * 1.3 + P.seed[p]) * 0.5);
        y = P.y1[p] - (still ? 0 : 3.2 * Math.exp(-since * 13) * Math.sin(since * 34));
        a *= norm * (1 + (still ? 0 : 2.6 * Math.exp(-since / 0.12)));
      } else {
        const since = t - P.tf[p];
        const fate = P.fate[p];
        if (fate === 1) {
          const q = since / FLY;
          if (q >= 1 || still) continue;
          const b = tree.map.get(P.targets[P.target[p]]);
          const to = b ? onBranch(b, P.u[p]) : G.origin;
          const from = { x: P.x1[p], y: P.y1[p] };
          const mid = { x: (from.x + to.x) / 2 + P.side[p] * (to.y - from.y) * 0.22, y: (from.y + to.y) / 2 - P.side[p] * (to.x - from.x) * 0.22 };
          const e = easeInOut(q), v = 1 - e;
          x = v * v * from.x + 2 * v * e * mid.x + e * e * to.x; y = v * v * from.y + 2 * v * e * mid.y + e * e * to.y;
          a = 0.95; s *= 0.8;
        } else if (fate === 2) {
          const q = clamp(since / 0.7), e = q * q;
          if (P.stay[p]) { if (q >= 1) continue; x = P.x1[p]; y = P.y1[p]; a *= norm * (1 - q); }
          else { x = lerp(P.x1[p], P.sx[p], e); y = lerp(P.y1[p], P.sy[p], e); a = lerp(a, 0.34, q) * norm; }
          s *= 0.85;
        } else if (fate === 3) {
          const q = since / 0.22;
          if (q >= 1) continue;
          x = P.x1[p]; y = P.y1[p]; a *= norm * (1 + 1.6 * (1 - q)) * (1 - q); s *= 1 - 0.5 * q;
        } else {
          const q = since / 0.5;
          if (q >= 1) continue;
          x = P.x1[p]; y = P.y1[p] - 6 * q; a *= norm * (1 - q);
        }
      }
      pushPoint(x, y, s, a, P.ring[p]);
      if (P.glow[p]) pushPoint(x, y, s * 4.2, a * 0.5, 2);
    }
  }
  // Last round's embers fade out under the new rain.
  if (inRound && i > 0 && t < 1.2 && rounds[i - 1].events.length) {
    const Q = particlesFor(i - 1), fadeK = 1 - t / 1.2;
    for (let p = 0; p < Q.count; p += 3) if (Q.fate[p] === 2 && !Q.stay[p]) pushPoint(Q.sx[p], Q.sy[p], Q.size[p] * 0.85, 0.34 * fadeK * norm);
  }
  livePoints = np; livePeak = Math.max(livePeak, np);
  field.frame({ points: pointBuf, pointCount: np, lines: lineBuf, lineCount: nl, duck, flash, masks: G.masks, dt, still: still || Boolean(play.frozen && play.frozen.still) });

  // --- information layer ---
  drawInfo({ i, r, t, seg, tree, P, times, dim, fresh, still });
  // The rewind fades the end card's words out, swaps to f00's while they are invisible, and fades those in,
  // so the last rewind frame and the first f00 frame are the same picture.
  const swap = seg === 'rewind' && t >= REWIND / 2;
  if (swap && !play.swapped) { play.swapped = true; onRound(0); }
  const words = seg === 'rewind' && !still ? smooth01(Math.abs(1 - (2 * t) / REWIND) * 1.15) : 1;
  if (swap) paintText({ i: 0, r: rounds[0], t: OPEN, seg: 'open', P: null, dim: dim * words, fresh: [] });
  else paintText({ i, r, t, seg, P, dim: dim * words, fresh });
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
const cellCenter = b => onRoot(b.angle, 0);

function drawInfo({ i, r, t, seg, tree, P, times, dim, fresh, still }) {
  const W = G.W, H = G.H;
  info.clearRect(0, 0, W, H);
  const inRound = seg === 'round';
  const retire = seg === 'rewind' ? 1 - easeInOut(t / (REWIND * 0.85)) : 1;
  const D = dim;
  // Root: 64 cells. Items fill contiguous cells in the same order as their branches; the rest is open budget.
  const openingGlow = seg === 'open' && !still ? bump(t, 0.4, 0.95) : 0;
  const O = G.origin, used0 = tree.start, used1 = tree.start + tree.used;
  // The 64 share lines: always on screen. Unallocated shares are the faintest grey; allocated ones sit under their branch.
  info.lineWidth = 1;
  for (let c = 0; c < 64; c += 1) {
    const covered = clamp(Math.min(c + 1, used1) - Math.max(c, used0));
    const phi = cellAngle(c + 0.5), a = onRoot(phi, 10), b = onFan(phi, 1);
    info.setLineDash(covered > 0.5 ? [] : [1.5, 4.5]);
    info.strokeStyle = ink((covered > 0.5 ? 0.06 + 0.1 * covered : 0.15) * (1 - openingGlow) * D + 0.5 * openingGlow * D);
    info.beginPath(); info.moveTo(a.x, a.y); info.lineTo(b.x, b.y); info.stroke();
  }
  info.setLineDash([]);
  // The root: 64 cells on an arc. Items fill contiguous cells under their branches; the rest is open budget.
  const gap = 0.0045;
  info.lineWidth = 7; info.lineCap = 'butt';
  info.strokeStyle = ink((0.13 + 0.5 * openingGlow) * D);
  for (let c = 0; c < 64; c += 1) {
    const lo = Math.max(c, used0), hi = Math.min(c + 1, used1);
    if (hi - lo >= 0.98) continue;
    info.beginPath(); info.arc(O.x, O.y, G.r0, cellAngle(c) + gap - Math.PI / 2, cellAngle(c + 1) - gap - Math.PI / 2); info.stroke();
  }
  for (const b of tree.list) {
    if (b.c1 - b.c0 <= 0.01) continue;
    info.strokeStyle = ink((0.72 * b.alpha * (1 - b.grey * 0.6) + 0.1) * D);
    for (let c = Math.floor(b.c0 + 1e-6); c < Math.ceil(b.c1 - 1e-6); c += 1) {
      const lo = Math.max(b.c0, c), hi = Math.min(b.c1, c + 1);
      // A sliver narrower than the gaps would make canvas draw the long way round.
      if (cellAngle(hi) - cellAngle(lo) <= 2 * gap + 0.002) continue;
      info.beginPath(); info.arc(O.x, O.y, G.r0, cellAngle(lo) + gap - Math.PI / 2, cellAngle(hi) - gap - Math.PI / 2); info.stroke();
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
  // Branches: width is the share; a branch glows when adopted inputs arrive.
  info.lineCap = 'round';
  for (const b of tree.list) {
    if (b.alpha <= 0.01 || b.length <= 0.01) continue;
    let glow = 0;
    if (P && inRound) for (let p = 0; p < P.count; p += 1) {
      if (P.fate[p] !== 1 || P.targets[P.target[p]] !== b.id) continue;
      const since = t - (P.tf[p] + FLY);
      if (since >= 0 && since < 0.4) glow = Math.min(1, glow + 0.35 * Math.exp(-since / 0.14));
    }
    const lw = 0.7 + Math.max(0, b.share) * 0.34;
    const col = b.grey ? `rgba(${lerp(INK[0], 120, b.grey) | 0}, ${lerp(INK[1], 120, b.grey) | 0}, ${lerp(INK[2], 120, b.grey) | 0}, ${(b.alpha * 0.9 * D).toFixed(3)})` : ink(0.88 * b.alpha * D);
    info.beginPath(); info.moveTo(b.base.x, b.base.y); info.quadraticCurveTo(b.ctrl.x, b.ctrl.y, b.tip.x, b.tip.y);
    info.strokeStyle = ink((0.02 + glow * 0.1) * b.alpha * D); info.lineWidth = lw + 2 + glow * 3.5; info.stroke();
    info.strokeStyle = col; info.lineWidth = lw; info.stroke();
    info.fillStyle = col;
    info.beginPath(); info.arc(b.tip.x, b.tip.y, 1.6 + b.share * 0.07, 0, Math.PI * 2); info.fill();
  }
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
    info.textAlign = align;
    info.lineWidth = 4; info.strokeStyle = `rgba(9, 10, 11, ${(0.9 * b.alpha).toFixed(3)})`; info.strokeText(label, tx, ty);
    info.fillStyle = ink(0.8 * b.alpha * D); info.fillText(label, tx, ty);
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
      else if (r.lapsed.has(a.id)) { const k = clamp((t - 1.7) / 0.5); alpha *= 1 - k; if (k >= 1) continue; threads.push({ a, b, alpha, to, grey: Math.max(0.01, k) }); continue; }
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
    const dimK = th.strike ? 1 : D;
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
    if (t >= 2.22) moved = `→ 动了 ${r.moved}`;
    if (fresh.length && t >= STRIKE) asked = ` · 新问 ${fresh.length}`;
    count = `第 ${i} / ${LAST} 轮 · 累计 ${(i ? rounds[i - 1].cumulative : 0) + nShown} 条`;
  }
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
  paintPanels({ i, r, t, seg, P, fresh });
  if (Math.abs(dim - lastDim) > 0.005) {
    lastDim = dim;
    stage.querySelectorAll('.pl-dim').forEach(node => { if (node !== el.n) node.style.opacity = dim.toFixed(3); });
    stage.querySelectorAll('.pl-asks-dim').forEach(node => { node.style.opacity = dim.toFixed(3); });
  }
}

function paintPanels({ i, r, t, seg, P, fresh }) {
  const inRound = seg === 'round';
  const n = r.events.length;
  const landed = inRound && P ? countUpTo(P.landed, t) : seg === 'open' ? 0 : n;
  const out = inRound && P ? countUpTo(P.resolved, t) : seg === 'open' ? 0 : n - r.used;
  const settled = !inRound || t >= 2.06;
  const stageNo = inRound ? STAGES.filter(([at]) => t >= at).length - 1 : -1;
  const askPhase = inRound ? (t < 0.3 ? 0 : t < 1.7 ? 1 : t < STRIKE ? 2 : 3) : 3;
  const key = `${seg}|${i}|${landed}|${out}|${settled}|${stageNo}|${askPhase}|${t >= 2.22}`;
  if (key === panelKey) return;
  panelKey = key;
  const roundLabel = seg === 'open' ? '空状态' : frames[i].id;
  const breakdown = settled && seg !== 'open' ? `暂缓 ${r.counts.deferred} · 噪音 ${r.counts.noise}${r.counts.duplicate ? ` · 重复 ${r.counts.duplicate}` : ''}${r.counts.unjudged ? ` · 未判 ${r.counts.unjudged}` : ''}` : '';
  const total = Math.max(1, n);
  const lanes = hasStreams ? LANES.filter(s => r.streams[s]).map(s => `<i style="flex:${r.streams[s]}" title="${LANE_WORD[s]} ${r.streams[s]}"></i>`).join('') : '';
  const laneWords = hasStreams && seg !== 'open' ? LANES.filter(s => r.streams[s]).map(s => `${LANE_WORD[s]} ${r.streams[s]}`).join(' · ') : '';
  el.round.innerHTML = `<h3>本轮 <small>${esc(roundLabel)}</small></h3>
    <dl><dt>收到</dt><dd>${landed}</dd><dt>没采用</dt><dd>${inRound && t < ARC0 ? '…' : out}<small>${esc(breakdown)}</small></dd><dt>动了</dt><dd>${inRound && t < 2.22 ? '…' : seg === 'open' ? 0 : r.moved}<small>${seg === 'open' ? '' : '件 · 新增、变大、撤下、合并'}</small></dd></dl>
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
    ['分配', seg === 'open' ? '—' : inRound && t < 2.22 ? '…' : `动了 ${r.moved} 件`],
    ['回应', seg === 'open' ? '—' : inRound && t < STRIKE ? '…' : `新问 ${r.fresh.size}`],
  ].map(([name, value], k) => `<li class="${k === stageNo ? 'is-on' : ''}"><span>${k + 1}</span>${name}<em>${value}</em></li>`).join('')}</ol>`;
  lastDim = -1;
}

let perfTick = 0;
function paintPerf() {
  if ((perfTick += 1) % 15 || !frameTimes.length) return;
  const s = frameTimes.slice(-240).sort((a, b) => a - b), mean = s.reduce((x, y) => x + y, 0) / s.length;
  el.perf.textContent = `${field.kind} · ${(1 / mean).toFixed(1)} fps · p95 ${(s[Math.floor(s.length * 0.95)] * 1000).toFixed(1)} ms · 活粒子 ${livePoints}（峰值 ${livePeak}）`;
}

// ---------- loop, input, embedding ----------
let raf = 0;
function loop(ms) {
  raf = requestAnimationFrame(loop);
  if (play.frozen?.done) return;
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
  if (!b) return;
  if (b.dataset.step) go(play.index + Number(b.dataset.step));
  else if (b.dataset.frame) go(Number(b.dataset.frame));
  else if ('play' in b.dataset) togglePlay();
  else if ('card' in b.dataset) { const off = document.body.classList.toggle('fs-no-card'); b.setAttribute('aria-pressed', String(!off)); }
});
document.addEventListener('keydown', event => {
  if (event.target.matches('input,textarea,select,[contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); go(play.index + (event.key === 'ArrowLeft' ? -1 : 1)); }
  else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); go(event.key === 'Home' ? 0 : LAST); }
  else if (event.key === ' ' && !event.target.closest('button, a, summary')) { event.preventDefault(); togglePlay(); }
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
    play.playing = false; paintPlay();
    enter(index, seg === 'round' && index === 0 ? 'open' : seg);
    // Run the last 0.3 s at 60 fps so the afterglow builds, then hold.
    const T = now();
    play.frozen = null;
    for (let k = 18; k >= 1; k -= 1) { play.t0 = T - (t - k / 60); lastFrameAt = T - 1 / 60; render(T); }
    play.frozen = { t, T, still: false, done: false };
    play.t0 = T - t;
    return { index, t, seg: play.seg };
  },
  resume() { play.frozen = null; play.t0 = now(); },
  go, play: () => { if (!play.playing) togglePlay(); }, pause: () => { play.playing = false; paintPlay(); },
  stats() {
    const s = [...frameTimes].sort((a, b) => a - b), mean = s.reduce((x, y) => x + y, 0) / (s.length || 1);
    return { renderer: field.kind, fps: mean ? 1 / mean : null, p95: s.length ? s[Math.floor(s.length * 0.95)] : null, worst: s.length ? s[s.length - 1] : null, over20ms: s.filter(x => x > 0.02).length, livePoints, livePeak, samples: s.length, device: field.device || null,
      cpuMs: cpuTimes.length ? cpuTimes.reduce((x, y) => x + y, 0) / cpuTimes.length : null, cpuP95Ms: cpuTimes.length ? [...cpuTimes].sort((x, y) => x - y)[Math.floor(cpuTimes.length * 0.95)] : null };
  },
  resetStats() { frameTimes.length = 0; cpuTimes.length = 0; livePeak = 0; },
};
