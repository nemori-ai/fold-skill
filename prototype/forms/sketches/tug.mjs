// 01 拔河（第四轮，完整版）：家里与工作在 64 份里此消彼长，以及你在来源处实际在哪边动手。
// 左边一根 64 份高的评估条：上白是工作，下黑是家里，中间斜线是留白，条顶写此刻的“家里 : 工作”（英雄数字）。
// 右边是两周的评估曲线：中线持平，墨面向下鼓起是家里领先、白面向上是工作领先；曲线下一排朱红短柱是你的回应，
// 向上是工作、向下是家里。朱红只给你本人的回应。口径、故事与交互见 polish/tug-motion.md。
//
// 一轮“拉”一下（tug-motion.md 第 3 节）：条上每一段从上一轮的位置滑到这一轮，曲线的头同时走到这一轮的点，落定时
// 数字一帧硬切，然后朱红柱从基线长出。概念层只有一样：换了边的格子被分界扫过时先灰一下（一格一份），画在叠在条上
// 的 canvas 里，落定后为零。
//   讲一遍：只在顶层直接打开、不带 ?frame=、也不是从别的页面链过来时演一次（composite 约 23 秒，停在 f26），
//     任意键或点一下跳过；工具栏「▶ 讲一遍」重演。带 ?frame=、画廊、合页与链来的一律静止在那一帧。
//   连播（空格）每轮 0.75 秒；←/→ 逐帧 0.5 秒；一次跳多帧时曲线一口气走过去；往回退直接切到那一轮。
// 交互接 motion/ix.mjs：条上的一段、曲线上的一轮、一根朱红柱各是“一件”。只读回放，帧号是本页常量，不改数据。
import {
  createStage, esc, scenario, frames, records, dayTime, shortOf, titleAt, askById, itemDetailHTML, kindWord, reduced,
  foldSentences, askLife, rootOf, responseSentence,
} from './stage.mjs';
import { dayOf, weekdayOf, monthDay, fitText, textWidth } from './kit.mjs';
import { createIx, IX } from '../motion/ix.mjs';
import { dueText, orderOf } from '../motion/dial-model.mjs';
import { withDataset, currentDataset } from '../../data/select.mjs';

const LAST = frames.length - 1;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeInOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
// Fast start, settles with an overshoot of about 3.7 % (the dial's curve).
const easeOutBack = k => { const u = clamp(k) - 1; return 1 + 2 * u ** 3 + u ** 2; };
const indexOfId = id => frames.findIndex(frame => frame.id === id);
const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
const timeOf = at => dayTime(at).split(' ').pop();

// ---------- sides: every root item is 工作 or 家里, fixed for the two weeks (tug-motion.md 第 2 节「口径」) ----------
// Each distinct source the item (any version, its children too) ever cited votes with its stream. The hand-written story
// has no stream: channel heads go into lanes as motion/dial-model.mjs groups them, and the person's own 用户消息 do not vote.
const eventIndex = new Map();
for (const frame of frames) for (const event of frame.events) eventIndex.set(event.id, event);
const hasStreams = frames.some(frame => frame.events.some(event => event.stream));
const CHANNEL_LANES = [
  ['work', /团队|客户|监控|部署|反馈|合作|招聘|供应商|财务/], ['family', /家人/],
  ['life', /物业|同楼|团购|快递|随手记|日历|定时/], ['subscription', /资讯|促销|官方/],
];
const channelLane = channel => CHANNEL_LANES.find(([, re]) => re.test(String(channel || '').split(' · ')[0]))?.[0] || null;
const LANE_WORD = { work: '工作流', family: '家庭流', life: '生活流', community: '社区流', subscription: '订阅' };
const SIDE_WORD = { work: '工作', home: '家里' };
const votes = new Map();
for (const record of records) for (const item of Object.values(record.snapshot.items)) for (const source of item.sources || []) {
  const event = source.ref?.startsWith('event:') ? eventIndex.get(source.ref.slice(6)) : null;
  const lane = hasStreams ? event?.stream || null : channelLane(event?.channel || source.channel);
  if (!lane) continue;
  const root = rootOf(item.id);
  if (!votes.has(root)) votes.set(root, new Map());
  votes.get(root).set(source.ref || `${source.channel}|${source.quote || ''}`, lane);
}
const tally = new Map(), sideMap = new Map();
for (const [root, refs] of votes) {
  const v = {};
  for (const lane of refs.values()) v[lane] = (v[lane] || 0) + 1;
  tally.set(root, v);
  sideMap.set(root, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0] === 'work' ? 'work' : 'home');
}
// An item with no source that votes would count as 家里 (none in either dataset).
const sideOf = id => sideMap.get(rootOf(id)) || 'home';
const whyText = id => {
  const v = tally.get(rootOf(id));
  if (!v) return '没有可投票的来源，记在家里';
  const n = Object.values(v).reduce((s, x) => s + x, 0), parts = Object.entries(v).sort((a, b) => b[1] - a[1]);
  return parts.length === 1 ? `引用的来源 ${n} 条全来自${LANE_WORD[parts[0][0]]}` : `引用的来源 ${n} 条：${parts.map(([lane, k]) => `${LANE_WORD[lane]} ${k}`).join('、')}`;
};

// ---------- rounds: shares on each side, your responses, what moved ----------
const rows = frames.map((frame, i) => {
  const items = records[i].state.root.items;
  const shares = new Map(items.map(item => [item.id, item.share]));
  let W = 0, H = 0;
  for (const item of items) if (sideOf(item.id) === 'work') W += item.share; else H += item.share;
  const resp = { work: [], home: [] };
  for (const event of frame.events) for (const link of event.feedback || []) resp[sideOf(link.target)].push({ event, link, item: rootOf(link.target), frame: i });
  return { i, shares, W, H, F: 64 - W - H, d: H - W, resp, annotations: frame.annotations || [] };
});
rows.forEach((r, i) => {
  const before = i ? rows[i - 1].shares : new Map();
  const moves = [];
  for (const id of new Set([...before.keys(), ...r.shares.keys()])) {
    const b = before.get(id) || 0, a = r.shares.get(id) || 0;
    if (a !== b) moves.push({ id, n: a - b, before: b, after: a, side: sideOf(id) });
  }
  moves.sort((x, y) => Math.abs(y.n) - Math.abs(x.n) || orderOf(x.id) - orderOf(y.id));
  r.moves = moves;
  r.swing = i ? r.d - rows[i - 1].d : 0;
  r.nw = r.resp.work.length; r.nh = r.resp.home.length;
});
// Every root item in a fixed order (first seen, then rank): work stacks from the top, home from the bottom.
const ORDER = [...new Set(rows.flatMap(r => [...r.shares.keys()]))].sort((a, b) => orderOf(a) - orderOf(b));
const layouts = rows.map(r => {
  const map = new Map();
  let c = 0;
  for (const id of ORDER) if (sideOf(id) === 'work') { const n = r.shares.get(id) || 0; map.set(id, [c, c + n]); c += n; }
  map.set('free', [c, c + r.F]);
  let b = 64;
  for (const id of ORDER) if (sideOf(id) === 'home') { const n = r.shares.get(id) || 0; map.set(id, [b - n, b]); b -= n; }
  return map;
});
const cellSide = (r, cc) => (cc < r.W ? 'w' : cc < r.W + r.F ? 'f' : 'h');
const changedCells = (a, b) => { const out = []; for (let c = 0; c < 64; c += 1) if (cellSide(rows[a], c + 0.5) !== cellSide(rows[b], c + 0.5)) out.push(c); return out; };
rows.forEach((r, i) => { r.flips = i ? changedCells(i - 1, i).length : 0; });

// Notes on the curve: big pulls, the two-week extreme, the round your hands most went against the lead.
const SWING = 14;
const extreme = rows.slice(1).reduce((a, b) => (Math.abs(b.d) > Math.abs(a.d) ? b : a), rows[Math.min(1, LAST)]);
const swings = new Set(rows.filter(r => r.i > 0 && Math.abs(r.swing) >= SWING).map(r => r.i));
const mismatch = (() => {
  let best = null;
  for (const r of rows) {
    if (!r.d) continue;
    const lead = r.d > 0 ? 'home' : 'work', trail = lead === 'home' ? 'work' : 'home';
    const gap = r.resp[trail].length - r.resp[lead].length;
    if (gap >= 3 && (!best || gap > best.gap)) best = { i: r.i, gap, lead, trail };
  }
  return best;
})();
const against = r => r.d && r.nw !== r.nh && Math.sign(r.d) !== Math.sign(r.nh - r.nw);
// Running totals: share-rounds and responses on each side, up to and including round i.
const upto = [];
rows.forEach((r, i) => { const p = upto[i - 1] || { H: 0, W: 0, nh: 0, nw: 0, against: 0, rounds: 0 }; upto.push({ H: p.H + r.H, W: p.W + r.W, nh: p.nh + r.nh, nw: p.nw + r.nw, against: p.against + (against(r) ? 1 : 0), rounds: p.rounds + (r.nh + r.nw ? 1 : 0) }); });
const maxResp = Math.max(1, ...rows.map(r => Math.max(r.nw, r.nh)));
const maxNW = Math.max(0, ...rows.map(r => r.nw)), maxNH = Math.max(0, ...rows.map(r => r.nh));
const countLabel = Math.max(2, Math.ceil(maxResp * 0.35));
const askShort = a => a.short || a.prompt;
const dueOf = a => (a?.due_at ? dueText(Date.parse(a.due_at)) : '');
// How a registered question closed (the first round after k where it is no longer open), or null while still open at `now`.
function closeOf(askId, from, now) {
  for (let j = from + 1; j <= now; j += 1) {
    if (askLife[j].answered.some(a => a.id === askId)) return { j, how: 'answered' };
    if (askLife[j].lapsed.some(a => a.id === askId)) return { j, how: 'lapsed' };
  }
  return null;
}
// Every registered question with the first round it was open in.
const askFirst = new Map();
askLife.forEach((life, k) => { for (const a of life.open.values()) if (!askFirst.has(a.id)) askFirst.set(a.id, { k, a }); });
const asksOfItem = (id, i) => [...askFirst.values()].filter(x => x.k <= i && rootOf(x.a.item) === id);
const answerOf = new Map();
frames.forEach((frame, i) => { for (const event of frame.events) for (const link of event.feedback || []) if (link.ask && !answerOf.has(link.ask)) answerOf.set(link.ask, { i, event, link }); });
const closedWords = (a, c) => (c.how === 'answered' ? `${frames[c.j].id} 答掉：${answerOf.get(a.id) ? responseSentence(answerOf.get(a.id).event, answerOf.get(a.id).link) : '你答了'}` : `${frames[c.j].id} 随改写失效`);

