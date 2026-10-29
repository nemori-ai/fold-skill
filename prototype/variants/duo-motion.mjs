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
  return { a, camX, front, Bmax, layers, veil, band, body: bodyAt(a) };
}

/**
 * The body (duo-motion.md 3.7): iPhone Duo's own, measured off Apple's face-on Newsroom renders (3840 px, 18.47 px/mm) and
 * drawn here at the screens' scale, 6.03 pt/mm. Nothing of it is a picture: the rims, bezels, keys and the hinge are CSS
 * boxes, the free edge's thickness a strip and twelve facets in the panel's 3D context. Device coordinates (pt), the inner
 * screen's top-left at 0, 0.
 *   T       one half's thickness, 5.2 mm. The panel's two faces sit T apart; the free edge joins them.
 *   side    the free edge to the inner screen, 3.36 mm (rim 5.2, lip 2.3, bezel 9.4, black 3.3)
 *   top / bottom  the body is 710 tall (117.8 mm). The screens are top-aligned (the outer one is 9 pt taller), so the
 *           border is 18 above both, 23 below the inner screen and 14 below the outer one.
 *   spine   the closed body reaches this far past the crease on the hinge side (83.5 mm wide closed)
 *   R / Rh  the body's corners at the free edges (12.3 mm) / the closed body's on the hinge side
 *   corners every screen's corners, concentric with the body's (BODY.corners below): a screen corner is the body's
 *           corner less the border on each side, [x, y] (an ellipse where the side and the top border differ). On the
 *           Newsroom render lying flat the body's corner is 230 px, the border 62 px and the screen's corner 167 px,
 *           75 − 20 = 55 pt (duo-motion.md 3.7). The system rail moves in from the corner instead (3.6)
 *   ink     the black border of a panel before its pixels
 *   keys    on the half that stays in your hand: two on its top edge, one on its free edge and a flush one under it
 *           (x or y ranges in device pt); rise is how far they stand out (0.5 mm)
 *   marks   the antenna breaks in the rim: along the top and bottom (x) and down the free edges (y)
 *   facets  how many flat strips round each free corner of the panel's edge
 */
export const BODY = {
  T: 31, side: 20, top: 18, bottom: 23, spine: 8, R: 74, Rh: 24, ink: 3.3,
  keys: { top: [[701, 766], [781, 846]], side: [179, 297], flush: [458, 536], rise: 3 },
  marks: { x: [69, 380, 565, 874], y: [71, 596], w: 7.5 },
  facets: 6,
};
BODY.y0 = -BODY.top;                 // the body's top edge
BODY.H = G.PH + BODY.top + BODY.bottom; // 710
BODY.L = G.PW + BODY.side;           // one half, crease to free edge (495.5)
BODY.x0 = -BODY.side;                // the open body's left edge
BODY.x1 = G.W + BODY.side;           // its right edge, the free edge of the half you hold (971)
/** A screen corner concentric with a body corner of radius R, the borders bx (left or right) and by (top or bottom). */
const cc = (R, bx, by) => [Math.max(0, R - bx), Math.max(0, R - by)];
{
  const B = BODY, R = B.R, closedX = G.crease - B.spine, low = B.y0 + B.H; // the closed body's hinge-side edge; the body's lower edge
  const tx = G.PH - low, free = B.x1 - G.W; // the tabletop body's left edge (the book's lower edge turned), the free border
  B.corners = {
    // the inner screen in the open body: 20 at the sides, 18 above, 23 below → 54 / 56 above, 54 / 51 below
    inner: { tl: cc(R, B.side, B.top), tr: cc(R, B.side, B.top), br: cc(R, B.side, low - G.PH), bl: cc(R, B.side, low - G.PH) },
    // the outer screen in the closed body: the free side as the inner screen's, the hinge side against its tighter corner
    outer: { tl: cc(B.Rh, G.OX - closedX, B.top), tr: cc(R, free, B.top), br: cc(R, free, low - G.L), bl: cc(B.Rh, G.OX - closedX, low - G.L) },
    // the tabletop: the open body turned a quarter clockwise (its lower border on the left, its top border on the right)
    table: { tl: cc(R, -tx, -B.x0), tr: cc(R, tx + B.H - G.PH, -B.x0), br: cc(R, tx + B.H - G.PH, free), bl: cc(R, -tx, free) },
  };
}
/** Corners as CSS (`x x x x / y y y y`): `list` is [tl, tr, br, bl], each a corner [x, y], a number or 0. */
export function radius(list, grow = 0) {
  const xy = list.map(c => (Array.isArray(c) ? c : [c, c]).map(v => (v ? v + grow : 0)));
  const f = v => `${Math.round(v * 100) / 100}px`;
  return `${xy.map(c => f(c[0])).join(' ')} / ${xy.map(c => f(c[1])).join(' ')}`;
}
/** Named corner sets for the page (CSS variables on the device): the screens, the pages, the halves of the tabletop. */
export function cornerVars() {
  const { inner: i, outer: o, table: t } = BODY.corners;
  return { '--r-in': radius([i.tl, i.tr, i.br, i.bl]), '--r-out': radius([o.tl, o.tr, o.br, o.bl]), '--r-table': radius([t.tl, t.tr, t.br, t.bl]),
    '--r-lpage': radius([i.tl, 0, 0, i.bl]), '--r-rpage': radius([0, i.tr, i.br, 0]) };
}
/** How far the drawn body reaches past the device box (fit() keeps it in view): the keys, the left half, the shadow. */
export const BODY_PAD = { book: { l: 24, r: 26, t: 24, b: 22 }, table: { l: 27, r: 26, t: 23, b: 27 } };

