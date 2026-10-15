// 03 来源矩阵（完整版）：行是发来输入的人、机器与订阅源，先按流分组、组内按贡献排序；列是根层事项。
// 每格是这个来源对这件事的输入：累计时是一条两周的小时间线（每帧一根细柱，深色 = 采用），本轮时是逐条记号。
// 本人的几个署名合成一行；几乎全是噪音的整块（社区、订阅）只画一条比例条，可展开；每组的长尾折成“其余 N 位”，展开按贡献排序。
// 颜色只表示事项身份（列头）。
import {
  createStage, esc, frames, dayTime, colorOf, shortOf, titleAt, itemDetailHTML, kindWord, reduced, isSelf,
  rootOf, scenario, records, responsesIn, foldSentences,
} from './stage.mjs';
import { personName } from './kit.mjs';

const D = ['used', 'duplicate', 'deferred', 'noise', 'unjudged'];
const dWord = { used: '采用', duplicate: '重复', deferred: '暂缓', noise: '噪音', unjudged: '未判' };
const key = `
  <span><i class="sw" style="background:#2f7f6f"></i><i class="sw" style="background:#b8643a"></i>颜色只表示事项身份（列头）</span>
  <span><svg width="44" height="12"><line x1="0" y1="10.5" x2="44" y2="10.5" stroke="var(--line)"/><rect x="6" y="5" width="2" height="6" fill="var(--ink)"/><rect x="18" y="2" width="2" height="9" fill="var(--ink)"/><rect x="18" y="2" width="2" height="3" fill="var(--ink-3)"/><rect x="33" y="7" width="2" height="4" fill="var(--ink-3)"/></svg>累计：格内从左到右是两周，每帧一根柱，深 = 采用、浅 = 暂缓或重复</span>
  <span><svg width="40" height="10"><circle cx="5" cy="5" r="3.2" fill="var(--ink)"/><circle cx="15" cy="5" r="2.8" fill="none" stroke="var(--ink)" stroke-width="1.1"/><circle cx="25" cy="5" r="2.8" fill="none" stroke="var(--ink)" stroke-dasharray="1.5 1.3"/><path d="M32 2 L38 8 M38 2 L32 8" stroke="var(--ink)" stroke-width="1.2"/></svg>本轮：采用 · 重复 · 暂缓 · 噪音</span>
  <span><svg width="40" height="8"><rect width="22" height="7" fill="var(--ink)"/><rect x="22" width="8" height="7" fill="var(--ink-3)"/><rect x="30" width="10" height="7" fill="var(--line)"/></svg>右栏：这个来源的全部输入怎么判</span>
  <span class="note"><kbd>←</kbd><kbd>→</kbd> 逐帧 <kbd>空格</kbd> 播放 <kbd>T</kbd> 累计/本轮 <kbd>↑</kbd><kbd>↓</kbd> 换行 <kbd>Enter</kbd> 固定或展开</span>`;
const stage = createStage({
  id: 'provenance', no: 3, name: '来源矩阵', storyIndex: 36, key,
  relation: '每件事由谁推动：谁的输入被用到了哪件事、在哪几天，每个来源又有多少被判为重复、暂缓或噪音。',
  tools: `<div class="st-seg" role="group" aria-label="范围"><button type="button" data-pv-mode="cum" aria-pressed="true">累计到此刻</button><button type="button" data-pv-mode="round" aria-pressed="false">只看本轮</button></div>`,
});
const figure = stage.figure;
const N = frames.length;

