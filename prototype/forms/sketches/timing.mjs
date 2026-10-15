// 02 回应时序（完整版）：借电路时序图的总线画法。每件登记过问题的事一条泳道，按流分组；登记中的问题是
// 一格“总线值”，格里写着问的是什么；条目改写而没有重登记时回到中线。横轴是真实时间，此刻之后只画已知期限。
// 朱红只表示你的回应，只画刻度；原文在悬停与详情里按需展开。右栏是此刻仍开着的问题，按期限排。
//
// 帧切换不重绘：整张两周的图只建一次，靠一条裁剪矩形把“此刻”之前的部分露出来；此刻线、浅底与开着的
// 箭头随时间补间移动，格子的开闭样式与右栏在切帧时更新。
import { frames, records, at, isStory, localHours, dayOf, weekdayOf, formatTime, fitText, textWidth, categoryName, rootOf } from './kit.mjs';
const MONO = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
import {
  mountLivePage, askPaths, pathByKey, pathStatus, dueOf, responses, reminders, responseById, streamOf, STREAMS, hasStreams,
  itemAt, factOf, dossierHTML, actionSentence, EXPECT_WORDS, CLOSE_WORDS, tween, timed, markHover, createTip, createDrawer,
  esc, span, dayTime, openFor,
} from './live.mjs';

const KEY = `
  <span><svg width="40" height="14"><polygon points="1,7 6,1 34,1 39,7 34,13 6,13" fill="#fff" stroke="var(--ink)" stroke-width="1.3"/></svg>开着的问题（格长 = 开了多久）</span>
  <span><svg width="40" height="14"><polygon points="1,7 6,1 34,1 39,7 34,13 6,13" class="tm-k-answered"/></svg>答后关上</span>
  <span><svg width="40" height="14"><polygon points="1,7 6,1 34,1 39,7 34,13 6,13" fill="none" stroke="var(--ink-2)" stroke-dasharray="3 2"/></svg>改写后失效</span>
  <span><svg width="22" height="14"><polygon points="1,7 5,1 17,1 21,7 17,13 5,13" fill="none" stroke="var(--ink-2)"/><line x1="21" y1="0" x2="21" y2="14" stroke="var(--ink)" stroke-width="2"/></svg>随事项撤下</span>
  <span><svg width="40" height="14"><line x1="6" y1="0" x2="6" y2="14" stroke="var(--vermilion)" stroke-width="2"/><circle cx="6" cy="2" r="2.4" fill="var(--vermilion)"/><line x1="18" y1="0" x2="18" y2="14" stroke="var(--vermilion)" stroke-width="2"/><rect x="15.8" y="0" width="4.4" height="4.4" fill="var(--vermilion)"/><line x1="30" y1="0" x2="30" y2="14" stroke="var(--vermilion)" stroke-width="2"/></svg>你的回应：决定 · 报告已做 · 回复</span>
  <span><svg width="14" height="14"><line x1="7" y1="7" x2="7" y2="14" stroke="var(--vermilion)" stroke-width="1.5" opacity=".7"/></svg>短刻度 = 没有回答登记问题的动作</span>
  <span><svg width="26" height="14"><path d="M3 1 L11 1 L7 6 Z" fill="var(--ink)"/><rect x="12" y="3" width="13" height="9" fill="url(#tm-hatch-key)"/><defs><pattern id="tm-hatch-key" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="var(--ink)" stroke-width="1.2"/></pattern></defs></svg>期限 · 过期后仍开着</span>
  <span><svg width="16" height="14"><circle cx="8" cy="7" r="6.5" fill="var(--ink)"/><text x="8" y="10.5" font-size="9" text-anchor="middle" fill="var(--paper)" font-family="var(--mono)">1</text></svg>此刻开着，号码对应右栏</span>`;

const lerp = (a, b, p) => a + (b - a) * p;
const page = mountLivePage({
  id: 'timing', no: 2, name: '回应时序', key: KEY, storyFrame: 32, playEvery: 1300,
  relation: '每条回应路径的开与闭：问了你什么、开了多久，是被你的回应关上，还是改写后悄悄失效，又和期限谁先到。',
  onFrame, onKey,
});
const { figure, side } = page;
figure.innerHTML = '<div class="tm-canvas"></div>';
const canvas = figure.querySelector('.tm-canvas');
const tip = createTip(figure);
const drawer = createDrawer(page.body, { onClose: () => { pinned = null; applyHot(); } });

