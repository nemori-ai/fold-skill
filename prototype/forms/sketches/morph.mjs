// 变形（完整版）：同一批事项留在原位，面积从“收到多少条输入”变成“占多少份”，这段变形就是 Agent 的判断。
// 一件事一个圆，黑是家里、白是工作；虚线圈是留白。两种态：收到（面积 = 这件事收到的条数占此刻各件条数之和的比例，
// 折成此刻已分配的份额）与给出（面积 = 份额）。两态墨量相等，留白两态一样大，所以画面上的总面积始终是 64 份；
// 给出态里每个圆在收到态的大小留一道细圈。故事、数据口径与交互见 polish/morph-motion.md。
//
// 动起来：变形与换轮里所有圆、细圈与位置走同一条缓动、同起同落，不过冲；面积按份额线性插值，所以任何一帧
// 圆面积之和 + 留白 = 64 份的面积（C 的守恒长缩同理）。数字、说明与侧栏只在落定那一帧换。概念层只有变形中
// 圆边缘的一圈灰色余影（0.2 秒前的边缘），落定后为零。
//   讲一遍：只在顶层直接打开、地址不带 ?frame=、也不是从别的页面链过来时演一次（约 7 秒，composite 停在 f26，
//     story 停在 f15）：圆从无到有长成收到态，原地胀缩成给出态，再标出压小与放大最多的两件。任意键跳过，
//     工具栏「▶ 讲一遍」重演。带 ?frame=、画廊、合页与链来的一律静止在那一帧（不带帧时是最后一帧）。
//   收到 ⇄ 给出：工具栏两枚按钮或 M，一次 1.0 秒的变形。→ 一帧 0.7 秒；←、按住、跳帧与合页同步 0.42 秒；
//     空格连播每轮 0.7 秒换轮再停 0.9 秒。
// 交互接共用模块 motion/ix.mjs：悬停出概要卡、其余降到七成；点击圆沿它离画面中心的方向弹出 8 px，引线接详情卡，
// 侧栏切到“这一件”；卡上的“去回答 →”只给此刻开着的问题，链到同一帧的 D。只读回放，帧号是本页常量，不改数据。
import {
  createStage, esc, frames, records, dayTime, shortOf, titleAt, responsesIn, itemDetailHTML, kindWord,
  reduced, foldSentences, askLife, responseSentence,
} from './stage.mjs';
import { textWidth } from './kit.mjs';
import { createIx, edgePoint, IX } from '../motion/ix.mjs';
import { dueText } from '../motion/dial-model.mjs';
import { withDataset, currentDataset } from '../../data/select.mjs';

const LAST = frames.length - 1;
const BUDGET = 64;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeInOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
const indexOfId = id => frames.findIndex(frame => frame.id === id);
const pctText = x => (x === 0 ? '0%' : x < 0.95 ? `${x.toFixed(1)}%` : `${Math.round(x)}%`);

// ---------- the story (frame ids are page constants, not data) ----------
// composite：f26 收到最多的 master CI 141 条 → 6 份，份额最多的主水管 29 条 → 24 份。
// story：f15 发布 11 条 → 3 份，妈妈 10 条 → 24 份（与让位图手写情境的第一拍同一轮）。
const PLAN = { composite: 'f26', story: 'f15' };
const TELL = { open: 0.4, grow: 1.0, hold1: 1.0, morph: 1.4, hold2: 0.6, markFade: 0.2, end: 7.0 };
const T_GROW = TELL.open, T_MORPH = T_GROW + TELL.grow + TELL.hold1, T_MARK = T_MORPH + TELL.morph + TELL.hold2;
const plan = (() => {
  const i = indexOfId(PLAN[currentDataset()] || '');
  return i > 0 ? { i } : null;
})();
// Told only when opened on its own: top level, no ?frame=, and not followed from another page.
const fromElsewhere = (() => { try { return Boolean(document.referrer) && new URL(document.referrer).pathname !== location.pathname; } catch { return false; } })();
const autoTell = Boolean(plan) && window.parent === window && !new URLSearchParams(location.search).has('frame') && !fromElsewhere;
if (autoTell) { const q = new URLSearchParams(location.search); q.set('frame', plan.i); history.replaceState(null, '', `?${q}`); }

const key = `
  <span><i class="m-key-home"></i>家里</span><span><i class="m-key-work"></i>工作</span>
  <span><i class="m-key-free"></i>留白</span>
  <span><svg width="16" height="16"><circle cx="8" cy="8" r="4" fill="var(--ink)"/><circle cx="8" cy="8" r="7" fill="none" class="m-key-ring"/></svg>细圈：收到态的大小</span>
  <span><i class="m-key-ask"></i>此刻有开着的问题</span>
  <span class="m-key-size"></span>
  <span>同一件事两态同一位置；面积按份额，圆与留白合起来始终是 64 份</span>
  <span class="note"><kbd>←</kbd><kbd>→</kbd> 逐帧 <kbd>空格</kbd> 连播 <kbd>M</kbd> 收到 ⇄ 给出 <kbd>Enter</kbd> 展开 <kbd>Esc</kbd> 收回</span>`;
const stage = createStage({
  id: 'morph', no: 9, name: '变形', storyIndex: LAST, key,
  relation: '收到多少不等于给多少：同一批事项留在原位，面积从“收到多少条输入”变成“占多少份”，这段变形就是 Agent 的判断。',
  tools: `${plan ? '<button type="button" class="m-tell" data-m="tell" title="从头讲一遍（任意键跳过）">▶ 讲一遍</button>' : ''}<div class="st-seg" role="group" aria-label="收到或给出"><button type="button" data-m="in" aria-pressed="false" title="面积 = 收到的条数（M）">收到</button><button type="button" data-m="out" aria-pressed="true" title="面积 = 此刻的份额（M）">给出</button></div>`,
});
const figure = stage.figure;
document.querySelector('.st-kicker').textContent = 'FOLD · 第四轮 · 关系的画法';

// ---------- data: which item each input points at (the same rule as 整理脉冲) ----------
// An input points at the declaration that cites it (batch.declarations[].sources[].ref 'event:<id>'), else at its
// relatedIds[0]; from there up through merges and parents to the root item of the frame being looked at.
const rootCache = frames.map(() => new Map());
function rootAt(i, id) {
  const cache = rootCache[i];
  if (cache.has(id)) return cache.get(id);
  const items = records[i].snapshot.items;
  let item = items[id];
  for (let guard = 0; item && guard < 16; guard += 1) {
    if (item.status === 'merged' && item.merged_into && items[item.merged_into]) item = items[item.merged_into];
    else if (item.parent_id && items[item.parent_id]) item = items[item.parent_id];
    else break;
  }
  const out = item ? item.id : id;
  cache.set(id, out);
  return out;
}
const inputs = frames.map(frame => {
  const cited = new Map();
  for (const d of frame.batch?.declarations || []) for (const s of d.sources || []) if (s.ref?.startsWith('event:')) cited.set(s.ref.slice(6), d.id);
  const out = [];
  frame.events.forEach((e, k) => { const ref = cited.get(e.id) || e.relatedIds?.[0]; if (ref) out.push({ k, e, ref, disp: e.disposition || 'unjudged' }); });
  return out;
});
// Home or work: the streams of the inputs that came into it over the two weeks; the story has channels only (the
// lanes of motion/dial-model.mjs). 'work' over half is work, the rest (family, life, community, subscription) home.
const STORY_LANES = [['work', /团队|客户|监控|部署|反馈|合作|招聘|供应商|财务/], ['family', /家人/], ['life', /物业|同楼|团购|快递|随手记|日历|定时/], ['subscription', /资讯|促销|官方/]];
const laneOf = e => e.stream || STORY_LANES.find(([, test]) => test.test(String(e.channel || '').split(' · ')[0]))?.[0] || null;
const mix = new Map();
inputs.forEach((list, k) => { for (const x of list) { const lane = laneOf(x.e); if (!lane) continue; const r = rootAt(k, x.ref), m = mix.get(r) || {}; m[lane] = (m[lane] || 0) + 1; mix.set(r, m); } });
const sideCache = new Map();
function sideOf(id) {
  if (!sideCache.has(id)) {
    const m = mix.get(id) || {}, work = m.work || 0, rest = Object.entries(m).reduce((s, [k, v]) => s + (k === 'work' ? 0 : v), 0);
    sideCache.set(id, work > rest ? 'work' : 'home');
  }
  return sideCache.get(id);
}
const sideWord = side => (side === 'work' ? '工作' : side === 'home' ? '家里' : '留白');
const BUCKETS = ['used', 'deferred', 'duplicate', 'noise'];
const sourceOf = e => String(e.channel || '').split(' · ')[0] || '来源';