// ---------- data ----------
const hasStreams = frames.some(f => f.events.some(e => e.stream));
const streamOrder = hasStreams ? ['work', 'family', 'life', 'community', 'subscription'] : ['people', 'machine', 'feed', 'official'];
const groupNames = { you: '你自己', work: '工作', family: '家庭', life: '生活', community: '社区', subscription: '订阅', people: '人', machine: '机器与提醒', feed: '订阅、群与推销', official: '官方资料', other: '其他' };
function groupOf(e) {
  if (isSelf(e)) return 'you';
  if (hasStreams) return e.stream || 'other';
  if (e.channel === '官方资料') return 'official';
  if (e.author_kind === 'bot' || e.author_kind === 'automation' || /机器人|宿主|本地日历/.test(e.from)) return 'machine';
  return ['资讯订阅', '招聘平台', '供应商邮件', '促销短信', '同楼群', '团购群'].includes(e.channel) ? 'feed' : 'people';
}
const dispOf = e => (D.includes(e.disposition) ? e.disposition : 'unjudged');
const senders = new Map();
frames.forEach((f, i) => f.events.forEach(e => {
  const k = isSelf(e) ? 'self' : `s:${e.from}`;
  if (!senders.has(k)) senders.set(k, { key: k, name: isSelf(e) ? scenario.persona?.name || personName : e.from, group: groupOf(e), names: new Set(), channels: new Set(), machine: false, inputs: [], pairs: new Map(), prefix: null });
  const s = senders.get(k);
  s.names.add(e.from); s.channels.add(e.channel);
  if (e.author_kind === 'bot' || e.author_kind === 'automation') s.machine = true;
  const roots = [...new Set((e.relatedIds || []).map(rootOf))].filter(id => scenario.categories?.[id] || records.some(r => r.snapshot.items[id]));
  const input = { e, i, d: dispOf(e), roots };
  s.inputs.push(input);
  for (const col of roots.length ? roots : ['none']) {
    if (!s.pairs.has(col)) s.pairs.set(col, []);
    s.pairs.get(col).push(input);
  }
}));
// Prefix counts per sender: counts over frames ≤ i, and in frame i alone.
for (const s of senders.values()) {
  const per = Array.from({ length: N }, () => Object.fromEntries([...D, 'total'].map(d => [d, 0])));
  for (const x of s.inputs) { per[x.i][x.d] += 1; per[x.i].total += 1; }
  const cum = []; let run = Object.fromEntries([...D, 'total'].map(d => [d, 0]));
  for (let i = 0; i < N; i += 1) { run = Object.fromEntries(Object.keys(run).map(k => [k, run[k] + per[i][k]])); cum.push(run); }
  s.per = per; s.cum = cum;
}
const rootUsedCum = new Map(), rootUsedPer = new Map(), firstSeen = new Map();
for (const s of senders.values()) for (const x of s.inputs) for (const r of x.roots) {
  if (!firstSeen.has(r) || firstSeen.get(r) > x.i) firstSeen.set(r, x.i);
  if (x.d !== 'used') continue;
  if (!rootUsedPer.has(r)) rootUsedPer.set(r, new Array(N).fill(0));
  rootUsedPer.get(r)[x.i] += 1;
}
for (const [r, per] of rootUsedPer) { let run = 0; rootUsedCum.set(r, per.map(n => (run += n))); }
const groups = [...new Set([...senders.values()].map(s => s.group))]
  .sort((a, b) => (a === 'you' ? -1 : b === 'you' ? 1 : (streamOrder.indexOf(a) + 1 || 99) - (streamOrder.indexOf(b) + 1 || 99)));
const membersOf = new Map(groups.map(g => [g, [...senders.values()].filter(s => s.group === g)]));

// ---------- view state ----------
let mode = 'cum';
const unfolded = new Set(), folded = new Set(), restOpen = new Map();
const countsOf = (s, I) => (mode === 'cum' ? s.cum[I] : s.per[I]);
const sumCounts = (list, I) => {
  const out = Object.fromEntries([...D, 'total'].map(d => [d, 0]));
  for (const s of list) { const c = countsOf(s, I); for (const k in out) out[k] += c[k]; }
  return out;
};
const inScope = (x, I) => (mode === 'cum' ? x.i <= I : x.i === I);
// A group folds by default when almost nothing in it was used (community, subscriptions).
function isFolded(g, I) {
  if (unfolded.has(g)) return false;
  if (folded.has(g)) return true;
  if (g === 'you') return false;
  // Judged on the whole two weeks, so the choice does not flip between frames or scopes.
  let used = 0, total = 0;
  for (const s of membersOf.get(g)) { used += s.cum[N - 1].used; total += s.cum[N - 1].total; }
  return total >= 12 && used / total < 0.1;
}

let geo = null;
function measure() {
  const W = figure.clientWidth, H = figure.clientHeight;
  const LABEL = 214, TALLY = 156, HEAD = 52;
  const matrix = W - LABEL - TALLY - 8;
  const cols = Math.max(6, Math.min(14, Math.floor(matrix / 56)));
  return { W, H, LABEL, TALLY, HEAD, matrix, cols, colW: matrix / cols, rowH: 22, groupH: 26, gap: 6 };
}

function columnsAt(I) {
  const used = r => (mode === 'cum' ? rootUsedCum.get(r)?.[I] || 0 : rootUsedPer.get(r)?.[I] || 0);
  const ranked = [...rootUsedCum.keys()].filter(r => used(r) > 0).sort((a, b) => used(b) - used(a) || firstSeen.get(a) - firstSeen.get(b));
  const keep = ranked.slice(0, geo.cols - 2).sort((a, b) => firstSeen.get(a) - firstSeen.get(b) || a.localeCompare(b));
  const rest = ranked.slice(geo.cols - 2);
  return { list: [...keep, ...(rest.length ? ['rest'] : []), 'none'], rest: new Set(rest), used };
}