// ---------- lanes ----------
const laneItems = [...new Set(askPaths.map(path => path.item))];
const groupOf = id => (hasStreams ? streamOf(id) || 'other' : rootOf(id));
const groupOrder = hasStreams ? ['work', 'family', 'life', 'community', 'subscription', 'other'] : [...new Set(laneItems.map(rootOf).sort((a, b) => factOf(a).first - factOf(b).first))];
const groupLabel = g => (hasStreams ? STREAMS[g]?.label || '其他' : categoryName(g));
const firstPath = id => askPaths.find(path => path.item === id).from;
const lanes = [];
for (const g of groupOrder) {
  const ids = laneItems.filter(id => groupOf(id) === g)
    .sort((a, b) => (rootOf(a) === a ? 0 : 1) - (rootOf(b) === b ? 0 : 1) || firstPath(a) - firstPath(b) || factOf(a).first - factOf(b).first);
  ids.forEach((id, n) => lanes.push({ id, group: g, first: n === 0, child: rootOf(id) !== id }));
}
const groups = [...new Set(lanes.map(lane => lane.group))];
const laneOrder = new Map(lanes.map((lane, n) => [lane.id, n]));
const pathsInOrder = askPaths.slice().sort((a, b) => laneOrder.get(a.item) - laneOrder.get(b.item) || a.from - b.from);

// ---------- geometry ----------
const t0 = at(0) - 3 * 3600000, t1 = at(frames.length - 1) + 12 * 3600000;
let G = null;
function geometry() {
  const W = figure.clientWidth, H = figure.clientHeight;
  const LABEL = 200, X0 = LABEL + 10, X1 = W - 32;
  const AXIS = 28, STRIP = 32, top = AXIS + STRIP + 10, GROUP = 18;
  const laneH = Math.max(22, Math.min(46, (H - top - groups.length * GROUP - 6) / lanes.length));
  let y = top;
  const laneY = new Map();
  lanes.forEach(lane => { if (lane.first) y += GROUP; laneY.set(lane.id, y + laneH / 2); y += laneH; });
  const x = t => X0 + (t - t0) / (t1 - t0) * (X1 - X0);
  return { W, H, LABEL, X0, X1, AXIS, STRIP, top, GROUP, laneH, laneY, x, ch: Math.min(18, laneH - 10), stripBase: AXIS + STRIP };
}

const hexagon = (xa, xb, cy, h) => {
  const s = Math.min(5, Math.max(0, (xb - xa) / 2));
  return `${xa.toFixed(1)},${cy} ${(xa + s).toFixed(1)},${cy - h / 2} ${(xb - s).toFixed(1)},${cy - h / 2} ${xb.toFixed(1)},${cy} ${(xb - s).toFixed(1)},${cy + h / 2} ${(xa + s).toFixed(1)},${cy + h / 2}`;
};
const maxEvents = Math.max(1, ...frames.map(f => f.events.length));