// One round: every root item with what it received (two weeks, up to this frame) and what it was given.
const rounds = frames.map((frame, i) => {
  const st = records[i].state.root, used = st.used;
  const items = new Map(st.items.map(it => [it.id, { id: it.id, share: it.share, n: 0, used: 0, deferred: 0, duplicate: 0, noise: 0, other: 0, carried: 0, now: 0 }]));
  for (let k = 1; k <= i; k += 1) for (const x of inputs[k]) {
    const it = items.get(rootAt(i, x.ref));
    if (!it) continue;
    it.n += 1;
    it[BUCKETS.includes(x.disp) ? x.disp : 'other'] += 1;
    if (rootAt(k, x.ref) !== it.id) it.carried += 1;
    if (k === i && x.disp === 'used') it.now += 1;
  }
  const list = [...items.values()];
  const total = list.reduce((s, x) => s + x.n, 0);
  for (const it of list) {
    it.side = sideOf(it.id);
    it.cEq = total ? (it.n / total) * used : 0;
    it.inPct = total ? (it.n / total) * 100 : 0;
    it.outPct = (it.share / BUDGET) * 100;
  }
  const mostIn = list.length ? list.slice().sort((a, b) => b.n - a.n || b.share - a.share)[0] : null;
  const mostOut = list.length ? list.slice().sort((a, b) => b.share - a.share || a.n - b.n)[0] : null;
  const home = list.filter(x => x.side === 'home');
  return { i, used, free: BUDGET - used, total, items, list, mostIn, mostOut,
    homeIn: home.reduce((s, x) => s + x.n, 0), homeOut: home.reduce((s, x) => s + x.share, 0) };
});
// What happened to an item that left the root between i − 1 and i: merged into which root of i, or withdrawn.
const mergedInto = (i, id) => { const item = records[i].snapshot.items[id]; return item?.status === 'merged' && item.merged_into ? rootAt(i, item.merged_into) : null; };
const mergedFrom = (i, id) => (i ? rounds[i - 1].list.map(x => x.id).filter(x => !rounds[i].items.has(x) && mergedInto(i, x) === id) : []);
const openAsks = (id, i) => (id === 'free' ? [] : [...askLife[i].open.values()].filter(a => rootAt(i, a.item) === id));
const answerOf = new Map();
frames.forEach((frame, i) => { for (const event of frame.events) for (const link of event.feedback || []) if (link.ask && !answerOf.has(link.ask)) answerOf.set(link.ask, { i, event, link }); });
const askShort = a => a.short || a.prompt;
const dueOf = a => (a.due_at ? dueText(Date.parse(a.due_at)) : '');

// ---------- layout: one place per item per frame, big enough for both states ----------
const GAP = 9, LABEL_H = 15, DENSITY = 0.4, TOP = 30;
const SANS = getComputedStyle(document.body).fontFamily;
const MONO = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'ui-monospace, Menlo, monospace';
const widths = new Map();
/** Text width in px, measured once per text, size, weight and family. */
function tw(text, size, weight = 400, mono = false) {
  const k = `${text}|${size}|${weight}|${mono ? 1 : 0}`;
  if (!widths.has(k)) widths.set(k, textWidth(text, size, weight, mono ? MONO : SANS));
  return widths.get(k);
}
let geo = null;
const rOf = v => Math.sqrt(Math.max(0, v) * geo.K / Math.PI);
const numText = (it, m) => (it.id === 'free' ? `${it.free} 份` : m === 'in' ? `${it.n} 条` : `${it.share} 份`);
/** The nodes of round i at scale K: their envelope, their label and where it goes. */
function nodesOf(r, K) {
  const R = v => Math.sqrt(Math.max(0, v) * K / Math.PI);
  const out = [];
  const ask = new Set([...askLife[r.i].open.values()].map(a => rootAt(r.i, a.item)));
  for (const it of r.list) {
    const env = Math.max(it.cEq, it.share), lo = Math.min(it.cEq, it.share);
    out.push(nodeSpec({ id: it.id, side: it.side, env, lo, name: shortOf(it.id), nums: [`${it.n} 条`, `${it.share} 份`], ask: ask.has(it.id) }, R));
  }
  if (r.free > 0) out.push(nodeSpec({ id: 'free', side: 'free', env: r.free, lo: r.free, name: '留白', nums: [`${r.free} 份`], ask: false }, R));
  return out;
}
function nodeSpec(s, R) {
  const rEnv = R(s.env), rMin = R(s.lo);
  const nameIn = tw(s.name, 12, 600) + (s.ask ? 10 : 0), numIn = Math.max(...s.nums.map(t => tw(t, 11, 400, true)));
  const avail = 2 * Math.sqrt(Math.max(0, rMin * rMin - 11 * 11)) - 8;
  const inside = rMin >= 24 && nameIn <= avail && numIn <= avail;
  const nameOut = tw(s.name, 11.5, 500), numOut = Math.max(...s.nums.map(t => tw(t, 10.5, 400, true)));
  const lw = nameOut + 4 + numOut + (s.ask ? 10 : 0);
  return { ...s, rEnv, rMin, inside, lw: inside ? 0 : lw, out: !inside, x: 0, y: 0, hx: 0, hy: 0 };
}
const labelRect = n => ({ x0: n.x - n.lw / 2, x1: n.x + n.lw / 2, y0: n.y + n.rEnv + 3, y1: n.y + n.rEnv + 3 + LABEL_H });
function separate(A, B) {
  // circle–circle
  let dx = B.x - A.x, dy = B.y - A.y;
  const reach = A.rEnv + B.rEnv + GAP + LABEL_H + 8 + Math.max(A.lw, B.lw) / 2;
  if (Math.abs(dx) > reach || Math.abs(dy) > reach) return 0;
  let d = Math.hypot(dx, dy) || 0.01;
  let m = A.rEnv + B.rEnv + GAP - d;
  let worst = 0;
  if (m > 0) { const ux = dx / d, uy = dy / d; A.x -= ux * m / 2; A.y -= uy * m / 2; B.x += ux * m / 2; B.y += uy * m / 2; worst = m; }
  // a label below one circle against the other circle
  for (const [L, C] of [[A, B], [B, A]]) {
    if (!L.out) continue;
    const r = labelRect(L), qx = clamp(C.x, r.x0, r.x1), qy = clamp(C.y, r.y0, r.y1);
    dx = C.x - qx; dy = C.y - qy; d = Math.hypot(dx, dy);
    m = C.rEnv + 5 - d;
    if (m > 0) {
      const ux = d > 0.01 ? dx / d : 0, uy = d > 0.01 ? dy / d : -1;
      C.x += ux * m / 2; C.y += uy * m / 2; L.x -= ux * m / 2; L.y -= uy * m / 2; worst = Math.max(worst, m);
    }
  }
  // two labels
  if (A.out && B.out) {
    const a = labelRect(A), b = labelRect(B);
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 6, oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 2;
    if (ox > 0 && oy > 0) {
      if (ox < oy) { const s = A.x < B.x ? -1 : 1; A.x += s * ox / 2; B.x -= s * ox / 2; } else { const s = A.y < B.y ? -1 : 1; A.y += s * oy / 2; B.y -= s * oy / 2; }
      worst = Math.max(worst, Math.min(ox, oy));
    }
  }
  return worst;
}
function clampBox(n, box) {
  const half = Math.max(n.rEnv, n.lw / 2);
  n.x = clamp(n.x, box.x0 + half, box.x1 - half);
  n.y = clamp(n.y, box.y0 + n.rEnv, box.y1 - n.rEnv - (n.out ? LABEL_H + 4 : 0));
}
function relax(nodes, box, anchor) {
  const N = nodes.length;
  let worst = 0;
  for (let it = 0; it < 160; it += 1) {
    const late = it >= 120;
    if (!late) for (const n of nodes) {
      const a = anchor(n);
      n.x += (n.hx - n.x) * 0.05 + (a.x - n.x) * 0.004;
      n.y += (n.hy - n.y) * 0.05 + (a.y - n.y) * 0.003;
    }
    worst = 0;
    for (let a = 0; a < N; a += 1) for (let b = a + 1; b < N; b += 1) worst = Math.max(worst, separate(nodes[a], nodes[b]));
    for (const n of nodes) clampBox(n, box);
  }
  return worst;
}
function solve(K, box) {
  const W = box.x1 - box.x0, cy = (box.y0 + box.y1) / 2;
  const ax = { work: box.x0 + W * 0.3, home: box.x0 + W * 0.7, free: box.x0 + W * 0.5 };
  const anchor = n => ({ x: ax[n.side], y: cy });
  const seen = new Map();
  const out = [];
  let worst = 0;
  for (const r of rounds) {
    const nodes = nodesOf(r, K);
    const prev = r.i ? out[r.i - 1] : new Map();
    const placed = [];
    for (const n of nodes) {
      const p = prev.get(n.id);
      if (p) { n.x = n.hx = p.x; n.y = n.hy = p.y; placed.push(n); }
    }
    // New this round: where the things merged into it were, where it last stood, else its side's anchor; then the
    // first clear spot on a spiral around that point.
    for (const n of nodes.filter(x => !placed.includes(x)).sort((a, b) => b.rEnv - a.rEnv)) {
      const from = mergedFrom(r.i, n.id).map(id => prev.get(id)).filter(Boolean);
      const last = seen.get(n.id);
      const o = from.length ? { x: from.reduce((s, p) => s + p.x, 0) / from.length, y: from.reduce((s, p) => s + p.y, 0) / from.length } : last || anchor(n);
      let best = null;
      for (let k = 0; k < 400 && !best; k += 1) {
        const ang = k * 2.39996, rad = 9 * Math.sqrt(k);
        n.x = o.x + Math.cos(ang) * rad; n.y = o.y + Math.sin(ang) * rad * 0.8;
        clampBox(n, box);
        if (placed.every(m => Math.hypot(m.x - n.x, m.y - n.y) >= m.rEnv + n.rEnv + GAP)) best = { x: n.x, y: n.y };
      }
      if (!best) { n.x = o.x; n.y = o.y; clampBox(n, box); }
      n.hx = n.x; n.hy = n.y;
      placed.push(n);
    }
    worst = Math.max(worst, relax(nodes, box, anchor));
    const map = new Map(nodes.map(n => [n.id, n]));
    for (const n of nodes) seen.set(n.id, { x: n.x, y: n.y });
    out[r.i] = map;
  }
  return { frames: out, worst };
}
function measure() {
  const t0 = performance.now();
  const W = figure.clientWidth, H = figure.clientHeight;
  const box = { x0: 10, y0: TOP, x1: W - 10, y1: H - 6 };
  const area = (box.x1 - box.x0) * (box.y1 - box.y0);
  let need = 1;
  for (const r of rounds) need = Math.max(need, r.free + r.list.reduce((s, x) => s + Math.max(x.cEq, x.share), 0));
  let K = (DENSITY * area) / need, best = null, passes = 0;
  for (let pass = 0; pass < 6; pass += 1) {
    const res = solve(K, box);
    best = { ...res, K };
    passes = pass + 1;
    if (res.worst <= 1.5) break;
    K *= 0.88;
  }
  return { W, H, box, K: best.K, frames: best.frames, worst: best.worst, passes, ms: performance.now() - t0, cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2 };
}

