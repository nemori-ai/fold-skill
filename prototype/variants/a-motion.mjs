// A · 空间排布的动画部件。编排（谁在哪一组、什么时候动）在 a.mjs 的 render()；这里只管“一组怎么动”：
// 节拍表、左栏按节拍重排（beatList：离场、移位、换脸、进场、回执填实）、回执飞向它的纸片（fly）、
// 上一轮的轮廓（traces，概念层）、数字在节拍上翻（flipHTML）。桌面纸片的移动交给 spatial-kit.mjs 的
// createFlipBoard，a.mjs 用它的 timing 选项把每张纸排进同一张节拍表。
// 时刻以秒计，与 forms/polish/a-motion.md 第 3 节（故事）与第 5 节（实现）的时间表一一对应。
// 全部是 Web Animations：一拍里创建的动画都挂在同一个 ctx 上，停表（悬停、讲一遍）与定格（foldA.beatAt）一起作用。

/** Ease-out, critically damped: what you are reading never overshoots. */
export const EASE = 'cubic-bezier(.2,.75,.25,1)';
/** The protagonist is carried, not thrown: ease in and out. */
export const EASE_IN_OUT = 'cubic-bezier(.45,0,.25,1)';

/**
 * Beats: [start, duration] in seconds from the cut.
 *   self     the card whose face your own press changed: old words out, box to its new height, new words in
 *   receipt  a receipt that the 整理 has read turns solid
 *   hero     the numbers turn over (the desk's blank, the counts); flip = a fold row's count
 *   lead     the protagonists of a 整理 landing (what you answered, what lapsed); fly = your receipt travels to its paper
 *   move     everything else that stays and moves; swap = words that change on a paper or card that stays
 *   trace    the concept layer: last round's outlines, gone by this time (exits keep theirs until traceGone)
 */
export const BEATS = {
  turn: { receipt: [0, 0.30], hero: 0.40, flip: 0.40, exit: [0.40, 0.24], merge: [0.40, 0.40], lead: [0.40, 0.48], leadStep: 0.06,
    fly: [0.40, 0.48], move: [0.48, 0.32], swap: [0.56, 0.24], enter: [0.60, 0.36], trace: [0.70, 0.40], traceGone: [0.90, 0.20],
    glow: 0.96, settle: 0.80, end: 1.10 },
  answer: { self: { out: [0, 0.12], box: [0, 0.20], in: [0.10, 0.20] }, paper: [0.10, 0.20], hero: 0.20, flip: 0.36,
    move: [0.20, 0.32], swap: [0.20, 0.32], enter: [0.36, 0.36], exit: [0.36, 0.24], guard: 1.12, end: 0.72 },
  undo: { self: { out: [0.15, 0.10], box: [0.15, 0.20], in: [0.15, 0.20] }, paper: [0.15, 0.20], hero: 0.15, flip: 0.15,
    move: [0.10, 0.20], swap: [0.10, 0.20], enter: [0.15, 0.20], exit: [0, 0.15], end: 0.40 },
  snooze: { self: { out: [0, 0.14], box: [0.20, 0.32], in: [0.20, 0.32] }, paper: [0.10, 0.20], hero: 0.20, flip: 0.36,
    move: [0.20, 0.32], swap: [0.20, 0.32], enter: [0.36, 0.36], exit: [0.20, 0.24], end: 0.72 },
  // Everything else a finger or key changes in place (open the fold, a panel, compare): together, short.
  local: { self: { out: [0, 0.10], box: [0, 0.24], in: [0.06, 0.20] }, paper: [0.06, 0.24], hero: 0, flip: 0,
    move: [0, 0.28], swap: [0.06, 0.22], enter: [0.08, 0.28], exit: [0, 0.18], end: 0.40 },
};
export const STAGGER = 0.04, STAGGER_MAX = 8;

const ms = s => Math.max(0, Math.round(s * 1000));

