import {
  escapeHTML as esc, formatDate, formatTime, kindLabel,
  getItem, getLayer, colorFor, currentAsk, notice, scenario, records,
} from './shared.mjs?v=feedback-loop-1';
import { SMALL, GROUP, stableOrder, layoutSection, bandPath, centerPath, labelPositions, futureFraction, FUTURE_GRID, placeCaptions } from './b-layout.mjs?v=b-temporal-2';
import { createTimeMotion, BEATS } from './b-motion.mjs?v=b-temporal-3';
import {
  stamp, relative, actionHTML, frameActions, itemActions, versionsOf, versionsHTML, sourcesHTML, originHTML,
  deadlinesOf, latestRecord, recordWords, createResponder,
} from './temporal.mjs?v=temporal-2';
import { createResponseStore, normalizeAsk } from '../respond.mjs?v=respond-1';
import { createIx, IX } from '../forms/motion/ix.mjs';
import { itemFacts, shortOf } from '../forms/motion/dial-model.mjs';

// B · 时间展开。左边是最近几次整理里每件事的份额带，中间一根是此刻的 64 份，右边是此刻之后：
// 期限画成刻度，一眼看出谁先到。份额不足 3 的事项合成一条“小事”带，点开在阅读区逐件列出。
//
// 第三轮（prototype/forms/polish/b-motion.md）：
// - 换轮先“走”：条带以此刻为原点，时间走过去，此刻之后的刻度朝此刻线流，下一次整理的虚线流到此刻线就是切点；
//   之后按 D 的节拍表：切点换字 → 回执填实 → 英雄数字 → 离场 → 移位 → 进场 → 新问题描红（b-motion.mjs 的 BEATS）。
// - 英雄数字：最近的一个等你回的期限还有几小时，图上是此刻线到那枚刻度的墨色括号。
// - 作答：阅读区的回应面板原地收成回执，图上那一件的期限变空心，英雄数字翻到下一件；份额等下一轮整理读到了才变。
// - 悬停看概要、点击沿 64 份柱弹出 8 px + 引线 + 详情卡，共用 ../forms/motion/ix.mjs；▶ 连播由本页计时。
// - 直接打开（顶层、不带 ?frame=、没有 referrer）讲一遍；任意键跳到终态，“重演”再讲。
const CHANGE_NAMES = { added: '新增', updated: '内容更新', withdrawn: '撤下', restored: '恢复', merged: '合并', annotations_changed: '批注变化' };
const EXPECT = { decide: '需要你决定', input: '需要你提供', act: '需要你去做', snooze: '可以推后' };
const SVG = 'http://www.w3.org/2000/svg';
const AXIS_HEIGHT = 40;
const FRAME_MS = 340, EXPAND_MS = 280, LAYER_MS = 420, BACK_MS = 380;
const PLAY = 5.6;       // seconds a round when playing on, counted from the cut
const HOUR = 3600000;
const EASE_OUT = 'cubic-bezier(.215,.61,.355,1)';
const frameShort = (frame, index, total) => `${String(index + 1).padStart(2, '0')} / ${total} · ${stamp(frame.at)}`;
const frameName = (frame, index) => `${String(index + 1).padStart(2, '0')} · ${stamp(frame.at)} · ${frame.title}`;
const isReview = frame => frame?.signal?.type === 'review';
const clip = (text, n) => { const chars = [...String(text || '')]; return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : chars.join(''); };
const shortTitle = title => { const head = String(title || '').split(/[：:]/)[0]; return [...head].length > 11 ? `${[...head].slice(0, 10).join('')}…` : head; };
const expectOf = ask => ask ? EXPECT[normalizeAsk(ask).meanings[0]] || '登记了问题' : '';
const askShort = ask => clip(ask?.short || ask?.prompt || '', 18);
// “8 小时”“13 小时 40 分”“48 分钟”, and whole hours from a day on (“108 小时”): the hero's number and unit.
function heroWords(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return { n: String(minutes), unit: '分钟' };
  if (minutes >= 24 * 60) return { n: String(Math.round(minutes / 60)), unit: '小时' };
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return { n: String(h), unit: m ? `小时 ${m} 分` : '小时' };
}
const hash = (text, salt = 0) => { let h = 2166136261 ^ salt; for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 10007) / 10007; };
let mountNumber = 0, told = false; // told: the story plays at most once per page load

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

// The sample of the story (b-motion.md 第 2 节): the frame whose hero question is a choose or schedule that the next
// round's real inputs answered (feedback naming it); of several, the one after which the most shares fell free.
function storySample(frames) {
  let best = null;
  for (let i = 1; i < frames.length - 1; i += 1) {
    const s = { index: i, state: records[i].state, cursor: Date.parse(frames[i].at) };
    let hero = null;
    for (const item of s.state.root.items) {
      const ask = currentAsk(s, item.id);
      const at = ask ? Date.parse(ask.due_at || item.due_at || '') : NaN;
      if (ask && at >= s.cursor && (!hero || at < hero.at)) hero = { id: item.id, ask, at };
    }
    if (!hero || !['choose', 'schedule'].includes(normalizeAsk(hero.ask).expects)) continue;
    const link = frames[i + 1].events.flatMap(event => event.feedback || []).find(l => l.ask === hero.ask.id);
    if (!link) continue;
    const freed = (64 - records[i + 1].state.root.used) - (64 - records[i].state.root.used);
    const action = hero.ask.actions?.find(a => a.id === link.action && a.meaning !== 'input') || hero.ask.actions?.find(a => a.recommended) || hero.ask.actions?.[0];
    if (!best || freed > best.freed) best = { index: i, id: hero.id, ask: hero.ask.id, action: action?.id, freed };
  }
  return best;
}

// Custom listbox (no native <select>): a button plus a fixed-position popup.
const selectHTML = (kind, label, options, value) => `<div class="b-select" data-b-select="${kind}"><button type="button" class="b-select-button" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(label)}"><span class="b-select-value">${esc(options[value]?.text ?? '')}</span><span class="b-select-caret" aria-hidden="true"></span></button><ul class="b-select-list" role="listbox" tabindex="-1" aria-label="${esc(label)}" hidden>${options.map((option, index) => `<li role="option" data-value="${option.value}" aria-selected="${index === value}" class="${option.className || ''}"><span>${esc(option.text)}</span>${option.note ? `<small>${esc(option.note)}</small>` : ''}</li>`).join('')}</ul></div>`;

