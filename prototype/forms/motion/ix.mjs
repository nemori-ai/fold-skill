// 共用交互模块（ix）：悬停看概要，点击展开详情。第三轮两个概念动画（整理脉冲、份额拨盘）定下的同一套标准，
// 抽出来给之后接入的形式用；与几何无关：宿主说“这一点是哪件事”“它挂在哪里”“怎样停表”，模块管其余的事。
// 样式在同目录的 ix.css（结构 + 一组 --ix-* 变量，默认是纸色主题；黑底等宽的页面只覆盖变量）。
//
// ---------- 标准（story.md「交互」，两个动画共用） ----------
// 悬停：鼠标移到事项上、Tab 到它（每件一个视觉上隐藏的按钮），触屏轻点一下。出概要卡（来自哪条流、几份、本轮怎么变、
//   本轮进了几条输入、开着的问题与期限），一根细引线连到卡；其余事项降到七成、概念层降到四成由宿主按 X.dim 画。
//   宿主的播放停在当前时刻；离开 0.15 秒宽限（指针可以挪到卡上），卡用 0.12 秒淡出，再过 0.4 秒恢复播放。
// 展开：点击事项或它的概要卡，Tab 后按 Enter 或空格。0 秒是切点（宿主读 X.detail 与 ix.view 把标题、面板切到
//   “这一件”）；0–0.3 秒事项沿自己的几何弹出 8 px（宿主按 X.pop × IX.pop 画，ease-out 过冲 3.7 %）；0.4–0.6 秒
//   画引线；0.6–0.9 秒详情卡从引线末端展开，先沿引线接上的那条边、再向外。详情不承载作答：问题旁的“去回答 →”
//   链到同一帧的 D 手机首页（host.answerHref）。
// 收回：Esc、点空白、再点同一件：卡 0.2 秒收起、引线 0.15 秒缩回、事项 0.2 秒落回，然后一帧切回，0.4 秒后恢复播放。
//   点另一件先收回再展开那一件。宿主的导航（换帧、连播、合页顶栏选帧）调 ix.reset()，立即收起。
//   键盘打开的，卡展开后焦点进卡，收回后回到那件事的按钮。prefers-reduced-motion 时直接到终态。
//
// ---------- 宿主契约：createIx(host) 要提供什么 ----------
// 必填
//   stage            事件绑在这里，卡与隐藏按钮也放在这里；它须是定位元素，所有坐标都是它内部的 px
//   facts(id)        这一件在画面这一轮的事实：dial-model.mjs 的 itemFacts(i, id[, into])
//   has(id)          这一件此刻在画面上、可以悬停与展开
//   hit(x, y)        舞台坐标下的命中测试 → id | null（带 data-id 的元素由模块先认，卡上也带 data-id）
//   pointOf(id)      这一件的代表点（舞台坐标），给 window.foldX.pointOf 与真指针检查用
//   pause(), resume()  停住与接着走宿主的播放时钟；paused() 可选，缺省用模块自己记的状态
//   last             最后一轮的序号（卡上的“第 i / last 轮”与份额小条图的轴）
//   answerHref(f)    “去回答 →”的链接：同一帧的 D（../../index.html?variant=d&frame=<f.i>，带上数据集）
// 摆位：给 anchor 用默认摆法，或者自己给 peekPlace / detailPlace
//   anchor(id)       → { x, y, facing: 1 | -1, from?, avoid?: [矩形], keep?: 矩形, zone?: {x, y, r} }
//                    x, y 是卡挂靠的点；facing 是事项朝向的一侧（卡先放这边）；avoid 是卡要让开的字；keep 是事项自己
//                    （卡不压住它）；zone 是不进的中心区（圆）。矩形一律 {x0, y0, x1, y1}。
//   bounds()         卡能用的区域，缺省是舞台四边各收 8 px
//   peekPlace(id, w, h) → {x, y, from}；缺省 placeBeside：贴朝向一侧、放不下先试上下、再换边
//   detailPlace(id, el) → {x, y, w, h, path: [{x, y}…]}；缺省 placeColumn：贴舞台朝向一侧的边（hug: 'keep' 时贴着
//                    keep），压到 keep 时放到它上方或下方，必要时收窄；path 是引线，末点落在卡的边上
//   leader(id, card) 缺省摆法里的引线 → [{x, y}…]，缺省从挂靠点直连卡边最近处
//   detailWidth      缺省 320；hug 'edge' | 'keep'
// 可选
//   named(name)      id 或短名 → id（window.foldX.hover('主水管')）
//   index()          画面这一轮的序号（卡的缓存键），缺省 facts 返回的 i
//   seen()           节拍门槛 {inputs, share, asks}：轮中途停住时卡上不提前说出后面节拍的事（整理脉冲）；缺省全为 true
//   asks(f, seen)    卡上列哪些开着的问题，缺省 f.asks
//   inPlace(id)      这一件的概要另有地方原地显示（拨盘游标的注释框），此时不出概要卡
//   skip             选择器：舞台里这些地方不算命中（标题卡、面板）
//   leaders          'svg'（缺省：模块在舞台上铺一层 SVG 画两根引线）、'host'（宿主自己画，读 ix.leaders()）
//                    或 {detail: SVGPathElement, peek: SVGPathElement}（模块写进宿主给的两根 path）
//   keysIn           隐藏按钮组放进哪个元素（作为它的第一个子元素），缺省放在 stage 末尾；决定 Tab 先到哪里
//   label            隐藏按钮组的 aria-label；pending 是 seen.inputs 为 false 时“本轮进了它”一节的说明
//   trendH           份额小条图的高（px），缺省 32
//   peekHTML(f, o), detailHTML(f, o)  卡里写什么：缺省是事项卡（本文件的 peekHTML / detailHTML，读 itemFacts）；
//                    宿主的“一件”不是事项（批次记谱的一行、合计行）时自己给，参数与缺省的相同。详情里放一个
//                    data-x="close" 的按钮就能收回；facts 至少要有 i 与 short（卡的缓存键与 aria-label）
//
// ---------- 宿主每帧做什么 ----------
//   const X = ix.frame();     // {focus, dim, pop, popId, line, card, detail, peek, peekId, keyFocus}
//   …按 X 画自己的几何：X.focus 之外降到 1 - 0.3 × X.dim；X.popId 沿自己的几何外推 IX.pop × X.pop；
//     X.keyFocus 是键盘聚焦的那件（描边）；X.detail 为真时标题与面板切到 ix.view（展开那一刻的 facts）…
//   ix.paint();               // 摆卡、展开、画引线（在宿主画完几何之后，卡跟着刚摆好的名字走）
//   ix.sync(key, items);      // 隐藏按钮：items = [{id, label}]（或返回它的函数），key 变了才重建
// 其余：ix.reset()（导航）、ix.relayout()（尺寸变了）、ix.rects()（卡的可见矩形，给概念层遮罩）、ix.leaders()、
//   ix.live()（还有东西在动）、ix.s（状态：hover / open / peek / via / fixed…）、ix.view、ix.X。
//   window.foldX = { ...自己的钩子, ...ix.hooks() }：hover / unhover / open / close / ixAt / ix / paused / pointOf，
//   另有 ixState() 给 scripts/check-ix.mjs 读。
//
// ---------- 最少几行 ----------
//   import { createIx } from './motion/ix.mjs';            // 页面另链 motion/ix.css
//   const ix = createIx({ stage, facts: id => itemFacts(i, id), has: id => onScreen.has(id), hit: (x, y) => idAt(x, y),
//     pointOf: id => centreOf(id), anchor: id => ({ ...tipOf(id), facing: 1, keep: boxOf(id) }),
//     pause: () => player.stop(), resume: () => player.go(), last: frames.length - 1,
//     answerHref: f => withDataset(`../index.html?variant=d&frame=${f.i}`) });
//   每帧：const X = ix.frame(); 画几何时用 X.focus / X.dim / X.pop；ix.paint(); ix.sync(i, list)。
//   换帧时 ix.reset()；window.foldMine = { ...ix.hooks() }。
import { BUDGET, dayTime } from './dial-model.mjs';

