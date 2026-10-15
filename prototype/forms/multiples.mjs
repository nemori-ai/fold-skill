// 08 两周小倍数：每帧同尺度并排，每帧 8×8 = 64 格，一格一份，按排名从左上填，空格是未分配。
// 真实数据两周有 89 件根层事项，颜色不够分：两种上色可切换（按 C）：
//   前 8 件 —— 两周累计份额最多的 8 件各一色，其余灰；看“哪几件事吃掉了注意力、何时变大或消失”。默认。
//   按流   —— 工作、生活、社区三色，格子先按流再按份额排；看“工作与生活此消彼长”。
// 黑点只表示“这件事此刻有登记中的问题”，每件事一个点，点在它的第一格。悬停一件事时它在全部帧里亮起。
// 右栏的“此刻”方阵在切帧时逐格移动到新位置；格子本身不重绘。
import {
  topRoots, topColor, OTHER_COLOR, TOP_PALETTE, STREAMS, hasStreams, streamOf, factOf, itemAt, pathsOfItem, pathStatus,
  dossierHTML, kindLabel, createTip, createDrawer, timed, markHover, perf, esc, dayTime, EXPECT_WORDS, SLOW, reducedMotion,
} from './sketches/live.mjs';

const CELL = 7, GAP = 1, SIDE = 8 * CELL + 7 * GAP;
const BIG = 17, BIG_GAP = 2, BIG_SIDE = 8 * BIG + 7 * BIG_GAP;

