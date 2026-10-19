import { escapeHTML as esc, formatDate, formatTime, kindLabel, allItems, getItem, getLayer, currentAsk, scenario, colorFor, records } from './shared.mjs?v=feedback-loop-1';
import { createRenderer, solveLayout, MAX_DROPS, DIM_TO_PAPER } from './c-field.mjs?v=c-motion-1';
import { stamp, relative, actionHTML, frameActions, itemActions, versionsHTML, sourcesHTML, originHTML, deadlinesOf, latestRecord, createResponder, recordWords } from './temporal.mjs?v=temporal-1';
import { createResponseStore, normalizeAsk, responseStatus } from '../respond.mjs?v=respond-1';
import { createIx, placeBeside, placeColumn, edgePoint, IX, peekHTML as ixPeekHTML, detailHTML as ixDetailHTML } from '../forms/motion/ix.mjs';
import { itemFacts, shortOf, dueText } from '../forms/motion/dial-model.mjs';
import { responseSentence } from '../forms/sketches/stage.mjs';

// C · 流动形态。64 份是同一池水：每件 3 份以上的事是水面上的一滴，面积 = 份额；不足 3 份的沉到水面以下成为小珠，
// 你推后的事在下一轮整理读到之后沉进水下的托盘，到点那一轮浮回原处。水面以下的一切按同一深度比例画（面积九分之一）。
// 换轮按四段走（prototype/forms/polish/c-motion.md 3.2）：涌入（一粒一条输入，采用的落进它所属的那一滴，暂缓的沉到水底
// 成泥，其余在半空淡掉）→ 长缩（所有份额同一条缓动、同起同落，任何时刻份额加留白都是 64）→ 沉浮（跨过 3 份的、推后的、
// 到点的过水面）→ 数字落定（份数、标签、朱红环、64 格带与文字一帧硬切）。落定之后零运动。
// 悬停与展开走 forms/motion/ix.mjs；顶层直接打开时讲一遍“沉下去、到点浮起”。
const BUDGET = 64, SMALL = 3, SEDIMENT = 112, DEPTH = 1 / 3, BEAD_GAP = 24;
const PLAY_MS = 5600;
// Beat table, seconds from the cut (c-motion.md 3.2). A compressed round (the tell's second beat) scales it by FAST.
const BEAT = { spawn: 0.4, air: 0.45, sinkAir: 0.35, water: 0.25, inflow: 1.0, review: 0.3, grow: 0.7, cross: 0.8, jump: 0.42, local: 0.6, layer: 0.5, fadeOld: 0.3, labelIn: 0.2 };
const FAST = 0.42;
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const lerp = (a, b, k) => a + (b - a) * k;
const EASE = {
  linear: k => k,
  inOut: k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  out: k => 1 - (1 - k) ** 3,
  in: k => k * k,
};
const hash01 = text => { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return (h >>> 0) / 4294967296; };
const hash = id => [...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
const hexRGB = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const cssRGB = c => `rgb(${c.map(v => Math.round(clamp(v, 0, 1) * 255)).join(' ')})`;
const expectWord = { decide: '决定', input: '提供', act: '去做', snooze: '定个时间' };
const askTag = ask => ask.meanings[0] === 'snooze' ? '可以推后' : `等你${ask.meanings.map(e => expectWord[e] || e).join('、')}`;
// The part of a title before its colon, which in this data names the thing; the cap clamps it to two lines.
const shortTitle = title => String(title || '').split(/[：:]/)[0].trim();
const frames = scenario.frames, LAST = frames.length - 1;

// ---------- the replay, read once per frame and layer ----------
/** Which item of layer `layerId` (null = root) reference `id` belongs to at frame i: along merges, up through parents. */
function inLayer(i, layerId, id) {
  const items = records[i].snapshot.items;
  let item = id && items[id];
  for (let guard = 0; item && guard < 24; guard += 1) {
    if (item.status === 'merged' && item.merged_into && items[item.merged_into]) { item = items[item.merged_into]; continue; }
    if ((item.parent_id || null) === (layerId || null)) return item.id;
    if (!item.parent_id || !items[item.parent_id]) return null;
    item = items[item.parent_id];
  }
  return null;
}
const DISP = new Set(['used', 'deferred', 'noise', 'duplicate']);
const planCache = new Map();
/** One grain per input of frame i: where it goes (the item of the layer it was taken into, as 整理脉冲 counts it). */
function grainPlan(i, layerId) {
  const key = `${i}|${layerId || ''}`;
  if (planCache.has(key)) return planCache.get(key);
  const frame = frames[i];
  const cited = new Map();
  for (const d of frame.batch?.declarations || []) for (const s of d.sources || []) if (s.ref?.startsWith('event:')) cited.set(s.ref.slice(6), d.id);
  const prevAt = i ? Date.parse(frames[i - 1].at) : Date.parse(frame.at) - 1;
  const from = Date.parse(frame.signal?.window?.from || '') || prevAt, to = Date.parse(frame.signal?.window?.to || '') || Date.parse(frame.at);
  const list = frame.events.map((e, k) => {
    const disp = DISP.has(e.disposition) ? e.disposition : 'unjudged';
    return { k, id: e.id, disp, at: Date.parse(e.at), when: clamp((Date.parse(e.at) - from) / Math.max(1, to - from)),
      target: disp === 'used' ? inLayer(i, layerId, cited.get(e.id) || e.relatedIds?.[0]) : null,
      h1: hash01(`${e.id}:x`), h2: hash01(`${e.id}:y`), h3: hash01(`${e.id}:z`) };
  }).sort((a, b) => a.at - b.at);
  const targetOf = [];
  for (const g of list) targetOf[g.k] = g.target;
  const value = { list, targetOf, counts: list.reduce((n, g) => ({ ...n, [g.disp]: (n[g.disp] || 0) + 1 }), {}) };
  planCache.set(key, value);
  return value;
}
// itemFacts (dial-model.mjs) with this page's rule for which item an input went into, so the card's “本轮进了 N 条” is
// the number of grains that fell into that drop.
const into = (round, k) => grainPlan(round, null).targetOf[k] ?? null;
const rootShare = (i, id) => records[i].state.root.items.find(x => x.id === id)?.share ?? null;
/** Rounds in a row (up to frame i) this root item has sat under the surface (share < 3). */
function roundsUnder(i, id) {
  let n = 0;
  for (let k = i; k >= 0; k -= 1) { const v = rootShare(k, id); if (v == null || v >= SMALL) break; n += 1; }
  return n;
}
/** The last time (at or before frame i) this root item rose from under the surface: {at, rounds, from, to}. */
function lastRise(i, id) {
  for (let k = i; k >= 1; k -= 1) {
    const a = rootShare(k - 1, id), b = rootShare(k, id);
    if (a != null && b != null && a < SMALL && b >= SMALL) return { at: k, rounds: roundsUnder(k - 1, id), from: a, to: b };
  }
  return null;
}
// The story's item (c-motion.md 3): of the root items that sank and rose again, the one whose share grew most as it
// rose; as much, the one that sat under longest. Frames come from the rule, not constants.
const hero = (() => {
  const ids = new Set(); records.forEach(r => r.state.root.items.forEach(x => ids.add(x.id)));
  const list = [];
  for (const id of ids) {
    let sank = null;
    for (let i = 1; i < frames.length; i += 1) {
      const a = rootShare(i - 1, id), b = rootShare(i, id);
      if (a != null && b != null && a >= SMALL && b < SMALL) sank = i;
      if (a != null && b != null && a < SMALL && b >= SMALL && sank != null) { list.push({ id, sank, rose: i, rounds: i - sank, low: a, to: b, gain: b - a }); sank = null; }
    }
  }
  list.sort((a, b) => b.gain - a.gain || b.rounds - a.rounds);
  return list[0] || null;
})();

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
const activeItems = snap => [...snap.layer.items].sort((a, b) => a.rank - b.rank);

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
      <button type="button" class="c-tell" data-c="tell" hidden>▶ 讲一遍</button>
      <button type="button" class="c-state" data-lab-inspect="state">完整状态 ↗</button>
    </header>
    <main class="c-main">
      <section class="c-field-col" aria-label="当前层的注意力分配">
        <div class="c-lede"><h1 class="c-headline"></h1><p class="c-frame-title"></p><p class="c-signal" aria-live="polite"></p></div>
        <nav class="c-path" aria-label="当前层级"></nav>
        <div class="c-stage">
          <div class="c-surface" aria-hidden="true"><span class="c-surface-beads"></span><span class="c-surface-tray"></span></div>
          <canvas class="c-grains" aria-hidden="true"></canvas>
          <canvas class="c-canvas" aria-hidden="true"></canvas>
          <div class="c-empty" hidden></div>
          <div class="c-overlay" aria-hidden="true"><div class="c-hero" hidden></div></div>
        </div>
        <div class="c-budget"><div class="c-budget-cells" role="img"></div><p class="c-budget-text"></p></div>
        <p class="c-legend"><span><i class="c-key-drop"></i>液滴面积 ∝ 份额（3 份以上）</span><span><i class="c-key-bead"></i>水面以下：不足 3 份的小珠与你推后的事，按九分之一面积画</span><span><i class="c-key-ring"></i>朱红环 = 登记了问题；墨色环 = 你已回应</span><span><i class="c-key-grain"></i>一粒一条输入：采用的落进液滴，暂缓的沉到水底</span><span><i class="c-key-merge"></i>只有明确合并才融为一滴</span></p>
      </section>
      <aside class="c-read" aria-label="阅读区"><div class="c-read-inner" tabindex="-1" aria-live="polite"></div></aside>
    </main>
  </div>`;
  if (!document.querySelector('link[data-ix-css]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.dataset.ixCss = ''; link.href = './forms/motion/ix.css'; document.head.prepend(link); }
  const $ = selector => host.querySelector(selector);
  const stage = $('.c-stage'), canvas = $('.c-canvas'), grainCanvas = $('.c-grains'), overlay = $('.c-overlay'), read = $('.c-read-inner'), track = $('.c-track'), heroEl = $('.c-hero');
  const gctx = grainCanvas.getContext('2d');
  const renderer = createRenderer(canvas);
  stage.dataset.renderer = renderer.kind;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const store = createResponseStore();
  let storeVersion = 0;
  let s = model.snapshot(), shown = s, disposed = false, geo = null, raf = 0, lastFrameAt = 0;
  let tr = null, pinned = null, held = false, heldAt = 0, paneView = null, X = null;
  let grains = [], sediment = [], oldSediment = null, arrivals = [];
  const bodies = new Map(), placeCache = new Map(), orderCache = new Map(), scales = new Map(), boxCache = new Map();
  const stats = { frames: 0, total: 0, worst: 0, samples: [], begin: [], gaps: [] };
  const responder = createResponder({ store, snapshot: () => s, cls: 'c', onChange: (record, kind) => answered(record, kind) });
  const unstore = store.subscribe(() => { storeVersion += 1; });

  // ---------- geometry ----------
  function measure() {
    const w = stage.clientWidth || 600, narrow = w < 560;
    const fieldH = narrow ? Math.round(clamp(w * 1.1, 360, 520)) : Math.round(clamp(innerHeight - 440, 320, 560));
    const h = fieldH + SEDIMENT;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    stage.style.height = `${h}px`;
    geo = { w, h, fieldH, narrow, dpr, perShare: (narrow ? .2 : .25) * w * fieldH / BUDGET, labelW: narrow ? 150 : 228, vh: innerHeight };
    renderer.resize(w, h, dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    grainCanvas.width = Math.round(w * dpr); grainCanvas.height = Math.round(h * dpr);
    grainCanvas.style.width = `${w}px`; grainCanvas.style.height = `${h}px`;
    scales.clear(); boxCache.clear();
  }
  const fieldR = (share, scale) => Math.sqrt(Math.max(0, share) * geo.perShare / Math.PI) * scale;
  /** Radius of a body of `share` at `depth` (0 above the surface, 1 under it: a third of the radius, a ninth of the area). */
  const radiusOf = (share, depth, scale) => fieldR(share, scale) * (1 - (1 - DEPTH) * depth);
  const layerKey = snap => snap.layerId || 'root';
  function stableOrder(layerId) {
    const key = layerId || 'root';
    if (!orderCache.has(key)) { const seen = []; for (const record of records) for (const item of getLayer(record.state, layerId).items) if (!seen.includes(item.id)) seen.push(item.id); orderCache.set(key, seen); }
    return orderCache.get(key);
  }
  // One scale for the whole layer, set by its most crowded rounds, so the same share is the same size in every round.
  function layerScale(layerId) {
    const key = layerId || 'root';
    if (scales.has(key)) return scales.get(key);
    const load = [];
    frames.forEach((f, i) => {
      const layer = getLayer(records[i].state, layerId), drops = (layer?.items || []).filter(x => x.share >= SMALL);
      if (!drops.length) return;
      const asked = drops.filter(x => currentAsk({ index: i, state: records[i].state }, x.id));
      load.push({ i, drops, asked: new Set(asked.map(x => x.id)), weight: drops.reduce((n, x) => n + x.share, 0) + asked.length * 5 });
    });
    load.sort((a, b) => b.weight - a.weight);
    let scale = 0.7;
    for (const k of [1, .94, .88, .82, .76, .7]) {
      const fits = load.slice(0, 3).every(c => {
        const nodes = c.drops.map(item => ({ id: item.id, r: fieldR(item.share, k) + (c.asked.has(item.id) ? 7 : 0), share: item.share,
          label: c.asked.has(item.id) ? { w: geo.labelW * .82, h: 54, inside: false } : null }));
        return solveLayout(nodes, { w: geo.w, h: geo.fieldH }, { gap: geo.narrow ? 12 : 18, margin: geo.narrow ? 8 : 14, labelGap: geo.narrow ? 10 : 14, centerY: .5, iterations: 140 }).overflow < 40;
      });
      if (fits) { scale = k; break; }
    }
    scales.set(key, scale);
    return scale;
  }

  // ---------- what each item is waiting for, and the page's own responses ----------
  const recordOf = (id, snap = s) => latestRecord(store, id, snap.cursor);
  /** Deferred and read by a later 整理: it rests under the surface until its moment. */
  function sunkUntil(id, snap = s) {
    const r = recordOf(id, snap);
    if (!r || r.meaning !== 'snooze' || !(r.until > snap.cursor)) return null;
    return responseStatus(r, frames, snap.cursor).status === 'acknowledged' ? r.until : null;
  }
  const noteCache = new WeakMap();
  function notesOf(snap) {
    const cached = noteCache.get(snap);
    if (cached?.v === storeVersion) return cached.map;
    const map = new Map(snap.layer.items.map(item => {
      const ask = currentAsk(snap, item.id), record = recordOf(item.id, snap);
      const back = record?.meaning === 'snooze' && record.until <= snap.cursor;
      // A receipt follows the item (any version); it answers the question it was given for (by question id).
      const answered = Boolean(record && ask && record.ask === ask.id && !back);
      const status = record ? responseStatus(record, frames, snap.cursor).status : null;
      const nested = allItems({ root: item.children || { items: [] } }).filter(c => c.status === 'active' && currentAsk(snap, c.id)).length;
      return [item.id, { ask, record, answered, status, back, nested, sunk: sunkUntil(item.id, snap), acted: false, due: null }];
    }));
    for (const entry of frameActions(snap.index)) if (map.has(entry.target)) map.get(entry.target).acted = true;
    for (const due of deadlinesOf(snap, snap.layer.items)) if (map.has(due.id)) map.get(due.id).due = due;
    noteCache.set(snap, { v: storeVersion, map });
    return map;
  }
  const waitingOf = snap => [...notesOf(snap).values()].filter(n => n.ask && !n.answered).length;
  // What the label beside a drop says: the open question, or your receipt (which follows the item across versions).
  function labelKind(note) {
    if (note?.ask && !note.answered) return 'ask';
    if (note?.record && !note.back) return 'receipt';
    return null;
  }

  // ---------- the overlay: share inside a drop, labels, ◷ tags ----------
  const due0 = (due, snap) => due.at < snap.cursor ? relative(due.at - snap.cursor) : `${relative(due.at - snap.cursor)}到期`;
  function labelHTML(item, note, snap) {
    const kind = labelKind(note);
    if (kind === 'receipt') {
      const r = note.record, saved = note.status !== 'acknowledged';
      const tail = r.meaning === 'snooze' ? (note.sunk ? '水面以下，到点浮起' : saved ? '下一轮整理读到才沉' : '') : saved ? '等下一轮整理' : '';
      return `<span class="c-l-title">${esc(item.title)}</span><span class="c-l-receipt${saved ? '' : ' is-ack'}"><i aria-hidden="true">✓</i>${esc(recordWords(r))} · ${saved ? '已保存' : '已收到'}${tail ? ` · ${tail}` : ''}</span>${note.ask && note.ask.id !== r.ask ? `<span class="c-l-prompt">你答过上一版；现在问：${esc(note.ask.prompt)}</span>` : ''}`;
    }
    const due = note.due ? ` · <b>${due0(note.due, snap)}</b>` : '';
    const prior = note.record && note.record.ask && note.record.ask !== note.ask.id ? '<span class="c-l-prior">你答过上一版</span>' : '';
    return `<span class="c-l-title">${esc(item.title)}</span><span class="c-l-ask">${askTag(note.ask)}${due}</span><span class="c-l-prompt">${esc(note.ask.prompt)}</span>${prior}`;
  }
  function elementsFor(body) {
    if (body.el) return body.el;
    const cap = document.createElement('span'); cap.className = 'c-cap';
    const label = document.createElement('div'); label.className = 'c-label'; label.dataset.id = body.id;
    const tag = document.createElement('span'); tag.className = 'c-tag';
    overlay.append(cap, label, tag);
    body.el = { cap, label, tag, sig: '' };
    return body.el;
  }
  // Label boxes, measured in one batch (one layout) and cached by content; cleared on resize.
  function measureLabels(list, snap) {
    const out = new Map(), probes = [], notes = notesOf(snap);
    for (const item of list) {
      const html = labelHTML(item, notes.get(item.id), snap), cached = boxCache.get(item.id);
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
  function labelOffset(r, box, side) {
    const g = geo.narrow ? 10 : 14, rr = r + 7;
    if (!box) return { x: 0, y: 0 };
    if (side === 'right') return { x: rr + g, y: -box.h / 2 };
    if (side === 'left') return { x: -rr - g - box.w, y: -box.h / 2 };
    if (side === 'bottom') return { x: -box.w / 2, y: rr + g * .6 };
    return { x: -box.w / 2, y: -rr - g * .6 - box.h };
  }
  // The overlay shows the numbers of `shown` (they flip at 数字落定); positions follow the bodies every frame.
  function writeLabels() {
    const notes = notesOf(shown), byId = new Map(shown.layer.items.map(item => [item.id, item]));
    for (const body of bodies.values()) {
      const el = elementsFor(body), item = byId.get(body.id) || body.item, note = notes.get(body.id);
      const kind = byId.has(body.id) ? labelKind(note) : null;
      const sig = `${item?.title}|${item?.share}|${kind}|${note?.ask?.prompt}|${note?.due?.at}|${note?.status}|${note?.sunk}|${note?.record?.key}|${body.until}|${shown.cursor}`;
      if (el.sig === sig) continue;
      el.sig = sig;
      body.labelKind = kind;
      const titled = !kind && body.place === 'field' && body.rT >= 40;
      el.cap.innerHTML = `<b>${item?.share ?? ''}</b>${titled ? `<span style="max-width:${Math.round(body.rT * 1.5)}px">${esc(shortTitle(item.title))}</span>` : ''}`;
      if (kind) { el.label.innerHTML = labelHTML(item, note, shown); el.label.style.maxWidth = `${geo.labelW}px`; }
      el.label.classList.toggle('is-receipt', kind === 'receipt');
      el.tag.textContent = body.until ? `◷ ${formatTime(body.until)}` : '';
    }
  }

  // ---------- the scene: where every item of a snapshot rests ----------
  function sceneOf(snap) {
    const items = activeItems(snap), notes = notesOf(snap), order = stableOrder(snap.layerId), nested = Boolean(snap.layerId);
    const scale = layerScale(snap.layerId), key = layerKey(snap), cache = placeCache.get(key) || new Map();
    const { w, fieldH } = geo;
    const placeOf = item => notes.get(item.id)?.sunk ? 'tray' : item.share >= SMALL ? 'field' : 'bead';
    const out = new Map();
    // Under the surface: beads on the left in stable order, deferred things on the right by their moment.
    const trayItems = items.filter(item => placeOf(item) === 'tray').sort((a, b) => notes.get(a.id).sunk - notes.get(b.id).sunk);
    let tx = w - 18;
    for (const item of [...trayItems].reverse()) {
      const r = radiusOf(item.share, 1, scale);
      out.set(item.id, { item, place: 'tray', x: tx - r, y: fieldH + 60, share: item.share, until: notes.get(item.id).sunk });
      tx -= 2 * r + 30;
    }
    const trayW = trayItems.length ? w - tx : 0;
    const beadItems = items.filter(item => placeOf(item) === 'bead').sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const perRow = Math.max(1, Math.floor((w - 40 - trayW) / BEAD_GAP));
    beadItems.forEach((item, index) => out.set(item.id, { item, place: 'bead', x: 24 + (index % perRow) * BEAD_GAP, y: fieldH + 54 + Math.floor(index / perRow) * 26, share: item.share }));
    // Above it: the drops. A drop about to sink keeps its spot (fixed) while it shrinks; the rest are placed around it.
    const dropItems = items.filter(item => placeOf(item) === 'field');
    const labelled = dropItems.filter(item => labelKind(notes.get(item.id)));
    const boxes = measureLabels(labelled, snap);
    const nodes = dropItems.map(item => {
      const note = notes.get(item.id), ringed = Boolean(note?.ask || note?.nested || note?.record);
      const r = fieldR(item.share, scale), box = boxes.get(item.id) || null;
      const node = { id: item.id, r: r + (ringed ? 7 : 0), share: item.share, label: box ? { ...box, inside: false } : null, box };
      const c = cache.get(item.id), body = bodies.get(item.id);
      if (body && body.place === 'field' && body.alive) { node.prev = { x: body.x, y: Math.min(body.y, fieldH - r) }; node.side = body.side; }
      else if (c) { node.prev = { x: c.fx * w, y: Math.min(c.y, fieldH - r) }; node.side = c.side; }
      else if (body) node.seed = { x: body.x, y: fieldH - r - 8 };
      else {
        const sources = [...bodies.values()].filter(b => getItem(snap.state, b.id)?.merged_into === item.id);
        if (sources.length) node.seed = { x: sources.reduce((n, b) => n + b.x, 0) / sources.length, y: sources.reduce((n, b) => n + b.y, 0) / sources.length };
      }
      return node;
    });
    for (const body of bodies.values()) {
      if (!body.alive || body.place !== 'field' || dropItems.some(item => item.id === body.id)) continue;
      const item = items.find(x => x.id === body.id);
      if (item) nodes.push({ id: `fixed:${body.id}`, r: fieldR(item.share, scale), share: item.share, label: null, fixed: true, prev: { x: body.x, y: body.y } });
    }
    const warm = nodes.filter(node => node.prev).length >= nodes.length - 1;
    const solved = solveLayout(nodes, { w, h: fieldH }, { gap: geo.narrow ? 12 : 18, margin: geo.narrow ? 8 : 14, labelGap: geo.narrow ? 10 : 14, centerY: .5, iterations: warm ? 100 : 180 });
    for (const node of nodes) {
      if (node.fixed) continue;
      const p = solved.positions.get(node.id), item = dropItems.find(x => x.id === node.id);
      out.set(node.id, { item, place: 'field', x: p.x, y: p.y, side: p.side, box: node.box, share: item.share });
    }
    // Homes are remembered across states, so a drop that sank or shrank comes back where it was.
    placeCache.set(key, new Map([...cache, ...[...out].filter(([, p]) => p.place === 'field').map(([id, p]) => [id, { fx: p.x / w, y: p.y, side: p.side }])]));
    for (const p of out.values()) {
      const note = notes.get(p.item.id);
      p.color = dropColor(snap.state, p.item, nested);
      if (p.place !== 'field') p.color = p.color.map((v, k) => lerp(v, depthColor(p.color)[k], .45));
      p.depth = p.place === 'field' ? 0 : 1;
      p.r = radiusOf(p.share, p.depth, scale);
      p.ring = ringOf(note);
    }
    return { out, scale, items, beadItems, trayItems, dropItems, snap };
  }
  // Rings: an open question is vermilion (dashed when it is on a child); your receipt is ink, dashed until it is read.
  function ringOf(note) {
    if (note?.ask && !note.answered) return { a: 1, ink: 0, dashed: false };
    if (note?.record && !note.back) return { a: .9, ink: 1, dashed: note.status !== 'acknowledged' };
    if (note?.nested) return { a: 1, ink: 0, dashed: true };
    return { a: 0, ink: 0, dashed: false };
  }

  // ---------- bodies: tweens per property, sampled on the transition clock ----------
  // seg = [from, to, t0, t1, ease]; outside [t0, t1] the value holds.
  const segAt = (seg, t) => {
    if (!seg) return 0;
    const [a, b, t0, t1, ease] = seg;
    if (t <= t0) return a;
    if (t >= t1) return b;
    return lerp(a, b, EASE[ease || 'inOut']((t - t0) / Math.max(1e-6, t1 - t0)));
  };
  const PROPS = ['x', 'y', 'share', 'depth', 'alpha'];
  function sample(body, t) {
    for (const p of PROPS) body[p] = body.seg[p] ? segAt(body.seg[p], t) : body[p];
    if (body.seg.color) { const [a, b, t0, t1] = body.seg.color, k = clamp((t - t0) / Math.max(1e-6, t1 - t0)); body.color = a.map((v, i) => lerp(v, b[i], EASE.inOut(k))); }
    if (body.seg.ring) body.ringA = segAt(body.seg.ring, t);
    body.r = radiusOf(body.share, body.depth, body.scale);
  }
  // Hold every property where it is now: a new transition starts from what is on screen.
  function freeze(body, t) {
    sample(body, t);
    body.seg = {};
  }
  function newBody(id, p, extra = {}) {
    const body = { id, item: p.item, x: p.x, y: p.y, share: 0, depth: p.depth, alpha: 1, color: [...p.color], ringA: 0, ringInk: p.ring.ink, dashed: p.ring.dashed,
      place: p.place, side: p.side || 'right', box: p.box || null, until: p.until || null, scale: p.scale, alive: true, seg: {}, vx: 0, vy: 0, labelO: 0, capO: 0, tagO: 0, group: null, ...extra };
    bodies.set(id, body);
    return body;
  }

  // ---------- one transition ----------
  const now = () => performance.now();
  // A local transition (your answer or undo) runs on its own time even while a card holds the field.
  const clockOf = () => (!tr ? 0 : pinned != null ? pinned : ((held && !tr.free ? heldAt : now()) - tr.start) / 1000);
  /**
   * kind: 'turn' (one round forward: 涌入 → 长缩 → 沉浮 → 数字落定), 'fast' (the same, compressed), 'jump' (back, or
   * across several rounds: grow and cross together in 0.42 s, no grains), 'local' (your answer or undo: only crossings),
   * 'layer' (dive / rise), 'instant'.
   */
  function begin(kind) {
    const t0 = now();
    if (reduced.matches || document.hidden || !geo) kind = 'instant';
    const t = clockOf();
    for (const body of bodies.values()) freeze(body, t);
    if (tr && tr.grains) for (const g of grains) g.cut = Math.min(g.cut ?? Infinity, t - g.t0);
    const prevGrains = tr && !tr.done ? grains : [];
    const scene = sceneOf(s), scale = scene.scale;
    const turn = kind === 'turn' || kind === 'fast';
    const k = kind === 'fast' ? (tell?.fastK || FAST) : 1;
    const plan = turn ? grainPlan(s.index, s.layerId) : null;
    const inflowEnd = turn ? (plan.list.length ? BEAT.inflow : BEAT.review) * k : 0;
    // Which bodies change share, and which cross the surface.
    let changes = false, crosses = false;
    for (const [id, p] of scene.out) {
      const b = bodies.get(id);
      if (!b || !b.alive) { changes = true; if (b) crosses = crosses || (b.place === 'field') !== (p.place === 'field'); continue; }
      if (Math.abs(b.share - p.share) > .01) changes = true;
      if (b.place !== p.place || Math.abs(b.depth - p.depth) > .01) crosses = true;
      if (b.place === p.place && (Math.abs(b.x - p.x) > .5 || Math.abs(b.y - p.y) > .5)) changes = true;
    }
    for (const b of bodies.values()) if (b.alive && !scene.out.has(b.id)) changes = true;
    let g0, g1, c0, c1;
    if (turn) { g0 = inflowEnd; g1 = g0 + (changes ? BEAT.grow * k : 0); c0 = g1; c1 = c0 + (crosses ? BEAT.cross * k : 0); }
    else if (kind === 'jump') { g0 = 0; g1 = BEAT.jump; c0 = 0; c1 = BEAT.jump; }
    else if (kind === 'local') { g0 = 0; g1 = BEAT.local * .6; c0 = 0; c1 = BEAT.local; }
    else if (kind === 'layer') { g0 = 0; g1 = BEAT.layer; c0 = 0; c1 = BEAT.layer; }
    else { g0 = g1 = c0 = c1 = 0; }
    const settle = Math.max(g1, c1, inflowEnd);
    const layerMoved = kind === 'layer';
    const center = { x: geo.w / 2, y: geo.fieldH * .5 };
    // Bodies whose item left this state.
    for (const body of bodies.values()) {
      if (!body.alive || scene.out.has(body.id)) continue;
      body.alive = false;
      const into = !layerMoved && getItem(s.state, body.id)?.merged_into, intoP = into && scene.out.get(into);
      if (layerMoved) {
        const a = s.layerId ? bodies.get(s.layerId) : null;
        const away = a && a.id !== body.id ? { x: body.x + (body.x - a.x) * 1.2, y: body.y + (body.y - a.y) * 1.2 } : { x: center.x + (body.x - center.x) * .3, y: center.y + (body.y - center.y) * .3 };
        body.seg.x = [body.x, away.x, 0, c1, 'inOut']; body.seg.y = [body.y, away.y, 0, c1, 'inOut'];
        body.seg.alpha = [body.alpha, 0, 0, c1 * .8, 'out'];
      } else if (intoP) {
        // An explicit merge: it flows into the drop it joins, and only these two are joined while it happens.
        const key = `m:${into}`; body.group = key; body.mergeInto = into;
        body.seg.x = [body.x, intoP.x, g0, g1, 'inOut']; body.seg.y = [body.y, intoP.y, g0, g1, 'inOut'];
        body.seg.share = [body.share, 0, g0, g1, 'inOut'];
      } else {
        body.seg.share = [body.share, 0, g0, g1, 'inOut'];
        body.seg.y = [body.y, body.y + 18, g0, g1, 'in'];
        body.seg.alpha = [body.alpha, 0, lerp(g0, g1, .55), Math.max(g1, g0 + .01), 'linear'];
      }
      body.dieAt = Math.max(g1, c1, 0.01);
    }
    // Items now in the layer.
    for (const [id, p] of scene.out) {
      p.scale = scale;
      let body = bodies.get(id);
      const from = body && body.alive ? body : null;
      if (body && !body.alive) { body.alive = true; body.dieAt = null; body.group = null; body.mergeInto = null; }
      if (!from) {
        const merged = [...bodies.values()].filter(b => b.mergeInto === id);
        if (layerMoved) {
          const anchor = s.layerId && s.layerId === id ? null : (bodies.get(s.layerId) || null);
          const start = anchor ? { x: anchor.x, y: anchor.y } : { x: p.x, y: p.y };
          body = body || newBody(id, p);
          Object.assign(body, { x: start.x, y: start.y, share: 0, alpha: 0, depth: p.depth });
          body.seg.x = [start.x, p.x, 0, c1, 'inOut']; body.seg.y = [start.y, p.y, 0, c1, 'inOut'];
          body.seg.share = [0, p.share, 0, c1, 'out']; body.seg.alpha = [0, 1, 0, c1 * .6, 'out'];
        } else {
          const start = merged.length ? { x: merged.reduce((n, b) => n + b.x, 0) / merged.length, y: merged.reduce((n, b) => n + b.y, 0) / merged.length } : { x: p.x, y: p.y };
          body = body || newBody(id, p);
          Object.assign(body, { x: start.x, y: start.y, share: 0, alpha: 1, depth: p.depth });
          if (merged.length) { body.group = `m:${id}`; body.seg.x = [start.x, p.x, g0, g1, 'inOut']; body.seg.y = [start.y, p.y, g0, g1, 'inOut']; }
          body.seg.share = [0, p.share, g0, g1, 'inOut'];
        }
      } else {
        // Crossing: changing place, or caught halfway through a crossing by an interruption (it finishes from there).
        const crossing = from.place !== p.place || Math.abs(from.depth - p.depth) > .01;
        body.seg.share = [from.share, p.share, g0, g1, 'inOut'];
        if (!crossing) {
          // Drops move to their new spot with the same easing as the shares; beads and the tray shuffle while things cross.
          const [m0, m1] = p.place === 'field' ? [g0, g1] : [c0, Math.max(c1, c0 + .01)];
          body.seg.x = [from.x, p.x, m0, m1, 'inOut']; body.seg.y = [from.y, p.y, m0, m1, 'inOut'];
        } else {
          // Across the surface in one go: the vertical leads, the horizontal follows, the size changes with the depth.
          const span = Math.max(.01, c1 - c0);
          body.seg.x = [from.x, p.x, c0 + span * .25, c1, 'inOut'];
          body.seg.y = [from.y, p.y, c0, c0 + span * .75, 'inOut'];
          body.seg.depth = [from.depth, p.depth, c0 + span * .1, c0 + span * .7, 'inOut'];
        }
      }
      body.seg.color = [[...body.color], p.color, c0, Math.max(c1, g1, .01)];
      body.seg.ring = [body.ringA, p.ring.a, settle, settle + BEAT.labelIn, 'linear'];
      // A receipt read by this 整理 fills in at the cut (dashed → solid ink); everything else flips with the numbers.
      if (turn && body.ringInk && body.dashed && p.ring.ink && !p.ring.dashed) body.dashed = false;
      // The ring's ink and dash flip on the beat, with the numbers.
      body.nextRing = p.ring;
      body.place = p.place; body.item = p.item; body.until = p.until || null; body.scale = scale; body.rT = p.r;
      // Where its label sits changes with the label's content, on the beat.
      body.nextSide = p.side || body.side; body.nextBox = p.box || null;
      if (!from) { body.side = body.nextSide; body.box = body.nextBox; }
      // Its label waits out the round if the drop moves or the label will change; it comes back on the beat.
      body.labelHold = Boolean(from) && (Math.hypot(from.x - p.x, from.y - p.y) > 2 || Math.abs(from.share - p.share) > .01 || from.side !== body.nextSide || from.box?.w !== body.nextBox?.w || from.box?.h !== body.nextBox?.h);
      body.holdFrom = g0;
    }
    // A drop that others flow into is drawn with them as one surface while they meet.
    for (const body of bodies.values()) if (body.mergeInto && bodies.get(body.mergeInto)) bodies.get(body.mergeInto).group = `m:${body.mergeInto}`;
    // Grains: one per input of this round, from above the surface (c-motion.md 3.2 涌入).
    oldSediment = sediment.length ? { list: sediment, from: now() } : oldSediment;
    sediment = [];
    for (const g of prevGrains) g.fadeFrom = now();
    grains = turn ? planGrains(plan, scene, k) : [];
    // Off the beat (back, a jump, a layer, the first view): this round's deferred inputs simply lie on the floor.
    if (!turn && kind !== 'local') sediment = floorOf(grainPlan(s.index, s.layerId));
    else if (kind === 'local') { sediment = oldSediment?.list || []; oldSediment = null; }
    tr = { kind, free: kind === 'local', start: t0, settle, end: Math.max(settle, inflowEnd) + (turn ? BEAT.labelIn : 0), done: false, settled: false, grains: turn, k,
      n: plan ? plan.list.length : 0, prevGrains, scene };
    held = held && Boolean(ix?.s?.hover || (ix?.s?.open && !ix?.s?.presented));
    if (held) heldAt = t0;
    if (stats.begin.length < 600) stats.begin.push(now() - t0);
    if (kind === 'instant') { finish(); kick(); return; }
    kick();
  }
  const floorOf = plan => plan.list.filter(g => g.disp === 'deferred').map(g => ({ x: 10 + g.h1 * (geo.w - 20), y: geo.h - 7 - g.h2 * 20 }));
  function planGrains(plan, scene, k) {
    const { w, h, fieldH } = geo;
    return plan.list.map(g => {
      const t0 = BEAT.spawn * k * g.when;
      const p = g.target && scene.out.get(g.target);
      const body = p && bodies.get(g.target);
      if (p && body) {
        // Into the drop (or bead) it was taken into: where that body is during the inflow.
        const r = Math.max(4, body.r || p.r), under = body.depth > .5 || body.y > fieldH;
        const x1 = body.x + (g.h1 - .5) * r * .6, y1 = body.y + (g.h2 - .5) * r * .4;
        return { kind: 'used', t0, dur: (under ? BEAT.sinkAir + BEAT.water : BEAT.air) * k, x0: body.x + (g.h1 - .5) * Math.min(80, r * 1.4), y0: -6 - g.h3 * 24, x1, y1, under, stopR: under ? 0 : r * .55, tx: body.x, ty: body.y };
      }
      const x = 10 + g.h1 * (w - 20);
      if (g.disp === 'deferred') return { kind: 'deferred', t0, dur: (BEAT.sinkAir + BEAT.water) * k, x0: x, y0: -6 - g.h3 * 24, x1: x, y1: h - 7 - g.h2 * 20, under: true };
      return { kind: 'gone', t0, dur: BEAT.air * k, x0: x, y0: -6 - g.h3 * 24, x1: x + (g.h2 - .5) * 30, y1: fieldH * (.22 + .42 * g.h2) };
    });
  }
  // A grain's position at time e (seconds since it was let go), and whether it is still drawn.
  function grainAt(g, e) {
    const u = clamp(e / g.dur);
    if (!g.under) {
      const k = EASE.in(u);
      return { x: lerp(g.x0, g.x1, u), y: lerp(g.y0, g.y1, k), a: g.kind === 'gone' ? 1 - clamp((u - .45) / .55) : 1, done: u >= 1 };
    }
    // Through the air, then slower in the water, down to its target or the floor.
    const surface = geo.fieldH, split = (g.kind === 'used' ? BEAT.sinkAir / (BEAT.sinkAir + BEAT.water) : BEAT.sinkAir / (BEAT.sinkAir + BEAT.water));
    if (u < split) { const k = EASE.in(u / split); return { x: lerp(g.x0, g.x1, u), y: lerp(g.y0, surface, k), a: 1, done: false }; }
    const k = EASE.out((u - split) / (1 - split));
    return { x: lerp(g.x0, g.x1, u), y: lerp(surface, g.y1, k), a: 1, done: u >= 1 };
  }
  // The round is over: the dead are removed, everything rests on its final value.
  function finish() {
    if (!tr) return;
    const t = Infinity;
    for (const [id, body] of [...bodies]) {
      if (!body.alive) { removeBody(id); continue; }
      sample(body, t); body.seg = {}; body.group = null;
      if (body.nextRing) { body.ringInk = body.nextRing.ink; body.dashed = body.nextRing.dashed; body.ringA = body.nextRing.a; }
      body.vx = body.vy = 0;
    }
    for (const g of grains) if (g.kind === 'deferred') sediment.push({ x: g.x1, y: g.y1 });
    grains = []; oldSediment = null;
    if (!tr.settled) settleInfo();
    tr.done = true;
  }
  function removeBody(id) {
    const body = bodies.get(id); if (!body) return;
    if (body.el) { body.el.cap.remove(); body.el.label.remove(); body.el.tag.remove(); }
    bodies.delete(id);
  }

  // ---------- the information layer flips on the beat ----------
  function settleInfo() {
    if (tr) tr.settled = true;
    shown = s;
    for (const body of bodies.values()) {
      if (!body.alive) continue;
      body.labelHold = false;
      if (body.nextRing) { body.ringInk = body.nextRing.ink; body.dashed = body.nextRing.dashed; }
      if (body.nextSide) { body.side = body.nextSide; body.box = body.nextBox; }
      body.shownPlace = body.place;
    }
    writeLabels();
    renderHeadline(); renderSignal(); renderSurface(); renderBudget(); renderPath();
    renderRead();
    syncKeys(true);
  }

  // ---------- drawing ----------
  function outward(body) {
    if (body.place !== 'field') return { x: 0, y: -1 };
    const dx = body.x - geo.w / 2, dy = body.y - geo.fieldH * .5, d = Math.hypot(dx, dy);
    return d < 6 ? { x: 0, y: -1 } : { x: dx / d, y: dy / d };
  }
  // Where a body is drawn this frame, the open one pushed IX.pop along its own line.
  function viewOf(body) {
    const pop = X && X.popId === body.id ? X.pop * IX.pop : 0, u = outward(body);
    return { x: body.x + u.x * pop, y: body.y + u.y * pop, r: body.r, u, place: body.place };
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
    const v = viewOf(body), speed = Math.hypot(body.vx, body.vy), k = Math.min(.16, speed / 5200);
    const focus = X?.focus, dim = focus && focus !== body.id ? X.dim : 0;
    return { id: body.id, x: v.x, y: v.y, r: Math.max(0, body.r), alpha: clamp(body.alpha, 0, 1), color: body.color, light: focus === body.id ? .45 * X.dim : 0,
      ring: body.ringA * clamp(body.alpha, 0, 1), ringInk: body.ringInk, dashed: body.dashed, dim, group: body.group,
      sx: speed > 30 ? body.vx / speed * k : 0, sy: speed > 30 ? body.vy / speed * k : 0 };
  }
  function drawGrains(t) {
    const { w, h, dpr } = geo;
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0); gctx.clearRect(0, 0, w, h);
    // The concept layer drops to 40 % while you look at one thing.
    const dimK = 1 - .6 * (X?.dim || 0);
    gctx.fillStyle = 'rgb(48 62 66)';
    const dot = (x, y, r, a) => { if (a <= .01) return; gctx.globalAlpha = a; gctx.beginPath(); gctx.arc(x, y, r, 0, Math.PI * 2); gctx.fill(); };
    if (oldSediment) {
      const fade = 1 - clamp((now() - oldSediment.from) / 1000 / BEAT.fadeOld);
      if (fade <= 0) oldSediment = null; else for (const p of oldSediment.list) dot(p.x, p.y, 1.3, .26 * fade * dimK);
    }
    for (const p of sediment) dot(p.x, p.y, 1.3, .26 * dimK);
    let landed = 0;
    for (const g of grains) {
      const e = t - g.t0;
      if (e < 0) continue;
      const q = grainAt(g, g.cut != null ? Math.min(e, g.cut) : e);
      if (q.done) landed += 1;
      if (g.kind === 'used' && !g.under && Math.hypot(q.x - g.tx, q.y - g.ty) < g.stopR) { if (!q.done) landed += 0; continue; }
      if (q.done && g.kind !== 'deferred') continue;
      dot(q.x, q.y, g.kind === 'deferred' && q.done ? 1.3 : 1.5, (g.kind === 'deferred' && q.done ? .26 : .42) * q.a * dimK);
    }
    for (const g of tr?.prevGrains || []) {
      if (!g.fadeFrom) continue;
      const fade = 1 - clamp((now() - g.fadeFrom) / 200);
      if (fade <= 0) continue;
      const q = grainAt(g, g.cut ?? 0);
      dot(q.x, q.y, 1.5, .42 * fade * q.a * dimK);
    }
    gctx.globalAlpha = 1;
    return landed;
  }
  function writeOverlay(t, dt = 1 / 60) {
    const fade = (v, target, rate) => { const n = v + (target - v) * (1 - Math.exp(-dt * rate)); return Math.abs(n - target) < .004 ? target : n; };
    const ready = !tr || tr.settled;
    for (const body of bodies.values()) {
      const el = elementsFor(body), v = viewOf(body), a = clamp(body.alpha, 0, 1);
      const dim = X?.focus && X.focus !== body.id ? 1 - DIM_TO_PAPER * X.dim : 1;
      const up = (body.shownPlace || body.place) === 'field' && body.alive && body.depth < .05;
      const capT = up ? clamp((body.r - 22) / 12) : 0;
      const held0 = tr && !tr.settled && body.labelHold && t >= body.holdFrom;
      const labelT = up && body.labelKind && a > .6 && !held0 ? 1 : 0;
      const tagT = body.place === 'tray' && body.alive && body.depth > .95 && ready ? 1 : 0;
      body.capO = reduced.matches ? capT : fade(body.capO, capT, 12);
      body.labelO = reduced.matches ? labelT : fade(body.labelO, labelT, 14);
      body.tagO = reduced.matches ? tagT : fade(body.tagO, tagT, 12);
      body.fading = body.capO !== capT || body.labelO !== labelT || body.tagO !== tagT;
      const off = labelOffset(body.r, body.box, body.side);
      el.cap.style.transform = `translate3d(${v.x.toFixed(1)}px,${v.y.toFixed(1)}px,0) translate(-50%,-50%)`;
      el.cap.style.opacity = (body.capO * a * dim).toFixed(3);
      el.label.style.transform = `translate3d(${(v.x + off.x).toFixed(1)}px,${(v.y + off.y).toFixed(1)}px,0)`;
      el.label.style.opacity = (body.labelO * a * dim).toFixed(3);
      el.label.style.visibility = body.labelO > .01 ? '' : 'hidden';
      el.label.classList.toggle('side-left', body.side === 'left');
      el.tag.style.transform = `translate3d(${v.x.toFixed(1)}px,${(v.y + body.r + 8).toFixed(1)}px,0) translateX(-50%)`;
      el.tag.style.opacity = (body.tagO * dim).toFixed(3);
    }
    paintHero();
  }
  function frame(stamp) {
    if (disposed) return;
    const t0 = now();
    if (lastFrameAt && stats.gaps.length < 6000) stats.gaps.push(stamp - lastFrameAt);
    const lastDt = lastFrameAt ? clamp((stamp - lastFrameAt) / 1000, 0, .1) : 1 / 60;
    lastFrameAt = stamp;
    if (!interactive() && (ix.s.hover || ix.s.open || ix.s.peek)) ix.reset();
    X = ix.frame();
    const t = clockOf();
    for (const body of bodies.values()) {
      const px = body.x, py = body.y;
      sample(body, t);
      body.vx = held || pinned != null ? 0 : (body.x - px) * 60; body.vy = held || pinned != null ? 0 : (body.y - py) * 60;
    }
    if (tr && !tr.settled && t >= tr.settle) settleInfo();
    // The grains count up the round's inputs as they land (the one number that moves inside the inflow).
    if (tr && !tr.done) {
      const landed = tr.grains ? drawGrains(t) : (drawGrains(t), tr.n);
      if (tr.grains && !tr.settled) setCount(Math.min(tr.n, landed));
    } else drawGrains(Infinity);
    const list = [...bodies.values()].filter(body => body.alpha > .003 && body.r > .2).sort((a, b) => b.r - a.r).slice(0, MAX_DROPS);
    renderer.render(list.map(toDrop), groupBlend(list));
    writeOverlay(t, lastDt);
    // The pane and the narration cut to “这一件” at the open's cut, and back one frame after it folds.
    const view = X.detail ? ix.s.open : null;
    if (view !== paneView) { paneView = view; renderFrameTitle(); renderRead(true); }
    ix.paint();
    syncKeys();
    tellTick();
    if (tr && !tr.done && pinned == null && !held && t >= tr.end) finish();
    const cost = now() - t0;
    stats.frames += 1; stats.total += cost; stats.worst = Math.max(stats.worst, cost); if (stats.samples.length < 6000) stats.samples.push(cost);
    const moving = (tr && !tr.done) || ix.live() || oldSediment || tell || [...bodies.values()].some(b => b.fading);
    host.dataset.cMotion = moving ? 'running' : 'idle';
    dirty = Boolean(moving);
    if (!moving) lastFrameAt = 0;
  }
  // One rAF loop that does nothing at rest: it draws while a round, a card, a fade or the tell moves, and one frame after.
  let dirty = true, ixTail = false;
  function loop(stamp) {
    raf = requestAnimationFrame(loop);
    const live = ix.live();
    if (!dirty && !live && !ixTail) return;
    ixTail = live;
    frame(stamp);
  }
  const kick = () => { dirty = true; };

  // ---------- header, lede, sediment captions and the 64 cells ----------
  function renderTime() {
    const f = s.frame, n = s.frames.length;
    $('.c-when-date').textContent = stamp(s.cursor);
    $('.c-when-count').textContent = `第 ${s.index + 1} / ${n} 次整理`;
    renderPlay();
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
    renderFrameTitle();
  }
  function renderPlay() {
    const on = player.on;
    $('.c-play').innerHTML = on ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 5h2.5v10H6.5zm4.5 0h2.5v10H11z" class="is-fill"/></svg><span>暂停</span>' : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4.5 8.5 5.5L7 15.5Z" class="is-fill"/></svg><span>播放</span>';
    $('.c-play').setAttribute('aria-label', on ? '暂停回放' : '播放回放');
  }
  function renderFrameTitle() {
    const owner = s.layerId && getItem(s.state, s.layerId), view = paneView && getItem(s.state, paneView);
    $('.c-frame-title').textContent = view ? `这一件 · ${stamp(s.cursor)} · ${view.title}` : owner ? `「${owner.title}」自己的 64 份 · ${s.frame.title}` : s.frame.title;
  }
  function renderHeadline(snap = shown) {
    const items = snap.layer.items, notes = notesOf(snap);
    const waiting = items.filter(item => notes.get(item.id)?.ask && !notes.get(item.id).answered);
    const nestedAsks = items.filter(item => !notes.get(item.id)?.ask && notes.get(item.id)?.nested);
    const inBeads = waiting.filter(item => item.share < SMALL && !notes.get(item.id).sunk).length;
    const inTray = waiting.filter(item => notes.get(item.id).sunk).length;
    const inDrops = waiting.length - inBeads - inTray;
    const sunk = items.filter(item => notes.get(item.id)?.sunk).length;
    const fresh = items.filter(item => notes.get(item.id)?.answered && notes.get(item.id).status !== 'acknowledged').length;
    const where = [inBeads || inTray ? `${inDrops} 件在液滴里` : '', inBeads ? `${inBeads} 件是水底的小珠` : '', inTray ? `${inTray} 件在托盘里` : ''].filter(Boolean).join('，');
    const extra = [sunk ? `你推后的 ${sunk} 件沉在水面以下` : '', fresh ? `你刚回应了 ${fresh} 件，等下一轮整理` : '', nestedAsks.length ? `另 ${nestedAsks.length} 件的子项里有` : ''].filter(Boolean).join('；');
    $('.c-headline').innerHTML = !items.length ? (snap.layerId ? '这一层还空着' : '还空着，没有需要记住的事')
      : waiting.length ? `<em>${waiting.length} 件</em>等你回应<small>${where ? `，${where}` : ''}${extra ? `；${extra}` : ''}</small>`
        : `没有等你回应的事<small>${extra ? `，${extra}` : ''}</small>`;
  }
  function renderPath() {
    const path = s.path || [];
    $('.c-path').hidden = !s.layerId;
    $('.c-path').innerHTML = s.layerId ? `<button type="button" class="c-back" data-c="rise"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg>返回${path.length > 1 ? '上一层' : '全部事项'}<kbd>Esc</kbd></button><span class="c-crumbs"><button type="button" data-c="root">全部 64 份</button>${path.map((p, i) => `<i aria-hidden="true">›</i>${i === path.length - 1 ? `<b>${esc(p.title)} · 独立 64 份</b>` : `<span>${esc(p.title)}</span>`}`).join('')}</span>` : '';
    stage.classList.toggle('is-nested', Boolean(s.layerId));
    const owner = s.layerId && getItem(s.state, s.layerId);
    stage.style.setProperty('--c-tint', owner ? cssRGB(dropColor(s.state, owner, false)) : 'transparent');
    const empty = $('.c-empty'); empty.hidden = s.layer.items.length > 0;
    empty.textContent = s.layerId ? '这一层还空着，64 份都未分配' : '还没有收到输入，64 份都未分配';
  }
  function signalHTML(count) {
    const signal = s.frame.signal;
    if (!signal) return '<span class="c-sig-kind">初始状态</span>还没有收到输入，64 份全部空着。';
    if (signal.type === 'review') {
      const changes = (s.frameDiff?.changes || []).length;
      return `<span class="c-sig-kind is-review">零事件整理</span>${esc(signal.reason)}：${formatTime(signal.window.from)} 起收到 0 条；${esc(signal.coverage)}。<b>${changes ? `按时间重看，更新 ${changes} 项` : '检查后不改'}</b>`;
    }
    const acted = frameActions(s.index).length, plan = grainPlan(s.index, s.layerId);
    const settled = count == null;
    return `<span class="c-sig-kind">本轮输入</span><span class="c-sig-n">${settled ? s.frame.events.length : count}</span> 条${signal.coverage ? `（${esc(signal.coverage)}）` : ''}${settled && plan.counts.deferred ? ` · 暂缓 ${plan.counts.deferred} 条沉到水底` : ''}${settled && acted ? ` · 其中 ${acted} 处是你在各处的回应` : ''}${settled && arrivals.length ? ` · <b>◷ ${arrivals.length} 件到点浮起</b>` : ''}`;
  }
  function renderSignal() { $('.c-signal').innerHTML = signalHTML(null); }
  let countShown = null;
  function setCount(n) {
    if (countShown === n) return;
    countShown = n;
    const el = $('.c-sig-n');
    if (el) el.textContent = String(n); else $('.c-signal').innerHTML = signalHTML(n);
  }
  function renderSurface(snap = shown) {
    const items = activeItems(snap), notes = notesOf(snap);
    const beadItems = items.filter(item => item.share < SMALL && !notes.get(item.id)?.sunk), trayItems = items.filter(item => notes.get(item.id)?.sunk);
    const asks = beadItems.filter(item => notes.get(item.id)?.ask && !notes.get(item.id).answered).length;
    const beadShares = beadItems.reduce((n, item) => n + item.share, 0);
    $('.c-surface').style.top = `${geo.fieldH}px`;
    $('.c-surface-beads').innerHTML = beadItems.length ? `水面以下 · 小珠 <b>${beadItems.length}</b> 件 ${beadShares} 份 · 各不足 ${SMALL} 份${asks ? ` · <em>${asks} 件登记了问题</em>` : ''}` : '水面以下 · 没有不足 3 份的事';
    $('.c-surface-tray').innerHTML = trayItems.length ? `你推后的 <b>${trayItems.length}</b> 件 ${trayItems.reduce((n, item) => n + item.share, 0)} 份 · 到点浮起` : '';
  }
  function renderBudget(snap = shown) {
    const items = activeItems(snap), notes = notesOf(snap);
    const used = items.reduce((n, item) => n + item.share, 0), free = BUDGET - used, nested = Boolean(snap.layerId);
    const cells = [];
    for (const item of items) for (let i = 0; i < item.share; i += 1) cells.push(`<i data-c-id="${esc(item.id)}" class="${i === 0 ? 'is-first' : ''}${notes.get(item.id)?.sunk ? ' is-deferred' : ''}" style="--cell:${cssRGB(dropColor(snap.state, item, nested))}"></i>`);
    for (let i = 0; i < free; i += 1) cells.push(`<i class="is-free${i === 0 ? ' is-first' : ''}"></i>`);
    const box = $('.c-budget-cells'); box.innerHTML = cells.join('');
    const owner = snap.layerId && getItem(snap.state, snap.layerId);
    box.setAttribute('aria-label', `${owner ? `「${owner.title}」自己的 64 份` : '本层 64 份'}：${items.map(item => `${item.title} ${item.share} 份`).join('，')}${free ? `，未分配 ${free} 份` : ''}`);
    $('.c-budget-text').innerHTML = `<span>${owner ? '这一层独立 64 份' : '本层 64 份'} · 已分配 <b>${used}</b></span><span class="${free ? 'is-free' : ''}">${free ? `未分配 <b>${free}</b> 份，是真实留白` : '64 份已全部分配'}</span>`;
    highlightCells();
  }
  function highlightCells() {
    const focus = X?.focus || null;
    host.querySelectorAll('.c-budget-cells i[data-c-id]').forEach(cell => cell.classList.toggle('is-hover', cell.dataset.cId === focus));
  }

  // ---------- reading pane ----------
  function where(item) {
    const note = notesOf(s).get(item.id);
    if (item.status !== 'active') return item.status === 'merged' ? '已合并' : '已撤下';
    if (note?.sunk) return `沉在水面以下，${stamp(note.sunk)} 浮起`;
    if (item.share < SMALL) { const n = s.layerId ? 0 : roundsUnder(s.index, item.id); return n ? `水底的小珠 · 在水下第 ${n} 轮` : '水底的小珠'; }
    return '液滴';
  }
  function detailHTML(item, asOwner, viaIx = false) {
    const parent = item.parent_id && getItem(s.state, item.parent_id);
    const category = scenario.categories?.[rootOf(s.state, item).id]?.label;
    const ask = item.status === 'active' ? currentAsk(s, item.id) : null;
    const record = latestRecord(store, item.id, s.cursor);
    const response = item.status === 'active' ? responder.html(item, ask, { inlineDefer: true, allowDefer: true }) : '';
    const actions = itemActions(item.id, s.index);
    const due = deadlinesOf(s, [item])[0];
    const swatch = `<i class="c-swatch" style="--cell:${cssRGB(dropColor(s.state, item, Boolean(item.parent_id)))}" aria-hidden="true"></i>`;
    const head = asOwner ? `<p class="c-read-kicker">你在它的 64 份里 · 已分配 ${item.children?.used ?? 0}</p>`
      : `<button type="button" class="c-read-back" data-c="overview">‹ 本轮概览</button>${viaIx ? `<p class="c-read-kicker">这一件 · ${stamp(s.cursor)} · 第 ${s.index + 1} / ${s.frames.length} 次整理</p>` : ''}`;
    const children = [...(item.children?.items || [])].sort((a, b) => a.rank - b.rank);
    return `${head}<p class="c-read-meta"><span>${swatch}${esc([category, parent ? `属于「${parent.title}」` : '', kindLabel[item.kind], where(item)].filter(Boolean).join(' · '))}</span><span class="c-read-share">${item.share} / 64</span></p>
      <h2>${esc(item.title)}</h2>
      <p class="c-read-summary">${esc(item.summary)}</p>
      ${item.merged_into ? `<p class="c-note">已合并到 <button type="button" class="c-inline" data-c-select="${esc(item.merged_into)}">${esc(getItem(s.state, item.merged_into)?.title || item.merged_into)}</button></p>` : ''}
      ${response ? `<section class="c-respond${ask || record ? '' : ' is-default'}" data-c-respond="${esc(item.id)}"><h3>${ask && !(record && record.ask === ask.id) ? `回应 · ${askTag(normalizeAsk(ask))}` : record ? '你的回应' : '推后'}</h3>${response}</section>` : ''}
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
    for (const c of groups.merged) { const target = getItem(s.state, c.item)?.merged_into; if (target) mergedInto.set(target, [...(mergedInto.get(target) || []), c.item]); }
    const fresh = groups.added.filter(c => !mergedInto.has(c.item));
    const crossing = groups.updated.filter(c => c.fields.includes('share') && (c.before.share < SMALL) !== (c.after.share < SMALL));
    const rows = [
      fresh.length ? `<li><b>滴入</b>${fresh.map(c => name(c.item)).join('、')}</li>` : '',
      [...mergedInto].map(([target, from]) => `<li><b>融合</b>${from.map(name).join(' + ')} → ${name(target)}</li>`).join(''),
      groups.withdrawn.length ? `<li><b>沉没</b>${groups.withdrawn.map(c => name(c.item)).join('、')}（撤下）</li>` : '',
      crossing.length ? `<li><b>沉浮</b>${crossing.map(c => `${name(c.item)} ${c.before.share}→${c.after.share}${c.after.share < SMALL ? ' 沉到水底' : ' 浮出水面'}`).join('；')}</li>` : '',
      groups.updated.length - crossing.length > 0 ? `<li><b>长缩</b>另 ${groups.updated.length - crossing.length} 项内容或份额更新</li>` : '',
    ].filter(Boolean).join('');
    const notes = notesOf(s);
    const tray = s.layer.items.filter(item => notes.get(item.id)?.sunk).sort((a, b) => notes.get(a.id).sunk - notes.get(b.id).sunk);
    const arrivalHTML = arrivals.length ? `<section class="c-arrivals"><h3>◷ 到点浮起</h3>${arrivals.map(record => `<p><button type="button" class="c-inline" data-c-select="${esc(record.item)}">${esc(getItem(s.state, record.item)?.title || record.title)}</button> · 你在 ${stamp(record.at)} 推到 ${stamp(record.until)}，现在浮回来了。</p>`).join('')}</section>` : '';
    const trayHTML = tray.length ? `<section><h3>水面以下 · 你推后的 ${tray.length} 件</h3><ol class="c-tray-list">${tray.map(item => `<li><button type="button" data-c-select="${esc(item.id)}"><time>${stamp(notes.get(item.id).sunk)}</time><span>${esc(item.title)}</span></button></li>`).join('')}</ol><p class="c-note">推后不是已阅，也不改份额；到点那一次整理，它会浮回原处。</p></section>` : '';
    const acts = frameActions(s.index).filter(entry => visible.has(entry.target));
    const actsHTML = acts.length ? `<section><h3>本轮你在各处的回应 · ${acts.length}</h3>${acts.slice(0, 5).map(entry => actionHTML(entry, { cls: 'c', withTarget: getItem(s.state, entry.target) })).join('')}${acts.length > 5 ? `<details class="c-more"><summary>另 ${acts.length - 5} 条</summary>${acts.slice(5).map(entry => actionHTML(entry, { cls: 'c', withTarget: getItem(s.state, entry.target) })).join('')}</details>` : ''}</section>` : '';
    const dispositions = {}; for (const event of f.events) dispositions[event.disposition] = (dispositions[event.disposition] || 0) + 1;
    const words = { used: '采用', duplicate: '重复', noise: '噪音', deferred: '暂缓' };
    return `<p class="c-read-kicker">本轮概览 · ${stamp(f.at)}</p><h2>${esc(f.title)}</h2><p class="c-read-summary">${esc(f.narrative)}</p>${arrivalHTML}${rows ? `<section><h3>本轮变化</h3><ul class="c-changes">${rows}</ul></section>` : ''}${trayHTML}${actsHTML}<section><h3>本轮输入 · ${f.events.length} 条</h3><p class="c-note">${Object.entries(dispositions).map(([key, count]) => `${words[key] || key} ${count}`).join(' · ')}${dispositions.deferred ? '；暂缓的沉到水底，下一轮整理时散去' : ''}</p><button type="button" class="c-json" data-lab-inspect="inputs">原始输入 ↗</button><button type="button" class="c-json" data-lab-inspect="batch">声明与回执 ↗</button></section>`;
  }
  function renderRead(force = false) {
    const viewId = paneView;
    const item = viewId ? getItem(s.state, viewId) : s.selectedId && (getItem(s.state, s.selectedId) || getItem(s.baseState, s.selectedId));
    const owner = !item && s.layerId && getItem(s.state, s.layerId);
    const sig = `${s.index}|${s.cursor}|${s.layerId}|${viewId || s.selectedId}|${viewId ? 'ix' : ''}|${storeVersion}`;
    if (!force && read.dataset.sig === sig) return;
    const keep = read.dataset.sig?.split('|').slice(0, 4).join('|') === sig.split('|').slice(0, 4).join('|');
    read.dataset.sig = sig;
    // Replacing the pane must not drop keyboard focus to <body>, or Esc and Tab lose their place.
    const hadFocus = read.contains(document.activeElement);
    read.innerHTML = item ? detailHTML(item, false, Boolean(viewId)) : owner ? detailHTML(owner, true) : overviewHTML();
    if (!keep) $('.c-read').scrollTop = 0;
    if (hadFocus && !read.contains(document.activeElement)) (read.querySelector('.c-rs-receipt') || read).focus({ preventScroll: true });
  }

  // ---------- answering: the control folds into a receipt in place; the drop waits for the next 整理 ----------
  // The responder re-renders the pane; the response box keeps its top edge and its height moves to the receipt's.
  function foldInPlace(render) {
    const box = read.querySelector('.c-respond'), before = box?.getBoundingClientRect().height;
    render();
    const after = read.querySelector('.c-respond');
    if (!after || !before || reduced.matches) return;
    const h = after.getBoundingClientRect().height;
    if (Math.abs(h - before) < 2) return;
    after.classList.add('is-folding');
    after.animate([{ height: `${before}px`, overflow: 'hidden' }, { height: `${h}px`, overflow: 'hidden' }], { duration: 200, easing: 'cubic-bezier(.2,.75,.25,1)' });
  }
  function answered(record, kind) {
    // “答一件，少一件”: the count, the ring and the label change at once, in place; the drop does not move.
    // Whether it sinks waits for the next 整理 (its record is read there); only an undo after it sank moves it now.
    if (kind === 'save' && player.on) playStop();
    shown = s;
    renderHeadline(); renderSurface(); renderBudget();
    const key = sceneSig();
    if (key !== lastSceneSig) { lastSceneSig = key; begin('local'); }
    const notes = notesOf(s);
    const boxes = measureLabels(s.layer.items.filter(item => labelKind(notes.get(item.id))), s);
    for (const body of bodies.values()) {
      if (!body.alive) continue;
      const p = ringOf(notes.get(body.id));
      body.ringA = p.a; body.ringInk = p.ink; body.dashed = p.dashed; body.nextRing = p;
      if (body.seg.ring) body.seg.ring = [p.a, p.a, 0, 0, 'linear'];
      body.box = boxes.get(body.id) || null; body.nextBox = body.box; body.labelHold = false;
    }
    writeLabels();
    ix.relayout();
    if (ix.s.open && ix.s.view) { ix.s.view = factsOf(ix.s.open); ix.s.detailKey = ''; }
    kick();
  }
  const sceneSig = (snap = s) => { const notes = notesOf(snap); return `${layerKey(snap)}|${snap.layer.items.map(i => `${i.id}:${i.share}:${i.rank}:${i.updated_at}:${notes.get(i.id)?.sunk || ''}`).join(',')}`; };
  let lastSceneSig = '';

  // ---------- interaction (forms/motion/ix.mjs) ----------
  const interactive = () => Boolean(geo) && !document.hidden;
  const bodyOn = id => { const b = bodies.get(id); return b && b.alive && b.alpha > .5 && b.r > 1 ? b : null; };
  const itemNamed = name => {
    if (!name) return null;
    if (bodyOn(name)) return name;
    const items = s.layer.items;
    return items.find(x => scenario.categories?.[x.id]?.short === name || shortOf(x.id) === name)?.id || items.find(x => x.title.startsWith(name))?.id || null;
  };
  function hitAt(x, y) {
    let best = null, bestD = Infinity;
    for (const body of bodies.values()) {
      if (!bodyOn(body.id)) continue;
      const v = viewOf(body), d = Math.hypot(x - v.x, y - v.y) - v.r, band = body.place === 'field' ? 12 : 8;
      if (d <= band && d < bestD) { best = body.id; bestD = d; }
    }
    return best;
  }
  const labelRect = id => {
    const b = bodies.get(id); if (!b?.el || !b.labelKind || b.labelO < .3 || !b.box) return null;
    const v = viewOf(b), off = labelOffset(b.r, b.box, b.side);
    return { x0: v.x + off.x, y0: v.y + off.y, x1: v.x + off.x + b.box.w, y1: v.y + off.y + b.box.h };
  };
  const bounds = () => ({ x0: 8, y0: 8, x1: geo.w - 8, y1: geo.h - 8 });
  function peekPlace(id, w, h) {
    const b = bodies.get(id), v = viewOf(b), u = v.u;
    const from = { x: v.x + u.x * (v.r + 3), y: v.y + u.y * (v.r + 3) };
    const facing = b.place === 'field' ? (u.x >= 0 ? 1 : -1) : (v.x < geo.w * .6 ? 1 : -1);
    const keep = { x0: v.x - v.r - 8, y0: v.y - v.r - 8, x1: v.x + v.r + 8, y1: v.y + v.r + 8 };
    const at = b.place === 'field' ? from : { x: v.x, y: v.y - v.r - 6 };
    return placeBeside({ at, from: at, facing, w, h, gap: 16, steps: 90, flush: true, bounds: bounds(), avoid: [keep, labelRect(id)].filter(Boolean) });
  }
  function detailPlace(id, el) {
    const b = bodies.get(id); if (!b) return null;
    const u = outward(b), c = { x: b.x + u.x * IX.pop, y: b.y + u.y * IX.pop }, r = b.r;
    const keep = { x0: c.x - r - 10, y0: c.y - r - 10, x1: c.x + r + 10, y1: c.y + r + 10 };
    const lb = labelRect(id);
    if (lb) { keep.x0 = Math.min(keep.x0, lb.x0 - 6); keep.y0 = Math.min(keep.y0, lb.y0 - 6); keep.x1 = Math.max(keep.x1, lb.x1 + 6); keep.y1 = Math.max(keep.y1, lb.y1 + 6); }
    // The card stands on the side the drop popped toward, so the leader runs out along the drop's own line.
    return placeColumn({ el, facing: b.place === 'field' ? (u.x >= 0 ? 1 : -1) : (c.x < geo.w * .6 ? 1 : -1), width: Math.round(clamp(geo.w * .36, 260, 320)), minWidth: 240, bounds: bounds(), words: [], keep, anchorY: c.y, hug: 'edge',
      leader: card => {
        // From the drop's edge, on the side that faces the card, straight to the card's nearest edge.
        const to = { x: clamp(c.x, card.x0, card.x1), y: clamp(c.y, card.y0, card.y1) };
        const d = Math.hypot(to.x - c.x, to.y - c.y) || 1, k = (r + 3) / d;
        return [{ x: c.x + (to.x - c.x) * k, y: c.y + (to.y - c.y) * k }, edgePoint(to, card)];
      } });
  }
  // The card's facts: the dial's itemFacts at the root (with this page's rule for inputs), the same shape in a sub-layer.
  const factCache = new Map();
  function factsOf(id) {
    const key = `${s.index}|${s.layerId || ''}|${id}|${storeVersion}`;
    if (factCache.has(key)) return factCache.get(key);
    const base = !s.layerId && s.state.root.items.some(x => x.id === id) ? itemFacts(s.index, id, into) : nestedFacts(id);
    const item = getItem(s.state, id), note = notesOf(s).get(id);
    const lines = [];
    if (note?.sunk) lines.push(`推到 ${stamp(note.sunk)} · 沉在水面以下`);
    else if (item && item.share < SMALL) { const n = s.layerId ? 0 : roundsUnder(s.index, id); lines.push(n ? `在水下第 ${n} 轮 · 小珠` : '在水面以下 · 小珠'); }
    else if (item) { const rise = !s.layerId && lastRise(s.index, id); lines.push(rise ? `在水面上 · 沉过 ${rise.rounds} 轮，第 ${rise.at + 1} 次整理浮起` : '在水面上'); }
    if (note?.record && !note.back) lines.push(`${recordWords(note.record)} · ${note.status === 'acknowledged' ? '已收到' : '已保存，等下一轮整理'}`);
    // Your answer here is one of its responses, worded as the receipt says it.
    const mine = note?.record && !note.back ? [{ at: note.record.at, round: s.index, text: `${recordWords(note.record)}（本页） · ${note.status === 'acknowledged' ? '已收到' : '已保存'}` }] : [];
    const value = { ...base, cWhere: lines, feedback: [...base.feedback, ...mine] };
    factCache.set(key, value);
    return value;
  }
  function nestedFacts(id) {
    const i = s.index, item = getItem(s.state, id), prev = i ? getItem(records[i - 1].state, id) : null;
    const share = item?.status === 'active' ? item.share : 0, before = prev?.status === 'active' && (prev.parent_id || null) === (item?.parent_id || null) ? prev.share : 0;
    const change = !i ? null : !before && share ? { kind: 'new', text: `新增 ${share} 份` } : before && !share ? { kind: 'gone', text: `撤下 · 原 ${before} 份` }
      : share > before ? { kind: 'up', text: `变大 ${before} → ${share}` } : share < before ? { kind: 'down', text: `变小 ${before} → ${share}` } : { kind: 'same', text: `不变 ${share} 份` };
    const plan = grainPlan(i, s.layerId);
    const inputs = plan.list.filter(g => g.target === id).map(g => { const e = frames[i].events[g.k]; return { k: g.k, at: g.at, source: String(e.channel || '').split(' · ')[0] || '来源', from: e.from || '', title: String(e.subject || e.text || '').replace(/\s+/g, ' ').trim().slice(0, 30) }; });
    const asks = [];
    const walk = node => { if (!node) return; const a = currentAsk(s, node.id); if (a) asks.push({ id: a.id, item: node.id, short: a.short || a.prompt, prompt: a.prompt, due: a.due_at ? dueText(Date.parse(a.due_at)) : null, cursor: false }); for (const c of node.children?.items || []) walk(c); };
    walk(item);
    const feedback = [];
    for (let k = 1; k <= i; k += 1) for (const e of frames[k].events) for (const link of e.feedback || []) if (link.target === id) feedback.push({ at: Date.parse(e.at), round: k, text: responseSentence(e, link) });
    return { id, i, short: shortOf(id), title: item?.title || id, summary: item?.summary || '', share, before, change, stream: [], inputs, asks, feedback,
      children: (item?.children?.items || []).map(c => ({ title: c.title, share: c.share })),
      trend: records.map(r => { const x = getItem(r.state, id); return x?.status === 'active' ? x.share : 0; }), phases: [inputs.length > 0, inputs.length > 0, Boolean(change) && change.kind !== 'same', asks.length > 0] };
  }
  // The cards keep the round's beats: held mid-round, they do not tell what has not landed yet.
  const seenNow = () => {
    if (!tr || tr.done || tr.settled) return { inputs: true, share: true, asks: true };
    const t = clockOf();
    return { inputs: !tr.grains || t >= (tr.n ? BEAT.inflow * tr.k : 0), share: false, asks: false };
  };
  const asksSeen = (f, seen) => {
    const fresh = new Set(Object.values(frames[s.index].asks || {}).filter(a => Date.parse(a.registered_at || s.frame.at) > Date.parse(frames[Math.max(0, s.index - 1)].at)).map(a => a.id));
    return f.asks.filter(a => seen.asks || !fresh.has(a.id)).map(a => {
      const note = notesOf(s).get(a.item);
      return note?.answered && note.record?.ask === a.id ? { ...a, due: `${recordWords(note.record)} · ${note.status === 'acknowledged' ? '已收到' : '已保存'}` } : a;
    });
  };
  const peekCard = (f, o) => `${ixPeekHTML(f, o)}${(f.cWhere || []).map(line => `<div class="ix-d c-ix-where">${esc(line)}</div>`).join('')}`;
  const detailCard = (f, o) => {
    const asks = o.asks || [];
    let k = 0;
    return ixDetailHTML(f, { ...o, href: '#c-answer' }).replace(/<a href="#c-answer">去回答 →<\/a>/g, () => {
      const a = asks[k++];
      return a && a.item === f.id ? `<button type="button" class="c-ix-answer" data-c-answer="${esc(a.item)}">在右栏作答 ↘</button>` : '';
    }).replace(/(<div class="ix-d-s">[\s\S]*?<\/div>)/, `$1${(f.cWhere || []).length ? `<p class="c-ix-where-d">${f.cWhere.map(esc).join(' · ')}</p>` : ''}`);
  };
  const ix = createIx({
    stage, keysIn: stage, facts: id => factsOf(id), index: () => s.index,
    has: id => Boolean(bodyOn(id)) && interactive(), hit: hitAt, named: itemNamed,
    pointOf: id => { const b = bodies.get(id); if (!b) return null; const v = viewOf(b); return { x: v.x, y: v.y }; },
    pause: () => hold(true), resume: () => hold(false), paused: () => held,
    last: LAST, answerHref: () => '#c-answer', seen: seenNow, asks: asksSeen,
    peekPlace, detailPlace, peekHTML: peekCard, detailHTML: detailCard, trendH: 30,
    pending: '还在路上：粒子落定之后才知道进了它几条', label: '本层事项：Tab 逐个看概要，Enter 展开详情，Esc 收回',
  });
  let keysKey = '';
  function syncKeys(force = false) {
    const list = activeItems(s).filter(item => bodyOn(item.id));
    const key = `${s.index}|${s.layerId || ''}|${list.map(x => x.id).join(',')}|${storeVersion}`;
    if (!force && key === keysKey) return;
    keysKey = key;
    const notes = notesOf(s);
    ix.sync(key, () => list.map(item => {
      const note = notes.get(item.id);
      return { id: item.id, label: [item.title, `${item.share} 份`, note?.ask && !note.answered ? `${askTag(note.ask)}：${note.ask.prompt}` : kindLabel[item.kind], note?.sunk ? `已推后，${stamp(note.sunk)} 浮起` : item.share < SMALL ? '在水面以下' : ''].filter(Boolean).join('，') };
    }));
  }
  // Hovering or opening holds the round's clock and the player; letting go goes on from the same moment.
  function hold(on) {
    if (on === held) return;
    held = on;
    if (on) { heldAt = now(); playerPause(); }
    else { if (tr && !tr.free) tr.start += now() - heldAt; if (tell) { const d = now() - heldAt; tell.ranAt += d; if (tell.doneAt != null) tell.doneAt += d; } playerResume(); kick(); }
  }

  // ---------- the player: ▶ plays one round every 5.6 s; hovering holds it with the time it had left ----------
  const player = { on: false, timer: 0, due: 0, left: null };
  function playStart() {
    stopTell();
    ix.reset();
    player.on = true; player.left = null;
    if (s.index >= LAST) { advance(0, 'jump'); schedule(PLAY_MS); } else step();
    renderPlay();
  }
  function step() {
    if (!player.on) return;
    if (s.index >= LAST) { playStop(); return; }
    advance(s.index + 1);
    if (s.index >= LAST) { playStop(); return; }
    schedule(PLAY_MS);
  }
  function schedule(ms) { clearTimeout(player.timer); player.due = now() + ms; player.timer = setTimeout(step, ms); }
  function playerPause() { if (!player.on || player.left != null) return; clearTimeout(player.timer); player.left = Math.max(0, player.due - now()); }
  function playerResume() { if (!player.on || player.left == null) return; const left = player.left; player.left = null; schedule(Math.max(200, left)); }
  function playStop() { player.on = false; player.left = null; clearTimeout(player.timer); renderPlay(); }
  let nextKind = null;
  // One round forward plays the four beats; anything else (back, several rounds) is a jump.
  function advance(i, kind = i === s.index + 1 ? 'turn' : 'jump') { nextKind = kind; model.goFrame(i); nextKind = null; }

  // ---------- 讲一遍 (c-motion.md 3.1): only when this page was opened directly ----------
  const topLevel = (() => { try { return window.top === window; } catch { return false; } })();
  const loadedWith = new URL(performance.getEntriesByType?.('navigation')?.[0]?.name || location.href);
  const direct = topLevel && !document.referrer && !loadedWith.searchParams.has('frame') && !loadedWith.searchParams.has('embed') && (loadedWith.searchParams.get('variant') || '').toLowerCase() === 'c';
  let tell = null;
  function startTell() {
    if (!hero) return;
    stopTell(); playStop(); ix.reset();
    const h = hero, start = Math.max(0, h.sank - 2), steps = [];
    // The second beat has about 7 s for the rounds under water, one steady span each (0.5–0.9 s), its four beats compressed to fit.
    const span = clamp(7 / Math.max(1, h.rose - h.sank - 1), .5, .9);
    steps.push({ gap: .4, run: () => advance(h.sank - 1) });
    steps.push({ gap: .45, run: () => advance(h.sank) });
    for (let i = h.sank + 1; i < h.rose; i += 1) steps.push(i === h.sank + 1 ? { gap: .7, run: () => advance(i, 'fast') } : { every: span, run: () => advance(i, 'fast') });
    steps.push({ every: span + .3, run: () => advance(h.rose) });
    steps.push({ gap: .6, run: () => { if (bodyOn(h.id) && !ix.s.hover && !ix.s.open) ix.present(h.id); } });
    steps.push({ gap: IX.card + IX.cardDur + 2.4, run: () => { if (ix.s.presented) ix.close(); } });
    steps.push({ gap: .8, run: () => stopTell() });
    advance(start, 'instant');
    tell = { steps, at: 0, ranAt: now(), doneAt: null, fastK: span / (BEAT.inflow + BEAT.grow + BEAT.cross + BEAT.labelIn) };
    renderTellButton();
    kick();
  }
  // Each step waits for the round before it to settle (on the transition clock, which holds while you hover), then its
  // gap; a step with `every` instead starts that long after the one before it started (the steady rounds under water).
  function tellTick() {
    if (!tell || held) return;
    if (tr && !tr.done) { tell.doneAt = null; return; }
    if (tell.doneAt == null) tell.doneAt = now();
    const next = tell.steps[tell.at];
    if (next.every != null ? (now() - tell.ranAt) / 1000 < next.every : (now() - tell.doneAt) / 1000 < next.gap) return;
    tell.at += 1; tell.ranAt = now(); tell.doneAt = null;
    next.run();
    if (tell && tell.at >= tell.steps.length) stopTell();
  }
  function stopTell(skip = false) {
    if (!tell) return;
    tell = null;
    if (ix.s.presented) { ix.reset(); }
    if (skip && hero) advance(hero.rose, 'instant');
    heroEl.hidden = true;
    renderTellButton();
  }
  function renderTellButton() {
    const button = $('.c-tell');
    button.hidden = !topLevel || !hero;
    button.textContent = tell ? '跳过 ▸▸' : '▶ 讲一遍';
    button.setAttribute('aria-label', tell ? '跳过讲述' : '讲一遍：沉下去、到点浮起');
  }
  // The hero number: rounds under the surface, beside the hero bead; it flips on each cut and stops when it rises.
  function paintHero() {
    if (!tell || !hero || s.layerId) { if (!heroEl.hidden) heroEl.hidden = true; return; }
    const b = bodies.get(hero.id), i = shown.index;
    if (!b || i < hero.sank || i > hero.rose) { heroEl.hidden = true; return; }
    const rose = i >= hero.rose, n = rose ? hero.rounds : i - hero.sank + 1;
    const title = shortTitle(getItem(shown.state, hero.id)?.title || '');
    const html = rose ? `<b>${hero.rounds}</b><span>轮之后浮起 · ${hero.low} → ${hero.to} 份</span>` : `<b>${n}</b><span>轮在水下</span><small>${esc(title)}</small>`;
    if (heroEl.dataset.html !== html) { heroEl.dataset.html = html; heroEl.innerHTML = html; heroEl.hidden = false; heroEl.dataset.w = String(heroEl.offsetWidth); heroEl.dataset.h = String(heroEl.offsetHeight); }
    heroEl.hidden = false;
    const v = viewOf(b), under = b.depth > .5, w = Number(heroEl.dataset.w) || 160, h = Number(heroEl.dataset.h) || 28;
    // Under water: just below its bead, clear of the surface caption. Risen: beside the drop, away from its label.
    const left = !under && b.labelKind && b.side === 'right';
    const x = under ? clamp(v.x - 12, 8, geo.w - w - 8) : clamp(left ? v.x - v.r - 14 - w : v.x + v.r + 14, 8, geo.w - w - 8);
    const y = under ? Math.min(v.y + v.r + 6, geo.h - h - 4) : v.y - h / 2;
    heroEl.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    // It gives way to the card the tell presents at the end.
    heroEl.classList.toggle('is-away', Boolean(ix.s.open));
  }

  // ---------- events ----------
  host.addEventListener('click', event => {
    const t = event.target.closest('button, .c-budget-cells i[data-c-id]');
    if (!t || t.closest('.c-respond')) return;
    if (t.dataset.labInspect) return;
    if (t.dataset.tFrame != null) { advance(Number(t.dataset.tFrame), 'jump'); return; }
    if (t.dataset.cAnswer) { const box = read.querySelector('.c-respond button, .c-respond [tabindex]'); (box || read).focus({ preventScroll: true }); read.querySelector('.c-respond')?.scrollIntoView({ block: 'nearest', behavior: reduced.matches ? 'auto' : 'smooth' }); return; }
    if (t.matches('.c-budget-cells i[data-c-id]')) { event.stopPropagation(); if (ix.s.open === t.dataset.cId) ix.close(); else ix.open(t.dataset.cId); return; }
    const id = t.dataset.cSelect || t.dataset.tItem;
    if (id) { if (bodyOn(id)) ix.open(id); else model.select(id); return; }
    if (t.dataset.dive) { ix.reset(); model.dive(t.dataset.dive); return; }
    switch (t.dataset.c) {
      case 'prev': ix.reset(); playStop(); stopTell(); advance(s.index - 1, 'jump'); break;
      case 'next': ix.reset(); playStop(); stopTell(); advance(s.index + 1); break;
      case 'play': if (player.on) playStop(); else playStart(); break;
      case 'tell': if (tell) stopTell(true); else startTell(); break;
      case 'rise': ix.reset(); model.rise(); break;
      case 'root': ix.reset(); model.goRoot(); break;
      case 'overview': if (ix.s.open) ix.close(); else model.select(null); break;
    }
  });
  // Clicks in the pane that are not on a control stay there (ix folds an open detail on any other click outside the stage).
  $('.c-read').addEventListener('click', event => { if (!event.target.closest('button, a')) event.stopPropagation(); });
  const cells = $('.c-budget-cells');
  cells.addEventListener('pointerover', event => { const id = event.target.closest('i[data-c-id]')?.dataset.cId; if (id && bodyOn(id)) ix.hover(id, 'cell'); });
  cells.addEventListener('pointerout', event => { if (ix.s.via === 'cell' && !cells.contains(event.relatedTarget)) ix.hover(null); });
  host.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.altKey) return;
    if (responder.closePanel()) { renderRead(true); event.stopPropagation(); return; }
    if (ix.s.open) { ix.close(); event.stopPropagation(); event.preventDefault(); return; }
    if (ix.s.hover && ix.s.via !== 'key') { ix.hover(null, 'now'); event.stopPropagation(); return; }
    if (s.selectedId) { const back = s.selectedId; model.select(null); event.stopPropagation(); requestAnimationFrame(() => stage.querySelector(`.ix-sr [data-ix="${CSS.escape(back)}"]`)?.focus({ preventScroll: true })); }
  });
  // The scrubber: drag or click to a 整理时刻; ←/→ are the shell's.
  const frameAt = x => { const r = track.getBoundingClientRect(); return Math.round(clamp((x - r.left) / r.width, 0, 1) * (s.frames.length - 1)); };
  let scrubbing = false;
  track.addEventListener('pointerdown', event => { scrubbing = true; track.setPointerCapture(event.pointerId); playStop(); stopTell(); const i = frameAt(event.clientX); if (i !== s.index) advance(i, 'jump'); });
  track.addEventListener('pointermove', event => { if (!scrubbing) return; const i = frameAt(event.clientX); if (i !== s.index) advance(i, 'jump'); });
  track.addEventListener('pointerup', () => { scrubbing = false; });
  track.addEventListener('keydown', event => {
    const map = { Home: 0, End: s.frames.length - 1, PageUp: s.index - 5, PageDown: s.index + 5, ArrowUp: s.index + 1, ArrowDown: s.index - 1 };
    if (event.key in map) { event.preventDefault(); playStop(); advance(map[event.key], map[event.key] === s.index + 1 ? 'turn' : 'jump'); }
  });
  const unbindRespond = responder.bind(read, { getAsk: id => currentAsk(s, id), getItemVersion: id => getItem(s.state, id), render: () => foldInPlace(() => renderRead(true)) });
  // Any key or press skips the tell (and is spent on skipping), except the tell button itself.
  const skipKey = event => { if (!tell) return; event.preventDefault(); event.stopImmediatePropagation(); stopTell(true); };
  const skipPress = event => { if (tell && !event.target.closest?.('[data-c="tell"]')) stopTell(true); };
  window.addEventListener('keydown', skipKey, true);
  window.addEventListener('pointerdown', skipPress, true);
  const onVisibility = () => { if (document.hidden) { playStop(); stopTell(); } };
  document.addEventListener('visibilitychange', onVisibility);

  let resizeFrame = 0;
  const onResize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { const w = stage.clientWidth; if (geo && w === geo.w && Math.abs(innerHeight - geo.vh) < 2) return; measure(); for (const body of bodies.values()) if (body.el) body.el.sig = ''; ix.relayout(); begin('instant'); }); };
  const observer = new ResizeObserver(onResize); observer.observe(stage.parentElement);
  addEventListener('resize', onResize);

  measure();
  let intercepting = false;
  const unsubscribe = model.subscribe((next, info) => {
    if (intercepting) return;
    // The shell's space bar (model.togglePlay) starts or stops this page's player instead of the model's timer.
    if (info.type === 'play' && next.playing) {
      intercepting = true; model.pause(); intercepting = false;
      const wasOn = player.on;
      next = model.snapshot();
      prevSnapshot(next);
      if (wasOn) playStop(); else playStart();
      return;
    }
    prevSnapshot(next, info);
  });
  function prevSnapshot(next, info = { type: 'play' }) {
    const prev = s;
    s = next;
    if (info.type === 'frame' && responder.closePanel()) read.dataset.sig = '';
    // Records whose moment arrived between the previous view and this one float back up now (if they had sunk).
    if (prev && next.cursor !== prev.cursor) arrivals = next.cursor > prev.cursor ? store.list(next.cursor).filter(record => record.meaning === 'snooze' && record.until > prev.cursor && record.until <= next.cursor && sunkUntil(record.item, prev)) : [];
    const key = sceneSig(s);
    if (info.type === 'init') { lastSceneSig = key; shown = s; renderTime(); renderPath(); begin('instant'); return; }
    const moved = info.type === 'frame' || info.type === 'play' ? next.index !== prev.index || next.cursor !== prev.cursor : false;
    if (moved || info.type === 'dive' || info.type === 'rise') { ix.reset(); paneView = null; }
    if (key !== lastSceneSig || info.type === 'dive' || info.type === 'rise' || moved) {
      lastSceneSig = key;
      const layerMoved = (prev?.layerId || null) !== (s.layerId || null);
      let kind = nextKind;
      if (!kind) kind = layerMoved || info.type === 'dive' || info.type === 'rise' ? 'layer' : next.index === prev.index + 1 && next.cursor === Date.parse(next.frame.at) ? 'turn' : 'jump';
      if (layerMoved && kind !== 'instant') kind = 'layer';
      if (moved && !nextKind && player.on) playStop();
      renderTime();
      if (kind === 'turn' || kind === 'fast') { countShown = null; $('.c-signal').innerHTML = signalHTML(0); }
      begin(kind);
      if (kind === 'layer') renderPath();
    } else {
      renderTime(); renderRead();
      writeLabels(); kick();
    }
  }
  renderTellButton();
  if (direct && !reduced.matches && hero) startTell();
  raf = requestAnimationFrame(loop);

  // For review tooling and scripts/check-ix.mjs (window.foldC, same names and meanings as foldDial's).
  host.__cField = { renderer, stats, store, get bodies() { return bodies; }, MAX_DROPS };
  const hooks = {
    ...ix.hooks(),
    model, hero, facts: (i, id) => (i === s.index ? factsOf(id) : itemFacts(i, id, into)),
    get index() { return s.index; },
    go: i => advance(i), play: () => { if (!player.on) playStart(); }, stop: () => playStop(), playing: () => player.on,
    tell: () => startTell(), skip: () => stopTell(true), telling: () => Boolean(tell),
    // Pin the round's clock at t seconds after the cut (stills, checks); null lets it run.
    beatAt: t => { pinned = t == null ? null : Number(t); kick(); },
    beat: () => (tr ? { kind: tr.kind, t: clockOf(), settle: tr.settle, end: tr.end, done: tr.done } : null),
    // The largest drop above the surface, and a point d px outside its edge where nothing else is hit.
    pick: () => [...bodies.values()].filter(b => bodyOn(b.id) && b.place === 'field').sort((a, b) => b.r - a.r)[0]?.id || null,
    nearOf: (name, d = 9) => {
      const id = itemNamed(name), b = id && bodies.get(id); if (!b) return null;
      const v = viewOf(b), box = stage.getBoundingClientRect();
      let best = null;
      for (let k = 0; k < 16; k += 1) {
        const a = k / 16 * Math.PI * 2, p = { x: v.x + Math.cos(a) * (v.r + d), y: v.y + Math.sin(a) * (v.r + d) };
        if (p.x < 4 || p.y < 4 || p.x > geo.w - 4 || p.y > geo.h - 4 || hitAt(p.x, p.y) !== id) continue;
        const clear = Math.min(...[...bodies.values()].filter(o => o.id !== id && bodyOn(o.id)).map(o => Math.hypot(p.x - o.x, p.y - o.y) - o.r), 999);
        if (!best || clear > best.clear) best = { ...p, clear };
      }
      return best ? { x: box.left + best.x, y: box.top + best.y } : null;
    },
    geom: id => { const b = bodies.get(itemNamed(id)); if (!b) return null; const v = viewOf(b), box = stage.getBoundingClientRect(); return { x: box.left + v.x, y: box.top + v.y, r: v.r, place: b.place, share: b.share, depth: b.depth }; },
    // Grains of round i by where they go: used (into an item on screen), deferred (to the floor), gone.
    census: i => { const plan = grainPlan(i ?? s.index, s.layerId); return { n: plan.list.length, used: plan.list.filter(g => g.target).length, deferred: plan.counts.deferred || 0, ...plan.counts }; },
    waiting: () => waitingOf(s),
    answer: (name, actionId) => {
      const id = itemNamed(name) || name, item = getItem(s.state, id), ask = currentAsk(s, id); if (!item) return null;
      const norm = ask ? normalizeAsk(ask) : null;
      const action = norm?.actions.find(a => a.id === actionId) || norm?.actions[0] || { id: 'snooze', label: '稍后提醒', meaning: 'snooze' };
      const until = action.meaning === 'snooze' ? (Number(actionId) || s.cursor + 9 * 3600000) : undefined;
      const record = store.save(item, action, { ask: norm, until, at: s.cursor, via: 'button' });
      renderRead(true); answered(record, 'save');
      return record;
    },
    defer: (name, until) => {
      const id = itemNamed(name) || name, item = getItem(s.state, id), ask = currentAsk(s, id); if (!item) return null;
      const record = store.save(item, { id: 'defer', label: '推到…', meaning: 'snooze' }, { ask: ask ? normalizeAsk(ask) : null, until: Number(until), at: s.cursor, via: 'button' });
      renderRead(true); answered(record, 'save');
      return record;
    },
  };
  window.foldC = hooks;
  return () => {
    disposed = true; cancelAnimationFrame(raf); cancelAnimationFrame(resizeFrame); clearTimeout(player.timer);
    observer.disconnect(); removeEventListener('resize', onResize); window.removeEventListener('keydown', skipKey, true); window.removeEventListener('pointerdown', skipPress, true);
    document.removeEventListener('visibilitychange', onVisibility);
    unsubscribe(); unstore(); unbindRespond(); renderer.dispose(); ix.reset();
    if (window.foldC === hooks) delete window.foldC;
  };
}

export default mount;