// ---------- the display: every node's state, and the one transition everything shares ----------
// A state: x, y; d = the disc's value and c = the ring's value (both in shares, the area is value × K); e = the
// envelope's value (where an outside label hangs). One transition at a time: all nodes go from where they are on screen
// to the target with the same ease, the same start and the same length; a new one starts from what is on screen.
let mode = 'out';
let landed = { i: stage.index, mode: 'out', reveal: 2 };
let cur = new Map();        // id → state, when nothing moves
let tr = null;              // {t0, dur, ease, kind, i, mode, from, to, landed, relabel}
let clock = 0;
const hold = { at: null };  // ix pauses the clock while something is hovered or open
let freeze = false;         // tellAt(): a still, until any control releases it
let driving = null;         // set while the page itself steps (telling, playing): {kind}
const run = { kind: null, start: 0, next: 0, k: 0 };
const TRAIL = 0.2, FADE = 0.15, MORPHS = new Set(['morph', 'toggle']);
const DUR = { step: 0.7, jump: 0.42, toggle: 1.0, morph: TELL.morph, grow: TELL.grow, play: 0.9 };

function targetOf(i, m) {
  const r = rounds[i], L = geo.frames[i], out = new Map();
  for (const it of r.list) {
    const n = L.get(it.id);
    out.set(it.id, { x: n.x, y: n.y, d: m === 'in' ? it.cEq : it.share, c: it.cEq, e: Math.max(it.cEq, it.share),
      label: { inside: n.inside, name: n.name, num: numText(it, m), ask: n.ask, side: it.side } });
  }
  if (r.free > 0) { const n = L.get('free'); out.set('free', { x: n.x, y: n.y, d: r.free, c: r.free, e: r.free, label: { inside: n.inside, name: '留白', num: `${r.free} 份`, ask: false, side: 'free' } }); }
  return out;
}
const kOf = (t, x = tr) => (!x || x.dur <= 0 ? 1 : x.ease(clamp((t - x.t0) / x.dur)));
/** A node's state at clock t (during the transition, or the resting one). */
function stateOf(id, t) {
  if (!tr) return cur.get(id) || null;
  const a = tr.from.get(id), b = tr.to.get(id);
  if (!a || !b) return b || a || null;
  const k = t < tr.t0 ? 0 : kOf(t);
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), d: lerp(a.d, b.d, k), c: lerp(a.c, b.c, k), e: lerp(a.e, b.e, k), label: b.label, leaving: b.leaving };
}
function shownIds() { return tr ? new Set([...tr.from.keys(), ...tr.to.keys()]) : new Set(cur.keys()); }
/** Start a transition to round i in state m at clock time `at` (exact times keep the story repeatable). */
function begin(i, m, kind, at = clock) {
  const from = new Map();
  for (const id of shownIds()) { const s = stateOf(id, at); if (s && !(s.leaving && kOf(at) >= 1)) from.set(id, { ...s, leaving: false }); }
  const to = targetOf(i, m);
  for (const [id, s] of from) if (!to.has(id)) {
    // Leaving: shrinks where it stands, or slides into the thing it merged into (the one “who into whom” the replay records).
    const into = mergedInto(i, id), p = into && to.get(into);
    to.set(id, { x: p ? p.x : s.x, y: p ? p.y : s.y, d: 0, c: 0, e: s.e, label: s.label, leaving: true });
  }
  for (const [id, s] of to) if (!from.has(id)) from.set(id, { x: s.x, y: s.y, d: 0, c: 0, e: s.e, label: null, entering: true });
  const dur = reduced() ? 0 : DUR[kind] ?? DUR.step;
  const relabel = new Set();
  for (const [id, b] of to) {
    const a = from.get(id), was = labels.get(id);
    if (b.leaving || !was || was.inside !== b.label.inside || was.name !== b.label.name) relabel.add(id);
  }
  tr = { t0: at, dur, ease: kind === 'grow' ? easeOut : easeInOut, kind, i, mode: m, from, to, landed: false, relabel };
  if (kind === 'grow') for (const id of to.keys()) labels.set(id, { ...to.get(id).label, num: '' });
  mode = m;
  setModeUI();
  if (dur === 0) { land(); finish(); }
}
/** The settle: numbers, captions and the side panel change in this one frame. */
function land() {
  if (!tr || tr.landed) return;
  tr.landed = true;
  for (const [id, b] of tr.to) if (!b.leaving) labels.set(id, b.label); else labels.delete(id);
  const reveal = run.kind === 'tell' ? (tr.kind === 'grow' ? 1 : 2) : 2;
  landed = { i: tr.i, mode: tr.mode, reveal };
  paintCaption();
  stage.refreshSide();
}
function finish() {
  if (!tr) return;
  if (!tr.landed) land();
  cur = new Map([...tr.to].filter(([, s]) => !s.leaving));
  tr = null;
}
/** Snap to round i in state m with nothing moving (first paint, resize, skip). */
function snap(i, m, reveal = 2) {
  tr = null; mode = m;
  cur = targetOf(i, m);
  labels.clear();
  for (const [id, s] of cur) labels.set(id, s.label);
  landed = { i, mode: m, reveal };
  setModeUI(); paintCaption(); stage.refreshSide();
}
const labels = new Map();   // id → the label on screen

