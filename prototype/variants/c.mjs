import { escapeHTML as esc, formatDate, formatTime, kindLabel, allItems, getItem, currentAsk, feedbackTrail, findEvent, scenario } from './shared.mjs?v=feedback-loop-1';

// C · 注意力容器。One upright vessel holds this layer's 64 shares. Each item is
// a layer of liquid whose thickness is exactly its share; the headroom above
// the surface is the unallocated budget. Rank 1 floats on top, where the eye
// lands first, so reading the labels top-down is reading the ranking.
// The vessel never writes to Fold state; motion only replays real changes.
const BUDGET = 64;
const DURATION = 1250;
const NS = 'http://www.w3.org/2000/svg';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clock = value => `${formatDate(value)} ${formatTime(value)}`;
const expectLabel = { decide: '决定', input: '提供', act: '去做' };
const askTag = ask => `等你${ask.expects.map(e => expectLabel[e] || e).join('、')}`;
const viaLabel = { reply: '回复', button: '按钮' };
const dispositionLabel = { used: '采用', duplicate: '重复', noise: '噪音', deferred: '暂缓' };

// One liquid, several densities: a narrow sea-glass band, separated mostly by
// lightness. Stable per category; children vary lightness inside the parent's.
const TONES = { sage: [.75, .052, 168], clay: [.63, .056, 206], sand: [.86, .040, 148], blue: [.79, .042, 226], lilac: [.69, .042, 250], mint: [.90, .030, 188] };
const TONE_KEYS = Object.keys(TONES);
const hash = id => [...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
const css = c => `oklch(${c.l.toFixed(3)} ${c.c.toFixed(3)} ${c.h.toFixed(1)})`;
const mixColor = (a, b, t) => ({ l: lerp(a.l, b.l, t), c: lerp(a.c, b.c, t), h: lerp(a.h, b.h, t) });
function rootOf(state, item) {
  let node = item; const seen = new Set();
  while (node?.parent_id && !seen.has(node.id)) { seen.add(node.id); node = getItem(state, node.parent_id) || node; if (seen.has(node.id)) break; }
  return node || item;
}
function toneFor(state, item, nested) {
  const root = rootOf(state, item);
  const key = scenario.categories?.[root.id]?.colorKey || TONE_KEYS[hash(root.id) % TONE_KEYS.length];
  const [l, c, h] = TONES[key] || TONES.sage;
  if (!nested) return { l, c, h };
  const steps = [-.08, .03, -.03, .07, -.12, .1];
  return { l: clamp(l + steps[hash(item.id) % steps.length], .5, .93), c, h: h + (hash(item.id) % 3 - 1) * 6 };
}

// ---------- domain readings (host-side records, display only) ----------
function priorAsk(s, target, before = s.index) {
  for (let i = Math.min(before, s.frames.length - 1); i >= 0; i--) { const ask = s.frames[i].asks?.[target]; if (ask) return ask; }
  return null;
}
function feedbackText(s, link, frameIndex) {
  const ask = priorAsk(s, link.target, frameIndex - 1) || priorAsk(s, link.target, frameIndex);
  const action = ask?.actions?.find(a => a.id === link.action);
  if (link.meaning === 'ack') return '已阅';
  if (link.meaning === 'snooze') return `稍后再提醒${link.until ? `（${formatTime(link.until)}）` : ''}`;
  const verb = { decide: '决定', input: '提供', act: '报告已做' }[link.meaning] || link.meaning;
  const value = link.value !== undefined ? `${link.value}${action?.input?.unit || ''}` : action?.label;
  return value ? `${verb}「${value}」` : verb;
}
// The visible layer stands for a target: itself, what it merged into, or its
// ancestor in this layer. Only explicit links are followed.
function locate(s, id) {
  const ids = new Set(s.layer.items.map(i => i.id)); let node = getItem(s.state, id); const seen = new Set();
  while (node && !seen.has(node.id)) {
    if (ids.has(node.id)) return { id: node.id, direct: node.id === id };
    seen.add(node.id); node = node.merged_into ? getItem(s.state, node.merged_into) : node.parent_id ? getItem(s.state, node.parent_id) : null;
  }
  return null;
}
function annotate(s) {
  const notes = new Map(s.layer.items.map(item => {
    const nested = allItems({ root: item.children || { items: [] } }).filter(c => c.status === 'active' && currentAsk(s, c.id));
    return [item.id, { ask: currentAsk(s, item.id), nested: nested.length, feedback: [], reminder: null, adjusted: false }];
  }));
  const links = [];
  s.frame.events.forEach((event, index) => {
    for (const link of event.feedback || []) { const at = locate(s, link.target); links.push({ index, event, link, at }); if (at) notes.get(at.id).feedback.push({ event, link }); }
    if (event.reminder) { const at = locate(s, event.reminder.target); links.push({ index, event, reminder: event.reminder, at }); if (at) notes.get(at.id).reminder = event; }
  });
  if (s.frame.signal?.type === 'review') for (const change of s.frameDiff?.changes || []) { const at = locate(s, change.item); if (at) notes.get(at.id).adjusted = true; }
  return { notes, links };
}

// Items of the visible layer, now and one整理 earlier (for withdrawn/merged).
function getLayerIds(s) {
  const prevLayer = s.layerId ? getItem(s.previousState, s.layerId)?.children : s.previousState.root;
  const ids = (prevLayer?.items || []).map(i => i.id);
  for (const item of allItems(s.state)) if ((item.parent_id || null) === (s.layerId || null)) ids.push(item.id);
  return ids;
}

function longestRising(values) {
  const tails = [], prevIndex = new Array(values.length).fill(-1), tailIndex = [];
  values.forEach((v, i) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
    tails[lo] = v; tailIndex[lo] = i; prevIndex[i] = lo ? tailIndex[lo - 1] : -1;
  });
  const keep = new Set(); let i = tailIndex[tails.length - 1];
  while (i != null && i >= 0) { keep.add(i); i = prevIndex[i]; }
  return keep;
}

