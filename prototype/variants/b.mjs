import {
  escapeHTML as esc, formatDate, formatTime, kindLabel,
  getItem, getLayer, colorFor, currentAsk, notice, scenario,
} from './shared.mjs?v=feedback-loop-1';
import { SMALL, GROUP, stableOrder, layoutSection, bandPath, centerPath, labelPositions, futureFraction, FUTURE_GRID, placeCaptions } from './b-layout.mjs?v=b-temporal-2';
import { createTimeMotion } from './b-motion.mjs?v=b-temporal-1';
import {
  stamp, relative, actionHTML, frameActions, itemActions, versionsHTML, sourcesHTML, originHTML,
  deadlinesOf, latestRecord, recordWords, createResponder,
} from './temporal.mjs?v=temporal-1';
import { createResponseStore, normalizeAsk } from '../respond.mjs?v=respond-1';

// B · 时间展开。左边是最近几次整理里每件事的份额带，中间一根是此刻的 64 份，右边是此刻之后：
// 期限画成刻度，一眼看出谁先到。份额不足 3 的事项合成一条“小事”带，点开在阅读区逐件列出。
const CHANGE_NAMES = { added: '新增', updated: '内容更新', withdrawn: '撤下', restored: '恢复', merged: '合并', annotations_changed: '批注变化' };
const EXPECT = { decide: '需要你决定', input: '需要你提供', act: '需要你去做', snooze: '可以推后' };
const SVG = 'http://www.w3.org/2000/svg';
const AXIS_HEIGHT = 40;
const FRAME_MS = 340, EXPAND_MS = 280, LAYER_MS = 420;
const frameShort = (frame, index, total) => `${String(index + 1).padStart(2, '0')} / ${total} · ${stamp(frame.at)}`;
const frameName = (frame, index) => `${String(index + 1).padStart(2, '0')} · ${stamp(frame.at)} · ${frame.title}`;
const isReview = frame => frame?.signal?.type === 'review';
const shortTitle = title => { const head = String(title || '').split(/[：:]/)[0]; return [...head].length > 11 ? `${[...head].slice(0, 10).join('')}…` : head; };
const expectOf = ask => ask ? EXPECT[normalizeAsk(ask).meanings[0]] || '登记了问题' : '';
let mountNumber = 0;

function explicitMerges(records, layerId) {
  const links = [];
  for (let index = 1; index < records.length; index += 1) {
    const before = getLayer(records[index - 1].state, layerId), after = getLayer(records[index].state, layerId);
    for (const source of before.items) {
      const historical = getItem(records[index].state, source.id);
      const target = after.items.find(item => item.id === historical?.merged_into);
      if (historical?.status === 'merged' && target) links.push({ index, from: source.id, to: target.id, source, target });
    }
  }
  return links;
}
// History marks: a dot where the person acted on a visible item; a ring and a line back to the
// registration only when the feedback names that question (link.ask).
function loopMarks(records, frames, layerId) {
  const marks = [], seen = new Set();
  frames.forEach((frame, index) => {
    const visible = new Set(getLayer(records[index].state, layerId).items.map(item => item.id));
    for (const event of frame.events) {
      for (const link of event.feedback || []) {
        if (!visible.has(link.target)) continue;
        const key = `${index}:${link.target}:${link.ask || ''}`;
        if (seen.has(key)) continue; seen.add(key);
        let askIndex = null;
        if (link.ask) for (let at = index; at >= 0; at -= 1) if (Object.values(frames[at].asks || {}).some(ask => ask.id === link.ask)) { askIndex = at; break; }
        marks.push({ key, index, anchor: link.target, ask: link.ask || null, askIndex, kind: link.meaning === 'snooze' ? 'snooze' : 'answer' });
      }
      if (event.reminder && visible.has(event.reminder.target)) marks.push({ key: `${index}:${event.reminder.target}:reminder`, index, anchor: event.reminder.target, kind: 'reminder', askIndex: null });
    }
  });
  return marks;
}

// Custom listbox (no native <select>): a button plus a fixed-position popup.
const selectHTML = (kind, label, options, value) => `<div class="b-select" data-b-select="${kind}"><button type="button" class="b-select-button" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(label)}"><span class="b-select-value">${esc(options[value]?.text ?? '')}</span><span class="b-select-caret" aria-hidden="true"></span></button><ul class="b-select-list" role="listbox" tabindex="-1" aria-label="${esc(label)}" hidden>${options.map((option, index) => `<li role="option" data-value="${option.value}" aria-selected="${index === value}" class="${option.className || ''}"><span>${esc(option.text)}</span>${option.note ? `<small>${esc(option.note)}</small>` : ''}</li>`).join('')}</ul></div>`;