// ---------- frame changes ----------
let keyRepeat = false;
addEventListener('keydown', event => { keyRepeat = event.repeat; }, true);
stage.onFrame((next, previous) => {
  if (!driving) {
    // Someone stepped: stop telling or playing, fold any card away at once, drop the told marks.
    stopRun(); freeze = false;
    if (ix) { ix.reset(); closePanel(); }
    clearMarks();
  }
  const kind = driving ? driving.kind : next === previous + 1 && !keyRepeat ? 'step' : 'jump';
  begin(next, mode, kind);
});
function drive(i, kind) {
  driving = { kind };
  try { if (i === stage.index) begin(i, mode, kind); else stage.go(i); } finally { driving = null; }
}
function setMode(m, { quiet = false } = {}) {
  if (m !== 'in' && m !== 'out') return;
  if (!quiet) { stopRun(); freeze = false; ix?.reset(); closePanel(); clearMarks(); }
  if (m === mode && !tr) return;
  begin(stage.index, m, 'toggle');
}
function setModeUI() {
  document.querySelectorAll('[data-m="in"],[data-m="out"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === mode)));
}

// ---------- telling and playing ----------
function setRunUI() {
  document.body.classList.toggle('st-playing', run.kind === 'play');
  const b = document.querySelector('[data-m="tell"]');
  if (b) { b.textContent = run.kind === 'tell' ? '跳过 ▸▸' : '▶ 讲一遍'; b.setAttribute('aria-pressed', String(run.kind === 'tell')); }
}
function stopRun() { if (!run.kind) return; run.kind = null; setRunUI(); }
const tellSteps = [
  { at: T_GROW, act: at => begin(plan.i, 'in', 'grow', at) },
  { at: T_MORPH, act: at => begin(plan.i, 'out', 'morph', at) },
  { at: T_MARK, act: at => { marks.on = true; marks.t0 = at; } },
  { at: TELL.end, act: () => { stopRun(); marks.sticky = true; } },
];
function startTell() {
  if (!plan) return;
  freeze = false; stopRun(); ix?.reset(); closePanel(); clearMarks();
  if (reduced()) { skipTell(); return; }
  driving = { kind: 'jump' };
  try { if (stage.index !== plan.i) stage.go(plan.i); } finally { driving = null; }
  // Beat 0: an empty field, only the blank's dashed circle.
  tr = null; mode = 'in';
  const t = targetOf(plan.i, 'in');
  cur = new Map([...t].map(([id, s]) => [id, id === 'free' ? s : { ...s, d: 0, c: 0 }]));
  labels.clear();
  if (cur.has('free')) labels.set('free', cur.get('free').label);
  landed = { i: plan.i, mode: 'in', reveal: 0 };
  setModeUI(); paintCaption(); stage.refreshSide();
  Object.assign(run, { kind: 'tell', start: clock, k: 0 });
  setRunUI();
}
/** Skip to the end of the story: given, settled, with the two marks. */
function skipTell() {
  if (!plan) return;
  stopRun(); freeze = false;
  driving = { kind: 'jump' };
  try { if (stage.index !== plan.i) stage.go(plan.i); } finally { driving = null; }
  snap(plan.i, 'out');
  marks.on = true; marks.t0 = -99; marks.sticky = true;
}
function startPlay() {
  freeze = false; stopRun(); ix?.reset(); closePanel(); clearMarks();
  if (stage.index >= LAST) drive(0, 'jump');
  Object.assign(run, { kind: 'play', next: clock + (tr ? tr.dur : 0) });
  setRunUI();
}
stage.play = startPlay;
stage.pause = () => { if (run.kind === 'play') stopRun(); };
stage.toggle = () => (run.kind === 'play' ? stage.pause() : startPlay());
/** A still of the story at `s` seconds (for stills and checks), released by any control. */
function tellAt(s) {
  if (!plan) return;
  startTell();
  advance(s);
  freeze = true;
}
/** Move the clock on by dt: the story's steps fire at their exact times, transitions land and finish. */
function advance(dt) {
  const end = clock + dt;
  while (run.kind === 'tell' && run.k < tellSteps.length && run.start + tellSteps[run.k].at <= end) {
    const step = tellSteps[run.k], at = run.start + step.at;
    settleTo(at);
    run.k += 1;
    step.act(at);
  }
  settleTo(end);
  if (run.kind === 'play' && !tr && clock >= run.next) {
    if (stage.index >= LAST) stopRun();
    else { drive(stage.index + 1, 'step'); run.next = clock + DUR.step + DUR.play; }
  }
}
function settleTo(t) {
  clock = Math.max(clock, t);
  if (tr && !tr.landed && clock >= tr.t0 + tr.dur) land();
  if (tr && tr.landed && clock >= tr.t0 + tr.dur + Math.max(TRAIL, FADE)) finish();
}
function tick(dt) {
  if (hold.at != null || freeze) return;
  advance(dt);
}
addEventListener('keydown', event => {
  // Any key skips the story (Tab still moves focus); after it, the first key drops the told marks.
  if (run.kind === 'tell' && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key) && !event.metaKey && !event.ctrlKey) {
    skipTell();
    if (event.key !== 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); }
    return;
  }
  freeze = false;
  if (marks.sticky) clearMarks();
}, true);
addEventListener('pointerdown', event => {
  if (run.kind === 'tell' && !event.target.closest?.('[data-m]')) { skipTell(); return; }
  freeze = false;
  if (marks.sticky && !event.target.closest?.('[data-m="tell"]')) clearMarks();
}, true);

// ---------- the told marks (beat 3): an outline and a short note on the two things ----------
const marks = { on: false, t0: 0, sticky: false };
function clearMarks() { Object.assign(marks, { on: false, sticky: false }); }
const heroPair = i => {
  const r = rounds[i];
  if (!r.mostIn) return [];
  return r.mostIn.id === r.mostOut.id ? [r.mostIn] : [r.mostIn, r.mostOut];
};

