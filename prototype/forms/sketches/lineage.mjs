// 01 身份线（完整版）：每件根层事项是一条竖线，从上往下是每一次整理（等距，像线路图的站）。线宽 = 这一版的份额；
// 站点 = 这一版改了份额、类型或名字；只改措辞的连续改写并进前一站，站名用“〃”省去与上一站相同的前缀。
// 撤下时线断开，恢复时同一身份接上；并入时连向另一条线。线左侧的细括号是登记过的问题：◆ 登记，✓ 答后关上，
// × 改写后失效，⊥ 随事项撤下，此刻仍开着的带一个向下的箭头。
//
// 按流分区（工作、家庭、生活、社区），每区画两周累计份额最多的 3 件；其余折成一束（宽 = 这些事份额之和），点开
// 展开成没有站名的细线，悬停看名字。颜色只表示事项身份：与两周小倍数相同，只有累计份额前 8 的事有颜色。
import { frames, records, at, dayOf, weekdayOf, formatTime, fitText, textWidth } from './kit.mjs';
import {
  mountLivePage, rootIds, factOf, streamOf, STREAMS, hasStreams, topColor, OTHER_COLOR, versionsOf, stationsOf, pathsOfItem,
  pathStatus, pathByKey, itemAt, dossierHTML, kindLabel, CLOSE_WORDS, EXPECT_WORDS, tween, timed, markHover, createTip, createDrawer,
  esc, span, dayTime, categoryName, openFor,
} from './live.mjs';

const KEY = `
  <span><i style="background:${OTHER_COLOR}"></i>颜色只表示事项身份；前 8 件有颜色</span>
  <span><svg width="40" height="12"><rect x="0" y="4" width="3" height="4" fill="#8f8a7d"/><rect x="8" y="2" width="8" height="8" fill="#8f8a7d"/><rect x="22" y="0" width="16" height="12" fill="#8f8a7d"/></svg>线宽 = 份额（1 → 24）</span>
  <span><svg width="58" height="12"><circle cx="6" cy="6" r="4" fill="var(--ink)" stroke="#fff" stroke-width="1.2"/><circle cx="20" cy="6" r="3.8" fill="#fff" stroke="var(--ink)" stroke-width="1.3"/><circle cx="34" cy="6" r="3.8" fill="#fff" stroke="var(--ink)" stroke-width="1.3"/><circle cx="34" cy="6" r="1.5" fill="var(--ink)"/><rect x="45" y="2.2" width="7.6" height="7.6" fill="#fff" stroke="var(--ink)" stroke-width="1.3"/></svg>等你 · 进行中 · 已完成 · 知会</span>
  <span>〃 = 与上一站相同的前缀；只改措辞的改写并进前一站</span>
  <span><svg width="26" height="14"><path d="M4 2 L7 5 L4 8 L1 5 Z" fill="var(--ink)"/><line x1="4" y1="8" x2="4" y2="14" stroke="var(--ink)" stroke-width="1.4"/><text x="10" y="12" font-size="10" fill="var(--ink)">✓</text><text x="18" y="12" font-size="10" fill="var(--ink-2)">×</text></svg>问题：登记 · 答后关上 · 改写后失效</span>
  <span><svg width="22" height="12"><line x1="2" y1="3" x2="20" y2="3" stroke="var(--ink)" stroke-width="2"/><line x1="11" y1="3" x2="11" y2="12" stroke="#8f8a7d" stroke-dasharray="1.5 2.5"/></svg>撤下 · 虚线 = 身份保留</span>
  <span>◷ 定时复查 · ✓ 检查后无变化（左侧时间旁）</span>
  <span><svg width="22" height="14"><rect x="1" y="0" width="18" height="14" fill="#ddd8cb"/></svg>其余折成一束，宽 = 份额之和</span>`;

const page = mountLivePage({
  id: 'lineage', no: 1, name: '身份线', key: KEY, side: false, storyFrame: 36, playEvery: 900,
  relation: '同一件事在两周里被改写成什么：每段时间叫什么、占多大，何时撤下又以同一身份恢复，何时与另一件并成一件，问题何时开、何时关。',
  onFrame, onKey,
});
const { figure } = page;
figure.innerHTML = '<div class="ln-scroll"><div class="ln-gutter"></div><div class="ln-main"></div></div>';
const scroller = figure.querySelector('.ln-scroll'), gutterEl = figure.querySelector('.ln-gutter'), mainEl = figure.querySelector('.ln-main');
const tip = createTip(figure);
const drawer = createDrawer(page.body, { onClose: () => { pinned = null; applyHot(); } });

