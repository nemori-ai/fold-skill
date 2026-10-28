// 驻龄（第四轮候选 03，完整版）：此刻的 64 份里，每一份已经在当前这件事上连续待了几轮。
// 8×8 方格，一格一份；格子两周不挪，只在份额真的易手时换主人。格里同心方框的圈数 = 这一份连续待了几轮（画到 12 圈），
// 从第一轮起一直在、又已超过 12 圈的涂实；同一件事的格垫一块浅底、格缝相连（它的地盘）；虚线格是留白。
// 只用墨黑一种颜色，圈数是唯一的变量。右栏按名次列每件事的格子年龄（老 → 新）。
//
// 动起来（polish/age-motion.md 第 3 节「故事」与第 4–6 节）：一轮三个动作。清出：变小的事交回最年轻的格，圈向中心收、
// 淡出，原位留一道灰框（概念层，0.5 秒散去）；加圈：留下的每一格在最里面多一圈；新框：认领空格的事画出最外一道框。
//   讲一遍：只在顶层直接打开、地址不带 ?frame=、也不是从别的页面链过来时演一次（composite 约 23 秒，停在 f26），
//     任意键跳过；工具栏的「▶ 讲一遍」可重演。带 ?frame=、嵌在画廊或合页里的一律静止在那一帧。
//   连播（空格）每轮 1.6 秒（半速）；←/→ 逐帧用 0.9 秒的短版；一次跳多帧与往回退直接到终态。
// 交互接共用模块 motion/ix.mjs：悬停出概要卡、这件事的地盘描边；点击沿“方阵中心 → 地盘重心”弹出 8 px，引线沿格缝
// 接详情卡，侧栏切到“这一件”。卡上的“去回答 →”只给此刻开着的问题，链到同一帧的 D。
// 只读回放：驻龄、格位与问题的开闭都现算，故事的帧号是本页常量，不改数据。
import {
  createStage, esc, frames, records, dayTime, shortOf, titleAt, responsesIn, askById, itemDetailHTML,
  kindWord, reduced, foldSentences, askLife, rootOf, responseSentence,
} from './stage.mjs';
import { personName } from './stage.mjs';
import { createIx, IX } from '../motion/ix.mjs';
import { dueText } from '../motion/dial-model.mjs';
import { withDataset, currentDataset } from '../../data/select.mjs';

const N = frames.length, LAST = N - 1, CAP = 12, SIDE = 8;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeIn = k => clamp(k) ** 2;
const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
const indexOfId = id => frames.findIndex(frame => frame.id === id);
// The sketch palette (sketches.css) in sRGB for the canvas.
const INK = '#1a251d', INK2 = '#555d56', INK3 = '#8e948d', PAPER = '#f8f7f2', FAINT = '#e8e8e2';

// ---------- the story: three beats per dataset (frame ids are page constants, not data) ----------
// Every round between `from` and `end` is told; a round not named here goes by at the time-lapse speed (0.32 s).
// composite：f01 半速，f02–f21 快放（f13 底层涂实多停 0.5 秒，f21 多停 0.6 秒）；f22 半速、f23 全速再停 0.8 秒；
//   f24、f25 半速，f26 全速再停 1.5 秒。story：cold-01 半速，快放到 f14（f11 涂实多停 0.5，f14 多停 0.6）；f15 全速再停
//   0.8 秒；f16–f18 半速；f19 全速再停 1.5 秒。
const PLAN = {
  composite: { from: 'f00', end: 'f26', beats: { f01: ['half'], f13: ['quick', 0.5], f21: ['quick', 0.6], f22: ['half'], f23: ['full', 0.8], f24: ['half'], f25: ['half'], f26: ['full', 1.5] } },
  story: { from: 'cold-00', end: 'f19', beats: { 'cold-01': ['half'], f11: ['quick', 0.5], f14: ['quick', 0.6], f15: ['full', 0.8], f16: ['half'], f17: ['half'], f18: ['half'], f19: ['full', 1.5] } },
};
const plan = (() => {
  const p = PLAN[currentDataset()];
  if (!p) return null;
  const from = indexOfId(p.from), end = indexOfId(p.end);
  if (from < 0 || end <= from) return null;
  const beats = [];
  for (let i = from + 1; i <= end; i += 1) { const [mode, extra = 0] = p.beats[frames[i].id] || ['quick']; beats.push({ i, mode, extra }); }
  return { from, end, beats };
})();
// Told only when opened on its own: top level, no ?frame=, and not followed from another page.
const params = new URLSearchParams(location.search);
const fromElsewhere = (() => { try { return Boolean(document.referrer) && new URL(document.referrer).pathname !== location.pathname; } catch { return false; } })();
const autoTell = Boolean(plan) && window.parent === window && !params.has('frame') && !fromElsewhere;
const homeFrame = plan ? plan.end : LAST;
if (!params.has('frame')) { params.set('frame', autoTell && !reduced() ? plan.from : homeFrame); history.replaceState(null, '', `?${params}`); }

// ---------- small glyphs: the same rings as the grid, for the key, the legend and the cards ----------
function glyph(n, size = 18, { solid = false, dashed = false } = {}) {
  const C = 72, step = (C / 2 - 7) / (CAP - 1);
  let body = '';
  if (dashed) body = `<rect x="3" y="3" width="${C - 6}" height="${C - 6}" fill="none" stroke="var(--ink-3)" stroke-dasharray="6 8" stroke-width="3"/>`;
  else if (solid) body = `<rect x="3" y="3" width="${C - 6}" height="${C - 6}" fill="var(--ink)"/>`;
  else for (let k = 0; k < Math.min(n, CAP); k += 1) { const o = 3 + k * step; body += `<rect x="${o.toFixed(1)}" y="${o.toFixed(1)}" width="${(C - 2 * o).toFixed(1)}" height="${(C - 2 * o).toFixed(1)}" fill="none" stroke="var(--ink)" stroke-width="${(72 / size * 0.8).toFixed(2)}"/>`; }
  return `<svg class="ag-glyph" width="${size}" height="${size}" viewBox="0 0 ${C} ${C}" aria-hidden="true">${body}</svg>`;
}

const key = `
  <span>${glyph(1, 16)}新给：一道外框</span>
  <span>${glyph(5, 16)}圈数 = 这一份在这件事上连续待了几轮（画到 12 圈）</span>
  <span>${glyph(0, 16, { solid: true })}实心：从第一轮起一直在</span>
  <span>${glyph(0, 16, { dashed: true })}虚线：留白</span>
  <span><i class="ag-key-ground"></i>浅底连成一块 = 同一件事的地盘；格子不动，易手才换主人</span>
  <span><i class="ag-key-ghost"></i>清出的格留一道灰框，随即散去</span>
  <span class="note"><kbd>←</kbd><kbd>→</kbd> 逐帧 <kbd>空格</kbd> 连播 <kbd>Enter</kbd> 展开 <kbd>Esc</kbd> 收回</span>`;
const stage = createStage({
  id: 'age', no: 8, name: '驻龄', storyIndex: homeFrame, key,
  relation: '此刻的 64 份里，每一份已经在当前这件事上连续待了几轮：多少是沉淀的，多少是刚换手的。',
  tools: plan ? '<button type="button" class="ag-tell" data-a="tell" title="从头讲一遍（任意键跳过）">▶ 讲一遍</button>' : '',
});
document.querySelector('.st-kicker').textContent = 'FOLD · 第四轮 · 关系的画法 · 完整版';
const figure = stage.figure;