// ---------- the story: three beats per dataset (frame ids are page constants, not data) ----------
// composite：f01–f08 手在工作上，f09–f20 坠下，f21–f26 弹回（约 23 秒）。story：cold-01–f14 工作占大头，f15 翻过中线，f16–f19 周一退回。
const PLAN = {
  composite: { from: 'f00', beats: [['f01', 'half'], ['f02..f07', 'quick'], ['f08', 'full', 1.5], ['f09..f17', 'quick'], ['f18', 'full'], ['f19', 'half'],
    ['f20', 'full', 1.5], ['f21..f22', 'quick'], ['f23', 'full', 0.6], ['f24..f25', 'quick'], ['f26', 'full', 1.5]] },
  story: { from: 'cold-00', beats: [['cold-01', 'half'], ['cold-02..f13', 'quick'], ['f14', 'full', 1.0], ['f15', 'full', 1.5], ['f16..f18', 'quick'], ['f19', 'full', 1.5]] },
};
const plan = (() => {
  const p = PLAN[currentDataset()];
  if (!p) return null;
  const from = indexOfId(p.from), beats = [];
  for (const [span, speed, extra = 0] of p.beats) {
    const [a, b = a] = span.split('..').map(indexOfId);
    if (a < 0 || b < a) return null;
    for (let i = a; i <= b; i += 1) beats.push({ i, speed, extra: i === b ? extra : 0 });
  }
  const ok = from >= 0 && beats.every((b, k) => b.i === (k ? beats[k - 1].i : from) + 1);
  return ok ? { from, beats, end: beats.at(-1).i } : null;
})();
// Told only when opened on its own: top level, no ?frame=, not followed from another page, motion allowed.
const fromElsewhere = (() => { try { return Boolean(document.referrer) && new URL(document.referrer).pathname !== location.pathname; } catch { return false; } })();
const askedFrame = new URLSearchParams(location.search).has('frame');
const autoTell = Boolean(plan) && window.parent === window && !askedFrame && !fromElsewhere && !reduced();
// Without ?frame= the page opens on the story's last frame (composite f26 「此刻」), or on its first while telling.
if (!askedFrame && plan) { const q = new URLSearchParams(location.search); q.set('frame', autoTell ? plan.from : plan.end); history.replaceState(null, '', `?${q}`); }

const extremeText = extreme.d >= 0 ? `${monthDay(frames[extreme.i].at)} 家里压到 ${extreme.H} 份，工作只剩 ${extreme.W} 份` : `${monthDay(frames[extreme.i].at)} 工作压到 ${extreme.W} 份，家里只剩 ${extreme.H} 份`;
const key = `
  <span><i class="sw t-key-home"></i>家里（家庭与生活）</span>
  <span><i class="sw t-key-work"></i>工作</span>
  <span><i class="sw t-key-free"></i>留白</span>
  <span><svg width="26" height="12"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--ink)"/><path d="M0 4 L8 4 L14 11 L20 7 L26 4 Z" fill="var(--ink)"/></svg>曲线：墨面向下 = 家里领先，向上 = 工作领先</span>
  <span><i class="sw t-key-you"></i>朱红只给你：在来源处的回应，向上工作、向下家里</span>
  <span><i class="t-key-cell"></i>换了边的格子，拉的时候先灰一下</span>
  <span class="note"><kbd>←</kbd><kbd>→</kbd> 逐帧 <kbd>空格</kbd> 连播 <kbd>Enter</kbd> 展开 <kbd>Esc</kbd> 收回</span>`;
const stage = createStage({
  id: 'tug', no: 6, name: '拔河', storyIndex: plan ? plan.end : LAST, key,
  relation: `两周里，家与工作在 64 份里拔河：${extremeText}。`,
  tools: plan ? '<button type="button" class="t-tell" data-t="tell" title="从头讲一遍（任意键跳过）">▶ 讲一遍</button>' : '',
});
document.querySelector('.st-kicker').textContent = 'FOLD · 第四轮 · 关系的画法';
const figure = stage.figure;
figure.classList.add('t-fig');

// ---------- geometry: the bar and the curve share one scale (one share of lead = half a cell) ----------
let geo = null;
function measure() {
  const W = figure.clientWidth, H = figure.clientHeight;
  const HERO = 98, barX = 40, barW = 40, labelX = barX + barW + 10, labelR = 222, x0 = 258, x1 = W - 18;
  const kr = clamp(50 / maxResp, 3.5, 9), up = maxNW * kr, down = maxNH * kr, AX = 30, by0 = HERO + 6;
  const u = clamp((H - AX - 16 - up - down - 26 - by0) / 64, 4.5, 9);
  const barH = 64 * u, mid = by0 + 32 * u, base = by0 + barH + 26 + up, ay = base + down + 16;
  return { W, H, HERO, barX, barW, labelX, labelR, x0, x1, step: (x1 - x0) / Math.max(1, LAST), kr, up, down, by0, u, barH, mid, base, ay };
}
const xOf = k => geo.x0 + k * geo.step;
const yOf = d => geo.mid + (d * geo.u) / 2;
const cellY = c => geo.by0 + c * geo.u;
const f1 = v => v.toFixed(1);