// ---------- zones ----------
const TOP_N = hasStreams ? 3 : Infinity;
const lived = rootIds.filter(id => factOf(id).cum > 0);
const zoneOf = id => (hasStreams ? streamOf(id) || 'work' : 'all');
const byFirst = (a, b) => factOf(a).first - factOf(b).first || (a < b ? -1 : 1);
const zones = (hasStreams ? ['work', 'family', 'life', 'community', 'subscription'] : ['all']).map(z => {
  const ids = lived.filter(id => zoneOf(id) === z).sort((a, b) => factOf(b).cum - factOf(a).cum || byFirst(a, b));
  return { z, label: hasStreams ? STREAMS[z].label : '全部', total: ids.length, top: ids.slice(0, TOP_N).sort(byFirst), rest: ids.slice(TOP_N).sort(byFirst) };
}).filter(zone => zone.total);
const params = new URLSearchParams(location.search);
const expanded = new Set((params.get('open') || '').split(',').filter(z => zones.some(zone => zone.z === z)));
const lineColor = id => topColor(id) || '#8f8a7d';
const restColor = id => topColor(id) || OTHER_COLOR;

// Tracks for an expanded remainder: items that never overlap in time share a track.
function packTracks(ids) {
  const tracks = [];
  for (const id of ids) {
    const f = factOf(id), end = f.hist.findLastIndex(Boolean) + 1;
    const track = tracks.find(t => t.free < f.first);
    if (track) { track.ids.push(id); track.free = end; } else tracks.push({ ids: [id], free: end });
  }
  return tracks;
}

// ---------- station labels ----------
const BOUNDARY = /[：:，,、；;\s]/;
/** Replace a prefix shared with the previous name by “〃”, cut at a word boundary. */
function ditto(prev, name) {
  if (!prev) return name;
  const a = [...prev], b = [...name];
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k += 1;
  let cut = -1;
  for (let i = k - 1; i >= 3; i -= 1) if (BOUNDARY.test(b[i])) { cut = i + 1; break; }
  if (cut < 0 && k >= 6 && k < b.length && /[一-鿿]/.test(b[k]) && /[A-Za-z0-9 ]/.test(b[k - 1] || '')) cut = k;
  if (cut < 4 || b.length - cut < 2) return name;
  return `〃${b.slice(cut).join('').replace(/^\s+/, '')}`;
}
function stationText(station, prevName) {
  const first = station.versions[0], item = first.item;
  if (station.change === 'new') return { text: item.title, kind: 'name' };
  if (station.change === 'restored') return { text: `↺ ${ditto(prevName, item.title)}`, kind: 'name' };
  if (station.change === 'withdrawn' || station.change === 'merged') return null;
  if (item.title !== first.prev.title) return { text: ditto(prevName, item.title), kind: 'name' };
  const bits = [];
  if (first.prev.share !== item.share) bits.push(`${first.prev.share}→${item.share} 份`);
  if (first.prev.kind !== item.kind) bits.push(kindLabel[item.kind]);
  return { text: bits.join(' · ') || '改写', kind: 'tag' };
}

// ---------- geometry ----------
const MONO = getComputedStyle(document.documentElement).getPropertyValue("--mono") || "monospace";
const GUT = 86, HEAD = 62, COL_MIN = 112, COL_MAX = 230, BUNDLE = 54, TRACK = 22, ZONE_GAP = 14;
const bandW = share => Math.min(24, share) * 0.92 + 1.6;
let L = null;
function layout() {
  const W = scroller.clientWidth, H = scroller.clientHeight;
  const rowH = (H - HEAD - 10) / frames.length;
  const y = i => HEAD + rowH * (i + 0.5);
  // Column width is set by the folded layout, so expanding a remainder only inserts tracks and the rest
  // slides right (the figure scrolls sideways when it no longer fits).
  const tops = zones.reduce((n, zone) => n + zone.top.length, 0);
  const fixed = zones.reduce((n, zone) => n + (zone.rest.length ? BUNDLE : 0), 0) + ZONE_GAP * (zones.length - 1);
  const colW = Math.max(COL_MIN, Math.min(COL_MAX, (W - GUT - fixed - 8) / tops));
  const cols = [];
  let x = 0;
  for (const zone of zones) {
    zone.x = x;
    for (const id of zone.top) { cols.push({ id, zone: zone.z, x, w: colW, kind: 'top' }); x += colW; }
    if (zone.rest.length) {
      if (expanded.has(zone.z)) {
        zone.tracks = packTracks(zone.rest);
        zone.tracks.forEach((track, k) => track.ids.forEach(id => cols.push({ id, zone: zone.z, x: x + 4 + k * TRACK, w: TRACK, kind: 'track' })));
        x += zone.tracks.length * TRACK + 8;
      } else { cols.push({ id: `rest:${zone.z}`, zone: zone.z, x, w: BUNDLE, kind: 'bundle' }); x += BUNDLE; }
    }
    zone.w = x - zone.x;
    x += ZONE_GAP;
  }
  return { W, H, rowH, y, colW, cols, width: Math.max(W - GUT, x - ZONE_GAP + 8), colById: new Map(cols.map(c => [c.id, c])) };
}
const axisOf = col => (col.kind === 'top' ? col.x + 22 : col.kind === 'track' ? col.x + TRACK / 2 : col.x + BUNDLE / 2);

