// 原版树图的动画部件。编排（谁在哪一组、什么时候动）在 app.mjs；这里只管“一组怎么动”：
//   1. 节拍表 BEATS 与节拍时钟 createBeat：一次换轮或作答的全部动画挂在同一只表上，可以停住（悬停）、定格（静帧）、
//      跳到终态（连按 ←/→）；
//   2. 一块按 id 保留格子的板 createBoard：离场 → 移位 → 进场。色块沿自身矩形长缩，字用反向缩放留在色块左上角、
//      不拉伸、被色块裁住；内容变了的格子逐个部件交接（同字的滑到新位置，换字的旧淡出新淡入，份数在落定时翻）；
//   3. 英雄数字滚一格、字在节拍上翻、新问题描一次边、灰点（概念层）。
// 只写 transform 与 opacity（Web Animations，走合成线程），只在切点读一次布局。时刻以秒计，与
// forms/polish/tree-motion.md 第 3 节的节拍表一一对应。

/** Ease-out, critically damped: tiles never overshoot (a tile that bounces while you read it looks like a shake). */
export const EASE = 'cubic-bezier(.2,.75,.25,1)';
export const EASE_IN = 'cubic-bezier(.4,0,1,1)';
const ms = s => Math.max(0, Math.round(s * 1000));
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

/** A cubic-bezier timing function as a JS function (for keyframes sampled by hand). */
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = t => ((ax * t + bx) * t + cx) * t, Y = t => ((ay * t + by) * t + cy) * t, dX = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let k = 0; k < 8; k += 1) { const e = X(t) - x, d = dX(t); if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break; t -= e / d; }
    return Y(clamp(t));
  };
}
const easeFn = bezier(0.2, 0.75, 0.25, 1);
const easeInOutFn = bezier(0.45, 0, 0.25, 1);

/**
 * What moves when, [start, duration] in seconds from the cut (tree-motion.md 3.2).
 *   grains   the concept layer: this round's inputs as grey grains, from the inputs column into the tiles
 *   receipt  answers given before this round are confirmed first (the hollow tick fills, “已收到”)
 *   hero     the count of items waiting for you turns over (one place a step; two or more in one frame)
 *   exit / move / enter   leave, then shift, then arrive; out / in are a changed tile's old and new words
 *   settle   discrete words on the tiles (“N 份”) and the budget line turn over in one frame
 *   ring     a question registered this round is outlined once
 *   seen     what a card may already say when the beat is stopped part-way (inputs landed, shares settled, asks)
 */
export const BEATS = {
  turn: { grains: [0, 0.5], receipt: [0, 0.30], hero: 0.40, exit: [0.40, 0.24], move: [0.48, 0.36], out: [0.48, 0.16], in: [0.60, 0.24],
    settle: 0.84, enter: [0.60, 0.36], ring: [0.96, 1.6], seen: { inputs: 0.5, share: 0.84, asks: 0.96 } },
  // 答一件：按下的那一帧就开始。提问与按钮收起，回执在原处出现，空心勾描出，数字减一；格子不动、面积不变。
  answer: { hero: 0.20, exit: [0, 0.2], move: [0, 0.3], out: [0, 0.12], in: [0.10, 0.20], check: [0.12, 0.18], settle: 0.12, enter: [0.1, 0.3] },
  // 撤回：逆序、更快。
  undo: { hero: 0.10, exit: [0, 0.15], move: [0, 0.25], out: [0, 0.10], in: [0.10, 0.20], check: [0.10, 0.15], settle: 0.10, enter: [0.1, 0.2] },
  // 拖时间轴、对比、改尺寸：同时起步，短。
  quick: { hero: 0, receipt: [0, 0.20], exit: [0, 0.20], move: [0, 0.32], out: [0, 0.12], in: [0.10, 0.20], settle: 0.16, enter: [0.08, 0.30] },
  // 下钻、放大小事块：经由锚点格子缩放 460 ms。
  zoom: { hero: 0, exit: [0, 0.37], move: [0, 0.46], out: [0, 0.16], in: [0.18, 0.28], settle: 0.23, enter: [0.05, 0.41] },
};
export const STAGGER = 0.04, STAGGER_MAX = 8;
/** Where a beat ends (its longest part, stagger included). */
export function beatEnd(spec) {
  let end = 0;
  for (const [key, v] of Object.entries(spec)) {
    if (key === 'seen' || v == null) continue;
    end = Math.max(end, Array.isArray(v) ? v[0] + v[1] + (key === 'enter' ? STAGGER * (STAGGER_MAX - 1) : 0) : v + 0.26);
  }
  return end;
}