export function mount(host, model) {
  host.classList.add('variant-b');
  const uid = `b${++mountNumber}`;
  const $ = selector => host.querySelector(selector);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 760px)');
  let current = model.snapshot(), range = 'recent', readerMode = 'overview', expanded = false, fromSmall = false;
  let hoveredId = null, focusedId = null, disposed = false, resizeFrame = null;
  let chartStamp = '', readerStamp = '', openSelect = null, dragging = false, geometry = null, drawnExpanded = false;
  const store = createResponseStore();
  const responder = createResponder({ store, snapshot: () => current, cls: 'b', onChange: () => render(current, { type: 'record' }) });
  const layerCache = new Map();
  const elements = { bands: new Map(), grads: new Map(), nodes: new Map(), marks: new Map(), merges: new Map(), bars: new Map(), lanes: new Map(), ticks: new Map(), labels: new Map(), leaders: new Map(), numbers: new Map(), notches: new Map() };
  const cache = layerId => {
    const key = layerId ?? '__root__';
    if (!layerCache.has(key)) {
      const layers = current.records.map(record => getLayer(record.state, layerId));
      layerCache.set(key, { layers, order: stableOrder(layers), merges: explicitMerges(current.records, layerId), marks: loopMarks(current.records, current.frames, layerId) });
    }
    return layerCache.get(key);
  };
  const frameOptions = current.frames.map((frame, index) => ({ value: index, text: frameName(frame, index), note: isReview(frame) ? frame.signal.reason : '', className: isReview(frame) ? 'is-review' : '' }));
  const ticksHTML = current.frames.map((frame, index) => `<span class="b-tick${isReview(frame) ? ' is-review' : ''}${frame.events.some(event => event.feedback || event.reminder) ? ' has-loop' : ''}" style="--at:${index / Math.max(1, current.frames.length - 1)}"></span>`).join('');
  const hatch = id => `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="b-blank-ground"/><line x1="0" y1="0" x2="0" y2="6" class="b-blank-line"/></pattern>`;

  host.innerHTML = `<main class="b-shell">
    <header class="b-header">
      <a class="b-brand" href="./index.html" aria-label="返回 Fold 原版">fold</a>
      <div class="b-title"><h1 id="b-page-title"></h1><p><span class="b-date"></span><span class="b-revision"></span></p></div>
      <div class="b-header-actions"><button class="b-feedback-button" data-b-action="feedback" hidden>批注 <span class="b-feedback-count"></span></button><button data-lab-inspect="inputs">输入 <span class="b-input-count"></span></button><button data-lab-inspect="state"><span class="b-wide-word">完整</span>状态 ↗</button><button class="b-about" data-b-action="story" aria-label="演示说明">?</button></div>
    </header>
    <div class="b-time-tools">
      <div class="b-play-controls"><button data-b-action="previous" aria-label="上一次整理" title="上一次整理（←）">←</button><button class="b-play" data-b-action="play" aria-label="播放回放" title="播放 / 暂停（空格）"><span class="b-play-icon" aria-hidden="true">▷</span><span class="b-play-word">播放</span></button><button data-b-action="next" aria-label="下一次整理" title="下一次整理（→）">→</button></div>
      <div class="b-jump">${selectHTML('frame', '跳到一次整理', frameOptions, current.index)}</div>
      <button class="b-replay" data-b-action="replay" disabled title="慢放上次过渡">↻ <span>重播过渡</span></button>
      <button class="b-mobile-read" data-b-action="read">摘要 ↗</button>
    </div>
    <div class="b-main">
      <section class="b-workspace" aria-label="事项份额随时间的变化与此刻之后的期限">
        <div class="b-workspace-head"><nav class="b-breadcrumbs" aria-label="当前查看层级"></nav><div class="b-view-options"><div class="b-range" role="group" aria-label="显示的整理范围"><button data-b-range="recent" aria-pressed="true">近 5 次</button><button data-b-range="all" aria-pressed="false">全部</button></div><button class="b-compare" data-b-action="compare" aria-pressed="false">比较前后</button></div></div>
        <div class="b-chart-layout">
          <div class="b-history"><div class="b-plot-caption"><strong>此前</strong><span class="b-history-range"></span></div><div class="b-chart-scroll" tabindex="0" aria-label="历史份额变化，可横向滚动"><div class="b-plot"><svg class="b-flow-svg" role="group" aria-label="同一事项的份额随整理变化"><defs>${hatch(`${uid}-blank`)}<clipPath id="${uid}-clip"><rect class="b-clip-rect"/></clipPath></defs><rect class="b-history-ground" fill="url(#${uid}-blank)"/><g class="b-guides"></g><g clip-path="url(#${uid}-clip)"><g class="b-bands"></g><g class="b-merge-paths"></g><g class="b-node-lines"></g><g class="b-loop-marks"></g></g></svg><div class="b-node-buttons"></div><div class="b-plot-empty" hidden><p>暂无事项记录。</p><button data-b-action="next">查看下一次整理 →</button></div></div></div></div>
          <div class="b-present">
            <div class="b-present-heading"><span class="b-now-head"><strong>此刻</strong><span class="b-budget"></span></span><span class="b-future-head" aria-hidden="true">此刻之后 →</span></div>
            <div class="b-present-body">
              <svg class="b-now-svg" role="group" aria-label="此刻的 64 份与之后的期限"><defs>${hatch(`${uid}-blank-now`)}<linearGradient id="${uid}-fade" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".7" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="${uid}-lane-mask" maskContentUnits="userSpaceOnUse"><rect class="b-lane-mask-rect" fill="url(#${uid}-fade)"/></mask></defs><rect class="b-section-blank" fill="url(#${uid}-blank-now)"/><g class="b-future-grid"></g><g class="b-lanes" mask="url(#${uid}-lane-mask)"></g><g class="b-bars"></g><g class="b-numbers" aria-hidden="true"></g><g class="b-notches" aria-hidden="true"></g><line class="b-now-line"/><line class="b-next-line"/><g class="b-leaders"></g><g class="b-ticks"></g></svg>
              <div class="b-labels" role="list" aria-label="此刻的事项，按此前的顺序"></div>
              <div class="b-future-axis" aria-hidden="true"></div>
              <p class="b-current-empty" hidden>当前层暂无事项。</p>
            </div>
          </div>
        </div>
        <div class="b-chart-foot"><p class="b-legend"><span>带宽 = 份额</span><span><i class="b-key-group" aria-hidden="true"></i>不足 ${SMALL} 份合成小事</span><span><i class="b-key-blank" aria-hidden="true"></i>未分配</span><span><i class="b-key-due" aria-hidden="true"></i>问题的期限</span><span><i class="b-key-ask" aria-hidden="true"></i>问你 <i class="b-key-answer" aria-hidden="true"></i>你的回应</span><span><i class="b-key-merge" aria-hidden="true"></i>明确合并</span></p><span class="b-check-note" aria-live="polite"></span></div>
        <div class="b-scrubber"><span class="b-first-date"></span><div class="b-slider" role="slider" tabindex="0" aria-label="沿整理次数回看时间" aria-valuemin="0" aria-valuemax="${current.frames.length - 1}"><div class="b-slider-track"><div class="b-slider-fill"></div>${ticksHTML}</div><div class="b-slider-thumb" aria-hidden="true"></div></div><span class="b-last-date"></span></div>
      </section>
      <aside class="b-reader" aria-labelledby="b-reader-title"><div class="b-reader-head"><div><span class="b-reader-kicker">摘要与依据</span><h2 id="b-reader-title" tabindex="-1">本轮判断</h2></div><div class="b-reader-actions"><button class="b-reader-back" data-b-action="back-chart">← 图</button><button data-b-action="overview" hidden aria-label="回到本轮判断">↶ 本轮</button><button data-lab-inspect="batch" title="查看本轮声明与回执">声明 ↗</button></div></div><div class="b-reader-scroll"><div class="b-reader-body" aria-live="polite"></div></div><div class="b-reader-foot"><span>${scenario.id === 'shanghai-two-weeks' ? '人物与私人消息均为演示创作' : esc(notice)}</span><button data-b-action="story">演示说明 ↗</button></div></aside>
    </div>
  </main>`;

  const svgEl = (tag, className, parent) => { const element = document.createElementNS(SVG, tag); if (className) element.setAttribute('class', className); parent.append(element); return element; };
  const set = (element, values) => { for (const [name, value] of Object.entries(values)) element.setAttribute(name, String(value)); };
  const removeMissing = (map, wanted, remove = element => element.remove()) => { for (const [key, element] of map) if (!wanted.has(key)) { remove(element); map.delete(key); } };

  // ---------- labels ----------
  function labelHTML(entry) {
    if (entry.group) {
      return `<button type="button" class="b-label-main b-label-group" data-b-group aria-expanded="${expanded}" aria-controls="b-reader-title"><span class="b-label-title">另 ${entry.count} 件小事</span><small><b>${entry.share}</b> 份${entry.asks ? ` · <em>${entry.asks} 件登记了问题</em>` : ''} · ${expanded ? '收起 ▴' : '逐件看 ▾'}</small></button>`;
    }
    const { item, ask, due, record } = entry;
    const dueText = due ? `<i class="b-due${due.at < current.cursor ? ' is-over' : ''}">${due.at < current.cursor ? '已过期' : relative(due.at - current.cursor)}</i>` : '';
    const recordText = record ? `<i class="b-rec">✓ ${entry.recordStatus === 'acknowledged' ? '已收到' : '已保存'}</i>` : '';
    return `<button type="button" class="b-label-main" data-b-item="${esc(item.id)}" aria-controls="b-reader-title"><span class="b-label-title">${esc(item.title)}</span><small><b>${item.share}</b> 份 · ${ask ? `<em>${expectOf(ask)}</em>` : esc(kindLabel[item.kind] || item.kind)}${dueText ? ` · ${dueText}` : ''}${recordText ? ` · ${recordText}` : ''}</small></button>${item.children?.items.length ? `<button type="button" class="b-dive" data-b-dive="${esc(item.id)}" aria-label="进入${esc(item.title)}的子层，${item.children.items.length} 项" title="进入子层（独立 64 份）">${item.children.items.length}<span aria-hidden="true">›</span></button>` : ''}`;
  }
  function measureLabels(entries, width, dense) {
    const probe = document.createElement('div');
    probe.className = `b-label${dense ? ' is-dense' : ''}`; probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;transform:none;top:0;left:0;width:${width}px`;
    $('.b-labels').append(probe);
    const heights = new Map();
    for (const entry of entries) { probe.innerHTML = labelHTML(entry); heights.set(entry.id, probe.getBoundingClientRect().height); }
    probe.remove(); return heights;
  }

  // ---------- scene ----------
  function dims() {
    const layout = $('.b-chart-layout'), total = layout.clientWidth;
    const narrow = mobile.matches;
    const presentW = narrow ? Math.round(total * .72) : Math.round(Math.max(470, Math.min(660, total * .64)));
    const barW = narrow ? 30 : 46, leaderW = narrow ? 12 : 22;
    const futureW = narrow ? Math.round(presentW * .3) : Math.round(Math.max(150, Math.min(240, presentW * .36)));
    const labelW = presentW - barW - futureW - leaderW;
    return { presentW, barW, futureW, leaderW, labelW, svgW: barW + futureW + leaderW };
  }
  function makeScene(s) {
    const { layers, order, merges, marks } = cache(s.layerId);
    const d = geometry = dims();
    $('.b-present').style.width = `${d.presentW}px`;
    const height = Math.max(150, Math.floor($('.b-present-body').clientHeight - AXIS_HEIGHT));
    const holderWidth = Math.max(120, $('.b-chart-scroll').clientWidth);
    const first = range === 'all' ? 0 : Math.max(0, s.index - 4), last = s.index;
    const indexes = Array.from({ length: last - first + 1 }, (_, index) => first + index);
    const width = range === 'all' ? Math.max(holderWidth, indexes.length * (mobile.matches ? 34 : 64)) : holderWidth;
    const step = (width - 28) / Math.max(1, indexes.length - 1);
    const xFor = index => indexes.length === 1 ? width - 14 : 14 + (index - first) * step;
    const sections = new Map(indexes.map(index => [index, layoutSection(layers[index], order, height)]));
    const section = layoutSection(s.layer, order, height);
    sections.set(last, section);
    const meta = { bands: new Map(), bars: new Map(), ticks: new Map(), labels: new Map(), marks: new Map(), merges: new Map() };
    const scene = { index: s.index, layerId: s.layerId, first, last, width, height, section, meta, ...d,
      nodes: new Map(indexes.map(index => [index, { x: xFor(index), o: 1 }])),
      bands: new Map(), bars: new Map(), lanes: new Map(), ticks: new Map(), labels: new Map(), marks: new Map(), merges: new Map(),
      blankY: section.blank.y, blankH: section.blank.h, scrollLeft: Math.max(0, width - holderWidth),
      members: new Set(section.group?.members || []) };
    const itemFor = id => getItem(s.state, id) || [...indexes].reverse().map(index => getItem(s.records[index].state, id)).find(Boolean);
    // History ribbons. A band inside 小事 keeps its exact position but is transparent while 小事 is closed.
    for (const id of order) {
      if (!indexes.some(index => sections.get(index).placed.has(id))) continue;
      const present = indexes.filter(index => sections.get(index).placed.has(id));
      const pts = new Map(indexes.map(index => {
        const point = sections.get(index).placed.get(id);
        if (point) return [index, { x: xFor(index), y: point.y, h: point.h, o: point.grouped && !expanded ? 0 : 1 }];
        const near = present.reduce((best, at) => Math.abs(at - index) < Math.abs(best - index) || (Math.abs(at - index) === Math.abs(best - index) && at < index) ? at : best, present[0]);
        const zone = sections.get(near).placed.get(id).grouped ? 'group' : 'sep';
        return [index, { x: xFor(index), y: sections.get(index).anchor(id, zone), h: 0, o: zone === 'group' && !expanded ? 0 : 1 }];
      }));
      scene.bands.set(id, { pts, o: 1 });
      const item = itemFor(id);
      meta.bands.set(id, { color: colorFor(item, s.state), title: item?.title || id });
    }
    if (indexes.some(index => sections.get(index).group)) {
      scene.bands.set(GROUP, { pts: new Map(indexes.map(index => { const g = sections.get(index).group; return [index, { x: xFor(index), y: g ? g.y : sections.get(index).blank.y, h: g ? g.h : 0, o: 1 }]; })), o: 1 });
      meta.bands.set(GROUP, { group: true, title: '小事' });
    }
    // Present cross-section, lanes and labels.
    const cursor = s.cursor;
    const deadlines = new Map(deadlinesOf(s, [...section.placed.values()].map(point => point.item)).map(entry => [entry.id, entry]));
    const entries = [];
    for (const point of section.placed.values()) {
      const ask = currentAsk(s, point.id), record = latestRecord(store, point.id, cursor);
      const recordStatus = record ? (s.frames.some(frame => Date.parse(frame.at) > record.at && Date.parse(frame.at) <= cursor) ? 'acknowledged' : 'saved') : null;
      scene.bars.set(point.id, { y: point.y, h: point.h, o: point.grouped && !expanded ? 0 : 1 });
      scene.lanes.set(point.id, { y: point.y, h: point.h, o: point.grouped && !expanded ? 0 : 1 });
      meta.bars.set(point.id, { color: colorFor(point.item, s.state), share: point.item.share, grouped: point.grouped, ask: Boolean(ask), title: point.item.title, record: recordStatus });
      if (!point.grouped) entries.push({ id: point.id, item: point.item, y: point.y, h: point.h, ask, due: deadlines.get(point.id), record, recordStatus });
    }
    if (section.group) {
      const g = section.group;
      scene.bars.set(GROUP, { y: g.y, h: g.h, o: 1 });
      scene.lanes.set(GROUP, { y: g.y, h: g.h, o: 1 });
      meta.bars.set(GROUP, { group: true, share: g.share, title: '小事' });
      entries.push({ id: GROUP, group: true, y: g.y, h: g.h, count: g.members.length, share: g.share, asks: g.members.filter(id => currentAsk(s, id)).length });
    }
    let heights = measureLabels(entries, d.labelW, false), dense = false;
    if ([...heights.values()].reduce((sum, value) => sum + value + 3, 0) > height) { heights = measureLabels(entries, d.labelW, true); dense = true; }
    scene.dense = dense;
    const labelYs = labelPositions(entries, height, { heights, gap: dense ? 1 : 5 });
    for (const entry of entries) { scene.labels.set(entry.id, { y: labelYs.get(entry.id), o: 1 }); meta.labels.set(entry.id, entry); }
    // Ticks after now: deadlines (rust when a registered question owns them), local answers, overdue at the edge.
    const center = point => point.y + point.h / 2;
    const ticks = [];
    for (const due of deadlines.values()) {
      const point = section.placed.get(due.id), over = due.at < cursor;
      ticks.push({ key: `due:${due.id}`, x: futureFraction(due.at - cursor) * d.futureW, y: center(point), h: Math.max(14, point.h), o: 1,
        meta: { kind: due.kind === 'ask' ? 'due' : 'item-due', over, id: due.id, grouped: point.grouped, line1: point.grouped ? shortTitle(point.item.title) : stamp(due.at), line2: point.grouped ? `${stamp(due.at)} · ${relative(due.at - cursor)}` : relative(due.at - cursor) } });
    }
    for (const point of section.placed.values()) {
      const record = latestRecord(store, point.id, cursor);
      if (!record) continue;
      const status = meta.bars.get(point.id).record;
      ticks.push({ key: `chk:${point.id}`, x: -9, y: center(point), h: 0, o: point.grouped && !expanded ? .9 : 1, meta: { kind: 'check', id: point.id, status } });
      if (record.until && record.until > cursor) ticks.push({ key: `rec:${point.id}`, x: futureFraction(record.until - cursor) * d.futureW, y: center(point), h: Math.max(14, point.h), o: 1,
        meta: { kind: record.meaning === 'snooze' ? 'snooze' : 'scheduled', id: point.id, grouped: point.grouped, line1: `${record.meaning === 'snooze' ? '◷ 再提醒' : '你定的'} ${stamp(record.until)}`, line2: point.grouped ? shortTitle(point.item.title) : relative(record.until - cursor) } });
    }
    const textWidth = text => [...String(text)].reduce((sum, char) => sum + (/[\u2E80-\uFFFF]/.test(char) ? 11 : 6.3), 0);
    // Captions never leave the strip after now: on a narrow strip each line is cut to fit, with an ellipsis.
    const room = d.futureW + d.leaderW - 6;
    const fit = text => { if (textWidth(text) <= room) return text; let out = ''; for (const char of String(text)) { if (textWidth(`${out}${char}…`) > room) break; out += char; } return `${out}…`; };
    for (const tick of ticks) if (tick.meta.line1) {
      tick.meta.line1 = fit(tick.meta.line1); tick.meta.line2 = fit(tick.meta.line2);
      tick.meta.width = Math.max(textWidth(tick.meta.line1), textWidth(tick.meta.line2) * .95);
    }
    placeCaptions(ticks.filter(tick => tick.meta.kind !== 'check'), { lineHeight: 27, width: 110, height });
    for (const tick of ticks) { scene.ticks.set(tick.key, { x: tick.x, y: tick.y, h: tick.h, ty: tick.ty ?? tick.y, o: tick.o }); meta.ticks.set(tick.key, tick.meta); }
    const next = s.frames[s.index + 1];
    scene.nextX = next ? futureFraction(Date.parse(next.at) - cursor) * d.futureW : -1;
    meta.next = next ? Date.parse(next.at) : null;
    // History marks and explicit merges, positioned on the drawn ribbons at draw time.
    for (const mark of marks) {
      if (mark.index < first || mark.index > last || !scene.bands.has(mark.anchor)) continue;
      const point = sections.get(mark.index).placed.get(mark.anchor);
      if (point?.grouped && !expanded) continue;
      scene.marks.set(mark.key, { o: 1 }); meta.marks.set(mark.key, { ...mark, askIndex: mark.askIndex != null && mark.askIndex >= first ? mark.askIndex : null });
    }
    for (const link of merges) {
      if (link.index <= first || link.index > last) continue;
      const key = `${link.index}:${link.from}:${link.to}`;
      scene.merges.set(key, { o: 1 }); meta.merges.set(key, link);
    }
    return scene;
  }

  // ---------- prepare: create and remove elements for every key of the (template) scene ----------
  function prepare(scene) {
    const { width, height, barW, futureW, svgW } = scene;
    $('.b-plot').style.width = `${width}px`; $('.b-plot').style.height = `${height + AXIS_HEIGHT}px`;
    set($('.b-flow-svg'), { width, height, viewBox: `0 0 ${width} ${height}` });
    set($('.b-history-ground'), { x: 0, y: 0, width, height });
    set($('.b-clip-rect'), { x: 2, y: -8, width: Math.max(1, width - 4), height: height + 16 });
    $('.b-node-buttons').style.height = `${AXIS_HEIGHT}px`;
    $('.b-guides').innerHTML = [16, 32, 48].map(value => `<line x1="0" x2="${width}" y1="${value / 64 * height}" y2="${value / 64 * height}" class="b-guide"/>`).join('');
    set($('.b-now-svg'), { width: svgW, height, viewBox: `0 0 ${svgW} ${height}` });
    set($('.b-lane-mask-rect'), { x: barW, y: 0, width: futureW, height });
    set($('.b-now-line'), { x1: barW + .5, x2: barW + .5, y1: -6, y2: height + 6 });
    $('.b-labels').style.left = `${svgW}px`;
    $('.b-labels').classList.toggle('is-dense', Boolean(scene.dense));
    $('.b-future-grid').innerHTML = FUTURE_GRID.map(([span]) => `<line class="b-future-guide" x1="${barW + futureFraction(span) * futureW}" x2="${barW + futureFraction(span) * futureW}" y1="0" y2="${height}"/>`).join('');
    const nextText = scene.meta.next ? `下次整理 ${formatTime(scene.meta.next)}` : '';
    const nextX = scene.meta.next ? barW + futureFraction(scene.meta.next - current.cursor) * futureW : -1;
    $('.b-future-axis').innerHTML = `<span class="is-now" style="left:${barW}px">此刻 ${formatTime(current.cursor)}</span>${FUTURE_GRID.filter(([span]) => Math.abs(barW + futureFraction(span) * futureW - nextX) > 34).map(([span, text]) => `<span style="left:${barW + futureFraction(span) * futureW}px">${text}</span>`).join('')}${nextText ? `<span class="is-next" style="left:${nextX}px">${nextText}</span>` : ''}`;
    // Ribbons: 小事 first so items paint over it.
    removeMissing(elements.bands, scene.bands);
    removeMissing(elements.grads, scene.bands);
    for (const key of [GROUP, ...[...scene.bands.keys()].filter(key => key !== GROUP)]) {
      if (!scene.bands.has(key)) continue;
      const info = scene.meta.bands.get(key);
      let path = elements.bands.get(key);
      if (!path) {
        path = svgEl('path', `b-flow${key === GROUP ? ' is-group' : ''}`, $('.b-bands'));
        set(path, { tabindex: -1 }); path.dataset.bBand = key; path.append(document.createElementNS(SVG, 'title'));
        if (key !== GROUP) {
          const grad = svgEl('linearGradient', '', $('.b-flow-svg defs')); grad.id = `${uid}-g-${elements.grads.size}-${Math.random().toString(36).slice(2, 7)}`; set(grad, { gradientUnits: 'userSpaceOnUse' });
          elements.grads.set(key, grad);
        }
        elements.bands.set(key, path);
      }
      if (key === GROUP) { path.dataset.bGroup = ''; delete path.dataset.bItem; } else path.dataset.bItem = key;
      path.firstElementChild.textContent = key === GROUP ? '小事：份额不足 3 的事项合在一起' : `${info?.title}；点击查看摘要与依据`;
      if (key === GROUP) $('.b-bands').prepend(path);
    }
    removeMissing(elements.nodes, scene.nodes, pair => { pair.line.remove(); pair.button.remove(); });
    for (const index of scene.nodes.keys()) {
      let pair = elements.nodes.get(index);
      if (!pair) {
        const frame = current.frames[index];
        const line = svgEl('line', `b-node-line${isReview(frame) ? ' is-review' : ''}`, $('.b-node-lines'));
        const button = document.createElement('button'); button.type = 'button'; button.className = `b-node-button${isReview(frame) ? ' is-review' : ''}`;
        button.dataset.bFrame = String(index);
        button.setAttribute('aria-label', `${frameName(frame, index)}${isReview(frame) ? `；${frame.signal.reason}，窗口内 0 条事件` : ''}`);
        button.innerHTML = `<span class="b-node-dot"></span><span>${formatTime(frame.at)}</span><small>${isReview(frame) ? '每日整理' : formatDate(frame.at)}</small>`;
        $('.b-node-buttons').append(button); pair = { line, button }; elements.nodes.set(index, pair);
      }
      pair.line.classList.toggle('is-current', index === current.index);
      pair.line.classList.toggle('is-baseline', current.comparing && index === current.baseIndex);
      pair.button.classList.toggle('is-current', index === current.index);
      pair.button.tabIndex = scene.nodes.get(index).o < .5 ? -1 : 0;
      if (index === current.index) pair.button.setAttribute('aria-current', 'step'); else pair.button.removeAttribute('aria-current');
    }
    removeMissing(elements.merges, scene.merges);
    for (const key of scene.merges.keys()) {
      if (elements.merges.has(key)) continue;
      const link = scene.meta.merges.get(key);
      const path = svgEl('path', 'b-merge-link', $('.b-merge-paths')); path.dataset.bItem = link.to;
      path.append(document.createElementNS(SVG, 'title')); path.firstElementChild.textContent = `${link.source.title}，明确合并至${link.target.title}`;
      elements.merges.set(key, path);
    }
    removeMissing(elements.marks, scene.marks, group => group.root.remove());
    for (const key of scene.marks.keys()) {
      if (elements.marks.has(key)) continue;
      const mark = scene.meta.marks.get(key);
      const root = svgEl('g', `b-loop is-${mark.kind}`, $('.b-loop-marks')); root.dataset.bItem = mark.anchor;
      const title = svgEl('title', '', root);
      title.textContent = mark.kind === 'reminder' ? '到点提醒' : mark.ask ? `你回应了登记的问题（${stamp(current.frames[mark.index].at)}）` : `你在来源处处理了它（${stamp(current.frames[mark.index].at)}）`;
      const line = mark.askIndex != null ? svgEl('path', 'b-loop-line', root) : null;
      const ring = mark.askIndex != null ? svgEl('circle', 'b-loop-ask', root) : null;
      const dot = svgEl('circle', `b-loop-dot${mark.ask ? ' is-answer' : ''}`, root);
      elements.marks.set(key, { root, line, ring, dot });
    }
    // Present bars, numbers, notches and lanes.
    removeMissing(elements.bars, scene.bars);
    removeMissing(elements.numbers, scene.bars);
    removeMissing(elements.notches, scene.bars);
    removeMissing(elements.lanes, scene.lanes);
    for (const key of [GROUP, ...[...scene.bars.keys()].filter(key => key !== GROUP)]) {
      if (!scene.bars.has(key)) continue;
      const info = scene.meta.bars.get(key);
      let rect = elements.bars.get(key);
      if (!rect) {
        rect = svgEl('rect', `b-bar${key === GROUP ? ' is-group' : ''}`, $('.b-bars')); set(rect, { x: 0, role: 'button', tabindex: -1 });
        elements.bars.set(key, rect);
        const number = svgEl('text', 'b-bar-number', $('.b-numbers')); elements.numbers.set(key, number);
        const notch = svgEl('rect', 'b-ask-notch', $('.b-notches')); set(notch, { x: 0, width: 4 }); elements.notches.set(key, notch);
      }
      set(rect, { width: barW });
      if (key === GROUP) { rect.dataset.bGroup = ''; rect.setAttribute('aria-label', `小事 ${info.share} 份`); $('.b-bars').prepend(rect); }
      else { rect.dataset.bItem = key; rect.setAttribute('aria-label', `${info.title} ${info.share} 份`); rect.style.fill = info.color; rect.classList.toggle('is-member', Boolean(info.grouped)); }
      rect.dataset.share = String(info.share);
      const number = elements.numbers.get(key);
      number.textContent = String(info.share); set(number, { x: barW / 2 + 1 });
      number.classList.toggle('is-group', key === GROUP);
      elements.notches.get(key).classList.toggle('is-on', Boolean(info.ask));
      if (key !== GROUP) elements.notches.get(key).dataset.bItem = key;
    }
    for (const key of scene.lanes.keys()) {
      let rect = elements.lanes.get(key);
      if (!rect) { rect = svgEl('rect', `b-lane${key === GROUP ? ' is-group' : ''}`, $('.b-lanes')); set(rect, { x: barW }); elements.lanes.set(key, rect); }
      set(rect, { x: barW, width: futureW });
      const info = scene.meta.bars.get(key);
      if (key !== GROUP && info) { rect.style.fill = info.color; rect.dataset.bItem = key; }
    }
    // Leaders and labels (one per separate band and one for 小事).
    removeMissing(elements.leaders, scene.labels);
    removeMissing(elements.labels, scene.labels);
    for (const key of scene.labels.keys()) {
      const entry = scene.meta.labels.get(key);
      let leader = elements.leaders.get(key);
      if (!leader) { leader = svgEl('path', 'b-leader', $('.b-leaders')); elements.leaders.set(key, leader); }
      if (key === GROUP) leader.dataset.bGroup = ''; else leader.dataset.bItem = key;
      let label = elements.labels.get(key);
      if (!label) { label = document.createElement('div'); label.className = 'b-label'; label.setAttribute('role', 'listitem'); $('.b-labels').append(label); elements.labels.set(key, label); }
      if (key === GROUP) { label.dataset.bGroupLabel = ''; delete label.dataset.bFocusId; } else label.dataset.bFocusId = key;
      if (!entry) continue;
      label.classList.toggle('has-ask', Boolean(entry.ask) || Boolean(entry.asks));
      label.classList.toggle('is-group', Boolean(entry.group));
      const html = labelHTML(entry);
      if (label.dataset.content !== html) { label.dataset.content = html; label.innerHTML = html; }
    }
    // Keep DOM order = top-to-bottom order so Tab and ↑/↓ walk the labels in reading order.
    [...elements.labels.entries()].sort((a, b) => (scene.labels.get(a[0])?.y ?? 0) - (scene.labels.get(b[0])?.y ?? 0)).forEach(([, label]) => $('.b-labels').append(label));
    removeMissing(elements.ticks, scene.ticks, group => group.root.remove());
    for (const key of scene.ticks.keys()) {
      const info = scene.meta.ticks.get(key);
      let tick = elements.ticks.get(key);
      if (!tick) {
        const root = svgEl('g', `b-tick-mark is-${info.kind}`, $('.b-ticks'));
        const line = info.kind === 'check' ? null : svgEl('line', 'b-tick-line', root);
        const head = svgEl(info.kind === 'check' ? 'circle' : 'path', 'b-tick-head', root);
        const text = info.kind === 'check' ? null : svgEl('text', 'b-tick-text', root);
        const t1 = text ? svgEl('tspan', 'b-tick-t1', text) : null, t2 = text ? svgEl('tspan', 'b-tick-t2', text) : null;
        tick = { root, line, head, text, t1, t2 }; elements.ticks.set(key, tick);
        if (info.kind === 'check') set(head, { r: 4.2 });
      }
      tick.root.dataset.bItem = info.id;
      tick.root.classList.toggle('is-over', Boolean(info.over));
      tick.root.classList.toggle('is-ack', info.status === 'acknowledged');
      if (tick.t1) { tick.t1.textContent = info.line1; tick.t2.textContent = info.line2; }
    }
    $('.b-plot-empty').hidden = scene.bands.size > 0;
    $('.b-current-empty').hidden = scene.section.placed.size > 0;
    updateEmphasis();
  }

  // ---------- draw: write geometry for one sampled scene ----------
  function draw(scene) {
    const { barW, futureW, svgW } = geometry || scene;
    $('.b-plot').style.width = `${scene.width}px`;
    set($('.b-flow-svg'), { width: scene.width, height: scene.height, viewBox: `0 0 ${scene.width} ${scene.height}` });
    set($('.b-history-ground'), { width: scene.width, height: scene.height });
    for (const [key, band] of scene.bands) {
      const path = elements.bands.get(key); if (!path) continue;
      const pts = [...band.pts.entries()].sort((a, b) => a[0] - b[0]).map(([, point]) => point);
      // A hairline of paper between neighbouring ribbons instead of a stroke (a stroke would trace zero-height stretches).
      path.setAttribute('d', bandPath(key === GROUP ? pts : pts.map(point => point.h > 1.4 ? { ...point, y: point.y + .45, h: point.h - .9 } : point)));
      path.style.setProperty('--o', Math.min(1, band.o).toFixed(3));
      if (key === GROUP) continue;
      const color = scene.meta.bands.get(key)?.color || '#999';
      const visible = pts.map(point => point.o);
      if (visible.every(o => o > .995)) { path.setAttribute('fill', color); path.style.display = ''; path.classList.remove('is-fading'); continue; }
      if (visible.every(o => o < .005)) { path.style.display = 'none'; continue; }
      path.style.display = ''; path.classList.add('is-fading');
      const grad = elements.grads.get(key), x1 = pts[0].x, x2 = pts.at(-1).x;
      set(grad, { x1, x2: Math.max(x1 + 1, x2), y1: 0, y2: 0 });
      const stops = pts.map(point => `<stop offset="${((point.x - x1) / Math.max(1, x2 - x1)).toFixed(4)}" stop-color="${color}" stop-opacity="${point.o.toFixed(3)}"/>`).join('');
      if (grad.dataset.stops !== stops) { grad.innerHTML = stops; grad.dataset.stops = stops; }
      path.setAttribute('fill', `url(#${grad.id})`);
    }
    for (const [index, node] of scene.nodes) {
      const pair = elements.nodes.get(index); if (!pair) continue;
      set(pair.line, { x1: node.x, x2: node.x, y1: 0, y2: scene.height });
      const half = mobile.matches ? 15.5 : 29;
      pair.button.style.transform = `translateX(${Math.max(half, Math.min(scene.width - half, node.x))}px) translateX(-50%)`;
      pair.button.style.opacity = pair.line.style.opacity = String(node.o);
    }
    const bandCenter = (key, index) => { const point = scene.bands.get(key)?.pts.get(index); return point ? { x: point.x, y: point.y + point.h / 2, h: point.h } : null; };
    for (const [key, entry] of scene.merges) {
      const link = scene.meta.merges.get(key), path = elements.merges.get(key);
      const a = bandCenter(link.from, link.index - 1), b = bandCenter(link.to, link.index);
      if (!path || !a || !b) { if (path) path.style.display = 'none'; continue; }
      path.style.display = ''; const middle = (a.x + b.x) / 2;
      path.setAttribute('d', `M ${a.x} ${a.y} C ${middle} ${a.y} ${middle} ${b.y} ${b.x} ${b.y}`);
      path.style.setProperty('--o', entry.o.toFixed(3));
    }
    for (const [key, entry] of scene.marks) {
      const mark = scene.meta.marks.get(key), group = elements.marks.get(key); if (!group || !mark) continue;
      const at = bandCenter(mark.anchor, mark.index);
      if (!at || !(at.h > .5)) { group.root.style.display = 'none'; continue; }
      group.root.style.display = ''; group.root.style.setProperty('--o', entry.o.toFixed(3));
      set(group.dot, { cx: at.x, cy: at.y, r: mobile.matches ? 3.2 : 4 });
      if (group.line) {
        const pts = [...(scene.bands.get(mark.anchor)?.pts.entries() || [])].filter(([index]) => index >= mark.askIndex && index <= mark.index).sort((a, b) => a[0] - b[0]).map(([, point]) => point);
        group.line.setAttribute('d', pts.length > 1 ? centerPath(pts) : '');
        const start = bandCenter(mark.anchor, mark.askIndex);
        if (start) { set(group.ring, { cx: start.x, cy: start.y, r: mobile.matches ? 3 : 3.8 }); group.ring.style.display = ''; } else group.ring.style.display = 'none';
      }
    }
    // Present.
    set($('.b-section-blank'), { x: 0, y: scene.blankY, width: barW, height: Math.max(0, scene.blankH) });
    for (const [key, bar] of scene.bars) {
      const rect = elements.bars.get(key); if (!rect) continue;
      set(rect, { y: bar.y, height: Math.max(0, bar.h) });
      rect.style.setProperty('--o', bar.o.toFixed(3));
      rect.style.pointerEvents = bar.o < .3 ? 'none' : '';
      const number = elements.numbers.get(key), info = scene.meta.bars.get(key);
      const show = (key === GROUP || !info?.grouped) && bar.h >= 15 && bar.o > .5;
      set(number, { y: bar.y + bar.h / 2 + 4 }); number.style.setProperty('--o', show ? Math.min(1, (bar.h - 15) / 6 + .2).toFixed(3) : '0');
      const notch = elements.notches.get(key);
      set(notch, { y: bar.y + .5, height: Math.max(0, bar.h - 1) });
      notch.style.setProperty('--o', key === GROUP || !(bar.h > .5) ? '0' : '1');
    }
    for (const [key, lane] of scene.lanes) {
      const rect = elements.lanes.get(key); if (!rect) continue;
      set(rect, { y: lane.y + .5, height: Math.max(0, lane.h - 1) });
      rect.style.setProperty('--o', lane.o.toFixed(3));
    }
    if (scene.nextX >= 0) { set($('.b-next-line'), { x1: barW + scene.nextX, x2: barW + scene.nextX, y1: 0, y2: scene.height }); $('.b-next-line').style.opacity = '1'; }
    else $('.b-next-line').style.opacity = '0';
    for (const [key, tick] of scene.ticks) {
      const group = elements.ticks.get(key), info = scene.meta.ticks.get(key); if (!group || !info) continue;
      const x = barW + tick.x;
      group.root.style.setProperty('--o', tick.o.toFixed(3));
      if (info.kind === 'check') { set(group.head, { cx: x, cy: tick.y }); continue; }
      set(group.line, { x1: x, x2: x, y1: tick.y - tick.h / 2, y2: tick.y + tick.h / 2 });
      const s = 5;
      group.head.setAttribute('d', info.kind === 'snooze' ? `M ${x} ${tick.y} m -${s} 0 a ${s} ${s} 0 1 0 ${2 * s} 0 a ${s} ${s} 0 1 0 -${2 * s} 0` : info.kind === 'scheduled' ? `M ${x - s} ${tick.y} L ${x} ${tick.y - s} L ${x + s} ${tick.y} L ${x} ${tick.y + s} Z` : `M ${x - s} ${tick.y - s - 1} L ${x + s} ${tick.y - s - 1} L ${x} ${tick.y + 1} Z`);
      // Caption beside the tick: right if it fits before the labels, else left, else pinned inside the strip.
      const w = info.width || 0, room = futureW + scene.leaderW - 2;
      const right = tick.x + 8 + w <= room || tick.x < 8 + w;
      const tx = right ? Math.max(barW + 4, Math.min(x + 8, barW + room - w)) : Math.max(x - 8, barW + 4 + w);
      set(group.text, { x: tx, y: tick.ty - 2, 'text-anchor': right ? 'start' : 'end' });
      set(group.t1, { x: tx, dy: 0 }); set(group.t2, { x: tx, dy: 13 });
    }
    for (const [key, label] of scene.labels) {
      const element = elements.labels.get(key); if (!element) continue;
      element.style.transform = `translateY(${label.y.toFixed(1)}px) translateY(-50%)`;
      element.style.setProperty('--o', label.o.toFixed(3));
      element.style.pointerEvents = label.o < .1 ? 'none' : '';
      const bar = scene.bars.get(key), leader = elements.leaders.get(key);
      if (bar && leader) {
        const yA = bar.y + bar.h / 2, x0 = barW + futureW, x1 = svgW - 2, mid = x0 + (x1 - x0) * .5;
        leader.setAttribute('d', `M ${x0} ${yA.toFixed(1)} C ${mid} ${yA.toFixed(1)} ${mid} ${label.y.toFixed(1)} ${x1} ${label.y.toFixed(1)}`);
        leader.style.setProperty('--o', label.o.toFixed(3));
      }
    }
    $('.b-chart-scroll').scrollLeft = scene.scrollLeft ?? 0;
  }
  const motion = createTimeMotion({ prepare, draw, reduced: () => reduced.matches,
    complete() { updateEmphasis(); },
    status(state, progress) { host.dataset.bMotion = state; host.dataset.bMotionProgress = progress.toFixed(3); $('.b-replay').disabled = !motion.canReplay; },
  });

  // ---------- reader ----------
  function renderBreadcrumbs(s) {
    $('.b-breadcrumbs').innerHTML = `${s.layerId ? '<button class="b-rise" data-b-action="rise" aria-label="返回上层">↑</button>' : ''}<button data-b-action="root" ${s.layerId ? '' : 'aria-current="page"'}>全部事项</button>${s.path.map((item, index) => `<span aria-hidden="true">/</span><button data-b-dive="${esc(item.id)}" title="${esc(item.title)}" ${index === s.path.length - 1 ? 'aria-current="page"' : ''}>${esc(item.title)}</button>`).join('')}${s.layerId ? '<span class="b-layer-note">子层独立 64 份</span>' : ''}`;
  }
  function signalHTML(s) {
    const signal = s.frame.signal, receipt = s.records[s.index].receipt;
    if (!signal) return '<p class="b-signal">初始状态，尚未收到输入。</p>';
    const window = `${stamp(signal.window.from)}—${formatTime(signal.window.to)}`;
    if (signal.type === 'review') return `<div class="b-signal is-review"><strong>${esc(signal.reason)}</strong><span>窗口 ${window} 收到 0 条事件</span><span>覆盖：${esc(signal.coverage)}</span><span>结果：${receipt?.type === 'checked' ? '检查后不改' : '按时间重看后有调整'}</span><small>没有消息不等于现实没有变化。</small></div>`;
    return `<p class="b-signal">${signal.reason ? `${esc(signal.reason)} · ` : ''}窗口 ${window} 收到 ${signal.received} 条输入${signal.coverage ? `（${esc(signal.coverage)}）` : ''}${receipt?.type === 'checked' ? ' · 检查后不改' : ''}</p>`;
  }
  const allPlaced = s => [...layoutSection(s.layer, cache(s.layerId).order, 640).placed.values()];
  // Everything with a time after now, plus what is already overdue, in the order it arrives.
  function upcomingHTML(s) {
    const placed = allPlaced(s), rows = [];
    for (const due of deadlinesOf(s, placed.map(point => point.item))) rows.push({ at: due.at, id: due.id, title: due.item.title, what: due.ask ? due.ask.prompt : '条目自己的期限', kind: due.at < s.cursor ? 'over' : due.kind === 'ask' ? 'due' : 'item-due' });
    for (const point of placed) {
      const record = latestRecord(store, point.id, s.cursor);
      if (record?.until && record.until > s.cursor) rows.push({ at: record.until, id: point.id, title: point.item.title, what: record.meaning === 'snooze' ? '你推到这时再提醒' : '你定的时间', kind: record.meaning === 'snooze' ? 'snooze' : 'scheduled' });
    }
    const next = s.frames[s.index + 1];
    if (next) rows.push({ at: Date.parse(next.at), kind: 'next', title: '下一次整理', what: '这之后，本页的回应会被 Agent 读到' });
    rows.sort((a, b) => a.at - b.at);
    if (!rows.some(row => row.kind !== 'next')) return `<section class="b-upcoming"><h3>此刻之后</h3><p class="b-muted">此刻没有带期限的问题。${next ? `下一次整理在 ${stamp(next.at)}。` : ''}</p></section>`;
    return `<section class="b-upcoming"><h3>此刻之后 · 谁先到</h3><ol>${rows.map(row => row.kind === 'next'
      ? `<li class="is-next"><time>${relative(row.at - s.cursor)}</time><span>${esc(row.title)} · ${stamp(row.at)}</span></li>`
      : `<li class="is-${row.kind}"><time>${row.kind === 'over' ? relative(row.at - s.cursor) : relative(row.at - s.cursor)}</time><button type="button" data-b-item="${esc(row.id)}"><b>${esc(row.title)}</b><small>${stamp(row.at)} · ${esc(row.what)}</small></button></li>`).join('')}</ol></section>`;
  }
  function roundActionsHTML(s) {
    const visible = new Set(allPlaced(s).map(point => point.id));
    const entries = frameActions(s.index).filter(entry => visible.has(entry.target));
    if (!entries.length) return '';
    const shown = entries.slice(0, 5), rest = entries.slice(5);
    const one = entry => actionHTML(entry, { cls: 'b', withTarget: getItem(s.state, entry.target) });
    return `<section class="b-round-loop"><h3>本轮你在各处的回应 · ${entries.length} 条</h3>${shown.map(one).join('')}${rest.length ? `<details class="b-more"><summary>另 ${rest.length} 条</summary>${rest.map(one).join('')}</details>` : ''}</section>`;
  }
  function readingListHTML(s) {
    const section = layoutSection(s.layer, cache(s.layerId).order, 640);
    const rows = section.separate.map(id => {
      const item = section.placed.get(id).item, ask = currentAsk(s, id);
      return `<article class="b-reading-row${ask ? ' has-ask' : ''}" data-b-focus-id="${esc(id)}"><div class="b-reading-title"><button data-b-item="${esc(id)}" style="--item-color:${colorFor(item, s.state)}"><span class="b-item-dot" aria-hidden="true"></span>${esc(item.title)}</button><span><b>${item.share}</b> 份 · ${ask ? `<em>${expectOf(ask)}</em>` : esc(kindLabel[item.kind] || item.kind)}</span></div>${ask ? `<p class="b-reading-ask">${esc(ask.prompt)}</p>` : ''}<p>${esc(item.summary)}</p>${item.children?.items.length ? `<div class="b-row-links"><button data-b-dive="${esc(id)}">${item.children.items.length} 个子项 ↗</button></div>` : ''}</article>`;
    });
    if (section.group) rows.push(`<article class="b-reading-row is-group"><div class="b-reading-title"><button data-b-group><span class="b-item-dot is-group" aria-hidden="true"></span>另 ${section.group.members.length} 件小事</button><span><b>${section.group.share}</b> 份 · 每件不足 ${SMALL} 份${section.group.members.filter(id => currentAsk(s, id)).length ? ` · <em>${section.group.members.filter(id => currentAsk(s, id)).length} 件登记了问题</em>` : ''}</span></div></article>`);
    return rows.length ? `<div class="b-reading-list">${rows.join('')}</div>` : '<div class="b-empty-reader"><p>暂无事项。</p><button data-b-action="next">查看下一次整理 →</button></div>';
  }
  function smallListHTML(s) {
    const section = layoutSection(s.layer, cache(s.layerId).order, 640);
    if (!section.group) return '<p class="b-muted">此刻没有不足 3 份的事项。</p>';
    const members = section.group.members.map(id => ({ id, item: section.placed.get(id).item, ask: currentAsk(s, id), record: latestRecord(store, id, s.cursor) }));
    const dues = new Map(deadlinesOf(s, members.map(m => m.item)).map(entry => [entry.id, entry]));
    const asked = members.filter(m => m.ask), others = members.filter(m => !m.ask);
    const row = m => `<li data-b-focus-id="${esc(m.id)}"><button type="button" data-b-item="${esc(m.id)}" style="--item-color:${colorFor(m.item, s.state)}"><span class="b-item-dot" aria-hidden="true"></span><span class="b-small-title">${esc(m.item.title)}</span><small>${m.item.share} 份 · ${m.ask ? `<em>${expectOf(m.ask)}</em>` : esc(kindLabel[m.item.kind] || m.item.kind)}${dues.get(m.id) ? ` · <i class="b-due${dues.get(m.id).at < s.cursor ? ' is-over' : ''}">${relative(dues.get(m.id).at - s.cursor)}</i>` : ''}${m.record ? ' · <i class="b-rec">✓ 已回应</i>' : ''}</small></button></li>`;
    return `<p class="b-small-lead">份额都不足 ${SMALL} 份，合在一条带里；条带此刻按每件的真实份额分开画。点一件看详情与回应。</p>${asked.length ? `<h3>登记了问题 · ${asked.length}</h3><ol class="b-small-list">${asked.map(row).join('')}</ol>` : ''}<h3>其余 · ${others.length}</h3><ol class="b-small-list">${others.map(row).join('')}</ol>`;
  }
  function itemHTML(s, item) {
    const ask = item.status === 'active' ? currentAsk(s, item.id) : null;
    const response = responder.html(item, ask, { allowDefer: item.status === 'active' });
    const answered = latestRecord(store, item.id, s.cursor);
    const due = deadlinesOf(s, [item])[0];
    const actions = itemActions(item.id, s.index);
    const category = scenario.categories?.[item.id]?.label;
    const back = fromSmall ? '<button type="button" class="b-back-link" data-b-group-open>← 小事列表</button>' : '';
    return `${back}<div class="b-detail"><p class="b-detail-kicker"><i class="b-item-dot" style="--item-color:${colorFor(item, s.state)}" aria-hidden="true"></i><span>${esc(kindLabel[item.kind] || item.kind)} · <b>${item.share}</b> / 64 份</span>${item.status !== 'active' ? ` · ${item.status === 'merged' ? '已合并' : '已撤下'}` : ''}</p><h2>${esc(item.title)}</h2><p class="b-detail-summary">${esc(item.summary)}</p>
      ${response ? `<section class="b-detail-respond${ask || answered ? '' : ' is-default'}"><h3>${ask ? `回应 · ${expectOf(ask)}` : answered ? '你的回应' : '稍后提醒'}</h3>${response}</section>` : ''}
      ${due && !ask?.due_at ? `<p class="b-detail-due">期限 ${stamp(due.at)} · ${relative(due.at - s.cursor)}</p>` : ''}
      ${item.reason ? `<section><h3>为什么是这个分量</h3><p>${esc(item.reason)}</p></section>` : ''}
      ${item.sources?.length ? `<section><h3>依据 · ${item.sources.length} 条</h3>${originHTML(item, { cls: 'b' })}${sourcesHTML(item, { cls: 'b' })}</section>` : ''}
      ${actions.length ? `<section><h3>你在来源处的回应 · ${actions.length}</h3>${actions.slice(0, 6).map(entry => actionHTML(entry, { cls: 'b' })).join('')}${actions.length > 6 ? `<p class="b-muted">更早还有 ${actions.length - 6} 条</p>` : ''}</section>` : ''}
      <section><h3>两周版本</h3>${versionsHTML(item.id, s, { cls: 'b' })}</section>
      ${item.children?.items.length ? `<section><h3>子项 · 独立 64 份</h3><button type="button" class="b-cta" data-b-dive="${esc(item.id)}">进入 ${item.children.items.length} 个子项 →</button></section>` : ''}
      <details class="b-json"><summary>此事项的原始 JSON</summary><pre>${esc(JSON.stringify(item, null, 2))}</pre></details></div>`;
  }
  function diffHTML(s) {
    const ids = new Set([...s.layer.items, ...s.baseLayer.items].map(item => item.id));
    const changes = s.diff.changes.filter(change => ids.has(change.item));
    const options = s.frames.slice(0, s.index + 1).map((frame, index) => ({ value: index, text: frameName(frame, index) }));
    return `<div class="b-diff"><div class="b-diff-heading"><span>比较起点</span>${selectHTML('base', '比较起点', options, s.baseIndex)}<p>与 ${stamp(s.now)} 比较 <button data-lab-inspect="diff">完整差异 ↗</button></p></div>${changes.length ? `<div class="b-change-list">${changes.map(change => {
      const item = getItem(s.state, change.item) || getItem(s.baseState, change.item);
      const before = getItem(s.baseState, change.item), after = getItem(s.state, change.item);
      const allocation = change.fields.includes('share') && before?.status === 'active' && after?.status === 'active' && before.share !== after.share ? ` · ${before.share} → ${after.share} 份` : '';
      return `<button data-b-item="${esc(change.item)}"><small>${CHANGE_NAMES[change.type] || change.type}${allocation}</small><span>${esc(item?.title || change.item)}</span></button>`;
    }).join('')}</div>` : '<p class="b-muted">当前层没有内容变化，事项份额保持不变。</p>'}</div>`;
  }
  function renderReader(s, force = false) {
    const key = `${s.index}|${s.cursor}|${s.layerId}|${s.selectedId}|${readerMode}|${s.baseIndex}|${expanded}`;
    if (!force && key === readerStamp) return;
    readerStamp = key; closeSelect(false);
    const selected = s.selectedItem;
    $('.b-reader-actions [data-b-action="overview"]').hidden = !selected && readerMode === 'overview';
    let title = '本轮判断', kicker = '摘要与依据', content = '';
    if (readerMode === 'feedback') {
      title = '待确认批注';
      const annotations = s.state.pending_annotations ?? [];
      content = annotations.length ? `<div class="b-feedback-list">${annotations.map(annotation => { const id = annotation.item ?? annotation.item_id, item = getItem(s.state, id); return `<article><p>${esc(annotation.text)}</p><footer>${esc(annotation.author || '用户')} · 已保存，等待 Agent 处理确认</footer><button data-b-item="${esc(id)}">${esc(item?.title || id)} ↗</button></article>`; }).join('')}</div>` : '<p>暂无待确认批注。</p>';
    } else if (readerMode === 'story') {
      title = '演示说明';
      content = `<div class="b-story"><p>${esc(s.scenario.persona.context)}</p>${s.scenario.publicSources?.length ? `<h3>公开资料</h3>${s.scenario.publicSources.map(source => `<article><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a><p>${esc(source.usedFor)}</p></article>`).join('')}` : ''}</div>`;
    } else if (readerMode === 'diff') { title = '前后变化'; content = diffHTML(s); }
    else if (selected) { title = '事项详情'; kicker = fromSmall ? '小事 · 详情' : '摘要与依据'; content = itemHTML(s, selected); }
    else if (readerMode === 'small') { title = '小事'; kicker = '份额不足 3 的事项'; content = smallListHTML(s); }
    else content = `<p class="b-narrative">${esc(s.frame.narrative || s.frame.title)}</p>${signalHTML(s)}${upcomingHTML(s)}${roundActionsHTML(s)}${readingListHTML(s)}`;
    $('#b-reader-title').textContent = title; $('.b-reader-kicker').textContent = kicker;
    // Replacing the body must not drop keyboard focus to <body>, or Esc and Tab lose their place.
    const body = $('.b-reader-body'), hadFocus = body.contains(document.activeElement);
    body.innerHTML = content;
    if (!force) $('.b-reader-scroll').scrollTop = 0;
    if (hadFocus && !body.contains(document.activeElement)) (body.querySelector('.b-rs-receipt') || $('#b-reader-title')).focus({ preventScroll: true });
  }

  // ---------- emphasis ----------
  function updateEmphasis() {
    const id = hoveredId || focusedId || current.selectedId;
    const ids = new Set(id ? [id] : []);
    if (id) for (const link of cache(current.layerId).merges.filter(link => link.index <= current.index)) if (ids.has(link.to) || ids.has(link.from)) { ids.add(link.to); ids.add(link.from); }
    // A member of a closed 小事 band is only visible through the band itself.
    if (id && id !== GROUP && geometryGrouped(id) && !expanded) ids.add(GROUP);
    $('.b-chart-layout').classList.toggle('has-emphasis', ids.size > 0);
    for (const element of host.querySelectorAll('.b-chart-layout [data-b-item], .b-chart-layout [data-b-group], .b-label[data-b-focus-id], .b-label[data-b-group-label], .b-reader [data-b-focus-id]')) {
      const key = element.dataset.bItem ?? element.dataset.bFocusId ?? GROUP;
      element.classList.toggle('is-emphasized', ids.has(key));
      if (key !== GROUP && element.matches('button')) element.setAttribute('aria-pressed', String(key === current.selectedId));
    }
    host.dataset.bEmphasis = [...ids].join(',');
  }
  const geometryGrouped = id => Boolean(motion.visual?.meta?.bars?.get(id)?.grouped);

  // ---------- slider ----------
  function renderSlider(s) {
    const slider = $('.b-slider'), ratio = s.index / Math.max(1, s.frames.length - 1);
    slider.style.setProperty('--value', ratio);
    set(slider, { 'aria-valuenow': s.index, 'aria-valuetext': frameName(s.frame, s.index) });
  }
  function sliderIndex(clientX) {
    const rect = $('.b-slider-track').getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))) * (current.frames.length - 1));
  }
  function sliderPointer(event) {
    if (event.type === 'pointerdown') {
      if (!event.target.closest('.b-slider') || event.button !== 0) return;
      dragging = true; $('.b-slider').setPointerCapture(event.pointerId); $('.b-slider').classList.add('is-dragging'); $('.b-slider').focus({ preventScroll: true });
    } else if (!dragging) return;
    if (event.type === 'pointerup' || event.type === 'pointercancel') { dragging = false; $('.b-slider').classList.remove('is-dragging'); return; }
    const index = sliderIndex(event.clientX);
    if (index !== current.index) model.goFrame(index);
  }

  // ---------- listbox ----------
  function placeSelect(root) {
    const button = root.querySelector('.b-select-button'), list = root.querySelector('.b-select-list');
    const rect = button.getBoundingClientRect(), bottomSpace = innerHeight - rect.bottom - 96, topSpace = rect.top - 12;
    const width = Math.min(innerWidth - 24, Math.max(rect.width, Math.min(460, innerWidth - 24)));
    const upward = bottomSpace < 220 && topSpace > bottomSpace;
    list.style.width = `${width}px`;
    list.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    list.style.maxHeight = `${Math.max(160, Math.min(380, upward ? topSpace : bottomSpace))}px`;
    list.style.top = upward ? '' : `${rect.bottom + 4}px`;
    list.style.bottom = upward ? `${innerHeight - rect.top + 4}px` : '';
  }
  function setActive(root, index) {
    const options = [...root.querySelectorAll('[role="option"]')];
    const next = Math.max(0, Math.min(options.length - 1, index));
    options.forEach((option, at) => { option.id = `${uid}-${root.dataset.bSelect}-${at}`; option.classList.toggle('is-active', at === next); });
    root.querySelector('.b-select-list').setAttribute('aria-activedescendant', options[next].id);
    options[next].scrollIntoView({ block: 'nearest' });
    root.dataset.active = String(next);
  }
  function openSelectBox(root) {
    if (openSelect && openSelect !== root) closeSelect(false);
    openSelect = root; const list = root.querySelector('.b-select-list');
    root.querySelector('.b-select-button').setAttribute('aria-expanded', 'true');
    list.hidden = false; placeSelect(root);
    const selected = [...list.children].findIndex(option => option.getAttribute('aria-selected') === 'true');
    setActive(root, Math.max(0, selected)); list.focus({ preventScroll: true });
  }
  function closeSelect(returnFocus = true) {
    if (!openSelect) return;
    const root = openSelect; openSelect = null;
    root.querySelector('.b-select-list').hidden = true;
    root.querySelector('.b-select-button').setAttribute('aria-expanded', 'false');
    if (returnFocus && root.isConnected) root.querySelector('.b-select-button').focus({ preventScroll: true });
  }
  function chooseOption(root, option) {
    const value = Number(option.dataset.value); closeSelect(true);
    if (root.dataset.bSelect === 'frame') model.goFrame(value); else model.setBase(value);
  }
  function selectKeydown(event) {
    const root = event.target.closest('.b-select'); if (!root) return false;
    if (event.target.matches('.b-select-button')) {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openSelectBox(root); return true; }
      return false;
    }
    const options = root.querySelectorAll('[role="option"]'), active = Number(root.dataset.active ?? 0);
    const moves = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8, Home: -Infinity, End: Infinity };
    if (event.key in moves) { event.preventDefault(); setActive(root, Number.isFinite(moves[event.key]) ? active + moves[event.key] : moves[event.key] > 0 ? options.length - 1 : 0); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseOption(root, options[active]); }
    else if (event.key === 'Escape') { event.preventDefault(); closeSelect(true); }
    else if (event.key === 'Tab') closeSelect(false);
    event.stopPropagation(); return true;
  }

  // ---------- render ----------
  const perf = { renders: 0, total: 0, worst: 0, samples: [] };
  let readerTimer = 0;
  function render(s, event) {
    const t0 = performance.now();
    const previousIndex = current.index;
    current = s;
    if (event.type === 'select') { if (s.selectedId) { readerMode = 'item'; if (geometryGrouped(s.selectedId) && !expanded) expanded = true; } else { readerMode = expanded ? 'small' : 'overview'; fromSmall = false; } }
    if (event.type === 'compare') readerMode = s.comparing ? 'diff' : 'overview';
    if (event.type === 'dive' || event.type === 'rise') { readerMode = 'overview'; expanded = false; host.classList.remove('is-reading'); }
    if (event.type === 'frame' && !s.selectedId && readerMode === 'item') readerMode = expanded ? 'small' : 'overview';
    if (event.type === 'frame' && responder.closePanel()) readerStamp = '';
    $('.b-date').textContent = stamp(s.now);
    $('#b-page-title').textContent = s.frame.title; $('#b-page-title').title = s.frame.title;
    const revision = String(s.state.revision);
    $('.b-revision').textContent = `状态 ${revision.startsWith('r') ? revision : `r${revision}`}`;
    $('.b-input-count').textContent = String(s.frame.events.length);
    $('.b-feedback-button').hidden = !s.state.pending_annotations?.length;
    $('.b-feedback-count').textContent = String(s.state.pending_annotations?.length ?? 0);
    const jump = $('.b-jump .b-select');
    jump.querySelector('.b-select-value').textContent = `${frameShort(s.frame, s.index, s.frames.length)}${isReview(s.frame) ? ' · 每日整理' : ''}`;
    jump.querySelectorAll('[role="option"]').forEach((option, index) => option.setAttribute('aria-selected', String(index === s.index)));
    renderSlider(s);
    $('.b-first-date').textContent = formatDate(s.frames[0].at); $('.b-last-date').textContent = formatDate(s.frames.at(-1).at);
    $('[data-b-action="previous"]').disabled = s.index === 0; $('[data-b-action="next"]').disabled = s.index === s.frames.length - 1;
    $('.b-play-word').textContent = s.playing ? '暂停' : '播放'; $('.b-play-icon').textContent = s.playing ? 'Ⅱ' : '▷';
    $('.b-play').setAttribute('aria-label', s.playing ? '暂停回放' : '播放回放'); $('.b-compare').setAttribute('aria-pressed', String(s.comparing));
    for (const button of host.querySelectorAll('[data-b-range]')) button.setAttribute('aria-pressed', String(button.dataset.bRange === range));
    renderBreadcrumbs(s);
    // On a frame change the reading pane is rebuilt in its own task, so the bands start moving first.
    clearTimeout(readerTimer);
    if (event.type === 'frame' && !reduced.matches) readerTimer = setTimeout(() => renderReader(current, false), 0);
    else renderReader(s, event.type === 'record');
    const size = `${Math.round($('.b-chart-layout').clientWidth)}:${Math.round($('.b-present-body').clientHeight)}`;
    const chartKey = `${s.index}|${s.cursor}|${s.layerId}|${s.comparing}|${s.baseIndex}|${range}|${expanded}|${size}|${store.list().length}`;
    if (chartKey !== chartStamp || event.type === 'resize' || event.type === 'record') {
      const scene = makeScene(s);
      $('.b-history-range').textContent = scene.first === scene.last ? `第 ${scene.last + 1} 次整理` : `第 ${scene.first + 1}—${scene.last + 1} 次整理`;
      $('.b-budget').innerHTML = `<strong>${scene.section.used}</strong> / ${scene.section.budget} 份${scene.section.blank.share ? `<span class="b-blank-count"><i class="b-key-blank" aria-hidden="true"></i>${scene.section.blank.share} 份未分配</span>` : ''}`;
      const checked = s.index > 0 && s.frameDiff.changes.length === 0;
      $('.b-check-note').textContent = checked ? (isReview(s.frame) ? '每日整理：检查后不改' : '检查过，状态未变') : '';
      let duration = event.type === 'frame' ? (Math.abs(s.index - previousIndex) > 1 && !dragging ? FRAME_MS + 80 : FRAME_MS)
        : event.type === 'expand' || event.type === 'record' ? EXPAND_MS : event.type === 'dive' || event.type === 'rise' ? LAYER_MS : event.type === 'range' ? FRAME_MS : 0;
      if (drawnExpanded !== expanded) duration = Math.max(duration, EXPAND_MS);
      drawnExpanded = expanded;
      motion.transition(scene, { duration, instant: duration === 0 });
      chartStamp = chartKey;
    } else updateEmphasis();
    host.dataset.bStateIndex = String(s.index); host.dataset.bLayer = s.layerId ?? 'root'; host.dataset.bExpanded = String(expanded);
    const cost = performance.now() - t0; perf.renders += 1; perf.total += cost; perf.worst = Math.max(perf.worst, cost); if (perf.samples.length < 2000) perf.samples.push(cost);
  }
  function showReader() { if (mobile.matches) { host.classList.add('is-reading'); $('#b-reader-title').focus({ preventScroll: true }); } }
  function toggleGroup(open = !expanded) {
    expanded = open; fromSmall = false;
    readerMode = open ? 'small' : 'overview';
    if (current.selectedId) { model.select(null); return; }
    render(current, { type: 'expand' });
  }
  function click(event) {
    const option = event.target.closest('.b-select [role="option"]');
    if (option) { chooseOption(option.closest('.b-select'), option); return; }
    const selectButton = event.target.closest('.b-select-button');
    if (selectButton) { const root = selectButton.closest('.b-select'); if (openSelect === root) closeSelect(true); else openSelectBox(root); return; }
    const button = event.target.closest('button, [role="button"], .b-loop, .b-flow, .b-tick-mark, .b-lane');
    if (!button || !host.contains(button)) return;
    if (button.dataset.labInspect) return;
    if (button.dataset.tFrame != null) { model.goFrame(Number(button.dataset.tFrame)); return; }
    if (button.dataset.bGroupOpen != null) { fromSmall = false; readerMode = 'small'; model.select(null); return; }
    if (button.dataset.bGroup != null) { toggleGroup(); return; }
    const item = button.dataset.bItem || button.dataset.tItem;
    if (item) { fromSmall = readerMode === 'small' || (fromSmall && Boolean(current.selectedId)); model.select(item); showReader(); return; }
    if (button.dataset.bDive) { model.dive(button.dataset.bDive); return; }
    if (button.dataset.bFrame != null) { model.goFrame(Number(button.dataset.bFrame)); return; }
    if (button.dataset.bRange) { range = button.dataset.bRange; render(current, { type: 'range' }); return; }
    switch (button.dataset.bAction) {
      case 'previous': model.goFrame(current.index - 1); break;
      case 'next': model.goFrame(current.index + 1); break;
      case 'play': model.togglePlay(); break;
      case 'rise': model.rise(); break;
      case 'root': model.goRoot(); break;
      case 'replay': motion.replay(); break;
      case 'overview': readerMode = 'overview'; fromSmall = false; expanded = false; if (current.selectedId) model.select(null); else render(current, { type: 'expand' }); break;
      case 'feedback': readerMode = 'feedback'; model.select(null); showReader(); break;
      case 'story': readerMode = 'story'; renderReader(current, true); showReader(); break;
      case 'read': readerMode = 'overview'; model.select(null); showReader(); break;
      case 'back-chart': host.classList.remove('is-reading'); break;
      case 'compare': model.setCompare(!current.comparing); showReader(); break;
    }
  }
  function keydown(event) {
    if (selectKeydown(event)) return;
    if (event.target.matches('.b-slider')) {
      const steps = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 };
      let next = null;
      if (event.key in steps) next = current.index + steps[event.key];
      else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = current.frames.length - 1;
      if (next != null && !event.altKey) { event.preventDefault(); event.stopPropagation(); model.goFrame(next); }
      return;
    }
    if (event.key === 'Escape' && !event.altKey) {
      if (responder.closePanel()) { renderReader(current, true); event.stopPropagation(); return; }
      if (current.selectedId) { const back = current.selectedId; model.select(null); event.stopPropagation(); requestAnimationFrame(() => host.querySelector(`.b-label[data-b-focus-id="${CSS.escape(back)}"] .b-label-main, [data-b-group]`)?.focus({ preventScroll: true })); return; }
      if (expanded) { toggleGroup(false); event.stopPropagation(); return; }
    }
    // ↑/↓ walk the chart labels in reading order.
    const label = event.target.closest?.('.b-label');
    if (label && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      const all = [...host.querySelectorAll('.b-label .b-label-main')].filter(element => element.closest('.b-label').style.pointerEvents !== 'none');
      const at = all.indexOf(event.target.closest('.b-label-main'));
      const next = all[Math.max(0, Math.min(all.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) { event.preventDefault(); next.focus(); }
    }
  }
  const itemFrom = element => element?.closest?.('[data-b-item], [data-b-focus-id], [data-b-group], [data-b-group-label]') ? (element.closest('[data-b-item], [data-b-focus-id], [data-b-group], [data-b-group-label]').dataset.bItem ?? element.closest('[data-b-item], [data-b-focus-id], [data-b-group], [data-b-group-label]').dataset.bFocusId ?? GROUP) : null;
  function pointerover(event) { const id = itemFrom(event.target); if (id !== hoveredId) { hoveredId = id; updateEmphasis(); } }
  function pointerout(event) { const id = itemFrom(event.relatedTarget); if (id !== hoveredId) { hoveredId = id; updateEmphasis(); } }
  function focusin(event) { if (event.target.closest('.b-reader-body')) return; focusedId = itemFrom(event.target); updateEmphasis(); }
  function focusout() { queueMicrotask(() => { if (!disposed) { focusedId = document.activeElement?.closest?.('.b-reader-body') ? null : itemFrom(document.activeElement); updateEmphasis(); } }); }
  function outside(event) { if (openSelect && !openSelect.contains(event.target)) closeSelect(false); }
  function scrolled(event) { if (openSelect && !openSelect.querySelector('.b-select-list').contains(event.target)) closeSelect(false); }
  const listeners = { click, keydown, pointerover, pointerout, focusin, focusout, pointerdown: sliderPointer, pointermove: sliderPointer, pointerup: sliderPointer, pointercancel: sliderPointer };
  for (const [name, listener] of Object.entries(listeners)) host.addEventListener(name, listener);
  const unbindRespond = responder.bind($('.b-reader-body'), { getAsk: id => currentAsk(current, id), getItemVersion: id => getItem(current.state, id), render: () => renderReader(current, true) });
  document.addEventListener('pointerdown', outside, true);
  host.addEventListener('scroll', scrolled, true);
  const onResize = () => closeSelect(false); addEventListener('resize', onResize);
  const reduceMotion = () => { if (reduced.matches) motion.settle(); $('.b-replay').disabled = !motion.canReplay; };
  reduced.addEventListener?.('change', reduceMotion);
  const unsubscribe = model.subscribe(render);
  let lastSize = `${$('.b-chart-layout').clientWidth}:${$('.b-present-body').clientHeight}`;
  const observer = new ResizeObserver(() => {
    const size = `${$('.b-chart-layout').clientWidth}:${$('.b-present-body').clientHeight}`;
    if (disposed || size === lastSize || (mobile.matches && host.classList.contains('is-reading'))) return;
    lastSize = size; cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { if (!disposed) render(current, { type: 'resize' }); });
  });
  observer.observe($('.b-chart-layout')); host.dataset.bBuild = 'b-temporal-1';
  // For review tooling: per-frame draw cost of transitions, and render cost per model event.
  host.__bTime = { motion, perf, store, get expanded() { return expanded; }, toggleGroup };
  return () => {
    disposed = true; clearTimeout(readerTimer); unsubscribe(); unbindRespond(); observer.disconnect(); cancelAnimationFrame(resizeFrame); motion.stop();
    for (const [name, listener] of Object.entries(listeners)) host.removeEventListener(name, listener);
    document.removeEventListener('pointerdown', outside, true); host.removeEventListener('scroll', scrolled, true);
    removeEventListener('resize', onResize);
    reduced.removeEventListener?.('change', reduceMotion);
  };
}

export default mount;