function kindGlyph(kind, cx, cy, small = false) {
  const r = small ? 2.6 : 4.1;
  if (kind === 'needs-you') return `<circle cx="${cx}" cy="${cy}" r="${r + 0.2}" class="ln-g-you"/>`;
  if (kind === 'fyi') return `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" class="ln-g"/>`;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" class="ln-g"/>${kind === 'done' ? `<circle cx="${cx}" cy="${cy}" r="${small ? 1 : 1.5}" class="ln-g-dot"/>` : ''}`;
}

/** One identity line: bands, gaps, stations, labels, merges, asks. */
function lineSVG(col, { y, rowH }) {
  const id = col.id, f = factOf(id), hist = f.hist, ax = axisOf(col), color = col.kind === 'top' ? lineColor(id) : restColor(id);
  const last = frames.length - 1;
  let band = '', marks = '', labels = '', asks = '';
  hist.forEach((item, i) => {
    if (item?.status !== 'active') return;
    const w = bandW(item.share), y0 = y(i), y1 = i === last ? y(i) + rowH / 2 : y(i + 1);
    band += `<rect x="${(ax - w / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${w.toFixed(1)}" height="${(y1 - y0 + 0.4).toFixed(1)}"/>`;
  });
  const labelX = ax + 15, labelW = col.w - (labelX - col.x) - 6;
  const taken = new Set();
  const place = (row, text, cls, maxLines = 1) => {
    if (col.kind !== 'top') return;
    while (taken.has(row)) row += 1;
    if (row > last) return;
    let free = 1;
    while (free < maxLines && !taken.has(row + free) && row + free <= last) free += 1;
    const fit = fitText(text, labelW, cls === 'ln-name' ? 11 : 9.5, { twoLines: free > 1, minSize: 9, weight: cls === 'ln-name' ? 450 : 400 });
    fit.lines.forEach((line, n) => { taken.add(row + n); labels += `<text x="${labelX.toFixed(1)}" y="${(y(row + n) + fit.size * 0.36).toFixed(1)}" class="${cls}" font-size="${fit.size}" data-row="${row + n}">${esc(line)}</text>`; });
  };
  // Stations: glyph on the first version; tiny ticks for the rewrites folded into it.
  let prevName = null;
  const stations = stationsOf(id);
  const pending = [];
  stations.forEach((station, k) => {
    const first = station.versions[0];
    if (first.item.status === 'active') {
      marks += `<g class="ln-station" data-item="${esc(id)}" data-station="${k}">${kindGlyph(first.item.kind, ax, y(station.index), col.kind !== 'top')}<circle cx="${ax}" cy="${y(station.index)}" r="8" class="ln-hit"/></g>`;
      for (const v of station.versions.slice(1)) marks += `<line x1="${(ax + bandW(v.item.share) / 2 + 1.5).toFixed(1)}" x2="${(ax + bandW(v.item.share) / 2 + 4.5).toFixed(1)}" y1="${y(v.index).toFixed(1)}" y2="${y(v.index).toFixed(1)}" class="ln-rewrite"/>`;
      const label = stationText(station, prevName);
      const nextRow = stations[k + 1]?.index ?? last + 1;
      if (label) pending.push({ row: station.index, text: label.text, cls: label.kind === 'name' ? 'ln-name' : 'ln-tag', lines: Math.min(2, nextRow - station.index) });
      // Inside a folded station: a reworded name is written where it appeared ("→ 〃…"); otherwise count the rewrites.
      const renamed = station.versions.filter((v, j) => j && v.item.title !== station.versions[j - 1].item.title);
      if (renamed.length) {
        const v = renamed.at(-1);
        pending.push({ row: v.index, text: `→ ${ditto(station.first.title, v.item.title)}`, cls: 'ln-name is-sub', lines: 1, soft: true });
      } else if (station.versions.length > 1 && nextRow - station.index > 2) pending.push({ row: station.index + 2, text: `+${station.versions.length - 1} 次措辞`, cls: 'ln-tag', lines: 1, soft: true });
      prevName = station.last.title;
    } else if (first.item.status === 'withdrawn') {
      const back = hist.findIndex((h, j) => j > station.index && h?.status === 'active');
      marks += `<line x1="${ax - 8}" x2="${ax + 8}" y1="${y(station.index)}" y2="${y(station.index)}" class="ln-cut"/>`;
      if (back > 0) band += `<line x1="${ax}" x2="${ax}" y1="${(y(station.index) + 3).toFixed(1)}" y2="${(y(back) - 5).toFixed(1)}" class="ln-thread" style="stroke:${color}"/>`;
      pending.push({ row: station.index, text: back > 0 ? `撤下 · ${back - station.index} 轮后恢复` : '撤下', cls: 'ln-tag', lines: 1 });
    } else if (first.item.status === 'merged') {
      const target = first.item.merged_into, tcol = L?.colById?.get(target) || null;
      marks += `<line x1="${ax - 8}" x2="${ax + 8}" y1="${y(station.index)}" y2="${y(station.index)}" class="ln-cut"/>`;
      pending.push({ row: station.index, text: `并入「${itemAt(target, station.index)?.title || target}」`, cls: 'ln-tag', lines: 2, merge: target, tcol });
    }
  });
  for (const p of pending.sort((a, b) => a.row - b.row || (a.soft ? 1 : -1))) if (!p.soft || !taken.has(p.row)) place(p.row, p.text, p.cls, p.lines);
  // Asks: a bracket left of the band.
  if (col.kind === 'top') {
    const bx = col.x + 6;
    for (const path of pathsOfItem(id)) {
      const ya = y(path.from), yb = path.to == null ? y(last) + rowH / 2 : y(path.to);
      const s = pathStatus(path, last);
      const cap = s.state !== 'closed' ? '' : s.how === 'answered' ? `<text x="${bx}" y="${(yb + 3.6).toFixed(1)}" class="ln-cap">✓</text>`
        : s.how === 'lapsed' ? `<text x="${bx}" y="${(yb + 3.6).toFixed(1)}" class="ln-cap is-dim">×</text>`
          : s.how === 'replaced' ? `<line x1="${bx - 3}" x2="${bx + 3}" y1="${yb}" y2="${yb}" class="ln-askline"/>`
            : `<line x1="${bx - 4}" x2="${bx + 4}" y1="${yb}" y2="${yb}" class="ln-askline is-thick"/>`;
      asks += `<g class="ln-ask" data-path="${esc(path.key)}" data-item="${esc(id)}"><line x1="${bx}" x2="${bx}" y1="${(ya + 4).toFixed(1)}" y2="${(yb - (s.state === 'closed' && (s.how === 'answered' || s.how === 'lapsed') ? 5 : 0)).toFixed(1)}" class="ln-askline"/>
        <path d="M${bx} ${(ya - 4).toFixed(1)} L${bx + 3.4} ${ya.toFixed(1)} L${bx} ${(ya + 4).toFixed(1)} L${bx - 3.4} ${ya.toFixed(1)} Z" class="ln-askhead"/>${cap}
        <rect x="${bx - 6}" y="${(ya - 5).toFixed(1)}" width="12" height="${(yb - ya + 10).toFixed(1)}" class="ln-hit"/></g>`;
    }
  }
  return `<g class="ln-line" data-item="${esc(id)}"><rect class="ln-colhit" x="${col.x}" y="${HEAD}" width="${col.w}" height="${L.H - HEAD}" data-item="${esc(id)}"/><g class="ln-band" fill="${color}">${band}</g>${asks}${marks}${labels}</g>`;
}

