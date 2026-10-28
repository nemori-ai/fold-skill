// E · 折叠屏的几何与节拍。编排（什么时候动哪一组）在 duo.mjs；这里只放尺寸、铰链阈值、开合（FOLD：前板怎样随铰链翻、
// 糊、暗）、各拍的时间表与几个小部件。
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
/** ?hinge= is the hinge as a fraction of the whole turn: 0 closed, 0.5 the panel edge-on, 1 flat. */
export const angleAt = h => Math.max(0, Math.min(1, h)) * HINGE.flat;

const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = x => { const t = clamp01(x); return t * t * (3 - 2 * t); };
/**
 * The unfold, after the iPhone Duo's own (duo-motion.md 1.2, 3.3). It follows the hinge, frame by frame; there is no timer.
 * The panel that carries the outer screen turns about the crease, toward you and to the left: rotateY(-θ) for a hinge of
 * θ°, so half way its free edge comes at you and looks taller, then it lies down as the left page. The right page under
 * it does not move a pixel: it is the same page, the same size, in the same place (content pinned in space).
 *   camera  perspective P (pt); its x goes from the outer screen's centre (closed) to the crease (flat), so the picture
 *           re-centres on the spread as it opens; its y a little above the middle (eye: a phone held below the eyes),
 *           which also keeps the page that comes at you more within the window above.
 *   front   the outer screen on the panel's face, seen until it stands edge-on (90°; then the panel shows its back).
 *           Clear and opaque until the inner screen takes over (20°); then frosted glass: a blurred copy masked in from the
 *           free edge toward the crease (all but the strip by the crease by 54°), a paper frost, the face fading evenly to
 *           nothing by 88° (so the board never vanishes mid-turn) — a window onto the same page below.
 *   back    the inner screen's left page. Blur grows with the distance from the crease as u³ (u = distance over a page
 *           width; empirical.health: sharp by the hinge, ~48 px @3x at the free edge, an eighth of that half way) and
 *           shrinks with the angle: 16 pt at the free edge while the page stands edge-on (90°), none by 175°. It is drawn
 *           with three copies at fixed radii, each masked in where the wanted blur passes half way to its radius, so only
 *           transforms and opacities change per frame. A veil, dark at the free edge and light by the crease, sweeps off
 *           the page between 88° and 168°: the page clears from the crease outward, and darkens back from the free edge
 *           toward the crease when it folds.
 *   band    the 64-cell band (its boundary on the crease) grows from the crease to both sides between 120° (the spread is
 *           reported) and 170° (no longer half-folded).
 */
export const FOLD = {
  P: 2000, eye: 0.22,
  front: { clear: HINGE.takeover, gone: 88, blur: 10, frost: 0.5, reach: 0.9 },
  back: { radii: [2.5, 7, 14], Bmax: 16, from: 90, clear: 175, soft: 44 },
  veil: { from: 88, gone: 168, dark: 0.9, edge: [0.92, -0.36] },
  band: [HINGE.stable, HINGE.half],
};
/** Everything the fold draws at a hinge of `theta` degrees (pure: the stills and the checks read the same numbers). */
export function foldAt(theta) {
  const a = Math.max(0, Math.min(HINGE.flat, theta)), F = FOLD;
  const camX = G.crease + (G.PW / 2) * (1 - smooth(a / HINGE.flat));
  const p = clamp01((a - F.front.clear) / (F.front.gone - F.front.clear));
  // cut: x on the face (from its crease side) where the blurred copy begins
  const front = { alpha: 1 - p, frost: F.front.frost * smooth(p * 2), cut: G.S * (1 - F.front.reach * smooth(p * 2)) };
  const s = clamp01((a - F.back.from) / (F.back.clear - F.back.from));
  const Bmax = F.back.Bmax * (1 - s) ** 1.5;
  const radii = F.back.radii, mids = radii.map((r, i) => (r + (i ? radii[i - 1] : 0)) / 2);
  // u where each copy takes over (Infinity: not at all); cut: the same on the back face's x (0 the free edge, PW the crease)
  const layers = mids.map(m => { const u = Bmax > 0.01 ? Math.cbrt(m / Bmax) : Infinity; return { u, cut: (1 - u) * G.PW, on: u < 1 + F.back.soft / G.PW }; });
  const v = clamp01((a - F.veil.from) / (F.veil.gone - F.veil.from));
  const veil = { edge: G.PW * (F.veil.edge[0] + (F.veil.edge[1] - F.veil.edge[0]) * smooth(v)), alpha: v < 1 ? F.veil.dark * (1 - 0.45 * v) : 0 };
  const band = smooth((a - F.band[0]) / (F.band[1] - F.band[0]));
  return { a, camX, front, Bmax, layers, veil, band };
}
/** The hand's pace (minimum jerk: how a hand moves from rest to rest). */
export const minJerk = t => { const x = clamp01(t); return x * x * x * (10 - 15 * x + 6 * x * x); };

/**
 * Settle: once, when the spread is reported (0.40 s), on the right page only (the left page is the panel's back, pinned
 * where it lands; the band grows with the hinge, FOLD.band): the right halves compact, the 累计 bar sinks away, the folded
 * asks fan out, the note rises, 件 turns to 份. Fold back: the settle backwards, faster (0.28 s). [start, duration]
 */
export const SETTLE = { compact: [0, 0.28], ledger: [0, 0.20], minis: [0.08, 0.28], rows: [0.12, 0.24], hero: 0.22, total: 0.40 };
export const UNSETTLE = { hero: 0.06, minis: [0, 0.20], expand: [0.06, 0.22], total: 0.28 };
/** A release (or F, a posture button) moves the hinge on to the nearest posture: 0.36 s for half a turn, ease-out. */
export const SNAP = { half: 0.36, min: 0.14 };
/** The tell (and unfold() / fold()): the hinge at the pace of a hand (the keynote's 2.2 s for the whole turn, a little
 * quicker here), minimum jerk: it starts and lands softly, fastest when the panel stands edge-on. */
export const HAND = { open: 1.5, close: 1.1, ease: minJerk };

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