function build() {
  G = timed('builds', () => {
    const g = geometry();
    const { W, H, LABEL, X0, X1, AXIS, stripBase, laneH, laneY, x, ch } = g;
    let grid = '', axis = '', strip = '', stripLive = '', groupsSvg = '', lanesSvg = '', gated = '', live = '';
    for (const t of localHours(t0, t1, 0)) grid += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${AXIS - 4}" y2="${H}" class="tm-day"/>`;
    for (const noon of localHours(t0, t1, 12)) axis += `<text x="${x(noon).toFixed(1)}" y="12" class="tm-daynum">${dayOf(noon)}</text><text x="${x(noon).toFixed(1)}" y="24" class="tm-weekday">${esc(weekdayOf(noon))}</text>`;
    // Batch strip: every frame is a target; bars (height = inputs) only up to now.
    const perInput = (g.STRIP - 6) / maxEvents;
    frames.forEach((f, i) => {
      const fx = x(at(i)), prev = i ? x(at(i - 1)) : fx - 12, next = i < frames.length - 1 ? x(at(i + 1)) : fx + 12;
      const quiet = f.signal?.type === 'review' || f.events.length === 0;
      strip += `<line x1="${fx.toFixed(1)}" x2="${fx.toFixed(1)}" y1="${stripBase}" y2="${stripBase - 3}" class="tm-slot"/>`;
      stripLive += quiet ? `<rect x="${(fx - 1.5).toFixed(1)}" y="${stripBase - 6}" width="3" height="6" class="tm-bar is-quiet"/>`
        : `<rect x="${(fx - 1.5).toFixed(1)}" y="${(stripBase - 2 - f.events.length * perInput).toFixed(1)}" width="3" height="${(2 + f.events.length * perInput).toFixed(1)}" class="tm-bar"/>`;
      strip += `<rect x="${((prev + fx) / 2).toFixed(1)}" y="${AXIS}" width="${((next - prev) / 2).toFixed(1)}" height="${g.STRIP}" class="tm-hit" data-frame="${i}"/>`;
    });
    groupsSvg += `<text x="0" y="${stripBase - 4}" class="tm-strip-label">整理批次</text><text x="0" y="${stripBase + 8}" class="tm-strip-sub">高 = 收到的输入</text>`;
    // Lanes.
    let groupStart = null;
    for (const lane of lanes) {
      const cy = laneY.get(lane.id);
      if (lane.first) {
        groupStart = cy - laneH / 2 - g.GROUP;
        const count = lanes.filter(l => l.group === lane.group).length;
        groupsSvg += `<line x1="0" x2="${W}" y1="${(groupStart + 2).toFixed(1)}" y2="${(groupStart + 2).toFixed(1)}" class="tm-rule"/>
          <text x="0" y="${(groupStart + 14).toFixed(1)}" class="tm-group">${esc(groupLabel(lane.group))}<tspan class="tm-group-n"> ${count} 件</tspan></text>`;
      }
      let segs = '', dues = '';
      // Lifeline: solid while active, dotted while withdrawn.
      const hist = factOf(lane.id).hist;
      let runStart = null, runStatus = null;
      const flush = end => {
        if (runStart == null || !runStatus) return;
        segs += `<line x1="${x(runStart).toFixed(1)}" x2="${x(end).toFixed(1)}" y1="${cy}" y2="${cy}" class="tm-life${runStatus === 'withdrawn' ? ' is-out' : ''}"/>`;
      };
      hist.forEach((item, i) => {
        const status = item && item.status !== 'merged' ? item.status : null;
        if (status !== runStatus) { flush(at(i)); runStart = status ? at(i) : null; runStatus = status; }
      });
      flush(t1);
      // Cells, one per ask path.
      for (const path of askPaths.filter(p => p.item === lane.id)) {
        const xa = x(path.opened), xb = x(path.closed ?? t1), due = dueOf(path);
        segs += `<g class="tm-cell is-open" data-path="${esc(path.key)}"><polygon points="${hexagon(xa, xb, cy, ch)}"/><text x="${(xa + 7).toFixed(1)}" y="${cy + 3.6}"></text>${path.end === 'withdrawn' || path.end === 'merged' ? `<line x1="${xb.toFixed(1)}" x2="${xb.toFixed(1)}" y1="${cy - ch / 2 - 3}" y2="${cy + ch / 2 + 3}" class="tm-end"/>` : ''}</g>`;
        // Past its deadline and still open: hatched from the deadline on (drawn over the cell).
        if (due && Date.parse(due) < (path.closed ?? t1)) {
          const xd = Math.max(xa, x(Date.parse(due)));
          segs += `<rect x="${xd.toFixed(1)}" y="${cy - ch / 2 + 1}" width="${Math.max(0, xb - xd - 1).toFixed(1)}" height="${ch - 2}" class="tm-overdue"/>`;
        }
        if (due) {
          const t = Date.parse(due), inside = t <= t1, dx = inside ? x(t) : X1 + 6;
          const label = `期限 ${dayTime(due)}`, lw = textWidth(label, 9, 400, MONO) + 2;
          const lx = inside ? (dx + 7 + lw > W ? dx - 7 - lw : dx + 7) : dx - 4 - lw;
          dues += `<g class="tm-due${inside ? '' : ' is-far'}" data-due-of="${esc(path.key)}">${inside
            ? `<path d="M${(dx - 4).toFixed(1)} ${cy - laneH / 2 + 1} L${(dx + 4).toFixed(1)} ${cy - laneH / 2 + 1} L${dx.toFixed(1)} ${cy - laneH / 2 + 6} Z"/><line x1="${dx.toFixed(1)}" x2="${dx.toFixed(1)}" y1="${cy - laneH / 2 + 5}" y2="${cy + ch / 2}"/>`
            : `<path d="M${dx - 6} ${cy - 4} L${dx} ${cy} L${dx - 6} ${cy + 4}" class="tm-far"/>`}<text x="${lx.toFixed(1)}" y="${(cy - laneH / 2 + 7).toFixed(1)}">${esc(label)}</text></g>`;
        }
      }
      // The person's responses: full ticks answer the registered question; short ticks only touch the item.
      for (const r of responses.filter(r => r.item === lane.id)) {
        const rx = x(r.at).toFixed(1), m = r.link.meaning;
        if (r.path) {
          segs += `<g class="tm-tick" data-resp="${esc(r.id)}" data-path="${esc(r.path)}"><line x1="${rx}" x2="${rx}" y1="${cy - ch / 2 - 3}" y2="${cy + ch / 2 + 3}"/>${m === 'decide' ? `<circle cx="${rx}" cy="${cy - ch / 2 - 3}" r="2.4"/>` : m === 'act' ? `<rect x="${(x(r.at) - 2.2).toFixed(1)}" y="${cy - ch / 2 - 5}" width="4.4" height="4.4"/>` : ''}<line x1="${rx}" x2="${rx}" y1="${cy - ch / 2 - 4}" y2="${cy + ch / 2 + 4}" class="tm-hit"/></g>`;
        } else {
          segs += `<g class="tm-tick is-loose" data-resp="${esc(r.id)}"><line x1="${rx}" x2="${rx}" y1="${cy + ch / 2 + 1}" y2="${cy + ch / 2 + 7}"/><line x1="${rx}" x2="${rx}" y1="${cy + ch / 2}" y2="${cy + ch / 2 + 9}" class="tm-hit"/></g>`;
        }
        if (r.link.meaning === 'snooze' && r.link.until) {
          const ux = x(Date.parse(r.link.until)), topY = cy - laneH / 2 + 2;
          gated += `<path class="tm-snooze" data-at="${r.at}" d="M${rx} ${cy - ch / 2 - 3} C ${+rx + 10} ${topY - 6}, ${ux - 10} ${topY - 6}, ${ux.toFixed(1)} ${cy - ch / 2 - 3}"/>`;
        }
      }
      for (const r of reminders.filter(r => r.item === lane.id)) segs += `<circle class="tm-reminder" cx="${x(r.at).toFixed(1)}" cy="${cy + ch / 2 + 5}" r="3"><title>到点提醒</title></circle>`;
      lanesSvg += `<g class="tm-lane" data-lane="${esc(lane.id)}"><rect class="tm-lane-hit" x="0" y="${cy - laneH / 2}" width="${W}" height="${laneH}" data-lane="${esc(lane.id)}"/>
        <g class="tm-label" data-lane="${esc(lane.id)}" tabindex="0" role="button"><text x="${lane.child ? 12 : 0}" y="${cy + 4}"></text></g>
        <g clip-path="url(#tm-reveal)">${segs}</g>${dues}</g>`;
      live += `<g class="tm-openmark is-pending" data-path="" data-lane="${esc(lane.id)}"><path d="M0 ${cy - 6} L6 ${cy} L0 ${cy + 6}" class="tm-chev"/><circle cx="15" cy="${cy}" r="7"/><text x="15" y="${cy + 3.3}"></text></g>`;
    }
    canvas.innerHTML = `<svg class="tm-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="回应路径时序">
      <defs><clipPath id="tm-reveal"><rect x="0" y="0" width="${X0}" height="${H}"/></clipPath>
        <pattern id="tm-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" class="tm-hatch-line"/></pattern></defs>
      <rect class="tm-future" x="${X0}" y="${AXIS - 4}" width="${W - X0}" height="${H - AXIS + 4}"/>
      <g>${grid}</g><g>${axis}</g>
      <g class="tm-strip">${strip}<g clip-path="url(#tm-reveal)">${stripLive}</g></g>
      <g>${groupsSvg}</g>
      <g class="tm-lanes">${lanesSvg}</g>
      <g class="tm-gated">${gated}</g>
      <g class="tm-nowmark"><line class="tm-nowline" x1="0" x2="0" y1="${AXIS - 4}" y2="${H}"/><text class="tm-nowtext" x="5" y="${AXIS + 9}"></text></g>
      <g class="tm-live">${live}</g>
    </svg>`;
    const svg = canvas.querySelector('svg');
    const refs = {
      svg, clip: svg.querySelector('#tm-reveal rect'), future: svg.querySelector('.tm-future'), nowmark: svg.querySelector('.tm-nowmark'), nowtext: svg.querySelector('.tm-nowtext'),
      lanes: new Map([...svg.querySelectorAll('.tm-lane')].map(el => [el.dataset.lane, el])),
      labels: new Map([...svg.querySelectorAll('.tm-label')].map(el => [el.dataset.lane, el])),
      cells: new Map([...svg.querySelectorAll('.tm-cell')].map(el => [el.dataset.path, el])),
      dues: [...svg.querySelectorAll('.tm-due')], snoozes: [...svg.querySelectorAll('.tm-snooze')],
      marks: new Map([...svg.querySelectorAll('.tm-openmark')].map(el => [el.dataset.lane, el])),
    };
    return { ...g, ...refs };
  });
  shownIndex = null;
}