// ---------- geometry, in share units (0 = bottom of the vessel) ----------
function targetBands(s) {
  const items = [...s.layer.items].filter(i => i.status !== 'withdrawn' && i.status !== 'merged').sort((a, b) => a.rank - b.rank);
  let cursor = items.reduce((n, i) => n + i.share, 0);
  const nested = Boolean(s.layerId);
  return items.map(item => { const band = { key: item.id, item, y1: cursor, y0: cursor - item.share, op: 1, sep: 1, col: toneFor(s.state, item, nested) }; cursor -= item.share; return band; });
}
// Split a band into consecutive pieces, top-down, by weights.
function subdivide(band, weights) {
  const total = weights.reduce((n, w) => n + w, 0) || 1; let cursor = band.y1; const span = band.y1 - band.y0;
  return weights.map(w => { const h = span * w / total; const piece = { y1: cursor, y0: cursor - h }; cursor -= h; return piece; });
}
function buildTransition(old, prevS, s, type, anchorId) {
  const target = targetBands(s), tMap = new Map(target.map(b => [b.key, b]));
  const live = old.filter(p => p.op > .01 && !p.ghost), oMap = new Map(live.map(p => [p.key, p]));
  const parts = [];
  const push = (key, item, from, to, extra = {}) => parts.push({ key, item, from: { y0: from.y0, y1: from.y1, op: from.op ?? 1, sep: from.sep ?? 1, col: from.col }, to: { y0: to.y0, y1: to.y1, op: to.op ?? 1, sep: to.sep ?? 1, col: to.col }, ...extra });
  if (type === 'dive') {
    const anchor = oMap.get(anchorId);
    const pieces = anchor ? subdivide(anchor, target.map(b => b.y1 - b.y0)) : target.map(() => ({ y0: BUDGET, y1: BUDGET }));
    target.forEach((b, i) => push(b.key, b.item, { ...pieces[i], col: anchor?.col || b.col }, b));
    for (const p of live) push(`old:${p.key}`, p.item, p, { ...p, op: 0 }, { ghost: true, cut: p.key === anchorId ? .02 : 0 });
    return parts;
  }
  if (type === 'rise') {
    const anchor = tMap.get(anchorId);
    const pieces = anchor ? subdivide(anchor, live.map(p => p.y1 - p.y0)) : live.map(() => ({ y0: 0, y1: 0 }));
    live.forEach((p, i) => push(`old:${p.key}`, p.item, p, { ...pieces[i], col: anchor?.col || p.col }, { ghost: true, late: true }));
    for (const b of target) push(b.key, b.item, { ...b, op: 0 }, b, { appear: b.key === anchorId ? .96 : .25 });
    return parts;
  }
  const consumed = new Set();
  for (const b of target) {
    const from = oMap.get(b.key);
    if (from) { push(b.key, b.item, from, b); consumed.add(b.key); continue; }
    // Explicit merge: old layers whose record now says merged_into this one.
    const sources = live.filter(p => !tMap.has(p.key) && getItem(s.state, p.key)?.merged_into === b.key);
    if (sources.length) {
      const pieces = subdivide(b, sources.map(p => p.y1 - p.y0));
      sources.forEach((p, i) => { push(`src:${p.key}`, p.item, p, { ...pieces[i], col: b.col, sep: i ? 0 : 1 }, { ghost: true, source: true }); consumed.add(p.key); });
      push(b.key, b.item, { ...b, op: 0 }, b, { appear: .97 });
      continue;
    }
    // Replaying backwards across a merge: the merged layer opens up again.
    const parent = prevS && getItem(prevS.state, b.key)?.merged_into;
    const host = parent && oMap.get(parent);
    if (host && !tMap.has(parent)) {
      const siblings = target.filter(x => getItem(prevS.state, x.key)?.merged_into === parent);
      const piece = subdivide(host, siblings.map(x => x.y1 - x.y0))[siblings.indexOf(b)];
      push(b.key, b.item, { ...piece, col: host.col, sep: 0 }, b); consumed.add(parent);
      continue;
    }
    // New: poured in at the mouth, then settles into its rank.
    push(b.key, b.item, { y0: BUDGET, y1: BUDGET, op: 1, col: b.col }, b, { pour: true });
  }
  for (const p of live) {
    if (tMap.has(p.key) || consumed.has(p.key)) { if (consumed.has(p.key) && !tMap.has(p.key) && !parts.some(x => x.key === `src:${p.key}`)) push(`old:${p.key}`, p.item, p, { ...p, op: 0 }, { ghost: true, cut: .02 }); continue; }
    // Withdrawn: drains out where it stood; the others close the gap.
    const mid = (p.y0 + p.y1) / 2;
    push(`old:${p.key}`, p.item, p, { y0: mid, y1: mid, op: 0, col: p.col }, { ghost: true });
  }
  return parts;
}
function sampleParts(parts, raw) {
  const t = ease(raw);
  return parts.map(part => {
    let op = lerp(part.from.op, part.to.op, t);
    if (part.appear != null) op = raw >= part.appear ? lerp(0, 1, clamp((raw - part.appear) / (1 - part.appear || 1), 0, 1)) : 0;
    if (part.appear != null && raw >= 1) op = 1;
    if (part.cut) op = raw > part.cut ? 0 : 1;
    if (part.late) op = raw < .96 ? 1 : 0;
    if (part.source) op = raw < .98 ? 1 : 0;
    return { key: part.key, item: part.item, ghost: part.ghost, pour: part.pour, y0: lerp(part.from.y0, part.to.y0, t), y1: lerp(part.from.y1, part.to.y1, t), op, sep: lerp(part.from.sep, part.to.sep, t), col: mixColor(part.from.col, part.to.col, t) };
  });
}

