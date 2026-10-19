// 05 批次记谱（完整版）：一次整理记一行。收到几条、各怎么判；对哪几件事做了什么（新增、变大、撤下、合并逐件一个记号，
// 变小与只改内容只记件数）；登记、失效、答了几个问题；回执；旁白全文。列序按漏斗：收到挨着改动。朱红只表示来自你本人。
//
// 动画与交互的故事、数字与约束见 ../polish/notation-motion.md。论点：读得越多丢得越多，动的却不跟着多。
// - 开场 12 秒三拍同时作用在全部行上：读（一颗灰颗粒一条输入，铺出轮廓）/ 丢（噪音熄灭、暂缓沉成行下灰烬、采用转墨，
//   轮廓不变）/ 动（采用的颗粒沿本行放出流痕汇成记号；标出“收得最多”与“动得最多”不是同一行），收束时账上三个数落进
//   谱底合计行。只在顶层直接打开、不带 ?frame= 时演一次；任意键或点一下跳到终态；R 或顶栏“重演”从头演到此刻。
// - 换帧时新写入的一行演 0.9 秒的缩短版（←/→、连播、合页顶栏选帧都一样），退回时那几行 0.16 秒淡出。
// - 悬停看概要、点击展开走共用交互模块 ../motion/ix.mjs：一行是“这一轮”，一个记号是“这一件”，问题记号与合计行各一种；
//   详情就是侧栏（模块的详情卡贴在侧栏的位置上，从引线接上的那一点展开），行与记号沿本行向右推出 8 px。
//
// 两层：概念层（判定前的颗粒、灰烬、流痕）画在行下面的一块 Canvas 2D 上，只用灰，不出字；信息层（采用转墨的颗粒、外框、
// 条数、记号、问题、回执、旁白、合计行、账）墨黑加一个朱红。颗粒数 = 条数，foldNotation.census(i) 可逐行核对。
// 只读同一份回放（stage.mjs 的 frames、records、askLife），不改数据，不加字段。
import {
  createStage, esc, frames, records, dayTime, formatTime, colorOf, shortOf, titleAt, responsesIn, foldSentences, responseSentence,
  askLife, itemDetailHTML, kindWord, reduced, isSelf,
} from './stage.mjs';
import { dayOf, weekdayOf, at, textWidth } from './kit.mjs';
import { withDataset } from '../../data/select.mjs';
import { createIx, IX } from '../motion/ix.mjs';
import { dueText } from '../motion/dial-model.mjs';

