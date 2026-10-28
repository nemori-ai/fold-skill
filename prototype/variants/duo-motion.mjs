// E · 折叠屏的几何与节拍。编排（什么时候动哪一组）在 duo.mjs；这里只放尺寸、铰链阈值、各拍的时间表与几个小部件。
// 时刻以秒计，与 forms/polish/duo-motion.md 第 3 节（故事）一一对应；“一组怎么动”的部件（同一个盒子换脸、揭开、
// 份额细带缩放）直接用 D 的 d-motion.mjs，不另写一份。
import { EASE, play } from './d-motion.mjs';

/**
 * Sizes in points (duo-motion.md 1.1, assumed @3x, 未证实): the outer screen, one page of the inner screen, the inner
 * screen's height. The inner screen is two pages side by side; the outer screen is the right page (it stays in your hand),
 * right-aligned with it. rail: the system strip on the right edge; gut: a page's side margin; gap: the paper between the
 * two halves of a stripe on a flat spread (it sits in the folding region, so nothing there can be pressed).
 */
export const G = { S: 466, L: 678, PW: 475.5, PH: 669, rail: 56, gut: 12, gap: 24, top: 14 };
G.W = 2 * G.PW;                 // the inner screen's width (951)
G.OX = G.W - G.S;               // where the outer screen sits on the inner screen's coordinates (485)
G.crease = G.PW;                // the fold, on the inner screen
G.cell = (G.PW - 2 * G.gut) / 64; // one share of the 64-cell band: the band is one page wide

/**
 * The hinge, in degrees (0 closed, 180 flat). The browser has no hinge: it is a dragged handle, [ ], F or ?hinge=.
 * takeover: the inner screen lights; stable: the system reports the spread (the settle runs once); back: folding back
 * past this undoes the settle (hysteresis, so a hand resting near 120° does not flicker); half: below this a spread is
 * half-folded and the halves step away from the crease (ReservedRegion .division). Constants until measured on a device.
 */
export const HINGE = { takeover: 20, stable: 120, back: 110, half: 170, flat: 180 };
/** Reveal progress h (0 at takeover, 1 at stable) from an angle, and back. */
export const revealOf = angle => Math.max(0, Math.min(1, (angle - HINGE.takeover) / (HINGE.stable - HINGE.takeover)));
export const angleOf = h => HINGE.takeover + Math.max(0, Math.min(1, h)) * (HINGE.stable - HINGE.takeover);
/** The handle's x on the inner screen: on the outer screen's left edge when closed, on the inner screen's left edge when flat. */
export const handleX = angle => G.OX * (1 - Math.max(0, Math.min(180, angle)) / 180);
export const angleAtX = x => Math.max(0, Math.min(180, (1 - x / G.OX) * 180));

/**
 * Reveal (follows the hinge, no timer). Each card's left half is a window whose right edge stays by the crease and whose
 * left edge travels from the crease to the page margin; the content is pinned at its final place. The window's content
 * goes from dark to clear by h = 0.6 (opacity only: blurred text reads as dirt); the card's Agent parts slide 18 pt toward
 * the crease and fade by the same h. Nothing crosses the fold.
 */
export const REVEAL = { leave: 0.6, drift: 18, alpha0: 0.25 };
export const edgeAt = h => (G.PW - G.gut - G.gap / 2 + G.gut) - Math.max(0, Math.min(1, h)) * (G.PW - G.gap / 2 - G.gut);
export const revealAlpha = h => Math.min(1, REVEAL.alpha0 + (h / REVEAL.leave) * (1 - REVEAL.alpha0));
export const leaveOf = h => Math.min(1, h / REVEAL.leave);

/** Settle: once, when the spread is reported (0.40 s). Fold back: the settle backwards, faster (0.28 s). [start, duration] */
export const SETTLE = { compact: [0, 0.28], ledger: [0, 0.20], minis: [0.08, 0.28], rows: [0.12, 0.24], hero: 0.22, band: [0.20, 0.20], total: 0.40 };
export const UNSETTLE = { band: [0, 0.10], hero: 0.06, minis: [0, 0.20], rows: [0, 0.16], expand: [0.06, 0.22], ledger: [0, 0.14], total: 0.28 };
/** A release (or F, a posture button) moves the hinge on to the nearest posture: 0.36 s for half a turn, ease-out. */
export const SNAP = { half: 0.36, min: 0.14 };
/** The tell: the hinge at the pace of a hand (the keynote's 2.2 s for the whole turn, a little quicker here). */
export const HAND = { open: 1.5, close: 1.1 };