// ---------- data: shares per frame, and where each share sits ----------
const shareMaps = frames.map((_, i) => new Map(records[i].state.root.items.map(item => [item.id, item.share])));
const rankOf = frames.map((_, i) => records[i].state.root.items.map(item => item.id));
const usedAt = i => records[i].state.root.used;
const sh = (i, id) => (i >= 0 ? shareMaps[i].get(id) || 0 : 0);
const NB = Array.from({ length: 64 }, (_, c) => {
  const x = c % SIDE, y = (c - x) / SIDE;
  return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && a < SIDE && b >= 0 && b < SIDE).map(([a, b]) => b * SIDE + a);
});
const manhattan = (a, b) => Math.abs((a % SIDE) - (b % SIDE)) + Math.abs(Math.floor(a / SIDE) - Math.floor(b / SIDE));
const cellsWith = (owner, id) => { const out = []; for (let c = 0; c < 64; c += 1) if (owner[c] === id) out.push(c); return out; };
/** Items merged this round, and what they merged into (the replay records it; the shares do not carry over). */
function mergedInto(i) {
  const out = new Map();
  for (const item of Object.values(records[i].snapshot.items)) {
    if (item.status === 'merged' && item.merged_into && records[i - 1]?.snapshot.items[item.id]?.status === 'active') out.set(item.id, item.merged_into);
  }
  return out;
}
// The slot model (age-motion.md 第 2 节): 64 fixed cells. A shrinking item hands back its youngest cells (a stack, which is
// exactly the “minimum share over the last k rounds” rule); kept cells age by one; a growing item claims free cells next
// to its own, nearest first. Where a new share lands is the drawing's choice, not a record of who gave to whom.
const slots = (() => {
  const owner = Array(64).fill(null), age = Array(64).fill(0);
  const out = [{ owner: [...owner], age: [...age], cleared: [], claimed: [] }];
  for (let i = 1; i < N; i += 1) {
    const cleared = [], claimed = [];
    const ids = [...new Set([...rankOf[i - 1], ...shareMaps[i - 1].keys(), ...shareMaps[i].keys()])];
    for (const id of ids) {
      let k = sh(i - 1, id) - sh(i, id);
      while (k > 0) {
        const live = cellsWith(owner, id);
        if (!live.length) break;
        const top = Math.max(...live.map(c => age[c]));
        const core = live.filter(c => age[c] === top);
        const own = c => NB[c].filter(n => owner[n] === id).length;
        const far = c => Math.min(...core.map(o => manhattan(c, o)));
        live.sort((a, b) => age[a] - age[b] || own(a) - own(b) || far(b) - far(a) || b - a);
        const c = live[0];
        cleared.push({ c, id, age: age[c] });
        owner[c] = null; age[c] = 0; k -= 1;
      }
    }
    for (let c = 0; c < 64; c += 1) if (owner[c]) age[c] += 1;
    const merges = mergedInto(i);
    for (const id of rankOf[i]) {
      let k = sh(i, id) - sh(i - 1, id);
      const sources = new Set([...merges].filter(([, to]) => to === id).map(([from]) => from));
      while (k > 0) {
        const free = [];
        for (let c = 0; c < 64; c += 1) if (!owner[c]) free.push(c);
        if (!free.length) break;
        const mine = cellsWith(owner, id);
        const room = c => NB[c].filter(n => !owner[n]).length;
        let best;
        if (!mine.length && i === 1) best = free[0];
        else if (mine.length) {
          const own = c => NB[c].filter(n => owner[n] === id).length;
          const dist = c => Math.min(...mine.map(m => manhattan(c, m)));
          best = free.sort((a, b) => own(b) - own(a) || dist(a) - dist(b) || room(b) - room(a) || a - b)[0];
        } else {
          const from = cleared.filter(x => sources.has(x.id) && !owner[x.c]).map(x => x.c);
          best = (from.length ? from : free).sort((a, b) => room(b) - room(a) || a - b)[0];
        }
        owner[best] = id; age[best] = 1; claimed.push({ c: best, id }); k -= 1;
      }
    }
    out.push({ owner: [...owner], age: [...age], cleared, claimed });
  }
  return out;
})();
/** Held since the first round, and past the twelve rings the cell can show. */
const isSolid = (i, c) => Boolean(i > CAP && slots[i].owner[c] && slots[i].age[c] === i);
/** Each item's ages at frame i, oldest first. */
const agesAt = slots.map(s => {
  const m = new Map();
  for (let c = 0; c < 64; c += 1) if (s.owner[c]) { if (!m.has(s.owner[c])) m.set(s.owner[c], []); m.get(s.owner[c]).push(s.age[c]); }
  for (const list of m.values()) list.sort((a, b) => b - a);
  return m;
});
const BUCKETS = [
  { key: 'a1', label: '1 轮', test: a => a === 1, n: 1 },
  { key: 'a2', label: '2–3 轮', test: a => a >= 2 && a <= 3, n: 3 },
  { key: 'a4', label: '4–6 轮', test: a => a >= 4 && a <= 6, n: 5 },
  { key: 'a7', label: '7–12 轮', test: a => a >= 7 && a <= CAP, n: 9 },
  { key: 'a13', label: '12 轮以上', test: a => a > CAP, n: CAP },
];
const rounds = frames.map((_, i) => {
  const s = slots[i], used = usedAt(i), blank0 = i ? 64 - usedAt(i - 1) : 64, blank1 = 64 - used;
  let since = 0, solid = 0;
  const hist = Object.fromEntries(BUCKETS.map(b => [b.key, 0]));
  for (let c = 0; c < 64; c += 1) {
    if (!s.owner[c]) continue;
    const a = s.age[c];
    if (i && a === i) since += 1;
    if (isSolid(i, c)) { solid += 1; continue; }
    const b = BUCKETS.find(x => x.test(a));
    if (b) hist[b.key] += 1;
  }
  const give = [], take = [];
  for (const id of new Set([...(i ? shareMaps[i - 1].keys() : []), ...shareMaps[i].keys()])) {
    const before = sh(i - 1, id), after = sh(i, id);
    if (after < before) {
      const gone = s.cleared.filter(x => x.id === id);
      give.push({ id, n: before - after, before, after, oldest: Math.max(0, ...gone.map(x => x.age)), bed: i > 1 ? gone.filter(x => x.age === i - 1).length : 0 });
    }
    if (after > before) take.push({ id, n: after - before, before, after });
  }
  const order = (a, b) => b.n - a.n || a.id.localeCompare(b.id);
  give.sort(order); take.sort(order);
  const oldest = Math.max(0, ...s.cleared.map(x => x.age));
  const lost = i > 1 ? s.cleared.filter(x => x.age === i - 1).length : 0;
  return { i, used, blank0, blank1, fresh: s.claimed.length, gaveN: s.cleared.length, kept: used - s.claimed.length, since, solid, hist, give, take, oldest, lost,
    capCross: i === CAP + 1 && since > 0, total: (agesAt[i] ? [...agesAt[i].values()].flat().reduce((x, y) => x + y, 0) : 0) };
});

// ---------- questions: open, closed this round, how they closed ----------
const answerOf = new Map();
frames.forEach((frame, i) => { for (const event of frame.events) for (const link of event.feedback || []) if (link.ask && !answerOf.has(link.ask)) answerOf.set(link.ask, { i, event, link }); });
const openAsks = (id, i) => (id === 'free' ? [] : [...askLife[i].open.values()].filter(a => rootOf(a.item) === id));
const askShort = a => a.short || a.prompt;
const dueOf = a => (a.due_at ? dueText(Date.parse(a.due_at)) : '');
const howAnswered = a => { const x = answerOf.get(a.id); return x ? responseSentence(x.event, x.link) : '你答了'; };
function howLapsed(a, i) {
  const root = rootOf(a.item);
  const d = (frames[i].batch?.declarations || []).find(x => x.id === a.item || x.id === root);
  const status = records[i].snapshot.items[root]?.status;
  const what = d?.kind === 'done' ? '改为已办' : d?.relation === 'withdraw' || status === 'withdrawn' ? '撤下' : status === 'merged' || d?.relation?.startsWith('merges:') ? '并入' : '改写';
  return `随改写失效：${shortOf(root)}${what}`;
}
const closedIn = (id, i) => ({ answered: askLife[i].answered.filter(a => rootOf(a.item) === id), lapsed: askLife[i].lapsed.filter(a => rootOf(a.item) === id) });
const answerLink = () => withDataset(`../../index.html?variant=d&frame=${stage.index}`);

// ---------- words ----------
const nameOf = id => (id === 'free' ? '留白' : shortOf(id));
const timeOf = at => dayTime(at).split(' ').pop();
/** "12 份 1 轮 · 6 份 2 轮"，oldest first; long lists keep the oldest and the newest. */
function histText(ages) {
  const groups = [];
  for (const a of ages) { const last = groups.at(-1); if (last && last.a === a) last.n += 1; else groups.push({ a, n: 1 }); }
  const word = g => `${g.n} 份 ${g.a} 轮`;
  return groups.length <= 4 ? groups.map(word).join(' · ') : `${groups.slice(0, 2).map(word).join(' · ')} · … · ${groups.slice(-2).map(word).join(' · ')}`;
}
function oldestText(i, ages, count = true) {
  const a = ages[0];
  if (!a) return '';
  const since = a === i ? `从第一轮（${dayTime(frames[1].at)}）起` : `${frames[i - a + 1].id}（${dayTime(frames[i - a + 1].at)}）起`;
  return count ? `${since}，${a} 轮` : `${since}，一直在这件事上`;
}
/** The short phrase beside an item's strip in the rank list. */
function whyOf(i, ages) {
  const fresh = ages.filter(a => a === 1).length, max = ages[0], min = ages.at(-1), first = ages.filter(a => a === i).length;
  if (fresh === ages.length) return ages.length === 1 ? '这一轮才给' : `${fresh} 份全是这一轮才给`;
  if (first && i > 1) return `${first} 份从第一轮起没挪过${fresh ? `，${fresh} 份这一轮才给` : ''}`;
  if (fresh) return `${fresh} 份这一轮才给，最久 ${max} 轮`;
  return min === max ? `已待 ${max} 轮` : `已待 ${min}–${max} 轮`;
}
/** The line above the grid: the round whose account the figure shows (while a round posts, still the one before). */
function captionOf(i) {
  if (i === 0) return '还没有整理过任何输入：64 格全是留白。';
  return `<span class="ag-cap-id">${esc(frames[i].id)}</span>${captionText(i)}`;
}
function captionText(i) {
  const r = rounds[i];
  if (i === 1) return `<b>第一轮</b>：${r.fresh} 份各画一道外框。`;
  const parts = [];
  parts.push(r.fresh ? `新给 <b>${r.fresh}</b> 格` : '没有新给');
  if (r.gaveN) parts.push(`清出 <b>${r.gaveN}</b> 格（最老待了 ${r.oldest} 轮${r.lost ? `，其中 ${r.lost} 格从第一轮起就在` : ''}）`);
  if (r.kept) parts.push(`留下的 ${r.kept} 格各多一圈`);
  if (r.capCross) parts.push(`从第一轮起没挪过的 <b>${r.since}</b> 份圈满 ${CAP} 圈，涂实`);
  return parts.join('；');
}