// ---------- the static drawing (rebuilt only on resize) ----------
function chaptersSVG() {
  const g = geo;
  let out = '';
  for (let a = 0; a < frames.length;) {
    let b = a;
    while (b + 1 < frames.length && frames[b + 1].chapter === frames[a].chapter) b += 1;
    const ch = scenario.chapters?.find(c => c.id === frames[a].chapter);
    if (ch) {
      const xa = xOf(a) - (a ? g.step / 2 : 0) + 2, xb = xOf(b) + (b < LAST ? g.step / 2 : 0) - 2;
      const fit = fitText(ch.title.replace(/^.*? · /, ''), Math.max(12, xb - xa - 4), 10.5, { minSize: 9 });
      out += `<line x1="${f1(xa)}" x2="${f1(xb)}" y1="6" y2="6" class="t-ch-l"/><text x="${f1(xa + 2)}" y="20" font-size="${fit.size}" class="t-ch">${esc(fit.lines[0])}</text>`;
    }
    a = b + 1;
  }
  return out;
}
function gridSVG() {
  const g = geo;
  let out = '';
  for (const d of [48, 32, 16, -16, -32, -48]) {
    const y = yOf(d);
    if (y < g.by0 + 2 || y > g.by0 + g.barH - 2) continue;
    out += `<line x1="${g.x0}" x2="${f1(g.x1)}" y1="${f1(y)}" y2="${f1(y)}" class="t-gl"/><text x="${g.x0 - 8}" y="${f1(y + 3.5)}" text-anchor="end" class="t-gt">${d > 0 ? `家里 +${d}` : `工作 +${-d}`}</text>`;
  }
  return `${out}<line x1="${g.x0 - 4}" x2="${f1(g.x1)}" y1="${f1(g.mid)}" y2="${f1(g.mid)}" class="t-mid"/><text x="${g.x0 - 8}" y="${f1(g.mid + 3.5)}" text-anchor="end" class="t-mid-t">持平</text>`;
}
function notchesSVG() {
  let out = '';
  for (const r of rows) {
    if (!r.i || r.F < 10) continue;
    const h = (r.F * geo.u) / 2, first = r.F >= 10 && rows[r.i - 1].F < 10;
    out += `<g class="t-notch t-dim" data-k="${r.i}"><rect x="${f1(xOf(r.i) - 2.5)}" y="${f1(geo.mid - h / 2)}" width="5" height="${f1(h)}" fill="url(#t-hatch)"/>${first ? `<text x="${f1(xOf(r.i))}" y="${f1(geo.mid - h / 2 - 5)}" text-anchor="middle" class="t-notch-t">留白 ${r.F}</text>` : ''}</g>`;
  }
  return out;
}
// Notes, placed once per layout: below the point when 家里 leads, above it when 工作 leads. The extreme goes first, then the
// callout over your columns, then the big pulls; each tries centred, left and right of its point before stepping away.
function annsSVG() {
  const g = geo, boxes = [], parts = new Map();
  const hits = box => boxes.some(b => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1);
  const place = (x, y, w, h, dir) => {
    const at = (dx, dy) => ({ x0: x - w / 2 + dx, x1: x + w / 2 + dx, y0: y + dy, y1: y + h + dy });
    let box = null;
    for (let k = 0; k < 8 && !box; k += 1) for (const dx of [0, -(w / 2 - 6), w / 2 - 6]) { const b = at(dx, dir * 13 * k); if (!hits(b)) { box = b; break; } }
    box ||= at(0, 0);
    boxes.push(box);
    return box;
  };
  const add = (i, html) => parts.set(i, `${parts.get(i) || ''}${html}`);
  const noted = rows.filter(r => r.i && (swings.has(r.i) || r.i === extreme.i));
  for (const r of noted) { const px = xOf(r.i), py = yOf(r.d), s = r.i === extreme.i ? 5 : 4; boxes.push({ x0: px - s, x1: px + s, y0: py - s, y1: py + s }); }
  {
    const r = extreme, px = xOf(r.i), py = yOf(r.d), down = r.d >= 0;
    const text = `${monthDay(frames[r.i].at)} ${timeOf(frames[r.i].at)}　家里 ${r.H} : 工作 ${r.W}`;
    const w = textWidth(text, 11.5, 600) + 6;
    const b = place(px, down ? py + 12 : py - 12 - 14, w, 14, down ? 1 : -1);
    add(r.i, `<circle cx="${f1(px)}" cy="${f1(py)}" r="3.4" class="t-ann-pt is-big"/><text x="${f1((b.x0 + b.x1) / 2)}" y="${f1(b.y0 + 11)}" text-anchor="middle" class="t-ann-x">${esc(text)}</text>`);
  }
  if (mismatch) {
    const r = rows[mismatch.i], px = xOf(r.i), top = g.base - r.nw * g.kr, y = Math.min(top, g.base) - 30;
    const l1 = `${monthDay(frames[r.i].at)} ${timeOf(frames[r.i].at)}：份额家里 ${r.H} : 工作 ${r.W}`;
    const l2 = `你在${SIDE_WORD[mismatch.trail]}上动手 ${r.resp[mismatch.trail].length} 次，${SIDE_WORD[mismatch.lead]} ${r.resp[mismatch.lead].length} 次`;
    boxes.push({ x0: px + 14, x1: px + 18 + Math.max(textWidth(l1, 11), textWidth(l2, 11)), y0: y - 4, y1: y + 26 });
    add(r.i, `<line x1="${f1(px + 5)}" x2="${f1(px + 14)}" y1="${f1(y + 4)}" y2="${f1(y + 4)}" class="t-ann-you-l"/><text x="${f1(px + 18)}" y="${f1(y + 8)}" class="t-ann-c">${esc(l1)}</text><text x="${f1(px + 18)}" y="${f1(y + 22)}" class="t-ann-you">${esc(l2)}</text>`);
  }
  for (const r of rows) {
    if (!swings.has(r.i)) continue;
    const px = xOf(r.i), py = yOf(r.d), down = r.d >= 0;
    const head = `${r.swing > 0 ? '向家里' : '向工作'} ${Math.abs(r.swing)}`;
    const movers = r.moves.slice(0, 2).map(m => `${shortOf(m.id)} ${signed(m.n)}`).join(' · ');
    const w = Math.max(textWidth(head, 10.5, 600), textWidth(movers, 9.5)) + 6;
    const b = place(px, down ? py + 8 : py - 8 - 26, w, 26, down ? 1 : -1);
    add(r.i, `<line x1="${f1(px)}" x2="${f1(px)}" y1="${f1(py)}" y2="${f1(down ? b.y0 : b.y1)}" class="t-ann-l"/>${r.i === extreme.i ? '' : `<circle cx="${f1(px)}" cy="${f1(py)}" r="2.6" class="t-ann-pt"/>`}
      <text x="${f1((b.x0 + b.x1) / 2)}" y="${f1(b.y0 + 10)}" text-anchor="middle" class="t-ann-h">${esc(head)}</text><text x="${f1((b.x0 + b.x1) / 2)}" y="${f1(b.y0 + 23)}" text-anchor="middle" class="t-ann-m">${esc(movers)}</text>`);
  }
  return [...parts].sort((a, b) => a[0] - b[0]).map(([i, html]) => `<g class="t-ann t-dim" data-k="${i}">${html}</g>`).join('');
}
// Your responses: one column a side a round, stacked by item in the bar's order so one item can be traced across rounds.
function laneSVG() {
  const g = geo;
  let out = `<line x1="${g.x0 - 4}" x2="${f1(g.x1)}" y1="${f1(g.base)}" y2="${f1(g.base)}" class="t-base"/>
    <text x="${g.x0 - 8}" y="${f1(g.base - Math.max(34, g.up) + 4)}" text-anchor="end" class="t-you-t">你在来源处</text><text x="${g.x0 - 8}" y="${f1(g.base - Math.max(34, g.up) + 17)}" text-anchor="end" class="t-you-t">动手的次数</text>
    <text x="${g.x0 - 8}" y="${f1(g.base - 4)}" text-anchor="end" class="t-lane-t">工作 ↑</text><text x="${g.x0 - 8}" y="${f1(g.base + 12)}" text-anchor="end" class="t-lane-t">家里 ↓</text>`;
  for (const r of rows) {
    if (!r.i || (!r.nw && !r.nh && !r.annotations.length)) continue;
    const x = xOf(r.i) - 4;
    let parts = '';
    for (const [side, s, dir] of [['work', 'w', -1], ['home', 'h', 1]]) {
      const byItem = new Map();
      for (const x0 of r.resp[side]) byItem.set(x0.item, (byItem.get(x0.item) || 0) + 1);
      // Whole pixels from a rounded base, so the cuts of one column share edges exactly (no seams under crispEdges).
      const b0 = Math.round(g.base), at = n => b0 + dir * Math.round(n * g.kr);
      let c = 0, y = b0;
      for (const id of [...byItem.keys()].sort((a, b) => orderOf(a) - orderOf(b))) {
        const y0 = at(c), y1 = at(c += byItem.get(id));
        parts += `<rect class="t-part t-dim" data-id="y:${r.i}:${s}" data-item="${esc(id)}" x="${Math.round(x)}" y="${Math.min(y0, y1)}" width="8" height="${Math.abs(y1 - y0)}"/>`;
        y = y1;
      }
      const n = r.resp[side].length;
      if (n >= countLabel) parts += `<text class="t-count" x="${f1(x + 4)}" y="${f1(dir < 0 ? y - 4 : y + 11)}" text-anchor="middle">${n}</text>`;
    }
    if (r.annotations.length) parts += `<text class="t-note" x="${f1(x + 4)}" y="${f1(g.base - r.nw * g.kr - (r.nw >= countLabel ? 16 : 4))}" text-anchor="middle">✎</text>`;
    out += `<g class="t-col" data-k="${r.i}">${parts}</g>`;
  }
  return out;
}
function axisSVG() {
  const g = geo;
  let out = '';
  let lastDay = null;
  for (let k = 0; k <= LAST; k += 1) {
    const t = Date.parse(frames[k].at), day = dayOf(t);
    if (day === lastDay) continue;
    lastDay = day;
    out += `<line x1="${f1(xOf(k))}" x2="${f1(xOf(k))}" y1="${f1(g.ay)}" y2="${f1(g.ay + 5)}" class="t-tick"/><text x="${f1(xOf(k))}" y="${f1(g.ay + 16)}" text-anchor="middle" class="t-day">${day}</text><text x="${f1(xOf(k))}" y="${f1(g.ay + 28)}" text-anchor="middle" class="t-wd">${esc(weekdayOf(t).replace('周', ''))}</text>`;
  }
  const month = new Intl.DateTimeFormat('zh-CN', { timeZone: scenario.timeZone || 'Asia/Shanghai', month: 'long' }).format(new Date(frames[0].at));
  return `${out}<text x="${g.x0 - 8}" y="${f1(g.ay + 16)}" text-anchor="end" class="t-day is-month">${esc(month)}</text>`;
}
function barSVG() {
  const g = geo;
  let ticks = '';
  for (let c = 0; c <= 64; c += 1) {
    const len = c === 32 ? 9 : c % 8 === 0 ? 6 : 3;
    ticks += `<line x1="${g.barX - len}" x2="${g.barX}" y1="${f1(cellY(c))}" y2="${f1(cellY(c))}" class="t-btick"/>`;
  }
  const segs = ORDER.map(id => `<rect class="t-seg t-dim ${sideOf(id) === 'work' ? 't-w' : 't-h'}" data-id="s:${esc(id)}" x="${g.barX}" width="${g.barW}" y="${f1(g.by0)}" height="0"/>`).join('');
  return `<g class="t-bticks">${ticks}</g>
    <text x="${g.barX - 12}" y="${f1(g.by0 + 9)}" text-anchor="end" class="t-bside">工作</text><text x="${g.barX - 12}" y="${f1(g.by0 + g.barH - 1)}" text-anchor="end" class="t-bside">家里</text>
    <rect class="t-seg t-free t-dim" data-id="s:free" x="${g.barX}" width="${g.barW}" y="${f1(g.by0)}" height="0" fill="url(#t-hatch)"/>${segs}
    <rect class="t-frame" x="${g.barX}" y="${f1(g.by0)}" width="${g.barW}" height="${f1(g.barH)}"/>`;
}
const heroHTML = () => `<div class="t-hero" aria-live="off"><div class="t-score"><b class="t-sh">0</b><i>:</i><b class="t-sw">0</b></div>
  <div class="t-hero-k"><span>家里 : 工作</span> · <span class="t-hero-when"></span></div><div class="t-hero-k"><span class="t-hero-free"></span></div></div>`;

const els = { seg: new Map(), lab: new Map(), notch: new Map(), ann: new Map(), col: new Map() };
let canvas = null, ctx = null, dpr = 1;
function render() {
  geo = measure();
  const g = geo;
  // ix keeps its cards, leaders and keyboard proxies in the figure; only the drawing is rebuilt.
  const kept = [...figure.querySelectorAll(':scope > .ix-leaders, :scope > .ix-peek, :scope > .ix-detail, :scope > .ix-sr')];
  figure.innerHTML = `${heroHTML()}<svg class="t-svg" width="${g.W}" height="${g.H}" viewBox="0 0 ${g.W} ${g.H}" aria-hidden="true">
    <defs><pattern id="t-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--paper)"/><line x1="0" y1="0" x2="0" y2="5" stroke="var(--ink-3)" stroke-width="1"/></pattern>
      <clipPath id="t-up"><rect x="0" y="0" width="${g.W}" height="${f1(g.mid)}"/></clipPath><clipPath id="t-dn"><rect x="0" y="${f1(g.mid)}" width="${g.W}" height="${f1(g.H - g.mid)}"/></clipPath></defs>
    <g class="t-chapters">${chaptersSVG()}</g><g class="t-grid">${gridSVG()}</g>
    <rect class="t-band" x="0" y="${f1(g.by0 - 4)}" width="${f1(g.step)}" height="${f1(g.barH + 8)}" hidden/>
    <path class="t-fill-dn t-dim" clip-path="url(#t-dn)"/><path class="t-fill-up t-dim" clip-path="url(#t-up)"/>
    <g class="t-notches">${notchesSVG()}</g><path class="t-line t-dim"/>
    <g class="t-nowg"><line class="t-now" x1="0" x2="0" y1="30" y2="${f1(g.ay - 4)}"/><text class="t-now-t" x="0" y="40" text-anchor="middle"></text></g>
    <g class="t-anns">${annsSVG()}</g>
    <g class="t-lane">${laneSVG()}</g><g class="t-axis">${axisSVG()}</g>
    <circle class="t-pt" r="3.8" cx="0" cy="0" hidden/>
    <g class="t-bar">${barSVG()}</g>
    <g class="t-labels">${[...ORDER, 'free'].map(id => `<text class="t-lab t-dim${id === 'free' ? ' is-free' : ''}" data-id="s:${esc(id)}" x="${g.labelX}" y="0" hidden></text>`).join('')}</g>
  </svg><canvas class="t-cells" aria-hidden="true"></canvas>`;
  figure.append(...kept);
  const sr = kept.find(el => el.classList.contains('ix-sr'));
  if (sr) figure.prepend(sr);
  els.svg = figure.querySelector('.t-svg');
  els.seg = new Map([...figure.querySelectorAll('.t-seg')].map(el => [el.dataset.id.slice(2), el]));
  els.lab = new Map([...figure.querySelectorAll('.t-lab')].map(el => [el.dataset.id.slice(2), el]));
  els.notch = new Map([...figure.querySelectorAll('.t-notch')].map(el => [Number(el.dataset.k), el]));
  els.ann = new Map([...figure.querySelectorAll('.t-ann')].map(el => [Number(el.dataset.k), el]));
  els.col = new Map([...figure.querySelectorAll('.t-col')].map(el => [Number(el.dataset.k), el]));
  els.fillDn = figure.querySelector('.t-fill-dn'); els.fillUp = figure.querySelector('.t-fill-up'); els.line = figure.querySelector('.t-line');
  els.now = figure.querySelector('.t-nowg'); els.nowT = figure.querySelector('.t-now-t');
  els.band = figure.querySelector('.t-band'); els.pt = figure.querySelector('.t-pt');
  els.sh = figure.querySelector('.t-sh'); els.sw = figure.querySelector('.t-sw'); els.score = figure.querySelector('.t-score');
  els.when = figure.querySelector('.t-hero-when'); els.free = figure.querySelector('.t-hero-free');
  canvas = figure.querySelector('.t-cells');
  dpr = Math.min(2, devicePixelRatio || 1);
  const cw = g.barW + 4, ch = g.barH + 4;
  canvas.style.cssText = `left:${g.barX - 2}px;top:${f1(g.by0 - 2)}px;width:${cw}px;height:${f1(ch)}px`;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cache.clear(); drawnCells = false; lastSig = ''; litKey = undefined; popEl = []; labels = [];
  paint();
  ix?.relayout();
}