// ---------- painting ----------
const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent = null) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (parent) parent.append(n); return n; };
const els = { svg: null, trails: null, nodes: null, marks: null, cap: null, pool: new Map() };
function nodeEl(id) {
  if (els.pool.has(id)) return els.pool.get(id);
  const side = id === 'free' ? 'free' : sideOf(id);
  const g = el('g', { class: 'm-node' }, els.nodes);
  const trail = el('circle', { class: 'm-trail' }, els.trails);
  const disc = el('circle', { class: `m-disc is-${side}` }, g);
  const ring = el('circle', { class: 'm-ring' }, g);
  const focus = el('circle', { class: 'm-focus', visibility: 'hidden' }, g);
  const label = el('g', { class: `m-label is-${side}` }, g);
  const ask = el('rect', { class: 'm-ask', width: 6, height: 6, visibility: 'hidden' }, label);
  const name = el('text', { class: 'm-name' }, label), num = el('text', { class: 'm-num' }, label);
  const node = { g, trail, disc, ring, focus, label, ask, name, num, side, cache: {} };
  els.pool.set(id, node);
  return node;
}
const setA = (node, key, elm, attr, value) => { const k = `${key}`; if (node.cache[k] !== value) { node.cache[k] = value; elm.setAttribute(attr, value); } };
function layoutLabel(node, spec, rEnv) {
  // Inside: name over number, centred. Outside: one line under the envelope.
  const k = `${spec.inside}|${spec.name}|${spec.num}|${spec.ask}`;
  if (node.cache.lk !== k) {
    node.cache.lk = k;
    node.name.textContent = spec.name; node.num.textContent = spec.num;
    node.label.setAttribute('class', `m-label is-${node.side} ${spec.inside ? 'is-in' : 'is-out'}`);
    if (spec.inside) {
      const nw = tw(spec.name, 12, 600);
      node.name.setAttribute('text-anchor', 'middle'); node.num.setAttribute('text-anchor', 'middle');
      node.name.setAttribute('x', spec.ask ? 5 : 0); node.name.setAttribute('y', -3);
      node.num.setAttribute('x', 0); node.num.setAttribute('y', 11);
      node.ask.setAttribute('x', (spec.ask ? 5 : 0) - nw / 2 - 10); node.ask.setAttribute('y', -11);
      node.cache.ow = 0;
    } else {
      const nw = tw(spec.name, 11.5, 500), uw = tw(spec.num, 10.5, 400, true);
      const w = nw + 4 + uw + (spec.ask ? 10 : 0), x0 = -w / 2 + (spec.ask ? 10 : 0);
      node.name.setAttribute('text-anchor', 'start'); node.num.setAttribute('text-anchor', 'start');
      node.name.setAttribute('x', x0.toFixed(1)); node.num.setAttribute('x', (x0 + nw + 4).toFixed(1));
      node.ask.setAttribute('x', (-w / 2).toFixed(1));
      node.cache.ow = 1;
    }
    node.ask.setAttribute('visibility', spec.ask ? 'visible' : 'hidden');
    node.cache.ly = null;
  }
  if (!spec.inside) {
    const y = (rEnv + 15).toFixed(1);
    if (node.cache.ly !== y) { node.cache.ly = y; node.name.setAttribute('y', y); node.num.setAttribute('y', y); node.ask.setAttribute('y', (rEnv + 15 - 7).toFixed(1)); }
  }
}
const dirOf = s => { const dx = s.x - geo.cx, dy = s.y - geo.cy, d = Math.hypot(dx, dy); return d < 1 ? { x: 0, y: -1 } : { x: dx / d, y: dy / d }; };
let X = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
function paintNodes(alphaK) {
  const t = clock, ids = shownIds();
  for (const id of ids) nodeEl(id);
  for (const [id, node] of els.pool) {
    if (!ids.has(id)) { if (node.cache.vis !== 'hidden') { node.cache.vis = 'hidden'; node.g.setAttribute('visibility', 'hidden'); node.trail.setAttribute('visibility', 'hidden'); } continue; }
    const s = stateOf(id, t);
    if (!s) continue;
    if (node.cache.vis !== 'visible') { node.cache.vis = 'visible'; node.g.setAttribute('visibility', 'visible'); }
    const rd = rOf(s.d), rc = rOf(s.c), re = rOf(s.e);
    let ox = 0, oy = 0;
    if (X.popId === id && X.pop > 0.001) { const u = dirOf(s); ox = u.x * IX.pop * X.pop; oy = u.y * IX.pop * X.pop; }
    setA(node, 'tf', node.g, 'transform', `translate(${(s.x + ox).toFixed(1)} ${(s.y + oy).toFixed(1)})`);
    setA(node, 'rd', node.disc, 'r', rd.toFixed(2));
    const ringOn = id !== 'free' && Math.abs(rd - rc) >= 0.8 && rc > 0.5;
    setA(node, 'rv', node.ring, 'visibility', ringOn ? 'visible' : 'hidden');
    if (ringOn) {
      setA(node, 'rc', node.ring, 'r', rc.toFixed(2));
      setA(node, 'ro', node.ring, 'class', `m-ring${rc < rd - 0.5 ? ` is-over is-${node.side}` : ''}`);
    }
    // Focus: hovered or opened, the rest go to 70 %.
    const dim = X.focus && X.focus !== id ? 1 - 0.3 * X.dim : 1;
    // Labels: kept through a move unless their place or name changes; those fade out, land, and fade back in.
    let la = 1;
    const spec = labels.get(id);
    if (tr && tr.relabel.has(id)) {
      const e = t - tr.t0;
      if (tr.to.get(id)?.leaving) la = 1 - clamp(e / FADE);
      else if (tr.kind === 'grow') la = clamp(e / 0.3);
      else la = tr.landed ? clamp((e - tr.dur) / FADE) : 1 - clamp(e / FADE);
    }
    if (!spec) la = 0;
    if (spec) layoutLabel(node, spec, re);
    setA(node, 'la', node.label, 'opacity', la.toFixed(3));
    setA(node, 'op', node.g, 'opacity', dim.toFixed(3));
    // Keyboard focus and the opened one: an ink ring 3 px outside the envelope.
    const ringed = X.keyFocus === id || (X.popId === id && X.pop > 0.001);
    setA(node, 'fv', node.focus, 'visibility', ringed ? 'visible' : 'hidden');
    if (ringed) setA(node, 'fr', node.focus, 'r', (Math.max(rd, rc) + 3).toFixed(2));
    // The concept layer: where the edge was 0.2 s ago, a grey band that thins to nothing as the move ends. Only in the
    // morph itself (same round, same places, areas change); a round change moves and merges too many things at once.
    let tw = 0, tm = 0;
    if (tr && MORPHS.has(tr.kind) && tr.dur > 0 && !reduced() && id !== 'free') {
      const p = stateOf(id, Math.max(tr.t0, t - TRAIL));
      const rp = p ? rOf(p.d) : rd;
      tw = Math.abs(rp - rd); tm = (rp + rd) / 2;
    }
    if (tw > 0.6) {
      setA(node, 'tv', node.trail, 'visibility', 'visible');
      setA(node, 'tt', node.trail, 'transform', `translate(${(s.x + ox).toFixed(1)} ${(s.y + oy).toFixed(1)})`);
      setA(node, 'tr', node.trail, 'r', tm.toFixed(2));
      setA(node, 'tw', node.trail, 'stroke-width', tw.toFixed(2));
      setA(node, 'ta', node.trail, 'stroke-opacity', (0.14 * alphaK).toFixed(3));
    } else setA(node, 'tv', node.trail, 'visibility', 'hidden');
  }
}
// Beat 3: the outline and the note on the two things. Notes sit beside the circle, away from the middle, on the first
// side where they stay clear of every circle.
let markShown = '';
function paintMarks() {
  const on = marks.on && landed.i === (plan?.i ?? -1) && !tr;
  const a = on ? clamp((clock - marks.t0) / TELL.markFade) : 0;
  const k = on ? `${landed.i}|${geo.K.toFixed(2)}` : '';
  if (k !== markShown) {
    markShown = k;
    els.marks.innerHTML = '';
    if (on) for (const it of heroPair(landed.i)) {
      const s = cur.get(it.id);
      if (!s) continue;
      const r = Math.max(rOf(s.d), rOf(s.c)) + 3;
      el('circle', { class: 'm-mark', cx: s.x.toFixed(1), cy: s.y.toFixed(1), r: r.toFixed(1) }, els.marks);
      const line1 = `${it.n} 条 → ${it.share} 份`, line2 = `收到的 ${pctText(it.inPct)} → 份额的 ${pctText(it.outPct)}`;
      const w = Math.max(tw(line1, 12, 600, true), tw(line2, 10.5, 400, true)) + 12, h = 34;
      const spot = calloutSpot(it.id, s, r, w, h);
      const g = el('g', { class: 'm-call' }, els.marks);
      el('line', { x1: (s.x + spot.ux * r).toFixed(1), y1: (s.y + spot.uy * r).toFixed(1), x2: spot.ax.toFixed(1), y2: spot.ay.toFixed(1) }, g);
      el('rect', { x: spot.x.toFixed(1), y: spot.y.toFixed(1), width: w.toFixed(1), height: h }, g);
      const t1 = el('text', { x: (spot.x + 6).toFixed(1), y: (spot.y + 14).toFixed(1) }, g); t1.textContent = line1;
      const t2 = el('text', { class: 'm-call-sub', x: (spot.x + 6).toFixed(1), y: (spot.y + 28).toFixed(1) }, g); t2.textContent = line2;
    }
  }
  els.marks.setAttribute('opacity', a.toFixed(3));
}
function calloutSpot(id, s, r, w, h) {
  const base = Math.atan2(s.y - geo.cy, s.x - geo.cx);
  const others = [...cur].filter(([x]) => x !== id).map(([, o]) => ({ x: o.x, y: o.y, r: Math.max(rOf(o.d), rOf(o.c)) }));
  const box = geo.box;
  let best = null;
  for (let k = 0; k < 24 && !best; k += 1) {
    const ang = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const ax = s.x + ux * (r + 14), ay = s.y + uy * (r + 14);
    const x = ux >= 0 ? ax : ax - w, y = ay - h / 2;
    const rect = { x0: x, y0: y, x1: x + w, y1: y + h };
    if (rect.x0 < box.x0 || rect.x1 > box.x1 || rect.y0 < TOP + 2 || rect.y1 > geo.H - 2) continue;
    const clear = others.every(o => { const qx = clamp(o.x, rect.x0, rect.x1), qy = clamp(o.y, rect.y0, rect.y1); return Math.hypot(o.x - qx, o.y - qy) > o.r + 4; });
    if (clear) best = { x, y, ax: ux >= 0 ? x : x + w, ay: y + h / 2, ux, uy };
  }
  if (!best) { const ux = Math.cos(base), uy = Math.sin(base), x = clamp(s.x + ux * (r + 14) - (ux < 0 ? w : 0), box.x0, box.x1 - w), y = clamp(s.y + uy * (r + 14) - h / 2, TOP + 2, geo.H - h - 2); best = { x, y, ax: x, ay: y + h / 2, ux, uy }; }
  return best;
}
function paintCaption() {
  if (!els.cap) return;
  const r = rounds[landed.i];
  els.cap.innerHTML = landed.i === 0 ? '<b>空状态</b><span>还没有整理过任何输入：64 份全是留白</span>'
    : landed.mode === 'in' ? `<b>收到</b><span>两周里关联到它的输入 · 面积 = 条数占此刻 ${r.list.length} 件共 ${r.total} 条的比例，折成已分配的 ${r.used} 份</span>`
      : `<b>给出</b><span>此刻的份额 · 面积 = 份数；圆与留白合起来是 64 份，细圈是收到态的大小</span>`;
}
function paintKey() {
  const k = document.querySelector('.m-key-size');
  if (!k || !geo) return;
  // Same share, same size in every round: one share is a circle this wide on this screen.
  k.textContent = `1 份 = 直径 ${Math.round(2 * rOf(1))} px，24 份 = ${Math.round(2 * rOf(24))} px`;
}

function render() {
  geo = measure();
  const kept = [...figure.querySelectorAll(':scope > .ix-leaders, :scope > .ix-peek, :scope > .ix-detail, :scope > .ix-sr')];
  figure.innerHTML = '<div class="m-cap"></div>';
  els.cap = figure.querySelector('.m-cap');
  els.svg = el('svg', { class: 'm-svg', 'aria-hidden': 'true' });
  els.trails = el('g', { class: 'm-trails' }, els.svg);
  els.nodes = el('g', { class: 'm-nodes' }, els.svg);
  els.marks = el('g', { class: 'm-marks' }, els.svg);
  figure.append(els.svg, ...kept);
  const sr = kept.find(x => x.classList.contains('ix-sr'));
  if (sr) figure.prepend(sr);
  els.pool.clear();
  markShown = '';
  // A resize finishes any move and keeps the told story's end state.
  if (run.kind === 'tell') skipTell(); else snap(stage.index, mode);
  paintKey();
  ix?.relayout();
}

