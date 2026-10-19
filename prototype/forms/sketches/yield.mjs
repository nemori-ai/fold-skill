// 04 让位图（完整版）：每一行是一次整理。中线左边是这一轮让出份额的事项（以及被动用的留白），
// 右边是拿到份额的事项（以及退回的留白）。根层永远 64 份，所以每行左右一样长。
// 颜色只表示事项身份；虚线框是留白；1–3 份的小额合成“其余 N 件”，可展开；↩ 是你答掉了登记的问题，○ 是问题随改写失效。
//
// 动起来（polish/yield-motion.md 第 3 节「故事」与第 4–6 步）：一轮“过账”。让出的色块从外端扫向中线，一格一份地
// 剥出灰格飞进中线的池，停 0.12 秒，再一格格吐向右翼，右翼的色块每到一格长一格；拿到等于让出的一刻平账。灰格是
// 概念层（只用灰，画在叠在图上的 canvas 里，平账后为零）；其余都是信息层，只在节拍上落定。
//   讲一遍：只在顶层直接打开、地址不带 ?frame=、也不是从别的页面链过来时演一次（composite 约 15.5 秒，停在 f26），
//     任意键跳过；工具栏的「▶ 讲一遍」可重演。带 ?frame=、嵌在画廊或合页里的一律静止在那一帧。
//   连播（空格）每轮 1.6 秒（半速过账）；←/→ 逐帧用 0.9 秒的短版；一次跳多帧沿用依次扫出；往回退只淡出。
// 交互接共用模块 motion/ix.mjs：悬停出概要卡、同一件事在每一行描边追踪；点击色块沿行向外弹出 8 px，引线接详情卡，
// 侧栏切到“这一件”。卡上的“去回答 →”只给此刻开着的问题，链到同一帧的 D。只读回放，帧号是本页常量，不改数据。
import {
  createStage, esc, frames, records, dayTime, colorOf, shortOf, titleAt, responsesIn, askById, itemDetailHTML,
  kindWord, reduced, foldSentences, askLife, rootOf, responseSentence,
} from './stage.mjs';
import { dayOf, weekdayOf, at, textWidth, personName } from './kit.mjs';
import { createIx, IX } from '../motion/ix.mjs';
import { dueText } from '../motion/dial-model.mjs';
import { withDataset, currentDataset } from '../../data/select.mjs';

const SMALL = 3;
const LAST = frames.length - 1;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeInOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
// Fast start, settles with an overshoot of about 3.7 % (the dial's curve).
const easeOutBack = k => { const u = clamp(k) - 1; return 1 + 2 * u ** 3 + u ** 2; };
const minus = n => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
const indexOfId = id => frames.findIndex(frame => frame.id === id);

// ---------- the story: three beats per dataset (frame ids are page constants, not data) ----------
// composite：f22 从哪来（3.2 s）、f23 关上（3.2 s + 0.8 s）、f24–f25 半速、f26 到哪去（3.2 s + 1.5 s）。
// story：f15 一次让事项变大的作答，f16–f18 半速（f17 一格没动、f18 只落一个 ↩），f19 到哪去；没有墨线。
const PLAN = {
  composite: { from: 'f21', beats: [['f22', 1], ['f23', 1, 0.8], ['f24', 0.5], ['f25', 0.5], ['f26', 1, 1.5]] },
  story: { from: 'f14', beats: [['f15', 1], ['f16', 0.5], ['f17', 0.5], ['f18', 0.5], ['f19', 1, 1.5]] },
};
const plan = (() => {
  const p = PLAN[currentDataset()];
  if (!p) return null;
  const from = indexOfId(p.from), beats = p.beats.map(([id, speed, extra = 0]) => ({ i: indexOfId(id), speed, extra }));
  const ok = from >= 0 && beats.every((b, k) => b.i === (k ? beats[k - 1].i : from) + 1);
  return ok ? { from, beats, end: beats.at(-1).i } : null;
})();
// Told only when opened on its own: top level, no ?frame=, and not followed from another page.
const fromElsewhere = (() => { try { return Boolean(document.referrer) && new URL(document.referrer).pathname !== location.pathname; } catch { return false; } })();
const autoTell = Boolean(plan) && window.parent === window && !new URLSearchParams(location.search).has('frame') && !fromElsewhere;
if (autoTell) { const q = new URLSearchParams(location.search); q.set('frame', plan.from); history.replaceState(null, '', `?${q}`); }

const key = `
  <span><i class="sw" style="background:#2f7f6f"></i><i class="sw" style="background:#b8643a"></i><i class="sw" style="background:#c49a2c"></i>颜色只表示事项身份</span>
  <span><svg width="22" height="12"><rect x="1" y="1" width="20" height="10" fill="none" stroke="var(--ink-3)" stroke-dasharray="2 2"/></svg>留白：被动用（左）或退回（右）</span>
  <span><svg width="26" height="12"><rect x="0.5" y="0.5" width="25" height="11" fill="var(--faint)" stroke="var(--line)"/><rect x="1" y="8" width="8" height="3" fill="#86569c"/><rect x="9" y="8" width="6" height="3" fill="#3a78b0"/><rect x="15" y="8" width="10" height="3" fill="#5b8c37"/></svg>其余 N 件：1–3 份的小额，点开逐件</span>
  <span><b class="y-key-ans">↩</b>这一轮你答掉了登记的问题</span>
  <span><i class="y-key-lapse"></i>这一轮有问题随改写失效，没人答就关上了</span>
  <span><i class="y-key-cell"></i>过账时一格一份，平账后不留</span>
  <span>一格 = 1 份；每行左右等长，因为根层永远是 64 份</span>
  <span class="note"><kbd>←</kbd><kbd>→</kbd> 逐帧 <kbd>空格</kbd> 连播 <kbd>↑</kbd><kbd>↓</kbd> 换行 <kbd>Enter</kbd> 展开 <kbd>Esc</kbd> 收回</span>`;
const stage = createStage({
  id: 'yield', no: 4, name: '让位图', storyIndex: 17, key,
  relation: '每一轮份额从谁那里来、到谁那里去：一件事变大，必有别的事让位或动用留白，两边永远相等。',
  tools: `${plan ? '<button type="button" class="y-tell" data-y="tell" title="从头讲一遍（任意键跳过）">▶ 讲一遍</button>' : ''}<div class="st-seg" role="group" aria-label="小额"><button type="button" data-y="fold" aria-pressed="true">合并小额</button><button type="button" data-y="unfold" aria-pressed="false">逐件</button></div>`,
});
const figure = stage.figure;

// ---------- data: what each round gave and took ----------
const shareMaps = frames.map((_, i) => new Map(records[i].state.root.items.map(item => [item.id, item.share])));
const freeAfter = i => 64 - records[i].state.root.used;
const rows = frames.map((frame, i) => {
  const before = i ? shareMaps[i - 1] : new Map(), after = shareMaps[i];
  const gave = [], took = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(id) || 0, a = after.get(id) || 0;
    if (a < b) gave.push({ id, n: b - a, before: b, after: a });
    if (a > b) took.push({ id, n: a - b, before: b, after: a });
  }
  const f0 = i ? freeAfter(i - 1) : 64, f1 = freeAfter(i);
  if (f1 < f0) gave.push({ id: 'free', n: f0 - f1, before: f0, after: f1 });
  if (f1 > f0) took.push({ id: 'free', n: f1 - f0, before: f0, after: f1 });
  const order = (a, b) => (a.id === 'free') - (b.id === 'free') || b.n - a.n || a.id.localeCompare(b.id);
  gave.sort(order); took.sort(order);
  const decl = frame.batch?.declarations || [];
  const tags = [];
  const added = decl.filter(d => !d.relation || d.relation === 'new').length;
  if (added) tags.push(`新增 ${added}`);
  const withdrawn = decl.filter(d => d.relation === 'withdraw').length;
  if (withdrawn) tags.push(`撤下 ${withdrawn}`);
  for (const d of decl.filter(x => x.relation?.startsWith('merges:'))) tags.push(`${d.relation.slice(7).replace(/[[\]\s"']/g, '').split(',').map(shortOf).join('与')}并为${shortOf(d.id)}`);
  if (records[i].receipt?.type === 'checked') tags.push('检查后不变');
  const answers = responsesIn(i).filter(r => r.link.ask);
  const asked = [...new Set(answers.map(a => a.link.ask))];
  return { i, gave, took, total: gave.reduce((s, g) => s + g.n, 0), free: f1, before: f0, tags, answers, asked,
    lapsed: askLife[i].lapsed, closed: askLife[i].answered, annotations: frame.annotations || [] };
});
// Where each item appears: rows it gave in (left) and took in (right).
const appearances = new Map();
for (const r of rows) for (const [side, list] of [['l', r.gave], ['r', r.took]]) for (const s of list) {
  if (!appearances.has(s.id)) appearances.set(s.id, []);
  appearances.get(s.id).push({ i: r.i, side, ...s });
}
const totals = rows.map(r => r.total).sort((a, b) => b - a);
const CAP = Math.max(18, totals[1] || totals[0] || 18);
const scaled = rows.filter(r => r.total > CAP);
// Who answered which question, and with what (the person's own words are not shown, only the action).
const answerOf = new Map();
frames.forEach((frame, i) => { for (const event of frame.events) for (const link of event.feedback || []) if (link.ask && !answerOf.has(link.ask)) answerOf.set(link.ask, { i, event, link }); });
const openAsks = (id, i) => (id === 'free' ? [] : [...askLife[i].open.values()].filter(a => rootOf(a.item) === id));
const askShort = a => a.short || a.prompt;
const dueOf = a => (a.due_at ? dueText(Date.parse(a.due_at)) : '');
const howAnswered = a => { const x = answerOf.get(a.id); return x ? `${responseSentence(x.event, x.link)}` : '你答了'; };
const timeOf = at => dayTime(at).split(' ').pop();
// A question that lapsed: what the rewrite did to the item it hung on.
function howLapsed(a, i) {
  const root = rootOf(a.item);
  const d = (frames[i].batch?.declarations || []).find(x => x.id === a.item || x.id === root);
  const status = records[i].snapshot.items[root]?.status;
  const what = d?.kind === 'done' ? '改为已办' : d?.relation === 'withdraw' || status === 'withdrawn' ? '撤下' : status === 'merged' || d?.relation?.startsWith('merges:') ? '并入' : '改写';
  return `随改写失效：${shortOf(root)}${what}`;
}
const closedIn = (id, i) => ({ answered: rows[i].closed.filter(a => rootOf(a.item) === id), lapsed: rows[i].lapsed.filter(a => rootOf(a.item) === id) });
const seriesOf = id => frames.map((_, i) => (id === 'free' ? rows[i].free : shareMaps[i].get(id) || 0));

