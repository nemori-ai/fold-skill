// D · 手机首页的动画部件。编排（哪件事在哪一组、什么时候动）在 d.mjs 的 update()；这里只管“一组怎么动”：
// 同一个盒子换脸（框 + 部件）、揭开、从折叠行滑出、离场、英雄数字滚一格、份额细带缩放、详情从卡长出。
// 全部只写 transform 与 opacity（Web Animations，走合成线程）：圆角盒子的变高变矮用“上盖 + 中段 + 下盖”三块拼成，
// 中段只做 scale，两头只做 translate，圆角不被拉扁；揭开用一块纸色盖板 scaleY 收走，不动 clip-path。
// 时刻以秒计，与 forms/polish/home-motion.md 第 3 节（故事）和第 4 节（实现）的时间表一一对应。

/** Ease-out, critically damped: the list never overshoots (a row that bounces while you read it looks like a shake). */
export const EASE = 'cubic-bezier(.2,.75,.25,1)';
export const EASE_IN = 'cubic-bezier(.4,0,1,1)';
export const EASE_IN_OUT = 'cubic-bezier(.45,0,.25,1)';
const ms = s => Math.max(0, Math.round(s * 1000));

/**
 * Beats: what moves when, [start, duration] in seconds from the cut.
 *   self      the item you just answered or took back (its own face change)
 *   lead      the protagonists of a 整理 landing: what you answered and what lapsed, sinking to their new place
 *   move      everything else that stays and moves or changes face; swap = its changed words, fresh = parts that appear
 *   flip      a fold row's count turns over in one frame at this moment; settle = moves end (tags turn over then)
 */
export const BEATS = {
  // 换轮（回来，或下一轮整理落地）：0 切点换字；0–0.40 只确认你做过的（回执填实）与概念层；0.40 数字翻、离场，
  // 主角一次沉下（后半段盒子变成行）；0.48 移位；0.60 进场，错开 40 ms；0.96 新问题描一次朱红。
  turn: { receipt: [0, 0.30], tex: [0, 0.40], hero: 0.40, exit: [0.40, 0.24], lead: [0.40, 0.48], leadStep: 0.06,
    leadFace: [0.64, 0.24], move: [0.48, 0.32], swap: [0.56, 0.24], fresh: [0.64, 0.16], enter: [0.60, 0.36],
    flip: 0, settle: 0.80, glow: 0.96, band: [0.40, 0.48] },
  // 答一件：按下的那一帧就开始。卡原地收成回执（上沿不动），数字减一，下面一次上移补位，折叠里的一件补上来。
  answer: { self: { out: [0, 0.12], box: [0, 0.20], in: [0.10, 0.20] }, hero: 0.20, move: [0.20, 0.32],
    swap: [0.20, 0.32], fresh: [0.40, 0.16], flip: 0.36, enter: [0.36, 0.36], exit: [0.36, 0.24], settle: 0.52,
    glow: 0.72, guard: 1.12 },
  // 撤回：逆序、更快，合计 0.40 秒。
  undo: { self: { out: [0.15, 0.10], box: [0.15, 0.20], in: [0.15, 0.20] }, hero: 0.15, move: [0.10, 0.20],
    swap: [0.10, 0.20], fresh: [0.20, 0.15], flip: 0.15, enter: [0.15, 0.20], exit: [0, 0.15], settle: 0.30, glow: 0.40 },
  // 稍后：卡缩小飞向头部的“◷ N 件”（0.48 秒），其余同作答。
  snooze: { fly: [0, 0.48], hero: 0.20, move: [0.20, 0.32], swap: [0.20, 0.32], fresh: [0.40, 0.16], flip: 0.36,
    enter: [0.36, 0.36], exit: [0.20, 0.24], settle: 0.52, glow: 0.72 },
  // 手指触发的其余变化（展开折叠、知道了、切换用途、改比较起点）：同时起步，像通知叠层一件件滑出。
  local: { hero: 0, move: [0, 0.32], swap: [0.06, 0.24], fresh: [0.10, 0.22], flip: 0, enter: [0, 0.36],
    exit: [0, 0.24], settle: 0.32, glow: 0.36 },
};
export const STAGGER = 0.04, STAGGER_MAX = 8;