// ---------- side panel: this round, with the hero pair on top ----------
const chip = id => (id === 'free' ? '<span class="m-chip">留白</span>' : `<span class="m-chip is-${sideOf(id)}" data-pin="${esc(id)}">${esc(shortOf(id))}</span>`);
const answerLink = () => withDataset(`../../index.html?variant=d&frame=${stage.index}`);
function asksList(i) {
  const open = [...askLife[i].open.values()];
  if (!open.length) return '<section class="m-asks"><h4>开着的问题</h4><p class="st-muted">此刻没有开着的问题</p></section>';
  return `<section class="m-asks"><h4>开着的问题 <small>${open.length} 条 · 去回答链到同一帧的 D</small></h4><ul>${open.map(a => `<li><i></i><span>${esc(askShort(a))}</span><small>${esc([shortOf(rootAt(i, a.item)), dueOf(a)].filter(Boolean).join(' · '))}</small><a href="${esc(answerLink())}">去回答 →</a></li>`).join('')}</ul></section>`;
}
function overview() {
  const i = landed.i, r = rounds[i], rv = landed.reveal;
  if (i === 0) return { kicker: `这一轮 · ${frames[0].id}`, title: esc(frames[0].title), body: '<p>还没有整理过任何输入：64 份全是留白。按 → 或空格开始。</p>' };
  const a = r.mostIn, b = r.mostOut, same = a && b && a.id === b.id;
  const P = '<span class="m-dots">…</span>';
  const inN = rv >= 1 ? a.n : P, outN = rv >= 2 ? a.share : P;
  const hero = a ? `<div class="m-hero"><div class="m-hero-k">收到最多 · ${chip(a.id)}${same ? ' · 份额也最多' : ''}</div>
      <div class="m-hero-n"><b class="${rv < 1 ? 'm-pending' : ''}">${inN}</b><small>条</small><i>→</i><b class="${rv < 2 ? 'm-pending' : ''}">${outN}</b><small>份</small></div></div>
      ${same ? '' : `<div class="m-hero2"><span>份额最多 · ${chip(b.id)}</span><b>${rv >= 1 ? b.n : '…'} → ${rv >= 2 ? b.share : '…'}</b></div>`}` : '';
  const homeInPct = r.total ? (r.homeIn / r.total) * 100 : 0;
  const bar = (label, parts, pending) => `<div class="m-bar${pending ? ' is-pending' : ''}"><span>${label}</span><span>${parts.map(([cls, w]) => (w > 0 ? `<i class="is-${cls}" style="width:${w.toFixed(2)}%"></i>` : '')).join('')}</span></div>`;
  const split = `<section class="m-split"><h4>家里与工作 <small>黑是家里，白是工作</small></h4>
    ${bar(`收到 <b>${rv >= 1 ? r.total : '…'}</b> 条`, [['home', homeInPct], ['work', 100 - homeInPct]], rv < 1)}
    ${bar(`给出 <b>${rv >= 2 ? r.used : '…'}</b> / 64 份`, [['home', (r.homeOut / 64) * 100], ['work', ((r.used - r.homeOut) / 64) * 100], ['free', (r.free / 64) * 100]], rv < 2)}
    <p>${rv >= 2 ? `家里：条数的 ${pctText(homeInPct)} → 份额的 ${pctText((r.homeOut / 64) * 100)}${r.free ? ` · 留白 ${r.free} 份` : ''}` : '变形落定后写出份额'}</p></section>`;
  const diff = x => x.outPct - x.inPct;
  const line = x => `<li>${chip(x.id)}<b>${x.n} → ${x.share}</b><small>${pctText(x.inPct)} → ${pctText(x.outPct)}</small></li>`;
  const up = r.list.filter(x => diff(x) > 0.5).sort((p, q) => diff(q) - diff(p)).slice(0, 4);
  const down = r.list.filter(x => diff(x) < -0.5).sort((p, q) => diff(p) - diff(q)).slice(0, 4);
  const lists = rv >= 2 ? `<div class="m-cols"><section><h4>放大的 <small>条 → 份</small></h4><ul class="m-list">${up.map(line).join('') || '<li class="st-muted">—</li>'}</ul></section>
      <section><h4>压小的 <small>条 → 份</small></h4><ul class="m-list">${down.map(line).join('') || '<li class="st-muted">—</li>'}</ul></section></div>
      <p class="st-muted m-fine">按份额占比与收到占比之差排；收到占比的分母是此刻 ${r.list.length} 件共 ${r.total} 条，份额占比的分母是 64 份。</p>` : '';
  return {
    kicker: `这一轮 · ${frames[i].id} · ${records[i].state.revision}`,
    title: esc(frames[i].title),
    body: `${hero}${split}${lists}${asksList(i)}
      <p class="st-muted m-fine">口径：一条输入算在批次声明引用它的那件事上，没有引用就算在 relatedIds 的第一个上，再沿合并与父级上溯到此刻的事项；暂缓与重复照算，噪音不指向任何事项。同一件事换过 id，只认回放里记了的合并。</p>`,
  };
}
stage.setOverview(overview);

// ---------- the interaction (motion/ix.mjs) ----------
const HIT = 10;
const inFlight = () => Boolean(tr && !tr.landed);
function hasId(id) {
  if (!geo) return false;
  const s = tr ? tr.to.get(id) : cur.get(id);
  if (!s || s.leaving) return false;
  const now = stateOf(id, clock);
  return Boolean(now) && Math.max(rOf(now.d), rOf(now.c)) > 2;
}
function drawnR(id) { const s = stateOf(id, clock); return s ? Math.max(rOf(s.d), rOf(s.c)) : 0; }
function hitAt(x, y) {
  if (!geo) return null;
  let best = null, bestD = Infinity;
  for (const id of shownIds()) {
    if (!hasId(id)) continue;
    const s = stateOf(id, clock), d = Math.hypot(x - s.x, y - s.y) - drawnR(id);
    if (d <= HIT && d < bestD) { best = id; bestD = d; }
  }
  return best;
}
const centreOf = id => { const s = stateOf(id, clock); return s ? { x: s.x, y: s.y } : null; };
function idFor(name) {
  if (name == null) return null;
  const ids = [...shownIds()];
  if (ids.includes(name)) return name;
  if (name === '留白') return ids.includes('free') ? 'free' : null;
  return ids.find(id => id !== 'free' && shortOf(id) === name) || null;
}
// Cards hang off the circle's edge, on whichever side has more room; the detail stands right beside the circle there.
function anchorOf(id) {
  const s = stateOf(id, clock), r = drawnR(id) + IX.pop, box = geo.box;
  const facing = box.x1 - (s.x + r) >= (s.x - r) - box.x0 ? 1 : -1;
  return { x: s.x + facing * r, y: s.y, facing, keep: { x0: s.x - r - 4, y0: s.y - r - 4, x1: s.x + r + 4, y1: s.y + r + 4 } };
}
let ix = null;
ix = createIx({
  stage: figure, keysIn: figure,
  facts: id => factsOf(id), has: hasId, hit: hitAt, named: idFor,
  pointOf: centreOf, index: () => stage.index * 4 + (mode === 'in' ? 2 : 0) + (inFlight() ? 1 : 0),
  pause: () => { if (hold.at == null) hold.at = performance.now(); }, resume: () => { hold.at = null; }, paused: () => hold.at != null,
  last: LAST, answerHref: () => answerLink(),
  seen: () => { const live = inFlight(); return { inputs: true, share: !live, asks: !live }; },
  anchor: anchorOf, detailWidth: 320, hug: 'keep',
  // The leader leaves the stepped-out circle's edge straight towards the card and meets its nearest edge.
  leader: (id, card) => {
    const s = stateOf(id, clock), u = dirOf(s), r = drawnR(id) + IX.pop;
    const c = { x: s.x + u.x * IX.pop, y: s.y + u.y * IX.pop };
    const q = edgePoint(c, card), d = Math.hypot(q.x - c.x, q.y - c.y) || 1;
    const from = { x: c.x + ((q.x - c.x) / d) * (r - IX.pop + 2), y: c.y + ((q.y - c.y) / d) * (r - IX.pop + 2) };
    return [from, edgePoint(from, card)];
  },
  peekHTML: (f, o) => peekCard(f, o), detailHTML: (f, o) => detailCard(f, o),
  skip: '.m-cap',
  label: '变形图的事项：Tab 逐个看概要，Enter 展开详情，Esc 收回',
});