/** Timing (seconds) and the step-out distance (px), shared by every page. */
export const IX = { pop: 8, popDur: 0.3, line: 0.4, lineDur: 0.2, card: 0.6, cardDur: 0.3, fold: 0.2, unline: 0.15, drop: 0.2,
  fadeIn: 0.15, fadeOut: 0.12, dim: 0.15, resume: 0.4, grace: 0.15 };
const ALL = Object.freeze({ inputs: true, share: true, asks: true });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const now = () => performance.now() / 1000;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeInOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
// Fast start, settles with an overshoot of about 3.7 % (story.md: no more than 4 %).
const easeOutBack = k => { const u = clamp(k) - 1; return 1 + 2 * u ** 3 + u ** 2; };

// ---------- geometry helpers: stage px, rectangles {x0, y0, x1, y1} ----------
export const meets = (a, b, pad = 0) => Boolean(a && b && a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad);
export const nearestOn = (p, r) => ({ x: clamp(p.x, r.x0, r.x1), y: clamp(p.y, r.y0, r.y1) });
/** The nearest point on a rectangle's edge, also from inside it. */
export function edgePoint(p, r) {
  const q = nearestOn(p, r);
  if (q.x !== p.x || q.y !== p.y) return q;
  const d = [p.x - r.x0, r.x1 - p.x, p.y - r.y0, r.y1 - p.y], k = d.indexOf(Math.min(...d));
  return k === 0 ? { x: r.x0, y: p.y } : k === 1 ? { x: r.x1, y: p.y } : k === 2 ? { x: p.x, y: r.y0 } : { x: p.x, y: r.y1 };
}
/** Does segment a→b come within pad of rectangle r? */
export function segMeets(a, b, r, pad) {
  for (let k = 0; k <= 24; k += 1) { const x = lerp(a.x, b.x, k / 24), y = lerp(a.y, b.y, k / 24); if (x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad) return true; }
  return false;
}
// How close segment a→b comes to point c.
function segApproach(a, b, c) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, k = L ? clamp(((c.x - a.x) * dx + (c.y - a.y) * dy) / L) : 0;
  return Math.hypot(a.x + dx * k - c.x, a.y + dy * k - c.y);
}
const pathD = pts => `M${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}`;