// ---------- 1. the beat clock ----------
/**
 * One beat: every animation of one turn or answer on one clock. hold() stops them where they are (hover), pin(t) puts
 * them all at t seconds (stills and checks; null lets go), finish() jumps to the end state and cleans up (the next beat
 * starts from there). `scale` is slow motion (×3). `t` is the beat's own time in seconds, read off a master timer.
 */
export function createBeat(kind, { scale = 1, pinned = null } = {}) {
  const spec = BEATS[kind];
  const total = beatEnd(spec);
  const anims = [], cleans = [];
  let held = false, done = false, pin = null;
  const master = new Animation(new KeyframeEffect(null, [], { duration: Math.max(1, ms(total * scale)), fill: 'forwards' }), document.timeline);
  const place = a => { a.pause(); a.currentTime = pin * 1000 * scale; };
  const ctx = {
    kind, spec, scale, total,
    get t() { return done ? total : (Number(master.currentTime) || 0) / 1000 / scale; },
    get done() { return done; },
    get held() { return held; },
    add(a) {
      if (!a) return a;
      if (pin != null) place(a); else if (held) a.pause();
      anims.push(a);
      return a;
    },
    /** One animation on this clock: delay = start, fill both (the start state holds through the delay). */
    play(el, keys, [start, dur], { easing = EASE, fill = 'both' } = {}) {
      if (!el) return null;
      return ctx.add(el.animate(keys, { delay: ms(start * scale), duration: Math.max(1, ms(dur * scale)), easing, fill }));
    },
    clean(fn) { cleans.push(fn); },
    hold() { held = true; if (pin == null) for (const a of [master, ...anims]) if (a.playState === 'running') a.pause(); },
    release() { held = false; if (pin == null && !done) for (const a of [master, ...anims]) if (a.playState === 'paused') a.play(); },
    pin(t) {
      pin = t == null ? null : Math.max(0, Number(t));
      if (done) return;
      for (const a of [master, ...anims]) { if (pin == null) { if (!held) a.play(); } else place(a); }
    },
    finish() {
      if (done) return;
      done = true;
      for (const a of anims) { try { a.finish(); } catch { /* zero-length */ } a.cancel(); }
      master.cancel();
      for (const fn of cleans.splice(0)) fn();
    },
  };
  master.play();
  master.finished.then(() => { if (!done && pin == null) ctx.finish(); }, () => {});
  if (pinned != null) ctx.pin(pinned);
  return ctx;
}

/** Turn over in one frame at `at` seconds: hidden-then-shown (or the reverse). */
export function stepAt(ctx, el, at, show) {
  if (!el) return;
  if (at <= 0) { if (!show) el.style.visibility = 'hidden'; return; }
  ctx.add(el.animate(show ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
    { duration: ms(at * ctx.scale), easing: 'steps(1, end)', fill: show ? 'backwards' : 'forwards' }));
}

// ---------- 2. the board ----------
const near = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
const lerpRect = (a, b, p) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, width: a.width + (b.width - a.width) * p, height: a.height + (b.height - a.height) * p });
export const unionRect = rects => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y };
};
const shrunk = (r, k) => ({ x: r.x + r.width * (1 - k) / 2, y: r.y + r.height * (1 - k) / 2, width: r.width * k, height: r.height * k });
/** Map a rect from one frame of reference into another (zooming into or out of a tile). */
export const projectRect = (rect, from, to) => ({ x: to.x + (rect.x - from.x) * to.width / from.width, y: to.y + (rect.y - from.y) * to.height / from.height,
  width: rect.width * to.width / from.width, height: rect.height * to.height / from.height });
const S = 14; // samples per move: shape and words are sampled together, so the words stay 1:1 at every step
/**
 * Keyframes that take a shape whose layout box is `box` from rect a to rect b (both in board px), and the counter-scale
 * that keeps the words inside it at 1:1, anchored at its top-left corner. `ease` is a JS easing.
 */
function rectKeys(box, a, b, ease) {
  const shape = [], words = [];
  for (let k = 0; k <= S; k += 1) {
    const r = lerpRect(a, b, ease(k / S)), sx = Math.max(1e-4, r.width / box.width), sy = Math.max(1e-4, r.height / box.height);
    shape.push({ offset: k / S, transform: `translate(${(r.x - box.x).toFixed(2)}px, ${(r.y - box.y).toFixed(2)}px) scale(${sx.toFixed(5)}, ${sy.toFixed(5)})` });
    words.push({ offset: k / S, transform: `scale(${(1 / sx).toFixed(5)}, ${(1 / sy).toFixed(5)})` });
  }
  return { shape, words };
}