// ---------- the cards ----------
const factCache = new Map();
function factsOf(id) {
  const i = stage.index, ck = `${i}:${id}`;
  if (factCache.has(ck)) return factCache.get(ck);
  const r = rounds[i];
  let f;
  if (id === 'free') {
    let lastZero = null;
    for (let k = i - 1; k >= 1; k -= 1) if (rounds[k].free === 0) { lastZero = k; break; }
    f = { id, i, short: '留白', side: 'free', free: r.free, used: r.used, lastZero, asks: [] };
  } else {
    const it = r.items.get(id) || { n: 0, share: 0, used: 0, deferred: 0, duplicate: 0, noise: 0, other: 0, carried: 0, now: 0, cEq: 0, inPct: 0, outPct: 0, side: sideOf(id) };
    const src = new Map();
    for (let k = 1; k <= i; k += 1) for (const x of inputs[k]) if (rootAt(i, x.ref) === id) { const s = sourceOf(x.e); src.set(s, (src.get(s) || 0) + 1); }
    const asks = openAsks(id, i).map(a => ({ id: a.id, short: askShort(a), prompt: a.prompt, due: dueOf(a) }));
    // Every question it has had up to now; the ones not open now say how they closed.
    const all = new Map();
    for (let k = 0; k <= i; k += 1) for (const a of Object.values(frames[k].asks || {})) if (rootAt(i, a.item) === id) all.set(a.id, a);
    const openIds = new Set(asks.map(a => a.id));
    const closed = [...all.values()].filter(a => !openIds.has(a.id)).map(a => {
      const ans = answerOf.get(a.id);
      const answered = ans && ans.i <= i && askLife.slice(0, i + 1).some(l => l.answered.some(x => x.id === a.id));
      const lapsed = askLife.slice(0, i + 1).some(l => l.lapsed.some(x => x.id === a.id));
      return { a, how: answered ? `答掉 · ${responseSentence(ans.event, ans.link)}` : lapsed ? '随改写失效，没人答就关上了' : '没有在此刻重登记' };
    }).slice(-4);
    const responses = [];
    for (let k = 1; k <= i; k += 1) for (const x of responsesIn(k)) if (rootAt(i, x.link.target) === id) responses.push(x);
    f = { id, i, short: shortOf(id), title: titleAt(id, i), side: it.side, ...it, total: r.total, items: r.list.length, rUsed: r.used,
      sources: [...src].sort((p, q) => q[1] - p[1]), asks, closed, responses: foldSentences(responses).slice(-3), round: inSeries(id, i)[i],
      summary: records[i].snapshot.items[id]?.summary || '' };
  }
  factCache.set(ck, f);
  return f;
}
const whenOf = i => `${frames[i].id} · ${dayTime(frames[i].at)}`;
const sideDot = side => `<i class="m-pk-side${side === 'home' ? ' is-home' : ''}"></i>`;
function peekCard(f, { seen }) {
  if (f.id === 'free') return `<div class="ix-k">${esc(whenOf(f.i))}</div><div class="ix-q">留白 ${f.free} / 64</div>
    <div class="ix-d">没有分出去的份额，收到与给出两态一样大</div>${f.lastZero != null ? `<div class="ix-d">上一次为 0：${esc(frames[f.lastZero].id)}</div>` : ''}`;
  const unsettled = !seen.share;
  return `<div class="ix-k">${sideDot(f.side)}${esc(sideWord(f.side))} · ${esc(whenOf(f.i))}</div><div class="ix-q">${esc(f.short)}</div>
    <div class="ix-d m-pk-title">${esc(f.title)}</div>
    ${unsettled ? '<div class="ix-d">这一轮还没落定</div>' : `<div class="ix-d m-pk-big">收到 ${f.n} 条 → 给出 ${f.share} 份</div>
    <div class="ix-d">收到的 ${pctText(f.inPct)} → 份额的 ${pctText(f.outPct)}</div>`}
    <div class="ix-d">${f.round ? `本轮进来 ${f.round} 条 · 采用 ${f.now}` : '本轮没有输入进它'}</div>
    ${seen.asks ? f.asks.map(a => `<div class="ix-ask"><i></i><span>${esc(a.short)}</span>${a.due ? `<small>${esc(a.due)}</small>` : ''}</div>`).join('') : ''}`;
}
function trendSVG(series, at, H = 30) {
  const n = LAST, W = 300, top = Math.max(6, ...series), bw = W / n;
  const bars = series.slice(1).map((s, k) => {
    const h = s ? Math.max(1.5, (s / top) * (H - 2)) : 1, i = k + 1;
    return `<rect x="${(k * bw + bw * 0.15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" class="${i === at ? 'is-now' : i > stage.index ? 'is-later' : s ? '' : 'is-off'}"/>`;
  }).join('');
  return `<svg class="ix-trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg><div class="ix-axis"><span>${esc(frames[1].id)}</span><span>${esc(frames[LAST].id)}</span></div>`;
}
const shareSeries = id => frames.map((_, k) => (id === 'free' ? rounds[k].free : rounds[k].items.get(id)?.share || 0));
/** Inputs that came in each round and count towards `id` as seen from round i (later rounds: as seen from that round). */
const inSeries = (id, i) => frames.map((_, k) => inputs[k].filter(x => rootAt(Math.max(i, k), x.ref) === id).length);
function detailCard(f, { seen, href }) {
  const close = '<button type="button" data-x="close" aria-label="收回（Esc）" title="收回（Esc）">×</button>';
  if (f.id === 'free') {
    return `<div class="ix-d-k"><span>${esc(whenOf(f.i))}</span>${close}</div><div class="ix-d-t">留白 ${f.free} / 64</div>
      <div class="ix-d-s">已分配 ${f.used} 份；留白在收到与给出两态一样大，变形只在已分配的份额里重新分</div>
      <section><h5>留白 · 逐轮<b>${esc(frames[f.i].id)} ${f.free} 份</b></h5>${trendSVG(shareSeries('free'), f.i)}</section>`;
  }
  const unsettled = !seen.share;
  const parts = [['采用', f.used], ['暂缓', f.deferred], ['重复', f.duplicate], ['噪音', f.noise], ['未判', f.other]].filter(([, n]) => n);
  const src = f.sources.slice(0, 3).map(([s, n]) => `${s} ${n}`).join(' · ') + (f.sources.length > 3 ? ` · 另 ${f.sources.length - 3} 个来源` : '');
  const asks = `<section><h5>开着的问题<b>此刻 ${esc(frames[stage.index].id)}</b></h5>${f.asks.length ? f.asks.slice(0, 3).map(a => `<div class="ix-d-ask"><i></i><p>${esc(a.prompt)}</p><small>${esc(a.due || '没有期限')}</small><a href="${esc(href)}">去回答 →</a></div>`).join('') : '<p class="ix-none">没有开着的问题</p>'}</section>`;
  const closed = f.closed.length ? `<section><h5>关上的问题<b>${f.closed.length} 条</b></h5><ul class="m-dc-closed">${f.closed.map(x => `<li><s>${esc(askShort(x.a))}</s><small>${esc(x.how)}</small></li>`).join('')}</ul></section>` : '';
  const fb = f.responses.length ? `<section><h5>你的回应</h5><ul class="ix-d-fb">${f.responses.map(x => `<li><time>${esc(dayTime(x.first.event.at))}</time>${esc(x.label)}</li>`).join('')}</ul></section>` : '';
  return `<div class="ix-d-k"><span>${esc(whenOf(f.i))} · ${esc(sideWord(f.side))}</span>${close}</div>
    <div class="ix-d-t">${esc(f.title)}</div>
    ${unsettled ? '<p class="ix-none">这一轮还没落定</p>' : `<div class="ix-d-s"><b>${esc(f.short)}</b> 收到 ${f.n} 条 → 给出 <b>${f.share}</b> / 64 份</div>
    <div class="ix-d-s">收到的 ${pctText(f.inPct)}（此刻 ${f.items} 件共 ${f.total} 条）→ 份额的 ${pctText(f.outPct)} · 收到态折合 ${f.cEq.toFixed(1)} 份</div>`}
    ${asks}
    <section><h5>收到的构成<b>${f.n} 条</b></h5><ul class="ix-d-kids m-dc-src">${parts.map(([w, n]) => `<li><span>${w}</span><b>${n}</b></li>`).join('')}${f.carried ? `<li><span>其中沿合并接上的</span><b>${f.carried}</b></li>` : ''}</ul>
      ${src ? `<p class="ix-none">${esc(src)}</p>` : ''}</section>
    <section><h5>份额 · 逐轮<b>${esc(frames[f.i].id)} ${f.share} 份</b></h5>${trendSVG(shareSeries(f.id), f.i, 24)}</section>
    <section><h5>收到 · 逐轮<b>本轮 ${f.round} 条</b></h5>${trendSVG(inSeries(f.id, f.i), f.i, 24)}</section>
    ${closed}${fb}
    ${f.summary ? `<p class="ix-d-sum">${esc(f.summary)}</p>` : ''}`;
}