/** Tap a card or row: it steps out 8 px, its frame grows to the whole screen, the detail's words arrive (0.48 s). */
export const GROW = { dim: 0.15, pop: [0, 0.12], frame: [0.12, 0.24], face: [0.12, 0.10], anchor: [0.12, 0.24], content: [0.30, 0.18] };
/** Back: the words leave, the frame shrinks into the card, the card steps back in (0.40 s, faster than the way out). */
export const SHRINK = { content: [0, 0.10], frame: [0.06, 0.24], face: [0.20, 0.10], pop: [0.30, 0.10], total: 0.40 };
/** Long press: 0.15 s the row darkens (“waiting”), 0.45 s it fires; 10 px of travel or a scroll cancels it. */
export const PRESS = { hint: 0.15, hold: 0.45, slop: 10, peekIn: 0.15, peekOut: 0.12, drop: 0.10 };

const easeOutBack = k => { const u = Math.min(1, Math.max(0, k)) - 1; return 1 + 2 * u ** 3 + u ** 2; };
/** A uniform scale that steps out with an overshoot of about 3.7 % (ix.mjs easeOutBack), sampled into keyframes. */
export function popKeys(from, to, n = 10) {
  return Array.from({ length: n + 1 }, (_, j) => ({ offset: j / n, transform: `scale(${(from + (to - from) * easeOutBack(j / n)).toFixed(4)})` }));
}

/** One animation on the beat's clock: delay = start, fill both (the start state holds through the delay). */
export function play(ctx, el, keys, [start, dur], { easing = EASE, fill = 'both' } = {}) {
  if (!el) return null;
  const a = el.animate(keys, { delay: ms(start), duration: Math.max(1, ms(dur)), easing, fill });
  ctx.add(a);
  return a;
}
/** Turn over in one frame at `at` seconds: a stays-hidden-then-shows (or the reverse) step. */
export function stepAt(ctx, el, at, show) {
  if (!el || at <= 0) { if (el && !show) el.style.visibility = 'hidden'; return; }
  ctx.add(el.animate(show ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { duration: ms(at), easing: 'steps(1, end)', fill: show ? 'backwards' : 'forwards' }));
}

// ---------- the box: three pieces so the size changes by transform alone ----------
/** How an element's box looks (background, corner radius, ring or rule, drop shadow); null if it has no box. */
export function lookOf(el) {
  if (!el?.matches) return null;
  if (el.matches('.d-card.is-answered')) return { key: 'receipt', bg: '#fbfaf6', r: 20, ring: true };
  if (el.matches('.d-card')) return { key: 'card', bg: 'var(--card)', r: 20, drop: true };
  if (el.matches('.d-ask-row')) return { key: el.matches('.is-done') ? 'ask-done' : 'ask', bg: el.matches('.is-done') ? '#fbfaf6' : 'var(--card)', r: 16, ring: true };
  if (el.matches('.d-tail-item')) return { key: 'tail', bg: 'var(--card)', r: 13, ring: true };
  if (el.matches('.d-fold-row.is-asks')) return { key: 'more', bg: 'var(--card)', r: 16, ring: true };
  if (el.matches('.d-fold-row')) return { key: 'fold', bg: 'var(--paper-2)', r: 16 };
  if (el.matches('.d-line')) return { key: 'line', bg: 'var(--paper)', r: 1, rule: true };
  if (el.matches('.d-detail')) return { key: 'detail', bg: 'var(--paper)', r: 1 };
  return null;
}
/**
 * A box drawn in `host`'s coordinates (px) behind its content: a top cap and a bottom cap of the corner radius that only
 * translate, a middle piece that scales, and an optional drop shadow under the bottom cap. `at(rect)` gives each piece's
 * transform for a box at {x, y, w, h}; any two rects interpolate piece by piece in step, so one easing moves them all.
 */