/**
 * The free edge's light at a hinge of a degrees: its outward normal turns with the panel, (cos a, 0, sin a) with z toward
 * you. A key light high on the left in front; sheen is its highlight on the polished metal (Blinn, narrow), shade the
 * darkening when the edge is seen at a graze. glint is a faint sweep across each face's rim and glass while it turns
 * (front: while the outer screen still faces you; back: until the half-fold rest at 150°, so a page you read is never
 * glazed).
 */
export function bodyAt(a) {
  const r = (a * Math.PI) / 180, n = [Math.cos(r), Math.sin(r)];
  const H = [-0.19, 0.94]; // the half vector of a light up-left in front and the eye, projected on the turn (x, z)
  const spec = Math.max(0, n[0] * H[0] + n[1] * H[1]);
  const sheen = 0.62 * spec ** 22, shade = 0.5 * (1 - Math.max(0, n[1])) ** 1.6;
  const bump = (x, from, to) => { const t = clamp01((x - from) / (to - from)); return Math.sin(Math.PI * t) ** 2; };
  // each face's glint crosses it once while it is lit: at is how far (0 → 1) through its window
  return { sheen, shade, glint: { front: 0.16 * bump(a, 8, 84), back: 0.16 * bump(a, 96, 148), at: [clamp01((a - 8) / 76), clamp01((a - 96) / 52)] } };
}
// ---------- the body's markup (pure: the page and the panel draw the same boxes) ----------
const pt = v => `${Math.round(v * 100) / 100}px`;
const corners = r => (r.some(Array.isArray) ? radius(r) : r.map(pt).join(' '));
/** A light, a dark, a light: the polished rim seen face-on, outside in (Newsroom render, px → pt), then the bezel's lip. */
const RIM = [[0.6, '#4a4842'], [1.5, '#a7a59f'], [2.7, '#f6f4ef'], [3.6, '#a19f99'], [4.6, '#3f3e3b'], [5.4, '#76777a'], [6.6, '#3c3d40']];
const rimShadow = RIM.map(([w, c]) => `inset 0 0 0 ${w}px ${c}`).join(', ');
/**
 * One face of a half, in its own box (w × h, corners r = [tl, tr, br, bl]): the rim and bezel, the black border round the
 * screen (rect s and corners sr, in the same box). open: the side where the face runs on into the other half (the
 * crease): the rim is drawn past it and clipped, so that side has none. marks: antenna breaks ({ x: [...], y: [...] } in
 * the box), on the rim.
 */