/**
 * A summary card w × h beside a point: on the side it faces, level with `at`, slid outward 6 px at a time until it is
 * clear; then a little above and below; then the other side. Clear means: inside `bounds`, off every rectangle in
 * `avoid` (by `pad`), outside the circle `zone` (its nearest point farther than zone.r from the centre), its leader from
 * `from` never coming within leaderZone.r of that centre, and off every segment in `segments` ([a, b, pad]).
 * `flush` lets a card that runs into an edge sit flush with it instead of giving up that row.
 */
export function placeBeside({ at, from = at, facing = 1, w, h, bounds, gap = 18, step = 6, steps = 90, flush = false,
  avoid = [], pad = 8, zone = null, leaderZone = null, segments = [] }) {
  const B = bounds;
  const clear = (x, y) => {
    const r = { x0: x, y0: y, x1: x + w, y1: y + h };
    if (zone) { const n = nearestOn(zone, r); if (Math.hypot(n.x - zone.x, n.y - zone.y) <= zone.r) return false; }
    if (avoid.some(a => meets(a, r, pad))) return false;
    if (leaderZone && segApproach(from, nearestOn(from, r), leaderZone) <= leaderZone.r) return false;
    return !segments.some(([a, b, p]) => segMeets(a, b, r, p));
  };
  for (const dir of [facing, -facing]) {
    for (const dy of [0, -(h / 2 + 16), h / 2 + 16, -(h + 24), h + 24]) {
      const y = clamp(at.y - h / 2 + dy, B.y0, B.y1 - h);
      for (let k = 0; k < steps; k += 1) {
        let x = dir > 0 ? at.x + gap + k * step : at.x - gap - w - k * step;
        const out = x < B.x0 || x + w > B.x1;
        if (out && !flush) break;
        if (out) x = clamp(x, B.x0, B.x1 - w);
        if (clear(x, y)) return { x, y, from };
        if (out) break;
      }
    }
  }
  return { x: clamp(at.x + gap, B.x0, B.x1 - w), y: clamp(at.y - h / 2, B.y0, B.y1 - h), from };
}

/**
 * The detail card as a column: on the side the item faces (else the other), full width or narrower if that keeps it
 * clear of `keep`, below any of `words` it would cover, level with anchorY; if it would still cover `keep`, above or
 * below it. `hug: 'edge'` puts it against that edge of `bounds`, `'keep'` right beside `keep`. Sets the element's
 * width and max-height (it must be measurable: the caller has un-hidden it). `leader(card)` gives the leader's points;
 * its last point should be on the card's edge.
 */
export function placeColumn({ el, facing = 1, width = 320, minWidth = 250, bounds, words = [], keep, anchorY, leader, hug = 'edge', gapX = 18 }) {
  const B = bounds, bottom = B.y1;
  const room = side => Math.floor(hug === 'keep' ? (side > 0 ? B.x1 - keep.x1 - gapX : keep.x0 - gapX - B.x0) : side > 0 ? B.x1 - keep.x1 - 4 : keep.x0 - 4 - B.x0);
  const tries = [facing, -facing].flatMap(side => [[side, width], ...(room(side) >= minWidth && room(side) < width ? [[side, room(side)]] : [])]);
  let choice = null;
  for (const [side, w] of tries) {
    const x = hug === 'keep' ? clamp(side > 0 ? keep.x1 + gapX : keep.x0 - gapX - w, B.x0, B.x1 - w) : side > 0 ? B.x1 - w : B.x0;
    const col = { x0: x, x1: x + w, y0: -1e6, y1: 1e6 };
    const top = Math.max(B.y0, ...words.filter(r => r && meets(r, col)).map(r => r.y1 + 14));
    el.style.width = `${w}px`; el.style.maxHeight = `${Math.max(120, bottom - top)}px`;
    let h = Math.min(el.offsetHeight, bottom - top);
    let y = clamp(anchorY - h * 0.35, top, bottom - h);
    const box = yy => ({ x0: x, y0: yy, x1: x + w, y1: yy + h });
    if (!meets(box(y), keep)) { choice = { x, y, w, h, side }; break; }
    const above = keep.y0 - 12 - top, below = bottom - keep.y1 - 12;
    if (above >= Math.min(h, 200)) { h = Math.min(h, above); y = keep.y0 - 12 - h; choice = { x, y, w, h, side }; break; }
    if (below >= Math.min(h, 200)) { h = Math.min(h, below); y = keep.y1 + 12; choice = { x, y, w, h, side }; break; }
    if (!choice) { h = Math.min(h, Math.max(above, below, 160)); choice = { x, y: above >= below ? Math.max(top, keep.y0 - 12 - h) : keep.y1 + 12, w, h, side }; }
  }
  el.style.width = `${choice.w}px`; el.style.maxHeight = `${choice.h}px`;
  choice.h = Math.min(choice.h, el.offsetHeight);
  const card = { x0: choice.x, y0: choice.y, x1: choice.x + choice.w, y1: choice.y + choice.h };
  return { ...choice, card, path: leader(card) };
}

