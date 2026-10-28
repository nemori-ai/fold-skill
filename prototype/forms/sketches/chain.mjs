// 10 等待链（polish/chain-motion.md）：谁在等谁、你挡住了谁。一根朱红竖脊就是你；此刻开着的每个问题是脊上的一个结，
// 一件事一行。结的左边是等这一问的人，离脊越远等得越久（横轴是 log₂(1 + 小时)）；右边是答了之后的下一环：选项、
// approve 要执行的动作与期限。底部灰着此刻没有登记问题、按同一规则仍有人开口的几件事：它们不经过你。
//
// 谁在等你由规则现算（记录第 2 节），不手工标注：问题所在条目这一版的依据（sources）里，不是你、不是机器、不是公开
// 资料、不是群里通讯录外的人或公开站点上的陌生人的作者，一人算一个；等了多久从他在依据里最早的那条算起。
//
// 动画：时间本身就是动画。横轴以此刻为原点，时间走的时候每个点一起往左滑（近的快、远的慢）；问题的开闭、等你的人换了
// 谁、行的上下与英雄数字都在批次刻度上硬切。你答的那一下在时间走到它时把结填成朱红，人要等下一轮整理才松开。
// - 直接打开（顶层、不带 ?frame=、没有 referrer）讲一遍约 12 秒：谁在等、你开口、一串人松开；那一轮由规则选出（两周里
//   被你的回答放走的人最多的一轮）。任意键或点空白跳到终态，「▶ 重演」再讲；?at=<秒> 把故事冻在那一刻（截静帧用）。
// - ▶ 连播每 12 小时约 0.9 秒、刻度上停 0.12 秒；←/→、选帧与合页顶栏选帧走 0.38 秒的节拍。
// - 概念层只有每行底边的“地毯”：这件事上进来过的每条输入一道灰刻，落在同一条对数横轴上；只在时间走时动。
// 交互接 motion/ix.mjs：一行（i:条目）或一个人（w:名字）都是一件；悬停出概要卡，点击沿自身几何弹出 8 px、引线出到详情
// 卡，页头与右栏切到“这一件”；开着的问题带“去回答 →”链到同一帧的 D。钩子 window.foldChain 与 foldTiming 同名同义。
import { frames, records, at, textWidth, fitText } from './kit.mjs';
import {
  mountLivePage, askPaths, pathStatus, responses, dossierHTML, actionSentence, EXPECT_WORDS, CLOSE_WORDS,
  createDrawer, esc, dayTime, eventById, reducedMotion, SLOW, scenario, formatTime, streamOf, STREAMS, hasStreams,
} from './live.mjs';
import { createIx, placeBeside, IX } from '../motion/ix.mjs';
import { withDataset } from '../../data/select.mjs';
import { familyPlace } from '../../variants/shared.mjs?v=feedback-loop-1';

const MONO = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
const SANS = getComputedStyle(document.documentElement).getPropertyValue('--sans') || 'sans-serif';
const HOUR = 3600000;
const last = frames.length - 1;
const params = new URLSearchParams(location.search);
const lerp = (a, b, p) => a + (b - a) * p;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeInOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
// Fast start, settles with an overshoot of about 3.7 % (as IX).
const easeOutBack = k => { const u = clamp(k) - 1; return 1 + 2 * u ** 3 + u ** 2; };
const wall = () => performance.now() / 1000;
const tOf = e => Date.parse(e.at);

// ---------- beats (seconds; chain-motion.md 第 3 节) ----------
// A round of 12 hours: ▶ walks it in about 0.88 s and holds 0.12 s on the batch tick; ← / → step in 0.38 s.
const BEAT = { hold: 0.12, play: 0.88, step: 0.38, jumpMax: 0.9 };
// The cut, in seconds after the tick: the lines of a closed question let go, rows move, new lines reach out, the number turns.
// A row that changes zone (onto or off the spine) dims while it travels and takes its new words only once it has landed.
const CUT = { detach: 0.3, move0: 0.25, move1: 0.65, enter0: 0.35, enter1: 0.7, label0: 0.4, label1: 0.7, land0: 0.62, land1: 0.85, number: 0.4, total: 0.9 };
const STORY_SLOW = 1.5;

// ---------- the rule (chain-motion.md 第 2 节) ----------
const persona = scenario.persona?.name;
const isSelf = e => Boolean(e?.self) || (Boolean(persona) && e?.from === persona);
const MACHINE = new Set(['bot', 'automation']);
const STRANGERS = new Set(['life', 'community', 'subscription']);
/** Does this cited input count as someone waiting on you: not you, not a machine, not a public document, not a stranger. */
function waiterInput(e) {
  return Boolean(e) && !isSelf(e) && !MACHINE.has(e.author_kind) && !e.publicSourceId
    && !String(e.from || '').startsWith('~') && !STRANGERS.has(e.stream);
}
const whoKey = e => String(e.from || '').split(' · ')[0].trim();
/** How the forms name the author and the place: family names and chats as the action sentences word them. */
function placeOf(e) {
  const family = familyPlace(e);
  if (family) return { who: family.who || whoKey(e), where: family.where };
  return { who: whoKey(e), where: String(e.channel || '').split(' · ')[0] };
}
function citedOf(item) {
  const out = [];
  for (const s of item?.sources || []) {
    const ref = String(s.ref || '');
    if (!ref.startsWith('event:')) continue;
    const e = eventById(ref.slice(6));
    if (e) out.push(e);
  }
  return out;
}
/** The people behind an item's version: one per author of a cited input that counts, timed from their earliest one. */
function waitersOf(item, now) {
  const by = new Map();
  for (const e of citedOf(item)) {
    if (tOf(e) > now || !waiterInput(e)) continue;
    const key = whoKey(e);
    if (!by.has(key)) by.set(key, { key, ...placeOf(e), inputs: [] });
    by.get(key).inputs.push(e);
  }
  for (const w of by.values()) { w.inputs.sort((a, b) => tOf(a) - tOf(b)); w.since = tOf(w.inputs[0]); w.latest = tOf(w.inputs.at(-1)); }
  return [...by.values()].sort((a, b) => a.since - b.since || (a.key < b.key ? -1 : 1));
}
// Every input tied to an item (relatedIds), for the concept layer's rug.
const relatedBy = new Map();
for (const f of frames) for (const e of f.events) for (const id of e.relatedIds || []) {
  if (!relatedBy.has(id)) relatedBy.set(id, []);
  relatedBy.get(id).push(e);
}
const answersOf = (key, upto = Infinity) => responses.filter(r => r.path === key && r.at <= upto);
const movesOn = (item, from, upto) => responses.filter(r => r.item === item && r.at >= from && r.at <= upto);

// ---------- the chain of every frame ----------
const GREY_MAX = 4;
const dueSort = (a, b) => ((a.due != null) !== (b.due != null) ? (a.due != null ? -1 : 1) : (a.due ?? 0) - (b.due ?? 0) || a.path.opened - b.path.opened);
function chainAt(k, prev) {
  const now = at(k), snap = records[k].snapshot.items;
  const rows = askPaths.filter(p => pathStatus(p, k).state === 'open' && snap[p.item]?.status === 'active').map(p => {
    const item = snap[p.item], raw = p.ask.due_at || item.due_at;
    const waiters = waitersOf(item, now);
    const inputs = new Set(waiters.flatMap(w => w.inputs.map(e => e.id)));
    // The rug: every input tied to this item (relatedIds over the replay, so ones that arrive while time walks fade in)
    // or cited by this version, less the waiters' own (they are the ink dots).
    const rug = [...new Map([...(relatedBy.get(p.item) || []), ...citedOf(item)].map(e => [e.id, e])).values()].filter(e => !inputs.has(e.id));
    return { id: p.item, zone: 'spine', path: p, item, due: raw ? Date.parse(raw) : null, waiters, inputs, rug };
  }).sort(dueSort);
  const people = new Map();
  for (const row of rows) for (const w of row.waiters) {
    if (!people.has(w.key)) people.set(w.key, { key: w.key, who: w.who, where: w.where, rows: [], since: w.since });
    const p = people.get(w.key);
    p.rows.push({ id: row.id, path: row.path.key, since: w.since, latest: w.latest, n: w.inputs.length });
    p.since = Math.min(p.since, w.since);
  }
  // Questions that closed this round: how, who they let go, who carries over to the next question on the same item.
  const closed = k === 0 ? [] : askPaths.filter(p => p.to === k).map(p => {
    const before = prev?.rows.find(r => r.path.key === p.key)?.waiters || [];
    const next = rows.find(r => r.id === p.item) || null;
    const onNext = new Set((next?.waiters || []).map(w => w.key));
    const status = pathStatus(p, k);
    return {
      key: p.key, item: p.item, path: p, how: status.how, answer: answersOf(p.key, p.closed)[0] || null, next,
      freed: before.filter(w => !people.has(w.key)), carried: before.filter(w => onNext.has(w.key)),
      elsewhere: before.filter(w => people.has(w.key) && !onNext.has(w.key)),
      title: snap[p.item]?.title || null, active: snap[p.item]?.status === 'active',
      shareFrom: records[k - 1].snapshot.items[p.item]?.share ?? null, shareTo: snap[p.item]?.status === 'active' ? snap[p.item].share : null,
    };
  });
  // Not through you: root items without an open question that someone (by the same rule) has spoken on; this round's
  // closed ones first, so “what moved after you answered” shows where it went.
  const onSpine = new Set(rows.map(r => r.id));
  const roots = Object.values(snap).filter(x => x.status === 'active' && !x.parent_id && !onSpine.has(x.id));
  const pool = roots.map(x => ({ id: x.id, zone: 'grey', item: x, voices: waitersOf(x, now).sort((a, b) => b.latest - a.latest), closed: closed.find(c => c.item === x.id) || null }))
    .filter(r => r.voices.length || r.closed)
    .sort((a, b) => Boolean(b.closed) - Boolean(a.closed) || b.item.share - a.item.share || (a.id < b.id ? -1 : 1));
  const grey = pool.slice(0, GREY_MAX);
  return { k, rows, people, closed, grey, more: roots.length - grey.length };
}
const chains = [];
frames.forEach((_, k) => chains.push(chainAt(k, chains[k - 1])));

// The story's round: the one where your answers let the most people go (everything a person waited on in k closed answered
// by k + 1); ties go to more people gone in all, then to the earlier round.
const releaseRound = (() => {
  let best = null;
  for (let k = 0; k < last; k += 1) {
    const a = chains[k], b = chains[k + 1];
    const answered = new Set(b.closed.filter(c => c.how === 'answered').map(c => c.key));
    if (!answered.size) continue;
    const gone = [...a.people.keys()].filter(w => !b.people.has(w));
    const byYou = gone.filter(w => a.people.get(w).rows.every(x => answered.has(x.path)));
    if (!best || byYou.length > best.byYou.length || (byYou.length === best.byYou.length && gone.length > best.gone.length)) best = { k, byYou, gone };
  }
  return best;
})();