/** Merge connectors: from the last row of a merged line to its target, when both are drawn. */
function mergeSVG({ y, colById }) {
  let out = '';
  for (const col of colById.values()) {
    if (col.kind === 'bundle') continue;
    const station = stationsOf(col.id).find(s => s.versions[0].item.status === 'merged');
    if (!station) continue;
    const tcol = colById.get(station.versions[0].item.merged_into);
    if (!tcol || tcol.kind === 'bundle') continue;
    const a = axisOf(col), b = axisOf(tcol), ya = y(station.index - 1) + 2, yb = y(station.index) + 6;
    out += `<path d="M${a} ${ya} C ${a} ${yb}, ${b} ${ya}, ${b} ${yb}" class="ln-merge" style="stroke:${col.kind === 'top' ? lineColor(col.id) : restColor(col.id)}" data-item="${esc(col.id)}"/>`;
  }
  return out;
}

function bundleSVG(col, zone, { y, rowH }) {
  const sums = frames.map((_, i) => zone.rest.reduce((n, id) => n + (factOf(id).hist[i]?.status === 'active' ? factOf(id).hist[i].share : 0), 0));
  const counts = frames.map((_, i) => zone.rest.filter(id => factOf(id).hist[i]?.status === 'active').length);
  const scale = Math.min(0.92, (BUNDLE - 14) / Math.max(1, ...sums));
  const ax = axisOf(col);
  let band = '';
  sums.forEach((sum, i) => {
    if (!sum) return;
    const w = sum * scale + 1, y0 = y(i), y1 = i === frames.length - 1 ? y(i) + rowH / 2 : y(i + 1);
    band += `<rect x="${(ax - w / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${w.toFixed(1)}" height="${(y1 - y0 + 0.4).toFixed(1)}"/>`;
  });
  const hits = frames.map((_, i) => `<rect class="ln-hit" x="${col.x}" y="${(y(i) - rowH / 2).toFixed(1)}" width="${BUNDLE}" height="${rowH.toFixed(1)}" data-bundle="${zone.z}" data-row="${i}"/>`).join('');
  col.counts = counts; col.sums = sums;
  return `<g class="ln-bundle" data-bundle="${zone.z}"><g class="ln-bundle-band">${band}</g>${hits}</g>`;
}