// ---------- the cards: both read itemFacts (dial-model.mjs) ----------
/** The lines of a summary: name and shares, the stream it comes from, how this round changed it, its inputs. */
export function summaryOf(f, seen = ALL) {
  const share = seen.share ? f.share : f.before;
  return {
    name: share ? `${f.short} ${share} 份` : f.short,
    from: f.stream.length ? `来自${f.stream.join(' · ')}` : '',
    change: seen.share ? f.change?.text || '' : '本轮的份额还没落定',
    inputs: !seen.inputs ? '本轮的输入还在路上' : f.inputs.length ? `本轮进了 ${f.inputs.length} 条输入` : '本轮没有输入进它',
  };
}
const askMark = a => (a.cursor ? ' is-urgent' : '');
/** The summary card's inner HTML. */
export function peekHTML(f, { seen = ALL, asks = f.asks } = {}) {
  const m = summaryOf(f, seen);
  return `<div class="ix-k">${esc(m.from || `第 ${f.i} 轮`)}</div><div class="ix-q">${esc(m.name)}</div>
    <div class="ix-d">${esc(m.change)}</div><div class="ix-d">${esc(m.inputs)}</div>
    ${asks.map(a => `<div class="ix-ask${askMark(a)}"><i></i><span>${esc(a.short)}</span>${a.due ? `<small>${esc(a.due)}</small>` : ''}</div>`).join('')}`;
}
/** The detail card's inner HTML: summary, children, shares by round, this round's inputs by source, asks, responses. */
export function detailHTML(f, { seen = ALL, asks = f.asks, last, href, trendH = 32, pending = '还在路上' } = {}) {
  const share = seen.share ? f.share : f.before, trend = f.trend.map((s, k) => (k === f.i ? share : s));
  const groups = new Map();
  for (const x of f.inputs) { if (!groups.has(x.source)) groups.set(x.source, []); groups.get(x.source).push(x); }
  const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
  const rest = sorted.slice(3).reduce((n, [, list]) => n + list.length, 0);
  const inputs = sorted.slice(0, 3).map(([source, list]) => `<li><small>${esc(source)} · ${list.length} 条</small>${[...new Map(list.map(x => [x.title, x])).values()].slice(0, 2)
    .map(x => `<span>${x.from ? `<em>${esc(x.from)}</em> ` : ''}${esc(x.title)}</span>`).join('')}</li>`).join('')
    + (rest ? `<li class="ix-none">另有 ${rest} 条，来自 ${sorted.length - 3} 个来源</li>` : '');
  // Shares in every round: one bar a round, this round bright, later rounds faint (as the allocation panel draws them).
  const n = last, W = 300, H = trendH, top = Math.max(24, ...trend), bw = W / n;
  const bars = trend.slice(1).map((s, k) => {
    const h = s ? Math.max(1.5, (s / top) * (H - 2)) : 1;
    return `<rect x="${(k * bw + bw * 0.15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" class="${k + 1 === f.i ? 'is-now' : k + 1 > f.i ? 'is-later' : s ? '' : 'is-off'}"/>`;
  }).join('');
  const list = asks.length ? asks.slice(0, 2).map(a => `<div class="ix-d-ask${askMark(a)}"><i></i><p>${esc(a.prompt)}</p>
      <small>${esc(a.due || '没有期限')}</small><a href="${esc(href)}">去回答 →</a></div>`).join('') : '<p class="ix-none">没有开着的问题</p>';
  const fb = f.feedback.length ? `<ul class="ix-d-fb">${f.feedback.slice(-3).map(x => `<li><time>${esc(dayTime(x.at))}</time>${esc(x.text)}</li>`).join('')}</ul>`
    : '<p class="ix-none">到这一轮还没有你的回应</p>';
  return `<div class="ix-d-k"><span>第 ${f.i} / ${last} 轮${f.stream.length ? ` · 来自${esc(f.stream.join(' · '))}` : ''}</span>
      <button type="button" data-x="close" aria-label="收回（Esc）" title="收回（Esc）">×</button></div>
    <div class="ix-d-t">${esc(f.title)}</div>
    <div class="ix-d-s"><b>${esc(f.short)} ${share}</b> / ${BUDGET} 份${!seen.share ? ' · 本轮的份额还没落定' : f.change ? ` · ${esc(f.change.text)}` : ''}</div>
    ${f.summary ? `<p class="ix-d-sum">${esc(f.summary)}</p>` : ''}
    ${f.children.length ? `<section><h5>子层<b>${f.children.length} 件</b></h5><ul class="ix-d-kids">${f.children.map(c => `<li><span>${esc(c.title)}</span><b>${c.share}</b></li>`).join('')}</ul></section>` : ''}
    <section><h5>份额 · 逐轮<b>第 ${f.i} 轮 ${share} 份</b></h5><svg class="ix-trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>
      <div class="ix-axis"><span>第 1 轮</span><span>第 ${n} 轮</span></div></section>
    <section><h5>本轮进了它<b>${seen.inputs ? `${f.inputs.length} 条` : '…'}</b></h5>${!seen.inputs ? `<p class="ix-none">${esc(pending)}</p>` : inputs ? `<ul class="ix-d-in">${inputs}</ul>` : '<p class="ix-none">本轮没有输入进它</p>'}</section>
    <section><h5>开着的问题<b>${asks.length ? `${asks.length} 条` : ''}</b></h5>${list}</section>
    <section><h5>你的回应<b>${f.feedback.length ? `共 ${f.feedback.length} 条` : ''}</b></h5>${fb}</section>`;
}