// ---------- per-frame state ----------
let nowT = at(page.index), shownIndex = null, cancelTween = () => {};
let hot = null, pinned = null, openOrder = [];

function setNow(t) {
  const { x, clip, future, nowmark, nowtext, W, X0 } = G;
  const nx = x(t);
  clip.setAttribute('width', Math.max(X0, nx).toFixed(1));
  future.setAttribute('x', nx.toFixed(1));
  future.setAttribute('width', Math.max(0, W - nx).toFixed(1));
  nowmark.setAttribute('transform', `translate(${nx.toFixed(1)},0)`);
  const flip = nx + 6 + G.nowTextW > W;
  nowtext.setAttribute('x', flip ? -5 : 5);
  nowtext.setAttribute('text-anchor', flip ? 'end' : 'start');
  // Whatever belongs to a question or an item appears when the moving "now" reaches it, not before.
  for (const el of G.marks.values()) {
    const opened = Number(el.dataset.opened || Infinity);
    el.classList.toggle('is-pending', t < opened - 60000);
    if (el.dataset.path) el.setAttribute('transform', `translate(${nx.toFixed(1)},0)`);
  }
  for (const el of G.dues) el.classList.toggle('is-known', t >= Number(el.dataset.opened));
  for (const el of G.labels.values()) el.classList.toggle('is-hidden', t < Number(el.dataset.first));
}