// The axis: as far as the longest wait over the replay (plus the round it can walk on), rounded up to a tick.
const TICKS = [[1, '1 时'], [6, '6 时'], [12, '12 时'], [24, '1 天'], [48, '2 天'], [96, '4 天'], [168, '1 周'], [336, '2 周'], [672, '4 周']];
const longestEver = Math.max(1, ...chains.flatMap(c => [
  ...c.rows.flatMap(r => r.waiters.map(w => (at(c.k) - w.since) / HOUR)),
  ...c.grey.flatMap(r => r.voices.map(v => (at(c.k) - v.latest) / HOUR)),
]));
const HMAX = (TICKS.find(([h]) => h >= longestEver + 12) || TICKS.at(-1))[0];

// ---------- words ----------
const ago = ms => { const h = ms / HOUR; return h < 1 ? `${Math.max(1, Math.round(h * 60))} 分` : h < 48 ? `${Math.round(h)} 时` : `${(h / 24).toFixed(1)} 天`; };
const dueWords = (due, now) => (due == null ? '' : due >= now ? `期限还有 ${ago(due - now)}` : `期限已过 ${ago(now - due)}`);
const qShort = path => path.ask.short || path.ask.prompt;
const openWords = ms => (ms < 60000 ? '刚登记' : `开了 ${ago(ms)}`);
const aloneWords = ms => (ms < 60000 ? '问题刚登记' : `问题自己等了 ${ago(ms)}`);
const groupWord = id => (hasStreams ? STREAMS[streamOf(id)]?.label || '' : '');
const HOW_TAG = { answered: '你答后关上', lapsed: '问题失效', replaced: '换成新问题', withdrawn: '随事项撤下', merged: '随事项并入' };
const linkD = k => withDataset(`../../index.html?variant=d&frame=${frames[k].id}`);

// ---------- the page frame ----------
const KEY = `
  <span><svg width="34" height="14"><line x1="17" y1="0" x2="17" y2="14" stroke="var(--vermilion)" stroke-width="2"/><circle cx="17" cy="7" r="4.6" fill="var(--paper)" stroke="var(--vermilion)" stroke-width="2"/></svg>你：开着的问题是脊上的空心结</span>
  <span><svg width="16" height="14"><circle cx="8" cy="7" r="4.6" fill="var(--vermilion)"/></svg>你答了，等下一轮整理读到</span>
  <span><svg width="44" height="14"><circle cx="5" cy="7" r="3.4" fill="var(--ink)"/><path d="M5 7 H40" stroke="var(--ink)" stroke-width="1.2"/></svg>等你的人：离脊越远等得越久（对数）</span>
  <span><svg width="40" height="14"><circle cx="5" cy="7" r="3" fill="none" stroke="var(--ink-3)" stroke-width="1.3"/><text x="11" y="10.5" font-size="9.5" fill="var(--ink-2)">选项</text></svg>答了之后的下一环</span>
  <span><svg width="30" height="14"><path d="M2 13v-4M7 13v-4M9 13v-4M16 13v-4M24 13v-4M27 13v-4" stroke="var(--ink-3)"/></svg>这件事上进来过的输入</span>
  <span><svg width="30" height="14"><circle cx="5" cy="7" r="2.6" fill="var(--ink-3)"/><path d="M5 7 H22" stroke="var(--ink-3)"/><circle cx="25" cy="7" r="3" fill="var(--paper)" stroke="var(--ink-3)" stroke-width="1.2"/></svg>不经过你</span>
  <span class="ch-key-rule">谁在等由规则从依据里现算：不是你、不是机器、不是群里的生人或公开站点上的陌生人</span>`;
const page = mountLivePage({
  id: 'chain', no: 10, name: '等待链', key: KEY,
  relation: '谁在等谁、你挡住了谁：每个开着的问题后面站着哪些人、各等了多久，答了之后哪一环才能动；答掉一件，放走的是一串人。',
  tools: '<button class="lv-help-btn ch-tell" data-ch-tell title="从谁在等讲到一串人松开（约 12 秒，任意键跳过）">▶ 重演</button>',
  onFrame, onKey, onPlay: togglePlay,
});
const { figure, side } = page;
figure.innerHTML = '<div class="ch-canvas"></div>';
const holder = figure.querySelector('.ch-canvas');
const drawer = createDrawer(page.body, {});
const $date = document.querySelector('.lv-date'), $title = document.querySelector('.lv-title');
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const setA = (el, name, value) => { const v = typeof value === 'number' ? value.toFixed(1) : String(value); if (el._a?.[name] !== v) { (el._a ||= {})[name] = v; el.setAttribute(name, v); } };
const setOp = (el, v) => { const s = v >= 0.999 ? '' : Math.max(0, v).toFixed(3); if (el._op !== s) { el._op = s; el.style.opacity = s; } };

// ---------- geometry ----------
const FAN = 16, ROW = 46, GREY_ROW = 24, GREY_HEAD = 30;
let G = null;
function geometry() {
  const W = figure.clientWidth, H = figure.clientHeight;
  const SX = Math.round(clamp(W * 0.56, 480, W - 430));
  const XL = 150, X0 = SX - 24, logSpan = Math.log2(1 + HMAX);
  const x = h => X0 - (X0 - XL) * Math.log2(1 + clamp(h, 0, HMAX * 1.6)) / logSpan;
  return { W, H, SX, XL, X0, RX: SX + 20, x, top: 50, knotEnd: SX - 8 };
}
const rowH = (n, s) => Math.max(ROW, 22 + FAN * Math.max(0, n - 1)) * s;
function layoutOf(c) {
  const rows = new Map();
  const greyBlock = c.grey.length || c.more ? GREY_HEAD + c.grey.length * GREY_ROW + (c.more ? 18 : 0) : 0;
  const avail = G.H - G.top - greyBlock - 14, need = c.rows.reduce((s, r) => s + rowH(r.waiters.length, 1), 0);
  // Too many rows: squeeze down to 0.55; room to spare: let the rows breathe up to 1.3.
  const s = need > avail ? Math.max(0.55, avail / need) : Math.min(1.3, avail / need);
  let y = G.top;
  for (const r of c.rows) {
    const h = rowH(r.waiters.length, s), n = r.waiters.length;
    rows.set(r.id, { y: y + h / 2, h, zone: 'spine', row: r, fan: new Map(r.waiters.map((w, j) => [w.key, (j - (n - 1) / 2) * FAN * s])) });
    y += h;
  }
  const spineEnd = c.rows.length ? y - Math.min(14, rowH(0, s) / 2 - 8) : G.top - 4;
  const greyTop = y + 12;
  let gy = greyTop + GREY_HEAD;
  for (const r of c.grey) { rows.set(r.id, { y: gy + GREY_ROW / 2, h: GREY_ROW, zone: 'grey', row: r, fan: new Map() }); gy += GREY_ROW; }
  return { rows, spineEnd, greyTop, moreY: gy + 13, grey: Boolean(greyBlock), more: c.more };
}

let svg = null, rowsG = null, spine = null, greyHead = null, moreText = null, linkPath = null, concept = null, ctx = null, dpr = 1;
const rowEls = new Map();
function build() {
  G = geometry();
  const { W, H, SX, XL, RX, x } = G;
  dpr = Math.min(2, devicePixelRatio || 1);
  let grid = '';
  for (const [h, label] of TICKS.filter(([h]) => h <= HMAX)) {
    const tx = x(h).toFixed(1);
    grid += `<line class="ch-tick" x1="${tx}" x2="${tx}" y1="30" y2="${H}"/><text class="ch-ticklabel" x="${tx}" y="22">${label}</text>`;
  }
  holder.innerHTML = `<canvas class="ch-concept" width="${Math.round(W * dpr)}" height="${Math.round(H * dpr)}" style="width:${W}px;height:${H}px" aria-hidden="true"></canvas>
    <svg class="ch-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="等待链：谁在等你、你挡住了谁">
      <g class="ch-grid">${grid}<text class="ch-axis-l" x="${XL - 26}" y="22">← 已经等了多久</text></g>
      <text class="ch-you" x="${SX}" y="22">你</text><text class="ch-then" x="${RX}" y="22">答了之后 →</text>
      <line class="ch-spine" x1="${SX}" x2="${SX}" y1="32" y2="32"/>
      <g class="ch-greyhead"><line x1="0" x2="${W}" y1="0" y2="0"/><text x="0" y="18">不经过你</text><text class="ch-greysub" x="62" y="18">此刻没有登记问题；按同一条规则，有人开过口</text></g>
      <g class="ch-rows"></g>
      <path class="ch-link"/>
      <text class="ch-more" x="${RX}" y="0"></text>
    </svg>`;
  svg = holder.querySelector('svg');
  rowsG = svg.querySelector('.ch-rows'); spine = svg.querySelector('.ch-spine'); greyHead = svg.querySelector('.ch-greyhead');
  moreText = svg.querySelector('.ch-more'); linkPath = svg.querySelector('.ch-link');
  concept = holder.querySelector('.ch-concept'); ctx = concept.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rowEls.clear();
  G.fx = figure.offsetLeft; G.fy = figure.offsetTop;
  layout = null; drawnKey = '';
}

// ---------- rows: keyed elements that move between layouts ----------
let layout = null, cutAt = -1e9, cutBack = false, prevN = 0, prevSpineEnd = 32, prevGreyTop = null;
let clock = 0;
function makeRow(id) {
  const g = svgEl('g', { class: 'ch-row', 'data-id': `i:${id}` });
  g.innerHTML = '<rect class="ch-hit"/><g class="ch-ws"></g><g class="ch-voice"><path class="ch-vline"/><circle class="ch-vdot" r="2.6"/><text class="ch-vname"></text></g>'
    + '<circle class="ch-knot" r="7"/><circle class="ch-gknot" r="3.4"/><g class="ch-label-old"></g><g class="ch-label"></g>';
  rowsG.append(g);
  const el = {
    id, g, hit: g.querySelector('.ch-hit'), ws: g.querySelector('.ch-ws'), voice: g.querySelector('.ch-voice'), vline: g.querySelector('.ch-vline'),
    vdot: g.querySelector('.ch-vdot'), vname: g.querySelector('.ch-vname'), knot: g.querySelector('.ch-knot'), gknot: g.querySelector('.ch-gknot'),
    label: g.querySelector('.ch-label'), oldLabel: g.querySelector('.ch-label-old'), waiters: new Map(),
    y: null, y0: 0, y1: 0, h: ROW, z: 0, z0: 0, z1: 0, a0: 0, a1: 1, alpha: 0, entering: true, leaving: false, labelKey: '', crossfade: false, L: null, answeredKey: '',
  };
  rowEls.set(id, el);
  return el;
}
function makeWaiter(el, key) {
  const g = svgEl('g', { class: 'ch-w', 'data-id': `w:${key}` });
  g.innerHTML = '<path class="ch-wline"/><circle class="ch-whit" r="10"/><circle class="ch-wdot" r="4"/><text class="ch-wname"><tspan class="ch-wwho"></tspan><tspan class="ch-wh" dx="5"></tspan></text>';
  el.ws.append(g);
  const w = { key, g, line: g.querySelector('.ch-wline'), hit: g.querySelector('.ch-whit'), dot: g.querySelector('.ch-wdot'), name: g.querySelector('.ch-wname'), who: g.querySelector('.ch-wwho'), hours: g.querySelector('.ch-wh'), labelW: 0,
    dy: 0, dy0: 0, dy1: 0, state: 'enter', since: 0, data: null };
  el.waiters.set(key, w);
  return w;
}