function headSVG(col, zone) {
  if (col.kind === 'bundle') {
    return `<g class="ln-head is-bundle" data-expand="${zone.z}" tabindex="0" role="button" aria-label="展开${esc(zone.label)}其余 ${zone.rest.length} 件"><text x="${col.x + 4}" y="${HEAD - 26}" class="ln-head-name">其余</text><text x="${col.x + 4}" y="${HEAD - 13}" class="ln-head-sub" data-rest="${zone.z}">${zone.rest.length} 件 ▸</text></g>`;
  }
  if (col.kind === 'track') return '';
  const fit = fitText(categoryName(col.id), col.w - 10, 12.5, { minSize: 10, weight: 600 });
  return `<g class="ln-head" data-item="${esc(col.id)}" tabindex="0" role="button"><text x="${col.x + 4}" y="${HEAD - 26}" class="ln-head-name" font-size="${fit.size}" style="fill:${topColor(col.id) || 'var(--ink)'}">${esc(fit.lines[0])}</text><text x="${col.x + 4}" y="${HEAD - 13}" class="ln-head-sub"></text></g>`;
}

function build({ flip = false } = {}) {
  const before = flip ? new Map([...mainEl.querySelectorAll('.ln-col')].map(el => [el.dataset.col, Number(el.dataset.x)])) : null;
  timed('builds', () => {
    L = layout();
    const { H, y, rowH, cols, width } = L;
    let colsSvg = '', zonesSvg = '';
    for (const zone of zones) {
      const n = zone.top.length;
      const zoneText = `${zone.label} · 前 ${n} 件 · 到此刻共 ${zone.total} 件`;
      zonesSvg += `<text x="${zone.x + 4}" y="12" class="ln-zone">${esc(zone.label)}<tspan class="ln-zone-n" data-zone="${zone.z}"> · ${hasStreams ? `前 ${n} / ${zone.total} 件` : `${zone.total} 件`}</tspan></text>`;
      if (zone.rest.length && expanded.has(zone.z)) zonesSvg += `<g class="ln-head is-fold" data-expand="${zone.z}" tabindex="0" role="button" aria-label="折起${esc(zone.label)}的长尾"><text x="${(zone.x + 22 + textWidth(zoneText, 10.5, 600)).toFixed(1)}" y="12" class="ln-fold">折起其余 ${zone.rest.length} 件 ◂</text></g>`;
      zonesSvg += `<line x1="${zone.x}" x2="${zone.x + zone.w}" y1="18" y2="18" class="ln-zone-rule"/>`;
    }
    for (const col of cols) {
      const zone = zones.find(z => z.z === col.zone);
      const body = col.kind === 'bundle' ? bundleSVG(col, zone, L) : lineSVG(col, L);
      colsSvg += `<g class="ln-col is-${col.kind}" data-col="${esc(col.id)}" data-x="${col.x}">${headSVG(col, zone)}<g clip-path="url(#ln-reveal)">${body}</g></g>`;
    }
    mainEl.innerHTML = `<svg class="ln-svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="事项身份线">
      <defs><clipPath id="ln-reveal"><rect x="-20" y="0" width="${width + 40}" height="${HEAD}"/></clipPath></defs>
      <g class="ln-rules">${frames.map((f, i) => (i === 0 || dayOf(at(i)) !== dayOf(at(i - 1)) ? `<line x1="0" x2="${width}" y1="${(y(i) - rowH / 2).toFixed(1)}" y2="${(y(i) - rowH / 2).toFixed(1)}"/>` : '')).join('')}</g>
      <g>${zonesSvg}</g>
      <g clip-path="url(#ln-reveal)" class="ln-merges">${mergeSVG(L)}</g>
      <g class="ln-cols">${colsSvg}</g>
      <g class="ln-now"><line x1="0" x2="${width}" y1="0" y2="0"/><text x="${width - 4}" y="-4" text-anchor="end"></text></g>
      <g class="ln-open"></g>
    </svg>`;
    gutterEl.innerHTML = `<svg class="ln-gut" width="${GUT}" height="${H}" viewBox="0 0 ${GUT} ${H}">${frames.map((f, i) => {
      const first = i === 0 || dayOf(at(i)) !== dayOf(at(i - 1)), quiet = f.signal?.type === 'review' ? ['◷', '定时复查'] : records[i].receipt?.type === 'checked' ? ['✓', '检查后无变化'] : null;
      return `<g class="ln-row" data-frame="${i}"><rect x="0" y="${(y(i) - rowH / 2).toFixed(1)}" width="${GUT}" height="${rowH.toFixed(1)}" class="ln-row-hit"/>${first ? `<text x="0" y="${(y(i) + 4.5).toFixed(1)}" class="ln-day">${dayOf(at(i))}</text><text x="20" y="${(y(i) + 4).toFixed(1)}" class="ln-wd">${esc(weekdayOf(at(i)))}</text>` : ''}<text x="${GUT - 6}" y="${(y(i) + 3.2).toFixed(1)}" class="ln-time">${quiet ? `<tspan class="ln-quiet">${quiet[0]} </tspan>` : ''}${formatTime(f.at)}${quiet ? `<title>${quiet[1]}</title>` : ''}</text></g>`;
    }).join('')}<line x1="${GUT - 1}" x2="${GUT - 1}" y1="${HEAD}" y2="${H}" class="ln-gut-rule"/></svg>`;
    const svg = mainEl.querySelector('svg');
    L.svg = svg;
    L.clip = svg.querySelector('#ln-reveal rect');
    L.now = svg.querySelector('.ln-now');
    L.nowText = svg.querySelector('.ln-now text');
    L.open = svg.querySelector('.ln-open');
    L.lines = new Map([...svg.querySelectorAll('.ln-col')].map(el => [el.dataset.col, el]));
    L.heads = [...svg.querySelectorAll('.ln-head[data-item]')];
    L.zoneCounts = [...svg.querySelectorAll('[data-zone]')];
    L.restCounts = [...svg.querySelectorAll('[data-rest]')];
    L.rows = [...gutterEl.querySelectorAll('.ln-row')];
  });
  if (before) {
    // Columns slide from where they were; new ones fade in.
    for (const el of L.lines.values()) {
      const old = before.get(el.dataset.col);
      if (old == null) { el.classList.add('is-entering'); continue; }
      const dx = old - Number(el.dataset.x);
      if (Math.abs(dx) > 0.5) { el.style.transition = 'none'; el.style.transform = `translateX(${dx}px)`; }
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { for (const el of L.lines.values()) { el.style.transition = ''; el.style.transform = ''; el.classList.remove('is-entering'); } }));
  }
}