function sortOpen(index) {
  const now = at(index);
  return askPaths.filter(path => pathStatus(path, index).state === 'open').sort((a, b) => {
    const da = dueOf(a), db = dueOf(b);
    if (da && db) return Date.parse(da) - Date.parse(db);
    if (da || db) return da ? -1 : 1;
    return a.opened - b.opened;
  });
}

function applyFrame(index) {
  const now = at(index), { x } = G;
  openOrder = sortOpen(index);
  const number = new Map(openOrder.map((path, n) => [path.key, n + 1]));
  // Cells: open / closed style as of this frame, and text fitted to what is visible now.
  for (const path of askPaths) {
    const el = G.cells.get(path.key), status = pathStatus(path, index);
    el.setAttribute('class', `tm-cell ${status.state === 'open' ? 'is-open' : status.state === 'closed' ? `is-${status.how} is-end-${path.end}` : 'is-future'}`);
    const visibleEnd = Math.min(path.closed ?? Infinity, now), room = x(visibleEnd) - x(path.opened) - 13;
    const text = el.querySelector('text');
    if (status.state === 'future' || room < 24) { text.textContent = ''; continue; }
    const fit = fitText(`${EXPECT_WORDS[path.ask.expects] || ''} · ${path.ask.prompt}`, room, 10, { minSize: 9 });
    text.textContent = fit.lines[0];
    text.setAttribute('font-size', fit.size);
  }
  // Lane labels appear once the item exists; titles follow the item's latest name.
  for (const lane of lanes) {
    const label = G.labels.get(lane.id), item = itemAt(lane.id, index), exists = factOf(lane.id).first <= index;
    label.dataset.first = at(factOf(lane.id).first);
    label.classList.toggle('is-gone', exists && factOf(lane.id).hist[index]?.status !== 'active');
    const textEl = label.querySelector('text');
    const fit = fitText(item.title, G.LABEL - (lane.child ? 22 : 10), lane.child ? 11 : 11.5, { minSize: 9.5, weight: lane.child ? 400 : 550 });
    if (textEl.textContent !== fit.lines[0]) textEl.textContent = fit.lines[0];
    textEl.setAttribute('font-size', fit.size);
    label.setAttribute('aria-label', `${item.title}：${askPaths.filter(p => p.item === lane.id && p.from <= index).length} 条回应路径`);
    const mark = G.marks.get(lane.id), open = openOrder.find(path => path.item === lane.id);
    mark.dataset.path = open ? open.key : '';
    mark.dataset.opened = open ? open.opened : '';
    if (open) mark.querySelector('text').textContent = number.get(open.key);
    mark.classList.toggle('is-late', !!open && !!dueOf(open) && Date.parse(dueOf(open)) < now);
  }
  // Deadlines: known once the question is registered; the label stays while it is ahead and the question open.
  for (const el of G.dues) {
    const path = pathByKey.get(el.dataset.dueOf), status = pathStatus(path, index), ahead = Date.parse(dueOf(path)) > now;
    el.dataset.opened = path.opened;
    el.classList.toggle('is-closed', status.state === 'closed');
    el.classList.toggle('is-ahead', status.state === 'open' && ahead);
  }
  for (const el of G.snoozes) el.classList.toggle('is-known', Number(el.dataset.at) <= now);
  G.nowtext.textContent = `此刻 ${frames[index].id} · ${formatTime(frames[index].at)}`;
  G.nowTextW = textWidth(G.nowtext.textContent, 10, 600, MONO) + 8;
  renderSide(index);
  if (pinned && drawer.isOpen) openDossier(pinned, index, false);
  applyHot();
}

