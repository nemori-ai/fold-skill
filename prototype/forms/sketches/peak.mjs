// 07 峰值保持（第四轮，完整版）：上次接触锚点之后的起落。一件事一根竖表：实心是此刻的份额，粗横线停在你离开期间
// 到过的最高，虚线是你上次看时；表头框写峰值，上次与此刻都没这么高的（看不出来的起落）涂黑；峰值旁的圈号按分段谱的
// 办法，从你上次看之后的第 1 轮数起。峰值一直停着，直到你按左下朱红描边的“已阅”。
//
// 锚点（polish/peak-motion.md 第 2 节）：last_seen_at 恒为 null，“上次看”是页面侧的推定：?seen= 或下拉选的帧；本页按过的
//   “已阅”；你最近一次在 Fold 里回应（via button / reply）时屏上的那一帧（回应在第 k 帧的输入里，锚点取 k − 1）；
//   都没有就取此刻往前 6 轮。“已阅”只在本页内存，可撤回，下一轮离开时从这里重新累积。
// 动起来（第 3 节）：换轮时条升快落慢，峰值线被条顶上去就停住，落下的一段留一块灰影（概念层，0.6 秒淡完，静止为零）。
//   讲一遍：只在顶层直接打开、不带 ?frame= / ?seen=、不是从别处链来时演三拍（你不在、此刻看不出来、已阅），任意键跳过，
//   顶栏“↺ 重演”重讲；讲一遍里的“已阅”只是演示，讲完撤回。连播（空格）每轮 1.6 秒，→ 逐帧 0.6 秒，跳帧 0.25 秒。
// 交互接 motion/ix.mjs：悬停一根表出概要卡；点击它沿自己的轴向上弹出 8 px，引线接详情卡，侧栏切到“这一件”。
//   卡上的“去回答 →”只给此刻开着的问题，链到同一帧的 D。只读回放，帧号是本页常量，不改数据。
import {
  createStage, esc, frames, records, dayTime, shortOf, titleAt, responsesIn, itemDetailHTML,
  kindWord, reduced, foldSentences, askLife, rootOf, responseSentence,
} from './stage.mjs';
import { textWidth } from './kit.mjs';
import { createIx, IX } from '../motion/ix.mjs';
import { dueText } from '../motion/dial-model.mjs';
import { withDataset, currentDataset } from '../../data/select.mjs';

