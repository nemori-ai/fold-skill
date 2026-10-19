// 02 回应时序（完整版）：借电路时序图的总线画法。每件登记过问题的事一条泳道，按流分组；登记中的问题是
// 一格“总线值”，格里写着问的是什么；条目改写而没有重登记时回到中线。横轴是真实时间，此刻之后只画已知期限。
// 朱红只表示你的回应，只画刻度；原文在详情与抽屉里按需展开。右栏是此刻仍开着的问题，按期限排。
//
// 动画（polish/timing-motion.md）：时间本身就是动画。整张两周的图只建一次，一条裁剪矩形把“此刻”之前露出来；
// 此刻线只向前缓出、不过冲，登记、重新登记、关上、改名、计数都在此刻线到达批次刻度的那一帧硬切，你的回应与
// 期限在此刻线经过它们时出现。期限按每次登记时的期限画，被改掉的旧期限画灰。
// - 直接打开（顶层、地址不带 ?frame=、不是从别处链来）讲一遍约 24 秒的故事：英雄问题由规则选出（两周里登记次数
//   最多，并列取开得久的），三拍是登记、等、别人先开口；任意键或点空白跳到终态（最后一帧），「▶ 讲一遍」重演。
//   其余情形（?frame=、画廊缩略图、合页嵌入、从别处链来）静止在那一帧。?at=<秒> 停在故事的那一刻（截静帧用）。
// - ▶ 连播：每 12 小时约 1 秒，此刻线缓出走完、在刻度上停 0.12 秒硬切；←/→、选帧与合页顶栏选帧走 0.38 秒的
//   节拍过渡（往回时离散量一帧回到那一轮，此刻线缓动回去，不倒放事件）。
// - 概念层只有两样，都在泳道之外：批次条里一粒一条输入的灰点（落在它自己的时刻上，到刻度时扫进那一轮的柱子），
//   和此刻线身后约 6 小时宽、0.6 秒衰减的浅灰拖尾；只在时间走时动，prefers-reduced-motion 时不画。
// 交互接 motion/ix.mjs：悬停一条时序线（格、泳道名、号码圈、右栏的行、登记方块）出概要卡，悬停朱红刻度出动作句；
// 点击沿格自身向上弹出 8 px、引线出到详情卡（含放大的时间轴），页头与右栏切到“这一件”；悬停与展开都让故事或连播
// 停在当前时刻。钩子 window.foldTiming 与 foldDial 同名同义。
import { frames, records, at, localHours, dayOf, weekdayOf, formatTime, fitText, textWidth, categoryName, rootOf } from './kit.mjs';
import {
  mountLivePage, askPaths, pathByKey, pathStatus, responses, reminders, responseById, streamOf, STREAMS, hasStreams,
  itemAt, factOf, dossierHTML, actionSentence, EXPECT_WORDS, CLOSE_WORDS, timed, createTip, createDrawer,
  esc, span, dayTime, eventById, reducedMotion, SLOW, scenario,
} from './live.mjs';
import { createIx, placeBeside, IX } from '../motion/ix.mjs';
import { withDataset } from '../../data/select.mjs';
import { familyPlace } from '../../variants/shared.mjs?v=feedback-loop-1';

const MONO = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
const HOUR = 3600000;
const last = frames.length - 1;
const params = new URLSearchParams(location.search);
const lerp = (a, b, p) => a + (b - a) * p;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeInOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
// Fast start, settles with an overshoot of about 3.7 % (as IX): the cursor moving between lanes.
const easeOutBack = k => { const u = clamp(k) - 1; return 1 + 2 * u ** 3 + u ** 2; };
const hash01 = text => { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return (h >>> 0) / 4294967296; };
const wall = () => performance.now() / 1000;

// ---------- beats (seconds; timing-motion.md 第 3 节) ----------
// A round of 12 hours: the now-line eases out over it in 0.38 s and holds 0.12 s on the batch tick, where everything
// discrete cuts. ▶ plays 12 hours in about a second (0.88 moving + 0.12 on the tick); ← / → step in 0.38 s.
const BEAT = { round: 0.38, hold: 0.12, play: 0.88, step: 0.38, jumpMax: 0.9, perHour: 1 / 12 };

const KEY = `
  <span><svg width="40" height="14"><polygon points="1,7 6,1 34,1 39,7 34,13 6,13" fill="#fff" stroke="var(--ink)" stroke-width="1.3"/><path d="M20 1v3.2M20 13v-3.2" stroke="var(--ink)" stroke-width="1.2"/></svg>开着的问题（格长 = 开了多久，刻痕 = 重新登记）</span>
  <span><svg width="40" height="14"><polygon points="1,7 6,1 34,1 39,7 34,13 6,13" class="tm-k-answered"/></svg>答后关上</span>
  <span><svg width="40" height="14"><polygon points="1,7 6,1 34,1 39,7 34,13 6,13" fill="none" stroke="var(--ink-2)" stroke-dasharray="3 2"/></svg>改写后失效</span>
  <span><svg width="22" height="14"><polygon points="1,7 5,1 17,1 21,7 17,13 5,13" fill="none" stroke="var(--ink-2)"/><line x1="21" y1="0" x2="21" y2="14" stroke="var(--ink)" stroke-width="2"/></svg>随事项撤下</span>
  <span><svg width="40" height="14"><line x1="6" y1="0" x2="6" y2="14" stroke="var(--vermilion)" stroke-width="2"/><circle cx="6" cy="2" r="2.4" fill="var(--vermilion)"/><line x1="18" y1="0" x2="18" y2="14" stroke="var(--vermilion)" stroke-width="2"/><rect x="15.8" y="0" width="4.4" height="4.4" fill="var(--vermilion)"/><line x1="30" y1="0" x2="30" y2="14" stroke="var(--vermilion)" stroke-width="2"/></svg>你的回应：决定 · 报告已做 · 回复</span>
  <span><svg width="14" height="14"><line x1="7" y1="7" x2="7" y2="14" stroke="var(--vermilion)" stroke-width="1.5" opacity=".7"/></svg>短刻度 = 没有回答登记问题的动作</span>
  <span><svg width="38" height="14"><path d="M3 1 L11 1 L7 6 Z" fill="var(--ink)"/><path d="M13 1 L21 1 L17 6 Z" fill="var(--ink-3)"/><rect x="24" y="3" width="13" height="9" fill="url(#tm-hatch-key)"/><defs><pattern id="tm-hatch-key" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="var(--ink)" stroke-width="1.2"/></pattern></defs></svg>期限（灰 = 已被改掉的旧期限）· 过期后仍开着</span>
  <span><svg width="12" height="14"><circle cx="6" cy="7" r="2.6" fill="var(--ink)"/></svg>墨点 = 关上它的声明所引的输入</span>
  <span><svg width="30" height="14"><rect x="2" y="0" width="3.2" height="14" fill="var(--ink)"/><circle cx="18" cy="7" r="6" fill="var(--ink)"/><circle cx="18" cy="7" r="6.8" fill="none" stroke="var(--ink)" stroke-width="1.4"/><text x="18" y="10.2" font-size="8.5" text-anchor="middle" fill="var(--paper)" font-family="var(--mono)">1</text></svg>此刻开着，号码对应右栏；粗线是游标</span>`;

// ---------- the page frame ----------
const page = mountLivePage({
  id: 'timing', no: 2, name: '回应时序', key: KEY, storyFrame: 32,
  relation: '每条回应路径的开与闭：问了你什么、开了多久，是被你的回应关上，还是改写后悄悄失效，又和期限谁先到。',
  tools: '<button class="lv-help-btn tm-tell" data-tm-tell title="把开得最久的一件从登记讲到关上（约 24 秒，任意键跳过）">▶ 讲一遍</button>',
  onFrame, onKey, onPlay: togglePlay,
});
const { figure, side } = page;
figure.innerHTML = '<div class="tm-canvas"></div>';
const canvas = figure.querySelector('.tm-canvas');
const tip = createTip(figure);
const drawer = createDrawer(page.body, {});
const $date = document.querySelector('.lv-date'), $title = document.querySelector('.lv-title');