// ---------- the clock: one round pulled ----------
// Full speed 1.5 s; half × 0.5 (playing, and the story's middle beats), quick × 0.3 (rounds the story only passes through),
// short (←/→) 0.5 s; a jump of several rounds walks the curve in 0.42 s. Times in seconds from the cut.
const FULL = { pull0: 0.10, pull1: 0.70, resp0: 0.70, resp1: 1.00, dur: 1.50 };
const SCALE = { full: 1, half: 0.5, quick: 0.3, short: 1 / 3 };
const SWEEP = { pull0: 0, pull1: 0.32, resp0: 0.32, resp1: 0.42, dur: 0.42 };
const FLIP = 0.28;
const timing = mode => (mode === 'sweep' ? { ...SWEEP, s: 0.4 } : Object.fromEntries([...Object.entries(FULL).map(([k, v]) => [k, v * SCALE[mode]]), ['s', SCALE[mode]]]));
let post = null;              // the round being pulled: {i, from, mode, T, t, extra, changed, flipAt}
let freeze = false;           // tellAt(): a still, until any control releases it
const hold = { at: null };    // ix holds the clock while something is hovered or open
let driving = null;           // set while the page steps itself (telling, playing): {mode, extra}
const run = { kind: null, k: -1, wait: 0 };   // 'tell' | 'play'
const now = () => performance.now() / 1000;
const pullAt = (T, mode, t) => { const k = (t - T.pull0) / (T.pull1 - T.pull0); return mode === 'sweep' ? easeInOut(k) : easeOutBack(k); };

function startPost(i, from, mode, extra = 0) {
  const T = timing(mode);
  post = { i, from, mode, T, t: 0, extra, changed: [], flipAt: new Map() };
  if (reduced()) { post.t = T.dur; return; }
  // When the moving boundaries pass each cell that changes side (sampled once, so a still at any t is the same).
  const A = rows[from], B = rows[i];
  for (const c of changedCells(from, i)) {
    const old = cellSide(A, c + 0.5);
    for (let t = T.pull0; t <= T.pull1 + 1e-6; t += 1 / 240) {
      const p = pullAt(T, mode, t);
      if (cellSide({ W: lerp(A.W, B.W, p), F: lerp(A.F, B.F, p) }, c + 0.5) !== old) { post.flipAt.set(c, t); break; }
    }
    post.changed.push(c);
  }
}
function finishPost() { if (post) { post.t = Math.max(post.t, post.T.dur); post = null; } clearCells(); }

// What is on screen at this moment: the round pulled from `prev` to `next`, how far (p, with overshoot; px without), whether
// it has settled (numbers cut), and how far your columns have grown (g).
function visual() {
  const i = stage.index;
  if (!post || post.i !== i) return { prev: i, next: i, p: 1, px: 1, settled: true, g: 1, posting: false, t: 0 };
  const T = post.T, t = post.t, p = pullAt(T, post.mode, t);
  const px = post.mode === 'sweep' ? p : clamp(easeOut((t - T.pull0) / (T.pull1 - T.pull0)));
  const settled = t >= T.pull1, g = easeOut((t - T.resp0) / Math.max(0.001, T.resp1 - T.resp0));
  return { prev: post.from, next: i, p, px, settled, g, posting: t < T.resp1, t, mode: post.mode };
}

// ---------- frame changes ----------
let keyRepeat = false;
addEventListener('keydown', event => { keyRepeat = event.repeat; }, true);
stage.onFrame((next, previous) => {
  if (!driving) { stopRun(); freeze = false; if (ix) { ix.reset(); closePanel(); } }
  finishPost();
  const mode = driving ? driving.mode : next === previous + 1 ? (keyRepeat ? 'sweep' : 'short') : next > previous ? 'sweep' : 'back';
  if (mode !== 'back' && mode !== 'snap' && next > previous) startPost(next, previous, mode, driving?.extra || 0);
});
/** The page steps itself (telling, playing): one round pulled at a speed. */
function drive(i, mode, extra = 0) {
  driving = { mode, extra };
  try { if (i === stage.index) { finishPost(); if (mode !== 'snap' && i > 0) startPost(i, i - 1, mode, extra); } else stage.go(i); } finally { driving = null; }
}

// ---------- telling and playing ----------
function setRunUI() {
  document.body.classList.toggle('st-playing', run.kind === 'play');
  const b = document.querySelector('[data-t="tell"]');
  if (b) { b.textContent = run.kind === 'tell' ? '跳过 ▸▸' : '▶ 讲一遍'; b.setAttribute('aria-pressed', String(run.kind === 'tell')); }
}
function stopRun() { if (!run.kind) return; run.kind = null; setRunUI(); }
function startTell() {
  if (!plan) return;
  freeze = false; stopRun(); ix?.reset(); closePanel();
  if (reduced()) { drive(plan.end, 'snap'); return; }
  drive(plan.from, 'snap');
  Object.assign(run, { kind: 'tell', k: -1, wait: 0.4 });
  setRunUI();
}
/** Skip to the end of the story, settled. */
function skipTell() { if (!plan) return; stopRun(); freeze = false; drive(plan.end, 'snap'); }
function startPlay() {
  freeze = false; stopRun(); ix?.reset(); closePanel();
  if (stage.index >= LAST) drive(0, 'snap');
  Object.assign(run, { kind: 'play', k: 0, wait: 0 });
  setRunUI();
}
stage.play = startPlay;
stage.pause = () => { if (run.kind === 'play') stopRun(); };
stage.toggle = () => (run.kind === 'play' ? stage.pause() : startPlay());
const beatLen = b => timing(b.speed).dur + b.extra;
const tellLength = () => (plan ? 0.4 + plan.beats.reduce((s, b) => s + beatLen(b), 0) : 0);
/** A still of the story at `s` seconds (stills and checks): released by any control. */
function tellAt(s) {
  if (!plan) return;
  stopRun(); ix?.reset(); closePanel();
  drive(plan.from, 'snap');
  let t = s - 0.4;
  for (const [k, b] of plan.beats.entries()) {
    const len = beatLen(b);
    if (t < len || k === plan.beats.length - 1) {
      if (t < 0) break;
      drive(b.i, b.speed, b.extra);
      post.t = Math.min(t, len);
      break;
    }
    drive(b.i, 'snap');
    t -= len;
  }
  freeze = true;
}
function tick(dt) {
  if (hold.at != null || freeze) return;
  if (post) {
    post.t += dt;
    if (post.t >= post.T.dur + post.extra && !run.kind) finishPost();
  }
  if (!run.kind || (post && post.t < post.T.dur + post.extra)) return;
  if (run.wait > 0) { run.wait -= dt; return; }
  if (run.kind === 'tell') {
    run.k += 1;
    const b = plan.beats[run.k];
    if (!b) { stopRun(); finishPost(); return; }
    drive(b.i, b.speed, b.extra);
  } else {
    if (stage.index >= LAST) { stopRun(); finishPost(); return; }
    drive(stage.index + 1, 'half');
  }
}
// Any key or a press skips the story (Tab still moves focus).
addEventListener('keydown', event => {
  if (run.kind === 'tell' && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key) && !event.metaKey && !event.ctrlKey) {
    skipTell();
    if (event.key !== 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); }
    return;
  }
  freeze = false;
}, true);
addEventListener('pointerdown', event => {
  if (run.kind === 'tell' && !event.target.closest?.('[data-t="tell"]')) skipTell();
  freeze = false;
}, true);