const LAST = frames.length - 1;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeInOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
// Fast start, settles with an overshoot of about 3.7 % (the same curve as ix.mjs).
const easeOutBack = k => { const u = clamp(k) - 1; return 1 + 2 * u ** 3 + u ** 2; };
const hash01 = text => { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return (h >>> 0) / 4294967296; };
const median = list => { const s = [...list].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const num = x => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const pct = x => `${(x * 100).toFixed(1)}%`;
const CN = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九'];
// 0.632 → 六成三; 0.25 → 两成五; 0.4 → 四成; under a tenth, a percentage.
const chengOf = x => { const p = Math.round(x * 100); return p < 10 ? `${p}%` : p % 10 ? `${CN[Math.floor(p / 10)]}成${CN[p % 10] === '两' ? '二' : CN[p % 10]}` : `${CN[p / 10]}成`; };

// ---------- the page: the score opens on the last frame (two weeks whole) unless ?frame= says otherwise ----------
const params = new URLSearchParams(location.search);
const askedFrame = params.has('frame');
const embedded = window.parent !== window;
if (!askedFrame) { params.set('frame', String(LAST)); history.replaceState(null, '', `?${params}`); }

const key = `
  <span>收到：<svg width="50" height="12" aria-hidden="true"><rect x="0.5" y="2.5" width="46" height="6" fill="none" stroke="var(--ink-3)" stroke-width=".8"/>${[0, 3, 6, 9, 12].map(x => `<rect x="${1.5 + x}" y="3.5" width="2" height="4" fill="var(--ink)"/>`).join('')}${[18, 24, 30, 36].map(x => `<rect x="${x}" y="10.5" width="2" height="1.2" fill="var(--ink-3)"/>`).join('')}<rect x="0.5" y="0.4" width="8" height="1.8" fill="var(--vermilion)"/></svg>墨点 = 采用，一颗一条 · 框长 = 条数 · 行下灰 = 暂缓 · 空 = 噪音与重复 · 上沿朱红 = 你自己的输入</span>
  <span>改动：<b class="n-k">＋</b>新增 <b class="n-k">▲</b>变大 <b class="n-k">⊘</b>撤下 <b class="n-k">⋈</b>合并，一个记号一件；<span class="n-faint">▼ 变小 ◇ 只改内容</span>只记件数</span>
  <span>问题：<b class="n-k">◆</b>新登记 <b class="n-k n-lapsed">◇</b>失效 <b class="n-k n-you">↩</b>你答了</span>
  <span class="note"><kbd>←</kbd><kbd>→</kbd> 逐帧 <kbd>空格</kbd> 播放 <kbd>R</kbd> 重演 · 悬停看概要，点击展开 · 朱红只表示来自你本人</span>`;
const stage = createStage({
  id: 'notation', no: 5, name: '批次记谱', storyIndex: LAST, key,
  relation: '每一轮整理由什么组成：收到几条、各怎么判，对哪几件事做了什么；两周里整理的疏密，和你插话的时刻。',
});
const figure = stage.figure;
const body = document.querySelector('.st-body');
const side = document.querySelector('aside.st-side');
const sideInner = side.querySelector('.st-side-inner');
body.classList.add('n-body');

// ---------- data: everything below is read from the replay ----------
const DISPOSITIONS = ['used', 'duplicate', 'deferred', 'noise', 'unjudged'];
const dispWord = { used: '采用', duplicate: '重复', deferred: '暂缓', noise: '噪音', unjudged: '未判' };
const streamWord = { work: '工作', family: '家庭', community: '社区', life: '生活', subscription: '订阅' };
const opWord = { new: '新增', up: '变大', withdraw: '撤下', merge: '合并', down: '变小', same: '只改内容' };
const opGlyph = { new: '＋', up: '▲', withdraw: '⊘', merge: '⋈', down: '▼', same: '◇' };
const MOVED = ['new', 'up', 'withdraw', 'merge'], QUIET = ['down', 'same'], ALL_OPS = [...MOVED, ...QUIET];

/** The item itself, then up through merges and parents at frame i (as pulse.mjs rootAt walks). */
function chainAt(i, id) {
  const items = records[i].snapshot.items, out = [];
  for (let cur = id, g = 0; cur && g < 16 && !out.includes(cur); g += 1) {
    out.push(cur);
    const item = items[cur];
    cur = item?.status === 'merged' && item.merged_into ? item.merged_into : item?.parent_id || null;
  }
  return out;
}
const sourceOf = e => (e.stream ? streamWord[e.stream] || e.stream : String(e.channel || '').split(' · ')[0] || '来源');

const rows = frames.map((frame, i) => {
  const counts = Object.fromEntries(DISPOSITIONS.map(d => [d, 0]));
  const streams = {}, usedBy = {};
  let self = 0;
  for (const e of frame.events) {
    const d = DISPOSITIONS.includes(e.disposition) ? e.disposition : 'unjudged';
    counts[d] += 1;
    if (e.stream) { streams[e.stream] = (streams[e.stream] || 0) + 1; if (d === 'used') usedBy[e.stream] = (usedBy[e.stream] || 0) + 1; }
    if (isSelf(e)) self += 1;
  }
  // What the batch did to each item, read from the replayed diff (children included).
  const ops = Object.fromEntries(ALL_OPS.map(op => [op, []]));
  const opOf = new Map();
  for (const c of records[i].diff.changes || []) {
    if (c.type === 'annotations_changed') continue;
    const before = c.before?.share, after = c.after?.share;
    const op = c.type === 'added' ? 'new' : c.type === 'restored' ? 'up' : c.type === 'withdrawn' ? 'withdraw' : c.type === 'merged' ? 'merge'
      : before != null && after != null && after > before ? 'up' : before != null && after != null && after < before ? 'down' : 'same';
    ops[op].push({ id: c.item, before, after, fields: c.fields });
    opOf.set(c.item, op);
  }
  const marks = MOVED.flatMap(op => ops[op].map(x => ({ ...x, op, pushers: [] })));
  const markOf = new Map(marks.map(m => [m.id, m]));
  // An adopted input goes into the item its batch declaration cites it for, else its first related item; it flows to that
  // item's mark when the item, or something it sits in or was merged into, “moved” this round; else into ▼/◇; else nowhere.
  const cited = new Map();
  for (const d of frame.batch?.declarations || []) for (const s of d.sources || []) if (s.ref?.startsWith('event:')) cited.set(s.ref.slice(6), d.id);
  const order = frame.events.map((e, k) => [e, k]).sort((a, b) => Date.parse(a[0].at) - Date.parse(b[0].at) || a[1] - b[1]);
  let adopted = 0;
  const quietPushers = [];
  const particles = order.map(([e, k], p) => {
    const disp = DISPOSITIONS.includes(e.disposition) ? e.disposition : 'unjudged';
    const ref = disp === 'used' ? cited.get(e.id) || e.relatedIds?.[0] || null : null;
    const chain = ref ? chainAt(i, ref) : [];
    let dest = null;
    if (disp === 'used') {
      const moved = chain.find(id => markOf.has(id));
      const quiet = moved ? null : chain.find(id => QUIET.includes(opOf.get(id)));
      dest = moved ? { kind: 'mark', id: moved } : quiet ? { kind: 'quiet', id: quiet } : { kind: 'none' };
      if (moved) markOf.get(moved).pushers.push(p); else if (quiet) quietPushers.push(p);
    }
    return { p, k, id: e.id, disp, self: isSelf(e), source: sourceOf(e), chain, dest, a: disp === 'used' ? adopted++ : -1, u: hash01(`${e.id}:flow`),
      title: String(e.subject || e.text || '').replace(/\s+/g, ' ').trim() };
  });
  return {
    i, frame, n: frame.events.length, counts, streams, usedBy, self, ops, opOf, marks, markOf, particles, quietPushers, life: askLife[i],
    moved: marks.length, quiet: ops.down.length + ops.same.length, toMarks: marks.reduce((s, m) => s + m.pushers.length, 0),
    gap: i ? (at(i) - at(i - 1)) / 3600000 : null, annotations: frame.annotations || [], receipt: records[i].receipt,
  };
});
const maxInputs = Math.max(1, ...rows.map(r => r.n));
const opsOf = new Map();
for (const r of rows) for (const op of ALL_OPS) for (const x of r.ops[op]) {
  if (!opsOf.has(x.id)) opsOf.set(x.id, []);
  opsOf.get(x.id).push({ i: r.i, op, ...x });
}
// Running totals up to each frame (the score's bottom row reads them “到此刻”).
const cum = [];
{
  const acc = { rounds: 0, n: 0, used: 0, deferred: 0, noise: 0, duplicate: 0, unjudged: 0, moved: 0, toMarks: 0, fresh: 0, lapsed: 0, answered: 0, ...Object.fromEntries(ALL_OPS.map(op => [op, 0])) };
  rows.forEach((r, i) => {
    if (i) {
      acc.rounds += 1; acc.n += r.n; acc.moved += r.moved; acc.toMarks += r.toMarks;
      for (const d of DISPOSITIONS) acc[d] += r.counts[d];
      for (const op of ALL_OPS) acc[op] += r.ops[op].length;
      acc.fresh += r.life.fresh.length; acc.lapsed += r.life.lapsed.length; acc.answered += r.life.answered.length;
    }
    cum[i] = { ...acc, open: r.life.open.size, receipt: [...rows.slice(0, i + 1)].reverse().find(x => x.receipt?.revision)?.receipt.revision || '' };
  });
}
const inputRows = upto => rows.slice(1, upto + 1).filter(r => r.n);
const mediansTo = upto => {
  const list = inputRows(upto);
  return { rounds: list.length, n: median(list.map(r => r.n)), used: median(list.map(r => r.counts.used)), rate: median(list.map(r => r.counts.used / r.n)), moved: median(list.map(r => r.moved)) };
};
/** The round that received the most and the one that moved the most, up to frame `upto` (first of equals). */
function extremesTo(upto) {
  const list = rows.slice(1, upto + 1);
  const most = (f, rowsIn) => rowsIn.reduce((best, r) => (f(r) > f(best) ? r : best), rowsIn[0]);
  return list.length ? { inMost: most(r => r.n, list), movedMost: most(r => r.moved, list) } : null;
}

// ---------- timing (seconds) ----------
// The opening (notation-motion.md 第 3 节): 0.4 s still; 读 0.4–4.0; 丢 4.0–6.6 (acts at 4.3); 动 6.6–10.4; 收束 10.4–12.0.
const OP = { spreadDur: 0.45, judgeAt: 4.3, fadeDur: 0.3, sinkDur: 0.5, compactDur: 0.5, flowAt: 6.6, flowDur: 0.6, jitter: 0.08, trail: 0.8,
  usedAt: 5.3, splitAt: 5.6, movedSplitAt: 9.2, quietAt: 8.9, fillDur: 0.2, asksAt: 9.4, annoAt: 9.7, annoDur: 0.3, settleAt: 11.4, settleDur: 0.6, braceDur: 0.4, end: 12 };
// One new row when stepping (0.9 s): spread 0–0.3, judge at 0.35, traces 0.6–0.9, asks and receipt at 0.9, narration fades in.
const SH = { spreadDur: 0.3, judge: 0.35, fadeDur: 0.2, sinkDur: 0.2, compactDur: 0.25, flow: 0.6, flowDur: 0.25, jitter: 0.05, trail: 0.4,
  quiet: 0.72, fillDur: 0.18, asks: 0.9, say: 0.9, sayDur: 0.2, end: 1.35 };
const LEAVE = 0.16;

// The animation clock stands still while something is hovered or open (ix.mjs pause / resume).
const wall = () => performance.now() / 1000;
const clock = { held: false, heldAt: 0, offset: 0 };
const T = () => (clock.held ? clock.heldAt : wall()) - clock.offset;
// The time the rows are drawn at: the clock, or the moment a still holds the opening at (foldNotation.seek).
const nowT = () => (opening && opening.fixed != null ? opening.t0 + opening.fixed : T());
const hold = { on: false, wasPlaying: false };
const isPlaying = () => document.body.classList.contains('st-playing');

let opening = null;          // { t0, upto, s1, s3, s4, fixed, anno, ledger }
const anim = new Map();      // row → { kind: 'open' | 'short', t0 }
const leaving = new Map();   // row → when it started to fade out (wall clock: taking rows back is navigation, never held)

function scheduleOf(i) {
  const a = anim.get(i);
  if (!a) return null;
  if (a.kind === 'open') {
    const O = opening, o = Math.max(0, i - 1), t0 = O.t0;
    return { spreadAt: t0 + 0.4 + o * O.s1, spreadDur: OP.spreadDur, judgeAt: t0 + OP.judgeAt, fadeDur: OP.fadeDur, sinkDur: OP.sinkDur, compactDur: OP.compactDur,
      flowAt: t0 + OP.flowAt + o * O.s3, flowDur: OP.flowDur, jitter: OP.jitter, trail: OP.trail, quietAt: t0 + OP.quietAt, fillDur: OP.fillDur,
      asksAt: t0 + OP.asksAt, sayAt: t0 + OP.settleAt + o * O.s4, sayDur: 0.3, end: t0 + OP.end };
  }
  const t0 = a.t0;
  return { spreadAt: t0, spreadDur: SH.spreadDur, judgeAt: t0 + SH.judge, fadeDur: SH.fadeDur, sinkDur: SH.sinkDur, compactDur: SH.compactDur,
    flowAt: t0 + SH.flow, flowDur: SH.flowDur, jitter: SH.jitter, trail: SH.trail, quietAt: t0 + SH.quiet, fillDur: SH.fillDur,
    asksAt: t0 + SH.asks, sayAt: t0 + SH.say, sayDur: SH.sayDur, end: t0 + SH.end };
}
const FULL = { s: null, spread: 1, counted: true, j: 99, judged: true, f: 99, asks: true, say: 1, t: 0 };
function phaseOf(i, t) {
  const s = scheduleOf(i);
  if (!s) return FULL;
  return { s, t, spread: easeOut((t - s.spreadAt) / s.spreadDur), counted: t >= s.spreadAt + s.spreadDur, j: t - s.judgeAt, judged: t >= s.judgeAt + s.compactDur,
    f: t - s.flowAt, asks: t >= s.asksAt, say: clamp((t - s.sayAt) / s.sayDur) };
}
// When a mark lands (seconds after its row's flow starts): the last of its traces to arrive; unpushed marks fall on their own.
const arrivalOf = (r, pushers, s) => (pushers.length ? Math.max(...pushers.map(p => r.particles[p].u * s.jitter)) + s.flowDur : null);
/** 0 not yet, 1 hollow, 2 landed; and seconds since it landed. */
function markState(r, m, ph) {
  if (!ph.s) return [2, 99];
  const a = arrivalOf(r, m.pushers, ph.s);
  if (a != null) return ph.f >= a ? [2, ph.f - a] : [0, 0];
  const since = ph.t - ph.s.quietAt;
  return since >= ph.s.fillDur ? [2, since - ph.s.fillDur] : since >= 0 ? [1, 0] : [0, 0];
}
function quietState(r, ph) {
  if (!ph.s) return true;
  const a = arrivalOf(r, r.quietPushers, ph.s);
  return a != null ? ph.f >= a : ph.t >= ph.s.quietAt;
}

// ---------- layout ----------
const COLS = ['when', 'gap', 'inputs', 'ops', 'trace', 'asks', 'receipt', 'title'];
let geo = null;
function measure() {
  const W = figure.clientWidth, H = figure.clientHeight, HEAD = 28, TOTAL = 38;
  const rowH = Math.max(14, Math.min(32, (H - HEAD - 12 - TOTAL) / frames.length));
  const cols = { when: 86, gap: 44, inputs: 214, ops: 180, trace: 22, asks: 86, receipt: 50 };
  cols.title = W - Object.values(cols).reduce((s, x) => s + x, 0);
  const x = {};
  let acc = 0;
  for (const k of COLS) { x[k] = acc; acc += cols[k]; }
  // Particles: one layer while no round has more than 40 inputs, else three; the unit is the column over the busiest round, at most 8 px.
  const barW = cols.inputs - 44, L = maxInputs > 40 ? 3 : 1, u = Math.min(8, barW / Math.ceil(maxInputs / L)), d = u <= 3 ? u * 0.64 : u * 0.75;
  const totalY = HEAD + frames.length * rowH + 12;
  return { W, H, HEAD, TOTAL, rowH, cols, x, barW, L, u, d, totalY, hero: Math.round(Math.min(120, H / 6.5)) };
}
const rowTop = i => geo.HEAD + i * geo.rowH;
const rowMid = i => rowTop(i) + geo.rowH / 2;
const barLen = r => Math.ceil(r.n / geo.L) * geo.u;
const pos = (k, mid) => {
  const g = geo, l = k % g.L, j = Math.floor(k / g.L);
  return { x: g.x.inputs + 1 + j * g.u + g.u / 2, y: mid + (l - (g.L - 1) / 2) * g.u };
};
const barBox = (r, mid) => { const h = geo.L * geo.u; return { x0: geo.x.inputs + 0.5, x1: geo.x.inputs + 1.5 + barLen(r), y0: mid - h / 2 - 0.5, y1: mid + h / 2 + 0.5 }; };
const countX = r => geo.x.inputs + barLen(r) + 6;

// One mark per moved item; a busy round packs them closer (and a little smaller) instead of spilling into the next column.
function opsLayout(r) {
  const quiet = [r.ops.down.length ? `▼${r.ops.down.length}` : '', r.ops.same.length ? `◇${r.ops.same.length}` : ''].filter(Boolean).join(' ');
  const qw = quiet ? textWidth(quiet, 9.5, 400, getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace') + 4 : 0;
  const free = geo.cols.ops - 10 - qw, n = r.marks.length;
  const pitch = n ? Math.min(11.5, free / n) : 0;
  return { quiet, pitch, size: pitch && pitch < 10.5 ? Math.max(7.5, pitch * 0.98) : 10.5, quietX: n ? n * pitch + 5 : 0 };
}

// ---------- DOM ----------
const tally = (glyph, n, cls = '', max = 6) => (!n ? '' : `<span class="n-tally ${cls}">${n <= max ? glyph.repeat(n) : `${glyph}<small>×${n}</small>`}</span>`);
function titleHTML(text, width, rowH) {
  // Never cut the narration: shrink a little, then wrap to two lines.
  for (const size of [12, 11.5, 11]) if (textWidth(text, size) <= width - 4) return `<span class="n-title" style="font-size:${size}px">${esc(text)}</span>`;
  const size = rowH >= 26 ? 11 : 10;
  return `<span class="n-title is-two" style="font-size:${size}px">${esc(text)}</span>`;
}
function asksHTML(r) {
  const list = [...r.life.fresh.map(a => ['◆', 'n-fresh', a]), ...r.life.lapsed.map(a => ['◇', 'n-lapsed', a]), ...r.life.answered.map(a => ['↩', 'n-you', a])];
  if (list.length <= 6) return list.map(([g, cls, a]) => `<i class="n-a ${cls}" data-id="ask:${esc(a.id)}@${r.i}">${g}</i>`).join('');
  return `${tally('◆', r.life.fresh.length, 'n-fresh', 1)}${tally('◇', r.life.lapsed.length, 'n-lapsed', 1)}${tally('↩', r.life.answered.length, 'n-you', 1)}`;
}
function rowHTML(r) {
  const g = geo, t = at(r.i), c = g.cols;
  const firstOfDay = r.i === 0 || dayOf(at(r.i - 1)) !== dayOf(t);
  r.layout = opsLayout(r);
  r.marks.forEach((m, k) => { m._x = k * r.layout.pitch; });
  const inputs = r.n ? `<span class="n-count" style="left:${(barLen(r) + 5).toFixed(1)}px">${r.n}</span>`
    : `<span class="n-empty">${r.i === 0 ? '— 空状态' : '— 定时整理，无输入'}</span>`;
  const ann = r.annotations.length ? `<span class="n-ann" style="left:${(r.n ? barLen(r) + 10 + textWidth(String(r.n), 9.5) : 112).toFixed(1)}px" title="${esc(r.annotations.map(a => a.text).join(' / '))}">✎${r.annotations.length > 1 ? r.annotations.length : ''}</span>` : '';
  const marks = r.marks.map(m => `<i class="n-m" data-id="item:${esc(m.id)}@${r.i}" data-op="${m.op}" style="left:${m._x.toFixed(1)}px;width:${r.layout.pitch.toFixed(1)}px;font-size:${r.layout.size.toFixed(1)}px">${opGlyph[m.op]}</i>`).join('');
  const quiet = r.layout.quiet ? `<span class="n-quiet" style="left:${r.layout.quietX.toFixed(1)}px">${r.layout.quiet}</span>` : '';
  const receipt = !r.receipt ? '' : r.receipt.type === 'checked' ? '检查' : `${esc(r.receipt.revision)}${r.receipt.acknowledges?.length ? '·批' : ''}`;
  // The rule's length is the gap; the hours are written only where the cadence changes.
  const changed = r.gap != null && (r.i < 2 || Math.round(rows[r.i - 1].gap) !== Math.round(r.gap));
  const gap = r.gap == null ? '' : `<i style="width:${Math.max(2, Math.min(1, r.gap / 16) * 26).toFixed(1)}px"></i>${r.gap >= 10 && changed ? `<small>${Math.round(r.gap)}h</small>` : ''}`;
  return `<div class="n-row${firstOfDay ? ' is-dayfirst' : ''}" data-row="${r.i}" data-id="row:${r.i}" style="transform:translateY(${rowTop(r.i).toFixed(1)}px);height:${g.rowH.toFixed(1)}px">
    <div class="n-when">${firstOfDay ? `<b>${dayOf(t)}</b><span>${weekdayOf(t)}</span>` : ''}<time>${formatTime(t)}</time></div>
    <div class="n-gap">${gap}</div>
    <div class="n-inputs" data-part="inputs">${inputs}${ann}</div>
    <div class="n-ops" data-part="ops">${marks}${quiet}</div>
    <div class="n-trace"></div>
    <div class="n-asks" data-part="asks">${asksHTML(r)}</div>
    <div class="n-receipt">${receipt}</div>
    <div class="n-say">${titleHTML(frames[r.i].title, c.title, g.rowH)}</div>
  </div>`;
}
function totalHTML() {
  const g = geo;
  return `<div class="n-row n-total" data-id="total" style="transform:translateY(${g.totalY.toFixed(1)}px);height:${g.TOTAL}px">
    <div class="n-when"><b class="n-t-label">两周</b><small class="n-t-note">合计</small></div>
    <div class="n-gap"></div>
    <div class="n-inputs"><span class="n-count n-t-in" style="left:${(g.barW + 5).toFixed(1)}px"></span><small class="n-t-scale" style="left:${(g.barW + 5).toFixed(1)}px">按比例</small></div>
    <div class="n-ops"><b class="n-t-moved"></b><span class="n-t-split"></span><span class="n-t-quiet"></span></div>
    <div class="n-trace"></div>
    <div class="n-asks"><span class="n-t-asks"></span></div>
    <div class="n-receipt"><span class="n-t-rc"></span></div>
    <div class="n-say"><span class="n-t-say"></span></div>
  </div>`;
}

const els = { rows: [] };
const score = document.createElement('div');
score.className = 'n-score';
figure.append(score);
function render() {
  geo = measure();
  const c = geo.cols;
  figure.style.cssText = Object.entries(c).map(([k, v]) => `--${k}:${v}px`).join(';');
  score.innerHTML = `<canvas class="n-canvas" aria-hidden="true"></canvas>
    <div class="n-head"><b data-h="when">整理</b><b data-h="gap">间隔</b><b data-h="inputs">收到 <small>条数 · 怎么判</small></b><b data-h="ops">改动 <small>件数</small></b><b data-h="trace"></b><b data-h="asks">问题</b><b data-h="receipt">回执</b><b data-h="title">这一轮（旁白）</b></div>
    <div class="n-rows">${rows.map(rowHTML).join('')}${totalHTML()}</div>
    <svg class="n-brace" aria-hidden="true"><path pathLength="1"/></svg>
    <div class="n-now" style="height:${geo.rowH.toFixed(1)}px"></div>
    <div class="n-overlay"></div>`;
  els.rows = [...score.querySelectorAll('.n-row:not(.n-total)')];
  els.total = score.querySelector('.n-total');
  els.now = score.querySelector('.n-now');
  els.heads = Object.fromEntries([...score.querySelectorAll('[data-h]')].map(b => [b.dataset.h, b]));
  els.brace = score.querySelector('.n-brace path');
  els.overlay = score.querySelector('.n-overlay');
  els.cells = els.rows.map((row, i) => {
    const q = s => row.querySelector(s);
    return { row, when: q('.n-when'), gap: q('.n-gap'), inputs: q('.n-inputs'), count: q('.n-count, .n-empty'), ann: q('.n-ann'), ops: q('.n-ops'),
      marks: [...row.querySelectorAll('.n-m')], quiet: q('.n-quiet'), trace: q('.n-trace'), asks: q('.n-asks'), receipt: q('.n-receipt'), say: q('.n-say'), i };
  });
  const t = els.total, q = s => t.querySelector(s);
  els.t = { label: q('.n-t-label'), note: q('.n-t-note'), in: q('.n-t-in'), scale: q('.n-t-scale'), moved: q('.n-t-moved'), split: q('.n-t-split'), quiet: q('.n-t-quiet'), asks: q('.n-t-asks'), rc: q('.n-t-rc'), say: q('.n-t-say') };
  // The canvas sits under the rows, at the device's pixel density.
  const canvas = score.querySelector('.n-canvas'), dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(geo.W * dpr); canvas.height = Math.round(geo.H * dpr);
  canvas.style.width = `${geo.W}px`; canvas.style.height = `${geo.H}px`;
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  braceGeometry();
  if (opening) buildOpeningOverlay();
  cache.clear();
  dirty = true;
}

// ---------- colours (read once from the page's palette) ----------
let ctx = null;
const C = (() => {
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const css = getComputedStyle(document.documentElement);
  const rgb = name => { probe.fillStyle = '#000'; probe.fillStyle = css.getPropertyValue(name).trim() || '#888'; probe.clearRect(0, 0, 1, 1); probe.fillRect(0, 0, 1, 1); const d = probe.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  return { ink: rgb('--ink'), ink2: rgb('--ink-2'), ink3: rgb('--ink-3'), line: rgb('--line'), verm: rgb('--vermilion'), paper: rgb('--paper') };
})();
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)].map(Math.round);
// The concept layer's grey: lighter than every word and line of the information layer.
const GREY = mix(C.ink3, C.paper, 0.12);

// ---------- the opening ----------
const playOpening = !askedFrame && !embedded && !reduced();
function startOpening(upto = stage.index) {
  ix.reset();
  stage.pause();
  const count = Math.max(1, upto);
  opening = { t0: T(), upto, s1: Math.min(0.11, 3.1 / Math.max(1, count - 1)), s3: Math.min(0.06, 1.6 / Math.max(1, count - 1)), s4: Math.min(0.02, 0.5 / count), fixed: null };
  anim.clear(); leaving.clear();
  for (let i = 0; i <= upto; i += 1) anim.set(i, { kind: 'open' });
  const ex = extremesTo(upto);
  opening.anno = !ex ? [] : ex.inMost.i === ex.movedMost.i
    ? [{ i: ex.inMost.i, text: `收得最多，也动得最多（${ex.inMost.n} 条 → ${ex.inMost.moved} 处）` }]
    : [{ i: ex.inMost.i, text: `收得最多 ${ex.inMost.n} 条 → ${ex.inMost.moved} 处` }, { i: ex.movedMost.i, text: `动得最多 ${ex.movedMost.moved} 处 ← ${ex.movedMost.n} 条` }];
  document.body.classList.add('n-opening');
  buildOpeningOverlay();
  dirty = true;
}
function finishOpening() {
  if (!opening) return;
  opening = null;
  anim.clear();
  document.body.classList.remove('n-opening');
  els.overlay.innerHTML = '';
  for (const b of Object.values(els.heads)) b.classList.remove('is-grey');
  els.brace.style.strokeDashoffset = '';
  paintTicks(null);
  cache.clear();
  dirty = true;
}
const openingTime = () => (opening ? (opening.fixed != null ? opening.fixed : T() - opening.t0) : null);

// The ledger (账) sits in the narration column while the narration is still empty, clear of the two annotated rows.
function buildOpeningOverlay() {
  const g = geo, O = opening, tot = cum[O.upto];
  const rest = tot.n - tot.used;
  els.overlay.innerHTML = `<div class="n-ledger" style="left:${(g.x.title + 12).toFixed(1)}px;width:${(g.cols.title - 20).toFixed(1)}px">
      <p class="n-l n-l-in"><span>收到</span><b data-v="in">0</b><small>条</small></p>
      <p class="n-l n-l-used"><span>采用</span><b data-v="used">${tot.used}</b><small>条</small></p>
      <p class="n-l-sub" data-v="drop">没采用 ${rest} · ${tot.n ? chengOf(rest / tot.n) : '—'}</p>
      <p class="n-l-sub" data-v="split">${['deferred', 'noise', 'duplicate', 'unjudged'].filter(d => tot[d]).map(d => `${dispWord[d]} ${tot[d]}`).join(' · ')}</p>
      <p class="n-l n-l-moved"><span>动了</span><b data-v="moved" style="font-size:${g.hero}px">0</b><small>处</small></p>
      <p class="n-l-sub" data-v="ops">${MOVED.map(op => `${opGlyph[op]}${tot[op]}`).join(' ')}</p>
    </div>
    ${O.anno.map((a, k) => `<div class="n-anno" data-k="${k}"><i style="left:${(countX(rows[a.i]) + 18).toFixed(1)}px;top:${(rowTop(a.i) + g.rowH - 4).toFixed(1)}px;width:${(g.x.title + 8 - countX(rows[a.i]) - 18).toFixed(1)}px"></i>
      <span style="left:${(g.x.title + 12).toFixed(1)}px;top:${(rowMid(a.i)).toFixed(1)}px">${esc(a.text)}</span></div>`).join('')}`;
  const ledger = els.overlay.querySelector('.n-ledger');
  const h = ledger.offsetHeight, top = g.HEAD + 6, bottom = g.HEAD + (O.upto + 1) * g.rowH - 6;
  const busy = O.anno.map(a => [rowTop(a.i) - 6, rowTop(a.i) + g.rowH + 6]);
  const clear = y => busy.every(([a, b]) => y + h < a || y > b);
  let y = [top, bottom - h, (top + bottom - h) / 2].find(clear);
  if (y == null) y = top;
  ledger.style.top = `${Math.max(top, y).toFixed(1)}px`;
  els.ledger = { box: ledger, ...Object.fromEntries([...ledger.querySelectorAll('[data-v]')].map(n => [n.dataset.v, n])), rows: [...ledger.querySelectorAll('.n-l')] };
  els.anno = [...els.overlay.querySelectorAll('.n-anno')];
}

// The tick strip in the frame bar lights one tick per row as beat 1 writes it.
function paintTicks(lit) {
  const ticks = document.querySelectorAll('.st-ticks [data-tick]');
  ticks.forEach((tick, i) => {
    const past = lit == null ? i < stage.index : i <= lit && i < stage.index, on = lit == null ? i === stage.index : i === stage.index && lit >= i;
    tick.classList.toggle('is-past', past); tick.classList.toggle('is-on', on);
  });
}

// ---------- frame changes: a new row is written in 0.9 s; rows taken back fade out ----------
let cutting = false, lastEntry = 0;
stage.onFrame((next, previous) => {
  // Navigation drops hover and detail at once (ix.mjs); opening a row moves 此刻 to it without that (see `follow`).
  if (!cutting) { if (!isPlaying()) hold.wasPlaying = false; ix.reset(); }
  if (opening) finishOpening();
  const rm = reduced(), t = T();
  if (next > previous) {
    const list = [];
    for (let i = previous + 1; i <= next; i += 1) { leaving.delete(i); list.push(i); }
    const step = list.length > 1 ? Math.min(0.04, 0.3 / list.length) : 0;
    if (!rm) list.forEach((i, k) => anim.set(i, { kind: 'short', t0: t + k * step }));
    lastEntry = t;
  } else {
    for (let i = next + 1; i <= previous; i += 1) { anim.delete(i); if (!rm) leaving.set(i, wall()); }
  }
  braceGeometry();
  dirty = true;
});

// ---------- painting: the information layer's DOM ----------
const cache = new Map();
const setStyle = (el, prop, value) => { if (!el) return; const k = el; let m = cache.get(k); if (!m) cache.set(k, m = {}); if (m[prop] !== value) { m[prop] = value; el.style[prop] = value; } };
const setClass = (el, cls, on) => { if (!el) return; const k = el; let m = cache.get(k); if (!m) cache.set(k, m = {}); const key = `c:${cls}`; if (m[key] !== on) { m[key] = on; el.classList.toggle(cls, on); } };
const setText = (el, text) => { if (!el) return; let m = cache.get(el); if (!m) cache.set(el, m = {}); if (m.text !== text) { m.text = text; el.textContent = text; } };
const op1 = v => (v >= 0.999 ? '' : v.toFixed(3));

let X = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
const parseId = id => {
  if (!id) return null;
  if (id === 'total') return { kind: 'total' };
  let m = id.match(/^row:(\d+)$/);
  if (m) return { kind: 'row', i: Number(m[1]) };
  m = id.match(/^item:(.+)@(\d+)$/);
  if (m) return { kind: 'item', id: m[1], i: Number(m[2]) };
  m = id.match(/^ask:(.+)@(\d+)$/);
  if (m) return { kind: 'ask', id: m[1], i: Number(m[2]) };
  return null;
};
const askOf = (id, i) => [...askLife[i].fresh, ...askLife[i].lapsed, ...askLife[i].answered].find(a => a.id === id) || null;
// What stays bright: a row (its cells and particles), or one item everywhere (its marks, its trace, the inputs that went into it).
function focusOf() {
  const f = parseId(X.focus);
  if (!f) return null;
  if (f.kind === 'ask') { const a = askOf(f.id, f.i); return { ...f, item: a?.item || null }; }
  return f;
}
let leader = null;   // the open item's path through the trace column: which rows it has passed, for lighting their circles

function paintRows(t) {
  const now = stage.index, F = focusOf(), dim = X.dim, ot = openingTime();
  const other = 1 - 0.3 * dim;
  const traced = F?.kind === 'item' ? F.id : F?.kind === 'ask' ? F.item : null;
  const traceRows = traced ? new Set((opsOf.get(traced) || []).filter(x => x.i <= now).map(x => x.i)) : null;
  const lit = X.detail && leader && X.line > 0 ? leader.passes.filter(p => p.at <= X.line * leader.length).map(p => p.i) : null;
  for (const c of els.cells) {
    const i = c.i, r = rows[i], fade = leaving.has(i) ? 1 - clamp((wall() - leaving.get(i)) / LEAVE) : 1;
    if (fade <= 0) leaving.delete(i);
    const future = i > now && !leaving.has(i);
    setClass(c.row, 'is-future', future);
    setClass(c.row, 'is-current', i === now && !opening);
    if (future) continue;
    const ph = phaseOf(i, t);
    const rowOn = !F || (F.kind === 'row' && F.i === i) ? 1 : other;
    const cellA = v => op1(fade * v);
    // Cells that only stand for this row dim with it; under an item's focus every cell dims but its marks and trace.
    const a = F && F.kind !== 'row' ? other : rowOn;
    setStyle(c.when, 'opacity', cellA(a));
    setStyle(c.gap, 'opacity', cellA(a));
    setStyle(c.count, 'opacity', cellA(a * (r.n ? (ph.counted ? 1 : 0) : ph.spread > 0 || !ph.s ? 1 : 0)));
    if (c.ann) setStyle(c.ann, 'opacity', cellA(a * (ph.counted ? 1 : 0)));
    const askHere = F?.kind === 'ask' && F.i === i;
    setStyle(c.asks, 'opacity', cellA((askHere ? 1 : a) * (ph.asks ? 1 : 0)));
    setStyle(c.receipt, 'opacity', cellA(a * (ph.asks ? 1 : 0)));
    setStyle(c.say, 'opacity', cellA(a * (ph.s ? ph.say : 1)));
    // Marks: hard cut when the last trace arrives, with a 3.7 % swell; unpushed ones fall hollow, then fill.
    const pop = X.popId && X.pop > 0 ? parseId(X.popId) : null;
    r.marks.forEach((m, k) => {
      const el = c.marks[k], [state, since] = markState(r, m, ph);
      setClass(el, 'is-off', state === 0);
      setClass(el, 'is-hollow', state === 1);
      const mine = traced === m.id;
      setStyle(el, 'opacity', cellA(!F ? 1 : mine ? 1 : F.kind === 'row' ? rowOn : other));
      setClass(el, 'is-hit', Boolean(mine && F));
      const swell = state === 2 && since < 0.18 ? 1 + 0.037 * Math.sin(Math.PI * since / 0.18) : 1;
      const dx = pop?.kind === 'item' && pop.id === m.id && pop.i === i ? IX.pop * X.pop : 0;
      setStyle(el, 'transform', dx || swell !== 1 ? `translateX(${dx.toFixed(2)}px) scale(${swell.toFixed(4)})` : '');
    });
    if (c.quiet) { setStyle(c.quiet, 'opacity', cellA(a * (quietState(r, ph) ? 1 : 0))); }
    // The trace column: this item's mark in every round it changed; the open item's leader lights them as it passes.
    const hit = traceRows?.has(i) ? (opsOf.get(traced) || []).find(x => x.i === i) : null;
    const html = hit ? `<b class="n-op-${hit.op}${lit?.includes(i) ? ' is-lit' : ''}" title="${opWord[hit.op]}">${opGlyph[hit.op]}</b>` : '';
    let m = cache.get(c.trace);
    if (!m) cache.set(c.trace, m = {});
    if (m.html !== html) { m.html = html; c.trace.innerHTML = html; }
    setStyle(c.trace, 'opacity', cellA(1));
    setClass(c.row, 'is-traced', Boolean(hit));
    // Asks glyphs: an ask's own focus keeps it bright, the others in its cell dim.
    const askMemo = cache.get(c.asks);
    if (askHere || askMemo.askFocus) {
      for (const el of c.asks.querySelectorAll('.n-a')) setStyle(el, 'opacity', askHere && el.dataset.id !== X.focus ? other.toFixed(3) : '');
      askMemo.askFocus = askHere;
    }
    const dx = pop?.kind === 'row' && pop.i === i ? IX.pop * X.pop : 0;
    setStyle(c.row, 'transform', `translate(${dx.toFixed(2)}px, ${rowTop(i).toFixed(1)}px)`);
    if (pop?.kind === 'ask' && pop.i === i) {
      for (const el of c.asks.querySelectorAll('.n-a')) setStyle(el, 'transform', el.dataset.id === X.popId ? `translateX(${(IX.pop * X.pop).toFixed(2)}px)` : '');
    }
  }
  // 此刻: hidden while the opening plays; drawn heavier while a row is open.
  setStyle(els.now, 'transform', `translateY(${rowTop(now).toFixed(1)}px)`);
  setClass(els.now, 'is-open', Boolean(X.popId === `row:${now}` && X.pop > 0.01));
  // Column heads turn from grey to ink as their beat comes.
  if (ot != null) {
    const head = { when: 0, gap: 0, inputs: 0.4, ops: OP.flowAt, trace: OP.flowAt, asks: OP.asksAt, receipt: OP.asksAt, title: OP.settleAt };
    for (const [k, b] of Object.entries(els.heads)) setClass(b, 'is-grey', ot < head[k]);
  }
  paintTotal(t, ot, F, other);
  if (ot != null) paintOpeningOverlay(t, ot);
}

// The bottom row: totals up to 此刻, each beat of a row that is still being written adding in on its beat.
function totalsNow(t) {
  const now = stage.index, out = { n: 0, used: 0, deferred: 0, moved: 0, quiet: 0, fresh: 0, lapsed: 0, answered: 0, ...Object.fromEntries(ALL_OPS.map(op => [op, 0])) };
  for (let i = 1; i <= now; i += 1) {
    const r = rows[i], ph = phaseOf(i, t);
    if (ph.counted) out.n += r.n;
    if (ph.judged) { out.used += r.counts.used; out.deferred += r.counts.deferred; }
    if (ph.asks) {
      out.moved += r.moved; out.quiet += r.quiet;
      for (const op of ALL_OPS) out[op] += r.ops[op].length;
      out.fresh += r.life.fresh.length; out.lapsed += r.life.lapsed.length; out.answered += r.life.answered.length;
    }
  }
  return out;
}
function paintTotal(t, ot, F, other) {
  const T0 = els.t, now = stage.index, tot = totalsNow(t);
  const showing = ot == null || ot >= OP.end - 0.001;
  setText(T0.label, now === LAST ? '两周' : '到此刻');
  setText(T0.note, now === LAST ? '合计' : `${cum[now].rounds} 轮`);
  setText(T0.in, String(tot.n));
  setText(T0.moved, String(tot.moved));
  setText(T0.split, MOVED.map(op => `${opGlyph[op]}${tot[op]}`).join(' '));
  setText(T0.quiet, `▼${tot.down} ◇${tot.same}`);
  setText(T0.asks, `◆${tot.fresh} ◇${tot.lapsed} ↩${tot.answered}`);
  setText(T0.rc, now ? cum[now].receipt : '');
  let m = cache.get(T0.say);
  const say = `读 <b class="n-t-n">${tot.n}</b> · 采用 <b class="n-t-used">${tot.used}</b> · 动了 <b class="n-t-m">${tot.moved}</b> 处`;
  if (!m) cache.set(T0.say, m = {});
  if (m.html !== say) { m.html = say; T0.say.innerHTML = say; }
  const a = !F ? 1 : F.kind === 'total' ? 1 : other;
  // The row's frame and its label are part of the skeleton; its numbers land at the end of the opening.
  for (const el of [T0.label, T0.note]) setStyle(el, 'opacity', op1(a));
  for (const el of [T0.in, T0.scale, T0.moved, T0.split, T0.quiet, T0.asks, T0.rc, T0.say]) setStyle(el, 'opacity', showing ? op1(a) : '0');
  const dx = X.popId === 'total' ? IX.pop * X.pop : 0;
  setStyle(els.total, 'transform', `translate(${dx.toFixed(2)}px, ${geo.totalY.toFixed(1)}px)`);
}

function paintOpeningOverlay(t, ot) {
  const L = els.ledger, O = opening;
  if (!L) return;
  // 收到 counts the grains as they land; 采用 and 没采用 cut in at 5.3 s, the split at 5.6; 动了 counts the marks as they land.
  let received = 0, moved = 0;
  for (let i = 1; i <= O.upto; i += 1) {
    const r = rows[i], ph = phaseOf(i, t);
    received += ph.counted ? r.n : Math.floor(ph.spread * r.n);
    for (const mk of r.marks) if (markState(r, mk, ph)[0] === 2) moved += 1;
  }
  setText(L.in, String(received));
  setText(L.moved, String(moved));
  const show = (el, on) => setStyle(el, 'visibility', on ? '' : 'hidden');
  show(L.rows[0], ot >= 0.4);
  show(L.rows[1], ot >= OP.usedAt); show(L.drop, ot >= OP.usedAt); show(L.split, ot >= OP.splitAt);
  show(L.rows[2], ot >= OP.flowAt); show(L.ops, ot >= OP.movedSplitAt);
  // Annotations: two thin lines, 0.3 s each, then their words; they fade as the ledger settles.
  els.anno.forEach((node, k) => {
    const start = OP.annoAt + k * (OP.annoDur + 0.05), q = clamp((ot - start) / OP.annoDur), out = 1 - clamp((ot - OP.settleAt) / 0.4);
    setStyle(node.firstElementChild, 'transform', `scaleX(${easeOut(q).toFixed(3)})`);
    setStyle(node, 'opacity', op1(out));
    setStyle(node.lastElementChild, 'visibility', q >= 1 ? '' : 'hidden');
  });
  // 收束: the three numbers drop into the bottom row's cells, each into its own column; the rest of the ledger fades.
  const k = easeOut((ot - OP.settleAt) / OP.settleDur);
  const fly = (el, target) => {
    if (k <= 0 || !target) { setStyle(el, 'transform', ''); return; }
    const a = el.getBoundingClientRect(), b = target.getBoundingClientRect();
    if (!el._from) el._from = { x: a.left, y: a.top, h: a.height };
    const f = el._from, s = lerp(1, b.height / f.h, k);
    setStyle(el, 'transform', `translate(${((b.left - f.x) * k).toFixed(1)}px, ${((b.top - f.y) * k).toFixed(1)}px) scale(${s.toFixed(3)})`);
  };
  fly(L.in, els.t.in);
  fly(L.used, els.total.querySelector('.n-t-used'));
  fly(L.moved, els.t.moved);
  const rest = 1 - clamp((ot - OP.settleAt) / 0.3);
  for (const el of [...L.box.querySelectorAll('.n-l > span, .n-l > small, .n-l-sub')]) setStyle(el, 'opacity', op1(rest));
  setStyle(L.box, 'visibility', ot >= OP.end - 0.02 ? 'hidden' : '');
  // The brace (du Bois' total bar) draws in 0.4 s from the start of 收束.
  setStyle(els.brace, 'strokeDashoffset', String((1 - easeOut((ot - OP.settleAt) / OP.braceDur)).toFixed(3)));
  paintTicks(rowsWritten(t));
}
const rowsWritten = t => { let lit = -1; for (let i = 0; i <= stage.index; i += 1) if (phaseOf(i, t).counted) lit = i; return lit; };

// du Bois' total bar: a brace under the 收到 column gathers every row's bar into the bottom row's one.
function braceGeometry() {
  if (!els.brace || !geo) return;
  const g = geo, x0 = g.x.inputs + 1, x1 = x0 + g.barW, xm = (x0 + x1) / 2;
  const y0 = g.totalY - 8.5, y1 = y0 + 3.5, y2 = y1 + 3.5, r = 4;
  els.brace.setAttribute('d', `M${x0},${y0} Q${x0},${y1} ${x0 + r},${y1} L${xm - r},${y1} Q${xm},${y1} ${xm},${y2} Q${xm},${y1} ${xm + r},${y1} L${x1 - r},${y1} Q${x1},${y1} ${x1},${y0}`);
}

// ---------- painting: the canvas (grains, ash, traces; the adopted grains in ink belong to the information layer) ----------
let dirty = true, lastKey = '';
function paintCanvas(t) {
  const g = geo, now = stage.index, F = focusOf(), dim = X.dim, ot = openingTime();
  ctx.clearRect(0, 0, g.W, g.H);
  const info = 1 - 0.3 * dim, concept = 1 - 0.6 * dim;
  const traced = F?.kind === 'item' ? F.id : F?.kind === 'ask' ? F.item : null;
  // While the information layer acts (a hard cut), the concept layer drops to 60 % for 300 ms.
  const duck = ot == null ? 1 : [0.4, OP.usedAt, OP.splitAt, OP.flowAt, OP.movedSplitAt, OP.asksAt, OP.settleAt].some(a => ot >= a && ot < a + 0.3) ? 0.6 : 1;
  const pop = X.popId && X.pop > 0 ? parseId(X.popId) : null;
  for (let i = 0; i <= LAST; i += 1) {
    if (i > now && !leaving.has(i)) continue;
    const r = rows[i];
    if (!r.n) continue;
    const fade = leaving.has(i) ? 1 - clamp((wall() - leaving.get(i)) / LEAVE) : 1;
    const ph = phaseOf(i, t), mid = rowMid(i);
    const mine = F?.kind === 'row' && F.i === i;
    const ia = fade * (!F || mine ? 1 : info), ca = fade * (!F || mine ? 1 : concept) * duck;
    const dx = pop?.kind === 'row' && pop.i === i ? IX.pop * X.pop : 0;
    ctx.save();
    if (dx) ctx.translate(dx, 0);
    const box = barBox(r, mid);
    // The outline keeps the round's length after the grains are judged: what was dropped shows as empty.
    const frameA = ph.s ? clamp(ph.j / 0.3) : 1;
    if (frameA > 0) { ctx.strokeStyle = rgba(C.ink3, 0.75 * frameA * ia); ctx.lineWidth = 0.75; ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0); }
    // Your own inputs: vermilion on the top edge, as long as their share of the bar.
    if (r.self && ph.counted) { ctx.fillStyle = rgba(C.verm, ia); ctx.fillRect(box.x0, box.y0 - 2, Math.max(2, (r.self / r.n) * (box.x1 - box.x0)), 2); }
    const placed = ph.counted ? r.n : Math.floor(ph.spread * r.n);
    // Judged grains in ink grow a little so the adopted part reads as ink at 1×, still one grain per input.
    const d = g.d, dInk = g.u <= 3 ? Math.min(g.u - 0.45, d * 1.25) : d, ash = Math.max(1, d * 0.55), ashY = box.y1 + 2.5;
    const pushed = traced ? new Set(r.particles.filter(q => q.chain.includes(traced)).map(q => q.p)) : null;
    for (let k = 0; k < placed; k += 1) {
      const q = r.particles[k], o = pos(k, mid);
      if (q.disp === 'used') {
        const c = ph.s ? clamp(ph.j / ph.s.compactDur) : 1, e = ph.s ? easeOutBack(c) : 1;
        const target = pos(q.a, mid), x = lerp(o.x, target.x, e), y = lerp(o.y, target.y, e);
        const alpha = pushed ? (pushed.has(q.p) ? fade : ia) : ia;
        const size = lerp(d, dInk, c);
        ctx.fillStyle = c > 0 ? rgba(mix(GREY, C.ink, c), lerp(ca * 0.9, alpha, c)) : rgba(GREY, 0.9 * ca);
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      } else if (q.disp === 'deferred') {
        const s = ph.s ? easeOut(ph.j / ph.s.sinkDur) : 1, size = lerp(d, ash, s);
        ctx.fillStyle = rgba(GREY, lerp(0.9, 0.6, s) * ca);
        ctx.fillRect(o.x - d / 2, lerp(o.y - d / 2, ashY, s), d, size);
      } else {
        const a = ph.s ? 1 - clamp(ph.j / ph.s.fadeDur) : 0;
        if (a > 0) { ctx.fillStyle = rgba(GREY, 0.9 * a * ca); ctx.fillRect(o.x - d / 2, o.y - d / 2, d, d); }
      }
    }
    // Beat 3: each adopted grain sends a trace along its row to the mark of the item it went into (or into ▼/◇, or fades
    // before the column when its item did not change this round). The grains themselves stay in the bar.
    if (ph.s && ph.f > 0 && ph.f < ph.s.jitter + ph.s.flowDur + ph.s.trail + 0.05) {
      ctx.lineWidth = Math.min(1.2, Math.max(0.6, d * 0.45));
      for (const q of r.particles) {
        if (q.disp !== 'used') continue;
        const ts = q.u * ph.s.jitter, tau = (ph.f - ts) / ph.s.flowDur;
        if (tau <= 0) continue;
        const from = pos(q.a, mid);
        const toX = q.dest.kind === 'mark' ? g.x.ops + r.markOf.get(q.dest.id)._x + r.layout.pitch / 2 : q.dest.kind === 'quiet' ? g.x.ops + r.layout.quietX + 6 : g.x.ops - 6;
        const head = easeInOut(tau), hx = lerp(from.x, toX, head), hy = lerp(from.y, mid, head * head);
        const after = tau > 1 ? 1 - clamp((ph.f - ts - ph.s.flowDur) / ph.s.trail) : 1;
        const lost = q.dest.kind === 'none' ? 1 - clamp((tau - 0.55) / 0.45) : 1;
        const alpha = after * lost * ca * (pushed && !pushed.has(q.p) ? 0.5 : 1);
        if (alpha <= 0.01) continue;
        ctx.strokeStyle = rgba(GREY, 0.2 * alpha);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(hx, hy); ctx.stroke();
        if (tau < 1) { ctx.strokeStyle = rgba(GREY, 0.75 * alpha); ctx.beginPath(); ctx.moveTo(Math.max(from.x, hx - 10), lerp(from.y, mid, Math.max(0, head - 0.06) ** 2)); ctx.lineTo(hx, hy); ctx.stroke(); }
      }
    }
    ctx.restore();
  }
  // The bottom row's bar, to its own scale: adopted in ink, deferred as ash under it, the rest empty.
  const tot = totalsNow(t), showing = ot == null || ot >= OP.settleAt;
  if (showing && tot.n) {
    const k = ot == null ? 1 : easeOut((ot - OP.settleAt) / OP.settleDur), mid = g.totalY + g.TOTAL / 2 - 4, h = g.L * g.u;
    const x0 = g.x.inputs + 0.5, w = g.barW * k;
    const a = !F || F.kind === 'total' ? 1 : info;
    const tdx = X.popId === 'total' ? IX.pop * X.pop : 0;
    ctx.save(); ctx.translate(tdx, 0);
    ctx.strokeStyle = rgba(C.ink3, 0.75 * a); ctx.lineWidth = 0.75; ctx.strokeRect(x0, mid - h / 2 - 0.5, w + 1, h + 1);
    ctx.fillStyle = rgba(C.ink, a); ctx.fillRect(x0 + 1, mid - h / 2 + 0.5, w * (tot.used / tot.n), h - 1);
    ctx.fillStyle = rgba(GREY, 0.75 * a); ctx.fillRect(x0 + 1 + w * (tot.used / tot.n), mid + h / 2 + 2.5, w * (tot.deferred / tot.n), Math.max(1, g.d * 0.55));
    ctx.restore();
  }
}