export function faceHTML({ w, h, r, s, sr, open = null, bezel, marks = { x: [], y: [] }, sides = ['left', 'right'] }) {
  const ext = 16, rx = open === 'left' ? -ext : 0, rw = w + (open ? ext : 0), k = BODY.ink, m = BODY.marks.w;
  // the black border stops at the crease too (the screen runs on into the other half)
  const il = open === 'left' ? 0 : k, ir = open === 'right' ? 0 : k;
  const ink = `<i class="u-ink" style="left:${pt(s.x - il)};top:${pt(s.y - k)};width:${pt(s.w + il + ir)};height:${pt(s.h + 2 * k)};border-radius:${radius(sr, k)}"></i>`;
  const tick = (x, y, mw, mh) => `<i class="u-mark" style="left:${pt(x)};top:${pt(y)};width:${pt(mw)};height:${pt(mh)}"></i>`;
  const ticks = [...marks.x.flatMap(x => [tick(x - m / 2, 0, m, 5.4), tick(x - m / 2, h - 5.4, m, 5.4)]),
    ...marks.y.flatMap(y => sides.map(side => tick(side === 'left' ? 0 : w - 5.4, y - m / 2, 5.4, m)))].join('');
  return `<i class="u-rimclip" style="border-radius:${corners(r)}"><i class="u-rim" style="left:${pt(rx)};width:${pt(rw)};border-radius:${corners(r)};background:${bezel};box-shadow:${rimShadow}"></i>${ticks}</i>${ink}`;
}
const INNER = '#313234', OUTER = '#0c0c0e'; // the inner screen's bezel is charcoal, the outer screen's black glass
/** Where the rims curl into the hinge's gap (Newsroom render: each rim rounds off into a gap about 1 pt wide). */
const NOTCH = '<path d="M0 0H10C6.9 0 5.6 1.4 5.45 7H4.55C4.4 1.4 3.1 0 0 0Z" fill="var(--u-ground)"/><path d="M0 .55C2.9 .55 4 1.9 4.15 7M10 .55C7.1 .55 6 1.9 5.85 7" fill="none" stroke="#5b5953" stroke-width=".7"/>';
const notchHTML = (x, y, turn) => `<svg class="u-notch" viewBox="0 0 10 7" width="10" height="7" style="left:${pt(x)};top:${pt(y)};transform:rotate(${turn}deg)" aria-hidden="true">${NOTCH}</svg>`;
/**
 * The hinge at the crease when the body lies flat (in the open body's own box, h tall, the crease at cx): the rims curl
 * into the gap at the top and the bottom edge; a cover 67 pt wide sits in the bezel between the rim and the screen's black.
 */
function hingeHTML(cx, h) {
  const B = BODY, rim = 6.6, below = B.top + G.PH + B.ink;
  const cover = (y, ch) => `<i class="u-cover" style="left:${pt(cx - 33.5)};top:${pt(y)};width:67px;height:${pt(ch)}"><i></i></i>`;
  return notchHTML(cx - 5, 0, 0) + notchHTML(cx - 5, h - 7, 180) + cover(rim, B.top - B.ink - rim) + cover(below, h - rim - below);
}
/**
 * Everything of the body that does not move, in device pt: the open body (book, lying flat), the half in your hand (while
 * the other half is on the panel), the closed body (the front cover and its outer screen), the tabletop's body, and the keys
 * (on the half in your hand). Which one shows is the [data-body] of the host.
 */