export function mount(host, model) {
  host.classList.add('variant-b');
  const uid = `b${++mountNumber}`;
  const $ = selector => host.querySelector(selector);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 760px)');
  // The shared summary and detail cards (ix.mjs) bring their own structure; B only sets the --ix-* variables.
  if (!document.querySelector('link[data-ix-css]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.dataset.ixCss = ''; link.href = './forms/motion/ix.css'; document.head.prepend(link); }
  let current = model.snapshot(), range = 'recent', readerMode = 'overview', expanded = false, fromSmall = false;
  let hoveredId = null, focusedId = null, disposed = false, resizeFrame = null;
  let chartStamp = '', readerStamp = '', readerContent = '', openSelect = null, dragging = false, geometry = null, drawnExpanded = false;
  let shown = current;            // the snapshot whose texts and facts are on screen (it changes at the cut)
  let advancing = false, instantNext = false;
  const store = createResponseStore();
  const responder = createResponder({ store, snapshot: () => current, cls: 'b', onChange: (record, kind) => render(current, { type: 'record', kind }) });
  const layerCache = new Map();
  const elements = { bands: new Map(), grads: new Map(), nodes: new Map(), marks: new Map(), merges: new Map(), bars: new Map(), lanes: new Map(), ticks: new Map(), labels: new Map(), leaders: new Map(), numbers: new Map(), notches: new Map(), nexts: new Map() };
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
      <span class="b-tell-note" aria-live="polite" hidden>正在讲一遍 · 按任意键跳过</span>
      <button class="b-tell" data-b-action="tell" hidden title="把最近的期限从到来、作答讲到下一轮让位（约 8 秒，任意键跳过）">▶ 重演</button>
      <button class="b-replay" data-b-action="replay" disabled title="慢放上次过渡">↻ <span>重播过渡</span></button>
      <button class="b-mobile-read" data-b-action="read">摘要 ↗</button>
    </div>
    <div class="b-main">
      <section class="b-workspace" aria-label="事项份额随时间的变化与此刻之后的期限">
        <div class="b-workspace-head"><nav class="b-breadcrumbs" aria-label="当前查看层级"></nav><div class="b-view-options"><div class="b-range" role="group" aria-label="显示的整理范围"><button data-b-range="recent" aria-pressed="true">近 5 次</button><button data-b-range="all" aria-pressed="false">全部</button></div><button class="b-compare" data-b-action="compare" aria-pressed="false">比较前后</button></div></div>
        <div class="b-chart-layout">
          <div class="b-history"><div class="b-plot-caption"><strong>此前</strong><span class="b-history-range"></span></div><div class="b-chart-scroll" tabindex="0" aria-label="历史份额变化，可横向滚动"><div class="b-plot"><svg class="b-flow-svg" role="group" aria-label="同一事项的份额随整理变化"><defs>${hatch(`${uid}-blank`)}<clipPath id="${uid}-clip"><rect class="b-clip-rect"/></clipPath></defs><rect class="b-history-ground" fill="url(#${uid}-blank)"/><g class="b-guides"></g><g clip-path="url(#${uid}-clip)"><g class="b-bands"></g><g class="b-merge-paths"></g><g class="b-node-lines"></g><g class="b-loop-marks"></g></g></svg><div class="b-node-buttons"></div><div class="b-plot-empty" hidden><p>暂无事项记录。</p><button data-b-action="next">查看下一次整理 →</button></div></div></div></div>
          <div class="b-present">
            <div class="b-present-heading"><span class="b-now-head"><strong>此刻</strong><span class="b-budget"></span></span><span class="b-hero" aria-live="polite"><span class="b-hero-k">最近的期限</span><b class="b-hero-n"></b><span class="b-hero-u"></span><span class="b-hero-q"></span></span></div>
            <div class="b-present-body">
              <svg class="b-now-svg" role="group" aria-label="此刻的 64 份与之后的期限"><defs>${hatch(`${uid}-blank-now`)}<linearGradient id="${uid}-fade" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".7" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="${uid}-lane-mask" maskContentUnits="userSpaceOnUse"><rect class="b-lane-mask-rect" fill="url(#${uid}-fade)"/></mask></defs><rect class="b-section-blank" fill="url(#${uid}-blank-now)"/><g class="b-future-grid"></g><g class="b-lanes" mask="url(#${uid}-lane-mask)"></g><g class="b-bars"></g><g class="b-numbers" aria-hidden="true"></g><g class="b-notches" aria-hidden="true"></g><line class="b-now-line"/><g class="b-nexts" aria-hidden="true"></g><g class="b-leaders"></g><g class="b-ticks"></g><path class="b-hero-mark" aria-hidden="true"/></svg>
              <canvas class="b-concept" aria-hidden="true"></canvas>
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

  const stage = $('.b-chart-layout');
  const svgEl = (tag, className, parent) => { const element = document.createElementNS(SVG, tag); if (className) element.setAttribute('class', className); parent.append(element); return element; };
  const set = (element, values) => { for (const [name, value] of Object.entries(values)) element.setAttribute(name, String(value)); };
  const removeMissing = (map, wanted, remove = element => element.remove()) => { for (const [key, element] of map) if (!wanted.has(key)) { remove(element); map.delete(key); } };

  // ---------- answered here, and the hero ----------
  // A question counts as answered on this page when the newest local record on its item names it (or names none);
  // a deferral counts until its moment.
  function answeredHere(id, ask, cursor) {
    const record = latestRecord(store, id, cursor);
    if (!record || !ask) return false;
    if (record.meaning === 'snooze') return record.until > cursor;
    return !record.ask || record.ask === ask.id;
  }
  // A record that answered an earlier question on this item (the question on screen is a newer one).
  const staleRecord = (record, ask) => Boolean(record && ask && record.meaning !== 'snooze' && record.ask && record.ask !== ask.id);
  /** The nearest deadline at or after now among open questions on these items that you have not answered here. */
  function heroOf(s, items) {
    let best = null;
    for (const item of items) {
      const ask = currentAsk(s, item.id);
      if (!ask) continue;
      const at = ask.due_at ? Date.parse(ask.due_at) : item.due_at ? Date.parse(item.due_at) : NaN;
      if (!(at >= s.cursor) || answeredHere(item.id, ask, s.cursor)) continue;
      if (!best || at < best.at) best = { id: item.id, item, ask, at };
    }
    return best;
  }

  // ---------- labels ----------
  function labelHTML(entry) {
    if (entry.group) {
      return `<button type="button" class="b-label-main b-label-group" data-b-group aria-expanded="${expanded}" aria-controls="b-reader-title"><span class="b-label-title">另 ${entry.count} 件小事</span><small><b>${entry.share}</b> 份${entry.asks ? ` · <em>${entry.asks} 件登记了问题</em>` : ''} · ${expanded ? '收起 ▴' : '逐件看 ▾'}</small></button>`;
    }
    const { item, ask, due, record, now } = entry;
    const dueText = due ? `<i class="b-due${due.at < now ? ' is-over' : ''}">${due.at < now ? '已过期' : relative(due.at - now)}</i>` : '';
    const recordText = record ? `<i class="b-rec">✓ ${staleRecord(record, ask) ? '答过上一版' : entry.recordStatus === 'acknowledged' ? '已收到' : '已保存'}</i>` : '';
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
    const meta = { bands: new Map(), bars: new Map(), ticks: new Map(), labels: new Map(), marks: new Map(), merges: new Map(), nexts: new Map(), hero: null };
    const scene = { snap: s, time: s.cursor, index: s.index, layerId: s.layerId, first, last, width, height, section, meta, ...d,
      nodes: new Map(indexes.map(index => [index, { x: xFor(index), o: 1 }])),
      bands: new Map(), bars: new Map(), lanes: new Map(), ticks: new Map(), labels: new Map(), marks: new Map(), merges: new Map(), nexts: new Map(), hero: new Map(),
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
      if (!point.grouped) entries.push({ id: point.id, item: point.item, y: point.y, h: point.h, ask, due: deadlines.get(point.id), record, recordStatus, now: cursor });
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
      const answered = Boolean(due.ask && answeredHere(due.id, due.ask, cursor));
      ticks.push({ key: `due:${due.id}`, x: futureFraction(due.at - cursor) * d.futureW, y: center(point), h: Math.max(14, point.h), o: 1,
        meta: { kind: due.ask ? 'due' : 'item-due', over, answered, at: due.at, id: due.id, grouped: point.grouped, line1: point.grouped ? shortTitle(point.item.title) : stamp(due.at), line2: point.grouped ? `${stamp(due.at)} · ${relative(due.at - cursor)}` : answered ? `${relative(due.at - cursor)} · 已答` : relative(due.at - cursor) } });
    }
    for (const point of section.placed.values()) {
      const record = latestRecord(store, point.id, cursor);
      if (!record) continue;
      const status = meta.bars.get(point.id).record;
      ticks.push({ key: `chk:${point.id}`, x: -9, y: center(point), h: 0, o: point.grouped && !expanded ? .9 : 1, meta: { kind: 'check', id: point.id, status } });
      if (record.until && record.until > cursor) ticks.push({ key: `rec:${point.id}`, x: futureFraction(record.until - cursor) * d.futureW, y: center(point), h: Math.max(14, point.h), o: 1,
        meta: { kind: record.meaning === 'snooze' ? 'snooze' : 'scheduled', at: record.until, id: point.id, grouped: point.grouped, line1: `${record.meaning === 'snooze' ? '◷ 再提醒' : '你定的'} ${stamp(record.until)}`, line2: point.grouped ? shortTitle(point.item.title) : relative(record.until - cursor) } });
    }
    const textWidth = text => [...String(text)].reduce((sum, char) => sum + (/[⺀-￿]/.test(char) ? 11 : 6.3), 0);
    // Captions never leave the strip after now: on a narrow strip each line is cut to fit, with an ellipsis.
    const room = d.futureW + d.leaderW - 6;
    const fit = text => { if (textWidth(text) <= room) return text; let out = ''; for (const char of String(text)) { if (textWidth(`${out}${char}…`) > room) break; out += char; } return `${out}…`; };
    for (const tick of ticks) if (tick.meta.line1) {
      tick.meta.line1 = fit(tick.meta.line1); tick.meta.line2 = fit(tick.meta.line2);
      tick.meta.width = Math.max(textWidth(tick.meta.line1), textWidth(tick.meta.line2) * .95);
    }
    placeCaptions(ticks.filter(tick => tick.meta.kind !== 'check'), { lineHeight: 27, width: 110, height });
    for (const tick of ticks) { scene.ticks.set(tick.key, { x: tick.x, y: tick.y, h: tick.h, ty: tick.ty ?? tick.y, o: tick.o }); meta.ticks.set(tick.key, tick.meta); }
    // The next 整理: keyed by its moment, so the one the walk reaches is consumed at the cut and the next one fades in.
    const next = s.frames[s.index + 1];
    if (next) { const at = Date.parse(next.at), key = `n:${at}`; scene.nexts.set(key, { x: futureFraction(at - cursor) * d.futureW, o: 1 }); meta.nexts.set(key, { at }); }
    meta.next = next ? Date.parse(next.at) : null;
    // The hero: the bracket from now to its deadline's tick.
    const hero = heroOf(s, [...section.placed.values()].map(point => point.item));
    if (hero && scene.ticks.has(`due:${hero.id}`)) {
      const tick = scene.ticks.get(`due:${hero.id}`);
      scene.hero.set('hero', { x: tick.x, y: tick.y, o: 1 });
      meta.hero = { id: hero.id, at: hero.at, ask: hero.ask, key: `due:${hero.id}` };
    } else meta.hero = hero ? { id: hero.id, at: hero.at, ask: hero.ask, key: null } : null;
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
  // Under a beat plan, texts on elements that stay (labels, bar numbers, tick captions) wait for the 'land' cue,
  // so a number turns when its geometry has landed; new elements get theirs at once.
  let pending = [];
  const flushPending = () => { const list = pending; pending = []; for (const fn of list) fn(); };
  function prepare(scene, plan) {
    flushPending();
    const defer = Boolean(plan && !plan.uniform);
    const later = fn => (defer ? pending.push(fn) : fn());
    const { width, height, barW, futureW, svgW } = scene;
    const snap = scene.snap || current;
    $('.b-plot').style.width = `${width}px`; $('.b-plot').style.height = `${height + AXIS_HEIGHT}px`;
    set($('.b-flow-svg'), { width, height, viewBox: `0 0 ${width} ${height}` });
    set($('.b-history-ground'), { x: 0, y: 0, width, height });
    set($('.b-clip-rect'), { x: 2, y: -8, width: Math.max(1, width - 4), height: height + 16 });
    $('.b-node-buttons').style.height = `${AXIS_HEIGHT}px`;
    $('.b-guides').innerHTML = [16, 32, 48].map(value => `<line x1="0" x2="${width}" y1="${value / 64 * height}" y2="${value / 64 * height}" class="b-guide"/>`).join('');
    set($('.b-now-svg'), { width: svgW, height, viewBox: `0 0 ${svgW} ${height}` });
    set($('.b-lane-mask-rect'), { x: barW, y: 0, width: futureW, height });
    set($('.b-now-line'), { x1: barW + .5, x2: barW + .5, y1: -6, y2: height + 6 });
    concept.size(svgW, height);
    $('.b-labels').style.left = `${svgW}px`;
    $('.b-labels').classList.toggle('is-dense', Boolean(scene.dense));
    $('.b-future-grid').innerHTML = FUTURE_GRID.map(([span]) => `<line class="b-future-guide" x1="${barW + futureFraction(span) * futureW}" x2="${barW + futureFraction(span) * futureW}" y1="0" y2="${height}"/>`).join('');
    const nextAt = scene.meta.next, now = scene.time ?? snap.cursor;
    const nextText = nextAt ? `下次整理 ${formatTime(nextAt)}` : '';
    const nextX = nextAt ? barW + futureFraction(nextAt - now) * futureW : -1;
    $('.b-future-axis').innerHTML = `<span class="is-now" style="left:${barW}px">此刻 ${formatTime(now)}</span>${FUTURE_GRID.filter(([span]) => Math.abs(barW + futureFraction(span) * futureW - nextX) > 34).map(([span, text]) => `<span style="left:${barW + futureFraction(span) * futureW}px">${text}</span>`).join('')}${nextText ? `<span class="is-next" style="left:${nextX}px">${nextText}</span>` : ''}`;
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
      if (key === GROUP) { path.dataset.bGroup = ''; delete path.dataset.bItem; delete path.dataset.id; } else { path.dataset.bItem = key; path.dataset.id = key; }
      path.firstElementChild.textContent = key === GROUP ? '小事：份额不足 3 的事项合在一起' : `${info?.title}；悬停看概要，点击展开`;
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
      pair.line.classList.toggle('is-current', index === scene.index);
      pair.line.classList.toggle('is-baseline', snap.comparing && index === snap.baseIndex);
      pair.button.classList.toggle('is-current', index === scene.index);
      pair.button.tabIndex = scene.nodes.get(index).o < .5 ? -1 : 0;
      if (index === scene.index) pair.button.setAttribute('aria-current', 'step'); else pair.button.removeAttribute('aria-current');
    }
    removeMissing(elements.merges, scene.merges);
    for (const key of scene.merges.keys()) {
      if (elements.merges.has(key)) continue;
      const link = scene.meta.merges.get(key);
      const path = svgEl('path', 'b-merge-link', $('.b-merge-paths')); path.dataset.bItem = link.to; path.dataset.id = link.to;
      path.append(document.createElementNS(SVG, 'title')); path.firstElementChild.textContent = `${link.source.title}，明确合并至${link.target.title}`;
      elements.merges.set(key, path);
    }
    removeMissing(elements.marks, scene.marks, group => group.root.remove());
    for (const key of scene.marks.keys()) {
      if (elements.marks.has(key)) continue;
      const mark = scene.meta.marks.get(key);
      const root = svgEl('g', `b-loop is-${mark.kind}`, $('.b-loop-marks')); root.dataset.bItem = mark.anchor; root.dataset.id = mark.anchor;
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
      let rect = elements.bars.get(key), fresh = false;
      if (!rect) {
        rect = svgEl('rect', `b-bar${key === GROUP ? ' is-group' : ''}`, $('.b-bars')); set(rect, { x: 0, role: 'button', tabindex: -1 });
        elements.bars.set(key, rect); fresh = true;
        const number = svgEl('text', 'b-bar-number', $('.b-numbers')); elements.numbers.set(key, number);
        const notch = svgEl('rect', 'b-ask-notch', $('.b-notches')); set(notch, { x: 0, width: 4 }); elements.notches.set(key, notch);
      }
      set(rect, { width: barW });
      if (key === GROUP) { rect.dataset.bGroup = ''; rect.setAttribute('aria-label', `小事 ${info.share} 份`); $('.b-bars').prepend(rect); }
      else { rect.dataset.bItem = key; rect.dataset.id = key; rect.setAttribute('aria-label', `${info.title} ${info.share} 份`); rect.style.fill = info.color; rect.classList.toggle('is-member', Boolean(info.grouped)); }
      rect.dataset.share = String(info.share);
      const number = elements.numbers.get(key), text = String(info.share);
      if (number.textContent !== text) (fresh || !number.textContent ? fn => fn() : later)(() => { number.textContent = text; });
      set(number, { x: barW / 2 + 1 });
      number.classList.toggle('is-group', key === GROUP);
      elements.notches.get(key).classList.toggle('is-on', Boolean(info.ask));
      if (key !== GROUP) elements.notches.get(key).dataset.bItem = key;
    }
    for (const key of scene.lanes.keys()) {
      let rect = elements.lanes.get(key);
      if (!rect) { rect = svgEl('rect', `b-lane${key === GROUP ? ' is-group' : ''}`, $('.b-lanes')); set(rect, { x: barW }); elements.lanes.set(key, rect); }
      set(rect, { x: barW, width: futureW });
      const info = scene.meta.bars.get(key);
      if (key !== GROUP && info) { rect.style.fill = info.color; rect.dataset.bItem = key; rect.dataset.id = key; }
    }
    // Next 整理 lines, keyed by their moment.
    removeMissing(elements.nexts, scene.nexts);
    for (const key of scene.nexts.keys()) if (!elements.nexts.has(key)) elements.nexts.set(key, svgEl('line', 'b-next-line', $('.b-nexts')));
    // Leaders and labels (one per separate band and one for 小事).
    removeMissing(elements.leaders, scene.labels);
    removeMissing(elements.labels, scene.labels);
    for (const key of scene.labels.keys()) {
      const entry = scene.meta.labels.get(key);
      let leader = elements.leaders.get(key);
      if (!leader) { leader = svgEl('path', 'b-leader', $('.b-leaders')); elements.leaders.set(key, leader); }
      if (key === GROUP) leader.dataset.bGroup = ''; else leader.dataset.bItem = key;
      let label = elements.labels.get(key), fresh = false;
      if (!label) { label = document.createElement('div'); label.className = 'b-label'; label.setAttribute('role', 'listitem'); $('.b-labels').append(label); elements.labels.set(key, label); fresh = true; }
      if (key === GROUP) { label.dataset.bGroupLabel = ''; delete label.dataset.bFocusId; delete label.dataset.id; } else { label.dataset.bFocusId = key; label.dataset.id = key; }
      if (!entry) continue;
      label.classList.toggle('has-ask', Boolean(entry.ask) || Boolean(entry.asks));
      label.classList.toggle('is-group', Boolean(entry.group));
      const html = labelHTML(entry);
      if (label.dataset.content !== html) {
        const apply = () => { if (label.dataset.content === html) return; label.dataset.content = html; label.innerHTML = html; };
        if (fresh || !label.dataset.content) apply(); else later(apply);
      }
    }
    // Keep DOM order = top-to-bottom order so Tab and ↑/↓ walk the labels in reading order.
    [...elements.labels.entries()].sort((a, b) => (scene.labels.get(a[0])?.y ?? 0) - (scene.labels.get(b[0])?.y ?? 0)).forEach(([, label]) => $('.b-labels').append(label));
    removeMissing(elements.ticks, scene.ticks, group => group.root.remove());
    for (const key of scene.ticks.keys()) {
      const info = scene.meta.ticks.get(key);
      let tick = elements.ticks.get(key), fresh = false;
      if (!tick) {
        const root = svgEl('g', `b-tick-mark is-${info.kind}`, $('.b-ticks'));
        const line = info.kind === 'check' ? null : svgEl('line', 'b-tick-line', root);
        const head = svgEl(info.kind === 'check' ? 'circle' : 'path', 'b-tick-head', root);
        const text = info.kind === 'check' ? null : svgEl('text', 'b-tick-text', root);
        const t1 = text ? svgEl('tspan', 'b-tick-t1', text) : null, t2 = text ? svgEl('tspan', 'b-tick-t2', text) : null;
        tick = { root, line, head, text, t1, t2 }; elements.ticks.set(key, tick); fresh = true;
        if (info.kind === 'check') set(head, { r: 4.2 });
      }
      tick.root.dataset.bItem = info.id; tick.root.dataset.id = info.id;
      tick.root.classList.toggle(`is-due`, info.kind === 'due'); tick.root.classList.toggle(`is-item-due`, info.kind === 'item-due');
      tick.root.classList.toggle('is-answered', Boolean(info.answered));
      tick.root.classList.toggle('is-ack', info.status === 'acknowledged');
      const words = () => { tick.root.classList.toggle('is-over', Boolean(info.over)); tick.root.classList.remove('is-arrived'); if (tick.t1) { tick.t1.textContent = info.line1; tick.t2.textContent = info.line2; } };
      if (fresh) words(); else later(words);
    }
    $('.b-plot-empty').hidden = scene.bands.size > 0;
    $('.b-current-empty').hidden = scene.section.placed.size > 0;
    updateEmphasis();
  }

  // ---------- draw: write geometry for one sampled scene ----------
  let heroArrived = null;
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
    for (const [key, next] of scene.nexts) {
      const line = elements.nexts.get(key); if (!line) continue;
      set(line, { x1: barW + next.x, x2: barW + next.x, y1: 0, y2: scene.height });
      line.style.opacity = next.o.toFixed(3);
    }
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
    // The walk: a deadline that reaches now is “到了” on the spot (its own beat); the hero turns to 0 if it was the hero.
    if (scene.crossed?.size) for (const key of scene.crossed) {
      const tick = elements.ticks.get(key), info = scene.meta.ticks.get(key);
      if (!tick || !info || info.kind === 'check' || info.answered || tick.root.classList.contains('is-arrived')) continue;
      tick.root.classList.add('is-arrived', 'is-over');
      if (tick.t2 && !info.grouped) tick.t2.textContent = info.kind === 'snooze' ? '到点了' : '此刻到期';
      if (scene.meta.hero?.key === key && heroArrived !== key) { heroArrived = key; showHeroArrived(scene.meta.hero); }
      if (info.kind === 'snooze') flashLabel(info.id, 'is-back');
    }
    // The hero's bracket: from now to its deadline.
    const hero = scene.hero?.get('hero'), mark = $('.b-hero-mark');
    if (hero && hero.o > .01) {
      const x0 = barW + 2, x1 = barW + Math.max(2, hero.x - 6), y = hero.y;
      mark.setAttribute('d', x1 - x0 > 2 ? `M ${x0} ${y - 3.5} V ${y + 3.5} M ${x0} ${y} H ${x1} M ${x1} ${y - 3.5} V ${y + 3.5}` : '');
      mark.style.opacity = hero.o.toFixed(3);
    } else mark.setAttribute('d', '');
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

  // ---------- the hero number ----------
  function heroDisplay(n, unit, kicker, q) {
    $('.b-hero-k').textContent = kicker; $('.b-hero-n').textContent = n; $('.b-hero-u').textContent = unit; $('.b-hero-q').textContent = q;
    $('.b-hero').classList.toggle('is-none', !n);
  }
  function showHero(scene) {
    heroArrived = null;
    const h = scene?.meta?.hero, now = scene?.time ?? scene?.snap?.cursor;
    if (!h) { heroDisplay('', '', '此刻之后没有等你回的期限', ''); return; }
    const w = heroWords(h.at - now);
    heroDisplay(w.n, w.unit, '最近的期限', `${askShort(h.ask)} · ${stamp(h.at)} 前`);
  }
  function showHeroArrived(h) { heroDisplay('0', '小时', '最近的期限', `到期 · ${askShort(h.ask)}`); }

  // ---------- concept layer: the walk's time grain and one grey dot per input ----------
  const concept = (() => {
    const canvas = $('.b-concept'), ctx = canvas.getContext('2d');
    let job = null, w = 0, h = 0, ratio = 1;
    const GREY = 'rgba(120, 128, 118, ';
    function size(width, height) {
      ratio = Math.min(2, devicePixelRatio || 1);
      if (Math.abs(width - w) < .5 && Math.abs(height - h) < .5) return;
      w = width; h = height;
      canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    }
    function clear() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
    return {
      size,
      get live() { return Boolean(job); },
      /** A forward turn: grain from t0 on, and the inputs of the round being walked into, placed where they will go. */
      begin({ t0, t1, events, scene, active }) {
        if (reduced.matches) { job = null; return; }
        const W = scene.futureW, bar = scene.barW, used = scene.section.used * scene.section.unit;
        const grain = [];
        for (let k = 1; k <= 30; k += 1) grain.push(t0 + k * HOUR);
        for (let k = 1; k <= 12; k += 1) grain.push(t0 + 30 * HOUR + k * 6 * HOUR);
        for (let k = 1; k <= 30; k += 1) grain.push(t0 + 102 * HOUR + k * 24 * HOUR);
        const dots = events.map(event => {
          const at = Date.parse(event.at), used2 = event.disposition === 'used';
          const related = (event.relatedIds || []).map(id => scene.section.placed.get(id)).find(Boolean);
          let y;
          if (used2 && related) {
            const g = related.grouped && !expanded ? scene.section.group : related;
            y = g.y + g.h / 2 + (hash(event.id, 3) - .5) * Math.max(0, Math.min(g.h - 2, 12));
          } else y = 3 + hash(event.id, 5) * Math.max(10, (used2 ? used : h) - 6);
          return { at, used: used2, x: bar + 2.5 + hash(event.id, 7) * 9, y, tx: bar * (.25 + hash(event.id, 9) * .5) };
        });
        job = { t0, t1, W, bar, grain, dots, active };
      },
      paint(dim = 0) {
        if (!job) return;
        const a = motion.active;
        clear();
        if (!a || a !== job.active) { job = null; return; }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        canvas.style.opacity = (1 - .6 * dim).toFixed(3);
        const fx = span => job.bar + futureFraction(span) * job.W;
        if (a.phase === 'walk' || !a.tween) {
          const t = motion.visual?.time ?? job.t0, k = (t - job.t0) / Math.max(1, job.t1 - job.t0), fade = Math.min(1, k * 6);
          ctx.fillStyle = `${GREY}${(.42 * fade).toFixed(3)})`;
          for (const T of job.grain) { if (T <= t) continue; const x = fx(T - t); if (x > job.bar + job.W + 2) break; ctx.fillRect(x - .5, 0, 1, 4); ctx.fillRect(x - .5, h - 4, 1, 4); }
          for (const dot of job.dots) {
            if (dot.at > t) continue;
            const age = Math.min(1, (t - dot.at) / ((job.t1 - job.t0) * .08 || 1));
            ctx.fillStyle = `${GREY}${(.5 * age).toFixed(3)})`;
            ctx.beginPath(); ctx.arc(dot.x, dot.y, 1.25, 0, Math.PI * 2); ctx.fill();
          }
          return;
        }
        // After the cut: what was taken in goes into the bar, the rest fades where it fell; 0.4 s and the layer is empty.
        const tau = a.tau ?? 0, k = Math.min(1, tau / .4), e = 1 - (1 - k) ** 3;
        if (k >= 1) { job = null; clear(); return; }
        ctx.fillStyle = `${GREY}${(.42 * Math.max(0, 1 - tau / .2)).toFixed(3)})`;
        for (const T of job.grain) { if (T <= job.t1) continue; const x = fx(T - job.t1); if (x > job.bar + job.W + 2) break; ctx.fillRect(x - .5, 0, 1, 4); ctx.fillRect(x - .5, h - 4, 1, 4); }
        for (const dot of job.dots) {
          const alpha = dot.used ? .5 * (1 - e) : .5 * Math.max(0, 1 - tau / .25);
          if (alpha <= .01) continue;
          ctx.fillStyle = `${GREY}${alpha.toFixed(3)})`;
          ctx.beginPath(); ctx.arc(dot.used ? dot.x + (dot.tx - dot.x) * e : dot.x, dot.y, 1.25, 0, Math.PI * 2); ctx.fill();
        }
      },
      stop() { job = null; clear(); },
    };
  })();

  // ---------- motion ----------
  const motion = createTimeMotion({ prepare, draw, reduced: () => reduced.matches,
    wake: () => wake(),
    cue(name, target, active) {
      if (name === 'cut') onCut(target, active);
      else if (name === 'hero') showHero(target);
      else if (name === 'land') flushPending();
      else if (name === 'flash' && active?.kind === 'turn') flashNewAsks(target); // only on a turn that is shown moving
    },
    complete(target) { updateEmphasis(); syncKeys(); ix.relayout(); },
    status(state, progress) { host.dataset.bMotion = state; host.dataset.bMotionProgress = progress.toFixed(3); $('.b-replay').disabled = !motion.canReplay; },
  });
  // The cut: the texts of the round on screen change at once (title, date, the reader; the budget waits for 'land').
  function onCut(target, active) {
    if (target.snap) shown = target.snap;
    const beats = active?.plan && !active.plan.uniform;
    renderTexts(shown, target, !beats);
    if (beats && target.section) pending.push(() => renderBudget(target));
    // The reader of that round, with what was selected meanwhile (a selection during the walk is not undone).
    if (active?.kind === 'turn') { host.classList.remove('is-walking'); renderReader(current.index === shown.index && current.layerId === shown.layerId ? current : shown, false); if (player.on) player.t = 0; }
    if (target.meta?.hero == null || active?.plan?.uniform) showHero(target);
    syncKeys();
  }
  function flashNewAsks(scene) {
    const s = scene.snap; if (!s || s.index < 1) return;
    const before = { index: s.index - 1, state: records[s.index - 1].state };
    for (const [id, entry] of scene.meta.labels) {
      if (!entry.ask || currentAsk(before, id)?.id === entry.ask.id) continue;
      flashLabel(id, 'is-new-ask');
    }
  }
  function flashLabel(id, cls) {
    const label = elements.labels.get(id); if (!label || reduced.matches) return;
    label.classList.remove(cls); void label.offsetWidth; label.classList.add(cls);
    setTimeout(() => label.classList.remove(cls), 1700);
  }

  // ---------- texts that change at the cut ----------
  function renderTitle() {
    const s = shown, f = cutId ? ix.view : null;
    const title = f ? `这一件 · ${f.short} · ${stamp(s.cursor)}` : s.frame.title;
    $('#b-page-title').textContent = title; $('#b-page-title').title = title;
  }
  // The budget is a number on the bars' geometry: under a beat plan it turns with them, at 'land'.
  function renderBudget(scene) {
    $('.b-history-range').textContent = scene.first === scene.last ? `第 ${scene.last + 1} 次整理` : `第 ${scene.first + 1}—${scene.last + 1} 次整理`;
    $('.b-budget').innerHTML = `<strong>${scene.section.used}</strong> / ${scene.section.budget} 份${scene.section.blank.share ? `<span class="b-blank-count"><i class="b-key-blank" aria-hidden="true"></i>${scene.section.blank.share} 份未分配</span>` : ''}`;
  }
  function renderTexts(s, scene = motion.visual, budget = true) {
    renderTitle();
    $('.b-date').textContent = stamp(s.now);
    const revision = String(s.state.revision);
    $('.b-revision').textContent = `状态 ${revision.startsWith('r') ? revision : `r${revision}`}`;
    $('.b-input-count').textContent = String(s.frame.events.length);
    $('.b-feedback-button').hidden = !s.state.pending_annotations?.length;
    $('.b-feedback-count').textContent = String(s.state.pending_annotations?.length ?? 0);
    const jump = $('.b-jump .b-select');
    jump.querySelector('.b-select-value').textContent = `${frameShort(s.frame, s.index, s.frames.length)}${isReview(s.frame) ? ' · 每日整理' : ''}`;
    jump.querySelectorAll('[role="option"]').forEach((option, index) => option.setAttribute('aria-selected', String(index === s.index)));
    if (scene?.section && budget) renderBudget(scene);
    const checked = s.index > 0 && s.frameDiff.changes.length === 0;
    $('.b-check-note').textContent = checked ? (isReview(s.frame) ? '每日整理：检查后不改' : '检查过，状态未变') : '';
  }
  function renderControls(s) {
    renderSlider(s);
    $('.b-first-date').textContent = formatDate(s.frames[0].at); $('.b-last-date').textContent = formatDate(s.frames.at(-1).at);
    $('[data-b-action="previous"]').disabled = s.index === 0; $('[data-b-action="next"]').disabled = s.index === s.frames.length - 1;
    $('.b-play-word').textContent = player.on ? '暂停' : '播放'; $('.b-play-icon').textContent = player.on ? 'Ⅱ' : '▷';
    $('.b-play').setAttribute('aria-label', player.on ? '暂停回放' : '播放回放'); $('.b-compare').setAttribute('aria-pressed', String(s.comparing));
    for (const button of host.querySelectorAll('[data-b-range]')) button.setAttribute('aria-pressed', String(button.dataset.bRange === range));
    renderBreadcrumbs(s);
  }

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
    for (const due of deadlinesOf(s, placed.map(point => point.item))) rows.push({ at: due.at, id: due.id, title: due.item.title, what: due.ask ? due.ask.prompt : '条目自己的期限', kind: due.at < s.cursor ? 'over' : due.ask ? 'due' : 'item-due', answered: Boolean(due.ask && answeredHere(due.id, due.ask, s.cursor)) });
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
      : `<li class="is-${row.kind}${row.answered ? ' is-answered' : ''}"><time>${relative(row.at - s.cursor)}</time><button type="button" data-b-item="${esc(row.id)}"><b>${esc(row.title)}</b><small>${stamp(row.at)} · ${row.answered ? '你已在本页回答 · ' : ''}${esc(row.what)}</small></button></li>`).join('')}</ol></section>`;
  }
  function roundActionsHTML(s) {
    const visible = new Set(allPlaced(s).map(point => point.id));
    const entries = frameActions(s.index).filter(entry => visible.has(entry.target));
    if (!entries.length) return '';
    const shownEntries = entries.slice(0, 5), rest = entries.slice(5);
    const one = entry => actionHTML(entry, { cls: 'b', withTarget: getItem(s.state, entry.target) });
    return `<section class="b-round-loop"><h3>本轮你在各处的回应 · ${entries.length} 条</h3>${shownEntries.map(one).join('')}${rest.length ? `<details class="b-more"><summary>另 ${rest.length} 条</summary>${rest.map(one).join('')}</details>` : ''}</section>`;
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
    const response = responder.html(item, ask, { allowDefer: item.status === 'active', previous: true });
    const answered = latestRecord(store, item.id, s.cursor);
    const due = deadlinesOf(s, [item])[0];
    const actions = itemActions(item.id, s.index);
    const back = fromSmall ? '<button type="button" class="b-back-link" data-b-group-open>← 小事列表</button>' : '';
    return `${back}<div class="b-detail" data-b-detail="${esc(item.id)}"><p class="b-detail-kicker"><i class="b-item-dot" style="--item-color:${colorFor(item, s.state)}" aria-hidden="true"></i><span>${esc(kindLabel[item.kind] || item.kind)} · <b>${item.share}</b> / 64 份</span>${item.status !== 'active' ? ` · ${item.status === 'merged' ? '已合并' : '已撤下'}` : ''}</p><h2>${esc(item.title)}</h2><p class="b-detail-summary">${esc(item.summary)}</p>
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
  // The reader re-renders as a whole; an answer or an undo on the item it shows turns its response box into the
  // receipt (or back) in place: the old controls fade, the box changes height, what follows moves up or down once.
  function captureRespond(body) {
    const section = body.querySelector('.b-detail-respond');
    if (!section) return null;
    const box = section.getBoundingClientRect();
    return { item: body.querySelector('[data-b-detail]')?.dataset.bDetail, height: box.height, html: section.innerHTML, status: section.querySelector('.b-rs-receipt')?.dataset.status || null, receipt: Boolean(section.querySelector('.b-rs-receipt')) };
  }
  function morphRespond(before, body) {
    const section = body.querySelector('.b-detail-respond');
    if (!before || !section || before.item !== body.querySelector('[data-b-detail]')?.dataset.bDetail || reduced.matches) return;
    const receipt = section.querySelector('.b-rs-receipt');
    // The next 整理 read it: the hollow check fills where it is.
    if (before.status === 'saved' && receipt?.dataset.status === 'acknowledged') { receipt.classList.add('is-acking'); return; }
    if (section.innerHTML === before.html || before.receipt === Boolean(receipt)) return;
    const undo = before.receipt && !receipt, T = undo ? { box: 200, ghost: 100, inDelay: 150, inDur: 200, follow: 100, followDur: 200 } : { box: 200, ghost: 120, inDelay: 100, inDur: 200, follow: 200, followDur: 320 };
    const height = section.getBoundingClientRect().height, dy = before.height - height;
    const style = getComputedStyle(section);
    const bg = document.createElement('div'); bg.className = 'b-respond-bg';
    Object.assign(bg.style, { background: style.backgroundColor, border: style.border, borderRadius: style.borderRadius });
    const ghost = document.createElement('div'); ghost.className = 'b-respond-ghost'; ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
    ghost.innerHTML = before.html; ghost.querySelector('h3')?.remove();
    ghost.style.top = `${section.querySelector('h3')?.offsetTop + section.querySelector('h3')?.offsetHeight || 0}px`;
    const content = [...section.children].filter(child => child.tagName !== 'H3');
    section.classList.add('is-morphing'); section.prepend(bg); section.append(ghost);
    bg.animate([{ transform: `scaleY(${(before.height / Math.max(1, height)).toFixed(4)})` }, { transform: 'none' }], { duration: T.box, easing: EASE_OUT });
    ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T.ghost, fill: 'forwards' });
    for (const child of content) child.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: T.inDur, delay: T.inDelay, easing: EASE_OUT, fill: 'backwards' });
    if (Math.abs(dy) > .5) for (let node = section.nextElementSibling; node; node = node.nextElementSibling) node.animate([{ transform: `translateY(${dy.toFixed(1)}px)` }, { transform: 'none' }], { duration: T.followDur, delay: T.follow, easing: EASE_OUT, fill: 'backwards' });
    setTimeout(() => { bg.remove(); ghost.remove(); section.classList.remove('is-morphing'); }, T.follow + T.followDur + 40);
  }
  function renderReader(s, force = false) {
    const key = `${s.index}|${s.cursor}|${s.layerId}|${s.selectedId}|${readerMode}|${s.baseIndex}|${expanded}|${cutId}`;
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
    else if (selected) { title = '事项详情'; kicker = cutId === selected.id ? '这一件 · 在这里作答' : fromSmall ? '小事 · 详情' : '摘要与依据'; content = itemHTML(s, selected); }
    else if (readerMode === 'small') { title = '小事'; kicker = '份额不足 3 的事项'; content = smallListHTML(s); }
    else content = `<p class="b-narrative">${esc(s.frame.narrative || s.frame.title)}</p>${signalHTML(s)}${upcomingHTML(s)}${roundActionsHTML(s)}${readingListHTML(s)}`;
    $('#b-reader-title').textContent = title; $('.b-reader-kicker').textContent = kicker;
    if (content === readerContent) return;
    // Replacing the body must not drop keyboard focus to <body>, or Esc and Tab lose their place.
    const body = $('.b-reader-body'), hadFocus = body.contains(document.activeElement);
    const before = captureRespond(body);
    body.innerHTML = content; readerContent = content;
    morphRespond(before, body);
    if (!force) $('.b-reader-scroll').scrollTop = 0;
    if (hadFocus && !body.contains(document.activeElement)) (body.querySelector('.b-rs-receipt') || $('#b-reader-title')).focus({ preventScroll: true });
  }

  // ---------- emphasis ----------
  // Hovering or opening an item (ix) leaves it as it is and takes the rest to seven tenths; keyboard focus on a label,
  // a hovered reader row and a selection without the card use the stronger emphasis from before.
  let ixFocus = null;
  function updateEmphasis() {
    const id = ixFocus || hoveredId || focusedId || current.selectedId;
    const ids = new Set(id ? [id] : []);
    if (id) for (const link of cache(current.layerId).merges.filter(link => link.index <= current.index)) if (ids.has(link.to) || ids.has(link.from)) { ids.add(link.to); ids.add(link.from); }
    // A member of a closed 小事 band is only visible through the band itself.
    if (id && id !== GROUP && geometryGrouped(id) && !expanded) ids.add(GROUP);
    $('.b-chart-layout').classList.toggle('has-ix', Boolean(ixFocus));
    $('.b-chart-layout').classList.toggle('has-emphasis', !ixFocus && ids.size > 0);
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
    // Space and the shell's play go to this page's own player (it counts from the cut and stops while you hover).
    if (event.type === 'play' && s.playing) { model.pause(); togglePlay(); return; }
    const previous = current;
    current = s;
    const navigating = event.type === 'frame' || (event.type === 'play' && s.index !== previous.index);
    if (navigating) {
      if (!advancing && player.on) setPlaying(false);
      if (!tour.stepping && tour.on) stopTour(false);
      // Navigation drops hover and detail at once (the item stays selected in the reader).
      ixOwned = null; ix.reset();
    }
    if (event.type === 'select') { if (s.selectedId) { readerMode = 'item'; if (geometryGrouped(s.selectedId) && !expanded) expanded = true; } else { readerMode = expanded ? 'small' : 'overview'; fromSmall = false; } if (ix.s.open && ix.s.open !== s.selectedId) { ixOwned = null; ix.close(); } }
    if (event.type === 'compare') readerMode = s.comparing ? 'diff' : 'overview';
    if (event.type === 'dive' || event.type === 'rise') { readerMode = 'overview'; expanded = false; host.classList.remove('is-reading'); ixOwned = null; ix.reset(); }
    if (event.type === 'frame' && !s.selectedId && readerMode === 'item') readerMode = expanded ? 'small' : 'overview';
    if (event.type === 'frame' && responder.closePanel()) readerStamp = '';
    renderControls(s);
    const size = `${Math.round($('.b-chart-layout').clientWidth)}:${Math.round($('.b-chart-scroll').clientWidth)}:${Math.round($('.b-present-body').clientHeight)}`;
    const chartKey = `${s.index}|${s.cursor}|${s.layerId}|${s.comparing}|${s.baseIndex}|${range}|${expanded}|${size}|${store.list().length}`;
    let kind = 'other';
    if (chartKey !== chartStamp || event.type === 'resize' || event.type === 'record') {
      const scene = makeScene(s);
      const from = motion.visual?.time ?? previous.cursor;
      let plan = null, walk = null, duration = 0;
      if (navigating) {
        const forward = s.cursor > from && s.layerId === previous.layerId;
        if (instantNext) duration = 0;
        else if (dragging) duration = FRAME_MS;
        else if (forward) { plan = BEATS.turn; walk = { t0: from, t1: s.cursor }; kind = 'turn'; }
        else duration = BACK_MS;
      } else if (event.type === 'record') { plan = event.kind === 'undo' ? BEATS.undo : BEATS.answer; kind = event.kind || 'save'; }
      else duration = event.type === 'expand' ? EXPAND_MS : event.type === 'dive' || event.type === 'rise' ? LAYER_MS : event.type === 'range' ? FRAME_MS : 0;
      if (drawnExpanded !== expanded && !plan) duration = Math.max(duration, EXPAND_MS);
      drawnExpanded = expanded;
      if (kind === 'turn' && !reduced.matches) host.classList.add('is-walking');
      motion.transition(scene, { duration, instant: !plan && duration === 0, plan, walk, kind });
      if (kind === 'turn') {
        const events = s.index - previous.index === 1 ? s.frame.events : [];
        concept.begin({ t0: walk.t0, t1: walk.t1, events, scene, active: motion.active });
      }
      if (event.type === 'record') ix.relayout();
      chartStamp = chartKey;
    } else { shown = s; renderTexts(s); updateEmphasis(); }
    // The reader changes with the texts: at the cut on a turn, now otherwise (frames rebuild it in their own task).
    clearTimeout(readerTimer);
    if (kind !== 'turn') {
      if (navigating && !reduced.matches) readerTimer = setTimeout(() => renderReader(current, false), 0);
      else renderReader(s, event.type === 'record');
    }
    host.dataset.bStateIndex = String(s.index); host.dataset.bLayer = s.layerId ?? 'root'; host.dataset.bExpanded = String(expanded);
    const cost = performance.now() - t0; perf.renders += 1; perf.total += cost; perf.worst = Math.max(perf.worst, cost); if (perf.samples.length < 2000) perf.samples.push(cost);
    wake();
  }
  function showReader() { if (mobile.matches) { host.classList.add('is-reading'); $('#b-reader-title').focus({ preventScroll: true }); } }
  function toggleGroup(open = !expanded) {
    expanded = open; fromSmall = false;
    readerMode = open ? 'small' : 'overview';
    if (current.selectedId) { model.select(null); return; }
    render(current, { type: 'expand' });
  }

  // ---------- interaction: hover a summary, click to open (../forms/motion/ix.mjs) ----------
  let held = false, ixOwned = null, cutId = null, X = null, popDrawn = null;
  // Where the present column sits in the stage (the stage is .b-chart-layout, position: relative).
  function stageGeom() {
    const body = $('.b-present-body');
    return { left: body.offsetLeft, top: body.offsetTop, barW: geometry?.barW ?? 46, futureW: geometry?.futureW ?? 200 };
  }
  const visibleBar = id => { const v = motion.visual, bar = v?.bars.get(id), info = v?.meta.bars.get(id); return bar && info && !info.group && bar.o > .3 ? bar : null; };
  function hitAt(x, y) {
    const v = motion.visual; if (!v) return null;
    const g = stageGeom(), px = x - g.left, py = y - g.top;
    if (py < 0 || py > v.height || px < -16 || px > g.barW + g.futureW + 4) return null;
    for (const [id, bar] of v.bars) if (id !== GROUP && py >= bar.y && py < bar.y + bar.h && visibleBar(id)) return id;
    return null;
  }
  function barCenter(id) { const bar = visibleBar(id); if (!bar) return null; const g = stageGeom(); return { x: g.left + g.barW / 2, y: g.top + bar.y + bar.h / 2, bar, g }; }
  function resolveName(name) {
    if (!name) return null;
    if (visibleBar(name)) return name;
    const v = motion.visual; if (!v) return null;
    for (const [id, info] of v.meta.bars) if (id !== GROUP && visibleBar(id) && (shortOf(id) === name || info.title === name)) return id;
    return null;
  }
  // The facts of one item in the round on screen (cards keep to the beat: before the cut they speak of the last round).
  function factsOf(id) {
    const s = shown, i = s.index, item = getItem(s.state, id);
    const root = !s.layerId;
    const base = root ? itemFacts(i, id) : null;
    const before = i > 0 ? getItem(records[i - 1].state, id) : null;
    const share = item?.status === 'active' ? item.share : 0, was = before?.status === 'active' ? before.share : 0;
    const change = i === 0 ? '' : !was && share ? `新增 ${share} 份` : share > was ? `本轮 ${was} → ${share}` : share < was ? `本轮 ${was} → ${share}` : `本轮不变 ${share} 份`;
    const ask = currentAsk(s, id), deadline = item ? deadlinesOf(s, [item])[0] : null;
    let open = null;
    if (ask) {
      const regs = s.frames.slice(0, i + 1).map((frame, k) => (Object.values(frame.asks || {}).some(a => a.id === ask.id) ? k : -1)).filter(k => k >= 0);
      const first = regs[0] ?? i;
      open = { hours: Math.max(0, Math.round((s.cursor - Date.parse(s.frames[first].at)) / HOUR)), rounds: i - first, regs: regs.length, again: regs.at(-1) === i && regs.length > 1 };
    }
    const record = latestRecord(store, id, s.cursor);
    const status = record ? (s.frames.some(frame => Date.parse(frame.at) > record.at && Date.parse(frame.at) <= s.cursor) ? '已收到' : '已保存') : '';
    const inputs = base ? base.inputs : s.frame.events.filter(event => (event.relatedIds || []).includes(id)).map(event => ({ source: String(event.channel || '').split(' · ')[0], from: event.from || '', title: clip(String(event.subject || event.text || '').replace(/\s+/g, ' '), 30) }));
    return { i, id, short: root ? shortOf(id) : clip(item?.title, 10), title: item?.title || id, summary: item?.summary || '', share, before: was, change, stream: base?.stream || [],
      ask, askAnswered: Boolean(ask && answeredHere(id, ask, s.cursor)), deadline, now: s.cursor, open, record, status, inputs, feedback: base ? base.feedback : [],
      trend: base ? base.trend : versionsOf(id).series.map(p => p.share), kids: base ? base.children : (item?.children?.items || []).map(c => ({ title: c.title, share: c.share })) };
  }
  function dueLine(f) {
    const d = f.deadline; if (!d) return '';
    return d.at < f.now ? `期限 ${stamp(d.at)} · ${relative(d.at - f.now)}` : `离期限 ${relative(d.at - f.now).replace(/后$/, '')} · ${stamp(d.at)} 前`;
  }
  function peekCard(f) {
    const ask = f.ask, rec = f.record;
    const openLine = ask ? `问题开了 ${f.open.hours} 小时（${f.open.rounds} 轮）${f.open.again ? ' · 本轮重新登记' : ''}` : '这一版没有登记问题';
    return `<div class="ix-k">${esc(f.stream.length ? `来自${f.stream.join(' · ')}` : `第 ${f.i + 1} 次整理`)}</div><div class="ix-q">${esc(ask ? askShort(ask) : f.title)}</div>
      <div class="ix-d">${esc(`${f.short} ${f.share} / 64 份 · ${f.change}`)}</div>
      <div class="ix-d">${esc(openLine)}${dueLine(f) ? ` · ${esc(dueLine(f))}` : ''}</div>
      <div class="ix-d">${f.inputs.length ? `本轮进了 ${f.inputs.length} 条输入` : '本轮没有输入进它'}</div>
      ${rec ? `<div class="ix-ask b-ix-rec"><i></i><span>✓ ${esc(recordWords(rec))}</span><small>${esc(f.status)}${staleRecord(rec, ask) ? ' · 答的是上一版' : ''}</small></div>` : ask ? `<div class="ix-ask is-urgent"><i></i><span>${esc(clip(ask.prompt, 40))}</span>${f.deadline ? `<small>${esc(stamp(f.deadline.at))} 前</small>` : ''}</div>` : ''}`;
  }
  function detailCard(f) {
    const ask = f.ask, last = current.frames.length - 1;
    // Numbered as B's own header counts (第 i + 1 / 29 次整理), every frame from the first.
    const n = last + 1, W = 300, H = 32, top = Math.max(24, ...f.trend), bw = W / n;
    const bars = f.trend.map((value, k) => { const h = value ? Math.max(1.5, (value / top) * (H - 2)) : 1; return `<rect x="${(k * bw + bw * .15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * .7).toFixed(1)}" height="${h.toFixed(1)}" class="${k === f.i ? 'is-now' : k > f.i ? 'is-later' : value ? '' : 'is-off'}"/>`; }).join('');
    const groups = new Map();
    for (const x of f.inputs) { if (!groups.has(x.source)) groups.set(x.source, []); groups.get(x.source).push(x); }
    const sorted = [...groups].sort((a, b) => b[1].length - a[1].length), rest = sorted.slice(3).reduce((sum, [, list]) => sum + list.length, 0);
    const inputs = sorted.slice(0, 3).map(([source, list]) => `<li><small>${esc(source)} · ${list.length} 条</small>${[...new Map(list.map(x => [x.title, x])).values()].slice(0, 2).map(x => `<span>${x.from ? `<em>${esc(x.from)}</em> ` : ''}${esc(x.title)}</span>`).join('')}</li>`).join('') + (rest ? `<li class="ix-none">另有 ${rest} 条，来自 ${sorted.length - 3} 个来源</li>` : '');
    const question = ask ? `<div class="ix-d-ask${f.askAnswered ? '' : ' is-urgent'}"><i></i><p>${esc(ask.prompt)}</p><small>${esc(dueLine(f) || '没有期限')}</small><small>${esc(`开了 ${f.open.hours} 小时 · ${f.open.rounds} 轮 · 登记 ${f.open.regs} 次`)}</small><small class="b-ix-here">${f.askAnswered ? `✓ ${esc(recordWords(f.record))} · ${esc(f.status)}` : '在右栏作答 →'}</small></div>`
      : `<p class="ix-none">${f.record ? `✓ ${esc(recordWords(f.record))} · ${esc(f.status)}` : '这一版没有登记问题'}${f.deadline ? ` · ${esc(dueLine(f))}` : ''}</p>`;
    const fb = f.feedback.length ? `<ul class="ix-d-fb">${f.feedback.slice(-3).map(x => `<li><time>${esc(stamp(x.at))}</time>${esc(x.text)}</li>`).join('')}</ul>` : '<p class="ix-none">到这一轮还没有你的回应</p>';
    return `<div class="ix-d-k"><span>第 ${f.i + 1} / ${n} 次整理${f.stream.length ? ` · 来自${esc(f.stream.join(' · '))}` : ''}</span><button type="button" data-x="close" aria-label="收回（Esc）" title="收回（Esc）">×</button></div>
      <div class="ix-d-t">${esc(f.title)}</div>
      <div class="ix-d-s"><b>${esc(f.short)} ${f.share}</b> / 64 份 · ${esc(f.change)}</div>
      <section><h5>期限<b>${f.deadline ? esc(f.deadline.at < f.now ? '已过' : relative(f.deadline.at - f.now)) : '没有'}</b></h5>${question}</section>
      ${f.kids.length ? `<section><h5>子层<b>${f.kids.length} 件</b></h5><ul class="ix-d-kids">${f.kids.map(c => `<li><span>${esc(c.title)}</span><b>${c.share}</b></li>`).join('')}</ul></section>` : ''}
      <section><h5>份额 · 逐次<b>第 ${f.i + 1} 次 ${f.share} 份</b></h5><svg class="ix-trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg><div class="ix-axis"><span>第 1 次</span><span>第 ${n} 次</span></div></section>
      <section><h5>本轮进了它<b>${f.inputs.length} 条</b></h5>${inputs ? `<ul class="ix-d-in">${inputs}</ul>` : '<p class="ix-none">本轮没有输入进它</p>'}</section>
      <section><h5>你的回应<b>${f.feedback.length ? `共 ${f.feedback.length} 条` : ''}</b></h5>${fb}</section>`;
  }
  const ix = createIx({
    stage,
    facts: id => factsOf(id), has: id => Boolean(visibleBar(id)), hit: (x, y) => hitAt(x, y),
    pointOf: id => { const p = barCenter(id); return p ? { x: p.x, y: p.y } : null; },
    pause: () => { held = true; motion.hold(true); }, resume: () => { held = false; motion.hold(false); wake(); }, paused: () => held,
    last: current.frames.length - 1, answerHref: () => '#',
    named: name => resolveName(name), index: () => shown.index,
    // The card hangs left of the 64 column, over the history; it never covers the item's own row.
    anchor: id => {
      const p = barCenter(id); if (!p) return { x: 0, y: 0, facing: -1 };
      return { x: p.g.left - 4, y: p.y, facing: -1, keep: { x0: p.g.left - 12, y0: p.g.top + p.bar.y - 2, x1: stage.clientWidth, y1: p.g.top + p.bar.y + p.bar.h + 2 } };
    },
    // The leader leaves the popped-out segment along its band's middle line, to the card's near edge.
    leader: (id, card) => {
      const p = barCenter(id); if (!p) return [{ x: card.x1, y: card.y0 }, { x: card.x1, y: card.y0 }];
      const start = { x: p.g.left - IX.pop - 1, y: p.y }, cy = Math.max(card.y0 + 12, Math.min(card.y1 - 12, p.y));
      if (card.x1 > start.x) return [start, { x: card.x0, y: Math.max(card.y0 + 12, Math.min(card.y1 - 12, p.y)) }];
      return Math.abs(cy - p.y) < 1 ? [start, { x: card.x1, y: cy }] : [start, { x: card.x1 + 16, y: p.y }, { x: card.x1, y: cy }];
    },
    bounds: () => ({ x0: 6, y0: 34, x1: stage.clientWidth - 6, y1: stage.clientHeight - 6 }),
    peekHTML: f => peekCard(f), detailHTML: f => detailCard(f), detailWidth: 320, hug: 'edge',
    keysIn: stage, label: '事项：Tab 逐件看概要，Enter 展开，Esc 收回',
    skip: '.b-node-buttons, .b-plot-empty, .b-dive, [data-b-group], [data-b-group-label]',
  });
  function syncKeys() {
    const v = motion.visual; if (!v) return;
    const list = [...v.meta.labels.values()].filter(entry => !entry.group).sort((a, b) => a.y - b.y)
      .concat(expanded && v.section.group ? v.section.group.members.map(id => ({ id, item: v.section.placed.get(id).item, ask: currentAsk(shown, id) })) : []);
    ix.sync(`${shown.index}|${shown.layerId}|${expanded}|${list.map(x => x.id).join(',')}`, list.map(x => ({ id: x.id, label: `${x.item.title} ${x.item.share} 份${x.ask ? ` · ${expectOf(x.ask)}` : ''}` })));
  }
  // Each frame while ix is live: the open item's segment pops 8 px out of the column, the rest go to seven tenths,
  // and the page title and reader cut to “这一件” while the detail is out.
  function paintIx() {
    X = ix.frame();
    const focus = X.dim > .001 ? X.focus : null;
    if (focus !== ixFocus) { ixFocus = focus; updateEmphasis(); }
    if (focus) stage.style.setProperty('--b-ixdim', (1 - .3 * X.dim).toFixed(3));
    const id = X.popId, dx = id ? -IX.pop * X.pop : 0;
    if (popDrawn && popDrawn !== id) setPop(popDrawn, 0);
    if (id) setPop(id, dx);
    popDrawn = id || null;
    const open = X.detail ? ix.s.open : null;
    if (open !== cutId) {
      cutId = open;
      // Only a selection the card made is undone when it folds; one you had made in the reader stays.
      if (open) { if (current.selectedId !== open) { ixOwned = open; model.select(open); } else { ixOwned = null; renderReader(current, true); } }
      else {
        const owned = ixOwned; ixOwned = null;
        if (owned && current.selectedId === owned) model.select(null); else renderReader(current, true);
      }
      renderTitle();
    }
    ix.paint();
  }
  function setPop(id, dx) {
    const value = Math.abs(dx) > .01 ? `translate(${dx.toFixed(2)} 0)` : null;
    for (const el of [elements.bars.get(id), elements.numbers.get(id), elements.notches.get(id)]) if (el) { if (value) el.setAttribute('transform', value); else el.removeAttribute('transform'); }
  }
  function ixToggle(id, event) {
    if (!visibleBar(id)) return false;
    if (event?.pointerType === 'touch' || ix.s.pointer === 'touch') { if (ix.s.hover !== id && ix.s.open !== id) { ix.hover(id, 'touch'); return true; } }
    if (ix.s.open === id && ix.s.closeAt == null) ix.close(); else ix.open(id);
    return true;
  }

  // ---------- the frame loop: motion, ix, concept layer, player and the story share one rAF ----------
  let raf = null, lastT = 0;
  function wake() { if (raf == null && !disposed) { lastT = performance.now(); raf = requestAnimationFrame(loop); } }
  function loop(now) {
    raf = null;
    if (disposed) return;
    const dt = Math.min(100, Math.max(0, now - lastT)); lastT = now;
    const moving = motion.tick(dt);
    paintIx();
    concept.paint(X?.dim || 0);
    playerTick(dt);
    tourTick(dt);
    if (moving || motion.running || ix.live() || concept.live || player.on || tour.on || popDrawn) raf = requestAnimationFrame(loop);
  }

  // ---------- ▶ play on: this page counts 5.6 s a round from the cut, and not while anything holds it ----------
  const player = { on: false, t: 0 };
  function setPlaying(on) { player.on = on; player.t = 0; renderControls(current); if (on) wake(); }
  function togglePlay() {
    if (player.on) { setPlaying(false); return; }
    if (tour.on) stopTour(true);
    if (current.index >= current.frames.length - 1) { advancing = true; model.goFrame(0); advancing = false; }
    setPlaying(true); player.t = PLAY; // the first step goes at once
  }
  function playerTick(dt) {
    if (!player.on || held || document.hidden) return;
    player.t += dt / 1000;
    if (player.t < PLAY || motion.running) return;
    player.t = 0;
    if (current.index >= current.frames.length - 1) { setPlaying(false); return; }
    advancing = true; model.goFrame(current.index + 1); advancing = false;
    if (current.index >= current.frames.length - 1) { player.on = false; renderControls(current); }
  }

  // ---------- 自动讲一遍 ----------
  // Only when this page is the top window, was opened directly (no referrer) and its address had no ?frame= (the shell
  // fills one in before this module runs, so read the address the page was loaded with).
  const topLevel = (() => { try { return window.top === window; } catch { return false; } })();
  const loadedWith = new URL(performance.getEntriesByType?.('navigation')?.[0]?.name || location.href);
  // …and opened as B (switching to B inside the shell does not count).
  const direct = topLevel && !document.referrer && !loadedWith.searchParams.has('frame') && loadedWith.searchParams.get('variant')?.toLowerCase() === 'b';
  const sample = storySample(current.frames);
  const tour = { on: false, t: 0, steps: [], next: 0, stepping: false, record: null };
  function jump(i) { advancing = true; instantNext = true; tour.stepping = true; model.goFrame(i); tour.stepping = false; instantNext = false; advancing = false; }
  function stepTo(i) { advancing = true; tour.stepping = true; model.goFrame(i); tour.stepping = false; advancing = false; }
  function tourAnswer() {
    if (!sample) return;
    if (current.selectedId !== sample.id) model.select(sample.id);
    // Already answered here (by you): leave your record alone, and never remove it on a replay.
    if (latestRecord(store, sample.id, current.cursor)) { tour.record = null; return; }
    const button = host.querySelector(`.b-reader-body [data-rs-act="${CSS.escape(`${sample.id}:${sample.action}`)}"]`);
    if (button) { button.click(); requestAnimationFrame(() => requestAnimationFrame(() => { if (tour.on && host.contains(document.activeElement)) document.activeElement.blur(); })); }
    else {
      const item = getItem(current.state, sample.id), ask = currentAsk(current, sample.id), action = ask && normalizeAsk(ask).actions.find(a => a.id === sample.action);
      if (item && action) { store.save(item, action, { ask: normalizeAsk(ask), at: current.cursor, via: 'button' }); render(current, { type: 'record', kind: 'save' }); renderReader(current, true); }
    }
    tour.record = latestRecord(store, sample.id, current.cursor)?.key || null;
  }
  function startTour() {
    if (!sample || reduced.matches) return;
    stopTour(false);
    if (player.on) setPlaying(false);
    ixOwned = null; ix.reset();
    if (tour.record) { store.removeKey(tour.record); tour.record = null; chartStamp = ''; }
    if (current.selectedId) model.select(null);
    jump(sample.index - 1);
    const S = sample.index, walkA = 0.4, walkB = 0.45;
    tour.steps = [
      [0.6, () => stepTo(S)],
      [0.6 + walkA + 1.0 + 0.7, () => model.select(sample.id)],
      [0.6 + walkA + 1.0 + 0.7 + 1.3, () => tourAnswer()],
      [0.6 + walkA + 1.0 + 0.7 + 1.3 + 1.7, () => stepTo(S + 1)],
      [0.6 + walkA + 1.0 + 0.7 + 1.3 + 1.7 + walkB + 1.2, () => stopTour(false)],
    ];
    tour.on = true; tour.t = 0; tour.next = 0;
    $('.b-tell-note').hidden = false;
    wake();
  }
  function tourTick(dt) {
    if (!tour.on || held) return;
    tour.t += dt / 1000;
    while (tour.on && tour.next < tour.steps.length && tour.t >= tour.steps[tour.next][0]) { const [, fn] = tour.steps[tour.next]; tour.next += 1; fn(); }
  }
  /** End the story where it is or, skipping, at its end: the sample's next round, answered, the item open in the reader. */
  function stopTour(skip = false) {
    if (!tour.on) return;
    tour.on = false; $('.b-tell-note').hidden = true;
    if (!skip || !sample) return;
    if (current.index < sample.index) jump(sample.index);
    if (current.index === sample.index && !latestRecord(store, sample.id, current.cursor)) { motion.settle(); tourAnswer(); }
    if (current.index <= sample.index) jump(sample.index + 1);
    motion.settle();
    if (current.selectedId !== sample.id) model.select(sample.id);
  }
  // Any key skips (and is spent on skipping); so does a press anywhere, which then goes on as usual.
  const skipKey = event => { if (!tour.on || event.metaKey || event.ctrlKey || event.altKey || ['Shift', 'Meta', 'Control', 'Alt', 'CapsLock'].includes(event.key)) return; event.preventDefault(); event.stopImmediatePropagation(); stopTour(true); };
  const skipPress = event => { if (tour.on && !event.target.closest?.('[data-b-action="tell"]')) stopTour(true); };
  window.addEventListener('keydown', skipKey, true);
  window.addEventListener('pointerdown', skipPress, true);
  const tellButton = () => { $('.b-tell').hidden = !topLevel || !sample || reduced.matches; };
  tellButton();

  // ---------- events ----------
  function click(event) {
    const option = event.target.closest('.b-select [role="option"]');
    if (option) { chooseOption(option.closest('.b-select'), option); return; }
    const selectButton = event.target.closest('.b-select-button');
    if (selectButton) { const root = selectButton.closest('.b-select'); if (openSelect === root) closeSelect(true); else openSelectBox(root); return; }
    const button = event.target.closest('button, [role="button"], .b-loop, .b-flow, .b-tick-mark, .b-lane, .b-merge-link');
    if (!button || !host.contains(button)) return;
    if (button.dataset.labInspect) return;
    if (button.dataset.tFrame != null) { model.goFrame(Number(button.dataset.tFrame)); return; }
    if (button.dataset.bGroupOpen != null) { fromSmall = false; readerMode = 'small'; model.select(null); return; }
    if (button.dataset.bGroup != null) { toggleGroup(); return; }
    if (button.dataset.bDive) { model.dive(button.dataset.bDive); return; }
    const item = button.dataset.bItem || button.dataset.tItem;
    // In the chart, an item is ix's: the label buttons open or fold it here, the drawn marks through ix's own click.
    if (item && stage.contains(button)) { if (button.matches('button')) ixToggle(item, event); return; }
    if (item) { fromSmall = readerMode === 'small' || (fromSmall && Boolean(current.selectedId)); model.select(item); showReader(); return; }
    if (button.dataset.bFrame != null) { model.goFrame(Number(button.dataset.bFrame)); return; }
    if (button.dataset.bRange) { range = button.dataset.bRange; render(current, { type: 'range' }); return; }
    switch (button.dataset.bAction) {
      case 'previous': model.goFrame(current.index - 1); break;
      case 'next': model.goFrame(current.index + 1); break;
      case 'play': togglePlay(); break;
      case 'tell': startTour(); break;
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
      // An open detail folds first (ix puts focus back where it came from; the selection follows it), and only that:
      // the shell's Esc would also climb a layer.
      if (ix.s.open && !event.target.matches?.('input,textarea,select,[contenteditable]')) { event.preventDefault(); event.stopPropagation(); ix.close(); return; }
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
  // Hovering in the chart is ix's; a reader row still lights its item in the chart.
  const inReader = element => Boolean(element?.closest?.('.b-reader'));
  function pointerover(event) { const id = inReader(event.target) ? itemFrom(event.target) : null; if (id !== hoveredId) { hoveredId = id; updateEmphasis(); } }
  function pointerout(event) { const id = inReader(event.relatedTarget) ? itemFrom(event.relatedTarget) : null; if (id !== hoveredId) { hoveredId = id; updateEmphasis(); } }
  function focusin(event) { if (event.target.closest('.b-reader-body') || ix.owns(event.target)) return; focusedId = itemFrom(event.target); updateEmphasis(); }
  function focusout() { queueMicrotask(() => { if (!disposed) { focusedId = document.activeElement?.closest?.('.b-reader-body') || ix.owns(document.activeElement) ? null : itemFrom(document.activeElement); updateEmphasis(); } }); }
  function outside(event) { if (openSelect && !openSelect.contains(event.target)) closeSelect(false); }
  function scrolled(event) { if (openSelect && !openSelect.querySelector('.b-select-list').contains(event.target)) closeSelect(false); }
  const listeners = { click, keydown, pointerover, pointerout, focusin, focusout, pointerdown: sliderPointer, pointermove: sliderPointer, pointerup: sliderPointer, pointercancel: sliderPointer };
  for (const [name, listener] of Object.entries(listeners)) host.addEventListener(name, listener);
  // ix changes its state inside its own listeners; the frame loop sleeps when nothing moves, so any input wakes it.
  const WAKE = ['pointermove', 'pointerleave', 'pointerdown', 'click', 'keydown', 'focusin', 'focusout'];
  const waker = () => wake();
  for (const name of WAKE) document.addEventListener(name, waker, true);
  const unbindRespond = responder.bind($('.b-reader-body'), { getAsk: id => currentAsk(current, id), getItemVersion: id => getItem(current.state, id), render: () => renderReader(current, true) });
  document.addEventListener('pointerdown', outside, true);
  host.addEventListener('scroll', scrolled, true);
  const onResize = () => { closeSelect(false); ix.relayout(); }; addEventListener('resize', onResize);
  const reduceMotion = () => { if (reduced.matches) { motion.settle(); concept.stop(); stopTour(true); } $('.b-replay').disabled = !motion.canReplay; tellButton(); };
  reduced.addEventListener?.('change', reduceMotion);
  const onVisibility = () => { if (document.hidden && player.on) setPlaying(false); };
  document.addEventListener('visibilitychange', onVisibility);
  const unsubscribe = model.subscribe(render);
  // The history's own width too: anything that changes it without changing the layout (late styles) redraws.
  const sizeKey = () => `${$('.b-chart-layout').clientWidth}:${$('.b-chart-scroll').clientWidth}:${$('.b-present-body').clientHeight}`;
  let lastSize = sizeKey();
  const observer = new ResizeObserver(() => {
    const size = sizeKey();
    if (disposed || size === lastSize || (mobile.matches && host.classList.contains('is-reading'))) return;
    lastSize = size; cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { if (!disposed) render(current, { type: 'resize' }); });
  });
  observer.observe($('.b-chart-layout')); observer.observe($('.b-chart-scroll')); host.dataset.bBuild = 'b-motion-3';
  // For review tooling: per-frame draw cost of transitions, and render cost per model event.
  host.__bTime = { motion, perf, store, get expanded() { return expanded; }, toggleGroup };
  // window.foldB: the same hooks as foldDial (ix.hooks), plus this page's own.
  const ixHooks = ix.hooks();
  for (const name of ['hover', 'unhover', 'open', 'close', 'ixAt']) { const fn = ixHooks[name]; ixHooks[name] = (...a) => { const out = fn(...a); wake(); return out; }; }
  const hooks = {
    ...ixHooks, model, motion, perf,
    get index() { return current.index; },
    go: i => model.goFrame(i), play: () => { if (!player.on) togglePlay(); }, stop: () => { if (player.on) setPlaying(false); }, playing: () => player.on,
    /** The hero item when it is on screen, else the largest item drawn on its own (for checks). */
    pick: () => { const h = motion.visual?.meta.hero; if (h && visibleBar(h.id)) return h.id; let best = null; for (const [id, bar] of motion.visual?.bars || []) if (visibleBar(id) && (!best || bar.h > best.h)) best = { id, h: bar.h }; return best?.id || null; },
    /** A point `d` px left of an item's segment in the 64 column, level with its middle (page coordinates). */
    nearOf: (name, d = 9) => { const id = resolveName(name), p = id && barCenter(id); if (!p) return null; const box = stage.getBoundingClientRect(); return { x: box.left + p.g.left - d, y: box.top + p.y }; },
    geom: name => { const id = resolveName(name), p = id && barCenter(id); if (!p) return null; const box = stage.getBoundingClientRect(); return { x0: box.left + p.g.left, x1: box.left + p.g.left + p.g.barW, y0: box.top + p.g.top + p.bar.y, y1: box.top + p.g.top + p.bar.y + p.bar.h }; },
    hero: () => ({ n: $('.b-hero-n').textContent, unit: $('.b-hero-u').textContent, q: $('.b-hero-q').textContent, id: motion.visual?.meta.hero?.id || null }),
    /** Hold whatever is in flight at `seconds` after its start (the walk included); null lets it run on. */
    at: seconds => motion.pin(seconds),
    beat: () => ({ phase: motion.phase, kind: motion.active?.kind || null, elapsed: motion.active?.elapsed ?? null, walk: motion.active?.W ?? null }),
    settled: () => !motion.running && !concept.live,
    answer: (id, action) => { if (current.selectedId !== id) model.select(id); const b = host.querySelector(`.b-reader-body [data-rs-act="${CSS.escape(`${id}:${action}`)}"]`); if (b) b.click(); return Boolean(b); },
    undo: id => { const b = host.querySelector(`.b-reader-body [data-rs-undo="${CSS.escape(id)}"]`); if (b) b.click(); return Boolean(b); },
    tell: () => startTour(), skip: () => stopTour(true), telling: () => tour.on, sample: () => sample,
  };
  window.foldB = hooks;
  if (direct && sample && !reduced.matches && !told) { told = true; startTour(); }
  return () => {
    disposed = true; clearTimeout(readerTimer); unsubscribe(); unbindRespond(); observer.disconnect(); cancelAnimationFrame(resizeFrame); cancelAnimationFrame(raf); motion.stop(); concept.stop(); ix.reset();
    for (const [name, listener] of Object.entries(listeners)) host.removeEventListener(name, listener);
    for (const name of WAKE) document.removeEventListener(name, waker, true);
    document.removeEventListener('pointerdown', outside, true); host.removeEventListener('scroll', scrolled, true);
    window.removeEventListener('keydown', skipKey, true); window.removeEventListener('pointerdown', skipPress, true);
    document.removeEventListener('visibilitychange', onVisibility);
    removeEventListener('resize', onResize);
    reduced.removeEventListener?.('change', reduceMotion);
    if (window.foldB === hooks) delete window.foldB;
  };
}

export default mount;