// ---------- interaction (ix.mjs): a row is “这一轮”, a mark “这一件”; the detail is the side panel ----------
const figOff = () => ({ x: figure.offsetLeft, y: figure.offsetTop });
const inStage = (x, y) => { const o = figOff(); return { x: x + o.x, y: y + o.y }; };
const visibleRow = i => i <= stage.index && i >= 0;
function has(id) {
  const f = parseId(id);
  if (!f) return false;
  const t = nowT();
  if (f.kind === 'total') return !opening;
  if (!visibleRow(f.i)) return false;
  const r = rows[f.i], ph = phaseOf(f.i, t);
  if (f.kind === 'row') return !ph.s || t >= ph.s.spreadAt;
  if (f.kind === 'item') { const m = r.markOf.get(f.id); return m ? markState(r, m, ph)[0] > 0 : r.opOf.has(f.id) && quietState(r, ph); }
  return ph.asks && Boolean(askOf(f.id, f.i));
}
function named(name) {
  if (name == null) return null;
  name = String(name);
  if (parseId(name)) return has(name) ? name : null;
  if (['total', '两周', '合计', '到此刻'].includes(name)) return has('total') ? 'total' : null;
  const fi = frames.findIndex(f => f.id === name);
  if (fi >= 0) return has(`row:${fi}`) ? `row:${fi}` : null;
  // An item by id or short name: its latest change up to 此刻.
  const id = opsOf.has(name) ? name : [...opsOf.keys()].find(x => shortOf(x) === name);
  const hit = id && (opsOf.get(id) || []).filter(x => x.i <= stage.index).sort((a, b) => MOVED.includes(b.op) - MOVED.includes(a.op) || b.i - a.i)[0];
  return hit && has(`item:${id}@${hit.i}`) ? `item:${id}@${hit.i}` : null;
}
function hit(x, y) {
  const o = figOff(), fx = x - o.x, fy = y - o.y;
  if (fx < 0 || fx > geo.W || fy < geo.HEAD) return null;
  if (fy >= geo.totalY && fy <= geo.totalY + geo.TOTAL) return has('total') ? 'total' : null;
  const i = Math.floor((fy - geo.HEAD) / geo.rowH);
  return i >= 0 && i <= LAST && has(`row:${i}`) ? `row:${i}` : null;
}
// Where things are on the stage (the body holding the score and the side panel).
function markRect(id) {
  const el = score.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!el) return null;
  const b = body.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x0: r.left - b.left, y0: r.top - b.top, x1: r.right - b.left, y1: r.bottom - b.top };
}
function anchorOf(id) {
  const f = parseId(id), g = geo;
  if (f.kind === 'total') {
    const y = g.totalY;
    return { from: inStage(g.x.inputs + g.barW + 2, y + g.TOTAL / 2 - 4), top: inStage(0, y).y, bottom: inStage(0, y + g.TOTAL).y, start: g.x.inputs + g.barW + 40 };
  }
  const top = inStage(0, rowTop(f.i)).y, bottom = top + g.rowH;
  if (f.kind === 'row') {
    const r = rows[f.i], x = r.n ? countX(r) + textWidth(String(r.n), 9.5) + 1 : g.x.inputs + 90;
    return { from: inStage(x, rowMid(f.i)), top, bottom, start: x };
  }
  const rect = markRect(id);
  if (!rect) return { from: inStage(g.x.ops, rowMid(f.i)), top, bottom, start: g.x.ops };
  return { from: { x: (rect.x0 + rect.x1) / 2, y: rect.y0 }, top, bottom, rect, start: rect.x1 - figOff().x };
}
function pointOf(id) {
  const f = parseId(id);
  if (!f) return null;
  if (f.kind === 'row') {
    const r = rows[f.i];
    return inStage(r.n ? geo.x.inputs + 1 + barLen(r) / 2 : geo.x.inputs + 40, rowMid(f.i));
  }
  if (f.kind === 'total') return inStage(geo.x.inputs + geo.barW / 2, geo.totalY + geo.TOTAL / 2 - 4);
  const rect = markRect(id) || (f.kind === 'item' ? markRect(`row:${f.i}`) : null);
  return rect ? { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 } : null;
}
// The summary card sits above its row (below when there is no room), level with where the row's count or mark is.
function peekPlace(id, w, h) {
  const a = anchorOf(id), o = figOff();
  const B = { x0: o.x + 4, x1: o.x + geo.W - 4, y0: o.y + 2, y1: o.y + geo.H - 2 };
  const x = clamp(a.from.x - 30, B.x0, B.x1 - w);
  let y = a.top - 10 - h;
  if (y < B.y0) y = a.bottom + 10;
  y = clamp(y, B.y0, B.y1 - h);
  return { x, y, from: a.from };
}
// The detail is the side panel: the card takes the panel's place and unfolds from where the leader meets its left edge.
// A row's leader runs from its count along the row's baseline; an item's leader runs to the trace column, up and down
// through every round it changed in (lighting their circles), and leaves from 此刻's row for the panel.
function detailPlace(id, el) {
  const f = parseId(id);
  if (!f) return null;
  const x = side.offsetLeft, y = side.offsetTop, w = side.offsetWidth, h = side.offsetHeight;
  el.style.width = `${w}px`; el.style.height = `${h}px`; el.style.maxHeight = `${h}px`;
  const g = geo, o = figOff(), base = i => o.y + rowTop(i) + g.rowH - 3.5;
  let path;
  leader = null;
  if (f.kind === 'row' || f.kind === 'total' || f.kind === 'ask') {
    const a = anchorOf(id), yb = f.kind === 'total' ? o.y + g.totalY + g.TOTAL - 4 : base(f.i);
    const sx = (f.kind === 'ask' ? a.rect?.x1 ?? a.from.x : o.x + a.start) + IX.pop;
    path = [{ x: sx, y: yb }, { x, y: yb }];
  } else {
    const rect = markRect(id), now = stage.index, tx = o.x + g.x.trace + g.cols.trace / 2;
    const marked = (opsOf.get(f.id) || []).filter(m => m.i <= now).map(m => m.i);
    const top = Math.min(f.i, ...marked), mid = o.y + rowMid(f.i), yTop = o.y + rowMid(top), yNow = base(now);
    path = [{ x: (rect ? rect.x1 : tx - 10) + IX.pop, y: mid }, { x: tx, y: mid }];
    if (yTop < mid - 0.5) path.push({ x: tx, y: yTop });
    path.push({ x: tx, y: yNow }, { x, y: yNow });
    // How far along the path each marked row's circle is first reached.
    const pts = path, lens = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k].x, p.y - pts[k].y));
    const passes = [];
    for (const i of marked) {
      const yi = o.y + rowMid(i);
      let s = 0;
      for (let k = 0; k < lens.length; k += 1) {
        const a = pts[k], b = pts[k + 1];
        if (Math.abs(a.x - tx) < 0.5 && Math.abs(b.x - tx) < 0.5 && (yi - a.y) * (yi - b.y) <= 0) { passes.push({ i, at: s + Math.abs(yi - a.y) }); break; }
        s += lens[k];
      }
    }
    leader = { passes, length: lens.reduce((s, v) => s + v, 0) };
  }
  return { x, y, w, h, path };
}