// ---------- painting ----------
const cache = new Map();
const setAttr = (el, name, value, k) => { const ck = `${k}|${name}`; if (cache.get(ck) !== value) { cache.set(ck, value); el.setAttribute(name, value); } };
const setHidden = (el, hidden, k) => { const ck = `${k}|hidden`; if (cache.get(ck) !== hidden) { cache.set(ck, hidden); el.toggleAttribute('hidden', hidden); } };
const curSeg = new Map();     // id → [c0, c1] as drawn now
let labels = [];              // [{id, x0, x1, y}] as drawn now (for hits)
let vis = visual(), lastSig = '';
function paint() {
  const st = visual(), g = geo;
  vis = st;
  // The now line slides to the new round in 0.32 s (shorter for quick rounds) with the pull's 3.7 % overshoot.
  const nowK = st.posting || st.t ? easeOutBack(st.t / Math.max(0.12, Math.min(0.32, (post?.T.dur || 1) * 0.6))) : 1;
  const sig = `${st.prev}|${st.next}|${st.p.toFixed(4)}|${st.px.toFixed(4)}|${st.settled}|${st.g.toFixed(3)}|${nowK.toFixed(3)}`;
  if (sig === lastSig) return;
  lastSig = sig;
  const A = layouts[st.prev], B = layouts[st.next];
  // The bar: every segment between where it was and where it is.
  for (const [id, el] of els.seg) {
    const a = A.get(id), b = B.get(id);
    const c0 = lerp(a[0], b[0], st.p), c1 = lerp(a[1], b[1], st.p), h = (c1 - c0) * g.u;
    curSeg.set(id, [c0, c1]);
    if (h < 0.05) { setHidden(el, true, `s${id}`); continue; }
    setHidden(el, false, `s${id}`);
    setAttr(el, 'y', f1(cellY(c0)), `s${id}`); setAttr(el, 'height', h.toFixed(2), `s${id}`);
  }
  paintLabels(st);
  // The curve up to its head, and the ink or paper between it and the even line.
  const pts = [];
  for (let k = 0; k <= st.prev; k += 1) pts.push([xOf(k), yOf(rows[k].d)]);
  if (st.next === st.prev + 1) pts.push([lerp(xOf(st.prev), xOf(st.next), st.px), lerp(yOf(rows[st.prev].d), yOf(rows[st.next].d), st.p)]);
  else if (st.next > st.prev) {
    const h = st.prev + st.px * (st.next - st.prev), k0 = Math.floor(h);
    for (let k = st.prev + 1; k <= k0; k += 1) pts.push([xOf(k), yOf(rows[k].d)]);
    if (h > k0 && k0 < st.next) pts.push([lerp(xOf(k0), xOf(k0 + 1), h - k0), lerp(yOf(rows[k0].d), yOf(rows[k0 + 1].d), h - k0)]);
  }
  const line = pts.map(([x, y], k) => `${k ? 'L' : 'M'}${f1(x)},${f1(y)}`).join('');
  const fill = pts.length > 1 ? `M${f1(pts[0][0])},${f1(g.mid)}${pts.map(([x, y]) => `L${f1(x)},${f1(y)}`).join('')}L${f1(pts.at(-1)[0])},${f1(g.mid)}Z` : '';
  setAttr(els.line, 'd', line, 'line'); setAttr(els.fillDn, 'd', fill, 'fill'); setAttr(els.fillUp, 'd', fill, 'fill2');
  const headK = st.next > st.prev ? st.prev + st.px * (st.next - st.prev) : st.next;
  const shown = st.settled ? st.next : st.prev;
  for (const [k, el] of els.notch) {
    const on = k <= headK + 1e-6;
    setHidden(el, !on, `n${k}`);
  }
  for (const [k, el] of els.ann) el.classList.toggle('is-on', k <= shown);
  for (const [k, el] of els.col) {
    const grow = k <= st.prev ? 1 : k <= st.next ? st.g : 0;
    setHidden(el, grow <= 0.001, `c${k}`);
    setAttr(el, 'transform', grow >= 1 ? '' : `matrix(1 0 0 ${grow.toFixed(4)} 0 ${f1(g.base * (1 - grow))})`, `c${k}`);
    el.classList.toggle('is-growing', grow < 1);
  }
  // This moment: the now line slides with the cut; the hero number cuts at the settle.
  const nx = st.next > st.prev ? lerp(xOf(st.prev), xOf(st.next), nowK) : xOf(st.next);
  setAttr(els.now, 'transform', `translate(${f1(nx)} 0)`, 'now');
  if (els.nowT.textContent !== `此刻 ${frames[st.next].id}`) els.nowT.textContent = `此刻 ${frames[st.next].id}`;
  const r = rows[shown];
  if (els.sh.textContent !== String(r.H)) els.sh.textContent = r.H;
  if (els.sw.textContent !== String(r.W)) els.sw.textContent = r.W;
  const when = dayTime(frames[shown].at), free = `留白 ${r.F} / 64`;
  if (els.when.textContent !== when) els.when.textContent = when;
  if (els.free.textContent !== free) els.free.textContent = free;
  // Passing through (the story's quick rounds) the number is grey; it turns to ink on a beat.
  els.score.classList.toggle('is-passing', Boolean(post && post.mode === 'quick'));
}
// Names and shares beside the bar: they ride with their segments, and their numbers cut at the settle.
function paintLabels(st) {
  const g = geo, r = st.settled ? rows[st.next] : rows[st.prev];
  const list = [];
  for (const id of [...ORDER, 'free']) {
    const seg = curSeg.get(id), hpx = (seg[1] - seg[0]) * g.u;
    const n = id === 'free' ? r.F : r.shares.get(id) || 0;
    if (!n || n < (id === 'free' ? 2 : 3) || hpx < 9) continue;
    list.push({ id, y: cellY((seg[0] + seg[1]) / 2) + 3.5, text: id === 'free' ? `留白 ${n}` : `${shortOf(id)} ${n}` });
  }
  list.sort((a, b) => a.y - b.y);
  for (let k = 1; k < list.length; k += 1) list[k].y = Math.max(list[k].y, list[k - 1].y + 12.5);
  const floor = g.by0 + g.barH + 2;
  if (list.length && list.at(-1).y > floor) { list.at(-1).y = floor; for (let k = list.length - 2; k >= 0; k -= 1) list[k].y = Math.min(list[k].y, list[k + 1].y - 12.5); }
  const on = new Set(list.map(x => x.id));
  labels = [];
  for (const x of list) {
    const el = els.lab.get(x.id);
    setHidden(el, false, `l${x.id}`);
    setAttr(el, 'y', f1(x.y), `l${x.id}`);
    if (el.textContent !== x.text) el.textContent = x.text;
    labels.push({ id: x.id, x0: g.labelX - 4, x1: g.labelX + textWidth(x.text, 10.5) + 4, y0: x.y - 10, y1: x.y + 3 });
  }
  for (const [id, el] of els.lab) if (!on.has(id)) setHidden(el, true, `l${id}`);
}

// ---------- the concept layer: a cell that changes side greys as the boundary sweeps it, then settles ----------
let drawnCells = false;
function clearCells() { if (drawnCells && ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); drawnCells = false; } }
function paintCells(alphaK) {
  if (!post || !post.changed.length || reduced() || post.t > post.T.pull1 + FLIP * post.T.s + 0.05) { clearCells(); return; }
  const g = geo, life = Math.max(0.12, FLIP * post.T.s);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawnCells = true;
  for (const c of post.changed) {
    const at0 = post.flipAt.get(c);
    if (at0 == null) continue;
    const k = (post.t - at0) / life;
    if (k < 0 || k >= 1) continue;
    ctx.fillStyle = `rgba(120,128,118,${(0.62 * (1 - k) * alphaK).toFixed(3)})`;
    ctx.fillRect(3, 2 + c * g.u + 0.5, g.barW - 2, Math.max(1, g.u - 1));
  }
}

// ---------- side panel: this round ----------
const answerLink = i => withDataset(`../../index.html?variant=d&frame=${i}`);
const chip = (id, n, tail = '') => `<li><button type="button" class="t-pin" data-t-pin="${esc(id)}">${esc(id === 'free' ? '留白' : shortOf(id))}</button><b>${n}</b><small>${tail}</small></li>`;
function asksBySide(i, href) {
  const open = [...askLife[i].open.values()], fresh = new Set(askLife[i].fresh.map(a => a.id));
  if (!open.length) return '<p class="st-muted">没有开着的问题</p>';
  return ['home', 'work'].map(side => {
    const list = open.filter(a => sideOf(a.item) === side);
    return list.length ? `<ul class="t-asks"><li class="t-asks-h">${SIDE_WORD[side]}</li>${list.map(a => `<li><b>${fresh.has(a.id) ? '新登记' : '开着'}</b><span>${esc(askShort(a))}</span><small>${esc([shortOf(rootOf(a.item)), dueOf(a)].filter(Boolean).join(' · '))}</small><a href="${esc(href)}">去回答 →</a></li>`).join('')}</ul>` : '';
  }).join('');
}
function overviewHTML(i) {
  const r = rows[i], f = frames[i];
  if (i === 0) return { kicker: `这一轮 · ${f.id}`, title: esc(f.title), body: '<p>还没有整理过任何输入：64 份全是留白。按 → 或空格开始。</p>' };
  const p = rows[i - 1];
  const list = side => [...r.shares].filter(([id, n]) => n && sideOf(id) === side).sort((a, b) => b[1] - a[1] || orderOf(a[0]) - orderOf(b[0]));
  const change = id => { const b = p.shares.get(id) || 0, a = r.shares.get(id) || 0; return !b ? '新增' : a !== b ? signed(a - b) : ''; };
  const gone = side => r.moves.filter(m => m.side === side && !m.after);
  const col = side => `<section><h4>${SIDE_WORD[side]} ${side === 'home' ? r.H : r.W} <small>${list(side).length} 件</small></h4><ul class="t-list">${list(side).map(([id, n]) => chip(id, n, change(id))).join('')}${gone(side).map(m => `<li class="is-gone"><span>${esc(shortOf(m.id))}</span><b>0</b><small>${signed(-m.before)}</small></li>`).join('')}</ul></section>`;
  const said = side => foldSentences(r.resp[side]).map(x => `<li><i></i><span>${esc(x.label)}</span>${x.first.link.ask ? '<small>答登记的问题</small>' : ''}</li>`).join('');
  const others = rows.filter(x => x.i && x.i !== i && x.H === r.H && x.W === r.W).map(x => frames[x.i].id);
  const u = upto[i];
  const lead = r.d > 0 ? `家里领先 ${r.d}` : r.d < 0 ? `工作领先 ${-r.d}` : '持平';
  return {
    kicker: `这一轮 · ${f.id} · ${records[i].state.revision}`,
    title: esc(f.title),
    body: `<div class="t-ov">
      <p class="t-ov-score"><span>家里 <b>${r.H}</b></span><i>:</i><span>工作 <b>${r.W}</b></span><small>留白 ${r.F}</small></p>
      <p class="t-ov-move">${lead}${r.swing ? ` · 差距${r.swing > 0 ? '向家里' : '向工作'}移了 ${Math.abs(r.swing)} 份（${p.H} : ${p.W} → ${r.H} : ${r.W}）` : ' · 差距没有变'}${r.flips ? ` · 换手 ${r.flips} 格` : ''}</p>
      <div class="t-cols">${col('home')}${col('work')}</div>
      <section class="t-said"><h4>你在来源处动手 <small>工作 ${r.nw} · 家里 ${r.nh}${against(r) ? ' · 和份额领先的一边相反' : ''}</small></h4>
        ${r.nw + r.nh ? `${r.nw ? `<ul class="t-said-l"><li class="t-asks-h">工作</li>${said('work')}</ul>` : ''}${r.nh ? `<ul class="t-said-l"><li class="t-asks-h">家里</li>${said('home')}</ul>` : ''}` : '<p class="st-muted">这一轮没有挂到事项上的动作。</p>'}</section>
      ${r.annotations.length ? `<section><h4>批注 <small>来自你本人</small></h4>${r.annotations.map(a => `<p>「${esc(a.text)}」</p>`).join('')}</section>` : ''}
      <section><h4>开着的问题 <small>${askLife[i].open.size} 条 · 去回答链到同一帧的 D</small></h4>${asksBySide(i, answerLink(i))}</section>
      <section class="t-two"><h4>到此刻 <small>${f.id}</small></h4><p>份额·轮 家里 ${u.H} : 工作 ${u.W} · 你动手 家里 ${u.nh} : 工作 ${u.nw}${u.rounds ? ` · ${u.rounds} 轮有动作，${u.against} 轮和份额领先的一边相反` : ''}</p>
        ${others.length ? `<p class="st-muted">同样的 ${r.H} : ${r.W} 还有 ${others.join('、')}：比分一样，里面的事不一定一样。</p>` : ''}</section>
      </div>`,
  };
}
// While a round is still being pulled the panel keeps the round before it; it cuts to this one at the settle.
stage.setOverview(i => overviewHTML(post && post.i === i && post.t < post.T.pull1 ? post.from : i));
let sideShown = -1;
function paintSide() {
  const shown = vis.settled ? vis.next : vis.prev;
  if (shown !== sideShown) { sideShown = shown; if (!stage.pinned) stage.refreshSide(); }
}