function onFrame(index, previous, from) {
  if (!G) build();
  cancelTween();
  const fromT = nowT, toT = at(index);
  timed('frames', () => applyFrame(index));
  shownIndex = index;
  const duration = from === 'init' ? 0 : Math.min(520, 260 + Math.abs(index - (previous ?? index)) * 60);
  cancelTween = tween(duration, p => { nowT = lerp(fromT, toT, p); setNow(nowT); });
}

// ---------- side column: what is still open, by deadline ----------
function rowHTML(path, n, index) {
  const now = at(index), item = itemAt(path.item, index), due = dueOf(path);
  const late = due && Date.parse(due) < now;
  const dueText = due ? `期限 ${dayTime(due)} · ${late ? `已过 ${span(now - Date.parse(due))}` : `还有 ${span(Date.parse(due) - now)}`}` : '没有期限';
  return `<button class="tm-row${late ? ' is-late' : ''}" data-path="${esc(path.key)}" data-lane="${esc(path.item)}">
    <span class="tm-badge">${n}</span>
    <span class="tm-row-main"><span class="tm-row-top"><b>${esc(EXPECT_WORDS[path.ask.expects] || '')}</b> · ${esc(item.title)}</span>
    <span class="tm-row-q">${esc(path.ask.prompt)}</span>
    <span class="tm-row-meta"><em>${esc(dueText)}</em> · ${esc(openFor(now - path.opened))}${path.regs.filter(r => r.index <= index).length > 1 ? ` · 重登记 ${path.regs.filter(r => r.index <= index).length - 1} 次` : ''}</span></span></button>`;
}
function renderSide(index) {
  const now = at(index), frame = frames[index];
  const seen = askPaths.filter(path => path.from <= index);
  const tally = { answered: 0, replaced: 0, lapsed: 0, withdrawn: 0, merged: 0 };
  for (const path of seen) { const s = pathStatus(path, index); if (s.state === 'closed') tally[s.how] += 1; }
  const opened = askPaths.filter(path => path.from === index), closed = askPaths.filter(path => path.to === index);
  const answeredNow = responses.filter(r => r.index === index && r.path).length;
  const before = new Map([...side.querySelectorAll('.tm-row')].map(el => [el.dataset.path, el.getBoundingClientRect().top]));
  side.innerHTML = `<section class="tm-open">
      <h2>此刻仍开着 <b>${openOrder.length}</b> 个问题</h2>
      <div class="tm-tally">
        <div class="tm-units" aria-label="到此刻登记过的问题，每格一个，按登记先后">${seen.map(path => { const s = pathStatus(path, index); return `<i class="tm-unit is-${s.state === 'open' ? 'open' : s.how}" data-path="${esc(path.key)}" data-lane="${esc(path.item)}"></i>`; }).join('')}</div>
        <p>登记过 <b>${seen.length}</b>${[[tally.answered, '答后关上'], [tally.replaced, '换成新问题'], [tally.lapsed, '改写后失效'], [tally.withdrawn + tally.merged, '随事项撤下']].filter(([n]) => n).map(([n, w]) => `<span>${w} <b>${n}</b></span>`).join('')}</p>
      </div>
      <p class="tm-sub">按期限排：有期限的在前，过期的标出；没有期限的，开得久的在前。</p>
      <div class="tm-rows">${openOrder.map((path, n) => rowHTML(path, n + 1, index)).join('') || '<p class="tm-empty">此刻没有登记中的问题。</p>'}</div>
    </section>
    <section class="tm-frame">
      <h3>这一帧 · ${esc(frame.id)}</h3>
      <p class="tm-frame-title">${esc(frame.title)}</p>
      ${frame.narrative ? `<p class="tm-narr">${esc(frame.narrative)}</p>` : ''}
      <p class="tm-frame-n">${[opened.length && `新登记 ${opened.length}`, closed.length && `关上 ${closed.length}`, answeredNow && `你回应了 ${answeredNow} 次`, `收到输入 ${frame.events.length} 条`].filter(Boolean).join(' · ')}</p>
    </section>`;
  // FLIP: rows that stay slide from where they were; new ones fade in.
  const rows = [...side.querySelectorAll('.tm-row')];
  for (const row of rows) {
    const old = before.get(row.dataset.path);
    if (old == null) { row.classList.add('is-new'); continue; }
    const dy = old - row.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    row.style.transform = `translateY(${dy}px)`;
    row.style.transition = 'none';
  }
  requestAnimationFrame(() => rows.forEach(row => { row.style.transition = ''; row.style.transform = ''; row.classList.remove('is-new'); }));
}

