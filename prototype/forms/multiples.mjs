// 08 两周小倍数：每帧同尺度并排，每帧 8×8 = 64 格，一格一份，按份额从左上填（同份额按首次出现排），空格是未分配。
// 真实数据两周有六十到九十件根层事项（随运行而变），颜色不够分：两种上色可切换（按 C）：
//   前 8 件 —— 两周累计份额最多的 8 件各一色，其余灰；看“哪几件事吃掉了注意力、何时变大或消失”。默认。
//   按流   —— 工作、家庭、生活、社区各一色，格子先按流再按份额排；看“工作与家里此消彼长”。
// 黑点 = 一个开着的问题（含子层）：一件事有几个问题，就在它的前几格点几个。悬停一件事时它在全部帧里亮起。
//
// 动画（polish/multiples-motion.md「故事」）：论点是“注意力不是慢慢漂的，是成块挪的”，英雄数字是本轮换手的格数 N
// （相邻两帧份额向量 L1 距离的一半，未分配也算一个主人），与格子怎样排无关。三拍：填满 → 整块挪（每轮 0.6 秒）→
// 放下（一轮走完整 4 秒，再快放到末帧），composite 约 24 秒、story 约 29 秒。底片 29 格的位置、尺寸、排法与配色在放映
// 前后完全相同，未播的帧不变淡；放映只加播放框硬切、当前格的换手描边、第三拍的压暗，和约一成的概念层（走掉格子的
// 灰影、播放框拖尾，只用灰），停下就是零。一轮：0 切点 → 0–0.3 秒走的褪成灰影、留下的滑到新位、新来的在终点长出 →
// 0.3 秒数字翻、N 格描边、黑点落下 → 静到 0.6 秒。
// 自动放映只在顶层直接打开、地址不带 ?frame= 时放一遍，任意键跳过；“▶ 放一遍”重放，空格从当前帧放到末帧或停住。
// 换帧（←/→、Home/End、顶栏、合页 followFrames）走一轮的节拍过渡，不硬切。
// 交互接 motion/ix.mjs（与整理脉冲、份额拨盘同一套）：悬停一帧出那一轮的概要，悬停一格或一行出这一件的概要；
// 点一件，放大方阵里它的格子外推 8 px、引线沿格缝下到面板、“这一件”详情从引线末端展开。
import {
  topRoots, topColor, OTHER_COLOR, STREAMS, hasStreams, streamOf, factOf, pathByKey, pathStatus, actionSentence, CLOSE_WORDS,
  dossierHTML, EXPECT_WORDS, esc, dayTime, reducedMotion, SLOW,
} from './sketches/live.mjs';
import { itemFacts, shortOf, orderOf, dueText } from './motion/dial-model.mjs';
import { createIx, placeBeside, IX } from './motion/ix.mjs';
import { withDataset, currentDataset } from '../data/select.mjs';

const CELL = 7, GAP = 1, PITCH = CELL + GAP, SIDE = 8 * CELL + 7 * GAP;
const BIG = 17, BIG_GAP = 2, BP = BIG + BIG_GAP, BIG_SIDE = 8 * BIG + 7 * BIG_GAP;
const BAND = 12;                       // the big waffle's hit band reaches this far outside its edge
const SVGNS = 'http://www.w3.org/2000/svg';
const GREY = '#e4e0d4';

// ---------- choreography (seconds; story in polish/multiples-motion.md) ----------
const T = {
  open: 0.4,                           // f00 stays still this long before the first cut
  fast: 0.6, move: 0.3,                // a round: moves 0–0.3, settles at 0.3, still to 0.6
  ghost: 0.4, ghostSlow: 0.6,          // the grey shadow of a cell that left
  trail: 1.2,                          // the cursor's trail: two fast rounds
  slow: 4.0, slowMove: [0.4, 1.0], slowNote: 1.3, slowDim: [1.6, 1.9],
  grow: 0.02, growCell: 0.2,           // the first round from empty: one cell every 20 ms, each grows in 0.2 s
  hold1: 1.4, hold2: 1.0, note: 0.6, tail: 0.6,
};
// The three beats, by frame id per dataset (as the dial does it). Beat 1 ends on a hold, beat 2 ends on a hold, beat 3 is
// the one round played at full length.
const BEATS = { composite: { b1: 'f03', b2: 'f22', b3: 'f23' }, story: { b1: 'f05', b2: 'f14', b3: 'f15' } };
const STREAM_ORDER = ['work', 'family', 'life', 'community', 'subscription', null];

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
// Fast start, settles with an overshoot of about 3.7 % (story: no more than 4 %).
const easeOutBack = k => { const u = clamp(k) - 1; return 1 + 2 * u ** 3 + u ** 2; };
const clip = (text, n) => ([...String(text || '')].length > n ? `${[...String(text)].slice(0, n - 1).join('')}…` : String(text || ''));
const ROWS = { 8: '一行', 16: '两行', 24: '三行', 32: '四行', 40: '五行', 48: '六行' };