/** Each [data-part] of a face: its words and where it sits in the face, in unscaled px. */
function partsOf(face) {
  const map = new Map();
  if (!face) return map;
  const r = face.getBoundingClientRect();
  for (const p of face.querySelectorAll('[data-part]')) {
    if (map.has(p.dataset.part) || p.closest('[hidden]')) continue;
    const q = p.getBoundingClientRect();
    if (!q.width && !q.height) continue;
    map.set(p.dataset.part, { el: p, x: q.left - r.left, y: q.top - r.top, text: p.textContent.replace(/\s+/g, ' ').trim(), received: p.classList.contains('is-received') });
  }
  return map;
}
const HARD = new Set(['share', 'blank']); // numbers: turn over in one frame when the tile has settled, never crossfade

/**
 * A board of absolutely placed tiles keyed by id. Each tile is
 *   <div class="{tileClass} …" data-{idKey}><div class="flip-shape"><div class="flip-body {bodyClass}">…html…</div></div></div>
 * The shape carries the tile's colour and clips; it is placed at the tile's final rect and moved with transform alone.
 * The body holds the words at the final layout, counter-scaled so they never stretch. A body whose html changed is kept
 * as a ghost (its old size and classes, so its words do not reflow) for the parts that leave. update(entries, opts):
 *   entries  [{ id, x, y, width, height, className, bodyClass, html, key, attrs }]
 *   opts     { ctx, links: [{from, to}], zoom: {from, to}, fromTail, toTail (id sets), tailId, front (ids drawn on top),
 *              rings (ids outlined once), noRing }
 * onRender(el, entry, body) runs after a body is (re)written, so the form can trim words to fit.
 */