export function makeBox(host, look, W) {
  const el = document.createElement('div');
  el.className = 'd-box';
  el.setAttribute('aria-hidden', 'true');
  const r = Math.max(1, look.r), MID = 100, line = 'var(--line)';
  const piece = (cls, h, css) => { const p = document.createElement('i'); p.className = cls; Object.assign(p.style, { width: `${W}px`, height: `${h}px` }, css); el.append(p); return p; };
  const sides = look.ring ? `inset 1px 0 0 ${line}, inset -1px 0 0 ${line}` : '';
  const drop = look.drop ? piece('d-box-drop', 48, { borderRadius: `${r}px` }) : null;
  const top = piece('d-box-cap', r, { background: look.bg, borderRadius: `${r}px ${r}px 0 0`, boxShadow: look.ring ? `inset 0 1px 0 ${line}, ${sides}` : '' });
  const mid = piece('d-box-mid', MID, { background: look.bg, boxShadow: sides });
  const bot = piece('d-box-cap', r, { background: look.bg, borderRadius: `0 0 ${r}px ${r}px`,
    boxShadow: look.ring ? `inset 0 -1px 0 ${line}, ${sides}` : look.rule ? `inset 0 -1px 0 ${line}` : '' });
  host.prepend(el);
  const at = ({ x, y, w, h }) => {
    const sx = w / W, rr = Math.min(r, h / 2), cy = rr / r;
    const list = [
      [top, `translate(${x}px, ${y}px) scale(${sx}, ${cy})`],
      [mid, `translate(${x}px, ${y + rr}px) scale(${sx}, ${Math.max(0, h - 2 * rr) / MID})`],
      [bot, `translate(${x}px, ${y + h - rr}px) scale(${sx}, ${cy})`],
    ];
    if (drop) list.push([drop, `translate(${x}px, ${y + h - 48}px) scaleX(${sx})`]);
    return list;
  };
  /** Pin the box at a rect (dragging) or animate it from one rect to another. */
  const set = rect => { for (const [p, t] of at(rect)) p.style.transform = t; };
  const animate = (ctx, a, b, span, easing = EASE) => {
    const A = at(a), B = at(b);
    A.forEach(([p, t], j) => play(ctx, p, [{ transform: t }, { transform: B[j][1] }], span, { easing }));
  };
  return { el, set, animate, remove: () => el.remove() };
}

// ---------- measuring: an element and its parts (words that can travel from one face to the next) ----------
/** Rect of an element (viewport px) and of each [data-part] inside it, local to the element in unscaled px. */
export function measureEl(el, k, withParts = true) {
  const r = el.getBoundingClientRect();
  const m = { el, top: r.top, left: r.left, width: r.width, height: r.height, look: lookOf(el), parts: null, host: el.parentElement, zone: el.parentElement?.className || '' };
  if (!withParts) return m;
  m.parts = new Map();
  for (const p of el.querySelectorAll('[data-part]')) {
    const q = p.getBoundingClientRect();
    const name = p.dataset.part;
    if (m.parts.has(name)) continue;
    m.parts.set(name, { x: (q.left - r.left) / k, y: (q.top - r.top) / k, w: q.width / k, h: q.height / k, text: p.textContent.replace(/\s+/g, ' ').trim(),
      font: name === 'prompt' || name === 'title' ? parseFloat(getComputedStyle(p.matches('[data-part="title"].d-kicker') ? p.querySelector('span') || p : p).fontSize) : 0 });
  }
  return m;
}

/**
 * Put an old node back where it was (unscaled px), inert, without its keys and ids: at the end of its list `host`, absolutely
 * placed and at the same z as the item it belongs to, so whatever passes over the item passes over its old words too.
 */
export function ghostOf(node, rect, k, host, z = 0, h = host.getBoundingClientRect()) {
  for (const x of [node, ...node.querySelectorAll('[data-key], [data-id], [id]')]) { x.removeAttribute('data-key'); x.removeAttribute('data-id'); x.removeAttribute('id'); }
  node.removeAttribute('tabindex');
  for (const a of node.getAnimations?.({ subtree: true }) || []) a.cancel();
  Object.assign(node.style, { position: 'absolute', left: `${(rect.left - h.left) / k}px`, top: `${(rect.top - h.top) / k}px`,
    width: `${rect.width / k}px`, height: `${rect.height / k}px`, margin: '0', transform: '', opacity: '', zIndex: z ? String(z) : '' });
  node.classList.add('d-ghost');
  node.setAttribute('inert', '');
  host.append(node);
  return node;
}

const HARD = new Set(['count', 'why', 'status']); // discrete words: turn over in one frame, never crossfade
/** Scale from the top-left corner. Set as a style, not a keyframe: transform-origin in keyframes keeps it off the compositor. */
const origin = (ctx, el) => { el.style.transformOrigin = '0 0'; ctx.clean(() => { el.style.transformOrigin = ''; }); };
/**
 * One item changes face, and maybe place. Its new element is moved from the old place (FLIP); a box in the old look
 * grows or shrinks into the new size (crossfading into the new look when they differ); parts with the same words slide
 * from their old spot to the new one, scaled when the type size differs (a headline that grows with the card does not
 * reflow mid-way); parts with new words fade in; the old words fade out on a ghost of the old face that rides along.
 *   t = { move, box, parts, out, in, fresh, flip, settle, z, keep, ease }
 *   keep: parts shown at once in their new words (no crossfade); ease: the easing of the move (default EASE)
 * `hostRect` is the list's rect measured with everything else (so nothing here reads layout after the DOM has changed).
 * Every leaf of a list is positioned (d.css), so z-index works without reading styles.
 */