// ---------- the interaction (motion/ix.mjs) ----------
// Keys: `s:<id>` a segment of the bar (an item, or 'free'), `r:<k>` round k on the curve, `y:<k>:w|h` your column on a side.
const HIT = 10;
function parseKey(key) {
  const s = String(key ?? '');
  if (s.startsWith('s:')) return { kind: 'seg', id: s.slice(2) };
  const [kind, a, b] = s.split(':');
  if (kind === 'r' && Number.isInteger(Number(a))) return { kind: 'round', k: Number(a) };
  if (kind === 'y' && Number.isInteger(Number(a)) && (b === 'w' || b === 'h')) return { kind: 'resp', k: Number(a), s: b, side: b === 'w' ? 'work' : 'home' };
  return null;
}
function hasKey(key) {
  const p = parseKey(key), i = stage.index;
  if (!p || !geo) return false;
  if (p.kind === 'seg') { const seg = curSeg.get(p.id); return Boolean(seg) && (seg[1] - seg[0]) * geo.u >= 1.5; }
  if (p.k < 1 || p.k > i) return false;
  if (p.kind === 'round') return p.k < i || vis.settled;
  return rows[p.k].resp[p.side].length > 0 && (p.k < i || vis.g >= 0.5);
}
function hitAt(x, y) {
  const g = geo;
  if (!g) return null;
  const pick = key => (hasKey(key) ? key : null);
  if (y >= g.by0 - 2 && y <= g.by0 + g.barH + 2 && x >= g.barX - HIT && x <= g.labelR) {
    if (x > g.barX + g.barW + HIT) { const lab = labels.find(l => x >= l.x0 && x <= l.x1 && y >= l.y0 && y <= l.y1); return lab ? pick(`s:${lab.id}`) : null; }
    const c = (y - g.by0) / g.u;
    for (const [id, seg] of curSeg) if (seg[1] - seg[0] > 0.001 && c >= seg[0] && c < seg[1]) return pick(`s:${id}`);
    return null;
  }
  const i = stage.index;
  if (i < 1 || x < g.x0 + g.step / 2 || x > xOf(i) + g.step / 2) return null;
  const k = clamp(Math.round((x - g.x0) / g.step), 1, i);
  if (y >= g.base - g.up - HIT && y <= g.base + g.down + HIT) {
    if (Math.abs(x - xOf(k)) > 4 + HIT * 0.6) return null;
    const first = y < g.base ? 'w' : 'h', other = first === 'w' ? 'h' : 'w';
    return pick(`y:${k}:${first}`) || (Math.abs(y - g.base) <= 4 ? pick(`y:${k}:${other}`) : null);
  }
  if (y >= g.by0 - 6 && y <= g.by0 + g.barH + 6) return pick(`r:${k}`);
  return null;
}
function rectOf(key) {
  const p = parseKey(key), g = geo;
  if (!p || !g) return null;
  if (p.kind === 'seg') { const seg = curSeg.get(p.id); if (!seg) return null; return { x0: g.barX, x1: g.barX + g.barW, y0: cellY(seg[0]), y1: cellY(seg[1]) }; }
  if (p.kind === 'round') { const x = xOf(p.k), y = yOf(rows[p.k].d); return { x0: x - 4, x1: x + 4, y0: y - 4, y1: y + 4 }; }
  const n = rows[p.k].resp[p.side].length * g.kr, x = xOf(p.k);
  return p.s === 'w' ? { x0: x - 4, x1: x + 4, y0: g.base - n, y1: g.base } : { x0: x - 4, x1: x + 4, y0: g.base, y1: g.base + n };
}
const centreOf = key => { const r = rectOf(key); return r ? { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 } : null; };
// Where a segment's leader leaves from: just after its name beside the bar, or the bar's edge when the name is not drawn.
const segAnchor = (id, r) => { const lab = labels.find(l => l.id === id); return lab ? { x: lab.x1 + 2, y: (lab.y0 + lab.y1) / 2 } : { x: r.x1 + 2, y: (r.y0 + r.y1) / 2 }; };
/** A name (item id, short name, 留白, or a key) → key, preferring what is on the bar now. */
function keyFor(name) {
  if (name == null) return null;
  if (parseKey(name)) return String(name);
  if (name === '留白' || name === 'free') return 's:free';
  const r = rows[stage.index];
  if (r.shares.has(name)) return `s:${name}`;
  const id = [...r.shares.keys()].find(x => shortOf(x) === name) || ORDER.find(x => shortOf(x) === name);
  return id ? `s:${id}` : null;
}
const bounds = () => ({ x0: 8, y0: 8, x1: geo.W - 8, y1: geo.H - 8 });
function peekPlace(key, w, h) {
  const p = parseKey(key), g = geo, r = rectOf(key), B = bounds();
  if (p.kind === 'seg') {
    const a = segAnchor(p.id, r), y = clamp(a.y - Math.min(h / 2, 30), B.y0, B.y1 - h);
    return { x: g.labelR + 14, y, from: { x: a.x, y: clamp(a.y, y + 6, y + h - 6) } };
  }
  if (p.kind === 'round') {
    const c = centreOf(key), right = c.x + 18 + w <= B.x1;
    return { x: right ? c.x + 18 : c.x - 18 - w, y: clamp(c.y - h / 2, B.y0, B.y1 - h), from: c };
  }
  const c = centreOf(key);
  return { x: clamp(c.x - w / 2, B.x0, B.x1 - w), y: Math.max(B.y0, g.base - g.up - 12 - h), from: { x: c.x, y: p.s === 'w' ? r.y0 : g.base } };
}
function detailPlace(key, el) {
  const p = parseKey(key), g = geo, r = rectOf(key), B = bounds();
  const w = 304;
  el.style.width = `${w}px`;
  el.style.maxHeight = `${B.y1 - B.y0}px`;
  const natural = el.offsetHeight;
  if (p.kind === 'seg') {
    const a = segAnchor(p.id, r), ay = a.y, h = Math.min(natural, B.y1 - B.y0);
    let y = clamp(ay - 44, B.y0, B.y1 - h);
    y = clamp(Math.min(y, ay - 12), B.y0, B.y1 - h);
    if (ay > y + h - 12) y = clamp(ay - h + 12, B.y0, B.y1 - h);
    const x = g.labelR + 22;
    el.style.maxHeight = `${h}px`;
    return { x, y, w, h, path: [{ x: a.x + IX.pop, y: ay }, { x, y: clamp(ay, y + 1, y + h - 1) }] };
  }
  if (p.kind === 'round') {
    const c = centreOf(key), dir = rows[p.k].d >= 0 ? 1 : -1, py = c.y + dir * IX.pop, right = c.x + 26 + w <= B.x1;
    const x = right ? c.x + 26 : c.x - 26 - w, h = Math.min(natural, B.y1 - B.y0);
    const y = clamp(py - h * 0.3, B.y0, B.y1 - h);
    el.style.maxHeight = `${h}px`;
    return { x, y, w, h, path: [{ x: c.x, y: py }, { x: right ? x : x + w, y: clamp(py, y + 1, y + h - 1) }] };
  }
  const c = centreOf(key), tip = p.s === 'w' ? r.y0 - IX.pop : g.base;
  const h = Math.min(natural, Math.max(140, g.base - g.up - 20 - B.y0));
  const x = clamp(c.x - w / 2, B.x0, B.x1 - w), y = Math.max(B.y0, g.base - g.up - 16 - h);
  el.style.maxHeight = `${h}px`;
  return { x, y, w, h, path: [{ x: c.x, y: tip }, { x: c.x, y: y + h }] };
}

let ix = null;
let X = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
ix = createIx({
  stage: figure, keysIn: figure,
  facts: key => factsOf(key), has: hasKey, hit: hitAt, named: name => keyFor(name),
  pointOf: centreOf, index: () => stage.index * 2 + (vis.settled ? 0 : 1),
  pause: () => { if (hold.at == null) hold.at = now(); }, resume: () => { hold.at = null; }, paused: () => hold.at != null,
  last: LAST, answerHref: () => answerLink(stage.index),
  seen: () => ({ inputs: true, share: vis.settled, asks: vis.settled }),
  peekPlace, detailPlace, peekHTML: (f, o) => peekCard(f, o), detailHTML: (f, o) => detailCard(f, o),
  skip: '.t-hero',
  label: '拔河：条上的事项、曲线上的每一轮与你的回应柱。Tab 逐个看概要，↑/↓ 在条上换一件，Enter 展开详情，Esc 收回',
});