/** The right-hand words of a row as of frame k (numbers are the batch's, not the moving clock's). */
function labelHTML(L, k, answered) {
  const r = L.row, now = at(k), { RX, W } = G;
  const room = W - RX - 4;
  if (r.zone === 'grey') {
    const tag = r.closed ? `${HOW_TAG[r.closed.how]} · ` : '';
    const text = fitText(`${tag}${r.item.title}`, room - 46, 11.5, { minSize: 9.5 });
    return `<text class="ch-gtitle" x="${RX}" y="4">${r.closed ? `<tspan class="ch-gtag">${esc(tag)}</tspan>${esc(text.lines[0].slice(tag.length))}` : esc(text.lines[0])}</text>
      <text class="ch-gshare" x="${W - 4}" y="4">${r.item.share} 份</text>`;
  }
  const q = qShort(r.path), shareText = ` ${r.item.share} 份`;
  const qFit = fitText(q, room - textWidth(shareText, 11, 400, MONO) - 6, 13, { weight: 600, minSize: 10.5 });
  let head = `<text class="ch-q" x="${RX}" y="-3"><tspan${qFit.size < 13 ? ` style="font-size:${qFit.size}px"` : ''}>${esc(qFit.lines[0])}</tspan><tspan class="ch-share" dx="6">${r.item.share} 份</tspan></text>`;
  // Once you have answered, the deadline gives way to how the answer stood against it (a fact fixed when you answered).
  const due = answered ? '' : dueWords(r.due, now), dueW = due ? textWidth(due, 11, 500, MONO) + 10 : 0;
  if (answered) {
    const late = r.due != null && answered.at > r.due ? ` · 比期限晚 ${ago(answered.at - r.due)}` : '';
    const said = fitText(`✓ ${actionSentence(answered)} · ${formatTime(answered.event.at)}${late} · 等下一轮整理读到`, room - dueW, 11.5, { minSize: 9.5 });
    head += `<text class="ch-said" x="${RX}" y="14"${said.size < 11.5 ? ` style="font-size:${said.size}px"` : ''}>${esc(said.lines[0])}</text>`;
  } else {
    // The branches: each option a hollow station; approve adds the outside action that follows.
    let x = RX, opts = '';
    const list = (r.path.ask.actions || []).map(a => `${a.label}${a.recommended ? ' · 推荐' : ''}`);
    const subject = r.path.ask.subject?.label ? `⇒ ${r.path.ask.subject.label}` : '';
    const limit = RX + room - dueW;
    for (const [n, text] of list.entries()) {
      const w = textWidth(text, 11.5, 400, SANS) + 22;
      const room = limit - x - (n < list.length - 1 ? 18 : 0);
      if (w > room) {
        if (room > 56) {
          const cut = fitText(text, room - 22, 11.5, { minSize: 11.5 });
          opts += `<circle class="ch-ostation" cx="${(x + 4).toFixed(1)}" cy="10" r="3.2"/><text class="ch-opt" x="${(x + 11).toFixed(1)}" y="14">${esc(cut.lines[0])}</text>`;
        } else opts += `<text class="ch-opt" x="${x.toFixed(1)}" y="14">…</text>`;
        x = limit; break;
      }
      opts += `<circle class="ch-ostation" cx="${(x + 4).toFixed(1)}" cy="10" r="3.2"/><text class="ch-opt" x="${(x + 11).toFixed(1)}" y="14">${esc(text)}</text>`;
      x += w;
    }
    if (subject && x + textWidth(subject, 11, 400, SANS) + 4 < limit) opts += `<text class="ch-subj" x="${x.toFixed(1)}" y="14">${esc(subject)}</text>`;
    head += opts;
  }
  if (due) head += `<text class="ch-due${r.due < now ? ' is-late' : ''}" x="${W - 4}" y="14">${esc(due)}</text>`;
  if (!r.waiters.length) head += `<text class="ch-alone" x="${G.knotEnd - 12}" y="4">${now - r.path.opened < 60000 ? '没有人开口，问题刚登记' : `没有人开口，问题自己等了 ${esc(ago(now - r.path.opened))}`}</text>`;
  return head;
}

/** Cut to frame k: every row and every person gets its new target; the motion runs in paint(). */
function cutTo(k, back) {
  const c = chains[k], L = layoutOf(c);
  for (const el of rowEls.values()) {
    el.y0 = el.y ?? 0; el.z0 = el.z; el.a0 = el.alpha;
    const target = L.rows.get(el.id);
    if (!target) { el.leaving = true; el.a1 = 0; el.y1 = el.y0; el.z1 = el.z; continue; }
  }
  for (const [id, T] of L.rows) {
    let el = rowEls.get(id), fresh = false;
    if (!el || el.leaving) {
      if (el && el.leaving) { el.leaving = false; } else { el = makeRow(id); fresh = true; }
    }
    if (fresh) { el.y = T.y; el.y0 = T.y; el.z = T.zone === 'grey' ? 1 : 0; el.z0 = el.z; el.alpha = 0; el.a0 = 0; }
    el.y1 = T.y; el.h = T.h; el.z1 = T.zone === 'grey' ? 1 : 0; el.a1 = 1; el.L = T;
    // People on this row: staying ones move to their new place in the fan, new ones reach out from the knot, the rest let go.
    const keep = new Set(T.zone === 'spine' ? T.row.waiters.map(w => w.key) : []);
    for (const w of el.waiters.values()) {
      w.dy0 = w.dy;
      if (keep.has(w.key)) { w.state = w.state === 'leave' ? 'enter' : 'stay'; w.dy1 = T.fan.get(w.key); }
      else { w.state = 'leave'; w.dy1 = w.dy; }
    }
    if (T.zone === 'spine') for (const data of T.row.waiters) {
      let w = el.waiters.get(data.key);
      if (!w) { w = makeWaiter(el, data.key); w.dy = T.fan.get(data.key); w.dy0 = w.dy; w.dy1 = w.dy; w.state = 'enter'; }
      w.data = data;
      const whoText = `${data.who} · ${data.where}`, hoursText = `${ago(at(k) - data.since)}${data.inputs.length > 1 ? ` · ${data.inputs.length} 条` : ''}`;
      w.who.textContent = whoText; w.hours.textContent = hoursText;
      w.labelW = textWidth(whoText, 11, 550, SANS) + 5 + textWidth(hoursText, 9.5, 400, MONO);
    }
    // Words: a new question or a new zone cross-fades; the same question only updates its numbers.
    const key = `${T.zone}|${T.row.path?.key || ''}`;
    el.crossfade = !fresh && key !== el.labelKey && !back;
    if (el.crossfade) { el.oldLabel.innerHTML = el.label.innerHTML; } else el.oldLabel.innerHTML = '';
    el.labelKey = key; el.answeredKey = '';
    const voice = T.zone === 'grey' ? T.row.voices[0] : null;
    el.voiceData = voice;
    el.vname.textContent = voice ? `${voice.who} · ${voice.where} · ${ago(at(k) - voice.latest)}前` : '';
    el.g.classList.toggle('is-grey', T.zone === 'grey');
  }
  prevSpineEnd = layout ? spineNow : 32;
  prevGreyTop = layout ? greyTopNow : L.greyTop;
  layout = L;
  cutAt = clock; cutBack = back;
  const moreWords = L.more ? `另有 ${L.more} 件此刻没有登记问题，也没有人按这条规则开过口` : '';
  more.y0 = more.y ?? L.moreY; more.y1 = L.moreY; more.fresh = moreWords !== moreText.textContent && !back;
  moreText.textContent = moreWords;
}
let spineNow = 32, greyTopNow = 0, prevK = -1, numberK = -1;
const more = { y: null, y0: 0, y1: 0, fresh: false };

// ---------- the player: one clock for the story, ▶ and the beat transitions (as 回应时序) ----------
const player = { mode: 'still', track: null, wall0: 0, held: false, heldAt: 0, heldTotal: 0, freeze: null, stopping: false, tau: 0, t: at(page.index), k: -1, moving: false };
function startTrack(track, mode) {
  player.track = track; player.mode = mode; player.stopping = false;
  player.wall0 = wall(); player.heldTotal = 0;
  if (player.held) player.heldAt = player.wall0;
}
const trackTime = () => ((player.held ? player.heldAt : wall()) - player.wall0 - player.heldTotal) / SLOW;
function lastAtOrBefore(t, lo, hi) { let k = lo; for (let i = lo; i <= hi; i += 1) if (at(i) <= t + 1) k = i; return k; }
function evalTrack(tr, tau) {
  let t = tr.t0, k = tr.k0, moving = false;
  for (const s of tr.segs) {
    if (tau < s.s) break;
    const back = s.kTo < s.kFrom || (s.kTo === s.kFrom && s.tb < s.ta);
    if (tau < s.e) {
      t = lerp(s.ta, s.tb, s.ease((tau - s.s) / (s.e - s.s)));
      k = back ? s.kTo : lastAtOrBefore(t, s.kFrom, Math.max(s.kFrom, s.kTo - 1));
      moving = true;
      break;
    }
    t = s.tb;
    k = back || tau >= s.e + (s.cutDelay || 0) ? s.kTo : Math.max(s.kFrom, s.kTo - 1);
  }
  return { t, k, moving };
}
const move = (s, e, kFrom, kTo, ease = easeOut, ta = at(kFrom), tb = at(kTo)) => ({ s, e, ta, tb, kFrom, kTo, ease });
function navigate(target) {
  const n = Math.abs(target - player.k);
  const dur = reducedMotion() || (target === player.k && player.t === at(target)) ? 0 : n <= 1 ? BEAT.step : Math.min(BEAT.jumpMax, BEAT.step + 0.04 * n);
  startTrack({ t0: player.t, k0: player.k, segs: [move(0, dur, player.k, target, easeOut, player.t)], T: dur }, 'step');
}
function playTrack() {
  const segs = [];
  let tau = 0, k = player.k, t = player.t;
  if (k >= last) { segs.push(move(0, 0.5, k, 0, easeOut, t)); tau = 0.7; k = 0; t = at(0); }
  for (; k < last; k += 1) {
    const dur = reducedMotion() ? 0 : clamp(BEAT.play * (at(k + 1) - t) / (12 * HOUR), 0.1, 2.0);
    segs.push(move(tau, tau + dur, k, k + 1, easeOut, t));
    tau += dur + BEAT.hold; t = at(k + 1);
  }
  return { t0: player.t, k0: player.k, segs, T: tau };
}
function togglePlay() {
  if (player.mode === 'play' && !player.stopping) { stopPlay(); return; }
  if (story.on) endStory();
  ix.reset();
  startTrack(playTrack(), 'play');
  page.root.classList.add('is-playing');
}
function stopPlay() {
  page.root.classList.remove('is-playing');
  if (player.mode !== 'play' || !player.track) return;
  const tau = trackTime(), segs = player.track.segs, n = segs.findIndex(s => tau < s.e);
  if (n < 0) { player.track.T = tau; } else { player.track.segs = segs.slice(0, n + 1); player.track.T = segs[n].e; }
  player.stopping = true;
}

