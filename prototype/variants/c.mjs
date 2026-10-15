import { escapeHTML as esc, formatDate, formatTime, kindLabel, allItems, getItem, getLayer, currentAsk, scenario, colorFor } from './shared.mjs?v=feedback-loop-1';
import { createRenderer, solveLayout, MAX_DROPS } from './c-field.mjs?v=c-temporal-1';
import { stamp, relative, actionHTML, frameActions, itemActions, versionsHTML, sourcesHTML, originHTML, deadlinesOf, latestRecord, createResponder } from './temporal.mjs?v=temporal-1';
import { createResponseStore, normalizeAsk } from '../respond.mjs?v=respond-1';

// C · 流动形态。每件 3 份以上的事是一滴液体，面积随份额变；不足 3 份的沉在底部，串成一串小珠。
// 你把一件事推后，它就沉到水面以下的托盘里，到点那一帧再浮起来。只有登记了问题的液滴带标签。
// 运动是弹簧：位置、半径各有速度，换帧可随时打断而不跳；只有明确的 merged_into 让两滴融成一滴，
// 撤下的液滴沉没。静止时不渲染。64 格预算带给出精确份数。
const BUDGET = 64, SMALL = 3, BEAD_R = 7, BEAD_GAP = 22, SEDIMENT = 112;
const POS = { k: 92, z: .8 }, RAD = { k: 150, z: .56 }, OFF = { k: 130, z: .92 };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const hash = id => [...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
const hexRGB = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const cssRGB = c => `rgb(${c.map(v => Math.round(clamp(v, 0, 1) * 255)).join(' ')})`;
const expectWord = { decide: '决定', input: '提供', act: '去做', snooze: '定个时间' };
const askTag = ask => ask.meanings[0] === 'snooze' ? '可以推后' : `等你${ask.meanings.map(e => expectWord[e] || e).join('、')}`;
// The part of a title before its colon, which in this data names the thing; the cap clamps it to two lines.
const shortTitle = title => String(title || '').split(/[：:]/)[0].trim();

function rootOf(state, item) {
  let node = item; const seen = new Set();
  while (node?.parent_id && !seen.has(node.id)) { seen.add(node.id); node = getItem(state, node.parent_id) || node; if (seen.has(node.id)) break; }
  return node || item;
}
function dropColor(state, item, nested) {
  let [r, g, b] = hexRGB(colorFor(item, state));
  const mean = (r + g + b) / 3; [r, g, b] = [r, g, b].map(v => clamp(mean + (v - mean) * 1.22, 0, 1));
  if (nested) { const step = [-.07, .06, -.02, .1, -.11, .03][hash(item.id) % 6]; [r, g, b] = [r, g, b].map(v => step > 0 ? v + (1 - v) * step * 1.4 : v * (1 + step)); }
  return [r, g, b];
}
// Seen through water: paler and greyer, as if further away.
const depthColor = c => { const mean = (c[0] + c[1] + c[2]) / 3; return c.map(v => clamp((mean + (v - mean) * .62) * .86 + .1, 0, 1)); };
const activeItems = s => [...s.layer.items].sort((a, b) => a.rank - b.rank);
function spring(value, velocity, target, { k, z }, dt) {
  const c = 2 * Math.sqrt(k) * z;
  const v = velocity + (k * (target - value) - c * velocity) * dt;
  return [value + v * dt, v];
}

export function mount(host, model) {
  host.classList.add('variant-c');
  host.innerHTML = `<div class="c-shell">
    <header class="c-top">
      <div class="c-brand"><b>Fold</b><span>流动形态</span></div>
      <div class="c-time" aria-label="回放时刻">
        <div class="c-steps"><button type="button" class="c-icon" data-c="prev" aria-label="上一次整理" title="上一次整理（←）"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg></button><button type="button" class="c-play" data-c="play" aria-label="播放回放" title="播放 / 暂停（空格）"></button><button type="button" class="c-icon" data-c="next" aria-label="下一次整理" title="下一次整理（→）"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg></button></div>
        <div class="c-when"><b class="c-when-date"></b><small class="c-when-count"></small></div>
        <div class="c-track" role="slider" tabindex="0" aria-label="选择整理时刻"><div class="c-track-rail"></div><div class="c-track-ticks"></div><div class="c-track-days" aria-hidden="true"></div><div class="c-track-thumb"></div></div>
      </div>
      <button type="button" class="c-state" data-lab-inspect="state">完整状态 ↗</button>
    </header>
    <main class="c-main">
      <section class="c-field-col" aria-label="当前层的注意力分配">
        <div class="c-lede"><h1 class="c-headline"></h1><p class="c-frame-title"></p><p class="c-signal" aria-live="polite"></p></div>
        <nav class="c-path" aria-label="当前层级"></nav>
        <div class="c-stage">
          <canvas class="c-canvas" aria-hidden="true"></canvas>
          <div class="c-surface" aria-hidden="true"><span class="c-surface-beads"></span><span class="c-surface-tray"></span></div>
          <div class="c-empty" hidden></div>
          <div class="c-overlay" aria-hidden="true"></div>
          <div class="c-hits" role="group" aria-label="本层事项，按优先级排列；回车查看"></div>
          <div class="c-tip" role="tooltip" hidden></div>
        </div>
        <div class="c-budget"><div class="c-budget-cells" role="img"></div><p class="c-budget-text"></p></div>
        <p class="c-legend"><span><i class="c-key-drop"></i>液滴面积 ∝ 份额（3 份以上）</span><span><i class="c-key-bead"></i>小珠：不足 3 份</span><span><i class="c-key-ring"></i>朱红环 = 登记了问题</span><span><i class="c-key-tray"></i>水面以下：你推后的事，到点浮起</span><span><i class="c-key-merge"></i>只有明确合并才融为一滴</span></p>
      </section>
      <aside class="c-read" aria-label="阅读区"><div class="c-read-inner" tabindex="-1" aria-live="polite"></div></aside>
    </main>
  </div>`;
  const $ = selector => host.querySelector(selector);
  const stage = $('.c-stage'), canvas = $('.c-canvas'), overlay = $('.c-overlay'), hits = $('.c-hits'), read = $('.c-read-inner'), track = $('.c-track'), tip = $('.c-tip');
  const renderer = createRenderer(canvas);
  stage.dataset.renderer = renderer.kind;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const store = createResponseStore();
  const responder = createResponder({ store, snapshot: () => s, cls: 'c', onChange: () => { apply('record'); renderTop(); } });
  let s = model.snapshot(), prev = null, disposed = false, hoverId = null, notes = new Map(), geo = null, raf = 0, last = 0, layoutKey = '', arrivals = [];
  const bodies = new Map(), beads = new Map(), kindOf = new Map(), placeCache = new Map(), orderCache = new Map();
  const stats = { frames: 0, total: 0, worst: 0, samples: [], apply: [], types: [], applyWorst: 0, handler: [], parts: [], read: [] };
  let readTimer = 0;

  // ---------- geometry ----------
  function measure() {
    const w = stage.clientWidth || 600, narrow = w < 560;
    const fieldH = narrow ? Math.round(clamp(w * 1.1, 360, 520)) : Math.round(clamp(innerHeight - 440, 320, 560));
    const h = fieldH + SEDIMENT;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    stage.style.height = `${h}px`;
    geo = { w, h, fieldH, narrow, dpr, perShare: (narrow ? .2 : .25) * w * fieldH / BUDGET, labelW: narrow ? 150 : 228 };
    renderer.resize(w, h, dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  }
  const radiusOf = (share, scale = 1) => Math.sqrt(Math.max(0, share) * geo.perShare / Math.PI) * scale;
  const layerKey = x => x.layerId || 'root';
  function stableOrder(layerId) {
    const key = layerId || 'root';
    if (!orderCache.has(key)) { const seen = []; for (const record of s.records) for (const item of getLayer(record.state, layerId).items) if (!seen.includes(item.id)) seen.push(item.id); orderCache.set(key, seen); }
    return orderCache.get(key);
  }
  const deferredUntil = id => { const record = latestRecord(store, id, s.cursor); return record?.meaning === 'snooze' && record.until > s.cursor ? record.until : null; };

  // ---------- notes: what each item is waiting for ----------
  function annotate() {
    notes = new Map(s.layer.items.map(item => {
      const nested = allItems({ root: item.children || { items: [] } }).filter(c => c.status === 'active' && currentAsk(s, c.id)).length;
      return [item.id, { ask: currentAsk(s, item.id), nested, acted: false, due: null }];
    }));
    for (const entry of frameActions(s.index)) if (notes.has(entry.target)) notes.get(entry.target).acted = true;
    for (const due of deadlinesOf(s, s.layer.items)) if (notes.has(due.id)) notes.get(due.id).due = due;
  }

  // ---------- overlay elements per body ----------
  function labelHTML(item, note) {
    const due = note.due ? ` · <b>${due0(note.due)}</b>` : '';
    return `<span class="c-l-title">${esc(item.title)}</span><span class="c-l-ask">${askTag(note.ask)}${due}</span><span class="c-l-prompt">${esc(note.ask.prompt)}</span>`;
  }
  const due0 = due => due.at < s.cursor ? relative(due.at - s.cursor) : `${relative(due.at - s.cursor)}到期`;
  function elementsFor(body) {
    if (body.el) return body.el;
    const hit = document.createElement('button'); hit.type = 'button'; hit.className = 'c-hit'; hit.dataset.cId = body.id;
    const cap = document.createElement('span'); cap.className = 'c-cap';
    const label = document.createElement('div'); label.className = 'c-label'; label.dataset.cId = body.id;
    const tag = document.createElement('span'); tag.className = 'c-tag';
    overlay.append(cap, label, tag); hits.append(hit);
    body.el = { hit, cap, label, tag, sig: '' };
    return body.el;
  }
  function dropElements() {
    for (const body of bodies.values()) {
      const el = elementsFor(body), note = notes.get(body.id), item = body.item;
      const sig = `${item.title}|${item.share}|${note?.ask?.prompt}|${note?.due?.at}|${body.mode}|${body.until}|${s.cursor}`;
      if (el.sig === sig) continue;
      el.sig = sig;
      const askLabel = Boolean(note?.ask);
      const titled = !askLabel && body.mode === 'field' && body.r0 >= 40;
      el.cap.innerHTML = `<b>${item.share}</b>${titled ? `<span style="max-width:${Math.round(body.r0 * 1.5)}px">${esc(shortTitle(item.title))}</span>` : ''}`;
      if (askLabel) { el.label.innerHTML = labelHTML(item, note); el.label.style.maxWidth = `${geo.labelW}px`; }
      el.tag.textContent = body.until ? `◷ ${formatTime(body.until)}` : '';
      el.hit.setAttribute('aria-label', [item.title, `${item.share} 份`, note?.ask ? `${askTag(note.ask)}：${note.ask.prompt}` : kindLabel[item.kind], body.mode === 'tray' ? `已推后，${stamp(body.until)} 浮起` : '', note?.acted ? '本轮你在来源处回应过' : '', item.children?.items.length ? `内含 ${item.children.items.length} 件，回车进入` : '回车查看详情'].filter(Boolean).join('，'));
    }
  }
  // Label boxes, measured in one batch (one layout) and cached by content; cleared on resize.
  const boxCache = new Map();
  function measureLabels(list) {
    const out = new Map(), probes = [];
    for (const item of list) {
      const note = notes.get(item.id), html = labelHTML(item, note), cached = boxCache.get(item.id);
      if (cached?.html === html) { out.set(item.id, cached.box); continue; }
      const probe = document.createElement('div'); probe.className = 'c-label'; probe.style.cssText = `visibility:hidden;max-width:${geo.labelW}px;transform:none`;
      probe.innerHTML = html; probes.push([item.id, html, probe]);
    }
    if (probes.length) {
      overlay.append(...probes.map(p => p[2]));
      for (const [id, html, probe] of probes) { const box = { w: probe.offsetWidth, h: probe.offsetHeight }; boxCache.set(id, { html, box }); out.set(id, box); }
      for (const [, , probe] of probes) probe.remove();
    }
    return out;
  }
  function labelOffset(body, side) {
    const box = body.box, g = geo.narrow ? 10 : 14, r = body.tr + 7;
    if (!box) return { x: 0, y: 0 };
    if (side === 'right') return { x: r + g, y: -box.h / 2 };
    if (side === 'left') return { x: -r - g - box.w, y: -box.h / 2 };
    if (side === 'bottom') return { x: -box.w / 2, y: r + g * .6 };
    return { x: -box.w / 2, y: -r - g * .6 - box.h };
  }

  // ---------- targets: the accepted state, as places to move toward ----------
  function apply(type, anchorId = null) {
    const started = performance.now();
    annotate();
    const items = activeItems(s), key = layerKey(s), order = stableOrder(s.layerId), nested = Boolean(s.layerId);
    const cache = placeCache.get(key) || new Map();
    const kinds = new Map(items.map(item => [item.id, deferredUntil(item.id) ? 'tray' : item.share >= SMALL ? 'drop' : 'bead']));
    const layerMoved = type === 'dive' || type === 'rise';
    const instant = type === 'init' || type === 'resize' || reduced.matches || document.hidden;
    const { w, fieldH } = geo;
    // Tray (right of the sediment) and bead slots (left), in stable order.
    const trayItems = items.filter(item => kinds.get(item.id) === 'tray').sort((a, b) => deferredUntil(a.id) - deferredUntil(b.id));
    const trayW = trayItems.length ? Math.min(w * .42, 70 + trayItems.length * 62) : 0;
    const traySlots = new Map(trayItems.map((item, index) => [item.id, { x: w - 40 - (trayItems.length - 1 - index) * 62, y: fieldH + 58 }]));
    const beadItems = items.filter(item => kinds.get(item.id) === 'bead').sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const usable = Math.max(BEAD_GAP, w - 32 - trayW), perRow = Math.max(1, Math.floor(usable / BEAD_GAP));
    const beadSlots = new Map(beadItems.map((item, index) => [item.id, { x: 16 + BEAD_R + (index % perRow) * BEAD_GAP, y: fieldH + 56 + Math.floor(index / perRow) * 24 }]));
    // Field: drops of 3 shares or more; labels only where a question is registered.
    const dropItems = items.filter(item => kinds.get(item.id) === 'drop');
    let best = null;
    const t1 = performance.now();
    const boxes = measureLabels(dropItems.filter(item => notes.get(item.id)?.ask));
    const t2 = performance.now();
    for (const scale of [1, .88, .76]) {
      const nodes = dropItems.map(item => {
        const note = notes.get(item.id), r = radiusOf(item.share, scale), ringed = Boolean(note?.ask || note?.nested);
        const box = boxes.get(item.id) || null;
        const node = { id: item.id, r: r + (ringed ? 7 : 0), share: item.share, label: box ? { ...box, inside: false } : null, box };
        const c = cache.get(item.id), body = bodies.get(item.id);
        if (c && !layerMoved) { node.prev = { x: c.fx * w, y: Math.min(c.y, fieldH - r) }; node.side = c.side; }
        else if (body && !layerMoved && body.mode !== 'leaving') node.prev = { x: body.x, y: Math.min(body.y, fieldH - r) };
        else if (beads.has(item.id)) node.seed = { x: beads.get(item.id).x, y: fieldH - r - 8 };
        else {
          const sources = [...bodies.values()].filter(b => getItem(s.state, b.id)?.merged_into === item.id);
          if (sources.length) node.seed = { x: sources.reduce((n, b) => n + b.x, 0) / sources.length, y: sources.reduce((n, b) => n + b.y, 0) / sources.length };
        }
        return node;
      });
      // Warm start: when every drop already has a home, a short relaxation is enough.
      const warm = nodes.filter(node => node.prev).length >= nodes.length - 1;
      const solved = solveLayout(nodes, { w, h: fieldH }, { gap: geo.narrow ? 12 : 18, margin: geo.narrow ? 8 : 14, labelGap: geo.narrow ? 10 : 14, centerY: .5, iterations: warm ? 100 : 180 });
      if (!best || solved.overflow < best.solved.overflow * .6) best = { solved, scale, nodes };
      if (solved.overflow < 30) { best = { solved, scale, nodes }; break; }
    }
    const t3 = performance.now(); stats.parts.push({ pre: t1 - started, measure: t2 - t1, solve: t3 - t2 });
    const placed = new Map();
    for (const node of best.nodes) { const p = best.solved.positions.get(node.id); placed.set(node.id, { ...p, box: node.box }); }
    // Homes are remembered across states, so a drop that sank or shrank comes back where it was.
    placeCache.set(key, new Map([...cache, ...[...placed].map(([id, p]) => [id, { fx: p.x / w, y: p.y, side: p.side }])]));
    const anchor = anchorId && bodies.get(anchorId);
    const center = { x: w / 2, y: fieldH * .5 };
    // Bodies leaving the layer on dive / rise.
    if (layerMoved) for (const body of bodies.values()) {
      if (items.some(item => item.id === body.id)) continue;
      body.mode = 'leaving'; body.group = null; body.ta = 0;
      if (type === 'dive' && body.id === anchorId) { body.tx = center.x; body.ty = center.y; body.tr = body.r * 2.6; }
      else if (type === 'dive') { const a = anchor || { x: center.x, y: center.y }; body.tx = body.x + (body.x - a.x) * 1.4; body.ty = body.y + (body.y - a.y) * 1.4; body.tr = body.r * 1.6; }
      else { body.tx = center.x + (body.x - center.x) * .3; body.ty = center.y + (body.y - center.y) * .3; body.tr = 0; }
    }
    // Items now in the layer.
    for (const item of items) {
      const kind = kinds.get(item.id), note = notes.get(item.id);
      let body = bodies.get(item.id);
      const color = dropColor(s.state, item, nested), until = deferredUntil(item.id);
      let target;
      if (kind === 'drop') { const p = placed.get(item.id); target = { x: p.x, y: p.y, r: radiusOf(item.share, best.scale), color, alpha: 1, mode: 'field', side: p.side, box: p.box }; }
      else if (kind === 'tray') { const p = traySlots.get(item.id); target = { x: p.x, y: p.y, r: clamp(radiusOf(Math.max(item.share, 1)) * .4, 9, 18), color: depthColor(color), alpha: .96, mode: 'tray' }; }
      else if (body && body.mode !== 'leaving') { const p = beadSlots.get(item.id); target = { x: p.x, y: p.y, r: BEAD_R, color, alpha: 1, mode: 'toBead' }; }
      if (!target) continue;
      if (!body) {
        const bead = beads.get(item.id);
        const merged = [...bodies.values()].filter(b => getItem(s.state, b.id)?.merged_into === item.id);
        const host = prev && bodies.get(getItem(prev.state, item.id)?.merged_into);
        let start;
        if (layerMoved && type === 'dive') start = { x: anchor?.x ?? center.x, y: anchor?.y ?? center.y, r: 0, alpha: 0 };
        else if (layerMoved && item.id === anchorId) start = { x: center.x, y: center.y, r: target.r * 2.4, alpha: 0 };
        else if (layerMoved) start = { x: target.x, y: target.y, r: 0, alpha: 0 };
        else if (bead && kind !== 'bead') start = { x: bead.x, y: bead.y, r: BEAD_R, alpha: 1, color };
        else if (merged.length) start = { x: merged.reduce((n, b) => n + b.x, 0) / merged.length, y: merged.reduce((n, b) => n + b.y, 0) / merged.length, r: 0, alpha: 1 };
        else if (host) start = { x: host.x, y: host.y, r: Math.min(host.r, target.r) * .7, alpha: 1, split: host.id };
        else start = { x: target.x, y: target.y - Math.max(46, target.r * 1.2), r: 0, alpha: 0 };
        body = { id: item.id, x: start.x, y: start.y, r: start.r, vx: 0, vy: 0, vr: 0, alpha: start.alpha, color: [...(start.color || target.color)], light: 0, ring: 0, ox: 0, oy: 0, vox: 0, voy: 0, labelO: 0, capO: 0, tagO: 0, groupT: 0 };
        bodies.set(item.id, body);
        if (merged.length) { const key2 = `m:${item.id}`; body.group = key2; body.groupT = 1.6; for (const b of merged) { b.group = key2; b.groupT = 1.6; } }
        if (start.split) { const key2 = `s:${start.split}`, other = bodies.get(start.split); body.group = key2; other.group = key2; body.groupT = other.groupT = 1.2; }
      }
      Object.assign(body, { item, tx: target.x, ty: target.y, tr: target.r, ta: target.alpha, tc: target.color, mode: target.mode, side: target.side, box: target.box, until, r0: target.r });
      if (target.mode === 'field' && !(body.group?.startsWith('m:') || body.group?.startsWith('s:'))) body.group = null;
    }
    // Bodies whose item left this state: merged ones flow into their target, the rest sink.
    if (!layerMoved) for (const body of bodies.values()) {
      if (items.some(item => item.id === body.id)) continue;
      const into = getItem(s.state, body.id)?.merged_into, intoBody = into && bodies.get(into);
      if (intoBody && intoBody.mode === 'field') { body.mode = 'merging'; body.group = intoBody.group = `m:${into}`; body.groupT = intoBody.groupT = 1.6; body.tx = intoBody.tx; body.ty = intoBody.ty; body.tr = body.r * .9; body.ta = 1; }
      else if (body.mode !== 'leaving' && body.mode !== 'merging') { body.mode = 'leaving'; body.tx = body.x; body.ty = body.y + 46 + body.r * .4; body.tr = body.r * .28; body.ta = 0; }
    }
    // Beads: DOM spheres. A bead hides while a body travels to its slot.
    const wanted = new Set(beadItems.map(item => item.id));
    for (const [id, bead] of beads) if (!wanted.has(id) || (bodies.has(id) && bodies.get(id).mode !== 'toBead')) {
      const into = !wanted.has(id) && !bodies.has(id) && !layerMoved && !instant ? bodies.get(getItem(s.state, id)?.merged_into) : null;
      if (into?.mode === 'field') {
        // A bead merged into a drop: it leaves the string as a body and flows into the drop.
        const color = dropColor(s.state, getItem(prev?.state || s.state, id) || { id }, nested);
        bodies.set(id, { id, item: getItem(prev?.state || s.state, id), x: bead.x, y: bead.y, r: BEAD_R, vx: 0, vy: 0, vr: 0, alpha: 1, color: [...color], tc: color, light: 0, ring: 0, ox: 0, oy: 0, vox: 0, voy: 0, labelO: 0, capO: 0, tagO: 0,
          mode: 'merging', group: `m:${into.id}`, groupT: 1.6, tx: into.tx, ty: into.ty, tr: BEAD_R * .9, ta: 1, r0: BEAD_R });
        into.group = `m:${into.id}`; into.groupT = 1.6;
        bead.el.remove(); beads.delete(id);
      } else if (!wanted.has(id) && !bodies.has(id)) { bead.el.classList.add('is-leaving'); bead.el.tabIndex = -1; setTimeout(() => bead.el.remove(), reduced.matches ? 0 : 420); beads.delete(id); }
      else if (bodies.has(id)) { bead.el.remove(); beads.delete(id); }
    }
    for (const item of beadItems) {
      const slot = beadSlots.get(item.id), note = notes.get(item.id);
      let bead = beads.get(item.id);
      if (!bead) {
        const el = document.createElement('button'); el.type = 'button'; el.className = 'c-bead'; el.dataset.cId = item.id;
        if (!kindOf.has(item.id) && !instant && type !== 'init') el.classList.add('is-new');
        hits.append(el); bead = { el, x: slot.x, y: slot.y }; beads.set(item.id, bead);
        el.style.translate = `${slot.x}px ${slot.y}px`;
        if (el.classList.contains('is-new')) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-new')));
      }
      bead.x = slot.x; bead.y = slot.y;
      bead.el.style.translate = `${slot.x}px ${slot.y}px`;
      bead.el.style.setProperty('--bead', cssRGB(dropColor(s.state, item, nested)));
      bead.el.classList.toggle('has-ask', Boolean(note?.ask));
      bead.el.classList.toggle('is-waiting', bodies.has(item.id));
      bead.el.classList.toggle('is-selected', s.selectedId === item.id);
      bead.el.setAttribute('aria-label', [item.title, `${item.share} 份`, note?.ask ? `${askTag(note.ask)}：${note.ask.prompt}` : kindLabel[item.kind], '回车查看'].join('，'));
    }
    // Keyboard order follows rank, whatever form an item takes (drop, bead or resting in the tray).
    for (const item of items) { const el = bodies.get(item.id)?.el?.hit || beads.get(item.id)?.el; if (el) hits.append(el); }
    hits.append(tip);
    kindOf.clear(); for (const [id, kind] of kinds) kindOf.set(id, kind);
    dropElements();
    if (instant) settleAll();
    renderSurface(beadItems, trayItems);
    renderBudget(items);
    stage.classList.toggle('is-nested', nested);
    const owner = s.layerId && getItem(s.state, s.layerId);
    stage.style.setProperty('--c-tint', owner ? cssRGB(dropColor(s.state, owner, false)) : 'transparent');
    const empty = $('.c-empty'); empty.hidden = items.length > 0;
    empty.textContent = s.layerId ? '这一层还空着，64 份都未分配' : '还没有收到输入，64 份都未分配';
    const cost = performance.now() - started; stats.apply.push(cost); stats.types.push(type + (instant ? "!" : "")); stats.applyWorst = Math.max(stats.applyWorst, cost);
    kick();
  }
  function settleAll() {
    for (const [id, body] of [...bodies]) {
      if (body.mode === 'leaving' || body.mode === 'merging') { removeBody(id); continue; }
      Object.assign(body, { x: body.tx, y: body.ty, r: body.tr, vx: 0, vy: 0, vr: 0, alpha: body.ta, color: [...body.tc], group: null });
      const off = labelOffset(body, body.side); body.ox = off.x; body.oy = off.y; body.vox = body.voy = 0;
      body.labelO = labelWanted(body); body.capO = capWanted(body); body.tagO = body.mode === 'tray' ? 1 : 0;
      body.ring = ringWanted(body);
      if (body.mode === 'toBead') { removeBody(id); const bead = beads.get(id); bead?.el.classList.remove('is-waiting'); }
    }
  }
  function removeBody(id) {
    const body = bodies.get(id); if (!body) return;
    if (body.el) { body.el.hit.remove(); body.el.cap.remove(); body.el.label.remove(); body.el.tag.remove(); }
    bodies.delete(id);
  }
  const labelWanted = body => body.mode === 'field' && notes.get(body.id)?.ask ? 1 : 0;
  const capWanted = body => body.mode === 'field' ? clamp((body.r - 22) / 12, 0, 1) : 0;
  const ringWanted = body => body.mode === 'field' && (notes.get(body.id)?.ask || notes.get(body.id)?.nested) ? 1 : 0;

  // ---------- physics ----------
  function step(dt) {
    let moving = false;
    const fade = (value, target, rate) => value + (target - value) * (1 - Math.exp(-dt * rate));
    for (const [id, body] of [...bodies]) {
      [body.x, body.vx] = spring(body.x, body.vx, body.tx, POS, dt);
      [body.y, body.vy] = spring(body.y, body.vy, body.ty, POS, dt);
      [body.r, body.vr] = spring(body.r, body.vr, body.tr, RAD, dt);
      if (body.r < 0) { body.r = 0; body.vr = Math.max(0, body.vr); }
      body.alpha = fade(body.alpha, body.ta, body.mode === 'leaving' ? 3.4 : 7);
      body.color = body.color.map((v, i) => fade(v, body.tc[i], 6));
      const off = labelOffset(body, body.side);
      [body.ox, body.vox] = spring(body.ox, body.vox, off.x, OFF, dt);
      [body.oy, body.voy] = spring(body.oy, body.voy, off.y, OFF, dt);
      body.labelO = fade(body.labelO, labelWanted(body) * (body.alpha > .6 ? 1 : 0), 9);
      body.capO = fade(body.capO, capWanted(body) * (body.alpha > .5 ? 1 : 0), 9);
      body.tagO = fade(body.tagO, body.mode === 'tray' && Math.hypot(body.x - body.tx, body.y - body.ty) < 20 ? 1 : 0, 8);
      body.ring = fade(body.ring, ringWanted(body), 8);
      const want = s.selectedId === id ? 1 : hoverId === id ? .42 : 0;
      body.light = fade(body.light, want, 14);
      // A merge or split keeps its smooth union only while it happens; afterwards drops never fuse.
      if (body.group && body.mode === 'field') { body.groupT -= dt; if (body.groupT <= 0) body.group = null; }
      // Merging drops vanish once inside their target; arrivals at a bead slot hand over to the bead.
      if (body.mode === 'merging') {
        // Follow the drop it joins; once inside it (and it has grown), shrink into it.
        const into = bodies.get(body.group?.slice(2));
        if (into) { body.tx = into.x; body.ty = into.y; }
        if (!into || (into.r > into.tr * .7 && Math.hypot(body.x - into.x, body.y - into.y) < Math.max(4, into.r - body.r * .5))) { body.ta = 0; body.tr = 0; }
      }
      const settled = Math.abs(body.x - body.tx) < .15 && Math.abs(body.y - body.ty) < .15 && Math.abs(body.r - body.tr) < .1 && Math.hypot(body.vx, body.vy) < .5 && Math.abs(body.vr) < .5 && Math.abs(body.alpha - body.ta) < .01 && Math.abs(body.ox - off.x) < .2 && Math.abs(body.oy - off.y) < .2;
      if (body.mode === 'toBead' && Math.hypot(body.x - body.tx, body.y - body.ty) < 1.2 && Math.abs(body.r - body.tr) < .6) { removeBody(id); const bead = beads.get(id); bead?.el.classList.remove('is-waiting'); continue; }
      if ((body.mode === 'leaving' || body.mode === 'merging') && body.alpha < .02) { removeBody(id); continue; }
      if (!settled || Math.abs(body.light - want) > .01 || Math.abs(body.labelO - labelWanted(body) * (body.alpha > .6 ? 1 : 0)) > .01) moving = true;
      else { body.x = body.tx; body.y = body.ty; body.r = body.tr; body.vx = body.vy = body.vr = 0; }
    }
    // A group needs at least two members; when a merge is done, the survivor is on its own again.
    const counts = new Map();
    for (const body of bodies.values()) if (body.group) counts.set(body.group, (counts.get(body.group) || 0) + 1);
    for (const body of bodies.values()) if (body.group && counts.get(body.group) < 2) body.group = null;
    return moving;
  }
  function groupBlend(list) {
    const groups = new Map();
    for (const body of list) if (body.group) { if (!groups.has(body.group)) groups.set(body.group, []); groups.get(body.group).push(body); }
    const out = {};
    for (const [key, members] of groups) {
      let k = 0;
      for (let i = 0; i < members.length; i += 1) for (let j = i + 1; j < members.length; j += 1) {
        const a = members[i], b = members[j], d = Math.hypot(a.x - b.x, a.y - b.y), sum = a.r + b.r;
        const near = 1 - clamp((d - sum) / Math.max(1, sum * .55), 0, 1);
        k = Math.max(k, near * Math.min(a.r, b.r) * .92);
      }
      out[key] = k;
    }
    return out;
  }
  function toDrop(body) {
    const speed = Math.hypot(body.vx, body.vy), k = Math.min(.16, speed / 5200);
    return { id: body.id, x: body.x, y: body.y, r: Math.max(0, body.r), alpha: clamp(body.alpha, 0, 1), color: body.color, light: body.light, ring: body.ring * clamp(body.alpha, 0, 1), dashed: !notes.get(body.id)?.ask && Boolean(notes.get(body.id)?.nested), group: body.group, sx: speed > 30 ? body.vx / speed * k : 0, sy: speed > 30 ? body.vy / speed * k : 0 };
  }
  function writeOverlay() {
    for (const body of bodies.values()) {
      const el = body.el; if (!el) continue;
      const a = clamp(body.alpha, 0, 1);
      el.hit.style.transform = `translate3d(${(body.x - 50).toFixed(1)}px,${(body.y - 50).toFixed(1)}px,0) scale(${Math.max(.01, (body.r + 4) / 50).toFixed(3)})`;
      el.hit.style.pointerEvents = a < .5 || body.mode === 'leaving' || body.mode === 'merging' ? 'none' : '';
      el.hit.tabIndex = body.mode === 'field' || body.mode === 'tray' ? 0 : -1;
      el.cap.style.transform = `translate3d(${body.x.toFixed(1)}px,${body.y.toFixed(1)}px,0) translate(-50%,-50%)`;
      el.cap.style.opacity = (body.capO * a).toFixed(3);
      el.label.style.transform = `translate3d(${(body.x + body.ox).toFixed(1)}px,${(body.y + body.oy).toFixed(1)}px,0)`;
      el.label.style.opacity = (body.labelO * a).toFixed(3);
      el.label.classList.toggle('side-left', body.side === 'left');
      el.label.classList.toggle('is-selected', s.selectedId === body.id);
      el.tag.style.transform = `translate3d(${body.x.toFixed(1)}px,${(body.y + body.r + 8).toFixed(1)}px,0) translateX(-50%)`;
      el.tag.style.opacity = body.tagO.toFixed(3);
    }
  }
  function frame(now) {
    raf = 0; if (disposed) return;
    const t0 = performance.now();
    const dt = last ? Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000)) : 1 / 60; last = now;
    const moving = step(dt);
    const list = [...bodies.values()].filter(body => body.alpha > .003 && body.r > .2).sort((a, b) => b.r - a.r).slice(0, MAX_DROPS);
    renderer.render(list.map(toDrop), groupBlend(list));
    writeOverlay();
    const cost = performance.now() - t0;
    stats.frames += 1; stats.total += cost; stats.worst = Math.max(stats.worst, cost); if (stats.samples.length < 4000) stats.samples.push(cost);
    host.dataset.cMotion = moving ? 'running' : 'idle';
    if (moving) raf = requestAnimationFrame(frame); else last = 0;
  }
  const kick = () => { if (!raf && !disposed) raf = requestAnimationFrame(frame); };

  // ---------- sediment captions and the 64 cells ----------
  function renderSurface(beadItems, trayItems) {
    const asks = beadItems.filter(item => notes.get(item.id)?.ask).length;
    $('.c-surface').style.top = `${geo.fieldH}px`;
    $('.c-surface-beads').innerHTML = beadItems.length ? `小珠 <b>${beadItems.length}</b> 件 · 各不足 ${SMALL} 份${asks ? ` · <em>${asks} 件登记了问题</em>` : ''}` : '没有不足 3 份的事';
    $('.c-surface-tray').innerHTML = trayItems.length ? `推后 <b>${trayItems.length}</b> 件 · 到点浮起` : '';
  }
  function renderBudget(items) {
    const used = items.reduce((n, item) => n + item.share, 0), free = BUDGET - used, nested = Boolean(s.layerId);
    const cells = [];
    for (const item of items) for (let i = 0; i < item.share; i += 1) cells.push(`<i data-c-id="${esc(item.id)}" class="${i === 0 ? 'is-first' : ''}${s.selectedId === item.id ? ' is-sel' : ''}${hoverId === item.id ? ' is-hover' : ''}${deferredUntil(item.id) ? ' is-deferred' : ''}" style="--cell:${cssRGB(dropColor(s.state, item, nested))}"></i>`);
    for (let i = 0; i < free; i += 1) cells.push(`<i class="is-free${i === 0 ? ' is-first' : ''}"></i>`);
    const box = $('.c-budget-cells'); box.innerHTML = cells.join('');
    const owner = s.layerId && getItem(s.state, s.layerId);
    box.setAttribute('aria-label', `${owner ? `「${owner.title}」自己的 64 份` : '本层 64 份'}：${items.map(item => `${item.title} ${item.share} 份`).join('，')}${free ? `，未分配 ${free} 份` : ''}`);
    $('.c-budget-text').innerHTML = `<span>${owner ? '这一层独立 64 份' : '本层 64 份'} · 已分配 <b>${used}</b></span><span class="${free ? 'is-free' : ''}">${free ? `未分配 <b>${free}</b> 份，是真实留白` : '64 份已全部分配'}</span>`;
  }

  // ---------- header, lede, track ----------
  function renderTop() {
    const f = s.frame, n = s.frames.length;
    $('.c-when-date').textContent = stamp(s.cursor);
    $('.c-when-count').textContent = `第 ${s.index + 1} / ${n} 次整理`;
    $('.c-play').innerHTML = s.playing ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 5h2.5v10H6.5zm4.5 0h2.5v10H11z" class="is-fill"/></svg><span>暂停</span>' : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4.5 8.5 5.5L7 15.5Z" class="is-fill"/></svg><span>播放</span>';
    $('.c-play').setAttribute('aria-label', s.playing ? '暂停回放' : '播放回放');
    host.querySelector('[data-c="prev"]').disabled = s.index === 0;
    host.querySelector('[data-c="next"]').disabled = s.index === n - 1;
    const pos = i => `${(i / (n - 1)) * 100}%`;
    let lastDay = ''; const days = [];
    $('.c-track-ticks').innerHTML = s.frames.map((frame, i) => {
      const d = formatDate(frame.at), first = d !== lastDay; lastDay = d;
      if (first) days.push(`<span style="left:${pos(i)}">${new Date(frame.at).toLocaleDateString('zh-CN', { timeZone: scenario.timeZone || 'Asia/Shanghai', day: 'numeric' }).replace('日', '')}</span>`);
      return `<i class="${first ? 'is-day' : ''}${frame.signal?.type === 'review' ? ' is-review' : ''}${i <= s.index ? ' is-past' : ''}" style="left:${pos(i)}"></i>`;
    }).join('');
    $('.c-track-days').innerHTML = days.join('');
    $('.c-track-thumb').style.left = pos(s.index);
    track.setAttribute('aria-valuemin', '1'); track.setAttribute('aria-valuemax', String(n)); track.setAttribute('aria-valuenow', String(s.index + 1));
    track.setAttribute('aria-valuetext', `${stamp(f.at)}，${f.title}`);
    const items = s.layer.items, asks = items.filter(item => notes.get(item.id)?.ask), nestedAsks = items.filter(item => !notes.get(item.id)?.ask && notes.get(item.id)?.nested);
    const sunkAsks = asks.filter(item => deferredUntil(item.id)).length, sunk = items.filter(item => deferredUntil(item.id)).length;
    const inBeads = asks.filter(item => item.share < SMALL && !deferredUntil(item.id)).length, inDrops = asks.length - inBeads - sunkAsks;
    const where = [inBeads || sunkAsks ? `${inDrops} 件在液滴里` : '', inBeads ? `${inBeads} 件是底部小珠` : '', sunkAsks ? `${sunkAsks} 件你推后了` : ''].filter(Boolean).join('，');
    $('.c-headline').innerHTML = !items.length ? (s.layerId ? '这一层还空着' : '还空着，没有需要记住的事')
      : asks.length ? `<em>${asks.length} 件</em>等你回应<small>${where ? `，${where}` : ''}${sunk > sunkAsks ? `；另推后了 ${sunk - sunkAsks} 件` : ''}${nestedAsks.length ? `；另 ${nestedAsks.length} 件的子项里有` : ''}</small>`
        : nestedAsks.length ? `没有直接等你的事<small>，${nestedAsks.length} 件的子项里有</small>` : '没有等你回应的事';
    const owner = s.layerId && getItem(s.state, s.layerId);
    $('.c-frame-title').textContent = owner ? `「${owner.title}」自己的 64 份 · ${f.title}` : f.title;
    $('.c-signal').innerHTML = signalHTML();
    const path = s.path || [];
    $('.c-path').hidden = !s.layerId;
    $('.c-path').innerHTML = s.layerId ? `<button type="button" class="c-back" data-c="rise"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg>返回${path.length > 1 ? '上一层' : '全部事项'}<kbd>Esc</kbd></button><span class="c-crumbs"><button type="button" data-c="root">全部 64 份</button>${path.map((p, i) => `<i aria-hidden="true">›</i>${i === path.length - 1 ? `<b>${esc(p.title)} · 独立 64 份</b>` : `<span>${esc(p.title)}</span>`}`).join('')}</span>` : '';
  }
  function signalHTML() {
    const signal = s.frame.signal;
    if (!signal) return '<span class="c-sig-kind">初始状态</span>还没有收到输入，64 份全部空着。';
    if (signal.type === 'review') {
      const changes = (s.frameDiff?.changes || []).length;
      return `<span class="c-sig-kind is-review">零事件整理</span>${esc(signal.reason)}：${formatTime(signal.window.from)} 起收到 0 条；${esc(signal.coverage)}。<b>${changes ? `按时间重看，更新 ${changes} 项` : '检查后不改'}</b>`;
    }
    const acted = frameActions(s.index).length;
    return `<span class="c-sig-kind">本轮输入</span>${s.frame.events.length} 条${signal.coverage ? `（${esc(signal.coverage)}）` : ''}${acted ? ` · 其中 ${acted} 处是你在各处的回应` : ''}${arrivals.length ? ` · <b>◷ ${arrivals.length} 件到点浮起</b>` : ''}`;
  }

  // ---------- reading pane ----------
  function detailHTML(item, asOwner) {
    const parent = item.parent_id && getItem(s.state, item.parent_id);
    const category = scenario.categories?.[rootOf(s.state, item).id]?.label;
    const ask = item.status === 'active' ? currentAsk(s, item.id) : null;
    const record = latestRecord(store, item.id, s.cursor);
    const response = item.status === 'active' ? responder.html(item, ask, { inlineDefer: true, allowDefer: true }) : '';
    const actions = itemActions(item.id, s.index);
    const due = deadlinesOf(s, [item])[0];
    const swatch = `<i class="c-swatch" style="--cell:${cssRGB(dropColor(s.state, item, Boolean(item.parent_id)))}" aria-hidden="true"></i>`;
    const where = item.status !== 'active' ? (item.status === 'merged' ? '已合并' : '已撤下') : deferredUntil(item.id) ? `沉在水面以下，${stamp(deferredUntil(item.id))} 浮起` : item.share < SMALL ? '底部小珠' : '液滴';
    const head = asOwner ? `<p class="c-read-kicker">你在它的 64 份里 · 已分配 ${item.children?.used ?? 0}</p>` : '<button type="button" class="c-read-back" data-c="overview">‹ 本轮概览</button>';
    const children = [...(item.children?.items || [])].sort((a, b) => a.rank - b.rank);
    return `${head}<p class="c-read-meta"><span>${swatch}${esc([category, parent ? `属于「${parent.title}」` : '', kindLabel[item.kind], where].filter(Boolean).join(' · '))}</span><span class="c-read-share">${item.share} / 64</span></p>
      <h2>${esc(item.title)}</h2>
      <p class="c-read-summary">${esc(item.summary)}</p>
      ${item.merged_into ? `<p class="c-note">已合并到 <button type="button" class="c-inline" data-c-select="${esc(item.merged_into)}">${esc(getItem(s.state, item.merged_into)?.title || item.merged_into)}</button></p>` : ''}
      ${response ? `<section class="c-respond${ask || record ? '' : ' is-default'}"><h3>${ask ? `回应 · ${askTag(normalizeAsk(ask))}` : record ? '你的回应' : '推后'}</h3>${response}</section>` : ''}
      ${due && !ask?.due_at ? `<p class="c-note">期限 ${stamp(due.at)} · ${relative(due.at - s.cursor)}</p>` : ''}
      ${item.reason ? `<section><h3>为什么是这个分量</h3><p>${esc(item.reason)}</p></section>` : ''}
      ${item.sources?.length ? `<section><h3>依据 · ${item.sources.length} 条</h3>${originHTML(item, { cls: 'c' })}${sourcesHTML(item, { cls: 'c' })}</section>` : ''}
      ${actions.length ? `<section><h3>你在来源处的回应 · ${actions.length}</h3>${actions.slice(0, 6).map(entry => actionHTML(entry, { cls: 'c' })).join('')}${actions.length > 6 ? `<p class="c-note">更早还有 ${actions.length - 6} 条</p>` : ''}</section>` : ''}
      <section><h3>两周版本</h3>${versionsHTML(item.id, s, { cls: 'c' })}</section>
      ${children.length && !asOwner ? `<section><h3>内含 ${children.length} 件 · 独立 64 份</h3><ul class="c-children">${children.map(c => `<li><span>${currentAsk(s, c.id) ? '<i class="c-dot-ask" aria-label="等你回应"></i>' : ''}${esc(c.title)}</span><small>${c.share} 份</small></li>`).join('')}</ul><button type="button" class="c-cta" data-dive="${esc(item.id)}">进入它的 64 份 →</button></section>` : ''}
      <details class="c-json-box"><summary>此事项的原始 JSON</summary><pre>${esc(JSON.stringify(item, null, 2))}</pre></details>`;
  }
  function overviewHTML() {
    const f = s.frame, signal = f.signal;
    if (!signal) return `<p class="c-read-kicker">本轮概览</p><h2>${esc(f.title)}</h2><p class="c-read-summary">${esc(f.narrative)}</p><p class="c-note">画面从空开始：没有输入，就没有份额被分配，64 格全是留白。</p>`;
    const visible = new Set(s.layer.items.map(item => item.id));
    const name = id => esc(getItem(s.state, id)?.title || getItem(s.previousState, id)?.title || id);
    const changes = (s.frameDiff?.changes || []).filter(c => c.type !== 'annotations_changed' && (visible.has(c.item) || getItem(s.previousState, c.item)?.parent_id === (s.layerId || null) || getItem(s.state, c.item)?.parent_id === (s.layerId || null)));
    const groups = { added: [], withdrawn: [], merged: [], updated: [] };
    for (const c of changes) (groups[c.type] || groups.updated).push(c);
    const mergedInto = new Map();
    for (const c of groups.merged) { const into = getItem(s.state, c.item)?.merged_into; if (into) mergedInto.set(into, [...(mergedInto.get(into) || []), c.item]); }
    const fresh = groups.added.filter(c => !mergedInto.has(c.item));
    const crossing = groups.updated.filter(c => c.fields.includes('share') && (c.before.share < SMALL) !== (c.after.share < SMALL));
    const rows = [
      fresh.length ? `<li><b>滴入</b>${fresh.map(c => name(c.item)).join('、')}</li>` : '',
      [...mergedInto].map(([into, from]) => `<li><b>融合</b>${from.map(name).join(' + ')} → ${name(into)}</li>`).join(''),
      groups.withdrawn.length ? `<li><b>沉没</b>${groups.withdrawn.map(c => name(c.item)).join('、')}（撤下）</li>` : '',
      crossing.length ? `<li><b>升降</b>${crossing.map(c => `${name(c.item)} ${c.before.share}→${c.after.share}${c.after.share < SMALL ? ' 沉成小珠' : ' 浮成液滴'}`).join('；')}</li>` : '',
      groups.updated.length - crossing.length > 0 ? `<li><b>调整</b>另 ${groups.updated.length - crossing.length} 项内容或份额更新</li>` : '',
    ].filter(Boolean).join('');
    const tray = s.layer.items.filter(item => deferredUntil(item.id)).sort((a, b) => deferredUntil(a.id) - deferredUntil(b.id));
    const arrivalHTML = arrivals.length ? `<section class="c-arrivals"><h3>◷ 到点浮起</h3>${arrivals.map(record => `<p><button type="button" class="c-inline" data-c-select="${esc(record.item)}">${esc(getItem(s.state, record.item)?.title || record.title)}</button> · 你在 ${stamp(record.at)} 推到 ${stamp(record.until)}，现在浮回来了。</p>`).join('')}</section>` : '';
    const trayHTML = tray.length ? `<section><h3>水面以下 · 你推后的 ${tray.length} 件</h3><ol class="c-tray-list">${tray.map(item => `<li><button type="button" data-c-select="${esc(item.id)}"><time>${stamp(deferredUntil(item.id))}</time><span>${esc(item.title)}</span></button></li>`).join('')}</ol><p class="c-note">推后不是已阅，也不改份额；到点那一次整理，它会浮回原处。</p></section>` : '';
    const acts = frameActions(s.index).filter(entry => visible.has(entry.target));
    const actsHTML = acts.length ? `<section><h3>本轮你在各处的回应 · ${acts.length}</h3>${acts.slice(0, 5).map(entry => actionHTML(entry, { cls: 'c', withTarget: getItem(s.state, entry.target) })).join('')}${acts.length > 5 ? `<details class="c-more"><summary>另 ${acts.length - 5} 条</summary>${acts.slice(5).map(entry => actionHTML(entry, { cls: 'c', withTarget: getItem(s.state, entry.target) })).join('')}</details>` : ''}</section>` : '';
    const dispositions = {}; for (const event of f.events) dispositions[event.disposition] = (dispositions[event.disposition] || 0) + 1;
    const words = { used: '采用', duplicate: '重复', noise: '噪音', deferred: '暂缓' };
    return `<p class="c-read-kicker">本轮概览 · ${stamp(f.at)}</p><h2>${esc(f.title)}</h2><p class="c-read-summary">${esc(f.narrative)}</p>${arrivalHTML}${rows ? `<section><h3>本轮变化</h3><ul class="c-changes">${rows}</ul></section>` : ''}${trayHTML}${actsHTML}<section><h3>本轮输入 · ${f.events.length} 条</h3><p class="c-note">${Object.entries(dispositions).map(([key, count]) => `${words[key] || key} ${count}`).join(' · ')}</p><button type="button" class="c-json" data-lab-inspect="inputs">原始输入 ↗</button><button type="button" class="c-json" data-lab-inspect="batch">声明与回执 ↗</button></section>`;
  }
  function renderRead(force = false) {
    const item = s.selectedId && (getItem(s.state, s.selectedId) || getItem(s.baseState, s.selectedId));
    const owner = !item && s.layerId && getItem(s.state, s.layerId);
    const sig = `${s.index}|${s.cursor}|${s.layerId}|${s.selectedId}|${store.list().length}`;
    if (!force && read.dataset.sig === sig) return;
    const keep = read.dataset.sig?.split('|').slice(0, 4).join('|') === sig.split('|').slice(0, 4).join('|');
    read.dataset.sig = sig;
    // Replacing the pane must not drop keyboard focus to <body>, or Esc and Tab lose their place.
    const hadFocus = read.contains(document.activeElement);
    read.innerHTML = item ? detailHTML(item, false) : owner ? detailHTML(owner, true) : overviewHTML();
    if (!keep) $('.c-read').scrollTop = 0;
    if (hadFocus && !read.contains(document.activeElement)) (read.querySelector('.c-rs-receipt') || read).focus({ preventScroll: true });
  }

  // ---------- events ----------
  function choose(id, viaPointer) {
    const item = getItem(s.state, id); if (!item) return;
    if (item.children?.items?.length && item.share >= SMALL && !deferredUntil(id)) model.dive(id);
    else model.select(s.selectedId === id ? null : id);
    if (viaPointer && geo.narrow) requestAnimationFrame(() => $('.c-read').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' }));
  }
  function showTip(id, anchorEl) {
    const item = getItem(s.state, id); if (!item || !anchorEl) { tip.hidden = true; return; }
    const note = notes.get(id);
    tip.innerHTML = `<b>${esc(item.title)}</b><span>${item.share} 份 · ${note?.ask ? `<em>${askTag(note.ask)}</em>` : esc(kindLabel[item.kind] || item.kind)}${deferredUntil(id) ? ` · ◷ ${stamp(deferredUntil(id))} 浮起` : ''}</span>${note?.ask ? `<small>${esc(note.ask.prompt)}</small>` : ''}`;
    tip.hidden = false;
    const body = bodies.get(id), bead = beads.get(id);
    const x = body ? body.x : bead?.x ?? 0, y = body ? body.y - body.r : (bead?.y ?? 0) - BEAD_R;
    const width = tip.offsetWidth;
    tip.style.transform = `translate3d(${clamp(x - width / 2, 4, geo.w - width - 4).toFixed(0)}px, ${(y - tip.offsetHeight - 10).toFixed(0)}px, 0)`;
  }
  const hover = (id, el) => {
    if (hoverId === id) return; hoverId = id;
    host.querySelectorAll('.c-budget-cells i[data-c-id]').forEach(cell => cell.classList.toggle('is-hover', cell.dataset.cId === id));
    const labelled = id && bodies.get(id)?.mode === 'field' && notes.get(id)?.ask;
    if (id && !labelled) showTip(id, el); else tip.hidden = true;
    kick();
  };
  host.addEventListener('click', event => {
    const t = event.target.closest('button, .c-label, .c-budget-cells i[data-c-id]');
    if (!t || t.closest('.c-read-inner [data-rs-act], .c-read-inner [data-rs-open], .c-read-inner [data-rs-defer], .c-read-inner [data-rs-undo], .c-read-inner [data-rs-schedule], .c-read-inner [data-rs-send], .c-read-inner [data-rs-pick], .c-read-inner [data-rs-schedule-custom], .c-read-inner [data-rs-amount], .c-read-inner [data-rs-pad]')) return;
    if (t.dataset.labInspect) return;
    if (t.dataset.tFrame != null) { model.goFrame(Number(t.dataset.tFrame)); return; }
    const id = t.dataset.cId || t.dataset.cSelect || t.dataset.tItem;
    if (id) { if (t.dataset.cSelect || t.dataset.tItem) model.select(id); else choose(id, event.detail > 0); return; }
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
  stage.addEventListener('click', event => { if (event.target === stage || event.target === canvas || event.target === hits || event.target === overlay) model.select(null); });
  host.addEventListener('pointerover', event => { const t = event.target.closest('.c-hit, .c-bead, .c-label, [data-locate], .c-budget-cells i[data-c-id]'); hover(t ? t.dataset.cId || t.dataset.locate || null : null, t); });
  stage.addEventListener('pointerleave', () => hover(null));
  host.addEventListener('focusin', event => { const t = event.target.closest('.c-hit, .c-bead'); if (t) hover(t.dataset.cId, t); });
  host.addEventListener('focusout', () => hover(null));
  host.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.altKey) return;
    if (responder.closePanel()) { renderRead(true); event.stopPropagation(); return; }
    if (s.selectedId) { const back = s.selectedId; model.select(null); event.stopPropagation(); requestAnimationFrame(() => host.querySelector(`.c-hits [data-c-id="${CSS.escape(back)}"]`)?.focus({ preventScroll: true })); }
  });
  // The scrubber: drag or click to a 整理时刻; ←/→ are the shell's.
  const frameAt = x => { const r = track.getBoundingClientRect(); return Math.round(clamp((x - r.left) / r.width, 0, 1) * (s.frames.length - 1)); };
  let scrubbing = false;
  track.addEventListener('pointerdown', event => { scrubbing = true; track.setPointerCapture(event.pointerId); const i = frameAt(event.clientX); if (i !== s.index) model.goFrame(i); });
  track.addEventListener('pointermove', event => { if (!scrubbing) return; const i = frameAt(event.clientX); if (i !== s.index) model.goFrame(i); });
  track.addEventListener('pointerup', () => { scrubbing = false; });
  track.addEventListener('keydown', event => {
    const map = { Home: 0, End: s.frames.length - 1, PageUp: s.index - 5, PageDown: s.index + 5, ArrowUp: s.index + 1, ArrowDown: s.index - 1 };
    if (event.key in map) { event.preventDefault(); model.goFrame(map[event.key]); }
  });
  const unbindRespond = responder.bind(read, { getAsk: id => currentAsk(s, id), getItemVersion: id => getItem(s.state, id), render: () => renderRead(true) });

  let resizeFrame = 0;
  const onResize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { const w = stage.clientWidth; if (geo && w === geo.w && Math.abs(innerHeight - (geo.vh || innerHeight)) < 2) return; measure(); geo.vh = innerHeight; boxCache.clear(); for (const body of bodies.values()) if (body.el) body.el.sig = ''; apply('resize'); }); };
  const observer = new ResizeObserver(onResize); observer.observe(stage.parentElement);
  addEventListener('resize', onResize);

  measure(); geo.vh = innerHeight;
  const geometryKey = x => `${x.layerId || 'root'}|${x.layer.items.map(i => `${i.id}:${i.share}:${i.rank}:${i.updated_at}`).join(',')}|${x.cursor}`;
  const unsubscribe = model.subscribe((next, info) => {
    const began = performance.now();
    prev = s; s = next;
    if (info.type === 'frame' && responder.closePanel()) read.dataset.sig = '';
    // Records whose moment arrived between the previous view and this one float back up now.
    if (!prev || next.cursor !== prev.cursor) arrivals = prev && next.cursor > prev.cursor ? store.list(next.cursor).filter(record => record.meaning === 'snooze' && record.until > prev.cursor && record.until <= next.cursor) : [];
    const key = geometryKey(s);
    annotate();
    if (info.type === 'init') { layoutKey = key; apply('init'); }
    else if (key !== layoutKey || info.type === 'dive' || info.type === 'rise') {
      layoutKey = key;
      const layerMoved = (prev?.layerId || null) !== (s.layerId || null);
      const type = info.type === 'dive' || info.type === 'rise' ? info.type : layerMoved ? (s.layerId ? 'dive' : 'rise') : 'frame';
      apply(type, info.anchorId || (type === 'rise' ? prev?.layerId : s.layerId));
    } else { dropElements(); renderBudget(activeItems(s)); for (const [id, bead] of beads) bead.el.classList.toggle('is-selected', s.selectedId === id); kick(); }
    const t4 = performance.now(); renderTop();
    // On a frame change the reading pane is rebuilt in its own task, so the field starts moving first.
    if (info.type === 'frame' && !reduced.matches) { clearTimeout(readTimer); readTimer = setTimeout(() => { const t = performance.now(); renderRead(); stats.read.push(performance.now() - t); }, 0); }
    else { clearTimeout(readTimer); renderRead(); }
    const spent = performance.now() - began; stats.handler.push(spent);
    if (stats.parts.length) Object.assign(stats.parts.at(-1), { applyAll: t4 - began, top: performance.now() - t4 });
  });
  // For review tooling: per-frame cost (physics + shader submit + overlay), GPU-inclusive single draw, bodies.
  host.__cField = { renderer, stats, store, get bodies() { return bodies; }, MAX_DROPS,
    measure() { const t0 = performance.now(); const list = [...bodies.values()].filter(b => b.alpha > .003); renderer.render(list.map(toDrop), groupBlend(list)); renderer.finish(); return performance.now() - t0; },
    hold(ms) { const t = performance.now(); cancelAnimationFrame(raf); raf = 0; let elapsed = 0; while (elapsed < ms) { const dt = Math.min(1 / 60, (ms - elapsed) / 1000); step(dt); elapsed += dt * 1000; } const list = [...bodies.values()].filter(b => b.alpha > .003 && b.r > .2).sort((a, b) => b.r - a.r); renderer.render(list.map(toDrop), groupBlend(list)); writeOverlay(); return performance.now() - t; },
    resume() { last = 0; kick(); } };
  return () => { disposed = true; clearTimeout(readTimer); cancelAnimationFrame(raf); cancelAnimationFrame(resizeFrame); observer.disconnect(); removeEventListener('resize', onResize); unsubscribe(); unbindRespond(); renderer.dispose(); };
}

export default mount;