// Rows for the current scope: group header, top senders, “其余 N 位”, and an opened tail.
function layoutRows(I, cols, extra = 0) {
  const out = [];
  const contribution = s => { const c = countsOf(s, I); return c.used * 1000 + c.total; };
  const roomRows = Math.floor((geo.H - geo.HEAD) / geo.rowH) - groups.length - 1 + extra;
  const active = groups.map(g => [g, membersOf.get(g).filter(s => countsOf(s, I).total > 0).sort((a, b) => contribution(b) - contribution(a) || a.name.localeCompare(b.name))]);
  const open = active.filter(([g, list]) => list.length && !isFolded(g, I));
  // Share the visible rows between unfolded groups, at least four each.
  let budget = roomRows - active.filter(([g, list]) => list.length && isFolded(g, I)).length - open.length;
  const limits = new Map(open.map(([g, list]) => [g, Math.min(list.length, g === 'you' ? 1 : 4)]));
  budget -= [...limits.values()].reduce((s, n) => s + n, 0);
  while (budget > 0) {
    const grow = open.filter(([g, list]) => limits.get(g) < list.length).sort((a, b) => (b[1].length - limits.get(b[0])) - (a[1].length - limits.get(a[0])))[0];
    if (!grow) break;
    limits.set(grow[0], limits.get(grow[0]) + 1); budget -= 1;
  }
  for (const [g, list] of active) {
    if (!list.length) continue;
    const c = sumCounts(list, I);
    if (g !== 'you' || isFolded(g, I)) out.push({ type: 'group', key: `g:${g}`, g, members: list, counts: c, folded: isFolded(g, I) });
    if (isFolded(g, I)) continue;
    const limit = limits.get(g);
    // A tail of one is shown as itself, not folded.
    const shown = list.length - limit === 1 ? list : list.slice(0, limit), rest = list.slice(shown.length);
    for (const s of shown) out.push({ type: 'sender', key: s.key, g, s, members: [s], counts: countsOf(s, I) });
    if (rest.length) {
      const openN = restOpen.get(g) || 0;
      out.push({ type: 'rest', key: `r:${g}`, g, members: rest, counts: sumCounts(rest, I), open: openN });
      for (const s of rest.slice(0, openN)) out.push({ type: 'sender', key: s.key, g, s, members: [s], counts: countsOf(s, I), tail: true });
      if (openN && rest.length > openN) out.push({ type: 'more', key: `m:${g}`, g, left: rest.length - openN });
    }
  }
  let y = 0, last = null;
  for (const row of out) {
    if (row.type === 'group' && last) y += geo.gap;
    row.y = y; row.h = row.type === 'group' ? geo.groupH : row.type === 'more' ? 20 : geo.rowH;
    y += row.h; last = row;
  }
  // The first guess leaves room for gaps and taller group rows; hand what is left back to the groups.
  const spare = Math.floor((geo.H - geo.HEAD - 8 - y) / geo.rowH);
  if (extra === 0 && spare > 0 && !out.some(r => r.type === 'more' || r.tail)) return layoutRows(I, cols, spare);
  return { rows: out, height: y };
}

// ---------- cells ----------
const glyph = (d, x, y) => d === 'used' ? `<circle cx="${x}" cy="${y}" r="3" fill="var(--ink)"/>`
  : d === 'duplicate' ? `<circle cx="${x}" cy="${y}" r="2.6" fill="none" stroke="var(--ink)" stroke-width="1.1"/>`
    : d === 'deferred' ? `<circle cx="${x}" cy="${y}" r="2.6" fill="none" stroke="var(--ink)" stroke-width="1" stroke-dasharray="1.4 1.2"/>`
      : d === 'noise' ? `<path d="M${x - 2.5} ${y - 2.5}L${x + 2.5} ${y + 2.5}M${x + 2.5} ${y - 2.5}L${x - 2.5} ${y + 2.5}" stroke="var(--ink-2)" stroke-width="1.1"/>`
        : `<circle cx="${x}" cy="${y}" r="2.4" fill="var(--line)"/>`;