// ---------- facts from the replay (live.mjs askPaths; timing-motion.md 第 2 节的口径) ----------
const pathsByItem = new Map();
for (const path of askPaths) { if (!pathsByItem.has(path.item)) pathsByItem.set(path.item, []); pathsByItem.get(path.item).push(path); }
const isSelfEvent = event => Boolean(event?.self) || event?.from === scenario.persona?.name;
const hoursOf = ms => Math.floor(ms / HOUR + 1e-9);
const hm = ms => { const m = Math.round(Math.abs(ms) / 60000), h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h} 小时 ${r} 分` : `${h} 小时`) : `${r} 分钟`; };
const hoursText = ms => (ms >= HOUR ? `${hoursOf(ms)} 小时` : `${Math.max(1, Math.round(ms / 60000))} 分钟`);
const clock = value => formatTime(value);

// The deadline of each registration: the question's own due_at, else its item's at that registration. Consecutive
// registrations with the same deadline are one step; a step that a later one replaced is an old deadline (grey).
const dueCache = new Map();
function dueSteps(path) {
  if (dueCache.has(path.key)) return dueCache.get(path.key);
  const steps = [];
  for (const reg of path.regs) {
    const value = reg.ask.due_at || records[reg.index].snapshot.items[path.item]?.due_at || null;
    const due = value ? Date.parse(value) : null;
    if (!steps.length || steps.at(-1).due !== due) steps.push({ index: reg.index, due });
  }
  steps.forEach((s, n) => { s.until = steps[n + 1]?.index ?? null; });
  dueCache.set(path.key, steps);
  return steps;
}
/** The deadline in force at frame k (the step of the latest registration up to k). */
function dueAt(path, k) {
  const steps = dueSteps(path);
  let due = steps[0]?.due ?? null;
  for (const s of steps) if (s.index <= k) due = s.due;
  return due;
}
const firstAnswer = path => path.answers.filter(r => r.at <= (path.closed ?? Infinity)).sort((a, b) => a.at - b.at)[0] || null;
const declOf = path => (path.to == null ? null : frames[path.to].batch?.declarations?.find(d => d.id === path.item) || null);
/** Who wrote an input and where: family names and chats as the action sentences word them, else the source's own. */
function placeOf(event, source = null) {
  if (isSelfEvent(event)) return { who: '你', where: (source?.channel || event.channel || '').split(' · ')[0] };
  const family = familyPlace(event);
  if (family) return family;
  return { who: String(source?.author || event?.from || '').split(' · ')[0], where: String(source?.channel || event?.channel || '').split(' · ')[0] };
}
/** The inputs the closing declaration cites, other people's only, inside the path's life: the ink dots. */
const sourceCache = new Map();
function closeSources(path) {
  if (sourceCache.has(path.key)) return sourceCache.get(path.key);
  const out = [];
  for (const source of declOf(path)?.sources || []) {
    const event = String(source.ref || '').startsWith('event:') ? eventById(source.ref.slice(6)) : null;
    if (!event || isSelfEvent(event)) continue;
    const t = Date.parse(event.at);
    if (t >= path.opened && t <= path.closed) out.push({ t, event, source, ...placeOf(event, source) });
  }
  out.sort((a, b) => a.t - b.t);
  sourceCache.set(path.key, out);
  return out;
}
/** The path whose life a response falls in (the one it answers first), for popping it with its cell. */
function windowPath(r) {
  if (r.path) return pathByKey.get(r.path);
  return (pathsByItem.get(r.item) || []).find(p => r.at >= p.opened && r.at <= (p.closed ?? Infinity)) || null;
}
const nearestPath = r => windowPath(r) || [...(pathsByItem.get(r.item) || [])].reverse().find(p => p.opened <= r.at) || pathsByItem.get(r.item)?.[0] || null;
const movesOn = (path, upto) => responses.filter(r => r.item === path.item && r.at >= path.opened && r.at <= Math.min(path.closed ?? Infinity, upto));

// The hero (timing-motion.md 第 3 节): registered most often over the two weeks, ties to the one open longest. The
// frames follow from the rule, never from constants.
const lifeOf = path => (path.closed ?? at(last)) - path.opened;
const heroPath = askPaths.slice().sort((a, b) => b.regs.length - a.regs.length || lifeOf(b) - lifeOf(a) || a.from - b.from)[0] || null;

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
const t0 = at(0) - 3 * HOUR, t1 = at(last) + 12 * HOUR;
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
// The person's responses: full ticks answer the registered question; short ticks only touch the item.
function tickSVG(r, cy, x, ch) {
  const rx = x(r.at).toFixed(1), m = r.link.meaning, id = esc(r.id);
  if (r.path) {
    return `<g class="tm-tick" data-id="r:${id}" data-resp="${id}"><line x1="${rx}" x2="${rx}" y1="${cy - ch / 2 - 3}" y2="${cy + ch / 2 + 3}"/>${m === 'decide' ? `<circle cx="${rx}" cy="${cy - ch / 2 - 3}" r="2.4"/>` : m === 'act' ? `<rect x="${(x(r.at) - 2.2).toFixed(1)}" y="${cy - ch / 2 - 5}" width="4.4" height="4.4"/>` : ''}<line x1="${rx}" x2="${rx}" y1="${cy - ch / 2 - 4}" y2="${cy + ch / 2 + 4}" class="tm-hit"/></g>`;
  }
  return `<g class="tm-tick is-loose" data-id="r:${id}" data-resp="${id}"><line x1="${rx}" x2="${rx}" y1="${cy + ch / 2 + 1}" y2="${cy + ch / 2 + 7}"/><line x1="${rx}" x2="${rx}" y1="${cy + ch / 2 - 2}" y2="${cy + ch / 2 + 9}" class="tm-hit"/></g>`;
}

function build() {
  G = timed('builds', () => {
    const g = geometry();
    const { W, H, X0, AXIS, stripBase, laneH, laneY, x, ch } = g;
    let grid = '', axis = '', strip = '', stripLive = '', groupsSvg = '', lanesSvg = '', gated = '', live = '';
    for (const t of localHours(t0, t1, 0)) grid += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${AXIS - 4}" y2="${H}" class="tm-day"/>`;
    for (const noon of localHours(t0, t1, 12)) axis += `<text x="${x(noon).toFixed(1)}" y="12" class="tm-daynum">${dayOf(noon)}</text><text x="${x(noon).toFixed(1)}" y="24" class="tm-weekday">${esc(weekdayOf(noon))}</text>`;
    // Batch strip: every frame is a target; bars (height = inputs) only up to now.
    const perInput = (g.STRIP - 6) / maxEvents;
    frames.forEach((f, i) => {
      const fx = x(at(i)), prev = i ? x(at(i - 1)) : fx - 12, next = i < last ? x(at(i + 1)) : fx + 12;
      const quiet = f.signal?.type === 'review' || f.events.length === 0;
      strip += `<line x1="${fx.toFixed(1)}" x2="${fx.toFixed(1)}" y1="${stripBase}" y2="${stripBase - 3}" class="tm-slot"/>`;
      stripLive += quiet ? `<rect x="${(fx - 1.5).toFixed(1)}" y="${stripBase - 6}" width="3" height="6" class="tm-bar is-quiet"/>`
        : `<rect x="${(fx - 1.5).toFixed(1)}" y="${(stripBase - 2 - f.events.length * perInput).toFixed(1)}" width="3" height="${(2 + f.events.length * perInput).toFixed(1)}" class="tm-bar"/>`;
      strip += `<rect x="${((prev + fx) / 2).toFixed(1)}" y="${AXIS}" width="${((next - prev) / 2).toFixed(1)}" height="${g.STRIP}" class="tm-hit" data-frame="${i}"/>`;
    });
    groupsSvg += `<text x="0" y="${stripBase - 4}" class="tm-strip-label">整理批次</text><text x="0" y="${stripBase + 8}" class="tm-strip-sub">高 = 收到的输入</text>`;
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
      // Responses inside a path's life go with its cell (they step out with it); the rest stay on the lane.
      const lanePaths = pathsByItem.get(lane.id);
      const inside = new Map(lanePaths.map(p => [p.key, []])), outside = [];
      for (const r of responses.filter(r => r.item === lane.id)) { const p = windowPath(r); (p ? inside.get(p.key) : outside).push(r); }
      for (const path of lanePaths) {
        const xa = x(path.opened), xb = x(path.closed ?? t1);
        let inner = `<polygon points="${hexagon(xa, xb, cy, ch)}"/><text x="${(xa + 7).toFixed(1)}" y="${cy + 3.6}"></text>`;
        if (path.end === 'withdrawn' || path.end === 'merged') inner += `<line x1="${xb.toFixed(1)}" x2="${xb.toFixed(1)}" y1="${cy - ch / 2 - 3}" y2="${cy + ch / 2 + 3}" class="tm-end"/>`;
        // Past the deadline in force and still open: hatched (per registration step).
        for (const s of dueSteps(path)) {
          if (s.due == null) continue;
          const a = at(s.index), b = s.until != null ? at(s.until) : path.closed ?? t1;
          if (s.due >= b) continue;
          const xd = Math.max(x(a), x(s.due));
          inner += `<rect x="${xd.toFixed(1)}" y="${cy - ch / 2 + 1}" width="${Math.max(0, x(b) - xd - 1).toFixed(1)}" height="${ch - 2}" class="tm-overdue"/>`;
        }
        // A notch where the question was registered again (the item rewritten, the same question asked).
        for (const reg of path.regs.slice(1)) { const nx = x(at(reg.index)).toFixed(1); inner += `<path class="tm-notch" d="M${nx} ${cy - ch / 2}v3.2M${nx} ${cy + ch / 2}v-3.2"/>`; }
        // Ink dots: the inputs the closing declaration cites, shown once it has closed.
        for (const d of closeSources(path)) inner += `<circle class="tm-src" cx="${x(d.t).toFixed(1)}" cy="${cy}" r="2.5"/>`;
        for (const r of inside.get(path.key)) inner += tickSVG(r, cy, x, ch);
        segs += `<g class="tm-cell is-future" data-id="p:${esc(path.key)}" data-path="${esc(path.key)}">${inner}</g>`;
        dueSteps(path).forEach((s, n) => {
          if (s.due == null) return;
          const inRange = s.due <= t1, dx = inRange ? x(s.due) : g.X1 + 6;
          const label = `期限 ${dayTime(s.due)}`, lw = textWidth(label, 9, 400, MONO) + 2;
          const lx = inRange ? (dx + 7 + lw > W ? dx - 7 - lw : dx + 7) : dx - 4 - lw;
          dues += `<g class="tm-due${inRange ? '' : ' is-far'}" data-due-of="${esc(path.key)}" data-step="${n}">${inRange
            ? `<path d="M${(dx - 4).toFixed(1)} ${cy - laneH / 2 + 1} L${(dx + 4).toFixed(1)} ${cy - laneH / 2 + 1} L${dx.toFixed(1)} ${cy - laneH / 2 + 6} Z"/><line x1="${dx.toFixed(1)}" x2="${dx.toFixed(1)}" y1="${cy - laneH / 2 + 5}" y2="${cy + ch / 2}"/>`
            : `<path d="M${dx - 6} ${cy - 4} L${dx} ${cy} L${dx - 6} ${cy + 4}" class="tm-far"/>`}<text x="${lx.toFixed(1)}" y="${(cy - laneH / 2 + 7).toFixed(1)}">${esc(label)}</text></g>`;
        });
      }
      for (const r of outside) segs += tickSVG(r, cy, x, ch);
      for (const r of responses.filter(r => r.item === lane.id && r.link.meaning === 'snooze' && r.link.until)) {
        const rx = x(r.at), ux = x(Date.parse(r.link.until)), topY = cy - laneH / 2 + 2;
        gated += `<path class="tm-snooze" data-at="${r.at}" d="M${rx.toFixed(1)} ${cy - ch / 2 - 3} C ${(rx + 10).toFixed(1)} ${topY - 6}, ${(ux - 10).toFixed(1)} ${topY - 6}, ${ux.toFixed(1)} ${cy - ch / 2 - 3}"/>`;
      }
      for (const r of reminders.filter(r => r.item === lane.id)) segs += `<circle class="tm-reminder" cx="${x(r.at).toFixed(1)}" cy="${cy + ch / 2 + 5}" r="3"><title>到点提醒</title></circle>`;
      lanesSvg += `<g class="tm-lane" data-lane="${esc(lane.id)}"><rect class="tm-lane-hit" x="0" y="${cy - laneH / 2}" width="${W}" height="${laneH}"/>
        <g class="tm-label" data-lane="${esc(lane.id)}"><text x="${lane.child ? 12 : 0}" y="${cy + 4}"></text></g>
        <g clip-path="url(#tm-reveal)">${segs}</g>${dues}</g>`;
      live += `<g class="tm-openmark is-pending" data-lane="${esc(lane.id)}"><path d="M0 ${cy - 6} L6 ${cy} L0 ${cy + 6}" class="tm-chev"/><circle cx="15" cy="${cy}" r="7"/><text x="15" y="${cy + 3.3}"></text></g>`;
    }
    const conceptH = Math.ceil(stripBase + 6);
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.innerHTML = `<canvas class="tm-concept" width="${Math.round(W * dpr)}" height="${Math.round(conceptH * dpr)}" style="height:${conceptH}px" aria-hidden="true"></canvas>
      <svg class="tm-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="回应路径时序">
      <defs><clipPath id="tm-reveal"><rect x="0" y="0" width="${X0}" height="${H}"/></clipPath>
        <pattern id="tm-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" class="tm-hatch-line"/></pattern></defs>
      <rect class="tm-future" x="${X0}" y="${AXIS - 4}" width="${W - X0}" height="${H - AXIS + 4}"/>
      <g>${grid}</g><g>${axis}</g>
      <g class="tm-strip">${strip}<g clip-path="url(#tm-reveal)">${stripLive}</g></g>
      <g>${groupsSvg}</g>
      <g class="tm-lanes">${lanesSvg}</g>
      <g class="tm-gated">${gated}</g>
      <g class="tm-one" visibility="hidden"><path class="tm-bracket"/><text class="tm-bracket-n" text-anchor="end"></text><line class="tm-count"/></g>
      <g class="tm-nowmark"><line class="tm-nowline" x1="0" x2="0" y1="${AXIS - 4}" y2="${H}"/><text class="tm-nowtext" x="5" y="${AXIS + 9}"></text></g>
      <g class="tm-live">${live}<g class="tm-cursor" visibility="hidden"><rect class="tm-cursor-bar" x="-1.6" width="3.2"/><circle class="tm-cursor-ring" cx="15" cy="0" r="10"/></g></g>
    </svg>`;
    const svg = canvas.querySelector('svg');
    const cells = new Map([...svg.querySelectorAll('.tm-cell')].map(el => [el.dataset.path, el]));
    const refs = {
      svg, clip: svg.querySelector('#tm-reveal rect'), future: svg.querySelector('.tm-future'), nowmark: svg.querySelector('.tm-nowmark'),
      nowline: svg.querySelector('.tm-nowline'), nowtext: svg.querySelector('.tm-nowtext'),
      lanes: new Map([...svg.querySelectorAll('.tm-lane')].map(el => [el.dataset.lane, el])),
      labels: new Map([...svg.querySelectorAll('.tm-label')].map(el => [el.dataset.lane, el])),
      cells, srcs: new Map([...cells].map(([key, el]) => [key, [...el.querySelectorAll('.tm-src')]])),
      dues: [...svg.querySelectorAll('.tm-due')].map(el => { const path = pathByKey.get(el.dataset.dueOf); return { el, path, step: dueSteps(path)[Number(el.dataset.step)] }; }),
      snoozes: [...svg.querySelectorAll('.tm-snooze')],
      marks: new Map([...svg.querySelectorAll('.tm-openmark')].map(el => [el.dataset.lane, el])),
      one: svg.querySelector('.tm-one'), bracket: svg.querySelector('.tm-bracket'), bracketN: svg.querySelector('.tm-bracket-n'), count: svg.querySelector('.tm-count'),
      cursor: svg.querySelector('.tm-cursor'), cursorBar: svg.querySelector('.tm-cursor-bar'), cursorRing: svg.querySelector('.tm-cursor-ring'),
      concept: canvas.querySelector('.tm-concept'), conceptH, dpr,
      // Where the figure sits in the interaction's stage (the page body: figure and side panel).
      fx: figure.offsetLeft, fy: figure.offsetTop,
    };
    return { ...g, ...refs };
  });
  concept.ctx = G.concept.getContext('2d');
  concept.ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  concept.drawn = '';
  cellFlags.clear();
  dropShown = null; cur.y = null; cur.y1 = null; spotOn = false; page.body.classList.remove('is-spot');
}