export function bodyHTML() {
  const B = BODY, y0 = B.y0, H = B.H, R = B.R, c = G.crease, { inner: I, outer: O, table: Tc } = B.corners;
  // which shell is a data attribute, not a class: the page clears state classes such as is-open across the whole host
  const box = (name, x, y, w, h, inner, extra = '') => `<div class="u-shell" data-shell="${name}" style="left:${pt(x)};top:${pt(y)};width:${pt(w)};height:${pt(h)}">${inner}${extra}</div>`;
  const marksX = (x, from, to) => B.marks.x.filter(v => v > from && v < to).map(v => v - x);
  const yMarks = B.marks.y.map(v => v - y0);
  const open = box('open', B.x0, y0, B.x1 - B.x0, H, faceHTML({ w: B.x1 - B.x0, h: H, r: [R, R, R, R], s: { x: -B.x0, y: B.top, w: G.W, h: G.PH }, sr: [I.tl, I.tr, I.br, I.bl], bezel: INNER, marks: { x: marksX(B.x0, B.x0, B.x1), y: yMarks } }),
    hingeHTML(c - B.x0, H));
  const right = box('right', c, y0, B.x1 - c, H, faceHTML({ w: B.x1 - c, h: H, r: [0, R, R, 0], s: { x: 0, y: B.top, w: G.PW, h: G.PH }, sr: [0, I.tr, I.br, 0], open: 'left', bezel: INNER, marks: { x: marksX(c, c, B.x1), y: yMarks }, sides: ['right'] }));
  const cx = c - B.spine, Rh = B.Rh;
  const closed = box('closed', cx, y0, B.x1 - cx, H, faceHTML({ w: B.x1 - cx, h: H, r: [Rh, R, R, Rh], s: { x: G.OX - cx, y: B.top, w: G.S, h: G.L }, sr: [O.tl, O.tr, O.br, O.bl], bezel: OUTER, marks: { x: marksX(cx, cx, B.x1), y: yMarks }, sides: ['right'] }));
  // the tabletop: the book turned a quarter clockwise, (x, y) → (PH − y, x)
  const tx = G.PH - (y0 + H), tw = H, th = B.x1 - B.x0;
  // on the tabletop the crease runs across, at y = c − x0 in the body's box: the rims curl in at its left and right ends
  const y = c - B.x0, ends = notchHTML(-1.5, y - 3.5, -90) + notchHTML(tw - 8.5, y - 3.5, 90);
  const table = box('table', tx, B.x0, tw, th, faceHTML({ w: tw, h: th, r: [R, R, R, R], s: { x: -tx, y: -B.x0, w: G.PH, h: G.W }, sr: [Tc.tl, Tc.tr, Tc.br, Tc.bl], bezel: INNER, marks: { x: yMarks.map(v => tw - v), y: marksX(B.x0, B.x0, B.x1) } }), ends);
  return `<div class="u-keys" data-shell="book">${keysHTML(false)}</div><div class="u-keys" data-shell="table">${keysHTML(true)}</div>${open}${right}${closed}${table}`;
}
/** The keys on the half in your hand: two on its top edge, one on its free edge, a flush one under it. */
function keysHTML(turned) {
  const K = BODY.keys, top = BODY.y0, right = BODY.x1, under = 3;
  const list = [...K.top.map(([a, b]) => ({ x: a, y: top - K.rise, w: b - a, h: K.rise + under, side: 'top' })),
    { x: right - under, y: K.side[0], w: K.rise + under, h: K.side[1] - K.side[0], side: 'right' },
    { x: right - under, y: K.flush[0], w: 1 + under, h: K.flush[1] - K.flush[0], side: 'right', flush: true }];
  const turn = ({ x, y, w, h, side, flush }) => (turned ? { x: G.PH - y - h, y: x, w: h, h: w, side: side === 'top' ? 'right' : 'bottom', flush } : { x, y, w, h, side, flush });
  return list.map(turn).map(k => `<i class="u-key is-${k.side}${k.flush ? ' is-flush' : ''}" style="left:${pt(k.x)};top:${pt(k.y)};width:${pt(k.w)};height:${pt(k.h)}"></i>`).join('');
}
/**
 * The outer screen standing in as the right page while the panel turns is 9 pt taller than the inner screen's page. This
 * covers what it has past the page's outline (its last 9 pt and the bottom corners, which are rounder): clipped to
 * the outer screen's own shape, a box the size of the page throws a ring of the bezel's black and charcoal outward, the same
 * pixels the body has there. It is a static layer that only fades on and off: no clip changes, nothing is painted again.
 */
export function pageCutHTML() {
  // 1 pt past the outer screen's left, right and lower edges, so its antialiased edge does not show through the cover's
  const top = G.PH - 60, e = 1, ring = `0 0 0 ${pt(BODY.ink)} #000, 0 0 0 ${pt(BODY.ink + 12)} ${INNER}`;
  return `<i class="u-pagecut" aria-hidden="true" style="left:${pt(G.OX - e)};top:${pt(top)};width:${pt(G.S + 2 * e)};height:${pt(G.L - top + e)};border-radius:${radius([0, 0, BODY.corners.outer.br, BODY.corners.outer.bl], e)}">`
    + `<i style="left:${pt(G.crease - G.OX + e)};top:${pt(-top)};width:${pt(G.PW)};height:${pt(G.PH)};border-radius:${radius([0, BODY.corners.inner.tr, BODY.corners.inner.br, 0])};box-shadow:${ring}"></i></i>`;
}
/** The panel's two faces (in its own coordinates: x from the crease, y as the device's) and the strip of its free edge. */
export function panelBodyHTML() {
  const B = BODY, R = B.R, Rh = B.Rh, sp = B.spine, { inner: I, outer: O } = B.corners;
  const front = faceHTML({ w: sp + B.L, h: B.H, r: [Rh, R, R, Rh], s: { x: sp + G.OX - G.crease, y: B.top, w: G.S, h: G.L }, sr: [O.tl, O.tr, O.br, O.bl], bezel: OUTER,
    marks: { x: B.marks.x.filter(v => v > G.crease).map(v => v - G.crease + sp), y: B.marks.y.map(v => v - B.y0) }, sides: ['right'] });
  // the back face is turned over (rotateY 180°): its own left is the free edge, its own right the crease
  const back = faceHTML({ w: B.L, h: B.H, r: [R, 0, 0, R], s: { x: B.side, y: B.top, w: G.PW, h: G.PH }, sr: [I.tl, 0, 0, I.bl], open: 'right', bezel: INNER,
    marks: { x: B.marks.x.filter(v => v < G.crease).map(v => v - B.x0), y: B.marks.y.map(v => v - B.y0) }, sides: ['left'] });
  return { front, back, edge: edgeHTML() };
}
/**
 * The free edge, T deep: a straight strip between the corners, turned to face out (rotateY 90° about its outer line), and
 * `facets` strips round each corner, each turned by its angle on the arc. They ride the panel; only their light changes.
 */