function cellInputs(members, col, I, cols) {
  const out = [];
  for (const s of members) {
    if (col === 'rest') { for (const r of cols.rest) for (const x of s.pairs.get(r) || []) if (inScope(x, I)) out.push(x); }
    else for (const x of s.pairs.get(col) || []) if (inScope(x, I)) out.push(x);
  }
  return out;
}
function cellSVG(list, I, fresh) {
  const w = geo.colW - 10, h = geo.rowH - 4;
  if (mode === 'round') {
    const order = { used: 0, duplicate: 1, deferred: 2, noise: 3, unjudged: 4 };
    const sorted = [...list].sort((a, b) => order[a.d] - order[b.d]);
    const per = Math.floor(w / 7), lines = 2, cap = per * lines;
    let svg = '';
    sorted.slice(0, sorted.length > cap ? cap - 1 : cap).forEach((x, k) => { svg += glyph(x.d, 4 + (k % per) * 7, 5 + Math.floor(k / per) * 8); });
    if (sorted.length > cap) svg += `<text x="${4 + (cap - 1) % per * 7 - 2}" y="${5 + (lines - 1) * 8 + 3}" class="pv-more">+${sorted.length - cap + 1}</text>`;
    return `<svg width="${w}" height="${h}" class="${fresh ? 'is-fresh' : ''}">${svg}</svg>`;
  }
  // Cumulative: one thin column per frame; height grows with the count, the dark part is what was used.
  const byFrame = new Map();
  for (const x of list) { if (!byFrame.has(x.i)) byFrame.set(x.i, { used: 0, other: 0 }); byFrame.get(x.i)[x.d === 'used' ? 'used' : 'other'] += 1; }
  const xAt = i => 1 + i / (N - 1) * (w - 3);
  let svg = `<line x1="0" x2="${xAt(I).toFixed(1)}" y1="${h - 0.5}" y2="${h - 0.5}" class="pv-base"/>`;
  const bw = Math.max(1.4, (w - 3) / N - 0.5);
  for (const [i, c] of byFrame) {
    const n = c.used + c.other, hh = Math.min(h - 2, 2.5 + 3.1 * Math.log2(1 + n)), hu = hh * c.used / n;
    const x = xAt(i) - bw / 2;
    const cls = fresh && i === I ? ' class="is-new"' : '';
    if (c.other) svg += `<rect${cls} x="${x.toFixed(2)}" y="${(h - 1 - hh).toFixed(2)}" width="${bw.toFixed(2)}" height="${(hh - hu).toFixed(2)}" fill="var(--ink-3)"/>`;
    if (c.used) svg += `<rect${cls} x="${x.toFixed(2)}" y="${(h - 1 - hu).toFixed(2)}" width="${bw.toFixed(2)}" height="${hu.toFixed(2)}" fill="var(--ink)"/>`;
  }
  return `<svg width="${w}" height="${h}">${svg}</svg>`;
}
function tallyHTML(c) {
  if (!c.total) return '';
  const fill = { used: 'var(--ink)', duplicate: 'var(--ink-2)', deferred: 'var(--ink-3)', noise: 'var(--line)', unjudged: 'var(--faint)' };
  const W = geo.TALLY - 76;
  let x = 0, bars = '';
  for (const d of D) { if (!c[d]) continue; const w = W * c[d] / c.total; bars += `<i style="left:${x.toFixed(1)}px;width:${Math.max(1, w - 0.5).toFixed(1)}px;background:${fill[d]}"></i>`; x += w; }
  return `<span class="pv-prop" style="width:${W}px">${bars}</span><b>${c.total}</b><small>${c.used ? `${Math.round(c.used / c.total * 100)}%` : '0'}</small>`;
}
function labelHTML(row) {
  if (row.type === 'group') {
    const n = row.members.length;
    return `<button type="button" class="pv-fold" data-fold="${row.g}" aria-expanded="${!row.folded}" title="${row.folded ? '展开这一组' : '折成一行'}">${row.folded ? '▸' : '▾'}</button><b>${esc(groupNames[row.g] || row.g)}</b><span>${row.g === 'you' ? '' : `${n} 位`}${row.folded ? ' · 几乎都没进事项' : ''}</span>`;
  }
  if (row.type === 'rest') return `<button type="button" class="pv-fold" data-rest="${row.g}" aria-expanded="${Boolean(row.open)}" title="${row.open ? '收起' : '按贡献展开'}">${row.open ? '▾' : '▸'}</button><b class="pv-restname">其余 ${row.members.length} 位</b><span>${row.open ? '按贡献排序' : '按贡献展开'}</span>`;
  if (row.type === 'more') return `<button type="button" class="pv-more-btn" data-more="${row.g}">再显示 ${Math.min(40, row.left)} 位 · 还有 ${row.left} 位</button>`;
  const s = row.s;
  if (s.key === 'self') return `<b class="pv-you">${esc(s.name)}</b><span>你${s.names.size > 1 ? ` · ${s.names.size} 个署名合一行` : ''}</span>`;
  return `<b>${esc(s.name)}</b><span>${s.machine ? '机器 · ' : ''}${esc([...s.channels].map(c => c.replace(/^(GitHub|问答|论坛|CI|邮件列表|博客评论) · /, '$1 ')).slice(0, 2).join(' / '))}</span>`;
}