// ---------- hover, pin, dossier ----------
let lit = [];
function applyHot(event) {
  const active = hot || pinned;
  for (const el of lit) el.classList.remove('is-hot');
  lit = [];
  G.svg.classList.toggle('has-hot', !!active);
  side.classList.toggle('has-hot', !!active);
  if (active) {
    const lane = G.lanes.get(active.item);
    if (lane) lit.push(lane);
    const mark = G.marks.get(active.item);
    if (mark) lit.push(mark);
    if (active.path) { const cell = G.cells.get(active.path); if (cell) lit.push(cell); }
    for (const el of side.querySelectorAll(`[data-lane="${CSS.escape(active.item)}"]`)) lit.push(el);
    for (const el of lit) el.classList.add('is-hot');
  }
  if (event) markHover(event, lit[0]);
}
function targetOf(el) {
  if (!el) return null;
  if (el.dataset.resp) { const r = responseById.get(el.dataset.resp); return { item: r.item, path: r.path, resp: r.id }; }
  if (el.dataset.path) { const p = pathByKey.get(el.dataset.path); return p ? { item: p.item, path: p.key } : null; }
  if (el.dataset.lane) return { item: el.dataset.lane, path: null };
  return null;
}
function tipHTML(target, index) {
  const now = at(index);
  if (target.resp) {
    const r = responseById.get(target.resp);
    return `<b class="is-you">${esc(actionSentence(r))}</b><small>${esc(dayTime(r.event.at))} · ${r.path ? '回答了登记的问题' : '没有回答登记的问题'}</small><small>点开看原文与这件事的全部记录</small>`;
  }
  if (target.path) {
    const path = pathByKey.get(target.path), s = pathStatus(path, index), due = dueOf(path);
    const state = s.state === 'open' ? `开着 · ${openFor(now - path.opened)}` : s.state === 'closed' ? `${CLOSE_WORDS[s.how]} · 开了 ${span(path.closed - path.opened)}` : '';
    return `<b>${esc(EXPECT_WORDS[path.ask.expects] || '')} · ${esc(path.ask.prompt)}</b><small>${esc(itemAt(path.item, index).title)}</small><small>${esc(state)}${due ? ` · 期限 ${esc(dayTime(due))}` : ''} · 你回应 ${path.answers.filter(r => r.at <= now).length} 次</small>`;
  }
  const item = itemAt(target.item, index);
  return `<b>${esc(item.title)}</b><small>${askPaths.filter(p => p.item === target.item && p.from <= index).length} 条回应路径 · 点开看全部记录</small>`;
}
function openDossier(target, index, scroll = true) {
  const html = dossierHTML(target.item, index, { pathKey: target.path, responseId: target.resp });
  drawer.open(html, `${target.item}|${target.path}|${target.resp}`, { scrollTo: scroll ? (target.resp ? `[data-resp="${CSS.escape(target.resp)}"]` : target.path ? `[data-path="${CSS.escape(target.path)}"]` : null) : null });
}
function pin(target) {
  pinned = target;
  if (!target) { drawer.close(); applyHot(); return; }
  openDossier(target, page.index);
  applyHot();
  const q = new URLSearchParams(location.search);
  q.set('item', target.item);
  if (target.path) q.set('ask', target.path); else q.delete('ask');
  history.replaceState(null, '', `?${q}`);
}