export function mount(stage, model, kit) {
  const { records, scenario } = kit;
  const frames = scenario.frames, last = frames.length - 1;
  const params = new URLSearchParams(location.search);
  let mode = params.get('color') === 'stream' && hasStreams ? 'stream' : 'top';
  const wall = () => performance.now() / 1000;
  // The model calls a new subscriber at once; `ready` keeps that first call (and our own frame changes, `driving`) out.
  let ready = false, driving = false;

  // ---------- one round per frame: shares, N, what moved, the questions ----------
  const rounds = frames.map((frame, i) => {
    const state = records[i].state, ctx = { index: i, state };
    const items = state.root.items.map(item => ({ id: item.id, share: item.share }));
    // Every open question, sub-layers included (currentAsk: registered for the item's current version).
    const asks = [];
    for (const { item } of kit.activeItems(state)) {
      const ask = kit.currentAsk(ctx, item.id);
      if (ask) asks.push({ key: ask.id || `${item.id}@${frame.id}`, ask, item: item.id, root: kit.rootOf(state, item.id) });
    }
    const dots = new Map();
    for (const a of asks) dots.set(a.root, (dots.get(a.root) || 0) + 1);
    const tag = frame.signal?.type === 'review' ? '定时' : records[i].receipt?.type === 'checked' ? '检查' : '';
    return { i, frame, id: frame.id, at: frame.at, title: frame.title, items, shares: new Map(items.map(x => [x.id, x.share])),
      used: state.root.used, asks, dots, tag, inputs: frame.events.length };
  });
  const openFrames = new Map();   // ask key → the frames it is open in
  rounds.forEach(r => r.asks.forEach(a => { if (!openFrames.has(a.key)) openFrames.set(a.key, []); openFrames.get(a.key).push(r.i); }));
  /** How a question that was open in frame i − 1 closed by frame i: your action, or how it lapsed. */
  function closeHow(key, i) {
    const path = pathByKey.get(key), status = path && pathStatus(path, i);
    if (!status || status.state !== 'closed') return '关上';
    if (status.how === 'answered') { const r = path.answers.filter(x => x.at <= path.closed).at(-1); return r ? actionSentence(r) : CLOSE_WORDS.answered; }
    return CLOSE_WORDS[status.how] || '关上';
  }
  /** The first frame after i in which question `key` is no longer open (null: open to the end). */
  const closesAfter = (key, i) => { const list = openFrames.get(key) || []; for (let k = i + 1; k <= last; k += 1) if (!list.includes(k)) return k; return null; };
  rounds.forEach((r, i) => {
    const p = i ? rounds[i - 1] : null;
    if (!p) { Object.assign(r, { N: null, grown: 0, freed: 0, changes: [], opened: [], closed: [] }); return; }
    let grown = 0;
    for (const [id, s] of r.shares) grown += Math.max(0, s - (p.shares.get(id) || 0));
    r.grown = grown;
    r.freed = Math.max(0, p.used - r.used);
    r.N = grown + r.freed;
    const ids = new Set([...p.shares.keys(), ...r.shares.keys()]);
    r.changes = [...ids].map(id => ({ id, from: p.shares.get(id) || 0, to: r.shares.get(id) || 0 })).filter(c => c.from !== c.to)
      .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || orderOf(a.id) - orderOf(b.id));
    const before = new Set(p.asks.map(a => a.key)), now = new Set(r.asks.map(a => a.key));
    r.opened = r.asks.filter(a => !before.has(a.key));
    r.closed = p.asks.filter(a => !now.has(a.key)).map(a => ({ ...a, how: closeHow(a.key, i) }));
  });
  const beats = (() => {
    const plan = BEATS[currentDataset()], at = id => frames.findIndex(f => f.id === id);
    if (plan && at(plan.b3) > 0) return { b1: at(plan.b1), b2: at(plan.b2), b3: at(plan.b3) };
    const b3 = rounds.slice(2).reduce((best, r) => (r.N > rounds[best].N ? r.i : best), Math.min(2, last));
    return { b1: Math.min(3, b3 - 1), b2: Math.max(1, b3 - 1), b3 };
  })();
  const allRoots = [...new Set(rounds.flatMap(r => r.items.map(x => x.id)))];

  // ---------- layout: the 64 cells of a frame, keyed item#k, in this mode's order ----------
  const sortItems = items => [...items].sort((a, b) => (mode === 'stream' ? STREAM_ORDER.indexOf(streamOf(a.id)) - STREAM_ORDER.indexOf(streamOf(b.id)) : 0)
    || b.share - a.share || orderOf(a.id) - orderOf(b.id));
  let layouts = [];
  function relayoutCells() {
    layouts = rounds.map(r => {
      const cells = [];
      for (const it of sortItems(r.items)) for (let k = 0; k < it.share; k += 1) cells.push({ key: `${it.id}#${k}`, id: it.id, k, dot: k < (r.dots.get(it.id) || 0) });
      return cells;
    });
  }
  relayoutCells();
  /** The N cells that changed hands in frame i: each grown item's new cells at its end, then the newly blank cells. */
  function outlineOf(i) {
    const p = rounds[i - 1];
    if (!p) return [];
    const out = [];
    layouts[i].forEach((c, idx) => { if (c.k >= (p.shares.get(c.id) || 0)) out.push(idx); });
    for (let k = 0; k < rounds[i].freed; k += 1) out.push(rounds[i].used + k);
    return out;
  }
  const cellColor = id => (mode === 'top' ? topColor(id) || OTHER_COLOR : STREAMS[streamOf(id)]?.color || OTHER_COLOR);
  const colorOfRoot = id => topColor(id) || (mode === 'stream' ? STREAMS[streamOf(id)]?.color : null) || OTHER_COLOR;

  // ---------- page ----------
  const full = rounds.filter(r => r.used === 64).length, peak = Math.max(...rounds.map(r => r.items.length));
  stage.innerHTML = `<div class="mx-wrap">
    <header class="mx-head"><span class="mx-kicker">两周小倍数 · 同尺度</span>
      <h2>${frames.length} 次整理，${allRoots.length} 件事到过根层，同一时刻最多 ${peak} 件，${full} 次用满 64 份</h2>
      <div class="mx-tools"><button type="button" class="mx-show" data-show aria-label="从头放一遍（约 ${Math.round(planFrom(0).end)} 秒）">▶ 放一遍</button>
        <div class="mx-mode" role="radiogroup" aria-label="上色方式（C 切换）"><button type="button" role="radio" data-mode="top">前 8 件</button><button type="button" role="radio" data-mode="stream"${hasStreams ? '' : ' disabled title="这个数据集没有流的标注"'}>按流</button></div></div>
    </header>
    <div class="mx-body">
      <div class="mx-weeks-wrap"><div class="mx-weeks"></div>
        <svg class="mx-over" aria-hidden="true"><g class="mx-trails"><rect rx="5"/><rect rx="5"/></g><path class="mx-outline"/><path class="mx-outline is-hover"/><rect class="mx-keyring" rx="5"/><rect class="mx-cursor" rx="5"/></svg></div>
      <aside class="mx-side">
        <section class="mx-now"><div class="mx-now-k"></div>
          <div class="mx-now-row"><div class="mx-big"><svg width="${BIG_SIDE}" height="${BIG_SIDE}" viewBox="0 0 ${BIG_SIDE} ${BIG_SIDE}" aria-label="此刻的 64 份">
            <g class="mx-big-blank">${Array.from({ length: 64 }, (_, i) => `<rect x="${(i % 8) * BP}" y="${Math.floor(i / 8) * BP}" width="${BIG}" height="${BIG}" rx="1.5"/>`).join('')}</g>
            <path class="mx-ghosts"/><g class="mx-leaving"></g><g class="mx-big-cells"></g><path class="mx-big-outline"/><g class="mx-big-dots"></g></svg></div>
            <div class="mx-hero"><b></b><small>换手 · 格</small><span class="mx-hero-sub"></span><div class="mx-now-n"></div></div></div>
          <div class="mx-now-title"></div><p class="mx-beat"></p></section>
        <section class="mx-legend"></section>
        <section class="mx-asks"></section>
      </aside>
    </div></div>`;
  const $ = s => stage.querySelector(s);
  const wrap = $('.mx-wrap'), weeksEl = $('.mx-weeks'), weeksWrap = $('.mx-weeks-wrap'), over = $('.mx-over');
  const cursorEl = over.querySelector('.mx-cursor'), keyRing = over.querySelector('.mx-keyring'), trailEls = [...over.querySelectorAll('.mx-trails rect')];
  const outlineEl = over.querySelector('.mx-outline:not(.is-hover)'), hoverOutlineEl = over.querySelector('.mx-outline.is-hover');
  const bigSvg = $('.mx-big svg'), bigCells = $('.mx-big-cells'), leavingG = $('.mx-leaving'), ghostEl = $('.mx-ghosts'), bigOutline = $('.mx-big-outline'), bigDots = $('.mx-big-dots');
  const heroN = $('.mx-hero b'), heroSub = $('.mx-hero-sub'), beatEl = $('.mx-beat');
  const focusStyle = document.createElement('style');
  document.head.append(focusStyle);
  if (kit.side) kit.side.innerHTML = `<p class="mx-keys"><b>怎样读</b>每个方阵是一帧：一格一份，按份额从左上填起（同份额按首次出现），空格是未分配。右上的大数是这一轮换手的格数（未分配也算一个主人），墨框圈出的就是这几格。</p>
    <p class="mx-keys"><kbd>空格</kbd> 放映 / 停住 · <kbd>←</kbd><kbd>→</kbd> 逐帧 · <kbd>Home</kbd><kbd>End</kbd> 头尾 · <kbd>C</kbd> 配色；直接打开时自动放一遍，任意键跳过</p>
    <p class="mx-keys">悬停或 <kbd>Tab</kbd> 到一帧、一格看概要 · 点一格或 <kbd>Enter</kbd> 展开这一件 · <kbd>Esc</kbd> 收回；悬停与展开时放映停在当前时刻</p>`;

  // ---------- the two-week grid (built per mode, never per frame) ----------
  function waffleSVG(r) {
    const cells = layouts[r.i];
    let out = '';
    cells.forEach((c, i) => {
      const x = (i % 8) * PITCH, y = Math.floor(i / 8) * PITCH;
      out += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${cellColor(c.id)}" class="mx-cell" data-root="${esc(c.id)}"/>`;
    });
    for (let i = cells.length; i < 64; i += 1) out += `<rect x="${(i % 8) * PITCH}" y="${Math.floor(i / 8) * PITCH}" width="${CELL}" height="${CELL}" class="mx-blank"/>`;
    cells.forEach((c, i) => { if (c.dot) out += `<circle cx="${(i % 8) * PITCH + CELL / 2}" cy="${Math.floor(i / 8) * PITCH + CELL / 2}" r="1.7" class="mx-dot" data-root="${esc(c.id)}"/>`; });
    return `<div class="mx-frame" data-go="${r.i}"><svg width="${SIDE}" height="${SIDE}" viewBox="0 0 ${SIDE} ${SIDE}" data-frame="${r.i}">${out}</svg><button type="button" class="mx-time" data-go="${r.i}" tabindex="-1">${kit.formatTime(r.at)}${r.tag ? `<em>${r.tag}</em>` : ''}</button></div>`;
  }
  function buildGrid() {
    const byDay = new Map();
    for (const r of rounds) { const day = kit.formatDate(r.at); if (!byDay.has(day)) byDay.set(day, []); byDay.get(day).push(r); }
    const days = [...byDay.entries()];
    const half = Math.ceil(days.length / 2);
    const weeks = days.length > 8 ? [days.slice(0, Math.min(7, half)), days.slice(Math.min(7, half))] : [days];
    weeksEl.innerHTML = weeks.map((week, w) => `<section class="mx-week"><h3>${weeks.length > 1 ? (w ? '第二周' : '第一周') : '两周'}</h3>${week.map(([label, list]) => {
      const [md, wd] = [label.replace(/周.$/, ''), label.match(/周.$/)?.[0] || ''];
      return `<div class="mx-day${list.length > 3 ? ' is-busy' : ''}"><div class="mx-date"><b>${esc(md.split('/').pop())}</b><span>${esc(wd)}</span></div><div class="mx-row">${list.map(waffleSVG).join('')}</div><div class="mx-notes">${list.map(r => `<p data-go="${r.i}" data-note="${r.i}" title="${esc(r.title)}"><b>${kit.formatTime(r.at)}</b>${esc(r.title)}</p>`).join('')}</div></div>`;
    }).join('')}</section>`).join('');
  }
  // Where every small waffle and its frame box sit inside the grid (the overlay draws on these).
  let boxes = [];
  function measure() {
    const host = weeksWrap.getBoundingClientRect();
    boxes = rounds.map(r => {
      const svg = weeksEl.querySelector(`svg[data-frame="${r.i}"]`), frame = svg.parentElement;
      const a = svg.getBoundingClientRect(), b = frame.getBoundingClientRect();
      return { x: a.left - host.left, y: a.top - host.top, fx: b.left - host.left, fy: b.top - host.top, fw: b.width, fh: b.height };
    });
    over.setAttribute('width', host.width); over.setAttribute('height', host.height);
    placeCursor(player.index);
  }
  // The whole film must fit on one screen; a busy day's notes (more than three frames) fold away when it would not.
  function fit() {
    wrap.classList.remove('is-tight');
    const room = stage.clientHeight;
    if (wrap.scrollHeight > room + 1 && weeksEl.querySelector('.mx-day.is-busy')) wrap.classList.add('is-tight');
  }

  // ---------- the side: hero number, the now panel, questions, legend ----------
  const others = rounds.map(r => r.items.filter(x => !topColor(x.id)).reduce((n, x) => n + x.share, 0));
  const SPARK_W = 112, SPARK_H = 20;
  const sx = i => (i / last * SPARK_W);
  const shareHistory = id => rounds.map(r => r.shares.get(id) || 0);
  function spark(values, color, max = 24) {
    const pts = values.map((v, i) => `${sx(i).toFixed(1)},${(SPARK_H - Math.min(v, max) / max * (SPARK_H - 3) - 1.5).toFixed(1)}`).join(' ');
    return `<svg class="mx-spark" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/><line class="mx-spark-now" x1="0" x2="0" y1="0" y2="${SPARK_H}"/></svg>`;
  }
  let area = null;
  function streamArea() {
    const H = 60, W = 250;
    const keys = ['work', 'family', 'life', 'community', 'subscription'].filter(k => rounds.some(r => r.items.some(x => streamOf(x.id) === k)));
    const sums = rounds.map(r => Object.fromEntries(keys.map(k => [k, r.items.filter(x => streamOf(x.id) === k).reduce((n, x) => n + x.share, 0)])));
    let base = rounds.map(() => 0), out = '';
    const px = i => (i / last * W).toFixed(1), py = v => (H - v / 64 * H).toFixed(1);
    for (const k of keys) {
      const top = base.map((b, i) => b + sums[i][k]);
      out += `<path d="M${top.map((v, i) => `${px(i)},${py(v)}`).join(' L')} L${base.map((v, i) => `${px(i)},${py(v)}`).reverse().join(' L')} Z" fill="${STREAMS[k].color}" class="mx-area" data-stream="${k}"/>`;
      base = top;
    }
    return { svg: `<svg class="mx-areas" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out}<line class="mx-spark-now" x1="0" x2="0" y1="0" y2="${H}"/></svg>`, keys, sums, W };
  }
  function buildLegend() {
    const L = $('.mx-legend');
    if (mode === 'top') {
      L.innerHTML = `<h3>两周累计份额前 ${topRoots.length} 件 <small>走势 · 此刻份额</small></h3>${topRoots.map(id => `<button type="button" class="mx-item" data-legend="${esc(id)}"><i style="background:${topColor(id)}"></i><span>${esc(shortOf(id))}</span>${spark(shareHistory(id), topColor(id))}<b></b></button>`).join('')}
        <div class="mx-item is-other"><i style="background:${OTHER_COLOR}"></i><span>其余 ${allRoots.length - topRoots.length} 件，灰</span>${spark(others, '#8f8a7d', 64)}<b></b></div>`;
    } else {
      area = streamArea();
      L.innerHTML = `<h3>工作与生活 <small>各流的份额，叠起来是 64</small></h3>${area.svg}
        <div class="mx-streams">${area.keys.map(k => `<div class="mx-item is-stream" data-stream="${k}"><i style="background:${STREAMS[k].color}"></i><span>${STREAMS[k].label}</span><b></b></div>`).join('')}</div>`;
    }
  }
  $('.mx-mode').querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));

  // What the now panel says. The date and the narration flip at the cut; the counts, N and the questions when the
  // cells settle (paintSettled); beat notes only while the show plays, at its three holds.
  function paintCut(i) {
    $('.mx-now-title').textContent = rounds[i].title;
    weeksEl.querySelectorAll('.mx-notes .is-on, .mx-frame.is-on').forEach(el => el.classList.remove('is-on'));
    weeksEl.querySelector(`[data-note="${i}"]`)?.classList.add('is-on');
    weeksEl.querySelector(`.mx-frame[data-go="${i}"]`)?.classList.add('is-on');
  }
  function paintHero(i) {
    const r = rounds[i];
    heroN.textContent = r.N == null ? '—' : r.N;
    heroSub.textContent = r.N == null ? '还没有上一轮' : r.freed ? `其中空出 ${r.freed}` : r.N ? '' : '一格没动';
  }
  const changesLine = r => r.changes.slice(0, 3).map(c => `${shortOf(c.id)} ${c.from}→${c.to}`).join(' · ');
  function paintNote(text) { if (painted.note !== text) { painted.note = text; beatEl.textContent = text; } }
  function paintSettled(i) {
    const r = rounds[i];
    paintHero(i);
    if (player.mode !== 'show') paintNote(r.N == null ? '' : r.changes.length ? `变化最大：${changesLine(r)}` : '这一轮份额一格没动');
    $('.mx-now-n').innerHTML = `<span><b>${r.items.length}</b> 件</span><span>用 <b>${r.used}</b> / 64 份</span><span><b>${r.asks.length}</b> 个问题开着</span>`;
    const x = sx(i);
    stage.querySelectorAll('.mx-spark-now').forEach(line => { line.style.transform = `translateX(${x}px)`; });
    if (mode === 'top') {
      stage.querySelectorAll('.mx-item[data-legend]').forEach(btn => {
        const share = r.shares.get(btn.dataset.legend);
        btn.querySelector('b').textContent = share ?? '—';
        btn.classList.toggle('is-absent', !share);
      });
      const other = stage.querySelector('.mx-item.is-other b');
      if (other) other.textContent = others[i];
    } else if (area) {
      stage.querySelector('.mx-areas .mx-spark-now').style.transform = `translateX(${(i / last * area.W).toFixed(1)}px)`;
      stage.querySelectorAll('.mx-item.is-stream').forEach(el => { el.querySelector('b').textContent = area.sums[i][el.dataset.stream]; });
    }
    // The big waffle's N outline and its dots.
    bigOutline.setAttribute('d', squares(outlineOf(i), BP, BIG, 0.75));
    paintBigDots(i);
    painted.settled = i;
  }
  function paintAsks(i) {
    const r = rounds[i], fresh = new Set(r.opened.map(a => a.key));
    // One line per question; the same question asked of an item and of its sub-item reads as one line “×2” (two dots).
    const lines = sameAsks(r.asks), open = lines.slice(0, 5), closed = r.closed.slice(0, 3);
    $('.mx-asks').innerHTML = `<h3>● 此刻开着的问题 <b>${r.asks.length ? `${r.asks.length} 个` : '没有'}</b></h3>
      ${open.map(({ a, n, keys }) => `<button type="button" class="mx-ask" data-askroot="${esc(a.root)}"><i style="background:${colorOfRoot(a.root)}"></i><span><b>${esc(EXPECT_WORDS[a.ask.expects] || '')}</b> ${esc(a.ask.prompt)}</span>${n > 1 ? `<em>×${n}</em>` : keys.some(k => fresh.has(k)) ? '<em>新</em>' : ''}</button>`).join('')}
      ${lines.length > open.length ? `<p class="mx-small">另 ${lines.length - open.length} 行</p>` : ''}
      ${closed.map(a => `<button type="button" class="mx-ask is-closed" data-askroot="${esc(a.root)}" title="${esc(`${a.ask.prompt} → ${a.how}`)}"><i></i><span><s>${esc(clip(a.ask.short || a.ask.prompt, 16))}</s> → ${esc(a.how)}</span></button>`).join('')}
      ${r.closed.length > closed.length ? `<p class="mx-small">本轮另关上 ${r.closed.length - closed.length} 个</p>` : ''}`;
    painted.asks = i;
  }
  function sameAsks(list) {
    const groups = new Map();
    for (const a of list) {
      const k = `${a.root}|${a.ask.prompt}`;
      if (!groups.has(k)) groups.set(k, { a, n: 0, keys: [] });
      const g = groups.get(k); g.n += 1; g.keys.push(a.key);
    }
    return [...groups.values()];
  }
  function beatNote(i) {
    const r = rounds[i], name = id => shortOf(id);
    if (i === beats.b1) { const top = [...r.items].sort((a, b) => b.share - a.share || orderOf(a.id) - orderOf(b.id))[0]; return top ? `${name(top.id)} · ${top.share} 格${ROWS[top.share] ? ` · 前${ROWS[top.share]}` : ''}` : ''; }
    if (i === beats.b2) return [...r.items].sort((a, b) => b.share - a.share || orderOf(a.id) - orderOf(b.id)).filter(x => x.share >= 12).slice(0, 3).map(x => `${name(x.id)} ${x.share}`).join(' · ');
    if (i === beats.b3) return `${r.freed ? `空出 ${r.freed} 格 · ` : ''}${changesLine(r)}`;
    return '';
  }

  // ---------- the big waffle: 64 cells that move between frames ----------
  const posOf = idx => [(idx % 8) * BP, Math.floor(idx / 8) * BP];
  const bigEls = new Map();            // key → { el, id, x, y, s }
  let trans = null;                    // the transition being played: { a, b, stay, add, gone, ghosts }
  function makeCell(c) {
    const el = document.createElementNS(SVGNS, 'rect');
    el.setAttribute('width', BIG); el.setAttribute('height', BIG); el.setAttribute('rx', 1.5);
    el.setAttribute('class', 'mx-bigcell');
    el.dataset.root = c.id;
    el.setAttribute('fill', cellColor(c.id));
    return el;
  }
  function placeEl(rec, x, y, s = 1, dx = 0, dy = 0) {
    const t = s >= 0.999 ? `translate(${(x + dx).toFixed(2)} ${(y + dy).toFixed(2)})`
      : `translate(${(x + dx + BIG / 2).toFixed(2)} ${(y + dy + BIG / 2).toFixed(2)}) scale(${Math.max(0, s).toFixed(3)}) translate(${-BIG / 2} ${-BIG / 2})`;
    if (rec.t !== t) { rec.t = t; rec.el.setAttribute('transform', t); }
  }
  /** Snap the big waffle to frame i (no motion). */
  function snapBig(i) {
    trans = null;
    leavingG.replaceChildren(); ghostEl.setAttribute('d', '');
    const seen = new Set();
    layouts[i].forEach((c, idx) => {
      let rec = bigEls.get(c.key);
      if (!rec) { rec = { el: makeCell(c), id: c.id }; bigEls.set(c.key, rec); bigCells.append(rec.el); }
      rec.el.setAttribute('fill', cellColor(c.id));
      const [x, y] = posOf(idx);
      rec.x = x; rec.y = y; rec.idx = idx;
      placeEl(rec, x, y);
      seen.add(c.key);
    });
    for (const [key, rec] of bigEls) if (!seen.has(key)) { rec.el.remove(); bigEls.delete(key); }
    bigShown = i;
  }
  let bigShown = null;
  /** Set up the motion from what the big waffle shows now to frame b. */
  function beginBig(a, b, seg) {
    if (bigShown !== a) snapBig(a);
    leavingG.replaceChildren();
    const next = new Map(layouts[b].map((c, idx) => [c.key, { c, idx }]));
    const stay = [], add = [], gone = [];
    let order = 0;
    for (const [key, rec] of bigEls) {
      const to = next.get(key);
      if (to) { const [x, y] = posOf(to.idx); stay.push({ rec, x0: rec.x, y0: rec.y, x1: x, y1: y }); rec.x = x; rec.y = y; rec.idx = to.idx; }
      else { gone.push({ rec, x: rec.x, y: rec.y }); leavingG.append(rec.el); bigEls.delete(key); }
    }
    for (const [key, { c, idx }] of next) {
      if (bigEls.has(key)) continue;
      const rec = { el: makeCell(c), id: c.id };
      const [x, y] = posOf(idx);
      rec.x = x; rec.y = y; rec.idx = idx;
      bigEls.set(key, rec); bigCells.append(rec.el);
      add.push({ rec, x, y, delay: seg.kind === 'grow' ? idx * T.grow : 0, order: order += 1 });
      placeEl(rec, x, y, 0);
    }
    // The ghosts: one grey square per cell that left, in its old place, under the cells.
    ghostEl.setAttribute('d', gone.map(g => `M${(g.x + 1).toFixed(1)} ${(g.y + 1).toFixed(1)}h${BIG - 2}v${BIG - 2}h${-(BIG - 2)}z`).join(''));
    ghostEl.style.opacity = '0';
    bigOutline.setAttribute('d', ''); bigDots.replaceChildren();
    trans = { a, b, stay, add, gone };
    bigShown = b;
  }
  function paintBig(seg, e) {
    if (!trans) return;
    const rm = reducedMotion();
    const { m0, m1 } = seg;
    const k = rm ? 1 : clamp((e - m0) / Math.max(0.001, m1 - m0));
    const slide = easeOut(k);
    for (const s of trans.stay) placeEl(s.rec, lerp(s.x0, s.x1, slide), lerp(s.y0, s.y1, slide));
    for (const s of trans.add) {
      const g = rm ? 1 : seg.kind === 'grow' ? easeOutBack((e - m0 - s.delay) / T.growCell) : easeOutBack(k);
      placeEl(s.rec, s.x, s.y, g);
    }
    // Leaving: the colour gives way to its grey shadow, which then thins out (the concept layer).
    const ge = e - m0, gd = seg.kind === 'slow' ? T.ghostSlow : T.ghost;
    leavingG.style.opacity = rm ? '0' : String(clamp(1 - ge / 0.15).toFixed(3));
    ghostEl.style.opacity = rm || ge < 0 ? '0' : String((0.9 * (1 - clamp(ge / gd))).toFixed(3));
    if (k >= 1 && ge >= gd) { leavingG.replaceChildren(); ghostEl.setAttribute('d', ''); trans = null; }
  }
  function paintBigDots(i) {
    const dots = [];
    layouts[i].forEach((c, idx) => { if (c.dot) { const [x, y] = posOf(idx); dots.push(`<circle class="mx-bigdot" data-root="${esc(c.id)}" r="3" cx="${x + BIG / 2}" cy="${y + BIG / 2}"/>`); } });
    bigDots.innerHTML = dots.join('');
  }
  const squares = (list, pitch, size, inset) => list.map(idx => `M${((idx % 8) * pitch + inset).toFixed(2)} ${(Math.floor(idx / 8) * pitch + inset).toFixed(2)}h${size - 2 * inset}v${size - 2 * inset}h${-(size - 2 * inset)}z`).join('');
  const smallSquares = (i, list) => { const b = boxes[i]; return b ? list.map(idx => `M${(b.x + (idx % 8) * PITCH + 0.5).toFixed(1)} ${(b.y + Math.floor(idx / 8) * PITCH + 0.5).toFixed(1)}h${CELL - 1}v${CELL - 1}h${-(CELL - 1)}z`).join('') : ''; };

  // ---------- the cursor and its trail (hard cut; the trail is concept layer) ----------
  function placeCursor(i) {
    const b = boxes[i];
    if (!b) return;
    cursorEl.setAttribute('x', b.fx - 3); cursorEl.setAttribute('y', b.fy - 3);
    cursorEl.setAttribute('width', b.fw + 6); cursorEl.setAttribute('height', b.fh + 6);
  }
  // The two frames the cursor just left (from the show's own segments, so a still at any moment draws the same).
  function paintTrails(time) {
    const trails = [];
    if (player.mode === 'show' && time != null && !reducedMotion()) {
      for (let j = player.k; j >= 0 && trails.length < 2; j -= 1) { const s = player.segs[j]; if (s.a !== s.b) trails.push({ i: s.a, at: s.t0 }); }
    }
    trailEls.forEach((el, k) => {
      const t = trails[k], b = t && boxes[t.i];
      const a = !t || !b ? 0 : 0.55 * (1 - clamp((time - t.at) / T.trail));
      if (a <= 0.001) { if (el.style.opacity !== '0') el.style.opacity = '0'; return; }
      el.setAttribute('x', b.fx - 3); el.setAttribute('y', b.fy - 3); el.setAttribute('width', b.fw + 6); el.setAttribute('height', b.fh + 6);
      el.style.opacity = (a * (1 - 0.6 * dimNow)).toFixed(3);
    });
  }

  // ---------- the player: idle, a single round (step), or the show ----------
  // Show time is wall time minus every hold (hovering or opening stops it where it is), stretched by ?slow=.
  const hold = { at: null, total: 0 };
  const clock = () => ((hold.at ?? wall()) - hold.total) / SLOW;
  const player = { mode: 'idle', auto: false, segs: [], t0: 0, k: -1, index: model.snapshot().index, freeze: null };
  const painted = { settled: null, asks: null, note: '' };
  let dimNow = 0, dimKeep = '';
  const goModel = i => { if (model.snapshot().index === i) return; driving = true; model.goFrame(i); driving = false; };
  /** One round from frame a to b starting at t0: fast (0.6 s), slow (the third beat, 4 s) or the first growth from empty. */
  function roundSeg(a, b, t0, inShow) {
    const rm = reducedMotion();
    if (inShow && b === beats.b3) return { kind: 'slow', a, b, t0, dur: T.slow, m0: rm ? 0 : T.slowMove[0], m1: rm ? 0 : T.slowMove[1], settle: rm ? 0 : T.slowMove[1], note: T.slowNote, dim: T.slowDim };
    if (inShow && b === a + 1 && rounds[a].used === 0 && rounds[b].used > 0) {
      const end = rm ? 0 : (rounds[b].used - 1) * T.grow + T.growCell;
      return { kind: 'grow', a, b, t0, dur: Math.max(T.fast, end + 0.26), m0: 0, m1: end, settle: end, note: null };
    }
    const extra = inShow ? (b === beats.b1 ? T.hold1 : b === beats.b2 ? T.hold2 : 0) : 0;
    return { kind: 'fast', a, b, t0, dur: T.fast + extra, m0: 0, m1: rm ? 0 : T.move, settle: rm ? 0 : T.move, note: extra ? T.note : null };
  }
  function planFrom(from) {
    const segs = [];
    let t = 0;
    if (from === 0) { segs.push({ kind: 'hold', a: 0, b: 0, t0: 0, dur: T.open, m0: 0, m1: 0, settle: 0, note: null }); t = T.open; }
    for (let i = from + 1; i <= last; i += 1) { const s = roundSeg(i - 1, i, t, true); segs.push(s); t += s.dur; }
    segs.push({ kind: 'hold', a: last, b: last, t0: t, dur: T.tail, m0: 0, m1: 0, settle: 0, note: null, tail: true });
    return Object.assign(segs, { end: t + T.tail });
  }
  function startShow(from = 0, auto = false) {
    if (from >= last) from = 0;
    ix?.reset();
    player.mode = 'show'; player.auto = auto; player.segs = planFrom(from); player.t0 = clock(); player.k = -1; player.freeze = null;
    if (from > 0) snapBig(from);
    paintControls();
  }
  function startStep(a, b) {
    player.mode = 'step'; player.auto = false; player.segs = [roundSeg(a, b, 0, false)]; player.t0 = clock(); player.k = -1; player.freeze = null;
    paintControls();
  }
  /** Stop playing and settle on frame i: the film goes back to its still, the cursor stays on i. */
  function settle(i, sync = true) {
    player.mode = 'idle'; player.auto = false; player.segs = []; player.k = -1; player.freeze = null;
    player.index = i;
    if (lastHit && lastHit.frame !== i) lastHit = null;
    snapBig(i); paintCut(i); paintSettled(i); paintAsks(i); placeCursor(i); paintTrails(null);
    outlineEl.setAttribute('d', ''); outlineEl.style.opacity = '';
    setDim(0, null);
    if (sync) goModel(i);
    paintControls();
  }
  /** A cut: the cursor jumps, the date and narration flip, last round's outline goes; the move to seg.b begins. */
  function cut(seg) {
    player.index = seg.b;
    goModel(seg.b);
    placeCursor(seg.b);
    paintCut(seg.b);
    outlineEl.setAttribute('d', '');
    if (seg.kind !== 'hold' || bigShown !== seg.b) beginBig(seg.a, seg.b, seg);
    painted.settled = null; painted.asks = null;
    if (seg.kind !== 'slow') setDim(0, null);
    // Until the cells settle the number and the counts are still last round's (a still at any moment says the same).
    if (seg.a !== seg.b) paintHero(seg.a);
    if (player.mode === 'show' && !seg.tail) paintNote('');
  }
  // The third beat's dimming: every waffle but the compared pair goes down to seventy percent.
  function setDim(v, keep) {
    const kk = keep ? keep.join(',') : '';
    if (kk !== dimKeep) { dimKeep = kk; weeksEl.querySelectorAll('.mx-frame').forEach(el => el.classList.toggle('is-keep', Boolean(keep?.includes(Number(el.dataset.go))))); }
    if (Math.abs(v - dimNow) < 0.002 && (v > 0) === weeksEl.classList.contains('is-dim')) return;
    dimNow = v;
    weeksEl.classList.toggle('is-dim', v > 0);
    weeksEl.style.setProperty('--mx-dim', (1 - 0.3 * v).toFixed(3));
  }
  function step() {
    if (player.mode === 'idle') return null;
    const time = player.freeze ?? clock() - player.t0;
    const segs = player.segs, end = segs.at(-1).t0 + segs.at(-1).dur;
    if (time >= end && player.freeze == null) { const i = segs.at(-1).b; settle(i); return null; }
    let k = player.k;
    if (k >= 0 && segs[k].t0 > time) k = -1;
    while (k + 1 < segs.length && segs[k + 1].t0 <= time) k += 1;
    if (k < 0) k = 0;
    if (k !== player.k) { player.k = k; cut(segs[k]); }
    return { seg: segs[k], e: time - segs[k].t0, time };
  }
  /** What the round shows at e seconds: the cells, then (once) the settled numbers, notes and questions. */
  function paintRound({ seg, e, time }) {
    paintBig(seg, e);
    if (e >= seg.settle && painted.settled !== seg.b) {
      paintSettled(seg.b);
      if (seg.kind !== 'slow') paintAsks(seg.b);
      if (player.mode === 'show' && seg.b > 0) outlineEl.setAttribute('d', smallSquares(seg.b, outlineOf(seg.b)));
    }
    if (seg.kind === 'slow' && e >= seg.note && painted.asks !== seg.b) paintAsks(seg.b);
    const noteAt = seg.note;
    if (player.mode === 'show' && noteAt != null && e >= noteAt) paintNote(beatNote(seg.b));
    if (seg.tail) outlineEl.style.opacity = String(1 - clamp(e / seg.dur));
    else if (outlineEl.style.opacity !== '') outlineEl.style.opacity = '';
    if (seg.kind === 'slow') {
      const v = reducedMotion() ? (e >= seg.dim[0] ? 1 : 0) : clamp((e - seg.dim[0]) / (seg.dim[1] - seg.dim[0]));
      setDim(v, [seg.b - 1, seg.b]);
    }
    paintTrails(time);
  }
  function paintControls() {
    const btn = $('[data-show]');
    const showing = player.mode === 'show';
    btn.textContent = showing ? (player.auto ? '跳过 ⏭' : '■ 停住') : '▶ 放一遍';
    btn.classList.toggle('is-on', showing);
    wrap.classList.toggle('is-playing', player.mode !== 'idle');
  }

  // ---------- interaction (motion/ix.mjs): what is under a point, where its card hangs ----------
  // Ids: a root item's id, or '@<frame index>' for a frame (its waffle's border and blank cells, its time, its note).
  // The frame a hovered cell belongs to is the context of the card: the last hit, else the frame on screen.
  let lastHit = null;
  const frameOf = id => (String(id).startsWith('@') ? Number(String(id).slice(1)) : null);
  const ctxOf = id => (frameOf(id) != null ? { kind: 'frame', frame: frameOf(id) } : lastHit && lastHit.id === id ? lastHit : { kind: 'big', id, frame: player.index });
  const rectIn = el => { const a = el.getBoundingClientRect(), w = wrap.getBoundingClientRect(); return { x0: a.left - w.left, y0: a.top - w.top, x1: a.right - w.left, y1: a.bottom - w.top }; };
  function locate(cx, cy, el) {
    const big = bigSvg.getBoundingClientRect();
    if (cx >= big.left - BAND && cx <= big.right + BAND && cy >= big.top - BAND && cy <= big.bottom + BAND && !el?.closest?.('.ix-peek, .ix-detail, .mx-hero')) {
      const col = clamp(Math.floor((cx - big.left + BIG_GAP / 2) / BP), 0, 7), row = clamp(Math.floor((cy - big.top + BIG_GAP / 2) / BP), 0, 7);
      const idx = row * 8 + col, c = layouts[player.index][idx];
      return c ? { kind: 'big', id: c.id, frame: player.index, idx } : { kind: 'frame', id: `@${player.index}`, frame: player.index, idx };
    }
    if (!el) return null;
    const svg = el.closest?.('svg[data-frame]');
    if (svg) {
      const j = Number(svg.dataset.frame), box = svg.getBoundingClientRect();
      const col = clamp(Math.floor((cx - box.left + GAP / 2) / PITCH), 0, 7), row = clamp(Math.floor((cy - box.top + GAP / 2) / PITCH), 0, 7);
      const idx = row * 8 + col, c = layouts[j][idx];
      return c ? { kind: 'small', id: c.id, frame: j, idx } : { kind: 'frame', id: `@${j}`, frame: j };
    }
    const go = el.closest?.('.mx-frame[data-go], .mx-notes [data-note]');
    if (go) { const j = Number(go.dataset.go); return { kind: 'frame', id: `@${j}`, frame: j }; }
    const row = el.closest?.('[data-legend], [data-askroot]');
    if (row) { const id = row.dataset.legend || row.dataset.askroot; return { kind: 'row', id, frame: player.index, el: row }; }
    return null;
  }
  const known = id => Boolean(factOf(id)) && allRoots.includes(id);
  function hit(x, y) {
    const w = wrap.getBoundingClientRect(), cx = w.left + x, cy = w.top + y;
    const h = locate(cx, cy, document.elementFromPoint(cx, cy));
    if (!h || (h.kind !== 'frame' && !known(h.id))) return null;
    lastHit = h;
    return h.id;
  }
  // The facts behind both cards: dial-model's itemFacts for an item, the round itself for a frame.
  const frameFacts = new Map();
  function factsOf(id) {
    const c = ctxOf(id);
    if (c.kind === 'frame') {
      if (!frameFacts.has(c.frame)) frameFacts.set(c.frame, { frame: true, i: c.frame, id, short: rounds[c.frame].id, r: rounds[c.frame], asks: [], trend: [], inputs: [], feedback: [], children: [], stream: [] });
      return frameFacts.get(c.frame);
    }
    return itemFacts(c.frame, id);
  }
  // The card keeps to the round's beat: before the cells settle it says the round is still moving.
  const settledFor = i => i !== player.index || painted.settled === i;
  const seenOf = i => (settledFor(i) ? { inputs: true, share: true, asks: true } : { inputs: true, share: false, asks: false });
  const changeWords = (from, to) => (!from && to ? `新增 ${to} 份` : from && !to ? `撤下 · 原 ${from} 份` : to > from ? `变大 ${from}→${to}` : to < from ? `变小 ${from}→${to}` : `不变 ${to} 份`);
  const whenOf = i => `${rounds[i].id} · ${dayTime(rounds[i].at)}`;
  const streamLabel = id => (hasStreams && streamOf(id) ? STREAMS[streamOf(id)]?.label : '');
  function peekFrame(f, seen) {
    const r = f.r, i = f.i;
    const moved = r.N == null ? '还没有上一轮' : !seen.share ? '这一轮还在动' : `换手 ${r.N} 格${r.freed ? ` · 空出 ${r.freed}` : ''}${r.N ? '' : ' · 一格没动'}`;
    const top = seen.share && r.changes.length ? `<div class="ix-d">${esc(r.changes.slice(0, 3).map(c => `${shortOf(c.id)} ${c.from}→${c.to}`).join(' · '))}</div>` : '';
    const closed = seen.asks ? r.closed.slice(0, 3).map(a => `<div class="ix-ask is-closed"><i></i><span><s>${esc(clip(a.ask.short || a.ask.prompt, 22))}</s></span><small>${esc(a.how)}</small></div>`).join('') : '';
    const opened = seen.asks ? r.opened.slice(0, 3).map(a => `<div class="ix-ask"><i></i><span>${esc(clip(a.ask.short || a.ask.prompt, 22))}</span><small>新登记${a.ask.due_at ? ` · ${esc(dueText(Date.parse(a.ask.due_at)))}` : ''}</small></div>`).join('') : '';
    return `<div class="ix-k">${esc(whenOf(i))}${r.tag ? ` · ${r.tag}` : ''}</div><div class="ix-q">${esc(r.title)}</div>
      <div class="ix-d">${esc(moved)}</div><div class="ix-d">${r.items.length} 件 · 用 ${r.used} / 64 · ${r.asks.length} 个问题开着</div>${top}${closed}${opened}`;
  }
  function peekItem(f, { seen, asks }) {
    const i = f.i, r = rounds[i], label = streamLabel(f.id), cum = factOf(f.id)?.cum ?? 0;
    const share = seen.share ? f.share : f.before;
    const inRoot = share > 0;
    const moved = r.N == null ? '' : !seen.share ? '这一轮还在动' : `这一轮换手 ${r.N} 格${r.freed ? ` · 空出 ${r.freed}` : ''} · ${r.asks.length} 个问题开着`;
    return `<div class="ix-k">${esc(whenOf(i))}${label ? ` · 来自${esc(label)}` : ''}</div><div class="ix-q">${esc(inRoot ? `${f.short} ${share} 份` : f.short)}</div>
      <div class="ix-d">${esc(!seen.share ? '本轮的份额还没落定' : inRoot || f.before ? changeWords(f.before, f.share) : '这一帧不在根层')} · 两周累计 ${cum} 格</div>
      <div class="ix-d">${!seen.inputs ? '本轮的输入还在路上' : f.inputs.length ? `本轮进了 ${f.inputs.length} 条输入` : '本轮没有输入进它'}</div>
      ${asks.map(a => `<div class="ix-ask"><i></i><span>${esc(a.short)}</span>${a.due ? `<small>${esc(a.due)}</small>` : ''}</div>`).join('')}
      ${moved ? `<div class="ix-d mx-peek-round">${esc(moved)}</div>` : ''}`;
  }
  // The detail: 这一件 in this frame. Its questions link to the same frame's D only when they stay open to the end; one that
  // is answered or lapses later says where it closed, with no link (the film already shows what came after).
  function detailItem(f, { seen, asks }) {
    const i = f.i, label = streamLabel(f.id), cum = factOf(f.id)?.cum ?? 0;
    const share = seen.share ? f.share : f.before;
    const W = 300, H = 34, n = last, bw = W / n, topV = Math.max(24, ...f.trend);
    const moves = [];
    const bars = f.trend.slice(1).map((s, k) => {
      const j = k + 1, prev = f.trend[j - 1], h = s ? Math.max(1.5, (s / topV) * (H - 7)) : 1;
      if (Math.abs(s - prev) >= 6) moves.push({ j, from: prev, to: s });
      const asked = rounds[j].dots.get(f.id);
      return `<rect x="${(k * bw + bw * 0.15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" class="${j === i ? 'is-now' : s ? '' : 'is-off'}"/>${asked ? `<rect class="mx-bar-ask" x="${(k * bw + bw * 0.3).toFixed(1)}" y="${(H - h - 4).toFixed(1)}" width="${(bw * 0.4).toFixed(1)}" height="2.5"/>` : ''}`;
    }).join('');
    const groups = new Map();
    for (const x of f.inputs) { if (!groups.has(x.source)) groups.set(x.source, []); groups.get(x.source).push(x); }
    const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
    const inputs = sorted.slice(0, 3).map(([source, list]) => `<li><small>${esc(source)} · ${list.length} 条</small>${[...new Map(list.map(x => [x.title, x])).values()].slice(0, 2).map(x => `<span>${x.from ? `<em>${esc(x.from)}</em> ` : ''}${esc(x.title)}</span>`).join('')}</li>`).join('');
    const href = withDataset(`../index.html?variant=d&frame=${i}`);
    const list = asks.length ? asks.map(a => {
      const key = a.id || null, closes = key ? closesAfter(key, i) : null;
      const after = closes != null ? `之后在 ${rounds[closes].id} 关上 · ${closeHow(key, closes)}` : '';
      return `<div class="ix-d-ask"><i></i><p>${esc(a.prompt)}</p><small>${esc(a.due || '没有期限')}</small>${after ? `<small class="mx-after">${esc(after)}</small>` : `<a href="${esc(href)}">去回答 →</a>`}</div>`;
    }).join('') : '<p class="ix-none">这一帧没有开着的问题</p>';
    const fb = f.feedback.length ? `<ul class="ix-d-fb">${f.feedback.slice(-3).map(x => `<li><time>${esc(dayTime(x.at))}</time>${esc(x.text)}</li>`).join('')}</ul>` : '<p class="ix-none">到这一帧还没有你的回应</p>';
    return `<div class="ix-d-k"><span>这一件 · ${esc(whenOf(i))}</span><button type="button" data-x="close" aria-label="收回（Esc）" title="收回（Esc）">×</button></div>
      <div class="ix-d-t"><i class="mx-swatch" style="background:${colorOfRoot(f.id)}"></i>${esc(f.short)}</div>
      <div class="ix-d-s">${label ? `${esc(label)} · ` : ''}<b>${share} 份</b>${!seen.share ? ' · 本轮的份额还没落定' : share || f.before ? ` · ${esc(changeWords(f.before, f.share))}` : ' · 这一帧不在根层'} · 两周累计 ${cum} 格</div>
      ${f.summary ? `<p class="ix-d-sum mx-clamp">${esc(f.summary)}</p>` : ''}
      ${f.children.length ? `<section><h5>子层<b>${f.children.length} 件</b></h5><ul class="ix-d-kids">${f.children.map(c => `<li><span>${esc(c.title)}</span><b>${c.share}</b></li>`).join('')}</ul></section>` : ''}
      <section><h5>份额 · 逐帧<b>${esc(rounds[i].id)} ${share} 份</b></h5><svg class="ix-trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>
        <div class="ix-axis"><span>${esc(rounds[1]?.id || '')}</span><span>${esc(rounds[last].id)}</span></div>
        <p class="mx-moves">${moves.length ? `整块挪动 ${moves.length} 次：${esc(moves.map(m => `${rounds[m.j].id} ${m.from}→${m.to}`).join(' · '))}` : '两周里没有整块挪动（每次变动都不到 6 格）'}</p></section>
      <section><h5>本轮进了它<b>${f.inputs.length} 条</b></h5>${inputs ? `<ul class="ix-d-in">${inputs}</ul>` : '<p class="ix-none">本轮没有输入进它</p>'}</section>
      <section><h5>这一帧开着的问题<b>${asks.length ? `${asks.length} 条` : ''}</b></h5>${list}</section>
      <section><h5>你的回应<b>${f.feedback.length ? `共 ${f.feedback.length} 条` : ''}</b></h5>${fb}</section>
      <details class="mx-dossier"><summary>版本、依据与原文</summary>${dossierHTML(f.id, i)}</details>`;
  }
  // Card anchors (stage px). The big waffle's items hang their summary to its left; a small waffle's beside it; rows to
  // the left of the side panel.
  function blockOf(id) {
    const list = [];
    for (const rec of bigEls.values()) if (rec.id === id) list.push(rec.idx);
    return list.sort((a, b) => a - b);
  }
  function anchor(id) {
    const c = ctxOf(id), nowBox = rectIn($('.mx-now')), w = wrap.clientWidth;
    if (c.kind === 'frame' || c.kind === 'small') {
      const b = boxes[c.frame], host = rectIn(weeksWrap);
      if (!b) return { x: 0, y: 0, facing: 1 };
      const keep = { x0: host.x0 + b.fx, y0: host.y0 + b.fy, x1: host.x0 + b.fx + b.fw, y1: host.y0 + b.fy + b.fh };
      const facing = (keep.x0 + keep.x1) / 2 < w / 2 - 80 ? 1 : -1;
      const at = c.kind === 'small' && c.idx != null
        ? { x: host.x0 + b.x + (c.idx % 8) * PITCH + CELL / 2, y: host.y0 + b.y + Math.floor(c.idx / 8) * PITCH + CELL / 2 }
        : { x: facing > 0 ? keep.x1 : keep.x0, y: (keep.y0 + keep.y1) / 2 };
      return { x: facing > 0 ? keep.x1 : keep.x0, y: at.y, from: at, facing, keep, avoid: [nowBox] };
    }
    if (c.kind === 'row' && c.el?.isConnected) {
      const r = rectIn(c.el);
      return { x: r.x0, y: (r.y0 + r.y1) / 2, facing: -1, keep: r, avoid: [nowBox] };
    }
    const big = rectIn(bigSvg), cells = blockOf(id);
    const mid = cells[Math.floor(cells.length / 2)] ?? 0, [mx, my] = posOf(mid);
    return { x: big.x0, y: big.y0 + my + BIG / 2, from: { x: big.x0 + mx + BIG / 2, y: big.y0 + my + BIG / 2 }, facing: -1, keep: nowBox };
  }
  // The detail covers the side panel under the big waffle: the now text, the questions and the legend. Its leader leaves
  // the stepped-out block at its lowest cell, runs down the gap beside it to the waffle's lower edge, then straight down.
  function detailPlace(id, el) {
    const side = rectIn($('.mx-side')), big = rectIn(bigSvg), view = stage.getBoundingClientRect(), w0 = wrap.getBoundingClientRect();
    const top = big.y1 + 16, bottom = Math.min(view.bottom - w0.top - 10, Math.max(side.y1, top + 240));
    // A panel of its own: it fills the side from under the waffle down, whatever its content (which scrolls inside).
    const h = Math.max(160, bottom - top), x = side.x0, y = top;
    el.style.width = `${side.x1 - side.x0}px`;
    el.style.maxHeight = `${h}px`; el.style.height = `${h}px`;
    const cells = blockOf(id);
    if (!cells.length) return { x, y, w: side.x1 - side.x0, h, path: [{ x: x + 24, y }, { x: x + 24, y }] };
    const lowRow = Math.floor(cells.at(-1) / 8), row = cells.filter(k => Math.floor(k / 8) === lowRow);
    const cell = row[Math.floor(row.length / 2)], [cx, cy] = posOf(cell), d = popDir(id);
    const gx = big.x0 + ((cell % 8) === 7 ? cx - BIG_GAP / 2 : cx + BIG + BIG_GAP / 2);
    const p0 = { x: big.x0 + cx + BIG / 2 + d[0] * IX.pop, y: big.y0 + cy + BIG + d[1] * IX.pop };
    const path = [p0, { x: big.x0 + cx + BIG / 2, y: big.y0 + cy + BIG + BIG_GAP / 2 }, { x: gx, y: big.y0 + cy + BIG + BIG_GAP / 2 }, { x: gx, y: big.y1 + 4 }, { x: gx, y }];
    return { x, y, w: side.x1 - side.x0, h, path };
  }
  // Which way the open block steps out: from the waffle's centre towards the block's centre; straight down (towards the
  // panel) when the block sits within one cell of the centre.
  function popDir(id) {
    const cells = blockOf(id);
    if (!cells.length) return [0, 1];
    let sx0 = 0, sy0 = 0;
    for (const k of cells) { const [x, y] = posOf(k); sx0 += x + BIG / 2; sy0 += y + BIG / 2; }
    const dx = sx0 / cells.length - BIG_SIDE / 2, dy = sy0 / cells.length - BIG_SIDE / 2, d = Math.hypot(dx, dy);
    return d < BP ? [0, 1] : [dx / d, dy / d];
  }
  let X = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
  const ix = createIx({
    stage: wrap, keysIn: wrap,
    facts: factsOf, has: id => frameOf(id) != null ? frameOf(id) >= 0 && frameOf(id) <= last : known(id), hit,
    named: name => (frameOf(name) != null ? name : known(name) ? name : rounds[player.index].items.map(x => x.id).find(id => shortOf(id) === name) || allRoots.find(id => shortOf(id) === name) || null),
    pointOf: id => {
      const f = frameOf(id);
      if (f != null) { const b = boxes[f], host = rectIn(weeksWrap); return b ? { x: host.x0 + b.x + SIDE / 2, y: host.y0 + b.y + SIDE / 2 } : null; }
      const cells = blockOf(id), big = rectIn(bigSvg);
      if (!cells.length) return null;
      const [x, y] = posOf(cells[Math.floor(cells.length / 2)]);
      return { x: big.x0 + x + BIG / 2, y: big.y0 + y + BIG / 2 };
    },
    pause: () => { if (hold.at == null) hold.at = wall(); }, resume: () => { if (hold.at != null) { hold.total += wall() - hold.at; hold.at = null; } }, paused: () => hold.at != null,
    last, answerHref: f => withDataset(`../index.html?variant=d&frame=${f.i}`),
    seen: () => { const id = ix?.s.open || ix?.s.peek || ix?.s.hover; return id ? seenOf(factsOf(id).i) : seenOf(player.index); },
    asks: f => (f.frame ? [] : f.asks),
    peekHTML: (f, o) => (f.frame ? peekFrame(f, o.seen) : peekItem(f, o)), detailHTML: (f, o) => (f.frame ? peekFrame(f, o.seen) : detailItem(f, o)),
    anchor, detailPlace, skip: '.mx-head', label: '这一帧的事项与 29 帧：Tab 逐个看概要，Enter 展开这一件或跳到那一帧，Esc 收回',
  });
  // A frame is not something to open: clicking it (its time, note, border or blank cells), or Enter on its key, goes to
  // that frame. A cell of another frame first cuts to that frame, then opens there (the shared module does the opening).
  wrap.addEventListener('click', event => {
    if (event.target.closest('.ix-peek, .ix-detail, .mx-head')) return;
    const key = event.target.closest('[data-ix]');
    const touch = ix.s.pointer === 'touch';
    if (key) { const f = frameOf(key.dataset.ix); if (f != null) { event.stopPropagation(); navigate(f); } return; }
    const h = locate(event.clientX, event.clientY, event.target);
    if (!h) return;
    if (h.kind === 'frame') {
      if (touch && ix.s.hover !== h.id) return;              // the first tap is the hover
      event.stopPropagation();
      if (h.frame !== player.index) navigate(h.frame);       // the frame on screen (its blank cells) stays as it is
    } else if (h.kind === 'small' && h.frame !== player.index) {
      if (touch && ix.s.hover !== h.id) return;
      if (player.mode !== 'idle') settle(player.index);
      lastHit = { ...h };
      settle(h.frame);
    } else if (h.kind === 'row') {
      event.stopPropagation();
      lastHit = h;
      if (ix.s.open === h.id && ix.s.closeAt == null) ix.close(); else ix.open(h.id);
    }
  }, true);

  // The keyboard's items are this frame's; a card reached by Tab is never about a frame the pointer visited before.
  wrap.addEventListener('focusin', event => { if (event.target.closest?.('.ix-sr')) lastHit = null; }, true);

  // Focus and pop, painted every animation frame from ix.frame(): hovering an item lights it in all 29 frames (the others
  // go light grey, as before); hovering a frame shows that frame's N outline; the open item steps out of the big waffle.
  let focusKey = '';
  function paintFocus() {
    const item = X.focus && frameOf(X.focus) == null ? X.focus : null;
    const key = item || '';
    if (key !== focusKey) {
      focusKey = key;
      focusStyle.textContent = item ? `.mx-wrap .mx-cell:not([data-root="${CSS.escape(item)}"]), .mx-wrap .mx-bigcell:not([data-root="${CSS.escape(item)}"]) { fill: ${GREY}; }
        .mx-wrap .mx-dot:not([data-root="${CSS.escape(item)}"]), .mx-wrap .mx-bigdot:not([data-root="${CSS.escape(item)}"]) { opacity: .25; }
        .mx-item[data-legend]:not([data-legend="${CSS.escape(item)}"]) { opacity: .45; }` : '';
    }
    const hoverFrame = frameOf(X.peekId) != null && X.peek > 0.01 ? frameOf(X.peekId) : frameOf(X.focus);
    const hd = hoverFrame != null && hoverFrame > 0 ? smallSquares(hoverFrame, outlineOf(hoverFrame)) : '';
    if (hoverOutlineEl.getAttribute('d') !== hd) hoverOutlineEl.setAttribute('d', hd);
    const kf = frameOf(X.keyFocus);
    if (kf != null && boxes[kf]) { const b = boxes[kf]; keyRing.setAttribute('x', b.fx - 5); keyRing.setAttribute('y', b.fy - 5); keyRing.setAttribute('width', b.fw + 10); keyRing.setAttribute('height', b.fh + 10); keyRing.style.opacity = '1'; }
    else if (keyRing.style.opacity !== '0') keyRing.style.opacity = '0';
    // The open block steps out along “centre → its centre”; its dots go with it.
    const popId = X.popId && frameOf(X.popId) == null && X.pop > 0.001 ? X.popId : null;
    const d = popId ? popDir(popId) : [0, 0], amount = popId ? IX.pop * X.pop : 0;
    if (!trans) for (const rec of bigEls.values()) placeEl(rec, rec.x, rec.y, 1, rec.id === popId ? d[0] * amount : 0, rec.id === popId ? d[1] * amount : 0);
    const dt = popId ? `translate(${(d[0] * amount).toFixed(2)} ${(d[1] * amount).toFixed(2)})` : '';
    bigDots.querySelectorAll('.mx-bigdot').forEach(el => { const t = el.dataset.root === popId ? dt : ''; if ((el.getAttribute('transform') || '') !== t) { if (t) el.setAttribute('transform', t); else el.removeAttribute('transform'); } });
    // The panel's heading follows the open item (the cut of the open motion).
    const view = X.detail ? ix.view : null;
    const k = view && !view.frame ? `这一件 · ${whenOf(view.i)}` : `此刻 · ${whenOf(player.index)}`;
    const kEl = $('.mx-now-k');
    if (kEl.textContent !== k) { kEl.textContent = k; $('.mx-now').classList.toggle('is-item', k.startsWith('这一件')); }
  }

  // ---------- navigation ----------
  /** Go to frame i through one round of the beat (stops a show; a jump plays the same three motions). */
  function navigate(i) {
    i = clamp(Math.round(i), 0, last);
    const from = player.mode === 'idle' ? player.index : player.segs[player.k]?.b ?? player.index;
    if (player.mode !== 'idle') settle(from, false);
    ix.reset();
    if (i === from) { goModel(i); return; }
    if (reducedMotion()) { settle(i); return; }
    startStep(from, i);
  }
  // Shell navigation (‹ › and the ticks, ←/→, the embedding page's frame) reaches us through the model.
  model.subscribe(s => {
    if (driving || !ready || s.index === player.index) return;
    if (player.mode === 'show' || player.mode === 'step') { const at = player.segs[player.k]?.b ?? player.index; if (at === s.index) return; }
    navigate(s.index);
  });
  function setMode(next) {
    if (next === mode || (next === 'stream' && !hasStreams)) return;
    mode = next;
    const q = new URLSearchParams(location.search);
    if (mode === 'stream') q.set('color', 'stream'); else q.delete('color');
    window.history.replaceState(null, '', `?${q}`);
    $('.mx-mode').querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
    relayoutCells(); buildGrid(); buildLegend(); measure();
    snapBig(player.index);
    paintCut(player.index); paintSettled(player.index); paintAsks(player.index);
    ix.relayout(); focusKey = '-';
  }
  stage.addEventListener('click', event => {
    const modeBtn = event.target.closest('[data-mode]');
    if (modeBtn) { setMode(modeBtn.dataset.mode); return; }
    if (event.target.closest('[data-show]')) {
      if (player.mode === 'show') { if (player.auto) settle(last); else settle(player.segs[player.k]?.b ?? player.index); }
      else startShow(0);
    }
  });
  // Keys. The automatic show gives way to any key (skips to the end, the key does nothing else); otherwise space plays
  // from here or stops, Home/End go to the ends, C switches the colouring. ←/→ are the shell's.
  window.addEventListener('keydown', event => {
    if (player.mode !== 'show' || !player.auto || event.metaKey || event.ctrlKey || event.altKey || ['Shift', 'Meta', 'Control', 'Alt'].includes(event.key)) return;
    if (event.key !== 'Tab') event.preventDefault();
    event.stopPropagation();
    settle(last);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.target.matches?.('input,textarea,select,[contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === ' ') {
      event.preventDefault();
      if (player.mode === 'show') settle(player.segs[player.k]?.b ?? player.index);
      else startShow(player.index >= last ? 0 : player.index);
    } else if (event.key === 'c' || event.key === 'C') setMode(mode === 'top' ? 'stream' : 'top');
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); navigate(event.key === 'Home' ? 0 : last); }
  });
  document.addEventListener('keyup', event => { if (event.key === ' ') event.preventDefault(); });

  // ---------- loop ----------
  const perf = { on: params.has('perf'), times: [], work: [] };
  let lastT = null;
  function frame(nowMs) {
    const w = nowMs / 1000;
    if (perf.on && lastT != null) perf.times.push(w - lastT);
    lastT = w;
    const at = step();
    X = ix.frame();
    if (at) paintRound(at);
    paintFocus();
    ix.paint();
    ix.sync(`${player.index}:${mode}`, () => [
      ...sortItems(rounds[player.index].items).map(x => ({ id: x.id, label: `${shortOf(x.id)} ${x.share} 份` })),
      ...rounds.map(r => ({ id: `@${r.i}`, label: `${r.id} ${dayTime(r.at)}${r.N == null ? '' : ` · 换手 ${r.N} 格`}` })),
    ]);
    if (perf.on) perf.work.push(performance.now() - nowMs);
    requestAnimationFrame(frame);
  }

  // ---------- boot ----------
  buildGrid();
  buildLegend();
  measure();
  fit(); measure();
  settle(player.index);
  ready = true;
  // The show plays once by itself only when this page is opened directly at the top level and its address named no
  // frame (multiples.html records the address before the shell adds ?frame=). Embedded, linked with a frame, in the
  // gallery's thumbnail or the combined page it stays still.
  const entry = new URLSearchParams(window.foldEntry ?? location.search);
  const top = window.parent === window;
  if (top && !entry.has('frame') && !params.has('item')) startShow(0, true);
  if (params.get('item') && known(params.get('item'))) { lastHit = null; ix.open(params.get('item')); }
  let timer = null;
  new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(() => { fit(); measure(); ix.relayout(); }, 60); }).observe(stage);
  document.fonts?.ready.then(() => { fit(); measure(); });
  requestAnimationFrame(frame);

  globalThis.foldMultiples = {
    player, rounds: rounds.map(r => ({ i: r.i, id: r.id, N: r.N, freed: r.freed, used: r.used, asks: r.asks.length,
      items: sortItems(r.items).map(x => ({ id: x.id, short: shortOf(x.id), share: x.share })) })),
    beats, plan: () => planFrom(0).map(s => ({ kind: s.kind, b: rounds[s.b].id, t0: +s.t0.toFixed(2), dur: +s.dur.toFixed(2) })),
    hold: i => navigate(i), startPlay: from => startShow(from ?? player.index), startShow: () => startShow(0), startHero: () => startShow(0),
    skip: () => settle(last), setMode, get mode() { return mode; },
    // A still of the show at t seconds from its start (stills and checks); any control releases it.
    freeze: t => { if (player.mode !== 'show') startShow(0); player.freeze = t; player.k = -1; },
    perf: () => {
      const ts = perf.times.slice(1), avg = ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length);
      const p95 = list => [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.95)] || 0;
      const work = perf.work.slice(1);
      return { frames: ts.length, fps: +(1 / avg).toFixed(1), p95ms: +(p95(ts) * 1000).toFixed(1),
        workMs: +(work.reduce((a, b) => a + b, 0) / Math.max(1, work.length)).toFixed(2), workP95ms: +p95(work).toFixed(2) };
    },
    resetPerf: () => { perf.on = true; perf.times = []; perf.work = []; },
    ...ix.hooks(),
    // The big waffle on the page (client px), for checks that aim at its edge.
    geom: () => { const b = bigSvg.getBoundingClientRect(); return { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom, cell: BIG, gap: BIG_GAP }; },
  };
}