// ---------- layout ----------
let geo = null, canvas = null, ctx = null, dpr = 1;
const els = {};
function measure() {
  const W = figure.clientWidth, H = figure.clientHeight, G = 10, ML = 18, CAPH = 22, LEG = 58;
  const P = Math.max(36, Math.floor(Math.min((H - CAPH - LEG - 14) / SIDE, (W - ML - 340) / SIDE)));
  const C = P - G, S = SIDE * P - G, gx = ML, gy = CAPH + 12;
  return { W, H, G, P, C, S, gx, gy, listX: gx + S + 34, step: (C / 2 - 7) / (CAP - 1) };
}
const cellX = c => geo.gx + (c % SIDE) * geo.P;
const cellY = c => geo.gy + Math.floor(c / SIDE) * geo.P;
function render() {
  geo = measure();
  const g = geo;
  // ix keeps its cards, leaders and keyboard proxies in the figure; only the drawing is rebuilt.
  const kept = [...figure.querySelectorAll(':scope > .ix-leaders, :scope > .ix-peek, :scope > .ix-detail, :scope > .ix-sr')];
  figure.innerHTML = `<canvas class="ag-grid" aria-hidden="true"></canvas>
    <p class="ag-cap" style="left:${g.gx}px;width:${g.S}px"></p>
    <div class="ag-legend" style="left:${g.gx}px;top:${g.gy + g.S + 16}px;width:${g.S}px"></div>
    <div class="ag-list" style="left:${g.listX}px;top:${g.gy - 6}px;width:${g.W - g.listX}px;height:${g.H - g.gy + 6}px"></div>`;
  figure.append(...kept);
  const sr = kept.find(el => el.classList.contains('ix-sr'));
  if (sr) figure.prepend(sr);
  canvas = figure.querySelector('.ag-grid');
  dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(g.W * dpr); canvas.height = Math.round(g.H * dpr);
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  els.cap = figure.querySelector('.ag-cap'); els.legend = figure.querySelector('.ag-legend'); els.list = figure.querySelector('.ag-list');
  infoShown = -1;
  paintInfo(infoIndex());
  dirty = true;
  ix?.relayout();
}

// ---------- the clock: one round posted ----------
// Full speed 3.2 s (age-motion.md 第 3 节); half is every time × 0.5 (cells a little longer, so they still read); the
// time-lapse 0.32 s and the ←/→ short version 0.9 s are their own tables. Without cleared cells the first action is the
// rings, and everything after it moves up by 0.55 s (0.275 s at half); the round keeps its length.
const FULL = { clear0: 0.40, clearEnd: 0.85, cell: 0.24, ring0: 0.95, ringDur: 0.28, ringWave: 0.12, claim0: 1.50, claimEnd: 2.20, settle: 2.25, dur: 3.20, ghost: 0.50, count: true };
const QUICK = { clear0: 0, clearEnd: 0.10, cell: 0.08, ring0: 0.08, ringDur: 0.12, ringWave: 0.04, claim0: 0.13, claimEnd: 0.25, settle: 0.26, dur: 0.32, ghost: 0.12, count: false };
const SHORT = { clear0: 0.05, clearEnd: 0.29, cell: 0.18, ring0: 0.25, ringDur: 0.24, ringWave: 0.06, claim0: 0.45, claimEnd: 0.75, settle: 0.80, dur: 0.90, ghost: 0.30, count: false };
const DUR = { full: FULL.dur, half: FULL.dur / 2, quick: QUICK.dur, short: SHORT.dur };
function timing(mode, cleared) {
  if (mode === 'quick') return QUICK;
  if (mode === 'short') return SHORT;
  const s = mode === 'half' ? 0.5 : 1, lead = cleared ? 0 : FULL.ring0 - FULL.clear0;
  const T = { count: true };
  for (const [k, v] of Object.entries(FULL)) if (typeof v === 'number') T[k] = ['clear0', 'clearEnd', 'cell', 'ghost', 'dur', 'ringDur', 'ringWave'].includes(k) ? v * s : (v - lead) * s;
  if (s < 1) { T.cell = 0.14; T.ringDur = 0.18; }
  return T;
}
let post = null;              // the round being posted: {i, mode, T, t, extra, settled, cells, nc, nk, sc, sk}
let freeze = false;           // tellAt(): a still, until any control releases it
const hold = { at: null };    // ix pauses the clock while something is hovered or open
let driving = null;           // set while the page itself steps (telling, playing): {mode, extra}
const run = { kind: null, k: -1, wait: 0 };
let dirty = true;
const now = () => performance.now() / 1000;
/** How many of n events, starting `stagger` apart from t0, have happened by t. */
const countAt = (t, t0, stagger, n) => (t < t0 ? 0 : stagger > 0 ? Math.min(n, Math.floor((t - t0) / stagger + 1e-6) + 1) : n);
function planCells(i, T) {
  const prev = slots[i - 1], next = slots[i];
  const clearOrder = new Map(next.cleared.map((x, k) => [x.c, k])), claimOrder = new Map(next.claimed.map((x, k) => [x.c, k]));
  const nc = next.cleared.length, nk = next.claimed.length;
  const sc = nc > 1 ? Math.min(0.02, Math.max(0, T.clearEnd - T.clear0 - T.cell) / (nc - 1)) : 0;
  const sk = nk > 1 ? Math.min(0.025, Math.max(0, T.claimEnd - T.claim0 - T.cell) / (nk - 1)) : 0;
  const cells = Array.from({ length: 64 }, (_, c) => ({
    po: prev.owner[c], pa: prev.age[c], no: next.owner[c], na: next.age[c], pSolid: isSolid(i - 1, c), nSolid: isSolid(i, c),
    clearAt: clearOrder.has(c) ? T.clear0 + clearOrder.get(c) * sc : null,
    claimAt: claimOrder.has(c) ? T.claim0 + claimOrder.get(c) * sk : null,
    ringAt: T.ring0 + T.ringWave * (c / 63),
  }));
  return { cells, nc, nk, sc, sk };
}
function startPost(i, mode, extra = 0) {
  const T = timing(mode, slots[i].cleared.length > 0);
  post = { i, mode, T, t: 0, extra, settled: false, ...planCells(i, T) };
  if (reduced()) post.t = T.settle;
  dirty = true;
}
function settle(p) {
  p.settled = true;
  paintInfo(p.i);
  if (marks.on && plan && p.i === plan.end) marks.traced = true;
  dirty = true;
}
function finishPost() {
  if (!post) return;
  if (!post.settled) settle(post);
  post = null;
  dirty = true;
}

// ---------- frame changes ----------
let keyRepeat = false;
addEventListener('keydown', event => { keyRepeat = event.repeat; }, true);
addEventListener('keyup', () => { keyRepeat = false; }, true);
function update(next, previous, mode) {
  if (mode !== 'keep') finishPost();
  if (['full', 'half', 'quick', 'short'].includes(mode) && previous != null && next === previous + 1 && next > 0) startPost(next, mode, driving?.extra || 0);
  else paintInfo(next);
  dirty = true;
}
stage.onFrame((next, previous) => {
  if (!driving) {
    // Someone stepped: stop telling or playing, fold any card away at once, drop the told marks.
    stopRun(); freeze = false;
    if (ix) { ix.reset(); closePanel(); }
    clearMarks();
  }
  const mode = driving ? driving.mode : next === previous + 1 && !keyRepeat ? 'short' : 'snap';
  update(next, previous, mode);
});
/** The page steps itself (telling, playing): one round posted at a speed. */
function drive(i, mode, extra = 0) {
  driving = { mode, extra };
  try { if (i === stage.index) update(i, i, 'snap'); else stage.go(i); } finally { driving = null; }
}