function edgeHTML() {
  const B = BODY, R = B.R, n = B.facets, x = B.L, top = B.y0 + R, bottom = B.y0 + B.H - R, d = 90 / n;
  const half = (d * Math.PI) / 360, L = 2 * R * Math.sin(half) + 0.6, mid = R * Math.cos(half);
  const marks = B.marks.y.map(v => `<i class="u-smark" style="top:${pt(v - top - B.marks.w / 2)}"></i>`).join('');
  let out = `<div class="u-side" style="left:${pt(x)};top:${pt(top)};width:${pt(B.T)};height:${pt(bottom - top)}">${marks}<i class="u-sheen"></i><i class="u-shade"></i></div>`;
  for (const [sign, cy] of [[1, top], [-1, bottom]]) {
    for (let i = 0; i < n; i += 1) {
      const a = sign * (i + 0.5) * d, ar = (a * Math.PI) / 180;
      const fx = x - R + mid * Math.cos(ar), fy = cy - mid * Math.sin(ar);
      // facing up catches the key light, facing down falls into shade
      const lit = sign > 0 ? 0.10 + 0.18 * (i / (n - 1)) : -(0.10 + 0.22 * (i / (n - 1)));
      out += `<i class="u-facet" style="left:${pt(fx)};top:${pt(fy - L / 2)};width:${pt(B.T)};height:${pt(L)};transform:rotateZ(${(-a).toFixed(3)}deg) rotateY(90deg);--lit:${lit > 0 ? `rgb(255 255 255 / ${lit.toFixed(3)})` : `rgb(0 0 0 / ${(-lit).toFixed(3)})`}"></i>`;
    }
  }
  return out;
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
 * answer (duo-motion.md 3.4, D's 3a): the stripe you answered folds, both halves at once and in place (its top stays), into
 * D's answered card — a title line and the receipt — and its group into one line as tall; 0–0.20 s. Then what is below
 * (beside, on the tabletop) closes up in one move and the ask that comes out of the fold grows into a stripe, 0.20–0.52 s
 * (others). On the tabletop the column you answered then goes to the end of the strip and the ones to do close up to the
 * left (strip, 0.40–0.76 s: the receipt shows where you pressed a moment longer first); the ask out of the fold grows into
 * its column. guard: for that long after the press, a tap where the finger was does not land on what slid under it (D's).
 * undo: backwards and quicker (0.36 s): the stripe grows back while the ones below make room, in step.
 * land: the next 整理 — the receipt fills, the count turns, the answered stripe goes over the fold to the Agent's page in
 * one diagonal (receipt) and one vertical (left half) stroke, the rest move once, new asks arrive.
 * (Before 2026-10-30 an answered stripe kept its height until the next round, so nothing moved; the user saw the empty
 * shells that left on the book and the tabletop.)
 */
export const BOOK = {
  answer: { self: { move: [0, 0.20], box: [0, 0.20], parts: [0, 0.20], out: [0, 0.12], in: [0.10, 0.20], fresh: [0.10, 0.20], flip: 0.20, settle: 0.30 },
    others: { move: [0.20, 0.32], box: [0.20, 0.32], parts: [0.20, 0.32], out: [0.20, 0.12], in: [0.26, 0.20], fresh: [0.36, 0.16], flip: 0.20, settle: 0.52 },
    strip: [0.40, 0.36], enter: [0.36, 0.36], exit: [0.20, 0.20], line: [0, 0.18], hero: 0.20, band: [0.20, 0.20], guard: 1.12, total: 0.72 },
  undo: { self: { move: [0, 0.20], box: [0, 0.20], parts: [0, 0.20], out: [0, 0.10], in: [0.08, 0.18], fresh: [0.10, 0.18], flip: 0.10, settle: 0.20 },
    others: { move: [0, 0.20], box: [0, 0.20], parts: [0, 0.20], out: [0, 0.10], in: [0.08, 0.18], fresh: [0.10, 0.18], flip: 0.10, settle: 0.20 },
    strip: [0, 0.24], enter: [0.12, 0.24], exit: [0, 0.16], line: [0.10, 0.18], hero: 0.10, band: [0.10, 0.20], total: 0.36 },
  land: { receipt: [0, 0.30], hero: 0.30, lead: [0.30, 0.40], lapse: [0.28, 0.12], move: [0.34, 0.36], enter: [0.46, 0.36], exit: [0.28, 0.14],
    band: [0.30, 0.40], glow: 0.80, total: 1.0 },
  local: { move: [0, 0.32], box: [0, 0.32], parts: [0, 0.32], out: [0, 0.14], in: [0.08, 0.20], fresh: [0.10, 0.22], flip: 0, settle: 0.32, enter: [0, 0.36], exit: [0, 0.24] },
};

/**
 * The left page is the fold laid open (duo-motion.md 2.1, 3.1): the round's inputs, those taken into a card on the right
 * page grouped by that card (C's rule, inflow.mjs). A group is the card's row on the left page and as tall as the card; a
 * line from it crosses the crease into the card's left edge. Its metrics are fixed (pt), so where each input line and the
 * line into the card lie is known from the markup: top padding, head, sub line, the gap before the lines, the line pitch;
 * how many lines a lead or a mid group shows (the rest fold into “还有 N 条”; on the tabletop each group has the standing
 * half's height to itself, and its line drops straight down over the crease, so it shows more); the funnel (from the lines'
 * ends to the group's edge) and the run past the edge (across the 24 pt fold, 48 half-folded, and on under the card).
 *   fold    you answer its card: the lines fold into one line (the box shrinks to it) in the same beat and at the same pace
 *           as the card folds into its receipt, so the two halves stay one height all the way (BOOK.answer.self); the
 *           line into the card is drawn back to the crease and fades; unfold: you take the answer back, backwards.
 * The line grows from the crease with the band while the hinge goes from 120° to 170° (FOLD.band) and draws back with it.
 */
export const FEED = { pad: 12, head: 20, sub: 18, gapTop: 6, pitch: 19, cap: { lead: 6, mid: 4, table: 7 }, funnel: 30, run: 56,
  fold: { move: [0, 0.20], box: [0, 0.20], parts: [0, 0.20], out: [0, 0.12], in: [0.10, 0.20], fresh: [0.10, 0.20], flip: 0.20, settle: 0.30, line: [0, 0.18] },
  unfold: { move: [0, 0.20], box: [0, 0.20], parts: [0, 0.20], out: [0, 0.10], in: [0.08, 0.18], fresh: [0.10, 0.18], flip: 0.10, settle: 0.20, line: [0.10, 0.18] } };
/**
 * The tabletop's columns (duo-motion.md 4.1): one per stripe, a fixed width, the same for every column and for both halves,
 * never set by what is in them. Three fill the screen beside the rail exactly (pad at either side, gap between); a fourth
 * and more lie to the right and both halves scroll sideways together, a column at a time (snap). The window only scales
 * the whole device, so a smaller window shows the same three columns, smaller: the layout is the phone's, in pt.
 */
export const TABLE = { pad: 12, gap: 8, cols: 3 };
TABLE.col = (G.PH - G.rail - 2 * TABLE.pad - (TABLE.cols - 1) * TABLE.gap) / TABLE.cols; // 191
TABLE.step = TABLE.col + TABLE.gap;                                                      // one snap, 199
/** The strip's width for n columns (pt): the screen beside the rail at least. */
TABLE.width = n => Math.max(G.PH - G.rail, 2 * TABLE.pad + n * TABLE.col + Math.max(0, n - 1) * TABLE.gap);
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