/** One beat's animations, so they can be held, pinned and finished together. `scale` slows the whole beat (慢速 ×3). */
export function createBeat(name, scale = 1) {
  const anims = new Set();
  const B = BEATS[name] || BEATS.local;
  const ctx = {
    name, B, scale, anims, born: performance.now(),
    add(a) { if (a) { anims.add(a); a.addEventListener?.('finish', () => anims.delete(a)); } return a; },
    /** [start, dur] → WAAPI timing in this beat's clock. */
    at: (span, extra = 0) => ({ delay: ms(span[0] * scale) + extra, duration: Math.max(1, ms(span[1] * scale)) }),
    t: s => ms(s * scale),
  };
  return ctx;
}

/** One animation on the beat's clock; the start state holds through the delay (fill both). */
export function play(ctx, el, keys, span, { easing = EASE, fill = 'both', extra = 0 } = {}) {
  if (!el || !ctx) return null;
  const timing = Array.isArray(span) ? ctx.at(span, extra) : span;
  return ctx.add(el.animate(keys, { ...timing, easing, fill }));
}

/** Turn over in one frame at `at` seconds: hidden until then (show), or shown until then (hide). */
export function stepAt(ctx, el, at, show) {
  if (!el || !ctx) return null;
  const d = Math.max(1, ctx.t(at));
  return ctx.add(el.animate(show ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
    { duration: d, easing: 'steps(1, end)', fill: show ? 'backwards' : 'forwards' }));
}

// ---------- the column: cards and rows keyed by item, re-rendered in place ----------
const rectIn = (el, box) => { const r = el.getBoundingClientRect(); return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height, vx: r.left, vy: r.top }; };
function ghostOf(container, item) {
  const ghost = item.clone;
  ghost.classList.add('a-ghost');
  ghost.removeAttribute('data-flip-key');
  ghost.querySelectorAll('[data-flip-key]').forEach(node => node.removeAttribute('data-flip-key'));
  ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, { position: 'absolute', left: `${item.x}px`, top: `${item.y}px`, width: `${item.w}px`, height: `${item.h}px`, margin: '0', pointerEvents: 'none', zIndex: '3', boxSizing: 'border-box' });
  container.append(ghost);
  return ghost;
}
const gone = (ctx, el, a) => { if (a) a.addEventListener('finish', () => el.remove()); else el.remove(); };

/**
 * Re-render a list and play it by the beat. Elements carrying data-flip-key keep their identity across renders:
 *   data-face   what the element is (a card, a receipt, a row): a different face is the same box changing
 *   data-step   'hero' | 'flip': its words turn over in one frame at that beat instead of moving
 *   data-status a receipt's status; saved → acknowledged turns it solid in the receipt beat
 * opts: self (the key your own press changed), lead (keys that are a 整理's protagonists), origin(key) → where an
 * entering element slides out of (container px), carry(key, before) → true when a leaving receipt is handed to fly().
 * Returns the leaving elements that were carried (their clones), so the caller can fly them.
 */