// ---------- telling and playing ----------
function setRunUI() {
  document.body.classList.toggle('st-playing', run.kind === 'play');
  const b = document.querySelector('[data-a="tell"]');
  if (b) { b.textContent = run.kind === 'tell' ? '跳过 ▸▸' : '▶ 讲一遍'; b.setAttribute('aria-pressed', String(run.kind === 'tell')); }
}
function stopRun() { if (!run.kind) return; run.kind = null; setRunUI(); }
// The thing that took most in the story's last round (主水管, story 发布): outlined once the story is told.
const tracedItem = (() => {
  if (!plan) return null;
  const n = new Map();
  for (const x of slots[plan.end].claimed) n.set(x.id, (n.get(x.id) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
})();
const marks = { on: false, traced: false, sticky: false };
function clearMarks() { if (marks.on || marks.traced) dirty = true; Object.assign(marks, { on: false, traced: false, sticky: false }); }
function startTell() {
  if (!plan) return;
  freeze = false; stopRun(); ix?.reset(); closePanel(); clearMarks();
  drive(plan.from, 'snap');
  marks.on = true;
  Object.assign(run, { kind: 'tell', k: -1, wait: 0.4 });
  setRunUI();
}
/** Skip to the end of the story: its last frame settled, with the outline. */
function skipTell() {
  if (!plan) return;
  stopRun(); freeze = false;
  drive(plan.end, 'snap');
  Object.assign(marks, { on: true, traced: true, sticky: true });
  dirty = true;
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
const beatLen = b => DUR[b.mode] + b.extra;
const tellLength = plan ? 0.4 + plan.beats.reduce((s, b) => s + beatLen(b), 0) : 0;
/** A still of the story at `s` seconds (for stills and checks): released by any control. */
function tellAt(s) {
  if (!plan) return;
  stopRun(); ix?.reset(); closePanel(); clearMarks();
  drive(plan.from, 'snap');
  marks.on = true;
  let t = s - 0.4;
  for (const [k, b] of plan.beats.entries()) {
    const len = beatLen(b);
    if (t < len || k === plan.beats.length - 1) {
      if (t < 0) break;
      drive(b.i, b.mode, b.extra);
      post.t = Math.min(t, len);
      if (post.t >= post.T.settle && !post.settled) settle(post);
      break;
    }
    drive(b.i, 'snap');
    t -= len;
  }
  if (s >= tellLength) { finishPost(); marks.traced = true; marks.sticky = true; }
  freeze = true;
  dirty = true;
}
function tick(dt) {
  if (hold.at != null || freeze) return;
  if (post) {
    post.t += dt;
    if (!post.settled && post.t >= post.T.settle) settle(post);
    if (post.t >= post.T.dur + post.extra && !run.kind) { post = null; dirty = true; }
  }
  if (!run.kind || (post && post.t < post.T.dur + post.extra)) return;
  if (run.wait > 0) { run.wait -= dt; return; }
  if (run.kind === 'tell') {
    run.k += 1;
    const b = plan.beats[run.k];
    if (!b) { stopRun(); finishPost(); marks.sticky = true; return; }
    drive(b.i, b.mode, b.extra);
  } else {
    if (stage.index >= LAST) { stopRun(); finishPost(); return; }
    drive(stage.index + 1, 'half');
  }
}
addEventListener('keydown', event => {
  // Any key skips the story (Tab still moves focus); after it, the first key drops the told outline.
  if (run.kind === 'tell' && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key) && !event.metaKey && !event.ctrlKey) {
    skipTell();
    if (event.key !== 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); }
    return;
  }
  freeze = false;
  if (marks.sticky) clearMarks();
}, true);
addEventListener('pointerdown', () => { freeze = false; if (marks.sticky) clearMarks(); }, true);

// ---------- one cell at time t of a round ----------
function viewAt(p, t, T) {
  const v = { owner: null, ground: 0, rings: 0, solid: 0, ring: null, trace: null, clear: null, blank: 0, ghost: 0 };
  if (p.clearAt != null) {
    const q = clamp((t - p.clearAt) / T.cell);
    if (q < 1) { v.owner = p.po; v.ground = 1 - q; v.rings = Math.min(p.pa, CAP); v.solid = p.pSolid ? 1 : 0; v.clear = q; }
    const gk = (t - p.clearAt - T.cell * 0.4) / T.ghost;
    if (gk > 0 && gk < 1 && !reduced()) v.ghost = 1 - gk;
    if (q >= 1) {
      // The blank's dashes come in as the grey frame goes: rings close, a grey frame, then an empty cell.
      if (p.claimAt == null) v.blank = reduced() ? 1 : clamp((t - p.clearAt - T.cell) / T.ghost);
      else { const r = clamp((t - p.claimAt) / T.cell); v.blank = 1 - r; if (r > 0) Object.assign(v, { owner: p.no, ground: r, trace: r }); }
    }
    return v;
  }
  if (p.claimAt != null) { const r = clamp((t - p.claimAt) / T.cell); v.blank = 1 - r; if (r > 0) Object.assign(v, { owner: p.no, ground: r, trace: r }); return v; }
  if (p.po) {
    Object.assign(v, { owner: p.po, ground: 1, rings: Math.min(p.pa, CAP), solid: p.pSolid ? 1 : 0 });
    const k = clamp((t - p.ringAt) / T.ringDur);
    if (k > 0) { if (p.nSolid && !p.pSolid) v.solid = easeOut(k); else if (p.na <= CAP) v.ring = k; }
    return v;
  }
  v.blank = 1;
  return v;
}
function viewStatic(i, c) {
  const o = slots[i].owner[c];
  if (!o) return { owner: null, ground: 0, rings: 0, solid: 0, ring: null, trace: null, clear: null, blank: 1, ghost: 0 };
  return { owner: o, ground: 1, rings: Math.min(slots[i].age[c], CAP), solid: isSolid(i, c) ? 1 : 0, ring: null, trace: null, clear: null, blank: 0, ghost: 0 };
}
const liveRound = () => (post && !post.settled ? post : null);
const viewsNow = () => { const p = liveRound(); return Array.from({ length: 64 }, (_, c) => (p ? viewAt(p.cells[c], p.t, p.T) : viewStatic(stage.index, c))); };
/** The owner a cell shows now (hit tests), 'free' for an empty one. */
const ownerNow = c => { const p = liveRound(); const v = p ? viewAt(p.cells[c], p.t, p.T) : viewStatic(stage.index, c); return v.owner || 'free'; };

// ---------- drawing the grid (canvas): grounds, ghosts, blanks, rings, numbers, outlines ----------
/** Rank numbers: each item's first cell (reading order) of the frame whose info is shown. */
function labelsOf(i) {
  const out = [];
  rankOf[i].forEach((id, k) => { const c = slots[i].owner.indexOf(id); if (c >= 0) out.push({ c, id, text: String(k + 1) }); });
  return out;
}
/** From the grid's centre to the middle of the thing's cells; straight right (towards the card) when it sits in the middle. */
function popVec(id) {
  const cells = cellsOf(id);
  if (!cells.length) return [1, 0];
  const cx = cells.reduce((s, c) => s + (c % SIDE), 0) / cells.length - 3.5, cy = cells.reduce((s, c) => s + Math.floor(c / SIDE), 0) / cells.length - 3.5;
  const d = Math.hypot(cx, cy);
  return d < 1 ? [1, 0] : [cx / d, cy / d];
}
function territoryPath(cells, e, dx, dy) {
  const set = new Set(cells), { C, G } = geo;
  ctx.beginPath();
  for (const c of cells) {
    const x = cellX(c) + dx, y = cellY(c) + dy, right = c % SIDE < SIDE - 1 && set.has(c + 1), down = c < 56 && set.has(c + SIDE);
    ctx.rect(x - e, y - e, C + 2 * e, C + 2 * e);
    if (right) ctx.rect(x + C, y - e, G, C + 2 * e);
    if (down) ctx.rect(x - e, y + C, C + 2 * e, G);
    if (right && down && set.has(c + SIDE + 1)) ctx.rect(x + C, y + C, G, G);
  }
}
let X = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
function draw() {
  const g = geo, { C, G, step } = g;
  if (!ctx) return;
  const views = viewsNow();
  ctx.clearRect(0, 0, g.W, g.H);
  const focus = X.dim > 0.001 ? X.focus : null;
  const popK = X.popId ? X.pop : 0, op = 1 - (0.3 + 0.52 * (X.popId ? clamp(X.pop) : 0)) * X.dim;
  const pv = X.popId ? popVec(X.popId) : [0, 0];
  const own = c => views[c].owner || (views[c].blank > 0.5 ? 'free' : null);
  const alphaOf = c => (!focus || own(c) === focus ? 1 : op);
  const offOf = c => (X.popId && own(c) === X.popId ? [pv[0] * IX.pop * popK, pv[1] * IX.pop * popK] : [0, 0]);
  // Outlines sit in the gutters around a territory: the hovered thing, the key-focused one, the story's last taker.
  const outlined = new Map();
  if (marks.on && marks.traced && tracedItem) outlined.set(tracedItem, 1.6);
  if (focus) outlined.set(focus, 1.6);
  if (X.keyFocus) outlined.set(X.keyFocus, 2.2);
  for (const [id, width] of outlined) {
    const cells = []; for (let c = 0; c < 64; c += 1) if (own(c) === id) cells.push(c);
    if (!cells.length) continue;
    const [dx, dy] = offOf(cells[0]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK; territoryPath(cells, 3 + width, dx, dy); ctx.fill();
    ctx.fillStyle = PAPER; territoryPath(cells, 3, dx, dy); ctx.fill();
  }
  // Grounds, joined across the gutter to a neighbour with the same owner.
  ctx.fillStyle = FAINT;
  for (let c = 0; c < 64; c += 1) {
    const v = views[c];
    if (!v.owner || v.ground <= 0) continue;
    const [dx, dy] = offOf(c), x = cellX(c) + dx, y = cellY(c) + dy, a = alphaOf(c);
    ctx.globalAlpha = v.ground * a;
    ctx.fillRect(x, y, C, C);
    const r = c % SIDE < SIDE - 1 ? views[c + 1] : null, d = c < 56 ? views[c + SIDE] : null;
    if (r && r.owner === v.owner && r.ground > 0) { ctx.globalAlpha = Math.min(v.ground, r.ground) * a; ctx.fillRect(x + C, y, G, C); }
    if (d && d.owner === v.owner && d.ground > 0) { ctx.globalAlpha = Math.min(v.ground, d.ground) * a; ctx.fillRect(x, y + C, C, G); }
    const rd = r && d ? views[c + SIDE + 1] : null;
    if (rd && r.owner === v.owner && d.owner === v.owner && rd.owner === v.owner) { ctx.globalAlpha = Math.min(v.ground, r.ground, d.ground, rd.ground) * a; ctx.fillRect(x + C, y + C, G, G); }
  }
  // Borders: a hairline down the middle of every gutter between two owners (or an owner and a blank, or the grid's edge),
  // so each thing's cells read as one territory, like a map's.
  ctx.lineWidth = 1; ctx.strokeStyle = INK3;
  const half = G / 2, ownerOf = c => (views[c].owner && views[c].ground > 0 ? views[c].owner : null);
  ctx.beginPath();
  for (let c = 0; c < 64; c += 1) {
    const o = ownerOf(c);
    const x = cellX(c), y = cellY(c), col = c % SIDE, row = Math.floor(c / SIDE);
    const r = col < SIDE - 1 ? ownerOf(c + 1) : null, d = row < SIDE - 1 ? ownerOf(c + SIDE) : null;
    if ((o || r) && o !== r) { const vx = Math.round(x + C + half) + 0.5; ctx.moveTo(vx, y - half); ctx.lineTo(vx, y + C + half); }
    if ((o || d) && o !== d) { const hy = Math.round(y + C + half) + 0.5; ctx.moveTo(x - half, hy); ctx.lineTo(x + C + half, hy); }
    if (o && col === 0) { const vx = Math.round(x - half) + 0.5; ctx.moveTo(vx, y - half); ctx.lineTo(vx, y + C + half); }
    if (o && row === 0) { const hy = Math.round(y - half) + 0.5; ctx.moveTo(x - half, hy); ctx.lineTo(x + C + half, hy); }
  }
  ctx.globalAlpha = focus ? 0.55 * (1 - 0.5 * X.dim) : 0.55;
  ctx.stroke();
  // The concept layer: a cleared cell's old outer frame, in grey, gone within half a second.
  ctx.lineWidth = 1; ctx.strokeStyle = INK3;
  for (let c = 0; c < 64; c += 1) if (views[c].ghost > 0) { ctx.globalAlpha = 0.55 * views[c].ghost * alphaOf(c); ctx.strokeRect(cellX(c) + 3.5, cellY(c) + 3.5, C - 7, C - 7); }
  // Blanks: a dashed square.
  ctx.setLineDash([2, 3]);
  for (let c = 0; c < 64; c += 1) {
    const v = views[c];
    if (v.blank <= 0) continue;
    const [dx, dy] = offOf(c);
    ctx.globalAlpha = 0.95 * v.blank * alphaOf(c);
    ctx.strokeRect(cellX(c) + dx + 3.5, cellY(c) + dy + 3.5, C - 7, C - 7);
  }
  ctx.setLineDash([]);
  // Rings: outside in; the new one comes in from 1.5 px outside its place; a cleared cell's rings close on the centre.
  ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 1.1;
  for (let c = 0; c < 64; c += 1) {
    const v = views[c];
    if (!v.owner) continue;
    const [dx, dy] = offOf(c), x = cellX(c) + dx, y = cellY(c) + dy, a = alphaOf(c);
    const shrink = v.clear != null ? easeIn(v.clear) : 0, fade = v.clear != null ? 1 - v.clear : 1;
    const inset = o => o + (C / 2 - o) * 0.35 * shrink;
    if (v.trace != null) {
      const o = 3.5, side = C - 7, L = 4 * side;
      ctx.globalAlpha = a;
      ctx.setLineDash([L * easeOut(v.trace), L + 2]);
      ctx.strokeRect(x + o, y + o, side, side);
      ctx.setLineDash([]);
      continue;
    }
    ctx.globalAlpha = a * fade;
    for (let k = 0; k < v.rings; k += 1) { const o = inset(3.5 + k * step); ctx.strokeRect(x + o, y + o, C - 2 * o, C - 2 * o); }
    if (v.ring != null) {
      const e = easeOut(v.ring), o = 3.5 + v.rings * step - 1.5 * (1 - e);
      ctx.globalAlpha = a * e;
      ctx.strokeRect(x + o, y + o, C - 2 * o, C - 2 * o);
    }
    if (v.solid > 0) { const o = inset(3); ctx.globalAlpha = a * fade * v.solid; ctx.fillRect(x + o, y + o, C - 2 * o, C - 2 * o); }
  }
  // Rank numbers in the gutter above each thing's first cell.
  ctx.font = '500 9.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  ctx.textBaseline = 'alphabetic'; ctx.fillStyle = INK2;
  for (const l of labelsOf(infoIndex())) {
    if (own(l.c) !== l.id) continue;
    const [dx, dy] = offOf(l.c);
    ctx.globalAlpha = alphaOf(l.c);
    ctx.fillText(l.text, cellX(l.c) + dx - 0.5, cellY(l.c) + dy - 2.5);
  }
  ctx.globalAlpha = 1;
}

// ---------- the figure's DOM: caption, legend, rank list (they change at the settle) ----------
let infoShown = -1;
const infoIndex = () => (post && !post.settled ? post.i - 1 : stage.index);
/** One tick per share, oldest first: its height is the rounds it has stayed (up to 12); held since the first round, taller. */
function stripSVG(i, ages) {
  const w = 3, gap = 1.5, H = 14;
  const ticks = ages.map((a, k) => {
    const h = a === i && i > CAP ? H : 1 + 11 * Math.min(a, CAP) / CAP;
    return `<rect x="${(k * (w + gap)).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${w}" height="${h.toFixed(1)}" fill="var(--ink)"/>`;
  }).join('');
  return `<svg width="${Math.max(1, ages.length * (w + gap) - gap).toFixed(1)}" height="${H}" aria-hidden="true">${ticks}</svg>`;
}
function paintInfo(i) {
  if (!els.list || i === infoShown) return;
  infoShown = i;
  els.cap.innerHTML = captionOf(i);
  const r = rounds[i];
  els.legend.innerHTML = `<span class="ag-lg-k">驻龄分布</span>${BUCKETS.map(b => `<span>${glyph(b.n, 18)}${b.label} <b>${r.hist[b.key]}</b></span>`).join('')}
    <span>${glyph(0, 18, { solid: true })}从第一轮起 <b>${r.solid}</b></span><span>${glyph(0, 18, { dashed: true })}留白 <b>${r.blank1}</b></span>`;
  // Few things: two lines a row (name and why, then the ticks); many (f17 has 26): one line, the why in the row's title.
  const n = rankOf[i].length + 1, h = Math.max(19, Math.min(42, Math.floor((geo.H - geo.gy - 24) / Math.max(1, n))));
  els.list.classList.toggle('is-tall', h >= 34);
  const row = (id, k, ages, why) => `<div class="ag-row" data-id="${esc(id)}" style="height:${h}px" title="${esc(why)}"><b>${k + 1}</b><span class="ag-name">${esc(shortOf(id))}</span><span class="ag-why">${esc(why)}</span><span class="ag-share">${ages.length} 份</span>${stripSVG(i, ages)}</div>`;
  const freeWhy = i ? `不计驻龄 · 这一轮 ${r.blank0} → ${r.blank1}` : '64 份全是留白';
  els.list.innerHTML = `<div class="ag-list-head">按名次 · 每件事的格子年龄 <small>刻度高 = 待了几轮，老 → 新</small></div>
    ${rankOf[i].map((id, k) => { const ages = agesAt[i].get(id) || []; return row(id, k, ages, whyOf(i, ages)); }).join('')}
    <div class="ag-row ag-row-free" data-id="free" style="height:${h}px" title="${esc(freeWhy)}"><b></b><span class="ag-name">留白</span><span class="ag-why">${esc(freeWhy)}</span><span class="ag-share">${r.blank1} 份</span><i></i></div>`;
  lit = { focus: undefined, key: undefined };
}

// ---------- side panel: this round, with the hero number on top ----------
// The blank's term is the account's balance: it shows at the settle, with the "=" turning ink.
function eqHTML(r) {
  const b = r.blank1 - r.blank0, g = `让出 <b class="ag-eq-g">${r.gaveN}</b>`, n = `新给 <b class="ag-eq-n">${r.fresh}</b>`;
  const later = v => `<b><span class="ag-pre">…</span><span class="ag-post">${v}</span></b>`;
  if (!r.gaveN && !r.fresh) return '这一轮一份没动，留下的每一格各多一圈';
  if (b < 0) return `${r.gaveN ? `${g} + ` : ''}留白减 ${later(-b)} <i>=</i> ${n}`;
  if (b > 0) return `${g} <i>=</i> ${n} + 退回留白 ${later(b)}`;
  return `${g} <i>=</i> ${n}`;
}
const chip = id => `<span class="ag-chip" data-pin="${esc(id)}">${esc(nameOf(id))}</span>`;
function changesHTML(r) {
  const took = r.take.length ? `<ul class="ag-chg">${r.take.map(x => `<li>${chip(x.id)}<span>${x.before || '新增'} → ${x.after}</span><b>${signed(x.n)}</b></li>`).join('')}</ul>` : '<p class="st-muted">—</p>';
  const gave = r.give.length ? `<ul class="ag-chg">${r.give.map(x => {
    const status = x.after === 0 ? records[r.i].snapshot.items[x.id]?.status : null;
    const gone = status === 'merged' ? `并入${shortOf(records[r.i].snapshot.items[x.id].merged_into)}` : status ? '撤下' : x.after;
    return `<li>${chip(x.id)}<span>${x.before} → ${gone}</span><b>${signed(-x.n)}</b><small>清出 ${x.n} 格，最老 ${x.oldest} 轮${x.bed ? `，${x.bed} 格从第一轮起` : ''}</small></li>`;
  }).join('')}</ul>` : '<p class="st-muted">—</p>';
  return `<section><h4>新给 <small>${r.fresh} 格，各一道外框</small></h4>${took}</section><section><h4>清出 <small>${r.gaveN} 格，交回最年轻的</small></h4>${gave}</section>`;
}
function asksList(i) {
  const open = [...askLife[i].open.values()], fresh = new Set(askLife[i].fresh.map(a => a.id));
  const li = a => `<li class="is-open"><b>${fresh.has(a.id) ? '新登记' : '开着'}</b><span>${esc(askShort(a))}</span><small>${esc([nameOf(rootOf(a.item)), dueOf(a)].filter(Boolean).join(' · '))}</small><a href="${esc(answerLink())}">去回答 →</a></li>`;
  const after = [
    ...askLife[i].answered.map(a => `<li class="is-answered"><b>答掉</b><s>${esc(askShort(a))}</s><small>${esc(howAnswered(a))}</small></li>`),
    ...askLife[i].lapsed.map(a => `<li class="is-lapsed"><b>失效</b><span>${esc(askShort(a))}</span><small>${esc(howLapsed(a, i))}</small></li>`),
    ...open.map(li),
  ].join('');
  const before = i ? [...askLife[i - 1].open.values()].map(a => `<li><b>开着</b><span>${esc(askShort(a))}</span></li>`).join('') : '';
  const shut = askLife[i].answered.length + askLife[i].lapsed.length;
  const head = shut ? `这一轮的问题 <small>关上 ${shut} · 开着 ${open.length} · 去回答链到同一帧的 D</small>` : `开着的问题 <small>${open.length} 条 · 去回答链到同一帧的 D</small>`;
  return `<section class="ag-asks"><h4><span class="ag-post">${head}</span><span class="ag-pre">开着的问题 <small>本轮还没平账</small></span></h4>
    <ul class="ag-post">${after || '<li class="st-muted">没有开着的问题</li>'}</ul><ul class="ag-pre">${before || '<li class="st-muted">没有开着的问题</li>'}</ul></section>`;
}
function overview(i) {
  if (i === 0) return { kicker: `这一轮 · ${frames[0].id}`, title: esc(frames[0].title), body: '<div class="ag-ov" data-i="0" data-phase="post"><p>还没有整理过任何输入：64 格全是留白。按 → 或空格开始。</p></div>' };
  const r = rounds[i], live = Boolean(post && post.i === i && !post.settled);
  const annotations = frames[i].annotations || [];
  return {
    kicker: `这一轮 · ${frames[i].id} · ${records[i].state.revision}`,
    title: esc(frames[i].title),
    body: `<div class="ag-ov" data-i="${i}" data-phase="${live ? 'pre' : 'post'}">
      <div class="ag-hero"><b class="ag-n">${live ? 0 : r.fresh}</b><span class="ag-sl">/</span><b class="ag-d"><span class="ag-pre">${usedAt(i - 1)}</span><span class="ag-post">${r.used}</span></b></div>
      <p class="ag-hero-k"><span>这一轮新给</span><span>此刻在用</span></p>
      <p class="ag-eq">${eqHTML(r)}</p>
      <p class="ag-bed">从第一轮起没挪过 <b><span class="ag-pre">${rounds[i - 1].since}</span><span class="ag-post">${r.since}</span></b> 份<small>第一轮 ${esc(dayTime(frames[1].at))} 给出 ${rounds[1].used} 份</small></p>
      <div class="ag-post">${changesHTML(r)}</div>
      <p class="ag-pre st-muted ag-wait">本轮还没平账：先清出，再加圈，再画新框。</p>
      ${asksList(i)}
      ${annotations.length ? `<section><h4>${esc(personName)}的批注</h4>${annotations.map(a => `<p>「${esc(a.text)}」</p>`).join('')}</section>` : ''}
      ${frames[i].narrative ? `<section><h4>旁白 <small>演示数据</small></h4><p>${esc(frames[i].narrative)}</p></section>` : ''}
      <p class="st-muted ag-fine">格在哪里是画法：新给的格落在空着、又离自己的地盘近的地方；回执只记每件事增减多少，不记谁让给谁。</p>
      </div>`,
  };
}
stage.setOverview(overview);
const sideEls = { ov: null, v: '' };
function paintSide() {
  const ov = document.querySelector('.ag-ov');
  if (ov !== sideEls.ov) { sideEls.ov = ov; sideEls.v = ''; if (ov) Object.assign(sideEls, { n: ov.querySelector('.ag-n'), g: ov.querySelector('.ag-eq-g'), k: ov.querySelector('.ag-eq-n') }); }
  if (!ov) return;
  const i = Number(ov.dataset.i), r = rounds[i];
  if (!i) return;
  const live = Boolean(post && post.i === i && !post.settled);
  let gave = r.gaveN, took = r.fresh;
  if (live) {
    const T = post.T;
    gave = T.count ? countAt(post.t, T.clear0 + T.cell, post.sc, post.nc) : 0;
    took = T.count ? countAt(post.t, T.claim0 + T.cell, post.sk, post.nk) : 0;
  }
  const v = `${gave}:${took}:${live}`;
  if (v === sideEls.v) return;
  sideEls.v = v;
  ov.dataset.phase = live ? 'pre' : 'post';
  if (sideEls.n) sideEls.n.textContent = took;
  if (sideEls.g) sideEls.g.textContent = gave;
  if (sideEls.k) sideEls.k.textContent = took;
}

// ---------- the interaction (motion/ix.mjs): what is under a point, where cards hang, how the clock stops ----------
const HIT = 12;
const cellsOf = id => { const out = []; for (let c = 0; c < 64; c += 1) if (ownerNow(c) === id) out.push(c); return out; };
const hasId = id => (id === 'free' ? 64 - usedAt(stage.index) > 0 : shareMaps[stage.index].has(id)) && cellsOf(id).length > 0;
let lastCell = null;
function cellAt(x, y) {
  const g = geo;
  if (!g || x < g.gx - HIT || x > g.gx + g.S + HIT || y < g.gy - HIT || y > g.gy + g.S + HIT) return null;
  const col = clamp(Math.floor((x - g.gx + g.G / 2) / g.P), 0, SIDE - 1), row = clamp(Math.floor((y - g.gy + g.G / 2) / g.P), 0, SIDE - 1);
  return row * SIDE + col;
}
function hitAt(x, y) {
  const c = cellAt(x, y);
  if (c == null) return null;
  lastCell = c;
  const id = ownerNow(c);
  return hasId(id) ? id : null;
}
figure.addEventListener('pointermove', event => { if (event.target.closest?.('.ag-list, .ix-peek, .ix-detail')) lastCell = null; });
function idFor(name) {
  if (name == null) return null;
  if (name === '留白' || name === 'free') return 'free';
  if (shareMaps[stage.index].has(name)) return name;
  return rankOf[stage.index].find(id => shortOf(id) === name) || null;
}
/** The cell that stands for a thing: the one nearest the middle of its cells. */
function anchorCell(id) {
  const cells = cellsOf(id);
  if (!cells.length) return null;
  const mx = cells.reduce((s, c) => s + (c % SIDE), 0) / cells.length, my = cells.reduce((s, c) => s + Math.floor(c / SIDE), 0) / cells.length;
  return cells.reduce((best, c) => (Math.hypot((c % SIDE) - mx, Math.floor(c / SIDE) - my) < Math.hypot((best % SIDE) - mx, Math.floor(best / SIDE) - my) ? c : best));
}
const centreOf = id => { const c = anchorCell(id); return c == null ? null : { x: cellX(c) + geo.C / 2, y: cellY(c) + geo.C / 2 }; };
/** A cell of the thing on the grid's outer edge (left, top, right, bottom), for a point just outside it. */
function edgeCell(id) {
  const cells = cellsOf(id);
  for (const [test, side] of [[c => c % SIDE === 0, 'l'], [c => c < SIDE, 't'], [c => c % SIDE === SIDE - 1, 'r'], [c => c >= 56, 'b']]) {
    const c = cells.find(test);
    if (c != null) return { c, side };
  }
  return null;
}
// The summary card hangs above the cell under the pointer (below it when there is no room); from the list, above the thing's
// middle cell.
function peekPlace(id, w, h) {
  const g = geo, c = lastCell != null && ownerNow(lastCell) === id ? lastCell : anchorCell(id);
  const x0 = cellX(c), y0 = cellY(c), cx = x0 + g.C / 2;
  const x = clamp(cx - w / 2, 8, g.W - 8 - w);
  const below = y0 - 10 - h < 4;
  return below ? { x, y: y0 + g.C + 10, from: { x: cx, y: y0 + g.C } } : { x, y: y0 - 10 - h, from: { x: cx, y: y0 } };
}
// The detail card lies over the rank list, never over the grid. The leader leaves the popped thing's rightmost cell into the
// gutter beside it, runs along the nearest horizontal gutter to 12 px past the grid's right edge, then to the card.
function detailPlace(id, el) {
  const g = geo, cells = cellsOf(id);
  if (!cells.length) return null;
  const pv = popVec(id), off = [pv[0] * IX.pop, pv[1] * IX.pop];
  const my = cells.reduce((s, c) => s + Math.floor(c / SIDE), 0) / cells.length, maxCol = Math.max(...cells.map(c => c % SIDE));
  const a = cells.filter(c => c % SIDE === maxCol).sort((p, q) => Math.abs(Math.floor(p / SIDE) - my) - Math.abs(Math.floor(q / SIDE) - my))[0];
  const row = Math.floor(a / SIDE), downward = row < SIDE - 1;
  const gutY = downward ? cellY(a) + g.C + g.G / 2 : cellY(a) - g.G / 2;
  const start = { x: cellX(a) + g.C / 2 + off[0], y: (downward ? cellY(a) + g.C : cellY(a)) + off[1] };
  const rx = g.gx + g.S + 12;
  const x = Math.max(g.listX - 6, rx + 14), w = Math.min(340, g.W - 8 - x);
  el.style.width = `${w}px`;
  el.style.maxHeight = `${g.H - 16}px`;
  const h = Math.min(el.offsetHeight, g.H - 16);
  el.style.maxHeight = `${h}px`;
  const y = clamp(gutY - h * 0.35, 8, g.H - 8 - h), yEnd = clamp(gutY, y + 14, y + h - 14);
  const path = [start, { x: start.x, y: gutY }, { x: rx, y: gutY }];
  if (Math.abs(yEnd - gutY) > 0.5) path.push({ x: rx, y: yEnd });
  path.push({ x, y: yEnd });
  return { x, y, w, h, path };
}

let ix = null;
ix = createIx({
  stage: figure, keysIn: figure,
  facts: id => factsOf(id), has: hasId, hit: hitAt, named: name => idFor(name),
  pointOf: centreOf, index: () => stage.index * 2 + (liveRound() ? 1 : 0),
  pause: () => { if (hold.at == null) hold.at = now(); }, resume: () => { hold.at = null; }, paused: () => hold.at != null,
  last: LAST, answerHref: () => answerLink(),
  seen: () => { const live = Boolean(liveRound() && post.i === stage.index); return { inputs: true, share: !live, asks: !live }; },
  peekPlace, detailPlace, peekHTML: (f, o) => peekCard(f, o), detailHTML: (f, o) => detailCard(f, o),
  skip: '.ag-cap, .ag-legend, .ag-list-head',
  label: '驻龄方阵：Tab 逐件看概要，Enter 展开详情，Esc 收回',
});

// ---------- the cards: this frame, this thing ----------
const factCache = new Map();
function factsOf(id) {
  const i = stage.index, ck = `${i}:${id}`;
  if (factCache.has(ck)) return factCache.get(ck);
  const r = rounds[i], when = `${dayTime(frames[i].at)} · ${frames[i].id}`;
  let f;
  if (id === 'free') {
    f = { i, id, free: true, short: '留白', when, before: r.blank0, after: r.blank1, dir: r.blank1 < r.blank0 ? '动用' : r.blank1 > r.blank0 ? '退回' : '不变' };
  } else {
    const ages = agesAt[i].get(id) || [], before = sh(i - 1, id), after = sh(i, id);
    const give = r.give.find(x => x.id === id), take = r.take.find(x => x.id === id);
    f = { i, id, short: shortOf(id), title: titleAt(id, i), when, ages, before, after, give, take,
      dir: take ? '新给' : give ? '清出' : '不变',
      other: take ? r.give : give ? r.take : [], otherWord: take ? '同一轮清出' : '同一轮新给',
      asks: openAsks(id, i), closed: closedIn(id, i),
      responses: foldSentences(responsesIn(i).filter(x => rootOf(x.link.target) === id)),
      summary: records[i].snapshot.items[id]?.summary || '' };
  }
  factCache.set(ck, f);
  return f;
}
const askRow = a => `<div class="ix-ask"><i></i><span>${esc(askShort(a))}</span>${dueOf(a) ? `<small>${esc(dueOf(a))}</small>` : ''}</div>`;
function peekCard(f, { seen }) {
  const unsettled = !seen.share;
  if (f.free) {
    return `<div class="ix-k">${esc(f.when)}</div><div class="ix-q">留白</div>
      <div class="ix-d">${unsettled ? '本轮还没平账' : `${f.after} / 64 份 · 这一轮 ${f.before} → ${f.after}`}</div><div class="ix-d">留白不计驻龄</div>`;
  }
  const change = unsettled ? '本轮还没平账' : `${f.after} / 64 份 · 这一轮 ${f.before} → ${f.after}（${signed(f.after - f.before)}）`;
  return `<div class="ix-k">${esc(f.when)}${unsettled ? '' : ` · ${f.dir}`}</div><div class="ix-q">${esc(f.short)}</div>
    ${f.title ? `<div class="ix-d ag-pk-title">${esc(f.title)}</div>` : ''}<div class="ix-d">${esc(change)}</div>
    ${unsettled ? '' : `<div class="ix-d">格龄 ${esc(histText(f.ages))}</div><div class="ix-d">最老一份 ${esc(oldestText(f.i, f.ages))}</div>`}
    ${unsettled ? '' : f.asks.map(askRow).join('')}`;
}
/** The ages of one thing as glyphs: one ring glyph per distinct age, with the count. */
function ageGlyphs(i, ages) {
  const groups = [];
  for (const a of ages) { const last = groups.at(-1); if (last && last.a === a) last.n += 1; else groups.push({ a, n: 1 }); }
  return `<p class="ag-dc-ages">${groups.map(gr => `<span>${glyph(gr.a, 22, { solid: gr.a === i && i > CAP })}<b>×${gr.n}</b><small>${gr.a} 轮</small></span>`).join('')}</p>`;
}
function detailCard(f, { seen, href }) {
  const unsettled = !seen.share;
  const close = '<button type="button" data-x="close" aria-label="收回（Esc）" title="收回（Esc）">×</button>';
  if (f.free) {
    return `<div class="ix-d-k"><span>${esc(f.when)} · ${f.dir}</span>${close}</div><div class="ix-d-t">留白 ${f.before} → ${f.after}</div>
      <p class="ix-d-sum">留白是没有分配的份额，不计驻龄。被清出、又没有新主人认领的格回到留白；新给的格先从留白里取。</p>`;
  }
  const head = unsettled ? `${esc(f.short)} ${f.before} → …` : `${esc(f.short)} ${f.before} → ${f.after}（${signed(f.after - f.before)}）`;
  const asks = `<section><h5>开着的问题<b>此刻 ${esc(frames[f.i].id)}</b></h5>${f.asks.length ? f.asks.slice(0, 3).map(a => `<div class="ix-d-ask"><i></i><p>${esc(a.prompt)}</p><small>${esc(dueOf(a) || '没有期限')}</small><a href="${esc(href)}">去回答 →</a></div>`).join('') : '<p class="ix-none">没有开着的问题</p>'}</section>`;
  const cleared = f.give ? `<section><h5>这一轮清出<b>${f.give.n} 格</b></h5><p class="ix-none">交回最年轻的 ${f.give.n} 格，其中最老的待了 ${f.give.oldest} 轮${f.give.bed ? `；${f.give.bed} 格从第一轮起就在` : ''}</p></section>` : '';
  const took = f.take ? `<section><h5>这一轮新给<b>${f.take.n} 格</b></h5><p class="ix-none">${f.take.n} 格各画一道外框，从 1 轮数起</p></section>` : '';
  const other = f.other.length ? `<section><h5>${f.otherWord}<b>${f.other.reduce((s, x) => s + x.n, 0)} 份</b></h5><p class="ag-dc-peers">${f.other.map(x => `<span>${esc(nameOf(x.id))} ${signed(f.take ? -x.n : x.n)}</span>`).join('')}</p><p class="ix-none">回执只记每件事增减多少，不记谁让给谁</p></section>` : '';
  const responses = f.responses.length ? `<section><h5>这一轮你的回应</h5><ul class="ix-d-fb">${f.responses.map(x => `<li><time>${esc(timeOf(x.first.event.at))}</time>${esc(x.label)}${x.first.link.ask ? `，答「${esc(askShort(askById(x.first.link.ask) || {}))}」` : ''}</li>`).join('')}</ul></section>` : '';
  const lapsed = f.closed.lapsed.map(a => `<li>失效「${esc(askShort(a))}」：${esc(howLapsed(a, f.i))}</li>`).join('');
  return `<div class="ix-d-k"><span>${esc(f.when)}${unsettled ? '' : ` · ${f.dir}`}</span>${close}</div>
    <div class="ix-d-t">${head}</div>${f.title ? `<div class="ix-d-s">${esc(f.title)}</div>` : ''}
    ${unsettled ? '<p class="ix-none">本轮还没平账</p>' : `<section><h5>格龄<b>${f.ages.length} 份</b></h5>${ageGlyphs(f.i, f.ages)}</section>
    <section><h5>最老的一份<b>${f.ages[0] || 0} 轮</b></h5><p class="ix-none">${esc(oldestText(f.i, f.ages, false))}</p></section>${cleared}${took}${other}`}
    ${responses}${lapsed ? `<section><h5>这一轮失效的问题</h5><ul class="ix-d-fb">${lapsed}</ul></section>` : ''}
    ${asks}${f.summary ? `<p class="ix-d-sum">${esc(f.summary)}</p>` : ''}`;
}

// ---------- side panel: “这一件” (two weeks of one thing) ----------
let panelKey = null;
function barsSVG(id, at) {
  const W = 300, H = 40, n = LAST, bw = W / n;
  const series = frames.map((_, k) => (id === 'free' ? rounds[k].blank1 : sh(k, id)));
  const top = Math.max(24, ...series);
  let out = '';
  for (let k = 1; k <= LAST; k += 1) {
    const s = series[k], hAll = s ? Math.max(1.5, (s / top) * (H - 2)) : 1, x = ((k - 1) * bw + bw * 0.15).toFixed(1), w = (bw * 0.7).toFixed(1);
    const cls = k === at ? 'is-now' : k > stage.index ? 'is-later' : s ? '' : 'is-off';
    if (id === 'free' || !s) { out += `<rect x="${x}" y="${(H - hAll).toFixed(1)}" width="${w}" height="${hAll.toFixed(1)}" class="${cls}"/>`; continue; }
    const fresh = slots[k].claimed.filter(c => c.id === id).length, hNew = (fresh / top) * (H - 2), hOld = hAll - hNew;
    if (hOld > 0.1) out += `<rect x="${x}" y="${(H - hOld).toFixed(1)}" width="${w}" height="${hOld.toFixed(1)}" class="${cls}"/>`;
    if (fresh) out += `<rect x="${x}" y="${(H - hAll + 0.5).toFixed(1)}" width="${(bw * 0.7 - 1).toFixed(1)}" height="${Math.max(0.5, hNew - 1).toFixed(1)}" class="ag-new ${cls}"/>`;
  }
  return `<svg class="ix-trend ag-bars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${out}</svg><div class="ix-axis"><span>${esc(frames[1].id)}</span><span>${esc(frames[LAST].id)}</span></div>`;
}
function panelFor(view) {
  const id = view.id;
  return i => {
    const kick = `这一件 · ${frames[view.i].id}${view.dir ? ` · ${view.dir}` : ''}`;
    const changes = [];
    for (let k = 1; k <= LAST; k += 1) {
      const before = id === 'free' ? rounds[k].blank0 : sh(k - 1, id), after = id === 'free' ? rounds[k].blank1 : sh(k, id);
      if (before === after) continue;
      const g = id === 'free' ? null : rounds[k].give.find(x => x.id === id);
      const what = id === 'free' ? (after > before ? `退回 ${after - before}` : `动用 ${before - after}`)
        : after > before ? `新给 ${after - before} 格` : `清出 ${before - after} 格，最老 ${g?.oldest || 0} 轮${g?.bed ? `，${g.bed} 格从第一轮起` : ''}`;
      changes.push(`<li class="${k > i ? 'is-later' : ''}${k === i ? ' is-now' : ''}"><button type="button" data-st="go" data-frame="${k}"><time>${esc(frames[k].id)} ${esc(dayTime(frames[k].at))}</time></button><b>${before} → ${after}</b><span>${esc(what)}</span></li>`);
    }
    if (id === 'free') {
      return { kicker: kick, title: `留白 ${rounds[i].blank1} / 64`,
        body: `<section><h4>留白 · 逐轮</h4>${barsSVG('free', view.i)}</section><p class="st-muted">留白不计驻龄：被清出、又没有新主人认领的格回到这里，新给的格先从这里取。</p>
          <section><h4>动用与退回 <small>${changes.length} 轮</small></h4><ul class="ag-hist">${changes.join('')}</ul></section>` };
    }
    let deepest = { a: 0, k: 0 };
    for (let k = 1; k <= i; k += 1) { const a = agesAt[k].get(id)?.[0] || 0; if (a >= deepest.a) deepest = { a, k }; }
    const ages = agesAt[i].get(id) || [];
    const closes = [];
    for (let k = 1; k <= LAST; k += 1) {
      for (const a of askLife[k].answered) if (rootOf(a.item) === id) closes.push({ k, a, how: '答' });
      for (const a of askLife[k].lapsed) if (rootOf(a.item) === id) closes.push({ k, a, how: '失效' });
    }
    const closeList = closes.length ? `<section><h4>问题关上的那几轮 <small>前 → 后</small></h4><ul class="ag-closes">${closes.map(x => `<li class="${x.k > i ? 'is-later' : ''}"><button type="button" data-st="go" data-frame="${x.k}"><time>${esc(frames[x.k].id)}</time></button><span>${x.how}「${esc(askShort(x.a))}」</span><b>${sh(x.k - 1, id)} → ${sh(x.k, id)}</b></li>`).join('')}</ul></section>` : '';
    const nowItem = records[i].snapshot.items[id];
    return {
      kicker: kick, title: esc(titleAt(id, i)),
      body: `<section><h4>份额 · 逐轮 <small>${esc(shortOf(id))} 此刻 ${sh(i, id)} / 64${nowItem ? ` · ${esc(kindWord(nowItem))}` : ''}</small></h4>${barsSVG(id, view.i)}<p class="ag-fine st-muted">实心是留下的，空心是那一轮新给的。</p></section>
        <p class="ag-acct">此刻：${ages.length ? `格龄 ${esc(histText(ages))}` : '不在根层'}<br><small>到此刻沉得最久的一份：${deepest.a} 轮（${esc(frames[deepest.k].id)}）${ages[0] ? `；此刻最老一份 ${esc(oldestText(i, ages))}` : ''}</small></p>
        <section><h4>份额变动的那几轮 <small>${changes.length} 轮</small></h4><ul class="ag-hist">${changes.join('')}</ul></section>
        ${closeList}
        <details class="ag-more"><summary>摘要、依据、来源与版本</summary>${itemDetailHTML(id, i)}</details>`,
    };
  };
}
function openPanel(view) {
  panelKey = view.id;
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
  if (X.detail && ix.view && panelKey !== ix.view.id) openPanel(ix.view);
  else if (!X.detail && panelKey) closePanel();
}
// The side panel's names open that thing in the grid.
document.querySelector('.st-side').addEventListener('click', event => {
  const pin = event.target.closest('[data-pin]');
  if (pin && hasId(pin.dataset.pin)) ix.open(pin.dataset.pin);
});
document.querySelector('.st-tools').addEventListener('click', event => {
  const b = event.target.closest('[data-a="tell"]');
  if (b) { if (run.kind === 'tell') skipTell(); else startTell(); }
});

// ---------- focus in the list, and the keyboard proxies ----------
let lit = { focus: undefined, key: undefined };
function paintList() {
  const focus = X.dim > 0.001 ? X.focus : null;
  if (focus === lit.focus && X.keyFocus === lit.key) return;
  lit = { focus, key: X.keyFocus };
  for (const row of els.list?.querySelectorAll('.ag-row') || []) { row.classList.toggle('is-lit', row.dataset.id === focus); row.classList.toggle('is-key', row.dataset.id === X.keyFocus); }
  els.list?.classList.toggle('is-focus', Boolean(focus));
}
const proxyKey = () => `${stage.index}|${liveRound() ? 1 : 0}`;
const proxyList = () => [...rankOf[stage.index], 'free'].filter(hasId).map((id, k) => {
  const ages = agesAt[stage.index].get(id) || [];
  return { id, label: id === 'free' ? `留白 ${rounds[stage.index].blank1} 份` : `${k + 1} ${shortOf(id)} ${ages.length} 份 · ${histText(ages)}` };
});

// ---------- the loop ----------
const perf = { on: new URLSearchParams(location.search).has('perf'), times: [], work: [], draws: [], longAt: [], t0: performance.now() / 1000 };
let lastT = null, drawnKey = '';
const xKey = () => `${X.focus}|${X.dim.toFixed(3)}|${X.popId}|${X.pop.toFixed(3)}|${X.keyFocus}|${marks.on && marks.traced}`;
function loop(ms) {
  const w = ms / 1000, dt = lastT == null ? 0 : Math.min(0.1, w - lastT);
  if (perf.on && lastT != null) { perf.times.push(w - lastT); if (w - lastT > 0.02) perf.longAt.push([+(w - perf.t0).toFixed(2), +((w - lastT) * 1000).toFixed(1), stage.index]); }
  lastT = w;
  const t0 = performance.now();
  tick(dt);
  X = ix.frame();
  // After the story, the first hover drops the told outline.
  if (marks.sticky && X.focus) clearMarks();
  const k = xKey();
  if (dirty || liveRound() || k !== drawnKey) {
    const d0 = performance.now();
    draw();
    if (perf.on) perf.draws.push(performance.now() - d0);
    drawnKey = k; dirty = false;
  }
  paintSide();
  paintList();
  paintPanel();
  ix.paint();
  ix.sync(proxyKey(), proxyList);
  if (perf.on) perf.work.push(performance.now() - t0);
  requestAnimationFrame(loop);
}

let resizeTimer = null;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });
render();
if (autoTell) { if (reduced()) skipTell(); else startTell(); }
requestAnimationFrame(loop);