// ---------- render ----------
const rowEls = new Map(), headEls = new Map();
let current = null, lastIndex = null;
function render(I, previous = null) {
  const cols = columnsAt(I);
  const fresh = previous != null && I === previous + 1 && !reduced();
  const colX = new Map(cols.list.map((c, k) => [c, k * geo.colW]));
  // Column heads.
  const seenHeads = new Set();
  for (const c of cols.list) {
    seenHeads.add(c);
    let el = headEls.get(c);
    if (!el) { el = document.createElement('div'); el.className = 'pv-head is-born'; el.dataset.col = c; el.tabIndex = 0; figure.querySelector('.pv-heads').append(el); headEls.set(c, el); requestAnimationFrame(() => el.classList.remove('is-born')); }
    const used = c === 'rest' ? [...cols.rest].reduce((s, r) => s + cols.used(r), 0) : c === 'none' ? null : cols.used(c);
    const name = c === 'rest' ? `其余 ${cols.rest.size} 件事` : c === 'none' ? '没进任何事项' : shortOf(c);
    const html = `<b style="${c === 'rest' || c === 'none' ? '' : `color:${colorOf(c)}`}">${esc(name)}</b><small>${used != null ? `${used} 条采用` : '噪音与暂缓'}</small>${c === 'rest' || c === 'none' ? '' : `<i style="background:${colorOf(c)}"></i>`}`;
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
    el.classList.toggle('is-agg', c === 'rest' || c === 'none');
    el.style.transform = `translateX(${(geo.LABEL + colX.get(c)).toFixed(1)}px)`;
    el.style.width = `${geo.colW.toFixed(1)}px`;
  }
  for (const [c, el] of headEls) if (!seenHeads.has(c)) { headEls.delete(c); el.classList.add('is-gone'); setTimeout(() => el.remove(), 240); }
  // Rows.
  const { rows, height } = layoutRows(I, cols);
  figure.querySelector('.pv-inner').style.height = `${height}px`;
  const seen = new Set();
  for (const row of rows) {
    seen.add(row.key);
    let el = rowEls.get(row.key);
    if (!el) {
      el = document.createElement('div');
      el.className = `pv-row pv-${row.type} is-born`;
      el.dataset.key = row.key;
      el.innerHTML = '<div class="pv-label" tabindex="0"></div><div class="pv-cells"></div><div class="pv-tally"></div>';
      el.style.transform = `translateY(${row.y}px)`;
      figure.querySelector('.pv-inner').append(el);
      rowEls.set(row.key, el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-born')));
    }
    el.classList.toggle('is-tail', Boolean(row.tail));
    el.classList.toggle('is-folded', row.type === 'group' && row.folded);
    el.style.transform = `translateY(${row.y}px)`;
    el.style.height = `${row.h}px`;
    el.row = row;
    const label = labelHTML(row);
    const lab = el.firstChild;
    if (lab.dataset.html !== label) { lab.innerHTML = label; lab.dataset.html = label; }
    const tally = row.type === 'more' ? '' : tallyHTML(row.counts);
    if (el.lastChild.dataset.html !== tally) { el.lastChild.innerHTML = tally; el.lastChild.dataset.html = tally; }
    // Cells: only senders, folded groups and tails carry them; an open group's header does not repeat its members.
    const cellsBox = el.children[1];
    const carries = row.type === 'sender' || row.type === 'rest' || (row.type === 'group' && row.folded);
    const want = new Set();
    if (carries) for (const c of cols.list) {
      const list = cellInputs(row.members, c, I, cols);
      if (!list.length) continue;
      want.add(c);
      let cell = cellsBox.querySelector(`[data-col="${CSS.escape(c)}"]`);
      if (!cell) { cell = document.createElement('div'); cell.className = 'pv-cell is-born'; cell.dataset.col = c; cell.tabIndex = 0; cell.style.transform = `translateX(${colX.get(c).toFixed(1)}px)`; cellsBox.append(cell); requestAnimationFrame(() => requestAnimationFrame(() => cell.classList.remove('is-born'))); }
      const svg = cellSVG(list, I, fresh);
      if (cell.dataset.svg !== svg) { cell.innerHTML = svg; cell.dataset.svg = svg; }
      cell.style.transform = `translateX(${colX.get(c).toFixed(1)}px)`;
      cell.style.width = `${geo.colW.toFixed(1)}px`;
      cell.count = list.length;
    }
    for (const cell of [...cellsBox.children]) if (!want.has(cell.dataset.col)) cell.remove();
  }
  for (const [k, el] of rowEls) if (!seen.has(k)) { rowEls.delete(k); el.classList.add('is-gone'); setTimeout(() => el.remove(), 240); }
  current = { I, cols, rows };
  lastIndex = I;
  applyLight();
}
function build() {
  geo = measure();
  rowEls.clear(); headEls.clear();
  figure.style.setProperty('--label', `${geo.LABEL}px`);
  figure.style.setProperty('--tally', `${geo.TALLY}px`);
  figure.style.setProperty('--head', `${geo.HEAD}px`);
  figure.innerHTML = `<div class="pv-top"><b class="pv-h-src">来源 <small>按流分组，组内按贡献</small></b><b class="pv-h-tally">全部输入 <small>怎么判 · 条数 · 采用</small></b></div>
    <div class="pv-heads"></div><div class="pv-body"><div class="pv-inner"></div></div>`;
  render(stage.index);
}
stage.onFrame((next, previous) => render(next, previous));

// ---------- focus, pin, detail ----------
let hover = null, pinned = null;
function applyLight() {
  const f = hover || pinned;
  figure.classList.toggle('has-focus', Boolean(f));
  for (const el of figure.querySelectorAll('.is-on, .is-feeder, .is-fed')) el.classList.remove('is-on', 'is-feeder', 'is-fed');
  if (!f) return;
  const rowEl = f.row && rowEls.get(f.row);
  if (f.row && rowEl) {
    rowEl.classList.add('is-on');
    if (!f.col) for (const cell of rowEl.querySelectorAll('.pv-cell')) { cell.classList.add('is-fed'); headEls.get(cell.dataset.col)?.classList.add('is-fed'); }
  }
  if (f.col) {
    headEls.get(f.col)?.classList.add('is-on');
    for (const el of rowEls.values()) {
      const cell = el.querySelector(`.pv-cell[data-col="${CSS.escape(f.col)}"]`);
      if (cell) { cell.classList.add(f.row && el !== rowEl ? 'is-fed' : 'is-on'); if (!f.row) el.classList.add('is-feeder'); }
    }
  }
}
const rowOf = k => current.rows.find(r => r.key === k);
function inputLine(x) {
  return `<li><div><time>${esc(dayTime(x.e.at))}</time><span class="pv-d pv-d-${x.d}">${dWord[x.d]}</span><small>${esc(x.e.channel || '')}${x.e.from && !isSelf(x.e) ? '' : ''}</small></div>
    <p>${esc(x.e.why || '')}</p>${x.roots.length ? `<p class="pv-roots">${x.roots.slice(0, 4).map(r => chip(r)).join(' ')}</p>` : ''}
    <details><summary>来源原文${isSelf(x.e) ? '' : ` · ${esc(x.e.from)}`}</summary><p class="st-original">${esc(x.e.text || '')}</p>${x.e.url ? `<a href="${esc(x.e.url)}" target="_blank" rel="noreferrer">原链接（化名，可能打不开）↗</a>` : ''}</details></li>`;
}
const chip = id => `<span class="pv-chip" role="button" tabindex="0" data-pin-col="${esc(id)}" style="--c:${colorOf(id)}">${esc(shortOf(id))}</span>`;
const countsLine = c => D.filter(d => c[d]).map(d => `${dWord[d]} ${c[d]}`).join(' · ');
const scopeWord = I => (mode === 'cum' ? `到 ${dayTime(frames[I].at)} 为止` : `${dayTime(frames[I].at)} 这一轮`);
function feeds(members, I) {
  const by = new Map();
  for (const s of members) for (const [col, list] of s.pairs) if (col !== 'none') for (const x of list) if (inScope(x, I) && x.d === 'used') by.set(col, (by.get(col) || 0) + 1);
  return [...by.entries()].sort((a, b) => b[1] - a[1]);
}
function detail(I) {
  const p = pinned;
  const scope = scopeWord(I);
  if (p.col && !p.row) {
    const c = p.col;
    if (c === 'none' || c === 'rest') {
      const cols = current.cols;
      return { kicker: `列 · 固定 · ${scope}`, title: c === 'none' ? '没进任何事项的输入' : `其余 ${cols.rest.size} 件事`,
        body: c === 'none' ? '<p>判为噪音、暂缓或重复，没有关联到任何事项的输入。真实系统里，这些处置现在只在演示数据里有（见概念卡“状态缺的”）。</p>'
          : `<p>采用条数不在前 ${geo.cols - 2} 的事项合成这一列：</p><p class="pv-chips">${[...cols.rest].map(r => `<span class="pv-cn">${chip(r)}<small>${cols.used(r)}</small></span>`).join(' ')}</p>` };
    }
    const feeders = [...senders.values()].map(s => [s, (s.pairs.get(c) || []).filter(x => inScope(x, I))]).filter(([, l]) => l.length)
      .sort((a, b) => b[1].filter(x => x.d === 'used').length - a[1].filter(x => x.d === 'used').length || b[1].length - a[1].length);
    const lead = `<section><h4>谁推动它 <small>${scope} · ${feeders.length} 个来源</small></h4><ul class="pv-feeders">${feeders.slice(0, 10).map(([s, l]) => `<li><span>${esc(s.key === 'self' ? `${s.name}（你）` : s.name)}</span><b>${l.filter(x => x.d === 'used').length}</b><small>/ ${l.length}</small></li>`).join('')}</ul>${feeders.length > 10 ? `<p class="st-muted">另有 ${feeders.length - 10} 个来源。</p>` : ''}</section>`;
    const item = records[I].snapshot.items[c];
    return { kicker: `事项 · ${item ? kindWord(item) : '尚未出现'} · 固定`, title: `<span class="pv-title-chip" style="--c:${colorOf(c)}"></span>${esc(titleAt(c, I))}`, body: itemDetailHTML(c, I, { lead }) };
  }
  const row = rowOf(p.row);
  if (!row) return { kicker: '来源 · 固定', title: '这一行此刻不在矩阵里', body: `<p class="st-muted">${scope}，这个来源还没有输入，或已折进“其余”。</p>` };
  const members = row.members;
  if (p.col) {
    const list = cellInputs(members, p.col, I, current.cols).sort((a, b) => b.i - a.i || Date.parse(b.e.at) - Date.parse(a.e.at));
    const c = Object.fromEntries(D.map(d => [d, list.filter(x => x.d === d).length]));
    const name = row.type === 'sender' ? row.s.name : row.type === 'rest' ? `其余 ${members.length} 位` : groupNames[row.g];
    const colName = p.col === 'none' ? '没进任何事项' : p.col === 'rest' ? '其余事项' : shortOf(p.col);
    return { kicker: `来源 × 事项 · 固定 · ${scope}`, title: `${esc(name)} → ${esc(colName)}`,
      body: `<p class="pv-counts"><b>${list.length} 条</b>${countsLine(c)}</p><p class="st-muted">${[...new Set(list.map(x => formatDay(x.i)))].join('、')}</p>
        <ul class="pv-inputs">${list.slice(0, 14).map(inputLine).join('')}</ul>${list.length > 14 ? `<p class="st-muted">更早还有 ${list.length - 14} 条，见“状态 · 原始输入”。</p>` : ''}` };
  }
  const all = members.flatMap(s => s.inputs.filter(x => inScope(x, I))).sort((a, b) => b.i - a.i || Date.parse(b.e.at) - Date.parse(a.e.at));
  const c = row.counts;
  const fed = feeds(members, I);
  const self = row.type === 'sender' && row.s.key === 'self';
  const title = row.type === 'sender' ? esc(self ? `${row.s.name}（你）` : row.s.name) : row.type === 'rest' ? `${esc(groupNames[row.g])} · 其余 ${members.length} 位` : `${esc(groupNames[row.g])} · ${members.length} 位`;
  const topSenders = row.type === 'sender' ? '' : `<section><h4>按贡献 <small>前 12 位</small></h4><ul class="pv-feeders">${members.slice(0, 12).map(s => { const k = countsOf(s, I); return `<li><span>${esc(s.name)}</span><b>${k.used}</b><small>/ ${k.total}</small></li>`; }).join('')}</ul></section>`;
  const acts = self ? foldSentences(frames.slice(0, I + 1).flatMap((f, i) => (mode === 'cum' || i === I ? responsesIn(i) : []))) : [];
  return {
    kicker: `${row.type === 'sender' ? '来源' : '折叠的来源'} · 固定 · ${scope}`, title,
    body: `${self ? `<p class="st-muted">${[...row.s.names].map(esc).join(' · ')}：同一个人在不同平台的署名，合成一行。</p>` : row.type === 'sender' ? `<p class="st-muted">${[...row.s.channels].map(esc).join(' · ')}${row.s.machine ? ' · 机器' : ''}</p>` : ''}
      <p class="pv-counts"><b>${c.total} 条</b>${countsLine(c)}</p>
      ${fed.length ? `<section><h4>用到了哪些事 <small>采用条数</small></h4><p class="pv-chips">${fed.slice(0, 16).map(([r, n]) => `<span class="pv-cn">${chip(r)}<small>${n}</small></span>`).join(' ')}</p></section>` : '<p class="st-muted">没有一条被用到任何事项。</p>'}
      ${acts.length ? `<section><h4>你在来源处的动作 <small>写成动作，不贴原文</small></h4><ul class="pv-acts">${acts.slice(-10).map(x => `<li>${esc(x.label)}</li>`).join('')}</ul></section>` : ''}
      ${topSenders}
      <section><h4>最近的输入</h4><ul class="pv-inputs">${all.slice(0, 8).map(inputLine).join('')}</ul></section>`,
  };
}
const formatDay = i => dayTime(frames[i].at).replace(/\s.*/, '');
function overview(I) {
  const all = [...senders.values()];
  const c = sumCounts(all, I);
  const cols = current?.cols || columnsAt(I);
  const top = cols.list.filter(x => x !== 'rest' && x !== 'none').sort((a, b) => cols.used(b) - cols.used(a)).slice(0, 5);
  const feederNames = r => [...senders.values()].map(s => [s, (s.pairs.get(r) || []).filter(x => inScope(x, I) && x.d === 'used').length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, n]) => `${s.key === 'self' ? '你' : s.name} ${n}`);
  const byGroup = groups.map(g => [g, sumCounts(membersOf.get(g), I)]).filter(([, k]) => k.total);
  return {
    kicker: `${mode === 'cum' ? '累计到此刻' : '只看本轮'} · ${frames[I].id}`,
    title: `${c.total} 条输入，${c.used} 条被用到事项里`,
    body: `<ul class="pv-groups">${byGroup.map(([g, k]) => `<li><b>${esc(groupNames[g] || g)}</b><span class="pv-prop pv-prop-s">${D.filter(d => k[d]).map(d => `<i class="pv-${d}" style="flex:${k[d]}"></i>`).join('')}</span><small>${k.total} · ${Math.round(k.used / k.total * 100)}%</small></li>`).join('')}</ul>
      ${top.length ? `<section><h4>推动最多的事 <small>采用最多的三个来源</small></h4><ul class="pv-top5">${top.map(r => `<li>${chip(r)}<small>${feederNames(r).map(esc).join(' · ')}</small></li>`).join('')}</ul></section>` : ''}
      <p class="st-muted">点格子看那几条输入与 Agent 的判断理由；点来源名看它喂了哪些事；点列头看这件事的详情。</p>`,
  };
}
stage.onEscape = () => { if (!pinned) return false; pinned = null; applyLight(); stage.showDetail(null); return true; };