// ---------- the story: 谁在等 / 你开口 / 一串人松开 (chain-motion.md 第 3 节) ----------
const story = { on: false, cue: null, plan: null };
const plan = (() => {
  if (!releaseRound) return null;
  const kA = releaseRound.k, kB = kA + 1;
  const open = new Set(chains[kA].rows.map(r => r.path.key)), closing = new Set(chains[kB].closed.map(c => c.key));
  // Your answers in the round to questions open at its start; those that close it first, at most three.
  const answers = responses.filter(r => r.path && open.has(r.path) && r.at > at(kA) && r.at <= at(kB))
    .sort((a, b) => Number(closing.has(b.path)) - Number(closing.has(a.path)) || a.at - b.at).slice(0, 3).sort((a, b) => a.at - b.at);
  return { kA, kB, answers, closing };
})();
const tellMode = (() => {
  if (window.top !== window || params.has('frame') || params.get('mode') === 'play' || !plan) return false;
  if (params.has('at')) return true;
  try { if (document.referrer && new URL(document.referrer).pathname !== location.pathname) return false; } catch { return false; }
  return true;
})();
function storyTrack() {
  const { kA, kB, answers } = plan, cue = { answers: [] };
  const n = chains[kA].rows.length;
  // Beat 1: 0.4 s still, the spine grows 0.5 s, then a row every 0.45 s, each reaching out 0.5 s.
  cue.spine = 0.4; cue.rows = 0.9; cue.step = 0.45;
  cue.built = cue.rows + cue.step * Math.max(0, n - 1) + 0.5;
  // Hold 1.4 s once the last row has landed (long enough to read who hangs on more than one), then time walks.
  let tau = cue.built + 1.4, t = at(kA);
  cue.walk = tau;
  // Beat 2: walk to each of your answers and hold 0.9 s there; the people stay.
  const segs = [];
  for (const r of answers) {
    const dur = clamp(0.4 + 1.2 * (r.at - t) / (12 * HOUR), 0.35, 1.6);
    segs.push(move(tau, tau + dur, kA, kA, easeInOut, t, r.at));
    tau += dur; t = r.at;
    cue.answers.push({ tau, r });
    tau += 0.9;
  }
  // Beat 3: on to the next round; the rest dims 0.3 s before the cut; the cut runs 1.5 times slower; still 2 s.
  const dur = clamp(0.4 + 1.2 * (at(kB) - t) / (12 * HOUR), 0.35, 1.4);
  segs.push({ ...move(tau, tau + dur, kA, kB, easeInOut, t, at(kB)), cutDelay: 0.3 });
  cue.dark = tau + dur; cue.cut = cue.dark + 0.3;
  cue.settle = cue.cut + CUT.total * STORY_SLOW;
  cue.end = cue.settle + 2.0;
  return { t0: at(kA), k0: kA, segs, T: cue.end, cue };
}
function tell() {
  if (!plan) return;
  ix.reset(); drawer.close();
  page.root.classList.remove('is-playing');
  if (reducedMotion()) { hold(plan.kB); return; }
  const tr = storyTrack();
  story.on = true; story.cue = tr.cue;
  // The story's round, laid out and at rest (beat 1 reveals it through reveal(), not through the rows' own fade), so a
  // still frozen past the cut (?at=) starts the cut from where a live telling would.
  player.k = -1; player.t = at(plan.kA);
  commit(plan.kA); settleRows();
  startTrack(tr, 'story');
  if (page.index !== plan.kA) page.goFrame(plan.kA, { from: 'play' });
  page.root.classList.add('is-telling');
}
/** Every row and person straight at its target, as if the last cut had long finished. */
function settleRows() {
  for (const [id, el] of rowEls) {
    if (el.leaving) { el.g.remove(); rowEls.delete(id); continue; }
    el.y = el.y0 = el.y1; el.z = el.z0 = el.z1; el.alpha = el.a0 = 1; el.crossfade = false; el.oldLabel.innerHTML = '';
    for (const [key, w] of el.waiters) {
      if (w.state === 'leave') { w.g.remove(); el.waiters.delete(key); continue; }
      w.dy = w.dy0 = w.dy1; w.state = 'stay';
    }
  }
  spineNow = prevSpineEnd = layout.spineEnd; greyTopNow = layout.greyTop; prevGreyTop = layout.greyTop;
  more.y = more.y0 = more.y1; more.fresh = false;
  cutAt = -1e9; drawnKey = '';
}
function endStory() {
  if (!story.on) return;
  story.on = false;
  if (ix.s.presented) ix.reset();
  page.root.classList.remove('is-telling');
  drawnKey = '';
}
function skipStory() { const end = plan.kB; endStory(); hold(end); cutAt = -1e9; }
function hold(i) {
  player.track = null; player.mode = 'still'; player.freeze = null;
  player.t = at(i);
  if (player.k !== i) commit(i);
  if (page.index !== i) page.goFrame(i, { from: 'play' });
}
/** Seconds since the last cut, on the story's clock while it tells (slowed), else on the page's own. */
function cutAge() {
  if (story.on && story.cue && player.tau >= story.cue.cut) return (player.tau - story.cue.cut) / STORY_SLOW;
  if (story.on) return 99;
  return clock - cutAt;
}
/** Beat 1: how far row j (in layout order) has reached out; 1 outside the story. */
function reveal(j) {
  if (!story.on || !story.cue || player.k !== plan.kA || player.tau >= story.cue.built + 0.2) return 1;
  return clamp((player.tau - (story.cue.rows + story.cue.step * j)) / 0.5);
}
const spineReveal = () => (story.on && story.cue && player.k === plan.kA && player.tau < story.cue.rows ? clamp((player.tau - story.cue.spine) / 0.5) : 1);

// ---------- one frame ----------
function commit(k) {
  const back = k < player.k && player.k >= 0;
  prevN = player.k >= 0 ? chains[player.k].people.size : 0;
  prevK = player.k;
  player.k = k;
  cutTo(k, back || reducedMotion());
  if ((player.mode === 'story' || player.mode === 'play') && page.index !== k) page.goFrame(k, { from: 'play' });
}
let X = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
let lastWall = 0, drawnKey = '';
const perf = { on: params.has('perf'), times: [], work: [] };
function loop(ms) {
  const w = ms / 1000, dt = lastWall ? Math.min(0.1, w - lastWall) : 1 / 60;
  if (perf.on && lastWall) perf.times.push(w - lastWall);
  lastWall = w;
  if (G) {
    let s = { t: player.t, k: player.k, moving: false };
    if (player.track) {
      const tau = player.freeze ?? trackTime();
      player.tau = tau;
      s = evalTrack(player.track, tau);
      if (tau >= player.track.T && player.freeze == null) {
        const mode = player.mode;
        player.track = null; player.mode = 'still';
        if (mode === 'play') page.root.classList.remove('is-playing');
        if (mode === 'story') { story.on = false; page.root.classList.remove('is-telling'); drawnKey = ''; }
      }
    }
    if (s.k !== player.k) commit(s.k);
    player.t = s.t; player.moving = s.moving && !player.held;
    if (!player.held) clock += dt;
    X = ix.frame();
    paint();
    ix.paint();
    paintPanel();
    paintHeader();
    ix.sync(`${player.k}`, proxyItems);
  }
  if (perf.on) perf.work.push(performance.now() - ms);
  requestAnimationFrame(loop);
}