/**
 * On the spread, the beats are morph tables for d-motion's morph(): move, box, parts, out, in, fresh, flip, settle.
 * answer: the right half folds into a receipt in place; the stripe keeps its height, so nothing below moves.
 * undo: backwards, 0.30 s. land: the next 整理 — the receipt fills, the count turns, the answered stripe goes over the fold
 * to the Agent's page in one diagonal (receipt) and one vertical (left half) stroke, the rest move once, new asks arrive.
 */
export const BOOK = {
  answer: { self: { move: [0, 0.20], box: [0, 0.20], parts: [0, 0.20], out: [0, 0.12], in: [0.10, 0.20], fresh: [0.10, 0.20], flip: 0.20, settle: 0.30 },
    hero: 0.20, band: [0.20, 0.20], total: 0.40 },
  undo: { self: { move: [0, 0.18], box: [0, 0.18], parts: [0, 0.18], out: [0, 0.10], in: [0.10, 0.18], fresh: [0.10, 0.18], flip: 0.10, settle: 0.20 },
    hero: 0.10, band: [0.10, 0.20], total: 0.30 },
  land: { receipt: [0, 0.30], hero: 0.30, lead: [0.30, 0.40], lapse: [0.28, 0.12], move: [0.34, 0.36], enter: [0.46, 0.36], exit: [0.28, 0.14],
    band: [0.30, 0.40], glow: 0.80, total: 1.0 },
  local: { move: [0, 0.32], box: [0, 0.32], parts: [0, 0.32], out: [0, 0.14], in: [0.08, 0.20], fresh: [0.10, 0.22], flip: 0, settle: 0.32, enter: [0, 0.36], exit: [0, 0.24] },
};
/** The left page's detail grows out of the half you tapped (0.48 s) and shrinks back into it (0.36 s). */
export const DETAIL = { dim: 0.15, pop: [0, 0.12], frame: [0.12, 0.24], content: [0.30, 0.18], total: 0.48 };
export const UNDETAIL = { content: [0, 0.10], frame: [0.06, 0.24], total: 0.36 };
/** Book ↔ tabletop: the system turns the screen; the old layout fades out, the columns come in one by one (0.36 s). */
export const TURN = { out: [0, 0.16], in: [0.12, 0.24], stagger: 0.04 };

/**
 * The 64-cell band, one page wide, its boundary on the crease: your cells (open asks, then the answers the Agent has not
 * read yet, hollow) to the right of the crease, the Agent's cells and the spare ones to the left. Returns segments for
 * d-motion's band() (from = cells from the band's origin, 64 cells left of the crease) and each segment's kind.
 */
export function bandSegments({ open, pending, agent, blank }) {
  const segs = [];
  let x = 64;
  for (const item of pending) { segs.push({ id: item.id, from: x, share: item.share, kind: 'is-hollow' }); x += item.share; }
  for (const item of open) { segs.push({ id: item.id, from: x, share: item.share, kind: 'is-you' }); x += item.share; }
  x = 64;
  for (const item of agent) { x -= item.share; segs.push({ id: item.id, from: x, share: item.share, kind: 'is-agent' }); }
  if (blank > 0) { x -= blank; segs.push({ id: 'blank', from: x, share: blank, kind: 'is-blank' }); }
  return segs;
}

/** A timed tween of the hinge, driven by requestAnimationFrame (the hinge has no element of its own to animate). */
export function tween(from, to, seconds, onFrame, onDone, ease = t => 1 - (1 - t) ** 3) {
  const start = performance.now(), dur = Math.max(1, seconds * 1000);
  let id = 0, live = true;
  const step = now => {
    if (!live) return;
    const t = Math.min(1, (now - start) / dur);
    onFrame(from + (to - from) * ease(t));
    if (t < 1) id = requestAnimationFrame(step); else { live = false; onDone?.(); }
  };
  id = requestAnimationFrame(step);
  return { cancel: () => { live = false; cancelAnimationFrame(id); }, get live() { return live; } };
}

/** Fade an element in or out on the beat's clock, with an optional rise (px). */
export function fade(ctx, el, show, span, rise = 0) {
  if (!el) return;
  const a = { opacity: 0, transform: rise ? `translateY(${rise}px)` : 'none' }, b = { opacity: 1, transform: 'none' };
  play(ctx, el, show ? [a, b] : [b, a], span, { easing: EASE });
}