// ---------- the cards ----------
const factCache = new Map();
function factsOf(key) {
  const ck = `${stage.index}:${vis.settled ? 1 : 0}:${key}`;
  if (factCache.has(ck)) return factCache.get(ck);
  const p = parseKey(key), i = stage.index;
  let f;
  if (p.kind === 'seg') {
    const id = p.id, r = rows[i], before = i ? rows[i - 1] : null;
    const share = id === 'free' ? r.F : r.shares.get(id) || 0, was = id === 'free' ? before?.F ?? 64 : before?.shares.get(id) || 0;
    const mine = [];
    for (let k = 1; k <= i; k += 1) for (const side of ['work', 'home']) for (const x of rows[k].resp[side]) if (x.item === id) mine.push(x);
    f = { key, kind: 'seg', i, id, short: id === 'free' ? '留白' : shortOf(id), side: id === 'free' ? null : sideOf(id), share, was,
      title: id === 'free' ? '' : titleAt(id, i), why: id === 'free' ? '' : whyText(id), mine, summary: id === 'free' ? '没有分配出去的份额，在条的中间；工作与家里谁涨，它就先被吃掉。' : records[i].snapshot.items[id]?.summary || '',
      asks: id === 'free' ? [] : [...askLife[i].open.values()].filter(a => rootOf(a.item) === id), trend: rows.map(x => (id === 'free' ? x.F : x.shares.get(id) || 0)) };
  } else if (p.kind === 'round') {
    const r = rows[p.k], b = rows[p.k - 1];
    f = { key, kind: 'round', i: p.k, short: `${frames[p.k].id} 这一轮`, r, b, when: `${dayTime(frames[p.k].at)} · ${frames[p.k].id}` };
  } else {
    const r = rows[p.k];
    f = { key, kind: 'resp', i: p.k, short: `${frames[p.k].id} 你在${SIDE_WORD[p.side]}上`, side: p.side, list: r.resp[p.side], when: `${dayTime(frames[p.k].at)} · ${frames[p.k].id}` };
  }
  factCache.set(ck, f);
  return f;
}
const askRow = a => `<div class="ix-ask"><i></i><span>${esc(askShort(a))}</span>${dueOf(a) ? `<small>${esc(dueOf(a))}</small>` : ''}</div>`;
const leadWord = r => (r.d > 0 ? `家里领先 ${r.d}` : r.d < 0 ? `工作领先 ${-r.d}` : '持平');
const moversText = (r, n = 2) => r.moves.slice(0, n).map(m => `${shortOf(m.id)} ${signed(m.n)}`).join(' · ');
function peekCard(f, { seen }) {
  if (f.kind === 'seg') {
    const unsettled = !seen.share;
    const change = unsettled ? '本轮还没落定' : f.i ? `这一轮 ${f.was} → ${f.share}（${signed(f.share - f.was)}）` : '';
    return `<div class="ix-k">${f.side ? `${SIDE_WORD[f.side]} · ` : ''}${esc(frames[f.i].id)}</div><div class="ix-q">${esc(f.short)} · ${unsettled ? f.was : f.share} 份</div>
      ${f.title ? `<div class="ix-d t-pk-title">${esc(f.title)}</div>` : ''}${change ? `<div class="ix-d">${esc(change)}</div>` : ''}
      ${f.why ? `<div class="ix-d">${esc(f.why)}</div>` : ''}${f.side ? `<div class="ix-d t-pk-you"><i></i>到此刻你在它上面动手 ${f.mine.length} 次</div>` : ''}
      ${f.asks.map(askRow).join('')}`;
  }
  if (f.kind === 'round') {
    const { r, b } = f;
    return `<div class="ix-k">${esc(f.when)}</div><div class="ix-q">家里 ${r.H} : 工作 ${r.W}<small> · 留白 ${r.F}</small></div>
      <div class="ix-d">${esc(leadWord(r))}${r.swing ? ` · 差距${r.swing > 0 ? '向家里' : '向工作'} ${Math.abs(r.swing)}（${b.H} : ${b.W} →）` : ' · 差距没变'}</div>
      ${r.moves.length ? `<div class="ix-d">${esc(moversText(r, 3))}</div>` : ''}
      <div class="ix-d t-pk-you"><i></i>你动手：工作 ${r.nw} · 家里 ${r.nh}${against(r) ? '，和份额领先的一边相反' : ''}</div>`;
  }
  const lines = foldSentences(f.list);
  return `<div class="ix-k">${esc(f.when)}</div><div class="ix-q">你在${SIDE_WORD[f.side]}上动手 ${f.list.length} 次</div>
    ${lines.slice(0, 4).map(x => `<div class="ix-d t-pk-you"><i></i>${esc(x.label)}</div>`).join('')}${lines.length > 4 ? `<div class="ix-d">另有 ${lines.length - 4} 种动作</div>` : ''}`;
}
function askStatus(a, from, href) {
  const c = closeOf(a.id, askFirst.get(a.id)?.k ?? from, stage.index);
  if (!c && askLife[stage.index].open.has(a.id)) return `<div class="ix-d-ask"><i></i><p>${esc(a.prompt)}</p><small>${esc(dueOf(a) || '没有期限')}</small><a href="${esc(href)}">去回答 →</a></div>`;
  return `<div class="ix-d-ask is-closed"><i></i><p>${esc(a.prompt)}</p><small>${esc(c ? closedWords(a, c) : '此刻已不在登记中')}</small></div>`;
}
function detailCard(f, { seen, href }) {
  const close = '<button type="button" data-x="close" aria-label="收回（Esc）" title="收回（Esc）">×</button>';
  if (f.kind === 'seg') {
    const unsettled = !seen.share, W = 300, H = 32, top = Math.max(24, ...f.trend), bw = W / Math.max(1, LAST);
    const bars = f.trend.slice(1).map((s, k) => { const h = s ? Math.max(1.5, (s / top) * (H - 2)) : 1; return `<rect x="${(k * bw + bw * 0.15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" class="${k + 1 === f.i ? 'is-now' : k + 1 > f.i ? 'is-later' : s ? '' : 'is-off'}"/>`; }).join('');
    const mine = foldSentences(f.mine.slice(-12));
    return `<div class="ix-d-k"><span>${f.side ? `${SIDE_WORD[f.side]} · ` : ''}${esc(dayTime(frames[f.i].at))} · ${esc(frames[f.i].id)}</span>${close}</div>
      <div class="ix-d-t">${esc(f.short)} ${unsettled ? `${f.was} → …` : `${f.share} 份`}</div>${f.title ? `<div class="ix-d-s">${esc(f.title)}</div>` : ''}
      ${f.why ? `<div class="ix-d-s">归在${SIDE_WORD[f.side]}：${esc(f.why)}</div>` : ''}
      <section><h5>份额 · 逐轮<b>${esc(frames[f.i].id)} ${unsettled ? f.was : f.share} 份</b></h5><svg class="ix-trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg><div class="ix-axis"><span>${esc(frames[1]?.id || '')}</span><span>${esc(frames[LAST].id)}</span></div></section>
      ${f.side ? `<section><h5>你在它上面动手<b>到此刻 ${f.mine.length} 次</b></h5>${mine.length ? `<ul class="ix-d-fb t-fb">${mine.slice(-4).map(x => `<li><time>${esc(frames[x.first.frame].id)}</time>${esc(x.label)}</li>`).join('')}</ul>` : '<p class="ix-none">到这一轮还没有你的动作</p>'}</section>` : ''}
      ${f.side ? `<section><h5>开着的问题<b>此刻 ${esc(frames[stage.index].id)}</b></h5>${f.asks.length ? f.asks.slice(0, 3).map(a => askStatus(a, f.i, href)).join('') : '<p class="ix-none">没有开着的问题</p>'}</section>` : ''}
      ${f.summary ? `<p class="ix-d-sum">${esc(f.summary)}</p>` : ''}`;
  }
  if (f.kind === 'round') {
    const { r, b } = f;
    const side = s => r.moves.filter(m => m.side === s).slice(0, 5).map(m => `<li><span>${esc(shortOf(m.id))}</span><b>${m.before} → ${m.after}</b></li>`).join('');
    const said = foldSentences([...r.resp.work, ...r.resp.home]);
    const asks = [...new Map([...askLife[f.i].fresh, ...askLife[f.i].answered, ...askLife[f.i].lapsed].map(a => [a.id, a])).values()];
    return `<div class="ix-d-k"><span>${esc(f.when)}</span>${close}</div>
      <div class="ix-d-t">家里 ${r.H} : 工作 ${r.W}</div><div class="ix-d-s">留白 ${r.F} · ${esc(leadWord(r))}${r.swing ? ` · 差距${r.swing > 0 ? '向家里' : '向工作'}移了 ${Math.abs(r.swing)}（上一轮 ${b.H} : ${b.W}）` : ''}${r.flips ? ` · 换手 ${r.flips} 格` : ''}</div>
      ${side('home') ? `<section><h5>家里<b>${signed(r.H - b.H)}</b></h5><ul class="ix-d-kids">${side('home')}</ul></section>` : ''}
      ${side('work') ? `<section><h5>工作<b>${signed(r.W - b.W)}</b></h5><ul class="ix-d-kids">${side('work')}</ul></section>` : ''}
      <section><h5>这一轮你的回应<b>工作 ${r.nw} · 家里 ${r.nh}</b></h5>${said.length ? `<ul class="ix-d-fb t-fb">${said.slice(0, 5).map(x => `<li><time>${esc(SIDE_WORD[sideOf(x.first.link.target)])}</time>${esc(x.label)}</li>`).join('')}</ul>${said.length > 5 ? `<p class="ix-none">另有 ${said.length - 5} 种动作</p>` : ''}` : '<p class="ix-none">这一轮没有挂到事项上的动作</p>'}</section>
      ${asks.length ? `<section><h5>这一轮登记或关上的问题</h5>${asks.slice(0, 3).map(a => askStatus(a, f.i, href)).join('')}</section>` : ''}`;
  }
  const lines = foldSentences(f.list);
  const asks = [...new Map(f.list.filter(x => x.link.ask).map(x => [x.link.ask, askById(x.link.ask)])).values()].filter(Boolean);
  return `<div class="ix-d-k"><span>${esc(f.when)}</span>${close}</div>
    <div class="ix-d-t">你在${SIDE_WORD[f.side]}上动手 ${f.list.length} 次</div>
    <section><h5>你的动作<b>${lines.length} 种</b></h5><ul class="ix-d-fb t-fb">${lines.map(x => `<li><time>${esc(timeOf(x.first.event.at))}</time>${esc(x.label)}${x.item ? `<small> · ${esc(shortOf(rootOf(x.item)))}</small>` : ''}</li>`).join('')}</ul></section>
    ${asks.length ? `<section><h5>答的是登记的问题</h5>${asks.slice(0, 3).map(a => askStatus(a, f.i, href)).join('')}</section>` : ''}`;
}