// ---------- per frame ----------
let nowRow = page.index, cancelTween = () => {};
let hot = null, pinned = null;
function setNow(row) {
  const yy = L.y(row) + L.rowH / 2;
  L.clip.setAttribute('height', Math.max(HEAD, yy).toFixed(1));
  L.now.setAttribute('transform', `translate(0,${yy.toFixed(1)})`);
  L.open.setAttribute('transform', `translate(0,${yy.toFixed(1)})`);
  // Names and open-question arrows appear when the growing lines reach them.
  for (const head of L.heads) head.classList.toggle('is-hidden', row < Number(head.dataset.first) - 0.5);
  for (const arrow of L.open.children) arrow.classList.toggle("is-pending", row < Number(arrow.dataset.from) - 0.5);
}
function applyFrame(index) {
  for (const head of L.heads) {
    const id = head.dataset.item, f = factOf(id);
    head.dataset.first = f.first;
    const versions = versionsOf(id).filter(v => v.index <= index), names = new Set(versions.map(v => v.item.title)).size;
    const stations = stationsOf(id).filter(s => s.index <= index).length;
    const room = (L.colById.get(id)?.w || 120) - 10;
    const full = `${versions.length} 版 · ${names} 个名字 · ${stations} 站`, short = `${versions.length} 版 · ${names} 名 · ${stations} 站`;
    head.querySelector('.ln-head-sub').textContent = f.first > index ? '' : textWidth(full, 9.5, 400, MONO) <= room ? full : short;
    head.setAttribute('aria-label', `${categoryName(id)}：${versions.length} 版`);
  }
  for (const row of L.rows) row.classList.toggle('is-future', Number(row.dataset.frame) > index);
  // Counts as of this frame: how many of the zone's items have reached the root layer so far.
  const seen = ids => ids.filter(id => factOf(id).first <= index).length;
  for (const el of L.zoneCounts) {
    const zone = zones.find(z => z.z === el.dataset.zone), total = seen([...zone.top, ...zone.rest]);
    el.textContent = hasStreams ? ` · 前 ${zone.top.length} 件 · 到此刻共 ${total} 件` : ` · 到此刻 ${total} 件`;
  }
  for (const el of L.restCounts) el.textContent = `${seen(zones.find(z => z.z === el.dataset.rest).rest)} 件 ▸`;
  // Open questions: a down arrow on the bracket at the now line.
  let open = '';
  for (const col of L.cols) {
    if (col.kind !== 'top') continue;
    for (const path of pathsOfItem(col.id)) {
      if (pathStatus(path, index).state !== 'open') continue;
      const bx = col.x + 6;
      open += `<g class="ln-openask" data-path="${esc(path.key)}" data-item="${esc(col.id)}" data-from="${path.from}"><path d="M${bx - 4} -5 L${bx} 0 L${bx + 4} -5"/><rect x="${bx - 6}" y="-9" width="12" height="12" class="ln-hit"/></g>`;
    }
  }
  L.open.innerHTML = open;
  L.nowText.textContent = `此刻 · ${frames[index].id} · ${dayTime(frames[index].at)}`;
  if (pinned && drawer.isOpen) openDossier(pinned, index, false);
  applyHot();
}
function onFrame(index, previous, from) {
  if (!L) build();
  cancelTween();
  const start = nowRow;
  timed('frames', () => applyFrame(index));
  const duration = from === 'init' ? 0 : Math.min(560, 240 + Math.abs(index - (previous ?? index)) * 50);
  cancelTween = tween(duration, p => { nowRow = start + (index - start) * p; setNow(nowRow); });
}