const p95 = list => [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.95)] || 0;
const mean = list => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
// Hooks with the same names and meanings as foldYield and foldDial (ix.mjs).
window.foldAge = {
  ...ix.hooks(),
  hover: name => ix.hover(idFor(name), 'pointer'),
  open: name => ix.open(idFor(name)),
  pointOf: name => { const c = centreOf(idFor(name)); if (!c) return null; const b = figure.getBoundingClientRect(); return { x: b.left + c.x, y: b.top + c.y }; },
  /** A point `d` px outside the grid, level with a cell of the thing on the grid's edge (inside the widened hit band). */
  nearOf: (name, d = 9) => {
    const e = edgeCell(idFor(name)), g = geo, b = figure.getBoundingClientRect();
    if (!e) return null;
    const x = cellX(e.c), y = cellY(e.c);
    const p = e.side === 'l' ? { x: g.gx - d, y: y + g.C / 2 } : e.side === 't' ? { x: x + g.C / 2, y: g.gy - d } : e.side === 'r' ? { x: g.gx + g.S + d, y: y + g.C / 2 } : { x: x + g.C / 2, y: g.gy + g.S + d };
    return { x: b.left + p.x, y: b.top + p.y };
  },
  /** The largest thing of the frame with a cell on the grid's left edge (else any edge): clear space just outside it. */
  pick: () => {
    const ids = rankOf[stage.index].filter(id => edgeCell(id));
    return shortOf(ids.find(id => edgeCell(id).side === 'l') || ids[0] || rankOf[stage.index][0]);
  },
  tell: startTell, skip: skipTell, tellAt, play: startPlay, stop: stopRun,
  telling: () => run.kind === 'tell', playing: () => run.kind === 'play',
  settled: () => !post || post.settled, phase: () => (post ? { i: post.i, mode: post.mode, t: +post.t.toFixed(3), settled: post.settled } : null),
  plan, tellLength, rounds, slots: i => ({ owner: [...slots[i].owner], age: [...slots[i].age] }), geom: () => ({ ...geo }),
  perf: () => {
    const ts = perf.times.slice(1), work = perf.work.slice(1);
    return { frames: ts.length, fps: +(1 / mean(ts)).toFixed(1), p95ms: +(p95(ts) * 1000).toFixed(1), long: ts.filter(t => t > 0.02).length, maxMs: +(Math.max(0, ...ts) * 1000).toFixed(1), workMs: +mean(work).toFixed(2), workP95ms: +p95(work).toFixed(2), drawMs: +mean(perf.draws).toFixed(2), drawP95ms: +p95(perf.draws).toFixed(2) };
  },
  resetPerf: () => { Object.assign(perf, { on: true, times: [], work: [], draws: [], longAt: [], t0: performance.now() / 1000 }); },
  /** Frames over 20 ms since resetPerf: [seconds since it, length in ms, frame index]. */
  longFrames: () => perf.longAt.slice(),
};