// ---------- the carry: the blank is one account; a run where it was 0, came back, then only fell ----------
// The only line that may join rows (yield-motion.md 约束): in the story's beats, a round whose blank came back from 0
// and the beats after it in which the blank only fell. composite: f23 退回 25，f24–f26 留白 13、12、1。
const carry = (() => {
  if (!plan) return null;
  const k = plan.beats.findIndex(b => rows[b.i - 1].free === 0 && rows[b.i].free > 0);
  if (k < 0) return null;
  const a = plan.beats[k].i, after = [];
  for (const b of plan.beats.slice(k + 1)) { if (rows[b.i].free > rows[b.i - 1].free) break; after.push(b.i); }
  if (!after.length) return null;
  // The thing that took most in those rows (主水管), outlined once the run is told.
  const took = new Map();
  for (const i of after) for (const s of rows[i].took) if (s.id !== 'free') took.set(s.id, [(took.get(s.id)?.[0] || 0) + s.n, (took.get(s.id)?.[1] || 0) + 1]);
  const best = [...took].filter(([, [, n]]) => n >= 2).sort((x, y) => y[1][0] - x[1][0])[0];
  return { a, rows: after, item: best ? best[0] : null };
})();

// ---------- marks: every block of every row, measured in shares from the spine ----------
const K = (i, side, id) => `${i}|${side}|${id}`;
function parseKey(key) {
  const [i, side, id] = String(key).split('|');
  const n = Number(i);
  if (!Number.isInteger(n) || !side) return null;
  const kind = side === 's' ? 'spine' : side === 'a' ? 'ans' : side === 'x' ? 'lapse' : null;
  return { i: n, side, id, kind };
}
const markByKey = new Map();
function marksOf(i, side) {
  const list = side === 'l' ? rows[i].gave : rows[i].took;
  const named = [], small = [];
  let free = null;
  for (const s of list) { if (s.id === 'free') free = s; else if (s.n <= SMALL) small.push(s); else named.push(s); }
  if (small.length < 2) { named.push(...small); small.length = 0; named.sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)); }
  const out = [];
  let c = 0;
  for (const s of named) out.push({ key: K(i, side, s.id), kind: 'seg', side, i, id: s.id, n: s.n, c0: c, c1: (c += s.n), s });
  if (small.length) {
    const n = small.reduce((sum, s) => sum + s.n, 0);
    const rest = { key: K(i, side, '*'), kind: 'rest', side, i, id: '*', n, c0: c, c1: c + n, subs: [], rk: `${i}:${side}` };
    let cc = c;
    for (const s of small) rest.subs.push({ key: K(i, side, s.id), kind: 'sub', side, i, id: s.id, n: s.n, c0: cc, c1: (cc += s.n), s, rest });
    out.push(rest);
    c += n;
  }
  if (free) out.push({ key: K(i, side, 'free'), kind: 'free', side, i, id: 'free', n: free.n, c0: c, c1: (c += free.n), s: free });
  for (const m of out) { markByKey.set(m.key, m); for (const sub of m.subs || []) markByKey.set(sub.key, sub); }
  return out;
}
const layout = rows.map(r => ({ l: marksOf(r.i, 'l'), r: marksOf(r.i, 'r') }));
/** The item a key is about: a block's own item, the answered or lapsed question's item, the blank for the spine. */
function itemOfKey(key) {
  const p = parseKey(key);
  if (!p) return null;
  if (p.kind === 'spine') return 'free';
  if (p.kind === 'ans') { const t = rows[p.i].answers[0]?.link.target; return t ? rootOf(t) : null; }
  if (p.kind === 'lapse') { const a = rows[p.i].lapsed[0]; return a ? rootOf(a.item) : null; }
  return p.id === '*' ? null : p.id;
}

// ---------- layout ----------
let unfoldAll = false;
const openRest = new Set(), autoOpen = new Set();
const restOpen = rest => unfoldAll || openRest.has(rest.rk) || autoOpen.has(rest.rk);
let geo = null;
function measure() {
  const W = figure.clientWidth, H = figure.clientHeight;
  const WHEN = 86, RESP = 32, SPINE = 42, NOTE = Math.max(230, Math.min(300, W * 0.24)), HEAD = 30;
  const wing = Math.floor((W - WHEN - RESP - SPINE - NOTE - 14) / 2);
  const rowH = Math.max(15, Math.min(30, (H - HEAD - 4) / frames.length));
  const bar = Math.max(12, Math.min(17, rowH - 6));
  const spineL = WHEN + RESP + wing;
  return { W, H, WHEN, RESP, SPINE, NOTE, HEAD, wing, rowH, unit: wing / CAP, bar, font: bar >= 14 ? 11 : 10,
    spineL, spineR: spineL + SPINE, spineC: spineL + SPINE / 2, outL: WHEN + RESP, outR: spineL + SPINE + wing };
}
const unitOf = i => geo.unit * Math.min(1, CAP / Math.max(1, rows[i].total));
const rowTop = i => geo.HEAD + i * geo.rowH;
const rowMid = i => rowTop(i) + geo.rowH / 2;
function label(text, n, width, light) {
  const fits = s => textWidth(s, geo.font, 600) + 9 <= width;
  let shown = [`${text} ${n}`, text].find(fits);
  // A name cut short still says which thing it is better than a bare number does.
  for (let k = [...text].length - 1; !shown && k >= 2; k -= 1) { const cut = `${[...text].slice(0, k).join('').trim()}…`; if (fits(cut)) shown = cut; }
  if (!shown && fits(String(n))) shown = String(n);
  return shown ? `<em class="${light ? 'is-light' : ''}">${esc(shown)}</em>` : '';
}
function segHTML(m, u) {
  const w = m.n * u, cls = m.kind === 'sub' ? 'y-sub' : 'y-seg';
  if (m.id === 'free') return `<span class="y-seg y-free" data-id="${m.key}" data-item="free" style="width:${w.toFixed(2)}px;--u:${u.toFixed(3)}px">${label('留白', m.n, w, true)}</span>`;
  return `<span class="${cls}" data-id="${esc(m.key)}" data-item="${esc(m.id)}" style="width:${w.toFixed(2)}px;--c:${colorOf(m.id)};--u:${u.toFixed(3)}px">${label(shortOf(m.id), m.n, w)}</span>`;
}
function wingHTML(list, u) {
  return list.map(m => {
    if (m.kind !== 'rest') return segHTML(m, u);
    const w = m.n * u, open = restOpen(m);
    const restLabel = textWidth(`其余 ${m.subs.length} 件`, 10.5, 500) + 8 <= w ? `其余 ${m.subs.length} 件` : textWidth(`+${m.subs.length}`, 10.5, 500) + 6 <= w ? `+${m.subs.length}` : '';
    return `<span class="y-rest${open ? ' is-open' : ''}" aria-expanded="${open}" data-id="${m.key}" data-rest="${m.rk}" style="width:${w.toFixed(2)}px">
      <b>${restLabel}</b><span class="y-subs">${m.subs.map(sub => segHTML(sub, u)).join('')}</span></span>`;
  }).join('');
}
function rowHTML(r) {
  const g = geo, t = at(r.i);
  const firstOfDay = r.i === 0 || dayOf(at(r.i - 1)) !== dayOf(t);
  const u = unitOf(r.i);
  const quiet = !r.gave.length && !r.took.length;
  const marks = [
    r.asked.length ? `<span class="y-ans" data-id="${K(r.i, 'a', 'ans')}">↩${r.asked.length > 1 ? `<sub>${r.asked.length}</sub>` : ''}</span>` : '',
    r.lapsed.length ? `<span class="y-lapse" data-id="${K(r.i, 'x', 'lapse')}"><i></i>${r.lapsed.length > 1 ? `<sub>${r.lapsed.length}</sub>` : ''}</span>` : '',
    r.annotations.length ? `<span class="y-ann" title="${esc(r.annotations.map(a => a.text).join(' / '))}">✎</span>` : '',
  ].join('');
  const tags = r.i === 0 ? '空状态：64 份全是留白' : [...r.tags, r.total > CAP ? `本行按 ${(CAP / r.total).toFixed(2)} 缩放` : ''].filter(Boolean).join(' · ');
  return `<div class="y-row${firstOfDay ? ' is-dayfirst' : ''}${quiet ? ' is-quiet' : ''}" data-row="${r.i}" style="transform:translateY(${rowTop(r.i).toFixed(1)}px);height:${g.rowH.toFixed(1)}px;--bar:${g.bar}px;--font:${g.font}px">
    <div class="y-when" data-st="go" data-frame="${r.i}" title="跳到这一帧">${firstOfDay ? `<b>${dayOf(t)}</b><span>${weekdayOf(t)}</span>` : ''}<time>${esc(dayTime(frames[r.i].at).split(' ').pop())}</time></div>
    <div class="y-resp">${marks}</div>
    <div class="y-wing y-l"><div class="y-fill">${wingHTML(layout[r.i].l, u)}</div></div>
    <div class="y-spine">${quiet ? '<i class="y-still"></i>' : ''}<span data-id="${K(r.i, 's', 'free')}">${r.free}</span></div>
    <div class="y-wing y-r"><div class="y-fill">${wingHTML(layout[r.i].r, u)}</div></div>
    <div class="y-note"><span class="y-t">${esc(frames[r.i].title)}</span>${g.rowH >= 30 ? `<span class="y-g">${esc(tags)}</span>` : ''}</div>
  </div>`;
}
function headHTML() {
  const g = geo;
  let ticks = '';
  for (let n = 0; n <= CAP; n += 6) for (const dir of [-1, 1]) {
    const x = g.spineC + dir * (g.SPINE / 2 + n * g.unit);
    ticks += `<i style="left:${x.toFixed(1)}px"></i>${n ? `<span style="left:${x.toFixed(1)}px">${n}</span>` : ''}`;
  }
  return `<div class="y-head">
    <b style="left:0">整理</b>
    <b class="y-h-l" style="right:${(g.W - g.spineL - 6).toFixed(1)}px">← 让出</b>
    <span class="y-h-spine" style="left:${g.spineL.toFixed(1)}px;width:${g.SPINE}px">留白</span>
    <b style="left:${(g.spineR + 6).toFixed(1)}px">拿到 →</b>
    <b style="left:${(g.W - g.NOTE + 4).toFixed(1)}px">这一轮</b>
    <div class="y-scale">${ticks}</div></div>`;
}