// ---------- side panel: “这一件” ----------
let panelKey = null;
function panelFor(view) {
  return i => {
    const id = view.id;
    const kick = `这一件 · ${frames[view.i].id} · ${sideWord(id === 'free' ? 'free' : sideOf(id))}`;
    if (id === 'free') {
      return { kicker: kick, title: `留白 ${rounds[i].free} / 64`, body: `<section><h4>留白 · 逐轮</h4>${trendSVG(shareSeries('free'), view.i)}</section>
        <p class="st-muted">留白在两态一样大：变形只在已分配的份额里重新分，没有分出去的那些不随条数变。</p>` };
    }
    const it = rounds[i].items.get(id);
    const closes = [];
    for (let k = 1; k <= LAST; k += 1) {
      for (const a of askLife[k].answered) if (rootAt(k, a.item) === id) closes.push({ k, a, how: '答' });
      for (const a of askLife[k].lapsed) if (rootAt(k, a.item) === id) closes.push({ k, a, how: '失效' });
    }
    const closeList = closes.length ? `<section><h4>问题关上的那几轮 <small>份额 前 → 后</small></h4><ul class="m-closes">${closes.map(x => `<li class="${x.k > i ? 'is-later' : ''}"><button type="button" data-st="go" data-frame="${x.k}"><time>${esc(frames[x.k].id)}</time></button><span>${x.how}「${esc(askShort(x.a))}」</span><b>${rounds[x.k - 1].items.get(id)?.share || 0} → ${rounds[x.k].items.get(id)?.share || 0}</b></li>`).join('')}</ul></section>` : '';
    const nowItem = records[i].snapshot.items[id];
    const acct = it ? `<p class="m-acct">到此刻：收到 ${it.n} 条（采用 ${it.used}${it.deferred ? ` · 暂缓 ${it.deferred}` : ''}${it.duplicate ? ` · 重复 ${it.duplicate}` : ''}${it.noise ? ` · 噪音 ${it.noise}` : ''}）· 给出 ${it.share} / 64 份<br>收到的 ${pctText(it.inPct)} → 份额的 ${pctText(it.outPct)}<br><small>收到态折合 ${it.cEq.toFixed(1)} 份${it.carried ? ` · ${it.carried} 条是沿合并从旧条目接上的` : ''}</small></p>`
      : `<p class="st-muted">这一帧它不在根层${nowItem ? `（${esc(kindWord(nowItem))}）` : ''}。</p>`;
    return {
      kicker: kick, title: `<span class="m-title-dot${sideOf(id) === 'home' ? ' is-home' : ''}"></span>${esc(titleAt(id, i))}`,
      body: `${acct}<section><h4>份额 · 逐轮 <small>${esc(shortOf(id))}</small></h4>${trendSVG(shareSeries(id), view.i)}</section>
        <section><h4>收到 · 逐轮 <small>每一轮进来、算在它身上的条数</small></h4>${trendSVG(inSeries(id, i), view.i)}</section>
        ${closeList}
        <details class="m-more"><summary>摘要、依据、来源与版本</summary>${itemDetailHTML(id, i)}</details>`,
    };
  };
}
function openPanel(view) {
  panelKey = `${view.i}:${view.id}`;
  stage.showDetail(panelFor(view));
  document.querySelector('.st-title').textContent = `这一件 · ${frames[view.i].id} · ${dayTime(frames[view.i].at)} / ${view.short}`;
}
function closePanel() {
  if (!panelKey) return;
  panelKey = null;
  stage.showDetail(null);
  document.querySelector('.st-title').textContent = frames[stage.index].title;
}
stage.onEscape = () => { if (ix.s.open) { ix.close(); return true; } return false; };
function paintPanel() {
  if (X.detail && ix.view && panelKey !== `${ix.view.i}:${ix.view.id}`) openPanel(ix.view);
  else if (!X.detail && panelKey) closePanel();
}
stage.onKey = event => {
  if (event.key === 'm' || event.key === 'M') { setMode(mode === 'in' ? 'out' : 'in'); return true; }
  return false;
};
const proxyList = () => [...(tr ? tr.to : cur)].filter(([, s]) => !s.leaving).map(([id]) => id)
  .sort((a, b) => (a === 'free') - (b === 'free') || (rounds[stage.index].items.get(b)?.share || 0) - (rounds[stage.index].items.get(a)?.share || 0))
  .map(id => {
    const it = rounds[stage.index].items.get(id);
    return { id, label: id === 'free' ? `留白 ${rounds[stage.index].free} 份` : `${shortOf(id)} · ${sideWord(it?.side)} · 收到 ${it?.n ?? 0} 条 · 给出 ${it?.share ?? 0} 份` };
  });
document.querySelector('.st-tools').addEventListener('click', event => {
  const b = event.target.closest('[data-m]');
  if (!b) return;
  if (b.dataset.m === 'tell') { if (run.kind === 'tell') skipTell(); else startTell(); return; }
  setMode(b.dataset.m);
});
document.querySelector('.st-side').addEventListener('click', event => {
  const c = event.target.closest('[data-pin]');
  if (c && hasId(c.dataset.pin)) ix.open(c.dataset.pin);
});

// ---------- the loop ----------
const perf = { on: new URLSearchParams(location.search).has('perf'), times: [], work: [] };
let lastT = null;
function loop(ms) {
  const w = ms / 1000, dt = lastT == null ? 0 : Math.min(0.1, w - lastT);
  if (perf.on && lastT != null) perf.times.push(w - lastT);
  lastT = w;
  const t0 = performance.now();
  tick(dt);
  X = ix.frame();
  // After the story, the first hover drops the told marks.
  if (marks.sticky && X.focus) clearMarks();
  paintNodes(1 - 0.6 * X.dim);
  paintMarks();
  paintPanel();
  ix.paint();
  ix.sync(`${stage.index}|${mode}|${tr ? 1 : 0}`, proxyList);
  if (perf.on) perf.work.push(performance.now() - t0);
  requestAnimationFrame(loop);
}
let resizeTimer = null;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });
render();
if (autoTell) startTell();
requestAnimationFrame(loop);

const p95 = list => [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.95)] || 0;
// Hooks with the same names and meanings as foldYield and foldDial (ix.mjs), plus this page's own.
window.foldMorph = {
  ...ix.hooks(),
  /** A point `d` px outside a circle's drawn edge, towards open space (inside the widened hit band, off every other circle). */
  nearOf: (name, d = 9) => {
    const id = idFor(name), s = id && stateOf(id, clock);
    if (!s) return null;
    const b = figure.getBoundingClientRect(), r = drawnR(id) + d, base = Math.atan2(s.y - geo.cy, s.x - geo.cx);
    for (let k = 0; k < 36; k += 1) {
      const ang = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 18);
      const x = s.x + Math.cos(ang) * r, y = s.y + Math.sin(ang) * r;
      if (x < 4 || y < TOP || x > geo.W - 4 || y > geo.H - 4) continue;
      if ([...shownIds()].every(o => o === id || Math.hypot(x - stateOf(o, clock).x, y - stateOf(o, clock).y) > drawnR(o) + HIT + 2)) return { x: b.left + x, y: b.top + y };
    }
    return null;
  },
  /** The largest circle on screen that has clear space just outside it. */
  pick: () => {
    const ids = [...shownIds()].filter(id => id !== 'free' && hasId(id)).sort((a, b) => drawnR(b) - drawnR(a));
    return shortOf(ids.find(id => window.foldMorph.nearOf(id, 9)) || ids[0]);
  },
  tell: startTell, skip: skipTell, tellAt, play: startPlay, stop: stopRun,
  telling: () => run.kind === 'tell', playing: () => run.kind === 'play',
  settled: () => !tr, phase: () => (tr ? { i: tr.i, mode: tr.mode, kind: tr.kind, t: +(clock - tr.t0).toFixed(3), landed: tr.landed } : null),
  mode: () => mode, setMode, landed: () => ({ ...landed }), rounds, plan,
  geom: () => [...shownIds()].map(id => { const s = stateOf(id, clock); return { id, short: id === 'free' ? '留白' : shortOf(id), x: s.x, y: s.y, disc: rOf(s.d), ring: rOf(s.c), d: s.d, c: s.c }; }),
  /** The conservation check: disc areas plus the blank, in shares, at this instant. */
  inkShares: () => [...shownIds()].reduce((sum, id) => sum + (stateOf(id, clock)?.d || 0), 0),
  K: () => geo.K,
  layoutInfo: () => ({ K: +geo.K.toFixed(1), passes: geo.passes, worstOverlapPx: +geo.worst.toFixed(2), ms: +geo.ms.toFixed(1), W: geo.W, H: geo.H }),
  perf: () => {
    const ts = perf.times.slice(1), avg = ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length), work = perf.work.slice(1);
    return { frames: ts.length, fps: +(1 / avg).toFixed(1), p95ms: +(p95(ts) * 1000).toFixed(1), workMs: +(work.reduce((a, b) => a + b, 0) / Math.max(1, work.length)).toFixed(2), workP95ms: +p95(work).toFixed(2) };
  },
  resetPerf: () => { perf.on = true; perf.times = []; perf.work = []; },
};