export function beatList(container, render, { ctx = null, self = null, lead = new Set(), origin = null, carry = null } = {}) {
  if (!ctx || !container.isConnected) { render(); return []; }
  const B = ctx.B, box = container.getBoundingClientRect();
  const before = new Map();
  for (const el of container.querySelectorAll('[data-flip-key]')) {
    if (el.closest('.a-ghost')) continue;
    before.set(el.dataset.flipKey, { ...rectIn(el, box), face: el.dataset.face || '', status: el.dataset.status || '', step: el.dataset.step || '', clone: el.cloneNode(true) });
  }
  render();
  const box2 = container.getBoundingClientRect();
  const seen = new Set(), carried = [];
  let entering = 0;
  for (const el of container.querySelectorAll('[data-flip-key]')) {
    if (el.closest('.a-ghost')) continue;
    const key = el.dataset.flipKey, old = before.get(key), now = rectIn(el, box2);
    seen.add(key);
    // Counts and fold rows: the words turn over in one frame on their beat.
    if (el.dataset.step) {
      const moved = old && (Math.abs(old.y - now.y) > 0.5 || Math.abs(old.x - now.x) > 0.5);
      if (old && old.face !== (el.dataset.face || '')) {
        // The old words ride along with the box until their beat, so the turn-over happens where the box is then.
        const at = el.dataset.step === 'hero' ? B.hero : B.flip;
        const ghost = ghostOf(container, old);
        if (moved) play(ctx, ghost, [{ transform: 'none' }, { transform: `translate(${now.x - old.x}px,${now.y - old.y}px)` }], B.move, { fill: 'forwards' });
        gone(ctx, ghost, stepAt(ctx, ghost, at, false));
        stepAt(ctx, el, at, true);
      }
      if (moved) play(ctx, el, [{ transform: `translate(${old.x - now.x}px,${old.y - now.y}px)` }, { transform: 'none' }], B.move);
      continue;
    }
    if (!old) {
      // New: out of the fold row it was folded into (or settle in place), staggered.
      const from = origin?.(key);
      const dy = from ? from.y - now.y : 6;
      const k = Math.min(entering++, STAGGER_MAX - 1);
      play(ctx, el, [{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: 'none' }], B.enter, { extra: ctx.t(k * STAGGER) });
      if (from && now.h > 8) play(ctx, el, [{ clipPath: `inset(0px 0px ${Math.max(0, now.h - Math.min(now.h, from.h || 0))}px 0px)` }, { clipPath: 'inset(0px 0px 0px 0px)' }], B.enter, { extra: ctx.t(k * STAGGER) });
      continue;
    }
    const dx = old.x - now.x, dy = old.y - now.y, grow = now.h - old.h;
    const faced = old.face !== (el.dataset.face || '');
    const mine = key === self;
    const span = lead.has(key) ? B.lead || B.move : B.move;
    if (faced) {
      // The same box changes face: the old words fade where they stood while the box takes its new height.
      const t = mine && B.self ? B.self : { out: [B.swap[0], B.swap[1] * 0.5], box: span, in: [B.swap[0] + B.swap[1] * 0.3, B.swap[1] * 0.7] };
      const ghost = ghostOf(container, old);
      gone(ctx, ghost, play(ctx, ghost, [{ opacity: 1 }, { opacity: 0 }], t.out, { easing: 'linear', fill: 'forwards' }));
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        play(ctx, ghost, [{ transform: 'none' }, { transform: `translate(${-dx}px,${-dy}px)` }], t.box, { fill: 'forwards' });
        play(ctx, el, [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], t.box);
      }
      play(ctx, el, [{ opacity: 0 }, { opacity: 1 }], t.in, { easing: 'linear' });
      if (grow > 0.5) play(ctx, el, [{ clipPath: `inset(0px 0px ${grow}px 0px)` }, { clipPath: 'inset(0px 0px 0px 0px)' }], t.box);
      continue;
    }
    if (old.status === 'saved' && el.dataset.status === 'acknowledged' && B.receipt) {
      // What you pressed is confirmed first: the receipt turns solid before anything else moves.
      const mark = el.querySelector('.a-ask-answer') || el;
      play(ctx, mark, [{ opacity: 0.45 }, { opacity: 1 }], B.receipt, { easing: 'linear' });
      const tick = el.querySelector('.a-tick');
      if (tick) play(ctx, tick, [{ transform: 'scale(1.35)' }, { transform: 'none' }], B.receipt);
    }
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(grow) < 0.5) continue;
    play(ctx, el, [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], span, { easing: lead.has(key) ? EASE_IN_OUT : EASE });
    if (grow > 0.5) play(ctx, el, [{ clipPath: `inset(0px 0px ${grow}px 0px)` }, { clipPath: 'inset(0px 0px 0px 0px)' }], span);
  }
  for (const [key, old] of before) {
    if (seen.has(key)) continue;
    if (carry?.(key, old)) { carried.push({ key, ...old }); continue; }
    const ghost = ghostOf(container, old);
    gone(ctx, ghost, play(ctx, ghost, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.98)' }], B.exit, { easing: 'ease-in', fill: 'forwards' }));
  }
  return carried;
}

/**
 * A receipt leaves the column and lands on its paper. `item` is a carried clone from beatList (with its viewport rect),
 * `to` the paper's final rect in viewport px. The clone turns solid first (receipt beat), then travels on the fly beat,
 * shrinking toward the paper's first line, and fades into it over the last third.
 */