// ---------- painting ----------
const itemOfId = id => (id?.startsWith('i:') ? id.slice(2) : null);
const personOfId = id => (id?.startsWith('w:') ? id.slice(2) : null);
let heroShown = 0, linkKey = '';
function storyDepth() {
  if (!story.on || !story.cue) return 0;
  const c = story.cue, tau = player.tau;
  if (tau < c.dark) return 0;
  if (tau < c.cut) return 0.3 * clamp((tau - c.dark) / 0.3);
  return tau < c.settle + 1.0 ? 0.3 : 0.3 * (1 - clamp((tau - c.settle - 1.0) / 0.4));
}
function paint() {
  const t = player.t, k = player.k, c = chains[k];
  const age = cutAge(), rm = reducedMotion();
  const ph = (a0, a1) => (rm || cutBack ? 1 : clamp((age - a0) / (a1 - a0)));
  const detach = rm || cutBack ? 1 : clamp(age / CUT.detach);
  const moveP = rm ? 1 : cutBack ? clamp(age / 0.3) : easeInOut(ph(CUT.move0, CUT.move1));
  const enterP = ph(CUT.enter0, CUT.enter1), labelP = ph(CUT.label0, CUT.label1), landP = ph(CUT.land0, CUT.land1);
  const storyOn = story.on && story.cue;
  const key = `${t}|${k}|${age < CUT.total + 0.1 ? age.toFixed(3) : 'done'}|${X.dim.toFixed(3)}|${X.pop.toFixed(3)}|${X.focus}|${X.popId}|${storyOn ? player.tau.toFixed(3) : ''}`;
  if (key === drawnKey) return;
  drawnKey = key;
  const { SX, x, knotEnd } = G;
  // Focus: a row, or a person (her rows); the story's third beat keeps the closing rows bright.
  let depth = 0, focusRows = null, focusPerson = null;
  if (X.dim > 0.001 && X.focus) {
    depth = 0.3 * X.dim;
    const it = itemOfId(X.focus), who = personOfId(X.focus);
    if (it) focusRows = new Set([it]);
    if (who) { focusPerson = who; focusRows = new Set((c.people.get(who)?.rows || []).map(r => r.id)); }
  } else if (storyOn && player.tau >= story.cue.dark) {
    depth = storyDepth();
    focusRows = new Set([...plan.closing].map(key => askPaths.find(p => p.key === key)?.item));
  }
  const popRow = X.popId && X.pop > 0.001 ? itemOfId(X.popId) : null, popWho = X.popId && X.pop > 0.001 ? personOfId(X.popId) : null;
  // The spine follows the rows; the grey head follows the first grey row.
  const sr = spineReveal();
  spineNow = lerp(prevSpineEnd, layout.spineEnd, moveP);
  greyTopNow = lerp(prevGreyTop ?? layout.greyTop, layout.greyTop, moveP);
  setA(spine, 'y2', lerp(32, spineNow, easeOut(sr)));
  spine.style.opacity = storyOn && player.tau < story.cue.spine ? '0' : '';
  greyHead.setAttribute('transform', `translate(0,${greyTopNow.toFixed(1)})`);
  setOp(greyHead, (layout.grey ? 1 : 0) * (storyOn && player.k === plan.kA && player.tau < story.cue.built ? clamp((player.tau - story.cue.built + 0.5) / 0.5) : 1));
  more.y = lerp(more.y0, more.y1, moveP);
  setA(moreText, 'y', more.y);
  setOp(moreText, more.fresh ? labelP : 1);
  let j = 0;
  const order = [...layout.rows.keys()];
  for (const [id, el] of rowEls) {
    const T = layout.rows.get(id);
    if (el.leaving) {
      el.alpha = lerp(el.a0, 0, detach);
      if (age >= CUT.total || rm || cutBack) { el.g.remove(); rowEls.delete(id); continue; }
    } else el.alpha = lerp(el.a0, 1, el.a0 < 1 ? enterP : 1);
    el.y = lerp(el.y0, el.y1, moveP);
    el.z = lerp(el.z0, el.z1, moveP);
    const spineRow = T && T.zone === 'spine';
    const rv = spineRow ? reveal(order.indexOf(id)) : storyOn && player.k === plan.kA && player.tau < story.cue.built ? 0 : 1;
    const focus = !focusRows || focusRows.has(id) ? 1 : 1 - depth;
    const pop = popRow === id ? IX.pop * X.pop : 0;
    el.g.setAttribute('transform', `translate(0,${(el.y - pop).toFixed(2)})`);
    const crossing = !el.leaving && Math.abs(el.z1 - el.z0) > 0.5;
    const travel = crossing ? 1 - 0.6 * Math.sin(Math.PI * clamp(moveP)) : 1;
    setOp(el.g, el.alpha * focus * travel * (spineRow ? 1 : rv));
    // The knot: a hollow vermilion ring on the spine; filled once you answered (the people stay until the next 整理);
    // a small grey ring off the spine.
    const answered = spineRow ? answersOf(T.row.path.key, t)[0] || null : null;
    const knotScale = spineRow ? easeOutBack(clamp(rv * 3)) : 1;
    setOp(el.knot, (1 - el.z) * clamp(knotScale));
    setA(el.knot, 'cx', SX); setA(el.knot, 'r', 7 * Math.max(0.01, knotScale));
    el.knot.classList.toggle('is-answered', Boolean(answered) && el.z < 0.5);
    setOp(el.gknot, el.z); setA(el.gknot, 'cx', SX);
    // Words.
    const answeredKey = answered ? answered.id : '';
    if (T && (el.answeredKey !== answeredKey || el.drawnK !== k || el.drawnW !== G.W)) {
      el.answeredKey = answeredKey; el.drawnK = k; el.drawnW = G.W;
      el.label.innerHTML = labelHTML(T, k, answered);
    }
    setOp(el.label, (el.crossfade ? (crossing ? landP : labelP) : 1) * clamp(rv * 2));
    setOp(el.oldLabel, el.crossfade ? 1 - (rm || cutBack ? 1 : clamp((age - 0.1) / 0.3)) : 0);
    // People: dots at their wait on the log axis, lines curving into the knot.
    let left = SX;
    for (const [wk, w] of el.waiters) {
      if (w.state === 'leave' && (age >= CUT.total || rm || cutBack)) { w.g.remove(); el.waiters.delete(wk); continue; }
      w.dy = lerp(w.dy0, w.dy1, moveP);
      const target = x((t - (w.data?.since ?? t)) / HOUR);
      let dx = target, endX = knotEnd, endY = 0, a = 1;
      if (w.state === 'enter') { const p = Math.min(easeOut(enterP), easeOut(rv)); dx = lerp(knotEnd, target, p); a = clamp((p - 0.6) / 0.4); }
      else if (w.state === 'stay') { dx = target; a = 1; if (rv < 1) { const p = easeOut(rv); dx = lerp(knotEnd, target, p); a = clamp((p - 0.6) / 0.4); } }
      else { const p = easeInOut(detach); endX = lerp(knotEnd, dx, p); endY = lerp(0, w.dy, p); a = 1 - clamp((age - CUT.detach * 0.5) / (CUT.detach * 1.2)); }
      const personPop = popWho === wk ? IX.pop * X.pop : 0;
      dx -= personPop;
      const mid = (dx + endX) / 2;
      setA(w.line, 'd', `M${dx.toFixed(1)} ${w.dy.toFixed(1)} C${mid.toFixed(1)} ${w.dy.toFixed(1)} ${mid.toFixed(1)} ${endY.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`);
      setA(w.dot, 'cx', dx); setA(w.dot, 'cy', w.dy); setA(w.hit, 'cx', dx); setA(w.hit, 'cy', w.dy);
      // Name and wait left of the dot; a dot too far left for that carries them above its line instead.
      const leftOk = dx - 8 - w.labelW >= 2;
      setA(w.name, 'x', leftOk ? dx - 8 : dx + 6); setA(w.name, 'y', leftOk ? w.dy + 4 : w.dy - 6);
      setA(w.name, 'text-anchor', leftOk ? 'end' : 'start');
      w.g.classList.toggle('is-leaving', w.state === 'leave');
      w.g.classList.toggle('is-hot', focusPerson === wk);
      setOp(w.line, w.state === 'leave' ? a : (w.state === 'enter' || rv < 1) ? Math.max(a, clamp((Math.min(enterP, rv) - 0.05) * 3)) : 1);
      setOp(w.dot, w.state === 'leave' ? a : (w.state === 'enter' || rv < 1) ? clamp(Math.min(enterP, rv) * 3) : 1);
      setOp(w.name, a);
      if (w.state !== 'leave') left = Math.min(left, dx);
      w.x = dx; w.xr = dx + personPop;
    }
    // The newest voice on a row that does not pass through you.
    if (el.voiceData) {
      const vx = x((t - el.voiceData.latest) / HOUR);
      setA(el.vdot, 'cx', vx); setA(el.vname, 'x', vx - 7); setA(el.vname, 'y', 4);
      setA(el.vline, 'd', `M${vx.toFixed(1)} 0 H${(SX - 4).toFixed(1)}`);
      setOp(el.voice, el.z * (crossing ? landP : 1));
      left = Math.min(left, vx);
    } else setOp(el.voice, 0);
    const h = el.h;
    setA(el.hit, 'x', Math.max(0, left - 14)); setA(el.hit, 'y', -h / 2); setA(el.hit, 'width', G.W - Math.max(0, left - 14)); setA(el.hit, 'height', h);
    el.left = left;
    j += 1;
  }
  // A person on several rows: a thin ink line through her dots while she is hovered or open, and in beat 1 as she lands again.
  let who = focusPerson && X.dim > 0.05 ? focusPerson : null, linkAlpha = X.dim;
  if (!who && storyOn && player.k === plan.kA) {
    for (const p of c.people.values()) {
      if (p.rows.length < 2) continue;
      const idx = p.rows.map(r => order.indexOf(r.id)).sort((a, b) => a - b);
      for (const jj of idx.slice(1)) {
        const land = story.cue.rows + story.cue.step * jj + 0.5, since = player.tau - land;
        if (since >= 0 && since < 1.5) { who = p.key; linkAlpha = since < 0.2 ? since / 0.2 : since > 1.2 ? (1.5 - since) / 0.3 : 1; }
      }
    }
  }
  if (who) {
    const pts = [];
    for (const r of c.people.get(who)?.rows || []) { const el = rowEls.get(r.id), w = el?.waiters.get(who); if (w && w.state !== 'leave') pts.push({ x: w.x, y: el.y + w.dy }); }
    pts.sort((a, b) => a.y - b.y);
    const d = pts.length > 1 ? `M${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}` : '';
    if (d !== linkKey) { linkKey = d; linkPath.setAttribute('d', d); }
    setOp(linkPath, linkAlpha);
  } else { if (linkKey) { linkKey = ''; linkPath.setAttribute('d', ''); } }
  // The hero number: person by person as beat 1 lands them; otherwise it turns 0.4 s after the cut.
  let n = c.people.size;
  if (storyOn && player.k === plan.kA && player.tau < story.cue.built + 0.2) {
    const landed = new Set();
    order.forEach((id, jj) => { if (reveal(jj) >= 1) for (const w of layout.rows.get(id).row.waiters || []) landed.add(w.key); });
    n = landed.size;
  } else if (!rm && !cutBack && age < CUT.number) n = prevN;
  heroShown = n;
  numberK = !rm && !cutBack && age < CUT.number && prevK >= 0 && !(storyOn && player.k === plan.kA) ? prevK : k;
  drawConcept(t, depth, moveP);
}