const HOVERABLE = '[data-resp],[data-path],[data-lane],[data-frame]';
figure.addEventListener('pointermove', event => {
  const el = event.target.closest(HOVERABLE);
  if (!el) { tip.hide(); if (hot) { hot = null; applyHot(event); } return; }
  if (el.dataset.frame) {
    const f = frames[Number(el.dataset.frame)];
    tip.show(`<b>${esc(f.id)} · ${esc(dayTime(f.at))}</b><small>${esc(f.title)}</small><small>收到 ${f.events.length} 条${f.signal?.coverage ? ` · ${esc(f.signal.coverage)}` : ''} · 点击或拖动跳帧</small>`, event.clientX, event.clientY, `f${f.id}`);
    return;
  }
  const target = targetOf(el);
  if (!target) return;
  if (!(hot && hot.item === target.item && hot.path === target.path && hot.resp === target.resp)) { hot = target; applyHot(event); }
  tip.show(tipHTML(target, page.index), event.clientX, event.clientY, `${target.item}|${target.path}|${target.resp}|${page.index}`);
});
figure.addEventListener('pointerleave', () => { tip.hide(); hot = null; applyHot(); });
figure.addEventListener('click', event => {
  const el = event.target.closest('[data-resp],[data-path],[data-lane],[data-frame]');
  if (!el) return;
  if (el.dataset.frame) { page.goFrame(Number(el.dataset.frame)); return; }
  const target = targetOf(el);
  if (target) pin(target);
});
// Drag along the batch strip to scrub.
figure.addEventListener('pointerdown', event => {
  const el = event.target.closest('[data-frame]');
  if (!el) return;
  const svg = G.svg;
  svg.setPointerCapture(event.pointerId);
  const move = e => {
    const box = svg.getBoundingClientRect(), t = t0 + (e.clientX - box.left - G.X0) / (G.X1 - G.X0) * (t1 - t0);
    let best = 0;
    frames.forEach((f, i) => { if (Math.abs(at(i) - t) < Math.abs(at(best) - t)) best = i; });
    if (best !== page.index) page.goFrame(best);
  };
  const up = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', up);
});
side.addEventListener('pointerover', event => {
  const el = event.target.closest('[data-path]');
  if (!el) return;
  const target = targetOf(el);
  if (hot?.path === target.path) return;
  hot = target;
  applyHot(event);
});
side.addEventListener('pointerleave', () => { hot = null; applyHot(); });
side.addEventListener('click', event => { const el = event.target.closest('[data-path]'); if (el) pin(targetOf(el)); });
page.body.addEventListener('keydown', event => {
  const el = event.target.closest?.('.tm-label');
  if (el && event.key === 'Enter') { pin({ item: el.dataset.lane, path: null }); event.preventDefault(); }
});
page.body.addEventListener('focusin', event => {
  const el = event.target.closest?.('.tm-label,[data-path]');
  if (!el) return;
  hot = targetOf(el);
  applyHot();
});

function onKey(event) {
  if (event.key === 'Escape') {
    if (drawer.isOpen) { drawer.close(); return true; }
    if (pinned || hot) { pinned = null; hot = null; applyHot(); return true; }
    return false;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const list = pathsInOrder.filter(path => path.from <= page.index);
    if (!list.length) return true;
    const current = (pinned || hot)?.path;
    const k = list.findIndex(path => path.key === current);
    const next = list[(k < 0 ? (event.key === 'ArrowDown' ? 0 : list.length - 1) : (k + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length)];
    const target = { item: next.item, path: next.key };
    if (drawer.isOpen) pin(target); else { hot = target; applyHot(); }
    const box = G.cells.get(next.key).getBoundingClientRect();
    tip.show(tipHTML(target, page.index), box.left + 10, box.bottom - 8, `${target.item}|${target.path}|undefined`);
    return true;
  }
  if (event.key === 'Enter' && (hot || pinned) && !event.target.closest?.('button,.tm-label,summary,a')) { pin(hot || pinned); return true; }
  return false;
}

let resizeTimer = 0;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { build(); applyFrame(page.index); setNow(at(page.index)); }, 120); });

build();
page.start();
const q = new URLSearchParams(location.search);
if (q.get('ask') && pathByKey.has(q.get('ask'))) pin({ item: pathByKey.get(q.get('ask')).item, path: q.get('ask') });
else if (q.get('item') && factOf(q.get('item'))) pin({ item: q.get('item'), path: null });
globalThis.foldForm = { id: 'timing', goFrame: page.goFrame, get index() { return page.index; }, pin, hover: target => { hot = target; applyHot(); } };