// ---------- what the cards say ----------
const chip = (id, i) => `<span class="n-chip" role="button" tabindex="0" data-pin="${esc(id)}" data-id="item:${esc(id)}@${i}" style="--c:${colorOf(id)}">${esc(shortOf(id))}</span>`;
const answerHref = i => withDataset(`../../index.html?variant=d&frame=${i}`);
const answeredBy = ask => {
  for (let k = LAST; k >= 0; k -= 1) for (const e of frames[k].events) for (const link of e.feedback || []) if (link.ask === ask.id) return responseSentence(e, link);
  return '你答了';
};
/** How a question stopped being open in round i, in words. */
function lapseWord(ask, i) {
  const item = records[i].snapshot.items[ask.item];
  const again = askLife[i].fresh.find(a => a.prompt === ask.prompt);
  if (item?.status === 'merged') return `所属事项并入了「${shortOf(item.merged_into)}」${again ? '，同一问以新 id 重新登记' : '，没有重新登记'}`;
  if (!item || item.status === 'withdrawn') return '所属事项撤下了，问题随之失效';
  return again ? '事项改写后以新 id 重新登记' : '事项改写后没有重新登记';
}
const dueOf = ask => (ask.due_at ? dueText(Date.parse(ask.due_at)) : '');
const rowWhen = i => `${frames[i].id} · ${dayTime(frames[i].at)}`;