// ---------- the concept layer: the rug, one grey tick an input, on the same log axis ----------
const born = new Map();
function drawConcept(t, depth, moveP) {
  ctx.clearRect(0, 0, G.W, G.H);
  if (reducedMotion()) return;
  const alpha = 0.3 * (1 - 0.6 * X.dim) * (1 - depth);
  ctx.fillStyle = 'rgba(31,45,38,1)';
  const k = player.k;
  for (const [id, el] of rowEls) {
    const T = layout.rows.get(id);
    if (!T || T.zone !== 'spine' || el.leaving) continue;
    const rv = reveal([...layout.rows.keys()].indexOf(id));
    if (rv <= 0) continue;
    const y = el.y + el.h / 2 - 8;
    for (const e of T.row.rug) {
      const te = tOf(e);
      if (te > t) continue;
      let a = alpha * el.alpha * rv;
      if (te > at(k)) { if (!born.has(e.id)) born.set(e.id, clock); a *= clamp((clock - born.get(e.id)) / 0.22); }
      ctx.globalAlpha = a;
      ctx.fillRect(G.x((t - te) / HOUR) - 0.5, y, 1, 5);
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- the side column: who is waiting now, or 这一件 ----------
function peopleList(c) { return [...c.people.values()].sort((a, b) => a.since - b.since); }
function overviewHTML(k, n) {
  const c = chains[k], now = at(k), frame = frames[k];
  const list = peopleList(c), most = list.slice().sort((a, b) => b.rows.length - a.rows.length || a.since - b.since)[0];
  const lonely = c.rows.filter(r => !r.waiters.length).length;
  const longest = list[0];
  const longestRow = longest && c.rows.find(r => r.id === longest.rows.slice().sort((a, b) => a.since - b.since)[0].id);
  const freed = c.closed.filter(x => x.freed.length || x.carried.length || x.how === 'answered');
  return `<section class="ch-now">
      <div class="ch-hero"><b>${n}</b><span>人在等你</span></div>
      <p class="ch-hero-sub">挂在 ${c.rows.length} 个开着的问题上${lonely ? `；${lonely} 个问题没有人开口` : ''}</p>
      ${most && most.rows.length > 1 ? `<p class="ch-hero-line" data-id="w:${esc(most.key)}"><b>${esc(most.who)}</b> 一个人挂在 ${most.rows.length} 件事上</p>` : ''}
      ${longest ? `<p class="ch-hero-line" data-id="w:${esc(longest.key)}">等得最久：<b>${esc(longest.who)}</b>，${esc(ago(now - longest.since))}（${esc(longestRow ? qShort(longestRow.path) : '')}）</p>` : ''}
    </section>
    ${freed.length ? `<section class="ch-freed"><h3>这一轮放走的 <small>${frame.id}</small></h3><ul>${freed.map(x => `<li data-id="${x.active && (c.rows.some(r => r.id === x.item) || c.grey.some(r => r.id === x.item)) ? `i:${esc(x.item)}` : ''}">
        <b class="${x.how === 'answered' ? 'is-you' : ''}">${x.how === 'answered' ? '✓ 你答了' : esc(HOW_TAG[x.how])}</b> ${esc(qShort(x.path))}
        <small>${x.answer ? `${esc(actionSentence(x.answer))} · ${esc(dayTime(x.answer.event.at))}` : ''}</small>
        <small>${x.freed.length ? `放走 ${x.freed.map(w => esc(w.who)).join('、')}` : '没有放走人'}${x.carried.length ? `；${x.carried.map(w => esc(w.who)).join('、')} 还挂在下一问上` : ''}${x.elsewhere.length ? `；${x.elsewhere.map(w => esc(w.who)).join('、')} 还挂在别的事上` : ''}</small></li>`).join('')}</ul></section>` : ''}
    <section class="ch-people"><h3>等你的人 <small>按等了多久</small></h3>
      ${list.length ? `<ul>${list.map(p => `<li data-id="w:${esc(p.key)}"><span class="ch-p-who">${esc(p.who)}<small>${esc(p.where)}</small></span><span class="ch-p-n">${esc(ago(now - p.since))}${p.rows.length > 1 ? ` · ${p.rows.length} 件` : ''}</span></li>`).join('')}</ul>` : '<p class="ch-muted">此刻没有人在等你。</p>'}</section>
    <section class="ch-frame"><h3>这一帧 · ${esc(frame.id)}</h3><p class="ch-frame-title">${esc(frame.title)}</p>${frame.narrative ? `<p class="ch-narr">${esc(frame.narrative)}</p>` : ''}
      <p class="ch-frame-n">开着 ${c.rows.length} 个问题 · 关上 ${c.closed.length} 个 · 收到输入 ${frame.events.length} 条</p></section>
    <details class="ch-rule"><summary>“等你的人”怎样算出来</summary>
      <p>开着的问题所在那件事这一版的依据里，去掉你自己、机器（bot 与群发）、公开资料、家庭群里通讯录外的人与问答站、论坛上的陌生人，剩下的作者一人算一个；等了多久从他在依据里最早的那条算起。</p>
      <p>推不出来的：转述的等待（你说“妈妈问我去不去”）、机构的群发期限、依据里没有的人；旁证里的人也会被算进来。见打磨记录 polish/chain-motion.md 第 2 节。</p></details>`;
}
function rowOneHTML(f) {
  const k = f.i, now = at(k), r = f.row;
  if (f.kind === 'grey') {
    const last = askPaths.filter(p => p.item === r.id && p.from <= k).sort((a, b) => b.from - a.from)[0];
    const s = last ? pathStatus(last, k) : null;
    return `<section class="ch-one"><h2>这一件 <small>${esc(groupWord(r.id))}${groupWord(r.id) ? ' · ' : ''}此刻没有问你</small></h2>
      <p class="ch-one-q">${esc(r.item.title)}</p><p class="ch-one-item">${r.item.share} 份</p>
      <div class="ch-hero is-small"><b>0</b><span>人在等你：此刻不经过你</span></div>
      <section><h3>最近开口的人</h3><ul class="ch-ws">${r.voices.map(v => `<li><b>${esc(v.who)}</b> · ${esc(v.where)}<small>最近 ${esc(ago(now - v.latest))}前 · 依据里 ${v.inputs.length} 条</small></li>`).join('')}</ul></section>
      ${last && s?.state === 'closed' ? `<section><h3>上一问 <small>${esc(CLOSE_WORDS[s.how])} · ${esc(frames[last.to].id)}</small></h3><p class="ch-muted">${esc(qShort(last))}</p>${answersOf(last.key, last.closed)[0] ? `<p class="ch-said-line">${esc(actionSentence(answersOf(last.key, last.closed)[0]))}</p>` : ''}</section>` : ''}
      <p class="ch-links"><button type="button" class="ch-dossier" data-ch-dossier="${esc(r.id)}">全部记录 →</button></p></section>`;
  }
  const p = r.path, moves = movesOn(r.id, p.opened, now), answered = moves.filter(x => x.path === p.key).length;
  const chips = (p.ask.actions || []).map(a => `<span class="lv-chip${a.recommended ? ' is-rec' : ''}">${esc(a.label)}${a.recommended ? ' · 推荐' : ''}</span>`).join('');
  const others = w => chains[k].people.get(w.key)?.rows.filter(x => x.id !== r.id).length || 0;
  return `<section class="ch-one"><h2>这一件 <small>${esc(groupWord(r.id))}${groupWord(r.id) ? ' · ' : ''}${esc(EXPECT_WORDS[p.ask.expects] || '')}</small></h2>
    <p class="ch-one-item">${esc(r.item.title)} · ${r.item.share} 份</p>
    <p class="ch-one-q">${esc(qShort(p))}</p>${p.ask.short && p.ask.short !== p.ask.prompt ? `<p class="ch-one-prompt">${esc(p.ask.prompt)}</p>` : ''}
    <div class="ch-hero is-small"><b>${r.waiters.length}</b><span>人在等这一问${r.waiters.length ? '' : `：${esc(aloneWords(now - p.opened))}`}</span></div>
    ${r.waiters.length ? `<ul class="ch-ws">${r.waiters.map(w => `<li data-id="w:${esc(w.key)}"><b>${esc(w.who)}</b> · ${esc(w.where)} · 等了 ${esc(ago(now - w.since))}<small>${w.inputs.length > 1 ? `依据里 ${w.inputs.length} 条，最近 ${esc(ago(now - w.latest))}前` : '依据里 1 条'}${others(w) ? ` · 还挂在 ${others(w)} 件别的事上` : ''}</small></li>`).join('')}</ul>` : ''}
    <section><h3>答了之后 <small>${esc(dueWords(r.due, now) || '没有期限')}</small></h3>${chips ? `<div class="lv-chips">${chips}</div>` : ''}${p.ask.subject?.label ? `<p class="ch-muted">批准之后：${esc(p.ask.subject.label)}</p>` : ''}</section>
    <section><h3>你在这件事上 <small>动了 ${moves.length} 次，回答它 ${answered} 次</small></h3>${moves.length ? `<ol class="ch-moves">${moves.slice(-3).map(m => `<li class="${m.path === p.key ? 'is-answer' : ''}"><time>${esc(dayTime(m.event.at))}</time>${esc(actionSentence(m))}</li>`).join('')}</ol>` : '<p class="ch-muted">问题登记以来你还没在这件事上动过。</p>'}</section>
    <p class="ch-links"><a class="ch-go" href="${esc(linkD(k))}">去回答 →</a><button type="button" class="ch-dossier" data-ch-dossier="${esc(r.id)}">全部记录 →</button></p></section>`;
}
function personOneHTML(f) {
  const k = f.i, now = at(k), p = f.person;
  if (!p) return '<section class="ch-one"><p class="ch-muted">此刻不在等你。</p></section>';
  const c = chains[k];
  const inputs = c.rows.filter(r => p.rows.some(x => x.id === r.id)).flatMap(r => r.waiters.find(w => w.key === p.key)?.inputs || []);
  const uniq = [...new Map(inputs.map(e => [e.id, e])).values()].sort((a, b) => tOf(b) - tOf(a));
  return `<section class="ch-one"><h2>这一件 <small>等你的人 · ${esc(p.where)}</small></h2>
    <p class="ch-one-q">${esc(p.who)}</p>
    <div class="ch-hero is-small"><b>${p.rows.length}</b><span>件事挂着${p.rows.length > 1 ? '她/他' : ''}，最久 ${esc(ago(now - p.since))}</span></div>
    <ul class="ch-ws">${p.rows.map(x => { const r = c.rows.find(y => y.id === x.id); return `<li data-id="i:${esc(x.id)}"><b>${esc(qShort(r.path))}</b><small>等了 ${esc(ago(now - x.since))}${r.due != null ? ` · ${esc(dueWords(r.due, now))}` : ''}</small><a class="ch-go" href="${esc(linkD(k))}">去回答 →</a></li>`; }).join('')}</ul>
    <section><h3>依据里的话 <small>${uniq.length} 条，只写时刻与渠道</small></h3><ol class="ch-moves">${uniq.slice(0, 6).map(e => `<li><time>${esc(dayTime(e.at))}</time>${esc(placeOf(e).where)}</li>`).join('')}</ol></section></section>`;
}
let panelKey = '';
function paintPanel() {
  const k = player.k;
  const shownK = numberK >= 0 ? numberK : k;
  let key = `overview|${shownK}|${heroShown}`, html = null;
  if (X.detail && ix.view) { key = `one|${ix.view.id}|${k}`; html = () => (ix.view.kind === 'person' ? personOneHTML(ix.view) : rowOneHTML(ix.view)); }
  if (key === panelKey) return;
  panelKey = key;
  side.innerHTML = html ? html() : overviewHTML(shownK, heroShown);
  if (html) side.scrollTop = 0;
}
let headerKey = '';
function paintHeader() {
  const own = X.detail && ix.view && !ix.s.presented, k = own ? player.k : page.index;
  const key = own ? `one|${ix.view.id}|${k}` : `frame|${k}`;
  if (key === headerKey) return;
  headerKey = key;
  const frame = frames[k];
  if (own) { $date.textContent = `这一件 · ${frame.id} · ${dayTime(frame.at)}`; $title.textContent = ix.view.short; }
  else { $date.textContent = `${dayTime(frame.at)} · ${frame.id} · ${records[k].state.revision}`; $title.textContent = frame.title; }
}

// ---------- the cards (ix.mjs draws them; this page writes what is on them) ----------
function factsOf(id) {
  const k = Math.max(0, player.k), c = chains[k];
  if (id.startsWith('w:')) { const p = c.people.get(id.slice(2)) || null; return { i: k, id, kind: 'person', person: p, short: p ? p.who : id.slice(2) }; }
  const T = layout?.rows.get(id.slice(2)), row = T?.row || null;
  return { i: k, id, kind: row?.zone === 'grey' ? 'grey' : 'row', row, short: row?.path ? qShort(row.path) : row?.item?.title || id };
}
function peekCard(f) {
  const k = f.i, now = at(k);
  if (f.kind === 'person') {
    const p = f.person;
    if (!p) return '<div class="ix-q">此刻不在等你</div>';
    const c = chains[k];
    return `<div class="ix-k">等你的人 · ${esc(p.where)}</div><div class="ix-q">${esc(p.who)}</div>
      <div class="ix-d">挂在 ${p.rows.length} 件事上，最久 ${esc(ago(now - p.since))}</div>
      ${p.rows.map(x => `<div class="ix-d">· ${esc(qShort(c.rows.find(r => r.id === x.id).path))} · ${esc(ago(now - x.since))}</div>`).join('')}`;
  }
  const r = f.row;
  if (!r) return '<div class="ix-q">—</div>';
  if (f.kind === 'grey') {
    const v = r.voices[0];
    return `<div class="ix-k">不经过你 · ${r.item.share} 份</div><div class="ix-q">${esc(r.item.title)}</div>
      <div class="ix-d">此刻没有登记问题${r.closed ? `；这一轮${esc(HOW_TAG[r.closed.how])}` : ''}</div>
      ${v ? `<div class="ix-d">最近开口：${esc(v.who)}（${esc(v.where)}）${esc(ago(now - v.latest))}前</div>` : ''}`;
  }
  const p = r.path, moves = movesOn(r.id, p.opened, now), answered = moves.filter(x => x.path === p.key).length;
  const rug = r.rug.filter(e => tOf(e) <= now).length + r.inputs.size;
  return `<div class="ix-k">${esc(EXPECT_WORDS[p.ask.expects] || '')}${groupWord(r.id) ? ` · ${esc(groupWord(r.id))}` : ''}</div><div class="ix-q">${esc(qShort(p))}</div>
    <div class="ix-d">${r.waiters.length ? `${r.waiters.length} 人在等：${r.waiters.map(w => `${esc(w.who)} ${esc(ago(now - w.since))}`).join(' · ')}` : `没有人开口，${esc(aloneWords(now - p.opened))}`}</div>
    <div class="ix-d">${esc(dueWords(r.due, now) || '没有期限')} · ${esc(openWords(now - p.opened))}</div>
    <div class="ix-d">你在这件事上动了 ${moves.length} 次，回答它 ${answered} 次</div>
    <div class="ix-d">这件事上进来过 ${rug} 条输入</div>`;
}
function detailCard(f) {
  const k = f.i, now = at(k), head = `<div class="ix-d-k"><span>第 ${k} / ${last} 轮${f.kind === 'person' ? ' · 等你的人' : f.row && groupWord(f.row.id) ? ` · ${esc(groupWord(f.row.id))}` : ''}</span>
      <button type="button" data-x="close" aria-label="收回（Esc）" title="收回（Esc）">×</button></div>`;
  if (f.kind === 'person') {
    const p = f.person, c = chains[k];
    if (!p) return `${head}<div class="ix-d-t">此刻不在等你</div>`;
    const inputs = [...new Map(c.rows.filter(r => p.rows.some(x => x.id === r.id)).flatMap(r => r.waiters.find(w => w.key === p.key)?.inputs || []).map(e => [e.id, e])).values()].sort((a, b) => tOf(b) - tOf(a));
    return `${head}<div class="ix-d-t">${esc(p.who)}</div><div class="ix-d-s"><b>挂在 ${p.rows.length} 件事上</b> · 最久 ${esc(ago(now - p.since))} · ${esc(p.where)}</div>
      <section><h5>她/他在等的</h5>${p.rows.map(x => { const r = c.rows.find(y => y.id === x.id); return `<div class="ix-d-ask"><i></i><p>${esc(qShort(r.path))}</p><small>等了 ${esc(ago(now - x.since))}${r.due != null ? ` · ${esc(dueWords(r.due, now))}` : ''}</small><a href="${esc(linkD(k))}">去回答 →</a></div>`; }).join('')}</section>
      <section><h5>依据里的话<b>${inputs.length} 条</b></h5><ul class="ix-d-fb">${inputs.slice(0, 4).map(e => `<li><time>${esc(dayTime(e.at))}</time>${esc(placeOf(e).where)}</li>`).join('')}</ul></section>`;
  }
  const r = f.row;
  if (!r) return head;
  if (f.kind === 'grey') {
    const lastAsk = askPaths.filter(p => p.item === r.id && p.from <= k).sort((a, b) => b.from - a.from)[0], s = lastAsk && pathStatus(lastAsk, k);
    const ans = lastAsk && answersOf(lastAsk.key, lastAsk.closed ?? Infinity)[0];
    return `${head}<div class="ix-d-t">${esc(r.item.title)}</div><div class="ix-d-s"><b>此刻不经过你</b> · ${r.item.share} 份 · 没有登记问题</div>
      <section><h5>最近开口的人</h5><ul class="ix-d-fb">${r.voices.slice(0, 4).map(v => `<li><time>${esc(dayTime(v.latest))} · ${esc(v.where)}</time>${esc(v.who)}</li>`).join('') || '<li>没有人按这条规则开过口</li>'}</ul></section>
      ${lastAsk && s?.state === 'closed' ? `<section><h5>上一问怎样关上<b>${esc(CLOSE_WORDS[s.how])} · ${esc(frames[lastAsk.to].id)}</b></h5><p class="tm-d-prompt">${esc(qShort(lastAsk))}</p>${ans ? `<p class="ch-said-line">${esc(actionSentence(ans))} · ${esc(dayTime(ans.event.at))}</p>` : '<p class="ix-none">没有等到你的回答</p>'}</section>` : ''}
      <section class="ch-d-go"><button type="button" class="ch-dossier" data-ch-dossier="${esc(r.id)}">全部记录 →</button></section>`;
  }
  const p = r.path, moves = movesOn(r.id, p.opened, now), answered = moves.filter(x => x.path === p.key).length;
  const chips = (p.ask.actions || []).map(a => `<span class="lv-chip${a.recommended ? ' is-rec' : ''}">${esc(a.label)}${a.recommended ? ' · 推荐' : ''}</span>`).join('');
  const others = w => chains[k].people.get(w.key)?.rows.filter(x => x.id !== r.id).length || 0;
  return `${head}<div class="ix-d-t">${esc(qShort(p))}</div>
    <div class="ix-d-s"><b>${r.waiters.length} 人在等</b> · ${esc(openWords(now - p.opened))} · ${esc(dueWords(r.due, now) || '没有期限')}</div>
    <section><h5>问题</h5><p class="tm-d-prompt">${esc(p.ask.prompt)}</p>${chips ? `<div class="lv-chips">${chips}</div>` : ''}${p.ask.subject?.label ? `<p class="ix-none">批准之后：${esc(p.ask.subject.label)}</p>` : ''}</section>
    <section><h5>等你的人<b>${r.waiters.length ? `${r.waiters.length} 人` : '没有人开口'}</b></h5>${r.waiters.length ? `<ul class="ix-d-fb">${r.waiters.map(w => `<li><time>${esc(w.where)} · 等了 ${esc(ago(now - w.since))}${w.inputs.length > 1 ? ` · 最近 ${esc(ago(now - w.latest))}前` : ''}${others(w) ? ` · 还挂在 ${others(w)} 件别的事上` : ''}</time>${esc(w.who)}</li>`).join('')}</ul>` : `<p class="ix-none">${esc(aloneWords(now - p.opened))}</p>`}</section>
    <section><h5>你在这件事上<b>动了 ${moves.length} 次 · 回答它 ${answered} 次</b></h5>${moves.length ? `<ul class="ix-d-fb">${moves.slice(-3).map(m => `<li><time>${esc(dayTime(m.event.at))}${m.path === p.key ? ' · 回答了它' : ''}</time>${esc(actionSentence(m))}</li>`).join('')}</ul>` : '<p class="ix-none">还没有</p>'}</section>
    <section class="ch-d-go"><a class="ch-go" href="${esc(linkD(k))}">去回答 →</a><button type="button" class="ch-dossier" data-ch-dossier="${esc(r.id)}">全部记录 →</button></section>`;
}

// ---------- geometry for the interaction (stage = the page body: figure and side column) ----------
const stage = page.body;
let pointer = null;
stage.addEventListener('pointermove', event => { const box = stage.getBoundingClientRect(); pointer = { x: event.clientX - box.left, y: event.clientY - box.top }; }, { passive: true });
/** A row in stage coordinates: its band, its knot, the end of its words; a person: her dots. */
function geomOf(id) {
  if (!G || !layout) return null;
  const item = itemOfId(id);
  if (item) {
    const el = rowEls.get(item);
    if (!el || el.leaving) return null;
    const y = el.y + G.fy, half = el.h / 2;
    const words = el.label.getBBox ? el.label.getBBox() : null;
    return { x0: (el.left ?? G.SX) + G.fx, x1: G.fx + G.W, y, top: y - half, bottom: y + half, kx: G.SX + G.fx, ky: y, kr: 7,
      end: words && words.width ? G.fx + words.x + words.width : G.fx + G.RX + 120 };
  }
  const who = personOfId(id), c = chains[player.k];
  const pts = (c.people.get(who)?.rows || []).map(r => { const el = rowEls.get(r.id), w = el?.waiters.get(who); return w ? { x: (w.xr ?? w.x) + G.fx, y: el.y + w.dy + G.fy } : null; }).filter(Boolean);
  if (!pts.length) return null;
  const far = pts.slice().sort((a, b) => a.x - b.x)[0];
  return { x0: far.x, x1: Math.max(...pts.map(p => p.x)), y: far.y, top: Math.min(...pts.map(p => p.y)) - 8, bottom: Math.max(...pts.map(p => p.y)) + 8, px: far.x, py: far.y, pts, end: far.x };
}
const cardBounds = () => ({ x0: G.fx + 8, y0: G.fy + 8, x1: G.fx + G.W - 8, y1: G.fy + G.H - 8 });
function hitAt(sx, sy) {
  if (!G || !layout) return null;
  const x = sx - G.fx, y = sy - G.fy;
  for (const [id, el] of rowEls) {
    if (el.leaving) continue;
    for (const [key, w] of el.waiters) if (w.state !== 'leave' && Math.hypot(x - w.x, y - (el.y + w.dy)) <= 10) return `w:${key}`;
  }
  for (const [id, el] of rowEls) {
    if (el.leaving) continue;
    if (Math.abs(y - el.y) <= el.h / 2 && x >= (el.left ?? G.SX) - 14) return `i:${id}`;
  }
  return null;
}
const hasId = id => {
  if (!G || !id || !layout) return false;
  if (id.startsWith('i:')) { const el = rowEls.get(id.slice(2)); return Boolean(el && !el.leaving && layout.rows.has(id.slice(2))); }
  if (id.startsWith('w:')) return chains[player.k].people.has(id.slice(2));
  return false;
};
function named(name) {
  if (!name) return null;
  if (/^[iw]:/.test(name)) return hasId(name) ? name : null;
  const c = chains[player.k];
  const row = c.rows.find(r => r.id === name || qShort(r.path) === name || r.path.key === name) || c.grey.find(r => r.id === name || r.item.title === name);
  if (row) return `i:${row.id}`;
  const p = [...c.people.values()].find(x => x.key === name || x.who === name);
  return p ? `w:${p.key}` : null;
}
function peekPlace(id, w, h) {
  const g = geomOf(id), B = cardBounds();
  const at0 = pointer && pointer.y >= g.top - 6 && pointer.y <= g.bottom + 6 ? { x: clamp(pointer.x, B.x0, B.x1), y: pointer.y } : { x: g.kx ?? g.px, y: g.ky ?? g.py };
  return placeBeside({ at: at0, from: at0, facing: at0.x + 14 + w <= B.x1 ? 1 : -1, w, h, bounds: B, flush: true, gap: 14,
    avoid: [{ x0: B.x0, y0: g.top, x1: B.x1, y1: g.bottom }], pad: 2 });
}
// The detail, above or below what was clicked (whichever has room). A row's card sits right of the spine, its leader from
// the end of the row's words; a person's card sits by her own dots, its leader straight from the farthest one (popped 8 px
// outwards, to the left).
function detailPlace(id, el) {
  const g = geomOf(id), B = cardBounds(), w = 330, row = Boolean(itemOfId(id));
  el.style.width = `${w}px`;
  const top = g.top - (row ? IX.pop : 0), above = top - 10 - B.y0, below = B.y1 - (g.bottom + 10), up = above > below;
  const room = Math.max(180, up ? above : below);
  el.style.maxHeight = `${room}px`;
  const h = Math.min(el.offsetHeight, room);
  const x = row ? B.x1 - w : clamp(g.px - IX.pop - 24, B.x0, B.x1 - w), y = up ? top - 10 - h : g.bottom + 10;
  const ey = up ? y + h : y;
  if (!row) { const sx = g.px - IX.pop; return { x, y, w, h, path: [{ x: sx, y: g.py }, { x: clamp(sx, x + 14, x + w - 14), y: ey }] }; }
  const sx = Math.min(g.end + 6, B.x1 - 10), sy = g.y - IX.pop, lx = clamp(sx, x + 14, x + w - 14);
  return { x, y, w, h, path: [{ x: sx, y: sy }, { x: sx + (lx > sx ? 8 : -8), y: sy }, { x: lx, y: ey }] };
}

const ix = createIx({
  stage, facts: factsOf, index: () => player.k, has: hasId, hit: hitAt, named,
  pointOf: id => { const g = geomOf(id); return g ? (itemOfId(id) ? { x: g.kx, y: g.ky } : { x: g.px, y: g.py }) : null; },
  pause: () => { if (!player.held) { player.held = true; player.heldAt = wall(); } },
  resume: () => { if (player.held) { player.held = false; player.heldTotal += wall() - player.heldAt; } },
  paused: () => player.held,
  last, answerHref: f => linkD(f.i),
  peekPlace, detailPlace, peekHTML: peekCard, detailHTML: detailCard, skip: '.lv-drawer, .ch-links, .ch-rule',
  keysIn: stage, label: '等待链：Tab 逐行、逐人看概要，Enter 展开详情，Esc 收回',
});
const proxyItems = () => {
  const c = chains[player.k], now = at(player.k);
  return [
    ...c.rows.map(r => ({ id: `i:${r.id}`, label: `${qShort(r.path)} · ${r.waiters.length} 人在等` })),
    ...c.grey.map(r => ({ id: `i:${r.id}`, label: `不经过你 · ${r.item.title}` })),
    ...peopleList(c).map(p => ({ id: `w:${p.key}`, label: `${p.who} · 挂在 ${p.rows.length} 件事上 · 最久 ${ago(now - p.since)}` })),
  ];
};

// ---------- input ----------
function onFrame(index, previous, from) {
  if (!G) build();
  if (from === 'init') { init(index); return; }
  if (from === 'play') return;
  endStory(); stopPlay(); ix.reset();
  navigate(index);
}
function init(index) {
  if (tellMode) {
    if (reducedMotion()) { hold(plan.kB); return; }
    tell();
    if (params.has('at')) player.freeze = Math.max(0, Number(params.get('at')) || 0);
    page.goFrame(plan.kA, { from: 'play' });
    return;
  }
  player.t = at(index); commit(index); cutAt = -1e9;
  if (params.get('mode') === 'play') togglePlay();
}
function onKey(event) {
  if (event.key === 'Escape' && drawer.isOpen) { drawer.close(); event.stopImmediatePropagation(); return true; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const proxies = [...stage.querySelectorAll('.ix-sr button')];
    if (!proxies.length) return true;
    const n = proxies.indexOf(document.activeElement), d = event.key === 'ArrowDown' ? 1 : -1;
    proxies[n < 0 ? (d > 0 ? 0 : proxies.length - 1) : (n + d + proxies.length) % proxies.length].focus();
    return true;
  }
  return false;
}
// Any key skips the story to its end (and does nothing else); so does a click on nothing in particular.
addEventListener('keydown', event => {
  if (!story.on || event.metaKey || event.ctrlKey || event.altKey || ['Shift', 'Meta', 'Control', 'Alt', 'CapsLock'].includes(event.key)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  skipStory();
}, true);
figure.addEventListener('click', event => {
  if (story.on && !ix.s.hover && !ix.s.open) skipStory();
});
document.addEventListener('click', event => {
  if (event.target.closest('[data-ch-tell]')) { tell(); return; }
  const dossier = event.target.closest('[data-ch-dossier]');
  if (dossier) {
    if (ix.s.open) ix.close();
    drawer.open(dossierHTML(dossier.dataset.chDossier, player.k), dossier.dataset.chDossier);
  }
});
let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { const k = player.k; build(); player.k = -1; commit(k); cutAt = -1e9; ix.relayout(); }, 120);
});

build();
page.start();
requestAnimationFrame(loop);

window.foldChain = {
  player: { get index() { return page.index; }, get shown() { return player.k; }, get mode() { return player.mode; }, get t() { return player.t; }, get tau() { return player.tau; } },
  story: plan ? { from: frames[plan.kA].id, to: frames[plan.kB].id, answers: plan.answers.map(r => r.id) } : null,
  /** The story's beats in seconds (spine, rows, walk, each answer, dark, cut, settle, end). */
  cue: () => { if (!plan) return null; const c = story.cue || storyTrack().cue; return { ...c, answers: c.answers.map(a => a.tau) }; },
  /** Stand on frame i (no story, no transition); startPlay(i) plays on from i; startHero() tells the story again. */
  hold: i => { endStory(); stopPlay(); ix.reset(); hold(Math.max(0, Math.min(last, i))); cutAt = -1e9; },
  startPlay: i => { endStory(); ix.reset(); if (i != null) { hold(i); cutAt = -1e9; } if (player.mode !== 'play') togglePlay(); },
  startHero: () => tell(), skip: () => { if (story.on) skipStory(); },
  /** The story frozen at `seconds` (stills), or released (null). */
  seek: seconds => { if (!story.on) tell(); player.freeze = seconds == null ? null : Math.max(0, seconds); },
  perf: () => {
    const ts = perf.times.slice(1), avg = ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length);
    const p95 = list => [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.95)] || 0;
    const work = perf.work.slice(1);
    return { frames: ts.length, fps: +(1 / avg).toFixed(1), p95ms: +(p95(ts) * 1000).toFixed(1), maxMs: +(Math.max(0, ...ts) * 1000).toFixed(1),
      workMs: +(work.reduce((a, b) => a + b, 0) / Math.max(1, work.length)).toFixed(2), workP95ms: +p95(work).toFixed(2) };
  },
  resetPerf: () => { perf.on = true; perf.times = []; perf.work = []; },
  ...ix.hooks(),
  /** A row worth hovering this frame: the spine row with the most people, else the first grey one. */
  pick: () => {
    const c = chains[player.k];
    const row = c.rows.slice().sort((a, b) => b.waiters.length - a.waiters.length)[0] || c.grey[0];
    return row ? `i:${row.id}` : null;
  },
  /** A row's band and knot (a person's farthest dot) in viewport coordinates (scripts/check-ix.mjs aims 9 px past the knot). */
  geom: name => {
    const id = named(name), g = id && geomOf(id);
    if (!g) return null;
    const box = stage.getBoundingClientRect();
    return { x0: box.left + g.x0, x1: box.left + g.x1, y: box.top + g.y, kx: box.left + (g.kx ?? g.px), ky: box.top + (g.ky ?? g.py), kr: g.kr ?? 4 };
  },
  /** The rule's result at frame i, for checking the record (chain-motion.md 第 2 节). */
  chain: (i = player.k) => {
    const c = chains[i], now = at(i);
    return { frame: frames[i].id, people: c.people.size, rows: c.rows.map(r => ({ q: qShort(r.path), waiters: r.waiters.map(w => `${w.who} ${ago(now - w.since)}`), rug: r.rug.filter(e => tOf(e) <= now).length })),
      closed: c.closed.map(x => ({ q: qShort(x.path), how: x.how, freed: x.freed.map(w => w.who), carried: x.carried.map(w => w.who) })), grey: c.grey.map(r => r.item.title), more: c.more };
  },
};
globalThis.foldForm = { id: 'chain', goFrame: page.goFrame, get index() { return page.index; } };