// ---------- discrete state: everything that cuts on the batch tick ----------
let openOrder = [];
const cellFlags = new Map();
function sortOpen(k) {
  return askPaths.filter(path => pathStatus(path, k).state === 'open').sort((a, b) => {
    const da = dueAt(a, k), db = dueAt(b, k);
    if (da != null && db != null) return da - db;
    if (da != null || db != null) return da != null ? -1 : 1;
    return a.opened - b.opened;
  });
}
const repPath = (item, k) => (pathsByItem.get(item) || []).filter(p => p.from <= k).sort((a, b) => (pathStatus(b, k).state === 'open') - (pathStatus(a, k).state === 'open') || b.from - a.from)[0] || null;

function applyFrame(k) {
  const now = at(k), { x } = G;
  openOrder = sortOpen(k);
  const number = new Map(openOrder.map((path, n) => [path.key, n + 1]));
  for (const path of askPaths) {
    const el = G.cells.get(path.key), status = pathStatus(path, k);
    el.setAttribute('class', `tm-cell ${status.state === 'open' ? 'is-open' : status.state === 'closed' ? `is-${status.how} is-end-${path.end}` : 'is-future'}`);
    cellFlags.delete(path.key);
    for (const dot of G.srcs.get(path.key)) dot.setAttribute('class', `tm-src${status.state === 'closed' ? ' is-known' : ''}`);
    const visibleEnd = Math.min(path.closed ?? Infinity, now), room = x(visibleEnd) - x(path.opened) - 13;
    const text = el.querySelector('text');
    if (status.state === 'future' || room < 24) { text.textContent = ''; continue; }
    const fit = fitText(`${EXPECT_WORDS[path.ask.expects] || ''} · ${path.ask.prompt}`, room, 10, { minSize: 9 });
    text.textContent = fit.lines[0];
    text.setAttribute('font-size', fit.size);
  }
  // Lane labels appear once the item exists; titles follow the item's latest name (the rename cuts with the rest).
  for (const lane of lanes) {
    const label = G.labels.get(lane.id), item = itemAt(lane.id, k), exists = factOf(lane.id).first <= k;
    label.dataset.first = at(factOf(lane.id).first);
    label.classList.toggle('is-gone', exists && factOf(lane.id).hist[k]?.status !== 'active');
    const textEl = label.querySelector('text');
    const fit = fitText(item.title, G.LABEL - (lane.child ? 22 : 10), lane.child ? 11 : 11.5, { minSize: 9.5, weight: lane.child ? 400 : 550 });
    if (textEl.textContent !== fit.lines[0]) textEl.textContent = fit.lines[0];
    textEl.setAttribute('font-size', fit.size);
    const rep = repPath(lane.id, k);
    if (rep && exists) label.dataset.id = `p:${rep.key}`; else delete label.dataset.id;
    const mark = G.marks.get(lane.id), open = openOrder.find(path => path.item === lane.id);
    if (open) { mark.dataset.id = `p:${open.key}`; mark.dataset.opened = open.opened; mark.querySelector('text').textContent = number.get(open.key); }
    else { delete mark.dataset.id; mark.dataset.opened = ''; }
    const due = open ? dueAt(open, k) : null;
    mark.classList.toggle('is-late', due != null && due < now);
  }
  applyDues(k);
  for (const el of G.snoozes) el.classList.toggle('is-known', Number(el.dataset.at) <= now);
  G.nowtext.textContent = `此刻 ${frames[k].id} · ${formatTime(frames[k].at)}`;
  G.nowTextW = textWidth(G.nowtext.textContent, 10, 600, MONO) + 8;
  panelKey = '';
}
// Deadlines: known once that registration has happened; grey once a later registration moved them; the label shows
// while it is the one in force, ahead, and the question open. In the story the hero's lands 0.3 s after the cursor.
let dueGate = false;
function applyDues(k) {
  const now = at(k);
  for (const { el, path, step } of G.dues) {
    const status = pathStatus(path, k);
    const known = k >= step.index && !(dueGate && path === heroPath);
    const old = step.until != null && k >= step.until;
    el.classList.toggle('is-known', known);
    el.classList.toggle('is-old', old);
    el.classList.toggle('is-closed', status.state === 'closed');
    el.classList.toggle('is-ahead', known && !old && status.state === 'open' && step.due > now);
  }
}

// ---------- continuous state: the now-line ----------
function setNow(t) {
  const { x, clip, future, nowmark, nowtext, W, X0 } = G;
  const nx = x(t);
  clip.setAttribute('width', Math.max(X0, nx).toFixed(1));
  future.setAttribute('x', nx.toFixed(1));
  future.setAttribute('width', Math.max(0, W - nx).toFixed(1));
  nowmark.setAttribute('transform', `translate(${nx.toFixed(1)},0)`);
  const flip = nx + 6 + (G.nowTextW || 80) > W;
  nowtext.setAttribute('x', flip ? -5 : 5);
  nowtext.setAttribute('text-anchor', flip ? 'end' : 'start');
  // Whatever belongs to a question or an item appears when the moving "now" reaches it, not before.
  for (const el of G.marks.values()) {
    const opened = Number(el.dataset.opened || Infinity);
    el.classList.toggle('is-pending', !el.dataset.id || t < opened - 60000);
    if (el.dataset.id) el.setAttribute('transform', `translate(${nx.toFixed(1)},0)`);
  }
  for (const el of G.labels.values()) el.classList.toggle('is-hidden', t < Number(el.dataset.first));
}

// ---------- the player: one clock for the story, ▶ and the beat transitions ----------
// A track is a list of moves: the now-line goes from ta to tb over [s, e] with an easing; going forward, the frames it
// passes cut as it reaches their ticks and the last one cuts on arrival (cutDelay later, for the story's f23); going
// back, the discrete state cuts at once and only the line eases back.
const player = { mode: 'still', track: null, wall0: 0, held: false, heldAt: 0, heldTotal: 0, freeze: null, stopping: false, tau: 0, t: at(page.index), k: -1, moving: false };
function startTrack(track, mode) {
  player.track = track; player.mode = mode; player.stopping = false;
  player.wall0 = wall(); player.heldTotal = 0;
  if (player.held) player.heldAt = player.wall0;
}
const trackTime = () => ((player.held ? player.heldAt : wall()) - player.wall0 - player.heldTotal) / SLOW;
function lastAtOrBefore(t, lo, hi) { let k = lo; for (let i = lo; i <= hi; i += 1) if (at(i) <= t + 1) k = i; return k; }
function evalTrack(tr, tau) {
  let t = tr.t0, k = tr.k0, moving = false;
  for (const s of tr.segs) {
    if (tau < s.s) break;
    const back = s.kTo < s.kFrom || (s.kTo === s.kFrom && s.tb < s.ta);
    if (tau < s.e) {
      t = lerp(s.ta, s.tb, s.ease((tau - s.s) / (s.e - s.s)));
      k = back ? s.kTo : lastAtOrBefore(t, s.kFrom, Math.max(s.kFrom, s.kTo - 1));
      moving = true;
      break;
    }
    t = s.tb;
    k = back || tau >= s.e + (s.cutDelay || 0) ? s.kTo : Math.max(s.kFrom, s.kTo - 1);
  }
  return { t, k, moving };
}
const move = (s, e, kFrom, kTo, ease = easeOut, ta = at(kFrom)) => ({ s, e, ta, tb: at(kTo), kFrom, kTo, ease });

/** ← / →, the scrubber and the embedding page: one beat from wherever the line is now. */
function navigate(target) {
  const n = Math.abs(target - player.k);
  const dur = reducedMotion() || (target === player.k && player.t === at(target)) ? 0 : n <= 1 ? BEAT.step : Math.min(BEAT.jumpMax, BEAT.step + 0.04 * n);
  startTrack({ t0: player.t, k0: player.k, segs: [move(0, dur, player.k, target, easeOut, player.t)], T: dur }, 'step');
}
/** ▶: every round in its real length (12 hours ≈ 0.88 s), easing out into its tick and holding there 0.12 s. */
function playTrack() {
  const segs = [];
  let tau = 0, k = player.k, t = player.t;
  if (k >= last) { segs.push(move(0, 0.5, k, 0, easeOut, t)); tau = 0.7; k = 0; t = at(0); }
  for (; k < last; k += 1) {
    const dur = reducedMotion() ? 0 : clamp(BEAT.play * (at(k + 1) - t) / (12 * HOUR), 0.1, 2.0);
    segs.push(move(tau, tau + dur, k, k + 1, easeOut, t));
    tau += dur + BEAT.hold; t = at(k + 1);
  }
  return { t0: player.t, k0: player.k, segs, T: tau };
}
function togglePlay() {
  if (player.mode === 'play' && !player.stopping) { stopPlay(); return; }
  if (story.on) endStory();
  ix.reset();
  startTrack(playTrack(), 'play');
  page.root.classList.add('is-playing');
}
/** Space while playing: finish the round under way, stop on its tick. */
function stopPlay() {
  page.root.classList.remove('is-playing');
  if (player.mode !== 'play' || !player.track) return;
  const tau = trackTime(), segs = player.track.segs, n = segs.findIndex(s => tau < s.e);
  if (n < 0) { player.track.T = tau; } else { player.track.segs = segs.slice(0, n + 1); player.track.T = segs[n].e; }
  player.stopping = true;
}