function facts(id) {
  const f = parseId(id);
  if (!f) return { i: stage.index, short: '', asks: [] };
  if (f.kind === 'total') return { ...f, i: stage.index, short: stage.index === LAST ? '两周合计' : '到此刻合计', asks: [] };
  if (f.kind === 'row') return { ...f, short: `这一轮 ${frames[f.i].id}`, asks: [] };
  if (f.kind === 'ask') { const a = askOf(f.id, f.i); return { ...f, item: a?.item, short: a ? a.short || a.prompt : '问题', asks: [] }; }
  return { ...f, short: shortOf(f.id), asks: [] };
}
// The beats a card may speak of while the opening or a new row is still being written.
function seenFor(id) {
  const f = parseId(id);
  if (!f || f.kind === 'total') return { inputs: true, share: true, asks: true };
  const ph = phaseOf(f.i, nowT());
  return { inputs: ph.counted, share: !ph.s || ph.judged, asks: ph.asks };
}

function rowPeek(i, seen) {
  const r = rows[i];
  const lines = [`<div class="ix-k">这一轮 · ${esc(rowWhen(i))}</div>`];
  if (!r.n) lines.push(`<div class="ix-d">${i === 0 ? '空状态，还没有输入' : '窗口内没有新输入，这是一次定时整理'}</div>`);
  else if (!seen.inputs) lines.push('<div class="ix-d">这一轮的输入还在写</div>');
  else {
    const drop = r.n - r.counts.used;
    lines.push(`<div class="n-pk">收到 <b>${r.n}</b>${seen.share ? ` · 采用 <b>${r.counts.used}</b> · 没采用 ${drop}${drop ? `<small>（${['deferred', 'noise', 'duplicate', 'unjudged'].filter(d => r.counts[d]).map(d => `${dispWord[d]} ${r.counts[d]}`).join(' · ')}）</small>` : ''}` : ' · <small>这一轮的判断还没出来</small>'}${r.self ? ` · <span class="n-you">来自你 ${r.self} 条</span>` : ''}</div>`);
  }
  if (!seen.asks) lines.push('<div class="ix-d">这一轮的改动还没落定</div>');
  else {
    const listed = r.marks.slice(0, 6).map(m => `${opGlyph[m.op]}${esc(shortOf(m.id))}`).join(' ');
    lines.push(`<div class="n-pk">动了 <b>${r.moved}</b> 处${r.moved ? `：${listed}${r.moved > 6 ? ` 等` : ''}` : ''}${r.quiet ? `<small>，另有 ${[r.ops.down.length ? `▼${r.ops.down.length}` : '', r.ops.same.length ? `◇${r.ops.same.length}` : ''].filter(Boolean).join(' ')}</small>` : ''}</div>`);
    const asks = [...r.life.fresh.map(a => `◆ ${esc(a.short || a.prompt)}`), ...r.life.lapsed.map(a => `<span class="n-lapsed">◇</span> ${esc(a.short || a.prompt)}`), ...r.life.answered.map(a => `<span class="n-you">↩</span> ${esc(a.short || a.prompt)}`)];
    lines.push(`<div class="n-pk">问题：${asks.length ? asks.slice(0, 3).join('　') + (asks.length > 3 ? ` 等 ${asks.length} 个` : '') + ' · ' : ''}此刻开着 ${r.life.open.size} 个</div>`);
  }
  const md = mediansTo(stage.index);
  // The comparison is only drawn once every row has been written (it would tell what the opening has not shown yet).
  if (r.n && md.rounds >= 3 && !opening) lines.push(`<div class="n-pk-c">对照${stage.index === LAST ? '两周' : `到此刻 ${md.rounds} 轮`}中位：收到 ${num(md.n)} · 采用率 ${pct(md.rate)} · 动了 ${num(md.moved)} 处</div>`);
  return lines.join('');
}
function itemPeek(id, i, seen) {
  const r = rows[i], op = r.opOf.get(id), x = r.ops[op]?.find(o => o.id === id);
  const shares = x?.before != null && x?.after != null && x.before !== x.after ? ` ${x.before} → ${x.after} 份` : x?.after != null && op === 'new' ? ` ${x.after} 份` : '';
  const into = r.particles.filter(q => q.chain.includes(id));
  const by = {};
  for (const q of into) by[q.source] = (by[q.source] || 0) + 1;
  const now = stage.index, open = [...askLife[now].open.values()].filter(a => chainAt(now, a.item).includes(id));
  const moves = (opsOf.get(id) || []).filter(m => m.i <= now && MOVED.includes(m.op)).length;
  return `<div class="ix-k">这一件 · ${esc(frames[i].id)} · ${esc(opWord[op] || '')}</div>
    <div class="ix-q">${esc(shortOf(id))} · ${esc(opWord[op] || '')}${esc(shares)}</div>
    <div class="ix-d">${!seen.inputs ? '本轮的输入还在写' : into.length ? `本轮进了它 ${into.length} 条：${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · ')}` : '本轮没有输入直接推动它'}</div>
    ${open.slice(0, 2).map(a => `<div class="n-pk-ask"><b>◆</b><span>${esc(a.short || a.prompt)}</span>${dueOf(a) ? `<small>${esc(dueOf(a))}</small>` : ''}</div>`).join('')}
    <div class="ix-d">${now === LAST ? '两周里' : '到此刻'}动过 ${moves} 次</div>`;
}
function askPeek(id, i) {
  const a = askOf(id, i), r = rows[i];
  if (!a) return '<div class="ix-d">没有这个问题</div>';
  const state = r.life.fresh.some(x => x.id === id) ? ['◆', '新登记'] : r.life.answered.some(x => x.id === id) ? ['↩', `你答了：${answeredBy(a)}`] : ['◇', `失效：${lapseWord(a, i)}`];
  return `<div class="ix-k">问题 · ${esc(frames[i].id)} · ${esc(state[1].split('：')[0])}</div><div class="ix-q">${esc(a.prompt)}</div>
    <div class="ix-d">所属 ${esc(shortOf(a.item))}${dueOf(a) ? ` · ${esc(dueOf(a))}` : ''}</div><div class="ix-d">${esc(state[0])} ${esc(state[1])}</div>`;
}
function totalPeek() {
  const now = stage.index, c = cum[now], ex = extremesTo(now), rest = c.n - c.used;
  return `<div class="ix-k">${now === LAST ? '两周' : '到此刻'} · ${c.rounds} 轮合计</div>
    <div class="n-pk">收到 <b>${c.n}</b> → 采用 <b>${c.used}</b>（${c.n ? pct(c.used / c.n) : '—'}）→ 动了 <b>${c.moved}</b> 处</div>
    <div class="n-pk"><small>没采用 ${rest} = ${['deferred', 'noise', 'duplicate', 'unjudged'].filter(d => c[d]).map(d => `${dispWord[d]} ${c[d]}`).join(' + ')}</small></div>
    <div class="n-pk"><small>${MOVED.map(op => `${opGlyph[op]}${c[op]}`).join(' ')} · 另有 ▼${c.down} ◇${c.same}</small></div>
    ${ex ? `<div class="n-pk-c">收得最多 ${esc(frames[ex.inMost.i].id)} ${ex.inMost.n} 条 → ${ex.inMost.moved} 处 · 动得最多 ${esc(frames[ex.movedMost.i].id)} ${ex.movedMost.moved} 处 ← ${ex.movedMost.n} 条</div>` : ''}`;
}
function peekFor(f, { seen }) {
  if (f.kind === 'row') return rowPeek(f.i, seen);
  if (f.kind === 'item') return itemPeek(f.id, f.i, seen);
  if (f.kind === 'ask') return askPeek(f.id, f.i);
  return totalPeek();
}

const closeButton = '<button type="button" class="st-unpin" data-x="close" title="收回（Esc）" aria-label="收回（Esc）">×</button>';
const sideHTML = (kicker, title, bodyHTML, closable) => `<div class="st-side-kicker"><span>${kicker}</span>${closable ? closeButton : ''}</div><h2>${title}</h2>${bodyHTML}`;
function asksSection(i, href) {
  const r = rows[i], open = [...r.life.open.values()], fresh = new Set(r.life.fresh.map(a => a.id));
  const line = (glyph, cls, a, tail) => `<li><b class="${cls}">${glyph}</b><span>${esc(a.prompt)}<small>${chip(a.item, i)}${dueOf(a) ? ` · ${esc(dueOf(a))}` : ''}</small>${tail}</span></li>`;
  const list = [
    ...open.map(a => line(fresh.has(a.id) ? '◆' : '·', fresh.has(a.id) ? 'n-fresh' : 'n-open', a, href ? `<a class="n-answer" href="${esc(href)}">去回答 →</a>` : '')),
    ...r.life.answered.map(a => line('↩', 'n-you', a, `<em class="n-closed">${esc(answeredBy(a))}</em>`)),
    ...r.life.lapsed.map(a => line('◇', 'n-lapsed', a, `<em class="n-closed">失效：${esc(lapseWord(a, i))}</em>`)),
  ];
  return list.length ? `<section><h4>问题 <small>此刻开着 ${open.length} 个${fresh.size ? ` · 本轮新登记 ${fresh.size}` : ''}</small></h4><ul class="n-asklist">${list.join('')}</ul></section>`
    : '<p class="st-muted">这一轮之后没有开着的问题，也没有登记、失效或答掉的问题。</p>';
}
/** “这一轮”: the side panel's default (此刻) and, expanded, the open row. */
function roundHTML(i, { expanded = false } = {}) {
  const r = rows[i], f = frames[i], sig = f.signal;
  const window = sig?.window ? `${formatTime(sig.window.from)}–${formatTime(sig.window.to)}` : '';
  const md = mediansTo(stage.index);
  const chips = list => list.map(x => `${chip(x.id, i)}${x.before != null && x.after != null && x.before !== x.after ? `<small>${x.before}→${x.after}</small>` : ''}`).join(' ');
  const opsBlock = ALL_OPS.filter(op => r.ops[op].length).map(op => `<li><b>${opGlyph[op]} ${opWord[op]} ${r.ops[op].length}</b><span class="n-chips">${chips(r.ops[op])}</span></li>`).join('');
  const responses = responsesIn(i), linked = new Set(responses.map(x => x.event.id));
  const unlinked = f.events.filter(e => isSelf(e) && !linked.has(e.id));
  const acct = r.n ? `<section class="n-acct"><h4>这一轮的账</h4>
      <p class="n-flow">收到 <b>${r.n}</b> → 采用 <b>${r.counts.used}</b> → 其中 <b>${r.toMarks}</b> 条进了动了的那几件 → 动了 <b>${r.moved}</b> 处</p>
      ${md.rounds >= 3 ? `<p class="st-muted">${stage.index === LAST ? '两周' : `到此刻 ${md.rounds} 轮`}中位：收到 ${num(md.n)} · 采用 ${num(md.used)}（${pct(md.rate)}）· 动了 ${num(md.moved)} 处</p>` : ''}</section>` : '';
  // Expanded: which inputs went into each moved item.
  const pushed = expanded && r.marks.some(m => m.pushers.length) ? `<section><h4>进了动了的那几件 <small>${r.toMarks} 条</small></h4><ul class="n-pushed">${r.marks.filter(m => m.pushers.length).map(m => {
    const list = m.pushers.map(p => r.particles[p]);
    return `<li><b>${opGlyph[m.op]}</b>${chip(m.id, i)}<small>← ${list.length} 条</small>${list.slice(0, 3).map(q => `<span>${esc(q.source)} · ${esc(q.title.slice(0, 34))}${q.title.length > 34 ? '…' : ''}</span>`).join('')}</li>`;
  }).join('')}</ul></section>` : '';
  const bodyHTML = `${f.narrative ? `<p class="n-narr">${esc(f.narrative)}</p>` : ''}${acct}
    <section><h4>收到 <small>${r.n} 条${sig?.reason ? ` · ${esc(sig.reason)}` : ''}</small></h4>
      ${r.n ? `<p class="n-split">${DISPOSITIONS.filter(d => r.counts[d]).map(d => `<span><i class="n-sw n-${d}"></i>${dispWord[d]} ${r.counts[d]}</span>`).join('')}</p>
      ${Object.keys(r.streams).length ? `<p class="st-muted">${Object.entries(r.streams).map(([s, n]) => `${streamWord[s] || s} ${n}${expanded ? `（采用 ${r.usedBy[s] || 0}）` : ''}`).join(' · ')}${sig?.coverage && /另有/.test(sig.coverage) ? `（${esc(sig.coverage.match(/（(.*)）/)?.[1] || '')}）` : ''}</p>` : ''}` : `<p class="st-muted">${i === 0 ? '空状态，还没有输入。' : '窗口内没有新输入，这是一次定时整理。'}</p>`}
    </section>
    ${r.self || r.annotations.length ? `<section class="n-yours"><h4>来自你 <small>${r.self} 条输入${r.annotations.length ? ` · ${r.annotations.length} 条批注` : ''}</small></h4>
      ${responses.length ? `<ul class="n-acts">${foldSentences(responses).map(x => `<li>${esc(x.label)}${x.item ? ` ${chip(x.item, i)}` : ''}${x.first.link.ask ? '<small>答登记的问题</small>' : ''}</li>`).join('')}</ul>` : ''}
      ${unlinked.length ? `<p class="st-muted">${unlinked.length} 条你自己的输入没有指向事项的动作（发帖、评论别处的讨论${unlinked.some(e => e.stream === 'family') ? '、家里的消息' : ''}等）。</p>` : ''}
      ${r.annotations.map(a => `<p class="n-annot">✎「${esc(a.text)}」</p>`).join('')}</section>` : ''}
    ${opsBlock ? `<section><h4>改动 <small>悬停名字看它在每一轮的记号，点击展开这一件</small></h4><ul class="n-opslist">${opsBlock}</ul></section>` : ''}
    ${pushed}
    ${asksSection(i, i === stage.index ? answerHref(i) : '')}
    <section><h4>回执</h4><p>${!r.receipt ? '没有提交批次。' : r.receipt.type === 'checked' ? `检查后状态不变（${esc(r.receipt.revision)}），不伪造新进展。` : `${esc(r.receipt.revision)}${r.receipt.acknowledges?.length ? ` · 确认了 ${r.receipt.acknowledges.length} 条批注` : ''}`}</p></section>`;
  return { kicker: `这一轮 · ${esc(f.id)} · ${esc(records[i].state.revision)}${window ? ` · 窗口 ${window}` : ''}`, title: esc(f.title), body: bodyHTML };
}
/** “这一件”: an item as of 此刻, opened from its mark in round `from` (or from a question on it). */
function itemHTML(id, from, { askFirst = null } = {}) {
  const now = stage.index, item = records[now].snapshot.items[id] || records[from].snapshot.items[id];
  const r = rows[from], op = r.opOf.get(id), x = r.ops[op]?.find(o => o.id === id);
  const moves = (opsOf.get(id) || []).filter(m => m.i <= now);
  // Shares by round: this item's own share each round (0 when it is not active); 此刻 in ink, later rounds faint.
  const trend = frames.map((_, k) => { const it = records[k].snapshot.items[id]; return it && it.status === 'active' ? it.share : 0; });
  const W = 280, H = 30, top = Math.max(8, ...trend), bw = W / LAST;
  const bars = trend.slice(1).map((s, k) => { const h = s ? Math.max(1.5, (s / top) * (H - 2)) : 1; return `<rect x="${(k * bw + bw * 0.15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" class="${k + 1 === now ? 'is-now' : k + 1 > now ? 'is-later' : s ? '' : 'is-off'}"/>`; }).join('');
  const into = r.particles.filter(q => q.chain.includes(id)), groups = new Map();
  for (const q of into) { if (!groups.has(q.source)) groups.set(q.source, []); groups.get(q.source).push(q); }
  const open = [...askLife[now].open.values()].filter(a => chainAt(now, a.item).includes(id));
  const askBlock = `<section><h4>开着的问题 <small>${open.length ? `${open.length} 个 · 此刻` : '此刻没有'}</small></h4>${open.length ? `<ul class="n-asklist">${open.map(a => `<li><b class="n-fresh">◆</b><span>${esc(a.prompt)}<small>${esc(dueOf(a) || '没有期限')}</small><a class="n-answer" href="${esc(answerHref(now))}">去回答 →</a></span></li>`).join('')}</ul>` : ''}</section>`;
  const askOne = askFirst ? (() => {
    const a = askOf(askFirst, from), rr = rows[from];
    if (!a) return '';
    const state = rr.life.fresh.some(q => q.id === a.id) ? (askLife[now].open.has(a.id) ? `新登记，此刻还开着` : '新登记，此刻已关上') : rr.life.answered.some(q => q.id === a.id) ? `你答了：${answeredBy(a)}` : `失效：${lapseWord(a, from)}`;
    const live = askLife[now].open.has(a.id);
    return `<section class="n-askone"><h4>问题 <small>${esc(frames[from].id)}</small></h4><p><b>${esc(a.prompt)}</b></p><p class="st-muted">${esc(state)}${dueOf(a) ? ` · ${esc(dueOf(a))}` : ''}</p>${live ? `<p><a class="n-answer" href="${esc(answerHref(now))}">去回答 →</a></p>` : ''}</section>`;
  })() : '';
  const lead = `${askOne}
    <section><h4>这一次 <small>${esc(rowWhen(from))}</small></h4><p><b>${esc(opGlyph[op] || '')} ${esc(opWord[op] || '没有改动')}</b>${x?.before != null && x?.after != null && x.before !== x.after ? ` · ${x.before} → ${x.after} 份` : x?.after != null ? ` · ${x.after} 份` : ''}</p>
      ${into.length ? `<ul class="n-into">${[...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 4).map(([s, list]) => `<li><small>${esc(s)} · ${list.length} 条</small>${list.slice(0, 2).map(q => `<span>${esc(q.title.slice(0, 40))}${q.title.length > 40 ? '…' : ''}</span>`).join('')}</li>`).join('')}</ul>` : '<p class="st-muted">这一轮没有输入直接推动它。</p>'}</section>
    ${askFirst ? '' : askBlock}
    <section><h4>份额 · 逐轮 <small>此刻 ${trend[now]} 份</small></h4><svg class="ix-trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg></section>
    <section><h4>在每一轮 <small>${moves.length} 次改动</small></h4><ul class="n-hist">${moves.slice(-12).map(m => `<li class="${m.i === from ? 'is-now' : ''}"><button type="button" data-st="go" data-frame="${m.i}"><time>${esc(dayTime(frames[m.i].at))}</time></button><b>${opGlyph[m.op]} ${opWord[m.op]}</b><span>${m.before != null && m.after != null && m.before !== m.after ? `${m.before} → ${m.after} 份` : m.after != null && m.before == null ? `${m.after} 份` : ''}</span></li>`).join('')}</ul></section>`;
  return { kicker: `这一件 · ${esc(shortOf(id))} · ${item ? esc(kindWord(item)) : '尚未出现'}`, title: `<span class="n-title-chip" style="--c:${colorOf(id)}"></span>${esc(titleAt(id, now))}`, body: itemDetailHTML(id, now, { lead }) };
}
function totalSideHTML() {
  const now = stage.index, c = cum[now], ex = extremesTo(now), list = rows.slice(1, now + 1);
  const byStream = {};
  for (const r of list) for (const [s, n] of Object.entries(r.streams)) { byStream[s] = byStream[s] || { n: 0, used: 0 }; byStream[s].n += n; byStream[s].used += r.usedBy[s] || 0; }
  const start = list[0] ? Date.parse(frames[list[0].i].at) : 0, week = r => Math.floor((Date.parse(frames[r.i].at) - start) / (7 * 86400000));
  const weeks = [0, 1].map(w => list.filter(r => Math.min(1, week(r)) === w)).filter(x => x.length);
  const sum = (rs, f) => rs.reduce((s, r) => s + f(r), 0);
  const rowLink = r => `<button type="button" data-st="go" data-frame="${r.i}">${esc(frames[r.i].id)} · ${esc(dayTime(frames[r.i].at))}</button>`;
  return {
    kicker: `${now === LAST ? '两周' : '到此刻'} · ${c.rounds} 轮`, title: `读 ${c.n} · 采用 ${c.used} · 动了 ${c.moved} 处`,
    body: `<section class="n-acct"><h4>账</h4><p class="n-flow">收到 <b>${c.n}</b> → 采用 <b>${c.used}</b>（${c.n ? pct(c.used / c.n) : '—'}）→ 其中 <b>${c.toMarks}</b> 条进了动了的那几件 → 动了 <b>${c.moved}</b> 处</p>
      <p class="st-muted">没采用 ${c.n - c.used} = ${['deferred', 'noise', 'duplicate', 'unjudged'].filter(d => c[d]).map(d => `${dispWord[d]} ${c[d]}`).join(' + ')}</p>
      <p class="st-muted">${MOVED.map(op => `${opGlyph[op]} ${opWord[op]} ${c[op]}`).join(' · ')}；安静的改动 ▼${c.down} ◇${c.same}</p></section>
      ${Object.keys(byStream).length ? `<section><h4>按流的采用率</h4><ul class="n-streams">${Object.entries(byStream).sort((a, b) => b[1].n - a[1].n).map(([s, v]) => `<li><span>${esc(streamWord[s] || s)}</span><b>${v.used} / ${v.n}</b><small>${pct(v.used / v.n)}</small></li>`).join('')}</ul></section>` : ''}
      ${weeks.length > 1 ? `<section><h4>两周对照</h4><ul class="n-streams">${weeks.map((rs, w) => `<li><span>第${w ? '二' : '一'}周 <small>${esc(frames[rs[0].i].id)}–${esc(frames[rs.at(-1).i].id)}</small></span><b>${sum(rs, r => r.n)} / ${sum(rs, r => r.counts.used)} / ${sum(rs, r => r.moved)}</b><small>收到 / 采用 / 动了</small></li>`).join('')}</ul></section>` : ''}
      ${ex ? `<section><h4>收得最多与动得最多</h4><ul class="n-ext"><li>收得最多 ${rowLink(ex.inMost)}<span>${ex.inMost.n} 条 → 动了 ${ex.inMost.moved} 处</span></li><li>动得最多 ${rowLink(ex.movedMost)}<span>${ex.movedMost.moved} 处 ← ${ex.movedMost.n} 条</span></li></ul></section>` : ''}
      <section><h4>问题</h4><p>◆ 新登记 ${c.fresh} · ◇ 失效 ${c.lapsed} · <span class="n-you">↩ 你答了 ${c.answered}</span></p><p class="st-muted">此刻仍开着 ${c.open} 个。</p></section>`,
  };
}
function detailFor(f) {
  const d = f.kind === 'row' ? roundHTML(f.i, { expanded: true }) : f.kind === 'item' ? itemHTML(f.id, f.i) : f.kind === 'ask' ? itemHTML(f.item, f.i, { askFirst: f.id }) : totalSideHTML();
  return sideHTML(d.kicker, d.title, d.body, true);
}
stage.setOverview(i => roundHTML(i));

// ---------- the interaction module ----------
const ix = createIx({
  stage: body, keysIn: figure,
  facts, has, hit, named, pointOf, last: LAST,
  // Hovering or opening stops the animation clock (the opening, a row being written) and holds play where it is.
  pause: () => {
    if (hold.on) return;
    hold.on = true; clock.held = true; clock.heldAt = wall();
    hold.wasPlaying = isPlaying();
    if (hold.wasPlaying) stage.pause();
  },
  resume: () => {
    if (!hold.on) return;
    hold.on = false; clock.offset += wall() - clock.heldAt; clock.held = false;
    if (hold.wasPlaying) { hold.wasPlaying = false; stage.play(); }
  },
  paused: () => hold.on,
  answerHref: () => answerHref(stage.index),
  seen: () => seenFor(ix?.s.open || ix?.s.hover || ix?.s.peek),
  peekHTML: (f, o) => peekFor(f, o), detailHTML: f => detailFor(f),
  peekPlace, detailPlace, skip: '.st-side',
  label: '谱上的行：Tab 从此刻往前逐行看这一轮的账，Enter 展开，Esc 收回',
});
// The detail card takes the side panel's place and its look.
const card = body.querySelector(':scope > .ix-detail');
card.classList.add('st-side', 'n-side');
const keyItems = () => {
  const now = stage.index, list = [];
  for (let i = now; i >= 0; i -= 1) list.push({ id: `row:${i}`, label: `${rowWhen(i)}：收到 ${rows[i].n} 条，采用 ${rows[i].counts.used}，动了 ${rows[i].moved} 处` });
  list.push({ id: 'total', label: `${now === LAST ? '两周' : '到此刻'}合计：收到 ${cum[now].n}，采用 ${cum[now].used}，动了 ${cum[now].moved} 处` });
  return list;
};

// Opening a row moves 此刻 to it (the cut at 0 s) without dropping the detail that is opening.
let lastOpen = null;
function follow() {
  const o = ix.s.open;
  if (o === lastOpen) return;
  lastOpen = o;
  const f = parseId(o);
  if (f?.kind === 'row' && f.i !== stage.index) { cutting = true; stage.go(f.i); cutting = false; }
}

// ---------- pointer and keyboard ----------
// A row after 此刻 is hidden but its time is still there: a click on it steps forward to it.
figure.addEventListener('click', event => {
  const row = event.target.closest('.n-row');
  if (row && row.classList.contains('is-future')) stage.go(Number(row.dataset.row));
});
// Chips inside the open detail open their item (the module ignores clicks inside its own card).
card.addEventListener('click', event => {
  const c = event.target.closest('[data-pin]');
  if (c) { event.stopPropagation(); ix.open(c.dataset.id); }
});
card.addEventListener('keydown', event => {
  const c = event.target.closest('[data-pin]');
  if (c && event.key === 'Enter') { event.preventDefault(); ix.open(c.dataset.id); }
});
// Chips in the side panel: Tab to them, Enter opens (a hover through ix by focus).
side.addEventListener('focusin', event => { const c = event.target.closest('[data-pin]'); if (c && has(c.dataset.id)) ix.hover(c.dataset.id, 'chip'); });
side.addEventListener('focusout', () => { if (ix.s.via === 'chip') ix.hover(null, 'now'); });
side.addEventListener('keydown', event => {
  const c = event.target.closest('[data-pin]');
  if (c && event.key === 'Enter') { event.preventDefault(); ix.open(c.dataset.id); }
});
// ↑/↓ step a row too (in a log the rows are the frames); R replays the opening up to 此刻.
stage.onKey = event => {
  if (event.key === 'r' || event.key === 'R') { replay(); return true; }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
  if (document.activeElement?.closest('.st-side')) return false;
  stage.go(stage.index + (event.key === 'ArrowUp' ? -1 : 1));
  return true;
};
stage.onEscape = () => false;
document.querySelector('.st-nav').insertAdjacentHTML('beforeend', '<button type="button" class="n-replay" data-n="replay" title="重演开场（R）" aria-label="重演开场（R）">重演</button>');
document.addEventListener('click', event => { if (event.target.closest('[data-n="replay"]')) replay(); });
// While the opening plays, any key or a click goes straight to its end.
addEventListener('keydown', event => {
  if (!opening || event.metaKey || event.ctrlKey || event.altKey) return;
  event.preventDefault(); event.stopImmediatePropagation();
  finishOpening();
}, true);
addEventListener('pointerdown', event => { if (opening && event.button === 0) finishOpening(); }, true);

function replay() {
  if (reduced()) { finishOpening(); return; }
  startOpening(stage.index);
}

// ---------- loop: draws only when something changed ----------
const perf = { on: new URLSearchParams(location.search).has('perf'), times: [], work: [], last: 0 };
function frame() {
  const t0 = performance.now();
  const t = nowT(), ot = openingTime();
  if (opening && opening.fixed == null && ot >= OP.end) finishOpening();
  for (const [i, a] of anim) if (a.kind === 'short' && t > a.t0 + SH.end) anim.delete(i);
  X = ix.frame();
  follow();
  const key = `${ot == null ? '' : ot.toFixed(3)}|${anim.size ? t.toFixed(3) : ''}|${leaving.size ? wall().toFixed(3) : ''}|${X.focus}|${X.dim.toFixed(3)}|${X.popId}|${X.pop.toFixed(3)}|${X.line.toFixed(3)}|${stage.index}`;
  if (dirty || key !== lastKey) {
    dirty = false; lastKey = key;
    paintRows(t);
    paintCanvas(t);
    if (perf.on) perf.work.push(performance.now() - t0);
  }
  // The side panel's own content steps aside while the detail takes its place: blank from the cut until the card
  // unfolds over it, back the moment the card has folded away (so the two never show half over each other).
  setStyle(sideInner, 'visibility', X.detail && (ix.s.closeAt == null || X.card > 0) ? 'hidden' : '');
  ix.paint();
  ix.sync(`${stage.index}:${opening ? 'o' : ''}`, keyItems);
  if (perf.on && (opening || anim.size)) { if (perf.last) perf.times.push(t0 - perf.last); perf.last = t0; } else perf.last = 0;
  requestAnimationFrame(frame);
}

let resizeTimer = null;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { render(); ix.relayout(); }, 120); });
render();
if (playOpening) startOpening(LAST);
else if (askedFrame && !reduced()) anim.set(stage.index, { kind: 'short', t0: T() + 0.15 });
requestAnimationFrame(frame);

// ---------- hooks for stills and checks ----------
window.foldNotation = {
  rows, cum,
  /** From the start up to 此刻 (as R does). */
  replay,
  skip: finishOpening,
  /** Hold the opening at second t (starting it when it is not playing); resume() lets it run on. */
  seek(t) { if (!opening) startOpening(stage.index); opening.fixed = clamp(t, 0, OP.end - 0.001); dirty = true; },
  resume() { if (opening && opening.fixed != null) { opening.t0 = T() - opening.fixed; opening.fixed = null; } },
  get opening() { return openingTime(); },
  /** Hold the clock dt seconds after the last row was written in (stills of the 0.9 s step); release() lets it go. */
  stepAt(dt) { clock.held = true; clock.heldAt = lastEntry + dt + clock.offset; dirty = true; },
  release() { if (clock.held && !hold.on) { clock.offset += wall() - clock.heldAt; clock.held = false; } },
  /** Round i's grains, one per input, and where each went (as foldPulse.census). */
  census(i) {
    const r = rows[i], out = { inputs: r.n, grains: r.particles.length, ...Object.fromEntries(DISPOSITIONS.map(d => [d, 0])), toMarks: 0, toQuiet: 0, dissolve: 0, marks: {}, unpushed: 0 };
    for (const q of r.particles) {
      out[q.disp] += 1;
      if (q.dest?.kind === 'mark') out.toMarks += 1; else if (q.dest?.kind === 'quiet') out.toQuiet += 1; else if (q.dest) out.dissolve += 1;
    }
    for (const m of r.marks) { out.marks[`${opGlyph[m.op]}${shortOf(m.id)}`] = m.pushers.length; if (!m.pushers.length) out.unpushed += 1; }
    out.quiet = { down: r.ops.down.length, same: r.ops.same.length, pushers: r.quietPushers.length };
    return out;
  },
  totals: i => ({ ...cum[i ?? stage.index] }),
  /** The drawn geometry of a row (its bar), the bottom row (its bar) or a mark, in page coordinates. */
  geom(name) {
    const id = named(name), f = parseId(id), box = body.getBoundingClientRect(), o = figOff();
    if (!f) return null;
    if (f.kind === 'row' || f.kind === 'total') {
      const mid = f.kind === 'total' ? geo.totalY + geo.TOTAL / 2 - 4 : rowMid(f.i), b = f.kind === 'total' ? { x0: geo.x.inputs, x1: geo.x.inputs + geo.barW, y0: mid - 4, y1: mid + 4 } : barBox(rows[f.i], mid);
      return { x0: box.left + o.x + b.x0, x1: box.left + o.x + b.x1, y0: box.top + o.y + b.y0, y1: box.top + o.y + b.y1 };
    }
    const r = markRect(id);
    return r && { x0: box.left + r.x0, x1: box.left + r.x1, y0: box.top + r.y0, y1: box.top + r.y1 };
  },
  // Interaction hooks, as foldPulse's and foldDial's (ix.mjs): hover / unhover / open / close / ixAt / ix / paused / pointOf /
  // ixState. A row by frame id (f20) or row:20, an item by id or short name (its latest change up to 此刻), 'total'.
  ...ix.hooks(),
  perf: () => {
    const ts = perf.times.slice(1), avg = ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length), p95 = list => [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.95)] || 0;
    return { frames: ts.length, fps: +(1000 / avg).toFixed(1), p95ms: +p95(ts).toFixed(1), workMs: +(perf.work.reduce((a, b) => a + b, 0) / Math.max(1, perf.work.length)).toFixed(2), workP95ms: +p95(perf.work).toFixed(2) };
  },
  resetPerf: () => { perf.on = true; perf.times = []; perf.work = []; perf.last = 0; },
};