const els = { rows: [], parts: [] };
let canvas = null, ctx = null, dpr = 1;
function render() {
  geo = measure();
  const g = geo;
  for (const [k, v] of [['when', g.WHEN], ['resp', g.RESP], ['wing', g.wing], ['spine', g.SPINE], ['note', g.NOTE]]) figure.style.setProperty(`--${k}`, `${v}px`);
  // ix keeps its cards, leaders and keyboard proxies in the figure; only the drawing is rebuilt.
  const kept = [...figure.querySelectorAll(':scope > .ix-leaders, :scope > .ix-peek, :scope > .ix-detail, :scope > .ix-sr')];
  figure.innerHTML = `${headHTML()}<div class="y-rows"><i class="y-carry" hidden></i>${rows.map(rowHTML).join('')}</div>
    <div class="y-now" style="height:${g.rowH.toFixed(1)}px"></div><canvas class="y-cells" aria-hidden="true"></canvas>`;
  figure.append(...kept);
  const sr = kept.find(el => el.classList.contains('ix-sr'));
  if (sr) figure.prepend(sr);
  els.rows = [...figure.querySelectorAll('.y-row')];
  els.parts = els.rows.map(row => ({ l: row.querySelector('.y-l .y-fill'), r: row.querySelector('.y-r .y-fill'), spine: row.querySelector('.y-spine span'), cache: {} }));
  els.now = figure.querySelector('.y-now');
  els.carry = figure.querySelector('.y-carry');
  canvas = figure.querySelector('.y-cells');
  dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(g.W * dpr); canvas.height = Math.round(g.H * dpr);
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawn = null;
  shown = -1;
  // A resize keeps a round that is being posted where it is; it repaints from its clock.
  update(stage.index, null, post ? 'keep' : 'snap');
  for (const el of lit) el.classList.remove('is-lit', 'is-peer', 'has-lit');
  lit.clear();
  litKey = undefined; popped = null; traced = false; lineShown = '';
  ix?.relayout();
}

// ---------- the clock: posting one round ----------
// One round at full speed (3.2 s) and the short version for ←/→ (0.9 s). Half speed (連播, f24–f25) is every time × 0.5.
// Without an answer the first action is skipped and everything after it moves up by 0.15 s (the round keeps its length).
const FULL = { first: 0.40, sweep0: 0.55, sweepDur: 0.30, out0: 0.90, outEnd: 1.50, cell: 0.24, stagger: 0.012, in0: 1.62, inEnd: 2.22, settle: 2.25, dur: 3.20, trail: 0.2, count: true };
const SHORT = { first: 0.05, sweep0: 0.08, sweepDur: 0.16, out0: 0.24, outEnd: 0.52, cell: 0.16, stagger: 0.012, in0: 0.52, inEnd: 0.80, settle: 0.80, dur: 0.90, trail: 0.12, count: false };
const FIXED = new Set(['first', 'sweepDur', 'cell', 'stagger', 'dur', 'trail']);
function timing(mode, answered) {
  if (mode === 'short') return SHORT;
  const s = mode === 'half' ? 0.5 : 1, lead = answered ? 0 : FULL.sweep0 - FULL.first;
  const T = { count: true };
  for (const [k, v] of Object.entries(FULL)) if (typeof v === 'number') T[k] = (FIXED.has(k) ? v : v - lead) * s;
  return T;
}
let post = null;              // the round being posted: {i, mode, T, t, extra, settled, n, so, si}
let freeze = false;           // tellAt(): a still, until any control releases it
const hold = { at: null };    // ix pauses the clock while something is hovered or open
let driving = null;           // set while the page itself steps (telling, playing): {mode, extra}
const run = { kind: null, k: -1, wait: 0 };   // 'tell' | 'play'
const now = () => performance.now() / 1000;

function startPost(i, mode, extra = 0) {
  const r = rows[i], T = timing(mode, r.asked.length > 0), n = r.total;
  const stg = (a, b) => (n > 1 ? Math.min(T.stagger, Math.max(0, b - a - T.cell) / (n - 1)) : 0);
  post = { i, mode, T, t: 0, extra, settled: false, n, so: stg(T.out0, T.outEnd), si: stg(T.in0, T.inEnd), u: null };
  if (reduced()) post.t = T.settle;
  paintPost();
}
// Snap whatever is being posted to its settled state.
function finishPost() {
  if (!post) return;
  if (!post.settled) { post.t = Math.max(post.t, post.T.settle); paintPost(); }
  clearCells();
  post = null;
}

// ---------- frame changes ----------
let shown = -1;
const nowY = { from: 0, to: 0, t0: 0, on: false };
function update(next, previous, mode) {
  els.rows.forEach((row, i) => { row.classList.toggle('is-future', i > next); row.classList.toggle('is-current', i === next); });
  for (const row of figure.querySelectorAll('.y-row.enter')) row.classList.remove('enter');
  if (mode !== 'keep') finishPost();
  if (mode === 'sweep' && previous != null && next > previous && !reduced()) {
    // Several rounds at once: the rows sweep out one after another, no cells, numbers straight to their end state.
    const entering = els.rows.slice(previous + 1, next + 1);
    const step = entering.length > 1 ? Math.min(45, 320 / entering.length) : 0;
    void figure.offsetWidth;
    entering.forEach((row, k) => { row.style.setProperty('--d', `${Math.round(k * step)}ms`); row.classList.add('enter'); });
  } else if (['full', 'half', 'short'].includes(mode) && next > 0) startPost(next, mode, driving?.extra || 0);
  const y = rowTop(next);
  if (previous == null || reduced() || mode === 'snap') { nowY.on = false; els.now.style.transform = `translateY(${y.toFixed(1)}px)`; nowY.to = y; }
  else { nowY.from = nowY.on ? nowY.cur : rowTop(previous); nowY.to = y; nowY.t0 = now(); nowY.on = true; }
  shown = next;
}
let keyRepeat = false;
addEventListener('keydown', event => { keyRepeat = event.repeat; }, true);
stage.onFrame((next, previous) => {
  if (!driving) {
    // Someone stepped: stop telling or playing, fold any card away at once, drop the told marks.
    stopRun(); freeze = false;
    if (ix) { ix.reset(); closePanel(); }
    clearMarks();
  }
  const mode = driving ? driving.mode : next === previous + 1 ? (keyRepeat ? 'sweep' : 'short') : next > previous ? 'sweep' : 'back';
  update(next, previous, mode);
});
/** The page steps itself (telling, playing): one round posted at a speed. */
function drive(i, mode, extra = 0) {
  driving = { mode, extra };
  try { if (i === stage.index) { update(i, i, mode === 'snap' ? 'snap' : mode); } else stage.go(i); } finally { driving = null; }
}