export function fly(ctx, layer, item, to, { solid = null } = {}) {
  const B = ctx.B, el = item.clone;
  el.classList.add('a-ghost', 'a-flying');
  el.removeAttribute('data-flip-key');
  el.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  el.inert = true;
  el.setAttribute('aria-hidden', 'true');
  if (solid) solid(el);
  Object.assign(el.style, { position: 'fixed', left: `${item.vx}px`, top: `${item.vy}px`, width: `${item.w}px`, height: `${item.h}px`, margin: '0', transformOrigin: '0 0' });
  layer.append(el);
  const mark = el.querySelector('.a-ask-answer');
  if (mark) play(ctx, mark, [{ opacity: 0.45 }, { opacity: 1 }], B.receipt, { easing: 'linear' });
  const width = Math.max(40, Math.min(to.w - 20, item.w * 0.62)), s = width / item.w;
  const tx = to.x + 10 - item.vx, ty = to.y + 8 - item.vy;
  const [a, d] = B.fly;
  const travel = play(ctx, el, [
    { transform: 'none', opacity: 1, offset: 0 },
    { transform: `translate(${tx * 0.66}px,${ty * 0.66}px) scale(${1 - (1 - s) * 0.66})`, opacity: 1, offset: 0.66 },
    { transform: `translate(${tx}px,${ty}px) scale(${s})`, opacity: 0, offset: 1 },
  ], [a, d], { easing: EASE_IN_OUT, fill: 'both' });
  gone(ctx, el, travel);
  return travel;
}

/** The concept layer: a grey outline where each paper that moves or leaves stood last round, gone when the turn settles. */
export function traces(ctx, layer, plan, { left = 0, top = 0 } = {}) {
  if (!plan || !ctx) return 0;
  const B = ctx.B, end = B.trace[0] + B.trace[1], endGone = B.traceGone[0] + B.traceGone[1];
  const moved = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height) > 3;
  const list = [...plan.moves.filter(m => moved(m.from, m.to)).map(m => ({ r: m.from, gone: false })), ...plan.exits.filter(e => !e.merged).map(e => ({ r: e.from, gone: true }))];
  for (const { r, gone: isGone } of list) {
    const el = document.createElement('i');
    el.className = `a-trace${isGone ? ' is-gone' : ''}`;
    Object.assign(el.style, { left: `${left + r.x}px`, top: `${top + r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    layer.append(el);
    const total = isGone ? endGone : end, hold = isGone ? B.traceGone[0] : B.trace[0];
    const a = play(ctx, el, [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.07 / total }, { opacity: 1, offset: hold / total }, { opacity: 0, offset: 1 }], [0, total], { easing: 'linear', fill: 'forwards' });
    gone(ctx, el, a);
  }
  return list.length;
}

/**
 * Words that turn over on a beat: the old ones stay until `at`, then the new ones (a one-step roll when `roll`).
 * `el` already holds the new words; `oldHTML` is laid over them until the turn.
 */
export function flipHTML(ctx, el, oldHTML, at, { roll = false } = {}) {
  if (!ctx || !el || oldHTML == null || oldHTML === el.innerHTML) return;
  const old = document.createElement('span');
  old.className = 'a-flip-old';
  old.setAttribute('aria-hidden', 'true');
  old.innerHTML = oldHTML;
  const inner = [...el.childNodes];
  const wrap = document.createElement('span');
  wrap.className = 'a-flip-new';
  inner.forEach(node => wrap.append(node));
  el.classList.add('a-flipping');
  el.append(wrap, old);
  // Afterwards the element holds its own words again, unwrapped (the next turn wraps them anew).
  const done = () => {
    if (!old.isConnected) return;
    old.remove();
    while (wrap.firstChild) el.insertBefore(wrap.firstChild, wrap);
    wrap.remove();
    el.classList.remove('a-flipping');
  };
  if (roll) {
    play(ctx, wrap, [{ transform: 'translateY(.9em)', opacity: 0 }, { transform: 'none', opacity: 1 }], [at, 0.26]);
    const a = play(ctx, old, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-.9em)', opacity: 0 }], [at, 0.26], { fill: 'forwards' });
    a?.addEventListener('finish', done); a?.addEventListener('cancel', done);
  } else {
    stepAt(ctx, wrap, at, true);
    const a = stepAt(ctx, old, at, false);
    a?.addEventListener('finish', done); a?.addEventListener('cancel', done);
  }
}