export function createBoard(board, { tileClass = 'pin-tile', idKey = 'id', onRender = () => {} } = {}) {
  let live = new Map();
  let last = null;
  const attr = `data-${idKey.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
  function make() {
    const el = document.createElement('div');
    el.innerHTML = '<div class="flip-shape"><div class="flip-body"></div></div>';
    board.append(el);
    return { el, shape: el.firstChild, body: el.firstChild.firstChild, rect: null, key: null, bodyClass: '', ghost: null };
  }
  function ghostOf(rec) {
    const g = rec.body;
    g.classList.replace('flip-body', 'flip-ghost');
    Object.assign(g.style, { width: `${rec.rect.width}px`, height: `${rec.rect.height}px` });
    g.inert = true;
    g.setAttribute('aria-hidden', 'true');
    for (const node of g.querySelectorAll('[data-item], [data-answer], [data-undo], [data-dive], [data-tail], [data-tail-item], [id]')) {
      for (const name of ['data-item', 'data-answer', 'data-undo', 'data-dive', 'data-tail', 'data-tail-item', 'id']) node.removeAttribute(name);
    }
    return g;
  }

  function update(entries, { ctx = null, links = [], zoom = null, fromTail = new Set(), toTail = new Set(), tailId = '__tail__', front = new Set(), rings = new Set() } = {}) {
    const before = new Map([...live].map(([id, r]) => [id, r.rect]));
    const oldTail = before.get(tailId) || null;
    const next = new Map(), written = [];
    for (const entry of entries) {
      let rec = live.get(entry.id);
      const fresh = !rec;
      if (!rec) rec = make();
      const el = rec.el, rect = { x: entry.x, y: entry.y, width: entry.width, height: entry.height };
      el.className = `${tileClass} ${entry.className || ''}`.replace(/\s+/g, ' ').trim();
      el.setAttribute(attr, entry.id);
      for (const [name, value] of Object.entries(entry.attrs || {})) {
        if (value === null || value === undefined || value === false) el.removeAttribute(name); else el.setAttribute(name, String(value));
      }
      Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      const bodyClass = `flip-body ${entry.bodyClass || ''}`.replace(/\s+/g, ' ').trim();
      if (fresh || rec.key !== entry.key || rec.bodyClass !== bodyClass) {
        if (ctx && !fresh && rec.rect) {
          rec.ghost = ghostOf(rec);
          const body = document.createElement('div');
          rec.shape.append(body);
          rec.body = body;
        }
        rec.body.className = bodyClass;
        rec.body.removeAttribute('data-fit');
        rec.body.innerHTML = entry.html;
        rec.key = entry.key; rec.bodyClass = bodyClass;
        written.push([rec, entry]);
      }
      rec.fresh = fresh || !before.has(entry.id);
      rec.from = rec.rect;
      rec.rect = rect;
      next.set(entry.id, rec);
    }
    const leaving = [...live].filter(([id]) => !next.has(id));
    live = next;
    for (const [rec, entry] of written) onRender(rec.el, entry, rec.body);
    if (!ctx) {
      for (const [, rec] of leaving) rec.el.remove();
      for (const rec of live.values()) { rec.ghost?.remove(); rec.ghost = null; }
      last = null;
      return null;
    }
    const spec = ctx.spec;
    // One layout read for everything: the parts of each changed face, old and new.
    const swaps = [];
    for (const [id, rec] of live) if (rec.ghost) swaps.push({ id, rec, old: partsOf(rec.ghost), now: partsOf(rec.body) });
    // Where a merged item flies, and where a merge target arrives from.
    const finals = new Map([...live].map(([id, rec]) => [id, rec.rect]));
    const sourcesOf = new Map(), targetOf = new Map();
    for (const { from, to } of links) {
      if (before.has(from) && finals.has(to) && !finals.has(from)) { targetOf.set(from, to); if (!before.has(to)) sourcesOf.set(to, [...(sourcesOf.get(to) || []), from]); }
      if (before.has(to) && finals.has(from) && !finals.has(to)) { targetOf.set(to, from); if (!before.has(from)) sourcesOf.set(from, [...(sourcesOf.get(from) || []), to]); }
    }
    const newTail = finals.get(tailId) || null;
    const plan = { moves: 0, enters: 0, exits: 0, swaps: swaps.length };
    // Leave: withdrawn ones shrink where they stood, merged ones fly into their target, folded ones into the tail block.
    for (const [id, rec] of leaving) {
      const from = before.get(id), el = rec.el;
      const target = targetOf.has(id) ? finals.get(targetOf.get(id)) : zoom ? projectRect(from, zoom.from, zoom.to) : toTail.has(id) && newTail ? newTail : shrunk(from, 0.6);
      const flies = targetOf.has(id) || (toTail.has(id) && newTail);
      el.classList.add('is-leaving');
      el.inert = true;
      el.setAttribute('aria-hidden', 'true');
      el.style.zIndex = flies ? '4' : '';
      const keys = rectKeys(from, from, target, t => easeInOutFn(t));
      ctx.play(rec.shape, keys.shape, spec.exit, { easing: 'linear' });
      for (const face of [rec.body, rec.ghost]) if (face) ctx.play(face, keys.words, spec.exit, { easing: 'linear' });
      ctx.play(el, [{ opacity: 1 }, { opacity: flies ? 0.9 : 0.7, offset: 0.4 }, { opacity: 0 }], spec.exit, { easing: 'linear' });
      ctx.play(rec.body, [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], spec.exit, { easing: 'linear' });
      ctx.clean(() => el.remove());
      plan.exits += 1;
    }
    // Shift and arrive.
    let entered = 0;
    for (const [id, rec] of live) {
      const to = rec.rect;
      if (front.has(id)) { rec.el.style.zIndex = '3'; ctx.clean(() => { rec.el.style.zIndex = ''; }); }
      if (!rec.fresh && !zoom) {
        const from = before.get(id);
        if (!near(from, to)) {
          const keys = rectKeys(to, from, to, easeFn);
          ctx.play(rec.shape, keys.shape, spec.move, { easing: 'linear' });
          ctx.play(rec.body, keys.words, spec.move, { easing: 'linear' });
          if (rec.ghost) ctx.play(rec.ghost, keys.words, spec.move, { easing: 'linear' });
          plan.moves += 1;
        }
        continue;
      }
      // New here: from its merge sources, out of the tail block it was folded in, through the zoom, or revealed top-down.
      const sources = sourcesOf.get(id);
      const from = sources ? unionRect(sources.map(s => before.get(s)))
        : zoom ? projectRect(to, zoom.to, zoom.from)
          : fromTail.has(id) && oldTail ? oldTail : { x: to.x, y: to.y, width: to.width, height: Math.max(1, to.height * 0.02) };
      const k = Math.min(entered, STAGGER_MAX - 1), span = [spec.enter[0] + STAGGER * k, spec.enter[1]];
      entered += 1;
      const keys = rectKeys(to, from, to, easeFn);
      ctx.play(rec.shape, keys.shape, span, { easing: 'linear' });
      ctx.play(rec.body, keys.words, span, { easing: 'linear' });
      ctx.play(rec.el, [{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 1 }], span, { easing: 'linear' });
      ctx.play(rec.body, [{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], span, { easing: 'linear' });
      if (rec.ghost) { rec.ghost.remove(); rec.ghost = null; }
      plan.enters += 1;
    }
    // A changed face: part by part (same words slide, new words fade in, old ones fade out, numbers turn on settle).
    for (const { id, rec, old, now } of swaps) {
      if (!rec.ghost) continue;
      const ghost = rec.ghost;
      ghost.style.visibility = 'hidden';
      const moved = !rec.fresh && before.has(id) && !near(before.get(id), rec.rect);
      const slide = moved ? spec.move : spec.in;
      const seen = new Set();
      for (const [name, n] of now) {
        const o = old.get(name);
        seen.add(name);
        if (!o) { ctx.play(n.el, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], spec.in); fill(ctx, n.el, spec); continue; }
        const dx = o.x - n.x, dy = o.y - n.y, travels = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
        if (o.text === n.text && o.received === n.received) {
          if (travels) ctx.play(n.el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], slide);
          continue;
        }
        if (travels) ctx.play(n.el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], slide);
        if (HARD.has(name)) {
          o.el.style.visibility = 'visible';
          stepAt(ctx, n.el, spec.settle, true);
          stepAt(ctx, o.el, spec.settle, false);
          if (travels) ctx.play(o.el, [{ transform: 'none' }, { transform: `translate(${-dx}px, ${-dy}px)` }], slide);
          continue;
        }
        // A receipt the Agent has now read: shown at once in its new words, its tick filling in (0–0.30 s).
        if (spec.receipt && n.received && !o.received) { fill(ctx, n.el, spec, spec.receipt); continue; }
        o.el.style.visibility = 'visible';
        ctx.play(o.el, [{ opacity: 1 }, { opacity: 0 }], spec.out, { easing: 'linear' });
        if (travels) ctx.play(o.el, [{ transform: 'none' }, { transform: `translate(${-dx}px, ${-dy}px)` }], slide);
        ctx.play(n.el, [{ opacity: 0 }, { opacity: 0, offset: 0.001 }, { opacity: 1 }], spec.in, { easing: 'linear' });
        fill(ctx, n.el, spec);
      }
      for (const [name, o] of old) {
        if (seen.has(name)) continue;
        o.el.style.visibility = 'visible';
        ctx.play(o.el, [{ opacity: 1 }, { opacity: 0 }], spec.out, { easing: 'linear' });
      }
      ctx.clean(() => { ghost.remove(); if (rec.ghost === ghost) rec.ghost = null; });
    }
    // A question registered this round: its tile is outlined once.
    if (spec.ring) for (const id of rings) {
      const rec = live.get(id);
      if (!rec) continue;
      const ring = document.createElement('i');
      ring.className = 'tile-ring';
      ring.setAttribute('aria-hidden', 'true');
      rec.el.append(ring);
      ctx.play(ring, [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0 }], spec.ring, { easing: 'linear' });
      ctx.clean(() => ring.remove());
    }
    board.classList.add('is-moving');
    ctx.clean(() => board.classList.remove('is-moving'));
    last = plan;
    return plan;
  }
  return {
    update,
    clear() { for (const rec of live.values()) rec.el.remove(); live = new Map(); },
    element: id => live.get(id)?.el || null,
    rect: id => live.get(id)?.rect || null,
    ids: () => [...live.keys()],
    get last() { return last; },
    inspect: () => ({ tiles: live.size, ghosts: [...live.values()].filter(r => r.ghost).length, last }),
  };
}
/** A receipt's tick: drawn (an answer just given: the hollow ring) or filled (the Agent has read it: the disc inside). */
function fill(ctx, el, spec, span = spec.check) {
  const received = span === spec.receipt;
  const tick = el.querySelector(received ? '.rc-tick > b' : '.rc-tick');
  if (!tick || !span) return;
  ctx.play(tick, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], span);
}

// ---------- 3. numbers and words ----------
/** The headline count turns over: one place a step (the roll says “one fewer”), two or more in one frame. */
export function roll(ctx, el, before, after, at) {
  const a = Number(before), b = Number(after);
  if (!el || a === b || !Number.isFinite(a)) return;
  const old = document.createElement('span');
  old.className = 'hero-old';
  old.setAttribute('aria-hidden', 'true');
  old.textContent = String(before);
  const now = document.createElement('span');
  now.className = 'hero-new';
  now.textContent = String(after);
  el.replaceChildren(now, old);
  ctx.clean(() => { el.textContent = String(after); });
  if (Math.abs(a - b) === 1) {
    const dir = b < a ? 1 : -1;
    ctx.play(now, [{ transform: `translateY(${0.62 * dir}em)`, opacity: 0 }, { transform: 'none', opacity: 1 }], [at, 0.26]);
    ctx.play(old, [{ transform: 'none', opacity: 1 }, { transform: `translateY(${-0.62 * dir}em)`, opacity: 0 }], [at, 0.26]);
  } else { stepAt(ctx, now, at, true); stepAt(ctx, old, at, false); }
}
/** A line of words turns over in one frame at `at` (the budget line: 已用 / 留白). */
export function flipText(ctx, el, html, at) {
  if (!el || el.innerHTML === html) { if (el) el.innerHTML = html; return; }
  const before = el.innerHTML;
  if (!ctx || at <= 0) { el.innerHTML = html; return; }
  el.innerHTML = `<span class="ft-new">${html}</span><span class="ft-old" aria-hidden="true">${before}</span>`;
  stepAt(ctx, el.firstChild, at, true);
  stepAt(ctx, el.lastChild, at, false);
  ctx.clean(() => { if (el.querySelector(':scope > .ft-new')) el.innerHTML = html; });
}

// ---------- 4. the concept layer: grains ----------
const hash01 = text => { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return (h >>> 0) / 4294967296; };
/**
 * This round's inputs as grains, two inputs a grain, at most `cap`: each { from, to, land, t0, d } in stage px. `inputs`
 * is [{ key, land: rect | null }]; landing ones end inside their tile, the rest stop short and go out on the way.
 */
export function planGrains(inputs, { start, board, span = [0, 0.5], cap = 120 } = {}) {
  const groups = new Map();
  for (const x of inputs) { const k = x.land ? `${x.land.x},${x.land.y}` : '-'; if (!groups.has(k)) groups.set(k, { land: x.land, list: [] }); groups.get(k).list.push(x); }
  const total = Math.ceil(inputs.length / 2), keep = total > cap ? cap / total : 1;
  const out = [];
  for (const { land, list } of groups.values()) {
    const n = Math.max(1, Math.round(Math.ceil(list.length / 2) * keep));
    for (let j = 0; j < n; j += 1) {
      const key = list[(j * 2) % list.length].key, r1 = hash01(`${key}:a`), r2 = hash01(`${key}:b`), r3 = hash01(`${key}:c`), r4 = hash01(`${key}:d`);
      const from = { x: start.x, y: start.y0 + (start.y1 - start.y0) * r1 };
      const to = land ? { x: land.x + land.width * (0.15 + 0.7 * r2), y: land.y + land.height * (0.2 + 0.6 * r3) }
        : { x: board.x + board.width * (0.04 + 0.22 * r2), y: board.y + board.height * (0.1 + 0.8 * r3) };
      const d = (span[1] - 0.14) * (0.8 + 0.2 * r4);
      out.push({ from, to, land: Boolean(land), t0: span[0] + 0.12 * r4, d });
    }
  }
  return out;
}
/** Draw the grains at beat time t (seconds); returns whether any is still in flight. */
export function drawGrains(c, grains, t, dpr = 1) {
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, c.canvas.width / dpr, c.canvas.height / dpr);
  let alive = false;
  c.fillStyle = 'oklch(0.42 0.012 150)';
  for (const g of grains) {
    const k = (t - g.t0) / g.d;
    if (k < 0) { alive = true; continue; }
    if (k >= 1) continue;
    alive = true;
    const p = easeInOutFn(k);
    const x = g.from.x + (g.to.x - g.from.x) * p, y = g.from.y + (g.to.y - g.from.y) * p - Math.sin(Math.PI * p) * 10;
    // Taken in: full until it lands. Not taken: goes out over the second half of its way, short of any tile.
    const a = g.land ? 0.34 * Math.min(1, k * 4) * (k > 0.88 ? (1 - k) / 0.12 : 1) : 0.3 * Math.min(1, k * 4) * clamp((0.75 - k) / 0.35);
    if (a <= 0.005) continue;
    c.globalAlpha = a;
    c.beginPath();
    c.arc(x, y, 1.7, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  return alive;
}