export function mount(stage, model, kit) {
  const { records, scenario } = kit;
  const frames = scenario.frames;
  const params = new URLSearchParams(location.search);
  let mode = params.get('color') === 'stream' && hasStreams ? 'stream' : 'top';
  let focus = null, pinned = null, focusStream = null, timer = null;
  const tip = createTip(document.body, { fixed: true });
  const drawer = createDrawer(document.body, { fixed: true, onClose: () => { pinned = null; setFocus(null); } });
  const focusStyle = document.createElement('style');
  document.head.append(focusStyle);

  // Per frame: root items in rank order, which of them have an open question.
  const data = frames.map((frame, index) => {
    const state = records[index].state, ctx = { index, state };
    const asks = new Map();
    for (const { item } of kit.activeItems(state)) { const ask = kit.currentAsk(ctx, item.id); if (ask) asks.set(kit.rootOf(state, item.id), ask); }
    return { frame, index, items: state.root.items, asks, used: state.root.used };
  });
  const STREAM_ORDER = ['work', 'life', 'community', 'subscription', null];
  const cellColor = id => (mode === 'top' ? topColor(id) || OTHER_COLOR : STREAMS[streamOf(id)]?.color || OTHER_COLOR);
  /** The 64 cells of one frame, keyed item#k, in this mode's order. */
  function cellsOf(d) {
    const items = mode === 'stream' ? [...d.items].sort((a, b) => STREAM_ORDER.indexOf(streamOf(a.id)) - STREAM_ORDER.indexOf(streamOf(b.id))) : d.items;
    const cells = [];
    for (const item of items) for (let k = 0; k < item.share; k += 1) cells.push({ key: `${item.id}#${k}`, id: item.id, first: k === 0, ask: k === 0 && d.asks.get(item.id) });
    return cells;
  }

  stage.innerHTML = `<div class="mx-wrap">
    <header class="mx-head"></header>
    <div class="mx-body">
      <div class="mx-weeks-wrap"><div class="mx-weeks"></div><div class="mx-cursor" aria-hidden="true"></div></div>
      <aside class="mx-side">
        <section class="mx-now"><div class="mx-big" aria-label="此刻的 64 份"><svg width="${BIG_SIDE}" height="${BIG_SIDE}" viewBox="0 0 ${BIG_SIDE} ${BIG_SIDE}"><g class="mx-big-blank">${Array.from({ length: 64 }, (_, i) => `<rect x="${(i % 8) * (BIG + BIG_GAP)}" y="${Math.floor(i / 8) * (BIG + BIG_GAP)}" width="${BIG}" height="${BIG}" rx="1.5"/>`).join('')}</g><g class="mx-big-cells"></g></svg></div><div class="mx-now-text"></div></section>
        <section class="mx-asks"></section>
        <section class="mx-legend"></section>
      </aside>
    </div></div>`;
  const $ = s => stage.querySelector(s);
  const weeksEl = $('.mx-weeks'), cursor = $('.mx-cursor'), bigCells = $('.mx-big-cells');

  // ---------- the two-week grid (built per mode, not per frame) ----------
  function waffleSVG(d) {
    const cells = cellsOf(d);
    let out = '';
    cells.forEach((c, i) => {
      const x = (i % 8) * (CELL + GAP), y = Math.floor(i / 8) * (CELL + GAP);
      out += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${cellColor(c.id)}" class="mx-cell" data-root="${esc(c.id)}"/>`;
      if (c.ask) out += `<circle cx="${x + CELL / 2}" cy="${y + CELL / 2}" r="1.7" class="mx-dot" data-root="${esc(c.id)}"/>`;
    });
    for (let i = cells.length; i < 64; i += 1) out += `<rect x="${(i % 8) * (CELL + GAP)}" y="${Math.floor(i / 8) * (CELL + GAP)}" width="${CELL}" height="${CELL}" class="mx-blank"/>`;
    const tag = d.frame.signal?.type === 'review' ? '定时' : records[d.index].receipt?.type === 'checked' ? '检查' : '';
    return `<div class="mx-frame" data-go="${d.index}"><svg width="${SIDE}" height="${SIDE}" viewBox="0 0 ${SIDE} ${SIDE}" data-frame="${d.index}">${out}</svg><button class="mx-time" data-go="${d.index}" tabindex="-1">${kit.formatTime(d.frame.at)}${tag ? `<em>${tag}</em>` : ''}</button></div>`;
  }
  function buildGrid() {
    timed('builds', () => {
      const byDay = new Map();
      for (const d of data) { const day = kit.formatDate(d.frame.at); if (!byDay.has(day)) byDay.set(day, []); byDay.get(day).push(d); }
      const days = [...byDay.entries()];
      const half = Math.ceil(days.length / 2);
      const weeks = days.length > 8 ? [days.slice(0, Math.min(7, half)), days.slice(Math.min(7, half))] : [days];
      weeksEl.innerHTML = weeks.map((week, w) => `<section class="mx-week"><h3>${weeks.length > 1 ? (w ? '第二周' : '第一周') : '两周'}</h3>${week.map(([label, list]) => {
        const [md, wd] = [label.replace(/周.$/, ''), label.match(/周.$/)?.[0] || ''];
        return `<div class="mx-day${list.length > 3 ? ' is-busy' : ''}"><div class="mx-date"><b>${esc(md.split('/').pop())}</b><span>${esc(wd)}</span></div><div class="mx-row">${list.map(waffleSVG).join('')}</div><div class="mx-notes">${list.map(d => `<p data-go="${d.index}" data-note="${d.index}" title="${esc(d.frame.title)}"><b>${kit.formatTime(d.frame.at)}</b>${esc(d.frame.title)}</p>`).join('')}</div></div>`;
      }).join('')}</section>`).join('');
    });
  }

  // ---------- the "now" panel: 64 cells that move between frames ----------
  const bigEls = new Map();
  function renderBig(d, animate) {
    const cells = cellsOf(d), seen = new Set();
    const ms = animate && !reducedMotion() ? 380 * SLOW : 0;
    const pos = i => [(i % 8) * (BIG + BIG_GAP), Math.floor(i / 8) * (BIG + BIG_GAP)];
    // New cells start small at their place; one reflow, then everything moves to its target.
    let created = false;
    cells.forEach((c, i) => {
      if (bigEls.has(c.key)) return;
      const [x, y] = pos(i), el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      el.setAttribute('width', BIG); el.setAttribute('height', BIG); el.setAttribute('rx', 1.5);
      el.setAttribute('class', 'mx-bigcell is-new');
      el.style.transitionDuration = '0ms';
      el.style.transform = `translate(${x}px,${y}px) scale(.3)`;
      el.style.fill = cellColor(c.id);
      bigCells.append(el);
      bigEls.set(c.key, el);
      created = true;
    });
    if (created && ms) bigCells.getBoundingClientRect();
    cells.forEach((c, i) => {
      const [x, y] = pos(i), el = bigEls.get(c.key);
      el.dataset.root = c.id;
      el.style.transitionDuration = `${ms}ms`;
      el.style.transform = `translate(${x}px,${y}px)`;
      el.style.fill = cellColor(c.id);
      el.classList.remove('is-new', 'is-leaving');
      el.classList.toggle('has-ask', !!c.ask);
      seen.add(c.key);
    });
    for (const [key, el] of bigEls) {
      if (seen.has(key)) continue;
      bigEls.delete(key);
      el.style.transitionDuration = `${ms}ms`;
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), ms + 20);
    }
    // One dot per open question, on its item's first cell (drawn above the cells).
    bigCells.querySelectorAll('.mx-bigdot').forEach(el => el.remove());
    cells.forEach((c, i) => { if (!c.ask) return; const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('class', 'mx-bigdot'); dot.setAttribute('r', 3); dot.setAttribute('cx', (i % 8) * (BIG + BIG_GAP) + BIG / 2); dot.setAttribute('cy', Math.floor(i / 8) * (BIG + BIG_GAP) + BIG / 2); dot.dataset.root = c.id; dot.style.animationDuration = `${ms + 120}ms`; bigCells.append(dot); });
  }

  // ---------- legend ----------
  const shareHistory = id => data.map(d => d.items.find(i => i.id === id)?.share || 0);
  const others = data.map(d => d.items.filter(i => !topColor(i.id)).reduce((n, i) => n + i.share, 0));
  const SPARK_W = 112, SPARK_H = 22;
  const sx = i => (i / (frames.length - 1) * SPARK_W);
  function spark(values, color, max = 24) {
    const pts = values.map((v, i) => `${sx(i).toFixed(1)},${(SPARK_H - Math.min(v, max) / max * (SPARK_H - 3) - 1.5).toFixed(1)}`).join(' ');
    return `<svg class="mx-spark" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/><line class="mx-spark-now" x1="0" x2="0" y1="0" y2="${SPARK_H}"/></svg>`;
  }
  function streamArea() {
    // Stacked shares per stream over the two weeks: work at the bottom, then life, community.
    const H = 64, W = 250;
    const keys = ['work', 'life', 'community', 'subscription'].filter(k => data.some(d => d.items.some(i => streamOf(i.id) === k)));
    const sums = data.map(d => Object.fromEntries(keys.map(k => [k, d.items.filter(i => streamOf(i.id) === k).reduce((n, i) => n + i.share, 0)])));
    let base = data.map(() => 0), out = '';
    for (const k of keys) {
      const top = base.map((b, i) => b + sums[i][k]);
      const px = i => (i / (frames.length - 1) * W).toFixed(1), py = v => (H - v / 64 * H).toFixed(1);
      out += `<path d="M${top.map((v, i) => `${px(i)},${py(v)}`).join(' L')} L${base.map((v, i) => `${px(i)},${py(v)}`).reverse().join(' L')} Z" fill="${STREAMS[k].color}" class="mx-area" data-stream="${k}"/>`;
      base = top;
    }
    return { svg: `<svg class="mx-areas" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out}<line class="mx-spark-now" x1="0" x2="0" y1="0" y2="${H}"/></svg>`, keys, sums, W };
  }
  let area = null;
  function buildLegend() {
    const L = $('.mx-legend');
    if (mode === 'top') {
      L.innerHTML = `<h3>两周累计份额前 ${topRoots.length} 件 <small>走势 · 此刻份额</small></h3>${topRoots.map(id => `<button class="mx-item" data-legend="${esc(id)}"><i style="background:${topColor(id)}"></i><span class="mx-item-name"></span>${spark(shareHistory(id), topColor(id))}<b></b></button>`).join('')}
        <div class="mx-item is-other"><i style="background:${OTHER_COLOR}"></i><span>其余 ${allRoots.length - topRoots.length} 件，灰</span>${spark(others, '#8f8a7d', 64)}<b></b></div>
        <p class="mx-small">名字是此刻的标题；颜色按两周累计份额排定，不随帧变化。</p>`;
    } else {
      area = streamArea();
      L.innerHTML = `<h3>工作与生活 <small>两周里各流占的份额，叠起来是 64</small></h3>${area.svg}
        <div class="mx-streams">${area.keys.map(k => `<button class="mx-item is-stream" data-stream="${k}"><i style="background:${STREAMS[k].color}"></i><span>${STREAMS[k].label}</span><b></b></button>`).join('')}</div>
        <p class="mx-small">流来自每件事所引输入的多数来源（work / life / community）；格子先按流、再按份额排。</p>`;
    }
  }
  const allRoots = [...new Set(data.flatMap(d => d.items.map(i => i.id)))];

  // ---------- header ----------
  function renderHead(s) {
    const full = data.filter(d => d.used === 64).length, peak = Math.max(...data.map(d => d.items.length));
    $('.mx-head').innerHTML = `<div class="mx-kicker">两周小倍数 · 同尺度</div>
      <h2>${frames.length} 次整理，${allRoots.length} 件事到过根层，同一时刻最多 ${peak} 件，${full} 次用满 64 份</h2>
      <div class="mx-headrow"><p>每个方阵是一帧：一格一份，按排名从左上填起，空格是未分配。${mode === 'top' ? '只有两周累计份额最多的 8 件有颜色，其余是灰。' : '颜色是流：蓝是工作，橙是生活，绿是社区。'}黑点 = 这件事此刻有问题开着。悬停一件事，它在全部帧里亮起；点一格看详情。</p>
      <div class="mx-mode" role="radiogroup" aria-label="上色方式（C 切换）"><button role="radio" data-mode="top" aria-checked="${mode === 'top'}">前 8 件</button><button role="radio" data-mode="stream" aria-checked="${mode === 'stream'}"${hasStreams ? '' : ' disabled title="这个数据集没有流的标注"'}>按流</button></div></div>`;
  }

  // ---------- focus (hover) and pin ----------
  function setFocus(id, event, stream = null) {
    focus = id; focusStream = stream;
    const active = id || pinned;
    const css = [];
    if (active) css.push(`.mx-wrap .mx-cell:not([data-root="${CSS.escape(active)}"]), .mx-wrap .mx-bigcell:not([data-root="${CSS.escape(active)}"]) { fill: #e4e0d4 !important; } .mx-wrap .mx-dot:not([data-root="${CSS.escape(active)}"]), .mx-wrap .mx-bigdot:not([data-root="${CSS.escape(active)}"]) { opacity: .25; } .mx-item[data-legend]:not([data-legend="${CSS.escape(active)}"]) { opacity: .45; }`);
    else if (stream) css.push(`.mx-wrap .mx-cell:not(${allRoots.filter(r => streamOf(r) === stream).map(r => `[data-root="${CSS.escape(r)}"]`).join(',') || '[x]'}) { fill: #e4e0d4; } .mx-item.is-stream:not([data-stream="${stream}"]), .mx-area:not([data-stream="${stream}"]) { opacity: .35; }`);
    focusStyle.textContent = css.join('\n');
    if (event) markHover(event, stage.querySelector('.mx-cell'));
  }
  function cellTip(id, index) {
    const d = data[index], item = d.items.find(i => i.id === id) || itemAt(id, index), ask = d.asks.get(id);
    const stream = streamOf(id);
    return `<b>${esc(item.title)}</b><small>${esc(d.frame.id)} · ${esc(dayTime(d.frame.at))} · ${d.items.find(i => i.id === id) ? `${item.share} 份 · ${esc(kindLabel[item.kind] || '')}` : '不在根层'}${stream ? ` · ${esc(STREAMS[stream]?.label || stream)}` : ''}</small>${ask ? `<small>● 此刻开着：${esc(ask.prompt)}</small>` : ''}<small>两周累计 ${factOf(id)?.cum ?? 0} 份 · 点击看详情</small>`;
  }
  function pin(id, index = model.snapshot().index) {
    pinned = id;
    if (!id) { drawer.close(); setFocus(null); return; }
    drawer.open(dossierHTML(id, index), id);
    setFocus(focus);
    const q = new URLSearchParams(location.search);
    q.set('item', id);
    window.history.replaceState(null, '', `?${q}`);
  }

  stage.addEventListener('pointermove', event => {
    const el = event.target.closest('[data-root],[data-legend],[data-stream]');
    if (!el) { tip.hide(); if (focus || focusStream) setFocus(null, event); return; }
    if (el.dataset.stream) { if (focusStream !== el.dataset.stream) setFocus(null, event, el.dataset.stream); tip.hide(); return; }
    const id = el.dataset.root || el.dataset.legend;
    if (id !== focus) setFocus(id, event);
    const frameEl = el.closest('[data-frame]');
    const index = frameEl ? Number(frameEl.dataset.frame) : model.snapshot().index;
    tip.show(cellTip(id, index), event.clientX, event.clientY, `${id}|${index}`);
  });
  stage.addEventListener('pointerleave', () => { tip.hide(); setFocus(null); });
  stage.addEventListener('click', event => {
    const modeBtn = event.target.closest('[data-mode]');
    if (modeBtn) { setMode(modeBtn.dataset.mode); return; }
    const cell = event.target.closest('.mx-cell,.mx-dot');
    if (cell) { const index = Number(cell.closest('[data-frame]').dataset.frame); model.goFrame(index); pin(cell.dataset.root, index); return; }
    const leg = event.target.closest('[data-legend],.mx-bigcell');
    if (leg) { const id = leg.dataset.legend || leg.dataset.root; pin(pinned === id ? null : id); return; }
    const go = event.target.closest('[data-go]');
    if (go) model.goFrame(Number(go.dataset.go));
  });
  function setMode(next) {
    if (next === mode || (next === 'stream' && !hasStreams)) return;
    mode = next;
    const q = new URLSearchParams(location.search);
    if (mode === 'stream') q.set('color', 'stream'); else q.delete('color');
    window.history.replaceState(null, '', `?${q}`);
    buildGrid(); buildLegend();
    render(model.snapshot(), true);
  }
  // Keyboard: space plays, C switches colouring, ↑/↓ walks the legend, Enter pins, Esc unpins.
  function stop() { if (timer) { clearInterval(timer); timer = null; } stage.classList.remove('is-playing'); }
  document.addEventListener('keydown', event => {
    if (event.target.matches?.('input,textarea,select') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === ' ') {
      event.preventDefault();
      if (timer) { stop(); return; }
      if (model.snapshot().index >= frames.length - 1) model.goFrame(0);
      stage.classList.add('is-playing');
      timer = setInterval(() => { const i = model.snapshot().index; if (i >= frames.length - 1) stop(); else model.goFrame(i + 1); }, 900 * SLOW);
    } else if (event.key === 'c' || event.key === 'C') setMode(mode === 'top' ? 'stream' : 'top');
    else if (event.key === 'Escape') { if (drawer.isOpen || pinned) pin(null); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const list = topRoots, k = list.indexOf(pinned || focus);
      const next = list[(k < 0 ? 0 : k + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
      if (drawer.isOpen) pin(next); else setFocus(next);
    } else if (event.key === 'Enter' && focus && !event.target.closest?.('button,a,summary')) pin(focus);
    else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) stop();
  });
  document.addEventListener('keyup', event => { if (event.key === ' ') event.preventDefault(); });

  // ---------- per frame ----------
  let shown = null;
  function render(s, rebuilt = false) {
    timed('frames', () => {
      const d = data[s.index];
      if (shown === null || rebuilt) renderHead(s);
      // Cursor slides to the current waffle.
      const target = weeksEl.querySelector(`.mx-frame[data-go="${s.index}"]`);
      if (target) {
        const box = target.getBoundingClientRect(), host = weeksEl.parentElement.getBoundingClientRect();
        cursor.style.transitionDuration = shown === null || reducedMotion() ? '0ms' : `${260 * SLOW}ms`;
        cursor.style.transform = `translate(${box.left - host.left - 3}px, ${box.top - host.top - 3}px)`;
        cursor.style.width = `${box.width + 6}px`; cursor.style.height = `${box.height + 6}px`;
      }
      weeksEl.querySelectorAll('.mx-frame.is-on, .mx-notes .is-on').forEach(el => el.classList.remove('is-on'));
      target?.classList.add('is-on');
      weeksEl.querySelector(`[data-note="${s.index}"]`)?.classList.add('is-on');
      renderBig(d, shown !== null && !rebuilt);
      const openAsks = [...d.asks.entries()];
      $('.mx-now-text').innerHTML = `<div class="mx-now-when">${esc(dayTime(d.frame.at))} · ${esc(d.frame.id)}</div><div class="mx-now-title">${esc(d.frame.title)}</div>
        <div class="mx-now-n"><b>${d.items.length}</b> 件 · 用 <b>${d.used}</b> / 64 份 · <b>${openAsks.length}</b> 个问题开着</div>`;
      $('.mx-asks').innerHTML = openAsks.length ? `<h3>● 此刻开着的问题</h3>${openAsks.slice(0, 6).map(([id, ask]) => `<button class="mx-ask" data-legend="${esc(id)}"><i style="background:${cellColor(id)}"></i><span><b>${esc(EXPECT_WORDS[ask.expects] || '')}</b> ${esc(ask.prompt)}</span></button>`).join('')}${openAsks.length > 6 ? `<p class="mx-small">另 ${openAsks.length - 6} 个</p>` : ''}` : '<h3>此刻没有开着的问题</h3>';
      const x = sx(s.index);
      stage.querySelectorAll('.mx-spark-now').forEach(line => { line.style.transform = `translateX(${x}px)`; });
      if (mode === 'top') {
        stage.querySelectorAll('[data-legend]').forEach(btn => {
          if (!btn.classList.contains('mx-item')) return;
          const id = btn.dataset.legend, item = d.items.find(i => i.id === id);
          btn.querySelector('.mx-item-name').textContent = item?.title || itemAt(id, s.index)?.title || id;
          btn.querySelector('b').textContent = item ? item.share : '—';
          btn.classList.toggle('is-absent', !item);
        });
        const other = stage.querySelector('.mx-item.is-other b');
        if (other) other.textContent = others[s.index];
      } else if (area) {
        stage.querySelector('.mx-areas .mx-spark-now').style.transform = `translateX(${(s.index / (frames.length - 1) * area.W).toFixed(1)}px)`;
        stage.querySelectorAll('.mx-item.is-stream').forEach(btn => { btn.querySelector('b').textContent = area.sums[s.index][btn.dataset.stream]; });
      }
      if (pinned && drawer.isOpen) drawer.open(dossierHTML(pinned, s.index), pinned);
      setFocus(focus);
    });
    shown = s.index;
  }

  buildGrid();
  buildLegend();
  model.subscribe(s => render(s));
  if (params.get('item') && factOf(params.get('item'))) pin(params.get('item'));
  globalThis.foldMultiples = { setMode, pin, focus: id => setFocus(id), perf, get mode() { return mode; } };
}