// ---------- the story: 登记 / 等 / 别人先开口 (timing-motion.md 第 3 节) ----------
const story = { on: false, cue: null, presented: false, folded: false };
const tellMode = (() => {
  if (window.top !== window || params.has('frame') || params.get('mode') === 'play' || !heroPath) return false;
  if (params.has('at')) return true;
  try { if (document.referrer && new URL(document.referrer).pathname !== location.pathname) return false; } catch { return false; }
  return true;
})();
function storyTrack() {
  const h = heroPath, a = h.from, c = h.to, cue = {};
  const segs = [];
  // Beat 1: 0.4 s of stillness, the line drops from the axis, 1.5 s to the hero's registration; 0.4 s later the
  // cursor, 0.3 s after that its deadline.
  cue.line = 0.4;
  segs.push(move(0.7, 2.2, 0, a, easeInOut));
  cue.focus = 2.2 + 0.4; cue.due = cue.focus + 0.3;
  // Beat 2: every round in its real length (12 hours: 0.38 s easing out, 0.12 s on the tick) up to the round before it closes.
  let tau = 4.0;
  const stop = c != null ? c - 1 : last;
  for (let k = a; k < stop; k += 1) {
    const dur = clamp(BEAT.round * (at(k + 1) - at(k)) / (12 * HOUR), 0.08, 1.2);
    segs.push(move(tau, tau + dur, k, k + 1));
    tau += dur + BEAT.hold;
  }
  // Beat 3: hold on that cut, walk the last round more slowly, dim the rest 0.3 s before the closing cut, still 1.2 s,
  // then the zoom card (the detail, presented), its little now-line, still 1.5 s; fold, 1.5 s to the last frame.
  if (c != null) {
    tau += 0.5;
    segs.push({ ...move(tau, tau + 1.2, c - 1, c, easeInOut), cutDelay: 0.3 });
    cue.dark = tau + 1.2; cue.close = cue.dark + 0.3;
    cue.present = cue.close + 1.2;
    cue.zoom0 = cue.present + IX.card + IX.cardDur; cue.zoom1 = cue.zoom0 + 1.2;
    cue.fold = cue.zoom1 + 1.5;
    tau = cue.fold + IX.fold + IX.unline + IX.drop;
  }
  cue.light = tau;
  const from = c ?? stop;
  if (from < last) { segs.push(move(tau, tau + 1.5, from, last, easeInOut)); tau += 1.5; }
  cue.settle = tau; cue.swing = tau + 0.4;
  // The zoom card's little now-line walks to your first move after it closed (else half an hour past the close).
  const z = zoomWindow(h);
  const after = responses.find(r => r.item === h.item && r.at > (h.closed ?? Infinity) && r.at <= z.t1);
  cue.zoomFrom = z.t0; cue.zoomTo = after ? after.at : Math.min(z.t1, (h.closed ?? z.t0) + HOUR / 2);
  return { t0: at(0), k0: 0, segs, T: cue.swing + 0.6, cue };
}
function tell() {
  if (!heroPath) return;
  ix.reset(); drawer.close(); tip.hide();
  page.root.classList.remove('is-playing');
  if (reducedMotion()) { hold(last); return; }
  const tr = storyTrack();
  story.on = true; story.cue = tr.cue; story.presented = false; story.folded = false;
  player.k = -1;
  startTrack(tr, 'story');
  page.root.classList.add('is-telling');
}
/** End the story where it is (navigation takes over) or, skipping, at its last frame. */
function endStory() {
  if (!story.on) return;
  story.on = false; dueGate = false;
  if (ix.s.presented) ix.reset();
  page.root.classList.remove('is-telling');
  if (G) applyDues(Math.max(0, player.k));
}
function skipStory() { endStory(); hold(last); }
/** Stand still on frame i, no transition (foldTiming.hold, the end of a skipped story). */
function hold(i) {
  player.track = null; player.mode = 'still'; player.freeze = null;
  player.t = at(i);
  if (player.k !== i) commit(i);
  if (page.index !== i) page.goFrame(i, { from: 'play' });
}
const storyTau = () => player.tau;
function storyDepth(tau) {
  const c = story.cue;
  if (tau < c.focus) return 0;
  const base = 0.3 * clamp((tau - c.focus) / IX.dim);
  if (c.dark != null && tau >= c.dark) return tau >= c.light ? lerp(0.74, 0, clamp((tau - c.light) / 0.3)) : lerp(0.3, 0.74, clamp((tau - c.dark) / 0.3));
  return tau >= c.light ? lerp(0.3, 0, clamp((tau - c.light) / 0.3)) : base;
}
const storyFocus = () => story.on && storyTau() >= story.cue.focus && storyTau() < story.cue.settle;
// From the closing cut's dimming until the zoom card has folded, your earlier moves step back too, so the one move
// after it closed (in the card) is the only vermilion on the page.
let spotOn = false;
function setSpot(on) {
  if (on === spotOn) return;
  spotOn = on;
  G.svg.classList.toggle('is-spot', on);
  page.body.classList.toggle('is-spot', on);
}
function storyCues() {
  if (!story.on) { setSpot(false); return; }
  const c = story.cue, tau = storyTau(), id = `p:${heroPath.key}`;
  setSpot(c.dark != null && tau >= c.dark && tau < c.light);
  const gate = tau < c.due;
  if (gate !== dueGate) { dueGate = gate; if (player.k >= 0) applyDues(player.k); }
  if (c.present != null) {
    if (tau >= c.present && tau < c.fold && !story.presented) { story.presented = true; if (!ix.s.open) ix.present(id); }
    if (tau >= c.fold && !story.folded) { story.folded = true; if (ix.s.open === id && ix.s.presented) ix.close(); }
  }
}

// ---------- one frame ----------
function commit(k) {
  const forward = k > player.k;
  player.k = k;
  timed('frames', () => applyFrame(k));
  if (forward) { concept.sweep = { j: k, start: concept.clock }; for (const e of frames[k].events) concept.born.delete(e.id); }
  if ((player.mode === 'story' || player.mode === 'play') && page.index !== k) page.goFrame(k, { from: 'play' });
}
let X = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
let lastWall = 0, drawnT = null;
const perf = { on: params.has('perf'), times: [], work: [] };
function loop(ms) {
  const w = ms / 1000, dt = lastWall ? Math.min(0.1, w - lastWall) : 1 / 60;
  if (perf.on && lastWall) perf.times.push(w - lastWall);
  lastWall = w;
  if (G) {
    let s = { t: player.t, k: player.k, moving: false };
    if (player.track) {
      const tau = player.freeze ?? trackTime();
      player.tau = tau;
      s = evalTrack(player.track, tau);
      if (tau >= player.track.T && player.freeze == null) {
        const mode = player.mode;
        player.track = null; player.mode = 'still';
        if (mode === 'play') page.root.classList.remove('is-playing');
        if (mode === 'story') { story.on = false; dueGate = false; page.root.classList.remove('is-telling'); }
      }
    }
    if (s.k !== player.k) commit(s.k);
    player.t = s.t; player.moving = s.moving && !player.held;
    storyCues();
    if (player.t !== drawnT) { setNow(player.t); drawnT = player.t; }
    X = ix.frame();
    paintLineDrop();
    paintFocus();
    paintCursor();
    paintOne();
    drawConcept(dt);
    ix.paint();
    paintZoom();
    paintPanel();
    paintHeader();
    ix.sync(player.k, proxyItems);
  }
  if (perf.on) perf.work.push(performance.now() - ms);
  requestAnimationFrame(loop);
}
const proxyItems = () => pathsInOrder.filter(p => p.from <= player.k).map(p => {
  const s = pathStatus(p, player.k);
  return { id: `p:${p.key}`, label: `${EXPECT_WORDS[p.ask.expects] || ''} · ${p.ask.short || p.ask.prompt} · ${s.state === 'open' ? `已开 ${hoursOf(at(player.k) - p.opened)} 小时` : CLOSE_WORDS[s.how]}` };
});

// Beat 1 starts on an empty axis: the line drops from it at 0.4 s (the first move is small and on its anchor).
let dropShown = null;
function paintLineDrop() {
  const p = story.on ? clamp((storyTau() - story.cue.line) / 0.3) : 1;
  const v = story.on && storyTau() < story.cue.line ? -1 : p;
  if (v === dropShown) return;
  dropShown = v;
  G.nowmark.setAttribute('visibility', v < 0 ? 'hidden' : 'visible');
  G.nowline.setAttribute('y2', (G.AXIS - 4 + (G.H - G.AXIS + 4) * easeOut(Math.max(0, v))).toFixed(1));
  G.nowtext.style.opacity = v >= 1 ? '' : '0';
}

// Others drop to 70 % (hover, open, the story's one); in the story's third beat to 0.26. The open cell steps 8 px up.
const setOp = (el, v) => { const t = v >= 0.999 ? '' : v.toFixed(3); if (el._op !== t) { el._op = t; el.style.opacity = t; } };
const itemOf = id => (!id ? null : id.startsWith('r:') ? responseById.get(id.slice(2))?.item : pathByKey.get(id.slice(2))?.item);
const pathOfId = id => (!id ? null : id.startsWith('r:') ? nearestPath(responseById.get(id.slice(2))) : pathByKey.get(id.slice(2)));
let popped = null, focusLane = null, depthNow = 0;
function paintFocus() {
  let focus = null, depth = 0;
  if (X.dim > 0.001 && X.focus) { focus = itemOf(X.focus); depth = 0.3 * X.dim; }
  else if (story.on) { focus = heroPath.item; depth = storyDepth(storyTau()); }
  focusLane = focus; depthNow = depth;
  for (const [id, el] of G.lanes) {
    setOp(el, id === focus ? 1 : 1 - depth);
    const hot = id === focus && depth > 0.001;
    if (el._hot !== hot) { el._hot = hot; el.classList.toggle('is-hot', hot); }
  }
  for (const [id, el] of G.marks) setOp(el, id === focus ? 1 : 1 - depth);
  for (const row of side.querySelectorAll('.tm-row')) setOp(row, row.dataset.lane === focus ? 1 : 1 - depth);
  // The cell (with its notches, ticks and dots) steps out perpendicular to the time axis; the lane's midline stays.
  const key = X.popId && X.pop > 0.001 ? pathOfId(X.popId)?.key : null;
  if (popped && popped !== key) { G.cells.get(popped)?.removeAttribute('transform'); popped = null; }
  if (key) { G.cells.get(key).setAttribute('transform', `translate(0,${(-IX.pop * X.pop).toFixed(2)})`); popped = key; }
  // Hot (hovered or open) and keyboard-focused cells get a heavier frame.
  const hot = X.focus && X.dim > 0.001 ? pathOfId(X.focus)?.key : null, keyed = X.keyFocus ? pathOfId(X.keyFocus)?.key : null;
  for (const path of askPaths) {
    const flags = `${path.key === hot ? 'h' : ''}${path.key === keyed ? 'k' : ''}`;
    if ((cellFlags.get(path.key) || '') === flags) continue;
    cellFlags.set(path.key, flags);
    const el = G.cells.get(path.key);
    el.classList.toggle('is-hot', flags.includes('h'));
    el.classList.toggle('is-key', flags.includes('k'));
  }
}