// ---------- telling and playing ----------
function setRunUI() {
  document.body.classList.toggle('st-playing', run.kind === 'play');
  const b = document.querySelector('[data-y="tell"]');
  if (b) { b.textContent = run.kind === 'tell' ? '跳过 ▸▸' : '▶ 讲一遍'; b.setAttribute('aria-pressed', String(run.kind === 'tell')); }
}
function stopRun() { if (!run.kind) return; run.kind = null; setRunUI(); }
function startTell() {
  if (!plan) return;
  freeze = false; stopRun(); ix?.reset(); closePanel(); clearMarks();
  drive(plan.from, 'snap');
  marks.on = true;
  Object.assign(run, { kind: 'tell', k: -1, wait: 0.4 });
  setRunUI();
}
/** Skip to the end of the story: f26 settled, with its ink line and outline. */
function skipTell() {
  if (!plan) return;
  stopRun(); freeze = false;
  drive(plan.end, 'snap');
  marks.on = Boolean(carry);
  marks.reach = carry ? carry.rows.at(-1) - carry.a : 0; marks.traced = Boolean(carry?.item); marks.sticky = true;
}
function startPlay() {
  freeze = false; stopRun(); ix?.reset(); closePanel(); clearMarks();
  if (stage.index >= LAST) drive(0, 'snap');
  Object.assign(run, { kind: 'play', k: 0, wait: 0 });
  setRunUI();
}
stage.play = startPlay;
stage.pause = () => { if (run.kind === 'play') stopRun(); };
stage.toggle = () => (run.kind === 'play' ? stage.pause() : startPlay());
/** A still of the story at `s` seconds (for stills and checks): steps released by any control. */
function tellAt(s) {
  if (!plan) return;
  stopRun(); ix?.reset(); closePanel(); clearMarks();
  drive(plan.from, 'snap');
  marks.on = true; marks.reach = 0;
  let t = s - 0.4;
  for (const [k, b] of plan.beats.entries()) {
    const mode = b.speed < 1 ? 'half' : 'full', len = timing(mode, rows[b.i].asked.length > 0).dur + b.extra;
    if (t < len || k === plan.beats.length - 1) {
      if (t < 0) break;
      drive(b.i, mode, b.extra);
      post.t = Math.min(t, len);
      paintPost();
      break;
    }
    drive(b.i, 'snap'); carryStep(b.i, 1);
    t -= len;
  }
  freeze = true;
}
function tick(dt) {
  if (hold.at != null || freeze) return;
  if (post) {
    post.t += dt;
    if (post.t >= post.T.dur + post.extra && !run.kind) { clearCells(); post = null; }
  }
  if (!run.kind || (post && post.t < post.T.dur + post.extra)) return;
  if (run.wait > 0) { run.wait -= dt; return; }
  if (run.kind === 'tell') {
    run.k += 1;
    const b = plan.beats[run.k];
    if (!b) { stopRun(); finishPost(); marks.sticky = true; return; }
    drive(b.i, b.speed < 1 ? 'half' : 'full', b.extra);
  } else {
    if (stage.index >= LAST) { stopRun(); finishPost(); return; }
    drive(stage.index + 1, 'half');
  }
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
addEventListener('pointerdown', () => { freeze = false; if (marks.sticky) clearMarks(); }, true);

// ---------- painting one round being posted ----------
function paintPost() {
  const p = post;
  if (!p) return;
  const T = p.T, t = p.t, r = rows[p.i], part = els.parts[p.i], row = els.rows[p.i], c = part.cache;
  const u = unitOf(p.i), N = p.n;
  const set = (el, prop, value, k) => { if (c[k] !== value) { c[k] = value; el.style[prop] = value; } };
  const settled = t >= T.settle;
  if (settled && !p.settled) settle(p);
  if (p.settled) return;
  row.classList.add('is-posting');
  row.classList.toggle('is-answered', t >= T.first);
  const sweep = easeOut((t - T.sweep0) / T.sweepDur);
  set(part.l, 'clipPath', `inset(-4px ${((1 - sweep) * 100).toFixed(2)}% -4px 0)`, 'lc');
  // While its shares peel off, the left wing drops to 40 %: it is the ledger, not a stock that empties.
  const peel = clamp((t - (T.out0 - 0.08)) / 0.08) * (1 - clamp((t - T.outEnd) / 0.12));
  set(part.l, 'opacity', (1 - 0.6 * peel).toFixed(3), 'lo');
  const arrived = countAt(t, T.in0 + T.cell, p.si, N);
  set(part.r, 'clipPath', `inset(-4px ${Math.max(0, (N - arrived) * u).toFixed(2)}px -4px 0)`, 'rc');
  if (c.sp !== 'before') { c.sp = 'before'; part.spine.textContent = r.before; part.spine.classList.add('is-before'); }
}
/** How many of n cells, leaving `stagger` apart from t0, have arrived by t. */
const countAt = (t, t0, stagger, n) => (t < t0 ? 0 : stagger > 0 ? Math.min(n, Math.floor((t - t0) / stagger + 1e-6) + 1) : n);
function settle(p) {
  p.settled = true;
  const part = els.parts[p.i], row = els.rows[p.i];
  row.classList.remove('is-posting', 'is-answered');
  for (const el of [part.l, part.r]) { el.style.clipPath = ''; el.style.opacity = ''; }
  part.cache = {};
  part.spine.textContent = rows[p.i].free; part.spine.classList.remove('is-before');
  if (marks.on && carry && carry.rows.includes(p.i)) carryStep(p.i, 1);
  if (marks.on && carry && p.i === carry.rows.at(-1)) marks.traced = true;
  const ov = document.querySelector('.y-ov');
  if (ov && Number(ov.dataset.i) === p.i) { ov.dataset.phase = 'post'; ov.dataset.ans = '1'; }
}

// ---------- the concept layer: one grey cell a share, only while a round is posted ----------
let drawn = null;
function clearCells() { if (drawn && ctx) { ctx.clearRect(0, drawn[0], geo.W, drawn[1]); drawn = null; } }
function paintCells(alphaK) {
  const p = post;
  if (!p || p.settled || !p.n || reduced()) { clearCells(); return; }
  const T = p.T, t = p.t, g = geo, u = unitOf(p.i), y = rowMid(p.i), h = g.bar;
  clearCells();
  drawn = [rowTop(p.i) - 2, g.rowH + 4];
  const w = Math.max(1.5, u - 1);
  // A cell flies along the row with a 0.2 s trail (shorter at the faster speeds). Trails never lie over blocks that
  // have already come in on the right: the ledger stays clean where it is written.
  const edge = g.spineR + countAt(t, T.in0 + T.cell, p.si, p.n) * u;
  const cell = (x0, x1, start, right) => {
    const k = (t - start) / T.cell;
    if (k <= 0 || t - start > T.cell + T.trail) return;
    const head = lerp(x0, x1, easeInOut(k));
    let tail = lerp(x0, x1, easeInOut((t - T.trail - start) / T.cell));
    if (right) tail = Math.max(tail, Math.min(head, edge));
    if (Math.abs(head - tail) > 0.5) {
      const grad = ctx.createLinearGradient(tail, 0, head, 0);
      grad.addColorStop(0, 'rgba(120,128,118,0)'); grad.addColorStop(1, `rgba(120,128,118,${(0.22 * alphaK).toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(Math.min(head, tail), y - h * 0.25, Math.abs(head - tail), h * 0.5);
    }
    if (k < 1) { ctx.fillStyle = `rgba(120,128,118,${(0.8 * alphaK).toFixed(3)})`; ctx.fillRect(head - w / 2, y - h / 2, w, h); }
  };
  for (let k = 0; k < p.n; k += 1) {
    cell(g.spineL - (k + 0.5) * u, g.spineC, T.out0 + k * p.so, false);
    cell(g.spineC, g.spineR + (k + 0.5) * u, T.in0 + k * p.si, true);
  }
  // The pool: cells merge into the spine's line, which thickens with the shares in it (as tall as a block at CAP).
  const pool = countAt(t, T.out0 + T.cell, p.so, p.n) - countAt(t, T.in0, p.si, p.n);
  if (pool > 0) {
    const ph = 1 + (h - 1) * Math.min(1, pool / CAP);
    ctx.fillStyle = `rgba(120,128,118,${(0.85 * alphaK).toFixed(3)})`;
    ctx.fillRect(g.spineL + 4, y - ph / 2, g.SPINE - 8, ph);
  }
}

// ---------- the told marks: the carry's ink line and the outline of the thing that took it ----------
const marks = { on: false, reach: 0, traced: false, sticky: false };
function clearMarks() { Object.assign(marks, { on: false, reach: 0, traced: false, sticky: false }); }
function carryStep(i, k) { if (carry && carry.rows.includes(i)) marks.reach = Math.max(marks.reach, i - 1 - carry.a + k); }
let traced = false, lineShown = '';
function paintMarks() {
  let reach = marks.on && carry ? marks.reach : 0;
  // Row by row: the line reaches the next number while that round's shares come in, and joins it at the settle.
  if (post && marks.on && carry?.rows.includes(post.i) && !post.settled) {
    const T = post.T;
    reach = Math.max(reach, post.i - 1 - carry.a + clamp((post.t - T.in0) / (T.settle - T.in0)));
  }
  const line = reach > 0 ? `${rowMid(carry.a).toFixed(1)}:${(reach * geo.rowH).toFixed(1)}` : '';
  if (line !== lineShown) {
    lineShown = line;
    els.carry.hidden = !line;
    if (line) { els.carry.style.cssText = `left:${(geo.spineC - 0.5).toFixed(1)}px;top:${rowMid(carry.a).toFixed(1)}px;height:${(reach * geo.rowH).toFixed(1)}px`; }
  }
  const want = Boolean(marks.on && marks.traced && carry?.item);
  if (want !== traced) {
    traced = want;
    for (const i of carry?.rows || []) for (const el of els.rows[i].querySelectorAll(`[data-item="${CSS.escape(carry.item)}"]`)) el.classList.toggle('is-traced', want);
  }
}

// ---------- the now frame: slides to the new row with the dial's ease-out ----------
function paintNow(t) {
  if (!nowY.on) return;
  const k = (t - nowY.t0) / 0.32;
  nowY.cur = lerp(nowY.from, nowY.to, easeOutBack(k));
  if (k >= 1) { nowY.on = false; nowY.cur = nowY.to; }
  els.now.style.transform = `translateY(${nowY.cur.toFixed(1)}px)`;
}

// ---------- side panel: this round, with the hero number on top ----------
const signed = n => (n > 0 ? `+${n}` : `${n}`);
const nameChip = id => (id === 'free' ? '<span class="y-chip y-chip-free">留白</span>' : `<span class="y-chip" data-pin="${esc(id)}" style="--c:${colorOf(id)}">${esc(shortOf(id))}</span>`);
const peersText = list => list.map(s => `<span class="y-peer">${nameChip(s.id)}<small>${s.n}</small></span>`).join('');
const answerLink = () => withDataset(`../../index.html?variant=d&frame=${stage.index}`);
function asksList(i) {
  const open = [...askLife[i].open.values()], fresh = new Set(askLife[i].fresh.map(a => a.id));
  const li = a => `<li class="is-open"><b>${fresh.has(a.id) ? '新登记' : '开着'}</b><span>${esc(askShort(a))}</span><small>${esc([shortOf(rootOf(a.item)), dueOf(a)].filter(Boolean).join(' · '))}</small><a href="${esc(answerLink())}">去回答 →</a></li>`;
  const after = [
    ...rows[i].closed.map(a => `<li class="is-answered"><b>答掉</b><s>${esc(askShort(a))}</s><small>${esc(howAnswered(a))}</small></li>`),
    ...rows[i].lapsed.map(a => `<li class="is-lapsed"><b>失效</b><span>${esc(askShort(a))}</span><small>${esc(howLapsed(a, i))}</small></li>`),
    ...open.map(li),
  ].join('');
  const before = i ? [...askLife[i - 1].open.values()].map(a => `<li><b>开着</b><span>${esc(askShort(a))}</span></li>`).join('') : '';
  // After the settle the list also carries the questions this round closed, so the heading counts both.
  const shut = rows[i].closed.length + rows[i].lapsed.length;
  const head = shut ? `这一轮的问题 <small class="y-post">关上 ${shut} · 开着 ${open.length} · 去回答链到同一帧的 D</small>` : `开着的问题 <small class="y-post">${open.length} 条 · 去回答链到同一帧的 D</small>`;
  return `<section class="y-asks"><h4><span class="y-post">${head}</span><span class="y-pre">开着的问题 <small>本轮还没平账</small></span></h4>
    <ul class="y-post">${after || '<li class="st-muted">没有开着的问题</li>'}</ul><ul class="y-pre">${before || '<li class="st-muted">没有开着的问题</li>'}</ul></section>`;
}
function overview(i) {
  const r = rows[i];
  if (i === 0) return { kicker: `这一轮 · ${frames[0].id}`, title: esc(frames[0].title), body: '<p>还没有整理过任何输入：64 份全是留白。按 → 或空格开始。</p>' };
  const live = post && post.i === i && !post.settled;
  const line = (list, word) => list.length ? `<ul class="y-list">${list.map(s => `<li>${nameChip(s.id)}<span>${s.before === 0 && s.id !== 'free' ? '新增' : s.before} → ${s.after}</span><b>${signed(word === 'gave' ? -s.n : s.n)}</b></li>`).join('')}</ul>` : '<p class="st-muted">—</p>';
  const responses = responsesIn(i);
  const answers = responses.filter(x => x.link.ask);
  const n = live ? 0 : r.total;
  return {
    kicker: `这一轮 · ${frames[i].id} · ${records[i].state.revision}`,
    title: esc(frames[i].title),
    body: `<div class="y-ov" data-i="${i}" data-phase="${live ? 'pre' : 'post'}" data-ans="${!live || post.t >= post.T.first ? 1 : 0}">
      <div class="y-hero"><small>让出</small><b class="y-hero-n">${n}</b><small>拿到</small></div>
      <p class="y-eq"><span>让出 <b class="y-n-gave">${n}</b></span><i>=</i><span>拿到 <b class="y-n-took">${n}</b></span><small>此后留白 <b class="y-n-free">${live ? r.before : r.free}</b> / 64</small></p>
      ${r.total ? `<div class="y-cols y-post"><section><h4>← 让出</h4>${line(r.gave, 'gave')}</section><section><h4>拿到 →</h4>${line(r.took, 'took')}</section></div>` : '<p class="st-muted">这一轮份额没有变化。</p>'}
      ${answers.length ? `<section class="y-answered"><h4>你作答的问题 <small>点开看那件事</small></h4><ul class="y-list y-answers">${foldSentences(answers).map(x => `<li><button type="button" data-answer-pin="${esc(rootOf(x.first.link.target))}" data-answer-row="${i}">↩ ${esc(x.label)}${x.item ? ` <span class="y-chip" style="--c:${colorOf(rootOf(x.item))}">${esc(shortOf(rootOf(x.item)))}</span>` : ''}</button></li>`).join('')}</ul></section>` : ''}
      ${responses.length > answers.length ? `<p class="st-muted y-answered">另有 ${responses.length - answers.length} 条你在来源处的动作，指向事项但没有回答登记的问题。</p>` : ''}
      ${asksList(i)}
      ${r.annotations.length ? `<section><h4>${esc(personName)}的批注</h4>${r.annotations.map(a => `<p>「${esc(a.text)}」</p>`).join('')}</section>` : ''}
      ${frames[i].narrative ? `<section><h4>旁白 <small>演示数据</small></h4><p>${esc(frames[i].narrative)}</p></section>` : ''}
      ${scaled.length ? `<p class="st-muted y-fine">${scaled.map(x => `${dayTime(frames[x.i].at)}`).join('、')} 一轮挪动超过 ${CAP} 份，那一行按比例缩小，左右仍等长。</p>` : ''}
      </div>`,
  };
}
stage.setOverview(overview);
// The numbers that count while a round is posted: written in place, not re-rendered.
const sideEls = { ov: null };
function paintSide() {
  const ov = document.querySelector('.y-ov');
  if (ov !== sideEls.ov) { sideEls.ov = ov; if (ov) Object.assign(sideEls, { hero: ov.querySelector('.y-hero-n'), gave: ov.querySelector('.y-n-gave'), took: ov.querySelector('.y-n-took'), free: ov.querySelector('.y-n-free'), v: '' }); }
  if (!ov) return;
  const i = Number(ov.dataset.i), r = rows[i];
  const live = post && post.i === i && !post.settled;
  let out = r.total, inn = r.total, free = r.free;
  if (live) {
    const T = post.T;
    out = T.count ? countAt(post.t, T.out0 + T.cell, post.so, post.n) : 0;
    inn = T.count ? countAt(post.t, T.in0 + T.cell, post.si, post.n) : 0;
    free = r.before;
    ov.dataset.ans = post.t >= T.first ? '1' : '0';
  }
  const v = `${out}:${inn}:${free}`;
  if (v === sideEls.v) return;
  sideEls.v = v;
  sideEls.hero.textContent = out; sideEls.gave.textContent = out; sideEls.took.textContent = inn; sideEls.free.textContent = free;
}

// ---------- the interaction (motion/ix.mjs): what is under a point, where cards hang, how the clock stops ----------
const HIT = 10;
/** Is the mark on screen and touchable now: its row is drawn, a sub's group is open, and a posted round has reached it. */
function hasKey(key) {
  const p = parseKey(key);
  if (!p || p.i < 1 || p.i > stage.index) return false;
  const r = rows[p.i], live = post && post.i === p.i && !post.settled ? post : null;
  if (p.kind === 'ans') return r.asked.length > 0 && (!live || live.t >= live.T.first);
  if (p.kind === 'lapse') return r.lapsed.length > 0 && !live;
  if (p.kind === 'spine') return true;
  const m = markByKey.get(key);
  if (!m) return false;
  if (m.kind === 'sub' && !restOpen(m.rest)) return false;
  if (m.kind === 'rest' && restOpen(m)) return false;
  if (live) {
    if (m.side === 'l') return live.t >= live.T.sweep0 + live.T.sweepDur * 0.5;
    return countAt(live.t, live.T.in0 + live.T.cell, live.si, live.n) > m.c0;
  }
  return true;
}
const visibleMarks = (i, side) => layout[i][side].flatMap(m => (m.kind === 'rest' && restOpen(m) ? m.subs : [m]));
/** Which mark is under a point of the figure: by row, then by shares from the spine (a band of HIT px past the outer end). */
function hitAt(x, y) {
  const g = geo;
  if (!g || y < g.HEAD) return null;
  const i = Math.floor((y - g.HEAD) / g.rowH);
  if (i < 1 || i > stage.index) return null;
  const pick = key => (key && hasKey(key) ? key : null);
  if (x >= g.spineL && x <= g.spineR) return pick(K(i, 's', 'free'));
  if (x >= g.WHEN && x < g.outL - HIT) return pick(rows[i].asked.length ? K(i, 'a', 'ans') : rows[i].lapsed.length ? K(i, 'x', 'lapse') : null);
  const side = x < g.spineL ? 'l' : 'r', u = unitOf(i);
  const c = side === 'l' ? (g.spineL - x) / u : (x - g.spineR) / u;
  const list = visibleMarks(i, side);
  const m = list.find(mm => c >= mm.c0 && c < mm.c1) || (list.length && c >= list.at(-1).c1 && c * u <= list.at(-1).c1 * u + HIT ? list.at(-1) : null);
  return m ? pick(m.key) : null;
}
function keyFor(name, i = stage.index) {
  if (name == null) return null;
  if (markByKey.has(name) || parseKey(name)?.kind) return name;
  if (name === '↩') return K(i, 'a', 'ans');
  const id = name === '留白' || name === 'free' ? 'free' : shortOfName(name);
  const all = [...layout[i].l, ...layout[i].r].flatMap(m => (m.kind === 'rest' ? m.subs : [m]));
  const m = all.find(x => x.id === id);
  if (!m) return id === 'free' ? K(i, 's', 'free') : null;
  return m.kind === 'sub' && !restOpen(m.rest) ? m.rest.key : m.key;
}
const shortOfName = name => (shareMaps.some(map => map.has(name)) ? name : [...appearances.keys()].find(id => id !== 'free' && shortOf(id) === name) || name);
/** A mark's rectangle on the figure (the drawn block; the spine's number; the ↩ and ○ as laid out). */
function rectOf(key) {
  const p = parseKey(key), g = geo;
  if (!p) return null;
  if (p.kind) {
    const el = figure.querySelector(`[data-id="${CSS.escape(key)}"]`), f = figure.getBoundingClientRect();
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x0: b.left - f.left, y0: b.top - f.top, x1: b.right - f.left, y1: b.bottom - f.top };
  }
  const m = markByKey.get(key), u = unitOf(p.i), y = rowMid(p.i);
  if (!m) return null;
  const [a, b] = m.side === 'l' ? [g.spineL - m.c1 * u, g.spineL - m.c0 * u] : [g.spineR + m.c0 * u, g.spineR + m.c1 * u];
  return { x0: a, y0: y - g.bar / 2, x1: b, y1: y + g.bar / 2 };
}
const centreOf = key => { const r = rectOf(key); return r ? { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 } : null; };
const sideOfKey = key => { const p = parseKey(key); return p?.side === 'l' || p?.side === 'a' || p?.side === 'x' ? 'l' : 'r'; };

// The summary card sits above the mark (below it when there is no room), centred on it. On the now row it hangs
// below when it fits: under the now row there are only the blank future rows, and the outlines above stay readable.
function peekPlace(key, w, h) {
  const r = rectOf(key), g = geo, row = parseKey(key)?.i;
  const cx = (r.x0 + r.x1) / 2;
  const x = clamp(cx - w / 2, 8, g.W - 8 - w);
  const fitsBelow = r.y1 + 10 + h <= g.H - 8;
  const below = (row === stage.index && fitsBelow) || r.y0 - 10 - h < 8;
  return below ? { x, y: r.y1 + 10, from: { x: clamp(cx, r.x0, r.x1), y: r.y1 } } : { x, y: r.y0 - 10 - h, from: { x: clamp(cx, r.x0, r.x1), y: r.y0 } };
}
// The detail card: right-wing (and spine) cards by the notes column, left-wing cards against the left wing's outer
// edge; above or below, whichever has more room, never over the current row nor the clicked one. The leader leaves
// the stepped-out block's outer end, runs along the row 8 px past the wing's outer edge, then turns square to the card.
function detailPlace(key, el) {
  const p = parseKey(key), g = geo, r = rectOf(key);
  if (!r) return null;
  const left = sideOfKey(key) === 'l';
  const turnX = p.kind === 'ans' || p.kind === 'lapse' ? (r.x0 + r.x1) / 2 : left ? g.outL - 8 : g.outR + 8;
  const w = left ? 300 : Math.round(clamp(g.W - 8 - (turnX - 10), 250, 320));
  const x = left ? clamp(turnX - 10, 8, g.W - 8 - w) : g.W - 8 - w;
  el.style.width = `${w}px`;
  el.style.maxHeight = `${g.H - 16}px`;
  const band = [p.i, stage.index].map(i => [rowTop(i) - 3, rowTop(i) + g.rowH + 3]);
  const top = Math.min(...band.map(b => b[0])), bottom = Math.max(...band.map(b => b[1]));
  const above = top - 10 - 8, below = g.H - 8 - (bottom + 10);
  const natural = el.offsetHeight, up = above >= below;
  const h = Math.max(120, Math.min(natural, up ? above : below));
  el.style.maxHeight = `${h}px`;
  const y = up ? top - 10 - h : bottom + 10, edge = up ? y + h : y, ry = rowMid(p.i);
  // ↩ and ○ hang straight down (or up) to their card; a block or the spine's number runs along its row first.
  if (p.kind === 'ans' || p.kind === 'lapse') return { x, y, w, h, path: [{ x: turnX, y: up ? r.y0 : r.y1 }, { x: turnX, y: edge }] };
  const startX = p.kind === 'spine' ? r.x1 : left ? r.x0 - IX.pop : r.x1 + IX.pop;
  return { x, y, w, h, path: [{ x: startX, y: ry }, { x: turnX, y: ry }, { x: turnX, y: edge }] };
}

let ix = null;
let X = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
ix = createIx({
  stage: figure, keysIn: figure,
  facts: key => factsOf(key), has: hasKey, hit: hitAt, named: name => keyFor(name),
  pointOf: centreOf, index: () => stage.index * 2 + (post && !post.settled ? 1 : 0),
  pause: () => { if (hold.at == null) hold.at = now(); }, resume: () => { hold.at = null; }, paused: () => hold.at != null,
  last: LAST, answerHref: () => answerLink(),
  seen: () => { const live = Boolean(post && post.i === stage.index && !post.settled); return { inputs: true, share: !live, asks: !live }; },
  peekPlace, detailPlace, peekHTML: (f, o) => peekCard(f, o), detailHTML: (f, o) => detailCard(f, o),
  skip: '.y-head, .y-note, .y-when',
  label: '让位图的标记：Tab 逐个看概要，↑/↓ 换行，Enter 展开详情，Esc 收回',
});

// ---------- the cards: this row, this entry ----------
const factCache = new Map();
function factsOf(key) {
  const ck = `${stage.index}:${key}`;
  if (factCache.has(ck)) return factCache.get(ck);
  const p = parseKey(key), i = p.i, r = rows[i], m = markByKey.get(key);
  const id = itemOfKey(key);
  const base = { key, i, now: stage.index, kind: p.kind || m?.kind, side: p.side, id, when: `${dayTime(frames[i].at)} · ${frames[i].id}` };
  const counts = id ? countsTo(id, stage.index) : null;
  let f;
  if (base.kind === 'rest') {
    f = { ...base, short: `其余 ${m.subs.length} 件`, n: m.n, subs: m.subs.map(s => s.s) };
  } else if (base.kind === 'ans' || base.kind === 'lapse') {
    const ans = base.kind === 'ans', item = id;
    f = { ...base, short: ans ? '↩ 你作答' : '○ 失效', item,
      lines: ans ? foldSentences(r.answers).map(x => ({ text: x.label, at: x.first.event.at, ask: askById(x.first.link.ask) })) : r.lapsed.map(a => ({ text: howLapsed(a, i), ask: a })),
      shares: item ? [shareMaps[i - 1].get(item) || 0, shareMaps[i].get(item) || 0, i < LAST ? shareMaps[i + 1].get(item) || 0 : null] : null, counts };
  } else {
    // A block, or the spine's blank (which is the blank's block on whichever wing moved it).
    const s = m ? m.s : (r.gave.find(x => x.id === 'free') || r.took.find(x => x.id === 'free') || { id: 'free', n: 0, before: r.before, after: r.free });
    const side = m ? m.side : r.gave.some(x => x.id === 'free') ? 'l' : r.took.some(x => x.id === 'free') ? 'r' : null;
    const other = side === 'l' ? r.took : side === 'r' ? r.gave : [];
    const lastZero = id === 'free' ? [...rows.slice(0, i)].reverse().find(x => x.free === 0)?.i ?? null : null;
    f = { ...base, side, short: id === 'free' ? '留白' : shortOf(id), title: id === 'free' ? '' : titleAt(id, i), n: s.n, before: s.before, after: s.after,
      dir: side === 'l' ? (id === 'free' ? '动用' : '让出') : side === 'r' ? (id === 'free' ? '退回' : '拿到') : '不变',
      gone: s.after === 0 && id !== 'free' ? (records[i].snapshot.items[id]?.status === 'merged' ? `并入${shortOf(records[i].snapshot.items[id].merged_into)}` : '撤下') : '',
      other, otherWord: side === 'l' ? '同一轮拿到' : '同一轮让出', asks: openAsks(id, stage.index), closed: closedIn(id, i),
      responses: id === 'free' ? [] : foldSentences(responsesIn(i).filter(x => rootOf(x.link.target) === id)),
      summary: id === 'free' ? '留白是没有分配的份额：左边是这一轮被动用的，右边是退回的。' : records[i].snapshot.items[id]?.summary || '', lastZero, counts };
  }
  factCache.set(ck, f);
  return f;
}
function countsTo(id, upto) {
  const list = appearances.get(id) || [];
  const sum = (side, k) => { const xs = list.filter(a => a.side === side && a.i <= k); return [xs.length, xs.reduce((s, a) => s + a.n, 0)]; };
  return { gave: sum('l', upto), took: sum('r', upto), gaveAll: sum('l', LAST), tookAll: sum('r', LAST) };
}
const peerLine = (word, list) => {
  if (!list.length) return '';
  const shown = list.slice(0, 4).map(s => `${s.id === 'free' ? '留白' : shortOf(s.id)} ${s.n}`).join(' · ');
  return `${word}：${shown}${list.length > 4 ? ` 等 ${list.length} 件` : ''}`;
};
const roundsWord = f => (f.counts ? `到此刻让出 ${f.counts.gave[0]} 轮、拿到 ${f.counts.took[0]} 轮` : '');
const askRow = a => `<div class="ix-ask"><i></i><span>${esc(askShort(a))}</span>${dueOf(a) ? `<small>${esc(dueOf(a))}</small>` : ''}</div>`;
function peekCard(f, { seen }) {
  const unsettled = !seen.share && f.i === stage.index;
  if (f.kind === 'rest') {
    return `<div class="ix-k">${esc(f.when)} · ${f.side === 'l' ? '让出' : '拿到'}</div><div class="ix-q">${esc(f.short)} · ${f.n} 份</div>
      ${unsettled ? '<div class="ix-d">本轮还没平账</div>' : f.subs.map(s => `<div class="ix-d">${esc(shortOf(s.id))} ${s.before} → ${s.after}</div>`).join('')}<div class="ix-d y-pk-hint">点开逐件</div>`;
  }
  if (f.kind === 'ans' || f.kind === 'lapse') {
    const sh = f.shares && !unsettled ? `<div class="ix-d">${esc(shortOf(f.item))} 这一轮 ${f.shares[0]} → ${f.shares[1]}${f.shares[2] != null ? `，下一轮之后 ${f.shares[2]}` : ''}</div>` : '';
    return `<div class="ix-k">${esc(f.when)}</div><div class="ix-q">${f.kind === 'ans' ? '这一轮你作答' : '这一轮问题失效'}</div>
      ${f.lines.map(l => `<div class="ix-d y-pk-line">${esc(l.text)}${l.ask ? `<br>${f.kind === 'ans' ? '答' : ''}「${esc(askShort(l.ask))}」` : ''}</div>`).join('')}${sh}`;
  }
  const change = unsettled ? '本轮还没平账' : f.side ? `这一轮 ${f.before} → ${f.gone || f.after}（${minus(f.side === 'l' ? -f.n : f.n)}）· ${f.dir}` : `这一轮不变 · 留白 ${f.after} / 64`;
  const free = f.id === 'free' ? `<div class="ix-d">留白 ${unsettled ? f.before : f.after} / 64${f.lastZero != null ? ` · 上一次为 0：${esc(frames[f.lastZero].id)}` : ''}</div>` : '';
  const closed = unsettled ? '' : [...f.closed.answered.map(a => `<div class="ix-d">答掉「${esc(askShort(a))}」</div>`), ...f.closed.lapsed.map(a => `<div class="ix-d">失效「${esc(askShort(a))}」</div>`)].join('');
  return `<div class="ix-k">${esc(f.when)}${f.side ? ` · ${f.dir}` : ''}</div><div class="ix-q">${esc(f.short)}</div>
    ${f.title ? `<div class="ix-d y-pk-title">${esc(f.title)}</div>` : ''}<div class="ix-d">${esc(change)}</div>${free}
    ${unsettled ? '' : `<div class="ix-d">${esc(peerLine(f.otherWord, f.other))}</div>`}${closed}
    ${f.asks.map(askRow).join('')}${f.counts && f.id !== 'free' ? `<div class="ix-d y-pk-rounds">${esc(roundsWord(f))}</div>` : ''}`;
}
function detailCard(f, { seen, href }) {
  const unsettled = !seen.share && f.i === stage.index;
  const close = '<button type="button" data-x="close" aria-label="收回（Esc）" title="收回（Esc）">×</button>';
  const asks = list => `<section><h5>开着的问题<b>此刻 ${esc(frames[stage.index].id)}</b></h5>${list.length ? list.slice(0, 3).map(a => `<div class="ix-d-ask"><i></i><p>${esc(a.prompt)}</p><small>${esc(dueOf(a) || '没有期限')}</small><a href="${esc(href)}">去回答 →</a></div>`).join('') : '<p class="ix-none">没有开着的问题</p>'}</section>`;
  if (f.kind === 'rest') {
    return `<div class="ix-d-k"><span>${esc(f.when)} · ${f.side === 'l' ? '让出' : '拿到'}</span>${close}</div><div class="ix-d-t">${esc(f.short)} · ${f.n} 份</div>
      <section><h5>逐件</h5><ul class="ix-d-kids">${f.subs.map(s => `<li><span>${esc(shortOf(s.id))}</span><b>${s.before} → ${s.after}</b></li>`).join('')}</ul></section>`;
  }
  if (f.kind === 'ans' || f.kind === 'lapse') {
    return `<div class="ix-d-k"><span>${esc(f.when)}</span>${close}</div><div class="ix-d-t">${f.kind === 'ans' ? '这一轮你作答' : '这一轮问题失效'}</div>
      <section><h5>${f.kind === 'ans' ? '你的回应' : '怎么关上的'}</h5><ul class="ix-d-fb">${f.lines.map(l => `<li>${l.at ? `<time>${esc(timeOf(l.at))}</time>` : ''}${esc(l.text)}${l.ask ? `，${f.kind === 'ans' ? '答' : ''}「${esc(askShort(l.ask))}」` : ''}</li>`).join('')}</ul></section>
      ${f.item && f.shares ? `<section><h5>${esc(shortOf(f.item))}<b>${f.shares[0]} → ${f.shares[1]}${f.shares[2] != null ? ` → ${f.shares[2]}` : ''}</b></h5><p class="ix-none">这一轮之前 → 这一轮之后 → 下一轮之后</p></section>` : ''}
      ${f.item ? asks(openAsks(f.item, stage.index)) : ''}`;
  }
  const head = unsettled ? `${esc(f.short)} ${f.before} → …` : f.side ? `${esc(f.short)} ${f.before} → ${esc(String(f.gone || f.after))}（${minus(f.side === 'l' ? -f.n : f.n)}）` : `${esc(f.short)} ${f.after} / 64`;
  const responses = f.responses.length ? `<section><h5>这一轮你的回应</h5><ul class="ix-d-fb">${f.responses.map(x => `<li><time>${esc(timeOf(x.first.event.at))}</time>${esc(x.label)}${x.first.link.ask ? `，答「${esc(askShort(askById(x.first.link.ask) || {}))}」` : ''}</li>`).join('')}</ul></section>` : '';
  // Answered ones are in the responses above; a lapse has no response, so it gets its own line.
  const closed = unsettled ? '' : f.closed.lapsed.map(a => `<li>失效「${esc(askShort(a))}」：${esc(howLapsed(a, f.i))}</li>`).join('');
  return `<div class="ix-d-k"><span>${esc(f.when)}${f.side ? ` · ${f.dir}` : ''}</span>${close}</div>
    <div class="ix-d-t">${head}</div>${f.title ? `<div class="ix-d-s">${esc(f.title)}</div>` : ''}
    ${f.id === 'free' ? `<div class="ix-d-s">留白 ${unsettled ? f.before : f.after} / 64${f.lastZero != null ? ` · 上一次为 0：${esc(dayTime(frames[f.lastZero].at))}（${esc(frames[f.lastZero].id)}）` : ''}</div>` : ''}
    ${unsettled ? '<p class="ix-none">本轮还没平账</p>' : f.other.length ? `<section><h5>${f.otherWord}<b>${f.n} 份</b></h5><p class="y-dc-peers">${f.other.map(s => `<span><i style="--c:${s.id === 'free' ? 'transparent' : colorOf(s.id)}" class="${s.id === 'free' ? 'is-free' : ''}"></i>${esc(s.id === 'free' ? '留白' : shortOf(s.id))} ${minus(f.side === 'l' ? s.n : -s.n)}</span>`).join('')}</p><p class="ix-none">回执只记每件事增减多少，不记谁让给谁</p></section>` : ''}
    ${responses}${closed ? `<section><h5>这一轮失效的问题</h5><ul class="ix-d-fb">${closed}</ul></section>` : ''}
    ${f.id !== 'free' ? asks(f.asks) : ''}
    ${f.summary ? `<p class="ix-d-sum">${esc(f.summary)}</p>` : ''}`;
}

// ---------- side panel: “这一件” (two weeks of one thing) ----------
let panelKey = null, lead = null;
function exchangeLine(a, current, inCarry = false) {
  const row = rows[a.i];
  const counter = a.side === 'l' ? row.took : row.gave;
  const after = a.after === 0 && a.id !== 'free' ? (records[a.i].snapshot.items[a.id]?.status === 'merged' ? '并入' : '撤下') : a.after;
  return `<li class="${a.i > current ? 'is-later' : ''}${a.i === current ? ' is-now' : ''}${inCarry && marksCover(a.i) ? ' is-carry' : ''}"><button type="button" data-st="go" data-frame="${a.i}"><time>${esc(dayTime(frames[a.i].at))}</time></button>
    <b>${a.before || '新增'} → ${after}</b><span class="y-dir">${a.side === 'l' ? '同轮拿到' : '同轮让出'}</span><span class="y-peers">${peersText(counter)}</span></li>`;
}
// The rows the carry's ink line spans (f23–f26), when the blank is opened somewhere inside them.
const marksCover = i => carry && i >= carry.a && i <= carry.rows.at(-1);
function trendSVG(series, at, H = 32) {
  const n = LAST, W = 300, top = Math.max(24, ...series), bw = W / n;
  const bars = series.slice(1).map((s, k) => {
    const h = s ? Math.max(1.5, (s / top) * (H - 2)) : 1, i = k + 1;
    return `<rect x="${(k * bw + bw * 0.15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" class="${i === at ? 'is-now' : i > stage.index ? 'is-later' : s ? '' : 'is-off'}"/>`;
  }).join('');
  return `<svg class="ix-trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg><div class="ix-axis"><span>${esc(frames[1].id)}</span><span>${esc(frames[LAST].id)}</span></div>`;
}
function panelFor(view) {
  const id = view.kind === 'rest' ? null : view.item || view.id;
  return i => {
    const kick = `这一件 · ${frames[view.i].id}${view.dir ? ` · ${view.dir}` : ''}`;
    if (!id) return { kicker: kick, title: esc(view.short), body: `<ul class="y-list">${view.subs.map(s => `<li>${nameChip(s.id)}<span>${s.before} → ${s.after}</span><b>${signed(view.side === 'l' ? -s.n : s.n)}</b></li>`).join('')}</ul>` };
    const c = countsTo(id, i);
    const [g1, t1] = id === 'free' ? ['动用', '退回'] : ['让出', '拿到'];
    const acct = `<p class="y-acct">到此刻：${g1} ${c.gave[0]} 轮 ${c.gave[1]} 份 · ${t1} ${c.took[0]} 轮 ${c.took[1]} 份<br><small>两周合计：${g1} ${c.gaveAll[0]} 轮 ${c.gaveAll[1]} 份 · ${t1} ${c.tookAll[0]} 轮 ${c.tookAll[1]} 份</small></p>`;
    if (id === 'free') {
      const list = rows.slice(1).filter(r => r.gave.some(s => s.id === 'free') || r.took.some(s => s.id === 'free'));
      const cover = carry && marksCover(view.i) ? `<p class="y-carry-note">墨线：${esc(frames[carry.a - 1].id)} 留白为 0，${esc(frames[carry.a].id)} 退回 ${rows[carry.a].free}，此后到 ${esc(frames[carry.rows.at(-1)].id)} 只减不增：这几轮动用的 ${rows[carry.a].free - rows[carry.rows.at(-1)].free} 份都是 ${esc(frames[carry.a].id)} 退回的那些。份额不分彼此，这是账，不是谁给了谁。</p>` : '';
      return { kicker: kick, title: `留白 ${rows[i].free} / 64`,
        body: `<section><h4>留白 · 逐轮</h4>${trendSVG(seriesOf('free'), view.i)}</section>${acct}${cover}
          <section><h4>动用与退回 <small>${list.length} 轮</small></h4><ul class="y-exch">${list.map(r => exchangeLine(appearances.get('free').find(a => a.i === r.i), i, Boolean(cover))).join('')}</ul></section>` };
    }
    const mine = appearances.get(id) || [];
    const asks = [...new Map(frames.flatMap(fr => Object.values(fr.asks || {})).filter(a => rootOf(a.item) === id).map(a => [a.id, a])).values()];
    const closes = [];
    rows.forEach(r => { for (const a of r.closed) if (rootOf(a.item) === id) closes.push({ i: r.i, a, how: '答', }); for (const a of r.lapsed) if (rootOf(a.item) === id) closes.push({ i: r.i, a, how: '失效' }); });
    const closeList = closes.length ? `<section><h4>问题关上的那几轮 <small>前 → 后</small></h4><ul class="y-closes">${closes.map(x => `<li class="${x.i > i ? 'is-later' : ''}"><button type="button" data-st="go" data-frame="${x.i}"><time>${esc(frames[x.i].id)}</time></button><span>${x.how}「${esc(askShort(x.a))}」</span><b>${shareMaps[x.i - 1].get(id) || 0} → ${shareMaps[x.i].get(id) || 0}</b></li>`).join('')}</ul></section>` : '';
    let leadHTML = '';
    if (lead && lead.id === id) {
      const r = rows[lead.i];
      const said = lead.kind === 'lapse' ? r.lapsed.filter(a => rootOf(a.item) === id).map(a => `<p>${esc(howLapsed(a, lead.i))}<br><small>「${esc(askShort(a))}」</small></p>`).join('')
        : foldSentences(r.answers.filter(a => rootOf(a.link.target) === id)).map(x => `<p><time>${esc(dayTime(x.first.event.at))}</time> ${esc(x.label)}<br><small>答「${esc(askById(x.first.link.ask)?.prompt || '')}」</small></p>`).join('');
      const later = mine.filter(a => a.side === 'l' && a.i >= lead.i);
      leadHTML = `<section class="y-answer"><h4>${lead.kind === 'lapse' ? '失效' : '作答'}</h4>${said}
        <h4>之后让出的份额 <small>同一轮拿到的是谁</small></h4>${later.length ? `<ul class="y-exch">${later.map(a => exchangeLine(a, i)).join('')}</ul><p class="st-muted y-fine">回执只记每件事增减多少，没有记谁为谁让位；这里列的是同一轮里拿到份额的事项。灰色是此刻之后的轮次。</p>` : '<p class="st-muted">到最后一帧它都没有让出份额。</p>'}</section>`;
    }
    const upto = mine.filter(a => a.i <= i && (!lead || lead.id !== id || a.i < lead.i || a.side === 'r'));
    const exch = upto.length ? `<section><h4>份额往来 <small>${upto.length} 轮</small></h4><ul class="y-exch">${upto.slice(-10).map(a => exchangeLine(a, i)).join('')}</ul>${upto.length > 10 ? `<p class="st-muted">更早还有 ${upto.length - 10} 轮。</p>` : ''}</section>` : '';
    const nowItem = records[i].snapshot.items[id];
    return {
      kicker: kick, title: `<span class="y-title-chip" style="--c:${colorOf(id)}"></span>${esc(titleAt(id, i))}`,
      body: `<section><h4>份额 · 逐轮 <small>${esc(shortOf(id))} 此刻 ${shareMaps[i].get(id) || 0} / 64${nowItem ? ` · ${esc(kindWord(nowItem))}` : ''}</small></h4>${trendSVG(seriesOf(id), view.i)}</section>
        ${acct}${leadHTML}${closeList}${exch}
        <details class="y-more"><summary>摘要、依据、来源与版本${asks.length ? ` · 登记过 ${asks.length} 个问题` : ''}</summary>${itemDetailHTML(id, i)}</details>`,
    };
  };
}
function openPanel(view) {
  panelKey = view.key;
  if (!lead || lead.key !== view.key) lead = null;
  stage.showDetail(panelFor(view));
  const id = view.item || view.id;
  document.querySelector('.st-title').textContent = `这一件 · ${frames[view.i].id} · ${dayTime(frames[view.i].at)} / ${view.kind === 'rest' ? view.short : id === 'free' ? '留白' : shortOf(id)}`;
  // The thing is drawn in every row it moved in: open the small-share groups that hold it.
  for (const k of autoOpen) if (!openRest.has(k)) setRestOpen(k, unfoldAll);
  autoOpen.clear();
  if (id && id !== 'free' && view.kind !== 'rest') for (const a of appearances.get(id) || []) {
    const m = markByKey.get(K(a.i, a.side, id));
    if (m?.kind === 'sub' && !restOpen(m.rest)) { autoOpen.add(m.rest.rk); setRestOpen(m.rest.rk, true); }
  }
}
function closePanel() {
  if (!panelKey) return;
  panelKey = null; lead = null;
  for (const k of autoOpen) if (!openRest.has(k)) { autoOpen.delete(k); setRestOpen(k, unfoldAll); }
  autoOpen.clear();
  stage.showDetail(null);
  document.querySelector('.st-title').textContent = frames[stage.index].title;
}
stage.onEscape = () => { if (ix.s.open) { ix.close(); return true; } return false; };
function setRestOpen(rk, open) {
  const el = figure.querySelector(`[data-rest="${rk}"]`);
  if (!el) return;
  el.classList.toggle('is-open', open);
  el.setAttribute('aria-expanded', String(open));
}
/** The block an answer or a lapse points at in its row (opened from ↩, ○ or the side panel), else the mark itself. */
function blockFor(i, id, kind) {
  if (!id) return null;
  const m = [...layout[i].l, ...layout[i].r].flatMap(x => (x.kind === 'rest' ? x.subs : [x])).find(x => x.id === id);
  if (!m) return null;
  if (m.kind === 'sub' && !restOpen(m.rest)) { autoOpen.add(m.rest.rk); setRestOpen(m.rest.rk, true); }
  lead = { key: m.key, i, id, kind };
  return m.key;
}

// ---------- focus: dim, outline and pop, from ix.frame() ----------
let litKey, popped = null;
const lit = new Set();
function applyLight(key) {
  for (const el of lit) el.classList.remove('is-lit', 'is-peer', 'has-lit');
  lit.clear();
  if (!key) return;
  const p = parseKey(key), id = itemOfKey(key);
  const add = (el, cls) => { el.classList.add(cls); lit.add(el); };
  const own = figure.querySelector(`[data-id="${CSS.escape(key)}"]`);
  if (own) add(own, 'is-lit');
  if (id) {
    for (const el of figure.querySelectorAll(`[data-item="${CSS.escape(id)}"]`)) {
      add(el, 'is-lit');
      const rest = el.closest('.y-rest');
      if (rest) add(rest, 'has-lit');
    }
    // Same-round counterparts: where it gave, everything on the right took; where it took, the left gave.
    for (const a of appearances.get(id) || []) {
      const row = els.rows[a.i];
      if (!row || a.i > stage.index) continue;
      for (const el of row.querySelectorAll(`.y-${a.side === 'l' ? 'r' : 'l'} [data-item], .y-${a.side === 'l' ? 'r' : 'l'} .y-rest`)) if (!el.classList.contains('is-lit')) add(el, 'is-peer');
    }
  } else if (p?.id === '*') {
    const rest = markByKey.get(key);
    for (const sub of rest.subs) { const el = figure.querySelector(`[data-id="${CSS.escape(sub.key)}"]`); if (el) add(el, 'is-lit'); }
  }
}
let opShown = '';
function paintFocus() {
  const focus = X.dim > 0.001 ? X.focus : null;
  const k = `${focus}|${X.keyFocus}`;
  if (k !== litKey) {
    litKey = k;
    applyLight(focus);
    figure.querySelector('.is-key')?.classList.remove('is-key');
    if (X.keyFocus) figure.querySelector(`[data-id="${CSS.escape(X.keyFocus)}"]`)?.classList.add('is-key');
  }
  // Hovered: the rest go to 70 %. Opened: to 18 %, along with the step-out.
  const fixed = X.popId ? clamp(X.pop) : 0, op = (1 - (0.3 + 0.52 * fixed) * X.dim).toFixed(3);
  if (op !== opShown) { opShown = op; figure.style.setProperty('--y-op', op); }
  figure.classList.toggle('is-focus', Boolean(focus));
  const m = X.popId && X.pop > 0.001 ? markByKey.get(X.popId) : null;
  const el = m && m.kind !== 'rest' ? figure.querySelector(`[data-id="${CSS.escape(X.popId)}"]`) : null;
  if (popped && popped !== el) { popped.style.transform = ''; popped.classList.remove('is-popped'); }
  popped = el;
  if (el) { el.style.transform = `translateX(${((m.side === 'l' ? -1 : 1) * IX.pop * X.pop).toFixed(2)}px)`; el.classList.add('is-popped'); }
}
function paintPanel() {
  if (X.detail && ix.view && panelKey !== ix.view.key) openPanel(ix.view);
  else if (!X.detail && panelKey) closePanel();
}
// Keyboard proxies: the current row first, then the rows above it from the top; ↑/↓ moves to the nearest mark a row away.
const proxyMarks = i => [
  ...(rows[i].asked.length ? [{ key: K(i, 'a', 'ans'), label: '你作答' }] : []),
  ...(rows[i].lapsed.length ? [{ key: K(i, 'x', 'lapse'), label: '问题失效' }] : []),
  ...visibleMarks(i, 'l').slice().reverse().map(m => ({ key: m.key, label: `${m.kind === 'rest' ? `其余 ${m.subs.length} 件` : m.id === 'free' ? '留白' : shortOf(m.id)} 让出 ${m.n} 份` })),
  { key: K(i, 's', 'free'), label: `此后留白 ${rows[i].free}` },
  ...visibleMarks(i, 'r').map(m => ({ key: m.key, label: `${m.kind === 'rest' ? `其余 ${m.subs.length} 件` : m.id === 'free' ? '留白' : shortOf(m.id)} 拿到 ${m.n} 份` })),
].filter(x => hasKey(x.key)).map(x => ({ id: x.key, label: `${dayTime(frames[i].at)} · ${x.label}` }));
const proxyKey = () => `${stage.index}|${unfoldAll}|${[...openRest, ...autoOpen].join(',')}|${post && !post.settled ? `${post.i}:${Math.floor(post.t * 4)}` : ''}`;
const proxyList = () => [stage.index, ...rows.slice(1, stage.index).map(r => r.i)].filter(i => i > 0).flatMap(proxyMarks);
stage.onKey = event => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
  const cur = document.activeElement?.dataset?.ix;
  const p = cur && parseKey(cur);
  const visible = rows.slice(1, stage.index + 1).map(r => r.i).filter(i => proxyMarks(i).length);
  if (!visible.length) return true;
  const focusKey = key => figure.querySelector(`.ix-sr [data-ix="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  if (!p) { focusKey(proxyMarks(stage.index)[0]?.id || proxyMarks(visible.at(-1))[0].id); return true; }
  const k = visible.indexOf(p.i) + (event.key === 'ArrowUp' ? -1 : 1);
  const target = visible[clamp(k, 0, visible.length - 1)];
  const x = centreOf(cur)?.x ?? geo.spineC;
  const best = proxyMarks(target).reduce((a, b) => (Math.abs((centreOf(b.id)?.x ?? 0) - x) < Math.abs((centreOf(a.id)?.x ?? 0) - x) ? b : a));
  focusKey(best.id);
  return true;
};

// ---------- pointer: groups unfold, ↩ and ○ open the block they point at, notes jump ----------
// Capture phase, so these clicks never reach ix's own handler (which would open the group or the mark itself).
figure.addEventListener('click', event => {
  const proxy = event.target.closest?.('.ix-sr [data-ix]');
  const key = proxy ? proxy.dataset.ix : event.target.closest?.('[data-id]')?.dataset.id;
  const p = key && parseKey(key);
  if (!p) {
    const note = event.target.closest?.('.y-note');
    if (note) { event.stopPropagation(); stage.go(Number(note.closest('.y-row').dataset.row)); }
    return;
  }
  // Touch: the first tap is the hover (ix), the second acts.
  if (!proxy && ix.s.pointer === 'touch' && ix.s.hover !== key && !ix.s.open) return;
  const m = markByKey.get(key);
  if (m?.kind === 'rest') {
    event.stopPropagation();
    if (openRest.has(m.rk)) openRest.delete(m.rk); else openRest.add(m.rk);
    autoOpen.delete(m.rk);
    setRestOpen(m.rk, restOpen(m));
    ix.hover(null, 'now');
    return;
  }
  if (p.kind === 'ans' || p.kind === 'lapse') {
    const target = blockFor(p.i, itemOfKey(key), p.kind);
    if (!target) { lead = { key, i: p.i, id: itemOfKey(key), kind: p.kind }; return; }
    event.stopPropagation();
    if (ix.s.open === target && ix.s.closeAt == null) ix.close(); else ix.open(target, Boolean(proxy));
  }
}, true);
document.querySelector('.st-side').addEventListener('click', event => {
  const chip = event.target.closest('[data-pin]'), answer = event.target.closest('[data-answer-pin]');
  if (answer) {
    const i = Number(answer.dataset.answerRow), id = answer.dataset.answerPin;
    const target = blockFor(i, id, 'ans') || (rows[i].asked.length ? K(i, 'a', 'ans') : null);
    if (target) ix.open(target);
    return;
  }
  if (chip) {
    const id = chip.dataset.pin;
    const a = (appearances.get(id) || []).filter(x => x.i <= stage.index).at(-1);
    if (a) { const target = blockFor(a.i, id, null); lead = null; if (target) ix.open(target); }
  }
});
// The note column keeps its small tip (the round's tags); time and note jump to their frame.
figure.addEventListener('pointerover', event => {
  const note = event.target.closest?.('.y-note');
  if (!note) return;
  const r = rows[note.closest('.y-row').dataset.row];
  stage.tip(`<b>${esc(frames[r.i].title)}</b>${r.tags.length ? `<br>${esc(r.tags.join(' · '))}` : ''}<br><small>让出 ${r.total} = 拿到 ${r.total} · 此后留白 ${r.free} · 点击跳到这一帧</small>`, note);
});
figure.addEventListener('pointerout', event => { if (event.target.closest?.('.y-note') && !event.relatedTarget?.closest?.('.y-note')) stage.untip(); });
document.querySelector('.st-tools').addEventListener('click', event => {
  const b = event.target.closest('[data-y]');
  if (!b) return;
  if (b.dataset.y === 'tell') { if (run.kind === 'tell') skipTell(); else startTell(); return; }
  unfoldAll = b.dataset.y === 'unfold';
  document.querySelectorAll('[data-y="fold"],[data-y="unfold"]').forEach(x => x.setAttribute('aria-pressed', String((x.dataset.y === 'unfold') === unfoldAll)));
  for (const rest of figure.querySelectorAll('[data-rest]')) { const [i, side] = rest.dataset.rest.split(':'); setRestOpen(rest.dataset.rest, restOpen(markByKey.get(K(i, side, '*')))); }
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
  paintNow(w);
  paintPost();
  paintCells(1 - 0.6 * X.dim);
  paintMarks();
  paintSide();
  paintFocus();
  paintPanel();
  ix.paint();
  ix.sync(proxyKey(), proxyList);
  if (perf.on) perf.work.push(performance.now() - t0);
  requestAnimationFrame(loop);
}

let resizeTimer = null;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });
render();
if (autoTell) startTell();
requestAnimationFrame(loop);

const p95 = list => [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.95)] || 0;
// Hooks with the same names and meanings as foldDial and foldPulse (ix.mjs), plus a row: open('猫看病', 23).
window.foldYield = {
  ...ix.hooks(),
  hover: (name, i) => ix.hover(keyFor(name, i ?? stage.index), 'pointer'),
  open: (name, i) => ix.open(keyFor(name, i ?? stage.index)),
  pointOf: (name, i) => { const c = centreOf(keyFor(name, i ?? stage.index)); if (!c) return null; const b = figure.getBoundingClientRect(); return { x: b.left + c.x, y: b.top + c.y }; },
  /** A point `d` px past a block's outer end, along its row (the widened hit band). */
  nearOf: (name, d = 9, i) => { const key = keyFor(name, i ?? stage.index), r = rectOf(key), b = figure.getBoundingClientRect(); if (!r) return null; return { x: b.left + (sideOfKey(key) === 'l' ? r.x0 - d : r.x1 + d), y: b.top + (r.y0 + r.y1) / 2 }; },
  /** The outermost named block of the current row (clear space past its outer end), else the blank. */
  pick: () => { for (const side of ['l', 'r']) { const m = layout[stage.index][side].at(-1); if (m && m.kind === 'seg' && hasKey(m.key)) return shortOf(m.id); } return '留白'; },
  tell: startTell, skip: skipTell, tellAt, play: startPlay, stop: stopRun,
  telling: () => run.kind === 'tell', playing: () => run.kind === 'play',
  settled: () => !post || post.settled, phase: () => (post ? { i: post.i, mode: post.mode, t: +post.t.toFixed(3), settled: post.settled } : null),
  rows, plan, carry, CAP,
  perf: () => {
    const ts = perf.times.slice(1), avg = ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length), work = perf.work.slice(1);
    return { frames: ts.length, fps: +(1 / avg).toFixed(1), p95ms: +(p95(ts) * 1000).toFixed(1), workMs: +(work.reduce((a, b) => a + b, 0) / Math.max(1, work.length)).toFixed(2), workP95ms: +p95(work).toFixed(2) };
  },
  resetPerf: () => { perf.on = true; perf.times = []; perf.work = []; },
};