// ---------- pointer and keyboard ----------
function targetOf(node) {
  const cell = node.closest?.('.pv-cell'), label = node.closest?.('.pv-label'), head = node.closest?.('.pv-head');
  if (cell) return { row: cell.closest('.pv-row').dataset.key, col: cell.dataset.col, el: cell };
  if (label) return { row: label.closest('.pv-row').dataset.key, el: label };
  if (head) return { col: head.dataset.col, el: head };
  return null;
}
function tipFor(t) {
  const I = stage.index;
  if (t.col && !t.row) {
    if (t.col === 'none') return '没进任何事项的输入';
    if (t.col === 'rest') return `其余 ${current.cols.rest.size} 件事合成一列`;
    return `<b>${esc(titleAt(t.col, I))}</b><br>${current.cols.used(t.col)} 条采用 · 点击看谁推动它`;
  }
  const row = rowOf(t.row);
  if (!row) return '';
  const name = row.type === 'sender' ? (row.s.key === 'self' ? `${row.s.name}（你）` : row.s.name) : row.type === 'rest' ? `其余 ${row.members.length} 位` : `${groupNames[row.g]} · ${row.members.length} 位`;
  if (t.col) {
    const list = cellInputs(row.members, t.col, I, current.cols);
    const k = Object.fromEntries(D.map(d => [d, list.filter(x => x.d === d).length]));
    const days = [...new Set(list.map(x => formatDay(x.i)))];
    return `<b>${esc(name)} → ${esc(t.col === 'none' ? '没进事项' : t.col === 'rest' ? '其余事项' : shortOf(t.col))}</b><br>${list.length} 条：${countsLine(k)}<br><small>${days.slice(0, 6).join('、')}${days.length > 6 ? ` 等 ${days.length} 天` : ''} · 点击看原话与判断理由</small>`;
  }
  if (row.type === 'more') return '';
  return `<b>${esc(name)}</b><br>${row.counts.total} 条：${countsLine(row.counts)}${row.type === 'sender' && row.s.key === 'self' ? `<br><small>${[...row.s.names].map(esc).join(' · ')}</small>` : ''}`;
}
figure.addEventListener('pointerover', event => {
  const t = targetOf(event.target);
  if (!t) return;
  hover = { row: t.row, col: t.col };
  applyLight();
  const tip = tipFor(t);
  if (tip) stage.tip(tip, t.el); else stage.untip();
});
figure.addEventListener('pointerleave', () => { hover = null; applyLight(); stage.untip(); });
figure.addEventListener('focusin', event => { const t = targetOf(event.target); if (t) { hover = { row: t.row, col: t.col }; applyLight(); const tip = tipFor(t); if (tip) stage.tip(tip, t.el); } });
figure.addEventListener('focusout', () => { hover = null; applyLight(); stage.untip(); });
function toggleFold(g) {
  const was = isFolded(g, stage.index);
  if (was) { unfolded.add(g); folded.delete(g); } else { folded.add(g); unfolded.delete(g); }
  render(stage.index);
}
function choose(t) {
  if (!t) return;
  const same = pinned && pinned.row === t.row && pinned.col === t.col;
  pinned = same ? null : { row: t.row, col: t.col };
  applyLight();
  stage.showDetail(pinned ? detail : null);
}
figure.addEventListener('click', event => {
  const fold = event.target.closest('[data-fold]'), rest = event.target.closest('[data-rest]'), more = event.target.closest('[data-more]');
  if (fold) { toggleFold(fold.dataset.fold); return; }
  if (rest) { const g = rest.dataset.rest; restOpen.set(g, restOpen.get(g) ? 0 : 40); render(stage.index); return; }
  if (more) { const g = more.dataset.more; restOpen.set(g, (restOpen.get(g) || 0) + 40); render(stage.index); return; }
  choose(targetOf(event.target));
});
figure.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  const t = targetOf(event.target);
  if (!t) return;
  event.preventDefault();
  const row = t.row && rowOf(t.row);
  // Enter on a folded row's name opens it; elsewhere it pins.
  if (!t.col && row?.type === 'group') toggleFold(row.g);
  else if (!t.col && row?.type === 'rest') { restOpen.set(row.g, row.open ? 0 : 40); render(stage.index); }
  else choose(t);
});
const side = document.querySelector('.st-side');
side.addEventListener('click', event => { const c = event.target.closest('[data-pin-col]'); if (c) { pinned = { col: c.dataset.pinCol }; applyLight(); stage.showDetail(detail); } });
side.addEventListener('keydown', event => { const c = event.target.closest('[data-pin-col]'); if (c && event.key === 'Enter') { event.preventDefault(); c.click(); } });
side.addEventListener('pointerover', event => { const c = event.target.closest('[data-pin-col]'); const next = c ? { col: c.dataset.pinCol } : null; if (JSON.stringify(next) !== JSON.stringify(hover)) { hover = next; applyLight(); } });
side.addEventListener('pointerleave', () => { if (hover) { hover = null; applyLight(); } });
function setMode(next) {
  if (next === mode) return;
  mode = next;
  document.querySelectorAll('[data-pv-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pvMode === mode)));
  figure.classList.toggle('is-round', mode === 'round');
  // A change of scope reorders almost every row: fade the matrix out and back in rather than let rows cross.
  const swap = () => {
    figure.classList.add('no-glide');
    stage.measure(() => render(stage.index));
    void figure.offsetWidth;
    figure.classList.remove('no-glide', 'is-swapping');
    stage.refreshSide();
    stage.showDetail(pinned ? detail : null);
  };
  if (reduced()) { swap(); return; }
  figure.classList.add('is-swapping');
  clearTimeout(setMode.timer);
  setMode.timer = setTimeout(swap, 130);
}
document.querySelector('.st-tools').addEventListener('click', event => { const b = event.target.closest('[data-pv-mode]'); if (b) setMode(b.dataset.pvMode); });
stage.onKey = event => {
  if (event.key === 't' || event.key === 'T') { setMode(mode === 'cum' ? 'round' : 'cum'); return true; }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
  if (document.activeElement?.closest('.st-side')) return false;
  const t = targetOf(document.activeElement || document.body);
  const order = current.rows.filter(r => r.type !== 'more');
  let k = t?.row ? order.findIndex(r => r.key === t.row) : -1;
  k = Math.max(0, Math.min(order.length - 1, k + (event.key === 'ArrowUp' ? -1 : 1)));
  const el = rowEls.get(order[k].key);
  const target = (t?.col && el.querySelector(`.pv-cell[data-col="${CSS.escape(t.col)}"]`)) || el.querySelector('.pv-label');
  target.focus();
  target.scrollIntoView({ block: 'nearest' });
  return true;
};
let resizeTimer = null;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(build, 120); });
build();
stage.setOverview(overview);