// The cursor (ink): only on one question. In the story it lands on the hero and stays; then, and whenever the page is
// still or playing, on the side column's first (deadline nearest, else open longest); hollow on top of the line when
// nothing is open. It moves between lanes with the same 3.7 % overshoot as the step-out.
const cur = { y: null, y0: null, y1: null, t0: 0, hollow: false, ring: true };
function cursorTarget() {
  if (story.on && storyTau() < story.cue.focus) return null;
  const lane = story.on && storyTau() < story.cue.swing ? heroPath.item : openOrder[0]?.item;
  if (!lane) return { y: G.top + 6, hollow: true, ring: false };
  return { y: G.laneY.get(lane), hollow: false, ring: openOrder.some(p => p.item === lane) };
}
function paintCursor() {
  const target = cursorTarget();
  if (!target) { G.cursor.setAttribute('visibility', 'hidden'); cur.y = null; cur.y1 = null; return; }
  if (cur.y1 !== target.y || cur.hollow !== target.hollow) {
    // From where it was; on first landing, from a little above (it drops onto the lane).
    cur.y0 = cur.y ?? target.y - 12; cur.y1 = target.y; cur.t0 = wall(); cur.hollow = target.hollow;
    G.cursor.classList.toggle('is-hollow', target.hollow);
    G.cursorBar.setAttribute('y', (-(G.laneH / 2) + 3).toFixed(1)); G.cursorBar.setAttribute('height', (G.laneH - 6).toFixed(1));
    G.cursorRing.setAttribute('cx', target.hollow ? 0 : 15); G.cursorRing.setAttribute('r', target.hollow ? 5 : 10);
  }
  G.cursorRing.setAttribute('visibility', target.hollow || target.ring ? 'visible' : 'hidden');
  const p = reducedMotion() ? 1 : clamp((wall() - cur.t0) / 0.3);
  cur.y = lerp(cur.y0, cur.y1, easeOutBack(p));
  G.cursor.setAttribute('visibility', 'visible');
  G.cursor.setAttribute('transform', `translate(${G.x(player.t).toFixed(1)},${cur.y.toFixed(2)})`);
}

// The one under discussion (the story's hero, or the open detail): a thin ink bracket under its cell from the
// registration to the line, ending in the same number as the panel's, and a dashed line from the line to its deadline.
function onePath() {
  if (X.detail && ix.view) return ix.view.path;
  return storyFocus() ? heroPath : null;
}
function paintOne() {
  const path = onePath(), k = player.k;
  if (!path || path.from > k) { if (G.one._on) { G.one.setAttribute('visibility', 'hidden'); G.one._on = false; } return; }
  const cy = G.laneY.get(path.item), open = pathStatus(path, k).state === 'open';
  const x0 = G.x(path.opened), x1 = G.x(Math.min(path.closed ?? Infinity, player.t)), y = cy + G.ch / 2 + 3;
  G.bracket.setAttribute('d', `M${x0.toFixed(1)},${(y - 2.5).toFixed(1)}V${y.toFixed(1)}H${x1.toFixed(1)}V${(y - 2.5).toFixed(1)}`);
  const hours = hoursOf((open ? at(k) : path.closed) - path.opened);
  G.bracketN.textContent = `${hours} 小时`;
  G.bracketN.setAttribute('x', (x1 - 2).toFixed(1)); G.bracketN.setAttribute('y', (y + 9.5).toFixed(1));
  const due = dueAt(path, k), show = open && due != null && due > player.t && !(dueGate && path === heroPath);
  const a = G.x(player.t) + 24, b = due != null ? Math.min(G.W, G.x(due)) - 5 : 0;
  G.count.setAttribute('visibility', show && b > a + 4 ? 'visible' : 'hidden');
  if (show) { G.count.setAttribute('x1', a.toFixed(1)); G.count.setAttribute('x2', b.toFixed(1)); G.count.setAttribute('y1', cy); G.count.setAttribute('y2', cy); }
  G.one.setAttribute('transform', popped === path.key ? `translate(0,${(-IX.pop * X.pop).toFixed(2)})` : '');
  G.one.setAttribute('visibility', 'visible'); G.one._on = true;
}