const LAST = frames.length - 1;
const AWAY = 6;          // no Fold response yet: assume the last look was this many rounds back
const MIN_PEAK = 3;      // 1 share is the floor every kept item sits on; a rise means reaching the next tier
const MAX_METERS = 24;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeIn = k => clamp(k) ** 2.2;
const easeInOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
const indexOfId = id => frames.findIndex(frame => frame.id === id);
/** A frame named by id ("f20") or by index ("20"), else -1. */
function frameIndexOf(value) {
  if (value == null || value === '') return -1;
  const byId = indexOfId(value);
  if (byId >= 0) return byId;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= LAST ? n : -1;
}
const circled = n => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`);

// ---------- the anchor: who last looked, and when (a guess; the replay records no viewing) ----------
const viaFold = link => link.via === 'button' || link.via === 'reply';
const inFold = frames.map(frame => frame.events.filter(event => (event.feedback || []).some(viaFold)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)));
/** Rule 3–4: the frame on screen when you last responded in Fold (a response in frame k was read by round k, so you saw
 *  k − 1), else AWAY rounds back. */
function anchorOf(now) {
  for (let k = now; k >= 1; k -= 1) if (inFold[k].length) {
    const event = inFold[k].at(-1);
    return { a: k - 1, why: 'fold', k, event, link: event.feedback.find(viaFold) };
  }
  return { a: Math.max(0, now - AWAY), why: 'away' };
}
const movesCache = new Map();
const sourceMoves = (a, now) => {
  const key = `${a}:${now}`;
  if (!movesCache.has(key)) { let n = 0; for (let k = a + 1; k <= now; k += 1) n += responsesIn(k).filter(r => !viaFold(r.link)).length; movesCache.set(key, n); }
  return movesCache.get(key);
};

// ---------- the story: the default frame per dataset (a page constant), the anchor and rounds read off the replay ----------
const DEFAULT = { composite: 'f26', story: 'f20' };
const defaultIndex = (() => { const k = indexOfId(DEFAULT[currentDataset()] || ''); return k >= 0 ? k : LAST; })();
const plan = (() => {
  const rule = anchorOf(defaultIndex), n = defaultIndex - rule.a;
  return n >= 1 ? { from: rule.a, end: defaultIndex, n, R: Math.min(1.2, 5.4 / n), rule } : null;
})();

// Told only when opened on its own: top level, no ?frame= or ?seen=, and not followed from another page.
const query = new URLSearchParams(location.search);
const fromElsewhere = (() => { try { return Boolean(document.referrer) && new URL(document.referrer).pathname !== location.pathname; } catch { return false; } })();
const autoTell = Boolean(plan) && window.parent === window && !query.has('frame') && !query.has('seen') && !fromElsewhere;
if (!query.has('frame')) { query.set('frame', frames[autoTell && !reduced() ? plan.from : defaultIndex].id); history.replaceState(null, '', `?${query}`); }

const key = `
  <span><svg width="12" height="14"><rect x="1" y="4" width="10" height="10" fill="var(--ink)"/></svg>实心：此刻的份额</span>
  <span><svg width="18" height="12"><line x1="0" y1="6" x2="18" y2="6" stroke="var(--ink)" stroke-width="2.4"/></svg>粗横线：离开期间的最高，一直停着</span>
  <span><svg width="20" height="12"><line x1="0" y1="6" x2="20" y2="6" stroke="var(--ink-2)" stroke-width="1.2" stroke-dasharray="3 2"/></svg>虚线：你上次看时</span>
  <span><svg width="12" height="12"><rect x="0.5" y="0.5" width="11" height="11" fill="url(#pk-key-hatch)" stroke="var(--line)"/><defs><pattern id="pk-key-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="var(--ink-3)" stroke-width="1.2"/></pattern></defs></svg>斜线：比峰值少掉的</span>
  <span><svg width="22" height="14"><rect x="0.5" y="0.5" width="21" height="13" fill="var(--ink)"/><text x="11" y="10.5" text-anchor="middle" font-size="9" font-family="var(--mono)" fill="var(--paper)">24</text></svg>黑底表头：上次和此刻都没这么高</span>
  <span><svg width="14" height="14"><circle cx="7" cy="7" r="6" fill="var(--paper)" stroke="var(--ink)"/><text x="7" y="10" text-anchor="middle" font-size="8.5" font-family="var(--mono)" fill="var(--ink)">2</text></svg>离开后第几轮到峰</span>
  <span><i class="pk-key-ghost"></i>灰影：刚落下的一段，落定后不留</span>
  <span class="note"><kbd>←</kbd><kbd>→</kbd> 逐帧 <kbd>空格</kbd> 连播 <kbd>Tab</kbd> 逐根 <kbd>Enter</kbd> 展开 <kbd>Esc</kbd> 收回</span>`;
const stage = createStage({
  id: 'peak', no: 12, name: '峰值保持', storyIndex: defaultIndex, key,
  relation: '上次接触锚点之后的起落：你不在的时候升起又落下、此刻已经看不出来的事；峰值一直停着，直到你按“已阅”。',
  tools: plan ? '<button type="button" class="pk-tell" data-p="tell" title="从头讲一遍（任意键跳过）">↺ 重演</button>' : '',
});
document.querySelector('.st-kicker').textContent = 'FOLD · 第四轮 · 完整版';
const figure = stage.figure;
figure.classList.add('pk-fig');

// ---------- data: root shares, and what each window looks like ----------
const shareMaps = frames.map((_, i) => new Map(records[i].state.root.items.map(item => [item.id, item.share])));
const SCALE = Math.max(26, ...shareMaps.flatMap(m => [...m.values()]).map(v => v + 2));
const viewCache = new Map();
/** Window a..now: per root item its shares, peak, round of the peak, and whether it rose and fell unseen. */
function viewOf(now, a) {
  const key = `${now}:${a}`;
  if (viewCache.has(key)) return viewCache.get(key);
  const ids = new Set();
  for (let k = a; k <= now; k += 1) for (const id of shareMaps[k].keys()) ids.add(id);
  const rows = [];
  for (const id of ids) {
    const s = [];
    for (let k = a; k <= now; k += 1) s.push(shareMaps[k].get(id) || 0);
    const peak = Math.max(...s), n = s.indexOf(peak), item = records[now].snapshot.items[id];
    const gone = s.at(-1) > 0 ? null : item?.status === 'merged' ? 'merged' : item?.status === 'withdrawn' ? 'withdrawn' : 'absent';
    rows.push({ id, s, peak, n, at: a + n, was: s[0], now: s.at(-1), first: s.findIndex(x => x > 0), gone, into: gone === 'merged' ? item.merged_into : null,
      hidden: peak > s[0] && peak > s.at(-1) && peak >= MIN_PEAK });
  }
  let shown = rows.filter(r => r.peak >= MIN_PEAK), over = [];
  if (shown.length > MAX_METERS) {
    const keep = new Set([...shown].sort((x, y) => y.hidden - x.hidden || y.peak - x.peak || x.id.localeCompare(y.id)).slice(0, MAX_METERS));
    over = shown.filter(r => !keep.has(r)); shown = shown.filter(r => keep.has(r));
  }
  // Two groups, as a partial kifu: what was on the board when you looked (by its share then), and what came since (in order).
  const left = shown.filter(r => r.was > 0).sort((x, y) => y.was - x.was || y.peak - x.peak || x.id.localeCompare(y.id));
  const right = shown.filter(r => r.was === 0).sort((x, y) => x.first - y.first || y.peak - x.peak || x.id.localeCompare(y.id));
  const meters = [...left, ...right];
  const traces = rows.filter(r => r.peak < MIN_PEAK);
  const v = { now, a, away: now - a, meters, left: left.length, byId: new Map(meters.map(m => [m.id, m])), rowById: new Map(rows.map(r => [r.id, r])),
    hidden: meters.filter(m => m.hidden), traces, traceRise: traces.filter(r => r.peak > r.was && r.peak > r.now), over };
  viewCache.set(key, v);
  return v;
}

// ---------- the anchor in use: the story, a chosen frame, your “已阅”, else the rule ----------
let override = null;            // {a, why: 'seen' | 'read'}
const undo = [];                // overrides before each 已阅
let tellAnchor = null;          // fixed while the story is told
{
  const k = frameIndexOf(query.get('seen'));
  if (k >= 0) override = { a: k, why: 'seen' };
}
function anchorAt(now) {
  if (tellAnchor != null) return { a: tellAnchor.a, why: 'tell', rule: plan.rule };
  const rule = anchorOf(now);
  if (override?.why === 'seen' && override.a < now) return { ...override, rule };
  // 已阅 holds until a later sign that you looked: a response in Fold after it moves the anchor on.
  if (override?.why === 'read' && override.a <= now && !(rule.why === 'fold' && rule.a > override.a)) return { ...override, rule };
  return { ...rule, rule };
}
const viewNow = (i = stage.index) => viewOf(i, anchorAt(i).a);
const anchorKey = () => { const x = anchorAt(stage.index); return `${x.a}:${x.why}`; };
function reasonOf(x, now) {
  if (x.why === 'tell') return `讲一遍停在 ${frames[plan.end].id}，用的是那一帧的推定：${reasonOf(plan.rule, plan.end)}`;
  if (x.why === 'read') return `你在 ${frames[x.a].id} 按了“已阅”（只在本页内存）。${x.a === now ? '峰值从这里重新累积。' : ''}`;
  if (x.why === 'seen') return '你在下拉或地址 ?seen= 里选的。';
  if (x.why === 'fold') return `你 ${dayTime(x.event.at)} 在 Fold 里回应（${responseSentence(x.event, x.link).replace(/^你/, '')}），那时屏上是这一帧。`;
  const moves = sourceMoves(x.a, now);
  return `到此刻你没有在 Fold 里回应过${moves ? `；离开期间的 ${moves} 条动作都在来源处（GitHub、短信、电话），不算看过 Fold` : ''}，按此刻往前 ${AWAY} 轮。`;
}

// ---------- geometry ----------
let geo = null;
function measure() {
  const W = figure.clientWidth, H = figure.clientHeight;
  const LEFT = 232, AXIS = 30, TOP = 92, BOT = Math.max(TOP + 240, H - 112);
  return { W, H, LEFT, AXIS, TOP, BOT, AX0: LEFT + AXIS + 12, AX1: W - 8 };
}
const Y = v => geo.BOT - (v / SCALE) * (geo.BOT - geo.TOP);
function layoutOf(v) {
  const g = geo, m = v.meters.length;
  const slot = Math.min(112, (g.AX1 - g.AX0) / Math.max(1, m));
  const w = clamp(slot * 0.46, 12, 34);
  const pos = new Map(v.meters.map((r, k) => [r.id, g.AX0 + slot * (k + 0.5)]));
  return { slot, w, pos, split: v.left > 0 && v.left < m ? g.AX0 + slot * v.left : null, x1: g.AX0 + slot * m, left: v.left, m };
}
const headW = (w, slot) => Math.min(w + 8, slot - 6);

// ---------- what is drawn: one record per meter, settled or between two settled views ----------
const labelsOf = r => ({ tri: `${r.was} → ${r.peak} → ${r.now}`, gone: r.gone === 'merged' ? `并入${shortOf(r.into)}` : r.gone === 'withdrawn' ? '已撤下' : r.gone ? '不在根层' : '' });
function settledOf(v, lay, black = () => true) {
  const out = new Map();
  for (const r of v.meters) out.set(r.id, { id: r.id, r, x: lay.pos.get(r.id), w: lay.w, slot: lay.slot, bar: r.now, peak: r.peak, dash: r.was, alpha: 1, held: 1,
    hnum: r.peak, n: r.n, nAlpha: r.n > 0 ? 1 : 0, black: r.hidden && black(r) ? 1 : 0, ghost: null, lab: labelsOf(r) });
  return out;
}
// Timings (s). TELL: one round of the story; PLAY: the same round, 1.6 s apart; STEP: → ; JUMP: anything else; CLEAR: 已阅.
const TELL = { d0: 0.05, rise: 0.2, fall: 0.45, ghost: 0.6, dash0: 0.05, dash: 0.3, drop0: 0.1, drop: 0.35, move: 0.3, fade: 0.2, settle: 0.65, dur: 0.9 };
const PLAY = { ...TELL, dur: 1.6 };
const STEP = { d0: 0.03, rise: 0.15, fall: 0.35, ghost: 0.45, dash0: 0.03, dash: 0.25, drop0: 0.05, drop: 0.3, move: 0.3, fade: 0.18, settle: 0.5, dur: 0.6 };
const JUMP = { d0: 0, rise: 0.25, fall: 0.25, ghost: 0, dash0: 0, dash: 0.25, drop0: 0, drop: 0.25, move: 0.25, fade: 0.2, settle: 0.25, dur: 0.25 };
const CLEAR = { d0: 0, rise: 0.2, fall: 0.45, ghost: 0.5, clear: true, dash0: 0.1, dash: 0.3, drop0: 0, drop: 0.5, dropEase: easeIn, move: 0.3, fade: 0.45, settle: 0.5, dur: 0.6, circleOut: 0.15 };
function lerpMeter(f, g, u, P) {
  const t0 = u - P.d0, settled = u >= P.settle;
  const up = g.bar >= f.bar;
  const bar = lerp(f.bar, g.bar, up ? easeOut(t0 / P.rise) : easeInOut(t0 / P.fall));
  const pushing = g.peak > f.peak && g.peak === g.bar;
  let peak;
  if (pushing) peak = Math.max(f.peak, Math.min(g.peak, bar));
  else if (g.peak !== f.peak) peak = lerp(f.peak, g.peak, (g.peak < f.peak ? P.dropEase || easeInOut : easeOut)((u - P.drop0) / P.drop));
  else peak = g.peak;
  peak = Math.max(peak, bar);
  const pushedAt = P.d0 + P.rise, pushed = pushing && u >= pushedAt;
  const swap = settled || pushed;
  const n = swap ? g.n : f.n;
  let nAlpha;
  if (n === 0) nAlpha = f.n > 0 && !swap ? f.nAlpha * (1 - clamp(u / (P.circleOut || 0.12))) : 0;
  else if (n === f.n && f.nAlpha > 0) nAlpha = 1;
  else nAlpha = clamp((u - (pushed ? pushedAt : P.settle)) / 0.12);
  if (P.circleOut && g.n === 0) nAlpha = f.nAlpha * (1 - clamp(u / P.circleOut));
  let ghost = null;
  if (P.ghost && !reduced()) {
    if (g.bar < f.bar) { const a = 0.3 * (1 - clamp(t0 / P.ghost)); if (a > 0.004) ghost = { lo: bar, hi: f.bar, a }; }
    if (P.clear && g.peak < f.peak) { const a = 0.3 * (1 - clamp((u - P.drop0) / P.ghost)); if (a > 0.004) ghost = { lo: Math.min(bar, g.bar), hi: f.peak, a }; }
  }
  return { ...g, x: lerp(f.x, g.x, easeInOut(u / P.move)), w: lerp(f.w, g.w, easeInOut(u / P.move)), slot: g.slot, bar, peak,
    dash: lerp(f.dash, g.dash, easeInOut((u - P.dash0) / P.dash)), alpha: lerp(f.alpha, g.alpha, clamp(t0 / P.fade)), held: 1,
    hnum: swap ? g.hnum : f.hnum, n: n || f.n, nAlpha, black: settled ? g.black : f.black, ghost, lab: settled ? g.lab : f.lab };
}
/** Everything drawn at u seconds into a change from `from` (what was on screen) to the settled view `to`. */
function between(from, to, u, P) {
  const out = new Map();
  for (const [id, g] of to) {
    const f = from.get(id) || { ...g, bar: 0, peak: 0, alpha: 0, hnum: 0, n: 0, nAlpha: 0, black: 0, lab: g.lab };
    out.set(id, lerpMeter(f, g, u, P));
  }
  for (const [id, f] of from) if (!to.has(id)) {
    const a = f.alpha * (1 - clamp((u - P.d0) / P.fade));
    if (a > 0.01) out.set(id, { ...f, alpha: a, ghost: null });
  }
  return out;
}

// ---------- the clock ----------
let disp = new Map();          // drawn now
let trans = null;              // {from, to, toV, fromV, P, u}
let shownView = null;          // the view the numbers on screen belong to (switches at the settle)
let freeze = false;            // tellAt(): a still, until any control releases it
const hold = { at: null };     // ix pauses everything while something is hovered or open
let driving = false;           // the page steps itself (telling, playing)
const run = { kind: null, t: 0, wait: 0 };
const now = () => performance.now() / 1000;
let lay = null;

function change(toV, P, black) {
  const toLay = layoutOf(toV);
  const to = settledOf(toV, toLay, black);
  if (reduced() || P === null) { disp = to; trans = null; shownView = toV; lay = toLay; return; }
  trans = { from: new Map(disp), to, toV, fromV: shownView, P, u: 0, toLay };
  lay = toLay;
}
function stepTrans(dt) {
  if (!trans) return;
  trans.u += dt;
  if (trans.u >= trans.P.dur) { disp = trans.to; shownView = trans.toV; trans = null; return; }
  disp = between(trans.from, trans.to, trans.u, trans.P);
  if (trans.u >= trans.P.settle) shownView = trans.toV;
}
function telling() { return run.kind === 'tell' || (freeze && tellAnchor != null); }
const live = () => Boolean(trans && trans.u < trans.P.settle) || Boolean(telling() && tellLeft?.live);

// ---------- telling ----------
function tellTimes() {
  const p = plan, v = viewOf(p.end, p.from), h = v.hidden.length;
  const T0 = 0.4, b2 = T0 + p.n * p.R, b3 = b2 + 0.4 + h * 0.25 + 1.2;
  return { T0, b2, reveal: k => b2 + 0.4 + k * 0.25, h, b3, clear0: b3 + 0.15, clearEnd: b3 + 0.15 + CLEAR.dur, restore: b3 + 2.05, restoreEnd: b3 + 2.35, end: b3 + 2.45 };
}
let tellCache = null;
const TT = () => tellCache || (tellCache = tellTimes());
/** Where the story stands at s seconds: the frame, the drawing, and what the left column says. Pure: tellAt(s) is a still. */
function tellPhase(s = run.t) {
  const p = plan, T = TT(), a = p.from;
  const endV = viewOf(p.end, a), endLay = layoutOf(endV);
  const order = new Map(endV.meters.map((m, k) => [m.id, k]));
  // During the rounds every meter keeps its place in the final layout; the ones yet to come are simply not there.
  const fixed = v => ({ ...endLay, pos: new Map(v.meters.filter(m => order.has(m.id)).map(m => [m.id, endLay.pos.get(m.id)])) });
  const at = (i, black) => { const v = viewOf(i, a), L = fixed(v); return { v, d: settledOf({ ...v, meters: v.meters.filter(m => order.has(m.id)) }, L, black) }; };
  const none = () => false;
  if (s < T.T0) return { i: a, ...at(a, none), beat: 0, live: false, round: 0 };
  if (s < T.b2) {
    const r = Math.min(p.n, Math.floor((s - T.T0) / p.R) + 1), u = s - (T.T0 + (r - 1) * p.R);
    const prev = at(a + r - 1, none), next = at(a + r, none);
    return { i: a + r, v: next.v, d: between(prev.d, next.d, u, TELL), beat: 1, live: u < TELL.settle, round: r };
  }
  const hiddenIds = endV.hidden.map(m => m.id);
  if (s < T.b3) {
    const k = hiddenIds.filter((_, j) => s >= T.reveal(j)).length, shown = new Set(hiddenIds.slice(0, k));
    return { i: p.end, ...at(p.end, m => shown.has(m.id)), beat: 2, live: false, revealed: k };
  }
  const full = at(p.end, () => true);
  if (s < T.clear0) return { i: p.end, ...full, beat: 3, live: false, revealed: T.h, press: clamp((s - T.b3) / 0.15) };
  const clearedV = viewOf(p.end, p.end), cleared = settledOf(clearedV, layoutOf(clearedV));
  // The demonstration keeps every meter where it stands; the real 已阅 lets them close up.
  for (const x of cleared.values()) Object.assign(x, { x: endLay.pos.get(x.id) ?? x.x, w: endLay.w, slot: endLay.slot });
  if (s < T.clearEnd) return { i: p.end, v: full.v, d: between(full.d, cleared, s - T.clear0, CLEAR), beat: 3, live: true, revealed: T.h, press: 1 };
  if (s < T.restore) return { i: p.end, v: clearedV, d: cleared, beat: 3, live: false, cleared: true, press: 1 };
  // The demonstration ends: nothing was read for you; the held layer comes back.
  const k = clamp((s - T.restore) / (T.restoreEnd - T.restore));
  const d = new Map([...full.d].map(([id, x]) => [id, { ...x, held: easeOut(k), alpha: cleared.has(id) ? 1 : easeOut(k) }]));
  return { i: p.end, v: full.v, d, beat: 3, live: false, revealed: T.h, restored: true, held: k };
}
function applyTell(s) {
  const ph = tellPhase(s);
  if (stage.index !== ph.i) { driving = true; try { stage.go(ph.i, { fromPlay: true }); } finally { driving = false; } }
  disp = ph.d; trans = null; shownView = ph.v; lay = layoutOf(viewOf(plan.end, plan.from));
  tellLeft = ph;
}
let tellLeft = null;
function setRunUI() {
  document.body.classList.toggle('st-playing', run.kind === 'play');
  const b = document.querySelector('[data-p="tell"]');
  if (b) { b.textContent = run.kind === 'tell' ? '跳过 ▸▸' : '↺ 重演'; b.setAttribute('aria-pressed', String(run.kind === 'tell')); }
}
function stopRun() {
  if (!run.kind) return;
  const was = run.kind;
  run.kind = null; setRunUI();
  if (was === 'tell') endTell();
}
function endTell() { tellAnchor = null; tellLeft = null; settleOn(stage.index); stage.refreshSide(); }
function settleOn(i) { const v = viewNow(i); lay = layoutOf(v); disp = settledOf(v, lay); trans = null; shownView = v; }
function startTell() {
  if (!plan) return;
  freeze = false; stopRun(); ix?.reset(); closePanel();
  if (reduced()) { skipTell(); return; }
  tellAnchor = { a: plan.from, why: plan.rule.why };
  Object.assign(run, { kind: 'tell', t: 0 });
  setRunUI();
  applyTell(0);
  stage.refreshSide();
}
/** Skip to the end of the story: the default frame, peaks held, the button waiting. */
function skipTell() {
  if (!plan) return;
  run.kind = null; setRunUI(); tellAnchor = null; tellLeft = null; freeze = false;
  if (stage.index !== plan.end) { driving = true; try { stage.go(plan.end); } finally { driving = false; } }
  settleOn(plan.end); stage.refreshSide();
}
/** A still of the story at s seconds (stills and checks); released by any control. */
function tellAt(s) {
  if (!plan) return;
  stopRun(); ix?.reset(); closePanel();
  tellAnchor = { a: plan.from, why: plan.rule.why };
  run.t = s; applyTell(s);
  freeze = true;
  stage.refreshSide();
}
function startPlay() {
  freeze = false; stopRun(); ix?.reset(); closePanel();
  if (stage.index >= LAST) drive(0, null);
  Object.assign(run, { kind: 'play', t: 0, wait: 0 });
  setRunUI();
}
stage.play = startPlay;
stage.pause = () => { if (run.kind === 'play') stopRun(); };
stage.toggle = () => (run.kind === 'play' ? stage.pause() : startPlay());
/** The page steps itself (playing): one round at a pace. */
function drive(i, P) {
  driving = true;
  try { if (i !== stage.index) stage.go(i, { fromPlay: true }); } finally { driving = false; }
  change(viewNow(i), P);
}
function tick(dt) {
  if (hold.at != null || freeze) return;
  if (run.kind === 'tell') {
    run.t += dt;
    if (run.t >= TT().end) { run.kind = null; setRunUI(); endTell(); return; }
    applyTell(run.t);
    return;
  }
  stepTrans(dt);
  if (run.kind === 'play') {
    run.wait -= dt;
    if (run.wait > 0 || trans) return;
    if (stage.index >= LAST) { stopRun(); return; }
    drive(stage.index + 1, PLAY);
    run.wait = PLAY.dur;
  }
}

// ---------- frame changes from outside (←/→, the tick strip, the combined page) ----------
let keyRepeat = false;
addEventListener('keydown', event => { keyRepeat = event.repeat; }, true);
stage.onFrame((next, previous) => {
  if (driving) return;
  stopRun(); freeze = false; tellAnchor = null; tellLeft = null;
  if (ix) { ix.reset(); closePanel(); }
  const P = next === previous + 1 && !keyRepeat ? STEP : JUMP;
  change(viewNow(next), P);
  renderControls();
});
addEventListener('keydown', event => {
  // Any key skips the story (Tab still moves focus).
  if (run.kind === 'tell' && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key) && !event.metaKey && !event.ctrlKey) {
    skipTell();
    if (event.key !== 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); }
    return;
  }
  if (freeze) { freeze = false; if (tellAnchor) { tellAnchor = null; tellLeft = null; settleOn(stage.index); stage.refreshSide(); } }
}, true);
addEventListener('pointerdown', () => { if (freeze) { freeze = false; if (tellAnchor) { tellAnchor = null; tellLeft = null; settleOn(stage.index); stage.refreshSide(); } } }, true);

// ---------- 已阅, 撤回, and choosing the anchor ----------
function setAnchor(next) {
  stopRun(); freeze = false; ix?.reset(); closePanel();
  override = next;
  const q = new URLSearchParams(location.search);
  // Only a chosen frame goes into the address; 已阅 lives in this page's memory.
  if (next?.why === 'seen') q.set('seen', frames[next.a].id); else if (!next) q.delete('seen');
  history.replaceState(null, '', `?${q}`);
  change(viewNow(), CLEAR);
  renderControls(); stage.refreshSide();
}
function read() {
  const x = anchorAt(stage.index);
  if (x.a >= stage.index) return;
  undo.push(override);
  setAnchor({ a: stage.index, why: 'read' });
}
function unread() {
  if (!undo.length && override?.why !== 'read') return;
  setAnchor(undo.length ? undo.pop() : null);
}

// ---------- drawing (SVG, built once per size; each frame only sets attributes) ----------
const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent?.append(n); return n; };
const nodes = new Map();       // meter id → its SVG parts and an attribute cache
let svg = null, meterLayer = null, axisLayer = null, groupLayer = null;
const els = {};
function render() {
  geo = measure();
  const g = geo;
  const kept = [...figure.querySelectorAll(':scope > .ix-leaders, :scope > .ix-peek, :scope > .ix-detail, :scope > .ix-sr')];
  figure.innerHTML = `<div class="pk-left" style="width:${g.LEFT - 18}px">
      <div class="pk-hero-part"></div><div class="pk-anchor-part"></div><div class="pk-act-part"></div></div>`;
  svg = el('svg', { class: 'pk-svg', width: g.W, height: g.H, viewBox: `0 0 ${g.W} ${g.H}`, 'aria-hidden': 'true' });
  svg.innerHTML = `<defs><pattern id="pk-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--ink-3)" stroke-width="1.2"/></pattern></defs>`;
  axisLayer = el('g', { class: 'pk-axis' }, svg);
  for (const v of [0, 6, 12, 18, 24]) {
    el('line', { x1: g.AX0 - 6, x2: g.AX1, y1: Y(v), y2: Y(v), class: v ? 'pk-grid' : 'pk-base' }, axisLayer);
    el('text', { x: g.AX0 - 12, y: Y(v) + 3.5, 'text-anchor': 'end', class: 'pk-tick' }, axisLayer).textContent = v;
  }
  el('text', { x: g.AX0 - 12, y: g.TOP - 36 + 14, 'text-anchor': 'end', class: 'pk-unit' }, axisLayer).textContent = '份';
  groupLayer = el('g', { class: 'pk-groups' }, svg);
  els.split = el('line', { class: 'pk-split', y1: g.TOP - 58, y2: g.BOT + 52 }, groupLayer);
  els.capL = el('text', { class: 'pk-cap', y: g.TOP - 48 }, groupLayer);
  els.capR = el('text', { class: 'pk-cap', y: g.TOP - 48 }, groupLayer);
  els.fold = el('text', { class: 'pk-fold', x: g.AX0, y: g.BOT + 74 }, groupLayer);
  meterLayer = el('g', { class: 'pk-meters' }, svg);
  figure.append(svg, ...kept);
  const sr = kept.find(x => x.classList.contains('ix-sr'));
  if (sr) figure.prepend(sr);
  els.left = figure.querySelector('.pk-left');
  els.hero = figure.querySelector('.pk-hero-part'); els.anchor = figure.querySelector('.pk-anchor-part'); els.act = figure.querySelector('.pk-act-part');
  nodes.clear();
  heroKey = anchorHTMLKey = actKey = groupKey = controlsKey = '';
  // A resize keeps the story or the change where it is, laid out anew.
  if (run.kind === 'tell' || (freeze && tellAnchor)) applyTell(run.t);
  else settleOn(stage.index);
  renderControls();
  ix?.relayout();
}
function nodeFor(id) {
  if (nodes.has(id)) return nodes.get(id);
  const outer = el('g', { class: 'pk-m', 'data-id': id }, meterLayer);
  const pop = el('g', { class: 'pk-pop' }, outer), inner = el('g', { class: 'pk-in' }, pop);
  const n = {
    outer, pop, inner,
    body: el('rect', { class: 'pk-body' }, inner),
    ghost: el('rect', { class: 'pk-ghost' }, inner),
    hatch: el('rect', { class: 'pk-hatch', fill: 'url(#pk-hatch)' }, inner),
    bar: el('rect', { class: 'pk-bar' }, inner),
    dash: el('line', { class: 'pk-dash' }, inner),
    peak: el('line', { class: 'pk-peak' }, inner),
    circle: el('g', { class: 'pk-circ' }, inner),
    hbox: el('rect', { class: 'pk-hbox', height: 20 }, inner),
    hnum: el('text', { class: 'pk-hnum', 'text-anchor': 'middle' }, inner),
    name: el('text', { class: 'pk-name', 'text-anchor': 'middle' }, inner),
    tri: el('text', { class: 'pk-tri', 'text-anchor': 'middle' }, inner),
    gone: el('text', { class: 'pk-gone', 'text-anchor': 'middle' }, inner),
    ring: el('rect', { class: 'pk-ring' }, inner),
    c: {},
  };
  n.cc = el('circle', { r: 7.5 }, n.circle); n.ct = el('text', { 'text-anchor': 'middle' }, n.circle);
  nodes.set(id, n);
  return n;
}
const fx = v => (Math.round(v * 10) / 10).toString();
function paintMeters() {
  const g = geo;
  for (const [id, n] of nodes) if (!disp.has(id)) { n.outer.remove(); nodes.delete(id); }
  for (const [id, d] of disp) {
    const n = nodeFor(id), c = n.c;
    const set = (node, attr, value, k) => { if (c[k] !== value) { c[k] = value; node.setAttribute(attr, value); } };
    const hw = headW(d.w, d.slot), w = d.w;
    set(n.outer, 'transform', `translate(${fx(d.x)},0)`, 'tx');
    set(n.inner, 'opacity', fx(d.alpha), 'al');
    const yb = Y(d.bar), yp = Y(d.peak), yd = Y(d.dash);
    if (c.w !== w) {
      c.w = w;
      for (const [node, attrs] of [[n.body, { x: -w / 2, width: w }], [n.bar, { x: -w / 2 + 1, width: Math.max(0, w - 2) }], [n.hatch, { x: -w / 2 + 1, width: Math.max(0, w - 2) }], [n.ghost, { x: -w / 2 + 1, width: Math.max(0, w - 2) }],
        [n.peak, { x1: -w / 2 - 3, x2: w / 2 + 3 }], [n.dash, { x1: -w / 2 - 7, x2: w / 2 + 7 }]]) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, fx(v));
      n.body.setAttribute('y', g.TOP); n.body.setAttribute('height', g.BOT - g.TOP);
    }
    if (c.hw !== hw) { c.hw = hw; n.hbox.setAttribute('x', fx(-hw / 2)); n.hbox.setAttribute('width', fx(hw)); n.hbox.setAttribute('y', g.TOP - 34); n.hnum.setAttribute('y', g.TOP - 20); n.ring.setAttribute('x', fx(-hw / 2 - 4)); n.ring.setAttribute('width', fx(hw + 8)); n.ring.setAttribute('y', g.TOP - 38); n.ring.setAttribute('height', g.BOT - g.TOP + 92); }
    set(n.bar, 'y', fx(yb), 'by'); set(n.bar, 'height', fx(Math.max(0, g.BOT - yb)), 'bh');
    set(n.hatch, 'y', fx(yp), 'hy'); set(n.hatch, 'height', fx(Math.max(0, yb - yp)), 'hh'); set(n.hatch, 'opacity', fx(d.held), 'ho');
    set(n.peak, 'y1', fx(yp), 'p1'); set(n.peak, 'y2', fx(yp), 'p2'); set(n.peak, 'opacity', fx(d.held), 'po');
    set(n.dash, 'y1', fx(yd), 'd1'); set(n.dash, 'y2', fx(yd), 'd2'); set(n.dash, 'opacity', fx(d.held), 'do');
    if (d.ghost) { set(n.ghost, 'y', fx(Y(d.ghost.hi)), 'gy'); set(n.ghost, 'height', fx(Math.max(0, Y(d.ghost.lo) - Y(d.ghost.hi))), 'gh'); set(n.ghost, 'opacity', d.ghost.a.toFixed(3), 'ga'); set(n.ghost, 'visibility', 'visible', 'gv'); }
    else set(n.ghost, 'visibility', 'hidden', 'gv');
    const r = d.slot >= 56 ? 7.5 : 6, cx = w / 2 + 4 + r;
    const co = (d.nAlpha * d.held);
    set(n.circle, 'transform', `translate(${fx(cx)},${fx(yp)})`, 'ct');
    set(n.circle, 'opacity', fx(co), 'co');
    set(n.cc, 'r', r, 'cr');
    set(n.ct, 'y', r > 7 ? 3.4 : 3, 'cy');
    if (c.cn !== d.n) { c.cn = d.n; n.ct.textContent = d.n || ''; }
    set(n.outer, 'class', `pk-m${d.black ? ' is-black' : ''}${d.r.hidden ? ' is-hidden' : ''}`, 'cl');
    if (c.hn !== d.hnum) { c.hn = d.hnum; n.hnum.textContent = d.hnum; }
    const lab = `${d.lab.tri}|${d.lab.gone}|${d.slot.toFixed(0)}`;
    if (c.lab !== lab) {
      c.lab = lab;
      const room = d.slot - 4;
      n.name.setAttribute('y', g.BOT + 18); n.tri.setAttribute('y', g.BOT + 33); n.gone.setAttribute('y', g.BOT + 47);
      n.name.textContent = fit(shortOf(id), room, 12, 600);
      // Monospace: about 0.6 em a character. Too wide with spaces, the arrows close up.
      n.tri.textContent = [...d.lab.tri].length * 6.4 <= room ? d.lab.tri : d.lab.tri.replace(/ /g, '');
      n.gone.textContent = d.lab.gone ? fit(d.lab.gone, room, 10, 400) : '';
    }
  }
}
function fit(text, width, size, weight) {
  if (textWidth(text, size, weight) <= width) return text;
  const chars = [...text];
  while (chars.length > 1 && textWidth(`${chars.join('')}…`, size, weight) > width) chars.pop();
  return `${chars.join('')}…`;
}
let groupKey = '';
function paintGroups() {
  const g = geo, v = shownView, L = lay;
  if (!v || !L) return;
  const k = `${v.now}:${v.a}:${L.split}:${L.m}:${v.left}`;
  if (k === groupKey) return;
  groupKey = k;
  const splitX = L.split;
  els.split.setAttribute('visibility', splitX == null ? 'hidden' : 'visible');
  if (splitX != null) { els.split.setAttribute('x1', fx(splitX)); els.split.setAttribute('x2', fx(splitX)); }
  els.capL.setAttribute('x', fx(g.AX0 + 2)); els.capL.textContent = v.left ? '上次看时就在' : '';
  els.capR.setAttribute('x', fx((splitX ?? g.AX0) + 8)); els.capR.textContent = v.meters.length > v.left ? '你离开后才来' : '';
  const ones = v.traces.length, rise = v.traceRise.length;
  els.fold.textContent = [ones ? `另有 ${ones} 件一直只占 1 份，没有画${rise ? `（其中 ${rise} 件 0 → 1 → 0，一条痕迹，不算升起）` : ''}` : '', v.over.length ? `另有 ${v.over.length} 件峰值 ≥ 3 未画，见侧栏` : ''].filter(Boolean).join(' · ');
}

// ---------- the left column: the hero number, the anchor, 已阅 ----------
let heroKey = '', anchorHTMLKey = '', actKey = '';
function heroHTML() {
  const v = shownView;
  if (!v) return '';
  const tl = telling() ? tellLeft : null;
  const line = m => `<li data-id="${esc(m.id)}"><b>${esc(shortOf(m.id))}</b><span>${m.was} → ${m.peak} → ${m.now}</span><i>${m.n ? circled(m.n) : ''}</i></li>`;
  if (v.now === 0) return '<div class="pk-k">还没有整理过任何输入</div><div class="pk-hero is-empty"><b>0</b><span>件</span></div><p class="pk-lede">64 份全是留白。按 → 或空格开始。</p>';
  if (tl && tl.beat <= 1) {
    const i = tl.i, r = tl.round;
    return `<div class="pk-k">${r ? `你离开的第 ${circled(r)} 轮 · ${esc(dayTime(frames[i].at))}` : `上次看 · ${esc(frames[i].id)} ${esc(dayTime(frames[i].at))}`}</div>
      <div class="pk-hero is-wait"><b>${r}</b><span>/ ${plan.n} 轮</span></div>
      <p class="pk-lede">${r ? '你不在。峰值被顶上去，就停在那里。' : '你上次看的时候：每根实心都压在自己的虚线上。'}</p>`;
  }
  let shown = v.hidden, cleared = !tl && v.away === 0 && anchorAt(stage.index).why === 'read', demo = '';
  if (tl && tl.beat === 2) shown = v.hidden.slice(0, tl.revealed);
  if (tl && tl.beat === 3 && tl.cleared) { shown = []; cleared = true; demo = '演示：替你按了一次“已阅”。锚点移到此刻，峰值清掉；下一轮离开再从这里攒。'; }
  if (tl && tl.beat === 3 && !tl.cleared && !tl.restored) demo = '演示：替你按一次“已阅”';
  if (tl && tl.restored) demo = '讲一遍只是演示，没有替你按：峰值还停着。';
  const most = shown.length ? shown.reduce((x, y) => (y.peak - y.now > x.peak - x.now ? y : x)) : null;
  const away = cleared ? 0 : v.away;
  return `<div class="pk-k">${away ? `你离开的 ${away} 轮里` : '此刻就是上次看'}</div>
    <div class="pk-hero${shown.length ? '' : ' is-empty'}"><b>${shown.length}</b><span>件</span></div>
    <p class="pk-lede">${cleared ? '已阅：峰值清掉了。' : away ? (shown.length ? '升起又落下，此刻的状态里已经看不出来：' : '没有升起又落下、此刻看不出来的事。') : '还没有离开过：没有可保持的峰值。'}</p>
    ${shown.length ? `<ul class="pk-list">${shown.map(line).join('')}</ul>` : ''}
    ${most && shown.length === v.hidden.length && !cleared ? `<p class="pk-most">落差最大：${esc(shortOf(most.id))}，峰值 ${most.peak} 份停在第 ${most.n} 轮（${esc(dayTime(frames[most.at].at))}），此刻 ${most.now}。</p>` : ''}
    ${demo ? `<p class="pk-demo">${esc(demo)}</p>` : ''}`;
}
function anchorHTML() {
  const i = stage.index, x = anchorAt(i), rule = anchorOf(i);
  if (i === 0) return '';
  const locked = telling();
  const tl = locked ? tellLeft : null;
  if (tl?.cleared) return `<section class="pk-anchor"><h4>上次看 <small>演示的“已阅”</small></h4><p class="pk-when"><b>${esc(frames[i].id)}</b> ${esc(dayTime(frames[i].at))} · 此刻</p>
    <p class="pk-why">讲一遍替你按了一次：锚点移到此刻。讲完撤回。</p><label class="pk-pick"><span>改锚点</span><select data-p="seen" disabled><option>讲一遍中</option></select></label></section>`;
  const opts = [];
  const foldAnchors = new Set(); for (let k = 1; k <= i; k += 1) if (inFold[k].length) foldAnchors.add(k - 1);
  if (locked) opts.push(`<option>讲一遍中：${esc(frames[x.a].id)}</option>`);
  else opts.push(`<option value=""${!override || override.why !== 'seen' ? ' selected' : ''}>推定：${esc(frames[rule.a].id)}${rule.why === 'fold' ? '（Fold 里回应时）' : `（往前 ${AWAY} 轮）`}</option>`);
  if (!locked) for (let k = i - 1; k >= 0; k -= 1) opts.push(`<option value="${esc(frames[k].id)}"${override?.why === 'seen' && override.a === k ? ' selected' : ''}>${esc(frames[k].id)} · ${esc(dayTime(frames[k].at))}${foldAnchors.has(k) ? ' · Fold 里回应过' : ''}</option>`);
  return `<section class="pk-anchor"><h4>上次看 <small>${x.why === 'read' ? '你按的“已阅”' : x.why === 'seen' ? '你选的' : x.why === 'tell' ? '讲一遍' : '推定'}</small></h4>
    <p class="pk-when"><b>${esc(frames[x.a].id)}</b> ${esc(dayTime(frames[x.a].at))}${i - x.a ? ` · 离开 ${i - x.a} 轮` : ''}</p>
    <p class="pk-why">${esc(reasonOf(x, i))}</p>
    <label class="pk-pick"><span>改锚点</span><select data-p="seen" aria-label="上次看是哪一帧"${locked ? ' disabled' : ''}>${opts.join('')}</select></label></section>`;
}
function actHTML() {
  const i = stage.index, x = anchorAt(i), tl = telling() ? tellLeft : null;
  const pressed = tl && tl.beat === 3 && !tl.restored ? ' is-press' : '';
  const isRead = !tl && override?.why === 'read' && x.why === 'read';
  if (isRead) return `<div class="pk-act"><button type="button" class="pk-read is-done" data-p="undo">撤回已阅</button><p class="pk-note">你在 ${esc(frames[override.a].id)} 按了“已阅”：锚点在这里，下一轮离开再重新攒。只在本页内存。</p></div>`;
  const none = !tl && x.a >= i;
  return `<div class="pk-act"><button type="button" class="pk-read${pressed}" data-p="read"${none ? ' disabled' : ''}>已阅 · 清掉峰值</button>
    <p class="pk-note">${none ? '此刻就是上次看，没有可清的峰值。' : '峰值一直停着，直到你按下；翻过不等于已阅。只在本页内存，可撤回。'}</p></div>`;
}
let controlsKey = '';
function renderControls() {
  // Only when something the column says has changed: the frame, the anchor, the story's beat, 已阅.
  const tl = telling() ? tellLeft : null;
  const k = [stage.index, anchorKey(), shownView ? `${shownView.now}:${shownView.a}` : '', run.kind, freeze,
    tl ? `${tl.beat}:${tl.round}:${tl.revealed}:${tl.cleared}:${tl.restored}:${(tl.press || 0) > 0}` : '', override ? `${override.why}:${override.a}` : '', undo.length].join('|');
  if (k === controlsKey) return;
  controlsKey = k;
  const h = heroHTML(), a = anchorHTML(), c = actHTML();
  if (h !== heroKey) { heroKey = h; els.hero.innerHTML = h; }
  if (a !== anchorHTMLKey) { if (els.anchor.contains(document.activeElement)) controlsKey = ''; else { anchorHTMLKey = a; els.anchor.innerHTML = a; } }
  if (c !== actKey) { const focused = els.act.contains(document.activeElement); actKey = c; els.act.innerHTML = c; if (focused) els.act.querySelector('button')?.focus({ preventScroll: true }); }
}
figure.addEventListener('change', event => {
  const s = event.target.closest?.('[data-p="seen"]');
  if (!s) return;
  const k = frameIndexOf(s.value);
  s.blur();
  undo.length = 0;
  setAnchor(k >= 0 ? { a: k, why: 'seen' } : null);
});
figure.addEventListener('click', event => {
  const b = event.target.closest?.('[data-p]');
  if (!b) return;
  if (b.dataset.p === 'read') read();
  else if (b.dataset.p === 'undo') unread();
});
document.querySelector('.st-tools').addEventListener('click', event => {
  if (event.target.closest('[data-p="tell"]')) { if (run.kind === 'tell') skipTell(); else startTell(); }
});

// ---------- the interaction (motion/ix.mjs): which meter is under a point, where cards hang, how the clock stops ----------
const meterRect = id => {
  const d = disp.get(id);
  if (!d) return null;
  const hw = headW(d.w, d.slot), half = Math.max(d.w / 2 + 7, hw / 2);
  return { x0: d.x - half, x1: d.x + half, y0: geo.TOP - 34, y1: geo.BOT + 50, d };
};
const band = d => Math.max(2, Math.min(10, (d.slot - 2 * Math.max(d.w / 2 + 7, headW(d.w, d.slot) / 2)) / 2 - 1));
function hasId(id) {
  const d = disp.get(id), v = shownView;
  return Boolean(d && d.alpha > 0.5 && v?.byId.has(id));
}
function hitAt(x, y) {
  if (!geo || y < geo.TOP - 40 || y > geo.BOT + 56 || x < geo.AX0 - 14) return null;
  let best = null;
  for (const [id, d] of disp) {
    if (!hasId(id)) continue;
    const r = meterRect(id), b = band(d);
    if (x >= r.x0 - b && x <= r.x1 + b) { const dist = Math.abs(x - d.x); if (!best || dist < best.dist) best = { id, dist }; }
  }
  return best?.id || null;
}
const idFor = name => {
  if (name == null) return null;
  const v = shownView;
  if (v?.byId.has(name)) return name;
  return v?.meters.find(m => shortOf(m.id) === name)?.id || null;
};
const centreOf = id => { const r = meterRect(id); return r ? { x: r.d.x, y: (geo.TOP + geo.BOT) / 2 } : null; };
function peekPlace(id, w, h) {
  const r = meterRect(id), g = geo, y0 = Y(r.d.peak);
  const right = r.x1 + 12 + w <= g.W - 8;
  const x = right ? r.x1 + 12 : Math.max(8, r.x0 - 12 - w);
  const y = clamp(y0 - 22, 8, g.H - 8 - h);
  return { x, y, from: { x: right ? r.x1 : r.x0, y: clamp(y0, y + 6, y + h - 6) } };
}
// The detail card: on the side with more room, level with the header row; the leader leaves the popped header box's side
// and runs straight across to it.
function detailPlace(id, cardEl) {
  const r = meterRect(id), g = geo;
  if (!r) return null;
  const hw = headW(r.d.w, r.d.slot), hy = g.TOP - 24 - IX.pop;
  const right = r.d.x < (g.AX0 + g.AX1) / 2;
  const w = 320;
  const x = right ? Math.min(g.W - 8 - w, r.x1 + 40) : Math.max(8, r.x0 - 40 - w);
  cardEl.style.width = `${w}px`;
  const y = Math.max(8, hy - 18);
  cardEl.style.maxHeight = `${g.H - 8 - y}px`;
  const h = Math.min(cardEl.offsetHeight, g.H - 8 - y);
  const start = right ? r.d.x + hw / 2 : r.d.x - hw / 2;
  return { x, y, w, h, path: [{ x: start, y: hy }, { x: right ? x : x + w, y: hy }] };
}
let ix = null;
let X = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
ix = createIx({
  stage: figure, keysIn: figure,
  facts: id => factsOf(id), has: hasId, hit: hitAt, named: idFor,
  pointOf: centreOf, index: () => `${stage.index}:${anchorKey()}:${live() ? 1 : 0}`,
  pause: () => { if (hold.at == null) hold.at = now(); }, resume: () => { hold.at = null; }, paused: () => hold.at != null,
  last: LAST, answerHref: () => answerLink(),
  seen: () => ({ inputs: true, share: !live(), asks: !live() }),
  peekPlace, detailPlace, peekHTML: (f, o) => peekCard(f, o), detailHTML: (f, o) => detailCard(f, o),
  skip: '.pk-left, .pk-axis',
  label: '峰值保持的表：Tab 逐根看概要，Enter 展开详情，Esc 收回',
});

// ---------- facts and cards: this meter over the window you were away ----------
const answerLink = () => withDataset(`../../index.html?variant=d&frame=${stage.index}`);
const askShort = a => a.short || a.prompt;
const dueOf = a => (a.due_at ? dueText(Date.parse(a.due_at)) : '');
const answerOf = new Map();
frames.forEach((frame, i) => { for (const event of frame.events) for (const link of event.feedback || []) if (link.ask && !answerOf.has(link.ask)) answerOf.set(link.ask, { i, event, link }); });
function howLapsed(a, i) {
  const root = rootOf(a.item);
  const d = (frames[i].batch?.declarations || []).find(x => x.id === a.item || x.id === root);
  const status = records[i].snapshot.items[root]?.status;
  const what = d?.kind === 'done' ? '改为已办' : d?.relation === 'withdraw' || status === 'withdrawn' ? '撤下' : status === 'merged' || d?.relation?.startsWith('merges:') ? '并入' : '改写';
  return `随改写失效：${shortOf(root)}${what}`;
}
const howAnswered = a => { const x = answerOf.get(a.id); return x ? responseSentence(x.event, x.link) : '你答了'; };
/** Questions in the window: closed after the anchor (answered or lapsed), and the ones opened and closed while away. */
function asksIn(a, i, root = null) {
  const mine = x => !root || rootOf(x.item) === root;
  const closed = [], opened = new Set();
  for (let k = a + 1; k <= i; k += 1) {
    for (const x of askLife[k].fresh) opened.add(x.id);
    for (const x of askLife[k].answered.filter(mine)) closed.push({ k, a: x, how: howAnswered(x), answered: true, unseen: opened.has(x.id) });
    for (const x of askLife[k].lapsed.filter(mine)) closed.push({ k, a: x, how: howLapsed(x, k), answered: false, unseen: opened.has(x.id) });
  }
  return { closed, open: [...askLife[i].open.values()].filter(mine) };
}
const factCache = new Map();
function factsOf(id) {
  const ck = `${stage.index}:${anchorKey()}:${live() ? 1 : 0}:${id}`;
  if (factCache.has(ck)) return factCache.get(ck);
  const i = stage.index, x = anchorAt(i);
  const v = live() && trans?.fromV ? trans.fromV : shownView || viewNow(i);
  const m = v.byId.get(id) || viewNow(i).byId.get(id);
  const a = v.a, I = v.now;
  const falls = [];
  for (let k = 1; k < m.s.length; k += 1) if (m.s[k] < m.s[k - 1] && a + k > m.at) {
    const fi = a + k;
    falls.push({ i: fi, from: m.s[k - 1], to: m.s[k], said: foldSentences(responsesIn(fi).filter(r => rootOf(r.link.target) === id)).map(s => s.label) });
  }
  const q = asksIn(a, I, id);
  const f = { i, id, short: shortOf(id), title: titleAt(id, I), m, a, I, away: I - a, why: x.why, group: m.was > 0 ? '上次看时就在' : '你离开后才来',
    falls, closed: q.closed, open: q.open, summary: records[I].snapshot.items[id]?.summary || records[m.at].snapshot.items[id]?.summary || '', unsettled: live() };
  factCache.set(ck, f);
  return f;
}
const askRow = a => `<div class="ix-ask"><i></i><span>${esc(askShort(a))}</span>${dueOf(a) ? `<small>${esc(dueOf(a))}</small>` : ''}</div>`;
const goneWord = m => (m.gone === 'merged' ? `此刻已并入${shortOf(m.into)}` : m.gone === 'withdrawn' ? '此刻已撤下' : m.gone ? '此刻不在根层' : '');
function peekCard(f) {
  const m = f.m;
  return `<div class="ix-k">${esc(f.group)} · 离开 ${f.away} 轮</div><div class="ix-q">${esc(f.short)}</div>
    <div class="ix-d pk-pk-tri">${m.was} → ${m.peak} → ${m.now}${m.hidden ? ' · 看不出来的起落' : ''}</div>
    <div class="ix-d">${m.n ? `第 ${m.n} 轮（${esc(dayTime(frames[m.at].at))}）到峰` : '峰值就是上次看时那一档'}</div>
    ${goneWord(m) ? `<div class="ix-d">${esc(goneWord(m))}</div>` : ''}${f.unsettled ? '<div class="ix-d">本轮还没落定</div>' : ''}
    ${f.open.map(askRow).join('')}`;
}
function roundsSVG(m, a) {
  // Scaled to this item's own peak: the card shows the shape of its rise and fall, the meter shows its size.
  const n = m.s.length, W = 294, H = 40, top = Math.max(3, m.peak, m.was), bw = W / n;
  return `<svg class="pk-rounds" viewBox="0 0 ${W} ${H + 12}" aria-hidden="true">${m.s.map((s, k) => {
    const h = s ? Math.max(1.5, (s / top) * (H - 2)) : 1, x = k * bw + bw * 0.18, cls = k === m.n && m.n ? 'is-peak' : k === 0 ? 'is-anchor' : k === n - 1 ? 'is-now' : '';
    return `<rect x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${h.toFixed(1)}" class="${cls}"/><text x="${(x + bw * 0.32).toFixed(1)}" y="${H + 10}" text-anchor="middle">${k ? k : '上次'}</text>`;
  }).join('')}</svg>`;
}
function detailCard(f, { href }) {
  const m = f.m, close = '<button type="button" data-x="close" aria-label="收回（Esc）" title="收回（Esc）">×</button>';
  const peakSec = m.n ? `<section><h5>到峰<b>第 ${m.n} 轮 · ${esc(frames[m.at].id)}</b></h5><p class="pk-d-p">${esc(dayTime(frames[m.at].at))}「${esc(frames[m.at].title)}」：${m.s[m.n - 1]} → ${m.peak}</p></section>` : '';
  const fallSec = m.peak > m.now ? `<section><h5>落下<b>${m.peak} → ${m.now}</b></h5><ul class="ix-d-fb">${f.falls.map(x => `<li><time>${esc(dayTime(frames[x.i].at))} · ${esc(frames[x.i].id)}</time>${x.from} → ${x.to}${x.to === 0 && x.i === f.I && m.gone ? `（${esc(goneWord(m).replace('此刻', ''))}）` : ''}「${esc(frames[x.i].title)}」${x.said.length ? `<small class="pk-d-said">${esc(x.said.join('；'))}</small>` : ''}</li>`).join('')}</ul></section>` : '';
  const closed = f.closed.length ? `<section><h5>离开期间关上的问题<b>${f.closed.length}</b></h5><ul class="ix-d-fb">${f.closed.map(c => `<li><time>${esc(frames[c.k].id)}${c.unseen ? ' · 开和关都在你离开时' : ''}</time>「${esc(askShort(c.a))}」<small class="pk-d-said">${esc(c.answered ? `${c.how}，答掉` : c.how)}</small></li>`).join('')}</ul></section>` : '';
  const open = `<section><h5>开着的问题<b>此刻 ${esc(frames[f.I].id)}</b></h5>${f.open.length ? f.open.slice(0, 3).map(a => `<div class="ix-d-ask"><i></i><p>${esc(a.prompt)}</p><small>${esc(dueOf(a) || '没有期限')}</small><a href="${esc(href)}">去回答 →</a></div>`).join('') : '<p class="ix-none">没有开着的问题</p>'}</section>`;
  return `<div class="ix-d-k"><span>${esc(dayTime(frames[f.I].at))} · ${esc(frames[f.I].id)} · 离开 ${f.away} 轮</span>${close}</div>
    <div class="ix-d-t">${esc(f.short)} ${m.was} → ${m.peak} → ${m.now}</div><div class="ix-d-s">${esc(f.title)}</div>
    ${m.hidden ? '<p class="ix-none pk-d-flag">上次看和此刻都没有这么高：回来时看不出来</p>' : ''}
    <section><h5>离开期间逐轮<b>上次 ${esc(frames[f.a].id)}</b></h5>${roundsSVG(m, f.a)}</section>
    ${peakSec}${fallSec}${closed}${open}
    ${f.summary ? `<p class="ix-d-sum">${esc(f.summary)}</p>` : ''}`;
}

// ---------- side panel: this frame, or “这一件” ----------
let panelKey = null;
const pinChip = m => `<button type="button" class="pk-chip" data-pin="${esc(m.id)}"><b>${esc(shortOf(m.id))}</b><span>${m.was} → ${m.peak} → ${m.now}</span><i>${m.n ? circled(m.n) : ''}</i></button>`;
function overview(i) {
  if (i === 0) return { kicker: `此刻 · ${frames[0].id}`, title: esc(frames[0].title), body: '<p>还没有整理过任何输入：64 份全是留白，没有可保持的峰值。按 → 或空格开始。</p>' };
  const x = anchorAt(i), v = viewOf(i, x.a), q = asksIn(x.a, i);
  const unseen = q.closed.filter(c => c.unseen);
  const moves = []; for (let k = x.a + 1; k <= i; k += 1) moves.push(...responsesIn(k));
  const fold = moves.filter(r => viaFold(r.link)).length;
  return {
    kicker: `此刻 · ${frames[i].id} · ${records[i].state.revision}`,
    title: esc(frames[i].title),
    body: `<section><h4>上次看 <small>${x.why === 'read' ? '你按的“已阅”' : x.why === 'seen' ? '你选的' : '推定'}</small></h4><p class="pk-side-when"><b>${esc(frames[x.a].id)}</b> ${esc(dayTime(frames[x.a].at))} · 离开 ${v.away} 轮</p><p class="st-muted">${esc(reasonOf(x, i))}</p></section>
      <section><h4>升起又落下 <small>${v.hidden.length} 件 · 点开看那一根</small></h4>${v.hidden.length ? `<div class="pk-chips">${v.hidden.map(pinChip).join('')}</div>` : `<p class="st-muted">${v.away ? '没有：离开期间到过的最高，不是上次看到的，就是此刻还在的。' : '此刻就是上次看。'}</p>`}
        ${v.traceRise.length ? `<p class="st-muted pk-fine">另有 ${v.traceRise.length} 件 0 → 1 → 0（${esc(v.traceRise.map(r => shortOf(r.id)).join('、'))}），只到过最低一档，不算。</p>` : ''}</section>
      ${unseen.length ? `<section><h4>开和关都在你离开时的问题 <small>${unseen.length} 个</small></h4><ul class="pk-closed">${unseen.map(c => `<li><time>${esc(frames[c.k].id)}</time><span>「${esc(askShort(c.a))}」</span><small>${esc(c.answered ? `${c.how}，答掉` : c.how)}</small></li>`).join('')}</ul></section>` : ''}
      <section class="pk-asks"><h4>此刻开着的问题 <small>${q.open.length} 条 · 去回答链到同一帧的 D</small></h4>${q.open.length ? `<ul>${q.open.map(a => `<li><span>${esc(askShort(a))}</span><small>${esc([shortOf(rootOf(a.item)), dueOf(a)].filter(Boolean).join(' · '))}</small><a href="${esc(answerLink())}">去回答 →</a></li>`).join('')}</ul>` : '<p class="st-muted">没有开着的问题</p>'}</section>
      <section><h4>离开期间你的动作 <small>${moves.length} 条</small></h4><p class="st-muted">${!moves.length ? '没有。' : moves.length === fold ? `${fold} 条都在 Fold 里${x.why === 'fold' ? '，锚点跟着最近的一条' : ''}。` : `${fold ? `${fold} 条在 Fold 里，` : ''}${moves.length - fold} 条在来源处（GitHub、短信、电话）；来源处的动作不算看过 Fold，锚点不跟着它们走。`}</p></section>
      ${v.over.length ? `<section><h4>没画的表 <small>${v.over.length} 件</small></h4><p class="st-muted">${esc(v.over.map(r => `${shortOf(r.id)} ${r.was}→${r.peak}→${r.now}`).join('；'))}</p></section>` : ''}`,
  };
}
stage.setOverview(overview);
function trendSVG(id, v) {
  const series = frames.map((_, k) => shareMaps[k].get(id) || 0), n = LAST, W = 300, H = 32, top = Math.max(24, ...series), bw = W / n;
  const bars = series.slice(1).map((s, k) => {
    const h = s ? Math.max(1.5, (s / top) * (H - 2)) : 1, i = k + 1;
    return `<rect x="${(k * bw + bw * 0.15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" class="${i === v.now ? 'is-now' : i > v.now ? 'is-later' : i > v.a ? 'is-away' : s ? '' : 'is-off'}"/>`;
  }).join('');
  const x0 = (v.a - 1 + 0.5) * bw, x1 = (v.now - 0.5 + 0.5) * bw + bw * 0.5;
  return `<svg class="ix-trend pk-trend" viewBox="0 0 ${W} ${H + 4}" preserveAspectRatio="none" aria-hidden="true"><rect class="pk-win" x="${Math.max(0, x0).toFixed(1)}" y="0" width="${Math.max(2, x1 - Math.max(0, x0)).toFixed(1)}" height="${H + 3}"/>${bars}</svg><div class="ix-axis"><span>${esc(frames[1].id)}</span><span>离开期间加框</span><span>${esc(frames[LAST].id)}</span></div>`;
}
function panelFor(id) {
  return i => {
    const x = anchorAt(i), v = viewOf(i, x.a), m = v.rowById.get(id);
    const kick = `这一件 · ${frames[i].id} · 离开 ${v.away} 轮`;
    if (!m) return { kicker: kick, title: esc(shortOf(id)), body: `<p class="st-muted">这一帧的窗口里没有它。</p>${itemDetailHTML(id, i)}` };
    const q = asksIn(x.a, i, id);
    const all = [...new Map(frames.flatMap(fr => Object.values(fr.asks || {})).filter(a => rootOf(a.item) === id).map(a => [a.id, a])).values()];
    const item = records[i].snapshot.items[id];
    return {
      kicker: kick, title: esc(titleAt(id, i)),
      body: `<section><h4>份额 · 两周 <small>${esc(shortOf(id))} 此刻 ${m.now} / 64${item ? ` · ${esc(kindWord(item))}` : ''}</small></h4>${trendSVG(id, v)}</section>
        <section><h4>离开期间 <small>上次 ${esc(frames[x.a].id)} → 此刻 ${esc(frames[i].id)}</small></h4><ol class="pk-steps">${m.s.map((s, k) => `<li class="${k === m.n && m.n ? 'is-peak' : ''}${k === 0 ? ' is-anchor' : ''}"><button type="button" data-st="go" data-frame="${x.a + k}"><time>${k ? circled(k) : '上次'} ${esc(dayTime(frames[x.a + k].at))}</time></button><b>${s}</b><span>${esc(frames[x.a + k].title)}</span></li>`).join('')}</ol>
          <p class="pk-fine st-muted">${m.hidden ? `峰值 ${m.peak} 高过上次（${m.was}）也高过此刻（${m.now}）：回来时看不出来。` : m.peak > m.now ? `峰值 ${m.peak} 不高过上次看到的 ${m.was}，落差在虚线上看得出来。` : '峰值就是此刻。'}</p></section>
        ${q.closed.length ? `<section><h4>离开期间关上的问题</h4><ul class="pk-closed">${q.closed.map(c => `<li><time>${esc(frames[c.k].id)}</time><span>「${esc(askShort(c.a))}」</span><small>${esc(c.answered ? `${c.how}，答掉` : c.how)}</small></li>`).join('')}</ul></section>` : ''}
        ${q.open.length ? `<section class="pk-asks"><h4>此刻开着的问题</h4><ul>${q.open.map(a => `<li><span>${esc(askShort(a))}</span><small>${esc(dueOf(a))}</small><a href="${esc(answerLink())}">去回答 →</a></li>`).join('')}</ul></section>` : ''}
        <details class="pk-more"><summary>摘要、依据、来源与版本${all.length ? ` · 登记过 ${all.length} 个问题` : ''}</summary>${itemDetailHTML(id, i)}</details>`,
    };
  };
}
function openPanel(view) {
  panelKey = view.id;
  stage.showDetail(panelFor(view.id));
  document.querySelector('.st-title').textContent = `这一件 · ${frames[stage.index].id} · ${dayTime(frames[stage.index].at)} / ${view.short}`;
}
function closePanel() {
  if (!panelKey) return;
  panelKey = null;
  stage.showDetail(null);
  document.querySelector('.st-title').textContent = frames[stage.index].title;
}
stage.onEscape = () => { if (ix.s.open) { ix.close(); return true; } return false; };
document.querySelector('.st-side').addEventListener('click', event => {
  const chip = event.target.closest('[data-pin]');
  if (chip && hasId(chip.dataset.pin)) ix.open(chip.dataset.pin);
});

// ---------- focus: dim, pop and the keyboard ring, from ix.frame() ----------
let litId = null, popped = null, opShown = '';
function paintFocus() {
  const focus = X.dim > 0.001 ? X.focus : null;
  if (focus !== litId) {
    if (litId) nodes.get(litId)?.outer.classList.remove('is-lit');
    litId = focus;
    if (focus) nodes.get(focus)?.outer.classList.add('is-lit');
  }
  for (const [id, n] of nodes) n.outer.classList.toggle('is-key', id === X.keyFocus);
  const fixed = X.popId ? clamp(X.pop) : 0, op = (1 - (0.3 + 0.52 * fixed) * X.dim).toFixed(3);
  if (op !== opShown) { opShown = op; figure.style.setProperty('--pk-op', op); }
  figure.classList.toggle('is-focus', Boolean(focus));
  const n = X.popId && X.pop > 0.001 ? nodes.get(X.popId) : null;
  if (popped && popped !== n) { popped.pop.setAttribute('transform', ''); popped = null; }
  if (n) { n.pop.setAttribute('transform', `translate(0,${(-IX.pop * X.pop).toFixed(2)})`); popped = n; }
  for (const li of els.left.querySelectorAll('[data-id]')) li.classList.toggle('is-lit', li.dataset.id === focus);
}
function paintPanel() {
  if (X.detail && ix.view && panelKey !== ix.view.id) openPanel(ix.view);
  else if (!X.detail && panelKey) closePanel();
}
const proxyKey = () => `${stage.index}|${anchorKey()}|${[...disp.keys()].filter(hasId).join(',')}`;
const proxyList = () => (shownView?.meters || []).filter(m => hasId(m.id)).map(m => ({ id: m.id, label: `${shortOf(m.id)}：上次 ${m.was}，峰值 ${m.peak}${m.n ? `（第 ${m.n} 轮）` : ''}，此刻 ${m.now}${m.hidden ? '，看不出来的起落' : ''}` }));

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
  paintMeters();
  paintGroups();
  renderControls();
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
// Hooks with the same names and meanings as foldYield (ix.mjs), plus this page's anchor and peaks.
window.foldPeak = {
  ...ix.hooks(),
  hover: name => ix.hover(idFor(name), 'pointer'),
  open: name => ix.open(idFor(name)),
  pointOf: name => { const c = centreOf(idFor(name)); if (!c) return null; const b = figure.getBoundingClientRect(); return { x: b.left + c.x, y: b.top + c.y }; },
  /** A point `d` px past a meter's right edge, level with its middle (inside the widened hit band). */
  nearOf: (name, d = 9) => { const r = meterRect(idFor(name)), b = figure.getBoundingClientRect(); if (!r) return null; return { x: b.left + r.x1 + d, y: b.top + (geo.TOP + geo.BOT) / 2 }; },
  /** The first meter that rose and fell unseen, else the tallest one. */
  pick: () => { const v = shownView; const m = v?.hidden.find(x => hasId(x.id)) || [...(v?.meters || [])].filter(x => hasId(x.id)).sort((a, b) => b.peak - a.peak)[0]; return m ? shortOf(m.id) : null; },
  tell: startTell, skip: skipTell, tellAt, play: startPlay, stop: stopRun,
  telling: () => run.kind === 'tell', playing: () => run.kind === 'play',
  settled: () => !live(),
  phase: () => (run.kind === 'tell' ? { tell: +run.t.toFixed(3), ...(({ beat, round, revealed, cleared, restored }) => ({ beat, round, revealed, cleared, restored }))(tellPhase()) } : trans ? { u: +trans.u.toFixed(3), dur: trans.P.dur } : null),
  anchor: () => { const x = anchorAt(stage.index); return { frame: frames[x.a].id, index: x.a, why: x.why, away: stage.index - x.a, reason: reasonOf(x, stage.index), rule: frames[anchorOf(stage.index).a].id }; },
  peaks: () => viewNow().meters.map(m => ({ id: m.id, short: shortOf(m.id), was: m.was, peak: m.peak, now: m.now, round: m.n, at: frames[m.at].id, hidden: m.hidden })),
  hidden: () => viewNow().hidden.map(m => `${shortOf(m.id)} ${m.was} → ${m.peak} → ${m.now}`),
  read, undo: unread, seen: name => { const k = frameIndexOf(name); undo.length = 0; setAnchor(k >= 0 ? { a: k, why: 'seen' } : null); },
  plan, times: () => (plan ? TT() : null),
  perf: () => {
    const ts = perf.times.slice(1), avg = ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length), work = perf.work.slice(1);
    return { frames: ts.length, fps: +(1 / avg).toFixed(1), p95ms: +(p95(ts) * 1000).toFixed(1), maxMs: +(Math.max(0, ...ts) * 1000).toFixed(1), long: ts.filter(t => t > 0.025).length, workMs: +(work.reduce((a, b) => a + b, 0) / Math.max(1, work.length)).toFixed(2), workP95ms: +p95(work).toFixed(2), workMaxMs: +Math.max(0, ...work).toFixed(2) };
  },
  resetPerf: () => { perf.on = true; perf.times = []; perf.work = []; },
};