export function mount(host, model) {
  host.classList.add('variant-c');
  host.innerHTML = `<div class="c-shell">
    <header class="c-top">
      <div class="c-brand"><b>Fold</b><span>注意力容器</span></div>
      <div class="c-time" aria-label="回放时刻">
        <div class="c-steps"><button type="button" class="c-icon" data-c="prev" aria-label="上一次整理"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg></button><button type="button" class="c-play" data-c="play" aria-label="播放回放"></button><button type="button" class="c-icon" data-c="next" aria-label="下一次整理"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg></button></div>
        <div class="c-when"><b class="c-when-date"></b><small class="c-when-count"></small></div>
        <div class="c-track" role="slider" tabindex="0" aria-label="选择整理时刻"><div class="c-track-rail"></div><div class="c-track-ticks"></div><div class="c-track-days" aria-hidden="true"></div><div class="c-track-thumb"></div></div>
      </div>
      <button type="button" class="c-state" data-lab-inspect="state">完整状态 ↗</button>
    </header>
    <main class="c-main">
      <section class="c-vessel-col" aria-label="当前层的注意力分配">
        <div class="c-lede"><h1 class="c-headline"></h1><p class="c-frame-title"></p><p class="c-signal" aria-live="polite"></p></div>
        <nav class="c-path" aria-label="当前层级"></nav>
        <div class="c-stage"><svg class="c-svg" xmlns="${NS}" aria-hidden="true"><defs>
          <clipPath id="c-clip"><path class="c-clip-path"/></clipPath>
          <linearGradient id="c-body" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#062a2a" stop-opacity=".16"/><stop offset=".1" stop-color="#ffffff" stop-opacity=".14"/><stop offset=".22" stop-color="#ffffff" stop-opacity=".2"/><stop offset=".34" stop-color="#ffffff" stop-opacity="0"/><stop offset=".78" stop-color="#062a2a" stop-opacity="0"/><stop offset="1" stop-color="#062a2a" stop-opacity=".18"/></linearGradient>
          <linearGradient id="c-sheen" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".34"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
          <linearGradient id="c-depth" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#062a2a" stop-opacity="0"/><stop offset="1" stop-color="#062a2a" stop-opacity=".07"/></linearGradient>
          <linearGradient id="c-glass" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity=".0"/><stop offset=".08" stop-color="#ffffff" stop-opacity=".75"/><stop offset=".16" stop-color="#ffffff" stop-opacity=".0"/><stop offset=".9" stop-color="#ffffff" stop-opacity="0"/><stop offset=".95" stop-color="#ffffff" stop-opacity=".45"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
          <radialGradient id="c-shadow"><stop offset="0" stop-color="#16302c" stop-opacity=".16"/><stop offset="1" stop-color="#16302c" stop-opacity="0"/></radialGradient>
        </defs><g class="c-back"></g><g class="c-liquid" clip-path="url(#c-clip)"></g><g class="c-front"></g><g class="c-marks"></g></svg><div class="c-labels"></div></div>
        <p class="c-legend"><span><i class="c-key-layer"></i>层厚 = 份额，刻度 0–64</span><span>最上层最重要</span><span><i class="c-key-room"></i>杯口空余 = 未分配</span><span><i class="c-key-ask"></i>朱红舌签 = 登记了回应路径</span><span><i class="c-key-nested"></i>空心 = 子项里有</span></p>
      </section>
      <aside class="c-read" aria-label="阅读区"><div class="c-read-inner"></div></aside>
    </main>
  </div>`;
  const $ = selector => host.querySelector(selector);
  const svg = $('.c-svg'), stage = $('.c-stage'), labelLayer = $('.c-labels'), read = $('.c-read-inner'), track = $('.c-track');
  const gBack = $('.c-back'), gLiquid = $('.c-liquid'), gFront = $('.c-front'), gMarks = $('.c-marks');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let s = model.snapshot(), prev = null, disposed = false, hoverId = null, notes = annotate(s);
  let geo = null, settled = [], flight = null, raf = 0, labelState = new Map(), layoutKey = '';

  // ---------- layout ----------
  function measure() {
    const w = stage.clientWidth || 600, narrow = w < 560;
    const unit = narrow ? 6.6 : clamp((innerHeight - 440) / BUDGET, 5.4, 8.6);
    const scaleW = narrow ? 30 : 46, glassW = narrow ? 92 : clamp(w * .27, 150, 232);
    const gx0 = scaleW + 8, gx1 = gx0 + glassW, top = 34, rim = 16;
    const y64 = top + rim, bottom = y64 + BUDGET * unit, radius = narrow ? 10 : 13;
    const labelX = gx1 + (narrow ? 30 : 50), labelW = Math.max(150, Math.min(w - labelX - 2, narrow ? 240 : 360));
    geo = { w, narrow, unit, gx0, gx1, top, y64, bottom, radius, labelX, labelW, y: share => bottom - share * unit };
    drawGlass();
  }
  function drawGlass() {
    const { gx0, gx1, top, y64, bottom, radius, unit, narrow } = geo;
    const inner = `M${gx0},${top} L${gx0},${bottom - radius} Q${gx0},${bottom} ${gx0 + radius},${bottom} L${gx1 - radius},${bottom} Q${gx1},${bottom} ${gx1},${bottom - radius} L${gx1},${top}`;
    $('.c-clip-path').setAttribute('d', `${inner} Z`);
    const ticks = [], sx = gx0 - (narrow ? 6 : 7);
    for (let i = 0; i <= BUDGET; i++) {
      const y = geo.y(i), major = i % 8 === 0, mid = i % 4 === 0;
      if (!major && !mid && unit < 4.2) continue;
      ticks.push(`<line x1="${sx - (major ? 10 : mid ? 6 : 3)}" x2="${sx}" y1="${y}" y2="${y}" class="c-tick${major ? ' is-major' : ''}"/>`);
      if (major) ticks.push(`<text x="${sx - 14}" y="${y + 3.5}" class="c-tick-label">${i}</text>`);
    }
    const wall = narrow ? 3 : 4, outer = `M${gx0 - wall},${top} L${gx0 - wall},${bottom - radius} Q${gx0 - wall},${bottom + wall + 2} ${gx0 + radius},${bottom + wall + 2} L${gx1 - radius},${bottom + wall + 2} Q${gx1 + wall},${bottom + wall + 2} ${gx1 + wall},${bottom - radius} L${gx1 + wall},${top}`;
    gBack.innerHTML = `<ellipse cx="${(gx0 + gx1) / 2}" cy="${bottom + 12}" rx="${(gx1 - gx0) * .64}" ry="8" fill="url(#c-shadow)"/>
      <path d="${outer} Z" class="c-glass-body"/>
      <path d="${inner} Z" class="c-glass-back"/>
      <line x1="${gx0}" x2="${gx1}" y1="${y64}" y2="${y64}" class="c-capacity"/>${ticks.join('')}`;
    gFront.innerHTML = `<path d="${inner} Z" fill="url(#c-glass)" clip-path="url(#c-clip)"/>
      <path d="${outer}" class="c-glass-line"/><path d="${inner}" class="c-glass-inner"/>
      <path d="M${gx0 - wall},${top} H${gx0}" class="c-glass-lip"/><path d="M${gx1},${top} H${gx1 + wall}" class="c-glass-lip"/>
      <path d="M${gx0 + 5},${top + 10} V${bottom - radius - 6}" class="c-glint"/>`;
  }

  // ---------- drawing (one pass per animation frame, never idle) ----------
  function render(vis) {
    const { gx0, gx1, unit, y } = geo, width = gx1 - gx0;
    const sel = s.selectedId, focus = hoverId || null;
    const shown = vis.filter(p => p.op > .004 && p.y1 - p.y0 > .002);
    const ordered = [...shown.filter(p => !p.pour && !p.ghost), ...shown.filter(p => p.ghost), ...shown.filter(p => p.pour)];
    const surface = shown.reduce((m, p) => Math.max(m, p.op > .4 ? p.y1 : 0), 0);
    let liquid = '';
    // While layers trade places, the column underneath reads as liquid in
    // motion rather than air; it is never drawn at rest.
    if (flight && flight.column > .02) {
      const top = y(flight.column);
      liquid += `<rect x="${gx0 - 2}" y="${top.toFixed(2)}" width="${width + 4}" height="${(geo.bottom - top).toFixed(2)}" class="c-column"/>`;
    }
    for (const p of ordered) {
      const top = y(p.y1), h = (p.y1 - p.y0) * unit, fill = css(p.col);
      const lit = (focus === p.key || sel === p.key) ? ' is-lit' : '';
      liquid += `<g class="c-band${lit}" data-id="${esc(p.item?.id || '')}" opacity="${p.op.toFixed(3)}"><rect x="${gx0 - 2}" y="${top.toFixed(2)}" width="${width + 4}" height="${Math.max(0, h).toFixed(2)}" style="fill:${fill}"/>`;
      if (h > 1.4) liquid += `<rect x="${gx0}" y="${(top + Math.max(0, h - Math.min(h, 7))).toFixed(2)}" width="${width}" height="${Math.min(h, 7).toFixed(2)}" fill="url(#c-depth)"/><rect x="${gx0}" y="${top.toFixed(2)}" width="${width}" height="${Math.min(h, 6).toFixed(2)}" fill="url(#c-sheen)" opacity="${p.sep.toFixed(2)}"/>`;
      if (p.y1 < surface - .05) liquid += `<path d="M${gx0},${(top - 1.6).toFixed(2)} Q${gx0 + 7},${top.toFixed(2)} ${gx0 + 18},${top.toFixed(2)} L${gx1 - 18},${top.toFixed(2)} Q${gx1 - 7},${top.toFixed(2)} ${gx1},${(top - 1.6).toFixed(2)}" class="c-interface" opacity="${p.sep.toFixed(2)}"/>`;
      if (lit && sel !== p.key) liquid += `<rect x="${gx0 - 2}" y="${top.toFixed(2)}" width="${width + 4}" height="${Math.max(0, h).toFixed(2)}" class="c-veil is-hover"/>`;
      liquid += '</g>';
    }
    if (surface > .02) {
      const top = y(surface), topBand = shown.filter(p => p.op > .4).sort((a, b) => b.y1 - a.y1)[0], m = Math.min(4, (surface) * unit);
      const fill = topBand ? css(topBand.col) : 'transparent';
      liquid += `<path d="M${gx0},${top - m} Q${gx0 + 8},${top} ${gx0 + 22},${top} L${gx1 - 22},${top} Q${gx1 - 8},${top} ${gx1},${top - m} L${gx1},${top + 1} L${gx0},${top + 1} Z" style="fill:${fill}"/>`;
      liquid += `<rect x="${gx0}" y="${top - m}" width="${width}" height="${geo.bottom - top + m}" fill="url(#c-body)"/>`;
      liquid += `<path d="M${gx0 + .5},${top - m + .5} Q${gx0 + 8},${top} ${gx0 + 22},${top} L${gx1 - 22},${top} Q${gx1 - 8},${top} ${gx1 - .5},${top - m + .5}" class="c-surface-line"/>`;
    }
    gLiquid.innerHTML = liquid;
    // Marks outside the glass: ask tabs on the right wall, the selection
    // caliper over the scale, the headroom reading.
    let marks = '';
    for (const p of shown) {
      if (p.ghost || !p.item) continue;
      const note = notes.notes.get(p.item.id); if (!note || (!note.ask && !note.nested)) continue;
      const top = y(p.y1), h = (p.y1 - p.y0) * unit, inset = Math.min(1.5, h * .2);
      marks += `<rect x="${gx1 + (geo.narrow ? 6 : 7)}" y="${(top + inset).toFixed(2)}" width="5" height="${Math.max(1, h - inset * 2).toFixed(2)}" rx="1.5" class="${note.ask ? 'c-tab' : 'c-tab is-nested'}" opacity="${p.op.toFixed(2)}"/>`;
    }
    const selPart = sel && shown.find(p => p.key === sel);
    if (selPart) {
      const a = y(selPart.y1), b = y(selPart.y0), x = gx0 - (geo.narrow ? 6 : 7);
      marks += `<path d="M${x - 5},${a} H${x} V${b} H${x - 5}" class="c-caliper"/><line x1="${gx0}" x2="${gx1}" y1="${a + .5}" y2="${a + .5}" class="c-sel-edge"/><line x1="${gx0}" x2="${gx1}" y1="${b - .5}" y2="${b - .5}" class="c-sel-edge"/>`;
    }
    const free = BUDGET - surface;
    if (!flight) {
      const yTop = geo.y64, ySurf = y(surface), room = ySurf - yTop;
      const text = free < .5 ? '已满 64 / 64' : `空余 ${Math.round(free)} 份`;
      if (room >= 20) marks += `<text x="${(gx0 + gx1) / 2}" y="${yTop + room / 2 + 4}" class="c-room-label">${text}</text>`;
      else marks += `<text x="${(gx0 + gx1) / 2}" y="${geo.top - 10}" class="c-room-label is-above">${text}</text>`;
      if (surface > .5 && free > .5) marks += `<rect x="${gx0 - (geo.narrow ? 40 : 44)}" y="${ySurf - 7}" width="${geo.narrow ? 22 : 25}" height="14" class="c-surface-mask"/><text x="${gx0 - (geo.narrow ? 20 : 21)}" y="${ySurf + 3.5}" class="c-tick-label is-surface">${Math.round(surface)}</text><line x1="${gx0 - (geo.narrow ? 16 : 17)}" x2="${gx0 - (geo.narrow ? 6 : 7)}" y1="${ySurf}" y2="${ySurf}" class="c-tick is-surface"/>`;
    }
    marks += leaders(shown);
    gMarks.innerHTML = marks;
  }
  function leaders(shown) {
    const { gx1, labelX, y } = geo; let out = '';
    for (const [id, entry] of labelState) {
      const part = shown.find(p => p.key === id) || shown.find(p => p.key === `old:${id}` || p.key === `src:${id}`);
      if (!part || entry.opacity < .02) continue;
      const cy = y((part.y0 + part.y1) / 2), ly = entry.y + entry.anchor;
      const note = notes.notes.get(id), x0 = gx1 + (note?.ask || note?.nested ? (geo.narrow ? 13 : 14) : (geo.narrow ? 5 : 6)), elbow = labelX - 14;
      const op = Math.min(entry.opacity, part.op);
      out += `<path d="M${x0},${cy.toFixed(1)} H${x0 + 6} L${elbow},${ly.toFixed(1)} H${labelX - 4}" class="c-leader${s.selectedId === id || hoverId === id ? ' is-lit' : ''}" opacity="${op.toFixed(2)}"/><circle cx="${x0}" cy="${cy.toFixed(1)}" r="1.6" class="c-leader-dot" opacity="${op.toFixed(2)}"/>`;
    }
    return out;
  }

  // ---------- labels ----------
  function labelHTML(item, note) {
    const prevItem = s.index > 0 && getItem(s.previousState, item.id);
    const joined = !prevItem && s.index > 0 && allItems(s.state).some(x => x.merged_into === item.id && getItem(s.previousState, x.id)?.status === 'active');
    const delta = prevItem && prevItem.status === 'active' && prevItem.share !== item.share ? `<span class="c-l-delta">原 ${prevItem.share}</span>` : joined ? '<span class="c-l-delta is-new">汇合</span>' : !prevItem && s.index > 0 ? '<span class="c-l-delta is-new">新</span>' : '';
    const same = (a, b) => { const n = v => String(v || '').replace(/[\s，。？?！!：:、“”"]/g, ''); return n(a) === n(b); };
    const ask = note.ask ? `<span class="c-l-ask">${askTag(note.ask)}${same(note.ask.prompt, item.title) ? '' : ` · ${esc(note.ask.prompt)}`}</span>` : '';
    const meta = [
      note.ask ? '' : esc(kindLabel[item.kind] || item.kind),
      note.nested && !note.ask ? `<span class="c-l-nested">子项 ${note.nested} 件等你</span>` : '',
      item.children?.items.length ? `<span class="c-l-dive">内含 ${item.children.items.length} 件 ›</span>` : '',
      note.feedback.length ? `<span class="c-l-signal">↩ 本轮你${viaLabel[note.feedback[0].link.via] || '回应'}了</span>` : '',
      note.reminder ? '<span class="c-l-signal">◷ 到点提醒</span>' : '',
      note.adjusted ? '<span class="c-l-signal">按时间重看</span>' : '',
    ].filter(Boolean).join('<i aria-hidden="true">·</i>');
    return `<span class="c-l-share">${item.share}</span><span class="c-l-body"><span class="c-l-title">${esc(item.title)}${delta}</span>${ask}${meta ? `<span class="c-l-meta">${meta}</span>` : ''}</span>`;
  }
  function labelSpeech(item, note) {
    return [item.title, `${item.share} 份`, note.ask ? `${askTag(note.ask)}：${note.ask.prompt}` : (kindLabel[item.kind] || ''), note.nested && !note.ask ? `子项中 ${note.nested} 件等你回应` : '', note.feedback.length ? '本轮输入中有你对它的回应' : '', note.reminder ? '本轮有到点提醒' : '', item.children?.items.length ? `内含 ${item.children.items.length} 件，进入它的 64 份` : '查看详情'].filter(Boolean).join('，');
  }
  // Settled label slots: centred on each band, pushed apart without crossing.
  function placeLabels(bands) {
    const gap = geo.narrow ? 5 : 7, minY = geo.top - 6;
    const entries = bands.map(b => { const entry = labelState.get(b.key); const h = entry.el.offsetHeight || 40; return { id: b.key, h, want: geo.y((b.y0 + b.y1) / 2), anchor: Math.min(h / 2, 11) }; });
    let cursor = minY;
    for (const e of entries) { e.top = Math.max(e.want - e.anchor, cursor); cursor = e.top + e.h + gap; }
    let limit = Math.max(geo.bottom + 4, cursor > geo.bottom + 4 ? geo.bottom + 4 : 0);
    for (let i = entries.length - 1; i >= 0; i--) { const e = entries[i]; if (e.top + e.h > limit) e.top = limit - e.h; limit = e.top - gap; }
    cursor = minY;
    for (const e of entries) { if (e.top < cursor) e.top = cursor; cursor = e.top + e.h + gap; }
    return new Map(entries.map(e => [e.id, e]));
  }
  function syncLabels(type) {
    const bands = targetBands(s), ids = new Set(bands.map(b => b.key)), swap = type === 'dive' || type === 'rise';
    for (const [id, entry] of labelState) {
      if (ids.has(id) && !swap) continue;
      entry.leaving = true; entry.el.inert = true; entry.el.setAttribute('aria-hidden', 'true');
      if (swap) { entry.el.remove(); labelState.delete(id); }
    }
    for (const b of bands) {
      const item = b.item, note = notes.notes.get(item.id);
      let entry = labelState.get(item.id);
      if (!entry) {
        const el = document.createElement('button'); el.type = 'button'; el.className = 'c-label'; el.dataset.id = item.id;
        labelLayer.append(el); entry = { el, y: null, opacity: 0, fresh: true, sig: '' }; labelState.set(item.id, entry);
      }
      const sig = JSON.stringify([item.title, item.share, item.kind, note.ask?.prompt, note.nested, note.feedback.length, Boolean(note.reminder), note.adjusted, item.children?.items.length || 0, s.index, s.layerId]);
      if (sig !== entry.sig) { entry.el.innerHTML = labelHTML(item, note); entry.sig = sig; }
      entry.el.style.width = `${geo.labelW}px`;
      entry.el.classList.toggle('has-ask', Boolean(note.ask));
      entry.el.classList.toggle('is-small', item.share <= 3);
      entry.el.classList.toggle('is-selected', s.selectedId === item.id);
      entry.el.setAttribute('aria-pressed', String(s.selectedId === item.id));
      entry.el.setAttribute('aria-label', labelSpeech(item, note));
      entry.leaving = false; entry.el.inert = false; entry.el.removeAttribute('aria-hidden');
    }
    // Keep DOM order equal to rank so Tab walks the vessel top-down.
    for (const b of bands) labelLayer.append(labelState.get(b.key).el);
    const slots = placeLabels(bands);
    let height = geo.bottom + 26;
    for (const [id, entry] of labelState) {
      const slot = slots.get(id);
      if (slot) { entry.from = entry.y ?? slot.top; entry.to = slot.top; entry.anchor = slot.anchor; entry.fromOp = entry.fresh ? 0 : entry.opacity; entry.toOp = 1; entry.jump = entry.fresh ? undefined : false; height = Math.max(height, slot.top + slot.h + 8); }
      else { entry.from = entry.y; entry.to = entry.y; entry.fromOp = entry.opacity; entry.toOp = 0; }
      if (entry.fresh && !swap && type !== 'init') entry.from = slot?.top;
      entry.fresh = false;
    }
    // Labels that keep their order glide; the fewest others crossfade (LIS).
    const persistent = bands.map(b => labelState.get(b.key)).filter(e => e && e.jump !== undefined && e.toOp === 1 && e.fromOp > .05);
    const keep = longestRising(persistent.map(e => e.from));
    persistent.forEach((e, i) => { e.jump = !keep.has(i); });
    stage.style.height = `${Math.ceil(height)}px`;
  }
  function placeLabelFrame(raw) {
    const t = ease(raw);
    for (const [id, entry] of labelState) {
      // Short moves glide; a label that changes places fades out, then reappears
      // beside its settled layer, so text never slides across other text.
      if (entry.jump === true && entry.toOp === 1 && raw < 1) {
        entry.y = raw < .5 ? entry.from : entry.to;
        entry.opacity = raw < .5 ? entry.fromOp * clamp(1 - raw / .25, 0, 1) : clamp((raw - .6) / .35, 0, 1);
      } else {
        entry.y = lerp(entry.from ?? entry.to, entry.to ?? entry.from, t);
        // New labels appear once their layer has mostly arrived; old ones go first.
        const opT = entry.toOp > entry.fromOp ? clamp((raw - .45) / .5, 0, 1) : clamp(raw / .4, 0, 1);
        entry.opacity = lerp(entry.fromOp, entry.toOp, opT);
      }
      if (raw >= 1) entry.jump = false;
      entry.el.style.transform = `translate3d(${geo.labelX}px,${entry.y.toFixed(1)}px,0)`;
      entry.el.style.opacity = entry.opacity.toFixed(3);
      if (raw >= 1 && entry.toOp === 0) { entry.el.remove(); labelState.delete(id); }
    }
  }

  // ---------- transitions ----------
  function current() { return flight ? sampleParts(flight.parts, clamp((performance.now() - flight.start) / flight.duration, 0, 1)) : settled; }
  function tick(now) {
    raf = 0; if (disposed || !flight) return;
    const raw = clamp((now - flight.start) / flight.duration, 0, 1);
    const vis = sampleParts(flight.parts, raw);
    flight.column = lerp(flight.fromSurface, flight.toSurface, ease(raw));
    placeLabelFrame(raw);
    if (raw >= 1) { flight = null; settled = targetBands(s); render(settled); return; }
    render(vis);
    raf = requestAnimationFrame(tick);
  }
  function transition(type, anchorId) {
    const old = current();
    notes = annotate(s);
    syncLabels(type);
    const instant = type === 'init' || type === 'resize' || reduced.matches || document.hidden;
    if (instant) { cancelAnimationFrame(raf); raf = 0; flight = null; settled = targetBands(s); placeLabelFrame(1); render(settled); return; }
    const level = list => list.reduce((m, p) => Math.max(m, p.op > .4 ? p.y1 : 0), 0);
    flight = { parts: buildTransition(old, prev, s, type, anchorId), start: performance.now(), duration: type === 'dive' || type === 'rise' ? 1100 : DURATION, fromSurface: level(old), toSurface: level(targetBands(s)), column: level(old) };
    if (type === 'dive' || type === 'rise') flight.fromSurface = flight.toSurface = flight.column = 0;
    if (!raf) raf = requestAnimationFrame(tick);
  }
  const geometryKey = x => `${x.layerId || 'root'}|${x.layer.items.map(i => `${i.id}:${i.share}:${i.rank}`).join(',')}`;
  function refreshStatic() { notes = annotate(s); syncLabels('select'); placeLabelFrame(1); render(current()); }

  // ---------- header, lede, track ----------
  function renderTop() {
    const f = s.frame, n = s.frames.length;
    $('.c-when-date').textContent = clock(s.cursor);
    $('.c-when-count').textContent = `第 ${s.index + 1} / ${n} 次整理`;
    $('.c-play').innerHTML = s.playing ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 5h2.5v10H6.5zm4.5 0h2.5v10H11z" class="is-fill"/></svg><span>暂停</span>' : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4.5 8.5 5.5L7 15.5Z" class="is-fill"/></svg><span>播放</span>';
    $('.c-play').setAttribute('aria-label', s.playing ? '暂停回放' : '播放回放');
    host.querySelector('[data-c="prev"]').disabled = s.index === 0;
    host.querySelector('[data-c="next"]').disabled = s.index === n - 1;
    const pos = i => `${(i / (n - 1)) * 100}%`;
    let lastDay = '';
    const days = [];
    $('.c-track-ticks').innerHTML = s.frames.map((frame, i) => {
      const d = formatDate(frame.at), first = d !== lastDay; lastDay = d;
      if (first) days.push(`<span style="left:${pos(i)}">${new Date(frame.at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', day: 'numeric' }).replace('日', '')}</span>`);
      return `<i class="${first ? 'is-day' : ''}${frame.signal?.type === 'review' ? ' is-review' : ''}${i <= s.index ? ' is-past' : ''}" style="left:${pos(i)}"></i>`;
    }).join('');
    $('.c-track-days').innerHTML = days.join('');
    $('.c-track-thumb').style.left = pos(s.index);
    track.setAttribute('aria-valuemin', '1'); track.setAttribute('aria-valuemax', String(n)); track.setAttribute('aria-valuenow', String(s.index + 1));
    track.setAttribute('aria-valuetext', `${clock(f.at)}，${f.title}`);

    const items = s.layer.items, asks = items.filter(i => notes.notes.get(i.id)?.ask), nested = items.filter(i => !notes.notes.get(i.id)?.ask && notes.notes.get(i.id)?.nested);
    const owner = s.layerId && getItem(s.state, s.layerId);
    $('.c-headline').innerHTML = !items.length ? (s.layerId ? '这一层还空着' : '还空着，没有需要记住的事') : asks.length ? `<em>${asks.length} 件</em>等你回应${nested.length ? `<small>，另有 ${nested.length} 件的子项里有</small>` : ''}` : nested.length ? `没有直接等你的事<small>，${nested.length} 件的子项里有</small>` : '没有等你回应的事';
    $('.c-frame-title').textContent = owner ? `「${owner.title}」自己的 64 份 · ${f.title}` : f.title;
    $('.c-signal').innerHTML = signalHTML();
    const path = s.path || [];
    $('.c-path').hidden = !s.layerId;
    $('.c-path').innerHTML = s.layerId ? `<button type="button" class="c-back" data-c="rise"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg>返回${path.length > 1 ? '上一层' : '全部事项'}</button><span class="c-crumbs"><button type="button" data-c="root">全部 64 份</button>${path.map((p, i) => `<i aria-hidden="true">›</i>${i === path.length - 1 ? `<b>${esc(p.title)} · 独立 64 份</b>` : `<span>${esc(p.title)}</span>`}`).join('')}</span>` : '';
  }
  function sameShares() {
    if (!s.index) return true;
    const a = s.previousState.root.items.map(i => `${i.id}:${i.share}`).sort().join(), b = s.state.root.items.map(i => `${i.id}:${i.share}`).sort().join();
    return a === b;
  }
  function signalHTML() {
    const signal = s.frame.signal;
    if (!signal) return '<span class="c-sig-kind">初始状态</span>还没有收到输入，64 份全部空着。';
    if (signal.type === 'review') {
      const changes = (s.frameDiff?.changes || []).length, checked = s.records[s.index]?.receipt?.type === 'checked' || !changes;
      return `<span class="c-sig-kind is-review">零事件整理</span>${esc(signal.reason)}：${formatTime(signal.window.from)} 起收到 0 条；${esc(signal.coverage)}。<b>${checked ? '检查后不改' : `按时间重看，更新 ${changes} 项`}</b>${sameShares() ? '，份额未变，液面不动。' : '。'}`;
    }
    const events = s.frame.events, fb = events.filter(e => e.feedback?.length).length, rem = events.filter(e => e.reminder).length;
    const extra = [fb ? `↩ ${fb} 条是你的回应` : '', rem ? `◷ ${rem} 条到点提醒` : ''].filter(Boolean).join('，');
    return `<span class="c-sig-kind">本轮输入</span><button type="button" class="c-sig-open" data-c="overview">${events.length} 条${extra ? `，${extra}` : ''}</button>${s.records[s.index]?.receipt?.type === 'checked' ? '<b>检查后不改</b>' : ''}`;
  }

  // ---------- reading pane ----------
  function sourceHTML(src) {
    const e = src.ref?.startsWith('event:') ? findEvent(src.ref.slice(6)) : null;
    const pub = e?.publicSourceId && scenario.publicSources?.find(p => p.id === e.publicSourceId);
    return `<blockquote class="c-quote"><p>${esc(src.quote || src.content || e?.text || src.ref)}</p><footer>${esc(src.author || e?.from || '')} · ${esc(src.channel || '')}${e ? ` · ${clock(e.at)}` : ''}${pub ? ` · <a href="${esc(pub.url)}" target="_blank" rel="noreferrer">${esc(pub.title)} ↗</a>` : ''}</footer></blockquote>`;
  }
  function loopHTML(item) {
    const ask = currentAsk(s, item.id), trail = feedbackTrail(s, item.id);
    if (!ask && !trail.length && item.kind !== 'needs-you') return '';
    const askBlock = ask ? `<div class="c-ask"><span class="c-ask-tag">${askTag(ask)}</span><p class="c-ask-prompt">${esc(ask.prompt)}</p><div class="c-ask-actions" aria-label="登记的回应方式">${ask.actions.map(a => `<span class="c-ask-action${a.recommended ? ' is-rec' : ''}" aria-disabled="true">${a.meaning === 'input' ? '✎ ' : ''}${esc(a.label || a.id)}${a.recommended ? '<small>推荐</small>' : ''}</span>`).join('')}<span class="c-ask-action is-snooze" aria-disabled="true">◷ 稍后</span></div><p class="c-note">回应方式只作展示，这里不能提交；回应交给下一次整理。就地回应见 D。</p></div>`
      : `<p class="c-note">${item.kind === 'needs-you' ? '当前版本没有登记回应方式；Agent 改写后没有重新登记，就没有可回传的路径。' : '当前版本没有登记回应方式，只需知道。'}</p>`;
    const rows = trail.slice().reverse().map(({ event, links, frameIndex }) => {
      const what = event.reminder ? `◷ 到点提醒 · ${formatTime(event.reminder.requested_at)} 时约定` : links.map(link => `↩ ${viaLabel[link.via] || link.via} · ${esc(feedbackText(s, link, frameIndex))}`).join('；');
      return `<li${frameIndex === s.index ? ' class="is-now"' : ''}><time>${clock(event.at || s.frames[frameIndex].at)}${frameIndex === s.index ? '<b>本轮</b>' : ''}</time><p class="c-trail-what">${what}</p><p class="c-trail-text">${esc(event.text)}</p></li>`;
    }).join('');
    return `<section><h3>反馈回路</h3>${askBlock}${rows ? `<ol class="c-trail">${rows}</ol>` : ''}</section>`;
  }
  function detailHTML(item, asOwner) {
    const parent = item.parent_id && getItem(s.state, item.parent_id);
    const category = scenario.categories?.[rootOf(s.state, item).id]?.label;
    const anns = (s.state.annotations || []).filter(a => a.item === item.id || a.item_id === item.id || item.annotations?.includes(a.id));
    const children = [...(item.children?.items || [])].sort((a, b) => a.rank - b.rank);
    const head = asOwner ? `<p class="c-read-kicker">你在它的 64 份里 · 已分配 ${item.children?.used ?? 0}</p>` : `<button type="button" class="c-read-back" data-c="overview">‹ 本轮概览</button>`;
    return `${head}<p class="c-read-meta">${esc([category, parent ? `属于「${parent.title}」` : '', kindLabel[item.kind]].filter(Boolean).join(' · '))}<span class="c-read-share">${item.share} / 64</span></p>
      <h2>${esc(item.title)}</h2>
      <p class="c-read-summary">${esc(item.summary)}</p>
      ${item.merged_into ? `<p class="c-note">已合并到 <button type="button" class="c-inline" data-select="${esc(item.merged_into)}">${esc(getItem(s.state, item.merged_into)?.title || item.merged_into)}</button></p>` : ''}
      ${loopHTML(item)}
      ${item.reason ? `<section><h3>为什么是这个分量</h3><p>${esc(item.reason)}</p></section>` : ''}
      ${item.sources?.length ? `<section><h3>依据原文</h3>${item.sources.map(sourceHTML).join('')}</section>` : ''}
      ${anns.length ? `<section><h3>批注</h3>${anns.map(a => `<blockquote class="c-quote"><p>${esc(a.text)}</p><footer>${esc(a.author || '用户')} · ${a.status === 'acknowledged' ? 'Agent 已纳入整理' : '已保存，等待处理确认'}</footer></blockquote>`).join('')}</section>` : ''}
      ${children.length && !asOwner ? `<section><h3>内含 ${children.length} 件 · 独立 64 份</h3><ul class="c-children">${children.map(c => `<li><span>${currentAsk(s, c.id) ? '<i class="c-dot-ask" aria-label="等你回应"></i>' : ''}${esc(c.title)}</span><small>${c.share} 份</small></li>`).join('')}</ul><button type="button" class="c-cta" data-dive="${esc(item.id)}">进入它的 64 份 →</button></section>` : ''}
      <button type="button" class="c-json" data-lab-inspect="state">核对完整状态 JSON ↗</button>`;
  }
  function overviewHTML() {
    const f = s.frame, events = f.events, signal = f.signal;
    if (!signal) return `<p class="c-read-kicker">本轮概览</p><h2>${esc(f.title)}</h2><p class="c-read-summary">${esc(f.narrative)}</p><p class="c-note">容器从空开始：没有输入，就没有份额被分配。</p>`;
    const allChanges = (s.frameDiff?.changes || []).filter(c => c.type !== 'annotations_changed');
    const layerIds = new Set([...s.layer.items.map(i => i.id), ...s.previousState && getLayerIds(s)]);
    const changes = allChanges.filter(c => layerIds.has(c.item)), nestedChanges = allChanges.length - changes.length;
    const name = id => esc(getItem(s.state, id)?.title || getItem(s.previousState, id)?.title || id);
    const groups = { added: [], withdrawn: [], merged: [], updated: [] };
    for (const c of changes) (groups[c.type] || groups.updated).push(c);
    const mergedInto = new Map();
    for (const c of groups.merged) { const into = getItem(s.state, c.item)?.merged_into; if (into) mergedInto.set(into, [...(mergedInto.get(into) || []), c.item]); }
    const changeRows = [
      groups.added.filter(c => !mergedInto.has(c.item)).length ? `<li><b>新注入</b>${groups.added.filter(c => !mergedInto.has(c.item)).map(c => name(c.item)).join('、')}</li>` : '',
      [...mergedInto].map(([into, from]) => `<li><b>汇合</b>${from.map(name).join(' + ')} → ${name(into)}</li>`).join(''),
      groups.withdrawn.length ? `<li><b>流出</b>${groups.withdrawn.map(c => name(c.item)).join('、')}</li>` : '',
      groups.updated.length ? (() => { const moved = groups.updated.filter(c => c.fields.includes('share')); return `<li><b>调整</b>${groups.updated.length} 项${moved.length ? `，其中 ${moved.length} 项份额变化：${moved.slice(0, 4).map(c => `${name(c.item)} ${c.before.share}→${c.after.share}`).join('；')}${moved.length > 4 ? ' 等' : ''}` : '，内容更新，份额未变'}</li>`; })() : '',
      nestedChanges ? `<li><b>子项</b>另有 ${nestedChanges} 处变化，进入对应事项查看</li>` : '',
    ].filter(Boolean).join('');
    const review = signal.type === 'review' ? (() => {
      const checked = s.records[s.index]?.receipt?.type === 'checked' || !changes.length;
      return `<section class="c-review"><h3>零事件整理</h3><dl><div><dt>调用原因</dt><dd>${esc(signal.reason)}</dd></div><div><dt>窗口</dt><dd>${clock(signal.window.from)} — ${clock(signal.window.to)}，收到 0 条</dd></div><div><dt>覆盖</dt><dd>${esc(signal.coverage)}</dd></div><div><dt>结果</dt><dd>${checked ? '检查后不改' : `按时间重看，更新了 ${changes.map(c => `「${name(c.item)}」`).join('、')}`}${sameShares() ? '；份额未变，液面保持不动' : ''}</dd></div></dl><p class="c-note">没有收到消息不等于现实没有变化；这次整理只说明窗口内没有输入。</p></section>`;
    })() : '';
    const inputs = events.length ? `<section><h3>本轮输入 · ${events.length} 条</h3><ol class="c-inputs">${events.map((e, i) => {
      const linked = notes.links.filter(l => l.index === i);
      const linkRows = linked.map(l => {
        const title = l.at ? getItem(s.state, l.at.id)?.title : '';
        const what = l.reminder ? `◷ 到点提醒：你 ${clock(l.reminder.requested_at)} 让我此刻再提起` : `↩ ${viaLabel[l.link.via] || l.link.via}回应「${esc(priorAsk(s, l.link.target, s.index - 1)?.prompt || getItem(s.state, l.link.target)?.title || '')}」：${esc(feedbackText(s, l.link, s.index))}`;
        return `<div class="c-input-link"><span>${what}</span>${l.at ? `<button type="button" data-select="${esc(l.at.id)}" data-locate="${esc(l.at.id)}">定位到「${esc(title)}」${l.at.direct ? '' : '（所在事项）'}</button>` : '<span class="c-note">对应事项不在当前层</span>'}</div>`;
      }).join('');
      return `<li class="${linked.length ? 'is-linked' : ''}${e.disposition !== 'used' ? ' is-quiet' : ''}"><div class="c-input-head"><span>${esc(e.channel)} · ${esc(e.from)} · ${formatTime(e.at)}</span><b>${dispositionLabel[e.disposition] || e.disposition}</b></div><p>${esc(e.text)}</p>${e.why ? `<small>${esc(e.why)}</small>` : ''}${linkRows}</li>`;
    }).join('')}</ol><button type="button" class="c-json" data-lab-inspect="inputs">原始输入 ↗</button> <button type="button" class="c-json" data-lab-inspect="batch">声明与回执 ↗</button></section>` : '';
    return `<p class="c-read-kicker">本轮概览 · ${clock(f.at)}</p><h2>${esc(f.title)}</h2><p class="c-read-summary">${esc(f.narrative)}</p>${review}${changeRows ? `<section><h3>本轮变化</h3><ul class="c-changes">${changeRows}</ul></section>` : ''}${inputs}`;
  }
  function renderRead() {
    const item = s.selectedId && (getItem(s.state, s.selectedId) || getItem(s.baseState, s.selectedId));
    const owner = !item && s.layerId && getItem(s.state, s.layerId);
    const sig = `${s.index}|${s.cursor}|${s.layerId}|${s.selectedId}`;
    if (read.dataset.sig === sig) return;
    read.dataset.sig = sig;
    read.innerHTML = item ? detailHTML(item, false) : owner ? detailHTML(owner, true) : overviewHTML();
  }

  // ---------- events ----------
  function choose(id, fromPointer) {
    const item = getItem(s.state, id); if (!item) return;
    if (item.children?.items?.length) model.dive(id);
    else model.select(s.selectedId === id ? null : id);
    if (fromPointer && geo.narrow) requestAnimationFrame(() => $('.c-read').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' }));
  }
  host.addEventListener('click', event => {
    const t = event.target.closest('button, .c-band');
    if (!t) { if (event.target.closest('.c-stage')) model.select(null); return; }
    if (t.dataset.labInspect) return; // the lab shell opens the inspector
    if (t.classList.contains('c-label')) { choose(t.dataset.id, event.detail > 0); return; }
    if (t.classList.contains('c-band')) { if (t.dataset.id) choose(t.dataset.id, true); return; }
    if (t.dataset.select) { model.select(t.dataset.select); return; }
    if (t.dataset.dive) { model.dive(t.dataset.dive); return; }
    switch (t.dataset.c) {
      case 'prev': model.goFrame(s.index - 1); break;
      case 'next': model.goFrame(s.index + 1); break;
      case 'play': model.togglePlay(); break;
      case 'rise': model.rise(); break;
      case 'root': model.goRoot(); break;
      case 'overview': model.select(null); break;
    }
  });
  const hover = id => { if (hoverId === id) return; hoverId = id; host.querySelectorAll('.c-label').forEach(el => el.classList.toggle('is-hover', el.dataset.id === id)); if (!flight) render(settled); };
  host.addEventListener('pointerover', event => { const t = event.target.closest('.c-label, .c-band, [data-locate]'); hover(t ? (t.dataset.locate || t.dataset.id || null) : null); });
  host.addEventListener('focusin', event => { const t = event.target.closest('.c-label, [data-locate]'); if (t) hover(t.dataset.locate || t.dataset.id); });
  host.addEventListener('focusout', () => hover(null));
  stage.addEventListener('pointerleave', () => hover(null));
  // The scrubber: drag or click to a整理时刻; arrows are the shell's ←/→.
  const frameAt = x => { const r = track.getBoundingClientRect(); return Math.round(clamp((x - r.left) / r.width, 0, 1) * (s.frames.length - 1)); };
  let scrubbing = false;
  track.addEventListener('pointerdown', event => { scrubbing = true; track.setPointerCapture(event.pointerId); const i = frameAt(event.clientX); if (i !== s.index) model.goFrame(i); });
  track.addEventListener('pointermove', event => { if (!scrubbing) return; const i = frameAt(event.clientX); if (i !== s.index) model.goFrame(i); });
  track.addEventListener('pointerup', () => { scrubbing = false; });
  track.addEventListener('keydown', event => {
    const map = { Home: 0, End: s.frames.length - 1, PageUp: s.index - 5, PageDown: s.index + 5, ArrowUp: s.index + 1, ArrowDown: s.index - 1 };
    if (event.key in map) { event.preventDefault(); model.goFrame(map[event.key]); }
  });

  let resizeFrame = 0;
  const onResize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { const w = stage.clientWidth; if (geo && w === geo.w && Math.abs(geo.unit - (geo.narrow ? 6.6 : clamp((innerHeight - 440) / BUDGET, 5.4, 8.6))) < .01) return; measure(); transition('resize'); }); };
  const observer = new ResizeObserver(onResize); observer.observe(stage);
  addEventListener('resize', onResize);

  measure();
  const unsubscribe = model.subscribe((next, info) => {
    prev = s; s = next;
    const key = geometryKey(s), changed = key !== layoutKey;
    if (info.type === 'init') { layoutKey = key; transition('init'); }
    else if (changed || info.type === 'dive' || info.type === 'rise') {
      layoutKey = key;
      const layerMoved = (prev?.layerId || null) !== (s.layerId || null);
      const type = info.type === 'dive' || info.type === 'rise' ? info.type : layerMoved ? (s.layerId ? 'dive' : 'rise') : 'frame';
      transition(type, info.anchorId || (type === 'rise' ? prev?.layerId : s.layerId));
    } else refreshStatic();
    renderTop();
    renderRead();
  });
  return () => { disposed = true; cancelAnimationFrame(raf); cancelAnimationFrame(resizeFrame); observer.disconnect(); removeEventListener('resize', onResize); unsubscribe(); };
}