// ---------- the concept layer: one grey dot an input, in the batch strip; a pale trail behind the line ----------
const concept = { ctx: null, clock: 0, born: new Map(), sweep: null, amp: 0, drawn: '' };
const INK = '31,45,38';
function drawConcept(dt) {
  const ctx = concept.ctx;
  if (!ctx) return;
  if (reducedMotion()) { if (concept.drawn !== 'off') { ctx.clearRect(0, 0, G.W, G.conceptH); concept.drawn = 'off'; } return; }
  if (!player.held) {
    concept.clock += dt;
    concept.amp = player.moving ? Math.min(1, concept.amp + dt / 0.12) : Math.max(0, concept.amp - dt / 0.6);
  }
  const k = player.k, t = player.t, j = k + 1, sw = concept.sweep;
  const sweeping = sw && concept.clock - sw.start < BEAT.hold * SLOW;
  const pending = j <= last ? frames[j].events : [];
  let falling = false;
  const alpha = 1 - 0.6 * X.dim;
  const key = `${t}|${k}|${concept.amp.toFixed(3)}|${sweeping}|${alpha.toFixed(3)}`;
  // Born times: when the line first reached each pending input (cleared when it goes back past it).
  for (const e of pending) {
    const te = Date.parse(e.at);
    if (te <= t) { if (!concept.born.has(e.id)) concept.born.set(e.id, concept.clock); if (concept.clock - concept.born.get(e.id) < 0.22 * SLOW) falling = true; }
    else concept.born.delete(e.id);
  }
  if (!falling && !sweeping && key === concept.drawn) return;
  concept.drawn = key;
  const { x, AXIS, stripBase } = G;
  ctx.clearRect(0, 0, G.W, G.conceptH);
  // Trail: about six hours behind the line, decaying over 0.6 s once it stops; only above the lanes.
  if (concept.amp > 0.01) {
    const xa = x(t - 6 * HOUR), xb = x(t), grad = ctx.createLinearGradient(xa, 0, xb, 0);
    grad.addColorStop(0, `rgba(${INK},0)`); grad.addColorStop(1, `rgba(${INK},${(0.1 * concept.amp * alpha).toFixed(3)})`);
    ctx.fillStyle = grad; ctx.fillRect(xa, AXIS - 4, xb - xa, stripBase - AXIS + 7);
  }
  const y0 = AXIS - 2, ya = AXIS + 3, yb = stripBase - 4, floor = x(at(k));
  ctx.fillStyle = `rgba(${INK},${(0.3 * alpha).toFixed(3)})`;
  for (const e of pending) {
    const te = Date.parse(e.at);
    if (te > t) continue;
    const p = easeOut((concept.clock - concept.born.get(e.id)) / (0.22 * SLOW)), ex = Math.max(floor + 1, x(te));
    ctx.globalAlpha = Math.min(1, p * 2);
    ctx.fillRect(ex - 0.8, lerp(y0, lerp(ya, yb, hash01(e.id)), p) - 0.8, 1.6, 1.6);
  }
  // At the tick the round's dots sweep into its bar, then the bar alone stands for them.
  if (sweeping && sw.j <= last) {
    const p = easeOut((concept.clock - sw.start) / (BEAT.hold * SLOW)), bx = x(at(sw.j));
    const lo = sw.j > 0 ? x(at(sw.j - 1)) : bx;
    for (const e of frames[sw.j].events) {
      const ex = Math.max(lo + 1, x(Date.parse(e.at)));
      ctx.globalAlpha = 1 - p;
      ctx.fillRect(lerp(ex, bx, p) - 0.8, lerp(lerp(ya, yb, hash01(e.id)), stripBase - 3, p) - 0.8, 1.6, 1.6);
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- the side column: what is still open, or 这一件 ----------
const linkD = k => withDataset(`../../index.html?variant=d&frame=${k}`);
/** “去回答 →” only for a question open in this frame; a closed one says how it closed, with no link (if the same
 *  item has another question open now, it is named, and that one carries its own link). */
function answerLinks(path, k) {
  if (pathStatus(path, k).state === 'open') return `<a class="tm-go" href="${esc(linkD(k))}">去回答 →</a>`;
  const other = (pathsByItem.get(path.item) || []).find(p => p !== path && pathStatus(p, k).state === 'open');
  const n = other ? openOrder.indexOf(other) + 1 : 0;
  return other ? `<span class="tm-go-note">这件事此刻另有一个开着的问题：${esc(other.ask.short || other.ask.prompt)}${n ? `（右栏 ${n} 号）` : ''}</span>` : '';
}
function rowHTML(path, n, k) {
  const now = at(k), item = itemAt(path.item, k), due = dueAt(path, k);
  const late = due != null && due < now;
  const dueText = due != null ? `期限 ${dayTime(due)} · ${late ? `已过 ${span(now - due)}` : `还有 ${span(due - now)}`}` : '没有期限';
  const regs = path.regs.filter(r => r.index <= k).length;
  return `<div class="tm-row${late ? ' is-late' : ''}" data-id="p:${esc(path.key)}" data-path="${esc(path.key)}" data-lane="${esc(path.item)}">
    <span class="tm-badge">${n}</span>
    <span class="tm-row-main"><span class="tm-row-top"><b>${esc(EXPECT_WORDS[path.ask.expects] || '')}</b> · ${esc(item.title)}</span>
    <span class="tm-row-q">${esc(path.ask.prompt)}</span>
    <span class="tm-row-meta"><em>${esc(dueText)}</em> · 已开 ${esc(hoursText(now - path.opened))}${regs > 1 ? ` · 重登记 ${regs - 1} 次` : ''}</span></span></div>`;
}
function overviewHTML(k) {
  const frame = frames[k];
  const seen = askPaths.filter(path => path.from <= k);
  const tally = { answered: 0, replaced: 0, lapsed: 0, withdrawn: 0, merged: 0 };
  for (const path of seen) { const s = pathStatus(path, k); if (s.state === 'closed') tally[s.how] += 1; }
  const opened = askPaths.filter(path => path.from === k), closed = askPaths.filter(path => path.to === k);
  const answeredNow = responses.filter(r => r.index === k && r.path).length;
  return `<section class="tm-open">
      <h2>此刻仍开着 <b>${openOrder.length}</b> 个问题</h2>
      <div class="tm-tally">
        <div class="tm-units" aria-label="到此刻登记过的问题，每格一个，按登记先后">${seen.map(path => { const s = pathStatus(path, k); return `<i class="tm-unit is-${s.state === 'open' ? 'open' : s.how}" data-id="p:${esc(path.key)}" data-path="${esc(path.key)}" data-lane="${esc(path.item)}"></i>`; }).join('')}</div>
        <p>登记过 <b>${seen.length}</b>${[[tally.answered, '答后关上'], [tally.replaced, '换成新问题'], [tally.lapsed, '改写后失效'], [tally.withdrawn + tally.merged, '随事项撤下']].filter(([n]) => n).map(([n, w]) => `<span>${w} <b>${n}</b></span>`).join('')}</p>
      </div>
      <p class="tm-sub">按期限排：有期限的在前，过期的标出；没有期限的，开得久的在前。</p>
      <div class="tm-rows">${openOrder.map((path, n) => rowHTML(path, n + 1, k) + (n === 0 ? `<a class="tm-row-go" href="${esc(linkD(k))}">去回答 →</a>` : '')).join('') || '<p class="tm-empty">此刻没有登记中的问题。</p>'}</div>
    </section>
    <section class="tm-frame">
      <h3>这一帧 · ${esc(frame.id)}</h3>
      <p class="tm-frame-title">${esc(frame.title)}</p>
      ${frame.narrative ? `<p class="tm-narr">${esc(frame.narrative)}</p>` : ''}
      <p class="tm-frame-n">${[opened.length && `新登记 ${opened.length}`, closed.length && `关上 ${closed.length}`, answeredNow && `你回应了 ${answeredNow} 次`, `收到输入 ${frame.events.length} 条`].filter(Boolean).join(' · ')}</p>
    </section>`;
}
const CLOSE_REASON = { replaced: '同一件事登记了新问题', lapsed: '条目被改写，没有重新登记这个问题', withdrawn: '事项被撤下', merged: '事项并入了另一件', answered: '你回应之后关上' };
/** The two clocks: how long it has been open, how long to its deadline (or, closed, how it stood when it closed). */
function dueLine(path, k) {
  const open = pathStatus(path, k).state === 'open', now = at(k);
  const due = dueAt(path, open ? k : path.to - 1);
  if (due == null) return '没有期限';
  if (open) return due > now ? `离期限 ${hoursText(due - now)}` : `已过期限 ${span(now - due)}`;
  const answer = pathStatus(path, k).how === 'answered' ? firstAnswer(path) : null;
  if (answer) return due >= answer.at ? `答在期限前 ${hm(due - answer.at)}` : `答在期限后 ${hm(answer.at - due)}`;
  return due > path.closed ? `离期限还差 ${hm(due - path.closed)}` : `过期限 ${hm(path.closed - due)}后才关上`;
}
function sourcesHTML(path) {
  const decl = declOf(path), list = (decl?.sources || []).map(source => {
    const event = String(source.ref || '').startsWith('event:') ? eventById(source.ref.slice(6)) : null;
    if (!event) return '';
    const p = placeOf(event, source);
    return `<li>${esc([p.where, p.who, dayTime(event.at)].filter(Boolean).join(' · '))}</li>`;
  }).filter(Boolean);
  return list.length ? `<ul class="tm-srcs">${list.join('')}</ul>` : '<p class="tm-muted">关上它的声明没有引用来源，所以图上不画墨点。</p>';
}
function closeHTML(path, k, heading = 'h3') {
  const s = pathStatus(path, k), decl = declOf(path), answer = s.how === 'answered' ? firstAnswer(path) : null;
  return `<${heading}>怎样关上 <small>${esc(CLOSE_WORDS[s.how])} · ${esc(dayTime(frames[path.to].at))} · ${esc(frames[path.to].id)}</small></${heading}>
    ${answer ? `<p>${esc(actionSentence(answer))}（${esc(dayTime(answer.event.at))}），之后关上。</p>` : ''}
    <p class="tm-reason">${esc(decl?.reason || CLOSE_REASON[path.end] || '')}</p>${sourcesHTML(path)}`;
}
function respRows(list, path, highlight) {
  return list.map(r => `<li${r.id === highlight ? ' class="is-current"' : ''}><time>${esc(dayTime(r.event.at))}</time>${esc(actionSentence(r))}<small>${r.path === path.key ? '回答了它' : '没有回答它'}</small></li>`).join('');
}
function oneHTML(path, k, highlight = null) {
  const now = at(k), s = pathStatus(path, k), open = s.state === 'open', item = itemAt(path.item, k);
  const end = open ? now : path.closed, life = end - path.opened, hours = hoursOf(life), mins = Math.round((life - hours * HOUR) / 60000);
  const rounds = (open ? k : path.to) - path.from, regs = path.regs.filter(r => r.index <= k);
  const regIdx = new Set(regs.map(r => r.index)), squares = [];
  for (let j = path.from; j < (open ? k + 1 : path.to); j += 1) squares.push(`<i class="${regIdx.has(j) ? 'is-reg' : ''}" title="${esc(frames[j].id)}${regIdx.has(j) ? ' · 登记' : ''}"></i>`);
  const moves = movesOn(path, now), answered = moves.filter(r => r.path === path.key).length;
  const after = open ? [] : responses.filter(r => r.item === path.item && r.at > path.closed && r.at <= now);
  return `<section class="tm-one-panel">
    <h2>这一件 <small>${esc(groupLabel(groupOf(path.item)))} · ${esc(EXPECT_WORDS[path.ask.expects] || path.ask.expects || '')}</small></h2>
    <p class="tm-one-item">${esc(item.title)}</p>
    <p class="tm-one-q">${esc(path.ask.short || path.ask.prompt)}</p>
    ${path.ask.short && path.ask.short !== path.ask.prompt ? `<p class="tm-one-prompt">${esc(path.ask.prompt)}</p>` : ''}
    <div class="tm-hero"><span class="tm-hero-k">${open ? '已开' : '开了'}</span><b>${hours}</b><span class="tm-hero-u">小时${!open && mins ? ` ${mins} 分` : ''}${open ? '' : ` · ${esc(CLOSE_WORDS[s.how])}`}</span></div>
    <p class="tm-hero-sub">${rounds} 轮 · 登记 ${regs.length} 次 · ${esc(dueLine(path, k))}</p>
    <div class="tm-regs" aria-label="开着的每一轮一格，登记过的那几轮实心">${squares.join('')}</div>
    <section><h3>你的回应 <small>${moves.length} 条，回答它 ${answered} 次</small></h3>
      ${moves.length ? `<ol class="tm-resp">${respRows(moves.slice(-6), path, highlight)}</ol>${moves.length > 6 ? `<p class="tm-muted">更早的 ${moves.length - 6} 条略去</p>` : ''}` : '<p class="tm-muted">到此刻你还没有在这件事上动过。</p>'}
      ${after.length ? `<h4>关上之后</h4><ol class="tm-resp">${respRows(after.slice(0, 3), path, highlight)}</ol>` : ''}</section>
    ${open ? '' : `<section>${closeHTML(path, k)}</section>`}
    <p class="tm-one-links">${answerLinks(path, k)}<button type="button" class="tm-dossier" data-tm-dossier="${esc(path.item)}|${esc(path.key)}">全部记录 →</button></p>
  </section>`;
}
let panelKey = '';
function paintPanel() {
  const k = player.k;
  let key = 'overview', path = null, highlight = null;
  if (X.detail && ix.view) { path = ix.view.path; highlight = ix.view.resp?.id || null; key = `one|${path.key}|${highlight}`; }
  else if (storyFocus()) { path = heroPath; key = `one|${path.key}`; }
  key += `|${k}`;
  if (key === panelKey) return;
  panelKey = key;
  if (path) { side.innerHTML = oneHTML(path, k, highlight); side.scrollTop = 0; return; }
  // FLIP: rows that stay slide from where they were; new ones fade in.
  const before = new Map([...side.querySelectorAll('.tm-row')].map(el => [el.dataset.path, el.getBoundingClientRect().top]));
  side.innerHTML = overviewHTML(k);
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
// The page head says 这一件 while a detail the reader opened is out (the story's own card keeps the narration).
let headerKey = '';
function paintHeader() {
  const own = X.detail && ix.view && !ix.s.presented, k = own ? player.k : page.index;
  const key = own ? `one|${ix.view.id}|${k}` : `frame|${k}`;
  if (key === headerKey) return;
  headerKey = key;
  const frame = frames[k];
  if (own) { $date.textContent = `这一件 · ${frame.id} · ${dayTime(frame.at)}`; $title.textContent = ix.view.short; }
  else { $date.textContent = `${dayTime(frame.at)} · ${frame.id} · ${records[k].state.revision}`; $title.textContent = frame.title; }
}

// ---------- the cards (ix.mjs draws them; this page writes what is on them) ----------
function factsOf(id) {
  const k = Math.max(0, player.k);
  if (id.startsWith('r:')) {
    const r = responseById.get(id.slice(2)), path = nearestPath(r);
    return { i: k, id, kind: 'resp', resp: r, path, short: actionSentence(r) };
  }
  const path = pathByKey.get(id.slice(2));
  return { i: k, id, kind: 'path', path, resp: null, short: path.ask.short || path.ask.prompt };
}
function whoPushed(path, k) {
  const s = pathStatus(path, k);
  if (s.state === 'closed') {
    if (s.how === 'answered') return '是你的回应关上的';
    const list = closeSources(path);
    return list.length ? `关上它的：${[...new Map(list.map(d => [`${d.who}${d.where}`, `${d.who}（${d.where}）`])).values()].join(' · ')}` : '关上它的声明没有引用来源';
  }
  const names = new Set();
  for (const source of itemAt(path.item, k)?.sources || []) {
    const event = String(source.ref || '').startsWith('event:') ? eventById(source.ref.slice(6)) : null;
    if (!event || isSelfEvent(event)) continue;
    const who = placeOf(event, source).who;
    if (who) names.add(who);
  }
  return names.size ? `推动它的：${[...names].slice(0, 4).join(' · ')}` : '';
}
function peekCard(f) {
  const k = f.i, now = at(k);
  if (f.kind === 'resp') {
    const r = f.resp;
    return `<div class="ix-k">你的回应 · ${esc(dayTime(r.event.at))}</div><div class="ix-q is-you">${esc(f.short)}</div>
      <div class="ix-d">${r.path ? `回答了登记的问题：${esc(pathByKey.get(r.path).ask.short || pathByKey.get(r.path).ask.prompt)}` : '没有回答登记的问题'}</div>
      <div class="ix-d">${esc(itemAt(r.item, k).title)}</div>`;
  }
  const path = f.path, s = pathStatus(path, k), open = s.state === 'open';
  const regs = path.regs.filter(r => r.index <= k), again = regs.length > 1 && regs.at(-1).index === k;
  const rounds = (open ? k : path.to) - path.from;
  const state = open ? `开着 · 已开 ${hoursOf(now - path.opened)} 小时（${rounds} 轮）` : `${CLOSE_WORDS[s.how]} · 开了 ${hoursOf(path.closed - path.opened)} 小时（${rounds} 轮）`;
  const due = dueAt(path, open ? k : path.to - 1);
  const dueText = due == null ? '没有期限' : `期限 ${dayTime(due)} · ${open ? (due > now ? `还有 ${hoursText(due - now)}` : `已过 ${span(now - due)}`) : dueLine(path, k)}`;
  const moves = movesOn(path, now), answered = moves.filter(r => r.path === path.key).length, who = whoPushed(path, k);
  return `<div class="ix-k">${esc(EXPECT_WORDS[path.ask.expects] || '')} · ${esc(groupLabel(groupOf(path.item)))}</div><div class="ix-q">${esc(f.short)}</div>
    <div class="ix-d">${esc(itemAt(path.item, k).title)}</div>
    <div class="ix-d">${esc(state)} · 登记 ${regs.length} 次${again ? '（本轮重新登记）' : ''}</div>
    <div class="ix-d">${esc(dueText)}</div>
    <div class="ix-d">你在这件事上动了 ${moves.length} 次，回答它 ${answered} 次</div>${who ? `<div class="ix-d">${esc(who)}</div>` : ''}`;
}

// Two magnified timelines for the detail: the whole life, and three hours either side of the moment that matters
// (your answer, else the close), where half an hour reads as a gap.
const CLOSE_SHORT = { answered: '答后关上', lapsed: '问题失效', replaced: '换成新问题', withdrawn: '随事项撤下', merged: '随事项并入' };
function zoomWindow(path) {
  const answer = firstAnswer(path), focus = answer ? answer.at : path.closed ?? at(last);
  return { t0: focus - 3 * HOUR, t1: focus + 3 * HOUR, focus };
}
function rowsFor(marks, W) {
  const ends = [];
  for (const m of marks.sort((a, b) => a.t - b.t)) {
    const w = textWidth(m.label, 9.5, m.you ? 600 : 400, MONO) + 4;
    let lx = Math.min(m.x + 2, W - w);
    let row = ends.findIndex(e => lx >= e + 6);
    if (row < 0) { row = ends.length; }
    ends[row] = lx + w;
    m.row = row; m.lx = lx;
  }
  return ends.length;
}
function zoomSVG(path, k) {
  const W = 300, z = zoomWindow(path), x = t => ((t - z.t0) / (z.t1 - z.t0)) * W;
  const inW = t => t >= z.t0 && t <= z.t1;
  const marks = [];
  for (const d of closeSources(path)) if (inW(d.t)) marks.push({ t: d.t, x: x(d.t), kind: 'src', label: `${clock(d.t)} ${d.who}` });
  if (path.closed != null && inW(path.closed)) marks.push({ t: path.closed, x: x(path.closed), kind: 'close', label: `${clock(path.closed)} 整理：${CLOSE_SHORT[pathStatus(path, Math.max(k, path.to)).how]}` });
  for (const r of responses) if (r.item === path.item && inW(r.at)) marks.push({ t: r.at, x: x(r.at), kind: r.path === path.key ? 'answer' : 'move', you: true, id: r.id, after: path.closed != null && r.at > path.closed, label: `${clock(r.at)} ${actionSentence(r)}` });
  for (const s of dueSteps(path)) if (s.due != null && inW(s.due)) marks.push({ t: s.due, x: x(s.due), kind: s.until != null ? 'due-old' : 'due', label: `${clock(s.due)} 期限` });
  const rows = rowsFor(marks, W), H = 40 + rows * 12;
  let ticks = '';
  for (let t = Math.ceil(z.t0 / HOUR) * HOUR; t <= z.t1; t += HOUR) ticks += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="13" y2="16" class="tm-z-tick"/><text x="${x(t).toFixed(1)}" y="9" class="tm-z-hour">${esc(clock(t).slice(0, 2))}</text>`;
  const body = marks.map(m => {
    const mx = m.x.toFixed(1), ly = 40 + m.row * 12;
    const glyph = m.kind === 'src' ? `<circle cx="${mx}" cy="25" r="3"/>`
      : m.kind === 'close' ? `<line x1="${mx}" x2="${mx}" y1="14" y2="34" class="tm-z-close"/>`
        : m.kind === 'due' || m.kind === 'due-old' ? `<path d="M${(m.x - 4).toFixed(1)} 15 L${(m.x + 4).toFixed(1)} 15 L${mx} 21 Z"/>`
          : `<line x1="${mx}" x2="${mx}" y1="${m.kind === 'answer' ? 16 : 24}" y2="34"/>`;
    return `<g class="tm-zm is-${m.kind}${m.after ? ' is-after-close' : ''}" data-t="${m.t}">${glyph}<line x1="${mx}" x2="${mx}" y1="35" y2="${ly - 8}" class="tm-z-lead"/><text x="${m.lx.toFixed(1)}" y="${ly}">${esc(m.label)}</text></g>`;
  }).join('');
  return `<svg class="tm-z" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-t0="${z.t0}" data-t1="${z.t1}" aria-hidden="true">
    <rect class="tm-z-later" x="0" y="13" width="0" height="${H - 13}"/><line x1="0" x2="${W}" y1="14" y2="14" class="tm-z-axis"/>${ticks}${body}
    <line class="tm-z-now" x1="0" x2="0" y1="11" y2="36"/></svg>`;
}
function lifeSVG(path, k) {
  const W = 300, open = pathStatus(path, k).state === 'open', end = open ? at(k) : path.closed;
  const span0 = Math.max(HOUR, end - path.opened), x = t => 6 + ((t - path.opened) / span0) * (W - 12), cy = 13;
  const s = pathStatus(path, k), cls = open ? 'is-open' : `is-${s.how}`;
  let body = `<g class="tm-l-cell ${cls}"><polygon points="${hexagon(x(path.opened), x(end), cy, 12)}"/></g>`;
  for (const reg of path.regs.slice(1).filter(r => r.index <= k)) { const rx = x(at(reg.index)).toFixed(1); body += `<path class="tm-notch" d="M${rx} ${cy - 6}v3M${rx} ${cy + 6}v-3"/>`; }
  for (const r of movesOn(path, at(k))) body += `<line class="tm-l-you${r.path === path.key ? '' : ' is-loose'}" x1="${x(r.at).toFixed(1)}" x2="${x(r.at).toFixed(1)}" y1="${r.path === path.key ? cy - 9 : cy + 2}" y2="${cy + 9}"/>`;
  if (!open) for (const d of closeSources(path)) body += `<circle class="tm-l-src" cx="${x(d.t).toFixed(1)}" cy="${cy}" r="2.2"/>`;
  for (const st of dueSteps(path)) if (st.due != null && st.index <= k && st.due >= path.opened && st.due <= end) body += `<path class="tm-l-due${st.until != null && k >= st.until ? ' is-old' : ''}" d="M${(x(st.due) - 3.5).toFixed(1)} 1 L${(x(st.due) + 3.5).toFixed(1)} 1 L${x(st.due).toFixed(1)} 6 Z"/>`;
  return `<svg class="tm-l" viewBox="0 0 ${W} 36" width="${W}" height="36" aria-hidden="true">${body}
    <text x="0" y="34" class="tm-l-end">${esc(dayTime(path.opened))}</text><text x="${W}" y="34" class="tm-l-end" text-anchor="end">${esc(open ? `此刻 ${dayTime(end)}` : dayTime(end))}</text></svg>`;
}
function detailCard(f) {
  const path = f.path, k = f.i, s = pathStatus(path, k), open = s.state === 'open', now = at(k);
  const life = (open ? now : path.closed) - path.opened, regs = path.regs.filter(r => r.index <= k).length;
  const rounds = (open ? k : path.to) - path.from, z = zoomWindow(path);
  const moves = movesOn(path, now), answered = moves.filter(r => r.path === path.key).length;
  // After it closed: up to now; in the story's own card, on to the end of the zoom (its little now-line reveals them).
  const after = open ? [] : responses.filter(r => r.item === path.item && r.at > path.closed && r.at <= (ix.s.presented ? Math.max(now, z.t1) : now));
  const chips = (path.ask.actions || []).map(a => `<span class="lv-chip${a.recommended ? ' is-rec' : ''}">${esc(a.label)}${a.recommended ? ' · 推荐' : ''}</span>`).join('');
  return `<div class="ix-d-k"><span>第 ${k} / ${last} 轮 · ${esc(groupLabel(groupOf(path.item)))} · ${esc(EXPECT_WORDS[path.ask.expects] || '')}</span>
      <button type="button" data-x="close" aria-label="收回（Esc）" title="收回（Esc）">×</button></div>
    <div class="ix-d-t">${esc(f.kind === 'resp' ? f.path.ask.short || f.path.ask.prompt : f.short)}</div>
    <div class="ix-d-s"><b>${open ? '已开' : '开了'} ${hoursOf(life)} 小时</b> · ${open ? `登记 ${regs} 次` : esc(CLOSE_WORDS[s.how])} · ${esc(dueLine(path, k))}</div>
    ${open ? '' : `<section><h5>放大 · ${firstAnswer(path) ? '你回答' : '关上'}前后各 3 小时<b>${esc(dayTime(z.t0))}–${esc(clock(z.t1))}</b></h5>${zoomSVG(path, k)}</section>`}
    <section><h5>${open ? '从登记到此刻' : '从登记到关上'}<b>${rounds} 轮 · 登记 ${regs} 次</b></h5>${lifeSVG(path, k)}</section>
    <section><h5>问题</h5><p class="tm-d-prompt">${esc(path.ask.prompt)}</p>${chips ? `<div class="lv-chips">${chips}</div>` : ''}</section>
    <section><h5>你的回应<b>${moves.length} 条 · 回答它 ${answered} 次</b></h5>${moves.length ? `<ul class="ix-d-fb">${moves.slice(-4).map(r => `<li${r.id === f.resp?.id ? ' class="is-current"' : ''}><time>${esc(dayTime(r.event.at))} · ${r.path === path.key ? '回答了它' : '没有回答它'}</time>${esc(actionSentence(r))}</li>`).join('')}</ul>${moves.length > 4 ? `<p class="ix-none">更早的 ${moves.length - 4} 条略去</p>` : ''}` : '<p class="ix-none">到此刻还没有你的回应</p>'}
      ${after.length ? `<div class="is-after" data-t="${after[0].at}"><h6>关上之后</h6><ul class="ix-d-fb">${after.slice(0, 2).map(r => `<li class="is-after" data-t="${r.at}"><time>${esc(dayTime(r.event.at))}</time>${esc(actionSentence(r))}</li>`).join('')}</ul></div>` : ''}</section>
    ${open ? '' : `<section>${closeHTML(path, k, 'h5')}</section>`}
    <section class="tm-d-go">${answerLinks(path, k)}<button type="button" class="tm-dossier" data-tm-dossier="${esc(path.item)}|${esc(path.key)}">全部记录 →</button></section>`;
}
// The zoom's little now-line: the line itself, except in the story's card, where it walks on to your move.
function paintZoom() {
  if (!X.detail) return;
  const svg = page.body.querySelector('.ix-detail .tm-z');
  const presentedHero = story.on && ix.s.presented && ix.view?.path === heroPath;
  let t = player.t;
  if (presentedHero) { const c = story.cue, tau = storyTau(); t = lerp(c.zoomFrom, c.zoomTo, easeInOut((tau - c.zoom0) / (c.zoom1 - c.zoom0))); }
  for (const li of page.body.querySelectorAll('.ix-detail .is-after')) li.classList.toggle('is-later', Number(li.dataset.t) > t + 1);
  if (!svg) return;
  const t0 = Number(svg.dataset.t0), t1 = Number(svg.dataset.t1), W = 300, nx = clamp((t - t0) / (t1 - t0)) * W;
  if (svg._t === t) return;
  svg._t = t;
  const line = svg.querySelector('.tm-z-now'), later = svg.querySelector('.tm-z-later');
  line.setAttribute('x1', nx.toFixed(1)); line.setAttribute('x2', nx.toFixed(1));
  line.setAttribute('visibility', t >= t0 && t <= t1 ? 'visible' : 'hidden');
  later.setAttribute('x', nx.toFixed(1)); later.setAttribute('width', Math.max(0, W - nx).toFixed(1));
  for (const g of svg.querySelectorAll('.tm-zm')) g.classList.toggle('is-later', Number(g.dataset.t) > t + 1);
}

// ---------- geometry for the interaction (stage = the page body: figure and side column) ----------
const stage = page.body;
let pointer = null;
stage.addEventListener('pointermove', event => { const box = stage.getBoundingClientRect(); pointer = { x: event.clientX - box.left, y: event.clientY - box.top }; }, { passive: true });
/** A path's visible cell in stage coordinates (up to the line while open), and the point a card hangs from. */
function cellGeom(path) {
  const cy = G.laneY.get(path.item) + G.fy, x0 = G.x(path.opened) + G.fx, x1 = G.x(Math.min(path.closed ?? Infinity, player.t)) + G.fx;
  return { x0, x1: Math.max(x0 + 2, x1), cy, top: cy - G.ch / 2 - 5, bottom: cy + G.ch / 2 + 5 };
}
function geomOf(id) {
  if (id.startsWith('r:')) {
    const r = responseById.get(id.slice(2)), cy = G.laneY.get(r.item) + G.fy, x0 = G.x(r.at) + G.fx;
    return { x0, x1: x0, cy, top: cy - G.ch / 2 - 5, bottom: cy + G.ch / 2 + 9 };
  }
  return cellGeom(pathByKey.get(id.slice(2)));
}
const cardBounds = () => ({ x0: G.fx + 8, y0: G.fy + 8, x1: G.fx + G.W - 8, y1: G.fy + G.H - 8 });
function hitAt(sx, sy) {
  if (!G) return null;
  const x = sx - G.fx, y = sy - G.fy;
  if (x < G.X0 - 6 || x > G.W || y < G.top) return null;
  for (const lane of lanes) {
    const cy = G.laneY.get(lane.id);
    if (Math.abs(y - cy) > G.ch / 2 + 4) continue;
    let best = null, bd = Infinity;
    for (const p of pathsByItem.get(lane.id)) {
      if (p.from > player.k) continue;
      const xa = G.x(p.opened), xb = G.x(Math.min(p.closed ?? Infinity, player.t));
      const d = x < xa - 4 ? Infinity : x <= xb ? 0 : x <= xb + 12 ? x - xb : Infinity;
      if (d < bd) { bd = d; best = p; }
    }
    return best ? `p:${best.key}` : null;
  }
  return null;
}
const hasId = id => {
  if (!G || !id) return false;
  if (id.startsWith('r:')) { const r = responseById.get(id.slice(2)); return Boolean(r) && r.at <= player.t; }
  const p = pathByKey.get(id.slice(2));
  return Boolean(p) && p.from <= player.k;
};
function named(name) {
  if (!name) return null;
  if (/^[pr]:/.test(name)) return hasId(name) ? name : null;
  const list = pathsInOrder.filter(p => p.from <= player.k && (p.key === name || p.ask.short === name || p.ask.prompt === name));
  const p = list.find(q => pathStatus(q, player.k).state === 'open') || list.at(-1);
  return p ? `p:${p.key}` : null;
}
// The summary card hangs off the line where the pointer is (else its end), above or below the lane so the lane stays clear.
function peekPlace(id, w, h) {
  const g = geomOf(id), B = cardBounds();
  const ax = pointer && pointer.x >= g.x0 - 12 && pointer.x <= g.x1 + 14 && Math.abs(pointer.y - g.cy) < G.laneH ? clamp(pointer.x, g.x0, g.x1) : g.x1;
  const at0 = { x: ax, y: g.cy };
  return placeBeside({ at: at0, from: at0, facing: ax + 14 + w <= B.x1 ? 1 : -1, w, h, bounds: B, flush: true, gap: 14,
    avoid: [{ x0: B.x0, y0: g.top, x1: B.x1, y1: g.bottom }], pad: 2 });
}
// The detail: in the pale future right of the line when there is room; else above or below the lane, on the past side
// of the line, its corner near the cell's end. The leader leaves the end of the stepped-out cell along the lane, then
// turns to the card.
function detailPlace(id, el) {
  const path = pathOfId(id), g = cellGeom(path), B = cardBounds(), nowX = G.x(player.t) + G.fx;
  const xe = g.x1, cy = g.cy - IX.pop, w = 330;
  el.style.width = `${w}px`;
  if (B.x1 - (nowX + 34) >= w) {
    const x = B.x1 - w;
    el.style.maxHeight = `${B.y1 - B.y0}px`;
    const h = Math.min(el.offsetHeight, B.y1 - B.y0), y = clamp(cy - h * 0.3, B.y0, B.y1 - h), ay = clamp(cy, y + 12, y + h - 12);
    return { x, y, w, h, path: ay === cy ? [{ x: xe, y: cy }, { x, y: cy }] : [{ x: xe, y: cy }, { x: x - 16, y: cy }, { x, y: ay }] };
  }
  const above = g.top - 12 - B.y0, below = B.y1 - (g.bottom + 12), up = above >= below, room = Math.max(160, up ? above : below);
  el.style.maxHeight = `${room}px`;
  const h = Math.min(el.offsetHeight, room);
  const x = clamp(Math.min(xe + 48, nowX - 14) - w, B.x0, B.x1 - w), y = up ? g.top - 12 - h : g.bottom + 12;
  const lx = clamp(xe + 16, x + 14, x + w - 14), ey = up ? y + h : y;
  return { x, y, w, h, path: [{ x: xe, y: cy }, { x: xe + 10, y: cy }, { x: lx, y: ey }] };
}

const ix = createIx({
  stage, facts: factsOf, index: () => player.k, has: hasId, hit: hitAt, named,
  pointOf: id => { const g = geomOf(id); return { x: (g.x0 + g.x1) / 2, y: g.cy }; },
  pause: () => { if (!player.held) { player.held = true; player.heldAt = wall(); } },
  resume: () => { if (player.held) { player.held = false; player.heldTotal += wall() - player.heldAt; } },
  paused: () => player.held,
  last, answerHref: f => linkD(f.i),
  peekPlace, detailPlace, peekHTML: peekCard, detailHTML: detailCard, skip: '.lv-drawer, .tm-one-links, .tm-row-go',
  keysIn: stage, label: '回应路径：Tab 逐条看概要，Enter 展开详情，Esc 收回',
});

// ---------- input ----------
function onFrame(index, previous, from) {
  if (!G) build();
  if (from === 'init') { init(index); return; }
  if (from === 'play') return;
  // ‹ ›, ← →, Home / End, the scrubber, the batch strip and the embedding page: a beat transition to that frame.
  endStory(); stopPlay(); ix.reset(); tip.hide();
  navigate(index);
}
function init(index) {
  if (tellMode) {
    if (reducedMotion()) { hold(last); return; }
    tell();
    if (params.has('at')) player.freeze = Math.max(0, Number(params.get('at')) || 0);
    page.goFrame(0, { from: 'play' });
    return;
  }
  player.t = at(index); commit(index); setNow(player.t); drawnT = player.t;
  if (params.get('mode') === 'play') togglePlay();
}
function onKey(event) {
  if (event.key === 'Escape' && drawer.isOpen) { drawer.close(); event.stopImmediatePropagation(); return true; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const proxies = [...stage.querySelectorAll('.ix-sr button')];
    if (!proxies.length) return true;
    const n = proxies.indexOf(document.activeElement), d = event.key === 'ArrowDown' ? 1 : -1;
    proxies[n < 0 ? (d > 0 ? 0 : proxies.length - 1) : (n + d + proxies.length) % proxies.length].focus();
    return true;
  }
  return false;
}
// Any key skips the story to its end (and does nothing else); so does a click on nothing in particular.
addEventListener('keydown', event => {
  if (!story.on || event.metaKey || event.ctrlKey || event.altKey || ['Shift', 'Meta', 'Control', 'Alt', 'CapsLock'].includes(event.key)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  skipStory();
}, true);
figure.addEventListener('click', event => {
  if (story.on && !ix.s.hover && !ix.s.open && !event.target.closest('[data-frame]')) { skipStory(); return; }
  const el = event.target.closest('[data-frame]');
  if (el) page.goFrame(Number(el.dataset.frame));
});
document.addEventListener('click', event => {
  if (event.target.closest('[data-tm-tell]')) { tell(); return; }
  const dossier = event.target.closest('[data-tm-dossier]');
  if (dossier) {
    const [item, key] = dossier.dataset.tmDossier.split('|');
    if (ix.s.open) ix.close();
    drawer.open(dossierHTML(item, player.k, { pathKey: key }), `${item}|${key}`, { scrollTo: `[data-path="${CSS.escape(key)}"]` });
  }
});
// The batch strip: hover for the round, click or drag to go there.
figure.addEventListener('pointermove', event => {
  const el = event.target.closest('[data-frame]');
  if (!el) { tip.hide(); return; }
  const f = frames[Number(el.dataset.frame)];
  tip.show(`<b>${esc(f.id)} · ${esc(dayTime(f.at))}</b><small>${esc(f.title)}</small><small>收到 ${f.events.length} 条${f.signal?.coverage ? ` · ${esc(f.signal.coverage)}` : ''} · 点击或拖动跳帧</small>`, event.clientX, event.clientY, `f${f.id}`);
});
figure.addEventListener('pointerleave', () => tip.hide());
figure.addEventListener('pointerdown', event => {
  const el = event.target.closest('[data-frame]');
  if (!el) return;
  const svg = G.svg;
  svg.setPointerCapture(event.pointerId);
  const drag = e => {
    const box = svg.getBoundingClientRect(), t = t0 + (e.clientX - box.left - G.X0) / (G.X1 - G.X0) * (t1 - t0);
    let best = 0;
    frames.forEach((f, i) => { if (Math.abs(at(i) - t) < Math.abs(at(best) - t)) best = i; });
    if (best !== page.index) page.goFrame(best);
  };
  const up = () => { svg.removeEventListener('pointermove', drag); svg.removeEventListener('pointerup', up); };
  svg.addEventListener('pointermove', drag);
  svg.addEventListener('pointerup', up);
});

let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { const k = player.k; build(); player.k = -1; commit(k); setNow(player.t); drawnT = player.t; ix.relayout(); }, 120);
});

build();
page.start();
requestAnimationFrame(loop);
// Old links into this page: ?ask= (or ?item=) opens that record in the drawer.
if (params.get('ask') && pathByKey.has(params.get('ask'))) { const p = pathByKey.get(params.get('ask')); drawer.open(dossierHTML(p.item, player.k, { pathKey: p.key }), `${p.item}|${p.key}`); }
else if (params.get('item') && factOf(params.get('item'))) drawer.open(dossierHTML(params.get('item'), player.k), params.get('item'));

window.foldTiming = {
  player: { get index() { return page.index; }, get shown() { return player.k; }, get mode() { return player.mode; }, get t() { return player.t; }, get tau() { return player.tau; } },
  hero: heroPath?.key || null,
  /** Stand on frame i (no story, no transition); startPlay(i) plays on from i; startHero() tells the story again. */
  hold: i => { endStory(); stopPlay(); ix.reset(); hold(Math.max(0, Math.min(last, i))); },
  startPlay: i => { endStory(); ix.reset(); if (i != null) hold(i); if (player.mode !== 'play') togglePlay(); },
  startHero: () => tell(), skip: () => skipStory(),
  /** The story frozen at `seconds` (stills), or released (null). */
  seek: seconds => { if (!story.on) tell(); player.freeze = seconds == null ? null : Math.max(0, seconds); },
  perf: () => {
    const ts = perf.times.slice(1), avg = ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length);
    const p95 = list => [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.95)] || 0;
    const work = perf.work.slice(1);
    return { frames: ts.length, fps: +(1 / avg).toFixed(1), p95ms: +(p95(ts) * 1000).toFixed(1),
      workMs: +(work.reduce((a, b) => a + b, 0) / Math.max(1, work.length)).toFixed(2), workP95ms: +p95(work).toFixed(2) };
  },
  resetPerf: () => { perf.on = true; perf.times = []; perf.work = []; },
  // Test hooks (ix.mjs): hover / unhover / open / close / ixAt / ix / paused / pointOf / ixState, a path by id ('p:ask-08'),
  // key or short question. pick() is a path worth hovering this frame (the hero once registered, else the longest).
  ...ix.hooks(),
  pick: () => {
    const k = player.k;
    if (heroPath && heroPath.from <= k) return `p:${heroPath.key}`;
    const list = askPaths.filter(p => p.from <= k).sort((a, b) => (Math.min(b.closed ?? Infinity, player.t) - b.opened) - (Math.min(a.closed ?? Infinity, player.t) - a.opened));
    return list[0] ? `p:${list[0].key}` : null;
  },
  /** A path's visible cell in viewport coordinates (scripts/check-ix.mjs aims 9 px past its end). */
  geom: name => {
    const id = named(name);
    if (!id) return null;
    const g = geomOf(id), box = stage.getBoundingClientRect();
    return { x0: box.left + g.x0, x1: box.left + g.x1, y: box.top + g.cy };
  },
};
globalThis.foldForm = { id: 'timing', goFrame: page.goFrame, get index() { return page.index; } };
