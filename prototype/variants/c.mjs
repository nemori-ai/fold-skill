import { escapeHTML as esc, formatDate, formatTime, kindLabel, allItems, getItem, currentAsk, feedbackTrail, findEvent, scenario, colorFor } from './shared.mjs?v=feedback-loop-1';
import { createRenderer, solveLayout, MAX_DROPS } from './c-field.mjs?v=drops-2';

// C · 流动形态。Each item is one drop whose area is its share of this layer's
// 64. Drops keep their place across frames, grow and shrink with their share,
// and only an explicit merged_into lets two drops flow together into one
// (replaying backwards pulls them apart along the same path). A 64-cell
// budget strip carries the exact numbers, including what is unallocated.
// The field only renders while something moves; at rest the canvas is still.
const BUDGET = 64;
const DURATION = 1300;
const ZOOM = 3.2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, t) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const inOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const outCubic = t => 1 - Math.pow(1 - t, 3);
const inCubic = t => t * t * t;
const outBack = t => { const c = 1.25; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const clock = value => `${formatDate(value)} ${formatTime(value)}`;
const expectLabel = { decide: '决定', input: '提供', act: '去做' };
const askTag = ask => `等你${ask.expects.map(e => expectLabel[e] || e).join('、')}`;
const viaLabel = { reply: '回复', button: '按钮' };
const dispositionLabel = { used: '采用', duplicate: '重复', noise: '噪音', deferred: '暂缓' };
const hash = id => [...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
const hexRGB = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const cssRGB = c => `rgb(${c.map(v => Math.round(clamp(v, 0, 1) * 255)).join(' ')})`;

function rootOf(state, item) {
  let node = item; const seen = new Set();
  while (node?.parent_id && !seen.has(node.id)) { seen.add(node.id); node = getItem(state, node.parent_id) || node; if (seen.has(node.id)) break; }
  return node || item;
}
// Category colour, stable per root item; children vary lightness inside it.
// The shared palette is nudged a little richer so the drops read as gel.
function dropColor(state, item, nested) {
  let [r, g, b] = hexRGB(colorFor(item, state));
  const mean = (r + g + b) / 3; [r, g, b] = [r, g, b].map(v => clamp(mean + (v - mean) * 1.22, 0, 1));
  if (nested) {
    const step = [-.07, .06, -.02, .1, -.11, .03][hash(item.id) % 6];
    [r, g, b] = [r, g, b].map(v => step > 0 ? v + (1 - v) * step * 1.4 : v * (1 + step));
  }
  return [r, g, b];
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
// The visible drop stands for a target: itself, what it merged into, or its
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
function getLayerIds(s) {
  const prevLayer = s.layerId ? getItem(s.previousState, s.layerId)?.children : s.previousState.root;
  const ids = (prevLayer?.items || []).map(i => i.id);
  for (const item of allItems(s.state)) if ((item.parent_id || null) === (s.layerId || null)) ids.push(item.id);
  return ids;
}
const activeItems = s => [...s.layer.items].filter(i => i.status !== 'withdrawn' && i.status !== 'merged').sort((a, b) => a.rank - b.rank);

export function mount(host, model) {
  host.classList.add('variant-c');
  host.innerHTML = `<div class="c-shell">
    <header class="c-top">
      <div class="c-brand"><b>Fold</b><span>流动形态</span></div>
      <div class="c-time" aria-label="回放时刻">
        <div class="c-steps"><button type="button" class="c-icon" data-c="prev" aria-label="上一次整理"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg></button><button type="button" class="c-play" data-c="play" aria-label="播放回放"></button><button type="button" class="c-icon" data-c="next" aria-label="下一次整理"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg></button></div>
        <div class="c-when"><b class="c-when-date"></b><small class="c-when-count"></small></div>
        <div class="c-track" role="slider" tabindex="0" aria-label="选择整理时刻"><div class="c-track-rail"></div><div class="c-track-ticks"></div><div class="c-track-days" aria-hidden="true"></div><div class="c-track-thumb"></div></div>
      </div>
      <button type="button" class="c-state" data-lab-inspect="state">完整状态 ↗</button>
    </header>
    <main class="c-main">
      <section class="c-field-col" aria-label="当前层的注意力分配">
        <div class="c-lede"><h1 class="c-headline"></h1><p class="c-frame-title"></p><p class="c-signal" aria-live="polite"></p></div>
        <nav class="c-path" aria-label="当前层级"></nav>
        <div class="c-stage"><canvas class="c-canvas" aria-hidden="true"></canvas><div class="c-empty" hidden></div><div class="c-labels" role="group" aria-label="本层事项，按优先级排列"></div></div>
        <div class="c-budget"><div class="c-budget-cells" role="img"></div><p class="c-budget-text"></p></div>
        <p class="c-legend"><span><i class="c-key-drop"></i>液滴面积 ∝ 份额，精确份数见 64 格</span><span><i class="c-key-ring"></i>朱红环 = 登记了回应路径</span><span><i class="c-key-ring is-dashed"></i>虚线 = 在子项里</span><span>↩ 本轮你的回应 · ◷ 到点提醒</span><span><i class="c-key-merge"></i>只有明确合并才融为一滴</span></p>
      </section>
      <aside class="c-read" aria-label="阅读区"><div class="c-read-inner"></div></aside>
    </main>
  </div>`;
  const $ = selector => host.querySelector(selector);
  const stage = $('.c-stage'), canvas = $('.c-canvas'), labelLayer = $('.c-labels'), read = $('.c-read-inner'), track = $('.c-track');
  const renderer = createRenderer(canvas);
  stage.dataset.renderer = renderer.kind;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let s = model.snapshot(), prev = null, disposed = false, hoverId = null, notes = annotate(s);
  let geo = null, settled = [], flight = null, raf = 0, lastDrops = [], layoutKey = '', preparedScale = 1, settledScale = 1;
  const labels = new Map();      // id -> { el, pin, mode, side, off:{x,y}, w, h, opacity, ... }
  const lights = new Map();      // id -> current inner light
  const placeCache = new Map();  // layer -> Map(id -> {fx, fy, side})

  // ---------- geometry ----------
  const baseHeight = w => w < 560 ? Math.round(clamp(w * 1.62, 460, 700)) : Math.round(clamp(innerHeight - 360, 400, 720));
  function measure() {
    const w = stage.clientWidth || 600, narrow = w < 560;
    // On a phone the field is taller than the drops need: the extra height is
    // room for labels beside small drops, not larger drops.
    const h = baseHeight(w);
    const sizing = narrow ? w * clamp(w * 1.32, 440, 580) : w * h;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    stage.style.height = `${h}px`;
    geo = { w, h, baseH: h, narrow, dpr, cx: w / 2, cy: h * .47, perShare: (narrow ? .22 : .27) * sizing / BUDGET, labelW: narrow ? 138 : 212 };
    renderer.resize(w, h, dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  }
  const radiusOf = (share, scale = 1) => Math.sqrt(Math.max(0, share) * geo.perShare / Math.PI) * scale;

  // ---------- labels ----------
  function labelHTML(item, note, inside) {
    const prevItem = s.index > 0 && getItem(s.previousState, item.id);
    const joined = !prevItem && s.index > 0 && allItems(s.state).some(x => x.merged_into === item.id && getItem(s.previousState, x.id)?.status === 'active');
    const delta = prevItem && prevItem.status === 'active' && prevItem.share !== item.share ? `<span class="c-l-delta">原 ${prevItem.share}</span>` : joined ? '<span class="c-l-delta is-new">汇合</span>' : !prevItem && s.index > 0 ? '<span class="c-l-delta is-new">新</span>' : '';
    const same = (a, b) => { const n = v => String(v || '').replace(/[\s，。？?！!：:、“”"]/g, ''); return n(a) === n(b); };
    const ask = note.ask ? `<span class="c-l-ask">${askTag(note.ask)}${same(note.ask.prompt, item.title) ? '' : ` · ${esc(note.ask.prompt)}`}</span>` : '';
    const meta = [
      note.ask || inside ? '' : esc(kindLabel[item.kind] || item.kind),
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
  // Fill each label and decide whether it fits inside its drop.
  function prepareLabels(items, scale) {
    preparedScale = scale;
    const sig = `${s.index}|${s.layerId}|${geo.w}|${scale.toFixed(3)}`;
    for (const item of items) {
      const note = notes.notes.get(item.id);
      let entry = labels.get(item.id);
      if (!entry) {
        const el = document.createElement('button'); el.type = 'button'; el.className = 'c-label'; el.dataset.id = item.id; el.style.opacity = '0';
        const pin = document.createElement('span'); pin.className = 'c-pin'; pin.setAttribute('aria-hidden', 'true'); pin.style.opacity = '0';
        labelLayer.append(el); labelLayer.append(pin);
        entry = { el, pin, opacity: 0, fresh: true, sig: '', x: null, y: null };
        labels.set(item.id, entry);
      }
      entry.leaving = false; entry.el.inert = false; entry.el.removeAttribute('aria-hidden');
      const r = radiusOf(item.share, scale), key = `${sig}|${item.title}|${item.share}|${note.ask?.prompt}|${note.nested}|${note.feedback.length}|${!!note.reminder}|${note.adjusted}`;
      if (entry.sig !== key) {
        entry.sig = key;
        // Try inside first: a centred block inscribed in the drop.
        let inside = false;
        if (r >= (geo.narrow ? 52 : 58)) {
          entry.el.className = 'c-label is-inside'; entry.el.innerHTML = labelHTML(item, note, true);
          entry.el.style.width = `${Math.round(r * 1.56)}px`; entry.el.style.maxWidth = '';
          inside = entry.el.offsetHeight <= r * 1.22;
        }
        if (!inside) { entry.el.className = 'c-label is-outside'; entry.el.innerHTML = labelHTML(item, note, false); entry.el.style.width = ''; entry.el.style.maxWidth = `${geo.labelW}px`; }
        entry.mode = inside ? 'inside' : 'outside';
        entry.w = entry.el.offsetWidth; entry.h = entry.el.offsetHeight;
        entry.pin.innerHTML = [note.feedback.length ? '↩' : '', note.reminder ? '◷' : ''].filter(Boolean).join('');
      }
      entry.el.classList.toggle('is-selected', s.selectedId === item.id);
      entry.el.classList.toggle('is-hover', hoverId === item.id);
      entry.el.setAttribute('aria-pressed', String(s.selectedId === item.id));
      entry.el.setAttribute('aria-label', labelSpeech(item, note));
    }
    // DOM order equals rank, so Tab walks the drops by priority.
    for (const item of items) { const e = labels.get(item.id); labelLayer.append(e.el, e.pin); }
  }

  // ---------- target layout ----------
  function layerKeyOf(x) { return x.layerId || 'root'; }
  function targetDrops(type, old) {
    const items = activeItems(s), nested = Boolean(s.layerId), cache = placeCache.get(layerKeyOf(s)) || new Map();
    const oldMap = new Map(old.map(d => [d.id, d]));
    let best = null;
    // Prefer full-size drops: a phone first grows the field taller, then both
    // shrink the drops a little if labels still cannot sit clear.
    const attempts = geo.narrow ? [[1, 1], [1, 1.14], [1, 1.28], [.92, 1.28], [.84, 1.28], [.76, 1.28]] : [[1, 1], [.92, 1], [.84, 1], [.76, 1]];
    for (const [scale, grow] of attempts) {
      const H = Math.round(geo.baseH * grow);
      prepareLabels(items, scale);
      const nodes = items.map(item => {
        const r = radiusOf(item.share, scale), e = labels.get(item.id), c = cache.get(item.id);
        const note = notes.notes.get(item.id), ringed = Boolean(note?.ask || note?.nested);
        const node = { id: item.id, r: r + (ringed ? 7 : 0), share: item.share, label: { w: e.w, h: e.h, inside: e.mode === 'inside' } };
        if (c) { node.prev = { x: c.fx * geo.w, y: Math.min(c.y, H - r) }; node.side = c.side; }
        else if (type === 'frame') {
          // Seed merges where their sources were, splits where the merged drop was.
          const sources = old.filter(d => getItem(s.state, d.id)?.merged_into === item.id);
          const host = prev && oldMap.get(getItem(prev.state, item.id)?.merged_into || getItem(s.state, item.id)?.merged_into);
          if (sources.length) { const m = sources.reduce((n, d) => n + d.r * d.r, 0) || 1; node.seed = { x: sources.reduce((n, d) => n + d.x * d.r * d.r, 0) / m, y: sources.reduce((n, d) => n + d.y * d.r * d.r, 0) / m }; }
          else if (host) { const a = (hash(item.id) % 360) * Math.PI / 180; node.seed = { x: host.x + Math.cos(a) * host.r * .6, y: host.y + Math.sin(a) * host.r * .6 }; }
        }
        return node;
      });
      const solved = solveLayout(nodes, { w: geo.w, h: H }, { gap: geo.narrow ? 12 : 18, margin: geo.narrow ? 8 : 14, labelGap: geo.narrow ? 10 : 13, centerY: .47 });
      if (!best || solved.overflow < best.solved.overflow * .6) best = { solved, scale, nodes, H };
      if (solved.overflow < 40) { best = { solved, scale, nodes, H }; break; }
    }
    if (best.H !== geo.h) { geo.h = best.H; geo.cy = best.H * .47; stage.style.height = `${best.H}px`; renderer.resize(geo.w, geo.h, geo.dpr); canvas.style.height = `${best.H}px`; }
    if (preparedScale !== best.scale) prepareLabels(items, best.scale);
    settledScale = best.scale;
    const next = new Map();
    const drops = items.map(item => {
      const p = best.solved.positions.get(item.id), note = notes.notes.get(item.id);
      next.set(item.id, { fx: p.x / geo.w, y: p.y, side: p.side });
      return { id: item.id, item, x: p.x, y: p.y, r: radiusOf(item.share, best.scale), color: dropColor(s.state, item, nested), ring: note?.ask ? 1 : note?.nested ? 1 : 0, dashed: !note?.ask && Boolean(note?.nested), side: p.side, alpha: 1 };
    });
    placeCache.set(layerKeyOf(s), next);
    return drops;
  }
  const settledSide = id => settled.find(d => d.id === id)?.side;
  const applySide = (e, d) => { for (const side of ['right', 'left', 'top', 'bottom']) e.el.classList.toggle(`side-${side}`, e.mode === 'outside' && d.side === side); };
  // Where a label sits relative to its drop centre.
  function labelOffset(d, e, side = d.side) {
    const g = geo.narrow ? 10 : 13, r = d.r + (d.ring ? 7 : 0);
    if (e.mode === 'inside') return { x: -e.w / 2, y: -e.h / 2 };
    if (side === 'right') return { x: r + g, y: -e.h / 2 };
    if (side === 'left') return { x: -r - g - e.w, y: -e.h / 2 };
    if (side === 'bottom') return { x: -e.w / 2, y: r + g * .7 };
    return { x: -e.w / 2, y: -r - g * .7 - e.h };
  }

  // ---------- transitions ----------
  function buildFlight(type, anchorId, old, target) {
    const tracks = [], groupK = {}, oMap = new Map(old.filter(d => (d.alpha ?? 1) > .01).map(d => [d.id, d])), tMap = new Map(target.map(d => [d.id, d]));
    const add = (id, item, from, to, t0, t1, opt = {}) => tracks.push({ id, item, from: { ring: 0, alpha: 1, ...from }, to: { ring: 0, alpha: 1, ...to }, t0, t1, ...opt });
    const { cx, cy } = geo;
    if (type === 'dive' || type === 'rise') {
      if (type === 'dive') {
        const P = oMap.get(anchorId) || { x: cx, y: cy, r: 40, color: target[0]?.color || [.8, .8, .8] };
        for (const d of oMap.values()) {
          if (d.id === anchorId) add(`out:${d.id}`, d.item, d, { ...d, x: cx, y: cy, r: d.r * ZOOM, alpha: 0, ring: 0 }, 0, .82, { ease: inOut, fade: [.28, .82] });
          else add(`out:${d.id}`, d.item, d, { ...d, x: cx + (d.x - P.x) * ZOOM, y: cy + (d.y - P.y) * ZOOM, r: d.r * ZOOM, alpha: 0 }, 0, .7, { ease: inCubic, fade: [0, .45] });
        }
        for (const b of target) add(b.id, b.item, { ...b, x: cx + (b.x - cx) * .6, y: cy + (b.y - cy) * .6, r: 0, alpha: 0, color: P.color }, b, .36, 1, { grow: true, ease: outCubic });
      } else {
        const A = tMap.get(anchorId) || { x: cx, y: cy, r: 40 };
        for (const d of oMap.values()) add(`out:${d.id}`, d.item, d, { ...d, x: cx + (d.x - cx) * .25, y: cy + (d.y - cy) * .25, r: 0, alpha: 0, ring: 0 }, 0, .45, { ease: inCubic });
        for (const b of target) {
          if (b.id === anchorId) add(b.id, b.item, { ...b, x: cx, y: cy, r: b.r * ZOOM, alpha: 0, ring: 0 }, b, .12, 1, { ease: inOut, fade: [.12, .5] });
          else add(b.id, b.item, { ...b, x: cx + (b.x - A.x) * ZOOM, y: cy + (b.y - A.y) * ZOOM, r: b.r * ZOOM, alpha: 0 }, b, .25, 1, { ease: outCubic, fade: [.25, .7] });
        }
      }
      return { tracks, groupK };
    }
    const consumed = new Set();
    for (const b of target) {
      const from = oMap.get(b.id);
      if (from) { add(b.id, b.item, from, b, .04, .94, { ease: inOut, resize: true }); consumed.add(b.id); continue; }
      // Explicit merge: drops whose record now says merged_into this one flow together.
      const sources = [...oMap.values()].filter(d => !tMap.has(d.id) && getItem(s.state, d.id)?.merged_into === b.id);
      if (sources.length) {
        const key = `m:${b.id}`, kmax = Math.min(...sources.map(d => d.r), b.r) * .95;
        for (const d of sources) { add(d.id, d.item, d, { ...b, ring: 0, alpha: 1 }, 0, .82, { ease: inOut, group: key, hideAfter: .82, tint: [.25, .8] }); consumed.add(d.id); }
        groupK[key] = t => kmax * smooth(0, .22, t) * (1 - smooth(.6, .82, t));
        add(b.id, b.item, { ...b, alpha: 0, ring: 0 }, b, .82, 1, { ease: outCubic, showAt: .82 });
        continue;
      }
      // Replaying backwards across a merge: the merged drop pulls apart again.
      const hostId = prev && getItem(prev.state, b.id)?.merged_into, H = hostId && oMap.get(hostId);
      if (H && !tMap.has(hostId)) {
        const key = `s:${hostId}`, siblings = target.filter(x => getItem(prev.state, x.id)?.merged_into === hostId), kmax = Math.min(...siblings.map(x => x.r), H.r) * .95;
        add(b.id, b.item, { ...H, ring: 0, alpha: 1, color: H.color }, b, .06, .96, { ease: inOut, group: key, tint: [.15, .7] });
        groupK[key] = t => kmax * smooth(.06, .16, t) * (1 - smooth(.3, .8, t));
        consumed.add(hostId);
        continue;
      }
      // New: a drop falls in and settles with a little give.
      add(b.id, b.item, { ...b, y: b.y - Math.max(60, b.r * 1.6), r: 0, alpha: 0, ring: 0 }, b, .38, 1, { grow: true, ease: outCubic });
    }
    for (const d of oMap.values()) {
      if (tMap.has(d.id) || consumed.has(d.id)) continue;
      // Withdrawn: shrinks and fades where it stood.
      add(`out:${d.id}`, d.item, d, { ...d, y: d.y + 16, r: 0, alpha: 0, ring: 0 }, 0, .5, { ease: inCubic });
    }
    routeAround(tracks);
    return { tracks, groupK };
  }
  // Travelling drops bend around the others instead of passing through them:
  // the largest keep straight paths, each next one picks the bend (none, or
  // either side) that overlaps least with paths already chosen.
  function routeAround(tracks) {
    const pathAt = (tr, t, ctrl = tr.ctrl) => {
      const u = clamp((t - tr.t0) / (tr.t1 - tr.t0), 0, 1), e = (tr.ease || inOut)(u), f = tr.from, g = tr.to;
      const x = ctrl ? (1 - e) * (1 - e) * f.x + 2 * (1 - e) * e * ctrl.x + e * e * g.x : lerp(f.x, g.x, e);
      const y = ctrl ? (1 - e) * (1 - e) * f.y + 2 * (1 - e) * e * ctrl.y + e * e * g.y : lerp(f.y, g.y, e);
      const r = tr.grow ? g.r * clamp(u, 0, 1) : lerp(f.r, g.r, e);
      return { x, y, r, alpha: lerp(f.alpha, g.alpha, e) };
    };
    const samples = [.15, .25, .35, .45, .55, .65, .75, .85];
    const fixed = [];
    const ordered = [...tracks].sort((a, b) => Math.max(b.from.r, b.to.r) - Math.max(a.from.r, a.to.r));
    for (const tr of ordered) {
      const dx = tr.to.x - tr.from.x, dy = tr.to.y - tr.from.y, len = Math.hypot(dx, dy);
      const options = [null];
      if (len > 24 && !tr.grow && !tr.id.startsWith('out:')) for (const k of [.35, -.35, .7, -.7, 1.05, -1.05]) options.push({ x: (tr.from.x + tr.to.x) / 2 - dy * k, y: (tr.from.y + tr.to.y) / 2 + dx * k });
      let best = null;
      for (const ctrl of options) {
        let cost = ctrl ? len * .03 * (options.indexOf(ctrl) + 1) : 0;
        for (const t of samples) {
          const a = pathAt(tr, t, ctrl); if (a.alpha < .1) continue;
          for (const other of fixed) {
            if (tr.group && other.group === tr.group) continue;
            const b = pathAt(other, t); if (b.alpha < .1) continue;
            const o = a.r + b.r + 6 - Math.hypot(a.x - b.x, a.y - b.y);
            if (o > 0) cost += o * Math.min(a.r, b.r) * 2;
          }
          // keep inside the stage
          cost += Math.max(0, a.r - a.x, a.x + a.r - geo.w, a.r - a.y, a.y + a.r - geo.h) * 40;
        }
        if (!best || cost < best.cost - 1) best = { ctrl, cost };
      }
      tr.ctrl = best.ctrl; fixed.push(tr);
    }
  }
  function sampleTrack(tr, t) {
    const u = clamp((t - tr.t0) / (tr.t1 - tr.t0), 0, 1), e = (tr.ease || inOut)(u), f = tr.from, g = tr.to;
    let r;
    if (tr.grow) r = g.r * Math.max(0, outBack(u));
    else if (tr.resize && Math.abs(g.r - f.r) > .5) { const base = Math.sqrt(Math.max(0, lerp(f.r * f.r, g.r * g.r, e))); r = base + (g.r - f.r) * .12 * Math.sin(Math.PI * clamp((u - .5) / .5, 0, 1)); }
    else r = lerp(f.r, g.r, e);
    let alpha = tr.fade ? lerp(f.alpha, g.alpha, smooth(tr.fade[0], tr.fade[1], t)) : tr.grow ? lerp(f.alpha, g.alpha, smooth(0, .25, u)) : lerp(f.alpha, g.alpha, e);
    if (tr.showAt != null) alpha = t >= tr.showAt ? 1 : 0;
    if (tr.hideAfter != null && t >= tr.hideAfter) alpha = 0;
    const ct = tr.tint ? smooth(tr.tint[0], tr.tint[1], t) : e;
    const c = tr.ctrl, x = c ? (1 - e) * (1 - e) * f.x + 2 * (1 - e) * e * c.x + e * e * g.x : lerp(f.x, g.x, e), y = c ? (1 - e) * (1 - e) * f.y + 2 * (1 - e) * e * c.y + e * e * g.y : lerp(f.y, g.y, e);
    return { id: tr.id, item: tr.item, group: tr.group, x, y, r: Math.max(0, r), alpha, ring: lerp(f.ring, g.ring, e) * alpha, dashed: g.dashed ?? f.dashed, color: f.color.map((v, i) => lerp(v, g.color[i], ct)) };
  }
  function sampleFlight(t) {
    const dt = 16 / flight.duration;
    return flight.tracks.map(tr => {
      const d = sampleTrack(tr, t), p = sampleTrack(tr, Math.max(0, t - dt));
      // Motion stretches the drop a little along its path (area preserved).
      const vx = (d.x - p.x) / 16, vy = (d.y - p.y) / 16, sp = Math.hypot(vx, vy), k = Math.min(.2, sp * .22);
      if (sp > .02) { d.sx = vx / sp * k; d.sy = vy / sp * k; }
      return d;
    }).filter(d => d.r > .2 && d.alpha > .003);
  }

  // ---------- label motion ----------
  function planLabels(type, target) {
    const swap = type === 'dive' || type === 'rise' || type === 'init' || type === 'resize';
    const tMap = new Map(target.map(d => [d.id, d]));
    for (const [id, e] of labels) {
      const d = tMap.get(id);
      if (!d) { e.leaving = true; e.el.inert = true; e.el.setAttribute('aria-hidden', 'true'); e.plan = { fromOp: e.opacity, mode: 'out', x: e.x, y: e.y }; continue; }
      const off = labelOffset(d, e), to = { x: d.x + off.x, y: d.y + off.y };
      const glide = !swap && !e.fresh && e.x != null && e.prevMode === e.mode && Math.hypot(to.x - e.x, to.y - e.y) < (geo.narrow ? 110 : 170);
      e.plan = { fromOp: swap && type !== 'init' ? 0 : e.opacity, mode: type === 'init' || type === 'resize' ? 'snap' : glide ? 'glide' : 'fade', from: { x: e.x ?? to.x, y: e.y ?? to.y }, to, fromOff: e.off || off, toOff: off };
      if (swap && type !== 'init' && type !== 'resize') { e.opacity = 0; e.plan.fromOp = 0; }
      e.off = off; e.prevMode = e.mode; e.fresh = false;
      applySide(e, d);
    }
  }
  function placeLabels(t, drops) {
    const dMap = new Map(drops.map(d => [d.id, d]));
    for (const [id, e] of labels) {
      const pl = e.plan; if (!pl) continue;
      let x, y, op;
      if (pl.mode === 'out') { x = pl.x; y = pl.y; op = pl.fromOp * (1 - smooth(0, .2, t)); }
      else if (pl.mode === 'snap' || t >= 1) { x = pl.to.x; y = pl.to.y; op = 1; }
      else if (pl.mode === 'glide') {
        const d = dMap.get(id), et = inOut(clamp((t - .04) / .9, 0, 1));
        x = d ? d.x + lerp(pl.fromOff.x, pl.toOff.x, et) : lerp(pl.from.x, pl.to.x, et); y = d ? d.y + lerp(pl.fromOff.y, pl.toOff.y, et) : lerp(pl.from.y, pl.to.y, et);
        op = lerp(pl.fromOp, 1, smooth(.6, 1, t));
      } else {
        // Labels that travel far fade out, then reappear beside the settled drop.
        if (t < .5) { x = pl.from.x; y = pl.from.y; op = pl.fromOp * (1 - smooth(0, .18, t)); }
        else { x = pl.to.x; y = pl.to.y; op = smooth(.74, .98, t); }
      }
      e.x = x; e.y = y; e.opacity = op;
      e.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      e.el.style.opacity = op.toFixed(3);
      // Marks for this round's reply / reminder ride on the drop's rim.
      const d = dMap.get(id);
      if (d && e.pin.textContent) { const a = e.mode === 'outside' && settledSide(id) === 'right' ? -Math.PI * .75 : -Math.PI / 4; e.pin.style.transform = `translate3d(${(d.x + Math.cos(a) * d.r).toFixed(1)}px,${(d.y + Math.sin(a) * d.r).toFixed(1)}px,0) translate(-50%,-50%)`; e.pin.style.opacity = (pl.mode === 'out' ? 0 : Math.min(op, d.alpha)).toFixed(3); }
      else e.pin.style.opacity = '0';
      if (pl.mode === 'out' && t >= 1) { e.el.remove(); e.pin.remove(); labels.delete(id); }
    }
  }

  // ---------- render loop: runs only while something changes ----------
  let lastTick = 0;
  function frame(now) {
    raf = 0; if (disposed) return;
    let busy = false, drops, groupK = {};
    if (flight) {
      const t = flight.frozen ?? clamp((now - flight.start) / flight.duration, 0, 1);
      drops = sampleFlight(t);
      for (const [key, fn] of Object.entries(flight.groupK)) groupK[key] = fn(t);
      placeLabels(t, drops);
      if (t >= 1) { flight = null; drops = settled; placeLabels(1, settled); }
      else busy = flight.frozen == null;
    } else drops = settled;
    // Selection and hover: light rises from inside the drop.
    const dt = Math.min(64, now - (lastTick || now)); lastTick = now;
    for (const d of drops) {
      const id = d.id.replace(/^out:/, ''), want = s.selectedId === id ? 1 : hoverId === id ? .42 : 0;
      let cur = lights.get(id) ?? want;
      if (Math.abs(want - cur) > .004) { cur += (want - cur) * Math.min(1, dt / 70); busy = true; } else cur = want;
      lights.set(id, cur); d.light = cur;
    }
    renderer.render(drops, groupK);
    lastDrops = drops;
    if (busy) raf = requestAnimationFrame(frame); else lastTick = 0;
  }
  const kick = () => { if (!raf && !disposed) raf = requestAnimationFrame(frame); };

  function transition(type, anchorId) {
    notes = annotate(s);
    const old = lastDrops.map(d => ({ ...d, id: d.id.replace(/^out:/, '') })).filter((d, i, list) => list.findIndex(x => x.id === d.id) === i);
    const target = targetDrops(type, old);
    planLabels(type, target);
    settled = target;
    const instant = type === 'init' || type === 'resize' || reduced.matches || document.hidden;
    if (instant) { flight = null; placeLabels(1, settled); cancelAnimationFrame(raf); raf = 0; frame(performance.now()); }
    else { const built = buildFlight(type, anchorId, old, target); flight = { ...built, start: performance.now(), duration: type === 'dive' || type === 'rise' ? 1150 : Object.keys(built.groupK).length ? DURATION * 1.3 : DURATION }; kick(); }
    stage.classList.toggle('is-nested', Boolean(s.layerId));
    const owner = s.layerId && getItem(s.state, s.layerId);
    stage.style.setProperty('--c-tint', owner ? cssRGB(dropColor(s.state, owner, false)) : 'transparent');
    const empty = $('.c-empty'); empty.hidden = target.length > 0;
    empty.textContent = s.layerId ? '这一层还空着，64 份都未分配' : '还没有收到输入，64 份都未分配';
    renderBudget(target);
  }
  function refreshStatic() {
    notes = annotate(s);
    const items = activeItems(s), before = new Map([...labels].map(([id, e]) => [id, `${e.mode}|${e.h}|${e.w}`]));
    prepareLabels(items, settledScale);
    // A label that changed shape needs the layout solved again.
    if (items.some(item => { const e = labels.get(item.id); return before.get(item.id) !== `${e.mode}|${e.h}|${e.w}`; })) { transition('frame'); return; }
    for (const d of settled) { const e = labels.get(d.id); if (e) { const off = labelOffset(d, e); e.off = off; e.plan = { mode: 'snap', to: { x: d.x + off.x, y: d.y + off.y } }; applySide(e, d); } }
    placeLabels(1, settled); renderBudget(settled); kick();
  }
  const geometryKey = x => `${x.layerId || 'root'}|${x.layer.items.map(i => `${i.id}:${i.share}:${i.rank}:${i.status}`).join(',')}`;

  // ---------- budget strip: the exact 64 ----------
  function renderBudget(drops) {
    const used = drops.reduce((n, d) => n + d.item.share, 0), free = BUDGET - used;
    const cells = [];
    for (const d of drops) for (let i = 0; i < d.item.share; i++) cells.push(`<i data-id="${esc(d.id)}" class="${i === 0 ? 'is-first' : ''}${s.selectedId === d.id ? ' is-sel' : ''}${hoverId === d.id ? ' is-hover' : ''}" style="--cell:${cssRGB(d.color)}"></i>`);
    for (let i = 0; i < free; i++) cells.push(`<i class="is-free${i === 0 ? ' is-first' : ''}"></i>`);
    const box = $('.c-budget-cells'); box.innerHTML = cells.join('');
    const owner = s.layerId && getItem(s.state, s.layerId);
    box.setAttribute('aria-label', `${owner ? `「${owner.title}」自己的 64 份` : '本层 64 份'}：${drops.map(d => `${d.item.title} ${d.item.share} 份`).join('，')}${free ? `，未分配 ${free} 份` : ''}`);
    $('.c-budget-text').innerHTML = `<span>${owner ? '这一层独立 64 份' : '本层 64 份'} · 已分配 <b>${used}</b></span><span class="${free ? 'is-free' : ''}">${free ? `未分配 <b>${free}</b> 份，是真实留白` : '64 份已全部分配'}</span>`;
  }

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
    let lastDay = ''; const days = [];
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
    $('.c-path').innerHTML = s.layerId ? `<button type="button" class="c-back" data-c="rise"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg>返回${path.length > 1 ? '上一层' : '全部事项'}<kbd>Esc</kbd></button><span class="c-crumbs"><button type="button" data-c="root">全部 64 份</button>${path.map((p, i) => `<i aria-hidden="true">›</i>${i === path.length - 1 ? `<b>${esc(p.title)} · 独立 64 份</b>` : `<span>${esc(p.title)}</span>`}`).join('')}</span>` : '';
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
      return `<span class="c-sig-kind is-review">零事件整理</span>${esc(signal.reason)}：${formatTime(signal.window.from)} 起收到 0 条；${esc(signal.coverage)}。<b>${checked ? '检查后不改' : `按时间重看，更新 ${changes} 项`}</b>${sameShares() ? '，份额未变，液滴不动。' : '。'}`;
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
    const swatch = `<i class="c-swatch" style="--cell:${cssRGB(dropColor(s.state, item, Boolean(item.parent_id)))}" aria-hidden="true"></i>`;
    const head = asOwner ? `<p class="c-read-kicker">你在它的 64 份里 · 已分配 ${item.children?.used ?? 0}</p>` : `<button type="button" class="c-read-back" data-c="overview">‹ 本轮概览</button>`;
    return `${head}<p class="c-read-meta"><span>${swatch}${esc([category, parent ? `属于「${parent.title}」` : '', kindLabel[item.kind]].filter(Boolean).join(' · '))}</span><span class="c-read-share">${item.share} / 64</span></p>
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
    if (!signal) return `<p class="c-read-kicker">本轮概览</p><h2>${esc(f.title)}</h2><p class="c-read-summary">${esc(f.narrative)}</p><p class="c-note">画面从空开始：没有输入，就没有份额被分配，64 格全是留白。</p>`;
    const allChanges = (s.frameDiff?.changes || []).filter(c => c.type !== 'annotations_changed');
    const layerIds = new Set([...s.layer.items.map(i => i.id), ...getLayerIds(s)]);
    const changes = allChanges.filter(c => layerIds.has(c.item)), nestedChanges = allChanges.length - changes.length;
    const name = id => esc(getItem(s.state, id)?.title || getItem(s.previousState, id)?.title || id);
    const groups = { added: [], withdrawn: [], merged: [], updated: [] };
    for (const c of changes) (groups[c.type] || groups.updated).push(c);
    const mergedInto = new Map();
    for (const c of groups.merged) { const into = getItem(s.state, c.item)?.merged_into; if (into) mergedInto.set(into, [...(mergedInto.get(into) || []), c.item]); }
    const fresh = groups.added.filter(c => !mergedInto.has(c.item));
    const changeRows = [
      fresh.length ? `<li><b>滴入</b>${fresh.map(c => name(c.item)).join('、')}</li>` : '',
      [...mergedInto].map(([into, from]) => `<li><b>融合</b>${from.map(name).join(' + ')} → ${name(into)}</li>`).join(''),
      groups.withdrawn.length ? `<li><b>撤下</b>${groups.withdrawn.map(c => name(c.item)).join('、')}</li>` : '',
      groups.updated.length ? (() => { const moved = groups.updated.filter(c => c.fields.includes('share')); return `<li><b>调整</b>${groups.updated.length} 项${moved.length ? `，其中 ${moved.length} 项份额变化：${moved.slice(0, 4).map(c => `${name(c.item)} ${c.before.share}→${c.after.share}`).join('；')}${moved.length > 4 ? ' 等' : ''}` : '，内容更新，份额未变'}</li>`; })() : '',
      nestedChanges ? `<li><b>子项</b>另有 ${nestedChanges} 处变化，进入对应事项查看</li>` : '',
    ].filter(Boolean).join('');
    const review = signal.type === 'review' ? (() => {
      const checked = s.records[s.index]?.receipt?.type === 'checked' || !changes.length;
      return `<section class="c-review"><h3>零事件整理</h3><dl><div><dt>调用原因</dt><dd>${esc(signal.reason)}</dd></div><div><dt>窗口</dt><dd>${clock(signal.window.from)} — ${clock(signal.window.to)}，收到 0 条</dd></div><div><dt>覆盖</dt><dd>${esc(signal.coverage)}</dd></div><div><dt>结果</dt><dd>${checked ? '检查后不改' : `按时间重看，更新了 ${changes.map(c => `「${name(c.item)}」`).join('、')}`}${sameShares() ? '；份额未变，液滴保持不动' : ''}</dd></div></dl><p class="c-note">没有收到消息不等于现实没有变化；这次整理只说明窗口内没有输入。</p></section>`;
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
  function hitTest(event) {
    const r = canvas.getBoundingClientRect(), x = event.clientX - r.left, y = event.clientY - r.top;
    let best = null;
    for (const d of flight ? lastDrops : settled) {
      if (d.id.startsWith('out:') || (d.alpha ?? 1) < .5) continue;
      if (Math.hypot(x - d.x, y - d.y) <= d.r + 3 && (!best || d.r < best.r)) best = d;
    }
    return best?.id || null;
  }
  host.addEventListener('click', event => {
    const t = event.target.closest('button');
    if (!t) {
      if (event.target === canvas || event.target.closest('.c-stage')) { const id = hitTest(event); if (id) choose(id, true); else model.select(null); return; }
      const cell = event.target.closest('.c-budget-cells i[data-id]'); if (cell) choose(cell.dataset.id, true);
      return;
    }
    if (t.dataset.labInspect) return; // the lab shell opens the inspector
    if (t.classList.contains('c-label')) { choose(t.dataset.id, event.detail > 0); return; }
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
  const hover = id => {
    if (hoverId === id) return; hoverId = id;
    for (const [key, e] of labels) e.el.classList.toggle('is-hover', key === id);
    host.querySelectorAll('.c-budget-cells i[data-id]').forEach(el => el.classList.toggle('is-hover', el.dataset.id === id));
    canvas.style.cursor = id ? 'pointer' : '';
    kick();
  };
  canvas.addEventListener('pointermove', event => { if (event.pointerType === 'mouse') hover(hitTest(event)); });
  host.addEventListener('pointerover', event => { const t = event.target.closest('.c-label, [data-locate], .c-budget-cells i[data-id]'); if (t) hover(t.dataset.locate || t.dataset.id || null); else if (event.target !== canvas) hover(null); });
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
  const onResize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { const w = stage.clientWidth; if (geo && w === geo.w && baseHeight(w) === geo.baseH) return; measure(); for (const e of labels.values()) e.sig = ''; transition('resize'); }); };
  const observer = new ResizeObserver(onResize); observer.observe(stage.parentElement);
  addEventListener('resize', onResize);

  measure();
  const unsubscribe = model.subscribe((next, info) => {
    prev = s; s = next;
    const key = geometryKey(s), changed = key !== layoutKey;
    notes = annotate(s);
    renderTop();
    if (info.type === 'init') { layoutKey = key; transition('init'); }
    else if (changed || info.type === 'dive' || info.type === 'rise') {
      layoutKey = key;
      const layerMoved = (prev?.layerId || null) !== (s.layerId || null);
      const type = info.type === 'dive' || info.type === 'rise' ? info.type : layerMoved ? (s.layerId ? 'dive' : 'rise') : 'frame';
      transition(type, info.anchorId || (type === 'rise' ? prev?.layerId : s.layerId));
    } else refreshStatic();
    renderRead();
  });
  // For review tooling: time one full-canvas draw, GPU included.
  host.__cField = { renderer, measure() { const t0 = performance.now(); renderer.render(lastDrops.length ? lastDrops : settled, {}); renderer.finish(); return performance.now() - t0; }, get drops() { return lastDrops; }, MAX_DROPS, freeze(t) { if (flight) { flight.frozen = t; kick(); } return Boolean(flight); } };
  return () => { disposed = true; cancelAnimationFrame(raf); cancelAnimationFrame(resizeFrame); observer.disconnect(); removeEventListener('resize', onResize); unsubscribe(); renderer.dispose(); };
}