// ---------- hover, pin, dossier ----------
let lit = [];
function applyHot(event) {
  const active = hot || pinned;
  for (const el of lit) el.classList.remove('is-hot');
  lit = [];
  L.svg.classList.toggle('has-hot', !!active);
  if (active) {
    const el = L.lines.get(active.item);
    if (el) lit.push(el);
    if (active.path) for (const a of L.svg.querySelectorAll(`[data-path="${CSS.escape(active.path)}"]`)) lit.push(a);
    for (const el of lit) el.classList.add('is-hot');
  }
  if (event) markHover(event, lit[0]);
}
function tipFor(el, index) {
  const id = el.closest('[data-item]')?.dataset.item;
  if (el.closest('[data-path]')) {
    const path = pathByKey.get(el.closest('[data-path]').dataset.path), s = pathStatus(path, index);
    const state = s.state === 'open' ? `开着 · ${openFor(at(index) - path.opened)}` : s.state === 'closed' ? `${CLOSE_WORDS[s.how]} · 开了 ${span(path.closed - path.opened)}` : '还没登记';
    return { key: `p${path.key}`, target: { item: path.item, path: path.key }, html: `<b>${esc(EXPECT_WORDS[path.ask.expects] || '')} · ${esc(path.ask.prompt)}</b><small>${esc(frames[path.from].id)} 登记 · ${esc(state)}${path.regs.length > 1 ? ` · 重登记 ${path.regs.filter(r => r.index <= index).length - 1} 次` : ''}</small><small>你回应 ${path.answers.filter(r => r.at <= at(index)).length} 次</small>` };
  }
  if (el.closest('[data-station]')) {
    const station = stationsOf(id)[Number(el.closest('[data-station]').dataset.station)];
    const v = station.versions.filter(x => x.index <= index);
    const names = [...new Set(v.map(x => x.item.title))];
    return { key: `s${id}${station.index}`, target: { item: id }, html: `<b>${names.map(esc).join(' → ')}</b><small>${esc(frames[station.index].id)} · ${esc(dayTime(frames[station.index].at))} · ${station.first.share} 份 · ${esc(kindLabel[station.first.kind] || '')}${v.length > 1 ? ` · 又改写 ${v.length - 1} 次措辞` : ''}</small>${v.at(-1).reason ? `<small>${esc(v.at(-1).reason.slice(0, 90))}${v.at(-1).reason.length > 90 ? '…' : ''}</small>` : ''}` };
  }
  if (el.closest('[data-bundle]')) {
    const z = el.closest('[data-bundle]').dataset.bundle, row = Number(el.dataset.row ?? index), zone = zones.find(x => x.z === z);
    const items = zone.rest.map(rid => ({ rid, item: factOf(rid).hist[row] })).filter(x => x.item?.status === 'active').sort((a, b) => b.item.share - a.item.share);
    return { key: `b${z}${row}`, target: null, html: `<b>${esc(zone.label)}的其余 ${items.length} 件 · ${esc(frames[row].id)}</b><small>合计 ${items.reduce((n, x) => n + x.item.share, 0)} 份</small>${items.slice(0, 6).map(x => `<small>${x.item.share} 份 · ${esc(x.item.title)}</small>`).join('')}${items.length > 6 ? `<small>另 ${items.length - 6} 件</small>` : ''}<small>点击展开</small>` };
  }
  if (id) {
    const item = itemAt(id, index), f = factOf(id);
    const live = f.hist[index]?.status === 'active';
    return { key: `i${id}`, target: { item: id }, html: `<b>${esc(item.title)}</b><small>${f.first > index ? '此刻还没出现' : live ? `${item.share} 份 · ${esc(kindLabel[item.kind])}` : '已撤下'} · 两周累计 ${f.cum} 份</small><small>点击看版本、依据与问题记录</small>` };
  }
  return null;
}
function openDossier(target, index, scroll = true) {
  drawer.open(dossierHTML(target.item, index, { pathKey: target.path }), `${target.item}|${target.path}`, { scrollTo: scroll && target.path ? `[data-path="${CSS.escape(target.path)}"]` : null });
}
function pin(target) {
  pinned = target;
  if (!target) { drawer.close(); applyHot(); return; }
  openDossier(target, page.index);
  applyHot();
  const q = new URLSearchParams(location.search);
  q.set('item', target.item);
  if (target.path) q.set('ask', target.path); else q.delete('ask');
  history.replaceState(null, '', `?${q}`);
}
function toggleZone(z) {
  if (expanded.has(z)) expanded.delete(z); else expanded.add(z);
  const q = new URLSearchParams(location.search);
  if (expanded.size) q.set('open', [...expanded].join(',')); else q.delete('open');
  history.replaceState(null, '', `?${q}`);
  build({ flip: true });
  applyFrame(page.index);
  setNow(nowRow);
}