export function morph(ctx, { el, was, now, old, k, t, hostRect }) {
  const dx = (was.left - now.left) / k, dy = (was.top - now.top) / k;
  const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
  const easing = t.ease || EASE;
  if (moved) play(ctx, el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], t.move, { easing });
  if (t.z) { el.style.zIndex = String(t.z); ctx.clean(() => { el.style.zIndex = ''; }); }
  // The box.
  const w0 = was.width / k, h0 = was.height / k, w1 = now.width / k, h1 = now.height / k;
  const A = was.look, B = now.look;
  if ((A || B) && (Math.abs(h0 - h1) > 1 || Math.abs(w0 - w1) > 1 || A?.key !== B?.key)) {
    el.classList.add('is-morphing');
    const W = Math.max(w0, w1), from = { x: 0, y: 0, w: w0, h: h0 }, to = { x: 0, y: 0, w: w1, h: h1 };
    const boxes = [];
    const one = (look, alpha) => { const b = makeBox(el, look, W); b.animate(ctx, from, to, t.box); boxes.push(b); if (alpha) play(ctx, b.el, alpha, t.box, { easing: 'linear' }); };
    if (A && B && A.key !== B.key) {
      one(B, [{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }]);
      one(A, [{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }]);
    } else one(A || B, null);
    ctx.clean(() => { for (const b of boxes) b.remove(); el.classList.remove('is-morphing'); });
  }
  // The old face, riding along with the element, shows only the words that leave.
  const ghost = old ? ghostOf(old, was, k, el.parentElement, t.z, hostRect) : null;
  if (ghost) {
    ghost.classList.add('is-face');
    ghost.style.visibility = 'hidden';
    if (moved) play(ctx, ghost, [{ transform: 'none' }, { transform: `translate(${-dx}px, ${-dy}px)` }], t.move, { easing });
    ctx.clean(() => ghost.remove());
  }
  const seen = new Set();
  for (const p of el.querySelectorAll('[data-part]')) {
    const name = p.dataset.part, o = was.parts?.get(name), n = now.parts?.get(name);
    if (!n || seen.has(name)) continue;
    seen.add(name);
    const g = ghost?.querySelector(`[data-part="${name}"]`);
    if (!o) { play(ctx, p, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], t.fresh); continue; }
    const px = o.x - n.x, py = o.y - n.y, s = o.font && n.font && Math.abs(o.font - n.font) > 0.4 ? o.font / n.font : 1;
    const travels = Math.abs(px) > 0.5 || Math.abs(py) > 0.5 || s !== 1;
    // Same words in a new size: scaled, not reflowed. When the bigger type wraps into more lines, the scaled block would
    // not match the old one; then the old lines ride to the new spot and fade while the new lines arrive.
    const rewraps = o.text === n.text && s !== 1 && Math.abs(o.h - n.h * s) > Math.max(3, o.h * 0.12);
    if ((o.text === n.text && !rewraps) || t.keep?.has(name)) {
      if (travels) { origin(ctx, p); play(ctx, p, [{ transform: `translate(${px}px, ${py}px) scale(${s})` }, { transform: 'none' }], t.parts); }
      continue;
    }
    if (rewraps) {
      origin(ctx, p);
      play(ctx, p, [{ transform: `translate(${px}px, ${py}px) scale(${s})` }, { transform: 'none' }], t.parts);
      play(ctx, p, [{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], t.parts, { easing: 'linear' });
      if (g) {
        g.style.visibility = 'visible';
        origin(ctx, g);
        play(ctx, g, [{ transform: 'none' }, { transform: `translate(${-px}px, ${-py}px) scale(${1 / s})` }], t.parts);
        play(ctx, g, [{ opacity: 1 }, { opacity: 0, offset: 0.45 }, { opacity: 0 }], t.parts, { easing: 'linear' });
      }
      continue;
    }
    if (travels) play(ctx, p, [{ transform: `translate(${px}px, ${py}px)` }, { transform: 'none' }], t.parts);
    if (HARD.has(name)) {
      const at = name === 'count' ? t.flip : t.settle;
      stepAt(ctx, p, at, true);
      if (g) { g.style.visibility = 'visible'; stepAt(ctx, g, at, false); }
    } else {
      play(ctx, p, [{ opacity: 0 }, { opacity: 1 }], t.in, { easing: 'linear' });
      if (g) { g.style.visibility = 'visible'; play(ctx, g, [{ opacity: 1 }, { opacity: 0 }], t.out, { easing: 'linear' }); }
    }
  }
  // Old words with no counterpart leave.
  if (ghost) for (const g of ghost.querySelectorAll('[data-part]')) {
    if (seen.has(g.dataset.part)) continue;
    g.style.visibility = 'visible';
    play(ctx, g, [{ opacity: 1 }, { opacity: 0 }], t.out, { easing: 'linear' });
  }
  return ghost;
}