// ---------- side panel: “这一件” ----------
let panelKey = null;
function panelFor(view) {
  return i => {
    if (view.kind === 'seg') {
      const id = view.id;
      if (id === 'free') return { kicker: `这一件 · 留白 · ${frames[view.i].id}`, title: `留白 ${rows[i].F} / 64`, body: `<p>${esc(view.summary)}</p><section><h4>逐轮</h4><p class="t-series">${rows.slice(1).map(r => `<span class="${r.i === i ? 'is-now' : r.i > i ? 'is-later' : ''}">${r.F}</span>`).join(' ')}</p></section>` };
      const mine = [];
      for (let k = 1; k <= i; k += 1) for (const side of ['work', 'home']) for (const x of rows[k].resp[side]) if (x.item === id) mine.push(x);
      const asks = asksOfItem(id, i);
      const byRound = new Map();
      for (const x of mine) { if (!byRound.has(x.frame)) byRound.set(x.frame, []); byRound.get(x.frame).push(x); }
      return {
        kicker: `这一件 · ${SIDE_WORD[sideOf(id)]} · ${frames[view.i].id}`,
        title: esc(titleAt(id, i)),
        body: `<p class="t-ov-move">${esc(shortOf(id))} 此刻 ${rows[i].shares.get(id) || 0} / 64 份${records[i].snapshot.items[id] ? ` · ${esc(kindWord(records[i].snapshot.items[id]))}` : ''}</p>
          <section><h4>归在${SIDE_WORD[sideOf(id)]}</h4><p>${esc(whyText(id))}；得票最多的是工作流就算工作，其余都算家里，两周不变。</p></section>
          <section><h4>份额 · 逐轮</h4><p class="t-series">${rows.slice(1).map(r => `<span class="${r.i === i ? 'is-now' : r.i > i ? 'is-later' : ''}">${r.shares.get(id) || 0}</span>`).join(' ')}</p></section>
          <section><h4>你在它上面动手 <small>到此刻 ${mine.length} 次</small></h4>${byRound.size ? `<ul class="t-trail">${[...byRound].slice(-10).map(([k, list]) => `<li><button type="button" data-st="go" data-frame="${k}">${esc(frames[k].id)}</button><span>${foldSentences(list).map(x => esc(x.label)).join('；')}</span></li>`).join('')}</ul>` : '<p class="st-muted">到这一轮还没有你的动作。</p>'}</section>
          ${asks.length ? `<section><h4>登记过的问题 <small>${asks.length} 个</small></h4><ul class="t-asks">${asks.map(({ k, a }) => { const open = askLife[i].open.has(a.id), c = open ? null : closeOf(a.id, k, i); return `<li${open ? ' class="is-open"' : ''}><b>${open ? '开着' : c?.how === 'answered' ? '答掉' : '失效'}</b><span>${esc(askShort(a))}</span>${open ? `<a href="${esc(answerLink(i))}">去回答 →</a>` : c ? `<small>${esc(closedWords(a, c))}</small>` : ''}</li>`; }).join('')}</ul></section>` : ''}
          <details class="t-more"><summary>摘要、依据、来源与版本</summary>${itemDetailHTML(id, i)}</details>`,
      };
    }
    if (view.kind === 'round') return { ...overviewHTML(view.i), kicker: `这一件 · 一轮 · ${frames[view.i].id}` };
    const lines = foldSentences(view.list);
    return {
      kicker: `这一件 · 你的回应 · ${frames[view.i].id} · ${SIDE_WORD[view.side]}`, title: `你在${SIDE_WORD[view.side]}上动手 ${view.list.length} 次`,
      body: `<ul class="t-trail">${lines.map(x => `<li><time>${esc(timeOf(x.first.event.at))}</time><span>${esc(x.label)}${x.item ? ` · ${esc(shortOf(rootOf(x.item)))}` : ` · ${esc(shortOf(rootOf(x.first.link.target)))}`}${x.first.link.ask ? '（答登记的问题）' : ''}</span></li>`).join('')}</ul>
        <p class="st-muted">一条反馈链接算一次，归到它指向的那件事所在的一边。次数不等于用力：一条评论是一次，一通电话也是一次。</p>`,
    };
  };
}
function openPanel(view) {
  panelKey = view.key;
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
  if (X.detail && ix.view && panelKey !== ix.view.key) openPanel(ix.view);
  else if (!X.detail && panelKey) closePanel();
}

// ---------- focus: dim, light and pop, from ix.frame() ----------
let litKey, popEl = [];
const lit = new Set();
function applyLight(key) {
  for (const el of lit) el.classList.remove('is-lit');
  lit.clear();
  els.band.toggleAttribute('hidden', true);
  setHidden(els.pt, true, 'pt');
  if (!key) return;
  const p = parseKey(key), add = el => { if (el) { el.classList.add('is-lit'); lit.add(el); } };
  if (p.kind === 'seg') {
    add(els.seg.get(p.id)); add(els.lab.get(p.id));
    for (const el of figure.querySelectorAll(`.t-part[data-item="${CSS.escape(p.id)}"]`)) add(el);
  } else if (p.kind === 'round') {
    for (const el of els.col.get(p.k)?.querySelectorAll('.t-part') || []) add(el);
    add(els.notch.get(p.k)); add(els.ann.get(p.k));
    els.band.setAttribute('x', f1(xOf(p.k) - geo.step / 2)); els.band.toggleAttribute('hidden', false);
  } else {
    for (const el of els.col.get(p.k)?.querySelectorAll(`.t-part[data-id="${CSS.escape(key)}"]`) || []) add(el);
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
  if (op !== opShown) { opShown = op; figure.style.setProperty('--t-op', op); }
  figure.classList.toggle('is-focus', Boolean(focus));
  // The step-out, each along its own geometry: a segment to the right, a point away from the even line, a column outward.
  for (const el of popEl) el.style.transform = '';
  popEl = [];
  const p = focus ? parseKey(focus) : null;
  if (p?.kind === 'round' && hasKey(focus)) {
    const c = centreOf(focus), dir = rows[p.k].d >= 0 ? 1 : -1, pop = X.popId === focus ? X.pop : 0;
    els.pt.setAttribute('cx', f1(c.x)); els.pt.setAttribute('cy', f1(c.y + dir * IX.pop * pop));
    setHidden(els.pt, false, 'pt');
  }
  const q = X.popId && X.pop > 0.001 ? parseKey(X.popId) : null;
  if (q?.kind === 'seg') {
    for (const el of [els.seg.get(q.id), els.lab.get(q.id)]) if (el) { el.style.transform = `translateX(${(IX.pop * X.pop).toFixed(2)}px)`; popEl.push(el); }
  } else if (q?.kind === 'resp') {
    for (const el of els.col.get(q.k)?.querySelectorAll(`.t-part[data-id="${CSS.escape(X.popId)}"]`) || []) { el.style.transform = `translateY(${((q.s === 'w' ? -1 : 1) * IX.pop * X.pop).toFixed(2)}px)`; popEl.push(el); }
  }
}
// Keyboard proxies: the bar from top to bottom, then this round and your columns, then earlier rounds back to the first.
const segLabel = id => (id === 'free' ? `留白 ${rows[stage.index].F} 份` : `${SIDE_WORD[sideOf(id)]} · ${shortOf(id)} ${rows[stage.index].shares.get(id) || 0} 份`);
function proxyList() {
  const out = [];
  const segs = [...curSeg].filter(([, s]) => (s[1] - s[0]) * geo.u >= 1.5).sort((a, b) => a[1][0] - b[1][0]);
  for (const [id] of segs) out.push({ id: `s:${id}`, label: segLabel(id) });
  for (let k = stage.index; k >= 1; k -= 1) {
    const r = rows[k];
    if (hasKey(`r:${k}`)) out.push({ id: `r:${k}`, label: `${dayTime(frames[k].at)} · 家里 ${r.H} : 工作 ${r.W}` });
    for (const s of ['w', 'h']) if (hasKey(`y:${k}:${s}`)) out.push({ id: `y:${k}:${s}`, label: `${dayTime(frames[k].at)} · 你在${s === 'w' ? '工作' : '家里'}上动手 ${r.resp[s === 'w' ? 'work' : 'home'].length} 次` });
  }
  return out;
}
const proxyKey = () => `${stage.index}|${vis.settled ? 1 : 0}|${vis.g >= 0.5 ? 1 : 0}`;
stage.onKey = event => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
  const cur = document.activeElement?.dataset?.ix, p = cur && parseKey(cur);
  if (!p || p.kind !== 'seg') return false;
  const list = proxyList().filter(x => x.id.startsWith('s:'));
  const k = list.findIndex(x => x.id === cur) + (event.key === 'ArrowUp' ? -1 : 1);
  const target = list[clamp(k, 0, list.length - 1)];
  figure.querySelector(`.ix-sr [data-ix="${CSS.escape(target.id)}"]`)?.focus({ preventScroll: true });
  return true;
};
// The side panel's names open that segment of the bar; the tell button tells or skips.
document.querySelector('.st-side').addEventListener('click', event => {
  const b = event.target.closest('[data-t-pin]');
  if (b && hasKey(`s:${b.dataset.tPin}`)) ix.open(`s:${b.dataset.tPin}`);
});
document.querySelector('.st-tools').addEventListener('click', event => {
  if (!event.target.closest('[data-t="tell"]')) return;
  if (run.kind === 'tell') skipTell(); else startTell();
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
  paint();
  paintCells(1 - 0.6 * X.dim);
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
// Hooks with the same names and meanings as foldYield (ix.mjs), by item id or short name: open('主水管').
window.foldTug = {
  ...ix.hooks(),
  hover: name => ix.hover(keyFor(name), 'pointer'),
  open: name => ix.open(keyFor(name)),
  pointOf: name => { const c = centreOf(keyFor(name)); if (!c) return null; const b = figure.getBoundingClientRect(); return { x: b.left + c.x, y: b.top + c.y }; },
  /** A point `d` px left of the bar, level with the segment (inside the widened hit band). */
  nearOf: (name, d = 9) => { const r = rectOf(keyFor(name)), b = figure.getBoundingClientRect(); if (!r) return null; return { x: b.left + r.x0 - d, y: b.top + (r.y0 + r.y1) / 2 }; },
  /** The largest segment on the bar now (its short name when that is unique there, else its id). */
  pick: () => {
    const r = rows[stage.index], [id] = [...r.shares].sort((a, b) => b[1] - a[1])[0] || ['free'];
    return id === 'free' ? '留白' : [...r.shares.keys()].filter(x => shortOf(x) === shortOf(id)).length === 1 ? shortOf(id) : id;
  },
  tell: startTell, skip: skipTell, tellAt, play: startPlay, stop: stopRun, length: tellLength,
  telling: () => run.kind === 'tell', playing: () => run.kind === 'play',
  settled: () => !post || post.t >= post.T.resp1, phase: () => (post ? { i: post.i, from: post.from, mode: post.mode, t: +post.t.toFixed(3) } : null),
  rows, plan, sideOf, extreme, mismatch, swings: [...swings],
  perf: () => {
    const ts = perf.times.slice(1), avg = ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length), work = perf.work.slice(1);
    return { frames: ts.length, fps: +(1 / avg).toFixed(1), p95ms: +(p95(ts) * 1000).toFixed(1), workMs: +(work.reduce((a, b) => a + b, 0) / Math.max(1, work.length)).toFixed(2), workP95ms: +p95(work).toFixed(2) };
  },
  resetPerf: () => { perf.on = true; perf.times = []; perf.work = []; },
};