const HOVERABLE = '[data-path],[data-station],[data-bundle],[data-item],[data-frame]';
figure.addEventListener('pointermove', event => {
  const el = event.target.closest(HOVERABLE);
  if (!el) { tip.hide(); if (hot) { hot = null; applyHot(event); } return; }
  if (el.closest('[data-frame]')) {
    const i = Number(el.closest('[data-frame]').dataset.frame), f = frames[i];
    tip.show(`<b>${esc(f.id)} · ${esc(dayTime(f.at))}</b><small>${esc(f.title)}</small><small>点击跳到这一帧</small>`, event.clientX, event.clientY, `f${i}`);
    return;
  }
  const info = tipFor(el, page.index);
  if (!info) return;
  const next = info.target;
  if (!(hot?.item === next?.item && hot?.path === next?.path)) { hot = next; applyHot(event); }
  tip.show(info.html, event.clientX, event.clientY, `${info.key}|${page.index}`);
});
figure.addEventListener('pointerleave', () => { tip.hide(); hot = null; applyHot(); });
figure.addEventListener('click', event => {
  const row = event.target.closest('[data-frame]');
  if (row) { page.goFrame(Number(row.dataset.frame)); return; }
  const expand = event.target.closest('[data-expand],[data-bundle]');
  if (expand) { toggleZone(expand.dataset.expand || expand.dataset.bundle); tip.hide(); return; }
  const el = event.target.closest('[data-path],[data-item]');
  if (!el) return;
  const pathEl = event.target.closest('[data-path]');
  pin(pathEl ? { item: pathByKey.get(pathEl.dataset.path).item, path: pathEl.dataset.path } : { item: el.dataset.item });
});
figure.addEventListener('keydown', event => {
  const head = event.target.closest?.('.ln-head');
  if (!head || event.key !== 'Enter') return;
  event.preventDefault();
  if (head.dataset.expand) toggleZone(head.dataset.expand); else pin({ item: head.dataset.item });
});
figure.addEventListener('focusin', event => {
  const head = event.target.closest?.('.ln-head[data-item]');
  if (head) { hot = { item: head.dataset.item }; applyHot(); }
});

const order = () => L.cols.filter(c => c.kind !== 'bundle').map(c => c.id).filter(id => factOf(id).first <= page.index);
function onKey(event) {
  if (event.key === 'Escape') {
    if (drawer.isOpen) { drawer.close(); return true; }
    if (pinned || hot) { pinned = null; hot = null; applyHot(); return true; }
    return false;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const ids = order(), current = (pinned || hot)?.item, k = ids.indexOf(current);
    const next = ids[(k < 0 ? 0 : k + (event.key === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length];
    if (!next) return true;
    if (drawer.isOpen) pin({ item: next }); else { hot = { item: next }; applyHot(); }
    const col = L.colById.get(next), box = L.svg.getBoundingClientRect();
    tip.show(tipFor(L.lines.get(next).querySelector('.ln-colhit') || L.lines.get(next), page.index).html, box.left + col.x + 30, box.top + 40, `k${next}`);
    return true;
  }
  if (event.key === 'Enter' && (hot || pinned) && !event.target.closest?.('button,.ln-head,summary,a')) { pin(hot || pinned); return true; }
  if (event.key === 'e' || event.key === 'E') {
    const z = (hot || pinned) ? zoneOf((hot || pinned).item) : zones.find(zone => zone.rest.length)?.z;
    if (z && zones.find(zone => zone.z === z)?.rest.length) toggleZone(z);
    return true;
  }
  return false;
}

let resizeTimer = 0;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { build(); applyFrame(page.index); setNow(nowRow); }, 120); });

build();
page.start();
if (params.get('ask') && pathByKey.has(params.get('ask'))) pin({ item: pathByKey.get(params.get('ask')).item, path: params.get('ask') });
else if (params.get('item') && factOf(params.get('item'))) pin({ item: params.get('item') });
globalThis.foldForm = { id: 'lineage', goFrame: page.goFrame, get index() { return page.index; }, pin, toggleZone, hover: target => { hot = target; applyHot(); } };