/** A new element appears in place: a paper cover over it shrinks to its bottom edge (top-down reveal), 0.36 s. */
export function reveal(ctx, el, span) {
  const cover = document.createElement('i');
  cover.className = 'd-cover';
  cover.setAttribute('aria-hidden', 'true');
  el.append(cover);
  play(ctx, cover, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], span);
  play(ctx, el, [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 1 }], span, { easing: 'linear' });
  ctx.clean(() => cover.remove());
}
/** A new element slides out from beneath a fold row (it starts under the row and comes out of its edge). */
export function slideFrom(ctx, el, now, row, k, span) {
  const up = now.top + now.height <= row.top + row.height / 2; // above the row: comes out of its top edge, upwards
  const dy = (up ? row.top + row.height - (now.top + now.height) : row.top - now.top) / k;
  el.style.zIndex = '-1';
  ctx.clean(() => { el.style.zIndex = ''; });
  play(ctx, el, [{ transform: `translateY(${dy}px)`, opacity: 0 }, { opacity: 1, offset: 0.35 }, { transform: 'none', opacity: 1 }], span);
}

/** The headline count turns over: one place a step (the roll says “one fewer”), two or more in one frame. */
export function roll(ctx, el, before, after, at) {
  const a = Number(before), b = Number(after);
  const span = el.querySelector('.d-count');
  if (!span) return;
  const old = document.createElement('span');
  old.className = 'd-count-old';
  old.setAttribute('aria-hidden', 'true');
  old.textContent = before;
  span.append(old);
  ctx.clean(() => old.remove());
  const text = span.firstChild;
  const inner = document.createElement('span');
  inner.className = 'd-count-new';
  inner.textContent = text?.nodeValue ?? after;
  if (text) text.replaceWith(inner);
  ctx.clean(() => { if (inner.isConnected) inner.replaceWith(document.createTextNode(inner.textContent)); });
  if (Math.abs(a - b) === 1) {
    const dir = b < a ? 1 : -1;
    play(ctx, inner, [{ transform: `translateY(${0.62 * dir}em)`, opacity: 0 }, { transform: 'none', opacity: 1 }], [at, 0.26]);
    play(ctx, old, [{ transform: 'none', opacity: 1 }, { transform: `translateY(${-0.62 * dir}em)`, opacity: 0 }], [at, 0.26]);
  } else { stepAt(ctx, inner, at, true); stepAt(ctx, old, at, false); }
}

/** The 64-cell band under the 累计 bar: each item a run of cells in first-seen order; a 整理 landing rescales them once. */
export function band(ctx, el, segments, width, span) {
  const cell = width / 64, gap = 1;
  const transformOf = (from, share) => `translateX(${(from * cell).toFixed(2)}px) scaleX(${Math.max(0, (share * cell - gap) / cell).toFixed(4)})`;
  const old = new Map([...el.children].map(c => [c.dataset.seg, c]));
  el.style.setProperty('--cell', `${cell.toFixed(3)}px`);
  for (const seg of segments) {
    let node = old.get(seg.id);
    old.delete(seg.id);
    const next = transformOf(seg.from, seg.share);
    if (!node) {
      node = document.createElement('i');
      node.dataset.seg = seg.id;
      el.append(node);
      if (span) play(ctx, node, [{ transform: transformOf(seg.from, 0) }, { transform: next }], span);
    } else if (node.__t !== next && span) play(ctx, node, [{ transform: node.__t }, { transform: next }], span);
    node.__t = next;
    node.__from = seg.from;
    node.style.transform = next;
  }
  for (const [, node] of old) {
    if (!span) { node.remove(); continue; }
    play(ctx, node, [{ transform: node.__t }, { transform: transformOf(node.__from || 0, 0) }], span);
    ctx.clean(() => node.remove());
  }
}

/** The grain at the 累计 bar's left draws together once a 整理 lands: 1–3 line pitches, more inputs more. */
export function gather(ctx, el, inputs, span, h = 48) {
  if (!inputs) return;
  const k = Math.max(1, Math.min(3, Math.round(1 + 2 * (Math.log(inputs) - Math.log(54)) / (Math.log(234) - Math.log(54)))));
  play(ctx, el, [{ transform: `scaleY(${((h + 3 * k) / h).toFixed(4)})` }, { transform: 'none' }], span);
}