// ---------- the controller ----------
const SVGNS = 'http://www.w3.org/2000/svg';
const make = (tag, cls, attrs = {}, ns = null) => {
  const node = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
  if (cls) node.setAttribute('class', cls);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

export function createIx(host) {
  const H = {
    named: id => (host.has(id) ? id : null), seen: () => ALL, asks: f => f.asks, skip: null, leaders: 'svg',
    label: '事项：Tab 逐个看概要，Enter 展开详情，Esc 收回', pending: '还在路上', trendH: 32, detailWidth: 320, hug: 'edge',
    bounds: () => ({ x0: 8, y0: 8, x1: host.stage.clientWidth - 8, y1: host.stage.clientHeight - 8 }),
    ...host,
  };
  const stage = H.stage;
  // The cards and the keyboard proxies live in the stage, after everything the host put there.
  const peekEl = make('div', 'ix-peek'), detailEl = make('div', 'ix-detail', { role: 'dialog', tabindex: '-1' });
  const srEl = make('div', 'ix-sr', { role: 'group', 'aria-label': H.label });
  peekEl.hidden = true; detailEl.hidden = true;
  let lines = null;
  if (H.leaders === 'svg') {
    const svg = make('svg', 'ix-leaders', { 'aria-hidden': 'true' }, SVGNS);
    lines = { detail: make('path', 'ix-xline', { pathLength: '1' }, SVGNS), peek: make('path', 'ix-pline', {}, SVGNS) };
    svg.append(lines.detail, lines.peek);
    stage.append(svg);
  } else if (H.leaders && H.leaders !== 'host') lines = H.leaders;
  stage.append(peekEl, detailEl);
  if (H.keysIn) H.keysIn.prepend(srEl); else stage.append(srEl);

  // State. `fixed` pins the open or close motion at that many seconds (ixAt, for stills and checks).
  const S = {
    hover: null, via: null, peek: null, peekAt: 0, peekOut: null, peekKey: '', peekBox: null,
    open: null, openAt: 0, closeAt: null, viaKey: false, focusMoved: false, next: null, view: null, seen: ALL, detailKey: '', place: null,
    dim: 0, dimId: null, fixed: null, resumeTimer: null, leaveTimer: null, lastAt: 0, pointer: 'mouse', held: false,
  };
  const REST = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
  let X = { ...REST };
  const isHeld = () => (H.paused ? H.paused() : S.held);
  const indexOf = id => (H.index ? H.index() : H.facts(id).i);
  const seenKey = seen => `${seen.inputs ? 1 : 0}${seen.share ? 1 : 0}${seen.asks ? 1 : 0}`;

  // ----- the clock: hovering or opening stops the host's play; 0.4 s after the last one ends it goes on -----
  function syncPause() {
    if (S.hover || S.open) {
      clearTimeout(S.resumeTimer); S.resumeTimer = null;
      if (!isHeld()) { S.held = true; H.pause(); }
    } else if (isHeld() && !S.resumeTimer) {
      S.resumeTimer = setTimeout(() => { S.resumeTimer = null; if (!S.hover && !S.open) resumeNow(); }, IX.resume * 1000);
    }
  }
  function resumeNow() {
    clearTimeout(S.resumeTimer); S.resumeTimer = null;
    if (isHeld()) { S.held = false; H.resume(); }
  }

  // ----- hover, open, close -----
  function hover(id, via) {
    clearTimeout(S.leaveTimer); S.leaveTimer = null;
    if (!id) {
      if (!S.hover) return;
      const clear = () => { S.leaveTimer = null; S.hover = null; S.via = null; if (S.peek && S.peekOut == null) S.peekOut = now(); syncPause(); };
      // A short grace, so the pointer can travel from the item onto its card.
      if (via === 'now') clear(); else S.leaveTimer = setTimeout(clear, IX.grace * 1000);
      return;
    }
    S.via = via;
    if (S.hover === id) return;
    S.hover = id;
    if (!S.open) { const shown = S.peek && S.peekOut == null; S.peek = id; S.peekOut = null; S.peekKey = ''; S.peekAt = shown ? now() - IX.fadeIn : now(); }
    syncPause();
  }
  function open(id, viaKey = false) {
    if (!id || !H.has(id)) return;
    if (S.open === id && S.closeAt == null) return;
    if (S.open && S.open !== id) { S.next = { id, viaKey }; close(); return; }
    clearTimeout(S.leaveTimer); S.leaveTimer = null;
    S.open = id; S.openAt = now(); S.closeAt = null; S.viaKey = viaKey; S.focusMoved = false;
    S.view = H.facts(id); S.seen = H.seen(); S.detailKey = ''; S.place = null;
    if (S.peek && S.peekOut == null) S.peekOut = now();
    syncPause();
  }
  function close() { if (S.open && S.closeAt == null) S.closeAt = now(); }
  function clearDetail() {
    detailEl.hidden = true;
    if (lines) lines.detail.setAttribute('d', '');
  }
  function finishClose() {
    const id = S.open, refocus = S.viaKey;
    S.open = null; S.closeAt = null; S.view = null; S.viaKey = false; S.detailKey = ''; S.place = null;
    clearDetail();
    if (S.hover) { S.peek = S.hover; S.peekKey = ''; S.peekAt = now(); S.peekOut = null; }
    if (refocus) srEl.querySelector(`[data-ix="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    const next = S.next;
    S.next = null;
    if (next) open(next.id, next.viaKey); else syncPause();
  }
  /** Any navigation (frame, step, play, the embedding page) drops hover and detail at once and lets play go on. */
  function reset() {
    clearTimeout(S.leaveTimer); S.leaveTimer = null;
    if (srEl.contains(document.activeElement)) document.activeElement.blur();
    Object.assign(S, { hover: null, via: null, peek: null, peekOut: null, open: null, closeAt: null, view: null, next: null, viaKey: false, dim: 0, detailKey: '', place: null, peekKey: '', peekBox: null });
    clearDetail(); peekEl.hidden = true; if (lines) lines.peek.setAttribute('d', ''); stage.style.cursor = '';
    X = { ...REST };
    resumeNow();
  }

  // ----- one frame of the motion -----
  function frame() {
    const t = now(), rm = reduced();
    const dt = S.lastAt ? Math.min(0.1, t - S.lastAt) : 1 / 60;
    S.lastAt = t;
    const since = t0 => (rm ? 99 : S.fixed != null ? S.fixed : t - t0);
    let pop = 0, line = 0, card = 0, detail = false;
    if (S.open) {
      if (S.closeAt == null) {
        const e = since(S.openAt);
        pop = easeOutBack(e / IX.popDur);
        line = easeOut((e - IX.line) / IX.lineDur);
        card = clamp((e - IX.card) / IX.cardDur);
        detail = true;
      } else {
        const e = since(S.closeAt);
        card = 1 - clamp(e / IX.fold);
        line = 1 - easeInOut((e - IX.fold) / IX.unline);
        pop = 1 - easeInOut((e - IX.fold - IX.unline) / IX.drop);
        detail = e < IX.fold + IX.unline + IX.drop;
        if (!detail) finishClose();
      }
    }
    const target = S.open || S.hover ? 1 : 0;
    S.dim = rm ? target : target > S.dim ? Math.min(target, S.dim + dt / IX.dim) : Math.max(target, S.dim - dt / IX.dim);
    // A pinned moment shows the dimming where the open motion has it, not where the wall clock has it.
    if (S.fixed != null && !rm && S.open && S.closeAt == null && !S.hover) S.dim = clamp(S.fixed / IX.dim);
    if (S.open || S.hover) S.dimId = S.open || S.hover;
    let peek = 0;
    if (S.peek) {
      peek = S.peekOut != null ? 1 - clamp((t - S.peekOut) / IX.fadeOut) : clamp((t - S.peekAt) / IX.fadeIn);
      if (rm) peek = S.peekOut != null ? 0 : 1;
      if (S.peekOut != null && peek <= 0) { S.peek = null; S.peekOut = null; }
    }
    X = { focus: S.dim > 0 ? S.dimId : null, dim: S.dim, pop: S.open ? pop : 0, popId: S.open, line, card, detail: Boolean(S.open) && detail,
      peek, peekId: S.peek, keyFocus: S.via === 'key' && !S.open ? S.hover : null };
    return X;
  }

  // ----- placing and painting the cards -----
  const anchorPeek = (id, w, h) => {
    const a = H.anchor(id), from = a.from || { x: a.x, y: a.y };
    return placeBeside({ at: a, from, facing: a.facing ?? 1, w, h, bounds: H.bounds(), flush: true, avoid: [...(a.avoid || []), a.keep], zone: a.zone || null });
  };
  const anchorDetail = (id, el) => {
    const a = H.anchor(id), from = a.from || { x: a.x, y: a.y };
    const keep = a.keep || { x0: a.x - 14, y0: a.y - 14, x1: a.x + 14, y1: a.y + 14 };
    return placeColumn({ el, facing: a.facing ?? 1, width: H.detailWidth, bounds: H.bounds(), words: a.avoid || [], keep, anchorY: a.y, hug: H.hug,
      leader: card => (H.leader ? H.leader(id, card) : [from, edgePoint(from, card)]) });
  };
  const peekPlace = H.peekPlace || anchorPeek, detailPlace = H.detailPlace || anchorDetail;

  function paintPeek() {
    const id = X.peekId;
    const show = id && H.has(id) && X.peek > 0.01 && !S.open && !(H.inPlace && H.inPlace(id));
    if (lines) lines.peek.setAttribute('d', '');
    if (!show) { if (!peekEl.hidden) peekEl.hidden = true; S.peekBox = null; return; }
    const seen = H.seen(), key = `${indexOf(id)}:${id}:${seenKey(seen)}`;
    if (S.peekKey !== key) {
      S.peekKey = key;
      const f = H.facts(id);
      peekEl.dataset.id = id;
      peekEl.innerHTML = (H.peekHTML || peekHTML)(f, { seen, asks: H.asks(f, seen) });
      peekEl.hidden = false;
      const w = peekEl.offsetWidth, h = peekEl.offsetHeight, p = peekPlace(id, w, h);
      S.peekBox = { x0: p.x, y0: p.y, x1: p.x + w, y1: p.y + h, from: p.from };
      peekEl.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
    peekEl.hidden = false;
    peekEl.style.opacity = X.peek.toFixed(3);
    if (lines && S.peekBox) {
      const r = S.peekBox, to = nearestOn(r.from, r);
      lines.peek.setAttribute('d', `M${r.from.x.toFixed(1)},${r.from.y.toFixed(1)}L${to.x.toFixed(1)},${to.y.toFixed(1)}`);
      lines.peek.style.opacity = X.peek.toFixed(3);
    }
  }

  function paintDetail() {
    const id = S.open;
    if (!id || !S.view || !H.has(id)) { if (!detailEl.hidden || (lines && lines.detail.getAttribute('d'))) clearDetail(); return; }
    const key = `${S.view.i}:${id}`;
    if (S.detailKey !== key) {
      S.detailKey = key; S.place = null;
      detailEl.innerHTML = (H.detailHTML || detailHTML)(S.view, { seen: S.seen, asks: H.asks(S.view, S.seen), last: H.last, href: H.answerHref(S.view), trendH: H.trendH, pending: H.pending });
      detailEl.setAttribute('aria-label', `${S.view.short} · 第 ${S.view.i} 轮`);
      detailEl.scrollTop = 0;
    }
    if (!S.place) {
      // Measurable but not yet seen: the placement sets width and max-height and reads the height.
      detailEl.style.clipPath = 'inset(0 100% 100% 0)';
      detailEl.hidden = false;
      const p = detailPlace(id, detailEl);
      if (!p) return;
      const end = p.path.at(-1), ax = end.x - p.x, ay = end.y - p.y;
      // Which edge of the card the leader meets decides how it unfolds: along that edge first, then away from it.
      p.ax = ax; p.ay = ay; p.edge = ax <= 0.5 ? 'left' : ax >= p.w - 0.5 ? 'right' : ay <= 0.5 ? 'top' : 'bottom';
      S.place = p;
      if (lines) lines.detail.setAttribute('d', pathD(p.path));
    }
    const p = S.place, q = X.card;
    detailEl.hidden = false;
    if (lines) lines.detail.style.strokeDashoffset = (1 - X.line).toFixed(4);
    const kv = easeOut(q / 0.45), kh = easeOut((q - 0.15) / 0.85), cutW = (1 - kh) * (p.w - 1), cutH = (1 - kh) * (p.h - 1);
    const ins = p.edge === 'left' || p.edge === 'right'
      ? [(1 - kv) * p.ay, p.edge === 'left' ? cutW : 0, (1 - kv) * (p.h - p.ay), p.edge === 'right' ? cutW : 0]   // top, right, bottom, left
      : [p.edge === 'bottom' ? cutH : 0, (1 - kv) * (p.w - p.ax), p.edge === 'top' ? cutH : 0, (1 - kv) * p.ax];
    detailEl.style.clipPath = q >= 1 ? 'none' : `inset(${ins.map(v => `${v.toFixed(1)}px`).join(' ')})`;
    detailEl.style.visibility = q > 0 ? '' : 'hidden';
    detailEl.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    p.visible = q > 0 ? { x0: p.x + ins[3], y0: p.y + ins[0], x1: p.x + p.w - ins[1], y1: p.y + p.h - ins[2] } : null;
    if (S.viaKey && !S.focusMoved && q >= 1) { S.focusMoved = true; detailEl.focus({ preventScroll: true }); }
  }

  // ----- keyboard proxies: one visually hidden button per item; focus is a hover, Enter or Space opens -----
  function sync(key, items) {
    key = String(key);
    if (srEl.dataset.key === key || srEl.contains(document.activeElement)) return;
    srEl.dataset.key = key;
    const list = typeof items === 'function' ? items() : items;
    srEl.innerHTML = list.map(x => `<button type="button" data-ix="${esc(x.id)}" aria-label="${esc(x.label)}"></button>`).join('');
  }

  // ----- pointer, touch, keys -----
  function pointerItem(event) {
    const t = event.target;
    if (t.closest?.('.ix-detail')) return null;
    const tagged = t.closest?.('[data-id]');
    if (tagged && stage.contains(tagged)) return H.has(tagged.dataset.id) ? tagged.dataset.id : null;
    if (H.skip && t.closest?.(H.skip)) return null;
    const box = stage.getBoundingClientRect();
    return H.hit(event.clientX - box.left, event.clientY - box.top);
  }
  stage.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    const id = pointerItem(event);
    stage.style.cursor = id ? 'pointer' : '';
    if (id) hover(id, 'pointer');
    else if (S.via === 'pointer') hover(null);
  });
  stage.addEventListener('pointerleave', () => { if (S.via === 'pointer') hover(null); });
  stage.addEventListener('pointerdown', event => { S.pointer = event.pointerType || 'mouse'; });
  stage.addEventListener('click', event => {
    if (event.target.closest('.ix-detail')) { if (event.target.closest('[data-x="close"]')) close(); return; }
    if (event.target.closest('a, button')) return;
    const id = pointerItem(event);
    // Touch has no hover: the first tap on an item is the hover, a second tap (or a tap on its card) opens it.
    if (id && S.pointer === 'touch' && S.hover !== id && S.open !== id) { hover(id, 'touch'); return; }
    if (id) { if (S.open === id && S.closeAt == null) close(); else open(id); return; }
    if (S.open) close(); else if (S.hover && S.via !== 'key') hover(null, 'now');
  });
  srEl.addEventListener('focusin', event => { const id = event.target.dataset?.ix; if (id) hover(id, 'key'); });
  srEl.addEventListener('focusout', event => { if (S.via === 'key' && !srEl.contains(event.relatedTarget)) hover(null, 'now'); });
  srEl.addEventListener('click', event => {
    const id = event.target.closest('[data-ix]')?.dataset.ix;
    if (id) { if (S.open === id && S.closeAt == null) close(); else open(id, true); }
  });
  // Enter and Space on a proxy or inside the card are theirs, not the page's (play, step).
  const own = event => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation(); };
  srEl.addEventListener('keydown', own);
  detailEl.addEventListener('keydown', own);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.target.matches?.('input,textarea,select,[contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (S.open) { event.preventDefault(); close(); } else if (S.hover) hover(null, 'now');
  });
  // A click outside the stage that is not on a control (the panels, the concept card) also folds an open detail back.
  document.addEventListener('click', event => {
    if (S.open && !event.target.closest?.('button, a') && !stage.contains(event.target)) close();
  });

  const ctl = {
    s: S,
    get X() { return X; },
    get view() { return S.view; },
    frame,
    paint() { paintPeek(); paintDetail(); },
    sync, reset, hover, open, close,
    relayout() { S.peekKey = ''; S.place = null; },
    owns: node => Boolean(node && (srEl.contains(node) || peekEl.contains(node) || detailEl.contains(node))),
    live: () => Boolean(S.hover || S.open || S.peek || S.dim > 0 || S.leaveTimer),
    /** The cards' visible rectangles (for a concept layer that steps aside under them). */
    rects() {
      const list = [];
      if (S.peekBox && X.peek > 0.05 && !peekEl.hidden) list.push(S.peekBox);
      const v = S.place?.visible;
      if (v && v.x1 - v.x0 > 1 && v.y1 - v.y0 > 1) list.push(v);
      return list;
    },
    /** The leaders, for a host that draws them itself: the detail's polyline drawn to `progress`, the summary's line. */
    leaders() {
      const r = S.peekBox;
      return {
        detail: S.open && S.place && X.line > 0 ? { points: S.place.path, progress: X.line } : null,
        peek: r && X.peek > 0.01 && !S.open ? { from: r.from, to: nearestOn(r.from, r), alpha: X.peek } : null,
      };
    },
    hooks() {
      const named = name => H.named(name);
      return {
        hover: name => hover(named(name), 'pointer'), unhover: () => hover(null, 'now'),
        open: name => open(named(name)), close: () => close(), ixAt: at => { S.fixed = at ?? null; }, ix: S,
        paused: () => isHeld(),
        // Where an item is on the page (for driving a real pointer in checks).
        pointOf: name => {
          const id = named(name), p = id && H.pointOf(id);
          if (!p) return null;
          const box = stage.getBoundingClientRect();
          return { x: box.left + p.x, y: box.top + p.y };
        },
        // What scripts/check-ix.mjs reads.
        ixState: () => ({
          hover: S.hover, open: S.open, paused: isHeld(), peek: !peekEl.hidden && Number(peekEl.style.opacity || 1) > 0.5,
          inPlace: Boolean(S.hover && H.inPlace && H.inPlace(S.hover)),
          detail: !detailEl.hidden && detailEl.style.visibility !== 'hidden', clip: detailEl.style.clipPath,
          focus: document.activeElement?.dataset?.ix ? 'proxy' : detailEl.contains(document.activeElement) ? 'detail' : '',
        }),
      };
    },
  };
  return ctl;
}
